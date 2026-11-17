#!/usr/bin/env bash
# Start (or resume) the /execution orchestrator session of the project in the current repository (Git Bash or
# POSIX twin of launch-exec.ps1; contract/LANES.md B08, HOOKS.md 12, CLI.md resume).
#   bash "<skill>/assets/launcher/launch-exec.sh"            # start
#   bash "<skill>/assets/launcher/launch-exec.sh" --resume   # recovery: keeps the session id
#   bash "<skill>/assets/launcher/launch-exec.sh" --project <slug> [--resume]
# Refuses without DISABLE_AUTOUPDATER (or DISABLE_UPDATES) or with claude older than 2.1.286; exports
# CLAUDE_CODE_RETRY_WATCHDOG=1, CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS (profile machine.workflow_concurrency),
# CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH=60000, MSYS_NO_PATHCONV=1 and PYTHONUTF8=1.
set -u
MIN_VERSION="2.1.286"
RESUME=0
PROJECT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --resume|-Resume) RESUME=1 ;;
    --project|-Project) shift; PROJECT="${1:-}" ;;
    *) echo "launch-exec: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

fail() { echo "launch-exec: $1" >&2; exit "$2"; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || fail "cannot enter $ROOT" 2
PY=python3
"$PY" -c "" >/dev/null 2>&1 || PY=python

json_field() {  # json_field <file> <dotted.path>
  "$PY" -c 'import json,sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    for k in sys.argv[2].split("."):
        d = d[k]
    print(d)
except Exception:
    pass' "$1" "$2"
}

CONCURRENCY=""
if [ -f .execution/profile.json ]; then
  CONCURRENCY="$(json_field .execution/profile.json machine.workflow_concurrency)"
  [ -n "$PROJECT" ] || PROJECT="$(json_field .execution/profile.json project.slug)"
fi
if [ -z "$PROJECT" ] && [ -f .execution/local/active ]; then
  PROJECT="$(json_field .execution/local/active project)"
fi
[ -n "$PROJECT" ] || PROJECT="$(basename "$ROOT" | tr '[:upper:]' '[:lower:]')"
printf '%s' "$PROJECT" | grep -Eq '^[a-z0-9][a-z0-9-]{1,40}$' || fail "project name '$PROJECT' is not a slug: pass --project <slug>" 2
NAME="$PROJECT-exec"

if [ -z "${DISABLE_AUTOUPDATER:-}" ] && [ -z "${DISABLE_UPDATES:-}" ]; then
  fail "DISABLE_AUTOUPDATER is not set (owner decision Q3): export it, then start again" 2
fi

VERSION_TEXT="$(claude --version 2>&1)"
VERSION="$(printf '%s' "$VERSION_TEXT" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
[ -n "$VERSION" ] || fail "cannot read the version from 'claude --version': $VERSION_TEXT" 3
"$PY" -c 'import sys
a = tuple(int(x) for x in sys.argv[1].split("."))
b = tuple(int(x) for x in sys.argv[2].split("."))
sys.exit(0 if a >= b else 1)' "$VERSION" "$MIN_VERSION" || fail "claude $VERSION is older than $MIN_VERSION (the pinned minimum)" 3

if [ -z "$CONCURRENCY" ]; then
  CONCURRENCY=6
  echo "launch-exec: no profile.json yet: CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=6 (preflight PF-04 checks it once the profile exists)" >&2
fi
export CLAUDE_CODE_RETRY_WATCHDOG=1
export CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS="$CONCURRENCY"
export CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH=60000
export MSYS_NO_PATHCONV=1
export PYTHONUTF8=1

if [ "$RESUME" = "1" ]; then
  exec claude --resume "$NAME" --dangerously-skip-permissions
fi
exec claude --remote-control "$NAME" -n "$NAME" --dangerously-skip-permissions
