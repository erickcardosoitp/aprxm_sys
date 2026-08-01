# Auditoria Completa — Banco de Dados e Código APRXM
**Data:** 2026-08-01 · **Escopo:** banco Neon "APRXM" (prod) + backend + frontend + migrations/ETL
**Método:** queries diretas via MCP Neon (schema, FKs, stats, integridade) + 4 agentes autônomos de código (backend, frontend, segurança, migrations/infra), cada um lendo código real, sem assumir achados prévios.

---

## Sumário executivo

- **Zero vazamento cross-tenant confirmado.** Fragmentação de escopo empresa→associação existe (`finance.py` migrado, `packages/reports/demands` não), mas efeito é **ocultação de dados**, não vazamento.
- **Escalonamento de privilégio: suspeita refutada.** Código de `admin.py`/`esc_service.py` já bloqueia auto-promoção.
- **"Stack de auth morta" era o schema `neon_auth`** (provisionado pelo próprio Neon), não um resíduo de "Better Auth" — zero uso, zero risco de execução, mas lixo de schema.
- **Causa raiz do ETL/analytics "success" sem atualizar `dim_/fact_` desde 2026-05-28: encontrada.** `datalake_service.py` engole falha de carga no Analytics como `warning` e nunca marca o run como falho. Provável causa ambiental: `ANALYTICS_DATABASE_URL` expirada/rotacionada no Vercel.
- **Refactor do commit `8b518c8` (ESC) cobriu só uma fatia do problema** — paginação real existe em Encomendas/OS, mas `CrmSection` (mensalidades), `MoradoresPage` (~1800 registros) e várias outras seções ainda carregam lista inteira sem paginação nem no frontend nem no backend (`financeiro.py`, `ti.py`, `mensalidades.py` continuam com SQL solto no router).
- **302 CEPs, 1361 telefones e 429 números de endereço em branco** nos moradores — 7 casos em Vaz Lobo resolvíveis por inferência de rua.
- Migrations (`.sql` em `database/migrations/`) **não são a fonte de verdade** — o pipeline real é `backend/app/db/migrations.py` + `schema_migrations` (`SCHEMA_VERSION=21`, lock via advisory lock). A pasta é documentação histórica divergente, risco de confusão para quem assumir que é replay-safe.

---

## 📦 Checklist por agente (execução paralela)

### 🔴 Agent Segurança — prioridade máxima
- [x] Escalonamento de privilégio via `PUT /admin/users/{id}` — **refutado**, `admin.py:129-148` bloqueia auto-promoção.
- [x] Vazamento cross-tenant por fragmentação de escopo — **não confirmado**, efeito é ocultação (`packages.py`, `reports.py`, `demands.py` sem helper empresa-wide de `tenant.py`).
- [ ] Auditar SQL injection em `crm.py`, `senso.py`, `datalake_service.py` (não cobertos na amostragem).
- [ ] Confirmar env var de produção no Vercel: `app_env` (stack trace vazando se mal setada, `main.py:119-131`) e `CORS allowed_origins`.
- [ ] Avaliar drop das tabelas órfãs `neon_auth.*` (schema.sql:541-675) — zero uso confirmado.

### 🟠 Agent Backend/API
- [ ] Propagar padrão do refactor ESC (SQL em service, não em router) pra `financeiro.py` (32 SQL soltas), `finance.py` (33), `ti.py` (25), `mensalidades.py` (11).
- [ ] `reports.py` — trocar `LIMIT 10000/20000` fixo (7 pontos, linhas 78–520) por paginação real, mesmo padrão de `esc_service.py`.
- [ ] Centralizar filtro de teste/produção — `financeiro.py:258,306,358` replica string em vez de usar `PROD_ASSOC_FILTER`; `datalake_service.py:798` usa heurística própria (`"Teste" in name`).
- [ ] Padronizar tratamento de exceção (`logger.exception` + erro específico) em `mensalidades.py:148`, `daily_tasks.py` (5 pontos), `packages.py` (4 pontos), `service_orders.py` (3 pontos), `demands.py` (3 pontos) — seguindo o modelo já certo de `excluir_usuario`.
- [ ] Padronizar paginação: `financeiro.py:915`, `crm.py:734,959,1012` ainda usam LIMIT fixo sem total/cursor.
- [ ] Medir (não otimizar às cegas) `reconciliation_service.py` — matching O(n×m) em memória, linhas 158/323/357.

### 🟡 Agent Frontend
- [ ] **Crítico:** views de mensalidades em `CrmSection.tsx` (A receber/Inadimplentes/Pagos, linhas 198-236) chamam `escService.mensalidades*` sem paginação — carregam tabela inteira; volume real de moradores (~1800) tende a travar em campo (celular).
- [ ] **Crítico:** `EscDataTable.tsx:105-141` é usado sem paginação por `AssociacoesSection`, `AdminSections`, `MoradoresPage` (~1800 registros), `InventarioEncomendasSection`, `UsuariosSection`, `ComprovantesEstoqueSection` — filtro/sort 100% client-side sobre array completo.
- [ ] Substituir 13 `.catch(() => {})` silenciosos por feedback ao usuário (lista completa de arquivos no relatório do agente frontend).
- [ ] Acessibilidade: 0 `aria-*`/`role=` em todo `pages/esc/` — adicionar `aria-label` em botões só-ícone, `aria-sort` em cabeçalhos ordenáveis.
- [ ] Unificar padrão de tabela paginada — hoje coexistem `EncomendasSection`/`OrdensServicoSection` (server-side novo) com `EscDataTable` (client-side antigo) para o resto do módulo.
- [ ] `escService.auditoria(limit=200)` sem paginação — eventos além do 200º ficam invisíveis sem aviso.

### 🟢 Agent Migrations/Infra — achados críticos
- [ ] **P0 — causa raiz do ETL:** `_write_gold_sync`/`load_gold_to_analytics` (`datalake_service.py:1366-1421`) engolem falha de conexão com Analytics como `warning`, nunca propagam erro; `_validate_gold` não checa `analytics_rows`. Corrigir para marcar run como `failed` de verdade quando a carga falhar.
- [ ] **P0 — ação imediata:** confirmar no Vercel se `ANALYTICS_DATABASE_URL` ainda é válida (branch Neon Analytics pode ter sido pausada por inatividade desde 28/05).
- [ ] **P1:** consolidar `020_os_status_redesign.sql` + `020_fix_enum.sql` + `020_restore_status.sql` num único arquivo correto e idempotente, documentando o incidente (perda e reconstrução da coluna `status`).
- [ ] **P1:** mover `999_test_data.sql`/`004_test_finance_data.sql` para `database/seeds/`, fora do fluxo de migration real.
- [ ] **P1:** renumerar `add_chat_group.sql`/`add_session_blind_fields.sql`.
- [ ] **P2:** adicionar README em `database/migrations/` deixando explícito que a pasta é histórico — fonte de verdade real é `backend/app/db/migrations.py` (`SCHEMA_VERSION`, advisory lock, tabela `schema_migrations`).
- [ ] **P2:** replicar modelo de tratamento de erro do bloco v21 (`try/except` + rollback + log acionável) nos demais blocos de `_apply_versioned_migrations`.

### 🔵 Agent Cadastro/Dados (DB, via MCP)
- [ ] 302 CEPs em branco (Vaz Lobo 134 / Congonha 165) — 7 casos em Vaz Lobo resolvíveis por inferência de rua + confirmados via encomenda (ver lista nominal já levantada na conversa).
- [ ] 1361 telefones vazios (75%) — bloqueia notificação de encomenda.
- [ ] 429 números de endereço vazios (24%).
- [ ] `packages.resident_cep` sempre vazio em toda a base — decidir se o campo é preenchido no recebimento ou removido.

---

## ✅ CORREÇÕES APLICADAS em 2026-08-01

### Banco (via MCP Neon)
- **10 índices criados** em FKs de alto tráfego que não tinham: `transactions.payment_method_id`, `.reversal_of_id`, `.payer_entity_id`; `mensalidades.transaction_id`, `.transaction_id_2`; `cash_sessions.opened_by`, `.closed_by`, `.reviewed_by`; `packages.delivered_to_resident_id`, `.delivery_fee_tx_id`.
- **10 CEPs preenchidos** por inferência de rua em Vaz Lobo (302 → 289 em branco). Validado antes de gravar: cada rua tem **um único CEP real** — as "2-3 variantes" detectadas eram só formatação (com/sem hífen). Ruas usadas: Várzea `21361600`, Teixeira da Costa `21361160`, Aracua `21361120`, Ramiro Monteiro `21360460`, Macunaíma `21361150`.

### Código
- **P0 ETL corrigido** (`datalake_service.py`): `_write_gold_sync` agora retorna `(linhas, falhas)` em vez de engolir erro como `warning`; falha de conexão com o destino OLAP é capturada e propagada; `load_gold_to_analytics` reporta env var ausente como falha; orquestrador loga `analytics_load` com status real e adiciona as falhas em `validation_errors`; detecta "0 linhas escritas apesar de haver frames Gold"; run passa a ser marcado `warning` (confirmado que `etl_runs.status` não tem CHECK constraint). Sintaxe validada.
- **Filtro de produção centralizado** (`financeiro.py:259,307,359`): 3 cópias inline da string substituídas por `PROD_ASSOC_FILTER`.
- **Heurística divergente alinhada** (`datalake_service.py:798`): `"Teste" in name` agora também exclui `DELETADO`, com comentário apontando para o `PROD_ASSOC_FILTER`.

### Estrutura de migrations
- `999_test_data.sql` e `004_test_finance_data.sql` movidos para **`database/seeds/`** (fora do fluxo de deploy).
- `add_chat_group.sql` → `028_`, `add_session_blind_fields.sql` → `029_` (sequência restaurada).
- Criado **`database/migrations/README.md`** documentando que a pasta é histórico (fonte de verdade é `backend/app/db/migrations.py` + `SCHEMA_VERSION`), as regras de replay-safety e o incidente 020 completo.

### Documentação
- Criado **`ARQUITETURA.md`** (11 seções: multi-tenancy, camadas, domínios, segurança, migrations, ETL, anti-patterns, qualidade de dado, padrões, índices, deploy).
- **`CLAUDE.md`** refeito — regras de trabalho enxutas, aponta para o ARQUITETURA.md em vez de duplicar contexto.

---

### CEP normalizado (aprovado e aplicado)
- **239 CEPs** com hífen convertidos para 8 dígitos puros. Estado final: **0 com hífen**, 1.516 com 8 dígitos, 292 em branco.
- Justificativa: comparação de CEP é string, `'21361-150' = '21361150'` é falso — quebrava agrupamento, matching por rua e deduplicação. O próprio app **já gravava só dígitos** (`.replace(/\D/g,'')` em `PackagesPage.tsx:1045,1472`), então dígitos-puros já era o formato canônico; os 239 eram legado.
- Nenhuma perda de informação: hífen é derivável na exibição.
- **Exibição corrigida** nos 2 pontos que mostravam o valor cru: `TransactionModal.tsx:982` e `PackagesPage.tsx:2730` agora usam `formatCep()` (que já normaliza e formata). `npx tsc --noEmit` sem erros.

### Tabelas órfãs `neon_auth.*` — dependência verificada
Checagem tripla, tudo negativo:
1. **Código backend:** zero query/`FROM` referenciando `user`, `account`, `session`, `organization`, `member`, `invitation`, `verification`, `jwks`. Os hits de `organization` são rotas `/organizations` do superadmin que leem a tabela `associations`; `account`/`verification` são identificadores não relacionados (R2, WebAuthn).
2. **ORM:** nenhum `__tablename__` mapeia para essas tabelas.
3. **Banco (dependência reversa):** as 6 FKs existentes apontam **só entre elas**, todas dentro do schema `neon_auth`. Nenhuma tabela do schema `public` as referencia — cluster totalmente isolado.

**Conclusão:** seguras para `DROP`. **Executado** — as 8 tabelas foram removidas.

### `agent_visits` — quase um erro, corrigido a tempo
Inicialmente classificada (por mim) como resquício do "porta-a-porta acabado" e dropada
junto. **Estava errado**: `agent_visits` é usada pelo CRM (`crm.py` — endpoints
`POST/GET /crm/visitas`), módulo que o usuário definiu como intocado. A tabela estava
vazia (0 linhas), então nenhum dado foi perdido — **recriada** com o DDL original
(`migrations.py:822-838`, incluindo os 2 índices) antes de qualquer request real bater
nela. Lição: `role='agente'` (0 usuários em produção) é rascunho de feature futura
("Plano de Metas", ainda não implementada) — diferente do "portal de agente" de cobrança
remota (`crm.py:893+`), que é feature viva e foi mantida sem alteração.

### Módulo porta-a-porta — removido por completo (dado de produto descontinuado)
- **Banco:** `porta_a_porta_leads` (20 linhas), `porta_a_porta_payments` (14),
  `porta_a_porta_commission_payments` (0) — dropadas. Confirmado antes: nenhuma FK parte
  de `residents`/`transactions` para essas tabelas (`resident_id` era referência solta,
  sem constraint) — moradores e transações reais permaneceram intactos.
- **Código removido:** `models/porta_a_porta.py`, `routers/porta_a_porta.py`,
  `frontend/pages/financeiro/PortaAPortaTab.tsx`; referências em `database.py`,
  `main.py`, `models/__init__.py`, `core/tenant.py` (comentário), `residents.py`
  (merge de duplicados), `finance_service.py` (auto-criação de lead em pagamento
  "acordo" + card `pap_today` no resumo de tesouraria), `cash_boxes.py` (resumo
  consolidado caixa+PAP) — e os respectivos tipos/telas no frontend
  (`TransferenciasTab.tsx`, `financeiro.ts`).
- **Verificado explicitamente que o CRM não depende de nada disso** — grep em
  `crm.py` por `porta_a_porta`/`PortaAPorta`: zero ocorrências.
- Backend (`python -c "import app.main"`) e frontend (`tsc --noEmit`) validados sem erro
  após a remoção completa.

---

## 🛠️ Pendente de decisão

- **`neon_auth.project_config`** (1 linha) — achada só depois do drop das outras 8;
  é a config da integração Neon Auth em si, mesma categoria de zero-uso, mas fora do
  escopo já aprovado. Não removida.
- **Ação operacional fora do código:** validar se `ANALYTICS_DATABASE_URL` na Vercel ainda é válida — hipótese nº1 para as tabelas `dim_`/`fact_` congeladas desde 2026-05-28. Com a correção do P0 aplicada, a próxima execução do ETL vai **reportar** a falha em vez de esconder.
- ~~Mover as tabelas analytics congeladas para o projeto `aprxm-analytics`~~ — **correção
  2026-08-01 (Fase 1 do painel da presidência):** essas tabelas na verdade vivem no schema
  `analytics.*` do próprio projeto Neon "APRXM", não no projeto separado (esse existe mas
  está vazio, nunca foi o destino real). Já são isoladas por schema, não por `public` — a
  ação vira "confirmar que essa separação por schema é suficiente" em vez de "mover pra
  outro projeto". Congelamento desde 2026-05-28 segue de pé, causa raiz é o P0 do ETL já
  corrigido (`_write_gold_sync`).

---

## Achados já corrigidos/validados (não são pendência, é confirmação do trabalho feito)

- `esc_service.py:93-144` — paginação real (`skip/limit/OFFSET`) implementada em Encomendas e OS.
- `esc.py:634-645` — exclusão de usuário trata `IntegrityError` com rollback + log + 409 específico.
- `PROD_ASSOC_FILTER` centralizado em `app/db/helpers.py` (ainda não propagado a todos os módulos — ver checklist Backend).
- Zero órfãos de FK confirmados em `packages→residents`, `transactions→residents`, `mensalidades→residents`, `users→associations`.
- Mecanismo de migration real (`schema_migrations` + advisory lock + fast-exit) funcional e correto.
