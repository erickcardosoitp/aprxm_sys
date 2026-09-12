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
Neon "APRXM" (OLTP, 97 MB)        ──► Cloudflare R2 (bronze/silver/gold)
  59 tabelas em `public`                        │
  + schemas: analytics, auth,                   ▼
    neon_auth, pgrst (resíduos)      Neon "aprxm-analytics" (42 tabelas) ──► Power BI
```

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

Confirmação no banco: a linha mais recente de `mensalidades` foi criada em
**31/07/2026**. Nada em agosto, nada em setembro — apesar do cron mensal
`0 8 1 * *`. A geração de mensalidade está sendo feita só manualmente.

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

## 8. O que **não** precisa mudar

- Banco OLTP (Neon "APRXM") e OLAP (Neon "aprxm-analytics") — ficam
- Cloudflare R2 — fica
- Autenticação JWT própria — sem motivo para trocar por SSO aqui
- SMTP — fica (avaliar migrar para Graph API como no erp_itp só se o
  Gmail app password virar problema)
