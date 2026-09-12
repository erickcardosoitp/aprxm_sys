# Plano — Migração do APRXM (Vercel → infra própria)

Documento de referência pra migrar o 2º sistema do parque (`aprxm_sys`,
ERP/SaaS multi-tenant do Instituto Tia Pretinha) pro mesmo modelo já usado
no `erp_itp` (VM própria, Docker, sem depender de Vercel). Espelha a
estrutura do `2026-09-06-migracao-vm-plan.md` (repo erp_itp), que já
documentou e executou a migração do 1º sistema.

---

## 1. Situação atual (levantada em 2026-09-12)

```
Vercel (deploy único via git push origin main)

  frontend/  React 18 + Vite + Tailwind (mobile-first)
       │ JWT Bearer (proprio - jose + passlib[bcrypt], NAO Microsoft SSO)
       ▼
  backend/   FastAPI + SQLModel + asyncpg (funcao serverless via
             @vercel/python, api/index.py)
       │
       ├──► Neon "APRXM"  (OLTP, prod — 59 tabelas)
       ├──► schema `analytics` no mesmo Neon (OLAP, Power BI)
       ├──► Cloudflare R2  (data lake bronze/silver/gold, fotos)
       └──► Cloudinary / e-mail SMTP
```

- **8 cron jobs hoje no `vercel.json`**: lembretes de demands/daily-tasks,
  geração/checagem de mensalidades, datalake (2x/dia), vacuum semanal,
  scoring de CRM diário.
- **Dockerfiles já existem** pra backend e frontend (alguém já preparou
  containerização antes, nunca usado em produção até onde sei).
- **Banco**: já está no Neon (não Supabase) — diferente do que o erp_itp
  tinha antes de migrar. Não precisa de migração de dados pra sair do
  Supabase.
- **Storage**: Cloudflare R2 (não Supabase Storage) — outro ponto que já
  está fora do Supabase, ao contrário do erp_itp original.
- **Repo**: `github.com/erickcardosoitp/aprxm_sys` (confirmado via
  `git remote -v` — mesmo dono do erp_itp).

**Diferença chave vs a migração do erp_itp**: lá, banco E storage
estavam no Supabase e precisaram migrar pra sair de vez do serviço.
Aqui, banco (Neon) e storage (R2) **já não dependem do Vercel/Supabase**
— a migração é bem mais estreita: só tirar o **compute** (frontend +
backend) de cima do Vercel, o resto pode continuar como está.

---

## 2. Decisão principal: mesma VM do erp_itp, ou VM separada?

### Capacidade disponível na VM atual (`vm-itp-prod`)

Depois do resize de 2026-09-11 (`Standard_E2bs_v5`, 2 vCPU / 16GB RAM,
disco 128GB): hoje roda 13 containers (erp_itp + ITP_TEC + Grafana/
Prometheus/4 exporters) usando **~2.5GB de RAM**, load average ~0.85-0.9.
Sobra bastante: **~10-12GB de RAM livre**, CPU com folga real.

### Opção A — Co-localizar na `vm-itp-prod`

**Prós**: zero custo adicional de infra, reaproveita Traefik/SSL/backup
já configurados, capacidade sobrando de verdade (confirmado acima).

**Contras**: mistura o "risco de falha" dos dois sistemas — já é a
decisão consciente que o erp_itp tomou (correlacionar falhas em troca de
controle), mas agora dobra a superfície: um problema de recurso no
APRXM pode afetar o erp_itp e vice-versa. É exatamente o padrão que
o plano de homologação/dev já discutiu (`2026-09-11-homologacao-dev-plan.md`)
sobre contenção de recurso — só que aqui é entre 2 sistemas de produção,
não prod vs staging.

### Opção B — VM separada

Mesma lógica do documento de homologação: isolamento real, mas custo
adicional (uma 2ª VM ligada 24/7) e mais um alvo de manutenção (patch de
SO, backup próprio, Traefik/DNS próprios).

**Recomendação**: dado que sobra bastante capacidade real na VM atual
(confirmado agora, não estimado) e que os dois sistemas já são do mesmo
dono/operação, **Opção A (co-localizar)** é defensável — mas é uma
decisão do usuário, não técnica pura, porque envolve tolerância a risco
de indisponibilidade cruzada entre dois produtos de produção.

---

## 3. Pendências de levantamento (antes de fechar o plano de execução)

- [ ] Confirmar se o Neon "APRXM" já tem redundância/backup configurado
      (o erp_itp tinha isso como pendência resolvida via `pg-sync-to-neon.sh`
      — aqui já É o Neon, então a pergunta é inversa: existe backup do
      Neon "APRXM" pra algum outro lugar?)
- [ ] Confirmar domínio(s) que o APRXM vai usar (hoje deve ser algo tipo
      `*.vercel.app` ou domínio próprio configurado no Vercel — precisa
      saber pra registrar DNS apontando pra VM)
- [ ] Confirmar se o R2 (Cloudflare) permanece como está (parece que sim,
      sem motivo pra trocar) ou se há decisão de consolidar tudo em Azure
      Blob (como foi feito pro erp_itp) por custo/gestão único
- [ ] Verificar se os 8 cron jobs do `vercel.json` têm alguma dependência
      de ambiente serverless específica (cold start, timeout de execução)
      que não existe rodando via crontab normal — provavelmente não, mas
      vale conferir antes de portar
- [ ] Decisão sobre autenticação: manter JWT próprio (como é hoje) — não
      há indicação de que precise de SSO Microsoft aqui, diferente do
      erp_itp
- [ ] Auditoria de banco já feita em 2026-08-01 (ver ARQUITETURA.md §3) —
      dívidas conhecidas (SQL cru em routers, fragmentação de escopo
      empresa-wide) não são bloqueio de migração, só registrar que
      continuam existindo depois

---

## 4. Fases propostas (espelhando o padrão do erp_itp)

1. **VM.1 — Provisionamento**: decidir Opção A/B (seção 2), preparar
   diretório/rede Docker se for co-localizar
2. **VM.2 — Deploy de containers**: usar os Dockerfiles já existentes
   (backend/Dockerfile, frontend/Dockerfile), sem reescrever do zero
3. **VM.3 — Variáveis de ambiente**: migrar tudo que hoje está nas env
   vars do Vercel pro `.env` da VM (Neon connection string, R2 keys,
   Cloudinary, SMTP)
4. **VM.4 — Cron jobs**: portar os 8 crons do `vercel.json` pro
   mecanismo já validado no erp_itp (ITP_TEC `tarefas-registro.json` +
   `tarefas_runner.py` — já dá timing real, log estruturado, execução
   manual, tudo de graça reaproveitando o que já existe)
5. **VM.5 — DNS/Traefik**: apontar domínio(s) do APRXM pra VM, certificado
   Let's Encrypt automático (mesmo padrão dos outros serviços)
6. **VM.6 — Corte**: desligar Vercel só depois de validar em paralelo
   (mesmo padrão cauteloso do erp_itp — nunca desligar antes de confirmar)

---

## 5. O que NÃO muda (evita trabalho desnecessário)

- Banco (Neon) — continua exatamente como está
- Storage (Cloudflare R2) — continua exatamente como está, a menos que
  se decida consolidar em Azure por outro motivo (custo, gestão única)
- Autenticação (JWT próprio) — sem motivo pra trocar por SSO aqui
- Cloudinary/SMTP — sem motivo pra trocar

Migração fica focada e estreita: **só tirar o compute do Vercel**, não é
uma reconstrução completa como foi o erp_itp (que teve banco + storage +
compute pra migrar).
