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

## Fase A — SCA (Dependabot) — pode começar já, sem dependência de infra

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
2. `aprxm_sys` — dois ecossistemas (backend Python + frontends npm):
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

## Fase B — SAST (CodeQL) — pode começar já

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

### C.1 — `website_tia_pretinha` (pode fazer já, já está no Azure)

1. **Application Insights** → Create: `appi-website-itp`, `rg-itp-prod`,
   workspace-based, região `East US 2` (mesma do Static Web App).
2. Static Web Apps tem integração nativa com Application Insights (connection
   string via app setting `APPLICATIONINSIGHTS_CONNECTION_STRING` no recurso
   `swa-website-itp` → Configuração). Isso dá RUM automático (Core Web
   Vitals, exceções JS no browser, geografia/dispositivo do visitante) sem
   precisar instrumentar código React manualmente.
3. **Availability test** (synthetic monitoring) dentro do próprio recurso
   Application Insights → testa `https://institutotiapretinha.org` a cada
   5 min de múltiplas regiões, alerta se cair — pega indisponibilidade antes
   de um usuário reclamar.
4. Custo: tier gratuito do Application Insights cobre until 5GB/mês de
   ingestão — volume desse site fica bem abaixo disso.

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

1. **Agora**: Fase A (Dependabot) + Fase B (CodeQL) nos 3 repos — zero
   dependência de infra, zero custo, disponível imediatamente.
2. **Agora**: Fase C.1 (Application Insights do website) — já está no
   Azure, sem custo relevante.
3. **Junto da Fase 2 do plano de migração**: Fase C.2 (observabilidade
   aprxm_sys).
4. **Junto da Fase 3 do plano de migração**: Fase C.3 (observabilidade
   erp_itp).
5. **Depois das Fases 2/3 estáveis**: revisitar Fase D (Front Door) com
   orçamento real em mãos.
