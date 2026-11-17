# Waves

Read this before launching or ingesting a wave you have doubts about, when a task's chain behaves unexpectedly
(conflict, failed proof, null agent, rerun), or when the owner asks how work is parallelised. It explains what a wave
is, the contract wave, the per-task pipeline, the two workspace modes, nulls and relaunches, and ingestion. The
commands are in `references/tick.md` ("Launching a wave"); SKILL.md standing rules 3, 4 and 16 apply.

## A wave is a reporting epoch

A wave is one Workflow run over a subset of the ready graph; it is not a barrier. Inside it every task starts as
soon as its own in-wave dependencies resolved `done`: the script awaits each dependency's promise, and a dependency
that ended otherwise makes the dependent `skipped-dep` (back to `planned`, no rerun counted). Waiting tasks are served
from a priority queue (least slack, then longest remaining path, then successors, then id) under semaphores sized by
the governor: writers, verifiers, integrators, browser slots, one slot per unary resource (manifest, wallet, port,
database, human, disk-heavy) and one writing agent per lane at a time. Two tasks overlap only if no path joins them,
their writes are disjoint and they share no unary resource; `exec.py wave emit` computes it against this wave and
every live wave not yet ingested. A wave ends when its task set is exhausted or blocked; workflows take no mid-run
input, so manual tasks and decisions always sit between waves. A second concurrent wave is allowed for work an answer
unblocked, within the governor's total budget. Every fact the orchestrator acts on is re-read from files by `exec.py
wave ingest`; the script's return value `{wave, outcomes}` is only a hint.

## Wave 0, the contract wave

The first wave is serial and lays the ground every lane builds on:
- repo bootstrap (EX-BOOT): `.gitattributes` with `eol=lf`, the `main` branch, `core.longpaths`, the portable
  commit-msg hook that refuses AI trailers and non-conventional headers (so dev B's machine is covered too);
- one install by one agent, the package manifest and lockfile (the `manifest` resource);
- public types, schemas, ABIs and the env schema; hub files;
- the ownership map from globs to lanes;
- the acceptance checks, written by the test-designer and seen failing first;
- the offline-gates CI workflow (EX-CI), no secrets, which doubles as /harden's evidence;
- `gates.json`, the merge gate config the contract wave's test-designer writes to its inbox (`gates_config`), which
  enters the state through `exec.py amend` (patch `gates_json`). Until it exists, only setup and contract tasks can
  merge (`E_NO_GATES` otherwise).

## Per task: implement, merge, verify, fix

Each task runs a chain written in the manifest (`[implementer, verifier]` for most, `[verifier]` for gate tasks and
for built tasks whose verifier died, fragment steps for /frontend critique tasks). Every agent gets one prompt: "Read
your brief at <path> and follow it exactly." The brief (`briefs/<task>.a<attempt>.md`) names every `brief_refs`
path, the writes, the protected globs, the proof, the acceptance criteria, the inbox path, the exact `exec.py result
put` and `exec.py merge` commands with explicit `--repo` and `--state`, the "Already recorded" result paths of every
wave, and the standing rules.
1. **Implement**: `execution-implementer` builds the task inside its writes, runs the proof itself (never evidence),
   commits with `git commit -F` (worktrees mode) and ends by running `exec.py merge --task <T> --attempt <n> --wave
   <W> --rerun <k>` with `--worktree <dir> --branch <b>` or `--single-tree --message-file <file>`, at most twice per
   run.
2. **Merge** (deterministic, under the merge lock): fetch, build the candidate on origin/main, the scans
   (writes-scope, protected, trailers, conventional header, never-show, secrets, test-integrity, judge-facing deferral markers,
   push freeze, each with its positive control), the offline gates through /harden's `gates.py`, the task's own proof
   on the same tree, then `git push origin <C>:refs/heads/main` (a non-fast-forward rejection loops, at most 3 times).
   Exit 0 landed, 1 conflict or gate or scan failure, 3 environment or budget (a rerun), 4 a policy refusal. The
   secrets scan cannot tell a transaction hash from a private key (both are `0x` + 64 hex), so such a value passes
   only when the state repository's `public-values.jsonl` lists it, which `exec.py` does only after the chain proved
   it a transaction (`references/manual-tasks.md`), or when it sits in an explorer link (an http(s) URL on the same
   line with the value right after `/tx/`, `/txs/` or `/transaction/`); every other secret-shaped value is a policy
   refusal.
3. **Verify**: `execution-verifier`, fresh context and no CLAUDE.md, checks the landed SHA is on origin/main, re-runs
   the proof with `exec.py proof run --task <T> --sha <landed> --keep --by verifier` (and `--negative-control` when
   required and not yet recorded), judges the diff against each acceptance criterion, scans for stubs and weakened
   tests, then writes the receipt with `exec.py proof verdict --task <T> --run <run id> --verdict pass --findings
   <file> --attempt <n> --model opus --effort high` (or `--verdict fail`). `exec.py` refuses a pass on a failed run,
   on a SHA not on origin/main, on a stale proof hash or without the guard's attestation of the verifier. A tx proof
   whose reader confirmed the transaction registers its hash in `public-values.jsonl`; a forged control hash is
   never registered and reaches tracked files only as its sha256.
4. **Fix** (bounded): on a fail, the prepared in-wave fix attempt starts a fresh implementer whose brief carries the
   verifier's findings; it may rebut a finding with evidence the next verifier re-runs. After `max_attempts` (default
   2) the task goes `blocked-decision` with a `retry-exhausted` decision ("relances épuisées": retry with a stated
   change, amend, cut). The engine keeps running everything else.
Done is only ever set by `exec.py` from the receipt (contract/SCHEMAS.md 4.3).

## Workspaces

The governor (`exec.py governor --for wave`) picks the mode per wave from measured free disk:
- **worktrees**: one Claude-managed worktree per lane (not per task) under `.claude/worktrees/`, pnpm projects only
  (hard links keep a lane near 0.1 GB), and only when free disk is at least the floor plus three lane footprints. The
  lane worktree is removed link-safely when the lane has no further task in the wave.
- **single-tree**: file-disjoint agents in the shared checkout, never a commit there: `exec.py merge --single-tree
  --message-file <file>` builds the commit from the task's write paths through a temporary index and runs the gates
  in an integration worktree; the shared checkout is never rebased, reset or stashed. `exec.py wave ingest`
  re-syncs it between waves. Default when disk is tight or the stack is npm or yarn.
After each wave, `exec.py governor --apply-sweep` removes orphan processes, per-task scratch of done tasks and merged
worktrees (junctions first).

## Nulls, usage limits and relaunches

- An agent that returns `null` (it died, or hit a usage limit while Remote Control is connected) is a **rerun**:
  `reruns + 1`, attempts unchanged, the task back to `ready`. Never done.
- An agent call that **throws** (unknown agent type, unsatisfiable schema, spent budget) is `infra-error`: the task
  goes `blocked-decision` with a `dependency-missing` decision, never an endless rerun.
- An `exec.py` exit 3 inside an agent (time budget, lock timeout, environment, missing attestation) is a rerun too;
  agents never retry it in the same run.
- Three consecutive reruns without usage-limit evidence → `retry-exhausted` decision. With evidence (a rate-limit
  stop, the five-hour window near 100 %, a null storm where every agent of a wave returned null), the run is
  PAUSED_QUOTA until the reset and the heartbeat relaunches afterwards.
- **Relaunch** after a stop: the same script with `args.skip` = the tasks proven since emission, recorded with
  `exec.py wave launched --wave <W> --run-id <new> --relaunch`. `resumeFromRunId` only in the session that launched
  the wave (`exec.py resume` classifies each wave). Rerun agents read the "Already recorded" results and return them,
  and `exec.py merge` refuses a second landing (`E_ALREADY_LANDED`), so relaunching never redoes landed work.

## Ingesting

`exec.py wave ingest --wave <W> --finished` (add `--journal <file>` to recover results returned through the schema
but never put) reads the manifest, every result and merge receipt of the task's attempt in any wave, merge intents,
proof runs and receipts, then applies the status transitions in order (in-wave fix attempts included). A result that
contradicts its receipt is `E_RESULT_RECEIPT_MISMATCH` and the receipt wins. It appends the implementers' DX rows to
the DX journal marked `UNVERIFIED` and the verifiers' claims rows to the claims ledger with status `unverified` (the
EX-HB-CLAIMS-VERIFY gate re-runs their evidence later); each appended row carries a key, so a second ingest appends
nothing. Calibration (actual over p50 per kind, failure rate per kind, quota per agent-hour) is recomputed from all
ingested results each time. Then `exec.py report --wave <W>` and the Notion batch.
