# Plano de Implementação — Governança de Empresa / ESC (APRXM)

**Data:** 2026-07-15
**Spec-fonte:** `docs/superpowers/specs/2026-07-15-governanca-empresa-esc-design.md`
**Restrição não-negociável:** ZERO DOWNTIME. Vaz Lobo e Congonha estão em produção. Todo deploy é `git push origin main` → Vercel.

---

## Mecânica de migração deste projeto (leia antes de tudo)

Descoberta crítica que molda todo o faseamento: **as migrations não são aplicadas rodando os arquivos `database/migrations/*.sql`**. Esses arquivos são documentação/reprodução. As migrations reais rodam em `backend/app/main.py`, na função `_run_migrations()` chamada no `lifespan` (cold start), controladas por:

- Um inteiro `_SCHEMA_VERSION` (hoje `= 4`, em `main.py:30`)
- Uma tabela `schema_migrations (version, applied_at, description)`
- Um advisory lock (`pg_try_advisory_xact_lock(987654321)`) que serializa cold starts concorrentes
- **Dois ramos** que precisam ser mantidos em paralelo: o ramo `_is_existing_db` (produção — Vaz Lobo/Congonha caem aqui) e o ramo de DB fresca (dev/staging). Todo bloco novo precisa ser adicionado **nos dois ramos** e `_SCHEMA_VERSION` incrementado.

**Implicação de zero-downtime:** como a migration roda no `lifespan` do mesmo deploy que traz o código, durante o rollout da Vercel instâncias antigas continuam servindo **código antigo contra o schema já migrado** até serem recicladas. Portanto:

1. Toda migration precisa ser **retrocompatível com o código atualmente em produção** (aditiva: coluna nullable, tabela nova, `ADD VALUE IF NOT EXISTS` em enum). Nunca `DROP`/`NOT NULL`/`RENAME` no mesmo deploy que introduz a dependência.
2. Mudança destrutiva (dropar `is_office`, `linked_association_slugs`, tornar `empresa_id` NOT NULL) só entra num deploy **posterior**, depois que todo o código que dependia do estado antigo já saiu de produção e foi validado.
3. Cada fase abaixo = pelo menos um bump de `_SCHEMA_VERSION` e/ou um deploy de código, desenhado para ser seguro isoladamente.

Convenção adotada no plano: as versões novas de schema seguem a numeração de `_SCHEMA_VERSION` (próxima livre: **v5**). Os arquivos `database/migrations/NNN_*.sql` continuam sendo criados em paralelo como documentação versionada (próximo número livre: **027**), espelhando exatamente o SQL colocado em `main.py`.

---

## Estado atual mapeado (baseline)

**Já pronto, reaproveitar (não recriar):**
- `backend/app/core/tenant.py`: `CurrentUser` (com `.empresa_id`, `.is_platform_admin`, `.is_empresa_admin`, `.is_admin_master`), guards `require_platform_admin`, `require_empresa_admin`, `require_office_context`, helper `assert_same_empresa`. **Nenhum está plugado em router.**
- `backend/app/core/security.py`: `create_access_token(..., empresa_id=...)` já emite a claim `empresa_id` no JWT; `hash_password` (bcrypt) pronto para senhas geradas.
- `backend/app/services/email_service.py`: `send_email(to, subject, html, ...)` — reaproveitar para o e-mail de senha gerada.
- Enum `user_role` já contém `superadmin`, `admin_master`, `agente` etc. (`admin_master` é adicionado via `ADD VALUE IF NOT EXISTS` no bloco de migração existente).

**Hooks temporários a remover só no fim (`_empresa_col_exists` via information_schema):**
- `backend/app/routers/auth.py`: `refresh_token` (linhas ~96-102) e `switch_association` (linhas ~280-331).
- `backend/app/services/auth_service.py`: `authenticate` (linhas ~42-98).

**6 pontos que referenciam `is_office`** (a limpar na Fase 7, nesta ordem de dependência):
1. `backend/app/models/association.py:26` — campo do model
2. `backend/app/core/security.py:41,56` — parâmetro + claim no JWT
3. `backend/app/core/tenant.py:21,32,127,177` — atributo de `CurrentUser` + `require_office_context`
4. `backend/app/services/auth_service.py:48,70,81,88,95` — SELECTs e emissão de token
5. `backend/app/routers/auth.py:287,328` — `switch_association`
6. `backend/app/routers/geral.py:5` — apenas docstring (trivial)

**Tabelas de provisionamento por associação** (todas keyed por `association_id`): `association_settings` (PK `association_id`), `cash_boxes`, `payment_methods`, `transaction_categories`.

**Frontend:** React/Vite; rotas em `frontend/src/App.tsx` com guards `RequireAdmin`, `RequireModule`, `RequireAggregator`, `RequireNotOffice`; estado em `frontend/src/store/authStore.ts`; cliente HTTP em `frontend/src/services/api.ts`. `admin_master`/`superadmin` já reconhecidos nos guards (App.tsx:95,132). Home natural da governança: nova área ou extensão de `TIPage`/painel superadmin.

---

## FASE 1 — Migrations aditivas (schema novo, zero comportamento alterado)

**Objetivo:** criar toda a estrutura nova em modo aditivo. Nenhuma coluna vira NOT NULL, nada é dropado, nenhum código passa a depender disso ainda. Risco ~zero: o código em produção ignora completamente as colunas/tabelas novas.

**Onde implementar:** novo bloco `v5` em `backend/app/main.py` `_run_migrations()` (nos dois ramos: `_is_existing_db` e fresh-DB), `_SCHEMA_VERSION` de `4` → `5`. Documentar em `database/migrations/027_governanca_empresa.sql`.

**Esboço SQL (aditivo):**
```sql
-- tabela empresas
CREATE TABLE IF NOT EXISTS empresas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(255) NOT NULL,
    slug                    VARCHAR(100) UNIQUE NOT NULL,
    financeiro_centralizado BOOLEAN NOT NULL DEFAULT FALSE,
    plan_name               VARCHAR(50) NOT NULL DEFAULT 'basic',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- associations.empresa_id: NULLABLE nesta fase (backfill vem na Fase 2, NOT NULL só na Fase 7)
ALTER TABLE associations ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
CREATE INDEX IF NOT EXISTS ix_associations_empresa ON associations(empresa_id);

-- users.association_id: DROP NOT NULL (aditivo — afrouxa constraint, não quebra ninguém)
ALTER TABLE users ALTER COLUMN association_id DROP NOT NULL;

-- role_permissions e audit_log: association_id nullable + empresa_id nullable
ALTER TABLE role_permissions ALTER COLUMN association_id DROP NOT NULL;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
ALTER TABLE audit_log ALTER COLUMN association_id DROP NOT NULL;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);

-- provisioning_runs
DO $$ BEGIN
    CREATE TYPE provisioning_run_type AS ENUM ('create_empresa','create_associacao');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE TYPE provisioning_run_status AS ENUM ('running','success','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS provisioning_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id   UUID REFERENCES empresas(id),
    run_type     provisioning_run_type NOT NULL,
    status       provisioning_run_status NOT NULL DEFAULT 'running',
    payload      JSONB NOT NULL,
    steps        JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_detail TEXT,
    started_by   UUID NOT NULL REFERENCES users(id),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);
```

**Nota sobre `DROP NOT NULL` em `users.association_id`:** é uma operação de metadados (rápida, sem reescrita de tabela) e é retrocompatível — o código atual sempre insere `association_id`, então afrouxar a constraint não muda nada em produção. Idem para `role_permissions`/`audit_log`.

**Arquivos tocados/criados:**
- `backend/app/main.py` (bloco v5 nos dois ramos + bump `_SCHEMA_VERSION`)
- `database/migrations/027_governanca_empresa.sql` (documentação)

**Critério de pronto:**
- Deploy sobe; `SELECT MAX(version) FROM schema_migrations` retorna `5`.
- `\d empresas`, `\d provisioning_runs` existem; `associations.empresa_id`, `role_permissions.empresa_id`, `audit_log.empresa_id` existem e nullable; `users.association_id` é nullable.
- Login/refresh/switch de Vaz Lobo e Congonha continuam funcionando idênticos (o `_empresa_col_exists` agora encontra a coluna e começa a selecionar `a.empresa_id`, que ainda é NULL → comportamento legado preservado pela lógica `if ... is None` já existente em `auth_service.py`/`auth.py`). **Este é o ponto de verificação mais importante da fase.**

**Rollback:** as estruturas são inertes (nada as usa). Se algo der errado, deploy de reversão do `main.py` (voltar `_SCHEMA_VERSION` não desaplica, mas não há necessidade — colunas/tabelas vazias e nullable não afetam o código antigo). Rollback destrutivo só se necessário: `DROP TABLE provisioning_runs; ALTER TABLE ... DROP COLUMN empresa_id;` etc., manualmente. Não deve ser preciso.

---

## FASE 2 — Migration de dados (coexistência dos dois modelos)

**Objetivo:** criar a empresa real, backfill de `empresa_id` em Vaz Lobo/Congonha, e promover os usuários do Escritório a `admin_master`. **Sem remover `is_office` nem `linked_association_slugs`** — os dois modelos coexistem. Depois desta fase, o JWT de Vaz Lobo/Congonha passa a carregar `empresa_id` real, e a lógica de `linked_ids` "mesma empresa" (já presente em `auth_service.py:74-77`) começa a valer de fato.

**Onde implementar:** bloco `v6` em `main.py` (idempotente, guardado por `schema_migrations`), documentado em `database/migrations/028_governanca_empresa_dados.sql`. Data migration idempotente com `ON CONFLICT`/`WHERE NOT EXISTS`.

**Esboço SQL:**
```sql
-- 1. empresa real
INSERT INTO empresas (name, slug, financeiro_centralizado, plan_name)
VALUES ('SAPE - Vaz Lobo / Buriti / Congonha', 'sape-vazlobo-congonha', TRUE, 'enterprise')
ON CONFLICT (slug) DO NOTHING;

-- 2. backfill empresa_id em Vaz Lobo + Congonha
UPDATE associations SET empresa_id = (SELECT id FROM empresas WHERE slug='sape-vazlobo-congonha')
WHERE slug IN ('vaz-lobo','congonha') AND empresa_id IS NULL;

-- 3. usuários do Escritório -> admin_master, association_id = NULL
--    (a linha is_office continua existindo; só migramos os users)
UPDATE users u
SET role = 'admin_master', association_id = NULL, token_version = token_version + 1
WHERE u.association_id = (SELECT id FROM associations WHERE slug='escritorio' AND is_office = TRUE)
  AND u.is_active = TRUE;
-- desativa memberships UAR do escritório desses usuários (opcional, ver nota)
```

**Decisões de execução:**
- **`token_version + 1` nos usuários migrados** força reemissão de token: no próximo login/refresh o `admin_master` recebe JWT com `empresa_id` e `association_id=NULL`. Sem isso, tokens vivos continuariam com o estado antigo.
- **A linha `is_office=true` (Escritório) NÃO é removida aqui.** Ela é dropada só na Fase 7, depois que o código novo estiver validado. Enquanto isso, `require_office_context` e o painel `/geral` continuam funcionando para quem ainda tiver token antigo (defensivo).
- **`linked_association_slugs` permanece** — Fase 7.
- Nenhuma transação, morador, mensalidade ou dado operacional é tocado.

**Ponto de atenção — `admin_master` com `association_id=NULL` e o código atual:** o fluxo de login antigo (`auth_service.authenticate`) usa `user.association_id` no fallback. Um `admin_master` sem UAR e sem `association_id` cairia num fallback quebrado. **Mitigação:** manter, para os usuários migrados, um membership em `user_association_roles` apontando para Vaz Lobo (ou Congonha) com role `admin_master` — assim o ramo `if memberships:` do `authenticate` os atende, define `primary_empresa_id` corretamente, e o `association_id` do token vira uma associação real da empresa (aceitável no modelo de coexistência; a Fase 3 introduz o tratamento próprio de `association_id=NULL`). Validar esse comportamento explicitamente antes de avançar.

**Arquivos tocados/criados:**
- `backend/app/main.py` (bloco v6, bump `_SCHEMA_VERSION` → 6)
- `database/migrations/028_governanca_empresa_dados.sql`

**Critério de pronto:**
- `SELECT empresa_id FROM associations WHERE slug IN ('vaz-lobo','congonha')` → mesma empresa, não-nula.
- Usuários do Escritório com `role='admin_master'`.
- Login de um usuário admin_master retorna JWT com `empresa_id` preenchido; login de operador comum de Vaz Lobo/Congonha inalterado.
- Painel `/geral` ainda abre (coexistência). Nenhum operador comum perdeu acesso.

**Rollback:**
```sql
UPDATE users SET role='<role_antiga>', association_id='<escritorio_id>' WHERE ...; -- reverter promoção
UPDATE associations SET empresa_id = NULL WHERE slug IN ('vaz-lobo','congonha');
DELETE FROM empresas WHERE slug='sape-vazlobo-congonha';
```
Guardar snapshot (`SELECT id, role, association_id`) dos usuários do Escritório antes de rodar, para reverter role/association exatos. Como o código lida com `empresa_id NULL` como legado, reverter é seguro.

---

## FASE 3 — Backend: services + wiring de guards (sem remover nada do fluxo `is_office`)

**Objetivo:** introduzir os models SQLModel, os serviços de provisionamento e conectar os guards já existentes de `tenant.py`. Nada do fluxo `is_office` é removido. Endpoints ainda não expostos (ou expostos mas idempotentes/seguros) — o foco é a lógica reutilizável e testável.

**Novos models:**
- `backend/app/models/empresa.py` — `Empresa(SQLModel, table=True)` espelhando a tabela.
- `backend/app/models/provisioning_run.py` — `ProvisioningRun`.
- Atualizar `backend/app/models/association.py`: adicionar `empresa_id: UUID | None` (nullable ainda — vira obrigatório no model só na Fase 7). **Manter `is_office` no model** por ora.
- Atualizar `backend/app/models/user.py`: `association_id: UUID | None` (refletir o DROP NOT NULL). Confirmar que nenhum código faz `assert user.association_id` implicitamente.

**Novos services:**
- `backend/app/services/empresa_service.py` — `EmpresaService`:
  - `create_empresa(payload, started_by)`: cria linha em `provisioning_runs` (`run_type='create_empresa'`, `status='running'`), cria `empresas`, cria admin inicial (`role='admin_master'`, `association_id=NULL`, senha gerada via `secrets.token_urlsafe` + `hash_password`), envia e-mail via `email_service.send_email`, grava cada passo em `steps` (JSONB), finaliza `status='success'`/`'failed'` + `finished_at`. Tudo numa transação; em falha, `status='failed'` + `error_detail` e rollback dos efeitos de dados (a linha `provisioning_runs` é persistida à parte para auditoria — usar sessão/commit separado para o log de falha).
- `backend/app/services/association_provisioning_service.py` — `AssociationProvisioningService.create_associacao(empresa_id, payload, started_by)`:
  - Valida `assert_same_empresa`. Cria `associations` (com `empresa_id`), `association_settings` (campos do Form 2: `community_name`, `default_mensalidade_amount`, dia de vencimento → mapear para o campo existente, `default_cash_balance`, dia de inventário, `president_name`), `transaction_categories` + `payment_methods` default, `cash_boxes` inicial, admin da associação (senha gerada + e-mail). Registra passos em `provisioning_runs` (`run_type='create_associacao'`).
  - **Dia de inventário:** hoje `inventory_day_of_month` existe em `associations`. Nesta fase ainda gravar lá (compat), e a Fase 8 decide a migração para nível empresa.

**Wiring de guards (reaproveitar `tenant.py`, não recriar):**
- Usar `require_platform_admin` (criar empresa, criar superadmin), `require_empresa_admin` (criar associação dentro da empresa), `assert_same_empresa` (escopo). Nenhum guard novo.

**Reforço de escopo (defensivo, aditivo):** ao criar/listar recursos de empresa, sempre filtrar por `current.empresa_id` (exceto `superadmin`). Não alterar os filtros por `association_id` já existentes nos outros routers.

**Arquivos tocados/criados:**
- Criar: `backend/app/models/empresa.py`, `backend/app/models/provisioning_run.py`, `backend/app/services/empresa_service.py`, `backend/app/services/association_provisioning_service.py`
- Editar: `backend/app/models/association.py`, `backend/app/models/user.py`
- (sem alterar `auth.py`/`auth_service.py`/`security.py` ainda)

**Critério de pronto:**
- Testes unitários dos services criando empresa+admin e associação+defaults num DB de teste; e-mail mockado.
- App sobe sem erro de import/model. Login e todos os fluxos existentes inalterados (nada novo está no caminho crítico ainda).

**Rollback:** puramente código; reverter o deploy. Sem mudança de schema nesta fase. Dados criados por testes ficam isolados.

---

## FASE 4 — Backend: endpoints novos

**Objetivo:** expor a API de governança, protegida pelos guards da Fase 3.

**Novo router `backend/app/routers/governanca.py`** (prefixo `/governanca`), registrado em `main.py` (`app.include_router(governanca.router, prefix=PREFIX)`):
- `POST /governanca/empresas` — `require_platform_admin` → `EmpresaService.create_empresa` (Form 1).
- `GET /governanca/empresas` — `require_platform_admin` (superadmin vê todas) ou `require_empresa_admin` (vê a própria).
- `POST /governanca/empresas/{empresa_id}/associacoes` — `require_empresa_admin` + `assert_same_empresa` → `AssociationProvisioningService` (Form 2).
- `GET /governanca/provisioning-runs` — lista runs escopadas por empresa (`assert_same_empresa`), para a tela de acompanhamento.
- `GET /governanca/provisioning-runs/{id}` — detalhe com `steps`/`error_detail`.
- (Opcional Fase 4/adiável) `PATCH /governanca/associacoes/{id}/desativar` — soft delete em cascata (Seção 2 da spec): `associations.is_active=false` + `users.is_active=false` para usuários vinculados **só** a ela (não afeta `admin_master`/`superadmin` sem `association_id`). Este endpoint pode ir na Fase 4 ou 6; recomendo Fase 4 com testes fortes, pois é destrutivo em produção.

DTOs Pydantic seguindo o padrão existente (ver `superadmin.py`). Rate limit onde fizer sentido (reuso de `app.core.limiter`).

**Arquivos tocados/criados:**
- Criar: `backend/app/routers/governanca.py`
- Editar: `backend/app/main.py` (registro do router)

**Critério de pronto:**
- Chamadas manuais (superadmin) criam uma **empresa de teste** e uma **associação de teste** ponta a ponta, com e-mail de senha entregue e `provisioning_runs` populado com `status='success'`.
- Guards negam corretamente: `admin` comum recebe 403; `admin_master` de outra empresa recebe 403 via `assert_same_empresa`.
- Fluxos de produção (Vaz Lobo/Congonha) inalterados — nada roteia por aqui.

**Rollback:** remover registro do router / reverter deploy. Empresa/associação de teste desativáveis via soft delete ou removíveis manualmente. Não tocar em dados de produção.

---

## FASE 5 — Frontend: wizards + checklist + acompanhamento

**Objetivo:** interface no-code sobre a API da Fase 4.

**Serviço de API:** `frontend/src/services/governanca.ts` (mesmo padrão de `services/api.ts`).

**Páginas/rotas novas em `frontend/src/App.tsx`** (guarda por `admin_master`/`superadmin`, que já são reconhecidos em App.tsx:95/132; criar guard dedicado tipo `RequireEmpresaAdmin` reaproveitando a checagem já existente):
- Wizard **Form 1 — Criar Empresa** (`superadmin`): nome, slug, admin inicial (nome, sobrenome, email, cargo texto-livre), toggle `financeiro_centralizado`. Sem exibir senha (enviada por e-mail).
- Wizard **Form 2 — Criar Associação** (`admin_master`/`superadmin`): campos base de `associations` + campos essenciais de `association_settings` (nome da comunidade, valor de mensalidade, dia de vencimento, saldo inicial de caixa, dia de inventário, nome do presidente). Campos sem UI (`access_groups`, `cadastros`) ficam com default.
- **Checklist complementar** no primeiro acesso do admin da associação (logo, assinatura do presidente, ajustes finos) — não bloqueia. Pode ser um banner/modal disparado por estado do `association_settings` ainda vazio.
- **Tela de acompanhamento de `provisioning_runs`** (status/steps/erros), lendo `GET /governanca/provisioning-runs`.

Reuso de componentes de formulário existentes (padrão `SettingsPage`/`AdminPage`). Validação client-side de slug/e-mail.

**Arquivos tocados/criados:**
- Criar: `frontend/src/services/governanca.ts`, páginas em `frontend/src/pages/governanca/` (ex.: `CriarEmpresaWizard.tsx`, `CriarAssociacaoWizard.tsx`, `ProvisioningRunsPage.tsx`, `ChecklistComplementar.tsx`)
- Editar: `frontend/src/App.tsx` (rotas + guard), `frontend/src/store/authStore.ts` se precisar expor `empresa_id`/flags no estado, navegação (`AppShell.tsx`)

**Critério de pronto:**
- Superadmin cria empresa de teste pela UI; e-mail chega; login do novo admin_master funciona.
- Admin_master cria associação de teste pela UI; defaults financeiros aparecem; checklist aparece no primeiro acesso.
- Tela de acompanhamento mostra runs com sucesso e simula uma falha (ex.: slug duplicado) exibindo `error_detail`.
- App de produção (usuários comuns) sem regressão visual/funcional.

**Rollback:** reverter deploy de frontend (Vercel guarda deploy anterior). Backend permanece; UI simplesmente some.

---

## FASE 6 — Validação em produção (coexistência)

**Objetivo:** confirmar que Vaz Lobo/Congonha já operam no modelo novo (com `empresa_id`, admin_master funcionando) **convivendo com o código antigo** (`is_office`, `linked_association_slugs`, `_empresa_col_exists` ainda presentes). Nenhum deploy nesta fase — é uma janela de observação.

**Checklist de validação em produção:**
- Login/refresh/switch de todos os perfis reais (operador, conferente, diretoria, admin, admin_master) sem erro; JWT carrega `empresa_id` correto.
- `admin_master` (ex-Escritório) enxerga visão consolidada por `empresa_id`; painel `/geral` ainda funciona.
- Criação de uma **associação piloto real** dentro da empresa SAPE via wizard (se o negócio quiser) OU manter só as de teste. Decisão do usuário.
- `switch-association` respeita "um token = uma empresa" (bloqueio 409 já existente).
- Auditoria: `audit_log`/`role_permissions` aceitam registros com `empresa_id` (nível empresa) sem quebrar leitura antiga.
- Monitorar logs de erro (Sentry/Vercel) por período combinado (ex.: 1 semana).

**Critério de pronto:** janela de observação sem incidentes; sinal verde explícito do usuário para prosseguir com a remoção destrutiva.

**Rollback:** nenhuma mudança para reverter; se algo aparecer, voltar às fases anteriores.

---

## FASE 7 — Remoção do modelo antigo (destrutivo — só após Fase 6 validada)

**Objetivo:** eliminar `is_office`, `linked_association_slugs`, o hook `_empresa_col_exists`, tornar `associations.empresa_id` NOT NULL, e limpar as 6 referências a `is_office`. **Feito em sub-passos, código antes de schema.**

### 7a — Código: remover dependência de `is_office`/`_empresa_col_exists` (deploy só de código)

Ordem (das folhas para a raiz, para não quebrar imports/queries no meio):

1. `backend/app/routers/geral.py:5` — docstring; trivial. Reavaliar se `/geral` ainda deve existir ou virar visão por `empresa_id` (ligado à Fase 8). Se o painel consolidado migrar para `empresa_id`, `is_aggregator`/`linked_association_ids` podem dar lugar a filtro por empresa. Decidir junto da Fase 8.
2. `backend/app/services/auth_service.py` — remover `_empresa_col_exists` e o `empresa_select` condicional; passar a selecionar `a.empresa_id` sempre; remover `is_office` do SELECT e da emissão do token. `empresa_id` agora é garantido não-nulo (após 7c).
3. `backend/app/routers/auth.py` — `refresh_token` e `switch_association`: remover checagem `information_schema`, selecionar `a.empresa_id` direto, remover `is_office` do token.
4. `backend/app/core/security.py` — remover parâmetro `is_office` e a claim `"is_office"` de `create_access_token`.
5. `backend/app/core/tenant.py` — remover `is_office` de `CurrentUser.__init__`/atributo/leitura da claim; **substituir `require_office_context`** por lógica baseada em empresa (`is_empresa_admin` + `empresa_id`) ou remover o guard se nenhum router passar a usá-lo. Verificar consumidores antes.
6. `backend/app/models/association.py` — remover `is_office` do model; tornar `empresa_id` não-opcional no model (só depois do 7c). Remover comentário de `linked_association_slugs`.

**Retrocompatibilidade do deploy 7a:** a claim `is_office` deixa de ser emitida, mas `tenant.py` a lê com `.get("is_office", False)` — tokens antigos ainda em circulação continuam decodificando. Como removemos a leitura, tokens antigos simplesmente perdem o flag (aceitável: `admin_master` não depende de `is_office`). Garantir que nenhum caminho crítico dependa de `is_office=True` para conceder acesso a operadores comuns (não depende — só afetava Escritório).

### 7b — Verificação intermediária
Deploy 7a em produção; confirmar login/refresh/switch OK **sem** o hook dinâmico; confirmar que nenhuma query referencia mais `is_office`/`linked_association_slugs` (grep deve retornar zero em `backend/app`).

### 7c — Schema: destrutivo (bloco v7 em `main.py`, após 7b validado)
```sql
-- remover a linha fantasma do Escritório (já sem usuários vinculados desde a Fase 2)
DELETE FROM associations WHERE slug='escritorio' AND is_office = TRUE;

-- empresa_id obrigatório (todas as associations reais já têm empresa_id após Fase 2)
ALTER TABLE associations ALTER COLUMN empresa_id SET NOT NULL;

-- dropar colunas obsoletas
ALTER TABLE associations DROP COLUMN IF EXISTS is_office;
ALTER TABLE associations DROP COLUMN IF EXISTS linked_association_slugs;
ALTER TABLE associations DROP COLUMN IF EXISTS inventory_day_of_month; -- só se a Fase 8 mover p/ empresa
```
Bump `_SCHEMA_VERSION` → 7; documentar em `database/migrations/029_remove_office_model.sql`.

**Guard de segurança antes do `SET NOT NULL`:** o bloco deve primeiro checar `SELECT COUNT(*) FROM associations WHERE empresa_id IS NULL AND is_active` e abortar (sem marcar a versão) se houver alguma — evita quebrar em ambiente onde o backfill não rodou.

**Arquivos tocados:** os 6 acima + `main.py` (bloco v7) + `database/migrations/029_*.sql`.

**Critério de pronto:** grep zero de `is_office`/`linked_association_slugs`/`_empresa_col_exists` em `backend/`; `associations.empresa_id` NOT NULL; produção estável; login/refresh/switch/consolidado OK.

**Rollback:** 7a e 7b são reversíveis via redeploy do commit anterior. 7c é destrutivo — **antes de rodar**, `pg_dump` das colunas `is_office`, `linked_association_slugs`, `inventory_day_of_month` e da linha Escritório. Recuperação: readicionar colunas (`ADD COLUMN ... DEFAULT`), reinserir a linha e reverter o código para o commit pré-7a. Por isso 7c só depois de 7b validado por dias.

---

## FASE 8 — Ajuste do inventário do Escritório para nível empresa

**Objetivo:** adaptar a spec `2026-05-03-escritorio-design.md`, que hoje ancora o inventário financeiro em `is_office`/`inventory_day_of_month` na `associations` e numa linha Escritório — tudo removido na Fase 7.

**O que quebra (mapeado):**
- `inventory_records.association_id` "sempre o Escritório" — a linha Escritório deixa de existir. **Precisa reancorar em `empresa_id`.**
- Criação automática (job diário) usa `associations.inventory_day_of_month` do Escritório → mover para `empresas` (novo campo `inventory_day_of_month`) ou para `association_settings` agregado a nível empresa.
- `expected_total` = soma dos saldos de Vaz Lobo + Congonha → passa a ser soma das associações `WHERE empresa_id = X` (naturalmente correto no modelo novo).
- `OfficeReadOnlyGuard` e o JWT `is_office/is_aggregator` — substituídos por escopo `admin_master` + `empresa_id` (Seção 4 da spec nova: operações admin migram para o ESC quando `financeiro_centralizado=true`).
- Painel `/geral` / `SyncPanelService` — reancorar em `empresa_id` em vez de `linked_association_ids`.

**Ajuste mínimo proposto (a detalhar quando esta fase for abordada):**
1. Migration aditiva: `inventory_records.empresa_id UUID REFERENCES empresas(id)` (nullable), backfill a partir da `empresa_id` da associação Escritório antes do drop (fazer isto **antes** da Fase 7c), depois tornar obrigatório e afrouxar `association_id`.
2. `empresas.inventory_day_of_month SMALLINT` (mover config do dia para a empresa).
3. Reescrever `InventoryService`/job para operar por `empresa_id` e `financeiro_centralizado`.
4. Atualizar a spec `2026-05-03-escritorio-design.md` documentando a reancoragem (Seções 1, 2 e 3).

**Nota de ordenação:** o backfill de `inventory_records.empresa_id` precisa acontecer **antes** de dropar a linha Escritório em 7c. Se houver registros de inventário reais em produção, incluir esse backfill na Fase 2/7 conforme a data real dos dados. Se ainda não houver `inventory_records` em produção, a Fase 8 pode ser um projeto sequente limpo.

**Critério de pronto:** inventário abre/conclui/cancela ancorado em empresa; job cria draft mensal por empresa; spec atualizada.

**Rollback:** aditivo primeiro (colunas nullable) → reversível como as demais fases.

**⚠️ Revisitar à luz da Fase 9:** esta fase foi desenhada em 2026-07-15, antes de decidir que o ESC vira uma linha real em `associations` (Fase 9). Se isso for implementado primeiro, o inventário pode simplesmente reancorar em `association_id` = linha ESC (reaproveitando código que já existe pra associação normal) em vez de precisar de um caminho `empresa_id` paralelo. Avaliar quando esta fase for abordada — pode ficar mais simples do que o desenho original acima.

---

## FASE 9 — ESC como associação real (login por estação, não por cargo)

**Spec-fonte:** `docs/superpowers/specs/2026-07-17-esc-associacao-login-design.md`
**Status:** aprovado, não implementado. **Bloqueante** — nenhuma tela do ESC (Fase 10/11 abaixo) fica visível em produção pra usuário real até esta fase subir, porque `isEsc()` no frontend depende de `association_id == empresa_id`, e essa igualdade só existe depois desta fase.

**Objetivo:** ESC deixa de ser um estado implícito (`association_id = NULL` em admin_master) e vira uma linha física em `associations`, com `id = empresa_id` (sem coluna nova — a própria igualdade identifica). Login passa a respeitar a última unidade usada (`last_association_id`), não ordem alfabética. Escopo amplo passa a ser por **estação** (`association_id == empresa_id`), não por cargo hardcoded — libera `conselho`/`diretoria` no ESC sem precisar virar `admin_master`.

**Onde implementar:**
- Migration aditiva: seed da linha ESC por empresa (SAPE agora, `empresa_service.py` para toda empresa nova) + `users.last_association_id UUID REFERENCES associations(id)`.
- `auth_service.py`: trocar `is_empresa_wide = role in (...)` por `association_id == empresa_id`; usar `last_association_id` como primário quando válido.
- `routers/auth.py` `switch_association`: aceitar destino por escopo de empresa (hoje só aceita `user_association_roles` explícito); gravar `last_association_id` após troca.
- Remapeamento de usuário real (Erick/Felipe/Gabriela/Gabriella/Célia/Raphael/Vinícius/Carla → ESC; Danielly → Congonha; desativar usuários de teste) — dado, não schema, ver spec Seção 3.

**Arquivos tocados:** `backend/app/main.py` (migration), `backend/app/services/auth_service.py`, `backend/app/routers/auth.py`, `backend/app/core/tenant.py`, `backend/app/services/empresa_service.py`.

**Critério de pronto:** ver Seção 5 do spec-fonte.

**Rollback:** aditivo (linha nova + coluna nova); reverter lógica de `is_empresa_wide` é só código, reversível via redeploy.

---

## FASE 10 — Catálogo de Produtos

**Spec-fonte:** `docs/superpowers/specs/2026-07-16-catalogo-produtos-esc-design.md`
**Status:** aprovado, não implementado. **Independente da Fase 9** — schema e endpoints não dependem de ESC ser linha real, só de `empresa_id` (já existe desde a Fase 1/8a). Pode ser implementada em paralelo.

**Objetivo:** unifica mensalidade, taxa de entrega e comprovante de residência (hoje 3 mecanismos de preço espalhados, nenhum "produto" de verdade) num cadastro só (`products`), gerido pelo ESC. Corrige de quebra um gap de segurança (preço do comprovante hoje vem do frontend sem validação).

**Onde implementar:** migration aditiva (`products`, `product_associations`, `product_stock_movements`, `mensalidades.product_id`, `transactions.product_id` — ver spec Seção 3). Wiring dos services (`mensalidade_service.py`, `package_service.py`, `finance_service.py`) fica pra sub-etapa posterior dentro desta fase (ver Seção 4 do spec — consumidores mapeados).

**Arquivos tocados:** `backend/app/main.py` (migration), `backend/app/services/{mensalidade_service,package_service,finance_service}.py`, `backend/app/routers/{mensalidades,admin,finance}.py` (wiring, sub-etapa).

**Critério de pronto:** ver Seção 6 do spec-fonte.

**Rollback:** 100% aditivo, tabelas novas inertes até o wiring ligar os pontos.

---

## FASE 11 — Centralização Administrativa no ESC

**Spec-fonte:** `docs/superpowers/specs/2026-07-18-centralizacao-administrativa-esc-design.md`
**Status:** aprovado, não implementado. **Backend independente da Fase 9** (endpoints já rodam contra `require_empresa_admin`, testados localmente); **frontend depende da Fase 9** (as 7 telas do ESC só ficam visíveis em produção depois que `isEsc()` for real).

**Objetivo:** 5 itens que hoje vivem por associação e deveriam viver por empresa — categoria de transação + forma de pagamento (pré-requisito pro financeiro centralizado, senão o DRE consolidado sai com categoria inconsistente entre unidades), gestão de usuário (criar/editar/desativar no ESC, não mais preso a 1 associação), permissões/grupos de acesso (template único da empresa — fecha a Fase 8d que estava pendente de design), auditoria centralizada, central de avisos (broadcast).

**Onde implementar:** migration aditiva (5 colunas `empresa_id` novas — ver spec Seções 2-6). Endpoints novos em `backend/app/routers/esc.py` (router já criado e testado localmente nesta sessão, com 15 endpoints de leitura — falta os de escrita desta fase: criar/editar usuário, editar permissão, criar aviso).

**Arquivos tocados:** `backend/app/main.py` (migration), `backend/app/routers/esc.py` (já existe, expandir), `frontend/src/pages/esc/*` (já existe local, expandir com formulários).

**Critério de pronto:** ver Seção 8 do spec-fonte.

**Rollback:** 100% aditivo.

---

## Gaps identificados (revisão de 2026-07-18)

1. **Financeiro centralizado de verdade ainda não tem spec.** Todas as 3 fases novas (9, 10, 11) mencionam "financeiro centralizado" como motivação ou dependência, mas nenhuma desenha COMO o DRE consolidado, fluxo de caixa e relatórios vão funcionar de fato — isso ficou explicitamente fora de escopo em todas. **É a maior peça faltante agora.**
2. **Migração de dado legado** de `transaction_categories`/`payment_methods`/`role_permissions` (hoje por associação) pro modelo novo (por empresa) — decidido ficar pra quando o financeiro centralizado for implementado (item 1), mas ninguém desenhou o COMO ainda (reconciliar nomes duplicados/divergentes entre Vaz Lobo e Congonha, por exemplo).
3. **Ambiente de teste local** (Postgres local + backend porta 9001 + dump restaurado) foi montado ad hoc nesta sessão, sem documentação permanente — vale um `docs/dev-setup-local.md` se for reaproveitado com frequência.
4. **Mock de frontend (`?mockesc=1`) e `vite.config.ts` com `VITE_BACKEND_PORT`** são temporários — precisam ser removidos/revertidos quando a Fase 9 subir de verdade (`isEsc()` deixa de precisar de mock).
5. **Fase 8 (inventário) precisa reavaliação** à luz da Fase 9 — provável simplificação, não desenhado ainda (nota já adicionada acima).

---

## Resumo de sequenciamento e dependências

| Fase | Tipo | Depende de | Deploy | Destrutivo? |
|---|---|---|---|---|
| 1 | Schema aditivo | — | migration v5 | Não |
| 2 | Data migration | 1 | migration v6 | Reversível |
| 3 | Backend services/models | 1 | código | Não |
| 4 | Backend endpoints | 2,3 | código | Não (soft-delete testado) |
| 5 | Frontend | 4 | código | Não |
| 6 | Validação produção | 2,4,5 | nenhum | Não |
| 7a | Remoção código is_office | 6 | código | Reversível |
| 7b | Verificação | 7a | — | — |
| 7c | Remoção schema | 7b (+ backfill Fase 8 se houver inventário) | migration v7 | **Sim** |
| 8 | Inventário → empresa | 1; revisitar à luz da 9 | migration + código | Aditivo primeiro |
| 8e | Fix acesso empresa-wide | 1,3 | código | Não — **NO AR** |
| 9 | ESC como associação real | 1,8e | migration + código | Não — **bloqueante da 10/11 em produção** |
| 10 | Catálogo de Produtos | 1 | migration + código | Não — independente, paralelo à 9 |
| 11 | Centralização Administrativa | 1,8e; frontend depende de 9 | migration + código | Não — backend independente, frontend depende da 9 |

**Regra de ouro reforçada:** nenhuma migration destrutiva (7c) roda antes que o código que dependia do estado antigo tenha saído de produção **e** sido observado estável (Fase 6 + 7b). Cada bloco de schema é aditivo no deploy que o introduz.

---

### Arquivos críticos para a implementação
- `backend/app/main.py` (função `_run_migrations`, `_SCHEMA_VERSION` — onde toda migration realmente roda)
- `backend/app/core/tenant.py` (guards e `CurrentUser` a reaproveitar/limpar)
- `backend/app/services/auth_service.py` e `backend/app/routers/auth.py` (hook `_empresa_col_exists` + emissão de token a migrar; Fase 9 mexe de novo aqui)
- `backend/app/core/security.py` (claims JWT `empresa_id`/`is_office`)
- `backend/app/routers/governanca.py` + `backend/app/services/empresa_service.py` + `backend/app/services/association_provisioning_service.py` (provisionamento — Fase 9 adiciona seed da linha ESC aqui)
- `backend/app/routers/esc.py` (criado na Fase 11, 15 endpoints de leitura já testados localmente; escrita ainda falta)
- `frontend/src/pages/esc/*`, `frontend/src/components/layout/AppShell.tsx`, `frontend/src/store/authStore.ts` (casca do ESC — 7 módulos, `isEsc()` — local, não commitado)
