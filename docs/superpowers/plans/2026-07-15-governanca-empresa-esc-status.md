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

### O que NÃO mudou (sem risco)
- Vaz Lobo e Congonha continuam operando normalmente, sem interrupção de uso
- `users.admin_master`/`superadmin` controlam acesso operacional dentro do app principal — sem relação com o painel-aprxm

---

## Pendente

### Fase 8 — Reconectar o ESC operacional
- Painel `/geral` (visão consolidada) hoje depende de múltiplas linhas em `user_association_roles` — precisa migrar para usar `empresa_id`
- Módulo ADMIN dentro do ESC no app principal, para `admin_master` gerenciar operacional (financeiro centralizado, usuários etc.)
- Reancorar o inventário financeiro do Escritório (spec `2026-05-03`) de `is_office` para `empresa_id`
- Remodelar como as permissões são concedidas hoje (mencionado pelo usuário, ainda não detalhado)

### Outros itens levantados na conversa
- Adicionar `email-validator` ao `requirements.txt`, se quiser validação de formato de e-mail de volta
- App offline (APK/EXE) + painel de sincronização local — definido desde o início como projeto futuro separado
- Remodelagem completa do módulo financeiro do frontend — mencionada pelo usuário para depois desta base de governança
