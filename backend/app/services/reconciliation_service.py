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

        for stmt in statements:
            self._session.add(stmt)
        await self._session.flush()
        return statements

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
                valor_dec = Decimal(valor.replace("R$", "").replace(".", "").replace(",", ".").strip())
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
        result = []
        for row in rows:
            # Cora typical columns: Data, Descrição, Valor
            raw_date = row.get("Data") or row.get("data") or ""
            valor = row.get("Valor") or row.get("valor") or "0"
            descricao = row.get("Descrição") or row.get("Descricao") or row.get("descricao") or ""

            try:
                valor_dec = Decimal(valor.replace("R$", "").replace(".", "").replace(",", ".").strip())
            except Exception:
                continue

            if valor_dec <= 0:
                continue

            # Cora: identify "Pix recebida" entries
            if "pix" not in descricao.lower():
                continue

            try:
                from datetime import datetime
                dt = datetime.strptime(raw_date.strip(), "%d/%m/%Y").date()
            except Exception:
                continue

            # Extract name from description: "Pix recebida de NOME"
            nome = ""
            lower_desc = descricao.lower()
            for prefix in ["pix recebida de ", "pix recebido de "]:
                if prefix in lower_desc:
                    idx = lower_desc.index(prefix) + len(prefix)
                    nome = descricao[idx:].strip()
                    break

            result.append(BankStatement(
                association_id=association_id,
                bank="cora",
                date=dt,
                amount=valor_dec,
                name=normalize_name(nome) if nome else normalize_name(descricao),
                cpf=None,
                tipo="entrada",
                description=descricao,
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

        # Get income transactions from open/recent sessions
        tx_q = await self._session.execute(
            text("""
                SELECT t.id, t.amount, t.description, t.transaction_at,
                       r.full_name, r.cpf
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

        automatico = []
        sugestao = []
        pendente = []

        for stmt in statements:
            best_score = 0
            best_tx = None
            matches = []

            for tx in transactions:
                tx_id, tx_amount, tx_desc, tx_at, res_name, res_cpf = tx
                score = 0

                # CPF match (priority)
                if stmt.cpf and res_cpf and clean_cpf(res_cpf) == stmt.cpf:
                    score += 100

                # Name similarity
                if stmt.name and res_name:
                    norm_res = normalize_name(res_name)
                    # Simple: check if any word matches
                    stmt_words = set(stmt.name.split())
                    res_words = set(norm_res.split())
                    if stmt_words & res_words:
                        score += 60

                # Amount match
                if Decimal(str(tx_amount)) == stmt.amount:
                    score += 50

                # Date proximity (within 1 day)
                tx_date = tx_at.date() if hasattr(tx_at, 'date') else date.fromisoformat(str(tx_at)[:10])
                if abs((stmt.date - tx_date).days) <= 1:
                    score += 20

                if score > 0:
                    matches.append((score, tx_id, tx_desc))
                    if score > best_score:
                        best_score = score
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
