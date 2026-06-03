# Spec: DRE com Níveis de Detalhe e Agrupamento Dinâmico

**Data:** 2026-06-03  
**Status:** Aprovado pelo usuário

---

## Problema

O DRE atual:
- Exibe apenas um nível fixo (receitas e despesas por subtype/categoria)
- Não permite ver por operador
- Não permite escolher o nível de agregação
- Não tem flexibilidade de agrupamento

---

## Solução

### Interface (DRETab)

Dois controles inline acima do relatório:

**1. Seletor de nível:**
- `1 — Resumo` → totais consolidados (Receitas · Despesas · Resultado)
- `2 — Agrupado` → linhas por dimensão escolhida
- `3 — Detalhado` → mesmas linhas do nível 2 + accordion com transações individuais

**2. Seletor de dimensão** (visível quando nível 2 ou 3):
- `Tipo` — agrupa por `income_subtype` mapeado (Mensalidades, Taxas de Entrega, Comprovantes, Outras Receitas)
- `Origem` — agrupa por canal (Via Caixa vs Manual, para receitas e despesas separadamente)
- `Operador` — agrupa receitas por quem abriu a sessão (operadores) + despesas sem operador
- `Categoria` — agrupa por `transaction_categories.name`

**Filtros existentes mantidos:** Ano + Mês (ou só Ano para visão anual).

**Botões de export:** Excel e PNG continuam.

---

### Comportamento por combinação

| Nível | Dimensão | Linhas de Receita | Linhas de Despesa |
|---|---|---|---|
| 1 | — | "Receitas" (total) | "Despesas" (total) |
| 2 | Tipo | Mensalidades · Taxas de Entrega · Comprovantes · Outras | Manutenção · Material · Serviços · Outros |
| 2 | Origem | Receitas via Caixa · Receitas Manuais | Saídas via Caixa · Saídas Manuais |
| 2 | Operador | Monique · Danielly · Fernanda · ... | Despesas (sem operador) |
| 2 | Categoria | Cada nome de `transaction_categories` | Idem |
| 3 | qualquer | Mesmo que nível 2 + accordion com transações | Idem |

**Sangrias:** excluídas do DRE (são movimentações internas, já excluídas no endpoint atual).

---

### Backend

**Endpoint modificado:** `GET /financeiro/dre`

**Novos parâmetros:**
| Parâmetro | Tipo | Default | Valores |
|---|---|---|---|
| `nivel` | int | 2 | 1, 2, 3 |
| `agrupar_por` | str | `tipo` | `tipo`, `origem`, `operador`, `categoria` |

**Schema de resposta:**
```json
{
  "period_label": "06/2026",
  "nivel": 2,
  "agrupar_por": "operador",
  "receitas": [
    { "label": "Monique", "valor": 1702.50, "linhas": null },
    { "label": "Danielly Marinho Quinta", "valor": 1343.02, "linhas": null }
  ],
  "despesas": [
    { "label": "Outros (Despesa)", "valor": 67.60, "linhas": null }
  ],
  "total_receitas": 3045.52,
  "total_despesas": 67.60,
  "resultado": 2977.92
}
```

Quando `nivel=3`, `"linhas"` é preenchido:
```json
"linhas": [
  { "descricao": "Mensalidade Mai/2026 — João Silva", "valor": 20.00, "data": "2026-05-07" }
]
```

**Lógica SQL por dimensão:**

- `tipo` → `GROUP BY income_subtype` para receitas, `GROUP BY c.name` para despesas
- `origem` → `GROUP BY (CASE WHEN cash_session_id IS NOT NULL THEN 'Via Caixa' ELSE 'Manual' END), type`
- `operador` → `JOIN cash_sessions cs JOIN users u ON u.id = cs.opened_by GROUP BY u.full_name` (só receitas com sessão)
- `categoria` → `GROUP BY c.name` para ambos

---

## O que não muda

- Schema do banco: zero alterações
- Tabela `transaction_categories`: mantida como está
- Exports Excel e PNG: continuam funcionando
- Outros endpoints do financeiro: não afetados

---

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `backend/app/routers/financeiro.py` | Modificar `GET /financeiro/dre` com parâmetros `nivel` e `agrupar_por` |
| `frontend/src/pages/financeiro/tabs/DRETab.tsx` | Adicionar seletores de nível e dimensão; suporte a accordion nível 3 |

---

## Critérios de sucesso

1. Nível 1 mostra apenas Receitas · Despesas · Resultado
2. Nível 2 + Operador mostra cada operador com seu faturamento + linha de despesas
3. Nível 3 expande cada linha com as transações individuais
4. Export Excel reflete o nível e dimensão selecionados
5. Nenhum erro nos outros módulos
