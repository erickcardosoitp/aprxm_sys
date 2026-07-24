# Checklist ESC — pendências antes de produção

Levantado via auditoria completa (3 varreduras paralelas: Cadastros, Financeiro, Administração/TI/Acervo) em 2026-07-23. Cobre só as seções reais do ESC — placeholders confirmados (Produtos, Relatórios, Conciliação PIX, Plano de Metas, Monitor de Sincronização, Data Analytics, Banco de Dados, Fotos e Vídeos, Posts Website) ficam fora, são Fase futura de propósito.

Status de cada item: `[ ]` pendente, `[x]` feito.

---

## 🔴 Crítico — bugs que quebram funcionalidade ou dado financeiro

- [ ] **PDF de conferência de sessão de caixa quebra (500) quando há lançamento com forma de pagamento definida.** `backend/app/routers/finance.py:2157-2158` — a query retorna `(type, income_subtype, description, amount, pgto, morador, transaction_at)`, mas o código lê `tx[3]` (amount) como descrição e `tx[4]` (nome da forma de pagamento, ex. "PIX") como valor — `float("PIX")` estoura `ValueError`. Praticamente todo caixa real tem forma de pagamento preenchida, então a 2ª via/conferência quebra na maioria dos casos.
- [ ] **"Líquido" da listagem de Sessões de Caixa não desconta despesas**, só sangria. `backend/app/routers/esc.py:286` (`liquido = entradas - baixas`) — falta subtrair `saidas` (type='expense'). Valor exibido fica inflado sempre que houver despesa lançada no caixa.
- [ ] **Card "Sangrias (mês)" no Fluxo de Caixa sempre mostra R$ 0,00.** `GET /financeiro/summary` (`backend/app/routers/financeiro.py:89-98`) nunca retorna o campo `total_sangria` que o frontend lê (`FluxoCaixaSection.tsx:93`).
- [ ] **Auditoria (`audit_log`) não é alimentada por nenhum endpoint de escrita do ESC.** Criar/editar/desativar/excluir usuário, editar permissões, categorias, formas, lançar/baixar conta a pagar, gerar template, enviar aviso, editar estoque de comprovante — nenhum grava em `audit_log`. A tela "Auditoria" existe e funciona, mas fica vazia para tudo que é feito pelo Escritório. Compliance quebrado antes de produção.
- [ ] **Categoria de Contas a Pagar não chega na DRE.** A baixa (`esc.py:527-539`) insere a transação sem `category_id` — mesmo uma conta categorizada como "Aluguel" cai genérica em "Despesas Gerais" no DRE, perdendo a categorização.
- [ ] **DRE ignora Sangria por completo** (`financeiro.py:621`: só `type IN ('income','expense')`). Pode ser intencional (sangria = transferência interna), mas hoje não há nota explicando isso na UI — parece que o dinheiro "some" do relatório.

## 🟠 Alto — funcionalidade faltando que afeta operação real

- [ ] **Grupos de Usuários é 100% somente-leitura E mostra o dataset errado.** Lê `association_settings.access_groups` (por-associação, editável só via `PUT /settings/access-groups` sob `require_superadmin`, fora do ESC) — mas o que **realmente** controla o acesso dentro do próprio ESC é `empresas.access_groups` (editado em Administração → Permissões). Decidir: (a) fazer essa aba editar o dataset certo, ou (b) remover/renomear pra não confundir.
- [ ] **Categorias, Formas de Pagamento e Categorias de Contas a Pagar: só criar, sem editar/desativar/excluir.** Backend não tem `PUT`/`DELETE` pra nenhuma das três (`esc.py:804-856`, `321-344`). Erro de digitação numa categoria fica permanente.
- [ ] **Encomendas e Ordens de Serviço: 100% somente-leitura no ESC** (criação/edição só no nível de associação) **+ `LIMIT 200` sem filtro de data** (`esc.py:108,124`) — em empresa com volume alto, registros mais antigos ficam invisíveis mesmo com os filtros client-side, porque o corte já aconteceu no servidor.
- [ ] **Associações: 100% somente-leitura no ESC** — criar/editar/(des)ativar unidade só existe no router de superadmin de plataforma, fora do alcance do admin da própria empresa.
- [ ] **Módulo "financeiro" não aparece na grade de Permissões.** `frontend/src/pages/esc/AdminSections.tsx` (`MODULES`) não lista `financeiro` — hoje só funciona porque o default já libera diretoria/conselho/admin; não dá pra revogar/conceder pela UI.
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
