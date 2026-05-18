# Módulo Captação — Design Spec
**Data:** 2026-05-18  
**Status:** Aprovado  
**Projeto:** ITP ERP (APRXM)

---

## 1. Objetivo

Central inteligente de prospecção e gestão de oportunidades de funding para o Instituto Tia Pretinha (ITP). Usa Gemini 2.0 Flash com Google Search grounding para encontrar editais, grants, patrocínios e leis de incentivo alinhados à missão do ITP, permitindo salvar, acompanhar em pipeline e gerar documentos de captação.

---

## 2. Contexto Institucional (ITP_CONTEXT)

Usado em todos os prompts Gemini como contexto fixo:

```
Organização: Instituto Tia Pretinha
CNPJ: 11.759.851/0001-39
Natureza: Associação Privada sem fins lucrativos
Fundação: 09/03/2010
Endereço: Rua Ramiro Monteiro, 130 — Vaz Lobo, Rio de Janeiro/RJ — CEP 21.360-460
Atividades: ensino de esportes, arte e cultura, atenção à saúde, artes cênicas, projetos esportivos
Propósito: transformação social por meio do afeto, cuidado, dignidade e oportunidades
Público: crianças, adolescentes, jovens e adultos em vulnerabilidade social
Indicadores: 245 alunos | 85 famílias | satisfação 4,93/5 | evasão 0,9%
Contato: contato@institutotiapretinha.com.br | (21) 6554-0576
```

---

## 3. Arquitetura

### 3.1 Rotas Frontend

```
/captacao                → redirect → /captacao/buscar
/captacao/buscar         → busca manual + resultados Gemini
/captacao/pipeline       → pipeline com toggle lista/kanban/tabs
/captacao/insights       → dashboard analítico (server-side)
```

Integração em `App.tsx`:
```tsx
<Route path="captacao" element={<RequireModule module="captacao"><CaptacaoLayout /></RequireModule>}>
  <Route index element={<Navigate to="buscar" replace />} />
  <Route path="buscar"   element={<BuscarPage />} />
  <Route path="pipeline" element={<PipelinePage />} />
  <Route path="insights" element={<InsightsPage />} />
</Route>
```

### 3.2 Estrutura de Arquivos Frontend

```
frontend/src/modules/captacao/
  pages/
    BuscarPage.tsx
    PipelinePage.tsx
    InsightsPage.tsx
  components/
    OpportunityCard.tsx
    OpportunityFilters.tsx
    PipelineKanban.tsx
    PipelineTable.tsx
    PipelineTabs.tsx
    KPIStats.tsx
    SearchHero.tsx
    CompatibilityBadge.tsx
    OpportunityDrawer.tsx
  hooks/
    useGeminiAPI.ts          ← thin: só estado (loading/error/data)
    useOpportunityFilters.ts ← filtros + debounce 500ms
    usePipelineStats.ts      ← lê /captacao/insights
  services/
    captacao.service.ts      ← toda lógica: prompts, parsing, cache, retry, timeouts
  constants/
    itpContext.ts            ← ITP_CONTEXT string
    captacaoFilters.ts       ← opções de filtros (areas, source_types, etc.)
    promptTemplates.ts       ← templates de prompt por tipo de busca e documento
  utils/
    opportunityMapper.ts     ← mapeia resposta Gemini → Opportunity
    compatibility.ts         ← score → label (Excelente/Alta/Média/Baixa)
    geminiParser.ts          ← sanitiza JSON bruto do Gemini
  types/
    index.ts
  layouts/
    CaptacaoLayout.tsx
```

### 3.3 Separação de Responsabilidades (Frontend)

```
useGeminiAPI()                ← estado: loading, error, data
  ↓
captacao.service.ts           ← lógica: prompt, cache, retry, parse, validate, timeout
  ↓
POST /captacao/search         ← backend FastAPI (Gemini com API key segura)
  ↓
geminiParser.ts               ← sanitiza ```json fences, valida campos
  ↓
opportunityMapper.ts          ← normaliza → tipo Opportunity
```

### 3.4 Estrutura Backend

```
backend/app/
  models/captacao.py
  routers/captacao.py
  services/captacao_service.py
```

---

## 4. Banco de Dados

### 4.1 Tabela `opportunities`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `association_id` | UUID FK NOT NULL | multi-tenant — obrigatório em TODA query |
| `title` | TEXT NOT NULL | |
| `source_type` | ENUM NOT NULL | ver SourceType |
| `organization` | TEXT | órgão/instituição |
| `value_min` | NUMERIC(12,2) | nullable |
| `value_max` | NUMERIC(12,2) | nullable |
| `deadline` | DATE | nullable — data limite do edital |
| `expires_at` | TIMESTAMPTZ | nullable — controle interno de expiração |
| `compatibility` | ENUM NOT NULL | ver Compatibility |
| `score` | INT | 0–100 |
| `ai_confidence` | NUMERIC(4,3) | 0.000–1.000 ex: 0.870 |
| `summary` | TEXT | resumo gerado pelo Gemini |
| `match_reasons` | JSONB | ex: `["Atua em esporte", "Atende juventude"]` |
| `areas` | TEXT[] | ex: `["educação","esporte"]` |
| `tags` | TEXT[] | tags livres |
| `link` | TEXT | nullable |
| `pipeline_status` | ENUM NOT NULL | ver PipelineStatus |
| `notes` | TEXT | anotações manuais |
| `search_metadata` | JSONB | query, filtros, searched_at |
| `gemini_raw` | JSONB | resposta bruta (auditoria) |
| `created_by` | UUID FK | usuário que salvou |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `updated_at` | TIMESTAMPTZ NOT NULL | |
| `deleted_at` | TIMESTAMPTZ | soft delete |

### 4.2 Tabela `pipeline_events`

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `opportunity_id` | UUID FK NOT NULL | |
| `association_id` | UUID NOT NULL | multi-tenant |
| `from_status` | ENUM | nullable (criação) |
| `to_status` | ENUM NOT NULL | |
| `changed_by` | UUID FK NOT NULL | |
| `notes` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ NOT NULL | |

### 4.3 Enums Python

```python
class DocumentType(str, Enum):
    carta = "carta"
    oficio = "oficio"
    proposta = "proposta"
    resumo = "resumo"
    chamamento = "chamamento"
    projeto_esboco = "projeto_esboco"

class SourceType(str, Enum):
    public = "public"
    private = "private"
    incentive_law = "incentive_law"
    sponsorship = "sponsorship"
    foundation = "foundation"
    grant = "grant"

class Compatibility(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"

class PipelineStatus(str, Enum):
    new = "new"
    analyzing = "analyzing"
    preparing = "preparing"
    submitted = "submitted"
    approved = "approved"
    archived = "archived"   # renomeado de 'closed' — future-proof
    expired = "expired"
```

> **Nota:** `archived` substitui `closed` para maior clareza semântica — uma oportunidade arquivada pode ser reaberta; "fechada" implica finalidade permanente.

### 4.4 Índices

```sql
CREATE INDEX idx_opp_assoc           ON opportunities (association_id);
CREATE INDEX idx_opp_pipeline        ON opportunities (association_id, pipeline_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_opp_source_type     ON opportunities (association_id, source_type)     WHERE deleted_at IS NULL;
CREATE INDEX idx_opp_compatibility   ON opportunities (association_id, compatibility)   WHERE deleted_at IS NULL;
CREATE INDEX idx_opp_deadline        ON opportunities (deadline)                        WHERE deleted_at IS NULL;
CREATE INDEX idx_pipeline_events_opp ON pipeline_events (opportunity_id);
```

---

## 5. Endpoints API

Todos os endpoints requerem **JWT autenticado** via header `Authorization: Bearer <token>`. O `association_id` é extraído do JWT — nunca aceito como parâmetro do cliente.

```
POST   /captacao/search
POST   /captacao/opportunities
GET    /captacao/opportunities
GET    /captacao/opportunities/{id}
PATCH  /captacao/opportunities/{id}/pipeline
DELETE /captacao/opportunities/{id}
POST   /captacao/opportunities/{id}/document
GET    /captacao/insights
```

### POST /captacao/search
- **Auth:** JWT obrigatório
- Recebe: `{ request_id, query, filters: { areas, source_types, compatibility, value_range } }`
- `request_id` — UUID gerado pelo frontend para rastreabilidade (idempotência e logs correlacionados)
- Cache 15min por hash(query + filtros) por `association_id`
- Rate limit: **10 req/min por usuário**
- Timeout Gemini: **25s** → fallback `{ error: "A busca demorou mais que o esperado. Tente novamente." }`
- Retry: 3x com backoff exponencial em 429/503/timeout
- Retorna: lista de até 6 oportunidades normalizadas
- Log: `request_id`, query, duração, tokens estimados, cache hit/miss, erro

### GET /captacao/opportunities
- **Auth:** JWT obrigatório
- Filtros: `pipeline_status`, `source_type`, `compatibility`, `areas`, `search`
- Paginação: `page` + `limit` (padrão 20)
- Sempre filtra `deleted_at IS NULL` e `association_id = current`

### GET /captacao/opportunities/{id}
- **Auth:** JWT obrigatório
- Retorna dados completos + `pipeline_events` (lazy load do drawer)
- Valida `association_id` — retorna 404 se não pertence ao tenant

### PATCH /captacao/opportunities/{id}/pipeline
- **Auth:** JWT obrigatório
- Body: `{ pipeline_status, notes? }`
- Registra evento em `pipeline_events`
- **Atualização otimista no frontend** com rollback em erro de rede ou 4xx

### DELETE /captacao/opportunities/{id}
- **Auth:** JWT obrigatório
- Soft delete: seta `deleted_at = now()`
- Valida `association_id`

### POST /captacao/opportunities/{id}/document
- **Auth:** JWT obrigatório
- Body: `{ document_type: DocumentType }`
- Rate limit: **5 req/min por usuário**
- Timeout Gemini: **30s** (documentos são maiores que buscas)
- Backend chama Gemini com prompt do template correspondente ao `document_type`
- Gera arquivo via `python-docx`
- Retorna stream (`Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
- **Fallback:** se Gemini falhar após retries → HTTP 503 com `{ error: "Não foi possível gerar o documento. Tente novamente." }`

### GET /captacao/insights
- **Auth:** JWT obrigatório
- Server-side — nunca calcular no frontend
```json
{
  "kpis": {
    "total": 0,
    "approved": 0,
    "approval_rate": 0.0,
    "value_potential": 0,
    "value_submitted": 0,
    "value_approved": 0,
    "avg_score": 0.0,
    "expiring_30d": 0
  },
  "by_source_type": [],
  "by_compatibility": [],
  "by_pipeline_status": [],
  "monthly_submissions": []
}
```

---

## 6. Componentes Frontend

### OpportunityCard
Hierarquia visual obrigatória (nessa ordem):
1. **Score** — barra visual + label (Excelente/Alta/Média/Baixa)
2. **Compatibilidade** — `CompatibilityBadge` com cor
3. **Prazo** — destacado com urgência visual se < 30 dias
4. `ai_confidence` — mini progress bar inline: `████████░░ 87%`
5. `match_reasons` — chips
6. Título, organização
7. **Resumo** — truncado em 2 linhas com `line-clamp-2` (Tailwind)
8. Ações: Salvar | Ver detalhes

### Score → Label
| Score | Label | Cor |
|---|---|---|
| 90–100 | Excelente aderência | verde |
| 75–89  | Alta aderência | azul |
| 50–74  | Média aderência | amarelo |
| < 50   | Baixa aderência | cinza |

### OpportunityDrawer
- Abre ao clicar "Ver detalhes"
- **Lazy**: dispara `GET /captacao/opportunities/{id}` ao abrir
- Skeleton enquanto carrega
- Aba "Detalhes": todos os campos + `match_reasons` + histórico de pipeline
- Aba "Documento": select `document_type` → "Gerar" → preview textarea editável → "Baixar .docx"

### PipelinePage — 3 visões
Toggle no topo da página:
- **`PipelineTable`** — tabela com colunas: título, org, valor, prazo, compatibility, status, ações
- **`PipelineKanban`** — 7 colunas por status (inclui `expired`), drag-and-drop via `@dnd-kit/core` + `@dnd-kit/sortable`; **atualização otimista + rollback em erro**; virtualização documentada como melhoria futura
- **`PipelineTabs`** — abas por status (com contador), lista de cards em cada aba

### InsightsPage
- `KPIStats`: total, aprovadas, taxa aprovação, valor potencial, valor submetido, valor aprovado, score médio, expirando em 30d
- Gráfico de barras `source_type` — Recharts (já no projeto)
- Gráfico de pizza `compatibility` — Recharts
- Linha do tempo de submissões mensais

---

## 7. Segurança

### Multi-tenancy
- **TODA query** no backend filtra por `association_id = current_user.association_id`
- `association_id` extraído exclusivamente do JWT — nunca aceito via body/query params
- Recursos de outro tenant retornam 404 (não 403 — para não vazar existência)

### Chave de API
- `GEMINI_API_KEY` apenas no backend — **nunca exposta ao frontend**
- Não adicionar variável com prefixo `NEXT_PUBLIC_` ou `VITE_`

### Checklist de Segurança Pré-Deploy
- [ ] Todas as queries têm filtro `association_id`
- [ ] `GEMINI_API_KEY` não aparece em nenhum arquivo frontend
- [ ] Rate limiting ativo nos endpoints `/search` e `/document`
- [ ] Soft delete implementado — nenhum `DELETE` físico
- [ ] JWT validado em todos os endpoints via `get_current_user`
- [ ] Inputs sanitizados antes de enviar ao Gemini (sem injeção de prompt)
- [ ] `gemini_raw` salvo para auditoria de respostas inesperadas
- [ ] `request_id` logado para rastreabilidade

### Sanitização de Input (Anti Prompt Injection)
Antes de enviar `query` ao Gemini, `captacao_service.py` deve:
```python
# Remover sequências suspeitas de injeção de prompt
query = query.strip()[:500]  # limitar tamanho
query = re.sub(r'(ignore|forget|disregard).*(instructions|prompt|above)', '', query, flags=re.IGNORECASE)
```

---

## 8. Observabilidade (Mínima)

Logar em cada chamada Gemini:
```python
logger.info({
    "event": "gemini_search",
    "request_id": request_id,
    "query": query,
    "duration_ms": duration,
    "tokens_estimated": tokens,
    "cache_hit": hit,
    "error": error or None,
    "association_id": str(association_id),
    "user_id": str(user_id),
})
```

---

## 9. Expiração Automática

Cron diário no backend:
```sql
UPDATE opportunities
SET pipeline_status = 'expired', updated_at = now()
WHERE deadline IS NOT NULL
  AND deadline < CURRENT_DATE
  AND pipeline_status NOT IN ('approved', 'archived', 'expired')
  AND deleted_at IS NULL
```

> `AND deadline IS NOT NULL` — oportunidades sem prazo definido nunca expiram automaticamente.

---

## 10. Cache de Busca

Em `captacao.service.ts` (frontend, memória):
- Chave: `SHA256(query + JSON.stringify(sortedFilters) + association_id)`
- TTL: 15 minutos
- Estrutura: `Map<string, { data: Opportunity[]; ts: number }>`
- **Invalidação:** cache é limpo para a chave correspondente quando o usuário salva uma oportunidade dos resultados (evita inconsistência entre "já salva" e cache stale)
- Evita chamadas duplicadas ao backend/Gemini

---

## 11. Timeouts no Frontend

Em `captacao.service.ts`, todas as chamadas à API usam timeout explícito via `AbortController`:

```typescript
// Busca
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 30_000) // 30s
try {
  const res = await api.post('/captacao/search', body, { signal: controller.signal })
} catch (e) {
  if (e.name === 'AbortError') throw new Error('A busca demorou mais que o esperado.')
} finally {
  clearTimeout(timeout)
}

// Documento
// timeout = 35_000 (35s — geração é mais lenta)
```

Timeouts por operação:
| Operação | Frontend timeout | Backend Gemini timeout |
|---|---|---|
| `/search` | 30s | 25s |
| `/document` | 35s | 30s |
| Outros endpoints | 10s | N/A |

---

## 12. Políticas de Fallback de IA

### Busca (`/search`)
| Condição | Fallback |
|---|---|
| Timeout (> 25s) | `{ error: "A busca demorou mais que o esperado. Tente novamente." }` |
| Rate limit Gemini (429) | Retry 3x backoff → `{ error: "Serviço temporariamente indisponível." }` |
| Resposta malformada | Retornar apenas itens válidos após `geminiParser`; se nenhum válido → `{ results: [], warning: "Não foi possível processar todos os resultados." }` |
| Erro 5xx Gemini | Retry 3x → `{ error: "Erro ao conectar com o serviço de IA." }` |
| Nenhum resultado relevante | `{ results: [], message: "Nenhuma oportunidade encontrada para os filtros informados." }` |

### Geração de Documento (`/document`)
| Condição | Fallback |
|---|---|
| Timeout (> 30s) | HTTP 503 + `{ error: "Não foi possível gerar o documento. Tente novamente." }` |
| Gemini retorna texto vazio | HTTP 422 + `{ error: "O modelo não gerou conteúdo para este tipo de documento." }` |
| Erro `python-docx` | HTTP 500 + log detalhado; frontend mostra toast de erro |

---

## 13. Templates de Prompt

Em `promptTemplates.ts` (frontend) e espelhado no backend para geração de documentos.

### Template de Busca
```typescript
export const SEARCH_PROMPT = (query: string, filters: SearchFilters) => `
Você é um especialista em captação de recursos para organizações do terceiro setor brasileiro.

CONTEXTO DA ORGANIZAÇÃO:
${ITP_CONTEXT}

TAREFA:
Pesquise oportunidades de financiamento REAIS e ATUAIS que correspondam à seguinte busca:
"${query}"

FILTROS APLICADOS:
- Áreas: ${filters.areas?.join(', ') || 'todas'}
- Tipo: ${filters.source_types?.join(', ') || 'todos'}
- Compatibilidade mínima: ${filters.compatibility || 'qualquer'}

INSTRUÇÕES:
1. Use Google Search para encontrar oportunidades reais e abertas
2. Retorne EXATAMENTE um JSON array com até 6 oportunidades
3. Priorize oportunidades com prazo aberto ou futuro
4. Calcule score de 0-100 baseado na aderência ao ITP
5. NÃO invente dados — use apenas informações verificáveis

FORMATO DE RESPOSTA (JSON puro, sem markdown):
[{
  "title": "string",
  "source_type": "public|private|incentive_law|sponsorship|foundation|grant",
  "organization": "string",
  "value_min": number|null,
  "value_max": number|null,
  "deadline": "YYYY-MM-DD"|null,
  "compatibility": "high|medium|low",
  "score": number,
  "ai_confidence": number,
  "summary": "string (max 200 chars)",
  "match_reasons": ["string"],
  "areas": ["string"],
  "link": "string|null"
}]
`
```

### Templates de Documento (backend)
Um template por `DocumentType`:
- `carta` — carta de apresentação institucional (1 página)
- `oficio` — ofício formal de solicitação
- `proposta` — proposta de projeto resumida (3–5 páginas)
- `resumo` — resumo institucional (1 página)
- `chamamento` — chamamento de parceiros
- `projeto_esboco` — esboço de projeto completo

Cada template usa `ITP_CONTEXT` + dados da oportunidade + instruções específicas de formato/tom.

---

## 14. Normalização e Validação Gemini

`geminiParser.ts` deve:
1. Remover ` ```json ` e ` ``` ` antes do `JSON.parse`
2. Validar campos obrigatórios: `title`, `source_type`, `compatibility`, `score`
3. Aplicar defaults em campos ausentes: `score = 0`, `areas = []`, `match_reasons = []`
4. Rejeitar itens com `title` vazio ou `source_type` inválido

`opportunityMapper.ts` deve normalizar enums para lowercase e validar contra `SourceType`/`Compatibility`.

---

## 15. Libs Novas

| Lib | Onde | Motivo |
|---|---|---|
| `@dnd-kit/core` | frontend | Kanban drag-and-drop |
| `@dnd-kit/sortable` | frontend | Kanban drag-and-drop |
| `python-docx` | backend | Geração de documentos Word |

---

## 16. Sidebar / Menu

Arquivo: `AppShell.tsx`  
Adicionar ao `MODULE_NAV`:
```tsx
{ module: 'captacao', item: { to: '/captacao', label: 'Captação', icon: Target } }
```
Ícone: `Target` (já disponível no Lucide).

---

## 17. Variáveis de Ambiente

Backend `.env` e `.env.example`:
```
GEMINI_API_KEY=your_gemini_api_key
```

**Não adicionar ao frontend.** A chave fica exclusivamente no servidor.

---

## 18. Melhorias Futuras (Documentadas, Fora de Escopo)

- Virtualização do `PipelineKanban` (react-virtual ou similar) quando pipeline > 50 cards
- Geração de documentos assíncrona via job/queue (evitar timeout em alta demanda)
- Tabelas many-to-many para `areas` e `tags` (analytics fortes)
- Notificações de prazo (push) via `pipeline_events`
- Export CSV/Excel do pipeline
- Integração com sistemas externos de editais (API FNDE, SICONV, etc.)
- `request_id` persistido no banco para deduplicação de buscas
