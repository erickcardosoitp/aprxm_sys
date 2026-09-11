# Plano — Ambientes de Homologação e Desenvolvimento (parque ITP)

Documento de referência, não uma decisão já tomada — lista as opções reais
e as implicações de cada uma, pra decidir com informação completa antes de
implementar. Escopo: erp_itp (produção), catalogo-erros-viewer/ITP_TEC, e o
2º sistema (aprxm_sys) quando migrar.

---

## 1. Situação atual (linha de base)

- **1 única VM** (`vm-itp-prod`, Oracle Linux 9, `20.114.240.177`) roda
  tudo: produção do erp_itp (frontend/backend/Postgres/Traefik/pgAdmin) +
  o próprio ITP_TEC (catálogo de erros/tarefas/custos).
- **Specs da VM**: 2 vCPU, 7.3GB RAM, 53GB disco (27GB livres, 50% uso).
  Hoje já com ~3.5GB de RAM em uso só de produção — folga real é
  apertada pra rodar mais uma cópia inteira dos serviços ao lado.
- **Não existe hoje**: nenhum ambiente de homologação/staging, nenhum
  ambiente de desenvolvimento compartilhado. Todo desenvolvimento é local
  (máquina do dev) contra o banco local ou, na prática, direto em produção
  (risco já aceito implicitamente até agora).
- **Banco**: Postgres roda em container na própria VM; Neon é usado só como
  destino de backup/redundância (pg_dump→pg_restore a cada 6h), não como
  banco de homologação.

---

## 2. Duas estratégias possíveis

### Opção A — Homologação/dev na MESMA VM (containers extras)

Sobe uma segunda stack Docker Compose (`erp_itp_frontend_staging`,
`erp_itp_backend_staging`, `itp_postgres_staging`) na mesma VM, em portas/
domínios diferentes (`staging.itp.institutotiapretinha.org`), atrás do
mesmo Traefik.

**Prós:**
- Sem custo de infra novo (nenhuma VM adicional).
- Mesma rede interna Docker — fácil de configurar.
- Deploy simples: outro branch, outro `docker compose -p staging up`.

**Contras (reais, não hipotéticos):**
- **Contenção de recurso**: só 2 vCPU/7.3GB no total. Rodar Postgres +
  Next.js + NestJS em dobro nessa VM aperta memória de verdade (hoje já
  sobra pouco). Um teste de carga em staging pode degradar produção ao
  lado, sem isolamento nenhum.
- **Sem isolamento de falha**: se staging travar o Docker daemon ou
  encher o disco (ex: log run-away, build sem limpeza), produção cai
  junto — é a mesma decisão consciente já documentada na migração original
  ("correlacionar falhas em troca de visibilidade/controle direto"), mas
  aqui o trade-off fica pior porque staging é ambiente de teste, feito
  pra quebrar.
- **Migração de schema arriscada**: testar uma migration destrutiva em
  staging na mesma VM não protege produção de um erro humano (ex: rodar
  contra a env errada por engano).

**Quando faz sentido**: enquanto o orçamento não permite 2ª VM e o volume
de testes é baixo (poucos MRs por semana, sem teste de carga).

### Opção B — VM separada de homologação (`vm-itp-staging`)

Nova VM Azure, menor (ex: B2s — 2 vCPU/4GB, mais barata que a de produção),
replicando a stack completa (Traefik próprio ou compartilhando certificado
via DNS, Postgres próprio, populado por dump anonimizado de produção).

**Prós:**
- Isolamento real de falha e de recurso — testar/quebrar staging nunca
  afeta produção.
- Pode ter dados voláteis (resetar/restaurar dump sem medo).
- Path natural pra CI/CD (deploy automático em cada PR merged na branch
  `develop`, antes de promover pra `main`/produção).

**Contras:**
- **Custo adicional real** — outra VM ligada 24/7 (ou usar auto-shutdown
  fora do horário comercial pra economizar, já que homologação não precisa
  rodar de madrugada).
- Mais um alvo de manutenção: patch de SO, backup próprio (ou aceitar que
  staging não precisa de backup — é recriável a qualquer momento a partir
  de produção).
- Duplica configuração (SSO, DNS, Traefik) — mais superfície de deriva de
  config entre ambientes se não for automatizado via IaC.

**Quando faz sentido**: assim que o volume de mudanças/PRs justificar, ou
antes de qualquer migration destrutiva de schema em produção.

---

## 3. Alternativa: hospedagem gerenciada em vez de VM própria

Em vez de replicar a VM inteira pra homologação, considerar hospedar
frontend/backend de staging em serviço gerenciado (fora da VM):

| Camada | Opção gerenciada | Nota |
|---|---|---|
| Frontend (Next.js) | Vercel/Netlify (free tier) | Já foi usado antes da migração pra VM — decisão consciente de sair de lá pra correlação de custo/controle. Reintroduzir só pra staging é aceitável (não é produção, risco de vendor lock-in menor). |
| Backend (NestJS) | Azure Container Apps / App Service (tier baixo) | Paga só por uso, escala a zero fora de horário — mais barato que VM 24/7 se staging for usado só em horário comercial. |
| Banco (staging) | Neon (branch de banco, feature nativa) ou Azure Postgres Flexible Server (tier burstable B1ms) | Neon já é usado no parque (backup do erp_itp) — **branching de banco do Neon é literalmente feito pra isso**: cria uma cópia copy-on-write do banco de produção em segundos, sem duplicar armazenamento nem custo até haver escrita divergente. Provavelmente a peça mais barata e mais rápida de implementar aqui. |

**Recomendação prática**: combinar — banco de staging via **Neon branching**
(baixíssimo custo/esforço, dado que Neon já está no parque) + front/back de
staging em container-as-a-service com scale-to-zero, em vez de replicar a
VM inteira. Evita o problema de contenção de recurso da Opção A sem pagar
por uma 2ª VM 24/7 da Opção B.

---

## 4. Ambiente de desenvolvimento (local, não staging)

Diferente de homologação — dev roda na máquina de cada desenvolvedor.
Recomendação mínima, hoje inexistente:

- `docker-compose.dev.yml` no repo (Postgres local + backend com hot-reload
  `--watch`, frontend `next dev`) — elimina "funciona na minha máquina"
  por divergência de versão de Postgres/Node.
- `.env.example` documentando todas as variáveis obrigatórias (hoje só
  existe implicitamente espalhado pelos `.env*` reais, nenhum template).
- Seed de dados de desenvolvimento (dump anonimizado pequeno, ou os
  `database/seeds/` já mencionados no CLAUDE.md do aprxm_sass — verificar
  se erp_itp tem equivalente; se não tiver, é uma lacuna a preencher).

---

## 5. Recomendação (não vinculante — decisão é do usuário)

1. **Curto prazo**: banco de staging via Neon branch (baixo esforço, já
   disponível) + `docker-compose.dev.yml` pra desenvolvimento local. Cobre
   a maior lacuna de risco (testar migration/mudança de schema fora de
   produção) sem gastar em infra nova.
2. **Médio prazo, se o volume de PRs crescer**: mover front/back de
   staging pra Container Apps/App Service com scale-to-zero (Opção
   híbrida da seção 3), evitando tanto o custo de VM 24/7 quanto a
   contenção de recurso da Opção A.
3. **Não recomendado**: Opção A pura (containers extras na mesma VM) como
   solução permanente — só como paliativo de curtíssimo prazo, dado que a
   VM já roda com pouca folga de RAM.

---

## 6. Pendências pra fechar antes de implementar qualquer opção

- Confirmar se erp_itp tem `docker-compose.dev.yml`/seeds hoje (não
  verificado neste levantamento).
- Definir orçamento aceitável pra homologação (decide entre Opção A/B/C).
- Se optar por Neon branching: confirmar plano/tier do Neon atual suporta
  branching (recurso pode ser limitado no tier free).
- Definir política de dado sensível em staging/dev — dump de produção
  precisa de anonimização (CPF, dados de aluno/família da ITP) antes de
  popular ambiente não-produtivo, por LGPD.
