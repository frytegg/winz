#!/usr/bin/env bash
#
# Schema tests (task D-01). Starts a throwaway Postgres 16, applies the migrations and the seed to
# two fresh databases and runs the assertions of supabase/tests/*.sql against them:
#
#   winz_plain     a vanilla Postgres plus the three Supabase roles
#   winz_supabase  the same, with what a Supabase project adds before any migration runs: every
#                  privilege on new public tables granted to the browser roles by default, and the
#                  `supabase_realtime` publication
#
# Exits non-zero when an assertion fails or a file does not apply. The server is always stopped.
#
# Environment:
#   PG_BIN      directory of initdb, pg_ctl, psql (default: /usr/lib/postgresql/16/bin, else PATH)
#   PG_OS_USER  unprivileged user that runs the server when this script runs as root (default: postgres)
#   VERBOSE=1   print every assertion, not only the failed ones

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(dirname "$HERE")"
REPO_DIR="$(dirname "$SUPABASE_DIR")"
MIGRATIONS_DIR="$SUPABASE_DIR/migrations"
SEED_FILE="$SUPABASE_DIR/seed.sql"
DOMAIN_FILE="$REPO_DIR/packages/shared/src/domain.ts"
PG_OS_USER="${PG_OS_USER:-postgres}"
VERBOSE="${VERBOSE:-0}"
PORT=54329

if [ -z "${PG_BIN:-}" ]; then
  if [ -x /usr/lib/postgresql/16/bin/initdb ]; then
    PG_BIN=/usr/lib/postgresql/16/bin
  elif command -v pg_config >/dev/null 2>&1; then
    PG_BIN="$(pg_config --bindir)"
  else
    echo "run.sh: Postgres binaries not found, set PG_BIN" >&2
    exit 2
  fi
fi
for tool in initdb pg_ctl psql createdb; do
  if [ ! -x "$PG_BIN/$tool" ]; then
    echo "run.sh: $PG_BIN/$tool is missing" >&2
    exit 2
  fi
done
for file in "$SEED_FILE" "$DOMAIN_FILE"; do
  if [ ! -r "$file" ]; then
    echo "run.sh: $file is missing" >&2
    exit 2
  fi
done

# Postgres refuses to run as root: as root, every Postgres command runs as PG_OS_USER.
as_pg() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "$PG_OS_USER" -- "$@"
  else
    "$@"
  fi
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/winz-pg.XXXXXX")"
DATA="$WORK/data"
LOG="$WORK/postgres.log"
SERVER_STARTED=0

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [ "$SERVER_STARTED" -eq 1 ]; then
    as_pg "$PG_BIN/pg_ctl" -D "$DATA" -m immediate -w stop >/dev/null 2>&1 \
      || echo "run.sh: could not stop the temporary server in $DATA" >&2
  fi
  cd /
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$(id -u)" -eq 0 ]; then
  chown "$PG_OS_USER" "$WORK"
fi
# The server user may not be allowed into the repository: work from the temp dir and feed every
# SQL file through stdin, which this shell opens.
cd "$WORK"

as_pg "$PG_BIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --no-sync >"$WORK/initdb.log" 2>&1 || {
  cat "$WORK/initdb.log" >&2
  echo "run.sh: initdb failed" >&2
  exit 2
}

# No TCP listener: the server is reachable only through a socket in the temp dir, so the port
# number cannot collide with another server.
as_pg "$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" -w \
  -o "-c listen_addresses='' -c unix_socket_directories='$WORK' -c port=$PORT -c fsync=off -c wal_level=logical" \
  start >/dev/null || {
  cat "$LOG" >&2
  echo "run.sh: the temporary server did not start" >&2
  exit 2
}
SERVER_STARTED=1

psql_db() {
  local db="$1"
  shift
  as_pg env PGOPTIONS="-c client_min_messages=warning" \
    "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d "$db" "$@"
}

FAILED=0
TOTAL=0

step_ok() {
  TOTAL=$((TOTAL + 1))
  if [ "$VERBOSE" = "1" ]; then
    echo "  ok   - $1"
  fi
}

step_fail() {
  TOTAL=$((TOTAL + 1))
  FAILED=$((FAILED + 1))
  echo "  FAIL - $1"
}

# apply <db> <label> <file> [psql args]: the file must run without error.
apply() {
  local db="$1" label="$2" file="$3" out
  shift 3
  if out="$(psql_db "$db" "$@" -f - <"$file" 2>&1)"; then
    step_ok "$label"
  else
    step_fail "$label"
    echo "$out" | sed 's/^/         /'
  fi
}

# The `as const` arrays of domain.ts, as rows of test.domain_enums.
domain_enums_sql() {
  awk '
    /^export const [A-Z_]+ = \[/ { name = $3; collecting = 1 }
    collecting {
      line = $0
      while (match(line, /"[^"]+"/)) {
        printf "insert into test.domain_enums (name, val) values (\047%s\047, \047%s\047);\n", \
          name, substr(line, RSTART + 1, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
      }
    }
    collecting && /\] as const/ { collecting = 0 }
  ' "$DOMAIN_FILE"
}

run_database() {
  local db="$1" flavour="$2" file name out counts

  echo "== $db ($flavour)"
  as_pg "$PG_BIN/createdb" -h "$WORK" -p "$PORT" -U postgres "$db"

  if [ "$flavour" = "supabase-like" ]; then
    psql_db "$db" -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role" \
      -c "create publication supabase_realtime"
  fi

  for file in "$MIGRATIONS_DIR"/*.sql; do
    apply "$db" "migration $(basename "$file") applies to a fresh database" "$file" --single-transaction
  done
  apply "$db" "seed.sql applies" "$SEED_FILE"
  apply "$db" "seed.sql applies a second time" "$SEED_FILE"

  apply "$db" "test harness loads" "$HERE/00_harness.sql"
  if out="$(domain_enums_sql | psql_db "$db" -f - 2>&1)"; then
    step_ok "domain.ts enums load"
  else
    step_fail "domain.ts enums load"
    echo "$out" | sed 's/^/         /'
  fi

  for file in "$HERE"/[1-9]*.sql; do
    name="$(basename "$file")"
    if [ "$name" = "60_supabase_like.sql" ] && [ "$flavour" != "supabase-like" ]; then
      continue
    fi
    apply "$db" "$name runs to the end" "$file" -c "set test.file = '$name'"
  done

  if [ "$VERBOSE" = "1" ]; then
    psql_db "$db" -At -c "select case when ok then '  ok   - ' else '  FAIL - ' end || file || ': ' || label
                          || coalesce(' (' || detail || ')', '') from test.results order by id"
  else
    psql_db "$db" -At -c "select '  FAIL - ' || file || ': ' || label || coalesce(' (' || detail || ')', '')
                          from test.results where not ok order by id"
  fi

  counts="$(psql_db "$db" -At -F ' ' -c "select count(*), count(*) filter (where not ok) from test.results")"
  TOTAL=$((TOTAL + ${counts% *}))
  FAILED=$((FAILED + ${counts#* }))
  echo "   $db: ${counts% *} SQL assertions, ${counts#* } failed"
}

psql_db postgres -c "create role anon nologin" \
  -c "create role authenticated nologin" \
  -c "create role service_role nologin bypassrls"

run_database winz_plain "plain"
run_database winz_supabase "supabase-like"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: $TOTAL assertions, 0 failed"
else
  echo "FAIL: $FAILED of $TOTAL assertions failed"
  exit 1
fi
