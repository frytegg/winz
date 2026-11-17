# AI-slop tells in generated frontends: causes, detection, false positives
> Code FD10 · slug evidence-ai-slop-tells · researched 2026-09-30 · verified 2026-09-30 · counts: verified 13 / corrected 17 / downgraded 0 / dropped 0 / added 1

## Summary

- **The owner's list is a one-month-old social post, not a study.** It comes from an Instagram Reel by Quoc Ly (@millee.md), posted 2026-08-30, titled on screen "20 reasons why your app looks vibecoded (Give this to Claude/chatGPT)" (4,768 likes when first read, 4,784 at verification the same day). Two derivatives repeat it in the same order; one of them omits two items. No data or method is attached (F01). (corrected: the reel is 31 days old on 2026-09-30, not three weeks)
- **Cause, per the model vendor:** "distributional convergence". Anthropic says an unguided LLM landing page "will almost always conform to Inter fonts, purple gradients on white backgrounds, and minimal animations" (F02).
- **The toolchain ships the look as defaults.**
  - create-next-app: Inter in the root layout from v13.4.0 to v14.2.7 (and on the starter page already in v13.2.0), then Geist with a `#0a0a0a` dark ground from v14.2.8 and v15.0.0 (F06). (corrected: the switch to Geist and `#0a0a0a` was backported to v14.2.8, 2024-09-04, not first shipped in v15.0)
  - shadcn/ui: Lucide by default since 2024-11-06, a neutral palette and Inter or Geist. Buttons fade to `bg-primary/90` or `/80` on hover. Its author wrote "all apps started looking the same ... My bad" (F07, F08).
  - Tailwind: its creator's post blaming Tailwind UI's `bg-indigo-500` for AI indigo had 1.5M views (F05).
- **Tells move over time.**
  - In 982 Show HN pages from 2026, Krebs's purple rule fired on only 6.1%. The dark template (36.2%), gradients of any hue (32.8%) and a centred hero in a generic sans (22.0%) fired far more often (F11). The purple rule fires only on a filled purple button or link, so it does not measure the owner's T01 purple-to-blue gradient. (corrected: the 6.1% is not a measure of purple gradients)
  - Anthropic's own September 2026 guidance lists what "AI-generated design right now clusters around": cream `#F4F1EA`, serif display, clay `#D97757` (Anthropic's own accent), all-caps eyebrows, an accent on a single word, and spaced em-dash labels (F04). (corrected: the source says "AI-generated design", not "Claude-era")
  - Anthropic's October 2025 cookbook recommended Space Grotesk, Fraunces and Bricolage Grotesque, and its November 2025 blog repeated Space Grotesk and Bricolage Grotesque. All three are on 2026 "slop font" lists (F03). (corrected: Fraunces appears only in the October cookbook, not in the November blog)
- **Perception evidence is thin but consistent.**
  - In 3,033 Reddit comments, general sameness is named most (6.1 to 6.4% of comments). Each concrete tell is named in 2.5% of comments or fewer; glassmorphism 0.2%, bento 0.1% (F10). The same study's 32,822 design-context posts rank the concrete tells differently: emoji 2.7%, shadcn/Tailwind kit 2.2%, animation 2.0%, purple only 0.7% (F10). (corrected: the ranking depends on the unit of measurement)
  - Adjacent peer-reviewed work shows that suspected AI origin lowers trust: 78.29 vs 61.72 on a 100-point scale (F16).
  - Homogenization predates LLMs: layout distance between sites fell by more than 30% after 2007. Library overlap was a strong predictor of layout similarity, alongside colour-scheme standardisation and mobile support (F13). (corrected: the paper names libraries as a predictor among several causes, not the sole driver)
  - Five generative UI tools converge in appearance and layout, while colour varies more (F14).
- **Deterministic detection is feasible; its false-positive rates are self-reported.**
  - Krebs's MIT-licensed Playwright detector (14 patterns) reports about 5 to 10% false positives. Its maintainer dropped the three-icon-card and all-caps detectors because they fired on clean sites (F12).
  - impeccable's Apache-2.0 engine ships 61 deterministic rules, both static regexes and checks on the rendered page. For example, it flags em dashes at 8 or more and at least 1 per 500 characters of rendered body text (F18, F21, F23, F31). (corrected: impeccable is a second public deterministic detector, not a regex list only)
- **Em dashes are measurable.** Human essays average 3.23 per 1,000 words. GPT-4.1 produces 10.62 and Claude Opus 4.6 produces 9.09, falling to 0.19 when told to write plain prose (F17). Count rendered copy only: in the owner's XRPL 2026 frontend, about 132 of 186 source em dashes sit in code comments (F18).
- **The owner's eight past hackathon frontends:** shadcn default markers heavily present in 5 (a sixth has one match), Lucide in 6, backdrop blur in 7, alpha or opacity hovers in 6, and a purple-to-blue gradient in only 1 (F29). These are source counts: the blur count includes frosted navigation bars, and most source em dashes are in comments, so runtime checks must confirm which of these reach the rendered page.
- **Design rules that follow.**
  - Score co-occurrence with anchors, not single hits (F12).
  - Make runtime checks on computed styles authoritative (F25).
  - Calibrate against a pre-2023 human control corpus, because many tells are human template defaults (F13, F26).
  - Drop any detector that fires on the controls.

## Findings

### FD10-F01 — The owner's 20-item list originates in an Instagram Reel posted 2026-08-30 by Quoc Ly (@millee.md)
- **Grade:** D · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - The page `instagram.com/millee.md/reel/DcrqbqZRVvC` is attributed to "Quoc Ly (@millee.md)".
  - Its embedded JSON gives `taken_at` 1788131692 (2026-08-30T23:14:52Z), 4,768 likes and 52 comments on the day read. At verification, later the same day, it gave 4,784 likes and 52 comments.
  - Instagram's auto-generated description reads the on-screen title as "20 reasons why your app looks vibecoded (Give this to Claude/chatGPT)", with item 1 "Purple-to-blue gradient". The thumbnail I opened shows items 1 and 2.
  - A GitHub issue created 2026-09-20 transcribes the reel's items in the owner's order. It lacks "Inter font everywhere" and "colored border cards".
  - An article dated 2026-09-02 lists the same 20 signals in the owner's order, with qualifiers added to each (for example "without a brand or content reason"), without naming a source.
  - No earlier source was found. The reel presents no data.
- **Implication for /frontend:**
  - Treat each of the 20 as a hypothesis to validate against measured sources and control corpora, not as a rule.
  - The reel's framing ("give this to Claude") is a prompt blacklist. Anthropic's `frontend-design` skill replaced its font-name blacklist with described clusters in June 2026 (F03), but its Claude Design type still bans named fonts ("Inter, Roboto, Arial", F04). A blacklist is one input among several, not an approach Anthropic has dropped everywhere. (corrected: "Anthropic abandoned that approach" held only for the frontend-design skill)
- **Evidence:**
  - [Quoc Ly (@millee.md) Instagram reel DcrqbqZRVvC](https://www.instagram.com/millee.md/reel/DcrqbqZRVvC/) — Quoc Ly, 2026-08-30, accessed 2026-09-30 — social post (read via crawler user agent; JSON metadata and thumbnail).
    - "Video by Quoc Ly on August 30, 2026. May be a Twitter screenshot of text that says '20 reasons why your app looks vibecoded (Give this to Claude/chatGPT) 1. Purple-to-blue gradient 11. 2. Gradient hero text ..."
    - Caption: "Does your website or app have any of these? Follow me for more! #ai #buildinpublic #vibecoding #claudecode #chatgpt"
  - [thn-inc/claude-tweaks issue #2667](https://github.com/thn-inc/claude-tweaks/issues/2667) — thomasholknielsen, 2026-09-20, accessed 2026-09-30 — GitHub issue (`gh api repos/thn-inc/claude-tweaks/issues/2667`).
    - "Reel `DcrqbqZRVvC` (transcribed) lists them: - purple-to-blue gradients and gradient hero text - emoji in headings - glassmorphism cards - low-contrast dark mode - three-icon-boxes-in-a-row layouts and badge-above-headline - Lucide icons everywhere and untouched shadcn components - scroll-triggered fade-ins, cursor-following elements, and hover-fade buttons - inconsistent spacing - em-dashes everywhere and generic buzzwords - serif-italic accent words and the Space Grotesque + Instrument Serif font pairing - grain texture overlays"
  - [Anti-Vibecoded UI: 20 Signals and an Open Agent Skill](https://yasirnajeep.com/en/blog/anti-vibecoded-ui-skill/) — Yasir Najeep (the byline also renders as "Najeeb"), 2026-09-02 (`datePublished` 2026-09-02T07:56:06Z; the Arabic original and the `yasircs4/anti-vibecoded-ui` repository are from the same day), accessed 2026-09-30 — blog post.
    - "1. Purple-to-blue gradients without a brand or content reason. 2. Gradient hero text used as a substitute for hierarchy. 3. Emojis in headings that do not match the product voice. 4. Inter everywhere without considering the brand, language, or reading context."
    - "I built Anti-Vibecoded UI to turn the joke into a repeatable review method."
- **Limits / false positives:**
  - I did not watch the video. The full 20-item order is inferred from the two derivatives plus the thumbnail.
  - The phrase "Twitter screenshot" is Instagram's automatic guess. The thumbnail shows a talking-head video with a text overlay, not a tweet.

### FD10-F02 — Anthropic attributes generic LLM frontends to "distributional convergence" toward safe, high-probability design choices
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - The model vendor states that an unguided LLM landing page converges on Inter, purple gradients on white, and minimal animation, because safe choices dominate web training data.
  - The vendor's evidence is before/after screenshots. No metric is published.
  - The cookbook entry was added on 2025-10-21 and the blog post on 2025-11-12.
- **Implication for /frontend:**
  - The builder model's unguided default is the tell generator. The skill must force a project-specific design plan (tokens derived from research) before code, then check the rendered output.
  - A blacklist alone is not enough.
- **Evidence:**
  - [Improving frontend design through Skills](https://claude.com/blog/improving-frontend-design-through-skills) — Anthropic (Prithvi Rajasekaran, Justin Wei, Alexander Bricken, with Molly Vorwerck and Ryan Whitehead), 2025-11-12, accessed 2026-09-30 — vendor blog.
    - "You might notice that when you ask an LLM to build a landing page without guidance, it will almost always conform to Inter fonts, purple gradients on white backgrounds, and minimal animations."
    - "During sampling, models predict tokens based on statistical patterns in training data. Safe design choices–those that work universally and offend no one–dominate web training data. Without direction, Claude samples from this high-probability center."
  - [prompting_for_frontend_aesthetics.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/coding/prompting_for_frontend_aesthetics.ipynb) — Anthropic, added 2025-10-21 (commit "Frontend Cookbook (#234)"), accessed 2026-09-30 — vendor notebook.
    - "You tend to converge toward generic, \"on distribution\" outputs. In frontend design, this creates what users call the \"AI slop\" aesthetic."
- **Limits / false positives:** This is the vendor's explanation, not a measured study. The claimed improvement ("dramatically improves frontend output") is illustrated, not quantified.

### FD10-F03 — Anthropic's first anti-slop guidance recommended several patterns that are now listed as tells, and its recommended fonts became 2026 "slop fonts"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - The first `frontend-design` SKILL.md (commit e5c60158df, 2025-11-12) told Claude to "Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays" and to "Use scroll-triggering and hover states that surprise".
  - The cookbook's typography prompt (2025-10-21) recommended Space Grotesk ("Code aesthetic"), Fraunces and Playfair Display ("Editorial"), and Bricolage Grotesque and Newsreader ("Distinctive"). A different prompt in the same notebook, the distilled aesthetics prompt, warned "You still tend to converge on common choices (Space Grotesk, for example)". (corrected: the warning is not in the typography prompt itself)
  - The 2025-11-12 blog post repeats the typography list with Space Grotesk and Bricolage Grotesque, but its "Editorial" line reads "Playfair Display, Crimson Pro", without Fraunces. (added at verification)
  - By mid-2026 these same fonts appear on detector lists:
    - Krebs's slop-font list: Space Grotesk, Instrument Serif, Fraunces, Bricolage Grotesque, Sora, Young Serif, Bodoni, Syne, "from the r/UXDesign reddit thread".
    - impeccable's overused-font regex, which includes Fraunces, Space Grotesk and Instrument Serif.
    - taste-skill, which bans Fraunces and Instrument Serif as defaults.
  - Anthropic's own 2026-09-03 revision now says "fade-and-slide-up entrances on each section and hover transitions on every card are the generic default and read as AI-generated".
  - The 2026-06-09 revision had already dropped the name blacklist in favour of described clusters.
- **Implication for /frontend:**
  - A fixed list of "good alternatives" becomes the next tell once a model applies it by reflex.
  - Derive type and palette from the project's research inputs (the sponsors' customers' sites), record the reason for each choice, and keep second-generation tells in the checker.
- **Evidence:**
  - [anthropics/skills frontend-design SKILL.md @ e5c60158df](https://github.com/anthropics/skills/blob/e5c60158df/frontend-design/SKILL.md) — Anthropic, 2025-11-12, accessed 2026-09-30 — vendor skill file (body identical to the 2025-12-04 version 00756142).
    - "NEVER converge on common choices (Space Grotesk, for example) across generations."
  - [prompting_for_frontend_aesthetics.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/coding/prompting_for_frontend_aesthetics.ipynb) — Anthropic, added 2025-10-21 (commit ec30522b67), accessed 2026-09-30 — vendor notebook.
    - "- Code aesthetic: JetBrains Mono, Fira Code, Space Grotesk - Editorial: Playfair Display, Crimson Pro, Fraunces ... - Distinctive: Bricolage Grotesque, Obviously, Newsreader"
  - [Improving frontend design through Skills](https://claude.com/blog/improving-frontend-design-through-skills) — Anthropic, 2025-11-12, accessed 2026-09-30 — vendor blog (checked at verification).
    - "- Editorial: Playfair Display, Crimson Pro" · "- Distinctive: Bricolage Grotesque, Newsreader"
  - [anthropics/skills frontend-design SKILL.md @ 41bbe19](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md) — Anthropic, 2026-09-03, accessed 2026-09-30 — vendor skill file.
  - [AdrianKrebs/design-slop-cop src/lib/slop-fonts.js](https://github.com/AdrianKrebs/design-slop-cop/blob/HEAD/src/lib/slop-fonts.js) — Adrian Krebs, HEAD e2fab6ce71, accessed 2026-09-30 — tool source.
    - "// The \"slop font\" call-out list from the r/UXDesign reddit thread."
- **Limits / false positives:** The timing is documented, but the claim that the prompts spread these fonts is my inference, not a measurement.

### FD10-F04 — Anthropic's current guidance and the Claude Design type name the clusters AI-generated design falls into now, including Anthropic's own clay accent
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** The 2026-09-03 `frontend-design` skill lists five traits that "AI-generated design right now clusters around" (its words; it does not call them Claude-specific, except that it names the clay accent as Anthropic's own). (corrected: the title said "Claude-era clusters")
  1. Cream near `#F4F1EA`, a high-contrast serif display and a terracotta or clay accent near `#D97757`.
  2. Near-black with an acid-green or vermilion accent.
  3. A broadsheet layout with hairline rules.
  4. The SaaS-card kit: identical rounded cards, one radius and the same `rgba(0,0,0,.1)` shadow, with gradient washes.
  5. "Template chrome": ALL-CAPS eyebrows, `A · B · C` meta strings, "WORD — fragment" labels, `#0B0B0B` or `#111` standing in for black, monospace micro-labels and a trailing "→".

  It also names three typographic tells: an accent on a single word, all-caps labels, and unnecessary labels. The Claude Design type (release 1790780428-0f80) repeats the theme.
- **Implication for /frontend:**
  - The builder is Claude, so these defaults must be in the checker. The owner's 20 cover them only in part: T18 (serif italic accents) overlaps the single-word accent, T09 (badge above the headline) the eyebrow, and T16 (em dashes) the "WORD — fragment" label. The cream, near-black-with-acid-accent and broadsheet clusters, middle-dot meta strings, mono micro-labels and trailing arrows are not in the 20. (corrected: "almost none" understated the overlap)
  - The Design type's rule "Recreations are exact only from real source; no other company's proprietary design" constrains the owner's image-to-code idea: copy structure and principles, not a customer's proprietary design.
- **Evidence:**
  - [anthropics/skills frontend-design SKILL.md @ 41bbe19](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md) — Anthropic, 2026-09-03 (commit "Update frontend-design skill to avoid generic design defaults (#1713)"), accessed 2026-09-30 — vendor skill file.
    - "Avoid these default typographic treatments; they are the commonest tells of a generated page: - Accenting just a single word or phrase in a headline, like putting one word in italic/bold or a different color. - Using all caps for labels. - Adding unnecessary typographic labels above content."
    - "a warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta or warm-clay accent (often near #D97757 — Anthropic's own Claude-interaction accent, so on a user's brief it reads as a tell)"
  - Claude Design Artifact type SKILL.md (type_url `https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd`, release 1790780428-0f80) — Anthropic, accessed 2026-09-30 via the Artifact tool (`action: read`, `type_url`) — vendor type instructions.
    - "No AI tropes (gradient washes, left-border cards, emoji; Inter, Roboto, Arial)."
    - "Cream, serif display and clay are your habit: only if the brief or brand asks."
    - "No filler, invented stats or lorem ipsum; missing facts become placeholders like [YOUR PRICE]."
- **Limits / false positives:** These are vendor judgements with no data. "All traits are legitimate for some briefs", in the vendor's own words.

### FD10-F05 — Tailwind's creator blamed Tailwind UI's `bg-indigo-500` buttons for AI indigo, and the "purple problem" was still present at GPT-5's launch
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - Adam Wathan posted the apology on 2025-08-07 (1,503,697 views when read). He was quote-posting Kevin Kern's "So, GPT-5 hasn't solved the "purple problem"".
  - The default hues are in Tailwind's palette:
    - v3.4.17: indigo-500 `#6366f1`, indigo-600 `#4f46e5`, violet-500 `#8b5cf6`, purple-500 `#a855f7`, blue-500 `#3b82f6`.
    - v4: indigo-500 `oklch(58.5% 0.233 277.117)`, violet-500 `oklch(60.6% 0.25 292.717)`, purple-500 `oklch(62.7% 0.265 303.9)`, blue-500 `oklch(62.3% 0.214 259.815)`.
- **Implication for /frontend:** Static detectors should match these exact defaults (hex, oklch and class names). The tell is an unchosen default hue, not purple as such.
- **Evidence:**
  - [Adam Wathan on X](https://x.com/adamwathan/status/1953510802159219096) — Adam Wathan (creator of Tailwind CSS), 2025-08-07 17:37:24 UTC, accessed 2026-09-30 via `api.fxtwitter.com` JSON — social post.
    - "I'd like to formally apologize for making every button in Tailwind UI `bg-indigo-500` five years ago, leading to every AI generated UI on earth also being indigo."
  - [tailwindcss v3.4.17 src/public/colors.js](https://github.com/tailwindlabs/tailwindcss/blob/v3.4.17/src/public/colors.js) and [main packages/tailwindcss/theme.css](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/theme.css) — Tailwind Labs, accessed 2026-09-30 — source files.
    - `500: '#6366f1',` (indigo) · `--color-indigo-500: oklch(58.5% 0.233 277.117);`
- **Limits / false positives:**
  - The post is a single, half-joking post, and the causal claim is not measured. I could not open Tailwind UI (Tailwind Plus) component code, which sits behind a login.
  - One practitioner guide says indigo was the "demo accent in 2019". Wathan's "five years ago", written in 2025, points to 2020, and Tailwind UI went live on 2020-02-26 ("Holy crap Tailwind UI is live!", [Wathan on X](https://x.com/adamwathan/status/1232688967851610112), read via `api.fxtwitter.com` at verification).

### FD10-F06 — create-next-app shipped Inter in the root layout (v13.4.0 to v14.2.7), then Geist (v14.2.8 and v15.0.0 on), with a `#0a0a0a` dark ground and zinc text on the starter page
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - `packages/create-next-app/templates/app-tw/ts/app/layout.tsx` changes as follows:
    - v13.4.0 to v14.2.7: `import { Inter } from 'next/font/google'` and `<body className={inter.className}>`. Inter was already imported in the starter `page.tsx` of the `app` and `default` templates in v13.2.0 and of `app-tw` in v13.3.0, before it moved into the root layout.
    - v14.2.8 (released 2024-09-04, a backport) and v15.0.0: `localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans", ... })`.
    - v15.1.0 to v16.0.0 and canary: `import { Geist, Geist_Mono } from "next/font/google"`.
  - From v14.2.8 and in v15.0.0 and later, `globals.css` sets `--background: #0a0a0a; --foreground: #ededed;` under `prefers-color-scheme: dark`. It also sets `body { font-family: Arial, Helvetica, sans-serif; }`. (corrected: the dossier dated both changes to v15.0.0 and ended Inter at v14.2.0; tags v14.2.3 to v14.2.7 still import Inter, and v14.2.8 to v14.2.35 ship local Geist)
  - The canary starter page uses `bg-zinc-50 font-sans dark:bg-black` and `text-zinc-600 dark:text-zinc-400`.
  - Relevant commits: "Update create-next-app template (#65803)" (2024-05-18) and "CNA: replace geist font from local to google (#72618)" (2024-11-13).
- **Implication for /frontend:**
  - One of the owner's tells (T04, Inter everywhere) and one added tell (M08, the `#0a0a0a` plus zinc dark default) are scaffold defaults the build starts from. The scaffold's own dark text is high-contrast (`#ededed` on `#0a0a0a` is 16.91:1, `zinc-400` on black 8.19:1, computed at verification), so the scaffold alone does not produce T07. (corrected: "#0a0a0a plus zinc" is not one of the owner's 20)
  - A static check can diff `layout.tsx` and `globals.css` against the scaffold. Unchanged means untouched.
- **Evidence:**
  - [vercel/next.js create-next-app app-tw layout.tsx at v14.2.0](https://github.com/vercel/next.js/blob/v14.2.0/packages/create-next-app/templates/app-tw/ts/app/layout.tsx), [at v14.2.7](https://github.com/vercel/next.js/blob/v14.2.7/packages/create-next-app/templates/app-tw/ts/app/layout.tsx), [at v14.2.8](https://github.com/vercel/next.js/blob/v14.2.8/packages/create-next-app/templates/app-tw/ts/app/layout.tsx), [at v15.0.0](https://github.com/vercel/next.js/blob/v15.0.0/packages/create-next-app/templates/app-tw/ts/app/layout.tsx), [at canary](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/app-tw/ts/app/layout.tsx) — Vercel, accessed 2026-09-30 — source (fetched with curl per tag; v14.2.x bisected at verification).
    - `const inter = Inter({ subsets: ["latin"] });` (v14.2.0 to v14.2.7) · `src: "./fonts/GeistVF.woff",` (v14.2.8, v15.0.0) · `import { Geist, Geist_Mono } from "next/font/google";` (v15.1.0+)
  - [vercel/next.js release v14.2.8](https://github.com/vercel/next.js/releases/tag/v14.2.8) — Vercel, published 2024-09-04, accessed 2026-09-30 (`gh api repos/vercel/next.js/releases/tags/v14.2.8`).
  - [app/ts/app/page.tsx at v13.2.0](https://github.com/vercel/next.js/blob/v13.2.0/packages/create-next-app/templates/app/ts/app/page.tsx) — Vercel, accessed 2026-09-30 — source.
    - `import { Inter } from 'next/font/google'`
  - [globals.css at canary](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/app-tw/ts/app/globals.css) — Vercel, accessed 2026-09-30 — source.
    - `--background: #0a0a0a;` `--foreground: #ededed;`
- **Limits / false positives:** This shows what the default is, not how many shipped sites keep it. Tailwind's own default `--font-sans` is the system stack (`ui-sans-serif, system-ui, sans-serif, ...` in v4.0.0 and v4.1.0), not Inter.

### FD10-F07 — shadcn/ui defaults to Lucide, a neutral palette and Inter or Geist; its author wrote that "all apps started looking the same"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - The changelog dated 2024-11-06 made Lucide the default icon set for new-york.
  - The changelog dated 2025-12-12 (`npx shadcn create`) admits the homogenization.
  - The website's `DEFAULT_CONFIG` (commit c257f688cf, 2026-09-04) is `style: "nova"`, `baseColor: "neutral"`, `iconLibrary: "lucide"`, `font: "inter"`, `radius: "default"`, with `DEFAULT_RADIUS_VALUE = "0.625rem"`.
  - The CLI's `-d, --defaults` means `--template=next --preset=base-nova`, whose preset description is "Lucide / Geist".
  - The neutral theme's dark `background` is `oklch(0.145 0 0)`. I computed it as sRGB (10,10,10), which is `#0a0a0a`, the same as create-next-app's dark ground.
  - Since 2026-07-02, Base UI is the default component library.
- **Implication for /frontend:**
  - "Untouched shadcn" is detectable as token equality with the registry defaults. Lucide in `package.json` is the default, not a choice.
  - The fix is to set tokens from brand research before adding components.
- **Evidence:**
  - [shadcn changelog 2025-12-shadcn-create.mdx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2025-12-shadcn-create.mdx) — shadcn, 2025-12-12, accessed 2026-09-30 — project changelog.
    - "But somewhere along the way, all apps started looking the same. I guess the defaults were a little _too_ good. My bad."
  - [shadcn changelog 2024-11-icons.mdx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2024-11-icons.mdx) — shadcn, 2024-11-06, accessed 2026-09-30.
    - "An update on icons. The new-york style now uses Lucide as the default icon set."
  - [apps/v4/registry/config.ts](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/config.ts), [packages/shadcn/src/preset/defaults.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/preset/defaults.ts), [packages/shadcn/src/commands/init.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/commands/init.ts), [apps/v4/registry/themes.ts](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/themes.ts) — shadcn, main @ b0fcb58a6e, accessed 2026-09-30 — source.
    - `iconLibrary: "lucide",` `font: "inter",` · `"use default configuration: --template=next --preset=base-nova"` · `description: "Lucide / Geist",` · `background: "oklch(0.145 0 0)",`
- **Limits / false positives:**
  - The defaults differ by entry path: the website's `DEFAULT_CONFIG` uses Inter, while the CLI's nova preset uses Geist.
  - `DEFAULT_PRESETS` at b0fcb58a6e holds eight presets. Five use Lucide: nova (Geist), vega, luma and rhea (Inter), and sera (Noto Sans with a Playfair Display heading, taupe base colour). The other three are maia (Hugeicons, Figtree), lyra (Phosphor, JetBrains Mono) and mira (Hugeicons, Inter). Seven of eight use the neutral base colour. (corrected: the dossier listed only the three non-Lucide presets as "the other presets", which understated how far Lucide, Inter and neutral dominate)

### FD10-F08 — shadcn components encode several of the owner's tells as defaults: fading hover, pill badge, soft-shadow card, and a `data-slot` runtime fingerprint
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - new-york-v4 `button.tsx` has `default: "bg-primary text-primary-foreground hover:bg-primary/90"` and `secondary: "... hover:bg-secondary/80"`.
  - The newer nova style has `.cn-button-variant-default { @apply bg-primary text-primary-foreground hover:bg-primary/80; }`.
  - `badge.tsx` has `rounded-full border border-transparent px-2 py-0.5 text-xs font-medium`.
  - `card.tsx` has `rounded-xl border bg-card py-6 text-card-foreground shadow-sm`.
  - Components carry `data-slot="button"`, `"badge"`, `"card"` and so on.
  - Tailwind v4 shadows use `rgb(0 0 0 / 0.1)`, for example `--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);`. This matches the "same soft grey shadow (rgba(0,0,0,.1))" in F04.
- **Implication for /frontend:**
  - Tell T14 (buttons fade on hover) is a default of the component kit. The fix is a deliberate hover token.
  - `[data-slot]` tells the runtime checker that shadcn is present, so it can compare computed styles with the defaults.
- **Evidence:**
  - [new-york-v4/ui/button.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/button.tsx), [badge.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/badge.tsx), [card.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/card.tsx), [styles/style-nova.css](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/styles/style-nova.css) — shadcn, accessed 2026-09-30 — source.
    - `default: "bg-primary text-primary-foreground hover:bg-primary/90",`
    - `"flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm",`
  - [tailwindcss main theme.css](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/theme.css) — Tailwind Labs, accessed 2026-09-30 — source.
    - `--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);` · `--radius-2xl: 1rem;`
- **Limits / false positives:** These are sensible UI defaults. Their presence alone does not make a page slop.

### FD10-F09 — Copy-paste effect libraries ship the motion and texture tells as ready components, and several tells predate LLMs as official templates
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Magic UI's registry (22,432 stars) contains:
    - `blur-fade.tsx`: `useInView(ref, { once: true, margin })`, starting at `opacity: 0`.
    - `magic-card.tsx`: `onPointerMove` feeding `radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px, ...)`.
    - `noise-texture.tsx`: SVG `<feTurbulence>`.
    - `number-ticker.tsx`, `marquee.tsx`, `bento-grid.tsx`, `border-beam.tsx`.
  - Aceternity UI's catalogue lists Spotlight, Background Beams, Tracing Beam, Following Pointer, Aurora Background, Sparkles, Meteors and a Lamp effect.
  - Older human templates show the same patterns:
    - AOS (repository created 2015-07-09) documents `data-aos="fade-up"`.
    - Motion's docs show `initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}`.
    - Bootstrap's official "Features" example, added 2021-03-22, already had "Columns with icons": three `col-md-4` columns, each with a `feature-icon bg-primary bg-gradient` tile above an `h2`. The current version of the same example uses `row-cols-lg-3` and `feature-icon ... text-bg-primary bg-gradient` above each `h3`. (corrected: the dossier quoted today's markup as if it were the 2021 original; the pattern itself dates from 2021)
- **Implication for /frontend:**
  - Static detection can key on these imports and component names (see S12, S13, S20).
  - The same evidence argues for false-positive care: human-made templates carried the three-icon row and fade-up reveals years before LLMs.
- **Evidence:**
  - [magicuidesign/magicui registry](https://github.com/magicuidesign/magicui/tree/main/apps/www/registry/magicui) — Magic UI, accessed 2026-09-30 — source (blur-fade.tsx, magic-card.tsx, noise-texture.tsx, number-ticker.tsx).
    - `const inViewResult = useInView(ref, { once: true, margin: inViewMargin })` · `onPointerMove={handlePointerMove}`
  - [Aceternity UI components](https://ui.aceternity.com/components) — Aceternity, accessed 2026-09-30 — component catalogue (read through WebFetch).
  - [michalsnik/aos README](https://github.com/michalsnik/aos) — Michał Sajnóg, repo created 2015-07-09, accessed 2026-09-30 — source README.
    - `data-aos="fade-up"`
  - [Motion: scroll animations](https://motion.dev/docs/react-scroll-animations) — Motion, accessed 2026-09-30 — official docs (read through WebFetch).
    - `<motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} />`
  - [twbs/bootstrap examples/features](https://github.com/twbs/bootstrap/blob/main/site/src/assets/examples/features/index.astro) — Bootstrap team, first added 2021-03-22 ("Update examples (#33214)"), accessed 2026-09-30 — source (current version).
    - `<div class="row g-4 py-5 row-cols-1 row-cols-lg-3">` · `feature-icon d-inline-flex align-items-center justify-content-center text-bg-primary bg-gradient fs-2 mb-3`
  - [the same example at commit a3ad7327f2](https://github.com/twbs/bootstrap/blob/a3ad7327f2/site/content/docs/5.0/examples/features/index.html) — Bootstrap team, 2021-03-22, accessed 2026-09-30 — source (the 2021 original, read at verification).
    - `<div class="feature col-md-4">` · `<div class="feature-icon bg-primary bg-gradient">` · `<h2>Featured title</h2>`
- **Limits / false positives:** The libraries' existence does not prove they cause AI output. They are one plausible channel, along with training data.

### FD10-F10 — A Reddit study of 3,033 comments finds general sameness named most, each concrete tell named in 2.5% of comments or fewer, and glassmorphism and bento near the bottom
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - The study scanned 3,214,533 posts across 47 subreddits (2020 to 2026) and found 46,971 on-topic posts. It then took 3,033 comments from 125 threads such as "dead giveaways for AI slop websites".
  - Share of comments naming each tell:

    | Tell | Share of comments |
    |---|---|
    | "Screams AI" | 6.4% |
    | "all looks the same" | 6.1% |
    | shadcn/Tailwind default kit | 2.5% |
    | purple | 2.3% |
    | gradients or gradient text | 2.0% |
    | too many animations or Framer fade-ins | 1.1% |
    | rounded corners | 0.8% |
    | dark mode plus neon glow | 0.7% |
    | emoji | 0.5% |
    | Inter/Geist | 0.4% |
    | three-column cards | 0.4% |
    | glassmorphism | 0.2% |
    | bento | 0.1% |

  - "Mesh / blob / aurora" was rejected as a keyword artifact.
  - Measured as a share of posts, the topic grew from 1.81 to 277.91 posts per 10k between 2023 and 2024.
  - The same repository also reports each tell's share of 32,822 design-context posts, and that order differs from the comment order (added at verification):

    | Tell | Share of comments | Share of design-context posts |
    |---|---|---|
    | emoji / sparkles / rockets | 0.5% | 2.7% |
    | shadcn/Tailwind default kit | 2.5% | 2.2% |
    | too many animations or Framer fade-ins | 1.1% | 2.0% |
    | three-column feature cards | 0.4% | 1.6% |
    | dark mode plus neon glow | 0.7% | 1.3% |
    | gradients or gradient text | 2.0% | 1.2% |
    | purple | 2.3% | 0.7% |
    | glassmorphism | 0.2% | 0.3% |
    | bento | 0.1% | 0.1% |

- **Implication for /frontend:**
  - Weight the shadcn/Tailwind default look and animation high on both measures. Purple and gradients rank high among comments but low among posts, and emoji does the reverse, so neither ordering alone should set weights. (corrected: the dossier weighted purple and gradients highest from the comment column only)
  - Treat glassmorphism and bento as weak, and score co-occurrence, because sameness is the dominant complaint on both measures (13.1% and 13.0% of design-context posts).
- **Evidence:**
  - [HugoGarcez/vibecoded-design-tells README](https://github.com/HugoGarcez/vibecoded-design-tells) — Hugo Garcez, HEAD 97a610fbb0 (2026-06-21), accessed 2026-09-30 — study repository with data and scripts.
    - "shadcn/Tailwind defaults and the \"AI purple\" gradient lead. The stereotypical Twitter memes (bento grids, glassmorphism, aurora gradients) sit near the bottom or get rejected."
    - "This is a proxy for vocal, online opinion, so trust the relative ordering more than the exact percentages."
  - [unslop-ai-ui/comment_tell_counts.csv](https://github.com/HugoGarcez/vibecoded-design-tells/blob/HEAD/unslop-ai-ui/comment_tell_counts.csv) — accessed 2026-09-30 — data file.
    - `shadcn / Tailwind default kit,76,2.5,16` · `Glassmorphism / frosted glass,7,0.2,2` · `Bento grid,4,0.1,1`
  - [unslop-ai-ui/summary.txt](https://github.com/HugoGarcez/vibecoded-design-tells/blob/97a610fbb0/unslop-ai-ui/summary.txt) and [DATA_AND_GRAPHS.md](https://github.com/HugoGarcez/vibecoded-design-tells/blob/97a610fbb0/unslop-ai-ui/DATA_AND_GRAPHS.md) — Hugo Garcez, 97a610fbb0, accessed 2026-09-30 — data files (read at verification).
    - "Design-context subset: 32822 (69.9% of corpus)" · "2.7%  n=  879  Emoji / ✨ sparkles / 🚀 in copy" · "0.7%  n=  234  Purple / violet (the 'AI purple')"
- **Limits / false positives:**
  - Tells were matched by a broad keyword lexicon (read in `analyze.py`). For example, "tailwind" alone counts for the shadcn kit, `\bcards\b` for three-column cards, and "dark mode" for dark plus neon.
  - The sample is self-selected, vocal users. An agent workflow did the verification, and the ranking measures what people talk about, not what they notice.

### FD10-F11 — In 982 Show HN pages from 2026, the detected patterns were led by the dark template, gradients, icon-card grids and a centred generic-sans hero; filled purple CTAs fired on only 6.1%
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - I computed per-pattern prevalence from design-slop-cop's published `results/index/{heavy,mild,clean}.json` (committed 2026-06-18, 16-pattern detector version, N = 982):

    | Pattern | Share of pages |
    |---|---|
    | perma_dark_mode | 36.2% |
    | gradients | 32.8% |
    | icon_card_grid | 22.9% |
    | center_aligned_hero | 22.0% |
    | shadcn_signature | 21.8% |
    | slop_fonts | 18.1% |
    | numbered_steps | 17.7% |
    | hero_eyebrow_pill | 16.9% |
    | faq_accordion | 15.5% |
    | glassmorphism | 14.1% |
    | all_caps_headings | 9.9% |
    | purple_accent | 6.1% |
    | accent_stripe | 5.6% |
    | colored_glows | 5.5% |
    | stat_banner_row | 4.6% |
    | sidebar_emoji | 1.5% |

  - The blog reports tiers for 1,590 pages: High (4+ patterns) 22%, Medium 32%, Low 46%.
  - What two of the rows measure (read at verification in the pattern files at the index commit 2e602d9dc8):
    - `purple_accent` fires only when a button or link (or an element with a btn, button or cta class) is filled with an HSL 250 to 300 hue. Purple gradients on a hero or a section do not trigger it.
    - `gradients` is colour-agnostic: gradient text on the H1, or several elements with a visible gradient background, of any hue.
    - `perma_dark_mode` includes a "dark template" path that fires on a dark body with mostly white text, whatever the contrast.
- **Implication for /frontend:**
  - These are base rates for calibration. Filled purple buttons are now rare. The data do not measure the owner's T01 (a purple-to-blue gradient) directly, since those gradients fall under the colour-agnostic 32.8%. FAQ accordions, numbered steps and eyebrows are more common than accent stripes or emoji in navigation. (corrected: "Purple is now a minor signal" generalised a filled-CTA rule to all purple)
- **Evidence:**
  - [Scoring Show HN submissions for AI design patterns](https://www.adriankrebs.ch/blog/design-slop/) — Adrian Krebs, 2026-04-20, accessed 2026-09-30 — practitioner measurement.
    - "I scored 1,590 Show HN submissions from the last few weeks: High (4+ patterns): 22% (347 sites) Medium (2-3 patterns): 32% (508 sites) Low (0-1 patterns): 46% (735 sites)"
  - [design-slop-cop results/index](https://github.com/AdrianKrebs/design-slop-cop/tree/HEAD/results/index) — Adrian Krebs, accessed 2026-09-30 — published data. I counted with Python: `Counter(p for s in sites for p in s['flagged'])` over 982 entries. (Recounted at verification: identical shares, 982 unique ids, 16 distinct patterns.)
  - [src/patterns/purple-accent.js @ 2e602d9dc8](https://github.com/AdrianKrebs/design-slop-cop/blob/2e602d9dc8/src/patterns/purple-accent.js) — Adrian Krebs, 2026-06-18, accessed 2026-09-30 — tool source (read at verification).
    - "// Only fire when purple shows up as a real filled accent on a CTA."
- **Limits / false positives:**
  - Show HN pages carry no AI or human labels, and there is no pre-LLM baseline.
  - This is the detector version from before its false-positive fixes (F12).
  - The blog text is internally inconsistent: it says "~1400" and also "1,590" pages, and 16 patterns while the repository README says 14.

### FD10-F12 — Krebs's public tell detector dropped detectors that fired on clean sites and reports about 5 to 10% false positives; anchor-weighted scoring spares professional sites
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - Krebs's design-slop-cop is not the only public deterministic detector: impeccable ships 61 deterministic rules that also run on rendered pages (F31), and isthatvibecoded.com scores sites from builder fingerprints and design patterns. Krebs's is the one with a published history of false-positive fixes. (corrected: the title called it "the only public deterministic tell detector")
  - On 2026-06-23 Krebs removed two detectors. `icon_card_grid` "fired more on clean sites than slop" and `all_caps_headings` "fired only on clean". This was validated against 24 hand-labelled verdicts, and clean-to-Clean agreement rose to 11 of 14 with 0 false "High" verdicts.
  - On 2026-07-04 one commit (6e2a45ce) both fixed false positives in six detectors (numbered-steps, hero-font-mix, slop-fonts, hero-eyebrow-pill, glassmorphism, centered-hero) and raised the High threshold from 5 to 6 patterns. Together these moved the High tier from 66 to 23 of 600 pages. He then lowered High back to 5 or more patterns (about 10% of the corpus). (corrected: the dossier credited the 66-to-23 drop to the fixes alone)
  - The README reports "~5–10% false positives" across about 150 labelled sites.
  - A separate public detector weights builder fingerprints (such as a Lovable script tag) far above design patterns.
- **Implication for /frontend:**
  - Validate every detector on labelled controls, and demote those that fire on human sites. The owner's T08 (three icon boxes) is the documented case.
  - Score co-occurrence in tiers and require an anchor before a verdict.
- **Evidence:**
  - [design-slop-cop commit f664585f](https://github.com/AdrianKrebs/design-slop-cop/commit/f664585f) — Adrian Krebs, 2026-06-23, accessed 2026-09-30 — commit message.
    - "Drop icon_card_grid (fired more on clean sites than slop) and all_caps_headings (fired only on clean). Now 14 patterns; keep perma_dark. This lifted clean→Clean agreement to 11/14 with 0 false \"High\" verdicts."
  - [commits 6e2a45ce, b88c08ea, 685c6532](https://github.com/AdrianKrebs/design-slop-cop/commits/HEAD) — 2026-07-04, accessed 2026-09-30.
    - "Retier: High now 6+ (was 5+), Medium 3-5" (6e2a45ce) · "High is now ~4% (was 11%), matching the raised threshold and tighter detection." (b88c08ea) · "Corpus: None 20% / Low 45% / Medium 25% / High 10%." (685c6532)
  - [design-slop-cop README](https://github.com/AdrianKrebs/design-slop-cop) — MIT, accessed 2026-09-30.
    - "Manual verification across ~150 labeled sites suggests ~5–10% false positives."
  - [Is That Vibe Coded?](https://isthatvibecoded.com/) — accessed 2026-09-30 — tool page (read through WebFetch).
    - "Design patterns, shadcn/ui, and domain age only corroborate; they can't drive the score without a stronger anchor signal already present, which is why professional sites using similar-looking modern tooling don't get flagged."
- **Limits / false positives:** The labelled sets are small (24 verdicts, 165 labels shipped), with a single maintainer and no independent replication.

### FD10-F13 — Web design was homogenizing before LLMs, with shared libraries as a strong predictor; critics note that tell studies lack a pre-2023 baseline
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - A CHI 2021 paper measured website snapshots from 2003 to 2019. It found designs "significantly more similar since 2007", with average layout distance down by more than 30% and by 43% between 2010 and 2019 (its results section gives 44% for 2010 to 2019). It named library overlap as a strong predictor of layout similarity, and discussed colour-scheme standardisation, mobile support and changes in the design process as further causes. (corrected: the title said homogenization was "driven by shared libraries"; the paper reports a predictor among several causes, which is correlational)
  - It also notes that familiar patterns can improve usability.
  - On Hacker News (333 points, 234 comments), commenters on Krebs's post noted that he did not score pre-2023 pages, and that the "AI traits" predate AI.
- **Implication for /frontend:**
  - Build a pre-2023 human control corpus, for example Wayback snapshots, so the checker measures "unchosen default" and not "AI-made".
  - Do not penalize conventions that help a jury understand the product quickly.
- **Evidence:**
  - [Investigating the Homogenization of Web Design: A Mixed-Methods Approach](https://aux.engineering.ucsc.edu/publications/Goree_Doosti_Crandall_Su-HomogenizationWebDesign-CHI21.pdf) — Goree, Doosti, Crandall, Su, CHI '21, DOI 10.1145/3411764.3445156, accessed 2026-09-30 — peer-reviewed paper (PDF pages 1 and 2 read).
    - "we show that designs have become significantly more similar since 2007, especially for page layouts where the average distance between sites decreased by over 30%."
    - "Our findings suggest that use of a few specific libraries is a strong predictor of layout similarity."
    - "we discuss causes of this homogenization including overlap in source code and libraries, color scheme standardization, and support for mobile devices." (abstract, added at verification)
  - [HN discussion 47864393](https://news.ycombinator.com/item?id=47864393) — accessed 2026-09-30 via the Algolia API — practitioner comments.
    - raincole: "they didn't use the same \"slop score\" to measure Show HN posts from <2023."
    - nomdep: "design patterns that were already very common before AI ... You can blame most of them on TailwindUI and shadcn."
- **Limits / false positives:** Goree's data stop in 2019. The HN comments are anecdotes.

### FD10-F14 — A 2026 preprint finds five generative UI tools converge in visual appearance and layout, while colour varies more
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - "Design Theater" rendered 120 interfaces (24 tasks by 5 tools: ChatGPT, Claude, Firebase Studio, Vercel v0, Bolt) as 1200×1200 screenshots.
  - It measured pairwise distance three ways:

    | Measure | Method | Range | Mean |
    |---|---|---|---|
    | DHI-Visual | UIClip | 0.119 to 0.151 | 0.137 |
    | DHI-Color | CIELCh histograms, Earth Mover's Distance | 20.6 to 39.7 | 31.9 |
    | DHI-Layout | OmniParser tree edit distance | 0.181 to 0.211 | 0.196 |

  - Claude and v0 were the most similar pair on both the visual and colour measures.
- **Implication for /frontend:**
  - Colour is the easiest axis to diversify. Layout convergence is the harder problem.
  - Derive the information architecture from the protocol's features, not from a landing-page template.
- **Evidence:**
  - [Design Theater: Evaluating the Gap Between User-Facing Design Reasoning and Implementation in Generative UI Tools](https://arxiv.org/abs/2607.22928) — Imteyaz, Imteyaz, Rajpal, Shaikh, Muller, Savage, arXiv v2 2026-07-31, accessed 2026-09-30 — preprint with data.
    - "when given the same prompt, generated interfaces showed narrow pairwise differences in visual appearance and layout organization, while color choices varied more widely."
- **Limits / false positives:**
  - This is a preprint with no human-designer baseline.
  - The tools were limited to plain HTML, CSS and JS without component libraries, which the authors say "may reduce output variation". The findings also restrict the result to the stated conditions.

### FD10-F15 — A peer-reviewed study finds AI UI tools pass basic WCAG but produce highly uniform designs; colour contrast is the most frequent, mostly cosmetic, violation
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - DIS '25 evaluated 90 UIs from Figma AI and Galileo (2 tools × 3 app types × 5 prompt types × 3 generations each; corrected: the dossier omitted the three generations, so its product came to 30). It reports "high uniformity across the generated UIs", which designers called "accessibility handcuffs".
  - Its Table 3 measures structural coherence across the generated UIs: mean similarity 0.88 (fitness app), 0.90 (recipes app) and 0.93 (financial app). (added at verification)
  - Colour contrast was the most frequent violation: 10 violations in 90 UIs (violation rate 0.111), 9 of them rated cosmetic and 1 a partial barrier. The four ratios the paper shows are 3.05:1, and 4.37, 4.46 and 4.47:1, the last three just under the threshold.
- **Implication for /frontend:**
  - harden's axe floor already catches these. /frontend's concern is uniformity.
  - Three of the four published examples fall just under 4.5:1, so aim well above the floor, for example 7:1 for body text on dark grounds (see F24). Four examples do not show that generated values cluster there. (corrected: "generated values cluster just under 4.5:1" overreached from four illustrative values)
- **Evidence:**
  - [Good Accessibility, Handcuffed Creativity: AI-Generated UIs Between Accessibility Guidelines and Practitioners' Expectations](https://mintviz.usv.ro/publications/2025.DIS.2.pdf) — Guriță, Vatavu, DIS '25, DOI 10.1145/3715336.3735691, accessed 2026-09-30 — peer-reviewed paper (read in full at verification: pypdf extracts 13 pages, while the `file` utility reports 6, which is likely why only part was read at first).
    - "Table 3: Structural coherence scores across all App-Type conditions, showing high similarity for content blocks, interaction controls, and structural elements of the evaluated UIs." · "Violation-Rate‡ 0.067 0.111 0.000 0.011 0.189"
    - "Our findings reveal that, while these tools consistently achieve basic accessibility compliance, they rely on homogenized design patterns, which can limit their effectiveness in addressing specialized user needs."
    - "contrast ratios of 4.37:1, 4.46:1, and 4.47:1, respectively, all falling just below WCAG's required 4.5:1 threshold"
- **Limits / false positives:** The tools generate mobile app mockups in Figma, not LLM code. The full 13-page paper is at the same URL; its similarity scores (Table 3) cover content blocks, interaction controls and structural elements, not visual style. (corrected: the dossier said the PDF ended before the similarity results)

### FD10-F16 — Suspected AI origin, not actual origin, lowers trust and ratings in adjacent domains
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - CHI 2019 describes a "Replicant Effect" for Airbnb host profiles. Only when participants saw a mix of AI- and human-written profiles did they mistrust those suspected to be AI.
  - Profiles rated "definitely human-written" scored M = 78.29, against M = 61.72 for "definitely AI-generated". Trust hit a floor once suspicion reached 4 on the 6-point scale.
  - A 2025 working paper on ad images found people detect AI ads at 64% accuracy. Ads perceived as human-made were rated higher on all effectiveness metrics, even when AI-generated.
- **Implication for /frontend:**
  - Tells matter because they trigger an AI attribution, and a jury judging many projects is a mixed-source setting.
  - The aim is to remove default cues. It is never to misrepresent how the work was made: event disclosure rules still apply.
- **Evidence:**
  - [AI-Mediated Communication: How the Perception that Profile Text was Written by AI Affects Trustworthiness](https://socialmedialab.sites.stanford.edu/sites/g/files/sbiybj22976/files/media/file/jakesch-chi19-ai-mediated.pdf) — Jakesch, French, Ma, Hancock, Naaman, CHI 2019, DOI 10.1145/3290605.3300469, accessed 2026-09-30 — peer-reviewed paper (pages 1, 8 and 9 read).
    - "Only when participants thought they saw a mixed set of AI- and human-written profiles, they mistrusted hosts whose profiles were labeled as or suspected to be written by AI."
  - [Consumer Evaluation and Visual Attribution of Realistic AI-Generated Advertisements](https://faculty.haas.berkeley.edu/zskatona/pdf/aiads.pdf) — Mengyao Huang, Zsolt Katona, 2025-06-29, accessed 2026-09-30 — working paper (abstract read).
    - "ads perceived as human-made receive significantly higher ratings across all effectiveness metrics even if they are AI-generated."
- **Limits / false positives:** The studies cover text profiles and ad images, not web UIs. I found no controlled study on specific UI tells.

### FD10-F17 — Em dashes: several frontier models produce 1.3 to 3.3 times the human essay mean, and Claude Opus 4.6 drops to 0.19 per 1,000 words when told to write plain prose
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - A March 2026 preprint gives these rates in unconstrained essays. The human baseline is 8 published essays (57,232 words): mean 3.23 per 1,000 words, median 3.83, range 0.33 to 17.12.

    | Model | Em dashes per 1,000 words |
    |---|---|
    | GPT-4.1 | 10.62 |
    | Claude Opus 4.6 | 9.09 |
    | Claude Sonnet 4 | 8.29 |
    | Claude Haiku 3.5 | 7.51 |
    | DeepSeek V3 | 6.95 |
    | GPT-4o | 4.12 |
    | Gemini 2.5 Pro | 3.53 |
    | GPT-5.4 | 1.43 |
    | Llama | 0 |

  - Under a prose-only instruction, Opus 4.6 fell to 0.19, while GPT-4.1 stayed at 9.10.
  - A pre-registered study of medRxiv preprints (posted on arXiv, N = 69,632 Discussion sections) found the share containing at least one em dash rose from 4.23% to 11.58% after ChatGPT, and reached 20.3% in 2025. (corrected: the dossier called it "a medRxiv study"; it is an arXiv preprint about medRxiv)
  - Wikipedia's guide says to use the sign only in combination with others. It summarizes a July 2026 Economist study: only Claude still exceeded professional writers.
  - Since September 2026, Wikipedia's em-dash section carries a banner proposing to move it to "Historical indicators", "as it seems to be less common in current LLM output". (added at verification)
  - OpenAI's CEO announced on 2025-11-14 that custom instructions now suppress em dashes.
- **Implication for /frontend:**
  - The builder is Claude, so em-dash density in UI copy is a live tell. Tell the model not to use em dashes, then check the rendered copy with /prose PR-01.
- **Evidence:**
  - [The Last Fingerprint: How Markdown Training Shapes LLM Prose](https://arxiv.org/abs/2603.27006) — E. M. Freeburg, arXiv 2026-03-27, accessed 2026-09-30 — preprint with data (HTML table read).
    - "the weighted mean across our sample was 3.23 per 1,000 words (median 3.83; range 0.33–17.12)"
  - [Em-ergence of the em-dash ... medRxiv preprints](https://arxiv.org/abs/2606.29540) — Przemysław Czuma, arXiv 2026-06-28, accessed 2026-09-30 — pre-registered preprint (abstract).
    - "Em-dash prevalence in Discussion sections rose from 4.23% before ChatGPT to 11.58% afterward" · "The em-dash is a population-level indicator, not a per-paper detector of LLM use"
  - [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — Wikipedia editors, revision 1377577399 (2026-09-30T01:51:09Z), accessed 2026-09-30 — community guide.
    - "This sign is most useful when taken in combination with other indicators, not by itself." · "A July 2026 study found that of contemporary models only Claude used em dashes more than professional writers, and ChatGPT used them less."
    - "If more recent examples of this AI sign can't be found, it should probably be moved to {{slink|#Historical indicators}}, as it seems to be less common in current LLM output. (September 2026)" (wikitext of the same revision, read at verification)
  - [Sam Altman on X](https://x.com/sama/status/1989193813043069219) — Sam Altman, 2025-11-14, accessed 2026-09-30 via `api.fxtwitter.com` — social post.
    - "If you tell ChatGPT not to use em-dashes in your custom instructions, it finally does what it's supposed to do!"
- **Limits / false positives:**
  - Both studies are preprints, and the human baseline is small and in the essay genre.
  - I read the Economist study only through Wikipedia's summary (paywalled).
  - Per-page UI copy is short, so its rates are noisy.

### FD10-F18 — Em-dash thresholds differ about fivefold across tools, and most source-level em dashes in the owner's past frontends sit in code comments
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Four sources set different bars:
    - /prose PR-01 fires above 2.0 per 1,000 words (per the brief).
    - impeccable fires at 8 or more em dashes and at least one per 500 characters of body text. It counts `—`, or `--` followed by non-space.
    - taste-skill bans em dashes completely.
    - Wikipedia says AI em dashes are usually spaced. A preprint on Congress press releases tracked the unspaced form, because AP style there uses spaced dashes.
  - By my estimate (5 to 6 characters per word), one dash per 500 characters is about 10 to 12 per 1,000 words, roughly five times PR-01.
  - My heuristic split of em dashes in the owner's frontends:

    | Project | Total | In comments | Elsewhere |
    |---|---|---|---|
    | XRPL_Hackathon_2026/app | 186 | ~132 | ~54 |
    | Monad_Blitz_Paris/auramaxx/web | 77 | ~27 | ~50 |
    | ETHDenver/agentfi/frontend | 48 | ~43 | ~5 |

- **Implication for /frontend:**
  - Count rendered text (`innerText`), or JSX text nodes and string literals. Never count whole source files.
  - Use one threshold, PR-01 calibrated on the /prose control corpus, and report em-dash labels such as "WORD — fragment" separately.
- **Evidence:**
  - [impeccable crates/foundation/src/rules/text.rs and crates/core/src/checks/text_rules.rs](https://github.com/pbakaus/impeccable/tree/main/crates) — Paul Bakaus, HEAD 909726c7e8, Apache-2.0, accessed 2026-09-30 — tool source.
    - `pub const EM_DASH_FLOOR: usize = 8;` · `pub const EM_DASH_CHARS_PER_DASH: usize = 500;` · `if utf16_len(&body) > count * EM_DASH_CHARS_PER_DASH { return vec![]; }`
  - [taste-skill SKILL.md](https://github.com/leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — leonxlnx, last changed 2026-05-26 (3c7017d636), accessed 2026-09-30 — skill file.
    - "**Em-dash (`—`) is COMPLETELY banned.**"
  - [The em-dash em-beds in Congress](https://arxiv.org/abs/2608.05889) — Przemysław Czuma, arXiv 2026-08-06, accessed 2026-09-30 — preprint (abstract).
    - "especially the unspaced form word---word, which is normal in typeset English prose but unusual in U.S. press writing, where AP style calls for spaced dashes."
  - Local scan — my command, 2026-09-30: `python emdash_split.py` (copy kept at `research/_scripts/fd10/emdash_split.py`), a read-only walk of the owner's `Coding/` frontends that skips node_modules and `.env*`.
    - `XRPL_Hackathon_2026/app: total=186 in_comments~=132 non_comment~=54`
- **Limits / false positives:**
  - The comment split is a line heuristic (strings containing `//` may be misclassified).
  - The conversion to words is an estimate.
  - Quoted text, names and date ranges can legitimately contain dashes.
  - Verification note: re-running `emdash_split.py` reproduced every number (also Monad_ETHDenver 17 / ~14 / ~3 and Hackathon_SUI 11 / ~6 / ~5; across the five projects about 222 of 339 are in comments). A random sample of 18 XRPL lines was mostly CSS, JSDoc and `//` comments. One non-comment hit was `'—'`, a placeholder for an empty value, which a copy check must not count as prose. impeccable's rule runs on rendered body text ("over already-rendered text"), not on source.

### FD10-F19 — Buzzword lists exist (impeccable's 29 phrases, Wikipedia's words to watch), but the list approach found zero hits in the owner's past frontends
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - impeccable's `BUZZWORDS` includes "streamline your", "empower your", "supercharge your", "unleash the power", "built for the modern", "trusted by leading", "best-in-class", "world-class", "enterprise-grade", "next-generation", "cutting-edge", "revolutionize", "game-changer", "seamless experience", "seamlessly integrate" and "harness the power". It fires on any occurrence.
  - Wikipedia lists promotional words ("boasts a, vibrant, rich, profound, enhancing, showcasing, exemplifies, commitment to, ... groundbreaking, renowned, featuring, diverse array") and notes that overused vocabulary shifts over time.
  - My static regex (a subset of these phrases) found 0 hits across the owner's 8 frontends.
- **Implication for /frontend:**
  - List matching will miss the owner's real copy problem. The owner's copy failure is probably vagueness about the protocol rather than SaaS clichés (a hypothesis).
  - Check specificity: does each hero and feature line name the mechanism, the user, a number or a sponsor?
  - Route copy through /prose, and keep the impeccable list as a cheap tier-2 check.
- **Evidence:**
  - [impeccable crates/detect/src/regex_matchers.rs](https://github.com/pbakaus/impeccable/blob/main/crates/detect/src/regex_matchers.rs) — Paul Bakaus, accessed 2026-09-30 — tool source.
    - `"built for the modern",` `"trusted by leading",` `"seamless experience",` `"harness the power",`
  - [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — revision 1377577399, accessed 2026-09-30.
    - "The words that LLMs overuse have changed over time."
- **Limits / false positives:**
  - My scan covered only `.tsx`, `.jsx`, `.ts`, `.js`, `.css`, `.scss`, `.html` and `.mdx`. Copy in JSON or CMS files was not scanned.
  - Quoting a sponsor's own tagline is legitimate.

### FD10-F20 — The "tell fonts" have documented release dates and appear on three independent lists; brand fonts on human sites are the false positives
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Google Fonts `date_added`:

    | Font | Added |
    |---|---|
    | Inter | 2020-01-24 |
    | Space Grotesk | 2020-10-07 |
    | Fraunces | 2020-10-29 |
    | Instrument Serif | 2023-03-22 |
    | Bricolage Grotesque | 2023-06-15 |
    | Geist | 2024-10-02 |

  - Three lists flag these fonts:
    - impeccable's `OVERUSED_FONT_RE` matches `font-family:` starting with one of 17 families: Inter, Roboto, Open Sans, Lato, Montserrat, Arial, Helvetica, Fraunces, Geist Sans, Geist Mono, Geist, Mona Sans, Plus Jakarta Sans, Space Grotesk, Recoleta, Instrument Sans, Instrument Serif.
    - Krebs's detector triggers only when the font is the heading font or at least 25% of text.
    - taste-skill bans Fraunces and Instrument Serif as defaults, but recommends Geist over Inter.
  - A practitioner reports that Claude especially favours serif heroes.
  - vercel.com preloads `Geist_Variable` (its own brand font) and stripe.com preloads `Sohne` (I observed this in their HTML).
- **Implication for /frontend:**
  - Detect fonts at runtime from the computed `font-family` on headings and body, plus `document.fonts`.
  - A list hit is a question ("was this chosen from the research?"), not a verdict. Allowlist brand-mandated fonts with a written reason.
- **Evidence:**
  - [google/fonts ofl/instrumentserif/METADATA.pb](https://github.com/google/fonts/blob/main/ofl/instrumentserif/METADATA.pb) (and spacegrotesk, inter, geist, fraunces, bricolagegrotesque) — Google Fonts, accessed 2026-09-30 — metadata files.
    - `date_added: "2023-03-22"` (Instrument Serif) · `date_added: "2020-10-07"` (Space Grotesk)
  - [impeccable regex_matchers.rs](https://github.com/pbakaus/impeccable/blob/main/crates/detect/src/regex_matchers.rs) — accessed 2026-09-30.
  - [design-slop-cop src/patterns/slop-fonts.js](https://github.com/AdrianKrebs/design-slop-cop/blob/HEAD/src/patterns/slop-fonts.js) — accessed 2026-09-30.
    - `minTotalPct: 25`
  - [Signs of vibe coded UI](https://x.com/yuwen_lu_/status/2041187936738447565) — Yuwen Lu, 2026-04-06 (72,743 views when read), accessed 2026-09-30 via `api.fxtwitter.com` article JSON — practitioner article.
    - "AI models, especially Claude, seem to love them nowadays. Now many AI-generated websites have a Serif hero section"
- **Limits / false positives:** The lists disagree. Geist is "overused" for impeccable and recommended by taste-skill.

### FD10-F21 — Accent-stripe cards are widely asserted as a tell but have low measured prevalence; precise detectors exist
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - Krebs quotes an unnamed designer: "colored left borders are almost as reliable a sign of AI-generated design as em-dashes for text". impeccable calls the side tab "the most recognizable tell of AI-generated UIs".
  - A practitioner locates the mechanism in a `border-left` plus a `border-radius` on the same container.
  - The detectors are specified:
    - impeccable (static): `border-[lrse]-N` fires at N ≥ 2 when a `rounded` class appears on the same source line and N ≥ 4 otherwise. CSS `border-left` or `border-right` must be at least 3px, or 2px with a radius on the same line, and neutral colours and "safe" elements are excluded. (corrected: impeccable tests the line, not the element)
    - Krebs (runtime): the left or the top border (only those two edges) at least 2px and more than 1px wider than each other side, with colour alpha ≥ 0.3 and saturation ≥ 0.2. The element must be at least 40×20 and contain a heading, a title- or heading-class child, or a prominent text leaf. Blockquotes, footers, tables, buttons and rules are skipped, including inside a blockquote or footer. It also detects `::before` and `::after` stripes of 2 to 10px on the left or top edge. (corrected: the dossier said "one side")
  - The measured prevalence is 5.6% (F11), and a HN reader called the designer quote "n=1 plus Baader-Meinhof".
- **Implication for /frontend:** Keep this detector, but only with Krebs's exclusions. The fix is to remove the stripe; if it encodes status, add a label.
- **Evidence:**
  - [Scoring Show HN submissions for AI design patterns](https://www.adriankrebs.ch/blog/design-slop/) — Adrian Krebs, 2026-04-20, accessed 2026-09-30.
    - "A designer recently told me that “colored left borders are almost as reliable a sign of AI-generated design as em-dashes for text”"
  - [impeccable antipatterns.json](https://github.com/pbakaus/impeccable/blob/main/crates/live/assets/antipatterns.json) — last changed 2026-09-21 (9f42da8e18), accessed 2026-09-30 — tool catalogue (61 entries: 32 "slop", 29 "quality").
    - "Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs."
  - [design-slop-cop src/patterns/accent-stripe.js](https://github.com/AdrianKrebs/design-slop-cop/blob/HEAD/src/patterns/accent-stripe.js) — accessed 2026-09-30.
    - `excludedTags: 'BLOCKQUOTE,FOOTER,BUTTON,HR,TABLE,TD,TH,TR,THEAD,TBODY'`
  - [Signs of vibe coded UI](https://x.com/yuwen_lu_/status/2041187936738447565) — Yuwen Lu, 2026-04-06, accessed 2026-09-30.
    - "It shows up because both a `border-left` and a `border-radius` are applied to the container."
- **Limits / false positives:**
  - The cause is not established, and there is no perception measurement.
  - Callouts, active tabs, timeline rails and severity levels are legitimate uses.

### FD10-F22 — Glassmorphism is a 2020 human design trend with legitimate uses, rarely named by Reddit users; its detector must exclude frosted navigation bars
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - Michal Malewicz coined the term on 2020-11-22 and defined it as background-blur transparency, floating layers, vivid colours and "a subtle, light border".
  - Apple's Liquid Glass (2025-06-09) makes translucent material a platform style.
  - A practitioner (Yuwen Lu, F20) says of glass: "If this texture is paired with a gradient background and a 1px, light border, I'm mostly certain that it is AI." (corrected: the dossier paraphrased "mostly certain" as "almost certainly")
  - Reddit comments name glass in 0.2% of cases (F10), yet the Show HN prevalence is 14.1% (F11).
  - Krebs's detector requires a computed `backdrop-filter` blur of at least 2px and a background alpha between 0.02 and 0.9. The panel must be card-sized: width 150 to 820px and height 40 to 900px. It skips sticky full-width top and bottom bars ("common in non-slop design (Linear, Vercel, GitHub)").
- **Implication for /frontend:**
  - Flag the co-occurrence (glass card, vivid gradient ground and light 1px border), not any use of `backdrop-filter`.
  - Allow frosted navigation, overlays on imagery, and visionOS-like product demos.
- **Evidence:**
  - [Glassmorphism in user interfaces](https://uxdesign.cc/glassmorphism-in-user-interfaces-1f39bb1308c9) — Michal Malewicz, UX Collective, 2020-11-22, accessed 2026-09-30 via Exa fetch — practitioner article (the term's origin).
    - "- Transparency (frosted-glass effect using a Background Blur) - Multi-layered approach with objects floating in space - Vivid colors to highlight the blurred transparency - A subtle, light border on the translucent objects."
  - [Apple introduces a delightful and elegant new software design](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) — Apple, 2025-06-09, accessed 2026-09-30 — vendor press release (read through WebFetch).
    - "This translucent material reflects and refracts its surroundings, while dynamically transforming to help bring greater focus to content"
  - [design-slop-cop src/patterns/glassmorphism.js](https://github.com/AdrianKrebs/design-slop-cop/blob/HEAD/src/patterns/glassmorphism.js) — accessed 2026-09-30.
    - "// Excludes sticky nav/footer bars; those frosted headers are common in non-slop design (Linear, Vercel, GitHub)."
  - [Signs of vibe coded UI](https://x.com/yuwen_lu_/status/2041187936738447565) — Yuwen Lu, 2026-04-06, accessed 2026-09-30 via `api.fxtwitter.com` article JSON — practitioner article (source added at verification).
    - "This, in my opinion, is becoming the new purple gradient." · "If this texture is paired with a gradient background and a 1px, light border, I'm mostly certain that it is AI."
- **Limits / false positives:** The perception evidence is thin, and the owner's list weights glass above what the data support.

### FD10-F23 — Purple and gradient detection must cover Tailwind v4 syntax and computed colours; purple is reported to be fading from Claude output
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Tailwind v4 defines `bg-linear-*` in `utilities.ts` and keeps `bg-gradient-to-*` only in `compat/legacy-utilities.ts`. A regex that matches only `bg-gradient-to-` misses v4-native code. impeccable's own gradient-text rule has this gap: it pairs `bg-clip-text` with `bg-gradient-to-` only (`BG_GRADIENT_TO_RE`). (added at verification)
  - impeccable's static rules:
    - `from-(purple|violet|indigo)-N` combined with `to-(purple|violet|indigo|blue|cyan|pink|fuchsia)-N` flags a gradient.
    - `text-(purple|violet|indigo)-N` flags heading text in a heading context (`text-[2-9]xl` or `<h1` to `<h3`).
    - `bg-clip-text` plus `bg-gradient-to-` flags gradient text.
  - Krebs's `isPurple` accepts HSL hue 250 to 300, saturation above 0.25 and lightness between 0.15 and 0.85, at alpha 0.3 or more. The pattern fires only on a filled CTA.
  - A practitioner wrote in April 2026 that "Claude no longer generates purple gradients". Krebs's 6.1% (F11) counts filled purple CTAs only, so it does not measure purple gradients and cannot confirm that claim. (corrected: the dossier presented 6.1% as the prevalence of purple in general)
- **Implication for /frontend:**
  - Match both utility spellings and parse computed colours.
  - For a Claude build, weight a filled purple CTA low, measure purple gradients separately on the owner's corpus, and watch the replacement palettes (F04).
- **Evidence:**
  - [tailwindcss packages/tailwindcss/src/utilities.ts](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/utilities.ts) and [compat/legacy-utilities.ts](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/compat/legacy-utilities.ts) — Tailwind Labs, accessed 2026-09-30 — source.
    - `utilities.functional('bg-linear', handleBgLinear({ negative: false }))` · ``designSystem.utilities.static(`bg-gradient-to-${value}`, () => [``
  - [impeccable regex_matchers.rs](https://github.com/pbakaus/impeccable/blob/main/crates/detect/src/regex_matchers.rs) — accessed 2026-09-30.
    - `re!(BG_CLIP_TEXT_RE, format!("{B}bg-clip-text{B}"));` · `format!("{B}to-(?:purple|violet|indigo|blue|cyan|pink|fuchsia)-{D}+{B}")` · `re!(BG_GRADIENT_TO_RE, format!("{B}{}", ci("bg-gradient-to-")));` (909726c7e8, read at verification)
  - [design-slop-cop src/lib/color.js](https://github.com/AdrianKrebs/design-slop-cop/blob/HEAD/src/lib/color.js) — accessed 2026-09-30.
    - `return hsl.h >= 250 && hsl.h <= 300 && hsl.s > 0.25 && hsl.l > 0.15 && hsl.l < 0.85;`
  - [Signs of vibe coded UI](https://x.com/yuwen_lu_/status/2041187936738447565) — Yuwen Lu, 2026-04-06, accessed 2026-09-30.
    - "Claude no longer generates purple gradients, I'm so glad we are past that."
- **Limits / false positives:** Purple is a legitimate brand colour, including for some web3 sponsors. Check the sponsor's documented palette before flagging.

### FD10-F24 — On dark grounds, Tailwind's default mid-grey text steps fail AA, and a share-below-7:1 check captures the "muted grey" aesthetic
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - I computed WCAG 2 contrast from the Tailwind v3 hex values:

    | Text on ground | Contrast |
    |---|---|
    | `text-gray-500` on `gray-900` | 3.67:1 |
    | `slate-500` on `slate-900` | 3.75:1 |
    | `zinc-500` on `zinc-950` | 4.12:1 |
    | `gray-500` on `#0a0a0a` | 4.10:1 |
    | `zinc-600` on `zinc-950` | 2.57:1 |
    | the `-400` steps on the same grounds | 6.96 to 7.80:1 (gray-400 on gray-900 6.99, slate-400 on slate-900 6.96, zinc-400 on zinc-950 7.76, gray-400 on `#0a0a0a` 7.80) |
    | `white/40` on `#0a0a0a` | 3.77:1 |
    | `white/60` on `#0a0a0a` | 7.30:1 |

  - Krebs's perma-dark detector fires when the page body is dark (luminance below 0.2) and at least 12% of body-text leaves (12 to 20px, weight below 600) sit below 7:1. It excludes code blocks, and a "dark template" path also exists.
- **Implication for /frontend:**
  - harden owns the AA floor. /frontend adds the check on the share of text below 7:1, and should default secondary text on dark grounds to the -300 steps. The -400 steps clear 7:1 only on the darkest grounds (`zinc-950`, `#0a0a0a`); on `gray-900` and `slate-900` they sit at 6.99 and 6.96:1 and would trip the same check. (corrected: the dossier recommended "-300 or -400" without noting that -400 fails its own 7:1 check on the 900 grounds)
- **Evidence:**
  - [tailwindcss v3.4.17 colors.js](https://github.com/tailwindlabs/tailwindcss/blob/v3.4.17/src/public/colors.js) — accessed 2026-09-30.
    - `500: '#6b7280',` (gray) · `900: '#111827',` (gray)
  - Local computation — my command, 2026-09-30: a Python WCAG relative-luminance function run over the pairs above.
    - `gray-500 on gray-900: 3.67:1` · `zinc-500 on zinc-950: 4.12:1` · `white/40 on #0a0a0a -> rgb(108, 108, 108): 3.77:1`
  - [design-slop-cop src/patterns/perma-dark-mode.js](https://github.com/AdrianKrebs/design-slop-cop/blob/HEAD/src/patterns/perma-dark-mode.js) — accessed 2026-09-30.
    - `pctBelowAAATrigger: 12,` · `darkSurfaceLuminance: 0.2,`
  - [design-slop-cop src/detector.js](https://github.com/AdrianKrebs/design-slop-cop/blob/e2fab6ce71/src/detector.js) — accessed 2026-09-30 — tool source (read at verification; this is where the body test lives).
    - `const isDarkMode = bodyLuminance < 0.2;`
  - Recomputed at verification with an independent WCAG function: every ratio in the table reproduced, including 6.99 (gray-400 on gray-900), 6.96 (slate-400 on slate-900) and 7.80 (gray-400 on `#0a0a0a`).
- **Limits / false positives:**
  - Dark themes are legitimate for trading, IDE-like and video products.
  - I did not evaluate APCA. The 12% threshold is Krebs's and not independently validated.

### FD10-F25 — Motion tells have testable rules, and runtime detection needs instrumentation installed before page scripts run
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Anthropic (2026-09-03) says per-section fade-and-slide-up entrances and hover transitions on every card "read as AI-generated".
  - Emil Kowalski's skill rules:
    - Actions seen tens of times a day, including hover effects, should have their animation removed or drastically reduced.
    - "If the purpose is just 'it looks cool' and the user will see it often, don't animate."
    - Gate hover styles with `@media (hover: hover) and (pointer: fine)`.
    - Scroll reveals should use `{ once: true }`.
  - A practitioner reports that appear animations "gets buggy when we scroll down but the cards do not appear in viewport". impeccable flags "content-hidden-at-rest", which it calls the failed-reveal signature.
  - Four tool facts shape runtime detection:
    - Playwright's `addInitScript` runs "after the document was created but before any of its scripts were run".
    - `emulateMedia` accepts `reducedMotion: "reduce"`.
    - `document.getAnimations()` returns only CSS Animations, CSS Transitions and Web Animations, so it misses animation loops driven by `requestAnimationFrame`.
    - CDP `DOMDebugger.getEventListeners` lists listeners, but React 17+ attaches handlers to the root container, not to each element.
- **Implication for /frontend:**
  - Runtime checks need four parts:
    1. Measure the ratio of content hidden at rest before and after a scroll-through.
    2. Wrap IntersectionObserver in an init script to count observed targets.
    3. Diff CTA styles on hover to detect alpha-only fades.
    4. Find cursor effects from a pointer-move listener plus a behavioural diff under a synthetic mouse path.
  - Content must render with `reducedMotion: "reduce"`.
- **Evidence:**
  - [emilkowalski/skill skills/emil-design-eng/SKILL.md](https://github.com/emilkowalski/skill/blob/main/skills/emil-design-eng/SKILL.md) — Emil Kowalski, last changed 2026-09-15 (85e8e2363b), accessed 2026-09-30 — skill file.
    - "| Tens of times/day (hover effects, list navigation)          | Remove or drastically reduce |"
  - [Playwright Page API](https://playwright.dev/docs/api/class-page) — Microsoft, accessed 2026-09-30 — official docs (read through WebFetch).
    - "The script is evaluated after the document was created but before any of its scripts were run."
  - [MDN Document.getAnimations()](https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations) — Mozilla, accessed 2026-09-30 — official docs.
    - "This array includes CSS Animations, CSS Transitions, and Web Animations."
  - [devtools-protocol browser_protocol.json](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json) — Chrome DevTools, accessed 2026-09-30 — protocol definition.
    - `"name": "getEventListeners", "description": "Returns event listeners of the given object."` (EventListener fields: type, useCapture, passive, once, scriptId, lineNumber, columnNumber, handler, originalHandler, backendNodeId)
  - [React v17.0 release post](https://legacy.reactjs.org/blog/2020/10/20/react-v17.html) — React team, 2020-10-20, accessed 2026-09-30 — official blog (read through WebFetch).
    - "React 17 will call `rootNode.addEventListener()` under the hood instead."
  - [impeccable antipatterns.json](https://github.com/pbakaus/impeccable/blob/main/crates/live/assets/antipatterns.json) — accessed 2026-09-30.
    - "This is the failed-reveal signature: the content shipped but never becomes visible."
- **Limits / false positives:**
  - The behavioural thresholds are unvalidated.
  - One orchestrated load sequence, or a scroll-driven diagram that explains the protocol's mechanism, is a legitimate purpose under Emil's rules.

### FD10-F26 — The three icon boxes and the headline badge are common in human templates; measured prevalence and a precise badge detector exist
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - Krebs's icon-card grid fired on 22.9% of Show HN pages, but it was dropped for firing more on clean sites (F12). Bootstrap's 2021 example shows the same pattern (F09).
  - The headline-badge detector fired on 16.9%. It looks up to 220px above the H1 for a 40 to 600px wide, 16 to 56px tall label of 6 words or fewer. The label can be a pill (radius at least half its height) with a fill of alpha ≥ 0.05 or a border ≥ 1px, a boxed label, or uppercase text with letter-spacing ≥ 0.5px and width ≤ 320px. Nav elements, links and buttons are skipped.
  - taste-skill calls eyebrows "the #1 violated rule in production tests" and bans version labels such as `v2.0` or `BETA` as default eyebrows.
  - A practitioner describes icons or emoji "wrapped in a small colored box" as present in almost any AI design.
- **Implication for /frontend:**
  - T08 should not be a standalone blocking detector; report it only in combination.
  - T09 is detectable with Krebs's geometry. A badge that carries a real, checkable status (live on testnet with a link to the contract, or a release linked to its changelog) is legitimate.
- **Evidence:**
  - [design-slop-cop src/patterns/hero-eyebrow-pill.js](https://github.com/AdrianKrebs/design-slop-cop/blob/HEAD/src/patterns/hero-eyebrow-pill.js) — accessed 2026-09-30.
    - `abovePillPx: 220,` `pillMinH: 16, pillMaxH: 56,` `smallcapsMaxW: 320,`
  - [taste-skill SKILL.md](https://github.com/leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — accessed 2026-09-30.
    - "**NO version labels in the hero.** `V0.6`, `v2.0`, `BETA`, `INVITE-ONLY PREVIEW`, `EARLY ACCESS`, `ALPHA` - banned as default eyebrows."
  - [Signs of vibe coded UI](https://x.com/yuwen_lu_/status/2041187936738447565) — Yuwen Lu, 2026-04-06, accessed 2026-09-30.
    - "Wherever you usually put a visual asset, you see a font awesome icon or an emoji wrapped in a small colored box."
- **Limits / false positives:** Real feature triplets, pricing tiers and category labels are legitimate uses.

### FD10-F27 — Sources disagree on the direction of the spacing tell (inconsistent vs monotonous), and no validated spacing detector was found
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - The owner's list names inconsistent spacing.
  - Anthropic warns that generated CSS classes "cancel each other out ... often with padding/margin between sections".
  - impeccable flags the opposite: "monotonous-spacing" ("The same spacing value used everywhere"). It also flags "heading-rhythm" (the space above a heading should exceed the space below it).
  - Tailwind's spacing unit is `--spacing: 0.25rem` (4px).
  - No public tool I found measures spacing inconsistency against human controls.
- **Implication for /frontend:** Ship three report-only checks until they are calibrated:
  1. The share of computed margin, padding and gap values off the 4px grid, and the count of distinct section paddings (inconsistency).
  2. One dominant gap value (monotony).
  3. Heading rhythm.
- **Evidence:**
  - [anthropics/skills frontend-design SKILL.md @ 41bbe19](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md) — accessed 2026-09-30.
    - "It's easy to generate CSS classes that cancel each other out (especially with a type-based selector like .section and an element-based selector like .cta). This can happen often with padding/margin between sections."
  - [impeccable antipatterns.json](https://github.com/pbakaus/impeccable/blob/main/crates/live/assets/antipatterns.json) — accessed 2026-09-30.
    - "The same spacing value used everywhere — no rhythm, no variation."
  - [tailwindcss main theme.css](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/theme.css) — accessed 2026-09-30.
    - `--spacing: 0.25rem;`
- **Limits / false positives:** `clamp()`-based fluid spacing and optical adjustments produce values off the grid legitimately.

### FD10-F28 — Published lists add tells absent from the owner's 20, mostly Claude-era template chrome and fabricated social proof
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - Tells named across Anthropic (F04), impeccable (61 entries), taste-skill, Krebs and practitioner lists, but not in the 20:
    - the cream palette, ALL-CAPS eyebrows and numbered 01/02/03 markers;
    - FAQ accordions (15.5% prevalence) and stat banners with invented numbers (4.6%);
    - fake testimonials and "Trusted by" logo walls, nested cards, logo marquees and bento grids (contested);
    - colored glows and radial halos (5.5%), the SaaS-card kit, and a near-black ground with zinc text;
    - "→" suffixes, middle-dot meta strings and monospace micro-labels;
    - decorative grid backgrounds, pulsing status dots and blinking cursors;
    - SVG illustrations built from primitive shapes, `div`-built fake screenshots, and the "Get started" plus secondary CTA hero;
    - the phrase "built for the modern".
  - The Design type forbids invented stats. taste-skill forbids generic names ("John Doe", "Sarah Chan") and "fake-perfect numbers".
- **Implication for /frontend:**
  - Add these as the M series in the catalogue.
  - Fabricated testimonials, logos or usage numbers are also a truthfulness problem before a jury. The skill must use placeholders or real, sourced data only.
- **Evidence:**
  - [impeccable antipatterns.json](https://github.com/pbakaus/impeccable/blob/main/crates/live/assets/antipatterns.json) — accessed 2026-09-30 (entries `nested-cards`, `marquee`, `pulsing-dot`, `blinking-cursor`, `codex-grid-background`, `shape-assembled-illustration`, `radial-halo`, `numbered-section-labels`, `kicker-above-heading`, `cream-palette`).
    - "Continuously auto-scrolling content demands attention it has not earned and hides half its content at any moment."
  - [taste-skill SKILL.md](https://github.com/leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — accessed 2026-09-30.
    - "**NO generic names.** \"John Doe\", \"Sarah Chan\", \"Jack Su\"" · "**NO fake-perfect numbers.** Avoid `99.99%`, `50%`, `1234567`."
  - [design-slop-cop src/patterns/stat-banner.js](https://github.com/AdrianKrebs/design-slop-cop/blob/HEAD/src/patterns/stat-banner.js) — accessed 2026-09-30.
    - `// Stat banner row. "10K+ users · 99.9% uptime · 4.9★" pattern: 3–6 sibling`
- **Limits / false positives:**
  - Most of these are practitioner assertions.
  - taste-skill recommends marquees, Geist and zinc-950, which impeccable or Anthropic flag (see Contradictions).

### FD10-F29 — A static scan of the owner's 8 past hackathon frontends: shadcn defaults, Lucide, backdrop blur and alpha hovers dominate; purple gradients are nearly absent
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - A read-only regex scan of 511 source files across 8 projects, skipping node_modules, build output and `.env*`, found the following. Counts are regex matches.

    | Tell | Projects hit | Match counts where hit |
    |---|---|---|
    | shadcn default markers (`data-slot=` or `hover:bg-primary/90`) | 5 of 8 heavily, plus 1 project with a single match | 311, 81, 259, 252, 248 (and 1) |
    | `lucide-react` imports | 6 of 8 | 25, 8, 7, 6, 1, 11 |
    | backdrop blur | 7 of 8 | |
    | hover opacity or alpha classes | 6 of 8 | |
    | gradient text | 3 of 8 | 6, 6, 11 |
    | Inter font imports | 4 of 8 | |
    | Space Grotesk or Instrument Serif | 1 of 8 (Monad Blitz, auramaxx) | 11 |
    | grain or noise | 1 of 8 (XRPL 2026) | 6 |
    | purple-to-blue gradient classes | 1 of 8 (BaseBatches) | 1 |

  - Em dashes are in F18.
  - Four patterns had zero static hits: emoji inside heading tags, serif-plus-italic classes, the buzzword subset, and scroll reveals (except 3 matches in two projects).
- **Implication for /frontend:**
  - The strongest candidates for the owner's recurring failure modes are T10 (Lucide) and T14 (alpha or opacity hovers), plus shadcn usage for T11. These projects form the positive corpus the checker must fire on.
  - Three of the source counts do not yet show a rendered tell:
    - `data-slot=` shows that shadcn is present, not that its tokens are untouched (T11 needs the token comparison in S11).
    - The backdrop-blur count includes frosted navigation bars, which F22 treats as legitimate (T06).
    - Most source em dashes are in comments (F18), so T16 needs a rendered-copy count.
  - (corrected: the dossier listed T11, T10, T06, T14 and T16 as the owner's "actual recurring failure modes" on source counts alone)
  - Zero static hits do not clear a tell: emoji and serif accents can come from data arrays or components, so runtime checks are needed.
- **Evidence:**
  - Local scan — my command, 2026-09-30: `python scan_tells.py` (copy kept at `research/_scripts/fd10/scan_tells.py`) over
    - `Coding/XRPL_Hackathon/hackathon-rwa`
    - `XRPL_Hackathon_2026/app`
    - `Hackathon_SUI/repo/web`
    - `Hackathon_SUI/Insurance DApp Frontend Design`
    - `Monad_Blitz_Paris/auramaxx/web`
    - `Monad_Hackathon/Monad_ETHDenver/frontend`
    - `ETHDenver/agentfi/frontend`
    - `BaseBatches/spark-onchain-app/apps/web`
    - Output rows: `T11 shadcn default hover/data-slot | 311 | 81 | 259 | 252 | 0 | 1 | 0 | 248` · `T10 lucide-react import | 25 | 8 | 7 | 0 | 0 | 6 | 1 | 11` · `T01 purple->blue gradient | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1`
- **Limits / false positives:**
  - The regexes are unvalidated and count source matches, not rendered instances. Some matches come from unrendered or vendored components.
  - I assumed that these folders are the owner's own frontends and not forks. The owner should confirm.
  - Verification note: re-running `scan_tells.py` on 2026-09-30 reproduced every row quoted here, with 511 source files (101, 48, 83, 55, 19, 50, 71, 84). The T14 regex also matches shadcn's `hover:bg-primary/90`, so T11 and T14 counts overlap.

### FD10-F30 — A widely repeated statistic ("78% of marketing sites use blue-purple gradients") is unsupported, and a corrupted mirror circulates altered numbers
- **Grade:** D · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - A 2026 GitHub catalogue states: "One 2026 crawl put blue-purple gradient prevalence at roughly 78 percent of indexed marketing sites, up from about 10 percent in 2020".
  - The vendor report it appears to draw on labels a comparable table as approximate Tailwind blue adoption, without a method. That report also warns that such statistics are "mostly bad, mostly self-reported".
  - A mirror of the catalogue on cephalochromoscope.net alters the text. It gives "69 percent ... 30 percent", invents Tailwind classes (`violet-511` `#5265F1`) and dates ("in 2029"), and inverts "Do not use this list to harass people" into "Do use this list to harass people".
- **Implication for /frontend:**
  - Never import numbers from secondary catalogues. Search tools surface corrupted mirrors, and the fact-check must re-open primary sources.
- **Evidence:**
  - [febbhav/signs-of-ai-design README](https://github.com/febbhav/signs-of-ai-design) — febbhav, commit 854b46f18d (2026-07-31), accessed 2026-09-30 — practitioner catalogue.
    - "One 2026 crawl put blue-purple gradient prevalence at roughly 78 percent of indexed marketing sites, up from about 10 percent in 2020."
  - [AI Slop 2026: State of the AI-Generated Web](https://www.sailop.com/blog/ai-slop-2026-state-of-the-ai-generated-web) — Sailop, dated April 2026, accessed 2026-09-30 — vendor blog (read through WebFetch).
    - "A confession before the numbers: precise statistics about AI-generated content on the web are mostly bad, mostly self-reported, and mostly published by parties with an interest in either inflating or deflating the figures."
  - [cephalochromoscope.net mirror](https://cephalochromoscope.net/c73d89d1-a254-4e52-95b8-dba2563cb57c) — unknown, accessed 2026-09-30 via Exa fetch — scraped copy.
    - "One 2026 crawl put blue-purple gradient prevalence at roughly 69 percent of indexed marketing sites, up from about 30 percent in 2020."
- **Limits / false positives:** The link from febbhav to Sailop is my inference, since the catalogue does not cite the page for this number. At verification the Sailop page (dated Apr 28, 2026) was read as raw HTML. Its chart is titled "Tailwind blue (#3b82f6) adoption on indexed marketing sites (approximate share of pages with blue-500/600 as primary)", with ~10% for 2020 and ~78% for 2026: the same two numbers febbhav attaches to "blue-purple gradient prevalence". That makes the inference likely, and shows the number was relabelled.

### FD10-F31 — impeccable is a second public deterministic detector that also reads rendered pages, and its catalogue names six of the owner's tells (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:**
  - impeccable's README describes "61 deterministic detector rules for AI-generated frontend design", run by the CLI and browser extension "with no LLM and no API key". `npx impeccable detect <url>` and the extension "inspect the rendered page".
  - Commit 9f42da8e18 (2026-09-21) reworked five of these browser rules so that they measure what the reader sees: the rendered line, the inset of the text and the colour.
  - `antipatterns.json` has entries for six of the owner's tells, which the catalogue below did not cite before verification:

    | Owner's tell | impeccable id |
    |---|---|
    | T01 purple-to-blue gradient | `ai-color-palette` |
    | T02 gradient hero text | `gradient-text` |
    | T04 and T19 fonts | `overused-font` |
    | T08 three icon boxes | `icon-tile-stack` |
    | T09 badge above the headline | `hero-eyebrow-chip`, `kicker-above-heading` |
    | T18 serif italic accents | `italic-serif-display` |

  - `kicker-above-heading` is "banned outright, repeated or not", which disagrees with the reconciliation proposed in Contradiction 5.
  - impeccable calls two different entries the most recognizable tell: `side-tab` and `ai-color-palette`.
- **Implication for /frontend:**
  - The checker can reuse impeccable's rendered rules alongside Krebs's patterns. Both must be calibrated on the same control corpus, since neither publishes a per-rule false-positive rate.
  - Superlatives in practitioner catalogues are not rankings. Weight tells by measured prevalence (F10, F11) and by the owner's corpus (F29).
- **Evidence:**
  - [pbakaus/impeccable README.md](https://github.com/pbakaus/impeccable/blob/909726c7e8/README.md) — Paul Bakaus, HEAD 909726c7e8 (2026-09-30), Apache-2.0, accessed 2026-09-30 — tool documentation.
    - "1 skill, 24 commands, live browser iteration, and 61 deterministic detector rules for AI-generated frontend design." · "The CLI and browser extension run the deterministic rules with no LLM and no API key." · "For production inspection, use `npx impeccable detect https://example.com` or the browser extension. These inspect the rendered page"
  - [crates/live/assets/antipatterns.json](https://github.com/pbakaus/impeccable/blob/9f42da8e18/crates/live/assets/antipatterns.json) — last changed 2026-09-21 (9f42da8e18), accessed 2026-09-30 — tool catalogue.
    - "A small rounded-square icon container above a heading is the universal AI feature-card template — every generator outputs this exact shape." (`icon-tile-stack`)
    - "A tiny uppercase letter-spaced label sitting immediately above an oversized hero headline — or the same shape rendered as a pill chip — is now the default AI SaaS hero." (`hero-eyebrow-chip`)
    - "A tiny tracked uppercase or small-caps label sitting as its own block directly above a heading is banned outright, repeated or not." (`kicker-above-heading`)
    - "Oversized italic serif (Fraunces, Recoleta, Playfair, Newsreader-italic) as the primary hero headline reads as taste in isolation but has become the universal AI-startup landing page hero." (`italic-serif-display`)
    - "Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs." (`ai-color-palette`) · "Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs." (`side-tab`)
  - [commit 9f42da8e18](https://github.com/pbakaus/impeccable/commit/9f42da8e18) — Paul Bakaus, 2026-09-21, accessed 2026-09-30 — commit message.
    - "Five browser rules were reporting something other than what the reader sees, and a review that charges those numbers is charging noise."
- **Limits / false positives:** These are the vendor's own judgements, with no published per-rule precision. "Every generator outputs this exact shape" is an assertion, and Krebs dropped his equivalent icon-card detector for firing on clean sites (F12).

## Catalogue: the owner's 20 tells

Detector IDs S01 to S20 (static) and R01 to R20 (runtime) are defined in the next section. The grade is the strength of the evidence that the pattern is a perceived tell. The cause column cites findings.

| ID | Tell | Cause (evidence) | Static detector | Runtime detector | False positives | Fix direction | Grade |
|---|---|---|---|---|---|---|---|
| T01 | Purple-to-blue gradient | Tailwind UI indigo default and palette hues (F05); vendor-named default (F02); reported fading in Claude output (F23); filled purple CTAs at 6.1%, purple gradients not measured separately (F11); impeccable `ai-color-palette` (F31) (corrected: 6.1% is the filled-CTA rule only) | S01: `from-{purple,violet,indigo,fuchsia}-N` with `to-{blue,indigo,cyan,sky,violet,purple,pink}-N`; default hex and oklch hues in `linear-gradient` | R01: parse gradient stops of visible elements; hue 250 to 300 (Krebs), saturation above 0.25; weight filled CTAs and heroes | Sponsor or brand purple; web3 brands; data-viz ramps | Palette from the sponsor's customers' sites; one accent; solid fills | B |
| T02 | Gradient hero text | `bg-clip-text` recipe; Magic UI gradient-text components (F09); vendor lists single-word colour accents (F04) | S02: `bg-clip-text` plus gradient or `text-transparent`; CSS `background-clip: text` with `gradient(` | R02: computed `background-clip: text` or `-webkit-background-clip: text` plus a gradient `background-image`; stronger on h1 or h2 of 32px or more | A wordmark set as text; one deliberate display treatment in a real design system | Solid colour; hierarchy through size and weight | B |
| T03 | Emojis in headings | Chat-style markdown habit of emoji-prefixed headings and bullets (Wikipedia, F17 source); emoji as a stand-in for icons (F26) | S03: `<h1>` to `<h6>` text or `title:` strings matching `\p{Extended_Pictographic}` | R03: `h1..h6, [role=heading]` innerText with Extended_Pictographic; nav with 3 or more emoji or more than 40% emoji-prefixed sidebar links (Krebs) | Emoji or chat products; user-generated or quoted content; flag glyphs in a country picker | Remove; use icons only where they carry meaning | C |
| T04 | Inter everywhere | create-next-app root-layout default from v13.4.0 to v14.2.7 (F06, corrected from "13.4 to 14.2"); shadcn create default (F07); vendor-named default (F02) | S04: `{ Inter }` from `next/font/google`, `@fontsource/inter`, `family=Inter`, `rsms.me/inter`, `font-family: Inter` | R04: computed font-family of body and headings plus `document.fonts`; flag Inter as the only family, with a centred hero (Krebs pairing) | A deliberate UI type system (dense dashboards); sponsor brand font | Display face from brand research; if Inter stays, pair it with a distinct display face and a type scale | B |
| T05 | Colored border cards | Mechanism: left border plus radius (F21); cause not established | S05: `border-[lrse]-N` with N of 2 or more when a `rounded` class is on the same line, 4 or more otherwise; CSS side border of 3px or more, non-neutral (impeccable) | R05: Krebs accent-stripe rule (left or top edge at least 2px and more than 1px wider than each other side, saturation 0.2 or more, contains a heading; skip blockquote, footer, table) (corrected: left or top only) | Callouts; active tab indicator; timeline rail; severity in dashboards | Remove the stripe; if it encodes status, add a label | C |
| T06 | Glassmorphism cards | 2020 design trend (F22); AI glass "the new purple gradient" (practitioner) | S06: `backdrop-blur*` together with a translucent `bg-*/N`; CSS `backdrop-filter: blur(` | R06: Krebs glass rule (blur of 2px or more, alpha 0.02 to 0.9, card-sized, skip sticky full-width bars) plus co-occurrence of a light 1px border and a vivid gradient ground | Frosted nav bars; overlays on media; visionOS-like demos (Apple Liquid Glass) | Opaque surfaces; glass only where layering is real | B |
| T07 | Low-contrast dark mode | Dark defaults of `#0a0a0a` (F06, F07); default grey steps fail AA on 900 or 950 (F24); vendor lists near-black grounds (F04) | S07: `text-{gray,zinc,slate,neutral,stone}-{500,600,700}` in dark sections; `text-white/{10..40}` | R07: harden covers AA; /frontend adds Krebs's "12% or more of body text below 7:1 on a dark body" | Dark-first trading or IDE products; sparing secondary text | -300 steps on dark grounds (-400 only on `zinc-950` or `#0a0a0a`, F24); fewer grey levels; consider a light theme if the customers use one | C |
| T08 | Three icon boxes in a row | Canonical template: Bootstrap 2021 "Columns with icons" (F09); icon in a rounded square (F26); impeccable `icon-tile-stack` (F31) | S08: `grid-cols-3` mapped over an items array with `icon:`; icon wrapper `size-10`, `rounded-*` and `bg-*` around an svg | R08: 3 (or 6) equal-width siblings (within 12%), each with an 8 to 48px svg inside a filled 20 to 72px wrapper above a heading | Very common on human sites: the detector fired more on clean sites (F12); real triplets; pricing | Structure from content: one dominant feature with a real demo | B |
| T09 | Badge above the headline | shadcn Badge pill (F08); eyebrow habit (F04, F26); impeccable `hero-eyebrow-chip` and `kicker-above-heading` (F31) | S09: `<Badge` or `rounded-full px-2/3 py-0.5/1 text-xs` within about 15 lines before `<h1`; `uppercase tracking-*` plus `text-[10-12px]` | R09: Krebs hero-eyebrow-pill geometry (within 220px above H1; pill, boxed or small-caps) | A real, checkable status (testnet live with a contract link; a version linked to its changelog); breadcrumbs | Delete, or fold into the headline; if real, link it to proof | B |
| T10 | Lucide icons everywhere | shadcn default icon set since 2024-11-06 (F07) | S10: `lucide-react` in `package.json` plus import count; names Sparkles, Zap, Shield, Check, ArrowRight, BarChart3 | R10: count `svg.lucide`; read `lucide-<name>` classes; ratio of decorative icons to headings | A consciously chosen set; icons used on actions | Fewer icons, on actions; a custom glyph for protocol concepts; a set chosen for the brand | C |
| T11 | Untouched shadcn UI | Registry defaults; the author's "all apps started looking the same" (F07); top concrete Reddit tell at 2.5% (F10) | S11: `components.json` plus default tokens (`--radius: 0.625rem`, `--primary: oklch(0.205 0 0)`, dark `--background: oklch(0.145 0 0)`); `components/ui` files identical to the registry (hash); `hover:bg-primary/90` or `cn-button-variant-default` | R11: `[data-slot]` present and computed tokens equal to the defaults (10px radius, neutral greys, hover alpha 0.8 or 0.9) | shadcn with customised tokens; internal tools | Tokens from brand research first; then components | B |
| T12 | Fade-in on scroll | AOS 2015, Motion `whileInView`, Magic UI blur-fade (F09); vendor now names it (F04, F25) | S12: `whileInView`, `useInView(`, `initial={{ opacity: 0`, `data-aos=`, `new IntersectionObserver(`, `<BlurFade`, `animate-in fade-in` | R12: IntersectionObserver wrapped by init script; ratio of hidden-at-rest text before and after a scroll-through; must render under `reducedMotion: "reduce"` | One orchestrated load moment; a scroll-driven diagram that explains the mechanism (Emil's "explanation" purpose) | Content visible by default; motion only where it explains the protocol | B |
| T13 | Cursor-following beam | Effect libraries: Magic UI magic-card, Aceternity Spotlight and Following Pointer (F09); early Anthropic skill recommended custom cursors (F03) | S13: `onPointerMove` or `onMouseMove` plus `radial-gradient(` or `setProperty('--x'`; component names MagicCard, Spotlight, FollowingPointer, SmoothCursor, BorderBeam | R13: CDP listeners on window, document and the root (depth -1, pierce) for mousemove or pointermove, plus a synthetic mouse path and a diff of computed background, transform and custom properties | Charts with crosshairs; maps; games; 3D viewers | Remove, or make hover reveal real protocol data | D |
| T14 | Buttons fade on hover | shadcn defaults `hover:bg-primary/90` and nova `/80` (F08); vendor says hover transitions everywhere read as AI (F25) | S14: `hover:opacity-N` or `hover:bg-X/N` on button or link class strings; `transition-opacity` on buttons | R14: `locator.hover()` on each CTA; flag when only alpha or opacity changes; check `@media (hover: hover)` gating | Ghost buttons; a design system that specifies it | A state change with intent (tokenised darken, pressed scale); hover gated | D |
| T15 | Inconsistent spacing | CSS specificity collisions between section classes (F27) | S15: arbitrary spacing `-[Npx]` classes; distinct `py-*` values on `<section>` elements | R15: share of computed margin, padding and gap off the 4px grid; count of distinct section paddings; heading rhythm | `clamp()` fluid spacing; optical tweaks; embeds | Spacing and section-rhythm tokens | C |
| T16 | Em dashes everywhere | Post-training habit (F17). GPT-4.1 had the highest rate in Freeburg's sample, and Opus 4.6 was the easiest to suppress. Per the July 2026 Economist study (via Wikipedia), Claude is the only contemporary model still above professional writers. (corrected: "strongest in Claude" overstated one source) | S16: U+2014, `&mdash;`, `&#8212;`, and escaped `\\u2014` in JSX text or strings, comments excluded | R16: rate per 1,000 words of `innerText` with the /prose PR-01 threshold; "WORD — fragment" labels | Quoted text; proper names; human-written docs | Run /prose on the UI copy | B |
| T17 | Generic buzzword copy | Promotional register and LLM vocabulary (F19) | S17: impeccable phrase list and Wikipedia promotional words (S17 block) | R17: the same on `innerText`, plus a specificity check (mechanism, user, number or sponsor named) | Quoting a sponsor tagline | Specific verbs and nouns; /prose | B |
| T18 | Serif italic accents | Current AI default and single-word accent (F04, F20); impeccable `italic-serif-display` (F31) | S18: `<em>`, `<i>` or `<span>` with `font-serif` or `italic` inside `<h1>` or `<h2>`; italic weights of Instrument Serif, Fraunces or Playfair imported | R18: Krebs hero-font-mix (largest heading of 32px or more mixes 2 families, roman and italic, or 2 colours; ignores mono and icon fonts) | Editorial or literary brands; italic for titles | One family with weight contrast; or no accent | B |
| T19 | Space Grotesk plus Instrument Serif | Space Grotesk was recommended in Anthropic's October 2025 cookbook and November 2025 blog; Instrument Serif was not. Both are now listed as slop fonts (F03, F20). (corrected: the pairing was not recommended as such) | S19: next/font or Google Fonts imports of Space_Grotesk, Instrument_Serif, Fraunces, Bricolage_Grotesque, Syne, Sora, Young_Serif | R19: computed families: the heading font, or 25% or more of text (Krebs) | Brand-mandated fonts | Choose from the brand research and record why | B |
| T20 | Grain over a gradient | Early Anthropic skill recommended "noise textures" and "grain overlays" (F03); Magic UI noise-texture (F09) | S20: `<feTurbulence`, `data:image/svg+xml` containing feTurbulence, `noise`/`grain` assets, a `mix-blend-*` overlay with low opacity | R20: a full-size fixed or absolute overlay (pointer-events none, opacity below 0.3) with a noise image over a gradient element | Film, print or photographic brands | Flat surfaces or real imagery | D |

## Catalogue: tells missing from the 20

| ID | Tell | Cause (evidence) | Static detector | Runtime detector | False positives | Fix direction | Grade |
|---|---|---|---|---|---|---|---|
| M01 | Cream plus serif plus clay ("tasteful default") | Anthropic names it and its own `#D97757` (F04); impeccable cream-palette | `bg-{amber,stone,orange}-50`; ground hex near `#F4F1EA` or `#f5efe2`; accent near `#D97757` | body background lightness above 0.9 with a warm hue, plus a serif display, plus a clay accent | Editorial, food and craft brands | Palette from research | C |
| M02 | ALL-CAPS tracked eyebrow above every heading | Anthropic, taste-skill, impeccable kicker (F04, F26) | `uppercase` plus `tracking-[0.1Xem]` plus `text-[10-12px]` | uppercase and letter-spacing of 0.5px or more above an h2 or h3, counted per section | Krebs dropped "all_caps_headings" for firing on clean sites (F12) | At most one eyebrow per three sections, or none | C |
| M03 | Numbered 01/02/03 section markers or steps | Anthropic (F04); 17.7% prevalence (F11) | `>0?[1-9]<` spans or "Step 1" beside headings | Krebs numbered-steps rule (ascending, grouped); impeccable numbered labels | A real sequence (a process, a flow) | Numbers only where order is information | B |
| M04 | Stat banner with invented numbers | Anthropic "big number with a small label" (F04); 4.6% prevalence; Magic UI number-ticker (F09) | `NumberTicker`, `10K+`, `99.9%` literals | Krebs stat-banner rule (3 to 6 siblings with 22px+ numeric text, excluding prices and ordinals) | Real, sourced metrics (TVL on a block explorer) | Real, linked data or none | B |
| M05 | Fake testimonials, avatars, "Trusted by" logo walls | taste-skill "Jane Doe" rule; impeccable "trusted by" phrases; Design type forbids invented stats (F28) | `testimonials` arrays with names; `randomuser.me`, `i.pravatar.cc`; "Trusted by" | logo rows without links; quote cards with names not in the research | Real partners with permission | Omit; cite real sponsor or customer relations only | C |
| M06 | FAQ accordion with 3 or more items | Krebs pattern, 15.5% prevalence (F11) | `<details>`, `Accordion` with a "Frequently asked" heading | Krebs faq-accordion rule | Genuine support content | Answer inside the product narrative | B |
| M07 | SaaS-card kit (identical rounded cards, one radius, shadow `rgba(0,0,0,.1)`) | Anthropic (F04); Tailwind shadow scale (F08); Reddit rounded corners at 0.8% (F10) | `rounded-2xl` or `rounded-xl` plus `shadow-md` or `shadow-lg` repeated on many siblings | computed radius and shadow identical across more than N cards; nested cards | Real design systems with one radius | Radius and shadow by hierarchy; fewer containers | C |
| M08 | Near-black plus zinc dark default | create-next-app and shadcn `#0a0a0a` (F06, F07); vendor names "#0B0B0B, #111" (F04); perma-dark at 36.2% (F11) | `#0a0a0a`, `oklch(0.145 0 0)`, `bg-zinc-950`, `bg-black` plus `text-zinc-400` | body background luminance below 0.01 and neutral (chroma about 0) | Dark-first products | A ground and neutrals from brand research | B |
| M09 | Coloured glows, radial halos, blurred blobs | impeccable dark-glow and radial-halo; Krebs colored glows at 5.5% (F11) | `shadow-[0_0_` with colour; `blur-3xl` on absolute coloured circles | Krebs colored-glow rule (blur of 15px or more, saturation above 0.3, 2 or more elements) | Brand light effects in media products | Neutral elevation; no decorative blobs | B |
| M10 | Logo or text marquee | impeccable marquee; Magic UI marquee (F09, F28) | `Marquee`, `animate-marquee`, `@keyframes marquee` | continuous translateX animation on a repeated row | Real partner lists (taste-skill endorses marquees) | Static, linked list | C |
| M11 | Bento grid | Magic UI bento-grid (F09); Reddit at 0.1%, contested (F10) | `BentoGrid`, mixed `col-span-*` tiles | grid with more than 4 cells of unequal spans | Many human sites; content with real hierarchy | Use only when the content has that shape | C |
| M12 | Centred hero plus generic sans plus "Get started" and "Learn more" | Krebs centred hero at 22.0% (F11); Reddit "same hero" at 0.2% (F10) | CTA texts "Get started" and "Learn more" next to `text-center` h1 | Krebs center_aligned_hero rule plus a two-CTA pattern | Common human convention | The hero shows the protocol working (live demo or real screenshot) | B |
| M13 | Template chrome ("→" suffix, `A · B · C` meta, "WORD — fragment", mono micro-labels) | Anthropic (F04); taste-skill rations middle dots | `→` in button text; ` · ` joins; `font-mono text-[10-11px] uppercase` | same on `innerText` and computed families | Real metadata lines | Plain labels | C |
| M14 | Decorative grid-line background, pulsing status dot, blinking cursor | impeccable codex-grid-background, pulsing-dot, blinking-cursor (F28) | `bg-[linear-gradient(...)]` with a fixed `background-size`; `animate-pulse` on 6 to 10px dots; `animate-blink` | tiled 1px line gradients; pulse animations not tied to live data | Blueprint or canvas products; real live indicators | Remove or bind to real state | C |
| M15 | Nested cards | impeccable nested-cards; practitioner (F28) | card component inside card component | bordered or filled container inside a container at 2 or more levels | Dashboards with real grouping | Flatten; use spacing | C |
| M16 | Shape-assembled SVG illustrations and div-built fake screenshots | impeccable shape-assembled-illustration; taste-skill (F28) | large inline `<svg>` with many primitives in the hero; div "window" mockups | hero-sized inline SVG with more than N primitives | Diagrams, icons, logos | Real screenshots, a live demo or a protocol diagram | C |
| M17 | "Built for X" and "Trusted by" headline formulas | impeccable phrases "built for the modern" and "trusted by leading" (F19) | phrase match | phrase match on `innerText` | A real audience statement | Say what the protocol does and for whom | C |

## Detector reference (candidate, unvalidated)

These are starting points assembled from the cited tools. Thresholds marked "Krebs" or "impeccable" come from those tools' source code; all other thresholds are proposals to be calibrated on the owner's positive corpus (F29) and a human control corpus (F13) before any becomes blocking.

### Static patterns (JS regex, run over TSX/JSX/TS/CSS/HTML/MDX with dependencies, build output and `.env*` excluded; em dashes only in JSX text and string literals)

```text
S01 purple-to-blue gradient (Tailwind v3 and v4 spellings)
    class list contains  /\b(?:bg-gradient-to-|bg-linear-)[a-z0-9-]+\b/
    AND                  /\bfrom-(?:purple|violet|indigo|fuchsia)-[1-9]00\b/
    AND                  /\bto-(?:blue|indigo|cyan|sky|violet|purple|pink)-[1-9]00\b/
    CSS: /linear-gradient\([^)]*#(?:6366f1|4f46e5|818cf8|8b5cf6|7c3aed|a78bfa|a855f7|9333ea|c084fc)/i
    CSS oklch hue 260-309: /oklch\(\s*[\d.]+%?\s+[\d.]+\s+(?:2[6-9]\d|30\d)(?:\.\d+)?/
S02 gradient text
    /\bbg-clip-text\b/ AND (/\bbg-(?:gradient-to|linear|radial|conic)-/ OR /\btext-transparent\b/)
    CSS rule with /(?:-webkit-)?background-clip:\s*text/ AND /gradient\(/ ; /-webkit-text-fill-color:\s*transparent/
S03 emoji in headings (u flag)
    /<h[1-6][^>]*>[^<]*\p{Extended_Pictographic}/u
    /(?:title|heading|label)\s*:\s*["'`][^"'`]*\p{Extended_Pictographic}/u
S04 Inter
    /import\s*\{[^}]*\bInter\b[^}]*\}\s*from\s*["']next\/font\/google["']/
    /@fontsource(?:-variable)?\/inter\b/   /fonts\.googleapis\.com\/css2?\?[^"']*family=Inter\b/   /rsms\.me\/inter/
    /font-family:\s*["']?Inter\b/   /sans:\s*\[\s*["']Inter/
S05 accent stripe (impeccable thresholds)
    /\bborder-[lrse]-(\d+)\b/ -> fire if n >= 2 and a rounded-* class is on the same source line (impeccable tests the line), else n >= 4
    /border-(?:left|right):\s*(\d+)px\s+solid[^;]*/ with a non-neutral colour -> fire if n >= 3 (n >= 2 with border-radius)
S06 glass
    /\bbackdrop-blur(?:-[a-z0-9]+|-\[[^\]]+\])?\b/ AND /\bbg-(?:white|black|[a-z]+-\d{2,3})\/(?:[1-9]|[1-8]\d)\b/
    /backdrop-filter:\s*blur\(/
S07 muted grey on dark (runtime is authoritative)
    /\btext-(?:gray|zinc|slate|neutral|stone)-(?:500|600|700)\b/ inside elements carrying /\bbg-(?:gray|zinc|slate|neutral|stone)-(?:900|950)\b|\bbg-black\b|\bdark:/
    /\btext-white\/(?:[1-3]\d|40)\b/
S08 three icon boxes
    /\b(?:sm:|md:|lg:)?grid-cols-3\b/ on a container that maps an array whose items contain /\bicon\s*:/
    icon wrapper /\b(?:size|h)-(?:8|9|10|11|12|14)\b[^"'`]*\brounded-(?:md|lg|xl|2xl|full)\b[^"'`]*\bbg-/
S09 badge above headline
    within 15 lines before /<h1\b/:  /<Badge\b/  OR  /\brounded-full\b[^"'`]*\bpx-[23]\b[^"'`]*\bpy-(?:0\.5|1)\b/
    eyebrow: /\buppercase\b[^"'`]*\btracking-(?:wide|wider|widest|\[0?\.\d+em\])\b/
S10 Lucide
    package.json "lucide-react"; count /from\s+["']lucide-react["']/
    named imports /\b(?:Sparkles|Zap|Shield(?:Check)?|Check(?:Circle2?)?|ArrowRight|BarChart3|ChartBar|Rocket)\b/
S11 untouched shadcn
    components.json exists; globals.css has /--radius:\s*0\.625rem/ and /--primary:\s*oklch\(0\.205 0 0\)/ and /--background:\s*oklch\(0\.145 0 0\)/
    components/ui/*.tsx sha256 equal to the registry copy; /hover:bg-primary\/90/ or /cn-button-variant-default/
S12 fade-in on scroll
    /\bwhileInView\b|\buseInView\(|initial=\{\{\s*opacity:\s*0|data-aos=|new IntersectionObserver\(|<BlurFade\b|\banimate-in\b[^"'`]*\bfade-in\b/
S13 cursor tracking
    /\bon(?:Mouse|Pointer)Move=/ or /addEventListener\(\s*["'](?:mouse|pointer)move["']/ near /radial-gradient\(|setProperty\(\s*["']--/
    /\b(?:MagicCard|Spotlight|FollowingPointer|SmoothCursor|BackgroundBeams|BorderBeam|CardSpotlight)\b/
S14 hover fade on buttons
    on <button>, <a> or Button className: /\bhover:opacity-\d{1,2}\b/ OR /\bhover:bg-[a-z]+(?:-\d{2,3})?\/(?:[5-9]\d)\b/
S15 arbitrary spacing
    /(?<![\w-])-?(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-\[[\d.]+(?:px|rem)\]/
S16 em dash in copy (strip // line comments, /* */ and {/* */} first)
    /\u{2014}|&mdash;|&#8212;|&#x2014;|\\u2014/u
S17 buzzwords (impeccable list; any hit is a candidate)
    /streamline your|empower your|supercharge your|unleash (?:your|the power)|leverage the power|built for the modern|trusted by (?:leading|the world)|best-in-class|industry-leading|world-class|enterprise-grade|next-generation|cutting-edge|transform your business|revolutioniz|game[- ]chang|mission-critical|best of breed|future[- ]proof|seamless(?:ly integrate| experience)|drive (?:engagement|growth|results)|harness the power/i
S18 serif italic accent
    inside an <h1> or <h2> block: /<(?:em|i|span)\b[^>]*class(?:Name)?=["'][^"']*\b(?:font-serif|italic)\b/
S19 tell fonts
    /\b(?:Space_Grotesk|Instrument_Serif|Fraunces|Bricolage_Grotesque|Syne|Sora|Young_Serif)\b/  (next/font imports)
    /family=(?:Space\+Grotesk|Instrument\+Serif|Fraunces|Bricolage\+Grotesque|Syne|Sora|Young\+Serif)/
S20 grain
    /<feTurbulence\b/   /data:image\/svg\+xml[^"')]*feTurbulence/   /\b(?:noise|grain)\.(?:png|webp|svg)\b/
    /\bmix-blend-(?:overlay|soft-light|multiply)\b/ with /\bopacity-(?:[1-3]0|\[0?\.[0-3]\d?\])\b/ on an absolute inset-0 layer
```

### Runtime harness (Playwright sketch; Chromium is installed locally)

```js
// Sketch only: shows where each R-check hooks in. Thresholds marked (Krebs)/(impeccable) come from their code.
const { chromium } = require('playwright');

async function scan(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // R12: count IntersectionObserver usage before any page script runs (addInitScript semantics, F25)
  await page.addInitScript(() => {
    const IO = window.IntersectionObserver;
    window.__io = { observers: 0, targets: 0 };
    window.IntersectionObserver = class extends IO {
      constructor(cb, opts) { super(cb, opts); window.__io.observers++; }
      observe(t) { window.__io.targets++; return super.observe(t); }
    };
  });

  await page.goto(url, { waitUntil: 'networkidle' });

  // R01-R11, R16-R20: one in-page pass over visible elements reading getComputedStyle,
  // getBoundingClientRect, innerText and document.fonts (port of design-slop-cop patterns).
  const atRest = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('body *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const textLeaves = vis.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 3));
    const hidden = textLeaves.filter(el => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.opacity) === 0 || cs.visibility === 'hidden';
    });
    return { textLeaves: textLeaves.length, hiddenAtRest: hidden.length, io: window.__io,
             lucide: document.querySelectorAll('svg.lucide').length,
             shadcnSlots: document.querySelectorAll('[data-slot]').length };
  });

  // R12 (content-hidden-at-rest, impeccable): scroll through, then re-measure
  for (let y = 0; y < 20000; y += 700) { await page.mouse.wheel(0, 700); await page.waitForTimeout(150); }
  // ...re-run the hidden-at-rest count; flag if a large share never becomes visible.

  // R14: hover each primary CTA, diff background-color alpha and opacity
  // R13: CDP DOMDebugger.getEventListeners on window/document/root (depth -1, pierce true)
  //      + page.mouse.move along a path over the hero, diff computed background-image/transform/custom props
  const client = await page.context().newCDPSession(page);
  // const { result } = await client.send('Runtime.evaluate', { expression: 'window' });
  // const { listeners } = await client.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: -1, pierce: true });

  // R12 reduced motion: content must render with reducedMotion 'reduce'
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'networkidle' });

  await browser.close();
  return atRest;
}
```

Per-check thresholds:

| Check | Rule | Source |
|---|---|---|
| R01 | purple = HSL hue 250 to 300, saturation above 0.25, lightness 0.15 to 0.85, alpha 0.3 or more; fire on filled CTAs | Krebs |
| R02 | computed text clip plus a gradient with a visible stop | Krebs |
| R05 | left or top stripe of 2px or more, more than 1px wider than each other side, colour alpha 0.3 or more and saturation 0.2 or more, heading child, element at least 40×20 (corrected: left or top only) | Krebs |
| R06 | blur of 2px or more, background alpha 0.02 to 0.9, width 150 to 820px, height 40 to 900px, skip sticky full-width bars | Krebs |
| R07 | body luminance below 0.2 and 12% or more of body text below 7:1 | Krebs |
| R09 | 220px window above H1, pill, boxed or small-caps shapes | Krebs |
| R16 | /prose PR-01 on `innerText`; impeccable's 8-dash floor as a secondary guard | /prose, impeccable |
| R18 | two families, or roman plus italic, or two paints in the largest heading of 32px or more | Krebs |
| R19 | heading font, or 25% or more of text | Krebs |

Score co-occurrence in tiers with an anchor rule (F12). Report each candidate with a selector, the computed values and a cropped screenshot. For static hits, report file:line as /prose does.

## Contradictions between sources

1. **Glassmorphism's weight.** The owner's list and a practitioner ("the new purple gradient") rank it high. The Reddit study finds it named in 0.2% of comments and near the bottom (F10), yet a 2026 Show HN scan detects it on 14.1% of pages (F11). The tell is frequent in pages but rarely what people point to.
2. **Bento grids, blobs and aurora.** The Showit reel (via the claude-tweaks issue) and many lists include them. The Reddit study rejects "mesh / blob / aurora" as a keyword artifact and ranks bento last, "contested even by complainers" (F10).
3. **Spacing.** The owner's list flags inconsistent spacing. impeccable flags monotonous spacing (F27).
4. **Geist, zinc-950 and marquees.** taste-skill recommends Geist over Inter, off-black or zinc-950 over pure black, and marquees for breadth. impeccable lists Geist as overused and marquees as slop. Anthropic lists tinted near-black (`#0B0B0B`, `#111`) as template chrome (F04, F18, F20, F28).
5. **Eyebrows and all-caps labels.** Anthropic and taste-skill call them among the commonest tells ("the #1 violated rule in production tests"). Krebs's all-caps-headings detector "fired only on clean" sites and was dropped (F12). The reconciliation may be that the tell is repetition above every section, not the case style. impeccable rejects that reconciliation: its `kicker-above-heading` is "banned outright, repeated or not" (F31). (updated at verification)
6. **Em-dash thresholds.** /prose PR-01 fires above 2.0 per 1,000 words, below the human essay mean of 3.23 in Freeburg's sample. impeccable fires at about 10 to 12 per 1,000 words (my conversion), and taste-skill at any occurrence. Wikipedia says AI em dashes are usually spaced; a Congress-release study tracks the unspaced form because AP style there spaces them (F17, F18).
7. **Anthropic against itself over time.** The 2025-11-12 skill recommended grain overlays, noise textures, custom cursors and scroll-triggering, while the October 2025 cookbook and the November 2025 blog recommended Space Grotesk and similar display fonts. The 2026-09-03 skill calls fade-and-slide-up entrances and hover transitions on every card AI-generated. The cookbook both recommends Space Grotesk and warns against converging on it, and the first skill itself only warned against it (F03). (corrected: the 2025-11-12 skill did not recommend Space Grotesk-class fonts)
8. **Custom cursors.** Anthropic's first skill recommended them; taste-skill bans them as "Outdated, accessibility-hostile, perf-hostile" (F03, F28).
9. **Version badges.** This dossier's example of a legitimate badge (a real version number, F26) conflicts with taste-skill, which bans version labels as default eyebrows. They agree only when the badge is tied to a real launch (F26). (corrected: the example is the dossier's, not the owner's; the owner's brief gives none)
10. **When Tailwind's indigo began.** febbhav says Tailwind "shipped indigo as its demo accent in 2019". Wathan's "five years ago" (written in 2025) and Tailwind UI's launch on 2020-02-26 (Wathan's own post) point to 2020 (F05, F30).
11. **Krebs's own numbers.** The blog says about 1,400 and also 1,590 pages, and 16 patterns while the repository README says 14. The High tier is 4 or more patterns on the blog, but 5 or more (after a brief 6 or more) in the repository (F11, F12).
12. **Superlatives inside one source.** taste-skill calls eyebrow restraint "the #1 violated rule in production tests" and the em dash "the #1 visual Tell in production tests". impeccable calls both `side-tab` and `ai-color-palette` the most recognizable tell of AI-generated UIs. Neither ranking is measured (F18, F26, F31). (added at verification)
13. **Comments against posts.** In the Reddit study, purple is named in 2.3% of comments but 0.7% of design-context posts, and emoji in 0.5% of comments but 2.7% of posts. The ranking of concrete tells depends on the unit measured (F10). (added at verification)

## What could not be found, and how it was searched

- **An original tweet behind the reel.**
  - Searched: WebSearch for "20 reasons why your app looks vibecoded", `site:x.com "looks vibecoded"` and "why your app looks vibecoded tweet August 2026"; Exa search for the title with "Give this to Claude".
  - Result: only derivatives (a 2026-09-02 article, a 2026-09-20 GitHub issue). The reel thumbnail shows a talking-head video with a text overlay, so the reel is likely the original.
- **A controlled study of specific UI tells.** No experiment was found that measures whether users or judges rate a page lower because of gradient text, glass, Inter and so on.
  - Searched: Exa, for user studies rating AI-generated websites on trust and quality.
  - Result: adjacent studies only (F16), plus a 2023 vendor survey of 500 business owners that I did not rely on.
- **Perception data for five tells:** cursor-following beams, buttons fading on hover, grain over gradient, inconsistent spacing, serif italic accents. I found no study.
  - Searched: the Reddit study's lexicon has no grain, cursor or hover categories; Krebs has no detector for them.
  - Result: the only sources are practitioner lists and the owner's reel.
- **Tailwind UI (Tailwind Plus) component code showing `bg-indigo-500` and hero patterns.**
  - Searched: WebFetch of the documentation page returned a login form; curl of the heroes page showed no component code.
  - Result: only the page shell was readable. It loads Inter from `rsms.me/inter/inter.css`.
- **The cause of the colored-left-border tell.** I found descriptions, not causes. Searched: Krebs, impeccable, Yuwen Lu, febbhav.
- **A pre-LLM baseline for tell prevalence.** No study scored pre-2023 sites with the same detectors. HN critics raised this gap (F13).
- **The Economist's July 2026 em-dash study.** It is paywalled; I read only Wikipedia's summary.
- **v0, Lovable and Bolt defaults.** I did not verify their default fonts and colours from primary sources. A practitioner claims Geist is v0's default because it is Vercel's typeface; this is unverified.
- **Human-control check of Linear's type.** I fetched linear.app's HTML and 12 CSS files, but could not confirm its font family without rendering, so I make no claim.

## Weak spots of this dossier

- **Practitioner-heavy.** Most tell-specific evidence comes from practitioner catalogues (impeccable, taste-skill, febbhav, Yuwen Lu) and one practitioner measurement (Krebs), plus one Reddit keyword study. The peer-reviewed work (Goree, Guriță and Vatavu, Jakesch) supports homogenization and perception in general, not individual tells.
- **Krebs's prevalence figures (F11).**
  - They come from the detector version before its false-positive fixes, and from the Show HN population.
  - Show HN pages are not labelled AI or human.
  - The tiers depend on thresholds the author changed three times.
- **Reddit percentages (F10).** They measure keyword mentions under a broad lexicon, not complaints about a specific visual feature. The author also used an agent workflow for verification.
- **The owner's own frontends (F18, F29).** The scan and comment split are my unvalidated regex heuristics over source, not rendered output. Folder authorship (own work, fork or template) was assumed.
- **Sources read through a summarising fetch tool.** The Playwright docs, Aceternity catalogue, Apple newsroom, Motion docs, React 17 post, isthatvibecoded and Sailop were read through WebFetch or Exa. At verification, each was re-read as raw HTML with curl, and every quoted string was found verbatim. The Malewicz article was re-read through Exa's full-text fetch.
- **The Anthropic skill and Claude Design rules change every few months.** Three distinct skill texts in ten months (2025-11-12, 2026-06-09, 2026-09-03; the 2025-12-04 commit kept the first body). The Design type release is 1790780428-0f80. Findings F03 and F04 describe a moving target. (corrected: "change monthly" overstated the pace)
- **Detectors are not tested.** The detector reference is a synthesis, not a tested tool. No threshold in it has been validated on the owner's positive corpus or on a human control corpus.

## Dropped at verification

None. Every finding had at least one source that opened and supported its core claim. Where a claim, number, date or implication went further than its source, it was corrected in place and marked "(corrected: ...)".

## Verification notes

**Method.** Every source cited in F01 to F30 was reopened on 2026-09-30. Nothing was taken from the original dossier or from memory.
- **GitHub.** Files were fetched with `gh api` and `curl` from `raw.githubusercontent.com`, pinned to the SHA or tag the dossier cites. Commit histories were listed per path, so dates and "last changed" claims were checked against commits.
  - Repositories: anthropics/skills, anthropics/claude-cookbooks, AdrianKrebs/design-slop-cop, pbakaus/impeccable, leonxlnx/taste-skill, emilkowalski/skill, shadcn-ui/ui, vercel/next.js, tailwindlabs/tailwindcss, magicuidesign/magicui, michalsnik/aos, twbs/bootstrap, HugoGarcez/vibecoded-design-tells, febbhav/signs-of-ai-design, google/fonts, mdn/content, ChromeDevTools/devtools-protocol.
  - The claude-tweaks issue, the Next.js release and the pull requests were read through the GitHub API.
- **Web pages** were fetched as raw HTML with `curl` and searched for each quoted string: the Instagram reel, the Najeep article, Anthropic's blog, Krebs's blog, isthatvibecoded, Sailop, Apple, Motion, Playwright, React 17, Aceternity, vercel.com, stripe.com and Tailwind Plus.
  - The Instagram reel was read twice. A facebookexternalhit user agent gave the meta tags. A Googlebot user agent gave the embedded JSON (`taken_at`, likes, comments, accessibility caption). The thumbnail was downloaded and viewed.
- **X posts** were read through `api.fxtwitter.com` JSON. **Hacker News** was read through the Algolia and Firebase APIs.
- **arXiv** metadata came from the export API. The full text of 2607.22928 (PDF) and 2603.27006 (HTML) was read.
- **PDFs** were extracted with pypdf: Goree et al., Guriță and Vatavu (all 13 pages), Jakesch et al., and Huang and Katona.
- **Wikipedia** revision 1377577399 was read as wikitext through the MediaWiki API. The Claude Design type was read with the Artifact tool (`read`, `type_url`), release 1790780428-0f80.
- **Independent recomputation:**
  - the 982-site per-pattern counts from Krebs's index;
  - the WCAG contrast pairs;
  - the oklch(0.145 0 0) to sRGB conversion;
  - the Unix timestamp of the reel.
- **Bisection.** The create-next-app template was bisected across tags v13.0.0 to v14.2.35 and v15 to canary.
- **Local scripts.** The two read-only scripts in `research/_scripts/fd10/` were re-run, and all quoted counts reproduced. A separate read-only spot-check sampled 18 em-dash lines from one project. It opened only source-code extensions and never read `.env*` files.

**Main corrections, by kind.**
- **Wrong dates or versions:**
  - the reel's age (F01 Summary);
  - the Inter-to-Geist switch and the `#0a0a0a` ground in create-next-app (F06);
  - the Bootstrap markup quoted as the 2021 original (F09);
  - Fraunces placed in the November 2025 blog (F03 Summary).
- **Wrong attribution or causality:**
  - the 66-to-23 drop credited to Krebs's detector fixes alone (F12);
  - the medRxiv venue (F17);
  - "driven by shared libraries" (F13);
  - the Space Grotesk warning placed in the typography prompt (F03).
- **Incomplete data that changed a conclusion:**
  - shadcn presets (F07);
  - the post-level column of the Reddit study (F10);
  - the full DIS '25 paper (F15).
- **Overreach:**
  - "only public deterministic detector" (F12);
  - "purple is now a minor signal" from a filled-CTA rule (F11, F23);
  - "cluster just under 4.5:1" (F15);
  - "almost none" of Anthropic's clusters in the owner's list (F04);
  - "Anthropic abandoned" the blacklist (F01);
  - "almost certainly" for "mostly certain" (F22);
  - "one side" for Krebs's left-or-top rule (F21);
  - the "-300 or -400" advice that fails its own 7:1 check (F24);
  - the owner's "actual recurring failure modes" from source counts (F29).

**Sources that could not be opened.**
- The Economist, "How to spot AI writing", 2026-07-30: HTTP 403 (paywall). Its claim that only Claude still exceeds professional writers rests on Wikipedia's summary alone.
- The Instagram reel's video: only its metadata, caption and thumbnail were readable. The full 20-item order still rests on the two derivatives.
- Tailwind Plus (Tailwind UI) component code: login required. Only the page shell, which loads Inter from rsms.me, was confirmed.
- cephalochromoscope.net was read only through Exa's fetch, not as raw HTML. The altered strings match the dossier.

**Residual doubts.**
- **Krebs's prevalence figures** come from the 2026-06-18 detector version, before the false-positive fixes, on unlabelled Show HN pages. Three of its rows measure something narrower or broader than their names suggest: `purple_accent` counts filled CTAs only, `gradients` is colour-agnostic, and `perma_dark_mode` includes a high-contrast "dark template" path.
- **The Reddit study** is a keyword proxy. Its two units (comments and posts) disagree on the order of the concrete tells.
- **Freeburg's human baseline** is 8 essays. The Economist figure is second-hand.
- **The owner's frontends:** folder authorship (own work, fork or template) is still assumed. The comment split is a line heuristic, and one sampled non-comment hit was an empty-value placeholder.
- **Two small, unexplained count differences:** the reel's likes (4,768 when first read, 4,784 at verification) and the HN thread (234 comments in Algolia, 235 descendants in Firebase). Both look like normal drift or deleted items.
- **The DIS '25 PDF:** the `file` utility reports 6 pages while pypdf extracts 13 coherent pages (abstract to references). The dossier's 6-page reading probably came from that discrepancy.
- **Unchecked thresholds:** those in the catalogue and detector reference that are not marked Krebs or impeccable are proposals and cannot be verified. The ones marked Krebs or impeccable were checked against source.
- **Vendor judgements:** isthatvibecoded's scoring method is described only on its own page. impeccable publishes no per-rule precision. Sailop sells a slop score and says its statistics are approximate.
- **Claude-era framing:** F28's title still uses "Claude-era" for template chrome. Anthropic's skill says "AI-generated design right now", and only the cream, serif and clay cluster is called Claude's own habit (Design type).
