# Portal do Morador

Data: 29/07/2026

## O que é

Antes desta mudança, o único jeito de um morador aparecer no sistema era via
cadastro público (`/cadastro/:slug`) — um formulário sem login que cria um
`Resident` pendente (`status=inactive`, `wants_to_join=True`), aprovado depois
por um operador. Não existia nenhuma forma de morador **autenticar** e ver
uma página própria.

O Portal do Morador adiciona isso: cada morador pode criar uma senha e logar
com **nome completo + telefone + senha**, e ver suas próprias encomendas,
mensalidades/inadimplência e dados cadastrais.

Isso é **separado** do login de staff (`/auth/*`, tabela `users`) — nenhum dos
dois sistemas de autenticação enxerga o outro.

---

## Arquitetura

### Por que um sistema de auth separado, não reaproveitado

- `residents` não é `users` — morador não tem `role`, não passa pelo grid de
  permissões (`access_groups`), não deve conseguir acessar nenhuma rota de
  staff.
- O JWT do morador carrega um claim `"kind": "resident"` que o dependency do
  staff (`get_current_user`) nunca confere e o dependency do morador
  (`get_current_resident`) exige — um token de um tipo nunca é aceito como o
  outro, mesmo compartilhando o mesmo `SECRET_KEY`/algoritmo.
- Revogação: cada resident tem `token_version` (mesmo padrão de
  `users.token_version`). Trocar a senha incrementa a versão e invalida
  qualquer token antigo emitido.

### Identidade / verificação

Não há infraestrutura de SMS/e-mail para verificação de identidade. Por isso:

- **Criar acesso** (`set-senha`) exige 3 fatores: nome completo + telefone +
  **CPF** — o conjunto mais forte de dados já cadastrados que dá pra exigir
  sem infra nova. CPF é obrigatório nesse endpoint (mesmo sendo opcional no
  cadastro do morador); quem não tem CPF cadastrado precisa que a
  administração complete o cadastro antes de conseguir ativar o portal.
- **Login** exige só nome + telefone + senha (já provou identidade uma vez ao
  criar a senha).
- `set-senha` funciona também como "esqueci minha senha" — não há flag de
  "primeiro acesso apenas"; qualquer chamada com os 3 fatores corretos
  sobrescreve a senha atual e invalida sessões antigas (via
  `token_version + 1`).
- Nome é comparado com `TRIM(LOWER(...))`, telefone comparado só por dígitos
  (via `regexp_replace(...,'\D','','g')`) — tolera formatação diferente
  ((21) 99999-9999 vs 21999999999).

### Escopo dos dados

Todo dado devolvido pelo portal é filtrado por `resident_id` **e**
`association_id` extraídos do próprio JWT — nunca de parâmetro de request.
Um morador só vê o que é dele, na associação em que se cadastrou.

---

## Banco de dados

Migration `v22` (`backend/app/main.py`, função `_run_migrations`) + arquivo de
referência `database/migrations/028_resident_portal_auth.sql` + `database/schema.sql`
atualizado:

```sql
ALTER TABLE residents ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
```

Aditivo — não quebra nenhum morador existente. Todos começam com
`password_hash = NULL` (sem acesso) até ativarem via `set-senha`.

> **Nota:** essa migration ficou registrada como `v22`, não `v21`, porque o
> banco de produção (Neon) já tinha uma `v21` real (`UNIQUE(association_id, cpf)`
> em `residents`) que **não existe neste checkout do git** — alguém aplicou
> isso direto em produção sem commitar a mudança correspondente em
> `main.py`. Ficou fora do escopo desta tarefa investigar/corrigir esse
> descompasso, mas vale investigar depois.

---

## Arquivos criados/alterados

| Arquivo | O que |
|---|---|
| `backend/app/core/resident_auth.py` | **novo** — `CurrentResident`, `create_resident_token`, `get_current_resident` (dependency) |
| `backend/app/routers/resident_portal.py` | **novo** — todas as rotas do portal (`/portal/*`) |
| `backend/app/models/resident.py` | + `password_hash`, `token_version` |
| `backend/app/main.py` | migration v22, import + `include_router(resident_portal.router)` |
| `database/migrations/028_resident_portal_auth.sql` | **novo** — DDL de referência |
| `database/schema.sql` | + colunas na tabela `residents` |
| `frontend/src/pages/morador/MoradorLoginPage.tsx` | **novo** — tela de login / criar acesso |
| `frontend/src/pages/morador/MoradorPainelPage.tsx` | **novo** — dashboard (encomendas/mensalidades/perfil) |
| `frontend/src/pages/morador/residentApi.ts` | **novo** — instância axios isolada + storage do token do morador |
| `frontend/src/App.tsx` | + rotas `/morador/:slug` e `/morador/painel` |

---

## Rotas

### Backend (`prefix /api/v1/portal`, router `resident_portal.py`)

| Método | Rota | Auth | Rate limit | Descrição |
|---|---|---|---|---|
| `POST` | `/portal/{slug}/set-senha` | pública | 5/min | Cria ou redefine a senha. Body: `{full_name, phone_primary, cpf, password}`. Valida os 3 campos contra o cadastro na associação `slug`. Retorna `{access_token}` (já loga). |
| `POST` | `/portal/{slug}/login` | pública | 10/min | Body: `{full_name, phone_primary, password}`. Retorna `{access_token}`. |
| `GET` | `/portal/me` | token de morador | — | Perfil: nome, tipo, status, contato, endereço, nome da associação. |
| `GET` | `/portal/encomendas` | token de morador | — | Até 100 encomendas do morador, mais recentes primeiro. |
| `GET` | `/portal/mensalidades` | token de morador | — | Até 36 mensalidades + `total_em_aberto`/`quantidade_em_aberto` (status `pending`/`overdue`). |

`slug` = slug da associação (o mesmo usado em `/cadastro/:slug`).

### Frontend

| Rota | Página | Descrição |
|---|---|---|
| `/morador/:slug` | `MoradorLoginPage.tsx` | Login ou "Primeiro acesso" (toggle). Ex: `/morador/vaz-lobo` |
| `/morador/painel` | `MoradorPainelPage.tsx` | Dashboard com abas Encomendas / Mensalidades / Perfil. Redireciona pro login se não houver token válido. |

O token do morador fica em `localStorage` sob a chave `aprxm-resident-token`
(separada da chave usada pelo login de staff) — dá pra estar logado como
staff e como morador no mesmo navegador sem um sobrescrever o outro.

---

## Limitações conhecidas (v1)

- Sem verificação real de identidade (SMS/e-mail) — a segurança do
  `set-senha` depende inteiramente de nome+telefone+CPF já estarem corretos
  no cadastro.
- Morador sem CPF cadastrado não consegue ativar o portal.
- Sem fluxo de troca de senha estando logado (só via `set-senha`, que exige
  os 3 fatores de novo).
- Perfil é somente leitura — pedido de alteração cadastral não foi ligado ao
  fluxo de `update-request` já existente em `/atualizar/:slug`.
