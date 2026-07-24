# CLAUDE.md — APRXM

## Regras de comportamento

- Respostas curtas e diretas. Sem introduções, sem resumos finais.
- Não explique código a menos que explicitamente pedido.
- Não analise o projeto inteiro. Trabalhe apenas com os arquivos mencionados.
- Não repita contexto já dado no prompt.
- Retorne apenas trechos relevantes, nunca arquivos completos.
- Use diff quando a mudança for pontual.
- Sem comentários óbvios no código.
- Sem docstrings em funções simples.

---

## 🧠 Prioridade de Contexto

- Sempre seguir este CLAUDE.md antes de qualquer outra análise
- Não carregar múltiplos arquivos automaticamente
- Se faltar contexto, pedir ao usuário ao invés de assumir

---

## 📂 Estratégia de Leitura

- Trabalhar com **1 arquivo por vez**
- Só analisar múltiplos arquivos se explicitamente solicitado
- Nunca varrer diretórios
- Ignorar arquivos não mencionados
- Antes de ler um arquivo-fonte, seguir o fluxo do Serena MCP abaixo

---

## 🧭 Navegação de Código — Serena MCP (padrão obrigatório)

Serena é o mecanismo **primário** de navegação e entendimento de código neste repositório. Ele indexa símbolos (classes, funções, métodos) e suas relações — usá-lo antes de ler arquivos evita carregar código irrelevante no contexto.

**Fluxo obrigatório antes de qualquer leitura de arquivo-fonte:**

1. Localizar os símbolos relevantes primeiro via Serena (`get_symbols_overview`, `find_symbol`) — nunca abrir um arquivo "para ver o que tem dentro".
2. Para entender uma peça de código, usar Serena para inspecionar definição, referências, implementações, chamadores/chamados e dependências (`find_referencing_symbols`, `find_implementations`, `find_declaration`) — não repetir isso lendo o arquivo inteiro manualmente.
3. Preferir navegação semântica (símbolos) a busca textual. `Grep`/`grep` só quando a busca for por string literal sem estrutura de símbolo (ex.: texto de UI, valor de config).
4. Ler apenas o menor trecho de código necessário depois que o Serena já apontou o local exato (símbolo + arquivo + linha) — nunca o arquivo inteiro, salvo necessidade explícita.
5. Nunca varrer diretórios inteiros nem abrir arquivos completos "só para garantir", a menos que o Serena não tenha conseguido resolver a informação.
6. Reaproveitar descobertas já feitas na sessão (símbolos já localizados, referências já mapeadas) em vez de repetir buscas.
7. Ao editar código: primeiro identificar o(s) símbolo(s) afetado(s) via Serena, depois inspecionar somente a implementação necessária antes de editar (preferir `replace_symbol_body`/`insert_after_symbol`/`insert_before_symbol` a diffs manuais quando a edição for de um símbolo inteiro).
8. Cair para inspeção direta de arquivo **somente** quando o Serena não tiver informação suficiente ou quando a própria implementação (não a estrutura) precisar ser lida linha a linha.

**Por que esse fluxo existe:** reduz uso de contexto e consumo de tokens (lê-se só o necessário, não arquivos/diretórios inteiros), acelera a navegação em um repositório grande (30 routers, dezenas de milhares de linhas) e aumenta a precisão — encontrar o símbolo certo via referências é mais confiável que grep/leitura manual em arquivos deste tamanho (ex.: `finance.py` 92K, `daily_tasks.py` 56K).

Esta regra é permanente e vale para toda sessão neste repositório, não apenas quando solicitado.

---

## ⚡ Economia de Tokens (CRÍTICO)

- Limite padrão: respostas até 10 linhas
- Preferir apenas código quando possível
- Evitar explicações, mesmo implícitas
- Não sugerir alternativas múltiplas
- Não detalhar decisões

---

## 🧩 Modo de Resposta

Formato padrão:

1. Código (ou diff)
2. (Opcional) 1 linha de contexto

---

## 🚨 Regra Crítica

Se a tarefa envolver:
- múltiplos arquivos
- arquitetura
- refatoração ampla

→ NÃO executar direto  
→ pedir confirmação e escopo

---

## 🔁 Controle de Escopo

- Não expandir o escopo da tarefa
- Não antecipar próximas etapas
- Resolver apenas o que foi pedido

---

## Projeto

ERP/SaaS multi-tenant — Instituto Tia Pretinha (`c:\aprxm_sass`)

**Stack:**
- Backend: Python 3.10 / FastAPI / SQLModel / PostgreSQL (asyncpg)
- Frontend: React 18 / Vite / Tailwind CSS (mobile-first)
- Auth: JWT Bearer (`jose` + `passlib[bcrypt]`)
- Deploy: **Tudo na Vercel** (frontend + backend). `git push origin main` dispara deploy automático. `.vercel/project.json` aponta para `aprxm-sys_frontend`. Backend em `backend/vercel.json` via `@vercel/python`.

**Multi-tenancy:** toda tabela tem `association_id UUID NOT NULL`. Nunca bypassar esse filtro.

**Código em inglês. UI em pt-BR.**

---

## Estrutura relevante
backend/app/
main.py # FastAPI app + lifespan
config.py # Settings (pydantic-settings)
services/
finance_service.py # CashSession + Sangria
package_service.py # Package lifecycle + taxa R$2.50

frontend/src/
pages/
finance/FinancePage.tsx
packages/PackagesPage.tsx
components/
packages/SignaturePad.tsx
packages/PhotoCapture.tsx

database/schema.sql # DDL completo (enums, triggers, RLS)


---

## Módulos

| Módulo | Notas |
|--------|-------|
| Finance | CashSession open/close, Sangria (foto obrigatória), TransactionCategory, PaymentMethod |
| Logistics | Package: received → notified → delivered/returned; taxa R$2.50 se não-membro |
| Residents | `member` (CPF required) vs `guest`; `ResidentStatus` controla elegibilidade de taxa |
| OS | ServiceOrder + PDF (fpdf2); numeração auto-incremental por tenant |
| Mensalidades | `mensalidades` tabela principal. Pagamentos históricos (sem forma de pagamento) estão em `migration_payments` (campo `competencia`, não `reference_month`). Inadimplência usa `due_date < grace_cutoff` (não reference_month). `monthly_payment_day` no morador define o dia de vencimento; se NULL, usa padrão da geração. |

---

## Padrões

- 100% OOP, SOLID, Clean Architecture
- Lógica de negócio em `services/`
- Sem blobs binários no DB (usar Cloudinary/S3)
- Imports absolutos no backend
- Componentes React funcionais + hooks

---

## 🧱 Backend Rules

- Nunca quebrar isolamento por `association_id`
- Não mover lógica para controllers
- Services são a única fonte de regra de negócio

---

## 🎯 Frontend Rules

- Evitar re-render desnecessário
- Componentes pequenos e reutilizáveis
- Lógica fora do JSX quando possível

---

## 🔥 Instrução Final

Se a resposta passar de 10 linhas, reduzir automaticamente.  
Se possível, responder apenas com código.