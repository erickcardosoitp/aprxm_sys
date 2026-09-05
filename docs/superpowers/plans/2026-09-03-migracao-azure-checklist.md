# Checklist de implementação — Migração ITP para Azure

Checklist de execução, item por item. Detalhe/racional de cada item está no
[plano completo](2026-09-01-migracao-azure-plan.md), na
[spec](../specs/2026-09-01-migracao-azure-design.md) e no
[plano de segurança/observabilidade](2026-09-04-seguranca-observabilidade-plan.md).
Este documento é só pra marcar progresso e não deixar nada passar —
atualizar a cada sessão de trabalho, inclusive quando o trabalho vier de
outra máquina/sessão (sempre `git pull` antes de confiar no estado daqui).

Convenção: `[x]` feito · `[~]` em andamento/parcial · `[ ]` não iniciado.

---

## Fase 0 — Preparação

- [x] Resource Group `rg-itp-prod` (Brazil South)
- [x] Orçamento `orcamento-itp-prod` (US$166/mês, alertas 50/80/100%)
- [x] Key Vault `kv-itp-prod-01` (RBAC, soft-delete 90d, purge protection OFF por ora)

## Fase 0.5 — DNS pra fora da Vercel

- [x] Exportar zona DNS completa da Vercel (registrado no plano, 2026-09-03)
- [x] Criar Azure DNS zone `institutotiapretinha.org` (pública, `rg-itp-prod`)
- [x] Recriar MX (M365)
- [x] Recriar TXT `@` (SPF + `MS=ms97588793`, 2 valores no mesmo registro)
- [x] Recriar CNAME `autodiscover`
- [x] Recriar CAA `@` (4 valores: pki.goog, sectigo.com, letsencrypt.org, digicert.com)
- [x] Recriar A `@` (2 IPs Vercel: 216.150.1.1, 216.150.16.193)
- [x] Recriar CNAME `itp` → Vercel
- [x] Recriar CNAME `api.itp` → Vercel
- [x] Recriar TXT `_vercel` (3 valores de verificação)
- [x] Decisão: registros do Google **não replicados** (abandonando Google)
- [x] Validar zona nova direto via nameserver Azure (antes da troca)
- [x] Trocar nameservers na Vercel pros 4 do Azure
- [x] **Validar propagação completa** — confirmado 2026-09-04 via registro
      `.org` direto + Google + Cloudflare, todos batendo com os 4
      nameservers Azure. MX/A/CNAME testados e resolvendo certo.
- [x] Confirmar CA real do certificado gerenciado do Azure App Service —
      HTTPS confirmado funcionando em produção (`https://institutotiapretinha.org`,
      availability test ativo pingando essa URL), CAA não bloqueou a emissão.

## Fase 1 — Piloto: website_tia_pretinha — ✅ CONCLUÍDA em 2026-09-04

- [x] Criar Static Web App `swa-website-itp` (Free, fonte GitHub, build Vite)
- [x] Validar workflow do GitHub Actions gerado automaticamente
- [x] Testar em `*.azurestaticapps.net` (navegação, redirect `/inscricao`, rotas SPA)
- [x] `staticwebapp.config.json` — CSP ajustado pra liberar endpoints do Application Insights
- [x] Configurar custom domain
- [x] Validar HTTPS automático emitido
- [x] Cutover: `institutotiapretinha.org` servido pelo Azure
- [x] Checklist manual pós-cutover
- [ ] Manter projeto na Vercel intacto por 1-2 semanas (em andamento, não remover ainda — prazo até ~2026-09-18)

## Segurança/CI e Observabilidade (trilha paralela, não bloqueia as fases de migração)

Detalhe completo: [plano de segurança/observabilidade](2026-09-04-seguranca-observabilidade-plan.md).

- [x] Dependabot — `website_tia_pretinha`
- [x] Dependabot — `aprxm_sys` (pip backend, npm frontend/presidencia/painel, docker, github-actions)
- [x] **50/50 alertas Dependabot do `aprxm_sys` resolvidos em 2026-09-05** (6 PRs
      mesclados + correções manuais: python-multipart, brace-expansion,
      form-data, postcss-selector-parser, @babel/core, react-router v6→v7
      nos 3 frontends, vite v5→v8, xlsx via CDN oficial SheetJS)
- [ ] Dependabot — `erp_itp` (pendente, não depende de nenhuma fase da migração)
- [x] CodeQL — `website_tia_pretinha`
- [x] CodeQL — `aprxm_sys` (javascript-typescript + python)
- [ ] CodeQL — `erp_itp` (pendente, idem)
- [ ] Branch protection exigindo status check do CodeQL nos 3 repos (ainda não confirmado)
- [x] Application Insights + RUM real + availability test — `website_tia_pretinha`
- [ ] Application Insights (backend + 3 frontends) — `aprxm_sys` (junto da Fase 2.2/2.3)
- [ ] Application Insights (backend + frontend SSR) — `erp_itp` (junto da Fase 3.2/3.3)
- [ ] Front Door + WAF — adiado, revisitar com custo real medido pós Fases 2/3

## ⚠️ Ordem real (2026-09-05): erp_itp primeiro, aprxm_sys depois

Os títulos abaixo mantêm a numeração original (Fase 2 = aprxm_sys, Fase 3 =
erp_itp), mas **execute a seção "Fase 3 — erp_itp" antes da "Fase 2 —
aprxm_sys"**.

## Fase 2 — aprxm_sys

### Banco
- [ ] Confirmar versão real do Python em produção (Vercel `@vercel/python`
      sem `.python-version` — pendência aberta desde o levantamento)
- [ ] Criar `psql-aprxm-prod` (Flexible Server, Postgres 16, Burstable B1ms)
- [ ] Criar banco lógico `aprxm_db`
- [ ] Avaliar truncar `api_request_logs` antes do dump (53MB/156k linhas)
- [ ] Rodar `pg-backup.sh aprxm_sys` (`docs/superpowers/plans/scripts/`,
      já exclui `pg_session_jwt` automaticamente no restore, imagem
      `postgres:16-alpine` default)
- [ ] Rodar `pg-restore.sh` contra o `psql-aprxm-prod`
- [ ] Rodar `pg-verify.sh` — contagem de linhas de todas as tabelas batendo

### Backend
- [ ] Criar App Service Plan `asp-aprxm` (Linux B1)
- [ ] Criar App Service `app-aprxm-backend` (runtime Python confirmado acima)
- [ ] Deployment Center conectado a `erickcardosoitp/aprxm_sys`, pasta `backend/`
- [ ] Startup command configurado (gunicorn+uvicorn workers)
- [ ] Application settings completas (todas as env vars do `.env` atual)
- [ ] `DATABASE_URL` via Key Vault reference
- [ ] `DATAWAREHOUSE_APRXM_DATABASE_URL` configurada (dual-run até a seção DW abaixo)
- [ ] Slot `staging` criado
- [ ] Testar `/docs` (Swagger) + rotas de auth/leitura no staging
- [ ] Swap staging → produção

### Cron jobs (8)
- [ ] Criar Logic App (Consumption) pros 8 crons do `vercel.json`
- [ ] Validar disparo manual de cada um contra o slot staging
- [ ] Confirmar todos os 8 schedules replicados corretamente

### Frontends
- [ ] Static Web App `swa-aprxm-frontend` (main)
- [ ] Reescrever rota `/api/*` pro domínio novo (`staticwebapp.config.json`)
- [ ] Static Web App `swa-aprxm-presidencia`
- [ ] Static Web App `swa-aprxm-painel`
- [ ] Confirmar `simplifica-prototype/` fica fora (sem deploy ativo)
- [ ] Testar os 3 frontends em `*.azurestaticapps.net`
- [ ] **Comunicar usuários de WebAuthn/passkey** (4 credenciais reais) sobre
      recadastro necessário pós-cutover — identificar quem são antes do corte

### Storage
- [ ] Criar Storage Account `staprxmmidia` (LRS)
- [ ] Criar container de fotos (substitui bucket Supabase `aprxm-midia`)
- [ ] Copiar arquivos Supabase → Azure Blob (`azcopy`)
- [ ] Reescrever `storage_service.py` pro SDK Azure Blob
- [ ] `AZURE_STORAGE_CONNECTION_STRING` via Key Vault
- [ ] Testar upload/download em staging
- [ ] Criar container `datalake` (substitui bucket R2 `aprxm-datalake`)
- [ ] Copiar 180 objetos R2 → Azure Blob
- [ ] Atualizar `datalake_service.py` (client S3/boto3 → Azure Blob ou manter S3-compat)
- [ ] Rodar pipeline ETL completo contra container novo em staging

### DW / Analytics
- [ ] Criar `psql-dw-prod` (Flexible Server, Postgres 16, Burstable B1ms)
- [ ] `pg-backup.sh dw` + `pg-restore.sh` + `pg-verify.sh` (mesmos scripts,
      `postgres:16-alpine`) do Neon (`ep-floral-shadow...`)
- [ ] Localizar e atualizar job/processo que popula a camada gold
- [ ] Validar Power BI puxando do banco novo
- [ ] Atualizar `DATAWAREHOUSE_APRXM_DATABASE_URL` no `app-aprxm-backend`
- [ ] Retestar `presidencia`/`painel` com dado real pós-migração

### Cutover
- [ ] Criar/editar registro na zona Azure DNS pros domínios do aprxm_sys
- [ ] Checklist manual completo (login, cadastro, financeiro, upload)
- [ ] Rodar validação de segurança/latência (ver seção própria abaixo)
- [ ] Manter Vercel + Neon + Supabase de pé por 1-2 semanas

## Fase 3 — erp_itp

### Pré-requisitos
- [ ] `git pull origin main` (confirmar de novo antes de iniciar de fato)
- [ ] Confirmar `SCHEMA_VERSION` local bate com produção
- [ ] Confirmar se Supabase do erp_itp é o mesmo projeto do aprxm_sys ou outro

### Código a revisar antes de portar
- [ ] Decidir `api/main.ts` (recomendado, preserva comportamento) vs `src/main.ts`
- [ ] Consolidar os 2 mecanismos de CORS divergentes em `api/main.ts`
- [ ] Revisar redirect hardcoded `/` → `api.itp...` no `vercel.json`
- [ ] Trocar `rejectUnauthorized: false` → `true` + CA correta (TLS)
- [ ] Confirmar status do endpoint órfão `captacao.controller.ts:261` (cron?)
- [ ] Confirmar `WEBHOOK_SECRET`/`WEKHOOK_SECRET` órfã antes de decidir remover

### Banco
- [x] Scripts reutilizáveis criados (`docs/superpowers/plans/scripts/`:
      `pg-backup.sh`, `pg-restore.sh`, `pg-verify.sh`, `count_all.sql`) —
      rodam via Docker (`postgres:17-alpine`), sem instalar Postgres local
- [x] Rodar `pg-backup.sh erp_itp postgres:17-alpine` e validar o dump gerado
      — ✅ 2026-09-05, 3,6MB, 76 tabelas com dados. Achado: precisou de
      `export MSYS_NO_PATHCONV=1` nos 3 scripts (Git Bash traduzia o
      caminho `/backups` do container pra um caminho Windows errado),
      corrigido e commitado. Extensões confirmadas no dump: `pg_session_jwt`
      (será excluída no restore), `pgcrypto` e `uuid-ossp` (padrão, sem
      problema no Azure).
- [ ] Criar `psql-erpitp-prod` como **Postgres 17** (confirmar disponibilidade
      na região antes de assumir)
- [ ] Criar banco lógico `erp_itp_db`
- [ ] Rodar `pg-restore.sh` (já exclui `pg_session_jwt` automaticamente)
- [ ] Rodar `pg-verify.sh` — contagem de linhas de todas as tabelas batendo

### Backend
- [ ] Criar App Service Plan `asp-erpitp` (Linux B1, isolado do aprxm_sys)
- [ ] Criar App Service `app-erpitp-backend`, runtime **Node 24.x** confirmado
- [ ] Startup: `node apps/backend/dist/api/main.js`
- [ ] Application settings completas (DATABASE_URL, JWT_SECRET, SUPABASE_*, SMTP_*, CRON_SECRET, COLETOR_TOKEN, APP_URL)
- [ ] Slot `staging`, testar, swap

### Cron jobs
- [ ] Logic App pros 2 crons confirmados (`verificar-senhas`, `health-check`)
- [ ] Resolver pendência do 3º endpoint órfão (item acima)

### Frontend
- [ ] Criar App Service `app-erpitp-frontend`, Node 24.x, SSR
- [ ] `NEXT_PUBLIC_API_URL` configurada
- [ ] Slot `staging`, testar fluxo completo, swap

### Cutover
- [ ] CORS consolidado e atualizado pros domínios finais
- [ ] Registro na zona Azure DNS pra `itp.` e `api.itp.`
- [ ] Testar os 2 webhooks do Google Apps Script pós-corte
- [ ] Checklist manual (login, matrícula, boleto, upload)
- [ ] Rodar validação de segurança/latência (ver seção própria abaixo)
- [ ] Manter Vercel + Neon de pé por 1-2 semanas

## Validação de segurança e performance (repetir a cada swap, Fases 2 e 3)

- [ ] Proxy headers (`X-Forwarded-For`/`trust proxy`) configurado e testado
- [ ] CORS testado com preflight real contra domínio de staging
- [ ] Cookies (Secure/SameSite/Domain) corretos pro domínio novo
- [ ] Rate limiting no login disparando atrás do proxy Azure
- [ ] Headers de segurança (HSTS, X-Content-Type-Options, CSP)
- [ ] TLS mínimo 1.2 forçado
- [ ] Benchmark de latência (autocannon/hey) Vercel vs staging Azure, p95 dentro de ~20%
- [ ] Always On habilitado (evita cold start)

## Fase 4 — Pós-migração (só após 1-2 semanas estável)

- [ ] Teste de restore real do backup do Postgres (banco descartável)
- [ ] Soft delete + versionamento no Blob Storage
- [ ] Documentar RTO/RPO alvo
- [ ] Monitoramento/alerta pro pipeline ETL (Logic App falhando silenciosamente)
- [ ] Reavaliar mover crons pra APScheduler in-process (opcional)
- [ ] Definir escopo de IA quando houver requisito concreto (não antecipar)
- [ ] Reavaliar Front Door/WAF se tráfego público crescer

## Limpeza final (depois de todas as fases estáveis)

- [ ] Remover registros `pki.goog` do CAA (só depois da Vercel sair de cena)
- [ ] Descomissionar projetos Vercel antigos
- [ ] Descomissionar bancos Neon antigos (3)
- [ ] Descomissionar bucket Supabase Storage
- [ ] Descomissionar bucket R2 (`aprxm-datalake`)
- [ ] Remover `_vercel` TXT verification (se não fizer mais sentido manter)
