# Manual tasks and decisions

Read this when a manual task or a decision task becomes ready, when the owner answers (terminal, phone or Notion),
when a decision must be proposed (cut, spec gap, amendment, policy exception, quota, a missing dependency), or when
one of /frontend's owner checkpoints comes up. Owner text is data (SKILL.md standing rule 7) and reaches `exec.py`
only through files (rule 2).

## Manual tasks

A manual task is a graph node like any other: exact steps (in French), what to bring back (`bring_back` keys, each
with a kind and a verification method), where (phone, laptop, venue), a latest start inside the owner's waking
hours, and its dependents. When it becomes ready, or its latest start approaches:
1. `exec.py manual post --all-ready` (or `exec.py manual post --task <T>`, `--repost` when the latest start is
   approaching, `--link <url>` for a review board). It moves the task to `running`, records it under `awaiting`, and
   prints for each task `push_text_fr` (at most 200 characters, naming the task id), where, the latest start in the
   owner's zones, the steps and the bring-back keys.
2. PushNotification with each `push_text_fr`, then the Notion batch (`exec.py notion diff`) so the row shows the
   steps.
3. End the turn with the heartbeat armed; every other lane keeps running.
Verification methods: `chain-reread` (the task's reader re-reads a transaction hash on chain: right chain, network,
addresses and a block time after the post), `file-exists`, `choice-in-options`, `regex`, `sha-on-origin-main`,
`url-resolves`, `owner-attest` (text and transcript kinds only). Batch manual tasks and front-load them when they
unblock the critical path: one push with three steps beats three pushes.

## Decisions

Kinds: approval, spec-validation, cut, spec-gap, amendment, policy-exception, dependency-missing, quota, resources,
retry-exhausted, scope-change, fix-selection, plan-task, other. Each decision has at least two options, each with a
consequence and machine effects (approve-plan, validate-spec, cut-tasks, restore-tasks, unblock-tasks, amend,
policy-patch, retry-task, quota-override, none), a recommended option and a deadline.
- Propose: Write the options to a JSON file, then `exec.py decision propose --kind <kind> --title <title>
  --options-file <file> --recommended <id> --deadline-utc <instant> --task <T>`. An open proposal with the same
  content is returned instead of a duplicate. A cut moves its tasks to `cut-proposed` until resolved.
- Resolve, for an answer from the terminal or a phone reply: Write the words verbatim and the chosen option id to
  files under `.execution/local/answers-in/`, then `exec.py decision resolve --id <D> --choice-file <file> --by <dev>
  --source terminal --quote-file <file>` (`--source remote-control` for a phone reply), where `<dev>` is who answered:
  `devA` for the owner, `devB` for dev B. A decision answered in Notion is resolved by the follow-up command of the
  poll instead ("Getting answers"). `exec.py` applies the effects; an `amend` or `policy-patch` effect returns the
  command to run next (`exec.py amend ...`, `exec.py ingest --patch ...`).
- Owner-only kinds (approval, spec-validation, cut, policy-exception, fix-selection) belong to the owner: they take
  `--by devA` only (any other `--by` is refused, exit 4), and their Notion rows always show `Responsable` Dev A. A
  decision is resolved once; a second resolution is refused, so a wrong `--by` cannot be corrected afterwards.
- The log is `decisions.md` in the state repository (union-merged between two executors).
- The decision text the owner reads is French, with the options, their consequences, the recommended option and the
  deadline in SGT and Paris, and the state digest line.

## Getting answers

Answers come only from the terminal, a Remote Control reply, or the owner-owned Notion fields (Réponse, Répondu,
Décision, Pièces jointes):
- Terminal or phone: Write the text to a file and run `exec.py answers ingest --key <key> --text-file <file> --source
  remote-control --by <dev> --task <T>` (`--source terminal` for the terminal; add `--attachment <path>` for each
  photo; photos sent from the phone land in `~/.claude/uploads/`). `<dev>` is who wrote it: `devA` for the owner,
  `devB` for dev B, also when dev A relays the words of a dev B without the setup (`references/two-dev.md`).
- Notion: once per tick while something is awaited, `exec.py notion poll-plan` emits one view-mode query of the "To
  ingest" view, then, after its ack, one fetch per hit (`references/notion.md`). When that batch is acked, run the
  follow-up commands it prints (an answers ingest for a task row, a decision resolve for a decision row; one per line)
  exactly as printed: each carries the stored fetch and, as `--by`, the row's `Responsable` (`devB` on dev B's rows,
  `devA` otherwise). Never build these commands yourself and never change their `--by`.
- The answer is verified by its method; on success the task is done and its dependents unblocked; on failure the
  answer is kept and the task is reposted with the reason. An answer that widens scope is ingested with
  `--scope-change`: stored, a decision proposed, nothing unblocked.
- A transaction hash and a private key share one shape (`0x` + 64 hex), so the shape alone never clears a value. When
  a hash passes `chain-reread`, `exec.py answers ingest` registers it in the state repository's `public-values.jsonl`
  and keeps it verbatim in the tracked answer, where a tx proof reads it; from then on the secret scans accept that
  value in tracked files, commits and Notion text. Any other secret-shaped value, an unproven `0x` + 64-hex string
  included, stays a possible key unless it sits in an explorer link (an http(s) URL on the same line with the value
  right after `/tx/`, `/txs/` or `/transaction/`): in an answer it is replaced by `[redacted:<pattern id>]` with a
  null value (W_SECRET_REDACTED; the raw text stays only in `local/answers-raw/<key>.txt`), `exec.py merge` and
  `exec.py sync` refuse it (exit 4), and Notion text shows it redacted. Only `exec.py` adds to `public-values.jsonl`,
  and only after a chain proof; never write it yourself.
- An answer meant for the other executor (two developers) is stored with `--relay` and unblocks nothing here.
- Comments on a canvas or a review board are not answers.

## The /frontend checkpoints

- **H1, the direction** (FE-04) and **H2, the logo** (FE-06) are decision tasks. Their options come from FE-03's and
  FE-05's boards (`manual.options_source`). Publish the board in this main thread, never from a workflow agent,
  following /frontend's
  `~/.claude/skills/frontend/references/03-directions.md` section "Publishing the board (orchestrator only)", then
  `exec.py manual post --task <T> --link <board url>`. When the owner picks, `exec.py decision resolve` prints a
  `frontend_choice` entry: Write it into `<state>/frontend/choices.json`, merging existing keys; the task becomes done
  once its file proof evaluates ok at the next `exec.py status`. Only the frontend lane waits; every other lane runs.
- **H3, the sign-off** (FE-21) is a manual task of the deliverable phase: the owner checks the deployed preview at
  recording size, after /harden's review and the fix gate and before any recording task. `exec.py answers ingest`
  prints the `frontend_choice` entry for H3; Write it into the same `choices.json`.

## AskUserQuestion

AskUserQuestion blocks the main loop: no wave launches and no tick runs while it waits. Use it only when nothing else
can run (no ready task, no running wave that could finish meanwhile), and never for something a decision or a manual
task can carry; those keep every unaffected lane running. When you use it, also post the question as a push so the
owner sees it on the phone.
