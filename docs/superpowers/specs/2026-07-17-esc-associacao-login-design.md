# Design — ESC como Associação (Login/Tenant Centralizado)

**Data:** 2026-07-17
**Depende de:** `docs/superpowers/specs/2026-07-15-governanca-empresa-esc-design.md` (empresas, Fase 8a — `users.empresa_id`)
**Status:** aprovado, aguardando plano de implementação

---

## 1. Objetivo

Modelo hoje: `empresa → associations` (unidades de negócio), mas o "Escritório" (ESC) não é uma unidade de verdade — é um estado implícito (`association_id = NULL` em `admin_master`), com escopo calculado só em memória no login (`auth_service.py`, bloco `is_empresa_wide`).

Isso causa 3 problemas concretos, achados nesta sessão:
1. **Login sempre abre na 1ª associação em ordem alfabética** da empresa (ex.: Congonha antes de Vaz Lobo) — não respeita onde o usuário estava da última vez.
2. **`switch_association` (o seletor) não replica** a lógica de escopo por empresa do login — só aceita troca se existir linha explícita em `user_association_roles`. Hoje isso significa: um `admin_master` pode ver Congonha no login mas tomar 403 ao tentar trocar pra ela pelo seletor.
3. **Escopo amplo é decidido por `role` hardcoded** (`admin_master`/`superadmin`), não por onde a pessoa está estacionada. Isso impede colocar `conselho`/`diretoria` no Escritório com visão ampla sem também mudar o cargo deles pra admin_master/superadmin (errado — cargo e escopo são coisas diferentes).

## 2. Modelo

**ESC vira uma linha real em `associations`, uma por empresa, com `id = empresa_id`.**

Não precisa coluna nova pra marcar "essa linha é o Escritório" — a própria igualdade `association.id == association.empresa_id` identifica. Mesmo princípio já usado em `products.tipo_sistema` (evitar flag redundante quando a estrutura já carrega o significado).

```sql
-- seed por empresa (SAPE agora; toda empresa nova, automático via empresa_service.py)
INSERT INTO associations (id, empresa_id, name, slug, is_active)
VALUES ('{empresa.id}', '{empresa.id}', 'Escritório', '{empresa.slug}-escritorio', true);
```
`slug` é único globalmente (constraint `associations_slug_key`) — por isso o sufixo.

**Escopo amplo passa a ser por estação, não por cargo:**
```python
# antes: user.role.value in ("admin_master", "superadmin") and user.empresa_id is not None
# depois:
is_empresa_wide = user.association_id == user.empresa_id  # está estacionado no ESC
```
Qualquer cargo (conselho, diretoria, admin_master, superadmin) estacionado no ESC ganha visão de todas as associações da empresa. Operador de Vaz Lobo/Congonha continua travado na própria unidade, independente do cargo.

**`users.last_association_id`** (novo campo, nullable) — grava a cada login bem-sucedido e a cada troca via seletor. No próximo login, usuário empresa-wide abre na última unidade usada (`last_association_id`, se ainda válida/ativa/da mesma empresa) em vez de "primeira em ordem alfabética". Sem último login registrado, cai no ESC como padrão.

**Fix em `switch_association`** (`routers/auth.py`): hoje só aceita destino com linha explícita em `user_association_roles`. Passa a aceitar também destino dentro do escopo de empresa quando `current.empresa_id` bate com a empresa do destino — mesma lógica que o login já usa, hoje ausente aqui. Ao trocar com sucesso, grava `users.last_association_id = destino`.

## 3. Mapeamento de usuários reais (dado, não schema)

Levantamento feito no banco de produção (25 usuários). Ação por pessoa:

| Usuário | Hoje | Vira |
|---|---|---|
| Erick Gonçalves Cardoso | superadmin, Vaz Lobo | **ESC**, superadmin (cargo mantido) |
| Felipe Barbosa Siqueira | admin_master, `NULL` | **ESC**, admin_master (cargo mantido — não vira superadmin) |
| Gabriela Graciano Bezerra | admin, Vaz Lobo | **ESC**, conselho |
| Gabriella Barbosa | admin, Vaz Lobo | **ESC**, conselho |
| Célia da Silva Barbosa (`celiapx@institutotiapretinha.org`) | admin, Vaz Lobo | **ESC**, conselho |
| Raphael | admin, Vaz Lobo (nunca logou) | **ESC**, conselho |
| Vinícius Augusto Façan da Costa | diretoria_adjunta, Vaz Lobo | **ESC**, diretoria |
| Carla Barbosa Sales | diretoria, Vaz Lobo | **ESC**, diretoria (cargo mantido) |
| Danielly Marinho Quinta | operator, **Vaz Lobo** | operator, **Congonha** (mudança real de unidade) |
| Fernanda Siqueira (`fernanda@congonha.org`) | operator, Congonha, ativa | sem mudança |
| Hanyelle, Hosana (`hosana@vl.org`), Monique, Paulo Victor | operator, Vaz Lobo | sem mudança |

**Contas duplicadas já resolvidas pelo estado atual, sem ação necessária:**
- Fernanda: `fernanda@vazlobo.org` (conta antiga, login não funcionava) já está **inativa**; `fernanda@congonha.org` (conta nova, funcional) já está ativa e na associação certa.
- Hosana: `hosana@congonha.org` (conta antiga com problema) já está **inativa**; `hosana@vl.org` (funcional) já ativa em Vaz Lobo.
- Célia: `ceclauprt12@gmail.com` (conta antiga) já está **inativa**; `celiapx@institutotiapretinha.org` é a mantida.

**Desativar** (`is_active=false`, sem apagar dado/transações — mesmo padrão soft-delete da Fase 7): `Admin Teste`, `Célia Teste`, `Operador João`, `Viewer Sandra`, `Conferente Maria` (todos da associação "Teste QA"), `Conferente Congonha Testes` (nunca logou). Já inativos, sem ação: `Teste Dev`, `Gabriel Barbosa Sales`.

Associação **"Teste QA"** (6 usuários, criada em QA) fica intocada como associação (é a órfã que a Fase 7 vinculou à SAPE em vez de deletar — tem dado real de mensalidade). Só os usuários de teste dentro dela são desativados.

## 4. Fora de escopo

- Redesenho completo de permissões por cargo (Fase 8d, já adiada pelo usuário).
- UI do módulo Administração/Cadastros dentro do ESC (fica pra spec própria, quando "montar a casca" avançar).
- Qualquer alteração em `products`/financeiro centralizado (spec separada, `2026-07-16-catalogo-produtos-esc-design.md`).

## 5. Critério de pronto

- Toda empresa (SAPE + futuras) tem exatamente 1 linha ESC em `associations` com `id = empresa_id`.
- Login de usuário estacionado no ESC abre na última associação usada (`last_association_id`), não mais em ordem alfabética.
- Seletor de troca aceita destino por escopo de empresa, não só por `user_association_roles` explícito.
- Usuários remapeados conforme tabela da Seção 3; usuários de teste desativados; nenhuma transação/mensalidade histórica alterada ou removida.
- Login/refresh de Vaz Lobo/Congonha (usuários operacionais comuns) sem regressão.
