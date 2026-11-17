# Directions and the review board

Read when: you run P2 (FE-03 directions, FE-04 the owner's pick H1), write a direction's token plan or hero comp, brief an agent that generates directions, or, as the orchestrator, publish a review board for H1 or H2.

## Purpose
P2 turns the brief and the pattern ledger into 2-3 genuinely different named directions, each anchored in a different source and stated as a token plan with one signature element and one hero comp at 1440x900 and 390x844.
Without anchors a model samples its own default look, and five shades of one look leave the owner no choice.
Every direction is screened (checker, similar-prompt test, past looks) before the owner sees it; the owner picks H1, never a model.
Building and verifying happen in the repo. A review canvas only displays our images, and only the orchestrator publishes it.

## Rules

### DR-01 - Anchor each direction in a different external source
- **Rule:** Make 3 directions (small mode: 1 or 2), each anchored in a different source and named after it: customer A's register, customer B's register, the protocol's own domain objects (a settlement statement, an order ticket, an explorer row), or a deliberately utilitarian register. Name each anchor with a concrete object, never with adjectives such as "modern, clean, premium". The directions differ on an axis you can name ("dense data-first" against "editorial explainer").
- **Why:** Without direction a model samples the high-probability centre of web design [FD15-F02]. Anthropic asks for 2-4 genuinely different named directions; "five shades of one aesthetic is no choice at all" [FD15-F19] [FD07-F33]. Directions sampled from one model share its priors, so each needs a different external anchor [FD15-F19]. Adjectives describe a region, a specific reference a point [FD05-F05]. Left to propose freely across 16 creative framings, a model gave the same concept in 30 of 35 responses [FD02-F17].
- **Check:** `directions.present`.
- **Not when:** Small mode (profile `mode: small`) makes 1 or 2 directions within its UI budget [FD13-F26].

### DR-02 - Be typical in form, novel in substance
- **Rule:** Take each direction's layout conventions, component grammar, density and relationships (type-scale ratio, spacing rhythm, radius family, neutral ramp, accent count, ground) from `pattern-ledger.json`. Spend the novelty on the mechanism, the proof and the signature element (DR-06). Keep the first viewport's complexity inside the band the ledger measured on the category's references.
- **Why:** Typicality and novelty raise preference only jointly [FD11-F08]. Low complexity with high prototypicality was rated most beautiful, and complexity weighs most at 17 ms [FD11-F02] [FD11-F03]. Prototypicality predicts trust [FD11-F06]. More educated audiences prefer less colour and less complexity [FD11-F04]. The complexity proxy band comes from the category's own exemplars [FD11-F05].
- **Check:** `firstview.complexity` on the comps; critic.
- **Not when:** The brief or a sponsor brand pins a look: the brief's words win [FD15-F14].

### DR-03 - State each direction as a compact token plan
- **Rule:** Write `directions/<A|B|C>/tokens.json` in the shape of `design/tokens.json` (`scripts/CONTRACTS.md` 6.2) and `directions/<A|B|C>/notes.md` holding: the name and the anchor; 4-6 named colours with roles; type roles (at most two families, plus a monospace face only with a role; a face that shows numbers has tabular figures); radius and spacing steps; a motion budget (static by default, `08-motion.md`); a layout concept with its alignment and an ASCII wireframe of the first viewport; the signature element; 2-4 principles that make the direction this project's. P4 grows the chosen plan into the full system (`05-tokens.md`).
- **Why:** Anthropic's two-pass process starts with 4-6 named hex values, type roles, a layout concept with alignment and ASCII wireframes, and principles, before any code [FD15-F08]. A new brand starts small: 6-10 colours, 5-7 text styles, 4 spacing steps, 3 radii [FD15-F28]. At most two fonts, each with a consistent role, and tabular figures for numbers [FD16-F15] [FD16-F16]. A plan on disk is what the checker can read [FD15-F08].
- **Check:** `directions.present`.
- **Not when:** Never skipped.

### DR-04 - Choose type from the subject, never from a list of good fonts
- **Rule:** Pick faces from the anchor's classification and mood, as measured in the ledger, never the references' actual font files; choose among open-licensed, self-hostable families. A face on the dated reflex lists needs a written reason in `notes.md`. Never plan a font from a sponsor's kit or a customer's site, and never put a Fontshare FFL face on a canvas. Licences: `15-ip-provenance.md`.
- **Why:** Fonts Anthropic recommended in 2025 appear in its 2026 list of overused families [FD15-F12]. Reflex lists disagree and move, so a hit needs a reason, not a ban, and the typeface comes from the customers' classification, not their files [FD16-F14] [FD09-F18]. Sponsor-kit fonts are non-transferable [FD21-F15]. FFL forbids use through design tools [FD16-F12].
- **Check:** `directions.screened`; `ip.fonts` at build.
- **Not when:** The brief or the sponsor's brand names a face: record that as the reason.

### DR-05 - Open each hero with the product working on labelled data
- **Rule:** Each hero comp shows the most characteristic thing in the protocol's world, ideally its core action running on labelled testnet or simulated data. It carries the H1 and sentence from `brief.json` `hero`, at most 2 CTAs, one sourced figure or a visible "not yet verified" placeholder, and one detail only this subject has (its units, addresses, block heights, terms of art). No lorem, no invented figure, no slogan-only hero, no decorative art in place of the product. The first-screen contract is in `06-build.md`.
- **Why:** Open with the most characteristic thing in the subject's world, where a live demo qualifies, and include one detail only this subject would have [FD15-F07]. People look at real products and skip decorative images [FD11-F15]. Of ten exemplars only Uniswap showed the product itself, the strongest pattern for an unknown project [FD11-F17]. Missing facts become visible placeholders, never invented ones [FD07-F23] [FD15-F16].
- **Check:** `directions.screened`.
- **Not when:** Never waived.

### DR-06 - Spend boldness in one place: one signature element that carries information
- **Rule:** Give each direction exactly one signature element, the thing the page is remembered by, and keep everything around it quiet. The signature encodes the protocol's thesis or proof (a measured gap, a state change, a verified figure), never ornament. When the thesis is "the usual reading is wrong", use the naive-against-correct pair: two semantic tokens and two classes, a non-colour channel (dashed against solid) on top of colour, both readings side by side and overlaid where they change over time, the gap printed as the largest figure, and a test that fails if an animation, a theme or a component library alters the pair.
- **Why:** "Spend your boldness in one place", and remove one accessory [FD15-F20]. Anthropic's earlier plan had a Signature slot for the single element a page is remembered by [FD15-F08]. Structural devices must encode information [FD15-F06]. Orma's pair, its five parts and the audit that caught an animation erasing the dashes [FD11-F27]. Side-by-side views plus an explicit difference cover each other's weaknesses [FD11-F28]. Colour must not be the only cue [FD11-F29]. One oversized gimmick per hero is a likely next cliché [FD15 Where Anthropic's own guidance could produce the next cliché].
- **Check:** critic; the pair test in the project's suite.
- **Not when:** Never waived.

### DR-07 - Render one hero comp per direction at 1440x900 and 390x844
- **Rule:** Build each comp as a static HTML page from the direction's tokens and the brief's real copy, with self-hosted fonts and no external request. Render it with `scripts/board.mjs` (see `--help`) to `directions/<X>/hero-desktop.png` at 1440x900 and `hero-mobile.png` at 390x844 in the profile's mobile context (touch, DPR 2), after fonts load, with animations disabled. First viewport only, one comp per direction.
- **Why:** Mockup sizes are phone 390x844 and desktop 1280-1440 [FD15-F20]. Viewport-sized images stay legible to a reviewer where tall captures are downscaled [FD06-F13]. A device context, not a resize, is the real mobile check [FD06-F08]. A canvas self-check looked right while the browser output was broken, so comps render in a real browser [FD07-F15].
- **Check:** `directions.present`.
- **Not when:** Never skipped; one direction still gets both viewports.

### DR-08 - Run the similar-prompt test with a fresh agent
- **Rule:** For each plan, a separate agent (a fresh `agent()` in mode A, a subagent or Workflow agent in mode B) writes a plan from a generic version of the brief: protocol name, sponsors and research removed. Compare the two. An identical font family, an identical hex value or the same layout concept came from the model's prior: revise that part and write in `notes.md` what changed and why. Report the OKLCH distance of the closest colour pairs.
- **Why:** Anthropic's self-review works through "a similar prompt" and revises any part that would come out the same, stating the change and the reason [FD15-F08]. The plan's author shares its own priors, so only an external check breaks the loop [FD15-F08]; a separate evaluator is more tractable than self-critique [FD15-F32].
- **Check:** `directions.screened`.
- **Not when:** Never skipped.

### DR-09 - Screen every direction before the owner sees it
- **Rule:** Run `frontend-check --gates directions` on the plans and comps: the tells registry on the rendered comps, the similar-prompt record and the past-directions check. Revise or drop a direction that fails; never show the owner a failing direction. If a model critic also reviews the comps, it finishes its review before it sees any checker output.
- **Why:** A generic ban swaps one default for another; the defaults are found by checking what came out and extending the list [FD15-F03]. The checker should reject a direction before any build [FD15-F19]. A skeptical separate evaluator beats self-critique [FD15-F32]. Detector output anchors judgment, so the blind review runs first [FD02-F20].
- **Check:** `directions.screened`.
- **Not when:** Never waived.

### DR-10 - Reject a direction that repeats a past project's look
- **Rule:** Compare each plan with the cross-project ledger of past directions (ground and accent colours, type families, hero pattern, signature element, one entry per project and direction). Replace a direction that repeats an earlier one on most of those fields. After H1, append the chosen and the rejected directions to that ledger.
- **Why:** Notes on what was tried help later passes, and a ledger turns "vary across generations" into a check a single chat cannot run [FD15-F29].
- **Check:** `directions.screened`.
- **Not when:** The owner asks to reuse a past look on purpose: record the request.

### DR-11 - Give generators the direction and failure shapes, never lists of bad examples
- **Rule:** Brief the agent that writes plans and comps with the anchor, the ledger patterns, the brief and failure shapes: "a look that would come out of any similar brief", "the model's documented default house style", "ornament that carries no information". Never paste the tells catalogue, banned font names or bad copy phrases into its prompt. The literal lists live in the checker (`11-tells.md`).
- **Why:** Literal bad examples in rule prose primed models to reproduce them; the vendor's lesson was to describe the failure shape [FD02-F33]. Anthropic documents a persistent house style that generic bans only displace [FD15-F03] [FD15-F04]; impeccable names the same Claude rendition prior [FD02-F15].
- **Check:** critic (reads the generator's prompt).
- **Not when:** Never waived.

### DR-12 - Let the owner pick, from equal cases
- **Rule:** The owner picks H1; never a model, a score or a rule. Present every direction with the same parts at the same length: name, anchor, token summary, signature element, a one-line motivation, its main trade-off and its screen results. No ranking, no "recommended", no case made for one direction only. Offer "none of these", with a reason, as an answer: record it as `H1.pick: "none"` with the owner's words in `H1.reason` (choices.schema.json requires the reason), which leaves FE-04 blocked until a new round of directions is picked. The rationale goes in the question text, never on an artboard.
- **Why:** When a model, a simulated user or a rule could pick from a shortlist, option one won 27 of 30 times [FD02-F17]. Each option gets an honest motivation and its main trade-off; a case made only for a favourite is a rigged vote, and option notes go in the reply, not on the artboard [FD07-F33] [FD15-F19].
- **Check:** owner review (`choices.json` holds H1 with its UTC time).
- **Not when:** Never waived.

### DR-13 - Take H1 only from the decision channel
- **Rule:** Mode A: H1 is a decision task in /execution's plan, and the owner answers through the Notion decision field or a Remote Control reply; the frontend lane waits while other lanes run. Mode B: AskUserQuestion in the main thread. A comment on a canvas is not an answer; point its author to the channel.
- **Why:** A workflow agent has no AskUserQuestion and no mid-run user input, so questions become tasks [FD13-F03]. Inline canvas comments sometimes fail to appear [FD07-F21]. Claude's phone apps view designs, and commenting from them is not documented [FD07-F16].
- **Check:** owner review (`choices.json` records the channel).
- **Not when:** Never waived.

### DR-14 - Make no direction before kickoff when the event forbids designs
- **Rule:** Read /execution's top-level `prework` and the profile's `prework_designs`. While designs are not allowed (before `until_utc`), P2 does not start; only P1 research may run earlier (`02-references.md`, RF-17).
- **Why:** TOKEN2049 Origins forbids designs and prototypes before kickoff [FD09-F27] [FD19-F26]; the Origins plan starts code at T0 and allows research earlier [FD13-F26]. The same rule for brand work is BR-24 in `04-brand.md`.
- **Check:** owner review; the profile's `prework` dates.
- **Not when:** The event allows prework, as BNB Hack does for an existing product with a before and after [FD09-F28].

### DR-15 - Never let a canvas design, and verify only on the built page
- **Rule:** A review canvas shows the PNGs `board.mjs` rendered, with captions. It never generates a layout, palette, type pairing or mark, never imports a design system or a codebase, and is never where a direction is checked. Copy the chosen plan into the repo right after H1; the canvas is never a source.
- **Why:** The Design type names cream, serif display and clay as Claude's habit [FD07-F24], and its craft file pushes gradient meshes and grain onto unbranded work [FD07-F35] [FD15-F11]. The canvas is told never to verify, and canvas self-checks missed broken browser output [FD07-F25] [FD07-F15]. Ingesting a design system used 77% of a weekly allowance at launch [FD07-F20]. There is no version history, so the pick moves into the repo at once [FD07-F21]. A Design System artifact is a poor source of truth for autonomous agents; the repo's token file stays authoritative [FD07-F26].
- **Check:** owner review; `tokens.valid` after P4.
- **Not when:** Never waived.

### DR-16 - Never publish a frame that names a real company
- **Rule:** Before any upload, scan each comp's rendered text for the customer, sponsor and event names in `brief.json` and the sponsor allowlist. Render a board variant (`hero-desktop.board.png`, `hero-mobile.board.png`) with each name replaced by a bracketed role such as "[Customer]" or "[Sponsor]"; upload only those. The unmasked comps stay local in the state directory. Canvas titles, captions and notes name no company either.
- **Why:** Per the Artifact tool's description (re-read it before each event), content that imitates a real organisation is built as a local file and the owner decides on any URL; a page that impersonates one is never published [FD09-F25] [FD08-F27].
- **Check:** owner review.
- **Not when:** The owner asks in writing for an unmasked board: build it as a local file only.

## Procedure
1. Read `brief.json`, `pattern-ledger.json`, the profile (`mode`, `run_mode`, `prework`, `review_surface`) and the past-directions ledger. Prework forbids designs: stop (DR-14).
2. Choose 3 anchors (small mode: 1 or 2) (DR-01). Generate one plan per anchor in parallel: mode A through `assets/wave-fragments/directions.js` (`feDirections`), mode B through a Workflow with one agent per direction, each briefed as in DR-11.
3. Run the similar-prompt test (DR-08) and the past-directions comparison (DR-10); revise.
4. Build and render the comps (DR-05, DR-07), then the masked board variants (DR-16).
5. Prove: `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates directions --root <repo> --profile <abs path to profile.json> --state <state dir>`. Revise until exit 0 (DR-09).
6. Write each `notes.md` with the equal case of DR-12.
7. Hand over for H1 by `review_surface`: `claude-design`, the next section; `board`, the PNG paths go in the decision text; `terminal`, text only. The question follows DR-12 and DR-13.
8. On the answer: record H1 in `choices.json` with its UTC time and channel, append to the past-directions ledger (DR-10), and start P4 (`05-tokens.md`) from the chosen `tokens.json`.

## Publishing the board (orchestrator only)
Only the main thread publishes: the owner's session in mode B, /execution's orchestrator between waves in mode A. A wave or workflow agent never does, since whether a publish from a non-interactive agent raises a permission prompt is undocumented [FD07-F22]. The file shapes below come from the Design type's own `SKILL.md` and `artifact-type/reference/format.md` as read on 2026-10-01 (canvas contract 0.2.47); when the type's files say otherwise, the type wins. The same procedure serves H2 (step 10).

1. **Preconditions.** The profile's `review_surface` is `claude-design`. For H1, `frontend-check --gates directions` exited 0; for H2, `brand.candidates` passed (`04-brand.md`). The masked PNGs of DR-16 exist and the never-show scan is clean on their text.
2. **Read the type's rules first**, read-only calls on the type itself:
   - `Artifact({action: "read", url: "https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd", path: "SKILL.md"})`
   - `Artifact({action: "read", url: "https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd", path: "artifact-type/reference/format.md"})`
   Use `url` with `path`: a read by `type_url` takes no `path`. Note the canvas contract the SKILL.md states for `choices.json`. Never `read` or `open` any of the owner's own artifacts, the new canvas included: a read creates a new version of it [FD15-F26].
3. **Create the canvas:** `Artifact({action: "publish", type_url: "https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd", title: "<project working name> directions H1", auto_open: "after_first_write"})`, and nothing else (no `file_path`, `capabilities`, `contract`, `favicon` or `url`). Keep the returned `url`; never send `type_url` again. The title names no customer, sponsor or event.
4. **Upload the PNGs as assets:** `Artifact({action: "publish", url: "<canvas url>", file_paths: ["<state>/directions/A/hero-desktop.board.png", "<state>/directions/A/hero-mobile.board.png", ...], asset: true})`, at most 25 files per call. Keep each returned `url` (`/_blob/<id>`) exactly as given. Never upload an SVG (uploaded SVG loses its `<style>`, so a mark's dark-mode rule) [FD15-F28], never use a `data:` URI.
5. **Write the files** in one scratch folder `<root>`, all in one message:
   - one artboard per image: `project/Main.dc.html` for direction A desktop (the index's entry name), then `project/A-mobile.dc.html`, `project/B-desktop.dc.html`, `project/B-mobile.dc.html`, and so on;
   - each artboard is the image only, at its CSS size, in the type's skeleton:
     ```html
     <!doctype html>
     <html lang="en">
     <head>
     <meta charset="utf-8">
     <title>Direction A desktop</title>
     <script src="./support.js"></script>
     </head>
     <body>
     <x-dc>
     <helmet>
     <style>
     body{margin:0}
     </style>
     </helmet>
     <div style="width: 1440px; height: 900px">
     <img src="/_blob/<id>" alt="Direction A hero at 1440 by 900" style="display: block; width: 1440px; height: 900px">
     </div>
     </x-dc>
     <script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1440,"height":900}}'>
     class Component extends DCLogic {
     renderVals() {
     return {};
     }
     }
     </script>
     </body>
     </html>
     ```
     Mobile artboards use 390 by 844 whatever the PNG's pixel size. No tweaks, colours, font links, design system or other markup;
   - `project/canvas.json`, the index, with one row per direction (desktop at x 0, mobile at x 1520), 120 px between rows, and each board's `title` as its caption:
     ```json
     {"v":3,"createdOnFiles":{"v":1,"at":"<now, UTC>"},"title":"<same title>","launch":{"view":"canvas"},"pages":[],
      "boards":{"Main.dc.html":{"x":0,"y":0,"w":1440,"h":900,"title":"A <name>, desktop 1440x900"},
                "A-mobile.dc.html":{"x":1520,"y":0,"w":390,"h":844,"title":"A <name>, mobile 390x844"},
                "B-desktop.dc.html":{"x":0,"y":1020,"w":1440,"h":900,"title":"B <name>, desktop 1440x900"},
                "B-mobile.dc.html":{"x":1520,"y":1020,"w":390,"h":844,"title":"B <name>, mobile 390x844"}},
      "order":["Main.dc.html","A-mobile.dc.html","B-desktop.dc.html","B-mobile.dc.html"],"notes":{},"designSystems":[]}
     ```
6. **Publish once:** `Artifact({action: "publish", url: "<canvas url>", root: "<root>", file_path: "<root>/project/canvas.json", files: {"project/Main.dc.html": "project/Main.dc.html", "project/A-mobile.dc.html": "project/A-mobile.dc.html", ...}})`.
7. **Do not verify on the canvas:** no read-back, open, render or screenshot. The PNGs were checked locally (DR-09) [FD07-F25].
8. **Ask** through the channel of DR-13, with the canvas link and the equal cases of DR-12 in the question text. Keep the canvas private: never change its sharing and never give its link to a jury, since a shared artifact needs a Claude account [FD07-F29].
9. **On the answer:** write `choices.json` (the pick, or "none" with its `reason`, UTC time, channel, canvas `url`, type contract) and copy the chosen plan into the repo at once (DR-15). Never edit this canvas again: a new round is a new canvas with a new title. One create, one upload call per 25 images and one publish keep the cost small; the canvas draws on the same usage pool as the build [FD07-F19].
10. **H2:** the same steps with the title "<project working name> logo candidates H2" and one row per candidate, one artboard per render PNG at that render's size (the renders `04-brand.md` specifies). Upload PNG renders, never the SVG files, which stay in the state directory and the repo.

## Gaps
- The past-directions ledger and `board.mjs` are in `scripts/CONTRACTS.md` sections 4 and 6.3 (v1.1). "Repeats on most fields" has no calibrated threshold [FD15-F29], and the similar-prompt test's colour distance has none either [FD15-F08].
- The canvas file shapes rest on a read of the Design type on 2026-10-01 (contract 0.2.47), not on a verified dossier finding, and the type's releases change [FD15-F26] [FD15-F31]. `04-brand.md` step 7 speaks of a canvas showing "our SVGs and renders"; this file uploads PNG renders only [FD15-F28].
- Whether an Artifact publish from a non-interactive agent prompts for permission is unknown [FD07-F22]. Anthropic's pages disagree on whether a public artifact link needs a Claude account [FD07-F29].
- No measurement shows that anchoring directions in different sources yields more distinct pages; Anthropic calls the method reliable without numbers [FD15-F19]. MAYA was measured on industrial products, prototypicality on company, bank, shop and university sites, never crypto juries [FD11-F08] [FD11-F06].
- "Dashed means naive" is a convention with only indirect support; label it in a legend [FD11-F29].
- Whether a token plan, logo or reference notes made before kickoff count as designs at Origins is an open organiser question (ARCHITECTURE section 14, question 7) [FD19-F26].
