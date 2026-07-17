import secrets
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.exceptions import ConflictError
from app.core.security import hash_password
from app.models.empresa import Empresa
from app.models.provisioning_run import ProvisioningRun, ProvisioningRunStatus, ProvisioningRunType
from app.models.user import User, UserRole
from app.services.email_service import send_email


def welcome_email_html(full_name: str, empresa_name: str, email: str, senha: str) -> str:
    return f"""
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#1a3f6f;margin-bottom:4px">Bem-vindo(a) ao APRXM</h2>
  <p>Olá, {full_name}. Sua conta de administrador da empresa <strong>{empresa_name}</strong> foi criada.</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:4px 0"><strong>E-mail:</strong> {email}</p>
    <p style="margin:4px 0"><strong>Senha provisória:</strong> {senha}</p>
  </div>
  <p style="color:#6b7280;font-size:13px">Recomendamos trocar a senha no primeiro acesso.</p>
  <p style="color:#6b7280;font-size:13px">APRXM — Sistema de Gestão Comunitária</p>
</div>
"""


class EmpresaService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_empresa(
        self,
        *,
        name: str,
        slug: str,
        admin_first_name: str,
        admin_last_name: str,
        admin_email: str,
        admin_cargo: str,
        financeiro_centralizado: bool,
        started_by: UUID,
    ) -> tuple[Empresa, User]:
        existing = (await self._session.execute(select(Empresa).where(Empresa.slug == slug))).scalar_one_or_none()
        if existing:
            raise ConflictError(f"Já existe uma empresa com o slug '{slug}'.")

        # O registro de execucao e commitado na sua propria transacao antes de
        # qualquer tentativa de criacao — assim ele sobrevive intacto mesmo se
        # o restante do fluxo falhar e precisar de rollback (auditoria confiavel).
        run = ProvisioningRun(
            run_type=ProvisioningRunType.create_empresa,
            status=ProvisioningRunStatus.running,
            payload={
                "name": name, "slug": slug, "admin_email": admin_email,
                "admin_cargo": admin_cargo, "financeiro_centralizado": financeiro_centralizado,
            },
            steps=[],
            started_by=started_by,
        )
        self._session.add(run)
        await self._session.commit()

        try:
            empresa = Empresa(name=name, slug=slug, financeiro_centralizado=financeiro_centralizado)
            self._session.add(empresa)
            await self._session.flush()
            run.steps = [*run.steps, {"step": "empresa_criada", "at": datetime.utcnow().isoformat(), "empresa_id": str(empresa.id)}]

            senha_gerada = secrets.token_urlsafe(12)
            admin = User(
                empresa_id=empresa.id,
                association_id=None,
                full_name=f"{admin_first_name} {admin_last_name}".strip(),
                email=admin_email,
                hashed_password=hash_password(senha_gerada),
                role=UserRole.admin_master,
            )
            self._session.add(admin)
            await self._session.flush()
            run.steps = [*run.steps, {"step": "admin_master_criado", "at": datetime.utcnow().isoformat(), "user_id": str(admin.id)}]

            run.empresa_id = empresa.id
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
        return empresa, admin
