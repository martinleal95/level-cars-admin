#!/usr/bin/env bash
# Ejecuta las pruebas de base de datos en un Postgres LOCAL y descartable:
# crea una base temporal, aplica el stub de Supabase y las migraciones,
# corre las pruebas y borra la base. Nunca apunta a la base de producción.
# Uso: PGHOST=localhost PGUSER=postgres npm run test:db
set -euo pipefail
cd "$(dirname "$0")/../.."

case "${PGHOST:-localhost}" in
  localhost|127.0.0.1|/*) ;;
  *) echo "Por seguridad, las pruebas solo corren contra un Postgres local (PGHOST=${PGHOST})." >&2; exit 1 ;;
esac

DB="lc_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT

psql -q -v ON_ERROR_STOP=1 -d "$DB" < supabase/tests/00_stub_supabase.sql
for f in supabase/migrations/*.sql; do
  case "$f" in *_storage.sql) continue ;; esac   # el stub no incluye el esquema storage
  psql -q -v ON_ERROR_STOP=1 -d "$DB" < "$f"
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" < supabase/tests/test_negocio.sql
