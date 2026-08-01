# Glossário de Indicadores — Painel da Presidência

**Data:** 2026-08-01 · Documento de negócio: o que cada indicador significa, não como
está implementado tecnicamente (isso está no spec e no plano de implementação).

---

## Início

**Receita do mês** — soma de tudo que entrou (mensalidade, taxa de entrega, comprovante
de residência, outras) desde o dia 1 do mês corrente até hoje.

**Taxa de cobrança** — de tudo que foi cobrado (gerado) no mês, quanto % já foi pago.
Uma taxa de 53% significa que, pra cada 2 mensalidades geradas, só 1 foi paga até agora.

**Inadimplência** — quanto está em aberto (não pago) neste momento, considerando só
quem já passou do prazo de tolerância (2 dias após o vencimento). A média mensal ao
lado mostra a tendência — se está subindo ou descendo mês a mês.

**Moradores** — total de pessoas cadastradas ativas, divididas em associados (pagam
mensalidade), dependentes (moram com um associado, não pagam separado) e visitantes
(moram no local mas ainda não formalizaram associação).

**Pacotes/OS** — quantas encomendas chegaram e quantas ordens de serviço (manutenção,
reparo) foram abertas/fechadas no mês.

**Alertas** — avisos automáticos de coisa que precisa de atenção: encomenda parada há
mais de 3 dias sem retirada, taxa de cobrança abaixo de 60%, caixa físico aberto sem
ter sido fechado no fim do expediente.

**Score de saúde da associação** — um número único de 0 a 100 que resume "como está a
associação agora", combinando taxa de cobrança + inadimplência + crescimento. Serve pra
uma leitura rápida sem precisar olhar cada número separado.

**Runway financeiro** — quantas semanas a associação consegue continuar operando com o
saldo de caixa atual, se não entrasse mais nenhuma receita nova. Um runway de 4 semanas
significa que, sem cobrar mais ninguém, o caixa dura só mais 1 mês.

**Faturamento mensal** — receita total, mês a mês, num gráfico de barras — pra ver se
está crescendo, caindo ou estável ao longo do tempo.

---

## Financeiro

**Gráfico de Faturamento** — o painel financeiro principal: mostra o total do período,
compara com a média histórica (Excelente/OK/Regular/Abaixo da média), e traz a linha do
dia a dia junto com uma versão suavizada (média móvel) que tira o "sobe e desce" do
dia de pagamento e mostra a tendência real.

**Receita por rua** — quanto cada rua da associação gera de receita, e quantos
moradores tem. Ajuda a ver se uma rua com poucos moradores está pagando bem, ou se uma
rua grande está com problema de cobrança.

**Faturamento por produto** — como cada tipo de receita (mensalidade, taxa de entrega,
comprovante de residência) varia dia a dia — mostra se a associação está dependendo
demais de um tipo só de receita.

**Margem líquida %** — de tudo que entrou, quanto sobrou depois de pagar as despesas.
Uma margem de 30% significa que, pra cada R$100 de receita, R$30 viram sobra (ou vão
pra folha, investimento, etc.).

**Comparativo Vaz Lobo vs Congonha** — as duas associações lado a lado, nos mesmos
indicadores — mostra qual unidade está performando melhor e onde focar esforço.

**Calendário de calor (receita por dia)** — um "mapa" visual dos dias do mês/trimestre/
ano, onde dias com mais receita ficam mais escuros — ajuda a enxergar padrão (ex.: todo
dia 20 do mês tem pico, por causa do vencimento de mensalidade).

**Aging de inadimplência** — separa quem está devendo há pouco tempo (0-30 dias) de
quem está devendo há mais tempo (30-60, 60+ dias). Uma dívida de 60+ dias é muito mais
difícil de recuperar que uma de 10 dias — esse indicador mostra se a inadimplência é
"recente e recuperável" ou "crônica".

---

## Moradores

**Crescimento** — quantos moradores novos entraram por semana/mês.

**Churn de associados** — associados ativos que não pagam mensalidade há 6 meses ou
mais. Não usa a baixa formal do cadastro (que na prática quase nunca é preenchida) —
identifica abandono de fato, mesmo que a pessoa ainda conste como "ativa" no sistema.

**Qualidade de cadastro** — quantos moradores estão com CEP ou telefone em branco no
cadastro. Cadastro incompleto atrapalha cobrança (não dá pra mandar boleto/aviso) e
notificação de encomenda.

**Funil Moradores → Visitantes → Associados** — mostra a "conversão": de todo mundo que
mora no local, quantos ainda são só visitantes, e quantos desses visitantes formalizaram
a associação. Um funil "apertado" (poucos associados em relação a visitantes) mostra
oportunidade de conversão.

**Novos visitantes por dia** — quantas pessoas novas entraram como visitante (ainda sem
formalizar associação) a cada dia — alimenta o funil acima.

---

## Mensalidades

**Ticket médio pago** — o valor médio que está sendo efetivamente pago por mensalidade
(considerando descontos/isenções) — pode ser bem menor que o valor "cheio" da tabela.

**Taxa de cobrança** (mesma definição do Início, mas aqui detalhada por mês).

**Tabela de inadimplência** — lista de quem está devendo, com uma estimativa de
"probabilidade de pagar" baseada no histórico (quem sempre pagou atrasado mas pagou tem
mais chance de pagar de novo do que quem nunca pagou nada) — ajuda a priorizar quem
cobrar primeiro.

---

## Pacotes

**SLA por tipo** — tempo médio entre a encomenda chegar e ser retirada, separado por
tipo de morador (associado/visitante).

**Top moradores por retirada** — quem mais recebe encomenda na associação — útil pra
entender se o volume está concentrado em poucas pessoas.

**Custo por encomenda entregue** — quanto custa (em despesa operacional) processar
cada encomenda — mede se a operação de logística está eficiente ou cara.

---

## OS (Ordens de Serviço)

**Tarefas no prazo %** — de tudo que devia ter sido resolvido até o prazo, quanto %
realmente foi. Mede a confiabilidade da operação de manutenção/reparo.

---

## Senso

**Mapa por CEP** — visualização geográfica de onde moram os associados, focado na
região de Madureira (onde a associação está) — ajuda a entender a distribuição
geográfica real, não só uma lista de rua.

---

## Operadores (módulo novo)

**Participação no faturamento** — quanto da receita total cada operador é responsável
por registrar (não necessariamente "vender" — inclui receber pagamento, registrar
transação).

**Tempo médio no sistema** — quanto tempo por dia, em média, o operador fica ativo no
sistema (do primeiro ao último acesso do dia) — uma aproximação de "tempo de trabalho
efetivo", já que o sistema não tem um botão de "bater ponto".

**Tarefas diárias concluídas** — quantas tarefas do dia a dia (checklist, manutenção)
esse operador finaliza.

**Feedback** — quantidade de tarefas atribuídas a esse operador que tiveram alguma
posição/movimento (estão "em andamento" ou "bloqueada"), mas ainda não foram concluídas.
Não é uma nota de satisfação do morador — é uma proxy de engajamento: mostra se o
operador está trabalhando as tarefas atribuídas (mesmo sem terminar) ou se estão
simplesmente paradas em "pendente" sem nenhum movimento.

**Índice de calor de performance** — um número de 0 a 100 que resume tudo (tarefas +
faturamento + vendas + tempo + feedback, as 5 métricas já disponíveis) num só valor, com
uma faixa de cor (vermelho=crítico, amarelo=regular, verde=bom) — serve pra comparar
operadores de forma justa, sem precisar olhar 5 números separados.

**Ranking de operadores** — lista ordenada de todos os operadores pelo índice de calor,
com um resumo de cada um — serve pra reconhecer quem está performando bem e identificar
quem precisa de apoio/treinamento.
