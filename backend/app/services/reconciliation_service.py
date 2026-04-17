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
        """
        Reconcile by iterating over unreconciled income transactions and finding
        the best matching bank statement. Only transactions registered in the system
        are candidates — unmatched bank statements are ignored.
        """
        from difflib import SequenceMatcher as _SM

        # Unreconciled income transactions (source of truth)
        tx_q = await self._session.execute(
            text("""
                SELECT t.id, t.amount, t.description, t.transaction_at,
                       r.full_name, r.cpf, t.resident_id
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

        # Available (non-reconciled) bank statements
        stmt_q = select(BankStatement).where(
            BankStatement.association_id == association_id,
            BankStatement.conciliado == False,
        )
        result = await self._session.execute(stmt_q)
        statements = list(result.scalars().all())
        # Index statements by id for fast lookup
        stmt_by_id: dict[str, BankStatement] = {str(s.id): s for s in statements}

        def _words_match(a: str, b: str) -> bool:
            if a == b:
                return True
            if len(a) >= 5 and len(b) >= 5 and a[:5] == b[:5]:
                return True
            if len(a) >= 4 and len(b) >= 4 and _SM(None, a, b).ratio() >= 0.8:
                return True
            return False

        def _name_score(tx_name: str, stmt_name: str) -> int:
            if not tx_name or not stmt_name:
                return 0
            norm_tx = normalize_name(tx_name)
            norm_st = normalize_name(stmt_name)
            stop = {"DE", "DA", "DO", "DOS", "DAS", "E"}
            tw = set(norm_tx.split()) - stop
            sw = set(norm_st.split()) - stop
            if not tw or not sw:
                return 0
            overlap = sum(1 for w in tw if any(_words_match(w, s) for s in sw))
            ratio = overlap / max(len(tw), len(sw))
            return int(60 * ratio) if ratio >= 0.4 else 0

        def _desc_name(description: str) -> str:
            if not description:
                return ""
            if " — " in description:
                return description.split(" — ", 1)[1].strip()
            if " - " in description:
                return description.split(" - ", 1)[1].strip()
            return ""

        automatico = []
        sugestao = []
        pendente = []

        # Track which statements are already claimed (prevent double-use)
        claimed_stmt_ids: set[str] = set()

        for tx in transactions:
            tx_id, tx_amount, tx_desc, tx_at, res_name, res_cpf, _ = tx
            tx_date = tx_at.date() if hasattr(tx_at, 'date') else date.fromisoformat(str(tx_at)[:10])
            tx_amount_dec = Decimal(str(tx_amount))

            # Candidate names for this transaction: resident name + description name
            tx_res_name = normalize_name(res_name or "")
            tx_desc_name = normalize_name(_desc_name(tx_desc or ""))

            best_score = 0
            best_stmt: BankStatement | None = None
            matches = []

            for stmt in statements:
                if str(stmt.id) in claimed_stmt_ids:
                    continue

                score = 0
                name_score = 0

                # CPF match
                if res_cpf and stmt.cpf and clean_cpf(res_cpf) == stmt.cpf:
                    score += 100
                    name_score = 100

                # Name match: try resident name first, then description name
                ns = _name_score(tx_res_name or tx_desc_name, stmt.name or "")
                score += ns
                name_score = max(name_score, ns)

                # Amount
                if tx_amount_dec == stmt.amount:
                    score += 50

                # Date proximity (±1 day)
                if abs((tx_date - stmt.date).days) <= 1:
                    score += 20

                # Only count if there's name/CPF evidence
                if score > 0 and name_score > 0:
                    matches.append((score, stmt))
                    if score > best_score:
                        best_score = score
                        best_stmt = stmt

            item = {
                "transaction_id": str(tx_id),
                "description": tx_desc,
                "amount": float(tx_amount),
                "date": str(tx_date),
                "resident": res_name or "",
                "score": best_score,
                "bank_statement_id": str(best_stmt.id) if best_stmt else None,
                "bank_name": best_stmt.name if best_stmt else None,
                "status": "pendente",
            }

            if best_score >= 100:
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

                if stmt.cpf and best_stmt:
                    await self._pay_pending_mensalidade(
                        association_id=association_id,
                        cpf=best_stmt.cpf,
                        transaction_id=tx_id,
                    )

                automatico.append(item)
            elif best_score >= 70:
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
