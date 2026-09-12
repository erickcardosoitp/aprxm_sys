# Execução da migração do APRXM (backend → VM) — plano de fases

> Continua [`2026-09-12-migracao-aprxm-plan.md`](2026-09-12-migracao-aprxm-plan.md)
> (diagnóstico + achados críticos + as 6 decisões, todos fechados). Este
> documento é o checklist de execução das fases que faltam, uma a uma.

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

## Fase A — ETL: migração completa e nativa (prioridade atual)

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

---

## Fase B — Portar os outros 7 crons para o mesmo mecanismo nativo

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

---

## Fase C — Calibrar pool de conexões e workers

1. `backend/app/database.py:16-20` — subir `pool_size`/`max_overflow`
   agora que é 1 processo fixo na VM (não N instâncias serverless
   dividindo o limite do Neon). Ponto de partida razoável: `pool_size=10,
   max_overflow=20` — ajustar observando `pg_stat_activity` no Neon nos
   primeiros dias.
2. Manter `statement_cache_size=0` (obrigatório enquanto for Neon/PgBouncer
   — não é específico de serverless, continua valendo na VM).
3. Fixar **1 worker uvicorn** (`--workers 1` ou nem passar a flag, que já
   é o default) — `slowapi` e os circuit breakers guardam estado em
   memória de processo; N workers = N× os limites configurados. Só
   revisitar (mover pra Redis) se a carga real exigir mais de 1 worker.

### Arquivos tocados
- `backend/app/database.py`
- Comando de start do container (Dockerfile `CMD` ou compose/systemd,
  conforme o padrão de deploy definido)

---

## Fase D — Storage: Supabase Storage → Azure Blob

Decisão do §6.4 do doc anterior. Escopo/volume real **ainda não
levantado** — antes de escrever código:

1. Levantar volume: quantos arquivos, tamanho total, tipos (fotos,
   assinaturas, áudio) em `SUPABASE_STORAGE_BUCKET`.
2. Provisionar container no Azure Blob (mesmo padrão do erp_itp).
3. Escrever script de migração (lote, com log de progresso e retry) que
   copia Supabase → Azure Blob preservando os paths/nomes usados como
   referência no banco (campos que guardam URL/key do arquivo — mapear
   quais tabelas/colunas antes de migrar).
4. Trocar o client de upload/leitura no backend (módulo de storage —
   confirmar arquivo exato antes de editar) de Supabase pra Azure Blob
   SDK, atrás de uma interface única se ainda não existir uma.
5. Trocar env vars (`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`/
   `SUPABASE_STORAGE_BUCKET` → equivalentes do Azure Blob).
6. Rodar os dois em paralelo (dual-write ou pelo menos dual-read) durante
   a validação antes de desligar o Supabase de vez.

**Esta fase precisa de um levantamento próprio antes de virar tarefa
executável** — está aqui como checklist de alto nível, não como plano
detalhado (diferente da Fase A/B, que já tem os arquivos/linhas exatos).

---

## Fase E — Domínio + TLS do backend

1. Escolher o subdomínio (ex. `api-aprxm.institutotiapretinha.org`).
2. Configurar registro DNS apontando pra `vm-itp-prod`.
3. Label do Traefik (mesmo padrão do resto do parque ITP) + certificado
   Let's Encrypt automático.
4. Testar handshake TLS e resposta de `/health` no domínio novo antes de
   qualquer frontend apontar pra lá.

---

## Fase F — Variáveis de ambiente

1. Extrair as 35+ variáveis hoje no painel da Vercel (`backend/app/config.py`
   é a fonte de verdade de quais existem e seus defaults).
2. Preencher `.env` de produção na VM (nunca commitar — mesmo padrão já
   seguido nesta sessão de não deixar dump de credencial solto).
3. Adicionar validação de obrigatórias no boot (`DATABASE_URL`,
   `SECRET_KEY`, e as que hoje têm default perigoso como
   `VAPID_PUBLIC_KEY` hardcoded) — falhar cedo em vez de subir com
   configuração incompleta silenciosamente (`config.py` usa
   `extra="ignore"`, então nome errado de env var passa batido hoje).
4. Descartar os campos mortos/legado já identificados (`DATABASE_URL_DIRECT`,
   que nenhum código lê).

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

## Ordem de execução recomendada

Fase A (ETL, em andamento) → Fase B (demais crons, mesmo mecanismo) →
Fase C (pool/workers, mecânico) → Fase F (env vars, pré-requisito de
qualquer deploy real na VM) → Fase E (domínio/TLS) → Fase D (storage,
pode rodar em paralelo às demais, tem levantamento próprio) → Fase G
(rewrite frontends) → Fase H (validação) → Fase I (corte).
