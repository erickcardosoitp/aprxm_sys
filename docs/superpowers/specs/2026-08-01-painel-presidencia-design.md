# Painel da Presidência — Design

**Data:** 2026-08-01 · **Status:** aprovado, pendente de plano de implementação

## Contexto

Hoje a presidência acompanha a saúde da associação por um Excel (`Consolidado APRXM.xlsm`,
OneDrive), 8 abas (INICIO, PRESIDENCIA, FINANCEIRO, MORADORES, MENSALIDADES, PACOTES, OS,
SENSO) alimentadas manualmente/por export do datalake. Objetivo: substituir por um painel
web read-only, alimentado direto pelas tabelas `dim_/fact_` do Neon Analytics
(`aprxm-analytics`), acessível só por quem já teria essa visão hoje (`admin`, `conselho`).

## Escopo

Todas as 8 abas viram endpoints/telas equivalentes. Ordem de construção sugerida pro plano
de implementação (não muda o escopo final, só a sequência):

1. `/inicio` + `/resumo` — o que a presidência mais olha primeiro.
2. `/financeiro` + `/moradores`
3. `/mensalidades` + `/pacotes` + `/os` + `/senso`

## Arquitetura

```
┌────────────────────────────┐        ┌──────────────────────────┐
│ presidencia.aprxm (novo)   │  JWT   │ backend atual (FastAPI)  │
│ mini-app React, deploy     │───────►│ + router presidencia.py  │
│ Vercel separado, read-only │  login │ + presidencia_service.py │
└────────────────────────────┘  igual └───────────┬──────────────┘
                                                   │ SELECT (read-only)
                                                   ▼
                                     Neon Analytics (aprxm-analytics)
                                     dim_date, dim_resident, dim_association,
                                     fact_transactions, fact_packages,
                                     fact_mensalidades, fact_inadimplencia,
                                     fact_service_orders, fact_social
```

- **Auth:** reaproveita login/JWT do aprxm (mesma credencial). Nova dependency
  `require_presidencia_access` em `tenant.py`: libera `role in ('admin', 'conselho')` +
  bypass padrão pra `superadmin`/`admin_master` (mesmo padrão de `is_platform_admin`
  já usado em outras dependencies). 403 pra qualquer outro role.
- **Backend:** novo router `backend/app/routers/presidencia.py` + service
  `presidencia_service.py`, reaproveitando a criação de engine sync pro Analytics já
  existente em `datalake_service.py` (mesmo padrão de conexão, sem duplicar).
- **Frontend:** projeto novo (Vite/React), mesmo padrão de deploy do portal do morador
  (repo/projeto Vercel separado). Tela 100% read-only, sem formulário de escrita.

## Contrato de API

Todos os endpoints em `GET /api/v1/presidencia/*`, protegidos por
`require_presidencia_access`. Formato de resposta comum:

```json
{
  "generated_at": "2026-08-01T09:00:00Z",   // = etl_runs.completed_at do ultimo run bem-sucedido
  "stale": false,                            // true se ultimo run != success (ver secao Frescor)
  "data": { ... }                            // shape especifico por endpoint
}
```

| Endpoint | Fonte principal | Conteúdo |
|---|---|---|
| `/inicio` | `fact_transactions`, `fact_mensalidades`, `dim_resident`, `fact_packages`, `fact_service_orders` | 1 tela: receita mês, taxa de cobrança, inadimplência, contagem moradores, pacotes/OS, lista de alertas |
| `/resumo` | idem + histórico semanal/mensal | 9 KPIs com deltas WoW/MoM/YoY/ToT (receita líquida, taxa cobrança, inadimplência, crescimento, retenção, encomendas, tempo entrega, tarefas no prazo, score operadores) |
| `/financeiro` | `fact_transactions` | receita diária (série), taxa de cobrança, inadimplência por pessoa (lista) |
| `/moradores` | `dim_resident` | total, associados/dependentes/visitantes, crescimento mensal, ranking, censo por rua |
| `/mensalidades` | `fact_mensalidades` | pagas/vencidas, retenção |
| `/pacotes` | `fact_packages` | recebidos, parados >3d, tempo médio de entrega, SLA por tipo |
| `/os` | `fact_service_orders` | abertas/fechadas, tarefas no prazo |
| `/senso` | `fact_social` | indicadores do censo social |

## Frescor do dado

ETL roda 2x/dia (09h/17h BRT). O painel não faz polling nem cache próprio — cada request
lê `etl_runs` pro último run e retorna `generated_at`/`stale` junto do payload.

- `stale: false` → último run `success`.
- `stale: true` → último run `failed`/`warning` (P0 do ETL já corrigido nesta auditoria:
  falha de carga agora é reportada de verdade, não mais escondida). Frontend mostra banner
  "dados desatualizados desde HH:MM" em vez de esconder o problema.

## Design visual (frontend)

Segue o método do skill `dataviz` — forma primeiro, cor por último, paleta validada antes
de implementar.

**Identidade visual do painel:** por pedido explícito, este painel (só ele — não o app
operacional) usa a paleta violeta de referência "Marque" em vez do verde institucional,
pra diferenciar visualmente "visão executiva" de "operação do dia a dia". Extraída de
referência visual (Uiverse/Marque) e **validada com `scripts/validate_palette.js` do
skill dataviz** — não foi só copiada no olho.

| Token | Hex (claro) | Papel |
|---|---|---|
| `pres-surface` | `#FCFCFB` | fundo da página |
| `pres-veil` | `#E3DBF7` | fundo de card / seção alternada (não entra na rampa de dado) |
| `pres-100` (Halo) | `#A594F5` | rampa sequencial — degrau mais claro |
| `pres-300` (Indigo) | `#4F3FE0` | rampa sequencial — acento primário, títulos de seção, barra ativa |
| `pres-600` (Royal) | `#241259` | rampa sequencial — degrau escuro |
| `pres-900` (Ink) | `#0F0A1E` | rampa sequencial — texto de alto contraste / degrau mais escuro |

Modo escuro tem **rampa própria** (não é o claro invertido — regra do dataviz skill):
`#7C6DEC → #9C8FF7 → #BEB4F8 → #E2DBFC` sobre superfície `#1a1a19`.

Resultado do validador (`--ordinal`, 1 hue só, 4 degraus — `pres-veil` fica de fora da
rampa de dado, é só fundo):
```
claro:  ALL CHECKS PASS  (contraste do degrau claro 2.51:1, hue spread 15°)
escuro: ALL CHECKS PASS  (contraste do degrau claro 4.36:1, hue spread 10°)
```

**Uso da rampa violeta:** só pra magnitude (barra de receita diária, barra de SLA, degrau
de intensidade) e pra chrome do painel (header, título de seção, acento de navegação).

**Status (reservado, nunca vira "5º degrau" da rampa violeta):** bom = verde-700, atenção =
âmbar-600, crítico = vermelho-600 — mesmo padrão já usado em `OverviewPage`/`AdminSections`
hoje. Alerta de "pacotes parados"/"caixa aberto" continua vermelho/âmbar, nunca violeta —
misturar identidade de marca com semântica de status é o erro mais comum aqui.

**Categórico (ranking por rua/operador):** continua a paleta de 8 cores já validada em uso
(`unidadeColor()`, `EscDataTable.tsx`) — a rampa violeta é 1 hue só, não serve pra
identidade categórica (precisa de hues distintos, não tons do mesmo).

**Forma por métrica** (escolhida pelo trabalho do dado, não por padrão visual):
- **Headline number / stat tile** (não é gráfico): os 9 KPIs de `/resumo` e o resumo de
  `/inicio` — número grande + delta pequeno (WoW/MoM) ao lado, igual ao Excel hoje. Sem
  eixo, sem grid.
- **Série temporal** (`/financeiro` receita diária, `/pacotes` volume semanal): linha fina
  2px, sem dual-axis — se precisar comparar receita e taxa de cobrança, são 2 gráficos
  lado a lado ou indexados a uma base comum, nunca dois eixos-Y na mesma linha.
  Crosshair + tooltip por padrão (não é opcional).
- **Ranking** (`/moradores` top rua, `/os` score operadores): barra horizontal, cor
  categórica fixa por entidade (rua/operador), rótulo direto no valor — nunca legenda
  separada pra isso.
- **Alertas** (`/inicio`): lista com ícone + cor de status (nunca só a cor) + texto —
  nunca um card colorido sem ícone/rótulo.
- **SLA/tempo de entrega:** barra sequencial (rampa violeta `pres-100→pres-900`), 1 hue só,
  nunca semáforo arco-íris — é magnitude, não status, então usa a rampa do painel, não
  verde/âmbar/vermelho.

**Layout:**
- Header fixo: logo + "atualizado às HH:MM" (ou banner de stale) + seletor de unidade
  (Todas / por associação) — filtro em 1 linha acima dos gráficos, não espalhado.
- Grid responsivo: 3 colunas em desktop (`md:grid-cols-3`) para os stat tiles, colapsa pra
  1 coluna em mobile — segue a mesma convenção mobile-first do resto do app.
- Cada "aba" do Excel vira uma seção com âncora/tab própria (reaproveitar o padrão de
  `EscModulePage` — abas horizontais, conteúdo abaixo), não 8 páginas soltas sem navegação
  comum.
- Tabela de detalhe (ex.: lista de inadimplentes) sempre com verificação de accessibility:
  legenda quando ≥2 séries, tabela alternativa pros gráficos (não só visual).
- Dark mode: variante própria validada contra a superfície escura, não inversão automática
  de cor.

**Interação e animação:**
- **Hover é padrão, não opcional** (regra do dataviz skill) — crosshair + tooltip em toda
  série temporal; tooltip por marca em barra/ranking/célula. Alvo de hover maior que a
  marca visual (fácil de acertar no touch/mobile também).
- Stat tile: hover eleva levemente (`translateY(-2px)` + sombra sutil, ~150ms ease-out) e
  revela o período de comparação (WoW/MoM/YoY/ToT) que só aparece no clique/hover, pra não
  poluir a leitura rápida por padrão.
- Transição ao trocar filtro (unidade/período): fade+slide curto (~200ms) nos números,
  nunca "pisca" o valor antigo pro novo sem transição — dá sensação de atualização, não de
  tela quebrando.
- Entrada da página: stagger sutil nos stat tiles (~40ms entre um e outro), só na primeira
  carga — não repete a cada refetch, senão cansa quem abre o painel todo dia.
- Todas as animações respeitam `prefers-reduced-motion` — sem exceção, é acessibilidade,
  não polimento opcional.

**Anti-patterns a evitar** (do skill, aplicados aqui especificamente): não usar rainbow em
nenhum gráfico de magnitude; não colorir a 9ª linha do ranking com hue novo (cai em
"Outros"); não repetir verde/âmbar/vermelho de status pra identidade de série; não montar
dual-axis pra comparar receita vs. taxa de cobrança.

## Testes

- Gate de acesso: 403 pra roles fora de `admin`/`conselho` (exceto platform admin);
  200 pra `admin`/`conselho`.
- Cada endpoint: teste de shape de resposta (schema) + teste de `stale=true` quando
  `etl_runs` mais recente não é `success`.
- Frontend: smoke test de cada aba carregando sem erro com payload mockado; teste visual
  (screenshot) do stat tile e do gráfico de série temporal contra os anti-patterns acima.

## Decisões em aberto (não bloqueiam o plano, mas ficam registradas)

- Seletor de unidade: `/financeiro`, `/pacotes` etc. respeitam filtro por associação
  específica ou só "todas as unidades" na v1? (Excel mostra "Todas as associações" no
  cabeçalho — assumir todas-por-padrão com filtro opcional, a confirmar na fase de plano.)
- Onde fica o botão "abrir Excel original" durante a transição (período em que os dois
  convivem)? Sugestão: nenhum, o painel substitui de vez — mas fica registrado caso a
  presidência ainda queira o `.xlsm` como fallback por um tempo.
