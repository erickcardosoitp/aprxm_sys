# ETL empresa-aware + gold no data warehouse — Plano de Implementação

Spec: [2026-08-01-etl-empresa-aware-design.md](../specs/2026-08-01-etl-empresa-aware-design.md)

⚠️ **2 pontos exigem ação sua fora do código** (criar env var no Vercel, disparar ETL
manual logado) — marcados abaixo com ⏸.

---

## Fase 0 — Fundação (config + helper compartilhado)

- [ ] `config.py`: nova setting `datawarehouse_aprxm_database_url` (mantém
      `analytics_database_url` por enquanto, só marcado como legado no comentário —
      remove de vez na Fase 3 depois do corte).
- [ ] `tenant.py`: mover `empresa_assoc_ids(empresa_id)` de `esc_service.py` pra cá
      (mesmo padrão dos outros helpers de escopo). Atualizar import em `esc_service.py`
      pra reaproveitar de `tenant.py` em vez de definir local.
- [ ] Teste: `empresa_assoc_ids` importável de `tenant.py`, comportamento idêntico
      (mesmo teste que já cobria via `esc_service.py`, só migrado).

## Fase 1 — Bronze empresa-aware

- [ ] Novo passo inicial na extração: `SELECT id FROM empresas`.
- [ ] Pra cada empresa: resolve `empresa_assoc_ids(empresa_id)`, filtra
      `residents`/`transactions`/`packages`/`mensalidades`/`service_orders` por
      `association_id = ANY(ids)`, marca `empresa_id` em cada linha antes do bronze.
- [ ] Extração incremental (`last_extracted_at`) mantida — filtro por empresa é
      ortogonal ao corte por data, não muda essa lógica.
- [ ] Teste: fixture com 2 empresas fake, cada linha extraída carrega o `empresa_id`
      correto, nenhuma linha de uma empresa aparece na extração da outra.

## Fase 2 — Silver/Gold propaga empresa_id

- [ ] `build_silver`/`build_gold`: garantir que a coluna `empresa_id` (vinda do bronze)
      não é descartada em nenhum merge/groupby/pivot.
- [ ] Teste: `empresa_id` presente em todo dataframe gold gerado.

## Fase 3 — Load no destino novo + corte (checkpoints manuais)

- [ ] `_write_gold_sync`/`load_gold_to_analytics`: passam a ler
      `settings.datawarehouse_aprxm_database_url` em vez de `analytics_database_url`.
- [ ] ⏸ **Você precisa:** criar a env var `DATAWAREHOUSE_APRXM_DATABASE_URL` no Vercel
      (produção) e no `.env` local, apontando pro projeto Neon `aprxm-analytics`.
- [ ] ⏸ **Você precisa:** disparar `POST /datalake/run/manual?force_full=true` logado
      como admin (endpoint exige JWT, não consigo chamar daqui sem sua sessão).
- [ ] Validar (eu faço, via MCP): `SELECT DISTINCT empresa_id FROM analytics.fact_transactions`
      no projeto `aprxm-analytics` retorna a empresa real; contagens batem com o
      operacional (residents, transactions, packages).
- [ ] `presidencia_service.py`: repontar `_analytics_async_url()` pro destino novo.
- [ ] Confirmar `GET /presidencia/status` → `analytics_reachable: true` e
      `GET /presidencia/inicio` → números não-zero pro mês corrente.

## Fase 4 — Limpeza e retomada do painel

- [ ] ⏸ **Confirmação sua antes de eu rodar:** `DROP SCHEMA analytics CASCADE` no banco
      principal "APRXM" (destrutivo — só depois da Fase 3 validada de ponta a ponta).
- [ ] Retomar os 5 KPIs restantes de `/resumo` (taxa cobrança, inadimplência, retenção,
      tarefas no prazo, score operadores) contra o destino novo — mesmo padrão `_wow()`
      já estabelecido na Fase 1 do painel.
- [ ] Remover `analytics_database_url`/`ANALYTICS_DATABASE_URL` de vez (config.py + Vercel)
      depois de confirmado que nada mais lê essa env var.

## Riscos conhecidos

- Se `empresa_assoc_ids` tiver algum caller além de `esc_service.py` que dependa do import
  local, ajustar na Fase 0 antes de seguir (checar com grep antes de mover).
- Extração por empresa multiplica o número de queries por N empresas — hoje N=1, sem
  impacto; se a plataforma crescer, revisar performance da Fase 1 nesse momento, não agora.
