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

Não reverificados individualmente nesta rodada (baixo risco, sem
impacto funcional) — herdados do audit de 2026-07-23, presume-se
abertos até confirmação:
- [ ] Usuários: enum de cargo (`admin_master`, `diretoria_adjunta`...)
  exibido cru, sem tradução.
- [ ] Usuários: campo `phone` sem input no formulário (campo morto no
  backend).
- [ ] Usuários: `last_login_at` retornado pela API mas nunca exibido.
- [ ] Movimentações: filtro "Cargo" e coluna "Status Morador" exibidos
  crus (`active/inactive/suspended`).
- [ ] DRE: `income_subtype` cru quando falta descrição/categoria, em
  vez de usar o `SUBTYPE_MAP` já existente no mesmo arquivo.
- [ ] DRE: `sub_agrupar_por` implementado no backend, nunca usado no
  frontend (funcionalidade morta).
- [ ] Contas a Receber: zero filtros (busca/unidade/período), sem
  paginação nas duas abas.
- [ ] Sangrias: valor sem formatação pt-BR; filtro de data não exposto
  na UI (backend já suporta).
- [ ] `EscInfraSection`: falha silenciosa, sem mensagem de erro visível.
- [ ] Dado incompleto em produção (contagem de 2026-08-01, não
  reconferida): ~292 CEPs, ~1.361 telefones, ~429 números de endereço
  de moradores em branco.

## 🟢 Decisão de escopo (não são bugs)

- [ ] Endpoint `GET /esc/administracao/permissoes` não é chamado por
  nenhuma tela — usar ou remover.
- [ ] Detecção de forma de pagamento por `ILIKE '%pix%'`/`'%dinheiro%'`
  no nome digitado (`esc.py`) — frágil se alguém digitar diferente.
- [ ] Checagem de e-mail duplicado ao criar usuário é global, não por
  `empresa_id` — confirmar se é intencional (provável: login é único
  na plataforma).
- [ ] Qualquer admin de empresa pode criar outro usuário com cargo
  `admin_master` sem restrição adicional — confirmar se é a regra
  desejada.

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
- [ ] SQL injection: auditar `crm.py`, `senso.py`, `datalake_service.py`
  (apontado como pendente no audit de 2026-08-01).
- [ ] Confirmar `CORS`/`app_env` de produção não vazam stack trace.
- [ ] `13 .catch(() => {})` silenciosos no frontend (audit 2026-08-01)
  — não relistados individualmente, precisa levantamento novo.
- [ ] Acessibilidade (`aria-*`) em `pages/esc/` — não verificado.
- [ ] Inventário financeiro do Escritório (conferência de caixa,
  diferente do inventário de encomendas que já existe) — status
  incerto, spec antigo dizia pendente.
- [ ] Branch protection exigindo status check do CodeQL nos 3 repos —
  não aplicável até o CodeQL existir (ver item crítico acima).
