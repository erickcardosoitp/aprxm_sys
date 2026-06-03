# Spec: Saldo de Caixa Unificado + Relatórios Financeiros no Financeiro

**Data:** 2026-06-02  
**Status:** Aprovado pelo usuário

---

## Problema

O módulo Financeiro tem um sistema de caixinhas (cofre/malote) que:
1. Fragmenta o saldo em sub-contas, dificultando saber o saldo real
2. Gera confusão operacional (sangrias vão para caixinha em vez de só saírem)
3. Os relatórios financeiros ficam no módulo Relatórios em vez de no Financeiro

---

## Solução em 3 partes

### Parte 1 — `balance_start_date` na associação

**Banco:**
```sql
ALTER TABLE associations ADD COLUMN balance_start_date DATE DEFAULT '2026-06-01';
```

**Cálculo do saldo esperado:**
```
entradas_caixa  = SUM(amount) WHERE type='income' AND cash_session_id IS NOT NULL AND transaction_at >= balance_start_date
entradas_manual = SUM(amount) WHERE type='income' AND cash_session_id IS NULL     AND transaction_at >= balance_start_date
saidas_caixa    = SUM(amount) WHERE type IN ('expense','sangria') AND cash_session_id IS NOT NULL AND transaction_at >= balance_start_date
saidas_manual   = SUM(amount) WHERE type='expense' AND cash_session_id IS NULL    AND transaction_at >= balance_start_date
saldo_esperado  = (entradas_caixa + entradas_manual) - (saidas_caixa + saidas_manual)
```

**Endpoint novo:** `GET /finance/balance-summary`
```json
{
  "entradas_caixa": "1200.00",
  "entradas_manual": "350.00",
  "saidas_caixa": "480.00",
  "saidas_manual": "120.00",
  "saldo_esperado": "950.00",
  "balance_start_date": "2026-06-01"
}
```

**Endpoint Admin:** `POST /admin/reset-balance` — atualiza `balance_start_date = CURRENT_DATE` para a associação do usuário.
Requer role `admin` ou superior. Registra log de auditoria.

---

### Parte 2 — Remoção da UI de caixinhas (sem apagar dados)

**Segurança:** tabelas `cash_boxes` e `cash_box_movements` **não são alteradas**. Apenas frontend removido.

| Componente | Ação |
|---|---|
| `EsteiraTab.tsx` — seção caixinhas | Remover |
| `SaldoConsolidado.tsx` — linha cofre/malote | Remover linhas de cofre; manter saldo da sessão atual |
| `CaixaConferenciaModal.tsx` — etapa "enviar para malote" | Remover etapa; conferência encerra diretamente |
| `SangriaModal.tsx` — campo `cash_box_id` | Campo removido do form; sangria vira saída simples |
| `GeralPage.tsx` — card "Saldo caixinhas" | Substituir pelo novo saldo esperado (`/finance/balance-summary`) |
| `TransferenciasTab.tsx` — transferência entre caixinhas | Remover aba ou ocultar |
| Backend `transfer-to-cashbox` e `send-to-malote` | **Mantidos** (preserva dados históricos e compatibilidade) |

---

### Parte 3 — RelatoriosTab expandida no Financeiro

A aba **Relatórios** do módulo Financeiro ganha 3 painéis novos:

#### Painel A — Saldo Atual (sempre visível, sem filtro)
Cards com breakdown:
```
Entradas via caixa    R$ X    |  Saídas via caixa    R$ X
Entradas manuais      R$ X    |  Saídas manuais      R$ X
─────────────────────────────────────────────────────────
Total entradas        R$ X       Total saídas         R$ X

SALDO ESPERADO: R$ X  (desde 01/06/2026)

[Botão: Zerar Caixa] → modal de confirmação com senha admin
```

#### Painel B — Por Operador (filtro De/Até)
Tabela gerada por `GET /finance/report/by-operator?date_from=&date_to=`:
| Operador | Sessões | Entradas | Saídas | Resultado |
|---|---|---|---|---|
| Monique | 42 | R$X | R$X | R$X |
| Paulo Victor | 18 | R$X | R$X | R$X |
| **Total** | **60** | **R$X** | **R$X** | **R$X** |

Botão **Exportar Excel**.

#### Painel C — Apuração do Período (filtro De/Até)
Gerado por `GET /finance/report/period-summary?date_from=&date_to=`:
```
Entradas via caixa:   R$ X
Entradas manuais:     R$ X
─────────────────────────
Total entradas:       R$ X

Saídas via caixa:     R$ X
Saídas manuais:       R$ X
─────────────────────────
Total saídas:         R$ X

RESULTADO DO PERÍODO: R$ X
```

Botão **Exportar Excel**.

#### Migração dos relatórios do módulo geral
- Aba **"Financeiro"** no módulo Relatórios gerais → **removida**
- Funcionalidade coberta pelos 3 painéis acima

---

## O que NÃO muda

- Tabelas `cash_boxes`, `cash_box_movements`, `cash_sessions`, `transactions` — zero alteração
- Endpoints backend de caixinha — mantidos (compatibilidade e histórico)
- Fluxo de abertura/fechamento de sessão de caixa
- Sangrias continuam sendo registradas como tipo `sangria` nas transactions
- Todos os outros módulos (moradores, encomendas, OS, mensalidades, relatórios não-financeiros)
- Conciliação PIX — não afetada
- Porta a Porta — não afetado
- ETL/Data Lake — não afetado (Gold `daily_revenue` usa `transactions`, sem depender de caixinhas)

---

## Arquivos afetados

**Backend (novos/modificados):**
| Arquivo | Mudança |
|---|---|
| `database/schema.sql` | `ALTER TABLE associations ADD balance_start_date` |
| `main.py` (lifespan) | Migration da nova coluna |
| `backend/app/routers/finance.py` | `GET /finance/balance-summary` + dois novos GET de relatório |
| `backend/app/routers/admin.py` | `POST /admin/reset-balance` |

**Frontend (modificados):**
| Arquivo | Mudança |
|---|---|
| `EsteiraTab.tsx` | Remove seção caixinhas |
| `SaldoConsolidado.tsx` | Remove linha cofre/malote |
| `CaixaConferenciaModal.tsx` | Remove etapa malote |
| `SangriaModal.tsx` | Remove campo cash_box_id |
| `GeralPage.tsx` | Card cofre → saldo esperado |
| `TransferenciasTab.tsx` | Oculta seção de caixinhas |
| `RelatoriosTab.tsx` | Adiciona 3 painéis (Saldo Atual, Por Operador, Apuração) |
| `pages/reports/ReportsPage.tsx` | Remove aba Financeiro |

---

## Critérios de sucesso

1. `GET /finance/balance-summary` retorna saldo correto com cutoff 01/06/2026
2. Conferência de caixa funciona sem etapa de malote
3. Sangria registrada como saída simples (sem cash_box_id obrigatório)
4. RelatoriosTab mostra por operador com totais e exportação
5. Aba Financeiro removida do módulo Relatórios geral
6. Nenhum erro em outros módulos
