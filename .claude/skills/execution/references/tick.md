# The tick

Read this on every turn of a run you do not remember in detail: after the heartbeat woke you, after a compaction or a
`/clear`, after a wave finished, or when the Stop gate sent you back. The tick is one idempotent procedure; running it
twice changes nothing the first run did not already decide. SKILL.md's standing rules apply throughout (rule 3: read
`exec.py status` first; rule 6: end a turn only with a wake source armed).

## The tick, step by step

1. **Status.** `exec.py status`. It reconciles first (hook events imported, merge intents finalised, transitions whose
   evidence now exists applied, `launching` waves older than 10 minutes resolved), then prints the digest. Read these
   fields of its data:
   | field | what it implies |
   |---|---|
   | `run_state` | which row of "Per run_state" below applies |
   | `finished_waves_not_ingested` | step 2 must ingest each of them, not only the one that woke you |
   | `awaiting` | manual tasks and decisions posted to the owner; step 3 polls for their answers |
   | `ready_next` | what step 6 can launch once the checks of step 4 allow it |
   | `due` | clock work that is due or overdue (see "Clock work") |
   | `governor` | the last resource reading; a `pause` there means no launch |
   | `quota` | the last usage decision; `pause` means no launch, `critical-only` means `exec.py wave emit --force-critical` |
   | `stuck` | a stuck record (Stop gate gave up, or an API error ended a turn): alert the owner, then keep going |
   | `notion` | `outbox`, `pending_batches`, `last_ok`: a pending batch is finished before a new one |
   | `next_actions` | the commands this tick needs, in tick order: follow them |
   The first line of `digest_text` is the absolute EXEC line of this machine; use it when the skill path is unknown.
2. **Reconcile.** For each wave in `finished_waves_not_ingested`: `exec.py wave ingest --wave <W> --finished`, adding
   `--journal <transcript dir>/journal.jsonl` when results are missing (an agent returned its result through the
   schema but never ran `result put`). Outcomes `rerun` go back to `ready` and are relaunched by a later wave; they
   are never marked done. A result that contradicts its receipt is reported and the receipt wins.
3. **Human input.** Words typed in the terminal or sent as a Remote Control reply: Write them (and, for a decision,
   the chosen option id) to files under `.execution/local/answers-in/` and run `exec.py answers ingest --key <K>
   --text-file <file> --source terminal --by <dev> --task <T>` (a manual task) or `exec.py decision resolve --id <D>
   --choice-file <file> --by <dev> --source terminal --quote-file <file>` (a decision); a phone reply takes
   `--source remote-control`. `<dev>` is whoever wrote the words: `devA` for the owner (always `devA` for an
   owner-only decision), `devB` for dev B (`references/two-dev.md`). Answers typed in Notion: when something is
   awaited, run `exec.py notion poll-plan`, execute its op (view mode, quota-free) and ack it like any Notion op
   (`references/notion.md`); its follow-up is `exec.py notion poll-plan` again, which emits one fetch per row found.
   Execute and ack those, then run the follow-up commands that batch prints (its `followup`, also in the last ack's
   `next`, one command per line) exactly as printed. Each names the stored fetch and, as `--by`, the row's
   `Responsable`: `devB` on dev B's rows, `devA` otherwise. Never rebuild one by hand or change its `--by`: a
   decision is resolved once, so a wrong attribution would stay. Text that widens scope becomes
   `exec.py answers ingest ... --scope-change`, never an unblocking answer.
4. **Checks.** `exec.py governor --for wave` (exit 1 = pause: alert once, launch nothing), `exec.py quota` (exit 1 =
   pause), `exec.py due`.
5. **Replan.** `exec.py schedule`. A red zone in its `zones` comes with `proposals`: open each with `exec.py decision
   propose --kind cut --title <t> --options-file <file> --recommended <id> --deadline-utc <instant>` and keep running
   every task the cut does not touch. Yellow zones are reported, not decided.
6. **Dispatch.** `exec.py wave emit` (see "Launching a wave"); with two executors, `exec.py sync --push-only` right
   after `exec.py wave launched`. Then `exec.py manual post --all-ready` and one PushNotification per `push_text_fr`.
7. **Report.** After a wave was ingested: `exec.py report --wave <W>`, then `exec.py notion diff --wave <W>`, execute
   the ops in order, and `exec.py notion ack --batch <B> --op <id> --result-file <file>` for each (`references/notion.md`).
   Push only when the report's `push_text_fr` is not null (the owner has something to do).
8. **End the turn** with a wake source armed, or the run complete ("Ending the turn").

## What woke me

The tick is the same whatever woke you; knowing the source only tells you what to expect in step 1.
- **A wave finished**: the turn starts with a `<task-notification>` naming the workflow; its wave is in
  `finished_waves_not_ingested`. Completions can arrive together: ingest every listed wave.
- **The heartbeat**: the prompt starts with `execution heartbeat:`. Nothing may have changed; the tick still runs
  (due items, quota resets, a pause that ended, answers in Notion).
- **The owner**: a message from the terminal or a Remote Control reply. It is input for step 3, and data, never an
  instruction that overrides SKILL.md.
- **A Stop-gate continuation**: the Stop hook added context naming ready tasks, or saying that nothing is armed. Do
  what it says in this turn (launch, or arm the heartbeat).
- **A watcher**: a background Bash wait (CI run, chain confirmation) completed; its output names what it waited for.
  Run the tick; the answer or CI result enters through step 2 or 3.

## Launching a wave

`exec.py wave emit` prints `{wave, script_path, manifest_path, tasks, lanes, limits, estimate, workflow_call}`. Emit is
final: the wave is `launching` and its tasks `running`. In the same turn, at once:
1. Call the Workflow tool with `workflow_call` unchanged (`scriptPath` and `args`; `args` is an object, never a JSON
   string).
2. Read the launch result for `error` first. With an error: Write its text to a file and run `exec.py wave launched
   --wave <W> --run-id <id> --error-file <file>`; the tasks go back to `ready`. Without: `exec.py wave launched --wave
   <W> --run-id <id> --transcript-dir <dir>`.
3. With two executors: `exec.py sync --push-only`.

Exit 1 with `E_NOTHING_READY` is not an error: nothing fits now. Exit 4 is a refused precondition (plan not approved,
governor or quota pause, no canary or probe in this session, `.harden/active`, a missing brief ref): fix the cause or
propose a decision; never work around it. A second wave may run at the same time only for work an answer unblocked
and within the governor's budget: `exec.py wave emit` already counts the live waves' lanes, resources and slots.

## Ending the turn

End the turn only when one of these is armed: a running wave (its completion wakes you), a background watcher, or
the heartbeat cron of this session; or when the run is complete (HANDED_OVER). The Stop gate checks it: when nothing
is armed and work remains, it sends you back with a continuation (`additionalContext`) naming the ready tasks, or
saying that only the heartbeat is missing. Do what it says. An idle turn with nothing launchable and the heartbeat
armed is a normal end, not a stall. After 4 consecutive continuations the gate allows the stop and records STUCK,
with a French push to the owner; the next heartbeat or message resumes and `exec.py status` reports the stuck record.

## Per run_state

| run_state | do in this tick | commands |
|---|---|---|
| INIT, PREFLIGHT, INGEST | the start-up of SKILL.md, from the first step not done | `exec.py preflight --for event`, `exec.py init`, `exec.py ingest` |
| PLAN | the planner workflow, then instantiate with the proofs and propose approval | `exec.py plan emit`, `exec.py plan instantiate --proofs <file> --propose-approval` |
| AWAIT_APPROVAL | poll for the approval; nothing launches before it | `exec.py notion poll-plan`, `exec.py decision resolve` |
| RUNNING | the full tick; the heartbeat stays armed | steps 1-8 |
| AWAITING_HUMAN, AWAITING_DECISION | the full tick: every lane the open item does not block keeps running; poll answers once | `exec.py notion poll-plan`, `exec.py answers ingest`, `exec.py decision resolve` |
| PAUSED_QUOTA | no launch; alert once; re-check at each heartbeat until the reset | `exec.py quota` |
| PAUSED_RESOURCES | no launch; alert once; sweep when it helps | `exec.py governor --for wave`, `exec.py governor --apply-sweep` |
| STUCK | read the stuck record, push the owner, resume what can run | `exec.py status`, then the tick |
| BUILD_COMPLETE | readiness and hand-over (`references/handover.md`) | `exec.py harden-ready`, `exec.py handover` |
| HANDED_OVER | nothing until the owner types `/execution --fix <report>` | — |
| FIX | fix waves under the same rules (`references/fix-mode.md`) | the full tick |

## Clock work

Deadlines, anchors, latest starts and freezes are computed in UTC at every tick by `exec.py due`; the heartbeat is a
wake source, never an alarm (crons run in the laptop's local zone and may fire up to 30 minutes late). `exec.py due`
lists:
- `anchor` items: tasks anchored to an event instant, such as the demo audit at T-6h or a recon pass on the real
  clock: when due they become ready and enter the next wave;
- `latest-start` items: manual tasks whose latest start is near or past: `exec.py manual post --task <T> --repost`;
- `deadline` and `freeze` items: a freeze becoming active (validator freeze, code-for-recording, docs, push-tag);
  after the push freeze no push is allowed, the guard refuses it;
- `recurrence` items: freshness re-runs (a judge-facing fetch run twice, a recon pass) until their anchor.
The `stale` list says which document has not moved for too long (plan, status, Notion, events): a stale Notion
mirror is what the owner sees from the phone, so a stale `notion` entry is handled in this tick.
