# Spec: Tarefas Diárias — Redesign completo

**Data:** 2026-05-27  
**Módulo:** Ordens de Serviço → aba "Tarefas Diárias"  
**Autor:** erickxc  

---

## Contexto

A aba "Tarefas Diárias" existe em `ServiceOrdersPage.tsx` e usa o backend `/daily-tasks`. A funcionalidade básica (CRUD, checklist, acompanhamentos, relatório por colaborador) já existe, mas há gaps de UX, bugs e ausência de exportação PDF.

---

## Problemas identificados (bugs)

### Bug 1 — Backend: `comment` obrigatório sem default
**Arquivo:** `backend/app/routers/daily_tasks.py`  
**Classe:** `AddCommentRequest`  
`comment: str` → deve ser `comment: str = ""`  
Permite enviar acompanhamento com apenas foto (sem texto).

### Bug 2 — Frontend: estado de comentário global (crítico)
**Arquivo:** `frontend/src/pages/service_orders/ServiceOrdersPage.tsx`  
`commentInput`, `commentPhotos` e `uploadingPhoto` são estado compartilhado entre todos os cards.  
**Efeito:** digitar num card e enviar de outro mistura os dados.  
**Fix:** estado keyed por `task.id`: `Record<string, { text: string; photos: string[] }>`.  
`setCommentPhotos([])` também não é chamado após submit — fix incluso.

---

## Escopo da entrega

### 1. Filtros e visualização padrão

**Default:** exibir tarefas com `due_date = hoje` + tarefas sem prazo ainda pendentes.  
**Navegação de data:** seletor "← [data] →" para ver outros dias sem trocar de aba.

Filtros adicionais na barra superior:
| Filtro | Tipo | Comportamento |
|--------|------|---------------|
| Status | Select | Todos / Pendente / Em andamento / Concluída |
| Responsável | Select | Usuários do grupo (API existente `/daily-tasks/users/group`) |
| Período | Date range (De / Até) | Filtra por `due_date` |

**Regra de exibição padrão:**
```
due_date = today  OR  (due_date IS NULL AND status != 'done')
```
ordenado por: atrasadas primeiro → sem prazo → por prazo ASC.

---

### 2. Novo status "Em andamento"

**Backend:**
- Adicionar `in_progress` no enum `daily_task_status` no schema SQL
- Migration: `ALTER TYPE daily_task_status ADD VALUE IF NOT EXISTS 'in_progress'`

**Frontend:**
- 3 estados com cores e ícones:
  - `pending` → ⬜ cinza — "Pendente"
  - `in_progress` → 🔄 amarelo/âmbar — "Em andamento"  
  - `done` → ✅ verde — "Concluída"
- Clique no ícone do card cicla: `pending → in_progress → done → pending`
- Filtro de status atualizado para incluir "Em andamento"

---

### 3. Acompanhamentos como chat/chamado

**Redesign visual (frontend only):**
- Layout de bolhas de chat:
  - Mensagem do usuário logado: bolha à direita, fundo azul claro
  - Mensagem de outros: bolha à esquerda, fundo cinza claro
- Avatar: círculo com inicial do nome do autor (cor baseada em hash do nome)
- Timestamp: relativo ("há 2h") com `title` = data/hora completa
- Fotos: thumbnail clicável com lightbox inline (sem lib externa — `<dialog>` nativo)
- Input redesenhado: textarea menor + botões "📷 Foto" e "Enviar" na mesma linha

**Fix bugs de estado:**
```tsx
// Antes (global — bug):
const [commentInput, setCommentInput] = useState('')
const [commentPhotos, setCommentPhotos] = useState<string[]>([])

// Depois (por task):
const [commentDraft, setCommentDraft] = useState<Record<string, { text: string; photos: string[] }>>({})
```

**Fix backend:**
```python
# AddCommentRequest
comment: str = ""  # era: comment: str
```

**Carregamento:** acompanhamentos carregam ao expandir o card (comportamento atual mantido). Novos aparecem ao final do thread sem reload completo.

---

### 4. PDF — Relatório por colaborador (one page each)

**Novo endpoint:**
```
GET /daily-tasks/report/pdf
Query params:
  date_from: str (YYYY-MM-DD, opcional)
  date_to:   str (YYYY-MM-DD, opcional)
  user_id:   UUID (opcional — filtra por colaborador)
```

**Geração:** fpdf2, padrão já usado em `reports.py` e `service_order_service.py`.

**Estrutura de cada página (A4 portrait):**
```
┌─────────────────────────────────────────────────┐
│ [Nome da Associação]    Período: DD/MM – DD/MM  │
│ Tarefas Diárias — Relatório de Entregas         │
├─────────────────────────────────────────────────┤
│ COLABORADOR: MONIQUE SILVA                      │
│ Totais: 3 tarefas · 7 entregas ✓ · 3 pendentes ✗│
├─────────────────────────────────────────────────┤
│ ▸ Ordens de serviço        Prazo: 27/05  [FEITA]│
│   ✓ ver as ordens de serviço                    │
│   ✗ conversar com o rapaz da casa de festa      │
│   ✗ pedir à comlurb o carrinho enferrujado      │
│                                                 │
│ ▸ Limpeza rua A          Prazo: 28/05  [ANDANDO]│
│   ✓ varrer calçada                              │
│   ✓ recolher lixo                               │
└─────────────────────────────────────────────────┘
```

**Regras:**
- 1 `add_page()` por colaborador
- Itens do checklist: ✓ entregue (preto) / ✗ não entregue (cinza/tachado)
- Tarefas sem checklist: mostrar título + status (sem sub-itens)
- Footer: "Gerado em DD/MM/YYYY HH:MM · APRXM"
- Ordenação: colaboradores por nome ASC; tarefas por `due_date` ASC

**Anexos no PDF:**
- **Imagens** (jpg/png/webp/gif): embutir como thumbnail `40×40 px` lado a lado (máx 4 por linha), usando `pdf.image()` do fpdf2. Fonte de dados: URL do Supabase Storage (fazer `requests.get(url)` → `BytesIO`).
- **Outros arquivos** (pdf, doc, xls…): exibir ícone 📎 + nome do arquivo truncado (máx 40 chars) + URL como link clicável (`pdf.cell(..., link=url)`).
- Anexos aparecem em dois lugares:
  1. **Abaixo da tarefa** (campo `attachment_urls` da tarefa)
  2. **Abaixo de cada acompanhamento** (`attachment_urls` do comment)
- Label separadora: `"Anexos:"` em fonte menor (8pt, cinza)
- Se URL não carregar (timeout 3s): exibir `[imagem indisponível]` sem quebrar o PDF

**Frontend — botão "Baixar PDF":**
- Substituir o botão "Relatório" (que abre a view interna) por dois botões:
  - `[📊 Ver relatório]` → mantém a view interna atual
  - `[📄 Baixar PDF]` → dispara GET com os filtros de data/período ativos, `window.open(url)` ou download via blob
- Filtros de data do relatório (De/Até) já existentes na view interna também alimentam o PDF

---

### 5. Formulário — Campos mais claros

Mudanças no `taskForm`:
- Label do checklist: **"Itens a entregar"** (era "Checklist")
- Instrução abaixo do label: `"Cada item representa uma entrega a confirmar"`
- Campo **"Status inicial"** (select) ao criar — default: Pendente
- Separador visual (`<hr>`) entre seções: Dados gerais / Itens a entregar / Vinculação / Anexos

---

## Fora de escopo

- Push notification por item de checklist individual
- Assinatura digital de entrega
- Integração com módulo de encomendas (packages)
- Comentários editáveis/deletáveis (post-MVP)

---

## Arquivos afetados

### Backend
| Arquivo | Mudança |
|---------|---------|
| `database/schema.sql` | Adicionar `in_progress` ao enum |
| `backend/app/routers/daily_tasks.py` | Fix `AddCommentRequest.comment`, novo endpoint `/report/pdf` |

### Frontend
| Arquivo | Mudança |
|---------|---------|
| `frontend/src/pages/service_orders/ServiceOrdersPage.tsx` | Filtros, status, chat UI, fix estado comentário, botão PDF |

---

## Ordem de implementação recomendada

1. Bug fixes (backend `comment` + frontend estado comentário)
2. Migration enum `in_progress`
3. Filtros + visualização por data
4. Redesign acompanhamentos (chat)
5. Formulário campos claros
6. Endpoint PDF + botão frontend
