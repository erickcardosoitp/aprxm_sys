# Painel da Presidência — Plano de Implementação

Spec: [2026-08-01-painel-presidencia-design.md](../specs/2026-08-01-painel-presidencia-design.md)
Indicadores (glossário): [2026-08-01-glossario-indicadores-presidencia.md](../reports/2026-08-01-glossario-indicadores-presidencia.md)

⚠️ **Fase Frontend pausa pra confirmação do usuário antes de começar** (pedido explícito).

---

## Fase 0 — Acesso e fundação backend ✅ concluída

- [x] `tenant.py`: `require_presidencia_access` — libera `role in ('admin','conselho')` +
      bypass `is_platform_admin`, 403 pro resto.
- [x] `backend/app/routers/presidencia.py` — router registrado em `main.py`.
- [x] `backend/app/services/presidencia_service.py` — conexão própria pro data warehouse
      (`DATAWAREHOUSE_APRXM_DATABASE_URL`, projeto `aprxm-analytics`).
- [x] `PresidenciaService.freshness()` — lê `etl_runs`, retorna `(generated_at, stale)`.
- [x] Testes (14, gate de role + freshness).

## Fase 1 — `/inicio` e `/resumo` — parcial

- [x] `GET /presidencia/inicio` — receita mês, taxa cobrança, inadimplência, moradores,
      pacotes/OS, alertas.
- [ ] **Atualizar `/inicio`** com os indicadores novos da revisão 2: score de saúde da
      associação (fórmula a definir), runway financeiro (`runway_financeiro`, já existe),
      faturamento mensal (bar chart).
- [x] `GET /presidencia/resumo` — 4/9 KPIs (receita líquida, encomendas, crescimento,
      tempo de entrega) com WoW.
- [ ] Completar os 5 KPIs restantes do `/resumo` (taxa cobrança, inadimplência, retenção,
      tarefas no prazo, score operadores) — mesmo padrão `_wow_semanal()` já estabelecido.

## Fase 2 — ETL: dados novos pros indicadores da revisão 2 ✅ maior parte concluída

- [x] Bronze: extração incremental de `api_request_logs` (id/user_id/created_at) — proxy
      de sessão, já que não existe log de login/logout.
- [x] Gold `tempo_medio_sessao_operador` — MIN/MAX(created_at) por dia por operador.
      **Vazio hoje** (extração incremental, sem backfill — populará nos próximos runs).
- [x] Gold `receita_por_rua` — join residents+transactions por rua normalizada.
- [x] Gold `churn_associados` — redefinido (não usa `move_out_date`, quase nunca
      preenchido): associado ativo sem nenhum pagamento de mensalidade nos últimos
      6 meses. Snapshot (lista), não série mensal.
- [x] Gold `novos_visitantes_diario` — residents type=guest por dia de cadastro.
- [x] Gold `aging_inadimplencia` — mensalidades pending em 3 faixas (0-30/30-60/60+).
- [ ] **Bloqueado — precisa de decisão de produto, não é ETL:** coleta de "feedback"
      pro índice de operadores (peso 20% da fórmula) — não existe nenhuma coleta hoje.
      Índice roda com 4/5 métricas até essa feature existir (renormalizar pesos:
      tarefas 37,5%/faturamento 31,25%/vendas 18,75%/tempo 12,5% ≈ pesos originais
      escalados pra somar 100% sem o feedback).
- [ ] Opcional: backfill único de `tempo_medio_sessao_operador` com os ~26 dias de
      `api_request_logs` já existentes (hoje só acumula pra frente).
- [ ] Mapa por CEP (Senso) — geocodificação via ViaCEP + cache. Não é ETL, é serviço
      novo (rota + tabela de cache `cep_geocodificado` ou similar).
- [ ] Qualidade de cadastro (Moradores) — query direta no operacional (não é gold,
      é "agora", não histórico) — endpoint simples em `presidencia_service.py`.

## Fase 3 — `/financeiro` e `/moradores`

- [ ] `GET /presidencia/financeiro` — Gráfico de Faturamento (big number + hoje/semana/
      média + banda de status + linha/MM7/projeção), receita por rua, faturamento por
      produto (multi-série), receita por tipo (barra), margem %, comparativo Vaz Lobo
      vs Congonha, calendário de calor, tabela dia×produto.
- [ ] `GET /presidencia/moradores` — total/crescimento/ranking/censo, churn, qualidade
      de cadastro, funil Moradores→Visitantes→Associados, novos visitantes/dia.

## Fase 4 — `/mensalidades`, `/pacotes`, `/os`, `/senso`, `/operadores`

- [ ] `GET /presidencia/mensalidades` — pagas/vencidas/retenção, aging de inadimplência,
      ticket médio, tabela rica de inadimplência (badge+sparkline+probabilidade).
- [ ] `GET /presidencia/pacotes` — recebidos/parados/SLA, streamgraph top moradores,
      custo por encomenda.
- [ ] `GET /presidencia/os` — abertas/fechadas, tarefas no prazo (barra %).
- [ ] `GET /presidencia/senso` — indicadores sociais, mapa por CEP.
- [ ] `GET /presidencia/operadores` — módulo novo, filtro por operador, card benchmark,
      índice de calor (4/5 métricas até feedback existir), ranking (tabela rica).

## Fase 5 — Frontend (⏸ aguardar sinal do usuário antes de iniciar)

- [ ] Scaffold do mini-app (Vite/React), deploy Vercel separado.
- [ ] Tema/paleta violeta "Marque" + ícones `@phosphor-icons/react` (peso Regular/Fill).
- [ ] Login reaproveitando `/auth/login` existente (mesmo JWT do aprxm).
- [ ] Layout base: header + 9 abas (Início/Resumo/Financeiro/Moradores/Mensalidades/
      Pacotes/OS/Senso/Operadores), padrão `EscModulePage`.
- [ ] Componentes: stat tile padrão, mini-gráfico de tendência (padrão do painel), card
      de operador (benchmark), Gráfico de Faturamento, faturamento por produto (multi-
      série togável), bar chart mensal (destaque mês atual+hover), tabela rica (badge+
      sparkline+probabilidade), calendário de calor, funil de conversão, barra segmentada
      de %, streamgraph, bar chart diário fino.
- [ ] Responsivo (grid 3→1 coluna mobile), dark mode com rampa própria.
- [ ] Smoke test de cada aba + screenshot review contra os anti-patterns do spec.

## Riscos conhecidos

- Filtro de unidade: decidir "todas por padrão + filtro opcional" antes da Fase 3/4.
- Índice de operadores nasce com 4/5 métricas — comunicar isso na UI (não esconder que
  falta "feedback"), não fingir que o índice está completo.
- `churn_associados_mensal`/`tempo_medio_sessao_operador` vazios hoje — endpoints devem
  tratar tabela vazia com graça (retornar `null`/lista vazia, não erro), não travar o
  `/moradores` ou `/operadores` por causa disso.
