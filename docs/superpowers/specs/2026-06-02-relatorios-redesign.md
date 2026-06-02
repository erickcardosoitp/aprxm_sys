# Spec: Redesign do Módulo de Relatórios

**Data:** 2026-06-02  
**Status:** Aprovado pelo usuário

---

## Problema

Dois problemas identificados pelos usuários:

**B — Não encontram o relatório certo.** Os módulos são nomeados por tipo de dado ("Mensalidades", "Entregas"), não pela pergunta do usuário. Quem quer ver inadimplência não sabe que precisa entrar em "Mensalidades". "Entregas" confunde com encomendas físicas.

**C — Filtros complexos.** Cada módulo exibe todos os filtros de uma vez (até 6 campos). Usuários que precisam de apenas 1-2 filtros são sobrecarregados.

---

## Solução: 3 mudanças independentes

### 1. Quick Reports no topo da página

Três cards de ação rápida **acima** dos módulos, com download direto (sem etapa de preview):

| Card | Filtro visível | Comportamento |
|---|---|---|
| ⚠️ Inadimplentes | Período (De / Até) | Download Excel com lógica do sistema: `type=member`, `status=active`, `grace 2d`, exclui `migration_payments` |
| 👥 Moradores Ativos | Nenhum (snapshot) | Download Excel: todos os moradores com `status=active` |
| 💰 Financeiro do Mês | Período (De / Até) | Download Excel: todas as transações do intervalo |

- Período padrão: primeiro dia do mês atual → hoje
- Nenhum dos três passa por preview — botão "↓ Baixar Excel" dispara o download diretamente
- Os cards usam os endpoints já existentes (`/reports/mensalidades`, `/reports/residents`, `/reports/finance`) com parâmetros pré-configurados

---

### 2. Renomeação dos módulos

| Nome atual | Novo nome | Subtítulo |
|---|---|---|
| Financeiro | Financeiro | — |
| Moradores | Moradores | — |
| Encomendas | Encomendas | — |
| Ordens de Serviço | Ordens de Serviço | — |
| Mensalidades | **Mensalidades / Inadimplência** | "inclui relatório de inadimplentes" |
| Entregas | **Produtividade da Equipe** | "tarefas, checklist, OS, demandas" |

Apenas mudança de label — nenhuma alteração no backend ou nos endpoints.

---

### 3. Progressive Disclosure nos filtros

Cada módulo exibe filtros em dois níveis. Ao trocar de módulo, os filtros avançados recolhem automaticamente.

**Filtros essenciais** (sempre visíveis):

| Módulo | Essenciais |
|---|---|
| Financeiro | Período (De/Até) |
| Moradores | Tipo (membro/visitante/dependente), Status |
| Encomendas | Período, Status |
| Mensalidades / Inadimplência | Período, Status |
| Ordens de Serviço | Período, Status |
| Produtividade da Equipe | Período, Colaborador |

**Filtros avançados** (ocultos por padrão, expandem via `+ Mais filtros`):

| Módulo | Avançados |
|---|---|
| Financeiro | Tipo (entrada/saída), Forma de pagamento |
| Moradores | Nome / CPF |
| Encomendas | Rua, CEP, Operadores |
| Mensalidades / Inadimplência | Mês de referência, Incluir inadimplentes históricos |
| Ordens de Serviço | Prioridade, Categoria |
| Produtividade da Equipe | Tipos de atividade |

**Indicador de filtros ativos:** se algum filtro avançado estiver preenchido, o link mostra `+ Mais filtros (N)` onde N é a contagem de avançados preenchidos.

---

## O que NÃO muda

- Backend: zero alterações nos endpoints `/reports/*`
- Fluxo de preview + export para relatórios nos módulos — mantido
- Toggle de colunas na tabela de preview — mantido
- Export por e-mail — mantido
- Todos os filtros existentes permanecem disponíveis (apenas reorganizados)

---

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `frontend/src/pages/reports/ReportsPage.tsx` | Quick Reports, renomeação, progressive disclosure |

Nenhuma mudança no backend.

---

## Critérios de sucesso

1. Usuário consegue baixar relatório de inadimplência em ≤ 2 cliques
2. Usuário consegue identificar o módulo correto pelo nome sem tentativa e erro
3. Cada módulo exibe ≤ 3 filtros visíveis por padrão
