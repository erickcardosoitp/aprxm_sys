# Plano de Implementação — Financeiro Centralizado no ESC

**Spec:** `docs/superpowers/specs/2026-07-20-financeiro-centralizado-design.md`
**Depende de:** Fase 9 (ESC como associação), Fase 11 (`access_groups`) — já em produção.

---

## Ordem de execução

### Fase 1 — Fundação (resolver de escopo, gate, permissão, devolução)

**1.1** `backend/app/core/tenant.py`
- Novo helper `financeiro_scope(current, financeiro_centralizado, unidade=None)` → lista de `association_id` (todas da empresa, ou só `unidade` se informado) quando ESC-stationed + centralizado; `[current.association_id]` senão.
- 403 quando `financeiro_centralizado=True` e chamador não é ESC-stationed, em qualquer endpoint dos routers da Fase 2-7 abaixo.
- Novo dependency `require_esc_module(module: str)` — exige `require_empresa_admin` + `"view"` em `access_groups[current.role][module]` (fallback `_DEFAULT_ACCESS_GROUPS`).

**1.2** `backend/app/routers/esc.py`
- Adicionar chave `"financeiro"` em `_DEFAULT_ACCESS_GROUPS` pra cada cargo do template.

**1.3** `backend/app/services/finance_service.py`
- `reverse_transaction`: checar status da sessão da transação ORIGINAL (não anexar a uma sessão aberta "emprestada"). Se `original.cash_session_id` aponta pra sessão com `status != 'open'` (ou não tem sessão) → `cash_session_id=None` no estorno (devolução). Se `status == 'open'` → comportamento atual, sem mudança.

**1.4** `frontend/src/components/layout/AppShell.tsx`
- Item de menu "Financeiro" da associação: condição extra, some quando `empresa.financeiro_centralizado === true` (independe de permissão de cargo). Caixa (`/finance`) não muda.
- Novo item "Financeiro" no sidebar do ESC, visível só quando `financeiro_centralizado===true` e `financeiro:view`.

**1.5** `frontend/src/pages/esc/`
- Novo `EscFinanceiroPage.tsx` (container) + rotas das sub-seções (vazias, preenchidas nas fases seguintes) + seletor de unidade (Todas / unidade específica) reutilizável, plugado no `?unidade=`.

---

### Fase 2 — Fluxo de Caixa, Movimentações, DRE (reaproveita endpoints existentes)

**2.1** `backend/app/routers/financeiro.py`
- `/dashboard`, `/dre`, `/evolucao`, `/fluxo-projetado`: aplicar `financeiro_scope()` (troca `WHERE association_id = :aid` por `= ANY(:ids)`), guardar com `require_esc_module("financeiro")` quando chamado do ESC.

**2.2** `backend/app/routers/finance.py`
- `list_transactions` (`/finance/transactions`): aplicar `financeiro_scope()`; adicionar `res.address_street`/`res2.address_street` ao SELECT; novos query params de filtro — `tipo`, `unidade`, `periodo` (add "trimestre"), `produto` (lista de `income_subtype`), `morador_id`, `rua`, `inadimplente` (bool, calculado via join `mensalidades` na competência mais próxima), `usuario_id`, `cargo`.
- Novo `GET /finance/transactions/export` — mesma query, gera xlsx (`openpyxl`, já usado em outros exports do projeto) com os filtros aplicados.

**2.3** `frontend/src/pages/esc/financeiro/FluxoCaixaSection.tsx` (novo)
- Cards saldo atual / total entrou / total saiu / sangrias.
- Botão "Zerar caixa" (só ADMIN) → modal reaproveitando o form de sangria já existente, `amount` pré-preenchido = saldo disponível, motivo padrão editável.

**2.4** `frontend/src/pages/esc/financeiro/MovimentacoesSection.tsx` (novo, baseado em `MovimentacoesTab.tsx`)
- Filtros novos da seção 2.2. Colunas: Data/hora, Tipo, Associação, Morador, Valor, Produto, Status Morador, Usuário.
- Botão exportar xlsx (chama 2.2).
- Modal de consulta (dados já vêm na linha) + botão "baixar PNG" (html2canvas ou equivalente já disponível no projeto — conferir).

**2.5** `frontend/src/pages/esc/financeiro/DRESection.tsx` (novo, baseado em `DRETab.tsx`)
- Mesma UI, troca só a fonte (endpoint já com escopo de empresa).

---

### Fase 3 — Sessões de Caixa (novo)

**3.1** `backend/app/services/finance_service.py`
- `list_sessions`: adicionar `liquido` por sessão (`bruto - baixas`) e `qtd_mensalidades` (`JOIN mensalidades ON transaction_id = t.id WHERE cash_session_id = :sid`).

**3.2** `backend/app/routers/esc.py`
- Expandir `GET /esc/financeiro/sessoes-conferidas` (hoje retorna só `id, opening_balance, opened_at, status, unidade`) com as colunas da tabela principal + os campos do modal (seção 2.4 da spec): `aberto_em, fechado_em, usuario, entradas, saidas, estornos, qtd_mensalidades, bruto_pix, bruto_dinheiro, liquido, sobra_falta, quebra_caixa, conferido_por, origin`. Filtra sempre `status='conferido'`.
- Ações no endpoint: reverter (chama o fluxo de devolução da Fase 1.3), reabrir (`revert_conferencia`, já existe — só adaptar escopo), 2ª via (`generate_conferencia_pdf`, já existe).

**3.3** `frontend/src/pages/esc/financeiro/SessoesCaixaSection.tsx` (novo)
- Tabela principal (Data/hora, Associação, Usuário, Entradas, Saídas, Líquido, Conferido por, Ações) + modal com os demais campos.

---

### Fase 4 — CRM (mensalidade)

**4.1** `backend/app/services/mensalidade_service.py`
- Nova query agregada por morador: `SUM(amount)`, `COUNT/MAX(months_overdue)` GROUP BY `resident_id`, sobre a mesma regra de `grace_cutoff` já usada em `list_delinquent` (não usar a regra simplificada de `get_resident_payment_history`).
- Nova query "Ações/mês": `COUNT(transactions mensalidade) + COUNT(packages entregues) + COUNT(transactions comprovante_residencia)` por morador por mês, média móvel 6 meses (parametrizável).
- Nova query "forma de pagamento recorrente": moda do `payment_method_id` dos últimos N pagamentos do morador.

**4.2** `backend/app/routers/mensalidades.py`
- Adaptar `/pending`, `/delinquent`, `/paid` com `financeiro_scope()`.
- Novo `GET /mensalidades/crm/associados` (view "Associados", base `residents type=member` + resumo).
- Novo `GET /mensalidades/crm/resumo-morador` (as agregações de 4.1), com os filtros: nome, rua, tempo associado, status, min/max R$ atrasado, qtd. meses atrasado, dependentes, forma de pagamento recorrente.

**4.3** `frontend/src/pages/esc/financeiro/CrmSection.tsx` (novo, baseado em `CobrancasTab.tsx`)
- 4 visões (Associados / A receber / Inadimplentes / Pagos), campos e filtros da spec (seção 2.3).

---

### Fase 5 — Contas a Pagar (schema novo)

**5.1** `backend/app/main.py` (lifespan, `_SCHEMA_VERSION` → próximo número)
- Migration: `contas_pagar_templates`, `contas_pagar`, `conta_pagar_baixas` (DDL na spec, seção 2.6) — replicar nos dois branches (`_is_existing_db` e fresh-DB), `try/except`.

**5.2** `backend/app/models/finance.py` (ou novo `backend/app/models/contas_pagar.py`)
- Models SQLModel pras 3 tabelas.

**5.3** `backend/app/routers/esc.py` (ou novo `backend/app/routers/contas_pagar.py`)
- `POST/GET/PUT /esc/financeiro/contas-pagar` (CRUD, manual e via `template_id`).
- `POST /esc/financeiro/contas-pagar-templates` (CRUD do template recorrente).
- `POST /esc/financeiro/contas-pagar/{id}/baixa` — cria `transactions` (`type=expense`, `cash_session_id=NULL` por padrão) + `conta_pagar_baixas`, recalcula `amount_paid`/`status`.
- Geração mensal a partir de template (endpoint manual ou task agendada — decidir no dia, mesmo padrão de `generate-month` de mensalidade).

**5.4** `frontend/src/pages/esc/financeiro/ContasPagarSection.tsx` (novo)
- Lista + cadastro manual/recorrente + modal de baixa (parcial).

---

### Fase 6 — Contas a Receber

**6.1** `backend/app/routers/packages.py` ou `mensalidades.py`
- Nova query: taxa de entrega prevista = `COUNT(DISTINCT resident_id)` com `type=guest` e `≥1 package pendente com has_delivery_fee=true` × R$2,50 (não conta por encomenda).

**6.2** `frontend/src/pages/esc/financeiro/ContasReceberSection.tsx` (novo)
- Mensalidade (reaproveita dados da Fase 4) + taxa de entrega (6.1).

---

### Fase 7 — Sangrias (histórico dedicado)

**7.1** `backend/app/routers/esc.py`
- Ajustar `GET /esc/financeiro/sangrias` (já existe, esboço) com `financeiro_scope()` e paginação (hoje é `LIMIT 200` fixo).

**7.2** `frontend/src/pages/esc/financeiro/SangriasSection.tsx` (novo)
- Tabela simples: Data/hora, Usuário, Valor, Justificativa.

---

## Fora de escopo deste plano

- Relatórios e Conciliação PIX (seções 2.9/2.10 da spec) — rodada própria.
- Geração automática (cron) de Contas a Pagar recorrente — a Fase 5 entrega o mecanismo manual; agendar fica pra depois se for necessário.
- Migração de dado legado (categoria/forma/permissão por associação → empresa).

## Rollback

- Fases 1-4, 6-7: só leitura/escopo/filtro — reverter é reverter o código (git), nenhum dado é apagado ou migrado.
- Fase 5 (única com schema): `DROP TABLE conta_pagar_baixas, contas_pagar, contas_pagar_templates` — aditivo, nada mais referencia essas tabelas, drop é seguro a qualquer momento.
- Cada fase é deployável e validável isoladamente (local → dry-run prod → deploy) antes de iniciar a próxima, mesmo padrão já usado nas Fases 9/11.
