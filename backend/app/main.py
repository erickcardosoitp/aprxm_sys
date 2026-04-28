import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import init_db
from app.routers import admin, agent, auth, carriers, cash_boxes, chat, demands, finance, financeiro, geral, mensalidades, packages, porta_a_porta, public, reports, residents, senso, service_orders, superadmin, uploads, transfers
from app.routers import settings as settings_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _run_migrations()
    yield


async def _run_migrations() -> None:
    from sqlalchemy import text
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        await session.execute(text("""
            ALTER TABLE association_settings
                ADD COLUMN IF NOT EXISTS president_name        TEXT,
                ADD COLUMN IF NOT EXISTS president_signature_url TEXT,
                ADD COLUMN IF NOT EXISTS assoc_logo_url        TEXT,
                ADD COLUMN IF NOT EXISTS community_name        TEXT,
                ADD COLUMN IF NOT EXISTS proof_stock           INTEGER DEFAULT 0
        """))
        await session.execute(text("ALTER TABLE residents ADD COLUMN IF NOT EXISTS has_pests BOOLEAN"))
        await session.execute(text("ALTER TABLE residents ADD COLUMN IF NOT EXISTS monthly_payment_day INTEGER"))

        # admin_master role
        await session.execute(text("""
            DO $$ BEGIN
                ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin_master';
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))

        # associations: presidente
        await session.execute(text(
            "ALTER TABLE associations ADD COLUMN IF NOT EXISTS presidente_user_id UUID REFERENCES users(id)"
        ))

        # association_settings: permitir_transferencia
        await session.execute(text(
            "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS permitir_transferencia BOOLEAN DEFAULT FALSE"
        ))

        # transactions: transfer fields
        await session.execute(text(
            "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN DEFAULT FALSE"
        ))
        await session.execute(text(
            "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_counterpart_id UUID"
        ))

        # migration_payments table
        await session.execute(text("""
            DO $$ BEGIN
                CREATE TYPE migration_payment_tipo AS ENUM ('mensalidade', 'acordo');
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS migration_payments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id),
                resident_id UUID NOT NULL REFERENCES residents(id),
                competencia VARCHAR(7) NOT NULL,
                tipo migration_payment_tipo NOT NULL,
                origem VARCHAR(50) NOT NULL DEFAULT 'migracao',
                created_by UUID NOT NULL REFERENCES users(id),
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_migration_payment_period UNIQUE (association_id, resident_id, competencia)
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_migration_payments_association_id ON migration_payments(association_id)"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_migration_payments_resident_id ON migration_payments(resident_id)"
        ))

        # transactions.cash_session_id nullable (saída externa)
        await session.execute(text(
            "ALTER TABLE transactions ALTER COLUMN cash_session_id DROP NOT NULL"
        ))

        # migration_payments new fields
        await session.execute(text(
            "ALTER TABLE migration_payments ADD COLUMN IF NOT EXISTS valor_pago NUMERIC(10,2)"
        ))
        await session.execute(text(
            "ALTER TABLE migration_payments ADD COLUMN IF NOT EXISTS data_pagamento DATE"
        ))

        # association_settings: delinquency_grace_days
        await session.execute(text(
            "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS delinquency_grace_days INTEGER DEFAULT 2"
        ))

        # service_orders new fields
        await session.execute(text(
            "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS assigned_to_name VARCHAR(255)"
        ))
        await session.execute(text(
            "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS energia_eletrica_data JSONB"
        ))
        await session.execute(text(
            "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS impacted_residents JSONB DEFAULT '[]'"
        ))

        # user_role: diretoria
        await session.execute(text("""
            DO $$ BEGIN
                ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'diretoria';
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))

        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS origin VARCHAR(50) DEFAULT 'Sessão de Caixa'"
        ))
        for col in [
            "manual_pix NUMERIC(12,2)",
            "manual_dinheiro NUMERIC(12,2)",
            "manual_total_bruto NUMERIC(12,2)",
            "manual_total_baixas NUMERIC(12,2)",
            "quebra_caixa NUMERIC(12,2)",
            "reviewed_by UUID REFERENCES users(id)",
            "malote_sent_at TIMESTAMPTZ",
        ]:
            await session.execute(text(f"ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS {col}"))

        await session.execute(text(
            "ALTER TABLE cash_boxes ADD COLUMN IF NOT EXISTS is_malote BOOLEAN DEFAULT false NOT NULL"
        ))
        await session.execute(text(
            "ALTER TABLE cash_boxes ADD COLUMN IF NOT EXISTS is_cofre BOOLEAN DEFAULT false NOT NULL"
        ))
        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS quebra_responsavel VARCHAR(200)"
        ))
        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS quebra_assinatura_url TEXT"
        ))
        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS quebra_apurada_at TIMESTAMPTZ"
        ))
        await session.execute(text(
            "ALTER TABLE bank_statements ADD COLUMN IF NOT EXISTS batched_at TIMESTAMPTZ"
        ))

        for ddl in [
            """CREATE TABLE IF NOT EXISTS sangria_destinations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS cash_boxes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                balance NUMERIC(12,2) NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS cash_box_movements (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                cash_box_id UUID NOT NULL REFERENCES cash_boxes(id) ON DELETE CASCADE,
                amount NUMERIC(12,2) NOT NULL,
                movement_type VARCHAR(10) NOT NULL,
                description TEXT NOT NULL,
                created_by UUID REFERENCES users(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS session_transaction_reviews (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                cash_session_id UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
                transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                conferido BOOLEAN NOT NULL DEFAULT false,
                observacao TEXT,
                reviewed_by UUID REFERENCES users(id),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(cash_session_id, transaction_id)
            )""",
        ]:
            await session.execute(text(ddl))

        # porta_a_porta tables
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS porta_a_porta_leads (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                operator_id UUID NOT NULL REFERENCES users(id),
                full_name TEXT NOT NULL,
                phone TEXT,
                cpf TEXT,
                address_street TEXT NOT NULL,
                address_number TEXT NOT NULL,
                address_complement TEXT,
                dependents TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'pending',
                payment_type TEXT NOT NULL DEFAULT 'avista',
                total_installments INT NOT NULL DEFAULT 1,
                monthly_fee NUMERIC(10,2) NOT NULL DEFAULT 20.00,
                notes TEXT,
                resident_id UUID REFERENCES residents(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_pap_leads_assoc ON porta_a_porta_leads(association_id)"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_pap_leads_operator ON porta_a_porta_leads(operator_id)"
        ))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS porta_a_porta_payments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                lead_id UUID NOT NULL REFERENCES porta_a_porta_leads(id) ON DELETE CASCADE,
                installment_number INT NOT NULL DEFAULT 1,
                total_installments INT NOT NULL DEFAULT 1,
                amount NUMERIC(10,2) NOT NULL,
                due_date DATE NOT NULL,
                paid_at TIMESTAMPTZ,
                status TEXT NOT NULL DEFAULT 'pending',
                payment_method TEXT,
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_pap_payments_lead ON porta_a_porta_payments(lead_id)"
        ))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS porta_a_porta_commission_payments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                operator_id UUID NOT NULL,
                paid_by UUID NOT NULL,
                amount NUMERIC(10,2) NOT NULL,
                payment_method VARCHAR(50),
                paid_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                notes TEXT,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_pap_comm_assoc ON porta_a_porta_commission_payments(association_id, operator_id)"
        ))

        # porta_a_porta_leads: commissioned_to
        await session.execute(text(
            "ALTER TABLE porta_a_porta_leads ADD COLUMN IF NOT EXISTS commissioned_to UUID REFERENCES users(id)"
        ))

        # carriers and deliverers tables
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS carriers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_carriers_assoc ON carriers(association_id)"
        ))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS deliverers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                carrier_id UUID REFERENCES carriers(id),
                signature_url TEXT,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_deliverers_assoc ON deliverers(association_id)"
        ))

        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS resident_update_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                resident_id UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                changes JSONB NOT NULL DEFAULT '{}',
                notes TEXT,
                submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                reviewed_at TIMESTAMPTZ,
                reviewed_by UUID REFERENCES users(id)
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_res_upd_req_assoc ON resident_update_requests(association_id, status)"
        ))

        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS delivery_exemption_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                token VARCHAR(8) NOT NULL,
                created_by UUID NOT NULL REFERENCES users(id),
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ,
                used_by UUID REFERENCES users(id),
                package_id UUID REFERENCES packages(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(association_id, token)
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_det_assoc ON delivery_exemption_tokens(association_id, token)"
        ))

        # service_order_tasks: daily records / task board per OS
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS service_order_tasks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
                created_by UUID NOT NULL REFERENCES users(id),
                assigned_to UUID REFERENCES users(id),
                assigned_to_name VARCHAR(255),
                title VARCHAR(255) NOT NULL,
                notes TEXT,
                priority VARCHAR(20) NOT NULL DEFAULT 'medium',
                status VARCHAR(30) NOT NULL DEFAULT 'open',
                due_date DATE,
                checklist JSONB NOT NULL DEFAULT '[]',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_so_tasks_so_id ON service_order_tasks(service_order_id)"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_so_tasks_assoc ON service_order_tasks(association_id)"
        ))

        # porta_a_porta: acordo date range columns
        await session.execute(text(
            "ALTER TABLE porta_a_porta_leads ADD COLUMN IF NOT EXISTS acordo_months INTEGER"
        ))
        await session.execute(text(
            "ALTER TABLE porta_a_porta_leads ADD COLUMN IF NOT EXISTS acordo_date_from VARCHAR(7)"
        ))
        await session.execute(text(
            "ALTER TABLE porta_a_porta_leads ADD COLUMN IF NOT EXISTS acordo_date_to VARCHAR(7)"
        ))

        # demands: Kanban board for task management
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS demands (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                status VARCHAR(30) NOT NULL DEFAULT 'gaveta',
                phase VARCHAR(30) NOT NULL DEFAULT 'pendente',
                priority VARCHAR(20) NOT NULL DEFAULT 'medium',
                assigned_to UUID REFERENCES users(id),
                assigned_to_name VARCHAR(255),
                due_date DATE,
                notes TEXT,
                created_by UUID NOT NULL REFERENCES users(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_demands_assoc ON demands(association_id, status)"
        ))

        # demands: link to service_order + reminder tracking
        await session.execute(text(
            "ALTER TABLE demands ADD COLUMN IF NOT EXISTS service_order_id UUID REFERENCES service_orders(id)"
        ))
        await session.execute(text(
            "ALTER TABLE demands ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_demands_so ON demands(service_order_id) WHERE service_order_id IS NOT NULL"
        ))

        # conselho role
        await session.execute(text("""
            DO $$ BEGIN
                ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'conselho';
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))

        # service_orders: community-wide + address fields
        for col in [
            "community_wide BOOLEAN DEFAULT FALSE",
            "address_street VARCHAR(255)",
            "address_number VARCHAR(20)",
            "address_complement VARCHAR(100)",
        ]:
            await session.execute(text(f"ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS {col}"))

        # chat_messages: corporate chat with 15-day retention
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                sender_id UUID REFERENCES users(id),
                sender_name VARCHAR(255) NOT NULL DEFAULT 'Sistema',
                content TEXT,
                message_type VARCHAR(20) NOT NULL DEFAULT 'text',
                media_url TEXT,
                mention_ids JSONB NOT NULL DEFAULT '[]',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_chat_messages_assoc ON chat_messages(association_id, created_at)"
        ))

        # role_permissions: per-association configurable module access
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS role_permissions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                role VARCHAR(30) NOT NULL,
                module VARCHAR(50) NOT NULL,
                can_view BOOLEAN NOT NULL DEFAULT true,
                can_write BOOLEAN NOT NULL DEFAULT false,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(association_id, role, module)
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_role_permissions_assoc ON role_permissions(association_id, role)"
        ))

        await session.commit()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Sistema de Gestão Comunitária — APRXM",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__, "trace": traceback.format_exc()[-1000:]},
    )


PREFIX = "/api/v1"
app.include_router(auth.router, prefix=PREFIX)
app.include_router(admin.router, prefix=PREFIX)
app.include_router(finance.router, prefix=PREFIX)
app.include_router(packages.router, prefix=PREFIX)
app.include_router(residents.router, prefix=PREFIX)
app.include_router(service_orders.router, prefix=PREFIX)
app.include_router(settings_router.router, prefix=PREFIX)
app.include_router(financeiro.router, prefix=PREFIX)
app.include_router(mensalidades.router, prefix=PREFIX)
app.include_router(geral.router, prefix=PREFIX)
app.include_router(superadmin.router, prefix=PREFIX)
app.include_router(uploads.router, prefix=PREFIX)
app.include_router(transfers.router, prefix=PREFIX)
app.include_router(reports.router, prefix=PREFIX)
app.include_router(public.router, prefix=PREFIX)
app.include_router(senso.router, prefix=PREFIX)
app.include_router(agent.router, prefix=PREFIX)
app.include_router(cash_boxes.router, prefix=PREFIX)
app.include_router(porta_a_porta.router, prefix=PREFIX)
app.include_router(carriers.router, prefix=PREFIX)
app.include_router(demands.router, prefix=PREFIX)
app.include_router(chat.router, prefix=PREFIX)


@app.get("/health", tags=["Sistema"])
async def health() -> dict:
    return {"status": "ok", "version": settings.app_version}
