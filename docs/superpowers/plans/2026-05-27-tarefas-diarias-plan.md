# Implementation Plan: Tarefas Diárias — Redesign

**Date:** 2026-05-27
**Spec:** `docs/superpowers/specs/2026-05-27-tarefas-diarias-redesign.md`
**Agent:** implementation-planner

---

## Summary

Nine changes grouped into five layers: two bug fixes, one DB migration, frontend UX redesign (filters + status + chat UI + form), and a new PDF endpoint with frontend trigger. All backend changes land in `daily_tasks.py`. All frontend changes land inside the existing `TarefasDiariasTab` component in `ServiceOrdersPage.tsx`. No new files created anywhere.

**Key Decision:** The `daily_task_status` column is currently a plain `TEXT` with a CHECK constraint (the enum is not a named PostgreSQL TYPE — confirmed by absence of `daily_task_status` type in `schema.sql`). The migration therefore targets the CHECK constraint, not `ALTER TYPE`. The backend `list_tasks` query must also be extended to accept the new default filter (today + no-deadline pending) as a query-param mode rather than always filtering by explicit `status`.

---

## File Changes (2 files)

### Modified Files (2)

**1. `backend/app/routers/daily_tasks.py`**

- **Changes:**
  - Line 227: `AddCommentRequest.comment: str` → `comment: str = ""`
  - `list_tasks` endpoint: add query params `date_from`, `date_to`, `view` (`default` | `all`); when `view=default` apply the rule `due_date = today OR (due_date IS NULL AND status != 'done')`; update ORDER BY to put overdue first, then no-deadline, then by due_date ASC
  - New endpoint `GET /daily-tasks/report/pdf` — fpdf2, one page per collaborator, checklist ✓/✗, embedded image thumbnails, file links, acompanhamentos with attachments
  - The `report/pdf` route MUST be declared before `/{task_id}` to avoid FastAPI routing to the wrong handler (same as `report/by-user` already does)

**2. `frontend/src/pages/service_orders/ServiceOrdersPage.tsx`**

- **Changes (all inside `TarefasDiariasTab`):**
  - Interface `DailyTask.status`: `'pending' | 'done'` → `'pending' | 'in_progress' | 'done'`
  - Replace `commentInput`/`commentPhotos`/`uploadingPhoto` (3 flat state vars) with `commentDraft: Record<string, {text: string; photos: string[]; uploading: boolean}>`
  - Add state: `viewDate: string` (default = today), `filterAssigned: string`, `filterPeriodFrom: string`, `filterPeriodTo: string`
  - `load()`: pass `view=default` when no explicit date range; pass `date_from`/`date_to` when period filter active; pass `assigned_to` filter
  - `useEffect` deps: add `viewDate`, `filterAssigned`, `filterPeriodFrom`, `filterPeriodTo`
  - `toggleDone`: replace 2-state toggle with 3-state cycle: `pending → in_progress → done → pending`; rename to `cycleStatus`
  - Task card status button: show 3 states with color — pending=gray border, in_progress=amber fill `🔄`, done=green fill `✓`
  - Filter bar: add `← [viewDate] →` date navigator, responsável select, De/Até date inputs
  - Status filter select: add `<option value="in_progress">Em andamento</option>`
  - Acompanhamentos section: replace flat list with chat-bubble layout (right = current user, left = others); avatar circle with initial + color hash; relative timestamp with `title`; lightbox via `<dialog>` native (no lib)
  - Comment input area: textarea + "📷 Foto" + "Enviar" on same row, keyed to `task.id`
  - `handleCommentPhotoUpload`: use `commentDraft[taskId]` instead of global state
  - `submitComment`: use `commentDraft[taskId]`; clear `commentDraft[taskId]` after submit
  - `taskForm`: label "Checklist" → "Itens a entregar"; add sub-label "Cada item representa uma entrega a confirmar"; add "Status inicial" select (default Pendente); add `<hr>` separators between Dados gerais / Itens a entregar / Vinculação / Anexos
  - `handleSubmit`: include `status` from `fInitialStatus` when creating (not editing)
  - Report section: replace single "Relatório" button with two: `[📊 Ver relatório]` + `[📄 Baixar PDF]`; PDF button calls `GET /daily-tasks/report/pdf` with `date_from=reportFrom&date_to=reportTo` and opens via `window.open(url)`
  - Add `fInitialStatus` state var (string, default `'pending'`)
  - `resetForm()`: add `setFInitialStatus('pending')`

---

## Implementation Steps

**Prerequisites:**
- [ ] `git commit -m "chore: checkpoint pre-tarefas-redesign"` before starting

---

### Step 1 — Bug Fix: Backend `comment` field

**File:** `backend/app/routers/daily_tasks.py`, line 227

**Diff:**
```python
# Before
comment: str

# After
comment: str = ""
```

**Verification:** `curl -X POST /daily-tasks/{id}/comments -d '{"attachment_urls":["https://example.com/x.jpg"]}' -H "Authorization: Bearer ..."` must return 200 (not 422).

**Time:** 1 min

---

### Step 2 — Migration: Add `in_progress` status

**File:** `database/migrations/015_daily_tasks_in_progress.sql` (new file — exception to "no new files" rule: migrations are always separate files per project convention)

```sql
-- 015: add in_progress to daily_tasks status
DO $$
BEGIN
  -- If status column has a CHECK constraint, drop and recreate it
  ALTER TABLE daily_tasks DROP CONSTRAINT IF EXISTS daily_tasks_status_check;
  ALTER TABLE daily_tasks
    ADD CONSTRAINT daily_tasks_status_check
    CHECK (status IN ('pending', 'in_progress', 'done'));
END $$;
```

Also update `schema.sql`: add `'in_progress'` to the status CHECK on `daily_tasks` table.

Apply via `main.py` lifespan: add `ALTER TABLE daily_tasks DROP CONSTRAINT IF EXISTS daily_tasks_status_check; ALTER TABLE daily_tasks ADD CONSTRAINT ...` inside the startup block, or run the migration file directly against the DB.

**Verification:** `INSERT INTO daily_tasks (..., status) VALUES (..., 'in_progress')` succeeds.

**Time:** 5 min

---

### Step 3 — Backend: Extend `list_tasks` with default view + date/assigned filters

**File:** `backend/app/routers/daily_tasks.py`

Add to `list_tasks` signature:
```python
async def list_tasks(
    assigned_to: UUID | None = None,
    status: str | None = None,
    view: str | None = None,          # "default" triggers today + no-deadline logic
    date_from: str | None = None,
    date_to: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
```

Filter logic (append to `filters` list before building WHERE):
```python
from datetime import date as _date

if view == "default":
    today_str = str(_date.today())
    filters.append(
        "(t.due_date = :today OR (t.due_date IS NULL AND t.status != 'done'))"
    )
    params["today"] = today_str
else:
    if date_from:
        filters.append("t.due_date >= :df")
        params["df"] = date_from
    if date_to:
        filters.append("t.due_date <= :dt")
        params["dt"] = date_to
```

Update ORDER BY in the query:
```sql
ORDER BY
    CASE
        WHEN t.due_date < CURRENT_DATE AND t.status != 'done' THEN 0
        WHEN t.due_date IS NULL AND t.status != 'done' THEN 1
        ELSE 2
    END,
    t.due_date ASC NULLS LAST,
    t.created_at DESC
```

**Verification:** `GET /daily-tasks?view=default` returns only today's tasks + pending no-deadline tasks.

**Time:** 10 min

---

### Step 4 — Frontend: Bug Fix — keyed comment state + filter bar + date navigator

**File:** `frontend/src/pages/service_orders/ServiceOrdersPage.tsx`

**4a — State changes (replace 3 flat vars with keyed record):**

Remove:
```tsx
const [commentInput, setCommentInput] = useState('')
const [commentPhotos, setCommentPhotos] = useState<string[]>([])
const [uploadingPhoto, setUploadingPhoto] = useState(false)
```

Add:
```tsx
const [commentDraft, setCommentDraft] = useState<
  Record<string, { text: string; photos: string[]; uploading: boolean }>
>({})
const [viewDate, setViewDate] = useState(today)
const [filterAssigned, setFilterAssigned] = useState('')
const [filterPeriodFrom, setFilterPeriodFrom] = useState('')
const [filterPeriodTo, setFilterPeriodTo] = useState('')
const [fInitialStatus, setFInitialStatus] = useState('pending')
const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
```

Helper to get/set draft per task:
```tsx
const getDraft = (taskId: string) =>
  commentDraft[taskId] ?? { text: '', photos: [], uploading: false }

const setDraft = (taskId: string, patch: Partial<{ text: string; photos: string[]; uploading: boolean }>) =>
  setCommentDraft(prev => ({ ...prev, [taskId]: { ...getDraft(taskId), ...patch } }))
```

**4b — Update `load()` to use view/date params:**
```tsx
const load = async () => {
  setLoading(true)
  try {
    const params: any = {}
    if (filterStatus) params.status = filterStatus
    if (filterAssigned) params.assigned_to = filterAssigned
    if (filterPeriodFrom || filterPeriodTo) {
      if (filterPeriodFrom) params.date_from = filterPeriodFrom
      if (filterPeriodTo) params.date_to = filterPeriodTo
    } else {
      params.view = 'default'
      params.date_from = viewDate
      params.date_to = viewDate
      // backend view=default overrides the date when no-deadline pending
    }
    const res = await api.get<DailyTask[]>('/daily-tasks', { params })
    setTasks(res.data)
  } catch { toast.error('Erro ao carregar tarefas.') }
  finally { setLoading(false) }
}
```

Note: when `view=default` is active, `date_from`/`date_to` are sent as the `viewDate` but the backend `view=default` logic takes precedence — the date params are ignored in that branch. Simplification: pass only `view=default` when no period filter active.

Corrected `load()`:
```tsx
const load = async () => {
  setLoading(true)
  try {
    const params: any = {}
    if (filterStatus) params.status = filterStatus
    if (filterAssigned) params.assigned_to = filterAssigned
    if (filterPeriodFrom || filterPeriodTo) {
      if (filterPeriodFrom) params.date_from = filterPeriodFrom
      if (filterPeriodTo) params.date_to = filterPeriodTo
    } else {
      params.view = 'default'
    }
    const res = await api.get<DailyTask[]>('/daily-tasks', { params })
    setTasks(res.data)
  } catch { toast.error('Erro ao carregar tarefas.') }
  finally { setLoading(false) }
}
```

Update useEffect:
```tsx
useEffect(() => { load() }, [filterStatus, filterAssigned, filterPeriodFrom, filterPeriodTo, viewDate])
```

**4c — `handleCommentPhotoUpload` and `submitComment` rewrite:**
```tsx
const handleCommentPhotoUpload = async (taskId: string, e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0]
  if (!file) return
  setDraft(taskId, { uploading: true })
  try {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('folder', 'task-comments')
    const res = await api.post<{ url: string }>('/uploads', fd)
    setDraft(taskId, { photos: [...getDraft(taskId).photos, res.data.url], uploading: false })
  } catch { toast.error('Erro ao enviar foto.') ; setDraft(taskId, { uploading: false }) }
  finally { e.target.value = '' }
}

const submitComment = async (taskId: string) => {
  const draft = getDraft(taskId)
  if (!draft.text.trim() && draft.photos.length === 0) return
  setSavingComment(true)
  try {
    const res = await api.post<TaskComment>(`/daily-tasks/${taskId}/comments`, {
      comment: draft.text.trim(),
      attachment_urls: draft.photos,
    })
    setComments(prev => ({ ...prev, [taskId]: [...(prev[taskId] || []), res.data] }))
    setDraft(taskId, { text: '', photos: [] })
  } catch { toast.error('Erro ao salvar acompanhamento.') }
  finally { setSavingComment(false) }
}
```

**4d — Filter bar JSX (replace existing `<select value={filterStatus}...>` block):**

Add before the status select:
```tsx
{/* Date navigator */}
<div className="flex items-center gap-1">
  <button onClick={() => {
    const d = new Date(viewDate + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    setViewDate(d.toISOString().slice(0, 10))
    setFilterPeriodFrom(''); setFilterPeriodTo('')
  }} className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">←</button>
  <span className="text-sm font-medium text-gray-700 px-2">
    {viewDate === today ? 'Hoje' : new Date(viewDate + 'T12:00:00').toLocaleDateString('pt-BR')}
  </span>
  <button onClick={() => {
    const d = new Date(viewDate + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    setViewDate(d.toISOString().slice(0, 10))
    setFilterPeriodFrom(''); setFilterPeriodTo('')
  }} className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">→</button>
</div>

{/* Status filter */}
<select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white">
  <option value="">Todos</option>
  <option value="pending">Pendentes</option>
  <option value="in_progress">Em andamento</option>
  <option value="done">Concluídas</option>
</select>

{/* Responsável filter */}
<select value={filterAssigned} onChange={e => setFilterAssigned(e.target.value)}
  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white">
  <option value="">Todos responsáveis</option>
  {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
</select>

{/* Period filter */}
<div className="flex items-center gap-1">
  <input type="date" value={filterPeriodFrom}
    onChange={e => { setFilterPeriodFrom(e.target.value); setViewDate(today) }}
    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" placeholder="De" />
  <span className="text-xs text-gray-400">–</span>
  <input type="date" value={filterPeriodTo}
    onChange={e => { setFilterPeriodTo(e.target.value); setViewDate(today) }}
    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" placeholder="Até" />
</div>
```

**Verification:** Change date navigator, see tasks reload. Status filter "Em andamento" appears.

**Time:** 20 min

---

### Step 5 — Frontend: 3-state status cycle on cards

**File:** `ServiceOrdersPage.tsx`

Replace `toggleDone`:
```tsx
const cycleStatus = async (task: DailyTask) => {
  const cycle: DailyTask['status'][] = ['pending', 'in_progress', 'done']
  const idx = cycle.indexOf(task.status)
  const newStatus = cycle[(idx + 1) % cycle.length]
  try {
    await api.patch(`/daily-tasks/${task.id}`, { status: newStatus })
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
  } catch { toast.error('Erro ao atualizar.') }
}
```

Update card status button JSX (replace `onClick={() => toggleDone(task)}`):
```tsx
<button
  onClick={() => cycleStatus(task)}
  title={task.status === 'pending' ? 'Pendente — clique para iniciar' : task.status === 'in_progress' ? 'Em andamento — clique para concluir' : 'Concluída — clique para reabrir'}
  className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition text-xs
    ${task.status === 'done' ? 'bg-green-500 border-green-500 text-white' :
      task.status === 'in_progress' ? 'bg-amber-400 border-amber-400 text-white' :
      'border-gray-400 hover:border-[#26619c]'}`}
>
  {task.status === 'done' ? '✓' : task.status === 'in_progress' ? '🔄' : ''}
</button>
```

Update card border/bg classes to handle `in_progress`:
```tsx
className={`rounded-xl border shadow-sm overflow-hidden ${
  task.status === 'done' ? 'border-gray-200 bg-gray-50' :
  task.status === 'in_progress' ? 'border-amber-200 bg-amber-50/30' :
  isOverdue ? 'border-red-200 bg-red-50/30' :
  'border-gray-200 bg-white'
}`}
```

**Verification:** Click status button on a card — cycles through 3 states visually and persists on reload.

**Time:** 10 min

---

### Step 6 — Frontend: Chat-bubble acompanhamentos + lightbox

**File:** `ServiceOrdersPage.tsx`

Helper functions (add above the return in `TarefasDiariasTab`):

```tsx
// Avatar color from name hash
const avatarColor = (name: string) => {
  const colors = ['#26619c', '#7c3aed', '#059669', '#dc2626', '#d97706', '#0891b2']
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  return colors[hash % colors.length]
}

// Relative timestamp
const relTime = (isoStr: string) => {
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}
```

Lightbox (add before the closing `</div>` of `TarefasDiariasTab` return):
```tsx
{lightboxUrl && (
  <dialog
    open
    onClick={() => setLightboxUrl(null)}
    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center w-full h-full max-w-none m-0 p-4 border-0"
  >
    <img src={lightboxUrl} alt="" className="max-w-full max-h-full object-contain rounded" onClick={e => e.stopPropagation()} />
  </dialog>
)}
```

Replace acompanhamentos section in card expanded area:
```tsx
{/* Acompanhamentos — chat layout */}
<div className="flex flex-col gap-2 pt-1">
  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Acompanhamentos</p>
  <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
    {(comments[task.id] || []).map(c => {
      const isMe = c.author_name === currentUserName  // see note below
      return (
        <div key={c.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold"
            style={{ backgroundColor: avatarColor(c.author_name) }}
          >
            {c.author_name.charAt(0).toUpperCase()}
          </div>
          <div className={`max-w-[75%] rounded-2xl px-3 py-2 flex flex-col gap-1 ${isMe ? 'bg-blue-100 rounded-br-sm' : 'bg-gray-100 rounded-bl-sm'}`}>
            {!isMe && <span className="text-[10px] font-semibold text-gray-500">{c.author_name}</span>}
            {c.comment && <p className="text-xs text-gray-700 whitespace-pre-wrap">{c.comment}</p>}
            {c.attachment_urls?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {c.attachment_urls.map((url, i) =>
                  url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                    ? <img key={i} src={url} alt="" onClick={() => setLightboxUrl(url)}
                        className="h-12 w-12 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80" />
                    : <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1">📎 {url.split('/').pop()}</a>
                )}
              </div>
            )}
            <span
              className="text-[10px] text-gray-400 self-end"
              title={new Date(c.created_at).toLocaleString('pt-BR')}
            >
              {relTime(c.created_at)}
            </span>
          </div>
        </div>
      )
    })}
  </div>

  {/* Comment input */}
  <div className="flex flex-col gap-1.5 mt-1">
    <textarea
      value={getDraft(task.id).text}
      onChange={e => setDraft(task.id, { text: e.target.value })}
      placeholder="Adicionar acompanhamento..."
      rows={2}
      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#26619c]"
    />
    {getDraft(task.id).photos.length > 0 && (
      <div className="flex flex-wrap gap-2">
        {getDraft(task.id).photos.map((url, i) =>
          url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
            ? <img key={i} src={url} alt="" className="h-12 w-12 object-cover rounded border border-gray-200" />
            : <span key={i} className="text-xs text-blue-600">📎 {url.split('/').pop()}</span>
        )}
      </div>
    )}
    <div className="flex items-center gap-2">
      <label className={`text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white cursor-pointer hover:bg-gray-50 transition flex items-center gap-1 ${getDraft(task.id).uploading ? 'opacity-50' : ''}`}>
        📷 {getDraft(task.id).uploading ? 'Enviando...' : 'Foto'}
        <input type="file" accept="image/*" className="hidden"
          onChange={e => handleCommentPhotoUpload(task.id, e)}
          disabled={getDraft(task.id).uploading} />
      </label>
      <button
        onClick={() => submitComment(task.id)}
        disabled={savingComment || (!getDraft(task.id).text.trim() && getDraft(task.id).photos.length === 0)}
        className="text-xs px-3 py-1.5 bg-[#26619c] text-white rounded-lg hover:bg-[#1a4a7a] disabled:opacity-40 transition"
      >
        {savingComment ? 'Salvando...' : 'Enviar'}
      </button>
    </div>
  </div>
</div>
```

**Note on `currentUserName`:** The `TarefasDiariasTab` component does not currently receive the current user's name. Options (choose simplest):
- Option A: Pass `currentUserName: string` as prop from `ServiceOrdersPage` (requires reading from `useAuthStore()` there).
- Option B: Store the current user's name in a `useRef` set after first comment POST response.
- **Recommended (Option A):** `useAuthStore()` already exposes `role` — check if it also exposes `full_name`. If yes, read it directly inside `TarefasDiariasTab`. If not, pass as prop.

**Verification:** Post a comment → appears as right-aligned blue bubble. Another user's comment → left-aligned gray bubble. Click image thumbnail → lightbox opens. Click outside → closes.

**Time:** 25 min

---

### Step 7 — Frontend: Improved task form

**File:** `ServiceOrdersPage.tsx`

Changes inside `taskForm` const:

1. Add `fInitialStatus` state (already added in Step 4 state block).

2. Add to `resetForm()`: `setFInitialStatus('pending')`

3. Replace label "Checklist":
```tsx
// Before
<label className="block text-xs text-gray-600 mb-1">Checklist</label>

// After
<label className="block text-xs text-gray-600 mb-1">Itens a entregar</label>
<p className="text-[10px] text-gray-400 -mt-0.5 mb-1">Cada item representa uma entrega a confirmar</p>
```

4. Add `<hr className="border-gray-200" />` between: Dados gerais block / Itens a entregar block / Vinculação block / Anexos block.

5. Add "Status inicial" select (only show when `!editingId`):
```tsx
{!editingId && (
  <div>
    <label className="block text-xs text-gray-600 mb-1">Status inicial</label>
    <select value={fInitialStatus} onChange={e => setFInitialStatus(e.target.value)} className={inputCls}>
      <option value="pending">Pendente</option>
      <option value="in_progress">Em andamento</option>
    </select>
  </div>
)}
```

6. In `handleSubmit`, add `status: fInitialStatus` to body when `!editingId`:
```tsx
if (!editingId) {
  body.status = fInitialStatus
}
```

**Verification:** Create task → status field visible. Edit task → status field hidden. `<hr>` separators visible.

**Time:** 10 min

---

### Step 8 — Backend: PDF endpoint

**File:** `backend/app/routers/daily_tasks.py`

Add import at top:
```python
import requests as _requests
from io import BytesIO as _BytesIO
from datetime import datetime as _datetime
```

Add before `@router.get("/{task_id}/comments")` (keep `/report/pdf` before `/{task_id}` path):

```python
@router.get("/report/pdf", summary="PDF por colaborador")
async def report_pdf(
    date_from: str | None = None,
    date_to: str | None = None,
    user_id: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from fastapi.responses import Response
    from fpdf import FPDF

    aids = await _group_assoc_ids(str(current.association_id), session)

    # Fetch association name
    assoc_row = (await session.execute(
        text("SELECT name FROM associations WHERE id = :aid"),
        {"aid": str(current.association_id)},
    )).fetchone()
    assoc_name = assoc_row[0] if assoc_row else "Associação"

    # Build filters
    import json as _json
    params: dict = {"aids": aids}
    df_filter = dt_filter = ""
    if date_from:
        df_filter = " AND t.due_date >= :df"
        params["df"] = date_from
    if date_to:
        dt_filter = " AND t.due_date <= :dt"
        params["dt"] = date_to
    user_filter = ""
    if user_id:
        user_filter = " AND COALESCE(t.assigned_to, t.created_by) = :uid"
        params["uid"] = user_id

    # Fetch tasks grouped by collaborator
    rows = (await session.execute(text(f"""
        SELECT
            u.id AS user_id,
            u.full_name AS user_name,
            t.id, t.title, t.status, t.due_date,
            t.checklist, t.attachment_urls, t.service_order_title
        FROM users u
        JOIN daily_tasks t ON u.id = COALESCE(t.assigned_to, t.created_by)
        WHERE t.association_id = ANY(:aids)
          AND u.association_id = ANY(:aids)
          {df_filter}{dt_filter}{user_filter}
        ORDER BY u.full_name ASC, t.due_date ASC NULLS LAST
    """), params)).fetchall()

    # Fetch comments for these tasks
    task_ids = list({str(r[2]) for r in rows})
    comments_map: dict = {}
    if task_ids:
        c_rows = (await session.execute(text("""
            SELECT c.task_id, c.comment, c.attachment_urls, c.created_at, u.full_name
            FROM daily_task_comments c
            JOIN users u ON u.id = c.created_by
            WHERE c.task_id = ANY(:tids)
            ORDER BY c.created_at ASC
        """), {"tids": task_ids})).fetchall()
        for cr in c_rows:
            tid = str(cr[0])
            comments_map.setdefault(tid, []).append({
                "comment": cr[1], "attachment_urls": cr[2] or [],
                "created_at": str(cr[3])[:16], "author_name": cr[4],
            })

    # Group tasks by user
    from collections import OrderedDict
    users_map: OrderedDict = OrderedDict()
    for r in rows:
        uid = str(r[0])
        if uid not in users_map:
            users_map[uid] = {"user_name": r[1], "tasks": []}
        tid = str(r[2])
        if not any(t["id"] == tid for t in users_map[uid]["tasks"]):
            checklist = r[6]
            if isinstance(checklist, str):
                try: checklist = _json.loads(checklist)
                except: checklist = []
            att = r[7]
            if isinstance(att, str):
                try: att = _json.loads(att)
                except: att = []
            users_map[uid]["tasks"].append({
                "id": tid, "title": r[3], "status": r[4],
                "due_date": str(r[5]) if r[5] else None,
                "checklist": checklist or [], "attachment_urls": att or [],
                "so_title": r[8],
            })

    # Build PDF
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)

    period_label = ""
    if date_from or date_to:
        df_fmt = date_from.replace("-", "/")[:5][::-1].replace("/", "/") if date_from else "—"
        dt_fmt = date_to.replace("-", "/")[:5][::-1].replace("/", "/") if date_to else "—"
        # proper formatting dd/mm
        def fmt_date(d: str) -> str:
            parts = d.split("-")
            return f"{parts[2]}/{parts[1]}" if len(parts) == 3 else d
        period_label = f"Período: {fmt_date(date_from) if date_from else '—'} – {fmt_date(date_to) if date_to else '—'}"

    STATUS_LABEL = {"pending": "PENDENTE", "in_progress": "ANDANDO", "done": "FEITA"}
    IS_IMAGE = lambda url: bool(url and url.lower().split("?")[0].endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")))

    def embed_attachments(pdf: FPDF, urls: list):
        if not urls:
            return
        pdf.set_font("Helvetica", size=8)
        pdf.set_text_color(150, 150, 150)
        pdf.cell(0, 5, "Anexos:", ln=True)
        pdf.set_text_color(0, 0, 0)
        images = [u for u in urls if IS_IMAGE(u)]
        files = [u for u in urls if not IS_IMAGE(u)]
        if images:
            x_start = pdf.get_x()
            y = pdf.get_y()
            col = 0
            for img_url in images:
                try:
                    r = _requests.get(img_url, timeout=3)
                    r.raise_for_status()
                    buf = _BytesIO(r.content)
                    if col > 0 and col % 4 == 0:
                        y += 12
                        x_start = pdf.l_margin
                        col = 0
                    pdf.image(buf, x=x_start + col * 12, y=y, w=10, h=10)
                    col += 1
                except Exception:
                    pdf.set_font("Helvetica", size=7)
                    pdf.set_text_color(200, 50, 50)
                    pdf.cell(0, 4, "[imagem indisponível]", ln=True)
                    pdf.set_text_color(0, 0, 0)
            pdf.set_y(y + 12)
        for file_url in files:
            name = file_url.split("/")[-1][:40]
            pdf.set_font("Helvetica", size=8)
            pdf.set_text_color(40, 80, 200)
            pdf.cell(0, 5, f"📎 {name}", link=file_url, ln=True)
            pdf.set_text_color(0, 0, 0)

    for uid, entry in users_map.items():
        pdf.add_page()

        # Header
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 7, assoc_name, ln=False)
        if period_label:
            pdf.set_font("Helvetica", size=9)
            pdf.set_text_color(100, 100, 100)
            pdf.cell(0, 7, period_label, ln=True, align="R")
            pdf.set_text_color(0, 0, 0)
        else:
            pdf.ln()
        pdf.set_font("Helvetica", size=10)
        pdf.cell(0, 5, "Tarefas Diárias — Relatório de Entregas", ln=True)
        pdf.ln(3)

        # Collaborator block
        pdf.set_fill_color(240, 244, 255)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 8, f"COLABORADOR: {entry['user_name'].upper()}", fill=True, ln=True)

        tasks = entry["tasks"]
        total_items = sum(len(t["checklist"]) for t in tasks)
        done_items = sum(sum(1 for i in t["checklist"] if i.get("done")) for t in tasks)
        pending_items = total_items - done_items
        pdf.set_font("Helvetica", size=9)
        pdf.cell(0, 6, f"Totais: {len(tasks)} tarefa(s)  ·  {done_items} entrega(s) ✓  ·  {pending_items} pendente(s) ✗", ln=True)
        pdf.ln(2)

        for task in tasks:
            status_badge = STATUS_LABEL.get(task["status"], task["status"].upper())
            due_str = ""
            if task["due_date"]:
                parts = task["due_date"].split("-")
                due_str = f"  Prazo: {parts[2]}/{parts[1]}" if len(parts) == 3 else task["due_date"]

            pdf.set_font("Helvetica", "B", 10)
            pdf.set_fill_color(230, 240, 255)
            title_text = f"▸ {task['title']}{due_str}"
            pdf.cell(0, 7, f"{title_text}  [{status_badge}]", fill=True, ln=True)

            if task["so_title"]:
                pdf.set_font("Helvetica", "I", 8)
                pdf.set_text_color(80, 80, 180)
                pdf.cell(0, 5, f"  OS: {task['so_title']}", ln=True)
                pdf.set_text_color(0, 0, 0)

            pdf.set_font("Helvetica", size=9)
            if task["checklist"]:
                for item in task["checklist"]:
                    mark = "✓" if item.get("done") else "✗"
                    pdf.cell(0, 5, f"    {mark} {item['text']}", ln=True)
            else:
                pdf.set_text_color(120, 120, 120)
                pdf.cell(0, 5, f"    (sem itens de entrega — status: {status_badge})", ln=True)
                pdf.set_text_color(0, 0, 0)

            embed_attachments(pdf, task["attachment_urls"])

            # Acompanhamentos
            task_comments = comments_map.get(task["id"], [])
            if task_comments:
                pdf.set_font("Helvetica", "I", 8)
                pdf.set_text_color(80, 80, 80)
                pdf.cell(0, 5, "  Acompanhamentos:", ln=True)
                pdf.set_text_color(0, 0, 0)
                for c in task_comments:
                    pdf.set_font("Helvetica", size=8)
                    pdf.cell(0, 4, f"    [{c['created_at']}] {c['author_name']}: {c['comment'][:80]}", ln=True)
                    embed_attachments(pdf, c["attachment_urls"])

            pdf.ln(1)

        # Footer
        pdf.set_y(-12)
        pdf.set_font("Helvetica", size=7)
        pdf.set_text_color(150, 150, 150)
        now_str = _datetime.utcnow().strftime("%d/%m/%Y %H:%M")
        pdf.cell(0, 5, f"Gerado em {now_str} · APRXM", ln=True, align="C")

    buf = _BytesIO()
    buf.write(bytes(pdf.output()))
    buf.seek(0)
    filename = f"tarefas_{date_from or 'all'}_{date_to or 'all'}.pdf"
    return Response(
        content=buf.read(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
```

**Route ordering note:** `report/pdf` must be declared BEFORE `/{task_id}` in the file (currently `report/by-user` is already declared in that position — add `report/pdf` right after it or alongside it).

**Verification:** `GET /daily-tasks/report/pdf?date_from=2026-05-01&date_to=2026-05-27` returns a binary PDF response. Open it — one page per collaborator, checklist items with ✓/✗.

**Time:** 40 min

---

### Step 9 — Frontend: Replace single "Relatório" button with two buttons

**File:** `ServiceOrdersPage.tsx`

Replace:
```tsx
<button onClick={() => { setShowReport(true); loadReport() }}
  className="ml-auto flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
  <FileText className="w-4 h-4" /> Relatório
</button>
```

With:
```tsx
<div className="ml-auto flex items-center gap-2">
  <button onClick={() => { setShowReport(true); loadReport() }}
    className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
    <FileText className="w-4 h-4" /> Ver relatório
  </button>
  <button onClick={() => {
    const params = new URLSearchParams()
    if (reportFrom) params.set('date_from', reportFrom)
    if (reportTo) params.set('date_to', reportTo)
    const base = import.meta.env.VITE_API_URL ?? ''
    window.open(`${base}/api/daily-tasks/report/pdf?${params.toString()}`)
  }}
    className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
    📄 Baixar PDF
  </button>
</div>
```

**Note:** `window.open` without auth header won't work if the endpoint requires JWT. Alternative: fetch as blob and trigger download:
```tsx
const downloadPdf = async () => {
  try {
    const params: any = {}
    if (reportFrom) params.date_from = reportFrom
    if (reportTo) params.date_to = reportTo
    const res = await api.get('/daily-tasks/report/pdf', { params, responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `tarefas_${reportFrom ?? 'all'}_${reportTo ?? 'all'}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch { toast.error('Erro ao gerar PDF.') }
}
```

Use `downloadPdf()` on button click (blob approach is correct since API uses Bearer auth).

**Verification:** Click "Baixar PDF" → browser downloads a `.pdf` file.

**Time:** 10 min

---

### Step 10 — Frontend: Filtros completos na barra de relatório + botão PDF

**File:** `ServiceOrdersPage.tsx`

Na view de relatório (`showReport`), adicionar filtro de operador + botão PDF:
```tsx
<div className="flex gap-2 items-end flex-wrap">
  <div>
    <label className="block text-xs text-gray-500 mb-1">De</label>
    <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} className={inputCls} />
  </div>
  <div>
    <label className="block text-xs text-gray-500 mb-1">Até</label>
    <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} className={inputCls} />
  </div>
  <div>
    <label className="block text-xs text-gray-500 mb-1">Operador</label>
    <select value={reportUserId} onChange={e => setReportUserId(e.target.value)} className={inputCls}>
      <option value="">Todos</option>
      {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
    </select>
  </div>
  <button onClick={loadReport} disabled={loadingReport}
    className="px-4 py-2 bg-[#26619c] text-white rounded-xl text-sm font-medium disabled:opacity-50">
    {loadingReport ? 'Carregando…' : 'Gerar'}
  </button>
  <button onClick={downloadPdf}
    className="flex items-center gap-1.5 border border-gray-200 px-3 py-2 rounded-xl text-sm hover:bg-gray-50">
    📄 Baixar PDF
  </button>
</div>
```

Adicionar estado `reportUserId`:
```tsx
const [reportUserId, setReportUserId] = useState('')
```

`downloadPdf` passa `reportUserId` e usa blob (Bearer auth):
```tsx
const downloadPdf = async () => {
  try {
    const params: any = {}
    if (reportFrom) params.date_from = reportFrom
    if (reportTo) params.date_to = reportTo
    if (reportUserId) params.user_id = reportUserId
    const res = await api.get('/daily-tasks/report/pdf', { params, responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `tarefas_${reportFrom || 'all'}_${reportTo || 'all'}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch { toast.error('Erro ao gerar PDF.') }
}
```

`loadReport` também passa `reportUserId` para a view interna:
```tsx
const res = await api.get('/daily-tasks/report/by-user', {
  params: { date_from: reportFrom, date_to: reportTo, user_id: reportUserId || undefined }
})
```

**Verificação:** Filtrar por operador + período → "Gerar" atualiza a view; "Baixar PDF" baixa arquivo filtrado pelo operador selecionado.

---

**Total Estimated Time:** ~2h15

---

## Risks & Mitigations

### Risk 1 — `daily_tasks` status column type unknown
- **Probability:** Medium
- **Impact:** Migration fails
- **Mitigation:** The migration SQL uses `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` — safe for both TEXT+CHECK and for a named enum type. If it's a named enum, add `ALTER TYPE daily_task_status ADD VALUE IF NOT EXISTS 'in_progress'` before the constraint block.
- **Detection:** Check with `\d daily_tasks` in psql before running migration.

### Risk 2 — `report/pdf` route shadowed by `/{task_id}`
- **Probability:** High if not careful
- **Impact:** 404 or 422 on PDF endpoint
- **Mitigation:** Place `report/pdf` route definition before any `/{task_id}` route in the file. Already handled by putting it adjacent to `report/by-user`.

### Risk 3 — PDF image embed fails for Supabase URLs
- **Probability:** Medium (CORS/auth on Supabase storage)
- **Impact:** `[imagem indisponível]` shown in PDF — acceptable
- **Mitigation:** `try/except` with 3s timeout already in plan. No PDF crash.

### Risk 4 — `currentUserName` not available in `TarefasDiariasTab`
- **Probability:** High
- **Impact:** All bubbles render as left-aligned (no "is me" detection)
- **Mitigation:** Check `useAuthStore()` for `full_name`. If absent, pass as prop. Fallback: skip "is me" detection — all bubbles left-aligned, still correct functionally.

### Risk 5 — `requests` library not installed in backend
- **Probability:** Low (commonly installed)
- **Impact:** PDF endpoint crashes on image embed
- **Mitigation:** Check `requirements.txt`. If absent, add `requests>=2.31` or use `httpx` (likely already present for async calls).

---

## Rollback Plan

```bash
git reset --hard <checkpoint-commit-hash>
```

For migration only:
```sql
ALTER TABLE daily_tasks DROP CONSTRAINT IF EXISTS daily_tasks_status_check;
ALTER TABLE daily_tasks ADD CONSTRAINT daily_tasks_status_check CHECK (status IN ('pending', 'done'));
UPDATE daily_tasks SET status = 'pending' WHERE status = 'in_progress';
```

---

## Success Criteria

- Bug 1: POST comment with only photo (no text) returns 200
- Bug 2: Typing in card A then submitting card B sends empty text for B
- Migration: status `in_progress` accepted by DB
- Filters: date navigator changes task list; responsável filter works; period filter overrides default view
- Status cycle: clicking cycles pending → in_progress → done → pending with correct colors
- Chat UI: bubbles render; lightbox opens on image click; relative timestamps shown
- Form: "Itens a entregar" label; status inicial field; `<hr>` separators visible
- PDF endpoint: returns valid PDF binary; 1 page per collaborator; checklist ✓/✗ visible
- Download button: triggers file download with Bearer auth

---

## References

- Spec: `docs/superpowers/specs/2026-05-27-tarefas-diarias-redesign.md`
- Backend router: `backend/app/routers/daily_tasks.py`
- Frontend component: `frontend/src/pages/service_orders/ServiceOrdersPage.tsx` (line 1771)
- PDF pattern: `backend/app/services/service_order_service.py` (line 154)
- Migration convention: `database/migrations/NNN_description.sql`
