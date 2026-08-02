# Análise de Negócio — Abril a Julho de 2026

**Data:** 2026-08-01 · Escopo: revalidação dos indicadores financeiros/operacionais
após a limpeza de dados desta sessão (unificação transactions/mensalidades,
correção do parcelamento, exclusão de suspenso/inativo/cancelado dos cálculos).
Atualiza `2026-08-01-analise-dados-negocio-mensalidade.md` com dado corrigido.

---

## 1. O que mudou desde a última análise

Antes desta limpeza, os números de junho/julho estavam distorcidos por:

- **535 pagamentos históricos de migração** existiam só em `migration_payments`,
  fora de `transactions` — receita subestimada nos meses cobertos por eles.
- **Parcelamento (acordo) sem limite** — um caso real cobriu 15 meses *futuros*
  como se fossem atrasado, inflando "mensalidades vencidas" e derrubando a
  taxa de retenção de quem estava, na verdade, em dia.
- **306 associados sem próxima cobrança agendada** após pagar — sub-relatava
  quantos estavam realmente adimplentes/cobráveis no período.
- **Suspenso/inativo entrando no cálculo** — taxa de cobrança e vencidas
  incluíam 30 mensalidades de gente que não é mais membro ativo.

Os números abaixo já refletem tudo corrigido.

---

## 2. Receita por mês (líquida — exclui estornos)

| Mês | Mensalidade | Taxa Entrega | Comprovante | Outras | **Total** |
|---|---|---|---|---|---|
| Abril | R$ 5.620,04 | R$ 688,00 | R$ 240,00 | R$ 0,00 | **R$ 6.548,04** |
| Maio | R$ 6.497,50 | R$ 1.432,52 | R$ 249,99 | R$ 42,51 | **R$ 8.222,52** |
| Junho | R$ 5.980,00 | R$ 1.627,51 | R$ 140,00 | R$ 140,00 | **R$ 7.887,51** |
| Julho | R$ 4.865,00 | R$ 1.730,00 | R$ 145,00 | R$ 20,00 | **R$ 6.760,00** |
| **Média** | **R$ 5.740,64** | **R$ 1.369,51** | **R$ 193,75** | **R$ 50,63** | **R$ 7.354,52** |

⚠️ **Julho tem uma anomalia contábil não-recorrente**: duas transações de
"Zeramento administrativo total (ESC)" somando R$ 9.359,16 em `sangria` no
dia 31/07 (fechamento de caixa das duas associações), separadas do estorno
de sangria de salário (R$ 8.128,01) já identificado antes — esse estorno
**já está excluído** da tabela acima (é `is_reversal=true`, a mesma regra
que o ETL aplica). O zeramento administrativo não afeta receita (é
movimentação de caixa, não receita/despesa), mas explica por que o saldo em
caixa de julho não bate ingenuamente com "receita − despesa".

Mensalidade caiu 27% de maio (R$6.498) pra julho (R$4.865) — não é queda de
adimplência (taxa de cobrança de julho é a **melhor** do período, 61,2%),
é queda no valor cobrado (menos mensalidades vencendo naquele mês
especificamente, ver seção 3).

---

## 3. Cobrança e inadimplência

| Mês | Pagas | Vencidas | Acordo | Total gerado | Taxa cobrança | Retenção |
|---|---|---|---|---|---|---|
| Abril | 53 | 93 | 5 | 151 | 35,1% | 36,3% |
| Maio | 190 | 167 | 1 | 358 | 53,1% | 53,2% |
| Junho | 189 | 279 | 1 | 469 | 40,3% | 40,4% |
| Julho | 232 | 146 | 1 | 379 | **61,2%** | **61,4%** |

Tendência **melhorando**, mas com volatilidade grande mês a mês (35%→53%→40%→61%).
Isso é esperado num período de transição de modelo de cobrança (calendário fixo
→ ciclo rolante de 15 dias, mudança feita hoje) — os próximos 2-3 meses devem
mostrar se o ciclo rolante estabiliza essa taxa.

**Inadimplência total agora (snapshot, não por mês):** R$ 11.760,54 em 398
mensalidades vencidas de associados ativos.

**Parcelamento em aberto:** 5 associados, R$ 419,98 total — pequeno, sob controle.

---

## 4. Crescimento de moradores

| Mês | Novos associados | Novos visitantes | Novos dependentes |
|---|---|---|---|
| Abril | 221 | 329 | 31 |
| Maio | 120 | 334 | 25 |
| Junho | 64 | 293 | 16 |
| Julho | 101 | 252 | 22 |

⚠️ **Abril/Maio inflados por migração de cadastro** (mesma ressalva do
relatório anterior) — não é crescimento orgânico real, é gente que já
morava lá sendo cadastrada no sistema novo. Junho (64) é a base mais
confiável de crescimento orgânico mensal. Julho (101) pode ter um
componente de migração residual — vale confirmar com quem fez os cadastros.

**Estado atual:** 1.792 moradores ativos (499 associados, 94 dependentes,
1.199 visitantes) — funil visitante→associado ainda bem aberto (associado
é só 28% do total).

---

## 5. A operação comporta a folha?

Folha informada (11 funcionários): **R$ 13.021,00/mês** (dado fora do sistema
— nenhuma despesa de "Salários" aparece em `transactions`; as categorias de
despesa reais no período somam só R$ 44-248/mês, tudo manutenção/material,
nada de folha).

| | |
|---|---|
| Receita média (abr-jul, corrigida) | R$ 7.354,52 |
| Cobertura da folha | **56,5%** |
| Falta cobrir | R$ 5.666,48/mês |

Piora levemente vs a análise anterior (58% → 56,5%) porque a correção dos
estornos/parcelamento **reduziu** a receita de alguns meses que estavam
artificialmente infladas, não porque a operação piorou de fato.

### Taxa de recuperação da inadimplência

"Taxa de cobrança no fechamento" (47,4%) **subestima** a cobrança real: não
dá tempo pro atraso virar pagamento. Olhando tudo que já venceu (pagou no
prazo não conta, isso não é inadimplência):

| Situação | Qtd | Valor | % |
|---|---|---|---|
| Recuperada (paga com atraso) | 469 | R$ 8.612,82 | 40,6% |
| Em recuperação (parcelamento ativo) | 19 | R$ 419,98 | 2,0% |
| Nunca recuperada (ainda vencida) | 624 | R$ 12.170,54 | 57,4% |

**Taxa de recuperação da inadimplência: ~40,6%** — de cada R$100 que vira
atraso, ~R$41 volta; o resto (R$57 de cada R$100) fica em aberto pra sempre.

Isso muda a taxa de cobrança **efetiva** (pago no prazo + recuperado depois
+ parcelamento, sobre tudo que já teve chance de resolver): **56,7%**, não
47,4%.

### Mensalidade necessária pra cobrir a folha sozinha

Base: 499 associados ativos.

| Cenário | Taxa | Mensalidade necessária |
|---|---|---|
| "No fechamento" (subestima, não espera recuperação) | 47,4% | R$ 48,23 |
| **Efetiva atual** (já conta quem paga atrasado) | 56,7% | **≈ R$ 40,32** |
| Se a recuperação de atraso melhorar de 40,6% → 60% | 69,8% | ≈ R$ 32,75 |
| Ideal (100% recuperado, mesmo atrasado) | 100% | ≈ R$ 22,86 |

**R$ 40,32 é a resposta correta pro cenário atual** — R$48,23 penalizava
inadimplência que, na prática, acaba sendo recuperada. Mensalidade padrão
hoje é R$20 — mesmo no cenário efetivo (mais favorável), precisaria dobrar
pra cobrir a folha sozinha.

---

## 6. Recomendações

1. **Ciclo rolante (+15 dias) mudou hoje** — acompanhar taxa de cobrança de
   agosto/setembro pra ver se estabiliza acima de 50% de forma consistente,
   em vez da oscilação 35-61% observada.
2. **56,5% de cobertura da folha** é insuficiente — aumento de mensalidade
   e/ou taxa de associação (estudo já feito no relatório anterior) continua
   sendo a alavanca principal, taxa de cobrança sozinha não fecha a conta.
5. **Taxa de recuperação de atraso (40,6%) é baixa** — mais de metade do
   que vence nunca volta. Melhorar cobrança ativa (agente/CRM) sobre os
   624 casos "nunca recuperados" (R$12.170,54) tem mais alavancagem
   imediata que só subir o valor da mensalidade.
3. **1.199 visitantes vs 499 associados** — funil de conversão é a maior
   oportunidade de receita não explorada (mais gente pra converter em
   associado do que já é).
4. Confirmar com a equipe se os 101 novos associados de julho são orgânicos
   ou resíduo de migração, pra não superestimar a tendência de crescimento.
