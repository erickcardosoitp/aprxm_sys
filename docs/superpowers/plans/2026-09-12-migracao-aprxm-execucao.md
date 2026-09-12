# Execução da migração do APRXM (backend → VM) — plano de fases

> Continua [`2026-09-12-migracao-aprxm-plan.md`](2026-09-12-migracao-aprxm-plan.md)
> (diagnóstico + achados críticos + as 6 decisões, todos fechados). Este
> documento é o checklist de execução das fases que faltam, uma a uma.

> **Status (2026-09-12):** Fases A, B e C **concluídas e validadas contra
> produção** (código no ar, testado, sem regressão). Fase F parcialmente
> concluída (validação de boot). **Tudo que dava pra deixar pronto sem
> acesso à VM/DNS já está feito** — o que falta depende de infraestrutura
> real (SSH na VM, DNS, ou levantamento de dado externo). Ver "Pendências
> para as próximas vezes" no fim do documento, ordenadas da mais fácil
> pra mais difícil.

**Escopo fechado (§6 do doc anterior):** só o backend migra pra
`vm-itp-prod` (128 GB, co-localizada). Os 4 frontends ficam na Vercel
free — nenhuma fase abaixo toca `frontend/`, `painel/`, `presidencia/`
ou `simplifica-prototype/` além do rewrite de URL na Fase G.

**Princípio orientador desta rodada (2026-09-12):** o ETL migra
**completo e nativo pro servidor — nada de etapa intermediária.** Ou
seja: não vamos manter o disparo via HTTP/`CRON_SECRET` como uma ponte
"por enquanto" enquanto o resto não migra. O cron do sistema operacional
na VM invoca o processo Python **diretamente**, sem passar por uma rota
HTTP. Esse mesmo princípio se aplica, na Fase B, aos outros 7 crons.

---

## Garantia de continuidade — o sistema não pode ficar fora do ar

Regra que vale pra **toda** fase daqui pra frente, não só uma etapa
isolada:

1. **Nunca desligar o lado antigo antes do novo estar validado rodando de
   verdade.** Já é o padrão seguido em A/B (cron nativo só substitui o da
   Vercel depois de N ciclos reais confirmados) — continua valendo pra
   domínio (E), storage (D) e frontends (G).
2. **O banco (Neon) é compartilhado pelos dois lados o tempo todo.** Não
   existe estado que vive só na VM ou só na Vercel durante a transição —
   os dois lados leem/escrevem o mesmo Postgres. Isso é o que torna
   possível rodar em paralelo (Fase H) sem duas fontes de verdade
   divergentes. O único cuidado real: **nunca deixar os dois lados
   disparando o mesmo cron ao mesmo tempo** (duplicaria mensalidade,
   duplicaria e-mail de lembrete etc.) — por isso B mantém o cron da
   Vercel ativo até o nativo estar confirmado, nunca os dois juntos.
3. **O corte de domínio (Fase E→G) é 1 linha por frontend, reversível em
   segundos.** Trocar o rewrite `/api/*` no `vercel.json` de cada
   frontend e fazer `git push` é o único ato de corte de verdade — se
   algo quebrar, reverter é outro `git push` com o rewrite antigo. Isso
   só deve acontecer **depois** que o domínio novo (Fase E) já responde
   `/health` de forma estável por um período — nunca apontar o frontend
   pro domínio novo no mesmo dia em que ele sobe.
4. **Os frontends nunca saem da Vercel** (decisão §6.2) — o usuário final
   nunca fica sem UI pra acessar; na pior hipótese, a API fica
   temporariamente inacessível (erro de rede na tela), não a aplicação
   inteira fora do ar.
5. **Nada do que já foi commitado até agora (Fases A/B/C/F) causa
   downtime.** Só trocamos *como* os crons são chamados e calibramos
   configuração — a API em produção (Vercel) nunca parou de responder e
   continua sendo a única fonte real de tráfego até a Fase G acontecer.
6. **Rollback de cada fase é documentado dentro da própria fase** (ver
   "Risco / rollback" na Fase A, por exemplo) — antes de aplicar
   qualquer fase que toque produção de verdade, confirmar que o rollback
   dela está claro, não só o passo pra frente.

---

## Fase A — ETL: migração completa e nativa ✅ concluída (2026-09-12)

### O que existe hoje

`app/services/datalake_service.py:1900` — `run_full_etl(session, force_full=False, triggered_by="cron")`
já é uma função de serviço pura: recebe uma `AsyncSession`, não depende do
FastAPI `Request`, e faz tudo (bronze → prata → ouro → carga no Neon
analytics → registro em `etl_runs`/`etl_task_runs` → alerta por e-mail em
caso de falha). O único acoplamento ao HTTP é o *disparo*:
`app/routers/datalake.py:79-92` (`trigger_etl_cron`, é o que o
`vercel.json` chama) e `:96-103` (`trigger_etl_manual`, chamado pelo
frontend/admin).

Isso significa: **não precisa reescrever nada do ETL em si** — só trocar
*como ele é chamado*.

### Passo a passo

1. **Criar `backend/app/jobs/__init__.py` e `backend/app/jobs/run_etl.py`**
   — script standalone:
   ```python
   import asyncio
   import sys
   from app.database import AsyncSessionLocal
   from app.services.datalake_service import run_full_etl

   async def main() -> int:
       async with AsyncSessionLocal() as session:
           try:
               result = await run_full_etl(session, triggered_by="cron-nativo")
               print(result)
               return 0
           except Exception as e:
               print(f"ETL falhou: {e}", file=sys.stderr)
               return 1

   if __name__ == "__main__":
       sys.exit(asyncio.run(main()))
   ```
   Nenhuma lógica nova — só o wrapper de invocação. `run_full_etl` já
   grava sucesso/falha em `etl_runs` e dispara o alerta por e-mail (já
   corrigido, ver doc anterior §9 item 2) independente de quem chamou.

2. **Cron nativo na VM**, dois horários (mesmos do `vercel.json`, UTC):
   ```
   0 12 * * * docker exec aprxm_backend python -m app.jobs.run_etl >> /var/log/aprxm/etl.log 2>&1
   0 20 * * * docker exec aprxm_backend python -m app.jobs.run_etl >> /var/log/aprxm/etl.log 2>&1
   ```
   `docker exec` no mesmo container do backend evita duplicar ambiente
   (pandas, boto3, credenciais já estão lá). Se o backend não rodar
   containerizado na VM, ajustar para invocação direta do venv.

3. **Remover o cron do `vercel.json`** para `/api/v1/datalake/run` (as
   duas entradas `0 12 * * *` e `0 20 * * *`) — mas **manter a rota HTTP**
   (`trigger_etl_cron`/`trigger_etl_manual`) sem cron apontando pra ela,
   só para disparo manual autenticado (debug/admin). Isso não é "manter
   intermediário": é manter uma via de emergência manual, igual a
   qualquer outro endpoint administrativo — o **agendamento real** passa
   a ser 100% nativo.

4. **Testar manualmente antes de agendar**: `docker exec aprxm_backend
   python -m app.jobs.run_etl` uma vez, conferir `etl_runs` e o R2.

5. **Validar 2 ciclos agendados reais** (12h e 20h UTC) antes de
   considerar a fase concluída — mesmo padrão de rigor aplicado nesta
   sessão (não confiar em teoria, confirmar com execução real).

### Arquivos tocados
- Novo: `backend/app/jobs/__init__.py`, `backend/app/jobs/run_etl.py`
- `backend/vercel.json` (remove as 2 entradas de cron do ETL)
- Crontab da VM (fora do repo, ou versionado em `infra/` se existir
  padrão pra isso no parque ITP — confirmar com o mesmo mecanismo do
  erp_itp)

### Risco / rollback
Se o cron nativo falhar silenciosamente, não há mais fallback
automático — por isso o passo 5 (validar 2 ciclos reais) é obrigatório
antes de remover o cron da Vercel de vez. Rollback: re-adicionar as 2
entradas no `vercel.json` e fazer deploy — a rota HTTP nunca foi
removida, só parou de ser chamada por cron.

### O que ficou feito

- ✅ `backend/app/jobs/run_etl.py` criado, testado com sucesso contra
  produção real (`status: success`, novo `run_id`).
- ✅ Removidas as 2 entradas de `/api/v1/datalake/run` do `vercel.json`.
  Rota HTTP mantida, sem cron apontando.
- ⏸️ **Pendente (precisa de VM):** instalar o cron de fato (`crontab -u
  <usuário> backend/deploy/crontab.aprxm`, linhas do ETL) e validar os 2
  ciclos reais agendados. **Até lá, decisão do usuário: rodar o ETL
  manualmente via `POST /api/v1/datalake/run`** — não há cron nenhum
  ativo pro ETL neste meio-tempo (aceito conscientemente).

---

## Fase B — Portar os outros 7 crons para o mesmo mecanismo nativo ✅ código concluído (2026-09-12)

Mesmo princípio da Fase A, aplicado aos 7 endpoints restantes. Diferença:
a lógica desses 7 está **inline no handler do router** (não numa função
de serviço separada como o ETL) — precisa extrair antes de poder chamar
fora do FastAPI.

| # | Endpoint atual | Schedule (UTC) | Lógica hoje |
|---|---|---|---|
| 1 | `ti/vacuum` | `0 3 * * 0` | inline em `run_vacuum` (`ti.py:595`) |
| 2 | `mensalidades/cron-generate` | `0 8 1 * *` | inline em `cron_generate` (`mensalidades.py:74`) |
| 3 | `mensalidades/cron-check-overdue` | `0 9 * * *` | inline em `cron_check_overdue` (`mensalidades.py:153`) |
| 4 | `crm/cron-scoring` | `0 6 * * *` | chama `run_scoring_all(session)` — já é service function |
| 5 | `demands/reminders/trigger` | `0 11 * * *` | inline em `trigger_reminders` (`demands.py:209`) |
| 6 | `daily-tasks/reminders/trigger` | `0 10 * * *` | inline em `trigger_task_reminders` (`daily_tasks.py:1124`) |
| 7 | `admin/cron-sync-pix` (**9º cron, achado em 2026-09-12** — não fazia parte do levantamento original de "8 crons", ver doc de diagnóstico §2.6) | `0 8 * * *` | extraído em `sync_pix_bank_statements_job`/`cron_sync_pix_job` (`admin.py`) |

### Passo a passo

1. Pra cada um dos 5 com lógica inline (1, 2, 3, 5, 6): extrair o corpo
   pra uma função de serviço `async def run_<nome>(session: AsyncSession) -> dict`
   no módulo `services/` correspondente — o handler HTTP vira uma casca
   fina que só faz auth + chama a função (mesmo padrão que `crm.py` já
   segue com `run_scoring_all`). Isso evita duplicar lógica entre a rota
   HTTP (mantida pra disparo manual) e o job nativo.
2. Criar `backend/app/jobs/run_cron.py` como dispatcher único:
   ```python
   import asyncio, sys
   from app.database import AsyncSessionLocal

   JOBS = {
       "vacuum": ...,               # importar as funções extraídas no passo 1
       "mensalidade-generate": ...,
       "mensalidade-overdue": ...,
       "crm-scoring": ...,
       "demands-reminders": ...,
       "daily-tasks-reminders": ...,
   }

   async def main(job: str) -> int:
       async with AsyncSessionLocal() as session:
           result = await JOBS[job](session)
           print(result)
           return 0

   if __name__ == "__main__":
       sys.exit(asyncio.run(main(sys.argv[1])))
   ```
3. Crontab da VM, um `docker exec` por linha, mesmos horários da tabela
   acima (mais as 2 do ETL já feitas na Fase A) — 8 linhas no total.
4. Remover as 6 entradas restantes do `vercel.json` (o ETL já saiu na
   Fase A). Manter as rotas HTTP funcionando sem cron apontando, só pra
   disparo manual (mesmo raciocínio da Fase A).
5. `CRON_SECRET` deixa de ser crítico pro *agendamento* (não é mais
   chamado por cron via HTTP) mas continua protegendo o disparo manual —
   manter como está.
6. Validar cada um dos 6 rodando manualmente via `docker exec` antes de
   agendar, e observar pelo menos 1 ciclo real agendado de cada.

### Arquivos tocados
- `backend/app/jobs/run_cron.py` (novo)
- `backend/app/routers/{ti,mensalidades,demands,daily_tasks}.py` — extrair
  lógica pra `services/`
- `backend/vercel.json` (remove as 6 entradas restantes)
- Crontab da VM

### O que ficou feito

- ✅ Lógica extraída em `run_vacuum_job`, `cron_generate_job`,
  `cron_check_overdue_job`, `trigger_reminders_job`,
  `trigger_task_reminders_job` — cada rota HTTP virou casca fina que só
  faz auth + chama a função. `crm/cron-scoring` não precisou de mudança
  (já usava `run_scoring_all`).
- ✅ `backend/app/jobs/run_cron.py` criado (dispatcher único, `python -m
  app.jobs.run_cron <job>`).
- ✅ Todos os 6 jobs testados com sucesso contra produção via o
  dispatcher, **antes** do commit.
- ✅ Deploy feito, e as 6 rotas HTTP reconfirmadas sem regressão (mesma
  resposta de antes do refactor) — o refactor não mudou comportamento.
- ✅ **9º cron descoberto e tratado no mesmo padrão:**
  `sync_pix_bank_statements` (`admin.py`) — tinha `schedule_cron`
  descritivo na UI mas nenhuma automação real por trás, só botão manual.
  Extraído em `sync_pix_bank_statements_job`/`cron_sync_pix_job`, exposto
  em `POST/GET /api/v1/admin/cron-sync-pix`, adicionado ao
  `vercel.json` (`0 8 * * *`) e ao dispatcher (`sync-pix`).
  **Backlog real de 1.378 transações PIX (R$ 8.730,50) sem sincronizar
  desde 02/06/2026, sincronizado manualmente em 2026-09-12** (autorizado
  pelo usuário, operação idempotente confirmada por `NOT EXISTS` +
  `ON CONFLICT`). Restam 58 com colisão real de dedup (`idx_bs_dedup` é
  mais amplo que `transaction_id`) — não resolvidas, precisam de decisão
  de negócio, não é bug de código.
- ✅ `backend/deploy/crontab.aprxm` criado com as **9** linhas prontas
  (8 + o sync-pix).
- ⏸️ **Pendente (precisa de VM):** instalar o crontab de verdade e
  remover as 7 entradas restantes do `vercel.json` **só depois** de
  confirmar que o cron nativo está rodando na VM (mesma cautela da
  Fase A — não tirar o fallback antes de validar o substituto).

---

## Fase C — Calibrar pool de conexões e workers ✅ concluída (2026-09-12)

1. `backend/app/database.py:16-20` — subir `pool_size`/`max_overflow`
   agora que é 1 processo fixo na VM (não N instâncias serverless
   dividindo o limite do Neon).
2. Manter `statement_cache_size=0` (obrigatório enquanto for Neon/PgBouncer
   — não é específico de serverless, continua valendo na VM).
3. Fixar **1 worker uvicorn** — `slowapi` e os circuit breakers guardam
   estado em memória de processo; N workers = N× os limites configurados.

### O que ficou feito

- ✅ `pool_size`/`max_overflow` viram configuráveis via env var
  (`DB_POOL_SIZE`/`DB_MAX_OVERFLOW`, `config.py`), default 3/7 inalterado
  (seguro pro Vercel hoje). **Pendente:** definir o valor real pra VM
  (ponto de partida sugerido: `DB_POOL_SIZE=10`, `DB_MAX_OVERFLOW=20`) e
  ajustar observando `pg_stat_activity` no Neon nos primeiros dias —
  isso é *configuração no `.env` da VM*, não código.
- ✅ `statement_cache_size=0` já estava correto, mantido.
- ✅ 1 worker uvicorn já era o comportamento (Dockerfile não passa
  `--workers`, default do uvicorn é 1) — nada a mudar.

### Arquivos tocados
- `backend/app/config.py`, `backend/app/database.py`

---

## Fase D — Storage: Supabase Storage → Azure Blob

Decisão do §6.4 do doc anterior.

### Levantamento de volume ✅ concluído (2026-09-12)

Bucket `aprxm-midia`, consultado direto via API do Supabase Storage:

| Métrica | Valor |
|---|---|
| Total de arquivos | **2.750** |
| Total | **204,25 MB** |

Por subpasta (tipo de uso):

| Pasta | Arquivos | Tamanho |
|---|---|---|
| `packages/` | 2.695 | 162,05 MB |
| `task-comments/` | 23 | 35,91 MB |
| `chat/` | 15 | 4,66 MB |
| `assoc-logos/` | 5 | 0,45 MB |
| `signatures/` | 5 | 0,44 MB |
| outros (`public`, `feed`, `daily-tasks`, `financeiro`) | 6 | ~0,76 MB |

Por extensão: `jpg` (1.639, 174,6 MB), `png` (1.082, 19,6 MB), `jpeg` (13,
5,2 MB), `webm` — áudio (13, 4,6 MB), `pdf`/`xlsx`/`txt` (3, ~0,26 MB).

**Conclusão prática:** volume pequeno (204 MB, 2.750 objetos) — a
migração de arquivos em si é rápida (minutos, não horas), o esforço real
desta fase está nos passos 3-5 abaixo (script + troca de client), não no
volume de dados.

O client de upload/leitura é um único módulo,
`backend/app/services/storage_service.py` (`StorageService`, usado por
`app/routers/uploads.py` e `app/routers/public.py`) — troca de SDK fica
concentrada ali, não espalhada pelo código.

### Passos restantes

1. ~~Levantar volume~~ ✅ acima.
2. Provisionar container no Azure Blob (mesmo padrão do erp_itp).
3. Escrever script de migração (lote, com log de progresso e retry) que
   copia Supabase → Azure Blob preservando os paths/nomes usados como
   referência no banco. **Achado:** os endpoints de upload (`uploads.py`,
   `public.py`) retornam a URL pública crua pro chamador persistir onde
   quiser — não há uma tabela/coluna fixa e única de referência; mapear
   caso a caso (moradores/encomendas, comentários de tarefa, chat,
   logo da associação, assinaturas, financeiro) antes de migrar os paths.
4. Trocar o client em `storage_service.py` de Supabase pra Azure Blob
   SDK, mantendo a mesma interface pública (`upload`, `upload_base64`,
   `delete`) — os 2 routers que chamam `StorageService` não precisam
   mudar.
5. Trocar env vars (`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/
   `SUPABASE_STORAGE_BUCKET` → equivalentes do Azure Blob).
6. Rodar os dois em paralelo (dual-write ou pelo menos dual-read) durante
   a validação antes de desligar o Supabase de vez.

---

## Fase E — Domínio + TLS do backend

1. Escolher o subdomínio (ex. `api-aprxm.institutotiapretinha.org`).
2. Configurar registro DNS apontando pra `vm-itp-prod`.
3. Label do Traefik (mesmo padrão do resto do parque ITP) + certificado
   Let's Encrypt automático.
4. Testar handshake TLS e resposta de `/health` no domínio novo antes de
   qualquer frontend apontar pra lá.

---

## Fase F — Variáveis de ambiente ⏳ parcialmente concluída (2026-09-12)

1. Extrair as 35+ variáveis hoje no painel da Vercel (`backend/app/config.py`
   é a fonte de verdade de quais existem e seus defaults).
2. Preencher `.env` de produção na VM (nunca commitar — mesmo padrão já
   seguido nesta sessão de não deixar dump de credencial solto).
3. ✅ **Feito:** `validate_production_config()` (`config.py`) falha o
   boot em produção se `CRON_SECRET` estiver vazio, e loga aviso se
   `VAPID_PUBLIC_KEY` estiver configurada sem `VAPID_PRIVATE_KEY`
   correspondente. Chamada no `lifespan` do `main.py`. Testado contra os
   valores reais de produção antes do commit (não quebra o boot atual).
4. Descartar os campos mortos/legado já identificados (`DATABASE_URL_DIRECT`,
   que nenhum código lê) — **ainda não feito**.

**Pendente:** os itens 1, 2 e 4 (extrair a lista real, preencher `.env`
da VM, remover campo morto) — ver pendências no fim do documento.

---

## Fase G — Rewrite dos 4 frontends

Único ponto de contato entre o backend migrado e os frontends que
**ficam na Vercel** (decisão §6.2):

1. Em cada um dos 4 `vercel.json` (`frontend/`, `painel/`, `presidencia/`,
   `simplifica-prototype/`), trocar o rewrite `/api/*` da function
   serverless pro domínio novo do backend (Fase E).
2. Confirmar CORS (`ALLOWED_ORIGINS` no backend) inclui os domínios reais
   dos 4 frontends na Vercel.
3. Deploy de cada frontend (git push — dispara build/deploy automático
   na Vercel, como hoje).

---

## Fase H — Validação paralela

1. Rodar backend na VM e na Vercel **simultaneamente** por um período
   (mesmo padrão cauteloso usado no erp_itp): VM atende via domínio
   novo, Vercel continua no ar como fallback.
2. Comparar: os 8 crons rodando nos dois lados não devem duplicar efeito
   (ex. gerar mensalidade duas vezes) — durante a validação, só um dos
   dois deve ter cron ativo, não os dois ao mesmo tempo.
3. Checklist de aceite antes do corte: ETL rodando 2x/dia sem falha por N
   dias, vacuum semanal confirmado, os 6 crons restantes confirmados,
   latência da API aceitável, `/health` estável.

---

## Fase I — Corte

1. Trocar de vez o `vercel.json` dos 4 frontends pro domínio da VM (se
   ainda não migrado na Fase G) e confirmar que é a única rota de API em
   uso.
2. Remover o cron da Vercel por completo (já deve estar vazio desde a
   Fase A/B) e desligar/pausar o projeto backend na Vercel.
3. Monitorar 48h pós-corte antes de considerar a migração encerrada.

---

## Pendências para as próximas vezes — da mais fácil pra mais difícil

Tudo que dava pra preparar em código, sem precisar de acesso à VM/DNS, já
foi feito (Fases A, B, C e parte da F). O que resta é ordenado abaixo por
esforço real — a maior parte depende de acesso a algo fora deste repo
(SSH na VM, DNS, ou levantar dado externo).

1. ✅ **Extrair a lista real das 35+ env vars** (Fase F, item 1) —
   **feito 2026-09-12**: `.env.example` (raiz do repo, já rastreado no
   git) atualizado com as vars que faltavam (`CRON_SECRET`, `R2_*`,
   `DATAWAREHOUSE_APRXM_DATABASE_URL`, `WEBAUTHN_*`, `VAPID_*`,
   `GROQ_API_KEY`, `PAINEL_*`, `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`).
2. ❌ **Correção de levantamento anterior — `DATABASE_URL_DIRECT` NÃO é
   legado.** A afirmação original ("nenhum código lê") estava **errada**
   — confirmado em `admin.py:472` que é usado como conexão sem pooler
   pro VACUUM. Achado ao tentar remover: `grep` direto no código (não só
   no doc anterior) mostrou o uso real. Não remover. Corrigido também no
   [`2026-09-12-migracao-aprxm-plan.md`](2026-09-12-migracao-aprxm-plan.md)
   se ainda citar isso como legado.
3. ✅ **Levantar volume do Supabase Storage** — **feito 2026-09-12**:
   2.750 arquivos, 204,25 MB (ver Fase D acima para o detalhamento).
   Volume pequeno, migração de dados em si é rápida.
4. ⚠️ **Rascunho do compose de produção** — `backend/deploy/docker-compose.prod.yml`
   criado 2026-09-12, mas **não confirmado contra a config real da VM**:
   esta sessão não teve acesso ao repo/config de infra do erp_itp (só um
   checkout parcial sem Traefik/compose), então o nome da rede
   (`traefik-public`), certresolver (`letsencrypt`) e o domínio são um
   chute razoável por convenção comum, **não confirmados**. Antes de
   aplicar: conferir na própria VM o nome real da rede externa do
   Traefik (`docker network ls`) e o certresolver configurado.
5. 🟠 **Provisionar domínio + TLS na VM** (Fase E, execução) — precisa de
   acesso real a DNS + à VM (Traefik). Não executável desta sessão sem
   SSH configurado.
6. 🟠 **Instalar o crontab na VM e validar ciclos reais** (Fases A/B,
   pendência já registrada acima) — precisa do backend já rodando lá
   (depende do item 5).
7. 🟠 **Preencher `.env` real da VM** (Fase F, item 2) — depende dos
   itens 1 e 5 (precisa saber a lista de vars e ter onde colocar).
8. 🔴 **Migração de arquivos Supabase → Azure Blob** (Fase D, passos 2-6)
   — levantamento (item 3) já feito; é a fase com mais trabalho de
   código novo (client de storage em `storage_service.py`, script de
   migração em lote, mapear onde cada URL é referenciada no banco).
9. 🔴 **Rewrite dos 4 `vercel.json` + deploy dos frontends** (Fase G) —
   mecanicamente simples, mas só pode ser feito depois do item 5 estar
   validado (senão quebra o app em produção).
10. 🔴 **Validação paralela** (Fase H) — só depois de tudo acima.
11. 🔴 **Corte** (Fase I) — último passo, desliga a Vercel de vez.
