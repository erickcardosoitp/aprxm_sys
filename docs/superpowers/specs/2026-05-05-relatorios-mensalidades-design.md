# Spec: Relatórios Financeiros — Unificação mensalidades + migration_payments

**Data:** 2026-05-05
**Status:** Aprovado

---

## Problema

Todos os 7 métodos de `mensalidade_service.py` ignoram `migration_payments`, causando:
- Relatório mostra 12 registros em vez de 47 (Vaz Lobo abril/2026)
- Inadimplentes falso-positivo para moradores que pagaram via migração
- KPIs de dashboard incorretos
- Histórico incompleto por morador

---

## Solução 1 — View SQL unificada

Criar `v_mensalidades_completas` no banco. Todos os métodos do service leem desta view.

```sql
CREATE OR REPLACE VIEW v_mensalidades_completas AS
  SELECT
    m.id, m.resident_id, m.association_id, m.reference_month,
    m.due_date, m.amount, m.status, m.paid_at,
    m.transaction_id, m.notes, 'sistema' AS origem,
    t.payment_method_id, pm.name AS payment_method_name,
    r.full_name AS resident_name, r.address_cep, r.unit
  FROM mensalidades m
  JOIN residents r ON r.id = m.resident_id
  LEFT JOIN transactions t ON t.id = m.transaction_id
  LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id

UNION ALL

  SELECT
    mp.id, mp.resident_id, mp.association_id, mp.competencia,
    NULL, mp.valor_pago, 'paid', mp.data_pagamento,
    NULL, NULL, 'migracao' AS origem,
    NULL, NULL,
    r.full_name, r.address_cep, r.unit
  FROM migration_payments mp
  JOIN residents r ON r.id = mp.resident_id
  WHERE NOT EXISTS (
    SELECT 1 FROM mensalidades m2
    WHERE m2.resident_id = mp.resident_id
      AND m2.reference_month = mp.competencia
  )
```

### Métodos afetados

| Método | Mudança |
|--------|---------|
| `payment_report()` | Query aponta para view; inclui filtros novos |
| `list_paid()` | Query aponta para view |
| `list_delinquent()` | LEFT JOIN view; exclui cobertos por migração |
| `has_delinquent_mensalidade()` | EXISTS na view |
| `list_by_resident()` | Query aponta para view |
| `list_pending()` | Query aponta para view |
| `total_pending()` | Query aponta para view |

---

## Solução 2 — Relatório de Mensalidades (frontend + backend)

### Novos filtros no endpoint `/mensalidades/report`

| Param | Tipo | Notas |
|-------|------|-------|
| `from_month` / `to_month` | `YYYY-MM` | Já existe |
| `paid_from` / `paid_to` | `YYYY-MM-DD` | Filtra por `paid_at` |
| `cep` | string | Prefixo ou exato |
| `payment_method_id` | UUID | Forma de pagamento |
| `origem` | `sistema\|migracao\|all` | Default `all` |
| `status` | `paid\|pending\|all` | Default `all` |

### KPIs retornados

- Total registros, total pagos, total pendentes
- Valor arrecadado, valor pendente, arrecadado via migração

### Tabela (frontend)

Colunas: Morador, Mês Ref, Vencimento, Valor, Status, Pago em, Forma Pgto, Origem
- Remover: coluna Unidade
- Status: sempre pt-BR (Pago / Pendente) — tabela e CSV

### Novos controles de filtro

- Dropdown "Forma de Pagamento" (carrega `/payment-methods`)
- Input CEP
- Date range "Pago entre"
- Dropdown Origem (Sistema / Migração / Todos)
- Dropdown Status (Pago / Pendente / Todos)

---

## Solução 3 — Relatório de Sessões (frontend only)

| Item | Mudança |
|------|---------|
| Coluna "R$ Despesas" | Nova coluna; dado já vem do backend (`total_expense`) |
| Filtro Status | Dropdown: Todos / Aberto / Fechado / Conferido |
| Filtro Origem | Dropdown: Todos / Manual / Sessão de Caixa |
| Totalizadores | Rodapé: soma bruto, líquido, PIX, dinheiro do período filtrado |
| Export XLSX | Adicionar coluna Despesas; traduzir status para pt-BR |

---

## Fora de escopo

- Paginação server-side (futuro)
- Remoção da tabela `migration_payments` (após migração completa)
- Filtro por rua (já existe em inadimplentes)
