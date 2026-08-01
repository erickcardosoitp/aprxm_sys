# ETL empresa-aware + gold no projeto correto — Design

**Data:** 2026-08-01 · **Status:** aprovado, pendente de plano de implementação

## Contexto

O ETL (`backend/app/services/datalake_service.py`) foi construído **antes** do ESC/governança
empresa (Fases 9-11) e nunca foi atualizado depois — `grep empresa_id` no arquivo retorna
zero ocorrências. Dois problemas concretos:

1. **Sem `empresa_id` em nenhuma tabela `dim_`/`fact_`.** Funciona "por acidente" hoje porque
   só existe 1 empresa real (SAPE, 2 associações — Vaz Lobo/Congonha). Se uma 2ª empresa
   entrar na plataforma, os dados dos dois clientes se misturam nas mesmas tabelas
   analíticas, sem isolamento.
2. **Gold grava no lugar errado.** `ANALYTICS_DATABASE_URL` aponta pro schema `analytics.*`
   dentro do banco operacional "APRXM" (`shy-sun-98696640`) — o projeto Neon dedicado
   `aprxm-analytics` (`wispy-frost-54420468`) existe, está provisionado e acessível, mas
   **vazio**, nunca foi de fato o destino.

Este spec cobre só a reestruturação do ETL — os KPIs em si (`docs/superpowers/specs/
2026-08-01-painel-presidencia-design.md`) não mudam, só a origem/destino do dado.

## Escopo

1. Gold passa a gravar no projeto `aprxm-analytics`, não mais no schema `analytics.*` do
   banco principal.
2. Bronze passa a extrair por empresa, reaproveitando o padrão já usado em
   `esc_service.py` (`empresa_assoc_ids(empresa_id)` → filtra por essa lista de
   associações), em vez de iterar tabela operacional sem noção de tenant.
3. Toda tabela `dim_`/`fact_` ganha coluna `empresa_id`.
4. `/presidencia/*` reaponta pro destino novo assim que validado; os 5 KPIs restantes de
   `/resumo` (pausados) retomam contra o destino novo, evitando reescrever contra o schema
   que vai ser abandonado.
5. Schema `analytics.*` antigo (banco principal) é **dropado** depois de validado o novo
   pipeline — sem dado histórico de valor lá (congelado desde 27/05, já sabidamente stale).

## Arquitetura

```
                    ┌─────────────────────────────────────────┐
                    │ backend/app/services/datalake_service.py│
                    └───────────────┬───────────────────────────┘
                                    │
   Neon "APRXM" (OLTP) ──bronze──► por empresa:            │
   residents/transactions/           empresa_assoc_ids(id)  │
   packages/mensalidades/            → filtra association_id│
   service_orders                    → marca empresa_id      │
                                    │                          ▼
                              Cloudflare R2            ──silver──► ──gold──►
                              (DATA LAKE — bronze/silver, como já é hoje)
                                                                    │
                                                                    ▼
                                                    Neon "aprxm-analytics"
                                                    (DATA WAREHOUSE — projeto dedicado, hoje vazio)
                                                    dim_date, dim_resident,
                                                    dim_association, fact_*
                                                    (todas com empresa_id)
```

## Mudanças por camada

### Bronze (extração)

- Novo passo inicial: `SELECT id FROM empresas` (hoje 1 linha). Pra cada empresa, resolve
  `empresa_assoc_ids(empresa_id)` (mover essa função de `esc_service.py` pra um lugar
  compartilhado, ex. `app/core/tenant.py`, se ainda não estiver acessível sem import
  circular — ela já existe, só reaproveitar).
- Toda extração hoje "solta" (`residents`, `transactions`, `packages`, etc.) ganha filtro
  `WHERE association_id = ANY(:ids)` por empresa, e a linha resultante ganha uma coluna
  `empresa_id` antes de seguir pro bronze no R2.
- Extração incremental (`last_extracted_at`) continua igual — o filtro por empresa é
  ortogonal ao corte por data.

### Silver / Gold

- Lógica de limpeza/enriquecimento (`build_silver`, `build_gold`) não muda de forma —
  só precisa propagar a coluna `empresa_id` que já vem do bronze, sem descartar.
- Nenhuma tabela nova neste momento — mesmo conjunto de `dim_`/`fact_` do spec do painel,
  só com `empresa_id` a mais em cada uma.

### Load (destino)

- `_write_gold_sync`/`load_gold_to_analytics`: connection string passa a ser a do projeto
  `aprxm-analytics`, via a nova env var `DATAWAREHOUSE_APRXM_DATABASE_URL` (substitui
  `ANALYTICS_DATABASE_URL`) — **decisão operacional, não de código**: criar a env var no
  Vercel e no `.env` local, valor não vai commitado no repo.
- Primeira carga é `CREATE TABLE` (via `to_sql(..., if_exists="replace")`, já é o
  comportamento do código pra tabela inexistente) — não precisa de migração de dado, é
  banco vazio recebendo carga nova.

## Plano de corte (sem downtime real, é OLAP read-only)

1. Criar `DATAWAREHOUSE_APRXM_DATABASE_URL` (Vercel + `.env` local) apontando pro projeto
   `aprxm-analytics`; código passa a ler essa env var em vez de `ANALYTICS_DATABASE_URL`.
2. Rodar ETL manual (`POST /datalake/run/manual`, `force_full=true`) — popula do zero no
   destino novo, já com `empresa_id`.
3. Validar: `SELECT DISTINCT empresa_id FROM analytics.fact_transactions` (ou schema
   equivalente no projeto novo) retorna a empresa real, contagens batem com o operacional.
4. Repontar `presidencia_service.py` pro destino novo (troca de connection string, mesma
   lógica de query — `analytics.*` continua sendo o nome do schema, só o projeto muda).
5. Confirmar `/presidencia/inicio` com dado fresco (não mais zero).
6. Dropar schema `analytics.*` do banco principal "APRXM".

## Testes

- Bronze: teste que, com 2 empresas fake (fixture), cada linha extraída carrega o
  `empresa_id` correto e nenhuma linha de uma empresa aparece na extração da outra.
- Load: teste que `_write_gold_sync` conecta na URL configurada (mock de engine),
  sem assumir schema/projeto hardcoded.
- Smoke pós-corte: `/presidencia/status` retorna `analytics_reachable: true` e
  `/presidencia/inicio` retorna números não-zero pro mês corrente.

## Decisões — confirmadas

- **`empresa_assoc_ids()`** move de `esc_service.py` pra `tenant.py` (mesmo lugar dos outros
  mecanismos de escopo já documentados lá).
- **Nomenclatura (terminologia corrigida):** Cloudflare R2 (bronze/silver) é o **data lake**
  — bruto/semi-estruturado. O projeto Neon dedicado (gold, schema dimensional `dim_`/`fact_`)
  é o **data warehouse** — estruturado, otimizado pra BI/relatório. `datalake_service.py` e
  `/datalake/*` continuam com esse nome (são o pipeline completo, ponta a ponta, não só a
  camada R2 — renomear o arquivo é um refactor separado, fora de escopo aqui). A env var que
  aponta pro destino do gold é renomeada pra deixar a camada explícita:
  `DATAWAREHOUSE_APRXM_DATABASE_URL` (substitui `ANALYTICS_DATABASE_URL`).
