# Due Diligence — erp_itp para Migração Azure
**Data:** 2026-09-01 · **Escopo:** `erp_itp` (NestJS+TypeORM backend / Next.js 15 frontend), alimenta a Fase 3 do plano de migração Azure.
**Método:** leitura direta do repo (`C:\Users\gonca\erp_itp`), `git fetch` + worktree de `origin/main` (local estava **8 commits atrás** do remoto — análise abaixo já usa `origin/main`), `psql` direto no Neon de produção, `vercel env ls`/`vercel domains inspect` via CLI autenticado no time `itp-aprxm`. Nada foi alterado além do `.gitignore` (achado crítico de segurança, corrigido nesta sessão) e deste relatório.

---

## Sumário executivo

- **A produção real roda `apps/backend/api/main.ts`, não `apps/backend/src/main.ts`.** O plano (§3.2) assume que o App Service vai rodar via `bootstrapLocal()` de `src/main.ts` — código correto para App Service, mas **diferente** do handler serverless (`api/main.ts`) que está de fato em produção hoje (payload guard, bootstrap timeout, cache de app entre invocações, CORS duplicado e já divergente do de `src/main.ts`). Migrar sem revisar essa diferença troca silenciosamente o comportamento de erro/CORS em produção.
- **Domínio `institutotiapretinha.org` é registrado E hospedado no DNS da própria Vercel** (`ns1/ns2.vercel-dns.com`), não um CNAME num provedor externo. Esse único domínio serve os 3 sistemas (apex = website, `itp.` = frontend erp_itp, `api.itp.` = backend erp_itp). O cutover de DNS do plano (§3.4, §Fase 1) pressupõe "trocar CNAME num provedor" — na prática é preciso primeiro migrar o DNS/nameservers para fora da Vercel (ou gerenciar registros dentro do painel Vercel apontando pra Azure), afetando **todas as fases**, não só a 3. Fazer isso uma vez, cedo (Fase 0/1), evita repetir o risco em cada corte.
- **Repo local estava 8 commits atrás de `origin/main`** (`git rev-list HEAD..origin/main --count` = 8). O `SCHEMA_VERSION` no código local é 19, mas o banco de produção já está em `_schema_version.version = 20` (aplicado em 2026-07-17) — confirma que o local não reflete o que está rodando. Qualquer decisão de migração tomada olhando o checkout local sem sincronizar primeiro é decisão sobre código errado.
- **Vercel Cron Jobs não têm equivalente automático no App Service.** `apps/backend/vercel.json` define 2 crons (`/api/auth/cron/verificar-senhas` 08:00, `/api/supabase/cron/health-check` 08:30) autenticados via `Authorization: Bearer $CRON_SECRET` (convenção própria da Vercel). Isso não existe em App Service — precisa de Azure Logic App / Function Timer Trigger / scheduler externo batendo no endpoint com header `x-cron-secret` (o código já aceita esse header como alternativa, confirmado em `auth.controller.ts:106-113`).
- **2 scripts Google Apps Script fora do repo** (`google-apps-script/formulario-candidato.gs`, `formulario-funcionario.gs`) têm a URL da API **hardcoded** (`https://api.itp.institutotiapretinha.org/api/matriculas/inscricao` e `.../funcionarios/webhook`) e vivem no Google Drive, não no deploy do git. Fácil esquecer no cutover — precisam de edição manual no editor do Apps Script.
- **Arquivo de secrets sem `.gitignore` encontrado e corrigido nesta sessão**: `.env.vercel.erp-itp` (na raiz do repo, não criado por mim) continha `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_SERVICE_KEY`, `SUPABASE_URL` e `VERCEL_OIDC_TOKEN` reais, **não coberto** por nenhum padrão do `.gitignore` (confirmado via `git check-ignore -v`, sem match; nunca foi commitado — `git log --all` vazio para o arquivo). Adicionei `.env.vercel*` ao `.gitignore` do repo e revalidei que agora ignora.
- **`synchronize: false` confirmado** (`app.module.ts:98`) — não é o TypeORM que gerencia schema em produção. Quem gerencia é um sistema próprio (padrão idêntico ao já visto em `aprxm_sys`): bloco `_schema_version` em `app.module.ts` (linhas 164-1542, ~1400 linhas de SQL cru) que roda `ALTER TABLE IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS` no boot da aplicação, versionado por um inteiro incremental. **Toda migração desse sistema precisa ser replay-safe** — mesmo padrão de risco documentado no `CLAUDE.md` do `aprxm_sys`.
- **A pasta `apps/backend/src/migrations/` (TypeORM CLI) está órfã.** Só existe 1 arquivo (`1740000000000-AddEmailResponsavelFields.ts`), a tabela `migrations` (que o TypeORM CLI usa para rastrear o que já rodou) **não existe no banco**, e não há `DataSource` exportado nem `-d <datasource>` nos scripts `typeorm:migration:*` do `package.json` — ou seja, esses scripts provavelmente nem rodam sem configuração adicional. A migration daquele arquivo (colunas `email_responsavel`) já existe nas tabelas via o bloco SQL cru do `_schema_version` (linha 1352), então nada se perde — mas a pasta `migrations/` não é fonte de verdade nenhuma, é código morto.

---

## Achados críticos

### 1. Handler de produção real ≠ handler assumido no plano
`apps/backend/vercel.json` aponta `functions."api/main.ts"` como a function real (`memory: 1024, maxDuration: 60`). Esse arquivo:
- Duplica `setupApp` de `src/main.ts` mas com extras: `PayloadSizeInterceptor` + middleware de guarda de payload (trunca respostas >1MB antes do limite de 4.5MB da Vercel — **não existe motivo pra manter isso em App Service**, que não tem esse limite de payload), cache de instância `app` entre invocações, timeout de bootstrap de 55s com retorno 503 (lógica de cold-start do Neon serverless, sem sentido em App Service Always-On).
- **CORS já divergente entre os dois arquivos**: o preflight `OPTIONS` do `api/main.ts` (linhas 172-181) responde com `Access-Control-Allow-Origin: https://institutotiapretinha.org` fixo (só o apex), enquanto o `enableCors()` do mesmo arquivo (chamado para requests não-OPTIONS) e o de `src/main.ts` liberam 3 origins (`itp.`, `api.itp.`, apex). Isso é uma inconsistência já existente em produção, não introduzida pela migração — mas quem for portar CORS pro Azure precisa atualizar **os dois lugares**, e o `vercel.json` tem um terceiro (`headers`/`routes` com o mesmo `https://institutotiapretinha.org` fixo, linhas 22-54).
- Ação recomendada: decidir explicitamente qual dos dois arquivos (`src/main.ts` ou `api/main.ts`) vira a base do App Service — não assumir que é `src/main.ts` só porque é o mais simples. Se for usar `api/main.ts` como base (mais fiel ao que já roda), remover a lógica de payload-guard/timeout específica de serverless antes do deploy.

### 2. Domínio + DNS na própria Vercel
`vercel domains inspect institutotiapretinha.org`: registrador **Vercel**, nameservers **Vercel** (`ns1/ns2.vercel-dns.com`), expira 20/02/2027. Os 3 domínios do plano de migração (apex do site, `itp.` do frontend, `api.itp.` do backend) são registros dentro desse único domínio gerenciado 100% pela Vercel. Implicações concretas:
- Não existe hoje um "CNAME num provedor de DNS" pra trocar — a Vercel É o provedor de DNS.
- Duas rotas possíveis: (a) mudar nameservers pra um provedor externo (Cloudflare, Azure DNS, Route53) uma única vez, cedo, e depois gerenciar CNAME/A record por subdomínio à vontade por fase; ou (b) manter DNS na Vercel e criar registros lá mesmo apontando pra Azure (Vercel permite registros CNAME/A/TXT para domínios que hospeda, mesmo saindo do próprio produto Vercel).
- Recomendo (a), feito na Fase 0/1 (piloto), porque evita depender de painel de DNS de terceiro durante o corte de cada sistema e reduz a superfície de erro pra 1 mudança em vez de 3.
- TTL baixo mencionado no plano se aplica igual, mas a alteração precisa ser feita dentro do fluxo específico da Vercel ("Domains" → nameservers ou → DNS records), não de um provedor genérico.

### 3. Repo local desatualizado (8 commits) — inclui mudança recente relevante
`git rev-list HEAD..origin/main --count` = 8. O commit mais recente em `origin/main` (`2bd59530`, 27/07/2026) já mexe em `app.module.ts` e limita o pool do TypeORM (`max: 5`) "para reduzir risco de esgotar conexões do Neon em invocações serverless concorrentes" — comentário explícito de que esse limite existe por causa do modelo serverless da Vercel. Em App Service (processo único, sempre ativo, sem invocações paralelas por request) esse limite pode ser revisado/aumentado, mas não é bloqueante — só não copiar a suposição "está limitado a 5 porque é serverless" sem revisar o motivo.
Ação: qualquer levantamento de código pra decisão de migração deve ser feito em `origin/main` (ou depois de um `git pull`), não no checkout local como estava antes desta sessão.

### 4. `.env.vercel.erp-itp` sem `.gitignore` — corrigido
Arquivo na raiz do repo (`C:\Users\gonca\erp_itp\.env.vercel.erp-itp`), 33 variáveis, incluindo `DATABASE_URL` (senha real do Neon), `JWT_SECRET`, `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `VERCEL_OIDC_TOKEN` — todos com valores reais, não placeholders. `git check-ignore -v` não retornava match algum antes da correção; `git status --porcelain` mostrava `??` (untracked, nunca commitado, confirmado por `git log --all` vazio pro arquivo — não houve vazamento, só exposição de risco). Corrigido: adicionada a linha `.env.vercel*` em `C:\Users\gonca\erp_itp\.gitignore` (após a seção "Produção"), revalidado com `git check-ignore -v .env.vercel.erp-itp` → agora casa com a regra. `.env.local` (mesma pasta, mesmos segredos reais) já estava coberto por `.env*.local` — esse não tinha risco.

### 5. Crons da Vercel sem equivalente em App Service
`apps/backend/vercel.json`:
```json
"crons": [
  { "path": "/api/auth/cron/verificar-senhas", "schedule": "0 8 * * *" },
  { "path": "/api/supabase/cron/health-check", "schedule": "30 8 * * *" }
]
```
Ambos protegidos por `CRON_SECRET` comparado contra o header `Authorization: Bearer` (convenção da Vercel Cron) ou `x-cron-secret` (fallback já existente no código, `auth.controller.ts:100-113`; mesmo padrão em `supabase.controller.ts:33`). App Service não dispara cron sozinho — precisa de Azure Logic App (schedule trigger fazendo `GET` com o header `x-cron-secret`) ou Azure Function Timer separada. Ação concreta a acrescentar na Fase 3 do plano: provisionar 1 Logic App (ou equivalente) por cron antes do cutover, testando contra o slot `staging`.
Existe um **terceiro** endpoint protegido pelo mesmo `CRON_SECRET` em `captacao.controller.ts:261` que **não está** na lista de crons do `vercel.json` — parece disparo manual ou cron órfão; confirmar com quem mantém antes de decidir se precisa de agendamento no Azure também.

### 6. Scripts Google Apps Script com domínio hardcoded, fora do deploy do repo
`google-apps-script/formulario-candidato.gs:17` e `formulario-funcionario.gs:18` chamam `https://api.itp.institutotiapretinha.org/api/...` diretamente (via `UrlFetchApp`, servidor-a-servidor, não passa por CORS do browser). Esses `.gs` vivem como Apps Script Projects dentro do Google Drive/Forms do Instituto, **não são deployados pelo pipeline do repo** — atualizar a URL da API no cutover exige abrir cada script manualmente no editor do Google Apps Script. Fácil de esquecer porque não aparece em nenhum `grep` de CI/CD.

---

## Achados de atenção

### Banco de dados
- Postgres **17.11** no Neon (não 16 como o `docker-compose` supostamente usaria — plano assume paridade com "postgres:16-alpine"; aqui é a versão real do Neon, superior). Ao provisionar o Flexible Server, usar Postgres 17 se disponível na região, ou confirmar que 16 é compatível (não há uso de feature exclusiva de 17 identificado na checagem de extensões/schema).
- Tamanho real: 20 MB — bate com o levantado no design doc.
- 67 tabelas, 40 FKs, 110 índices em `public`.
- Extensões: `plpgsql`, `pgcrypto`, `uuid-ossp` (padrão, disponíveis no Azure Flexible Server), e **`pg_session_jwt`** (schema `auth`, funções `auth.jwt()`/`auth.uid()`/etc.) — **extensão proprietária do Neon** (parte do Neon Data API / RLS nativo), que **não existe no Azure Database for PostgreSQL**. Confirmar antes do `pg_dump`: o app usa JWT próprio (`@nestjs/jwt` + `passport-jwt`, `JWT_SECRET` custom) e não há nenhuma referência a `auth.jwt()`/`auth.uid()` no código do backend — é scaffolding do Neon, não usado pela aplicação (mesmo achado de `neon_auth` já documentado no `aprxm_sys`). `pg_dump --format=custom` provavelmente tenta exportar a extensão; se der erro no `pg_restore` no Azure, é seguro pular/ignorar (`--exclude-schema=auth` ou similar) — não é usado por nenhuma rota do backend.
- Roles `anonymous`/`authenticated`/`authenticator`/`neon_auth`/`neon_superuser` — todos provisionados automaticamente pelo Neon, não referenciados no código da aplicação (a app conecta como `neondb_owner`). Não precisam de equivalente no Azure.
- `_schema_version` mostra apenas 1 linha (versão atual = 20). Não há histórico de quais blocos já rodaram individualmente — se um `pg_restore` no Azure recriar o schema já em v20, a aplicação vai pular todas as migrations automáticas no boot (comportamento correto), mas **não há como auditar reversamente se algum bloco falhou silenciamente no passado** — o `catch` do `runMigrations()` (`app.module.ts:1539-1541`) só loga erro, não impede o boot nem marca falha; se algum `ALTER`/`CREATE` no meio dos ~1400 linhas falhar (ex.: por causa de um dado inconsistente), a versão nunca é gravada e o bloco inteiro tenta rodar de novo no próximo boot — favorável para retry, mas quer dizer que "versão 20 aplicada" não é garantia formal de que 100% das declarações rodaram sem erro pontual undetected caso algum `ALTER` tenha um "IF NOT EXISTS" mas outro não.

### TypeORM / migrations
- `synchronize: false` — confirmado, sem risco de alteração automática de schema.
- Pool: `retryAttempts: 10`, `retryDelay: 3000` (30s de tentativas) + `connect_timeout=15` na connection string — tudo dimensionado para o cold-start do Neon serverless. Em Azure Flexible Server (always-on, sem cold start) isso é inofensivo mas desnecessário; não precisa remover, só não é mais o gargalo relevante.
- `ssl: { rejectUnauthorized: false }` (`app.module.ts:99-101`) mesmo normalizando `sslmode` pra `verify-full` na URL — os dois se contradizem: `rejectUnauthorized: false` desliga a validação do certificado do servidor independente do que a URL pedir. Funciona hoje porque o Neon aceita; **no Azure Flexible Server (TLS obrigatório, conforme a spec)** o ideal é trocar para `rejectUnauthorized: true` com o CA correto (Azure disponibiliza o certificado raiz) — ponto de hardening a fazer durante a Fase 3, não bloqueante para o basic funcionamento (Azure aceita conexão mesmo com `rejectUnauthorized:false`), mas contraria a recomendação de TLS da própria spec de migração.

### Vercel — projetos, env vars, runtime
- Projetos confirmados no time `itp-aprxm`: `itp-erp-backend` (prod `https://itp-erp-backend.vercel.app`) e `itp-erp-frontend` (prod `https://itp-erp-frontend.vercel.app`), ambos **Node 24.x** — runtime detectado automaticamente pela Vercel (**não há `engines` no `package.json` nem `.nvmrc`** em nenhum dos 3 `package.json` do monorepo — raiz, backend, frontend). O plano especifica App Service Linux **Node 20**. Duas ações antes do deploy: (1) confirmar no portal Azure se a stack Node disponível pra App Service Linux na região inclui 20/22 LTS (Node 24 não é LTS e pode não estar na lista de runtimes do App Service); (2) já que nada fixa a versão hoje, rodar a suíte de build+testes localmente com Node 20 antes do primeiro deploy no slot staging, para pegar qualquer sintaxe/API exclusiva de versões mais novas do Node.
- Env vars **backend** (`itp-erp-backend`, todas `Production`, `Encrypted`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET`, `WEKHOOK_SECRET` (nome com typo — grep no código não encontrou nenhuma leitura desse nome; parece órfã/legada), `SMTP_USER`, `SMTP_PORT`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_FROM`, `JWT_SECRET`, `DATABASE_URL`, `CRON_SECRET`, `COLETOR_TOKEN`, `APP_URL`.
- Env vars **frontend** (`itp-erp-frontend`, todas `Production`, `Encrypted`): `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET`, `SUPABASE_URL`, `APP_URL`, `BACKEND_INTERNAL_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NODE_ENV`, `NEXT_PUBLIC_COLETOR_TOKEN`, `NEXT_PUBLIC_API_URL`, `JWT_SECRET`, `DATABASE_URL` — os 2 últimos (`JWT_SECRET`, `DATABASE_URL`) **não têm nenhuma referência** no código do frontend (`grep` em `apps/frontend/src` por `DATABASE_URL|jwt.verify|jsonwebtoken|DataSource|new Pool` = 0 arquivos) — parecem cópia acidental do `.env` do backend, não precisam ser replicados nas Application Settings do App Service do frontend.
- Não há domínio customizado direto no projeto `itp-erp-backend` fora do que já é sabido (`api.itp.institutotiapretinha.org`); confirmado via `vercel domains inspect` (seção "Projects").
- `vercel.json` do backend também define um `route` de redirect na raiz (`/` → `https://api.itp.institutotiapretinha.org/api`, 308) — outro lugar com domínio hardcoded a revisar no cutover.
- `vercel.json` do backend embute `COLETOR_TOKEN`/`CHAMADA_TOKEN` como texto plano no `env` do arquivo (committado no git, não são segredo forte — são tokens fixos de dispositivo, ex. coletor de código de barras/chamada de presença), então já estão no histórico do repo independente da migração; ao portar para Application Settings do Azure, considerar gerar valores novos via Key Vault se quiser reduzir a superfície (não bloqueante).

### Logs recentes
`vercel logs` só oferece **tail ao vivo** (sem consulta histórica via CLI no plano atual); duas janelas de ~45s em cada projeto (backend e frontend) não capturaram nenhuma requisição (uso baixo, ~7 usuários/dia). **Inconclusivo** — recomendo checar a aba Observability/Runtime Logs do dashboard Vercel (que mantém histórico) antes do cutover, filtrando por status ≥500, em vez de confiar nesta amostragem.

### CORS e domínios hardcoded — lista completa encontrada
| Arquivo | Linha(s) | O que hardcoda |
|---|---|---|
| `apps/backend/src/main.ts` | 36-40 | Array CORS: `itp.institutotiapretinha.org`, `api.itp.institutotiapretinha.org`, `institutotiapretinha.org` |
| `apps/backend/api/main.ts` | 91-95 | Mesmo array CORS (cópia, já podendo divergir da de `src/main.ts`) |
| `apps/backend/api/main.ts` | 163, 174 | `CORS_ORIGIN = 'https://institutotiapretinha.org'` — usado só no fast-path do preflight `OPTIONS` (linha 173-181), **não inclui os subdomínios `itp.`/`api.itp.`** |
| `apps/backend/vercel.json` | 22-32, 44-54 | Headers/rota de `OPTIONS` com `Access-Control-Allow-Origin: https://institutotiapretinha.org` fixo (mesma limitação do item acima) |
| `apps/backend/vercel.json` | 34-38 | Redirect da raiz (`/`) pra `https://api.itp.institutotiapretinha.org/api` |
| `apps/frontend/vercel.json` | 6-7 | `BACKEND_INTERNAL_URL`/`APP_URL` como env fixo no arquivo |
| `apps/frontend/next.config.mjs` | 17-27 | Fallback de `BACKEND_INTERNAL_URL` pra `https://api.itp.institutotiapretinha.org` quando a env var não está setada |
| `google-apps-script/formulario-candidato.gs` | 17, 209 | URL da API de inscrição + link de retorno |
| `google-apps-script/formulario-funcionario.gs` | 18, 211, 242 | URL do webhook + links de retorno pro frontend |

### Sessão/auth
- Login via **cookie** `itp_token` (`httpOnly`, `secure: NODE_ENV==='production'`, `sameSite: 'strict'`, sem `domain` explícito — host-only), setado em `auth.controller.ts:26-36`. `Authorization: Bearer` também é aceito nas rotas (JWT strategy padrão do `passport-jwt`), então há dois mecanismos coexistindo.
- **Arquitetura real evita o problema de cookie cross-site em produção**: o Next.js (`next.config.mjs:17-27`) faz *rewrite* server-to-server de `/backend-api/*` pro backend (`BACKEND_INTERNAL_URL`) — o browser só fala com `itp.institutotiapretinha.org`, nunca diretamente com `api.itp.institutotiapretinha.org`. Confirmado por `grep` no frontend: nenhum arquivo usa `NEXT_PUBLIC_API_URL` (só existe na env, não é lido pelo código) e nenhuma página faz fetch direto pro domínio `api.`. Isso significa que o cookie, na prática, é sempre "same-site" hoje.
- **Isso quebra especificamente durante a validação em `*.azurewebsites.net`** (item já sinalizado de forma genérica no plano, §Validação item 3 — aqui está o mecanismo exato): `azurewebsites.net` está na Public Suffix List, então `app-erpitp-frontend.azurewebsites.net` e `app-erpitp-backend.azurewebsites.net` são **sites diferentes** aos olhos do browser (ao contrário de `itp.` e `api.itp.institutotiapretinha.org`, que compartilham o registrable domain `institutotiapretinha.org`). Se o teste em staging for feito com o frontend chamando o backend via `BACKEND_INTERNAL_URL` apontando pro backend do Azure (mantendo o proxy Next.js), o cookie continua same-site normalmente — **o problema só aparece se alguém testar/chamar a API do Azure diretamente do browser** (Swagger, Postman com cookie, ou um cliente que não passe pelo proxy). Ação: manter o padrão de proxy também nos testes de staging; não testar login via chamada direta do browser pro domínio `*.azurewebsites.net` do backend.
- Login aceita `email` **ou** `matricula` como identificador (`auth.controller.ts:20-21`) — não muda nada pra migração, só documentando o fluxo real encontrado.

### Runtime / Node
- Sem `engines` em nenhum `package.json`, sem `.nvmrc` — Vercel resolveu para Node 24.x por padrão. Ver achado de atenção acima (seção Vercel).
- `apps/backend/src/common/suppress-known-warnings.ts` silencia especificamente `DEP0169` (uso interno de `url.parse()` pelo Express) — inofensivo, não afeta Node 20.

### Integrações externas confirmadas
| Integração | Onde | Uso | Allowlist de IP? |
|---|---|---|---|
| `@anthropic-ai/sdk` (dependência) | **Nenhum uso encontrado** em `apps/backend/src` (grep vazio) | Dependência presente no `package.json` mas não importada em nenhum arquivo de produção — parece não utilizada atualmente ou usada só em script solto fora do `src/` | N/A |
| Google Gemini (API nativa) + OpenRouter + Tavily | `apps/backend/src/captacao/gemini.service.ts` | Busca de oportunidades de captação de recursos (`GEMINI_API_KEY`, `TAVILY_API_KEY`, referências a `OPENROUTER_...`) | Saída apenas (API pública por chave), sem allowlist necessário. **Porém: nenhuma dessas 3 chaves aparece em `vercel env ls` do projeto backend** — a feature de captação por IA parece estar sem credenciais em produção hoje (rodando em modo degradado ou desabilitado); confirmar com o time antes de assumir que está ativa. |
| Supabase Storage | `apps/backend/src/modules/supabase/`, usado por `academico`, `alunos`, `auth`, `funcionarios`, `gente`, `matriculas`, `projetos` | Storage de arquivos/documentos — **erp_itp também usa Supabase Storage**, não só `aprxm_sys` como o design doc registrou. Precisa entrar no escopo de migração de storage (Supabase → Azure Blob) mencionado na Fase 2.5, mas para um **segundo bucket/projeto Supabase** (`SUPABASE_URL`/`SUPABASE_BUCKET` do erp_itp, valor real não extraído — mascarado nesta checagem). Verificar se é o mesmo projeto Supabase do `aprxm_sys` ou um projeto separado antes de planejar a migração de storage. |
| SMTP (Nodemailer) | `apps/backend/src/email.service.ts` | Envio de e-mail (lembrete de senha, LGPD, etc.) — `SMTP_HOST/PORT/USER/PASS/FROM` | Se o SMTP provider (ex. Gmail/SendGrid) exigir allowlist de IP de origem, o IP de saída do App Service muda em relação à Vercel — validar antes do cutover. |
| Google Apps Script (Forms) → API | `google-apps-script/*.gs` | Webhooks de formulário de candidato/funcionário chamando a API | Chamada é feita pelo Google (IP dinâmico da infra do Apps Script) — sem allowlist hoje, nada muda na migração exceto a URL hardcoded (achado crítico #6). |
| WhatsApp / gateway de pagamento / boleto | — | **Nenhuma integração externa encontrada.** As entidades `boleto`/`boleto_parcelas`/`forma-pagamento` são módulos internos do financeiro (`financeiro.module.ts`), sem chamada a gateway externo (grep por `stripe/mercadopago/pagseguro/twilio/whatsapp` = 0 resultados em `apps/backend/src`). | N/A |

---

## Achados informativos

- Pasta `apps/backend/src/migrations/` com 1 arquivo órfão (ver achado crítico sobre migrations) — pode ser removida ou documentada como histórico morto, mesmo tratamento dado a `database/migrations/` no `aprxm_sys`.
- `WEKHOOK_SECRET` (env var com typo, produção) não é lido em nenhum lugar do código atual — provavelmente resquício de uma feature removida ou renomeada para `CRON_SECRET`. Sem risco, mas pode ser removida do Vercel/Key Vault ao portar.
- `apps/backend/api/health.ts` é um health-check mínimo (não passa pelo NestJS, responde direto com `hasDatabase`/`hasJwt`/`nodeVersion`) — bom candidato a reaproveitar como probe de saúde do App Service/slot `staging`, já existe e é barato.
- Cookie `itp_token` tem `maxAge` de 30 dias (com "lembrar") ou 8h — sem relação com a migração, só contexto de sessão pra quem for testar login em staging.
- `.env.local` da raiz do repo (não é o `.env.local` do Next.js, é um pull antigo da Vercel CLI, `environment:development` conforme o `VERCEL_OIDC_TOKEN`) aponta pro **mesmo** `DATABASE_URL` de produção (`ep-wispy-tooth...`) — não há banco de desenvolvimento separado; dev local mexe no mesmo Neon usado em produção hoje. Não é um problema introduzido pela migração, mas vale considerar aproveitar a migração para criar um banco de dev/staging separado no Azure (o plano já cria banco de staging implicitamente via slot, mas o slot `staging` do App Service, se apontar pro mesmo Postgres de produção — que é o que o plano descreve — mantém esse mesmo padrão de "sem isolamento de dev/staging real", só troca onde o dado mora).

---

## Resumo de ações a incorporar no plano (Fase 3)

1. Decidir explicitamente `src/main.ts` vs `api/main.ts` como base do App Service; se for o segundo, remover payload-guard/timeout de serverless antes de portar.
2. Migrar nameservers de `institutotiapretinha.org` para fora da Vercel **antes** da Fase 1 (piloto), não durante a Fase 3 — evita repetir o mesmo obstáculo 3 vezes.
3. `git pull`/sincronizar com `origin/main` antes de qualquer trabalho de migração no repo local (8 commits de diferença hoje).
4. Provisionar scheduler externo (Logic App) pros 2 crons + confirmar se o 3º endpoint protegido por `CRON_SECRET` (`captacao.controller.ts:261`) precisa de agendamento também.
5. Atualizar manualmente os 2 scripts `.gs` no Google Apps Script Editor no dia do cutover (não fazem parte do deploy automatizado).
6. Confirmar disponibilidade de Node 20/22 (não 24) no App Service Linux da região antes de criar o recurso; testar build com Node 20 localmente primeiro.
7. Ao restaurar o dump do Neon no Azure Flexible Server, esperar/ignorar erro relacionado à extensão `pg_session_jwt`/schema `auth` (não usada pela aplicação) — não é motivo para investigar further.
8. Trocar `ssl: { rejectUnauthorized: false }` por validação real de certificado (`rejectUnauthorized: true` + CA da Azure) como parte do hardening de TLS já previsto na spec.
9. Confirmar com o time se a integração de captação via Gemini/Tavily está de fato ativa (nenhuma das 3 chaves está no Vercel hoje) antes de decidir se entra no escopo de portar.
10. Confirmar se o Supabase Storage do erp_itp é o mesmo projeto do `aprxm_sys` ou outro, antes de desenhar a Fase de storage.
