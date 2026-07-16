import secrets
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.exceptions import ConflictError, NotFoundError
from app.core.security import hash_password
from app.models.association import Association
from app.models.empresa import Empresa
from app.models.finance import TransactionCategory, TransactionType, PaymentMethod
from app.models.provisioning_run import ProvisioningRun, ProvisioningRunStatus, ProvisioningRunType
from app.models.user import User, UserRole
from app.services.email_service import send_email
from app.services.empresa_service import welcome_email_html

_DEFAULT_CATEGORIES = [
    ("Mensalidade", TransactionType.income),
    ("Taxa de Entrega", TransactionType.income),
    ("Despesas Gerais", TransactionType.expense),
]
_DEFAULT_PAYMENT_METHODS = ["Dinheiro", "PIX"]


class AssociationProvisioningService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_associacao(
        self,
        *,
        empresa_id: UUID,
        name: str,
        slug: str,
        community_name: str,
        default_mensalidade_amount: Decimal,
        default_cash_balance: Decimal,
        inventory_day_of_month: int,
        president_name: str | None,
        admin_first_name: str,
        admin_last_name: str,
        admin_email: str,
        admin_cargo: str,
        started_by: UUID,
    ) -> tuple[Association, User]:
        empresa = (await self._session.execute(select(Empresa).where(Empresa.id == empresa_id))).scalar_one_or_none()
        if not empresa or not empresa.is_active:
            raise NotFoundError("Empresa")

        existing = (await self._session.execute(select(Association).where(Association.slug == slug))).scalar_one_or_none()
        if existing:
            raise ConflictError(f"Já existe uma associação com o slug '{slug}'.")

        run = ProvisioningRun(
            empresa_id=empresa_id,
            run_type=ProvisioningRunType.create_associacao,
            status=ProvisioningRunStatus.running,
            payload={
                "name": name, "slug": slug, "community_name": community_name,
                "admin_email": admin_email, "admin_cargo": admin_cargo,
            },
            steps=[],
            started_by=started_by,
        )
        self._session.add(run)
        await self._session.commit()

        try:
            association = Association(name=name, slug=slug, empresa_id=empresa_id, inventory_day_of_month=inventory_day_of_month)
            self._session.add(association)
            await self._session.flush()
            run.steps = [*run.steps, {"step": "associacao_criada", "at": datetime.utcnow().isoformat(), "association_id": str(association.id)}]

            await self._session.execute(text("""
                INSERT INTO association_settings
                    (association_id, community_name, default_mensalidade_amount, default_cash_balance, president_name)
                VALUES
                    (:aid, :community_name, :mensalidade, :cash_balance, :president_name)
            """), {
                "aid": str(association.id),
                "community_name": community_name,
                "mensalidade": default_mensalidade_amount,
                "cash_balance": default_cash_balance,
                "president_name": president_name,
            })
            run.steps = [*run.steps, {"step": "settings_criado", "at": datetime.utcnow().isoformat()}]

            for cat_name, cat_type in _DEFAULT_CATEGORIES:
                self._session.add(TransactionCategory(association_id=association.id, name=cat_name, type=cat_type))
            for pm_name in _DEFAULT_PAYMENT_METHODS:
                self._session.add(PaymentMethod(association_id=association.id, name=pm_name))
            await self._session.flush()
            run.steps = [*run.steps, {"step": "defaults_financeiros_criados", "at": datetime.utcnow().isoformat()}]

            await self._session.execute(text("""
                INSERT INTO cash_boxes (association_id, name, balance)
                VALUES (:aid, 'Caixa Principal', :balance)
            """), {"aid": str(association.id), "balance": default_cash_balance})
            run.steps = [*run.steps, {"step": "cash_box_criado", "at": datetime.utcnow().isoformat()}]

            senha_gerada = secrets.token_urlsafe(12)
            admin = User(
                association_id=association.id,
                full_name=f"{admin_first_name} {admin_last_name}".strip(),
                email=admin_email,
                hashed_password=hash_password(senha_gerada),
                role=UserRole.admin,
            )
            self._session.add(admin)
            await self._session.flush()
            run.steps = [*run.steps, {"step": "admin_associacao_criado", "at": datetime.utcnow().isoformat(), "user_id": str(admin.id)}]

            run.status = ProvisioningRunStatus.success
            run.finished_at = datetime.utcnow()
            await self._session.commit()
        except Exception as exc:
            await self._session.rollback()
            run.status = ProvisioningRunStatus.failed
            run.error_detail = str(exc)
            run.finished_at = datetime.utcnow()
            self._session.add(run)
            await self._session.commit()
            raise

        send_email(
            to=admin_email,
            subject=f"Acesso criado — {name}",
            html=welcome_email_html(admin.full_name, name, admin_email, senha_gerada),
        )
        return association, admin
