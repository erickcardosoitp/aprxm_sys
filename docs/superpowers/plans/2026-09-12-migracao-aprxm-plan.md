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

> **Status (2026-09-12):** diagnóstico, achados críticos (§2) e as 6
> decisões (§6) estão **fechados**. Os itens 1-11 do plano de correções
> (§9) estão **corrigidos e confirmados em produção**. As próximas fases
> (execução da migração em si) estão detalhadas em
> [`2026-09-12-migracao-aprxm-execucao.md`](2026-09-12-migracao-aprxm-execucao.md)
> — este documento fica como registro do diagnóstico e das decisões,
> não é mais o checklist de trabalho ativo.

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

### 2.6 🔴 Um 9º mecanismo, achado só em 2026-09-12: `sync_pix_bank_statements`

Não fazia parte do levantamento original dos "8 crons" — vive em
`admin.py`, num sistema `scheduled_tasks` por associação com botão manual
no painel (`/admin/scheduled-tasks/{task_key}/run`), **sem nenhum cron
real por trás** (nem Vercel, nem OS) apesar de ter um `schedule_cron`
"0 8 * * *" só **descritivo** na UI. Mesma classe de bug dos outros:
automação que parece existir mas nunca foi ligada de verdade.

Confirmado em produção: 1.378 transações PIX (R$ 8.730,50) sem
sincronizar em `bank_statements` desde 02/06/2026 — mais de 3 meses.
**Corrigido e sincronizado em 2026-09-12** (ver plano de execução, seção
"Fase B+ — sync_pix_bank_statements como 9º cron"). Um segundo bug real
foi encontrado na própria query ao rodar de verdade: o `NOT EXISTS` por
`transaction_id` não é suficiente porque existe uma constraint
`idx_bs_dedup` mais ampla (`association_id, bank, date, name, amount`) —
duas transações distintas com mesmo nome/valor/data colidem. Corrigido
com `ON CONFLICT ... DO NOTHING`. Restam 58 transações com colisão real
de dedup, não resolvidas (precisa de decisão de negócio, não é bug de
código).

---

## 3. O que torna a migração **não-trivial**

### 3.1 O ETL roda dentro do processo web e vai travar a API

`/datalake/run` executa no mesmo event loop da API. `export_bronze`,
`build_silver` e `build_gold` são CPU-bound com pandas **direto na
corrotina** (`datalake_service.py`), sem thread. Na Vercel isso era
isolado numa invocação serverless própria — numa VM com um uvicorn, vai
**bloquear a API inteira por minutos, duas vezes por dia**.

→ **Decisão (2026-09-12): migração completa e nativa pro servidor, sem
etapa intermediária.** Nada de manter o disparo via HTTP/`CRON_SECRET`
como ponte "por enquanto" — o ETL vira um comando Python invocado
diretamente pelo cron do sistema operacional na VM (mesmo padrão do
`tarefas_runner.py` do ITP_TEC), não uma rota HTTP chamada de fora. Ver
`2026-09-12-migracao-aprxm-execucao.md`, Fase A.

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

### 3.4 Headers de segurança e CSP — ~~sem efeito após decisão do §6.2~~

`frontend/vercel.json:22-44` tem CSP completa + cache-control. Como os 4
frontends **ficam na Vercel** (§6.2), o `vercel.json` continua sendo a
fonte real de headers — `frontend/nginx.conf` (que replica só 4 headers e
nenhuma CSP) segue existindo mas fora do caminho de produção. Só volta a
importar se um dia decidirem tirar os frontends da Vercel também.

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
- ~~`DATABASE_URL_DIRECT` está no `.env.example` mas nenhum código lê~~ —
  **correção (2026-09-12): estava errado.** É usado em `admin.py:472`
  como conexão sem pooler pro VACUUM manual do painel admin. Achado ao
  tentar removê-lo de fato (ver doc de execução, pendência 2) — lição:
  confirmar no código, não só repetir o levantamento anterior.
- Os dumps `.env.production`, `.env.vercel-prod`, `.env.pull-*` contêm
  `VERCEL_OIDC_TOKEN` e afins. **Estão corretamente no `.gitignore` e não
  rastreados** (verificado). Descartar na migração, não portar.

---

## 6. Decisões (fechadas em 2026-09-12)

1. ✅ **Co-localizar na `vm-itp-prod`.** **Correção (confirmado via SSH em
   2026-09-12): os "128 GB" mencionados são o DISCO, não RAM** — a VM tem
   na verdade **15 GB de RAM, 2 vCPUs** (Xeon Platinum 8370C),
   compartilhados com Postgres, Traefik, Grafana, Prometheus, erp_itp e
   catálogo (usando ~3,2 GB antes do APRXM subir). Mesmo assim, medido na
   prática após o deploy: backend do APRXM em repouso usa ~171 MB, e
   rodando o ETL completo (pandas com as tabelas reais de produção) usa
   ~174 MB — folga enorme mesmo com limite de 2 GB no container. Risco de
   memória era mais teórico que real, dado o volume atual de dados (banco
   de 97 MB). Decisão confirmada: co-localizar, com `mem_limit: 2g` no
   container como trava de segurança.
2. ✅ **Escopo da migração é só o backend.** Os 4 frontends (`frontend/`,
   `painel/`, `presidencia/`, `simplifica-prototype/`) **ficam na Vercel
   free** (hospedagem estática, sem custo). Só o backend (FastAPI + ETL +
   crons) migra pra VM, atrás de um domínio próprio (ex.
   `api-aprxm.institutotiapretinha.org`). Cada frontend só precisa trocar
   o rewrite `/api/*` do seu `vercel.json` pra apontar pro domínio novo do
   backend, em vez da function serverless.
   **Consequência direta:** isso **elimina** a necessidade de Dockerfile
   + nginx.conf + CSP pros 4 frontends (itens 12 e 13 do §9, que
   assumiam migrar tudo) — o domínio do frontend não muda, então as
   passkeys (§3.3) também não são afetadas. `frontend/nginx.conf` e os
   `Dockerfile`s de frontend seguem existindo mas **não entram no
   escopo desta migração**.
3. ✅ **`simplifica-prototype/` está em uso** — decisão foi migrar
   junto, mas como fica na Vercel (decisão 2), não precisa de trabalho
   extra de containerização agora.
4. ✅ **Storage: consolidar em Azure Blob**, mesmo padrão já adotado no
   erp_itp — reduz fornecedores. Fica pendente o trabalho de migração dos
   arquivos existentes no Supabase Storage (não estimado ainda).
5. ✅ **Power BI usa o Service (nuvem)**, não Desktop — o Neon analytics
   **precisa continuar publicamente acessível** (refresh agendado exige
   handshake direto ou gateway on-premises; sem gateway configurado hoje,
   manter acesso público é o caminho de menor esforço).
6. ✅ **Corrigir os bugs da §2 antes da migração** — feito (ver §9,
   itens 1-11 fechados em 2026-09-12).

---

## 7. Fases propostas

Escopo fechado em §6: **só o backend migra.** Os 4 frontends continuam na
Vercel free — nada nas fases abaixo toca `frontend/`, `painel/`,
`presidencia/` ou `simplifica-prototype/`.

| Fase | O quê |
|---|---|
| **0. Correções pré-migração** | §2.1 a §2.5 — ressuscitar ETL, faxina, crons de mensalidade, padronizar auth de cron, consertar alerta de falha. **✅ Concluída (2026-09-12).** |
| **1. Decisões** | §6 — **✅ Concluída (2026-09-12).** |
| **2. Containerização do backend** | Dockerfile de produção (não-root, healthcheck, `--proxy-headers`) — **✅ já feito** (itens 9-11 do §9). Nada a fazer nos frontends. |
| **3. ETL isolado** | Extrair `/datalake/run` para container/processo próprio acionado por cron (§3.1) |
| **4. Env vars** | Replicar as 35+ da Vercel, com validação de obrigatórias no boot |
| **5. Crons** | Portar os 8 para o mecanismo já validado no erp_itp (`tarefas-registro.json` + `tarefas_runner.py` do ITP_TEC — dá timing real, log estruturado e execução manual de graça) |
| **6. Storage** | Migrar arquivos de Supabase Storage → Azure Blob, trocar código de upload/leitura |
| **7. DNS/TLS** | Domínio próprio do backend (ex. `api-aprxm.institutotiapretinha.org`) atrás de Traefik + Let's Encrypt, mesmo padrão do resto do parque |
| **8. Rewrite dos 4 frontends** | Trocar `/api/*` no `vercel.json` de cada frontend pra apontar pro domínio novo do backend |
| **9. Validação paralela** | Rodar VM e Vercel lado a lado antes de cortar (mesmo padrão cauteloso do erp_itp) |
| **10. Corte** | Desligar a function serverless do backend na Vercel só após validação |

---

## 9. Plano de correções — do mais simples ao mais difícil

Todos os itens abaixo são **independentes da decisão de migrar** (§6) —
são bugs/dívidas reais de hoje. Ordenados por esforço, não por
prioridade de negócio (o item mais simples pode não ser o mais urgente).

### 🟢 Trivial (1 linha, sem efeito colateral, sem infra)

1. ✅ **Corrigir os 2 crons de mensalidade (§2.3)** — `mensalidades.py:75,157`:
   trocar `request,` por `request: Request,`. Sem isso o FastAPI tratava como
   query param obrigatório e respondia 422 sempre. **Feito e confirmado em
   produção** (2026-09-12).
2. ✅ **Corrigir o alerta de falha do ETL (§2.1)** — `datalake_service.py:1891`:
   `email_service.send_email` é função síncrona, estava sendo chamada com
   `await` e parâmetro errado (`body=` em vez de `html=`). **Corrigido.**
3. ✅ **Remover `ANALYTICS_DATABASE_URL` (legado)** — confirmado que nada
   mais lê essa var, removido de `config.py`. **Feito.**
4. ✅ **Remover as 4 env vars mortas de Cloudinary** do `docker-compose.yml`
   (`STORAGE_PROVIDER`, `CLOUDINARY_*`) — zero código as lê. **Feito.**
5. ✅ **Apagar os dumps `.env.vercel-prod`/`.env.pull-*` do disco local**
   — feito; confirmado antes que não estavam no git.

### 🟡 Simples (poucas linhas, precisa de teste, sem mudança de arquitetura)

6. ✅ **Padronizar autenticação dos 8 crons (§2.5)** — eram 3 esquemas
   incompatíveis. **Decisão tomada na prática (diferente da recomendação
   original deste plano):** padronizado em `Authorization: Bearer
   <CRON_SECRET>` via `settings.cron_secret` (pydantic-settings), não
   `x-cron-secret`/`os.environ` — porque é isso que o Vercel Cron
   realmente envia (confirmado no código pré-existente de `datalake.py`,
   que já comentava isso). `mensalidades.py` e `ti.py` liam
   `x-cron-secret`, um header que o Vercel **nunca envia** — essa era a
   causa raiz real desses dois crons nunca funcionarem via cron automático
   (não só o bug do item 1). `CRON_SECRET` obrigatório em prod fica como
   dívida ainda aberta (não implementado).
7. ✅ **Aceitar GET nos 8 endpoints de cron (§2.4)** — Vercel Cron só
   dispara GET; os 8 eram `@router.post`, respondendo 405 sempre. Trocado
   para `@router.api_route(..., methods=["GET", "POST"])` (mantém POST pra
   chamada manual/teste). **Confirmada a causa raiz:** era isso, não teoria.
8. ✅ **Confirmado que ETL e vacuum voltam a rodar** — testado GET real
   contra produção em 2026-09-12 com o secret verdadeiro, nos 8 endpoints:
   - `datalake/run`: rodou ETL completo pela primeira vez em ~6 semanas
     (bronze/silver/gold populados, `run_id` novo).
   - `ti/vacuum`: rodou 15/16 tabelas; achou 2º bug real (item 8b).
   - `mensalidades/cron-generate`, `cron-check-overdue`: 200, dados corretos.
   - `crm/cron-scoring`: 200, 516 membros pontuados.
   - `daily-tasks/reminders/trigger`: 200, 32 lembretes enviados.
   - `demands/reminders/trigger`: 500 na primeira tentativa (item 8b),
     corrigido e reconfirmado 200.

   **8b. Dois bugs novos, só visíveis rodando de verdade (não achados por
   leitura de código):**
   - `ti/vacuum` referenciava tabela `finance_transactions`, que não
     existe — tabela real é `transactions` (`app/models/finance.py:103`).
     Corrigido.
   - `demands/reminders/trigger` tinha o **mesmo bug de bind asyncpg**
     do item 2.3 (`date.today().isoformat()` bindado como string contra
     coluna `DATE`) **e**, depois de corrigir isso, uma 2ª causa: query
     referenciava `so.order_number`, coluna que não existe em
     `service_orders` — a coluna real é `so.number` (já usada
     corretamente em outro SELECT do mesmo arquivo). Ambos corrigidos e
     reconfirmados com 200 em produção.
9. ✅ **Fixar `TZ=UTC`** explícito no Dockerfile do backend. **Feito.**
10. ✅ **Healthcheck + usuário não-root no `backend/Dockerfile`** — usa
    `/health` (rota pública já existente; `ti/health` exige auth admin,
    não serve). **Feito.** Não testado com build real (Docker Desktop
    parado no momento) — só relevante quando sair do Vercel, hoje não
    afeta produção (Vercel usa `@vercel/python`, ignora este Dockerfile).
11. ✅ **`--proxy-headers --forwarded-allow-ips` no uvicorn** — **Feito**,
    mesma ressalva do item 10 (dorme até a migração sair do Vercel).

### 🟠 Moderado (requer decisão de design, ainda que pequena)

> **Itens 12, 13 e 17 (WebAuthn) da versão anterior deste plano foram
> eliminados pela decisão do §6.2** — só o backend migra, os 4 frontends
> ficam na Vercel. Sem troca de domínio de frontend, não há CSP pra
> portar, não há Dockerfile/nginx de `painel`/`presidencia` pra criar, e
> as passkeys não são afetadas. Renumerado abaixo.

12. **Subir `pool_size`/`max_overflow` do SQLAlchemy** (§3.2) — hoje
    dimensionado pra serverless (`pool_size=3`). Calibrar agora que a VM
    (co-localizada, §6.1) e o nº de workers uvicorn (item 13) estão
    decididos.
13. **Fixar 1 worker uvicorn** (§3.6) — `slowapi` (rate limit) e os
    circuit breakers guardam estado no processo; com >1 worker os limites
    viram N× o configurado. Mais simples é fixar 1 worker; só mover
    pra Redis se a carga real exigir mais.
14. **Migrar arquivos de Supabase Storage → Azure Blob** (§6.4) — trocar
    código de upload/leitura (hoje contradiz `ARQUITETURA.md`, que cita
    Cloudinary por engano — real é Supabase) e migrar os arquivos
    existentes. Escopo/volume ainda não levantado.

### 🔴 Difícil (mudança de arquitetura ou coordenação externa)

15. **Extrair `/datalake/run` do processo web (§3.1)** — migração
    **completa e nativa** pro servidor, sem HTTP como intermediário (ver
    Fase A do doc de execução). Não é reescrever o ETL, é só mudar
    **onde e como** ele é disparado — toca o mecanismo de disparo (hoje é
    HTTP + `CRON_SECRET`, vira invocação direta de processo pelo cron do
    SO) e como o resultado é registrado em `etl_runs`.
16. **Domínio + TLS do backend e rewrite dos 4 frontends** — provisionar
    `api-aprxm.institutotiapretinha.org` (ou equivalente) atrás de
    Traefik/Let's Encrypt na VM, depois trocar o rewrite `/api/*` no
    `vercel.json` de cada um dos 4 frontends pra apontar pra lá. Sem
    impacto em passkey (domínio do frontend não muda), mas precisa de
    janela de corte coordenada (DNS + validação antes de desligar a
    function da Vercel).
17. **A migração em si** (fases da §7) — depende dos itens 12-16
    resolvidos ou conscientemente adiados.

### Ordem recomendada de execução

Itens 1-11: ✅ **concluídos em 2026-09-12** (bugs de produção, corrigidos
independente de decisão de migração). Itens 12-14 dependem só de
execução (decisões já fechadas em §6). Itens 15-17 são a migração
propriamente dita.

---

## 10. O que **não** precisa mudar

- Banco OLTP (Neon "APRXM") e OLAP (Neon "aprxm-analytics") — ficam
- Cloudflare R2 — fica
- Autenticação JWT própria — sem motivo para trocar por SSO aqui
- SMTP — fica (avaliar migrar para Graph API como no erp_itp só se o
  Gmail app password virar problema)
