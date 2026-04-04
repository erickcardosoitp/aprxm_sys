import json
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user, require_admin, require_conferente
from app.database import get_session
from app.models.settings import AssociationSettings

router = APIRouter(prefix="/settings", tags=["Configurações"])


def require_superadmin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.role not in ("superadmin", "admin"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Apenas admin+ pode acessar esta função.")
    return current


class UpdateSettingsRequest(BaseModel):
    default_cash_balance: Decimal = Field(ge=0)
    max_cash_before_sangria: Decimal = Field(ge=0)


class UpdateAssocDataRequest(BaseModel):
    assoc_name: str | None = None
    assoc_phone: str | None = None
    assoc_email: str | None = None
    assoc_address: str | None = None
    assoc_cep: str | None = None
    president_user_id: UUID | None = None


@router.get("", summary="Configurações da associação")
async def get_settings(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(AssociationSettings).where(
        AssociationSettings.association_id == current.association_id
    )
    result = await session.execute(stmt)
    cfg = result.scalar_one_or_none()
    if not cfg:
        return {
            "association_id": str(current.association_id),
            "default_cash_balance": "200.00",
            "max_cash_before_sangria": "500.00",
        }
    return {
        "association_id": str(cfg.association_id),
        "default_cash_balance": str(cfg.default_cash_balance),
        "max_cash_before_sangria": str(cfg.max_cash_before_sangria),
    }


@router.put("", summary="Atualizar configurações (conferente+)")
async def update_settings(
    body: UpdateSettingsRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(AssociationSettings).where(
        AssociationSettings.association_id == current.association_id
    )
    result = await session.execute(stmt)
    cfg = result.scalar_one_or_none()
    if cfg:
        cfg.default_cash_balance = body.default_cash_balance
        cfg.max_cash_before_sangria = body.max_cash_before_sangria
        cfg.updated_at = datetime.utcnow()
        cfg.updated_by = current.user_id
    else:
        cfg = AssociationSettings(
            association_id=current.association_id,
            default_cash_balance=body.default_cash_balance,
            max_cash_before_sangria=body.max_cash_before_sangria,
            updated_by=current.user_id,
        )
    session.add(cfg)
    await session.flush()
    return {
        "association_id": str(cfg.association_id),
        "default_cash_balance": str(cfg.default_cash_balance),
        "max_cash_before_sangria": str(cfg.max_cash_before_sangria),
    }


@router.get("/association", summary="Dados da associação")
async def get_assoc_data(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("SELECT name, phone, email, address_street, address_zip FROM associations WHERE id = :id"),
        {"id": str(current.association_id)},
    )
    row = result.fetchone()
    cfg_result = await session.execute(
        text("SELECT assoc_name, assoc_phone, assoc_email, assoc_address, assoc_cep, president_user_id FROM association_settings WHERE association_id = :id"),
        {"id": str(current.association_id)},
    )
    cfg = cfg_result.fetchone()
    return {
        "name": (cfg[0] if cfg and cfg[0] else row[0]) if row else "",
        "phone": (cfg[1] if cfg and cfg[1] else row[1]) if row else "",
        "email": (cfg[2] if cfg and cfg[2] else row[2]) if row else "",
        "address": (cfg[3] if cfg and cfg[3] else row[3]) if row else "",
        "cep": (cfg[4] if cfg and cfg[4] else row[4]) if row else "",
        "president_user_id": str(cfg[5]) if cfg and cfg[5] else None,
    }


@router.put("/association", summary="Atualizar dados da associação (admin+)")
async def update_assoc_data(
    body: UpdateAssocDataRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(
        text("""
            INSERT INTO association_settings (association_id, assoc_name, assoc_phone, assoc_email, assoc_address, assoc_cep, president_user_id, updated_at)
            VALUES (:id, :name, :phone, :email, :address, :cep, :president, NOW())
            ON CONFLICT (association_id) DO UPDATE SET
                assoc_name = EXCLUDED.assoc_name,
                assoc_phone = EXCLUDED.assoc_phone,
                assoc_email = EXCLUDED.assoc_email,
                assoc_address = EXCLUDED.assoc_address,
                assoc_cep = EXCLUDED.assoc_cep,
                president_user_id = EXCLUDED.president_user_id,
                updated_at = NOW()
        """),
        {
            "id": str(current.association_id),
            "name": body.assoc_name, "phone": body.assoc_phone,
            "email": body.assoc_email, "address": body.assoc_address,
            "cep": body.assoc_cep,
            "president": str(body.president_user_id) if body.president_user_id else None,
        },
    )
    await session.commit()
    return {"ok": True}


DEFAULT_ACCESS_GROUPS = {
    "viewer": {"residents": ["view"], "packages": ["view"], "service_orders": ["view"], "finance": [], "admin": [], "settings": []},
    "operator": {"residents": ["view"], "packages": ["view", "create"], "service_orders": ["view"], "finance": ["view", "create"], "admin": [], "settings": []},
    "conferente": {"residents": ["view", "create", "edit"], "packages": ["view", "create", "edit"], "service_orders": ["view", "create", "edit"], "finance": ["view", "create", "edit"], "admin": [], "settings": ["view"]},
    "diretoria_adjunta": {"residents": ["view"], "packages": ["view"], "service_orders": ["view", "create", "edit"], "finance": ["view"], "admin": [], "settings": []},
    "admin": {"residents": ["view", "create", "edit", "delete"], "packages": ["view", "create", "edit", "delete"], "service_orders": ["view", "create", "edit", "delete"], "finance": ["view", "create", "edit", "delete"], "admin": ["view", "create", "edit", "delete"], "settings": ["view", "edit"]},
}


@router.get("/access-groups", summary="Gestão de acesso por grupo (superadmin)")
async def get_access_groups(
    current: CurrentUser = Depends(require_superadmin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("SELECT access_groups FROM association_settings WHERE association_id = :id"),
        {"id": str(current.association_id)},
    )
    row = result.fetchone()
    if row and row[0]:
        data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        return data
    return DEFAULT_ACCESS_GROUPS


@router.put("/access-groups", summary="Salvar gestão de acesso por grupo (superadmin)")
async def update_access_groups(
    body: dict,
    current: CurrentUser = Depends(require_superadmin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(
        text("""
            INSERT INTO association_settings (association_id, access_groups, updated_at)
            VALUES (:id, CAST(:groups AS jsonb), NOW())
            ON CONFLICT (association_id) DO UPDATE SET
                access_groups = CAST(EXCLUDED.access_groups AS jsonb),
                updated_at = NOW()
        """),
        {"id": str(current.association_id), "groups": json.dumps(body)},
    )
    await session.commit()
    return body


@router.get("/cadastros", summary="Obter cadastros básicos")
async def get_cadastros(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("SELECT cadastros FROM association_settings WHERE association_id = :id"),
        {"id": str(current.association_id)},
    )
    row = result.fetchone()
    if not row or not row[0]:
        return {"categorias": [], "servicos_impactados": [], "orgaos_responsaveis": []}
    data = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return data


@router.put("/cadastros", summary="Salvar cadastros básicos")
async def save_cadastros(
    body: dict,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(
        text("""
            INSERT INTO association_settings (association_id, cadastros, updated_at)
            VALUES (:id, CAST(:val AS jsonb), NOW())
            ON CONFLICT (association_id) DO UPDATE SET
                cadastros = CAST(:val AS jsonb),
                updated_at = NOW()
        """),
        {"id": str(current.association_id), "val": json.dumps(body)},
    )
    await session.commit()
    return body
