# Checklist ESC — pendências antes de produção

Levantado via auditoria completa (3 varreduras paralelas: Cadastros, Financeiro, Administração/TI/Acervo) em 2026-07-23. Cobre só as seções reais do ESC — placeholders confirmados (Relatórios, Conciliação PIX, Plano de Metas, Data Analytics, Banco de Dados, Fotos e Vídeos, Posts Website) ficam fora, são Fase futura de propósito. (Produtos deixou de ser placeholder — implementado, ver "Já resolvido". Qualquer item relacionado a app offline/PDV ou Monitor de Sincronização fica fora deste spec — tratado à parte, projeto futuro pausado.)

Status de cada item: `[ ]` pendente, `[x]` feito.

---

## 🔴 Crítico — bugs que quebram funcionalidade ou dado financeiro

- [x] **PDF de conferência de sessão de caixa quebra (500) quando há lançamento com forma de pagamento definida.** Corrigido — query reescrita (`generate_conferencia_pdf`), índices de tupla corrigidos, e sanitizador `_pdf_safe()` adicionado pra caracteres unicode (em-dash etc.) que também quebravam o fpdf2. Testado ao vivo: 200 OK, PDF válido gerado.
- [ ] **"Líquido" da listagem de Sessões de Caixa não desconta despesas**, só sangria. `backend/app/routers/esc.py:286` (`liquido = entradas - baixas`) — falta subtrair `saidas` (type='expense'). Valor exibido fica inflado sempre que houver despesa lançada no caixa.
- [ ] **Card "Sangrias (mês)" no Fluxo de Caixa sempre mostra R$ 0,00.** `GET /financeiro/summary` (`backend/app/routers/financeiro.py:89-98`) nunca retorna o campo `total_sangria` que o frontend lê (`FluxoCaixaSection.tsx:93`).
- [ ] **Auditoria (`audit_log`) não é alimentada por nenhum endpoint de escrita do ESC.** Criar/editar/desativar/excluir usuário, editar permissões, categorias, formas, lançar/baixar conta a pagar, gerar template, enviar aviso, editar estoque de comprovante — nenhum grava em `audit_log`. A tela "Auditoria" existe e funciona, mas fica vazia para tudo que é feito pelo Escritório. Compliance quebrado antes de produção.
- [ ] **Categoria de Contas a Pagar não chega na DRE.** A baixa (`esc.py:527-539`) insere a transação sem `category_id` — mesmo uma conta categorizada como "Aluguel" cai genérica em "Despesas Gerais" no DRE, perdendo a categorização. (Nota: `payable_categories`, o cadastro próprio de categoria de contas a pagar, é conceito separado de `transaction_categories`/DRE — ver decisão de design em `esc.py:613`.)
- [x] **DRE ignora Sangria por completo.** Decisão tomada: sangria É despesa real (dinheiro saindo do caixa pra pagar algo — ex. sangria de salário). `get_dre()` reescrito: sangria entra somada às despesas, agrupada pela categoria da transação ou, na falta dela, pelo `sangria_reason`. Nota explicativa adicionada na UI (`DRESection.tsx`). Testado ao vivo.

## 🟠 Alto — funcionalidade faltando que afeta operação real

- [x] **Grupos de Usuários "dataset errado".** Reverificado nesta sessão: o endpoint atual (`GET/PUT /esc/administracao/access-groups`) já lê/grava em `empresas.access_groups` — o dataset certo, é editável pelo ESC. Claim original do audit de 23/07 estava desatualizado. Reestruturado agora pra organizar primeiro por Cargo, depois por Módulo (era o inverso, causava confusão).
- [ ] **Categorias, Formas de Pagamento: só criar, sem editar/desativar/excluir.** Backend não tem `PUT`/`DELETE` pra essas duas (`esc.py:804-856`). Erro de digitação numa categoria fica permanente. (Categorias de Contas a Pagar (`payable_categories`) já tem `PUT` — editar nome/ativo — resolvido à parte.)
- [ ] **Encomendas e Ordens de Serviço: 100% somente-leitura no ESC** (criação/edição só no nível de associação) **+ `LIMIT 200` sem filtro de data** (`esc.py:108,124`) — em empresa com volume alto, registros mais antigos ficam invisíveis mesmo com os filtros client-side, porque o corte já aconteceu no servidor.
- [ ] **Associações: 100% somente-leitura no ESC** — criar/editar/(des)ativar unidade só existe no router de superadmin de plataforma, fora do alcance do admin da própria empresa.
- [x] **Módulo "financeiro" não aparece na grade de Permissões.** Reverificado: `MODULES` em `AdminSections.tsx` já inclui `financeiro` — item já estava resolvido antes desta sessão.
- [ ] **Administração → Estoque é uma cópia read-only e incompleta de Cadastros → Comprovantes de Residência.** Mesmo dado, sem o botão de editar que a outra tela já tem. Decidir: adicionar paridade ou remover a duplicata.
- [ ] **Baixa de Contas a Pagar nunca permite vincular a um caixa físico** — a UI sempre envia `cash_session_id: null`, embora o backend já suporte (`BaixaContaPagarRequest.cash_session_id`). Falta o seletor de sessão no modal.

## 🟡 Médio — qualidade de dado, tradução, formatação

- [ ] Usuários: coluna "Cargo" e `<select>` do formulário mostram o enum cru (`admin_master`, `diretoria_adjunta`...) sem tradução.
- [ ] Usuários: campo `phone` existe no backend mas não tem input no formulário (campo morto).
- [ ] Usuários: `last_login_at` é retornado mas nunca exibido — útil pra achar usuário nunca logado.
- [ ] Movimentações: filtro "Cargo" cru; coluna "Status Morador" cru (`active/inactive/suspended`).
- [ ] CRM (abas "A receber"/"Pagos"): `reference_month` cru (`"2026-07"`), `paid_at` timestamp cru com microssegundos, valor sem `toLocaleString` (`"R$ 150.00"` em vez de `"R$ 150,00"`).
- [ ] DRE: quando não há description/categoria, mostra `income_subtype` cru em vez de usar o `SUBTYPE_MAP` que já existe no mesmo arquivo.
- [ ] DRE: `sub_agrupar_por` implementado no backend mas nunca usado no frontend — funcionalidade morta.
- [ ] Contas a Receber: zero filtros (nem busca, nem unidade, nem período) nas duas abas; `reference_month` cru; sem paginação.
- [ ] Sangrias: valor sem formatação pt-BR; só filtro de unidade (backend já suporta `date_from`/`date_to`, não exposto na UI).
- [ ] `EscInfraSection`: falha silenciosa sem mensagem de erro visível se a chamada falhar.

## 🟢 Baixo / decisão de escopo — não são bugs, mas precisam de uma decisão

- [ ] Endpoint `GET /esc/administracao/permissoes` + `escService.permissoes()` existe mas não é chamado em nenhuma tela — usar ou remover.
- [ ] Formas de pagamento são texto livre, e a lógica financeira detecta tipo por `ILIKE '%pix%'`/`'%dinheiro%'` no nome (`esc.py:258-259`) — risco de inconsistência se alguém digitar diferente do esperado.
- [ ] Checagem de e-mail duplicado em criar/editar usuário é global (não filtra por `empresa_id`) — confirmar se é intencional (provavelmente sim, login é por e-mail único na plataforma) ou se deveria ser por empresa.
- [ ] `require_empresa_admin` não valida explicitamente `current.empresa_id is not None` — blindagem defensiva, não é exploit confirmado.
- [ ] Qualquer admin de empresa pode criar outro usuário com cargo `admin_master` sem restrição adicional — confirmar se é a regra desejada.

---

## Já resolvido nesta rodada (batches anteriores, 2026-07-22/23)

OS numeração unificada por empresa · CRM sem agrupamento, paginação 50/página · Taxa de entrega 1 morador = 1 retirada · Bug de escopo no estorno de transação (ESC não conseguia estornar nada de unidade) + UI de estorno em Movimentações e Sangrias · Categorias/Formas: scroll corrigido + consolidação empresa-wide (duplicatas removidas, sem quebrar histórico) · Categorias próprias de Contas a Pagar (`payable_categories`, migration v14) · Zerar caixa: saldo físico real por unidade (sessões conferidas + lançamentos sem caixa) · Sangria de teste removida da produção · `plan_name` Teste QA → Homologação (produção) · Homologação/`_DELETADO` escondidos das listagens · Edição de e-mail de usuário · Edição de estoque de comprovante pelo ESC · Ordenação por clique em todas as tabelas.

## Já resolvido nesta rodada (batch 2026-07-26/27, ambiente local `esc-checklist-review`, ainda não em produção)

- **PDF de conferência de sessão de caixa** — os 2 bugs reais corrigidos (query com colunas inexistentes + crash de unicode no fpdf2) e UI do modal melhorada (R$ nos campos, obrigatórios marcados).
- **DRE — sangria como despesa** — decisão de negócio implementada e testada; nota explicativa na UI.
- **DRE zerado até agosto/2026** — piso de data `>= 2026-08-01` na query; meses anteriores vêm zerados de propósito (decisão do usuário).
- **Desconferir caixa** — feature nova completa: migration v15 (`cash_sessions.reverted_reason/reverted_at`), endpoint com justificativa obrigatória, sessão volta como "Devolvido" no módulo Caixa da unidade, pode ser conferida de novo. Testado ao vivo ponta a ponta.
- **Movimentações — coluna Justificativa** — `t.description` exposto e exibido (estava faltando, saídas não mostravam o motivo).
- **Grupos de Usuários** — scroll corrigido; reorganizado por Cargo → Módulo (era o inverso); confirmado que já edita o dataset certo (`empresas.access_groups`).
- **Cores nas tabelas** — badge colorido consistente (hash do nome → paleta) em toda coluna Unidade/Associação, centralizado em `EscDataTable` + replicado em Movimentações e Sessões de Caixa.
- **Categorias de receita limpas** — removida referência confusa "F11"; ficou Declaração de Residência, Mensalidade, Taxa de Entrega, Doação, Outros.
- **Justificativa obrigatória em despesa** — bloqueado no backend (`TransactionRequest`, mín. 5 caracteres) e reforçado no front (`FinancePage.tsx`).
- **Categorias de Contas a Pagar cadastradas** — Salário, Manutenção, Tecnologia, Terceiros; confirmado que o modal de lançamento já lista corretamente.
- **Cadastro de Produtos implementado** (era placeholder vazio) — migration v16 (tabela `products`, empresa-wide: Mensalidade/Taxa de Entrega/Comprovante de Residência, preço associado/não-associado). Taxa de Entrega passa a ler o preço direto do cadastro (era constante fixa no código). Mensalidade: preço do produto é sugestão/padrão; ao editar, sistema detecta associações com valor já customizado e pergunta se aplica o novo valor a todas ou respeita quem já customizou — testado nos 3 cenários (sem conflito, com conflito + aplicar todas, com conflito + respeitar customizado).

**Pendente de decisão do usuário:** subir este batch pra produção (ainda só no ambiente local, branch de revisão) — aguardando validação tela por tela.
