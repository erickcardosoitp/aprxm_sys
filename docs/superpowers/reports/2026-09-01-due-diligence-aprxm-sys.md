# Due diligence — aprxm_sys pré-migração Azure

**Data:** 2026-09-01 · Escopo: levantamento read-only do `aprxm_sys` (backend FastAPI +
4 frontends Vite) antes da execução das Fases 2 do
[plano de migração Azure](../plans/2026-09-01-migracao-azure-plan.md). Nenhuma alteração
feita em código, banco ou configuração — só leitura via `psql`, Vercel CLI e grep no repo.

---

## Achados críticos (bloqueiam migração se não resolvidos)

### 1. Cron jobs da Vercel não têm equivalente nativo no App Service

`backend/vercel.json` define **8 crons** batendo em endpoints HTTP autenticados por
`CRON_SECRET` (header, não JWT):

| Endpoint | Schedule (UTC) |
|---|---|
| `/api/v1/demands/reminders/trigger` | `0 11 * * *` |
| `/api/v1/daily-tasks/reminders/trigger` | `0 10 * * *` |
| `/api/v1/mensalidades/cron-generate` | `0 8 1 * *` |
| `/api/v1/mensalidades/cron-check-overdue` | `0 9 * * *` |
| `/api/v1/datalake/run` | `0 12 * * *` e `0 20 * * *` (ETL, 2x/dia) |
| `/api/v1/ti/vacuum` | `0 3 * * 0` (faxina semanal de `api_request_logs`, ver achado #2) |
| `/api/v1/crm/cron-scoring` | `0 6 * * *` |

Azure App Service **não tem cron nativo**. Nem o plano (`2026-09-01-migracao-azure-plan.md`)
nem o design (`2026-09-01-migracao-azure-design.md`) endereçam essa lacuna — a Fase 2.2
do plano assume só "Application settings + slot staging", sem mencionar os 8 crons.
Sem substituto, mensalidade para de gerar (`cron-generate`, mensal) e vencer
(`cron-check-overdue`, diário), o ETL do DW para de rodar (achado direto pro escopo da
Fase 2.6) e `api_request_logs` volta a crescer sem limite.

**Ação necessária antes do cutover da Fase 2:** decidir e provisionar substituto —
opções compatíveis com "sem IaC, portal manual": **Azure Logic App** (trigger Recurrence +
ação HTTP com o header `CRON_SECRET`) é a mais simples de replicar 1:1 no portal;
alternativa é **Azure Functions (Timer Trigger)** se preferir código. Ambas precisam ser
criadas e testadas contra o slot `staging` antes do swap de cada endpoint depender de
schedule.

### 2. `api_request_logs` domina o tamanho do banco operacional e depende do cron acima

Medido via `psql` direto (`ep-rough-tooth-an10po6b`, `SELECT pg_size_pretty(...)`):

- Banco operacional total: **89 MB**
- `api_request_logs`: **53 MB / ~156.550 linhas** — **60% do banco**, de longe a maior tabela
  (segunda maior, `packages`, é 10 MB)
- `pg_stat_user_tables.n_live_tup` = 163.804; `last_vacuum` (manual) = nunca rodou,
  só `last_autovacuum` (2026-08-27)

Existe retenção: `backend/app/routers/ti.py:611` roda
`DELETE FROM api_request_logs WHERE created_at < NOW() - INTERVAL '7 days'` dentro do
handler `/ti/vacuum` (cron semanal, achado #1). O volume atual (~22k linhas/dia) é
consistente com 7 dias de retenção funcionando — **mas essa faxina depende inteiramente
do cron sobreviver à migração**. Sem o Logic App/Functions do achado #1, a tabela cresce
indefinidamente e passa a dominar tempo de `pg_dump`/`pg_restore` e custo de storage do
`psql-aprxm-prod` (Burstable B1ms).

**Recomendação:** truncar/filtrar `api_request_logs` antes do `pg_dump` de produção (ela é
puramente operacional, sem valor de auditoria de longo prazo — `audit_log`, tabela
separada, já cobre isso) e confirmar que o substituto do cron de vacuum está no ar
**antes** do cutover de DNS da Fase 2.7, não depois.

### 3. Extensão `pg_session_jwt` é proprietária do Neon — sem grep de uso confirmado

`SELECT extname FROM pg_extension` no banco operacional retorna:
`plpgsql, pg_session_jwt, pgcrypto, pg_trgm, unaccent, fuzzystrmatch`.

`pg_trgm`, `unaccent`, `fuzzystrmatch` e `pgcrypto` são extensões padrão do PostgreSQL,
disponíveis no Azure Database for PostgreSQL Flexible Server. **`pg_session_jwt` é
específica do Neon** (parte do produto "Neon Auth") e não existe no Azure Flexible Server
— o `pg_restore`/`CREATE EXTENSION pg_session_jwt` vai falhar lá.

Grep em `backend/app/` não encontrou nenhuma referência a `pg_session_jwt` no código —
consistente com o achado do `ARQUITETURA.md` §5 de que o schema `neon_auth` (que essa
extensão serve) é lixo não usado, já parcialmente limpo em 2026-08-01. **Ação:** confirmar
que `DROP EXTENSION pg_session_jwt` (ou simplesmente excluir a extensão do dump via
`pg_dump --exclude-extension` / editar o dump antes do restore) não quebra nada, e não
tentar recriá-la no Azure — ela não vai instalar de qualquer forma.

### 4b. WebAuthn/passkey amarrado ao domínio `aprxm.vercel.app` — credenciais quebram na troca de domínio

`WEBAUTHN_RP_ID="aprxm.vercel.app"` e `WEBAUTHN_ORIGIN="https://aprxm.vercel.app"` (env vars
de produção do backend). Confirmado via `psql`: `webauthn_credentials` tem **4 credenciais
reais** cadastradas (não é tabela vazia/feature não usada). WebAuthn amarra a credencial ao
RP ID (domínio) no momento do registro — trocar o RP ID invalida as credenciais existentes,
forçando os 4 usuários a re-cadastrar o passkey; não tem migração de dado possível para
isso, é uma limitação do protocolo (FIDO2), não do código.

Isso importa mesmo se o app continuar em subdomínio "só Vercel-style": migrar o backend pro
Azure implica trocar `aprxm.vercel.app` por outro host (App Service `*.azurewebsites.net`
ou domínio próprio), então o RP ID muda de qualquer forma. **Ação:** avisar os 4 usuários
com passkey cadastrado que vão precisar re-registrar após o cutover da Fase 2.7, ou
providenciar um domínio customizado estável **antes** do cutover e já nascer com o RP ID
definitivo (evita precisar trocar de novo se decidir customizar o domínio depois).

### 4. Runtime Python real (`3.13`) diverge do documentado (`3.10`) e não está pinado na Vercel

`backend/Dockerfile:1` usa `FROM python:3.13-slim-bookworm` — mas `CLAUDE.md` e
`ARQUITETURA.md` documentam "Python 3.10". Não existe `runtime.txt` nem `engines` em
`backend/vercel.json` fixando a versão usada pelo builder `@vercel/python` em produção —
ou seja, a versão real rodando em `aprxm-sys-backend.vercel.app` **não está confirmada por
nenhum artefato do repo**, só o Dockerfile (usado só localmente via `docker-compose.yml`)
aponta 3.13.

**Ação antes de configurar o App Service (Fase 2.2, item 2 do plano — hoje diz "runtime
Python 3.10"):** confirmar a versão real do runtime Vercel em produção
(`vercel.json`/build log do Deployment Center, ou rodar `python --version` numa function
invocation) antes de escolher a stack do App Service. Azure App Service Linux suporta
Python 3.9 a 3.13 — se for de fato 3.13, o plano precisa trocar "Python 3.10" por
"Python 3.13" na Fase 2.2.

---

## Achados de atenção (não bloqueiam, mas precisam de ação no runbook)

### 5. Rewrite `/api/*` hardcoded por domínio Vercel em 3 dos 4 frontends

`frontend/vercel.json`, `presidencia/vercel.json` e `painel/vercel.json` têm o mesmo
padrão:

```json
{ "source": "/api/:path*", "destination": "https://aprxm-sys-backend.vercel.app/api/:path*" }
```

Isso não é env var — é hardcoded no `vercel.json` de cada app. `presidencia` e `painel`
**não têm nenhuma env var de API URL** (`vercel env ls` retornou "No Environment Variables
found" para os dois); a única forma de apontar pra API é editando esse rewrite. Ao migrar
o backend pro Azure (Fase 2.2), os 3 `vercel.json`/`staticwebapp.config.json` equivalentes
precisam ser atualizados manualmente e re-deployados — não é automático via env var, como
o plano parece assumir na Fase 2.3 (`VITE_API_URL`, que só existe pro frontend principal
— `presidencia`/`painel` não usam essa env var, usam o rewrite).

### 6. `aprxm-sys-frontend` tem `ANALYTICS_DATABASE_URL` configurada sem uso aparente

`vercel env ls` do projeto `aprxm-sys-frontend` (Vite/React estático) lista
`ANALYTICS_DATABASE_URL` como env var de produção — um frontend estático não deveria ter
connection string de banco. Grep em `frontend/src/` não é necessário pra concluir isso é
resíduo de configuração (Vite só expõe `VITE_*` no client bundle; uma connection string
não-`VITE_` fica inacessível ao build, então não é consumida, só ocupa um secret
desnecessário). **Ação:** não recriar essa env var no Azure Static Web App; se sobrar
tempo, remover da Vercel por higiene (fora do escopo desta due-diligence, só reportando).

### 7. `vercel logs` não retorna histórico em nenhum dos 4 projetos (limitação de plano)

Tentativas com `--since 7d`, `--since 24h`, `--level error`, por domínio e por deployment
ID (`dpl_53uzdA1hFmLF9ZwsjjjxhezgnWn9`) retornaram "No logs found" para os 4 projetos
(`aprxm-sys-backend`, `aprxm-sys-frontend`, `aprxm-presidencia`, `painel-aprxm`). Isso é
consistente com retenção de runtime logs muito curta (minutos/streaming only) no tier
usado pelo time `itp-aprxm` — **não foi possível auditar padrões de erro/warning
recorrentes pré-existentes** como pedido no ponto 4 do levantamento. Se precisar dessa
visibilidade antes do cutover, configurar um sink de logs (Vercel Log Drain, ou só
observar `audit_log`/`api_request_logs` do próprio banco) com antecedência — não vai dar
pra reconstruir histórico depois.

### 8. `simplifica-prototype/` confirmado sem deploy — sem `package.json`, sem `vercel.json`, sem link

`simplifica-prototype/` contém só um `index.html` solto (17 KB), sem `package.json` nem
`.vercel/`. Não é um projeto Vite buildável nem tem projeto Vercel associado em
`itp-aprxm`. Confirma o que a spec já assumia — **não entra em nenhuma fase da migração**,
não precisa de decisão adicional além de arquivar ou apagar quando alguém tiver certeza
que está morto.

### 9. Storage Supabase → Azure Blob: sem transformação de imagem a replicar, mas path scoping é lógica de aplicação

`backend/app/services/storage_service.py` faz upload direto (`client.storage.from_(bucket).upload(...)`)
sem nenhum resize/transform do lado do Supabase — a URL retornada
(`get_public_url`) é o arquivo original, sem parâmetros de transformação. Isso simplifica
a migração: não precisa de Azure equivalente pra "image pipeline", só trocar o SDK
(`azure-storage-blob` no lugar de `supabase`), como o plano já prevê na Fase 2.5.

Ponto que o plano **não menciona** e que é lógica de aplicação, não de infra: o método
`delete()` (linha 71-83) valida que o `storage_path` extraído da URL começa com
`{self._assoc}/` antes de remover — é o controle de isolamento multi-tenant do storage.
Ao reescrever pra Azure Blob SDK (Fase 2.5, item 4), essa validação de prefixo **precisa
ser preservada byte a byte**, não é detalhe de implementação descartável — é a única
barreira contra um usuário de uma associação apagar arquivo de outra.

Tipos aceitos (`backend/app/routers/uploads.py:9-20`): imagens (jpeg/png/webp/gif), PDF,
Word, Excel, CSV, texto — limite 10 MB genérico / 5 MB áudio (webm/ogg/mp4/mpeg/wav/aac).
Nenhum desses limites/tipos depende de feature específica do Supabase — replicam 1:1 como
validação de aplicação, independente do backend de storage.

### 10. `docker-compose.yml` ainda referencia Cloudinary — confirmado como resíduo morto, não risco de migração

`docker-compose.yml:31-34` define `STORAGE_PROVIDER` (default `cloudinary`) e
`CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` como env vars do container `backend` local.
Grep por `cloudinary` (case-insensitive) em `backend/app/**` não retornou nenhum arquivo —
**Cloudinary não é lido em lugar nenhum do código real**, é vestígio de uma versão
anterior do docker-compose. Confirma a suspeita do prompt original: o storage real é
100% Supabase (`storage_service.py`), CLAUDE.md está desatualizado nesse ponto específico
(já registrado como divergência no próprio `ARQUITETURA.md` §1, então não é achado novo,
só confirmação).

---

## Achados informativos

### Banco operacional (`aprxm` — `ep-rough-tooth-an10po6b`)

- `SELECT version()`: **PostgreSQL 16.15** (ARM/aarch64, gerenciado Neon)
- Tamanho: **89 MB**, 62 tabelas em `public` (ARQUITETURA.md cita 59 — pequena divergência,
  não investigada a fundo, provavelmente tabelas novas do ETL/CRM desde a última auditoria)
- Schemas extras: `analytics` (9 tabelas `dim_*`/`fact_*` em inglês — órfãs, confirmadas
  pelo plano de ETL como candidatas a `DROP SCHEMA analytics CASCADE` na Fase 4, ainda não
  executado), `neon_auth` (só `project_config` restante), `auth` (schema vazio, padrão
  Neon)
- Top 5 tabelas por tamanho: `api_request_logs` (53 MB / 156k linhas, ver achado #2),
  `packages` (10 MB / 7.144), `transactions` (3.1 MB / 4.711), `residents` (1.4 MB / 1.990),
  `mensalidades` (1.2 MB / 1.728)
- FKs sem índice: 91 (consistente com os "~79" citados em `ARQUITETURA.md §10`, número
  cresce com schema evoluindo — a maioria é `created_by`/`updated_by`, baixo risco)
- `pg_stat_statements` **não está instalada** — não foi possível levantar queries lentas
  reais; se precisar dessa visibilidade antes do cutover, habilitar a extensão com
  antecedência (não é possível reconstruir estatística histórica depois do fato)

### Banco DW/analytics gold (`aprxm-analytics` — `ep-floral-shadow-ap9n86vs`)

- **PostgreSQL 16.15**, mesmo storage engine do operacional
- Tamanho: **9,7 MB**, **42 tabelas** em `public`, todas nomeadas em português
  (`receita_diaria`, `taxa_cobranca`, `runway_financeiro`, etc.) — nenhuma tabela órfã
  `dim_*`/`fact_*` encontrada *neste* projeto (as órfãs estão no schema `analytics` do
  banco operacional, ver acima — achado do plano de ETL já estava correto)
- Única extensão instalada: `plpgsql` (nenhuma dependência proprietária de Neon aqui,
  ao contrário do banco operacional — migração deste banco é mais simples)
- Pipeline que popula esse banco: `backend/app/services/datalake_service.py` +
  `backend/app/routers/datalake.py`, disparado por 2 crons diários
  (`/api/v1/datalake/run`, 12h e 20h UTC) — **mesma dependência de cron do achado #1**.
  Endpoint aceita `POST /datalake/run/manual?force_full=true` autenticado por JWT admin
  como alternativa manual (não por `CRON_SECRET`), útil pra revalidar depois do corte de
  DNS da Fase 2.6 sem esperar o próximo horário agendado
- Env var atual: `settings.datawarehouse_aprxm_database_url` (lida em
  `backend/app/services/datalake_service.py:1833`) é o destino real e ativo hoje —
  `analytics_database_url` (`ANALYTICS_DATABASE_URL`) é **legado confirmado**, mantida só
  como comentário no `config.py:64-68` ("remover após Fase 4"), não é mais lida por
  `_write_gold_sync`/`load_gold_to_analytics`. Isso já corrige uma imprecisão do
  `2026-09-01-migracao-azure-design.md` (que ainda cita `ANALYTICS_DATABASE_URL` como a
  var relevante para o ETL na seção de Storage) e do plano (Fase 2.2, item 5, mesma
  menção) — a var que precisa ser atualizada na Fase 2.6 do plano é
  **`DATAWAREHOUSE_APRXM_DATABASE_URL`**, não `ANALYTICS_DATABASE_URL`.

### Vercel — 4 projetos confirmados no time `itp-aprxm`

| Projeto | URL produção | Env vars (nomes) |
|---|---|---|
| `aprxm-sys-backend` | `aprxm-sys-backend.vercel.app` | `DATAWAREHOUSE_APRXM_DATABASE_URL`, `PAINEL_SECRET_KEY`, `GROQ_API_KEY`, `DATABASE_URL`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `ALLOWED_ORIGINS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_SERVICE_KEY`, `SECRET_KEY`, `REFRESH_TOKEN_EXPIRE_DAYS`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `DELIVERY_FEE_DEFAULT`, `CRON_SECRET`, `APP_ENV`, `ANALYTICS_DATABASE_URL` (legado), `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES` (24 vars) |
| `aprxm-sys-frontend` | `aprxm.vercel.app` | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `ANALYTICS_DATABASE_URL` (residual, ver achado #6) |
| `aprxm-presidencia` | `aprxm-dash-prd.vercel.app` | nenhuma (aponta pra API via rewrite hardcoded, achado #5) |
| `painel-aprxm` | `painel-aprxm.vercel.app` | nenhuma (idem) |

Nenhum valor de secret foi colado neste relatório — só nomes. Runtime Node reportado por
`vercel projects ls` é **24.x** para todos os 8 projetos do time (não é o runtime real do
backend Python, é só o Node usado pelo build step da Vercel).

Domínios customizados do time (`vercel domains ls`): `institutotiapretinha.org` (Vercel
registrar, expira fev/2027) e `aprxm-dash.prd` (registrar terceiro). **`aprxm-dash.prd`
está com DNS mal configurado hoje** — `vercel domains inspect aprxm-dash.prd` retorna
`WARN! This Domain is not configured properly` (falta o registro `A aprxm-dash.prd
76.76.21.21` ou apontar os nameservers pra Vercel); apesar disso, o alias
`aprxm-presidencia...vercel.app → aprxm-dash-prd.vercel.app` existe e a presidência
provavelmente acessa via `aprxm-dash-prd.vercel.app` direto, não via `aprxm-dash.prd`. Não
é bloqueante pra migração (domínio já não funciona hoje), mas remove a suposição de que
existe um domínio custom real e funcional para `aprxm-presidencia` — reforça a recomendação
da Fase 1 de confirmar com o usuário qual é de fato o domínio em uso antes de planejar
cutover de DNS pra esse app. Nenhum domínio
customizado próprio encontrado para `aprxm-sys-backend`/`aprxm-sys-frontend`/`painel-aprxm`
além dos subdomínios `*.vercel.app` — ou seja, o corte de DNS da Fase 2.7 do plano só se
aplica de fato a `institutotiapretinha.org` (site institucional, fora do escopo deste
sistema) e potencialmente a `aprxm-dash.prd` se for o domínio real usado pela presidência;
confirmar com o usuário se os demais apps (`aprxm.vercel.app`, `painel-aprxm.vercel.app`,
`aprxm-sys-backend.vercel.app`) rodam mesmo só no subdomínio `.vercel.app` em uso hoje ou
se há domínio próprio não cadastrado como "Domain" no time (ex.: CNAME externo apontando
pra cá sem registro correspondente visível via `vercel domains ls`).

`vercel crons ls` não é um comando reconhecido nesta versão da CLI (50.22.1) — os crons
só são visíveis via o `vercel.json` do repo (achado #1), não há uma segunda fonte de
verdade a checar.

### Integrações externas — mapeamento completo

Grep em `backend/app/` (case-insensitive) por termos de gateway de pagamento, boleto,
SMS, WhatsApp e provedores de e-mail transacional (`sendgrid`, `resend`, `twilio`,
`pagar.me`, `asaas`):

- **Nenhuma integração de pagamento/boleto/SMS/WhatsApp encontrada.** Consistente com
  `ARQUITETURA.md §4`: `contas_pagar` tem 0 linhas em produção (feature construída, nunca
  lançada) e não há gateway de cobrança automatizado no código.
- **E-mail:** `backend/app/services/email_service.py` usa `smtplib` genérico
  (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`, via `starttls`) — não é
  SendGrid/Resend, é um servidor SMTP qualquer configurado por env var. **Nenhuma dessas
  env vars apareceu na lista do `vercel env ls`** do backend (achado a confirmar: talvez
  e-mail transacional esteja de fato desativado em produção hoje — `send_email()` já
  retorna cedo/no-op se `smtp_user`/`smtp_password` não estiverem setados, linha 13-14 —
  ou as vars têm outro nome não capturado pelo grep). Sem allowlist de IP conhecida
  (SMTP genérico não costuma exigir).
- **Cloudflare R2** (`boto3`, `datalake_service.py:117-119`, endpoint
  `https://{account_id}.r2.cloudflarestorage.com`): usado só pro data lake
  bronze/silver/gold (não é storage de mídia — isso é Supabase). Autenticação via
  access key/secret (S3-compatible), sem allowlist de IP documentada no código nem
  esperada nesse tipo de API (chave é a barreira, não IP de origem) — baixo risco de
  quebra na troca Vercel→Azure.
- **Supabase Storage:** mesma observação — auth via `SUPABASE_SERVICE_KEY` (service role
  key), sem allowlist de IP no client, sem indício no código de restrição de rede
  configurada no lado do Supabase (não verificável via código, só via painel Supabase,
  fora do escopo desta due-diligence read-only do repo).

### Runtime — frontends (Node/framework)

Nenhum dos 3 `package.json` (`frontend/`, `presidencia/`, `painel/`) define campo
`"engines"` — a versão de Node usada no build fica a critério do que o pipeline (Vercel
hoje, Azure Static Web Apps depois) escolher por padrão. Frameworks:

| App | React | Vite | TypeScript |
|---|---|---|---|
| `frontend/` | ^18.3.1 | ^5.2.12 | ^5.4.5 |
| `presidencia/` | ^19.2.7 | ^8.1.1 | ~6.0.2 |
| `painel/` | ^19.2.7 | ^8.1.1 | ~6.0.2 |

Vite 5 (frontend) e Vite 8 (presidencia/painel) são ambos suportados por Node LTS atual —
sem incompatibilidade conhecida com Azure Static Web Apps (build presets Vite genérico,
como o plano já assume na Fase 1/2.3).

---

## Limitações desta due-diligence

1. **`vercel logs` não retornou histórico** nos 4 projetos (achado #7) — não foi possível
   cumprir o ponto 4 do levantamento original (padrões de erro recorrentes). Recomenda-se
   configurar um Log Drain ou monitorar `api_request_logs`/`audit_log` diretamente via
   `psql` se essa visibilidade for necessária antes do cutover.
2. **`pg_stat_statements` não instalada** no banco operacional — não foi possível levantar
   top queries lentas reais (ponto 1 do levantamento).
3. **Restrições de rede do Supabase** (allowlist de IP, se houver) só são visíveis pelo
   painel do Supabase, não pelo código do repo — não verificado.
4. **Versão real do runtime Python em produção na Vercel** não confirmada por nenhum
   artefato do repo (achado #4) — só inferida do Dockerfile local (3.13), que diverge do
   documentado (3.10). Precisa confirmação direta (build log do Deployment Center ou
   introspecção em runtime) antes de fixar a versão do App Service.
5. Não foi possível confirmar se `institutotiapretinha.org`/`aprxm-dash.prd` são os únicos
   domínios de produção reais para os 4 apps deste sistema, ou se há CNAME externo
   apontando pra Vercel sem registro correspondente em `vercel domains ls` — checar direto
   no provedor de DNS do instituto antes de fechar a lista de domínios a cortar na Fase 2.7.
