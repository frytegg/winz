# Reference capture and the pattern ledger

Read when: you run P1 (FE-01 confirm reference URLs, FE-02 references), before any third-party site is loaded, measured or screenshotted, and before you write or read `pattern-ledger.json`.

## Purpose
P1 turns the sponsor's customer category into a written pattern ledger: conventions, measured relationships, domain conventions and facts, each drawn from at least two unrelated sites.
A page that looks typical of its category is judged more beautiful and more trustworthy at first sight, so the build borrows the category's form and keeps its novelty in the mechanism and the proof (`03-directions.md`).
Every capture goes through one gate with one honest identity, stays outside any git work tree and is destroyed once the ledger is checked.
Only words and numbers in the ledger reach later phases; the limits on reuse are in `15-ip-provenance.md`. Not legal advice: where the law is unsettled, the policy is stricter on purpose.

## Rules

### RF-01 - Borrow the category's form, never one site
- **Rule:** Name the category the jury will file the product under (DeFi protocol site, trading terminal, consumer savings app, institutional desk) from the customers and the use case in `brief.json`, and reference sites of that category only. Carry its form: layout conventions, component grammar, density and relationships. Leave the novelty to the mechanism, the proof and one signature element.
- **Why:** Low complexity with high prototypicality was rated most beautiful, and both effects were present at 17 ms [FD11-F02]. Prototypicality predicts trust more directly than beauty or usability do [FD11-F06]. Typical bank homepages improved attitudes and buffered weak messages under distraction [FD11-F07]. Typicality and novelty raise preference only jointly [FD11-F08].
- **Check:** owner review (the FE-01 answer names the category).
- **Not when:** Never skipped. With customers in several categories, use the category of the use case in `brief.json` and record the choice with its source.

### RF-02 - List 6-8 candidates per category, keep 2-4
- **Rule:** For each category list 6-8 candidate sites in `brief.json` `customers`, each with its official URL, `url_source` (sponsor page, DefiLlama `url`, GitHub organisation) and whether it is a marketing site or an app. The owner confirms the list (FE-01: a manual task in mode A, AskUserQuestion in mode B), then `owner_confirmed` turns true. Capture in list order until 2-4 sites pass, at most 4 hosts in all. The floor is 2 sites from different owners.
- **Why:** In the gate's dry run, bot walls stopped 2 of 4 famous brands, so a target of 2-4 needs a fallback list [FD19-F09]. No workspace records customer websites, and a DefiLlama `url` can point at an app route [FD13-F06]. The policy caps captures at 4 hosts [FD19 Capture policy table] (P11).
- **Check:** owner review (FE-01 answer file); `refs.ledger`.
- **Not when:** Fewer than 2 sites pass the gate: RF-12.

### RF-03 - Capture one page per site, the one closest to the surface you build
- **Rule:** For each site pick the single page closest to the surface being built (the home page for a landing page, an app route for an app) and store captures of that page only. Never merge measurements from two pages of one site into one pattern.
- **Why:** A collection file for Stripe merged two live design generations (4 px buttons on the home page, pill buttons on /pricing) into a style that exists nowhere, and 30 of 74 collection files declare several source pages [FD05-F09]. The policy allows at most 3 pages per host [FD19 Capture policy table] (P11).
- **Check:** `refs.ledger` (one `page` per reference).
- **Not when:** Other pages of the host may be dry-run (nothing stored) to find the closest one.

### RF-04 - Capture through the gate, with one honest identity
- **Rule:** Load and measure a third-party page only through `scripts/capture.mjs`, which wraps `scripts/capture-gate.mjs`. Never use WebFetch, `@playwright/cli`, dembrandt, a browser extension or an ad hoc Playwright script for a capture. The identity is the browser's default user agent plus `(compatible; frontend-capture/1.0; one-off design-reference capture, human-directed)`. HTTPS only, no credentials in the URL. After any block, never change the user agent, switch to headed mode, spoof `navigator.webdriver` or fingerprints, load a stealth plugin, use a proxy, VPN or IP rotation, call a CAPTCHA solver, attach CDP to a personal browser profile, or fall back to an archive mirror.
- **Why:** RFC 9309 counts any automated client as a crawler [FD19-F01]. Anthropic says all its bots, Claude-User included, honor robots.txt and never bypass CAPTCHAs [FD19-F02]. Headless Chromium already declares itself, and RFC 9110 discourages borrowing other products' tokens [FD19-F04]. Switching identity after a block is part of the pattern Cloudflare de-listed as stealth crawling [FD19-F05]. Anthropic's Usage Policy forbids circumventing other platforms' guardrails [FD19-F06]. France punishes the attempt with the same penalties as the act [FD19-F27]. Rows P2 and P9 of [FD19 Capture policy table].
- **Check:** `refs.receipts` (each `manifest.json` records the user agent); owner review.
- **Not when:** Never waived. Reading a site's terms is RF-06, not a capture.

### RF-05 - Stop at every refusal the gate reports
- **Rule:** Read the `verdict` in the gate's JSON report for each site, not only its exit code, and act on it:
  - `skip-site`: robots.txt disallows the path for `frontend-capture`, `Claude-User` or `*`, robots.txt is unreachable (5xx or network error), or a TDM reservation exists (TDMRep file, header or meta `1`, ai.txt disallowing the page or images, `Content-Usage: ai-use=n`). Drop the site.
  - `stop`: robots.txt itself answers 401, 403, 407 or 429; the page answers 401, 403 without a challenge header, 405, 407, 429, 451 or 503; a CAPTCHA; or a silent challenge still present after one passive 8 s wait. Drop the site; no retry, ever.
  - `needs-human-review`: RF-06. `refused`: the capture folder is inside a project or a git work tree (RF-09).
  - Then take the next candidate.
- **Why:** Rows P3 to P8 of [FD19 Capture policy table] and the order of [FD19 Enforcement flow]. robots.txt matching and the 5xx rule [FD19-F01]. Bot walls announce themselves by header and status [FD19-F07]. Machine-readable reservations remove the TDM exception [FD19-F10] [FD19-F15] [FD19-F16] [FD19-F17]. The CNIL treats a CAPTCHA as an objection to honor [FD19-F19]. Criminal risk sits in passing a security measure [FD19-F21] [FD19-F22].
- **Check:** `refs.receipts` (every kept reference has a gate report with verdict `captured`).
- **Not when:** Never waived. A dropped site may still inform the ledger through RF-12's manual notes.

### RF-06 - Store nothing until someone has read the site's terms
- **Rule:** Before a storing run, read the site's terms of use as rendered. If they forbid automated access, scraping, crawling, robots or bots, or (text and) data mining, drop the site for capture and use RF-12. Otherwise pass `--terms-reviewed <terms url>`; the gate writes that URL into `manifest.json`. The reader is the owner in a browser, or the model through WebFetch when the gate's robots.txt check allows that path. When the fetched text holds no clauses, the owner reads it.
- **Why:** In France a clause in the terms of use is a valid objection to text and data mining [FD19-F13]. Ignoring it runs against the Usage Policy even where the terms bind no casual visitor [FD19-F06] [FD19-F20]. The German test turns on the technology of the day, and a model reads natural language [FD19-F14]. Automatic terms discovery reached no clause text on either admitted site, and kraken.com/legal serves its clauses only after scripts run [FD19-F09]. WebFetch identifies as Claude-User [FD19-F03]. Row P6 of [FD19 Capture policy table].
- **Check:** `refs.receipts` (each `manifest.json` has `termsReviewed`).
- **Not when:** Never waived.

### RF-07 - Keep each capture to two viewport shots and measured facts
- **Rule:** Per page store two viewport-sized PNGs, one at 1440x900 and one at 390x844, plus the measured files of RF-08. Run `capture.mjs` with `--viewports 1440x900,390x844 --slices 1`: its default is 3 slices per viewport (6 PNGs), which exceeds P11. Shots are taken with animations disabled after explicit readiness: `document.fonts.ready`, the H1 visible, every above-the-fold image complete, with a timeout. Never wait for `networkidle`. Never take a full-page screenshot or per-section element shots, and never save the page's HTML, CSS, JS, fonts or images. A 390x844 shot made by resizing keeps a desktop context (hover, DPR 1): read it as layout only.
- **Why:** Row P11 of [FD19 Capture policy table] and its limits: 2 viewports, 3 pages per host, 4 hosts [FD19 Policy constants (JSON)]. Keeping numbers read in a live browser is closest to viewing plus facts, while a programmed download is a deliberate copy [FD19-F12]. Full-page shots never scroll, so scroll-revealed content is missing [FD06-F10]. A tall image is downscaled until 16 px text renders near 7 px [FD06-F13]. `page.screenshot` leaves animations running unless told otherwise [FD06-F06]. `networkidle` is discouraged and streaming pages never reach it [FD17-F29]. Without an explicit wait, a slow page is captured half-loaded [FD06-F17]. A resize keeps a desktop context [FD06-F08].
- **Check:** `refs.receipts` (manifest SHA-256 and purge); the 2-PNG count is not gated: confirm `slices/` holds one file per viewport (owner review).
- **Not when:** A canvas or WebGL hero has no DOM to read: capture.mjs marks that region `vision-only` in `landmarks.json`; take no extra capture [FD05-F10] [FD08-F20]. Your own build is captured differently, as viewport slices at the profile matrix (`12-critique.md`).

### RF-08 - Measure live through CDP and write only derived values
- **Rule:** In the gate's Chromium, through a CDP session, collect per viewport:
  - one aggregated computed-style tally (family, size, weight, line-height, letter-spacing, colour, background, border radius, box shadow, padding, margin, gap, display, grid columns), never per-element dumps in the agent's context;
  - `CSS.getPlatformFontsForNode` on h1, h2, body text and buttons (the fonts that actually rendered);
  - `CSS.getMediaQueries` once (breakpoints);
  - `CSS.getMatchedStylesForNode` on sampled headings, body text, buttons, cards and section containers (declared values, custom-property names);
  - `CSS.forcePseudoState` for `:hover` and `:focus` before a second tally;
  - DOM rects of landmark sections (order, widths, column counts, relative heights) and a reveal probe (each element's opacity before and after scrolling).
  `capture.mjs` writes these measurements to `styles.json` (computed and declared values, custom-property names, hover and focus changes, breakpoints), `fonts.json` (rendered fonts), `landmarks.json` (sections, column counts, `vision-only` canvases) and `reveal.json` (the reveal probe), next to `manifest.json` and `gate-receipt.json`. Read them through `extract.mjs`, never whole into the agent's context. Never write `CSS.getStyleSheetText` output or stylesheet responses to disk.
- **Why:** CDP's CSS domain returns matched rules with their media queries, declared text with `var()` names, every parsed media query and forced pseudo states [FD08-F30]. Computed styles lose token names and breakpoints [FD08-F21]. The declared font stack is not the rendered font [FD08-F20] [FD06-F12]. A tally comes back compact; dumps belong in files [FD06-F12]. Token and style extraction was every agent harness's weakest task, even from structured design files [FD08-F28]. The policy forbids storing a site's CSS [FD19 Capture policy table] (P11). The reveal probe found a scroll-gated section a full-page shot missed [FD06-F10]. DOM rects replace pixel segmentation for live pages [FD08-F06].
- **Check:** `refs.ledger` (every value names its reference).
- **Not when:** Without CDP, record breakpoints and token names as unknown; never guess them [FD08-F21].

### RF-09 - Keep captures outside every git work tree, and share them with nobody
- **Rule:** Write captures to the captures root: `--out`, else `<workspace.private_dir>/frontend/captures`, else `<os tmp>/frontend-captures`, laid out `<root>/<host>/<slug>/`. The root must sit outside every git work tree and every synced drive; the gate refuses a root inside one. Never write them into the product repo, nor into a private workspace that is a git work tree. Never send them to a teammate, a chat, a deck, a video, a gist, an issue or a canvas. The state directory holds only `pattern-ledger.json`, `pattern-ledger.md` and `refs-index.json` (capture folder paths and receipts).
- **Why:** Rows P12 and P14 of [FD19 Capture policy table]. The TDM exception never covers putting copies in public [FD19-F10]. Singapore lets copies go only to people verifying the results or researching the same analysis [FD19-F24]. Captures never enter the product repository [FD13-F19].
- **Check:** the gate's verdict `refused` for a folder inside the project or a git work tree; `refs.receipts`.
- **Not when:** Never waived.

### RF-10 - Purge the captures once the ledger passes, and keep the receipts
- **Rule:** As soon as `pattern-ledger.json` passes `refs.ledger`, run `capture.mjs --purge <capture dir>` for every capture, and at the latest at the end of the event. Keep each `deletion-receipt.json` (file names, SHA-256, deletion time) and list it in `refs-index.json`. Keep no copy for later, scratch folders included. The ledger itself (facts and ideas) stays.
- **Why:** French TDM copies are "détruites à l'issue de la fouille", and the miner must prove storage and destruction on request [FD19-F13]. Retention ends with the mining purpose [FD19-F10]. Row P13 of [FD19 Capture policy table]. FD19's own research left full third-party HTML in a scratch folder that its policy would destroy [FD19 Weak spots of this dossier].
- **Check:** `refs.receipts` (every manifest file reported `stillExists: false`).
- **Not when:** Never waived.

### RF-11 - Carry ideas downstream, never expression
- **Rule:** The ledger and every later phase carry conventions, relationships, domain conventions and facts only. Never carried: a screenshot as generation input or image-to-code, a rebuild of one site's page or its section sequence, copy (headlines, taglines, microcopy), logos, icons, images, illustrations, 3D renders or video, font files, CSS, JS, SVG paths or markup, a brand's DESIGN.md as the protocol's skin, exact brand hexes as the protocol's colours, a signature visual. Never ask Claude or the Design type to recreate a named company's page. The full table is in `15-ip-provenance.md`.
- **Why:** Ideas, functionality and conventions are free; arrangement, text, images, code and font files are not [FD09-F01] [FD09-F03] [FD09-F06] [FD09-F09] [FD09-F18] [FD09-F21]. Copying one site's sections in the same order was parasitic "even though each element appears ordinary" [FD09-F11]. Image-to-code reuses the real logos and images of a screenshot [FD09-F22]. Anthropic's rules refuse recreating a company's distinctive UI, even drawn in code [FD09-F25] [FD15-F27] [FD15-F33]. Captures may reach Claude only for extraction, never for image-to-code [FD19 Capture policy table] (P15). Borrow design language, not identity [FD05-F26]. Extracted brand values feed relationships, not the palette [FD08-F22] [FD08-F27].
- **Check:** `ip.copy-overlap`, `ip.logos` and `ip.fonts` at build; critic.
- **Not when:** Never waived.

### RF-12 - Fall back to the owner's own notes when the gate refuses
- **Rule:** When fewer than 2 references pass, ask for the manual fallback: the owner opens the site in their own browser, reads it and writes notes in words and numbers (DevTools on a page they opened themselves is fine). Mode A: a manual task; mode B: AskUserQuestion. Record each such site as a reference with `receipt: "manual-notes"`. Never give the model an owner screenshot, an extension export or an archive copy instead.
- **Why:** Row P16 of [FD19 Capture policy table] allows a person's own reading and notes, and ideas are free [FD09-F10]. Rows P9 and P15 forbid archive mirrors and personal-browser CDP as workarounds and let captures reach Claude only after P3 to P9 pass [FD19 Capture policy table]. A workflow agent has no AskUserQuestion, so the question becomes a task [FD13-F03].
- **Check:** owner review (manual task answer); `refs.ledger`.
- **Not when:** 2 or more sites already passed the gate.

### RF-13 - Pace requests, stay on public pages, drop personal data
- **Rule:** Capture one host at a time, with at least 10 s between navigations on a host, or the robots.txt Crawl-delay if larger. Fetch robots.txt fresh on every run; never refetch to refresh a capture. Capture only public marketing pages or public app routes: nothing behind a login, paywall, age or geo gate, and never submit a form. Skip or crop team, testimonial and user-generated sections with faces or names, and delete stray personal data at once.
- **Why:** Rows P10 and P17 of [FD19 Capture policy table]. A robots.txt copy is used for at most 24 h [FD19-F01]. The CNIL requires deleting irrelevant data immediately [FD19-F19]. Lawful access excludes circumventing paywalls [FD19-F23] [FD19-F24].
- **Check:** `refs.receipts` (manifest times); owner review.
- **Not when:** Never waived.

### RF-14 - Trust live measurements over any collection file
- **Rule:** Treat values in three tiers.
  - Raw values the gate measured live (colours, families, sizes, radii) are facts.
  - Roles you assign are inferences: assign them by position (a colour is primary only on real primary CTAs); drop browser defaults (`#0000EE` link blue), icon fonts, cookie and consent widgets and other third-party widgets; dedupe and name the type scale; drop invalid values.
  - Collection DESIGN.md files (awesome-design-md, getdesign) are vocabulary only: pin the commit, set `GETDESIGN_DISABLE_TELEMETRY=1` if the CLI is used at all, and re-measure any value live before it enters the ledger.
- **Why:** On 5 live sites, collection files had identity values right but weights, tracking, radii and "always/never" rules often wrong [FD05-F08]. Their prose comes from a pipeline with an LLM judgment pass [FD05-F07]. An extractor's raw values were right while its roles were noisy: link blue as secondary, an icon font as the top face, an icon button as the CTA [FD05-F20]. Collection files push Inter substitutes and hero gradients [FD05-F11]. The repository moved behind a paid service, and its CLI reports each `add` unless told not to [FD05-F02] [FD05-F28]. Using a brand's DESIGN.md as the skin imitates that company [FD09-F24].
- **Check:** `refs.ledger`.
- **Not when:** Never waived. A value that cannot be measured live stays out of the ledger.

### RF-15 - Write each pattern from at least two unrelated references
- **Rule:** Write `pattern-ledger.json` (shape: `scripts/CONTRACTS.md` 6.5) and `pattern-ledger.md`. Each pattern has `kind` (`convention`, `relationship`, `domain`, `fact`), a `statement` in words, `values`, `from` (reference ids) and `not_borrowed`. A convention, relationship or domain pattern needs references from at least 2 different owners: never two pages of one site, never two brands of one group. A `fact` may come from one reference. Record:
  - conventions: nav position, number of primary CTAs, headline length in words, explanatory sentence present or not, live figures, product visible in the first viewport, proof strip type, section-order types;
  - relationships: type-scale ratio, spacing base step and rhythm, radius family, neutral ramp depth, accent count, light or dark ground;
  - domain conventions: how amounts, addresses, hashes, transactions, statuses and simulated figures are shown (labels, units, tabular figures);
  - facts: per-reference measurements, including the first-viewport complexity proxy (the 1440x900 shot saved as JPEG at quality 70, size in KiB).
  Exact hexes, family names and copy go only into `values`, with `not_borrowed` filled, never into a `statement`.
- **Why:** Several borrowings from one site add up to parasitism, so each pattern comes from several unrelated references [FD09-F11]; conventions common to a market are free [FD09-F06]. Ten protocol and fintech first viewports showed 2-6-word headlines, an explanatory sentence on 6, live figures on 4, the product on 1, and at most 2 CTAs on all 10 [FD11-F17]. Exemplars show proof as exact figures with small labels and a status label on simulated figures [FD11-F20]. The complexity proxy spans 47-133 KiB on those exemplars, and texture inflates it [FD11-F05]. Extracted values become relationships: ratios, ramps, rhythm [FD08 Recommended pipeline] [FD08-F09].
- **Check:** `refs.ledger`.
- **Not when:** Never waived.

### RF-16 - Keep brand-dependent devices and the references' own tells out of the patterns
- **Rule:** Exclude from patterns what works only because the reference is famous: a headline with no explanatory sentence, a logo wall of partners, abstract or decorative hero art. When a reference itself shows a look the tells registry flags (`11-tells.md`, for checkers only), record it as a `fact` with its reference id so a tier-2 waiver can cite it, never as a convention to adopt.
- **Why:** The two exemplars with no explanatory sentence are established brands; a hackathon project has none to lean on [FD11-F18]. Exemplars can afford abstract art because their brands and figures explain them [FD11-F20]. Several of the owner's tells appear on exemplar sites themselves [FD11-F19].
- **Check:** `refs.ledger` (`excluded` list); `tells.tier2` waivers cite ledger facts.
- **Not when:** Never waived.

### RF-17 - Capture before kickoff only as research, and let only the ledger travel
- **Rule:** When the event forbids designs before kickoff (profile `prework_designs.allowed: false`, or /execution's top-level `prework`), P1 may still run before T0 as research: capture, extract, write the ledger with `--state <workspace.private_dir>/frontend/`, purge. Nothing of the team's own design (token plans, comps, logo) starts before T0 (`00-contract.md`). Purge raw captures before travelling; the ledger travels. Captures made at the event go through the same gate.
- **Why:** Origins allows brainstorming before kickoff but "no code, designs, or prototypes" [FD19-F26] [FD09-F27]. Research on others' work may come first, own design artifacts after kickoff [FD19 Capture policy table] (P18). Knowledge crosses into the event and code does not [FD13-F19]. Singapore's Computer Misuse Act applies to captures run from Singapore [FD19-F25].
- **Check:** owner review; the profile's `prework` dates.
- **Not when:** The organiser says notes count as designs: hold the ledger until T0 as well.

## Procedure
1. Read `brief.json` (customers with category, URL and source), and from the profile `references`, `workspace.private_dir`, `prework_designs`, `mode` and `run_mode`.
2. Pick the category (RF-01) and list 6-8 candidates with sources (RF-02). Raise FE-01; on the answer, set `owner_confirmed`.
3. For each confirmed candidate, in order, one host at a time:
   1. Dry run, nothing stored: `node ~/.claude/skills/frontend/scripts/capture.mjs --url <https url> --project-root <repo> --dry-run`. Act on the `verdict` (RF-05).
   2. Read the terms (RF-06).
   3. Store: `node ~/.claude/skills/frontend/scripts/capture.mjs --url <https url> --project-root <repo> --terms-reviewed <terms url> --viewports 1440x900,390x844 --slices 1`. Record the capture folder and its purge command in `refs-index.json`.
   4. Wait at least 10 s, or the Crawl-delay, before the next navigation on the same host (RF-13). Stop at 4 kept hosts.
   The CLI is in `scripts/CONTRACTS.md` section 4 (module CLIs); `capture.mjs --help` lists every flag.
4. Fewer than 2 kept: RF-12.
5. Extract with `scripts/extract.mjs` over the capture folders listed in `refs-index.json` (see its `--help`). Curate (RF-14) and write the patterns (RF-15, RF-16).
6. Prove the ledger: `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates refs.ledger --root <repo> --profile <abs path to profile.json> --state <state dir>`. Fix and re-run until exit 0.
7. Purge every capture (RF-10): `node ~/.claude/skills/frontend/scripts/capture.mjs --purge <capture dir>`. Record each receipt in `refs-index.json`, then run the same command with `--gates refs` until exit 0.
8. Hand `pattern-ledger.json` to P2 (`03-directions.md`).

## Gaps
- The 6-8 candidate count is arithmetic on one dry run of 4 sites from one French IP on one evening (2 of 4 admitted), not a measured admission rate [FD19-F09].
- `capture.mjs` defaults to 3 slices per viewport (citing FD11-F10's first three screenfuls) and allows up to 6, while FD19 P11 caps a page at 2 viewport shots. The procedure pins `--slices 1`; whether to amend P11 or lower the code's default and cap is an owner decision. Exit codes and the capture CLIs are settled in `scripts/CONTRACTS.md` sections 1 and 4: act on the JSON `verdict`, never on the exit code alone.
- How the model reads terms that only render after scripts run is not designed; until then such terms go to the owner [FD19-F09].
- [FD08 Recommended pipeline] proposed a full-page screenshot, one element screenshot per section, saved stylesheet responses and reference screenshots as generation input. FD19's P11 and P15, the owner's copying decision and RF-07, RF-08 and RF-11 exclude all four. FD05-F10's advice to pair extractions with full-page screenshots is excluded the same way [FD06-F10] [FD06-F13].
- FD05-F21 and FD05-F25 suggest a browser extension, a user-agent swap or a Wayback snapshot when a site is walled; FD19 forbids all three (P9). The three FD05 `*_ua.json` extractions were obtained with a user-agent swap and are not reused [FD19-F05].
- FD13-F19 places captures in the research tree; FD19 P12 requires a folder outside any git work tree, which the gate enforces. P12 wins.
- `ip.copy-overlap` runs after the purge on salted 8-word shingles (`ip-check.mjs --index-copy`, `scripts/CONTRACTS.md` 6.3). Whether hashed shingles may outlive the purge under P13 was not researched.
- Whether a convention ledger counts as a "design" under the Origins rule is the organiser's call [FD19-F26] (ARCHITECTURE section 14, question 7).
- The complexity proxy has no validated threshold, and its validation rests on references not re-checked [FD11-F05]. Prototypicality was studied on company, bank, shop and university sites, never crypto or hackathon juries [FD11-F02] [FD11-F06]; MAYA on industrial products [FD11-F08].
- No study measures borrowing a pattern into a page with different content [FD08 Recommended pipeline]. "Different owners" is this file's reading of "unrelated references" [FD09-F11].
- No court has ruled on bot-challenge bypass, design capture or robots.txt for a one-off capture. The German Federal Court of Justice announces its decision in the appeal that turns on the form of a TDM opt-out on 17 Dec 2026: re-check RF-06 then [FD19-F14]. CJEU C-250/25 is unresolved [FD19 Contradictions between sources].
