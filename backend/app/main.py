import asyncio
import time
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.limiter import limiter

from app.config import get_settings
from app.database import init_db
from app.routers import admin, agent, auth, carriers, cash_boxes, chat, crm, daily_tasks, datalake, demands, esc, finance, financeiro, geral, governanca, mensalidades, notifications, packages, painel_auth, public, reports, residents, senso, service_order_phases, service_orders, superadmin, ti, uploads, transfers, webauthn
from app.routers import settings as settings_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _run_migrations()
    yield


# Bump this integer every time a new migration block is added below.
# Cold starts where applied_version == _SCHEMA_VERSION exit in ~2ms (one SELECT).
_SCHEMA_VERSION = 11


async def _run_migrations() -> None:
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    # ── VERSIONING: create tracking table + fast exit if already up-to-date ──
    async with AsyncSessionLocal() as _sv:
        await _sv.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version     INTEGER     PRIMARY KEY,
                applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                description TEXT
            )
        """))
        await _sv.commit()

    async with AsyncSessionLocal() as _sv:
        _applied = (await _sv.execute(text(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
        ))).scalar()
    if _applied >= _SCHEMA_VERSION:
        return  # nothing to do — ~2ms cost on every cold start from here on

    # ── PASSO 1: user_association_roles ───────────────────────────────────────
    # Sessão própria e isolada; nunca bloqueada por outras migrações.
    try:
        async with AsyncSessionLocal() as s0:
            await s0.execute(text("""
                CREATE TABLE IF NOT EXISTS user_association_roles (
                    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    association_id UUID        NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                    role           TEXT        NOT NULL DEFAULT 'operator',
                    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
                    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (user_id, association_id)
                )
            """))
            await s0.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_uar_user ON user_association_roles(user_id)"
            ))
            await s0.execute(text("""
                INSERT INTO user_association_roles (user_id, association_id, role)
                SELECT id, association_id, role FROM users
                ON CONFLICT (user_id, association_id) DO NOTHING
            """))
            await s0.commit()
    except Exception:
        pass  # tabela já existe ou outra instância criou simultaneamente

    # ── PASSO 2: demais migrações ─────────────────────────────────────────────
    async with AsyncSessionLocal() as session:
        # Serialize: only one cold-start instance runs migrations at a time.
        got_lock = (await session.execute(text("SELECT pg_try_advisory_xact_lock(987654321)"))).scalar()
        if not got_lock:
            return

        # Re-check version inside the lock — another instance may have just finished.
        _applied = (await session.execute(text(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
        ))).scalar()
        if _applied >= _SCHEMA_VERSION:
            return

        # ── v1 bootstrap: detect existing production DB ───────────────────────
        # If the last-ever-added column already exists, all DDL was applied by a
        # previous deploy. Record version 1 and skip the entire DDL block.
        _is_existing_db = (await session.execute(text("""
            SELECT COUNT(*) > 0
            FROM information_schema.columns
            WHERE table_name = 'api_request_logs' AND column_name = 'user_id'
        """))).scalar()

        if _is_existing_db:
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (1, 'bootstrap: existing production DB — DDL pre-applied') "
                "ON CONFLICT DO NOTHING"
            ))
            # v2: CRM columns — apply here before returning
            await session.execute(text(
                "ALTER TABLE mensalidades "
                "ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(20) NOT NULL DEFAULT 'cash', "
                "ADD COLUMN IF NOT EXISTS payment_proof_url TEXT"
            ))
            await session.execute(text("""
                DO $$ BEGIN
                    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agente';
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$
            """))
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS agent_visits (
                    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    association_id   UUID NOT NULL REFERENCES associations(id),
                    agent_id         UUID NOT NULL REFERENCES users(id),
                    resident_id      UUID NOT NULL REFERENCES residents(id),
                    visited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    result           VARCHAR(20) NOT NULL CHECK (result IN ('paid','will_pay','absent','refused')),
                    notes            TEXT,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """))
            await session.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_agent_visits_resident ON agent_visits(resident_id, association_id)"
            ))
            await session.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_agent_visits_agent ON agent_visits(agent_id, visited_at)"
            ))
            await session.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_packages_resident_del ON packages(resident_id, delivered_at)"
            ))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (2, 'v2: CRM — payment_channel, agente role, agent_visits') "
                "ON CONFLICT DO NOTHING"
            ))
            # v3: RFM scoring columns on residents
            await session.execute(text(
                "ALTER TABLE residents "
                "ADD COLUMN IF NOT EXISTS risk_score SMALLINT DEFAULT NULL, "
                "ADD COLUMN IF NOT EXISTS rfm_segment VARCHAR(30) DEFAULT NULL, "
                "ADD COLUMN IF NOT EXISTS risk_updated_at TIMESTAMPTZ DEFAULT NULL"
            ))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (3, 'v3: RFM scoring — risk_score, rfm_segment, risk_updated_at') "
                "ON CONFLICT DO NOTHING"
            ))
            # v4: token_version — revogacao de acesso em tempo real
            await session.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0"
            ))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (4, 'v4: users.token_version — revogacao de acesso em tempo real') "
                "ON CONFLICT DO NOTHING"
            ))
            # v5: governanca empresa/ESC — 100% aditivo (nada no codigo atual depende disso ainda)
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS empresas (
                    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name                    VARCHAR(255) NOT NULL,
                    slug                    VARCHAR(100) UNIQUE NOT NULL,
                    financeiro_centralizado BOOLEAN NOT NULL DEFAULT FALSE,
                    plan_name               VARCHAR(50) NOT NULL DEFAULT 'basic',
                    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """))
            await session.execute(text(
                "ALTER TABLE associations ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
            ))
            await session.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_associations_empresa ON associations(empresa_id)"
            ))
            await session.execute(text(
                "ALTER TABLE users ALTER COLUMN association_id DROP NOT NULL"
            ))
            await session.execute(text(
                "ALTER TABLE role_permissions ALTER COLUMN association_id DROP NOT NULL"
            ))
            await session.execute(text(
                "ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
            ))
            await session.execute(text(
                "ALTER TABLE audit_log ALTER COLUMN association_id DROP NOT NULL"
            ))
            await session.execute(text(
                "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
            ))
            await session.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE provisioning_run_type AS ENUM ('create_empresa', 'create_associacao');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$
            """))
            await session.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE provisioning_run_status AS ENUM ('running', 'success', 'failed');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$
            """))
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS provisioning_runs (
                    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    empresa_id   UUID REFERENCES empresas(id),
                    run_type     provisioning_run_type NOT NULL,
                    status       provisioning_run_status NOT NULL DEFAULT 'running',
                    payload      JSONB NOT NULL,
                    steps        JSONB NOT NULL DEFAULT '[]'::jsonb,
                    error_detail TEXT,
                    started_by   UUID NOT NULL REFERENCES users(id),
                    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    finished_at  TIMESTAMPTZ
                )
            """))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (5, 'v5: governanca empresa/ESC — empresas, provisioning_runs, empresa_id (aditivo)') "
                "ON CONFLICT DO NOTHING"
            ))
            # v6: governanca empresa/ESC — migration de dados (coexistencia com is_office)
            # Cria a empresa real, faz backfill de empresa_id em Vaz Lobo/Congonha e promove
            # os usuarios do Escritorio a admin_master. NAO remove is_office/linked_association_slugs
            # (isso so acontece na Fase 7, depois de validado em producao).
            await session.execute(text("""
                DO $$
                DECLARE
                    v_empresa_id UUID;
                    v_escritorio_id UUID;
                    v_anchor_assoc_id UUID;
                    v_migrated_ids UUID[];
                BEGIN
                    INSERT INTO empresas (name, slug, financeiro_centralizado, plan_name)
                    VALUES ('SAPE - Vaz Lobo / Buriti / Congonha', 'sape-vazlobo-congonha', TRUE, 'enterprise')
                    ON CONFLICT (slug) DO NOTHING;

                    SELECT id INTO v_empresa_id FROM empresas WHERE slug = 'sape-vazlobo-congonha';

                    UPDATE associations SET empresa_id = v_empresa_id
                    WHERE slug IN ('vaz-lobo', 'congonha') AND empresa_id IS NULL;

                    -- Migracao dos usuarios do Escritorio depende de is_office (removida
                    -- na v8). So roda se a coluna existir; assim o replay do v6 em DBs ja
                    -- migradas (producao) e no-op e nao quebra o cold start (replay-safe).
                    IF EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_name = 'associations' AND column_name = 'is_office') THEN
                        SELECT id INTO v_escritorio_id FROM associations WHERE slug = 'escritorio' AND is_office = TRUE;
                        SELECT id INTO v_anchor_assoc_id FROM associations WHERE slug = 'vaz-lobo';

                        IF v_escritorio_id IS NOT NULL AND v_anchor_assoc_id IS NOT NULL THEN
                            SELECT ARRAY_AGG(id) INTO v_migrated_ids
                            FROM users WHERE association_id = v_escritorio_id AND is_active = TRUE;

                            IF v_migrated_ids IS NOT NULL THEN
                                UPDATE users
                                SET role = 'admin_master', association_id = NULL, token_version = token_version + 1
                                WHERE id = ANY(v_migrated_ids);

                                INSERT INTO user_association_roles (user_id, association_id, role, is_active)
                                SELECT uid, v_anchor_assoc_id, 'admin_master', TRUE
                                FROM unnest(v_migrated_ids) AS uid
                                ON CONFLICT (user_id, association_id) DO UPDATE
                                    SET role = 'admin_master', is_active = TRUE;

                                DELETE FROM user_association_roles
                                WHERE association_id = v_escritorio_id AND user_id = ANY(v_migrated_ids);
                            END IF;
                        END IF;
                    END IF;
                END $$
            """))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (6, 'v6: governanca empresa/ESC — dados: empresa real, backfill, admin_master') "
                "ON CONFLICT DO NOTHING"
            ))
            # v7: painel-aprxm — auth isolada do app operacional (sistema de
            # provisionamento, uso exclusivo do dono da plataforma).
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS painel_admins (
                    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    email           VARCHAR(255) UNIQUE NOT NULL,
                    hashed_password TEXT NOT NULL,
                    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """))
            # provisioning_runs.started_by passa a referenciar painel_admins,
            # nao users — tabela ainda vazia em producao, troca de FK sem risco.
            await session.execute(text(
                "ALTER TABLE provisioning_runs DROP CONSTRAINT IF EXISTS provisioning_runs_started_by_fkey"
            ))
            await session.execute(text(
                "ALTER TABLE provisioning_runs ADD CONSTRAINT provisioning_runs_started_by_fkey "
                "FOREIGN KEY (started_by) REFERENCES painel_admins(id)"
            ))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (7, 'v7: painel-aprxm — tabela painel_admins, provisioning_runs.started_by -> painel_admins') "
                "ON CONFLICT DO NOTHING"
            ))
            await session.commit()

            # v8: Fase 7c — remocao definitiva do modelo is_office/linked_association_slugs
            # + empresa_id NOT NULL. Associacoes legadas sem empresa_id (ex: escritorio
            # inativo, teste QA) sao VINCULADAS a empresa SAPE — nao deletadas, pois tem
            # dados reais entrelacados (created_by de mensalidades/transacoes etc.).
            # O SET NOT NULL cobre TODAS as linhas (ativas ou nao), por isso o backfill
            # precede o guard e cobre qualquer NULL. Sessao/transacao propria: qualquer
            # falha faz rollback e SEGUE COM A APP NO AR na v7 (mesma protecao do
            # incidente do EmailStr — migracao nunca derruba o cold start).
            try:
                await session.execute(text("""
                    UPDATE associations
                    SET empresa_id = (SELECT id FROM empresas WHERE slug='sape-vazlobo-congonha')
                    WHERE empresa_id IS NULL
                """))
                await session.execute(text("""
                    DO $$
                    DECLARE
                        v_nulls INTEGER;
                    BEGIN
                        SELECT COUNT(*) INTO v_nulls FROM associations WHERE empresa_id IS NULL;
                        IF v_nulls > 0 THEN
                            RAISE EXCEPTION 'Fase 7c abortada: % associacao(oes) sem empresa_id apos backfill', v_nulls;
                        END IF;
                    END $$
                """))
                await session.execute(text(
                    "ALTER TABLE associations ALTER COLUMN empresa_id SET NOT NULL"
                ))
                await session.execute(text(
                    "ALTER TABLE associations DROP COLUMN IF EXISTS is_office"
                ))
                await session.execute(text(
                    "ALTER TABLE associations DROP COLUMN IF EXISTS linked_association_slugs"
                ))
                await session.execute(text(
                    "INSERT INTO schema_migrations (version, description) "
                    "VALUES (8, 'v8: Fase 7c — remove is_office/linked_association_slugs, empresa_id NOT NULL') "
                    "ON CONFLICT DO NOTHING"
                ))
                await session.commit()
            except Exception:
                await session.rollback()

            # v9: Fase 8 — users.empresa_id (todo usuario ligado a uma empresa).
            # Aditivo: coluna nullable + backfill a partir da empresa da associacao
            # do usuario (via users.association_id ou, para empresa-wide sem
            # association_id, via suas memberships em user_association_roles).
            try:
                await session.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
                ))
                await session.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_users_empresa ON users(empresa_id)"
                ))
                # backfill via association_id direto
                await session.execute(text("""
                    UPDATE users u
                    SET empresa_id = a.empresa_id
                    FROM associations a
                    WHERE u.association_id = a.id AND u.empresa_id IS NULL AND a.empresa_id IS NOT NULL
                """))
                # backfill via memberships (usuarios empresa-wide, association_id NULL)
                await session.execute(text("""
                    UPDATE users u
                    SET empresa_id = sub.empresa_id
                    FROM (
                        SELECT uar.user_id, MIN(a.empresa_id::text)::uuid AS empresa_id
                        FROM user_association_roles uar
                        JOIN associations a ON a.id = uar.association_id
                        WHERE a.empresa_id IS NOT NULL
                        GROUP BY uar.user_id
                    ) sub
                    WHERE u.id = sub.user_id AND u.empresa_id IS NULL
                """))
                await session.execute(text(
                    "INSERT INTO schema_migrations (version, description) "
                    "VALUES (9, 'v9: Fase 8 — users.empresa_id + backfill') "
                    "ON CONFLICT DO NOTHING"
                ))
                await session.commit()
            except Exception:
                await session.rollback()

            # v10: Fase 9 — ESC como associacao real (id = empresa_id) + landing
            # por ultima unidade usada. Aditivo: coluna nullable + linha ESC por
            # empresa (idempotente) + remap generico e seguro de empresa-wide sem
            # associacao-ancora para a linha ESC. Remap por-pessoa (roles/unidades
            # especificas) NAO entra aqui — e feito por script revisado a parte.
            try:
                await session.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_association_id UUID REFERENCES associations(id)"
                ))
                # linha ESC por empresa: id = empresa_id (a propria igualdade
                # identifica o Escritorio, sem coluna extra). slug unico global.
                await session.execute(text("""
                    INSERT INTO associations (id, empresa_id, name, slug, is_active)
                    SELECT e.id, e.id, 'Escritório', e.slug || '-escritorio', TRUE
                    FROM empresas e
                    ON CONFLICT (id) DO NOTHING
                """))
                # empresa-wide sem associacao-ancora (admin_master/superadmin com
                # association_id NULL) passa a ficar estacionado na linha ESC.
                await session.execute(text("""
                    UPDATE users
                    SET association_id = empresa_id
                    WHERE empresa_id IS NOT NULL
                      AND association_id IS NULL
                      AND role IN ('admin_master', 'superadmin')
                """))
                await session.execute(text(
                    "INSERT INTO schema_migrations (version, description) "
                    "VALUES (10, 'v10: Fase 9 — linha ESC (id=empresa_id) + last_association_id + remap empresa-wide') "
                    "ON CONFLICT DO NOTHING"
                ))
                await session.commit()
            except Exception:
                await session.rollback()

            # v11: Fase 11 — centralizacao administrativa no ESC. Aditivo: categoria
            # de transacao e forma de pagamento passam a poder ser da empresa
            # (empresa_id preenchido = compartilhada por todas as unidades);
            # empresas.access_groups (template unico de permissao); notifications
            # ganha empresa_id (marca broadcast). role_permissions.empresa_id e
            # audit_log.empresa_id ja existem desde a v5.
            try:
                await session.execute(text(
                    "ALTER TABLE transaction_categories ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
                ))
                await session.execute(text(
                    "ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
                ))
                # afrouxa association_id (aditivo): categoria/forma de nivel empresa
                # tem association_id NULL + empresa_id preenchido. Retrocompativel —
                # o codigo atual sempre insere association_id.
                await session.execute(text(
                    "ALTER TABLE transaction_categories ALTER COLUMN association_id DROP NOT NULL"
                ))
                await session.execute(text(
                    "ALTER TABLE payment_methods ALTER COLUMN association_id DROP NOT NULL"
                ))
                await session.execute(text(
                    "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS access_groups JSONB NOT NULL DEFAULT '{}'::jsonb"
                ))
                await session.execute(text(
                    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
                ))
                await session.execute(text(
                    "INSERT INTO schema_migrations (version, description) "
                    "VALUES (11, 'v11: Fase 11 — centralizacao admin (categoria/forma/access_groups/notifications empresa_id)') "
                    "ON CONFLICT DO NOTHING"
                ))
                await session.commit()
            except Exception:
                await session.rollback()
            return

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

        # users: permission flags
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS restrict_edit_tx BOOLEAN NOT NULL DEFAULT FALSE"))
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS restrict_reverse_tx BOOLEAN NOT NULL DEFAULT FALSE"))
        await session.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS require_own_cash_session BOOLEAN NOT NULL DEFAULT FALSE"))

        # associations: balance_start_date para saldo unificado do caixa
        await session.execute(text(
            "ALTER TABLE associations ADD COLUMN IF NOT EXISTS balance_start_date DATE DEFAULT '2026-06-01'"
        ))

        # cash_sessions: campos de conferencia melhorada
        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS quebra_motivo TEXT"
        ))
        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS dinheiro_contado NUMERIC(12,2)"
        ))
        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS pix_contado NUMERIC(12,2)"
        ))
        await session.execute(text(
            "ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS assinatura_conferencia_url TEXT"
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
        await session.execute(text(
            "UPDATE deliverers SET active = TRUE WHERE active IS NULL"
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

        # push_subscriptions: VAPID push device registration
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(user_id, endpoint)
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_push_subs_user ON push_subscriptions(user_id)"
        ))

        # notifications: in-app notification inbox
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS notifications (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                body TEXT NOT NULL,
                type VARCHAR(30) NOT NULL DEFAULT 'info',
                data JSONB NOT NULL DEFAULT '{}',
                read_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id, association_id, created_at DESC)"
        ))

        # webauthn_credentials: passkey / biometric login
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS webauthn_credentials (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                credential_id TEXT NOT NULL,
                public_key BYTEA NOT NULL,
                sign_count BIGINT NOT NULL DEFAULT 0,
                device_name TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(credential_id)
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_webauthn_user ON webauthn_credentials(user_id)"
        ))

        # webauthn_challenges: temporary challenge storage (TTL 5 min)
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS webauthn_challenges (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                challenge TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
            )
        """))

        # Allow amount=0 for exempt/isento transactions
        await session.execute(text("""
            ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_amount_check
        """))
        await session.execute(text("""
            ALTER TABLE transactions ADD CONSTRAINT transactions_amount_check CHECK (amount >= 0)
        """))

        # income_subtype: garantir que toda transação income tem subtype (CHECK, não NOT NULL — expense/sangria ficam NULL)
        await session.execute(text("""
            DO $$ BEGIN
                ALTER TABLE transactions
                    ADD CONSTRAINT chk_income_subtype_required
                    CHECK (type != 'income' OR income_subtype IS NOT NULL);
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))

        # transactions: payer_name + payer_entity_id para rastreabilidade estruturada de pagadores PIX
        for col in [
            "payer_name TEXT",
            "payer_entity_id UUID REFERENCES residents(id) ON DELETE SET NULL",
        ]:
            await session.execute(text(f"ALTER TABLE transactions ADD COLUMN IF NOT EXISTS {col}"))

        # Migrar payer_name existente: extrair de mensalidades.notes (padrão "Pagador PIX: {nome}")
        await session.execute(text("""
            UPDATE transactions t
            SET payer_name = REGEXP_REPLACE(m.notes, '^Pagador PIX: (.+?)( \\|.*)?$', '\\1')
            FROM mensalidades m
            WHERE m.transaction_id = t.id
              AND m.notes LIKE 'Pagador PIX:%'
              AND t.payer_name IS NULL
        """))

        # pix_learning_map: tabela de aprendizado para conciliação PIX
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS pix_learning_map (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                bank_name TEXT NOT NULL,
                resident_id UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
                resident_name TEXT NOT NULL,
                confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
                match_count INT NOT NULL DEFAULT 1,
                last_matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (association_id, bank_name, resident_id)
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_pix_learning_assoc ON pix_learning_map(association_id)"
        ))

        # daily_tasks: reminded_at para evitar duplicidade de lembretes via cron
        await session.execute(text(
            "ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ"
        ))

        # daily_tasks: adicionar status in_progress
        await session.execute(text(
            "ALTER TABLE daily_tasks DROP CONSTRAINT IF EXISTS daily_tasks_status_check"
        ))
        await session.execute(text("""
            ALTER TABLE daily_tasks ADD CONSTRAINT daily_tasks_status_check
              CHECK (status IN ('pending', 'in_progress', 'done'))
        """))

        # Merge duplicate users (mesmo email, assocs diferentes)
        await session.execute(text("""
            DO $$
            DECLARE
                dup_email TEXT;
                winner    UUID;
                loser     UUID;
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM users GROUP BY email HAVING COUNT(*) > 1) THEN
                    RETURN;
                END IF;
                FOR dup_email IN SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1 LOOP
                    SELECT id INTO winner FROM users WHERE email = dup_email AND is_active = TRUE
                    ORDER BY CASE role::text
                        WHEN 'superadmin'        THEN 1 WHEN 'admin_master' THEN 2
                        WHEN 'admin'             THEN 3 WHEN 'diretoria'    THEN 4
                        WHEN 'conselho'          THEN 5 WHEN 'conferente'   THEN 6
                        WHEN 'diretoria_adjunta' THEN 7 ELSE 8
                    END, created_at LIMIT 1;
                    FOR loser IN SELECT id FROM users WHERE email = dup_email AND id != winner LOOP
                        -- herdar associação do loser para o winner
                        INSERT INTO user_association_roles (user_id, association_id, role)
                        SELECT winner, association_id, role FROM users WHERE id = loser
                        ON CONFLICT (user_id, association_id) DO NOTHING;
                        -- redirecionar TODOS os FKs para users(id)
                        UPDATE association_settings SET president_user_id = winner WHERE president_user_id = loser;
                        UPDATE association_settings SET updated_by         = winner WHERE updated_by         = loser;
                        UPDATE associations         SET presidente_user_id = winner WHERE presidente_user_id = loser;
                        UPDATE audit_log            SET user_id            = winner WHERE user_id            = loser;
                        UPDATE cash_box_movements   SET created_by         = winner WHERE created_by         = loser;
                        UPDATE cash_sessions        SET opened_by          = winner WHERE opened_by          = loser;
                        UPDATE cash_sessions        SET closed_by          = winner WHERE closed_by          = loser;
                        UPDATE cash_sessions        SET reviewed_by        = winner WHERE reviewed_by        = loser;
                        UPDATE daily_task_comments  SET created_by         = winner WHERE created_by         = loser;
                        UPDATE daily_tasks          SET created_by         = winner WHERE created_by         = loser;
                        UPDATE daily_tasks          SET assigned_to        = winner WHERE assigned_to        = loser;
                        UPDATE delivery_exemption_tokens SET created_by    = winner WHERE created_by         = loser;
                        UPDATE delivery_exemption_tokens SET used_by       = winner WHERE used_by            = loser;
                        UPDATE demands              SET created_by         = winner WHERE created_by         = loser;
                        UPDATE demands              SET assigned_to        = winner WHERE assigned_to        = loser;
                        UPDATE inventory_records    SET signed_by          = winner WHERE signed_by          = loser;
                        UPDATE inventory_records    SET cancelled_by       = winner WHERE cancelled_by       = loser;
                        UPDATE mensalidades         SET created_by         = winner WHERE created_by         = loser;
                        UPDATE migration_payments   SET created_by         = winner WHERE created_by         = loser;
                        UPDATE notifications        SET user_id            = winner WHERE user_id            = loser;
                        UPDATE package_events       SET created_by         = winner WHERE created_by         = loser;
                        UPDATE packages             SET received_by        = winner WHERE received_by        = loser;
                        UPDATE packages             SET delivered_by       = winner WHERE delivered_by       = loser;
                        UPDATE pix_learning_map     SET confirmed_by       = winner WHERE confirmed_by       = loser;
                        UPDATE porta_a_porta_leads  SET operator_id        = winner WHERE operator_id        = loser;
                        UPDATE porta_a_porta_leads  SET commissioned_to    = winner WHERE commissioned_to    = loser;
                        UPDATE porta_a_porta_commission_payments SET operator_id = winner WHERE operator_id  = loser;
                        UPDATE porta_a_porta_commission_payments SET paid_by     = winner WHERE paid_by      = loser;
                        UPDATE resident_update_requests SET reviewed_by    = winner WHERE reviewed_by        = loser;
                        UPDATE residents            SET created_by         = winner WHERE created_by         = loser;
                        UPDATE service_order_comments SET created_by       = winner WHERE created_by         = loser;
                        UPDATE service_order_history  SET changed_by       = winner WHERE changed_by         = loser;
                        UPDATE service_order_tasks  SET created_by         = winner WHERE created_by         = loser;
                        UPDATE service_order_tasks  SET assigned_to        = winner WHERE assigned_to        = loser;
                        UPDATE service_orders       SET created_by         = winner WHERE created_by         = loser;
                        UPDATE service_orders       SET assigned_to        = winner WHERE assigned_to        = loser;
                        UPDATE service_orders       SET requester_user_id  = winner WHERE requester_user_id  = loser;
                        UPDATE session_transaction_reviews SET reviewed_by = winner WHERE reviewed_by        = loser;
                        UPDATE so_presence          SET user_id            = winner WHERE user_id            = loser;
                        UPDATE transactions         SET created_by         = winner WHERE created_by         = loser;
                        UPDATE transactions         SET approved_by        = winner WHERE approved_by        = loser;
                        UPDATE transactions         SET reversed_by        = winner WHERE reversed_by        = loser;
                        UPDATE chat_messages        SET sender_id          = winner WHERE sender_id          = loser;
                        UPDATE webauthn_credentials SET user_id            = winner WHERE user_id            = loser;
                        UPDATE webauthn_challenges  SET user_id            = winner WHERE user_id            = loser;
                        -- chat_message_reads: pode ter unique(user_id, message_id)
                        INSERT INTO chat_message_reads (user_id, message_id, read_at)
                        SELECT winner, message_id, read_at FROM chat_message_reads WHERE user_id = loser
                        ON CONFLICT DO NOTHING;
                        DELETE FROM chat_message_reads WHERE user_id = loser;
                        -- refresh_tokens: invalidar tokens do loser
                        DELETE FROM refresh_tokens WHERE user_id = loser;
                        -- push_subscriptions: evitar conflito de endpoint
                        INSERT INTO push_subscriptions (association_id,user_id,endpoint,p256dh,auth,created_at)
                        SELECT association_id,winner,endpoint,p256dh,auth,created_at
                        FROM push_subscriptions WHERE user_id = loser
                        ON CONFLICT (user_id, endpoint) DO NOTHING;
                        DELETE FROM push_subscriptions WHERE user_id = loser;
                        DELETE FROM user_association_roles WHERE user_id = loser;
                        DELETE FROM users WHERE id = loser;
                        -- merge muda escopo de acesso do winner (herda membership do loser) -
                        -- incrementa token_version pra invalidar tokens antigos dele
                        UPDATE users SET token_version = token_version + 1 WHERE id = winner;
                    END LOOP;
                END LOOP;
            END $$;
        """))
        # UNIQUE em users.email (seguro após merge)
        await session.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_users_email') THEN
                    IF NOT EXISTS (SELECT 1 FROM users GROUP BY email HAVING COUNT(*) > 1) THEN
                        EXECUTE 'CREATE UNIQUE INDEX uq_users_email ON users(email)';
                    END IF;
                END IF;
            END $$;
        """))

        # Idempotência: constraints UNIQUE para prevenir duplicatas e erros 500 em re-importação
        await session.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_bs_dedup
            ON bank_statements (association_id, bank, date, COALESCE(name,''), amount)
        """))
        await session.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliations_stmt
            ON reconciliations (statement_id)
        """))

        # refresh_tokens — suporte a refresh token de 7 dias
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                association_id UUID        NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
                token_hash     TEXT        NOT NULL UNIQUE,
                expires_at     TIMESTAMPTZ NOT NULL,
                revoked        BOOLEAN     NOT NULL DEFAULT FALSE,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user ON refresh_tokens(user_id)"
        ))

        # etl_runs — log de execucoes do pipeline de Data Lake
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS etl_runs (
                id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                run_date     DATE        NOT NULL,
                mode         VARCHAR(20) NOT NULL DEFAULT 'incremental',
                status       VARCHAR(20) NOT NULL DEFAULT 'running',
                started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at TIMESTAMPTZ,
                duration_s   NUMERIC(8,1),
                bronze_rows  INTEGER     DEFAULT 0,
                silver_rows  INTEGER     DEFAULT 0,
                gold_files   INTEGER     DEFAULT 0,
                neon_kb      NUMERIC(8,1) DEFAULT 0,
                error_msg    TEXT,
                triggered_by VARCHAR(50) DEFAULT 'cron'
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_etl_runs_date ON etl_runs(run_date DESC)"
        ))

        # etl_task_runs — log por tarefa individual (Bronze/Silver/Gold/Validate)
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS etl_task_runs (
                id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                run_id      UUID        NOT NULL REFERENCES etl_runs(id) ON DELETE CASCADE,
                task_name   VARCHAR(50) NOT NULL,
                status      VARCHAR(20) NOT NULL DEFAULT 'pending',
                started_at  TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                duration_s  NUMERIC(8,1),
                rows_in     INTEGER DEFAULT 0,
                rows_out    INTEGER DEFAULT 0,
                detail      JSONB
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_etl_task_runs_run ON etl_task_runs(run_id)"
        ))

        await session.execute(text(
            "ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS user_id UUID"
        ))

        # Mark v1+v2 as applied — fresh DB path
        await session.execute(text(
            "INSERT INTO schema_migrations (version, description) "
            "VALUES (1, 'v1: full DDL applied on fresh database') "
            "ON CONFLICT DO NOTHING"
        ))
        await session.execute(text(
            "ALTER TABLE mensalidades "
            "ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(20) NOT NULL DEFAULT 'cash', "
            "ADD COLUMN IF NOT EXISTS payment_proof_url TEXT"
        ))
        await session.execute(text("""
            DO $$ BEGIN
                ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agente';
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS agent_visits (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                association_id   UUID NOT NULL REFERENCES associations(id),
                agent_id         UUID NOT NULL REFERENCES users(id),
                resident_id      UUID NOT NULL REFERENCES residents(id),
                visited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                result           VARCHAR(20) NOT NULL CHECK (result IN ('paid','will_pay','absent','refused')),
                notes            TEXT,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_agent_visits_resident ON agent_visits(resident_id, association_id)"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_agent_visits_agent ON agent_visits(agent_id, visited_at)"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_packages_resident_del ON packages(resident_id, delivered_at)"
        ))
        await session.execute(text(
            "INSERT INTO schema_migrations (version, description) "
            "VALUES (2, 'v2: CRM — payment_channel, agente role, agent_visits') "
            "ON CONFLICT DO NOTHING"
        ))
        # v3: RFM scoring columns on residents
        await session.execute(text(
            "ALTER TABLE residents "
            "ADD COLUMN IF NOT EXISTS risk_score SMALLINT DEFAULT NULL, "
            "ADD COLUMN IF NOT EXISTS rfm_segment VARCHAR(30) DEFAULT NULL, "
            "ADD COLUMN IF NOT EXISTS risk_updated_at TIMESTAMPTZ DEFAULT NULL"
        ))
        await session.execute(text(
            "INSERT INTO schema_migrations (version, description) "
            "VALUES (3, 'v3: RFM scoring — risk_score, rfm_segment, risk_updated_at') "
            "ON CONFLICT DO NOTHING"
        ))
        # v5: governanca empresa/ESC — 100% aditivo (mesmo bloco do ramo _is_existing_db)
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS empresas (
                id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name                    VARCHAR(255) NOT NULL,
                slug                    VARCHAR(100) UNIQUE NOT NULL,
                financeiro_centralizado BOOLEAN NOT NULL DEFAULT FALSE,
                plan_name               VARCHAR(50) NOT NULL DEFAULT 'basic',
                is_active               BOOLEAN NOT NULL DEFAULT TRUE,
                created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "ALTER TABLE associations ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
        ))
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_associations_empresa ON associations(empresa_id)"
        ))
        await session.execute(text(
            "ALTER TABLE users ALTER COLUMN association_id DROP NOT NULL"
        ))
        await session.execute(text(
            "ALTER TABLE role_permissions ALTER COLUMN association_id DROP NOT NULL"
        ))
        await session.execute(text(
            "ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
        ))
        await session.execute(text(
            "ALTER TABLE audit_log ALTER COLUMN association_id DROP NOT NULL"
        ))
        await session.execute(text(
            "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
        ))
        await session.execute(text("""
            DO $$ BEGIN
                CREATE TYPE provisioning_run_type AS ENUM ('create_empresa', 'create_associacao');
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))
        await session.execute(text("""
            DO $$ BEGIN
                CREATE TYPE provisioning_run_status AS ENUM ('running', 'success', 'failed');
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$
        """))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS provisioning_runs (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                empresa_id   UUID REFERENCES empresas(id),
                run_type     provisioning_run_type NOT NULL,
                status       provisioning_run_status NOT NULL DEFAULT 'running',
                payload      JSONB NOT NULL,
                steps        JSONB NOT NULL DEFAULT '[]'::jsonb,
                error_detail TEXT,
                started_by   UUID NOT NULL REFERENCES users(id),
                started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                finished_at  TIMESTAMPTZ
            )
        """))
        await session.execute(text(
            "INSERT INTO schema_migrations (version, description) "
            "VALUES (5, 'v5: governanca empresa/ESC — empresas, provisioning_runs, empresa_id (aditivo)') "
            "ON CONFLICT DO NOTHING"
        ))
        # v6: mesmo bloco de dados do ramo _is_existing_db (no-op se nao houver
        # associations vaz-lobo/congonha/escritorio seedadas nesta DB)
        await session.execute(text("""
            DO $$
            DECLARE
                v_empresa_id UUID;
                v_escritorio_id UUID;
                v_anchor_assoc_id UUID;
                v_migrated_ids UUID[];
            BEGIN
                INSERT INTO empresas (name, slug, financeiro_centralizado, plan_name)
                VALUES ('SAPE - Vaz Lobo / Buriti / Congonha', 'sape-vazlobo-congonha', TRUE, 'enterprise')
                ON CONFLICT (slug) DO NOTHING;

                SELECT id INTO v_empresa_id FROM empresas WHERE slug = 'sape-vazlobo-congonha';

                UPDATE associations SET empresa_id = v_empresa_id
                WHERE slug IN ('vaz-lobo', 'congonha') AND empresa_id IS NULL;

                -- Migracao dos usuarios do Escritorio depende de is_office (removida
                -- na v8). So roda se a coluna existir; assim o replay do v6 em DBs ja
                -- migradas (producao) e no-op e nao quebra o cold start (replay-safe).
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'associations' AND column_name = 'is_office') THEN
                    SELECT id INTO v_escritorio_id FROM associations WHERE slug = 'escritorio' AND is_office = TRUE;
                    SELECT id INTO v_anchor_assoc_id FROM associations WHERE slug = 'vaz-lobo';

                    IF v_escritorio_id IS NOT NULL AND v_anchor_assoc_id IS NOT NULL THEN
                        SELECT ARRAY_AGG(id) INTO v_migrated_ids
                        FROM users WHERE association_id = v_escritorio_id AND is_active = TRUE;

                        IF v_migrated_ids IS NOT NULL THEN
                            UPDATE users
                            SET role = 'admin_master', association_id = NULL, token_version = token_version + 1
                            WHERE id = ANY(v_migrated_ids);

                            INSERT INTO user_association_roles (user_id, association_id, role, is_active)
                            SELECT uid, v_anchor_assoc_id, 'admin_master', TRUE
                            FROM unnest(v_migrated_ids) AS uid
                            ON CONFLICT (user_id, association_id) DO UPDATE
                                SET role = 'admin_master', is_active = TRUE;

                            DELETE FROM user_association_roles
                            WHERE association_id = v_escritorio_id AND user_id = ANY(v_migrated_ids);
                        END IF;
                    END IF;
                END IF;
            END $$
        """))
        await session.execute(text(
            "INSERT INTO schema_migrations (version, description) "
            "VALUES (6, 'v6: governanca empresa/ESC — dados: empresa real, backfill, admin_master') "
            "ON CONFLICT DO NOTHING"
        ))
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS painel_admins (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email           VARCHAR(255) UNIQUE NOT NULL,
                hashed_password TEXT NOT NULL,
                is_active       BOOLEAN NOT NULL DEFAULT TRUE,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await session.execute(text(
            "ALTER TABLE provisioning_runs DROP CONSTRAINT IF EXISTS provisioning_runs_started_by_fkey"
        ))
        await session.execute(text(
            "ALTER TABLE provisioning_runs ADD CONSTRAINT provisioning_runs_started_by_fkey "
            "FOREIGN KEY (started_by) REFERENCES painel_admins(id)"
        ))
        await session.execute(text(
            "INSERT INTO schema_migrations (version, description) "
            "VALUES (7, 'v7: painel-aprxm — tabela painel_admins, provisioning_runs.started_by -> painel_admins') "
            "ON CONFLICT DO NOTHING"
        ))
        await session.commit()

        # v8: mesmo bloco do ramo _is_existing_db (Fase 7c) — backfill de empresa_id
        # das associacoes legadas para a SAPE, depois SET NOT NULL + drop das colunas
        # antigas. Sessao propria: falha faz rollback sem derrubar a app.
        try:
            await session.execute(text("""
                UPDATE associations
                SET empresa_id = (SELECT id FROM empresas WHERE slug='sape-vazlobo-congonha')
                WHERE empresa_id IS NULL
            """))
            await session.execute(text("""
                DO $$
                DECLARE
                    v_nulls INTEGER;
                BEGIN
                    SELECT COUNT(*) INTO v_nulls FROM associations WHERE empresa_id IS NULL;
                    IF v_nulls > 0 THEN
                        RAISE EXCEPTION 'Fase 7c abortada: % associacao(oes) sem empresa_id apos backfill', v_nulls;
                    END IF;
                END $$
            """))
            await session.execute(text(
                "ALTER TABLE associations ALTER COLUMN empresa_id SET NOT NULL"
            ))
            await session.execute(text(
                "ALTER TABLE associations DROP COLUMN IF EXISTS is_office"
            ))
            await session.execute(text(
                "ALTER TABLE associations DROP COLUMN IF EXISTS linked_association_slugs"
            ))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (8, 'v8: Fase 7c — remove is_office/linked_association_slugs, empresa_id NOT NULL') "
                "ON CONFLICT DO NOTHING"
            ))
            await session.commit()
        except Exception:
            await session.rollback()

        # v9: users.empresa_id (mesmo bloco do ramo _is_existing_db)
        try:
            await session.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
            ))
            await session.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_users_empresa ON users(empresa_id)"
            ))
            await session.execute(text("""
                UPDATE users u
                SET empresa_id = a.empresa_id
                FROM associations a
                WHERE u.association_id = a.id AND u.empresa_id IS NULL AND a.empresa_id IS NOT NULL
            """))
            await session.execute(text("""
                UPDATE users u
                SET empresa_id = sub.empresa_id
                FROM (
                    SELECT uar.user_id, MIN(a.empresa_id::text)::uuid AS empresa_id
                    FROM user_association_roles uar
                    JOIN associations a ON a.id = uar.association_id
                    WHERE a.empresa_id IS NOT NULL
                    GROUP BY uar.user_id
                ) sub
                WHERE u.id = sub.user_id AND u.empresa_id IS NULL
            """))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (9, 'v9: Fase 8 — users.empresa_id + backfill') "
                "ON CONFLICT DO NOTHING"
            ))
            await session.commit()
        except Exception:
            await session.rollback()

        # v10: Fase 9 — mesmo bloco do ramo _is_existing_db (linha ESC + last_association_id)
        try:
            await session.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_association_id UUID REFERENCES associations(id)"
            ))
            await session.execute(text("""
                INSERT INTO associations (id, empresa_id, name, slug, is_active)
                SELECT e.id, e.id, 'Escritório', e.slug || '-escritorio', TRUE
                FROM empresas e
                ON CONFLICT (id) DO NOTHING
            """))
            await session.execute(text("""
                UPDATE users
                SET association_id = empresa_id
                WHERE empresa_id IS NOT NULL
                  AND association_id IS NULL
                  AND role IN ('admin_master', 'superadmin')
            """))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (10, 'v10: Fase 9 — linha ESC (id=empresa_id) + last_association_id + remap empresa-wide') "
                "ON CONFLICT DO NOTHING"
            ))
            await session.commit()
        except Exception:
            await session.rollback()

        # v11: Fase 11 — mesmo bloco do ramo _is_existing_db (centralizacao admin)
        try:
            await session.execute(text(
                "ALTER TABLE transaction_categories ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
            ))
            await session.execute(text(
                "ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
            ))
            await session.execute(text(
                "ALTER TABLE transaction_categories ALTER COLUMN association_id DROP NOT NULL"
            ))
            await session.execute(text(
                "ALTER TABLE payment_methods ALTER COLUMN association_id DROP NOT NULL"
            ))
            await session.execute(text(
                "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS access_groups JSONB NOT NULL DEFAULT '{}'::jsonb"
            ))
            await session.execute(text(
                "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id)"
            ))
            await session.execute(text(
                "INSERT INTO schema_migrations (version, description) "
                "VALUES (11, 'v11: Fase 11 — centralizacao admin (categoria/forma/access_groups/notifications empresa_id)') "
                "ON CONFLICT DO NOTHING"
            ))
            await session.commit()
        except Exception:
            await session.rollback()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Sistema de Gestão Comunitária — APRXM",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Association-ID", "X-Device-Token"],
)

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
}

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    for key, value in _SECURITY_HEADERS.items():
        response.headers[key] = value
    return response

_SKIP_LOG = {
    "/health", "/api/v1/health",
    "/api/v1/notifications/unread-count", "/api/v1/chat/unread-count",
    "/", "/favicon.ico", "/favicon.png", "/robots.txt",
}

def _extract_user_id_from_request(request: Request) -> str | None:
    try:
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return None
        from app.core.security import decode_access_token
        payload = decode_access_token(auth_header[7:])
        return payload.get("sub")
    except Exception:
        return None


async def _log_request(path: str, method: str, status_code: int, duration_ms: int, user_id: str | None) -> None:
    try:
        from app.database import AsyncSessionLocal
        from sqlalchemy import text as _t
        async with AsyncSessionLocal() as s:
            await s.execute(_t(
                "INSERT INTO api_request_logs (path, method, status_code, duration_ms, user_id)"
                " VALUES (:p, :m, :s, :d, :u)"
            ), {"p": path, "m": method, "s": status_code, "d": duration_ms, "u": user_id})
            await s.commit()
    except Exception:
        pass


@app.middleware("http")
async def request_timing_middleware(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = int((time.monotonic() - start) * 1000)
    path = request.url.path
    if path not in _SKIP_LOG and not path.startswith("/api/v1/ti/"):
        user_id = _extract_user_id_from_request(request)
        # Fire-and-forget: não bloquear a resposta esperando o INSERT do log.
        asyncio.create_task(_log_request(path, request.method, response.status_code, duration_ms, user_id))
    return response


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
app.include_router(service_order_phases.router, prefix=PREFIX)
app.include_router(daily_tasks.router, prefix=PREFIX)
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
app.include_router(carriers.router, prefix=PREFIX)
app.include_router(demands.router, prefix=PREFIX)
app.include_router(chat.router, prefix=PREFIX)
app.include_router(notifications.router, prefix=PREFIX)
app.include_router(webauthn.router, prefix=PREFIX)
app.include_router(datalake.router, prefix=PREFIX)
app.include_router(ti.router, prefix=PREFIX)
app.include_router(crm.router, prefix=PREFIX)
app.include_router(governanca.router, prefix=PREFIX)
app.include_router(esc.router, prefix=PREFIX)
app.include_router(painel_auth.router, prefix=PREFIX)


@app.get("/health", tags=["Sistema"])
@app.get("/api/v1/health", tags=["Sistema"])
async def health() -> dict:
    return {"status": "ok", "version": settings.app_version}

@app.get("/", include_in_schema=False)
async def root():
    return {"status": "ok"}

@app.get("/favicon.ico", include_in_schema=False)
@app.get("/favicon.png", include_in_schema=False)
@app.get("/robots.txt", include_in_schema=False)
async def static_stubs():
    from fastapi.responses import Response
    return Response(status_code=204)
