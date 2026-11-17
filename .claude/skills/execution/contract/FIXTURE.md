# FIXTURE.md — the "Queue Clock" rehearsal fixture

Companion file (README.md 1.2): it refines CLI.md `fixture new` and LANES.md B11 and never contradicts them. Where
this file needs more than the core defines, the addition is marked **[addition]** and listed in section 10 as a
contract question; until the owner accepts it, B11 builds the core behaviour and the additions behind their flags
without changing any default.

The fixture is the neutral rehearsal template of ARCHITECTURE.md 3.1 and 17 ("the rehearsal uses a neutral fixture,
never event content"), shared with /frontend's A/B evaluation (ARCHITECTURE.md 19, last row). Its template lives in
`evals/fixture/` (owned by B11; the first version is delivered with this contract) and `exec.py fixture new`
instantiates it into a fresh project.

Contents: 1 design rules · 2 template layout · 3 content · 4 tokens and time · 5 data · 6 `fixture new` ·
7 two developers, remotes, variants · 8 checks at creation · 9 what each rehearsal criterion uses · 10 additions and
open points.

---

## 1. Design rules

- **Neutral.** No event content: the files never name Cardano, Chainlink, Masumi, x402, Ledger (the company),
  BNB/Binance, Hedera/Hashgraph, TOKEN2049, Origins or Aiken (`test_fixture_neutrality.py`, section 8). The theme is a
  public protocol mechanism (a liquid-staking withdrawal queue); the sponsor (Lido) and the six candidate customers
  are real organisations named only as context, with their official URLs and where those came from.
- **Synthetic and labelled.** Every number is generated with a fixed seed and says so in its file (`meta.synthetic`).
  Nothing claims a partnership or an endorsement (claims-ledger rows 7-8 are `cut`; the never-show list carries the
  overclaim).
- **Relative in time.** Every instant is rendered relative to the instantiation time, so a rehearsal can run on any
  day; the same `--now` and flags give byte-identical files (and the same commit SHA, section 6.4).
- **Exercises the contract, not a happy path.** The fixture deliberately contains: a working name not confirmed by
  the owner (the EX-NAME decision task and FE-05's dependency on it), designs forbidden before T0 (P-16, FE visuals
  released at T0), one `simulated` and one `planned` feature (/frontend's honesty labels), a never-show file with one
  live and one expired embargo plus a do-not-carry phrase and a regex entry, a claims ledger with mixed statuses, a
  denied endpoint, a fenced research folder, mainnet read-only with testnet allowed under a ceiling, a talk slot in
  the owner's availability (P-14 warnings), and a success criterion (SC-002) that is true on the data but still
  `unverified` until the product computes it.

## 2. Template layout (`evals/fixture/`)

```
evals/fixture/
  fixture.json                 manifest: layout, time rules, token files, mode and two-dev patches, variants (sec. 4)
  tools/gen_data.py            the seeded generator of repo/data/*.json (sec. 5); never copied into an instance
  workspace/                   -> <dest>/private/   (workspace.private_dir: outside every git work tree)
    SPEC.md                    FR/SC ids, user stories P1-P3, the ETA rule, demo beats, out of scope
    two-sentences.md           /frontend brief: broken / did / hero, each with its source
    event-brief.md             the fictional organiser text the profile's event block cites
    customers.json             sponsor + six candidates, official URL, url_source, owner_confirmed false
    claims-ledger.md           /hackathon assets/claims.md format, rows verified / unverified / cut
    dx-journal.md              /hackathon assets/dx-journal.md format, empty
    run-sheet.md               /hackathon assets/runsheet.md format, reduced
    never-show.json            /frontend's never-show format (4 entries, sec. 3.4)
    profile.json               -> private/profile.draft.json (input of exec.py ingest --profile-draft)
    policy.json                -> private/policy.draft.json (input of exec.py ingest --policy-draft)
    research/README.md
    research/probes/probe-notes.md   fenced (policy.fences.deny_read); holds a canary sentence
  repo/                        -> <dest>/repo/   (the product repository, git init + one commit)
    README.md                  factual, no TODO, says the data is synthetic
    .gitattributes             * text=auto eol=lf
    .gitignore                 node_modules/, dist/, coverage/
    data/README.md             field-by-field description of the three files
    data/exit-rate-series.json 14 daily frames: capacity = buffer + rewards + exits, finalized ETH, count
    data/queue-snapshots.json  one snapshot per frame: unfinalized ETH and count, queue ends, buffer
    data/requests.json         12 backtest rows (finalized), the demo request 48259, one open request
```

Instance layout (`<dest>` is empty or absent and outside every git work tree):

```
<dest>/
  private/          rendered workspace (+ profile.draft.json, policy.draft.json, frontend-profile.json)
  repo/             product repository, branch main, origin = remotes/product.git or the GitHub remote
  repo-b/           [--two-dev] second clone for orchestrator B
  remotes/          product.git and state.git (bare), when no GitHub remote is created
  scratch/          profile.machine.scratch_root
  fixture-receipt.json   the command's data plus the sha256 of every file written (sec. 6.3)
```

The spec stays in `private/` rather than in the product repository: the profile requires `paths.spec` to be an
absolute path that a verifier can read from a clean checkout, and judge-visible files must not carry planning
material. CLI.md's "a git repo with the spec" is read as "the instance": see section 10, Q-FX-4.

## 3. Content

### 3.1 The product (SPEC.md)
Queue Clock turns a withdrawal request's place in a liquid-staking queue and the last fourteen finalization frames
into a dated range (P10 / P50 / P90). Rule 2.1 of the spec is normative and fully specified (decile method, decimal
arithmetic, "insufficient data" under three frames), with a worked example that the data satisfies exactly: the demo
request 48259 needs 19,491.89 ETH; the last seven capacities give rates 4,877.518 / 2,891.84 / 2,136.708 ETH per
frame; k = 4 / 7 / 10 frames.

Requirements and the plan shape they force (the canned planner draft of B11, `scripts/tests/fixtures/B11/
planner-draft.json`, must use exactly these ids, groups, surfaces and statuses):

| id | priority | required | group | surface | status_expected | covered by (expected) |
|---|---|---|---|---|---|---|
| FR-001 | P1 | yes | G1 | ui | null | build task (lookup) + FE-1x(G1) |
| FR-002 | P1 | yes | G1 | ui | simulated | build task (ETA view) + FE-1x(G1) |
| FR-003 | P2 | yes | G2 | ui | null | build task (health data) + FE-1x(G2) |
| FR-004 | P1 | yes | — | api | null | engine task (code) + its tests (test-designer) |
| FR-005 | P2 | yes | — | cli | null | CLI task (code) |
| FR-006 | P3 | no | G1 | ui | planned | FE-1x(G1) only (no build task: it is shown as planned) |
| FR-007 | P3 | no | G2 | ui | null | backtest task (code) + FE-1x(G2) |
| SC-001..SC-005 | — | yes | — | none | null | test and gate tasks |

FR-006 shares group G1 with built features on purpose: `@feature-tasks` of SCHEMAS.md 6.2 fails on a group whose
requirements no build task covers (E_TEMPLATE_DEP), so a planned feature alone in a group cannot be instantiated
(section 10, Q-FX-3).

The feature catalogue `exec.py catalogue` must generate from that draft (golden file
`scripts/tests/fixtures/B11/feature-catalogue.golden.json`, byte-compared):

```json
[
  {"group": "G1", "id": "FR-001", "priority": "P1", "title": "Request lookup"},
  {"group": "G1", "id": "FR-002", "priority": "P1", "status_expected": "simulated", "title": "ETA range"},
  {"group": "G2", "id": "FR-003", "priority": "P2", "title": "Queue health panel"},
  {"group": "G1", "id": "FR-006", "priority": "P3", "status_expected": "planned", "title": "Finalization notice"},
  {"group": "G2", "id": "FR-007", "priority": "P3", "title": "Backtest table"}
]
```
(requirements order; sorted keys, as every machine document; titles are the draft's.)

### 3.2 The event (event-brief.md, profile.json)
A fictional in-person "Rehearsal Hack" of six hours: T0 = the next 5-minute boundary after instantiation plus 30
minutes; submission = T0 + 6 h. Existing code and data may be brought (`prework.code: true`), designs may not
(`prework.designs: false`, `until_utc: T0`): the repository exists at instantiation, /frontend's FE-00..FE-02 may run
in the 30-minute pre-T0 window with `--state <private>/frontend/`, and every visual template task is released at T0
(P-16). Recorded video only (mp4, 180 s, 1920x1080), stage judging, rubric 30/30/20/20 with "UX & Design" at 20 %.
Display zones SGT and Paris (the same pair the first real run uses, so the reports' dual times are rehearsed); the
Paris fallback offset is computed at instantiation (section 4.3). The owner's availability has one `talk` slot
(T0+3h to T0+3h30) so that a manual task's latest start can fall outside an awake window (W_OUTSIDE_AVAILABILITY).

### 3.3 The frontend block
Every path filled (`claims_ledger`, `never_show`, `feature_catalogue`, `spec`, `research`, `workspace.private_dir`),
`run_mode: A`, `judged_surface: site`, `hosting: local` (no deploy needed to rehearse; the recording is local),
`record_mode: true`, `stage: true`, `review_surface: board` (the board path of /frontend's 03-directions.md; Claude
Design needs the owner's own canvas), `sponsors: ["lido"]`, references = the six candidates with
`owner_confirmed: false` (FE-01 confirms them). `--frontend-mode` picks the mode patch of `fixture.json`:

| mode | stack | critique rounds | ui_hours | why |
|---|---|---|---|---|
| small (default) | static-html | 1 | 2 | the first real run's UI budget; nothing to install, light on disk |
| full | vite-react | 3 | 6 | exercises FE-1x per group, the build chained in the proof, pnpm worktrees |

`exec.py fixture new` also writes `private/frontend-profile.json`: the same block with `run_mode: "B"`, for
/frontend's own A/B runs in mode B (its `--profile` accepts a bare block file in mode B, CONTRACTS.md 4).

### 3.4 Never-show (never-show.json, /frontend's format, scope rules of SCHEMAS.md 8)

| id | class | pattern | regex / case | until | scope | expected behaviour |
|---|---|---|---|---|---|---|
| ns-embargo-live | embargo | `Harbor Desk` | literal, folded | end + 24 h | both | active all rehearsal: a planted occurrence makes `merge` exit 4 E_NEVER_SHOW (hit = entry id + file:line, never the text) and fails /frontend's `coverage.nevershow` when rendered |
| ns-embargo-expired | embargo | `Queue Clock Pro` | literal, folded | now − 2 h | both | inactive at every instant after instantiation: never fires |
| ns-do-not-carry | do-not-carry | `guaranteed withdrawal time` | literal, folded | null | both | always active |
| ns-never-public-ticket | never-public | `\bQC-INT-[0-9]{3,}\b` | regex, case-sensitive | null | repo | active for the repo scan only; `qc-int-123` does not match (case-sensitive) |

The pattern of the live embargo never appears anywhere else in the template (checked, section 8).

### 3.5 Claims ledger (claims-ledger.md)
Rows 1-3 `verified` (each recomputed from `repo/data/` at creation, section 8), rows 4-6 `unverified` (the product
must compute them: the worked example, SC-002, SC-004), rows 7-8 `cut` (the guaranteed-time overclaim and an
endorsement). Verifiers append rows with status `unverified` (CLI.md `wave ingest`).

### 3.6 Policy (policy.json)
Commits and pushes allowed, force and history rewrite never, push freeze at the submission instant; testnet allowed
(ethereum/hoodi, ceiling 0.5 ETH per wave; the spec needs no transaction, so the ceiling is only checked by the
guard tests); mainnet `read-only` with two broadcast patterns; one denied endpoint (`wq-api.lido.fi`, the live API
the frozen data stands in for) and one denied command (`publish`); `fences.deny_read` = `<private>/research/probes/**`;
writes outside the repo allowed only under the scratch root; no env file.

### 3.7 Customers (customers.json)
Sponsor Lido and the candidates Aave, Morpho, EigenLayer, Spark, Euler and Curve, each with `url` (final URL after
redirects), `url_source` (the HTTP GET of 2026-10-01: status 200 and the page title; EigenLayer's site now answers as
EigenCloud), a `why_candidate` explicitly marked "hypothesis, unverified", and `owner_confirmed: false`.

## 4. Tokens and time

### 4.1 Token grammar (closed; anything else is an error, E_FIXTURE_TOKEN **[addition]**, Q-FX-2)
Tokens appear only in the files listed by `fixture.json` `render.token_files`.

| token | renders to |
|---|---|
| `{{t:<anchor>[(+|-)<n>(m|h|d)]}}`, anchor `now`, `t0` or `end` | a UTC instant `YYYY-MM-DDTHH:MM:SSZ` |
| `{{p:private}}`, `{{p:repo}}`, `{{p:scratch}}`, `{{p:dest}}` | absolute paths with forward slashes |
| `{{p:usage_snapshot}}` | `$CLAUDE_CONFIG_DIR/usage-snapshot.json` when the variable is set, else `~/.claude/usage-snapshot.json` (absolute, forward slashes) |
| `{{slug}}` | the variant's slug (`queue-clock`, `queue-clock-b`) |
| `{{remote:product}}`, `{{remote:state}}` | the remote URL, or JSON null with no GitHub remote (the local bare remotes are not recorded in the profile) |
| `{{offset:Europe/Paris}}` | the zone's UTC offset in minutes at T0 (integer) |
| `{{stamp}}` | `clock.stamp(now)` lower-cased (GitHub repository names only) |

In JSON files a string value that is exactly one token takes the token's type (string, null or integer); a token
inside a longer string is substituted as text. Markdown files get text substitution only. Rendering never touches a
file outside `token_files`, and a token left unrendered fails the creation (section 8, C-03).

### 4.2 Instants
- `now` = `clock.utcnow(--now | EXEC_NOW)`, seconds truncated.
- `t0` = `now` rounded up to the next multiple of 5 minutes (unchanged if already on one), plus 30 minutes.
- `end` = `t0` + 360 minutes.
- `frame` = the latest instant whose time is 12:00:00Z and which is at or before `t0` − 60 minutes.

Example (tests use it): now `2026-10-03T07:12:00Z` → t0 `2026-10-03T07:45:00Z`, end `2026-10-03T13:45:00Z`, frame
`2026-10-02T12:00:00Z`, live embargo until `2026-10-04T13:45:00Z`, expired embargo until `2026-10-03T05:12:00Z`,
Paris offset 120.

### 4.3 Time zone fallback
`{{offset:Europe/Paris}}` uses `zoneinfo` at `t0`. Without a tz database (stdlib-only machine without `tzdata`), it
renders 120 and the command emits W_TZ_FALLBACK naming the field (never a silent guess); after 2026-10-25T01:00:00Z
the correct value is 60, so a fallback after that date is reported as a warning the owner must see.

## 5. Data (`repo/data/`) and its generator

- `tools/gen_data.py` (stdlib, `random.Random(20260110)`, decimal arithmetic) produces the three files
  byte-for-byte; `test_fixture_data.py` regenerates them into a temp dir and compares bytes. The generator is
  never run by `fixture new`; the committed files are the template.
- Model: a backlog of about 45,000 ETH queued over the six days before the window, then new requests every 8-30
  minutes; one oracle frame per day at 12:00 UTC whose capacity is buffer + rewards + exits; whole requests are
  finalized in id order up to the capacity. 1,637 requests are generated; 14 are tracked in `requests.json`.
- Template anchor: the last frame, `2026-01-10T12:00:00Z`. At instantiation every UTC string in the three files is
  moved by `frame − 2026-01-10T12:00:00Z` (whole days, so frames stay at 12:00 UTC and the ETA arithmetic, which
  counts frames, is unchanged). Amounts, ids and counts never change.
- Invariants checked at creation (section 8): 14 frames, strictly increasing by one day; capacity = the sum of its
  three parts exactly (decimal); `finalized_eth <= capacity_eth`; one snapshot per frame with the same instants; every
  amount a decimal string; the 12 backtest rows have `finalized_at` on a frame instant; the demo row is 48259 with
  `eth_ahead_now` 19489.94; the median capacity of the last seven frames is 2891.84; the last snapshot's
  `unfinalized_eth` is 38863.77.
- Facts the data supports (used by tests and by claims rows 4-5): rule 2.1 gives 4 / 7 / 10 frames for the demo
  request; of the twelve backtest rows, eight have fewer than three prior frames ("insufficient data") and four are
  eligible, of which three have the P50 frame equal to the actual frame and one is two frames early, so SC-002 holds
  (three of four within one frame).

## 6. `exec.py fixture new`

### 6.1 Arguments
| argument | origin | meaning |
|---|---|---|
| `--dest DIR` (required) | CLI.md | the instance root; must be absent or empty and outside every git work tree |
| `--variant a\|b` (default a) | CLI.md | the A/B arm of /frontend's evaluation: same content and times for the same `--now`; only the slug (and so the GitHub names) differs, so two instances coexist |
| `--with-remote` | CLI.md | create two private GitHub repositories (product and state) with `gh repo create --private`; off by default |
| `--two-dev` | CLI.md (revision 2) | add dev B (setup full, executor B) to the profile draft and create `<dest>/repo-b`, a second clone for orchestrator B |
| `--frontend-mode small\|full` (default small) | CLI.md (revision 2) | apply the mode patch of `fixture.json` to the frontend block |
| `--now ISO` | global (CLI.md 0.1) | the instantiation instant; tests always pass it |

The computed names `--out` and `--remote private|none` used in planning notes map to `--dest` and `--with-remote`;
no alias is added.

### 6.2 Algorithm (deterministic; `execlib.fixture.create`)
1. Resolve `now`, `t0`, `end`, `frame` (4.2). Refuse a `--dest` that exists and is not empty (exit 1, CLI.md) or that
   lies inside a git work tree (`git rev-parse --show-toplevel` from its nearest existing parent succeeds: exit 2
   E_USAGE).
2. Load `fixture.json`; check that every file it names exists in the template (a missing one is exit 3 E_INTERNAL:
   the skill is broken).
3. Copy `workspace/` to `<dest>/private/` and `repo/` to `<dest>/repo/`, skipping `render.not_copied`; render the
   token files (4.1); apply `renames`; shift the data times (section 5); create `<dest>/scratch/`.
4. Patch the profile draft: the mode patch (`modes.<mode>` merged into `frontend` key by key), and with `--two-dev`
   the `two_dev.dev_b` object (rendered) appended to `team.devs`. Write `private/frontend-profile.json`.
5. Write files through `jsonio` (UTF-8, LF, final newline; JSON with 2-space indent and the template's key order, as
   for human-edited documents, SCHEMAS.md 1.2).
6. Run the creation checks of section 8; any failure is exit 1 with every failing check listed and the instance left
   in place for inspection (never deleted: the owner decides).
7. Product repository: `git init -b main`, `core.longpaths true`, `core.autocrlf false`; commit every file with
   `gitutil.Git.commit_paths` and the message `chore: add queue clock rehearsal fixture` (written to a file, no
   trailer), with `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` set to `now` so the SHA is reproducible for a given
   identity. The identity is git's configured one; when none is configured the command fails with E_GIT naming
   `user.name`/`user.email` (it never invents one).
8. Remotes: without `--with-remote`, `git init --bare <dest>/remotes/product.git` and `<dest>/remotes/state.git`,
   origin of `repo/` = the product bare repository, `git push origin main`. With `--with-remote`: `gh auth status`
   must succeed (else exit 3 E_ENV, nothing created remotely), then `gh repo create <owner>/<slug>-<stamp> --private`
   and `<slug>-<stamp>-state --private`, origin set and pushed; the URLs are rendered into the profile draft
   (`{{remote:*}}`) before step 6 writes it, so step 7 happens after the GitHub calls succeed. A failure after the
   first repository was created reports what exists (`created_remote: [...]`) and exits 3; repositories are never
   deleted automatically (deleting is the owner's manual step).
9. `--two-dev`: `git clone <product origin> <dest>/repo-b` (the state repository is cloned later by `exec.py init
   --executor B --state-remote <state origin>`, run by orchestrator B).
10. Write `<dest>/fixture-receipt.json` (the data below plus `files: {relative path: sha256}`) and print the
    envelope.

The command writes nothing under `~/.claude/`, starts no Claude session, calls no network except `gh` with
`--with-remote`, and never creates `.execution/` (that is `exec.py init`, the rehearsal's next step).

### 6.3 Data (envelope `data`)
```json
{"dest": "C:/rehearsal/qc-1", "spec": "C:/rehearsal/qc-1/private/SPEC.md",
 "drafts": {"profile": ".../private/profile.draft.json", "policy": ".../private/policy.draft.json"},
 "never_show": ".../private/never-show.json", "commit": "<40 hex>",
 "repo": ".../repo", "private_dir": ".../private", "scratch": ".../scratch",
 "frontend_profile": ".../private/frontend-profile.json",
 "times": {"now": "...Z", "t0": "...Z", "end": "...Z", "frame": "...Z"},
 "variant": "a", "two_dev": false, "frontend_mode": "small",
 "remotes": {"product": "<url or path>", "state": "<url or path>", "github": false},
 "repo_b": null,
 "next": ["exec.py init --project queue-clock --executor A --state-remote <state>", "exec.py preflight --for rehearsal",
          "exec.py ingest --spec <spec> --profile-draft <profile> --policy-draft <policy> --propose-spec-validation"]}
```
The first five keys are CLI.md's; the rest are **[additions]**.

### 6.4 Exit codes and determinism
0 created · 1 dest not empty, or a creation check failed · 2 usage (dest inside a work tree, bad flag) · 3 git or
gh missing or failing, a template file missing. Not idempotent (CLI.md: a second call refuses the non-empty dest).
Deterministic: two instances created with the same `--now`, variant, mode and two-dev flag in different empty
directories have byte-identical `private/` and `repo/` trees once the `dest`-dependent paths are normalised
(tests replace the dest prefix), and the same commit SHA when the dest prefix is equal (the README carries no path).

## 7. Two developers, remotes, variants

- Two-dev rehearsal (ARCHITECTURE.md 17: "a second orchestrator as dev B on its own tasks"): `--two-dev` gives the
  profile two full-setup devs and a second product clone. The planner then assigns static ownership (lanes and
  executors) at approval; orchestrator B runs `exec.py init --executor B --state-remote <state>` in `repo-b`.
- Local bare remotes are enough for every scripted test and for a one-machine two-orchestrator rehearsal. The
  phone and Notion parts of the rehearsal work with either. `--with-remote` is for the full rehearsal only (CI on
  GitHub Actions for H12 needs a GitHub remote; a private repository's Actions minutes are the owner's).
- Variant `b` exists so /frontend can run "with" and "without" arms on two instances created with the same `--now`.

## 8. Creation checks (exit 1 on any failure; also run by `test_fixture_new.py`)

| id | check |
|---|---|
| C-01 | `profile.draft.json` validates against `profile.schema.json` and its `frontend` block against /frontend's `profile-frontend.schema.json`; `private/frontend-profile.json` validates against the latter too. /frontend's schema absent: exit 1 E_DEPENDENCY_MISSING naming the file (a fixture whose frontend block cannot be checked is not created; no fallback) |
| C-02 | `policy.draft.json` validates; `never-show.json` validates against ours and /frontend's when present (disagreement: W_NEVER_SHOW_SCHEMA_DRIFT) |
| C-03 | no `{{` token left in any rendered file |
| C-04 | the never-show list at `now`: `ns-embargo-live` active, `ns-embargo-expired` inactive (through `execlib.nevershow.active`) |
| C-05 | no active repo-scope never-show entry matches any file of `repo/` (positive control: the scan run on a planted line containing the live pattern reports a hit) |
| C-06 | data invariants of section 5, and claims rows 1-3 recomputed from the shifted data |
| C-07 | every requirement id of SPEC.md (`FR-\d{3}`, `SC-\d{3}`, `US\d`) is unique; FR-002 carries `simulated` and FR-006 `planned` |
| C-08 | neutrality: the forbidden names of section 1 appear nowhere in the instance (case-insensitive, except `Ledger` and `Origins`, matched case-sensitively as words, since "claims ledger" is a format name) |
| C-09 | every text file is UTF-8 without BOM, LF only, with a final newline |
| C-10 | `private/`, `scratch/` and `remotes/` are outside the product work tree; `repo/` has exactly one commit, no untracked file, and its commit message has no attribution trailer |

## 9. What each rehearsal criterion (ARCHITECTURE.md 17) uses from the fixture

| criterion | fixture element |
|---|---|
| plan approved from a spec in under 30 min | SPEC.md (7 FR, 5 SC, 3 stories), unconfirmed name (EX-NAME), prework rule (T0 in 30 min) |
| a contract wave then 3 parallel lanes | FR-004 engine, FR-005 CLI, FR-003/FR-007 data views and the UI lane are file-disjoint; `max_lanes: 3` |
| /frontend small mode with H1/H2 from the phone | frontend block, six references, `review_surface: board` |
| one proof failing then fixed | the worked example (SC-005): an engine that takes the mean capacity instead of the median gives 6 frames for the P50 instead of 7 and fails the test-designer's proof; the fix is local to the engine (the rehearsal may plant it, or simply keep the first honest failure) |
| one manual task from the phone, one through Notion | FE-01 (confirm reference URLs) and the name decision; Notion `enabled: true`, hub created at init |
| a second orchestrator as dev B | `--two-dev`, `repo-b`, `remotes/state.git` |
| forced `/compact`, terminal kill + resume mid-wave | any wave of the plan; nothing fixture-specific |
| Stop gate never ends a turn with the plan open and nothing armed | the talk slot and manual tasks create awaiting periods |
| a report per wave readable on the phone | zones SGT and Paris |
| build complete + harden-ready + hand-over by script | judge-facing README, `.gitattributes`, no env file, H11 checks |
| `--fix` on a sample /harden report | `scripts/tests/fixtures/B07/harden-report.md` run against an instance |
| never-show and fences | live embargo plant (merge exit 4), probe-notes canary (guard deny) |

## 10. Additions and open points

Settled in revision 2 (README.md 10): Q-FX-1 `fixture.create(..., two_dev, frontend_mode, now)` and the flags
`--two-dev`, `--frontend-mode` (CLI.md, MODULES.md); Q-FX-2 `E_FIXTURE_TOKEN` (README.md 6); Q-FX-3 a group whose ui
requirements are all `planned` gets an FE-1x instance without `@feature-tasks` (SCHEMAS.md 6.2; the fixture keeps
FR-006 in G1 anyway); Q-FX-4 the spec stays outside the product repository (CLI.md `fixture new` reads so); Q-FX-6
the fixture's lower floors (RAM 1.5 GB, disk 2.0 GB) are rehearsal-only, the event profile keeps ARCHITECTURE 8.1's.
- **Q-FX-5** settled with /frontend on 2026-10-01: an unknown sponsor id (the fixture's `lido`) means "no marks to
  exempt": logos stay text-only, nothing is exempted, and the `ip.sponsor-marks` gate reports it as a detail line, never
  an error.
