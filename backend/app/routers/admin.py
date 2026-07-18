from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.security import hash_password
from app.core.tenant import CurrentUser, get_current_user, require_admin, require_diretoria
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
    email: str | None = None
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
    active_only: bool = False,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    # Usuarios empresa-wide (admin_master/superadmin sem association_id fixo,
    # Fase 8a) tem acesso a toda associacao da empresa via escopo dinamico —
    # sem isso, ficam invisiveis em qualquer lista (association_id NULL nunca
    # bate com nenhum :aid).
    stmt = select(User).where(
        or_(
            User.association_id == current.association_id,
            and_(
                User.empresa_id == current.empresa_id,
                User.association_id.is_(None),
                User.role.in_(["admin_master", "superadmin"]),
            ),
        )
    )
    if active_only:
        stmt = stmt.where(User.is_active == True)
    stmt = stmt.order_by(User.full_name)
    result = await session.execute(stmt)
    return [_serialize_user(u) for u in result.scalars().all()]


@router.post("/users", summary="Criar usuário")
async def create_user(
    body: CreateUserRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Verificação global de email (único por sistema, não por associação)
    existing = (await session.execute(
        select(User).where(User.email == body.email, User.is_active == True)  # noqa: E712
    )).scalar_one_or_none()

    if existing:
        # Usuário global já existe — verifica se já tem acesso a esta associação
        already = (await session.execute(
            text("SELECT 1 FROM user_association_roles WHERE user_id = :uid AND association_id = :aid"),
            {"uid": str(existing.id), "aid": str(current.association_id)},
        )).scalar()
        if already:
            raise HTTPException(status_code=409, detail="Este usuário já tem acesso a esta associação.")
        # Adiciona membership na nova associação
        await session.execute(
            text("INSERT INTO user_association_roles (user_id, association_id, role) VALUES (:uid, :aid, :role)"),
            {"uid": str(existing.id), "aid": str(current.association_id), "role": body.role},
        )
        # linked_association_ids/empresa_id vivem no token - incrementa tv
        # pra novo acesso aparecer sem esperar o token expirar
        await session.execute(
            text("UPDATE users SET token_version = token_version + 1 WHERE id = :uid"),
            {"uid": str(existing.id)},
        )
        await session.execute(
            text("INSERT INTO audit_log (association_id,user_id,action,entity,entity_id,detail) VALUES (:a,:u,'add_membership','user',:eid,:d)"),
            {"a": str(current.association_id), "u": str(current.user_id), "eid": str(existing.id), "d": f"{existing.full_name} ({body.role})"},
        )
        await session.commit()
        return _serialize_user(existing)

    # Usuário novo — cria globalmente e adiciona membership
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
        text("INSERT INTO user_association_roles (user_id, association_id, role) VALUES (:uid, :aid, :role)"),
        {"uid": str(user.id), "aid": str(current.association_id), "role": body.role},
    )
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
    if body.email is not None and body.email != user.email:
        conflict = (await session.execute(
            select(User).where(User.email == body.email, User.id != user_id)
        )).scalar_one_or_none()
        if conflict:
            raise HTTPException(status_code=409, detail="Este e-mail já está em uso por outro usuário.")
        user.email = body.email
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.phone is not None:
        user.phone = body.phone
    _needs_revoke = False
    if body.role is not None and body.role != user.role:
        user.role = body.role
        _needs_revoke = True
    if body.is_active is not None and body.is_active != user.is_active:
        user.is_active = body.is_active
        _needs_revoke = True
    if body.password:
        user.hashed_password = hash_password(body.password)
        _needs_revoke = True
    if _needs_revoke:
        # role/is_active/senha vivem no token (ou no proprio guard de is_active) -
        # incrementa tv e derruba sessoes ja abertas na hora
        user.token_version = (user.token_version or 0) + 1
        await session.execute(
            text("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = :uid"),
            {"uid": str(user_id)},
        )
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
    user.token_version = (user.token_version or 0) + 1
    session.add(user)
    await session.execute(
        text("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = :uid"),
        {"uid": str(user_id)},
    )
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


# ── Tarefas Agendadas ─────────────────────────────────────────────────────────

BUILT_IN_TASKS = [
    {
        "task_key": "sync_pix_bank_statements",
        "name": "Sincronizar PIX Não-Conciliados",
        "description": "Transpõe todas as transações PIX sem entrada em Extrato para a tela de conciliação como Não-Conciliado.",
        "schedule_cron": "0 8 * * *",
        "schedule_label": "Diariamente às 08h",
    },
    {
        "task_key": "generate_monthly_mensalidades",
        "name": "Gerar Mensalidades do Mês",
        "description": "Toda segunda-feira às 08h, gera mensalidades pendentes para todos os associados ativos do mês corrente.",
        "schedule_cron": "0 8 * * 1",
        "schedule_label": "Toda segunda-feira às 08h",
    },
    {
        "task_key": "vacuum_dead_rows",
        "name": "Limpeza de Dead Rows (VACUUM)",
        "description": "Toda domingo às 02h, limpa registros obsoletos das tabelas mais ativas (notifications, transactions, packages, chat_message_reads, residents). Libera espaço e mantém performance das queries.",
        "schedule_cron": "0 2 * * 0",
        "schedule_label": "Todo domingo às 02h",
    },
]


@router.get("/scheduled-tasks", summary="Listar tarefas agendadas")
async def list_scheduled_tasks(
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from datetime import datetime as dt
    aid = str(current.association_id)

    # Ensure built-in tasks exist
    for task in BUILT_IN_TASKS:
        await session.execute(text("""
            INSERT INTO scheduled_tasks (association_id, name, description, task_key, schedule_cron, schedule_label)
            VALUES (:aid, :name, :desc, :key, :cron, :label)
            ON CONFLICT (association_id, task_key) DO NOTHING
        """), {"aid": aid, "name": task["name"], "desc": task["description"],
               "key": task["task_key"], "cron": task["schedule_cron"], "label": task["schedule_label"]})
    await session.commit()

    result = await session.execute(text(
        "SELECT id, name, description, task_key, schedule_cron, schedule_label, enabled, "
        "last_run_at, last_run_status, last_run_result, created_at "
        "FROM scheduled_tasks WHERE association_id = :aid ORDER BY created_at"
    ), {"aid": aid})
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]), "name": r[1], "description": r[2], "task_key": r[3],
            "schedule_cron": r[4], "schedule_label": r[5], "enabled": r[6],
            "last_run_at": str(r[7]) if r[7] else None, "last_run_status": r[8],
            "last_run_result": r[9], "created_at": str(r[10]),
        }
        for r in rows
    ]


@router.patch("/scheduled-tasks/{task_key}/toggle", summary="Ativar/desativar tarefa")
async def toggle_task(
    task_key: str,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(text(
        "UPDATE scheduled_tasks SET enabled = NOT enabled WHERE association_id = :aid AND task_key = :key "
        "RETURNING enabled"
    ), {"aid": str(current.association_id), "key": task_key})
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Tarefa não encontrada.")
    await session.commit()
    return {"enabled": row[0]}


@router.post("/scheduled-tasks/{task_key}/run", summary="Executar tarefa agora")
async def run_task_now(
    task_key: str,
    target_association_id: str | None = Query(default=None, alias="association_id"),
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import datetime as dt
    # superadmin/admin_master pode direcionar para outra associação
    if target_association_id and current.role in ("superadmin", "admin_master"):
        from uuid import UUID as _UUID
        aid = target_association_id
        assoc_id = _UUID(target_association_id)
    else:
        aid = str(current.association_id)
        assoc_id = current.association_id
    status = "success"
    result_msg = ""

    try:
        if task_key == "sync_pix_bank_statements":
            # Find PIX income transactions without bank_statement entry
            r = await session.execute(text("""
                INSERT INTO bank_statements (association_id, bank, date, amount, name, description, tipo, conciliado, transaction_id)
                SELECT t.association_id, 'PIX', t.created_at::date, t.amount, t.description, t.description,
                       'entrada', false, t.id
                FROM transactions t
                JOIN payment_methods pm ON pm.id = t.payment_method_id
                WHERE t.association_id = :aid
                  AND t.type = 'income'
                  AND LOWER(pm.name) LIKE '%pix%'
                  AND t.reversed_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM bank_statements bs WHERE bs.transaction_id = t.id)
                RETURNING id
            """), {"aid": aid})
            count = len(r.fetchall())
            result_msg = f"{count} entrada(s) PIX sincronizadas."

        elif task_key == "generate_monthly_mensalidades":
            from app.services.mensalidade_service import MensalidadeService
            from decimal import Decimal
            from datetime import date
            from uuid import UUID as _UUID

            ref_month = date.today().strftime("%Y-%m")
            default_due_day = 10

            # Se agregador (escritório), roda para todas as associações vinculadas
            if current.is_aggregator:
                target_ids = [str(i) for i in current.linked_association_ids]
            else:
                target_ids = [aid]

            total_created = 0
            skipped_assocs = []
            svc = MensalidadeService(session)

            for target_aid in target_ids:
                settings_row = (await session.execute(text("""
                    SELECT COALESCE(default_mensalidade_amount, 0)
                    FROM association_settings WHERE association_id = :aid
                """), {"aid": target_aid})).fetchone()
                configured_amount = Decimal(str(settings_row[0])) if settings_row else Decimal("0")

                if not configured_amount or configured_amount <= 0:
                    last_row = (await session.execute(text("""
                        SELECT amount FROM mensalidades WHERE association_id = :aid
                        ORDER BY created_at DESC LIMIT 1
                    """), {"aid": target_aid})).fetchone()
                    configured_amount = Decimal(str(last_row[0])) if last_row else None

                cb_row = (await session.execute(text(
                    "SELECT id FROM users WHERE association_id = :aid AND role IN ('admin','superadmin','admin_master','diretoria','conferente') AND is_active = TRUE LIMIT 1"
                ), {"aid": target_aid})).fetchone()
                created_by = cb_row[0] if cb_row else None

                if configured_amount and configured_amount > 0 and created_by:
                    gen_result = await svc.generate_month(
                        association_id=_UUID(target_aid),
                        reference_month=ref_month,
                        due_day=default_due_day,
                        amount=configured_amount,
                        created_by=created_by,
                    )
                    total_created += gen_result.get("created", 0)
                else:
                    skipped_assocs.append(target_aid)

            result_msg = f"{total_created} mensalidade(s) gerada(s) para {ref_month}."
            if skipped_assocs:
                result_msg += f" {len(skipped_assocs)} associação(ões) sem valor configurado."
        elif task_key == "vacuum_dead_rows":
            tables = [
                "notifications", "transactions", "packages",
                "chat_message_reads", "residents", "mensalidades",
                "daily_task_comments", "api_request_logs",
            ]
            # VACUUM não pode rodar dentro de transação — usa conexão raw direta
            import asyncpg
            from app.config import get_settings as _gs
            _settings = _gs()
            # Prefere DATABASE_URL_DIRECT (sem pooler); fallback para url principal
            raw_url = _settings.database_url_direct or str(_settings.database_url).replace("+asyncpg", "")
            raw_conn = await asyncpg.connect(raw_url)
            vacuumed = []
            try:
                for tbl in tables:
                    try:
                        await raw_conn.execute(f"VACUUM ANALYZE {tbl}")
                        vacuumed.append(tbl)
                    except Exception:
                        pass
            finally:
                await raw_conn.close()
            result_msg = f"VACUUM ANALYZE executado em {len(vacuumed)} tabelas: {', '.join(vacuumed)}."

        else:
            raise HTTPException(400, "Tarefa desconhecida.")

    except HTTPException:
        raise
    except Exception as e:
        status = "error"
        result_msg = str(e)

    await session.execute(text("""
        UPDATE scheduled_tasks SET last_run_at = now(), last_run_status = :status, last_run_result = :result
        WHERE association_id = :aid AND task_key = :key
    """), {"aid": aid, "status": status, "result": result_msg, "key": task_key})
    await session.commit()
    return {"status": status, "result": result_msg}


# ── Role Permissions ─────────────────────────────────────────────────────────

MODULES = ['finance', 'service_orders', 'residents', 'packages', 'settings', 'daily_tasks', 'reports']
CONFIGURABLE_ROLES = ['admin', 'conferente', 'diretoria', 'diretoria_adjunta', 'conselho', 'operator', 'viewer']

_T, _F = True, False
DEFAULT_PERMISSIONS: dict[str, dict[str, tuple[bool, bool]]] = {
    'admin':            {'finance': (_T,_T), 'service_orders': (_T,_T), 'residents': (_T,_T), 'packages': (_T,_T), 'settings': (_T,_T), 'daily_tasks': (_T,_T), 'reports': (_T,_T)},
    'conferente':       {'finance': (_T,_T), 'service_orders': (_T,_T), 'residents': (_T,_T), 'packages': (_T,_T), 'settings': (_T,_T), 'daily_tasks': (_T,_T), 'reports': (_T,_T)},
    'diretoria':        {'finance': (_T,_T), 'service_orders': (_T,_T), 'residents': (_T,_T), 'packages': (_T,_T), 'settings': (_T,_F), 'daily_tasks': (_T,_T), 'reports': (_T,_T)},
    'diretoria_adjunta':{'finance': (_T,_F), 'service_orders': (_T,_T), 'residents': (_T,_F), 'packages': (_T,_F), 'settings': (_F,_F), 'daily_tasks': (_T,_T), 'reports': (_T,_F)},
    'conselho':         {'finance': (_T,_F), 'service_orders': (_T,_F), 'residents': (_T,_F), 'packages': (_T,_F), 'settings': (_F,_F), 'daily_tasks': (_T,_F), 'reports': (_T,_F)},
    'operator':         {'finance': (_T,_F), 'service_orders': (_T,_F), 'residents': (_T,_F), 'packages': (_T,_T), 'settings': (_F,_F), 'daily_tasks': (_T,_F), 'reports': (_F,_F)},
    'viewer':           {'finance': (_T,_F), 'service_orders': (_T,_F), 'residents': (_T,_F), 'packages': (_T,_F), 'settings': (_F,_F), 'daily_tasks': (_T,_F), 'reports': (_F,_F)},
}


def _resolve_permissions(role: str, db_rows: dict) -> dict:
    role_defaults = DEFAULT_PERMISSIONS.get(role, {})
    result = {}
    for module in MODULES:
        key = (role, module)
        if key in db_rows:
            result[module] = {'can_view': db_rows[key][0], 'can_write': db_rows[key][1]}
        else:
            cv, cw = role_defaults.get(module, (False, False))
            result[module] = {'can_view': cv, 'can_write': cw}
    return result


@router.get("/role-permissions", summary="Matriz de permissões por role")
async def get_role_permissions(
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("SELECT role, module, can_view, can_write FROM role_permissions WHERE association_id = :aid"),
        {"aid": str(current.association_id)},
    )
    db_rows = {(r[0], r[1]): (r[2], r[3]) for r in result.fetchall()}
    return {role: _resolve_permissions(role, db_rows) for role in CONFIGURABLE_ROLES}


class UpdatePermissionRequest(BaseModel):
    can_view: bool
    can_write: bool


@router.put("/role-permissions/{role}/{module}", summary="Atualizar permissão de role/módulo")
async def update_role_permission(
    role: str,
    module: str,
    body: UpdatePermissionRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if role not in CONFIGURABLE_ROLES:
        raise HTTPException(400, "Role inválida.")
    if module not in MODULES:
        raise HTTPException(400, "Módulo inválido.")
    await session.execute(
        text("""
            INSERT INTO role_permissions (association_id, role, module, can_view, can_write)
            VALUES (:aid, :role, :module, :cv, :cw)
            ON CONFLICT (association_id, role, module)
            DO UPDATE SET can_view = :cv, can_write = :cw, updated_at = NOW()
        """),
        {"aid": str(current.association_id), "role": role, "module": module, "cv": body.can_view, "cw": body.can_write},
    )
    await session.commit()
    return {"role": role, "module": module, "can_view": body.can_view, "can_write": body.can_write}


@router.get("/my-permissions", summary="Permissões do usuário logado")
async def get_my_permissions(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if current.role in ('superadmin', 'admin_master'):
        return {m: {'can_view': True, 'can_write': True} for m in MODULES}
    result = await session.execute(
        text("SELECT module, can_view, can_write FROM role_permissions WHERE association_id = :aid AND role = :role"),
        {"aid": str(current.association_id), "role": current.role},
    )
    db_rows: dict[str, tuple[bool, bool]] = {r[0]: (r[1], r[2]) for r in result.fetchall()}
    role_defaults = DEFAULT_PERMISSIONS.get(current.role, {})
    perms = {}
    for module in MODULES:
        if module in db_rows:
            perms[module] = {'can_view': db_rows[module][0], 'can_write': db_rows[module][1]}
        else:
            cv, cw = role_defaults.get(module, (False, False))
            perms[module] = {'can_view': cv, 'can_write': cw}
    return perms


@router.post("/delivery-exemption-token", summary="Gerar token de isenção de taxa de entrega (30 min, uso único)")
async def generate_delivery_exemption_token(
    current: CurrentUser = Depends(require_diretoria),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import secrets
    from datetime import datetime, timezone, timedelta
    token = secrets.token_hex(3).upper()  # 6 hex chars, e.g. "A3F8C1"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
    await session.execute(text("""
        INSERT INTO delivery_exemption_tokens (id, association_id, token, created_by, expires_at)
        VALUES (gen_random_uuid(), :aid, :token, :uid, :exp)
        ON CONFLICT (association_id, token) DO UPDATE SET expires_at = EXCLUDED.expires_at, used_at = NULL, used_by = NULL, package_id = NULL
    """), {"aid": str(current.association_id), "token": token, "uid": str(current.user_id), "exp": expires_at})
    await session.commit()
    return {"token": token, "expires_at": expires_at.isoformat()}


class BlankProofRequest(BaseModel):
    quantity: int = 1


@router.post("/proof-of-residence/blank", summary="Gerar comprovantes de residência em branco com código de barras único")
async def blank_proof_of_residence(
    body: BlankProofRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> "Response":
    import random
    import string
    from fastapi.responses import Response as FastAPIResponse
    import httpx

    if body.quantity < 1 or body.quantity > 50:
        raise HTTPException(400, "Quantidade deve ser entre 1 e 50.")

    row = (await session.execute(text("""
        SELECT s.assoc_logo_url, s.community_name, s.assoc_address, s.assoc_cep, a.name, COALESCE(s.proof_stock, 0)
        FROM association_settings s
        JOIN associations a ON a.id = s.association_id
        WHERE s.association_id = :aid
    """), {"aid": str(current.association_id)})).fetchone()
    if not row:
        raise HTTPException(400, "Configurações da associação não encontradas.")
    logo_url, community_name, assoc_address, assoc_cep, assoc_name, proof_stock = row
    if not logo_url:
        raise HTTPException(400, "Logo da associação não cadastrado. Configure no módulo Admin.")
    if proof_stock < body.quantity:
        raise HTTPException(400, f"Estoque insuficiente: {proof_stock} disponível(is).")

    # Ensure blank log table exists
    await session.execute(text("""
        CREATE TABLE IF NOT EXISTS proof_of_residence_blanks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            association_id UUID NOT NULL,
            barcode_code VARCHAR(20) NOT NULL UNIQUE,
            issued_by UUID NOT NULL,
            issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            used_at TIMESTAMPTZ,
            used_by_transaction_id UUID
        )
    """))

    # Generate unique barcodes
    barcodes: list[str] = []
    for _ in range(body.quantity):
        for _attempt in range(20):
            code = "".join(random.choices(string.digits, k=8))
            exists = (await session.execute(
                text("SELECT 1 FROM proof_of_residence_blanks WHERE barcode_code = :c"),
                {"c": code}
            )).fetchone()
            if not exists:
                barcodes.append(code)
                break

    if len(barcodes) < body.quantity:
        raise HTTPException(500, "Não foi possível gerar códigos únicos.")

    # Register each blank in the log and decrement stock
    for code in barcodes:
        await session.execute(text("""
            INSERT INTO proof_of_residence_blanks (association_id, barcode_code, issued_by)
            VALUES (:aid, :code, :uid)
        """), {"aid": str(current.association_id), "code": code, "uid": str(current.user_id)})

    await session.execute(text("""
        UPDATE association_settings SET proof_stock = proof_stock - :qty
        WHERE association_id = :aid
    """), {"qty": body.quantity, "aid": str(current.association_id)})
    await session.commit()

    # Fetch logo
    async with httpx.AsyncClient() as client:
        logo_bytes = (await client.get(logo_url)).content

    # Build barcode images
    from app.services.finance_service import FinanceService
    barcode_data: list[tuple[str, bytes]] = []
    for code in barcodes:
        bc_bytes = FinanceService._build_barcode_image(code)
        barcode_data.append((code, bc_bytes))

    pdf_bytes = FinanceService._build_blank_proof_pdf(
        community_name=community_name or "",
        assoc_name=assoc_name or "",
        assoc_address=assoc_address or "",
        assoc_cep=assoc_cep or "",
        logo_bytes=logo_bytes,
        barcodes=barcode_data,
    )
    fname = f"comprovantes_em_branco_{body.quantity}x.pdf"
    return FastAPIResponse(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.get("/association-profile", summary="Perfil da associação (endereço, nome, contato)")
async def get_association_profile(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from app.models.association import Association as AssocModel
    from sqlmodel import select as _sel
    result = await session.execute(_sel(AssocModel).where(AssocModel.id == current.association_id))
    a = result.scalar_one_or_none()
    if not a:
        return {}
    parts = [a.address_street, a.address_number, a.address_complement, a.address_district, a.address_city]
    address = ", ".join(p for p in parts if p)
    return {
        "name": a.name,
        "address": address or None,
        "address_zip": a.address_zip,
        "phone": a.phone,
    }


@router.post("/reset-balance", summary="Zerar saldo do caixa (atualiza balance_start_date = hoje)")
async def reset_balance(
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import date
    today = date.today()
    await session.execute(
        text("UPDATE associations SET balance_start_date = :d WHERE id = :aid"),
        {"d": today, "aid": str(current.association_id)},
    )
    await session.commit()
    return {"ok": True, "balance_start_date": str(today)}
