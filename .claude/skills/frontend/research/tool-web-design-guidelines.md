# Web Interface Guidelines and the web-design-guidelines skill

> Code FD04 · slug tool-web-design-guidelines · researched 2026-09-30 · verified 2026-09-30 · counts: verified 17 / corrected 7 / downgraded 0 / dropped 0 / added 2

## Summary

- "Web design guidelines" is Vercel's `web-design-guidelines` skill (vercel-labs/agent-skills, SKILL.md version "1.0.0", 684.7K installs on skills.sh). It audits code against Vercel's Web Interface Guidelines (WIG): github.com/vercel-labs/web-interface-guidelines, MIT, HEAD `e3d624b` of 2026-08-18, zero tags or releases, published at vercel.com/design/guidelines.
- The skill is a 39-line prompt. At every run it WebFetches `main/command.md`, a model reads the files you name, and it prints terse `file:line - issue` lines grouped by file. It has no script, no rendered-page check, no rule IDs, no severity and no pinning. In this session WebFetch returned the curly-quote rule with straight quotes. Upstream had shipped that same rule broken from 2026-01-12 to 2026-08-18.
- The three texts diverge. The web page has 129 rules (115, plus 14 "Vercel-specific" copywriting rules), AGENTS.md has 107 and command.md has 103 bullets (90 distinct rules). The skill applies command.md only. That file drops 47 page rules, among them 8 of the 11 Design rules (shadows, radii, hue, charts, APCA contrast, banding) and 4 of the 7 Layout rules, so the skill's "audit design" trigger promises more than it checks.
- command.md also drops "They aren’t universal guidelines" and the sentence-case exception for marketing pages. Title Case, second person and "&" become audit rules, although Vercel's own writing guidelines flag Title Case headings.
- Three contradictions reach the pipeline. On zoom, the README offers `maximum-scale=1`, AGENTS.md and command.md forbid it, axe `meta-viewport` (wcag2aa) fails it, and vercel.com ships it and fails axe under /harden's tag set. On contrast, WIG prefers APCA, while WCAG 2.2, axe, /harden and Claude Design use 4.5:1, and the WCAG 3 draft of 10 Sep 2026 says the algorithm "is yet to be determined". On target size, the 24 px rule duplicates /harden and the 44 px mobile rule goes beyond it.
- I classified all 137 distinct rules. 35 can be checked statically, 52 need a rendered page (Playwright) and 50 need judgement. 19 of the 90 command.md rules overlap /harden FE-11 to FE-21. The other 71 (motion, typography, theming, touch, forms, images, i18n, copy) are not covered by /harden.
- WIG addresses one of the owner's 20 tells directly: tell 14, through "Interactive states increase contrast". It covers 6 in part (5, 7, 12, 13, 15, 17) and says nothing on the other 13. It is an interface-hygiene layer, not an anti-slop list.
- Control probe (vercel.com/design/guidelines, vercel.com, linear.app and stripe.com, with Playwright and axe): used as literal gates, WIG rules fire on human-designed sites. Vercel's own guidelines page fails `maximum-scale=1`, has `transition: all` on 3 elements, and is a dark page without `color-scheme: dark`. `transition: all` fired on 3 of 4 pages. Missing image dimensions fired on 2. At 390 px width, 76 to 95% of interactive elements were under 44 px. The hover-opacity check, the one WIG rule that maps to a tell, stayed silent: 0 of 28 hovered controls lost opacity. Linear sets Inter on body and h1, so an "Inter everywhere" rule would fire on a control site.
- In Claude Code, WIG's AGENTS.md route is skipped when the project has a CLAUDE.md. The `AGENTS.local.md` the maintainer recommends for domain rules is never read. A wallet-address truncation rule was rejected upstream as "too domain-specific".
- For /frontend: vendor command.md and the README at a pinned SHA (MIT). Give every rule a stable ID and implement the 87 static or rendered rules as deterministic checks, without re-running /harden's jsx-a11y and axe floor. Calibrate each check on a control corpus before it gates. Keep the judgement rules as a model review. Add the web3 and anti-slop rules WIG leaves out.
- Added at verification: shadcn's current Button carries `transition-all` in its base class, so C31 fires on every untouched shadcn button (it also fired on 3 of 4 human controls). Its default hover, `hover:bg-primary/90`, lowered rendered text contrast from 17.18:1 to 13.01:1 while computed `opacity` stayed 1, so an opacity-only tell-14 probe cannot see it (F25). The zoom dispute splits by platform: iOS Safari has ignored `user-scalable` since Safari 10, and Chrome for Android documents a "Force enable zoom" setting for pages that prevent zoom (F26).

## Findings

### FD04-F01 — "Web design guidelines" is Vercel's web-design-guidelines skill, a wrapper around the Web Interface Guidelines
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The skill `web-design-guidelines` lives in github.com/vercel-labs/agent-skills (31,762 stars; SKILL.md metadata `version: "1.0.0"`). It was renamed from `vercel-design-guidelines` on 2026-01-14 and last changed on 2026-01-16 (commit ba46938). It reviews code against the Web Interface Guidelines in github.com/vercel-labs/web-interface-guidelines (created 2025-09-10; 912 stars; HEAD e3d624baaf29dc1fc645aff3e38f03e564d2d6b1 of 2026-08-18; 0 tags, 0 releases). The guidelines are published at vercel.com/design/guidelines, whose text matches the README: all 129 bold rule titles appear on the rendered page. John Pham (GitHub JohnPhamous) authored 41 of the repository's 58 commits and answers its issues. skills.sh reports 684.7K installs and "First Seen Jan 19, 2026".
- **Implication for /frontend:** Cite WIG by commit SHA, never as "latest". The owner's tool name maps to this pair (skill plus guideline repo). F22 lists the other things with the same name.
- **Evidence:**
  - [vercel-labs/agent-skills commits for skills/web-design-guidelines/SKILL.md](https://github.com/vercel-labs/agent-skills/commits/main/skills/web-design-guidelines/SKILL.md) — Vercel Labs, accessed 2026-09-30 — repository history (gh api).
    - `gh api "repos/vercel-labs/agent-skills/commits?path=skills/web-design-guidelines/SKILL.md"` → "ba46938889 2026-01-16T23:47:11Z Thomas Mustier: Fix SKILL.md frontmatter formatting for web-design-guidelines (#28)", "42ecbef87d 2026-01-15T18:09:40Z Andrew Qu: Add versioning and sync the version with the build/validate script (#24)", "9e2435e972 2026-01-14T18:49:56Z elsigh: Rename vercel-design-guidelines to web-design-guidelines" (corrected: the command returns three commits, not two; 42ecbef is the commit that added the `metadata` block with `version: "1.0.0"`)
  - [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) — Vercel Labs, HEAD e3d624b (2026-08-18), accessed 2026-09-30 — repository metadata (gh api).
    - `gh api repos/vercel-labs/web-interface-guidelines` → "created_at":"2025-09-10T03:52:51Z", "homepage":"https://vercel.com/design/guidelines", "license" MIT, "stargazers_count":912; `.../tags` → 0; `.../releases` → 0
    - `gh api "repos/vercel-labs/web-interface-guidelines/commits?per_page=100" --jq '.[].commit.author.name' | sort | uniq -c` → "38 John Pham", "3 John Phamous", 58 commits in all
  - [web-design-guidelines on skills.sh](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines) — Vercel (skills.sh), accessed 2026-09-30 — registry page.
    - "Installs 684.7K" · "First Seen Jan 19, 2026"
- **Limits / false positives:** Install counts are skills.sh's own telemetry and were not checked independently.

### FD04-F02 — The skill is a 39-line prompt that fetches unpinned rules at run time and has a model judge the files; there is no checker, no rendered page and no rule ID
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The skill folder holds one file, SKILL.md (39 lines, 1,231 bytes). Its procedure is to fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` with WebFetch before every review, read the files the user names (or ask for them), "Check against all rules in the fetched guidelines" and print findings in the format that command.md sets: grouped by file, `file:line` plus a terse issue, "✓ pass" for clean files, no preamble and no explanation unless the fix is non-obvious. Nothing is executed. The model judges source text, so rules that need a browser (focus obscured, contrast, target size, reduced motion) can only be guessed. The output carries no rule ID, severity or confidence. The rules applied can change between two runs with no record, because the fetch targets `main` and the repo has no tags. `argument-hint` sits under `metadata`, which Claude Code "doesn't act on". SKILL.md declares no `allowed-tools`.
- **Implication for /frontend:** Do not call this skill as-is from /execution. Vendor a pinned copy of the rules, give every rule a stable ID (Appendix A uses C01 to C90 and Appendix B uses B01 to B47), implement the static and rendered rules as deterministic checks that report `file:line` or a CSS selector, and run the judgement rules as a model pass over the vendored text. /harden already reports with rule refs (FE-NN) and a JSON schema, and /frontend's output should match that shape.
- **Evidence:**
  - [skills/web-design-guidelines/SKILL.md](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md) — Vercel Labs, v1.0.0 (file last changed 2026-01-16), accessed 2026-09-30 — the tool's own file.
    - "Fetch fresh guidelines before each review:"
    - "Use WebFetch to retrieve the latest rules. The fetched content contains all the rules and output format instructions."
    - "If no files specified, ask the user which files to review."
  - [command.md, Output Format](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "Group by file. Use `file:line` format (VS Code clickable). Terse findings."
    - "State issue + location. Skip explanation unless fix non-obvious. No preamble."
  - [Skills: frontmatter reference](https://code.claude.com/docs/en/skills) — Anthropic, accessed 2026-09-30 — official docs.
    - "`metadata` | No | Free-form YAML map for your own key-value data, such as entitlement or catalog fields, read by your own tooling from `SKILL.md`. Claude Code doesn't act on its contents"
  - Tree listing, OBSERVED: `gh api "repos/vercel-labs/agent-skills/git/trees/main?recursive=1"` → "blob 1231 skills/web-design-guidelines/SKILL.md" and no other file under that folder.
- **Limits / false positives:** The model pass may still work as a cheap second opinion. No measurement of its precision or recall was found (see "What could not be found"). Verification note: commit ba46938 moved `argument-hint` from the top level into `metadata`. The Claude Code docs explain why: claude.ai uploads and the Skills API reject it at the top level ("Unexpected key(s) in SKILL.md frontmatter: argument-hint"). The move made the file portable, and as a side effect Claude Code no longer uses the hint.

### FD04-F03 — The mandated fetch path altered a rule in this session, and upstream shipped that rule broken for seven months
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The WebFetch tool in this Claude Code session (v2.1.286) is described as "converts the page to markdown, and answers `prompt` against it using a small fast model". Asked to return every rule "exactly as written", it returned the typography rule as "Curly quotes `"` `"` not straight `"`". The raw bytes of command.md line 65 hold U+201C and U+201D (octal 342 200 234 and 342 200 235). The rest of the output matched the file on a visual read. Separately, issue #26 showed that command.md and AGENTS.md carried byte-identical straight quotes for this rule from commit 30abf89 (2026-01-12) until PR #28 (2026-08-18): "the rule as published cannot be applied". Vercel's sibling writing-guidelines command.md still has ASCII `"` for both characters of its curly-quote rule (last commit 2026-05-30).
- **Implication for /frontend:** Read vendored rules with a byte-exact read, never through a summarizing fetch. Add a self-test asserting that the curly-quote rule contains U+201C and U+201D. Test every typography check on bytes, not on rendered or model-relayed text.
- **Evidence:**
  - OBSERVED: `curl -sL .../main/command.md | sed -n '65p' | od -c` → the first two code spans hold the bytes 342 200 234 and 342 200 235 (U+201C and U+201D); only the third holds 0x22
  - OBSERVED: WebFetch of the same URL → "- Curly quotes `"` `"` not straight `"`"
  - [Issue #26: Curly-quotes rule in AGENTS.md and command.md shows straight quotes as both the recommended and the prohibited character](https://github.com/vercel-labs/web-interface-guidelines/issues/26) — SegundoRP, 2026-08-10, closed 2026-08-18, accessed 2026-09-30 — issue tracker.
    - "commit 30abf89 (#17) replaced them with straight quotes. `command.md` was introduced in that same commit with straight quotes from the start."
    - "Since the recommended and prohibited examples are byte-identical, the rule as published cannot be applied"
  - [writing-guidelines command.md](https://github.com/vercel-labs/writing-guidelines/blob/main/command.md) — Vercel Labs, last commit 11483f8 (2026-05-30), accessed 2026-09-30 — sibling tool's file.
    - Line 131, OBSERVED with `od -c`: `` - Curly quotes `"` `"` and `'` `'`, not straight `"` or `'` `` (all ASCII)
- **Limits / false positives:** One WebFetch call. The change may depend on the prompt. Other rules were not diffed byte by byte against the WebFetch output. Verification note: a second WebFetch call with a differently worded prompt ("Return the complete Typography section of this file exactly as written, character for character ... Do not normalize any characters") again returned "Curly quotes `"` `"` not straight `"`". In the same output `…` and `⌘` came through intact. The fix commit d7f7445 (PR #28, merged 2026-08-18T00:21Z) changes exactly this line in command.md and AGENTS.md.

### FD04-F04 — Three texts, three rule sets: the page has 129 rules, AGENTS.md 107, command.md 103 bullets (90 distinct), and the skill applies only command.md
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The README and web page hold 115 bold rules in 7 sections (Interactions 28, Animations 10, Layout 7, Content 24, Forms 19, Performance 16, Design 11) plus 14 "Vercel-specific" copywriting rules. AGENTS.md holds 107 rule lines (72 MUST, 29 SHOULD, 6 NEVER). command.md holds 103 bullets in 17 sections. 14 of them form an "Anti-patterns (flag these)" list, and 13 of those restate earlier bullets, which leaves 90 distinct rules. The agent-skills README advertises "100+ rules".
- **Implication for /frontend:** Record which text each vendored rule comes from. The README is the most complete and carries the scope notes. command.md is the terse checklist the skill uses.
- **Evidence:**
  - OBSERVED: awk over [command.md](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) → "TOTAL 103", with "14 ### Anti-patterns (flag these)"; grep over [AGENTS.md](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/AGENTS.md) → 72 `- MUST`, 29 `- SHOULD`, 6 `- NEVER`; awk over [README.md](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) → 115 bold rules before "# Vercel-specific", 14 in Copywriting — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own files.
  - [agent-skills README](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/README.md) — Vercel Labs, accessed 2026-09-30 — the tool's own file.
    - "Review UI code for compliance with web interface best practices. Audits your code for 100+ rules covering accessibility, performance, and UX."
- **Limits / false positives:** Counts depend on bullet parsing. Sub-bullets are merged into their parent rule.

### FD04-F05 — The "audit design" trigger overstates coverage: 47 page rules never reach command.md, including 8 of 11 Design and 4 of 7 Layout rules
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** command.md contains none of: Layered shadows, Crisp borders, Nested radii, Hue consistency, Accessible charts, Minimum contrast (APCA), Text anti-aliasing, Avoid gradient banding; Optical alignment, Deliberate alignment, Balance contrast in lockups, Responsive coverage. It also leaves out Manage focus, the 24/44 px hit targets, 16 px mobile inputs, tooltip timing, minimum loading duration, Enter submits, stable skeletons, accurate page titles, no dead ends, the logo rule, latency budgets, font subsetting and 6 copywriting rules. Appendix B lists all 47. A case-insensitive grep of command.md for shadow, radius/radii, hue, chart, APCA, banding, optical, align, lockup, responsive, skeleton, tooltip, `<title>` and "dead end" returns 0 each. The SKILL.md description still lists "audit design" as a trigger, and skills.sh summarizes it as covering "design, accessibility, and UX best practices". A third-party page goes further and says findings are "grouped by theme" and that "Each finding includes the why and a fix pattern", the opposite of command.md's format.
- **Implication for /frontend:** The skill says nothing about visual quality. Most of the omitted Design and Layout rules can be checked in a rendered page (shadow layer count, nested radii, hue consistency, CVD simulation of chart colours, spacing and alignment clustering), so /frontend has to implement them itself if it wants them. Read tools, not their catalogue pages.
- **Evidence:**
  - OBSERVED: `for k in shadow radius radii hue chart APCA banding optical align lockup responsive skeleton tooltip "<title>" "dead end" "transform-origin"; do grep -c -i -e "$k" command.md; done` at e3d624b → 0 for every keyword, 2 for the control keyword "transform-origin".
  - [SKILL.md](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md) — Vercel Labs, v1.0.0, accessed 2026-09-30 — the tool's own file.
    - 'Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".'
  - [skills.sh page](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines) — Vercel, accessed 2026-09-30 — registry summary.
    - "Covers design, accessibility, and UX best practices as defined in the guidelines repository"
  - [Claude Code skill: web-design-guidelines](https://agentcookbooks.com/skills/web-design-guidelines/) — Agent Cookbooks, datePublished 2026-04-28 in the page's JSON-LD, accessed 2026-09-30 — third-party description (grade D as a claim about the tool). (corrected: the page is not undated; its JSON-LD carries datePublished and dateModified 2026-04-28)
    - "Findings are grouped by theme (a11y / perf / responsive / UX) and prioritized inside each by user impact . Each finding includes the why and a fix pattern."
- **Limits / false positives:** Vercel may have left these rules out on purpose, since they are hard to judge from source. command.md arrived whole in 30abf89, "Add slash command and multi-tool installer" (2026-01-12). That commit's body states the file's intended scope: "Covers a11y, forms, animation, perf, i18n, anti-patterns". Design and layout are absent from that declared scope, so the omission looks deliberate, but no commit or issue gives a reason. (corrected: the earlier text said no commit message explains it; the commit body does declare a scope without design or layout)

### FD04-F06 — command.md turns Vercel's brand copy preferences into universal audit rules
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The README fences its copywriting section as brand preference and exempts marketing pages from Title Case. command.md states "Title Case for headings/buttons (Chicago style)", "Second person; avoid first person" and '`&` over "and" where space-constrained' with no disclaimer and no exception. The README's own "&" rule has no space condition. Vercel's writing guidelines list Title Case headings as an anti-pattern.
- **Implication for /frontend:** A hackathon landing page is a marketing page, so do not enforce Title Case headings. Treat C84, C88 and C89 as optional house style, off by default. Voice belongs to /prose's rules.
- **Evidence:**
  - [README.md lines 145, 151, 153](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "These preferences reflect Vercel’s brand & product choices. They aren’t universal guidelines."
    - "**Headings & buttons use Title Case** ([Chicago](https://title.sh/)). On marketing pages, use sentence case."
    - "**Prefer `&` over `and`.**"
  - [command.md lines 144, 148, 149](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "Title Case for headings/buttons (Chicago style)" · "Second person; avoid first person" · '`&` over "and" where space-constrained'
  - [writing-guidelines command.md](https://github.com/vercel-labs/writing-guidelines/blob/main/command.md) — Vercel Labs, 2026-05-30, accessed 2026-09-30 — sibling tool's file.
    - "Title Case in page headings (only sentence case in `H1` through `H6`)" (listed under "Anti-patterns (flag these)")
- **Limits / false positives:** The writing guidelines target docs, not product UI, so they conflict with command.md only where headings are shared. Verification note: the writing guidelines also prescribe "Title case for nav labels" (line 67) and "`&` over "and" only where space-constrained (nav labels, buttons)" (line 135). They agree with command.md outside page headings.

### FD04-F07 — The zoom rule contradicts itself, Vercel ships the forbidden viewport, and /harden's axe run fails it
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** README line 11 offers `maximum-scale=1` as an alternative to 16 px inputs, and line 12 says "Never disable browser zoom". AGENTS.md and command.md forbid `maximum-scale=1`. Issue #11 raised the conflict on 2025-09-24 and was closed as "not_planned". The maintainer later wrote "It did not prevent a user from zooming", and a user answered that it does on Chrome 144 and Firefox 149 on Android 16. axe-core's `meta-viewport` rule (tags wcag2aa, wcag144) fails any `maximum-scale` below its `scaleMinimum` of 2. Measured on 2026-09-30: vercel.com/design/guidelines and vercel.com both serve `width=device-width, initial-scale=1, maximum-scale=1`, and axe 4.11.2 run with /harden's tag set reports `meta-viewport(1)` on both. Next.js documents `maximumScale` and `userScalable`, with example output `maximum-scale=1, user-scalable=no`, and notes that manual configuration "is usually unnecessary".
- **Implication for /frontend:** Never emit `maximum-scale` or `user-scalable`. Prevent iOS focus zoom with inputs of 16 px or more. Check the static side (C90: meta tags and Next.js `viewport` exports). The runtime side is already /harden FE-18.
- **Evidence:**
  - [README.md lines 11-12](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - '**Mobile input size.** `<input>` font size is ≥ 16px on mobile to prevent iOS Safari auto-zoom/pan on focus. Or set `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />`.'
    - "**Respect zoom.** Never disable browser zoom."
  - [AGENTS.md line 16](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/AGENTS.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "NEVER: Disable browser zoom (`user-scalable=no`, `maximum-scale=1`)"
  - [Issue #11: Contradiction in "Mobile input size" and "Respect zoom"](https://github.com/vercel-labs/web-interface-guidelines/issues/11) — OliverJAsh and others, 2025-09-24 to 2026-01-23, accessed 2026-09-30 — issue tracker (device reports are grade D anecdotes).
    - JohnPhamous, 2025-12-02: "It did not prevent a user from zooming."
    - robinmetral, 2026-01-23: "It does still prevent Android users from zooming in—reproduced it on my device" and "tested Chrome 144 and Firefox 149 on Android 16"
  - [axe-core lib/checks/mobile/meta-viewport.json and lib/rules/meta-viewport.json](https://github.com/dequelabs/axe-core/tree/v4.13.0/lib) — Deque, v4.13.0, accessed 2026-09-30 — source code.
    - `"scaleMinimum": 2` · `"help": "Zooming and scaling must not be disabled"` · tags "wcag2aa", "wcag144"
  - OBSERVED: `node wig-axe-probe.mjs https://vercel.com/design/guidelines https://vercel.com/ ...` (axe 4.11.2, tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, 2026-09-30T19:39Z) → vercel.com/design/guidelines "violations":["meta-viewport(1)","scrollable-region-focusable(1)"]; vercel.com "violations":["meta-viewport(1)"]
  - [generateViewport (markdown)](https://nextjs.org/docs/app/api-reference/functions/generate-viewport.md) — Vercel (Next.js docs), version 16.3.7, accessed 2026-09-30 — official docs.
    - "**Good to know**: The `viewport` meta tag is automatically set, and manual configuration is usually unnecessary as the default is sufficient."
    - Example config `maximumScale: 1,` and `userScalable: false,` with `<head>` output `content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"`
- **Limits / false positives:** The Android evidence on both sides is anecdotal. What matters for the pipeline is that axe fails the tag, and /harden gates on axe. Verification note: a curl fetch and an axe re-run at 2026-09-30T20:29Z (axe 4.11.2, same tag set) reproduced `maximum-scale=1` and `meta-viewport(1)` on both Vercel pages. On re-fetch the Next.js page reports `version: 16.3.8`, with the same `lastUpdated: 2026-06-09` and identical quoted text. Vendor documentation for each platform is now in F26.

### FD04-F08 — "Prefer APCA over WCAG 2" conflicts with every contrast gate the pipeline runs
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The README and AGENTS.md (not command.md) prefer APCA. WCAG 2.2 SC 1.4.3 (AA) requires 4.5:1, or 3:1 for large text. axe `color-contrast` checks "WCAG 2 AA minimum contrast ratio thresholds", and /harden FE-18 gates on it. Claude Design's craft rules say "Text 4.5:1 (3:1 at 24px+)". The W3C WCAG 3.0 Working Draft of 10 September 2026 says "The contrast algorithm used in WCAG 3 is yet to be determined", and the string "APCA" does not occur in it.
- **Implication for /frontend:** WCAG 2 AA is the gate. /frontend may compute APCA Lc as an advisory second signal, for example on tell 7 (low-contrast dark mode), but an APCA pass never waives a WCAG 2 failure.
- **Evidence:**
  - [README.md line 136](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) and [AGENTS.md line 152](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/AGENTS.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own files.
    - "**Minimum contrast.** Prefer [APCA](https://apcacontrast.com/) over [WCAG 2](https://webaim.org/resources/contrastchecker/) for more accurate perceptual contrast."
    - "MUST: Meet contrast—prefer [APCA](https://apcacontrast.com/) over WCAG 2"
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — W3C, Recommendation 12 December 2024, accessed 2026-09-30 — standard.
    - "Contrast (Minimum) [...] (Level AA) The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for the following: Large Text Large-scale text and images of large-scale text have a contrast ratio of at least 3:1"
  - [W3C Accessibility Guidelines (WCAG) 3.0](https://www.w3.org/TR/wcag-3.0/) — W3C AG WG, Working Draft 10 September 2026, accessed 2026-09-30 — draft standard.
    - "The contrast algorithm used in WCAG 3 is yet to be determined."
  - [axe-core rule descriptions](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/rule-descriptions.md) — Deque, v4.13.0, accessed 2026-09-30 — tool docs.
    - "color-contrast [...] Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds"
  - [Design artifact type SKILL.md](https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd) — Anthropic (claude.ai core type "Design"), release 1790780428-0f80, read with the Artifact tool, accessed 2026-09-30 — the tool's own file.
    - "Text 4.5:1 (3:1 at 24px+): caption grey, and fills under white text, fail most; darken both."
- **Limits / false positives:** APCA may be adopted later. This dossier does not assess APCA's perceptual claims. Verification note: the WCAG 3 sentence is an editor's note. It continues: "For this draft, the requirement assumes the algorithm will include a size/weight factor."

### FD04-F09 — Target size: the 24 px half duplicates /harden, and the 44 px mobile half goes beyond it and would not stay silent on human sites
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** WIG asks for at least 24 px, expanded hit areas for smaller visuals, and 44 px on mobile. WCAG 2.2 sets 24 by 24 CSS px at AA (2.5.8, with exceptions) and 44 by 44 at AAA (2.5.5). axe's `target-size` check uses `minSize` 24 and has `"enabled": false`, but `ruleShouldRun` matches requested tags before it looks at `enabled`, so the rule runs when `wcag22aa` is requested, as /harden FE-21 notes. Claude Design asks for "Touch targets ≥44px" with no desktop case. In the F13 probe, a naive bounding-box count flagged 130 of 184 interactive elements under 24 px on vercel.com/design/guidelines, while axe `target-size` reported 0 violations on all four control pages (6 "incomplete" on linear.app). At 390 px width, 76 to 95% of interactive elements per page were under 44 px in one dimension (naive count, inline text links included).
- **Implication for /frontend:** Leave the 24 px check to axe, which /harden already runs, and do not write a naive geometry rule. If /frontend enforces 44 px, scope it to primary touch controls (buttons, form fields, menu toggles) at mobile width, and calibrate it on controls before it gates.
- **Evidence:**
  - [README.md line 10](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "**Match visual & hit targets.** Exception: if the visual target is < 24px, expand its hit target to ≥ 24px. On mobile, the minimum size is 44px."
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — W3C, Recommendation 12 December 2024, accessed 2026-09-30 — standard.
    - "Target Size (Minimum) [...] (Level AA) New The size of the target for pointer inputs is at least 24 by 24 CSS pixels , except when:"
    - "Target Size (Enhanced) [...] (Level AAA) The size of the target for pointer inputs is at least 44 by 44 CSS pixels except when:"
  - [axe-core lib/rules/target-size.json, lib/checks/mobile/target-size.json, lib/core/utils/rule-should-run.js](https://github.com/dequelabs/axe-core/tree/v4.13.0/lib) — Deque, v4.13.0, accessed 2026-09-30 — source code.
    - `"enabled": false` · `"minSize": 24` · `if (matching || (include.length === 0 && rule.enabled !== false))`
  - [harden lens-frontend.md, FE-21](file:///C:/Users/Utilisateur/.claude/skills/harden/references/lens-frontend.md) — the owner's /harden skill, accessed 2026-09-30 — sibling skill file.
    - "Its only wcag22aa rule, `target-size`, is disabled by default and runs when the tag is requested."
  - [Design artifact type SKILL.md](https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd) — Anthropic, release 1790780428-0f80, accessed 2026-09-30 — the tool's own file.
    - "Touch targets ≥44px"
  - OBSERVED: probe results in Appendix D (wig-probe.mjs, wig-axe-probe.mjs; 2026-09-30T19:35-19:40Z).
- **Limits / false positives:** The 44 px count is naive: nav and inline text links dominate it. It is not a WCAG measurement. Verification note: a re-run of the same probe at 2026-09-30T20:27Z to 20:29Z reproduced 130 of 184, the four 390 px counts and axe `target-size` (0 violations, 6 incomplete on linear.app). The desktop 24 px counter excludes inline links inside P, LI, SPAN and TD; the 390 px counter does not.

### FD04-F10 — Overlap with /harden: 19 of the 90 command.md rules touch FE-11 to FE-21; 71 do not
- **Grade:** B · **Kind:** ASSERTED (the mapping), on OBSERVED greps · **Verdict:** CORRECTED
- **Claim:** Mapping by rule text (Appendix A): 13 command.md rules are covered by /harden (C01 to C05, C08, C11, C21 and C67 by FE-18/19/20 through jsx-a11y and axe; C90 by axe `meta-viewport` in FE-18; C79 and C80 by FE-12; C17 as an FE-21 report-only item). 6 overlap partly (C09, C12, C51, C53, C59, C66). 71 are not covered. C66 is partial because FE-21 names only SC 2.5.7 Dragging Movements. Its pinch and path gestures fall under WCAG 2.2 SC 2.5.1 Pointer Gestures (Level A: "All functionality that uses multipoint or path-based gestures for operation can be operated with a single pointer without a path-based gesture, unless a multipoint or path-based gesture is essential."), which lens-frontend.md never names (0 hits for 2.5.1, pinch, swipe, path-based). /harden's lens file never mentions outline, reduced motion, paste, autocomplete, CLS, color-scheme, theme-color, tabular figures, ellipsis, curly quotes, viewport, `Intl`, virtualization, lazy loading, preconnect or fonts. Its two "transition" hits are legal transitions under the EAA and EN 301 549. C09 is only partly covered, because axe tags `heading-order` and `skip-link` as best-practice, and /harden runs only the WCAG tags; `bypass` (wcag2a) does run. Among the 47 page-only rules, 5 touch /harden (B02, B19, B21, B29, B39). (corrected: C66 moved from covered to partial, so 13 strong and 6 partial instead of 14 and 5; the total of 19 overlapping rules is unchanged. Grade lowered from A to B because the strong, partial or none mapping is judgement, as the C66 error shows; the grep counts remain observed.)
- **Implication for /frontend:** /frontend owns the 71 uncovered command.md rules and the 42 uncovered page rules. It should not re-run jsx-a11y and axe for the 19. For C09's heading half, request `heading-order` by rule ID, or through the `best-practice` tag, which also pulls in every other best-practice rule; /harden's WCAG-only tag list skips it. No axe rule checks C09's skip-link half. `skip-link` only tests skip links that already exist ("Ensure all skip links have a focusable target"). `bypass` passes on any of `internal-link-present`, `header-present` or `landmark`. A custom check is needed, for example that the first focusable element is an in-page link to the main content. (corrected: the earlier text implied that requesting `skip-link` by rule ID covers C09 and that rule ID is the only way to request best-practice rules)
- **Evidence:**
  - [harden lens-frontend.md](file:///C:/Users/Utilisateur/.claude/skills/harden/references/lens-frontend.md) — the owner's /harden skill, accessed 2026-09-30 — sibling skill file.
    - FE-18: "`new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()`"
    - FE-19 Detect: "jsx-a11y `alt-text`, `label-has-associated-control`, `anchor-has-content`, `anchor-is-valid`, `click-events-have-key-events`, `no-static-element-interactions`, `interactive-supports-focus`."
    - OBSERVED: `grep -c -i` over the file → outline 0, reduced 0, paste 0, autocomplete 0, CLS 0, color-scheme 0, theme-color 0, tabular 0, ellipsis 0, curly 0, viewport 0, Intl 0, virtual 0, lazy 0, preconnect 0, font 0; transition 2 (both legal text).
  - [axe-core rule descriptions](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/rule-descriptions.md) — Deque, v4.13.0, accessed 2026-09-30 — tool docs.
    - "heading-order [...] cat.semantics, best-practice" · "skip-link [...] cat.keyboard, best-practice" · "bypass [...] cat.keyboard, wcag2a, wcag241"
  - [axe-core lib/rules/bypass.json, lib/rules/skip-link.json, doc/API.md](https://github.com/dequelabs/axe-core/tree/v4.13.0) — Deque, v4.13.0 (released 2026-08-05), accessed 2026-09-30 — source code and API docs (added at verification).
    - bypass: `"any": ["internal-link-present", "header-present", "landmark"]` · skip-link: `"description": "Ensure all skip links have a focusable target"`, selector `a[href^="#"], a[href^="/#"]`
    - API.md tag table: "`best-practice` | Common accessibility best practices"; runOnly takes tags or rule IDs.
  - [WCAG 2.2, SC 2.5.1 Pointer Gestures](https://www.w3.org/TR/WCAG22/) — W3C, Recommendation 12 December 2024, accessed 2026-09-30 — standard (added at verification).
    - "(Level A) All functionality that uses multipoint or path-based gestures for operation can be operated with a single pointer without a path-based gesture, unless a multipoint or path-based gesture is essential."
  - [eslint-plugin-jsx-a11y README](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/v6.10.2/README.md) — jsx-eslint, v6.10.2, accessed 2026-09-30 — tool docs.
    - "no-autofocus [...] Enforce autoFocus prop is not used." (set in `recommended`); "control-has-associated-label" is disabled in `recommended` and `strict`.
- **Limits / false positives:** /harden may change. The mapping is by rule text, not by running both tools on one codebase.

### FD04-F11 — The 137 distinct rules split into 35 static, 52 rendered and 50 judgement rules
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Appendix A classifies the 90 distinct command.md rules as 34 static (S), 30 rendered (R) and 26 judgement (J). Appendix B classifies the 47 page-only rules as 1 S, 22 R and 24 J. Method: S when a regex or AST check on source decides; R when computed style, geometry, events, network or media emulation in Playwright decide; J when intent or meaning decides, even if a script can list candidates. Most Design-section rules are R (shadow layers, nested radii, hue consistency, CVD simulation). Most copy rules are J.
- **Implication for /frontend:** A deterministic checker can cover up to 87 rules. The visual-polish rules need a browser, not source regexes. Several S rules need an AST rather than a regex: a raw `\.\.\.` search hits JSX spread syntax (C37), and quote checks must look only at JSX text nodes (C38).
- **Evidence:**
  - Appendix A and Appendix B of this dossier, generated from [command.md](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) and [README.md](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) at e3d624b by `gen_appendix.py` — accessed 2026-09-30 — own analysis of primary files.
    - OBSERVED output: "command.md: 103 bullets, 90 distinct rules, 13 restatements. Classes: S 34, R 30, J 26." · "README rules absent from command.md: 47. Classes: S 1, R 22, J 24." · "grand total distinct: 137 S 35 R 52 J 50"
- **Limits / false positives:** The classification is my judgement. Some R rules need app-specific fixtures (form states, empty data, slow network) before they can run. Verification note: I recounted Appendix A (90 rows: S 34, R 30, J 26) and Appendix B (47 rows: S 1, R 22, J 24). All 90 Appendix A texts are byte-identical to command.md's bullets in file order. All 47 Appendix B texts match README.md once link targets are stripped and sub-bullets joined. The class assignments themselves were not re-judged.

### FD04-F12 — Against the owner's 20 tells, WIG addresses 1 directly, 6 in part and 13 not at all
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Appendix C maps each tell to WIG text. Direct: tell 14 (buttons fade on hover) through C82, "Interactive states increase contrast: hover/active/focus more prominent than rest", because a hover that lowers opacity lowers contrast. In part: 5 (B35 Crisp borders and B37 Hue consistency point to neutral or background-tinted borders), 7 (C71 `color-scheme`, B39 contrast), 12 and 13 (C29 and C36 reduced motion, B11 "Necessity check"), 15 (B14 "Deliberate alignment"), 17 (C86 specific labels, B42 "Be clear & concise"). Silent: 1, 2, 3, 4, 6, 8, 9, 10, 11, 16, 18, 19, 20. Of the in-part rules, the skill's command.md carries only C29, C36, C71 and C86; the rest are page-only. Claude Design's craft line touches four of them (1, 3, 4 and 5): "No AI tropes (gradient washes, left-border cards, emoji; Inter, Roboto, Arial)."
- **Implication for /frontend:** WIG is an interface-hygiene layer. /frontend needs its own tell rules, calibrated against the owner's past frontends and human-designed controls. It should take C82 (hover contrast) as the one WIG rule that maps to a tell.
- **Evidence:**
  - [README.md](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) and [command.md](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own files (quotes in Appendix C).
  - [Design artifact type SKILL.md](https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd) — Anthropic, release 1790780428-0f80, accessed 2026-09-30 — the tool's own file.
    - "No AI tropes (gradient washes, left-border cards, emoji; Inter, Roboto, Arial)."
- **Limits / false positives:** The mapping is my reading. "Buttons fade on hover" is read as an opacity drop; a colour fade toward higher contrast would pass C82. Verification note: WIG's text is silent on tell 11, but its rule C31 (`transition: all`) fires on every untouched shadcn Button, whose base class carries `transition-all` (F25). C31 also fired on 3 of 4 human controls, so on its own it does not separate tell 11 from human work.

### FD04-F13 — Used as literal gates, WIG rules fire on human-designed sites, Vercel's own guidelines page included
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** A Playwright probe of four human-designed pages on 2026-09-30 (Appendix D) found:
  - `maximum-scale=1` on 2 of 4 (both Vercel), which axe also fails.
  - Computed `transition-property: all` with a non-zero duration on 3 of 4 (3, 15 and 2 elements; 0 on stripe.com).
  - `<img>` without width and height attributes on 2 of 4 (3 of 38 and 2 of 38).
  - A dark page without `color-scheme: dark` or a color-scheme meta: vercel.com/design/guidelines.
  - `touch-action: manipulation` on 0 of 72 buttons (linear.app) and 0 of 29 (stripe.com).
  - Headings with `text-wrap: balance` or `pretty` from 0 of 14 to 20 of 32.
  - "..." in visible text: 8 times on linear.app.
  - `document.getAnimations()` under `prefers-reduced-motion: reduce`: 76 running on linear.app, against 105 without the preference.
  - At 390 px, 76 to 95% of interactive elements under 44 px.
  - Fonts: linear.app, a control, sets "Inter Variable" as the body and h1 font. vercel.com/design/guidelines lists Inter second in its body stack, as the first fallback after Geist (`Geist, Inter, -apple-system, …`); its h1 stack is `GeistSans, "GeistSans Fallback"`. (corrected: Inter is the first fallback, not the second)
- **Implication for /frontend:** WIG rules cannot join a slop tier that must stay silent on human-designed controls. Put them in a separate hygiene tier with per-rule calibration. Rules that fire on 2 or more of 4 controls should warn, not gate. `maximum-scale` is the exception: /harden already gates it through axe. A tell-4 rule that flags Inter would fire on linear.app.
- **Evidence:**
  - OBSERVED: `node wig-probe.mjs https://vercel.com/design/guidelines https://vercel.com/ https://linear.app/ https://stripe.com/` (playwright-core 1.59.1, Chrome for Testing 147.0.7727.15, 1440 x 900 and 390 x 844 mobile, 2026-09-30T19:35-19:37Z) → per-page JSON in Appendix D.
  - OBSERVED: `node wig-axe-probe.mjs` (axe-core 4.11.2) → html computed `color-scheme` "normal", no color-scheme meta, `scroll-padding-top` "64px" on vercel.com/design/guidelines.
  - [vercel.com/design/guidelines HTML](https://vercel.com/design/guidelines) — Vercel, deployment `dpl_87quGsyjyrhFgS8KikmvS8uNs8i3`, accessed 2026-09-30 — the tool's own page.
    - `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>`
- **Limits / false positives:** Four pages, one load each, one Chromium build. Several counters are naive: target boxes, the selector list for hover, and a focus heuristic that checks only outline and box-shadow. Pages change with every deploy. The 76 animations still running on Linear were not inspected: some may be colour or opacity animations that WCAG does not treat as motion. Verification note: I re-ran both probe scripts unchanged, apart from the output path and an added `addScriptTag` attempt, at 2026-09-30T20:27Z to 20:30Z. Every desktop, mobile and axe value above reproduced except two. Linear's running animations without the preference read 96, not 105 (76 under `reduce` both times). Linear's `color-contrast` violation count read 17, where the saved JSON has 16 and Appendix D reports 18 then 16. Both counters vary between loads. By the re-run, vercel.com/design/guidelines had redeployed (`dpl_Bvydkk3wtWmuiqnYe9MteqkMoYkQ`) and still served `maximum-scale=1`.

### FD04-F14 — The tell-14 check stayed silent on controls: no hovered control lost opacity (0 of 28)
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** The probe hovered buttons and button-like links in the first viewport and compared computed `opacity` after 450 ms. None dropped: 0 of 2 on vercel.com, 0 of 15 on linear.app, 0 of 11 on stripe.com. The selector matched no element in view on vercel.com/design/guidelines. The WIG rule behind it is C82, and the README version reads "Interactions increase contrast. `:hover`, `:active`, `:focus` have more contrast than rest state."
- **Implication for /frontend:** Tell 14 is the best candidate for a tier-1 rule that WIG supports. The rule is silent on this small control set, but it still has to be shown to fire on the owner's past hackathon frontends, which this dossier did not measure. Extend it from opacity to text/background contrast before and after hover.
- **Evidence:**
  - OBSERVED: `hoverProbe` in wig-probe.mjs → "hoverChecked":2,"hoverOpacityDrops":0 (vercel.com); 15/0 (linear.app); 11/0 (stripe.com); 0/0 (vercel.com/design/guidelines).
  - [README.md line 137](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "**Interactions increase contrast.** `:hover`, `:active`, `:focus` have more contrast than rest state."
- **Limits / false positives:** 28 controls on three sites, opacity only, and no positive corpus. Verification note: the re-run reproduced 2/0, 15/0, 11/0 and 0/0. The linear.app figure sits at the script's cap of 15 checked controls. The opacity-only design has a concrete blind spot. shadcn's default Button fades on hover through `hover:bg-primary/90`, a background-alpha change. Computed `opacity` stays 1 while rendered text contrast falls from 17.18:1 to 13.01:1 (F25), so this probe would stay silent on an untouched shadcn button.

### FD04-F15 — The `touch-action: manipulation` MUST rests on a tap delay WebKit removed for responsive pages in 2015
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** WebKit's own post explains that the iOS 350 ms tap delay exists to allow double-tap zoom. It says pages with `width=device-width` get fast single taps at initial scale, and it presents `touch-action: manipulation` as the opt-in for pages that cannot use those viewport configurations. AGENTS.md still makes it a MUST. On the controls, 0 of 72 buttons on linear.app and 0 of 29 on stripe.com set it.
- **Implication for /frontend:** Treat C62 as information at most. Never gate on it.
- **Evidence:**
  - [More Responsive Tapping on iOS](https://webkit.org/blog/5610/more-responsive-tapping-on-ios/) — Wenson Hsieh, WebKit, Dec 15, 2015, accessed 2026-09-30 — engine vendor blog (primary).
    - "WebKit on iOS has a 350 millisecond delay before single taps activate links or buttons."
    - "viewports that have width=device-width will have fast single tapping when the user is at initial scale."
    - "Even if a web page cannot use one of the viewport configurations above, it can still opt in to the fast-tap optimization."
  - [AGENTS.md line 17](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/AGENTS.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "MUST: `touch-action: manipulation` to prevent double-tap zoom"
- **Limits / false positives:** Chromium's behaviour was not checked against a primary source here. Pages zoomed by the user, or without a `width=device-width` viewport, still get the delay.

### FD04-F16 — WIG says React Suspense adds the loading-state delay; React's docs say it does not
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** WIG asks for a show-delay of about 150 to 300 ms and a minimum visible time of about 300 to 500 ms, and says Suspense "does this automatically". React documents a 300 ms throttle between reveals, and says newly rendered boundaries show fallbacks immediately and that urgent updates are not delayed.
- **Implication for /frontend:** To avoid flicker in loading states (wallet and transaction states in a demo video), implement the show-delay and minimum duration explicitly, or use a transition. Do not count on Suspense.
- **Evidence:**
  - [README.md line 16](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "If you show a spinner/skeleton, add a short show-delay (~150–300 ms) & a minimum visible time (~300–500 ms) to avoid flicker on fast responses. The `<Suspense>` component in React does this automatically."
  - [<Suspense>](https://react.dev/reference/react/Suspense) — React team, live docs, accessed 2026-09-30 — official docs.
    - "React reveals suspended content at most once every 300ms, measured from the last reveal."
    - "any newly rendered Suspense boundaries will still immediately display fallbacks to avoid blocking the UI"
    - "It will not delay a render if it’s the result of an urgent update."
- **Limits / false positives:** The React docs page carries no version number. The 300 ms throttle does smooth sequential reveals.

### FD04-F17 — WIG's generation-time route (drop AGENTS.md in the repo) is skipped by Claude Code when the project has a CLAUDE.md
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** WIG tells users to add its AGENTS.md "so agents apply these guidelines during generation". Claude Code reads AGENTS.md by default only when there is no CLAUDE.md in the working directory or above it. It never reads `AGENTS.local.md`, needs v2.1.277 or later to read AGENTS.md at all, and subagents that skip project instructions skip these files too. The maintainer recommended `AGENTS.local.md` for domain rules (PR #15), a file Claude Code does not read. The installed version on this machine is 2.1.286.
- **Implication for /frontend:** When /execution's subagents build UI, put the vendored rules in each subagent's prompt, or import them explicitly with `@` from CLAUDE.md. Never rely on an AGENTS.md being present.
- **Evidence:**
  - [README.md line 187](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "Add [AGENTS.md](https://agents.md/) to your project so agents apply these guidelines during generation."
  - [Memory: AGENTS.md](https://code.claude.com/docs/en/memory) — Anthropic, accessed 2026-09-30 — official docs.
    - "By default, Claude reads `AGENTS.md` only when you have no `CLAUDE.md` in your working directory or above it."
    - "**Not read**: `AGENTS.local.md`, `AGENTS.override.md`, or anything under a `.agents/` directory"
    - "Reading `AGENTS.md` directly requires Claude Code v2.1.277 or later."
    - "subagents that [skip project instructions](/docs/en/sub-agents#what-loads-at-startup) skip these files too"
  - [PR #15](https://github.com/vercel-labs/web-interface-guidelines/pull/15) — jarrensj, closed 2025-10-13 unmerged, accessed 2026-09-30 — pull request.
    - JohnPhamous: "We recommend creating a `*.local.md`, such as `AGENTS.local.md`, with this type of rule."
  - OBSERVED: `claude --version` → "2.1.286 (Claude Code)"
- **Limits / false positives:** Users can change the "Project instructions" setting so that both files load. Verification note: the docs count a `CLAUDE.local.md` too, so one blocks AGENTS.md just as a `CLAUDE.md` does. The user's `~/.claude/CLAUDE.md` does not count: "Don't count, and keep loading alongside `AGENTS.md`: your `~/.claude/CLAUDE.md`, your organization's managed `CLAUDE.md`, and `.claude/rules/` files". The owner's global CLAUDE.md alone would therefore not block an AGENTS.md; only a project-level CLAUDE.md or CLAUDE.local.md does.

### FD04-F18 — Crypto UI rules are out of WIG's scope by the maintainer's decision
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** PR #15 proposed a rule to truncate wallet addresses, hashes and tokens to beginning and end with an ellipsis. It was closed unmerged as "too domain-specific". The number rules WIG does carry are written for fiat: C75 asks for `Intl.NumberFormat`, and B46 asks for currency "with either 0 or 2 decimal places, never mix both".
- **Implication for /frontend:** /frontend needs its own web3 rule set, sourced elsewhere: middle-truncated addresses with the full value available on copy or hover and in the accessible name, and token amounts with decimal-safe formatting instead of 0 or 2 decimals. This dossier did not research those rules.
- **Evidence:**
  - [PR #15 diff](https://github.com/vercel-labs/web-interface-guidelines/pull/15/files) — jarrensj, 2025-10-10, accessed 2026-09-30 — pull request.
    - "+- MUST: Truncate long identifiers (wallet addresses, hashes, tokens) showing beginning & end with ellipsis between (eg, `0x1234…5678`)"
    - JohnPhamous, 2025-10-13: "Thank you for contributing. I will close this as it is too domain-specific."
  - [README.md line 162](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "**Consistent currency formatting.** In any given context, display currency with either 0 or 2 decimal places, never mix both."
- **Limits / false positives:** None.

### FD04-F19 — Em dashes: WIG has no rule, its agent-facing files are dense with them, and Vercel's writing guidelines ban them
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Em dashes: command.md 7, AGENTS.md 5, README 2, rendered page 2 in 2,032 words (0.98 per 1,000). Per 1,000 words that is about 6.7 to 7.6 for command.md, 4.6 to 5.1 for AGENTS.md and 0.77 to 0.85 for the README, depending on the tokenizer. The originally reported 6.68 (1,048 words), 4.59 (1,089) and 0.78 (2,572) sit at the low end of those ranges. /prose's PR-01 threshold is 2.0. WIG's example error copy itself uses one: "Something went wrong—try again or contact support." Vercel's writing guidelines say "Never em dashes (`—`) or dashes (`-`) as punctuation" and list them under "Anti-patterns (flag these)". (corrected: the em-dash counts reproduce exactly, but the word counts do not. Whitespace splitting gives 1,012, 1,036 and 2,347 words (6.92, 4.83, 0.85), and five tokenizers tried gave 926 to 1,015, 976 to 1,046 and 2,347 to 2,610 words. Every reading keeps command.md and AGENTS.md above 2.0 and the README below it.)
- **Implication for /frontend:** WIG does not cover tell 16. Run /prose PR-01 on rendered UI text. Do not paste command.md or AGENTS.md verbatim into generation prompts as a style sample. Whether that primes em dashes is untested, but it is avoidable.
- **Evidence:**
  - OBSERVED: Python count over command.md, AGENTS.md and README.md at e3d624b → "wig-command.md: em_dashes=7 words=1048 per1000=6.68", "wig-AGENTS.md: em_dashes=5 words=1089 per1000=4.59", "wig-README.md: em_dashes=2 words=2572 per1000=0.78"; rendered page "emDashes":2,"words":2032.
  - [README.md line 167](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "Instead of _“Your deployment failed,”_ say _“Something went wrong—try again or contact support.”_"
  - [writing-guidelines command.md lines 130, 189](https://github.com/vercel-labs/writing-guidelines/blob/main/command.md) — Vercel Labs, 2026-05-30, accessed 2026-09-30 — sibling tool's file.
    - "Never em dashes (`—`) or dashes (`-`) as punctuation; use colons, commas, periods, or rephrase"
- **Limits / false positives:** Word counts use a simple tokenizer. The priming effect is a hypothesis. Verification note: command.md was introduced in commit 30abf89 (2026-01-12). That commit's message ends "Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>", and command.md held its 7 em dashes from that first version. AGENTS.md already had 5 em dashes at the parent commit 73e243d, so its density predates that commit. Nothing here shows which sentences a model drafted.

### FD04-F20 — License and installation
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** web-interface-guidelines has an MIT LICENSE ("Copyright (c) 2025 Vercel Labs"), so the rule texts can be vendored with the notice. agent-skills has no LICENSE file: the API returns 404, although its README says "MIT". Current install: `npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines`. The skills CLI (npm `skills` 1.7.0, MIT) puts Claude Code skills in `.claude/skills/`, or `~/.claude/skills/` with `-g`, recommends symlinks, and `npx skills use vercel-labs/agent-skills@web-design-guidelines | claude` runs the skill without installing it. The legacy `curl -fsSL https://vercel.com/design/guidelines/install | bash` still serves install.sh, which writes a snapshot of command.md to `~/.claude/commands/web-interface-guidelines.md` (frozen at install time, no runtime fetch). Neither is installed on this machine.
- **Implication for /frontend:** Vendor the WIG texts with the MIT notice and the SHA. Do not install the skill globally: its "check accessibility" trigger would compete with /harden and /frontend for the same requests.
- **Evidence:**
  - [LICENSE](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/LICENSE) — Vercel Labs, accessed 2026-09-30 — license file.
    - "MIT License" · "Copyright (c) 2025 Vercel Labs"
  - OBSERVED: `gh api repos/vercel-labs/agent-skills/license` → "Not Found (HTTP 404)"; root listing ".github .gitignore AGENTS.md CLAUDE.md README.md package-lock.json package.json packages scripts skills.sh.json skills".
  - [skills CLI README](https://github.com/vercel-labs/skills/blob/main/README.md) — Vercel Labs, npm `skills` 1.7.0 (modified 2026-09-17), accessed 2026-09-30 — tool docs.
    - "| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |"
    - "npx skills use vercel-labs/agent-skills@web-design-guidelines | claude"
  - [install.sh](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/install.sh) — Vercel Labs, last changed 2026-01-21, accessed 2026-09-30 — the tool's own file (also served at vercel.com/design/guidelines/install, OBSERVED with curl).
    - `curl -sL -o "$HOME/.claude/commands/$INSTALL_NAME" "$REPO_URL/$COMMAND_FILE"`
  - OBSERVED: `ls ~/.claude/skills/` → execution, frontend, hackathon, harden, json-canvas, prose, synced; `ls ~/.claude/commands/` → new-project.md, research.md, review.md.
- **Limits / false positives:** None.

### FD04-F21 — Third-party scanners flag the remote-instructions design
- **Grade:** B · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** skills.sh shows three audits. Socket: "Warn", with one LOW anomaly, "System prompt extraction attempt", at 65% confidence (Mar 18, 2026). Gen Agent Trust Hub: "SAFE", with flags EXTERNAL_DOWNLOADS and INDIRECT_PROMPT_INJECTION, noting that nothing isolates the reviewed code from the agent's instructions (Sep 15, 2026). Snyk: "Pass", "No issues detected" (Sep 15, 2026).
- **Implication for /frontend:** A vendored copy read locally removes the remote-instruction surface. Reviewed source files and fetched customer sites are data, and /frontend's prompts should delimit them as such.
- **Evidence:**
  - [Socket audit](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines/security/socket) — Socket via skills.sh, Mar 18, 2026, accessed 2026-09-30 — scanner output.
    - "[Skill Scanner] System prompt extraction attempt" · "Confidence: 65%Severity: 50%"
  - [Gen Agent Trust Hub audit](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines/security/agent-trust-hub) — Gen via skills.sh, Sep 15, 2026, accessed 2026-09-30 — scanner output.
    - "Boundary markers: There are no specific delimiters or instructions defined in the current workflow to isolate untrusted code content from the agent's core instructions."
  - [Snyk audit](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines/security/snyk) — Snyk via skills.sh, Sep 15, 2026, accessed 2026-09-30 — scanner output.
    - "No issues detected."
- **Limits / false positives:** These are automated scanner verdicts, and Socket's own text rates the finding low and "benign in intent". Verification note: the registry page labels the Gen Agent Trust Hub result "Pass", and its audit page reads "Risk Level: SAFE". Snyk's page also reads "Risk Level: LOW". Socket's metadata names the package `pkg:socket/skills-sh/vercel-labs%2Fclaude-skills%2Fweb-design-guidelines%2F@3116f3e…`, and 3116f3e is not a commit of vercel-labs/agent-skills (GitHub API 422). SKILL.md has not changed since 2026-01-16, so the March audit saw the current text.

### FD04-F22 — Other things with the same name: Rauno Freiberg's 2023 "Web Interface Guidelines", same-name skills and mirrors
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - raunofreiberg/interfaces is titled "Web Interface Guidelines" (created 2023-05-24, last push 2023-09-07, 1,946 stars, no license file; interfaces.rauno.me answers 200). Its rules are more visual than Vercel's: font weights of 400 or more, interaction animations of 200 ms or less, `pointer-events` disabled on decorative glows and gradients, and an SVG favicon that follows `prefers-color-scheme`. It contradicts Vercel on autocomplete.
  - duc01226/easy-claude ships a different skill under the same name (version 2.0.0, Apache-2.0 repo, "touch targets >= 44px").
  - fcakyon/claude-codex-settings vendors command.md as `references/web-interface-guidelines.md` (7,760 bytes, refreshed 2026-08-27, curly quotes correct).
  - At least four GitHub repositories mirror the Vercel skill with its exact description (Aston1690, yangcyyang, youngbeom-shin, arslan-36), and iizcm/web-design-guidelines-skill describes itself as "AI Agent Skill: web-design-guidelines".
  - daniel-scrivner/ui-guidelines-review is a Claude-based GitHub Action that fetches the guidelines at run time and never fails a build.
- **Implication for /frontend:** When the owner says "web design guidelines", it means the Vercel pair. Rauno's list has visual rules relevant to tell 13 (decorative glows) and to the logo scope (theme-aware SVG favicon). It has no license, so /frontend may cite it but not copy it. A pinned, vendored copy is already common practice (fcakyon).
- **Evidence:**
  - [raunofreiberg/interfaces README](https://github.com/raunofreiberg/interfaces/blob/HEAD/README.md) — Rauno Freiberg, last commit 2023-06-06, accessed 2026-09-30 — the tool's own file.
    - "Inputs should disable `spellcheck` and `autocomplete` attributes most of the time"
    - "Font weights below 400 should not be used"
    - "Animation duration should not be more than 200ms for interactions to feel immediate"
    - "Decorative elements (glows, gradients) should disable `pointer-events` to not hijack events"
    - "Use a svg favicon with a style tag that adheres to the system theme based on `prefers-color-scheme`"
  - OBSERVED: `gh api repos/raunofreiberg/interfaces` → "created_at":"2023-05-24T04:10:36Z", "pushed_at":"2023-09-07T17:56:26Z", "stargazers_count":1946, license null.
  - [duc01226/easy-claude web-design-guidelines SKILL.md](https://github.com/duc01226/easy-claude/blob/main/.claude/skills/web-design-guidelines/SKILL.md) — duc01226, pushed 2026-09-30, accessed 2026-09-30 — third-party skill file.
    - "version: 2.0.0" · "**Touch/Mobile** -- touch targets >= 44px, `touch-action: manipulation`, safe areas"
  - OBSERVED: `gh api .../fcakyon/claude-codex-settings/contents/plugins/react-skills/skills/web-design-guidelines/references` → "file 7760 .../references/web-interface-guidelines.md"; last commit "a28ba939b9 2026-08-27 build: refresh skills for 2.7.0 (#292)".
  - OBSERVED: `gh search repos "web interface guidelines"` and `gh search repos "web-design-guidelines"` → the mirrors above and daniel-scrivner/ui-guidelines-review ("GitHub Actions workflow that reviews frontend code against Vercel's Web Interface Guidelines using Claude AI. Non-blocking").
- **Limits / false positives:** A search engine index listed a same-name skill at akillness/jeo-skills; that path returns 404 today and was not counted.

### FD04-F23 — WIG's evidence base is practitioner assertion: no measurements, and 7 rules lean on X posts
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The README's links resolve to x.com 11 times: 7 status posts (6 by JohnPhamous, 1 by emilkowalski_) and 4 profiles in the thanks line. It links w3.org 5 times, developer.mozilla.org 3, web.dev 2, vercel.com 2, github.com 2, and 15 other hosts once each. No rule reports a measurement. Of the numeric thresholds, only ">5 seconds" links to a W3C source. The ±1 px optical nudge links to an X post by John Pham ("[Adjust ±1px](https://x.com/JohnPhamous/status/1760444698857230360)"), so its source is a practitioner post. The 24, 44 and 16 px targets, the 150 to 300 ms and 300 to 500 ms loading times and the 500 ms mutation budget carry no link. The >50-item list threshold is not in the README: it appears only in AGENTS.md ("Virtualize large lists (>50 items)") and command.md, with no link either. (corrected: vercel.com and github.com are linked twice each, not once; the ±1 px rule cites an X post rather than nothing; the >50 threshold comes from AGENTS.md and command.md, not the README)
- **Implication for /frontend:** A /frontend rule that rests on WIG alone is grade C (practitioner assertion). Re-source it to W3C, MDN or the engine vendor where possible, as done here for zoom, contrast, target size, pause-stop-hide and tap delay, and calibrate thresholds on the control corpus.
- **Evidence:**
  - OBSERVED: `grep -o -E '\]\((https?://[^)]+)\)' README.md | ... | uniq -c` → "11 x.com", "5 www.w3.org", "3 developer.mozilla.org", "2 web.dev", "2 vercel.com", "2 github.com", then 15 hosts at 1 (corrected: the two hosts at 2 were missing); x.com status links: JohnPhamous 1657083267299028992, 1831380516509278561, 1760444698857230360, 1636427186566762496, 1816160187839107342, 1724491202148675590; emilkowalski_ 1962500739336462340.
  - [README.md line 45](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — Vercel Labs, e3d624b, accessed 2026-09-30 — the tool's own file.
    - "Automatically playing motion lasting [>5 seconds](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) alongside other content has pause, stop, or hide controls."
- **Limits / false positives:** The X posts were not opened (x.com needs a login), so their content is not assessed.

### FD04-F24 — Implementation facts for the deterministic checks
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - (a) In Tailwind, `transition-all` compiles to `transition-property: all`, while plain `transition` lists explicit properties. A static match on `transition-all` or `transition: all` finds only the explicit forms. The `transition` shorthand without a property name, such as `transition: 0.2s ease` in plain CSS or an arbitrary value, also computes to `all`, because `transition-property` has initial value `all`. So the static check misses those forms and the rendered check (computed `transition-property: all` with a duration above 0) is the complete one (C31). (corrected: "exact for Tailwind code" overclaimed; the shorthand's implicit `all` escapes a literal regex)
  - (b) Next.js sets viewport, theme colour and colour scheme through `export const viewport`, and `colorScheme: 'dark'` emits `<meta name="color-scheme" content="dark">`. Static checks must read `viewport` exports, and the C71 rendered check must accept the meta tag as well as CSS.
  - (c) vercel.com/design/guidelines satisfies C10 through `scroll-padding-top: 64px` on `html`, while none of its 13 anchored headings sets `scroll-margin-top`. The check must accept either.
  - (d) Playwright's `reducedMotion: 'reduce'` combined with `document.getAnimations()` gives a before/after count (linear.app: 105 to 76; 96 to 76 on a re-run at 20:28Z, so the no-preference count varies between loads).
  - (e) axe's best-practice rules run only when requested. A WCAG-only tag list, as /harden uses, skips them. Request them by rule ID for a targeted run, or with the `best-practice` tag for all of them. (corrected: rule ID is not the only way; axe's API.md lists `best-practice` as a runOnly tag)
  - (f) Injecting axe with `addScriptTag` failed on stripe.com under its Content Security Policy, and `page.evaluate(source)` worked.
- **Implication for /frontend:** Use these as design notes for the checker.
- **Evidence:**
  - [transition-property](https://tailwindcss.com/docs/transition-property) — Tailwind Labs, live docs, accessed 2026-09-30 — official docs.
    - Class `transition-all`, styles "transition-property: all;"
    - Class `transition`, styles "transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to, opacity, box-shadow, transform, translate, scale, rotate, filter, -webkit-backdrop-filter, backdrop-filter, display, content-visibility, overlay, pointer-events;"
  - [generateViewport (markdown)](https://nextjs.org/docs/app/api-reference/functions/generate-viewport.md) — Vercel (Next.js docs), version 16.3.7, accessed 2026-09-30 — official docs.
    - `colorScheme: 'dark',` with `<head>` output `<meta name="color-scheme" content="dark" />`
  - OBSERVED: wig-axe-probe.mjs → vercel.com/design/guidelines "htmlScrollPaddingTop":"64px"; wig-probe.mjs → "headingsWithId":13,"headingsWithIdAndScrollMargin":0; linear.app "runningAnimations":{"no-preference":105,"reduce":76}; stripe.com first run "page.addScriptTag: Executing inline script violates the following Content Security Policy directive".
  - [CSS Transitions Module Level 1](https://www.w3.org/TR/css-transitions-1/) — W3C, Working Draft 8 January 2026, accessed 2026-09-30 — standard (added at verification).
    - Property table: "Name: transition-property Value: none | <single-transition-property> # Initial: all"
  - [axe-core doc/API.md](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/API.md) — Deque, v4.13.0, accessed 2026-09-30 — tool docs (added at verification).
    - "| `best-practice` | Common accessibility best practices |"; "`runOnly` | n/a | Limit which rules are executed, based on names or tags"
  - OBSERVED at verification: the axe probe re-run with an `addScriptTag({ content })` attempt first (2026-09-30T20:29Z) → stripe.com "page.addScriptTag: Executing inline script violates the following Content Security Policy directive 'script-src https://b.stripecdn.com …'", then `page.evaluate(axeSrc)` loaded axe 4.11.2. The other three pages accepted `addScriptTag`.
- **Limits / false positives:** The Tailwind page did not show a version marker; the property list is from the live docs on 2026-09-30.

### FD04-F25 — Untouched shadcn buttons trip WIG's C31, and their hover fade is invisible to an opacity probe
- **Grade:** A · **Kind:** OBSERVED (source files) and MEASURED (rendered contrast) · **Verdict:** added at verification
- **Claim:** In shadcn-ui/ui at main b0fcb58, the new-york-v4 Button's base class contains `transition-all`, and so do the three `bases` variants (radix, base, aria). Tailwind compiles `transition-all` to `transition-property: all` (F24a), so C31 fires on every untouched shadcn button, both statically and in a rendered check. The default variant hovers with `hover:bg-primary/90`. Tailwind v4.3.3's `withAlpha` compiles an alpha modifier to `color-mix(in oklab, <color> <alpha>, transparent)`, so the hover changes the alpha of the background colour, not the element's `opacity`. I rendered shadcn's current neutral tokens in headless Chromium 147. In light mode, text-to-button contrast fell from 17.18:1 at rest to 13.01:1 at `/90` (button rgb 23 to 46 over white, text rgb 250). In dark mode it fell from 14.23:1 to 11.62:1 (rgb 229 to 208, text rgb 23). Computed `opacity` stayed "1" in every state. This hover lowers contrast, the opposite of C82's "Interactive states increase contrast", and it is an instance of tell 14.
- **Implication for /frontend:** A tell-14 check must compare rendered text-to-background contrast before and after hover, from pixels or composited colours, not the `opacity` property; the F14 probe would stay silent here. Both contrasts stay far above 4.5:1, so neither axe nor /harden will ever flag this hover. C31 plus shadcn's class fingerprint can help flag tell 11. C31 alone cannot gate, because it also fired on 3 of 4 human controls (F13).
- **Evidence:**
  - [apps/v4/registry/new-york-v4/ui/button.tsx](https://github.com/shadcn-ui/ui/blob/b0fcb58a6e7c4df1a88f7f6327b083592c2dfd9c/apps/v4/registry/new-york-v4/ui/button.tsx) — shadcn, main b0fcb58 (file last changed 2026-09-04 in c257f68), accessed 2026-09-30 — source code.
    - `"inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none …"` · `default: "bg-primary text-primary-foreground hover:bg-primary/90",`
    - OBSERVED: `transition-all` also appears in `apps/v4/registry/bases/radix/ui/button.tsx`, `bases/base/ui/button.tsx` and `bases/aria/ui/button.tsx` at the same commit.
  - [apps/v4/registry/themes.ts](https://github.com/shadcn-ui/ui/blob/b0fcb58a6e7c4df1a88f7f6327b083592c2dfd9c/apps/v4/registry/themes.ts) — shadcn, b0fcb58, accessed 2026-09-30 — source code (neutral theme).
    - light: `background: "oklch(1 0 0)"`, `primary: "oklch(0.205 0 0)"`, `"primary-foreground": "oklch(0.985 0 0)"`; dark: `background: "oklch(0.145 0 0)"`, `primary: "oklch(0.922 0 0)"`, `"primary-foreground": "oklch(0.205 0 0)"`
  - [packages/tailwindcss/src/utilities.ts](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/packages/tailwindcss/src/utilities.ts) — Tailwind Labs, v4.3.3 (released 2026-07-16), accessed 2026-09-30 — source code.
    - In `withAlpha`: `` return `color-mix(in oklab, ${value} ${alpha}, transparent)` ``. OBSERVED path: the `bg` utility calls `resolveThemeColor`, which returns `asColor(value, candidate.modifier, theme)`, which for a bare modifier such as `90` returns `` withAlpha(value, `${modifier.value}%`) ``.
  - [background-color](https://tailwindcss.com/docs/background-color) — Tailwind Labs, live docs, accessed 2026-09-30 — official docs.
    - "Use the color opacity modifier to control the opacity of an element's background color"
  - OBSERVED: `swatch.mjs` (verification scratch folder; playwright-core 1.59.1, headless Chromium 147.0.7727.15; 2026-09-30) renders the neutral tokens with and without `color-mix(in oklab, <primary> 90%, transparent)` and reads the screenshot pixels → light "rest (23, 23, 23), hover (46, 46, 46), fg (250, 250, 250), contrast rest 17.18 hover 13.01"; dark "rest (229, 229, 229), hover (208, 208, 208), fg (23, 23, 23), contrast rest 14.23 hover 11.62"; computed hover background "oklab(0.205 0 0 / 0.9)", computed `opacity` "1".
- **Limits / false positives:** The swatches model colour only: no text rendering and no transition timing. The numbers hold for the neutral theme; other base colours or edited tokens change them. No real untouched-shadcn page was probed, and how often this pattern appears in the owner's past frontends was not measured. Other variants hover differently: `secondary` uses `/80`, and `outline` and `ghost` switch to the accent colour.

### FD04-F26 — The zoom dispute splits by platform: iOS Safari always allows pinch-zoom, while Chrome for Android lets pages block it unless the user turns on "Force enable zoom"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** added at verification
- **Claim:** Apple's Safari 10.0 release notes say: "Pinch-to-zoom is always enabled for all users. The viewport setting for user-scalable is ignored." Google's Chrome Help page for Android says: "To zoom in on pages that prevent zoom, turn on Force enable zoom." On iOS, then, a zoom-disabling viewport does not stop pinch-zoom, which fits the maintainer's "It did not prevent a user from zooming" in issue #11. On Chrome for Android, pages can prevent zoom by default, and only users who find the accessibility setting get it back, which fits the Android report in the same issue. Neither vendor page names `maximum-scale`: Apple names `user-scalable` and says pinch-to-zoom is always on, and Google says "pages that prevent zoom" without naming the mechanism.
- **Implication for /frontend:** WIG's `maximum-scale=1` alternative is not harmless. By Google's own help text, Chrome for Android lets a page prevent zoom by default. /frontend handles iOS focus-zoom with inputs of 16 px or more and never emits `maximum-scale` or `user-scalable` (F07). axe and /harden fail those tags anyway.
- **Evidence:**
  - [What's New in Safari: Safari 10.0](https://developer.apple.com/library/archive/releasenotes/General/WhatsNewInSafari/Articles/Safari_10_0.html) — Apple, Documentation Archive (page "Updated: 2018-02-22"), accessed 2026-09-30 — vendor release notes.
    - "Accessibility Pinch-to-zoom is always enabled for all users. The viewport setting for user-scalable is ignored."
  - [Change text, image & video sizes (zoom), Android](https://support.google.com/chrome/answer/96810?hl=en&co=GENIE.Platform%3DAndroid) — Google Chrome Help, undated, accessed 2026-09-30 — vendor help.
    - "Next to “Default zoom,” move the slider until you can read the preview text comfortably. To zoom in on pages that prevent zoom, turn on Force enable zoom." ("Force enable zoom" is set in bold on the page)
- **Limits / false positives:** No device test. Apple's note belongs to the Safari 10.0 release and was not re-checked against later Safari versions. Google's page does not say which viewport values Chrome treats as preventing zoom, so the link to `maximum-scale=1` specifically still rests on the issue #11 report (grade D).

## Contradictions between sources

1. **Zoom.** README line 11 offers `maximum-scale=1` as an alternative. README line 12, AGENTS.md line 16 and command.md line 153 forbid it. axe `meta-viewport` (wcag2aa) fails it. The maintainer reports no zoom block in his tests, and a user reports a block on Chrome 144 and Firefox 149 on Android 16 (issue #11, closed as not_planned). Vercel's own pages ship it. (F07) The vendor documents fit both reports: Apple says iOS Safari always allows pinch-zoom and ignores `user-scalable`, and Google says Chrome for Android pages can prevent zoom unless the user turns on "Force enable zoom". (F26, added at verification)
2. **Contrast metric.** WIG prefers APCA. WCAG 2.2 SC 1.4.3, axe `color-contrast`, /harden FE-18 and Claude Design use 4.5:1. The WCAG 3 draft of 10 Sep 2026 says the algorithm "is yet to be determined". (F08)
3. **Target size.** WIG: 24 px, 44 px on mobile. WCAG 2.2: 24 px at AA, 44 px at AAA. Claude Design: 44 px everywhere. /harden gates on axe's 24 px. (F09)
4. **Title Case.** command.md applies it to all headings and buttons. The README scopes it to Vercel's brand and exempts marketing pages. Vercel's writing guidelines flag Title Case in H1 to H6. (F06)
5. **"&" over "and".** The README says it without condition. command.md and the writing guidelines add "where space-constrained". (F06)
6. **Em dashes.** WIG's example copy and its agent files use them (about 6.7 to 7.6 per 1,000 words in command.md, depending on the tokenizer). Vercel's writing guidelines forbid them as punctuation. (F19) (corrected: the single figure 6.68 did not reproduce)
7. **Autofocus.** README line 27: "On desktop screens with a single primary input, autofocus." jsx-a11y `no-autofocus` ("Enforce autoFocus prop is not used."), which is in the `recommended` config /harden runs, flags every `autoFocus`. (C67)
8. **Suspense.** WIG says Suspense adds a show-delay and a minimum duration. React's docs say new boundaries show fallbacks immediately and urgent updates are not delayed. (F16)
9. **Autocomplete.** Vercel WIG: "Set `autocomplete` & meaningful `name` values to enable autofill." Rauno Freiberg's same-name guidelines: "Inputs should disable `spellcheck` and `autocomplete` attributes most of the time". (F22)
10. **Verification.** WIG AGENTS.md line 84: "MUST: Verify mobile, laptop, ultra-wide (simulate ultra-wide at 50% zoom)". Claude Design's Design type SKILL.md (release 1790780428-0f80): "**NEVER VERIFY UNLESS THE USER ASKED**, mid-run or after. Do NOT read it or your files back to check, re-check layout or sizes, render, screenshot or open it (no Playwright, browser, installs)". The Claude Design rule governs its canvas artifacts, not a built site, so /frontend should verify the site with Playwright and keep that loop out of the canvas.
11. **Placeholders.** README line 102: "**Placeholders signal emptiness.** End with an ellipsis." Line 103's first example, `+1 (123) 456-7890`, has none; its second, `sk-012345679…`, does. (corrected: the line holds two examples, and only the first contradicts line 102)
12. **Catalogue descriptions.** agentcookbooks.com says findings are "grouped by theme" and each "includes the why and a fix pattern". command.md says "Group by file" and "Skip explanation unless fix non-obvious". (F05)
13. **Vercel's pages against Vercel's MUST rules.** vercel.com/design/guidelines ships `maximum-scale=1` against the NEVER, `transition: all` on 3 elements against the NEVER, and a dark theme with computed `color-scheme: normal` against the MUST. (F13)
14. **`touch-action: manipulation`.** AGENTS.md makes it a MUST to prevent the double-tap delay. WebKit removed that delay in 2015 for `width=device-width` pages at initial scale. (F15)

## What could not be found, and how it was searched

- **A measurement of the skill's precision or recall, or of WIG's effect on UI quality.** None found. Searched: both repositories' files, all 28 issues and PRs of web-interface-guidelines (`gh api .../issues?state=all`), the agent-skills README, the skills.sh page and its three audit pages, and an Exa search for reviews of the skill. The catalogue pages found (agentcookbooks.com, claudemarketplace.net, agenticskills.io) restate SKILL.md and add no data.
- **Why command.md leaves out the Design section.** No commit message or issue gives a reason. command.md was introduced whole in 30abf89 (2026-01-12, "Add slash command and multi-tool installer"). That commit's body declares the file's scope as "Covers a11y, forms, animation, perf, i18n, anti-patterns", with no design or layout. (corrected at verification: the scope statement exists; a reason does not)
- **The content of the X posts WIG cites** (6 by John Pham, 1 by Emil Kowalski on tooltip timing). Not opened: x.com requires a login. The rules citing them are treated as assertions.
- **Android behaviour of `maximum-scale=1`.** Not tested (no device). Verification found vendor documents for both platforms (F26). Apple says iOS Safari ignores `user-scalable` and always allows pinch-zoom. Google says Chrome for Android pages can prevent zoom unless the user turns on "Force enable zoom". Neither names `maximum-scale=1`, so the value-level behaviour still rests on the issue comments.
- **Chromium's removal of the double-tap delay.** Not opened in a primary source; only WebKit's post was.
- **Evidence that AI-generated frontends break WIG rules more often than human sites.** Not found. The owner's past hackathon frontends were not probed: no URLs were in scope, and the method forbids running projects.
- **akillness/jeo-skills `web-design-guidelines`.** Exa returned it at `.agent-skills/web-design-guidelines/SKILL.md`. That path returns 404, and the repository tree (checked with `gh api .../git/trees/main?recursive=1`) has `.agent-skills/web-design/` instead. Not counted.

## Weak spots of this dossier

- The S/R/J classification (F11, Appendices A and B) and the tell mapping (F12, Appendix C) are my judgement from the rule text, graded B. The /harden overlap mapping (F10) is judgement too; verification lowered it to B after finding one mislabelled row (C66).
- The control probe covers 4 pages, one load each, one Chromium build (147) at 1440 x 900 plus a 390 x 844 emulation. Several counters are naive: bounding boxes, a button-like selector for hover, and focus judged by outline or box-shadow only. The probe loaded playwright-core 1.59.1 and axe-core 4.11.2 from another project's node_modules on this machine. The rule definitions cited are axe 4.13.0. Pages change with each deploy.
- No positive corpus was measured. F14 shows the hover rule is silent on controls, not that it fires on slop.
- One WebFetch trial (F03). A different prompt might relay the quotes correctly.
- Word counts for em-dash density use a simple tokenizer.
- Install counts, stars and audit verdicts are dated snapshots from 2026-09-30.
- The probe scripts and raw JSON sit in the scratch folder (`scratchpad/research/tool-web-design-guidelines/`: wig-probe.mjs, wig-axe-probe.mjs, wig-probe-results.json, wig-axe-probe-results.json, gen_appendix.py). They may be cleaned up with the session.

## Appendix A — command.md rule by rule (what the skill applies)

Classes: S means a static source check (regex or AST) decides; R means a rendered-page check in Playwright (computed style, geometry, events, network, media emulation) decides; J means judgement decides, even where a script can list candidates. "/harden overlap" names the rule of `~/.claude/skills/harden/references/lens-frontend.md` that already covers it. Rows with "-" in the first column are anti-pattern bullets that restate an earlier rule. Source: command.md at e3d624b, parsed in file order by `gen_appendix.py`. Totals: 90 distinct rules; S 34, R 30, J 26; /harden overlap 13 strong, 6 partial, 71 none. (corrected at verification: C66 moved from strong to partial, see F10)

| # | Section | Rule text in command.md (verbatim) | Class | /harden overlap | How to check / caveat |
|---|---|---|---|---|---|
| C01 | Accessibility | Icon-only buttons need `aria-label` | S | FE-18/FE-19 (axe `button-name`; jsx-a11y) | AST: button whose only child is an icon/svg and no accessible name |
| C02 | Accessibility | Form controls need `<label>` or `aria-label` | R | FE-18/FE-19 (axe `label`, `select-name`; jsx-a11y `label-has-associated-control`) | axe sees through custom components; static lint does not |
| C03 | Accessibility | Interactive elements need keyboard handlers (`onKeyDown`/`onKeyUp`) | S | FE-19/FE-20 (jsx-a11y `click-events-have-key-events`) |  |
| C04 | Accessibility | `<button>` for actions, `<a>`/`<Link>` for navigation (not `<div onClick>`) | S | FE-19/FE-20 (grep `<(div\|span)[^>]*onClick`; jsx-a11y `no-static-element-interactions`) | action vs navigation needs reading the handler |
| C05 | Accessibility | Images need `alt` (or `alt=""` if decorative) | S | FE-18/FE-19 (axe `image-alt`; jsx-a11y `alt-text`) | decorative vs informative is judgement (FE-19 reports it) |
| C06 | Accessibility | Decorative icons need `aria-hidden="true"` | J | - | finder: icon inside a control that already has visible text, without aria-hidden |
| C07 | Accessibility | Async updates (toasts, validation) need `aria-live="polite"` | J | - | finder: toast/validation regions without aria-live/role=status; needs scripted UI states |
| C08 | Accessibility | Use semantic HTML (`<button>`, `<a>`, `<label>`, `<table>`) before ARIA | S | FE-20 | grep role="button\|link\|checkbox" on non-native elements |
| C09 | Accessibility | Headings hierarchical `<h1>`–`<h6>`; include skip link for main content | R | partial: FE-18 runs axe `bypass` (wcag2a); `heading-order` and `skip-link` are best-practice rules outside harden's tag set | verification: axe `skip-link` only tests existing skip links and `bypass` passes on headings or landmarks, so "include skip link" needs a custom check |
| C10 | Accessibility | `scroll-margin-top` on heading anchors | R | - | accept `scroll-padding-top` on the scroller as equivalent (vercel.com/design/guidelines uses 64px) |
| C11 | Accessibility | Meaningful media needs captions, transcripts, or descriptions as applicable | S | FE-18 (axe `video-caption`; jsx-a11y `media-has-caption`) | "meaningful" is judgement |
| C12 | Accessibility | Media controls need keyboard support; decorative media needs assistive-tech hiding | J | partial: FE-18 | finder: keyboard-operate each media control |
| C13 | Focus States | Interactive elements need visible focus: `focus-visible:ring-*` or equivalent | R | - | Tab through; compare focused vs unfocused outline/box-shadow/border/background |
| C14 | Focus States | Never `outline-none` / `outline: none` without focus replacement | S | - | class list or CSS rule with outline-none and no focus-visible ring/outline |
| C15 | Focus States | Use `:focus-visible` over `:focus` (avoid focus ring on click) | S | - | grep `focus:ring\|focus:outline\|:focus {` without -visible |
| C16 | Focus States | Group focus with `:focus-within` for compound controls | J | - | which controls are compound |
| C17 | Focus States | Sticky headers/footers/overlays must not cover the focused element | R | FE-21 (2.4.11, reported after a manual tab-through) | WIG asks for no overlap at all, closer to AAA 2.4.12 than AA 2.4.11 |
| C18 | Forms | Inputs need `autocomplete` and meaningful `name` | S | - | axe `autocomplete-valid` only validates values that exist |
| C19 | Forms | Use correct `type` (`email`, `tel`, `url`, `number`) and `inputmode` | J | - | finder: name/label mentions email/phone/url/amount while type=text |
| C20 | Forms | Never block paste (`onPaste` + `preventDefault`) | S | - | AST: onPaste handler calling preventDefault |
| C21 | Forms | Labels clickable (`htmlFor` or wrapping control) | S | FE-18/FE-19 (jsx-a11y `label-has-associated-control`) | R: click the label, activeElement is the control |
| C22 | Forms | Disable spellcheck on emails, codes, usernames (`spellCheck={false}`) | S | - | type=email or autocomplete email/username/one-time-code without spellCheck={false} |
| C23 | Forms | Checkboxes/radios: label + control share single hit target (no dead zones) | R | - | geometry: gap between the box of the input and of its label |
| C24 | Forms | Submit button stays enabled until request starts; spinner during request | R | - | S finder: disabled={!isValid}; spinner needs a delayed network stub |
| C25 | Forms | Errors inline next to fields; focus first error on submit | R | - | submit an invalid form; activeElement must be the first invalid field |
| C26 | Forms | Placeholders end with `…` and show example pattern | S | - | ellipsis part is mechanical; "example pattern" is judgement |
| C27 | Forms | `autocomplete="off"` on non-auth fields to avoid password manager triggers | J | - | which fields are non-auth |
| C28 | Forms | Warn before navigation with unsaved changes (`beforeunload` or router guard) | J | - | which forms hold data worth guarding |
| C29 | Animation | Honor `prefers-reduced-motion` (provide reduced variant or disable) | R | - | emulate reducedMotion reduce; diff document.getAnimations() running counts |
| C30 | Animation | Animate `transform`/`opacity` only (compositor-friendly) | S | - | CSS transition-property/keyframes naming width\|height\|top\|left\|margin; motion animate={{ width }} |
| C31 | Animation | Never `transition: all`—list properties explicitly | S | - | regex `transition(-property)?:\s*all\|\btransition-all\b` (Tailwind `transition` lists explicit properties); verification: the shorthand without a property (`transition: 0.2s`) also computes to `all`, which the regex misses, so confirm with the rendered computed-style check; fires on every untouched shadcn Button (F25) |
| C32 | Animation | Set correct `transform-origin` | J | - |  |
| C33 | Animation | SVG: transforms on `<g>` wrapper with `transform-box: fill-box; transform-origin: center` | R | - | computed transform-box on animated SVG children |
| C34 | Animation | Animations interruptible—respond to user input mid-animation | J | - |  |
| C35 | Animation | Autoplay motion >5 seconds alongside other content needs pause, stop, or hide controls | R | - | infinite or >5 s running animations and autoplay video after load; adequacy of the control is judgement |
| C36 | Animation | Muted decorative loops must stop under `prefers-reduced-motion` | R | - | under reduce: video.paused and no infinite animations |
| C37 | Typography | `…` not `...` | S | - | JSX text nodes and rendered string literals only; a raw regex hits `{...props}` spread syntax |
| C38 | Typography | Curly quotes `“` `”` not straight `"` | S | - | JSX text nodes; apostrophes are out of the rule text |
| C39 | Typography | Non-breaking spaces: `10&nbsp;MB`, `⌘&nbsp;K`, brand names | S | - | number + space + unit, shortcut glyph + space; brand names need a list |
| C40 | Typography | Loading states end with `…`: `"Loading…"`, `"Saving…"` | S | - | `(Loading\|Saving\|Generating\|Submitting)(\.\.\.)?` without the ellipsis character |
| C41 | Typography | `font-variant-numeric: tabular-nums` for number columns/comparisons | R | - | numeric table cells or stat lists: computed font-variant-numeric or a monospace family |
| C42 | Typography | Use `text-wrap: balance` or `text-pretty` on headings (prevents widows) | R | - | computed text-wrap on h1-h3; Tailwind text-balance/text-pretty |
| C43 | Content Handling | Text containers handle long content: `truncate`, `line-clamp-*`, or `break-words` | R | - | fixtures with long strings; scrollWidth > clientWidth |
| C44 | Content Handling | Flex children need `min-w-0` to allow text truncation | R | - | flex item containing truncated text whose min-width stays auto |
| C45 | Content Handling | Handle empty states—don't render broken UI for empty strings/arrays | J | - | R finder: render with empty fixtures |
| C46 | Content Handling | User-generated content: anticipate short, average, and very long inputs | J | - | R finder: short/average/very long fixtures |
| C47 | Images | `<img>` needs explicit `width` and `height` (prevents CLS) | S | - | `<img>` without width and height; `next/image` without fill |
| C48 | Images | Below-fold images: `loading="lazy"` | R | - | img whose top is below the first viewport without loading=lazy |
| C49 | Images | Above-fold critical images: `priority` or `fetchpriority="high"` | R | - | LCP element (PerformanceObserver) must carry fetchpriority=high/priority |
| C50 | Performance | Large lists (>50 items): virtualize (`virtua`, `content-visibility: auto`) | R | - | >50 repeated siblings without virtualization or content-visibility |
| C51 | Performance | No layout reads in render (`getBoundingClientRect`, `offsetHeight`, `offsetWidth`, `scrollTop`) | S | partial: FE-11 (render purity) | AST: call in the component body, outside effects and handlers |
| C52 | Performance | Batch DOM reads/writes; avoid interleaving | J | - | R finder: forced-reflow entries in a performance trace |
| C53 | Performance | Prefer uncontrolled inputs; controlled inputs must be cheap per keystroke | J | partial: FE-17 (profiler evidence) |  |
| C54 | Performance | Add `<link rel="preconnect">` for CDN/asset domains | R | - | third-party origins of critical requests vs `<link rel="preconnect">` |
| C55 | Performance | Critical fonts: `<link rel="preload" as="font">` with `font-display: swap` | R | - | CSSOM @font-face font-display and preload links (next/font does both) |
| C56 | Performance | Prefer `<video autoplay muted loop playsinline>` over animated GIF; provide a still alternative | S | - | .gif assets referenced from source |
| C57 | Performance | Short non-essential loops: Safari H.264 MP4 `<picture>` source, `prefers-reduced-motion` media condition, and still fallback | J | - |  |
| C58 | Navigation & State | URL reflects state—filters, tabs, pagination, expanded panels in query params | R | - | click role=tab / aria-expanded / filter controls; location must change |
| C59 | Navigation & State | Links use `<a>`/`<Link>` (Cmd/Ctrl+click, middle-click support) | S | partial: FE-19/FE-20 (jsx-a11y `anchor-is-valid`) | onClick calling router.push/window.location on a non-anchor |
| C60 | Navigation & State | Deep-link all stateful UI (if uses `useState`, consider URL sync via nuqs or similar) | J | - | "anytime useState is used" is broader than any check |
| C61 | Navigation & State | Destructive actions need confirmation modal or undo window—never immediate | J | - | finder: handlers named delete/remove/revoke without confirm or undo |
| C62 | Touch & Interaction | `touch-action: manipulation` (prevents double-tap zoom delay) | R | - | computed touch-action; see F15 on the obsolete rationale |
| C63 | Touch & Interaction | `-webkit-tap-highlight-color` set intentionally | R | - | "intentionally" is judgement |
| C64 | Touch & Interaction | `overscroll-behavior: contain` in modals/drawers/sheets | R | - | open role=dialog; computed overscroll-behavior of its scroller |
| C65 | Touch & Interaction | During drag: disable text selection, `inert` on dragged elements | J | - | R finder: scripted drag |
| C66 | Touch & Interaction | Drag/swipe/pinch/path gestures need tap/click and keyboard alternatives unless essential | J | partial: FE-21 (2.5.7 Dragging Movements, manual) | corrected at verification: pinch and path gestures fall under SC 2.5.1 Pointer Gestures (Level A), which /harden does not name |
| C67 | Touch & Interaction | `autoFocus` sparingly—desktop only, single primary input; avoid on mobile | S | FE-18 (jsx-a11y `no-autofocus`, in `recommended`) | jsx-a11y flags every autoFocus; WIG README asks for it on desktop |
| C68 | Safe Areas & Layout | Full-bleed layouts need `env(safe-area-inset-*)` for notches | S | - | viewport-fit=cover present without env(safe-area-inset-*) |
| C69 | Safe Areas & Layout | Avoid unwanted scrollbars: `overflow-x-hidden` on containers, fix content overflow | R | - | documentElement.scrollWidth > clientWidth at 320/390/768/1440 px |
| C70 | Safe Areas & Layout | Flex/grid over JS measurement for layout | J | - | finder: resize listeners writing widths |
| C71 | Dark Mode & Theming | `color-scheme: dark` on `<html>` for dark themes (fixes scrollbar, inputs) | R | - | dark background and neither computed `color-scheme: dark` nor `<meta name="color-scheme">` |
| C72 | Dark Mode & Theming | `<meta name="theme-color">` matches page background | R | - | meta theme-color vs computed html/body background |
| C73 | Dark Mode & Theming | Native `<select>`: explicit `background-color` and `color` (Windows dark mode) | S | - | a CSS rule for select setting both background-color and color |
| C74 | Locale & i18n | Dates/times: use `Intl.DateTimeFormat` not hardcoded formats | S | - | getMonth()/getDate() string building; fixed format patterns |
| C75 | Locale & i18n | Numbers/currency: use `Intl.NumberFormat` not hardcoded formats | S | - | `'$' +`, `.toFixed(` in rendered output; token amounts need decimal-safe formatting |
| C76 | Locale & i18n | Detect language via `Accept-Language` / `navigator.languages`, not IP | S | - | geo-IP lookups used for locale |
| C77 | Locale & i18n | Brand names, code tokens, identifiers: wrap with `translate="no"` to prevent garbled auto-translation | J | - | finder: protocol and sponsor names from the spec without translate="no" |
| C78 | Hydration Safety | Inputs with `value` need `onChange` (or use `defaultValue` for uncontrolled) | S | - | AST: value prop without onChange/readOnly |
| C79 | Hydration Safety | Date/time rendering: guard against hydration mismatch (server vs client) | S | FE-12 | R: console hydration errors after a production build |
| C80 | Hydration Safety | `suppressHydrationWarning` only where truly needed | J | FE-12 |  |
| C81 | Hover & Interactive States | Buttons/links need `hover:` state (visual feedback) | R | - | hover each control; any computed style change counts |
| C82 | Hover & Interactive States | Interactive states increase contrast: hover/active/focus more prominent than rest | R | - | contrast of text vs background before and after hover/focus; an opacity drop fails (owner tell 14) |
| C83 | Content & Copy | Active voice: "Install the CLI" not "The CLI will be installed" | J | - | finder: passive-voice regex on UI strings |
| C84 | Content & Copy | Title Case for headings/buttons (Chicago style) | S | - | mechanical, but README scopes it to product UI: marketing pages use sentence case |
| C85 | Content & Copy | Numerals for counts: "8 deployments" not "eight" | S | - | number words before plural nouns |
| C86 | Content & Copy | Specific button labels: "Save API Key" not "Continue" | J | - | finder: blocklist of generic labels (Continue, Submit, OK) |
| C87 | Content & Copy | Error messages include fix/next step, not just problem | J | - |  |
| C88 | Content & Copy | Second person; avoid first person | J | - | Vercel-specific in README; finder: we/our/I in UI strings |
| C89 | Content & Copy | `&` over "and" where space-constrained | J | - | README says "Prefer & over and" with no space condition |
| C90 | Anti-patterns (flag these) | `user-scalable=no` or `maximum-scale=1` disabling zoom | S | FE-18 (axe `meta-viewport`, wcag2aa, fails maximum-scale < 2 or user-scalable=no) | only rule in this list with no earlier bullet |
| - | Anti-patterns (flag these) | `onPaste` with `preventDefault` | = C20 | | |
| - | Anti-patterns (flag these) | `transition: all` | = C31 | | |
| - | Anti-patterns (flag these) | `outline-none` without focus-visible replacement | = C14 | | |
| - | Anti-patterns (flag these) | Inline `onClick` navigation without `<a>` | = C59 | | |
| - | Anti-patterns (flag these) | `<div>` or `<span>` with click handlers (should be `<button>`) | = C04 | | |
| - | Anti-patterns (flag these) | Images without dimensions | = C47 | | |
| - | Anti-patterns (flag these) | Large arrays `.map()` without virtualization | = C50 | | |
| - | Anti-patterns (flag these) | Form inputs without labels | = C02 | | |
| - | Anti-patterns (flag these) | Icon buttons without `aria-label` | = C01 | | |
| - | Anti-patterns (flag these) | Hardcoded date/number formats (use `Intl.*`) | = C74, C75 | | |
| - | Anti-patterns (flag these) | `autoFocus` without clear justification | = C67 | | |
| - | Anti-patterns (flag these) | Animated GIF when compressed video is suitable | = C56 | | |
| - | Anti-patterns (flag these) | Gesture-only action without tap/click and keyboard alternative | = C66 | | |

## Appendix B — page rules the skill never checks

The 47 rules of README.md (the text of vercel.com/design/guidelines) with no counterpart in command.md. Link targets are stripped and link text kept; sub-bullets are joined to their rule. Source: README.md at e3d624b. Totals: S 1, R 22, J 24; /harden overlap 5.

| # | README section | Rule (verbatim bold title + sentence) | Class | /harden overlap | How to check / caveat |
|---|---|---|---|---|---|
| B01 | Interactions | **Manage focus.** Use focus traps, move & return focus according to the WAI-ARIA Patterns. | R | - | open a dialog: focus moves in, Tab cycles, Escape returns focus to the trigger |
| B02 | Interactions | **Match visual & hit targets.** Exception: if the visual target is < 24px, expand its hit target to ≥ 24px. On mobile, the minimum size is 44px. | R | FE-18/FE-21 (axe `target-size`, 24 px) | 44 px mobile part is beyond harden; use axe for 24 px, not naive boxes (F09) |
| B03 | Interactions | **Mobile input size.** `<input>` font size is ≥ 16px on mobile to prevent iOS Safari auto-zoom/pan on focus. Or set `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />`. | R | - | computed font-size >= 16px at a 390 px viewport; never the maximum-scale=1 alternative (F07) |
| B04 | Interactions | **Minimum loading-state duration.** If you show a spinner/skeleton, add a short show-delay (~150–300 ms) & a minimum visible time (~300–500 ms) to avoid flicker on fast responses. The `<Suspense>` component in React does this automatically. | R | - | scripted slow and fast responses; React does not add a show-delay (F16) |
| B05 | Interactions | **Optimistic updates.** Update the UI immediately when success is likely; reconcile on server response. On failure, show an error & roll back or provide Undo. | J | - |  |
| B06 | Interactions | **Design forgiving interactions.** Controls minimize finickiness with generous hit targets, clear affordances, & predictable interactions, e.g., prediction cones. | J | - |  |
| B07 | Interactions | **Tooltip timing.** Delay the first tooltip in a group; subsequent peers have no delay. | R | - | hover first tooltip vs a peer; compare delays |
| B08 | Interactions | **Scroll positions persist.** Back/Forward restores prior scroll. | R | - | navigate, go back, compare scrollY |
| B09 | Interactions | **Locale-aware keyboard shortcuts.** Internationalize keyboard shortcuts for non-QWERTY layouts. Show platform-specific symbols. | J | - |  |
| B10 | Animations | **Implementation preference.** Prefer CSS, avoid main-thread JS-driven animations when possible. Preference: CSS > Web Animations API > JavaScript libraries e.g., motion. | J | - | finder: imports of motion/framer-motion/gsap |
| B11 | Animations | **Necessity check.** Only animate when it clarifies cause & effect or when it adds deliberate delight e.g., the northern lights. | J | - | owner tells 12 and 13 |
| B12 | Animations | **Easing fits the subject.** Choose easing based on what changes (size, distance, trigger). | J | - |  |
| B13 | Layout | **Optical alignment.** Adjust ±1px when perception beats geometry. | J | - |  |
| B14 | Layout | **Deliberate alignment.** Every element aligns with something intentionally whether to a grid, baseline, edge, or optical center. No accidental positioning. | J | - | owner tell 15; finder: left-edge clustering and off-scale spacing values |
| B15 | Layout | **Balance contrast in lockups.** When text & icons sit side by side, adjust weight, size, spacing, or color so they don’t clash. For example, a thin-stroke icon may need a bolder stroke next to medium-weight text. | J | - |  |
| B16 | Layout | **Responsive coverage.** Verify on mobile, laptop, & ultra-wide. For ultra-wide, zoom out to 50% to simulate. | R | - | screenshots and overflow checks at phone, laptop and ultra-wide widths |
| B17 | Content | **Inline help first.** Prefer inline explanations; use tooltips as a last resort. | J | - |  |
| B18 | Content | **Stable skeletons.** Skeletons mirror final content exactly to avoid layout shift. | R | - | layout-shift entries while skeletons resolve |
| B19 | Content | **Accurate page titles.** `<title>` reflects the current context. | J | partial: FE-18 (axe `document-title`, non-empty only) |  |
| B20 | Content | **No dead ends.** Every screen offers a next step or recovery path. | J | - |  |
| B21 | Content | **Redundant status cues.** Don’t rely on color alone; include text labels. | J | partial: FE-18 (axe `link-in-text-block`) |  |
| B22 | Content | **Brand resources from the logo.** Right-click the nav logo to surface brand assets for quick access. | J | - | the only logo rule in WIG |
| B23 | Forms | **Enter submits.** When a text input is focused, Enter submits if it's the only control. If there are many controls, apply to the last control. | R | - | focus the input, press Enter, observe submit |
| B24 | Forms | **Textarea behavior.** In `<textarea>`, ⌘/⌃+Enter submits; Enter inserts a new line. | R | - |  |
| B25 | Forms | **Don’t block typing.** Even if a field only accepts numbers, allow any input & show validation feedback. Blocking keystrokes entirely is confusing because the user gets no explanation. | R | - | type letters into a numeric field; value kept and a message shown |
| B26 | Forms | **Text replacements & expansions.** Some input methods add trailing whitespace. The input should trim the value to avoid showing a confusing error message. | R | - | submit a value with a trailing space |
| B27 | Performance | **Device/browser matrix.** Test iOS Low Power Mode & macOS Safari. | J | - | process; Playwright WebKit covers part of it |
| B28 | Performance | **Measure reliably.** Disable extensions that add overhead or change runtime behavior. | J | - | process |
| B29 | Performance | **Track re-renders.** Minimize & make re-renders fast. Use React DevTools or React Scan. | R | FE-17 | React DevTools / React Scan |
| B30 | Performance | **Throttle when profiling.** Test with CPU & network throttling. | J | - | process |
| B31 | Performance | **Network latency budgets.** `POST/PATCH/DELETE` complete in <500ms. | R | - | request durations of POST/PATCH/DELETE in a HAR |
| B32 | Performance | **Subset fonts.** Ship only the code points/scripts you use via unicode-range (limit variable axes to what you need) to shrink size. | R | - | font file sizes and unicode-range |
| B33 | Performance | **Don’t use the main thread for expensive work.** Move especially long tasks to Web Workers to avoid blocking interaction with the page. | R | - | long tasks via PerformanceObserver |
| B34 | Design | **Layered shadows.** Mimic ambient + direct light with at least two layers. | R | - | count layers in computed box-shadow |
| B35 | Design | **Crisp borders.** Combine borders & shadows; semi-transparent borders improve edge clarity. | J | - | owner tell 5 (WIG points the other way: neutral, semi-transparent borders) |
| B36 | Design | **Nested radii.** Child radius ≤ parent radius & concentric so curves align. | R | - | child radius <= parent radius (minus padding) on nested rounded boxes |
| B37 | Design | **Hue consistency.** On non-neutral backgrounds, tint borders/shadows/text toward the same hue. | R | - | hue of border/shadow/text vs a chromatic background |
| B38 | Design | **Accessible charts.** Use color-blind-friendly palettes. | R | - | CVD simulation of series colours |
| B39 | Design | **Minimum contrast.** Prefer APCA over WCAG 2 for more accurate perceptual contrast. | R | FE-18 (axe `color-contrast`, WCAG 2) and FE-21 (report) | APCA preference conflicts with the WCAG 2 gate (F08) |
| B40 | Design | **Text anti-aliasing & transforms.** Scaling text can change smoothing. Prefer animating a wrapper instead of the text node. If artifacts persist set `translateZ(0)` or `will-change: transform` to promote to its own layer. | J | - |  |
| B41 | Design | **Avoid gradient banding.** Fading content to dark colors using css masks can cause banding. Background images can be used instead. | J | - |  |
| B42 | Copywriting | **Be clear & concise.** Use as few words as possible. | J | - | owner tell 17 |
| B43 | Copywriting | **Action-oriented language.** Instead of _“You will need the CLI…”_ say _“Install the CLI…”_. | J | - |  |
| B44 | Copywriting | **Keep nouns consistent.** Introduce as few unique terms as possible. | J | - | finder: glossary from the spec |
| B45 | Copywriting | **Use consistent placeholders.** Strings: `YOUR_API_TOKEN_HERE`. Numbers: `0123456789`. | S | - | regex for `<TOKEN>`, `xxx`, `your-token` style placeholders |
| B46 | Copywriting | **Consistent currency formatting.** In any given context, display currency with either 0 or 2 decimal places, never mix both. | R | - | decimals of currency strings per page; token amounts are a different case |
| B47 | Copywriting | **Default to positive language.** Frame messages in an encouraging, problem-solving way, even for errors. Instead of _“Your deployment failed,”_ say _“Something went wrong—try again or contact support.”_ | J | - |  |

## Appendix C — the owner's 20 tells against WIG

| # | Tell | WIG text (verbatim) | Where | Relation |
|---|---|---|---|---|
| 1 | purple-to-blue gradient | none | - | silent |
| 2 | gradient hero text | none | - | silent |
| 3 | emojis in headings | none | - | silent |
| 4 | Inter font everywhere | none (vercel.com/design/guidelines itself lists Inter as a fallback; linear.app uses Inter Variable) | - | silent; a rule would fire on a control |
| 5 | colored border cards | "**Crisp borders.** Combine borders & shadows; semi-transparent borders improve edge clarity." · "**Hue consistency.** On non-neutral backgrounds, tint borders/shadows/text toward the same hue." | README, AGENTS (B35, B37) | partial, page-only |
| 6 | glassmorphism cards | none | - | silent |
| 7 | low-contrast dark mode | "`color-scheme: dark` on `<html>` for dark themes (fixes scrollbar, inputs)" · "**Minimum contrast.** Prefer APCA over WCAG 2 for more accurate perceptual contrast." | command.md (C71); README (B39) | partial |
| 8 | three icon boxes in a row | none | - | silent |
| 9 | badge above the headline | none | - | silent |
| 10 | Lucide icons everywhere | none (icon rules concern labels and aria-hidden: C01, C06) | - | silent |
| 11 | untouched shadcn UI | none (command.md speaks in Tailwind idioms: `focus-visible:ring-*`, `truncate`, `min-w-0`) | - | silent (verification: C31 fires on shadcn's `transition-all` base class, but also on 3 of 4 controls; F25) |
| 12 | fade-in on scroll | "Honor `prefers-reduced-motion` (provide reduced variant or disable)" · "**Necessity check.** Only animate when it clarifies cause & effect or when it adds deliberate delight" | command.md (C29); README (B11) | partial |
| 13 | cursor-following beam | same as 12, plus "Muted decorative loops must stop under `prefers-reduced-motion`" | command.md (C36); README (B11) | partial (an input-driven beam passes "Input-driven") |
| 14 | buttons fade on hover | "Interactive states increase contrast: hover/active/focus more prominent than rest" | command.md (C82) | direct (verification: shadcn's default `hover:bg-primary/90` fades the background, not `opacity`; F25) |
| 15 | inconsistent spacing | "**Deliberate alignment.** Every element aligns with something intentionally whether to a grid, baseline, edge, or optical center. No accidental positioning." | README, AGENTS (B14) | partial, page-only |
| 16 | em dashes everywhere | none; WIG's own copy uses them | - | silent; contradicted by Vercel's writing guidelines (F19) |
| 17 | generic buzzword copy | 'Specific button labels: "Save API Key" not "Continue"' · "**Be clear & concise.** Use as few words as possible." | command.md (C86); README (B42) | partial |
| 18 | serif italic accents | none | - | silent |
| 19 | Space Grotesk + Instrument Serif | none | - | silent |
| 20 | grain over a gradient | none ("Avoid gradient banding" is about implementation, B41) | - | silent |

## Appendix D — control-site probe: method and results

Method: `wig-probe.mjs` and `wig-axe-probe.mjs` in the scratch folder. playwright-core 1.59.1 (Chrome for Testing 147.0.7727.15, revision 1217) and axe-core 4.11.2 were loaded by absolute path from an existing install; nothing was installed. Each page loaded with `waitUntil: 'load'`, then waited 2.5 s. Desktop 1440 x 900; mobile 390 x 844 with `isMobile`, `hasTouch` and scale factor 3. Reduced motion: two fresh contexts with `reducedMotion` set to `no-preference` and `reduce`, counting `document.getAnimations()` in state `running`. axe: `runOnly` tags wcag2a, wcag2aa, wcag21a, wcag21aa and wcag22aa (as /harden FE-18), then a second run by rule ID for heading-order, skip-link, region, meta-viewport-large, page-has-heading-one and landmark-one-main. Runs at 2026-09-30T19:35Z to 19:40Z. Verification re-run: both scripts were copied into the verifier's scratch folder and changed only in their output paths, plus an `addScriptTag` attempt before `page.evaluate` in the axe script. They ran again at 2026-09-30T20:27Z to 20:30Z. Every cell below reproduced except the two annotated.

| Check (WIG rule) | vercel.com/design/guidelines | vercel.com | linear.app | stripe.com |
|---|---|---|---|---|
| viewport disables zoom (C90) | yes, `maximum-scale=1` | yes | no | no |
| axe violations, /harden tag set | meta-viewport(1), scrollable-region-focusable(1) | meta-viewport(1) | button-name(1), color-contrast(18, then 16; 17 on the verification re-run), link-name(1) | none (color-contrast 108 incomplete) |
| axe best-practice violations | region(1) | none | heading-order(1) | region(1) |
| axe target-size (wcag22aa) | 0 | 0 | 0 (6 incomplete) | 0 |
| elements with computed `transition-property: all` and duration > 0 (C31) | 3 | 15 | 2 (SVG rect) | 0 |
| dark page without `color-scheme: dark` or meta (C71) | yes (html computed "normal", no meta) | n/a (light; meta "dark light") | no (computed "dark") | n/a (light) |
| theme-color meta vs background (C72) | #0A0A0A vs rgb(10, 10, 10) | #FAFAFA vs rgb(250, 250, 250) | #08090a vs rgb(8, 9, 10) | missing |
| skip link (C09) | yes | yes | yes | no |
| h1-h3 with text-wrap balance or pretty (C42) | 0 of 14 | 6 of 18 | 5 of 14 | 20 of 32 |
| anchored headings: scroll-margin-top or html scroll-padding-top (C10) | 13 ids, 0 with margin; padding 64px | no ids | no ids | 11 ids, 0 with margin; padding auto |
| `<img>` missing width or height attribute (C47) | 0 of 0 | 0 of 19 | 3 of 38 | 2 of 38 |
| "..." in visible text (C37) | 0 | 0 | 8 | 0 |
| straight `"` in visible text outside code (C38) | 14 | 0 | 0 | 0 |
| em dashes per 1,000 visible words | 0.98 (2 of 2,032) | 0 | 0 | 0 |
| buttons with `touch-action: manipulation` (C62) | 1 of 1 | 2 of 5 | 0 of 72 | 0 of 29 |
| running animations, no-preference then reduce (C29) | 0, 0 | 1, 0 | 105, 76 (96, 76 on the verification re-run) | 3, 1 |
| hovered controls whose opacity dropped (C82) | 0 of 0 | 0 of 2 | 0 of 15 | 0 of 11 |
| Tab stops without outline or box-shadow (C13, heuristic) | 0 of 12 | 4 of 12 | 0 of 12 | 0 of 12 |
| desktop interactive elements under 24 px, naive | 130 of 184 | 2 of 100 | 15 of 135 | 100 of 202 |
| 390 px interactive elements under 44 px, naive | 172 of 184 | 126 of 132 | 82 of 88 | 143 of 187 |
| horizontal overflow at 390 px (C69) | no | no | no | no |
| body font (start of the computed stack) | Geist, Inter, -apple-system | GeistSans | "Inter Variable", "SF Pro Display" | sohne-var, "SF Pro Display" |

## Dropped at verification

None. Every finding survived. Seven needed corrections in place (F01, F05, F10, F13, F19, F23, F24), and two findings were added (F25, F26).

## Verification notes

**Method.** Every cited source was re-opened on 2026-09-30, and none was taken from the researcher's downloads.
- Repositories went through the gh API or raw.githubusercontent.com:
  - vercel-labs/web-interface-guidelines at e3d624b: README.md, AGENTS.md, command.md, LICENSE and install.sh; the tree, tags, releases and all 58 commits by author; commits 30abf89 and d7f7445; issues #11 and #26 with comments; PRs #15, #17 and #28; all 28 issues and PRs.
  - vercel-labs/agent-skills: SKILL.md at 063bee9, its folder tree, history and diffs (9e2435e, 42ecbef, ba46938), the README, and the license endpoint (404).
  - dequelabs/axe-core v4.13.0: meta-viewport, target-size, bypass and skip-link rule and check JSON; meta-viewport-scale-evaluate.js; rule-should-run.js; rule-descriptions.md; API.md.
  - jsx-eslint/eslint-plugin-jsx-a11y README at v6.10.2, and vercel-labs/writing-guidelines command.md (lines 66, 67, 130, 131, 135, 189, 192).
  - raunofreiberg/interfaces, duc01226/easy-claude, fcakyon/claude-codex-settings (byte-compared with command.md), the gh search mirrors, the daniel-scrivner/ui-guidelines-review workflow, akillness/jeo-skills, and the vercel-labs/skills README with its npm registry entry.
  - shadcn-ui/ui at b0fcb58 and tailwindlabs/tailwindcss at v4.3.3 (added sources).
- Web pages went through curl:
  - Standards: WCAG 2.2, the WCAG 3.0 Working Draft of 10 September 2026, and CSS Transitions Level 1.
  - Vendor docs: Next.js generateViewport (.md), React Suspense, the WebKit tapping post, Tailwind transition-property and background-color, Apple Safari 10.0 notes and Chrome Help (Android zoom).
  - Registries and third parties: the skills.sh page and its three audit pages, agentcookbooks.com.
  - Live Vercel pages: vercel.com/design/guidelines (all 129 README titles present), vercel.com, linear.app and stripe.com meta tags, and the vercel.com/design/guidelines/install redirect (byte-identical to install.sh).
  - code.claude.com skills.md and memory.md.
- The Design type was read with the Artifact tool (release 1790780428-0f80), and all four quotes are verbatim.
- Local checks: /harden's lens-frontend.md was re-grepped (all 16 zero counts and the 2 "transition" hits reproduce), and `claude --version` gave 2.1.286.
- The F03 WebFetch alteration was re-tested with a different prompt and reproduced.
- Both probe scripts were re-run from the verifier's own folder, `scratchpad/research/fv-wdg/` (rerun-probe.mjs, rerun-axe.mjs and their results JSON). A new `swatch.mjs` rendered the shadcn hover states for F25.
- Appendix A and B classes, overlap labels and verbatim rule texts were recounted by script. Contradiction items 1 to 14 were re-checked against the same sources.

**What changed, in short.**
- F01: the commit list in the evidence was incomplete.
- F05: agentcookbooks.com is dated, and the 30abf89 commit body declares command.md's scope.
- F10: C66 is a partial overlap, not full, and the grade drops to B. No axe rule checks that a skip link exists. Best-practice rules can be requested by tag.
- F13: Inter is the first fallback, not the second.
- F19: the word counts do not reproduce, so densities are ranges.
- F23: two hosts are linked twice, the ±1 px rule cites an X post, and the >50 threshold is not in the README.
- F24: the `transition` shorthand implies `all`, and best-practice rules can be requested by tag.
- Contradiction 11: line 103's second example does carry an ellipsis.
- Added: F25 (shadcn `transition-all` and the background-alpha hover fade) and F26 (zoom behaviour per platform, from Apple and Google documents).

**Sources that could not be opened.** The seven x.com status posts were not attempted, because x.com requires a login; their content remains unassessed, as the researcher noted. Every other cited source opened. The catalogue pages at claudemarketplace.net and agenticskills.io were named without URLs, so only their hosts were checked (HTTP 308 and 200).

**Residual doubts.**
- Appendix D names "Chrome for Testing 147.0.7727.15". playwright-core 1.59.1's browsers.json lists both Chrome for Testing and Chrome Headless Shell at 147.0.7727.15, revision 1217. Which binary `headless: true` launched was not checked.
- The saved JSON holds only one linear.app `color-contrast` count (16), so the "18" in Appendix D cannot be traced. The re-run gave 17.
- The researcher's original WebFetch output was not saved. F03 rests on its own report plus my reproduction.
- The researcher's tokenizer for F19 could not be identified.
- The S/R/J classes (F11) and the tell mapping (F12) were recounted but not re-judged rule by rule. Only C09, C31 and C66 were examined in depth.
- In F26, neither vendor page names `maximum-scale`, and Apple's note is the Safari 10.0 archive entry. Later Safari versions were not re-checked.
- F25 covers the neutral theme and colour only.
- The skills.sh counters (684.7K installs, 31.7K stars) are live values read at about 20:18Z. The Next.js docs changed their version field from 16.3.7 to 16.3.8 between the two reads, with identical text.
- A search for a measurement of the skill's precision found arXiv 2609.09379 (Mishra et al., 2026-09-08). It evaluates agentic WCAG auditing against axe-core but never mentions Vercel or this skill, so "not found" stands.
