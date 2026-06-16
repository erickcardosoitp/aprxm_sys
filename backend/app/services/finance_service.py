import asyncio
import json
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

# Cache URL→bytes para logo/assinatura — TTL implícito: reinicia no cold start
_image_cache: dict[str, bytes] = {}

async def _fetch_image(url: str) -> bytes:
    if url in _image_cache:
        return _image_cache[url]
    from app.core.resilience import http_cb

    async def _do():
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(url)
        if r.status_code != 200:
            raise ValueError(f"HTTP {r.status_code}")
        return r.content

    content = await http_cb.call_async(_do)
    _image_cache[url] = content
    return content


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
        device_token: str | None = None,
    ) -> CashSession:
        from sqlmodel import select as _sel
        existing = await self._session.execute(
            _sel(CashSession).where(
                CashSession.association_id == association_id,
                CashSession.opened_by == opened_by,
                CashSession.closed_at == None,  # noqa: E711
            )
        )
        if existing.scalars().first():
            raise CashSessionError("Você já possui um caixa aberto. Feche-o antes de abrir outro.")

        session = CashSession(
            association_id=association_id,
            opened_by=opened_by,
            opening_balance=opening_balance,
            notes=notes,
            origin="Sessão de Caixa",
            device_token=device_token,
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

    async def get_open_session(self, association_id: UUID, session_id: UUID | None = None, preferred_by: UUID | None = None, strict_owner: bool = False) -> CashSession:
        stmt = select(CashSession).where(
            CashSession.association_id == association_id,
            CashSession.status == CashSessionStatus.open,
        )
        if session_id:
            stmt = stmt.where(CashSession.id == session_id)
        if preferred_by:
            user_stmt = stmt.where(CashSession.opened_by == preferred_by).order_by(CashSession.opened_at.desc())
            result = await self._session.execute(user_stmt)
            sess = result.scalars().first()
            if sess:
                return sess
            if strict_owner:
                raise CashSessionError("Você não possui uma sessão de caixa aberta.")
        stmt = stmt.order_by(CashSession.opened_at.desc())
        result = await self._session.execute(stmt)
        sess = result.scalars().first()
        if not sess:
            raise CashSessionError("Nenhuma sessão de caixa aberta.")
        return sess

    async def close_session(
        self,
        association_id: UUID,
        closed_by: UUID,
        closing_balance: Decimal,
        notes: str | None = None,
        reviewed_by: UUID | None = None,
        session_id: UUID | None = None,
        is_admin: bool = False,
        blind_pix: Decimal | None = None,
        blind_dinheiro: Decimal | None = None,
        troco_deixado: Decimal | None = None,
    ) -> CashSession:
        session = await self.get_open_session(
            association_id,
            session_id=session_id,
            preferred_by=None if session_id else closed_by,
        )
        if not is_admin and session.opened_by != closed_by:
            raise CashSessionError("Você só pode fechar o seu próprio caixa.")

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
        if blind_pix is not None:
            session.blind_pix = blind_pix
        if blind_dinheiro is not None:
            session.blind_dinheiro = blind_dinheiro
        if troco_deixado is not None:
            session.troco_deixado = troco_deixado

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
            if tx.reversed_at is not None or tx.is_reversal:
                continue
            # Exclude repasse sangrias from expected balance — they don't affect the
            # conference difference (money was already counted before the transfer).
            if tx.type == TransactionType.sangria and (tx.description or "").startswith("Repasse para caixinha"):
                continue
            if tx.type == TransactionType.income:
                balance += tx.amount
                bruto += tx.amount
            elif tx.type == TransactionType.expense:
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
        cash_session_id: UUID | None,
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
        is_acordo: bool = False,
        acordo_installments: int = 2,
        acordo_months: int = 1,
        payer_name: str | None = None,
        payer_entity_id: UUID | None = None,
        mensalidade_months: list[str] | None = None,
        signature_url: str | None = None,
    ) -> Transaction:
        from datetime import datetime as _dt
        is_expense = tx_type == TransactionType.expense

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
            approval_status="approved" if is_expense else None,
            approved_by=created_by if is_expense else None,
            approved_at=_dt.utcnow() if is_expense else None,
            approval_signature_url=signature_url if is_expense else None,
            payer_name=payer_name,
            payer_entity_id=payer_entity_id,
        )
        self._session.add(tx)
        await self._session.flush()

        # Auto-create/update mensalidade record when subtype is mensalidade
        if tx_type == TransactionType.income and income_subtype == IncomeSubtype.mensalidade and resident_id is not None:
            from app.models.mensalidade import Mensalidade, MensalidadeStatus
            from sqlmodel import select as sq_sel
            from datetime import date as dt_date, datetime as dt_dt
            now = datetime.utcnow()
            target_status = MensalidadeStatus.agreement if is_acordo else MensalidadeStatus.paid
            def _month_offset(base: datetime, offset: int) -> str:
                y, mo = base.year, base.month - offset
                while mo <= 0:
                    mo += 12; y -= 1
                return f"{y:04d}-{mo:02d}"
            # Explicit month list takes precedence over acordo_months offset
            if mensalidade_months:
                months_to_cover = sorted(set(mensalidade_months))
            else:
                months_to_cover = [_month_offset(now, i) for i in range(acordo_months - 1, -1, -1)]
            for ref_month in months_to_cover:
                existing = await self._session.execute(
                    sq_sel(Mensalidade).where(
                        Mensalidade.association_id == association_id,
                        Mensalidade.resident_id == resident_id,
                        Mensalidade.reference_month == ref_month,
                    )
                )
                mens = existing.scalar_one_or_none()
                if mens:
                    if mens.status != MensalidadeStatus.paid:
                        mens.status = target_status
                        mens.paid_at = now
                        mens.transaction_id = tx.id
                        self._session.add(mens)
                else:
                    yr, mo = int(ref_month[:4]), int(ref_month[5:])
                    due = dt_date(yr, mo, 10)
                    new_mens = Mensalidade(
                        association_id=association_id,
                        resident_id=resident_id,
                        reference_month=ref_month,
                        due_date=due,
                        amount=amount,
                        status=target_status,
                        paid_at=now,
                        transaction_id=tx.id,
                        created_by=created_by,
                    )
                    self._session.add(new_mens)

            if is_acordo:
                from app.models.porta_a_porta import PortaAPortaLead
                from app.models.resident import Resident as ResidentModel
                res_obj = await self._session.get(ResidentModel, resident_id)
                if res_obj:
                    ex_lead = (await self._session.execute(
                        select(PortaAPortaLead).where(
                            PortaAPortaLead.association_id == association_id,
                            PortaAPortaLead.resident_id == resident_id,
                            PortaAPortaLead.status != "cancelled",
                        )
                    )).scalar_one_or_none()
                    if ex_lead:
                        ex_lead.status = "agreement"
                        ex_lead.updated_at = datetime.utcnow()
                        self._session.add(ex_lead)
                    else:
                        self._session.add(PortaAPortaLead(
                            association_id=association_id,
                            operator_id=created_by,
                            full_name=res_obj.full_name,
                            phone=res_obj.phone_primary,
                            cpf=res_obj.cpf,
                            address_street=res_obj.address_street or "—",
                            address_number=res_obj.address_number or "—",
                            payment_type="parcelado",
                            total_installments=acordo_installments,
                            monthly_fee=amount,
                            status="agreement",
                            resident_id=resident_id,
                        ))

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

        session = await self.get_open_session(association_id, preferred_by=opened_by)
        if session.opened_by != opened_by:
            raise CashSessionError("Você só pode realizar sangria no seu próprio caixa.")

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
        cash_session_id: UUID | None = None,
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

        if cash_session_id:
            cs_result = await self._session.execute(select(CashSession).where(CashSession.id == cash_session_id))
            cash_session = cs_result.scalar_one_or_none()
            if not cash_session or cash_session.status != CashSessionStatus.open:
                cash_session = await self.get_open_session(association_id, preferred_by=reversed_by)
        else:
            cash_session = await self.get_open_session(association_id, preferred_by=reversed_by)

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
        resident_address_street: str = "",
        resident_address_number: str = "",
        resident_address_complement: str = "",
        isento: bool = False,
        payment_method_id: UUID | None = None,
        category_id: UUID | None = None,
        resident_id: UUID | None = None,
        cash_session_id: UUID | None = None,
    ) -> tuple[Transaction | None, bytes]:
        # Load settings
        row = (await self._session.execute(
            sa_text("""
                SELECT s.assoc_logo_url, s.president_signature_url, s.president_name,
                       s.community_name, s.proof_stock, s.assoc_address, s.assoc_cep,
                       a.name
                FROM association_settings s
                JOIN associations a ON a.id = s.association_id
                WHERE s.association_id = :aid
            """),
            {"aid": str(association_id)},
        )).fetchone()

        if not row:
            raise UnprocessableError("Configurações da associação não encontradas. Configure no módulo Admin.")
        logo_url, sig_url, president_name, community_name, proof_stock, assoc_address, assoc_cep, assoc_name = row

        if not logo_url:
            raise UnprocessableError("Logo da associação não cadastrado. Configure no módulo Admin.")
        # sig_url opcional — comprovante provisório sem assinatura
        if (proof_stock or 0) <= 0:
            raise UnprocessableError("Sem estoque de comprovantes disponível. Solicite reposição ao administrador.")

        # Generate unique 8-digit barcode code
        barcode_code = "".join(random.choices(string.digits, k=8))

        # Fetch cash session for both exempt and non-exempt paths
        if cash_session_id:
            cash_session = await self.get_open_session(association_id, session_id=cash_session_id)
        else:
            cash_session = await self.get_open_session(association_id, preferred_by=issued_by, strict_owner=True)

        import json as _json
        _label = "Comprovante de Residência" + (" (Isento)" if isento else "")
        _desc = _json.dumps({
            "label": _label,
            "name": resident_name,
            "cpf": resident_cpf,
            "neighborhood": resident_neighborhood,
            "cep": resident_cep,
            "street": resident_address_street,
            "number": resident_address_number,
            "complement": resident_address_complement,
        }, ensure_ascii=False)

        if isento:
            tx = await self.register_transaction(
                association_id=association_id,
                cash_session_id=cash_session.id,
                tx_type=TransactionType.income,
                amount=Decimal("0.00"),
                description=_desc,
                created_by=issued_by,
                income_subtype=IncomeSubtype.proof_of_residence,
                payment_method_id=payment_method_id,
                category_id=category_id,
                resident_id=resident_id,
                reference_number=barcode_code,
            )
        else:
            tx = await self.register_transaction(
                association_id=association_id,
                cash_session_id=cash_session.id,
                tx_type=TransactionType.income,
                amount=amount,
                description=_desc,
                created_by=issued_by,
                income_subtype=IncomeSubtype.proof_of_residence,
                payment_method_id=payment_method_id,
                category_id=category_id,
                resident_id=resident_id,
                reference_number=barcode_code,
            )

        # Sync address back to resident profile
        if resident_id:
            update_fields = []
            update_params: dict = {"rid": str(resident_id), "aid": str(association_id)}
            if resident_address_street:
                update_fields.append("address_street = :street")
                update_params["street"] = resident_address_street
            if resident_address_number:
                update_fields.append("address_number = :number")
                update_params["number"] = resident_address_number
            if resident_address_complement:
                update_fields.append("address_complement = :complement")
                update_params["complement"] = resident_address_complement
            if resident_neighborhood:
                update_fields.append("address_neighborhood = :neighborhood")
                update_params["neighborhood"] = resident_neighborhood
            if resident_cep:
                update_fields.append("address_cep = :cep")
                update_params["cep"] = resident_cep
            if update_fields:
                await self._session.execute(
                    sa_text(f"UPDATE residents SET {', '.join(update_fields)} WHERE id = :rid AND association_id = :aid"),
                    update_params,
                )

        # Decrement stock
        await self._session.execute(
            sa_text("UPDATE association_settings SET proof_stock = proof_stock - 1 WHERE association_id = :aid"),
            {"aid": str(association_id)},
        )

        # Download logo
        results = await asyncio.gather(
            _fetch_image(logo_url),
            return_exceptions=True,
        )
        if isinstance(results[0], Exception):
            raise UnprocessableError(f"Falha ao baixar logo ({results[0]}). Verifique a URL no Admin.")
        logo_bytes = results[0]

        # Generate barcode image
        barcode_bytes = self._build_barcode_image(barcode_code)

        # Generate PDF
        pdf_bytes = self._build_proof_pdf(
            resident_name=resident_name,
            resident_cpf=resident_cpf,
            resident_neighborhood=resident_neighborhood,
            resident_cep=resident_cep,
            resident_address_street=resident_address_street,
            resident_address_number=resident_address_number,
            resident_address_complement=resident_address_complement,
            community_name=community_name or "",
            assoc_name=assoc_name or "",
            assoc_address=assoc_address or "",
            assoc_cep=assoc_cep or "",
            logo_bytes=logo_bytes,
            barcode_code=barcode_code,
            barcode_bytes=barcode_bytes,
        )

        return tx, pdf_bytes

    @staticmethod
    def _build_barcode_image(code: str) -> bytes:
        from barcode import Code128  # type: ignore
        from barcode.writer import ImageWriter  # type: ignore

        buf = BytesIO()
        Code128(code, writer=ImageWriter()).write(buf, options={
            "module_height": 6.0,
            "module_width": 0.18,
            "quiet_zone": 1.5,
            "write_text": False,
            "dpi": 150,
        })
        return buf.getvalue()

    @staticmethod
    def _build_proof_pdf(
        resident_name: str,
        resident_cpf: str,
        resident_neighborhood: str,
        resident_cep: str,
        community_name: str,
        assoc_name: str,
        assoc_address: str,
        assoc_cep: str,
        logo_bytes: bytes,
        resident_address_street: str = "",
        resident_address_number: str = "",
        resident_address_complement: str = "",
        barcode_code: str = "",
        barcode_bytes: bytes = b"",
    ) -> bytes:
        from fpdf import FPDF  # type: ignore

        def _safe(s: str) -> str:
            return s.encode("latin-1", errors="replace").decode("latin-1")

        resident_name = _safe(resident_name)
        resident_cpf = _safe(resident_cpf)
        resident_neighborhood = _safe(resident_neighborhood)
        resident_cep = _safe(resident_cep)
        resident_address_street = _safe(resident_address_street)
        resident_address_number = _safe(resident_address_number)
        resident_address_complement = _safe(resident_address_complement)
        community_name = _safe(community_name)
        assoc_address = _safe(assoc_address)

        pdf = FPDF()
        pdf.add_page()
        pdf.set_margins(20, 20, 20)
        pdf.set_auto_page_break(auto=True, margin=20)

        # Barcode — canto superior direito (PNG, 28 mm de largura)
        if barcode_bytes:
            from PIL import Image as _PILImage  # type: ignore
            bc_w = 28.0
            bc_x = pdf.w - pdf.r_margin - bc_w
            bc_y = 10.0
            _pil = _PILImage.open(BytesIO(barcode_bytes))
            bc_h = bc_w * _pil.height / _pil.width
            pdf.image(BytesIO(barcode_bytes), x=bc_x, y=bc_y, w=bc_w, h=bc_h)
            pdf.set_font("Helvetica", size=6)
            pdf.set_text_color(80, 80, 80)
            pdf.set_xy(bc_x, bc_y + bc_h + 0.5)
            pdf.cell(bc_w, 3, barcode_code, align="C")

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
        addr_parts = []
        if resident_address_street:
            addr_parts.append(resident_address_street)
        if resident_address_number:
            addr_parts.append(f"nº {resident_address_number}")
        if resident_address_complement:
            addr_parts.append(resident_address_complement)
        if resident_cep:
            addr_parts.append(f"CEP {resident_cep}")
        addr_str = ", ".join(addr_parts) if addr_parts else f"CEP {resident_cep}"
        body = (
            f"O Sr(a) {resident_name}, portador(a) do CPF {resident_cpf}, "
            f"residente na comunidade {community_name}, em {addr_str}, "
            f"localizado no bairro de {resident_neighborhood}."
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

        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(26, 63, 111)
        pdf.cell(0, 8, _safe(assoc_name).upper(), ln=True, align="C")

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

    # ------------------------------------------------------------------
    # Cash Box Operations
    # ------------------------------------------------------------------

    async def credit_cash_box(
        self,
        association_id: UUID,
        cash_box_id: UUID,
        amount: Decimal,
        description: str,
        created_by: UUID,
    ) -> Decimal:
        """Credits a cash box and records the movement. Returns new balance."""
        row = (await self._session.execute(
            sa_text("SELECT id, balance FROM cash_boxes WHERE id=:id AND association_id=:aid AND is_active=true"),
            {"id": str(cash_box_id), "aid": str(association_id)},
        )).fetchone()
        if not row:
            from app.core.exceptions import NotFoundError
            raise NotFoundError("Caixinha")
        new_bal = Decimal(str(row[1])) + amount
        await self._session.execute(
            sa_text("UPDATE cash_boxes SET balance=:b, updated_at=NOW() WHERE id=:id"),
            {"b": str(new_bal), "id": str(cash_box_id)},
        )
        await self._session.execute(
            sa_text("""
                INSERT INTO cash_box_movements
                    (id, association_id, cash_box_id, amount, movement_type, description, created_by)
                VALUES (gen_random_uuid(), :aid, :bid, :amt, 'credit', :desc, :usr)
            """),
            {"aid": str(association_id), "bid": str(cash_box_id),
             "amt": str(amount), "desc": description, "usr": str(created_by)},
        )
        return new_bal

    async def send_to_malote(
        self,
        session_id: UUID,
        association_id: UUID,
        sent_by: UUID,
    ) -> dict:
        """Transfers closing_balance from a closed session to the malote cash box."""
        cs = (await self._session.execute(
            sa_text("SELECT status, closing_balance, malote_sent_at FROM cash_sessions WHERE id=:id AND association_id=:aid"),
            {"id": str(session_id), "aid": str(association_id)},
        )).fetchone()
        if not cs:
            from app.core.exceptions import NotFoundError
            raise NotFoundError("Sessão")
        if cs[0] != "closed":
            from app.core.exceptions import UnprocessableError
            raise UnprocessableError("Sessão deve estar fechada.")
        if cs[2] is not None:
            from app.core.exceptions import UnprocessableError
            raise UnprocessableError("Dinheiro já enviado para o malote.")
        if cs[1] is None or Decimal(str(cs[1])) <= 0:
            from app.core.exceptions import UnprocessableError
            raise UnprocessableError("Valor de fechamento (conf. cega) inválido.")

        malote = (await self._session.execute(
            sa_text("SELECT id, balance FROM cash_boxes WHERE association_id=:aid AND is_malote=true AND is_active=true ORDER BY created_at LIMIT 1"),
            {"aid": str(association_id)},
        )).fetchone()
        if not malote:
            from app.core.exceptions import NotFoundError
            raise NotFoundError("Caixinha malote")

        amount = Decimal(str(cs[1]))
        new_bal = await self.credit_cash_box(
            association_id=association_id,
            cash_box_id=malote[0],
            amount=amount,
            description=f"Malote — sessão {str(session_id)[:8]}",
            created_by=sent_by,
        )
        await self._session.execute(
            sa_text("UPDATE cash_sessions SET malote_sent_at=NOW() WHERE id=:id AND association_id=:aid"),
            {"id": str(session_id), "aid": str(association_id)},
        )
        return {"ok": True, "amount": str(amount), "malote_balance": str(new_bal)}

    # ------------------------------------------------------------------
    # Read-heavy queries (extracted from router)
    # ------------------------------------------------------------------

    async def list_sessions(self, association_id: UUID, user_id: UUID, is_conferente: bool) -> list[dict]:
        uid_filter = "" if is_conferente else "AND cs.opened_by = :uid"
        params: dict = {"aid": str(association_id)}
        if not is_conferente:
            params["uid"] = str(user_id)
        result = await self._session.execute(
            sa_text(f"""
                SELECT
                    cs.id, cs.status, cs.opened_at, cs.closed_at,
                    cs.opening_balance, cs.closing_balance, cs.expected_balance, cs.difference,
                    u_open.full_name AS operador_name, u_close.full_name AS fechado_por,
                    u_review.full_name AS conferido_por, cs.origin, a.name AS association_name,
                    cs.quebra_caixa, cs.malote_sent_at, cs.quebra_responsavel,
                    cs.quebra_assinatura_url, cs.quebra_apurada_at,
                    CASE WHEN cs.origin = 'Manual' THEN COALESCE(cs.manual_pix, 0)
                         ELSE COALESCE(SUM(CASE WHEN t.type = 'income'
                              AND (t.reversed_at IS NULL AND t.is_reversal = false)
                              AND pm.name ILIKE '%pix%' THEN t.amount ELSE 0 END), 0)
                    END AS total_pix,
                    CASE WHEN cs.origin = 'Manual' THEN COALESCE(cs.manual_dinheiro, 0)
                         ELSE COALESCE(SUM(CASE WHEN t.type = 'income'
                              AND (t.reversed_at IS NULL AND t.is_reversal = false)
                              AND (pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%'
                                   OR pm.name ILIKE '%especie%' OR t.payment_method_id IS NULL)
                              THEN t.amount ELSE 0 END), 0)
                    END AS total_dinheiro,
                    CASE WHEN cs.origin = 'Manual' THEN COALESCE(cs.manual_total_bruto, 0)
                         ELSE COALESCE(SUM(CASE WHEN t.type = 'income'
                              AND (t.reversed_at IS NULL AND t.is_reversal = false)
                              THEN t.amount ELSE 0 END), 0)
                    END AS total_bruto,
                    CASE WHEN cs.origin = 'Manual' THEN COALESCE(cs.manual_total_baixas, 0)
                         ELSE COALESCE(SUM(CASE WHEN t.type = 'sangria'
                              AND (t.reversed_at IS NULL AND t.is_reversal = false)
                              THEN t.amount ELSE 0 END), 0)
                    END AS total_baixas,
                    COALESCE(SUM(CASE WHEN t.type = 'expense'
                         AND (t.reversed_at IS NULL AND t.is_reversal = false)
                         THEN t.amount ELSE 0 END), 0) AS total_expense
                FROM cash_sessions cs
                LEFT JOIN users u_open   ON u_open.id   = cs.opened_by
                LEFT JOIN users u_close  ON u_close.id  = cs.closed_by
                LEFT JOIN users u_review ON u_review.id = cs.reviewed_by
                LEFT JOIN associations a ON a.id = cs.association_id
                LEFT JOIN transactions t
                    ON t.cash_session_id = cs.id AND t.association_id = cs.association_id
                LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
                WHERE cs.association_id = :aid {uid_filter}
                GROUP BY cs.id, cs.status, cs.opened_at, cs.closed_at,
                         cs.opening_balance, cs.closing_balance, cs.expected_balance,
                         cs.difference, u_open.full_name, u_close.full_name, u_review.full_name,
                         cs.origin, a.name, cs.quebra_caixa, cs.malote_sent_at, cs.manual_pix,
                         cs.manual_dinheiro, cs.manual_total_bruto, cs.manual_total_baixas,
                         cs.quebra_responsavel, cs.quebra_assinatura_url, cs.quebra_apurada_at
                ORDER BY cs.opened_at DESC
            """),
            params,
        )
        rows = result.fetchall()
        return [
            {
                "id": str(r[0]), "status": r[1],
                "opened_at": str(r[2]), "closed_at": str(r[3]) if r[3] else None,
                "opening_balance": str(r[4]),
                "closing_balance": str(r[5]) if r[5] is not None else None,
                "expected_balance": str(r[6]) if r[6] is not None else None,
                "difference": str(r[7]) if r[7] is not None else None,
                "operador_name": r[8], "fechado_por": r[9], "conferido_por": r[10],
                "origin": r[11] or "Sessão de Caixa",
                "association_name": r[12],
                "quebra_caixa": str(round(float(r[13]), 2)) if r[13] is not None else None,
                "malote_sent_at": str(r[14]) if r[14] is not None else None,
                "quebra_responsavel": r[15], "quebra_assinatura_url": r[16],
                "quebra_apurada_at": str(r[17]) if r[17] is not None else None,
                "total_pix": str(round(float(r[18]), 2)),
                "total_dinheiro": str(round(float(r[19]), 2)),
                "total_bruto": str(round(float(r[20]), 2)),
                "total_baixas": str(round(float(r[21]), 2)),
                "total_expense": str(round(float(r[22]), 2)),
            }
            for r in rows
        ]

    async def get_tesouraria(self, association_id: UUID) -> dict:
        aid = str(association_id)
        open_rows = (await self._session.execute(sa_text("""
            SELECT cs.id, cs.opened_at, cs.opening_balance, u.full_name AS operador,
                   COALESCE(cs.opening_balance, 0)
                   + COALESCE((SELECT SUM(t.amount) FROM transactions t
                               WHERE t.cash_session_id=cs.id AND t.type='income'
                                 AND t.reversed_at IS NULL AND t.is_reversal=false), 0)
                   - COALESCE((SELECT SUM(t.amount) FROM transactions t
                               WHERE t.cash_session_id=cs.id AND t.type IN ('expense','sangria')
                                 AND t.reversed_at IS NULL AND t.is_reversal=false), 0) AS expected
              FROM cash_sessions cs
              LEFT JOIN users u ON u.id = cs.opened_by
             WHERE cs.association_id=:aid AND cs.status='open'
             ORDER BY cs.opened_at DESC
        """), {"aid": aid})).fetchall()

        conf_rows = (await self._session.execute(sa_text("""
            SELECT cs.id, cs.opened_at, cs.closing_balance, cs.expected_balance,
                   cs.difference, u.full_name AS operador,
                   COALESCE((SELECT SUM(t.amount) FROM transactions t
                              WHERE t.association_id = cs.association_id AND t.type = 'sangria'
                                AND t.description = CONCAT('Repasse para caixinha — sessão ', cs.id::text)
                                AND t.reversed_at IS NULL AND t.is_reversal = false), 0) AS already_transferred,
                   COALESCE((SELECT SUM(t.amount) FROM transactions t
                             JOIN payment_methods pm ON pm.id = t.payment_method_id
                              WHERE t.cash_session_id = cs.id AND t.type = 'income'
                                AND pm.name ILIKE '%%pix%%'
                                AND t.reversed_at IS NULL AND t.is_reversal = false), 0) AS total_pix_income
              FROM cash_sessions cs
              LEFT JOIN users u ON u.id = cs.opened_by
             WHERE cs.association_id=:aid AND cs.status='conferido'
             ORDER BY cs.opened_at DESC
        """), {"aid": aid})).fetchall()

        pap_row = (await self._session.execute(sa_text("""
            SELECT COALESCE(SUM(p.amount),0), COUNT(*)
              FROM porta_a_porta_payments p
              JOIN porta_a_porta_leads l ON l.id = p.lead_id
             WHERE l.association_id=:aid AND p.status='paid'
               AND DATE(p.paid_at) = CURRENT_DATE
               AND NOT EXISTS (
                   SELECT 1 FROM transactions t
                   WHERE t.description LIKE '%Porta a Porta%'
                     AND t.association_id=:aid
                     AND DATE(t.transaction_at) = CURRENT_DATE
                     AND t.amount = p.amount
               )
        """), {"aid": aid})).fetchone()

        boxes = (await self._session.execute(sa_text(
            "SELECT id, name, balance FROM cash_boxes WHERE association_id=:aid AND is_active=true ORDER BY name"
        ), {"aid": aid})).fetchall()

        faturamento_row = (await self._session.execute(sa_text("""
            SELECT
              COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END), 0) AS bruto,
              COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS saidas
            FROM transactions t
            WHERE t.association_id=:aid AND t.reversed_at IS NULL AND t.is_reversal=false
              AND DATE(t.transaction_at) = CURRENT_DATE
        """), {"aid": aid})).fetchone()
        faturamento = round(float(faturamento_row[0]) - float(faturamento_row[1]), 2) if faturamento_row else 0.0

        box_breakdown_rows = (await self._session.execute(sa_text("""
            SELECT cbm.cash_box_id, COALESCE(pm.name, 'Dinheiro') AS pm_name,
                   SUM(CASE WHEN cbm.movement_type='credit' THEN cbm.amount ELSE -cbm.amount END) AS total
              FROM cash_box_movements cbm
              LEFT JOIN transactions t ON t.description = cbm.description
                AND t.association_id = cbm.association_id
              LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
             WHERE cbm.association_id=:aid AND cbm.movement_type='credit'
             GROUP BY cbm.cash_box_id, COALESCE(pm.name, 'Dinheiro')
        """), {"aid": aid})).fetchall()
        breakdown_by_box: dict = {}
        for r in box_breakdown_rows:
            bid = str(r[0])
            if bid not in breakdown_by_box:
                breakdown_by_box[bid] = []
            breakdown_by_box[bid].append({"pm": r[1], "total": str(round(float(r[2]), 2))})

        return {
            "open_sessions": [{"id": str(r[0]), "opened_at": str(r[1]), "opening_balance": str(r[2]),
                                "operador": r[3], "expected_balance": str(round(float(r[4]), 2))} for r in open_rows],
            "conferido_sessions": [{"id": str(r[0]), "opened_at": str(r[1]),
                                      "closing_balance": str(r[2]) if r[2] else None,
                                      "expected_balance": str(r[3]) if r[3] else None,
                                      "difference": str(r[4]) if r[4] else None,
                                      "operador": r[5],
                                      "already_transferred": str(round(float(r[6] or 0), 2)),
                                      "remaining": str(round(max(0.0, float(r[2] or 0) - float(r[7] or 0) - float(r[6] or 0)), 2))} for r in conf_rows],
            "pap_today": {"total": str(round(float(pap_row[0]), 2)), "count": pap_row[1]},
            "caixinhas": [{"id": str(r[0]), "name": r[1], "balance": str(round(float(r[2]), 2)),
                           "breakdown": breakdown_by_box.get(str(r[0]), [])} for r in boxes],
            "total_limbo": str(round(sum(max(0.0, float(r[2] or 0) - float(r[7] or 0) - float(r[6] or 0)) for r in conf_rows), 2)),
            "faturamento_hoje": str(faturamento),
        }

    async def get_esteira(self, association_id: UUID) -> dict:
        aid = str(association_id)
        fat_row = (await self._session.execute(sa_text("""
            SELECT
                COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS bruto,
                COALESCE(SUM(CASE WHEN type IN ('expense','sangria')
                                   AND description NOT LIKE 'Repasse para caixinha%%'
                                   THEN amount ELSE 0 END), 0) AS baixas
              FROM transactions
             WHERE association_id = :aid AND reversed_at IS NULL AND is_reversal = false
        """), {"aid": aid})).fetchone()
        bruto = round(float(fat_row[0]), 2)
        baixas = round(float(fat_row[1]), 2)
        liquido = round(bruto - baixas, 2)

        open_row = (await self._session.execute(sa_text("""
            SELECT COUNT(DISTINCT cs.id),
                   COALESCE(SUM(cs.opening_balance), 0)
                   + COALESCE(SUM(CASE WHEN tx.type='income' AND tx.reversed_at IS NULL AND tx.is_reversal=false
                                        THEN tx.amount ELSE 0 END), 0)
                   - COALESCE(SUM(CASE WHEN tx.type IN ('expense','sangria') AND tx.reversed_at IS NULL AND tx.is_reversal=false
                                        THEN tx.amount ELSE 0 END), 0)
              FROM cash_sessions cs
              LEFT JOIN transactions tx ON tx.cash_session_id = cs.id AND tx.association_id = cs.association_id
             WHERE cs.association_id = :aid AND cs.status = 'open'
        """), {"aid": aid})).fetchone()
        em_abertos = round(float(open_row[1]), 2)

        closed_row = (await self._session.execute(sa_text("""
            SELECT COUNT(*), COALESCE(SUM(closing_balance), 0)
              FROM cash_sessions WHERE association_id = :aid AND status = 'closed'
        """), {"aid": aid})).fetchone()
        no_malote = round(float(closed_row[1]), 2)

        conf_closing = (await self._session.execute(sa_text("""
            SELECT COALESCE(SUM(closing_balance), 0), COUNT(*)
              FROM cash_sessions WHERE association_id = :aid AND status = 'conferido'
        """), {"aid": aid})).fetchone()
        ja_transferido = (await self._session.execute(sa_text("""
            SELECT COALESCE(SUM(amount), 0) FROM transactions
             WHERE association_id = :aid AND type = 'sangria'
               AND description LIKE 'Repasse para caixinha%%'
               AND reversed_at IS NULL AND is_reversal = false AND cash_session_id IS NULL
        """), {"aid": aid})).fetchone()
        a_repassar = round(max(0.0, float(conf_closing[0]) - float(ja_transferido[0])), 2)

        boxes_rows = (await self._session.execute(sa_text(
            "SELECT name, balance FROM cash_boxes WHERE association_id = :aid AND is_active = true ORDER BY name"
        ), {"aid": aid})).fetchall()
        nas_caixinhas = round(sum(float(r[1]) for r in boxes_rows), 2)

        total_localizado = round(em_abertos + no_malote + a_repassar + nas_caixinhas, 2)
        diferenca = round(liquido - total_localizado, 2)

        pix_pend = (await self._session.execute(sa_text(
            "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM bank_statements WHERE association_id = :aid AND conciliado = false"
        ), {"aid": aid})).fetchone()
        pix_done = (await self._session.execute(sa_text(
            "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM bank_statements WHERE association_id = :aid AND conciliado = true"
        ), {"aid": aid})).fetchone()

        return {
            "faturamento": {"bruto": str(bruto), "baixas": str(baixas), "liquido": str(liquido)},
            "localizacao": {
                "em_abertos": {"sessoes": int(open_row[0]), "total": str(em_abertos)},
                "no_malote": {"sessoes": int(closed_row[0]), "total": str(no_malote)},
                "a_repassar": {"sessoes": int(conf_closing[1]), "total": str(a_repassar)},
                "nas_caixinhas": {
                    "total": str(nas_caixinhas),
                    "boxes": [{"name": r[0], "saldo": str(round(float(r[1]), 2))} for r in boxes_rows],
                },
                "total_localizado": str(total_localizado),
                "diferenca": str(diferenca),
            },
            "pix": {
                "pendente": {"count": int(pix_pend[0]), "total": str(round(float(pix_pend[1]), 2))},
                "conciliado": {"count": int(pix_done[0]), "total": str(round(float(pix_done[1]), 2))},
            },
        }

    async def list_pix_pending(self, association_id: UUID, incluir_enviados: bool = False) -> list[dict]:
        batched_filter = "" if incluir_enviados else """
            AND NOT EXISTS (
                SELECT 1 FROM reconciliations r2
                JOIN bank_statements bs2 ON bs2.id = r2.statement_id
                WHERE r2.transaction_id = t.id AND bs2.batched_at IS NOT NULL
            )"""
        rows = (await self._session.execute(sa_text(f"""
            SELECT * FROM (
                SELECT DISTINCT ON (t.id)
                    t.id, t.amount, t.description, t.transaction_at, t.reversed_at,
                    r.full_name AS resident_name,
                    rec.status AS recon_status, rec.score,
                    bs.id AS statement_id, bs.bank, bs.name AS payer_name,
                    cs.opened_at AS session_opened_at, cs.id AS session_id,
                    u_op.full_name AS operador_name, u_rev.full_name AS conferente_name,
                    bs.batched_at, t.resident_id, pkg.delivered_to_name
                FROM transactions t
                JOIN payment_methods pm ON pm.id = t.payment_method_id
                LEFT JOIN residents r ON r.id = t.resident_id
                LEFT JOIN reconciliations rec ON rec.transaction_id = t.id
                LEFT JOIN bank_statements bs ON bs.id = rec.statement_id
                LEFT JOIN cash_sessions cs ON cs.id = t.cash_session_id
                LEFT JOIN users u_op ON u_op.id = cs.opened_by
                LEFT JOIN users u_rev ON u_rev.id = cs.reviewed_by
                LEFT JOIN packages pkg ON pkg.id = t.package_id
                WHERE t.association_id = :aid AND t.type = 'income'
                  AND pm.name ILIKE '%pix%%' {batched_filter}
                ORDER BY t.id, rec.status NULLS LAST, bs.batched_at NULLS FIRST
            ) sub
            ORDER BY sub.transaction_at DESC LIMIT 300
        """), {"aid": str(association_id)})).fetchall()

        def _derive_status(r) -> str:
            if r[4]:
                return "cancelado"
            if r[15]:
                return "enviado_caixinha"
            rs = r[6]
            if rs in ("automatico", "manual"):
                return "conciliado"
            if rs == "sugestao":
                return "pendente"
            return "nao_conciliado"

        return [{
            "id": str(r[0]), "amount": str(r[1]), "description": r[2],
            "date": str(r[3])[:10], "status": _derive_status(r),
            "recon_score": r[7], "resident_name": r[5],
            "bank_statement_id": str(r[8]) if r[8] else None,
            "bank": r[9], "payer_name": r[10],
            "session_opened_at": str(r[11]) if r[11] else None,
            "session_id": str(r[12]) if r[12] else None,
            "operador_name": r[13], "conferente_name": r[14],
            "batched_at": str(r[15]) if r[15] else None,
            "resident_id": str(r[16]) if r[16] else None,
            "delivered_to_name": r[17],
        } for r in rows]
