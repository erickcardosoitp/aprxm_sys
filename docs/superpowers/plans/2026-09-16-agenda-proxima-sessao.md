# Agenda da próxima sessão (2026-09-16)

Levantado em 2026-09-15, ao final de uma sessão longa (migração completa
do APRXM + checklist de bugs/segurança/CI-CD, todos fechados — ver
`2026-09-12-migracao-aprxm-execucao.md` e
`2026-09-15-checklist-consolidado.md`). Itens abaixo são **só pauta**,
nada foi investigado a fundo nem decidido ainda.

---

## 1. Revisar PR #2 (Bruno / `codexdevbrn`) — "Portal do Morador"

**https://github.com/erickcardosoitp/aprxm_sys/pull/2** — aberto em
2026-07-31 (~6 semanas parado), nunca revisado nem mergeado.

**Escopo do PR (51 arquivos, +5.727/-46 linhas)** — feature grande,
não um bugfix pontual:
- **Login próprio do morador** (`resident_auth.py`, `MoradorLoginPage.tsx`,
  `resident_username` — migration 032) — hoje moradores não têm login
  no sistema, só quem tem conta de usuário (admin/operador/etc.).
- **Feed de comunidade** (`community.py`, `community_post.py`,
  `CommunityFeedTab.tsx`) — posts, curtidas em post/comentário
  (migrations 029/030/034/035), moderação (`moderation_service.py`,
  `CommunityModerationPage.tsx`).
- **Diretório/classificados** (`directory.py`, `DirectoryTab.tsx`,
  `MyBusinessSection.tsx`, `DirectoryStaffPage.tsx`) — moradores
  anunciando o próprio negócio, com aprovação do ESC (migrations
  031/033).
- **Painel do morador** (`MoradorPainelPage.tsx`, `NotificationBell.tsx`)
  — hub central logado.
- **Novas seções no ESC** pra aprovar conteúdo pendente (cadastro no
  diretório, sugestões, publicações) — `AprovacoesPage.tsx` +
  3 seções novas.
- 8 migrations novas (028 a 035) — schema real, precisa revisão de
  segurança (RLS/isolamento por `association_id`, já que é acesso de
  morador final, superfície de ataque bem maior que telas internas).

**Antes de mergear, decidir:**
- Isso é uma feature que o produto quer de verdade agora, ou ficou
  esquecida porque a prioridade mudou?
- Revisão de segurança do login de morador (superfície nova exposta
  publicamente) e das 8 migrations antes de qualquer merge.
- Testar em ambiente isolado antes — é grande demais pra ir direto pra
  produção sem validação.

---

## 2. Login Microsoft (SSO)

Contexto: o `erp_itp` já tem SSO Microsoft implementado (achado em
sessão anterior, `2026-09-06-migracao-vm-plan.md`). APRXM ainda não.

**A discutir:** vale a pena pro APRXM? Perfil de usuário é diferente
(associações de moradores, não corpo próprio da ITP) — talvez SSO
corporativo não faça sentido aqui, ou faça só pro ESC/Escritório.
Levantar caso de uso real antes de implementar.

---

## 3. "Acabar com o chat"

Contexto parcial de hoje: investigamos o módulo "Porta a Porta" e
descobrimos que não existe mais como módulo isolado (virou parte do
cadastro padrão de morador). O pedido de hoje sobre "chat" não foi
detalhado — **precisa esclarecer**: é o módulo `ChatPage.tsx` (chat
interno do app, mencionado nos `.catch()` corrigidos hoje) que o
usuário quer remover? Motivo (baixo uso? redundante com WhatsApp?
manutenção)? Mapear dependências antes de tocar (mesmo cuidado que
tivemos hoje com "Porta a Porta" — conferir se não é usado por outro
módulo antes de remover).

---

## 4. Remodelar frontend

Sem escopo definido ainda. Perguntas em aberto pra próxima sessão:
- Remodelar o quê — visual (design system/UI), ou estrutural (rotas,
  organização de código)?
- Todos os 4 frontends (`frontend`, `painel`, `presidencia`,
  `simplifica`) ou um específico?
- Existe referência visual/wireframe, ou começamos do zero definindo
  direção?

---

## 5. Investigar lentidão

Sem sintoma específico relatado ainda. Pra investigar de verdade,
precisa de:
- Onde é lento — tela específica, ação específica, ou geral?
- Desde quando (sempre foi assim, ou começou depois de alguma mudança
  — ex. a migração VM de hoje, ou algo antes)?
- Volume de dado envolvido (a `CrmSection`/`EscDataTable` já tinham
  histórico de carregar lista inteira sem paginação — parte já
  corrigida hoje, mas vale re-perfilar depois do carregamento real de
  produção).
- Métricas HTTP/Apdex já existem no Grafana (instrumentado em sessão
  anterior) — primeiro lugar a olhar antes de adivinhar.

---

## 6. Fazer um BI completo do APRXM (novamente) — DECIDIDO

**Decisão do usuário (2026-09-15): sim, vamos fazer.** Não é mais "a
avaliar" — é próximo projeto real. "De novo" porque já existia um BI
antes (Power BI ligado direto no Neon/`aprxm-analytics`) que ficou pra
trás com a migração de hoje (Fase K: destino saiu do Neon, foi pro
ClickHouse self-hosted).

**Base já pronta (Fase K, hoje):**
- ClickHouse rodando na VM, 39 tabelas Gold, ETL alimentando 2x/dia.
- Play UI + DBeaver configurados pra consulta manual — mas isso é
  ferramenta de dev, não "BI completo" pro usuário final.
- Backup do ClickHouse funcionando (a cada 6h + SharePoint).

**O que falta pra ser "BI completo" de verdade — pauta de amanhã:**
- **Gateway de Dados Local** pro Power BI Service (nuvem, atualização
  agendada) alcançar o ClickHouse — pendência já registrada, ainda não
  montada. Sem isso, Power BI não teria conectividade nenhuma automática.
- Decidir a ferramenta final: Power BI (precisa do Gateway) vs.
  dashboards nativos no Grafana (já rodando, já lê métricas
  operacionais, mas não as tabelas Gold do ClickHouse ainda) vs. as
  duas coisas pra públicos diferentes (operação no Grafana,
  negócio/diretoria no Power BI).
- Levantar as perguntas de negócio reais que o BI precisa responder
  (receita, inadimplência, encomendas paradas, etc. — muitas já têm
  tabela Gold pronta) antes de desenhar os dashboards.
- Quem vai usar (Escritório? Diretoria? Presidência de cada
  associação?) — define nível de agregação e permissão de acesso.

**Decisão adicional (2026-09-15): o BI substitui o painel da
presidência.** O frontend `presidencia/` (um dos 4 apps hoje) **vai ser
descontinuado** — o BI novo assume esse papel. Implicações pra
levantar amanhã:
- Tudo que `presidencia/` faz hoje precisa ter equivalente no BI antes
  de desligar (senão perde funcionalidade na troca).
- Decidir o que acontece com o backend/rotas específicas de
  presidência (`require_presidencia_access` em `tenant.py`,
  `painel-aprxm` no Vercel) — desligar junto, ou manter até o BI cobrir
  100% do uso atual?
- Deploy Vercel do `presidencia/` (projeto `aprxm-presidencia`,
  `aprxm-dash-prd.vercel.app`) — quando descontinuar formalmente,
  revisar igual fizemos com o corte da Fase I hoje (confirmar zero uso
  antes de desligar). **Não confundir com `painel-aprxm.vercel.app`**
  (projeto `painel-aprxm`, frontend separado — esse não entra nessa
  descontinuação).

---

## Nota — e-mails de falha de deploy (2026-09-15, investigado e resolvido)

Usuário recebeu vários e-mails após a sessão de hoje: a maioria era só
`vercel[bot]` comentando link de preview em cada PR aberto (ruído
normal, volume alto por causa da quantidade de PRs de hoje). O único
e-mail de falha real (`Run failed: Deploy backend (VM) — main
(60dde03)`) é o incidente já conhecido e corrigido no mesmo dia:
primeira tentativa de CI/CD via SSH remoto falhou por timeout de
firewall, resolvido trocando pra runner self-hosted na VM (ver Fase
"CI/CD" no checklist consolidado). Não é uma falha nova nem recorrente
— confirmado pelo SHA do commit batendo com o incidente já fechado.

---

## Ordem sugerida (não decidida, só uma sugestão de abertura de conversa)

1. PR do Bruno primeiro — é trabalho de 6 semanas parado, risco de
   ficar cada vez mais desatualizado/conflitante quanto mais tempo
   passa sem revisar.
2. Esclarecer escopo de "chat" e "remodelar frontend" (perguntas
   objetivas antes de qualquer código).
3. Lentidão — precisa de sintoma concreto pra não virar investigação
   às cegas.
4. Login Microsoft e BI — decisões de produto/arquitetura, discutir
   caso de uso antes de estimar esforço.
