import csv
import io
import unicodedata
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from difflib import SequenceMatcher
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.bank_statement import BankStatement, Reconciliation
from app.models.finance import Transaction, TransactionType
from app.services.mensalidade_service import MensalidadeService


def normalize_name(name: str) -> str:
    if not name:
        return ""
    nfkd = unicodedata.normalize("NFKD", name.upper())
    return "".join(c for c in nfkd if not unicodedata.combining(c)).strip()


def parse_amount(raw: str) -> Decimal:
    v = raw.replace("R$", "").strip()
    if not v:
        return Decimal("0")
    if "." in v and "," not in v:
        parts = v.split(".")
        if len(parts) == 2 and len(parts[-1]) <= 2:
            return Decimal(v)
        v = v.replace(".", "")
        return Decimal(v)
    return Decimal(v.replace(".", "").replace(",", "."))


def clean_cpf(cpf: str | None) -> str | None:
    if not cpf:
        return None
    cleaned = "".join(c for c in cpf if c.isdigit())
    return cleaned if len(cleaned) == 11 else None


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


SCORE_VERDE = 150
SCORE_AMARELO = 80


class ReconciliationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ─── CSV import ──────────────────────────────────────────────────────────

    async def import_csv(
        self,
        association_id: UUID,
        bank: str,
        content: bytes,
    ) -> list[BankStatement]:
        statements = []
        if bank == "infinitypay":
            statements = self._parse_infinitypay_raw(content, association_id)
        else:
            text_content = content.decode("utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(text_content))
            rows = list(reader)
            if bank == "itau":
                statements = self._parse_itau(rows, association_id)
            elif bank == "cora":
                statements = self._parse_cora(rows, association_id)

        existing_q = await self._session.execute(
            text("""
                SELECT date, name, amount FROM bank_statements
                WHERE association_id = :aid AND bank = :bank
            """),
            {"aid": str(association_id), "bank": bank},
        )
        existing_keys = {
            (str(r[0]), (r[1] or "").upper(), str(r[2]))
            for r in existing_q.fetchall()
        }

        new_statements = []
        for stmt in statements:
            key = (str(stmt.date), (stmt.name or "").upper(), str(stmt.amount))
            if key not in existing_keys:
                new_statements.append(stmt)
                existing_keys.add(key)

        for stmt in new_statements:
            self._session.add(stmt)
        await self._session.flush()
        return new_statements

    # ─── Score calculation ────────────────────────────────────────────────────

    async def _load_learning_map(self, association_id: UUID) -> dict[str, str]:
        """Returns {bank_name_normalized: resident_id} from pix_learning_map."""
        q = await self._session.execute(
            text("""
                SELECT bank_name, resident_id, match_count
                FROM pix_learning_map
                WHERE association_id = :aid
                ORDER BY match_count DESC
            """),
            {"aid": str(association_id)},
        )
        mapping: dict[str, str] = {}
        for bank_name, resident_id, _ in q.fetchall():
            norm = normalize_name(bank_name)
            if norm not in mapping:
                mapping[norm] = str(resident_id)
        return mapping

    def _name_score(self, tx_name: str, stmt_name: str) -> int:
        if not tx_name or not stmt_name:
            return 0
        norm_tx = normalize_name(tx_name)
        norm_st = normalize_name(stmt_name)
        stop = {"DE", "DA", "DO", "DOS", "DAS", "E"}
        tw = set(norm_tx.split()) - stop
        sw = set(norm_st.split()) - stop
        if not tw or not sw:
            return 0
        overlap = sum(1 for w in tw if any(self._words_match(w, s) for s in sw))
        ratio = overlap / max(len(tw), len(sw))
        return int(60 * ratio) if ratio >= 0.4 else 0

    def _words_match(self, a: str, b: str) -> bool:
        if a == b:
            return True
        if len(a) >= 5 and len(b) >= 5 and a[:5] == b[:5]:
            return True
        if len(a) >= 4 and len(b) >= 4 and _similarity(a, b) >= 0.8:
            return True
        return False

    def _payer_name_score(self, tx_payer_name: str | None, stmt_name: str | None) -> int:
        """
        Compara o payer_name registrado na transação com o nome do extrato.
        +80 exact, +50 similarity ≥ 85%
        """
        if not tx_payer_name or not stmt_name:
            return 0
        a = normalize_name(tx_payer_name)
        b = normalize_name(stmt_name)
        if a == b:
            return 80
        if _similarity(a, b) >= 0.85:
            return 50
        return 0

    def _date_score(self, tx_date: date, stmt_date: date) -> int:
        diff = abs((tx_date - stmt_date).days)
        if diff == 0:
            return 30
        if diff == 1:
            return 15
        if diff <= 3:
            return 5
        return 0

    def calculate_score(
        self,
        *,
        tx_date: date,
        tx_amount: Decimal,
        tx_res_cpf: str | None,
        tx_primary_name: str,
        tx_payer_name: str | None,
        tx_resident_id: str | None,
        stmt: BankStatement,
        learning_map: dict[str, str],
    ) -> int:
        score = 0

        # CPF match: highest signal
        if tx_res_cpf and stmt.cpf and clean_cpf(tx_res_cpf) == stmt.cpf:
            score += 100

        # payer_name field vs statement name (new structured field)
        score += self._payer_name_score(tx_payer_name, stmt.name)

        # Resident name vs statement name
        score += self._name_score(tx_primary_name, stmt.name or "")

        # pix_learning_map lookup
        if stmt.name and tx_resident_id:
            norm_stmt_name = normalize_name(stmt.name)
            mapped_resident = learning_map.get(norm_stmt_name)
            if mapped_resident and mapped_resident == tx_resident_id:
                score += 60

        # Amount match
        if tx_amount == stmt.amount:
            score += 50

        # Date proximity
        score += self._date_score(tx_date, stmt.date)

        return score

    # ─── Learning map upsert ─────────────────────────────────────────────────

    async def record_learning(
        self,
        association_id: UUID,
        bank_name: str,
        resident_id: UUID,
        resident_name: str,
        confirmed_by: UUID,
    ) -> None:
        await self._session.execute(
            text("""
                INSERT INTO pix_learning_map
                    (association_id, bank_name, resident_id, resident_name, confirmed_by, match_count, last_matched_at)
                VALUES (:aid, :bname, :rid, :rname, :cby, 1, NOW())
                ON CONFLICT (association_id, bank_name, resident_id)
                DO UPDATE SET
                    match_count = pix_learning_map.match_count + 1,
                    last_matched_at = NOW(),
                    confirmed_by = EXCLUDED.confirmed_by
            """),
            {
                "aid": str(association_id),
                "bname": bank_name,
                "rid": str(resident_id),
                "rname": resident_name,
                "cby": str(confirmed_by),
            },
        )

    # ─── Reconciliation run ───────────────────────────────────────────────────

    async def run_reconciliation(self, association_id: UUID) -> dict:
        # Unreconciled income transactions
        tx_q = await self._session.execute(
            text("""
                SELECT t.id, t.amount, t.description, t.transaction_at,
                       r.full_name, r.cpf, t.resident_id, t.payer_name
                FROM transactions t
                LEFT JOIN residents r ON r.id = t.resident_id
                WHERE t.association_id = :aid
                  AND t.type = 'income'
                  AND t.reversed_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM reconciliations rec WHERE rec.transaction_id = t.id
                  )
                ORDER BY t.transaction_at DESC
            """),
            {"aid": str(association_id)},
        )
        transactions = tx_q.fetchall()

        stmt_q = select(BankStatement).where(
            BankStatement.association_id == association_id,
            BankStatement.conciliado == False,
        )
        result = await self._session.execute(stmt_q)
        statements = list(result.scalars().all())

        # Build resident lookups
        all_res_q = await self._session.execute(
            text("SELECT id, full_name, cpf FROM residents WHERE association_id=:aid"),
            {"aid": str(association_id)},
        )
        name_to_residents: dict[str, list[tuple]] = {}
        cpf_to_resident_id: dict[str, str] = {}
        for rr in all_res_q.fetchall():
            rid, rname, rcpf = rr
            norm = normalize_name(rname or "")
            if norm:
                name_to_residents.setdefault(norm, []).append((str(rid), rcpf))
            if rcpf:
                c = clean_cpf(rcpf)
                if c:
                    cpf_to_resident_id[c] = str(rid)

        learning_map = await self._load_learning_map(association_id)

        automatico = []
        sugestao = []
        pendente = []
        claimed_stmt_ids: set[str] = set()

        def _desc_name(description: str) -> str:
            if not description:
                return ""
            if " — " in description:
                return description.split(" — ", 1)[1].strip()
            if " - " in description:
                return description.split(" - ", 1)[1].strip()
            return ""

        for tx in transactions:
            tx_id, tx_amount, tx_desc, tx_at, res_name, res_cpf, tx_resident_id, tx_payer_name = tx
            tx_date = tx_at.date() if hasattr(tx_at, "date") else date.fromisoformat(str(tx_at)[:10])
            tx_amount_dec = Decimal(str(tx_amount))
            tx_res_name = normalize_name(res_name or "")
            tx_desc_name = normalize_name(_desc_name(tx_desc or ""))
            tx_primary_name = tx_res_name or tx_desc_name

            best_score = 0
            best_stmt: BankStatement | None = None
            matches = []

            for stmt in statements:
                if str(stmt.id) in claimed_stmt_ids:
                    continue

                score = self.calculate_score(
                    tx_date=tx_date,
                    tx_amount=tx_amount_dec,
                    tx_res_cpf=res_cpf,
                    tx_primary_name=tx_primary_name,
                    tx_payer_name=tx_payer_name,
                    tx_resident_id=str(tx_resident_id) if tx_resident_id else None,
                    stmt=stmt,
                    learning_map=learning_map,
                )

                if score > 0:
                    matches.append((score, stmt))
                    if score > best_score:
                        best_score = score
                        best_stmt = stmt

            item = {
                "id": str(best_stmt.id) if best_stmt else str(tx_id),
                "transaction_id": str(tx_id),
                "bank": best_stmt.bank if best_stmt else "",
                "date": str(tx_date),
                "amount": float(tx_amount),
                "name": best_stmt.name if best_stmt else (res_name or _desc_name(tx_desc or "")),
                "resident": res_name or "",
                "resident_id": str(tx_resident_id) if tx_resident_id else None,
                "cpf": best_stmt.cpf if best_stmt else (clean_cpf(res_cpf) if res_cpf else None),
                "score": best_score,
                "sale_description": tx_desc,
                "bank_statement_id": str(best_stmt.id) if best_stmt else None,
                "status": "pendente",
            }

            if best_stmt and best_score >= SCORE_VERDE:
                recon = Reconciliation(
                    association_id=association_id,
                    statement_id=best_stmt.id,
                    transaction_id=tx_id,
                    score=best_score,
                    status="automatico",
                )
                self._session.add(recon)
                best_stmt.conciliado = True
                self._session.add(best_stmt)
                claimed_stmt_ids.add(str(best_stmt.id))
                item["status"] = "automatico"

                if best_stmt.cpf:
                    await self._pay_pending_mensalidade(
                        association_id=association_id,
                        cpf=best_stmt.cpf,
                        transaction_id=tx_id,
                    )

                automatico.append(item)

            elif best_stmt and best_score >= SCORE_AMARELO:
                top = [m for m in matches if m[0] == best_score]
                if len(top) == 1:
                    recon = Reconciliation(
                        association_id=association_id,
                        statement_id=best_stmt.id,
                        transaction_id=tx_id,
                        score=best_score,
                        status="sugestao",
                    )
                    self._session.add(recon)
                    item["status"] = "sugestao"
                    sugestao.append(item)
                else:
                    pendente.append(item)
            else:
                pendente.append(item)

        await self._session.flush()

        # Pass 2: orphan bank statements (payer known, no transaction)
        identificado = []
        for stmt in statements:
            if stmt.conciliado or str(stmt.id) in claimed_stmt_ids:
                continue
            resident_match: str | None = None
            if stmt.cpf and stmt.cpf in cpf_to_resident_id:
                rid = cpf_to_resident_id[stmt.cpf]
                for norm_res, res_list in name_to_residents.items():
                    if any(r[0] == rid for r in res_list):
                        resident_match = norm_res
                        break
            if not resident_match and stmt.name:
                for norm_res, _ in name_to_residents.items():
                    if self._name_score(normalize_name(stmt.name), norm_res) >= 40:
                        resident_match = norm_res
                        break
            if resident_match:
                identificado.append({
                    "id": str(stmt.id),
                    "bank": stmt.bank,
                    "date": str(stmt.date),
                    "amount": float(stmt.amount),
                    "name": stmt.name or "",
                    "cpf": stmt.cpf,
                    "score": 0,
                    "sale_description": None,
                    "resident": resident_match,
                    "bank_statement_id": str(stmt.id),
                    "status": "identificado",
                })

        return {
            "automatico": automatico,
            "sugestao": sugestao,
            "pendente": pendente,
            "identificado": identificado,
        }

    async def _pay_pending_mensalidade(
        self,
        association_id: UUID,
        cpf: str,
        transaction_id: UUID,
    ) -> None:
        res_q = await self._session.execute(
            text("SELECT id FROM residents WHERE association_id = :aid AND cpf LIKE :cpf LIMIT 1"),
            {"aid": str(association_id), "cpf": f"%{cpf}%"},
        )
        row = res_q.fetchone()
        if not row:
            return
        resident_id = row[0]
        svc = MensalidadeService(self._session)
        m = await svc.find_pending_for_resident(association_id, resident_id)
        if m:
            await svc.pay(m.id, association_id, transaction_id)

    # ─── CSV parsers ──────────────────────────────────────────────────────────

    def _parse_itau(self, rows: list[dict], association_id: UUID) -> list[BankStatement]:
        result = []
        for row in rows:
            raw_date = row.get("Data") or row.get("data") or ""
            valor = row.get("Valor") or row.get("valor") or "0"
            descricao = row.get("Descrição") or row.get("Descricao") or row.get("descricao") or ""
            nome = row.get("Nome") or row.get("nome") or ""
            cpf_raw = row.get("CPF/CNPJ") or row.get("cpf") or ""

            try:
                valor_dec = parse_amount(valor)
            except Exception:
                continue
            if valor_dec <= 0:
                continue
            if "pix" not in descricao.lower():
                continue
            try:
                from datetime import datetime
                dt = datetime.strptime(raw_date.strip(), "%d/%m/%Y").date()
            except Exception:
                continue

            result.append(BankStatement(
                association_id=association_id,
                bank="itau",
                date=dt,
                amount=valor_dec,
                name=normalize_name(nome) if nome else normalize_name(descricao),
                cpf=clean_cpf(cpf_raw),
                tipo="entrada",
                description=descricao,
            ))
        return result

    def _parse_cora(self, rows: list[dict], association_id: UUID) -> list[BankStatement]:
        import re
        result = []
        for row in rows:
            tipo_tx = (row.get("Tipo Transação") or row.get("Tipo") or "").strip().upper()
            if tipo_tx not in ("CRÉDITO", "CREDITO"):
                continue
            raw_date = (row.get("Data") or "").strip()
            transacao = (row.get("Transação") or row.get("Transacao") or "").strip()
            identificacao = (row.get("Identificação") or row.get("Identificacao") or "").strip()
            valor_raw = (row.get("Valor") or "0").strip()

            try:
                from datetime import datetime
                dt = datetime.strptime(raw_date, "%d/%m/%Y").date()
            except Exception:
                continue
            try:
                valor_dec = parse_amount(valor_raw)
                if valor_dec <= 0:
                    continue
            except Exception:
                continue

            cpf_found = None
            clean_nome = identificacao
            cpf_match = re.search(r'\b(\d{11})\b', identificacao)
            if cpf_match:
                cpf_found = cpf_match.group(1)
                clean_nome = identificacao.replace(cpf_match.group(0), "").strip()
            clean_nome = re.sub(r'^\d{2}\.\d{3}\.\d{3}\s*', '', clean_nome).strip()

            result.append(BankStatement(
                association_id=association_id,
                bank="cora",
                date=dt,
                amount=valor_dec,
                name=normalize_name(clean_nome) if clean_nome else normalize_name(identificacao),
                cpf=cpf_found,
                tipo="entrada",
                description=transacao,
            ))
        return result

    def _parse_infinitypay_raw(self, content: bytes, association_id: UUID) -> list[BankStatement]:
        import re
        from datetime import datetime as _dt

        PT_MONTHS = {
            "jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
            "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
        }

        def parse_pt_date(s: str):
            m = re.match(r'(\d{1,2})\s+(\w{3}),?\s+(\d{4})', s.strip())
            if not m:
                return None
            month = PT_MONTHS.get(m.group(2).lower())
            if not month:
                return None
            return _dt(int(m.group(3)), month, int(m.group(1))).date()

        try:
            text_data = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text_data = content.decode("latin-1")

        lines = text_data.splitlines()
        result = []
        last_date = None

        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                cols = next(csv.reader([line]))
            except Exception:
                continue
            cols = [c.strip() for c in cols]
            if len(cols) < 3:
                continue

            tipo_idx = next((i for i, c in enumerate(cols) if c.lower() in ("recebido", "enviado")), None)
            if tipo_idx is None:
                candidate = parse_pt_date(cols[0])
                if candidate:
                    last_date = candidate
                continue

            if cols[tipo_idx].lower() != "recebido":
                continue
            if cols[0]:
                d = parse_pt_date(cols[0])
                if d:
                    last_date = d
            if not last_date:
                continue

            nome = cols[tipo_idx + 1] if tipo_idx + 1 < len(cols) else ""
            detalhe = cols[tipo_idx + 2] if tipo_idx + 2 < len(cols) else ""
            valor_raw = cols[tipo_idx + 3] if tipo_idx + 3 < len(cols) else ""

            if not valor_raw or not re.search(r'\d', valor_raw):
                for c in reversed(cols):
                    if re.match(r'^[+\-]?\d', c):
                        valor_raw = c
                        break

            try:
                sign = -1 if valor_raw.strip().startswith("-") else 1
                valor_dec = parse_amount(valor_raw.lstrip("+-"))
                if valor_dec <= 0 or sign < 0:
                    continue
            except Exception:
                continue

            cpf_found = None
            cpf_m = re.search(r'\b(\d{11})\b', nome + " " + detalhe)
            if cpf_m:
                cpf_found = cpf_m.group(1)
                nome = nome.replace(cpf_m.group(0), "").strip()

            result.append(BankStatement(
                association_id=association_id,
                bank="infinitypay",
                date=last_date,
                amount=valor_dec,
                name=normalize_name(nome) if nome else None,
                cpf=cpf_found,
                tipo="entrada",
                description=detalhe or nome,
            ))
        return result
