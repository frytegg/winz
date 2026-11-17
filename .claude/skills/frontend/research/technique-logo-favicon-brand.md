# Logo, SVG mark, favicon, OG image and naming checks for a protocol

> Code FD12 · slug technique-logo-favicon-brand · researched 2026-09-30 · verified 2026-09-30 · counts: verified 20 / corrected 6 / downgraded 4 / dropped 0 / added 0

## Summary

- A new protocol logo carries no meaning for a jury. Rand (1991): "It is foolhardy to believe that a logo will do its job right off". Bierut (Pentagram, 2015): "a brand new logo seldom means a thing". The page explains the protocol; the logo only has to identify it and must not look generic. Cap the time spent on it.
- Wordmark first. Chermayeff & Geismar & Haviv build a symbol only "when there is a compelling strategic reason", and they report that purely typographic marks ease the trademark search. A favicon still needs a compact mark: derive it from the wordmark (initial or monogram) on a 32-unit grid.
- Criteria to encode as checks: reproducible "in one color and in exceedingly small sizes" (Rand); works at "around one inch, without loss of detail" (Airey); silhouette drawn in black and white before any colour (Haviv, Airey); "just one feature" (Airey); no trends, swooshes or shading (Geismar).
- Crypto clichés are measurable: 13% of the top-500 CoinMarketCap logos mimic Bitcoin's struck-through initial (Fast Company, 2022). Pyramids (Ethereum) and hexagons recur, along with crossbarless A's, letters split by horizontal gaps and lightning bolts. (corrected: the article places swooshes in the dot-com era, not among crypto logos; swooshes stay on the list only through Geismar, F02.)
- LLM-written SVG: frontier models sit within 1.5 points of each other on VectorGym Text2SVG (GPT-5.1 70.68, Gemini 3 Pro 69.92, Claude Sonnet 4.5 69.19, EMNLP 2026). All models degrade as SVG complexity rises (SVGenius, 22 models). Keep marks to a few primitives.
- The model is a poor judge of its own creative SVG. On VectorGym Text2SVG, VLM-judge vs human correlation is 0.11 to 0.40 (Claude Sonnet 4.5 as judge: 0.26), against about 0.8 on sketch fidelity. These printed averages include a Ground Truth row; without it the ranges are 0.21 to 0.55 against 0.64 to 0.75 (F09). Automate the objective checks and let the owner choose among 3 to 5 candidates. Revision alone helps only a little: on VCode's MM-Vet split, Claude-4-Opus rose from 37.5 to 38.8 after one revision round and 39.5 after two, while external vision tools alone gave +16.6. The headline +12.3 (VCoder over its own base model, Claude-4-Opus) combines both. (corrected: the dossier credited the whole +12.3 to revision and called Claude-4-Opus the best baseline; the paper's Table 2 puts GPT-5 at 46.8 against Claude-4-Opus at 41.7.)
- Recraft V4/V4.1 Vector costs $0.08 per SVG ($0.30 Pro). Free-tier images belong to Recraft and are public; API outputs belong to the user (Developer Terms 6.2, 11 Aug 2026), with a no-AI-training restriction. Output from Recraft's MCP server follows the account's plan (Developer Terms 4.3), so a free account gives Free Tier assets through MCP too. The US Copyright Office: "prompts do not alone provide sufficient control".
- OFL fonts may be used in logos with no permission and no attribution (OFL-FAQ 1.1-update7). Pick outside the owner's banned faces (Inter, Space Grotesk, Instrument Serif).
- A Node-only pipeline ran on this Windows machine in 6.2 s without ImageMagick or Inkscape: opentype.js 2.0.0, svgo 4.1.0, @resvg/resvg-js 2.6.2 or sharp 0.35.5 (librsvg 2.63.2), png-to-ico 3.0.2, satori 0.33.5. Dependencies: 66 MB.
- Gotcha 1: SVGO's default preset (`npx svgo --multipass`, the command the Evil Martians guide gives) strips a `prefers-color-scheme` rule when the light colour is also a class rule in `<style>`. The guide's own pattern (light colour as a `fill` attribute) survives. In Chromium 147 the class-styled icon then stays dark in dark mode. Fix it with `inlineStyles: false` or the guide's presentation-attribute pattern, then assert the result.
- Gotcha 2: opentype.js 2.0.0's default `toPathData()` garbles the wordmark (at verification its output contained literal `NaN` coordinates); pass `flipY: false` and fail on `NaN`.
- Gotcha 3: the maskable safe zone is a circle of radius 40% (204.8 px on 512). The "409 × 409 on a 512 canvas" recipe fails for a full-bleed mark (ink radius 258.2 px). Check each mark geometrically.
- Favicon set: `favicon.ico` 32 with `sizes="32x32"`, `icon.svg` (91.61% global support, Safari 26+), `apple-touch-icon` 180, and a manifest with 192, 512 and maskable 512. Google Search does not list SVG as a favicon format and recommends more than 48 × 48. Next.js derives the ICO's `sizes` from the file: under `next build --webpack` from the first entry (image-size 1.2.1), under the default Turbopack build from the entry the Rust `image` crate picks (highest bit depth, then largest area). A single 32 px ICO gives `32x32` on both paths, so ship that. (corrected: the dossier described only the webpack path.)
- Lookalike and name checks: WIPO Global Brand Database logo search (Concept and Shape strategies); TMview image search (above 100 × 100 px, at most 2 MB, over 57 million figurative marks); TinEye finds copies only. For names, use RDAP through the IANA bootstrap with a positive and a negative control in each pass (the owner's `.dev` endpoint returned 404 for the registered `web.dev`; at verification, 6 of the 16 `.dev` names that the owner's Passes 1 and 3 marked "free" were registered before the study date), npm `/-/org/<name>/package`, and `gh api users/<name>`. An X handle needs a manual check.

## Findings

### FD12-F01 — A logo identifies and does not explain; it must survive one colour and very small sizes (Rand)
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** DOWNGRADED (A to C: every quote was re-read on the cited page and is accurate, but the grading rubric reserves A for official docs, source code, peer-reviewed data or a tool's own files; a designer's essay is a practitioner assertion, widely held, which is C)
- **Claim:** Paul Rand's 1991 AIGA essay says a logo identifies rather than sells, is rarely a description of the business, and acquires meaning only after the audience is conditioned. He lists seven effectiveness criteria. The only mandatory properties he names are attractiveness and reproducibility in one colour at very small sizes. Complexity ("a fussy illustration or an arcane abstraction") is self-defeating.
- **Implication for /frontend:** The logo step must not try to depict the protocol's mechanism; that is the page's job. Encode two hard gates from Rand's "mandatory" sentence: a one-colour render and a 16 px render must both remain recognisable (see F16). Reject marks built as illustrations of the mechanism, such as chains, nodes or flows.
- **Evidence:**
  - [Logos, Flags, and Escutcheons](https://www.paulrand.design/writing/articles/1991-logos-flags-and-escutcheons.html) — Paul Rand, originally AIGA 1991, reproduced on paulrand.design (Daniel Lewandowski), accessed 2026-09-30 — primary essay text.
    - "A logo is a flag, a signature, an escutcheon."
    - "It is foolhardy to believe that a logo will do its job right off, before an audience has been properly conditioned."
    - "Only after it becomes familiar does a logo function as intended; and only when the product or service has been judged effective or ineffective, suitable or unsuitable, does it become truly representative."
    - "The role of the logo is to point, to designate-in as simple a manner as possible. A design that is complex, like a fussy illustration or an arcane abstraction, harbors a self-destruct mechanism." (corrected: the cited page prints a hyphen, "designate-in", not an em dash)
    - Page header (verification): "Originally published in 1991 by AIGA, the professional association for design."; the page's `<meta name="author">` is "Daniel Lewandowski".
    - "The effectiveness of a good logo depends on: a. distinctiveness b. visibility c. useability d. memorability e. universality f. durability g. timelessness"
    - "Ultimately, the only thing mandatory, it seems, is that a logo be attractive, reproducible in one color and in exceedingly small sizes."
- **Limits / false positives:** These are the judgements of one designer, not measurements. "Attractive" cannot be checked mechanically. Rand wrote for corporate identity with years of exposure; a hackathon logo gets minutes, which strengthens the "cannot explain" point but says nothing about taste.

### FD12-F02 — Build a symbol only for a strategic reason; start from the name, draw in silhouette, avoid trends (Chermayeff & Geismar & Haviv)
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** DOWNGRADED (A to C: all quotes verified verbatim in the three sources, but they are a studio's stated practice, a practitioner assertion under the rubric; the "three criteria" claim had no quoted support, so the Logo Geek passage is added below)
- **Claim:** C&G&H partners state three criteria: appropriate, distinctive (memorable), and simple. They develop a symbol only for a compelling strategic reason, because every new element has to be learned. Otherwise they put the emphasis on the name, with one simple intervention. They report that typographic solutions ease trademark clearance because "so many basic, simple forms have already been claimed". They design "in silhouette" before colour. They avoid trends ("never done a swoosh"). Shading and graphic niceties fail across media, while simple marks thrive as favicons.
- **Implication for /frontend:** Default to a wordmark in a deliberately chosen typeface plus at most one intervention: a colour change, an unusual letter arrangement, a graphic accent or custom lettering. Produce a symbol only when a written reason exists (for example "the favicon needs a mark", "the name is long", "several products share a parent"). Then derive the favicon mark from the wordmark itself (initial or monogram). Draw every candidate in black silhouette first, add colour last, and forbid swooshes, gradients and shading in the mark.
- **Evidence:**
  - [When to Wordmark?](https://www.printmag.com/branding-identity-design/when-to-wordmark-2/) — Sagi Haviv, PRINT Magazine, 14 May 2015, accessed 2026-09-30 — practitioner's own article (read via Exa; PRINT returns 403 to WebFetch).
    - "Creating a symbol can be a great design exercise, but we try to be very disciplined about only developing a symbol when there is a compelling strategic reason to do so. This is because visual identities work through familiarity, so any new visual element has to be learned first in order to be established."
    - "But absent a good reason for a symbol, it is always a better idea to start with putting the emphasis on the name and trying to find a simple, focused way—a change of color, an unusual arrangement of letters, a graphic accent or even just a unique lettering style—to make it memorable."
    - "it’s nearly impossible to create a distinctive (yet still good) eagle."
    - "Although assignments that call for a purely typographic solution can often be challenging, they are less excruciating in one respect: the pressures and stress of the trademark search."
    - "It is becoming harder to create an original symbol simply because so much has been done, and so many basic, simple forms have already been claimed and trademarked."
  - [Marks Men: An Interview With Ivan Chermayeff, Tom Geismar, and Sagi Haviv](https://www.printmag.com/branding-identity-design/marks-men-an-interview-with-ivan-chermayeff-tom-geismar-and-sagi-haviv-of-chermayeff-geisma/) — Aaron Kenedi, PRINT Magazine, 14 Sep 2011, accessed 2026-09-30 — interview (primary for the partners' words).
    - Tom Geismar: "We consciously try to avoid graphic trends and can proudly say we’ve never done a swoosh."
    - Tom Geismar: "It’s the ones that rely on details of shading and other graphic niceties that have a hard time."
    - Sagi Haviv: "I’ve been astonished to see how these simple marks, conceived before this technology, thrive in the new visual environment―in tiny sizes on the web, as favicons and mobile-device application icons."
    - Sagi Haviv: "To treat the technology as a tool but not as the generator of ideas."
    - Ivan Chermayeff: "Show us a current trend, and its death will not be far behind it."
  - [Saying No to Clients | An interview with Sagi Haviv](https://logogeek.uk/podcast/sagi-haviv/) — Ian Paget, Logo Geek podcast episode 22 (date not shown), accessed 2026-09-30 — interview transcript.
    - "We design in silhouette, right? We don't even touch colour until we've found a distinctive own-able silhouette."
    - "as the time passes more and more simple shapes are owned and claimed and the available shapes are less and less."
    - Added at verification (source of the "three criteria" claim): "We list for them three criteria. What are we looking for from a good logo? We're looking for something appropriate. Appropriate really means … It doesn't mean expressive, because we can't say very much with a good logo. In fact, the less they say, the better." ... "The second thing is if it's memorable, distinctive, unusual enough to persist in our mind." ... "Then the last criteria is simplicity. Needs to be simple, uncomplicated in form, so they can work on every platform, be flexible, can work tiny, can work big".
  - Note at verification: in the same PRINT interview Haviv adds that a simple, distinctive mark "can then take on any 'fashionable' treatment when necessary, such as 3-D rendering, drop shadows, and so on, without losing its basic recognition". This concerns treatments of a finished mark, so it does not weaken the ban on gradients and shading inside the mark itself.
- **Limits / false positives:** A studio's stated philosophy, not a controlled result. "Appropriate" cannot be automated; it comes from the research phase (for /frontend, /hackathon's sponsor and customer research). The trademark remark concerns registered marks at the scale of global corporations; a hackathon protocol faces a lighter clearance bar (F17, F18).

### FD12-F03 — Airey's elements: simple, relevant, distinctive; about one inch without loss of detail; one feature; black and white first
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** DOWNGRADED (A to C: quotes, the seven element headings, the 2015 tip headings and the 3rd-edition sentence all verified, but a practitioner's book is a practitioner assertion under the rubric)
- **Claim:** Logo Design Love (first edition, 2010) lists seven elements of iconic design: keep it simple, make it relevant, incorporate tradition, aim for distinction, commit to memory, think small, focus on one thing. It gives a minimum working size of about one inch and recommends working in black and white because "Color really is secondary". The third edition (O'Reilly listing dated 2026) condenses the ideal to "simple, relevant, and distinctive". The 2015 annotated edition's tip list includes "Test at a variety of sizes", "Offer a single-color version" and "There’s nothing wrong with using clichés".
- **Implication for /frontend:** Turn "think small" into a rendered test at 16, 32, 180 and 512 px (F16). Turn "focus on one thing" into a review question each candidate must answer in one line ("the one feature is ..."). Ship a single-colour version of every mark. Do not treat Airey as an authority against every cliché; see Contradictions.
- **Evidence:**
  - [Logo Design Love, chapter 3 sample (PDF)](https://ptgmedia.pearsoncmg.com/images/9780321660763/samplechapter/LogoDesignLove_c3.pdf) — David Airey, New Riders/Pearson, © 2010, accessed 2026-09-30 — publisher's sample chapter.
    - "a truly enviable iconic design will also be simple, relevant, enduring, distinctive, memorable, and adaptable."
    - "Your design should ideally work at a minimum size of around one inch, without loss of detail."
    - "Working in only black and white can help you create more distinctive marks, since the contrast emphasizes the shape or idea. Color really is secondary to the shape and form of your design."
    - "Iconic designs that stand apart from the crowd have just one feature to help them stand out. That’s it. Just one. Not two, three, or four."
  - [Logo Design Love, Annotated and Expanded Edition, sample pages (PDF)](https://ptgmedia.pearsoncmg.com/images/9780321985200/samplepages/9780321985200.pdf) — David Airey, © 2015, accessed 2026-09-30 — table of contents only.
    - "9. There’s nothing wrong with using clichés 165", "16. Offer a single-color version 166", "18. Test at a variety of sizes 168"
    - Added at verification, same contents list: "4. A logo doesn’t need to show what a company does 163", "5. A symbol isn’t always necessary 163", "8. Leave trends to the fashion industry 164", "10. Work in black and white 165". The PDF's title page reads "Logo Design Love, Second edition"; O'Reilly lists the same book as "Logo Design Love, Annotated and Expanded Edition, Second Edition".
  - [Logo Design Love, 3rd edition, chapter 3](https://www.oreilly.com/library/view/logo-design-love/9780135476727/ch03.xhtml) — David Airey, O'Reilly listing (Exa metadata 2026-03-06), accessed 2026-09-30 — preview text.
    - "a truly iconic logo is simple, relevant, and distinctive."
- **Limits / false positives:** Practitioner guidance. "One inch" is a print measure; its screen equivalent depends on device pixel density, so the 16 px test in F16 is the stricter proxy. The body of tip 9 (clichés) was not readable; only its heading was.

### FD12-F04 — A brand-new logo is an "empty vessel"; the jury will not read meaning into it (Bierut, Pentagram)
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** DOWNGRADED (A to C: both quotes verified verbatim, date 28 Sep 2015 confirmed, but this is a practitioner's judgement under the rubric)
- **Claim:** Pentagram partner Michael Bierut writes that a new logo means almost nothing until history and experience fill it. He warns that designers and clients substitute "the easy fix of the logo" for the harder work of communicating well.
- **Implication for /frontend:** Budget the logo tightly: a wordmark plus favicon mark, bounded to one short iteration loop. Spend the saved effort on what does carry meaning for a jury in minutes: the hero statement, the demo and the feature map. The review question for a candidate is "is it the right shape for what it will hold?" (neutral, sober, not misleading about the category), never "does it explain the protocol?".
- **Evidence:**
  - [Pentagram Partner Michael Bierut shares his wisdom on what makes a truly great logo design](https://www.itsnicethat.com/features/michael-bierut-logo-design) — It's Nice That, 28 Sep 2015, extract from Bierut's book, accessed 2026-09-30 — reprinted primary text.
    - "a brand new logo seldom means a thing. It is an empty vessel awaiting the meaning that will be poured into it by history and experience."
    - "Designing a logo, on the other hand, is an exercise with a beginning and an end. Clients know what to budget for it, and designers know what to charge for it. So designers and clients often substitute the easy fix of the logo for the subtler challenge of being smart."
    - Added at verification (source of the review question in the Implication): "The best thing a designer can do is make that vessel the right shape for what it’s going to hold." Article byline: words by Emily Gosling, It's Nice That.
- **Limits / false positives:** Bierut speaks about organisations with a long exposure horizon. A mark can still carry a negative first meaning (a pyramid read as a scheme, a hexagon read as "generic crypto"), so "empty" does not mean "harmless": see F05.

### FD12-F05 — Crypto logos converge on a few clichés: struck-through initials (13% of the top 500), pyramids, hexagons, rehashed older marks
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** A 2022 Fast Company analysis counted that 13% of the logos of the top 500 CoinMarketCap listings mimicked Bitcoin by striking initial letters through with lines or gaps. It names pyramids (after Ethereum) as characteristic and headlines the hexagon. It says other crypto logos rehash older designs: crossbarless A's like NASA's 1975 "worm" logotype, letters broken apart by horizontal strokes of white space as in ESPN's 1985 mark, and lightning bolts. Swooshes appear in the article only as the dot-com era's equivalent convergence, not as a crypto shape. C&G&H independently note the saturation of simple symbols (F02). (corrected: the dossier said the article "notes rehashed dot-com swooshes" among crypto logos and put swooshes in the title; the article attributes swooshes to dot-com logos only, and the rehashed crypto shapes are crossbarless A's, ESPN-style split letters and lightning bolts.)
- **Implication for /frontend:** Add a mark lint that flags, for human review: struck-through initial letters (the currency-symbol pattern), regular hexagons and isometric cubes, pyramids and triangles pointing both ways, crossbarless A's and letters split by horizontal gaps, lightning bolts, and any `<linearGradient>` or `<radialGradient>` in the mark. Orbit rings and swooshes stay on the list as general identity clichés on Geismar's authority (F02), not as a measured crypto pattern. These are "look twice" flags, not bans: a flagged shape passes only with a written reason tied to the protocol.
- **Evidence:**
  - [Here’s the real reason why all of the crypto logos look alike](https://www.fastcompany.com/90756090/crypto-logos-design-hexagon-bitcoin) — James I. Bowie, Fast Company, 2 Jun 2022, accessed 2026-09-30 — journalism with a count (text truncated after the pyramid paragraph).
    - "Of the logos for the top 500 CoinMarketCap listings recently, 13% mimicked Bitcoin by using initial letters struck through with lines or gaps, much like good old-fashioned fiat currency symbols."
    - "Pyramids appear with some regularity, likely thanks to the influence of Ethereum"
    - Subtitle: "And crypto has embraced the hexagon."
    - "Eventually, their orbits took on a more abstract and simplified form, turning into the ubiquitous and much-derided swooshes." (context at verification: the sentence before is "The internet gave us dot-com logos featuring various design elements, often representing information, circling the planet.")
    - Added at verification: "Other crypto logos’ attempts to project a futuristic vibe end up, ironically, rehashing designs of the past, such as crossbarless A’s doubling as launching rockets, like those in NASA’s 1975 “worm” logotype, or letters broken apart with horizontal strokes of white space, as in ESPN’s 1985 mark. Even the old lightning bolt makes an appearance in some of these emblems"
- **Limits / false positives:** One count, method not published, and the date of the "recently" sample is not given. The hexagon paragraph was paywalled, so no hexagon count is claimed here. SEO sites repeat unsourced statistics on this subject (see "What could not be found"). A struck-through letter can be legitimate when it encodes the protocol's idea; the lint only requires a reason.

### FD12-F06 — Expert-designed logos beat AI logo makers on differentiation; a 2025 preprint finds AI concepts on par with novices
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED (She Ji abstract re-read via Semantic Scholar and Crossref, 6(3):301–330 confirmed; preprint abstract, "121 participants", "30 subjects ... 15 design teams" and the 10 Mar 2025 posting date re-read on Research Square. Note at verification: in the preprint the same novice teams made both versions, one "freely created" and one "using AI tools", 100 minutes each, so the comparison is novices with AI tools against the same novices without them.)
- **Claim:** A peer-reviewed study ran two logo design studies and seven evaluation studies. Expert human logos were judged higher in quality than AI logo-maker output, and the advantage was tied to being "more expressive and differentiated". A 2025 preprint (121 raters; 15 teams of novice designers) found AI-generated initial concepts "conceptually and visually comparable" to manual ones at the concept stage.
- **Implication for /frontend:** The measured weakness of machine logos is differentiation, which is the property a jury needs to tell the project apart. Use generation for breadth of candidates, then select and refine by hand-set rules (F02, F03) and by the owner's pick. Never ship a first generation as the final mark.
- **Evidence:**
  - [Human Experts Outperform Technology in Creative Markets](https://doi.org/10.1016/j.sheji.2020.07.004) — Weingarten, Meyer, Ashkenazi, Amir, She Ji 6(3):301–330, 2020, accessed 2026-09-30 — peer-reviewed; abstract read via [Exa library](https://exa.ai/library/publication/2rlxzx162g2) and metadata via Crossref (full text returned 403).
    - "Two logo design studies and seven evaluation studies explore the performance of human designers as compared to artificial intelligence logo makers. Relative to logos produced through artificial intelligence, those created by expert humans are judged to be of higher quality. This advantage to expert humans is tied to their logos being more expressive and differentiated than the artificial intelligence logos."
  - [Exploring the Role of Artificial Intelligence in Brand Image Creation](https://doi.org/10.21203/rs.3.rs-5804841/v1) — Gual-Ortí et al., Research Square preprint, 10 Mar 2025, accessed 2026-09-30 via [Exa library](https://exa.ai/library/publication/0bmxv354yxr) — not peer-reviewed.
    - "The results showed that design tools powered by artificial intelligence can generate designs that are conceptually and visually comparable to those created by human designers. The study's main limitation is its focus on the conceptualization phase rather than the final logos."
    - "30 subjects participated as novice designers, divided into teams of two people, for a total of 15 design teams."
- **Limits / false positives:** The 2020 study predates current diffusion and LLM tools (it tested "AI logo makers"). The 2025 preprint compares against novices at the concept stage only. Neither tested a frontier LLM writing SVG. The She Ji full text was not opened, so sample sizes and tools are unknown here.

### FD12-F07 — In the US, prompts alone do not make anyone the author of an AI-generated logo
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (NewsNet 1060 dated 29 Jan 2025 and its quote re-read; the report PDF (52 pages) re-downloaded and the "prompts do not alone provide sufficient control" bullet found in its conclusions)
- **Claim:** The US Copyright Office's Part 2 report (29 Jan 2025) concludes that AI outputs are protected only where a human determined sufficient expressive elements: a perceptible human-authored input, or creative selection, arrangement or modification. The mere provision of prompts does not qualify.
- **Implication for /frontend:** Prefer a human-directed wordmark (a chosen typeface, a chosen intervention, hand-adjusted outlines) over a purely prompted symbol, and keep the brief, candidates and edits in the repo as a record of human choices. Never promise the owner that a prompted logo is "owned" in the copyright sense. Trademark rights are a separate question that this report does not decide.
- **Evidence:**
  - [NewsNet Issue 1060](https://www.copyright.gov/newsnet/2025/1060.html) — U.S. Copyright Office, 29 Jan 2025, accessed 2026-09-30 — official release.
    - "It concludes that the outputs of generative AI can be protected by copyright only where a human author has determined sufficient expressive elements. This can include situations where a human-authored work is perceptible in an AI output, or a human makes creative arrangements or modifications of the output, but not the mere provision of prompts."
  - [Copyright and Artificial Intelligence, Part 2: Copyrightability (PDF)](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf) — U.S. Copyright Office, Jan 2025, accessed 2026-09-30 — official report (conclusions section read via Exa).
    - "Based on the functioning of current generally available technology, prompts do not alone provide sufficient control."
- **Limits / false positives:** US law only. The owner is French and competes internationally; EU originality rules were not researched here. This is not legal advice, and low stakes for a hackathon; it matters if the project outlives the event (the owner's naming criterion 5).

### FD12-F08 — SVGenius: all 22 models degrade as SVG complexity rises; general proprietary LLMs beat SVG-specialist models at text-to-SVG
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED (abstract counts, the four-findings passage and every Table 4 value re-read in the v1 HTML, including the 85.71 HPS anomaly. Note at verification: the drop is monotonic from Easy to Hard for every model, but not from Medium to Hard on rCLIP for several, e.g. Claude-3.7-Sonnet 87.62 then 87.97 and QwQ-32B 77.87 then 82.24.)
- **Claim:** SVGenius (2,377 queries, 24 domains, 22 models, three complexity levels) finds a gap between proprietary and open models that widens on complex tasks, "systematic performance degradation as SVG complexity increases", gains from reasoning-enhanced training, and style transfer as the hardest capability. In its text-to-SVG table, the specialist models trail general LLMs: rCLIP for LLM4SVG falls from 75.78 (Easy) to 62.98 (Hard), against 92.90 to 87.97 for Claude-3.7-Sonnet and 90.95 to 82.81 for GPT-4o.
- **Implication for /frontend:** Direct SVG authoring by the frontier model is a legitimate path for a mark, provided the mark stays in the "easy" regime: few primitives, no illustration. Do not reach for an open-source SVG model as an upgrade. Treat "restyle this logo in the style of X" (style transfer) as the least reliable request.
- **Evidence:**
  - [SVGenius: Benchmarking LLMs in SVG Understanding, Editing and Generation](https://arxiv.org/abs/2506.03139) — Siqi Chen et al. (ZJU), arXiv 2506.03139v1, 3 Jun 2025, accessed 2026-09-30 — benchmark paper with data (HTML version read).
    - "We assess 22 mainstream models spanning different scales, architectures, training paradigms, and accessibility levels."
    - "(2) all model families exhibit systematic performance degradation as SVG complexity increases, indicating fundamental limitations in current approaches; (3) reasoning-enhanced training strategies significantly improve performance, particularly for generation tasks requiring multi-step planning; and (4) style transfer emerges as the most challenging capability"
    - Table 4, Text-to-SVG rCLIP (Easy / Medium / Hard): Claude-3.7-Sonnet 92.90 / 87.62 / 87.97; GPT-4o 90.95 / 84.72 / 82.81; IconShop 86.22 / 77.35 / 72.55; LLM4SVG 75.78 / 68.84 / 62.98.
- **Limits / false positives:** Models tested are from early 2025; the model running /frontend is newer. Table 4 contains an apparent error (Claude-3.7-Sonnet Medium HPS 85.71 against 21.35 Easy and 18.74 Hard). Benchmark prompts are general icons and illustrations, not brand marks.

### FD12-F09 — VectorGym (EMNLP 2026): frontier Text2SVG scores sit within 1.5 points, and VLM judges correlate weakly with humans on creative SVG
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED (quotes, Table 3 scores and the Table 5 caption and Average rows re-read in the v2 HTML; arXiv lists "Submitted on 22 Feb 2026" and the comment "Accepted to EMNLP 2026. Camera-ready version.")
- **Claim:** VectorGym evaluates Gemini 2.5 Flash, Gemini 3 Pro, GPT-4o, GPT-5.1 and Claude Sonnet 4.5 on expert-annotated tasks. Text2SVG overall Score: GPT-5.1 70.68, Gemini 3 Pro 69.92, Claude Sonnet 4.5 69.19, GPT-4o 63.09. Its human-correlation study of VLM-as-judge (100 samples) finds per-judge average correlations on VG-Text between 0.11 and 0.40 (Claude Sonnet 4.5 as judge: 0.26; best, Gemini 3 Pro: 0.40), against 0.49 to 0.81 on VG-Sketch.
- **Implication for /frontend:** The model can check fidelity ("does the render match the spec, is anything clipped, is text outlined") but must not be the aesthetic judge of its own marks. The loop is: generate 3 to 5 candidates, run the objective checks (F16, F23, F24), then present rendered candidates to the owner, who picks. Do not spend budget switching providers for logo SVG; the frontier band is narrow.
- **Evidence:**
  - [VectorGym: A Multi-Task Benchmark for SVG Code Generation, Sketching and Editing](https://arxiv.org/abs/2603.29852) — Joan Rodriguez et al., arXiv 2603.29852v2 (published 22 Feb 2026, updated 31 Aug 2026; "Accepted to EMNLP 2026"), accessed 2026-09-30 — benchmark paper (HTML v2 read).
    - "Among proprietary models, GPT-5.1 achieves state-of-the-art performance with a VLM Judge score of 93.00 and an overall Score of 70.68. The proprietary models exhibit a relatively narrow performance band, with Gemini 3 Pro (69.92) and Claude Sonnet 4.5 (69.19) performing comparably."
    - Table 5 caption: "The evaluation uses 100 validation samples extracted from the training set. Results show Gemini 3 Pro is generally the best judge, except for SVG Editing, where GPT-5.1 achieves the highest average correlation with human judgments (0.70). Sketch and text tasks show lower correlations, likely due to the more creative nature of these tasks."
    - Table 5, VG-Text "Average" row, judges in order Claude 4.5 Sonnet, Gemini 2.5 Flash, Gemini 3 Pro, GPT 5.1, Qwen2.5VL 72B, Qwen3-VL 235B, GLM4.5 355B: "0.26 0.38 0.40 0.37 0.11 0.35 0.22"; VG-Sketch "Average": "0.77 0.81 0.81 0.75 0.73 0.80 0.49".
- **Limits / false positives:** VG-Text prompts are general illustrations, not logos. The judge correlations come from 100 samples and one set of judge prompts. The model driving /frontend was not tested. Added at verification: the Text2SVG "Score" that puts the three frontier models within 1.5 points is the unweighted average of VLM Judge, CLIP and DINO (Table 3 caption), and its VLM Judge component is the metric this same paper finds correlates at 0.40 or less with humans on VG-Text. The narrow band is therefore measured partly with a weak judge; the VLM Judge column alone spreads more (GPT-5.1 93.00, Gemini 3 Pro 89.80, Claude Sonnet 4.5 89.00). The per-task "Average" rows in Table 5 include the "Ground Truth" row (for example, the Claude judge's VG-Text values 0.01, 0.16, 0.37 and 0.50 average to 0.26), and that row is 1.00 for six of seven judges on VG-Sketch but about 0 on VG-Text. Recomputed over the three generator rows only (verification arithmetic, not a figure the paper prints), the judges' means are 0.21 to 0.55 on VG-Text (Claude Sonnet 4.5 as judge: 0.34) against 0.64 to 0.75 on VG-Sketch. Text still sits below sketch, but the gap is smaller than the printed averages suggest.

### FD12-F10 — VCode: frontier VLMs struggle to write faithful SVG; revision alone adds 1 to 2 points, external vision tools most of the +12.3
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** VCode asks models to write SVG that preserves an image's symbolic content. Frontier VLMs "struggle to generate faithful SVGs". VCoder, built on Claude-4-Opus, adds "Thinking with Revision" (iteratively analysing discrepancies between the render and the target) and "Acting with Visual Tools" (detectors and parsers that supply objects, shapes and text), lifting Claude-4-Opus's Overall from 41.7 to 54.0 (+12.3). The paper's ablations split that gain. On MM-Vet, the full vision-tool set alone takes Claude-4-Opus from 37.5 to 54.1 (+16.6, Table 3), while revision alone reaches 38.8 after one round and 39.5 after two (Table 6); VCoder with both scores 54.2. Claude and GLM-4.5V benefit from the first revision round, GPT-4o drops after round one (35.0 to 34.1) and recovers in round two (36.3); the authors conclude that revision "relies on a strong reasoning foundation". The abstract calls Claude-4-Opus "top-performing", but in the paper's own Table 2 it scores 41.7 Overall, below GPT-5 (46.8), GPT-4.1 (45.6), Gemini-2.5-Pro (44.7), Claude-4.5-Sonnet (43.1), Gemini-2.5-Flash (42.4) and GPT-o3 (42.2). (corrected: the dossier credited the +12.3 to the render-compare-revise loop and called Claude-4-Opus the best baseline; the +12.3 is over VCoder's own base model and comes mostly from external vision tools.)
- **Implication for /frontend:** A render-and-critique loop is cheap and is still worth running for defects, but the measured gain from free-form self-revision is small (about 1 to 2 points on MM-Vet for Claude-4-Opus) and can be negative after one round for a weaker reasoner. Render the SVG, show the PNG back to the model, and ask for specific discrepancies: clipped strokes, merged counters at 16 px, off-grid edges, contrast on dark and light tabs. Cap it at two rounds (the paper measured no more), then stop and hand the choice to the owner (F09). The paper's larger gain came from structured external cues. By analogy only (not tested on logos), feeding the model the pipeline's measurements (ink radius, solid share, bounding boxes, contrast values from F16 and F23) is more likely to help than open-ended critique.
- **Evidence:**
  - [VCode: a Multimodal Coding Benchmark with SVG as Symbolic Visual Representation](https://arxiv.org/abs/2511.02778) — Kevin Qinghong Lin et al., arXiv 2511.02778v1, 4 Nov 2025, accessed 2026-09-30 — benchmark paper (HTML read).
    - "Empirically, frontier VLMs struggle to generate faithful SVGs, revealing a persistent gap between language-centric and visual-centric coding."
    - "(i) Thinking with Revision, which iteratively analyzes discrepancies and refines SVG code"
    - "VCoder delivers a +12.3-point overall gain over the top-performing Claude-4-Opus."
    - "Both Claude and GLM-4.5V benefit from the first revision ... implying that effective revision relies on a strong reasoning foundation."
    - Added at verification (same HTML): "Built on Claude-4-Opus, VCoder lifts Overall from 41.7 to 54.0 (+12.3) via revision and vision-tool assistance"; "(iii) Together, all vision tools yield a 16.6-point improvement over Claude-4-Opus"; Table 3 (MM-Vet Avg.): Claude-4-Opus 37.5, Full vision tools 54.1; Table 6 "Effect by revision (round) on MM-Vet" (Avg.): Claude-4-Opus 37.5 / 38.8 / 39.5 for rounds 0 / 1 / 2, GLM-4.5V 33.1 / 37.4 / 38.3, GPT-4o 35.0 / 34.1 / 36.3; Table 2 Overall: GPT-5 46.8, GPT-4.1 45.6, Gemini-2.5-Pro 44.7, Claude-4.5-Sonnet 43.1, Claude-4-Opus 41.7, VCoder (Claude-4-Opus) 54.0.
- **Limits / false positives:** The task is image-to-SVG fidelity measured by question answering on renders, not logo quality. Revision rounds were measured only on MM-Vet and only up to round 2. Whether Table 3's "Full vision tools" row also runs revision is not stated explicitly; the text presents it as the tools' effect.

### FD12-F11 — Known failure modes of generated SVG: hallucinated primitives, occlusion, over-simplified monochrome icons, and pixel metrics that miss vector quality
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (all three abstract quotes, versions and dates re-read through the arXiv API: LLM4SVG v3 "Accepted by CVPR 2025", OmniSVG v3 updated 2025-12-01, StarVector v4 updated 2025-05-31)
- **Claim:** LLM4SVG (CVPR 2025) attributes LLM SVG errors to "hallucinations in vector primitive predictions" and to not modelling render order, which causes "occlusion between output vector primitives". OmniSVG says prior methods produce either unstructured, costly outputs or "monochrome icons of over-simplified structures". StarVector shows that pixel metrics such as MSE "fail to capture the unique qualities of vector graphics".
- **Implication for /frontend:** Lint generated SVG structurally, not only visually. Check: every path closed and inside the viewBox; no element fully hidden under a later one (compare renders with each element removed); no zero-area or duplicate paths; SVGO-clean output. Judge candidates on renders at the target sizes, not on a pixel-difference score.
- **Evidence:**
  - [Empowering LLMs to Understand and Generate Complex Vector Graphics (LLM4SVG)](https://arxiv.org/abs/2412.11102) — Ximing Xing et al., arXiv 2412.11102v3, CVPR 2025, accessed 2026-09-30 — paper abstract.
    - "recent findings suggest that semantically ambiguous and tokenized representations within LLMs may result in hallucinations in vector primitive predictions. Additionally, LLM training typically lacks modeling and understanding of the rendering sequence of vector paths, which can lead to occlusion between output vector primitives."
  - [OmniSVG: A Unified Scalable Vector Graphics Generation Model](https://arxiv.org/abs/2504.06263) — Yiying Yang et al., arXiv 2504.06263v3 (updated 1 Dec 2025), accessed 2026-09-30 — paper abstract.
    - "existing methods either produces unstructured outputs with huge computational cost or is limited to generating monochrome icons of over-simplified structures."
  - [StarVector: Generating Scalable Vector Graphics Code from Images and Text](https://arxiv.org/abs/2312.11556) — Juan A. Rodriguez et al., arXiv 2312.11556v4 (updated 31 May 2025), accessed 2026-09-30 — paper abstract.
    - "We address challenges in SVG evaluation, showing that pixel-based metrics like MSE fail to capture the unique qualities of vector graphics."
- **Limits / false positives:** These are the authors' motivations for their own methods, stated in abstracts; the failure rates for a current frontier model writing a three-shape mark are not measured. For a logo, "over-simplified monochrome" is a feature, not a failure.

### FD12-F12 — Recraft is the vector-native API option: V4/V4.1 Vector at $0.08 per SVG, Pro Vector at $0.30, vectorisation at $0.01
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (V4 page, API price table, getting-started page and Developer Terms §4.3 re-fetched on 2026-09-30; every quoted price and date matches. The price table also lists cheaper "V4 Styles" vector models at $0.05 and $0.12, and V3 Vector at $0.08; they were not in the dossier and change nothing here.)
- **Claim:** Recraft's docs list V4 (released February 2026) and V4.1 (mid-May 2026) in raster and Vector variants. The API price table gives $0.08 per image for V4.1 Vector, V4.1 Utility Vector and V4 Vector; $0.30 for the Pro Vector models; $0.044 for V2 Vector; $0.01 per raster-to-vector conversion. Exports include SVG. Recraft also documents an official MCP server. The docs claim V4 is "The only model capable of generating editable, production-quality SVG graphics" (a vendor claim).
- **Implication for /frontend:** A budget-bounded option: 5 Vector candidates cost $0.40. Put every Recraft SVG through the same SVGO, lint and small-size checks as an LLM-written mark (F11, F16), and through the ownership rule in F13. Its $0.01 vectoriser can turn a hand sketch (photo) into a starting SVG, which keeps a human-authored input in the chain (F07).
- **Evidence:**
  - [Recraft V4](https://www.recraft.ai/docs/recraft-models/recraft-V4) — Recraft docs, accessed 2026-09-30 — vendor documentation.
    - "Recraft V4 was released in February 2026."
    - "Recraft V4 Vector | $0.08 | 80 | Per image | 15s" and "Recraft V4 Pro Vector | $0.30 | 300 | Per image | 45s"
    - "High-quality vector generation: The only model capable of generating editable, production-quality SVG graphics."
  - [Pricing (API)](https://www.recraft.ai/docs/api-reference/pricing) — Recraft docs, accessed 2026-09-30 — vendor price list.
    - "– Recraft V4.1 Vector | – Recraft V4.1 Utility Vector | – Recraft V4 Vector | $0.08 | 80 | Per image"
    - "Vector image generation – Recraft V2 Vector | $0.044 | 44 | Per image"; "Image vectorization | $0.01 | 10 | Per request"; "USD $1.00 | 1,000" API units.
  - [Getting started (API)](https://www.recraft.ai/docs/api-reference/getting-started) — Recraft docs, accessed 2026-09-30.
    - "Recraft V4.1 models, released in mid-May 2026, are the next step beyond V4"
  - [Developer Terms](https://www.recraft.ai/legal/developer-terms) — Recraft, last updated 11 Aug 2026, accessed 2026-09-30.
    - "Recraft may make available official Recraft Model Context Protocol ("MCP") server access that allows Members to access Recraft generation and related Services from third-party AI services or other authorized software using the Member's own subscription credits."
- **Limits / false positives:** No independent benchmark of Recraft's SVG quality was found (VectorGym and SVGenius do not test it). Prices were read on 2026-09-30 and change often. Output quality for brand marks, path cleanliness and colour count were not tested here (no API key used).

### FD12-F13 — Recraft ownership: free-tier images belong to Recraft and are public; paid and API outputs are assigned to the user, with a no-AI-training restriction
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (Terms and Developer Terms re-fetched in full, both "Last updated: 11 August 2026"; the §7.7 training-by-default sentence is on the full page, so the dossier's "search excerpt" caveat is lifted. Added at verification below: MCP output inherits the account's plan.)
- **Claim:** Recraft's Terms (last updated 11 Aug 2026) say Free Tier assets are owned by Recraft and allow no commercial use; its docs add that they are publicly visible in the community gallery. Paid-plan assets and API assets (Developer Terms 6.2) are owned by the user, and Recraft assigns "all copyright rights it may have", subject to a ban on using the assets to train AI models. Recraft may use inputs and outputs to train its own models by default, with an opt-out.
- **Implication for /frontend:** Never generate the protocol's logo in Recraft's free web app: the mark would be Recraft's property and published in its gallery before the hackathon. Use only the paid API (or a paid plan) and record the account type in the brand notes. Opt out of training if the owner prefers the candidates not to be reused. Added at verification: the same rule applies to Recraft's MCP server, whose output takes the ownership terms of the plan on the account at generation time, so an MCP call from a free account yields Free Tier assets.
- **Evidence:**
  - [Terms of Service](https://www.recraft.ai/legal/terms) — Recraft, last updated 11 Aug 2026, accessed 2026-09-30 — vendor terms.
    - "(i) no commercial use of Free Tier Assets is permitted; (ii) Free Tier Assets are owned by Recraft and may not be sold, licensed or transferred; and (iii) Free Tier Assets may not be used to train artificial intelligence models, systems or networks or similar technology."
    - "You own all Assets you create with the Services and Recraft hereby assigns to you all copyright rights it may have in the Assets subject to the following restriction: Assets may not be used to train artificial intelligence models, systems or networks or similar technology."
    - Section 7.7 (read in an Exa search excerpt of the same page): "You acknowledge and agree that Recraft may use your Inputs you provide and the Assets produced by the Services to train, fine-tune, and otherwise improve Recraft’s artificial intelligence models and systems. This training use is enabled by default, but you may opt out at any time by adjusting your preferences in your account profile settings."
  - [Developer Terms](https://www.recraft.ai/legal/developer-terms) — Recraft, last updated 11 Aug 2026, accessed 2026-09-30 — section 6.2.
    - "You own all Assets you create with the API Services, and Recraft hereby assigns to you all copyright rights it may have in the Assets, for personal or commercial use, subject to the following restriction: Assets may not be used to train any artificial intelligence model, system, network, or similar technology."
    - Added at verification, §4.3 "MCP Server Access": "Assets generated through the Recraft MCP server are Assets under the subscription plan in effect on your account at the time of generation are subject to the same ownership, license, and use restrictions (including the prohibition on using Assets to train artificial intelligence models, systems, or networks)" (sic, as printed).
  - [Commercial rights and ownership](https://www.recraft.ai/docs/plans-and-billing/commercial-rights-and-ownership) — Recraft docs, accessed 2026-09-30 (read via Exa).
    - "Images generated under the Free plan are publicly visible in the community gallery and remain the property of Recraft."
- **Limits / false positives:** Terms change (effective 11 Aug 2026 for new accounts, 25 Aug 2026 for existing ones). "Copyright rights it may have" may be none at all under F07. The training-by-default sentence sits in section 7.7 "Licenses to Recraft" of the full Terms page (re-fetched at verification). The general Terms' paid-plan ownership sentence is conditioned on having "a paid subscription to the Services".

### FD12-F14 — SIL Open Font License fonts may be used to make a logo, with no permission and no attribution
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (FAQ page states "OFL-FAQ version 1.1-update7 (November 2023)"; answers 1.1, 1.1.1 and 1.1.2 re-read verbatim. Related at verification: FAQ 2.6 says subsetting a webfont "is considered modification", which matters only if /frontend self-hosts a subsetted font carrying a Reserved Font Name.)
- **Claim:** The OFL FAQ (version 1.1-update7, November 2023) answers yes to using OFL fonts "to create logos or other graphics". The resulting artwork's copyright stays with its author, and acknowledgement is not required. OFL conditions apply only when the font itself is redistributed, bundled or modified; Reserved Font Names matter only for modified fonts.
- **Implication for /frontend:** Draw wordmark candidates from OFL families (Google Fonts' `ofl/` tree) and outline the glyphs into paths (F15), so the shipped logo never distributes the font. Keep the font's `OFL.txt` in the brand folder as a provenance record. Exclude the owner's tells from the candidate list: Inter (tell 4), Space Grotesk and Instrument Serif (tell 19).
- **Evidence:**
  - [OFL-FAQ](https://openfontlicense.org/ofl-faq/) — SIL International, version 1.1-update7 (November 2023), accessed 2026-09-30 — licence steward's FAQ.
    - "1.1 Can I use the fonts for a book or other print publication, to create logos or other graphics or even to manufacture objects based on their outlines? Yes. You are very welcome to do so. Authors of fonts released under the OFL allow you to use their font software as such for any kind of design work. No additional license or permission is required, unlike with some other licenses. Some examples of these uses are: logos, posters, business cards, ..."
    - "1.1.1 Does that restrict the license or distribution of that artwork? No. You remain the author and copyright holder of that newly derived graphic or object. You are simply using an open font in the design process. It is only when you redistribute, bundle or modify the font itself that other conditions of the license have to be respected"
    - "1.1.2 Is any kind of acknowledgement required? No."
- **Limits / false positives:** A licence is not distinctiveness: an untouched OFL wordmark can be retyped by anyone, which is why F02 asks for one intervention. The FAQ is the steward's interpretation, not a court ruling. Fonts under other licences (for example "free for personal use") need their own check.

### FD12-F15 — Outlining a wordmark works on this machine; opentype.js 2.0.0 needs `flipY: false`, and satori renders text as paths
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (re-run at verification with opentype.js 2.0.0 and the same font: identical bbox, viewBox [3, -78, 477, 84], 3,492 bytes, 1,634 after SVGO; README flipY text and Plex OFL header re-read. Mechanism found at verification: the default `toPathData()` output contains literal `NaN` coordinates, for example `Q29.60NaN 35.90NaN`, so SVG renderers stop drawing the path at the first bad token. Rendered with resvg, the default shows one malformed shape and `flipY: false` shows "holdover".)
- **Claim:** Using IBM Plex Mono SemiBold (OFL, Reserved Font Name "Plex") from the google/fonts repository, `font.getPath(text, 0, 0, 100).toPathData({ decimalPlaces: 2, flipY: false })` produced a correct outlined wordmark (no `<text>` element; 3,492 bytes, 1,634 after SVGO). With the default options (`flipY` defaults to true in 2.0.0), the same call produced different path data that rendered as a garbled shape. satori 0.33.5 converted OG-image text into paths as well (no `<text>` in its SVG).
- **Implication for /frontend:** Outline all logo text before shipping: SVG favicons load in a restricted mode with no external resources (F22), and outlined text removes font dependencies from every renderer. When using opentype.js 2.x, always pass `flipY: false`, fail the build if the path data contains `NaN`, and assert the output visually (render once, look). Store the source text, font file, weight and size next to the outlined SVG so the wordmark can be regenerated.
- **Evidence:**
  - Command run (scratch folder, Node 24.13.0, opentype.js 2.0.0): `node build.mjs` (script in Appendix A). Output: `"wordmark": { "bbox": { "x1": 7.5, "y1": -74, "x2": 476.1, "y2": 1.2000000000000002 }, "viewBox": [3, -78, 477, 84], "hasTextElement": false, "bytes": 3492 }`, `"svgoWordmark": { "inBytes": 3492, "outBytes": 1634 }`, `"og": { "svgHasTextElement": false }`.
  - Command run: `node flip-probe.mjs`. Output: `identical path data with default vs flipY:false -> false`; the default-option render was inspected visually and showed a single malformed shape instead of the letters "hold".
  - [opentype.js README](https://github.com/opentypejs/opentype.js) — installed copy of opentype.js 2.0.0 (npm, published 2026-05-06), accessed 2026-09-30.
    - "`flipY`: whether to flip the Y axis of the path data, because SVG and font paths use inverted Y axes. (`true`: calculate from bounding box, `false`: disable; default: `true`)"
  - [satori README](https://github.com/vercel/satori) — Vercel, main branch, accessed 2026-09-30.
    - "Satori will render the element into a 600×400 SVG, and return the SVG string: '<svg ...><path d="..." fill="black"></path></svg>'"
  - [IBM Plex Mono OFL.txt](https://github.com/google/fonts/tree/main/ofl/ibmplexmono) — google/fonts, accessed 2026-09-30.
    - "Copyright © 2017 IBM Corp. with Reserved Font Name "Plex""
- **Limits / false positives:** One font and one string tested. Kerning was on by default; letter-spacing was not tested. Variable fonts were not tested (many Google Fonts families ship only as variable TTF). The garbled default is observed on opentype.js 2.0.0 only.

### FD12-F16 — A 16 px render test separates a grid-aligned solid mark from a gradient-hairline mark; logos are exempt from WCAG contrast, so this check is /frontend's own
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (Appendix A re-run at verification: the good mark gives solid share 1.000 / 1.000 / 0.934 / 1.000 at 16 / 32 / 180 / 512 px. The gradient-hexagon SVG is not printed in the dossier, so its numbers could not be re-run exactly; an approximation with the stated 1-unit and 0.8-unit gradient strokes gave 0 at 16 and 32 px and 0.897 at 512 px. A solid disc scored 0.774 at 16 px, which confirms the round-mark caveat below. Evil Martians quote and WCAG 2.2 (Recommendation, 12 December 2024) SC 1.4.3 "Logotypes" exception re-read.)
- **Claim:** I rendered two marks with resvg-js at 16, 32, 180 and 512 px and computed the share of inked pixels that are fully opaque ("solid share"). A mark of three solid rectangles with every edge on an even unit of a 32-unit grid scored 1.0 at 16 and 32 px. A purple-to-blue gradient hexagon with 1-unit and 0.8-unit strokes scored 0.0 at both sizes. Nearest-neighbour enlargements confirmed it visually: the first is crisp, the second washes out to pale tints. WCAG 2.2 exempts logotypes from text contrast (SC 1.4.3), so /harden's accessibility floor will not catch a faint favicon.
- **Implication for /frontend:** Make the small-size check mechanical and visual. (1) Render each candidate at 16, 32, 180 and 512 px, plus a one-colour silhouette, on light (#ffffff) and dark tab-like backgrounds. (2) Compute the solid share at 16 and 32 px and flag low values for review. (3) Show 16× nearest-neighbour enlargements to the model for defect review (F10) and to the owner for the pick (F09). Design favicon marks on a 32-unit grid with even coordinates, so edges land on pixel boundaries at 16 and 32 px.
- **Evidence:**
  - Command run: `node build.mjs` (Appendix A). Output excerpt: good mark `16: { inkPx: 88, solidPx: 88, solidShare: 1 }`, `32: { inkPx: 352, solidPx: 352, solidShare: 1 }`, `180: { solidShare: 0.934 }`; bad mark `16: { inkPx: 104, solidPx: 0, solidShare: 0 }`, `32: { inkPx: 204, solidPx: 0, solidShare: 0 }`, `512: { solidShare: 0.873 }`. Files `good-16-zoom.png` and `bad-16-zoom.png` were inspected visually.
  - [How to Favicon in 2026](https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs) — Andrey Sitnik, Evil Martians, 2026 edition (dated 2026-01-21), accessed 2026-09-30.
    - "Scale the image down to 16×16 and check the icon visibility. If it has become too blurry, it would be better to ask your designer for a custom tiny version of the logo."
  - [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) — W3C Recommendation, accessed 2026-09-30.
    - SC 1.4.3, Logotypes: "Text that is part of a logo or brand name has no contrast requirement"
- **Limits / false positives:** Two hand-made samples, no corpus and no calibrated threshold. The solid-share metric penalises curves and diagonals, which always anti-alias, so round marks will score lower without being illegible: calibrate against a control set of real favicons before using it as a gate. The 180 px score of 0.934 reflects a non-integer scale (180/32), not a defect.

### FD12-F17 — WIPO Global Brand Database supports logo-image search with four strategies; not finding a match does not prove availability
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** WIPO's Global Brand Database lets a user upload a logo (jpg, png or webp) under "Find by brand logo", add filters before the search, and rank by one of four strategies: Concept ("AI based similarity"), Shape ("Similar lines, ignores color"), Color, and Composite. The slides list IP office, Nice class, owner, status and dates as filters for the brand-name search (slide 13); for the logo search they say only "You can add filters before the search to narrow down the results" (slide 18). (corrected: the dossier said the logo search filters "by Nice and Vienna classes, office and more"; no cited source lists Vienna-class filtering for the logo search, and the Nice-class and office filters are documented for the brand-name search.) WIPO says it does not store the uploaded image. It also says it does not search on behalf of third parties and recommends national registers too.
- **Implication for /frontend:** For each finalist mark, export a PNG on a neutral background and run the WIPO logo search twice (Concept, then Shape), filtered to Nice classes 9, 36 and 42 (the owner's convention). Save screenshots of the first page of results as receipts in the brand folder. The finding "no close match" reduces risk; it is never reported as "clear".
- **Evidence:**
  - [Global Brand Database: Frequently Asked Questions](https://www.wipo.int/en/web/global-brand-database/faqs_branddb) — WIPO, accessed 2026-09-30.
    - "In Find by brand logo available in the top menu, you can upload an image from your computer or drag and drop it Then select a strategy and click the search button Filter. Image formats supported: jpg, png and webp." (read via Exa)
    - "WIPO does not, in any way, store a copy of the image you submit. Once the analysis of the image is complete, all record of it is removed from our servers, and we retain no record of the image you search for."
    - "Please be advised that the International Bureau of WIPO is not mandated to conduct searches for third parties."
  - [Overview of the Global Brand Database (webinar slides, PDF)](https://www.wipo.int/edocs/mdocs/madrid/en/wipo_webinar_branddb_2025_1/wipo_webinar_branddb_2025_1_www_641231.pdf) — WIPO Global Databases Division, webinar of Tuesday 28 January 2025 (PDF author metadata: "LUMBRERAS HIGUERA Aida"), accessed 2026-09-30 — slides 18 and 20 (corrected: the dossier said slides 19–20; slide 19 only reads "Edit the shape of the logo"). Slide 3: "A database containing access to 83 different data sources".
    - "Find an existing trademark through a logo image, or see how similar your logo is to other registered trademarks."
    - "Logo search - Strategies • Concept: • Shape: • Color: • Composite: ... AI based similarity / Similar lines, ignores color / Similar colors with similar distribution / Composition based on color and lines"
- **Limits / false positives:** No official API for image search was found; it is a browser step (it could be driven with Playwright, but WIPO's terms for automation were not checked). Coverage depends on which offices feed the database. Simple geometric marks return many weak matches.

### FD12-F18 — TMview and eSearch plus search figurative marks by image; TinEye finds copies, not look-alikes
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (TMview help, EUIPO news, eSearch plus FAQ, TinEye help (last updated 8 Nov 2022) and TinEye API page re-read; every quote matches. Note at verification: the EUIPO news page shows no date, but its text says TMview has "continuously expanded over the past 13 years" since its 2010 launch, which points to 2023 rather than Exa's 2024-09-18.)
- **Claim:** TMview's image search accepts JPEG, PNG, GIF or TIFF files larger than 100 × 100 px and at most 2 MB. Since 15 May 2023 it covers the TM5 offices (including the USPTO and CNIPA) plus the EU network, "over 57 million figurative trade mark applications". EUIPO's eSearch plus analyses "colours, shapes and textures", takes one image for trade marks, and advises neutral backgrounds. TinEye "does not typically find similar images"; it finds copies, including cropped, edited or resized ones, among web images it has crawled.
- **Implication for /frontend:** Use TMview image search as the second registry check after WIPO (F17), with a PNG of 256 to 512 px on white. Use TinEye (or a browser reverse-image search) for a different purpose: to detect that a generated mark reproduces an existing web image, a risk specific to machine-generated candidates. TinEye's API is paid per prepaid bundle; a manual web search is enough for a hackathon.
- **Evidence:**
  - [TMview help](https://www.tmdn.org/static/tmdsview/tmview/helpFiles/en/help.html) — EUIPO / TMDN, accessed 2026-09-30.
    - "Remember using always files with JPEG, PNG, GIF and TIFF extensions, larger than 100x100 pixels and with a maximum size of 2 Megabytes."
    - "The TMview fuzzy search is based on the Levenshtein distance, or edit distance algorithm."
  - [AI at EUIPO: In-house image search in TMview extended to all TM5 offices](https://www.euipo.europa.eu/en/news/ai-at-euipo-in-house-image-search-in-tmview-extended-to-all-tm5-offices) — EUIPO news, accessed 2026-09-30 (read via Exa; the page gives no visible date, Exa lists 2024-09-18).
    - "As of 15 May 2023, the images of trade marks from the non-EU TM5 Offices have been integrated into TMview"
    - "the addition of these offices to TMview will enable users to compare their trade marks’ graphical representations with over 57 million figurative trade mark applications within seconds."
  - [FAQ: eSearch plus](https://www.euipo.europa.eu/en/help-centre/searches/faq-esearch-plus) — EUIPO, accessed 2026-09-30 (read via Exa).
    - "The search system analyses the colours, shapes and textures, rather than keywords as in the classic text-based search systems."
    - "The system allows for the upload of 1 image when searching for trade marks and up to 7 images at once to search for designs."
    - "It is recommended to upload images with neutral backgrounds."
  - [How does TinEye work?](https://help.tineye.com/article/233-how-does-tineye-work) — TinEye, last updated 8 Nov 2022, accessed 2026-09-30.
    - "TinEye does not typically find similar images (that is, a different image with the same subject); it finds image matches including those that have been cropped, edited or resized."
  - [TinEye API](https://services.tineye.com/TinEyeAPI) — TinEye, accessed 2026-09-30 (read via Exa).
    - "Your TinEye API is not a subscription. Instead, you purchase pre-paid search bundles as you need them."
    - "Images should be in JPEG, PNG, WebP, AVIF, GIF, BMP or TIFF format with a maximum file size of 1 megabyte. TinEye works best with at least 300 pixels in either dimension but can work with images as low as 100 pixels."
- **Limits / false positives:** These are search aids, not legal clearance. Unregistered (common-law) marks and live products are invisible to registries; they need the web and product checks in F19 and F20. TinEye's price per bundle was not recorded.

### FD12-F19 — Domain availability: use the IANA RDAP bootstrap with a positive and a negative control; the owner's `.dev` endpoint returns false "free" results
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (every command re-run on 2026-09-30 with identical results: bootstrap publication 2026-09-28T22:00:03Z, same TLD mappings, no `.io` entry, same HTTP and DoH codes; the owner's log passages re-read. Added at verification: the false "free" results are not hypothetical, see the evidence below.)
- **Claim:** The IANA RDAP bootstrap (published 2026-09-28) maps `.dev` and `.app` to `https://pubapi.registry.google/rdap/`, `.com` to Verisign, `.xyz` to CentralNic and `.fi` to rdap.fi. It has no entry for `.io`. The endpoint used in the owner's BNB naming Passes 1 and 3 (`https://www.registry.google/rdap/domain/<n>.dev`) returned 404 for the registered `web.dev`, so every `.dev` "free" verdict from it is unproven. Pass 2 of the same study had already noticed this. The bootstrap endpoint returned 200 for `web.dev` and 404 for a random name. Identity Digital's RDAP answered `.io` correctly (200 for `github.io`, 404 for a random name), and Google DNS-over-HTTPS NS lookups returned Status 0 or 3 consistently.
- **Implication for /frontend:** Any name check the skill runs must (1) resolve each TLD's RDAP base from `data.iana.org/rdap/dns.json` at run time, and for TLDs absent from it (such as `.io`) use a documented registry endpoint plus DoH; (2) run a known-registered domain and a random string in the same TLD in the same pass, and refuse to report when either control fails; (3) cross-check "free" with DoH `NS` (Status 3 = NXDOMAIN). The owner's `holdover.dev` verdict survives: the bootstrap endpoint returned 404 for it on 2026-09-30.
- **Evidence:**
  - Command run: `curl -s https://data.iana.org/rdap/dns.json`. Output excerpt: `publication 2026-09-28T22:00:03Z`; `['app', 'dev'] ['https://pubapi.registry.google/rdap/']`; `['xyz'] ['https://rdap.centralnic.com/xyz/']`; `['fi'] ['https://rdap.fi/rdap/rdap/']`; `['com'] ['https://rdap.verisign.com/com/v1/']`; `io in bootstrap: False`.
  - Commands run (HTTP status): `pubapi.registry.google/rdap/domain/web.dev -> 200`, `.../holdover.dev -> 404`, `.../zq7xk2vqpl9m.dev -> 404`; `www.registry.google/rdap/domain/web.dev -> 404`, `.../zq7xk2vqpl9m.dev -> 404`; `rdap.identitydigital.services/rdap/domain/github.io -> 200`, `.../zq7xk2vqpl9m.io -> 404`; `dns.google/resolve?name=<n>&type=NS`: `github.io -> 0`, `zq7xk2vqpl9m.io -> 3`, `web.dev -> 0`, `zq7xk2vqpl9m.dev -> 3`.
  - [Name availability log](file:///C:/Users/Utilisateur/Documents/Coding/BNB/research/design/naming/_availability.md) — owner's naming study, 2026-09-23, read 2026-09-30 — local file.
    - Pass 3 method: "Google Registry (.dev)"; Pass 2: "`https://www.registry.google/rdap/domain/<n>.dev` returned 404 for every `.dev` including ones DoH shows delegated, so the `.dev` column comes from DNS, not RDAP."
  - Added at verification. Command run: all 16 `.dev` names that Passes 1 and 3 mark "free" were re-checked against `pubapi.registry.google/rdap/domain/<n>.dev` and `dns.google/resolve?type=NS`. Six are registered and delegated (HTTP 200, DoH Status 0), all before the study date of 2026-09-23 per their RDAP `registration` events: `nexthop.dev` 2019-03-04, `lockstep.dev` 2019-06-10, `isochron.dev` 2025-09-25, `vernier.dev` 2026-05-06, `rubato.dev` 2026-09-09, `foreshock.dev` 2026-09-15. The other ten are free (404, Status 3): `ratiotrace`, `staleboard`, `unitlag`, `phaselag`, `lagfront`, `ratiohop`, `lagtrace`, `hoptrace`, `pershare`, `drifttrace`. The Pass 3 rows for Rubato, NextHop, Vernier and Foreshock and the Pass 1 rows for Lockstep and Isochron are therefore wrong.
- **Limits / false positives:** A 404 from RDAP means "not registered", not "purchasable": premium and reserved names exist. DoH NXDOMAIN can also mean registered but undelegated. Registry endpoints and rate limits change; the owner notes that rdap.org returned 403, 429 and 302 and must not be used.

### FD12-F20 — Handle and registry probes: `gh api users/<n>` covers organisations, npm scopes follow user and org names, the X probe is unstable, TMview's word search still answers
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (all probes re-run on 2026-09-30 with identical codes, including the TMview POST returning the same 4 HOLDOVER records; the npm "About scopes" sentence and the owner's Pass 2 X note re-read)
- **Claim:** `gh api users/vercel` returned `"type":"Organization"`, so one call checks both user and organisation handles. npm's docs tie a scope to a user or organisation name. `GET https://registry.npmjs.org/-/org/<name>/package` returned 200 for an org (vercel) and for users (sindresorhus, isaacs), and 404 for a random name. It is therefore an unauthenticated probe for a claimed scope; the owner's `scope:<name>` package search only sees scopes that already have published packages. `x.com/<handle>` returned 200 for @github and 404 for a random handle today, but the owner's Pass 2 recorded 200 for every handle tried. TMview's word-mark API (`POST https://www.tmdn.org/tmview/api/search/results`) returned HTTP 200 with 4 HOLDOVER records, matching the owner's log.
- **Implication for /frontend:** Use this probe set for the name, each with its own positive and negative control in the same run: GitHub (`gh api users/<n>`), npm bare name (`registry.npmjs.org/<n>`) and scope (`/-/org/<n>/package`), X (unauthenticated GET, then a manual logged-in check before reporting "free"), TMview word search in classes 9, 36 and 42. Report X results as "indicative" unless confirmed by hand.
- **Evidence:**
  - Commands run: `gh api users/vercel --jq '{login,type}'` -> `{"login":"vercel","type":"Organization"}`; `gh api users/zq7xk2vqpl9m` -> `HTTP 404`; `registry.npmjs.org/react -> 200`, `registry.npmjs.org/zq7xk2vqpl9m -> 404`; `registry.npmjs.org/-/org/vercel/package -> 200`, `.../sindresorhus/package -> 200`, `.../isaacs/package -> 200`, `.../zq7xk2vqpl9m/package -> 404`; `www.npmjs.com/org/<n>` and `/~<n>` -> 403 for all (bot wall); `x.com/github -> 200`, `x.com/zq7xk2vqpl9mq -> 404`.
  - Command run: `curl -X POST https://www.tmdn.org/tmview/api/search/results -d '{"page":"1","pageSize":"10","criteria":"C","basicSearch":"holdover","fOffices":["EM","US"]}'` -> `HTTP 200`, `totalResults 4`: `HOLDOVER | US | Filed | nice [13, 25, 35]`, `HOLDOVER | US | Ended | nice [9]`, `HOLDOVER | US | Ended | nice [27]`, `HOLDOVER TARGET SYSTEMS | US | Ended | nice [28]`.
  - [About scopes](https://docs.npmjs.com/about-scopes) — npm Docs, accessed 2026-09-30.
    - "When you sign up for an npm user account or create an organization, you are granted a scope that matches your user or organization name."
  - [Name availability log](file:///C:/Users/Utilisateur/Documents/Coding/BNB/research/design/naming/_availability.md) — owner's study, 2026-09-23, read 2026-09-30.
    - Pass 2: "`x.com/<handle>` returned `200` for all six handles tried. x.com serves a JS shell, so this distinguishes nothing."
- **Limits / false positives:** The npm `/-/org/` endpoint is undocumented, and its answer for a claimed scope with zero packages is unknown. The TMview API is the web UI's undocumented endpoint (its help page mentions no API) and may change or rate-limit. X can answer 404 for suspended accounts and varies with IP and user agent.

### FD12-F21 — The minimal favicon set (Evil Martians, 2026 edition): ICO 32 with `sizes="32x32"`, SVG with a dark-mode query, apple-touch 180, manifest 192/512/maskable
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED (title, date January 21, 2026, author, every quote and the changelog re-read on the live page. The grade stays B, not C like F01–F04, because the guide's load-bearing technical claims were tested independently in F22–F24. Notes at verification: the guide states the safe zone correctly ("The safe zone is a central circle of 409×409") and follows its 409-px step with "Check the icon in the maskable.app with different masks and tune the icon size if needed"; and the SVGO correction applies only to class-based light colours, since the guide's own dark-mode pattern survives SVGO (F24).)
- **Claim:** The latest edition, retitled "How to Favicon in 2026: Three files that fit most needs" (dated 2026-01-21, Andrey Sitnik), keeps the set: `favicon.ico` with one 32 × 32 image and `sizes="32x32"` (changed from `sizes="any"` on 2023-07-11 for a Chrome bug); `icon.svg` whose `<style>` switches colours under `prefers-color-scheme: dark`; a 180 × 180 `apple-touch-icon` (a 140 px logo on a 180 px canvas with a background colour); and a web manifest with 192, 512 and a 512 maskable icon whose safe zone is a 409 × 409 circle. The guide's tooling assumes GIMP, Inkscape or ImageMagick.
- **Implication for /frontend:** Adopt this set as the baseline, with four corrections from this dossier: SVGO settings (F24), the per-mark maskable check (F23), a raster larger than 48 px for Google Search (F29), and a Node-only toolchain for this machine (F30). Keep the guide's staging trick (an inverted favicon on non-production builds) optional.
- **Evidence:**
  - [How to Favicon in 2026: Three files that fit most needs](https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs) — Andrey Sitnik, Evil Martians, dated 2026-01-21, accessed 2026-09-30 — practitioner guide.
    - `<link rel="icon" href="/favicon.ico" sizes="32x32">` / `<link rel="icon" href="/icon.svg" type="image/svg+xml">` / `<link rel="apple-touch-icon" href="/apple-touch-icon.png"><!-- 180×180 -->`
    - "Instead of serving dozens of icons, all you need is just five icons and one JSON file."
    - "We need `sizes="32x32"` for `` to `.ico` file in order to fix the Chrome bug where it chooses an ICO file over an SVG." (the empty backticks are a `<link>` tag stripped by the text extraction)
    - "Small note: an Apple touch icon will look better if you place `20px` padding around the icon and add some background color."
    - "Maskable icons should have bigger paddings. The safe zone is a 409×409 circle."
    - Changelog: "2023-07-11 - `sizes="any"` for ICO file was replaced to `sizes="32x32"` to fix bug when Chrome downloaded both ICO and SVG files."
    - "If you do not have GIMP you can install Inkscape and ImageMagick and convert SVG to ICO in the terminal"
- **Limits / false positives:** A widely cited practitioner guide, not a standard. Its title ("Three files") and body ("five icons and one JSON file") disagree, and its "72%" SVG-support figure is stale (F22). The 2026 editor's note claims freshness, but the changelog's last technical change is 2024-09-05.

### FD12-F22 — SVG favicons now reach 91.61% of users (Safari from 26.0); they must be served as `image/svg+xml` and load in secure static mode
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (data file re-fetched: `usage_perc_y` 91.61, first "y" Chrome 80, Firefox 41, Safari 26.0, iOS Safari 26.0, notes 3 and 4 verbatim; repository commits "2026-09-30T05:38:49Z data update". Note at verification: note 3 (MIME type) is attached to Chromium browsers and Firefox, not to Safari.)
- **Claim:** caniuse's data file for "SVG favicons" gives 91.61% global full support. The first supporting versions are Chrome 80, Firefox 41, and Safari and iOS Safari 26.0. The notes say the file "Requires the served mime-type to be `image/svg+xml`" and that Chromium serves it "in secure static mode". The Evil Martians figure ("72% of all browsers") is out of date.
- **Implication for /frontend:** Ship `icon.svg` as the primary favicon, with the ICO as fallback. The SVG must be self-contained: no external fonts, images or scripts (outline text, F15). Add a deploy check that fetches `/icon.svg` and asserts `Content-Type: image/svg+xml`.
- **Evidence:**
  - Command run: `curl -sL https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/link-icon-svg.json` (last commits on the repo: "2026-09-30T05:38:49Z data update"). Output excerpt: `usage_perc_y 91.61`; first "y": `safari 26.0`, `ios_saf 26.0`, `chrome 80`, `firefox 41`; notes `'3': 'Requires the served mime-type to be `image/svg+xml`.'` and `'4': 'Chromium browsers serve the SVG in [secure static mode](https://svgwg.org/svg2-draft/conform.html#secure-static-mode), but apply SMIL animations using the document start time (0).'`
  - [How to Favicon in 2026](https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs) — Evil Martians, accessed 2026-09-30.
    - "As of this writing, 72% of all browsers support SVG icons."
- **Limits / false positives:** caniuse percentages are usage-weighted estimates. "Supports SVG favicons" does not imply support for the dark-mode media query inside them; that was verified only in Chromium 147 (F24).

### FD12-F23 — The maskable safe zone is a centred circle of radius 40%; the fixed "409 on 512" recipe clips full-bleed marks, so check each mark
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (W3C Working Draft 13 August 2026, section 2.3 "Icon masks and safe zone", quote verbatim. Measurements re-run: three-bar mark at 409 px 200.2; a rounded square with rx 6 on the 32 grid gives 258.2 / 182.6 / 176.3 at 409 / 290 / 280 px, matching the dossier; a sharp square at 290 px gives 204.4, inside the 204.8 limit, which confirms the 0.566 × size rule.)
- **Claim:** The W3C Web Application Manifest (Working Draft, 13 Aug 2026) defines the safe zone as a circle at the icon's centre with radius 2/5 of the icon size (204.8 px on 512). I placed marks on a 512 canvas and measured the largest distance of any inked pixel from the centre. My three-bar mark scaled to 409 px reached 200.2 px (inside, barely). A full-bleed rounded square scaled to 409 px reached 258.2 px (outside); at 290 px it reached 182.6 px (inside). vite-pwa's assets generator resizes the mark to 70% (358 px) for maskable icons (F26), which would still put a full-bleed mark's corners outside the circle.
- **Implication for /frontend:** Do not hard-code a scale. Compute the maximum ink radius of the transparent-background layer and require it to be at most 0.4 × size; shrink until it passes, then add the background colour. For square marks the limit is about 0.566 × size per side (290 px on 512).
- **Evidence:**
  - [Web Application Manifest](https://www.w3.org/TR/appmanifest/) — W3C Working Draft, 13 Aug 2026, accessed 2026-09-30 (downloaded with curl; section 2.3).
    - "The safe zone is the area within a maskable icon which is guaranteed to always be visible, regardless of user agent preferences. It is defined as a circle with center point in the center of the icon and with a radius of 2/5 (40%) of the icon size, which means the smaller of the icon width and height, in case the icon is not square."
  - Command run: `node build.mjs` and `node mask-probe.mjs` (Appendix A). Output: `"logo409": { "maxInkRadius": 200.2, "insideSafeZone": true }`; `full-bleed rounded square at 409px on 512: maxInkRadius=258.2 safe=204.8 inside=false`; `... at 290px on 512: maxInkRadius=182.6 ... inside=true`; `... at 280px on 512: maxInkRadius=176.3 ... inside=true`.
- **Limits / false positives:** The radius counts any non-transparent pixel, including faint anti-aliasing, so it is slightly conservative. Platform masks differ in practice; the spec guarantees only the circle.

### FD12-F24 — SVGO 4.1.0's default preset removes a class-based dark-mode rule; confirmed in Chromium 147; fix with `inlineStyles: false` or the presentation-attribute pattern
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (every probe re-run with svgo 4.1.0: the CLI output is byte-identical, and the four config variants and both Evil Martians snippets behave as stated. Chromium re-run with playwright-core 1.63.0 on the cached build 1217, version 147.0.7727.15: source light rgb(20,22,26), dark rgb(244,241,234); default SVGO dark rgb(20,22,26); `inlineStyles: false` dark rgb(244,241,234). Release notes re-read: v4.0.0 published 2025-06-21, v4.1.0 2026-08-24.)
- **Claim:** An icon written as `<style>.m{fill:#14161a} @media (prefers-color-scheme: dark){.m{fill:#f4f1ea}}</style>` with `class="m"` lost its dark rule under `npx svgo --multipass` (SVGO 4.1.0, the command the favicon guide recommends). The output inlined `style="fill:#14161a"`, dropped the class and removed the `<style>` element. Disabling only `minifyStyles` kept the `@media` text but still dropped the class, so dark mode stayed broken. Disabling `inlineStyles` kept a working rule. The guide's own pattern (light colour as a `fill` presentation attribute, only the dark override inside `@media`) survived the default preset. In Chromium 147 under emulated dark mode, the default-SVGO file stayed rgb(20,22,26), while the source and the `inlineStyles: false` output switched to rgb(244,241,234). SVGO v4.0.0 (21 Jun 2025) stopped removing `viewBox` and `<title>` by default.
- **Implication for /frontend:** Optimise favicon SVGs with `preset-default` overriding `inlineStyles: false`, or author them in the presentation-attribute pattern. After SVGO, assert with a script that `prefers-color-scheme` is still present and that the selector still matches an element. Then verify the flip in a real browser: load `icon.svg` as a document under `emulateMedia({ colorScheme: 'dark' })` and sample a pixel.
- **Evidence:**
  - Command run: `npx svgo --version` -> `4.1.0`; `npx svgo --multipass out/cli-test.svg -o out/cli-test.min.svg` -> `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>Holdover</title><path d="M4 6h24v8H4zm0 12h14v8H4zm18 0h6v8h-6z" style="fill:#14161a"/></svg>`
  - Command run: `node svgo-probe.mjs`. Output: `preset-default darkQuery=false`; `no inlineStyles darkQuery=true ... <style>.m{fill:#14161a}@media (prefers-color-scheme:dark){.m{fill:#f4f1ea}}</style><path ... class="m"/>`; `no minifyStyles darkQuery=true ... <style>@media (prefers-color-scheme:dark){.m{fill:#f4f1ea}}</style><path ... style="fill:#14161a"/>` (no class left); `inlineStyles onlyMatchedOnce:false darkQuery=false`.
  - Command run: `node svgo-probe2.mjs`. Output: `EM snippet (1 element): darkQuery=true classKept=true => darkModeWorks=true`; `EM snippet (2 elements): ... darkModeWorks=true`.
  - Command run: `node pw-dark.mjs` (playwright-core 1.63.0 driving the cached Chromium build 1217). Output: `browser version 147.0.7727.15`; `source light rgb(20,22,26)`, `source dark rgb(244,241,234)`; `svgo-default light rgb(20,22,26)`, `svgo-default dark rgb(20,22,26)`; `svgo-no-inlineStyles light rgb(20,22,26)`, `svgo-no-inlineStyles dark rgb(244,241,234)`.
  - [SVGO v4.0.0 release notes](https://github.com/svg/svgo/releases/tag/v4.0.0) — SVGO maintainers, published 2025-06-21, accessed 2026-09-30.
    - "Both removeViewBox and removeTitle have been disabled by default."
  - [SVGO v4.1.0 release notes](https://github.com/svg/svgo/releases/tag/v4.1.0) — published 2026-08-24, accessed 2026-09-30.
    - "This is an intentional behavior change: malformed SVGs that were previously accepted may now produce a parser error, while valid XML documents are unaffected."
- **Limits / false positives:** One icon shape was tested. The test loads the SVG as a top-level document; the favicon inside the browser's tab strip was not captured, since Playwright screenshots do not include browser UI. Firefox and Safari were not tested.

### FD12-F25 — Next.js App Router: `app/favicon.ico`, `app/icon.svg`, `app/apple-icon.png`, `manifest`, `opengraph-image`; its docs show `sizes="any"` for the ICO, but the build emits a measured size, and which entry is measured depends on the bundler
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Next's docs (canary branch; next 16.3.8 published 2026-09-30) define `favicon` (`.ico`, only at the root of `app/`), `icon` (ico, jpg, jpeg, png or svg, anywhere in `app/`), `apple-icon` (jpg, jpeg or png), code-generated `icon`/`apple-icon` through `ImageResponse` from `next/og` ("You cannot generate a `favicon` icon"), `manifest.(json|webmanifest|ts)`, and `opengraph-image`/`twitter-image` with `.alt.txt` files. Builds fail when an OG image exceeds 8 MB or a Twitter image exceeds 5 MB. The docs' example shows the favicon emitted with `sizes="any"`, while the same page's note says `sizes="any"` is added only "when the extension is `.svg` or the image size of the file is not determined". Next 16 builds with Turbopack by default ("Turbopack is now the **default bundler** in Next.js"; `next build --webpack` opts out), and the two bundlers measure an ICO differently. Webpack path: `next-metadata-image-loader.ts` emits `${width}x${height}` from Next's compiled `image-size` (pinned at 1.2.1), which reports the first entry: [16, 32] reads as 16 × 16, a single 32 as 32 × 32, [32, 16] as 32 × 32. Turbopack path: `app_page_loader_tree.rs` writes ``sizes: `${mod.width}x${mod.height}` `` for non-SVG icons, where width and height come from `StructuredImageModuleType` → `get_meta_data`, which decodes the file with the Rust `image` crate (0.25.8); its ICO decoder's `best_entry` keeps the entry with the highest bits per pixel, then the largest area, so [16, 32] at equal depth reads as 32 × 32. A single-entry 32 × 32 ICO reads as 32 × 32 on both paths. The docs' OG font example loads Inter. (corrected: the dossier inferred "the loader emits the first ICO entry's size" from the webpack loader alone, whose header says "For turbopack, refer to app_page_loader_tree's write_metadata_item", and it missed that Turbopack is the default.)
- **Implication for /frontend:** In a Next app, put a single-entry 32 × 32 `favicon.ico` in `app/` (it is the only layout that gives `32x32` under both bundlers; "32 first" is enough only under webpack, "32 largest" only under Turbopack), plus `app/icon.svg`, `app/apple-icon.png` (180 × 180), `app/manifest.ts` and `app/opengraph-image.tsx` (or `.png`) with `opengraph-image.alt.txt`. Check the rendered `<head>` in the built page rather than trusting the docs or this source reading. Never copy the docs' Inter font example into OG code (tell 4).
- **Evidence:**
  - [favicon, icon, and apple-icon](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.mdx) — Vercel, canary docs, accessed 2026-09-30.
    - "| [`favicon`](#favicon) | `.ico` | `app/` |", "| [`icon`](#icon) | `.ico`, `.jpg`, `.jpeg`, `.png`, `.svg` | `app/**/*` |", "| [`apple-icon`](#apple-icon) | `.jpg`, `.jpeg`, `.png` | `app/**/*` |"
    - `<link rel="icon" href="/favicon.ico" sizes="any" />`
    - "You cannot generate a `favicon` icon. Use [`icon`](#icon) or a [favicon.ico](#favicon) file instead."
  - [opengraph-image and twitter-image](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.mdx) — Vercel, canary docs, accessed 2026-09-30.
    - "The `twitter-image` file size must not exceed 5MB, and the `opengraph-image` file size must not exceed 8MB. If the image file size exceeds these limits, the build will fail."
    - Font example: "join(process.cwd(), 'assets/Inter-SemiBold.ttf')"
  - [next-metadata-image-loader.ts](https://github.com/vercel/next.js/blob/canary/packages/next/src/build/webpack/loaders/next-metadata-image-loader.ts) — Vercel, canary (last commit 2026-08-28), accessed 2026-09-30 — source code.
    - "// For SVGs, skip sizes and use "any" to let it scale automatically based on viewport," ... "extension !== 'svg' && imageSize.width != null && imageSize.height != null ? `${imageSize.width}x${imageSize.height}` : 'any',"
  - Command run: `node icosize.mjs` with image-size 1.2.1 (the version in Next's `package.json` devDependencies). Output: `ICO [16,32] -> { width: 16, height: 16, images: [...] }`, `ICO [32] -> { width: 32, height: 32 }`, `ICO [32,16] -> { width: 32, height: 32 }`. (re-run at verification with the same result; `packages/next/package.json` on canary lists `"image-size": "1.2.1"`)
  - Added at verification: [Turbopack](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/08-turbopack.mdx) — Vercel, canary docs, accessed 2026-09-30.
    - "Turbopack is now the **default bundler** in Next.js. No configuration is needed to use Turbopack"; "If you need to use Webpack instead of Turbopack, you can opt-in with the `--webpack` flag"
  - Added at verification: [app_page_loader_tree.rs](https://github.com/vercel/next.js/blob/canary/crates/next-core/src/app_page_loader_tree.rs), [next_image/source_asset.rs](https://github.com/vercel/next.js/blob/canary/crates/next-core/src/next_image/source_asset.rs), [turbopack-image process/mod.rs](https://github.com/vercel/next.js/blob/canary/turbopack/crates/turbopack-image/src/process/mod.rs) — Vercel, canary, accessed 2026-09-30 — source code.
    - `let sizes = if path.has_extension(".svg") { "any" } else { "${mod.width}x${mod.height}" };`; the favicon is merged into the `icon` list and built with `StructuredImageModuleType::create_module`; `source_asset.rs` exports `width` and `height` from `get_meta_data`, which calls `reader.decode()` then `image_data.dimensions()`.
  - Added at verification: [image-rs ICO decoder at v0.25.8](https://github.com/image-rs/image/blob/v0.25.8/src/codecs/ico/decoder.rs) (the `image` version in Next's root `Cargo.toml`), accessed 2026-09-30 — `fn best_entry` scores each entry as `(entry.bits_per_pixel, real_width * real_height)` and keeps the highest.
  - Added at verification: `app-icons.mdx` note: "`sizes="any"` is added to icons when the extension is `.svg` or the image size of the file is not determined."
- **Limits / false positives:** Next was not run, on either path; the emitted `sizes` values are inferred from source code plus, for webpack, the library result. Next compiles its own copy of `image-size`, assumed here to match the pinned 1.2.1. The Turbopack reading is from canary source and was not executed.

### FD12-F26 — Vite: static icons go in `public/` and are referenced by absolute path; `@vite-pwa/assets-generator` 2.0.0 automates the set but emits a 48 px ICO and 70% maskable scaling
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (Vite `docs/guide/assets.md` lines re-read; the generator's README, `minimal-2023.ts`, `defaults.ts`, `utils.ts` and `package.json` re-fetched from main and match; npm lists 2.0.0 published 2026-09-12, MIT, engines node >=20.19.0)
- **Claim:** Vite serves files in `public/` at `/` during development and copies them "as-is" (no hashing) into the build; they must be referenced by root-absolute paths. `@vite-pwa/assets-generator` 2.0.0 (published 2026-09-12, requires Node 20.19.0 or later) generates PWA assets from one image with sharp ^0.35.4 and sharp-ico. Its `minimal2023Preset` produces transparent PNGs at 64, 192 and 512, `favicon.ico` at 48, a maskable 512 and an apple 180. The defaults resize the mark to `size * (1 - padding)` with padding 0.3 on a white background for maskable and apple icons, and 0.05 on transparent for the others.
- **Implication for /frontend:** In a Vite app, either write the files from the pipeline (Appendix A) into `public/` and add the `<link>` tags to `index.html`, or run the assets generator and then (1) replace or re-order the ICO to put 32 × 32 first if matching the Evil Martians set, (2) run the maskable radius check (F23), and (3) override the white background with the brand colour.
- **Evidence:**
  - [Static Asset Handling, "The public Directory"](https://github.com/vitejs/vite/blob/main/docs/guide/assets.md) — Vite docs, main branch, accessed 2026-09-30.
    - "Assets in this directory will be served at root path `/` during dev, and copied to the root of the dist directory as-is."
    - "Note that you should always reference `public` assets using root absolute path - for example, `public/icon.png` should be referenced in source code as `/icon.png`."
  - [vite-pwa/assets-generator](https://github.com/vite-pwa/assets-generator) — README, `src/presets/minimal-2023.ts`, `src/api/defaults.ts`, `src/api/utils.ts`, main branch, accessed 2026-09-30 — source code.
    - "From v2.0.0 `@vite-pwa/assets-generator` requires **Node 20.19.0 or above**"
    - "transparent: { sizes: [64, 192, 512], favicons: [[48, 'favicon.ico']], }, maskable: { sizes: [512], }, apple: { sizes: [180], },"
    - "maskable: { padding: 0.3, resizeOptions: { fit: 'contain', background: 'white' } }, apple: { padding: 0.3, resizeOptions: { fit: 'contain', background: 'white' } },"
    - "width: Math.round(width * (1 - padding)),"
  - Command run: `curl -s https://registry.npmjs.org/@vite-pwa/assets-generator` -> latest 2.0.0, published 2026-09-12, MIT; `package.json` dependencies `sharp ^0.35.4`, `sharp-ico ^0.1.5`.
- **Limits / false positives:** The generator was read, not run. The preset's source cites a 2023 dev.to article rather than the Evil Martians guide, which explains the 48 px ICO choice.

### FD12-F27 — Candidate slop tell: the framework's default favicon left in place (create-vite's purple `favicon.svg`, create-next-app's `favicon.ico`)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (the claim's hashes, sizes, fill colour, link tag, ICO entries and the 2026-01-27 commit all re-checked from main and canary and are right; the Implication was corrected because an exact-hash rule misses create-vite's own vanilla copy. Added at verification: all 16 create-vite templates were hashed; 15 share the `61bc9a16...` file, and template-vanilla's file is the same 9,522 bytes plus one trailing newline (9,523 bytes, same purple `#863bff` logo). An exact-hash check would therefore miss a trivially re-saved copy; see the corrected Implication. The Next ICO's three entries are all 32 bpp, so it reads as 48 × 48 under both bundlers in F25.)
- **Claim:** create-vite's react-ts, vue-ts and svelte-ts templates share one `public/favicon.svg` (9,522 bytes, SHA-256 `61bc9a16...`, fill `#863bff`), linked by `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`; the vanilla template's file differs (`ceeac384...`). create-next-app's app-tw/ts template ships `app/favicon.ico` (15,086 bytes, SHA-256 `c28fdd2a...`) with entries 48, 32 and 16. By the loader logic in F25, that default would be emitted as `sizes="48x48"` (48 is both the first entry for webpack and the largest for Turbopack).
- **Implication for /frontend:** Add a deterministic check: hash `favicon.*` and `icon.*` in `public/` and `app/` and fail when a hash matches a known framework template file. Normalise before hashing (for SVG, strip trailing whitespace or hash SVGO-canonicalised output; for rasters, hash decoded pixels), because create-vite's own vanilla template ships the same logo with one extra newline. Refresh the hash list from the template repositories at run time, since templates change (create-vite's changed on 2026-01-27). A missing custom favicon on a judged site is a cheap signal that the brand step was skipped. (corrected: added the normalisation step; the exact-hash rule missed the one-byte variant)
- **Evidence:**
  - Command run: `gh api repos/vitejs/vite/git/trees/main?recursive=1` and `curl .../packages/create-vite/template-react-ts/index.html | grep icon` -> `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`; `sha256sum vite-favicon.svg next-favicon.ico` -> `61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66` and `c28fdd2a4f31e2dc64f653962286da5c82a4cdfc518b242d32812c624e9a19a4`; sizes 9,522 and 15,086 bytes; `head -c 300 vite-favicon.svg` shows `fill="#863bff"`; ICO parse: `next favicon.ico entries 3 [(48, 48), (32, 32), (16, 16)]`; template hashes: `template-vanilla: ceeac38434be7a3b`, `template-vue-ts: 61bc9a161de58248`, `template-svelte-ts: 61bc9a161de58248`; last commit to the react-ts favicon: `2026-01-27T07:08:49Z feat(create-vite): update framework starter templates ...`.
  - [create-vite template-react-ts](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) and [create-next-app app-tw template](https://github.com/vercel/next.js/tree/canary/packages/create-next-app/templates/app-tw/ts/app) — accessed 2026-09-30 — template source files.
- **Limits / false positives:** Not validated against the owner's past hackathon frontends or a human control corpus, so its firing rate is unknown. Only two scaffolders were hashed (create-vite, all 16 templates at verification, and create-next-app's app-tw/ts); others such as Astro, SvelteKit or Nuxt starters were not. A default favicon shows neglect, not machine authorship.

### FD12-F28 — OG image: 1200 × 630 at 1.91:1, at most 8 MB for Meta; satori plus resvg renders it locally in Node; X's own spec could not be opened
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (Meta page re-read via Exa, since curl got HTTP 400; its quotes match, and it also states "The minimum allowed image dimension is 200 x 200 pixels." ImageResponse docs and satori README lines re-read. Appendix A re-run: the PNG is 1200 × 630 and exactly 26,677 bytes, with no `<text>` in the SVG. The Appendix version's SVG is 38,071 bytes, not 37,975. The 96-byte difference matches the smaller default-SVGO `icon.svg` that the original run embedded as a data URI, so it is not an error in the finding.)
- **Claim:** Meta recommends at least 1200 × 630 px, a ratio as close to 1.91:1 as possible, files at most 8 MB, `og:image:width` and `og:image:height` tags for immediate rendering, and a new URL when the image changes. Next's `ImageResponse` defaults to 1200 × 630, supports only flexbox and a CSS subset ("display: grid" will not work), has a 500 KB bundle limit and accepts only ttf, otf and woff fonts. satori does not support WOFF2, `z-index`, `calc` or 3D transforms, and bidirectional text is "not yet supported". A satori 0.33.5 plus resvg-js 2.6.2 render produced a 1200 × 630 PNG of 26,677 bytes, with all text as paths.
- **Implication for /frontend:** Generate the OG image at build time from the same brand sources: outlined mark, the OFL wordmark font as TTF, and the one-line problem statement from the spec (not a slogan). Emit `og:image`, `og:image:width`, `og:image:height`, `og:image:alt` and `twitter:card=summary_large_image`, and change the URL (hash) whenever the image changes. Keep the layout flexbox-only and the fonts TTF or OTF.
- **Evidence:**
  - [Images in Link Shares](https://developers.facebook.com/docs/sharing/webmasters/images) — Meta for Developers, accessed 2026-09-30.
    - "Use images that are at least 1200 x 630 pixels for the best display on high resolution devices."
    - "Try to keep your images as close to 1.91:1 aspect ratio as possible to display the full image in Feed without any cropping."
    - "The size of the image file must not exceed 8 MB."
  - [ImageResponse](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/04-functions/image-response.mdx) — Vercel, canary docs, accessed 2026-09-30.
    - "width?: number = 1200", "height?: number = 630"
    - "Only flexbox and a subset of CSS properties are supported. Advanced layouts (e.g. `display: grid`) will not work."
    - "Maximum bundle size of `500KB`."
    - "Only `ttf`, `otf`, and `woff` font formats are supported. To maximize the font parsing speed, `ttf` or `otf` are preferred over `woff`."
  - [satori README](https://github.com/vercel/satori) — Vercel, accessed 2026-09-30.
    - "Satori currently supports three font formats: TTF, OTF and WOFF. Note that WOFF2 is not supported at the moment."
    - "1. Three-dimensional transforms are not supported. 2. There is no `z-index` support in SVG. ... 3. `calc` isn't supported."
    - "Unicode bidirectional layout is not yet supported"
  - Command run: `node build.mjs`. Output: `"og": { "svgHasTextElement": false, "svgBytes": 37975, "png": { "width": 1200, "height": 630, "bytes": 26677 } }`; the PNG was inspected visually.
- **Limits / false positives:** X's card documentation returned HTTP 402 and 403, so X's ratio and size rules are not verified here. At verification the old `developer.x.com/.../cards/overview/...` URLs redirect to the generic `docs.x.com/overview`, and the `docs.x.com/llms.txt` index lists no cards page. Next's docs cite 5 MB for X only by linking to X. Meta's crawler behaviour was not tested live.

### FD12-F29 — Google Search does not list SVG as a favicon format and recommends a square favicon larger than 48 × 48
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (page re-fetched: "Last updated 2026-08-28 UTC", all four quotes verbatim, and "Google Search only supports one favicon per site, where a site is defined by the hostname". The page lists formats and names no SVG; it does not say in words that SVG is rejected, so "does not list" is the right wording.)
- **Claim:** Google's favicon guidelines (last updated 2026-08-28) require a square of at least 8 × 8 px and recommend "larger than 48x48px". They list the supported formats as "BMP, GIF, ICO, PNG, JPEG, PPM, and TIFF", with no SVG. They accept `rel` values `icon`, `shortcut icon`, `apple-touch-icon` and `apple-touch-icon-precomposed`, require a stable URL and a crawlable favicon and home page, and support one favicon per hostname.
- **Implication for /frontend:** A judge who searches the project name sees Google's favicon, not the browser's. Make sure a raster larger than 48 px is declared: the 180 px `apple-touch-icon` qualifies, or add `<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">`. Keep favicon URLs stable after publication, and do not block `/favicon.ico` or the icon files in `robots.txt`.
- **Evidence:**
  - [Define a favicon to show in search results](https://developers.google.com/search/docs/appearance/favicon-in-search) — Google Search Central, last updated 2026-08-28, accessed 2026-09-30 (raw page text read with curl).
    - "Your favicon must be a square (1:1 aspect ratio) that's at least 8x8px. While the minimum size requirement is 8x8px, we recommend using a favicon that's larger than 48x48px so that it looks good on various surfaces."
    - "Google Search supports the following favicon file formats: BMP, GIF, ICO, PNG, JPEG, PPM, and TIFF. The favicon URL must be stable (don't change the URL frequently)."
    - "Google supports the following rel attribute values for specifying a favicon; use whichever one fits your use case: icon ... shortcut icon ... apple-touch-icon ... apple-touch-icon-precomposed"
    - "Googlebot-Image must be able to crawl the favicon file and Googlebot must be able to crawl the home page; they cannot be blocked for crawling."
- **Limits / false positives:** Google does not document which icon it picks when several are declared. Favicons in results take time to update after a crawl, so a site launched days before judging may not show its favicon in Search yet.

### FD12-F30 — Windows toolchain without ImageMagick or Inkscape: resvg-js or sharp for rasterising, png-to-ico for ICO, 6.2 s end to end, 66 MB of dependencies
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** On Windows 11 with Node 24.13.0, these installed with prebuilt binaries and ran: svgo 4.1.0 (MIT, 2026-08-24); @resvg/resvg-js 2.6.2 (MPL-2.0; last stable 2024-03-26, 2.7.0-alpha.2 on 2026-01-28; `resvg-js-win32-x64-msvc`); sharp 0.35.5 (Apache-2.0, 2026-09-27; `sharp-win32-x64`, bundling librsvg 2.63.2 and libvips 8.18.7); png-to-ico 3.0.2 (MIT, 2026-07-06, pure JavaScript); satori 0.33.5 (MPL-2.0, 2026-09-22); opentype.js 2.0.0 (MIT, 2026-05-06). The original build (wordmark, marks, 8 renders, ICO, apple-touch, maskable, OG, manifest) took 6.2 s. That run's ICO parsed as 2 entries (16 and 32, 32 bpp, 5,430 bytes); the Appendix A script as printed writes a single 32 × 32 entry, and at verification it produced a 4,286-byte ICO with one 32 bpp entry. sharp rendered the class-styled SVG correctly (pixel rgb(20,22,26)). Dependencies used 66 MB, plus 14 MB for playwright-core, with no browser download (the cached Chromium was reused). (corrected: the dossier presented the 2-entry ICO as the pipeline's output without saying that Appendix A was changed to a single entry afterwards. The [16, 32] order it actually produced is the one F25 warns about: under `next build --webpack` it reads as 16 × 16.)
- **Implication for /frontend:** Ship the pipeline as a Node script inside the skill (Appendix A) and install its dependencies as devDependencies of the project. Prefer sharp as the rasteriser when a project already depends on it, keep resvg-js as the no-system-dependency option, and watch resvg-js maintenance (no stable release since March 2024). Tell /execution that the pipeline adds about 66 MB; clear caches afterwards on this disk-constrained machine.
- **Evidence:**
  - Commands run: `curl -s https://registry.npmjs.org/<pkg>` for each package (versions, publish dates and licences above); `gh api repos/thx/resvg-js/releases` -> `v2.7.0-alpha.2 2026-01-28T07:06:10Z`, `v2.7.0-alpha.1 2026-01-27`, `v2.7.0-alpha.0 2026-01-22`; `ls node_modules/@resvg/` -> `resvg-js/ resvg-js-win32-x64-msvc/`; `ls node_modules/@img` -> `colour/ sharp-wasm32/ sharp-win32-x64/`.
  - Command run: `time node build.mjs` -> `real 0m6.214s`; `"ico": { "reserved": 0, "type": 1, "count": 2, "entries": [ { "w": 16, "h": 16, "bpp": 32, "bytes": 1128 }, { "w": 32, "h": 32, "bpp": 32, "bytes": 4264 } ], "bytes": 5430 }`; `"files": { "apple-touch-icon.png": "180x180", "icon-192.png": "192x192", "icon-512.png": "512x512", "icon-mask.png": "512x512" }`.
  - Command run: `node sharp-svg.mjs` -> `rsvg: '2.63.2'`, `vips: '8.18.7'`, `sharp: '0.35.5'`, `rendered 512x512 format png pixel@topbar rgba [ 20, 22, 26, 255 ]`.
  - Command run: `du -sh node_modules` -> `66M`; `du -sh node_modules/playwright-core` -> `14M`.
  - Re-run at verification (same pins plus image-size 1.2.1 and playwright-core 1.63.0, npm with a scratch cache): `node_modules` 79M including 14M for playwright-core; `sharp.versions` -> `rsvg: '2.63.2'`, `vips: '8.18.7'`, `sharp: '0.35.5'`; class-styled SVG rendered by sharp, pixel `[20, 22, 26, 255]`; npm registry dates and licences as listed; `gh api repos/thx/resvg-js/releases` as listed; png-to-ico 3.0.2 depends only on `pngjs`, `minimist` and `@types/node`. Appendix A as printed: `real 0m4.480s`, solid share 1.000 / 1.000 / 0.934 / 1.000, `favicon.ico` 4,286 bytes with one 32 × 32 entry; feeding png-to-ico `[icon-16.png, icon-32.png]` reproduces the dossier's 2-entry, 5,430-byte file.
- **Limits / false positives:** Installed with npm and a scratch cache, not with pnpm 10; pnpm's handling of these optional native packages was not tested. Timings are from single runs on this machine (6.2 s for the original script, 4.5 s for Appendix A at verification).

## Contradictions between sources

1. **Favicon `sizes` attribute.** Evil Martians requires `sizes="32x32"` on the ICO link (changed from `sizes="any"` in 2023 for a Chrome bug). The Next.js docs' example shows the App Router emitting `sizes="any"` for `favicon.ico`, while the same page's note (which links to the guide) limits `"any"` to SVGs and files of undetermined size. Next's code emits a measured size: the first entry under `next build --webpack`, the highest-bit-depth then largest entry under the default Turbopack build (F21, F25). The docs' example is out of step with both the guide and the code. (corrected: the dossier described only the webpack loader and left out that the docs' own note restricts `"any"` to SVGs and undetermined sizes.)
2. **Favicon raster size.** Evil Martians: one 32 × 32 ICO. vite-pwa `minimal2023Preset`: a 48 × 48 ICO. create-next-app's default: 48, 32 and 16. Google Search: at least 8 × 8, preferably larger than 48 × 48, and no SVG (F21, F26, F27, F29).
3. **Maskable padding.** Evil Martians: "scale it to 409×409 and increase the canvas to 512×512", then "Check the icon in the maskable.app with different masks and tune the icon size if needed"; it also states the safe zone correctly as "a central circle of 409×409". W3C: a circle of radius 40%. Observed: the fixed 409-px step alone clips any mark whose ink reaches its corners, so the check the guide asks for is what matters. vite-pwa's 0.3 padding (358 px) has no such check and would also clip a full-bleed mark (F21, F23, F26). (corrected: the dossier set the guide against the W3C without its "check and tune" sentence; read in full, the guide agrees with the W3C.)
4. **Evil Martians against itself.** The title says "Three files", the body "five icons and one JSON file". "72% of all browsers support SVG icons" is stale against caniuse's 91.61% (F22). (corrected: the dossier also claimed that the guide's step 4, `npx svgo --multipass`, deletes the dark rule added in its step 1. F24's own probe shows the opposite: the guide's pattern, a `fill` attribute plus a dark-only class rule, survives SVGO. Only a pattern with the light colour also in a class rule loses dark mode.)
5. **Clichés.** Airey's annotated edition lists "There’s nothing wrong with using clichés" as a tip. C&G&H refuse swooshes and say a distinctive eagle is nearly impossible; Fast Company documents crypto convergence. The owner's brief treats clichés as slop. Only the tip's heading was readable, so the scope of Airey's claim is unknown (F02, F03, F05). The same tip list also has "8. Leave trends to the fashion industry" (read at verification), so Airey is not endorsing trends in general.
6. **AI-made logos.** Weingarten et al. (2020, peer-reviewed): experts beat AI logo makers on expressiveness and differentiation. Gual-Ortí et al. (2025, preprint): AI concepts comparable to novices' at the concept stage. The comparisons differ (experts vs novices, final logos vs concepts, template tools vs generative AI) (F06).
7. **"Ownership" of AI outputs.** Recraft assigns "all copyright rights it may have"; the US Copyright Office says prompt-only outputs carry none. The ownership is contractual, and the copyright may not exist (F07, F13).
8. **Recraft's "only model capable" of production SVG** against the benchmarks showing general LLMs writing usable SVG. The tasks differ (illustrations vs code-level SVG); the vendor claim is untested by any benchmark found (F08, F09, F12).
9. **Owner's naming study.** Passes 1 and 3 treated `www.registry.google` RDAP 404s as ".dev free"; Pass 2 found that endpoint answers 404 for everything, and this session reproduced it with `web.dev`. At verification, 6 of the 16 `.dev` names that Passes 1 and 3 marked free (Rubato, NextHop, Vernier, Foreshock, Lockstep, Isochron) turned out to be registered `.dev` domains, all registered before the study (F19). The X probe returned 200 for every handle in Pass 2, but 404 for unknown handles in Passes 1 and 3 and in this session (F19, F20).
10. **Airey's own list changed.** First edition: "simple, relevant, enduring, distinctive, memorable, and adaptable"; third edition preview: "simple, relevant, and distinctive" (F03).
11. **VLM judging.** VectorGym's VLM judges correlate at about 0.8 with humans on sketch fidelity but at most 0.40 on text-to-SVG, as printed (0.64 to 0.75 against 0.21 to 0.55 once the Ground Truth row is removed). VCode shows that free-form self-revision adds little (Claude-4-Opus +1.3 then +2.0 on MM-Vet) while structured external cues add much more (+16.6). So the model is a weak taste judge and only a modest self-corrector. Measured checks do the heavy lifting (F09, F10). (corrected: the dossier called the model family "a good defect checker" on the strength of the +12.3, which is mostly the vision tools' effect.)
12. **VectorGym's own ranking against its own judge study** (added at verification). The Text2SVG Score that ranks GPT-5.1, Gemini 3 Pro and Claude Sonnet 4.5 within 1.5 points averages in a VLM-judge metric that the same paper finds correlates weakly with humans on that task (F09).
13. **VCode's abstract against its own Table 2** (added at verification). The abstract calls Claude-4-Opus "top-performing"; Table 2 ranks it seventh of the baselines on Overall (41.7 against GPT-5's 46.8) (F10).

## What could not be found, and how it was searched

- **X (Twitter) card image rules (summary_large_image ratio, minimum and maximum dimensions, size).** WebFetch on developer.x.com returned HTTP 402; Exa could not fetch developer.x.com or docs.x.com (SOURCE_NOT_AVAILABLE); the devcommunity.x.com thread returned 403. Only secondary blogs were found, so none are cited. At verification, the `developer.x.com/en/docs/x-for-websites/cards/overview/...` URLs return 200 but redirect to the generic `docs.x.com/overview`, the `docs.x.com` equivalents return 404, and `docs.x.com/llms.txt` lists no cards page. Still not found.
- **The hexagon paragraph of the Fast Company article.** Exa and the feedburner variant stopped after the pyramid paragraph; WebFetch returned 403.
- **The full text of Weingarten et al. 2020 (She Ji).** ScienceDirect returned 403; the Elsevier API asked for a key; only the abstract (Exa library index) and Crossref metadata were read. At verification, Semantic Scholar lists the article as gold open access (CC BY-NC-ND) at `sciencedirect.com/science/article/pii/S2405872620300460/pdf`, but that URL still returned 403 to curl and Exa's crawler timed out, so sample sizes and tools remain unread.
- **The body of Airey's tip "There’s nothing wrong with using clichés".** Searched with Exa (verbatim phrase); only spam pages came back; the publisher sample stops before page 165.
- **A reproducible count of crypto logo shapes.** crypto-logo.com cites "A 2023 analysis by the design publication Brand New" finding hexagons at "5.4 times the rate". An Exa search of underconsideration.com/brandnew found no such analysis (only a 2016 "Logo Shape Study" link and a 2012 hexagon review). Treated as unverifiable and not cited as evidence.
- **A Pentagram talk transcript on logo principles.** Exa search surfaced a Bierut book extract (used), a Design Observer essay, a 99% Invisible episode and a Vox video; no talk transcript was opened.
- **An official image-search API for WIPO GBD or TMview.** WIPO's FAQ and TMview's help mention none; searched with Exa and read both help pages.
- **An independent benchmark of Recraft's SVG output.** Not in SVGenius or VectorGym; an Exa search returned only vendor and reseller pages.
- **Satori's support for variable fonts.** Its README does not mention variable fonts (grep for "variable" found only CSS variables).
- **Which icon Google Search picks when several are declared.** Not stated on the guidelines page.
- **Whether npm's `/-/org/<name>/package` returns 404 for a claimed scope with zero packages.** No such name was available to test.

## Weak spots of this dossier

- The design principles (F01–F04) are judgement, not measurement, and were downgraded to C at verification for that reason. The only measured evidence against generic logos (F05, F06) is one magazine count with an undisclosed method and one 2020 study read at abstract level.
- The evidence for a self-revision loop (F10) is thin: about +1 to +2 points for Claude-4-Opus on one split, measured up to two rounds. The dossier's original reading credited it with +12.3.
- The SVG benchmarks tested older or different models (Claude-3.7-Sonnet, Claude-4-Opus, Claude Sonnet 4.5) on illustration and fidelity tasks, not on brand marks, and not the model that will run /frontend.
- The solid-share metric (F16) was validated on two hand-made marks. It will under-score round and diagonal marks. It needs calibration on a control corpus of real favicons before it can gate anything, in line with the /prose standard.
- The "default favicon" tell (F27) has not been run against the owner's past hackathon frontends or against human-designed control sites.
- The Next.js `sizes` behaviour (F25) is inferred from source plus a library run; no Next build was executed. The default Turbopack path was read in Rust source only.
- The dark-mode verification (F24) used one browser (Chromium 147) and a top-level document, not the tab-strip favicon.
- The TMview word API and the npm org endpoint are undocumented and could change without notice; WIPO's and EUIPO's terms on automation were not checked.
- Vendor terms and prices (Recraft, TinEye) were read on one day and change often. The Recraft training-by-default clause (Terms 7.7) was re-fetched on the full page at verification.
- Copyright analysis covers US law only.

## Appendix A: verified pipeline (commands and script)

Run in `C:/Users/UTILIS~1/AppData/Local/Temp/claude/.../scratchpad/research/technique-logo-favicon-brand/pipeline` on 2026-09-30 (the folder was deleted afterwards). Installed with npm and a scratch cache; in a project, the equivalent is `pnpm add -D` with the same pins (pnpm itself was not tested).

```sh
npm install --no-audit --no-fund svgo@4.1.0 @resvg/resvg-js@2.6.2 sharp@0.35.5 png-to-ico@3.0.2 satori@0.33.5 opentype.js@2.0.0
curl -sL https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf -o fonts/IBMPlexMono-SemiBold.ttf
curl -sL https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt -o fonts/OFL.txt
node build.mjs
```

`build.mjs` differs from the script that produced the dossier's numbers in at least three ways. (1) The SVGO call below uses `inlineStyles: false`; the original run used the default preset, which is how the dark-mode loss in F24 was found. (2) The ICO step writes a single 32 px entry; the original run wrote [16, 32] (F30). (3) The gradient-hexagon test mark used in F16 is not included. (corrected: the dossier said "as run, with one change".) The script below was run verbatim at verification on 2026-09-30 in a scratch folder (Node 24.13.0, npm, same pins). It completed in 4.5 s and produced solid shares 1.000 / 1.000 / 0.934 / 1.000, `wordmark.svg` of 1,634 bytes, a one-entry 32 × 32 `favicon.ico` of 4,286 bytes, and a 1200 × 630 `opengraph-image.png` of 26,677 bytes. The SVGO config was verified with `svgo-probe.mjs` and in Chromium with `pw-dark.mjs`.

```js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { optimize } from 'svgo';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import satori from 'satori';
import opentype from 'opentype.js';

const here = import.meta.dirname;
const out = path.join(here, 'out');
await mkdir(out, { recursive: true });

// 1. Wordmark: outline the name from an OFL font (flipY: false is required in opentype.js 2.0.0).
const fontBuf = await readFile(path.join(here, 'fonts', 'IBMPlexMono-SemiBold.ttf'));
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));
const glyphPath = font.getPath('holdover', 0, 0, 100, { kerning: true });
const bb = glyphPath.getBoundingBox();
const d = glyphPath.toPathData({ decimalPlaces: 2, flipY: false });
const pad = 4;
const vb = [Math.floor(bb.x1 - pad), Math.floor(bb.y1 - pad), Math.ceil(bb.x2 - bb.x1 + 2 * pad), Math.ceil(bb.y2 - bb.y1 + 2 * pad)];
const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}"><title>Holdover</title><path fill="#14161a" d="${d}"/></svg>`;

// 2. Favicon mark: solid shapes on a 32-unit grid, even coordinates; dark-mode rule in <style>.
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <title>Holdover</title>
  <style>
    .m { fill: #14161a }
    @media (prefers-color-scheme: dark) { .m { fill: #f4f1ea } }
  </style>
  <path class="m" d="M4 6h24v8H4zM4 18h14v8H4zM22 18h6v8h-6z"/>
</svg>`;

// 3. SVGO without inlineStyles, then assert the dark rule survived.
const svgoCfg = { multipass: true, plugins: [{ name: 'preset-default', params: { overrides: { inlineStyles: false } } }] };
const icon = optimize(mark, svgoCfg).data;
if (!/prefers-color-scheme/.test(icon) || !/class="m"/.test(icon)) throw new Error('dark-mode rule lost in SVGO');
await writeFile(path.join(out, 'icon.svg'), icon);
await writeFile(path.join(out, 'wordmark.svg'), optimize(wordmark, { multipass: true }).data);

// 4. Render helpers and the small-size check (share of inked pixels that are fully opaque).
const render = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
async function solidShare(png) {
  const { data, info } = await sharp(png).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  let ink = 0, solid = 0;
  for (let i = 3; i < data.length; i += info.channels) { if (data[i] > 0) ink++; if (data[i] === 255) solid++; }
  return ink ? solid / ink : 0;
}
for (const px of [16, 32, 180, 512]) {
  const png = render(icon, px);
  await writeFile(path.join(out, `icon-${px}.png`), png);
  console.log(px, 'solidShare', (await solidShare(png)).toFixed(3));
}
for (const px of [16, 32]) { // enlargements for model and owner review
  await sharp(render(icon, px)).resize(px * 16, px * 16, { kernel: 'nearest' }).flatten({ background: '#ffffff' })
    .png().toFile(path.join(out, `icon-${px}-zoom.png`));
}

// 5. favicon.ico: a single 32 px entry (Evil Martians; Next.js reads the first entry's size).
await writeFile(path.join(out, 'favicon.ico'), await pngToIco([path.join(out, 'icon-32.png')]));

// 6. apple-touch-icon: 140 px logo on a 180 px canvas with a background colour.
const bg = '#f4f1ea';
await sharp({ create: { width: 180, height: 180, channels: 4, background: bg } })
  .composite([{ input: render(icon, 140), gravity: 'center' }]).png().toFile(path.join(out, 'apple-touch-icon.png'));
await writeFile(path.join(out, 'icon-192.png'), render(icon, 192));

// 7. Maskable 512: shrink until every inked pixel is within 0.4 * 512 of the centre (W3C safe zone).
async function maxInkRadius(png, size) {
  const { data, info } = await sharp(png).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const c = (size - 1) / 2; let r = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++)
    if (data[(y * info.width + x) * info.channels + 3] > 0) r = Math.max(r, Math.hypot(x - c, y - c));
  return r;
}
let inner = 409;
for (;;) {
  const layer = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: render(icon, inner), gravity: 'center' }]).png().toBuffer();
  if (await maxInkRadius(layer, 512) <= 0.4 * 512) break;
  inner -= 8;
}
await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
  .composite([{ input: render(icon, inner), gravity: 'center' }]).png().toFile(path.join(out, 'icon-mask.png'));

// 8. OG image 1200x630 with satori (text becomes paths), rasterised by resvg.
const markUri = 'data:image/svg+xml;base64,' + Buffer.from(icon).toString('base64');
const el = { type: 'div', props: {
  style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: bg, color: '#14161a', fontFamily: 'Plex Mono' },
  children: [
    { type: 'img', props: { src: markUri, width: 96, height: 96 } },
    { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: [
      { type: 'div', props: { style: { fontSize: 96, fontWeight: 600 }, children: 'holdover' } },
      { type: 'div', props: { style: { fontSize: 36, marginTop: 16 }, children: 'Every downstream consumer of a share ratio, and how many hours it is behind.' } },
    ] } },
  ] } };
const ogSvg = await satori(el, { width: 1200, height: 630, fonts: [{ name: 'Plex Mono', data: fontBuf, weight: 600, style: 'normal' }] });
await writeFile(path.join(out, 'opengraph-image.png'), new Resvg(ogSvg, { fitTo: { mode: 'original' } }).render().asPng());

// 9. Manifest.
await writeFile(path.join(out, 'manifest.webmanifest'), JSON.stringify({ name: 'Holdover', icons: [
  { src: '/icon-192.png', type: 'image/png', sizes: '192x192' },
  { src: '/icon-mask.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
  { src: '/icon-512.png', type: 'image/png', sizes: '512x512' },
] }, null, 2) + '\n');
```

Head tags for a Vite or static site (files in `public/`):

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

Next.js App Router layout: `app/favicon.ico` (single 32 px entry), `app/icon.svg`, `app/apple-icon.png` (180 × 180), `app/manifest.ts`, `app/opengraph-image.png` or `app/opengraph-image.tsx`, plus `app/opengraph-image.alt.txt`.

Dark-mode verification in a real browser (reusing the cached Chromium; playwright-core 1.63.0 without a browser download):

```js
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const exe = 'C:/Users/Utilisateur/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true });
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(pathToFileURL('out/icon.svg').href); // give the file width="64" height="64" first
  await page.screenshot({ path: `out/icon-${scheme}.png` });   // sample a pixel inside the mark
  await page.close();
}
await browser.close();
```

## Dropped at verification

None. Every finding's primary source opened and supported at least the core of its claim; the six corrections and four downgrades are recorded in place.

## Verification notes

**Method.** Every cited source was re-opened on 2026-09-30, none from memory:
- Web pages: curl with a browser user agent, falling back to Exa when curl was blocked (PRINT, Fast Company, Meta, O'Reilly, EUIPO, TinEye).
- Papers: the arXiv API for metadata and abstracts, and the arXiv HTML versions for SVGenius v1, VectorGym v2 and VCode v1, with tables parsed row by row.
- Repositories: gh or raw.githubusercontent.com, one file at a time.
- PDFs: downloaded and parsed with pypdf (Airey samples, USCO report, WIPO slides).
- The owner's local naming log: read directly.

Local observations were re-run in a scratch folder with the same pins. The folder held 79 MB of node_modules and peaked at 219 MB with the npm cache and downloaded PDFs, above the 100 MB guideline; it was deleted afterwards. The runs:
- opentype.js flipY probe;
- Appendix A verbatim;
- ICO parsing and png-to-ico with [16, 32];
- maskable radius probes;
- the four SVGO configurations and the CLI command;
- Chromium 147 light and dark pixel sampling;
- image-size 1.2.1 on three ICO layouts;
- template favicon hashes;
- RDAP bootstrap and endpoint status codes, and DoH NS lookups;
- GitHub, npm, X and TMview probes.

Beyond what the dossier cited, these primary sources were opened:
- Next's Turbopack docs page and the Rust sources `app_page_loader_tree.rs`, `next_image/source_asset.rs` and `turbopack-image/src/process/mod.rs`;
- image-rs's ICO decoder at v0.25.8;
- VCode's Tables 3 and 6;
- Recraft Developer Terms §4.3;
- RDAP registration events for the owner's `.dev` names.

**Material corrections, in order of consequence.**
1. **F10 (VCode).** The +12.3 is VCoder over its own base model, Claude-4-Opus. Most of it comes from external vision tools (+16.6 on MM-Vet); revision alone gives +1.3 and +2.0. Claude-4-Opus is not the best baseline: GPT-5 scores 46.8 against its 41.7.
2. **F25 (Next.js).** Next 16 builds with Turbopack by default, and that path measures an ICO with the Rust `image` crate (highest bit depth, then largest entry), not the first entry. A single 32 px ICO is still the right advice.
3. **F19 (naming).** Six of the sixteen `.dev` "free" verdicts in the owner's Passes 1 and 3 are registered domains.
4. **Contradiction 4.** The claim that the Evil Martians guide's SVGO step breaks its own dark-mode snippet was false by the dossier's own F24 probe.
5. **F05.** Swooshes are a dot-com cliché in the cited article, not a crypto one.
6. **F30 and the Appendix header.** The run's 2-entry ICO is not what Appendix A writes.
7. **F17.** WIPO slide numbers, and filters that were attributed to the logo search.
8. **F27.** An exact-hash rule misses create-vite's own vanilla copy of the favicon, which differs by one trailing newline.
9. **F01.** A hyphen was transcribed as an em dash.

**Grades.** F01–F04 were downgraded from A to C by the stated rubric (practitioner assertion, widely held); their quotes are all verbatim. F21 stays B because its load-bearing technical claims were tested in F22–F24.

**Sources that could not be opened.**
- X's summary_large_image card documentation: redirects to a generic page and is not listed in docs.x.com's index.
- The She Ji full text: gold open access per Semantic Scholar, but ScienceDirect returned 403 and Exa timed out.
- The Fast Company hexagon paragraph: curl got 403; Exa's text stops after the pyramid paragraph.
- Meta's page answered curl with HTTP 400 and was read through Exa.

**Residual doubts.**
- The Turbopack `sizes` behaviour is a source reading of canary, not a build of next 16.3.8.
- Whether VCode's "Full vision tools" row also runs revision is not stated.
- The VectorGym Ground-Truth-excluded ranges are my arithmetic on the paper's table, not the authors' figures.
- The F16 gradient-hexagon numbers could only be approximated, because its SVG is not in the dossier.
- The EUIPO news date (2023 by internal evidence, 2024-09-18 per Exa) is unresolved.
- The claim that WIPO's logo search accepts the Nice-class filter is plausible but undocumented in the sources read.
