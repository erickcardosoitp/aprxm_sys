# Relatório Técnico — APRXM (Aproxima)
## Sessão de Desenvolvimento: 30 Mai – 02 Jun 2026

**Projeto:** APRXM — ERP/SaaS Multi-tenant para associações de moradores  
**Cliente:** Instituto Tia Pretinha  
**Stack:** Python 3.13 / FastAPI / SQLModel / PostgreSQL (Neon) / React 18 / Vite / Tailwind CSS  
**Deploy:** Vercel (frontend + backend) / Cloudflare R2 / Neon Serverless

---

## 1. Segurança

### 1.1 Vulnerabilidades Snyk — Round 1 e 2
- Corrigidas vulnerabilidades **Critical/High** identificadas pelo Snyk
- Atualizadas dependências: `starlette` (ReDoS), `urllib3`, `pyjwt`, `cryptography`
- Imagens Docker base atualizadas para versões sem CVEs conhecidos
- Configurado workflow CI/CD de análise contínua de segurança

### 1.2 Rate Limiting + Segurança de API
- **Rate limiting** implementado com `slowapi`: 10 req/min no endpoint de login
- **CSP headers** adicionados na camada de middleware
- **Refresh token** configurado para 7 dias (anteriormente sem renovação)
- Endpoint de login protegido contra brute force

---

## 2. Data Lake — Arquitetura Medallion

### 2.1 Implementação Bronze → Silver → Gold

**Arquitetura:** pipeline ETL em 4 fases executado 2x/dia (09h e 17h Brasília)

```
Neon OLTP (produção)
  └─ Bronze (extração) ──► Cloudflare R2 (Parquet)
       └─ Silver (enriquecimento pandas) ──► R2
            └─ Gold (agregações) ──► R2 + Neon Analytics (OLAP)
```

**Camada Bronze (11 tabelas):**
- 4 tabelas small (sempre full): `associations`, `users`, `payment_methods`, `transaction_categories`
- 7 tabelas incrementais (delta `WHERE updated_at > last_extracted_at`): `residents`, `mensalidades`, `transactions`, `cash_sessions`, `packages`, `daily_tasks`, `service_orders`
- Redução de dados: ~3 MB (carga inicial) → ~50 KB/dia incremental = **98% menos transferência**

**Camada Silver (5 datasets, pandas puro):**
- `transactions_enriched` — join com resident, payment_method, category
- `packages_enriched` — join com resident, wait_hours calculado
- `residents_clean` — inadimplência calculada, census flags
- `cash_sessions_enriched` — breaks, diferença calculada
- `daily_tasks_enriched` — overdue flag, operador

**Camada Gold (18 datasets, zero queries ao banco):**

| Domínio | Tabelas |
|---|---|
| 💰 Financeiro (6) | receita_diaria, taxa_cobranca, quebras_caixa, motivos_sangria, inadimplencia, runway |
| 👥 Moradores (4) | visao_moradores, crescimento_semanal, censo_por_rua, problemas_comunidade |
| 📦 Encomendas (4) | sla_encomendas, encomendas_por_rua, encomendas_paradas, ranking_encomendas |
| ⚙️ Operacional (3) | desempenho_operadores, receita_operadores, kpis_operacionais |
| 🗂️ Equipe (2) | tarefas_semanais, ranking_colaboradores |

### 2.2 Controle de Estado e Logging
- Metadata de controle em R2: `_controle/estado_etl.json` com `last_extracted_at`
- Tabelas `etl_runs` e `etl_task_runs` no Neon OLTP para auditoria completa
- Alerta por e-mail automático em falhas
- Endpoints de governança: `GET /datalake/governance` (inventário completo R2)
- Endpoint de disparo manual: `POST /datalake/run/manual` (admin)

### 2.3 Taxonomia do R2 (Português)
```
bronze/atual/     ← snapshot consolidado por tabela
bronze/historico/ ← delta por data YYYY/MM/DD
prata/YYYY-MM-DD/ ← Silver do dia
ouro/financeiro/  ← Gold por domínio
ouro/moradores/
ouro/encomendas/
ouro/operacional/
ouro/equipe/
```

### 2.4 Correções no Pipeline ETL

**Problemas de tipo (asyncpg/PyArrow):**
- UUID asyncpg não suportado pelo PyArrow → convertido para `str`
- `datetime64[ns, UTC]` vs `Timestamp` naive → helper `_to_dt()` garante tz-naive
- Booleanos `has_pests`/`sem_internet` como object dtype → convertidos para `int` antes de groupby

**Erros de inicialização:**
- `bronze_frames`/`silver_frames` inicializados antes do bloco `try` para evitar `UnboundLocalError` no `finally`

### 2.5 Correções de Qualidade de Dados no Gold

| Problema | Causa | Fix |
|---|---|---|
| `delinquency_report` incluía dependentes | Sem filtro `type='member'` | Adicionado `type=='member' AND status=='active'` |
| Contagem inflada por `migration_payments` | ETL não excluía pagamentos históricos | Bronze inclui `migration_payments`; Silver exclui meses cobertos |
| `operational_kpis.associados_ativos` = 919 (VL) | Contava todos os tipos | Filtrado para `type='member'` apenas |
| `operator_performance` com zeros | Silver `packages_enriched` perdia `received_by` após join | Usa Bronze `packages` diretamente |
| `sla_by_type` com `avg_wait=0` | Pacotes entregues no mesmo momento | Filtro `wait_hours > 0` |
| `runway` inflado em R$ 1.170/sem | Sangrias "Repasse para caixinha" contadas como despesa | Excluídas sangrias com `description ILIKE '%repasse%|%caixinha%'` |
| Ruas duplicadas no censo | Case, espaços, sem acento | `_normalize_street()`: strip + title case |
| `community_problems` ausente | Criada condicionalmente pelo ETL | Documentado como comportamento esperado |

### 2.6 Neon Analytics (OLAP)

- **Novo projeto Neon** criado: `aprxm-analytics` (ID: `wispy-frost-54420468`)
- Conexão `ANALYTICS_DATABASE_URL` configurada no Vercel
- `psycopg2-binary` adicionado aos requirements
- ETL carrega as 18 tabelas Gold via `df.to_sql(if_exists='replace')` após upload no R2
- **18 tabelas** populadas no Neon Analytics para consumo pelo Power BI

---

## 3. Power BI Dashboard APRXM

### 3.1 Modelo Semântico

**Construído via Power BI Modeling MCP** (Analysis Services local):

| Componente | Detalhes |
|---|---|
| Tabelas | 20 (18 Gold + dim_Calendário + _Medidas oculta) |
| Medidas DAX | 22 organizadas em 5 display folders |
| Relacionamentos | 8 fato → dim_Calendário |
| Roles RLS | 3 (diretoria, admin, operacional) |
| Fonte de dados | Neon Analytics via Import Mode |

**Taxonomia aplicada:**
- Tabelas: prefixo `fato_` + nome em português
- Medidas: português, Title Case, organizadas por domínio com emoji
- Colunas: snake_case em português

**Correções nos metadados do modelo:**
- `create_version=45`, `extract_version=10`, `external_attr=0` preservados via patch binário no ZIP
- Encoding `Report/Layout`: UTF-16-LE sem BOM (formato nativo PBI Desktop 2.154)

### 3.2 Medidas DAX Implementadas

| Folder | Medidas |
|---|---|
| 💰 Financeiro | Receita Total, Despesa Total, Saldo Líquido, Adimplência %, Total Inadimplentes, Valor Inadimplente, Runway (semanas) |
| 👥 Moradores | Total Moradores Ativos, Total Associados, Total Visitantes, Crescimento Semanal |
| 📦 Encomendas | Encomendas Recebidas, Entregues, Pendentes, SLA 24h %, Tempo Médio Entrega (h), Paradas 3d |
| ⚙️ Operacional | Sessões Caixa, Caixas com Quebra % |
| 🗂️ Equipe | Tarefas Concluídas, Conclusão de Tarefas %, Tarefas em Atraso |

### 3.3 Auditoria de Qualidade dos Dados (Claude Desktop)

Auditoria completa realizada via MCP Power BI + consultas diretas ao Neon Analytics:

| Anomalia | Status | Ação |
|---|---|---|
| Dependent em inadimplência | ✅ Resolvido | Filtro `type=member AND status=active` |
| KPI vs delinquency gap | ✅ Resolvido | 0 diferença após fix ETL |
| Operator performance zeros | ✅ Resolvido | Bronze usado diretamente |
| Entregues > recebidas por operador | ✅ Comportamento esperado | Operadores diferentes recv/delv |
| QA e Escritório em tabelas | ✅ Filtrados | Whitelist nas queries Gold |
| SLA tempo = 0 (06/04/2026) | ⚠️ Residual histórico | DAX já trata; dado anterior ao fix |
| Runway Congonha NULL | ℹ️ Dado ausente | Aguarda módulo de caixa |
| Despesas baixas no runway | ℹ️ Dado correto | Despesas externas fora do APRXM |

---

## 4. Frontend — Módulo de Moradores

### 4.1 Paginação (50 por página)
- `GET /residents`: params `limit` (default 50) e `offset` adicionados
- Frontend: `load()` com `append` + `loadMore()` com offset progressivo
- Botão "Carregar mais" com indicador visual
- Sort `displayedTasks` memoizado com `useMemo`

### 4.2 Badge de Visitantes Corrigido
- **Problema:** Badge mostrava "Visitantes 200" quando havia 706 visitantes (limit de paginação)
- **Fix:** `loadCounts` passou a usar `/residents/kpis` com `COUNT(*)` SQL ao invés de `data.length`
- Backend `/residents/kpis` retorna campo `total` adicional

### 4.3 Campo Logradouro no Form de Visitante
- Form de visitante (`ResidentsPage`) não exibia campo Logradouro/Rua
- `lookupCep` preenchia `address_street` no state mas sem input para mostrar
- **Fix:** Campo "Logradouro" adicionado entre Complemento e Bairro

### 4.4 Consulta de CEP — Proxy Backend com Fallback
- **Problema:** `ResidentsPage` e `ServiceOrdersPage` chamavam ViaCEP diretamente do browser (CORS, timeout)
- **Fix Backend:** `GET /packages/cep/{cep}` agora tenta ViaCEP → fallback BrasilAPI
- **Fix Frontend:** Páginas usam `api.get('/packages/cep/')` em vez de `fetch` direto

---

## 5. Frontend — Módulo de Tarefas Diárias

### 5.1 Performance no Edit
- **Problema:** Clicar em "Editar" causava lentidão perceptível
- **Causa:** `startEdit()` fazia 11 `setState` separados + `displayedTasks` recalculado inline
- **Fix:** `startTransition()` para os setState + `useMemo` no `displayedTasks`

### 5.2 Ocultar Tarefas Concluídas
- Ao marcar tarefa como "Concluído", ela some imediatamente da lista
- Filtro `status !== 'done'` adicionado no `displayedTasks` (useMemo)

### 5.3 Ordenação por Data de Abertura
- Nova coluna "Abertura" na barra de ordenação
- Usa `created_at` como campo de sort
- Tipo `sortBy` atualizado para aceitar `'created_at'`

---

## 6. Frontend — Módulo de Encomendas

### 6.1 Paginação (50 por página)
- `GET /packages`: params `limit` (default 50) e `offset` adicionados
- `LIMIT 100` hardcoded substituído por paginação dinâmica
- Frontend: `loadPackages()` com `append` + `loadMorePkgs()`
- Botão "Carregar mais" na lista de encomendas

---

## 7. Frontend — Módulo de Relatórios (Redesign)

### 7.1 Quick Reports
Três cards de acesso rápido no topo da página com download direto (sem preview):

| Card | Descrição |
|---|---|
| ⚠️ Inadimplentes | Seletor De/Até → baixa Excel direto |
| 👥 Moradores Ativos | Snapshot atual → baixa Excel direto |
| 💰 Financeiro do Período | Seletor De/Até → baixa Excel direto |

### 7.2 Renomeação dos Módulos
| Antes | Depois |
|---|---|
| Mensalidades | **Mensalidades / Inadimplência** |
| Entregas | **Produtividade da Equipe** |

### 7.3 Progressive Disclosure nos Filtros
- Filtros essenciais sempre visíveis (2-3 por módulo)
- Filtros avançados ocultos em `+ Mais filtros (N)` com contador
- Recolhe automaticamente ao trocar de módulo

---

## 8. Operações de Banco de Dados

### 8.1 Transação Realocada
- Transação "Taxa de entrega — Thalita Silva Da Costa" (R$ 2,50) movida da sessão da Monique para a sessão da Fernanda via UPDATE direto

### 8.2 Reset de Senha
- Senha de `celiapx@institutotiapretinha.org` redefinida (2 contas: Congonha + Vaz Lobo)

### 8.3 Auditoria de Ruas com Erros
- 21 moradores identificados com nomes de rua incorretos
- Relatório entregue ao usuário para correção manual no sistema

---

## 9. Backend — Fixes Pontuais

### 9.1 Import `Query` Faltando
- `packages.py` e `residents.py` usavam `Query()` do FastAPI sem importar
- `NameError` causava 500 em todos os endpoints — corrigido

### 9.2 JSX Inválido na Paginação
- `displayedTasks` com ternária sem Fragment wrapper
- TypeScript error `TS1005: ')' expected` — corrigido com `<>...</>`

### 9.3 Acesso de Célia
- Login retornando 403 (credencial inválida)
- Senha redefinida via `passlib.CryptContext` diretamente no banco

---

## 10. Infraestrutura e CI/CD

### 10.1 CRON_SECRET
- `CRON_SECRET` configurado no Vercel backend: `aprxm-cron-2026-ETL`
- Permite disparar ETL via `X-Cron-Secret` header sem autenticação JWT

### 10.2 Variáveis de Ambiente Adicionadas
| Variável | Descrição |
|---|---|
| `ANALYTICS_DATABASE_URL` | Neon Analytics OLAP para Power BI |
| `CRON_SECRET` | Autenticação do endpoint de ETL |
| `API_KEY` (Neon) | Token para criar projetos via Neon API |

### 10.3 Deployments
- ~30 deployments automáticos via `git push origin main`
- Pipeline: push → Vercel build → deploy em ~30s
- Frontend: `aprxm-sysfrontend.vercel.app`
- Backend: `backend-smoky-one-85.vercel.app`

---

## 11. Módulo Simplifica

### 11.1 Tarefas Diárias
- `SimplificaTarefas` implementado
- Tiles preenchem tela (grid com `gridAutoRows`)

### 11.2 Fixes iOS Safari
- Teclado virtual no iOS Safari redimensionava o chat (VisualViewport API)
- Chat `flex-fill` corrigido

### 11.3 Mapa de Moradores
- `divIcon` DOM no mapa corrigido
- Tile rendering otimizado

---

## 12. Métricas da Sessão

| Categoria | Quantidade |
|---|---|
| Commits | ~35 |
| Linhas modificadas (aprox.) | 5.000+ |
| Endpoints novos/modificados | 8 |
| Componentes React modificados | 6 |
| Tabelas Gold no Neon Analytics | 18 |
| Anomalias de dados corrigidas | 8 |
| Vulnerabilidades de segurança corrigidas | 12+ |

---

## 13. Pendências Conhecidas

| Item | Status | Próximo Passo |
|---|---|---|
| Injeção de visuais no .pbix via Python | 🔴 Bloqueado | Problema no ZIP do PBI 2.154 — investigar abordagem alternativa |
| Runway Congonha saldo_atual NULL | 🟡 Dado ausente | Operadores devem usar módulo de caixa |
| Ruas com erros de cadastro (21 moradores) | 🟡 Aguardando | Correção manual no sistema pelo admin |
| Construção das páginas do dashboard PBI | 🟡 Em progresso | Páginas a serem construídas no Power BI Desktop |
| `community_problems` ausente no Gold | ℹ️ Condicional | Aparece quando moradores reportam problemas no bairro |

---

## 14. Arquitetura Final do Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    APRXM — Arquitetura                       │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React/Vite)         │  Backend (FastAPI/Python)  │
│  aprxm-sysfrontend.vercel.app  │  backend-smoky-one-85...   │
├─────────────────────────────────────────────────────────────┤
│               Neon PostgreSQL OLTP                          │
│         (produção — ep-rough-tooth-an10po6b)                │
├───────────────────┬─────────────────────────────────────────┤
│   ETL (2x/dia)    │         Cloudflare R2                   │
│  09h + 17h BRT    │    aprxm-datalake (Parquet)             │
│                   │  bronze/ prata/ ouro/                   │
├───────────────────┼─────────────────────────────────────────┤
│                   │     Neon Analytics OLAP                 │
│                   │  (aprxm-analytics — 18 tabelas Gold)    │
├───────────────────┼─────────────────────────────────────────┤
│                   │     Power BI Desktop                    │
│                   │  Dashboard APRXM (Import Mode)          │
└───────────────────┴─────────────────────────────────────────┘
```

---

*Relatório gerado em 02/06/2026 — Claude Sonnet 4.6*
