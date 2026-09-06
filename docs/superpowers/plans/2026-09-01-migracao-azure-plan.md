# Plano de implementação — Migração ITP para Azure

Spec: [2026-09-01-migracao-azure-design.md](../specs/2026-09-01-migracao-azure-design.md)

Due-diligence completo antes da execução, um relatório por sistema:
[aprxm_sys](../reports/2026-09-01-due-diligence-aprxm-sys.md) ·
[erp_itp](../reports/2026-09-01-due-diligence-erp-itp.md) ·
[website_tia_pretinha](../reports/2026-09-01-due-diligence-website.md)

Execução manual pelo Portal Azure (sem CLI/IaC). Subscription do grant
nonprofit já ativa. 3 fases em ordem — cada fase só começa depois da anterior
validada e cortada.

## Notas gerais de execução no Portal (aprendidas na Fase 0.5, valem pra todas as fases)

- **Nomes globais**: Key Vault e Storage Account têm nome único em **toda a
  Azure**, não só no seu Resource Group — se o nome óbvio já estiver
  ocupado (mesmo por recurso de outra empresa), o Portal recusa. Tenha um
  sufixo alternativo pronto (`-01`, `-prod2`).
- **TXT e CAA agrupam por nome**: ao criar um 2º registro TXT (ou CAA) com
  o **mesmo nome** de um que já existe (ex. dois TXT em `@`), o Portal
  recusa dizendo "já existe um conjunto de registos com o mesmo nome".
  Isso é o esperado — DNS TXT/CAA de mesmo nome vivem **dentro do mesmo
  registro**, não em registros separados. Solução: abrir o registro
  existente e usar o botão **"+ adicionar valor"** pra incluir mais um
  valor dentro dele, em vez de criar um novo.
- **Apex (`@`) não aceita CNAME** — é regra do protocolo DNS, não
  limitação do Azure. Pra apontar o domínio raiz pra um alvo externo
  (Vercel, outro CDN), usa registro **A** com o(s) IP(s) reais — descubra
  o IP atual com `nslookup dominio.com` antes de criar.
- **Sempre terminar valores de CNAME/MX/ALIAS com ponto final** (`.`) — é
  a notação de FQDN absoluto, o Portal às vezes aceita sem mas é a forma
  correta.
- **Campo "Metadados"** que aparece em vários formulários (Key Vault, DNS
  records) é opcional, só tags/notas suas — pode deixar em branco sempre.
- **Purge protection** (Key Vault) e qualquer opção descrita como
  "irreversível" — deixar desligada durante a fase de montagem/teste,
  ligar só depois do ambiente estabilizado em produção.
- **Propagação de nameserver** demora mais no nível do *registrador* (a
  Vercel precisar empurrar a mudança pro registro `.org`) do que no nível
  de cache dos resolvers — testar com
  `nslookup -type=NS dominio.com 8.8.8.8` (Google) e comparar com o
  esperado; se ainda mostrar o nameserver antigo horas depois, o atraso
  está do lado do registrador, não é "só esperar cache".

---

## Fase 0 — Preparação (uma vez só) — ✅ CONCLUÍDA em 2026-09-01

1. ✅ Portal Azure → **Resource groups** → **Create** → nome `rg-itp-prod`,
   região **Brazil South**.
2. ✅ Portal Azure → **Cost Management + Billing** → orçamento criado
   (nome `orcamento-itp-prod`), teto US$ 166/mês, alertas de custo real em
   50% (US$83) / 80% (US$132,8) / 100% (US$166).
3. ✅ **Key Vault** → criado como `kv-itp-prod-01` (`kv-itp-prod` já estava
   reservado por um cofre eliminado de forma recuperável — nome tem que ser
   único globalmente na Azure). RBAC como modelo de permissão, eliminação
   recuperável ativada (90 dias), proteção contra remoção **desativada**
   deliberadamente por enquanto (é irreversível uma vez ligada — ativar
   depois de o ambiente estabilizar em produção). Ponto final público.
   Vai guardar `DATABASE_URL`, `JWT_SECRET`, chaves Cloudinary de cada
   sistema (segredos entram aqui na Fase 2/3, ao configurar cada app).

Critério de saída: Resource Group + Key Vault existem, orçamento
configurado. **Atingido.**

---

## Fase 0.5 — Migrar DNS pra fora da Vercel (uma vez só, antes da Fase 1) — ✅ CONCLUÍDA em 2026-09-04 (propagação NS validada em 8.8.8.8 e 1.1.1.1)

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

   **Zona exportada em 2026-09-03** (registros reais, replicar 1:1 na Azure
   DNS antes de trocar nameserver):

   | Tipo | Nome | Valor |
   |---|---|---|
   | TXT | @ | `v=spf1 include:spf.protection.outlook.com -all` |
   | CNAME | `autodiscover` | `autodiscover.outlook.com.` |
   | MX | @ | `institutotiapretinha-org.mail.protection.outlook.com.` |
   | TXT | @ | `MS=ms97588793` |
   | TXT | `_vercel` | `vc-domain-verify=api.itp.institutotiapretinha.org,...` |
   | TXT | `_vercel` | `vc-domain-verify=itp.institutotiapretinha.org,...` |
   | TXT | `_vercel` | `vc-domain-verify=institutotiapretinha.org,...` |
   | ALIAS | @ | `6f060a2c92908857.vercel-dns-017.com` (gerenciado pela Vercel) |
   | ALIAS | `*` (curinga) | `cname.vercel-dns-016.com.` (gerenciado pela Vercel) |
   | TXT | `google._domainkey` | `v=DKIM1;k=rsa;p=...` |
   | CNAME | `tr6x2dsrv2g2` | `gv-ax3cuukbjmj4cj.dv.googlehosted.com.` |
   | TXT | @ | `google-site-verification=IDfh1rGz-P06D8NH940CvH_Ez4cNXoZUpmbbUqrllA0` |
   | CAA | @ | `0 issue "pki.goog"` |
   | CAA | @ | `0 issue "sectigo.com"` |
   | CAA | @ | `0 issue "letsencrypt.org"` |

   **3 achados que mudam como replicar isso na Azure DNS:**

   - **E-mail é Microsoft 365** (MX + SPF + autodiscover + verificação
     `MS=`) — o conjunto mais crítico da lista, precisa ir junto e idêntico,
     senão o e-mail do instituto para de funcionar (não só os sites).
   - **CAA restringe emissão de certificado a `pki.goog`/`sectigo.com`/
     `letsencrypt.org`** — o certificado gerenciado do Azure App Service
     normalmente é emitido por outra CA (DigiCert, a confirmar no momento
     da emissão) — se não estiver no CAA, o HTTPS falha silenciosamente.
     **Adicionar a CA do Azure ao CAA antes do primeiro cutover.**
   - **O registro curinga `*` → Vercel** é o que hoje resolve `itp.` e
     `api.itp.` sem registro explícito próprio. Isso não existe do mesmo
     jeito na Azure DNS — cada subdomínio final (`itp.`, `api.itp.`, apex)
     precisa de registro explícito próprio apontando pro recurso Azure
     certo, não dá pra portar um curinga genérico.

   **Confirmado com o usuário (2026-09-03)**: Google está sendo abandonado
   — os registros `google._domainkey`, verificação de domínio Google
   (`tr6x2dsrv2g2`) e `google-site-verification` **não entram** na zona
   nova. Provedor de e-mail segue 100% Microsoft 365 — nenhum servidor novo
   de e-mail a configurar, só replicar MX/SPF/autodiscover/verificação
   `MS=` exatamente como estão hoje.
2. ✅ **Azure DNS** → Create DNS zone → `institutotiapretinha.org`, criado
   em `rg-itp-prod`, zona **pública**. Nameservers gerados:
   `ns1-07.azure-dns.com.` / `ns2-07.azure-dns.net.` /
   `ns3-07.azure-dns.org.` / `ns4-07.azure-dns.info.`
3. ✅ Registros recriados na zona nova (todos confirmados criados em
   2026-09-03):
   - MX `@` → `institutotiapretinha-org.mail.protection.outlook.com.` (pref 0)
   - TXT `@` → 2 valores: SPF (`v=spf1 include:spf.protection.outlook.com -all`) + `MS=ms97588793`
   - CNAME `autodiscover` → `autodiscover.outlook.com.`
   - CAA `@` → 4 valores: `pki.goog`, `sectigo.com`, `letsencrypt.org`, `digicert.com` (todos `issue`, flag 0)
   - A `@` → 2 IPs: `216.150.1.1` e `216.150.16.193` (apex não aceita CNAME, por isso A)
   - CNAME `itp` → `cname.vercel-dns-016.com.`
   - CNAME `api.itp` → `cname.vercel-dns-016.com.`
   - TXT `_vercel` → 3 valores de `vc-domain-verify=...` (apex, itp, api.itp)
   - Google (`google._domainkey`, verificação, `google-site-verification`)
     **não replicado** — decisão do usuário de abandonar Google (2026-09-03)
   - ✅ Validado direto contra `ns1-07.azure-dns.com` antes da troca: MX, A,
     CNAME `itp`, TXT todos batendo certo.
4. ✅ **Nameservers trocados na Vercel** (Domains → `institutotiapretinha.org`
   → Nameservers) em 2026-09-03, pros 4 nameservers do Azure acima.
   Aguardando propagação (Vercel avisa até 48h; realista 1-4h pra maioria
   dos resolvers). **Ainda mostrando nameserver antigo** nos testes via
   8.8.8.8/1.1.1.1 logo após a troca — checar de novo antes de prosseguir
   pra Fase 1 propriamente (o trabalho de build/deploy da Fase 1 não
   depende da propagação, só o cutover final do domínio customizado).
5. ✅ Propagação completa validada em 2026-09-04 (`nslookup -type=NS
   institutotiapretinha.org 8.8.8.8` e `1.1.1.1` batendo com os 4
   nameservers Azure).

Onde as fases abaixo dizem "trocar CNAME de produção" / "criar registro no
painel DNS da Vercel", ler como "criar/editar o registro na zona Azure DNS".

---

## Fase 1 — Piloto: website_tia_pretinha — ✅ CONCLUÍDA em 2026-09-04

Sem banco, sem backend — objetivo é validar o pipeline de deploy/DNS com o
menor risco antes de mexer em sistemas com dados. Repo: `C:\tia_pretinha`
(GitHub: confirmar nome exato do repo na conta `erickcardosoitp`, é o
`website_tia_pretinha` ou nome equivalente).

### 1.1 Criar o recurso

1. Portal Azure → busca **"Aplicativos Web Estáticos"** (Static Web Apps)
   → **+ Criar**.
2. **Básico**:
   - Assinatura: a do grant nonprofit
   - Grupo de recursos: `rg-itp-prod`
   - Nome: `swa-website-itp`
   - Plano de hospedagem: **Gratuito** (Free)
   - Região da API/implantação: **East US 2** (ou a região disponível mais
     próxima — nem toda região do Azure tem o tier Free de Static Web
     Apps; se `Brazil South` não aparecer na lista, é por isso, normal).
3. **Detalhes da implantação**:
   - Origem: **GitHub** → clica em "Entrar com o GitHub" e autoriza,
     depois seleciona Organização `erickcardosoitp`, Repositório
     `website_tia_pretinha` (conferir nome exato na lista), Branch `main`.
   - Predefinições de compilação: procurar **Vite** na lista; se não
     existir like preset, escolher **Custom** e preencher manualmente:
     - Local do código do aplicativo: `/`
     - Local de saída da compilação: `dist`
     - (não tem API/backend, deixar o campo de API vazio)
4. **Revisar + criar** → **Criar**. Isso já cria automaticamente um
   workflow do GitHub Actions dentro do repositório (arquivo
   `.github/workflows/azure-static-web-apps-*.yml`) que builda e faz
   deploy a cada push na branch `main`.

### 1.2 Validar o primeiro deploy

1. Aguardar alguns minutos — acompanhar o progresso na aba **Actions** do
   repositório no GitHub, ou na aba **Visão geral** do recurso no Azure
   (mostra o status do último deploy).
2. Quando concluído, o Azure mostra uma URL tipo
   `https://<nome-gerado>.azurestaticapps.net` — abrir e navegar:
   - Página inicial carrega certo
   - `/inscricao` funciona (hoje é redirect configurado no `vercel.json`
     pra `https://itp.institutotiapretinha.org/inscricao` — no Azure isso
     precisa existir num `staticwebapp.config.json` na raiz do repo, ver
     abaixo)
   - Navegar entre páginas via link interno (testa o roteamento de SPA)
   - Recarregar a página (F5) numa rota interna tipo `/sobre` — se der 404,
     falta o rewrite de SPA

### 1.3 `staticwebapp.config.json` (só se o passo 1.2 mostrar problema)

Se o redirect de `/inscricao` ou o F5 em rota interna derem erro, criar
`staticwebapp.config.json` na raiz do repo `website_tia_pretinha` (mesmo
nível do `vercel.json` atual):

```json
{
  "routes": [
    {
      "route": "/matricula",
      "redirect": "https://itp.institutotiapretinha.org/inscricao",
      "statusCode": 302
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html"
  }
}
```

Commitar e dar push — o GitHub Actions já configurado builda e reaplica
automaticamente.

### 1.4 Domínio customizado

1. No recurso Static Web App → **Domínios personalizados** → **+ Adicionar**.
2. Digitar o domínio (apex `institutotiapretinha.org` ou o subdomínio que
   o site usa hoje — confirmar qual é o real antes, pode ser só o apex).
3. O Azure mostra um registro de validação (tipo TXT ou CNAME, específico
   pra esse recurso) — criar esse registro na zona `institutotiapretinha.org`
   do Azure DNS (mesmo processo da Fase 0.5: zona → "+ Registro conjunto").
4. Voltar na tela de Domínios personalizados e clicar em **Validar** — pode
   levar alguns minutos pra propagar dentro da própria infra do Azure
   (mais rápido que propagação de internet, é tudo Azure→Azure).
5. Depois de validado, o Azure pede o registro final (A ou CNAME/ALIAS,
   dependendo se é apex ou subdomínio) apontando pro Static Web App —
   criar esse registro na zona também.
6. HTTPS é emitido automaticamente pelo Azure depois que o domínio valida
   (não precisa de ação manual) — se falhar, o motivo mais provável é o
   CAA da zona não incluir a CA que o Azure usa (ver Fase 0.5, já deixamos
   `digicert.com` no CAA preventivamente).

### 1.5 Cutover de verdade

1. Só depois do passo 1.4 validado E testado no próprio subdomínio
   temporário que o Azure ainda expõe (`*.azurestaticapps.net` continua
   funcionando em paralelo).
2. O registro final da 1.4 já FOI o cutover — diferente das Fases 2/3, o
   Static Web App não tem conceito de "slot de staging" separado, então
   validar bem antes do passo 1.4.3 é o que substitui o staging aqui.
3. Testar o domínio de produção de verdade depois do DNS validado.
4. Manter o projeto na Vercel intacto por 1-2 semanas antes de remover —
   não precisa fazer nada ativo pra isso, só não deletar o projeto Vercel
   ainda.

Critério de saída: site em produção servido pelo Azure, Vercel como fallback
não removido ainda.

**Rollback**: editar o registro na zona Azure DNS de volta pro CNAME/ALIAS
da Vercel (`cname.vercel-dns-016.com.` pro subdomínio, ou os IPs
`216.150.1.1`/`216.150.16.193` pro apex — mesmos valores documentados na
Fase 0.5).

---

## ⚠️ Ordem de execução real (decidido 2026-09-05): erp_itp antes do aprxm_sys

As fases abaixo continuam numeradas Fase 2 (aprxm_sys) / Fase 3 (erp_itp)
pra não reescrever todas as referências internas cruzadas, mas a
**execução real segue Fase 3 (erp_itp) primeiro, Fase 2 (aprxm_sys)
depois** — decisão do usuário, provavelmente por prioridade de negócio.
Ao seguir este plano, pule direto pra "Fase 3 — erp_itp" agora.

## Fase 2 — aprxm_sys

### 2.1 Banco de dados

1. **Azure Database for PostgreSQL Flexible Server** → Create:
   - Resource group: `rg-itp-prod`, nome `psql-aprxm-prod`
   - Workload type: **Production** (é banco de produção de verdade, não
     ambiente de teste — o rótulo não trava o SKU, ainda dá pra escolher
     Burstable manualmente mesmo assim) — SKU
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

**✅ `psql-erpitp-prod` criado em 2026-09-06** — configuração completa,
ponto a ponto, do assistente do Portal:

- **Básico**: Resource group `rg-itp-prod`, região Brazil South, versão
  **PostgreSQL 17** confirmada disponível.
- **Computação + armazenamento**: assistente sugeriu por padrão General
  Purpose `Standard_D4ds_v5` (4 vCores/16GiB) com Alta Disponibilidade —
  custo previsto **US$756,86/mês**, muito acima do necessário pro volume
  real (20MB, baixo tráfego). Corrigido em "Configurar servidor":
  - Compute tier: **Expansível** (= Burstable) em vez de "Fins Gerais" —
    esse tier **não suporta Alta Disponibilidade**, então a opção nem
    aparece mais na tela, eliminando os US$378,43/mês daquele item sozinho.
  - Tamanho: **Standard_B1ms** (1 vCore, 2GiB RAM).
  - Armazenamento: **32 GiB** (mínimo oferecido, escalão de desempenho
    **P4** automático) — reduzido dos 128GiB sugeridos por padrão.
  - Redundância geográfica: **Desativada**.
  - Custo final confirmado: **US$32,56/mês**.
- **Workload type**: **Production** (não "Development" — é banco de
  produção real; o rótulo não trava o SKU escolhido acima).
- **Rede**: **Acesso público**, com regra de firewall liberando o IP do
  cliente atual (via "+ Adicionar o endereço IP do cliente atual" no
  Portal). **Sem** ponto final privado por enquanto (fica pra depois que o
  App Service existir e puder integrar na mesma VNet — criar antes seria
  recurso sem consumidor). **Sem** marcar "permitir acesso de qualquer
  serviço Azure".
- **Segurança/autenticação**: **PostgreSQL e Microsoft Entra ID** (as
  duas juntas) — login nativo `erpitp_admin` + senha forte gerada e
  guardada temporariamente fora do Azure até ir pro Key Vault; administrador
  Entra ID = `erickcardoso@institutotiapretinha.org` (conta real do
  domínio custom, não a `.onmicrosoft.com` de fallback). Chave de
  encriptação de dados: **gerenciada pelo serviço** (não customer-managed —
  sem exigência de compliance que justifique a complexidade extra).
- **Backup**: retenção 7 dias (padrão).
- **Etiquetas**: `Ambiente=Producao`, `Sistema=erp_itp`,
  `Projeto=migracao-azure-itp` (aplicadas ao recurso "server").

**⏳ EM ANDAMENTO (2026-09-05):** scripts reutilizáveis de backup/restore/
verificação criados em `docs/superpowers/plans/scripts/` — pensados pra
servir os 3 bancos (erp_itp, aprxm_sys, DW), não só este.

- `pg-backup.sh <sistema> [imagem]` — dump `--format=custom` em
  `scripts/backups/<sistema>_<timestamp>.dump`.
- `pg-restore.sh <arquivo.dump> [imagem]` — restore excluindo
  automaticamente extensões proprietárias do Neon sem equivalente no Azure
  (hoje só `pg_session_jwt`, via filtro na TOC do `pg_restore -l`).
- `pg-verify.sh [imagem]` + `count_all.sql` — compara contagem de linhas de
  **todas** as tabelas entre origem e destino (não só as 3 citadas
  originalmente), usando `SOURCE_DATABASE_URL`/`TARGET_DATABASE_URL`.

**Achado ao testar (2026-09-05):** o `pg_dump` instalado localmente é
**16.12**, mas o servidor de origem do erp_itp é **17.11** — Postgres
recusa dump de servidor mais novo que o cliente (proteção do próprio
Postgres, não é bug). Em vez de instalar PostgreSQL 17 completo na máquina
(desnecessário — não precisamos de um servidor local, só do cliente),
os 3 scripts rodam via **Docker** (`docker run --rm postgres:<versão>-alpine`),
container descartável, nada fica instalado. Passar a imagem certa por
sistema: `postgres:17-alpine` pro erp_itp, `postgres:16-alpine` (default)
pro aprxm_sys/DW.

Alternativa equivalente, se preferir não usar Docker na máquina local:
rodar os mesmos comandos via **Azure Cloud Shell** — é a mesma operação
(cliente psql conectando nos dois bancos), só muda onde roda.

Pendente antes de fechar esta etapa: rodar `pg-backup.sh erp_itp
postgres:17-alpine` de verdade (validar o dump), criar `psql-erpitp-prod`,
depois `pg-restore.sh` + `pg-verify.sh` contra ele.

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

## Fase 4 — Pós-migração: engenharia de dados, pipelines, IA, backup

Só começa depois das Fases 1-3 estáveis em produção por pelo menos 1-2
semanas (mesmo critério de "não empilhar mudança em cima de mudança" das
fases anteriores). Itens de agenda, não runbook detalhado ainda — cada um
vira seu próprio spec/plano quando for a vez.

**Backup (o mais urgente dos 4, tratar primeiro):**
- Confirmar que o backup automático do Postgres Flexible Server (7 dias,
  já configurado nas Fases 2/3) está realmente restaurável — fazer um
  **teste de restore de verdade** num banco descartável, não só confiar
  que "tá configurado". Backup que nunca foi restaurado não é backup
  testado.
- Blob Storage (`staprxmmidia`): avaliar ativar **soft delete** de blob e
  **versionamento** (baixo custo, protege contra apagar foto/parquet por
  engano).
- Documentar RTO/RPO alvo (quanto tempo até recuperar, quanto dado se pode
  perder) — hoje não está definido em lugar nenhum, é a base pra qualquer
  decisão de backup daqui pra frente.

**Pipelines / engenharia de dados:**
- Formalizar o pipeline bronze→silver→gold que já existe (`datalake_service.py`)
  no ambiente novo — ele já funciona, a Fase 2.5 só troca o storage por
  baixo (R2→Blob), não muda a lógica. Aqui é sobre *documentar* e colocar
  monitoramento (alerta se o cron/Logic App do ETL falhar silenciosamente).
- Reavaliar a sugestão já registrada na Fase 2.2b: mover os cron jobs do
  Logic App pra `APScheduler` dentro do próprio processo do App Service —
  só depois do ambiente estabilizado, não como parte da migração.
- Ponytail: não introduzir Azure Data Factory/Synapse ou ferramenta pesada
  de orquestração — o volume de dado é de poucos MB, o pipeline em
  pandas/Python que já existe resolve. Trocar de ferramenta aqui seria
  over-engineering sem necessidade real.

**IA:** escopo ainda não definido — não vou especular o que entra aqui.
Quando chegar a hora, trazer requisitos concretos (que problema resolve,
que dado usa) pra brainstorming próprio, mesmo processo que usamos pra
essa migração. Pontas soltas já conhecidas pra revisar nessa conversa:
`@anthropic-ai/sdk` instalado no erp_itp sem uso encontrado no código, e
integração Gemini/Tavily de captação sem chaves ativas em produção hoje.

**Segurança adicional (já ficou registrada como "avaliar depois" na spec):**
- Azure Front Door + WAF na frente dos App Services — reavaliar se o
  tráfego público crescer (ex. matrícula aberta ao público) ou se aparecer
  tráfego suspeito. Não incluído nas Fases 1-3 porque o ganho não
  justificava o custo pro volume atual (7 usuários/dia).

---

## Checklist resumido (visão rápida, detalhe completo em cada fase acima)

- [x] **Fase 0** — Resource Group, orçamento, Key Vault
- [x] **Fase 0.5** — Exportar zona DNS · criar Azure DNS zone · recriar
      registros (e-mail M365 + CAA com CA do Azure) · trocar nameserver na
      Vercel · validar propagação
- [x] **Fase 1** — Piloto website_tia_pretinha (Static Web App → testado →
      cutover feito, domínio desvinculado do projeto Vercel em 2026-09-04 —
      registrador segue na Vercel, sem impacto nas Fases 2/3)
- [ ] **Fase 2** — aprxm_sys: banco → backend+crons → frontends
      (main/presidencia/painel) → storage (Supabase+R2→Blob) → DW → cutover
- [ ] **Fase 3** — erp_itp: sincronizar repo → banco (PG17) →
      backend+crons → frontend → Apps Script → cutover
- [ ] **Validação de segurança/latência** — antes de CADA swap das Fases 2 e 3
- [ ] **Fase 4** — pós-migração: teste de restore de backup, pipelines,
      IA (escopo a definir), Front Door/WAF (se necessário)

---

## Fora deste plano

- CI/CD com Actions customizado (health check automatizado pré-swap) — o
  Deployment Center do portal já gera um workflow básico; refinar smoke
  tests automatizados é uma iteração posterior, depois que o fluxo manual
  estiver validado em cada fase.
- SSO/Entra ID — fase separada, só depois das 3 fases acima estarem
  estáveis em produção (ver spec, seção Governança).
