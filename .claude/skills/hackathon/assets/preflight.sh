#!/usr/bin/env bash
#
# Bring the demonstration up, and say plainly whether it is presentable.
#
# The point is the second half. A script that only knows how to print "ok" tells you
# nothing. This one refuses to claim success when the demo would embarrass you: stale
# processes holding the port, data whose time window has expired, a machine with no memory
# left. All three happened during the event this came from.
#
# Adapt the marked sections. Keep the structure and keep the refusals.
#
# Run: bash preflight.sh
set -uo pipefail
cd "$(dirname "$0")"

# ---- adapt these ------------------------------------------------------------
PROJECT="Project"
API_PORT=8787
WEB_PORT=5173
API_START='node src/index.mjs'          # the long-running backend, if any
WEB_START='npm run dev'                 # the frontend dev server, if any
HEALTH="http://localhost:${API_PORT}/api/health"
READY_CHECK=''                          # optional: a command that exits 2 if the demo
                                        # data is stale. See "judging the demo state".
MEM_FLOOR_GB=2.5
# -----------------------------------------------------------------------------

GREEN=$'\033[32m'; RED=$'\033[31m'; AMBER=$'\033[33m'; OFF=$'\033[0m'
ok()   { echo "  ${GREEN}ok${OFF}    $*"; }
warn() { echo "  ${AMBER}note${OFF}  $*"; }
bad()  { echo "  ${RED}STOP${OFF}  $*"; }

echo ""
echo "  ${PROJECT}, bringing the demonstration up"
echo ""

# --- memory ------------------------------------------------------------------
# The backend is the newest process, so it is first in line when the system reclaims.
# Measure your own floor: ours died three times under 1 GB free.
FREE=""
if command -v powershell >/dev/null 2>&1; then
  FREE=$(powershell -NoProfile -Command \
    '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)' \
    2>/dev/null | tr -d '\r')
elif command -v free >/dev/null 2>&1; then
  FREE=$(free -g | awk '/^Mem:/{print $7}')
fi
if [ -n "$FREE" ]; then
  if awk "BEGIN{exit !($FREE < $MEM_FLOOR_GB)}"; then
    warn "only ${FREE} GB of memory free, floor is ${MEM_FLOOR_GB}."
    warn "Close the second browser, the chat client and the VPN, or reboot, before you present."
  else
    ok "${FREE} GB memory free"
  fi
fi

# --- stale processes ---------------------------------------------------------
# A server from an earlier run holds the port and the new one dies on a bind error,
# which reads as "the code is broken" rather than "something else is listening".
STALE=$(pgrep -f "$API_START" 2>/dev/null | wc -l | tr -d ' ')
if [ "${STALE:-0}" -gt 0 ]; then
  pkill -f "$API_START" 2>/dev/null
  ok "stopped ${STALE} process(es) left over from an earlier run"
  sleep 2
fi

# --- backend -----------------------------------------------------------------
if [ -n "$API_START" ]; then
  echo ""
  echo "  starting the backend"
  nohup $API_START > .preflight-api.log 2>&1 &
  for _ in $(seq 1 40); do
    curl -s -m 2 -o /dev/null "$HEALTH" 2>/dev/null && break
    sleep 2
  done
  if ! curl -s -m 3 -o /dev/null "$HEALTH" 2>/dev/null; then
    bad "the backend did not come up. Last lines:"
    tail -12 .preflight-api.log | sed 's/^/        /'
    exit 1
  fi
  ok "backend on :${API_PORT}"
fi

# --- judging the demo state --------------------------------------------------
# THIS IS THE PART THAT MATTERS. Write a check that knows what "presentable" means for
# your demo, and let it fail. Ours refused when a facility's time window had expired,
# because an expired window serves negative countdowns that look like a bug on stage.
#
# Exit 2 from READY_CHECK means "up, but do not present this".
DEMO_STATE=0
if [ -n "$READY_CHECK" ]; then
  echo ""
  $READY_CHECK
  DEMO_STATE=$?
fi

# --- frontend ----------------------------------------------------------------
if [ -n "$WEB_START" ]; then
  echo ""
  echo "  starting the interface"
  ( nohup $WEB_START > .preflight-web.log 2>&1 & )
  for _ in $(seq 1 30); do
    curl -s -m 2 -o /dev/null "http://localhost:${WEB_PORT}/" 2>/dev/null && break
    sleep 2
  done
  if curl -s -m 3 -o /dev/null "http://localhost:${WEB_PORT}/" 2>/dev/null; then
    ok "interface on :${WEB_PORT}"
  else
    bad "the interface did not come up. Last lines:"
    tail -10 .preflight-web.log | sed 's/^/        /'
  fi
fi

echo ""
echo "  ------------------------------------------------------------"
echo "  interface      http://localhost:${WEB_PORT}"
echo "  deck           deck/index.html"
echo "  run of show    docs/runsheet.md"
echo "  hard questions docs/hard-questions.md"
echo ""
[ "$DEMO_STATE" -eq 2 ] && echo "  ${RED}The demo data needs refreshing before you present. See above.${OFF}" && echo ""
exit 0
