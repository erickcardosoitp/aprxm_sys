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
   - `pg_dump --format=custom` do Neon (`DATABASE_URL` atual do
     `backend/.env`)
   - `pg_restore` no `psql-aprxm-prod` / `aprxm_db`
   - Validar contagem de linhas nas tabelas principais (`residents`,
     `financial_transactions`, `packages`) entre origem e destino.

### 2.2 Backend (FastAPI)

1. **App Service Plan** → Create: `asp-aprxm`, Linux, SKU **B1**.
2. **App Service** → Create: `app-aprxm-backend`, runtime **Python 3.10**,
   plano `asp-aprxm`.
3. **Deployment Center** → conectar ao GitHub, repo `aprxm_sys` (ou
   `aprxm_sass`, confirmar nome real do repo), pasta `backend/`. Build via
   Oryx (padrão do App Service pra Python) ou GitHub Actions gerado
   automaticamente.
4. Startup command: `gunicorn -k uvicorn.workers.UvicornWorker
   -w 2 app.main:app --bind 0.0.0.0:8000` (ajustar workers depois de medir
   carga real).
5. **Configuration → Application settings**: todas as env vars do
   `backend/.env` atual (ver `docker-compose.yml` do repo pra lista
   completa), com `DATABASE_URL` apontando pro `psql-aprxm-prod` — puxar via
   **Key Vault reference** (`@Microsoft.KeyVault(SecretUri=...)`), não texto
   plano.
6. **Deployment slots** → Add Slot → `staging`. Todo deploy futuro vai pro
   staging primeiro.
7. Testar `https://app-aprxm-backend-staging.azurewebsites.net/docs`
   (FastAPI expõe Swagger) — checar rotas de auth e uma rota de leitura.
8. Swap staging → produção.

### 2.3 Frontend (Vite/React)

1. **Static Web Apps** → Create: `swa-aprxm-frontend`, plano Free, fonte
   GitHub, pasta `frontend/`, build Vite.
2. `VITE_API_URL` apontando pro `app-aprxm-backend` (produção, depois do
   swap da 2.2).
3. Testar fluxo completo em `*.azurestaticapps.net` + backend em
   `*.azurewebsites.net` antes do corte de DNS.

### 2.4 Cutover

1. Trocar CNAME de produção (frontend e API, se houver subdomínio dedicado
   tipo `api.` ) pro Azure.
2. Rodar checklist manual: login, cadastro de morador, lançamento
   financeiro, upload de arquivo (Cloudinary).
3. Manter Vercel + Neon do aprxm_sys de pé por 1-2 semanas.

**Rollback**: reverter DNS; dados no Neon continuam intactos (não foi
apagado, só copiado).

---

## Fase 3 — erp_itp

Mais complexo: 2 App Services (backend NestJS + frontend Next.js SSR), CORS
hardcoded em `apps/backend/src/main.ts` apontando pra
`itp.institutotiapretinha.org` / `api.itp.institutotiapretinha.org`.

### 3.1 Banco

Mesmo padrão da Fase 2.1: `psql-erpitp-prod`, banco lógico `erp_itp_db`,
`pg_dump`/`restore` do Neon (`neondb`) atual.

### 3.2 Backend (NestJS)

1. `asp-erpitp` (App Service Plan Linux B1) hospeda os 2 App Services desta
   fase (backend + frontend, mas **não** compartilha plano com o aprxm_sys).
2. `app-erpitp-backend`, runtime **Node 20**.
3. Build: `npm run build:backend` (script já existe na raiz do monorepo).
   Startup: `node apps/backend/dist/src/main.js`.
4. **Importante**: o `main.ts` atual tem um branch `if (!process.env.VERCEL)`
   pra decidir entre handler serverless e `bootstrapLocal()`. No App Service
   (não é serverless) ele sempre cai no `bootstrapLocal()` — não precisa
   mudar código, só garantir que `VERCEL` não esteja setado nas Application
   Settings do Azure.
5. Atualizar a lista de CORS em produção no `main.ts` (ou externalizar pra
   env var, se preferir não hardcodear de novo a cada migração) incluindo os
   domínios finais do Azure durante o período de teste.
6. App settings: `DATABASE_URL` (Key Vault reference), demais secrets do
   `.env` atual.
7. Slot `staging`, testar, swap.

### 3.3 Frontend (Next.js)

1. `app-erpitp-frontend`, runtime **Node 20**, SSR completo (não é estático
   — precisa de App Service, não Static Web App).
2. Build: `npm run build:frontend`. Startup: `npm start` (usa `next start`).
3. `NEXT_PUBLIC_API_URL` apontando pro backend (produção, pós-swap 3.2).
4. Slot `staging`, testar fluxo completo (matrícula, login), swap.

### 3.4 Cutover

1. Atualizar CORS do backend pros domínios finais de produção antes do
   corte de DNS (não depois).
2. Trocar CNAME de `itp.institutotiapretinha.org` e
   `api.itp.institutotiapretinha.org` pro Azure.
3. Checklist manual: login, matrícula direta, geração de boleto, upload.
4. Manter Vercel + Neon do erp_itp de pé por 1-2 semanas.

**Rollback**: reverter DNS.

---

## Fora deste plano

- CI/CD com Actions customizado (health check automatizado pré-swap) — o
  Deployment Center do portal já gera um workflow básico; refinar smoke
  tests automatizados é uma iteração posterior, depois que o fluxo manual
  estiver validado em cada fase.
- SSO/Entra ID — fase separada, só depois das 3 fases acima estarem
  estáveis em produção (ver spec, seção Governança).
