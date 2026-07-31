# Changelog — Portal do Morador, Comunidade e Diretório (jul/2026)

Documento de acompanhamento do commit que introduz o Portal do Morador, o feed de comunidade, o diretório de comércio local, o sistema de notificações e correções incidentais encontradas no caminho. Cobre todo o schema, todas as rotas e o racional de cada decisão.

## Índice

1. [Banco de dados](#banco-de-dados)
2. [Portal do Morador — autenticação](#portal-do-morador--autenticação)
3. [Feed da comunidade](#feed-da-comunidade)
4. [Diretório da comunidade](#diretório-da-comunidade)
5. [Notificações do morador](#notificações-do-morador)
6. [Escritório (ESC) — painel de aprovações](#escritório-esc--painel-de-aprovações)
7. [Curtidas](#curtidas)
8. [Correções incidentais](#correções-incidentais)
9. [Infra / DX](#infra--dx)

---

## Banco de dados

Todas as migrações vivem em `database/migrations/028_*.sql` até `035_*.sql`, e o mesmo SQL está replicado como blocos idempotentes em `backend/app/main.py::_run_migrations()` (versões v22 a v30 no `schema_migrations`), que é o que efetivamente roda em produção no cold start do backend.

> **Nota:** o Neon de produção já tinha uma "v21" própria (`UNIQUE(association_id, cpf)` em `residents`) que não existe neste checkout local. Por isso as migrações desta sessão começam em v22 — não há colisão de número, mas vale registrar a divergência entre o histórico local e o de produção.

| Versão | Migration | O que faz |
|---|---|---|
| v22 | `028_resident_portal_auth.sql` | `residents.password_hash` (nullable), `residents.token_version` (default 0, para revogar sessões) |
| v23 | `029_community_feed.sql` | Enums `community_author_type`, `community_post_category`, `community_post_status`; tabelas `community_posts`, `community_comments` |
| v24 | `030_community_replies_notifications.sql` | Novo valor de enum `'resolved'` em `community_post_status`; colunas `admin_reply`/`admin_reply_at`/`admin_reply_by` em `community_posts`; tabela `resident_notifications` |
| v25 | `031_community_directory.sql` | Enum `community_place_category`; tabelas `community_places`, `community_place_ratings`, `community_place_update_requests` |
| v26 | `032_resident_username.sql` | `residents.username` + índice único `uq_residents_assoc_username` em `(association_id, LOWER(username)) WHERE username IS NOT NULL` |
| v27 | `033_directory_resident_listings.sql` | `community_places.owner_resident_id`, `status`, `moderation_reason` (autocadastro pelo morador) |
| v28 | *(sem arquivo `.sql` próprio — só em `main.py`)* | Novo valor de enum `'solicitacao'` em `community_post_category` |
| v29 | `034_community_post_likes.sql` | Tabela `community_post_likes` (1 curtida por morador por post) |
| v30 | `035_community_comment_likes.sql` | Tabela `community_comment_likes` (1 curtida por morador por comentário) |

Todas as migrações são aditivas (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / CREATE TYPE ... EXCEPTION WHEN duplicate_object) — nenhuma quebra dados existentes, nenhuma é destrutiva.

> **Gap conhecido:** a v28 (novo valor `'solicitacao'` no enum `community_post_category`) só existe como bloco em `main.py::_run_migrations()` — não foi criado um arquivo `.sql` correspondente em `database/migrations/`, diferente das outras 8 versões desta sessão. Funcionalmente não afeta nada (o cold start do backend aplica do mesmo jeito), mas quebra a paridade 1-arquivo-por-versão que o restante da pasta mantém.

### Modelo de categorias do feed (evolução dentro da própria sessão)

O enum `community_post_category` tem os valores `anuncio`, `reclamacao`, `aviso`, `outro`, `solicitacao` no Postgres — mas o valor `reclamacao` foi **descontinuado a nível de aplicação** (não removido do enum, para evitar operação de risco em produção sem necessidade, e porque não havia nenhuma linha usando esse valor). O modelo final:

- **Morador** só pode criar 2 tipos: `solicitacao` (com título) e `outro` (publicação comum, sem título).
- **Staff** só pode criar `anuncio` e `aviso` — que ao serem publicados notificam **todos os moradores ativos** da associação automaticamente.

Essa restrição é aplicada em código (`_RESIDENT_CATEGORIES` em `resident_portal.py`, `_STAFF_BROADCAST_CATEGORIES`/`_VALID_CATEGORIES` em `community.py`), não em constraint de banco.

---

## Portal do Morador — autenticação

Sistema de auth **paralelo e isolado** do login de staff — token JWT próprio com claim `"kind": "resident"`, verificado independentemente do `CurrentUser` existente.

- `backend/app/core/resident_auth.py` — `CurrentResident`, `create_resident_token()`, dependency `get_current_resident()` via `HTTPBearer` dedicado. Token expira em 7 dias e carrega `tv` (token_version) — trocar a senha ou forçar logout incrementa `token_version` no banco, invalidando todos os tokens antigos emitidos.
- `frontend/src/pages/morador/residentApi.ts` — instância axios própria (`residentApi`), chave de localStorage própria (`aprxm-resident-token`) — deliberadamente separada da instância `api`/token do staff, para o mesmo navegador poder ter as duas sessões (staff e morador) simultâneas sem conflito.

### Rotas (`/api/v1/portal`, prefixo `/portal`)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/portal/{slug}/set-senha` | Primeiro acesso — nome completo + telefone + CPF + nova senha (+ username opcional) |
| POST | `/portal/{slug}/login` | Login por nome completo, e-mail **ou** nome de usuário (qualquer um) + senha |
| GET | `/portal/me` | Perfil do morador logado |
| PATCH | `/portal/me/username` | Definir/trocar nome de usuário |
| GET | `/portal/encomendas` | Encomendas do morador logado |
| GET | `/portal/mensalidades` | Mensalidades/inadimplência do morador logado |

O login por nome busca todos os moradores cujo `full_name` bate (nome não é único) e testa a senha em cada candidato; login por username/e-mail é direto pois ambos têm unicidade garantida (índice único / uso prático).

---

## Feed da comunidade

Moradores publicam, staff modera (com um assist de IA), tudo dentro do mesmo `community_posts`/`community_comments`.

### Moderação por IA
`backend/app/services/moderation_service.py::moderate_post()` chama a Groq API (`llama-3.3-70b-versatile`, reaproveitando a mesma integração do agente "Simplifica" já existente no projeto) e retorna `(status, reason, moderated_by_ai)`. Se `GROQ_API_KEY` não estiver configurada, ou a chamada falhar, cai em `pending` (revisão manual) — nunca aprova nem rejeita "no escuro".

### Rotas do morador (`/api/v1/portal`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/portal/feed` | Feed público (só posts `approved`) |
| GET | `/portal/feed/mine` | "Minhas publicações" (todos os status, inclusive pending/rejected) |
| POST | `/portal/feed` | Criar post — passa pela moderação de IA |
| PATCH | `/portal/feed/{post_id}` | Editar o próprio post — se já `resolved`/`removed`, só corrige o conteúdo sem reabrir moderação; senão, volta pra moderação (evita usar "edição" pra colar conteúdo não revisado) |
| DELETE | `/portal/feed/{post_id}` | Excluir o próprio post |
| POST | `/portal/feed/upload` | Upload de imagem do post (mesmo storage usado pelas fotos de encomenda) |
| GET | `/portal/feed/{post_id}/comments` | Comentários de um post (com `like_count`, `liked_by_me`, `is_mine`) |
| POST | `/portal/feed/{post_id}/comments` | Comentar num post |
| DELETE | `/portal/feed/comments/{comment_id}` | Excluir o próprio comentário |

### Rotas do staff (`/api/v1/community`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/community/posts` | Fila de posts (filtros por status e categoria) |
| POST | `/community/posts` | Publicar anúncio/aviso oficial — **notifica todos os moradores ativos** via 1 `INSERT ... SELECT` (não loop em Python, importante pra associações com centenas de moradores) |
| PATCH | `/community/posts/{post_id}/moderate` | Aprovar/reprovar/remover (override manual do staff sobre a decisão da IA) |
| PATCH | `/community/posts/{post_id}/reply` | Responder oficialmente a um post |
| DELETE | `/community/posts/{post_id}` | Excluir definitivamente |
| POST | `/community/posts/purge` | Limpar posts antigos em lote (por idade, `now() - make_interval(days => :days)`) |
| GET | `/community/posts/{post_id}/comments` | Ver comentários (staff) |
| DELETE | `/community/comments/{comment_id}` | Remover comentário |

Posts em status `resolved` ou `removed` **somem do feed** automaticamente — não aparecem mais em `/portal/feed`.

---

## Diretório da comunidade

Lanchonetes, mercados, prestadores de serviço etc. Avaliação **apenas por estrelas** (sem texto livre), com cálculo de nota média.

### Rotas do morador (`/api/v1/portal`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/portal/directory/places` | Lista de lugares aprovados (com `avg_rating`, `rating_count`, `my_rating`) |
| POST | `/portal/directory/places/{place_id}/rate` | Avaliar com estrelas (1 a 5, upsert por morador) |
| POST | `/portal/directory/places/{place_id}/update-request` | Sugerir atualização de um lugar existente (fila de aprovação) |
| GET | `/portal/directory/mine` | Meus cadastros no diretório |
| POST | `/portal/directory/mine` | Autocadastro como dono de lanchonete/prestador de serviço — fica `pending` até staff aprovar |
| PATCH | `/portal/directory/mine/{place_id}` | Editar meu cadastro — qualquer edição volta pra `pending` (evita alteração escapar da moderação depois de aprovado) |
| DELETE | `/portal/directory/mine/{place_id}` | Excluir meu cadastro |
| POST | `/portal/directory/upload` | Upload de imagem do diretório |

### Rotas do staff (`/api/v1/directory`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/directory/places` | Listar todos os lugares |
| POST | `/directory/places` | Cadastrar lugar diretamente (sem passar por moderação — já entra `approved`) |
| PATCH | `/directory/places/{place_id}` | Editar |
| PATCH | `/directory/places/{place_id}/moderate` | Aprovar/reprovar cadastro enviado por morador |
| DELETE | `/directory/places/{place_id}` | Excluir |
| GET | `/directory/update-requests` | Fila de sugestões de atualização |
| PATCH | `/directory/update-requests/{request_id}` | Aprovar/reprovar sugestão |

---

## Notificações do morador

`backend/app/services/resident_notification_service.py::notify_resident(session, association_id, resident_id, type_, title, body=None, post_id=None)` — grava em `resident_notifications` mas **não commita** (quem chama decide o commit, pra ficar atômico com a operação principal).

Gatilhos que disparam notificação, adicionados nesta sessão:

1. **Encomenda chegou** — `package_service.py::receive_package()` e `packages.py::reassign_package()`.
2. **Mensalidade perto do vencimento** — novo cron `POST /api/v1/mensalidades/cron-remind-due`, roda 1x/dia (`vercel.json`, `15 9 * * *`), avisa em D-3, D-1 e no próprio dia do vencimento. Sem dedupe explícito (repetir o aviso no mesmo dia não tem custo real).
3. **Post aprovado/rejeitado** — `community.py::moderar_post()`.
4. **Resposta oficial do staff a um post** — `community.py::responder_post()`.

### Rotas (`/api/v1/portal`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/portal/notifications` | Lista de notificações |
| GET | `/portal/notifications/unread-count` | Contagem de não lidas (pro sininho no header) |
| POST | `/portal/notifications/{notification_id}/read` | Marcar 1 como lida |
| POST | `/portal/notifications/read-all` | Marcar todas como lidas |

Frontend: `frontend/src/pages/morador/NotificationBell.tsx`, polling a cada 60s.

---

## Escritório (ESC) — painel de aprovações

Nova aba "Comunidade" em `/esc/aprovacoes` (`frontend/src/pages/esc/AprovacoesPage.tsx`), pensada como a tela principal de trabalho da staff, dado que o app de comunidade exige revisão constante até o modelo de IA de moderação amadurecer. Seções:

- **Pendentes — Publicações** (`PublicacoesPendentesSection.tsx`) — fila de posts `pending`
- **Solicitações** (`SolicitacoesSection.tsx`) — posts de categoria `solicitacao` especificamente
- **Pendentes — Cadastros** (`DiretorioCadastrosPendentesSection.tsx`) — autocadastros de morador no diretório aguardando aprovação
- **Pendentes — Sugestões** (`DiretorioSugestoesPendentesSection.tsx`) — sugestões de atualização de lugares existentes
- **Todas as Publicações** — embute `CommunityModerationPage` completa (editar, responder, excluir, purgar)
- **Diretório Completo** — embute `DirectoryStaffPage` completa (CRUD full)

---

## Curtidas

Coração em posts e em comentários, 1 por morador por item (`UNIQUE(post_id, resident_id)` / `UNIQUE(comment_id, resident_id)`).

| Método | Rota | Descrição |
|---|---|---|
| POST | `/portal/feed/{post_id}/like` | Curtir/descurtir um post (toggle) |
| POST | `/portal/feed/comments/{comment_id}/like` | Curtir/descurtir um comentário (toggle) |

Frontend faz update otimista (alterna a UI na hora, reverte só se a chamada falhar).

---

## Correções incidentais

Bugs pré-existentes encontrados e corrigidos durante o desenvolvimento das features acima:

1. **`cron_generate`/`cron_check_overdue` (mensalidades.py) — 422 em toda chamada real de cron.** O parâmetro `request` não tinha o tipo `Request` anotado, então o FastAPI o tratava como query param string obrigatório — todo cron real (sem query string) retornava 422. Corrigido anotando `request: Request`.
2. **`cron_check_overdue` — erro de tipo em `cutoff`.** Só apareceu depois do fix acima, já que o endpoint nunca tinha executado com sucesso antes: `cutoff = (...).isoformat()` (string) era comparado contra `due_date` (coluna `date`), causando `asyncpg.exceptions.DataError`. Corrigido mantendo `cutoff` como `date` e só chamando `.isoformat()` na resposta JSON.
3. **`_assert_username_available` — erro de sintaxe SQL.** `(:exclude::uuid IS NULL OR ...)` quebrava porque o parser de bind-param do SQLAlchemy se confunde com `::` logo após um parâmetro nomeado. Corrigido com `CAST(:exclude AS uuid)`.
4. **`limpar_posts_antigos` (purge) — erro de tipo em intervalo.** `now() - (:days || ' days')::interval` falhava (`asyncpg.exceptions.DataError`, esperava string e recebia int). Corrigido com `now() - make_interval(days => :days)`.
5. **Mapa não carregava / travava em "Geocodificando...".** A Overpass API pública (usada para desenhar as ruas no mapa) não tinha timeout no fetch e o loop processava até 120 CEPs estritamente em sequência — uma chamada lenta/travada travava a tela inteira. Corrigido com `fetchWithTimeout()` (AbortController, 8s), cache de geometria em `localStorage` (ruas não se movem, então uma vez resolvida a geometria não precisa bater no Overpass de novo) e lotes de 4 chamadas em paralelo em vez de sequencial 1-a-1.
6. **HMR parou de funcionar.** Docker Desktop no Windows + pasta sincronizada pelo OneDrive não repassa eventos nativos de sistema de arquivos de forma confiável para dentro do container. Corrigido com `usePolling: true` no `watch` do Vite (`frontend/vite.config.ts`) e `WATCHFILES_FORCE_POLLING=true` no backend (`docker-compose.yml`, consumido pelo `watchfiles` do `uvicorn --reload`).

---

## Infra / DX

- `backend/app/routers/financeiro.py::/summary` ganhou `expense_by_category` e `sangria_by_destination` (breakdowns por dicionário, no mesmo padrão do `income_by_type` já existente) e `contas_a_receber`/`contas_a_receber_count`.
- `frontend/src/pages/esc/financeiro/FluxoCaixaSection.tsx` ganhou 3 cards de estatística (Contas a receber, Banco no mês, Inadimplência) e 3 gráficos de barra (`CategoryBarChart.tsx`, reutilizável) para Receita por tipo, Despesas por categoria e Sangrias por destino — seguindo a metodologia de dataviz do projeto (cor sequencial de 1 hue por gráfico de magnitude, nunca uma cor por categoria).
- `.env.example` ganhou o placeholder `GROQ_API_KEY`.
- `.gitignore` ganhou `CREDENCIAIS_TESTE_LOCAL.txt` (arquivo local com credenciais de teste, nunca commitado).
