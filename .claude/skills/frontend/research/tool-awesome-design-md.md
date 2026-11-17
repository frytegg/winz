# awesome-design-md, the DESIGN.md format, and design-language extraction from live sites
> Code FD05 · slug tool-awesome-design-md · researched 2026-09-30 · verified 2026-09-30 · counts: verified 17 / corrected 10 / downgraded 0 / dropped 0 / added 2

## Summary

- **The collection.** "awesome design md" is `VoltAgent/awesome-design-md`: MIT, created 2026-03-31, 118,947 stars. It holds 74 DESIGN.md files (the badge says 73), and 7 of them are fintech or crypto (Binance, Coinbase, Kraken, Mastercard, Revolut, Stripe, Wise).
  - Since 2026-04-08 the repo is mainly an index for the getdesign.md service, which sells private extractions ("One-time payment").
  - The files were removed on 2026-04-08 and re-added on 2026-05-01. The `preview.html` files the README still promises are gone (0 in the tree).
  - DESIGN.md pull requests are refused.
- **The format.** DESIGN.md is Google's. Stitch announced it on 2026-03-18 and open-sourced a "draft specification" on 2026-04-21 in `google-labs-code/design.md` (Apache-2.0, version `alpha`, CLI `@google/design.md` 0.4.0).
  - A file is optional YAML tokens (`colors`, `typography`, `rounded`, `spacing`, `components`) plus prose sections in a fixed order of 8. Motion and iconography are left open.
  - The spec's own documents disagree on whether tokens are "normative" or only "context".
  - At least four incompatible "DESIGN.md" dialects exist in the wild. Vercel's own published design.md carries zero hex values and pushes colour and type into a stylesheet.
- **How the collection's files were made.** At least 12 files carry residue of an automated pipeline with an "LLM judgment pass"; others show computed-style extraction traces. How much was hand-authored is unknown.
  - Em dashes run at 23.3 per 1,000 words, against 0 in Vercel's brand-authored file.
  - The original disclaimer said "Colors, fonts, and spacing may not be 100% accurate".
- **Accuracy, measured on 5 live fintech sites.** Brand-identity values match exactly: primary colours, main neutrals, font families. Component and typographic rules are often wrong:
  - Stripe's file makes pill buttons "the dominant CTA system-wide", yet every filled button on the homepage is 4px and already was on 2026-05-08. The file merges two live design generations. (Its "non-negotiable" rule is the hero gradient mesh, not the pill.)
  - Kraken's headings are weight 400, not 700.
  - Coinbase's most-used font (69 to 74% of text characters over two runs) is never named.
- **The collection pushes toward the owner's tells.** About 50 of 74 files (49 by manual review) name Inter as the substitute or fallback, 58 mention gradients, and the Stripe and Vercel files mandate hero gradients. Stripe's real hero is a three.js canvas that no CSS extractor can see.
- **Tooling.**
  - The official linter exits 0 on all 74 files (0 errors, 1,357 warnings), so passing lint is a weak gate.
  - Its Tailwind export silently emits an empty theme for unparseable YAML. It quotes font stacks into a single family, which Chromium renders as Times New Roman.
  - Claude Code does not auto-load DESIGN.md.
  - Anthropic's Claude Design help articles never mention DESIGN.md. They document codebases (`/design-sync`), screenshots, decks and brand assets as inputs, and say import "is only as good as its source" (F29).
- **Generators that work from a live URL.** dembrandt (MIT, local, tested) is the strongest: exact raw values, noisy semantics, 1 lint error on its own Kraken output. Also real: `design-md-extractor`, `design-md-chrome`, `insane-design`, superdesign (hosted, login), Firecrawl branding (hosted, LLM, JSON only) and Stitch URL extraction (hosted).
  - `getdesign` is only an installer. CSS Stats is unmaintained. Project Wallace analyses CSS text, not rendered pages.
  - A 107-line Playwright `getComputedStyle` script recovered CTA colour, ink and font families on all 5 sites once its "HeadlessChrome" user agent was replaced (Revolut's declared primary `#494fdf` was not seen).
  - The `getdesign` installer sends each `add` (brand slug, versions, platform) to getdesign.md unless `GETDESIGN_DISABLE_TELEMETRY=1` is set; its README does not say so.
- **Evidence that DESIGN.md helps** is vendor-side and small. Vercel reports 39 vs 91 known failures over 6 pages and says every page still had a ship-blocking failure.

## Findings

### FD05-F01 — awesome-design-md is VoltAgent's MIT collection of 74 DESIGN.md files, with 7 in fintech and crypto
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The repository is `VoltAgent/awesome-design-md`, created 2026-03-31T16:37:01Z, MIT licence ("Copyright (c) 2026 VoltAgent"), 118,947 stars and 13,291 forks at 2026-09-30, homepage `https://getdesign.md/`. The tree at commit `f6961238` holds 74 `design-md/*/DESIGN.md` files; the README badge says 73 (Slack is in the tree but not in the README list). The README's "Fintech & Crypto" category lists 7 entries: Binance, Coinbase, Kraken, Mastercard, Revolut, Stripe, Wise. The collection skews to AI, developer tools and SaaS; sponsor customers at crypto hackathons will mostly be absent.
- **Implication for /frontend:** Treat the collection as a small reference shelf, not a source of truth for a sponsor's customers. Plan for extracting from live sites that are not in any collection.
- **Evidence:**
  - [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — VoltAgent, HEAD `f6961238d5cddcf8042a74a70fc400ec67181abb` (2026-09-21), accessed 2026-09-30 — repository metadata, tree and README.
    - `gh api repos/VoltAgent/awesome-design-md` returned `"created_at":"2026-03-31T16:37:01Z"`, `"stargazers_count":118947`, `"license":{"key":"mit"}`, `"homepage":"https://getdesign.md/"`.
    - Tree count: `gh api .../git/trees/main?recursive=1 --jq '[.tree[] | select(.path|test("^design-md/[^/]+/DESIGN.md$"))] | length'` returned `74`.
    - README: "Copy a DESIGN.md into your project, tell your AI agent “build me a page that looks like this,” and generate high-quality UI that stays visually consistent with the design language."
- **Limits / false positives:** Star counts are popularity, not quality. The count changes over time (the npm package already ships 76 templates, see F24).
- **Verification (2026-09-30):** `gh api` re-run: created 2026-03-31T16:37:01Z, MIT, homepage getdesign.md, 13,291 forks, 118,955 stars (8 more than at research time). HEAD `f6961238` ("Update README", 2026-09-21). Tree: 74 `design-md/*/DESIGN.md`. README badge "73"; the README lists 73 slugs and Slack is the one missing. "Fintech & Crypto" lists exactly the 7 named. README quote verbatim (line 29). Category counts support the skew: AI 12, backend/DevOps 8, productivity/SaaS 7, developer tools 7, out of 73 listed. A `gh search repos` for "awesome-design-md" confirms this is the dominant repository (next largest under 3,000 stars).

### FD05-F02 — The repository became a front end for the paid getdesign.md service; its files moved, and its previews are gone
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Commit `3cf71768` ("update links", 2026-04-08) removed 174 files: all 58 DESIGN.md files then in the tree, and the 58 `preview.html` and 58 `preview-dark.html`. It pointed the 59 per-site READMEs to getdesign.md.
  - Commit `e2ada214` ("update urls", 2026-05-01) added 84 files: the 58 DESIGN.md files removed on 2026-04-08, 13 DESIGN.md files for new sites (binance, bmw-m, bugatti, mastercard, meta, nike, playstation, shopify, slack, starbucks, theverge, vodafone, wired) and those 13 sites' READMEs. No previews came back. (corrected: it did not re-add 84 files; it re-added 58 and 26 were new)
  - The README still says "Each site includes" `preview.html` and `preview-dark.html`; the tree has 0 files matching "preview". Per-site READMEs now say "Design system details have been moved to: https://getdesign.md/stripe/design-md".
  - CONTRIBUTING says "We cannot accept DESIGN.md pull requests to maintain the quality of the existing collection."
  - The request issue template offers paid priority, and getdesign.md sells "A private DESIGN.md for one website. One-time payment, not a subscription."
  - A third party published `Meliwat/awesome-design-md-pre-paywall` on 2026-04-10, described as a "Reverted snapshot of VoltAgent/awesome-design-md before getdesign.md links were introduced."
- **Implication for /frontend:** Do not depend on this repo as a stable API or on its previews. If a file is used, pin it by commit SHA and keep a local copy. Keep extraction in-house rather than buying private extractions.
- **Evidence:**
  - [Commit 3cf71768](https://github.com/VoltAgent/awesome-design-md/commit/3cf71768) — necatiozmen, 2026-04-08, accessed 2026-09-30 — git history.
    - `gh api repos/VoltAgent/awesome-design-md/commits/3cf71768` returned statuses `{"added":1,"modified":59,"removed":174}`; for Stripe: `design-md/stripe/DESIGN.md` "removed" (322 deletions), `preview.html` and `preview-dark.html` "removed".
  - [Commit e2ada214](https://github.com/VoltAgent/awesome-design-md/commit/e2ada214) — necatiozmen, 2026-05-01, accessed 2026-09-30 — git history.
    - statuses `{"added":84,"modified":59,"removed":1}`.
  - [design-md/stripe/README.md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/HEAD/design-md/stripe/README.md) and [CONTRIBUTING.md](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/HEAD/CONTRIBUTING.md) — VoltAgent, HEAD, accessed 2026-09-30 — repository files (quotes above).
  - [.github/ISSUE_TEMPLATE/design-md-request.yml](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/HEAD/.github/ISSUE_TEMPLATE/design-md-request.yml) — VoltAgent, accessed 2026-09-30.
    - "For same-day delivery, you can prioritize your request at [getdesign.md/request](https://getdesign.md/request)."
  - [getdesign.md/request](https://getdesign.md/request) — VoltAgent founders, accessed 2026-09-30 via Exa fetch — vendor page (quote above).
  - [Meliwat/awesome-design-md-pre-paywall](https://github.com/Meliwat/awesome-design-md-pre-paywall) — Meliwat, created 2026-04-10, accessed 2026-09-30 — third-party snapshot (description quoted above).
- **Limits / false positives:** The word "paywall" comes from the third-party fork's name. The DESIGN.md files are readable again in the repo and via the free `getdesign` CLI.
- **Verification (2026-09-30):** `gh api .../commits/3cf71768` and `.../commits/e2ada214` re-run: authors, dates, messages and status totals match. The file-level breakdown (58 × 3 removed; 71 DESIGN.md + 13 README.md added) comes from the same responses, and the parent tree of `3cf71768` has 58 DESIGN.md files. The Stripe README at `3cf71768` already reads "Design system details have been moved to: https://getdesign.md/stripe/design-md". Every other quote is verbatim: README "Each site includes" (line 227), CONTRIBUTING line 21 and step 5, the issue template line 33, and getdesign.md/request ("A private DESIGN.md for one website. One-time payment, not a subscription.", which names "the founders of VoltAgent"). The Meliwat snapshot was created 2026-04-10T05:12:43Z, with the description as quoted, MIT, 49 stars.

### FD05-F03 — DESIGN.md is Google's format: announced in Stitch on 2026-03-18, spec open-sourced 2026-04-21, still `alpha`
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Google Labs' Stitch introduced DESIGN.md on 2026-03-18 and open-sourced a "draft specification" on 2026-04-21 in `google-labs-code/design.md`: Apache-2.0, created 2026-04-10, 28,186 stars. The npm CLI `@google/design.md` went from 0.1.0 (2026-04-21) to 0.4.0 (2026-07-27).
  - **File structure:** optional YAML front matter holding tokens, then a markdown body. Token groups are `colors`, `typography` (`fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `fontFeature`, `fontVariation`), `rounded`, `spacing` and `components`.
  - **Component tokens:** the spec defines eight property tokens: `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width`. Its "Consumer Behavior for Unknown Content" table says an unknown component property (example `borderColor`) is "Accept with warning". (corrected: "accept only" overstated the spec; F14 shows the CLI warns and does not reject)
  - **Section order** is Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts.
  - **Unknown content:** unknown sections are preserved and a duplicate section heading is an error.
  - **Left open:** the philosophy document leaves motion, iconography, elevation, text casing and paragraph measure to each file. It lists elevation although the spec has an "Elevation & Depth" prose section; there is no elevation token group. (corrected: the dossier's list dropped "elevation" from the quoted sentence)
  - **Earlier history:** Stitch's own `design-md` generator skill was already committed on 2026-01-22.
- **Implication for /frontend:** Write /frontend's DESIGN.md in this spec so it can be linted and exported. Add an explicit `## Motion` section, because the spec does not standardise one. Pin the CLI version: the spec is pre-1.0, and minor releases can break it.
- **Evidence:**
  - [Introducing "vibe design" with Stitch](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/) — Rustin Banks, Google Labs, 2026-03-18, accessed 2026-09-30 — official blog.
    - "You can easily extract a design system from any URL, or use the new DESIGN.md — an agent-friendly markdown file — to export or import your design rules to or from other design and coding tools."
  - [Stitch's DESIGN.md format is now open-source](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/) — Cassia Xu, Google, 2026-04-21, accessed 2026-09-30 — official blog.
    - "we're open-sourcing the draft specification for DESIGN.md, so it can be used across any single tool or platform."
  - [google-labs-code/design.md docs/spec.md](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) — Google Labs, HEAD `9bf8eae6`, version alpha, accessed 2026-09-30 — the specification.
    - "A DESIGN.md file contains two parts: An optional YAML frontmatter, and a markdown body."
    - "Sections can be omitted if they're not relevant to your project, but those present should appear in the sequence listed below."
  - [google-labs-code/design.md README](https://github.com/google-labs-code/design.md) — Google Labs, accessed 2026-09-30.
    - "The DESIGN.md format is at version `alpha`. The spec, token schema, and CLI are under active development. Expect changes to the format as it matures."
  - [PHILOSOPHY.md](https://github.com/google-labs-code/design.md/blob/main/PHILOSOPHY.md) — Google Labs, accessed 2026-09-30.
    - "It leaves open the categories where flexibility helps more: motion, iconography, elevation, text casing, paragraph measure."
  - `npm view @google/design.md versions time` (run 2026-09-30) returned versions 0.1.0 to 0.4.0, created 2026-04-21, modified 2026-07-27. The skill was first added in `f66e8c54` ("feat: add DESIGN.md skill (#3)", 2026-01-22T19:28:16Z, path `design-md/SKILL.md`); `a697ca5b` is a later same-day commit ("feat: add allowed_tools to DESIGN.md skill (#5)"). (corrected: the earlier text cited `a697ca5b` as the evidence commit)
  - The Stitch docs pages (`stitch.withgoogle.com/docs/design-md/overview` and `/specification`) render client-side; WebFetch and Exa returned only the title "Stitch - Design with AI". The repo's homepage field points to that Stitch `/specification` page. The GitHub `docs/spec.md` (generated from `spec.mdx`) was used instead. (corrected: the earlier text said the homepage field points to the GitHub spec)
- **Limits / false positives:** "Introduced by Stitch" refers to the public format. Agent-readable design markdown files existed before it (the Stitch skill in January).
- **Verification (2026-09-30):** Both Google blog posts re-opened. The first is "Introducing "vibe design" with Stitch", Rustin Banks, Product Manager, Google Labs, Mar 18, 2026. The second is Cassia Xu, Software Engineer, Apr 21, 2026. Both quotes verbatim. `google-labs-code/design.md`: Apache-2.0, created 2026-04-10T17:54:59Z, 28,187 stars, HEAD `9bf8eae6` ("release: 0.4.0", 2026-07-27). `docs/spec.md` at that commit (header "version: alpha") matches the token groups, the section order and the unknown-content table, and both spec quotes are verbatim. The README status quote and the PHILOSOPHY line 90 quote are verbatim.

### FD05-F04 — The spec's own documents disagree on whether tokens are binding
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - `docs/spec.md` states that tokens are normative.
  - `PHILOSOPHY.md` in the same repository states that tokens are only context, not rendering instructions, and that intent matters more than values.
- **Implication for /frontend:** Do not expect an agent to enforce tokens because they sit in a .md file. Enforce values mechanically (a generated CSS theme or stylesheet that agents must use), and use the prose for intent. This split matches Vercel's measured practice (F13).
- **Evidence:**
  - [docs/spec.md](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) — Google Labs, alpha, accessed 2026-09-30.
    - "The tokens are the normative values; the prose provides context for how to apply them."
  - [PHILOSOPHY.md](https://github.com/google-labs-code/design.md/blob/main/PHILOSOPHY.md) — Google Labs, accessed 2026-09-30.
    - "The token values serve as context and are not rendering instructions. Generally, we do not accept or recommend token requirements in the specification."
    - "**The quality of a generated design is determined less by the precision of its values than by how clearly the intent is described.**"
- **Limits / false positives:** Both are design statements, not measurements.
- **Verification (2026-09-30):** At `9bf8eae6`, `docs/spec.md` line 8 and `PHILOSOPHY.md` lines 17 and 42 contain the three quotes verbatim.

### FD05-F05 — "Adjectives describe a region. A specific reference describes a point": the Overview must name a concrete reference, not a list of adjectives
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Google's philosophy document argues that adjective lists produce the generic centre of the distribution, while a specific real-world reference brings its own negative constraints; a long list of don'ts signals a vague reference. A July 2026 preprint measured convergence: 120 designs from 5 generative UI tools across 24 tasks. Same-prompt outputs differed little in visual appearance and layout, and more in colour.
- **Implication for /frontend:** Make the Overview of every generated DESIGN.md name a concrete object from the sponsor's customer domain (for example a specific trading-terminal, settlement-statement or exchange-order-ticket register). Never use "modern, clean, trustworthy, premium". Keep the Don'ts list short and intentional, mapped to the owner's 20 tells. Colour alone will not escape sameness; layout is where outputs converge.
- **Evidence:**
  - [PHILOSOPHY.md](https://github.com/google-labs-code/design.md/blob/main/PHILOSOPHY.md) — Google Labs, accessed 2026-09-30 — spec rationale.
    - "\"Modern, clean, trustworthy, premium\" evokes nothing specific. A model creates something in the center of what those words describe, creating an output that is typically generic. Adjectives describe a region. A specific reference describes a point."
    - "The negative constraints arrive for free when the reference is specific enough. An intentional list of \"don'ts\" is useful. A long rambling list is often a sign the description was too vague to carry them."
  - [Design Theater (arXiv 2607.22928)](https://arxiv.org/abs/2607.22928) — Imteyaz, Imteyaz, Rajpal, Shaikh, Muller, Savage, submitted 2026-07-24, accessed 2026-09-30 — preprint with data (grade B on its own).
    - Abstract: "over 25% of user-facing design rationales are not implemented in the generated interface".
    - PDF text ([pdf](https://arxiv.org/pdf/2607.22928), via Exa): "when given the same prompt, generated interfaces showed narrow pairwise differences in visual appearance and layout organization, while color choices varied more widely."
- **Limits / false positives:** The preprint measures tools without a DESIGN.md and has no human-designed reference distribution. It supports the homogenisation premise, not the efficacy of DESIGN.md.
- **Verification (2026-09-30):** PHILOSOPHY lines 52 and 58 are verbatim. The arXiv API returns the six authors as listed (Kashif Imteyaz, Kaif Imteyaz, Nakul Rajpal, Kaif Shaikh, Michael Muller, Saiph Savage), published 2026-07-24, v2 2026-07-31. It also returns 24 tasks, 120 interfaces and five tools. The abstract quote is verbatim. The full-text sentence is verbatim in the v2 PDF (via pypdf), in the introduction. Similarity is measured across the five tools on the same prompt (ten pairwise tool comparisons per prompt), not across repeated runs of one tool.

### FD05-F06 — At least four incompatible "DESIGN.md" dialects exist, including two from Google itself
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  1. **Stitch `design-md` skill:** numbered sections starting "## 1. Visual Theme & Atmosphere". VoltAgent's first versions extended it to 9 sections, and 10 collection files (Kraken, Lamborghini, Lovable, Mastercard, RunwayML, Sanity, Spotify, Starbucks, Tesla, The Verge) still use it with no YAML. Google's newer `stitch::extract-design-md` skill also mandates numbered sections, plus YAML with `name` and `colors`.
  2. **Official alpha spec:** 64 of 74 collection files and dembrandt's output use it.
  3. **TypeUI format:** emitted by the `design-md-chrome` extension, with sections Mission, Brand, Style Foundations, Accessibility and so on.
  4. **Vercel's own `vercel.com/design.md`:** skill-style front matter (`name`, `description`), no tokens at all, and colour and type delegated to a published stylesheet.
  - The collection README still describes the old 9-section layout; only 10 files contain "Agent Prompt Guide".
- **Implication for /frontend:** A file named DESIGN.md is not guaranteed to be parseable or comparable. Normalise everything to the official spec before linting or export. Detect dialect by front matter and headings.
- **Evidence:**
  - [stitch-utilities design-md SKILL.md](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-utilities/skills/design-md/SKILL.md) — Google Labs, HEAD `0337446d`, accessed 2026-09-30 — the skill defines "## 1. Visual Theme & Atmosphere ... ## 5. Layout Principles".
  - [stitch-design extract-design-md SKILL.md](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-design/skills/extract-design-md/SKILL.md) — Google Labs, accessed 2026-09-30.
    - "You **MUST** include the YAML frontmatter at the top of the file with `name` and `colors` mapping".
  - [bergside/design-md-chrome README](https://github.com/bergside/design-md-chrome) — bergside, MIT, accessed 2026-09-30.
    - "The file is based on the open-source [TypeUI DESIGN.md](https://www.typeui.sh/design-md) format."
  - [vercel.com/design.md](https://vercel.com/design.md) — Vercel, fetched 2026-09-30 (HTTP 200, 40,274 bytes) — brand-authored file.
    - front matter `name: vercel-brand-guidelines`; my count: 0 six-digit hex values in 6,032 words.
  - Collection measurement: `analyze.py` over all 74 files ([evidence/tool-awesome-design-md/analysis.json](evidence/tool-awesome-design-md/analysis.json)) gave `"with_front_matter": 64`, `"version_alpha": 64`, `"has_agent_prompt_guide": 10`.
- **Limits / false positives:** The official spec lets unknown sections through, so dialects 1, 3 and 4 can be partly consumed. They fail the token checks (no YAML means "No YAML content found").
- **Verification (2026-09-30):**
  - At `0337446d`, the stitch-utilities `design-md` SKILL.md has "## 1. Visual Theme & Atmosphere" to "## 5. Layout Principles". The `stitch::extract-design-md` SKILL.md line 279 quote is verbatim; that skill extracts from frontend source code, not from a URL.
  - The design-md-chrome README quote is verbatim, and its section table starts Mission, Brand, Style Foundations, Accessibility.
  - `vercel.com/design.md` returned HTTP 200, 40,274 bytes, `Content-Type: text/markdown`, front matter `name: vercel-brand-guidelines`, 0 six-digit hex values, 6,032 words by the `\b\w+\b` regex. A whitespace split gives 5,511 words, and Eric Li's post (F27) calls it "5,400-word".
  - Re-running a copy of `analyze.py` on the 74 files fetched at `f6961238` reproduced all 22 summary keys exactly. That includes `with_front_matter` 64, `version_alpha` 64 and `has_agent_prompt_guide` 10, and the 10 agent-prompt-guide files are exactly the 10 no-YAML files named.

### FD05-F07 — Collection files show an automated extraction pipeline with an "LLM judgment pass"; how much was hand-authored is unknown
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - **Pipeline residue.** 12 files (dell-1996, together.ai, uber, vercel, vodafone, voltagent, warp, webflow, wired, wise, x.ai, zapier) contain a note naming a generator script and an LLM pass; nintendo-2001 carries a variant without the script name.
  - **Scope of the inference.** The residue proves a pipeline for 12 files, 13 with the variant. For the other 61 it is an inference from extraction traces and em-dash density, not an observation. (corrected: the earlier title said all files came from the pipeline, "not from hand authoring", which the evidence does not show for every file)
  - **Extraction lessons in the text.** The Coinbase file contains an extraction lesson about cookie-consent widgets. The Kraken v1 file lists a raw 15-value "spacing" dump (1px to 25px), typical of computed-style tallies. The Revolut file says its palette was "captured from the extracted token set".
  - **Disclaimers.** The maintainers' original per-site README carried an accuracy disclaimer, and the root README says tokens are "publicly visible CSS values".
  - **Em-dash density.** Across the 74 files, em dashes run at 23.3 per 1,000 words (5,344 in 229,471 words; median 24.0; 72 of 74 files above 2.0, the /prose PR-01 threshold). The brand-authored Vercel file has 0 in 6,032 words.
  - **Scripts not published.** The pipeline scripts are not in the repository.
- **Implication for /frontend:** Treat collection files as machine extractions with a model-written prose layer: values are observed, while rules and rationale may be invented. Run /prose-style and slop checks on any imported DESIGN.md before agents read it.
- **Evidence:**
  - [design-md/voltagent/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/voltagent/DESIGN.md) line 474 — VoltAgent, HEAD, accessed 2026-09-30 — repository file.
    - "Auto-derived kit-mirror demonstration surfaces (`scripts/derive-examples-block.mjs`). Each `ex-*` entry references brand-native primitives so downstream consumers (`/preview-design`, `/generate-kit`) re-skin the same 10 surfaces consistently. `TO_FILL` markers indicate missing primitives — resolve in the LLM judgment pass."
    - Command: `grep -l "LLM judgment pass" *.md | wc -l` returned `12`.
  - [First-commit design-md/stripe/README.md](https://github.com/VoltAgent/awesome-design-md/blob/1145c998a124f04a40ea92b09a76452b514b054b/design-md/stripe/README.md) — VoltAgent, 2026-03-31, accessed 2026-09-30.
    - "This is not the official design system. Colors, fonts, and spacing may not be 100% accurate. But it's a good starting point for building something similar."
  - [design-md/coinbase/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/coinbase/DESIGN.md) — accessed 2026-09-30.
    - "Don't extract a CTA color from a third-party widget (cookie consent, OneTrust). The brand's CTA color is what appears on actual product CTAs, not on injected modals."
  - [design-md/kraken/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/kraken/DESIGN.md) — accessed 2026-09-30.
    - "### Spacing: 1px, 2px, 3px, 4px, 5px, 6px, 8px, 10px, 12px, 13px, 15px, 16px, 20px, 24px, 25px"
  - [README License section](https://github.com/VoltAgent/awesome-design-md#license) — accessed 2026-09-30.
    - "The extracted design tokens represent publicly visible CSS values."
  - Em-dash measurement: [evidence/tool-awesome-design-md/analysis.json](evidence/tool-awesome-design-md/analysis.json), `"em_per_1000w_overall": 23.3`, `"em_per_1000w_min_median_max": [0.0, 24.0, 39.8]`, `"files_em_over_2_per_1000w": 72`.
- **Limits / false positives:** Many em dashes are template separators ("`{colors.primary}` — `#hex`"), so density shows templated machine prose but does not prove model authorship of every sentence. How much human curation happened is unknown.
- **Verification (2026-09-30):**
  - `grep -l "LLM judgment pass"` over the 74 files at `f6961238` returned the 12 named files, and the voltagent line 474 quote is verbatim. nintendo-2001 line 598 reads "Kit-mirror demonstration surfaces. ... (`/preview-design`, `/generate-kit`) ...", with no script name and no LLM pass.
  - The first-commit (`1145c998`, 2026-03-31) Stripe README disclaimer is verbatim.
  - The Coinbase line 528, Kraken line 94 (15 values), Revolut line 635 and README License (line 256) quotes are verbatim.
  - The em-dash figures reproduce: 5,344 in 229,471 body words, 23.3 per 1,000, median 24.0, 72 files above 2.0. The two files at 0.0 are cohere and sanity.

### FD05-F08 — Accuracy on 5 live fintech sites: identity values match exactly, but component and type rules are often wrong
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** I rendered each homepage in Chromium 147 at 1440×900 and tallied computed styles: backgrounds by area, text colours by characters, loaded font faces, h1/h2, and filled buttons above the fold. The results were compared with the collection files on 2026-09-30.

| Site (file state) | Matches live | Wrong or missing |
|---|---|---|
| Stripe (v2, 2026-05-08) | `sohne-var` with `ss01`; display weight 300; CTA `#533afd`; h2 32px / 35.2px / -0.64px (= its `display-lg`) | buttons 4px, not pill; ink `#0d253d` vs live `#061b31`; the most-used live text colour `#50617a` is absent from the file; "56px hero" vs 48px (archive of 2026-05-08) or 40px (today, fr locale), though the file does hold the archived h1's exact 48px / 1.15 / -0.96px as `display-xl` "Section opener", so the error is the role, not the value; dark band `#1c1e54` vs `#0d1738` |
| Kraken (v1, 2026-04-01, no YAML) | `#7132f5`, `rgba(133,91,251,0.16)`, `#101114`, `#686b82`, `#9497a9`, `#dedee5`; 12px radius; 13px 16px padding; Kraken-Brand/Kraken-Product with IBM Plex Sans; 48px/1.17, 36px/1.22 | heading weight 700 claimed vs 400 live (only 400/500 Kraken-Brand faces load; Kraken-Product loads up to 700); -1px tracking vs normal; omits Kraken-Mono and the serif Financier Display; "white backgrounds" while the largest area is `#f6f5f9` plus dark bands |
| Binance (v2) | `#fcd535`, `#f0b90b`, `#181a20`, `#eaecef`, `#707a8a`, `#929aa5`, `#1e2329`; BinanceNova | `canvas-dark: #0b0e11` while the live canvas is `#181a20` (which the file calls ink); button radius 6px vs 4px/8px |
| Coinbase (v2) | `#ffffff`, `#eef0f3`, `#0a0b0d`, `#5b616e`; hero 80px weight 400; CoinbaseDisplay/CoinbaseSans | CoinbaseText, 69 to 74% of live text characters (74.0% in the research run, 68.6% in the verification run), is never named; -2px hero tracking vs normal; `#16181c` vs `#141519` |
| Revolut (v2) | `#000000`, `#191c1f`, `#c9c9cd`; Aeonik Pro 500 + Inter; white pill CTA with black text | hero 136px vs 87.6px at 1440px; padding 14px 28px vs 10px 24px; body `#1f2226` vs `#1f1f1f` |

(corrected: the Stripe hero cell now says the archived 48px value is in the file as `display-xl`; the Coinbase share is a two-run range, not a single 74%; the Kraken "only 400/500 faces" note is limited to Kraken-Brand)

- **Implication for /frontend:** Primary colour, key neutrals and font family names from a collection file can be trusted as a starting point. Every rule about weights, tracking, radius, padding and "always/never" must be re-verified on the live page before it constrains the build.
- **Evidence:**
  - Extractor and raw outputs: [evidence/tool-awesome-design-md/live-extraction/](evidence/tool-awesome-design-md/live-extraction/) (`extract.js`, `stripe.json`, `stripe_wb.json`, `kraken.json`, `binance_ua.json`, `coinbase_ua.json`, `revolut_ua.json`), run 2026-09-30.
    - kraken.json: `"h1": {"fontFamily": "Kraken-Brand, \"IBM Plex Sans\", ...", "fontSize": "48px", "fontWeight": "400", "lineHeight": "56px", "letterSpacing": "normal", "color": "#101114"}`; `"loadedFontFaces": {"Kraken-Brand": ["500","400"], ...}`.
    - coinbase_ua.json font families by characters: CoinbaseText 4252, CoinbaseSans 1087, CoinbaseDisplay 357, CoinbaseIcons 40, CoinbaseSans 11. `grep -c CoinbaseText design-md/coinbase/DESIGN.md` returned `0`.
  - The five DESIGN.md files, as linked in F07 and in [design-md/](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md) — VoltAgent, HEAD `f6961238`, accessed 2026-09-30.
- **Limits / false positives:** Homepage only (Stripe also /pricing, /payments), one viewport, light mode, a single run, French geolocation on some sites. Sites change: only Stripe was checked against an archive from the file's own date. Near-miss hexes are counted as mismatches.
- **Verification (2026-09-30):** Every cell was checked two ways: against the five files at `f6961238`, and against the researcher's JSON outputs. Independent re-runs with a separate probe (`evidence/tool-awesome-design-md/verification/fc_check.js`, Chromium 147.0.7727.15, 1440×900) confirmed the key live values:
  - Stripe homepage h1 40px/46px/-0.8px, weight 300.
  - Kraken h1 48px/56px, weight 400, normal tracking. Loaded faces Kraken-Brand 400/500, Kraken-Product 400 to 700, Kraken-Mono, Financier Display, IBM Plex Sans.
  - Coinbase hero 80px, weight 400, normal tracking. CoinbaseText 4,252 of 6,200 characters.
  - Revolut hero 87.57px, weight 500.
  - Two claims were imprecise and are corrected above: the Stripe "56px hero" cell (the value exists in the file under another role) and the single-run Coinbase percentage. The Kraken face note was also sharpened. Kraken's file content dates from 2026-04-01 (`ed3c8649`; only its title line changed since). Binance's file was first added on 2026-05-01 (`e2ada214`), so "v2" there means the YAML format generation, not a second revision.

### FD05-F09 — The Stripe file merges two live design generations; 30 of 74 files declare multi-page sources
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Stripe runs two design systems at once.
  - **Homepage:** every filled link or button counted has a 4px radius (29 in the research run; 24 live and 27 on the 2026-05-08 archive in the verification run, 12 of them with a fully transparent `rgba(255,255,255,0)` fill). Primary `#533afd`, weight-300 headings, ink `#061b31`.
  - **/pricing and /payments:** pill buttons (16.5px radius on 33px-tall buttons; 28 and 23 instances in the research run, 26 and 21 in the verification run), primaries `#635bff`/`#9966ff`, text `#425466`/`#0a2540`. The weight-700 "h1" in the extractor output there is a 60×26px "Stripe logo" element wrapped in an h1, not a headline. (corrected: the earlier text listed "weight-700 h1" as a design-generation difference)
  - **The file's mix:** it takes the homepage's `#533afd` and weight 300 but the product pages' pill geometry. It calls `button-primary-pill` "the dominant CTA system-wide" and says "Don't replace the pill shape with rounded-rectangles for buttons." `#635bff`, `#0a2540`, `#425466` and `#061b31` appear 0 times in it. (corrected: the file's only "non-negotiable" rule is "The gradient mesh is non-negotiable on marketing heroes", line 487; it does not call the pill "non-negotiable")
  - **Not staleness:** the Wayback Machine capture of 2026-05-08 22:50 UTC, the same day as the v2 commit, shows the homepage already had 4px buttons and a 48px/1.15/-0.96px h1. The file's 56px "Hero headline" token never matched that h1, though the h1's exact metrics sit in the file as `display-xl` "Section opener". (corrected: "never matched" applies to the role, not to the value)
  - **Prevalence:** 30 of 74 files declare several source pages.
- **Implication for /frontend:** Extract per page and choose one reference page, the one closest to the surface being built. Never merge tokens across pages without clustering by design generation, or the result is a style that exists nowhere.
- **Evidence:**
  - [design-md/stripe/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/stripe/DESIGN.md) — VoltAgent, v2 commit `beec066d` 2026-05-08, accessed 2026-09-30.
    - "> **Source pages:** home (`/`), `/payments`, `/pricing`, `dashboard.stripe.com/register/payments`."
    - "Don't replace the pill shape with rounded-rectangles for buttons."
  - Live runs 2026-09-30 ([evidence/.../live-extraction/stripe.json, stripe_pricing.json, stripe_payments.json](evidence/tool-awesome-design-md/live-extraction/)) and a whole-page radius tally.
    - Output: `https://stripe.com/ radius tally ... {"4px":29}`, `https://stripe.com/pricing ... {"16.5px":28,"0px":5}`, `https://stripe.com/payments ... {"16.5px":23}`.
  - [Wayback snapshot 20260508225038](http://web.archive.org/web/20260508225038/https://stripe.com/) — Internet Archive, accessed 2026-09-30 — archived page rendered with my extractor ([stripe_wb.json](evidence/tool-awesome-design-md/live-extraction/stripe_wb.json)).
    - buttons "Contact sales" and "Get started": `#533afd`, `"radius":"4px"`; h1 `48px`, `55.2px`, `-0.96px`.
  - `grep -l -i "Source pages" all/*.md | wc -l` returned `30`.
- **Limits / false positives:** Which Stripe pages a builder should copy is a judgement call. The pill style is real on the product pages; the error is presenting a merge as one system.
- **Verification (2026-09-30):** Stripe file quotes re-read at `f6961238`: "Source pages" line 265, "Don't replace the pill shape" line 453, `display-xxl` 56px and `display-xl` 48px/1.15/-0.96px. The Wayback snapshot answers HTTP 200 with `x-archive-orig-date: Fri, 08 May 2026 22:50:38 GMT`. Re-rendering it gave an h1 of 48px/55.2px/-0.96px and all filled buttons at 4px. Live re-runs gave the radius tallies above, and a separate measurement found 62 of 63 16.5px-radius elements on /pricing to be 33px tall. `grep -l -i "Source pages"` returns 30 files, and every one of them lists at least two pages. Outputs are in `evidence/tool-awesome-design-md/verification/`.

### FD05-F10 — Signature visuals are often not CSS: Stripe's hero is a three.js canvas that computed-style extractors cannot see
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The Stripe file says "The gradient mesh IS the depth system" and says to apply it to every hero. Live, the hero visual is a 1393×761 `<canvas class="hero-wave-animation__canvas" data-engine="three.js r178">`, and the same canvas was already there on the 2026-05-08 archive. At most one element above the fold has a CSS gradient: 1 in the research run, 0 in the verification runs on the live page and on the archive. /pricing and /payments carry a separate 1440×556 `Gradient__canvas` canvas, which is probably where the file's "mesh" comes from. The file itself says the mesh is "a layered SVG or large background image rather than CSS gradients". dembrandt documents the same limit. (corrected: "only one" CSS-gradient element was a single-run count; the archive and product-page canvases were added)
- **Implication for /frontend:** Pair every computed-style extraction with full-page screenshots (desktop and mobile, light and dark), and treat canvas, WebGL, video and image heroes as a separate vision or "image to code" pass. The absence of a gradient in extracted tokens proves nothing about the page.
- **Evidence:**
  - Playwright run on https://stripe.com/, 2026-09-30.
    - Output: `{"canvases":[{"cls":"hero-wave-animation__canvas","x":337,"y":0,"w":1393,"h":761,"attrs":"aria-hidden,class,data-engine,width,height"}, ...],"aboveFoldElementsWithCssGradient":1}`; `data-engine` = `three.js r178`.
  - [dembrandt README, Limitations](https://github.com/dembrandt/dembrandt#limitations) — dembrandt, v0.37.0, accessed 2026-09-30.
    - "Canvas/WebGL-rendered sites cannot be analyzed (no DOM to read)".
- **Limits / false positives:** Observed on one site. Other brands' signature visuals may be CSS, SVG or raster images.
- **Verification (2026-09-30):** The re-run probe returned `{"cls":"hero-wave-animation__canvas","engine":"three.js r178","x":337,"y":0,"w":1393,"h":761}` both live and on the archive. The dembrandt README line 181 reads "Canvas/WebGL-rendered sites cannot be analyzed (no DOM to read)", verbatim at `22cb9f93`.

### FD05-F11 — Collection files steer builds toward the owner's slop tells: Inter substitutes in about 50 of 74 files, mandated hero gradients, badge pills
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - **Inter.** 62 of 74 files mention Inter. A regex flags 50 as naming it the substitute or fallback for a proprietary font (tell #4). A manual review of all 62 puts the count at 49. Five flagged files are false positives where Inter is the brand's own face (elevenlabs, mistral.ai, raycast, voltagent, warp). Four unflagged files do recommend it (cohere, hp, mastercard, x.ai). wired and minimax are borderline, so the count is 47 to 49. (corrected: the earlier "8 of 8 spot-checks" overstated the regex's precision; a 10-file random sample already hit mistral.ai)
  - **Space Grotesk.** The Sanity file recommends "Inter or Space Grotesk" (tells #4 and #19). Google's own spec README example uses Space Grotesk for labels.
  - **Gradients.** 58 files mention "gradient". The Stripe file instructs a gradient mesh on every hero, and the extracted Vercel file says a multi-stop mesh gradient "is the brand" (tells #1 and #20).
  - **Badge pills.** The Coinbase file defines an uppercase "badge-pill" section label (tell #9).
- **Implication for /frontend:** Never pass a collection or extracted DESIGN.md to build agents unfiltered. Run the 20-tell checker on the DESIGN.md itself and replace font substitutions with a deliberate choice: a licensed brand-appropriate face or a distinctive open face, never Inter by default. Strip hero-gradient mandates unless the reference page's own screenshot proves one.
- **Evidence:**
  - [design-md/stripe/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/stripe/DESIGN.md) — accessed 2026-09-30.
    - "Sohne is proprietary. Use **Inter** (open-source via Google Fonts) at weight 300 ... Inter is the closest open-source analogue."
    - "Apply the gradient mesh to every marketing hero; bare-canvas heroes feel off-brand."
  - [design-md/coinbase/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/coinbase/DESIGN.md) — accessed 2026-09-30.
    - "**CoinbaseDisplay → Inter** at weight 400, letter-spacing -1.5%."
    - "Small uppercase pill used as section labels (\"INSTITUTIONAL\", \"REGULATED\")."
  - [design-md/sanity/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/sanity/DESIGN.md) — accessed 2026-09-30.
    - "use Inter or Space Grotesk as the sans substitute".
  - [design-md/vercel/DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/vercel/DESIGN.md) — accessed 2026-09-30.
    - "A multi-stop mesh gradient (cyan-blue-magenta-amber) is the only decorative chrome — used at hero scale and inside feature-band atmospheric backdrops. It is the brand."
  - [google-labs-code/design.md README](https://github.com/google-labs-code/design.md) — accessed 2026-09-30 — example front matter `label-caps: fontFamily: Space Grotesk`.
  - Counts: [analysis.json](evidence/tool-awesome-design-md/analysis.json) `"files_mentioning_Inter": 62`, `"files_Inter_as_substitute": 50`, `"files_mentioning_gradient": 58`, `"files_space_grotesk": 5`.
- **Limits / false positives:** Revolut genuinely uses Inter for body text (confirmed live, F08); Inter is only a tell when chosen by default. Some gradient mentions are prohibitions.
- **Verification (2026-09-30):** Every quote was re-read at `f6961238`: Stripe lines 330 and 441, Coinbase lines 386 and 499, Sanity line 68, Vercel line 403. The Google README example has `label-caps: fontFamily: Space Grotesk`. The re-run `analyze.py` gives 62 / 50 / 58 / 5. The per-file review is in `evidence/tool-awesome-design-md/verification/inter-substitute-manual-review.txt`. The npm `getdesign` copy of Sanity is a different, newer file that recommends ABC Walden and then Inter, with no Space Grotesk (F24).

### FD05-F12 — Vercel's own brand-authored design.md bans most of the owner's tells, and warns against over-correcting into "sterile anti-design"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **File facts.** `vercel.com/design.md` (6,032 words, 0 em dashes, 0 hex values) is scoped to "an official Vercel-authored report website".
  - **Ban list.** Its section "Reject generated-design reflexes" bans em dashes (tell #16); decorative gradients, glows, textures and glass (#1, #6, #13, #20); badge pills and tracked eyebrows (#9); "Generic centered hero copy followed by a card grid" and arbitrary icon tiles (#8, #10); and borders used to repair weak hierarchy (#5).
  - **Gradient rule.** It allows a gradient only as a labelled data scale.
  - **Over-correction warning.** It also warns against a "sterile anti-design template".
  - **Against the extracted file.** The extracted Vercel file in the collection mandates the gradient that the brand's own guidance rejects (F11), though scopes differ (marketing site vs agent-built pages).
- **Implication for /frontend:** Use this file as an independent, brand-authored corroboration of the owner's tell list, and as a human-authored control document for the slop checker (it must stay silent on it). Encode the "do not compensate with sterile anti-design" warning so the skill does not over-correct.
- **Evidence:**
  - [vercel.com/design.md](https://vercel.com/design.md) — Vercel, fetched 2026-09-30 — brand-authored file.
    - "Do not ship any of these recognizable defaults:" ... "- Em dashes." "- Decorative gradients, glows, blobs, stripes, textures, glass, or ornamental shadows." "- Generic centered hero copy followed by a card grid." "- A badge, pill, or rounded capsule for ordinary metadata, chart annotations, or editorial labels." "- Cards nested inside cards, or borders used to repair weak hierarchy." "- Arbitrary icon tiles, oversized icons, or mixed icon styles."
    - "Hard reject decorative gradients, gradient text, glows, blobs, stripes, textures, grid backgrounds, glass effects, paper simulations, colored side rails, ornamental shadows, and fake depth. A gradient is acceptable only when it is a labelled continuous data scale."
    - "Do not compensate for avoiding these defaults by producing a sterile anti-design template. Vercel restraint is precise hierarchy, excellent typography, clear evidence, strong alignment, and deliberate tension. It is not merely black, white, thin rules, and large empty margins."
    - Counts (my script): `vercel.com/design.md (brand-authored): words=6032 em_dashes=0 per1000=0.0 hex6=0`; `awesome-design-md vercel (extracted): words=5622 em_dashes=118 per1000=21.0 hex6=67 gradient_mentions=43`.
- **Limits / false positives:** The file targets report pages, not marketing homepages. It is one brand's taste, not a universal standard.
- **Verification (2026-09-30):** `vercel.com/design.md` was re-fetched (HTTP 200, 40,274 bytes). All eleven quoted strings occur exactly once. The ban list sits under "## Reject generated-design reflexes" (line 303), whose first bullet is "All-caps or tracked eyebrows, kickers, overlines, and decorative numbered section labels." The "Hard reject decorative gradients" sentence is in "Color, surfaces, and boundaries" (line 215), outside the ban list, as the finding implies. The recount is words 6,032, em dashes 0, hex 0; the extracted Vercel file has 5,622 words, 118 em dashes, 21.0 per 1,000, 67 hex values and 43 gradient mentions. These counts use the whole file, including front matter, while F07's collection rate uses body text only.

### FD05-F13 — Vercel measured 57% fewer known failures with its design.md, and moved type, spacing and layout into a stylesheet because agents kept inventing them
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** Vercel built its design.md over more than 200 runs, with 7 fixed eval scenarios, blind A/B review, and a model judge. Each correction goes to the narrowest enforceable place: prose, stylesheet or deterministic check.
  - **Test:** 3 desktop scenarios × with/without the file, Codex with GPT-5.5, first attempts only.
  - **Result:** 39 known failures with the file vs 91 without ("57% fewer in this test").
  - **Caveats (Vercel's own):** the check only catches known failures; 6 pages is "far too small"; every page still had a ship-blocking failure.
  - **Stylesheet:** created because agents invented typography, spacing and layout. The design.md tells agents not to read the stylesheet into context.
- **Implication for /frontend:** Ship mechanics as a bounded CSS vocabulary (theme tokens plus a small set of layout and type classes) that agents must use, keep judgement in DESIGN.md prose, and turn every recurring failure into a deterministic check. Evaluate with fixed scenarios, a saved baseline without the file, and first attempts only.
- **Evidence:**
  - [How our agents build on-brand pages with design.md](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md) — John Phamous (contributor Kevin Corbett), Vercel, 2026-08-31, accessed 2026-09-30 — vendor engineering blog with measurement.
    - "The pages generated with `design.md` had 39 of those failures. The pages generated without it had 91, which works out to 57% fewer in this test."
    - "The checks can only catch failures we have already seen and written down, so this test says nothing about whether a page is well designed overall."
    - "Six pages is also far too small a sample to make claims about quality or reliability, and every one of them, with or without the file, still had at least one failure serious enough to block shipping."
    - "We created a stylesheet because agents kept inventing their own typography, spacing, and layout, so we took those decisions away from the model entirely."
  - [vercel.com/design.md](https://vercel.com/design.md) — Vercel, fetched 2026-09-30.
    - "Use the public API documented below; do not read the stylesheet implementation into context."
- **Limits / false positives:** Vendor-run and not independently reproduced. The file is brand-authored, not extracted from a third party. Report-page scenarios only.
- **Verification (2026-09-30):** The post was re-fetched as markdown (HTTP 200). "Published: August 31, 2026 | Authors: John Phamous | Contributors: Kevin Corbett". The method details match the text: seven prompts; "well over 200 runs"; blind A/B comparisons; a model judge; "the narrowest place that can consistently enforce it"; three desktop scenarios with Codex and GPT-5.5, first attempts, no re-rolls. All four quotes are verbatim. The post adds that full rounds ran on both Claude Opus 4.8 and Codex with GPT-5.5. The design.md stylesheet sentence is verbatim.

### FD05-F14 — The official linter is lenient: exit code 0 unless there is a hard error; on the collection, 0 errors and 1,357 warnings
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** `@google/design.md` 0.4.0 exits 1 only on errors.
  - **What errors:**
    - Of the eleven rules, only `broken-ref` has error severity, for unresolved or circular references. Its unknown-component-sub-token branch (for example `borderColor`) emits warnings.
    - The model builder in `dist/index.js` also raises errors on invalid values: an invalid colour, an invalid unit or dimension, a non-numeric font weight, a colour given as a font family, duplicate or colliding token paths, excessive token nesting depth, and an unexpected model-building failure.
    - (corrected: the earlier "two rule ids really error: broken-ref and invalid dimensions" understated the error sources; invalid dimensions are one of several model-validation errors, not a rule id)
  - **Not errors:**
    - `name` is not enforced.
    - Missing `primary` and missing typography are warnings.
    - A prose-only file yields one warning, "No YAML content found", and exit 0.
  - **Contrast:** one 4.5:1 threshold for every component pair (no large-text exception), and it scores text on a transparent background (for example 1.32:1), a false positive.
  - **Results on all 74 files (exit 0 on each):**
    - 684 orphaned-tokens.
    - 466 unknown component sub-tokens.
    - 178 contrast-ratio warnings in 41 files. Some reflect real brand values, such as Airbnb's white on `#ff385c` at 3.52:1, as recorded in its file.
    - 16 unknown typography properties.
    - 3 YAML parse failures (elevenlabs, raycast, supabase).
    - 10 files with no YAML.
- **Implication for /frontend:** Gate on specific findings, not on the exit code. Fail on any parse warning, no-YAML, missing-primary or missing-typography, and on contrast-ratio after discarding transparent-background false positives. Copying a customer's real button colours can fail /harden's axe WCAG AA check, so re-derive contrast.
- **Evidence:**
  - [google-labs-code/design.md README, Linting Rules](https://github.com/google-labs-code/design.md#linting-rules) — Google Labs, accessed 2026-09-30.
    - "The linter runs eleven rules against a parsed DESIGN.md." and "Exit code `1` if errors are found, `0` otherwise."
  - `@google/design.md` 0.4.0 `dist/index.js` (npm, installed 2026-09-30).
    - `name: "broken-ref", severity: "error"`, with the unknown-sub-token branch `severity: "warning"`; `var WCAG_AA_MINIMUM = 4.5;`.
  - Runs: [evidence/.../design-md-cli-0.4.0/lint_summary.json](evidence/tool-awesome-design-md/design-md-cli-0.4.0/lint_summary.json).
    - `{"files": 74, "errors": 0, "warnings": 1357}`.
    - Sample: `contrast-ratio | airbnb | components.button-primary | textColor (#ffffff) on backgroundColor (#ff385c) has contrast ratio 3.52:1, below WCAG AA minimum of 4.5:1.`; `airbnb | components.button-tertiary-text | textColor (#222222) on backgroundColor (#00000000) has contrast ratio 1.32:1`.
  - Test files: no `name` gave only `missing-primary`/`missing-typography` warnings, exit 0; prose-only gave `"No YAML content found..."`, exit 0.
- **Limits / false positives:** Version 0.4.0 only; the rules may tighten. The Airbnb contrast figure is the file's claim, not a live measurement.
- **Verification (2026-09-30):**
  - `@google/design.md@0.4.0` was installed in scratch and `designmd lint` run on all 74 files. It exited 0 on each, with 0 errors and 1,357 warnings. The per-rule counts are exactly as listed: 684 / 466 / 178 in 41 files / 16 / 3 (elevenlabs, raycast, supabase: "Nested mappings are not allowed in compact mappings") / 10.
  - Airbnb gives 3.52:1 and 1.32:1 on `#00000000`.
  - A test file with no `name`, no `primary` and no typography gave `missing-primary` and `missing-typography` warnings and exit 0.
  - `contrastCheck` uses the single constant `WCAG_AA_MINIMUM = 4.5` and ignores alpha.
  - The README quotes are verbatim.
  - Summary in `evidence/tool-awesome-design-md/verification/lint-rerun-summary.json`.

### FD05-F15 — The official export has silent failure modes: an empty theme on bad YAML, and font stacks quoted into one family
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **Empty theme on bad YAML.** `export --format css-tailwind` exits 0 and prints an empty `@theme {}` when front matter does not parse (the Supabase file). The README warns that export ignores lint findings.
  - **Font stacks quoted.** The Tailwind v4 serializer wraps every `fontFamily` value in quotes (`cssStringLiteral`). The collection writes whole stacks in `fontFamily` ("sohne-var, 'SF Pro Display', system-ui, ..."), so the exported `--font-*` becomes a single non-existent family name. In Chromium 147 such a value rendered as Times New Roman; the same stack unquoted rendered Arial.
  - **Windows.** The `.md` bin name can make `npx @google/design.md` do nothing; the documented alias is `npx -p @google/design.md designmd`.
- **Implication for /frontend:** After export, assert a non-empty theme and verify rendered fonts (for example CDP `CSS.getPlatformFontsForNode` or `document.fonts`). Store one family per `fontFamily` token and add fallbacks in CSS. Invoke the CLI through `designmd` on Windows.
- **Evidence:**
  - [google-labs-code/design.md README, export](https://github.com/google-labs-code/design.md#export) — Google Labs, accessed 2026-09-30.
    - "Exit code `0` on a successful export (regardless of any lint findings in the source — run `lint` to gate on those)".
    - "On **Windows/PowerShell**, this direct form can produce no output (or open `DESIGN.md` in your Markdown editor) because the `.md` suffix in the `design.md` bin name collides with the Windows Markdown file association".
  - `@google/design.md` 0.4.0 `dist/index.js`: `fontFamily[name] = cssStringLiteral(typo.fontFamily);`.
  - Outputs: [stripe_theme.css](evidence/tool-awesome-design-md/design-md-cli-0.4.0/stripe_theme.css) (`--font-display-xxl: "sohne-var, 'SF Pro Display', system-ui, -apple-system, sans-serif";`); [supabase_theme.css](evidence/tool-awesome-design-md/design-md-cli-0.4.0/supabase_theme.css) (`@theme {` `}`, exit 0).
  - [font-stack-quoting-test.txt](evidence/tool-awesome-design-md/design-md-cli-0.4.0/font-stack-quoting-test.txt).
    - `a --font-quoted:"Nope, Arial, sans-serif" => ["Times New Roman"]` and `b --font-unquoted:Nope, Arial, sans-serif => ["Arial"]`.
- **Limits / false positives:** Single-family `fontFamily` values (the spec's own examples) export correctly. Default fonts differ by OS.
- **Verification (2026-09-30):** Re-run with the installed 0.4.0. `designmd export --format css-tailwind` on the Supabase file exited 0 and printed exactly `@theme {\n}\n`. On Stripe it exited 0 with `--font-display-xxl: "sohne-var, 'SF Pro Display', system-ui, -apple-system, sans-serif";`. `cssStringLiteral` wraps the value in double quotes, and line 22695 applies it to `typo.fontFamily`. In Chromium 147.0.7727.15 via CDP `CSS.getPlatformFontsForNode`, the quoted test stack rendered as Times New Roman, the unquoted one as Arial, and the real Stripe export value also as Times New Roman (`evidence/tool-awesome-design-md/verification/font-stack-rerun.txt`). Both README quotes are verbatim.

### FD05-F16 — Claude Code does not auto-load DESIGN.md; it must be imported with `@DESIGN.md` or passed explicitly, and collection files are large
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **Loading.** Claude Code auto-loads CLAUDE.md, CLAUDE.local.md, `.claude/rules/`, auto memory, and AGENTS.md under conditions. DESIGN.md is not in that list.
  - **Imports.** `@path` imports inside CLAUDE.md load at launch, up to four hops, and cost context like inline text. A CLAUDE.md that only tells Claude in words to read a file works only if Claude decides to open it. The docs target under 200 lines per CLAUDE.md.
  - **Size of collection files.** They run 125 to 852 lines (median 544; mean 29,055 bytes; max 44,083).
  - **Vendor guidance.** VoltAgent and getdesign say to place the file at the project root and instruct the agent. Google's CLI has a `spec` command "useful for injecting spec context into agent prompts".
- **Implication for /frontend:** /execution must pass the DESIGN.md path and the compiled theme CSS path in every frontend subagent prompt, with an explicit "read before any UI" step, rather than relying on ambient loading. If CLAUDE.md is used, use an `@DESIGN.md` import, not a sentence. Keep /frontend's own DESIGN.md far shorter than the collection's median.
- **Evidence:**
  - [How Claude remembers your project](https://code.claude.com/docs/en/memory) — Anthropic, accessed 2026-09-30 — official docs.
    - "CLAUDE.md files can import additional files using `@path/to/import` syntax. Imported files are expanded and loaded into context at launch alongside the CLAUDE.md that references them."
    - "Imported files can recursively import other files, with a maximum depth of four hops."
    - "**A `CLAUDE.md` that tells Claude in words to read `AGENTS.md`**: Claude sees `AGENTS.md` only if it decides to open the file."
    - "**Size**: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence."
  - [getdesign npm README](https://www.npmjs.com/package/getdesign) — VoltAgent, 0.6.25 tarball read 2026-09-30.
    - "Read `DESIGN.md` before writing any UI. Match the tokens, type scale, and component patterns defined there."
  - [google-labs-code/design.md README, spec](https://github.com/google-labs-code/design.md#spec) — "Output the DESIGN.md format specification (useful for injecting spec context into agent prompts)."
  - Size measurement: `wc -l` over the 74 files: `min lines 125 median 544 max 852`; `mean bytes 29055, max bytes 44083`.
- **Limits / false positives:** The AGENTS.md sentence is an analogy for any file referenced in words. Subagent loading rules were not re-verified here.
- **Verification (2026-09-30):** `https://code.claude.com/docs/en/memory.md` was re-fetched (HTTP 200) and all four quotes are verbatim (lines 88, 102, 104, 431). The page never mentions DESIGN.md. The `getdesign` 0.6.25 README line 18 and the design.md README `spec` line are verbatim. Size stats recomputed over the 74 files: lines min 125, median 544.5, max 852; bytes mean 29,055, max 44,083.

### FD05-F17 — Stitch ingests DESIGN.md through MCP tools that parse the YAML front matter directly
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **Tools.** Google's Stitch skills document an `upload_design_md` MCP tool (for files under about 5KB, else an uploader script) and `create_design_system_from_design_md`. The latter "automatically populates and updates all theme tokens directly from the parsed YAML frontmatter".
  - **Scope.** The documented MCP schema covers upload, create, update and apply only. It has no URL-extraction tool; that remains a feature of the Stitch UI.
- **Implication for /frontend:** If Stitch is ever used, only the YAML tokens transfer mechanically. The file must be in the YAML-bearing dialect, and must be under the size limit or uploaded via script.
- **Evidence:**
  - [manage-design-system reference/tool-schema.md](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-design/skills/manage-design-system/reference/tool-schema.md) — Google Labs, HEAD `0337446d`, accessed 2026-09-30.
    - "you do **not** need to call it after `create_design_system_from_design_md`. The latter automatically populates and updates all theme tokens directly from the parsed YAML frontmatter of the uploaded `DESIGN.md`."
  - [manage-design-system SKILL.md](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-design/skills/manage-design-system/SKILL.md) — Google Labs, accessed 2026-09-30 via Exa.
    - "If the `DESIGN.md` is small (under ~5KB), you can call the `upload_design_md` MCP tool directly".
- **Limits / false positives:** Not exercised (it needs a Stitch account and API key).
- **Verification (2026-09-30):** At `0337446d`, `tool-schema.md` line 51 and `manage-design-system/SKILL.md` line 81 are verbatim. The schema's sections are: upload (via `upload_to_stitch.py`), `create_design_system_from_design_md`, `update_design_system` and `apply_design_system`. It contains no URL-extraction tool.

### FD05-F18 — Claude Design reportedly scaffolds a design system from an uploaded DESIGN.md, including "Google Fonts substitutes" for proprietary fonts
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - **Claimed inputs.** VoltAgent's companion list says a DESIGN.md can be uploaded under "Add assets" when creating a design system at claude.ai/design, or attached to a prototype with "Create a design system from this DESIGN.md".
  - **Claimed outputs.** README.md, `colors_and_type.css`, "Google Fonts substitutes when the brand font is proprietary", preview cards, a UI kit and a `SKILL.md`.
  - **Not confirmed by Anthropic.** The two Claude Design help articles opened at verification (F29) never mention DESIGN.md. They list codebases, prototypes and screenshots, decks or documents, and brand assets as inputs. (updated at verification: the researcher had opened no Anthropic documentation)
  - **Differing structure.** The task brief records a different structure for the Artifact "Design System" type (`project/README.md`, `project/tokens.json`).
- **Implication for /frontend:** If Claude Design is plugged in, verify the real output structure first and pre-filter font choices, since an automatic Google Fonts substitution is the same route to generic fonts as F11.
- **Evidence:**
  - [VoltAgent/awesome-claude-design README](https://github.com/VoltAgent/awesome-claude-design) — VoltAgent, MIT, created 2026-04-18, accessed 2026-09-30 — third-party description.
    - "Upload any `DESIGN.md` to Claude Design and it scaffolds a full design system (colors, type, components, preview cards, and a working UI kit) in a single shot."
    - "Google Fonts substitutes when the brand font is proprietary".
- **Limits / false positives:** Third-party, promotional, dated to its authors' testing; the product may differ now.
- **Verification (2026-09-30):** `VoltAgent/awesome-claude-design` checked: MIT, created 2026-04-18T06:40:04Z, 3,926 stars, last push 2026-06-20. The README quotes are verbatim: line 31, and lines 73, 81 and 91 to 96 for "Add assets", "Create a design system from this DESIGN.md", `README.md`, `colors_and_type.css`, "Google Fonts substitutes when the brand font is proprietary" and `SKILL.md`. This verifies the third party's description only. Anthropic's two Claude Design help articles (F29) never mention DESIGN.md and list no such output files, so grade C stays.

### FD05-F19 — dembrandt is a local, MIT, Playwright-based URL extractor that emits spec DESIGN.md, DTCG, Tailwind v4 and shadcn themes, with an MCP server
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** dembrandt 0.37.0 (npm, 2026-09-29; repo MIT, created 2025-11-22, 3,590 stars) renders pages with `playwright-core` and reads computed styles.
  - **Exports:** `--design-md`, `--dtcg`, `--tailwind`, `--shadcn`, HTML report and brand-guide PDF.
  - **Analysis flags:** `--wcag`, `--crawl [n]`, `--dark-mode`, `--mobile`, `--compare` (a drift gate) and `--stealth` ("authorized use only").
  - **MCP server:** includes `generate_design_md`.
  - **Browser:** it can drive an existing Chromium over CDP ("needs no local browser download at all").
  - **Install footprint (observed on this machine):** a default `npm install` pulled the optional `onnxruntime-node` 1.29.0, 283 MB of a 325 MB `node_modules`; 42 MB without it.
  - **User agent and robots:** default UA is a normal `Chrome/136.0.0.0` string. It fetches robots.txt; user-driven runs are warned and proceed.
  - **Honesty:** its DESIGN.md "reports only what Dembrandt observed" and omits sections without evidence.
- **Implication for /frontend:** This is the best off-the-shelf local extractor for sponsor-customer sites. Install with `--omit=optional` or run via `npx` over CDP against the installed Chromium to respect the 4.8 GB disk. It still needs a curation pass (F20).
- **Evidence:**
  - [dembrandt README](https://github.com/dembrandt/dembrandt) — dembrandt (@thevangelist), HEAD `22cb9f93`, v0.37.0, accessed 2026-09-30.
    - "Playwright renders the page, dembrandt reads computed styles from the DOM, analyzes color usage and confidence, groups similar typography, detects spacing patterns, and returns design tokens."
  - [docs/usage.md](https://github.com/dembrandt/dembrandt/blob/main/docs/usage.md) — accessed 2026-09-30.
    - "DESIGN.md reports only what Dembrandt observed on the source site. ... Sections with no extracted evidence are omitted rather than filled with invented defaults."
    - "Skip the bundled browser entirely and drive an already-running Chromium over the DevTools Protocol. Useful in CI or containers where a browser is already up, and it needs no local browser download at all".
  - Installed package (2026-09-30): `{"optionalDependencies":{"onnxruntime-node":"1.29.0"}}`; `du` gave `283M node_modules/onnxruntime-node`; `dist/lib/extractors/context-config.js`: `export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';`.
- **Limits / false positives:** One maintainer. Hosted "App" and `--key` sync features are separate from the local CLI. `--stealth` raises Terms-of-Service questions.
- **Verification (2026-09-30):**
  - Repo: MIT, created 2025-11-22T13:49:09Z, 3,591 stars, HEAD `22cb9f93` (2026-09-29).
  - npm 0.37.0 published 2026-09-29T17:40Z; only maintainer thevangelist; dependencies include `playwright-core` 1.62.1; optional `onnxruntime-node` 1.29.0.
  - README flag tables list every flag named, with `--stealth` "Anti-detection; authorized use only". The MCP tool list includes `generate_design_md`.
  - The usage.md quotes (lines 96 and 124) are verbatim.
  - In the 0.37.0 tarball, `DEFAULT_USER_AGENT` is as quoted. `lib/robots.js` says "a user-driven run is warned and proceeds", and `DEMBRANDT_ENFORCE_ROBOTS=1` makes it refuse.
  - Install footprint: the registry lists `onnxruntime-node@1.29.0` at 296,334,136 bytes unpacked (about 283 MiB), which matches the dossier's `du`. The package was not reinstalled with the optional dependency. A scratch install of dembrandt with `--omit=optional` plus `@google/design.md` and `playwright-core` came to 67 MB.

### FD05-F20 — dembrandt tested on 3 sites: raw values correct, semantic roles and scales noisy, and its own Kraken output fails the official linter
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Run over CDP on 2026-09-30:
  - **kraken.com.** Correct primary `#7132F5`, `on-surface` `#101114`, button `#7132F5`/12px/13px 16px, Kraken fonts and weight 400. But:
    - `secondary: "#0000EE"`, the browser default link blue.
    - `surface: "#9497A9"`, actually a text grey.
    - 44 unnamed `text-N` styles with duplicates, and a 1px to 9.6px "spacing" scale.
    - A `rounded` scale missing the 12px its own button uses.
    - A token with `lineHeight: Infinity`, which makes the official linter report 1 error ("'Infinity' is not a valid dimension").
  - **stripe.com.** Correct `#533AFD` and 4px buttons, but `on-surface: "#0000EE"`.
  - **coinbase.com.** Correct `#0052FF` and `#0A0B0D`, but the top type token is the `CoinbaseIcons` icon font, and the "observed button" is an icon button (white text on `#EEF0F3`, padding 0).
  - **Its own accuracy claim.** The vendor says ML brand-primary detection (`--ai`) is "68% vs 32%" for the default heuristic; `meta.json` backs only the 68% (leave-one-site-out top-1 0.6765 over 102 sites). The emitter's lint test runs on a synthetic fixture, not a real extraction.
  - **Prose.** Generic, with no design rationale.
- **Implication for /frontend:** Use dembrandt for raw evidence, then run a curation step:
  - assign roles from visual position (the CTA background is primary only on real primary CTAs);
  - drop browser defaults (`#0000EE`), icon fonts and third-party widgets;
  - dedupe and name the type scale;
  - clamp invalid values;
  - write the rationale prose by hand or with a model;
  - re-lint.
- **Evidence:**
  - Outputs: [evidence/.../dembrandt-0.37.0/kraken.com.DESIGN.md](evidence/tool-awesome-design-md/dembrandt-0.37.0/kraken.com.DESIGN.md), [stripe.com.DESIGN.md](evidence/tool-awesome-design-md/dembrandt-0.37.0/stripe.com.DESIGN.md), [coinbase.com.DESIGN.md](evidence/tool-awesome-design-md/dembrandt-0.37.0/coinbase.com.DESIGN.md).
    - Command: `BROWSER_CDP_ENDPOINT=http://localhost:9222 npx dembrandt kraken.com --browser chromium --design-md --save-output` printed "✨ Analysis summary: 14 colors, 44 text styles, 46 breakpoints."
    - Lint of kraken output: `{"errors":1,"warnings":0,"infos":1}`, message `'Infinity' is not a valid dimension.`
  - [docs/usage.md](https://github.com/dembrandt/dembrandt/blob/main/docs/usage.md) — accessed 2026-09-30 — vendor claim (grade B on its own).
    - "Replaces the heuristic with a trained model, 2× more accurate (68% vs 32%)."
  - [lib/ml/meta.json](https://github.com/dembrandt/dembrandt/blob/main/lib/ml/meta.json) — accessed 2026-09-30.
    - `"nSites": 102, "nCandidates": 1532, "metrics": {"leave_one_site_out_top1": 0.6765, "sites_evaluated": 102}`.
  - [test/design-md-lint.test.ts](https://github.com/dembrandt/dembrandt/blob/main/test/design-md-lint.test.ts) — accessed 2026-09-30 — uses `sample()` fixture data.
- **Limits / false positives:** Three homepages, one run each, Chromium 147 over CDP rather than dembrandt's pinned browser; `--crawl` and `--ai` untested.
- **Verification (2026-09-30):**
  - The verifier re-ran `BROWSER_CDP_ENDPOINT=http://localhost:9222 dembrandt kraken.com --browser chromium --design-md --save-output` (0.37.0, Chromium 147.0.7727.15). It reproduced every listed Kraken defect: `secondary: "#0000EE"`, `surface: "#9497A9"`, `on-surface` `#101114`, a 1px to 9.6px spacing scale, a `rounded` scale of 2/3/6/8/9999px with no 12px, a button with 12px radius and 13px 16px padding, and a `lineHeight: Infinity` token that the 0.4.0 linter reports as 1 error ("'Infinity' is not a valid dimension.").
  - Counts vary by run: this run printed "16 colors, 43 text styles, 46 breakpoints", against "14 colors, 44 text styles".
  - The Stripe and Coinbase claims were checked against the researcher's saved outputs only.
  - `lib/ml/meta.json` and the usage.md sentence are verbatim. `test/design-md-lint.test.ts` builds its input from a `sample()` fixture of synthetic extraction data.
  - Re-run output: `evidence/tool-awesome-design-md/verification/dembrandt-0.37.0-rerun-kraken.com.DESIGN.md`.

### FD05-F21 — Other real URL-to-DESIGN.md generators: two local (untested), one browser extension, and three hosted services; none is named "design-extractor"
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - **`jpoindexter/design-md-extractor`** (MIT, 63 stars, created 2026-05-28, last push 2026-06-07): local and model-free. It covers desktop, tablet and mobile, triggers real hover and focus, and uses frequency-based confidence. Outputs are DESIGN.md, `evidence.json`, `tokens.css`, a Tailwind theme, DTCG and screenshots. Install is `git clone` only.
  - **`bergside/design-md-chrome`** (MIT, 2,930 stars): a Chrome extension that reads the active tab (so it runs past bot walls in the user's own session) and writes TypeUI-format DESIGN.md or SKILL.md.
  - **`fivetaku/insane-design`** (MIT, 134 stars): a Claude Code plugin that fetches and parses real CSS into `design.md` plus an HTML report, and ships 100 pre-analysed sites.
  - **superdesign** extracts via `superdesign extract-website --url ... --design-md` behind `@superdesign/cli` (0.14.0, MIT) and `superdesign login`, so it is hosted. Its browser extension is a SingleFile-based page cloner (AGPL-3.0), not a token extractor.
  - **Google Stitch** offers "extract a design system from any URL" in its hosted UI (F03, F17).
- **Implication for /frontend:** For NDA or client work keep extraction local (dembrandt, design-md-extractor, or an in-skill script). Hosted extractors send the customer URL to a third party and need accounts. The Chrome extension is the fallback when every headless route is bot-walled.
- **Evidence:**
  - [jpoindexter/design-md-extractor README](https://github.com/jpoindexter/design-md-extractor) — jpoindexter, MIT, accessed 2026-09-30.
    - "Fully local. It never calls an AI or needs an API key".
    - "It loads the site in a real browser across desktop, tablet, and mobile, scrolls to trigger lazy content, reads computed styles, triggers real hover/focus to capture interaction states, ranks the evidence into confident tokens, and writes everything to disk."
  - [bergside/design-md-chrome README](https://github.com/bergside/design-md-chrome) — bergside, MIT, accessed 2026-09-30.
    - "This Chrome extension extract styles and information from any given site and generates a `DESIGN.md` or `SKILL.md` file".
  - [fivetaku/insane-design README](https://github.com/fivetaku/insane-design) — fivetaku, MIT, accessed 2026-09-30.
    - "It fetches the real CSS, parses every custom property, extracts typography, spacing, shadows, radii, and gradients, then hands your AI agent a `design.md` it can actually build with."
  - [superdesigndev/superdesign-skill README](https://github.com/superdesigndev/superdesign-skill) — Superdesign, MIT, accessed 2026-09-30.
    - "npm install -g @superdesign/cli@latest" / "superdesign login" and "**Extract a site's design DNA from a URL** (style guide, tokens, content, brand, clone)" `superdesign extract-website --url https://example.com --design-md`.
  - [superdesigndev/superdesign-extension README](https://github.com/superdesigndev/superdesign-extension) — AGPL-3.0, accessed 2026-09-30.
    - "clones any website into a single, self-contained HTML file".
  - Search for "design-extractor": `gh search repos "design-extractor"` and `npm search design-extractor` found no tool of that exact name.
- **Limits / false positives:** None of these was run; their accuracy is unmeasured here. Star counts at 2026-09-30.
- **Verification (2026-09-30):**
  - Metadata re-checked with `gh api`:
    - design-md-extractor: MIT, 63 stars, created 2026-05-28, pushed 2026-06-07, not on npm (404).
    - design-md-chrome: MIT, 2,932 stars.
    - insane-design: MIT, 134 stars; README says "100 pre-analyzed sites" and installs as a Claude Code plugin.
    - superdesign-skill: MIT. `@superdesign/cli` is at 0.14.0, MIT.
    - superdesign-extension: AGPL-3.0, "Built on top of SingleFile".
  - All README quotes are verbatim. The design-md-extractor README also lists `design-tokens.json` in "W3C Design Tokens format", `preview.html` and an MCP server.
  - "Runs past bot walls" for the Chrome extension is an inference from its reading the active tab. The README does not say it.
  - The list is not exhaustive: the same `gh search repos "design-extractor"` also returns Railly/tinte (MIT, 622 stars, "Extract an identity from any reference, emit SKILL.md + tokens.css, lint what bypasses your tokens"), GalaxyXieyu/Design-Learn (MIT, 172 stars) and memvid/design-memory (no licence, 132 stars, "deterministic analysis and LLM interpretation"). None of the three was evaluated.

### FD05-F22 — Firecrawl's `branding` format is a hosted, LLM-assisted JSON profile (logo, colours, fonts, components), not a DESIGN.md
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **Output.** `/v2/scrape` with `formats: ["branding"]` returns a `BrandingProfile` with:
    - `colorScheme`, `logo`, `fonts`;
    - `colors` (primary to error);
    - `typography`, `spacing`;
    - `components` (buttonPrimary, buttonSecondary, input);
    - `images` (logo, favicon, ogImage), `animations`, `layout`, `personality`.
  - **LLM step.** The pipeline calls an LLM via `generateObject`: `gpt-4o-mini`, or `gpt-4o` for complex or screenshot cases. It classifies buttons and selects the logo; debug fields `__llm_button_reasoning` and `__llm_logo_reasoning` exist.
  - **Licence and access.** The code is AGPL-3.0, so self-hosting needs a model key. The docs say the hosted API works without a key at low rate limits.
- **Implication for /frontend:** Useful mainly for discovering a customer's logo, favicon and OG image URLs. Its colour and component roles are partly model-inferred and must be verified. It sends URLs to a third party, and it does not output DESIGN.md.
- **Evidence:**
  - [Firecrawl docs, Scrape: branding](https://docs.firecrawl.dev/features/scrape) — Firecrawl, accessed 2026-09-30 via Exa.
    - "The branding format extracts comprehensive brand identity information from a webpage, including colors, fonts, typography, spacing, UI components, and more."
    - "# No API key needed to get started — add one for higher rate limits".
  - [apps/api/src/lib/branding/llm.ts](https://github.com/firecrawl/firecrawl/blob/main/apps/api/src/lib/branding/llm.ts) — firecrawl, HEAD `9892f018`, accessed 2026-09-30 — source.
    - `const modelName = isComplexCase ? "gpt-4o" : "gpt-4o-mini";` and the comment "Use gpt-4o for complex/visual cases (better vision and reasoning):".
  - [apps/api/src/types/branding.ts](https://github.com/firecrawl/firecrawl/blob/e72fe3ac/apps/api/src/types/branding.ts) — accessed 2026-09-30 via Exa — defines `__llm_button_reasoning`, `__llm_logo_reasoning`.
  - `gh api repos/firecrawl/firecrawl` returned `"license":"AGPL-3.0"`.
- **Limits / false positives:** Not run; accuracy unmeasured. Model names may change via its `MODEL_NAME` override.
- **Verification (2026-09-30):** `docs.firecrawl.dev/features/scrape.md` was re-fetched. The branding sentence (line 416) and "No API key needed to get started — add one for higher rate limits" (line 42) are verbatim. The endpoint is `api.firecrawl.dev/v2/scrape`, and the documented profile fields match the list. `llm.ts` at `main` (now `e58f33e3`, the same lines as the cited `9892f018`) has the `modelName` line and the quoted comment verbatim. `branding.ts` at `e72fe3ac` defines `__llm_button_reasoning` and `__llm_logo_reasoning`. `gh api` returns AGPL-3.0.

### FD05-F23 — Static CSS analysers (Project Wallace, CSS Stats) report declared CSS, not the rendered page; CSS Stats is unmaintained
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **Project Wallace.** `@projectwallace/css-design-tokens` 0.11.11 (EUPL-1.2, 2026-08-07) turns CSS text into DTCG tokens with usage counts and the CSS properties each colour is used for. It ignores colours it cannot parse, such as `var()`-composed values. `@projectwallace/css-analyzer` is MIT, 9.9.3.
  - **CSS Stats** (MIT) is a web app whose repo was last pushed 2023-10-07 and whose npm package `cssstats` 4.0.5 was last modified 2022-06-14.
  - **Input.** Both need the stylesheet text, so a live site needs a separate fetch step. Cross-origin sheets block CSSOM reads; 6 were blocked on stripe.com, and 0 `:root` custom properties were readable there.
- **Implication for /frontend:** Use only as a secondary signal, for example to find a site's declared token system and its usage counts. The rendered computed styles stay the primary evidence.
- **Evidence:**
  - [projectwallace/css-design-tokens README](https://github.com/projectwallace/css-design-tokens) — Project Wallace, accessed 2026-09-30.
    - "Create Design Tokens by going through CSS to find colors, font-sizes, gradients etcetera and turn them into a [Design Tokens spec](https://tr.designtokens.org/)-compliant token format."
    - "Colors that can't be parsed by [colordx](https://colordx.dev) are ignored, like `rgb(var(--red) var(--green) var(--blue))`".
  - [cssstats/cssstats README](https://github.com/cssstats/cssstats) — accessed 2026-09-30.
    - "Potentially interesting stats on stylesheets." `gh api` gave `"pushed_at":"2023-10-07T22:17:39Z"`; `npm view cssstats` gave `"version": "4.0.5", "time.modified": "2022-06-14..."`.
  - [stripe.json](evidence/tool-awesome-design-md/live-extraction/stripe.json): `"blockedCrossOriginSheets": 6`, `"rootCustomPropertyCount": 0`.
- **Limits / false positives:** EUPL-1.2 is copyleft for distribution; local use is unaffected.
- **Verification (2026-09-30):**
  - `npm view` confirms `@projectwallace/css-design-tokens` 0.11.11, EUPL-1.2, modified 2026-08-07T07:03Z, and `@projectwallace/css-analyzer` 9.9.3, MIT.
  - `cssstats` is at 4.0.5, modified 2022-06-14, MIT. Its repo was last pushed 2023-10-07T22:17:39Z and is not archived, so "unmaintained" is an inference from activity.
  - Both README quotes are verbatim (css-design-tokens lines 3 and 76; cssstats line 3).
  - `stripe.json` shows 6 blocked sheets and 0 root properties.

### FD05-F24 — `getdesign` is an installer for the pre-made templates, not an extractor, and its README overclaims motion coverage
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - **What it is.** npm `getdesign` 0.6.25 (MIT; npm maintainers omerfarukaplak, necatiozmen) is a "CLI for installing DESIGN.md templates into projects", with `add <slug>` and `list`. It bundles 76 templates: the repo's 74 plus discord and mobbin.
  - **Differences from the repo.** Of the 74 shared slugs, 49 are byte-identical to the repo at `f6961238` and 18 differ only in the `name:` line. 7 differ further:
    - notion, sentry, spacex and vercel also in `description:`;
    - renault in one body line;
    - runwayml and sanity are entirely different files: npm ships newer YAML versions, while the repo keeps the old no-YAML ones.
  - (corrected: the templates are not "byte-identical except the `name` field"; the two hash spot-checks were right but the generalisation was not. Also, the npm username is omerfarukaplak; "omeraplak" is the email handle)
  - **Its own framing.** Its README calls each template "an original, independently authored synthesis of a visual style" and "inspiration files, not official design systems".
  - **Motion claim.** It promises "Motion: durations, easings, hover and entrance patterns", yet only 10 of 74 files mention easing, durations in ms or a Motion section.
- **Implication for /frontend:** Useful only to fetch one of the 7 fintech references quickly. Verify it live (F08) and add motion yourself. The npm copy and the repo copy of the same slug can differ, so record which source and version was used. Set `GETDESIGN_DISABLE_TELEMETRY=1` when calling it (F28).
- **Evidence:**
  - [getdesign on npm](https://www.npmjs.com/package/getdesign) — VoltAgent, 0.6.25, tarball `npm pack getdesign@0.6.25` read 2026-09-30.
    - description "CLI for installing DESIGN.md templates into projects".
    - README: "Each template is an original, independently authored synthesis of a visual style." and "These are **inspiration files**, not official design systems."
    - Hash check: `kraken npm=19b9334fe9 repo=19b9334fe9`, `coinbase npm=985be25859 repo=985be25859`; `diff` for Stripe showed only `name: Stripi-design-analysis` vs `name: Stripi-Inspired-design-analysis`.
  - Motion count: `grep -l -i -E "cubic-bezier|easing|[0-9]{2,3}ms|## Motion" all/*.md | wc -l` returned `10`.
- **Limits / false positives:** The regex may miss motion described without numbers.
- **Verification (2026-09-30):**
  - `npm view getdesign` returns 0.6.25, MIT, maintainers omerfarukaplak and necatiozmen, modified 2026-08-29. The description and README quotes (lines 76, 82, 85) are verbatim.
  - `npm pack getdesign@0.6.25`: `templates/` holds 76 `.md` files plus `manifest.json`.
  - The quoted hashes are SHA-1 prefixes and match (kraken `19b9334fe9`, coinbase `985be25859`). The Stripe diff is only the `name:` line.
  - Full comparison in `evidence/tool-awesome-design-md/verification/getdesign-0.6.25-vs-repo-f6961238.tsv`.
  - The motion regex returns 10 files (meta, minimax, mintlify, miro, mistral.ai, mongodb, notion, starbucks, tesla, theverge). 44 files use a looser motion, animation, transition or duration word somewhere.

### FD05-F25 — A 107-line Playwright `getComputedStyle` script recovered identity tokens on 5 of 5 sites, but Playwright's default "HeadlessChrome" user agent triggers bot walls
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - **What the script does.** My script (107 lines) tallies area-weighted backgrounds, character-weighted text colours, loaded `document.fonts` faces, h1/h2 styles and filled buttons above the fold, skipping cookie and consent containers.
  - **What it found.** It surfaced each brand's main CTA colour, ink and font families on all 5 sites (F08). Revolut's declared `primary` `#494fdf` was not seen above the fold; Revolut's own file says the real primary CTA is a white pill. (corrected: "each brand's primary on all 5 sites" overstated what was observed)
  - **Bot walls.** With Playwright's default UA, `...HeadlessChrome/147.0.0.0...`, coinbase.com and revolut.com served challenge pages ("Vérification de sécurité en cours", "Just a quick security check"). With a normal `Chrome/147.0.0.0` UA the same URLs returned 200 and full pages (binance.com 202).
  - **Third-party widgets.** Some elements were cookie widgets (7 skipped on Stripe, 10 on Kraken).
- **Implication for /frontend:** /frontend can own a small extractor with no heavy dependency and control its weighting. Set a realistic UA and locale, skip consent widgets, record URL, viewport and timestamp per token, and fall back to dembrandt, the Chrome extension or a Wayback snapshot when challenged.
- **Evidence:**
  - [evidence/.../live-extraction/extract.js](evidence/tool-awesome-design-md/live-extraction/extract.js) and outputs [coinbase.json](evidence/tool-awesome-design-md/live-extraction/coinbase.json) (title "Un instant…", h2 "Vérification de sécurité en cours"), [revolut.json](evidence/tool-awesome-design-md/live-extraction/revolut.json) (h1 "Just a quick security check"), [coinbase_ua.json](evidence/tool-awesome-design-md/live-extraction/coinbase_ua.json) (status 200), [revolut_ua.json](evidence/tool-awesome-design-md/live-extraction/revolut_ua.json) (status 200, h1 "Banking & Beyond"), [binance_ua.json](evidence/tool-awesome-design-md/live-extraction/binance_ua.json) (status 202).
  - Default UA check: `default UA: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/147.0.0.0 Safari/537.36`.
- **Limits / false positives:** Bot-defence behaviour varies by IP, time and site. Changing the UA is not a guarantee, and evading defences may breach a site's terms.
- **Verification (2026-09-30):**
  - Re-run with an independent probe: the default Playwright UA was `...HeadlessChrome/147.0.0.0...`.
  - With it, coinbase.com served "Un instant…" (`networkidle` timed out) and revolut.com served "Just a quick security check".
  - With a normal `Chrome/147.0.0.0` UA both returned 200 and the real pages ("L'appli de trading de cryptos la plus fiable"; "Banking & Beyond").
  - Binance was not re-run.
  - The researcher's JSON files show 7 and 10 skipped consent elements for Stripe and Kraken.

### FD05-F26 — Borrow design language, not identity: tool and collection disclaimers and font licensing all point the same way
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - **The collection** disclaims ownership of any site's identity, and getdesign pages state "Not affiliated with or endorsed by" each brand.
  - **dembrandt** tells users to run only where Terms of Service permit automated access, and not to reproduce "third-party brand identities, logos, or trademarks".
  - **Brand fonts are licensed products.** Söhne, Stripe's face, is sold by Klim Type Foundry as desktop, web and app licences, so lifting font files from a customer's site is not a substitute for a licence.
- **Implication for /frontend:** From customer sites, borrow the design language:
  - hierarchy, density and rhythm;
  - component geometry;
  - the domain's visual conventions, such as tabular figures for money.

  Do not borrow identity: logos, font files, brand colour as the protocol's own primary, or distinctive signature visuals. Any mock of a customer's product in a use-case demo should be labelled illustrative (owner decision, see open questions).
- **Evidence:**
  - [awesome-design-md README, License](https://github.com/VoltAgent/awesome-design-md#license) — accessed 2026-09-30.
    - "We do not claim ownership of any site's visual identity."
  - [getdesign.md/stripe/design-md](https://getdesign.md/stripe/design-md) — accessed 2026-09-30 via Exa.
    - "Independent analysis of publicly observable patterns, curated as a starting point for inspiration. Not affiliated with or endorsed by Stripe; Stripe and its logo are trademarks of their respective owner."
  - [dembrandt README, Intended Use](https://github.com/dembrandt/dembrandt#intended-use) — accessed 2026-09-30.
    - "Only run Dembrandt against sites whose Terms of Service permit automated access, or against your own properties. Do not use extracted material to reproduce third-party brand identities, logos, or trademarks. Respect robots.txt, rate limits, and copyright."
  - [Söhne, Klim Type Foundry](https://klim.co.nz/fonts/soehne/) — Klim Type Foundry, accessed 2026-09-30 — foundry page: designer Kris Sowersby, released 2019, formats "OTF Desktop, WOFF2 Web, and TTF App", purchase page `/buy/soehne/`.
- **Limits / false positives:** Not legal advice. The copying policy is covered in depth by a sibling dossier (`policy-copying-and-ip.md`), not reviewed here.
- **Verification (2026-09-30):**
  - README line 256 is verbatim.
  - getdesign.md/stripe/design-md (via Exa) carries the quoted disclaimer verbatim, and getdesign.md/kraken/design-md carries the same wording for Kraken.
  - dembrandt README line 190 is verbatim.
  - Klim's Söhne page lists Design Kris Sowersby, Release date 2019, "OTF Desktop WOFF2 Web TTF App", and Stripe under "Söhne in use". `/buy/soehne/` answers HTTP 200.
  - Supporting observation: commit `e06a9666` ("update design name", 2026-05-17) rewrote 61 `name:` fields to "<Brand>-design-analysis". Six carry altered spellings (Sentri, Shopifi, Slacc, Stripi, Supabaze, Superhumon), and descriptions say "Stripi's", "Sentri's", "Spasex's". The collection itself steps away from using the brand names as identifiers.

### FD05-F27 — Claims that DESIGN.md files greatly improve agent UI are mostly unverified; the one small independent test favoured the stylesheet over prose ban lists
- **Grade:** D · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - **Eric Li.** A practitioner generated 66 report sites across 11 variants of Vercel's skill and judged 60 blind pairs. He found the stylesheet alone "removed nearly every AI-design trope", while the ban list was neutral (2 to 2, two ties) but "did catch em dashes".
  - **NovVista.** A widely shared article claims "95% consistency" with DESIGN.md versus 62% without, over 50 components. It publishes no prompts, code or data.
  - **No controlled study found.** None measures third-party extracted DESIGN.md files such as this collection's.
- **Implication for /frontend:** Do not justify the extraction step by cited benefit numbers. Run /frontend's own fixed-scenario A/B (baseline without the file, first attempts, blind) with the slop checker as the deterministic metric, and expect the CSS layer to carry most of the anti-slop effect.
- **Evidence:**
  - [Eric Li on LinkedIn](https://www.linkedin.com/posts/erictli_vercel-shared-a-design-system-thats-just-activity-7500938592148566016-qly4) — Eric Li, 2026-09-02, accessed 2026-09-30 via Exa — single social post.
    - "Stylesheet (CSS classes and tokens, page shell). On its own, this removed nearly every AI-design trope. It's easily the most valuable piece."
    - "Ban list (no gradients, badge pills, em dashes, all-caps eyebrows). Neutral, 2 to 2, two ties, and somewhat redundant with the craft rules. It did catch em dashes."
  - [DESIGN.md and Production-Quality UI Work with AI Agents](https://novvista.com/design-md-the-new-pattern-that-lets-ai-coding-agents-build-production-quality-uis/) — Ingrid Larsson, NovVista, 2026-04-06, accessed 2026-09-30 via Exa — unverifiable claim.
    - "In a benchmark of 50 real-world components, VoltAgent achieved 95% consistency with the design specification, compared to 62% for the leading AI coding tool without`DESIGN.md`."
- **Limits / false positives:** Both are weak sources. The Eric Li test used report pages only (a commenter notes it does not test stateful screens).
- **Verification (2026-09-30):**
  - Eric Li's post was re-read via Exa: published 2026-09-02; "66 report sites across 11 versions of the skill" and "60 blind pairs". Both quotes are verbatim. The stateful-screens comment is by "Phong Designs AI Systems", 2026-09-03.
  - The NovVista article is by Ingrid Larsson, 2026-04-06, and the quote is verbatim.
  - The article describes DESIGN.md as a component-level spec and calls VoltAgent a tool that "generate[s] production-ready React components", which misdescribes both. Its numbers stay unverifiable, so grade D is fair.

### FD05-F28 — The `getdesign` CLI reports every `add` to getdesign.md by default, and its README does not say so (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:**
  - **What is sent.** In `getdesign` 0.6.25, a successful `add` (all three install modes: custom, root, nested) calls `trackSuccessfulAdd`. It POSTs JSON to `https://getdesign.md/api/cli/downloads` with `eventId`, `brand` (the slug installed), `cliVersion`, `command`, `installMode`, `nodeVersion` and `platform`.
  - **Opt-out.** Telemetry is on unless `GETDESIGN_DISABLE_TELEMETRY` is `1`, `true` or `yes`. `GETDESIGN_TELEMETRY_URL` overrides the endpoint.
  - **Failure handling.** Errors are swallowed after a 1.5 s timeout.
  - **Disclosure.** The 111-line package README never mentions telemetry, tracking or analytics.
- **Implication for /frontend:** If /frontend or /execution ever runs `npx getdesign add`, set `GETDESIGN_DISABLE_TELEMETRY=1`: the slug tells a third party which brand a project is imitating, which matters for NDA and pre-announcement work. Better, fetch the file pinned at a repo commit (F02) and skip the CLI.
- **Evidence:**
  - [getdesign 0.6.25 on npm](https://www.npmjs.com/package/getdesign) — VoltAgent founders, tarball from `npm pack getdesign@0.6.25`, read 2026-09-30 — package source.
    - `src/cli.mjs` line 13: `const DEFAULT_CLI_TELEMETRY_URL = 'https://getdesign.md/api/cli/downloads'`; line 14: `const CLI_TELEMETRY_TIMEOUT_MS = 1500`.
    - Lines 185 to 187: `const disabled = process.env.GETDESIGN_DISABLE_TELEMETRY?.trim().toLowerCase()` / `return disabled !== '1' && disabled !== 'true' && disabled !== 'yes'`.
    - Line 222: `// Ignore telemetry errors; installs should not fail because of analytics.`
    - Calls at lines 267, 278 and 286: `await trackSuccessfulAdd({ brand: selected.brand, installMode: ... })`.
    - `grep -n -i "telemetry\|analytics\|DO_NOT_TRACK\|GETDESIGN_" README.md` returned no telemetry mention.
- **Limits / false positives:** Read from source, not observed on the wire (the CLI was not run). What the server stores is unknown. The payload carries no project path or file content. `list` does not call it.

### FD05-F29 — Anthropic's own Claude Design help articles never mention DESIGN.md: they document codebases, screenshots, decks and brand assets as inputs, and warn that import is "only as good as its source" (added at verification)
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (added at verification)
- **Claim:**
  - **Documented inputs.** "Set up your design system in Claude Design" lists four kinds of source: codebases ("Claude will read the components and styles"), prototypes (screenshots, web flows, design files), slide decks or documents (PowerPoint, PDF), and individual assets (logos, colour palette files, typography specimens).
  - **Documented output.** A "design system (UI kit)" with colour palette, typography, components and layout patterns. The article gives no file structure.
  - **Import route in Claude Code.** "Get started with Claude Design" says design systems come in "from a GitHub repo, design files, raw uploads, or your local codebase using the /design-sync command in Claude Code". Screenshots of "competitor products" are welcome for "make it look like this" requests.
  - **Silence on DESIGN.md.** Neither article names DESIGN.md or a markdown token file. The third-party DESIGN.md upload route and output list (F18) are neither confirmed nor refuted by Anthropic.
  - **Advice relevant to the owner's tells.** The setup article advises: "Include real examples, not just specs. A finished landing page or marketing site tells Claude more about your brand's feel than a color palette alone." The limitations list says: "Design system import is only as good as its source. A messy codebase or an incomplete file will show up in the output."
- **Implication for /frontend:** If Claude Design is plugged in, feed it through the documented routes (`/design-sync` from the repo with the compiled theme CSS, plus screenshots of the chosen customer reference pages) rather than relying on an undocumented DESIGN.md upload. Curate before import, because an extracted file's errors (F08, F09, F20) will be reproduced. This matches F05: a concrete reference beats a palette.
- **Evidence:**
  - [Set up your design system in Claude Design](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design) — Anthropic Help Center, page says "Updated over 3 weeks ago", accessed 2026-09-30 via Exa — official help article.
    - "It extracts reusable components, colors, typography, and patterns from the assets you provide—codebases, slide decks, or other design references—and uses them as the foundation for every project created within your account."
    - "Include real examples, not just specs. A finished landing page or marketing site tells Claude more about your brand’s feel than a color palette alone."
  - [Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) — Anthropic Help Center, page says "Updated this week", accessed 2026-09-30 via Exa — official help article.
    - "Bring in one or several design systems from a GitHub repo, design files, raw uploads, or your local codebase using the /design-sync command in Claude Code."
    - "Design system import: Design system import is only as good as its source. A messy codebase or an incomplete file will show up in the output."
- **Limits / false positives:** Help articles describe intended behaviour, not a measurement, and change often; both carry relative update dates only. "Raw uploads" could include a markdown file; the articles simply do not say. The Artifact "Design System" type seen in this environment (`project/README.md`, `project/tokens.json`) was not cross-checked against these articles.

## Contradictions between sources

- **Tokens, normative or context.** Google's `docs/spec.md` ("The tokens are the normative values") vs Google's `PHILOSOPHY.md` ("The token values serve as context and are not rendering instructions"). Same repository (F04).
- **Extracted, or independently authored.** awesome-design-md README ("extracted from real websites", "The extracted design tokens represent publicly visible CSS values") vs the getdesign npm README ("Each template is an original, independently authored synthesis of a visual style") (F07, F24).
- **Previews.** README "Each site includes" `preview.html` and `preview-dark.html`, and CONTRIBUTING step 5 edits them, vs 0 preview files in the tree since 2026-04-08 (F02).
- **Section layout.** README "Every file follows the Stitch DESIGN.md format with extended sections" and its 9-section table vs 64 of 74 files now using the official spec's section names; only 10 have "Agent Prompt Guide" (F06).
- **Counts.** Badge "73" vs 74 files in the tree vs 76 templates in the npm package. 7 of the 74 shared templates also differ in content between npm and the repo (F01, F24; corrected at verification).
- **Accuracy promises over time:**
  - the first per-site README said "may not be 100% accurate";
  - the April README (preserved in the pre-paywall fork) promised "pixel-perfect UI that actually matches";
  - the current README says "stays visually consistent with the design language".
- **Google's two structures.** Google's own `stitch::extract-design-md` skill mandates numbered sections ("## 1. Visual Theme & Atmosphere") vs Google's spec order (Overview, Colors, ...) (F06).
- **Vercel's gradient.** The extracted Vercel file ("mesh gradient ... It is the brand") vs Vercel's own design.md ("Hard reject decorative gradients, gradient text, glows ..."). Partly explained by scope: marketing site vs agent-built report pages (F11, F12).
- **Stripe buttons.** Stripe file (pills as "the dominant CTA system-wide"; "Don't replace the pill shape") vs live homepage (4px, both on 2026-05-08 and 2026-09-30), while /pricing and /payments do use pills with another primary (F09). (corrected at verification: the file's "non-negotiable" applies to the hero gradient mesh, not to pills)
- **Stripe hero.** The file's gradient mesh "IS the depth system", "a layered SVG or large background image", vs a three.js canvas on the homepage and a `Gradient__canvas` on /pricing and /payments (F10, added at verification).
- **Kraken.** File heading weight 700 vs live 400. The getdesign.md listing calls Kraken a "Purple-accented dark UI" while the file says it "operates on white backgrounds"; live, the largest area is light `#f6f5f9`, with dark bands (F08).
- **dembrandt's own lint test.** Its test asserts that its DESIGN.md passes the upstream linter with no errors, vs 1 error on a real kraken.com extraction. The test uses a synthetic fixture (F20).
- **Motion.** The getdesign README promises a motion section vs 10 of 74 files covering motion (F24).
- **Size of the benefit:**
  - Vercel: 57% fewer known failures, with "Six pages is also far too small a sample" and every page still ship-blocked;
  - NovVista: 95% vs 62%, with no method published;
  - Eric Li: the ban list neutral, the stylesheet decisive (F13, F27).
- **Linter README vs code.** The README's rules table lists `broken-ref` as "error", while the CLI reports unknown component sub-tokens under that rule id as warnings. The code shows this is deliberate, so it is a documentation nuance rather than a bug (F14).

## What could not be found, and how it was searched

- **VoltAgent's extraction pipeline source** (`scripts/derive-examples-block.mjs`, `/generate-kit`, `/preview-design`). Not found:
  - they are absent from the repo tree at `f6961238` (`gh api .../git/trees/main?recursive=1`);
  - the `getdesign` npm tarball. It holds templates, `bin/cli.mjs`, `src/cli.mjs`, `releases/*.json` and `scripts/sync-templates.mjs`. That script copies templates out of a monorepo layout (`design-md/`, `cli/`, `app/data/generated/designs.generated.ts`) of which only `design-md/` is public; none of it is extraction code. (corrected at verification: the earlier text said "templates and `bin/cli.mjs` only")
  - and an Exa search for a maintainer explanation of the method.
- **Stitch documentation pages** (`stitch.withgoogle.com/docs/design-md/overview`, `/specification`, `/format`). They are client-rendered: WebFetch and Exa returned only "Stitch - Design with AI". The GitHub spec was used instead.
- **A tool named exactly "design-extractor".** Not found via `gh search repos "design-extractor"`, `npm search design-extractor` or GitHub DESIGN.md generator searches. The closest match is `jpoindexter/design-md-extractor`.
- **An independent controlled study** of third-party extracted DESIGN.md files and UI quality. Not found via an Exa search for benchmarks and controlled comparisons. Found instead: Vercel (brand-authored file), Eric Li (social post), NovVista (no method), the Design Theater preprint (not DESIGN.md-specific).
- **dembrandt's "32%" heuristic baseline data.** Not in `lib/ml/meta.json` or the repo tree listing; only the docs sentence.
- **Accuracy measurements for Firecrawl branding, superdesign extraction, Stitch URL extraction, design-md-extractor, insane-design and design-md-chrome.** None published. None was run here: hosted tools need accounts or keys; local ones were not installed for disk and time reasons.
- **Anthropic documentation** of how Claude Design or the Design System artifact ingests a DESIGN.md. Found at verification: two Anthropic Help Center articles (F29). Neither mentions DESIGN.md, so the upload route rests only on VoltAgent's third-party description (F18).
- **Live confirmation** of Revolut's `#494fdf` primary and Coinbase's primary CTA pill geometry. Not visible above the fold in my runs.

## Weak spots of this dossier

- **Spot-check scope.** The checks cover homepages at one viewport (1440×900), light mode, a single run per site, from a French IP (some pages served fr locales). Only Stripe was compared against an archive from the file's own date; the others may have drifted since their files were written.
- **Match rule.** "Match" means exact hex equality on my extractor's top values. The area and character weighting is my heuristic, so near-misses count as errors and colours outside the top lists were not assessed.
- **Inter count.** The regex flags 50. A manual review at verification found 5 false positives and 4 false negatives, which gives 49, or 47 if the two borderline files are excluded. See `evidence/tool-awesome-design-md/verification/inter-substitute-manual-review.txt`. (corrected at verification: the earlier "8 of 8 true positives" overstated the precision)
- **Em-dash density** includes template separators. It evidences templated machine prose, not model authorship of every sentence.
- **dembrandt tests** were three homepages, over CDP to Chromium 147 rather than its pinned Playwright browser; `--crawl`, `--dark-mode`, `--mobile` and `--ai` were not tested.
- **Linter version.** Findings are for linter 0.4.0 of an `alpha` spec that has had 3 minor releases in 3 months; rules can change.
- **Vendor data.** Vercel's measurement is vendor-reported and was not reproduced.
- **Weak and secondary sources.** Social and blog sources (Eric Li, NovVista, awesome-claude-design) are graded weak and used for contrast only. Secondary summaries (note.com, techreport.ngo, plushcap) were used only to locate the primary Vercel post.
- **Not verified here:**
  - the Claude Design facts in the task brief (craft rules, Design System structure);
  - the claim that the Artifact "Design System" type differs from what VoltAgent describes.
- **Evidence location.** Evidence files are in `research/evidence/tool-awesome-design-md/`. The 74 source files were not copied; re-fetch them at commit `f6961238d5cddcf8042a74a70fc400ec67181abb` to reproduce `analysis.json` (`analyze.py` expects them in `./all/`). Verification re-runs are in `research/evidence/tool-awesome-design-md/verification/`.

## Dropped at verification

None. No finding rested on a source that failed to support it at all. Ten findings were corrected in place (each carries a "(corrected: ...)" note), and two were added (F28, F29).

## Verification notes

- **Method.** Every finding was re-checked in this session against its primary source, never from memory.
  - **Repositories.** `gh api` and `raw.githubusercontent.com` at pinned commits: `f6961238`, `1145c998`, `3cf71768`, `e2ada214`, `ed3c8649`, `80bbbc23`, `beec066d`, `e06a9666` (awesome-design-md); `9bf8eae6` (design.md); `0337446d` and `f66e8c54` (stitch-skills); `22cb9f93` (dembrandt); `e72fe3ac`, `9892f018` and `main` (firecrawl).
  - **Collection analysis.** The 74 collection files were re-fetched at `f6961238`. A copy of the researcher's `analyze.py`, writing to scratch, reproduced all 22 summary keys of `analysis.json` exactly.
  - **npm.** Registry metadata and tarballs (`npm view`, `npm pack`) for `@google/design.md` 0.4.0, `dembrandt` 0.37.0, `getdesign` 0.6.25, `@projectwallace/css-design-tokens`, `@projectwallace/css-analyzer`, `cssstats`, `@superdesign/cli` and `onnxruntime-node` 1.29.0.
  - **Tools run in scratch.** `@google/design.md` 0.4.0 and `dembrandt` 0.37.0 (optional dependencies omitted) were run: lint over all 74 files, export of Stripe and Supabase, a CDP font-rendering test, and dembrandt on kraken.com over CDP to Chromium 147.0.7727.15.
  - **Independent live probe.** A separate Playwright probe, not the researcher's `extract.js`, re-measured stripe.com, /pricing, /payments, the 2026-05-08 Wayback snapshot, kraken.com, coinbase.com and revolut.com, each with the default and a normal UA where relevant.
  - **Web pages.** curl on markdown endpoints (code.claude.com, docs.firecrawl.dev, vercel.com); Exa fetch for blog.google, getdesign.md, klim.co.nz, the LinkedIn post, NovVista and support.claude.com; the arXiv API plus the v2 PDF text via pypdf.
  - **Artefacts.** All re-run outputs are in `evidence/tool-awesome-design-md/verification/`.
- **Corrections, most consequential first.**
  1. The Summary, F09 and Contradictions misquoted the Stripe file: its "non-negotiable" rule is the hero gradient mesh, not the pill button.
  2. F09 read the /pricing and /payments h1 as a weight-700 headline; it is the 60×26px logo.
  3. F14 understated the linter's error sources ("two rule ids"). There is one error-severity rule, plus model-validation errors for colours, units, dimensions, weights, font families, duplicate paths and nesting.
  4. F24 generalised two hash matches to "byte-identical except name". 7 of 74 templates differ, 2 of them entirely.
  5. F11's regex precision was overstated. The manual count is 49 (47 to 49), not "50 with 8 of 8 true positives".
  6. F03 overstated the spec ("accept only" component tokens), dropped "elevation" from a quoted list and cited a later commit as the skill's first.
  7. F02 ("re-added 84 files"), F07 (all files from the pipeline), F08 (Stripe hero cell, Coinbase share, Kraken faces), F10 ("only one" gradient element) and F25 ("primary on all 5 sites") were narrowed to what the evidence shows.
- **Sources that could not be opened.**
  - The Stitch documentation pages are client-rendered: curl got HTTP 200, but the HTML carries only the title "Stitch - Design with AI". This matches the researcher's report.
  - Everything else cited was opened.
  - Not re-run, as opposed to unopenable: Binance live (checked against the researcher's `binance_ua.json` only); the dembrandt Stripe and Coinbase extractions (checked against the saved outputs); the dembrandt install with `onnxruntime-node` (checked by registry size only).
  - The secondary summaries the researcher used only to locate the Vercel post (note.com, techreport.ngo, plushcap) were not opened.
- **Residual doubts.**
  - **Run-to-run drift.** Live-site counts vary between runs: the Stripe radius tallies (29/28/23 vs 24/26/21), the Coinbase CoinbaseText share (74.0% vs 68.6%), dembrandt's text-style count (44 vs 43), and above-fold CSS gradients (1 vs 0). Any rule should rest on the stable facts, not the counts.
  - **Location.** All live runs came from a French IP, so locale and geolocation affect Stripe, Kraken and Coinbase content.
  - **Judgement calls.** The Inter classification needs judgement for wired and minimax. The F07 statement about the 61 files without residue remains an inference.
  - **Telemetry.** F28 is read from source code; no network capture was made.
  - **Help articles.** The F29 articles carry only relative update dates. They may change, and they do not rule out a markdown upload through "raw uploads".
  - **Environment facts.** The Claude Design facts given in the task brief (craft rules, the Design System artifact structure) were not verified by this dossier or by this check.
- **Process note.** The first `npm install` of playwright-core from the scratch folder resolved to the home directory's `package.json`. It created `C:\Users\Utilisateur\node_modules` (355 packages; directory birth time 22:39:38 on 2026-09-30). The folder was deleted within minutes of creation. The home `package.json` and `package-lock.json` were not modified (mtime 2026-09-24). Later installs used a local `package.json` in the scratch folder.
