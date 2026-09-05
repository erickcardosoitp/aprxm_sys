#!/usr/bin/env bash
# Backup de um banco Postgres de origem (Neon) pra migracao Azure.
# Roda via Docker (container descartavel) - nao precisa instalar Postgres
# localmente, so a versao do client tem que bater com a do servidor de origem.
#
# Uso: SOURCE_DATABASE_URL='postgresql://...' ./pg-backup.sh <sistema> [imagem]
# Ex.: ./pg-backup.sh erp_itp postgres:17-alpine
#      ./pg-backup.sh aprxm_sys postgres:16-alpine   (default se omitir)
set -euo pipefail

SYSTEM="${1:?uso: pg-backup.sh <nome-sistema, ex: erp_itp> [imagem-postgres]}"
PG_IMAGE="${2:-postgres:16-alpine}"
: "${SOURCE_DATABASE_URL:?defina SOURCE_DATABASE_URL antes de rodar}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backups"
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="${SYSTEM}_${STAMP}.dump"

echo "Dump de '${SYSTEM}' via ${PG_IMAGE} -> backups/${FILE}"
docker run --rm -v "$DIR:/backups" "$PG_IMAGE" \
  pg_dump --format=custom --no-owner --no-privileges -f "/backups/${FILE}" "$SOURCE_DATABASE_URL"

echo "OK: $(du -h "$DIR/$FILE" | cut -f1) em $DIR/$FILE"
echo
echo "tabelas com dados: $(docker run --rm -v "$DIR:/backups" "$PG_IMAGE" pg_restore -l "/backups/${FILE}" | grep -c 'TABLE DATA')"
docker run --rm -v "$DIR:/backups" "$PG_IMAGE" pg_restore -l "/backups/${FILE}" | grep -i "EXTENSION" || echo "(nenhuma extensao no dump)"
