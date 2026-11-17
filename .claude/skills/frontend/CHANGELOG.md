# /frontend changelog

Shape changes that /execution (or any caller) must know about. /execution pins a copy of
`assets/task-templates/frontend.json`; every change to that file, to a gate id, to a CLI flag or to a shared file
format gets an entry here, and the owner relays it (sessions on different accounts cannot message each other).

## 2026-10-01, v1 (account 1, session fc5626a6)

- Contract v1: `scripts/CONTRACTS.md`; task templates FE-00 to FE-21 plus FE-09 "Brand files, favicon set and OG
  image" (added by the assets builder, depends on FE-06 and FE-08); owner tasks (FE-01, FE-04, FE-06, FE-21) use proof
  type `file` on `{state}/choices.json`; symbolic dependencies `decision:project-name` and `manual:harden-review`.
- Agreed with /execution (its contract/FRONTEND.md): exit 0 iff every requested gate is ok; `--gates` plus
  `--features`; never-show JSON format and folding rules; feature-catalogue format; `--start`; `--state`; wave
  fragments; read-only critic and probe agents; one answer channel for H1 to H3.

## 2026-10-11, v1.1 (Reconcile step of `evals/workflows/build-resume.js`)

For /execution (relay through the owner):
- `--phase small` exists: render, a11y, coverage, firstview, tells, ip (no brand, tokens or motion). `--phase full` is
  an alias of `--phase build`. FE-20's proof now ends with `--phase {mode}` (was `--phase build`): substitute `{mode}`
  as for any placeholder; FRONTEND.build and H14 pass `--phase small` in small mode as already planned.
- Q-F14 landed: with `--out <dir>`, frontend-check writes its report to `<dir>/frontend-check.json` (no longer a copy)
  and writes nothing into `<state>`: no folder created, no `gates/` report, no exclude line. Mode A with `--out` no
  longer needs `.execution/` to exist. Without `--out` the report stays `<state>/gates/<UTC>.json`.
- Q-F11 landed: `choices.schema.json` H1 and H2 accept optional `canvas_url` (https), `type_release` and `published_at`
  (UTC).
- Q-F15 landed: the critique fragment tells the fixer "Commit your changes under your own commit rules."; no fragment
  prompt names a commit message format.
- Q-F9 landed: never-show folding NFKC then `toLowerCase()` on both sides, regex entries get `i` and are tested on the
  folded text; regex entries outside the JS/Python common subset are refused by the loader (coverage.nevershow fails
  on them) and by `never-show.schema.json` (a `not` pattern; /execution's drift check will see it).
- Q-FX-5 landed: an unknown sponsor id exempts nothing and is never an error (rules/load.mjs, ip-check, slop-check).
- `task-templates.schema.json`: task effort enum capped at `high` (revision 4 of /execution's contract).
- FE-09 note: kept in small mode, gated by its own proof; FE-20's small-mode note names `--phase small`.
- Unchanged and still open for the owner: recording.g16 is skipped for a pptx or key video embed until `--deck` is
  given, so `--phase build` cannot exit 0 for such a profile before the deck exists.

Everything else is in `scripts/CONTRACTS.md`, marked v1.1 (2026-10): module CLIs (critique, board, capture, extract,
brand, qa, ip, motion, recording), finding fields `asset` and `sha256`, the waiver scope grammar, the category
allowlist source, `ctx.args`, `ctx.browser` null for file-only selections, `all` and `<group>.*`, the default phase,
the colour-pair convention of tokens.json, `firstview.complexity` in the profile, the `coverage.features` owner
waiver, and the state-folder files.

## 2026-10-12, v1.1 review fixes (code area)

For /execution (relay through the owner):
- Gate output: a gate result may carry `advisory: true` (an ok that judged nothing binding: recording g02, g04, g06,
  g08, g09, g13, and firstview.complexity until calibrated), and `counts` gains `advisory` when at least one is.
  Exit codes and `ok` are unchanged; `gate-output.schema.json` accepts both keys.
- recording.g03 now fails when no route carries `data-rec-role="key"` (it used to pass with a warning).
- `--start`: a process tree that survives the kill makes the run exit 3. `--allow-skip` must name a gate or group
  of this run (an unrelated group is a usage error, exit 2).
- Profile: optional `paths.ui` (repository-relative UI paths) narrows the static tells layer;
  `profile-frontend.schema.json` accepts it. The static layer also skips git-ignored files, nested repositories
  (submodules), virtual environments and `.yarn`.
- critique.mjs `--start-timeout` is in seconds, as in frontend-check (was milliseconds).
- slop-check: `--report`, `--ui-paths`; with `--out` the findings go under `<out>/tells/`; it no longer creates a
  state folder in a repository that has none.

## 2026-10-12, v1.1 review fixes (assets area)

For /execution (relay through the owner; re-pin `assets/task-templates/frontend.json`):
- FE-08 proof now runs `--gates render,firstview,coverage.hero` (was `render,firstview`); its negative control (an H1
  that differs from brief.hero.h1) now names `coverage.hero`, the gate that compares the hero with the brief.
- FE-05 small-mode note: three wordmark candidates and one round (was "two or three"), matching BR-09 and
  brand.candidates (3 to 5).
- `choices.schema.json` H1: `pick` also accepts `none`, which then requires a non-blank `reason` (DR-12). FE-04's
  proof still fails on `none`, so a new round of directions follows.
- brief_refs: FE-1x adds `references/15-ip-provenance.md` (BD-11, BD-12); FE-21 adds `references/12-critique.md`
  (CR-18, the H3 sign-off).
- CR-11 and FE-20's description name the existing `no-issue-kept` stop (no issue survives consolidation).

## 2026-10-12, v1.1 review fixes

For /execution and any other caller (relay through the owner). One list of everything visible from outside, the
detectors area included; the two entries above give the code and assets details. `scripts/CONTRACTS.md` marks each
point "review fix 2026-10-12".
- Advisory oks: a gate that judged nothing binding is `ok` with `advisory: true`, and `counts.advisory` (present only
  when some are) counts them; they stay in `counts.ok`, and `ok` and exit codes are unchanged. Emitted by
  tells.tier1 and tells.tier2 while the registry has no rule of their tier, tells.score while
  `profile.tells.score_max` is null, firstview.complexity until its band is calibrated, and recording g02, g04,
  g06, g08, g09 and g13 always. A verifier reads them as notes, not passed checks.
- recording.g03 now fails when no route marks any text `data-rec-role="key"` (it passed with a warning).
- `--allow-skip` only accepts a gate id or group selected in the run; anything else is a usage error (exit 2).
- `--start` (frontend-check, critique): the server's process tree is listed before the kill and checked after it; a
  process that survives makes the run exit 3 even when every gate passed.
- The browser context is offline by default: requests to another host are aborted, WebSockets to another host are
  closed before they connect, and a navigation the page starts itself to another host is aborted. `--network` (ip,
  motion, recording, calibrate) lets them through.
- State folder: slop-check's CLI no longer creates a state folder or an exclude line in the checked repository;
  without `--state` or `--out`, and with no existing state folder, its findings go to a fresh temp folder. With
  `--out`, brand-check, coverage, firstview, ip-check (except `--index-copy`), motion-check, recording-check and qa
  only read the state folder.
- slop-check `--report`: prints the findings document (`--json`) or one line per rule, with per-rule counts in
  `byRule`, instead of the gate report; exit 1 only when a detector failed, else 0.
- `score.collapsed` in the findings file: a rule whose every counted finding sits on a place a higher-scoring rule
  already claimed adds nothing to tells.score and is listed as `{rule, into}`; the tells.score detail names it.
- Optional `<design>/glossary.json` (`{"terms": [...]}` or an array): SL-T17 stops counting the protocol words it
  lists (decentralized, decentralised, autonomous, ecosystem). A malformed file is an SL-T17 detector error.
- Profile `paths.ui` and slop-check `--ui-paths` (which replaces it) name the UI source the static tells layer reads.
  Without them the layer infers the UI packages; either way it reads git-visible, shipped files only (no tests,
  stories, tooling folders, nested repositories or virtual environments).
- SL-T13 and SL-T14: when the wall-clock budget cuts probing short with nothing found, the detector now throws, so
  the tells gates judging them fail (they used to return a clean empty result).
- motion.reduced is skipped, not judged, when its only missing-text evidence comes from a pass whose scroll phase
  never settled (read mid-animation).
- `choices.json` H1 `pick` accepts `none` with a required non-blank `reason`; FE-04's proof still fails on it, so a
  new round of directions follows. `board.mjs record --pick none` records every direction as not picked.
