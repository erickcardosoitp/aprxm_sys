# Análise de Dados & Negócio — Indicadores, Folha e Mensalidade

**Data:** 2026-08-01 · Escopo: avaliação dos indicadores atuais do painel da presidência,
novos indicadores propostos, e estudo financeiro sobre folha de pagamento vs. mensalidade.

---

## 1. Os indicadores atuais (33 tabelas gold) são suficientes?

**Parcialmente.** Cobrem bem volume/contagem (receita, encomendas, tarefas, moradores),
mas faltam 3 categorias:

| Falta | Por quê importa |
|---|---|
| Série temporal com média móvel | Nenhuma tabela traz lucro suavizado — só soma/snapshot por período |
| Indicador de capacidade financeira (folha vs. receita) | Não existe métrica ligando custo operacional (funcionários) à receita |
| Geografia real (mapa) | Rua é texto, não coordenada — precisa geocodificar CEP pra plotar de verdade |

## 2. Novos indicadores sugeridos

- **Ticket médio de mensalidade paga** vs. valor cheio (mede erosão por desconto/isenção)
- **Custo por encomenda entregue** (despesa operacional ÷ volume)
- **Churn de associados** (saída/mês) — hoje só temos "novos", não perda
- **Aging de inadimplência** (0-30 / 30-60 / 60+ dias) — dado bruto existe, não exposto
- **Receita por tipo de morador** (member vs guest)

## 3. Pedidos específicos — telas do painel

| Pedido | Fonte de dado | Status |
|---|---|---|
| Lucro bruto diário (MM7) por mês | `receita_diaria.saldo_liquido` | dado pronto, falta suavizar (MM7) |
| KPI inadimplência média R$/mês | `mensalidades` status='pending' por mês vencido | calculado abaixo |
| Streamgraph top moradores por encomenda retirada | `ranking_encomendas_morador` | pronto |
| Mapa por CEP (região Madureira) | `residents.address_cep`, prefixo 213xx | confirmado, falta geocodificar |
| Receita por semana (dd/mm-dd/mm) | `receita_semanal` | pronto |
| Receita por rua / moradores por rua | join `residents` + `transactions` | calculado abaixo |

### KPI — Inadimplência média (R$/mês)

Baseado nos 3 últimos meses fechados (abril-junho; julho ainda em cobrança no momento
da análise):

| Mês | Inadimplente (R$) |
|---|---|
| Abril | R$ 1.800,00 |
| Maio | R$ 2.800,00 |
| Junho | R$ 3.700,00 |
| **Média** | **R$ 2.766,67/mês** |

⚠️ Tendência de alta (não estável) — vale indicador de tendência junto do número.

### Top moradores por encomenda retirada (amostra)

Verônica Viana Da Silva (58), Jaqueline Ferreira Da Silva (55), Maria Elvira Alves
Ferreira Alves (55), Pedro Henrique Machado (45), Mayara Magda do Nascimento (44).

### Região Madureira — confirmação de CEP

CEP prefixo **213xx** cobre Madureira/Vaz Lobo/Congonha/Irajá: 87 moradores em
21360-Madureira, 52 em 21361-Vaz Lobo, 45 em 21540-Turiaçu, 25 em 21360-Vaz Lobo.

### Receita por semana (formato dd/mm-dd/mm)

| Semana | Lucro líquido |
|---|---|
| 19/07-25/07 | R$ 867,50 |
| 12/07-18/07 | R$ 1.782,50 |
| 05/07-11/07 | R$ 1.660,00 |
| 28/06-04/07 | R$ 1.427,50 |
| 21/06-27/06 | R$ 1.005,00 |
| 14/06-20/06 | R$ 1.370,00 |
| 07/06-13/06 | R$ 2.695,00 |
| 31/05-06/06 | R$ 1.351,25 |

### Receita por rua / moradores por rua (top 5)

| Rua | Moradores | Receita mensalidade (histórico) |
|---|---|---|
| Rua Sílvio Tibiriçá | 45 | R$ 840,00 |
| Rua Buriti | 31 | R$ 1.440,00 |
| Rua Ramiro Monteiro | 26 | R$ 800,00 |
| Rua Manuel Machado | 26 | R$ 780,00 |
| Rua Macunaíma | 23 | R$ 680,00 |

Nota: Rua Buriti tem menos moradores que Sílvio Tibiriçá mas quase o dobro de receita —
vale investigar (mensalidade mais alta ali, ou melhor taxa de pagamento).

---

## 4. Anomalia encontrada — estorno de sangria de salário (julho)

Ao reconciliar "receita do mês passado" com o usuário, identificado que a receita bruta
de julho (R$14.498,01, antes de excluir estornos) incluía R$8.128,01 de **estorno de
sangria de pagamento de salário**:

- 13/07 — sangria de R$3.628,00 "Salários" (Vaz Lobo) → estornada em 24/07
- 14/07 — sangria de R$4.500,00 "Salário dos funcionários" (Congonha) → estornada em 24/07

Nenhum novo lançamento de salário foi encontrado depois de 24/07 substituindo esses dois.
Receita líquida real de julho (excluindo estornos): **R$6.280,00**.

**Junho confirmado limpo** (sem essa anomalia) — receita líquida real R$7.607,51, batendo
com a lembrança do usuário de "8k e pouco".

---

## 5. Estudo financeiro — a operação comporta a folha?

**Folha informada** (11 funcionários): **R$ 13.021,00/mês**
(Fernanda 500, Monique 1500, Vinicius 1500, Carla 3000, Hosana 500, Danielly 500,
PV 400, Hanielly 500, Leila 1621, Felipe 500, Célia 2500)

### Receita real por fonte (média meses fechados abr-jun)

| Fonte | Média mensal |
|---|---|
| Mensalidade | R$ 4.512,51 |
| Taxa de entrega | R$ 1.249,34 |
| Comprovante de residência | R$ 209,99 |
| Outras | R$ 60,84 |
| **Total não-mensalidade** | **R$ 1.520,18** |

### Quanto precisa vir de mensalidade pra cobrir a folha

| | |
|---|---|
| Folha total | R$ 13.021,00 |
| (–) Outros produtos (média) | R$ 1.520,18 |
| **Precisa vir de mensalidade** | **R$ 11.500,82** |

492 associados ativos hoje (Congonha 314 + Vaz Lobo 178):

| Cenário | Taxa de cobrança | Mensalidade necessária |
|---|---|---|
| Realista (taxa atual ~53%) | 53% | **≈ R$ 44,20** |
| Moderado (65%) | 65% | **≈ R$ 35,80** |
| Ideal (100%) | 100% | **≈ R$ 23,40** |

**Resposta direta: a operação NÃO comporta a folha hoje.** Mensalidade padrão atual é
R$20,00 — pra cobrir a folha inteira sem melhorar a taxa de cobrança, precisaria quase
dobrar (pra ~R$44).

### Estudo de cenário: mensalidade R$25 + taxa de associação R$30

Base: junho (mês mais estável), mensalidade média hoje R$19,80, taxa de cobrança real 53,5%.

| | Hoje (R$20) | Proposto (R$25) | Diferença |
|---|---|---|---|
| Potencial 100% (492 associados) | R$ 9.840,00 | R$ 12.300,00 | +R$ 2.460,00 |
| **Realizado** (mesma taxa 53,5%) | R$ 5.264,40 | R$ 6.580,50 | **+R$ 1.316,10/mês (+25%)** |

**Taxa de associação (R$30, só quem entra novo):** não existe hoje. Usando junho (64
novos associados, base mais conservadora — os meses anteriores estão inflados por
migração de cadastro pro sistema, não entrada orgânica real):

- 64 novos/mês × R$30 = **+R$1.920,00/mês** (assumindo cobrança na entrada, mais fácil
  de garantir que mensalidade recorrente)

**Total combinado — ganho estimado vs. hoje:**

| | Hoje | Cenário novo | Ganho |
|---|---|---|---|
| Mensalidade | R$ 5.700,00 | R$ 6.580,50 | +R$ 880,50 |
| Taxa associação | R$ 0 | R$ 1.920,00 | +R$ 1.920,00 |
| Outros produtos (inalterado) | R$ 1.907,51 | R$ 1.907,51 | — |
| **Total mensal** | **R$ 7.607,51** | **R$ 10.408,01** | **+R$ 2.800,50 (+37%)** |

Cobertura da folha sobe de **58% hoje** (R$7.607/R$13.021) pra **~80%** no cenário novo.

### Ressalvas

1. Taxa de associação é uma **ideia nova**, não existe cobrança hoje — decisão de produto/negócio.
2. Base de "novos associados/mês" (64, junho) é de apenas 1 mês de dado limpo — os meses
   anteriores (221, 120, 101) estão inflados por migração de cadastro, não são taxa
   orgânica sustentável. Acompanhar mais alguns meses antes de fechar a projeção.
3. Mesmo no cenário otimista, ainda falta ~20% pra cobrir a folha inteira — via aumento
   de mensalidade sozinho não fecha sem também melhorar a taxa de cobrança (hoje ~53%).
