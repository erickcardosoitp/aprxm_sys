# Checklist consolidado — pendências reais do projeto (2026-09-15)

Substitui todos os checklists/planos anteriores dispersos (migração,
ESC, segurança, governança M365, specs de design). Cada item abaixo foi
**reverificado no código atual** antes de entrar aqui — muita coisa dos
documentos antigos já tinha sido corrigida sem nunca ser marcada como
tal. Os documentos antigos foram removidos deste diretório (histórico
continua no `git log`, nada foi perdido).

Status: `🔴` crítico, `🟠` alto, `🟡` médio, `🟢` decisão de escopo,
`✅` verificado resolvido nesta rodada de auditoria.

---

## 🔴 Crítico

- [x] **Categoria de Contas a Pagar não chega na DRE.** ✅ **Resolvido
  2026-09-15** (decisão do usuário: mapear `payable_category` →
  `transaction_category`, não deixar como estava). Migration v26 add
  `payable_categories.transaction_category_id` (vínculo opcional,
  `payable_categories` continua conceito próprio da v14, só ganhou
  ponte pra DRE). `baixar_conta_pagar` agora grava `category_id` real
  na transação quando o vínculo existe. Frontend: seletor de categoria
  de DRE (só tipo despesa) ao criar/editar categoria de Contas a Pagar,
  nome vinculado exibido na listagem. Deployado e migration confirmada
  aplicada em produção (`schema_migrations` versão 26).
- [x] **`erp_itp` sem Dependabot nem CodeQL configurados.** ✅
  **Resolvido 2026-09-15**: `.github/dependabot.yml` (npm/pip/docker/
  github-actions cobrindo `apps/backend`, `apps/frontend`, raiz,
  `catalogo-erros`, `catalogo-erros-viewer/{frontend,backend}`) e
  `.github/workflows/codeql.yml` (javascript-typescript + python, push/
  PR/semanal) criados e confirmados ativos via API do GitHub
  (`Dependabot Updates` e `CodeQL` como workflows `active`).

## 🟠 Alto

- [x] **Encomendas: 100% somente-leitura no ESC** — ✅ **Não é bug,
  confirmado com o usuário 2026-09-15.** `EncomendasSection.tsx` é uma
  tabela de leitura pura por design (sem botão criar/editar) —
  encomenda é recebida fisicamente na portaria/associação, não faz
  sentido criar/editar remotamente do Escritório. Diferente de Ordens
  de Serviço (que legitimamente podem ser abertas remotamente pra
  qualquer unidade) — o checklist antigo generalizou errado a partir do
  padrão de OS. Já tem paginação real e filtro de data
  (`skip`/`limit`, `date_from`/`date_to`) — isso nunca foi o problema.
- [x] **Associações: só editar, não criar** no ESC — ✅ **Não é bug,
  confirmado com o usuário 2026-09-15.** Criação de associação nova é
  intencionalmente restrita ao painel de superadmin da plataforma, não
  ao ESC — mesmo padrão de decisão do item de Encomendas acima.
- [x] **Administração → Estoque é cópia read-only e incompleta de
  Cadastros → Comprovantes de Residência** — ✅ **Resolvido
  2026-09-15**. Achado real: as 2 telas já renderizavam o mesmo
  componente editável (`ComprovantesEstoqueSection`) — o "read-only"
  do checklist antigo já estava desatualizado. Decisão do usuário:
  Estoque fica só em Administração; Cadastros fica só sobre o produto
  (preço, já coberto pela aba "Produtos"). Removida a aba duplicada de
  Cadastros + endpoint `GET /esc/administracao/estoque` e
  `escService.estoque()` mortos (nunca eram chamados de verdade).

## 🟡 Médio — qualidade de dado, tradução, UI

Reverificados individualmente em 2026-09-15 — a maioria já estava
corrigida (não marcada), só 2 itens reais precisaram de ação:

- [x] **Usuários: enum de cargo cru, campo `phone` sem input,
  `last_login_at` nunca exibido** — ✅ **Resolvido 2026-09-15**, os 3
  eram reais. `UsuariosSection.tsx`: mapa `ROLE_LABEL` (select +
  coluna + filtro, via novo `labelMap` opcional em `EscDataTable`),
  campo Telefone no formulário (backend já aceitava `phone`, só
  faltava a UI e o `SELECT` incluir a coluna), coluna "Último acesso"
  adicionada.
- [x] **Movimentações: filtro "Cargo"/coluna "Status Morador" crus** —
  ✅ **já estava corrigido** (`CARGO_LABEL`/`STATUS_MORADOR_LABEL` já
  usados no filtro e na coluna) — item do checklist antigo já
  desatualizado.
- [x] **DRE: `income_subtype` cru no fallback da descrição da linha**
  — ✅ **Resolvido 2026-09-15**, era real:
  `financeiro.py` (endpoint `/financeiro/dre`) tinha o `SUBTYPE_MAP`
  aplicado certo no *agrupamento* mas não no *fallback da descrição de
  cada linha* — corrigido pra usar `SUBTYPE_MAP.get(subtipo, subtipo)`.
- [x] **DRE: `sub_agrupar_por` "morto"** — ✅ **não é código morto**,
  claim antigo errado: já é usado de verdade no DRE de associação
  (`frontend/src/pages/financeiro/tabs/DRETab.tsx`). Só não existe (por
  enquanto) na versão agregada do ESC (`DRESection.tsx`) — gap de
  paridade de feature entre as 2 telas, não bug; não implementado
  agora (fora do escopo de "corrigir o que existe").
- [x] **Contas a Receber: "zero filtros", sem paginação** — ✅
  **claim parcialmente desatualizada**: já tem busca por morador +
  filtro de unidade, valores/competência já formatados pt-BR.
  Paginação de servidor genuinamente ainda não existe (carrega a lista
  toda), mas o dataset aqui é só "pendentes" (bem menor que o do CRM) —
  risco baixo, não mexido agora.
- [x] **Sangrias: valor sem formatação pt-BR, filtro de data ausente**
  — ✅ **já estava corrigido**: `fmt()` pt-BR e os 2 campos de data já
  existem na UI — item do checklist antigo já desatualizado.
- [x] **`EscInfraSection`: falha silenciosa** — ✅ **já estava
  corrigido**: já mostra mensagem de erro visível
  ("Erro ao carregar dados de infraestrutura...") — item do checklist
  antigo já desatualizado.
- [ ] Dado incompleto em produção (contagem de 2026-08-01, **não
  reconferida nesta rodada**): ~292 CEPs, ~1.361 telefones, ~429
  números de endereço de moradores em branco.

## 🔵 Backlog (não pendência, projeto planejado)

- [ ] **Automatizar deploy do backend (CI/CD real via GitHub Actions)**
  — hoje é 100% manual: SSH na VM, `git pull --ff-only`, `docker
  compose build`, `up -d --force-recreate`. Sem histórico visual (só
  `docker ps`/`docker logs` na VM). Ideia: workflow que builda e faz
  deploy via SSH a cada push no `main` (ou só em tag/PR aprovado),
  registrado no GitHub como os outros deploys (Vercel já é automático
  pro frontend). **Adicionado ao backlog 2026-09-15 a pedido do
  usuário — priorizar as pendências pequenas antes.**

## 🟢 Decisão de escopo — reverificado 2026-09-15

- [x] **Endpoint `GET /esc/administracao/permissoes` não usado** — ✅
  já não existe mais no código (removido em algum momento, claim
  obsoleta).
- [ ] **Detecção de forma de pagamento por `ILIKE '%pix%'`/`'%dinheiro%'`**
  no nome digitado — confirmado ainda real, presente em 6 arquivos
  (`financeiro.py`, `esc_service.py`, `finance_service.py`, `admin.py`,
  `finance.py`, `cash_boxes.py`). **Não é pendência pequena** — fix
  correto exigiria coluna `type` em `payment_methods` + atualizar os 6
  pontos. Registrado como risco conhecido, não uma tarefa de "fixar
  agora".
- [x] **Checagem de e-mail duplicado é global, não por `empresa_id`**
  — ✅ **confirmado intencional**: `users.email` tem `UNIQUE` no
  próprio schema do banco (`uq_users_email`) — login único na
  plataforma inteira por design, não bug.
- [x] **Admin de empresa podia criar `admin_master` sem restrição** —
  ✅ **já estava corrigido**: `criar_usuario()` já bloqueia
  (`esc_service.py:578-579`) — só `admin_master`/`superadmin` pode
  criar outro `admin_master`/`superadmin`.

## ✅ Verificado resolvido nesta rodada (estava desatualizado nos docs antigos)

- **"Líquido" das Sessões de Caixa não descontava despesas** —
  `esc_service.py:252` já calcula `entradas - saidas - baixas`.
- **Card "Sangrias (mês)" sempre R$ 0,00** — `financeiro.py:83,139` já
  retorna `total_sangria` de verdade.
- **`audit_log` não alimentado pelo ESC** — na verdade **quase todo**
  endpoint de escrita chama `_audit()` hoje (associações, OS, estoque,
  categorias, produtos, templates, contas a pagar, usuários, formas de
  pagamento, permissões, avisos, inventário) — 27+ pontos de auditoria
  confirmados em `esc.py`.
- **Categorias/Formas de Pagamento só criavam** — `PUT` de
  editar/desativar já existe pras duas (`esc.py:691,732`).
- **Baixa de Contas a Pagar não vinculava caixa físico** — UI já tem
  seletor de sessão (`ContasPagarSection.tsx:47,308`), backend já
  aceita e grava.
- **Grupos de Usuários "dataset errado"** — já lia/gravava o dataset
  certo (`empresas.access_groups`), claim antigo já estava obsoleto.
- **Módulo "financeiro" fora da grade de Permissões** — já incluído em
  `MODULES`.
- **`isEsc()`/associação real do ESC "não implementado"** (spec
  2026-07-17 dizia isso) — já implementado e em uso (`is_esc_station`
  no backend, `isEsc` em 3 arquivos do frontend).
- **`CrmSection` sem paginação real, carregando ~1800 registros
  inteiros** (audit 2026-08-01) — já paginado no servidor (comentário
  explícito no código confirma).
- **PDF de conferência de sessão de caixa quebrando (500)** — corrigido
  há mais tempo, testado ao vivo.
- **DRE ignorava Sangria** — decisão de negócio já implementada
  (sangria conta como despesa).

## Itens do levantamento amplo (specs/reports antigos) não reverificados individualmente

Estes vieram de uma varredura ampla em docs anteriores a 2026-09-12 e
**não foram confirmados no código nesta rodada** (fora do escopo da
verificação profunda de hoje, que focou no checklist ESC). Marcar como
"a investigar" antes de agir:
- [x] **SQL injection em `crm.py`, `senso.py`, `datalake_service.py`**
  — ✅ **auditado e confirmado seguro 2026-09-15**: os 3 arquivos usam
  o padrão correto (`WHERE` dinâmico montado só com fragmentos SQL
  fixos/hardcoded, todo valor de usuário vai por `:placeholder`
  parametrizado do SQLAlchemy, nunca interpolado direto na string). O
  único f-string com valor dinâmico (`datalake_service.py`, nome de
  tabela em `TRUNCATE`) vem de uma lista fixa no código, não de input
  de request. Sem achado real.
- [x] **`CORS`/`app_env` de produção vazando stack trace** — ✅
  **confirmado seguro 2026-09-15**: `APP_ENV=production` já setado no
  ambiente real, e `main.py` (`unhandled_exception`) só devolve
  `str(exc)`/trace pro cliente quando `app_env != "production"` — em
  produção devolve só "Erro interno do servidor.", trace vai pro log
  do servidor.
- [x] **`.catch(() => {})` silenciosos no frontend** — ✅ **Resolvido
  2026-09-15**: eram 44 no total (não 13, número do audit antigo já
  estava bem desatualizado), corrigidos 38 (12 no ESC + 26 no resto do
  app, 25 arquivos) com `toast.error` específico. 15 restam
  deliberadamente silenciosos — comportamento correto, não bug: polling
  de badge (notificação/chat, a cada 30s — toast a cada falha seria
  spam), marcar mensagem/notificação como lida (fire-and-forget),
  presença em tempo real (heartbeat 5 em 5 min), registro do
  `service worker`, o próprio `reportError.ts` (reportador de erro não
  pode alertar em loop se ele mesmo falhar), autopreenchimento de CEP
  em background (fallback é digitar manual, sem necessidade de aviso).
- [ ] Acessibilidade (`aria-*`) em `pages/esc/` — não verificado.
- [x] **Inventário financeiro do Escritório (conferência de caixa)** —
  ✅ **não é gap, confirmado 2026-09-15**: já existe, só com outro
  nome — `Financeiro → Sessões de Caixa` (`SessoesCaixaSection.tsx`)
  já cobre a mesma função: lista de sessões conferidas por unidade,
  detalhe (quebra de caixa, sobra/falta, PIX/dinheiro contado), 2ª via
  de PDF da conferência, desconferir com motivo obrigatório (auditoria).
  O spec antigo procurava pelo nome errado ("inventário", não "sessões
  conferidas") — nada a construir.
- [x] **Branch protection exigindo status check do CodeQL** — 🔴
  **tentado e revertido 2026-09-15**: ativado nos 3 repos via API do
  GitHub (`Analyze (javascript-typescript)` + `Analyze (python)` onde
  aplicável), mas **bloqueou push direto no `main`** logo no primeiro
  commit seguinte — o GitHub aplica "required status checks" em
  qualquer push pro branch protegido, não só em merge de PR, e o fluxo
  real deste projeto (aqui e no dia a dia) é push direto, sem PR.
  Revertido nos 3 repos pra não travar o próprio deploy. **Decisão
  pendente do usuário:** migrar pra fluxo de PR (aí a proteção faz
  sentido) ou desistir da automação e só checar os alertas do CodeQL
  manualmente de vez em quando (aba Security de cada repo).
