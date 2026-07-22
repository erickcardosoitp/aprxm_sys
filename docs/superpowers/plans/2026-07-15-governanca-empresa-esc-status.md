# Status — Governança de Empresa / ESC (APRXM)

**Atualizado em:** 2026-07-16
**Spec:** `docs/superpowers/specs/2026-07-15-governanca-empresa-esc-design.md`
**Plano completo:** `docs/superpowers/plans/2026-07-15-governanca-empresa-esc-plan.md`

---

## Implementado (no ar em produção)

### Fase 1 — Migrations aditivas (v5)
- Tabela `empresas` (id, name, slug, financeiro_centralizado, plan_name, is_active)
- `associations.empresa_id` (nullable)
- `users.association_id` passa a aceitar NULL (era obrigatório)
- `role_permissions` e `audit_log` ganham `empresa_id` (nullable), `association_id` vira nullable
- Tabela `provisioning_runs` (log de execução do provisionamento)

### Fase 2 — Migration de dados (v6)
- Empresa real criada: `SAPE - Vaz Lobo / Buriti / Congonha`
- `empresa_id` preenchido em Vaz Lobo e Congonha
- Descoberta em produção: o ambiente Escritório já tinha sido desativado antes deste projeto (`_DELETADO_Escritorio`) — a promoção automática a `admin_master` não encontrou usuários, sem efeito colateral
- Felipe Siqueira promovido manualmente a `admin_master` (mantendo acesso a Vaz Lobo e Congonha)
- 3 bugs de produção corrigidos, encontrados testando localmente antes do deploy: geração de token e consulta de membership quebravam com `association_id=NULL`

### Fase 3 — Models e services de provisionamento
- Models `Empresa` e `ProvisioningRun`
- `EmpresaService`: cria empresa + admin_master + senha gerada enviada por e-mail
- `AssociationProvisioningService`: cria associação + settings + categorias/formas de pagamento/caixa padrão + admin
- Log passo-a-passo em `provisioning_runs`, com rollback correto em caso de falha

### Fase 4 — Endpoints (router `/governanca`)
- `POST`/`GET /governanca/empresas`, `POST /governanca/empresas/{id}/associacoes`
- `GET /governanca/empresas/{id}/associacoes` (listagem, adicionada durante a Fase 5)
- `PATCH /governanca/associacoes/{id}/desativar` — soft delete em cascata
- `GET /governanca/provisioning-runs` (+ detalhe por id)

### Fase 5 — Painel separado (painel-aprxm) + auth isolada (v7)
- Tabela `painel_admins` — sistema de usuários totalmente separado do `users` do app operacional
- JWT próprio (`PAINEL_SECRET_KEY`, audience `painel-aprxm`) — nunca aceita token do app principal
- `/governanca` re-protegido com essa auth isolada (antes usava o JWT do app operacional)
- Projeto frontend novo: Vite + React + TypeScript + Tailwind v4, em `painel/`
- Telas: login, listar empresas, criar empresa, detalhe da empresa, criar associação, desativar, execuções de provisionamento
- Deploy próprio na Vercel: `https://painel-aprxm.vercel.app`
- Validado ponta a ponta com testes automatizados de navegador contra backend real, credenciais descartáveis

### Incidente durante a Fase 5 (resolvido)
O deploy inicial da Fase 5 derrubou o backend inteiro por ~15-20 minutos: o campo de e-mail usava `EmailStr` (Pydantic), que depende do pacote `email-validator` — ausente do `requirements.txt` de produção. Isso quebrava a importação do app inteiro (500 em todos os endpoints). Corrigido trocando por texto simples; o app voltou ao normal. Se quiser validação de formato de e-mail de volta, é só adicionar `email-validator` ao `requirements.txt` num commit calmo.

### Fase 6 — Validação em produção (checklist técnico OK)
Checklist técnico rodou limpo em 2026-07-16: zero erros 5xx no dia (~4.900 req), JWT com `empresa_id` correto para admin_master e operador, `audit_log`/`role_permissions` sem corrupção. Login/refresh/switch inalterados.

### Fase 7 — Remoção do modelo antigo (no ar, 2026-07-16)
- **7a** (código): `is_office` removido dos 6 arquivos + hook `_empresa_col_exists` removido. Deploy limpo.
- **7c** (schema, migration v8): `is_office` e `linked_association_slugs` removidas, `associations.empresa_id` agora `NOT NULL`.
- **Decisão de execução**: as associações legadas sem `empresa_id` (escritorio inativo, teste QA) foram **vinculadas à empresa SAPE, não deletadas** — descobriu-se que a `teste` tinha ~209 mensalidades reais e outros registros com `created_by` apontando pra seus usuários (FKs NO ACTION), então deletar corromperia dado real.
- **O guard de segurança funcionou**: a v8 abortou 2x (associação órfã) sem derrubar a produção, até a estratégia ser corrigida. Rodou em sessão própria com rollback.
- Verificado pós-deploy: 4 associações preservadas e vinculadas à SAPE, 1161 mensalidades e 25 usuários intactos, app saudável.

### Fase 8a — users.empresa_id (NO AR em produção, 2026-07-16)
Diretriz do usuário: **todo usuário ligado a uma empresa, gerido no ESC, atribuído a uma associação**. A 8a implementa a fundação disso.

Gap que motivou: `EmpresaService` criava o `admin_master` com `association_id=NULL` e **sem vínculo com a empresa no banco** (a tabela `users` não tinha `empresa_id`). No login ele saía com `empresa_id=None` e escopo vazio — o provisionamento pelo painel produzia um `admin_master` inútil. O `/geral` também só via associações via membership manual.

Implementado (2 commits locais — `f45e8c6`... na verdade após a Fase 7; ver `git log`):
- **Migration v9** (aditiva): `users.empresa_id` + backfill de todos os usuários (via `association_id` direto e via memberships para os empresa-wide)
- **User model**: campo `empresa_id`
- **EmpresaService / AssociationProvisioningService**: passam a setar `empresa_id` nos usuários criados
- **auth_service**: `admin_master`/`superadmin` com `empresa_id` enxergam **todas** as associações da empresa (escopo derivado de `empresa_id`, não de membership) — associações novas aparecem automaticamente
- **geral.py**: `/geral` aceita admin de empresa (não só aggregator 2+), e escopo usa `scoped_ids()` (primária + vinculadas)

Validado e2e local: painel cria empresa → `admin_master` nasce com `empresa_id` → login OK → cria associação → aparece no `/geral` do admin_master. Login de usuário comum inalterado.

**No ar em produção (2026-07-16).** Migration v9 aplicada; verificado no DB: `schema_migrations`=9, `users.empresa_id` criada, **25/25 usuários com empresa_id (0 NULL)**, health 200, login (rejeição de credencial) limpo. O deploy exigiu correção de um outage — ver incidente abaixo.

### Incidente durante a Fase 8a (resolvido) — replay de migration bateu em coluna dropada
O 1º push da 8a **derrubou toda a produção** (`FUNCTION_INVOCATION_FAILED` em todos os endpoints, `/health` incluso). Causa raiz: as migrations não têm guard por versão — quando `applied < _SCHEMA_VERSION`, a rotina **reexecuta todos os blocos v5→v9** confiando só na idempotência do SQL. O bloco **v6** (Fase 2) fazia `SELECT ... FROM associations WHERE slug='escritorio' AND is_office = TRUE`, mas `is_office` foi **dropada na v8 (Fase 7c)**. Enquanto `applied(8) >= _SCHEMA_VERSION(8)` o early-return protegia o bloco; bumpar pra v9 fez `applied(8) < 9`, o v6 rodou de novo, `UndefinedColumnError` abortou o lifespan (v5/v6/v7 não têm try/except, só v8/v9 têm) → app inteiro morreu.

Resposta: produção restaurada em ~1s via `vercel promote` do deploy v8 anterior (rollback de alias, sem rebuild). Fix: guardar a migração dos usuários do Escritório com `IF EXISTS (information_schema … is_office)` nos dois ramos — no-op em DBs já migradas, comportamento idêntico onde a coluna ainda existe. Validado com dry-run `BEGIN/ROLLBACK` contra o schema real de produção antes do 2º push. O 2º deploy subiu limpo, sem outage. Commit do fix: `1b5f8d6`.

**⚠️ Dívida técnica exposta (follow-up):** os blocos v5/v6/v7 não são envelopados em try/except (só v8/v9 são), então uma falha neles derruba o cold start — viola o princípio "migração nunca derruba o app" que o próprio código declara. Além disso, qualquer bloco antigo que referencie um objeto dropado por um bloco posterior vai quebrar no próximo bump de versão. Recomendado: envelopar v5/v6/v7 em try/except (padrão v8/v9) e/ou guardar cada bloco por versão (`IF applied < N`).

### O que NÃO mudou (sem risco)
- Vaz Lobo e Congonha continuam operando normalmente, sem interrupção de uso
- `users.admin_master`/`superadmin` controlam acesso operacional dentro do app principal — sem relação com o painel-aprxm

---

### Fase 8e — Fix: usuário empresa-wide invisível/pulado em 4 pontos (NO AR, 2026-07-18)
Achado ao investigar 2 relatos reais: "caixas sumiram pro Felipe" (investigação não concluiu causa — dado e lógica de login conferidos corretos, ver histórico da conversa) e "usuário do Felipe não aparece nem em Vaz Lobo nem em Congonha" (confirmado, bug real).

Causa: Fase 2/8a deram a `admin_master`/`superadmin` acesso via `empresa_id` (com `users.association_id = NULL`), mas 6 pontos do código ainda filtravam `users.association_id` direto contra uma única associação — invisíveis pra esse modelo. Corrigidos os 4 onde é bug de verdade:
- `admin.py` `list_users` — Felipe não aparecia em nenhuma lista de usuários.
- `mensalidades.py` `cron-generate` — **achado mais sério**: Congonha não tem nenhum admin/superadmin com `association_id` próprio, então a geração mensal automática de mensalidade estava sendo **pulada pra Congonha inteira** (`if not admin_id: continue`). Confirmado contra produção antes/depois do fix.
- `daily_tasks.py` `list_group_users`, `public.py` (created_by de residente via cadastro público) — mesmo padrão, corrigidos por consistência.

Deixados de fora (semântica diferente, não é o mesmo bug): `porta_a_porta.py` `public_users` (lista agentes comissionados, não faz sentido incluir admin ali) e `superadmin.py` `list_organizations` (headcount de membros dedicados — incluir empresa-wide infla a métrica sem agregar informação).

Cuidado tomado: `ORDER BY (association_id = a.id) DESC` quebrava com `NULL` (Postgres ordena `NULL` primeiro em `DESC`) — corrigido com `(expr) IS TRUE` antes do `DESC`. Validado contra produção: Vaz Lobo mantém seu admin dedicado na preferência, Congonha cai no fallback, sem regressão.

**Deploy sem migration** (só código), verificado saudável (10/10 health durante rollout). Commit `d058070`.

**Ponto em aberto:** "caixas sumiram pro Felipe" não foi confirmado/resolvido — dado e lógica de resolução de token no login conferem certos. Pode ser bug de frontend não investigado, sessão desatualizada, ou outra causa ainda não identificada. Investigar se o sintoma persistir.

---

## Fase 9 — ESC como associação real (NO AR em produção, 2026-07-19)

Deploy mais arriscado do projeto (mexe em login + acesso de gente real). Feito com rigor: validado 100% local (banco de teste restaurado do dump) → dry-run da v10 contra o banco real de produção (transação revertida) → backup completo dos 25 usuários → deploy coordenado (backend v10 + frontend ESC juntos) → validação → remap dos usuários.

**Schema v10** (aditivo, no ar): `users.last_association_id` + linha ESC por empresa (`id = empresa_id`, sem coluna extra — a igualdade identifica o Escritório). Deploy sem outage (health 200 durante todo o rollout).

**Comportamento novo:** empresa-wide = por estação (`association_id == empresa_id`), não mais role hardcoded — libera conselho/diretoria no ESC. Login respeita última unidade usada (`last_association_id`). `switch_association` aceita qualquer unidade da própria empresa. `empresa_service` cria empresa nova já com linha ESC + admin estacionado nela.

**Remap dos 25 usuários (produção, transação atômica, backup antes):**
- ESC (8): Erick (superadmin), Felipe (admin_master), Carla/Vinícius (diretoria), Gabriela/Gabriella/Célia celiapx/Raphael (conselho)
- Congonha (2): Danielly (movida de Vaz Lobo), Fernanda
- Vaz Lobo (4): Hanyelle, Hosana, Monique, Paulo Victor
- Desativados (11): 5 usuários Teste QA + Conferente Congonha teste + 5 contas velhas/duplicadas já inativas
- `token_version` bumpado nos remapeados → **forçou re-login** (tokens antigos tinham association_id/role velhos). Os usuários do ESC precisam logar de novo pra entrar no ambiente novo.

**Validado em produção:** seletor de Erick e Felipe lista ESC+Congonha+Vaz Lobo; login path íntegro (403 limpo); 0 usuário ativo com association_id NULL órfão; health estável.

**Commit:** merge `ef4eef0` na main. Branch `fase-9-esc-associacao` mergeada (pode apagar). Backup dos usuários salvo na sessão (sem senhas). Mocks de dev removidos antes do merge.

**Sobrou pra próxima:** a Fase 11 (escrita — criar/editar usuário, permissões, avisos) e formulários ainda não existem; o ESC hoje é leitura (15 endpoints) + as telas placeholder. O painel /geral antigo ainda coexiste.

---

## Fase 11 — Centralização Administrativa no ESC (NO AR em produção, 2026-07-19)

Deploy aditivo (sem remap de usuário, mais simples que a Fase 9), staged e sem outage. Schema **v11**: `transaction_categories.empresa_id` + `payment_methods.empresa_id` (+ `DROP NOT NULL` em `association_id` das duas, pra permitir cadastro de nível empresa) + `empresas.access_groups` + `notifications.empresa_id`. (`role_permissions.empresa_id` e `audit_log.empresa_id` já vinham da v5.)

**ESC deixou de ser só leitura — agora edita** (router `esc.py` + telas em `frontend/src/pages/esc/`, padrão useState+modal+api/toast com visual do ESC):
- Cadastros: CRUD de usuário (criar/editar/desativar + **excluir sem movimentação**, senão 409), categorias de transação e formas de pagamento (nível empresa)
- Administração: permissões (grid access-groups editável, salva em lote; cai num **template padrão** quando a empresa não configurou), avisos (broadcast pra todos os usuários ativos + histórico), auditoria consolidada
- **Filtros por coluna em todas as telas** (unidade/cargo/status/tipo/prioridade, auto-derivados dos dados) + filtro Ativos/Inativos (padrão Ativos)

**Bugs pegos no teste local antes do deploy:** cast `:param::tipo` no SQLAlchemy → `CAST()`; `association_id NOT NULL` bloqueando cadastro empresa → `DROP NOT NULL`.

**Validado em produção** (usuário descartável, dogfoodando o hard-delete): GET categorias/access-groups(6 cargos)/auditoria → 200; POST criar usuário → 200; DELETE permanente → 200; cleanup 0 restante. Health estável.

**Commit:** merge `c175ccd` na main (branch `fase-11-centralizacao-admin`). Dev mock `vite.config` (9001) fica só no working tree local, nunca commitado.

**Ainda fora de escopo (Fase 11 fechou o que estava spec'd):** produtos (Fase 10, despriorizada), inventário (Fase 8), financeiro centralizado de verdade (gap sem spec), migração de dado legado de categoria/forma/permissão por-associação → empresa.

---

## Inventário de encomendas (NO AR, 2026-07-19)
Snapshot pontual no módulo Administração do ESC. Schema **v12** (aditivo): tabela `package_inventories`. ESC escolhe associação + dia + hora (modal) → gera o inventário das encomendas fisicamente na associação naquele momento (recebidas até o ref, não entregues nem devolvidas até o ref) → salva total + itens no histórico. Endpoints `/esc/administracao/inventario-encomendas` (POST/GET/GET{id}), aba nova em Administração. Validado local (pontual confere: hoje→N, data passada→0) + prod (schema=12, tabela existe). Commit `82f93f4`. **Nota:** isto é o inventário de ENCOMENDAS (pacotes) — diferente do inventário FINANCEIRO da Fase 8 (conferência de caixa), que segue pendente.

---

## Financeiro Centralizado — Fase 1+2 (NO AR em produção, 2026-07-21)
Spec: `docs/superpowers/specs/2026-07-20-financeiro-centralizado-design.md`. Plano: `docs/superpowers/plans/2026-07-20-financeiro-centralizado-plan.md`. Zero migration (aditivo, só código).

**Fase 1 — fundação:** `financeiro_scope()` (tenant.py) resolve as unidades visíveis no Financeiro — associação de empresa centralizada leva 403, ESC-stationed vê todas (ou 1 via `?unidade=`); checa também `financeiro:view` no grid `access_groups` (novo módulo `"financeiro"` no template). `reverse_transaction` ganhou a regra de devolução: sessão já fechada/conferida → estorno vira lançamento sem `cash_session_id` (não mexe em saldo de caixa, só reduz faturamento no DRE). Frontend: `/financeiro` some do menu da associação quando centralizado, aparece no ESC. Commit `be0fbf4`.

**Fase 2 — Fluxo de Caixa, Movimentações, DRE:** `financeiro_scope` aplicado em dashboard/DRE/evolução/fluxo-projetado/extrato/summary. Endpoint novo `/financeiro/movimentacoes` (filtros: tipo, produto, morador, rua, inadimplente, usuário, cargo, período) + export xlsx. Endpoints novos `/financeiro/caixas-abertos` e `/financeiro/zerar-caixa` (sangria administrativa remota do ESC, **sem foto de recibo** — decisão explícita do usuário, já que quem aciona não está fisicamente no caixa). Removido stub antigo/duplicado `/esc/financeiro/movimentacoes` (esc.py). 3 seções novas no ESC. Commit `7c178d2`.

Validado localmente contra `aprxm_local` (dump real, 3069 movimentações reais, 3 associações da SAPE) + fluxo de zerar-caixa ponta a ponta com dado descartável (criado, testado, limpo). Deploy `aprxm-sys-backend-7zow123tk` — health 200, 3 endpoints novos confirmados (401 sem token, não 404/500).

**Fase 3 — Sessões de Caixa:** `/esc/financeiro/sessoes-conferidas` reescrito com `financeiro_scope`, só `status='conferido'`, calcula líquido/qtd_mensalidades/bruto PIX-dinheiro/sobra-falta/quebra. **Bug de escopo achado e corrigido** (mesma classe do fallout da Fase 9): `revert_conferencia` e `generate_conferencia_pdf` (finance.py) filtravam só por `current.association_id` — ESC tentando reabrir/reimprimir sessão de OUTRA unidade recebia 404, porque `association_id` do ESC é o Escritório, nunca a unidade alvo. Frontend: `SessoesCaixaSection.tsx` (tabela + modal, ações reabrir/2ª via com valores pré-preenchidos). Commit `207d7e2`.

Validado localmente com sessão em Congonha chamada por usuário ESC (não Congonha) — líquido/baixas/qtd_mensalidades corretos, `revert_conferencia` funcionou (antes dava 404).

**Fase 4 — CRM:** achado importante antes de implementar — já existia `/crm/residents` (usado pela tela CRM da associação) calculando quase tudo que a spec pedia (R$ atrasado, qtd. pendente, última entrega, encomendas/mês). Confirmado com o usuário que essa tabela **continua em uso** (só o ranking de agentes/bônus da mesma página é que morreu com o porta-a-porta) — reaproveitado em vez de escrito do zero. Adicionado: `financeiro_scope`, grace_days por unidade (join `association_settings`, não valor único — unidades podem ter carência diferente), `acoes_mes` (mensalidade+encomenda+comprovante, distinto do `enc_mes` que só conta encomenda), `forma_pagamento_recorrente`, `associado_desde`, filtros (rua, tempo associado, dependentes, min/max R$ atrasado, min meses atrasado). `/mensalidades/pending`, `/delinquent`, `/paid` passam a fazer loop por unidade via `financeiro_scope` (preserva grace_days correto por unidade). Frontend: `CrmSection.tsx`, 4 visões. Commit `1dcaf78`.

Validado localmente contra dado real: 446 associados reais (Vaz Lobo+Congonha), 48 com `acoes_mes>0`, 22 com `forma_pagamento_recorrente`; `pending`/`delinquent`/`paid` consolidam as 3 unidades; usuário de associação recebe 403.

**UI (feedback do usuário, "muito feio"):** revisão com skill `ui-ux-designer` achou paleta inconsistente entre as 5 seções novas (cada uma com cor de "estado ativo" diferente — azul, índigo, verde preenchido — violando a regra do próprio design system do ESC: verde `#16a34a` só como indicador pontual, nunca fundo). Corrigido: cor unificada em todo lugar, filtros do CRM ganharam rótulo fixo (`EscField`, placeholder-como-rótulo é anti-padrão NN Group) e viraram principais+avançados (Lei de Hick), `EscSelect` novo componente (sem seta nativa do navegador). **Bug achado depois do usuário testar**: `EscSelect` mostrava 2 setas — `escInputCls` tinha `[appearance:textfield]` solto que brigava com o `appearance-none` do select; corrigido escopando só a `input[type=number]`.

**Fase 5 — Contas a Pagar (schema novo, v13):** 3 tabelas aditivas (`contas_pagar_templates`, `contas_pagar`, `conta_pagar_baixas`). Manual ou recorrente (template gera conta do mês); baixa parcial (`amount_paid` acumula, status `pending→partial→paid` calculado em código). Baixa cria uma `transactions` normal (`type=expense`, `cash_session_id=NULL`) — mesmo mecanismo "sem caixa" da devolução (Fase 1): não mexe em saldo de caixa nenhum, só reduz faturamento no DRE. Endpoints novos em `esc.py`, **primeiro uso real de `require_esc_module`**. Frontend: `ContasPagarSection.tsx`. Commit `edbd7d3`.

Validado localmente (12 checks: CRUD, baixa parcial/total/excedente/em conta paga, mecanismo sem-caixa, 403 associação, duplicidade de geração por mês) + **dry-run do DDL direto contra produção real** (BEGIN/ROLLBACK, aplicou sem erro, schema em v12 antes, nada persistiu) antes do deploy.

**Faltam (Fases 6-7 do plano):** Contas a Receber, Sangrias. Relatórios e Conciliação PIX ficam fora, por pedido explícito do usuário.

---

## Fallout da Fase 9 — correções de escopo admin_master/empresa-wide (NO AR, 2026-07-19)
Classe de bug que surgiu depois da Fase 9 (supervisão estacionada no ESC): código que filtrava `association_id` da unidade ou listas de cargo sem `admin_master` passou a excluir os empresa-wide. Corrigidos (todos backend-only, sem migration, deploy via CLI por causa do incidente do GitHub):
- `tenant.py`: `is_conferente`/`is_diretoria` incluem `admin_master` (Felipe só via caixas que ele abriu + 403 ao reabrir). Commit `91308fa`.
- `finance.py` `list_conferentes`/`list_operadores`: incluem empresa-wide (ESC) + `admin_master`/`conselho` (conferência não listava ninguém). Commit `b46c60b`.
- `finance.py` estorno (`reverse`, 2 pontos): valida senha de admin também contra admins do ESC (Felipe não estornava sangria). Commit `d9e7f15`.
- `settings.py` `require_superadmin` + `admin.py` `created_by` de mensalidade: incluem `admin_master`/empresa-wide (achados em varredura proativa, antes de estourar). Commit `99e4d63`.

**Padrão pra futuras features:** qualquer lookup de usuário/permissão/admin escopado por `association_id` precisa considerar os empresa-wide (`association_id == empresa_id`, estacionados no ESC), e listas de cargo devem incluir `admin_master`. Nota: `auth.py` change-password deixado como está (admin_master pode trocar própria senha — inofensivo).

---

## Pendente

### Sequência recomendada (decidida em 2026-07-19, ver plano-mestre)
Usuário confirmou Fase 10 (Catálogo de Produtos) **despriorizada**. Ordem: **Fase 9** (ESC como associação real — bloqueante, destrava o protótipo do módulo Administração em produção) → **Fase 8** (inventário, reavaliar à luz da 9) → **Fase 11** (Centralização Administrativa — backend em paralelo, frontend depende da 9) → design do financeiro centralizado (gap ainda sem spec) → Fase 10 quando o usuário sinalizar.

### Specs escritos, aguardando implementação
- `docs/superpowers/specs/2026-07-16-catalogo-produtos-esc-design.md` — catálogo de produtos (mensalidade/taxa de entrega/comprovante de residência unificados, com estoque pro comprovante). Aprovado, não implementado.
- `docs/superpowers/specs/2026-07-17-esc-associacao-login-design.md` — ESC vira linha real em `associations` (`id = empresa_id`), login respeita último acesso (`last_association_id`), fix do seletor de troca, remapeamento de usuários reais. Aprovado, não implementado. **Enquanto não implementado, `association_id` de admin_master/superadmin nunca é igual a `empresa_id`** — qualquer lógica de frontend que dependa dessa igualdade (ex.: `isEsc()`) fica sempre falsa.
- `docs/superpowers/specs/2026-07-18-centralizacao-administrativa-esc-design.md` — análise de analista de negócio: categoria de transação + forma de pagamento, gestão de usuário, permissões e auditoria saem da associação e vão pro ESC; central de avisos nova. Aprovado, não implementado. Fecha o design da Fase 8d (permissões) e dá conteúdo concreto pra Fase 8c (módulo Administração).

### Frontend: 7 módulos do ESC + 15 endpoints reais (LOCAL, não commitado, testado ponta a ponta)
Sidebar com os 7 módulos do esboço original (Cadastros, Moradores, Financeiro, Administração, Sincronização, TI, Acervo), cada um com abas internas onde há múltiplos pontos a gerenciar. Paleta redesenhada (cinza-azulado neutro, verde só como indicador de aba ativa — não preenchimento) após feedback de que o visual inicial "parecia IA", não corporativo. Tabela densa com busca, não card.

Backend: router novo `backend/app/routers/esc.py`, 15 endpoints (`GET /esc/...`) escopados por `empresa_id`, guardados por `require_empresa_admin` (já existente). Puxam dado real: associações, usuários, grupos de acesso, encomendas, ordens de serviço, estoque de comprovante, associados/visitantes/dependentes, movimentações, sangrias, sessões conferidas, permissões, infra. Placeholder limpo (mesma tabela, "módulo ainda não implementado") pra Produtos, DRE, Fluxo de Caixa, Relatórios, Conciliação Pix, Plano de Metas, Monitor de Sincronização, Data Analytics, Banco de Dados, Fotos/Vídeos, Posts Website.

**Ambiente de teste local montado nesta sessão** (reaproveitável): Postgres local (`aprxm_local`, restaurado do dump `backup-aprxm-PRE-7c-20260716-2144.dump`), backend rodando na porta **9001** (a 9000 travou em nível de kernel do Windows — socket órfão que sobrevive ao processo, contornado trocando de porta), `vite.config.ts` com proxy configurável via `VITE_BACKEND_PORT`. Login real de teste: `erickcardoso@institutotiapretinha.org` / `local123` (senha só no banco local, não afeta produção). Mock `?mockesc=1&real=1` na URL loga de verdade e força `isEsc()`, contornando o spec de 17/07 ainda não implementado.

**Nada disso está commitado** — tudo local, aguardando aprovação antes de subir pro repo/produção.

### Fase 8c — Módulo ADMIN/Administração dentro do ESC (DESIGN FECHADO, ver specs acima)
Conteúdo definido: os 7 módulos do esboço original + os itens do spec de 18/07 (permissões, auditoria, avisos) dentro de Administração. Estrutura já prototipada localmente (ver acima). Falta: formulários de escrita (criar/editar) e subir pra produção.

### Fase 8d — Remodelar permissões (DESIGN FECHADO, ver spec 2026-07-18)
Fechado no item 4 do spec de 18/07: `role_permissions`/`access_groups` migram de por-associação pra por-empresa (template único, `empresa_id` preenchido = regra vale pra toda unidade). Falta implementar.

### Fase 8b — Reancorar inventário (menor, backend)
Endpoints de inventário em `geral.py` ainda ancoram em `current.association_id` e exigem `is_conferente` (que não inclui `admin_master`). Reancorar para nível empresa. Não urgente (inventário pode nem estar em uso).

### Outros itens levantados na conversa
- Adicionar `email-validator` ao `requirements.txt`, se quiser validação de formato de e-mail de volta
- App offline (APK/EXE) + painel de sincronização local — definido desde o início como projeto futuro separado
- Remodelagem completa do módulo financeiro do frontend — mencionada pelo usuário para depois desta base de governança

---

## Backups disponíveis (rede de segurança)
- Dumps locais completos: `backup-aprxm-20260716-2138.dump` e `backup-aprxm-PRE-7c-20260716-2144.dump` (protegidos por `.gitignore`, formato custom — restaurar via `pg_restore`)
- Snapshot manual no Neon (criado antes da Fase 7)
- Neon PITR: janela de 6h de restore point-in-time

## Estado do schema (produção)
`schema_migrations` em **v9** (produção, desde 2026-07-16). Sequência: v5 (empresas/provisioning_runs), v6 (dados/backfill), v7 (painel_admins), v8 (remove is_office/linked, empresa_id NOT NULL), v9 (users.empresa_id + backfill dos 25 usuários).
