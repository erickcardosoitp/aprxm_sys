# Painel da Presidência — Plano de Implementação

Spec: [2026-08-01-painel-presidencia-design.md](../specs/2026-08-01-painel-presidencia-design.md)

⚠️ **Fase Frontend pausa pra confirmação do usuário antes de começar** (pedido explícito).

---

## Fase 0 — Acesso e fundação backend

- [ ] `tenant.py`: `require_presidencia_access` — libera `role in ('admin','conselho')` +
      bypass `is_platform_admin`, 403 pro resto.
- [ ] `backend/app/routers/presidencia.py` — router novo, prefixo `/presidencia`, registrado
      em `main.py`.
- [ ] `backend/app/services/presidencia_service.py` — reaproveita padrão de engine sync
      pro Analytics já usado em `datalake_service.py` (`create_engine(settings.analytics_db_url)`).
- [ ] Helper comum `_generated_at_and_stale(session)` — lê `etl_runs` (último run),
      retorna `(generated_at, stale)` pra todo endpoint usar.
- [ ] Teste: 403 pra role fora de `admin`/`conselho`; 200 pra `admin`/`conselho`;
      bypass de `superadmin`/`admin_master`.

## Fase 1 — `/inicio` e `/resumo` (prioridade — o que a presidência mais olha)

- [ ] `GET /presidencia/inicio` — receita mês, taxa cobrança, inadimplência, moradores
      (total/associados/dependentes/visitantes), pacotes/OS, lista de alertas.
- [ ] `GET /presidencia/resumo` — 9 KPIs com WoW/MoM/YoY/ToT.
- [ ] Query de alertas: pacotes parados >3d, caixa aberto sem fechamento, caixa fechado
      no dia seguinte (mesmas regras do Excel `INICIO`).
- [ ] Teste de shape de resposta + teste de `stale=true`.

## Fase 2 — `/financeiro` e `/moradores`

- [ ] `GET /presidencia/financeiro` — receita diária (série), taxa de cobrança,
      inadimplência por pessoa.
- [ ] `GET /presidencia/moradores` — total, breakdown por tipo, crescimento mensal,
      ranking por rua, censo.

## Fase 3 — `/mensalidades`, `/pacotes`, `/os`, `/senso`

- [ ] `GET /presidencia/mensalidades` — pagas/vencidas, retenção.
- [ ] `GET /presidencia/pacotes` — recebidos, parados, tempo médio, SLA por tipo.
- [ ] `GET /presidencia/os` — abertas/fechadas, tarefas no prazo.
- [ ] `GET /presidencia/senso` — indicadores do censo social.

## Fase 4 — Frontend (⏸ aguardar sinal do usuário antes de iniciar)

- [ ] Scaffold do mini-app (Vite/React), deploy Vercel separado.
- [ ] Tema/paleta violeta "Marque" (tokens já validados no spec — `pres-100/300/600/900`
      claro + rampa própria escuro), reaproveitando `formatCep`-style utils onde couber.
- [ ] Login reaproveitando `/auth/login` existente (mesmo JWT do aprxm).
- [ ] Layout base: header (logo + "atualizado às" + stale banner) + abas
      (Início/Resumo/Financeiro/Moradores/Mensalidades/Pacotes/OS/Senso), padrão
      `EscModulePage` (abas horizontais).
- [ ] Stat tile component (hover eleva + revela período de comparação, respeitando
      `prefers-reduced-motion`).
- [ ] Gráfico de série temporal (linha 2px, crosshair+tooltip, sem dual-axis).
- [ ] Gráfico de ranking (barra horizontal, paleta categórica de `unidadeColor()`).
- [ ] Alerta list (ícone + status color, nunca só cor).
- [ ] Responsivo (grid 3→1 coluna mobile), dark mode com rampa própria.
- [ ] Smoke test de cada aba + screenshot review contra os anti-patterns do spec.

## Riscos conhecidos (do spec)

- Filtro de unidade em `/financeiro`/`/pacotes`: decidir "todas por padrão + filtro
  opcional" antes da Fase 2/3, ou implementar direto — confirmar no início dessas fases.
- ETL (`etl_runs`) precisa estar realmente saudável (P0 já corrigido) antes do painel ir
  pro ar, senão todo endpoint nasce com `stale: true`.
