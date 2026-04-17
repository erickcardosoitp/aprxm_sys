import csv
import io
import unicodedata
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.bank_statement import BankStatement, Reconciliation
from app.models.finance import Transaction, TransactionType
from app.services.mensalidade_service import MensalidadeService


def normalize_name(name: str) -> str:
    """Uppercase, remove accents."""
    if not name:
        return ""
    nfkd = unicodedata.normalize("NFKD", name.upper())
    return "".join(c for c in nfkd if not unicodedata.combining(c)).strip()


def parse_amount(raw: str) -> Decimal:
    """Parse amount handling both BR (1.234,56) and US (1,234.56) formats."""
    v = raw.replace("R$", "").strip()
    if not v:
        return Decimal("0")
    # US format: has period as decimal with 2 digits at end, no comma — e.g. "50.00", "1234.56"
    if "." in v and "," not in v:
        parts = v.split(".")
        if len(parts) == 2 and len(parts[-1]) <= 2:
            return Decimal(v)  # already valid decimal string
        # multiple dots = thousands sep — remove and use last segment
        v = v.replace(".", "")
        return Decimal(v)
    # BR format: 50,00 or 1.234,56
    return Decimal(v.replace(".", "").replace(",", "."))


def clean_cpf(cpf: str | None) -> str | None:
    if not cpf:
        return None
    cleaned = "".join(c for c in cpf if c.isdigit())
    return cleaned if len(cleaned) == 11 else None


class ReconciliationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def import_csv(
        self,
        association_id: UUID,
        bank: str,
        content: bytes,
    ) -> list[BankStatement]:
        text_content = content.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text_content))
        rows = list(reader)

        statements = []
        if bank == "itau":
            statements = self._parse_itau(rows, association_id)
        elif bank == "cora":
            statements = self._parse_cora(rows, association_id)
        elif bank == "infinitypay":
            statements = self._parse_infinitypay(rows, association_id)

        # Dedup: skip entries already in DB (same association+bank+date+name+amount)
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
                existing_keys.add(key)  # prevent intra-batch dups too

        for stmt in new_statements:
            self._session.add(stmt)
        await self._session.flush()
        return new_statements

    def _parse_itau(self, rows: list[dict], association_id: UUID) -> list[BankStatement]:
        result = []
        for row in rows:
            # Itaú typical columns: Data, Descrição, Nome, CPF/CNPJ, Valor
            raw_date = row.get("Data") or row.get("data") or ""
            valor = row.get("Valor") or row.get("valor") or "0"
            descricao = row.get("Descrição") or row.get("Descricao") or row.get("descricao") or ""
            nome = row.get("Nome") or row.get("nome") or ""
            cpf_raw = row.get("CPF/CNPJ") or row.get("cpf") or ""

            try:
                valor_dec = parse_amount(valor)
            except Exception:
                continue

            # Only PIX entries (positive values)
            if valor_dec <= 0:
                continue

            # Try to detect PIX entries
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
        """
        Formato Cora:
        Data, Transação, Tipo Transação, Identificação, Valor
        - Tipo Transação: CRÉDITO | DÉBITO
        - Identificação: nome do pagador (às vezes com CPF embutido no final)
        - Valor: positivo para crédito, negativo para débito
        """
        import re
        result = []
        for row in rows:
            tipo_tx = (row.get("Tipo Transação") or row.get("Tipo") or "").strip().upper()
            if tipo_tx != "CRÉDITO" and tipo_tx != "CREDITO":
                continue  # só entradas

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

            # Extrai CPF embutido no campo Identificação (11 dígitos consecutivos)
            cpf_found = None
            clean_nome = identificacao
            cpf_match = re.search(r'\b(\d{11})\b', identificacao)
            if cpf_match:
                cpf_found = cpf_match.group(1)
                clean_nome = identificacao.replace(cpf_match.group(0), "").strip()

            # Remove CNPJ-like prefixes (XX.XXX.XXX)
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

    def _parse_infinitypay(self, rows: list[dict], association_id: UUID) -> list[BankStatement]:
        """
        Formato InfinityPay:
        Data,Hora,Tipo,Nome,Detalhe,[Valor]
        - Data: YYYY-MM-DD
        - Tipo: Pix (só importa entradas do tipo Pix)
        - Nome: nome do pagador
        - Detalhe: descrição adicional
        - Valor: positivo = entrada
        """
        import re

        def _get(row: dict, *keys: str) -> str:
            for k in keys:
                v = row.get(k) or row.get(k.lower()) or row.get(k.upper()) or ""
                if v.strip():
                    return v.strip()
            return ""

        result = []
        for row in rows:
            tipo = _get(row, "Tipo", "tipo", "Categoria", "Transação", "Transacao").lower()
            if "pix" not in tipo:
                continue

            raw_date = _get(row, "Data", "data", "Date")
            nome = _get(row, "Nome", "nome", "Pagador", "Sacado", "Name")
            detalhe = _get(row, "Detalhe", "detalhe", "Descrição", "Descricao", "Detail")
            # InfinityPay may have "Valor Bruto", "Valor Líquido", "Valor"
            valor_raw = _get(row, "Valor Bruto", "Valor Líquido", "Valor Liquido", "Valor", "valor", "Amount") or "0"

            try:
                from datetime import datetime
                dt = datetime.strptime(raw_date, "%Y-%m-%d").date()
            except Exception:
                continue

            try:
                valor_dec = parse_amount(valor_raw)
                if valor_dec <= 0:
                    continue
            except Exception:
                continue

            cpf_found = None
            cpf_match = re.search(r'\b(\d{11})\b', nome + " " + detalhe)
            if cpf_match:
                cpf_found = cpf_match.group(1)
                nome = nome.replace(cpf_match.group(0), "").strip()

            result.append(BankStatement(
                association_id=association_id,
                bank="infinitypay",
                date=dt,
                amount=valor_dec,
                name=normalize_name(nome) if nome else None,
                cpf=cpf_found,
                tipo="entrada",
                description=detalhe or nome,
            ))
        return result

    async def run_reconciliation(self, association_id: UUID) -> dict:
        """Run reconciliation for all non-conciliated bank statements."""
        # Get non-reconciled statements
        stmt_q = select(BankStatement).where(
            BankStatement.association_id == association_id,
            BankStatement.conciliado == False,
        )
        result = await self._session.execute(stmt_q)
        statements = list(result.scalars().all())

        # Get income transactions (unreconciled)
        tx_q = await self._session.execute(
            text("""
                SELECT t.id, t.amount, t.description, t.transaction_at,
                       r.full_name, r.cpf, t.resident_id
                FROM transactions t
                LEFT JOIN residents r ON r.id = t.resident_id
                WHERE t.association_id = :aid
                  AND t.type = 'income'
                  AND NOT EXISTS (
                    SELECT 1 FROM reconciliations rec WHERE rec.transaction_id = t.id
                  )
                ORDER BY t.transaction_at DESC
            """),
            {"aid": str(association_id)},
        )
        transactions = tx_q.fetchall()

        # Build lookup: normalized_name -> list of resident_ids (for dependent matching)
        all_residents_q = await self._session.execute(
            text("SELECT id, full_name, cpf FROM residents WHERE association_id=:aid"),
            {"aid": str(association_id)},
        )
        # name_to_resident_ids: norm_name -> [(resident_id, cpf)]
        name_to_residents: dict[str, list[tuple]] = {}
        cpf_to_resident: dict[str, str] = {}
        for rr in all_residents_q.fetchall():
            rid, rname, rcpf = rr
            norm = normalize_name(rname or "")
            if norm:
                name_to_residents.setdefault(norm, []).append((str(rid), rcpf))
            if rcpf:
                clean = clean_cpf(rcpf)
                if clean:
                    cpf_to_resident[clean] = str(rid)

        # Build lookup: resident_id -> list of transaction ids
        res_to_txs: dict[str, list] = {}
        for tx in transactions:
            rid = str(tx[6]) if tx[6] else None
            if rid:
                res_to_txs.setdefault(rid, []).append(tx)

        automatico = []
        sugestao = []
        pendente = []

        def _name_score(stmt_name: str, candidate_name: str) -> int:
            if not stmt_name or not candidate_name:
                return 0
            norm_cand = normalize_name(candidate_name)
            stop = {"DE", "DA", "DO", "DOS", "DAS", "E"}
            sw = set(stmt_name.split()) - stop
            cw = set(norm_cand.split()) - stop
            if not sw or not cw:
                return 0
            # Fuzzy word matching: exact, prefix, or high similarity (e.g. CRISTINE/CHRISTINE)
            from difflib import SequenceMatcher as _SM
            def _words_match(a: str, b: str) -> bool:
                if a == b:
                    return True
                if len(a) >= 5 and len(b) >= 5 and a[:5] == b[:5]:
                    return True
                if len(a) >= 4 and len(b) >= 4 and _SM(None, a, b).ratio() >= 0.8:
                    return True
                return False
            overlap = sum(1 for w in sw if any(_words_match(w, c) for c in cw))
            ratio = overlap / max(len(sw), len(cw))
            return int(60 * ratio) if ratio >= 0.4 else 0

        def _desc_name(description: str) -> str:
            """Extract payer name from description like 'Mensalidade — Fulano de Tal'."""
            if not description:
                return ""
            if " — " in description:
                return description.split(" — ", 1)[1].strip()
            if " - " in description:
                return description.split(" - ", 1)[1].strip()
            return ""

        for stmt in statements:
            best_score = 0
            best_name_score = 0  # track if any name evidence exists
            best_tx = None
            matches = []

            # --- Match against transactions directly ---
            for tx in transactions:
                tx_id, tx_amount, tx_desc, tx_at, res_name, res_cpf, _ = tx
                score = 0
                name_score = 0

                if stmt.cpf and res_cpf and clean_cpf(res_cpf) == stmt.cpf:
                    score += 100
                    name_score = 100

                # Match against resident name OR description name (for transactions without resident)
                ns = _name_score(stmt.name or "", res_name or "")
                if ns == 0 and not res_name:
                    ns = _name_score(stmt.name or "", _desc_name(tx_desc or ""))
                score += ns
                name_score = max(name_score, ns)

                if Decimal(str(tx_amount)) == stmt.amount:
                    score += 50
                tx_date = tx_at.date() if hasattr(tx_at, 'date') else date.fromisoformat(str(tx_at)[:10])
                if abs((stmt.date - tx_date).days) <= 1:
                    score += 20

                # Only record if there's name/CPF evidence (not just amount+date collision)
                if score > 0 and name_score > 0:
                    matches.append((score, tx_id, tx_desc))
                    if score > best_score:
                        best_score = score
                        best_name_score = name_score
                        best_tx = (tx_id, tx_desc)

            # --- Dependent / all-resident name fallback ---
            # If no strong match yet, search all resident names and find their transactions
            if best_score < 70 and stmt.name:
                # CPF lookup
                if stmt.cpf and stmt.cpf in cpf_to_resident:
                    rid = cpf_to_resident[stmt.cpf]
                    for tx in res_to_txs.get(rid, []):
                        tx_id, tx_amount, tx_desc, tx_at, _, _, _ = tx
                        s = 100  # cpf match via resident
                        if Decimal(str(tx_amount)) == stmt.amount:
                            s += 50
                        tx_date = tx_at.date() if hasattr(tx_at, 'date') else date.fromisoformat(str(tx_at)[:10])
                        if abs((stmt.date - tx_date).days) <= 1:
                            s += 20
                        matches.append((s, tx_id, tx_desc))
                        if s > best_score:
                            best_score = s
                            best_tx = (tx_id, tx_desc)

                # Name fuzzy over all residents
                for norm_res, res_list in name_to_residents.items():
                    ns = _name_score(stmt.name, norm_res)
                    if ns < 30:
                        continue
                    for (rid, rcpf) in res_list:
                        extra = 0
                        if stmt.cpf and rcpf and clean_cpf(rcpf) == stmt.cpf:
                            extra = 100
                        for tx in res_to_txs.get(rid, []):
                            tx_id, tx_amount, tx_desc, tx_at, _, _, _ = tx
                            s = ns + extra
                            if Decimal(str(tx_amount)) == stmt.amount:
                                s += 50
                            tx_date = tx_at.date() if hasattr(tx_at, 'date') else date.fromisoformat(str(tx_at)[:10])
                            if abs((stmt.date - tx_date).days) <= 1:
                                s += 20
                            matches.append((s, tx_id, tx_desc))
                            if s > best_score:
                                best_score = s
                                best_tx = (tx_id, tx_desc)

            item = {
                "id": str(stmt.id),
                "bank": stmt.bank,
                "date": str(stmt.date),
                "amount": float(stmt.amount),
                "name": stmt.name or "",
                "cpf": stmt.cpf,
                "score": best_score,
                "sale_description": best_tx[1] if best_tx else None,
                "status": "pendente",
            }

            if best_score >= 100:
                # Auto-reconcile
                recon = Reconciliation(
                    association_id=association_id,
                    statement_id=stmt.id,
                    transaction_id=best_tx[0] if best_tx else None,
                    score=best_score,
                    status="automatico",
                )
                self._session.add(recon)
                stmt.conciliado = True
                self._session.add(stmt)
                item["status"] = "automatico"

                # Dar baixa na mensalidade mais antiga pendente do morador (CPF match)
                if stmt.cpf and best_tx:
                    await self._pay_pending_mensalidade(
                        association_id=association_id,
                        cpf=stmt.cpf,
                        transaction_id=best_tx[0],
                    )

                automatico.append(item)
            elif best_score >= 70:
                # Multiple or single match suggestion
                if len([m for m in matches if m[0] == best_score]) == 1:
                    recon = Reconciliation(
                        association_id=association_id,
                        statement_id=stmt.id,
                        transaction_id=best_tx[0] if best_tx else None,
                        score=best_score,
                        status="sugestao",
                    )
                    self._session.add(recon)
                    item["status"] = "sugestao"
                    sugestao.append(item)
                else:
                    item["status"] = "pendente"
                    pendente.append(item)
            else:
                item["status"] = "pendente"
                pendente.append(item)

        await self._session.flush()

        return {
            "automatico": automatico,
            "sugestao": sugestao,
            "pendente": pendente,
        }

    async def _pay_pending_mensalidade(
        self,
        association_id: UUID,
        cpf: str,
        transaction_id: UUID,
    ) -> None:
        from app.models.resident import Resident
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
