# Design — Ambiente Escritório

**Data:** 2026-05-03  
**Status:** Aprovado  
**Autor:** erickxc

---

## Contexto

O APRXM opera com duas associações independentes: Vaz Lobo e Congonha. O cofre físico (espécie) e a conta PIX são compartilhados entre ambas. O ambiente **Escritório** é um tenant agregador de consulta estratégica, com uma única operação de escrita: o Inventário Financeiro.

---

## Seção 1 — Modelo de Dados

### `associations` — nova coluna

```sql
is_office BOOLEAN NOT NULL DEFAULT FALSE
inventory_day_of_month SMALLINT  -- 1-28
```

### Nova tabela `inventory_records`

```sql
id                UUID PRIMARY KEY
association_id    UUID NOT NULL FK → associations  -- sempre o Escritório
pix_counted       NUMERIC(12,2) NOT NULL
cash_counted      NUMERIC(12,2) NOT NULL
total_counted     NUMERIC(12,2) NOT NULL  -- pix + cash
expected_total    NUMERIC(12,2) NOT NULL  -- snapshot no momento da conclusão
difference        NUMERIC(12,2) NOT NULL  -- total_counted - expected_total
justification     TEXT NOT NULL
signed_by         UUID NOT NULL FK → users
signed_at         TIMESTAMPTZ
status            ENUM('draft', 'concluded', 'cancelled')
cancelled_by      UUID FK → users
cancelled_at      TIMESTAMPTZ
reference_month   DATE NOT NULL  -- mês de referência (primeiro dia do mês)
created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
```

### Regras de integridade

- Um único inventário `draft` ou `concluded` por `reference_month` por Escritório
- `expected_total` é snapshot gravado na conclusão (imutável após isso)
- Registro cancelado permanece no histórico com `status = 'cancelled'`

---

## Seção 2 — Autenticação & Controle de Acesso

### JWT do Escritório

Payload inclui `is_office: true`, `is_aggregator: true`, `linked_association_ids: [uuid_vaz_lobo, uuid_congonha]`.

### Roles autorizadas para inventário

| Operação | Roles |
|---|---|
| Consultar qualquer módulo | todas |
| Criar / concluir / cancelar inventário | conferente, diretoria, conselho, admin |
| Ver painel de sincronização | todas |

### Guard de proteção

`OfficeReadOnlyGuard` bloqueia POST/PATCH/DELETE quando `is_office = true`, exceto:
- `POST /inventory` (criar/concluir)
- `PATCH /inventory/{id}/cancel`

---

## Seção 3 — Fluxo do Inventário Financeiro

### Criação automática

Job diário verifica se hoje é o `inventory_day_of_month` da associação Escritório. Se sim, cria `inventory_record` com `status = 'draft'`. Idempotente — não duplica se já existe draft/concluded no mês.

### Fluxo do usuário

1. Usuário abre o draft do mês
2. Informa `pix_counted` + `cash_counted`
3. Sistema exibe em tempo real:
   - `expected_total` = soma dos saldos esperados de Vaz Lobo + Congonha
   - `difference` = `total_counted - expected_total`
   - Badge: "Sobra de R$X", "Falta de R$X" ou "Cofre equilibrado"
4. Usuário preenche justificativa (obrigatória)
5. Usuário assina → `status = 'concluded'`, `signed_by`, `signed_at`, `expected_total` gravados (imutável)

### Cancelamento

- Qualquer role autorizada pode cancelar
- `status → 'cancelled'`, `cancelled_by` + `cancelled_at` gravados
- Libera criação de novo inventário para o mesmo mês
- Registro cancelado permanece para auditoria

---

## Seção 4 — Painel de Sincronização

### Como funciona

Não é sincronização real (mesmo banco). É verificação de integridade: queries leves executadas a cada acesso ao painel para cada associação vinculada.

### Indicadores

| Estado | Cor | Critério |
|---|---|---|
| Sincronizado | verde | dados acessíveis, sem anomalia |
| Atenção | amarelo | sessão aberta há +24h ou sem transações nos últimos 30 dias |
| Divergência | vermelho | erro de query ou associação inacessível |

### Resumo visual (sempre visível)

Por associação: total de moradores, encomendas ativas, saldo esperado, timestamp da última transação.

### Detalhe por módulo (ao clicar)

- **Moradores:** total, ativos, inadimplentes
- **Encomendas:** pendentes, entregues no mês
- **Financeiro:** saldo esperado, última sessão fechada, transações do mês

---

## Seção 5 — Frontend

### Diferenciação visual

- Tema distinto: cor primária neutra/institucional
- Header com badge "Escritório" + nomes das associações vinculadas
- Sidebar sem botões de operação (apenas navegação)

### Estrutura de navegação

```
Escritório
├── Visão Geral         ← painel de sincronização + resumo consolidado
├── Financeiro          ← consulta consolidada (read-only)
│   └── Inventário      ← única operação de escrita
├── Moradores           ← consulta consolidada
├── Encomendas          ← consulta consolidada
├── Usuários            ← consulta consolidada
└── Mapa de Associados  ← visualização consolidada
```

### Consultas consolidadas

- Coluna "Associação" em todas as listagens indicando origem (Vaz Lobo / Congonha)
- Filtro por associação ou visão unificada
- Sem botões de ação (criar, editar, deletar)

### Página de Inventário

- Histórico de inventários anteriores (concluded + cancelled)
- Botão "Iniciar Inventário" visível apenas quando existe draft do mês corrente
- Formulário com cálculo em tempo real da diferença

---

## Dependências Técnicas

- Migration: `is_office` + `inventory_day_of_month` em `associations`
- Migration: tabela `inventory_records`
- Backend: `OfficeReadOnlyGuard`
- Backend: `InventoryService` (criar, concluir, cancelar, listar)
- Backend: `SyncPanelService` (queries de integridade)
- Backend: job agendado para criação automática do draft mensal
- Frontend: tema alternativo para `is_office`
- Frontend: componentes de consulta consolidada (com coluna Associação)
- Frontend: página de Inventário Financeiro
- Frontend: painel de sincronização
