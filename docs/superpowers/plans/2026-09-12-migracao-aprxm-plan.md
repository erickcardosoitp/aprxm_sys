# Revisão completa do APRXM + plano de migração (Vercel → infra própria)

Levantamento feito em 2026-09-12, combinando leitura de código, o
`ARQUITETURA.md` (revisão de 2026-08-01) e **consulta direta ao banco de
produção** para confirmar o que realmente está rodando — não só o que o
código diz que deveria.

> **Correção de um levantamento anterior meu (mesmo dia):** cheguei a
> escrever que a migração seria "estreita — só tirar o compute do Vercel,
> banco e storage já estão fora". Isso estava **errado por superficialidade**.
> O compute carrega junto o pipeline de dados inteiro, 4 frontends, WebAuthn
> amarrado ao domínio, e um conjunto de crons que hoje só funciona (quando
> funciona) por características do ambiente serverless. Este documento
> substitui aquele.

---

## 1. Inventário real do sistema

### 1.1 Aplicações a hospedar — são **quatro** frontends, não um

| App | Dockerfile? | nginx.conf? | Observação |
|---|---|---|---|
| `frontend/` | sim | sim | app principal (React 18 + Vite) |
| `painel/` | **não** | **não** | painel de governança, JWT isolado (`PAINEL_SECRET_KEY`) |
| `presidencia/` | **não** | **não** | |
| `simplifica-prototype/` | **não** | **não** | confirmar se é protótipo descartável ou está em uso |

Cada um tem seu próprio `vercel.json` com rewrite `/api/*` → backend.
Hoje o roteamento de API **existe só na Vercel** — o frontend chama URL
relativa (`/api/v1`, fallback em `services/api.ts:33`). Fora da Vercel,
isso vira bloco de nginx/Traefik que precisa ser escrito para os quatro.

### 1.2 Backend

FastAPI + SQLModel + asyncpg, entrypoint `api/index.py` (wrapper trivial da
Vercel — descartável, o `Dockerfile` já usa `uvicorn app.main:app`).

### 1.3 Dados — dois bancos Neon + um data lake

```
Neon "APRXM" (OLTP, 97 MB)        ──► Cloudflare R2, bucket `aprxm-datalake`
  59 tabelas em `public`                (bronze/ prata/ ouro/ _controle/ —
  + schemas: analytics, auth,            nomes reais em português, confirmado
    neon_auth, pgrst (resíduos)          direto no bucket)
                                                │
                                                ▼ (ouro/ também carrega pra cá)
                                   Neon "aprxm-analytics" (42 tabelas) ──► Power BI
```

**Confirmado direto no bucket R2** (`aprxm-datalake`): as 3 camadas
(bronze/prata/ouro) existem como parquet no R2 — "ouro" não é só carregado
no Neon analytics, também fica arquivado no R2. Último arquivo em
`bronze/` e `ouro/` é de **02/08/2026**, batendo com a parada do ETL
(§2.1). Amostra de `prata/` mostrou arquivo de 01/06/2026, mas foi só
os 5 primeiros objetos retornados (sem ordenação por data) — não é prova
de que silver parou antes, só não dá pra confirmar sem uma listagem completa.

**Volume real em produção (2026-09-12):**

| Tabela | Tamanho | Linhas |
|---|---|---|
| `api_request_logs` | **60 MB** | **182.708** |
| `packages` | 11 MB | 7.777 |
| `transactions` | 3 MB | 5.024 |
| `residents` | 1,4 MB | 2.121 |
| `mensalidades` | 1,2 MB | 1.789 |
| `users` / `associations` / `empresas` | — | 28 / 5 / 1 |

O banco todo tem 97 MB e **`api_request_logs` sozinha é 62% disso** (ver
§2.2 — é sintoma de um cron que não roda).

Schema migrado até **v24** (código e banco batem; o `ARQUITETURA.md` diz
"atualmente 21" — está desatualizado, v22-v24 entraram em 2026-08-02).

---

## 2. Achados críticos — coisas **já quebradas hoje**, antes de migrar

Estes não são riscos da migração. São problemas existentes, confirmados
com dado de produção. Migrar sem resolver só os leva junto.

### 2.1 🔴 O pipeline de dados está morto há ~6 semanas

`etl_runs` mostra que o último ETL bem-sucedido foi em **2026-08-01**.
Deveria rodar **2x por dia** (`0 12` e `0 20` UTC). Não roda desde então.

Consequência: **o Power BI está lendo dados congelados de 31/07/2026**
(confirmado direto no Data Warehouse: `MAX(data)` em `receita_diaria` =
31/07/2026, batendo com o último `etl_runs` de sucesso em 01/08) — **mais
de 6 semanas de defasagem**, sem ninguém ter percebido, até hoje (12/09).

Por que passou despercebido: o alerta de falha do ETL **não funciona**.
`datalake_service.py:1891` faz `await send_email(...)`, mas
`email_service.send_email` é função **síncrona** (`email_service.py:11`) e
o parâmetro está errado (`body=` onde a assinatura espera `html=`). O erro
é engolido pelo `except` de `:1896`. Ou seja: falha de ETL é silenciosa
por construção. (O `ARQUITETURA.md` §7 documenta um incidente P0 parecido
de 2026-08-01 — "carga falhava e era logada como success". Foi corrigido
naquele ponto, mas o **alerta** continua quebrado, e o pipeline parou
logo depois.)

### 2.2 🔴 A faxina semanal (`/ti/vacuum`) não roda

`api_request_logs` tem **182.708 linhas cobrindo desde 2026-07-06** — mais
de dois meses. O cron `0 3 * * 0` deveria apagar tudo com mais de 7 dias.
Na auditoria de 2026-08-01 a tabela tinha 88k linhas; **dobrou desde
então**, ocupando 60 MB dos 97 MB do banco.

### 2.3 🔴 Os dois crons de mensalidade nunca rodaram

`mensalidades.py:75` e `:157` declaram o parâmetro `request,` **sem
anotação de tipo**. O FastAPI trata parâmetro sem anotação como *query
param obrigatório* — então esses endpoints respondem **422 sempre**,
independente de auth.

Confirmação no banco: existem mensalidades de `2026-08` (244 linhas) e
`2026-09` (147 linhas), com `created_at` até 10-11/09 — mas tudo indica
geração **manual**, não via cron `0 8 1 * *` (que estava quebrado pelo bug
acima, 422 sempre). Achado à parte, não root-causado: um lote de
mensalidades com `reference_month` futuro (`2027-01` a `2027-06`) foi criado
em rajada única em 29-31/07/2026 por um mesmo `created_by` — parece geração
manual em massa por engano, não investigado a fundo.

### 2.4 🟠 Vercel cron dispara **GET**; os 8 handlers são **POST**

Todos os 8 endpoints em `vercel.json` estão declarados como `@router.post`.
Isso reforça 2.1/2.2/2.3 — é coerente com o quadro de "nenhum cron
funcionando de verdade". Vale confirmar nos logs da Vercel, mas a
evidência de banco (ETL parado, vacuum não rodando, mensalidade não
gerada) aponta na mesma direção.

### 2.5 🟠 `CRON_SECRET` vazio deixa 5 dos 8 endpoints abertos

O default é `""` (`config.py:53`), e 5 handlers têm o padrão
`if secret:` — ou seja, **secret vazio = sem autenticação nenhuma**.
Pior: há **três esquemas de auth diferentes e incompatíveis** entre si:

| Esquema | Endpoints |
|---|---|
| `Authorization: Bearer` + skip se vazio | demands, daily-tasks |
| `x-cron-secret` via `os.environ` (ignora o `.env` do pydantic) | mensalidades ×2, ti/vacuum |
| Bearer **sem** o skip (401 sempre se secret vazio) | crm/cron-scoring |
| Aceita ambos | datalake |

---

## 3. O que torna a migração **não-trivial**

### 3.1 O ETL roda dentro do processo web e vai travar a API

`/datalake/run` executa no mesmo event loop da API. `export_bronze`,
`build_silver` e `build_gold` são CPU-bound com pandas **direto na
corrotina** (`datalake_service.py`), sem thread. Na Vercel isso era
isolado numa invocação serverless própria — numa VM com um uvicorn, vai
**bloquear a API inteira por minutos, duas vezes por dia**.

→ Precisa virar processo/container separado (mesma imagem, comando
diferente), chamado pelo cron, não via HTTP.

### 3.2 Pool de conexões dimensionado para serverless

`database.py:16-20`: `pool_size=3, max_overflow=7`, com comentário
explícito de que cada instância serverless tem seu pool. Num processo
único de VM isso vira gargalo artificial — precisa subir.

`statement_cache_size=0` é obrigatório enquanto for Neon (PgBouncer).

### 3.3 WebAuthn/passkeys estão amarrados ao domínio

`WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` fazem parte da assinatura da
credencial. **Trocar de domínio invalida todas as passkeys já
registradas** — os usuários precisam registrar de novo. Isso é decisão de
produto, não só técnica: precisa de aviso aos usuários.

### 3.4 Headers de segurança e CSP só existem no `vercel.json`

`frontend/vercel.json:22-44` tem CSP completa + cache-control
(`index.html` no-store, `/assets/*` immutable). O `frontend/nginx.conf:8-11`
replica **4 headers e nenhuma CSP**. Migrar como está = **regressão de
segurança**. E a CSP atual libera `connect-src https://*.vercel.app` —
precisa apontar pro domínio novo.

### 3.5 Timezone muda o comportamento

Container roda UTC (`python:3.13-slim`, sem `TZ`). Parte das queries fixa
`America/Sao_Paulo` no SQL (seguro), mas `date.today()`/`datetime.utcnow()`
em Python (`demands.py:218`, `mensalidades.py:92,172`) seguem o relógio do
processo. Hoje é UTC na Vercel.

→ Fixar `TZ=UTC` no container para **preservar** a semântica atual, e
converter os horários de cron (as schedules da Vercel são UTC: `0 8 1 * *`
= 05h de Brasília).

### 3.6 Estado em memória por processo

`slowapi` (rate limit) e os circuit breakers (`core/resilience.py:162-167`)
guardam estado no processo. Com mais de um worker uvicorn, os limites
viram N× o configurado. → 1 worker, ou mover para Redis.

### 3.7 Outros pontos

- `main.py:106-116` grava um INSERT em `api_request_logs` por request,
  em `asyncio.create_task` sem referência forte (pode ser coletado pelo GC).
  Sem a faxina rodando (§2.2), cresce sem limite.
- `Dockerfile` roda como **root**, sem healthcheck, e `uvicorn` sem
  `--proxy-headers` → atrás de proxy, o IP registrado será o do proxy.
- `docker-compose.yml` é **dev-only** (bind mount, `--reload`, Postgres
  local `changeme`, 4 env vars mortas de Cloudinary). Não serve de base
  para produção.
- Migrations rodam no lifespan (`main.py:29-31`) junto com `create_all` +
  `seed_local_dev()` — revisar antes de rodar em produção containerizada.

---

## 4. Integrações externas (todas precisam de credencial replicada)

| Integração | Uso | Credenciais |
|---|---|---|
| **Supabase Storage** | uploads de mídia (fotos, assinaturas, áudio) | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET` |
| **Cloudflare R2** | data lake bronze/silver/gold (boto3/S3) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` |
| **Neon OLAP** | destino do gold → Power BI | `DATAWAREHOUSE_APRXM_DATABASE_URL` |
| **SMTP Gmail** | e-mails transacionais | `SMTP_HOST/PORT/USER/PASSWORD/FROM` |
| **Web Push (VAPID)** | notificação push (FCM/Mozilla) | `VAPID_PRIVATE_KEY` — exige egress HTTPS da VM |
| **WebAuthn** | passkeys | `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` (§3.3) |
| **Groq (LLM)** | agente | `GROQ_API_KEY` |
| **ViaCEP / BrasilAPI / Nominatim / OSM** | CEP, mapa (back e front) | nenhuma |

**Correção relevante:** o `ARQUITETURA.md` cita "Cloudinary" no diagrama.
Não há **nenhum** código lendo Cloudinary no backend — sobrevive só como
origem permitida na CSP e como 4 env vars mortas no `docker-compose.yml`.
O storage real é **Supabase Storage** (que o `ARQUITETURA.md` não menciona).

**Não existe:** webhook de entrada de terceiro, gateway de pagamento,
Twilio/WhatsApp, Sentry ou APM. Nenhuma dependência de binário externo
(tudo wheel puro). Nenhum uso de `/tmp` ou filesystem gravável — o
container pode rodar read-only (única leitura de disco são as fontes
DejaVu em `app/assets/fonts/` para PDF).

---

## 5. Variáveis de ambiente — 35+ para replicar

Hoje todas vivem no painel da Vercel. Duas são **obrigatórias** (app não
sobe): `DATABASE_URL`, `SECRET_KEY`. O `config.py` usa `extra="ignore"`,
então **variável faltando ou com nome errado passa silenciosamente** — não
há validação de "sobrou/faltou". Lista completa com defaults e uso:
ver `backend/app/config.py`.

Pontos de atenção:
- `VAPID_PUBLIC_KEY` tem **chave real hardcoded como default** no código.
- `CRON_SECRET` default `""` → §2.5.
- `ANALYTICS_DATABASE_URL` é legado, não mais lido — remover.
- `DATABASE_URL_DIRECT` está no `.env.example` mas **nenhum código lê**.
- Os dumps `.env.production`, `.env.vercel-prod`, `.env.pull-*` contêm
  `VERCEL_OIDC_TOKEN` e afins. **Estão corretamente no `.gitignore` e não
  rastreados** (verificado). Descartar na migração, não portar.

---

## 6. Decisões pendentes (precisam do usuário)

1. **Co-localizar na `vm-itp-prod` ou VM separada?**
   A VM atual (`Standard_E2bs_v5`, 2 vCPU/16GB após o resize de 2026-09-11)
   usa ~2,5 GB com 13 containers. Sobra espaço — **mas** o ETL (§3.1) é
   o consumidor de pico: pandas carregando as tabelas todas em DataFrame.
   Dimensionar pelo pico do ETL, não pelo estado estacionário.
2. **Domínio(s)**: quais domínios os 4 frontends vão usar? Define DNS,
   certificado e **o impacto nas passkeys** (§3.3).
3. **Power BI**: consome do Neon analytics via Desktop ou Service? Define
   se esse banco precisa continuar publicamente acessível.
4. **`simplifica-prototype/`**: entra na migração ou é descartável?
5. **Storage**: manter Supabase Storage ou consolidar em Azure Blob (como
   foi feito no erp_itp)? Manter é menos trabalho; consolidar reduz o
   número de fornecedores.
6. **Corrigir os bugs da §2 antes, durante ou depois da migração?**
   Recomendo **antes** — são independentes da migração, e migrar com o
   ETL morto significa validar a migração contra um pipeline que já não
   funciona.

---

## 7. Fases propostas

| Fase | O quê |
|---|---|
| **0. Correções pré-migração** | §2.1 a §2.5 — ressuscitar ETL, faxina, crons de mensalidade, padronizar auth de cron, consertar alerta de falha |
| **1. Decisões** | §6 (VM, domínios, storage, Power BI) |
| **2. Containerização** | Dockerfile de produção do backend (não-root, healthcheck, `--proxy-headers`), Dockerfiles dos 3 frontends que não têm, nginx com CSP/cache portados do `vercel.json` |
| **3. ETL isolado** | Extrair `/datalake/run` para container/processo próprio acionado por cron (§3.1) |
| **4. Env vars** | Replicar as 35+ da Vercel, com validação de obrigatórias no boot |
| **5. Crons** | Portar os 8 para o mecanismo já validado no erp_itp (`tarefas-registro.json` + `tarefas_runner.py` do ITP_TEC — dá timing real, log estruturado e execução manual de graça) |
| **6. DNS/TLS** | Traefik + Let's Encrypt, mesmo padrão do resto do parque |
| **7. Validação paralela** | Rodar VM e Vercel lado a lado antes de cortar (mesmo padrão cauteloso do erp_itp) |
| **8. Corte** | Desligar Vercel só após validação |

---

## 9. Plano de correções — do mais simples ao mais difícil

Todos os itens abaixo são **independentes da decisão de migrar** (§6) —
são bugs/dívidas reais de hoje. Ordenados por esforço, não por
prioridade de negócio (o item mais simples pode não ser o mais urgente).

### 🟢 Trivial (1 linha, sem efeito colateral, sem infra)

1. **Corrigir os 2 crons de mensalidade (§2.3)** — `mensalidades.py:75,157`:
   trocar `request,` por `request: Request,`. Sem isso o FastAPI trata como
   query param obrigatório e responde 422 sempre. 2 linhas, testável na hora
   (`curl -X POST .../cron-generate -H "x-cron-secret: ..."`).
2. **Corrigir o alerta de falha do ETL (§2.1)** — `datalake_service.py:1891`:
   `email_service.send_email` é função síncrona, chamada errada com `await`
   e parâmetro errado (`body=` em vez de `html=`). Ajustar a chamada pra
   bater com a assinatura real. Sem isso, falha de ETL continua invisível
   pra sempre — é o bug que permitiu a lacuna de 6 semanas passar batido.
3. **Remover `ANALYTICS_DATABASE_URL` (legado)** do `.env.example` e de
   qualquer lugar que ainda cite — confirmado que nada mais lê essa var.
4. **Remover as 4 env vars mortas de Cloudinary** do `docker-compose.yml`
   (`STORAGE_PROVIDER`, `CLOUDINARY_*`) — zero código as lê.
5. **Apagar os dumps `.env.vercel-prod`/`.env.pull-*` do disco local**
   depois de extrair o que for preciso pra migração — já confirmado que
   não estão no git, mas não devem ficar soltos indefinidamente com
   credencial de produção em texto puro.

### 🟡 Simples (poucas linhas, precisa de teste, sem mudança de arquitetura)

6. **Padronizar autenticação dos 8 crons (§2.5)** — hoje são 3 esquemas
   incompatíveis (`Authorization: Bearer` com/sem skip, `x-cron-secret`
   via `os.environ`). Escolher **um** padrão (recomendo `x-cron-secret`,
   já que é o que 3 dos 8 usam) e aplicar nos 8. Fazer `CRON_SECRET`
   **obrigatório** em produção (falhar no boot se vazio e `APP_ENV=production`)
   em vez de default `""` que abre os endpoints.
7. **Trocar `@router.post` por `@router.get` nos 8 endpoints de cron (§2.4)**
   — Vercel cron sempre dispara GET; é bem provável que essa seja a causa
   raiz de tudo em §2.1-§2.3 nunca ter rodado de verdade. **Fazer isso
   depois do item 6** (senão fica exposto sem auth por mais tempo) e
   **testar manualmente os 8 antes de confiar no cron de novo**.
8. **Confirmar que o ETL e o vacuum voltaram a rodar** — depois de 6+7,
   observar os próximos 2 ciclos de `etl_runs` e o tamanho de
   `api_request_logs` caindo. Sem essa confirmação, os fixes de código
   são teoria, não fato (mesmo padrão de rigor que apliquei nesta revisão).
9. **Fixar `TZ=UTC`** explícito no Dockerfile do backend (hoje é implícito
   pela imagem base — deixar explícito evita regressão se a imagem base
   mudar o default um dia).
10. **Adicionar healthcheck + usuário não-root ao `backend/Dockerfile`**
    — hoje roda como root, sem healthcheck. Padrão básico de produção,
    sem mudar nada de lógica.
11. **Adicionar `--proxy-headers --forwarded-allow-ips` no uvicorn** —
    sem isso, atrás de qualquer proxy (nginx/Traefik), o IP registrado em
    `api_request_logs` e usado pelo rate limit (`slowapi`) é o do proxy,
    não o do cliente real.

### 🟠 Moderado (requer decisão de design, ainda que pequena)

12. **Portar a CSP e o cache-control do `frontend/vercel.json` pro
    `nginx.conf`** (§3.4) — hoje `nginx.conf` replica só 4 headers e
    nenhuma CSP. Precisa decidir a CSP final (trocar `*.vercel.app` pelo
    domínio novo) antes de escrever — depende de §6.2 (domínio).
13. **Criar Dockerfile + nginx.conf para `painel/` e `presidencia/`**
    (espelhando o de `frontend/`) — mecânico, mas precisa confirmar que
    os dois ainda estão em uso antes de gastar esforço (§6.4 cobre isso
    junto com `simplifica-prototype/`).
14. **Subir `pool_size`/`max_overflow` do SQLAlchemy** (§3.2) — hoje
    dimensionado pra serverless (`pool_size=3`). Só faz sentido calibrar
    depois de saber quantos workers/réplicas a VM vai rodar (depende de
    §6.1, co-localizar ou não).
15. **Decidir o esquema de 1 worker uvicorn (ou mover rate-limit/circuit
    breaker pra Redis)** (§3.6) — mais simples é fixar 1 worker; só some
    a decidir mover pra Redis se a carga realmente exigir mais de 1.

### 🔴 Difícil (mudança de arquitetura ou coordenação externa)

16. **Extrair `/datalake/run` do processo web (§3.1)** — é CPU-bound com
    pandas rodando direto na corrotina da API. Precisa virar um comando
    separado da mesma imagem (`python -m app.jobs.datalake_run` ou
    similar), chamado pelo cron via `docker exec`/container próprio, não
    mais via HTTP dentro do mesmo processo do uvicorn. Não é reescrever o
    ETL, é só mudar **onde** ele roda — mas toca o mecanismo de disparo
    (hoje é HTTP + `CRON_SECRET`, precisaria virar invocação direta de
    processo) e como o resultado é registrado em `etl_runs`.
17. **Coordenar a virada de domínio do WebAuthn (§3.3)** — não é código,
    é comunicação: todo usuário com passkey registrada perde o acesso por
    passkey no dia da troca de domínio e precisa registrar de novo. Exige
    aviso prévio, não só deploy.
18. **A migração em si** (fases da §7) — depende de todas as decisões da
    §6 estarem fechadas primeiro. É o item mais difícil porque depende
    dos outros 17 estarem resolvidos ou conscientemente adiados.

### Ordem recomendada de execução

Itens 1-11 podem (e devem) ser feitos **já, no Vercel, antes de qualquer
decisão de migração** — são bugs de produção, corrigi-los não depende de
decidir onde o sistema vai morar. Itens 12-15 dependem de decisões da
§6. Itens 16-18 são a migração propriamente dita.

---

## 10. O que **não** precisa mudar

- Banco OLTP (Neon "APRXM") e OLAP (Neon "aprxm-analytics") — ficam
- Cloudflare R2 — fica
- Autenticação JWT própria — sem motivo para trocar por SSO aqui
- SMTP — fica (avaliar migrar para Graph API como no erp_itp só se o
  Gmail app password virar problema)
