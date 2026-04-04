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
- Deploy: Render (backend) + Vercel (frontend)

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