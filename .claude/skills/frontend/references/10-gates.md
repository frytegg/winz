# Gates: what frontend-check proves and how to fix a red gate

Read when: a proof failed, you write or verify a task's proof command, you prepare build-complete or hand-over, or you need to know what /harden's frontend lens will and will not check.

## Purpose
`frontend-check` is the proof in both modes: one offline command, a JSON gate list, three states (`ok`, `fail`, `skipped`), exit 0 only when every requested gate is `ok`.
This file lists every gate id of `scripts/CONTRACTS.md` section 4 with what it checks, what fails it, how to fix the page, and what would be untrue if the gate were dropped.
The JSON each run prints (`title`, `ifDropped`, `detail`, `evidence`) is the authority; the tables here explain it. If they disagree, trust the JSON and report the difference.
Command flags and the FE task proofs are in `00-contract.md`; critique acceptance is in `12-critique.md`.

## Rules

### GT-01 - Prove with the agreed command, after your own build
- **Rule:** frontend-check never builds. Chain the build: `pnpm -C <ui> build && node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates <list> [--features <FR ids>] --root <repo> --profile <abs profile.json> --serve <ui>/dist`. Use `--url <url>` for a running app, `--start "<cmd>" --url http://127.0.0.1:<port>` to start and stop one. Keep the command offline and replayable from a clean checkout.
- **Why:** The proof /execution can consume is one offline command with an exit code and a JSON gate list, and its receipt belongs in the repo or the run dir [FD13-F16]. The command form is agreed [agreement with /execution, 2026-10-01, CONTRACTS.md].
- **Check:** `exec.py proof run --sha <landed>` (/execution's verifier; exit 0).
- **Not when:** file-only gates (`brief`, `refs`, `directions`, `brand.candidates`) need no build in the chain.

### GT-02 - Treat exit 0 as the only pass; a skipped gate fails
- **Rule:** Exit 0 if and only if every requested gate is `ok`. Exit 1: a gate failed, or a requested gate was `skipped`. Exit 2: usage (bad flag, missing input file, invalid profile). Exit 3: environment (no browser, missing module, port in use). Never pass `--allow-skip` in a task proof and never call a skipped gate passed: a skip is fixed at its cause or decided by the owner.
- **Why:** The owner's BNB completion check returned `ok: true` for a gate it skipped in `--json` mode, the lenient proof /execution's research lists [FD13-F16]. /execution's runner reads only the exit code [agreement with /execution, 2026-10-01, CONTRACTS.md].
- **Check:** `frontend-check --json` (exit 0 and `counts.skipped` equal to 0).
- **Not when:** never.

### GT-03 - Fix the page, never the gate
- **Rule:** Never edit a threshold, fixture, detector, the registry, a test or the profile to turn a gate green, and never replace a rendered check by a source grep. Add a waiver to `design/waivers.json` only with a reason tied to research or to a sponsor's real brand, plus evidence. Read the failing gate's `detail` and `evidence` (route, viewport, selector, file, line, value), fix the page, rebuild, re-run.
- **Why:** BNB's G1.A4 gate passed when any of three strings appeared in source while the spec's panel was missing from the app [FD13-F09]. A sponsor waiver is refused when the sponsor claims the look as its mark [FD21 Deliverable].
- **Check:** owner review of `design/waivers.json`; `git diff --stat` touches nothing under the skill's `scripts/`.
- **Not when:** the gate is wrong about a legitimate page: report it with the evidence; the owner decides.

### GT-04 - Run --phase build before build-complete and before hand-over
- **Rule:** `--phase build` runs every group except `refs`, `directions` and `brand.candidates`, plus `recording` only when `profile.format.video` is set: `brief`, the rest of `brand`, `tokens`, `render`, `a11y`, `coverage`, `firstview`, `tells`, `ip`, `motion`. It joins /execution's build-complete gates (H14: `frontend-check --phase build --json` exits 0). In small mode the proof runs `--phase small` instead: `render`, `a11y`, `coverage`, `firstview`, `tells`, `ip`, with no brand, tokens or motion gate; `--phase full` is an alias of `build`, so templates pass `--phase {mode}`.
- **Why:** Composition and join agreed [agreement with /execution, 2026-10-01, CONTRACTS.md]; the proof's gates join /execution's build-phase completion check [FD13-F16].
- **Check:** `frontend-check --phase build` (`--phase small` in small mode).
- **Not when:** a single FE task proves only its own gates (`00-contract.md` CT-05).

### GT-05 - Wait for explicit readiness, never for network idle
- **Rule:** Gates load with `waitUntil: "load"`, then wait for `document.fonts.ready`, every `img` complete, `window.__FRONTEND_READY__ === true` when `profile.ready_flag` is true, and two animation frames. An app that streams data sets the flag after its first data. Never add a `networkidle` wait.
- **Why:** Playwright marks `networkidle` discouraged: streaming demos never reach it, and a page that goes quiet early passes before late content arrives [FD17-F29].
- **Check:** `render`, run twice: the same states both times.
- **Not when:** never.

### GT-06 - Judge the rendered page, in record mode when the profile asks
- **Rule:** Coverage, first view, tells, motion and recording read the rendered DOM. The runtime layer is authoritative: a static finding with no runtime confirmation never fails `tells.tier1`. With `profile.record_mode: true` routes load with `?record=1`, so named demo data, a fixed clock and hover content shown at rest are what the gates see.
- **Why:** Coverage must be checked on the rendered DOM in frozen-data mode, since a source grep passes on a comment or unreachable code [FD13-F09]; takes need a frozen mode immune to network blips [FD13-F14].
- **Check:** `coverage.features`.
- **Not when:** `brief`, `refs`, `directions`, `brand` and `tokens` read files.

### GT-07 - Keep frontend-check out of CI while red, and pixel baselines out of the gates
- **Rule:** Do not add frontend-check to CI while gates are open by design. Do not commit pixel-baseline gates /harden could adopt. Use pixel diffs only to detect change between rounds.
- **Why:** A check that is red by design teaches everyone to ignore red [FD13-F16]. /harden freezes committed snapshots and configs, so a pixel-changing accessibility fix would turn a snapshot gate red [FD13-F21]. A hairline accent change passed a 1% pixel gate: diffs measure change, not quality [FD06-F15].
- **Check:** owner review of `.github/workflows/`.
- **Not when:** once every gate stays green, CI is the owner's call [FD13-F16].

### GT-08 - Run the a11y group yourself; /harden's frontend lens may never look
- **Rule:** Every build-phase proof runs `a11y`. Ship what /harden would otherwise change in your markup (`lang` on `<html>`, labels linked to inputs, names on icon-only buttons, `type="button"` on non-submit buttons), and meet contrast and target size yourself.
- **Why:** /harden's lens loads only for JSX, TSX, `.vue` or `.svelte` files or a react, next, vite, vue or svelte dependency, so BNB's template strings and a no-framework Origins page fall outside it; even when it runs, contrast and target size are report-only (its FE-21) and it applies only those mechanical fixes (its FE-19) [FD13-F22]. Running the same axe tags inside the loop surfaces failures before the end [FD17-F23].
- **Check:** `a11y.axe`.
- **Not when:** never.

### GT-09 - Own the interface rules /harden leaves uncovered
- **Rule:** Do not add jsx-a11y linting: /harden runs it. Do own motion, typography, theming, touch, forms, images, i18n and copy hygiene, which /harden's lens never mentions. Never emit `maximum-scale` or `user-scalable`. Treat Vercel Web Interface Guidelines rules as a hygiene tier calibrated on human sites, never as tier-1 tells, and never enforce their Title Case or "&" house style.
- **Why:** 19 of the 90 rules the web-design-guidelines skill applies touch /harden's FE-11 to FE-21; the other 71 do not [FD04-F10]. axe's `meta-viewport` fails `maximum-scale=1` [FD04-F07]. Used as literal gates, those rules fired on human-designed sites, Vercel's own included [FD04-F13]. Title Case is Vercel brand preference, with sentence case for marketing pages [FD04-F06].
- **Check:** `a11y.axe` for the viewport rule; `critic` for the rest.
- **Not when:** never.

### GT-10 - Keep the brief traceable (brief)
- **Rule:** Fix `brief` failures in the brief, never in the page.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `brief.complete` | `brief.json` exists and matches CONTRACTS 6.4; every non-empty field names its source; every gap sits in `missing` with an action. Fails on a field without a source, or a required input (two sentences, spec) neither present nor listed | fill the field from its source, or record it as missing (`01-brief.md`) | a field could carry text nobody can trace, and a gap would be guessed instead of asked |

- **Why:** Never invent a missing input; record the path found [FD13-F05]. The hero must come from one editable source [FD13-F07].
- **Check:** `brief`.
- **Not when:** never.

### GT-11 - Keep references to ideas from two sources, captured through the gate (refs)
- **Rule:** Run with FE-02, before any direction exists.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `refs.ledger` | `pattern-ledger.json` (CONTRACTS 6.5): every convention, relationship or domain pattern cites at least 2 unrelated references; `not_borrowed` is filled; no pixels, logos, copy, imagery, licensed fonts, exact brand hexes or one site's full section sequence. Fails on a single-source pattern or forbidden material | re-source the pattern from a second unrelated reference, or move it to `excluded` | one company's page could become the template, the accumulation a Paris court held parasitic though each element was ordinary |
| `refs.receipts` | every reference has a capture-gate receipt (robots.txt verdict, reviewed terms, SHA-256 manifest), was stored outside any git work tree, and is purged with a deletion receipt once the ledger exists | re-capture through the gate, or fall back to the owner's own notes; run the purge | a capture taken past robots.txt or a bot wall, or never deleted, would pass |

- **Why:** Small borrowings from one site add up even when each looks banal, so each pattern comes from several unrelated references [FD09-F11]; ideas and measured facts are allowed, a site's arrangement, text and images are not [FD09 Policy table]. The capture policy stops on bot walls, stores outside work trees and purges with a receipt [FD19 Deliverable].
- **Check:** `refs`.
- **Not when:** not part of `--phase build`.

### GT-12 - Offer only screened, distinct directions (directions)
- **Rule:** Run with FE-03, before H1.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `directions.present` | 2 or 3 directions (1 or 2 in small mode) under `directions/<A,B,C>/`, each with `tokens.json`, `hero-desktop.png` (1440x900), `hero-mobile.png` (390x844) and `notes.md` (name, source anchor, rationale, trade-off), each anchored in a different source. Fails on a missing file or two directions from one source | build the missing direction from another anchor: customer A, customer B, the protocol's domain, a utilitarian one | the owner would choose between shades of one look |
| `directions.screened` | each hero comp passes the tells checker, and the "similar prompt" test regenerates tokens from a generic brief (name and research removed) and flags tokens that come out identical | replace flagged tokens with choices tied to this brief; write what changed and why in `notes.md` | the model's default palette and fonts could reach the owner as a real option |

- **Why:** Propose 2 to 4 genuinely different named directions, each grounded in a different source [FD15-F19]; tokens identical under a generic brief came from the prior, not the project [FD15-F08]. People invent preferences between options that are too similar [FD17-F18].
- **Check:** `directions`.
- **Not when:** not part of `--phase build`.

### GT-13 - Ship the full brand file set (brand)
- **Rule:** `brand.candidates` runs with FE-05; the other five run in every build-phase proof.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `brand.candidates` | 3 to 5 candidates under `brand/candidates/<n>/`, rendered at 16, 32, 180 and 512 px plus one-colour silhouettes on light and dark; mark lint: no gradient, no hexagon or cube, no `<text>`, strokes at least viewBox/16, no struck-through initial | redraw on a 32-unit grid with solid shapes; outline the wordmark | the owner could pick a mark that blurs at 16 px or repeats a crypto cliché |
| `brand.favicons` | `favicon.ico` with one 32x32 entry declared `sizes="32x32"`; `icon.svg` served as `image/svg+xml`; `apple-touch-icon` 180x180; manifest icons 192, 512 and maskable 512 with every inked pixel within a radius of 0.4 x size; a raster above 48 px declared | regenerate the set with the brand pipeline (`04-brand.md`) | the tab, the home screen or the search result would show a missing, clipped or wrong icon |
| `brand.templates` | no favicon whose normalised hash matches a framework template (create-vite's purple `favicon.svg`, create-next-app's `favicon.ico`) | replace it with the chosen mark's set | a framework favicon would ship, the cheapest sign the brand step was skipped |
| `brand.icon-dark` | `icon.svg` keeps its `prefers-color-scheme` rule after SVGO, and the dark colour renders under emulated dark mode | optimise with `inlineStyles: false` or the presentation-attribute pattern, then re-check in the browser | the favicon could vanish on a dark tab strip |
| `brand.og` | `og.png` is 1200x630, at most 8 MB, text outlined; `og:image`, `og:image:width`, `og:image:height`, `og:image:alt` and `twitter:card=summary_large_image` are emitted | render it at build time from the brand sources and the problem sentence | a shared link would show a cropped, empty or stale card |
| `brand.drift` | every inlined copy of the mark (data-URI favicon, inline SVG) equals the file in `brand/` | regenerate the inline copy from the file | an inlined copy of the mark could drift from `brand/` unnoticed |

- **Why:** Generate 3 to 5 candidates, check them objectively, let the owner pick [FD12-F09]; a 16 px render separates a solid grid-aligned mark from a gradient hairline one [FD12-F16]; struck-through initials mark 13% of top-500 crypto logos [FD12-F05]. The favicon set, its MIME type, the maskable safe zone and Google's raster size come from [FD12-F21] [FD12-F22] [FD12-F23] [FD12-F29]; template favicons from [FD12-F27]; SVGO's dark-mode loss from [FD12-F24]; OG rules from [FD12-F28]; the inline-plus-drift-test pattern from BNB's brand set [FD13-F15].
- **Check:** `brand`.
- **Not when:** `brand.candidates` is not part of `--phase build`. A flagged shape (hexagon, struck-through initial) is a "look twice" flag: it passes with a written reason tied to the protocol [FD12-F05].

### GT-14 - Keep tokens the only source of the look (tokens)
- **Rule:** Fix the token file and regenerate its views; never patch generated CSS or DESIGN.md.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `tokens.valid` | `design/tokens.json` matches CONTRACTS 6.2: names match `[a-z0-9][a-z0-9-]{0,63}`, every token has a `usage`, every font has `license`, `licenseFile` and `source`; DESIGN.md is generated, not hand-edited | fix tokens.json, rerun `tokens.mjs` | colours, type and motion values could scatter across components with no single source |
| `tokens.contrast` | token-pair table by WCAG 2 ratios: text pairs at least 4.5:1 (3:1 large), input borders, focus rings and chart strokes at least 3:1 against neighbours; APCA advisory only | move one token of the pair along the brand hue (Leonardo targets 3, 4.5, 7) | a pair such as muted text on a muted fill would fail on every page that uses it |
| `tokens.leak` | Tailwind namespaces reset before the project's values; no arbitrary colour, gradient or blur values (`-[#`, `-[oklch(`, `bg-[linear-gradient`, `backdrop-blur-[`, `-(--` outside tokens); no class of a reset namespace (`from-purple-500`) | reset the namespace in `@theme`; replace the value with a token | indigo, soft grey shadows and the 150 ms default ease could leak back in |

- **Why:** Contrast has to be built into the tokens, since axe cannot resolve gradients and has no non-text contrast rule [FD16-F28]; gate on WCAG 2 ratios, as WCAG 3 has no method yet [FD16-F27]; Leonardo generates colours from target ratios [FD16-F29]. Resetting a namespace deletes its default utilities, while arbitrary values still pass [FD16-F05] [FD16-F06]. The plan lives on disk as a tokens file [FD15-F08] with a usage note per token [FD07-F26].
- **Check:** `tokens`.
- **Not when:** a stack without Tailwind skips the namespace checks of `tokens.leak`; plain CSS and inline styles bypass any theme, so review them [FD16-F05].

### GT-15 - Render without errors, overflow or shifts (render)
- **Rule:** Make every render gate pass at every viewport of the profile.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `render.console` | 0 `pageerror` and 0 console errors from first-party code, every route and viewport | fix the thrown error; never silence the console | a page that throws in front of the jury would pass |
| `render.requests` | 0 first-party responses with status 400 or above, 0 `requestfailed` | fix the path or the call; serve the asset | a 404 asset or API call would pass, since `requestfailed` ignores HTTP errors |
| `render.fonts` | 0 FontFace with status `error`; headings and body render in the intended families per CDP `getPlatformFontsForNode` | ship the font files and `@font-face` rules from tokens.json | a fallback font could render in place of the chosen face, unseen |
| `render.images` | 0 visible `img` with `complete` and `naturalWidth` 0 whose URL also failed or answered 400 or above | fix the path or the file; give SVGs a viewBox | a broken image would pass |
| `render.overflow` | `documentElement.scrollWidth` at most `clientWidth` at 320 and 375 CSS px | let content wrap; drop fixed widths | the page could scroll sideways on a phone |
| `render.clipping` | 0 text containers overflowing their box by more than 1 px under hidden or clipped overflow (line-clamp excluded); 0 overlapping text boxes from different blocks | let the box grow; fix the stacking | a clipped heading or a tagline cut at the fold would pass |
| `render.cls` | layout shift at most 0.1 over load plus a scripted scroll | reserve space for fonts, images and late data | late fonts or lazy images could move the page under the judge |

- **Why:** `requestfailed` ignores 404s, `document.fonts.check()` returns true for missing fonts, CDP reports the fonts that rendered, broken images report `naturalWidth` 0 [FD17-F25]; reflow is tested at 320 CSS px [FD17-F23]; good CLS is 0.1 or less [FD17-F26]; designers' complaints on Opus 5 pages were legibility and broken layouts such as clipped headings [FD17-F17]. These are hard gates G1 to G8 of [FD17 Deliverable A].
- **Check:** `render`.
- **Not when:** an SVG with no width, height or viewBox reports `naturalWidth` 0 although it loaded; the failed response decides [FD17-F25].

### GT-16 - Pass axe and resolve every incomplete contrast (a11y)
- **Rule:** Treat an `incomplete` contrast result as unverified until pixels decide it.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `a11y.axe` | axe-core with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`: 0 violations; `incomplete` items listed | fix the markup (GT-08); never emit `maximum-scale` | an unlabelled control or a missing `lang` would ship, and /harden may never look |
| `a11y.contrast` | every color-contrast `incomplete` (gradient, image, alpha, overlap) resolved by sampling rendered pixels behind the text box to a worst-case ratio of at least 4.5:1 (3:1 large); UI component boundaries at least 3:1 | put a solid plate under the text, or raise the token contrast | text over a gradient, glass or grain would pass unmeasured |
| `a11y.targets` | axe `target-size`: targets at least 24x24 CSS px, or spaced per WCAG 2.5.8 | enlarge the hit area | controls under 24 px would pass |

- **Why:** WCAG 2.2 gives 4.5:1, 3:1, 320 CSS px and 24 px, and APCA stays advisory [FD17-F23]; axe returns "incomplete", not a violation, over gradients, images, alpha and overlaps, exactly where glass, grain and gradient text sit [FD17-F24]. Leave the 24 px check to axe and do not write a naive geometry rule [FD04-F09].
- **Check:** `a11y`.
- **Not when:** 44 px targets on primary touch controls at mobile width are advisory until calibrated, never a gate [FD04-F09].

### GT-17 - Show every feature, every figure's source, the hero verbatim and nothing private (coverage)
- **Rule:** Every check runs on the rendered DOM of every route, in record mode when the profile sets it (GT-06).

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `coverage.features` | each catalogue id (or each `--features` id) has a visible `data-feature="<id>"` element at its route in record mode, with a heading, a `data-status` label and a proof | build or surface the section; map the id in `routes.json` | a feature the spec promises could be missing while every test is green |
| `coverage.metrics` | every `data-metric` element also carries `data-ledger`, or `data-source` with `data-as-of` | tag the figure with its verified ledger row, or show the "not yet verified" state | an invented or unverified number could reach the jury |
| `coverage.hero` | text of `data-hero="h1"` and `data-hero="sentence"` equals `brief.hero` after normalisation | re-render the hero from its source file | the hero could drift from the two sentences the README, the form and the video repeat |
| `coverage.nevershow` | rendered text of every route matches no active never-show entry (scope `rendered` or `both`, `until_utc` unset or in the future) | remove the text, or wait for the embargo's end | an embargoed or undisclosed item could render on the public page |
| `coverage.placeholders` | no TODO, lorem, template brackets, "Coming soon" stubs or placeholder names (Acme, John Doe, example.com) in rendered text | write the real content from the brief, or remove the element | a TODO or placeholder could sit on a page a judge reads |

- **Why:** A spec panel was missing while a source-grep gate passed [FD13-F09]; the catalogue decides what a judge can see [FD13-F08]; numbers carry ledger ids so the T-6h audit can trace them [FD13-F10]; invented figures and template placeholders are slop signatures in the owner's corpus [FD14-F22]; the hero is a fourth copy of the two sentences [FD13-F07]; never-show must be checked on rendered text with its dates [FD13-F11] [FD13-F12]; feature presence and placeholders are hard gates G9 and G12 of [FD17 Deliverable A].
- **Check:** `coverage`.
- **Not when:** an empty data state legitimately hides a panel: declare it in `routes.json` `states` and render the empty state with its feature marker [FD13-F09].

### GT-18 - Say what it is in the first viewport (firstview)
- **Rule:** The first viewport carries identity and one proof; the feature map lives in screenfuls 2 and 3.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `firstview.contract` | in the first viewport of each profile viewport: an H1 of 2 to 8 words (exemplars run 2 to 6), one sentence of 5 to 40 words naming user, action and object, the sponsor's name, one sourced figure and the product (`data-surface="product"`), all visible at load | move the missing element above the fold; cut decoration to make room | a judge could leave the first screen without knowing what it is, does and fixes |
| `firstview.complexity` | JPEG quality-70 size of the 1440x900 first viewport within the category band set by calibration; until then the provisional band is 38.1 to 119.7 KiB on Chromium's JPEG scale (the ten exemplars measured 47 to 133 KiB as PIL JPEG), and the gate only reports (its ok carries `advisory: true`) | remove texture, photographs and competing elements | a cluttered first screen would pass |

- **Why:** Exemplar headlines run 2 to 6 words with an explanatory sentence on 6 of 10 [FD11-F17]; a project without a brand needs the sentence [FD11-F18]; exemplars show exact live figures with small labels and status labels [FD11-F20]; 57% of viewing time stays above the fold [FD11-F10]; the headline must not animate into place [FD11-F32]. The JPEG proxy needs calibration, because texture and photos raise it without clutter [FD11-F05].
- **Check:** `firstview`.
- **Not when:** `firstview.complexity` only reports until the band is calibrated [FD11-F05].

### GT-19 - Read the tells gates as calibrated rules, never as taste (tells)
- **Rule:** All 51 registry rules are `candidate` today: the tier gates have nothing to enforce, and `tells.score` only reports while `score_max` is null. The report marks those three gates `advisory: true` (an ok that judged nothing binding, counted apart in `counts.advisory`), so a green `tells` group means nothing until `calibrate.mjs` and the owner's labels set tiers. Static detectors judge the shipped UI surface only: git-tracked files of the UI packages, never tests, stories, tooling folders, backend services, decks or docs sites. Exempt by hash, rule id and recorded reason, never by colour or name.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `tells.tier1` | no confirmed finding of a tier-1 rule outside an exemption (sponsor file by SHA-256, category allowlist entry, waiver) | apply the rule's `fix` from `scripts/rules/registry.json` | a calibrated AI tell that stays silent on human sites would ship |
| `tells.tier2` | every firing tier-2 rule has a waiver with non-empty `reason` and `evidence` | remove the pattern, or record the research-backed reason (a sponsor's real brand, a category convention) | a tell allowed only for a stated reason would ship without one |
| `tells.score` | weighted sum of confirmed candidate and advisory findings, anchors counted double, at most `profile.tells.score_max` | remove co-occurring patterns, anchor rules first | several weak tells together would pass because none alone is tier 1 |

- **Why:** Validate every detector on labelled controls, demote those that fire on human sites, and score co-occurrence with anchors [FD10-F12]; several tells appear on the category's own exemplars [FD11-F19]; the controls are pinned pre-2023 human frontends [FD14-F24], two of which load Inter [FD14-F25]; a sponsor gradient is exempt only inside its hash-matched file [FD21 Deliverable].
- **Check:** `tells`.
- **Not when:** never give the tells catalogue (`11-tells.md`) to a builder: literal bad examples in rule prose primed models to copy them [FD02-F33].

### GT-20 - Ship nothing borrowed without a licence or permission (ip)
- **Rule:** Name third parties in plain text by default; any logo needs a published rule or written approval.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `ip.fonts` | every font file ships an OFL, Apache, UFL or MIT licence file; a subset of a face with a Reserved Font Name is renamed or replaced; no FFL or sponsor-kit commercial face | ship the licence; rename the subset in its name table and `@font-face`, or pick a face without an RFN | a font with no licence, an RFN-breaking subset or a sponsor's commercial face would ship |
| `ip.hotlinks` | no `fonts.googleapis.com` or `fonts.gstatic.com` link or request in built pages | self-host the files with their licence | visitors' IPs would go to a font CDN, and a venue without wifi would lose the fonts |
| `ip.logos` | every third-party image or inline SVG matches a hash-listed official file of a sponsor whose rules allow unaltered use, or has recorded approval evidence | remove it; name the party in plain text | a logo whose owner requires permission would ship without it |
| `ip.provenance` | every file under `brand/`, `public/` and the design fonts has a `provenance.json` entry (source, licence, AI-generated or not) | add the entry, or remove the file | an asset of unknown source, licence or AI status would ship |
| `ip.concept-label` | every frame naming a real company carries `data-concept-label` with the disclaimer beside it | add the short label: `Concept mockup. Not affiliated with, endorsed by or sponsored by [Company].` | a frame naming a company could read as its endorsement |
| `ip.copy-overlap` | no long run of consecutive words shared with captured customer copy (a heuristic length such as 8, not a legal rule) | write the copy from the brief | a customer's headline or microcopy could be reused verbatim |
| `ip.sponsor-marks` | on rendered pages: no transform, filter, blend, animation or transition on a sponsor logo, no logo below its minimum size, no lockup with our mark, no logo as the largest element, no forbidden phrase, the Cardano notice wherever its logo shows; naming hits go to the owner | follow the sponsor's entry in `assets/sponsor-allowlist.json` | a sponsor mark could be altered, animated, locked up, misnamed or shown without its notice |

- **Why:** Open-licence sources and licence files [FD16-F11], Fontshare's FFL forbids sharing and subsetting [FD16-F12], subsetting an OFL face is modification and drops its RFN [FD16-F30]; a German court sanctioned Google Fonts hotlinking [FD09-F20] and a venue's wifi is a stage risk [FD13-F13]; logos, "trusted by" rows, concept frames and provenance follow [FD09 Policy table] and [FD09 Template disclaimer for a concept mockup naming a real company]; short extracts and accumulated borrowings infringe [FD09-F05] [FD09-F11]; sponsor gates and kit fonts come from [FD21 Deliverable].
- **Check:** `ip`.
- **Not when:** an unaltered official sponsor file whose rules allow it, at its minimum size, with any required notice [FD21 Deliverable].

### GT-21 - Keep content visible without motion (motion)
- **Rule:** Animate only real state changes; the page is complete at rest.

| gate | checks; fails when | fix | if dropped |
|---|---|---|---|
| `motion.reduced` | with `reducedMotion: "reduce"` only opacity and colour animate and all content stays visible (`getAnimations()` inventories compared in both states) | add `prefers-reduced-motion` handling that removes movement and keeps feedback | the page could move for a viewer who asked it not to, which axe never checks |
| `motion.hidden-at-rest` | in both states, 0 text blocks below opacity 0.1 or transformed off-screen after load; the H1, the sentence and the first figures visible at load | start reveals from a visible resting state; no scroll-triggered entrances on text | the headline or a proof could wait for a scroll that a judge, a screenshot or a recording never triggers |
| `motion.inventory` | fails when an animation exceeds its role budget (press 160 ms, tooltip and hover 200, dropdown 250, modal and UI 300, toast 400, drawer 500; purpose `explanation` in `design/motion.json` exempts it) or loops forever on an element not marked `data-live`. `transition: all`, ease-in entrances and `scale(0)` starts are notes in its evidence only; the `tells` rules SL-MO1, SL-MO2 and SL-MO4 report them | name the animated properties; use the motion tokens; mark live-state loops `data-live` | slow UI motion and endless decorative loops would pass |

- **Why:** Reduced motion means fewer and gentler, not zero, and axe has no motion rule [FD03-F15]; `getAnimations()` gives the runtime inventory in both states [FD03-F25]; full-page captures never scroll, so reveals stay invisible [FD06-F10]; NN/g saw scroll-triggered text slow users down [FD11-F32]; Anthropic names per-section fade-up entrances as AI-generated and wants the first frame complete [FD15-F09]; budgets, easing, `scale(0)` and Tailwind's default motion come from [FD03-F07] [FD03-F06] [FD03-F10] [FD03-F08].
- **Check:** `motion`.
- **Not when:** a named explanatory hero animation is exempt from the duration budget [FD03-F07]; a pure fade is the right fallback under reduce [FD03-F10].

### GT-22 - Keep recorded frames legible (recording)
- **Rule:** Part of `--phase build` only when `profile.format.video` is set. Thresholds come from OCR on 720p and 540p copies of 1920x1080 captures; `09-recording.md` holds the record-mode contract. Severity is the research checker's. A gate with WARN rows only (g02, g04, g06, g08, g09, g13) cannot fail: its ok carries `advisory: true` and is counted in `counts.advisory`, so read its warnings, never its ok, as the result.

| gate | checks (severity) | fix | if dropped |
|---|---|---|---|
| `recording.g01` | text a judge must read: x-height at least 5.8 px in the 720p copy, Inter at least 16 px (FAIL) | raise the size | body text could blur away in the 720p copy |
| `recording.g02` | reading text: x-height at least 6.5 px at 720p, Inter at least 18 px (WARN) | raise the size | reading text could sit where OCR starts missing words |
| `recording.g03` | `data-rec-role="key"` text: x-height at least 6.5 px in the 540p copy, Inter at least 24 px (FAIL); no key text marked on any route also fails, since nothing was measured | enlarge the claim, proof values and state labels | the claim could be unreadable in a half-size slide pane |
| `recording.g04` | weights 300 or lighter, and red on dark, one size step up, at least 18 px (WARN) | heavier weight or larger size | thin or red-on-dark text could lose a step of legibility |
| `recording.g05` | contrast sampled from pixels against the worst background: 4.5:1, 3:1 large (FAIL) | darken or add a plate | text could pass in CSS and fail on the frame the judge sees |
| `recording.g06` | projector contrast at least 4.5:1 at a 15:1 system floor (WARN) | lighter surfaces, or 7:1 text | dark-UI text could wash out on a projector |
| `recording.g07` | banding: CAMBI at most 5 on the 720p H.264 copy; large gradients with all stops at L below 0.1 flagged (FAIL, WARN) | flat surfaces on recorded screens | a dark gradient could band after encoding |
| `recording.g08` | no grain or noise overlay in record mode (WARN) | remove the overlay | grain would be erased by the encoder and cost bytes |
| `recording.g09` | 1 px structural borders under 1.5:1 become 2 px or fills (WARN) | thicker line or fill | structural hairlines could vanish at 720p |
| `recording.g10` | dark surface steps at least 1.1:1; master `color_range=tv` checked with ffprobe (WARN, manual) | separate the surfaces | near-black surfaces could crush into one black |
| `recording.g11` | no text revealed only on hover; no `title` tooltips on key elements (FAIL, WARN) | show it at rest in record mode | content a recording cannot hover would never appear |
| `recording.g12` | no blink under 333 ms per cycle; loops frozen in record mode; proof states hold at least 0.33 s per word, 1.2 s minimum (FAIL, WARN, manual) | freeze loops; hold states | a blink or loop could flicker or hide a state on video |
| `recording.g13` | every data region shows live, testnet or simulated plus an as-of time or block (WARN) | add the label and `data-as-of` | a recorded figure could not be told from a mock-up |
| `recording.g14` | no horizontal overflow at 1536 and 1280 CSS px; key elements in the first viewport (FAIL, WARN) | lay out the first screen for 1536x864 | the layout could break at the stage laptop's 125% or 150% zoom |
| `recording.g15` | Ledger device steps (`requiredUserInteraction`) mirrored in the page (manual) | add the device-step panel | a judge could not see what the device asks |
| `recording.g16` | deck is .pptx or single-file .key with the MP4 embedded, never 97-2003 .ppt, played from the Drive copy (manual) | owner's deck step | the embedded video could arrive as a still picture |

- **Why:** The recording profile and its 16 gates [FD20 Deliverable]; a model's blind read checks comprehension, never legibility [FD20-F07].
- **Check:** `recording`.
- **Not when:** no video in the profile.

## Procedure
When a proof is red:
1. Read the counts line, then list every gate whose state is not `ok`.
2. Exit 2: fix the flag, the profile or the missing input file the message names. Exit 3: fix the environment (`pnpm install --frozen-lockfile` in `scripts/`, Chromium revision 1217 or `FRONTEND_CHROMIUM`, a free port).
3. For each failing gate, read `detail` and `evidence` (route, viewport, selector, file, line, value) and find its row above.
4. Apply the row's fix in the product code or content (GT-03).
5. For a skipped gate, fix what made it skip (missing input, profile field, browser); never `--allow-skip`.
6. Rebuild, re-run only the failing groups with `--gates`, then the task's full proof.
7. Report the final exit code and the JSON counts. After the task's attempt limit, stop and report the open gates with their evidence.

## Gaps
- No gate checks explorer links by rendering, though explorers answer 200 on not-found [FD13-F24]; the `data-proof` marker exists and no gate reads it.
- The deterministic sub-scores (typography: body at least 16 px, 45 to 90 characters per line, line heights; spacing near-misses) have no gate id, although critique acceptance requires that none drops [FD17 Deliverable A].
- `recording-check.mjs` maps FD20 FAIL rows to `fail` and WARN rows to `ok` with warnings in the evidence (CONTRACTS v1.1); g16 stays `skipped` for a pptx or key embed until `--deck` is given, so `--phase build` cannot exit 0 for such a profile before the deck exists: an open decision for the owner.
- `a11y.axe` runs WCAG tags only: `heading-order` (best-practice) and a skip-link check are not covered [FD04-F10].
- `profile.external_requests: false` has no dedicated gate beyond `ip.hotlinks`.
- Every tells rule is still `candidate`, `profile.tells.score_max` is null, and the first-view complexity band is uncalibrated.
- The if-dropped sentences here paraphrase; each check module's `GATES` export is the authority.
