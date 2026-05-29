# Spec: Modo Simplifica

**Data:** 2026-05-29  
**Status:** Aprovado para implementação

---

## Objetivo

Interface mobile-first para operadores da associação. Grade de quadrados grandes, navegação por profundidade, preservando todas as operações do sistema normal. Rollout inicial restrito à associação teste.

---

## Arquitetura

### Feature flag por tenant

Campo novo na tabela `associations`:

```sql
ALTER TABLE associations ADD COLUMN simplifica_enabled BOOLEAN NOT NULL DEFAULT FALSE;
```

Ligar manualmente via SQL na associação teste. Sem deploy para habilitar outros tenants.

### Persistência por usuário

Campo novo na tabela `users`:

```sql
ALTER TABLE users ADD COLUMN simplifica_mode BOOLEAN NOT NULL DEFAULT FALSE;
```

### Fluxo de ativação

```
[Header: botão "Simplifica"]
  → Modal de confirmação ("Mudar para Modo Simplifica?")
  → PATCH /users/me/preferences { simplifica_mode: true }
  → Tela de loading "Carregando Simplifica..." (1.5s)
  → router.replace('/simplifica')
```

### Fluxo no login

```
POST /auth/login → { user: { simplifica_mode, association: { simplifica_enabled } } }
  → se simplifica_enabled=false: modo normal, sem mostrar toggle
  → se simplifica_enabled=true e simplifica_mode=true: router.replace('/simplifica')
  → se simplifica_enabled=true e simplifica_mode=false: modo normal + toggle visível
```

### Desativação

Em `/simplifica/configuracoes` → botão "Voltar ao modo completo" → mesmo fluxo inverso.

---

## Rotas

```
/simplifica                    → SimplificaHome
/simplifica/caixa              → SimplificaCaixa
/simplifica/encomendas         → SimplificaEncomendas
/simplifica/moradores          → SimplificaMoradores
/simplifica/ordens             → SimplificaOrdens
/simplifica/chat               → SimplificaChat (reutiliza ChatPage)
/simplifica/configuracoes      → SimplificaConfig
```

Protegidas por `PrivateRoute` igual às rotas normais. Guard adicional verifica `simplifica_enabled` na associação — redireciona para `/` se falso.

---

## Visual

### Identidade

- **Mesmas** cores do sistema: CSS var `--brand-header` (`#1a3f6f`) e derivados
- **Mesma** fonte: Inter / system-ui (Tailwind `font-sans`)
- Tema claro/escuro configurável pelo usuário em `/simplifica/configuracoes`

### Header

```
┌─────────────────────────────────────┐
│  [APRXM logo]     [IA]  [Simplifica]│
└─────────────────────────────────────┘
```

Altura ~56px. Faixa fina abaixo com status do caixa (ver seção Caixa).

### Grade de quadrados

```css
grid grid-cols-2 gap-4 p-4
/* cada tile: */
aspect-square rounded-2xl flex flex-col items-center justify-center gap-3
bg-[--brand-surface] border border-[--brand-header]/20
```

Ícone centralizado (emoji ou Lucide 40px) + label abaixo (14px, font-semibold).

### Navegação

- Home → sub-tela: push de rota `/simplifica/<setor>`
- Sub-tela → home: `←` no header (router.back)
- Operação → formulário: bottom sheet (modal deslizante de baixo)

---

## Setores e sub-operações

### Caixa (6 quadrados)

| Quadrado | Operação |
|---|---|
| 🏷️ | Mensalidades |
| 🏠 | Comp. Residência |
| ➕ | Outras Entradas |
| ➖ | Registrar Saída |
| 📊 | Consultar Movimentações |
| ⚠️ | Informar Incidente |

**Status do caixa (faixa no header da home):**
- Caixa fechado → botão `[ABRIR CAIXA]` + carrossel de caixas abertos por outros usuários (nome + horário)
- Caixa próprio aberto → label `Aberto em: HH:MM` com indicador verde pulsando
- Lógica existente de `CashSession` reutilizada via `useFinance` hook

### Encomendas (6 quadrados)

| Quadrado | Operação |
|---|---|
| 📥 | Receber |
| 📤 | Retirada |
| 🔄 | Devolução |
| ➕ | Cadastrar |
| 🔍 | Consultar |
| 📋 | Minhas Encomendas |

### Moradores (4 quadrados)

| Quadrado | Operação |
|---|---|
| ➕ | Cadastrar |
| 🔍 | Consultar |
| 🚨 | Inadimplentes |
| 🗺️ | Mapa Moradores |

### Ordens (4 quadrados)

| Quadrado | Operação |
|---|---|
| 📝 | Criar OS |
| 🔍 | Consultar Ordens |
| ✅ | Tarefas Diárias |
| 📋 | Minhas Ordens |

### Chat

Abre direto, sem sub-grade. Reutiliza `ChatPage` com layout Simplifica (header adaptado).

### Configurações

- Tamanho da fonte: P / M / G / GG (salvo em `localStorage`)
- Tipo de fonte: Sistema / Serif / Mono
- Tema: Claro / Escuro
- Botão "Voltar ao modo completo"

---

## Formulários (bottom sheet)

Cada operação abre um bottom sheet com o formulário simplificado:
- Campos grandes, `inputMode` correto para mobile (numérico, texto, etc.)
- Labels visíveis (não só placeholder)
- Botão de confirmação full-width na base
- Mesmo hook/service da página normal — só o layout muda

Formulários reutilizam a lógica existente de cada módulo via hooks compartilhados.

---

## Backend

### Endpoints novos

```
PATCH /users/me/preferences
  body: { simplifica_mode: bool }
  auth: Bearer — qualquer role
```

`GET /auth/me` (ou `/auth/login` response) já deve retornar:
```json
{
  "user": { "simplifica_mode": false },
  "association": { "simplifica_enabled": true }
}
```

Se `simplifica_enabled=false`, o toggle não aparece no frontend independente do role.

---

## Rollout

1. Migration: adicionar colunas `simplifica_enabled` (associations) e `simplifica_mode` (users)
2. Ligar `simplifica_enabled=true` na associação teste via SQL
3. Implementar rotas e componentes Simplifica
4. Implementar endpoint `PATCH /users/me/preferences`
5. Testar com operadores da associação teste
6. Habilitar outros tenants via `UPDATE associations SET simplifica_enabled=true WHERE ...`

---

## Fora do escopo (v1)

- Notificações push no Simplifica
- Modo offline / cache
- Animações de transição entre telas
- Customização de ordem dos setores
