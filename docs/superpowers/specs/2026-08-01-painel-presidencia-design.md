# Painel da Presidência — Design

**Data:** 2026-08-01 · **Status:** aprovado, pendente de plano de implementação
**Revisão 2:** indicadores por tela alinhados com o usuário via brainstorm dedicado
(referências visuais fornecidas), análise de dados/negócio prévia salva em
`docs/superpowers/reports/2026-08-01-analise-dados-negocio-mensalidade.md`.

## Contexto

Hoje a presidência acompanha a saúde da associação por um Excel (`Consolidado APRXM.xlsm`,
OneDrive), 8 abas (INICIO, PRESIDENCIA, FINANCEIRO, MORADORES, MENSALIDADES, PACOTES, OS,
SENSO) alimentadas manualmente/por export do datalake. Objetivo: substituir por um painel
web read-only, alimentado direto pelo data warehouse dedicado (`aprxm-analytics`),
acessível só por quem já teria essa visão hoje (`admin`, `conselho`).

## Escopo

**9 abas** (8 originais do Excel + Operadores, novo módulo identificado nesta revisão).
Ordem de construção sugerida pro plano de implementação (não muda o escopo final, só a
sequência):

1. `/inicio` + `/resumo` — o que a presidência mais olha primeiro.
2. `/financeiro` + `/moradores`
3. `/mensalidades` + `/pacotes` + `/os` + `/senso` + `/operadores`

## Arquitetura

```
┌────────────────────────────┐        ┌──────────────────────────┐
│ presidencia.aprxm (novo)   │  JWT   │ backend atual (FastAPI)  │
│ mini-app React, deploy     │───────►│ + router presidencia.py  │
│ Vercel separado, read-only │  login │ + presidencia_service.py │
└────────────────────────────┘  igual └───────────┬──────────────┘
                                                   │ SELECT (read-only)
                                                   ▼
                                    Neon "aprxm-analytics" (data warehouse dedicado)
                                    33 tabelas gold, pt-BR, com empresa_id
                                    (receita_diaria, margem_mensal, panorama_moradores,
                                     relatorio_inadimplencia, ranking_encomendas_morador,
                                     desempenho_operador, etc.)
```

- **Auth:** reaproveita login/JWT do aprxm (mesma credencial). `require_presidencia_access`
  em `tenant.py`: libera `role in ('admin', 'conselho')` + bypass pra `superadmin`/
  `admin_master`. 403 pra qualquer outro role. **Já implementado e validado em produção.**
- **Backend:** router `backend/app/routers/presidencia.py` + service
  `presidencia_service.py`, conexão própria pro data warehouse via
  `DATAWAREHOUSE_APRXM_DATABASE_URL`. **Já implementado** (`/status`, `/inicio`, `/resumo`
  parcial — ver Fase 1 do plano de implementação).
- **Frontend:** projeto novo (Vite/React), mesmo padrão de deploy do portal do morador —
  **ainda não iniciado**, aguardando sinal explícito do usuário (combinado anteriormente).

## Frescor do dado

ETL roda 2x/dia (09h/17h BRT), empresa-aware, 33 tabelas gold em português — **validado
de ponta a ponta em produção** (ver plano de implementação, Fases 0-3 concluídas). Cada
request de `/presidencia/*` lê `etl_runs` e retorna `generated_at`/`stale` junto do
payload — `stale: true` quando o último run não foi `success`.

---

## Indicadores por tela (consolidado do brainstorm)

Cada indicador abaixo já foi mapeado pra uma tabela gold existente (nome entre
parênteses) — nenhum exige nova extração ETL, salvo indicado.

### 1. Início

| Indicador | Forma | Fonte |
|---|---|---|
| Receita do mês | stat tile | `receita_diaria` (soma do mês) |
| Taxa de cobrança | stat tile | `taxa_cobranca` |
| **Inadimplência** — total em aberto (grande) + média mensal (pequeno, referência) | stat tile + mini-gráfico de tendência (ver §Componentes) | `relatorio_inadimplencia` (snapshot) + média histórica calculada |
| Moradores (total/associados/dependentes/visitantes) | stat tile | `panorama_moradores` |
| Pacotes/OS (recebidos, abertas/fechadas) | stat tile | `encomendas_mensal`, `ordens_servico_mensal` |
| Alertas (pacotes parados, taxa baixa, caixa aberto) | lista ícone+status | `encomendas_paradas` + `cash_sessions` (live) |
| **Score de saúde da associação (0-100)** *novo* | stat tile grande | composto: taxa cobrança + inadimplência + crescimento, pesos a definir na Fase de implementação |
| **Runway financeiro (semanas de operação)** *já existe, nunca exposto* | stat tile | `runway_financeiro` |
| **Faturamento mensal** (bar chart, mês atual + hover destacados) | bar chart (ver §Componentes) | `margem_mensal.receita_total` por mês |

### 2. Resumo
9 KPIs com WoW/MoM/YoY/ToT — sem mudança desta revisão (ver Fase 1 do plano de
implementação, 4/9 já implementados).

### 3. Financeiro

| Indicador | Forma | Fonte |
|---|---|---|
| Receita diária | série temporal (bruto fino + MM7 por cima) | `receita_diaria` |
| Taxa de cobrança | número/série | `taxa_cobranca` |
| Inadimplência por pessoa | tabela | `relatorio_inadimplencia` |
| **Receita por rua** *novo* | tabela/ranking | join `residents`+`transactions` (agregação nova, não está em gold ainda — avaliar na Fase de implementação) |
| **Receita por tipo (mensalidade/entrega/comprovante/outras)** *novo* | **barra horizontal ordenada** (não funil — categorias não são sequenciais) | `receita_diaria` (colunas já existem) |
| **Margem líquida %** *novo* | **barra segmentada de progresso** (ver §Componentes) | `margem_mensal.margem_pct` |
| **Comparativo Vaz Lobo vs Congonha lado a lado** *novo* | 2 colunas de stat tiles espelhados | qualquer tabela com `id_associacao`, filtrado por associação |
| **Calendário de calor — receita por dia** *novo* | heatmap (ver §Componentes), períodos: 7 dias/Mês/Trimestre/Semestre/Ano | `receita_diaria` |
| **Tabela detalhada dia × produto** *novo* | tabela | `receita_diaria` (colunas de subtype já existem) |

### 4. Moradores

| Indicador | Forma | Fonte |
|---|---|---|
| Total/crescimento/ranking/censo | stat tile / ranking | `panorama_moradores`, `crescimento_associados_semanal`, `censo_por_rua` |
| **Churn de associados** *novo* | stat tile + tendência | precisa de extração nova (saída de member ativo → inativo/move_out) |
| **Qualidade de cadastro** (% sem CEP/telefone) *novo* | barra segmentada ou stat tile | `residents` (operacional, não gold — dado de qualidade, não histórico) |
| **Funil: Moradores → Visitantes → Associados** *novo* | funil de conversão (rampa violeta, claro→escuro) | `panorama_moradores` (contagens por tipo) |
| **Novos visitantes por dia** *novo* | bar chart diário (rampa violeta, barra fina) | precisa de extração nova (residents.created_at onde type='guest') |

### 5. Mensalidades

| Indicador | Forma | Fonte |
|---|---|---|
| Pagas/vencidas/retenção | stat tile | `retencao_mensal`, `taxa_cobranca` |
| **Aging de inadimplência (0-30/30-60/60+ dias)** *novo* | barra empilhada ou tabela | `mensalidades` (operacional) — precisa de bucket novo no ETL |
| **Ticket médio pago** *novo* | stat tile | `taxa_cobranca` (valor_pago/pagas) |
| **Taxa de cobrança** | **barra segmentada de progresso** (visual alternativo ao número) | `taxa_cobranca` |
| **Tabela rica de inadimplência** *novo* — avatar+nome, status (badge), valor devido, sparkline de tendência de atraso, probabilidade de pagamento (HIGH/MID/LOW), última ação | tabela (ver §Componentes) | `relatorio_inadimplencia` + histórico de pagamento pra probabilidade |

### 6. Pacotes

| Indicador | Forma | Fonte |
|---|---|---|
| Recebidos/parados/SLA | stat tile | `encomendas_mensal`, `encomendas_paradas`, `sla_por_tipo` |
| **Streamgraph — top moradores por retirada** *novo* | streamgraph | `ranking_encomendas_morador` |
| **Custo por encomenda entregue** *novo* | stat tile | despesa operacional (transactions) ÷ volume (`encomendas_mensal`) |

### 7. OS

| Indicador | Forma | Fonte |
|---|---|---|
| Abertas/fechadas | stat tile | `ordens_servico_mensal` |
| **Tarefas no prazo %** | **barra segmentada de progresso** (visual alternativo ao número) | `tarefas_mensal` |

### 8. Senso

| Indicador | Forma | Fonte |
|---|---|---|
| Indicadores sociais (já existentes) | stat tile | dado do censo social |
| **Mapa por CEP (região Madureira, prefixo 213xx confirmado)** *novo* | mapa geográfico | `residents.address_cep` — precisa geocodificar (ViaCEP + cache), sem isso hoje |

### 9. Operadores *(novo módulo, 9ª aba)*

Filtro por operador (dropdown). Card estilo "benchmark" (ver §Componentes):

| Indicador | Forma |
|---|---|
| Participação no faturamento | headline number + delta período + barra vs. benchmark (média dos operadores) |
| Qtd de vendas por produto | ranking (lista, ícone+nome+valor) |
| Tempo médio no sistema | headline number |
| Tarefas diárias concluídas | headline number |
| Feedback | headline number/score |
| **Índice de calor de performance (0-100)** | barra de faixas coloridas (status reservado: vermelho→amarelo→verde) |
| **Ranking de operadores** | **tabela rica** — avatar, status (ativo/inativo), participação faturamento (valor), sparkline de tendência do índice, nível de performance (HIGH/MID/LOW, badge), última ação |

**Fórmula do índice de calor** (pesos definidos com o usuário):

| Métrica | Peso |
|---|---|
| Tarefas diárias concluídas | 30% |
| Participação no faturamento | 25% |
| Feedback | 20% |
| Qtd de vendas por produto | 15% |
| Tempo médio no sistema | 10% |

Cada métrica normalizada 0-100 (min-max entre operadores) antes de aplicar o peso.

---

## Componentes visuais (novos, catalogados nesta revisão)

Cada um segue o método do skill `dataviz` — forma pelo trabalho do dado, cor por último,
paleta violeta (`pres-100→pres-900`) pra magnitude/identidade do painel, status
(verde/âmbar/vermelho) reservado e nunca reutilizado pra identidade de série.

### Mini-gráfico de tendência (padrão do painel inteiro)
Referência visual fornecida: linha + área em degradê (transparente embaixo), grid
horizontal pontilhado recessivo, eixo Y com labels. **2 pontos marcados** (bolinha cheia +
anel branco): **maior valor histórico** + **último ponto** (não marca cada ponto — regra
de "rótulo seletivo" do dataviz). Vira o padrão de TODO mini-gráfico de tendência no
painel (inadimplência, receita, etc.), com a rampa violeta do painel em vez de cor solta.

### Card de operador (estilo benchmark)
Referência: headline number + delta período (verde/vermelho) + barra horizontal vs.
benchmark (média) + ranking em lista (ícone+nome+valor) + barra de faixas coloridas
(índice de calor, vermelho→amarelo→verde — uso legítimo de status reservado pra escala
ordinal, não é "arco-íris" arbitrário).

### Bar chart de faturamento mensal
Barras neutras (cinza) por padrão; **mês atual** ganha o acento violeta (`pres-300`);
**mês em hover/selecionado** ganha uma segunda cor (tom mais claro da rampa violeta,
`pres-100`, pra diferenciar do "atual" sem sair da paleta do painel — nunca uma cor solta
fora do sistema).

### Tabela rica (inadimplência + ranking de operadores)
Referência: avatar+nome, badge de status colorido (pendente=âmbar, pago=verde,
acordo=azul-info), valor (R$), mini-sparkline de tendência (vermelho=piorando,
verde=melhorando), indicador de faixa (barras+label: HIGH/MID/LOW — reaproveita a mesma
codificação do índice de calor de operadores), data da última ação. Mesmo componente,
semântica adaptada por tela (inadimplência: "probabilidade de pagar"; operadores:
"nível de performance").

### Calendário de calor (heatmap)
Referência original usa vermelho→amarelo (semântica de "incidente/gravidade") —
**adaptado pra rampa violeta sequencial** (magnitude neutra, não status). Seletor de
período: **7 dias / Mês / Trimestre / Semestre / Ano** (Últimas 24h adiado — precisa de
granularidade horária que o ETL não produz hoje).

| Período | Estrutura da grade |
|---|---|
| 7 dias | 7 células (1 por dia) |
| Mês | semana (linha) × dia da semana (coluna) — estilo calendário |
| Trimestre | mês (linha, 3) × dia do mês 1-31 (coluna) |
| Semestre | mês (linha, 6) × dia do mês 1-31 (coluna) |
| Ano | mês (linha, 12) × dia do mês 1-31 (coluna) |

**Escala de cor calibrada contra a média histórica do indicador** (não o min/máx só
daquele mês) — garante que meses sejam comparáveis entre si (um dia "bom" em julho lê a
mesma intensidade que um dia "bom" em agosto).

### Funil de conversão (só Moradores)
Moradores → Visitantes → Associados. Rampa violeta sequencial (claro→escuro por etapa,
maior→menor). **Não usar essa forma pra dado categórico não-sequencial** (ex.: receita
por tipo, que vira barra horizontal — ver tabela do Financeiro acima).

### Barra segmentada de percentual
Segmentos arredondados, preenchido (violeta) até o %, resto neutro/apagado. Usado em:
margem líquida (Financeiro), tarefas no prazo (OS), taxa de cobrança (Mensalidades).

### Card de KPI padrão (stat tile)
Label (topo-esquerda, muted) + delta % (topo-direita, verde/vermelho — status reservado)
+ número grande + divisor + link "ver mais →" no rodapé. Padrão de TODOS os stat tiles do
painel (Início, Resumo, etc.) — já estava especificado conceitualmente, agora com layout
concreto confirmado por referência visual.

### Streamgraph (só Pacotes — top moradores por retirada)
Sem mudança de forma desde a v1 do spec — confirmado landing na aba Pacotes.

### Bar chart diário fino (novos visitantes/dia)
Barra fina (thin marks), 1 por dia, rampa violeta sequencial. Alta densidade (pode
mostrar 2-3 meses de dado) — usa `overflow-x-auto` se não couber na largura do card.

---

## Achados de dado que exigem trabalho novo no ETL (não é só frontend)

| Indicador | O que falta |
|---|---|
| Receita por rua (Financeiro) | Nova agregação gold — join residents+transactions por rua não existe hoje |
| Churn de associados (Moradores) | Extração de saída (member → inativo/move_out) — hoje só temos entrada |
| Novos visitantes por dia (Moradores) | Extração diária de `residents.created_at` onde `type='guest'` |
| Aging de inadimplência (Mensalidades) | Bucket 0-30/30-60/60+ — dado bruto existe (`days_overdue` em `mensalidades`), falta agregação gold |
| Índice de calor de operadores (Operadores) | Módulo inteiro novo — participação faturamento já existe (`receita_por_operador`), tempo médio/feedback/qtd vendas por produto não existem em nenhuma tabela hoje |
| Mapa por CEP (Senso) | Geocodificação (ViaCEP + cache) — não é ETL, é serviço novo |
| Qualidade de cadastro (Moradores) | Não é gold, é query direta no operacional (dado de "agora", não histórico) |

Isso vira input pra uma Fase adicional no plano de implementação (extração + gold novos)
antes do frontend consumir esses indicadores específicos — os que já têm fonte pronta
podem seguir direto.

---

## Testes
(sem mudança desta revisão — ver spec original: gate de acesso, shape de resposta,
`stale=true`, smoke test de frontend, screenshot review contra anti-patterns.)

## Decisões em aberto

- Seletor de unidade: assumir "todas por padrão + filtro opcional" (herdado da v1).
- Botão "abrir Excel original" durante transição: nenhum, painel substitui de vez
  (herdado da v1).
- **Score de saúde da associação**: fórmula/pesos ainda não definidos — decidir na Fase
  de implementação do Início.
- **Comparativo Vaz Lobo vs Congonha**: layout exato (2 colunas espelhadas vs. tabela
  lado a lado) — decidir na Fase de implementação do Financeiro.
