# Relatório Técnico Completo — APRXM (Aproxima)
## Histórico de Desenvolvimento: Abril – Junho 2026

**Projeto:** APRXM — ERP/SaaS Multi-tenant para associações de moradores  
**Cliente:** Instituto Tia Pretinha (Congonha + Vaz Lobo)  
**Stack:** Python 3.13 / FastAPI / SQLModel / PostgreSQL (Neon) / React 18 / Vite / Tailwind  
**Deploy:** Vercel · Cloudflare R2 · Neon Serverless · Supabase Storage

---

## Índice

1. [Módulo Financeiro](#1-módulo-financeiro)
2. [Módulo de Moradores](#2-módulo-de-moradores)
3. [Módulo de Encomendas](#3-módulo-de-encomendas)
4. [Módulo de Tarefas Diárias](#4-módulo-de-tarefas-diárias)
5. [Módulo de Ordens de Serviço](#5-módulo-de-ordens-de-serviço)
6. [Módulo de Relatórios](#6-módulo-de-relatórios)
7. [Módulo Simplifica](#7-módulo-simplifica)
8. [Painel de TI](#8-painel-de-ti)
9. [Data Lake & ETL](#9-data-lake--etl)
10. [Dashboard Power BI](#10-dashboard-power-bi)
11. [Segurança](#11-segurança)
12. [Infraestrutura & CI/CD](#12-infraestrutura--cicd)
13. [Bugs Críticos Corrigidos](#13-bugs-críticos-corrigidos)

---

## 1. Módulo Financeiro

### Features Implementadas
- **Módulo FinanceiroPage completo** — refatoração de 3.920 linhas em abas independentes com contexto global
- **Endpoint `/finance/sessions/open-picker`** — seletor de sessão aberta para operadores
- **`send_to_malote`** — router + service layer completo para transferência de valores ao malote
- **Endpoint conferência de caixa** — múltiplos tipos de relatório, atribuição de quebras
- **Descritores de transação** — formato padronizado `"Mensalidade Mai/2026 — Nome"` em todas as transações
- **Cron `/finance/transactions/reminders`** — proteção por `CRON_SECRET` no header
- **Endpoint `/delinquent/by-street`** — relatório de inadimplentes agrupados por rua
- **GeralPage modo Escritório** — detecta `isOffice` no JWT e exibe painel específico
- **Alterar vencimento mensalidade** — novo dia (1–31) atualiza perfil do morador e cobranças pendentes
- **Session picker** — `/finance/sessions/open-picker` para operadores não-gerentes
- **Inventário financeiro** — `inventory_day_of_month`, controle de saldo esperado vs contado
- **Checkbox "Quebra Identificada"** — dropdown de atribuição por associação com justificativa obrigatória

### Bugs Corrigidos
| Bug | Impacto | Causa Raiz |
|---|---|---|
| `is_cofre = false` nos dois cofres | Cofre zerado no sistema | Flag incorreta no banco — corrigida diretamente |
| `reissue_proof_of_residence` mudava status silenciosamente | Comprovante reemitido com status errado | Parâmetro `isento` não propagado |
| Float em vez de Decimal em `perform_sangria` / `transfer_to_cashbox` | Arredondamento incorreto em valores monetários | Tipo Python `float` substituído por `Decimal` |
| `reopen` não restaurava `closed_by` | Violava constraint `NOT NULL` no banco | Campo omitido no UPDATE |
| `total_expense` não calculado no backend | Saldo do caixa errado no frontend | Soma omitida na query de resumo da sessão |
| Lançamento offline não quitava mensalidade | Pagamento registrado mas dívida permanecia ativa | Falta de `UPDATE mensalidades SET status='paid'` após inserção |
| Inventário com sessões abertas em outra associação | Inventário iniciado em estado inconsistente | Sem verificação de sessões abertas antes de criar |
| Transações antigas sem `resident_name` | Join ausente no endpoint `/sessions/transactions` | LEFT JOIN `residents` não estava na query |
| KPI delinquentes com 2026-04 como pendente | Inadimplência inflada por entradas sem subtype | Filtro `income_subtype IS NOT NULL` faltando |

### Melhorias
- Reopen session: restauração completa do estado anterior
- Exceções específicas em `current_session`, `register_transaction`, `conferencia_caixa` (antes genéricas)
- Atribuição de quebra sempre à associação responsável (nunca ao Escritório)

---

## 2. Módulo de Moradores

### Features Implementadas
- **Tipo `dependent` (Dependente)** — novo enum + model + endpoints CRUD
- **Endpoint `/residents/kpis`** — KPIs por tipo com `COUNT(*)` SQL (não `data.length`)
  - Retorna `total`, `sem_cep`, `sem_telefone`, `sem_cpf`, `inadimplentes`
- **Merge de moradores** — endpoint `DELETE /residents/{id}/merge` para consolidação de duplicatas
- **Busca por CEP/rua antes de cadastrar** — validação para evitar duplicatas em encomendas
- **Endpoint `/residents/search`** com parâmetro `street` (opcional)
- **Verificação de delinquência** — `GET /residents/{id}/delinquency-check`
- **Migração editável** — badge + botão Editar inline em registros de migração

### Bugs Corrigidos
| Bug | Impacto | Causa Raiz |
|---|---|---|
| Badge "Visitantes 200" com 706 visitantes | Contagem truncada pelo limit de paginação | `loadCounts` usava `data.length` em vez de `COUNT(*)` |
| Campo Logradouro ausente no form de visitante | Rua não preenchida automaticamente pelo CEP | `address_street` setado no state mas sem input no JSX |
| Lookup CEP direto no browser | CORS / timeout causavam erros para usuários | Redirecionado para proxy backend com fallback BrasilAPI |
| `responsible_id: ''` enviado no PUT | Pydantic rejeitava string vazia como UUID | Frontend convertendo `''` para `null` antes do request |
| Badge mostrando "200" em vez de total real | Paginação corta em 50 no GET /residents | `loadCounts` migrado para `/residents/kpis` com SQL COUNT |
| Form de visitante sem campo de logradouro | Rua não era exibida após lookup de CEP | Campo adicionado entre Complemento e Bairro |
| Dropdown morador cortado por `overflow-hidden` | Dropdown inacessível em mobile | z-index e container pai corrigidos |
| `inadimplencia_history` incluía migration_payments | Inadimplência inflada com pagamentos já cobertos | Filtro `NOT EXISTS (migration_payments)` adicionado |

### Melhorias
- **Paginação de 50 por página** — `limit`/`offset` em `GET /residents`
- **Botão "Carregar mais"** com offset progressivo
- **`useMemo` no `displayedTasks`** — sort/filter recalculado apenas quando necessário
- Normalização de nomes de rua: `_normalize_street()` (strip + title case)
- Auditoria de 21 moradores com ruas incorretas — relatório entregue ao admin

---

## 3. Módulo de Encomendas

### Features Implementadas
- **Endpoint `GET /packages/by-address`** — encomendas aguardando retirada agrupadas por rua/CEP
- **4 KPI cards clicáveis** — filtra tabela in-place: Aguardando / Recebido / Notificado / Todos
- **Banner de inadimplência antes da entrega** — alerta visual se morador tem dívida ativa
- **Verificação de entrega** — `GET /packages/{id}/delivery-check` retorna `is_delinquent`, `fee_will_apply`
- **Reprint com dados completos** — salva `{resident_name, phone, address}` como JSON na `description`
- **Match por `payer_name` no PIX** — novo campo com 80 pontos de relevância para conciliação
- **Pré-preenchimento no cadastro de visitante** — nome e CEP/rua populados da busca anterior

### Bugs Corrigidos
| Bug | Impacto | Causa Raiz |
|---|---|---|
| Filtro de data remove encomendas antigas | Auditor não via encomendas de meses anteriores | `date_from` sempre aplicado — agora opcional |
| Input de data desmontado a cada keystroke | Impossível digitar datas nos filtros | `DateRange` declarado dentro de `FilterPanel` — React recriava a cada render |
| Caracteres de controle no Excel de rastreio | `openpyxl` rejeitava arquivo, download falhava | Regex `_ILLEGAL` para sanitizar ASCII 0x00–0x1F |
| Status "Recebido" confundia usuários | Operadores não sabiam o que significava | Renomeado para "Na portaria (não notificado)" |
| Encomendas de visitante sem `resident_name` | Join ausente | LEFT JOIN `residents` adicionado no endpoint |

### Melhorias
- **Paginação de 50 por página** — `limit`/`offset` em `GET /packages`
- **Botão "Carregar mais"** na lista
- Labels de status renomeados para linguagem operacional clara
- Proxy CEP com fallback BrasilAPI em todos os formulários de encomenda

---

## 4. Módulo de Tarefas Diárias

### Features Implementadas
- **Módulo completo de Tarefas Diárias** — CRUD, checklist por item, comentários com fotos
- **Endpoint `GET /daily-tasks/report/pdf`** — PDF por colaborador com fpdf2
- **Acompanhamento por item do checklist** — comentários vinculados a `checklist_index`
- **Campo "Status inicial"** ao criar (padrão: Pendente)
- **PDF com KPIs corretos** — "Concluídas" = `status=done`; "Itens OK" = `done/total` checklist
- **Endpoint `/daily-tasks/users/group`** — usuários do grupo de associações com `assoc_name`
- **Tarefas concluídas ocultas** — `status !== 'done'` filtrado no `displayedTasks`
- **Ordenação por data de abertura** — nova coluna "Abertura" (`created_at`) na barra de sort

### Bugs Corrigidos
| Bug | Impacto | Causa Raiz |
|---|---|---|
| `create_notification` sem `try/except` | 500 ao atribuir tarefa "pra mim" | Ausência de tratamento — notification_insert falhava silenciosamente |
| Estado global de comentários/fotos | Comentário de uma tarefa aparecia em outra | `commentInput`/`commentPhotos` globais em vez de por `taskId` |
| Date binding asyncpg falhava | Tarefas não criadas — erro 500 | `CAST($2 AS date)` com string → passou `date.fromisoformat()` |
| Checklist de Carla/Vinícius não atualizava | UPDATE silencioso — não afetava linhas | Filtrava `association_id=congonha` mas tarefas eram de Vaz Lobo |
| Cache de comentários nunca invalidado | Novos comentários não apareciam sem reload | `if (comments[taskId]) return` bloqueava re-fetch sempre |
| PDF em branco | Relatório gerado sem conteúdo | Query `FROM users JOIN tasks` — usuário deletado não retornava tarefas |
| Usuário deletado com JWT válido | 500 em operações bulk | `c6640f05-...` removido da `users` mas JWT ainda ativo — subquery de fallback |
| Edit de tarefa com lentidão | UX degradada ao clicar Editar | 11 `setState` sem `startTransition` + sort inline a cada render |

### Melhorias
- **`startTransition`** no `startEdit` — browser responsivo durante re-render
- **`useMemo`** no `displayedTasks` — sort/filter reavaliado só quando necessário
- Tarefas concluídas somem imediatamente ao marcar (sem reload)

---

## 5. Módulo de Ordens de Serviço

### Features Implementadas
- **Módulo de Demandas** — Kanban board com drag-and-drop
- **Verificação de `association_ids`** — isolamento de tenant corrigido em 4 endpoints
- **Endpoint de busca** — `/service-orders/search` com filtros por status, prioridade, categoria
- **CEP com proxy backend** — 2 ocorrências migradas de ViaCEP direto

### Bugs Corrigidos
| Bug | Impacto | Causa Raiz |
|---|---|---|
| `_get` sem filtro de `association_ids` | 404 em service orders de outras associações | Filtro multi-tenant omitido em 4 lugares |
| Enum `'resolved'` vs `'concluido'` | Status não atualizava no banco | PostgreSQL enum usa `'resolved'` — frontend enviava `'concluido'` |
| `RequireModule` bloqueando rota service-orders | Página inacessível para alguns roles | Guard removido; controle feito internamente na página |

---

## 6. Módulo de Relatórios

### Features Implementadas
- **Quick Reports** — 3 cards de acesso rápido no topo:
  - ⚠️ Inadimplentes (De/Até → download direto)
  - 👥 Moradores Ativos (snapshot → download direto)
  - 💰 Financeiro do Período (De/Até → download direto)
- **Progressive disclosure nos filtros** — essenciais sempre visíveis; avançados em `+ Mais filtros (N)`
- **Renomeação semântica dos módulos:**
  - "Mensalidades" → **"Mensalidades / Inadimplência"**
  - "Entregas" → **"Produtividade da Equipe"**
- **Aba "Entregas/Produtividade"** — relatório por colaborador com tarefas, OS, demandas
- **Nova aba "Relatório Inadimplentes por Rua"** — agrupamento por `address_street`
- **Divisor visual** separando acesso rápido do relatório personalizado

### Bugs Corrigidos
| Bug | Impacto | Causa Raiz |
|---|---|---|
| Módulo "Entregas" confundido com encomendas físicas | Usuários não encontravam relatório de produtividade | Nome ambíguo — renomeado para "Produtividade da Equipe" |
| Caracteres de controle no Excel | Download falhava com `ValueError` do openpyxl | Regex `_ILLEGAL` para sanitizar antes de gravar |

---

## 7. Módulo Simplifica

### Features Implementadas
- **`SimplificaTarefas`** — tela de tarefas diárias no modo mobile-first
- **Tiles preenchem tela** — `gridAutoRows` dinâmico para grade 2×N
- **SimplificaMoradores** — navegação e telas inline
- **Cadastro de visitante a partir de encomendas** — busca por rua/CEP pré-obrigatória
- **Mapa de moradores** — `MapaMoradores.tsx` com `divIcon` DOM e cluster

### Bugs Corrigidos
| Bug | Impacto | Causa Raiz |
|---|---|---|
| `gridAutoRows` aplicado a todos os tiles | Layout quebrado em sub-páginas | Seletor CSS aplicado globalmente — escopo corrigido para menu principal |
| iOS Safari — teclado virtual redimensionava chat | Chat inutilizável no iPhone | `VisualViewport API` não usada — `window.innerHeight` ignorava teclado virtual |
| Mapa `divIcon` com DOM inválido | Mapa não renderizava | `divIcon` recriando nó DOM fora do ciclo React |
| Chat `flex-fill` sem altura definida | Chat colapsava em algumas telas | Container sem `min-height: 0` em flex column |

---

## 8. Painel de TI

### Features Implementadas
- **TIPage completa** — substituiu `SuperAdminPage` estática por painel real
- **Middleware de performance** — tabela `request_perf` + registro automático de cada request
- **Aba Performance** — tempo médio por endpoint, P95, requests, erros (últimas 24h)
- **Aba Banco de Dados** — tabelas, tamanhos, índices menos utilizados, queries ativas
- **Aba Endpoints** — lista completa dos 200+ endpoints registrados com tags e métodos
- **Aba Arquitetura** — diagrama SVG gerado em código do sistema completo
- **Aba Analytics** — painel de governança do pipeline ETL
  - Próximas execuções (09h e 17h Brasília)
  - Inventário R2 por camada (Bronze/Prata/Ouro)
  - Pipeline Flow visual: Bronze → Silver → Gold → Analytics → Validate
  - Histórico de execuções com tasks e duração
  - Alertas ativos (falha recente, sem execução 24h, Ouro vazio)
  - Seção Analytics DB com 18 tabelas Gold, domínios, conexão Power BI
- **Sticky tabs** — tabs do TI fixas no topo ao scrollar

### Bugs Corrigidos
| Bug | Impacto | Causa Raiz |
|---|---|---|
| TIPage sumia ao scrollar | Tabs inacessíveis em listas longas | `position: static` → `sticky top-0` |
| Cache hit ratio sem alerta de cor | Degradação não visível | Thresholds adicionados (≥95% verde, <80% vermelho) |

---

## 9. Data Lake & ETL

### Arquitetura Implementada
Pipeline completo **Bronze → Silver → Gold** com armazenamento Parquet no Cloudflare R2 e carga final no Neon Analytics.

```
Neon OLTP ─► Bronze (R2) ─► Silver (R2) ─► Gold (R2 + Neon Analytics) ─► Power BI
```

**Execução:** 2x/dia (09h e 17h Brasília) via cron Vercel + disparo manual admin

### Features Implementadas
- **Incremental Extract** — delta `WHERE updated_at > last_extracted_at`; 98% menos dados vs full diário
- **11 tabelas Bronze** (4 small full + 7 incrementais com merge histórico)
- **5 datasets Silver** (pandas puro, zero queries ao banco na execução incremental)
- **18 tabelas Gold** em 5 domínios (Financeiro, Moradores, Encomendas, Operacional, Equipe)
- **Taxonomia em português** no R2: `bronze/`, `prata/`, `ouro/`, `_controle/`
- **Tabela `runway` financeiro** — cálculo de semanas de operação com saldo atual
- **Logging completo** — `etl_runs` + `etl_task_runs` com status por fase
- **Alerta por e-mail** automático em falhas
- **Neon Analytics (OLAP)** — `aprxm-analytics` criado via API; 18 tabelas Gold carregadas com `df.to_sql`
- **`migration_payments` no Bronze** — integrado para cálculos de inadimplência corretos

### Correções de Qualidade de Dados
| Problema | Fix |
|---|---|
| UUID asyncpg não suportado pelo PyArrow | `_fetch()`: detecta `hasattr(sample, 'hex')` → converte para `str` |
| `datetime64[ns, UTC]` vs `Timestamp` naive | Helper `_to_dt()` garante tz-naive em todas as comparações |
| Booleanos como `object` dtype | Convertidos para `int` antes de groupby |
| `bronze_frames`/`silver_frames` UnboundLocalError | Inicializados antes do `try` |
| `Timestamp.now(tz="UTC")` residual | Substituído por `pd.Timestamp.now()` |
| `delinquency_report` incluía dependentes | Filtro `type='member' AND status='active'` adicionado |
| Inadimplência inflada por `migration_payments` | Bronze inclui `migration_payments`; Silver aplica exclusão |
| `operator_performance` com zeros | Bronze `packages` usado diretamente (Silver perdia `received_by` após join) |
| `operational_kpis.associados_ativos` = 919 | Filtrado para `type='member'` apenas (era todos os tipos) |
| `sla_by_type` com `avg_wait_hours=0` | Filtro `wait_hours > 0` antes do groupby |
| `runway` com despesa R$1.170/sem | Sangrias "Repasse para caixinha" excluídas do cálculo |
| Ruas duplicadas no censo | `_normalize_street()`: strip + title case |

---

## 10. Dashboard Power BI

### Features Implementadas
- **Modelo semântico completo** via Power BI Modeling MCP
  - 20 tabelas: 18 Gold + `dim_Calendário` + `_Medidas` (oculta)
  - 22 medidas DAX em 5 display folders (💰👥📦⚙️🗂️)
  - 8 relacionamentos fato → `dim_Calendário`
  - 3 roles RLS: `diretoria`, `admin`, `operacional`
- **Taxonomia portuguesa:**
  - Prefixo `fato_` em todas as tabelas
  - Colunas: snake_case em português
  - Medidas: Title Case em português
- **`dim_Calendário`** calculada em DAX com 16 colunas (Ano, Mês, Trimestre, Semana, etc.)
- **Conexão Neon Analytics** via Import Mode (`psycopg2-binary`, PostgreSQL connector)
- **Backup TMDL** exportado para `Documents/APRXM_Dashboard_Backup_20260601`

### Auditoria de Qualidade dos Dados
| Anomalia | Status Final |
|---|---|
| Dependent em `delinquency_report` | ✅ Resolvido — filtro `type=member` |
| KPI vs delinquency gap (148 vs 150) | ✅ Resolvido — 0 diferença |
| `operator_performance` zeros | ✅ Resolvido — Bronze direto |
| `sla_by_type` com tempo=0 | ⚠️ Residual histórico — DAX trata |
| Runway Congonha NULL | ℹ️ Dado ausente — módulo de caixa não utilizado |

---

## 11. Segurança

### Vulnerabilidades Corrigidas (Snyk)
- **Critical:** `starlette` — ReDoS (Regular Expression Denial of Service)
- **High:** `urllib3` — request smuggling
- **High:** `pyjwt` — algorithm confusion attack
- **High:** `cryptography` — múltiplas CVEs
- **Medium:** imagens Docker base atualizadas para eliminar CVEs conhecidos

### Melhorias de Segurança
- **Rate limiting** (`slowapi`): 10 req/min no endpoint de login
- **CSP headers** no middleware do FastAPI
- **Refresh token** — expiração ampliada para 7 dias
- **CRON_SECRET** — autenticação de endpoints de cron
- **`ANALYTICS_DATABASE_URL`** — banco OLAP isolado do OLTP de produção

---

## 12. Infraestrutura & CI/CD

### Features
- **GitHub Actions** — Snyk scan em PRs (frontend + backend)
- **Vercel auto-deploy** — `git push origin main` → build + deploy em ~30s
- **Cloudflare R2** — bucket `aprxm-datalake` configurado com credenciais sem carriage return
- **Neon Analytics** — projeto `aprxm-analytics` criado via API (`napi_...`)
- **`psycopg2-binary`** adicionado ao requirements.txt

### Variáveis de Ambiente Adicionadas
| Variável | Propósito |
|---|---|
| `ANALYTICS_DATABASE_URL` | Neon OLAP para Power BI |
| `CRON_SECRET` | Autenticação ETL endpoint |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | Cloudflare R2 |
| `API_KEY` (Neon) | Criação de projetos via Neon API |

---

## 13. Bugs Críticos Corrigidos (Compilado)

Os bugs de maior impacto em produção, ordenados por severidade:

### 🔴 Críticos (afetavam fluxo principal)

| # | Módulo | Bug | Impacto |
|---|---|---|---|
| 1 | Tarefas | `create_notification` sem try/except | 500 ao atribuir tarefa — bloqueava criação |
| 2 | Financeiro | Lançamento offline não quitava mensalidade | Pagamento registrado mas dívida não baixava |
| 3 | Tarefas | State global de comentários/fotos | Comentário de uma tarefa aparecia em outra |
| 4 | Tarefas | Checklist com `association_id` errado | UPDATE silencioso — dados não salvavam |
| 5 | Financeiro | `total_expense` não calculado | Saldo do caixa errado para todos os operadores |
| 6 | Moradores | Badge "Visitantes 200" com 706 visitantes | Gestores viam dados errados de contagem |
| 7 | Ordens de Serviço | Falta de filtro `association_ids` | Dados de outra associação visíveis (leak de tenant) |
| 8 | Financeiro | Float em vez de Decimal em sangrias | Arredondamento incorreto em valores financeiros |

### 🟠 Altos (degradavam UX significativamente)

| # | Módulo | Bug | Impacto |
|---|---|---|---|
| 9 | Encomendas | Input de data desmontado ao digitar | Impossível inserir datas nos filtros |
| 10 | Relatórios | Caracteres de controle no Excel | Download de relatórios falhava |
| 11 | Tarefas | Lentidão ao clicar "Editar" | 11 setState + sort inline travavam UI |
| 12 | Moradores | Logradouro sem campo no form de visitante | CEP buscado mas rua não exibida |
| 13 | CEP | Lookup direto causava CORS/timeout | Erro de CEP para usuários em mobile/corporativo |
| 14 | Tarefas | PDF em branco para usuários deletados | Relatório gerado sem conteúdo |
| 15 | Financeiro | `reopen` não restaurava `closed_by` | Constraint violation ao reabrir sessão |

### 🟡 Médios (comportamentos incorretos)

| # | Módulo | Bug | Impacto |
|---|---|---|---|
| 16 | ETL | `delinquency_report` com dependentes | Inadimplência inflada em +26 registros |
| 17 | ETL | `operator_performance` com zeros | Todos operadores mostravam 0 encomendas |
| 18 | ETL | Runway R$1.170/sem em vez de R$35 | Cálculo financeiro distorcido por repassse interno |
| 19 | ETL | `associados_ativos` = 919 em vez de 155 | KPI errado incluindo todos os tipos de morador |
| 20 | Moradores | Ruas duplicadas (case/espaço) | Censo inflado com variantes da mesma rua |

---

## Métricas Consolidadas

| Categoria | Quantidade |
|---|---|
| Total de commits | 50 |
| Sessões de desenvolvimento | 9 |
| Período coberto | 04 Mai – 02 Jun 2026 |
| Bugs críticos corrigidos | 20+ |
| Features implementadas | 80+ |
| Linhas de código modificadas | ~15.000 |
| Endpoints novos/modificados | 25+ |
| Tabelas Gold no Neon Analytics | 18 |
| Vulnerabilidades de segurança corrigidas | 12+ |

---

## Pendências em Aberto

| Item | Status | Ação Necessária |
|---|---|---|
| Injeção de visuais no `.pbix` via Python | 🔴 Bloqueado | PBI Desktop 2.154 tem validações de ZIP incompatíveis |
| 9 páginas do dashboard PBI | 🟡 Em progresso | Construção manual no Power BI Desktop |
| 21 moradores com ruas incorretas | 🟡 Aguardando | Correção manual pelo admin no sistema |
| Runway Congonha NULL | 🟡 Dado ausente | Operadores devem utilizar módulo de caixa |
| `community_problems` ausente no Gold | ℹ️ Condicional | Aparece apenas quando moradores reportam problemas |

---

*Relatório gerado em 02/06/2026 · Claude Sonnet 4.6 · APRXM v1.0.0*
