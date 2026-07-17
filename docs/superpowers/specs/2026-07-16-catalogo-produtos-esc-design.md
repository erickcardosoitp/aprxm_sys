# Design — Catálogo de Produtos (ESC)

**Data:** 2026-07-16
**Depende de:** `docs/superpowers/specs/2026-07-15-governanca-empresa-esc-design.md` (empresas, associations.empresa_id)
**Status:** aprovado, aguardando plano de implementação

---

## 1. Objetivo

Hoje mensalidade, taxa de entrega e comprovante de residência são 3 mecanismos de precificação **completamente separados**, nenhum é "produto" de fato:

| Conceito | Onde vive hoje | Preço hoje |
|---|---|---|
| Mensalidade | tabela `mensalidades`, 1 linha por morador/mês | `association_settings.default_mensalidade_amount` (por associação) |
| Taxa de entrega | `packages.has_delivery_fee`/`delivery_fee_amount` | `settings.delivery_fee_default` — **config única do app inteiro**, env var, não varia por empresa/associação |
| Comprovante de residência | `association_settings.proof_stock` (só contador) | **sem persistência** — vem do `request body` (`ProofOfResidenceRequest.amount`), sem validação server-side |

Objetivo: criar `products`, cadastro gerido pelo **Escritório (ESC)**, dando autonomia pra criar/precificar esses 3 produtos padrão e qualquer produto acessório futuro, sem depender de deploy.

## 2. Regras de negócio confirmadas

- **Preço é por empresa** (1 valor padrão, ex.: SAPE inteira usa o mesmo). Associação não tem autonomia pra mudar preço nem regra.
- Ao criar produto, ESC pode restringir a associação(ões) específica(s); **default = vale para todas** as associações da empresa.
- Preço varia só no eixo **associado x não-associado** (mesmo padrão hoje usado por taxa de entrega e comprovante). Mensalidade não tem isenção/desconto persistente por morador.
- **Mensalidade é o produto carro-chefe.** Mensalidade, taxa de entrega e comprovante de residência são **produtos padrão** (comportamento automático, o sistema sabe gerar/cobrar sozinho). Qualquer outro produto criado pelo ESC é **acessório** — cadastro livre, sem gatilho automático, analisado separado em relatório.
- Taxa de entrega mantém a regra atual **inalterada**: cobrada automaticamente na entrega quando destinatário não é membro ativo **ou** está inadimplente (`has_delinquent_mensalidade`), exceto quando o mesmo entregador que recebeu também entrega (`same_deliverer`) ou há isenção (`skip_fee`/`delivery_exemption_tokens`). Associação não pode alterar essa regra.
- Estoque (entrada/saída com histórico) só existe hoje para **comprovante de residência**. Não é conceito genérico de produto.
- Migração é **100% aditiva** — nada é removido, renomeado ou desativado nesta fase. Lógica/colunas atuais (`default_mensalidade_amount`, `delivery_fee_default`, `proof_stock`, fallback `'2.50'` no frontend) continuam funcionando; a integração com `products` é incremental, feita na implementação.

## 3. Modelo de dados

```sql
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  codigo varchar(50) NOT NULL,
  descricao text NOT NULL,
  preco_associado numeric(10,2) NOT NULL,
  preco_nao_associado numeric(10,2) NOT NULL,
  tipo_sistema varchar(30),        -- preenchido = produto padrão ('mensalidade' | 'taxa_entrega' | 'comprovante_residencia')
                                    -- NULL = produto acessório (cadastro livre, sem gatilho automático)
  todas_associacoes boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

-- só pode existir 1 produto padrão ativo por (empresa, tipo_sistema) — senão o
-- job automático não sabe qual usar
CREATE UNIQUE INDEX ux_products_tipo_sistema
  ON products (empresa_id, tipo_sistema) WHERE tipo_sistema IS NOT NULL AND ativo;

CREATE TABLE product_associations (
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  association_id uuid REFERENCES associations(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, association_id)
);
-- só populada quando products.todas_associacoes = false (restrição específica).
-- todas_associacoes = true → ignora esta tabela, vale pra toda associação da empresa.

CREATE TABLE product_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  association_id uuid NOT NULL REFERENCES associations(id),  -- unidade de negócio
  tipo varchar(10) NOT NULL CHECK (tipo IN ('entrada','saida')),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  resident_id uuid REFERENCES residents(id),        -- pra quem (só saída por venda)
  transaction_id uuid REFERENCES transactions(id),  -- venda vinculada (rastreio financeiro)
  motivo text,                                       -- entrada (reposição) / ajuste sem venda
  created_by uuid NOT NULL REFERENCES users(id),     -- quem registrou
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mensalidades ADD COLUMN product_id uuid REFERENCES products(id);
ALTER TABLE transactions ADD COLUMN product_id uuid REFERENCES products(id);
```

Todas as colunas novas são nullable / tabelas novas são inertes — zero-downtime, segue o padrão de migração aditiva já usado nas Fases 1-9 de governança (`backend/app/main.py` `_run_migrations()`).

## 4. Consumidores existentes mapeados (impacto na implementação)

Levantamento feito no código atual, para nenhum ponto ficar esquecido na fase de implementação.

**Mensalidade** — leitura/escrita de `default_mensalidade_amount`: `routers/settings.py` (edição admin), `routers/governanca.py` + `services/association_provisioning_service.py` (provisionamento de associação nova), `routers/admin.py:469` (geração manual), `routers/mensalidades.py` (`/cron-generate`, job semanal — principal gerador), `routers/crm.py:1005` (cadastro de associado via portal do agente, já insere 1ª mensalidade). `services/mensalidade_service.py` consome `amount` já gravado por linha (não o setting global).

**Taxa de entrega** — `services/package_service.py:148-165` (`deliver_package`, ponto central de cobrança), `routers/finance.py:1368-1389` (estorno reverte pacote), `routers/packages.py:729-730` e `routers/residents.py:713-715` (zeragem em lote ao promover morador/editar pacote). Leitura em múltiplos dashboards/relatórios (`routers/packages.py`, `routers/reports.py`, `services/datalake_service.py`, `routers/financeiro.py` `SUBTYPE_MAP`). Frontend `PackagesPage.tsx` tem fallback hardcoded `'2.50'` (bug latente, não é bloqueante pra este spec).

**Comprovante de residência** — **2 pontos de baixa de estoque**, ambos precisam gravar em `product_stock_movements`: emissão normal (`services/finance_service.py:657-779`, `issue_proof_of_residence`) e geração em lote de comprovantes em branco (`routers/admin.py` `/admin/proof-of-residence/blank`). Preço hoje vem sempre do `request body`, sem validação — passa a ser calculado no backend a partir de `products.preco_*`.

**CRM** — único contato é mensalidade (cadastro de associado via portal). Confirmado: zero referência a taxa de entrega ou comprovante no CRM.

**Relatórios/Analytics** — `routers/financeiro.py` (`SUBTYPE_MAP` hardcoded), `services/datalake_service.py` (ETL para gold tables `daily_revenue`/receita-por-operador), planilha Excel/VBA externa (`docs/consolidado-excel/*.bas`) — todos leem `income_subtype` fixo. Este spec **não renomeia** `income_subtype`, então nenhum desses quebra; ganhar granularidade por produto nesses relatórios fica como melhoria futura, fora de escopo aqui.

**Constraint a revisar na implementação:** `chk_delivery_fee` (`has_delivery_fee`/`delivery_fee_amount` andam juntos) — decidir se `product_id` em `transactions` convive com ela ou se precisa de ajuste.

## 5. Fora de escopo (specs futuras)

- Cadastro dinâmico genérico (Fase 8c maior — Encomendas, OS, outros tipos de cadastro do sketch do ESC além de produto).
- Migração de dado: criar os 3 produtos padrão pra empresa SAPE, backfill de `product_id` em `mensalidades`/`transactions` existentes, integração de fato dos services (`mensalidade_service.py`, `package_service.py`, `finance_service.py`) para ler de `products` em vez das fontes atuais.
- Remoção/limpeza de código antigo (fallback hardcoded no frontend, `settings.delivery_fee_default`, etc.) — não faz parte desta migração aditiva.
- Ajuste de `chk_delivery_fee` e de `SUBTYPE_MAP`/ETL para granularidade por produto.

## 6. Critério de pronto (deste spec)

- Migration aditiva sobe em produção sem downtime (mesmo padrão de `_run_migrations()`): 4 objetos novos criados, 2 colunas nullable adicionadas, nenhuma coluna/tabela existente alterada ou removida.
- `schema_migrations` incrementa; nenhum fluxo atual (mensalidade, taxa de entrega, comprovante) muda de comportamento até que a fase de implementação ligue os pontos.
