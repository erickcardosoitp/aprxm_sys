# APRXM

ERP/SaaS multi-tenant para associações de moradores.

**Stack:** FastAPI (Python 3.13) · React 18 + Vite · PostgreSQL · Deploy na Vercel

---

## Rodando localmente (Docker)

Único pré-requisito: **Docker Desktop** ([download](https://www.docker.com/products/docker-desktop)).
No Windows, o Docker Desktop exige WSL2 — se não tiver, rode `wsl --install` num PowerShell
como Administrador e reinicie o PC antes de continuar.

```bash
git clone <repo>
cd aprxm_sass
docker compose up --build
```

Pronto. Não precisa criar `.env`, nem instalar Python/Node/Postgres, nem configurar
credencial nenhuma — o `docker-compose.yml` já traz tudo com valores padrão de
desenvolvimento.

| Serviço | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend (API) | http://localhost:8000 |
| Documentação da API (Swagger) | http://localhost:8000/docs |
| Postgres | `localhost:5432` (user `aprxm_user`, senha `changeme`, db `aprxm_db`) |

### Login de desenvolvimento

No primeiro start, com o banco vazio, o backend cria automaticamente uma empresa,
uma associação e um usuário admin:

```
e-mail: admin@local.dev
senha:  admin123
```

Esse seed só roda quando `APP_ENV=development` **e** o banco não tem nenhum usuário —
nunca toca num banco que já tem dado.

### Comandos úteis

```bash
docker compose up -d          # sobe em background
docker compose logs -f backend # acompanha o log do backend
docker compose down           # para tudo (mantém o banco)
docker compose down -v        # para tudo e APAGA o banco (recomeça do zero, com seed novo)
```

---

## Rodando sem Docker

Precisa de Python 3.13, Node 22 e um Postgres rodando localmente.

```bash
# backend
cd backend
pip install -r requirements.txt
cp ../.env.example .env        # ajuste DATABASE_URL e SECRET_KEY
python -m uvicorn app.main:app --reload --port 8000

# frontend (outro terminal)
cd frontend
npm install
npm run dev
```

---

## Estrutura

```
backend/app/
  main.py          # app FastAPI + migrations versionadas (_run_migrations)
  routers/         # endpoints por domínio
  services/        # regra de negócio
  models/          # SQLModel
frontend/src/
  pages/           # telas por módulo
  components/      # componentes compartilhados
  services/api.ts  # axios + interceptors (auth, refresh token)
database/
  schema.sql       # snapshot de referência do schema (não é o setup — ver abaixo)
```

### Sobre migrations

O schema é gerenciado por blocos versionados em `backend/app/main.py::_run_migrations()`,
controlados pela constante `_SCHEMA_VERSION`. Eles rodam automaticamente no start da
aplicação — não existe comando manual de migration.

Ao adicionar uma migration nova: incremente `_SCHEMA_VERSION`, adicione o bloco DDL
**nos dois ramos** (`_is_existing_db` e fresh-DB), sempre aditivo (`IF NOT EXISTS`) e
isolado em `try/except` com rollback, seguindo o padrão dos blocos existentes.

`database/schema.sql` é um dump de referência do banco de produção, não um script de
setup — o Docker o usa apenas como ponto de partida, e as migrations completam o resto.
