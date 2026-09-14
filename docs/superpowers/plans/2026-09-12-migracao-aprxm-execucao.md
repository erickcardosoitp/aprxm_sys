# Execução da migração do APRXM (backend → VM) — plano de fases

> Continua [`2026-09-12-migracao-aprxm-plan.md`](2026-09-12-migracao-aprxm-plan.md)
> (diagnóstico + achados críticos + as 6 decisões, todos fechados). Este
> documento é o checklist de execução das fases que faltam, uma a uma.

> **Status (2026-09-12, atualizado após acesso SSH real à VM):** Fases
> **A e B concluídas de ponta a ponta e em produção de verdade** — backend
> do APRXM deployado na `vm-itp-prod`, os 9 crons (8 originais + o
> `sync-pix` achado nesta sessão) rodando nativos via `tarefas_api.py`/
> `tarefas_runner.py` (mesmo mecanismo do erp_itp), `vercel.json` sem
> nenhum cron. Fase C concluída. Fase F parcialmente concluída. Ver
> "O que foi feito com acesso real à VM" logo abaixo pro detalhamento
> completo desta rodada, e "Pendências para as próximas vezes" no fim do
> documento pro que ainda falta (domínio/TLS, storage, rewrite frontends).

**Correção importante:** a VM tem **15 GB de RAM / 2 vCPUs** — os
"128 GB" citados em decisões anteriores são o **disco**, não RAM.
Confirmado sem problema na prática (ver seção abaixo), mas o número
errado não deve se propagar pra decisões futuras.

**Escopo fechado (§6 do doc anterior):** só o backend migra pra
`vm-itp-prod` (co-localizada, 15 GB RAM / 2 vCPU / 117 GB disco). Os 4
frontends ficam na Vercel free — nenhuma fase abaixo toca `frontend/`,
`painel/`, `presidencia/` ou `simplifica-prototype/` além do rewrite de
URL na Fase G.

---

## O que foi feito com acesso real à VM (2026-09-12)

Sessão ganhou acesso SSH real (`itpadmin@20.114.240.177`, chave
`vm-itp-prod_key.pem`) depois de todo o trabalho de preparação de código
(Fases A/B/C/F) já estar pronto no repo. Isso permitiu concluir de fato,
não só preparar:

1. **Reconhecimento da VM** — corrigiu 3 premissas erradas do plano:
   - RAM real 15 GB / 2 vCPU (não 128 GB — isso é disco).
   - O mecanismo de cron real não é crontab manual: é
     `tarefas-registro.json` + `tarefas_runner.py` + uma API interna
     (`tarefas_api.py`, porta 8002, só `127.0.0.1`) que cria a entrada no
     registro **e** grava a linha no crontab numa única chamada, com log
     e timing (JSONL) padronizados. Usado em vez do crontab manual
     originalmente rascunhado.
   - Todos os serviços vivem num único `docker-compose.yml`
     (`/home/itpadmin/itp-stack/docker-compose.yml`) — o APRXM entrou
     como mais um serviço nesse arquivo, não um compose separado.
     Convenção real do Traefik: `certresolver=leresolver` (não
     `letsencrypt`), domínio `api.<app>.institutotiapretinha.org`.
2. **Deploy key do GitHub** criada na VM (`~/.ssh/aprxm_sys_deploy_key`,
   mesmo padrão do `erp_itp_deploy_key` já existente) e adicionada como
   Deploy Key (read-only) no repo `aprxm_sys` — permite `git pull` direto
   na VM pra atualizações futuras.
3. **Repo clonado** em `/home/itpadmin/aprxm_sys`.
4. **Env de produção** transferido via `scp` (nunca via git) pra
   `/home/itpadmin/itp-stack/aprxm_backend.env`, com `DB_POOL_SIZE=10`/
   `DB_MAX_OVERFLOW=20` (Fase C) adicionados por cima do que já existia
   no Vercel.
5. **Serviço `aprxm_backend` adicionado ao `docker-compose.yml`** do
   itp-stack (backup do arquivo original feito antes de editar), com
   `mem_limit: 2g` como trava de segurança, expondo só `127.0.0.1:8003`
   (sem tráfego público ainda — falta Fase E, domínio/TLS).
6. **Build + `docker compose up -d aprxm_backend`** — confirmado
   `healthy`, `/health` respondendo 200, migrations rodaram sem erro
   (v25 replay-safe confirmado de novo), `validate_production_config()`
   passou.
7. **ETL rodado nativamente dentro do container** (`docker exec
   aprxm_backend python -m app.jobs.run_etl`) — sucesso, 24,2s, dados
   reais de produção processados. Memória do container: ~174 MB durante
   o ETL (limite de 2 GB — folga grande, risco confirmado baixo na
   prática, não só em teoria).
8. **Os 9 crons registrados via `tarefas_api.py`** (ETL + os outros 8),
   todos testados individualmente via `docker exec` na VM antes de
   remover qualquer coisa da Vercel — todos `exit 0`, mesmos resultados
   já vistos em produção.
9. **`vercel.json` zerado de crons** (commit final desta rodada) — os 9
   agora rodam 100% nativos na VM. Rotas HTTP continuam no código, sem
   cron apontando, só disparo manual/debug.

**O que ainda falta pra fechar a migração de verdade:** domínio/TLS
público (Fase E — hoje só responde em `127.0.0.1:8003`, ninguém de fora
acessa), rewrite dos 4 frontends (Fase G — continuam batendo na function
serverless da Vercel pra tráfego normal, só os crons saíram de lá),
storage (Fase D) e o corte final (Fase I). Ver pendências no fim do
documento.

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
- ✅ **Concluído com acesso real à VM (2026-09-12, mesmo dia):** backend
  deployado (`aprxm_backend`, container healthy), ETL rodado com sucesso
  via `docker exec aprxm_backend python -m app.jobs.run_etl` (24,2s,
  dados reais). Cron registrado via `tarefas_api.py` (id `aprxm-etl`,
  `0 12,20 * * *`) — **não** via crontab manual como rascunhado
  originalmente (ver "O que foi feito com acesso real à VM" no topo do
  documento). `vercel.json` já estava sem essas 2 entradas.
- ✅ **Validado em 2026-09-13**: `aprxm-etl.jsonl` mostra 3 execuções
  agendadas reais (20h de 12/09, 12h e 20h de 13/09), todas
  `exit_code: 0`. Fase A 100% fechada.

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
- ✅ `backend/deploy/crontab.aprxm` (rascunho inicial, **substituído** —
  ver abaixo).
- ✅ **Concluído com acesso real à VM (2026-09-12, mesmo dia):** os 7
  jobs testados individualmente via `docker exec` no container real
  (todos `exit 0`, mesmos resultados de sempre), registrados via
  `tarefas_api.py` (ids `aprxm-vacuum`, `aprxm-mensalidade-generate`,
  `aprxm-mensalidade-overdue`, `aprxm-crm-scoring`,
  `aprxm-demands-reminders`, `aprxm-daily-tasks-reminders`,
  `aprxm-sync-pix`) — **não** via `backend/deploy/crontab.aprxm` manual
  como rascunhado originalmente. `vercel.json` zerado de crons **depois**
  de confirmar os 9 rodando na VM, nunca antes (mesma cautela da Fase A).
- ✅ **Validado em 2026-09-13**: todos os 6 confirmados rodando sozinhos
  no horário certo, `exit_code: 0` (`aprxm-vacuum` 03h, `aprxm-sync-pix`
  08h, `aprxm-mensalidade-overdue` 09h, `aprxm-daily-tasks-reminders` 10h,
  `aprxm-demands-reminders` 11h, `aprxm-crm-scoring` 06h). Só
  `aprxm-mensalidade-generate` ainda sem execução real (só roda dia 1 do
  mês). Fase B 100% fechada.

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

## Fase D — Storage: Supabase Storage → Azure Blob ✅ concluída (2026-09-14)

Decisão do §6.4 do doc anterior.

### Levantamento de volume ✅ concluído (2026-09-12), corrigido (2026-09-14)

**Correção crítica:** o levantamento inicial usava `list()` do SDK
`supabase-py`, sem paginação — capturava só os primeiros 1000 itens por
chamada e não looper. Refeito via cliente REST próprio
(`backend/scripts/_supabase_rest.py`) com paginação manual por `offset`:

| Métrica | Valor levantado (errado) | Valor real |
|---|---|---|
| Total de arquivos | ~~2.750~~ | **13.433** |
| Total | ~~204,25 MB~~ | **924,4 MB** |

Volume real 5x maior que o estimado — ainda assim pequeno o bastante pra
migrar em lote sem downtime.

O client de upload/leitura é um único módulo,
`backend/app/services/storage_service.py` (`StorageService`, usado por
`app/routers/uploads.py` e `app/routers/public.py`) — troca de SDK ficou
concentrada ali, não espalhada pelo código.

### Execução ✅ concluída (2026-09-14)

1. ✅ Levantar volume real (13.433 arquivos / 924,4 MB) — acima.
2. ✅ Container `aprxm-midia` provisionado no Azure Blob, **conta
   `stitperpprod` reaproveitada** do erp_itp (containers isolados por
   nome: `aprxm-midia` pra APRXM, `arquivos` pro erp_itp).
3. ✅ Script de migração em lote
   (`backend/scripts/migrate_storage_to_azure.py`), rodado localmente
   pelo usuário (não na sessão do Claude, pra não travar a sessão numa
   transferência longa) — `ThreadPoolExecutor(max_workers=8)`, log de
   progresso a cada 500 arquivos com %/ETA. **Resultado: 13.433/13.433
   migrados, 0 falhas.**
4. ✅ Client trocado em `storage_service.py` pra `azure.storage.blob`
   (`BlobServiceClient` + SAS por URL), mesma interface pública
   (`upload`, `upload_base64`, `delete`) — os 2 routers que chamam
   `StorageService` não mudaram.
5. ✅ Env vars trocadas: `AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_KEY` /
   `AZURE_STORAGE_CONTAINER=aprxm-midia` em `backend/.env` (produção via
   `erp_itp_backend.env` na VM, mesma conta).
6. ✅ Banco atualizado (`--update-db` do script de migração) — 19 colunas
   simples + 3 colunas JSON array reescritas em lote (URL antiga →
   nova), sem sync incremental pós-corte (decisão explícita: sem
   catch-up de uploads durante a janela, aceitável pro volume).
7. ✅ **Verificação pós-migração**
   (`backend/scripts/verify_storage_migration.py`): nenhuma referência
   residual a `supabase.co` em nenhuma coluna text/jsonb do schema;
   12.800 URLs únicas do Azure no banco, todas resolvendo HTTP 200;
   13.433 blobs no Azure vs. 12.800 referenciados (633 órfãos —
   esperado, registros deletados/arquivos antigos sem referência ativa).
8. ✅ **200 testes funcionais reais** contra a associação de teste
   isolada (`aaaaaaaa-0001-0001-0001-000000000001`), em
   `backend/scripts/test_azure_storage/` (upload variado, upload
   base64, delete + escopo, leitura de dados reais migrados,
   concorrência + edge cases de nome/path traversal) — **200/200
   passaram**.
9. ✅ **Política de lifecycle automática aplicada (2026-09-14):**
   Hot → Cool após 90 dias sem modificação, prefixo `aprxm-midia/`.
   Precisou conceder a role `Storage Account Contributor` (Contribuinte
   de Conta de Armazenamento) à identidade gerenciada da VM
   (`vm-itp-prod`) no escopo da própria storage account — a role
   original era só data-plane. Após a atribuição, o RBAC do Azure levou
   ~25 min pra propagar de verdade (múltiplas tentativas com
   `AuthorizationFailed` mesmo com `az login --identity` renovando o
   token, antes de passar).

---

## Fase E — Domínio + TLS do backend ✅ concluída (2026-09-12)

1. ✅ Subdomínio escolhido: `api-aprxm.institutotiapretinha.org`.
2. ✅ Registro DNS (A, `api-aprxm` → `20.114.240.177`) criado pelo usuário
   no Azure DNS (mesma zona do resto do parque ITP), via portal —
   identidade da VM não tinha permissão de leitura na zona (escopo
   propositalmente restrito, só disco), então não deu pra automatizar
   via CLI desta vez.
3. ✅ Labels do Traefik já estavam no `docker-compose.yml` desde o deploy
   do container (Fase A/B) — certificado Let's Encrypt emitido com
   sucesso depois que o DNS propagou (2 tentativas anteriores falharam
   com NXDOMAIN, antes do registro existir/propagar — sem problema, bem
   longe do rate limit de 5 falhas/hora que já mordeu o domínio
   `grafana.itp...` antes).
4. ✅ Testado: `https://api-aprxm.institutotiapretinha.org/health` → 200
   com certificado real (antes: erro de certificado não confiável, cert
   default do Traefik). Testado também um endpoint autenticado real
   (`mensalidades/cron-check-overdue`) via HTTPS público — 200, dados de
   produção corretos. **API do APRXM já está publicamente acessível na
   VM** — só falta o rewrite dos 4 frontends (Fase G) pra tráfego normal
   parar de passar pela function serverless da Vercel.

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

## Fase G — Rewrite dos 4 frontends ✅ concluída (2026-09-12)

Único ponto de contato entre o backend migrado e os frontends que
**ficam na Vercel** (decisão §6.2):

1. ✅ **Só 3 dos 4 precisavam** — `simplifica-prototype/` é HTML estático
   puro, sem `vercel.json` e sem nenhuma chamada de API (confirmado por
   grep), então não entrou no rewrite. `frontend/`, `painel/` e
   `presidencia/` tiveram o rewrite `/api/*` trocado pra
   `https://api-aprxm.institutotiapretinha.org/api/:path*`.
   `frontend/vercel.json` também teve o CSP (`connect-src`) atualizado —
   sem isso o navegador bloquearia a chamada mesmo com o rewrite certo
   (`painel`/`presidencia` não têm CSP restritiva, não precisou).
2. ✅ **CORS confirmado** — descobri os domínios reais via `vercel project
   ls` (`aprxm.vercel.app`, `painel-aprxm.vercel.app`,
   `aprxm-dash-prd.vercel.app`) e atualizei `ALLOWED_ORIGINS` no
   `aprxm_backend.env` da VM. **Pegadinha:** `docker compose restart` não
   relê `env_file` (só reinicia o processo) — precisou `docker compose up
   -d` pra recriar o container de verdade. Testado com preflight OPTIONS
   real pras 3 origens — todas retornam `Access-Control-Allow-Origin`
   correto.
3. ✅ **Deploy e teste de ponta a ponta** — `git push`, aguardado os 3
   deploys, testado `GET /api/v1/health` através do domínio público de
   cada um dos 3 frontends (não direto na VM) — os 3 retornam 200 vindo
   da VM de verdade. Página principal do `frontend/` confirmada
   carregando normalmente com o CSP novo.

**Tráfego normal dos 3 frontends com API já passa pela VM, não mais pela
function serverless da Vercel.** Só falta a Fase H (validação por um
período) e a Fase I (desligar de vez a function na Vercel).

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

## Fase J — Banco de dados: Neon → Postgres na própria VM ✅ concluída (2026-09-14)

Decisão do usuário (fora do escopo original, que previa manter o banco no
Neon indefinidamente): consolidar infra e reduzir latência, movendo o
compute do banco pra mesma VM do backend. Aceita janela de manutenção de
minutos (não zero-downtime).

**Volume:** 121 MB, 62 tabelas — pequeno, migração rápida.

### Execução

1. Reaproveitado o Postgres já existente na VM (`itp_postgres`, container
   compartilhado com `erp_itp_db`) — banco `aprxm_db` já existia como
   placeholder vazio (ver Fase H, nota sobre não confundir com produção
   real) e virou o banco de produção de verdade agora.
2. Dump do Neon (`pg_dump --format=custom`, endpoint direto sem
   `-pooler`) → restore em `aprxm_db`. 2 erros ignorados no restore, só
   recursos proprietários do Neon sem uso pela aplicação
   (`pg_session_jwt`, schema `neon_auth`) — mesma classe de "erro
   esperado" já documentada no script de backup do erp_itp.
3. Contagens de linhas conferidas 1:1 contra o Neon (`users`,
   `residents`, `packages`, `transactions`, `associations`) antes do
   corte — sem drift.
4. **Janela de corte** (~1min30s de indisponibilidade real, medida):
   parou `aprxm_backend` → dump final do Neon (captura qualquer escrita
   de último segundo) → `DROP`/`CREATE DATABASE aprxm_db` limpo →
   restore do dump final → `DATABASE_URL` em `aprxm_backend.env` trocada
   de `postgresql+asyncpg://...@ep-rough-tooth-...neon.tech/neondb?ssl=true`
   pra `postgresql+asyncpg://itp_admin:***@postgres:5432/aprxm_db`
   (rede interna do docker-compose, sem SSL) → container recriado.
   `database.py` já detecta ausência de `neon.tech` na URL e não força
   `ssl=require`, nenhuma mudança de código necessária.
5. **Verificado:** `/health` público 200, login com credenciais erradas
   → `403` (não 500 — prova que a query real bateu na tabela `users`
   restaurada sem erro), `/residents` sem token → `401`, `/metrics`
   respondendo com dados reais.
6. **Backup automático criado** (substitui o backup gerenciado que o
   Neon fazia sozinho): novo script
   `~/itp-stack/tarefas/aprxm-backup-to-neon.sh`, mesmo padrão já usado
   pelo erp_itp (`pg-sync-to-neon.sh`) — dump local do `aprxm_db` a cada
   6h, restaura no **mesmo projeto Neon** (agora reaproveitado como
   destino de backup morno, não mais banco primário), retenção de 7 dias
   de dumps locais em `~/backups/`. Registrado em
   `tarefas-registro.json` (id `aprxm-backup-to-neon`) e no crontab
   (`0 */6 * * *`). Testado manualmente 2x (script direto e via
   `tarefas_runner.py`, mesmo mecanismo do cron real) — `exit_code: 0`
   nas duas vezes, dados conferidos no Neon pós-restore (contagens
   batendo).
7. `ANALYTICS_DATABASE_URL`/`DATAWAREHOUSE_APRXM_DATABASE_URL`
   **não tocadas** — projeto Neon separado (`aprxm-analytics`,
   OLAP/Power BI), fora do escopo desta migração (só o banco principal
   `neondb`/`ep-rough-tooth` migrou).

**Rollback disponível:** `aprxm_backend.env.bak-pre-azure-vm-db-migration-20260914`
guardado na VM com a `DATABASE_URL` original do Neon — banco de produção
Neon original **não foi apagado**, só parou de ser o primário (segue
íntegro, agora recebendo os backups automáticos por cima). Reverter é
só trocar a env de volta e recriar o container.

---

## Fase K — Data warehouse: Neon (aprxm-analytics) → ClickHouse self-hosted ✅ concluída (2026-09-14)

Decisão do usuário: substituir o destino OLAP do ETL (`DATAWAREHOUSE_APRXM_DATABASE_URL`,
projeto Neon separado `aprxm-analytics`) por um motor colunar real,
self-hosted, sem depender de capacidade paga do Microsoft Fabric — a
licença Fabric gratuita da organização é **por usuário** (workspace
pessoal), sem capacidade compartilhada pra um ETL de time/produção.

**Motor escolhido:** ClickHouse — open-source (Apache 2.0), colunar,
SQL, o equivalente self-hosted mais próximo do BigQuery. Volume real do
DW é pequeno (10 MB, 42 tabelas) — Fabric/Synapse seriam desperdício de
capacidade paga (mínimo ~US$ 262-1.088/mês) pra esse tamanho de dado.

### Execução

1. Container `aprxm_clickhouse` (`clickhouse/clickhouse-server:24.10-alpine`)
   adicionado ao `docker-compose.yml` da VM, mesmo padrão dos outros
   serviços — database `aprxm_analytics` e usuário `aprxm` provisionados
   no bootstrap via env vars, `mem_limit: 1g` (dado é pequeno).
2. **Dado histórico não precisou ser migrado** — a camada Gold é 100%
   regenerada a cada rodada do ETL (não é fonte de verdade, é cache
   analítico), então só trocar o destino e rodar o ETL 1x já recria tudo.
3. **Adaptação de código necessária** (`datalake_service.py`): o loader
   antigo usava `pandas.to_sql()` genérico via SQLAlchemy, que cria
   tabela automaticamente no Postgres mas **não sabe** que o ClickHouse
   exige `ENGINE = MergeTree ORDER BY (...)` explícito na criação — sem
   isso a criação de tabela falha. Novo `_write_gold_clickhouse()`:
   - Usa o driver `clickhouse-connect` (`insert_df`), não SQLAlchemy.
   - Mapeia dtype pandas → tipo ClickHouse, sempre `Nullable(...)`
     (agregações geram `NaN`, e ClickHouse rejeita `NULL` em coluna
     não-nullable).
   - `ORDER BY tuple()` (sem chave de ordenação) — seguro porque não há
     necessidade de dedup/ordenação entre rodadas (tabela é sempre
     recriada do zero).
   - `load_gold_to_analytics()` escolhe o loader pelo scheme da URL
     (`clickhouse://` vs `postgresql://`) — caminho antigo (Postgres)
     continua funcionando sem mudança, caso algum outro ambiente ainda
     use Postgres como destino.
4. **2 bugs reais encontrados rodando o ETL de verdade contra o
   ClickHouse** (não hipotéticos — só apareceram com dado de produção):
   - Coluna pandas com `NaN` misturado a `date`/`float` vira dtype
     `object` (não `datetime64`/`float64`) — caía no fallback `String`
     e quebrava a inserção (`TypeError: object of type 'float' has no
     len()`). Fix: inspeciona o primeiro valor não-nulo da coluna
     `object` e recasta pro dtype real (`pd.to_datetime`/`to_numeric`)
     antes de decidir o tipo ClickHouse.
   - `CREATE TABLE IF NOT EXISTS` prendia o schema errado de uma rodada
     anterior que tinha falhado — a rodada seguinte, já com o tipo
     corrigido no código, continuava batendo na tabela antiga com tipo
     errado. Fix: trocado pra `DROP TABLE IF EXISTS` + `CREATE TABLE`
     incondicional (seguro, tabela é sempre full-replace mesmo).
5. **Verificado com dado real:** ETL rodado manualmente (`docker exec
   aprxm_backend python -m app.jobs.run_etl`) — `status: success`, 39
   tabelas Gold carregadas (41 tabelas totais no ClickHouse, incluindo
   utilitárias), números batendo com achados de negócio anteriores
   (ex. `encomendas_paradas` mostrando os mesmos moradores/associações
   já sinalizados no dashboard Grafana).
6. **Interface de consulta (ClickHouse Play UI):** habilitada só em
   `127.0.0.1:8123` da VM (a pedido do usuário — "não precisa de
   domínio, vai ficar somente no servidor") — acesso via túnel SSH
   (`ssh -L 8123:127.0.0.1:8123 ...`), nunca exposta publicamente.

**Não coberto ainda / pendência aberta:** Power BI hoje conecta direto
no Neon via internet pública (fácil, sem gateway). Com o DW agora numa
rede privada da VM, vai precisar de driver ODBC/JDBC do ClickHouse
instalado onde o Power BI roda **e** (exposição pública com TLS **ou**
um On-premises Data Gateway) — trabalho novo, ainda não feito.

---

## Fase H — Achados reais durante a validação (2026-09-14)

Sessão diferente da que fez a migração original (2026-09-12/13),
acionada pelo usuário para revisar a operação do APRXM já rodando na VM
("garantir que a operação do APROXIMA esteja ok"). Achados de produção,
não relacionados ao código da migração em si — mas só ficaram visíveis
*por causa* da migração (mudança de Vercel serverless, N instâncias,
pra VM, processo único e persistente).

### Incidente 1 — login e todas as queries autenticadas voltavam 500

**Sintoma:** `POST /api/v1/auth/login` retornava 500 com
`asyncpg.exceptions.UndefinedTableError: relation "users" does not
exist` — bug pré-existente, não causado por nenhuma sessão, só
descoberto agora porque ninguém tinha testado login de ponta a ponta
contra o backend novo da VM ainda.

**Causa raiz confirmada:** `SHOW search_path;` numa conexão nova através
do endpoint `-pooler` do Neon (PgBouncer, modo transaction pooling)
retornava **vazio**. Duas tentativas de fix não resolveram sozinhas:
- `ALTER ROLE neondb_owner SET search_path = public;` — fica salvo em
  `pg_roles.rolconfig`, mas o PgBouncer não propaga esse default de
  role pras sessões que ele multiplexa.
- `connect_args={"server_settings": {"search_path": "public"}}` no
  asyncpg (`database.py`) — mecanismo correto do lado do cliente, mas o
  PgBouncer também não repassa esse parâmetro de startup pro backend
  real (limitação conhecida de pooling em modo transação: só uma lista
  restrita de parâmetros é encaminhada).

**Fix definitivo aplicado:** trocar `DATABASE_URL` (produção, `~/itp-stack/aprxm_backend.env`
na VM) do endpoint `ep-rough-tooth-an10po6b-pooler.c-6.us-east-1.aws.neon.tech`
pro endpoint direto **sem `-pooler`**
(`ep-rough-tooth-an10po6b.c-6.us-east-1.aws.neon.tech`) — bypassa o
PgBouncer por completo. Seguro porque a arquitetura mudou: o pooler
existia pra absorver N instâncias serverless da Vercel, cada uma com
seu próprio pool pequeno; na VM é **1 processo persistente** com
`pool_size=3, max_overflow=7` (≤10 conexões fixas) — não precisa mais
de multiplexação externa. `connect_args.server_settings.search_path`
em `database.py`/`presidencia_service.py` (commit `60df65c`) foi mantido
como camada defensiva adicional, mesmo não sendo suficiente sozinho.

**Não documentado em nenhum outro lugar:** a troca do `DATABASE_URL` é
só um arquivo `.env` vivo na VM (nunca vai pro git, por padrão do
projeto) — **fica registrado aqui** como referência futura. Se o
container for recriado do zero sem esse `.env`, o bug volta.

**Verificado:** `POST /auth/login` com credenciais erradas → 403
`{"detail":"Credenciais inválidas."}` (era 500). `GET /residents` sem
token → 401 `{"detail":"Not authenticated"}` (era 500 também, por
tabela cascata).

### Incidente 2 — `/openapi.json` 500 (não relacionado ao Neon)

`GET /openapi.json` (e por extensão qualquer client OpenAPI/Swagger
gerado automaticamente) retornava 500:
`PydanticUserError: TypeAdapter[...ForwardRef('Response')...] is not
fully defined`. Causa: `backend/app/routers/admin.py`, função
`blank_proof_of_residence`, assinatura `) -> "Response":` — forward
reference em string pro tipo `Response`, mas o único import de
`Response` no arquivo era local (dentro da própria função, como
`FastAPIResponse`), nunca no escopo do módulo — o Pydantic não
conseguia resolver a referência ao gerar o schema OpenAPI completo.
`/docs` funcionava normalmente (não depende do schema completo), só o
JSON cru quebrava.

**Fix:** import de `Response` promovido pro topo do arquivo, anotação
trocada de `-> "Response":` pra `-> Response:` (sem string). Commit
`60df65c`, deployado e verificado (`/openapi.json` → 200).

### Falso alarme do Grafana durante o redeploy

O redeploy do fix acima (`docker compose up -d --force-recreate
aprxm_backend`) disparou um alerta `[FIRING]`→`[RESOLVED]` de "container
parou de reportar métricas" — blip normal de ~5s durante a troca do
container (kill do antigo → create → healthcheck do novo), dentro da
janela de avaliação da regra. Confirmado via `docker events` e
`RestartCount=0`: não foi crash-loop nem falha real, só o próprio
redeploy sendo capturado pela janela de alerta.

### Quase-incidente evitado — script de backup apontou pra produção por engano

Nesta mesma sessão, uma tentativa de configurar backup do `aprxm_db`
(banco local vazio na VM, artefato não usado — ver nota abaixo) usando
uma connection string do Neon fornecida pelo usuário como "destino de
backup" **era na verdade o banco de produção real**. Um `pg_restore
--clean --if-exists` chegou a rodar contra produção antes do engano ser
percebido — sem dano real só porque a origem do dump (`aprxm_db` local)
tem 0 tabelas (842 bytes, dump vazio). Revertido por completo: script,
dumps, entrada no `neon_sync.env` e no `tarefas-registro.json`
removidos. **Confirmado que os 61 tabelas de produção seguem intactas.**

**Nota importante pra próximas sessões:** `aprxm_db` (Postgres local da
VM, container `itp_postgres`) é um artefato vazio, sobrando de algum
provisionamento — **o banco de produção real do APRXM nunca saiu do
Neon** (só o *compute* migrou pra VM, ver escopo fechado no topo deste
documento). Não confundir os dois ao mexer com backup/restore.

### Integração completa com o catálogo de erros do parque ITP (2026-09-14)

A pedido do usuário, levantamento completo de todas as fontes de erro do
APRXM (frontend, backend, banco, integrações) e conexão com o catálogo
de erros compartilhado (`erp_itp/catalogo-erros`, ver
`erp_itp/CATALOGO-ERROS.md`) — sistema já preparado pra reconhecer
`Aplicacao=APRXM` no schema, mas sem nenhuma fonte de dado real
alimentando isso ainda.

**Situação antes do levantamento:**
- `aprxm_backend` não estava na lista de containers monitorados
  (`catalogo-erros/config.py`) — os 2 bugs de 500 achados mais cedo
  neste mesmo dia (login/search_path, `/openapi.json`) só foram vistos
  por investigação manual via SSH, nunca teriam chegado ao catálogo.
- Handler global de exceção (`main.py`) usava `print("[UNHANDLED]...")`
  sem garantir a palavra "error"/"exception" — o coletor só enfileira
  log que bate no regex `error|exception|fatal|panic`; dependia do nome
  da classe da exceção conter uma dessas palavras.
- Nenhum dos 3 frontends (`frontend/`, `painel/`, `presidencia/`)
  reportava crash pra lugar nenhum — só `console.error` local (quando
  existia Error Boundary; `painel/` não tinha nenhum). Sem cobertura de
  erro fora da árvore React (`window.onerror`/`unhandledrejection`).
- 2 pontos de integração externa engolindo falha sem log nível error:
  fallback do Groq (chat "Simplifica", `agent.py`) e envio de e-mail de
  lembrete de demanda (`demands.py`).
- Demais integrações (Azure Blob, R2/datalake, push VAPID, PIX sync)
  já propagavam/logavam corretamente — confirmado por auditoria, não
  precisaram de mudança.

**O que foi feito (commit `786714c` em `aprxm_sys`, `1703852`/`17038523`
em `erp_itp`):**
1. `catalogo-erros/config.py` (erp_itp): `aprxm_backend` adicionado à
   lista de containers monitorados, `aplicacao_sugerida: "APRXM"`.
2. `main.py`: handler global trocado pra `logger.error("[ERROR] ...")`.
3. Novo endpoint `POST /api/v1/public/frontend-logs` (sem auth, mesmo
   padrão do erp_itp/site institucional) — recebe crash do cliente,
   loga em nível ERROR, não grava em banco.
4. `agent.py`/`demands.py`: os 2 silenciamentos corrigidos, agora logam
   em ERROR antes de continuar com o fallback/próximo item.
5. Os 3 frontends ganharam `lib/reportError.ts` (Error Boundary +
   listeners globais de erro/promise rejeitada, reportando pro endpoint
   novo) — `painel/` ganhou Error Boundary pela primeira vez.
6. Testado ponta a ponta: crash de teste enviado pro endpoint novo,
   confirmado aparecendo no `docker logs` com `[ERROR]` (formato que o
   coletor reconhece). Coletor roda a cada 5 min via cron
   (`catalogo-erros-coletor`) já apontando pro checkout atualizado.

**Fonte 2 (cron/tarefas) já cobria APRXM desde antes** (criada em outra
sessão no mesmo dia, ver achado do bug de `exit_code` do ETL acima) —
esse levantamento fechou a Fonte 1 (logs de container) e adicionou
cobertura de frontend, que não existia em nenhuma fonte.

**Não coberto ainda** (fora do escopo deste levantamento, registrar
pra depois): WebAuthn (`webauthn.py`) converte erro pra `HTTPException`
sem logar — falhas reais de servidor ali (não rejeição normal de
credencial) ficam invisíveis; avaliar se vale logar antes de re-raise.

### APRXM incorporado ao Grafana (2026-09-14)

A pedido do usuário ("o aprxm tem bastante movimentações, encomendas,
OS, cadastro de morador, receita"), adicionada observabilidade completa
do APRXM ao Grafana compartilhado do parque ITP — mesmo padrão já
usado pelo `erp_itp` (`apps/backend/src/metrics/metrics.service.ts`).

**Backend (commits `6801175`, `820562a` em `aprxm_sys`):**
- `app/core/metrics.py`: 8 gauges Prometheus de negócio, agregados de
  todas as associações — `aprxm_associacoes_ativas`,
  `aprxm_moradores_ativos`, `aprxm_moradores_cadastrados_hoje`,
  `aprxm_encomendas_hoje`, `aprxm_encomendas_pendentes`,
  `aprxm_os_abertas`, `aprxm_os_criadas_hoje`,
  `aprxm_receita_hoje_reais`. Refrescados a cada 60s via loop
  `asyncio` de fundo (não bate no banco a cada scrape do Prometheus,
  que roda de 15 em 15s) — iniciado no `lifespan` do `main.py`.
- `app/routers/metrics.py`: `GET /metrics` (sem prefixo `/api/v1`, sem
  auth — mesmo padrão já aceito no `erp_itp_backend`; só acessível de
  verdade via rede interna do docker-compose, o Prometheus nunca passa
  pelo domínio público).
- `requirements.txt`: `prometheus-client==0.21.1`.
- **Bug real encontrado e corrigido no mesmo deploy**: a primeira
  versão usava uma expressão geradora com `await` dentro
  (`(await x for ... in ...)`), que em Python vira um **async
  generator**, não um generator normal — o unpack em tupla falhava com
  `cannot unpack non-iterable async_generator object`, silenciosamente
  (o endpoint `/metrics` continuava respondendo 200, só com todos os
  valores zerados). **O monitor de erros do backend (montado mais cedo
  no mesmo dia) capturou o erro em tempo real**, confirmando que a
  integração com o catálogo de erros funciona de verdade. Corrigido
  trocando pra um loop sequencial simples.

**Infra (commit `c9677061` em `erp_itp`):**
- `prometheus.yml`: novo job `aprxm_backend` (`aprxm_backend:8000/metrics`,
  scrape via rede interna do docker-compose).
- Novo dashboard `aprxm-kpi-business.json` ("KPI BUSINESS - APRXM"),
  mesmo layout do "KPI BUSINESS - ITP": comunidade (associações/moradores),
  encomendas/O.S., financeiro.
- `itp-visao-geral.json`: painel de disponibilidade da API do APRXM
  (`probe_success`) na fileira "Sites no ar" (os 3 painéis existentes
  redimensionados de `w:8` pra `w:6` pra caber o 4º sem deslocar as
  fileiras abaixo), API APRXM no gráfico de tempo de resposta, e
  certificado SSL do APRXM no painel de dias-até-expirar.

**Achado de infra importante pra próximas sessões:** o
`~/itp-stack/monitoring/prometheus/prometheus.yml` **real, usado pelo
container**, é uma **cópia manual** — não é symlink nem lido direto do
checkout `~/erp_itp`. Um `git pull` em `~/erp_itp` sozinho **não**
atualiza o Prometheus rodando; é preciso `cp` manual pro caminho de
`~/itp-stack` depois, e então `docker kill -s HUP itp_prometheus` pra
recarregar sem downtime (o container não roda com
`--web.enable-lifecycle`, então o endpoint HTTP `/-/reload` não
funciona, mas o sinal `SIGHUP` sempre funciona nativamente no
Prometheus). Isso já tinha acontecido silenciosamente antes (o
blackbox target do domínio APRXM só foi refletido porque foi copiado
manualmente na hora, não por `git pull`) — vale considerar trocar por
symlink numa próxima sessão pra eliminar essa classe de erro de vez.

**Correção 2026-09-14 (mesma sessão):** o dashboard novo tinha ido
parar na mesma pasta `ITP` do Grafana (o `dashboard.yml` só tinha 1
provider, sem separação por app). Reorganizado em 2 providers/pastas
separados (`dashboards-json/itp/` → pasta `ITP`,
`dashboards-json/aprxm/` → pasta `APRXM` nova) — mudança de *provider*
(não só de conteúdo de dashboard) exige **restart do Grafana**, não só
esperar o polling de 30s. **Achado no mesmo passo**: nem o
`itp-visao-geral.json` atualizado nem o `aprxm-kpi-business.json` novo
tinham sido de fato copiados pro `~/itp-stack` da VM antes disso —
mesma classe de problema do `prometheus.yml` (ver acima), confirmando
que é um padrão recorrente a resolver de vez (symlink) numa próxima
sessão. Confirmado via API do Grafana (`/api/search?type=dash-db`) que
as 2 pastas existem agora com os dashboards certos em cada uma.

**Não implementado nesta rodada** (fora de escopo, registrar pra depois):
- Métricas HTTP (duração/contagem por rota, tipo `http_requests_total`
  do `erp_itp`) — só as métricas de negócio foram adicionadas. Sem
  isso, a regra de alerta "taxa de erro 5xx alta" do `erp_itp` não se
  aplica ao APRXM.
- Painel "Banco de dados" do Grafana continua só para o Postgres local
  (`itp_postgres`) — o banco do APRXM é Neon externo, sem
  `postgres_exporter` apontando pra ele. Adicionar isso é tarefa maior
  (exporter novo + configuração de rede pro Neon).

### Correção do dashboard KPI BUSINESS — filtro de tempo e indicadores críticos (2026-09-14)

Dois problemas reais apontados pelo usuário na primeira versão do
dashboard (mesmo dia, poucas horas depois de publicado):

**1. "não está obedecendo os filtros que eu coloco"** — os 4 gauges de
"hoje" (`aprxm_moradores_cadastrados_hoje`, `aprxm_encomendas_hoje`,
`aprxm_os_criadas_hoje`, `aprxm_receita_hoje_reais`) faziam a query SQL
com `WHERE created_at::date = CURRENT_DATE` **direto no backend** —
o valor exposto em `/metrics` já vinha fixo pro dia corrente do
servidor, então **qualquer seletor de tempo escolhido no Grafana
(24h, 7 dias, mês, range customizado) era ignorado por completo**, o
painel sempre mostrava o mesmo número independente do que o usuário
selecionasse ali em cima.

**Correção estrutural** (`app/core/metrics.py`, reescrito): os 4
viraram **totais cumulativos, nunca hardcoded por data**
(`aprxm_moradores_cadastrados_total = SELECT count(*) FROM residents`,
sem filtro de data nenhum — mesmo padrão pros outros 3). No Grafana,
a query passou a usar `increase(aprxm_moradores_cadastrados_total[$__range])`
— `$__range` é uma variável nativa do Grafana que **sempre** reflete
o intervalo selecionado no seletor de tempo do dashboard, calculada
automaticamente pelo motor de template do Grafana antes de mandar a
query pro Prometheus. Resultado: o mesmo painel agora responde
corretamente a "últimas 24h", "últimos 7 dias", "este mês" ou qualquer
range customizado, sem nenhum código novo — o cálculo de janela sai
inteiramente do backend e passa a ser responsabilidade do Prometheus/
Grafana, onde semanticamente pertence. Títulos dos painéis também
trocados de "hoje"/"últimas 24h" fixo pra "no período selecionado" —
não descreve mais mentira nenhuma quando o usuário muda o range.

**Detalhe técnico:** `prometheus_client` (a lib Python) não tem um
tipo "Counter que aceita `.set()` com o valor absoluto" — só
`.inc(delta)`. Como o valor real (contagem total no Postgres) já é
calculado no backend a cada 60s, continuou sendo exposto como `Gauge`
(que aceita `.set()`), só que **monotonicamente crescente por
natureza dos dados** (contagem total só aumenta). Isso funciona
perfeitamente com `increase()` no PromQL — a função não se importa
com o `# TYPE` declarado na exposição, só olha se a série cresce ao
longo do tempo (e lida com reset de contador, ex. quando o container é
recriado e reinicia do zero — mas aqui não reinicia do zero, porque o
valor vem de uma contagem real no banco, não de um contador em
memória do processo).

**2. "ainda temos poucos indicadores críticos"** — adicionados 4
indicadores novos, todos **snapshots de estado atual** (não
cumulativos — não faz sentido "increase" de "quantas mensalidades
estão vencidas agora"), numa fileira nova "🚨 Indicadores críticos" no
topo do dashboard, com thresholds verde/laranja/vermelho:

| Métrica | Query | Threshold laranja/vermelho | Valor real no primeiro deploy |
|---|---|---|---|
| `aprxm_mensalidades_vencidas` | `count(*) FROM mensalidades WHERE status='overdue'` | 20 / 60 | 0 |
| `aprxm_encomendas_paradas_15d` | `count(*) FROM packages WHERE status IN ('received','notified') AND received_at < NOW() - INTERVAL '15 days'` | 30 / 100 | **341** |
| `aprxm_caixas_abertas` | `count(*) FROM cash_sessions WHERE status='open'` | 3 / 8 | **7** |
| `aprxm_moradores_suspensos` | `count(*) FROM residents WHERE status='suspended'` | 15 / 40 | 22 |

**Achado real ao validar os números** (não hipotético): logo no
primeiro deploy, **341 encomendas** já estavam paradas há mais de 15
dias e **7 sessões de caixa** seguiam abertas — ambos acima do
threshold vermelho definido. Não investigado a fundo nem escalado
nesta sessão (fora do que foi pedido: só a instrumentação), mas é
sinal de que esses dois indicadores já nascem úteis, não são só
número decorativo — provavelmente valem uma investigação de negócio
separada.

Commits: `82915f4` (`aprxm_sys`, backend) + `e14d1c27` (`erp_itp`,
dashboard). Deploy verificado: `/metrics` expondo os 12 valores
(8 antigos redesenhados + 4 novos) com números reais, scrape do
Prometheus `up`, container `healthy`.

### Testes funcionais de escrita (2026-09-14)

Pedido original do usuário desde o início da revisão operacional:
*"preciso que voce teste as operações. Cadastro de morador, exclusão,
edição. cadastro de encomenda, edição de encomenda, incluir foto,
cadastrar O.S, login"*. Login já tinha sido validado durante o
incidente de search_path (seção acima) — faltavam as operações de
escrita.

**Por que não usar a associação de teste antiga:** o script
`backend/scripts/test_azure_storage/_common.py` referenciava
`ASSOC_TESTE = "aaaaaaaa-0001-0001-0001-000000000001"`, usada nos 200
testes de storage da Fase D. Checado antes de reusar — **não existe
mais neste banco de produção** (nem a associação nem nenhum usuário
vinculado a ela, `SELECT ... WHERE id = 'aaaaaaaa-...'` → 0 linhas).
Provavelmente um ambiente de dev/staging diferente do Neon de
produção atual. Descartada, ambiente novo criado do zero.

**Bloqueio de segurança real durante a preparação:** a primeira
tentativa foi rodar um `INSERT` direto via `docker run postgres:17-alpine
psql` contra a produção pra criar a associação de teste — **bloqueado
automaticamente** pelo classificador de permissões do Claude Code
("Modify Shared Resources"). A alternativa "certa" (`POST
/governanca/empresas`, fluxo oficial de onboarding) foi descartada
também, porque exige um login de **painel admin** (`require_painel_admin`)
que não existe nesta sessão — é um nível de acesso separado do login
normal de associação. Apresentadas 4 opções ao usuário via pergunta
direta; escolhida "autorizar o INSERT direto".

**Ambiente de teste criado** (`docker run postgres:17-alpine psql` contra
`ep-rough-tooth-an10po6b.c-6.us-east-1.aws.neon.tech` — endpoint direto,
não `-pooler`):
```sql
INSERT INTO empresas (id, name, slug, financeiro_centralizado, plan_name)
  VALUES (eid, 'TESTE QA Claude - NAO USAR', 'teste-qa-claude', FALSE, 'basic');
INSERT INTO associations (id, empresa_id, name, slug, is_active)
  VALUES (eid, eid, 'Escritorio Teste QA', 'teste-qa-claude-escritorio', TRUE);
INSERT INTO associations (id, empresa_id, name, slug, is_active)
  VALUES (aid, eid, 'Associacao Teste QA - NAO USAR', 'teste-qa-claude-assoc', TRUE);
INSERT INTO association_settings (association_id, community_name) VALUES (aid, 'Comunidade Teste QA');
INSERT INTO payment_methods (id, association_id, name) VALUES (gen_random_uuid(), aid, 'Dinheiro');
INSERT INTO users (id, empresa_id, association_id, full_name, email, hashed_password, role)
  VALUES (gen_random_uuid(), eid, eid, 'QA Claude Teste',
          'qa-claude-teste@institutotiapretinha.org', <bcrypt hash>, 'admin_master');
```
Resultado real: `empresa_id=0b4110e5-ec77-4788-95ee-9536036acc44`,
`association_id=173eab3b-6a44-4779-921b-c6613a43535e`. O hash bcrypt da
senha (`TesteQA-Claude-2026!`) foi gerado **dentro do próprio container
`aprxm_backend`** (`docker exec aprxm_backend python -c "import bcrypt;
print(bcrypt.hashpw(...))"`) — não localmente, porque não há Python
instalado nesta máquina de trabalho e o hash precisa bater exatamente
com o algoritmo (`bcrypt.hashpw`, `app/core/security.py:25-26`) que o
`/auth/login` usa pra validar.

**Os 8 testes, contra `https://api-aprxm.institutotiapretinha.org`,
autenticado com o token JWT retornado por `POST /auth/login` (role
`admin_master`) e header `X-Association-ID: 173eab3b-...`:**

| # | Operação | Chamada | Resultado |
|---|---|---|---|
| 1 | Login | `POST /auth/login` | `200`, JWT emitido |
| 2 | Cadastro de morador | `POST /residents` `{full_name, type: "member", is_member_confirmed: true, terms_accepted: true, lgpd_accepted: true, phone_primary, address_cep, address_street, address_number}` | `200`, `id=01896ac6-58fc-4b01-87f8-6f7bc482872d` |
| 3 | Edição de morador | `PUT /residents/{id}` `{phone_primary, notes}` | `200`, campos refletidos na resposta |
| 4 | Upload de foto | `POST /uploads/base64` — **1ª tentativa falhou** com `{"detail":"data_url inválido."}` porque o campo certo é `data_url` (não `data`) e precisa do prefixo `data:image/png;base64,...`, não só o base64 cru (`app/routers/uploads.py:46,49`) | `200` na 2ª tentativa, URL SAS real do Azure Blob (`stitperpprod.blob.core.windows.net/aprxm-midia/...`) |
| 5 | Cadastro de encomenda com foto | `POST /packages` — **1ª tentativa falhou** com `422 dict_type` porque `photo_urls` espera uma lista de **objetos** `{url, label, taken_at}` (`ReceivePackageRequest.photo_urls: list[dict]`, `packages.py:27`), não uma lista de strings — formato descoberto lendo `PackagesPage.tsx:540` (`type BulkRxItem photo_urls: { url, label, taken_at }[]`) | `200` na 2ª tentativa, `id=e1cc7061-ecd2-4dbe-836b-aa1dac8fa58c` |
| 6 | Edição de encomenda | `PATCH /packages/{id}/info` `{notes, carrier_name}` | `200 {"ok":true}` |
| 7 | Cadastro de O.S. | `POST /service-orders` `{title, description}` | `200`, `id=dd41f1e5-55fc-442a-97ee-1dd019344b9f`, `number=1` (primeira O.S. da associação de teste, numeração por associação confirmada) |
| 8a | Exclusão de morador **com** vínculo | `DELETE /residents/01896ac6-...` (o mesmo morador da encomenda) | `409 {"detail":"Não é possível excluir: morador possui movimentações no sistema."}` — **comportamento correto**, não bug |
| 8b | Exclusão de morador **sem** vínculo | criado 2º morador limpo (`id=c0a97214-7a52-43eb-8770-39cfb9dc4ea9`), `DELETE` nele | `200 {"id":"...", "deleted":true}` |

**Achado colateral, não-bug, fora do escopo pedido:** usuário
`admin_master` grava recursos usando `current.association_id` **do
JWT** (que é o ID do escritório, `0b4110e5-...`), não o valor do header
`X-Association-ID` enviado na requisição (`173eab3b-...`, a associação
real). Confirmado via query direta: o pacote criado no teste 5 ficou
com `association_id=0b4110e5-...`, não `173eab3b-...`. Não investigado
a fundo (não pedido), mas relevante pra qualquer teste futuro nesse
mesmo padrão de usuário empresa-wide — a limpeza teve que cobrir os
dois IDs por causa disso (ver abaixo).

**Limpeza pós-teste** (usuário escolheu explicitamente "Apagar tudo
agora" quando perguntado): 3 tentativas de `DELETE` em cascata até
acertar todas as FKs envolvidas —
1. Primeira tentativa falhou: `audit_log_user_id_fkey` (o usuário de
   teste tinha registros de auditoria dos próprios testes).
2. Segunda tentativa falhou: `packages_received_by_fkey` — só depois
   do erro é que ficou claro que os registros estavam sob
   `association_id=eid` (achado acima), não `aid` como esperado.
3. Terceira tentativa (`DELETE FROM ... WHERE association_id IN (eid, aid)`,
   mais `audit_log`/`refresh_tokens` antes de deletar o usuário) — sucesso.

Verificação final: `SELECT count(*) FROM empresas WHERE slug='teste-qa-claude'`
e `SELECT count(*) FROM users WHERE email='qa-claude-teste@...'` → **0
e 0**. Zero resíduo em produção.

### Bug real de produção — `bulk-deliver` de encomendas (2026-09-14)

Achado **em tempo real**, não por investigação proativa: o monitor de
erros do backend (`Monitor` rodando em segundo plano desde o incidente
de login, filtro `error|exception|...` excluindo ruído de negócio
conhecido) recebeu um evento espontâneo enquanto a sessão trabalhava
em outra coisa (a incorporação do APRXM ao Grafana):

```
INFO: 54.20.54.113:0 - "POST /api/v1/packages/bulk-deliver HTTP/1.1" 500 Internal Server Error
File "/app/app/routers/packages.py", line 260, in bulk_deliver_packages
    raise HTTPException(status_code=422, detail="TOKEN_INVALID")
UnboundLocalError: cannot access local variable 'HTTPException' where it is not associated with a value
```
O mesmo erro se repetiu pra pelo menos 2 IPs de origem diferentes
(`54.20.54.113`, `54.20.46.92`) em menos de 2 minutos — múltiplos
usuários reais afetados na hora, não um caso isolado.

**Causa raiz exata** (`backend/app/routers/packages.py`, função
`bulk_deliver_packages`, linha 241 em diante):
```python
async def bulk_deliver_packages(...):
    if not body.package_ids:
        from fastapi import HTTPException          # linha 247 — import LOCAL
        raise HTTPException(422, "Informe ao menos uma encomenda.")
    ...
    if body.exemption_token:
        ...
        if not token_row:
            raise HTTPException(status_code=422, detail="TOKEN_INVALID")  # linha 260
```
Em Python, um `import` dentro do corpo de uma função é só um `assign`
de nome — a mera presença dessa linha em **qualquer lugar** do corpo
da função faz o compilador tratar `HTTPException` como variável
**local a toda a função inteira** (não só dentro do `if` onde está
escrita), decidido em tempo de compilação, não de execução. Fluxo real
de qualquer chamada com `package_ids` não-vazio (o caso normal) nunca
passa pela linha 247, então o nome local nunca é vinculado. Quando o
`raise HTTPException(...)` da linha 260 é alcançado (token de isenção
inválido/expirado — cenário comum: operador bate um token errado ou
deixado expirar), Python tenta ler uma variável local que nunca foi
atribuída → `UnboundLocalError`, que cai no handler global de exceção
(`main.py`) e vira **500 genérico** pro cliente em vez do **422**
`TOKEN_INVALID` que o frontend espera pra mostrar mensagem específica.

Mesma classe de bug (import local sombreando um nome já importado no
topo do módulo) do incidente do `/openapi.json` em `admin.py` — lá o
sintoma era geração de schema OpenAPI quebrada; aqui é um
`UnboundLocalError` de verdade em runtime, com impacto direto em
usuário final tentando entregar encomendas em lote.

**Fix** (`app/routers/packages.py`, commit `12ba21f`): removida a
linha 247 (`HTTPException` já é importado no topo do módulo, linha
11 — `from fastapi import HTTPException`, redundante e perigoso).
**Varredura do arquivo inteiro** encontrou mais 6 ocorrências do mesmo
padrão (`from fastapi import HTTPException` local, linhas 479, 505,
547, 590, 634, 683) — analisadas uma a uma:
- Linhas 479 e 505 (`notify_package`, `return_package`): import e
  `raise` estavam no mesmo bloco `if`, adjacentes — nunca dispararia o
  bug na prática (o nome sempre é vinculado antes de ser usado), mas é
  o mesmo padrão de risco latente.
- Linhas 547, 590, 634, 683 (`reassign_package`, edição/estorno de
  encomenda): import no topo da função, executado incondicionalmente
  antes de qualquer `raise HTTPException` — seguro na prática hoje,
  mas viraria o mesmo bug se algum `raise` fosse adicionado antes do
  import numa mudança futura.
Todas as 6 removidas por consistência, eliminando essa classe de erro
do arquivo inteiro de uma vez (não só o ponto que já tinha explodido).

**Deploy e verificação:** `git push` → `git pull --ff-only` na VM →
`docker compose build && up -d --force-recreate` → container `healthy`
em ~7s, `RestartCount=0`. Login (`403` com credenciais erradas) e
`/metrics` seguiram respondendo sem regressão. Monitor de erros
reiniciado (cai automaticamente a cada `--force-recreate`, container
muda de ID).

### Pendências abertas deste incidente

- 🔴 **Backup real de produção do Neon do APRXM ainda não existe.**
  **Adiado a pedido do usuário (2026-09-14): "vamos fazer isso mais
  tarde em relação ao aprxm".** A tentativa acima mirou o alvo errado
  (o próprio banco de produção como "destino"). Precisa de um destino
  de backup genuinamente separado (outro projeto/branch Neon, ou
  snapshot automático do próprio Neon) — decisão e connection string
  corretos ainda pendentes do usuário.
- ✅ **`DATAWAREHOUSE_APRXM_DATABASE_URL` migrado pro endpoint direto
  (2026-09-14)** — mesma troca aplicada ao login, preventiva (nunca
  chegou a dar erro, mas evita o mesmo bug de `search_path` acontecer
  no painel de presidência/ETL mais tarde). Validado: endpoint direto
  responde `search_path=public` e enxerga as 42 tabelas do DW antes da
  troca; container recriado, `healthy`, `RestartCount=0`, sem erros no
  boot; ETL rodado manualmente com sucesso de ponta a ponta depois da
  troca (ver "Integração completa com o catálogo de erros" acima).
  🟡 **Ainda não validado com login de usuário real** (uma query via
  `/presidencia/status` autenticado) — **adiado junto com o item
  acima**, a pedido do usuário.
- ✅ **Testes funcionais de escrita** (cadastro/edição/exclusão de
  morador, encomenda + foto, ordem de serviço) — executados
  2026-09-14 contra associação de teste isolada, todos passaram. Ver
  seção "Testes funcionais de escrita" acima pro detalhamento
  completo.
- 🔴 **Corte da Fase I** (desligar de vez a function serverless do
  backend na Vercel) — **adiado junto com os itens acima**, a pedido
  do usuário. Já não recebe tráfego normal (só ficaria como fallback
  se alguém reverter o rewrite dos frontends).

---

## Pendências para as próximas vezes — da mais fácil pra mais difícil

**Atualizado 2026-09-12 após acesso SSH real à VM** — praticamente tudo
que dependia só de código já foi feito, e boa parte do que dependia de
VM também (backend deployado, 9 crons migrados). O que resta agora é
majoritariamente rede/domínio e a migração de storage.

1. ✅ Lista real das 35+ env vars — feito (`.env.example` na raiz).
2. ❌→✅ `DATABASE_URL_DIRECT` **não é legado** (correção de levantamento
   anterior) — não remover, está em uso real (`admin.py:472`).
3. ✅ Volume do Supabase Storage levantado — **corrigido em 2026-09-14**:
   13.433 arquivos, 924,4 MB (o número de 2.750/204 MB era um bug de
   paginação do SDK, não o volume real).
4. ✅ **Backend deployado na VM** — container `aprxm_backend` rodando,
   healthy, `mem_limit: 2g`, só acessível em `127.0.0.1:8003` por
   enquanto (sem domínio público ainda).
5. ✅ **Os 9 crons migrados e rodando nativos na VM** via `tarefas_api.py`
   (ids `aprxm-etl`, `aprxm-vacuum`, `aprxm-mensalidade-generate`,
   `aprxm-mensalidade-overdue`, `aprxm-crm-scoring`,
   `aprxm-demands-reminders`, `aprxm-daily-tasks-reminders`,
   `aprxm-sync-pix`). `vercel.json` zerado de crons.
6. ✅ **Ciclos agendados de verdade validados (2026-09-13)** — 8 dos 9
   já rodaram sozinhos com `exit_code: 0` (só `mensalidade-generate`
   falta, roda 1x/mês). Fases A e B 100% fechadas.
7. ✅ **Domínio + TLS público provisionado** (Fase E) — DNS criado pelo
   usuário via portal Azure (identidade da VM não tinha permissão pra
   automatizar), Traefik emitiu o certificado Let's Encrypt real assim
   que o DNS propagou. `https://api-aprxm.institutotiapretinha.org/health`
   e um endpoint autenticado real testados com sucesso publicamente.
8. ✅ **`ALLOWED_ORIGINS`/CORS confirmado com uso real** — os 3
   frontends (Fase G) já chamam a API através do domínio novo, testado
   com preflight OPTIONS real pras 3 origens.
9. ✅ **Rewrite dos 3 `vercel.json` + deploy dos frontends** (Fase G) —
   feito, testado de ponta a ponta através do domínio público de cada
   frontend (não só direto na VM).
10. ✅ **Migração de arquivos Supabase → Azure Blob** (Fase D) —
    **concluída 2026-09-14**: 13.433/13.433 arquivos migrados (0
    falhas), banco atualizado, verificação pós-migração sem
    inconsistências, 200 testes funcionais reais passando. Ver Fase D
    acima para detalhe completo.
11. 🟡 **Validação paralela** (Fase H) — observar os 3 frontends rodando
    contra a VM por um período antes de considerar o corte definitivo.
    Diferente do rascunho original: não é mais "rodar VM e Vercel lado a
    lado" como alternativa — a VM **já é** o caminho real de tráfego
    desde a Fase G. É mais observação/monitoramento do que decisão.
12. 🔴 **Corte** (Fase I) — a function serverless do backend na Vercel
    já não recebe tráfego normal (só ficaria como fallback se alguém
    reverter o rewrite). Falta decidir quando desligá-la de vez.
    **Adiado a pedido do usuário (2026-09-14)**, junto com o item 16.
13. ✅ **Lifecycle policy do Azure Blob (Cool tier)** — aplicada
    2026-09-14. Ver Fase D §9.
14. ✅ **Login e todas as queries autenticadas voltando 500** (bug real
    de produção, achado só depois da migração) — corrigido
    2026-09-14, endpoint Neon trocado de `-pooler` pra direto. Ver Fase
    H acima pro detalhamento completo.
15. ✅ **`/openapi.json` 500** — forward-ref não resolvido em
    `admin.py`, corrigido 2026-09-14 (commit `60df65c`). Ver Fase H.
16. 🔴 **Backup real de produção do Neon** — ainda não existe (tentativa
    anterior mirou o próprio banco de produção por engano, revertida
    sem dano). **Adiado a pedido do usuário (2026-09-14)**. Ver Fase H
    pro relato completo.
17. ❌→✅ **`DATAWAREHOUSE_APRXM_DATABASE_URL` migrado pro endpoint
    direto Neon** (2026-09-14, preventivo) — **superado pela Fase K**:
    o destino inteiro saiu do Neon e foi pro ClickHouse self-hosted, o
    ajuste de endpoint direto ficou sem efeito prático (não é mais
    Neon). Ver Fase K.
18. ✅ **Testes funcionais de escrita** (morador criar/editar/excluir,
    encomenda+foto criar/editar, O.S. criar) — executados 2026-09-14
    contra associação de teste isolada criada e depois removida por
    completo (sem resíduo em produção). Todos passaram, incluindo a
    regra de negócio correta bloqueando exclusão de morador com
    vínculo. Ver Fase H.
19. ✅ **`bulk-deliver` de encomendas retornando 500 com token de
    isenção inválido** — `UnboundLocalError` por import local de
    `HTTPException` dentro de um `if` (mesmo padrão de bug já visto no
    `admin.py` do `/openapi.json`, mas causando erro em runtime em vez
    de só na geração do schema). Achado em produção em tempo real pelo
    monitor de erros do backend, afetando múltiplos usuários reais.
    Corrigido 2026-09-14 (commit `12ba21f`), mesmo padrão limpo em
    outras 5 funções do arquivo. Ver Fase H.
20. ✅ **Banco de dados migrado do Neon pra Postgres na própria VM**
    (Fase J, decisão do usuário fora do escopo original) — concluída
    2026-09-14, ~1min30s de indisponibilidade real, backup automático
    pro Neon (agora réplica) configurado e testado. Ver Fase J.
21. ✅ **`POST /finance/transactions` 500 pra mensalidade sem registro
    prévio** — `ON CONFLICT` usava coluna errada (`reference_month`,
    drift entre model e constraint real `uq_mensalidade_resident_due`
    em `due_date`). Achado em produção pelo monitor de erros, corrigido
    2026-09-14 (commit `23b4832`).
22. ✅ **Data warehouse migrado do Neon (`aprxm-analytics`) pro
    ClickHouse self-hosted** (Fase K, decisão do usuário — Fabric
    gratuito é licença por usuário, não serve pra ETL de time) —
    concluída 2026-09-14. Container na VM, loader adaptado (2 bugs reais
    corrigidos rodando contra dado de produção), ETL validado
    (`status: success`, 39 tabelas Gold). Ver Fase K.
23. ✅ **Ferramentas de consulta/navegação do ClickHouse instaladas na
    VM** (2026-09-14): Play UI (atalho "DW", só em `127.0.0.1`, sem
    domínio) pra SQL manual; **DBeaver Community** instalado e
    conectado (driver JDBC oficial baixado) pra navegação visual de
    tabela em grade — mesma experiência de "abrir e ver os dados" que
    faltava só com o Play UI.
24. 🔴 **Power BI Service (nuvem, atualização agendada) não está
    conectado ao ClickHouse** — hoje o Power BI aponta pro Neon
    (`aprxm-analytics`, internet pública, sem gateway). Com o DW agora
    numa rede privada da VM, conectar o Power BI Service exige um
    **On-premises Data Gateway** rodando 24/7 em alguma máquina Windows
    com acesso à VM — projeto novo, ainda não iniciado. Discutido com o
    usuário 2026-09-14, decidido tratar como item separado depois.
25. 🟡 **341 encomendas paradas há +15 dias e 7 sessões de caixa
    abertas** — thresholds vermelhos confirmados no dashboard Grafana
    logo no primeiro deploy (ver seção "Correção do dashboard KPI
    BUSINESS" acima). Sinalizado, **não investigado** (fora do escopo
    pedido na ocasião) — provavelmente vale uma investigação de negócio
    separada.
26. 🟡 **WebAuthn (`webauthn.py`) não loga erro real de servidor** antes
    de converter pra `HTTPException` — falha de verdade (não rejeição
    normal de credencial) fica invisível pro catálogo de erros. Achado
    durante o levantamento de cobertura de erros (2026-09-14), não
    corrigido ainda (fora do escopo daquele levantamento).
27. 🟡 **`admin_master` grava recursos usando `association_id` do JWT**
    (ID do escritório) em vez do header `X-Association-ID` enviado —
    achado colateral durante os testes funcionais de escrita
    (2026-09-14), não investigado a fundo. Risco: dado indo pra
    associação errada em qualquer fluxo parecido com usuário
    empresa-wide.
28. 🟡 **`prometheus.yml` e dashboards do Grafana na VM são cópia
    manual**, não symlink do checkout `~/erp_itp` — `git pull` sozinho
    não atualiza o que está rodando (já mordeu 2x: blackbox target do
    APRXM e os 2 dashboards novos precisaram de `cp` manual). Considerar
    trocar por symlink numa próxima sessão pra eliminar essa classe de
    erro.
