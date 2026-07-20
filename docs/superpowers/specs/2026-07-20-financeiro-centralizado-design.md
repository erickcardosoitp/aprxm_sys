# Design — Financeiro Centralizado no ESC

**Data:** 2026-07-20
**Depende de:** `2026-07-17-esc-associacao-login-design.md` (ESC como associação, `require_empresa_admin`), `2026-07-18-centralizacao-administrativa-esc-design.md` (`empresas.access_groups`)
**Status:** aprovado, aguardando plano de implementação

---

## 1. Objetivo

Hoje o módulo Financeiro (Dashboard, DRE, Movimentações, Conciliação PIX, Cobranças, Transferências/caixinhas, Relatórios) roda **por associação**, igual ao Caixa. Pra empresas com `empresas.financeiro_centralizado = true` (hoje só SAPE), isso muda:

- **Caixa continua na associação** — abrir/fechar sessão, lançar transação, sangria, conferência: sem mudança nenhuma.
- **Financeiro inteiro sai da associação e vira exclusivo do ESC** — consolidado (todas as unidades da empresa) com filtro por unidade. Associação não tem mais acesso a nenhuma tela do Financeiro, nem pra ver (não é "read-only local" — é zero acesso).
- Empresas com o flag `false` continuam exatamente como hoje (Financeiro na própria associação). Nada muda pra Vaz Lobo/Congonha se não estiverem com o flag ligado.

`empresas.financeiro_centralizado` já existe (boolean, criado com a SAPE, hoje não lido por nenhum código) — vira a chave desta feature. **Nenhuma migração de schema é necessária.**

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

## 5. Frontend

- **Associação:** hoje o item de menu "Financeiro" usa a mesma permissão de módulo (`'finance'`) do Caixa (`AppShell.tsx`). Passa a ter uma condição extra: some do menu (e a rota redireciona) quando `empresa.financeiro_centralizado === true`, independente de permissão de cargo. Caixa continua usando só `'finance'`, sem mudança.
- **ESC:** novo módulo "Financeiro" no sidebar do ESC, visível só quando `financeiro_centralizado=true` **e** com `financeiro:view` (seção 4) — sem o flag, não há o que consolidar; item some do sidebar do ESC também. Reaproveita as 9 abas existentes como estão (`DRETab`, `MovimentacoesTab`, `ConciliacaoTab`, `ConciliacaoInteligente`, `EsteiraTab`, `CobrancasTab`, `TransferenciasTab`, `RelatoriosTab`, `DashboardTab`) — sem reescrever nenhuma; só troca a fonte de dados (endpoints já devolvendo o agregado da empresa) e adiciona um seletor de unidade (Todas / unidade específica) no topo, plugado no `?unidade=` do resolver.

## 6. Fora de escopo

- Migração de dado legado de categoria/forma de pagamento/permissão por associação pra empresa (já registrada como pendência separada).
- Enforcement geral do `access_groups` pros módulos além de `financeiro`.
- Qualquer mudança em `require_empresa_admin` (quem entra no ESC) — só quem já entra hoje continua entrando.
- `transfers.py` (transferência de saldo entre associações) — feature à parte.
- Empresas com `financeiro_centralizado=false` — zero mudança de comportamento.

## 7. Critério de pronto

- Usuário de associação (Vaz Lobo/Congonha, SAPE) não vê mais "Financeiro" no menu nem consegue chamar os 4 routers acima (403); Caixa funciona normal.
- ESC (admin_master com `financeiro:view`) vê Financeiro consolidado (todas unidades) e filtrado por unidade, com as 9 abas atuais funcionando sem regressão.
- Admin_master do ESC sem `financeiro:view` no grid não vê o módulo.
- Empresa sem o flag (qualquer uma além da SAPE hoje) continua 100% como está.
