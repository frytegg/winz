# Two developers

Read this when `profile.team.devs` names a second developer: at planning (ownership), on dev B's first run, when a
task waits on the other executor, when `exec.py sync` reports a conflict, or when dev B works without Claude Code. The
contract is contract/TWO-DEV.md; this file is the orchestrator's playbook. SKILL.md standing rules 2, 5 and 9 apply.

## Static ownership

Every task and every lane glob has exactly one executor, A or B, fixed at approval; each orchestrator launches,
posts and verifies only its own tasks (its waves use its own id range: A W01-W499, B W500-W999; decisions D-001 to
D-499 for A, D-500 to D-999 for B). A task owned by a human-only developer is a manual task executed by A. Moving a
task to the other executor is an amendment (a decision of kind amendment, then `exec.py amend --decision <D> --patch
<file>` with a `reassign` entry); only the owner may reassign a silent executor's tasks that are not in flight.

## The state repository between two machines

One private state repository, cloned at `<repo>/.execution/` on both machines. Each executor writes its own paths:
`status/A.json` or `status/B.json`, its waves, briefs, reports and receipts; `decisions.md`, `events.jsonl` and
`public-values.jsonl` (the transaction hashes either side proved on chain) are appended by both and merged with
`merge=union`; plan.json, the feature catalogue and `gates.json` change only through `exec.py amend`, whose push is
the compare-and-set. `exec.py sync` commits this executor's changed paths after a secret scan (a value listed in
`public-values.jsonl` or sitting in an explorer link is not a hit; any other secret-shaped value, a `0x` + 64-hex
string included, refuses the commit with `E_SECRET_IN_STATE`, exit 4), rebases on the remote, re-validates the plan
if it changed, checks the remote is private, and pushes (never `--force`); run it after each tick's writes, and
`exec.py sync --push-only` right after `exec.py wave launched` so the other side sees in-flight tasks within minutes.
`exec.py sync --pull-only` before a tick that needs the other side's news. A rebase conflict on a file that is not
union-merged is `E_STATE_CONFLICT` (exit 1): two writers touched one file, a contract violation; stop launching and
propose a decision. A rejected amend push is retried from scratch up to 3 times (`E_CAS_REJECTED` after that). The
other executor's liveness is the committer date of its newest commit on the remote (`other_executor_last_commit_utc`
in the sync data).

## Cross-developer dependencies

A task of B that depends on a task of A becomes ready only when, after `exec.py sync --pull-only` and a fetch of the
product repository, A's receipt for that task passes the full done check on B's machine, using the tracked evidence
copies A's verifier committed with it (`proofs/runs/`, `proofs/impl/`, `proofs/merge/`): verdict pass, the landed SHA
an ancestor of origin/main in B's clone, the current proof hash, the run agreeing with the verdict, a verifier
different from the implementer, the negative control when required. A Notion checkbox, a message from dev B or a
status line without its receipt never satisfies a dependency. `exec.py schedule` lists such waits in
`waiting_on_other`, and the report shows them under « Ouvert ».

## Dev B without the setup

For an on-site recruit or a teammate who does not run Claude Code: B's work is modelled as manual tasks owned by devB
and executed by A, inside B's availability windows, holding `human:devB`. B writes code on a branch `devb/<task>`
(never on main) with the repository's commit-msg hook set by hand (`git config core.hooksPath .githooks`), and brings
back the head SHA and the branch name. An integration task (`execution:EX-DEVB-INTEGRATE`, an agent task of A in a
lane whose globs are B's area) fetches the branch, checks the reported SHA is its head, brings B's commits onto
origin/main inside its lane with B's authorship, and lands them through `exec.py merge` with every scan and gate; a
verifier re-runs the requirement's proof on the landed SHA like any task. B answers in his Notion rows when he is a
workspace member: those are A's rows with `Responsable` Dev B, so the follow-up commands of A's poll already carry
`--by devB`; run them exactly as printed (`references/tick.md`, step 3). Otherwise dev A relays with `exec.py answers
ingest --key <key> --text-file <file> --source terminal --by devB --task <T>`.

## Dev B's setup task

With `setup: full`, dev B's machine joins through `execution:EX-DEVB-SETUP` (manual, owner devB, executor A): Claude
Code at dev A's pinned version with `DISABLE_AUTOUPDATER=1`; Python ≥ 3.11, Node ≥ 20, pnpm, git and `gh`; the four
skill folders and the global guard (no-attribution and secret-read guard) with its settings entry; the GitHub
invitations to the product and state repositories; Notion membership (a member, not a guest: guests cannot connect
the Notion connector; a two-member workspace needs a paid plan); then, in his product clone, `exec.py init --project
<slug> --executor B --state-remote <state repo url>` (which also sets `core.longpaths` and the repo's commit-msg
hook path, since git config is not cloned) and `exec.py agents install`; then the launcher and `/execution`. He brings
back the state-repo commit SHA his orchestrator pushed after its first sync. The mechanical proof is
`execution:EX-DEVB-CHECK` (a gate verified by A's verifier: pinned version, agents current, the guard and the repo
hook active, Notion membership, B's events in the state repository).

B's orchestrator, on its first run: `exec.py agents status` (if not current, `exec.py agents install` and a restart
through `launch-exec.ps1 -Resume`) → `exec.py hooks install` and a background `sleep 5` → next turn `exec.py hooks
canary --nonce <nonce>` → `exec.py preflight --for event` (again with `--confirm` for checks verified by hand; PF-30
open → B types `/effort xhigh` in that session) → `exec.py notion diff --init` (stage 1 only: the token check of its
own connection on the hub) → `exec.py sync`.

## Talking across

Git and Notion are the only bus between the two orchestrators: cross-session messaging does not cross accounts. The
state repository carries plans, statuses, receipts, answers and decisions; Notion rows are write-partitioned by
executor (each orchestrator writes only its own rows and its own wave reports). An answer that reached the wrong
orchestrator (dev B replied to A's push) is stored with `exec.py answers ingest --key <key> --text-file <file>
--source terminal --by devB --task <T> --relay` and reaches its owner through the next sync; it unblocks nothing on
the wrong side.
