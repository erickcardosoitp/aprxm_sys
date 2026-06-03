# Plano de Implementação — Saldo de Caixa Unificado

**Spec:** `docs/superpowers/specs/2026-06-02-saldo-caixa-unificado.md`

---

## Ordem de execução

### Fase 1 — Backend: migration + novos endpoints

**1.1** `backend/app/main.py` (lifespan)
- Adicionar migration: `ALTER TABLE associations ADD COLUMN IF NOT EXISTS balance_start_date DATE DEFAULT '2026-06-01'`

**1.2** `backend/app/routers/finance.py`
- Adicionar `GET /finance/balance-summary` — retorna entradas/saídas caixa vs manual + saldo_esperado
- Adicionar `GET /finance/report/by-operator?date_from&date_to` — agrupado por operador
- Adicionar `GET /finance/report/period-summary?date_from&date_to` — apuração do período

**1.3** `backend/app/routers/admin.py`
- Adicionar `POST /admin/reset-balance` — atualiza balance_start_date = hoje, role >= admin

---

### Fase 2 — Frontend: UI de caixinhas removida

**2.1** `frontend/src/components/finance/SangriaModal.tsx`
- Remover campo `cash_box_id` do form e do body enviado
- Campo `sangria_destination` fica livre (texto)

**2.2** `frontend/src/components/finance/CaixaConferenciaModal.tsx`
- Remover etapa "enviar para malote" do wizard de conferência
- Conferência encerra diretamente após contagem

**2.3** `frontend/src/pages/financeiro/tabs/EsteiraTab.tsx`
- Remover seção "Caixinhas" (cards de cofre/malote e movimentações)

**2.4** `frontend/src/pages/financeiro/components/SaldoConsolidado.tsx`
- Remover linha cofre/malote do card de saldo consolidado

**2.5** `frontend/src/pages/financeiro/tabs/TransferenciasTab.tsx`
- Ocultar seção de transferência entre caixinhas

---

### Fase 3 — Frontend: novos painéis na RelatoriosTab

**3.1** `frontend/src/pages/financeiro/tabs/RelatoriosTab.tsx`
- Adicionar Painel A: Saldo Atual (chama `/finance/balance-summary`)
  - Cards: entradas caixa, entradas manual, saídas caixa, saídas manual
  - Card destaque: Saldo Esperado
  - Botão "Zerar Caixa" → modal confirmação → `POST /admin/reset-balance`
- Adicionar Painel B: Por Operador (filtro De/Até, chama `/finance/report/by-operator`)
  - Tabela operador + sessões + entradas + saídas + resultado + total
  - Botão Exportar Excel
- Adicionar Painel C: Apuração do Período (filtro De/Até, chama `/finance/report/period-summary`)
  - Cards entradas/saídas/resultado
  - Botão Exportar Excel

---

### Fase 4 — Frontend: GeralPage + Reports limpeza

**4.1** `frontend/src/pages/geral/GeralPage.tsx`
- Card "Saldo caixinhas" → substituir por chamada a `/finance/balance-summary`

**4.2** `frontend/src/pages/reports/ReportsPage.tsx`
- Remover módulo `finance` do array `MODULES`

---

## Rollback

- Nenhum dado é apagado; rollback = reverter o frontend e comentar a migration
- `balance_start_date` pode ser revertida com `ALTER TABLE associations DROP COLUMN balance_start_date`
