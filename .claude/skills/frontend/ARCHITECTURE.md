# /frontend: architecture proposal v1

Status: APPROVED (owner decisions of 2026-10-01, §14); built as v1 on 2026-10-01 and reconciled as contract v1.1 on
2026-10-11 (`CHANGELOG.md`, `scripts/CONTRACTS.md`). Where this proposal and CONTRACTS v1.1 or a reference file
disagree, those win.
Decisions: (1) mode A task templates from the start of /execution's build, its simple-UI path dropped; (2) copying
limited to conventions and measured relationships; (3) owner review of directions and logo on a private Claude
Design canvas; (4) full v1 with calibration and A/B evaluation before the flight. Remaining §14 defaults stand
unless the owner objects.
Evidence: the dossiers in `research/` (each dossier's `## Verification notes` override its body). Citations such
as [FD13-F03] point at a finding id; [FD13] alone points at a dossier. FD01-FD17 were verified on 2026-09-30
(273 verified, 215 corrected, 6 downgraded, 29 added); FD18-FD21 (wallet and transaction states, capture etiquette,
recording readiness, sponsor brand kits) on 2026-10-01 (50 verified, 50 corrected, 1 downgraded, 4 added).

---

## 0. What it is, in one paragraph

`/frontend` builds the judged surface of a project so that a jury understands at first sight what it is, what it
does and what it fixes. Every feature of the protocol gets a visible surface with its proof. The look is borrowed
from the conventions of the category the sponsor's customers belong to, never from one company's expression. The
result must not read as AI-generated, and that is checked by a calibrated, deterministic checker plus fresh-context
critics rather than by the builder's own taste. It runs inside `/execution` as task templates during the build
(mode A), or by hand on an existing project (mode B), with one contract and one proof command for both.

Non-goals: it never records the demo video, writes the pitch or README headline, or flips a repo public (owner rule
of 24 Sept: no deliverable before the build is proven complete); it never duplicates `/harden` (security, hooks,
keys, bundle hygiene) or `/prose` (Markdown prose); it never publishes a concept mockup of a real company.

---

## 1. Why it is built this way (the research in eight lines)

1. **Typical beats novel for trust.** Pages low in complexity and high in prototypicality were rated most beautiful
   (Tuch 2012, effects from 17 ms); prototypicality also predicts trust (Miniukovich & Figl 2023); novelty helps only
   while typicality holds (MAYA) [FD11-F02, F06, F08]. So borrow the category's conventions; put the novelty in the
   mechanism and the proof.
2. **But expression is protected.** Ideas, conventions and functionality are free; a site's arrangement, text,
   images, logos, fonts and code are not; French parasitism needs no originality (CA Paris 16 Dec 2022, EUR 20k for
   copied sections "même si chaque élément apparaît comme banal"); unregistered EU design now covers GUIs and logos
   [FD09]. Anthropic's Design type refuses to recreate another company's proprietary design [FD07, FD15].
3. **The 20 tells are a hypothesis, not a measurement.** They come from one Instagram reel (Quoc Ly, 2026-08-30)
   [FD10-F01]. Several fire on human-designed category exemplars (Inter on Chainlink body text, a label above the
   H1 on Aave and Stripe, purple washes on Aave, Lido and Stripe, a gradient H1 and glass nav on Ethena) and the
   sponsor Hedera's own brand is a purple-to-blue gradient [FD11-F19, FD14]. Only calibration can say which tells
   discriminate.
4. **The builder is Claude, whose current defaults are not in the owner's list.** Anthropic's own skill now names
   cream #F4F1EA, clay #D97757, ALL-CAPS eyebrows, "WORD — fragment" labels, 01/02/03 markers and "→" suffixes
   [FD15]; a generic ban only swaps one default for another [FD15-F03].
5. **No existing tool is enough.** impeccable's deterministic engine caught 12 of the 20 tells at best, a different
   subset per mode, and fired on professional sites [FD02]; taste-skill is 87K characters, most of it lost after
   compaction, and its sibling skills prescribe several tells [FD01-F17, F20]; Vercel's guideline skill is a
   hygiene layer that addresses 1 tell directly [FD04].
6. **Model critics are weak on taste.** About 51.6% for GPT-4V on designer-ranked pairs, about 70% for the best web
   judges against 84.6% human agreement; pairwise comparison, binary checklists and code plus screenshots help;
   gains come in round 1 and degrade after 2-3 rounds without an acceptance rule [FD17, FD08].
7. **Figma MCP fits a Figma file, which we do not have**; a controlled test measured no fidelity gain (0.744 vs
   0.741) [FD07-F15]. Claude Design is already here and suits exploration and phone review, not the build [FD07].
8. **Inside a workflow agent there is no Agent, no Workflow and no AskUserQuestion** [FD13-F03], so critics are
   separate agent definitions and owner questions are tasks.

---

## 2. Position and modes

```
/hackathon Phase A --> validated spec --> /execution plan (includes /frontend task templates, mode A)
                                              |  direction + brand early, sections with the features,
                                              |  gates as proofs, critique before build-complete
                                              v
                              build complete + frontend-check green + harden-ready
                                              |
                              /harden --> review --> owner sign-off (H3) --> record --> /prose --> ship

mode B: the owner types /frontend in a project that already has a UI (for example BNB Holdover), main thread.
```

- **Mode A (task templates in /execution).** `/frontend` ships task templates (§12) that `/execution`'s planner uses
  in place of its generic UI template, so the UI is built once, in the chosen direction, alongside the features. The
  owner's three choices become decision tasks. Critics and probes are `agent({agentType})` calls in `/execution`'s
  wave scripts. Proofs are `frontend-check` commands.
- **Mode B (standalone).** The same phases in the main thread: `/frontend` may launch its own Workflows (captures,
  directions, sections, critique) and ask with AskUserQuestion.
- **Small mode** (an event with 1-2 h of UI budget, for example Origins [FD13-F26]): brief, 1-2 directions, a
  wordmark, one static page, the essential gates, at most one critique round.
- `disable-model-invocation` stays unset (a narrow description instead), so /execution's agents can load it
  [FD13-F02]; its standing rules sit in the first 5,000 tokens of SKILL.md, the part re-attached after compaction
  [FD13-F04, FD01-F20].

---

## 3. Inputs: the frontend brief (phase 0)

`/frontend` never invents an input. It discovers each one by glob from the workspace root, records the path found,
and turns every missing input into a manual task (mode A) or a question (mode B) [FD13-F05].

| input | typical location (from five real workspaces) | if missing |
|---|---|---|
| two sentences (what is broken, what we did) | `research/**/_recommendation.md`, pitch notes, SPEC | manual task: owner writes them |
| the gap and who loses money | `findings/**/_summary.md`, `known-behaviour.md` | read from the spec's problem section |
| sponsors, strategy, customers | `findings/**/l5-customers.md`, landscape files | manual task |
| customers' official URLs | none of the five workspaces records one [FD13-F06] | proposed with a source, owner confirms |
| use case (named institution, numbers) | `_recommendation.md`, SPEC | from the spec |
| feature catalogue with ids | `FEATURE-CATALOGUE.md`, spec FR-xxx, routes, contract functions | derived from the spec, then from code [FD13-F08] |
| claims ledger | `claims.md` (Phase B) | numbers render only as "not yet verified" placeholders |
| never-show list (do-not-carry, undisclosed security, never-public, embargo with until date) | memory notes, `redaction` files | manual task; nothing publishes until it exists [FD13-F11] |
| judge's path, storyboard, demo beats | runsheet, `45-RUNSHEET.md`, spec demo beats | from the spec |
| event profile | `/execution`'s `profile.json` plus the `frontend` block (§12.3) | asked once |

Output: `brief.md` (human) and `brief.json` (machine), each field with its source path. The hero text is read from
the two-sentences source, and a gate checks it stays identical [FD13-F07].

---

## 4. Phases

| phase | does | output | owner |
|---|---|---|---|
| P0 brief | discovery, compilation | brief.md/json | |
| P1 references | capture 2-4 category sites, extract conventions | pattern ledger (private workspace) | confirms URLs |
| P2 directions | 2-3 named directions, each a token plan plus one hero comp at two viewports | direction board | **H1 picks** |
| P3 brand | wordmark-first mark, 3-5 candidates, favicon set, OG image | `brand/`, icons | **H2 picks** |
| P4 tokens | one tokens file, views generated from it | tokens.css (+ @theme), DESIGN.md | |
| P5 build | app shell, first-screen contract, one section per feature group | UI code | |
| P6 gates | `frontend-check` | gate JSON | |
| P7 critique | bounded rounds, separate critics and blind probes | critique history | |
| P8 hand-over | receipts, UI copy export for /prose, clean tree | receipts | **H3 signs off** before any recording |

### P1: references: ideas, not expression
- Pick 2-4 sites from the brief's customers (plus the sponsor if useful), one reference page per site, the page
  closest to the surface being built; never merge tokens across pages of different design generations [FD05].
- Capture with the skill's pinned Playwright scripts: two viewport-sized shots per page, one at 1440x900 and one at
  390x844 (FD19 P11; never tall full-page images: they do not scroll, and the critic's images are capped at 2576 px
  [FD06-F13]), a computed-style tally, CDP-reported rendered fonts, a reveal probe; explicit readiness waits, never
  `networkidle` [FD17].
- Capture policy [FD19]: honour robots.txt for the captured paths, never defeat a bot wall; when the gate refuses,
  the only fallback is the owner's own notes in words and numbers, never an owner screenshot, an extension export or
  an archive copy (P9, P15, P16). Keep captures outside every git work tree and synced drive, never in the product
  repo (P12), and purge them with a deletion receipt as soon as the pattern ledger passes, at the latest at the end
  of the event (P13). Details: `references/02-references.md` RF-04 to RF-12.
- Output a **pattern ledger**: conventions (nav, CTA count, figures row, density, section order types), relationships
  (type-scale ratio, spacing rhythm, radius family, neutral ramp depth, accent count, light or dark ground), domain
  conventions (how amounts, addresses and transactions are shown) and measured facts, each pattern drawn from at
  least two unrelated references. Never carried downstream: pixels, logos, names beyond plain text, copy, imagery,
  licensed font files, exact brand hexes, one site's full section sequence [FD09, FD08].

### P2: directions
- 2-3 genuinely different named directions, each anchored in a different source (customer A, customer B, the
  protocol's domain, a utilitarian one), each stated as a token plan (4-6 named colours with roles, type roles,
  radius and spacing, motion budget, one signature element such as Orma's naive-dashed versus correct-solid pair
  [FD11-F28]) plus one hero comp with the real copy at 1440x900 and 390x844 [FD15].
- Each direction is screened by the checker, and by a "similar prompt" test: regenerate a plan from a generic brief
  and flag identical tokens as generic [FD15].
- A ledger of past directions across projects rejects near-duplicates of an earlier look [FD15].

### P3: brand
- Wordmark first: the protocol name in an open-licensed typeface (check OFL.txt for a Reserved Font Name before any
  subset [FD16-F30]) with exactly one intervention; the favicon mark derived from it on a 32-unit grid. A separate
  symbol only for a written reason [FD12].
- 3-5 candidates rendered at 16, 32, 180 and 512 px plus one-colour silhouettes on light and dark; mark lint (no
  gradient, no hexagon or cube, no `<text>`, strokes not thinner than viewBox/16, no struck-through initial); the
  model reviews defects only, at most 2-3 rounds; the owner picks, never a model score [FD12-F09].
- Deliverables: `brand/` (mark.svg with currentColor, mono, lockup, README with meaning, font licence and
  provenance), favicon.ico (one 32 px entry), icon.svg with a dark-mode rule that survives SVGO (inlineStyles:false),
  apple-touch-icon 180, manifest 192/512/maskable with a computed safe radius, og.png 1200x630, and a drift test
  [FD12-F24, F25]. Default framework favicons are detected by normalised hash [FD12-F27].
- Name and lookalike checks report only, never "clear", and never register anything without the owner [FD12].
- Events that forbid designs before kickoff get no visual before T0 (Origins) [FD09-F27].

### P4: tokens
- One tokens file in the repo is the single source: CSS custom properties, mirrored into Tailwind `@theme` after
  namespace resets when Tailwind is used, so no default palette, radius, shadow or font leaks [FD16].
- Colour from the brand hue in OKLCH (Leonardo, targets 3, 4.5 and 7), a token-pair contrast table at build time
  (axe cannot see non-text contrast, gradients or image grounds) [FD16].
- Type: at most two families plus a monospace with a role, self-hosted, licence files shipped, tabular figures
  checked for any face that shows numbers [FD16].
- Motion tokens: ease-out curves and role budgets (press 100-160 ms, tooltip 125-200, dropdown 150-250, modal
  200-300) [FD03]; static by default.
- DESIGN.md (Google's alpha format plus a Motion section) and an optional Claude Design "Design System" mirror are
  generated views, never sources [FD05, FD07].

### P5: build
- **Feature map.** Every catalogue feature id gets a heading, a visible surface marked `data-feature="<id>"`, a proof
  (claims-ledger id, transaction link, live value) and a status label: live, testnet, simulated or planned [FD11,
  FD13-F09].
- **First-screen contract.** An H1 of about 2-6 words, one sentence naming user, action and object in the customers'
  vocabulary, one sourced live figure, and the product itself visible, ideally the core action running on labelled
  testnet data [FD11, FD15]. Nothing important behind hover.
- **Proof display.** Middle-truncated hashes linking to explorers whose links are checked by rendering (explorers
  answer 200 on not-found) [FD13-F24]; every rendered number traced to a ledger id; no invented testimonial, logo,
  user count or statistic, ever [FD01-F12, FD10].
- **States.** Transaction lifecycle, loading with show-delay and minimum duration, empty and error states that say
  what to do [FD18].
- **Copy** comes from the brief: CTA verbs that say what happens, sentence case, the same action name through the
  flow; the rendered UI text is exported to Markdown for /prose [FD15, FD13-F23].
- **Motion:** only for real state changes (for example a 120 ms cell flash on a real value change); no content hidden
  at rest, no scroll-triggered entrances on text, no pointer-coupled effects by default, press feedback instead of
  hover fades [FD03, FD14].
- **Charts** go through the built-in dataviz skill with the project's tokens; mechanism diagrams follow
  artifact-diagramming's inline-SVG method; both pass the checker and the 3:1 non-text contrast gate.
- **Recording readiness** from the profile: legible after downscaling, record mode, no hover-only content (§11b,
  [FD20]).

---

## 5. The checker: `frontend-check`

One Node command, offline, frozen data, `--json` output shaped `{ok, gates:[{id, title, ifDropped, state, detail}]}`
with three states, `ok`, `fail` and `skipped`, where skipped never counts as passing (the owner's BNB
completion-check reports a skipped gate as ok [FD13-F16]). It is the proof command in both modes and stays out of CI
while red by design (CLAUDE.md rule 2).

| gate group | checks |
|---|---|
| render | build ok, no console errors, no failed or 4xx requests, fonts actually rendered (CDP), images decoded, no horizontal overflow at 320 and 375, no clipping, CLS at most 0.1 [FD17] |
| a11y | axe wcag2a to wcag22aa, contrast with axe "incomplete" resolved by pixel sampling, 24 px targets; always run, because /harden's lens skips pages built without a framework [FD13-F22, FD17] |
| coverage | every feature id visible in frozen mode, every rendered number carries a ledger id, hero equals the two-sentences source, never-show list clean on rendered text with dates honoured, no TODO, placeholder or lorem |
| first view | H1, one explanatory sentence, the sponsor name and one sourced number in the first viewport; visual-complexity proxy within the category band (calibrated) [FD11] |
| tells | the rule registry below |
| brand | favicon set complete and not a template default, dark-mode rule present in icon.svg, OG dimensions, drift test |
| ip | fonts under OFL, Apache, UFL or MIT with licence files; no Google Fonts hotlinks; no third-party logo outside the sponsor allowlist; provenance complete; concept label on any frame naming a company; long word overlap with captured customer copy flagged [FD09] |
| motion | content visible under reduced motion, animation inventory within the budget, no content hidden at rest [FD03, FD06] |
| recording | when the profile has a video: smallest rendered text after downscaling, hover-only content [FD20] |

### 5.1 The rule registry (the anti-slop part)
- Each rule has an id, a static detector (comment-stripped TSX, JSX, CSS, HTML, package.json), a runtime detector
  (computed styles, geometry, `getAnimations()`, an IntersectionObserver wrapper, CDP event listeners and rendered
  fonts), a tier, the finding it rests on, and a calibration record. The runtime result is authoritative; only
  rendered usages count [FD10, FD14].
- Rule families: the owner's 20 tells; the Claude-era clusters (cream, serif display and clay; eyebrows on every
  section; 01/02/03 on non-sequences; "→" suffixes; middle-dot meta strings; big-number hero; everything centred;
  pill buttons) [FD15]; generator scaffolds (Figma Make signatures, untouched shadcn tokens and `hover:bg-primary/80`,
  create-next-app and create-vite leftovers) [FD14, FD16]; invented content; motion signatures [FD03].
- Tiers: **tier 1** (fails the gate) only for a rule that fires on the positive corpus and stays silent on the
  pre-2023 human controls; **tier 2** (passes only with a written reason in `frontend/waivers.json`, tied to the
  research: a sponsor's brand, a category convention); **advisory**. Scoring uses co-occurrence with anchor rules, so
  one weak tell never blocks [FD10-F12].
- Scopes found by the research: tell 18 applies to display text only (Emil Kowalski's own blog sets prose emphasis
  in serif italic [FD03-F31]); tell 6 to cards, not frosted navigation bars; tell 1 through a sponsor allowlist
  (FD21); tell 16 on rendered text only, with a minimum word count (most source em dashes sit in code comments
  [FD14]).
- The builder is told the direction and the failure shapes, not literal lists of bad examples, until an ablation
  settles it (impeccable's deleted ablation found that listing examples primed them) [FD02-F33, FD15-F03].

### 5.2 Calibration (the /prose standard)
- **Positive corpus:** the owner's past frontends with the owner's labels (a 15-minute session: per screen,
  vibecoded or not, and which tells), rendered locally or from deployments and frozen with HAR record and replay;
  plus synthetic positives from unguided Opus 5.5 runs on past briefs, which also covers tells 3, 18, 19 and 20
  that never fully fire in the owner's corpus [FD14].
- **Controls, two sets:** pre-2023 designer work (11 pinned repositories found by FD14) decides tier 1; current
  category exemplars (the 10 protocol and fintech first viewports captured in FD11, plus the customers of each event)
  feed per-category allowlists, not tiers.
- `calibrate.mjs` stores, per rule, fires-on N of M positives and silent-on the controls, as JSON next to the
  registry; any rule change re-runs it.

---

## 6. Critique (P7)

- Two read-only agent definitions installed in `~/.claude/agents/` (harden-style templates): `frontend-critic`
  (three fresh passes per round) and `frontend-probe` (five blind first-viewport readers with no context, asked what
  it is, what it does and for whom). They are separate `agent({agentType})` calls, never the builder.
- Input: DOM-marked viewport tiles at 1440x900 and 390x844 (DPR 2, animations disabled), element metadata and a
  binary checklist derived from the brief. Never ask a model for coordinates or pixel measurements; geometry comes
  from the DOM [FD17].
- An issue is kept only if two critics raise it or a deterministic check confirms it; at most five per round, each
  with a mark id, the measured problem and a concrete fix.
- Acceptance: every gate still passes, no deterministic sub-score drops, and the candidate wins a pairwise
  comparison against the best-so-far. Otherwise revert to the best-so-far snapshot. At most N rounds from the profile
  (default 3, small mode 1), stop after two rejected candidates [FD17, FD08].
- Blind probe pass: at least 4 of 5 probes restate the brief's one-line proposition.

---

## 7. Owner checkpoints

Three, and only three: **H1 direction**, **H2 logo**, **H3 sign-off** of the deployed preview at recording size
before anything is recorded [FD17]. Mode A: decision or manual tasks in /execution's plan (Notion row, push, answer
from the phone), the frontend lane waits and every other lane keeps running. Mode B: AskUserQuestion. The review
surface is a profile field: a local board rendered to images, or a private Claude Design canvas when the owner wants
to view and comment on the phone (§9).

---

## 8. Outputs and where they live

| output | where |
|---|---|
| brief, pattern ledger, direction board, critique history, gate JSON, screenshots | mode A: `.execution/frontend/` (private state repo); mode B: `.frontend/` (gitignored) |
| reference captures of third-party sites | outside every git work tree and synced drive (`--out`, else `<workspace.private_dir>/frontend/captures`, else `<os tmp>/frontend-captures`), purged with a deletion receipt once the pattern ledger passes |
| tokens, brand files, icons, UI code, DESIGN.md view | the product repo |
| rendered UI copy for /prose | `.execution/frontend/ui-copy.md` or `.frontend/ui-copy.md` |

Before hand-over every output is committed or ignored, because /harden needs a clean tree and would freeze pixel
snapshots it found [FD13-F21]. README screenshots stay /execution's last task.

---

## 9. Tools

- **Playwright:** one pinned Node toolchain inside the skill (`scripts/package.json` with a lockfile:
  playwright-core and @axe-core/playwright, pointed at the installed Chromium, no browser download), so every gate and
  every calibration run use the same browser build [FD06; critic C4, research/_critic-round1.md]. The `@playwright/cli` the owner found is kept
  for agents' ad-hoc inspection; it pins an alpha Playwright and costs about twice the turns of the MCP in the one
  measurement found, so gates never depend on it [FD06-F21].
- **Claude Design:** optional review surface for H1 and H2 (a private Design canvas written from our tokens and
  SVGs, never "designed" by the canvas, whose instructions admit a cream, serif and clay habit) and an optional
  Design System mirror of the tokens. It shares the Claude Code usage pool; autonomous agents never read tokens back
  from claude.ai; DesignSync stays the owner's own `/design-sync` step [FD07-F19, F27].
- **Figma MCP:** not in the default path; an optional adapter only when a sponsor ships a structured Figma kit
  (get_variable_defs for values, never React output) [FD07].
- **Third-party skills:** none installed whole. Rule text is vendored at pinned commits with its licence notice:
  taste-skill (MIT), impeccable (Apache-2.0, NOTICE, and Anthropic's notice for text descending from
  frontend-design), Vercel's Web Interface Guidelines (MIT), Emil Kowalski's skills (MIT) [FD01, FD02, FD03, FD04].
  As built, only impeccable's rule data is adapted (detectors SL-T01, T02, T05, T16, T17 and others); its licence,
  NOTICE and the list of adapted files are in `assets/licenses/` (THIRD-PARTY-NOTICES.md), and vendoring from any
  other project adds its entry there in the same change.
  impeccable's signed engine may run as an advisory instrument with telemetry and update checks off, never as a gate.

---

## 10. Stack defaults (a profile field, overridable)

- No server needed: Vite 8 + React 19 + Tailwind 4 static SPA, namespace resets first; Next 16 only when the spec
  needs a server (static export rejects Server Actions and more) [FD16].
- Small mode or an existing app: plain HTML and CSS on the existing server (BNB is template strings; the Origins
  plan is a static page) [FD13].
- shadcn only re-themed (never `--defaults`), or Base UI / Radix primitives styled from the tokens [FD16].
- Icons: none by default, labelled when used, one set at one weight [FD16].
- Fonts: open-licensed, self-hosted, no hotlinks; faces on the dated reflex lists need a written reason, not a ban
  [FD16-F14].
- Wallet UI: an own connect dialog on the chain's hooks (EVM: wagmi; Cardano: raw CIP-30), themed from the tokens;
  never a prebuilt connect component in a judged demo (§11b) [FD18].

---

## 11. Motion and copy rules

Motion: purpose and frequency first (a UI seen a hundred times a day does not animate), ease-out, transitions over
keyframes, no bounce, reduced motion gentler rather than off, no scroll reveals on text, no cursor beams, press scale
0.97 [FD03]. Copy: no invented numbers, no praise words, em dashes measured on rendered text, sentence case, verbs that
say what happens, NN/g's competitor-swap and opposite tests for the value proposition [FD11, FD15].

---

## 11b. What the second research round adds (FD18-FD21)

- **Wallets and transaction states [FD18].** Prebuilt Cardano connect UIs show their defaults to a jury (Mesh's
  dialog prints "Powered by Mesh SDK"; the Cardano Foundation button falls back to `alert()` and "Awesome DApp"), so
  the dialog is ours, on raw CIP-30, and the checker greps the build for those strings. One state machine keyed on
  CIP-30, EIP-1193 and Ledger DMK signals; one `role=status` live region per transaction panel, `role=alert` only for
  blocking states; a review screen before signing. `getNetworkId` cannot tell preprod from preview, so the network
  gate also asks the app's provider. Pending copy follows measured block times (Cardano preprod mean 22.7 s, p99
  about 111 s): "usually about 20 seconds", then "taking longer" near 60 s. Explorer links are checked through an
  indexer, never by HTTP status (Cexplorer answers 200 for a fake hash; Cardanoscan and BscScan answer Cloudflare
  403 to headless browsers). Addresses: full on review and confirm screens, elsewhere at least prefix plus 8...8 with
  the full value in the accessible name (address poisoning matched up to 20 hex digits). Amounts from BigInt or
  decimal strings (the lovelace supply exceeds MAX_SAFE_INTEGER); testnet values carry a network badge and a "t"
  unit, never a fiat conversion. Ledger: the Device Management Kit (LedgerJS is deprecated), a panel mirroring what
  the device asks, WebHID from a click in desktop Chromium, the Ledger name in instructions only, never its logo.
- **Capture etiquette [FD19].** Every reference capture goes through one gate (adapted from
  `research/_scripts/fd19/capture-gate.mjs`): robots.txt evaluated for the skill's agent and Claude-User; stop on
  401, 403, 407 or 429; TDMRep, ai.txt and terms that forbid automated access are stops; a recorded terms review
  before anything is stored; no user-agent swap, headed mode, proxy, stealth or retry after a block (EU Directive
  2013/40 ties the offence to infringing a security measure; French C. pen. 323-1 and 323-7 punish the attempt; a
  stealth crawler was delisted by Cloudflare for this pattern). On a bot wall, the fallback is a person's own notes.
  Captures live outside any git work tree with a SHA-256 manifest and are purged once the pattern ledger is written,
  with a deletion receipt. Keep 6-8 candidate sites per category, since bot walls stopped 2 of 4 famous brands.
- **Recording readiness [FD20].** A record mode (`?record=1`): named demo data with visible live, testnet or
  simulated labels and an as-of time, a fixed clock, no grain, loops, marquees or pointer effects, hover content
  shown at rest. Key text marked `data-rec-role="key"` must keep about 6.5 px of x-height in a 540p frame (about 24 px
  at 1080p); other text a judge reads at least 16-18 px. First screen laid out for 1536x864 CSS px, recorded at 125%
  zoom. No dark gradient backgrounds or grain on recorded screens (banding after encoding; grain was erased or cost
  48% more bytes). Projector events: light surfaces or 7:1 text, key text 32-48 px. A blind model read checks only
  whether the 540p first frame carries the message, never legibility. A 97-2003 .ppt turns embedded video into a
  still picture, so "ppt or keynote" means .pptx or .key, to confirm with the organisers.
- **Sponsor marks [FD21].** `assets/sponsor-allowlist.json` covers ten parties. Logos are text-only by default;
  Cardano allows its unaltered official logo with a TM notice, Solana's unaltered files are inferred to be allowed,
  Chainlink needs written consent, BNB asks for the proposed use first, Ledger's terms forbid reproducing its logos,
  and the TOKEN2049 wordmark needs approval. Tell 1 exempts a gradient only inside a hash-matched official file,
  never by colour. Copy lint per sponsor (for example no "Cardano's", "Powered by Chainlink", "Token2049"), a
  logo-treatment gate (no transform, filter or animation; minimum sizes; never the largest element), a lockup gate
  and a naming blocklist. Fonts shipped in sponsor kits (ABC Diatype, Brut Grotesque) are never used. Kits are
  re-fetched and re-hashed before each event.

---

## 12. Contract with /execution (to send to the session building it, after approval)

The agreed and built form lives in `assets/task-templates/frontend.json` (the templates /execution instantiates),
`scripts/CONTRACTS.md` (flags, gates, file formats) and `CHANGELOG.md` (every shape change, relayed by the owner).
This section is the summary; where it and those files differ, the files win.

### 12.1 Task templates (mode A)

| id | kind | depends on (resolved at instantiation) | proof (`frontend-check --json ...`) |
|---|---|---|---|
| FE-00 brief | code | spec approved | `--gates brief` |
| FE-01 confirm reference URLs | manual (owner) | FE-00 | file: the profile's confirmed references |
| FE-02 references | research | FE-01 | `--gates refs` (ledger, capture receipts) |
| FE-03 directions | code | FE-02 (references on) or FE-00 (off) | `--gates directions` |
| FE-04 pick direction (H1) | decision | FE-03 | file: `{state}/choices.json#/H1` |
| FE-05 brand candidates | code | FE-04, plus `decision:project-name` while the name is not final | `--gates brand.candidates` |
| FE-06 pick logo (H2) | decision | FE-05 | file: `{state}/choices.json#/H2` |
| FE-07 tokens | code | FE-04 and FE-06 | `--gates tokens,ip.fonts,ip.hotlinks` |
| FE-08 shell and first screen | code | FE-07 | `--gates render,firstview,coverage.hero` |
| FE-09 brand files, favicon set and OG image | code | FE-06 and FE-08 | `--gates brand,ip.fonts,ip.provenance,ip.sponsor-marks` |
| FE-1x section per feature group | code | FE-08 and the build tasks whose covers meet the group (small mode: one task after FE-09) | `--gates coverage,render,tells --features <ids>` |
| FE-20 critique | gate | every FE-1x and FE-09 | `critique.mjs --verify-receipt`, then `--phase {mode}` |
| FE-21 sign-off (H3) | manual (owner) | FE-20 and `manual:harden-review`, before any recording task | file: `{state}/choices.json#/H3` |

FE-09 was added at build (2026-10-01): no other task emitted `brand/`, the favicon set and `og.png` after H2, yet the
build phase gates them (references/04-brand.md steps 9-11). It stays in small mode, gated by its own proof.

`--phase {mode}` is `--phase full` (an alias of `build`, the build-complete set) in full mode and `--phase small`
(render, a11y, coverage, firstview, tells, ip) in small mode, so a small-mode UI is never failed on brand, tokens or
motion gates it was not asked to produce. /execution's `FRONTEND.build` gate and H14 pass the same phase (CHANGELOG
v1.1). The generic UI template and the "simple UI first" path are dropped, so nothing is built twice.

### 12.2 Agents and briefs
Implementers build sections with the /frontend references named in their brief (explicit paths, no reliance on
auto-loading). `frontend-critic` and `frontend-probe` are called by the wave script through the fragments in
`assets/wave-fragments/`, which never dictate a commit message (each agent commits under its own commit rules,
Q-F15). No hooks in /frontend's SKILL.md frontmatter; an optional Stop hook in an agent definition fires as
SubagentStop [critic C8, research/_critic-round1.md].

### 12.3 The `frontend` block of profile.json
`mode` full or small · `judged_surface` site, app, site+app, video or readme · `format` {stage, projector_zoom, video
{max_s, width, height, embed}, async_readme} · `viewports` · `stack` · `hosting` · `external_requests` ·
`prework_designs` {allowed, until_utc} · `review_surface` board, claude-design or terminal · `critique` {rounds_max,
critics, probes} · `budget` {ui_hours, tokens} · `references` [{customer, url, source, owner_confirmed}] · `sponsors`
(alias `sponsor_allowlist`; an id the allowlist does not know exempts nothing and is never an error, Q-FX-5) ·
`tells.score_max` · `firstview.complexity` (the calibrated band) · paths to the claims ledger, never-show list and
feature catalogue. Schema: `assets/schemas/profile-frontend.schema.json`.

---

## 13. Skill layout

```
~/.claude/skills/frontend/
  SKILL.md              standing rules in the first ~5,000 tokens, phase map, pointers; under 500 lines
  ARCHITECTURE.md       this file
  HANDOFF.md            state of the build between sessions and accounts
  CHANGELOG.md          shape changes /execution must know (templates, gates, flags, shared files)
  references/           00-contract to 15-ip-provenance: contract, brief, references and policy, directions, brand,
                        tokens, build, states and web3, motion, recording, gates, tells (checkers only), critique,
                        stack, copy, IP and provenance
  scripts/              package.json + lockfile, tsconfig.json, CONTRACTS.md;
                        capture-gate.mjs, capture.mjs, extract.mjs (P1); brief.mjs (P0); board.mjs (P2, H1, H2);
                        brand.mjs, brand-check.mjs (P3); tokens.mjs (P4); qa.mjs, coverage.mjs, firstview.mjs,
                        slop-check.mjs, ip-check.mjs, motion-check.mjs, recording-check.mjs, frontend-check.mjs (P6);
                        critique.mjs (P7); calibrate.mjs, check-refs.mjs, install-agents.mjs (maintenance);
                        lib/ (shared library), rules/ (registry.json, load.mjs, static/ and runtime/ detectors),
                        tests/ (node:test, fixtures/)
  assets/               task-templates/frontend.json, wave-fragments/ (critique.js, directions.js), schemas/,
                        templates/ (brief, pattern ledger, direction, DESIGN.md, disclaimer EN/FR, critique
                        checklist, JSON starters), agents/ (frontend-critic, frontend-probe), sponsor-allowlist.json,
                        licenses/ (THIRD-PARTY-NOTICES.md, impeccable's Apache-2.0 LICENSE and NOTICE)
  ledger/               past-directions.json, the cross-project directions ledger (created by board.mjs record)
  calibration/          corpus manifest, labelling plan, synthetic prompts, owner labels, per-rule results
  evals/                build progress and reports, workflow scripts, fixture runs, A/B results
  research/             dossiers FD01-FD21, INDEX.md (evidence/ and assets/ gitignored: third-party material)
```

---

## 14. Decisions for the owner (decided 2026-10-01)

The owner settled these on 2026-10-01 (`HANDOFF.md` section 2): (1) mode A task templates from the start of
/execution's build; (2) the pattern ledger of conventions and measured relationships; (3) a private Claude Design
canvas for H1 and H2; (4) full v1 with calibration and A/B evaluation; (5) the listed defaults stand. Items 6 and 7
stay open. The original questions follow for the record.

1. Timing: mode A task templates from the start (recommended) versus an optional pass after build-complete, as
   /execution's ARCHITECTURE.md v1 draws it.
2. Copying boundary: a written pattern ledger of conventions and measured relationships (recommended) versus section
   skeletons of customer sites used as generation input (legal and tool-policy risk, FD09).
3. Review surface for H1 and H2: private Claude Design canvas, local board images, or both.
4. Budget before Origins (the weekly window resets about 22 h into the hack): full build plus calibration plus A/B
   evaluation, or a lean v1 with the A/B evaluation after Origins.
5. Defaults the owner may override: tiering of the tells with waivers, Claude-era tells added, wordmark-first logo
   drawn by Claude (no paid Recraft), stack defaults, icons none by default, Playwright scripts for gates and the CLI
   for inspection, no third-party skill installed whole, captures that respect robots.txt and never defeat a bot wall.
6. A 15-minute labelling session on the owner's past frontends (ground truth for calibration).
7. Organiser question for Origins: does a logo, a token file or reference notes made before kickoff count as a
   design?

---

## 15. Build plan to Sun 4 Oct 12:00 Paris (historical, 2026-10-01)

Kept as written on 2026-10-01; current build status is in `HANDOFF.md`.

| when | work | agents | tokens (order of magnitude) |
|---|---|---|---|
| Thu 1 Oct | owner decisions and labels; build wave: toolchain and capture, frontend-check core gates, slop checker and registry, brand pipeline, references from the dossiers, SKILL.md, task templates, schemas, agent definitions; send the contract to /execution | 10-14 | 10-15M |
| Fri 2 Oct | calibration: render both corpora, tier the rules, fix detectors until tier 1 is silent on the controls | 6-10 | 4-6M |
| Sat 3 Oct | rehearsal on a neutral fixture (mode B, then mode A if /execution is ready); A/B with and without the skill if the budget allows; adversarial review of the skill; fixes | 8-14 | 8-14M |
| Sun 4 Oct morning | final checks, commit after the owner's approval | 1-2 | <1M |

The research used about 17.5M subagent tokens so far. Everything spent before Wed 7 Oct 04:00 Paris comes out of the
same weekly window as the first 22 hours of Origins.
