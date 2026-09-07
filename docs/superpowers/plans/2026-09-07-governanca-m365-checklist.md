# Checklist — Governança M365 / Entra ID (Grupos, Usuários, Teams)

Baseado no relatório organizacional original, com nomenclatura revisada em
2026-09-07 (prefixo por entidade: `ITP_`, `AM_`, ou `ITP_AM_` pros
compartilhados, em vez do genérico `GRP_`). Domínio confirmado:
`@institutotiapretinha.org` pra todo mundo (não há domínio `@cgn-vl.org`
verificado no tenant — se quiser usar esse domínio no futuro, é tarefa
separada: adicionar + verificar no M365 admin center).

Convenção: `[x]` já existe/feito · `[ ]` falta criar.

---

## 1. Usuários

### Já existem (5)
- [x] Bruno Duarte
- [x] Célia
- [x] Felipe Siqueira
- [x] Gabi/Gabriela Graciano
- [x] Gabriela Barbosa

### Faltam criar (14) — 13 criados em 2026-09-07, Erick pendente de confirmação

UPN sugerido = nome+sobrenome sem espaço, minúsculo, `@institutotiapretinha.org`
(mesmo padrão do `erickcardoso@...` já existente) — **confirmar sobrenome
completo de cada um antes de criar**, vários estão só com primeiro nome
na lista original.

| # | Nome | UPN sugerido | Grupo de destino |
|---|---|---|---|
| 1 | Hanyelle | `hanyelle@institutotiapretinha.org` | ITP_AM_Executiva_Geral |
| 2 | Carla | `carla@institutotiapretinha.org` | ITP_AM_Executiva_Geral |
| 3 | Erick | ⚠️ ver nota abaixo | ITP_AM_Admin_Tecnologia |
| 4 | Vinicius Façan | `viniciusfacan@institutotiapretinha.org` | AM_Gerencia |
| 5 | Monique | `monique@institutotiapretinha.org` | AM_Gerencia |
| 6 | Danielly | `danielly@institutotiapretinha.org` | AM_Operacao |
| 7 | Paulo Victor | `paulovictor@institutotiapretinha.org` | AM_Operacao |
| 8 | Fernanda Siqueira | `fernandasiqueira@institutotiapretinha.org` | AM_Operacao |
| 9 | Erica | `erica@institutotiapretinha.org` | ITP_Docentes |
| 10 | Ellen | `ellen@institutotiapretinha.org` | ITP_Docentes |
| 11 | Tico | `tico@institutotiapretinha.org` | ITP_Docentes |
| 12 | Lucas | `lucas@institutotiapretinha.org` | ITP_Docentes |
| 13 | Leo | `leo@institutotiapretinha.org` | ITP_Docentes |
| 14 | Daiana | `daiana@institutotiapretinha.org` | ITP_Cozinha |

**✅ Confirmado (2026-09-07)**: Erick = conta já existente `erickcardoso@institutotiapretinha.org`,
sem duplicata criada — usar essa conta ao montar o grupo `ITP_AM_Admin_Tecnologia`.

**Todos os 14 usuários resolvidos** — 13 criados + Erick já existente.

---

## 2. Grupos de Segurança (Entra ID)

Todos: **Tipo = Security**, **Associação = Assigned** (não Dynamic).

Nomes reais criados (2026-09-07) podem diferir levemente do planejado
originalmente — registrado como ficou de fato:

| # | Nome real criado | Descrição | Membros | Status |
|---|---|---|---|---|
| 1 | `ITP_AM_Executiva_Geral` | Acesso total a documentos estratégicos, financeiros, governança e diretoria de ambas as entidades | Célia, Hanyelle, Gabi Graciano, Carla, Felipe Siqueira | ✅ criado |
| 2 | `ITP_AM_ADMIN_TEC` (função só Tecnologia) | Acesso administrativo global de TI, infraestrutura Azure, banco de dados e gestão técnica dos sistemas | Erick (`erickcardoso@`), Bruno Duarte | ✅ criado |
| 3 | `ITP_AM_ADMINISTRACAO` (escopo ampliado: toda administração do Instituto **e** Associação, substitui o "Diretoria_Auxiliar" original) | Rotinas administrativas de ambas as entidades | Gabriela Barbosa (+ outros que fizerem sentido no escopo ampliado) | ✅ criado |
| 4 | `AM_GERENCIA` | Acesso a relatórios de gestão, direcionamento operacional e indicadores da Associação de Moradores | Vinicius Façan, Monique | ✅ criado |
| 5 | `AM_Operacao` | Acesso aos fluxos diários de atendimento, formulários e ferramentas operacionais da Associação | Danielly, Paulo Victor, Fernanda Siqueira | ✅ criado |
| 6 | `ITP_DOCENTES` | Acesso exclusivo ao material didático, cronogramas das aulas de informática e pastas de turmas | Erica, Ellen, Tico, Lucas, Leo | ✅ criado |
| 7 | `ITP_COZINHA` | Acesso restrito a avisos gerais, escalas e rotinas operacionais da cozinha do Instituto | Daiana | ✅ criado |

Achado à parte: já existiam 2 grupos anteriores, sem relação com este
plano — **"All Company"** (padrão do M365, todo tenant tem) e
**"Instituto Tia Pretinha"** (Microsoft 365 Group, e-mail
`contato@institutotiapretinha.org`, uso de contato geral) — não conflitam,
não precisam de ação.

---

## 3. Teams (depois dos grupos prontos)

4 Teams mapeados no relatório original (nomenclatura a confirmar se muda
também, ou mantém como está):

| Team | Foco | SharePoint |
|---|---|---|
| 🏛️ ITP & AM — Governança e Diretoria | Decisões estratégicas, parcerias, prestação de contas | Atas oficiais, estatutos, contratos, documentos jurídicos |
| 💻 ITP — Tecnologia e Sistemas | Gestão do ERP, infraestrutura Azure, integrações de API, suporte técnico | Documentação de arquitetura, manuais técnicos, artefatos de código |
| 🏠 Associação de Moradores — Gestão e Operação | Atendimento local, cadastros de famílias, demandas operacionais | Planilhas de atendimento, formulários de campo, registros |
| 🏫 Instituto Tia Pretinha — Educação e Apoio | Aulas de informática, suporte pedagógico, infraestrutura da sede | Material didático, listas de presença, escalas da cozinha |

Cada Team deve ter como membros o(s) grupo(s) de segurança correspondente(s)
— evita adicionar pessoa por pessoa de novo, os grupos já fazem esse
trabalho.

---

## Ordem de execução recomendada

1. [ ] Resolver a dúvida do Erick (duplicata ou não) antes de criar
2. [ ] Criar os 13 usuários restantes (confirmar sobrenomes antes)
3. [ ] Criar os 7 grupos de segurança, com todos os membros já existindo
4. [ ] Criar/ajustar os 4 Teams, associando os grupos como membros
5. [ ] (Futuro, tarefa separada) Avaliar domínio `@cgn-vl.org` se ainda
      fizer sentido usá-lo pra algum grupo específico
