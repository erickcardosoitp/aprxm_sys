--
-- PostgreSQL database dump
-- Regenerado direto do banco de producao (Neon) via pg_dump --schema-only em 2026-07-12.
-- Este arquivo e so documentacao/referencia - a verdade do schema em runtime
-- vive nas migrations em database/migrations/*.sql e no bootstrap em
-- backend/app/main.py (_is_existing_db). Nao use este arquivo pra recriar o
-- banco do zero sem revisar - ele reflete o estado atual, nao um script de setup.
--

-- Dumped from database version 16.14 (3cbc516)
-- Dumped by pg_dump version 16.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: analytics; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA analytics;


--
-- Name: pg_session_jwt; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_session_jwt WITH SCHEMA public;


--
-- Name: EXTENSION pg_session_jwt; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_session_jwt IS 'pg_session_jwt: manage authentication sessions using JWTs';


--
-- Name: neon_auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA neon_auth;


--
-- Name: pgrst; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgrst;


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: cash_session_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cash_session_status AS ENUM (
    'open',
    'closed',
    'conferido',
    'cancelled'
);


--
-- Name: income_subtype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.income_subtype AS ENUM (
    'proof_of_residence',
    'delivery_fee',
    'mensalidade',
    'other'
);


--
-- Name: mensalidade_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mensalidade_status AS ENUM (
    'pending',
    'paid',
    'overdue',
    'agreement'
);


--
-- Name: migration_payment_tipo; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.migration_payment_tipo AS ENUM (
    'mensalidade',
    'acordo'
);


--
-- Name: package_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.package_status AS ENUM (
    'received',
    'notified',
    'delivered',
    'returned',
    'reversed'
);


--
-- Name: resident_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resident_status AS ENUM (
    'active',
    'inactive',
    'suspended'
);


--
-- Name: resident_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resident_type AS ENUM (
    'member',
    'guest',
    'dependent'
);


--
-- Name: service_order_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_order_priority AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: service_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_order_status AS ENUM (
    'draft',
    'pending',
    'in_progress',
    'resolved',
    'archived',
    'cancelled'
);


--
-- Name: transaction_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.transaction_type AS ENUM (
    'income',
    'expense',
    'sangria'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'superadmin',
    'admin',
    'operator',
    'viewer',
    'conferente',
    'diretoria_adjunta',
    'admin_master',
    'diretoria',
    'conselho',
    'agente'
);


--
-- Name: pre_config(); Type: FUNCTION; Schema: pgrst; Owner: -
--

CREATE FUNCTION pgrst.pre_config() RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  SELECT
      set_config('pgrst.db_schemas', 'public', true)
    , set_config('pgrst.db_aggregates_enabled', 'true', true)
    , set_config('pgrst.db_anon_role', 'anonymous', true)
    , set_config('pgrst.jwt_role_claim_key', '.role', true)
$$;


--
-- Name: check_package_resident_tenant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_package_resident_tenant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        DECLARE
            resident_assoc UUID;
            delivered_to_assoc UUID;
        BEGIN
            SELECT association_id INTO resident_assoc FROM residents WHERE id = NEW.resident_id;
            IF resident_assoc IS NOT NULL AND resident_assoc != NEW.association_id THEN
                RAISE EXCEPTION 'packages.association_id (%) nao bate com residents.association_id (%) do resident_id %', NEW.association_id, resident_assoc, NEW.resident_id;
            END IF;
            IF NEW.delivered_to_resident_id IS NOT NULL THEN
                SELECT association_id INTO delivered_to_assoc FROM residents WHERE id = NEW.delivered_to_resident_id;
                IF delivered_to_assoc IS NOT NULL AND delivered_to_assoc != NEW.association_id THEN
                    RAISE EXCEPTION 'packages.association_id (%) nao bate com residents.association_id (%) do delivered_to_resident_id %', NEW.association_id, delivered_to_assoc, NEW.delivered_to_resident_id;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$;


--
-- Name: next_service_order_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_service_order_number(p_association_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(number), 0) + 1
      INTO next_num
      FROM service_orders
     WHERE association_id = p_association_id;
    RETURN next_num;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: dim_association; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.dim_association (
    association_id text,
    name text,
    slug text,
    cnpj text,
    plan_name text,
    plan_expires_at date,
    is_active boolean,
    is_office boolean,
    created_at date
);


--
-- Name: dim_date; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.dim_date (
    date date,
    date_id bigint,
    year integer,
    month integer,
    month_name text,
    month_abbr text,
    quarter integer,
    semester bigint,
    week bigint,
    day_of_month integer,
    day_of_week integer,
    day_name text,
    is_weekend boolean,
    year_month text
);


--
-- Name: dim_resident; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.dim_resident (
    resident_id text,
    association_id text,
    type text,
    status text,
    full_name text,
    unit text,
    block text,
    monthly_payment_day double precision,
    ownership_type text,
    move_in_date date,
    move_out_date timestamp without time zone,
    created_at date
);


--
-- Name: fact_inadimplencia; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.fact_inadimplencia (
    id text,
    association_id text,
    resident_id text,
    resident_name text,
    unit text,
    block text,
    reference_month text,
    due_date timestamp without time zone,
    amount double precision,
    status text,
    days_overdue bigint,
    aging_bucket text,
    snapshot_date date,
    snapshot_date_id bigint
);


--
-- Name: fact_mensalidades; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.fact_mensalidades (
    id text,
    association_id text,
    resident_id text,
    resident_name text,
    unit text,
    block text,
    resident_type text,
    reference_month text,
    date_id bigint,
    due_date timestamp without time zone,
    paid_at timestamp with time zone,
    amount double precision,
    status text,
    is_paid boolean,
    is_overdue boolean,
    is_pending boolean,
    days_overdue bigint
);


--
-- Name: fact_packages; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.fact_packages (
    id text,
    association_id text,
    resident_id text,
    date_id bigint,
    status text,
    object_type text,
    unit text,
    block text,
    carrier_name text,
    has_delivery_fee boolean,
    delivery_fee_amount double precision,
    is_delivered boolean,
    is_returned boolean,
    is_pending boolean,
    delivery_hours double precision,
    sla_24h boolean,
    sla_48h boolean,
    sla_bucket text,
    received_at timestamp with time zone,
    delivered_at timestamp with time zone
);


--
-- Name: fact_service_orders; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.fact_service_orders (
    id text,
    association_id text,
    number bigint,
    date_id bigint,
    title text,
    status text,
    priority text,
    area text,
    community_wide boolean,
    assigned_to_name text,
    is_open boolean,
    is_resolved boolean,
    is_cancelled boolean,
    resolution_hours double precision,
    created_at timestamp with time zone,
    resolved_at timestamp with time zone
);


--
-- Name: fact_social; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.fact_social (
    resident_id text,
    association_id text,
    type text,
    status text,
    race text,
    education_level text,
    uses_public_transport boolean,
    internet_access text,
    household_count double precision,
    has_sewage boolean,
    address_cep text,
    address_neighborhood text,
    age bigint,
    age_group text
);


--
-- Name: fact_transactions; Type: TABLE; Schema: analytics; Owner: -
--

CREATE TABLE analytics.fact_transactions (
    id text,
    association_id text,
    date_id bigint,
    year_month text,
    category_id text,
    category_name text,
    category_type text,
    payment_method_id text,
    payment_method_name text,
    resident_id text,
    type text,
    amount double precision,
    is_income boolean,
    is_expense boolean,
    is_sangria boolean,
    is_transfer boolean,
    income_subtype text,
    transaction_at timestamp with time zone
);


--
-- Name: account; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" uuid NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: invitation; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.invitation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "organizationId" uuid NOT NULL,
    email text NOT NULL,
    role text,
    status text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "inviterId" uuid NOT NULL
);


--
-- Name: jwks; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.jwks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone
);


--
-- Name: member; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "organizationId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    role text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);


--
-- Name: organization; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.organization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo text,
    "createdAt" timestamp with time zone NOT NULL,
    metadata text
);


--
-- Name: project_config; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.project_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    endpoint_id text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    trusted_origins jsonb NOT NULL,
    social_providers jsonb NOT NULL,
    email_provider jsonb,
    email_and_password jsonb,
    allow_localhost boolean NOT NULL,
    plugin_configs jsonb,
    webhook_config jsonb
);


--
-- Name: session; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" uuid NOT NULL,
    "impersonatedBy" text,
    "activeOrganizationId" text
);


--
-- Name: user; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth."user" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    role text,
    banned boolean,
    "banReason" text,
    "banExpires" timestamp with time zone
);


--
-- Name: verification; Type: TABLE; Schema: neon_auth; Owner: -
--

CREATE TABLE neon_auth.verification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: agent_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    visited_at timestamp with time zone DEFAULT now() NOT NULL,
    result character varying(20) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_visits_result_check CHECK (((result)::text = ANY ((ARRAY['paid'::character varying, 'will_pay'::character varying, 'absent'::character varying, 'refused'::character varying])::text[])))
);


--
-- Name: api_request_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_request_logs (
    id bigint NOT NULL,
    path text NOT NULL,
    method text NOT NULL,
    status_code integer NOT NULL,
    duration_ms integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);


--
-- Name: api_request_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_request_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_request_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_request_logs_id_seq OWNED BY public.api_request_logs.id;


--
-- Name: association_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.association_settings (
    association_id uuid NOT NULL,
    default_cash_balance numeric(10,2) DEFAULT 200.00 NOT NULL,
    max_cash_before_sangria numeric(10,2) DEFAULT 500.00 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    assoc_name text,
    assoc_phone text,
    assoc_email text,
    assoc_address text,
    assoc_cep text,
    president_user_id uuid,
    access_groups jsonb DEFAULT '{}'::jsonb,
    cadastros jsonb DEFAULT '{}'::jsonb NOT NULL,
    default_mensalidade_amount numeric(10,2) DEFAULT 0.00,
    president_name text,
    president_signature_url text,
    assoc_logo_url text,
    community_name text,
    proof_stock integer DEFAULT 0,
    permitir_transferencia boolean DEFAULT false,
    delinquency_grace_days integer DEFAULT 2
);


--
-- Name: associations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.associations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(100) NOT NULL,
    cnpj character varying(18),
    address_street character varying(255),
    address_number character varying(20),
    address_complement character varying(100),
    address_district character varying(100),
    address_city character varying(100),
    address_state character(2),
    address_zip character varying(9),
    phone character varying(20),
    email character varying(255),
    logo_url text,
    is_active boolean DEFAULT true NOT NULL,
    plan_name character varying(50) DEFAULT 'basic'::character varying NOT NULL,
    plan_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_association_slugs text[] DEFAULT '{}'::text[],
    presidente_user_id uuid,
    chat_group character varying(50),
    is_office boolean DEFAULT false NOT NULL,
    inventory_day_of_month smallint DEFAULT 1 NOT NULL,
    simplifica_enabled boolean DEFAULT false NOT NULL,
    balance_start_date date DEFAULT '2026-06-01'::date
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    user_id uuid NOT NULL,
    action character varying(100) NOT NULL,
    entity character varying(100),
    entity_id text,
    detail text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bank_statements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_statements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    bank character varying(20) NOT NULL,
    date date NOT NULL,
    amount numeric(12,2) NOT NULL,
    name character varying(255),
    cpf character varying(14),
    tipo character varying(10) DEFAULT 'entrada'::character varying NOT NULL,
    description text,
    conciliado boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    transaction_id uuid,
    batched_at timestamp with time zone
);


--
-- Name: carriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cash_box_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_box_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    cash_box_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    movement_type character varying(10) NOT NULL,
    description text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cash_boxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_boxes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    balance numeric(12,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_malote boolean DEFAULT false NOT NULL,
    is_cofre boolean DEFAULT false NOT NULL
);


--
-- Name: cash_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    opened_by uuid NOT NULL,
    closed_by uuid,
    status public.cash_session_status DEFAULT 'open'::public.cash_session_status NOT NULL,
    opening_balance numeric(12,2) DEFAULT 0.00 NOT NULL,
    closing_balance numeric(12,2),
    expected_balance numeric(12,2),
    difference numeric(12,2),
    notes text,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    origin character varying(50) DEFAULT 'Sessão de Caixa'::character varying,
    manual_pix numeric(12,2),
    manual_dinheiro numeric(12,2),
    manual_total_bruto numeric(12,2),
    manual_total_baixas numeric(12,2),
    quebra_caixa numeric(12,2),
    reviewed_by uuid,
    malote_sent_at timestamp with time zone,
    device_token character varying(64),
    quebra_responsavel character varying(200),
    quebra_assinatura_url text,
    quebra_apurada_at timestamp with time zone,
    blind_pix numeric(12,2),
    blind_dinheiro numeric(12,2),
    troco_deixado numeric(12,2),
    quebra_motivo text,
    dinheiro_contado numeric(12,2),
    pix_contado numeric(12,2),
    assinatura_conferencia_url text,
    session_type text DEFAULT 'pdv'::text NOT NULL,
    CONSTRAINT chk_session_close CHECK ((((status = 'open'::public.cash_session_status) AND (closed_at IS NULL) AND (closed_by IS NULL)) OR ((status = ANY (ARRAY['closed'::public.cash_session_status, 'conferido'::public.cash_session_status])) AND (closed_at IS NOT NULL) AND (closed_by IS NOT NULL))))
);


--
-- Name: chat_message_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message_reads (
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    user_name text NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    sender_id uuid,
    sender_name character varying(255) DEFAULT 'Sistema'::character varying NOT NULL,
    content text,
    message_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    media_url text,
    mention_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reply_to_id uuid,
    reply_to_sender_name text,
    reply_to_content text,
    reply_to_type text
);


--
-- Name: daily_task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    association_id uuid NOT NULL,
    created_by uuid,
    comment text NOT NULL,
    attachment_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checklist_index integer,
    updated_at timestamp with time zone
);


--
-- Name: daily_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    assigned_to uuid,
    assigned_to_name character varying(255),
    due_date date,
    reminder_at timestamp with time zone,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    service_order_id uuid,
    service_order_title character varying(255),
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attachment_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    deleted_at timestamp with time zone,
    reminded_at timestamp with time zone,
    CONSTRAINT daily_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'done'::character varying, 'blocked'::character varying, 'waiting_validation'::character varying])::text[])))
);


--
-- Name: deliverers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliverers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    carrier_id uuid,
    signature_url text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: delivery_exemption_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_exemption_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    token character varying(8) NOT NULL,
    created_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by uuid,
    package_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: demands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    status character varying(30) DEFAULT 'gaveta'::character varying NOT NULL,
    phase character varying(30) DEFAULT 'pendente'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    assigned_to uuid,
    assigned_to_name character varying(255),
    due_date date,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    service_order_id uuid,
    reminded_at timestamp with time zone
);


--
-- Name: etl_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etl_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_date date NOT NULL,
    mode character varying(20) DEFAULT 'incremental'::character varying NOT NULL,
    status character varying(20) DEFAULT 'running'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    duration_s numeric(8,1),
    bronze_rows integer DEFAULT 0,
    silver_rows integer DEFAULT 0,
    gold_files integer DEFAULT 0,
    neon_kb numeric(8,1) DEFAULT 0,
    error_msg text,
    triggered_by character varying(50) DEFAULT 'cron'::character varying
);


--
-- Name: etl_task_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etl_task_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    task_name character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    duration_s numeric(8,1),
    rows_in integer DEFAULT 0,
    rows_out integer DEFAULT 0,
    detail jsonb
);


--
-- Name: inventory_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    pix_counted numeric(12,2) DEFAULT 0 NOT NULL,
    cash_counted numeric(12,2) DEFAULT 0 NOT NULL,
    total_counted numeric(12,2) DEFAULT 0 NOT NULL,
    expected_total numeric(12,2),
    difference numeric(12,2),
    justification text DEFAULT ''::text NOT NULL,
    signed_by uuid,
    signed_at timestamp with time zone,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    reference_month date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attributed_association_id uuid,
    CONSTRAINT inventory_records_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'concluded'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: mensalidades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mensalidades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    reference_month character varying(7) NOT NULL,
    due_date date NOT NULL,
    amount numeric(10,2) NOT NULL,
    status public.mensalidade_status DEFAULT 'pending'::public.mensalidade_status NOT NULL,
    paid_at timestamp with time zone,
    transaction_id uuid,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    transaction_id_2 uuid,
    amount_2 numeric(10,2),
    payment_channel character varying(20) DEFAULT 'cash'::character varying NOT NULL,
    payment_proof_url text,
    CONSTRAINT mensalidades_amount_2_check CHECK ((amount_2 > (0)::numeric)),
    CONSTRAINT mensalidades_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: migration_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_payments (
    id uuid NOT NULL,
    association_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    competencia character varying(7) NOT NULL,
    tipo public.migration_payment_tipo NOT NULL,
    origem character varying(50) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp without time zone NOT NULL,
    valor_pago numeric(10,2),
    data_pagamento date,
    proof_url text
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    body text NOT NULL,
    type character varying(30) DEFAULT 'info'::character varying NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: package_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    package_id uuid NOT NULL,
    created_by uuid NOT NULL,
    event_type text DEFAULT 'comment'::text NOT NULL,
    comment text,
    attachment_url text,
    attachment_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    resident_id uuid,
    status public.package_status DEFAULT 'received'::public.package_status NOT NULL,
    sender_name character varying(255),
    carrier_name character varying(100),
    tracking_code character varying(100),
    object_type character varying(100),
    photo_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    has_delivery_fee boolean DEFAULT false NOT NULL,
    delivery_fee_amount numeric(8,2),
    delivery_fee_paid boolean DEFAULT false NOT NULL,
    delivery_fee_tx_id uuid,
    delivered_to_name character varying(255),
    delivered_to_cpf character varying(14),
    delivered_to_resident_id uuid,
    signature_url text,
    delivered_at timestamp with time zone,
    returned_at timestamp with time zone,
    return_reason text,
    notes text,
    received_by uuid NOT NULL,
    delivered_by uuid,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deliverer_name character varying(255),
    deliverer_signature_url text,
    proof_of_residence_verified boolean DEFAULT false,
    recipient_id_photo_url text,
    resident_name text,
    resident_cpf text,
    resident_cep text,
    proof_of_residence_url text,
    third_party_pickup boolean DEFAULT false NOT NULL,
    owner_id_photo_url text,
    picker_id_photo_url text,
    picker_phone character varying(30),
    receive_batch_id uuid,
    CONSTRAINT chk_delivered_fields CHECK (((status <> 'delivered'::public.package_status) OR ((status = 'delivered'::public.package_status) AND (delivered_at IS NOT NULL) AND (delivered_to_name IS NOT NULL)))),
    CONSTRAINT chk_delivery_fee CHECK ((((has_delivery_fee = false) AND (delivery_fee_amount IS NULL)) OR ((has_delivery_fee = true) AND (delivery_fee_amount IS NOT NULL) AND (delivery_fee_amount > (0)::numeric))))
);


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pix_learning_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pix_learning_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    bank_name text NOT NULL,
    resident_id uuid NOT NULL,
    resident_name text NOT NULL,
    confirmed_by uuid,
    match_count integer DEFAULT 1 NOT NULL,
    last_matched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: porta_a_porta_commission_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porta_a_porta_commission_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    operator_id uuid NOT NULL,
    paid_by uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_method character varying(50),
    paid_at timestamp without time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: porta_a_porta_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porta_a_porta_leads (
    id uuid NOT NULL,
    association_id uuid NOT NULL,
    operator_id uuid,
    full_name character varying(200) NOT NULL,
    phone character varying(30),
    cpf character varying(14),
    address_street character varying(200) NOT NULL,
    address_number character varying(20) NOT NULL,
    address_complement character varying(100),
    dependents character varying DEFAULT '''[]'''::character varying NOT NULL,
    status character varying NOT NULL,
    payment_type character varying NOT NULL,
    total_installments integer NOT NULL,
    monthly_fee numeric(10,2) NOT NULL,
    notes character varying,
    resident_id uuid,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    commissioned_to uuid,
    lancado_por character varying(200),
    acordo_months integer,
    acordo_date_from character varying(7),
    acordo_date_to character varying(7)
);


--
-- Name: porta_a_porta_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porta_a_porta_payments (
    id uuid NOT NULL,
    association_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    installment_number integer NOT NULL,
    total_installments integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    due_date date NOT NULL,
    paid_at timestamp without time zone,
    status character varying NOT NULL,
    payment_method character varying,
    notes character varying,
    created_at timestamp without time zone NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    statement_id uuid NOT NULL,
    transaction_id uuid,
    score integer DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'pendente'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    association_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resident_update_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resident_update_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    changes jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid
);


--
-- Name: residents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.residents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    type public.resident_type DEFAULT 'member'::public.resident_type NOT NULL,
    status public.resident_status DEFAULT 'active'::public.resident_status NOT NULL,
    full_name character varying(255) NOT NULL,
    cpf character varying(14),
    rg character varying(20),
    date_of_birth date,
    photo_url text,
    email character varying(255),
    phone_primary character varying(20),
    phone_secondary character varying(20),
    parking_spot character varying(50),
    responsible_id uuid,
    ownership_type character varying(50),
    move_in_date date,
    move_out_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    race character varying(30),
    education_level character varying(50),
    address_cep character varying(9),
    address_street character varying(255),
    address_number character varying(20),
    address_complement character varying(100),
    address_city character varying(100),
    address_state character(2),
    address_rooms smallint,
    address_location character varying(50),
    address_access jsonb DEFAULT '[]'::jsonb,
    uses_public_transport boolean,
    transport_distance character varying(50),
    household_count smallint,
    household_profiles jsonb DEFAULT '[]'::jsonb,
    internet_access character varying(50),
    has_sewage boolean,
    neighborhood_problems jsonb DEFAULT '[]'::jsonb,
    main_priority_request text,
    is_member_confirmed boolean DEFAULT false,
    wants_to_join boolean,
    monthly_payment_day smallint,
    terms_accepted boolean DEFAULT false,
    lgpd_accepted boolean DEFAULT false,
    has_pests boolean,
    address_neighborhood character varying(100),
    address_country character varying(100) DEFAULT 'Brasil'::character varying,
    proof_of_payment_url text
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    role character varying(30) NOT NULL,
    module character varying(50) NOT NULL,
    can_view boolean DEFAULT true NOT NULL,
    can_write boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sangria_destinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sangria_destinations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scheduled_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    task_key character varying(100) NOT NULL,
    schedule_cron character varying(100),
    schedule_label character varying(100),
    enabled boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    last_run_status character varying(20),
    last_run_result text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version integer NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    description text
);


--
-- Name: service_order_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_order_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_order_id uuid NOT NULL,
    association_id uuid NOT NULL,
    created_by uuid NOT NULL,
    comment text NOT NULL,
    attachment_urls jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_order_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_order_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_order_id uuid NOT NULL,
    association_id uuid NOT NULL,
    from_status public.service_order_status,
    to_status public.service_order_status NOT NULL,
    changed_by uuid NOT NULL,
    notes text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_order_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_order_phases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_order_phases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    color character varying(7) DEFAULT '#9333ea'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_order_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_order_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    service_order_id uuid NOT NULL,
    created_by uuid NOT NULL,
    assigned_to uuid,
    assigned_to_name character varying(255),
    title character varying(255) NOT NULL,
    notes text,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    due_date date,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    number integer NOT NULL,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    priority public.service_order_priority DEFAULT 'medium'::public.service_order_priority NOT NULL,
    requester_resident_id uuid,
    requester_user_id uuid,
    requester_name character varying(255),
    requester_phone character varying(20),
    assigned_to uuid,
    assigned_at timestamp with time zone,
    location_detail text,
    area character varying(100),
    resolution_notes text,
    resolved_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    pdf_url text,
    pdf_generated_at timestamp with time zone,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    service_impacted text,
    category_name text,
    org_responsible text,
    requester_email text,
    reference_point text,
    request_date timestamp with time zone,
    address_cep text,
    use_requester_address boolean DEFAULT false,
    assigned_to_name character varying(255),
    energia_eletrica_data jsonb,
    impacted_residents jsonb DEFAULT '[]'::jsonb,
    community_wide boolean DEFAULT false,
    address_street character varying(255),
    address_number character varying(20),
    address_complement character varying(100),
    phase_id uuid,
    status public.service_order_status DEFAULT 'pending'::public.service_order_status NOT NULL
);


--
-- Name: session_transaction_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_transaction_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    cash_session_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    conferido boolean DEFAULT false NOT NULL,
    observacao text,
    reviewed_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: so_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.so_presence (
    so_id uuid NOT NULL,
    user_id uuid NOT NULL,
    association_id uuid NOT NULL,
    full_name text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transaction_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    type public.transaction_type NOT NULL,
    color character(7),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    cash_session_id uuid,
    category_id uuid,
    payment_method_id uuid,
    resident_id uuid,
    type public.transaction_type NOT NULL,
    amount numeric(12,2) NOT NULL,
    description text NOT NULL,
    reference_number character varying(100),
    is_sangria boolean DEFAULT false NOT NULL,
    sangria_reason text,
    sangria_destination character varying(255),
    receipt_photo_url text,
    package_id uuid,
    created_by uuid NOT NULL,
    transaction_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    income_subtype public.income_subtype,
    is_reversal boolean DEFAULT false NOT NULL,
    reversal_of_id uuid,
    reversal_reason text,
    reversed_by uuid,
    reversed_at timestamp with time zone,
    approval_status character varying(20) DEFAULT NULL::character varying,
    approved_by uuid,
    approved_at timestamp with time zone,
    approval_signature_url text,
    rejection_reason text,
    is_transfer boolean DEFAULT false,
    transfer_counterpart_id uuid,
    payer_name text,
    payer_entity_id uuid,
    CONSTRAINT chk_income_subtype_required CHECK (((type <> 'income'::public.transaction_type) OR (income_subtype IS NOT NULL))),
    CONSTRAINT chk_sangria_type CHECK (((is_sangria = false) OR ((is_sangria = true) AND (type = 'sangria'::public.transaction_type) AND (sangria_reason IS NOT NULL)))),
    CONSTRAINT transactions_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: user_association_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_association_roles (
    user_id uuid NOT NULL,
    association_id uuid NOT NULL,
    role text DEFAULT 'operator'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    association_id uuid NOT NULL,
    full_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(20),
    hashed_password text NOT NULL,
    role public.user_role DEFAULT 'operator'::public.user_role NOT NULL,
    avatar_url text,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    simplifica_mode boolean DEFAULT false NOT NULL,
    restrict_edit_tx boolean DEFAULT false NOT NULL,
    restrict_reverse_tx boolean DEFAULT false NOT NULL,
    require_own_cash_session boolean DEFAULT false NOT NULL
);


--
-- Name: v_mensalidades_completas; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_mensalidades_completas AS
 SELECT m.id,
    m.resident_id,
    m.association_id,
    m.reference_month,
    m.due_date,
    m.amount,
    m.status,
    m.paid_at,
    m.transaction_id,
    m.notes,
    'sistema'::text AS origem,
    t.payment_method_id,
    pm.name AS payment_method_name,
    r.full_name AS resident_name,
    r.address_cep
   FROM (((public.mensalidades m
     JOIN public.residents r ON ((r.id = m.resident_id)))
     LEFT JOIN public.transactions t ON ((t.id = m.transaction_id)))
     LEFT JOIN public.payment_methods pm ON ((pm.id = t.payment_method_id)))
UNION ALL
 SELECT mp.id,
    mp.resident_id,
    mp.association_id,
    mp.competencia AS reference_month,
    NULL::date AS due_date,
    mp.valor_pago AS amount,
    'paid'::public.mensalidade_status AS status,
    (mp.data_pagamento)::timestamp without time zone AS paid_at,
    NULL::uuid AS transaction_id,
    NULL::text AS notes,
    'migracao'::text AS origem,
    NULL::uuid AS payment_method_id,
    NULL::text AS payment_method_name,
    r.full_name AS resident_name,
    r.address_cep
   FROM (public.migration_payments mp
     JOIN public.residents r ON ((r.id = mp.resident_id)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.mensalidades m2
          WHERE ((m2.resident_id = mp.resident_id) AND (m2.association_id = mp.association_id) AND ((m2.reference_month)::text = (mp.competencia)::text)))));


--
-- Name: webauthn_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    challenge text NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:05:00'::interval) NOT NULL
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    association_id uuid NOT NULL,
    credential_id text NOT NULL,
    public_key bytea NOT NULL,
    sign_count bigint DEFAULT 0 NOT NULL,
    device_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_request_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_request_logs ALTER COLUMN id SET DEFAULT nextval('public.api_request_logs_id_seq'::regclass);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: invitation invitation_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.invitation
    ADD CONSTRAINT invitation_pkey PRIMARY KEY (id);


--
-- Name: jwks jwks_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);


--
-- Name: member member_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.member
    ADD CONSTRAINT member_pkey PRIMARY KEY (id);


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (id);


--
-- Name: organization organization_slug_key; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.organization
    ADD CONSTRAINT organization_slug_key UNIQUE (slug);


--
-- Name: project_config project_config_endpoint_id_key; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.project_config
    ADD CONSTRAINT project_config_endpoint_id_key UNIQUE (endpoint_id);


--
-- Name: project_config project_config_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.project_config
    ADD CONSTRAINT project_config_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: agent_visits agent_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_visits
    ADD CONSTRAINT agent_visits_pkey PRIMARY KEY (id);


--
-- Name: api_request_logs api_request_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_request_logs
    ADD CONSTRAINT api_request_logs_pkey PRIMARY KEY (id);


--
-- Name: association_settings association_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.association_settings
    ADD CONSTRAINT association_settings_pkey PRIMARY KEY (association_id);


--
-- Name: associations associations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associations
    ADD CONSTRAINT associations_pkey PRIMARY KEY (id);


--
-- Name: associations associations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associations
    ADD CONSTRAINT associations_slug_key UNIQUE (slug);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: bank_statements bank_statements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_pkey PRIMARY KEY (id);


--
-- Name: carriers carriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carriers
    ADD CONSTRAINT carriers_pkey PRIMARY KEY (id);


--
-- Name: cash_box_movements cash_box_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_box_movements
    ADD CONSTRAINT cash_box_movements_pkey PRIMARY KEY (id);


--
-- Name: cash_boxes cash_boxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_boxes
    ADD CONSTRAINT cash_boxes_pkey PRIMARY KEY (id);


--
-- Name: cash_sessions cash_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_pkey PRIMARY KEY (id);


--
-- Name: chat_message_reads chat_message_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reads
    ADD CONSTRAINT chat_message_reads_pkey PRIMARY KEY (message_id, user_id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: daily_task_comments daily_task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_task_comments
    ADD CONSTRAINT daily_task_comments_pkey PRIMARY KEY (id);


--
-- Name: daily_tasks daily_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tasks
    ADD CONSTRAINT daily_tasks_pkey PRIMARY KEY (id);


--
-- Name: deliverers deliverers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverers
    ADD CONSTRAINT deliverers_pkey PRIMARY KEY (id);


--
-- Name: delivery_exemption_tokens delivery_exemption_tokens_association_id_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exemption_tokens
    ADD CONSTRAINT delivery_exemption_tokens_association_id_token_key UNIQUE (association_id, token);


--
-- Name: delivery_exemption_tokens delivery_exemption_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exemption_tokens
    ADD CONSTRAINT delivery_exemption_tokens_pkey PRIMARY KEY (id);


--
-- Name: demands demands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demands
    ADD CONSTRAINT demands_pkey PRIMARY KEY (id);


--
-- Name: etl_runs etl_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_runs
    ADD CONSTRAINT etl_runs_pkey PRIMARY KEY (id);


--
-- Name: etl_task_runs etl_task_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_task_runs
    ADD CONSTRAINT etl_task_runs_pkey PRIMARY KEY (id);


--
-- Name: inventory_records inventory_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_records
    ADD CONSTRAINT inventory_records_pkey PRIMARY KEY (id);


--
-- Name: mensalidades mensalidades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensalidades
    ADD CONSTRAINT mensalidades_pkey PRIMARY KEY (id);


--
-- Name: migration_payments migration_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_payments
    ADD CONSTRAINT migration_payments_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: package_events package_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_events
    ADD CONSTRAINT package_events_pkey PRIMARY KEY (id);


--
-- Name: packages packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: pix_learning_map pix_learning_map_association_id_bank_name_resident_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_learning_map
    ADD CONSTRAINT pix_learning_map_association_id_bank_name_resident_id_key UNIQUE (association_id, bank_name, resident_id);


--
-- Name: pix_learning_map pix_learning_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_learning_map
    ADD CONSTRAINT pix_learning_map_pkey PRIMARY KEY (id);


--
-- Name: porta_a_porta_commission_payments porta_a_porta_commission_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porta_a_porta_commission_payments
    ADD CONSTRAINT porta_a_porta_commission_payments_pkey PRIMARY KEY (id);


--
-- Name: porta_a_porta_leads porta_a_porta_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porta_a_porta_leads
    ADD CONSTRAINT porta_a_porta_leads_pkey PRIMARY KEY (id);


--
-- Name: porta_a_porta_payments porta_a_porta_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porta_a_porta_payments
    ADD CONSTRAINT porta_a_porta_payments_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_user_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);


--
-- Name: reconciliations reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: resident_update_requests resident_update_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_update_requests
    ADD CONSTRAINT resident_update_requests_pkey PRIMARY KEY (id);


--
-- Name: residents residents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_association_id_role_module_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_association_id_role_module_key UNIQUE (association_id, role, module);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: sangria_destinations sangria_destinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sangria_destinations
    ADD CONSTRAINT sangria_destinations_pkey PRIMARY KEY (id);


--
-- Name: scheduled_tasks scheduled_tasks_association_id_task_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_tasks
    ADD CONSTRAINT scheduled_tasks_association_id_task_key_key UNIQUE (association_id, task_key);


--
-- Name: scheduled_tasks scheduled_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_tasks
    ADD CONSTRAINT scheduled_tasks_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: service_order_comments service_order_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_comments
    ADD CONSTRAINT service_order_comments_pkey PRIMARY KEY (id);


--
-- Name: service_order_history service_order_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_history
    ADD CONSTRAINT service_order_history_pkey PRIMARY KEY (id);


--
-- Name: service_order_phases service_order_phases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_phases
    ADD CONSTRAINT service_order_phases_pkey PRIMARY KEY (id);


--
-- Name: service_order_tasks service_order_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_tasks
    ADD CONSTRAINT service_order_tasks_pkey PRIMARY KEY (id);


--
-- Name: service_orders service_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_pkey PRIMARY KEY (id);


--
-- Name: session_transaction_reviews session_transaction_reviews_cash_session_id_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_transaction_reviews
    ADD CONSTRAINT session_transaction_reviews_cash_session_id_transaction_id_key UNIQUE (cash_session_id, transaction_id);


--
-- Name: session_transaction_reviews session_transaction_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_transaction_reviews
    ADD CONSTRAINT session_transaction_reviews_pkey PRIMARY KEY (id);


--
-- Name: so_presence so_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.so_presence
    ADD CONSTRAINT so_presence_pkey PRIMARY KEY (so_id, user_id);


--
-- Name: transaction_categories transaction_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_categories
    ADD CONSTRAINT transaction_categories_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: transaction_categories uq_category_name_type_assoc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_categories
    ADD CONSTRAINT uq_category_name_type_assoc UNIQUE (association_id, name, type);


--
-- Name: mensalidades uq_mensalidade_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensalidades
    ADD CONSTRAINT uq_mensalidade_period UNIQUE (association_id, resident_id, reference_month);


--
-- Name: migration_payments uq_migration_payment_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_payments
    ADD CONSTRAINT uq_migration_payment_period UNIQUE (association_id, resident_id, competencia);


--
-- Name: payment_methods uq_payment_method_name_assoc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT uq_payment_method_name_assoc UNIQUE (association_id, name);


--
-- Name: reconciliations uq_reconciliation_statement; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT uq_reconciliation_statement UNIQUE (statement_id);


--
-- Name: service_orders uq_so_number_assoc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT uq_so_number_assoc UNIQUE (association_id, number);


--
-- Name: users uq_users_email_assoc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_email_assoc UNIQUE (email, association_id);


--
-- Name: user_association_roles user_association_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_association_roles
    ADD CONSTRAINT user_association_roles_pkey PRIMARY KEY (user_id, association_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_credential_id_key UNIQUE (credential_id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: account_userId_idx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE INDEX "account_userId_idx" ON neon_auth.account USING btree ("userId");


--
-- Name: invitation_email_idx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE INDEX invitation_email_idx ON neon_auth.invitation USING btree (email);


--
-- Name: invitation_organizationId_idx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE INDEX "invitation_organizationId_idx" ON neon_auth.invitation USING btree ("organizationId");


--
-- Name: member_organizationId_idx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE INDEX "member_organizationId_idx" ON neon_auth.member USING btree ("organizationId");


--
-- Name: member_userId_idx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE INDEX "member_userId_idx" ON neon_auth.member USING btree ("userId");


--
-- Name: organization_slug_uidx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE UNIQUE INDEX organization_slug_uidx ON neon_auth.organization USING btree (slug);


--
-- Name: session_userId_idx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE INDEX "session_userId_idx" ON neon_auth.session USING btree ("userId");


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: neon_auth; Owner: -
--

CREATE INDEX verification_identifier_idx ON neon_auth.verification USING btree (identifier);


--
-- Name: idx_agent_visits_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_visits_agent ON public.agent_visits USING btree (agent_id, visited_at);


--
-- Name: idx_agent_visits_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_visits_assoc ON public.agent_visits USING btree (association_id);


--
-- Name: idx_agent_visits_resident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_visits_resident ON public.agent_visits USING btree (resident_id, association_id);


--
-- Name: idx_api_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_logs_created ON public.api_request_logs USING btree (created_at DESC);


--
-- Name: idx_api_logs_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_logs_path ON public.api_request_logs USING btree (path, created_at DESC);


--
-- Name: idx_api_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_logs_user ON public.api_request_logs USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: idx_audit_log_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_assoc ON public.audit_log USING btree (association_id, created_at DESC);


--
-- Name: idx_bank_statements_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_statements_assoc ON public.bank_statements USING btree (association_id);


--
-- Name: idx_bs_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bs_dedup ON public.bank_statements USING btree (association_id, bank, date, COALESCE(name, ''::character varying), amount);


--
-- Name: idx_cash_box_movements_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_box_movements_assoc ON public.cash_box_movements USING btree (association_id);


--
-- Name: idx_cash_boxes_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_boxes_assoc ON public.cash_boxes USING btree (association_id);


--
-- Name: idx_cash_sessions_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sessions_assoc ON public.cash_sessions USING btree (association_id);


--
-- Name: idx_cash_sessions_opened_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sessions_opened_at ON public.cash_sessions USING btree (opened_at DESC);


--
-- Name: idx_cash_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sessions_status ON public.cash_sessions USING btree (status);


--
-- Name: idx_chat_reads_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_reads_message ON public.chat_message_reads USING btree (message_id);


--
-- Name: idx_daily_task_comments_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_task_comments_assoc ON public.daily_task_comments USING btree (association_id);


--
-- Name: idx_daily_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_task_comments_task ON public.daily_task_comments USING btree (task_id);


--
-- Name: idx_daily_tasks_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_tasks_assigned ON public.daily_tasks USING btree (assigned_to);


--
-- Name: idx_daily_tasks_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_tasks_assoc ON public.daily_tasks USING btree (association_id);


--
-- Name: idx_daily_tasks_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_tasks_deleted ON public.daily_tasks USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_daily_tasks_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_tasks_due ON public.daily_tasks USING btree (due_date);


--
-- Name: idx_mens_resident_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mens_resident_status_due ON public.mensalidades USING btree (association_id, resident_id, status, due_date);


--
-- Name: idx_mensalidade_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensalidade_assoc ON public.mensalidades USING btree (association_id);


--
-- Name: idx_mensalidade_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensalidade_due ON public.mensalidades USING btree (due_date);


--
-- Name: idx_mensalidade_resident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensalidade_resident ON public.mensalidades USING btree (resident_id);


--
-- Name: idx_mensalidade_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensalidade_status ON public.mensalidades USING btree (status);


--
-- Name: idx_notifications_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_assoc ON public.notifications USING btree (association_id);


--
-- Name: idx_packages_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_assoc ON public.packages USING btree (association_id);


--
-- Name: idx_packages_assoc_rcvd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_assoc_rcvd ON public.packages USING btree (association_id, received_at DESC);


--
-- Name: idx_packages_assoc_status_rcvd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_assoc_status_rcvd ON public.packages USING btree (association_id, status, received_at DESC);


--
-- Name: idx_packages_carrier_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_carrier_trgm ON public.packages USING gin (carrier_name public.gin_trgm_ops);


--
-- Name: idx_packages_receive_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_receive_batch ON public.packages USING btree (receive_batch_id) WHERE (receive_batch_id IS NOT NULL);


--
-- Name: idx_packages_received_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_received_at ON public.packages USING btree (received_at DESC);


--
-- Name: idx_packages_resident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_resident ON public.packages USING btree (resident_id);


--
-- Name: idx_packages_resident_del; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_resident_del ON public.packages USING btree (resident_id, delivered_at);


--
-- Name: idx_packages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_status ON public.packages USING btree (status);


--
-- Name: idx_packages_tracking_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packages_tracking_trgm ON public.packages USING gin (tracking_code public.gin_trgm_ops);


--
-- Name: idx_payment_methods_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_methods_assoc ON public.payment_methods USING btree (association_id);


--
-- Name: idx_pix_learning_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pix_learning_assoc ON public.pix_learning_map USING btree (association_id);


--
-- Name: idx_pkg_events_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pkg_events_assoc ON public.package_events USING btree (association_id);


--
-- Name: idx_pkg_events_package; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pkg_events_package ON public.package_events USING btree (package_id);


--
-- Name: idx_pkg_events_pkg_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pkg_events_pkg_assoc ON public.package_events USING btree (package_id, association_id);


--
-- Name: idx_porta_a_porta_payments_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_porta_a_porta_payments_assoc ON public.porta_a_porta_payments USING btree (association_id);


--
-- Name: idx_push_subscriptions_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_assoc ON public.push_subscriptions USING btree (association_id);


--
-- Name: idx_reconciliations_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliations_assoc ON public.reconciliations USING btree (association_id);


--
-- Name: idx_refresh_tokens_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_assoc ON public.refresh_tokens USING btree (association_id);


--
-- Name: idx_residents_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_residents_assoc ON public.residents USING btree (association_id);


--
-- Name: idx_residents_assoc_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_residents_assoc_type_status ON public.residents USING btree (association_id, type, status);


--
-- Name: idx_residents_cpf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_residents_cpf ON public.residents USING btree (association_id, cpf);


--
-- Name: idx_residents_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_residents_name_trgm ON public.residents USING gin (full_name public.gin_trgm_ops);


--
-- Name: idx_residents_responsible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_residents_responsible ON public.residents USING btree (responsible_id);


--
-- Name: idx_residents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_residents_status ON public.residents USING btree (status);


--
-- Name: idx_residents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_residents_type ON public.residents USING btree (type);


--
-- Name: idx_sangria_destinations_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sangria_destinations_assoc ON public.sangria_destinations USING btree (association_id);


--
-- Name: idx_service_order_comments_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_order_comments_assoc ON public.service_order_comments USING btree (association_id);


--
-- Name: idx_service_order_phases_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_order_phases_assoc ON public.service_order_phases USING btree (association_id);


--
-- Name: idx_session_transaction_reviews_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_transaction_reviews_assoc ON public.session_transaction_reviews USING btree (association_id);


--
-- Name: idx_so_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_assigned ON public.service_orders USING btree (assigned_to);


--
-- Name: idx_so_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_assoc ON public.service_orders USING btree (association_id);


--
-- Name: idx_so_comments_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_comments_so ON public.service_order_comments USING btree (service_order_id);


--
-- Name: idx_so_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_created_at ON public.service_orders USING btree (created_at DESC);


--
-- Name: idx_so_history_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_history_assoc ON public.service_order_history USING btree (association_id);


--
-- Name: idx_so_history_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_history_at ON public.service_order_history USING btree (changed_at DESC);


--
-- Name: idx_so_history_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_history_order ON public.service_order_history USING btree (service_order_id);


--
-- Name: idx_so_presence_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_presence_assoc ON public.so_presence USING btree (association_id);


--
-- Name: idx_so_presence_so_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_presence_so_id ON public.so_presence USING btree (so_id, last_seen_at);


--
-- Name: idx_so_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_so_requester ON public.service_orders USING btree (requester_resident_id);


--
-- Name: idx_tx_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_assoc ON public.transactions USING btree (association_id);


--
-- Name: idx_tx_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_at ON public.transactions USING btree (transaction_at DESC);


--
-- Name: idx_tx_categories_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_categories_assoc ON public.transaction_categories USING btree (association_id);


--
-- Name: idx_tx_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_category ON public.transactions USING btree (category_id);


--
-- Name: idx_tx_resident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_resident ON public.transactions USING btree (resident_id);


--
-- Name: idx_tx_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_session ON public.transactions USING btree (cash_session_id);


--
-- Name: idx_tx_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_type ON public.transactions USING btree (type);


--
-- Name: idx_user_association_roles_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_association_roles_assoc ON public.user_association_roles USING btree (association_id);


--
-- Name: idx_users_association_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_association_id ON public.users USING btree (association_id);


--
-- Name: idx_webauthn_credentials_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webauthn_credentials_assoc ON public.webauthn_credentials USING btree (association_id);


--
-- Name: ix_carriers_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_carriers_assoc ON public.carriers USING btree (association_id);


--
-- Name: ix_chat_messages_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_chat_messages_assoc ON public.chat_messages USING btree (association_id, created_at);


--
-- Name: ix_deliverers_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_deliverers_assoc ON public.deliverers USING btree (association_id);


--
-- Name: ix_demands_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_demands_assoc ON public.demands USING btree (association_id, status);


--
-- Name: ix_demands_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_demands_so ON public.demands USING btree (service_order_id) WHERE (service_order_id IS NOT NULL);


--
-- Name: ix_etl_runs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_etl_runs_date ON public.etl_runs USING btree (run_date DESC);


--
-- Name: ix_etl_task_runs_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_etl_task_runs_run ON public.etl_task_runs USING btree (run_id);


--
-- Name: ix_migration_payments_association_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_migration_payments_association_id ON public.migration_payments USING btree (association_id);


--
-- Name: ix_migration_payments_resident_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_migration_payments_resident_id ON public.migration_payments USING btree (resident_id);


--
-- Name: ix_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notifications_user ON public.notifications USING btree (user_id, association_id, created_at DESC);


--
-- Name: ix_pap_comm_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pap_comm_assoc ON public.porta_a_porta_commission_payments USING btree (association_id, operator_id);


--
-- Name: ix_pap_leads_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pap_leads_assoc ON public.porta_a_porta_leads USING btree (association_id);


--
-- Name: ix_pap_leads_operator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pap_leads_operator ON public.porta_a_porta_leads USING btree (operator_id);


--
-- Name: ix_pap_payments_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pap_payments_lead ON public.porta_a_porta_payments USING btree (lead_id);


--
-- Name: ix_push_subs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_push_subs_user ON public.push_subscriptions USING btree (user_id);


--
-- Name: ix_refresh_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_refresh_tokens_user ON public.refresh_tokens USING btree (user_id);


--
-- Name: ix_res_upd_req_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_res_upd_req_assoc ON public.resident_update_requests USING btree (association_id, status);


--
-- Name: ix_role_permissions_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_role_permissions_assoc ON public.role_permissions USING btree (association_id, role);


--
-- Name: ix_so_tasks_assoc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_so_tasks_assoc ON public.service_order_tasks USING btree (association_id);


--
-- Name: ix_so_tasks_so_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_so_tasks_so_id ON public.service_order_tasks USING btree (service_order_id);


--
-- Name: ix_uar_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_uar_user ON public.user_association_roles USING btree (user_id);


--
-- Name: ix_webauthn_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_webauthn_user ON public.webauthn_credentials USING btree (user_id);


--
-- Name: uq_inventory_active_month; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_inventory_active_month ON public.inventory_records USING btree (association_id, reference_month) WHERE ((status)::text <> 'cancelled'::text);


--
-- Name: uq_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_email ON public.users USING btree (email);


--
-- Name: associations trg_associations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_associations_set_updated_at BEFORE UPDATE ON public.associations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cash_sessions trg_cash_sessions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cash_sessions_set_updated_at BEFORE UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: packages trg_check_package_resident_tenant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_package_resident_tenant BEFORE INSERT OR UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.check_package_resident_tenant();


--
-- Name: packages trg_packages_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_packages_set_updated_at BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payment_methods trg_payment_methods_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_methods_set_updated_at BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: residents trg_residents_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_residents_set_updated_at BEFORE UPDATE ON public.residents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: service_orders trg_service_orders_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_service_orders_set_updated_at BEFORE UPDATE ON public.service_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: transaction_categories trg_transaction_categories_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_transaction_categories_set_updated_at BEFORE UPDATE ON public.transaction_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: transactions trg_transactions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_transactions_set_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES neon_auth."user"(id) ON DELETE CASCADE;


--
-- Name: invitation invitation_inviterId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.invitation
    ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES neon_auth."user"(id) ON DELETE CASCADE;


--
-- Name: invitation invitation_organizationId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.invitation
    ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES neon_auth.organization(id) ON DELETE CASCADE;


--
-- Name: member member_organizationId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.member
    ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES neon_auth.organization(id) ON DELETE CASCADE;


--
-- Name: member member_userId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.member
    ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES neon_auth."user"(id) ON DELETE CASCADE;


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: neon_auth; Owner: -
--

ALTER TABLE ONLY neon_auth.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES neon_auth."user"(id) ON DELETE CASCADE;


--
-- Name: agent_visits agent_visits_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_visits
    ADD CONSTRAINT agent_visits_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.users(id);


--
-- Name: agent_visits agent_visits_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_visits
    ADD CONSTRAINT agent_visits_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: agent_visits agent_visits_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_visits
    ADD CONSTRAINT agent_visits_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: association_settings association_settings_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.association_settings
    ADD CONSTRAINT association_settings_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: association_settings association_settings_president_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.association_settings
    ADD CONSTRAINT association_settings_president_user_id_fkey FOREIGN KEY (president_user_id) REFERENCES public.users(id);


--
-- Name: association_settings association_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.association_settings
    ADD CONSTRAINT association_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: associations associations_presidente_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.associations
    ADD CONSTRAINT associations_presidente_user_id_fkey FOREIGN KEY (presidente_user_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bank_statements bank_statements_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: bank_statements bank_statements_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: carriers carriers_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carriers
    ADD CONSTRAINT carriers_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: cash_box_movements cash_box_movements_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_box_movements
    ADD CONSTRAINT cash_box_movements_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: cash_box_movements cash_box_movements_cash_box_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_box_movements
    ADD CONSTRAINT cash_box_movements_cash_box_id_fkey FOREIGN KEY (cash_box_id) REFERENCES public.cash_boxes(id) ON DELETE CASCADE;


--
-- Name: cash_box_movements cash_box_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_box_movements
    ADD CONSTRAINT cash_box_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: cash_boxes cash_boxes_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_boxes
    ADD CONSTRAINT cash_boxes_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: cash_sessions cash_sessions_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: cash_sessions cash_sessions_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id);


--
-- Name: cash_sessions cash_sessions_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.users(id);


--
-- Name: cash_sessions cash_sessions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: chat_message_reads chat_message_reads_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reads
    ADD CONSTRAINT chat_message_reads_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_message_reads chat_message_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reads
    ADD CONSTRAINT chat_message_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: daily_task_comments daily_task_comments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_task_comments
    ADD CONSTRAINT daily_task_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: daily_task_comments daily_task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_task_comments
    ADD CONSTRAINT daily_task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.daily_tasks(id) ON DELETE CASCADE;


--
-- Name: daily_tasks daily_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tasks
    ADD CONSTRAINT daily_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: daily_tasks daily_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tasks
    ADD CONSTRAINT daily_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: daily_tasks daily_tasks_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tasks
    ADD CONSTRAINT daily_tasks_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON DELETE SET NULL;


--
-- Name: deliverers deliverers_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverers
    ADD CONSTRAINT deliverers_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: deliverers deliverers_carrier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverers
    ADD CONSTRAINT deliverers_carrier_id_fkey FOREIGN KEY (carrier_id) REFERENCES public.carriers(id);


--
-- Name: delivery_exemption_tokens delivery_exemption_tokens_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exemption_tokens
    ADD CONSTRAINT delivery_exemption_tokens_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: delivery_exemption_tokens delivery_exemption_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exemption_tokens
    ADD CONSTRAINT delivery_exemption_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: delivery_exemption_tokens delivery_exemption_tokens_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exemption_tokens
    ADD CONSTRAINT delivery_exemption_tokens_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.packages(id);


--
-- Name: delivery_exemption_tokens delivery_exemption_tokens_used_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exemption_tokens
    ADD CONSTRAINT delivery_exemption_tokens_used_by_fkey FOREIGN KEY (used_by) REFERENCES public.users(id);


--
-- Name: demands demands_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demands
    ADD CONSTRAINT demands_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: demands demands_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demands
    ADD CONSTRAINT demands_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: demands demands_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demands
    ADD CONSTRAINT demands_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: demands demands_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demands
    ADD CONSTRAINT demands_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id);


--
-- Name: etl_task_runs etl_task_runs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_task_runs
    ADD CONSTRAINT etl_task_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.etl_runs(id) ON DELETE CASCADE;


--
-- Name: daily_task_comments fk_daily_task_comments_assoc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_task_comments
    ADD CONSTRAINT fk_daily_task_comments_assoc FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: daily_tasks fk_daily_tasks_assoc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_tasks
    ADD CONSTRAINT fk_daily_tasks_assoc FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: transactions fk_tx_package; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT fk_tx_package FOREIGN KEY (package_id) REFERENCES public.packages(id) ON DELETE SET NULL;


--
-- Name: inventory_records inventory_records_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_records
    ADD CONSTRAINT inventory_records_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: inventory_records inventory_records_attributed_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_records
    ADD CONSTRAINT inventory_records_attributed_association_id_fkey FOREIGN KEY (attributed_association_id) REFERENCES public.associations(id);


--
-- Name: inventory_records inventory_records_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_records
    ADD CONSTRAINT inventory_records_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id);


--
-- Name: inventory_records inventory_records_signed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_records
    ADD CONSTRAINT inventory_records_signed_by_fkey FOREIGN KEY (signed_by) REFERENCES public.users(id);


--
-- Name: mensalidades mensalidades_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensalidades
    ADD CONSTRAINT mensalidades_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: mensalidades mensalidades_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensalidades
    ADD CONSTRAINT mensalidades_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: mensalidades mensalidades_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensalidades
    ADD CONSTRAINT mensalidades_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE CASCADE;


--
-- Name: mensalidades mensalidades_transaction_id_2_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensalidades
    ADD CONSTRAINT mensalidades_transaction_id_2_fkey FOREIGN KEY (transaction_id_2) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: mensalidades mensalidades_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensalidades
    ADD CONSTRAINT mensalidades_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: migration_payments migration_payments_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_payments
    ADD CONSTRAINT migration_payments_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: migration_payments migration_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_payments
    ADD CONSTRAINT migration_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: migration_payments migration_payments_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_payments
    ADD CONSTRAINT migration_payments_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: notifications notifications_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: package_events package_events_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_events
    ADD CONSTRAINT package_events_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: package_events package_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_events
    ADD CONSTRAINT package_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: package_events package_events_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_events
    ADD CONSTRAINT package_events_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.packages(id) ON DELETE CASCADE;


--
-- Name: packages packages_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: packages packages_delivered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_delivered_by_fkey FOREIGN KEY (delivered_by) REFERENCES public.users(id);


--
-- Name: packages packages_delivered_to_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_delivered_to_resident_id_fkey FOREIGN KEY (delivered_to_resident_id) REFERENCES public.residents(id) ON DELETE SET NULL;


--
-- Name: packages packages_delivery_fee_tx_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_delivery_fee_tx_id_fkey FOREIGN KEY (delivery_fee_tx_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: packages packages_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id);


--
-- Name: packages packages_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE SET NULL;


--
-- Name: payment_methods payment_methods_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: pix_learning_map pix_learning_map_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_learning_map
    ADD CONSTRAINT pix_learning_map_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: pix_learning_map pix_learning_map_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_learning_map
    ADD CONSTRAINT pix_learning_map_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pix_learning_map pix_learning_map_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_learning_map
    ADD CONSTRAINT pix_learning_map_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE CASCADE;


--
-- Name: porta_a_porta_commission_payments porta_a_porta_commission_payments_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porta_a_porta_commission_payments
    ADD CONSTRAINT porta_a_porta_commission_payments_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: porta_a_porta_leads porta_a_porta_leads_commissioned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porta_a_porta_leads
    ADD CONSTRAINT porta_a_porta_leads_commissioned_to_fkey FOREIGN KEY (commissioned_to) REFERENCES public.users(id);


--
-- Name: porta_a_porta_leads porta_a_porta_leads_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porta_a_porta_leads
    ADD CONSTRAINT porta_a_porta_leads_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.users(id);


--
-- Name: porta_a_porta_payments porta_a_porta_payments_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porta_a_porta_payments
    ADD CONSTRAINT porta_a_porta_payments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.porta_a_porta_leads(id);


--
-- Name: push_subscriptions push_subscriptions_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reconciliations reconciliations_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: reconciliations reconciliations_statement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES public.bank_statements(id) ON DELETE CASCADE;


--
-- Name: reconciliations reconciliations_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: resident_update_requests resident_update_requests_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_update_requests
    ADD CONSTRAINT resident_update_requests_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: resident_update_requests resident_update_requests_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_update_requests
    ADD CONSTRAINT resident_update_requests_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE CASCADE;


--
-- Name: resident_update_requests resident_update_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resident_update_requests
    ADD CONSTRAINT resident_update_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: residents residents_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: residents residents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: residents residents_responsible_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES public.residents(id) ON DELETE SET NULL;


--
-- Name: role_permissions role_permissions_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: sangria_destinations sangria_destinations_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sangria_destinations
    ADD CONSTRAINT sangria_destinations_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: scheduled_tasks scheduled_tasks_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_tasks
    ADD CONSTRAINT scheduled_tasks_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: service_order_comments service_order_comments_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_comments
    ADD CONSTRAINT service_order_comments_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: service_order_comments service_order_comments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_comments
    ADD CONSTRAINT service_order_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: service_order_comments service_order_comments_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_comments
    ADD CONSTRAINT service_order_comments_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON DELETE CASCADE;


--
-- Name: service_order_history service_order_history_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_history
    ADD CONSTRAINT service_order_history_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: service_order_history service_order_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_history
    ADD CONSTRAINT service_order_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: service_order_history service_order_history_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_history
    ADD CONSTRAINT service_order_history_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON DELETE CASCADE;


--
-- Name: service_order_phases service_order_phases_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_phases
    ADD CONSTRAINT service_order_phases_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: service_order_tasks service_order_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_tasks
    ADD CONSTRAINT service_order_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: service_order_tasks service_order_tasks_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_tasks
    ADD CONSTRAINT service_order_tasks_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: service_order_tasks service_order_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_tasks
    ADD CONSTRAINT service_order_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: service_order_tasks service_order_tasks_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_tasks
    ADD CONSTRAINT service_order_tasks_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON DELETE CASCADE;


--
-- Name: service_orders service_orders_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: service_orders service_orders_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: service_orders service_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: service_orders service_orders_phase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.service_order_phases(id);


--
-- Name: service_orders service_orders_requester_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_requester_resident_id_fkey FOREIGN KEY (requester_resident_id) REFERENCES public.residents(id) ON DELETE SET NULL;


--
-- Name: service_orders service_orders_requester_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: session_transaction_reviews session_transaction_reviews_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_transaction_reviews
    ADD CONSTRAINT session_transaction_reviews_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: session_transaction_reviews session_transaction_reviews_cash_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_transaction_reviews
    ADD CONSTRAINT session_transaction_reviews_cash_session_id_fkey FOREIGN KEY (cash_session_id) REFERENCES public.cash_sessions(id) ON DELETE CASCADE;


--
-- Name: session_transaction_reviews session_transaction_reviews_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_transaction_reviews
    ADD CONSTRAINT session_transaction_reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: session_transaction_reviews session_transaction_reviews_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_transaction_reviews
    ADD CONSTRAINT session_transaction_reviews_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: so_presence so_presence_so_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.so_presence
    ADD CONSTRAINT so_presence_so_id_fkey FOREIGN KEY (so_id) REFERENCES public.service_orders(id) ON DELETE CASCADE;


--
-- Name: so_presence so_presence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.so_presence
    ADD CONSTRAINT so_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: transaction_categories transaction_categories_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_categories
    ADD CONSTRAINT transaction_categories_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: transactions transactions_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_cash_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_cash_session_id_fkey FOREIGN KEY (cash_session_id) REFERENCES public.cash_sessions(id);


--
-- Name: transactions transactions_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.transaction_categories(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: transactions transactions_payer_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_payer_entity_id_fkey FOREIGN KEY (payer_entity_id) REFERENCES public.residents(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_reversal_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_reversal_of_id_fkey FOREIGN KEY (reversal_of_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.users(id);


--
-- Name: user_association_roles user_association_roles_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_association_roles
    ADD CONSTRAINT user_association_roles_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: user_association_roles user_association_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_association_roles
    ADD CONSTRAINT user_association_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_association_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_association_id_fkey FOREIGN KEY (association_id) REFERENCES public.associations(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict Q8rwY1BbCXIUNvuLEThAmmsLephjhaFXS6Xn2hhVLMascWA2pAUhTFDcCg6ahg8

