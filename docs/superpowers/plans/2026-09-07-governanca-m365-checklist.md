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

## 2b. Hierarquia organizacional (Cargo + Gerente, campo por usuário)

Importante: isso é **independente dos 7 grupos de segurança** acima — grupos
são só permissão, não alimentam organograma. O organograma real do
Teams/Outlook é desenhado só pela cadeia do campo **Gerente**; o campo
**Cargo** é só rótulo visual, não cria hierarquia sozinho. Os dois precisam
ser preenchidos por pessoa, sem atalho em massa pelo Portal (só via script).

Árvore confirmada em 2026-09-07:

```
Célia (Presidente)
├── Erick — Diretor (área Tecnologia)
│   └── Bruno Duarte — Voluntário
├── Gabi Graciano — Diretor (área Instituto)
│   ├── Gabi Barbosa — Gerente
│   ├── Erica, Ellen, Tico, Lucas, Leo — Voluntários
│   └── Daiana — Voluntária
├── Felipe Siqueira — Diretor (área Associação)
│   └── Carla — Gerente
│       ├── Vinicius Façan — Gerente
│       ├── Monique — Gerente
│       └── Danielly, Paulo Victor, Fernanda Siqueira — Voluntários
└── Hanyelle — Diretora (independente, sem área fixa)
```

**Tabela final (montada pelo usuário em Excel, 2026-09-07 — versão
definitiva, substitui rascunhos anteriores deste documento):**

| Pessoa | Cargo | Departamento | Tipo de empregado | Gestor | Status |
|---|---|---|---|---|---|
| Célia | Presidente | ITP-AM | Voluntário | — | [x] |
| Erick | Coordenador de Tecnologia | ITP-AM | Voluntário | Célia | [x] |
| Gabi Graciano | Coordenador do Instituto | ITP | Voluntário | Célia | [x] |
| Felipe Siqueira | Diretor da Associação | AM | Voluntário | Célia | [x] |
| Hanyelle | Diretor da Associação | ITP-AM | Voluntário | Célia | [x] |
| Gabi Barbosa | Gerente | ITP | Voluntário | Gabi Graciano | [x] |
| Carla | Gerente | AM | Voluntário | Felipe Siqueira | [x] |
| Vinicius Façan | Gerente | AM | Voluntário | Carla | [x] |
| Monique | Gerente | AM | Voluntário | Felipe Siqueira | [x] |
| Bruno Duarte | Analista de Dados | ITP-AM | Voluntário | Erick | [x] |
| Erica | Professor(a) | ITP | Voluntário | Gabi Graciano | [x] |
| Ellen | Professor(a) | ITP | Voluntário | Gabi Graciano | [x] |
| Tico | Professor(a) | ITP | Voluntário | Gabi Graciano | [x] |
| Lucas | Professor(a) | ITP | Voluntário | Gabi Graciano | [x] |
| Leo | Professor(a) | ITP | Voluntário | Gabi Graciano | [x] |
| Daiana | Chefe de Cozinha | ITP | Voluntário | Gabi Graciano | [x] |
| Danielly | Operador(a) | AM | Voluntário | Carla | [x] |
| Paulo Victor | Operador(a) | AM | Voluntário | Carla | [x] |
| Fernanda Siqueira | Operador(a) | AM | Voluntário | Carla | [x] |

**Telefone real (achado no banco do erp_itp, tabelas `usuarios`/`funcionarios`,
2026-09-07)**, pra completar o cadastro no Entra ID:

**Nomes completos reais** (2026-09-07, do banco erp_itp) usados como
identificador principal a partir daqui:

| Pessoa (nome completo) | Cargo | Departamento | Tipo de empregado | Gestor | Telefone |
|---|---|---|---|---|---|
| Célia da Silva Paixão | Presidente | ITP-AM | Voluntário | — | 21966771531 |
| Erick Gonçalves Cardoso | Coordenador de Tecnologia | ITP-AM | Voluntário | Célia da Silva Paixão | 21933006073 |
| Gabriela Graciano Bezerra | Coordenador do Instituto | ITP | Voluntário | Célia da Silva Paixão | 84988737435 |
| Felipe Siqueira ⚠️ (sobrenome completo não encontrado) | Diretor da Associação | AM | Voluntário | Célia da Silva Paixão | ⚠️ pendente |
| Hannyele Barbosa Alves da Penha | Diretor da Associação | ITP-AM | Voluntário | Célia da Silva Paixão | 21981141335 |
| Gabriella Barbosa da Silva | Gerente | ITP | Voluntário | Gabriela Graciano Bezerra | 21972033514 |
| Carla Barbosa Sales | Gerente | AM | Voluntário | Felipe Siqueira | 21974899568 |
| ⚠️ Vinicius Augusto (confirmar se é "Vinicius Façan") | Gerente | AM | Voluntário | Felipe Siqueira | 21978611648 |
| Monique Cristina Mendes Santos | Gerente | AM | Voluntário | Felipe Siqueira | 21970606801 |
| Bruno Duarte | Analista de Dados | ITP-AM | Voluntário | Erick Gonçalves Cardoso | — |
| Érica da Silva Lucas | Professor(a) | ITP | Voluntário | Gabriela Graciano Bezerra | 21998706667 |
| Ellen da Silva Ribeiro | Professor(a) | ITP | Voluntário | Gabriela Graciano Bezerra | 21920423653 |
| ❌ Tico (não encontrado no banco) | Professor(a) | ITP | Voluntário | Gabriela Graciano Bezerra | — |
| Lucas Seabra Rabelo da Silva | Professor(a) | ITP | Voluntário | Gabriela Graciano Bezerra | 21974651756 |
| ❌ Leo (ambíguo: Leandro Alves ou Leandro Pinheiro de Oliveira) | Professor(a) | ITP | Voluntário | Gabriela Graciano Bezerra | — |
| Daiana Alves Gomes | Chefe de Cozinha | ITP | Voluntário | Gabriela Graciano Bezerra | 2194379444 |
| Danielly da Silva Marinho Quinta | Operador(a) | AM | Voluntário | Carla Barbosa Sales | 21981605788 |
| Paulo Victor Barbosa da Silva | Operador(a) | AM | Voluntário | Carla Barbosa Sales | 21996823550 |
| Fernanda Barbosa Siqueira | Operador(a) | AM | Voluntário | Carla Barbosa Sales | 21981045195 |

Confirmado: Felipe Siqueira e Hanyelle são **co-diretores** da Associação
(mesmo cargo, intencional). Monique reporta direto a Felipe Siqueira (não
a Carla, diferente do Vinicius).

O campo **Cargo** preenchido aqui é o mesmo que aparece automaticamente no
Teams (cartão de perfil, organograma, hover de @menção) — não precisa
configurar nada a mais lá.

Campos do painel "Editar propriedades" a **ignorar** em todo mundo (não
necessários pro objetivo, são detalhamento de RH que não está em uso):
Nome da empresa, ID do empregado, Tipo de empregado, Data de contratação,
Gabinete, Patrocinadores.

Preencher: **entra.microsoft.com → Users → [pessoa] → Properties → Editar
propriedades** (painel lateral tem Cargo, Departamento e Gestor juntos).
Ordem sugerida: de cima pra baixo na árvore (Gestor de cada um só depois
que a pessoa acima dela já foi processada, evita ficar sem opção pra
selecionar).

## 3. Teams — ✅ CONCLUÍDO em 2026-09-07 (5 equipes, revisado do plano original de 4)

Estrutura final, simplificada e por função compartilhada (não por
entidade separada) a pedido do usuário — nomes diretos, sem enfeite
corporativo (não é uma empresa, é ONG):

| # | Equipe | E-mail | Membros (grupos) | Status |
|---|---|---|---|---|
| 1 | Diretoria | `diretoria@institutotiapretinha.org` | `ITP_AM_Executiva_Geral`, `ITP_AM_ADMINISTRACAO` | ✅ criada |
| 2 | Tecnologia | `tecnologa@institutotiapretinha.org` (sic, confirmado intencional) | `ITP_AM_ADMIN_TEC` | ✅ criada |
| 3 | Professores | `docentes@institutotiapretinha.org` | `ITP_DOCENTES` | ✅ criada |
| 4 | Cozinha | — | `ITP_COZINHA` | ✅ criada |
| 5 | Associação de Moradores | — | `AM_GERENCIA`, `AM_Operacao` | ✅ criada |

Diferença do plano original: Diretoria absorveu a Administração (governança
+ financeiro/administrativo, já que as mesmas pessoas cuidam de ambas as
entidades); Docentes e Cozinha viraram equipes separadas em vez de uma
"Instituto Tia Pretinha" única — mais granular, cada área tem seu próprio
espaço.

---

## Ordem de execução recomendada

1. [ ] Resolver a dúvida do Erick (duplicata ou não) antes de criar
2. [ ] Criar os 13 usuários restantes (confirmar sobrenomes antes)
3. [ ] Criar os 7 grupos de segurança, com todos os membros já existindo
4. [ ] Criar/ajustar os 4 Teams, associando os grupos como membros
5. [ ] (Futuro, tarefa separada) Avaliar domínio `@cgn-vl.org` se ainda
      fizer sentido usá-lo pra algum grupo específico
