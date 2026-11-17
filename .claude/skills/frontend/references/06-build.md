# Build: first screen, feature sections and proof

Read when: you build the app shell, the first screen or a feature section (FE-08, FE-1x), wire the DOM markers the checks read, or check coverage before a publish, a recording or the hand-over.

## Purpose
A judge screens a page in its first seconds, takes one purpose from the first look and rarely finds secondary features alone [FD11-F12, FD11-F14]. This file turns that into build rules: the first-screen contract, one surface per catalogue feature with its proof and status, coverage proven on the rendered page, and nothing a judge needs hidden behind hover, animation or a deep fold.
Related files: wallet and transaction states in `07-states-web3.md`, motion in `08-motion.md`, recording sizes in `09-recording.md`, every rendered word in `14-copy.md`, logos and third-party assets in `15-ip-provenance.md`, gate details in `10-gates.md`. `[critic Mn]` cites `research/_critic-round1.md`.

## Rules

### BD-01 - Build the first screen to the contract
- **Rule:** At every profile viewport (default 1440x900 and 390x844) the first viewport holds: an H1 of 2 to 6 words (`data-hero="h1"`; the gate accepts up to 8) and one sentence of 5 to 40 words naming the user, the action and the object (`data-hero="sentence"`), both read from `brief.hero`; the sponsor named in text; one sourced figure with a short label and a link to its source; the product itself, marked `data-surface="product"`; at most 2 calls to action.
- **Why:** Ten protocol and fintech first viewports use 2-6-word headlines (median 5), at most 2 primary CTAs and one proof strip [FD11-F17]. A hackathon project has no brand to lean on, so the explanatory sentence is required [FD11-F18, FD11-F13]. Exemplars show exact figures with small labels [FD11-F20]. The owner's fold was already designed at 1440x900 and 390x844 [FD13-F14]. The automated first-impression proxy looks for headline, sentence, sponsor name and one sourced figure [FD11 Derived principles].
- **Check:** firstview.contract
- **Not when:** never. On a recording event, also meet the 1536x864 layout in `09-recording.md`.

### BD-02 - Open on the core action, not on a mood
- **Rule:** The product surface in the first view runs the protocol's most characteristic action (a settlement, a proof being verified, a vault rebalancing) on real data, or on example data labelled `simulated` or `testnet`. Put at least one detail only this subject has (its units, identifiers, terms of art) in the content. No empty shell waiting for input, no stock photo, no abstract art as the main visual.
- **Why:** Anthropic's guidance opens the hero on "the most characteristic thing in the subject's world", a live demo included, and opens a tool "in a realistic working state" because "an empty shell waiting for input shows nothing" [FD15-F07]. People study real products and skip decorative images [FD11-F15]. For an unknown product the strongest exemplar pattern is Uniswap's: the homepage is the product [FD11-F17]. Exemplars afford abstract art only because their brand and figures explain; a project without a brand gives that space to the product [FD11-F20].
- **Check:** firstview.contract (the `data-surface` marker); critic for the action shown.
- **Not when:** no live data exists yet: show labelled simulated data, never an empty state, on the first screen.

### BD-03 - Keep the first viewport simple
- **Rule:** Remove elements from the first viewport before you tune colours. Keep its complexity inside the band of the category's exemplars.
- **Why:** Visual complexity registers at 17 ms with the larger effect, and pages low in complexity and high in prototypicality were rated most beautiful [FD11-F02]. Complexity outweighs colourfulness [FD11-F03]. A JPEG-size proxy measures it from a screenshot, and texture or photographs inflate it without adding clutter [FD11-F05].
- **Check:** firstview.complexity
- **Not when:** the proxy is high only because of a real product capture or a fine data grid: judge the element count, not the number.

### BD-04 - Make the page complete at rest
- **Rule:** Everything meant to be read is visible once the page has loaded. No H1, sentence or figure starts at opacity 0, no section waits for a scroll observer, and the hero is sized to its content, not to the viewport height. Motion answers real events only (`08-motion.md`).
- **Why:** "Make the page complete at rest": nothing waits at `opacity: 0` for an observer, and a `100vh` opener pushes the rest of the page out of the first frame [FD15-F09]. NN/g saw scroll-triggered text animations slow users down and advises against animating the headline or tagline [FD11-F32].
- **Check:** motion.hidden-at-rest, motion.reduced
- **Not when:** a section may animate in from a visible resting state [FD15-F09].

### BD-05 - Put nothing a judge needs behind hover
- **Rule:** Explanations, values, statuses and proofs render at rest. A tooltip may only repeat what is already visible, such as the full value behind a truncated hash.
- **Why:** Orma's spec ruled explanations "Always visible" because "Judges do not hover" [FD11-F27], and a recording cannot hover either [FD11 Derived principles]. Hover-only content is absent from a recording unless someone scripts the hover [FD20-F15].
- **Check:** recording.g11 when the profile has a video; critic otherwise.
- **Not when:** the full address or hash behind a truncated one, which also sits in the accessible name (`07-states-web3.md`).

### BD-06 - Give every catalogue feature a surface, a heading, a proof and a status
- **Rule:** For each feature id in the catalogue, render one surface whose root carries `data-feature="<id>"`. Give it a heading that names the feature and its result, readable without the body; a proof (a claims-ledger id, a transaction link or a live value); and a visible status label with `data-status` set to live, testnet, simulated or planned.
- **Why:** Viewers take one purpose from a first look; secondary purposes were named by 0 to 9% of viewers even with unlimited time [FD11-F14]. Descriptive headings produce the layer-cake scan, "by far the most effective way to scan pages" [FD11-F11]. BNB's catalogue found that "The page shows the measurement and hides the proof" [FD13-F08]. Aave labels one of its non-live figures "Simulated Rate", a disclosure applied inconsistently there and consistently here [FD11-F20].
- **Check:** coverage.features
- **Not when:** a catalogue row the owner kept off the page (a CLI or API surface) with a written decision [FD13-F08].

### BD-07 - Prove coverage on the rendered page, in record mode
- **Rule:** Coverage counts only elements visible in the rendered DOM after navigation in record mode (`?record=1`). Give each feature a record-mode fixture state that shows it. Never prove coverage by grepping source.
- **Why:** BNB's spec panel was missing from the web app while 920 tests were green, and the gate added for it passed on any one of three strings in source files [FD13-F09]. A string in a comment, a fixture or unreachable code passes a grep [FD13-F09].
- **Check:** coverage.features
- **Not when:** an empty state legitimately hides a panel: list the state in `design/routes.json` `states` and show the panel populated as well [FD13-F09].

### BD-08 - Put proof in the first two or three screenfuls
- **Rule:** Viewport 1 carries the identity and one sourced figure. The feature sections with their proofs follow in screenfuls 2 and 3, ordered by the judge's path. Below screenful 3 goes material for a judge who chose to dig.
- **Why:** 57% of page-viewing time falls above the fold, 74% in the first two screenfuls and 81% in the first three [FD11-F10]. Principle 5 of the dossier puts proof where 74% of viewing time goes [FD11 Derived principles].
- **Check:** firstview.contract for viewport 1; critic for the rest (no position gate yet).
- **Not when:** never.

### BD-09 - Trace every number to the ledger or a labelled source
- **Rule:** Render a figure, a superlative or a comparison only from a claims-ledger row marked verified (or backed) or from a live, testnet or simulated data source. Tag it `data-metric` plus `data-ledger="<id>"`, or `data-source` plus `data-as-of`. Show every ratio's denominator on screen. A row not yet verified renders the visible "not yet verified" state, never the figure. Render figures and strings from the backend or the spec verbatim; the UI never computes or invents a displayed figure.
- **Why:** Ledgers use verified, unverified and cut (or backed, re-verify, do-not-claim), and nothing ships as unverified [FD13-F10]. XRPL's spec: "If a number is not in those responses, it does not exist" [FD13-F20]. The T-6h audit hunts "a figure that cannot be recomputed from what is on screen" [FD13-F24]. Invented precise numbers are banned unless real or labelled mock [FD01-F12].
- **Check:** coverage.metrics
- **Not when:** dates, versions and ordinals that make no claim.

### BD-10 - Link the evidence and check links by rendering
- **Rule:** Show transaction hashes, contract addresses and data sources short and visible, each linked to its explorer or primary source. Add a caption that says who computed a figure when it is not the app. Verify each link by existence and rendering, never by HTTP status; templates and checks are in `07-states-web3.md`.
- **Why:** Linking third-party evidence builds credibility even when nobody follows the link, and broken links hurt it [FD11-F30]. Orma's caption "computed by the ledger, not by us" is the text form of the same idea [FD11-F30]. Explorers and single-page apps answer 200 for objects they render as not found [FD13-F24, FD18-F21].
- **Check:** critic (the FD18 explorer hooks, see `07-states-web3.md`)
- **Not when:** never.

### BD-11 - Show only real content
- **Rule:** No logo wall, testimonial, user count, partner strip or invented brand mark. No stock or placeholder photography: imagery is the product (captures, live components). No TODO, placeholder or lorem text anywhere a judge reads. Third-party logos appear only as `15-ip-provenance.md` allows.
- **Why:** Real company logos imply an endorsement a hackathon project does not have, invented ones are fabricated social proof, and placeholder slots are open gates [FD01-F12]. BNB's audit found ten deferral markers in pages a judge reads [FD13-F09]. A sponsor strip points to evidence, not to a logo wall of unrelated brands [FD11-F20].
- **Check:** coverage.placeholders, ip.logos
- **Not when:** never.

### BD-12 - Give each sponsor integration its own section with working proof
- **Rule:** Each sponsor technology the project uses gets a section that shows it working (a transaction, a workflow run, a signer prompt) with its proof link, stated plainly in text.
- **Why:** Partners judge from the submitted materials [FD11-F21], and DoraHacks warns teams not to make sponsors hunt for evidence of the integration [FD11-F25]. Ledger's prize text asks for "Concrete use of Ledger primitives, not just wallet branding", and the Origins rules make superficial integrations ineligible [FD21-F23].
- **Check:** coverage.features when the integration is a catalogue id; critic otherwise.
- **Not when:** never.

### BD-13 - Keep every claim as text on the page
- **Rule:** Every claim the page makes exists as text in the DOM, not only inside an image, a canvas, a chart or a video.
- **Why:** DoraHacks' AI judge reads the project page and the repository first, and organisers can let human judges skip what it did not recommend; its advice is that "the first two paragraphs" must carry the project's worth [FD11-F25].
- **Check:** critic
- **Not when:** a diagram may carry a claim when a text sentence beside it states the same claim.

### BD-14 - Build one demo path inside the browser
- **Rule:** Map every beat of the judge's path and of the storyboard to a route in `design/routes.json`, in order, reachable without leaving the browser. The core action works within the first 90 seconds of the path, and the path holds one contrast moment (before and after, or naive and correct).
- **Why:** The screen list is the union of the fold spec and every "on screen" cell of the storyboard, and every beat must be reachable inside the browser [FD13-F14]. MLH budgets about 2 minutes of demo per project per judge [FD11-F24]. Judges' accounts ask for one "oh, this is possible now" moment and something working within about 90 seconds (anecdotes, grade C) [FD11-F26].
- **Check:** critic
- **Not when:** never.

### BD-15 - Encode the naive-versus-correct pair the same way everywhere
- **Rule:** When the thesis is "the usual reading is wrong", define two semantic tokens and two classes, one meaning each: the naive reading muted with a dashed rule, the correct reading in the accent with a solid rule. Apply them wherever both readings appear (the split, the chart, the table column). Show both side by side, overlay them where they evolve over time, and print the computed gap, taken from the backend or the ledger, as the largest figure on screen. Label the dash convention in a legend. Name the tokens by meaning so a component library's init cannot overwrite them, and re-check the pair after every animation, theme or library change.
- **Why:** Orma's pair, its gap as the largest number, its audience vocabulary, and an audit added after an animation silently erased the naive line's dashes; `shadcn init` overwrote its first token names [FD11-F27]. Juxtaposition combined with explicit encoding is "particularly valuable" [FD11-F28]. Colour must not be the only channel (WCAG 1.4.1), and "dashed means uncertain" has only indirect support, so label it [FD11-F29].
- **Check:** critic (no deterministic gate yet, see Gaps)
- **Not when:** the thesis is not a comparison of two readings.

### BD-16 - Scan rendered text against the never-show list before every publish
- **Rule:** Before any deploy, publish, shared preview or recording, run the never-show scan on the rendered text of every route with embargo dates honoured, and run the project's own redaction script when one exists. Keep the list's plaintext outside the repository.
- **Why:** Upstream defines four never-show classes (do-not-carry, undisclosed security, never-public, dated embargo) and only one was checked, in files only [FD13-F11]. The live BNB board rendered findings the owner's memory said to hold until 11 Oct 12:00 UTC [FD13-F12].
- **Check:** coverage.nevershow
- **Not when:** an entry whose `until_utc` has passed is inactive (CONTRACTS 6.1b).

### BD-17 - Write a definition of done, a drop order and a never-drop list per screen
- **Rule:** For each screen write a DoD a person can look at and check, a drop order for running late, a never-drop list (the surfaces the two sentences and the judge's path rest on) and the fallback surface. Put them in the task report and in `receipts/` in the state directory.
- **Why:** XRPL's frontend tasks defined DoD as "a thing you can look at and check, not a feeling", ordered what to drop, listed what is never dropped and named a fallback ("the operator page becomes the demo"); /execution needs these to propose cuts and wait [FD13-F17].
- **Check:** owner review
- **Not when:** never.

### BD-18 - Build a section only on a frozen data contract
- **Rule:** Start a section only after its API contract and its fixtures or committed payloads exist, and build against them. In mode B the running app's own data is the contract.
- **Why:** In November 2025 every page a collaborator built was discarded because its routes and data shapes were imagined; XRPL's fix was a frozen contract and a real fixture server [FD13-F20].
- **Check:** owner review (in mode A the section task depends on the feature's own task)
- **Not when:** never.

### BD-19 - Stop polishing at a competent shipped product
- **Rule:** Once the page reads as a competent shipped product and the gates pass, spend the remaining time on proof and coverage, not on visual polish.
- **Why:** The 50 ms judgement was shown only on clearly good and clearly bad pages and says nothing about ranking good ones [FD11-F01]. One ETHDenver 2023 judge reports no score for polish beyond "an average shipped product" (anecdote) [FD11-F26].
- **Check:** critic
- **Not when:** a critique round found a measured defect: fix it (`12-critique.md`).

## DOM markers the checks read (CONTRACTS 6.6)

| marker | on | meaning | rule |
|---|---|---|---|
| `data-feature="FR-003"` | the root of a feature's surface (the spec's requirement id) | coverage: visible in record mode | BD-06, BD-07 |
| `data-status="live\|testnet\|simulated\|planned"` | the feature's status label | honesty label | BD-06 |
| `data-metric` | an element showing a figure meant as a claim | must also carry `data-ledger` or `data-source` | BD-09 |
| `data-ledger="C-012"` | a claim backed by the claims ledger | traceability | BD-09 |
| `data-source="live\|testnet\|simulated"` + `data-as-of` | a figure from a data source | provenance and time | BD-09 |
| `data-proof="C-012"` | a transaction link, hash or receipt | proof display | BD-10 |
| `data-hero="h1"`, `data-hero="sentence"` | the first-view headline and sentence | equal to `brief.hero` | BD-01 |
| `data-surface="product"` | the product shown in the first view | first-screen contract | BD-01, BD-02 |
| `data-concept-label` | the disclaimer beside any concept frame naming a company | `ip.concept-label` | `15-ip-provenance.md` |
| `data-rec-role="key\|decor"` | text a judge must read in a recording, or decoration | recording gates | `09-recording.md` |
| `window.__FRONTEND_READY__ = true` | set by the app when its data is loaded | readiness when `ready_flag` is on | BD-07 |
| `?record=1` | URL parameter: named demo data, fixed clock, no loops, hover content at rest | record mode | BD-07, `09-recording.md` |
| `data-brand="<stem>"` | an inlined copy of `brand/<stem>.svg` | `brand.drift` compares it with the file | `04-brand.md` |
| `data-live` | an element that shows live state | the only place an infinite animation may run | `motion.inventory`, `recording.g12`, `08-motion.md` |

Each `data-feature` root also needs a visible heading and, unless its status is `planned`, a visible `data-proof`, `data-ledger` or `data-source` inside it (`coverage.features`, BD-06). `data-source` with `data-as-of` may sit on the nearest enclosing data region (CONTRACTS 6.6 v1.1).

## Procedure

Build section by section from the feature catalogue (`paths.feature_catalogue`, CONTRACTS 6.1b), never page by page from a template.

1. Read `brief.json` (hero, features, claims, never_show, judge_path) and `design/routes.json`. A missing field becomes a manual task (mode A) or a question (mode B), never a guess (`01-brief.md`).
2. FE-08, shell and first screen: build BD-01 to BD-05 from `design/tokens.json` (`05-tokens.md`). Proof:
   `pnpm -C <ui> build && node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates render,firstview --serve <ui>/dist --profile <abs profile>`
3. FE-1x, one task per feature group, once the feature's own task and its data contract are done (BD-18): for each id build BD-06 and BD-09 to BD-13, map the id to its route in `routes.json`, and add the record-mode fixture state that shows it. Proof:
   `pnpm -C <ui> build && node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates coverage,render,tells --features FR-003,FR-007 --serve <ui>/dist --profile <abs profile>`
   For an app that needs a server, replace `--serve` with `--url <url>` or `--start "<cmd>" --url http://127.0.0.1:<port>` (CONTRACTS 4).
4. After each group, write its screens' DoD, drop order and never-drop list (BD-17).
5. With every group in: walk the demo path (BD-14), place the proofs (BD-08), add the naive-versus-correct pair if the thesis calls for it (BD-15).
6. Before any deploy, shared preview or recording: BD-16, then the full proof with `--phase {mode}` (`build` in full mode, `small` in small mode; `10-gates.md`).
7. Export the rendered UI text for /prose (`14-copy.md`).

## Gaps
- **Charts and diagrams are an unresearched delegation.** ARCHITECTURE P5 sends charts through the built-in dataviz skill with the project's tokens and mechanism diagrams through artifact-diagramming's inline-SVG method, both still passing the checker and the 3:1 non-text contrast gate. No dossier examined either skill [critic M9]. Until one does: load the skill, swap its placeholder palette for `design/tokens.json`, and run the gates on the result.
- No deterministic gate yet checks the naive-versus-correct pair (BD-15), the demo path (BD-14) or the position of proofs below viewport 1 (BD-08); critics carry them.
- CONTRACTS names no file for a screen's DoD, drop order and never-drop list (BD-17); `receipts/` is used until it does.
- No study covers first impressions of crypto sites or hackathon juries; the academic results are extrapolated from company, bank, shop and university pages [FD11 What could not be found].
- The exemplar captures behind BD-01 are one snapshot per site, from a French IP, at one desktop size [FD11 Weak spots].
