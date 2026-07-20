# Design — Financeiro Centralizado no ESC

**Data:** 2026-07-20
**Depende de:** `2026-07-17-esc-associacao-login-design.md` (ESC como associação, `require_empresa_admin`), `2026-07-18-centralizacao-administrativa-esc-design.md` (`empresas.access_groups`)
**Status:** aprovado, aguardando plano de implementação

---

# Parte 1 — Mecânica de centralização

## 1. Objetivo

Hoje o módulo Financeiro (Dashboard, DRE, Movimentações, Conciliação PIX, Cobranças, Transferências/caixinhas, Relatórios) roda **por associação**, igual ao Caixa. Pra empresas com `empresas.financeiro_centralizado = true` (hoje só SAPE), isso muda:

- **Caixa continua na associação** — abrir/fechar sessão, lançar transação, sangria, conferência: sem mudança nenhuma.
- **Financeiro inteiro sai da associação e vira exclusivo do ESC** — consolidado (todas as unidades da empresa) com filtro por unidade. Associação não tem mais acesso a nenhuma tela do Financeiro, nem pra ver (não é "read-only local" — é zero acesso).
- Empresas com o flag `false` continuam exatamente como hoje (Financeiro na própria associação). Nada muda pra Vaz Lobo/Congonha se não estiverem com o flag ligado.

`empresas.financeiro_centralizado` já existe (boolean, criado com a SAPE, hoje não lido por nenhum código) — vira a chave desta feature. **A mecânica de centralização em si (Parte 1) não precisa de nenhuma migração de schema** — a única migração de toda esta spec é a de Contas a Pagar (Parte 2, seção 2.6, schema novo).

## 2. Mecânica de dados — não muda

Conferido no código: Financeiro não guarda dado próprio. Todas as telas leem as mesmas tabelas que o Caixa já escreve (`transactions`, `cash_sessions`, via `cash_session_id`) — é relatório/analytics em cima do Caixa, não uma cópia. A conferência de caixa já vive hoje inteiramente no Caixa (`finance.py` + `FinancePage.tsx`), não no Financeiro — nada a mover aí.

Centralizar não muda esse mecanismo. Muda só **de onde** essa leitura pode ser feita e **quantas unidades** ela agrega. Uma mensalidade paga e conferida no caixa da Monique continua aparecendo no Financeiro exatamente como hoje — só que agora esse Financeiro só é visível de dentro do ESC.

## 3. Escopo backend

Levantamento real do que hoje faz parte do módulo Financeiro (9 abas do frontend) e escopa só por `association_id`:

| Aba (frontend) | Router backend | Ocorrências `association_id` |
|---|---|---|
| Dashboard, DRE, Extrato, Conciliação PIX/Inteligente, Evolução, Fluxo projetado | `financeiro.py` | 61 |
| Cobranças (gerar mês, avançar, cobrar) | `mensalidades.py` | 46 |
| Transferências (caixinhas, repasses, sangria) | `cash_boxes.py` | 29 |
| Relatórios (`/reports/finance`, `/reports/mensalidades`) | `reports.py` | 23 |

(`transfers.py` — transferência de saldo *entre associações* — é feature separada, não usada por nenhuma aba do Financeiro; fora de escopo.)

**Resolver único** (`app/core/tenant.py`, ao lado de `scoped_ids()`):
- Empresa com `financeiro_centralizado=true` **e** chamador ESC-stationed (`association_id == empresa_id`) **e** com permissão de módulo (seção 4) → resolve pra todos os `association_id` da empresa, ou só 1 se vier `?unidade=` na query.
- Empresa com `financeiro_centralizado=true` **e** chamador é usuário de associação (não ESC) → 403 em qualquer endpoint dos 4 routers acima. Caixa (`finance.py`) não é afetado — continua liberado.
- Empresa com `financeiro_centralizado=false` (ou sem empresa) → comportamento atual, inalterado.

Nos 4 arquivos, troca sistemática de `WHERE association_id = :aid` por `WHERE association_id = ANY(:ids)` (com `:ids` vindo do resolver), preservando toda a lógica de negócio (DRE, heurística de conciliação PIX, geração de mensalidade, etc.) — sem reescrever regra, só o filtro de tenant.

## 4. Permissão dentro do ESC

Hoje `require_empresa_admin` (o guard de todo `/esc/*`) só deixa passar `admin_master`/`superadmin` — não muda nesta feature. Dentro desse universo, nem todo admin_master deveria necessariamente ver Financeiro (ex.: um admin_master de uma unidade específica vs. o financeiro do grupo todo).

Reaproveita o grid de permissões já existente (`empresas.access_groups`, tela "Permissões" do Fase 11, já em uso) — hoje é só um editor, sem enforcement em lugar nenhum. Este é o primeiro módulo a de fato aplicar essa permissão:

- Adiciona chave `"financeiro"` em `_DEFAULT_ACCESS_GROUPS` (`esc.py`) pra cada cargo do template.
- Novo dependency `require_esc_module("financeiro")`: exige `require_empresa_admin` **e** `"view"` em `access_groups[current.role]["financeiro"]` (cai no `_DEFAULT_ACCESS_GROUPS` se a empresa não tiver customizado). Guarda os endpoints novos de Financeiro-ESC.
- Escopo contido: só o módulo `financeiro` ganha enforcement agora. Os módulos já existentes no grid (`residents`, `packages`, etc.) continuam sem enforcement — fica registrado como gap separado, não mexo aqui.
- Se no futuro outros cargos (conselho, diretoria) ganharem estação no ESC, o mesmo enforcement já vale pra eles automaticamente — não precisa de mudança adicional.

## 5. Estorno a partir do Financeiro — devolução

Hoje `reverse_transaction` (`finance_service.py:450`) sempre prende o estorno a uma sessão de caixa **aberta** — se a sessão original já estiver fechada/conferida, ele ignora isso e anexa o estorno em **qualquer sessão aberta hoje** da associação (ou falha, se não houver nenhuma aberta). Isso é enganoso: mexeria no saldo físico do caixa de hoje por causa de um lançamento antigo já conferido, quando na prática **não há dinheiro saindo de caixa nenhum** — é uma devolução contábil.

**Regra nova:**
- Sessão original **aberta** → comportamento atual, sem mudança (estorno anexado à mesma sessão, ajusta o saldo físico dela — caso do dia a dia, "lancei errado, ainda no mesmo caixa").
- Sessão original **fechada ou conferida** (ou sem sessão) → **devolução**: o estorno é criado com `cash_session_id = NULL`, sem tentar anexar a nenhuma sessão aberta. Não mexe no saldo de nenhum caixa — só entra como lançamento negativo no faturamento.
- Já confirmado no código: o DRE (`financeiro.py /dre`) já agrupa e soma corretamente transações com `cash_session_id IS NULL` (via `LEFT JOIN cash_sessions` + grupo "Manual / Sem caixa", mecanismo que já existe hoje) — nenhuma mudança necessária ali, só no `finance_service.py` pra parar de forçar uma sessão aberta quando a original não está mais aberta.
- Vale pra estorno feito de qualquer lugar (Caixa ou Financeiro) — na prática só vira relevante a partir do ESC, porque é lá que sobra acesso a lançamentos antigos já conferidos pra estornar.
- Fora de escopo: reverter `mensalidades.status` pra `pending` ao devolver (gap que já existe hoje em qualquer estorno de mensalidade, não introduzido por esta mudança — fica registrado, não mexo aqui).

## 6. Frontend

- **Associação:** hoje o item de menu "Financeiro" usa a mesma permissão de módulo (`'finance'`) do Caixa (`AppShell.tsx`). Passa a ter uma condição extra: some do menu (e a rota redireciona) quando `empresa.financeiro_centralizado === true`, independente de permissão de cargo. Caixa continua usando só `'finance'`, sem mudança.
- **ESC:** novo módulo "Financeiro" no sidebar do ESC, visível só quando `financeiro_centralizado=true` **e** com `financeiro:view` (seção 4) — sem o flag, não há o que consolidar; item some do sidebar do ESC também. Estrutura de seções do módulo (o que reaproveita de cada aba atual e o que é novo): ver **Parte 2**. Todo endpoint reaproveitado troca a fonte de dados (agregado da empresa) e ganha um seletor de unidade (Todas / unidade específica) plugado no `?unidade=` do resolver.

## 7. Fora de escopo

- Migração de dado legado de categoria/forma de pagamento/permissão por associação pra empresa (já registrada como pendência separada).
- Enforcement geral do `access_groups` pros módulos além de `financeiro`.
- Qualquer mudança em `require_empresa_admin` (quem entra no ESC) — só quem já entra hoje continua entrando.
- `transfers.py` (transferência de saldo entre associações) — feature à parte.
- Empresas com `financeiro_centralizado=false` — zero mudança de comportamento.
- Reverter status de mensalidade ao devolver (seção 5) — gap pré-existente, não introduzido aqui.

## 8. Critério de pronto

- Usuário de associação (Vaz Lobo/Congonha, SAPE) não vê mais "Financeiro" no menu nem consegue chamar os 4 routers acima (403); Caixa funciona normal.
- ESC (admin_master com `financeiro:view`) vê Financeiro consolidado (todas unidades) e filtrado por unidade, com as seções da Parte 2 funcionando sem regressão frente ao que existe hoje nas abas de origem.
- Admin_master do ESC sem `financeiro:view` no grid não vê o módulo.
- Empresa sem o flag (qualquer uma além da SAPE hoje) continua 100% como está.
- Estornar um lançamento de sessão já conferida não altera saldo de nenhum caixa; aparece no DRE como devolução (faturamento negativo).

---

# Parte 2 — Estrutura do módulo

Organização interna do Financeiro, definida seção por seção. Levantamento contra o código atual (via investigação dedicada) pra não inventar fonte de dado — cada item abaixo diz o que já existe (reaproveita) e o que é novo. **Seções 9 e 10 ficam de fora desta rodada** (relatórios e conciliação PIX precisam de discussão própria, por pedido explícito) — não bloqueiam o resto.

## 2.1 Fluxo de Caixa

Saldo atual + total entrou + total saiu + sangrias/despesas — mesmos agregados já calculados no Dashboard atual (`financeiro.py`), só entram no escopo de empresa (Parte 1).

**Zerar caixa (botão ADMIN):** não é endpoint novo — atalho de UI que chama `POST /finance/sessions/sangria` (já existe) com `amount` pré-preenchido = saldo disponível da sessão e motivo padrão "Zeramento administrativo" (editável). Continua exigindo foto de recibo, como toda sangria hoje.

## 2.2 Movimentações

- Base: `GET /finance/transactions` (`finance.py:953`), com o resolver de empresa da Parte 1. JOIN com `residents` já existe na query — só falta incluir `address_street` no SELECT (sem JOIN novo).
- Filtro "grupo de usuário" → **não existe grupo no sistema**, só `role` (cargo). Filtro sai como "cargo", sobre o mesmo enum já usado (`conferente`, `admin`, `admin_master`, etc.).
- Filtro "inadimplente (sim/não)" → calculado on-the-fly no momento da consulta (join com `mensalidades` pela competência mais próxima da data da transação) — não é campo salvo, não existe hoje.
- Filtro "período" ganha "trimestre" (hoje o seletor só tem semana/mês/ano).
- Filtro "produto" = `income_subtype` (mensalidade, taxa de entrega, comprovante de residência, outras) — já existe como coluna, só falta expor como filtro de múltipla escolha.
- Colunas: Data/hora, Tipo Movimentação, Associação, Morador, Valor, Produto, Status Morador (member/guest), Usuário — todas já vêm ou são deriváveis do SELECT atual.
- Export xlsx com os filtros aplicados — endpoint novo (gera arquivo a partir da mesma query, sem paginação).
- Modal de consulta — reaproveita os dados já retornados pela linha da tabela; exportar como PNG é renderização client-side (ex: html2canvas), sem necessidade de gerar imagem no backend.

## 2.3 CRM (mensalidade)

Só mensalidade (taxa de entrega vai em Contas a Receber, seção 2.7 — são bases separadas, confirmado).

- **Associados:** `GET /residents?type=member` (já existe) + resumo de mensalidade por morador.
- **A receber / Inadimplentes / Pagos:** adapta `GET /mensalidades/pending`, `/delinquent`, `/paid` (já existem, `mensalidades.py`) pro escopo de empresa.
- **Novo (não existe hoje):** agregação de "R$ atrasado" + "qtd. meses atrasado" **por morador** — hoje `list_delinquent` só calcula por linha/competência (um morador com 3 meses atrasados aparece em 3 linhas). Query nova: `GROUP BY resident_id`, `SUM(amount)`, `COUNT(*)` sobre a mesma regra oficial de atraso (`grace_cutoff`, `mensalidade_service.py` — não a regra simplificada de `get_resident_payment_history`, que é diferente e não deve ser usada aqui).
- **"Associado a" (meses):** não existe campo dedicado — reaproveita a convenção já usada no código, `COALESCE(move_in_date, created_at::date)`.
- **"Ações/mês"** (métrica nova, confirmada): soma de 3 eventos do morador naquele mês — mensalidade paga (`transactions.income_subtype='mensalidade'`) + encomendas retiradas (`packages` status entregue) + comprovantes de residência emitidos (`transactions.income_subtype='proof_of_residence'`) — e exibe a **média móvel** desses totais mensais (proponho janela de 6 meses; ajustável se quiser outra).
- **"Encomendas/mês"**: mesma lógica de média, só a perna de encomendas.
- **"Data da última encomenda retirada"**: `MAX(packages.delivered_at ou equivalente)` já disponível na tabela `packages`.
- Filtros: nome, rua, tempo associado, status, min/max R$ atrasado, qtd. meses atrasado, dependentes (sim/não — via `residents.type='dependent'` vinculado), forma de pagamento recorrente (**novo**: moda/forma mais frequente dos pagamentos do morador nos últimos N meses).

## 2.4 Sessões de Caixa

Recomendação sobre a quantidade de colunas (pedido explícito): **segmentar**, mesmo padrão do modal de Movimentações —

- **Tabela principal:** Data/hora, Associação, Usuário, R$ Entradas, R$ Saídas, R$ Líquido, Conferido por, Ações.
- **Modal "consultar sessão":** Aberto em / Fechado em, R$ Estornos, Qtd. mensalidades pagas, R$ Bruto PIX, R$ Bruto Dinheiro, Sobra/Falta (conferência cega), Quebra de caixa, Origem.

Fonte: `list_sessions` (`finance_service.py:1119`) já calcula bruto PIX/dinheiro/baixas/despesas. **Novo:** líquido por sessão (hoje só existe calculado globalmente no esteira — vira `bruto - baixas` por sessão), e qtd. de mensalidades pagas por sessão (`JOIN mensalidades ON transaction_id = t.id WHERE cash_session_id = :sid`, não existe hoje).

"Quebra de caixa" e "sobra/falta" já existem como colunas reais em `cash_sessions` (`quebra_caixa`, `difference`, `blind_pix`, `blind_dinheiro`, `dinheiro_contado`, `pix_contado` — algumas só via SQL cru, o model SQLModel está desatualizado, mesma convenção do resto do arquivo). **Não** existe equivalente operacional de "quebra de caixa" fora dessas colunas — as tabelas `cash_breaks`/`cash_session_anomalies` vistas na base analítica são só Gold/Parquet (R2), não Postgres — usar sempre a coluna operacional.

"Origem" reaproveita `cash_sessions.origin` — hoje só assume "Sessão de Caixa" (normal) ou "Manual" (sessão retroativa); não existe presencial/remoto.

Filtra sempre `status='conferido'`. Ações: reverter (regra de devolução, Parte 1 seção 5), reabrir (`revert_conferencia`, já existe), 2ª via (`generate_conferencia_pdf`, já existe).

## 2.5 DRE

Sem mudança de mecânica — `/financeiro/dre` já suporta 1-3 níveis (`nivel` já é parâmetro). Só entra no escopo de empresa (Parte 1).

## 2.6 Contas a Pagar (novo — única parte desta spec com migração de schema)

Confirmado: não existe nada parecido hoje (só `transactions type=expense` avulsa, sem vencimento). Suporta manual **e** recorrente, com baixa parcial (conforme decidido):

```sql
CREATE TABLE contas_pagar_templates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id UUID NOT NULL REFERENCES associations(id),
    category_id    UUID REFERENCES transaction_categories(id),
    name           TEXT NOT NULL,
    amount         NUMERIC(12,2) NOT NULL,
    due_day        INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by     UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contas_pagar (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id  UUID NOT NULL REFERENCES associations(id),
    template_id     UUID REFERENCES contas_pagar_templates(id),  -- NULL = avulsa
    category_id     UUID REFERENCES transaction_categories(id),
    description     TEXT NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0,
    due_date        DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | partial | paid
    reference_month TEXT,                              -- 'YYYY-MM', preenchido quando gerado por template
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conta_pagar_baixas (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conta_pagar_id UUID NOT NULL REFERENCES contas_pagar(id),
    transaction_id UUID REFERENCES transactions(id),
    amount         NUMERIC(12,2) NOT NULL,
    paid_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID REFERENCES users(id)
);
```

- Cada baixa gera uma `transactions` normal (`type=expense`) com `cash_session_id = NULL` por padrão — **mesmo mecanismo "sem caixa" da devolução** (Parte 1, seção 5): não é sangria nem afeta saldo físico de nenhuma sessão, só reduz faturamento no DRE (já cai naturalmente no grupo "Manual / Sem caixa" que já existe). Se excepcionalmente pago via caixa físico, pode informar uma sessão aberta (mesmo padrão de despesa normal).
- `amount_paid` soma as baixas; `status` recalculado a cada baixa: `pending` (amount_paid=0) → `partial` (0 < amount_paid < amount) → `paid` (amount_paid >= amount). "Atrasada" é computado (`due_date < hoje AND status != 'paid'`), não é status persistido — mesmo padrão já usado em mensalidade.
- Recorrente: template gera 1 `conta_pagar` por mês no `due_day` configurado (mesmo padrão de `generate-month` de mensalidade) — geração fica pro plano de implementação (cron/endpoint manual, a definir lá).

## 2.7 Contas a Receber

Mensalidade (reaproveita a mesma base do CRM, seção 2.3) + taxa de entrega de morador não-associado.

**Regra de previsão da taxa de entrega** (confirmada contra o código — `bulk_deliver_packages`, `packages.py:240`, já cobra 1 taxa por retirada, não por encomenda): contar **1 × R$2,50 por morador não-associado com pelo menos 1 encomenda pendente** (`has_delivery_fee=true`, ainda não entregue) — não multiplicar por quantidade de encomendas paradas. Se o morador virar associado, some do "a receber" (deixa de gerar taxa).

## 2.8 Sangrias

Histórico dedicado, `type='sangria'` (já existe, só filtra). Colunas: Data/hora, Usuário, R$ Valor, Justificativa (`sangria_reason`, texto livre — `sangria_reasons` só existe agregado na base analítica, não como tabela operacional).

## 2.9 Relatórios — em aberto

Fica pra rodada própria, por pedido explícito ("vamos pensar em relatórios pra montar, filtrar e extrair excel"). Não bloqueia as demais seções.

## 2.10 Conciliação PIX — em aberto

Fica pra rodada própria, por pedido explícito ("precisamos bolar uma estratégia sobre isso"). Não bloqueia as demais seções.

## 2.11 Fora de escopo (Parte 2)

- Recorrência de Contas a Pagar gerando automaticamente sem ação humana (cron) — mecanismo de geração entra no plano de implementação, não no design.
- Corrigir a divergência de regra de inadimplência em `get_resident_payment_history` (achada durante o levantamento) — fica registrada, não é desta feature.
- Corrigir `sangria_destination` não ser FK de `sangria_destinations` (achado durante o levantamento) — idem, fica registrado.
- Atualizar o model SQLModel de `CashSession` pra incluir as colunas hoje só via `ALTER TABLE` cru — cleanup separado.

## 2.12 Critério de pronto (Parte 2)

- Fluxo de Caixa, Movimentações, CRM, Sessões de Caixa, DRE, Contas a Pagar, Contas a Receber e Sangrias funcionando no ESC, consolidados por empresa e filtráveis por unidade.
- Contas a Pagar aceita lançamento manual e recorrente, baixa parcial, e baixa não mexe em saldo de caixa nenhum.
- CRM mostra R$ atrasado e Ações/mês corretos por morador (agregado, não por linha).
- Contas a Receber (taxa de entrega) reflete 1 cobrança por morador não-associado com encomenda parada, não por encomenda.
