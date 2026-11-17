#!/usr/bin/env bash
# /execution hook launcher: run the Python hook script next to this file with a path Windows Python
# can open, fail open when the script is missing, and start Python without site (-S) for speed.
# Usage (settings or agent hooks): bash "<abs>/scripts/hooks/py.sh" <script.py> [args...]
S="$(dirname "$0")/$1"
shift
[ -f "$S" ] || exit 0
if [[ "$S" =~ ^[A-Za-z]:/ ]]; then
  :  # already a Windows path (the settings command passes C:/...): no cygpath process (latency, HOOKS.md 10.1)
elif command -v cygpath >/dev/null 2>&1; then
  S="$(cygpath -m "$S")"
elif [[ "$S" =~ ^/([a-zA-Z])/(.*)$ ]]; then
  S="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"
fi
PY=python3
"$PY" -c "" >/dev/null 2>&1 || PY=python
export PYTHONUTF8=1
exec "$PY" -S "$S" "$@"
