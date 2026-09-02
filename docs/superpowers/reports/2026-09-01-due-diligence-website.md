# Due diligence — migração website_tia_pretinha (Vercel → Azure Static Web Apps)

**Data:** 2026-09-01 · Escopo: Fase 1 do plano de migração (piloto, ver
`docs/superpowers/plans/2026-09-01-migracao-azure-plan.md`). Levantamento
read-only — nenhuma alteração feita no repo ou na Vercel, exceto o relink do
`.vercel/` local (estava apontando pro projeto errado, corrigido abaixo).

---

## 🔴 Achados críticos

### 1. Domínio é registrado e hospedado na Vercel DNS, não em provedor externo

`vercel domains inspect institutotiapretinha.org` confirma: **Registrar =
Vercel**, nameservers atuais = `ns1/ns2.vercel-dns.com` (Vercel Edge Network).
Não existe "provedor de DNS externo" pra descobrir — é a própria Vercel.

Implicação prática: **não trocar os nameservers** no cutover. Isso afetaria
`api.itp.institutotiapretinha.org` e `itp.institutotiapretinha.org`
(projetos `itp-erp-backend`/`itp-erp-frontend`, Fase 3, ainda na Vercel) e
derrubaria os dois sistemas de uma vez — o oposto de "zero falhas". O correto
é: manter nameservers na Vercel e criar/editar registros DNS **dentro do
painel DNS da Vercel** (Domains → institutotiapretinha.org → DNS Records)
apontando só o domínio apex `institutotiapretinha.org` pro Azure Static Web
App, via registro `ALIAS`/`ANAME` (Vercel DNS suporta esse tipo pra apex,
diferente de CNAME puro). Confirmar isso na tela antes do cutover — se não
suportar, alternativa é servir via `www.institutotiapretinha.org` (CNAME) e
redirecionar o apex.

**Ação antes do cutover:** decidir e testar esse registro em ambiente de
staging (subdomínio de teste) antes de mexer no domínio de produção.

### 2. `.vercel/project.json` local estava linkado ao projeto errado

Antes deste levantamento, `c:\tia_pretinha\.vercel\project.json` apontava
para `projectId prj_VUfq823...`, `orgId team_IskghXnkGddQuEZAu22XID78`,
`projectName "website-institucional"` — projeto diferente do real
(`website-institucional-itp`, no time `itp-aprxm`). Um `vercel env pull`
anterior nesse estado trouxe um `.env.vercel.website-tia-pretinha` com lixo
de outro projeto/monorepo: `DATABASE_URL` do Neon do **erp_itp**, chave
`NEXT_PUBLIC_ASSISTLOOP_AGENT_ID`, variáveis `TURBO_*`/`NX_DAEMON` (não
fazem sentido pra um site Vite estático).

**Corrigido nesta sessão:** rodei `vercel link --yes --project
website-institucional-itp --scope itp-aprxm`, que já regravou
`.vercel/project.json` corretamente (`.vercel` está no `.gitignore`, não
afeta o repo). Um `vercel env pull` limpo no projeto certo trouxe **apenas**
`VERCEL_OIDC_TOKEN` (variável interna, sem uso no código) — **nenhuma env
var real de build** existe para este projeto.

**Ação:** apagar o `.env.vercel.website-tia-pretinha` antigo (contém
credencial de banco de outro sistema, ainda que gitignorado — não deveria
estar em disco). Não é bloqueante pra migração, é higiene.

---

## 🟡 Atenção

### 3. `staticwebapp.config.json` não existe — precisa ser criado

O `vercel.json` atual tem 1 redirect + 1 rewrite SPA:

```json
{
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "redirects": [
    { "source": "/matricula", "destination": "https://itp.institutotiapretinha.org/inscricao", "permanent": false }
  ],
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Azure Static Web Apps **não replica isso automaticamente**. Sem o arquivo
equivalente, `/matricula` vira 404 e qualquer rota do `react-router-dom`
(confirmado em uso — `package.json`) que não seja `/` quebra em refresh
direto. Conteúdo sugerido pra `staticwebapp.config.json` (não criei o
arquivo, só a sugestão pro plano):

```json
{
  "routes": [
    { "route": "/matricula", "redirect": "https://itp.institutotiapretinha.org/inscricao", "statusCode": 302 }
  ],
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "*.{png,jpg,jpeg,svg,css,js,ico}"]
  }
}
```

Validar no passo 2 do plano (Fase 1) antes de considerar o deploy de teste
ok — testar `/matricula` e uma rota SPA com F5 direto na URL
`*.azurestaticapps.net`.

### 4. `@vercel/analytics` e `@vercel/speed-insights` ficam mudos no Azure

`src/App.jsx` importa e renderiza `<Analytics />` e `<SpeedInsights />`
(linhas 3-4, 1314-1315). Esses componentes enviam beacons pra
`/_vercel/insights/...` e `/_vercel/speed-insights/...`, endpoints que só
existem em infra Vercel. No Azure, as chamadas falham silenciosamente (não
quebram o site, não tem try/catch visível pra confirmar, mas é o
comportamento padrão dessas libs) — o instituto simplesmente **para de
receber dados de analytics/performance** sem aviso nenhum na UI.

**Ação:** decidir antes do cutover se remove os dois componentes (código
morto no Azure) ou substitui por alternativa (Application Insights via SDK
JS, ou nada). Não é bloqueante pro piloto, mas se não decidir agora, alguém
vai "descobrir" meses depois que o analytics parou.

### 5. Dependência de runtime hardcoded pro backend do erp_itp

`API_BASE = 'https://api.itp.institutotiapretinha.org/api'` hardcoded em
`src/App.jsx:93`, usado em 3 fetches (prestação de contas pública, abertura
e consulta de chamados públicos). Não é `import.meta.env` — é literal no
código, não depende de nenhuma env var de build. Continua funcionando igual
no Azure (chamada roda no browser do cliente), **desde que**:
- o CORS do `itp-erp-backend` (Vercel, ainda não migrado) permita a origem
  `institutotiapretinha.org` — hoje já permite porque já é cross-origin
  (Vercel → Vercel), então nada muda aqui;
- o domínio do backend não mude nesta fase (não muda — só o website migra
  na Fase 1).

Sem ação necessária agora; só documentar a dependência pro caso de a Fase 3
(erp_itp) mudar esse domínio.

### 6. Stack com versões beta fixadas

`package.json`: `vite: "^8.0.0-beta.13"` (com `overrides` forçando a mesma
versão) e `@tailwindcss/postcss`/`tailwindcss: "^4.2.0"`, `react: "^19.2.0"`.
Vite 8 ainda é beta. Build local rodou sem erro (`npm run build`, Node
v24.13.1, ver item 7), mas isso é uma escolha de risco já existente no
projeto, independente da migração — o Oryx (build system do Azure App
Service/Static Web Apps) precisa resolver essas mesmas versões; como
Static Web Apps usa Actions com Node padrão do runner (geralmente LTS
recente), não deve haver diferença de resultado, mas **não há `engines` no
`package.json`** pra garantir a versão de Node usada no CI do Azure. Sugiro
adicionar `"engines": { "node": ">=20" }` antes de gerar o workflow do
Static Web Apps, evita builds inconsistentes se o runner mudar de versão
default no futuro.

### 7. Sem logs recentes pra auditar 404 (não é ausência de problema, é ausência de dado)

`vercel logs institutotiapretinha.org --no-follow -n 200 --since 7d` voltou
"No logs found". Não há retenção de request logs disponível via CLI nesse
plano/projeto pra auditar padrões de 404 antes da migração. Não bloqueia o
piloto, mas significa que qualquer 404 real hoje (rota errada, asset
quebrado) não vai aparecer nesta due-diligence — só será detectável testando
manualmente o site (recomendado no passo 2 da Fase 1 do plano).

---

## 🟢 Informativo

### 8. Build settings do projeto Vercel batem com o `vercel.json`

`vercel inspect institutotiapretinha.org` mostra deployment `Ready`, build
completou em ~3s usando `vite build` com output em `dist/` (log de build
mostra `dist/assets/...` e `✓ built in 1.02s` do bundler). Nenhuma
sobrescrita de build command/output directory aparente — dashboard segue o
`vercel.json`. Replicar no Azure Static Web Apps: build preset **Vite**,
comando `vite build`, output `dist` (conforme item 1 do plano, Fase 1).

### 9. Tamanho do build: 22MB — bem dentro do limite do tier Free do Azure

`npm run build` local (Node v24.13.1) rodou limpo, gerou `dist/` com ~22MB
(`du -sh dist`), majoritariamente fotos do acervo em `dist/assets/*.jpg`
(vários arquivos 250-560KB cada, imagens não otimizadas/comprimidas via
build pipeline — oportunidade de otimização à parte, fora do escopo desta
migração). Azure Static Web Apps Free tier permite até 250MB por app e 100GB
de banda/mês — 22MB não é motivo de preocupação.

### 10. Nenhuma env var `VITE_*` de build-time

Grep em `src/` por `import.meta.env` não retornou nenhum resultado — o app
não usa nenhuma env var de build (nem analytics key, nem Google
Maps/reCAPTCHA). Confirmado também pelo `vercel env pull` limpo (item 2):
só existe `VERCEL_OIDC_TOKEN`, que não é usado no código e é gerado
automaticamente pela Vercel — não precisa de equivalente no Azure. **Não há
nenhuma env var pra configurar no Static Web App.**

### 11. Repo e CI

`origin` = `https://github.com/erickcardosoitp/website_tia_pretinha.git`,
branch única `main`, sem CI configurado hoje (deploy direto via integração
Vercel↔GitHub). O passo 1 da Fase 1 do plano (Static Web Apps → Create →
fonte GitHub) vai gerar automaticamente o workflow de Actions nesse mesmo
repo — nenhum conflito esperado com a integração Vercel existente (as duas
podem coexistir: cada uma reage a push em `main` e faz seu próprio deploy,
independentes).

---

## Resumo — bloqueadores reais antes do cutover (não do provisionamento)

1. Confirmar suporte a `ALIAS`/`ANAME` pra apex no DNS da Vercel, ou decidir
   estratégia `www` + redirect (item 1).
2. Criar `staticwebapp.config.json` com o conteúdo sugerido (item 3) e
   testar `/matricula` + rota SPA com refresh direto antes de considerar o
   deploy de teste validado.
3. Decidir sobre `@vercel/analytics`/`@vercel/speed-insights` (item 4) —
   não bloqueia o cutover, mas evita perda silenciosa de dado.

Nenhum achado impede seguir com os passos 1-2 da Fase 1 do plano
(provisionar Static Web App e testar em `*.azurestaticapps.net`) — os itens
acima só precisam estar resolvidos **antes do passo 3 (custom domain) e 5
(cutover de DNS)**.
