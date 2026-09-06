# Plano de execução — Migração ITP pra VM (Oracle Linux + Docker Compose)

Substitui a abordagem App Service/Flexible Server das Fases 2/3 do
[plano original](2026-09-01-migracao-azure-plan.md) — motivo da reversão
registrado na [spec](../specs/2026-09-01-migracao-azure-design.md).

Continua valendo do plano original: Fase 0 (Resource Group/orçamento/Key
Vault), Fase 0.5 (DNS na Azure DNS), Fase 1 (site institucional no Static
Web App), due-diligence dos 3 sistemas, correções de segurança
(Dependabot/CodeQL), o dump validado do erp_itp.

---

## Fase VM.1 — Provisionar a VM

Portal Azure → **Máquinas Virtuais** → **Criar** → **Máquina virtual do Azure**:

- Grupo de recursos: `rg-itp-prod`
- Nome: `vm-itp-prod`
- Região: **Brazil South**
- Imagem: **Oracle Linux 9** (buscar na Marketplace — "Oracle Linux 9" da
  Oracle; confirmar se aparece no catálogo do Portal, senão usar Oracle
  Linux 8 como alternativa mais disponível)
- Tamanho: **Standard_B2ms** (2 vCPUs, 8GiB RAM, Burstable — mesmo da
  proposta original)
- Autenticação: **Chave SSH** (mais seguro que senha) — gerar par novo ou
  usar existente, guardar a chave privada em local seguro (não vai pro
  Key Vault do jeito que os segredos de app vão, é chave SSH mesmo)
- Portas de entrada: abrir só **SSH (22)** por enquanto — HTTP/HTTPS (80/443)
  entram depois, quando o Traefik estiver configurado, não antes
- Disco: **Premium SSD**, 64GiB (P6) é suficiente pro volume atual dos 2
  bancos (109MB somados) + imagens Docker + folga
- Rede: nova VNet dedicada (`vnet-itp-prod`), NSG restringindo a porta 22
  só ao seu IP atual (não `0.0.0.0/0` — mesma lógica do firewall do
  Postgres que já aplicamos antes)

Critério de saída: VM criada, consegue conectar via SSH.

---

## Fase VM.2 — Configuração inicial do sistema

Via SSH na VM:

1. Atualizar pacotes: `sudo dnf update -y`
2. Instalar Docker + Docker Compose:
   ```bash
   sudo dnf install -y dnf-utils
   sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
   sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
   sudo systemctl enable --now docker
   sudo usermod -aG docker $(whoami)
   ```
3. **Cockpit** (painel visual do sistema — Oracle Linux/RHEL já vem com
   pacote disponível):
   ```bash
   sudo dnf install -y cockpit
   sudo systemctl enable --now cockpit.socket
   sudo firewall-cmd --add-service=cockpit --permanent
   sudo firewall-cmd --reload
   ```
   Acesso: `https://<ip-da-vm>:9090` (usuário/senha do sistema Linux).
   **Abrir a porta 9090 no NSG só pro seu IP**, não público.
4. **Portainer** (painel visual dos containers Docker — sobe como container
   também):
   ```bash
   docker volume create portainer_data
   docker run -d -p 9443:9443 --name portainer --restart=always \
     -v /var/run/docker.sock:/var/run/docker.sock \
     -v portainer_data:/data \
     portainer/portainer-ce:latest
   ```
   Acesso: `https://<ip-da-vm>:9443` (cria usuário admin no primeiro
   acesso). Mesma regra do NSG: só seu IP.

Critério de saída: Cockpit e Portainer acessíveis, Docker funcionando
(`docker run hello-world` sem erro).

---

## Fase VM.3 — Postgres (2 bancos lógicos, dado real restaurado)

1. Criar a stack em `~/itp-stack/docker-compose.yml`:
   ```yaml
   services:
     postgres:
       image: postgres:17-alpine
       container_name: itp_postgres
       restart: unless-stopped
       environment:
         POSTGRES_USER: itp_admin
         POSTGRES_PASSWORD: <gerar senha forte, guardar com cuidado>
       volumes:
         - pg_data:/var/lib/postgresql/data
       ports:
         - "5432:5432"
   volumes:
     pg_data:
   ```
2. `docker compose up -d postgres`
3. Criar os 2 bancos lógicos:
   ```bash
   docker exec -it itp_postgres psql -U itp_admin -c "CREATE DATABASE erp_itp_db;"
   docker exec -it itp_postgres psql -U itp_admin -c "CREATE DATABASE aprxm_db;"
   ```
4. **Restaurar o erp_itp** — reaproveita o dump já validado (não precisa
   gerar de novo, mas se tiver passado tempo considerável desde
   05/09-21:52, gerar um novo antes do restore final):
   ```bash
   # copiar o dump pra dentro da VM (do seu PC, via scp)
   scp docs/superpowers/plans/scripts/backups/erp_itp_20260905_215242.dump usuario@<ip-da-vm>:~/
   # dentro da VM
   docker cp ~/erp_itp_20260905_215242.dump itp_postgres:/tmp/
   docker exec itp_postgres pg_restore --no-owner --no-privileges -U itp_admin -d erp_itp_db /tmp/erp_itp_20260905_215242.dump
   ```
   Mesmo achado do restore anterior: 2 erros esperados de `pg_session_jwt`
   (extensão Neon sem equivalente), inofensivo. `pgcrypto`/`uuid-ossp`
   **já vêm disponíveis por padrão numa imagem Postgres normal** — o
   allow-list era só uma restrição do Azure Flexible Server, não existe
   aqui.
5. **Restaurar o aprxm_sys** — ainda não temos dump validado deste (só do
   erp_itp). Gerar agora:
   ```bash
   SOURCE_DATABASE_URL="<DATABASE_URL do aprxm_sys, ver backend/.env.vercel-prod ou pedir de novo>" \
     docs/superpowers/plans/scripts/pg-backup.sh aprxm_sys postgres:16-alpine
   ```
   Copiar pra VM e restaurar do mesmo jeito, no banco `aprxm_db`.
6. **Validar contagem de linhas** dos dois (mesmo método do erp_itp:
   `count_all.sql` origem x destino, `diff`/`Compare-Object`).
7. Decidir sobre `psql-erpitp-prod` (Flexible Server): manter como backup
   secundário por enquanto (custa US$32,56/mês) ou desligar já — decisão
   do usuário, sem pressa.

Critério de saída: os 2 bancos rodando na VM com dado validado idêntico à
origem.

---

## Fase VM.4 — Backends (erp_itp e aprxm_sys)

Adicionar ao `docker-compose.yml`:

```yaml
  erp_itp_backend:
    build: <caminho do Dockerfile do erp_itp, apps/backend>
    container_name: erp_itp_backend
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://itp_admin:<senha>@postgres:5432/erp_itp_db
      # + demais env vars: JWT_SECRET, SUPABASE_*, SMTP_*, CRON_SECRET, etc.
    depends_on:
      - postgres
    ports:
      - "3001:3001"

  aprxm_backend:
    build: <caminho do Dockerfile do aprxm_sys, backend/>
    container_name: aprxm_backend
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql+asyncpg://itp_admin:<senha>@postgres:5432/aprxm_db
      # + demais env vars, incluindo DATAWAREHOUSE_APRXM_DATABASE_URL
    depends_on:
      - postgres
    ports:
      - "8000:8000"
```

Reaproveitar as decisões já tomadas no plano original sobre cada backend:
- erp_itp: entrypoint `api/main.ts` (não `src/main.ts`), CORS a consolidar,
  `rejectUnauthorized: true` no TLS do Postgres.
- aprxm_sys: confirmar versão real do Python antes de fixar no Dockerfile,
  extensão `pg_session_jwt` excluída do restore, `api_request_logs`
  avaliar truncar.

Critério de saída: os 2 backends rodando, respondendo localmente na VM
(`curl localhost:3001`, `curl localhost:8000/docs`).

---

## Fase VM.5 — Traefik (proxy reverso) + domínios

1. Adicionar Traefik ao `docker-compose.yml`, roteando:
   - `itp.institutotiapretinha.org` / `api.itp.institutotiapretinha.org` → `erp_itp_backend`
   - domínio do aprxm_sys (a definir) → `aprxm_backend`
2. HTTPS via Let's Encrypt (Traefik faz isso automaticamente com o
   resolver certresolver) — **confirmar que `letsencrypt.org` está no CAA**
   da zona (já está, adicionamos na Fase 0.5).
3. Abrir portas 80/443 no NSG (só agora, depois do Traefik configurado).
4. Registro na zona Azure DNS apontando pro **IP público da VM** (A record,
   não CNAME) pros domínios acima.

Critério de saída: os 2 sistemas acessíveis via HTTPS nos domínios finais,
certificado válido.

---

## Fase VM.6 — Frontends

Frontends (React/Vite, Next.js) podem continuar como build estático servido
pelo próprio Traefik/nginx dentro de um container, ou ficarem no Static Web
App (mais simples, sem servidor por trás, não conflita com a VM já que são
só arquivos estáticos). **Decisão a confirmar com o usuário**: manter
frontends no Static Web App (like o site institucional) ou trazer pra
dentro da VM também, pra ficar "tudo num lugar só".

---

## Fora deste plano por enquanto

- Cron jobs: dentro da VM isso vira trivial — `cron` do próprio sistema
  operacional ou um serviço agendador simples, sem precisar de Logic App
  (isso era workaround específico de PaaS serverless).
- Backup: **crítico revisar** — Flexible Server tinha backup automático de
  7 dias de graça; numa VM isso é responsabilidade nossa configurar
  (`pg_dump` agendado + Azure Backup pra VM, ou snapshot de disco).
- Alta disponibilidade: não existe replicação/HA nesse desenho — é o
  trade-off já aceito na reversão de arquitetura.
