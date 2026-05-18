# Módulo Captação — Plano de Implementação
**Data:** 2026-05-18  
**Spec:** 2026-05-18-captacao-design.md  
**Status:** Pronto para implementar

---

## Ordem de execução

As fases devem ser executadas em ordem. Cada fase é independente o suficiente para ser implementada e testada isoladamente.

---

## FASE 1 — Backend: Modelos, Migration e Enums

**Arquivos a criar/modificar:**
- `backend/app/models/captacao.py` — SQLModel entities + Python Enums
- `backend/app/main.py` — migration inline (padrão do projeto)

**Tarefas:**
1. Criar enums: `DocumentType`, `SourceType`, `Compatibility`, `PipelineStatus`
2. Criar model `Opportunity` (todos os campos do spec seção 4.1)
3. Criar model `PipelineEvent` (spec seção 4.2)
4. Adicionar migration inline em `main.py` no bloco `lifespan`:
   - `CREATE TABLE IF NOT EXISTS opportunities (...)`
   - `CREATE TABLE IF NOT EXISTS pipeline_events (...)`
   - Todos os índices da seção 4.4
5. Adicionar `GEMINI_API_KEY` em `config.py` via `pydantic-settings`

**Validação:** `python -c "from app.models.captacao import Opportunity"` sem erro.

---

## FASE 2 — Backend: Service

**Arquivo a criar:**
- `backend/app/services/captacao_service.py`

**Tarefas:**
1. `search_opportunities(query, filters, association_id, user_id)`:
   - Monta prompt com `ITP_CONTEXT` + query + filtros
   - Sanitiza input (anti prompt injection, max 500 chars)
   - Chama Gemini `gemini-2.0-flash` com Google Search grounding
   - Timeout 25s via `asyncio.wait_for`
   - Retry 3x com backoff exponencial em 429/503/TimeoutError
   - Parseia JSON (remove fences, valida campos obrigatórios)
   - Loga: `request_id`, query, duração, cache hit/miss, erro
   - Retorna lista de até 6 oportunidades normalizadas

2. `generate_document(opportunity_id, document_type, association_id)`:
   - Busca oportunidade no banco (valida `association_id`)
   - Seleciona template de prompt por `document_type`
   - Chama Gemini com timeout 30s
   - Gera `.docx` via `python-docx` (título, corpo formatado)
   - Retorna `BytesIO`

3. `expire_overdue(db)`:
   - UPDATE com `deadline IS NOT NULL AND deadline < today AND status NOT IN (approved, archived, expired)`
   - Chamado pelo cron diário

4. `get_insights(association_id, db)`:
   - Query SQL agregada server-side
   - Retorna estrutura completa de KPIs + dados para gráficos

**Validação:** unit test manual dos parsers com JSON malformado.

---

## FASE 3 — Backend: Router

**Arquivo a criar:**
- `backend/app/routers/captacao.py`

**Tarefas:**
1. Registrar router em `main.py`: `app.include_router(captacao_router, prefix="/captacao")`
2. Implementar todos os 8 endpoints (spec seção 5):
   - `POST /search` — rate limit 10/min, injeta `request_id` no log
   - `POST /opportunities` — salvar oportunidade
   - `GET /opportunities` — listar com filtros + paginação
   - `GET /opportunities/{id}` — detalhe + pipeline_events (lazy)
   - `PATCH /opportunities/{id}/pipeline` — muda status + registra evento
   - `DELETE /opportunities/{id}` — soft delete
   - `POST /opportunities/{id}/document` — rate limit 5/min, retorna stream
   - `GET /insights` — KPIs agregados
3. Todos filtram `association_id` do JWT
4. Rate limiting via decorator ou middleware simples por `user_id`

**Validação:** `curl -X POST /captacao/search` retorna 401 sem token.

---

## FASE 4 — Frontend: Tipos, Constantes e Utilitários

**Arquivos a criar:**
- `frontend/src/modules/captacao/types/index.ts`
- `frontend/src/modules/captacao/constants/itpContext.ts`
- `frontend/src/modules/captacao/constants/captacaoFilters.ts`
- `frontend/src/modules/captacao/constants/promptTemplates.ts`
- `frontend/src/modules/captacao/utils/geminiParser.ts`
- `frontend/src/modules/captacao/utils/opportunityMapper.ts`
- `frontend/src/modules/captacao/utils/compatibility.ts`

**Tarefas:**
1. `types/index.ts` — interfaces `Opportunity`, `PipelineEvent`, `SearchFilters`, `InsightsData`, enums `PipelineStatus`, `SourceType`, `Compatibility`, `DocumentType`
2. `itpContext.ts` — string `ITP_CONTEXT` com dados do ITP
3. `captacaoFilters.ts` — arrays de opções para selects de filtro
4. `promptTemplates.ts` — `SEARCH_PROMPT(query, filters)` do spec seção 13
5. `geminiParser.ts` — remove fences, valida campos obrigatórios, aplica defaults
6. `opportunityMapper.ts` — mapeia resposta normalizada → `Opportunity`
7. `compatibility.ts` — `scoreToLabel(score)` e `scoreToColor(score)`

**Validação:** `geminiParser` com input `\`\`\`json [...] \`\`\`` retorna array limpo.

---

## FASE 5 — Frontend: Service e Hooks

**Arquivos a criar:**
- `frontend/src/modules/captacao/services/captacao.service.ts`
- `frontend/src/modules/captacao/hooks/useGeminiAPI.ts`
- `frontend/src/modules/captacao/hooks/useOpportunityFilters.ts`
- `frontend/src/modules/captacao/hooks/usePipelineStats.ts`

**Tarefas:**

`captacao.service.ts`:
1. Cache em `Map` com TTL 15min (invalidar ao salvar)
2. `searchOpportunities(query, filters)`:
   - Gera `request_id` (uuid)
   - Verifica cache antes da chamada
   - `AbortController` com timeout 30s
   - POST `/captacao/search` via `api` (Axios com JWT)
   - Parseia com `geminiParser` + `opportunityMapper`
3. `saveOpportunity(opp)` — POST + invalida cache
4. `updatePipeline(id, status, notes?)` — PATCH otimista
5. `generateDocument(id, type)` — POST com timeout 35s, retorna blob para download
6. `getOpportunities(filters, page)` — GET com paginação
7. `getOpportunityDetail(id)` — GET lazy
8. `getInsights()` — GET

`useGeminiAPI.ts` — thin: `{ buscarOportunidades, gerarDocumento, loading, error }`
`useOpportunityFilters.ts` — estado dos filtros + debounce 500ms
`usePipelineStats.ts` — chama `getInsights()`, retorna dados para `InsightsPage`

**Validação:** mock do `api` retornando JSON → `searchOpportunities` retorna `Opportunity[]`.

---

## FASE 6 — Frontend: Componentes Base

**Arquivos a criar:**
- `frontend/src/modules/captacao/components/CompatibilityBadge.tsx`
- `frontend/src/modules/captacao/components/OpportunityCard.tsx`
- `frontend/src/modules/captacao/components/OpportunityFilters.tsx`
- `frontend/src/modules/captacao/components/SearchHero.tsx`
- `frontend/src/modules/captacao/components/KPIStats.tsx`

**Tarefas:**

`CompatibilityBadge` — badge colorido (high=verde, medium=amarelo, low=cinza)

`OpportunityCard`:
1. Hierarquia visual: score barra → badge compatibility → prazo → ai_confidence barra → match_reasons chips → título/org → resumo `line-clamp-2` → botões
2. `ai_confidence` como `████████░░ 87%` (divs com width%)
3. Urgência visual no prazo se `deadline < 30 dias`
4. Botões: "Salvar" (chama `saveOpportunity`) + "Ver detalhes" (abre drawer)

`OpportunityFilters` — formulário colapsável com: áreas (checkboxes), source_type (select), compatibility (select), faixa de valor (inputs), prazo (date)

`SearchHero` — título, campo livre, botão "Buscar oportunidades", estado de loading com skeleton

`KPIStats` — grid de cards com os 8 KPIs do spec

**Validação:** renderização de `OpportunityCard` com dados mockados.

---

## FASE 7 — Frontend: Drawer e Pipeline

**Arquivos a criar:**
- `frontend/src/modules/captacao/components/OpportunityDrawer.tsx`
- `frontend/src/modules/captacao/components/PipelineTable.tsx`
- `frontend/src/modules/captacao/components/PipelineTabs.tsx`
- `frontend/src/modules/captacao/components/PipelineKanban.tsx`

**Tarefas:**

`OpportunityDrawer`:
1. Painel lateral (slide-in) ou modal full-screen em mobile
2. Dispara `getOpportunityDetail(id)` ao abrir (lazy)
3. Skeleton enquanto carrega
4. Aba "Detalhes": todos os campos + chips de `match_reasons` + lista de `pipeline_events`
5. Aba "Documento": select `DocumentType` → botão "Gerar" (loading) → textarea editável → botão "Baixar .docx" (chama `generateDocument`, faz `URL.createObjectURL` para download)
6. Aba "Pipeline": select de status + input de nota → botão "Atualizar"

`PipelineTable` — tabela responsiva, colunas: título, org, valor, prazo, compatibility, status (select inline), ações

`PipelineTabs` — abas por `PipelineStatus` com contador de itens cada

`PipelineKanban`:
1. Instalar `@dnd-kit/core` + `@dnd-kit/sortable`
2. 7 colunas (uma por status incluindo `expired`)
3. Drag-and-drop: `onDragEnd` chama `updatePipeline` otimisticamente
4. Rollback: se API retornar erro, reverter estado local + toast de erro

**Validação:** drag de card entre colunas reflete na UI imediatamente.

---

## FASE 8 — Frontend: Páginas e Layout

**Arquivos a criar:**
- `frontend/src/modules/captacao/layouts/CaptacaoLayout.tsx`
- `frontend/src/modules/captacao/pages/BuscarPage.tsx`
- `frontend/src/modules/captacao/pages/PipelinePage.tsx`
- `frontend/src/modules/captacao/pages/InsightsPage.tsx`

**Tarefas:**

`CaptacaoLayout`:
1. Sub-nav interna: "Buscar" | "Pipeline" | "Insights" (NavLink com estilo ativo)
2. `<Outlet />` para renderizar sub-páginas
3. Responsivo mobile-first

`BuscarPage`:
1. `SearchHero` no topo
2. `OpportunityFilters` (colapsável)
3. Grid de até 6 `OpportunityCard`
4. Loading: skeleton de 6 cards
5. Empty state: ícone + "Nenhuma oportunidade encontrada"
6. Error state: toast + botão "Tentar novamente"

`PipelinePage`:
1. Toggle de visão: Lista | Kanban | Abas (state local ou URL param)
2. Renderiza `PipelineTable` | `PipelineKanban` | `PipelineTabs` conforme seleção
3. Paginação server-side na visão de lista

`InsightsPage`:
1. `KPIStats` no topo (dados de `usePipelineStats`)
2. Gráfico de barras `by_source_type` — Recharts `BarChart`
3. Gráfico de pizza `by_compatibility` — Recharts `PieChart`
4. Linha do tempo `monthly_submissions` — Recharts `LineChart`
5. Loading skeleton para cada seção

**Validação:** navegação entre as 3 sub-rotas funciona sem erro de console.

---

## FASE 9 — Integração na App

**Arquivos a modificar:**
- `frontend/src/App.tsx`
- `frontend/src/components/layout/AppShell.tsx`

**Tarefas:**

`App.tsx`:
1. Import `CaptacaoLayout` + páginas
2. Adicionar bloco de rotas (spec seção 3.1)

`AppShell.tsx`:
1. Import `Target` de `lucide-react`
2. Adicionar ao `MODULE_NAV`:
   ```tsx
   { module: 'captacao', item: { to: '/captacao', label: 'Captação', icon: Target } }
   ```

**Validação:** item "Captação" aparece na sidebar; `/captacao` redireciona para `/captacao/buscar`.

---

## FASE 10 — Variáveis de Ambiente e Deploy

**Arquivos a modificar/criar:**
- `backend/.env` — adicionar `GEMINI_API_KEY=your_gemini_api_key`
- `backend/.env.example` — idem
- Vercel dashboard — adicionar `GEMINI_API_KEY` nas env vars de produção

**Checklist de segurança pré-deploy (spec seção 7):**
- [ ] Todas as queries têm filtro `association_id`
- [ ] `GEMINI_API_KEY` não aparece em nenhum arquivo frontend
- [ ] Rate limiting ativo nos endpoints `/search` e `/document`
- [ ] Soft delete implementado — nenhum `DELETE` físico
- [ ] JWT validado em todos os endpoints
- [ ] Inputs sanitizados antes de enviar ao Gemini
- [ ] `gemini_raw` salvo para auditoria
- [ ] `request_id` logado

---

## Dependências a instalar

```bash
# Frontend
cd frontend
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# Backend
cd backend
pip install python-docx
```

---

## Ordem resumida

```
Fase 1 → Fase 2 → Fase 3   (backend completo)
Fase 4 → Fase 5             (frontend: base lógica)
Fase 6 → Fase 7 → Fase 8   (frontend: UI)
Fase 9 → Fase 10            (integração + deploy)
```

Cada fase pode ser implementada e validada antes de avançar.
