# Design — Governança de Criação e Gestão de Associações (EMPRESA / ESC)

**Data:** 2026-07-15
**Status:** Aprovado
**Autor:** erickxc

---

## Contexto

Hoje não existe fluxo de criação de associação — a única inserção na tabela `associations` acontece via migration manual (`database/migrations/014_escritorio_data.sql`). O ambiente "Escritório" (visão agregada de Vaz Lobo + Congonha) é modelado como uma linha `is_office=true` em `associations`, vinculada às demais via `linked_association_slugs` (array solto, sem FK). O código já tem hooks para um nível de empresa (`empresa_id` no JWT, checagem dinâmica de coluna em `auth.py`), mas a coluna/tabela nunca foi criada.

Esta mudança formaliza um nível real de EMPRESA acima das associações, com um ambiente de governança para criar e gerir empresas/associações via interface no-code, e regras de RBAC e financeiro centralizado.

Fora de escopo: aplicativo offline (APK/EXE) e painel de sincronização local — tratado como projeto futuro independente.

---

## Seção 1 — Modelo de Dados

### Nova tabela `empresas`

```sql
id                      UUID PRIMARY KEY
name                    VARCHAR(255) NOT NULL
slug                    VARCHAR(100) UNIQUE NOT NULL
financeiro_centralizado BOOLEAN NOT NULL DEFAULT FALSE
plan_name               VARCHAR(50) NOT NULL DEFAULT 'basic'
is_active               BOOLEAN NOT NULL DEFAULT TRUE
created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
```

### `associations` — nova coluna real

```sql
empresa_id UUID NOT NULL FK → empresas
```

Substitui o hook dinâmico atual (`_empresa_col_exists` em `auth.py`) por uma coluna real e obrigatória.

### ESC não é uma linha em `associations`

O ambiente "Escritório" deixa de existir como tenant fictício (`is_office=true`). Passa a ser um **escopo de acesso**: usuários `admin_master`/`superadmin` enxergam a visão consolidada computada por `WHERE empresa_id = X` sobre as associações reais, sem necessidade de uma linha extra.

Consequência: `is_office`, `inventory_day_of_month` (a nível de association) e `linked_association_slugs` ficam obsoletos e são removidos após a migração dos dados (Seção 5). O conceito de inventário do Escritório (spec `2026-05-03-escritorio-design.md`) precisa ser adaptado para operar em nível de empresa — ajuste tratado como tarefa própria no plano de implementação, não redesenhado aqui.

### Tabela nova `provisioning_runs`

```sql
id            UUID PRIMARY KEY
empresa_id    UUID FK → empresas (nullable até a empresa ser criada com sucesso)
run_type      ENUM('create_empresa', 'create_associacao')
status        ENUM('running', 'success', 'failed')
payload       JSONB NOT NULL        -- dados de entrada do form
steps         JSONB NOT NULL DEFAULT '[]'  -- log incremental de cada etapa do script
error_detail  TEXT
started_by    UUID NOT NULL FK → users
started_at    TIMESTAMPTZ NOT NULL DEFAULT now()
finished_at   TIMESTAMPTZ
```

Permite depurar e potencialmente reprocessar uma criação que falhou no meio do script.

---

## Seção 2 — RBAC

O enum `user_role` já reserva `superadmin` e `admin_master` — não existiam guards ativos usando esses papéis, mas `backend/app/core/tenant.py` já tem o esqueleto pronto (`require_platform_admin`, `require_empresa_admin`, `assert_same_empresa`, `is_platform_admin`, `is_empresa_admin`), nunca plugado em nenhum router. Este projeto conecta esse esqueleto em vez de recriar do zero.

Três níveis:

| Nível | Escopo | Observação |
|---|---|---|
| `superadmin` | Toda a plataforma, cross-empresa | Bootstrap-only — só um superadmin existente pode criar outro (`require_platform_admin`). Sem fluxo de auto-criação/self-service. |
| `admin_master` | Toda associação da empresa (`empresa_id`) | Opera tudo — gerencia usuários, cria associações, financeiro consolidado. Guard `require_empresa_admin` já existe. |
| Roles atuais (`admin`, `conferente`, `diretoria`, `conselho`, etc.) | 1 associação | Sem mudança de comportamento |

### `users.association_id` deixa de ser sempre obrigatório

Hoje é `NOT NULL`. Usuários `admin_master`/`superadmin` não ficam presos a 1 associação — acesso vem de `empresa_id` + `role`, não de `association_id`. Migration: `ALTER TABLE users ALTER COLUMN association_id DROP NOT NULL`, com constraint de aplicação (não de banco): `association_id` obrigatório apenas quando `role` não é `superadmin`/`admin_master`.

### `role_permissions` e `audit_log` ganham `empresa_id`

Hoje ambas têm `association_id NOT NULL` — não existe onde registrar permissão ou ação em nível de empresa (ex: `admin_master` configurando algo cross-associação). Migration: `association_id` vira nullable nas duas tabelas, adiciona `empresa_id UUID FK → empresas` (nullable). Uma linha é ou escopada a 1 associação, ou a 1 empresa — nunca as duas.

Criação/exclusão de usuário em cascata: desativar uma associação faz **soft delete em cascata** — `is_active=false` na associação e em todo usuário local vinculado só a ela (usuários `admin_master`/`superadmin`, sem `association_id`, não são afetados).

---

## Seção 3 — Provisionamento No-Code

### Form 1 — Criar Empresa

Campos: nome da empresa, slug, admin inicial (nome, sobrenome, email, cargo — texto livre, sem afetar permissão), `financeiro_centralizado` (toggle, default off). Admin criado com `role=admin_master`, `association_id=NULL` (ver Seção 2).

Senha do admin: gerada pelo sistema, armazenada com hash (`passlib[bcrypt]`, mesmo padrão já usado), **enviada por email** via `email_service.py` existente. Sem exibição em tela.

### Form 2 — Criar Associação (dentro da empresa)

Campos base (`associations`) **+ campos essenciais de `association_settings` direto no wizard**: nome da comunidade, valor padrão de mensalidade, dia de vencimento, saldo inicial de caixa, dia de inventário, nome do presidente. A associação nasce configurada, não apenas com defaults genéricos.

Campos de `association_settings` sem UI dedicada no form (`access_groups`, `cadastros`) mantêm os defaults já existentes no banco (`'{}'::jsonb`) — não bloqueiam a criação.

Itens secundários (logo, assinatura do presidente, ajustes finos) ficam num **checklist complementar** exibido no primeiro acesso do admin da associação — não bloqueiam a criação.

### O que o script cria (por associação)

- Linha em `associations` (com `empresa_id`) + `association_settings` preenchido com os campos do form 2
- `transaction_categories` e `payment_methods` padrão
- `cash_box` inicial
- Admin da associação (mesmo fluxo de senha gerada + email do Form 1)
- Registro em `provisioning_runs` com passo a passo da execução

---

## Seção 4 — Financeiro Centralizado (flag `empresas.financeiro_centralizado`)

| Estado | Comportamento |
|---|---|
| **Ligada** | Cada associação mantém seu próprio caixa/sessão — lançamento não muda de lugar. Saldo é agregado e exibido no ESC. Operações do módulo admin — zerar saldo, configuração de usuários, emissão de comprovante de residência — passam a ser geridas a partir do ESC (nível empresa), não mais por associação. |
| **Desligada** | Cada associação opera 100% isolada, sem agregação de saldo nem migração de operações admin. |

---

## Seção 5 — Migração dos Dados Existentes

Nova migration:

1. Cria empresa real `SAPE-VAZLOBO_BURITI-CONGONHA`
2. Seta `associations.empresa_id` para Vaz Lobo e Congonha apontando pra essa empresa
3. Usuários hoje vinculados à linha `is_office=true` (Escritório) migram para role `admin_master` na empresa nova, com `association_id = NULL`
4. Remove a linha `is_office=true` de `associations` e a coluna `linked_association_slugs`
5. Preserva histórico: nenhuma transação, morador ou dado operacional de Vaz Lobo/Congonha é tocado — só o nível de agregação muda

---

## Dependências Técnicas

- Migration: tabela `empresas`
- Migration: `associations.empresa_id` (FK NOT NULL)
- Migration: `users.association_id` — `DROP NOT NULL`
- Migration: `role_permissions` e `audit_log` — `association_id` vira nullable, adiciona `empresa_id` (nullable) FK
- Migration: tabela `provisioning_runs`
- Migration: dados — criar empresa real, migrar Vaz Lobo/Congonha/usuários do Escritório, remover `is_office`/`linked_association_slugs`
- Backend: limpeza de `is_office` nos 6 pontos que hoje o referenciam (`auth.py`, `auth_service.py`, `tenant.py`, `security.py`, `geral.py`, `association.py`)
- Backend: `EmpresaService` (criar empresa + admin_master + provisionamento)
- Backend: `AssociationProvisioningService` (criar associação + settings + defaults financeiros + admin)
- Backend: conectar guards já existentes e não utilizados em `tenant.py` (`require_platform_admin`, `require_empresa_admin`, `assert_same_empresa`) aos novos endpoints, em vez de criar guards novos
- Backend: reuso de `email_service.py` para envio de senha gerada
- Frontend: wizard "Criar Empresa" (form 1)
- Frontend: wizard "Criar Associação" (form 2, com campos de `association_settings`)
- Frontend: checklist de configuração complementar no primeiro acesso
- Frontend: tela de acompanhamento de `provisioning_runs` (status/erros de execução)
