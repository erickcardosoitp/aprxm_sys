import random
import string
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from uuid import UUID

import httpx
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.exceptions import CashSessionError, NotFoundError, UnprocessableError
from app.models.finance import CashSession, CashSessionStatus, IncomeSubtype, Transaction, TransactionType


class FinanceService:
    """Handles all business logic for APRXM Finance module."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Cash Session
    # ------------------------------------------------------------------

    async def open_session(
        self,
        association_id: UUID,
        opened_by: UUID,
        opening_balance: Decimal = Decimal("0.00"),
        notes: str | None = None,
    ) -> CashSession:
        await self._assert_no_open_session(association_id)

        session = CashSession(
            association_id=association_id,
            opened_by=opened_by,
            opening_balance=opening_balance,
            notes=notes,
            origin="Sessão de Caixa",
        )
        self._session.add(session)
        await self._session.flush()
        return session

    async def create_manual_session(
        self,
        association_id: UUID,
        created_by: UUID,
        opening_balance: Decimal,
        closing_balance: Decimal,
        opened_at: datetime,
        closed_at: datetime,
        notes: str | None = None,
        manual_pix: Decimal | None = None,
        manual_dinheiro: Decimal | None = None,
        manual_total_bruto: Decimal | None = None,
        manual_total_baixas: Decimal | None = None,
        operated_by: UUID | None = None,
        reviewed_by: UUID | None = None,
    ) -> CashSession:
        pix = manual_pix or Decimal("0")
        dinheiro = manual_dinheiro or Decimal("0")
        bruto = pix + dinheiro
        baixas = manual_total_baixas or Decimal("0")
        liquido = bruto - baixas
        expected = opening_balance + liquido
        diff = closing_balance - expected
        quebra = liquido - closing_balance  # + = sobra, - = falta
        session = CashSession(
            association_id=association_id,
            opened_by=operated_by or created_by,
            closed_by=created_by,
            reviewed_by=reviewed_by,
            status=CashSessionStatus.closed,
            opening_balance=opening_balance,
            closing_balance=closing_balance,
            expected_balance=expected,
            difference=diff,
            quebra_caixa=quebra,
            notes=notes,
            origin="Manual",
            opened_at=opened_at,
            closed_at=closed_at,
            manual_pix=pix,
            manual_dinheiro=dinheiro,
            manual_total_bruto=bruto,
            manual_total_baixas=manual_total_baixas,
        )
        self._session.add(session)
        await self._session.flush()
        return session

    async def get_open_session(self, association_id: UUID) -> CashSession:
        stmt = select(CashSession).where(
            CashSession.association_id == association_id,
            CashSession.status == CashSessionStatus.open,
        )
        result = await self._session.execute(stmt)
        session = result.scalar_one_or_none()
        if not session:
            raise CashSessionError("Nenhuma sessão de caixa aberta.")
        return session

    async def close_session(
        self,
        association_id: UUID,
        closed_by: UUID,
        closing_balance: Decimal,
        notes: str | None = None,
        reviewed_by: UUID | None = None,
    ) -> CashSession:
        session = await self.get_open_session(association_id)

        expected, bruto, baixas = await self._compute_expected_balance(session)
        liquido = bruto - baixas
        session.expected_balance = expected
        session.closing_balance = closing_balance
        session.difference = closing_balance - expected
        session.quebra_caixa = liquido - closing_balance  # + = sobra, - = falta
        session.status = CashSessionStatus.closed
        session.closed_by = closed_by
        session.closed_at = datetime.utcnow()
        session.notes = notes or session.notes
        session.updated_at = datetime.utcnow()
        if reviewed_by:
            session.reviewed_by = reviewed_by

        self._session.add(session)
        return session

    async def _compute_expected_balance(self, cash_session: CashSession) -> tuple[Decimal, Decimal, Decimal]:
        """Returns (expected_balance, total_bruto, total_baixas)"""
        stmt = select(Transaction).where(Transaction.cash_session_id == cash_session.id)
        result = await self._session.execute(stmt)
        transactions = result.scalars().all()

        bruto = Decimal("0")
        baixas = Decimal("0")
        balance = cash_session.opening_balance
        for tx in transactions:
            if tx.type == TransactionType.income:
                balance += tx.amount
                bruto += tx.amount
            elif tx.type == TransactionType.expense:
                if tx.approval_status == "approved":
                    balance -= tx.amount
            else:
                balance -= tx.amount
                baixas += tx.amount
        return balance, bruto, baixas

    async def _assert_no_open_session(self, association_id: UUID) -> None:
        stmt = select(CashSession).where(
            CashSession.association_id == association_id,
            CashSession.status == CashSessionStatus.open,
        )
        result = await self._session.execute(stmt)
        if result.scalar_one_or_none():
            raise CashSessionError("Já existe uma sessão de caixa aberta.")

    # ------------------------------------------------------------------
    # Transactions
    # ------------------------------------------------------------------

    async def register_transaction(
        self,
        association_id: UUID,
        cash_session_id: UUID,
        tx_type: TransactionType,
        amount: Decimal,
        description: str,
        created_by: UUID,
        income_subtype: IncomeSubtype | None = None,
        category_id: UUID | None = None,
        payment_method_id: UUID | None = None,
        resident_id: UUID | None = None,
        reference_number: str | None = None,
        package_id: UUID | None = None,
    ) -> Transaction:
        # Expense transactions require approval before affecting balance
        approval_status = "pending" if tx_type == TransactionType.expense else None

        tx = Transaction(
            association_id=association_id,
            cash_session_id=cash_session_id,
            category_id=category_id,
            payment_method_id=payment_method_id,
            resident_id=resident_id,
            type=tx_type,
            income_subtype=income_subtype,
            amount=amount,
            description=description,
            reference_number=reference_number,
            package_id=package_id,
            created_by=created_by,
            approval_status=approval_status,
        )
        self._session.add(tx)
        await self._session.flush()
        return tx

    async def perform_sangria(
        self,
        association_id: UUID,
        opened_by: UUID,
        amount: Decimal,
        reason: str,
        destination: str,
        receipt_photo_url: str,
        category_id: UUID | None = None,
    ) -> Transaction:
        """
        Perform a sangria (cash withdrawal) from the open session.
        Requires: amount, category, reason, destination and a receipt photo URL.
        """
        if not receipt_photo_url:
            raise CashSessionError("Foto do recibo é obrigatória para realizar uma sangria.")

        session = await self.get_open_session(association_id)

        tx = Transaction(
            association_id=association_id,
            cash_session_id=session.id,
            category_id=category_id,
            type=TransactionType.sangria,
            amount=amount,
            description=f"Sangria: {reason}",
            is_sangria=True,
            sangria_reason=reason,
            sangria_destination=destination,
            receipt_photo_url=receipt_photo_url,
            created_by=opened_by,
        )
        self._session.add(tx)
        await self._session.flush()
        return tx

    async def reverse_transaction(
        self,
        transaction_id: UUID,
        association_id: UUID,
        reversed_by: UUID,
        reason: str,
    ) -> Transaction:
        stmt = select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.association_id == association_id,
        )
        result = await self._session.execute(stmt)
        original = result.scalar_one_or_none()
        if not original:
            raise NotFoundError("Transação")
        if original.is_reversal:
            raise CashSessionError("Não é possível estornar um estorno.")
        if original.reversed_at is not None:
            raise CashSessionError("Transação já foi estornada.")

        cash_session = await self.get_open_session(association_id)

        # Inverse type: income → expense, expense/sangria → income
        inverse_type = (
            TransactionType.expense if original.type == TransactionType.income
            else TransactionType.income
        )

        reversal = Transaction(
            association_id=association_id,
            cash_session_id=cash_session.id,
            type=inverse_type,
            amount=original.amount,
            description=f"Estorno: {original.description}",
            is_reversal=True,
            reversal_of_id=original.id,
            reversal_reason=reason,
            created_by=reversed_by,
        )
        self._session.add(reversal)

        original.reversed_by = reversed_by
        original.reversed_at = datetime.utcnow()
        original.updated_at = datetime.utcnow()
        self._session.add(original)

        await self._session.flush()
        return reversal

    async def get_resident_payment_history(
        self, association_id: UUID, resident_id: UUID
    ) -> dict:
        from sqlmodel import select as sa_select
        from app.models.resident import Resident

        # Load resident for monthly_payment_day
        res_stmt = sa_select(Resident).where(
            Resident.id == resident_id,
            Resident.association_id == association_id,
        )
        res_result = await self._session.execute(res_stmt)
        resident = res_result.scalar_one_or_none()

        # All mensalidade transactions for this resident
        stmt = (
            sa_select(Transaction)
            .where(
                Transaction.association_id == association_id,
                Transaction.resident_id == resident_id,
                Transaction.income_subtype == IncomeSubtype.mensalidade,
            )
            .order_by(Transaction.transaction_at.desc())
        )
        result = await self._session.execute(stmt)
        payments = list(result.scalars().all())

        now = datetime.utcnow()
        last_payment_at = payments[0].transaction_at if payments else None
        payment_day = resident.monthly_payment_day if resident else None

        # Inadimplência: sem pagamento no mês corrente após o dia de vencimento
        current_month_paid = any(
            p.transaction_at.year == now.year and p.transaction_at.month == now.month
            for p in payments
        )
        is_delinquent = (
            not current_month_paid
            and payment_day is not None
            and now.day > payment_day
        )

        return {
            "resident_id": str(resident_id),
            "monthly_payment_day": payment_day,
            "total_payments": len(payments),
            "last_payment_at": str(last_payment_at) if last_payment_at else None,
            "current_month_paid": current_month_paid,
            "is_delinquent": is_delinquent,
            "payments": [
                {
                    "id": str(p.id),
                    "amount": str(p.amount),
                    "description": p.description,
                    "transaction_at": str(p.transaction_at),
                    "reference_number": p.reference_number,
                }
                for p in payments
            ],
        }

    async def list_pending_approvals(self, association_id: UUID) -> list[dict]:
        from sqlalchemy import text as sa_text
        result = await self._session.execute(
            sa_text("""
                SELECT t.id, t.amount, t.description, t.category_id,
                       t.transaction_at, t.created_by, u.full_name AS creator_name,
                       c.name AS category_name
                FROM transactions t
                JOIN users u ON u.id = t.created_by
                LEFT JOIN transaction_categories c ON c.id = t.category_id
                WHERE t.association_id = :aid
                  AND t.type = 'expense'
                  AND t.approval_status = 'pending'
                ORDER BY t.transaction_at ASC
            """),
            {"aid": str(association_id)},
        )
        rows = result.fetchall()
        return [
            {
                "id": str(r[0]),
                "amount": str(r[1]),
                "description": r[2],
                "category_id": str(r[3]) if r[3] else None,
                "transaction_at": str(r[4]),
                "created_by": str(r[5]),
                "creator_name": r[6],
                "category_name": r[7],
                "approval_status": "pending",
            }
            for r in rows
        ]

    async def approve_transaction(
        self,
        transaction_id: UUID,
        association_id: UUID,
        approved_by: UUID,
        signature_url: str | None = None,
    ) -> Transaction:
        stmt = select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.association_id == association_id,
        )
        result = await self._session.execute(stmt)
        tx = result.scalar_one_or_none()
        if not tx:
            raise NotFoundError("Transação")
        if tx.approval_status != "pending":
            from app.core.exceptions import UnprocessableError
            raise UnprocessableError("Transação não está pendente de aprovação.")
        tx.approval_status = "approved"
        tx.approved_by = approved_by
        tx.approved_at = datetime.utcnow()
        tx.approval_signature_url = signature_url
        tx.updated_at = datetime.utcnow()
        self._session.add(tx)
        await self._session.flush()
        return tx

    async def reject_transaction(
        self,
        transaction_id: UUID,
        association_id: UUID,
        rejected_by: UUID,
        reason: str,
    ) -> Transaction:
        stmt = select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.association_id == association_id,
        )
        result = await self._session.execute(stmt)
        tx = result.scalar_one_or_none()
        if not tx:
            raise NotFoundError("Transação")
        if tx.approval_status != "pending":
            from app.core.exceptions import UnprocessableError
            raise UnprocessableError("Transação não está pendente de aprovação.")
        tx.approval_status = "rejected"
        tx.rejection_reason = reason
        tx.updated_at = datetime.utcnow()
        self._session.add(tx)
        await self._session.flush()
        return tx

    # ------------------------------------------------------------------
    # Comprovante de Residência
    # ------------------------------------------------------------------

    async def issue_proof_of_residence(
        self,
        association_id: UUID,
        issued_by: UUID,
        resident_name: str,
        resident_cpf: str,
        resident_neighborhood: str,
        resident_cep: str,
        amount: Decimal,
        payment_method_id: UUID | None = None,
        category_id: UUID | None = None,
        resident_id: UUID | None = None,
    ) -> tuple[Transaction, bytes]:
        # Load settings
        row = (await self._session.execute(
            sa_text("""
                SELECT assoc_logo_url, president_signature_url, president_name,
                       community_name, proof_stock, assoc_address, assoc_cep
                FROM association_settings WHERE association_id = :aid
            """),
            {"aid": str(association_id)},
        )).fetchone()

        if not row:
            raise UnprocessableError("Configurações da associação não encontradas. Configure no módulo Admin.")
        logo_url, sig_url, president_name, community_name, proof_stock, assoc_address, assoc_cep = row

        if not logo_url:
            raise UnprocessableError("Logo da associação não cadastrado. Configure no módulo Admin.")
        if not sig_url:
            raise UnprocessableError("Assinatura da presidente não cadastrada. Configure no módulo Admin.")
        if (proof_stock or 0) <= 0:
            raise UnprocessableError("Sem estoque de comprovantes disponível. Solicite reposição ao administrador.")

        # Get open session
        cash_session = await self.get_open_session(association_id)

        # Generate unique 8-digit barcode code
        barcode_code = "".join(random.choices(string.digits, k=8))

        # Register transaction
        tx = await self.register_transaction(
            association_id=association_id,
            cash_session_id=cash_session.id,
            tx_type=TransactionType.income,
            amount=amount,
            description=f"Comprovante de Residência — {resident_name}",
            created_by=issued_by,
            income_subtype=IncomeSubtype.proof_of_residence,
            payment_method_id=payment_method_id,
            category_id=category_id,
            resident_id=resident_id,
            reference_number=barcode_code,
        )

        # Decrement stock
        await self._session.execute(
            sa_text("UPDATE association_settings SET proof_stock = proof_stock - 1 WHERE association_id = :aid"),
            {"aid": str(association_id)},
        )

        # Download logo and signature
        async with httpx.AsyncClient(timeout=10) as client:
            logo_resp = await client.get(logo_url)
            sig_resp = await client.get(sig_url)
        if logo_resp.status_code != 200:
            raise UnprocessableError(f"Falha ao baixar logo ({logo_resp.status_code}). Verifique a URL no Admin.")
        if sig_resp.status_code != 200:
            raise UnprocessableError(f"Falha ao baixar assinatura ({sig_resp.status_code}). Verifique a URL no Admin.")
        logo_bytes = logo_resp.content
        sig_bytes = sig_resp.content

        # Generate barcode image
        barcode_bytes = self._build_barcode_image(barcode_code)

        # Generate PDF
        pdf_bytes = self._build_proof_pdf(
            resident_name=resident_name,
            resident_cpf=resident_cpf,
            resident_neighborhood=resident_neighborhood,
            resident_cep=resident_cep,
            community_name=community_name or "",
            assoc_address=assoc_address or "",
            assoc_cep=assoc_cep or "",
            president_name=president_name or "PRESIDENTE",
            logo_bytes=logo_bytes,
            sig_bytes=sig_bytes,
            barcode_code=barcode_code,
            barcode_bytes=barcode_bytes,
        )

        return tx, pdf_bytes

    @staticmethod
    def _build_barcode_image(code: str) -> bytes:
        from barcode import Code128  # type: ignore
        from barcode.writer import SVGWriter  # type: ignore

        buf = BytesIO()
        Code128(code, writer=SVGWriter()).write(buf, options={
            "module_height": 10.0,
            "module_width": 0.35,
            "quiet_zone": 2.0,
            "write_text": False,
        })
        buf.seek(0)
        return buf.read()

    @staticmethod
    def _build_proof_pdf(
        resident_name: str,
        resident_cpf: str,
        resident_neighborhood: str,
        resident_cep: str,
        community_name: str,
        assoc_address: str,
        assoc_cep: str,
        president_name: str,
        logo_bytes: bytes,
        sig_bytes: bytes,
        barcode_code: str = "",
        barcode_bytes: bytes = b"",
    ) -> bytes:
        from fpdf import FPDF  # type: ignore

        pdf = FPDF()
        pdf.add_page()
        pdf.set_margins(20, 20, 20)
        pdf.set_auto_page_break(auto=True, margin=20)

        # Barcode — canto superior direito
        if barcode_bytes:
            bc_io = BytesIO(barcode_bytes)
            bc_w = 45.0
            bc_x = pdf.w - pdf.r_margin - bc_w
            pdf.image(bc_io, x=bc_x, y=10, w=bc_w)
            pdf.set_font("Helvetica", size=8)
            pdf.set_text_color(80, 80, 80)
            pdf.set_xy(bc_x, 10 + 24)
            pdf.cell(bc_w, 4, barcode_code, align="C")

        # Logo centralizado
        logo_io = BytesIO(logo_bytes)
        pdf.image(logo_io, x=80, y=15, w=50)
        pdf.set_y(68)

        # Endereço da associação
        pdf.set_font("Helvetica", size=9)
        pdf.set_text_color(100, 100, 100)
        if assoc_address:
            pdf.cell(0, 5, assoc_address, ln=True, align="C")
        if assoc_cep:
            pdf.cell(0, 5, f"CEP: {assoc_cep}", ln=True, align="C")
        pdf.ln(8)

        # Linha separadora
        pdf.set_draw_color(200, 200, 200)
        pdf.line(20, pdf.get_y(), 190, pdf.get_y())
        pdf.ln(8)

        # Título
        pdf.set_font("Helvetica", "B", 15)
        pdf.set_text_color(26, 63, 111)
        pdf.cell(0, 10, "DECLARAÇÃO DE RESIDÊNCIA", ln=True, align="C")
        pdf.ln(6)

        # Corpo
        pdf.set_font("Helvetica", size=12)
        pdf.set_text_color(30, 30, 30)
        body = (
            f"O Sr(a) {resident_name}, portador(a) do CPF {resident_cpf}, "
            f"residente na comunidade {community_name}, CEP {resident_cep}, "
            f"localizado nesta comunidade no bairro de {resident_neighborhood}."
        )
        pdf.multi_cell(0, 8, body, align="J")
        pdf.ln(12)

        # Data
        now = datetime.utcnow()
        months = ["janeiro","fevereiro","março","abril","maio","junho",
                  "julho","agosto","setembro","outubro","novembro","dezembro"]
        date_str = f"Rio de Janeiro, {now.day} de {months[now.month - 1]} de {now.year}."
        pdf.set_font("Helvetica", size=12)
        pdf.cell(0, 8, date_str, ln=True, align="R")
        pdf.ln(10)

        pdf.set_font("Helvetica", size=11)
        pdf.cell(0, 7, "Atenciosamente,", ln=True, align="C")
        pdf.ln(4)

        # Assinatura
        sig_io = BytesIO(sig_bytes)
        page_w = pdf.w - pdf.l_margin - pdf.r_margin
        sig_w = 60.0
        sig_x = pdf.l_margin + (page_w - sig_w) / 2
        pdf.image(sig_io, x=sig_x, w=sig_w)
        pdf.ln(2)

        # Nome da presidente
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, president_name.upper(), ln=True, align="C")
        pdf.set_font("Helvetica", size=10)
        pdf.cell(0, 6, "PRESIDENTE", ln=True, align="C")

        return bytes(pdf.output())

    async def list_transactions(
        self, association_id: UUID, cash_session_id: UUID | None = None
    ) -> list[Transaction]:
        stmt = select(Transaction).where(Transaction.association_id == association_id)
        if cash_session_id:
            stmt = stmt.where(Transaction.cash_session_id == cash_session_id)
        stmt = stmt.order_by(Transaction.transaction_at.desc())
        result = await self._session.execute(stmt)
        return list(result.scalars().all())
