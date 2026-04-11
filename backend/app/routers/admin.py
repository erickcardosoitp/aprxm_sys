from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.security import hash_password
from app.core.tenant import CurrentUser, require_admin
from app.database import get_session
from app.models.user import User, UserRole

router = APIRouter(prefix="/admin", tags=["Administração"])


class CreateUserRequest(BaseModel):
    full_name: str
    email: str
    password: str
    role: UserRole = UserRole.operator
    phone: str | None = None


class UpdateUserRequest(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = None


def _serialize_user(u: User) -> dict:
    return {
        "id": str(u.id),
        "full_name": u.full_name,
        "email": u.email,
        "phone": u.phone,
        "role": u.role,
        "is_active": u.is_active,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat(),
    }


@router.get("/users", summary="Listar usuários da associação")
async def list_users(
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    stmt = (
        select(User)
        .where(User.association_id == current.association_id)
        .order_by(User.full_name)
    )
    result = await session.execute(stmt)
    return [_serialize_user(u) for u in result.scalars().all()]


@router.post("/users", summary="Criar usuário")
async def create_user(
    body: CreateUserRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # check email uniqueness within association
    stmt = select(User).where(
        User.email == body.email,
        User.association_id == current.association_id,
    )
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado nesta associação.")
    user = User(
        association_id=current.association_id,
        full_name=body.full_name,
        email=body.email,
        phone=body.phone,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    session.add(user)
    await session.flush()
    await session.execute(
        text("INSERT INTO audit_log (association_id,user_id,action,entity,entity_id,detail) VALUES (:a,:u,'criar_usuario','user',:eid,:d)"),
        {"a": str(current.association_id), "u": str(current.user_id), "eid": str(user.id), "d": f"{user.full_name} ({user.role})"},
    )
    return _serialize_user(user)


@router.put("/users/{user_id}", summary="Atualizar usuário")
async def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(User).where(
        User.id == user_id,
        User.association_id == current.association_id,
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.phone is not None:
        user.phone = body.phone
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        user.hashed_password = hash_password(body.password)
    from datetime import datetime
    user.updated_at = datetime.utcnow()
    session.add(user)
    await session.execute(
        text("INSERT INTO audit_log (association_id,user_id,action,entity,entity_id,detail) VALUES (:a,:u,'editar_usuario','user',:eid,:d)"),
        {"a": str(current.association_id), "u": str(current.user_id), "eid": str(user_id), "d": f"{user.full_name} → papel:{user.role}"},
    )
    return _serialize_user(user)


class ResetDatabaseRequest(BaseModel):
    confirm: str  # must be "RESETAR"
    initial_balance: Decimal = Decimal("0.00")


@router.get("/audit-log", summary="Log de auditoria de usuários")
async def get_audit_log(
    limit: int = 100,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT al.id, al.action, al.entity, al.entity_id, al.detail,
                   al.created_at, u.full_name AS actor
            FROM audit_log al
            JOIN users u ON u.id = al.user_id
            WHERE al.association_id = :aid
            ORDER BY al.created_at DESC LIMIT :lim
        """),
        {"aid": str(current.association_id), "lim": limit},
    )
    return [{"id": str(r[0]), "acao": r[1], "entidade": r[2], "entidade_id": r[3],
             "detalhe": r[4], "data": str(r[5]), "autor": r[6]} for r in result.fetchall()]


@router.post("/reset-database", summary="Resetar base de dados (manter usuários e moradores)")
async def reset_database(
    body: ResetDatabaseRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.confirm != "RESETAR":
        raise HTTPException(status_code=400, detail="Digite RESETAR para confirmar.")

    aid = str(current.association_id)
    tables = [
        "reconciliations", "bank_statements",
        "migration_payments",
        "mensalidades",
        "package_events", "packages",
        "transactions", "cash_sessions",
        "service_order_comments", "service_order_history", "service_orders",
    ]
    for table in tables:
        await session.execute(
            text(f"DELETE FROM {table} WHERE association_id = :aid"),
            {"aid": aid},
        )

    tx_id = None
    if body.initial_balance > 0:
        from uuid import uuid4
        from datetime import datetime
        session_id = uuid4()
        tx_id = uuid4()
        now = datetime.utcnow()

        await session.execute(
            text("""
                INSERT INTO cash_sessions (id, association_id, opened_by, status,
                    opening_balance, closing_balance, expected_balance, difference,
                    notes, opened_at, closed_at, created_at, updated_at)
                VALUES (:sid, :aid, :uid, 'closed', 0, :bal, :bal, 0,
                    'Saldo inicial (migração)', :now, :now, :now, :now)
            """),
            {"sid": str(session_id), "aid": aid, "uid": str(current.user_id),
             "bal": str(body.initial_balance), "now": now},
        )
        await session.execute(
            text("""
                INSERT INTO transactions (id, association_id, cash_session_id, type,
                    amount, description, created_by, transaction_at, created_at, updated_at)
                VALUES (:tid, :aid, :sid, 'income', :bal, 'Saldo inicial (migração)',
                    :uid, :now, :now, :now)
            """),
            {"tid": str(tx_id), "aid": aid, "sid": str(session_id),
             "bal": str(body.initial_balance), "uid": str(current.user_id), "now": now},
        )

    return {
        "ok": True,
        "message": "Movimentações resetadas. Usuários e moradores mantidos.",
        "initial_balance": str(body.initial_balance),
        "initial_transaction_id": str(tx_id) if tx_id else None,
    }


@router.delete("/users/{user_id}", summary="Desativar usuário")
async def deactivate_user(
    user_id: UUID,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if user_id == current.user_id:
        raise HTTPException(status_code=400, detail="Você não pode desativar sua própria conta.")
    stmt = select(User).where(
        User.id == user_id,
        User.association_id == current.association_id,
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    user.is_active = False
    session.add(user)
    return {"id": str(user.id), "is_active": False}


class ClearDataRequest(BaseModel):
    confirm: str  # deve ser "CONFIRMAR"
    clear_transactions: bool = True
    clear_packages: bool = False
    clear_service_orders: bool = False
    clear_mensalidades: bool = False


@router.post("/clear-data", summary="Limpar dados da associação atual por tipo")
async def clear_data(
    body: ClearDataRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.confirm != "CONFIRMAR":
        raise HTTPException(400, "Digite CONFIRMAR para prosseguir.")
    aid = str(current.association_id)
    deleted: dict[str, int] = {}

    if body.clear_transactions:
        for t in ["transactions", "cash_sessions"]:
            r = await session.execute(text(f"DELETE FROM {t} WHERE association_id = :aid"), {"aid": aid})
            deleted[t] = r.rowcount

    if body.clear_packages:
        for t in ["package_events", "packages"]:
            r = await session.execute(text(f"DELETE FROM {t} WHERE association_id = :aid"), {"aid": aid})
            deleted[t] = r.rowcount

    if body.clear_service_orders:
        for t in ["service_order_comments", "service_order_history", "service_orders"]:
            r = await session.execute(text(f"DELETE FROM {t} WHERE association_id = :aid"), {"aid": aid})
            deleted[t] = r.rowcount

    if body.clear_mensalidades:
        r = await session.execute(text("DELETE FROM mensalidades WHERE association_id = :aid"), {"aid": aid})
        deleted["mensalidades"] = r.rowcount

    await session.commit()
    return {"ok": True, "deleted": deleted}
