# Relatório de Entregas — Design Spec
**Data:** 2026-05-06  
**Status:** Aprovado

---

## Visão Geral

Nova aba "Entregas" na página `/reports`. Consolida, por período e colaborador, todas as atividades entregues no sistema: tarefas concluídas, itens de checklist marcados, comentários/acompanhamentos, ordens de serviço concluídas e demandas concluídas. Destinado a gestores e colaboradores. Suporta exportação PDF, Excel e envio por e-mail.

---

## Fontes de Dados

| Fonte | Critério de "entrega" | Tabela / campo |
|---|---|---|
| Tarefa diária concluída | `status = 'done'` | `daily_tasks` |
| Item de checklist | item `done = true` no jsonb | `daily_tasks.checklist` |
| Comentário / acompanhamento | qualquer registro | `daily_task_comments` |
| Ordem de Serviço | `status = 'concluido'` E `updated_at` no período | `service_orders` |
| Demanda | `status = 'concluido'` E `updated_at` no período | `demands` |

> **Nota OS:** Sem histórico de transições de status. Usa `updated_at` como proxy da conclusão. Pode incluir OS que foram reabertas e reconclídas — aceito pelo usuário.

---

## Backend

### Endpoint GET

```
GET /reports/entregas
  ?date_from=YYYY-MM-DD
  &date_to=YYYY-MM-DD
  &user_id=UUID          (opcional — filtra um colaborador)
  &types=tarefas,checklist,comentarios,os,demandas  (opcional — padrão: todos)
```

**Autenticação:** JWT Bearer, isolamento por `association_id = ANY(:aids)` via `_group_assoc_ids`.

**Resposta:**
```json
[
  {
    "user_id": "uuid",
    "user_name": "Maria Silva",
    "total": 18,
    "by_type": {
      "tarefas": 3,
      "checklist": 8,
      "comentarios": 5,
      "os": 1,
      "demandas": 1
    },
    "items": [
      {
        "type": "tarefa|checklist|comentario|os|demanda",
        "title": "Texto descritivo",
        "date": "2026-05-05",
        "ref": "OS #142 | Tarefa X | null"
      }
    ]
  }
]
```

**Query:** 5 UNIONs com `UNION ALL`, todos filtrados por `association_id`, período e user opcional. Resultado agrupado em Python por `user_id`.

**Extração de checklist:** Para cada tarefa retornada com itens done, os itens são desnormalizados individualmente no Python (não no SQL) — evita jsonb unnest complexo.

### Endpoint POST Export

```
POST /reports/entregas/export
Body: {
  "format": "pdf" | "excel",
  "date_from": "YYYY-MM-DD",
  "date_to": "YYYY-MM-DD",
  "user_id": "uuid | null",
  "types": ["tarefas", ...],
  "email": "dest@exemplo.com | null"
}
```

- **PDF:** `fpdf2` — cabeçalho com período, tabela por colaborador, rodapé com total.
- **Excel:** `openpyxl` — uma aba por colaborador, colunas: Tipo | Título | Data | Referência.
- **E-mail:** Se `email` fornecido, envia o arquivo gerado como anexo após gerar. Usa o serviço de e-mail já existente no projeto.
- Retorna o arquivo como download direto (`StreamingResponse`) ou `{"ok": true}` se apenas e-mail.

---

## Frontend

### Localização
Nova aba "Entregas" em `frontend/src/pages/reports/ReportsPage.tsx`, seguindo o padrão das abas existentes.

### Filtros (topo da aba)
- **Período:** date_from / date_to (padrão: mês atual)
- **Colaborador:** dropdown com usuários do grupo (`GET /daily-tasks/users/group`)
- **Tipos:** checkboxes multi-select — Tarefas, Checklist, Comentários, OS, Demandas (todos marcados por padrão)

### Resumo Agregado
Banner/cards no topo com totais do período selecionado:
- Total de entregas | Tarefas | Checklist | Comentários | OS | Demandas

### Cards por Colaborador
- Cabeçalho: avatar com iniciais + nome + badge total de entregas
- Lista expandível de itens (por padrão mostra os 5 mais recentes, botão "ver mais")
- Ícone por tipo: `●` tarefa, `☑` checklist, `💬` comentário, `🔧` OS, `📋` demanda
- Cada item: ícone + título + data + referência (link para OS/tarefa se disponível)
- Ordenação dos cards: mais entregas primeiro

### Exportar
Botão "Exportar ▼" com dropdown:
- Baixar PDF
- Baixar Excel
- Enviar por e-mail → abre input de e-mail inline antes de confirmar

---

## Fluxo de Dados

```
ReportsPage (aba Entregas)
  → filtros alterados → GET /reports/entregas?...
  → resposta: array por usuário
  → resumo agregado calculado no frontend (soma dos by_type)
  → cards renderizados com expand/collapse
  → "Exportar" → POST /reports/entregas/export → download ou toast "e-mail enviado"
```

---

## Fora de Escopo

- Histórico de transições de status de OS (requer tabela de auditoria separada)
- Notificações automáticas periódicas (relatório sob demanda apenas)
- Comparativo entre períodos
