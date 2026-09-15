# CLAUDE.md — APRXM

ERP/SaaS multi-tenant — Instituto Tia Pretinha (`c:\aprxm_sass`)

> 📐 **Detalhe técnico de arquitetura, domínios, incidentes e dívidas conhecidas:
> ver [ARQUITETURA.md](ARQUITETURA.md).** Este arquivo é só regra de trabalho.

---

## Regras de comportamento

- Respostas curtas e diretas. Sem introduções, sem resumos finais.
- Não explique código a menos que pedido.
- Não analise o projeto inteiro. Trabalhe só com os arquivos mencionados.
- Não repita contexto já dado no prompt.
- Retorne apenas trechos relevantes, nunca arquivos completos. Diff quando pontual.
- Sem comentário óbvio, sem docstring em função simples.
- Se a resposta passar de 10 linhas, reduzir.

---

## ⚡ Economia de tokens (crítico)

- Limite padrão: 10 linhas por resposta.
- Preferir só código. Sem explicação implícita, sem alternativas múltiplas.
- Formato: 1) código/diff 2) opcional 1 linha de contexto.

---

## 🧭 Navegação de código — Serena MCP (obrigatório)

Serena é o mecanismo **primário** de navegação. Antes de ler qualquer arquivo-fonte:

1. Localizar símbolos via `get_symbols_overview` / `find_symbol` — nunca abrir arquivo
   "pra ver o que tem dentro".
2. Entender uma peça via `find_referencing_symbols`, `find_implementations`,
   `find_declaration` — não relendo o arquivo inteiro.
3. Preferir navegação semântica a busca textual. `Grep` só para string literal sem
   estrutura de símbolo (texto de UI, valor de config).
4. Ler só o menor trecho necessário depois que o Serena apontou símbolo + arquivo + linha.
5. Nunca varrer diretório nem abrir arquivo completo "só para garantir".
6. Reaproveitar descobertas já feitas na sessão.
7. Ao editar: identificar símbolo via Serena, então preferir `replace_symbol_body` /
   `insert_after_symbol` a diff manual quando a edição for de um símbolo inteiro.

**Por quê:** repositório grande (30 routers, `finance.py` 92K, `daily_tasks.py` 56K).
Ler só o necessário economiza contexto e é mais preciso que grep.

---

## 🗄️ Banco de dados

Acesso via **MCP Neon** (projeto `APRXM`, id `shy-sun-98696640`). Existe também o
projeto `aprxm-analytics` (OLAP/Power BI) — não confundir.

- **DDL/UPDATE em massa exigem aprovação do usuário** — o classificador bloqueia.
  Uma statement por chamada (multi-statement é barrado).
- **Nunca bypassar `association_id`.** Não há RLS de rede de segurança.
- **Nunca `DROP ... CASCADE`** sem antes checar `pg_depend`. Já derrubou coluna de
  produção (incidente 020, ver ARQUITETURA.md §6).
- Migration real é `backend/app/db/migrations.py` + `SCHEMA_VERSION`, **não** os `.sql`
  em `database/migrations/` (histórico). Todo bloco precisa ser replay-safe —
  ao bumpar a versão, os anteriores reexecutam.
- Dados de teste/seed vivem em `database/seeds/`, nunca em `migrations/`.

---

## 🧱 Backend

- Regra de negócio **só** em `services/`. Router faz parsing/auth/auditoria/commit.
- Nunca quebrar isolamento por `association_id`.
- Filtro de produção: usar `PROD_ASSOC_FILTER` (`app/db/helpers.py`) — não replicar a string.
- Paginação real (`skip`/`limit` + `{total, items}`), nunca `LIMIT` fixo.
- Sem `except Exception: pass`. Logar com `logger.exception` + erro específico.
- Imports absolutos. Sem blob binário no banco (usar Cloudinary/R2).

---

## 🎯 Frontend

- Componentes funcionais + hooks, pequenos. Lógica fora do JSX.
- Evitar re-render: `useCallback` em `fetchFn` passado para tabela.
- Listas grandes precisam paginação server-side (moradores ~1.800, encomendas ~5.400).
- Sem `.catch(() => {})` silencioso — sempre feedback ao usuário.
- Acessibilidade: `aria-label` em botão só-ícone, `aria-sort` em cabeçalho ordenável.
- Mobile-first — o app roda em campo, no celular.

---

## 🚨 Escopo

Se a tarefa envolver múltiplos arquivos, arquitetura ou refatoração ampla:
**não executar direto** → pedir confirmação e escopo.

Não expandir escopo, não antecipar próximas etapas, resolver só o que foi pedido.

---

## Módulos — regras de negócio que não se deduz do código

| Módulo | Nota |
|---|---|
| **Mensalidades** | Pagamentos históricos em `migration_payments` (campo `competencia`, não `reference_month`). Inadimplência usa `due_date < grace_cutoff`. `monthly_payment_day` do morador define vencimento. |
| **Finance** | "Saldo em caixa" = receita−despesa de manual + migração + **sessões conferidas**. Sessão aberta nunca entra. Conferida usa `closing_balance − opening_balance` (valor físico), não recalcula por transação. |
| **Logistics** | received → notified → delivered/returned. Taxa R$ 2,50 se não-membro. Sangria exige foto. |
| **Residents** | `member` exige CPF, `guest` não. `ResidentStatus` controla elegibilidade de taxa. |
| **ESC/Escritório** | Usuários empresa-wide têm `association_id` NULL — lookups por `association_id` os excluem. Considerar sempre. |

---

## Stack

Python 3.10 · FastAPI · SQLModel · PostgreSQL (asyncpg) · React 18 · Vite · Tailwind
Auth: JWT Bearer (`jose` + `passlib[bcrypt]`). Deploy: Vercel (`git push origin main`).

## UI

Sem parágrafo explicativo de cálculo nas telas. Código em inglês, UI em pt-BR.
