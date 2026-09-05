#!/usr/bin/env bash
# Compara contagem de linhas de todas as tabelas entre origem e destino
# depois do restore. Roda via Docker. Sai com codigo != 0 se divergir.
# Uso: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... ./pg-verify.sh [imagem]
set -euo pipefail

PG_IMAGE="${1:-postgres:16-alpine}"
: "${SOURCE_DATABASE_URL:?defina SOURCE_DATABASE_URL}"
: "${TARGET_DATABASE_URL:?defina TARGET_DATABASE_URL}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="/tmp/$$_src.csv"
DST="/tmp/$$_dst.csv"

docker run --rm -v "$DIR:/scripts" "$PG_IMAGE" \
  psql "$SOURCE_DATABASE_URL" -At -F',' -f /scripts/count_all.sql | sort > "$SRC"
docker run --rm -v "$DIR:/scripts" "$PG_IMAGE" \
  psql "$TARGET_DATABASE_URL" -At -F',' -f /scripts/count_all.sql | sort > "$DST"

if diff -u "$SRC" "$DST" > /tmp/pg-verify.diff; then
  echo "OK — contagem de linhas identica em todas as tabelas."
  rm -f "$SRC" "$DST" /tmp/pg-verify.diff
  exit 0
else
  echo "DIVERGENCIA encontrada (origem vs destino):"
  cat /tmp/pg-verify.diff
  rm -f "$SRC" "$DST"
  exit 1
fi
