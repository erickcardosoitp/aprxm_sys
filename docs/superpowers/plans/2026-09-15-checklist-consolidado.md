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

- [ ] **Categoria de Contas a Pagar não chega na DRE.** Confirmado
  ainda aberto em `backend/app/services/esc_service.py:468-475`
  (`baixar_conta_pagar`): o `INSERT INTO transactions` da baixa não
  seta `category_id` — só põe o nome da categoria no texto livre da
  descrição. Uma conta categorizada como "Aluguel" continua caindo
  genérica em "Despesas Gerais" no DRE, perdendo a categorização.
  (`payable_categories` é tabela própria, diferente de
  `transaction_categories` que a DRE lê — precisa mapear uma pra
  outra, ou linkar direto.)
- [ ] **`erp_itp` sem Dependabot nem CodeQL configurados.** Confirmado
  agora: `~/erp_itp/.github/dependabot.yml` não existe, nenhum workflow
  `*codeql*`. Citado como pendente em 3 documentos antigos diferentes
  — nunca foi feito. Simples de resolver (arquivo de config + habilitar
  no GitHub).

## 🟠 Alto

- [ ] **Encomendas: 100% somente-leitura no ESC** (só `GET`, sem
  criar/editar) — confirmado em `esc.py:92-105`. **Diferente do que o
  checklist de 07-23 dizia**: já tem paginação real e filtro de data
  (`skip`/`limit` até 200, `date_from`/`date_to`) — só falta a escrita.
  Ordens de Serviço, pro contraste, **já têm CRUD completo no ESC**
  (criar/editar/excluir, `esc.py:130-195`) — Encomendas ficou pra trás.
- [ ] **Associações: só editar, não criar** no ESC — `PUT
  /cadastros/associacoes/{id}` existe (`esc.py:68`), mas criar/(des)ativar
  unidade nova continua só no router de superadmin de plataforma, fora
  do alcance do admin da própria empresa.
- [ ] **Administração → Estoque é cópia read-only e incompleta de
  Cadastros → Comprovantes de Residência** — decisão de produto
  pendente (dar paridade de edição, ou remover a duplicata).

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
