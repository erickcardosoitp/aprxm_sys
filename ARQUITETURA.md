# ARQUITETURA — APRXM

ERP/SaaS multi-tenant do Instituto Tia Pretinha. Documento de referência técnica:
o que existe, por que existe, e onde estão as armadilhas conhecidas.

Última revisão: 2026-08-01 (auditoria completa de banco + código).

---

## 1. Visão geral

```
┌─────────────────────────────────────────────────────────────┐
│ Vercel (deploy único via git push origin main)             │
│                                                             │
│  frontend/  React 18 + Vite + Tailwind (mobile-first)      │
│       │ JWT Bearer                                          │
│       ▼                                                     │
│  backend/   FastAPI + SQLModel + asyncpg                    │
│       │                                                     │
└───────┼─────────────────────────────────────────────────────┘
        │
        ├──► Neon "APRXM"  (OLTP, prod — 59 tabelas)
        ├──► schema `analytics` no próprio Neon "APRXM" (OLAP, Power BI)
        ├──► Cloudflare R2  (data lake bronze/silver/gold, fotos)
        └──► Cloudinary / e-mail SMTP
```

**Stack:** Python 3.10 · FastAPI · SQLModel · PostgreSQL 16 (asyncpg) · React 18 · Vite · Tailwind
**Auth:** JWT Bearer próprio (`jose` + `passlib[bcrypt]`) — ver §5.
**Código em inglês, UI em pt-BR.**

---

## 2. Multi-tenancy — a regra que não se quebra

Hierarquia: **`empresas` → `associations` → (`users`, `residents`, e todo o resto)**

Toda tabela de negócio tem `association_id UUID NOT NULL`. FKs para `associations`
usam `ON DELETE CASCADE`, o que garante que não sobram órfãos cross-tenant.

> **Nunca escreva query sem filtro de `association_id`.** Não existe RLS ativo
> como rede de segurança — o isolamento é responsabilidade do código.

### Escopo empresa-wide (ESC / Escritório)

Usuários do Escritório operam **acima** das associações (`association_id` pode ser NULL).
Helpers em `app/core/tenant.py` resolvem esse escopo (`financeiro_scope`, `scoped_ids`).

**⚠️ Fragmentação conhecida:** `finance.py` usa os helpers empresa-wide;
`packages.py`, `reports.py`, `demands.py` filtram só por `current.association_id`.
Efeito prático: usuário empresa-wide **não vê** dados nesses módulos (ocultação),
não é vazamento. Auditoria de 2026-08-01 confirmou que não há leak cross-tenant.

**Filtro de produção:** `PROD_ASSOC_FILTER` em `app/db/helpers.py` exclui associações
de homologação e marcadas `_DELETADO_`. Usar sempre esse constante — não replicar a string.

---

## 3. Camadas e responsabilidades

```
app/
  main.py            FastAPI app + lifespan (roda migrations no cold start)
  config.py          Settings via pydantic-settings (tudo por env var)
  core/
    security.py      JWT encode/decode, hash de senha
    tenant.py        CurrentUser, get_current_user, resolução de escopo
  db/
    migrations.py    ⭐ FONTE DE VERDADE do schema (ver §6)
    helpers.py       PROD_ASSOC_FILTER
  routers/           HTTP: parsing, auth, auditoria, commit
  services/          ⭐ Regra de negócio — toda ela
```

**Regra:** router não contém SQL nem regra de negócio. Service é a única fonte de regra.

**Estado real (dívida conhecida):** o refactor do commit `8b518c8` extraiu SQL de
`esc.py` para `EscService`, mas ainda têm SQL cru no router:
`financeiro.py` (~32 queries), `finance.py` (~33), `ti.py` (~25), `mensalidades.py` (~11).

---

## 4. Domínios / módulos

| Domínio | Tabelas principais | Notas de negócio |
|---|---|---|
| **Residents** | `residents` (self-FK `responsible_id`), `resident_update_requests` | `member` exige CPF; `guest` não. `ResidentStatus` controla elegibilidade de taxa. `monthly_payment_day` define vencimento. `resident_update_requests`: fila de moderação para o **futuro form público de atualização de cadastro** (morador pede alteração sem login via `public.py`, admin aprova/rejeita em `residents.py`) — endpoints prontos, ainda sem tela pública divulgada. |
| **Logistics** | `packages`, `package_events`, `carriers`, `deliverers`, `delivery_exemption_tokens`, `package_inventories` | Ciclo: received → notified → delivered/returned. Taxa R$ 2,50 se não-membro. Assinatura + foto obrigatórias. |
| **Finance** | `transactions`, `cash_sessions`, `cash_boxes`, `cash_box_movements`, `transaction_categories`, `payment_methods`, `sangria_destinations`, `session_transaction_reviews` | CashSession open/close/conferido. Sangria exige foto. Estorno via `reversal_of_id`. |
| **Conciliação** | `bank_statements`, `reconciliations`, `pix_learning_map` | Import CSV do banco Cora; matching por nome normalizado. |
| **Contas a pagar** | `contas_pagar`, `contas_pagar_templates`, `conta_pagar_baixas`, `payable_categories` | ⚠️ 0 linhas em prod — feature construída, não lançada. |
| **Mensalidades** | `mensalidades`, `migration_payments`, `products` | Pagamentos históricos ficam em `migration_payments` (campo `competencia`, não `reference_month`). Inadimplência usa `due_date < grace_cutoff`. |
| **OS** | `service_orders`, `service_order_phases/tasks/comments/history` | PDF via fpdf2, numeração incremental por tenant. |
| **Tarefas** | `daily_tasks`, `daily_task_comments`, `scheduled_tasks`, `demands` | |
| **CRM porta-a-porta** | `porta_a_porta_leads/payments/commission_payments`, `agent_visits` | |
| **RBAC** | `users`, `user_association_roles`, `role_permissions`, `painel_admins` | |
| **Infra** | `audit_log`, `api_request_logs`, `notifications`, `chat_messages`, `push_subscriptions`, `etl_runs`, `etl_task_runs`, `schema_migrations` | |

### Definição de "Saldo em caixa"
Receita − despesa de: lançamentos manuais + migração + **sessões conferidas**.
Sessões abertas **nunca** entram no saldo. Sessão conferida usa
`closing_balance − opening_balance` (valor físico contado), não recalcula por transação —
isso preserva quebra de caixa registrada na conferência.

---

## 5. Segurança

**Auditado em 2026-08-01. Resultado: nenhum achado crítico.**

- **JWT:** `secret_key` obrigatório via env, sem default hardcoded. Validação de
  expiração default do `jose` intacta. `painel_auth.py` usa secret isolado.
- **Escalonamento de privilégio:** `admin.py:129-148` e `esc_service.py:583-618`
  bloqueiam auto-promoção e exigem já ser `admin_master`/`superadmin` para promover.
  *(Suspeita anterior de brecha foi refutada por leitura de código.)*
- **SQL injection:** interpolação por f-string existe, mas só de nomes de tabela/coluna
  fixos; valores de usuário sempre via bind param. **Não auditado a fundo:**
  `crm.py`, `senso.py`, `datalake_service.py`.
- **Log de request** (`main.py:92-116`) grava path/method/status/duration/user_id —
  **não** grava body, então CPF/endereço não vazam por esse caminho.
- **`neon_auth.*`** (`account`, `jwks`, `organization`, `session`, `user`, `verification`,
  `member`, `invitation`): schema provisionado pelo Neon, **zero uso** no código.
  Não é "Better Auth" nem risco de execução — é lixo de schema a ser removido.
- **Atenção:** se `app_env` != production, stack trace completo vai pro cliente
  (`main.py:119-131`). Garantir a env var correta na Vercel.

---

## 6. Migrations — leia antes de mexer

**A fonte de verdade é `backend/app/db/migrations.py`**, não a pasta `.sql`:

- versionado por `SCHEMA_VERSION` (atualmente 21)
- registrado em `schema_migrations (version, applied_at, description)`
- protegido por `pg_try_advisory_xact_lock(987654321)` — uma instância migra,
  as outras saem cedo
- roda no lifespan do FastAPI, com fast-exit (~2ms) quando já atualizado

`database/migrations/*.sql` é **histórico/documentação** — vários arquivos dizem no topo
"já aplicada em produção, este arquivo documenta". Rodar a pasta em sequência **não**
reconstrói o schema. Ver `database/migrations/README.md`.

### Duas armadilhas que já causaram incidente

**1. Replay de migration.** Ao bumpar `SCHEMA_VERSION`, **todos** os blocos anteriores
reexecutam. Bloco não idempotente = outage no cold start (aconteceu na Fase 8a).
Todo bloco precisa ser replay-safe.

**2. `DROP TYPE ... CASCADE` (incidente 020).** A migration `020_fix_enum.sql` usou
`DROP TYPE ... CASCADE` para recriar um enum e **derrubou a coluna
`service_orders.status` inteira**. Só foi recuperável porque `service_order_history`
guardava as transições — `020_restore_status.sql` reconstruiu o valor a partir do
`to_status` mais recente por OS.
→ Antes de qualquer `DROP` com `CASCADE`, consultar `pg_depend` e listar o que cai.

**Dados de teste** vivem em `database/seeds/`, fora do fluxo de migration.

---

## 7. Data lake / Analytics (ETL Medallion)

Toda a lógica em `backend/app/services/datalake_service.py` + `routers/datalake.py`.
Sem scripts externos. Cron em `backend/vercel.json`: `0 12 * * *` e `0 20 * * *` UTC
(09h/17h Brasília).

```
Neon OLTP ──► bronze ──► silver ──► gold ──► schema analytics.* (dim_/fact_) ──► Power BI
                       (Cloudflare R2)      (mesmo projeto Neon "APRXM", não um projeto separado)
```

**Correção 2026-08-01 (Fase 1 do painel da presidência):** o nome "aprxm-analytics" sugeria
um projeto Neon separado — na prática, `ANALYTICS_DATABASE_URL` aponta pro **mesmo projeto
"APRXM"**, só que pro schema `analytics` (não `public`). Existe um projeto Neon chamado
literalmente "aprxm-analytics" (`wispy-frost-54420468`), mas está **vazio** — não é o
destino real do ETL. `analytics.dim_date/dim_resident/dim_association/fact_transactions/
fact_packages/fact_mensalidades/fact_inadimplencia/fact_service_orders/fact_social` vivem
todos em `shy-sun-98696640` (o banco operacional), schema `analytics`.

**Incidente corrigido em 2026-08-01:** `_write_gold_sync` engolia falha de carga no
Analytics como `warning` e o orquestrador logava `analytics_load` como `success`
incondicionalmente — resultado: `etl_runs.status = 'success'` por ~2 meses enquanto as
tabelas `dim_`/`fact_` não recebiam dado nenhum (congeladas desde 2026-05-28).

Agora `_write_gold_sync` retorna `(linhas, falhas)`, a falha entra em
`validation_errors`, e o run é marcado `warning`. Também detecta "0 linhas escritas
apesar de haver frames Gold".

> **Pendência operacional:** validar se `ANALYTICS_DATABASE_URL` na Vercel ainda é
> válida — hipótese nº1 para a lacuna (branch Neon Analytics pode ter sido pausada).

---

## 8. Modelagem — anti-patterns conhecidos

| Item | Problema | Ação |
|---|---|---|
| `mensalidades.transaction_id` + `transaction_id_2` | Duas FKs para a mesma entidade; ambiguidade sobre qual é o pagamento principal | Normalizar para 1:N ou documentar os dois papéis |
| `associations.presidente_user_id` vs `association_settings.president_user_id` | Mesmo conceito, PT em uma tabela, EN na irmã | Padronizar em inglês |
| `notifications` | 0 linhas vivas, ~352k updates — usada como fila com hard delete | `read_at`/soft-delete, ou fila real |
| `user_association_roles` | 4.583 inserts / 6.507 deletes para 46 linhas vivas — troca de papel faz DELETE+INSERT | UPDATE idempotente |
| `api_request_logs` | 88k linhas, crescimento contínuo, faxina por DELETE | `PARTITION BY RANGE (created_at)` + drop de partição |
| `packages.resident_cep` | Coluna existe, **sempre vazia** em toda a base | Preencher no recebimento ou remover |
| `dim_*`/`fact_*` no banco OLTP | Analytics no mesmo projeto Neon do transacional (schema `analytics`, isolado do `public` mas ainda no mesmo backup/dump/instância) | Aceitável por ora — separação por schema já evita mistura de tabela; migrar pra projeto físico separado só se o volume/custo justificar |

### Qualidade de dado — moradores (1.804 ativos)

| Campo | Situação |
|---|---|
| CEP | 292 em branco (era 302 — 10 inferidos por rua em 2026-08-01). Formato **normalizado**: 100% em 8 dígitos puros, sem hífen |
| Telefone | 1.361 vazios (75%) — **bloqueia notificação de encomenda** |
| Número | 429 vazios (24%) — impacta porta-a-porta |
| Nome | 96 sem sobrenome |

CEP é inferível por rua com segurança: cada rua tem 1 CEP real (as "variantes"
eram só formatação). Mas 282 dos casos em branco **também não têm rua** — exigem
ViaCEP por endereço ou contato direto.

**Convenção de CEP:** armazenar sempre **8 dígitos puros** (sem hífen). O hífen é
apresentação — usar `formatCep()` (`frontend/src/utils.ts`) na exibição. Escrita no
app já normaliza com `.replace(/\D/g,'')`.

### Schema `neon_auth` — 8 tabelas removidas em 2026-08-01

`user`, `account`, `session`, `organization`, `member`, `invitation`, `verification`, `jwks`
foram dropadas — provisionadas pelo Neon, nunca usadas (zero referência em query, zero
mapeamento ORM, FKs apontavam só entre si). Restou **`neon_auth.project_config`**
(config da integração Neon Auth em si) — mesma categoria, mas não estava no escopo
aprovado; decisão pendente.

### Módulo porta-a-porta — removido em 2026-08-01

Feature de captação de lead com comissão (`porta_a_porta_leads/payments/commission_payments`)
descontinuada por decisão de produto. Removido código e dados: `models/porta_a_porta.py`,
`routers/porta_a_porta.py`, e referências em `cash_boxes.py` (resumo consolidado),
`finance_service.py` (auto-criação de lead em pagamento "acordo" + card `pap_today`),
`residents.py` (merge de duplicados), `tenant.py`/`main.py`/`database.py` (registro do router/model).

**Não confundir com o "portal de agente" do CRM** (`crm.py:893-1080`,
`pages/public/CadastroPortaAPorta.tsx` na rota `/associar`) — é cobrança remota de
mensalidade via link/token, feature ativa e mantida, apesar do nome do arquivo. `agent_visits`
(registro de visita, endpoints `/crm/visitas`) também é do CRM e foi mantida.

---

## 9. Padrões de código

**Backend**
- 100% OOP, SOLID, Clean Architecture. Imports absolutos.
- Regra de negócio só em `services/`.
- Sem blob binário no banco — usar Cloudinary/R2.
- Exceção: nunca `except Exception: pass`. Logar com `logger.exception` e devolver
  erro específico (modelo correto: `excluir_usuario` em `esc.py:634-645` → 409 em
  `IntegrityError`).
- Paginação real (`skip`/`limit` + envelope `{total, items}`), não `LIMIT` fixo.
  Modelo: `esc_service.py:93-144`. **Dívida:** `reports.py` usa `LIMIT 10000/20000`
  fixo em 7 pontos; `financeiro.py:915`, `crm.py:734,959,1012` usam LIMIT fixo.

**Frontend**
- Componentes funcionais + hooks, pequenos e reutilizáveis. Lógica fora do JSX.
- Evitar re-render: `useCallback` em `fetchFn` passado para tabela
  (modelo certo: `SangriasSection.tsx:26-29`).
- **Dívida:** `EscDataTable` carrega lista inteira client-side — usado por
  `MoradoresPage` (~1.800 registros), `CrmSection` (mensalidades), `UsuariosSection`,
  `AssociacoesSection` e outros. Só `EncomendasSection`/`OrdensServicoSection` têm
  paginação server-side. Unificar num componente paginado único.
- Sem `.catch(() => {})` silencioso — 13 ocorrências no ESC deixam selects vazios
  sem avisar o usuário.
- Acessibilidade: `pages/esc/` tem **zero** `aria-*`/`role=`. Botão só-ícone precisa
  `aria-label`; cabeçalho ordenável precisa `aria-sort`.

---

## 10. Índices

Criados em 2026-08-01 (FKs de tráfego alto que não tinham índice):
`transactions.payment_method_id`, `.reversal_of_id`, `.payer_entity_id`,
`mensalidades.transaction_id`, `.transaction_id_2`,
`cash_sessions.opened_by`, `.closed_by`, `.reviewed_by`,
`packages.delivered_to_resident_id`, `.delivery_fee_tx_id`.

Restam ~79 FKs sem índice, quase todas `created_by`/`updated_by` — baixo risco,
raramente usadas em JOIN/WHERE.

Busca textual usa `CREATE INDEX CONCURRENTLY` (`021_residents_search_index.sql`,
`022_packages_search_indexes.sql`). ⚠️ `CONCURRENTLY` não roda dentro de transação —
não migrar essa lógica para `migrations.py` sem tratar isso.

---

## 11. Deploy

`git push origin main` → deploy automático na Vercel (frontend + backend).
`.vercel/project.json` aponta para `aprxm-sys_frontend`; backend via
`backend/vercel.json` (`@vercel/python`).

Migration roda no cold start do FastAPI — **um deploy com bloco de migration não
idempotente derruba a aplicação inteira**. Ver §6.
