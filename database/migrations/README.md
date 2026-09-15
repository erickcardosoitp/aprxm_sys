# database/migrations — histórico, NÃO fonte de verdade

⚠️ **Esta pasta é documentação/histórico. Rodar estes `.sql` em sequência NÃO reconstrói o schema.**

## Fonte de verdade real

O schema de produção é aplicado por **`backend/app/db/migrations.py`**:

- versionado pela constante `SCHEMA_VERSION`
- registrado na tabela `schema_migrations (version, applied_at, description)`
- protegido por `pg_try_advisory_xact_lock` — uma instância migra, as outras saem cedo
- roda no lifespan do FastAPI (cold start), com fast-exit quando já atualizado

Nenhum outro código consome `schema_migrations`. Os arquivos aqui são registro do que
foi aplicado (vários trazem no topo o comentário "já aplicada em produção, este arquivo documenta").

## Regras

1. **Mudança de schema nova** → implementar em `backend/app/db/migrations.py` e bumpar `SCHEMA_VERSION`.
   Opcionalmente documentar aqui com o próximo número da sequência.
2. **Todo bloco precisa ser replay-safe / idempotente.** Ao bumpar a versão, os blocos anteriores
   reexecutam — bloco não idempotente causa outage no cold start (já aconteceu na Fase 8a).
3. **Nunca `DROP TYPE ... CASCADE`** numa coluna de produção. Ver incidente abaixo.
4. **Dados de teste/seed não vivem aqui** — ficam em `database/seeds/`, fora do fluxo de deploy.

## Incidente documentado — `020_*` (perda da coluna `service_orders.status`)

Três arquivos competem pelo número 020, na ordem em que foram executados:

| Arquivo | O que aconteceu |
|---|---|
| `020_os_status_redesign.sql` | Tentou recriar o enum `service_order_status` com `DROP TYPE` simples. Falhou: a coluna tinha `DEFAULT` dependente do tipo. |
| `020_fix_enum.sql` | "Correção": `DROP DEFAULT` + `ALTER TYPE ... USING CASE` + **`DROP TYPE ... CASCADE`**. O `CASCADE` derrubou a própria coluna `status`. |
| `020_restore_status.sql` | Recriou a coluna do zero e **reconstruiu os valores a partir de `service_order_history`** (`DISTINCT ON` pelo `to_status` mais recente). |

**Lições:**
- O dado só foi recuperável porque existia tabela de auditoria. Sem ela, perda permanente.
- Antes de qualquer `DROP TYPE`/`DROP ... CASCADE`, consultar `pg_depend` e listar exatamente o que será derrubado.
- Esta sequência **não é replay-safe** — não rodar em staging esperando reproduzir o schema final.
