# The "impeccable" design skill (pbakaus/impeccable)
> Code FD02 · slug tool-impeccable · researched 2026-09-30 · verified 2026-09-30 · counts: verified 14 / corrected 16 / downgraded 0 / dropped 0 / added 3

## Summary

- Impeccable is Paul Bakaus's Apache-2.0 repository github.com/pbakaus/impeccable (site impeccable.style): one skill (`/impeccable`), 24 commands, live browser iteration, and a deterministic detector of **61 rules** (32 "slop", 29 "quality"; 47 warning, 12 advisory, 2 error). 72,938 stars on 2026-09-30, commits on 21 of the 31 days from 2026-08-31 to 2026-09-30 (corrected: was "commits every day"; see F01). Last tagged skill release is 4.3.1; HEAD and the website say 4.4.0, which the repo itself calls "a candidate, not a published release".
- The detector is a standalone Rust engine (Windows x64 engine 0.1.8, 17 MB, Authenticode-signed by "Renaissance Geek, Inc.") run as `impeccable detect [--json] <dir|file|url>`, with no LLM and no API key. It has three engines: a line-regex scan for CSS/JSX/TSX/Vue/Svelte, a static HTML engine with a CSS cascade, and a URL engine that drives an installed Chromium over CDP and adds a screenshot contrast pass. Exit 0 = no primary findings, 2 = primary findings, 1 = a target could not be scanned. Advisories never change the exit code.
- I ran engine 0.1.8 on a synthetic page carrying all 20 of the owner's tells. The static HTML scan (86 ms) caught **12/20** in some form, the URL scan **11/20** (a different subset), and a Next.js/Tailwind TSX+CSS source scan **4/20**. No mode caught these seven: emoji in headings, Lucide everywhere, untouched shadcn, fade-in on scroll, hover-fade buttons, inconsistent spacing, grain over a gradient. Glassmorphism showed up only through its contrast symptom.
- It is not silent on human work. URL scans of stripe.com, linear.app, www.gov.uk and rauno.me all exited 2, with 95, 64, 9 and 8 primary findings. Three of the four drew "slop" hits: Stripe's purple gradients ×9, Linear's nested cards ×6, and GOV.UK side-tab ×4 (fired on top borders). The vendor publishes no precision/recall study. Its accuracy tests are hand-written should-flag/should-pass fixtures and byte-equal goldens.
- The copy rules (buzzwords, aphoristic cadence, em dashes) run on source files only when the file is a full page with an .html/.htm/.astro/.vue/.svelte extension, so .tsx is skipped. The URL engine has no buzzword rule. The em-dash threshold (at least 8 dashes and at least one per 500 characters) is far looser than /prose PR-01 (2.0 per 1000 words). Tailwind checks are single-line regexes, and an Inter face loaded through `next/font` was invisible to the source scan.
- The build workflow ("new-work") is heavy and interactive. It requires a "concept-seed" dice roll fetched from impeccable.style/api, a written direction contract, decision pages served on localhost, and human review gates. Its comp-led path needs image generation: the skill prefers a harness-native image tool, and without one (the case in this Claude Code environment) that means an `OPENAI_API_KEY` for `gpt-image-2.5-flare`. The vendor's test log records two Claude full-build runs from 2026-09-07/08, on skill 4.2.x: 637 s and about 2.95 M input tokens for a run that a later documentation guard failed, and 623 s and about 2.11 M input tokens for a run that passed its automated gates. (corrected: was "one full Claude build at 623 to 637 s"; the two figures come from two different runs; see F18)
- Patterns worth taking:
  - A blind design review that runs before the reviewer sees detector output ("it still anchors judgment").
  - A fresh-context finish reviewer that answers with one of four disposition words.
  - A six-block direction contract.
  - A "canon" exit that asks for "two or three products this should sit alongside".
  - A research finding: when the model, a simulated user or a rejection rule could pick from the shortlist, option one won 27 of 30 times, so a script-assigned draw was needed to break the default. (corrected: the source names three kinds of selector, not only the model)
- Lineage: Impeccable began on 2025-11-16 as a verbatim copy of Anthropic's frontend-design SKILL.md, identical except for one added trailing newline (4,276 against 4,275 characters), and was relicensed from MIT to Apache-2.0 on 2026-01-07. That commit added a NOTICE crediting Anthropic's Apache-2.0 skill; a 2026-06-09 commit deleted it, and today's NOTICE credits only ehmo (F32). Vendoring its text requires shipping the license, marking changed files, keeping the attribution and carrying the NOTICE content. (corrected: was "byte-identical"; NOTICE history added at verification)
- Added at verification:
  - The vendor's own measurements, with the skill off, put body text below the WCAG contrast floor on 90%+ of about 190 generated pages (F31). Its deleted ablation study says its low-contrast detector "saturates at 80% baseline" (F33).
  - That study also found that literal bad examples in rule prose primed models to reproduce them. Its authors concluded "describe the failure shape, never enumerate examples of it". This matters for how /frontend states the owner's 20 tells to a building agent (F33).
  - Impeccable's NOTICE stopped crediting Anthropic's frontend-design on 2026-06-09 (F32).
- Recommendation:
  - Do not make /frontend depend on the full skill or its hooks.
  - Call the pinned engine's `detect` as an external instrument, in both source and URL modes.
  - Calibrate every rule on the owner's past frontends and on control sites before it can block.
  - Vendor a curated subset of rule texts with Apache-2.0 attribution, adding Anthropic's notice for any text that descends from frontend-design (F32). (corrected: Anthropic attribution added at verification)
  - Write /frontend's own checks for the seven uncovered tells.
  - Keep literal lists of tells in the deterministic checker. Give the building agent failure shapes and positive direction, and test for priming with and without the text before relying on it (F33). (added at verification)

## Findings

### FD02-F01 — Impeccable is Paul Bakaus's Apache-2.0 repository pbakaus/impeccable, shipped as four separately versioned release lines with frequent commits
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The repository github.com/pbakaus/impeccable (homepage https://impeccable.style) is licensed Apache-2.0. It was created 2025-11-16 and last pushed 2026-09-30, and at access time had 72,938 stars and 4,405 forks (72,953 at verification). It releases four parts independently: the skill (latest tag `skill-v4.3.1`, 2026-09-09), the npm CLI shim `impeccable` (4.1.0, published 2026-09-08), the Rust engine binary (`engine-v0.1.8`, 2026-09-29) and the browser extension (`ext-v1.4.0`, 2026-09-04). The default branch received commits on 21 of the 31 days from 2026-08-31 to 2026-09-30; there were no commits on 09-11 to 09-13, 09-17 to 09-20, 09-23, 09-26 and 09-27. The HEAD commit on the access date says it was "Prepared with AI assistance by OpenAI Codex under standing maintainer authorization." (corrected: "three separately versioned parts" missed the `ext-v*` extension line; "daily commits" overstated the cadence, measured with `gh api repos/pbakaus/impeccable/commits?since=2026-08-31T00:00:00Z` on the default branch)
- **Implication for /frontend:** Treat Impeccable as a moving target. Pin the engine version, plus a commit SHA for any vendored text, and re-check rule counts before each event (TOKEN2049 6-7 Oct, Ledger OP3N 6-13 Oct, BNB by 11 Oct).
- **Evidence:**
  - [GitHub REST API, repos/pbakaus/impeccable](https://api.github.com/repos/pbakaus/impeccable) — GitHub, accessed 2026-09-30 — repository metadata (primary).
    - Command `gh api repos/pbakaus/impeccable` → `"created_at":"2025-11-16T01:52:04Z"`, `"pushed_at":"2026-09-30T18:57:48Z"`, `"stargazers_count":72938`, `"forks_count":4405`, `"license":"Apache-2.0"`, `"description":"The design language that makes your AI harness better at design."`
  - [GitHub releases list](https://github.com/pbakaus/impeccable/releases) — pbakaus/impeccable, accessed 2026-09-30 — release records (primary).
    - `gh api repos/pbakaus/impeccable/releases` → `engine-v0.1.8 2026-09-29T21:52:43Z`, `skill-v4.3.1 2026-09-09T02:24:39Z`, `cli-v4.1.0 2026-09-08T23:28:55Z`, `ext-v1.4.0 2026-09-04T20:30:03Z` (last entry added at verification)
  - [npm registry: impeccable](https://registry.npmjs.org/impeccable) — npm, accessed 2026-09-30 — package metadata (primary).
    - `dist-tags {'latest': '4.1.0'}`, time `2026-09-08T23:29:17.126Z`, maintainer `paulbakaus`
  - [README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/README.md) — pbakaus/impeccable, commit 909726c (2026-09-30), accessed 2026-09-30 — repository file (primary).
    - line 514: "Created by [Paul Bakaus](https://www.paulbakaus.com)"
  - [Commit 909726c](https://github.com/pbakaus/impeccable/commit/909726c7e8be484daba481873640f64aa24f62dc) — pbakaus/impeccable, 2026-09-30T18:57:43Z, accessed 2026-09-30 — commit record (primary).
    - "Fix non-UTF-8 environment handling (#888)" / "Prepared with AI assistance by OpenAI Codex under standing maintainer authorization."
- **Limits / false positives:** Star and fork counts move daily. The skill, CLI and engine versions do not move in lockstep (see F27).

### FD02-F02 — One skill, `/impeccable`, with 24 commands plus pin, hooks and doctor utilities
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Everything routes through one skill. The Claude build's command table lists 24 commands:
  - Build: `craft` (deprecated alias), `shape`, `init`, `document`, `extract`.
  - Evaluate: `critique`, `audit`.
  - Refine: `polish`, `bolder`, `quieter`, `distill`, `harden`, `onboard`.
  - Enhance: `animate`, `colorize`, `typeset`, `layout`, `delight`, `overdrive`.
  - Fix: `clarify`, `adapt`, `optimize`.
  - Iterate: `live`, `generate`.

  Utilities sit outside the table: `pin <pin|unpin> <command>`, `hooks <on|off|status|ignore-rule|ignore-file|ignore-value|reset>` and `doctor`, and `teach` aliases `init`. `pin` writes `<project>/<harness>/skills/<command>/SKILL.md` and skips only when a non-pinned skill already sits at that exact path. It writes only into harness folders of the project root (found by walking up to `package.json`, `.git` or `skills-lock.json`) that already hold a project-level `impeccable` (or `i-impeccable`) skill; with no such folder it prints "No harness directories with impeccable installed found." and writes nothing. (corrected: the project-level install precondition was missing; `find_harness_dirs` and the pin branch of pin.rs)
- **Implication for /frontend:** Sub-commands can be invoked by name (for example `critique`, `typeset`, `clarify`) if the skill is installed. Impeccable's `harden` covers UI edge cases, i18n and overflow, and is unrelated to the owner's /harden. In a project where Impeccable is installed at project level, `/impeccable pin harden` would create a project-level `harden` skill folder next to the owner's user-level /harden. Which one wins was not verified, so /frontend should never pin `harden`.
- **Evidence:**
  - [README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/README.md) — pbakaus/impeccable, commit 909726c, accessed 2026-09-30 — repository file (primary).
    - line 3: "Design guidance for AI coding agents. 1 skill, 24 commands, live browser iteration, and 61 deterministic detector rules for AI-generated frontend design."
  - [.claude/skills/impeccable/SKILL.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/.claude/skills/impeccable/SKILL.md) — pbakaus/impeccable, frontmatter `version: 4.4.0`, accessed 2026-09-30 — the Claude build of the skill (primary).
    - "| `craft [feature]` | Build | Deprecated alias for an ordinary new-work request | [reference/craft.md](reference/craft.md) |"
    - "| `generate [n] [action] [element]` | Iterate | Variants, versions, or alternatives of a named element to choose from in the live browser; no manual picking | [reference/generate.md](reference/generate.md) |"
    - "`teach` aliases `init`. `craft` is a deprecated alias for ordinary new-work and adds nothing."
  - [crates/context/src/pin.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/context/src/pin.rs) — pbakaus/impeccable, accessed 2026-09-30 — source code (primary).
    - `let skill_dir = jsp::join(&[skills_dir, &command]);` and `"  SKIP: {} (non-pinned skill already exists)\n"`
    - added at verification: `fn find_harness_dirs(project_root: &str)` keeps a harness `skills` folder only `if exists(&jsp::join(&[&skills, "impeccable"])) || exists(&jsp::join(&[&skills, "i-impeccable"]))`; the pin branch returns after `io.out("No harness directories with impeccable installed found.\n")` when none is found.
- **Limits / false positives:** The README's own table still describes `craft` as a full flow (see Contradictions). The command count is 24 because `craft` still occupies a row.

### FD02-F03 — The detector: 61 deterministic rules (32 slop, 29 quality) that run without an LLM or API key
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The rule registry holds exactly 61 built-in rules, pinned by a unit test. There are 32 in category `slop` and 29 in `quality`. By severity, 47 default to `warning`, 12 are `advisory` and 2 are `error`. The IDs in registry order:
  - **slop:** side-tab, border-accent-on-rounded, overused-font, flat-type-hierarchy, gradient-text, ai-color-palette, cream-palette, nested-cards, monotonous-spacing, bounce-easing, pulsing-dot, blinking-cursor*, shape-assembled-illustration*, dark-glow, radial-halo, radial-spotlight-glow, marquee, icon-tile-stack, italic-serif-display, hero-eyebrow-chip, kicker-above-heading, numbered-section-labels*, em-dash-overuse*, marketing-buzzword, aphoristic-cadence, oversized-h1, extreme-negative-tracking, gpt-thin-border-wide-shadow*, repeating-stripes-gradient*, codex-grid-background*, theater-slop-phrase*, image-hover-transform*.
  - **quality:** organic-clip-path, buried-raster, broken-image, script-error†, content-hidden-at-rest†, edge-flush-cards, text-occlusion, first-viewport-column-overflow, gray-on-color, low-contrast, layout-transition, line-length, cramped-padding, body-text-viewport-edge, tight-leading, skipped-heading, heading-rhythm, justified-text, tiny-text, undersized-ui-text, all-caps-body, wide-tracking, text-overflow, repeated-container-text, clipped-overflow-container, design-system-font, design-system-color*, design-system-radius*, design-system-font-size*.

  (* advisory, † error.) The design hook's "immediate tier" has 13 rules: broken-image, text-overflow, clipped-overflow-container, body-text-viewport-edge, low-contrast, gray-on-color, tiny-text, gradient-text, dark-glow and the four design-system rules. The website adds 6 "design review" patterns that no detector rule checks.
- **Implication for /frontend:** The registry is small, and the rule IDs are stable identifiers /frontend can map its own slop taxonomy onto (tell N → rule ID). The immediate-tier list is a ready-made "fix at edit time" subset.
- **Evidence:**
  - [README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/README.md) — accessed 2026-09-30 — repository file (primary).
    - line 16: "- **61 deterministic detector rules** plus LLM-only critique checks. The CLI and browser extension run the deterministic rules with no LLM and no API key."
  - [crates/foundation/src/registry.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/foundation/src/registry.rs) — accessed 2026-09-30 — source code (primary).
    - line 843: `assert_eq!(ANTIPATTERNS.len(), 61);`
    - lines 645-647: "The rules the design hook fixes at edit time rather than deferring to a review pass: broken output, objective legibility failures, single-property mechanical slop, and design-system drift."
    - Severity counts come from parsing the `ANTIPATTERNS` array with a script: `Counter({'warning(default)': 47, 'advisory': 12, 'error': 2})`, `slop count 32 quality 29`.
  - [crates/live/assets/antipatterns.json @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/live/assets/antipatterns.json) — accessed 2026-09-30 — generated registry `[{ id, name, category, description }]` (primary); 61 rows.
  - [Slop catalog, impeccable.style/slop](https://impeccable.style/slop) — Paul Bakaus, accessed 2026-09-30 — vendor documentation.
    - "The catalog includes 61 detector rules and 6 patterns for design review. A finding is a reason to look closer: consider the page, the task, and any intentional design choices."
- **Limits / false positives:** Rule packs can add rules through `registry::extend`, but the shipped `impeccable` binary installs none (cli.rs: "The `impeccable` binary installs no rule pack").

### FD02-F04 — Three engines: a line-regex source scan, a static HTML/CSS cascade engine, and a URL engine that drives an installed Chromium over CDP
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The target type picks the engine:
  - HTML files go to a static HTML engine with a parser and a CSS cascade that reads linked local CSS.
  - Other sources (CSS, SCSS, JSX, TSX, Vue, Svelte, Astro, JS, TS) go to a line-oriented regex engine with style-block and CSS-in-JS extraction.
  - `http(s)://` and `file://` URLs go to a browser engine. It launches an already installed Chrome, Chromium, Edge or Brave over the Chrome DevTools Protocol, measures the rendered DOM and adds a screenshot-based "visual" contrast pass.

  The engine downloads no browser. The same rule core also compiles to WebAssembly for the Chrome extension.
- **Implication for /frontend:** URL scans can reuse the owner's Playwright Chromium (`IMPECCABLE_BROWSER` pointed at `ms-playwright\chromium-1217\chrome-win64\chrome.exe` worked in this session). Source scans and URL scans are different instruments (F09, F10), so /frontend should run both against a hackathon build.
- **Evidence:**
  - [crates/detect/src/cli.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/detect/src/cli.rs) — accessed 2026-09-30 — source code (primary).
    - lines 70-74: "Detection modes: / HTML files     Static HTML/CSS analysis (default, catches linked CSS) / Non-HTML files Regex pattern matching (CSS, JSX, TSX, etc.) / URLs           Puppeteer full browser rendering (auto-detected; http(s):// and file:// URLs; accessible linked CSS included)"
  - [docs/ENGINE.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/docs/ENGINE.md) — accessed 2026-09-30 — developer documentation (primary).
    - "There is no Node at runtime."
    - "html         the static HTML engine: parser, cascade, static DOM, rule adapters"
    - "browser      the URL engine: Chrome discovery, CDP, snapshot, visual pass"
    - "The same rules that run natively run in a page, compiled to WebAssembly."
  - [crates/browser/src/discovery.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/browser/src/discovery.rs) — accessed 2026-09-30 — source code (primary).
    - lines 1-4: "The JS engine launches puppeteer's bundled Chrome (on Windows the system `channel: 'chrome'` first, then bundled); the binary downloads nothing, so it discovers an installed browser instead."
    - `pub const ENV_KEYS: [&str; 3] = ["IMPECCABLE_BROWSER", "PUPPETEER_EXECUTABLE_PATH", "CHROME_PATH",];`
  - OBSERVED run, 2026-09-30: `IMPECCABLE_BROWSER=<...>\chromium-1217\chrome-win64\chrome.exe impeccable.exe detect --no-config file:///C:/.../slop-page.html` → exit 2 in 9.8 s wall time. The run left no files in the redirected `TEMP` profile folder.
  - Verification rerun, 2026-09-30, same binary (sha256 checked) and same Chromium, on a copy of the fixture: exit 2 in 9.95 s, "31 anti-patterns found.", and zero files left in the redirected `TEMP` and `HOME` folders.
- **Limits / false positives:** The help text still says "Puppeteer" although the Rust engine drives CDP itself (see Contradictions). URL scans cannot read cross-origin CSS without CORS (README line 468).

### FD02-F05 — Running it: `impeccable detect`, JSON on stdout, human text on stderr, exit codes 0/2/1 (observed on Windows)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Usage is `impeccable detect [options] [file-or-dir-or-url...]`. The options are `--json`, `--quiet`, `--scope type|layout`, `--viewport WxH` (default 1280x800), `--no-config`, `--no-inline-ignores`, `--no-design-system` and `--no-advisory`. Piped stdin is scanned when no target is given.

  Each JSON finding carries these keys in order: `antipattern, name, description, severity, category, file, line, snippet`, then `advisory: true` only for advisories, then any extras. Exit 0 means no primary findings, 2 means primary findings, and 1 means at least one target could not be scanned; 1 takes precedence over 2. Engine 0.1.8 scanned my fixture page in 86 ms and printed findings grouped by file.
- **Implication for /frontend:** Integration is cheap. Parse `--json`, key on `antipattern`/`category`/`advisory`, and treat exit 1 as "scan failed", never as "clean". The vendor's own wording ("evidence, not proof") matches /harden's stance and can be quoted in /frontend.
- **Evidence:**
  - [crates/detect/src/cli.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/detect/src/cli.rs) — accessed 2026-09-30 — source code (primary).
    - lines 51-55: "Exit status: / 0  Scan completed with no primary findings (advisories may still be listed) / 1  At least one requested target could not be scanned / 2  Scan completed with primary findings / Operational failure takes precedence when a multi-target scan is partial."
  - [crates/foundation/src/findings.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/foundation/src/findings.rs) — accessed 2026-09-30 — source code (primary).
    - "A detector finding, serialized in the exact JS key order: `antipattern, name, description, severity, category, file, line, snippet` then `advisory` (only when true), then any extra keys a caller spread in"
  - [README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/README.md) — accessed 2026-09-30 — repository file (primary).
    - line 468: "A clean detector run is evidence, not proof of visual or accessibility quality: it does not replace inspecting the rendered experience across relevant viewports."
  - OBSERVED run, 2026-09-30. The binary came from https://github.com/pbakaus/impeccable/releases/download/engine-v0.1.8/impeccable-windows-x64.exe with sha256 `5f39934bdbc24cd414173fd55a7bbd7a3b497646ce3d5124ba93eb591fa0ddcd`, which equals the release `.sha256` sidecar. The runs used `HOME`, `USERPROFILE`, `IMPECCABLE_HOME`, `TEMP` and `TMP` redirected to a scratch folder, plus `IMPECCABLE_NO_TELEMETRY=1 DO_NOT_TRACK=1`.
    - `impeccable.exe --version` → `4.0.0`
    - `impeccable.exe detect --no-config fixtures/slop-page.html` → exit 2, `real 0m0.086s`, "22 anti-patterns found." then "── Advisory (not counted as failures) ──" … "1 advisory note. Suppress with --no-advisory."
    - `--json` output begins: `{"antipattern": "side-tab", "name": "Side-tab accent border", ..., "severity": "warning", "category": "slop", "file": "C:\\...\\slop-page.html", "line": 0, "snippet": "border-left: 4px + border-radius: 16px"}`. Full outputs are saved under `research/evidence/tool-impeccable/`.
  - Verification rerun, 2026-09-30, on a downloaded copy whose sha256 matched the sidecar: `--version` → `4.0.0`; three static scans → exit 2, "22 anti-patterns found.", "1 advisory note.", 80 to 93 ms each; the `--json` array held 23 rows (the advisory row adds `"advisory": true` after `snippet`), and every row had `"line": 0`.
- **Limits / false positives:** Every finding from the static HTML scan carried `line: 0`, element-level ones such as `side-tab` included, so exact file:line locations exist only for regex-scanned sources. The `--version` string does not match the engine version (see F27). (corrected: was "Page-level findings from HTML scans carry `line: 0`"; the verification rerun showed all 23 rows at line 0)

### FD02-F06 — False-positive controls: an advisory tier, inline and config ignores with reasons, brand fonts on their own domains, and a DESIGN.md palette exemption
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Impeccable controls false positives in five ways:
  - Advisory rules are listed separately and never counted.
  - In-file waivers (`impeccable-disable`, `-line`, `-next-line`) work in any comment syntax.
  - Config ignores in `.impeccable/config.json` cover rules (`ignore-rule`), files (`ignore-file`) and single values (`ignore-value`); only `ignore-value` takes a `--reason "..."` field, and `--local` writes it to the untracked `.impeccable/config.local.json` instead. (corrected: the `--reason` field is documented only for `ignore-value`, hooks.md subcommand table)
  - A few brand fonts are allowed on their owners' domains: Roboto on Google domains, Geist on vercel.com/nextjs.org/v0.app, Mona Sans on GitHub.
  - Since skill 4.4.0 (website changelog), colors documented in DESIGN.md are not flagged as the "AI color palette".

  The skill tells agents to fix real problems rather than ignore them.
- **Implication for /frontend:** A sponsor's brand font or brand purple should be carried as a narrow `ignore-value` or a DESIGN.md token, with the evidence in `--reason`. /frontend should never add file-wide or rule-wide ignores without the owner.
- **Evidence:**
  - [crates/detect/src/cli.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/detect/src/cli.rs) — accessed 2026-09-30 — source code (primary).
    - lines 43-45: "Some rules are advisory: detected and listed in a separate section, but never counted as failures and never changing the exit code. They stay out of the failure count so they never block automation."
    - lines 64-66: "<!-- impeccable-disable overused-font -- exported brand doc -->" / ".brand { font-family: Inter } /* impeccable-disable-line overused-font */" / "// impeccable-disable-next-line bounce-easing: intentional bounce"
  - [skill/reference/hooks.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/hooks.md) — accessed 2026-09-30 — skill reference (primary).
    - "- **Real design problem**: fix it. Never add an ignore to skip a fix or to push a blocked write through."
    - "Self-serve stops at `ignore-value`. `ignore-file` and `ignore-rule` silence too much to add on your own judgment; ask the user first."
    - added at verification, subcommand table: the two `ignore-value` rows read `ignore-value <id> <value> [--shared] [--reason "..."]` with "Append a rule/value suppression to shared `.impeccable/config.json`." and `ignore-value <id> <value> --local [--reason "..."]` with "Append a private rule/value suppression to `.impeccable/config.local.json`."; the `ignore-rule <id>` and `ignore-file <glob>` rows list no reason flag. The same file says waivers work "in any comment syntax, with an optional reason after `:` or `--`".
  - [crates/foundation/src/constants.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/foundation/src/constants.rs) — accessed 2026-09-30 — source code (primary).
    - line 124: `pub const BRAND_FONT_DOMAINS` with `("geist", VERCEL_DOMAINS)` where `VERCEL_DOMAINS = &["vercel.com", "nextjs.org", "v0.app"]`
  - [Changelog, impeccable.style/changelog](https://impeccable.style/changelog) — Paul Bakaus, entry "Skill v4.4.0 September 25, 2026", accessed 2026-09-30 — vendor release notes.
    - "Colors defined in your DESIGN.md are no longer flagged as a generic AI palette, and Tailwind spinners no longer count as accent borders."
- **Limits / false positives:** These controls suppress exceptions someone already knows about. They neither measure nor bound the false-positive rate (F07, F08).

### FD02-F07 — Detector accuracy is tested on hand-written fixtures and frozen goldens, not on a corpus of real sites
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The detector's test base has three parts:
  - About 114 fixture files under `tests/fixtures/antipatterns/`, including pairs such as `should-flag.html` / `should-pass.html`.
  - Oracle "goldens": byte-for-byte recordings of the former JS engine's output, which the Rust port must match.
  - Rule unit tests.

  Aggregate figures in the repo describe fixture findings, for example "419 to 420 findings in the aggregate fixture corpus". None of the changelog's measured numbers is a detector precision or recall figure: they are speed and cost figures (hook 46.9 to 10.6 ms; a 110-file scan 282 to 132 ms; in a 24-image comparison, median image generation 88 to 18 s with about 73% lower estimated cost) and one bias-mining tally of generated pages with the skill off (F31). False-positive bugs keep arriving from users (for example #881, #882, #883 and #867 open on 2026-09-30; the first three from one reporter). (corrected: was "The only measured numbers in the changelog are speed"; the changelog also carries cost figures and the v3.5.0 bias-mining rates)
- **Implication for /frontend:** No one has checked this tool against the owner's standard (silent on human control sites, firing on past hackathon frontends). /frontend must run that calibration itself and keep the results as receipts before any Impeccable rule gates a build.
- **Evidence:**
  - [tests/oracle/README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/tests/oracle/README.md) — accessed 2026-09-30 — test documentation (primary).
    - "The goldens are **frozen JS behavior**" … "Byte-equal is the bar; `DELTAS.md` lists reviewed exceptions."
  - [tests/fixtures/antipatterns/should-pass.html @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/tests/fixtures/antipatterns/should-pass.html) — accessed 2026-09-30 — test fixture (primary).
    - `<title>Clean Patterns — Should NOT Flag</title>` … "None of these should be flagged. They're all intentional, well-established web patterns."
  - [docs/REVIEW-4.4.0-READINESS.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/docs/REVIEW-4.4.0-READINESS.md) — accessed 2026-09-30 — release review (primary).
    - "(419 to 420 findings in the aggregate fixture corpus)"
  - [Changelog, impeccable.style/changelog](https://impeccable.style/changelog) — accessed 2026-09-30 — vendor release notes.
    - "On the same corpus and machine, the design hook ran in 10.6 ms instead of 46.9 ms. A scan of 110 files took 132 ms instead of 282 ms."
    - added at verification: "More iterations, less waiting. In our 24-image comparison, median generation time fell from 88 seconds to 18, with approximately 73% lower estimated cost. Results vary by prompt." and, in the Skill v3.5.0 entry (May 28, 2026), "Measured across ~190 samples, skill off. Each rate traced to a line in the skill, then fixed." (see F31)
  - [GitHub issue search "false positive" in pbakaus/impeccable](https://github.com/pbakaus/impeccable/issues?q=%22false+positive%22) — accessed 2026-09-30 — issue titles (primary).
    - `#881 [open] … analytic-gradient+alpha contrast composites over black, reporting 17.6:1 text as 1.2:1`; `#882 [open] … text-occlusion counts closed <details> content as an occluder (23 false positives from one mobile nav)`; `#394 [open] … side-tab rule misses non-border stripe constructions (inset box-shadow, ::before, stripe divs)`
- **Limits / false positives:** This finding rests on absence of evidence (search method under "What could not be found"). RELEASE-4.4.0.md mentions a "Private eval harness", which may hold data I cannot see.

### FD02-F08 — MEASURED: URL scans of four professionally designed sites all exited 2, and three of the four drew "slop" findings
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** On 2026-09-30 I ran engine 0.1.8 in URL mode (default 1280x800 viewport, `--no-config --json`, Playwright Chromium 1217) against four sites widely treated as professionally designed. Every one returned exit 2.

  | Site | Wall time | Primary findings | Slop-category findings | Quality-category findings |
  |---|---|---|---|---|
  | stripe.com | 22 s | 95 | 9, all `ai-color-palette`, snippet "Purple/violet gradient background" | 86: tight-leading 44, clipped-overflow-container 12, low-contrast 12, heading-rhythm 9, layout-transition 8, line-length 1 |
  | linear.app | 29 s | 64 | 6, all `nested-cards` | 58, including 23 `undersized-ui-text`, e.g. "10px functional text "ENG-2085" (below 11px floor)" |
  | www.gov.uk | 7 s | 9 | 4, all `side-tab`, snippets "border-top: 4px" ×3 and "border-top: 10px" | 5 |
  | rauno.me | 7 s | 8 | 0 | 8 |

  None of the four produced advisories.
- **Implication for /frontend:** The raw exit code cannot be /frontend's pass/fail gate. A rule may block only after it has stayed silent on a control corpus, which should include the sponsor-customer sites /frontend imitates. Brand purples such as Stripe's need a DESIGN.md exemption. The quality rules need triage one by one. Note also that `side-tab` fires on top borders in the rendered engine, a pattern GOV.UK uses on purpose.
- **Evidence:**
  - OBSERVED/MEASURED run, 2026-09-30: `impeccable.exe detect --no-config --json https://stripe.com` (then `https://linear.app`, `https://www.gov.uk`, `https://rauno.me`) with `IMPECCABLE_BROWSER` set to Playwright's chromium-1217. The console printed `https://stripe.com exit=2 secs=22`, `https://linear.app exit=2 secs=29`, `https://www.gov.uk exit=2 secs=7`, `https://rauno.me exit=2 secs=7`. Tallies come from a Python count over the JSON; the raw files are `research/evidence/tool-impeccable/control-*.json`.
  - Verification, 2026-09-30: a recount of the four saved JSON files gave the same tallies as the table. A rerun of the four URL scans with the same binary and Chromium also exited 2 on each site. linear.app (64: 6 nested-cards), www.gov.uk (9: side-tab ×4, "border-top: 4px" ×3 and "border-top: 10px") and rauno.me (8, no slop) repeated exactly. stripe.com gave 96 in 59 s: the same 95 plus one `script-error`. In crates/core/src/checks/rules.rs, `check_borders` reports `side-tab` for a non-neutral 3 to 12 px top or bottom border (at least twice as wide as the other sides) on an element without radius and outside a tab context, so the GOV.UK hits are the rule working as written, not a bug.
  - [crates/foundation/src/registry.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/foundation/src/registry.rs) — accessed 2026-09-30 — rule text (primary).
    - side-tab: "Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs."
- **Limits / false positives:** Four live pages on one day at one viewport. Geolocation, cookie banners or A/B variants may differ on a rerun. I did not adjudicate whether each quality finding is a real defect; Linear's 10px labels are inside a product mock. "Professionally designed" is a reputational label, not proof that no AI was involved.

### FD02-F09 — MEASURED: coverage of the owner's 20 tells on a synthetic slop page and a Next.js/Tailwind fixture
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** I wrote `slop-page.html`, one full page carrying all 20 tells (fictional DeFi protocol, Google-Fonts Inter + Space Grotesk + Instrument Serif), and a `next-app/app/page.tsx` + `globals.css` pair in shadcn/Tailwind style (next/font Inter, lucide-react, `Badge`/`Card`/`Button`). Engine 0.1.8 results:

  | # | Tell | Static HTML scan (22 + 1 adv.) | URL scan of same page (31 + 1 adv.) | TSX/CSS source scan (9) |
  |---|---|---|---|---|
  | 1 | purple-to-blue gradient | ai-color-palette | ai-color-palette ×6 | ai-color-palette ×3 |
  | 2 | gradient hero text | gradient-text ×2 | gradient-text ×2 | gradient-text ×2 |
  | 3 | emoji in headings | none | none | none |
  | 4 | Inter everywhere | overused-font "Primary font: inter" | none | none (Inter via `next/font`) |
  | 5 | colored border cards | side-tab ×3 | side-tab ×3 | side-tab ×2 |
  | 6 | glassmorphism cards | none | only as low-contrast "on backdrop filter" (pixel 1.1:1) | none |
  | 7 | low-contrast dark mode | low-contrast "4.1:1 … #6b7280 on #0a0a0f" | low-contrast ×9 incl. glass cards | none |
  | 8 | three icon boxes in a row | icon-tile-stack ×3 | icon-tile-stack ×3 | none |
  | 9 | badge above headline | kicker-above-heading | kicker-above-heading | none |
  | 10 | Lucide everywhere | none | none | none |
  | 11 | untouched shadcn | n/a | n/a | none |
  | 12 | fade-in on scroll | none | none | none |
  | 13 | cursor-following beam | radial-spotlight-glow (the glow, not the tracking) | same | none |
  | 14 | buttons fade on hover | none | none | none |
  | 15 | inconsistent spacing | none | none | none |
  | 16 | em dashes everywhere | em-dash-overuse (advisory) | em-dash-overuse (advisory) | none |
  | 17 | buzzword copy | marketing-buzzword "13 buzzword phrases" | none | none |
  | 18 | serif italic accents | italic-serif-display | italic-serif-display | none |
  | 19 | Space Grotesk + Instrument Serif | overused-font "space grotesk"; italic-serif names instrument serif | italic-serif only | overused-font (Space Grotesk in globals.css) |
  | 20 | grain over a gradient | none | none | none |

  Detected in some form: static 12/20 (10 full, 2 partial), URL 11/20 (7 full, 4 partial), source 4/20. Across all three modes 13/20 were touched. No mode caught tells 3, 10, 11, 12, 14, 15 or 20. Tell 6 appeared only as its contrast symptom.

  Correction to cell 7, static column: the fixture puts tell 7 on the card body text (`.card p { color: #4b5563 }` on a glass card over `#0a0a0f`: 2.6:1 against the bare ground and 2.3:1 against the card's `rgba(255,255,255,.06)` fill flattened onto it, WCAG formula computed at verification). The static scan did not flag that text. Its two `low-contrast` hits are the hero subtitle (`#d1d5db` on `#3b82f6`, 2.5:1) and the footer (`#6b7280` on `#0a0a0f`, 4.1:1). The card text was flagged only by the URL scan's pixel pass ("on backdrop filter"). Cell 7 in the static column is therefore at best a partial hit, found on an element that was not the planted one. The "10 full" count overstates by one unless this cell was already among the two partials. The fixture does not say which cells were counted as partial. On tell 12: the registry's `content-hidden-at-rest` (error) fires only when text stays at opacity 0 or hidden "even after every reveal handler had a chance to run", which is a failed reveal. A working fade-in on scroll passes it. (corrected: static cell 7 hit a different element than the planted tell; nuance on tell 12 added at verification)
- **Implication for /frontend:**
  - /frontend needs its own checks for emoji in headings, icon-library monoculture, unmodified shadcn defaults, scroll-reveal entrances, hover-opacity fades, spacing-scale drift, grain textures and glass as a pattern.
  - It must scan the running build in URL mode and also the static or source files, because each mode misses what the other sees.
  - For .tsx projects, it must not count on the source scan for copy or font tells.
- **Evidence:**
  - OBSERVED/MEASURED runs, 2026-09-30:
    - `impeccable.exe detect --no-config fixtures/slop-page.html` → exit 2, "22 anti-patterns found.", "1 advisory note."
    - `impeccable.exe detect --no-config file:///C:/.../fixtures/slop-page.html` → exit 2, "31 anti-patterns found."
    - `impeccable.exe detect --no-config fixtures/next-app` → exit 2, "9 anti-patterns found."
    - Fixtures and full outputs are in `C:/Users/Utilisateur/.claude/skills/frontend/research/evidence/tool-impeccable/` (`fixtures/`, `detect-static-slop-page.txt|json`, `detect-url-slop-page.txt`, `detect-source-next-app.txt`).
  - Sample lines from the static scan: "[italic-serif-display] italic serif h1 (instrument serif) at 72px "Supercharge your liquidity with Nexora"", "[kicker-above-heading] kicker "✨ Now live on mainnet" above h1 …", "[radial-spotlight-glow] radial-gradient spotlight glow "beam" (#8b5cf6 a0.35 → transparent) on 600x600 surface".
  - Sample line from the URL scan: "[low-contrast] pixel contrast 1.1:1 median 1.5:1 (need 4.5:1) on backdrop filter "Cutting-edge execution — sub-second finality — built for teams of any size.""
  - Verification, 2026-09-30: the saved outputs recount to 22 (+1 advisory), 31 (+1 advisory) and 9. A rerun on copies of the fixtures reproduced the static and URL counts, and the source-scan finding lines matched `detect-source-next-app.txt` exactly. The static JSON `low-contrast` snippets are "2.5:1 (need 4.5:1) — text #d1d5db on #3b82f6" and "4.1:1 (need 4.5:1) — text #6b7280 on #0a0a0f". In the fixture, `#6b7280` is used only by `footer`.
- **Limits / false positives:** I wrote the fixture knowing the rules, so it may be easier or harder to detect than the owner's real past frontends. This is one page and one run, and cells 4, 17 and 19 depend on the thresholds and engine gaps in F10 and F12. Tell 11 cannot be expressed in a plain HTML file.

### FD02-F10 — Copy rules and several CSS analyzers run only on full HTML-like pages, and the URL engine has no buzzword or cadence rule
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** In source scans, seven "page analyzers" run only when the file looks like a full page (a `<!doctype`, `<html` or `<head` tag) and has an extension in {.html, .htm, .astro, .vue, .svelte} or none: monotonous-spacing, em-dash-overuse, marketing-buzzword, aphoristic-cadence, dark-glow, radial-halo and marquee. A React/Next.js `.tsx` component or a `.css` file never gets them. The browser driver's page passes include em-dash overuse, kicker, numbered labels, repeated text, typography and cream palette, but no marketing-buzzword or aphoristic-cadence pass. This matches the observed runs: the TSX fixture, with 8 em dashes and 10 phrases from the 29-item buzzword list in its strings (my count), produced no copy finding, and the URL scan of the slop page reported no buzzword while the static scan reported 13.
- **Implication for /frontend:** For the owner's likely stack (TypeScript, React, shadcn per tell 11), UI copy has to be checked on rendered text, for example by piping the extracted DOM text through /prose's calibrated checker. Impeccable's copy rules cannot be relied on.
- **Evidence:**
  - [crates/detect/src/detect_text.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/detect/src/detect_text.rs) — accessed 2026-09-30 — source code (primary).
    - line 34: `const PAGE_ANALYZER_EXTS: &[&str] = &[".html", ".htm", ".astro", ".vue", ".svelte"];`
    - lines 68-73: `pub fn should_run_page_analyzers(content: &str, file_path: &str) -> bool { if !is_full_page(content) { return false; } … ext.is_empty() || PAGE_ANALYZER_EXTS.contains(&ext.as_str())`
  - [crates/detect/src/regex_matchers.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/detect/src/regex_matchers.rs) — accessed 2026-09-30 — source code (primary).
    - lines 1361-1369: `pub const REGEX_ANALYZERS: &[Analyzer] = &[ analyze_monotonous_spacing, analyze_em_dash_overuse, analyze_marketing_buzzword, analyze_aphoristic_cadence, analyze_dark_glow, analyze_radial_halo, analyze_marquee, ];`
  - [crates/core/src/browser/driver.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/core/src/browser/driver.rs) — accessed 2026-09-30 — source code (primary).
    - lines 1460-1474: `page_pass(… pc::check_typography(dom));` … `tc::check_numbered_section_labels_dom` … `tc::check_repeated_container_text_dom` … `tc::check_em_dash_overuse_dom` … `q::check_page_quality_dom` … `pc::check_cream_palette` … `scoped_html_pattern_findings(dom)`. `grep` finds no "buzz" or "aphoris" in the file.
  - OBSERVED: `detect-source-next-app.txt` lists only side-tab, overused-font, gradient-text, ai-color-palette and bounce-easing.
- **Limits / false positives:** The static HTML engine does run the buzzword analyzer on .html files, as the observed static scan showed.

### FD02-F11 — Source-mode Tailwind and font checks are single-line regexes with narrow patterns
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** In the regex engine:
  - `ai-color-palette` fires for a Tailwind gradient only when a `from-(purple|violet|indigo)-N` class and a `to-(purple|violet|indigo|blue|cyan|pink|fuchsia)-N` class sit on the same line, or for `text-(purple|violet|indigo)-N` on a line with heading context. As written, `from-blue-500 to-purple-600` does not match; I did not run that case.
  - `overused-font` needs a literal `font-family:` declaration or a Google Fonts URL. `next/font` imports do not produce either, which matches the observed miss.
  - Arbitrary Tailwind values such as `shadow-[0_0_30px_rgba(...)]` and `bg-[radial-gradient(...)]`, and gray-on-dark class pairs such as `text-slate-600` on `bg-slate-950`, drew no findings in the observed TSX scan.
- **Implication for /frontend:** Any source-level linting /frontend adds should parse whole class lists per element instead of copying these regexes. For Tailwind builds, the rendered URL scan is the reliable Impeccable mode.
- **Evidence:**
  - [crates/detect/src/regex_matchers.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/detect/src/regex_matchers.rs) — accessed 2026-09-30 — source code (primary).
    - lines 578-585: `FROM_PURPLE_RE, format!("{B}from-(?:purple|violet|indigo)-({D}+){B}")` and `TO_COLOR_RE, format!("{B}to-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-{D}+{B}")`
    - lines 933-935: `find_all: |l| all(&FROM_PURPLE_RE, l), test: |_, line| TO_COLOR_RE.is_match(line),`
    - lines 510-535: `OVERUSED_FONT_RE` built as `"{}{WS}*:{WS}*['\"]?({}){B}"` from `ci("font-family")` and the name list.
  - OBSERVED: the fixture line `const inter = Inter({ subsets: ["latin"] });` produced no finding; `detect-source-next-app.txt`.
- **Limits / false positives:** The URL engine reads computed styles and did flag the purple gradient backgrounds of the same design in rendered form (F09). The gap is limited to source mode.

### FD02-F12 — Thresholds of the rules closest to the owner's tells, and how they compare with /prose
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Thresholds as coded or described:
  - **em-dash-overuse:** at least 8 dashes, counting "—" and "--" followed by a non-space, and the text is no longer than count × 500 characters. It is advisory.
  - **marketing-buzzword:** fires on a single hit among 29 fixed phrases, from "streamline your" to "harness the power". There is no density threshold.
  - **aphoristic-cadence:** at least 3 "Not a X. Y." or "X. No/Just Y." constructions.
  - **monotonous-spacing:** at least 10 spacing values, with the most common one above 60% and no more than 3 distinct values. This is the opposite of the owner's "inconsistent spacing" tell.
  - **Browser overused-font:** at least 20 text elements, with a single most-used primary face that is on the list.
  - **Descriptions of the other rules:**
    - flat hierarchy: "less than 1.25× at every step"
    - line length: "wider than ~80 characters"
    - tight leading: "below 1.3x"
    - tiny text: "below 12px"
    - undersized UI text: "below 11px"
    - wide tracking: "above 0.05em"
    - low contrast: "4.5:1 for body, 3:1 for large text"

  At about 6 characters per word, which is my assumption rather than the vendor's, one dash per 500 characters is roughly 12 per 1000 words. That is about six times looser than /prose PR-01's 2.0 per 1000 words.
- **Implication for /frontend:** Impeccable's copy thresholds were not tuned against a control corpus. /frontend should use /prose's calibrated checker for UI copy and treat Impeccable's em-dash and buzzword rules as weaker duplicates. The 20-element minimum means small hackathon landing pages can pass the browser font check whatever face they use.
- **Evidence:**
  - [crates/foundation/src/constants.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/foundation/src/constants.rs) — accessed 2026-09-30 — source code (primary).
    - lines 193-195: `pub const EM_DASH_FLOOR: usize = 8;` … `pub const EM_DASH_CHARS_PER_DASH: usize = 500;`
  - [crates/detect/src/regex_matchers.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/detect/src/regex_matchers.rs) — accessed 2026-09-30 — source code (primary).
    - line 1113 `if rounded.len() < 10 {`; line 1137 `if pct <= 0.6 || unique.len() > 3 {`; line 1207 `if count < EM_DASH_FLOOR {`; line 1221 `const BUZZWORDS: &[&str] = &[`; line 1277 `if count == 0 {`; line 1316 `if count < 3 {`
  - [crates/core/src/browser/page_checks.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/core/src/browser/page_checks.rs) — accessed 2026-09-30 — source code (primary).
    - line 143: `if total_text_elements >= 20.0 {`
  - [crates/foundation/src/registry.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/foundation/src/registry.rs) — accessed 2026-09-30 — rule text (primary).
    - em-dash-overuse: "Advisory only: humans use em-dashes legitimately, so this fires only on saturation — at least 8 em-dashes (— or --) at a density near one per 500 characters of body text — never on a long article that uses a few."
- **Limits / false positives:** I quote thresholds from code and did not unit-test them. Closed issue #619's title reported that the flat-type-hierarchy message once contradicted the enforced threshold ("the message contradicts the 2.0 threshold the code enforces"). I did not re-derive that rule's current numeric threshold from code.

### FD02-F13 — The detector code, the rule description and the skill text each carry a different list of overused fonts
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **Detector code (17 names):** inter, roboto, open sans, lato, montserrat, arial, helvetica, fraunces, instrument sans, instrument serif, geist, geist sans, geist mono, mona sans, plus jakarta sans, space grotesk, recoleta. A code comment describes the newer names as "the Anthropic-skill / Vercel / GitHub default wave".
  - **Rule description:** names only six of them.
  - **New-work skill text (16 "training-data defaults" for Persuade/Experience surfaces):** adds Syne, Space Mono, IBM Plex, DM Sans, DM Serif, Outfit, Crimson, Cormorant, Lora, Newsreader and Playfair Display, gives "Inter-as-display" rather than Inter, and omits Instrument Serif.
  - **operate.md:** allows system fonts on product UI.

  Both faces in the owner's tell 19 are in the detector list; Instrument Serif is missing from the skill text.
- **Implication for /frontend:** Keep one authoritative blocklist, including the owner's two named faces and the reflex list. Apply it by surface type (landing page versus app UI), and carry sponsor brand fonts as documented exceptions, following the brand-domain pattern.
- **Evidence:**
  - [crates/foundation/src/constants.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/foundation/src/constants.rs) — accessed 2026-09-30 — source code (primary).
    - lines 85-103: `pub const OVERUSED_FONTS: &[&str] = &[ … "inter", "roboto", … "fraunces", "instrument sans", "instrument serif", "geist", … "space grotesk", "recoleta", ];` with comment line 94 "// Newer monoculture (the Anthropic-skill / Vercel / GitHub default wave):"
  - [crates/foundation/src/registry.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/foundation/src/registry.rs) — accessed 2026-09-30 — rule text (primary).
    - "Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, and Space Grotesk are used on so many sites they no longer feel distinctive."
  - [skill/reference/new-work.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/new-work.md) — accessed 2026-09-30 — skill reference (primary).
    - line 67: "Persuade and Experience surfaces want faces with a point of view, and these training-data defaults mean you stopped looking: Fraunces, Playfair Display, Cormorant, Lora, Crimson, Newsreader, Syne, Space Grotesk, Space Mono, IBM Plex, Inter-as-display, DM Sans, DM Serif, Outfit, Plus Jakarta Sans, Instrument Sans."
  - [skill/reference/operate.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/operate.md) — accessed 2026-09-30 — skill reference (primary).
    - "Product can afford things brand surfaces can't. / - System fonts and familiar sans defaults."
- **Limits / false positives:** The lists are judgment calls. Neither the code nor the website gives a frequency measurement behind them.

### FD02-F14 — The "craft floor": Impeccable's LLM-only refusals, loaded before every UI edit (verbatim)
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** SKILL.md step 3 requires reading `craft-floor.md` "immediately before any UI edit". The floor carries numeric verify checks and a "Refuse" list, which is the textual counterpart of many of the owner's tells. The file frames these as category defaults the brief can earn back, except the kicker, which "is a ban, not a default".
- **Implication for /frontend:** Several items map straight onto the owner's tells: gradient text (2), glass (6), side stripes (5), kicker/eyebrow (9), emoji as icons (3), identical icon cards (8) and one identical entrance per section (12). They can be vendored with attribution as generation-time rules. The "Browser surfaces" item (theming selection, caret, scrollbars, focus rings, tabular numerals) is a cheap anti-slop signal missing from the owner's list.
- **Evidence:**
  - [.claude/skills/impeccable/reference/craft-floor.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/.claude/skills/impeccable/reference/craft-floor.md) — accessed 2026-09-30 — Claude build of the reference (primary).
    - "- **Type:** body measure 65–75ch, display max 6rem, tracking floor -0.04em, balanced headings, obvious scale and weight steps."
    - "- **Motion:** one authored moment, not scattered effects and not one identical entrance on every section. Exponential ease-out from an already-visible default."
    - "- **Browser surfaces:** the parts you did not draw still carry the design. Text selection, the caret, custom scrollbars, focus rings, underline offset, and the numerals in tabular data all ship with browser defaults that belong to no design system."
    - "These are the category's defaults, not bans: the brief's own words can earn any of them."
    - "- Same-size cards of icon plus heading plus text as the page structure. Cards are the lazy container; nested cards are always wrong."
    - "- A kicker or eyebrow above a heading. This one is a ban, not a default: no brief earns it back."
    - "- Gradient text. Emphasis comes from weight or size."
    - "- Glass and blur as decoration rather than as a specific effect."
    - "- A colored `border-left` or `border-right` above 1px on cards, list items, callouts, or alerts."
    - "- Unicode glyphs or emoji standing in for an icon system. Icons are drawn, from a real library or authored SVG, in one consistent stroke and weight."
  - [.claude/skills/impeccable/SKILL.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/.claude/skills/impeccable/SKILL.md) — accessed 2026-09-30 — skill (primary).
    - "read [reference/craft-floor.md](reference/craft-floor.md) immediately before any UI edit, including small refinements. It carries the quality floor, the absolute bans, and the reflexes no detector catches."
- **Limits / false positives:** These are the author's design judgments, and no evaluation of them is published. The Claude build of the floor is 730 words.

### FD02-F15 — Build-specific text: the Claude build drops the Codex-only grain, stripe and grid bans and adds a Claude "rendition prior"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The source references contain `<codex>`, `<gemini>` and `<claude>` blocks, and each provider build keeps only its own block. The source craft floor's Codex-only block bans sketchy SVG and `feTurbulence` grain, the hairline-border-plus-wide-shadow "ghost card", `repeating-linear-gradient` stripes, grid overlays and "theater" framing. Its Gemini-only block bans image hover transforms. None of these appear in the Claude build. The Claude block in new-work warns about Claude's own "measured rendition prior" of cream grounds, serif display with italic accents, and lamplight.
- **Implication for /frontend:** Vendor from `skill/reference/*.md`, which holds every block, not from the Claude build. Otherwise tell 20 (grain over a gradient) loses its only text rule. That rule is narrower than tell 20. It sits under "Real illustration or none", so it condemns `feTurbulence` grain as sketchy illustration, not grain overlays on gradients as such. new-work.md and visualize.md also accept "a texture (paper, cloth, grain)" as a legitimate raster plate cut from an approved comp. /frontend needs its own wording for tell 20. The Claude block matches tell 18 closely and can be quoted in /frontend's Claude-specific guidance. (corrected: scope of the grain rule and the texture exception added at verification)
- **Evidence:**
  - [skill/reference/craft-floor.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/craft-floor.md) — accessed 2026-09-30 — source reference (primary).
    - lines 44-50 (`<codex>` block): "Real illustration or none. Sketch-style SVG scenes, `loose-sketch` / `doodle` class names, and `feTurbulence` grain read as amateur." … "A 1px border under a wide soft shadow is the ghost card."
    - lines 52-54 (`<gemini>` block): "Never animate an image on hover, directly or through its parent."
  - [.claude/skills/impeccable/reference/craft-floor.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/.claude/skills/impeccable/reference/craft-floor.md) — accessed 2026-09-30 — Claude build (primary). 44 lines (4,484 bytes, 730 words); contains no "feTurbulence", "ghost card" or "image on hover". (corrected: was "45 lines"; `wc -l` counts 44 and the file ends in a newline)
  - added at verification: [skill/reference/new-work.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/new-work.md) line 115, "a texture (paper, cloth, grain) is a clean patch of the comp region mirror-tiled to size, generated only when no clean patch exists"; [skill/reference/visualize.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/visualize.md) line 39 lists "any texture by name (woven cloth, paper grain, fabric, leather, brushed metal)" as a region that "ships as a raster". A search of the 38 `skill/reference` files, the 4 `skill/agents` files and `SKILL.src.md` at 909726c for "grain", "noise" and "feTurbulence" found no other anti-grain text.
  - [skill/reference/new-work.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/new-work.md) — accessed 2026-09-30 — source reference (primary).
    - line 72 (`<claude>` block): "Your measured rendition prior: warm, bookish, family, and child-facing subjects come out as cream grounds, serif display with italic accents, and lamplight, even when the assigned direction never asked for them."
- **Limits / false positives:** The file says "measured", but it publishes no data behind the Claude prior.

### FD02-F16 — The build workflow (new-work) is heavy, interactive and partly networked
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **Mandatory roll:** building a new or replacement visual world requires running `impeccable concept-seed`, which fetches a draw from `https://impeccable.style/api` with a default 4000 ms timeout. Skipping it is called "a contract violation".
  - **Decision pages:** choices are presented on a localhost decision page (`serve-question`). An unanswered page falls back to the question tool and then to unattended defaults.
  - **Comp-led path:** needs image generation. The API fallback is OpenAI with `gpt-image-2.5-flare` and requires `OPENAI_API_KEY`. The file calls this path "a frontier-tier job" and adds a human plan-and-asset review before any page code.
  - **No image generation:** code-led is the only path.
- **Implication for /frontend:** An unattended /frontend run inside /execution should not route through Impeccable's new-work. The roll needs network, the gates wait for a human, and the comp path needs an OpenAI key. The transferable ideas are the direction contract and the seeded draw (F17), which /frontend can implement itself with directions drawn from the sponsor-customer research.
- **Evidence:**
  - [skill/reference/new-work.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/new-work.md) — accessed 2026-09-30 — skill reference (primary).
    - line 48: "No substitute, no skip: on a new or replacement world, writing artifact code before this script has run and its assignment is acknowledged is a contract violation, whatever the harness, the model, or the time pressure; the roll is what keeps every run from converging on the category default."
    - line 51: "Exit 4 means the page closed unanswered: re-present once through the structured question tool, and with no answer there either, proceed unattended with the assigned direction and state the assumptions."
    - line 110: "The comp-led path is a frontier-tier job: it asks the builder to hold a measured layout, place plates at their boxes, and act on numeric readings across a dozen attempts."
    - line 115: "No page code is written before they accept it; `build-phase advance` refuses until they do."
  - [crates/context/src/concept_seed.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/context/src/concept_seed.rs) — accessed 2026-09-30 — source code (primary).
    - line 41: `.unwrap_or_else(|| "https://impeccable.style/api".to_string())`; line 30: `IMPECCABLE_API_TIMEOUT` … `.unwrap_or(4000.0)`
  - [crates/context/src/generate_image.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/context/src/generate_image.rs) — accessed 2026-09-30 — source code (primary).
    - line 9: `pub const DEFAULT_MODEL: &str = "gpt-image-2.5-flare";`; line 305: "generate-image: OPENAI_API_KEY is not set; use the harness-native image tool instead."
  - [skill/reference/init.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/init.md) — accessed 2026-09-30 — skill reference (primary).
    - "Without image generation there is no choice to record; code-first is the only path."
- **Limits / false positives:** The privacy page says a "configured local catalog can supply the options without this API request", so the roll can run offline if a local catalog exists. I did not test that.

### FD02-F17 — Vendor research (July 2026): a script-assigned direction broke the model's default, and the "100% of decisive pairs" win is self-evaluated
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** The research page reports a July 2026 campaign of "about 30 skill iterations · about 200 sampled concepts · about $2,600 in evaluations":
  - **Same concept:** across 16 creative framings, 30 of 35 responses proposed the same concept.
  - **Option one wins:** when the model (or a simulated user, or a rejection rule) could pick from a shortlist, option one won 27 of 30 packets, so a script now assigns the direction.
  - **Head-to-head:** a model-judged screenshot comparison moved from 30-40% to "100% of decisive pairs" against the strongest competing skill "on the tasks we had examined in depth". The page itself says this "is not a win rate across all tasks or coding models."
  - **Catalog:** on 2026-07-21 the direction catalog held 375 entries: 188 approved, 172 rejected, 15 pending.
- **Implication for /frontend:** The published mechanism is "the model proposes relevant directions, a seeded script assigns one, and the key is recorded". /frontend can apply it when choosing among directions derived from sponsor-customer sites, and store the seed so a disappointing draw can be replayed. The quality claim is vendor-run and model-judged, so it should not be cited as independent proof.
- **Evidence:**
  - [The Model Can't Roll Its Own Dice, impeccable.style/research](https://impeccable.style/research) — Impeccable (Paul Bakaus), research conducted July 2026, accessed 2026-09-30 — vendor research article.
    - "Impeccable v4 · about 30 skill iterations · about 200 sampled concepts · about $2,600 in evaluations · July 2026"
    - "Thirty of thirty-five responses proposed the same concept."
    - "When the shortlist remained open to selection by the model, a simulated user, or a rejection rule, option one won in 27 of 30 packets."
    - "A separate model compared pairs of screenshots. Earlier iterations had scored 30–40% against the strongest comparison skill. The final workflow won 100% of decisive pairs on the tasks we had examined in depth."
    - "The 100% figure covers decisive comparisons on the tested tasks; it is not a win rate across all tasks or coding models."
    - "On July 21, 2026, the catalog held 375 entries: 188 approved, 172 rejected, and 15 still pending."
- **Limits / false positives:** These are vendor data. The "project's design director" is not named, sample sizes per task are not given, and the page does not name the competing skill.

### FD02-F18 — Impeccable's own test logs record two Claude full-build runs of about 10.5 minutes each, at 2.11 and 2.95 M input tokens, on the September skill 4.2.x line
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** The skill-behavior suite runs LLM-driven scenarios that check routing and protocol (which reference files get loaded and in what order), not design quality. The logs report:
  - A routing sweep that passed 55/57 (section "Release investigation (2026-09-07)").
  - One natural build at 637 s and 37 steps, "not a final full-workflow pass", using about 2.95 M input and 53 K output tokens (section "Remaining gaps after the split (2026-09-07)").
  - A later full Claude build that "passed its automated gates in 623s / 31 steps" with about 2.11 M input and 50 K output tokens (section "Bounded release verification (2026-09-08)").
  - "Release #782 remains on hold." #782 is the pull request "Release: engine 0.1.4, CLI 4.0.5 and skill 4.2.3", which was merged on 2026-09-08T19:12:10Z. The sentence is a stale 2026-09-07 note and says nothing about 4.4.0. The 4.4.0 status comes from docs/RELEASE-4.4.0.md (F27).

  (corrected: the title said "the 4.4.0 release is on hold", but #782 is the 4.2.3 release PR and it merged on 2026-09-08. Run dates added. Grade lowered from A to B because these are single vendor-run measurements, graded like F17.)
- **Implication for /frontend:** An Impeccable-style full build of one surface costs millions of input tokens and 30+ steps. /frontend needs its own step and token ceilings per surface, set against a hackathon budget. Impeccable's tests show the protocol is followed; they do not show the design is good. The runs predate skill 4.3.0 and the 4.4.0 component-review gates, so current costs may differ.
- **Evidence:**
  - [tests/skill-behavior/README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/tests/skill-behavior/README.md) — accessed 2026-09-30 — test documentation (primary).
    - "One provisioned Claude natural-build run reached a final response in 637 seconds and 37 model steps" … "**This is not a final full-workflow pass.**"
    - "The full build reported about 2.95 million input and 53 thousand output tokens across all turns (no cache usage reported)."
    - "The single full Claude build passed its automated gates in 623s / 31 steps" … "The run used about 2.11M input / 50K output tokens (no cache reported)."
    - "The complete routing-only sweep retained its original budgets and passed 55/57 (Claude 17/19, OpenAI 19/19, Gemini 19/19)."
    - "Release #782 remains on hold."
  - added at verification: [PR #782](https://github.com/pbakaus/impeccable/pull/782) — pbakaus/impeccable, accessed 2026-09-30 — `gh api repos/pbakaus/impeccable/issues/782` → `pr=true`, `title=Release: engine 0.1.4, CLI 4.0.5 and skill 4.2.3`, `merged_at=2026-09-08T19:12:10Z`.
- **Limits / false positives:** These are single runs in an API harness that is "not the actual Claude Code host" (same file). The workflow suite "defaults to Claude only", and the file names `claude-sonnet-5` as the current default Claude model. The 2.95 M-token run failed a documentation guard added later.

### FD02-F19 — Community measurement: skill activation was precise (N=28), but under `acceptEdits` every launcher call was refused
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** An external contributor measured version 4.2.1 in issue #744:
  - Activation precision 100% (N=28, 95% CI 88-100%), with zero false activations in 70 negative attempts.
  - 0/10 activations on a document-shaped task, even though the base model wrote DESIGN.md 10/10 times without the skill.
  - Under Claude Code's `acceptEdits` permission mode the launcher was refused 55/55 times. Under `bypassPermissions` it was refused 0/57 times and ran 42 times.

  The maintainer shipped a partial fix in 4.2.2 and kept the issue open.

  On 2026-09-08 the same contributor re-ran the suite against 4.2.2: 240 attempts, same case set and model, both permission modes. Activation precision stayed at 100%, with 0 false positives in 280 negative attempts across four measurements. The document-shaped case still activated 0/10 in both modes. `craft-floor.md` was read before a UI edit in 16/30 activations, up from 6/29. The model told the user about a launcher failure in 16/27 cases, up from 3/27. A Windows failure was untouched: `ParserError: Unexpected token 'context'` from a quoted `impeccable.cmd` invoked without PowerShell's `&` call operator, 4 calls in 56. (corrected: the 4.2.2 rerun was omitted; "silently" no longer describes the 4.2.2 fallback)
- **Implication for /frontend:** If /frontend ever relies on the Impeccable skill inside /execution agents, the Bash launcher must be allowed. Otherwise the scripts fall back to text, which 4.2.2 now usually announces. Sub-commands must be invoked explicitly, because natural wording may not activate the skill at all. Even when it activates, the craft floor was read before only about half of UI edits in the 4.2.2 measurement. On the owner's Windows machine the PowerShell quoting failure applies.
- **Evidence:**
  - [Issue #744, "4.2.1 activates, but nothing behind the activation runs"](https://github.com/pbakaus/impeccable/issues/744) — reporter ktlesr and maintainer pbakaus, opened 2026-09-06 and open on 2026-09-30, accessed 2026-09-30 — practitioner measurement (secondary).
    - "**precision 100% (N=28, 95% CI 88%–100%), zero false positives in 70 negative attempts.**"
    - "| activations | **0 / 10** |" / "| `DESIGN.md` written at project root | **10 / 10** |"
    - comment table: "| `acceptEdits` (the #744 run) | 55 / 55 | 0 |" / "| `bypassPermissions` | **0 / 57** | **42** |"
    - maintainer: "#750 shipped in skill 4.2.2 with clearer skill-directory resolution and a fallback after launcher failure. This is partially addressed, not resolved"
    - added at verification, ktlesr comment of 2026-09-08T16:15:01Z: "| `craft-floor.md` read before a UI edit | **6 / 29 (21%)** | **16 / 30 (53%)** |", "| told the user when the launcher failed | 3 / 27 (11%) | 16 / 27 (59%) |", "`ParserError: Unexpected token 'context'`, a quoted `.cmd` invoked without the `&` call operator, is still 4 calls in 56 against 6 in 57", "precision 100% in all four measurements, 0 false positives in 280 negative attempts". Full report linked there: https://github.com/ktlesr/skill-trigger-measurements/blob/master/reports/impeccable.4.2.2.md (not opened).
- **Limits / false positives:** One contributor's harness and case set, pinned to 4.2.1. The maintainer states that "broad permission bypass is not an installation recommendation."

### FD02-F20 — Critique runs a blind design review before the reviewer sees any detector output
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** `critique` requires two isolated sub-agents: A, a design review, and B, detector plus browser evidence. A must finish before detector findings enter synthesis, because deterministic output "still anchors judgment". A running inline must be announced with a "DEGRADED" banner. Assessment A opens with a "design specificity" judgment, then scores Nielsen's 10 heuristics 0-4 (stating that "Most real interfaces score 20-32 out of 40"), and tags issues P0-P3.
- **Implication for /frontend:** Keep the LLM's design judgment independent of detector output: run it in a separate subagent and merge afterwards. The specificity question is the jury test in the owner's brief: could an unrelated product use this page unchanged?
- **Evidence:**
  - [skill/reference/critique.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/critique.md) — accessed 2026-09-30 — skill reference (primary).
    - "- Assessment A must finish before detector findings enter the parent synthesis context. Detector output is deterministic, but it still anchors judgment."
    - "- If you degrade for any reason, the report's first line MUST be a banner: `⚠️ DEGRADED: single-context (<reason>)`."
    - "- **Design specificity**: Is the composition, interaction, and visual language grounded in this product, or could an unrelated product use it unchanged? Make this judgment before seeing detector output."
    - "Be honest with scores. A 4 means genuinely excellent. Most real interfaces score 20-32 out of 40."
- **Limits / false positives:** No data is published showing that the separation improves outcomes. It is a design choice.

### FD02-F21 — The finish reviewer: fresh context, no browser, four disposition words, and mandatory TYPE/MATERIAL/GROUND rows
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** A shipped subagent reviews the finished build from files and screenshots only. new-work.md tells the parent to spawn it without the builder's transcript. It first checks that the captures are valid, then answers with exactly one of `recapture`, `rebuild`, `fix` or `ship`. Every fidelity matrix must include TYPE, MATERIAL and GROUND rows, and the reviewer must not run a second detector pass. new-work.md caps an unattended run at two fix rounds; in an attended session the user decides whether to fund more.
- **Implication for /frontend:** This is a ready template for /frontend's last gate before /harden: a fresh reviewer, a closed vocabulary, capture validation first, and two fix rounds for an unattended run such as /execution's. Its "imitation material" heuristic (CSS bevels or embossing standing in for real material) adds a tell the owner has not listed. (corrected: the no-transcript rule and the two-round budget come from new-work.md lines 146 and 148, which were not cited, and the two-round cap applies only to unattended runs)
- **Evidence:**
  - [skill/agents/impeccable-finish-reviewer.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/agents/impeccable-finish-reviewer.md) — accessed 2026-09-30 — subagent definition (primary).
    - "You are the finishing reviewer for an Impeccable build: fresh eyes on a done artifact, outside the build thread's attention gravity."
    - "The first line of your return is `disposition: recapture`, `disposition: rebuild`, `disposition: fix`, or `disposition: ship`. These four words are the whole vocabulary; never invent another."
    - "imitation material is the single most reliable mark of machine-made design."
    - "the last two live sessions shipped five kickers past a reviewer that never looked."
    - "Do not run a second detector pass; mechanical findings belong to the parent's hooks."
    - "Three rows are mandatory in every matrix. TYPE: … MATERIAL: …" (check 2, "Fidelity"), and "You have no browser. Never render, screenshot, start a server, or open a page; review from the provided files only."
  - added at verification: [skill/reference/new-work.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/new-work.md) — accessed 2026-09-30 — skill reference (primary).
    - line 146: "This review never runs inside the build thread and never inherits it: spawn the reviewer fresh, with no forked conversation history (`fork_turns: 0` in codex); a reviewer that inherits your transcript inherits your framing, your optimism, and your abstractions, and everything it needs travels in the inputs above."
    - line 148: "Two rounds is the budget an unattended run ends at; an attended session's ceiling belongs to the user, so when the second verdict still lists open items, put the table in front of them and let them choose between shipping as it stands and funding another round."
- **Limits / false positives:** The "five kickers" line is an anecdote inside a prompt, with no study behind it.

### FD02-F22 — Hooks: immediate-tier checks after each Edit/Write, a full pass at Stop, and they run outside tool approval
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The Claude Code plugin registers three command hooks on the launcher:
  - `SessionStart`, 5 s timeout.
  - `PostToolUse`, matcher `Edit|Write`, 5 s timeout: runs only the 13 immediate-tier rules after each UI edit.
  - `Stop`, 30 s timeout: runs the full rule set over the files touched in the session.

  `hook.perEditRules: "all"` restores the full set on every edit. These hooks run whatever the model's tool permissions are, so the first edit can download the engine.
- **Implication for /frontend:** Installing Impeccable into a hackathon repo changes every /execution agent's edit loop, with reminders after each UI edit and a deep pass at Stop. /frontend should decide explicitly between hooks off and an explicit `detect` at its own gates. `--settings '{"disableAllHooks": true}'` disables all Claude Code hooks for a run.
- **Evidence:**
  - [plugin/hooks/hooks.json @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/plugin/hooks/hooks.json) — accessed 2026-09-30 — plugin manifest (primary).
    - `"PostToolUse": [ { "matcher": "Edit|Write", … "timeout": 5, "statusMessage": "Checking UI changes" } ]`, `"Stop": [ … "timeout": 30, "statusMessage": "Design deep pass" ]`
  - [skill/reference/hooks.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/hooks.md) — accessed 2026-09-30 — skill reference (primary).
    - "The per-edit hook surfaces only the immediate tier: mechanical, unambiguous problems worth interrupting an edit for, such as broken images, overflowing or clipped content, contrast and legibility failures, gradient text, glow shadows, and design-system drift."
  - [README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/README.md) — accessed 2026-09-30 — repository file (primary).
    - line 410: "In Claude Code, installed command hooks run independently of model-tool approval. The first edit or Stop event can therefore download and cache the engine even if the session denies the model's launcher command."
  - [Automatic design checks, impeccable.style/docs/hooks](https://impeccable.style/docs/hooks) — accessed 2026-09-30 — vendor documentation.
    - "Set hook.perEditRules to "all" for the full rule set after each edit."
- **Limits / false positives:** I did not install or run the hooks. Closed issue #400 records an earlier Stop-hook loop ("can re-block a turn ~20x until Claude Code's safety cap force-ends it"), fixed since.

### FD02-F23 — Installing for Claude Code: plugin marketplace, `npx impeccable install`, or a file copy; about 2.2 MB of skill plus a 17 MB signed engine
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** There are three routes:
  - **Plugin:** `/plugin marketplace add pbakaus/impeccable`, then install from `/plugin`.
  - **Installer:** `npx impeccable install` (with `--providers=claude --scope=project|global`), which needs Node 22.18 or later.
  - **Copy:** the README's "Copy from Repository" option says to copy `dist/claude-code/.claude` into the project or into `~/.claude`. But `dist/` is gitignored and absent from the repository tree at 909726c, so that path exists only after a local build. The committed Claude build sits at `.claude/skills/impeccable/`, and the website offers per-tool ZIP downloads ("Option 4"). (corrected: the `dist/claude-code` path does not exist in the repository)

  The Claude skill folder holds 54 files and 2,152,983 bytes. The launcher runs, or downloads into `~/.impeccable/bin/<version>/`, an engine that is 17,031,568 bytes on Windows, verified against a `.sha256` sidecar. The 0.1.8 Windows engine carries a valid Authenticode signature from "Renaissance Geek, Inc.". Engines 0.1.0 and 0.1.1 were unsigned. In early September 2026, Microsoft Defender and ESET flagged the 0.1.0 Windows binary as a trojan, and both issues were closed after later versions shipped.
- **Implication for /frontend:** On the owner's Windows 11 machine the lightest integration is the engine alone: download and verify it once, then point `IMPECCABLE_BIN` at it. Nothing touches `.claude/` and no hooks are added. The antivirus history is worth one line in /frontend's setup notes.
- **Evidence:**
  - [README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/README.md) — accessed 2026-09-30 — repository file (primary).
    - line 155: "/plugin marketplace add pbakaus/impeccable"; line 99: "The skill needs no runtime of its own. Every skill copy ships a small launcher (`scripts/impeccable`, plus `impeccable.cmd` for Windows) that runs the Impeccable engine, a self-contained binary that either sits next to the launcher or is downloaded once on first run into `~/.impeccable/bin/`."
  - [.claude-plugin/marketplace.json @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/.claude-plugin/marketplace.json) — accessed 2026-09-30 — plugin marketplace (primary).
    - `"source": "./plugin"`, `"version": "4.4.0"`
  - [Release engine-v0.1.8 assets](https://github.com/pbakaus/impeccable/releases/tag/engine-v0.1.8) — accessed 2026-09-30 — release record (primary).
    - `17031568	impeccable-windows-x64.exe`
  - OBSERVED, 2026-09-30: PowerShell `Get-AuthenticodeSignature` on the downloaded engine → `Status=Valid`, `Signer=CN="Renaissance Geek, Inc.", O="Renaissance Geek, Inc.", L=San Francisco, S=California, C=US`. Tree API sum for `.claude/skills/impeccable/` → `2152983` bytes over `54` files.
  - [docs/WINDOWS-SIGNING.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/docs/WINDOWS-SIGNING.md) — accessed 2026-09-30 — developer documentation (primary).
    - "Engine releases sign `impeccable.exe` with Azure Artifact Signing before computing release checksums. The publisher is **Renaissance Geek, Inc.**"
  - [Issue #740](https://github.com/pbakaus/impeccable/issues/740) and [Issue #758](https://github.com/pbakaus/impeccable/issues/758) — closed 2026-09-06 and 2026-09-08, accessed 2026-09-30 — user reports and maintainer replies (primary).
    - #740, maintainer: "Neither 0.1.0 nor 0.1.1 has an embedded Windows code-signing signature."
    - #758: "The Impeccable engine binary for Windows is detected as malware by Microsoft Defender, which makes every Impeccable command unusable on Windows." … "works on 4.0.4!"
  - added at verification: the recursive tree of 909726c (`gh api repos/pbakaus/impeccable/git/trees/909726c…?recursive=1`, 3,292 blobs, not truncated) holds no path under `dist/`, and `.gitignore` line 9 reads `dist/`. README line 187: `cp -r dist/claude-code/.claude your-project/`. In #740, the maintainer's update of 2026-09-05 says engine 0.1.2 "is now signed and timestamped as **Renaissance Geek, Inc.**", so signing began at 0.1.2. A 2026-09-06 comment reports that VirusTotal still showed 8/69 detections for the unsigned 0.1.0 hash.
  - Verification, 2026-09-30: a fresh download of `engine-v0.1.8/impeccable-windows-x64.exe` was 17,031,568 bytes with sha256 `5f39934b…ddcd`, equal to the sidecar. `Get-AuthenticodeSignature` returned `Valid` with signer `CN="Renaissance Geek, Inc."` and issuer `Microsoft ID Verified CS EOC CA 04`.
- **Limits / false positives:** I did not run the installer or the plugin install. How Claude Code runs the plugin's POSIX `[ ! -f … ] || …` hook commands on Windows was not verified.

### FD02-F24 — Network calls: a version check, the direction "roll" API, optional choice telemetry and OpenAI image generation; detection itself stays local
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The privacy page lists these requests, each with an opt-out where one exists:
  - A version check to `impeccable.style/api/version` that "normally runs at most once a day, using a local cache", disabled by `IMPECCABLE_NO_UPDATE_CHECK=1`.
  - Direction draws from `impeccable.style/api/roll`.
  - Catalog preview images, requested separately from Impeccable's servers when previews are displayed.
  - An optional "choice report", disabled by `IMPECCABLE_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`. These switches stop neither the roll request nor the preview-image requests.
  - OpenAI image calls when `OPENAI_API_KEY` is set.

  (corrected: "daily" overstated "at most once a day"; the preview-image requests were missing)

  Project checks "run locally". The launcher needs network only to fetch a missing engine.
- **Implication for /frontend:** For offline or confidential work, set `IMPECCABLE_NO_UPDATE_CHECK=1` and `IMPECCABLE_NO_TELEMETRY=1`, pre-place the engine through `IMPECCABLE_BIN`, and avoid new-work's roll. `detect` on local files needs no network. A URL scan loads the target page's own remote assets.
- **Evidence:**
  - [Privacy Policy, impeccable.style/privacy](https://impeccable.style/privacy) — Impeccable, "Last updated: September 25, 2026", accessed 2026-09-30 — vendor policy.
    - "Its project checks run locally and return findings to that agent. They do not upload your project files or detection results to Impeccable’s servers."
    - "Impeccable can check for a newer skill version at impeccable.style/api/version. The check sends no project content and normally runs at most once a day, using a local cache. Set IMPECCABLE_NO_UPDATE_CHECK=1 to turn it off."
    - "Set IMPECCABLE_NO_TELEMETRY=1 or DO_NOT_TRACK=1 to disable this choice report. These settings do not disable requests for catalog options or preview images."
    - added at verification: "A configured local catalog can supply the options without this API request. Displaying catalog previews can separately request their images from Impeccable’s servers."
  - [skill/scripts/impeccable @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/scripts/impeccable) — accessed 2026-09-30 — launcher script (primary).
    - "# Last resort: fetch this version's binary for the current platform from the public release channel into the user cache. Needs network; sandboxes without egress preinstall the binary on PATH instead."
  - [crates/context/src/concept_seed.rs @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/crates/context/src/concept_seed.rs) — accessed 2026-09-30 — source code (primary).
    - lines 96-97: `fn telemetry_disabled(env: &Env) -> bool { env.get("IMPECCABLE_NO_TELEMETRY")… || env.get("DO_NOT_TRACK")…`
- **Limits / false positives:** I did not capture network traffic. The claims come from the policy and the code paths I read.

### FD02-F25 — License: Apache-2.0 allows copying and adapting rule text under four conditions, and grants no trademark rights
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The repository is Apache-2.0 ("Copyright 2025 Paul Bakaus"). It was MIT at first and was relicensed in commit 8186f2a on 2026-01-07. Section 4 allows redistributing modified copies under four conditions:
  - (a) give recipients a copy of the license;
  - (b) mark modified files with "prominent notices stating that You changed the files";
  - (c) keep the copyright and attribution notices;
  - (d) carry the NOTICE contents.

  NOTICE.md credits ehmo's MIT-licensed `platform-design-skills` for `ios.md` and `android.md`. Section 6 grants no right to use the licensor's names or marks beyond describing where the work came from.
- **Implication for /frontend:** /frontend may vendor rule descriptions or craft-floor lines if it ships the Apache-2.0 text, marks every adapted file, keeps "Copyright 2025 Paul Bakaus", and does not pull in the iOS/Android references without ehmo's MIT notice. It should credit the material as "adapted from Impeccable" and not brand itself with the name. Today's NOTICE is not the whole attribution history. From 2026-01-07 to 2026-06-09 the NOTICE also credited Anthropic's Apache-2.0 frontend-design skill ("Copyright: 2025 Anthropic, PBC"). Any vendored text that still descends from that skill should therefore carry Anthropic's notice too (F32). (corrected: the Anthropic attribution history was added at verification)
- **Evidence:**
  - [LICENSE @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/LICENSE) — accessed 2026-09-30 — license text (primary).
    - "(b) You must cause any modified files to carry prominent notices stating that You changed the files; and"
    - "6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file."
    - "Copyright 2025 Paul Bakaus"
  - [NOTICE.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/NOTICE.md) — accessed 2026-09-30 — notice file (primary).
    - "The `skill/reference/ios.md` and `skill/reference/android.md` platform reference files are distilled from ehmo's `platform-design-skills` (Apple Human Interface Guidelines and Material Design 3 rules), rewritten in Impeccable's voice."
  - [Commit 8186f2a](https://github.com/pbakaus/impeccable/commit/8186f2a2269c0fd9bfa581c97a8f31ea0eedc176) — 2026-01-07, accessed 2026-09-30 — commit record (primary).
    - "Update README and license to Apache 2.0"
  - [LICENSE @661293796c](https://github.com/pbakaus/impeccable/blob/661293796c358e89d28aed938fd4663e684ff4d9/LICENSE) — pbakaus/impeccable, 2025-11-16, accessed 2026-09-30 — the original license (primary).
    - "MIT License" / "Copyright (c) 2025 Paul Bakaus"
- **Limits / false positives:** This is a reading of the license text, not legal advice. Whether short rule paraphrases are copyrightable at all is not addressed.

### FD02-F26 — Relation to Anthropic's frontend-design: Impeccable began as a verbatim copy and has since diverged
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The README says Impeccable "started from" Anthropic's frontend-design skill. The first content commit (2025-11-16) contains `source/skills/frontend-design.md`, 4,276 characters. It matches Anthropic's `skills/frontend-design/SKILL.md` at anthropics/skills commit ef740771ac (4,275 characters) with a difflib similarity ratio that rounds to 1.000. The files are not byte-identical: a unified diff shows exactly one difference, a blank line Impeccable added at the end (`@@ -42,0 +43 @@`). Anthropic's version at its original path `frontend-design/SKILL.md` (commit e5c6015, 2025-11-12, four days before Impeccable's first content commit) is byte-identical to the ef740771ac file, so the comparison holds for the version that existed when Impeccable copied it. Impeccable's build scripts now list `frontend-design` as a "deprecated shim". Anthropic's own skill was updated on 2026-09-03 and now carries a "calibration" list of AI-generated looks that overlaps Impeccable's: cream plus serif plus terracotta, near-black plus one bright accent, broadsheet layouts, the SaaS card kit and eyebrow labels. Both skills are Apache-2.0. (corrected: the title and summary said "byte-identical"; the pre-move Anthropic file was checked at verification)
- **Implication for /frontend:** The two skills share one origin, so they should not be counted as two independent sources for the same tell. Anthropic's current text adds items the owner can use: fade-and-slide-up entrances on each section (tell 12); hover transitions on every card, which is near tell 14 (buttons fading on hover) but not the same thing; labels built as "'WORD — fragment' with a spaced em dash" (tell 16); tinted near-black standing in for black; and a '→' appended to link and button text. (corrected: the tell-14 mapping was stated as exact; the em-dash and near-black items were added at verification)
- **Evidence:**
  - [README.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/README.md) — accessed 2026-09-30 — repository file (primary).
    - line 9: "Anthropic's [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) was the first widely-used design skill for Claude. Impeccable started from there."
  - [source/skills/frontend-design.md @661293796c](https://github.com/pbakaus/impeccable/blob/661293796c358e89d28aed938fd4663e684ff4d9/source/skills/frontend-design.md) — pbakaus/impeccable, 2025-11-16, accessed 2026-09-30 — early repository file (primary).
    - "This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics."
  - [skills/frontend-design/SKILL.md @ef740771ac](https://github.com/anthropics/skills/blob/ef740771ac901e03fbca3ce4e1c453a96010f30a/skills/frontend-design/SKILL.md) — Anthropic, 2025-12-01, accessed 2026-09-30 — skill file (primary). Python `difflib.SequenceMatcher` against the early Impeccable file → `similarity ratio 1.0 len a 4275 len b 4276`.
    - Verification recomputation: ratio 0.99988, `a == b` is False, and `difflib.unified_diff` gives the single hunk `@@ -42,0 +43 @@` adding an empty line. `cmp` shows [frontend-design/SKILL.md @e5c6015](https://github.com/anthropics/skills/blob/e5c60158df67e67d7609065ba3ad5605a6794e93/frontend-design/SKILL.md) ("Add 'frontend-design' example skill (#98)", 2025-11-12) identical to the ef740771ac file. The folder's LICENSE.txt is the Apache License 2.0 at e5c6015, ef740771ac and 41bbe19d.
  - [skills/frontend-design/SKILL.md (main)](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) — Anthropic, last change 41bbe19d on 2026-09-03 ("Update frontend-design skill to avoid generic design defaults (#1713)"), accessed 2026-09-30 — skill file (primary).
    - "fade-and-slide-up entrances on each section and hover transitions on every card are the generic default and read as AI-generated."
    - "1. a warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta or warm-clay accent (often near #D97757 — Anthropic's own Claude-interaction accent, so on a user's brief it reads as a tell);"
    - added at verification, item 5 of the same list: "template chrome that appears whatever the subject: a tracked-out ALL-CAPS eyebrow label above every heading; meta strings joined with middle dots ('A · B · C'); labels built as 'WORD — fragment' with a spaced em dash; tinted near-black (#0B0B0B, #111) standing in for black; a monospace face for small data labels; a '→' appended to link and button text."
  - [scripts/lib/utils.js @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/scripts/lib/utils.js) — accessed 2026-09-30 — build script (primary).
    - line 602: `'frontend-design',          // deprecated shim`
- **Limits / false positives:** Anthropic's skill lived at a different path before 2025-12-01, and I compared against the first path-stable version; the verification found the older-path file identical to it. Which of the two skills first wrote the shared calibration idea was not established.

### FD02-F27 — The version state is ambiguous: HEAD and the website say 4.4.0, GitHub tags stop at 4.3.1, and the engine prints 4.0.0
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - The Claude SKILL.md and the plugin manifests at HEAD declare 4.4.0, and the website changelog lists "Skill v4.4.0 September 25, 2026".
  - No `skill-v4.4.0` tag exists; the latest skill tag is 4.3.1. `docs/RELEASE-4.4.0.md` calls it "a candidate, not a published release".
  - The published npm CLI 4.1.0 declares optional engine packages at 0.1.5, while HEAD's package.json pins 0.1.8.
  - Engine 0.1.8 prints `4.0.0` for `--version`.
- **Implication for /frontend:** Record the commit SHA and the engine version with its sha256 in /frontend's receipts. The marketplace manifest at HEAD says 4.4.0, so a plugin install may deliver untagged text. Which build `npx impeccable install` delivers was not tested.
- **Evidence:**
  - [docs/RELEASE-4.4.0.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/docs/RELEASE-4.4.0.md) — accessed 2026-09-30 — release document (primary).
    - "This branch is a candidate, not a published release."
  - [GitHub tags API](https://api.github.com/repos/pbakaus/impeccable/tags) — accessed 2026-09-30 — tag list (primary). `gh api repos/pbakaus/impeccable/tags?per_page=100 | grep skill-v4.(3|4)` → `skill-v4.3.1`, `skill-v4.3.0`
  - [Changelog, impeccable.style/changelog](https://impeccable.style/changelog) — accessed 2026-09-30 — vendor release notes. "Skillv4.4.0September 25, 2026" (text as extracted from the page)
  - [npm registry: impeccable](https://registry.npmjs.org/impeccable) — accessed 2026-09-30 — package metadata (primary). Version 4.1.0 `optionalDependencies` → `'@impeccable/cli-windows-x64': '0.1.5'`
  - OBSERVED: `impeccable.exe --version` (engine 0.1.8) → `4.0.0`
- **Limits / false positives:** The website may publish notes before tagging on purpose. The 4.4.0 release document (docs/RELEASE-4.4.0.md, line 11) says to "Copy the final approved release notes into the private site's changelog at release time." The same line still names engine 0.1.6, and docs/REVIEW-4.4.0-READINESS.md lists "Publish engine 0.1.6" as step 2 of its release order. The skill's `scripts/VERSION` at HEAD pins engine 0.1.8. (corrected: the sentence was attributed to "the 4.4.0 review document" but is in RELEASE-4.4.0.md; the engine-pin drift was added at verification)

### FD02-F28 — Design-system rules read DESIGN.md in Google's design.md format; brand colors listed there no longer trigger the purple "AI palette" finding
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Four advisory-or-warning rules compare code against DESIGN.md: design-system font, color, radius and font size. DESIGN.md follows Google Labs' design.md spec: YAML front matter with tokens plus up to eight sections, and a `.impeccable/design.json` sidecar. Since 4.4.0 (website changelog), palette colors documented there are exempt from `ai-color-palette`. The set has no spacing rule, so the owner's tell 15 is not covered as drift either.
- **Implication for /frontend:** If a sponsor's brand palette is purple or violet, /frontend must record it in DESIGN.md or as an `ignore-value`, or the detector will call the brand slop, as it did for Stripe in F08. A Claude Design "Design System" (tokens.json) is a different format and would need exporting to DESIGN.md before these rules can use it. Spacing-scale drift needs /frontend's own check.
- **Evidence:**
  - [skill/reference/document.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/document.md) — accessed 2026-09-30 — skill reference (primary).
    - "DESIGN.md follows the [official DESIGN.md format spec](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md): optional YAML frontmatter carrying machine-readable design tokens, followed by up to eight markdown sections in a fixed order."
  - [Run a detector scan, impeccable.style/docs/detector](https://impeccable.style/docs/detector) — accessed 2026-09-30 — vendor documentation.
    - "When a local DESIGN.md exists, the detector uses it to check documented fonts, colors, corner radii, and type sizes."
  - [google-labs-code/design.md](https://github.com/google-labs-code/design.md) — Google Labs, pushed 2026-09-14, accessed 2026-09-30 — spec repository (primary). `gh api` → `"license":"Apache-2.0"`, `"stargazers_count":28187`
  - [Changelog, impeccable.style/changelog](https://impeccable.style/changelog) — accessed 2026-09-30 — vendor notes. "Colors defined in your DESIGN.md are no longer flagged as a generic AI palette"
- **Limits / false positives:** I did not test the DESIGN.md exemption.

### FD02-F29 — On borrowing from other sites: take "the form's skeleton, not its clothes", never lift content verbatim, and use the "canon" exit for "products this should sit alongside"
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** Impeccable's closest guidance to the owner's plan (drawing on the sponsor's customers' websites) comes in four pieces. None of the four is about third-party websites, so each is given with its context:
  - The QUALITY BAR board and hero images of the catalog world the build uses "set the craft level the build must reach, … never the composition" (new-work.md line 57). The same paragraph says a surviving catalog world's "palette and material, type and composition, topology, controls and state" do carry into the product.
  - In visualize.md the reference is a screenshot of the product's own existing page, used for image-generation comps. The rule there is "chrome, palette, type, and component character carry over; the reference page's own content does not, and a banner, hero, or card lifted verbatim is the reference leaking, not fidelity."
  - The standing "canon" exit asks the user for "two or three products this should sit alongside", makes "their craft level the bar", and executes that convention at full fidelity.
  - The research page's surviving instruction was "borrow the form’s skeleton, not its clothes". It is about a direction's own form (teletext, a film reel) that was being applied only as styling. The next sentence reads "The reference should shape how the page is arranged." This pulls toward structural borrowing, against line 57's "never the composition".

  (corrected: the finding presented the four quotes as consistent guidance on external reference sites. Their contexts differ, and the research page's following sentence contradicts "never the composition")
- **Implication for /frontend:** Impeccable gives no rule written for copying a third party's site, and its own texts disagree on whether a reference may shape the layout. Two points hold across all four: never lift a reference's content (banners, hero copy, cards) verbatim, and use chosen products as the craft bar. How much of a sponsor-customer site's structure /frontend may take has to come from /frontend's own policy (research/policy-copying-and-ip.md). It cannot be derived from Impeccable.
- **Evidence:**
  - [skill/reference/new-work.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/new-work.md) — accessed 2026-09-30 — skill reference (primary).
    - line 51: "When the user takes it (the canon action, a safer-steer, or plain words asking for the familiar or competitor-like path), convention becomes the commitment: ask once for two or three products this should sit alongside, make their craft level the bar, and execute the canon at full fidelity, without irony or smuggled quirk."
    - line 57: "They set the craft level the build must reach, a rendered reference's finish, commitment, and art direction, never the composition; your surface serves this product."
  - [skill/reference/visualize.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/skill/reference/visualize.md) — accessed 2026-09-30 — skill reference (primary).
    - "the reference page's own content does not, and a banner, hero, or card lifted verbatim is the reference leaking, not fidelity."
  - [The Model Can't Roll Its Own Dice, impeccable.style/research](https://impeccable.style/research) — accessed 2026-09-30 — vendor research article.
    - "The instruction that survived was “borrow the form’s skeleton, not its clothes.”"
    - added at verification, the following sentences: "The reference should shape how the page is arranged. We kept structure checks for the finish, using a wireframe grader and a fresh reviewer instead of interrupting the builder to grade itself." The preceding paragraph describes a teletext-styled page whose components "carry the theme, but the page still uses a conventional marketing grid".
  - added at verification, context of line 57: "Catalog worlds are working systems, not mood references. When one survives, carry its palette and material, type and composition, topology, controls and state, and responsive rules into the product." Context of the visualize.md quote: "On an established world, anchor every comp on the real identity: capture a screenshot of a representative existing page and pass it as a reference image".
- **Limits / false positives:** These are assertions without a measurement tied to copying behavior.

### FD02-F30 — Public praise for Impeccable is anecdotal and curated by the vendor
- **Grade:** D · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** The homepage carries dozens of single-post endorsements, for example "Impeccable > Claude design", "Shipped a landing page in 2 hours" and "My landing page looked 100% vibe coded. I think it looks very decent now." None comes with a comparison method.
- **Implication for /frontend:** These posts carry no weight in the Impeccable-versus-Claude-Design decision. /frontend needs its own side-by-side test on one hackathon brief.
- **Evidence:**
  - [Impeccable homepage](https://impeccable.style/) — accessed 2026-09-30 — vendor marketing page quoting social posts.
    - "Impeccable > Claude design" (Mertcan Yüzer, @MertcanDYuzer)
    - "Shipped a landing page in 2 hours using @conductor_build & @impeccable_ai. From idea to prod faster than most people pick a font ;))" (Mikita, @MikitaHQ)
    - "This is 🔥. My landing page looked 100% vibe coded. I think it looks very decent now. I had fun in the process." (Sidney Hori Hawthorne, @sid_hori)
- **Limits / false positives:** I quote these from the vendor's page and did not open the individual X posts.

### FD02-F31 — Vendor bias mining (skill v3.5.0, May 2026): with the skill off, generated pages hit contrast failures 90%+ of the time, and the skill's own lines were causing some defaults (added at verification)
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED (added at verification)
- **Claim:** The changelog entry "Skillv3.5.0 May 28, 2026" ("Better design, measured in the work.") reports three rates, "Measured across ~190 samples, skill off":
  - 74% of GPT-5.5 pages used the cream or beige AI-default background.
  - 76% reached for extreme negative letter-spacing on tech briefs.
  - 90%+ shipped body text below the WCAG contrast floor.

  The same entry says bias mining "found the skill's own lines were causing defects, and cut them". It names "Category-to-aesthetic recipes that drove extreme letter-spacing and italic-serif heroes". Each rate was "traced to a line in the skill, then fixed". The entry publishes no method beyond the sample size. The first rate is stated for GPT-5.5 only; the other two do not name a model.
- **Implication for /frontend:**
  - This is the only vendor-published base rate found for any of the owner's tells. Tell 7 (low-contrast text) was the most frequent defect measured, so a contrast check deserves blocking status once calibrated. Contrast is also the one tell harden's axe-core floor already measures.
  - The second point bears on /frontend's own text: guidance lines can plant the defaults they mean to prevent, as category-to-aesthetic recipes did here. /frontend's rule text should be tested against generated output before it ships, the way /prose tuned its tier-1 rules until they stayed silent on the control corpus.
- **Evidence:**
  - [Changelog, impeccable.style/changelog](https://impeccable.style/changelog) — Paul Bakaus, entry "Skill v3.5.0, May 28, 2026", accessed 2026-09-30 — vendor release notes (fetched raw with curl and converted to text).
    - "74%of GPT-5.5 pages used the cream / beige AI-default background" / "76%reached for extreme negative letter-spacing on tech briefs" / "90%+shipped body text below the WCAG contrast floor" (the page renders the figure and the label as adjacent elements)
    - "Measured across ~190 samples, skill off. Each rate traced to a line in the skill, then fixed."
    - "Far less AI-default slop. Bias mining against ~190 samples found the skill's own lines were causing defects, and cut them. The cream / beige background tell (74% on GPT) is banned across the warm-neutral band. Category-to-aesthetic recipes that drove extreme letter-spacing and italic-serif heroes are gone: the shape depends on the brand, not its category."
- **Limits / false positives:** These are vendor data from an unpublished harness, in a release note written to promote the release. The sample (~190) is not broken down by brief or model beyond "GPT-5.5" for the first rate. "WCAG contrast floor" is not defined further. The rates describe GPT-5.5-era output in May 2026 and are not Claude measurements.

### FD02-F32 — Impeccable's NOTICE credited Anthropic's frontend-design until a 2026-06-09 commit deleted it; today's NOTICE credits only ehmo (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:** Commit 8186f2a of 2026-01-07 ("Update README and license to Apache 2.0") created NOTICE.md with a section "Anthropic frontend-design Skill". It stated that the skill "builds on Anthropic's original frontend-design skill", "Original license: Apache License 2.0", "Copyright: 2025 Anthropic, PBC". By 2026-06-09 the NOTICE read "Copyright 2025-2026 Paul Bakaus". It still credited Anthropic, and it also credited ehmo's typecraft-guide-skill for tactical additions to `typography.md`. Commit 324cec7 of 2026-06-09 ("Reorganize contributor docs") deleted NOTICE.md. The same commit removed the README's License-section line "The impeccable skill builds on [Anthropic's original frontend-design skill](…). See [NOTICE.md](NOTICE.md) for attribution." Commit 3e38e59 of 2026-07-09 re-created NOTICE.md with only the ehmo platform-design-skills notice quoted in F25. A GitHub code search of HEAD for "Anthropic, PBC" returns 0 files. The README still says Impeccable "started from" frontend-design. The build scripts still list a `frontend-design` "deprecated shim".
- **Implication for /frontend:** Apache-2.0 §4(c) asks redistributors to retain attribution notices from the source form, and §4(d) to carry the NOTICE. When /frontend vendors Impeccable text, it should carry Paul Bakaus's copyright and the Apache text. For any passage that can be traced to Anthropic's frontend-design, it should also carry Anthropic's notice ("Copyright 2025 Anthropic, PBC", Apache-2.0), whatever today's NOTICE omits. How much of Impeccable's current text still descends from Anthropic's skill was not measured.
- **Evidence:**
  - [Commit 8186f2a](https://github.com/pbakaus/impeccable/commit/8186f2a2269c0fd9bfa581c97a8f31ea0eedc176) — pbakaus/impeccable, 2026-01-07T17:50:53Z, accessed 2026-09-30 — commit diff (primary). NOTICE.md added: "## Anthropic frontend-design Skill" / "The `frontend-design` skill in this project builds on Anthropic's original frontend-design skill." / "**Original license:** Apache License 2.0" / "**Copyright:** 2025 Anthropic, PBC".
  - [Commit 324cec7](https://github.com/pbakaus/impeccable/commit/324cec73a43fdc4794121844bf32d0d82ea68447) — pbakaus/impeccable, 2026-06-09T22:18:53Z, "Reorganize contributor docs", accessed 2026-09-30 — commit diff (primary). NOTICE.md deleted (`@@ -1,25 +0,0 @@`), including "Copyright 2025-2026 Paul Bakaus", "The `impeccable` skill in this project builds on Anthropic's original frontend-design skill." and "## Typecraft Guide Skill".
  - [Commit 3e38e59](https://github.com/pbakaus/impeccable/commit/3e38e595c7082d5519ba7326d8f232dc3343f10b) — pbakaus/impeccable, 2026-07-09T00:11:31Z, "Add platform axis (web / ios / android / adaptive) (#269)", accessed 2026-09-30 — commit diff (primary). NOTICE.md re-created (`@@ -0,0 +1,11 @@`) as "# Third-Party Notices" with only the ehmo platform-design-skills section.
  - `gh api "repos/pbakaus/impeccable/commits?path=NOTICE.md"` lists 19 commits touching NOTICE.md between 2026-01-07 and 2026-07-09.
- **Limits / false positives:** This is a reading of commit history and the license text, not legal advice. The deletion may have been an oversight during a docs reorganization; no commit message states intent.

### FD02-F33 — A deleted vendor ablation study: some rules moved output by 20+ points, and literal bad examples in rule prose primed models to copy them (added at verification)
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED (added at verification)
- **Claim:** Commit d37be05 (2026-06-09T22:14:08Z, "skill: drop 4 redundant typography rules + add EMPIRICAL_VALIDATION") added `EMPIRICAL_VALIDATION.md`. Commit 324cec7 deleted it about five minutes later (22:18:53Z), so it is not at HEAD. The document reports:
  - **Method:** a private harness ablated each skill rule across Claude Haiku 4.5, Gemini 3.5 Flash and GPT-5.4 mini, on four brand niches, with n=10 per cell and 544 cells in total. A rule "validates" when removing it shifts a deterministic detector by at least 20 percentage points in the predicted direction. The sweep ran on skill v3.5.0 plus five prose fixes.
  - **Cross-provider winners:** seven rules validated on at least two providers, among them `skill-color-anti-cream` and `brand-typo-reflex-reject-fonts`. With the font rule removed, "Gemini ablate samples switched fully to Inter". About 20 more rules validated on a single provider. Every rule not named is "intended but not yet measured".
  - **Priming:** "Literal bad examples in rule prose primed the model to reproduce them." OpenAI samples emitted phrases such as "fake theater" copied from an example in the skill. The rule the authors drew: "describe the failure shape, never enumerate examples of it."
  - **Detector limits:** `det_low_contrast` "saturates at 80% baseline", and detectors that grep for a rule's own example words "measure echo, not effect".

  HEAD's CLAUDE.md confirms that the eval framework lives in a private repository and "measures whether the `/impeccable` skill improves or harms AI-generated frontend design by running the same brief through a model with and without the skill loaded."
- **Implication for /frontend:**
  - This is the only vendor evidence found that rule text changes generated output. Only a minority of rules showed an effect; the rest are unmeasured.
  - The priming lesson bears directly on how /frontend states the owner's 20 tells to the building agent. Listing them literally ("Inter", "Space Grotesk + Instrument Serif", "purple-to-blue gradient", buzzword phrases) in the builder's prompt may plant them. That was observed for copy phrases and is untested for visual tells.
  - The safer split is literal lists in the deterministic checker, and failure-shape descriptions plus positive direction in the generation prompt. /frontend should check for priming with its own with-and-without runs before relying on either.
  - The low-contrast detector's "80% baseline" points the same way as the 90%+ rate in F31. Both are vendor measurements, taken on different samples.
- **Evidence:**
  - [EMPIRICAL_VALIDATION.md @5fbe37c](https://github.com/pbakaus/impeccable/blob/5fbe37c97c915ab338a2904022a6e882f0e4d596/EMPIRICAL_VALIDATION.md) — pbakaus/impeccable, the parent of commit 324cec7, 2026-06-09, accessed 2026-09-30 — vendor document (primary for the vendor's claims; the data sit in a private harness).
    - "Source: a private eval harness at `~/code/impeccable-evals/` ablates each rule across three providers (Claude Haiku 4.5, Gemini 3.5 Flash, GPT-5.4 mini) on four brand niches (luxury hotel, italian restaurant, observability dashboard, vintage moto forum) at n=10 samples each. A rule "validates" when removing it shifts a deterministic detector ≥ 20pp in the predicted direction. v2.1 sweep completed 2026-06-09 anchored to commit `54c3a502` (skill-v3.5.0 + the five prose fixes that landed alongside this doc). 544 cells total."
    - "| `brand-typo-reflex-reject-fonts` | google, openai | OpenAI +60pp; Gemini ablate samples switched fully to Inter |"
    - "- **Literal bad examples in rule prose primed the model to reproduce them.** Confirmed against OpenAI samples that emitted "fake theater", "vendor theater", and "heatmap theater" as verbatim copies of an example phrase in the skill. … **Going forward: describe the failure shape, never enumerate examples of it.**"
    - "`det_low_contrast` saturates at 80% baseline; render-dependent detectors under-fire on one-shot output."
    - "The v2.0 → v2.1 cycle cost ~$1,800 across two providers' worth of API plus operational waste."
  - `gh api "repos/pbakaus/impeccable/commits?path=EMPIRICAL_VALIDATION.md"` → `324cec73a4 2026-06-09T22:18:53Z Reorganize contributor docs`, `d37be057ea 2026-06-09T22:14:08Z skill: drop 4 redundant typography rules + add EMPIRICAL_VALIDATION`.
  - [CLAUDE.md @909726c](https://github.com/pbakaus/impeccable/blob/909726c7e8be484daba481873640f64aa24f62dc/CLAUDE.md) — accessed 2026-09-30 — repository file (primary), line 368, quoted above.
- **Limits / false positives:** These are vendor data from a private harness with n=10 per cell, and the dashboard and audit files it cites are not public. The models are small tiers (Haiku 4.5, Gemini 3.5 Flash, GPT-5.4 mini), not the models the owner builds with. The priming observation comes from OpenAI copy phrases. The document was removed within minutes of being added, for reasons no commit states. Current skill files still list literal examples (the craft floor's "Refuse" list, F14), so the vendor has not applied the lesson everywhere.

## Contradictions between sources

1. **`craft`.** The README describes it as "Full shape-then-build flow with visual iteration". The Claude SKILL.md at the same commit calls it "Deprecated alias for an ordinary new-work request" (F02).
2. **Tinted versus neutral gray.** The README's anti-pattern list says "Don't use pure black/gray (always tint)", and quieter.md says "Tinted grays: Use warm or cool tinted grays instead of pure gray". colorize.md says "Tint neutrals only when the brand hue genuinely creates cohesion. Neutral gray is valid when it serves the world."
3. **System fonts.** The README says "Don't use overused fonts (Arial, Inter, system defaults)". operate.md grants product UI "System fonts and familiar sans defaults", and the detector skips CSS generic families when it picks the primary face.
4. **Three font lists.** The detector code (17 names), the rule description (6) and the new-work reflex list (16, with Instrument Serif absent and "Inter-as-display" instead of Inter) disagree (F13).
5. **Engine description.** The CLI help says URLs get "Puppeteer full browser rendering". ENGINE.md says "There is no Node at runtime", and discovery.rs says the binary "downloads nothing" and drives an installed browser over its own CDP client.
6. **Static and URL engines disagree on the same page (observed).** Only the static scan reported `overused-font` and `marketing-buzzword`. Only the URL scan reported the pixel-contrast failures on the glass cards (F09, F10).
7. **Version.** The website changelog shows Skill v4.4.0 on 2026-09-25, while the repo calls 4.4.0 "a candidate, not a published release" and has no tag. The engine prints 4.0.0, and npm 4.1.0 pins engine packages 0.1.5 (F27).
8. **`init` and DESIGN.md.** command-metadata.json says init "offers DESIGN.md (visual: colors, typography, components) when code exists". init.md says "Never silently overwrite an existing file or offer DESIGN.md during init" and "Do not offer DESIGN.md merely because it is missing."
9. **Stale guideline pointers.** Of the registry's 41 distinct `skill_guideline` pointers, 39 appear in none of the current reference files, including "colored accent stripe", "same spacing everywhere", "no em dashes" and "marketing buzzwords". The two that do appear are "Nest cards inside cards" (distill.md) and "geometric masks standing in for organic contours" (craft-floor.md). This was a case-insensitive exact-string check over the 38 `skill/reference/*.md` files and `SKILL.src.md` at 909726c. (corrected: was "appear in none … returned nothing"; 2 of 41 do appear)
10. **Custom scrollbars.** The craft floor asks agents to theme "custom scrollbars" from the palette. operate.md bans "Reinventing standard affordances for flavor (custom scrollbars, weird form controls, non-standard modals)" on product UI. This is a tension rather than a strict contradiction, since theming is not reinventing.
11. **Against the owner's tells.**
    - The craft floor endorses icons "from a real library" (tell 10 targets Lucide everywhere).
    - overdrive.md lists "generative art that responds to the cursor" as a legitimate marketing "wow" (tell 13). The same sentence lists "a scroll-driven reveal" (tell 12): "Pages, hero sections, landing pages, portfolios: the "wow" is often sensory: a scroll-driven reveal, a shader background, a cinematic page transition, generative art that responds to the cursor." (scroll-reveal clause added at verification)
    - `monotonous-spacing` penalizes uniform spacing, the opposite of tell 15.
    - GOV.UK, an accessibility-led design system, uses thick top and side accents that `side-tab` flags (tell 5, F08).
12. **Research claim versus test log.** The research page reports that the final workflow "won 100% of decisive pairs". The skill-behavior README says a full Claude build "is not a final full-workflow pass". The two measure different things, design comparison versus protocol completion, and should not be merged into one quality claim.
13. **Stale release note (added at verification).** tests/skill-behavior/README.md still says "Release #782 remains on hold." PR #782, "Release: engine 0.1.4, CLI 4.0.5 and skill 4.2.3", was merged on 2026-09-08 (F18).
14. **Rule count in the CLI contract (added at verification).** docs/CLI-CONTRACT.md line 249 says "Registry (59 ids, in order)" and lists 59 ids, without `organic-clip-path` and `buried-raster`. registry.rs asserts 61, and the README and /slop say 61.
15. **Priming lesson versus current rule text (added at verification).** The deleted EMPIRICAL_VALIDATION.md concluded "describe the failure shape, never enumerate examples of it" (F33). The current craft floor, the registry descriptions and the new-work reflex-font list still name literal examples ("Gradient text.", "Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, and Space Grotesk", F13, F14).
16. **Where the skill's lineage is credited (added at verification).** README line 9 says Impeccable "started from" Anthropic's frontend-design. Since 2026-06-09 neither the NOTICE nor the README License section credits Anthropic (F32).

## What could not be found, and how it was searched

- **A precision/recall evaluation of the 61 rules against real human-designed and AI-generated sites.** I ran `gh search code` in pbakaus/impeccable for "false positive", "false positives", "corpus", "precision", "real-world sites" and "benchmark". I read tests/oracle/README.md, tests/skill-behavior/README.md and docs/REVIEW-4.4.0-READINESS.md, and the impeccable.style pages /research, /slop, /docs/detector, /docs/hooks, /faq, /changelog and /privacy. Not found. (note added at verification: the commit history holds a deleted EMPIRICAL_VALIDATION.md of 2026-06-09. It is a rule-ablation study of the skill text, not a measure of detector precision or recall, so this item still stands; see F33)
- **Detector rules for emoji in headings, glassmorphism, icon-library monoculture (Lucide), stock shadcn components, scroll-reveal entrances, hover opacity fades, inconsistent spacing, or grain textures.** I read all 61 registry rows and grepped the core, detect and foundation sources for backdrop, emoji, lucide, shadcn, grain, turbulence, mousemove, IntersectionObserver, opacity and hover. None exists as a rule. On /slop, "Glassmorphism everywhere" is labelled "Design review" only.
- **The identity of the "design director" and per-task sample sizes behind the research page's judgments.** Not stated on the page.
- **How Claude Code runs the plugin's POSIX hook commands (`[ ! -f … ] || …`) on Windows.** Not verified, because I did not install the plugin.
- **Whether `next/font`-generated family names evade the URL engine's overused-font check.** Not tested; my URL fixture loaded fonts from Google Fonts.
- **Which skill build `npx impeccable install` or the plugin marketplace delivers today (4.3.1 or 4.4.0).** Not tested, because I did not run installers.
- **Quantitative outcomes for the Neo Mirai case study.** /cases/neo-mirai is narrative, with no numbers found.

## Weak spots of this dossier

- I wrote the slop fixture knowing the rules. It is one page and one TSX folder, run once on engine 0.1.8, and it may not look like the owner's real past hackathon frontends. Those should be scanned next.
- The control sample is four live sites on one day, at one viewport (1280x800), with no manual adjudication of the quality findings. Rerunning will drift as the sites change.
- I read the core references in full: SKILL.md, craft-floor, new-work, critique, audit, polish, typeset, layout, animate, colorize, clarify, bolder, quieter, distill, delight, overdrive, shape, routing, operate, hooks, init, visualize, extract, doctor, component-review, region-map and the finish reviewer. I skimmed live.md, live-setup.md, generate.md, document.md, adapt.md, harden.md, onboard.md, optimize.md, ios.md, android.md, audit.native.md, adapt.native.md and three of the four agents. No finding rests on a skimmed file except the DESIGN.md format line (F28), which I read.
- The research page (F17) and the changelog figures are vendor self-reports. Issue #744 (F19) comes from one external contributor's harness.
- Rust thresholds are quoted from source, not exercised by their unit tests. Line numbers refer to commit 909726c, and the repository changes on most days (21 of the last 31). (corrected: was "changes daily")
- The evidence files for the observed runs (fixtures, outputs, control JSON) are saved under `C:/Users/Utilisateur/.claude/skills/frontend/research/evidence/tool-impeccable/`. A rerun needs the engine-v0.1.8 Windows binary (sha256 5f39934b…ddcd) and `IMPECCABLE_BROWSER` pointed at a Chromium.

## Verification notes

Verified 2026-09-30 by an adversarial fact-check pass. Result: 14 verified, 16 corrected, 0 downgraded, 0 dropped, 3 added (F31 to F33). F18 was corrected and also lowered from grade A to B, for consistency with F17; it is counted once, as corrected.

**Method.**
- **Repository files.** Every cited repository file was re-fetched at commit 909726c from raw.githubusercontent.com: README, LICENSE, NOTICE, both SKILL builds, the registry, cli.rs, findings.rs, constants.rs, detect_text.rs, regex_matchers.rs, driver.rs, page_checks.rs, discovery.rs, pin.rs, concept_seed.rs, generate_image.rs, rules.rs, html_patterns.rs, text_rules.rs, foundation page.rs, ENGINE.md, CLI-CONTRACT.md, the 4.4.0 release documents, tests/oracle/README.md, tests/skill-behavior/README.md, the should-pass fixture, hooks.json, marketplace.json, all six plugin manifests, the launcher, utils.js, antipatterns.json, CLAUDE.md, and the 38 `skill/reference` files plus the 4 `skill/agents` files. Every verbatim quote was checked by string match, and line numbers were checked with `sed -n`.
- **GitHub API.** Repository metadata, releases, tags, the recursive tree, the commit history of NOTICE.md and EMPIRICAL_VALIDATION.md, and issues or PRs #394, #400, #619, #740, #744 (with comments), #758, #782, #867, #881, #882 and #883 were read with `gh api`.
- **Other sources.** npm registry metadata came from registry.npmjs.org. The vendor pages (/, /privacy, /changelog, /research, /slop, /docs/detector, /docs/hooks, /faq, /cases/neo-mirai) were fetched raw with curl and converted to text locally, so quotes were matched against page text rather than a model summary. Anthropic's frontend-design was fetched at e5c6015, ef740771ac and 41bbe19d, and google-labs-code/design.md through `gh api`.
- **Counts.** The registry counts (61; 32/29; 47/12/2), the 29-item buzzword list, the 17-name font list, the 13-rule immediate tier and the 41 guideline pointers were recounted with Python.
- **Observed runs.** The saved outputs and control JSON were recounted. Then engine-v0.1.8 for Windows was downloaded into the session scratch folder and checked: 17,031,568 bytes, sha256 equal to the sidecar, Authenticode `Valid`, signer Renaissance Geek, Inc. The static, source and URL scans were re-run on copies of the fixtures, and the four control URLs were re-scanned, with `HOME`, `USERPROFILE`, `IMPECCABLE_HOME`, `TEMP` and `TMP` redirected and `IMPECCABLE_NO_TELEMETRY=1 DO_NOT_TRACK=1 IMPECCABLE_NO_UPDATE_CHECK=1` set. Nothing was cloned. The rerun outputs are saved in `research/evidence/tool-impeccable/verification-2026-09-30/`: the four `ctl-*.json` files, `static.json`, `static-1.txt`, `url.txt` and `source.txt`. The downloaded binary was deleted afterwards.

**Sources I could not open.**
- The contributor's external report https://github.com/ktlesr/skill-trigger-measurements/blob/master/reports/impeccable.4.2.2.md, linked from #744. I relied on the issue comment only.
- The vendor's private eval harness, dashboard and audit files cited in EMPIRICAL_VALIDATION.md, and the "Private eval harness" in RELEASE-4.4.0.md. They are not public.
- The individual X posts quoted on the homepage (F30).

**Residual doubts.**
- F09's split between full and partial detections is the researcher's judgment. The fixture does not record which cells were counted as partial, so the corrected count for cell 7 cannot be pinned down exactly.
- Live-site results drift. Stripe gave 96 findings on the rerun against 95 in the dossier, and 59 s against 22 s. The other three sites repeated exactly.
- The claim that, in Claude Code, image generation for the comp-led path means an `OPENAI_API_KEY` is an inference. It rests on the skill's rule (a harness-native image tool first, the OpenAI fallback second) and on this environment exposing no native image tool.
- The 4.4.0 status is still unresolved. The website changelog lists it as released on 2026-09-25, while the repository calls it a candidate and has no tag. RELEASE-4.4.0.md still names engine 0.1.6, although the skill's `scripts/VERSION` pins 0.1.8.
- The priming result in F33 was observed on OpenAI copy phrases with small models. Whether naming visual tells in a prompt plants them is untested.
- F32 is a reading of commit history, not a legal opinion, and how much current Impeccable text descends from Anthropic's skill was not measured.
- A few line locators are off by one or two lines and were left as they are: F11's "lines 933-935" (the matcher body is 934-935) and F13's "lines 85-103" (the array runs 85-105). Neither changes a claim.
- Star counts and open-issue states will drift.
