# Brief: discover and compile the project's inputs (P0)

Read when: you run P0 or task FE-00, an input is missing, you need the source of the hero text, the feature catalogue, the claims ledger or the never-show list, or `brief.complete` fails.

## Purpose
/frontend never invents an input. P0 finds each one by glob from the workspace root, records the exact path it came from, and turns every gap into a manual task (mode A) or a question (mode B).
The output is `brief.json` (machine) and `brief.md` (human) in the state dir; every later phase reads them, and several gates compare the page against them.
Formats of the shared files (never-show list, feature catalogue, profile) are in `00-contract.md`; the gates that check the brief downstream are in `10-gates.md`.

## Rules

### BF-01 - Discover from the workspace root and record the path found
- **Rule:** Inputs live in the workspace's research tree, which is not the product repo (BNB's code sits in `holdover/` next to `research/`). Mode A: start from `paths.research` and `paths.spec`. Mode B: ask once for the workspace root. Run each glob of the table below from that root, excluding `node_modules`; an /execution path (`paths.spec`, `paths.feature_catalogue`, `paths.never_show`, `phase_b.claims_ledger`) replaces its glob when set. Read what matches and record the exact path (and line when known) as the field's `source`.

| input | glob (from the workspace root) | brief field | if absent |
|---|---|---|---|
| rubric, format, deliverables | `research/findings/**/*{rubric,rules}*.md`, `docs/*RULEBOOK*.md` | profile `format`, `judged_surface` | ask for the rulebook and whether a live URL, a video (length cap) or slides (format) are required; never assume a live stage |
| sponsor map, customers | `research/findings/**/*{customer,sponsor,strategy}*.md` | `sponsors`, `customers` | propose 3 to 5 customers from the sponsor's own case-study or ecosystem pages, with sources, and ask |
| customer URLs | none recorded upstream | `customers[].url` | BF-04 |
| use case | inside the customer file | `use_case` | ask for a named institution, a thing and an amount |
| gap, two sentences | `research/**/{_recommendation,SPEC,PHASE-A-DECISION}.md`, `research/findings/**/_summary.md`, `docs/*{DECISIONS,PITCH}*.md` | `gap`, `sentences`, `hero` | required: write no hero copy and ask |
| spec | same globs as the row above, or `paths.spec` | `features[].source` | required: /execution should not have started |
| feature catalogue | `research/FEATURE-CATALOGUE.md`, `docs/*SPEC*FRONTEND*.md`, or `paths.feature_catalogue` | `features` | BF-07 |
| claims ledger | `research/**/claims*.md`, or `phase_b.claims_ledger` | `claims` | BF-08 |
| never-show | sections headed "do not carry", "do-not-carry" or "Private" in `research/findings/**/_summary.md`; `**/redact-check.*`; or `paths.never_show` | `never_show` | BF-09 |
| judges, judge's path | `research/**/*{judge,judges}*.md` (some live only inside the rubric file) | `judge_path` | ask; use /hackathon's `00-rubric.md` questions |
| storyboard, video script | `research/**/*{VIDEO,SCRIPT,runsheet,RUNSHEET}*.md`, `docs/*{RUNSHEET,runsheet,SCRIPT}*.md` | `judge_path.beats` | /frontend defines the screens; the script is written after /harden |
| name, naming study | `research/design/naming/_verdict.md` | `project` | the logo task is blocked (BF-12) |
| data contract, fixtures | `docs/*API-CONTRACT*.md`, `**/fixtures/**`, `**/data/**` | none (BF-11) | required before any section is built |
| team, presence | memory files | profile | ask whether dev B builds UI; default solo |

- **Why:** Phase A outputs exist in all five workspaces surveyed, under different names; only /hackathon's template files have fixed names [FD13-F05].
- **Check:** `brief.complete`.
- **Not when:** an /execution path is set for that input: read it and skip the glob.

### BF-02 - Retry a glob case-insensitively before calling an input missing
- **Rule:** When a glob finds nothing, retry it case-insensitively (in Git Bash: `shopt -s globstar nocaseglob`) and from `docs/` as well as `research/`. Record which matcher found the file.
- **Why:** Globs are case-sensitive in bash but not in Windows tools, and the research-only storyboard glob found nothing in a workspace whose runsheet sits in `docs/` [FD13-F05].
- **Check:** `brief.complete` (every `source` path exists).
- **Not when:** never.

### BF-03 - Never invent an input; turn each gap into a manual task or a question
- **Rule:** A field with no source stays empty and gets a `missing` entry `{field, action, why}`: `action: "manual-task"` in mode A (reported in the task result, see `00-contract.md` CT-02), `"question"` in mode B. Offer the table's fallback in the entry. Two gaps stop P0: no two sentences (write no hero copy) and no spec.
- **Why:** Never invent a missing input; propose, then wait [FD13-F05].
- **Check:** `brief.complete`.
- **Not when:** never.

### BF-04 - Propose each customer URL with its source; the owner confirms it
- **Rule:** For each customer, propose one official URL and say how you found it: the sponsor's own page, the `url` field of `https://api.llama.fi/protocol/<slug>`, or the customer's GitHub org. Write in `url_source` whether it is a marketing homepage or an app route. Set `owner_confirmed: false`. FE-01 (mode A) or a question (mode B) confirms it; confirmed rows go to `profile.frontend.references`. Nothing is captured before confirmation.
- **Why:** None of the customer tables in four events records a website, DefiLlama's `url` can point at an app route rather than a homepage, and in crypto a search result can be a lookalike domain, so owner confirmation is load-bearing [FD13-F06].
- **Check:** owner review (the FE-01 answer file).
- **Not when:** the "customer" is a segment, not an organisation (for example a developer audience): record it with no URL.

### BF-05 - Take the hero from one source file, verbatim
- **Rule:** Read the two sentences (the thing that is broken, and what you did about it) and any fold device from one source file. `hero.sentence` is that text unchanged; `hero.h1` (about 2 to 6 words) comes from the same file, with `hero.source` naming it. If the file holds no short headline, record `hero.h1` as missing: the owner writes it into the source file. Never paraphrase. When the source changes (for example /prose rewrites the README opening after /harden), re-render the hero from it; never edit the hero by hand.
- **Why:** /prose keeps the two sentences identical in substance in the README, the form and the video, the hero is a fourth copy, and the source file must be the single editable one [FD13-F07]. Category exemplars use 2 to 6 word headlines [FD11-F17].
- **Check:** `coverage.hero`.
- **Not when:** never.

### BF-06 - Build the judge's path from the fold spec and the storyboard, at every run
- **Rule:** The screen list is the union of the fold spec and every "on screen" cell of the storyboard. Every beat must be reachable inside the browser. Design the fold at 1440x900 and 390x844. Put the beats in `judge_path.beats` with their source. Re-read these files at every run; never cache them.
- **Why:** Phase A and the design panels already specify the judge's path, the fold and the shots; storyboards are pre-build plans and change [FD13-F14].
- **Check:** `brief.complete`.
- **Not when:** no storyboard exists: /frontend defines the screens and the script comes after /harden [FD13-F05].

### BF-07 - Build the feature catalogue from the plan, then from the code
- **Rule:** Mode A: read `paths.feature_catalogue`, generated by /execution from plan.json. Mode B: enumerate from the spec's FR ids and from the code (routes, contract functions, CLI commands) into `[{id, group, title, priority, status_expected}]`, then ask which rows must be judge-visible. In `brief.features` give each row a `status` (`live`, `testnet`, `simulated` or `planned`), a `route`, a `proof` and a `source`. A row stays off the page only with a written owner decision.
- **Why:** BNB's catalogue, enumerated from code, showed the page displayed the measurement and hid the proof [FD13-F08]; a panel the spec described was missing while 920 tests were green [FD13-F09]. Viewers take one purpose from a first look and rarely find secondary features even with unlimited time [FD11-F14].
- **Check:** `brief.complete` now; `coverage.features` once sections exist.
- **Not when:** never.

### BF-08 - Let a number render only from a verified ledger row
- **Rule:** Read the ledger from `phase_b.claims_ledger` (mode A) or its glob. Parse both vocabularies: verified = backed, unverified = re-verify, cut = do-not-claim. Record ledger ids in `brief.claims.ids`. Downstream, a number, superlative or comparison renders only from a verified or backed row, tagged `data-ledger="<id>"`; any other figure shows a visible "not yet verified" state. Rows shown on the page should carry "web page" in the ledger's "where it appears" column: propose that value to whoever keeps the ledger, and never rewrite its rows yourself. With no ledger, render no number that cannot be traced to an artifact file, and open one from /hackathon's `assets/claims.md`.
- **Why:** Ledgers use two status vocabularies and nothing ships as unverified [FD13-F10]; the T-6h demo audit hunts numbers said or shown that cannot be traced [FD13-F24]; the fallback is /hackathon's template [FD13-F05].
- **Check:** `coverage.metrics`.
- **Not when:** a live value from a declared data source carries `data-source` and `data-as-of` instead of a ledger id.

### BF-09 - Compile the never-show list before anything can publish
- **Rule:** Collect four classes: `do-not-carry` (refuted or already public claims), `undisclosed-security` (none may be demoed, published or exploited), `never-public` (material for a private report to the sponsor), `embargo` (held until a UTC date). Draft entries in the shared format (`00-contract.md` CT-12), one source each, plaintext outside the product repo, and ask the owner "what must the page never say, or not before a date?". Run the project's own redaction script as well, and apply the event's naming default to on-page labels (TOKEN2049: name the deployment and the script hash, not the platform, on anything that carries a number). Until the owner confirms the list, render nothing marked private or undisclosed.
- **Why:** Four kinds exist upstream, only never-public was checked by a script, and only in files, never in rendered pages or dated [FD13-F11]. A memory note is not enforcement: the live BNB board rendered findings held until 11 Oct 12:00 UTC [FD13-F12].
- **Check:** `coverage.nevershow`.
- **Not when:** never.

### BF-10 - Fill the event profile from the rulebook, with its fetch date
- **Rule:** From the rubric files take the judged surface, the recording cap and resolution, the stage or projector zoom, hosting, the window the site must stay up, whether external requests are allowed, and the team. Mode A: /execution builds `profile.json` at ingest; read it. Mode B: write `.frontend/profile.json` and ask once for the rest. Record each rubric's fetch date and re-fetch it before the event.
- **Why:** The event format decides the target surface, and the three upcoming events differ [FD13-F13]; the Cardano track published its UX weight after the owner's rubric file was verified [FD13-F32].
- **Check:** `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates brief --profile <abs profile>` (exit 2 on an invalid profile).
- **Not when:** never assume a live stage.

### BF-11 - Require a frozen data contract before any section is built
- **Rule:** Find the API contract and its fixtures. Strings the backend writes are pitch copy: render them verbatim. A number that is not in those responses does not exist. With no contract, record it as missing; FE-1x sections cannot start.
- **Why:** In November 2025 every page a collaborator built was discarded because routes and data shapes were imagined; the fix was a frozen contract, real fixtures and verbatim strings [FD13-F20].
- **Check:** owner review.
- **Not when:** mode B on a running app: its own data is the contract [FD13-F20].

### BF-12 - Block the mark until the name is final
- **Rule:** Set `project.name_status` to `final`, `working` or `pending`, with the naming verdict as source. While the name is not final and owner-confirmed, FE-05 waits on a decision task (mode A) or a question (mode B).
- **Why:** The logo derives from the name and its meaning, and Origins' primary candidate must be renamed first [FD13-F15].
- **Check:** `brief.complete`.
- **Not when:** never.

### BF-13 - Write brief.json with a source on every non-empty field
- **Rule:** Fields: `project {name, name_status, source}`; `sentences {broken, did, source}`; `hero {h1, sentence, source}`; `gap {text, who_loses, how_much, source}`; `sponsors [{id, name, strategy, source}]` with ids from `assets/sponsor-allowlist.json` (for example `cardano`); `customers [{name, category, url, url_source, owner_confirmed}]`; `use_case {text, source}`; `features [{id, group, title, status, route, proof, source}]`; `claims {path, ids}`; `never_show [{class, pattern, regex, until_utc, source}]`; `judge_path {beats, source}`; `missing [{field, action, why}]`. Every non-empty field carries its source path, and line when known. `brief.md` shows the same fields on one screen, then the missing list.
- **Why:** Record the path found and never guess a field [FD13-F05]; the hero's source must be the single editable copy [FD13-F07].
- **Check:** `brief.complete`.
- **Not when:** never.

## Procedure
P0, task FE-00:
1. Find the workspace root and the product repo (`--root`). Mode A: profile paths. Pre-T0: pass `--state <workspace.private_dir>/frontend/` everywhere.
2. Run `node ~/.claude/skills/frontend/scripts/brief.mjs --help`, then run it with the shared flags (`--root`, `--profile`, `--state`) to discover inputs and write a first `brief.json`.
3. Open every matched file. Fill each field the script left empty, with its source (BF-13). Apply BF-02 before any field is declared missing.
4. Resolve customers (BF-04), the hero (BF-05), the catalogue (BF-07), the ledger (BF-08), the never-show list (BF-09) and the name (BF-12).
5. Write `brief.md`.
6. Prove: `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates brief --root <repo> --profile <abs profile>` (plus `--state` before T0). File-only gates need no target flag (CONTRACTS 4 v1.1), so this runs before any build exists.
7. Report the `missing` list in the task result (mode A) or ask its questions (mode B). Never wait inside a mode A task.

## Gaps
- `brief.mjs` flags are in CONTRACTS 4 v1.1 and its fill rules in 6.4 v1.1 (labelled lines only); which fields the agent must still fill by hand is read from the `missing` list it writes.
- The glob matcher `brief.mjs` uses (case-sensitive or not) is not stated, though the research asks the skill to state it [FD13-F05].
- `brief.json` has no field for "marketing site or app" or for how a URL was verified; BF-04 puts both in `url_source` [FD13-F06].
- The never-show schema has no field recording the owner's confirmation of the list, nor one for an event's naming default.
- /hackathon's step 3 asks for customers but not for their sites; adding an "official URL (source)" column there is a proposal for the owner [FD13-F06].
- The claims ledger has no machine-readable schema (two Markdown vocabularies), so how `brief.claims.ids` and their statuses are parsed is undefined.
- How `coverage.hero` normalises text before comparing (beyond `normaliseText`: NFKC, collapsed whitespace) is not stated; punctuation differences are open.
