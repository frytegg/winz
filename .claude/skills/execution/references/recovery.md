# Recovery

Read this after anything that interrupted the run: a crash or a closed terminal, a laptop that slept, a usage limit,
an API error that ended a turn, Notion refusing the token, low disk or RAM, a session you do not recognise as the
bound one, or before a rehearsal drill. `exec.py resume` does the script half of recovery; you do the tool half
(CronList, CronCreate, watchers, Workflow). SKILL.md standing rules 3 and 6 apply.

## Playbook

| failure | recovery |
|---|---|
| terminal closed, crash | The owner restarts through `launch-exec.ps1 -Resume` (`claude --resume "<proj>-exec" --dangerously-skip-permissions` with the launcher's environment; a bare resume does not restore bypass mode) and types `/execution resume`. Run `exec.py resume` and follow its steps (below), then the tick. |
| a different session (a fresh `claude`, a second terminal) | `exec.py resume` reports R1 "different"; run `exec.py resume --takeover`, CronDelete the old session's heartbeat if that session still runs (or close it), next turn `exec.py hooks canary --nonce <new nonce>`, then CronCreate a new heartbeat from `exec.py heartbeat plan` and `exec.py heartbeat record --cron-id <id> --expr <expr>`. Until then the guard's run lease denies this session every orchestrator command except `exec.py status --digest`, `exec.py validate`, `exec.py simulate`, `exec.py hooks canary` and `exec.py resume --takeover`. |
| laptop asleep or lid closed | Preflight requires AC power and "do nothing" on lid close; any phone prompt resumes the session. Run the tick. |
| usage limit | Agents return null → reruns; the run is PAUSED_QUOTA until the reset; the heartbeat relaunches ("Usage limits"). |
| API error that ended a turn | The StopFailure hook recorded STUCK; the next heartbeat or the owner's message resumes; `exec.py status` reports and clears the record (a helper's error superseded by a later stop of the same session is dropped). |
| Notion down or token rejected | Ops go to the outbox; a push asks for `/login` at the laptop ("Notion down or token rejected"). |
| disk or RAM low | The governor lowers lanes or pauses, and alerts ("Disk and RAM"). |
| process dead while away | The Notion heartbeat goes stale, visible from the phone ("Process dead while away"). |
| local state lost or corrupt | `exec.py events replay --rebuild-state` rebuilds `local/state.json` from events, status files, manifests, receipts and decisions. |

The steps `exec.py resume` reports, each `{id, done, detail, command?}`:
- R0 environment: the retry watchdog, the concurrency cap, the MCP description length and `MSYS_NO_PATHCONV=1`; any
  missing → restart through `launch-exec.ps1 -Resume`.
- R1 session: `CLAUDE_CODE_SESSION_ID` equal to the bound id → nothing (a resume keeps the id); different →
  `exec.py resume --takeover`.
- R2 hooks entries present in the settings (else `exec.py hooks install`).
- R3 residue: a stale `.git/index.lock` with no live git process removed; ports held by dead processes listed.
- R4 workspaces: uncommitted files listed per lane and in the shared checkout, with resume notes in
  `briefs/<task>.resume.md` ("review as someone else's work").
- R5 waves not ingested, each with an action: `resumeFromRunId` (only when it was launched by this same session),
  `relaunch` (launch the same script with `args.skip`, then `exec.py wave launched --wave <W> --run-id <new>
  --relaunch`), `ingest` (`exec.py wave ingest --wave <W> --finished`), `record-launch` (`exec.py wave launched --wave
  <W> --run-id <id>`), `abandon` (tasks back to ready, never re-emitted) or `decide` (a `resources` decision).
- R6 merge intents finalised when their head is on origin/main, the others reported.
- R7 `exec.py events replay --rebuild-state`.
- R8 `exec.py status`.
- R9 Notion: every op of a pending batch without an ack is acked as crashed; a stored batch is never re-executed by
  hand (its creates go through the board map rebuild first).
- R10 heartbeat: CronList; when it is absent, CronCreate from `exec.py heartbeat plan`, then `exec.py heartbeat record
  --cron-id <id> --expr <expr>`.
Re-arm any background watcher the crash killed (CI or chain waits: one background Bash `until ...; do sleep 30;
done` per wait).

## Usage limits

At a usage limit, workflow agents return null (with Remote Control connected they fail instead of waiting): every
null is a rerun, never done, and attempts are not counted. Limit evidence (a `rate_limit` stop, the five-hour window
at 100 %, or a null storm where every agent of a wave returned null or threw) makes `exec.py quota` pause until the
five-hour reset; the heartbeat wakes the session after the reset and the tick relaunches: a wave interrupted mid-way is
relaunched with the same script and `args.skip`, and rerun agents return what was already recorded. Auto-continue
never arms while Remote Control is connected, so the heartbeat is the recovery path. Above about 85 % of the five-hour
window only critical-path tasks launch (`exec.py wave emit --force-critical`); when the weekly window cannot cover the
plan's P80, `exec.py quota` opens a `quota` decision (`extra-usage`, `critical-only`, `wait`) for the owner.

## Notion down or token rejected

Notion is a mirror, never the source of truth: a failed op is acked with `exec.py notion ack --batch <B> --op <id>
--failed --error-file <file>` and goes to the outbox; the run continues. The next batch starts with a token check (one
real read) before replaying the outbox, because a phone `/mcp reconnect` can report success while the token is still
rejected. A repeated auth failure puts a push in the ack's `next`: the owner must run `/login` at the laptop. Rate
limits: `--error-code deferred:rate_limited` with `--retry-after <seconds>`. Details in `references/notion.md`.

## Disk and RAM

`exec.py governor --for wave` reads disk, RAM, commit charge, AC power and the network with PowerShell, and decides
the lanes, verifiers, browser slots and the workspace mode, or a pause (disk or RAM under the floor, no AC, no
network, `.harden/active`). A pause is alerted once and re-checked at each heartbeat. `exec.py governor
--apply-sweep` kills orphan processes of this project's scratch and worktrees whose parent is dead, deletes the
scratch of done tasks and removes merged worktrees link-safely (junctions first); without `--apply-sweep` the sweep
is only listed. `exec.py merge` and `exec.py proof run` read the governor themselves and stop with exit 3 (a rerun)
below the floors.

## Process dead while away

If the orchestrator process dies while the owner is away, nothing wakes it (the heartbeat cron dies with the
session). The Notion hub shows the last tick time; when it goes stale the owner can see it from the phone. Restart
options: at the laptop through `launch-exec.ps1 -Resume`; or from the phone through a server-mode session started in
a second terminal, which then takes over (`exec.py resume --takeover`).

## Rehearsal drills

Run on the Queue Clock fixture (`exec.py fixture new --dest <dest>`), never on event content. After each drill, check
with `exec.py status` that no task is done without a receipt, no wave was launched twice, the heartbeat is armed, and
the Stop gate never ended a turn with the plan open and nothing armed.
- **Forced `/compact`**: the SessionStart context prints the digest and the EXEC line; the next turn reads
  `exec.py status` first and continues.
- **Terminal kill and resume mid-wave**: restart through `launch-exec.ps1 -Resume`, `/execution resume`; the wave is
  classified (same session → `resumeFromRunId`, else relaunch with `args.skip`); landed tasks are not redone.
- **`/clear` with a wave running**: SessionEnd arms a re-key and SessionStart re-keys the binding to the new session
  id; its context names `exec.py resume`; the wave is classified against the new id (relaunch, not
  `resumeFromRunId`).
- **A fresh session taking over**: start another session in the repo; the run lease denies it orchestrator commands
  until `exec.py resume --takeover`, then the canary binds it.
- Capture the real Stop, StopFailure and PreToolUse payloads, the probe's session-id measurement, and
  `CLAUDE_CODE_SESSION_ID` as the orchestrator's own Bash tool sees it (`evals/REHEARSAL.md` lists the steps).
