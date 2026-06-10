# Spec: Redesign de Status das Ordens de Serviço

**Data:** 2026-06-09
**Escopo:** Simplificação do ciclo de vida de OS — fusão de estados redundantes, introdução de Fases configuráveis, e-mail em todas as transições.

---

## 1. Motivação

O sistema atual tem 8 status no ciclo de vida de OS:
`draft → pending → open → in_progress → waiting_third_party → resolved → archived → cancelled`

Problemas identificados:
- `pending` e `open` são semanticamente idênticos — criam confusão operacional
- `waiting_third_party` mistura nível macro (ciclo de vida) com sub-estado (o que está bloqueando)
- Não há como configurar novas sub-fases sem deploy
- E-mails só disparam em 3 transições; equipe perde visibilidade das demais

---

## 2. Modelo de dados

### 2.1 Nova tabela: `service_order_phases`

```sql
CREATE TABLE service_order_phases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id UUID NOT NULL REFERENCES associations(id),
  name          VARCHAR(100) NOT NULL,
  color         VARCHAR(7) NOT NULL DEFAULT '#9333ea',  -- hex
  sort_order    INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Fases pré-populadas (seed) por associação na migration:
- Ag. Terceiros (`#9333ea`)
- Ag. Validação (`#d97706`)
- Ag. Material (`#2563eb`)
- Ag. Recurso Financeiro (`#16a34a`)

### 2.2 Alterações em `service_orders`

- Adicionar coluna: `phase_id UUID NULLABLE REFERENCES service_order_phases(id)`
- Remover valores do enum `service_order_status`: `open`, `waiting_third_party`

**Enum final:**
```sql
CREATE TYPE service_order_status AS ENUM (
  'draft',
  'pending',
  'in_progress',
  'resolved',
  'archived',
  'cancelled'
);
```

### 2.3 Migração de dados existentes

```sql
-- open → pending
UPDATE service_orders SET status = 'pending' WHERE status = 'open';

-- waiting_third_party → in_progress + phase "Ag. Terceiros"
UPDATE service_orders
SET status = 'in_progress',
    phase_id = (
      SELECT sop.id FROM service_order_phases sop
      JOIN associations a ON a.id = sop.association_id
      WHERE sop.name = 'Ag. Terceiros'
        AND sop.association_id = service_orders.association_id
      LIMIT 1
    )
WHERE status = 'waiting_third_party';
```

### 2.4 Invariante de integridade

- `phase_id` só pode ser não-nulo quando `status = 'in_progress'`
- Ao transicionar para fora de `in_progress`, backend zera `phase_id` automaticamente

---

## 3. Fluxo de estados

```
draft ──→ pending ──→ in_progress ──→ resolved
                           │
                    [fase opcional]
                    Ag. Terceiros
                    Ag. Validação
                    Ag. Material
                    Ag. Recurso Financeiro

De qualquer estado (exceto resolved):
  → cancelled  (motivo obrigatório)
  → archived   (sem campo obrigatório)

De resolved:
  → archived   (para limpar a visão sem perder o registro)

Estados finais sem saída: cancelled, archived
```

**Regras de transição:**

| Transição | Regra |
|---|---|
| qualquer → `in_progress` | auto-atribui responsável se `assigned_to` for nulo |
| `in_progress` + fase | `phase_id` só válido neste estado |
| saindo de `in_progress` | `phase_id` zerado automaticamente |
| qualquer → `resolved` | `resolution_notes` obrigatório |
| qualquer → `cancelled` | `cancellation_reason` obrigatório |
| `resolved` → qualquer | bloqueado |

---

## 4. Backend

### 4.1 Endpoints de fases

| Método | Rota | Acesso |
|---|---|---|
| GET | `/service-order-phases` | operator+ |
| POST | `/service-order-phases` | admin+ |
| PATCH | `/service-order-phases/:id` | admin+ |
| DELETE | `/service-order-phases/:id` | admin+ |

**DELETE:** soft delete se houver OS vinculada (`active = false`); hard delete caso contrário.

### 4.2 Endpoint de update de status — mudanças

`PATCH /service-orders/:id/status`

Corpo:
```json
{
  "status": "in_progress",
  "phase_id": "uuid-opcional",
  "resolution_notes": "texto se resolved",
  "cancellation_reason": "texto se cancelled"
}
```

Validações adicionais:
- `phase_id` presente + `status != in_progress` → erro 422
- `phase_id` pertence à mesma `association_id` → validado no backend
- Ao resolver/cancelar/arquivar: `phase_id` zerado independente do payload

### 4.3 Modelo Python

```python
class ServiceOrderStatus(str, Enum):
    draft = "draft"
    pending = "pending"
    in_progress = "in_progress"
    resolved = "resolved"
    archived = "archived"
    cancelled = "cancelled"
```

```python
class ServiceOrder(SQLModel, table=True):
    # ... campos existentes ...
    phase_id: UUID | None = Field(default=None, foreign_key="service_order_phases.id")
```

### 4.3b Histórico de mudanças

Toda mudança de status **ou** de fase grava um registro em `service_order_history`:
```json
{ "field": "status", "from": "pending", "to": "in_progress" }
{ "field": "phase",  "from": null,      "to": "uuid-da-fase", "phase_name": "Ag. Terceiros" }
```
Fase removida grava `"to": null`. Mesmo mecanismo já existente para status.

### 4.4 E-mails — todas as transições

Toda mudança de estado **ou** de fase dispara e-mail para `celiapx@institutotiapretinha.org`.

| Evento | Assunto |
|---|---|
| → `draft` | OS #XXXX salva como rascunho |
| → `pending` | OS #XXXX aberta |
| → `in_progress` (sem fase) | OS #XXXX em andamento |
| fase definida ou alterada | OS #XXXX — aguardando [nome da fase] |
| fase removida | OS #XXXX em andamento (fase removida) |
| → `resolved` | OS #XXXX concluída |
| → `cancelled` | OS #XXXX cancelada |
| → `archived` | OS #XXXX arquivada |

---

## 5. Frontend

### 5.1 Mapeamento de labels e cores

```ts
const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  draft:       'Rascunho',
  pending:     'Pendente',
  in_progress: 'Em Andamento',
  resolved:    'Concluída',
  archived:    'Arquivada',
  cancelled:   'Cancelada',
}
```

Fase exibida dinamicamente a partir de `service_order_phases` carregadas via API.

### 5.2 StatusUpdateModal

Pipeline visual:
```
[Pendente] ──→ [Em Andamento] ──→ [Concluída]
                     │
              ┌──────▼──────────┐
              │  Fase (opcional) │
              │  Ag. Terceiros ▾ │
              └─────────────────┘

Rodapé: [Arquivar]          [Cancelar]
```

- Estado atual: filled/destacado; próximos: outlined; anteriores: ghost
- Sub-painel de fase: animado, aparece ao entrar em `in_progress`
- Botão confirmar bloqueado até campos obrigatórios preenchidos

### 5.3 Tabela de OS — linha

- Badge principal: estado atual
- Badge secundário (menor): fase, cor configurável, só exibido quando `phase_id` não nulo
- Exemplo: `🟡 Em Andamento` + `🟣 Ag. Terceiros`
- Fase desativada: nome em cinza + ícone de aviso

### 5.4 Detail Panel

Header de status:
```
[Pendente] → [Em Andamento ▸ Ag. Terceiros] → [Concluída]
```
- Fase inline com `▸` como separador
- Se sem fase: exibe apenas estado

### 5.5 KPI cards

Card "Em Andamento" expande sub-contagem por fase:
```
Em Andamento  12
├ Ag. Terceiros   4
├ Ag. Validação   3
└ Sem fase        5
```
Card adicional âmbar: total de OS aguardando alguma fase.

### 5.6 Filtros

Chips: `Ativas · Pendente · Em Andamento · Concluída · Cancelada · Arquivada`

Ao selecionar "Em Andamento": sub-chips das fases aparecem como refinamento.

### 5.7 Aba Configurações — gestão de fases

```
Fases de Andamento
──────────────────────────────────
🟣 Ag. Terceiros          ✎  🗑
🟡 Ag. Validação          ✎  🗑
🔵 Ag. Material           ✎  🗑
🟢 Ag. Recurso Financeiro ✎  🗑

[+ Nova fase]
```

- Campo: nome + color picker (hex)
- Reordenável via setas (↑↓)
- Delete: soft se tiver OS vinculada, hard se não tiver
- Fases inativas ficam ocultas no seletor mas visíveis no histórico

---

## 6. Referências de arquivos impactados

**Backend:**
- `backend/app/models/service_order.py`
- `backend/app/models/service_order_phase.py` ← novo
- `backend/app/routers/service_orders.py`
- `backend/app/routers/service_order_phases.py` ← novo
- `backend/app/services/service_order_service.py`
- `database/migrations/020_os_status_redesign.sql` ← novo

**Frontend:**
- `frontend/src/types/index.ts`
- `frontend/src/pages/service_orders/ServiceOrdersPage.tsx`

---

## 7. Fora de escopo

- Histórico de mudanças de fase (já existe `service_order_history` para status; fase usa mesmo mecanismo)
- Notificações push/SMS
- Regras de SLA por fase
