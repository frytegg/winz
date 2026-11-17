# Fix mode

Read this when the owner types `/execution --fix <harden-report.md>`: after /harden ran on the handed-over tree and
the owner reviewed and merged its branch. It covers entering fix mode, parsing /harden's report, the owner's
selection, and running the fix tasks up to the deliverables. The contract is contract/FIX-MODE.md. SKILL.md standing
rules 5 and 11 apply: /execution never runs /harden and never chooses fixes for the owner.

## When

After the hand-over, the owner typed `/harden`; /harden worked on its own branch and wrote its report. /harden never
merges or pushes, so the review and merge of its branch is a manual task of the owner (`execution:EX-HARDEN-REVIEW`).
Fix mode starts only after that merge:
1. Start like a resumed run: the launcher, `exec.py hooks install` (which also sets this session to effort `xhigh`),
   then before ending the turn the heartbeat (`exec.py heartbeat plan`, CronCreate, `exec.py heartbeat record
   --cron-id <id> --expr <expr>`) and a background `sleep 5`; next turn `exec.py hooks canary --nonce <nonce>`. The
   run goes HANDED_OVER → FIX.
2. Record the review: Write the merge SHA (from the owner's message, or `git log -1 --format=%H origin/main` shown to
   him for confirmation) to a file, then `exec.py answers ingest --task <EX-HARDEN-REVIEW id> --key <id>-merge
   --text-file <file> --source terminal --by devA`. It is verified as a SHA on origin/main; EX-HARDEN-REVIEW is done.
`exec.py fix` refuses (exit 4) while the plan is not approved, `.harden/active` exists (/harden still running), the
report's head SHA is not on origin/main (`E_NOT_ON_MAIN`: merge the harden branch first), or EX-HARDEN-REVIEW is not
done.

## Parsing the report

`exec.py fix --report <path> --list` parses /harden's report into items, from its three selectable sections: "Applied,
review before merge", "Needs your decision" and "Open owner items" ("Not fixed or deferred" is context, never
selectable). Each item has an id, its section, a title, file and line when given, a severity and the actions it
allows. An unknown structure is `E_REPORT_FORMAT` (exit 1, with the line): stop and tell the owner in French what
could not be read; never guess the items. `--list` also writes the selection options for the next step.

## Selection

Show the owner the French summary (items by section, the blocking ones first), then post EX-FIX-SELECT with `exec.py
manual post --task <EX-FIX-SELECT id>`, which opens the linked `fix-selection` decision (owner-only) with the options
`none` (« Aucun correctif »), `blocking`, `recommended` and `custom` (« Ma sélection »: the owner writes ids and
actions, e.g. `T2:H-007, REV:H-003=revert, OWN:2=set:30s`). Wait for the owner. A Notion « Décision » comes in
through the tick's poll: run the follow-up command its batch prints, exactly as printed (`references/tick.md`, step
3). A reply in the terminal or by Remote Control: Write the owner's words and the option id to files under
`.execution/local/answers-in/`, then `exec.py decision resolve --id <D> --choice-file <file> --by devA --source
terminal --quote-file <file>` (`--source remote-control` for a phone reply; fix-selection is owner-only: always
`--by devA`). Then:
- `exec.py fix --report <path> --select <ids> --decision <D>`, or `--select-file <file>` (a JSON list of `{id, action,
  value}`) when a value holds a comma or a new line, with `--reason-unselected-file <file>` for the owner's reasons;
- for `none`, nothing more: the regression gate becomes ready.
The selected items become fix tasks through an amendment; every item not selected is recorded in `decisions.md` with
its reason. Never add an item the owner did not select.

## Running fixes

The fix tasks (phase fix: EX-FIX-CODE with a test-designer step, an implementer and a verifier; EX-FIX-REVERT with an
implementer and a verifier) run as ordinary waves under every rule: `exec.py schedule`, `exec.py wave emit`, merge
scans and gates, independent verifiers, at most 2 attempts then a `retry-exhausted` decision, quota and governor.
After them the amendment has placed:
1. EX-REPLAY: every done task's proof replayed on the new HEAD of a fresh clone (H13);
2. EX-CONVERGE: a convergence pass for the new HEAD;
3. a new EX-FIX-GATE, the regression gate: the completion check with `--phase build,harden`. Before emitting the wave
   that holds it, run `exec.py harden-ready` (the after-harden profile applies by itself in FIX) and `exec.py
   completion generate` (so the `FIX.<task>` gates list the new fix tasks);
4. the deliverable tail, re-added after the new gate: FE-21 first (the owner's sign-off, H3), the recording, /prose
   (EX-DLV-PROSE, the owner types it), slides, Drive, form, flip, tag, README screenshots last.
When every deliverable task is terminal and `exec.py completion run --phase all` exits 0, run `exec.py handover
--final`: the final French report, the hooks removed, the run HANDED_OVER. A second /harden report, if the owner runs
/harden again, starts a second fix cycle only through an amendment he asks for.
