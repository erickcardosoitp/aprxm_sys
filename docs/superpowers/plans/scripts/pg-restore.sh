#!/usr/bin/env bash
# Restore de um dump (gerado por pg-backup.sh) no Postgres novo (Azure),
# excluindo extensoes proprietarias do Neon sem equivalente no Azure
# (ex. pg_session_jwt) que fariam o restore falhar. Roda via Docker.
#
# Uso: TARGET_DATABASE_URL='postgresql://...' ./pg-restore.sh <arquivo.dump> [imagem]
set -euo pipefail

DUMP_ARG="${1:?uso: pg-restore.sh <arquivo.dump> [imagem-postgres]}"
PG_IMAGE="${2:-postgres:16-alpine}"
: "${TARGET_DATABASE_URL:?defina TARGET_DATABASE_URL antes de rodar}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backups"
FILE="$(basename "$DUMP_ARG")"
[ -f "$DIR/$FILE" ] || { echo "Arquivo nao encontrado: $DIR/$FILE" >&2; exit 1; }

TOC="/tmp/$$_toc.list"
TOC_FILTERED="/tmp/$$_toc_filtered.list"
docker run --rm -v "$DIR:/backups" "$PG_IMAGE" pg_restore -l "/backups/${FILE}" > "$TOC"

EXCLUDE_PATTERN="EXTENSION pg_session_jwt"
grep -vi "$EXCLUDE_PATTERN" "$TOC" > "$TOC_FILTERED" || true
REMOVIDAS=$(grep -ci "$EXCLUDE_PATTERN" "$TOC" || true)
echo "Entradas excluidas do restore: ${REMOVIDAS} (${EXCLUDE_PATTERN})"

cp "$TOC_FILTERED" "$DIR/.toc_filtered.list"
echo "Restaurando via ${PG_IMAGE}..."
docker run --rm -v "$DIR:/backups" "$PG_IMAGE" \
  pg_restore --no-owner --no-privileges -L "/backups/.toc_filtered.list" -d "$TARGET_DATABASE_URL" "/backups/${FILE}"

rm -f "$TOC" "$TOC_FILTERED" "$DIR/.toc_filtered.list"
echo "OK — restore concluido. Rode pg-verify.sh em seguida pra conferir contagem de linhas."
