# Tells: the rule registry, for the checker, the critics and reviewers

> **Builders never read this file.** It is for the checker, the critics and reviewers. Literal bad examples in rule prose primed models to reproduce them [FD02-F33], and a generic ban only swaps one default for another [FD15-F03], so a builder's brief carries the chosen direction, the tokens and failure shapes, never this catalogue (SKILL.md invariant 11).

Read when: you run, extend or calibrate the checker; you critique a build; you review a waiver, an allowlist entry or a calibration record.

## Purpose
This is the human view of `scripts/rules/registry.json` (version 1, generated 2026-10-01, 51 rules, every one at tier `candidate`). For each rule it says what the static and runtime detectors look at, the documented false positives and the fix direction; then the tier policy, co-occurrence scoring with anchors, exemptions and the waiver format.
The owner's 20 tells come from one social video with no data or method [FD10-F01]; several fire on human-designed exemplars and on a sponsor's own brand [FD11-F19] [critic C11]. Only calibration can say which tells discriminate. `[critic Cn]` cites `research/_critic-round1.md`.

## Rules

### TL-01 - Keep the literal lists out of every builder prompt
- **Rule:** Never paste this catalogue, its patterns, its literal strings or its examples into an implementer's brief, a direction prompt or a generation prompt. Translate a finding into a direction before it reaches a builder ("use the token plan's flat surface", not the name of the tell). Change this split only after a with-and-without ablation on the current model.
- **Why:** A deleted vendor ablation found that literal bad examples in rule prose primed models to copy them, and concluded "describe the failure shape, never enumerate examples of it" [FD02-F33]. Anthropic finds generic negatives swap one default for another and that named patterns work [FD15-F03]. The critic's resolution keeps literal lists in the checker and gives builders failure shapes [critic C7].
- **Check:** critic (briefs are read before a wave starts)
- **Not when:** never.

### TL-02 - Count only rendered usages
- **Rule:** A finding counts when the runtime layer confirms it on the rendered page. A static finding without runtime confirmation reports `confirmed: false` and never fails `tells.tier1` alone. For rules with no runtime detector (SL-G01, SL-G04) the static finding counts as confirmed.
- **Why:** Most source em dashes in the owner's frontends sit in code comments [FD10-F18]; backdrop-blur counts include frosted navigation bars and `data-slot` shows that shadcn is present, not that it is untouched [FD10-F29]. Runtime checks on computed styles are the authoritative layer [FD10-F25].
- **Check:** tells.tier1
- **Not when:** never.

### TL-03 - Keep every rule at candidate until it is calibrated
- **Rule:** A rule's tier changes only from its calibration record (fires on N of M positives, fires on K of the controls, exemplar hits) together with the owner's labels. Until then it is `candidate`: it adds weight to `tells.score` and fails nothing alone.
- **Why:** No threshold in the detector reference has been validated on a positive or a control corpus [FD10 Detector reference]. Krebs's public detector shed rules after they fired on clean sites and still reports about 5 to 10% false positives [FD10-F12].
- **Check:** `node ~/.claude/skills/frontend/scripts/calibrate.mjs` (writes each rule's calibration record)
- **Not when:** never.

### TL-04 - Promote to tier 1 only a rule that is silent on pre-2023 controls
- **Rule:** Tier 1 (fails the gate) needs a rule that fires on the positive corpus (the owner's labelled past frontends, plus synthetic positives from unguided runs) and stays silent on the pre-2023 human-designed controls.
- **Why:** Web design homogenised before LLMs, many tells are human template defaults, and tell studies lack a pre-2023 baseline [FD10-F13]. Krebs dropped the icon-card and all-caps detectors because they "fired more on clean sites than slop" and "fired only on clean" [FD10-F12]. The critic's resolution: a tell becomes tier 1 only once it is silent on the controls [critic C11].
- **Check:** owner review of the calibration record
- **Not when:** never.

### TL-05 - Use current exemplars for allowlists, never for tiers
- **Rule:** Current category exemplars (protocol and fintech first viewports, the event's customers) feed per-category allowlist entries keyed by rule id with a recorded reason. They never decide a tier, except as the cap of TL-06.
- **Why:** Ten exemplar first viewports carry tells 1, 2, 4, 6 and 9 themselves [FD11-F19]. Two control sets: pre-2023 designer work decides tier 1, current exemplars show the category's conventions [critic C19].
- **Check:** owner review of the allowlist entry
- **Not when:** never.

### TL-06 - Default tells 1, 2, 4, 6 and 9 to tier 2 at most, unless the owner overrides
- **Rule:** This is a calibration default, the one documented exception to TL-05: the exemplar evidence caps the tier, it never raises one, and the owner may override it in the calibration record. These pass when the value traces to a named exemplar or to the sponsor's brand, recorded in a waiver. Flag them when they are a framework default, when several co-occur, or, for gradient text, when the gradient sweeps across hues rather than lightness.
- **Why:** Ethena's gradient H1 is a lightness gradient at hues 217-219, Chainlink sets its body text in Inter, Aave, Lido and Stripe use purple-family backgrounds (a visual judgement, loose for Lido), Ethena has a glass nav, Aave and Stripe put a label above the H1 [FD11-F19].
- **Check:** tells.tier2; owner review of the calibration record for an override.
- **Not when:** calibration shows the rule silent on the controls and on the exemplars, or the owner overrides the default in the calibration record.

### TL-07 - Pass a tier-2 finding only with a reasoned, evidenced waiver
- **Rule:** A tier-2 finding passes only when `design/waivers.json` holds an entry for that rule and scope with a non-empty `reason` tied to research, to the brief's own words or to the sponsor's real brand, and a non-empty `evidence`. A tell the brief explicitly asks for is waived with the brief as evidence.
- **Why:** Precedence is the brief's words, then the design system, then the model's choices; a tell requested by the brief or the sponsor's brand is recorded with its reason and does not fail [FD15-F14].
- **Check:** tells.tier2
- **Not when:** a waiver citing a sponsor whose allowlist entry has `claimed_as_mark: true` is refused (TL-10).

### TL-08 - Keep advisory rules advisory
- **Rule:** An advisory rule reports and adds its weight to the score; it never blocks alone.
- **Why:** In 3,033 comments, general sameness is named most and each concrete tell in 2.5% of comments or fewer [FD10-F10].
- **Check:** tells.score
- **Not when:** never.

### TL-09 - Score co-occurrence, anchors double
- **Rule:** `tells.score` sums the weights of confirmed candidate and advisory findings, counts anchor rules double, and fails above `profile.tells.score_max`, which stays null (report only, an advisory gate) until calibration sets it. A rule whose every finding sits where a higher-scoring rule already counted (the same line, the same element) adds nothing: one installed primitive is one decision. Read a single weak hit as a question for the critics, never as a verdict.
- **Why:** Krebs scores co-occurrence in tiers and requires an anchor before a verdict; another public detector lets design patterns only corroborate a stronger anchor, "which is why professional sites using similar-looking modern tooling don't get flagged" [FD10-F12]. Sameness is the dominant complaint, not any single tell [FD10-F10].
- **Check:** tells.score
- **Not when:** never.

### TL-10 - Exempt by file hash, rule id with reason, or waiver; never by colour or name
- **Rule:** The sponsor allowlist (`assets/sponsor-allowlist.json`) exempts only official files matched by SHA-256, that file's own unmodified `<linearGradient>`, or a subtree rendered by an allowlisted SDK. The category allowlist exempts by rule id with a recorded reason. Waivers come from `design/waivers.json`. A gradient copied from a sponsor's decorative brand still fires. Refuse a tier-2 waiver that cites a sponsor whose entry has `claimed_as_mark: true`.
- **Why:** Of the official logo files checked, only Solana's colour logos carry a gradient, and Solana claims its gradient as a mark; the Cardano Foundation's and Ledger's gradients are organisational decoration, not logos [FD21-F24, FD21-F13, FD21-F14]. Gate design in [FD21 How the gates use it].
- **Check:** tells.tier1, tells.tier2
- **Not when:** never.

### TL-11 - Scope T18 to display text
- **Rule:** SL-T18 fires only on the largest heading (32 px or more) that mixes two families, roman and italic, or two paints. Italic or serif emphasis in running prose never fires.
- **Why:** The critic found a named expert's blog setting prose emphasis in serif italic and resolved to scope T18 to display text [critic C11]; FD10's runtime check already reads the largest heading only [FD10 Catalogue: the owner's 20 tells].
- **Check:** tells.score (until tiered)
- **Not when:** never.

### TL-12 - Scope T06 to card-sized glass
- **Rule:** SL-T06 fires on card-sized elements with backdrop blur and a translucent background, and skips sticky full-width navigation bars and overlays on media. Weight the co-occurrence of a glass card, a vivid gradient ground and a light 1 px border.
- **Why:** Glassmorphism is a 2020 human trend with legitimate uses; Krebs's detector skips frosted headers "common in non-slop design (Linear, Vercel, GitHub)"; a practitioner reads glass with a gradient ground and a light border as AI [FD10-F22].
- **Check:** tells.score (until tiered)
- **Not when:** never.

### TL-13 - Count T16 on rendered text with a minimum word count
- **Rule:** SL-T16 counts U+2014 in rendered text only (comments, code and empty-value placeholders excluded), applies the /prose PR-01 rate only above a minimum word count, and reports both the raw count and the density. Labels made of a word, a spaced U+2014 and a fragment are reported separately.
- **Why:** Most source em dashes sit in comments, one non-comment hit was an empty-value placeholder, and thresholds differ about fivefold across tools [FD10-F18]. No density is proven on short pages; the critic asks for rendered copy, a minimum word count, and both numbers [critic C13].
- **Check:** tells.score (until tiered)
- **Not when:** quoted text and proper names.

### TL-14 - Treat fonts as a recorded-reason rule
- **Rule:** SL-T04 and SL-T19 are questions ("was this face chosen from the research?"), answered by a waiver or an allowlist entry with the reason, never a ban.
- **Why:** The tell fonts appear on three lists that disagree, and brand fonts on human sites are their false positives [FD10-F20]. Anthropic's docs accept Inter when a design system names it [FD15-F13]. Chainlink suggests Inter as its substitute font and Masumi builds on Inter [FD21-F08, FD21-F26]. The critic resolution makes T4 and T19 "needs a recorded reason" rules [critic C11].
- **Check:** tells.tier2 once tiered; tells.score until then
- **Not when:** never.

### TL-15 - Never let T08 block alone
- **Rule:** SL-T08 reports only in combination with other findings; it never becomes a standalone blocking rule.
- **Why:** The three-icon row was a Bootstrap example in 2021, and Krebs's equivalent detector fired more on clean sites than on slop [FD10-F26, FD10-F12].
- **Check:** tells.score
- **Not when:** never.

### TL-16 - Let the owner define T15; ship spacing checks as reports
- **Rule:** Until the owner defines tell 15, run three report-only checks: the share of margin, padding and gap values off the 4 px grid with the count of distinct section paddings; one dominant gap value; heading rhythm.
- **Why:** Sources disagree on the direction of the tell (inconsistent against monotonous spacing) and no validated spacing detector exists [FD10-F27]. The critic leaves the definition to the owner [critic C11].
- **Check:** tells.score
- **Not when:** never.

### TL-17 - Leave the motion tells their legitimate uses
- **Rule:** SL-T12 does not fire on one orchestrated load moment or on a scroll-driven diagram that explains the mechanism. SL-T13 does not fire on chart crosshairs, maps, games or 3D viewers. Whether a named expert's marketing exceptions (one-shot reveals, spring-smoothed pointer tracking) apply is the owner's decision.
- **Why:** FD10 lists these false positives and notes that one orchestrated load sequence or an explanatory scroll-driven diagram is a legitimate purpose [FD10-F25] [FD10 Catalogue: the owner's 20 tells]. The critic records the expert's exceptions and leaves them to the owner [critic C11].
- **Check:** owner review
- **Not when:** never.

### TL-18 - Grow the registry from observed fallbacks
- **Rule:** After each generation run, log which default replaced a pattern the checker caught, and propose it as a candidate rule once a research finding supports it.
- **Why:** Anthropic: a generic instruction "mostly swaps one default for another"; check which styles the first result used instead and extend the list [FD15-F03].
- **Check:** owner review
- **Not when:** no finding supports the pattern: record it as an observation for the next research round, not as a rule.

### TL-19 - Report each finding so a critic can act on it
- **Rule:** Every finding carries the rule id, the selector (runtime) or `file:line` (static), the computed values, and for runtime a cropped tile.
- **Why:** FD10's detector reference: "Report each candidate with a selector, the computed values and a cropped screenshot. For static hits, report file:line" [FD10 Detector reference].
- **Check:** tells.score (finding shape per CONTRACTS 5)
- **Not when:** never.

## Scoring, exemptions and waivers (CONTRACTS 5 and 6.2)
- `tells.tier1` fails when a tier-1 rule has a confirmed finding not covered by an exemption.
- `tells.tier2` fails when a tier-2 rule fires with no waiver whose `reason` and `evidence` are non-empty.
- `tells.score` = sum of weights of confirmed candidate and advisory findings, anchors counted twice; fails above `profile.tells.score_max` (null means report only).
- Anchors on 2026-10-01: SL-T02, SL-T11, SL-T16, SL-M04, SL-G01, SL-G02, SL-G03, SL-X01, SL-X02.
- Waiver entry (`design/waivers.json`):
  `{"waivers": [{"rule": "SL-T04", "scope": "<route or selector>", "reason": "<the finding, brief line or sponsor rule>", "evidence": "<path, URL or dossier id>", "approved_by": "owner|research", "date": "<YYYY-MM-DD>"}]}`
- Calibration record per rule (in `registry.json`):
  `{"positives": {"fired": 0, "total": 0}, "controls": {"fired": 0, "total": 0}, "exemplars": {"fired": 0, "total": 0}, "date": null, "notes": ""}`

## Catalogue
Basis: SL-T01 to SL-T20 follow [FD10 Catalogue: the owner's 20 tells]; SL-M01 to SL-M17 follow [FD10 Catalogue: tells missing from the 20]; SL-C01 to SL-C03 follow [FD15 Anthropic-named tells missing from the owner's list]; SL-G01 [FD13-F33]; SL-G02 [FD10-F06] for the create-next-app defaults; SL-G03 [FD18-F05] [FD18 Checker hooks]; SL-G04 [FD10-F09]; SL-X01 [FD01-F12]; SL-X02 [FD10-F28]. Each row's full `sources` list is in `registry.json`. The motion rows rest on dossiers this file does not restate (the registry's `sources`); their builder-facing rules are in `08-motion.md`. "S:" is the static detector, "R:" the runtime one; one description covers both layers when the registry gives one scope. Allow: `hash` sponsor allowlist, `cat` category allowlist, `-` none. Weight: `A` marks an anchor.

| id | tell | looks at | false positives | fix | allow | weight |
|---|---|---|---|---|---|---|
| SL-T01 | Purple-to-blue gradient | S: gradient utilities (`bg-gradient-to-*`, `bg-linear-*`) from purple, violet or indigo to blue or cyan; Tailwind default hexes and oklch hues in `linear-gradient`. R: visible stops with hue 250-300 and saturation above 0.25 sweeping into blue or cyan, weighted on filled CTAs and heroes | sponsor files matched by hash; data-viz ramps | solid fills from the token plan; one accent | hash | 2 |
| SL-T02 | Gradient hero text | S: `bg-clip-text` with a gradient or `text-transparent`; CSS `background-clip: text` with `gradient(`. R: computed text clip with a gradient background, strongest on h1 and h2 of 32 px or more | a wordmark set as text; one documented display treatment; a lightness-only gradient [FD11-F19] | solid colour; hierarchy through size and weight | - | 2A |
| SL-T03 | Emojis in headings | S: Extended_Pictographic in h1-h6 or in title, heading and label strings. R: the same in h1-h6 and `[role=heading]`; emoji-led navigation | emoji or chat products; quoted or user content; flags in a country picker | remove; icons only where they carry meaning | cat | 1 |
| SL-T04 | Inter everywhere | S: Inter through next/font, @fontsource, a Google Fonts URL, rsms.me or `font-family`. R: Inter as the only rendered family (CDP), stronger with a centred hero | a deliberate UI type system; a sponsor that uses or suggests Inter | a display face from the brand research, with a recorded reason | cat | 2 |
| SL-T05 | Coloured border cards | S: side-border classes of 2 px or more with a radius class on the same line, else 4 px or more; CSS side border of 3 px or more, non-neutral; cards whose whole border is tinted with a hue at any alpha, two cards or more, status colours excepted (FD14-F23 b); gradient borders, a saturated gradient behind a 1-2 px padded wrapper or on the border box (c). R: left or top stripe of 2 px or more, over 1 px wider than the other sides, saturated, on an element holding a heading; blockquote, footer, table and button skipped | callouts, active tabs, timelines, dashboard severity | remove the stripe; if it encodes status, add a label | cat | 1 |
| SL-T06 | Glassmorphism cards | S: `backdrop-blur` with a translucent background; `backdrop-filter: blur(`. R: card-sized (150-820 by 40-900 px) blur of 2 px or more with background alpha 0.02-0.9; sticky full-width bars skipped | frosted navigation bars; overlays on media | opaque surfaces; glass only where layering is real | cat | 2 |
| SL-T07 | Low-contrast dark mode | S: grey 500-700 text classes in dark sections; white text at 10-40% alpha. R: dark body (luminance below 0.2) with 12% or more of body text below 7:1 | dark-first trading or IDE products | lighter text steps on dark grounds; fewer grey levels | - | 1 |
| SL-T08 | Three icon boxes in a row | S: a three-column grid mapped over items with an `icon` field; a filled icon wrapper. R: 3 or 6 equal-width siblings, each an 8-48 px svg in a filled 20-72 px wrapper above a heading | very common on human sites; real triplets; pricing | structure from content: one dominant feature with a real demo | cat | 2 |
| SL-T09 | Badge above the headline | S: Badge or pill classes within about 15 lines before the h1; uppercase with tracking. R: a pill, boxed or small-caps element within 220 px above the h1 | a real, checkable status linked to proof; breadcrumbs | delete, fold into the headline, or link it to proof | cat | 2 |
| SL-T10 | Lucide icons everywhere | S: `lucide-react` in package.json and its import count. R: rendered `svg.lucide` count; decorative icons per heading | a consciously chosen set used on actions | fewer icons, on actions; custom glyphs for protocol concepts | - | 1 |
| SL-T11 | Untouched shadcn UI | S: components.json with default tokens (radius 0.625rem, primary oklch(0.205 0 0), dark background oklch(0.145 0 0)); registry-identical components; hover at /90 alpha while every theme's `--primary` is still a registry default or a generator palette primary. R: `[data-slot]` present with computed tokens equal to the defaults; hover alpha 0.8 or 0.9 | shadcn with customised tokens; internal tools | tokens from brand research first, then components | - | 2A |
| SL-T12 | Fade-in on scroll | S: `whileInView`, `useInView(`, initial opacity 0, `data-aos=`, `new IntersectionObserver(`, BlurFade. R: text hidden at rest (opacity below 0.1) that appears after a scroll-through; IntersectionObserver wrapped by an init script | one orchestrated load moment; a scroll-driven diagram that explains the mechanism | content visible by default; motion only where it explains | - | 2 |
| SL-T13 | Cursor-following beam | S: pointer or mouse move handlers next to `radial-gradient(` or custom-property writes; effect component names. R: move listeners (CDP) that change background, transform or custom properties along a synthetic mouse path | chart crosshairs, maps, games, 3D viewers | remove, or make hover reveal real protocol data | cat | 1 |
| SL-T14 | Buttons fade on hover | S: hover opacity or alpha-background classes on buttons and links; `transition-opacity` on buttons. R: a CTA hover that changes only opacity or background alpha | ghost buttons; a design system that specifies it | a state change with intent (darken by token, press scale), hover gated | - | 1 |
| SL-T15 | Inconsistent spacing | S: arbitrary spacing values; distinct section paddings. R: share off the 4 px grid; distinct section paddings; heading rhythm | `clamp()` fluid spacing; optical tweaks; embeds | spacing and section-rhythm tokens | - | 1 |
| SL-T16 | Em dashes everywhere | S: U+2014 and its entities in JSX text and string literals, comments stripped. R: U+2014 per 1,000 words of rendered text above the /prose PR-01 rate, with a minimum word count; word, spaced U+2014, fragment labels | quoted text; proper names; non-English copy | rewrite; /prose on `ui-copy.md` | - | 2A |
| SL-T17 | Generic buzzword copy | S: impeccable's phrase list and promotional words. R: the same on rendered text, plus specificity: the line names no mechanism, user, number or sponsor | quoting a sponsor's tagline | specific verbs and nouns | - | 2 |
| SL-T18 | Serif italic accents | S: em, i or span with a serif or italic class inside h1 or h2; italic display weights imported. R: the largest heading (32 px or more) mixes two families, roman and italic, or two paints | editorial or literary brands; prose emphasis | one family with weight contrast, or no accent | cat | 2 |
| SL-T19 | Space Grotesk + Instrument Serif | S: imports of the dated reflex list (Space Grotesk, Instrument Serif, Fraunces, Bricolage Grotesque, Syne, Sora, Young Serif). R: the rendered heading font, or 25% or more of text, in that list | brand-mandated fonts with a recorded reason | choose from the brand research and record why | cat | 2 |
| SL-T20 | Grain over a gradient | S: `<feTurbulence`, noise or grain assets, a low-opacity blend overlay. R: a full-size overlay (pointer-events none, opacity below 0.3) with noise over a gradient | film, print or photographic brands | flat surfaces or real imagery | cat | 1 |
| SL-M01 | Cream + serif + clay | S: warm ground hex near #F4F1EA or #FAF9F5; accent near #D97757. R: a warm light ground with a serif display and a clay accent | editorial, food and craft brands | palette from research | - | 1 |
| SL-M02 | ALL-CAPS tracked eyebrow above every heading | S: uppercase with tracking at 10-12 px. R: an uppercase label with letter-spacing of 0.5 px or more directly above h2 or h3, counted per section | Krebs dropped all-caps headings for firing on clean sites | at most one eyebrow per three sections, or none | - | 1 |
| SL-M03 | Numbered 01/02/03 markers | S: zero-padded numerals or "Step 1" beside headings. R: ascending numbered markers beside headings that are not a real sequence | a real sequence (a process, a flow) | numbers only where order is information | - | 2 |
| SL-M04 | Stat banner with invented numbers | S: number-ticker components; round-number literals such as "10K+" or "99.9%". R: 3-6 siblings with numeric text of 22 px or more (not prices or ordinals) without `data-ledger` or `data-source` | real, sourced metrics | real, linked data or none | - | 2A |
| SL-M05 | Fake testimonials, avatars, "Trusted by" walls | S: testimonial arrays with names; avatar-generator URLs; "Trusted by". R: logo rows without links; quote cards with names absent from the research | real partners with permission | omit; cite real relations only | - | 1 |
| SL-M06 | FAQ accordion with 3+ items | `details` or Accordion blocks under a "Frequently asked" heading | genuine support content | answer inside the product narrative | cat | 2 |
| SL-M07 | SaaS-card kit | S: `rounded-xl` or `-2xl` with `shadow-md` or `-lg` repeated on many siblings. R: many sibling cards with one radius and an rgba(0,0,0,0.1) shadow | real design systems with one radius | radius and shadow by hierarchy; fewer containers | - | 1 |
| SL-M08 | Near-black + zinc dark default | S: #0a0a0a, oklch(0.145 0 0), zinc-950 or black grounds with zinc-400 text. R: a neutral body background with luminance below 0.01 | dark-first products | ground and neutrals from brand research | - | 2 |
| SL-M09 | Coloured glows, halos, blurred blobs | S: coloured glow shadows; large blur on absolute coloured circles. R: 2 or more decorative elements with blur of 15 px or more and saturation above 0.3 | brand light effects in media products | neutral elevation; no decorative blobs | - | 2 |
| SL-M10 | Logo or text marquee | S: marquee components and keyframes. R: a continuous translateX animation on a repeated row | real partner lists | a static, linked list | - | 1 |
| SL-M11 | Bento grid | S: bento components; mixed column spans. R: a grid of more than 4 cells with unequal spans | content with real hierarchy | use only when the content has that shape | cat | 1 |
| SL-M12 | Centred hero + "Get started" + "Learn more" | a centred h1 with that two-CTA pair | a common human convention | the hero shows the protocol working | - | 2 |
| SL-M13 | Template chrome | S: a U+2192 arrow at the end of button text; U+00B7 meta joins; uppercase monospace labels at 10-11 px. R: the same on rendered text and computed families | real metadata lines; monospace for hashes and addresses | plain labels | - | 1 |
| SL-M14 | Grid-line background, pulsing dot, blinking cursor | S: tiled 1 px line gradients with a fixed size; pulse on 6-10 px dots; blink animations. R: the same rendered, with pulses not bound to live data | blueprint products; real live indicators | remove, or bind to real state | - | 1 |
| SL-M15 | Nested cards | a bordered or filled container inside another at 2 or more levels | dashboards with real grouping | flatten; use spacing | cat | 1 |
| SL-M16 | Shape-assembled SVG, div-built fake screenshots | a hero-sized inline SVG with many primitives; div "window" mockups | diagrams, icons, logos | real screenshots, a live demo or a protocol diagram | - | 1 |
| SL-M17 | "Built for X" / "Trusted by" headline formulas | a phrase match on rendered headings | a real audience statement | say what the protocol does and for whom | - | 1 |
| SL-C01 | Pill buttons everywhere | most buttons with a border-radius of at least half their height | a brand that uses pills deliberately | radius by role from the tokens | cat | 1 |
| SL-C02 | 100vh hero | a first section at least as tall as the viewport (`h-screen`, `min-h-screen`, `100vh`) | full-bleed product canvases | hero sized to content; proof visible in the first viewport | cat | 1 |
| SL-C03 | Everything centred | R only: the share of centred text blocks across sections | short one-column landing pages | alignment from the category's conventions | cat | 1 |
| SL-G01 | Figma Make export signatures | S only: version-pinned import strings, `ImageWithFallback`, `Attributions.md`, the export's guard selector, the Figma file name as `<title>` | none in shipped code | treat the export as a wireframe; replace the visual layer | - | 2A |
| SL-G02 | Starter-template leftovers | starter titles ("Create Next App", "Vite + React"), #aa3bff, the default Geist import, default favicons by normalised hash | none in shipped code | the project's own assets | - | 3A |
| SL-G03 | Prebuilt wallet-connect defaults | "Awesome DApp", `awesome-dapp-url.tld`, "Powered by Mesh SDK", `mesh-dark`, `alert(` in connect flows, default kit themes | a kit fully themed from tokens; `alert(` and "Powered by" in unrelated bundles: scan first-party source and chunks with a wallet-kit marker, report other hits as candidates | an own connect dialog on the chain's hooks | - | 3A |
| SL-G04 | Effect-catalogue components | S only: imports or copies of React Bits, Magic UI or Aceternity components not bound to product state | an effect that encodes real state (a 120 ms flash on a real value change) | remove, or bind to real state | - | 1 |
| SL-X01 | Unsourced metric | S: numeric literals in hero copy. R: stat-styled numeric text, or `data-metric`, without `data-ledger` or `data-source` | prices, dates, versions, ordinals | only numbers from the claims ledger or a labelled data source | - | 3A |
| SL-X02 | Placeholder names and copy | Acme, John Doe, Jane Doe, lorem ipsum, TODO, example.com, bracketed "YOUR" slots in rendered text | test fixtures that never render | real content from the brief, or the visible "not yet verified" state | - | 3A |
| SL-MO1 | `transition: all` on interactive elements | computed `transition-property: all` on buttons and links | rare legitimate uses | explicit properties | - | 1 |
| SL-MO2 | ease-in on UI entrances | entrance animations with ease-in timing | exits along the same path | ease-out tokens | - | 1 |
| SL-MO3 | UI durations of 500 ms or more | transitions and animations of 500 ms or more on UI elements, page-level motion and full-height sheets excepted | toasts near 400 ms; full-height sheets at 500 ms | role budgets: press 160, tooltip 200, dropdown 250, modal 300 ms at most | - | 1 |
| SL-MO4 | Entrances from scale(0) | keyframes or transitions that start at `scale(0)` | none for UI | start at `scale(0.9)` or more, with opacity | - | 1 |
| SL-MO5 | Motion without reduced-motion handling | animations that run unchanged under `prefers-reduced-motion: reduce` | opacity or colour changes only | gentler motion under reduce; content visible | - | 2 |

## Procedure

Review a tells report (critic or reviewer):
1. `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates tells --serve <ui>/dist --profile <abs profile>`
2. For each finding: confirmed by the runtime layer (TL-02)? Covered by a hash, a category entry or a waiver (TL-10)? At which tier?
3. Pass only the findings that matter to the critique (anchors first, then by weight), each with its selector or `file:line` and the fix written as a direction, never as the tell's name (TL-01).

Promote a rule:
1. `node ~/.claude/skills/frontend/scripts/calibrate.mjs` and read the rule's calibration record.
2. Fires on positives and on no control: propose tier 1 to the owner (TL-04). Fires on exemplars only: propose category allowlist entries (TL-05). Fires on controls: keep it a candidate or advisory and fix the detector.
3. The owner decides; change `tier` in `registry.json`, then re-run `calibrate.mjs`, `pnpm test` and `pnpm run typecheck` from `scripts/`.

Add a rule:
1. Start from a finding in `research/` with an external source; never from memory (SKILL.md, Maintaining).
2. Add the registry entry with `tier: "candidate"`, its scope, false positives, fix and sources (CONTRACTS 5).
3. Write `rules/static/<ID>.mjs` and/or `rules/runtime/<ID>.mjs`, a positive and a negative fixture under `tests/fixtures/rules/<ID>/`, and a test that fires on the positive and stays silent on the negative (CONTRACTS 7).
4. Run `pnpm test`, `pnpm run typecheck` and `calibrate.mjs`, then add the row to this catalogue.

## Gaps
- No rule has been run on a rendered positive or control corpus; every tier and threshold is a candidate [critic M1] [FD10 Detector reference].
- With every rule at `candidate` and `score_max` null on 2026-10-01, `tells.tier1` and `tells.tier2` cannot fail and `tells.score` returns ok with "report only" in its detail (CONTRACTS 4 v1.1), so critics must read the findings themselves.
- FD10-F12's practice (no verdict without an anchor) is stricter than CONTRACTS 5's doubling of anchor weights; calibration should settle which applies [FD10-F12].
- No controlled study measures how a single UI tell changes a viewer's or a judge's rating [FD10 What could not be found].
- The priming result was observed on copy phrases with small models; whether naming visual tells in a prompt plants them is untested [FD02-F33].
- Tell 15's definition and the expert exceptions for tells 12 and 13 wait for the owner [critic C11].
- Hedera's purple-to-blue brand gradient, cited in ARCHITECTURE, is not in the sponsor research, so no hash exemption exists for it [FD21 What could not be found].
