# The judged UI through /frontend

Read this when the profile has a `frontend` block: at planning (which templates, which mode), when an FE task is in a
wave, when the owner must answer H1, H2 or H3, when the build gate's `FRONTEND.build` fails, or when a /frontend file
is missing. The interface itself is contract/FRONTEND.md; this file says how the orchestrator uses it. SKILL.md
standing rules 5 and 14 apply.

## Mode A in one paragraph

The judged UI is built only through /frontend's task templates, inside the same plan as everything else ("mode A"):
FE-xx templates become ordinary T-ids with `template: "frontend:FE-xx"`, scheduled, merged and verified like any task,
with /frontend's own proofs (`frontend-check`). There is no generic UI template and no fallback: a UI requirement not
covered by a `frontend:FE-1x` per-group task is a validation error (P-23), and a missing /frontend stops planning with
a decision for the owner. /frontend's mode B (its own standalone run) is never used by /execution.

## Templates and their instantiation

The library is `~/.claude/skills/frontend/assets/task-templates/frontend.json`, in /frontend's format, specialised and
normalised by `exec.py plan instantiate` (contract/FRONTEND.md 2.1-2.3), with the parameters `mode` (`small` or
`full`) and `references` (`on` or `off`). FE-00 brief, FE-01 the owner confirms the reference URLs (manual), FE-02
reference captures and the pattern ledger, FE-03 directions board, FE-04 direction (H1, decision), FE-05 logo board,
FE-06 logo (H2, decision), FE-07 tokens, FE-08 and FE-09 the shell, FE-1x one section per feature group, FE-20 the
critique gate, FE-21 the sign-off (H3, manual, deliverable). Dependency rules, all resolved at instantiation:
- FE-03 after FE-02 when `references` is on, after FE-00 when it is off;
- FE-07 always after FE-06;
- FE-05 after the project-name decision (`@project-name`) while the name is not owner-confirmed;
- each FE-1x after its feature's own build tasks (`@feature-tasks`: the tasks whose `covers` intersect the group;
  none is an error, except a group whose ui requirements are all `planned`, which renders the planned labels);
- with a serial stack, each section after the previous one;
- FE-20 after every section (`@all-instances:FE-10`);
- FE-21 after the harden review and the fix gate, and before any recording task.

## The profile block and the shared files

- `profile.frontend` (validated against /frontend's own `profile-frontend.schema.json`): mode, stack, UI root,
  preview port, references, customers with official URLs. The top-level `prework` of the profile is authoritative.
- **The feature catalogue** `[{id, group, title, priority, status_expected?}]` is generated from plan.json by
  `exec.py catalogue` (and by every plan change); /frontend renders each id as `data-feature="<id>"`.
- **The never-show file** (`profile.paths.never_show`, outside every repository, /frontend's format) is shared by both
  skills; `exec.py merge` scans every landed diff and message against it and never prints a hit. Both skills match it
  the same way: a literal entry with `case_sensitive` false is compared after folding the entry and the text NFKC then
  lower-case, never casefold (full-width `Ｈａｒｂｏｒ` matches `harbor`; `straße` does not match `STRASSE`), and a
  regex entry with `case_sensitive` false gets the ignore-case flag. So what /frontend's checker flags,
  `exec.py merge` flags too, and the other way round.
- **The claims ledger** (`profile.phase_b.claims_ledger`) feeds the figures /frontend shows; rows are verified by
  EX-HB-CLAIMS-VERIFY before FE-20.
- **Captures** go under `workspace.private_dir`, never into the product repository.
- /frontend's state lives at `<state>/frontend/`; the only file the orchestrator writes there is `choices.json`, from
  `frontend_choice` data (`references/manual-tasks.md`).

## Proofs and gates

Every FE instance's proof is the template's own command after substitution: the stack's build chained with
`node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates <list> --features <FR ids> --profile <abs
profile> --root <dir> --state <state>/frontend` and `--serve <dir>` or `--start "<cmd>" --url <url>`. The checker never
builds, exits 1 when any requested gate is skipped (skipped is open), and has an `--allow-skip` flag that no plan may
use (P-12). Every UI proof holds the `browser` resource. The build gate adds `FRONTEND.build`: the same checker, run
by the completion check and by `exec.py harden-ready` (H14) on a fresh clone, with the phase `profile.frontend.mode`
picks: `--phase small` in small mode (render, a11y, coverage, firstview, tells and ip) and `--phase build` in full mode
(the full build phase would fail a small-mode UI on its brand gates). A missing checker is `fail`, never
skipped-as-ok.

## Fragments and agents

/frontend's multi-agent steps are wave fragments it ships as plain JavaScript: `feDirections`
(`~/.claude/skills/frontend/assets/wave-fragments/directions.js`) and `feCritique` (`critique.js`). `exec.py wave emit`
inlines them verbatim (with their sha256 in the manifest), so /execution never re-implements /frontend's rounds,
acceptance rule or revert-to-best logic. Inside a fragment, agents run through the wave's tracked `agent` wrapper: a
`null` there counts as a rerun. /frontend's agents `frontend-critic` and `frontend-probe` are read-only (no writes
except their inbox, no git writes, no `exec.py`), opus/high, every connector disallowed; they are installed by
/frontend (`exec.py agents status` reports them, never installs them). Fragment runners and designers are
`execution-implementer` agents with explicit model and effort.

## When /frontend is missing

`exec.py preflight` (PF-13), `exec.py validate` (P-23), `exec.py plan instantiate` and `exec.py wave emit` refuse
with `E_DEPENDENCY_MISSING` when the library, the profile schema, the checker, a fragment or one of /frontend's agents
is absent, and open one `dependency-missing` decision for the owner with the options `wait` (« J'attends que /frontend
soit réparé ; le reste du plan continue », recommended) and `cut-ui` (a cut proposal of the UI requirements,
owner-only). There is never an option that builds a UI another way. Every task the gap does not touch keeps running.
/frontend's own installer is the fix for its agents; the owner runs it.
