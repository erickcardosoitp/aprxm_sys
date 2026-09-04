# Plano — Segurança, SCA/SAST e Observabilidade (3 sistemas)

Complementa [2026-09-01-migracao-azure-plan.md](2026-09-01-migracao-azure-plan.md).
Cobre `website_tia_pretinha` (já migrado, Fase 1 concluída), `aprxm_sys` e
`erp_itp` (ainda na Vercel, Fases 2/3 do plano de migração não iniciadas).

Repos confirmados **públicos** (`erickcardosoitp/website_tia_pretinha`,
`erickcardosoitp/aprxm_sys`, `erickcardosoitp/erp_itp`) — CodeQL é gratuito
nos 3 (recurso de GitHub Advanced Security liberado sem custo em repo
público), então SAST não tem trade-off de custo aqui.

**Decisão registrada (2026-09-04)**: Azure Front Door + WAF + rate limiting +
bot mitigation — **adiada**. Front Door Premium (~US$330/mês, necessário pro
Bot Manager com ML) estoura sozinho o orçamento total do projeto
(US$166/mês, definido na Fase 0 do plano de migração). Front Door Standard
(~US$35/mês) cobre WAF gerenciado (OWASP CRS) + rate limiting customizado,
mas não bot mitigation avançado. Revisitar depois que Fases 2/3 da migração
estiverem com custo real medido, e desenhar **um único** Front Door cobrindo
os 3 domínios (`institutotiapretinha.org`, `itp.`, `api.itp.`, e o que for
criado pro aprxm_sys) em vez de um por sistema — mais barato e com política
de WAF consistente.

---

## Fase A — SCA (Dependabot) — ✅ `website_tia_pretinha` concluída em 2026-09-04 · `aprxm_sys`/`erp_itp` adiadas (fora de escopo desta rodada, focada só no site)

Grátis em repo público ou privado. Detecta CVE em dependência antes de virar
incidente (foi assim que achamos a vulnerabilidade do `react-router-dom` no
website, na mão, via `npm audit` — Dependabot automatiza isso).

1. `website_tia_pretinha` — `.github/dependabot.yml`:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/"
       schedule:
         interval: "weekly"
   ```
2. `aprxm_sys` — **achado (2026-09-04, não corrigido ainda)**: já existe
   `.github/workflows/snyk.yml`, mas está `disabled_manually` desde
   2026-05-30 (os 4 últimos runs antes disso falharam, provável token
   inválido/ausente) — SCA não está rodando de fato neste repo há 3+ meses.
   Ao executar esta fase pro `aprxm_sys`, substituir por Dependabot (grátis,
   sem conta externa) e remover o `snyk.yml` morto, mesma decisão já tomada
   e depois revertida (por escopo, não por estar errada) nesta sessão.
   Dois ecossistemas a cobrir (backend Python + frontends npm):
   ```yaml
   version: 2
   updates:
     - package-ecosystem: "pip"
       directory: "/backend"
       schedule:
         interval: "weekly"
     - package-ecosystem: "npm"
       directory: "/frontend"
       schedule:
         interval: "weekly"
     - package-ecosystem: "npm"
       directory: "/presidencia"
       schedule:
         interval: "weekly"
     - package-ecosystem: "npm"
       directory: "/painel"
       schedule:
         interval: "weekly"
   ```
3. `erp_itp` — monorepo NestJS+Next.js, confirmar estrutura real de
   diretórios antes de escrever o `dependabot.yml` (não assumir
   `apps/backend`/`apps/frontend` sem checar `package.json` workspaces).
4. Ativar também **Dependabot security updates** (auto-PR de fix, não só
   alerta) nas 3 configs de repo (Settings → Code security).

Critério de saída: os 3 repos com PR automático de dependência vulnerável
funcionando (testar forçando um `npm outdated` conhecido ou aguardar o
primeiro scan semanal).

---

## Fase B — SAST (CodeQL) — ✅ `website_tia_pretinha` concluída em 2026-09-04 · `aprxm_sys`/`erp_itp` adiadas

1. Nos 3 repos: **Settings → Code security → Code scanning → CodeQL
   analysis → Set up (Default)**. GitHub detecta a linguagem automaticamente
   (JS/TS nos 3, + Python no `aprxm_sys`).
2. Default setup basta pro início (roda em push/PR pra `main` + agendado
   semanal) — só migrar pra "Advanced" (workflow customizado) se precisar de
   query pack extra ou build step especial (não é o caso aqui, os 3 são
   build padrão).
3. Branch protection na `main` dos 3 repos: exigir status check do CodeQL
   (e do CI/CD existente) passando antes de merge — impede que um push
   direto (como quase aconteceu sem querer com a Vercel antes) pule a
   checagem.

Critério de saída: CodeQL rodando nos 3 repos, pelo menos 1 scan completo
sem erro de configuração (findings em si não bloqueiam o critério de saída
dessa fase — triagem de findings é trabalho contínuo, não um "concluído").

---

## Fase C — Observabilidade (RUM + synthetic monitoring)

Prioridade do usuário — tratar como item importante, não "nice to have".

### C.1 — `website_tia_pretinha` — ✅ CONCLUÍDA em 2026-09-04

1. ✅ **Log Analytics Workspace** `law-itp-prod` (`rg-itp-prod`, East US 2),
   com teto de ingestão (`dailyQuotaGb: 0.1`) pra garantir zero risco de
   custo mesmo com pico de tráfego inesperado.
2. ✅ **Application Insights** `appi-website-itp`, workspace-based, em cima
   do `law-itp-prod`.
3. ❌→✅ **Correção de rota**: a tentativa inicial foi configurar
   `APPLICATIONINSIGHTS_CONNECTION_STRING` como app setting do Static Web
   App, assumindo que o Azure injetaria o RUM automaticamente — **isso não
   funciona pra conteúdo estático puro** (essa app setting só é exposta pra
   Functions/API do recurso, e este site não tem API). Confirmado vazio via
   `curl` na home (nenhum script de `monitor.azure` presente) e query sem
   resultado no Log Analytics.
4. ✅ Fix real: instalado `@microsoft/applicationinsights-web` via npm,
   inicializado em `src/appInsights.js` (importado em `main.jsx`), com
   `enableAutoRouteTracking: true` (necessário por causa do
   `react-router-dom` — sem isso só a página inicial seria trackeada) e
   `autoTrackPageVisitTime: true`. Connection string embutida no client é
   seguro (não é segredo, mesmo padrão de um ID de Google Analytics).
5. ✅ CSP (`staticwebapp.config.json`) ajustado: `connect-src` libera
   `https://*.in.applicationinsights.azure.com` e
   `https://*.livediagnostics.monitor.azure.com` (endpoints de ingestão e
   live metrics). `script-src` não precisou de exceção — o SDK vem bundlado
   via npm/Vite, não carrega de CDN externo.
6. ✅ **Availability test** `website-availability` criado (Portal → recurso
   Application Insights → Disponibilidade → Adicionar teste padrão),
   ping em `https://institutotiapretinha.org` a cada 5 min, confirmado via
   `az monitor app-insights web-test list`.
7. Custo: tier gratuito do Application Insights cobre até 5GB/mês de
   ingestão — volume desse site fica bem abaixo disso; teto de 0.1GB/dia no
   workspace é uma segunda trava de segurança contra custo.

### C.2 — `aprxm_sys` (junto da Fase 2 da migração, não antes)

Só faz sentido depois que `app-aprxm-backend`/`swa-aprxm-frontend` existirem
(Fase 2.2/2.3 do plano de migração) — não dá pra monitorar um recurso que
ainda não existe.

1. Criar `appi-aprxm-prod` junto com os recursos da Fase 2.2.
2. **Backend (FastAPI)**: instrumentar via `azure-monitor-opentelemetry`
   (pacote oficial Microsoft, substitui o antigo `opencensus-ext-azure`) —
   dá tracing de request completo, incluindo chamadas ao Postgres
   (dependency tracking), não só hits de página. Muito mais valioso aqui que
   no site estático, porque tem lógica de negócio real (login, financeiro,
   mensalidades) pra rastrear erro/latência.
3. **Frontends (React)**: connection string via app setting nos 3 Static
   Web Apps (main, `presidencia`, `painel`), mesmo padrão do C.1.
4. Availability tests: `/docs` do backend (health check simples) +
   fluxo de login (sintético, request HTTP direto no endpoint de auth).
5. Ordem de execução: inserir isso como sub-passo dentro da Fase 2.2 (App
   Service) e 2.3 (frontends) do plano de migração, não como fase separada
   — evita configurar observabilidade duas vezes (uma agora, outra depois
   do cutover).

### C.3 — `erp_itp` (junto da Fase 3 da migração, mesmo raciocínio)

1. `appi-erpitp-prod`, criado junto da Fase 3.2 (App Service backend).
2. **Backend (NestJS)**: `@azure/monitor-opentelemetry` (SDK Node oficial) —
   tracing de request + dependência (Postgres, chamadas ao Supabase Storage).
3. **Frontend (Next.js SSR)**: mesmo SDK, ou Application Insights via
   middleware — Next.js SSR precisa de instrumentação server-side, não só
   client-side (diferente do React puro do `aprxm_sys`, que é SPA).
4. Availability tests: fluxo de matrícula (crítico pro negócio, já citado
   no checklist de cutover da Fase 3).

Critério de saída (C.2/C.3): validado no ambiente `staging` de cada App
Service, antes do swap — mesmo padrão já usado pro resto da Fase 2/3.

---

## Fase D — Front Door + WAF + rate limiting + bot mitigation (adiada)

Não iniciar agora. Retomar depois que:
1. Fases 2/3 da migração estiverem com custo mensal real medido (não
   estimado) — só assim dá pra saber quanto sobra do orçamento de
   US$166/mês pro Front Door.
2. Desenhar **um Front Door único** cobrindo os 3 domínios/subdomínios
   (apex do site, `itp.`/`api.itp.` do erp_itp, subdomínio do aprxm_sys que
   for definido na Fase 2.3) — mais barato que 3 instâncias separadas e dá
   política de WAF/rate limit consistente entre os 3 sistemas.
3. Rate limiting de borda (Front Door) complementa, não substitui, o rate
   limiting de aplicação já previsto no plano de migração original
   (`slowapi` no FastAPI, `@nestjs/throttler` no NestJS) — defesa em
   camadas, ambos continuam necessários.
4. Bot mitigation avançado (Premium) só entra em pauta se aparecer tráfego
   suspeito real (mesmo critério já registrado na Fase 4 do plano de
   migração) — não implementar preventivamente sem sinal concreto de
   necessidade.

---

## Ordem de execução recomendada

1. ✅ **Feito em 2026-09-04**: Fase A (Dependabot) + Fase B (CodeQL) +
   Fase C.1 (Application Insights, RUM real + availability test) — só pro
   `website_tia_pretinha`. Rodada explicitamente escopada só pro site
   institucional a pedido do usuário; uma tentativa de estender Fase A/B pro
   `aprxm_sys` foi revertida (commits locais desfeitos, nada chegou a ser
   enviado ao GitHub) por estar fora do escopo pedido naquele momento.
2. **Próxima vez, junto da Fase 2 do plano de migração**: Fase A/B/C.2
   (Dependabot + CodeQL + observabilidade) do `aprxm_sys`.
3. **Junto da Fase 3 do plano de migração**: Fase A/B/C.3 do `erp_itp`.
4. **Depois das Fases 2/3 estáveis**: revisitar Fase D (Front Door) com
   orçamento real em mãos.
