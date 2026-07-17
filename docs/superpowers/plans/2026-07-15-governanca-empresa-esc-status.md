# Status — Governança de Empresa / ESC (APRXM)

**Atualizado em:** 2026-07-16
**Spec:** `docs/superpowers/specs/2026-07-15-governanca-empresa-esc-design.md`
**Plano completo:** `docs/superpowers/plans/2026-07-15-governanca-empresa-esc-plan.md`

---

## Implementado (no ar em produção)

### Fase 1 — Migrations aditivas (v5)
- Tabela `empresas` (id, name, slug, financeiro_centralizado, plan_name, is_active)
- `associations.empresa_id` (nullable)
- `users.association_id` passa a aceitar NULL (era obrigatório)
- `role_permissions` e `audit_log` ganham `empresa_id` (nullable), `association_id` vira nullable
- Tabela `provisioning_runs` (log de execução do provisionamento)

### Fase 2 — Migration de dados (v6)
- Empresa real criada: `SAPE - Vaz Lobo / Buriti / Congonha`
- `empresa_id` preenchido em Vaz Lobo e Congonha
- Descoberta em produção: o ambiente Escritório já tinha sido desativado antes deste projeto (`_DELETADO_Escritorio`) — a promoção automática a `admin_master` não encontrou usuários, sem efeito colateral
- Felipe Siqueira promovido manualmente a `admin_master` (mantendo acesso a Vaz Lobo e Congonha)
- 3 bugs de produção corrigidos, encontrados testando localmente antes do deploy: geração de token e consulta de membership quebravam com `association_id=NULL`

### Fase 3 — Models e services de provisionamento
- Models `Empresa` e `ProvisioningRun`
- `EmpresaService`: cria empresa + admin_master + senha gerada enviada por e-mail
- `AssociationProvisioningService`: cria associação + settings + categorias/formas de pagamento/caixa padrão + admin
- Log passo-a-passo em `provisioning_runs`, com rollback correto em caso de falha

### Fase 4 — Endpoints (router `/governanca`)
- `POST`/`GET /governanca/empresas`, `POST /governanca/empresas/{id}/associacoes`
- `GET /governanca/empresas/{id}/associacoes` (listagem, adicionada durante a Fase 5)
- `PATCH /governanca/associacoes/{id}/desativar` — soft delete em cascata
- `GET /governanca/provisioning-runs` (+ detalhe por id)

### Fase 5 — Painel separado (painel-aprxm) + auth isolada (v7)
- Tabela `painel_admins` — sistema de usuários totalmente separado do `users` do app operacional
- JWT próprio (`PAINEL_SECRET_KEY`, audience `painel-aprxm`) — nunca aceita token do app principal
- `/governanca` re-protegido com essa auth isolada (antes usava o JWT do app operacional)
- Projeto frontend novo: Vite + React + TypeScript + Tailwind v4, em `painel/`
- Telas: login, listar empresas, criar empresa, detalhe da empresa, criar associação, desativar, execuções de provisionamento
- Deploy próprio na Vercel: `https://painel-aprxm.vercel.app`
- Validado ponta a ponta com testes automatizados de navegador contra backend real, credenciais descartáveis

### Incidente durante a Fase 5 (resolvido)
O deploy inicial da Fase 5 derrubou o backend inteiro por ~15-20 minutos: o campo de e-mail usava `EmailStr` (Pydantic), que depende do pacote `email-validator` — ausente do `requirements.txt` de produção. Isso quebrava a importação do app inteiro (500 em todos os endpoints). Corrigido trocando por texto simples; o app voltou ao normal. Se quiser validação de formato de e-mail de volta, é só adicionar `email-validator` ao `requirements.txt` num commit calmo.

### Fase 6 — Validação em produção (checklist técnico OK)
Checklist técnico rodou limpo em 2026-07-16: zero erros 5xx no dia (~4.900 req), JWT com `empresa_id` correto para admin_master e operador, `audit_log`/`role_permissions` sem corrupção. Login/refresh/switch inalterados.

### Fase 7 — Remoção do modelo antigo (no ar, 2026-07-16)
- **7a** (código): `is_office` removido dos 6 arquivos + hook `_empresa_col_exists` removido. Deploy limpo.
- **7c** (schema, migration v8): `is_office` e `linked_association_slugs` removidas, `associations.empresa_id` agora `NOT NULL`.
- **Decisão de execução**: as associações legadas sem `empresa_id` (escritorio inativo, teste QA) foram **vinculadas à empresa SAPE, não deletadas** — descobriu-se que a `teste` tinha ~209 mensalidades reais e outros registros com `created_by` apontando pra seus usuários (FKs NO ACTION), então deletar corromperia dado real.
- **O guard de segurança funcionou**: a v8 abortou 2x (associação órfã) sem derrubar a produção, até a estratégia ser corrigida. Rodou em sessão própria com rollback.
- Verificado pós-deploy: 4 associações preservadas e vinculadas à SAPE, 1161 mensalidades e 25 usuários intactos, app saudável.

### Fase 8a — users.empresa_id (NO AR em produção, 2026-07-16)
Diretriz do usuário: **todo usuário ligado a uma empresa, gerido no ESC, atribuído a uma associação**. A 8a implementa a fundação disso.

Gap que motivou: `EmpresaService` criava o `admin_master` com `association_id=NULL` e **sem vínculo com a empresa no banco** (a tabela `users` não tinha `empresa_id`). No login ele saía com `empresa_id=None` e escopo vazio — o provisionamento pelo painel produzia um `admin_master` inútil. O `/geral` também só via associações via membership manual.

Implementado (2 commits locais — `f45e8c6`... na verdade após a Fase 7; ver `git log`):
- **Migration v9** (aditiva): `users.empresa_id` + backfill de todos os usuários (via `association_id` direto e via memberships para os empresa-wide)
- **User model**: campo `empresa_id`
- **EmpresaService / AssociationProvisioningService**: passam a setar `empresa_id` nos usuários criados
- **auth_service**: `admin_master`/`superadmin` com `empresa_id` enxergam **todas** as associações da empresa (escopo derivado de `empresa_id`, não de membership) — associações novas aparecem automaticamente
- **geral.py**: `/geral` aceita admin de empresa (não só aggregator 2+), e escopo usa `scoped_ids()` (primária + vinculadas)

Validado e2e local: painel cria empresa → `admin_master` nasce com `empresa_id` → login OK → cria associação → aparece no `/geral` do admin_master. Login de usuário comum inalterado.

**No ar em produção (2026-07-16).** Migration v9 aplicada; verificado no DB: `schema_migrations`=9, `users.empresa_id` criada, **25/25 usuários com empresa_id (0 NULL)**, health 200, login (rejeição de credencial) limpo. O deploy exigiu correção de um outage — ver incidente abaixo.

### Incidente durante a Fase 8a (resolvido) — replay de migration bateu em coluna dropada
O 1º push da 8a **derrubou toda a produção** (`FUNCTION_INVOCATION_FAILED` em todos os endpoints, `/health` incluso). Causa raiz: as migrations não têm guard por versão — quando `applied < _SCHEMA_VERSION`, a rotina **reexecuta todos os blocos v5→v9** confiando só na idempotência do SQL. O bloco **v6** (Fase 2) fazia `SELECT ... FROM associations WHERE slug='escritorio' AND is_office = TRUE`, mas `is_office` foi **dropada na v8 (Fase 7c)**. Enquanto `applied(8) >= _SCHEMA_VERSION(8)` o early-return protegia o bloco; bumpar pra v9 fez `applied(8) < 9`, o v6 rodou de novo, `UndefinedColumnError` abortou o lifespan (v5/v6/v7 não têm try/except, só v8/v9 têm) → app inteiro morreu.

Resposta: produção restaurada em ~1s via `vercel promote` do deploy v8 anterior (rollback de alias, sem rebuild). Fix: guardar a migração dos usuários do Escritório com `IF EXISTS (information_schema … is_office)` nos dois ramos — no-op em DBs já migradas, comportamento idêntico onde a coluna ainda existe. Validado com dry-run `BEGIN/ROLLBACK` contra o schema real de produção antes do 2º push. O 2º deploy subiu limpo, sem outage. Commit do fix: `1b5f8d6`.

**⚠️ Dívida técnica exposta (follow-up):** os blocos v5/v6/v7 não são envelopados em try/except (só v8/v9 são), então uma falha neles derruba o cold start — viola o princípio "migração nunca derruba o app" que o próprio código declara. Além disso, qualquer bloco antigo que referencie um objeto dropado por um bloco posterior vai quebrar no próximo bump de versão. Recomendado: envelopar v5/v6/v7 em try/except (padrão v8/v9) e/ou guardar cada bloco por versão (`IF applied < N`).

### O que NÃO mudou (sem risco)
- Vaz Lobo e Congonha continuam operando normalmente, sem interrupção de uso
- `users.admin_master`/`superadmin` controlam acesso operacional dentro do app principal — sem relação com o painel-aprxm

---

## Pendente

### Fase 8c — Módulo ADMIN dentro do ESC (PRECISA DE DESIGN)
UI de gestão centralizada pro `admin_master` no app principal. O usuário disse que é o que o admin_master vai usar, mas **o conteúdo não foi definido** (gestão de usuários? config? financeiro consolidado?). Fazer brainstorm/design antes de codar.

### Fase 8d — Remodelar permissões (PRECISA DE DESIGN)
A diretriz "todo usuário ligado à empresa, gerido no ESC, atribuído a uma associação" reformula o modelo de permissões. Detalhes não desenhados — precisa de brainstorm antes de implementar.

### Fase 8b — Reancorar inventário (menor, backend)
Endpoints de inventário em `geral.py` ainda ancoram em `current.association_id` e exigem `is_conferente` (que não inclui `admin_master`). Reancorar para nível empresa. Não urgente (inventário pode nem estar em uso).

### Outros itens levantados na conversa
- Adicionar `email-validator` ao `requirements.txt`, se quiser validação de formato de e-mail de volta
- App offline (APK/EXE) + painel de sincronização local — definido desde o início como projeto futuro separado
- Remodelagem completa do módulo financeiro do frontend — mencionada pelo usuário para depois desta base de governança

---

## Backups disponíveis (rede de segurança)
- Dumps locais completos: `backup-aprxm-20260716-2138.dump` e `backup-aprxm-PRE-7c-20260716-2144.dump` (protegidos por `.gitignore`, formato custom — restaurar via `pg_restore`)
- Snapshot manual no Neon (criado antes da Fase 7)
- Neon PITR: janela de 6h de restore point-in-time

## Estado do schema (produção)
`schema_migrations` em **v9** (produção, desde 2026-07-16). Sequência: v5 (empresas/provisioning_runs), v6 (dados/backfill), v7 (painel_admins), v8 (remove is_office/linked, empresa_id NOT NULL), v9 (users.empresa_id + backfill dos 25 usuários).
