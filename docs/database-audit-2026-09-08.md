# Auditoria de Banco de Dados — erp_itp_db (VM produção)

**Data:** 2026-09-08
**Escopo:** schema `public` do banco `erp_itp_db` (Postgres 17.11, container `itp_postgres`, VM `20.114.240.177`)
**Método:** inspeção via `psql` (information_schema, pg_constraint, pg_indexes, pg_stat_user_tables) — 66 tabelas analisadas
**Volume atual:** baixo (maior tabela: `diario_academico`, 5.560 linhas) — sistema em fase inicial de adoção

---

## Resumo executivo

Banco funcional e sem corrupção, mas com dívida estrutural relevante para um ERP que vai lidar com dados financeiros e de LGPD (matrícula de menores). Os problemas não são de performance hoje (volume pequeno), são de **integridade e auditabilidade**: dá pra escrever dado inconsistente sem o banco reclamar, e não dá pra provar quem fez o quê depois do fato.

Prioridade de correção: **integridade referencial do financeiro > auditoria > índices > nomenclatura**.

**Por onde começar de verdade** (dado o volume atual baixo e a equipe reduzida): só os itens **#1** (FK financeiro) e **#4** (soft delete) têm risco real de dado incorreto ou perda irreversível hoje — merecem ser priorizados antes do resto. Índices (#6) e nomenclatura (#8/#9) não geram risco no volume atual e podem esperar sem custo.

---

## P0 — Crítico

### 1. Financeiro denormalizado apesar de ter as tabelas de lookup

`movimentacoes_financeiras` guarda `categoria`, `plano_contas`, `tipo_movimentacao`, `forma_pagamento` como `varchar` livre — mas as tabelas `categorias_financeiras`, `planos_contas`, `tipos_movimentacao`, `formas_pagamento` **já existem e não são referenciadas**. Nenhuma FK liga uma à outra.

Consequência: renomear uma categoria não atualiza o histórico; um typo cria uma categoria fantasma que não aparece em nenhum relatório agrupado por categoria; não dá pra fazer `JOIN` confiável para análise financeira (a mesma análise que você acabou de pedir sobre uso do financeiro já bateu nesse problema).

**Ação:** migrar as 4 colunas para `*_id uuid REFERENCES <tabela>(id)`, backfill por nome, manter coluna antiga só até validar.

### 2. `boletos.arquivo_base64` — blob binário no banco

Viola regra explícita do projeto (CLAUDE.md: "sem blob binário no banco, usar Cloudinary/R2"). Coluna `text` guardando base64 de PDF. Infla o tamanho da tabela, degrada backup/restore e `pg_dump`, sem necessidade.

**Ação:** mover para Azure Blob Storage (`stitperpprod`/container `arquivos` — mesmo storage que o resto do erp_itp já usa desde 2026-09-09, via `SupabaseService`/`apps/backend/src/modules/supabase/supabase.service.ts`), manter só o path/URL assinada.

### 3. `boletos` sem vínculo a `aluno`/`inscrição`

Tabela só tem `pessoa_nome`/`pessoa_tipo` (texto livre). Não há como saber com confiabilidade a quem um boleto pertence via join — só via nome digitado. Mesmo padrão em `chamados_academicos` (`aluno_nome`, `turma_nome`, `responsavel_nome`, `fila_nome` são snapshots de texto; só `aluno_id`/`turma_id` existem como coluna solta, **sem FK declarada**).

**Ação:** declarar FK em `chamados_academicos.aluno_id` e `.turma_id` (colunas já existem, só falta o constraint); adicionar `aluno_id`/`inscricao_id uuid REFERENCES` em `boletos`.

### 4. Soft delete praticamente inexistente

De 66 tabelas, só `captacao_opportunities` tem `deleted_at`. Todo o resto — `alunos`, `usuarios`, `inscricoes`, `movimentacoes_financeiras`, `boletos` — faz hard delete. Não há trilha de exclusão em dado de aluno (LGPD) nem em lançamento financeiro.

**Ação:** adicionar `deleted_at timestamptz` pelo menos em `alunos`, `usuarios`, `movimentacoes_financeiras`, `inscricoes`, `boletos`; trocar `DELETE` por `UPDATE ... SET deleted_at = now()` nos services correspondentes.

---

## P1 — Importante

### 5. Autoria (quem criou/alterou) ausente ou sem integridade referencial

- **Sem nenhum rastro de autor:** todo o módulo financeiro (`movimentacoes_financeiras`, `boletos`, `boleto_parcelas`, `contas_bancarias`, `planos_contas`, `categorias_financeiras`, `formas_pagamento`, `tipos_movimentacao`) e cadastros centrais (`inscricoes`, `alunos`, `funcionarios`, `professores`, `responsaveis`, `turmas`). `movimentacoes_financeiras` só tem `usuario_nome` (texto livre, sem FK).
- **Rastro existe mas é string solta, não FK:** 23 colunas do tipo `criado_por_id`/`registrado_por`/`autorizado_por`/`respondido_por` são `text`, sem constraint para `usuarios(id)` — aceitam qualquer valor, não sustentam auditoria de verdade. Só `captacao_opportunities.created_by`, `captacao_pipeline_events.changed_by` e `gente_trabalho_externo.autorizado_por_id` são `uuid` de fato.
- `chamados_academicos` guarda só `criado_por_nome`, nem o id.

**Ação:** padronizar `created_by`/`updated_by uuid REFERENCES usuarios(id)` como convenção única; migrar os campos texto existentes.

### 6. Índices ausentes nas foreign keys

Das 34 FKs declaradas, a maioria não tem índice de suporte (`diario_academico.turma_id/aluno_id/usuario_id`, `gente_*` inteiro, `projeto_presencas.*`, `alunos.inscricao_id`, `inscricoes.aluno_id` etc.). Com o volume atual (centenas/milhares de linhas) não dói, mas todo `ON DELETE CASCADE`/`SET NULL` desses FKs faz sequential scan na tabela filha ao deletar o pai — vai doer quando o volume crescer.

`movimentacoes_financeiras` — a tabela mais usada do sistema — **não tem nenhum índice além do PK**. Filtro por `data`, `status` ou `competencia` (uso típico de dashboard financeiro) é sempre full scan.

**Ação:** `CREATE INDEX` em toda coluna `*_id` que é FK; índice em `movimentacoes_financeiras(data)`, `(status)`, `(competencia)`.

### 7. Quase nenhuma validação de domínio no banco

Só **7 CHECK constraints** em todo o schema. Campos como `status` (em `movimentacoes_financeiras`, `boletos`, `chamados_academicos`) são `varchar` livre — qualquer string passa, a integridade do enum de negócio vive só na aplicação. Mesma coisa com `usuarios.role`: coluna é `varchar(50)`, o default é um cast pro tipo `usuarios_role_enum`, mas a coluna em si não é do tipo enum — nada impede gravar um role inválido direto no banco.

**Ação:** converter `status`/`role`/`tipo` recorrentes para `CHECK (col IN (...))` ou enum nativo do Postgres.

---

## P2 — Consistência (baixo risco, mas gera confusão)

### 8. Nomenclatura mista `camelCase` / `snake_case`

`alunos`, `alunos_complemento`, `materias`, `estoque_produtos`, `documentos_validacao` usam `createdAt`/`updatedAt`; o resto do schema usa `created_at`/`updated_at`. `usuarios` tem **as duas ao mesmo tempo** (`createdAt` e `created_at`) — coluna duplicada, não dá pra saber qual é a fonte de verdade sem ler o código do TypeORM.

### 9. `updated_at` faltando em 13 tabelas

`chamados_acompanhamentos`, `chamados_filas`, `diario_academico`, `estoque_categorias`, `estoque_movimentos`, `gente_colaborador_codigos`, `gente_colaborador_locais`, `gente_feriados`, `gente_pagamentos_passagem`, `inscricao_anotacoes`, `inscricao_movimentacoes`, `pesquisas_respostas`, `presenca_sessoes`, `projeto_presencas`, `turma_alunos`, `turmas`, `notificacoes` (só tem `criado_em`).

### 10. `created_at` faltando

`config_listas` só tem `updated_at`.

---

## Observações de infraestrutura (não são bloqueio hoje)

- Postgres 17.11, config default do container (`shared_buffers` 128MB, `work_mem` 4MB, `max_connections` 100, `effective_cache_size` 4GB) — não tunado, mas adequado ao volume atual. Revisar quando o volume crescer (ver dead tuples/autovacuum, hoje 0 em todas as tabelas — saudável).
- Backup/snapshot da VM está fora do escopo desta auditoria (tratado em outro documento de migração).

---

## Prioridade de execução sugerida

| Prioridade | Item | Esforço |
|---|---|---|
| P0 | FK financeiro (categoria/plano_contas/tipo_mov/forma_pagto) | Médio (migration + backfill) |
| P0 | Tirar `arquivo_base64` do banco (boletos) | Médio (migração de arquivo + código) |
| P0 | FK `aluno_id`/`turma_id` em `chamados_academicos`; `aluno_id` em `boletos` | Baixo |
| P0 | `deleted_at` em tabelas críticas (alunos, usuarios, movimentacoes, inscricoes, boletos) | Médio |
| P1 | `created_by`/`updated_by uuid FK` padronizado | Médio-Alto (toca muitas tabelas) |
| P1 | Índices em FKs + `movimentacoes_financeiras` | Baixo |
| P1 | CHECK/enum em `status`/`role` | Baixo-Médio |
| P2 | Padronizar `created_at`/`updated_at`, remover duplicata em `usuarios` | Baixo |

**Nada foi alterado no banco.** Toda mudança de schema em produção precisa de aprovação explícita e migration versionada no mecanismo real do erp_itp: `runMigrations()` em `apps/backend/src/app.module.ts`, gated por `_schema_version`/`SCHEMA_VERSION` (replay-safe — todo bloco reexecuta ao bumpar a versão, mesmo princípio do `CLAUDE.md` do aprxm_sys, mas é **outro arquivo, outro repo, outra stack** — não confundir com `backend/app/db/migrations.py`, que é do aprxm_sys).
