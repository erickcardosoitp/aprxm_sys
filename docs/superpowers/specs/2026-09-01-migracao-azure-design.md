# Migração do parque de sistemas ITP para Azure

## Contexto

Instituto Tia Pretinha + Associação de Moradores conquistaram o grant Microsoft
for Nonprofits (~US$ 2.000/ano, ~US$ 166/mês). Objetivo: migrar os sistemas
hoje descentralizados em Vercel + Neon para Azure, **sem falhas ou paradas**,
com validação completa antes de cada corte.

Escopo: 3 sistemas ativos + DW/analytics do aprxm_sys. Fora de escopo:
`systemcad` (legado, sem push desde 04/2026) e `pesquisa-intencao-voto`
(privado, projeto de pesquisa — não é sistema operacional do instituto).

| Sistema | Stack real | Repo local |
|---|---|---|
| aprxm_sys | FastAPI (Python) + SQLModel · React/Vite (+ frontends extras `presidencia/` e `painel/`, deploy Vercel próprio cada) | `c:\aprxm_sass` |
| erp_itp | NestJS + TypeORM (backend) · Next.js 15 (frontend), monorepo `apps/backend` + `apps/frontend` | `C:\Users\gonca\erp_itp` |
| website_tia_pretinha | Vite/React estático, sem backend/banco | `C:\tia_pretinha` |

Confirmado via Vercel CLI (time real `itp-aprxm`, não o pessoal) e `psql`
direto contra os Neon de produção:

| Banco (Neon) | Tamanho real | Observação |
|---|---|---|
| aprxm_sys (`ep-rough-tooth...`) | 89 MB | `api_request_logs` = 163.804 linhas — maior tabela de longe, checar retenção antes do dump |
| erp_itp (`ep-wispy-tooth...`) | 20 MB | limpo |
| aprxm-analytics / DW, camada gold do ETL (`ep-floral-shadow...`) | 9,7 MB | alimenta Power BI; entra no escopo desta migração |

Todos pequenos — janela de manutenção de minutos é suficiente pra qualquer um
dos 3 bancos.

**Storage de arquivos (achado durante o levantamento, fora do desenho
original):** `aprxm_sys` usa **Supabase Storage** (bucket `aprxm-midia`,
project ref `tzkvwlqpzrzdmbkisliy`) pra fotos/mídia, não Cloudinary/R2 como o
CLAUDE.md do projeto sugere — checar no código antes de assumir. Migração de
storage (Supabase → Azure Blob Storage) é uma frente própria, separada da
migração de banco, ver seção de Storage abaixo.

**Segundo storage, achado à parte: Cloudflare R2** (bucket `aprxm-datalake`,
18 MB / 180 objetos) guarda as camadas **Bronze** (`bronze/atual/*.parquet`,
`bronze/historico/...`) e intermediários de **Silver** do pipeline de ETL
(`backend/app/services/datalake_service.py`) — pipeline real é
`Neon → Bronze (R2) → Silver (pandas) → Gold (Postgres DW)`. Acesso via
`boto3` S3-compatible (`r2_account_id`, `r2_access_key_id`,
`r2_secret_access_key`, `r2_bucket_name` em `app/config.py`). Também entra
no escopo — migra pro Azure Blob Storage junto com o Supabase Storage.

## ⚠️ REVERSÃO DE ARQUITETURA (2026-09-06): voltando pra VM

A decisão abaixo (PaaS isolado por sistema) foi **revertida** a pedido
explícito do usuário, depois de já termos: migrado o site institucional pro
Static Web App (Fase 1, concluída, permanece como está — é conteúdo
estático, não faz sentido numa VM) e criado + validado o
`psql-erpitp-prod` (Flexible Server) com dado real restaurado do erp_itp
(67 tabelas confirmadas idênticas à origem).

**Motivo da reversão**: o usuário quer visibilidade e controle direto —
"entrar no servidor", ver os dois sistemas (erp_itp e aprxm_sys) rodando
visualmente, abrir o banco de dados localmente sem intermediário, instalar
ferramentas de monitoramento dentro do próprio servidor. Isso não é
alcançável com PaaS (App Service/Flexible Server não expõem o sistema
operacional por baixo, por design). Ficou claro depois de 3 rodadas de
esclarecimento que essa era a intenção desde a primeira mensagem desta
conversa (o relatório original já propunha exatamente isso: VM Oracle
Linux + Docker Compose).

**Risco reaceito conscientemente**: volta a existir falha correlacionada
(1 VM/1 Postgres pros 2 sistemas — se a VM cair, os dois caem juntos). Isso
tinha sido o motivo original de descartar essa abordagem; o usuário optou
por aceitar esse trade-off em troca do controle/visibilidade direta.

**O que é reaproveitado, não refeito**: toda a Fase 0.5 (DNS migrado pra
Azure DNS) continua valendo — DNS é independente de onde o compute roda,
só muda o registro final apontar pra VM em vez de App Service. Due
diligence dos 3 sistemas, correções de segurança (Dependabot/CodeQL),
decisões de código (entrypoint do erp_itp, extensões Postgres) e o dump
validado do erp_itp (`erp_itp_20260905_215242.dump`, 67 tabelas conferidas)
também seguem válidos.

**Plano de execução novo**: [2026-09-06-migracao-vm-plan.md](../plans/2026-09-06-migracao-vm-plan.md).
As seções abaixo (Fase 2/3 originais, baseadas em App Service) ficam como
**registro histórico da análise** — não são mais o runbook de execução.

---

## [HISTÓRICO — não é mais a decisão vigente] PaaS gerenciado, isolado por sistema

Considerado e descartado: VM única + Docker Compose + Traefik + Postgres
compartilhado (proposta inicial). Motivo do descarte: um único host e um
único Postgres pra 3 sistemas cria **falha correlacionada** — a VM ou o banco
caírem derruba todo o parque de uma vez, o oposto da prioridade "sem falhas".
Isolar por sistema custa ~US$ 15-25/mês a mais e o grant tem folga de sobra.

Considerado: Azure Container Apps (blue/green nativo via revisions). Mais
portável, mas maior custo e complexidade operacional sem ganho real aqui —
fica como opção futura se algum dia precisar de multi-cloud.

**Escolhido:** Azure App Service (Linux) com deployment slots + Azure
Database for PostgreSQL Flexible Server + Static Web Apps, tudo isolado por
sistema.

## Arquitetura

Resource Group único `rg-itp-prod`, região Brazil South.

| Componente | Sistema | Notas |
|---|---|---|
| App Service Plan Linux B1 | aprxm_sys | hospeda 1 App Service |
| App Service (Python 3.10, runtime uvicorn) | aprxm_sys backend | slot `staging` |
| Static Web App | aprxm_sys frontend (Vite build) | tier free |
| Static Web App | aprxm_sys `presidencia/` | tier free, dashboard interno |
| Static Web App | aprxm_sys `painel/` | tier free, dashboard interno |
| App Service Plan Linux B1 | erp_itp | hospeda 2 App Services |
| App Service (Node, NestJS) | erp_itp backend | slot `staging` |
| App Service (Node, Next.js SSR) | erp_itp frontend | slot `staging` |
| Static Web App | website_tia_pretinha | tier free, sem banco |
| Azure Database for PostgreSQL Flexible Server (Burstable B1ms) | aprxm_sys | 1 banco lógico |
| Azure Database for PostgreSQL Flexible Server (Burstable B1ms) | erp_itp | 1 banco lógico |
| Azure Database for PostgreSQL Flexible Server (Burstable B1ms) | DW/analytics (gold ETL) | 1 banco lógico, alimenta Power BI |
| Azure Blob Storage (Storage Account) | aprxm_sys | substitui Supabase Storage, bucket `aprxm-midia` |
| Key Vault | todos | DATABASE_URL, JWT_SECRET, Cloudinary keys, Blob Storage connection string |

Nenhum recurso de computação ou banco é compartilhado entre sistemas. Cada
Postgres Flexible Server usa TLS obrigatório, backup automático (7 dias) e,
como hardening recomendado (não bloqueante), autenticação via Entra ID em vez
de senha em texto.

`simplifica-prototype/` (terceiro frontend no repo aprxm_sys) não tem deploy
Vercel ativo encontrado — não entra no escopo até confirmar se está em uso.

`website_tia_pretinha` não tem banco nem backend — fica isolado, menor risco,
usado como piloto da migração (ver ordem abaixo).

## Deploy e zero-downtime

CI/CD via GitHub Actions (um workflow por repo/app):

1. Build da branch `main`.
2. Deploy no slot `staging` do App Service correspondente.
3. Smoke test automatizado contra o slot staging (health check + rotas
   críticas de auth/leitura).
4. `az webapp deployment slot swap` (staging → produção), atômico.
5. Rollback = swap de volta se o health check pós-swap falhar.

Static Web Apps já têm ambiente de preview por PR nativo — não precisa de
slot manual.

## Migração de dados e ordem de corte

Cada sistema segue **janela de manutenção curta agendada** (madrugada ou fim
de semana, fora do horário comercial — uso concentrado em 7 usuários/dia em
horário comercial), não replicação contínua: menor complexidade de
engenharia, downtime controlado e avisado não conta como "falha" para o
objetivo do projeto.

Passo por sistema:

1. Provisionar os recursos Azure do sistema (App Service/Static Web App +
   Postgres Flexible Server) com Vercel/Neon **ainda no ar**.
2. Restaurar dados (`pg_dump` do Neon → `pg_restore`/`psql` no Azure).
3. Apontar o app pro Postgres novo, testar completo em
   `*.azurewebsites.net` / `*.azurestaticapps.net` (não no domínio de
   produção ainda).
4. Validar paridade de dados (contagem de linhas, checksums em tabelas
   críticas) entre Neon e Azure.
5. Rodar suíte de testes existente + checklist manual de fluxo crítico.
6. Cutover de DNS (TTL baixo configurado com antecedência) pro domínio de
   produção apontar pro recurso Azure.
7. Manter Vercel/Neon antigos de pé por 1-2 semanas como fallback de
   rollback antes de decomissionar.

**Ordem de migração:** website_tia_pretinha (sem banco, valida o pipeline de
DNS/deploy com o menor risco possível) → aprxm_sys → erp_itp (mais complexo:
CORS e domínios `itp.institutotiapretinha.org` /
`api.itp.institutotiapretinha.org` hardcoded em `apps/backend/src/main.ts`,
precisam ser revisados no cutover).

## Governança e SSO (Microsoft 365 / Entra ID)

Do relatório organizacional, com uma correção de stack: onde o relatório
original descreve "sistemas em NestJS" para SSO, isso vale só para o erp_itp.
O aprxm_sys é FastAPI — a integração de SSO com Entra ID é **duas
implementações distintas**, não uma:

- erp_itp: `passport-azure-ad` (ou `@azure/msal-node`) integrado ao Nest
  Guards existente.
- aprxm_sys: `msal` ou `authlib` (Python) integrado ao fluxo JWT existente em
  `app/core/security.py` (ou equivalente).

Grupos de Segurança Entra ID mapeados (ver relatório original, seção 3.1):
`GRP_Executiva_Geral`, `GRP_Admin_Tecnologia`, `GRP_Diretoria_Auxiliar`,
`GRP_AM_Gerencia`, `GRP_AM_Operacao`, `GRP_ITP_Docentes`, `GRP_ITP_Cozinha`.
RBAC nos backends mapeia esses grupos pra roles internas.

**Ressalvas técnicas:**
- Claims de grupo no token têm limite de 200 grupos por usuário; acima disso
  o Azure AD emite `hasgroups: true` em vez da lista e o backend precisa
  consultar Microsoft Graph. Com 7 grupos mapeados, não é um problema agora,
  mas fica documentado.
- Licenciamento Entra ID (P1/P2, necessário para alguns recursos de grupo)
  não está confirmado como incluso no grant nonprofit — verificar no portal
  M365 antes de depender disso.

SSO é **fase separada**, executada depois da migração de infraestrutura
estar estável — não faz parte do corte inicial de cada sistema.

## Fora de escopo deste documento

- Provisionamento via Azure CLI/IaC (Bicep/Terraform) — usuário fará o
  provisionamento manual pelo portal Azure. Um runbook passo a passo
  separado cobre isso.
- `simplifica-prototype/` (frontend do aprxm_sys sem deploy ativo
  confirmado) — reavaliar se estiver em uso.
- Descomissionamento de `systemcad` e `pesquisa-intencao-voto`.
- Migração do MCP Supabase em si (ferramenta de inspeção) — só a
  infraestrutura de storage que ele acessa.
