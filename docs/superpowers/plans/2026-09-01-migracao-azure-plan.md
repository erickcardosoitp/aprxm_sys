# Plano de implementação — Migração ITP para Azure

Spec: [2026-09-01-migracao-azure-design.md](../specs/2026-09-01-migracao-azure-design.md)

Execução manual pelo Portal Azure (sem CLI/IaC). Subscription do grant
nonprofit já ativa. 3 fases em ordem — cada fase só começa depois da anterior
validada e cortada.

---

## Fase 0 — Preparação (uma vez só)

1. Portal Azure → **Resource groups** → **Create** → nome `rg-itp-prod`,
   região **Brazil South**.
2. Portal Azure → **Cost Management + Billing** → confirmar que a
   subscription do grant tem o teto de US$ 166/mês visível e alertas de
   orçamento configurados (Budget: 50%, 80%, 100% do teto).
3. **Key Vault** → Create → nome `kv-itp-prod`, mesmo Resource Group/região.
   Vai guardar `DATABASE_URL`, `JWT_SECRET`, chaves Cloudinary de cada
   sistema (segredos entram aqui na Fase 2/3, ao configurar cada app).

Critério de saída: Resource Group + Key Vault existem, orçamento configurado.

---

## Fase 0.5 — Migrar DNS pra fora da Vercel (uma vez só, antes da Fase 1)

Confirmado nos 2 levantamentos (website e erp_itp): `institutotiapretinha.org`
é registrado **e** tem DNS hospedado na própria Vercel (registrador Vercel,
nameservers `ns1/ns2.vercel-dns.com`, domínio expira 20/02/2027). Não existe
"provedor de DNS externo" pra trocar um CNAME — a Vercel é o provedor hoje.

Duas rotas possíveis: (a) migrar nameservers pra fora da Vercel uma vez,
antes de qualquer corte, e depois gerenciar cada subdomínio à vontade; (b)
manter DNS na Vercel e criar registro por registro no painel dela a cada
fase. **Escolhido: (a)** — evita depender do painel de DNS de terceiro
durante 3 cortes separados e reduz a superfície de erro pra uma mudança em
vez de três.

1. **Exportar a zona DNS completa atual** antes de tocar em qualquer coisa —
   Portal Vercel → domínio `institutotiapretinha.org` → DNS Records. Anotar
   TODOS os registros (MX de e-mail, TXT de SPF/DKIM/verificação, os
   CNAME/A existentes de cada sistema) — perder um registro de e-mail no
   meio da troca de nameserver derruba e-mail do instituto inteiro, não só
   os sites.
2. **Azure DNS** → Create DNS zone → `institutotiapretinha.org`, mesmo
   Resource Group `rg-itp-prod`. Recriar manualmente cada registro
   exportado no passo 1.
3. No painel da Vercel (Domains → `institutotiapretinha.org` →
   Nameservers), trocar pros nameservers que o Azure DNS gerar. Propagação
   pode levar até algumas horas — fazer isso num horário de baixo uso, **de
   véspera** da Fase 1, não no mesmo dia do primeiro cutover de app.
4. Validar com `nslookup`/`dig` que a zona responde certo pelos nameservers
   novos antes de prosseguir pra Fase 1.

Onde as fases abaixo dizem "trocar CNAME de produção" / "criar registro no
painel DNS da Vercel", ler como "criar/editar o registro na zona Azure DNS".

---

## Fase 1 — Piloto: website_tia_pretinha

Sem banco, sem backend — objetivo é validar o pipeline de deploy/DNS com o
menor risco antes de mexer em sistemas com dados.

1. **Static Web Apps** → Create:
   - Resource group: `rg-itp-prod`
   - Nome: `swa-website-itp`
   - Plano: **Free**
   - Fonte: GitHub → repo `website_tia_pretinha`, branch `main`
   - Build presets: **Vite** (build command `vite build` / output `dist`,
     conforme `vercel.json` atual)
   - Isso já cria o workflow do GitHub Actions automaticamente no repo.
2. Aguardar o primeiro deploy automático, testar em
   `https://<gerado>.azurestaticapps.net` — navegar no site, checar
   `/inscricao` (redirect existente no `vercel.json`) e rotas SPA (rewrite
   pra `index.html`, replicar no `staticwebapp.config.json` se o Azure não
   aplicar sozinho o rewrite do `vercel.json`).
3. **Custom domain**: Static Web App → Custom domains → adicionar o domínio
   do site. Gera um CNAME/TXT pra validar — configurar no provedor de DNS,
   TTL baixo (300s) definido com antecedência.
4. Validar HTTPS automático (Azure emite certificado free).
5. **Cutover**: apontar o domínio de produção pro Azure (trocar o CNAME que
   hoje aponta pra Vercel). Esperar propagação, testar produção.
6. Manter o projeto na Vercel intacto por 1-2 semanas antes de remover.

Critério de saída: site em produção servido pelo Azure, Vercel como fallback
não removido ainda.

**Rollback**: reverter o CNAME de DNS pra Vercel (TTL baixo já garante
propagação rápida).

---

## Fase 2 — aprxm_sys

### 2.1 Banco de dados

1. **Azure Database for PostgreSQL Flexible Server** → Create:
   - Resource group: `rg-itp-prod`, nome `psql-aprxm-prod`
   - Workload type: **Development** (ajustar depois se precisar) — SKU
     **Burstable B1ms**
   - Versão: **PostgreSQL 16** (mais recente que o `postgres:16-alpine` do
     compose dev atual — mantém paridade)
   - Networking: **Public access**, mas com firewall restrito só aos IPs
     de saída do App Service (adicionados na etapa 2.2) — nunca `0.0.0.0/0`
   - Authentication: senha + (recomendado) habilitar Entra ID admin
   - Backup retention: 7 dias
2. Criar o banco lógico (via **Query editor** do portal ou `psql` local
   contra o endpoint público): `CREATE DATABASE aprxm_db;`
3. **Migração de dados** (janela agendada, fora do horário comercial):
   - **Antes do dump**: excluir a extensão `pg_session_jwt` (proprietária do
     Neon, sem equivalente no Azure — `pg_dump --exclude-extension=pg_session_jwt`
     se disponível na versão do `pg_dump`, ou remover a linha `CREATE EXTENSION
     pg_session_jwt` do dump antes do restore). Sem uso confirmado no código
     — seguro excluir.
   - `pg_dump --format=custom` do Neon (`DATABASE_URL` atual do
     `backend/.env`)
   - `pg_restore` no `psql-aprxm-prod` / `aprxm_db`
   - Validar contagem de linhas nas tabelas principais (`residents`,
     `financial_transactions`, `packages`) entre origem e destino.
   - `api_request_logs` é 53MB/156k linhas (~60% do banco de 89MB) — considerar
     truncar antes do dump (log não é dado de negócio, e o cron #8 abaixo
     recria a rotina de limpeza no destino de qualquer forma).

### 2.2 Backend (FastAPI)

1. **App Service Plan** → Create: `asp-aprxm`, Linux, SKU **B1**.
2. **App Service** → Create: `app-aprxm-backend`, runtime **Python** — versão
   **a confirmar antes de criar**: `backend/vercel.json` usa `@vercel/python`
   sem `.python-version` pinado, então a versão real em produção na Vercel
   não está documentada em nenhum lugar (o `Dockerfile` diz 3.13, mas só é
   usado no `docker-compose` de dev local, não no deploy Vercel). Confirmar
   testando localmente com a versão candidata antes de assumir compatibilidade,
   ou perguntar ao suporte Vercel/checar build logs do último deploy. App
   Service criado no plano `asp-aprxm`.
3. **Deployment Center** → conectar ao GitHub, repo `erickcardosoitp/aprxm_sys`
   (nome do repo no GitHub; a pasta local `c:\aprxm_sass` é só o nome do
   clone), pasta `backend/`. Build via Oryx (padrão do App Service pra
   Python) ou GitHub Actions gerado automaticamente.
4. Startup command: `gunicorn -k uvicorn.workers.UvicornWorker
   -w 2 app.main:app --bind 0.0.0.0:8000` (ajustar workers depois de medir
   carga real).
5. **Configuration → Application settings**: todas as env vars do
   `backend/.env` atual (ver `docker-compose.yml` do repo pra lista
   completa), com `DATABASE_URL` apontando pro `psql-aprxm-prod` — puxar via
   **Key Vault reference** (`@Microsoft.KeyVault(SecretUri=...)`), não texto
   plano. **Importante:** o backend também usa `DATAWAREHOUSE_APRXM_DATABASE_URL`
   (`app/config.py`, `datawarehouse_aprxm_database_url` —
   `analytics_database_url` é campo residual sem uso, não confundir) pra
   carga OLAP do `datalake_service.py`. Essa var só pode apontar pro banco
   definitivo depois que a 2.6 (DW) estiver pronta. Até lá, aponta pro Neon
   do DW antigo (dual-run) pra não quebrar `presidencia`/`painel` durante o
   teste do backend principal.
6. **Deployment slots** → Add Slot → `staging`. Todo deploy futuro vai pro
   staging primeiro.
7. Testar `https://app-aprxm-backend-staging.azurewebsites.net/docs`
   (FastAPI expõe Swagger) — checar rotas de auth e uma rota de leitura.
8. Swap staging → produção.

### 2.2b Cron jobs (8 no Vercel, sem equivalente automático no App Service)

`backend/vercel.json` define 8 crons que hoje o Vercel dispara batendo no
endpoint HTTP correspondente — App Service não tem isso nativo. Endpoints
reais a migrar:

| Endpoint | Schedule | Função |
|---|---|---|
| `/api/v1/demands/reminders/trigger` | `0 11 * * *` | lembrete de demandas |
| `/api/v1/daily-tasks/reminders/trigger` | `0 10 * * *` | lembrete de tarefas |
| `/api/v1/mensalidades/cron-generate` | `0 8 1 * *` | gera mensalidade do mês |
| `/api/v1/mensalidades/cron-check-overdue` | `0 9 * * *` | marca inadimplência |
| `/api/v1/datalake/run` | `0 12 * * *` e `0 20 * * *` (2x/dia) | ETL bronze→silver→gold |
| `/api/v1/ti/vacuum` | `0 3 * * 0` | manutenção semanal |
| `/api/v1/crm/cron-scoring` | `0 6 * * *` | scoring de CRM |

Solução recomendada: **Azure Logic App (Consumption)**, um "Recurrence
trigger" + ação HTTP por cron, replicando o schedule 1:1 — não muda código
da aplicação, menor risco pra uma migração que já tem muita coisa em
paralelo. Custo é próximo de zero pra 8 execuções agendadas de baixo volume.
(Alternativa mais elegante — mover pra `APScheduler` rodando dentro do
próprio processo do App Service, já que ele fica sempre ativo ao contrário
da função serverless da Vercel — fica registrada como melhoria futura, não
fazer agora pra não misturar mudança de infra com mudança de arquitetura.)

Critério de saída: os 8 crons validados rodando contra o slot staging antes
do swap final da 2.2 (testar disparo manual do Logic App apontando pro
`-staging` primeiro).

### 2.3 Frontend (Vite/React)

1. **Static Web Apps** → Create: `swa-aprxm-frontend`, plano Free, fonte
   GitHub, pasta `frontend/`, build Vite.
2. `VITE_API_URL` apontando pro `app-aprxm-backend` (produção, depois do
   swap da 2.2).
3. **Rewrite `/api/*` está hardcoded** (não env var) no `vercel.json` de 3
   dos 4 frontends do aprxm_sys (achado do levantamento) — o Azure Static
   Web Apps usa `staticwebapp.config.json` em vez de `vercel.json`, então
   isso não é "portar" o arquivo, é reescrever a regra de rota apontando
   pro domínio novo do `app-aprxm-backend`. Fazer isso pros 3 frontends
   (main, `presidencia`, `painel` — ver 2.4).
4. Testar fluxo completo em `*.azurestaticapps.net` + backend em
   `*.azurewebsites.net` antes do corte de DNS.

**Achado sem solução de infraestrutura — comunicar ao usuário:** login via
**WebAuthn/passkey está amarrado à origem `aprxm.vercel.app`** (4
credenciais reais cadastradas hoje). O protocolo WebAuthn não permite migrar
essa credencial pra um novo domínio — quem usa passkey vai precisar
**recadastrar depois do cutover**. Isso não é bug de migração, é limitação
do protocolo; avisar os usuários afetados antes do corte de DNS pra não
travarem o login no dia.

### 2.4 Frontends internos (`presidencia/`, `painel/`)

Nenhum dos dois tem backend próprio — chamam o `app-aprxm-backend` (mesmo
padrão de rewrite `/api/*` do `vercel.json` atual de cada um). `presidencia`
em particular depende da rota de `datalake`/`presidencia`, que usa a conexão
`DATAWAREHOUSE_APRXM_DATABASE_URL` pro DW — **testar o dashboard de presidência só faz
sentido depois da 2.6 estar migrada**, senão ele vai funcionar mas mostrando
dado do DW antigo (não é bug, é dual-run esperado até o corte final).

1. `swa-aprxm-presidencia` → fonte GitHub, pasta `presidencia/`.
2. `swa-aprxm-painel` → fonte GitHub, pasta `painel/`.
3. Testar cada um isoladamente em `*.azurestaticapps.net` — `painel` valida
   já nessa etapa, `presidencia` só valida "de verdade" (dado do DW novo)
   depois da 2.6.
4. `simplifica-prototype/` fica de fora até confirmar se está em uso (não
   tem deploy Vercel ativo encontrado no levantamento).

### 2.5 Storage de fotos (Supabase → Azure Blob Storage)

O `aprxm_sys` usa Supabase Storage (bucket `aprxm-midia`) pra mídia, não
Cloudinary como o CLAUDE.md do projeto sugere — confirmado em
`backend/app/services/storage_service.py` e `backend/app/config.py`.

1. **Storage Account** → Create: `staprxmmidia` (nomes de Storage Account
   são globais e só aceitam minúsculo/número), Resource Group
   `rg-itp-prod`, redundância **LRS** (suficiente pro volume atual).
2. Criar um **Container** equivalente ao bucket `aprxm-midia`, acesso
   privado (o app serve as URLs, não o storage direto público — replicar o
   comportamento atual).
3. Copiar os arquivos do bucket Supabase pro container Azure. Usar
   `azcopy` ou script simples via SDK (Supabase Storage é compatível com
   S3 API — `azcopy` consegue ler direto de um endpoint S3-compatible).
4. Reescrever `storage_service.py` pra usar o SDK do Azure Blob
   (`azure-storage-blob`) no lugar do client Supabase — troca de
   implementação, mesma interface (`upload_file` retorna URL pública).
5. `AZURE_STORAGE_CONNECTION_STRING` via Key Vault reference nas
   Application Settings do `app-aprxm-backend`.
6. Testar upload/download de foto no ambiente de staging antes do swap.

**R2 (bronze/silver do ETL)** — achado à parte, mesmo padrão:

7. Criar um segundo **Container** no mesmo Storage Account (`staprxmmidia`),
   ex. `datalake`, réplica da estrutura do bucket `aprxm-datalake`
   (`bronze/atual/`, `bronze/historico/...`).
8. Copiar os 180 objetos (18MB) via `azcopy` (R2 é S3-compatible, mesma
   lógica do item 3 acima).
9. Atualizar `backend/app/services/datalake_service.py` — troca o client
   `boto3`/S3 (`r2_account_id`, `r2_access_key_id`, `r2_secret_access_key`,
   `r2_bucket_name`) pelo SDK do Azure Blob, ou mantém `boto3` apontando
   pro endpoint S3-compatible do Azure (Azure Blob não tem API S3 nativa —
   confirmar se vale reescrever direto pro SDK nativo em vez de tentar
   compatibilidade S3).
10. Rodar o pipeline de ETL completo (`export_bronze` → `build_silver` →
    gold) contra o container novo em staging antes de trocar em produção —
    validar que os relatórios de `presidencia` continuam batendo.

### 2.6 DW / Analytics (camada gold do ETL)

1. **Azure Database for PostgreSQL Flexible Server** → `psql-dw-prod`,
   Burstable B1ms (banco pequeno, 9,7MB — SKU mínimo é suficiente).
2. `pg_dump`/`restore` do Neon (`ep-floral-shadow...`) pro banco novo.
3. Atualizar a connection string usada pelo Power BI / job de ETL que
   popula essa camada gold (confirmar onde esse job roda — não identificado
   neste levantamento, checar `docs/superpowers/plans/2026-08-01-etl-empresa-aware-plan.md`
   antes de migrar).
4. Validar no Power BI que os relatórios continuam puxando dado correto do
   banco novo antes de desligar o Neon antigo.
5. Atualizar `DATAWAREHOUSE_APRXM_DATABASE_URL` no `app-aprxm-backend` (App Settings)
   pro `psql-dw-prod` novo, testar `presidencia`/`painel` de novo (ver 2.4)
   — só agora o dashboard de presidência mostra dado real pós-migração.

### 2.7 Cutover

1. Trocar CNAME de produção (frontend e API, se houver subdomínio dedicado
   tipo `api.` ) pro Azure.
2. Rodar checklist manual: login, cadastro de morador, lançamento
   financeiro, upload de arquivo (agora via Azure Blob Storage).
3. Manter Vercel + Neon + Supabase do aprxm_sys de pé por 1-2 semanas.

**Rollback**: reverter DNS; dados no Neon/Supabase continuam intactos (não
foi apagado, só copiado).

---

## Fase 3 — erp_itp

Mais complexo: 2 App Services (backend NestJS + frontend Next.js SSR).

**Antes de tocar em qualquer coisa desta fase:** sincronizar o repo local
(`git pull origin main`) — estava 8 commits atrás da produção real quando
levantado (`SCHEMA_VERSION` local dizia 19, banco de produção já em 20).
Qualquer decisão tomada olhando o checkout desatualizado é decisão sobre
código errado. (Já sincronizado nesta sessão, mas confirmar de novo antes
de iniciar a Fase 3 de verdade, pode ter avançado desde então.)

**Entrypoint real de produção não é `src/main.ts`, é `apps/backend/api/main.ts`**
— achado do levantamento, corrige suposição anterior deste plano. `api/main.ts`
importa de `../src/*` e adiciona, além do bootstrap normal, um middleware
`PayloadSizeInterceptor`/payload-guard que trunca respostas HTTP acima de 1MB
— mitigação específica pro limite de 4.5MB de resposta serverless da Vercel,
que não existe no App Service. Decisão pra esta fase: **portar `api/main.ts`
como está** (não remover o payload-guard agora) — ele só é redundante no
Azure, não é nocivo, e mudar comportamento de resposta durante uma migração
de infra é risco desnecessário. Reavaliar remoção como limpeza técnica
depois, não durante o corte.

**CORS duplicado e inconsistente** — achado do levantamento, dois mecanismos
diferentes dentro do mesmo `api/main.ts`: (1) o `setupApp` original com lista
dinâmica pra `itp.institutotiapretinha.org`/`api.itp.institutotiapretinha.org`;
(2) um bloco separado de headers CORS manuais (`CORS_ORIGIN = 'https://institutotiapretinha.org'`
— **domínio apex, sem o `itp.`**, diferente do mecanismo 1). Consolidar isso
numa lista única antes do cutover, não portar a inconsistência pro Azure sem
entender por que existem os dois. Outros lugares com domínio hardcoded a
revisar juntos: `vercel.json` do backend tem um redirect de `/` →
`https://api.itp.institutotiapretinha.org/api` (308).

### 3.1 Banco

Mesmo padrão da Fase 2.1, com uma diferença importante: **o Neon de origem
roda Postgres 17.11**, não 16 como aprxm_sys/DW (confirmado via `SHOW
server_version` nos 3 bancos). Criar `psql-erpitp-prod` como **PostgreSQL
17** — confirmar no Portal que a região Brazil South oferece essa versão
pro Flexible Server antes de assumir; se não oferecer, decidir
explicitamente entre esperar disponibilidade ou aceitar downgrade pra 16
(dump/restore funciona entre versões maiores, mas fica sendo uma mudança
de versão do banco no meio da migração de infra, não é neutro).

Banco lógico `erp_itp_db`, `pg_dump`/`restore` do Neon (`neondb`) atual.
`pg_session_jwt` (extensão Neon) aparece disponível mas sem uso confirmado
no código — mesma tratativa da Fase 2.1, seguro excluir do dump.

### 3.2 Backend (NestJS)

1. `asp-erpitp` (App Service Plan Linux B1) hospeda os 2 App Services desta
   fase (backend + frontend, mas **não** compartilha plano com o aprxm_sys).
2. `app-erpitp-backend`, runtime **Node 24.x** (produção real roda Node 24,
   não Node 20 — não há `engines`/`.nvmrc` fixando isso no repo, então
   confirmar antes de assumir; pinar explicitamente ao criar o App Service).
3. Build: `npm run build:backend` (script já existe na raiz do monorepo).
   Startup: `node apps/backend/dist/api/main.js` (não `dist/src/main.js` —
   ver correção de entrypoint acima).
4. App settings: `DATABASE_URL` (Key Vault reference), `JWT_SECRET`,
   `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/`SUPABASE_BUCKET` (ver nota de
   storage abaixo), `SMTP_*`, `CRON_SECRET`, `COLETOR_TOKEN`, `APP_URL`.
   `WEBHOOK_SECRET` aparece configurado no Vercel mas sem leitura encontrada
   no código (`WEKHOOK_SECRET`, com typo, órfã) — não precisa portar, mas
   não apagar sem confirmar com quem mantém.
5. **Hardening TLS**: `ssl: { rejectUnauthorized: false }` na conexão do
   banco hoje contradiz `sslmode=verify-full` — trocar pra
   `rejectUnauthorized: true` + CA correta ao configurar a conexão com o
   `psql-erpitp-prod` novo (parte do hardening já previsto na spec).
6. Slot `staging`, testar, swap.

**Nota de storage:** `itp-erp-backend` também usa Supabase Storage
(`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET`) — confirmar se é
o mesmo projeto Supabase do aprxm_sys (`tzkvwlqpzrzdmbkisliy`) ou um
diferente antes de desenhar a Fase de storage; se for o mesmo projeto,
migra junto na 2.5, se for outro, precisa de container Azure Blob próprio.

### 3.2b Cron jobs (2 confirmados + 1 a confirmar)

```
"crons": [
  { "path": "/api/auth/cron/verificar-senhas", "schedule": "0 8 * * *" },
  { "path": "/api/supabase/cron/health-check", "schedule": "30 8 * * *" }
]
```

Mesmo padrão da 2.2b: Azure Logic App (Consumption), Recurrence trigger +
HTTP action com o header `CRON_SECRET` esperado pelo endpoint. Existe um
**terceiro** endpoint protegido pelo mesmo `CRON_SECRET`
(`captacao.controller.ts:261`) que não está na lista de crons do
`vercel.json` — confirmar com quem mantém se é disparo manual ou cron
órfão antes de decidir se precisa de agendamento no Azure também.

### 3.3 Frontend (Next.js)

1. `app-erpitp-frontend`, runtime **Node 24.x** (mesma ressalva do 3.2),
   SSR completo (não é estático — precisa de App Service, não Static Web
   App).
2. Build: `npm run build:frontend`. Startup: `npm start` (usa `next start`).
3. `NEXT_PUBLIC_API_URL` apontando pro backend (produção, pós-swap 3.2).
4. Slot `staging`, testar fluxo completo (matrícula, login), swap.

### 3.4 Cutover

1. Consolidar e atualizar CORS do backend (ver nota acima) pros domínios
   finais de produção antes do corte de DNS (não depois).
2. Criar/editar o registro na zona Azure DNS (Fase 0.5) pra
   `itp.institutotiapretinha.org` e `api.itp.institutotiapretinha.org`
   apontando pro Azure.
3. **Atualizar os 2 scripts Google Apps Script** (`google-apps-script/formulario-candidato.gs`,
   `formulario-funcionario.gs`) — vivem no Google Drive, fora do repo, com
   a URL `https://api.itp.institutotiapretinha.org/api/...` hardcoded.
   Como o domínio final não muda (só o que está por trás dele), esses
   scripts não precisam de edição se o corte for feito certo — mas
   **testar os webhooks de verdade** depois do corte, é fácil esquecer
   porque não aparecem em nenhuma busca no repo.
4. Checklist manual: login, matrícula direta, geração de boleto, upload
   (Supabase Storage).
5. Manter Vercel + Neon do erp_itp de pé por 1-2 semanas.

**Rollback**: reverter o registro na zona Azure DNS.

---

## Validação de segurança e performance (antes de cada swap/cutover, Fases 2 e 3)

Trocar de Vercel Edge/serverless pra App Service atrás do load balancer da
Azure muda comportamento de proxy — isso quebra coisa silenciosamente se não
checar antes do corte. Rodar contra o slot `staging`, nunca direto em
produção.

**Middleware/segurança (checklist manual, uma vez por backend):**

1. **Confiança de proxy** — App Service injeta `X-Forwarded-For` /
   `X-Forwarded-Proto`. Confirmar que o app usa esse header pra IP real (não
   `request.client.host` cru) — afeta rate limit por IP e logs de auditoria.
   FastAPI: `ProxyHeadersMiddleware` do uvicorn ou `X-Forwarded-For` via
   `trusted_hosts`. NestJS: `app.set('trust proxy', 1)`.
2. **CORS** — testar preflight (`OPTIONS`) contra o domínio de staging real,
   não só localhost. erp_itp tem lista hardcoded no `main.ts`, incluir os
   domínios temporários de teste.
3. **Cookies de sessão/refresh token** — `Secure`, `SameSite`, `Domain`
   corretos pro novo domínio durante o período de dual-run (Vercel + Azure
   simultâneos).
4. **Rate limiting no login** (`slowapi`/`@nestjs/throttler`, ver spec seção
   Segurança) — confirmar que dispara mesmo atrás do proxy da Azure (depende
   do item 1 funcionar certo).
5. **Headers de segurança** — HSTS, `X-Content-Type-Options: nosniff`,
   `Content-Security-Policy` (se já existir) — replicar no App Service via
   `web.config`/middleware, não assumir que o Azure adiciona sozinho.
6. **TLS** — mínimo TLS 1.2 forçado na configuração do App Service (item já
   do runbook de segurança da spec).

**Latência (benchmark comparativo, não é preciso ferramenta pesada):**

Usar `autocannon` (Node, `npx autocannon`) ou `hey` (binário único, sem
instalação de framework) contra os endpoints críticos de cada sistema —
login, listagem paginada principal, upload — comparando produção atual
(Vercel) com o slot staging (Azure), mesma carga (`-c 10 -d 30`):

1. Rodar o benchmark na produção Vercel atual → registrar p50/p95/p99.
2. Rodar o mesmo benchmark no slot staging do Azure.
3. Regressão aceitável: até ~20% de piora em p95 (cold start de App Service
   Linux é maior que edge function da Vercel na primeira request após
   idle — mitigar com **Always On** habilitado no App Service, que evita
   cold start em troca de o app nunca dormir).
4. Se p95 piorar mais que isso, investigar antes do swap — não migrar DNS
   com regressão de latência não explicada.

Critério de saída por sistema: checklist de middleware 100% ok + latência
dentro do aceitável, **documentado** (print/log salvo) antes do passo de
Cutover de cada fase.

---

## Fora deste plano

- CI/CD com Actions customizado (health check automatizado pré-swap) — o
  Deployment Center do portal já gera um workflow básico; refinar smoke
  tests automatizados é uma iteração posterior, depois que o fluxo manual
  estiver validado em cada fase.
- SSO/Entra ID — fase separada, só depois das 3 fases acima estarem
  estáveis em produção (ver spec, seção Governança).
