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
- [x] **Dado incompleto em produção** — ✅ **reconferido 2026-09-15**
  (2.147 moradores no total): CEP em branco 292→**277** (melhorou),
  número de endereço 429→**420** (melhorou), **telefone em branco
  1.361→1.653 (piorou +292)**. Não corrigido agora (é qualidade de
  dado, não bug de código) — o aumento de telefone em branco vale
  investigação separada (moradores novos sem coleta de telefone? tela
  de cadastro mudou?), registrado aqui como achado, não resolvido.

## 🔵 Backlog (não pendência, projeto planejado)

- [x] **Automatizar deploy do backend (CI/CD real via GitHub Actions)**
  — ✅ **Resolvido 2026-09-15**. Tentativa 1 (SSH remoto via
  `appleboy/ssh-action`) falhou — NSG do Azure bloqueia o IP dinâmico
  do runner hospedado do GitHub (`timeout` na porta 22); não abrimos o
  firewall pra internet geral. Solução final: **runner self-hosted
  instalado na própria VM** (systemd service, `vm-itp-prod-aprxm`,
  conexão só outbound pro GitHub, nenhuma porta nova aberta). Achado
  real na instalação: SELinux (Enforcing, Oracle Linux) bloqueava o
  `runsvc.sh` com `203/EXEC` — contexto `user_home_t` não pode rodar
  como serviço systemd; corrigido com `semanage fcontext` + `restorecon`
  pra `bin_t`. Testado de ponta a ponta via PR real: merge → workflow
  dispara no runner da VM → `git pull` + `docker build/up` + health
  check → 11 segundos, sucesso, backend saudável em produção.

## 🟠 Alto — resolvido 2026-09-15/16 (incidente de monitoramento)

- [x] **Alerta "Catálogo de erros — teto de classificações atingido
  repetidamente" disparando falso positivo por horas.** ✅ **Resolvido
  2026-09-16.** Causa raiz real: `catalogo_erros_teto_atingido` é uma
  métrica textfile escrita só quando o coletor roda de verdade — depois
  de uma rodada bater o teto (legítimo, 21:56:42) o scheduler adaptativo
  corretamente agendou a próxima varredura pra ~6h depois (sem item
  crítico/alto no lote), mas a métrica ficou **congelada em `1`** nesse
  intervalo todo. A regra do Grafana checava só `valor == 1 por 30min`,
  sem checar frescor do dado — disparou em cima de um valor de horas
  atrás, não de um problema ativo.
  - **Tentativa 1** (`catalogo_erros_teto_atingido == 1 and (...) < 1800`):
    corrigiu o falso positivo original, mas criou um novo — o operador
    `and` do PromQL remove a série inteira (não retorna 0) quando o lado
    direito é falso, virando "sem dado", que o Grafana trata como alerta
    especial `DatasourceNoData` **independente da configuração
    `no_data_state`** (achado adicional: essa versão do Grafana, 13.2.1,
    não aplica `no_data_state` do arquivo de provisionamento — todas as
    7 regras mostravam `NoData` ao vivo mesmo com valores diferentes no
    YAML; não investigado a fundo por ser fora do escopo imediato).
  - **Correção final**: reescrita a expressão pra nunca retornar "sem
    dado" — `catalogo_erros_teto_atingido * scalar(time() -
    node_textfile_mtime_seconds{file="...teto.prom"} < bool 1800)`.
    Multiplica o valor real (0 ou 1) por um booleano de frescor
    convertido pra escalar (`scalar()`, necessário porque `*` entre dois
    vetores de métricas diferentes não casa por padrão) — sempre produz
    um número, elimina o problema de "sem dado" na raiz, não só
    contorna a configuração do Grafana.
  - Confirmado: query testada direto no Prometheus (retorna `0`, nunca
    vazio, com dado congelado), estado da regra caiu de `firing` pra
    `inactive`/`health: ok`, estável por múltiplos ciclos de avaliação
    seguidos (~6min). E-mails `[RESOLVED]` de ambos os disparos (original
    e o `DatasourceNoData` da tentativa 1) recebidos, nenhum novo disparo
    depois da correção final.
- [x] **Processo órfão do coletor travando os locks.** ✅ Achado
  colateral (não é bug do sistema — era resquício de teste manual meu
  via SSH que não morreu ao encerrar a sessão): matado, locks (
  `catalogo-erros-coletor.lock`, `claude-cli-global.lock`) limpos.
  Pipeline real nunca esteve travado — rodava e agendava normalmente o
  tempo todo (confirmado via `catalogo-erros-cron-state.json` e log).
- [x] **Sem watchdog real pra travamento genuíno do coletor.** ✅
  **Resolvido 2026-09-16.** Antes só existia timeout por chamada
  individual à IA (`TIMEOUT_MAXIMO_S`, 5min) — nada limitava o processo
  Python como um todo. Adicionado `timeout 3300` (55min, acima do pior
  caso teórico de 5 classificações × 2 contas × 5min) envolvendo a
  chamada do `coletor.py` em `cron_coletor.sh`. Se travar de verdade,
  o wrapper mata o processo, loga `ERRO: código 124` e reagenda retry em
  5min — já usa o mecanismo de log/retry que já existia pra qualquer
  outra falha do coletor. Testado em cópia isolada (não tocou estado de
  produção): trava simulada → morto pelo timeout → erro logado → retry
  agendado corretamente.
- [x] **Auditoria completa das 7 regras de alerta do Grafana.** ✅
  Revisão manual de cada `expr`/`no_data_state`: as outras 6 (site fora
  do ar, disco cheio, memória crítica, container caído, taxa de erro
  HTTP, coletor sem execução recente) já usavam métricas de scrape
  contínuo ou já checavam frescor por design — só a regra do teto tinha
  o bug de métrica congelada. Nenhuma regra órfã/duplicada encontrada.
- [x] **Mensagens de alerta em bloco único, sem estrutura, difíceis de
  ler no e-mail.** ✅ **Resolvido 2026-09-16.** As 7 regras reformatadas
  com estrutura padrão (O QUE ACONTECEU / POR QUE IMPORTA / O QUE
  FAZER) e quebras de linha reais — o backend já envia em `<pre>`
  (`metrics.controller.ts`), então só faltava o texto ter `\n` de
  verdade. Testado ponta a ponta: e-mail de teste manual disparado via
  webhook real (`POST /api/metrics/alerta-grafana`), confirmado no log
  do backend (`EmailService`) que foi enviado com sucesso pra
  `monitoramento@institutotiapretinha.org`. Backups do
  `rules.yaml` original guardados antes de cada mudança
  (`rules.yaml.bak-*`).

## 🔵 Backlog — ETL / Data Warehouse, concluído 2026-09-16

- [x] **Arquitetura do ETL/DW mapeada, validada e ajustada.** ✅
  **Concluído 2026-09-16.** Confirmado ponta a ponta (não presumido —
  cada peça checada na VM/produção):
  - **Compute**: `run_etl.py` roda dentro do container `aprxm_backend`
    (`docker exec aprxm_backend python -m app.jobs.run_etl`), não em
    função serverless nem no Cloudflare (Workers não suporta
    pandas/pyarrow — avaliado e descartado).
  - **Storage (Bronze/Prata/Ouro)**: bucket R2 `aprxm-datalake` (conta
    Cloudflare `cdc5f5f5...`), pastas `bronze/atual/`,
    `bronze/historico/{ano}/{mes}/{dia}/`, `prata/{data}/`,
    `ouro/{dominio}/`. É o equivalente ao GCS na analogia com
    BigQuery — mantido separado do compute de propósito (redundância,
    não compete por disco da VM que já está monitorado por alerta de
    90%).
  - **Camada servida pro DBeaver/BI**: só **Ouro** é replicado pro
    ClickHouse (`aprxm_analytics`, container na VM) — 39 tabelas
    agregadas, 2.602 linhas/90KB total hoje. Bronze/Prata nunca chegam
    no ClickHouse, ficam só no R2 como staging/histórico.
  - **Particionamento no ClickHouse**: avaliado e **descartado por
    decisão técnica** — volume atual (2.602 linhas) não justifica
    `PARTITION BY` (zero ganho de performance, tabelas são recriadas
    do zero a cada rodada, não incremental). Revisitar só se o Gold
    virar granular por transação em vez de agregado.
  - **Agendamento**: reduzido de 2x/dia (`0 12,20 * * *`) pra 1x/dia
    às 7h Brasília / 10h UTC (`0 10 * * *`), processando D-1 — decisão
    do usuário, sem lógica de delta amarrada ao horário antigo
    (confirmado no código antes de mudar). Aplicado no crontab da VM e
    sincronizado em `tarefas-registro.json`, backups dos dois antes da
    mudança.
  - **Ferramenta de consulta**: DBeaver (desktop, já instalado)
    substituiu o Play UI do navegador — mesma função, melhor UX,
    conexão via túnel SSH (porta 8123 não exposta publicamente).
    CloudBeaver e ferramenta própria avaliados e descartados
    (reinventar o que o DBeaver já faz, sem ganho real).
  - Atalho **ETL** criado na área de trabalho da VM (logo oficial
    Cloudflare, cor de marca `#F38020`), abre direto o bucket
    `aprxm-datalake` no dashboard R2.

## 🟠 Alto — item 3 e 4 da agenda de amanhã, concluídos 2026-09-16

- [x] **"Acabar com o chat" — decisão: Teams será o único canal de
  comunicação da equipe.** ✅ **Concluído 2026-09-16** (PR #82).
  Mapeamento prévio (agente de exploração) encontrou entrelaçamento
  real com `chat_group` (agrupamento manual de associações usado por
  `reports.py`/`service_orders.py`/`daily_tasks.py`, não exclusivo do
  chat) — extraído pra `app/core/tenant.py` como
  `group_association_ids()` antes de remover `chat.py`, zero call site
  tocado nos 3 arquivos dependentes. **Achado real durante a execução**:
  `SimplificaChat.tsx` não era produto separado (como o mapeamento
  inicial presumiu) — era só um wrapper mobile do mesmo `ChatPage.tsx`,
  removido junto (incluindo o tile "Chat" na home do Simplifica).
  Job `aprxm-daily-tasks-reminders` **descontinuado por completo**
  (endpoint + dispatcher de cron + crontab da VM + registro de
  tarefas) — só postava no chat, sem canal alternativo; manter só
  marcaria `reminded_at` sem nunca avisar ninguém. As outras 3
  chamadas a `post_system_message` (`demands.py`, `service_orders.py`
  x2) tinham notificação/e-mail real em paralelo, removidas sem perda
  de funcionalidade. Tabelas `chat_messages`/`chat_message_reads`
  **mantidas no banco** (DDL destrutivo exige aprovação separada,
  histórico preservado). Validado: backend importa sem erro, frontend
  compila e builda, deploy em produção confirmado saudável
  (`/api/v1/chat/unread-count` retorna 404 como esperado).
- [x] **"Remodelar frontend" — primeiro passo: tela de login.** ✅
  **Concluído 2026-09-16** (PR #83), direção "mais corporativo/sóbrio"
  escolhida pelo usuário. Removido indicador numérico de passos (1/2/3,
  parecia wizard genérico), fundo trocado de gradiente CSS liso pra
  textura de grid sutil + glow duplo, tipografia do header refinada,
  sombra do card mais suave/tintada. Zero mudança de lógica/fluxo de
  autenticação (multi-step, WebAuthn, acessos recentes intactos).
  Testado visualmente via screenshot antes do commit. Escopo maior de
  "remodelar frontend" (qual dos 4 apps, visual vs estrutural) segue em
  aberto — isso cobriu só a tela de login do app principal.
- [x] **"Investigar lentidão"** — ❌ **cancelado pelo usuário
  2026-09-16**, sai da lista de pendências.

## 🟢 Decisão de escopo — reverificado 2026-09-15

- [x] **Endpoint `GET /esc/administracao/permissoes` não usado** — ✅
  já não existe mais no código (removido em algum momento, claim
  obsoleta).
- [x] **Detecção de forma de pagamento por `ILIKE '%pix%'`/`'%dinheiro%'`**
  no nome digitado — ✅ **Resolvido 2026-09-15**. Real em 10 pontos de
  4 arquivos (não 6 — `admin.py`/`finance.py` já não tinham mais esse
  padrão quando reverificado de perto). Migration v27:
  `payment_methods.type` (pix/dinheiro/outro) com backfill único,
  substitui a inferência por nome nos 4 arquivos
  (`esc_service.py`, `finance_service.py`, `cash_boxes.py`,
  `financeiro.py`). Seletor de tipo no frontend ao criar/editar forma
  de pagamento. Deployado e migration confirmada em produção.
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
- [x] **Acessibilidade (`aria-*`) em `pages/esc/`** — ✅ **Resolvido
  2026-09-15**: confirmado zero `aria-*` em 29 arquivos. Corrigidos os
  2 gaps reais de maior alcance (componentes centrais, ~15 telas
  afetadas): `SortTh` era `<th onClick>` sem suporte a teclado nem
  `aria-sort` — agora navegável via Tab/Enter/Espaço, anuncia estado de
  ordenação. `EscModal` + 2 modais customizados ganharam
  `role="dialog"`/`aria-modal`/`aria-labelledby` + `aria-label` no
  botão fechar. Botões de ícone individuais (Pencil/Trash2 etc.) já
  tinham `title`, aceito como nome acessível pela maioria dos leitores
  de tela — não mexidos (baixo retorno por arquivo tocado).
- [x] **Inventário financeiro do Escritório (conferência de caixa)** —
  ✅ **não é gap, confirmado 2026-09-15**: já existe, só com outro
  nome — `Financeiro → Sessões de Caixa` (`SessoesCaixaSection.tsx`)
  já cobre a mesma função: lista de sessões conferidas por unidade,
  detalhe (quebra de caixa, sobra/falta, PIX/dinheiro contado), 2ª via
  de PDF da conferência, desconferir com motivo obrigatório (auditoria).
  O spec antigo procurava pelo nome errado ("inventário", não "sessões
  conferidas") — nada a construir.
- [x] **Branch protection exigindo status check do CodeQL** — ✅
  **Resolvido de vez 2026-09-15**: reativado nos 3 repos, e o projeto
  migrou pra fluxo de PR (decisão do usuário) — daqui pra frente,
  mudança vira branch → push → PR → CodeQL roda → merge, em vez de
  push direto no `main`. Este próprio commit é o teste de ponta a ponta
  do novo fluxo.
