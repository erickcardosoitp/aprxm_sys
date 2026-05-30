# Migração de Secrets para Vercel

## Como adicionar no Vercel

Acesse: https://vercel.com/erickxcs-projects/backend/settings/environment-variables

Para cada variável abaixo, clique em "Add New" e selecione Environment: **Production + Preview + Development**

## Variáveis que DEVEM estar no Vercel (não no .env em produção)

| Variável | Sensibilidade | Onde obter |
|----------|--------------|-----------|
| `DATABASE_URL` | 🔴 CRÍTICO | Neon dashboard |
| `DATABASE_URL_DIRECT` | 🔴 CRÍTICO | Neon dashboard |
| `SECRET_KEY` | 🔴 CRÍTICO | Gerar: `openssl rand -hex 32` |
| `SUPABASE_SERVICE_KEY` | 🔴 CRÍTICO | Supabase → Settings → API |
| `GEMINI_API_KEY` | 🟡 ALTO | Google AI Studio |
| `SNYK_TOKEN` | 🟡 ALTO | app.snyk.io → Account Settings |
| `VAPID_PRIVATE_KEY` | 🟡 ALTO | Gerado no setup |
| `SMTP_PASSWORD` | 🟡 ALTO | Google App Password |

## Variáveis que podem ficar no .env (não sensíveis)

```
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=120
REFRESH_TOKEN_EXPIRE_DAYS=7
APP_ENV=production
APP_NAME=APRXM
APP_VERSION=1.0.0
DELIVERY_FEE_DEFAULT=2.50
ALLOWED_ORIGINS=https://aprxm-sysfrontend.vercel.app
SUPABASE_URL=https://...supabase.co  (URL pública, não a chave)
VAPID_PUBLIC_KEY=...  (pública por definição)
```

## Passo a passo

1. Abra https://vercel.com → seu projeto backend → Settings → Environment Variables
2. Adicione cada variável 🔴 e 🟡 da tabela acima
3. Faça redeploy: `vercel --prod`
4. Remova do .env local as variáveis 🔴 (mantenha apenas para desenvolvimento local)
5. Adicione ao .gitignore: `.env` (já deve estar)

## Verificar se .env está no .gitignore

```bash
cat .gitignore | grep .env
# Deve mostrar: .env ou *.env
```
