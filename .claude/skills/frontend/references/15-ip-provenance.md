# IP, licences and provenance

Read when: a page, mock, deck frame or canvas uses any third-party name, mark, font, icon, image, library or text; you add a file under `brand/`, `public/` (or the stack's static folder) or `design/`; before any deploy, publish or recording; or an `ip.*` gate fails.

## Purpose
Ideas, conventions and measured facts are free. Another party's text, images, logos, fonts, code and distinctive arrangement are not, and French parasitism needs no originality.
This file turns the copying policy, the sponsors' published brand rules and the font and icon licences into rules the `ip.*` gates check, plus the provenance record events ask for.
Capture-side rules are in `02-references.md`; the project's own name and mark against sponsor marks are in `04-brand.md` (BR-21 to BR-23).
Not legal advice: where a rule is unclear, the conservative reading applies.

## Rules

### IP-01 - Decide every reuse with the policy table
- **Rule:** Before using anything that belongs to a customer, a sponsor or any third party, find its row below and follow the verdict. An action the table does not list is Forbidden until the owner decides.
- **Why:** The table is FD09's synthesis of its findings [FD09 Policy table (derived from the findings; not legal advice)]. Protection is claimed country by country, so the strictest set, France and the EU, is the target [FD09-F31].
- **Check:** every `ip.*` gate; critic.
- **Not when:** Never waived.

| # | Action | Verdict | Conditions | Basis |
|---|---|---|---|---|
| 1 | Study customer and sponsor sites; write down jobs, structure, flows, conventions, tone | Allowed | The output is words, not pixels | [FD09-F03] [FD09-F06] [FD09-F10] |
| 2 | Measure facts (type sizes, spacing steps, contrast, steps in a flow) | Allowed | Never reassemble one site's full combination | [FD09-F04] [FD09-F11] |
| 3 | Keep screenshots of customer sites | Conditional | Only under the capture policy: outside any repo, shared with nobody, purged (`02-references.md`) | [FD09-F02] |
| 4 | Run image-to-code on a customer's screenshot | Forbidden | Image-to-code only on the team's own sketches | [FD09-F01] [FD09-F22] |
| 5 | Rebuild a customer page, even with swapped colours | Forbidden | Copyright if original, unregistered EU design, parasitism by accumulation | [FD09-F01] [FD09-F07] [FD09-F11] [FD09-F25] |
| 6 | Reuse customer headlines, taglines or microcopy | Forbidden | | [FD09-F05] [FD09-F11] |
| 7 | Name a customer in plain text to explain the use case | Conditional | Only as much as needed, truthful, no implied relationship; no logo, lettering or brand colours (IP-02) | [FD09-F12] [FD09-F13] [FD09-F15] |
| 8 | Show a customer's logo | Forbidden by default | Only with written permission or under that customer's published brand rules | [FD09-F13] [FD09-F15] [FD09-F16] [FD09-F17] |
| 9 | Concept mockup of how customer X would use the protocol | Conditional | Own generic frame, customer as a word only, concept label on the frame and in every video shot (IP-03), fictional data, no "powered by X", built after kickoff where rules require; prefer a fictional stand-in when the name adds nothing | [FD09-F12] [FD09-F13] [FD09-F14] [FD09-F25] [FD09-F27] |
| 10 | "Trusted by", "Partners" or "Used by" row of customers | Forbidden | Implies a commercial connection; no contract, so the client-reference tolerance fails | [FD09-F13] [FD09-F16] [FD09-F17] |
| 11 | Sponsor logo with the sponsor's approved wording | Conditional | Per the sponsor's published rules and `assets/sponsor-allowlist.json` (IP-05 to IP-07) | [FD09-F17] [FD21 Deliverable] |
| 12 | Download or reuse font files from a customer's `@font-face` | Forbidden | Licensed to that customer's domain or organisation | [FD09-F18] |
| 13 | Match a customer's typeface style with an open font of the same classification | Allowed | OFL, Apache or UFL from google/fonts, self-hosted, licence file shipped | [FD09-F19] [FD09-F20] |
| 14 | Use an OFL font in the protocol's logo | Allowed | Check the Reserved Font Name (IP-11) | [FD09-F18] [FD09-F19] [FD16-F30] |
| 15 | Read a customer's CSS or JS in DevTools to understand a technique | Allowed | Re-implement from the project's own tokens | [FD09-F09] |
| 16 | Copy CSS, JS, SVG paths or component markup from a customer site | Forbidden | Served code carries no licence | [FD09-F09] [FD09-F21] |
| 17 | Use customer images, illustrations, 3D renders, videos or icons | Forbidden | All rights reserved by default | [FD09-F01] [FD09-F21] |
| 18 | Use Unsplash photos, MIT or ISC icon sets, CC BY icons | Conditional | Keep the notices, attribute CC BY, record provenance (IP-12, IP-13) | [FD09-F21] |
| 19 | Use a real brand's DESIGN.md as the protocol's skin | Forbidden | Vocabulary for analysis only | [FD09-F11] [FD09-F24] [FD09-F25] |
| 20 | Show a customer's live product to explain the problem | Conditional | A redrawn neutral diagram by default; a real screenshot only as a cropped, credited detail (IP-15) | [FD09-F02] [FD09-F07] [FD09-F13] [FD09-F32] |
| 21 | Prepare the protocol's logo, tokens or pages before kickoff | Forbidden where rules say so | TOKEN2049 Origins and ETHGlobal Classic forbid it; BNB Hack lets an existing product enter with a before and after | [FD09-F26] [FD09-F27] [FD09-F28] |
| 22 | Load Google Fonts from Google's servers on an EU-facing site | Forbidden | Self-host instead | [FD09-F20] |
| 23 | Publish a mockup that imitates a real organisation as a claude.ai artifact | Forbidden on Claude's initiative | Build it as a local file; the owner decides on any URL (IP-04) | [FD09-F25] |
| 24 | Ask Claude or the Design type to recreate a named company's UI | Forbidden | Anthropic's rule refuses it (IP-16) | [FD09-F25] [FD15-F27] |
| 25 | Record provenance for every asset | Required | `design/provenance.json` (IP-13) | [FD09-F21] [FD09-F26] [FD09-F29] |

### IP-02 - Name customers in words only
- **Rule:** A customer appears only as its plain name in running text, and only as much as the explanation needs. No logo, no lettering in its typeface, no brand colours or lockup, no "Trusted by", "Used by" or "Partners" row, no "powered by" claim about it, no testimonial or user count attributed to it.
- **Why:** Using another's mark to refer to its goods is lawful only if necessary and honest [FD09-F12] [FD09-F13]. A competitor may say "Coca-Cola" but not use its distinctive lettering [FD09-F15]. The client-reference tolerance needs a contract in force, which a hackathon team does not have [FD09-F16].
- **Check:** `ip.logos`; critic.
- **Not when:** The customer is also a sponsor whose published rules allow more: IP-05.

### IP-03 - Label every frame that names a company as a concept
- **Rule:** Any frame, mock or screen that names a real company carries the label visibly on the frame itself, on an element marked `data-concept-label`, not only in a footer. The same label appears as on-screen text in every video shot that shows the frame, and the README gets a "Third-party names" section with the long form. Data in such a frame is fictional and says so. Use these templates verbatim, filling the brackets.
- **Why:** In Arsenal a notice that stayed behind when the goods travelled did not prevent infringement, and the Court never accepted a notice as a defence [FD09-F14]. A label cannot cure a presentation that already suggests a commercial link [FD09-F13]. Placement, scope and wording come from [FD09 Template disclaimer for a concept mockup naming a real company].
- **Check:** `ip.concept-label`.
- **Not when:** A plain-text mention inside an explanatory sentence (table row 7) needs no label.

Short label (EN): `Concept mockup. Not affiliated with, endorsed by or sponsored by [Company].`

Long form (EN):
> Concept illustration. [Company] is named only to show where [Protocol] could be used. [Company] has not reviewed, endorsed or sponsored this project, and the [Protocol] team has no relationship with [Company]. [Company] and its logos are trademarks of their owner. The interface shown is our own design and does not reproduce [Company]'s product. All figures are fictional.

Short label (FR): `Maquette conceptuelle. Sans lien avec [Société], qui ne l'a ni approuvée ni parrainée.`

Long form (FR):
> Illustration conceptuelle. [Société] est citée uniquement pour montrer où [Protocole] pourrait être utilisé. [Société] n'a ni relu, ni approuvé, ni parrainé ce projet, et l'équipe [Protocole] n'a aucune relation avec [Société]. [Société] et ses logos sont des marques de leur titulaire. L'interface présentée est notre propre conception et ne reproduit pas le produit de [Société]. Tous les chiffres sont fictifs.

### IP-04 - Never publish a frame that names or imitates a real company
- **Rule:** Concept mockups that name a real company stay local files; the owner decides whether any of them gets a URL. Never publish one, on Claude's initiative, as a claude.ai artifact, a canvas artboard or a deployed page. Review canvases mask company names (`03-directions.md`, "Publishing the board").
- **Why:** Per the Artifact tool's description (re-read it before each event), the tool builds content that imitates a real organisation as local files and never publishes a page that impersonates one [FD09-F25] [FD08-F27]; table row 23.
- **Check:** owner review.
- **Not when:** Never waived on Claude's initiative.

### IP-05 - Show a sponsor logo only as the allowlist allows
- **Rule:** Read the sponsor's entry in `assets/sponsor-allowlist.json` (ten parties: `cardano`, `cardano-foundation`, `input-output`, `chainlink`, `ledger`, `bnb-chain`, `solana`, `token2049`, `dvb`, `masumi`). Default to the sponsor's name in text. Show a logo only when `logo_default` is `official_file_unaltered_allowed` (Cardano; Solana, whose permission is inferred) or when `approval_evidence` holds the path to a written yes for that use. Then use the official file whose SHA-256 matches `logo_sources`, unaltered. Never draw a sponsor's or a customer's mark in SVG, CSS or on a canvas.
- **Why:** Only Cardano grants automatic permission, for its standalone unaltered official logo [FD21-F03]. Solana offers its files for websites with no approval step, which is permission inferred, not granted [FD21-F12] [FD21-F13]. Chainlink requires prior written consent [FD21-F09]; BNB Chain asks for the proposed use first [FD21-F20]; Ledger's terms forbid reproducing its logos [FD21-F16]; TOKEN2049's wordmark needs prior approval [FD21-F21]; Input Output, DVB and Masumi grant nothing [FD21-F07] [FD21-F22] [FD21-F26]. Hash matching and the gate logic come from [FD21 Deliverable]. Claude does not reproduce a specific logo, even drawn in code [FD15-F33].
- **Check:** `ip.sponsor-marks`; `ip.logos`.
- **Not when:** An SDK that renders the sponsor's own first-party UI (Ledger Wallet Provider, which needs partner keys): exempt that subtree and record why [FD21-F19]. The project's own name and mark: `04-brand.md` (BR-21, BR-22).

### IP-06 - Keep a shown sponsor logo unaltered, secondary and apart
- **Rule:** A shown sponsor logo has no transform other than a ratio-preserving scale, and no filter, blend mode, animation or transition on it or its ancestors. It meets its file's minimum size and clear space (Cardano 64 px on the web with six dots of clear space; BNB Chain 97 px wide for the horizontal lockup with X clear space, left-aligned). It is never the largest visual element in a viewport or slide, and never within one clear-space unit of the project's mark. When a Cardano logo renders, the same page or slide carries: `Cardano™ and the Cardano Logo™ are trademarks of Cardano Foundation, CHE-184.477.354, Dammstrasse 16, 6300 Zug, Switzerland, in Switzerland and other countries`. Never add ® to the logo file.
- **Why:** Cardano forbids altering, rotating or combining its marks and sets 64/60/56 px and a six-dot clear space [FD21-F02] [FD21-F04]; its policy asks for TM notices and forbids switching TM to ® [FD21-F05]. Chainlink forbids animating marks or making them the focal point [FD21-F09]. BNB Chain sets minimum widths, X clear space and left alignment [FD21-F20]. Judges discount branding and reward the mechanism [FD21-F23]. The treatment, lockup, focal and notice gates are in [FD21 Deliverable].
- **Check:** `ip.sponsor-marks`.
- **Not when:** Never waived.

### IP-07 - Write sponsor names the way their rules allow
- **Rule:** Run each active sponsor's `forbidden_phrases` on rendered text and use its `allowed_phrases` instead. In particular: Cardano as an adjective ("a Cardano application", "built on the Cardano blockchain"), never "Cardano's", never "Official" or "Certified" before it; BNB Chain only with "Powered by", "Available on" or "Building on", never "Official", "Partnering" or "Collaborating"; no "Powered by Chainlink" or "Secured with Chainlink" (no badge exists), write "uses Chainlink CRE to ..."; "TOKEN2049" in capitals without a space; Ledger's trademarked product names, with "Ledger Wallet" over "Ledger Live" and "signer" over "hardware wallet" as advisories. No copy claims a review, certification, partnership or endorsement by any sponsor.
- **Why:** Cardano's copy rules [FD21-F05]; Chainlink's descriptive-use terms [FD21-F09] and its withdrawn badges [FD21-F10]; Ledger's renaming [FD21-F18] and its statement that a technical review is no endorsement [FD21-F19]; BNB Chain's listed phrases [FD21-F20] [FD09-F17]; TOKEN2049's spelling rule [FD21-F21].
- **Check:** `ip.sponsor-marks`.
- **Not when:** Quoted third-party text, such as an organiser's rule, is not linted [FD21-F05].

### IP-08 - Exempt a sponsor gradient only by file hash
- **Rule:** The gradient tell exempts a gradient only inside an allowlisted official file matched by SHA-256, or that file's own unmodified `<linearGradient>`; never by colour, never as page decoration. Never write a tier-2 waiver for a palette or gradient a sponsor claims as a mark (`claimed_as_mark: true`, Solana). The rule against wearing sponsor trade dress is BR-23 in `04-brand.md`.
- **Why:** Of the official logo files checked, only Solana's colour logos carry a gradient; the other brand gradients belong to organisations, not logos [FD21-F24] [FD21-F14]. Solana claims its gradient, colours and look and feel as marks [FD21-F13]. The Cardano Foundation's gradients and blurred shapes read as its own material [FD21-F06]; Ledger's purple and liquid backgrounds are Ledger's [FD21-F17].
- **Check:** `tells.tier1`; `tells.tier2`; `ip.sponsor-marks`.
- **Not when:** Never waived.

### IP-09 - Ship only open-licensed, self-hosted fonts with their licence files
- **Rule:** Every shipped font file is OFL, Apache, UFL or MIT (the set `ip.fonts` enforces); its licence file ships beside it; it is served from the project's own origin. No built page requests `fonts.googleapis.com` or `fonts.gstatic.com`. Credit the designer and the foundry wherever a Velvetyne face is used.
- **Why:** The OFL permits use, embedding, modification and redistribution with the licence text, logos included [FD09-F19]. A German court ordered EUR 100 in damages and an injunction against a site that loaded Google Fonts from Google's servers without consent [FD09-F20]. Open sources, and Velvetyne's credit condition [FD16-F11].
- **Check:** `ip.fonts`; `ip.hotlinks`.
- **Not when:** A system font stack ships no file and needs no licence [FD16-F17].

### IP-10 - Never ship a font file you hold no licence for
- **Rule:** Never ship a font file taken from a customer's `@font-face`, from a sponsor's kit (ABC Diatype, Brut Grotesque) or bought under someone else's commercial web licence. Keep Fontshare "Closed Source" fonts (ITF Free Font License 2.0) out of any public repository and any third-party canvas or design tool, and never subset or convert them.
- **Why:** Commercial webfont licences bind the licensee's domain or organisation [FD09-F18]. Fonts in sponsor kits are commercial and non-transferable, so downloading them grants nothing [FD21-F15]. FFL 2.0 forbids distribution through a repository or publicly accessible server, use through a design tool, subsetting and format conversion [FD16-F12].
- **Check:** `ip.fonts`; `ip.provenance` (the source of every font file).
- **Not when:** The team holds its own licence for the face, recorded in `design/provenance.json` with its licence file.

### IP-11 - Rename or ship whole any OFL font with a Reserved Font Name
- **Rule:** Read each face's `OFL.txt` for "Reserved Font Name". With none, subsetting is free. With one (IBM Plex reserves "Plex"), ship the unmodified files, or rename the subset in its `name` table and in `@font-face`, or pick another face. A provider's pre-built subsets committed to a public repository count as a modified version.
- **Why:** Subsetting a webfont is modification and normally loses the right to the Reserved Font Name; the FAQ's answer is to pick your own name [FD16-F30] [FD09-F19].
- **Check:** `ip.fonts`.
- **Not when:** Never waived.

### IP-12 - Keep every icon and library notice alive
- **Rule:** Record the licence of each icon set and UI library and keep its notice where users can reach it:
  - Lucide: ISC, plus MIT for its Feather-derived icons;
  - Font Awesome Free icons: CC BY 4.0, attributed in file comments that SVGO strips, so add the notice elsewhere when optimising;
  - Remix Icon: never as a logo, brand mark or app icon;
  - lightweight-charts: keep `attributionLogo: true`, or add the NOTICE line and a link to tradingview.com on a reachable page;
  - Reown AppKit: only when a sponsor requires it, then ship "Portions © 2025 Reown, Inc. All Rights Reserved", the licence copy and its branding.
  Never start the project's mark from a library icon.
- **Why:** Web assets default to all rights reserved and each library states its own terms [FD09-F21]. Icon licences and Remix Icon's logo ban [FD16-F20]. Lightweight Charts requires the NOTICE and a link [FD16-F22]. Reown's licence requires its notice, licence copy and branding [FD16-F26].
- **Check:** `ip.provenance`.
- **Not when:** Never waived.

### IP-13 - Record provenance for every asset
- **Rule:** Every file under `brand/`, `public/` (or the stack's static folder) and `design/` fonts has an entry in `design/provenance.json`: `{path, kind: "font|image|icon|logo|data|video", source, license, licenseFile?, ai: "generated|assisted|none", tool?, notes?}`. Set `ai` on every generated or assisted file, Claude-drawn marks and comps included. Add the entry in the same commit as the file.
- **Why:** Provenance is required for every asset (table row 25). ETHOnline 2025 and 2026 require AI attribution down to files and assets [FD09-F26] [FD11-F22]. Event rules put IP warranties and indemnities on entrants [FD09-F29]. Peers spotted reused demo material and the team lost its prize [FD09-F30].
- **Check:** `ip.provenance`.
- **Not when:** Never waived.

### IP-14 - Follow each event's own originality and AI rules
- **Rule:** Read the event's own rules page (fetched by /hackathon) for: pre-existing work, design before kickoff, AI attribution, third-party marks in the video. Until it is read, assume: no design artifact before kickoff, AI use declared per file, no third-party mark in any recorded frame without permission.
- **Why:** TOKEN2049 Origins: "no code, designs, or prototypes before kickoff" [FD09-F27]. ETHGlobal Classic bars pre-existing project-specific designs, and ETHOnline 2025 required AI attribution [FD09-F26]; ETHOnline 2026 may exclude projects built entirely by AI [FD11-F22]. BNB Hack lets an existing product enter with a before and after [FD09-F28]. Devpost's and Chainlink's own hackathon rules barred third-party marks from the video [FD09-F29] [FD21-F11]. Each text belongs to one event [FD09-F29].
- **Check:** owner review.
- **Not when:** Never waived.

### IP-15 - Show another company's product only as a redrawn diagram or a cropped, credited detail
- **Rule:** To explain a problem with a customer's current product, draw a neutral diagram of the flow in the protocol's own design. A real screenshot appears only as a cropped detail of the element under discussion, with the author and the source named, never as a whole page and never presented as the protocol's UI. Record the decision in `design/provenance.json`.
- **Why:** A whole-page reproduction is not a "courte citation" in France, whatever its size or screen time [FD09-F32] [FD09-F02]; table row 20.
- **Check:** critic; `ip.provenance`.
- **Not when:** The product is the team's own (a before and after for an existing product) [FD09-F28].

### IP-16 - Never recreate a named company's UI, icon set or logo
- **Rule:** Never ask Claude, a subagent, the Design type or an image-to-code tool to recreate, or "make it look like", a named company's page, component, icon set or logo, even drawn in code. Run image-to-code only on the team's own sketches.
- **Why:** Anthropic's Design type refuses another company's proprietary design and its distinctive UI [FD09-F25] [FD07-F34]; Anthropic's claude.ai system prompts decline a specific logo, icon set or product design, even in SVG or CSS [FD15-F33]; code beats screenshots, and recreation is only from real source [FD15-F27]. A widely used image-to-code tool imports the real logos and images [FD09-F22]. Figma pulled a feature whose output resembled Apple's Weather app [FD09-F23].
- **Check:** critic.
- **Not when:** Never waived.

### IP-17 - Write original copy and flag overlaps with customer text
- **Rule:** Never reuse a customer's or sponsor's headline, tagline or microcopy. `ip.copy-overlap` flags any run of 8 or more consecutive words shared between rendered text and captured customer copy, a heuristic and not a legal line; rewrite each hit. Boilerplate the whole market uses (standard legal text, "Connect wallet") is not a hit.
- **Why:** An extract of 11 consecutive words can be a reproduction, and the threshold is a heuristic inspired by that case [FD09-F05]. An identical presentation text weighed in the 2022 parasitism ruling [FD09-F11]. Wording found identically on many sites is not appropriable [FD09-F06].
- **Check:** `ip.copy-overlap`.
- **Not when:** Quoting a rule or a sponsor's listed phrase (IP-07).

### IP-18 - Re-fetch and re-hash sponsor kits before each event
- **Rule:** Before each event, re-download the official files listed in `assets/sponsor-allowlist.json`, compare their SHA-256, re-read the brand and trademark pages, and update the entry with the new access date. A hash mismatch blocks logo use until the kit is re-read.
- **Why:** Sponsors change files and rules fast: Chainlink's badges went from free downloads to approval-only to gone between 2022 and October 2026 [FD21-F10]. A file update changes its hash, so the allowlist needs refreshing before each event [FD21-F24]. The hashes date from 2026-10-01 [FD21 Deliverable].
- **Check:** `ip.sponsor-marks`.
- **Not when:** Never waived.

## Procedure
1. When a file lands under `brand/`, `public/` or `design/`, add its `design/provenance.json` entry in the same commit (IP-13).
2. For each id in the profile's `sponsors`, read its allowlist entry; note `logo_default`, `approval_evidence`, `allowed_phrases` and `trademark_notice` (IP-05 to IP-07).
3. Before any deploy, publish or recording: `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates ip,coverage.nevershow --root <repo> --profile <abs path to profile.json> --serve <built dir>`. Fix the cause of every failing gate and re-run until exit 0. Never add a waiver to pass an `ip` gate.
4. Before each event: IP-18, and re-read the event's rules (IP-14).

## Gaps
- Not legal advice, and no lawyer reviewed the dossiers; French lower-court decisions were read from reprints [FD09 Weak spots of this dossier].
- Singapore copyright and passing off were not researched, though the Origins demo happens in Singapore [FD09 What could not be found, and how it was searched]. Whether a prize-bearing, investor-facing demo is "commercial" is unsettled and may differ by country [FD09-F14] [FD09 Contradictions between sources].
- Solana's logo permission is inferred, and its guidelines' ban on descriptive use could be read against "built on Solana" [FD21-F13]. Cardano's policy says both "written permission is required" and "automatic permission" for the standalone logo [FD21-F03].
- `assets/sponsor-allowlist.json` (ten parties) is built from [FD21 Deliverable]; its hashes date from 2026-10-01 (IP-15).
- `ip.copy-overlap` runs after the capture purge on salted 8-word shingles (`ip-check.mjs --index-copy`, CONTRACTS 6.3); whether hashed shingles may be kept under P13 was not researched.
- MIT is in the licence set `ip.fonts` accepts, but no finding examines MIT-licensed fonts.
- The full terms of TOKEN2049 Origins, BNB Hack and Ledger OP3N were not read [FD09-F27] [FD09-F28] [FD21-F23]. Whether the TOKEN2049 logo may appear on a finalist deck is an organiser question [FD21-F21].
- Reserved Font Names were read only for IBM Plex and Inter; every other family needs its own `OFL.txt` read [FD16-F30]. The owner's public Orma repository commits Plex subsets that keep the reserved name: a case to raise with the owner, not a finding of infringement [FD16-F30].
- Hugeicons' licence text was not read, only its package metadata [FD16-F20]. Reown's "applicable logo and branding" is undefined in the text read [FD16-F26].
- How far "an obvious variation" of a sponsor mark extends is a legal judgement the naming check can only flag [FD21-F04].
