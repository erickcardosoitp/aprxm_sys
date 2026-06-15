# Design — CRM de Associados + Agentes Porta a Porta

**Data:** 2026-06-15
**Status:** Aprovado para implementação

---

## Contexto

O módulo de Cobranças atual não oferece visão operacional suficiente para a equipe de campo. Este spec cria um CRM dedicado a associados (type = member), com ranking gamificado de agentes e fluxo de baixa de mensalidade sem dependência de caixa físico.

---

## Escopo

Três módulos interdependentes, entregues juntos:

1. **CRM** — tabela de associados com indicadores em tempo real
2. **Baixa Remota** — pagamento de mensalidade sem caixa, com comprovante PIX obrigatório
3. **Agentes + Metas** — ranking mensal com bônus automático e registro de visitas porta a porta

---

## Módulo 1 — CRM (`/crm`)

### Filtro de moradores

Apenas `residents.type = 'member'`. Dependentes e não-associados excluídos.

Volumes: Congonha 227 · Vaz Lobo 158 → máx 385 linhas.

### Tabela principal

| Coluna | Fonte | Cálculo |
|---|---|---|
| Nome | `residents.full_name` | — |
| Endereço | `residents.address_street + address_number` | — |
| Tempo Assoc. | `residents.created_at` | `NOW() - created_at` → "2a 3m" |
| Status | `mensalidades` | Adimplente se nenhuma `pending` vencida além da carência; Inadimplente caso contrário |
| R$ Atrasado | `mensalidades` | `SUM(amount)` onde `status = 'pending' AND due_date < NOW() - grace_days` |
| Qtd Pendentes | `mensalidades` | `COUNT(*)` onde `status = 'pending'` |
| Última Encomenda | `packages` | `NOW() - MAX(delivered_at)` → "8 dias" |
| Enc/Mês | `packages` | `COUNT(delivered) / meses_desde_primeira_entrega` |

### Filtros disponíveis

- Associação (superadmin vê ambas; diretoria/agente vê só a própria)
- Status: Todos / Adimplente / Inadimplente
- Busca por nome ou logradouro (GIN index já existe)

### Ações por linha

- **Baixar Mensalidade** — abre modal de baixa remota
- **Registrar Visita** — abre modal de porta a porta
- **Ver Perfil** — modal 360 com histórico completo

### Acesso

| Role | Acesso |
|---|---|
| superadmin / admin_master | Todas as associações |
| diretoria / admin | Própria associação |
| agente | Própria associação (somente leitura + registrar visita) |

---

## Módulo 2 — Baixa Remota de Mensalidade

### Conceito

Pagamento registrado sem `cash_session_id`. Aparece em movimentações e faturamento, não afeta saldo do caixa físico.

### Campos novos em `mensalidades`

```sql
payment_channel  VARCHAR(20) DEFAULT 'cash'  -- 'cash' | 'remote'
payment_proof_url TEXT                        -- URL Cloudinary do comprovante PIX
```

### Fluxo do modal

1. Seleciona mensalidade(s) pendente(s) do morador
2. Seleciona método de pagamento
3. **Se PIX:** upload obrigatório de comprovante (PDF ou imagem) — botão confirmar bloqueado até upload concluído
4. Confirma → transação criada com `payment_channel = 'remote'`, `cash_session_id = NULL`
5. `mensalidade.status = 'paid'`, `paid_at = NOW()`, `payment_proof_url` salvo

### Baixa múltipla

Seleção de múltiplos moradores na tabela CRM → botão "Baixar Selecionados" → mesmo fluxo em lote.

---

## Módulo 3 — Agentes e Plano de Metas

### Nova role: `agente`

```sql
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agente';
```

Permissões: leitura CRM + registrar visita + ver próprio ranking. Sem acesso a financeiro, caixa ou configurações.

Login: senha ou chave de dispositivo (WebAuthn) — fluxo existente.

### Métricas de ranking (calculadas automaticamente)

| Métrica | Como medir |
|---|---|
| Mensalidades cobradas | `transactions.created_by = agente` + `income_subtype = 'mensalidade'` no mês |
| Novos associados | `residents.created_by = agente` + `type = 'member'` + `created_at` no mês atual |

**Pontuação:** cobranças (60%) + novos associados (40%)

### Prêmios mensais

| Posição | Prêmio |
|---|---|
| 🏆 1º lugar | R$ 150 |
| 🥈 2º lugar | R$ 100 |
| 🥉 3º lugar | R$ 75 |

### Bônus de equipe (+R$30 para todos)

Condições — **ambas** devem ser verdadeiras no fechamento do mês:

1. Todos os 5 agentes recrutaram ≥ 5 novos associados no mês
2. ≥ 80% dos associados ativos estão adimplentes

Se uma falhar, bônus de equipe não é liberado.

### Painel `/agentes`

```
🏆 RANKING — JUNHO 2026

1º  Fernanda Costa    12 cobranças · 3 novos   R$ 150
2º  Carlos Mendes      9 cobranças · 5 novos   R$ 100
3º  Ana Lima           7 cobranças · 2 novos   R$  75
4º  João Soares        5 cobranças · 1 novo     —
5º  Marisa Braga       3 cobranças · 0 novos    —

Bônus equipe:
  Novos por agente:  3/5 bateram ❌
  Adimplência:       83% ✅
  → Bônus não liberado este mês
```

Acesso: superadmin, admin_master, diretoria (visão completa) · agente (só posição própria + progresso)

### Registro de visita porta a porta

Modal acessível pelo CRM (botão por linha):

- **Resultado:** pagou / vai pagar / ausente / recusou
- **Observação:** texto livre
- Visita vinculada ao agente logado + morador + timestamp

Histórico de visitas aparece no perfil 360 do morador.

---

## Arquitetura Técnica

### Migrations

```sql
-- 024: CRM e agentes
ALTER TABLE mensalidades
  ADD COLUMN payment_channel VARCHAR(20) NOT NULL DEFAULT 'cash',
  ADD COLUMN payment_proof_url TEXT;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agente';

CREATE TABLE agent_visits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id   UUID NOT NULL REFERENCES associations(id),
  agent_id         UUID NOT NULL REFERENCES users(id),
  resident_id      UUID NOT NULL REFERENCES residents(id),
  visited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result           VARCHAR(20) NOT NULL CHECK (result IN ('paid','will_pay','absent','refused')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_visits_resident  ON agent_visits(resident_id, association_id);
CREATE INDEX idx_agent_visits_agent     ON agent_visits(agent_id, visited_at);
CREATE INDEX idx_packages_resident_del  ON packages(resident_id, delivered_at);
```

### Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/crm/residents` | Tabela CRM paginada (100/página) |
| POST | `/api/v1/crm/mensalidades/{id}/pay` | Baixa remota individual |
| POST | `/api/v1/crm/mensalidades/pay-batch` | Baixa remota em lote |
| GET | `/api/v1/crm/agentes/ranking` | Ranking mensal com bônus |
| POST | `/api/v1/crm/visitas` | Registrar visita porta a porta |
| GET | `/api/v1/crm/visitas` | Listar visitas por agente/morador |

### Query CRM — estrutura com CTEs

```sql
WITH mens AS (
  SELECT resident_id,
         SUM(amount) FILTER (WHERE status='pending' AND due_date < NOW() - grace) AS valor_atrasado,
         COUNT(*)    FILTER (WHERE status='pending') AS qtd_pendentes
  FROM mensalidades WHERE association_id = :aid GROUP BY resident_id
),
pkgs AS (
  SELECT resident_id,
         MAX(delivered_at) AS ultima_entrega,
         COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS total_entregues,
         MIN(delivered_at) AS primeira_entrega
  FROM packages WHERE association_id = :aid GROUP BY resident_id
)
SELECT r.full_name, r.address_street, r.address_number,
       r.created_at,
       COALESCE(m.valor_atrasado, 0),
       COALESCE(m.qtd_pendentes, 0),
       p.ultima_entrega,
       -- enc/mês
       CASE WHEN p.primeira_entrega IS NOT NULL
         THEN ROUND(p.total_entregues::numeric /
              GREATEST(1, EXTRACT(MONTH FROM AGE(NOW(), p.primeira_entrega)) + 1), 1)
         ELSE 0 END
FROM residents r
LEFT JOIN mens m ON m.resident_id = r.id
LEFT JOIN pkgs p ON p.resident_id = r.id
WHERE r.association_id = :aid AND r.type = 'member' AND r.status = 'active'
ORDER BY m.valor_atrasado DESC NULLS LAST
LIMIT 100 OFFSET :offset
```

**Estimativa:** < 50ms para 385 membros com indexes existentes.

### Rotas frontend

| Rota | Componente |
|---|---|
| `/crm` | `CRMPage.tsx` |
| `/agentes` | `AgentesPage.tsx` |

---

## Fora do escopo

- Notificações automáticas por WhatsApp (spec separado — suporte WhatsApp)
- Metas configuráveis pelo admin (valores fixos no código por ora)
- Histórico de rankings de meses anteriores (fase 2)
