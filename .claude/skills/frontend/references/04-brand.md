# Brand: wordmark, favicon set, OG image and name checks

Read when: P3 brand (FE-05 brand candidates, FE-06 the owner's pick H2), and any task that creates or changes the
logo, the favicon set, the web manifest, the OG image or the project's name, or that places a sponsor mark near the
project's own.

## Purpose
A new mark carries no meaning for a jury: it identifies, the page explains. Draw a wordmark from an open-licensed face
with one intervention, derive a favicon mark from it on a 32-unit grid, render 3 to 5 candidates with measured checks,
and let the owner pick (H2). Ship a complete favicon set, an OG image and a `brand/` folder with a drift test. Name
and lookalike checks report risk, never "clear". Sponsor marks never touch the project's mark.

## Rules

### BR-01 - Keep the mark an identifier and its budget short
- **Rule:** The mark identifies the project; it does not explain the mechanism. Draw no chains, nodes, flows or other
  illustrations. Spend one short loop on it and put the saved time into the hero, the demo and the feature map.
- **Why:** A logo points and designates, complexity defeats it, and meaning comes only after exposure [FD12-F01]. A
  new logo is an "empty vessel" a jury will not fill [FD12-F04]. Airey asks for "just one feature" [FD12-F03].
- **Check:** critic; each candidate states "the one feature is ..." in one line (brand.candidates).
- **Not when:** no exception.

### BR-02 - Start from the final name
- **Rule:** Begin candidates only when `brief.json` has `project.name_status: "final"`. While it is `working` or
  `pending`, the brand task is blocked: file a manual rename task (mode A) or ask (mode B), and run only the name
  checks (BR-19). Meaning may come from the name's sense or from one measured number already in the claims ledger.
- **Why:** The logo task depends on the name; the Origins primary must be renamed before anything else, and the BNB
  mark encodes a measured 2.99 h delay [FD13-F15]. A hackathon product name must also stay clear of sponsor marks
  [FD21-F04].
- **Check:** brand.candidates (fails while `name_status` is not `final`).
- **Not when:** no exception.

### BR-03 - Draw a wordmark with exactly one intervention
- **Rule:** Default to the project name set in one face, changed in exactly one way: a colour, an unusual letter
  arrangement, a graphic accent or custom lettering. Record the intervention in one line. The favicon mark is the
  wordmark's initial or a monogram from its letters. Add a separate symbol only for a reason written in
  `brand/README.md` (a long name, a family of products).
- **Why:** C&G&H build a symbol only for a "compelling strategic reason", start from the name with one simple
  intervention, and report that typographic marks ease clearance [FD12-F02]. An untouched open-font wordmark can be
  retyped by anyone [FD12-F14].
- **Check:** brand.candidates (one `intervention` per candidate); owner review (H2).
- **Not when:** the owner asks for a symbol.

### BR-04 - Use an open face you may outline, and keep its licence
- **Rule:** Take the face from the direction's type plan (03-directions.md, 05-tokens.md), licensed OFL 1.1, Apache
  2.0, UFL or MIT (the set `ip.fonts` accepts), and keep its licence file in `brand/`. Never a Fontshare FFL face, a
  commercial webfont (including one seen in a customer's `@font-face`) or a font from a sponsor kit. A face on the
  checker's dated reflex list needs a written reason in `brand/README.md`. Credit the designer and foundry in
  `brand/README.md` when the face comes from Velvetyne.
- **Why:** The OFL allows logos with no permission or attribution [FD12-F14] [FD09-F19]. Commercial web licences bind
  to the licensee and can exclude logos [FD09-F18]. FFL 2.0 counts changes to glyphs and to "the typeface designs
  embodied therein" as Derivative Work [FD16-F12]. Sponsor-kit fonts carry non-transferable licences [FD21-F15]. The
  reflex faces are the owner's tells 4 and 19 [FD12-F14]; tell-font lists move, so a hit needs a reason, not a ban
  [FD16-F14]. Velvetyne asks for credit [FD16-F11].
- **Check:** ip.fonts; ip.provenance; `tells` (rules SL-T04, SL-T19).
- **Not when:** no exception.

### BR-05 - Outline every glyph and ship no `<text>`
- **Rule:** Outline the wordmark with opentype.js 2.0.0: `font.getPath(text, 0, 0, 100, { kerning: true })
  .toPathData({ decimalPlaces: 2, flipY: false })`. Fail when the path data contains `NaN`. Render the result once and
  look at it. Store the text, font file, weight and size next to the outlined SVG so it can be regenerated. Prefer a
  static instance of the face.
- **Why:** With the default `flipY`, opentype.js 2.0.0 writes literal `NaN` coordinates and draws a garbled shape;
  only one static font was tested, no variable font [FD12-F15]. SVG favicons load in secure static mode with no
  external resources, so text must be paths [FD12-F22].
- **Check:** brand.candidates.
- **Not when:** no exception.

### BR-06 - Draw the favicon mark on a 32-unit grid, black first
- **Rule:** `viewBox="0 0 32 32"`, even coordinates, a few solid primitives, strokes and gaps of at least 2 units
  (1 px at 16 px). Draw the silhouette in one colour, then add colour.
- **Why:** A grid-aligned solid mark kept a solid share of 1.0 at 16 and 32 px, while 1-unit and 0.8-unit gradient
  strokes rendered no solid pixel [FD12-F16]. Every model degrades as SVG complexity rises [FD12-F08]. Haviv and
  Airey design in black and white first [FD12-F02] [FD12-F03]; Rand requires a mark "reproducible in one color and in
  exceedingly small sizes" [FD12-F01].
- **Check:** brand.candidates.
- **Not when:** no exception.

### BR-07 - Lint every candidate: hard fails and look-twice flags
- **Rule:** Hard fails: `<linearGradient>`, `<radialGradient>`, shading or a filter; `<text>`, `<image>`, an external
  `href` or a script; a stroke or gap under 2 units; an open path, a path outside the viewBox, a zero-area or duplicate
  path, an element fully hidden by a later one; output that SVGO would still change. Look-twice flags, which pass only
  with a written reason tied to the protocol: a shape the crypto category repeats so often it identifies nobody, a
  stock library icon used as the mark, and any geometry, gradient or framing taken from a sponsor's brand.
  `brand.candidates` names each flagged shape in its finding; answer it in the candidate file.
- **Why:** Gradients and shading fail across media and at 16 px [FD12-F02] [FD12-F16]. Generated SVG hallucinates
  and occludes primitives [FD12-F11]. 13% of top-500 crypto logos strike an initial through; pyramids, hexagons and
  rehashed shapes recur [FD12-F05]. A stock glyph as a mark is the tell-10 reflex, and Remix Icon's licence forbids it
  [FD16-F20]. Cardano forbids borrowing its design [FD21-F04], Solana claims its gradient [FD21-F13], Ledger's
  brackets mean "made possible by Ledger" [FD21-F17], and the BNB precedent borrows no geometry [FD13-F15].
- **Check:** brand.candidates.
- **Not when:** a look-twice flag carries a written reason in the candidate file.

### BR-08 - Render and measure every candidate
- **Rule:** Render each favicon mark at 16, 32, 180 and 512 px, plus a one-colour silhouette, on `#ffffff` and on a
  dark ground, and 16x nearest-neighbour enlargements of the 16 and 32 px renders. Measure the solid share (fully
  opaque over inked pixels) at 16 and 32 px and the maximum ink radius on a 512 canvas. Treat a low solid share as a
  review flag, not a failure.
- **Why:** "Think small" becomes a test at these sizes, and logos are exempt from WCAG contrast, so no a11y gate sees
  a faint favicon [FD12-F03] [FD12-F16]. Round and diagonal marks score lower (a disc gave 0.774 at 16 px) and no
  threshold is calibrated [FD12-F16].
- **Check:** brand.candidates.
- **Not when:** no exception.

### BR-09 - Review defects with measurements, at most twice; the owner picks
- **Rule:** Produce 3 to 5 candidates. Give the reviewing model the renders plus the measured values (solid share,
  ink radius, bounding boxes, lint output) and ask only for defects: clipped strokes, counters merged at 16 px,
  off-grid edges, weak contrast on light or dark tabs. Stop after 2 rounds. The owner picks (H2); never rank by a model
  score, never ship a first generation unchanged.
- **Why:** VLM judges correlate weakly with humans on text-to-SVG (0.11 to 0.40 as printed, at most 0.55 recomputed),
  below sketch fidelity [FD12-F09]. Free revision added 1 to 2 points; structured external cues gave most of the gain
  [FD12-F10]. Machine logos lose on differentiation [FD12-F06].
- **Check:** owner review (H2, recorded in `<state>/choices.json`); brand.candidates (3 to 5 present).
- **Not when:** small mode: 3 candidates and one round [FD12-F04].

### BR-10 - Use Recraft only when the owner opts in, on a paid account
- **Rule:** Default: no Recraft. If the owner opts in and supplies an API key, use the API or a paid plan, never the
  free web app or an MCP call from a free account. Record the account type in `brand/README.md`, opt out of training
  if the owner asks, and put every output through BR-05 to BR-09. Prices: $0.08 per Vector SVG ($0.40 for five),
  $0.30 for Pro Vector, $0.01 to vectorise a photo of a hand sketch.
- **Why:** Free-tier images belong to Recraft and are public; API and paid outputs are assigned to the user with a
  no-training clause; MCP output follows the account's plan [FD12-F13]. Prices [FD12-F12]. A vectorised hand sketch
  keeps a human-authored input in the chain [FD12-F07].
- **Check:** owner review; ip.provenance (`tool`, `ai`).
- **Not when:** no exception.

### BR-11 - Keep the record of human choices
- **Rule:** Keep the brief, every candidate and the edit history in `<state>/brand/candidates/`. Give every file under
  `brand/` and every icon an entry in `design/provenance.json` with `ai` (generated, assisted or none) and `tool`.
  Never tell the owner a prompted mark is "owned" in the copyright sense.
- **Why:** In the US, prompts alone do not make anyone the author [FD12-F07]. Some events require AI attribution down
  to files and assets [FD09-F26].
- **Check:** ip.provenance.
- **Not when:** no exception.

### BR-12 - Ship the minimal favicon set
- **Rule:** `favicon.ico` with exactly one 32x32 entry, linked with `sizes="32x32"`; `icon.svg` with a dark-mode rule;
  `apple-touch-icon.png` 180x180 (the mark at 140 px on a solid brand ground); a manifest with 192, 512 and maskable
  512 icons. Declare a raster above 48 px. Keep icon URLs stable and crawlable (never blocked in `robots.txt`).
- **Why:** The Evil Martians set; `sizes="32x32"` fixes a Chrome bug [FD12-F21]. Google Search lists no SVG, wants
  more than 48x48, a stable URL and crawlable files [FD12-F29]. A single 32 px entry is the only ICO both Next.js
  bundlers read as 32x32 [FD12-F25] [FD12-F30].
- **Check:** brand.favicons.
- **Not when:** an existing app that inlines its favicon keeps the inlining and adds the drift test (BR-17).

### BR-13 - Optimise `icon.svg` without losing dark mode
- **Rule:** Run SVGO 4.1.0 with `{ multipass: true, plugins: [{ name: 'preset-default', params: { overrides:
  { inlineStyles: false } } }] }`, or author the light colour as a `fill` attribute and only the dark override in
  `@media (prefers-color-scheme: dark)`. After SVGO, assert that `prefers-color-scheme` is present and its selector
  still matches an element. Then load `icon.svg` in Chromium under `emulateMedia({ colorScheme: 'dark' })` and sample
  a pixel inside the mark. Serve it as `image/svg+xml`.
- **Why:** SVGO's default preset inlined the light colour, dropped the class and the `<style>`, and the icon stayed
  dark in dark mode in Chromium 147 [FD12-F24]. Chromium and Firefox require the `image/svg+xml` type [FD12-F22].
- **Check:** brand.icon-dark; brand.favicons (served type).
- **Not when:** no exception.

### BR-14 - Compute the maskable size; never hard-code it
- **Rule:** Shrink the mark (start at 409 px, step 8 px) until every inked pixel of the transparent layer lies within
  0.4 x 512 = 204.8 px of the centre, then add the background colour. A square mark ends near 290 px per side. With
  `@vite-pwa/assets-generator` 2.0.0, replace its white grounds with the brand colour and re-run the radius check.
- **Why:** The W3C safe zone is a centred circle of radius 40%; a full-bleed rounded square at 409 px reached
  258.2 px [FD12-F23]. The generator pads to 70% on white and writes a 48 px ICO [FD12-F26].
- **Check:** brand.favicons.
- **Not when:** no exception.

### BR-15 - Place the files the framework's way, then read the built head
- **Rule:** Next.js App Router: `app/favicon.ico` (one 32 px entry, root of `app/` only), `app/icon.svg`,
  `app/apple-icon.png` (180x180), `app/manifest.ts`, `app/opengraph-image.png` with `app/opengraph-image.alt.txt`.
  Vite or static: files in `public/`, referenced by root-absolute paths, with the head tags of the Procedure. Inspect
  the rendered `<head>` of the build. Never copy the Next docs' OG font example (it loads Inter).
- **Why:** Next's docs show `sizes="any"` while the build emits a measured size that depends on the bundler
  [FD12-F25]. Vite serves `public/` at `/` and copies it as-is [FD12-F26]. Tags verified in [FD12 Appendix A].
- **Check:** brand.favicons.
- **Not when:** stack `existing`: follow the app's convention (13-stack.md).

### BR-16 - Delete framework default favicons
- **Rule:** Remove create-vite's `public/favicon.svg` (fill `#863bff`) and create-next-app's `app/favicon.ico`
  (entries 48, 32, 16) before the first deploy.
- **Why:** A template favicon left in place is a candidate tell; create-vite's vanilla copy differs by one trailing
  newline, so the check normalises before hashing and refreshes the hash list from the templates [FD12-F27].
- **Check:** brand.templates; `tells` (rule SL-G02).
- **Not when:** no exception.

### BR-17 - Keep inline copies identical to `brand/`
- **Rule:** Wherever the app inlines the favicon or the mark (a data URI, a template string, a component), add a test
  that compares the inline drawing with the file in `brand/` and fails on any difference.
- **Why:** The BNB board inlines its favicon, and a test fails if that copy drifts from `brand/favicon.svg`
  [FD13-F15].
- **Check:** brand.drift.
- **Not when:** nothing is inlined.

### BR-18 - Render the OG image with Chromium from the brand sources
- **Rule:** Lay out a 1200x630 HTML page with the outlined mark, the self-hosted wordmark face and one line copied
  verbatim from `brief.json` (`hero.sentence` or `sentences.broken`), never a new slogan and never a sponsor logo.
  Screenshot it with the skill's Chromium at DPR 1 after `document.fonts.ready`. Keep it under 8 MB. Put a content
  hash in the file name so the URL changes with the image. Emit `og:image` (absolute https URL), `og:image:width`,
  `og:image:height`, `og:image:alt` and `twitter:card` `summary_large_image`.
- **Why:** Meta asks for 1200x630 (1.91:1), at most 8 MB, size tags and a new URL on change; the line is the spec's
  problem statement, not a slogan [FD12-F28]. The hero sentences have one source, copied verbatim [FD13-F07].
  Rasterise with headless Chromium: ImageMagick, Inkscape and resvg are absent [FD13-F15].
- **Check:** brand.og.
- **Not when:** no exception.

### BR-19 - Run name checks with controls; report them as indicative
- **Rule:** Before a name is final, check: domains through the RDAP base read at run time from
  `https://data.iana.org/rdap/dns.json` (TLDs absent there, such as `.io`, through the registry's endpoint plus DNS-
  over-HTTPS `NS`, where Status 3 means NXDOMAIN); `gh api users/<name>` (users and organisations); npm
  `https://registry.npmjs.org/<name>` and `https://registry.npmjs.org/-/org/<name>/package`; TMview's word search in
  Nice classes 9, 36 and 42; the X handle by hand, logged in. Run a known-taken and a random name in the same pass for
  every probe, and refuse to report when a control fails. Report "no match found", never "clear" or "available".
  Never register a domain, handle, package or mark: the owner decides.
- **Why:** The owner's earlier `.dev` endpoint answered 404 for registered names, and 6 of 16 names marked free were
  registered; an RDAP 404 means unregistered, not purchasable [FD12-F19]. Probe set, controls and the unstable X
  probe [FD12-F20].
- **Check:** owner review (`<state>/brand/name-checks.json`); network only under an explicit `--network` flag.
- **Not when:** no exception.

### BR-20 - Check the picked mark for lookalikes, by hand
- **Rule:** Export the pick as a PNG of 256 to 512 px on white. Run WIPO Global Brand Database "Find by brand logo"
  with the Concept strategy, then Shape (Nice classes 9, 36, 42 if the filter is offered), then TMview's image search,
  then a reverse image search (TinEye or a browser) for copies of an existing web image. These are browser steps: a
  manual task in mode A, a question in mode B. Store the first results page as a receipt in
  `<state>/brand/receipts/`, never in the product repo. Report "no close match found", never "clear".
- **Why:** WIPO's logo search and its strategies; no match does not prove availability, and WIPO's automation terms
  were not checked [FD12-F17]. TMview's image limits and TinEye's copies-only scope [FD12-F18]. Results pages show
  third-party marks, which stay out of the repo [FD09 Policy table].
- **Check:** owner review.
- **Not when:** no exception.

### BR-21 - Keep sponsor marks out of the project's name
- **Rule:** Check the project name, product name, domain and handles against each active sponsor's
  `naming_blocklist` in `assets/sponsor-allowlist.json`. A hit is an entry as a token or as the leading or trailing
  part of a compound ("Cardanex", "AdaPay"; not "Canada"), or a near variant (edit distance 2 or less, or phonetic).
  Send every hit to the owner. Never put "Ledger" in the app's name, `<title>` or favicon.
- **Why:** Blocklists: Cardano (CARDANO, ADA, ADACOIN, ADAPAY, CARDANO FOUNDATION), Cardano Foundation, Ledger
  (LEDGER), Solana (SOLANA, SOL, ACCELERATE, BREAKPOINT) [FD21 Deliverable]. Cardano bars its marks from product names
  but its forum accepts creative names, so a hit is a question [FD21-F04]. Solana forbids combining its marks with a
  project's name [FD21-F13]. Ledger's marks may not name others' products [FD18-F13].
- **Check:** ip.sponsor-marks; owner review.
- **Not when:** no exception.

### BR-22 - Never lock up the project's mark with a sponsor's
- **Rule:** A sponsor logo appears only as an unaltered official file whose SHA-256 matches the allowlist, never
  beside the project's mark (one clear-space unit or closer), never animated, never the largest element, and never in
  the favicon, the OG image or the wordmark. Defaults without a stored written yes: Cardano, the standalone official
  file at 64 px or more with its clear space and TM notice; Solana, an official file (inferred, not granted), mono
  when the palette must not carry its gradient; BNB Chain, text until approved; DVB, text until the board approves;
  Chainlink, Ledger, TOKEN2049, Masumi, Input Output and the Cardano Foundation, text only. Gate details:
  15-ip-provenance.md.
- **Why:** Cardano grants only the standalone unaltered logo and forbids combining it with a project's mark
  [FD21-F03] [FD21-F04], with sizes and clear space [FD21-F02]. Solana's permission is inferred [FD21-F12]
  [FD21-F13]. Chainlink needs consent and bans animated or focal marks [FD21-F09]. BNB [FD21-F20], Ledger [FD21-F16],
  TOKEN2049 [FD21-F21], DVB [FD21-F22], Masumi [FD21-F26], IOG [FD21-F07]. Marks never prove integration [FD21-F23].
  Cardano wants its logo equal or larger beside a partner's, Chainlink bans a focal mark, Masumi sizes optically: the
  rules reconcile only if the marks never sit side by side [FD21 Contradictions between sources]. Lockup and focal
  gates [FD21 Deliverable].
- **Check:** ip.sponsor-marks; ip.logos.
- **Not when:** the profile's `approval_evidence` holds the sponsor's written yes for that exact use.

### BR-23 - Borrow no sponsor trade dress
- **Rule:** Do not take a sponsor's gradient, palette, typeface, taglines, bracket framing or decorative shapes for
  the mark or the theme. One sponsor accent is allowed only as a recorded deliberate choice, never next to that
  sponsor's logo, and never from Solana.
- **Why:** Solana claims its gradient, colours and look and feel [FD21-F13] [FD21-F14]. The Cardano Foundation's
  gradients and blurred shapes read as its own material [FD21-F06]. Ledger's brackets, taglines and backgrounds are
  its identity [FD21-F17]. BNB yellow beside the BNB logo reads as official [FD21-F20]; the BNB precedent borrowed one
  accent on purpose and nothing else [FD13-F15].
- **Check:** ip.sponsor-marks; `tells` (rule SL-T01).
- **Not when:** a waiver in `design/waivers.json` cites the sponsor's brand and the sponsor does not claim it as a
  mark [FD21-F24].

### BR-24 - Make no visual before T0 where the event forbids designs
- **Rule:** When `prework.designs` (top level of /execution's profile) or `frontend.prework_designs.allowed` is false, produce no candidate, mark, token file, OG image or
  mock before `until_utc`. Before T0 you may run name checks, read font licences and keep notes in
  `<workspace.private_dir>/frontend/` (`--state`). Draw from T0.
- **Why:** TOKEN2049 Origins allows brainstorming but "no code, designs, or prototypes before kickoff" [FD09-F27];
  ETHGlobal Classic tracks bar pre-existing project designs and assets [FD09-F26]. The Origins plan starts code at T0,
  allows research earlier, and holds the logo until the rename [FD13-F26].
- **Check:** owner review.
- **Not when:** the event allows prework; BNB lets an existing product enter with a before and after [FD09-F28].

## Procedure

1. **Preconditions.** Read `brief.json` (`project.name_status`, `hero`, `sentences`), the profile (`prework`,
   `review_surface`, `sponsors`, `mode`) and the picked direction's type plan. Name not final: BR-02. Prework: BR-24.
2. **Name checks** (BR-19, BR-21) into `<state>/brand/name-checks.json`. For Origins the rename is a dated decision
   in the spec, due Sat 3 Oct, and the window opens Tue 6 Oct 12:00 SGT [FD13-F26].
3. **Faces.** Shortlist 2 or 3 faces; read each licence file for the licence and any Reserved Font Name (BR-04).
4. **Candidates.** For each of 3 to 5 write `<state>/brand/candidates/<n>/candidate.json` (`text`, `font`, `weight`,
   `license`, `intervention`, `one_feature`, `symbol_reason`, `flag_reasons`, `ai`, `tool`) and `mark.svg`.
5. **Build and measure.** `node ~/.claude/skills/frontend/scripts/brand.mjs --help` lists its commands; it outlines
   (BR-05), lints (BR-07), renders and measures (BR-08) with the skill's Chromium. Fix hard fails, write flag reasons.
6. **Defect review**, at most 2 rounds (BR-09).
7. **H2.** Show the renders on the review surface: board images, or a private Claude Design canvas that only displays
   our SVGs and renders, with the direction passed first [FD07-F26] [FD16-F31]. Mode A: a decision task; mode B:
   AskUserQuestion. Canvas comments are not answers. Record the pick in `<state>/choices.json`.
8. **Lookalikes** on the pick (BR-20).
9. **Emit** into the product repo:
   ```
   brand/  mark.svg  mark-mono.svg  wordmark.svg  lockup.svg (project only)  <licence file>  README.md
           README.md: the one feature, the intervention, face + licence + credit, colours, provenance, symbol reason
   public/ (or app/ for Next)  favicon.ico  icon.svg  apple-touch-icon.png  icon-192.png  icon-512.png
           icon-mask.png  manifest.webmanifest  opengraph-image.<hash>.png
   ```
   Add the mark and wordmark as SVG and PNG at slide sizes plus the palette tokens for the deck, because /hackathon's
   deck builder hard-codes another project's mark [FD13-F25].
10. **Integrate** (BR-15), delete template favicons (BR-16), add the drift test (BR-17). Head tags for Vite or static
    [FD12 Appendix A]:
    ```html
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="icon" href="/icon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="manifest" href="/manifest.webmanifest">
    <meta property="og:image" content="https://<host>/opengraph-image.<hash>.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="<name>: <one-line problem statement>">
    <meta name="twitter:card" content="summary_large_image">
    ```
    Manifest icons: `/icon-192.png` 192x192, `/icon-mask.png` 512x512 `purpose: "maskable"`, `/icon-512.png` 512x512.
11. **Prove.** FE-05: `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates brand.candidates
    --root <repo> --profile <abs path>`. After emission: the same command with `--gates brand,ip.fonts,ip.provenance,
    ip.sponsor-marks --serve <built dir>`. Exit 0 only when every requested gate is ok; fix the cause and re-run.

## Gaps
- X's card rules (ratio, size limits) could not be opened; `summary_large_image` is unverified [FD12-F28].
- The solid-share metric has no calibrated threshold; it needs a control set of real favicons [FD12-F16]. Appendix A
  measured with resvg and sharp; Chromium's anti-aliasing at 16 px may score differently, so calibrate on Chromium.
- The default-favicon tell was not run on the owner's corpus or on controls; Astro, SvelteKit and Nuxt starters were
  not hashed [FD12-F27].
- Next.js `sizes` under Turbopack was read from source, never built [FD12-F25]. Dark-mode favicons were verified only
  in Chromium 147 as a document, not in a tab strip, and not in Firefox or Safari [FD12-F24].
- WIPO's Nice-class filter for logo search is undocumented; npm's org endpoint for a claimed scope with no package is
  unknown [FD12-F17] [FD12-F20]. Copyright of AI marks was read for US law only [FD12-F07].
- Whether a logo, a token file or reference notes made before kickoff count as a "design" at Origins is an open
  organiser question (ARCHITECTURE section 14, question 7) [FD13 What could not be found, and how it was searched].
- Only Cardano, the Cardano Foundation, Ledger and Solana carry a `naming_blocklist`; Chainlink, BNB Chain, TOKEN2049,
  DVB, Masumi and IOG have none [FD21 Deliverable]. The blocklists live in `assets/sponsor-allowlist.json` (ten
  parties); logo rules per sponsor are in `15-ip-provenance.md` IP-05 to IP-07.
- Kit hashes drift: re-fetch the kits before 6, 11 and 13 October [FD21-F24] [FD21 Weak spots of this dossier].
  Ledger OP3N's own brand rules were not found [FD21-F23].
- MIT is in the licence set `ip.fonts` accepts (BR-04), but no finding examines MIT-licensed fonts.
