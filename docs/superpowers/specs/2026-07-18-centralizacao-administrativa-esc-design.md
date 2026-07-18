# Design — Centralização Administrativa no ESC

**Data:** 2026-07-18
**Depende de:** `2026-07-15-governanca-empresa-esc-design.md` (empresas, `empresa_id`), `2026-07-17-esc-associacao-login-design.md` (ESC como associação)
**Status:** aprovado, aguardando plano de implementação

---

## 1. Objetivo

Levantamento de analista de negócio feito em cima do que já existe: 4 coisas que hoje vivem **por associação** deveriam viver **por empresa** (ESC), e 2 coisas que faltam no ESC pra fechar o papel de "sala de controle" corporativa. Achado central: **não dá pra centralizar financeiro (já decidido, spec futura) sem antes centralizar o que alimenta ele** — categoria de transação e forma de pagamento. Por isso esses dois entram primeiro.

## 2. Categorias de transação e formas de pagamento (empresa, não associação)

**Problema:** `transaction_categories` e `payment_methods` são hoje só `association_id`, sem `empresa_id`. Vaz Lobo pode ter categoria "Manutenção", Congonha "Manutenções" — mesmo gasto, nome diferente, relatório consolidado sai furado.

**Modelo** (mesmo padrão já usado em `products`: dono é a empresa, associação pode ser restrita a um subconjunto, aditivo):

```sql
ALTER TABLE transaction_categories ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
ALTER TABLE payment_methods       ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
```

- Cadastro/edição passa a acontecer no ESC (`Cadastros`), não mais dentro da associação.
- Linhas existentes (hoje só `association_id`) continuam funcionando como estão — **não migra dado antigo automaticamente nesta fase**, só a partir de agora toda categoria/forma nova nasce com `empresa_id` e é compartilhada por todas as associações da empresa.
- Associação deixa de ter endpoint de criar categoria/forma própria; passa a **herdar** as da empresa.

## 3. Gestão de usuário (criar/editar/desativar no ESC)

**Problema:** `POST /admin/users` hoje exige admin **da associação**, usuário já nasce preso a 1 unidade — contradiz "todo usuário ligado à empresa, gerido no ESC, atribuído a associação" (diretriz já dada).

**O que muda:**
- Novos endpoints em `/esc/cadastros/usuarios`: `POST` (criar), `PUT/{id}` (editar), `DELETE/{id}` (desativar) — guardados por `require_empresa_admin`, formulário já inclui campo "unidade" (association_id de destino, dentro da empresa).
- Endpoint antigo (`admin.py POST/PUT/DELETE /users`, escopado à associação) **continua existindo no código** (aditivo, não remove) — mas a UI para de expor criação de usuário dentro da tela de admin da associação, direciona pro ESC.
- `GET /esc/cadastros/usuarios` já existe (implementado hoje, leitura).

## 4. Permissões / grupos de acesso (template único da empresa)

**Problema:** `association_settings.access_groups` (por associação) e `role_permissions` (`association_id` + `role` + `module`) — cada unidade pode ter regra de permissão diferente pro mesmo cargo. Numa empresa só, isso não deveria ser possível. Isso é a Fase 8d que já estava pendente de design — este spec fecha o design dela.

**Modelo:**
```sql
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS access_groups JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
```
- `role_permissions` com `empresa_id` preenchido e `association_id = NULL` = regra vale pra **toda** associação da empresa (mesmo princípio de `products.todas_associacoes`, sem precisar de coluna extra — presença de `empresa_id` + ausência de `association_id` já diz).
- Linha antiga (`association_id` preenchido, `empresa_id` NULL) continua valendo como está — regra por empresa tem prioridade de leitura sobre regra por associação legada, quando existir conflito.
- `access_groups` some de `association_settings` como fonte de verdade — vira config da empresa. Endpoint `/settings/access-groups` (hoje `require_superadmin`) migra pra `/esc/administracao/permissoes` com escrita (hoje só tenho leitura implementada).

## 5. Auditoria centralizada

**Problema:** `audit_log` já tem tudo que precisa (`association_id`, `user_id`, `action`, `entity`, `detail`, `created_at`) mas não tem `empresa_id` — sem jeito de ver "quem fez o quê, em qual unidade" de um lugar só.

```sql
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
```
- Backfill via join com `associations.empresa_id` (mesmo padrão do `users.empresa_id` da Fase 8a).
- Novo endpoint `GET /esc/administracao/auditoria` (paginado, filtro por unidade/usuário/ação).
- Nova aba "Auditoria" em Administração no frontend (4ª aba, ao lado de Plano de Metas/Permissões/Estoque).

## 6. Central de avisos (broadcast)

**Problema:** `notifications` é só por associação — ESC não tem como avisar todas as unidades de uma vez (ex.: "reunião geral dia X").

```sql
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
```
- Novo endpoint `POST /esc/administracao/avisos` — recebe título/corpo, faz fan-out: 1 linha de `notifications` por usuário ativo de toda associação da empresa, com `empresa_id` marcado (rastreio de que foi um broadcast, não notificação pontual).
- Nova aba "Avisos" em Administração (envio + histórico de broadcasts enviados).

## 7. Fora de escopo

- Migração de dado legado de `transaction_categories`/`payment_methods`/`role_permissions` existentes para o novo modelo de empresa (fica pra quando o financeiro centralizado de verdade for implementado).
- Remoção de qualquer endpoint antigo — tudo aditivo, padrão já seguido em todas as fases anteriores.
- UI de criação/edição em si (telas de formulário) — este spec cobre schema + endpoints; formulários ficam pro plano de implementação.

## 8. Critério de pronto

- 5 colunas novas (`transaction_categories.empresa_id`, `payment_methods.empresa_id`, `empresas.access_groups`, `role_permissions.empresa_id`, `audit_log.empresa_id`, `notifications.empresa_id`) — aditivas, nullable, zero-downtime.
- Endpoints de escrita (`usuarios`, `permissões`, `auditoria` leitura, `avisos` broadcast) funcionando contra o banco de teste local.
- Nenhum fluxo atual de Vaz Lobo/Congonha (categoria/forma de pagamento/permissão/notificação existentes) muda de comportamento até a implementação ligar os pontos novos.
