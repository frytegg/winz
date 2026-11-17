# Emil Kowalski design-engineering principles (animation and interaction)
> Code FD03 · slug tool-emil-kowalski · researched 2026-09-30 · verified 2026-09-30 · counts: verified 17 / corrected 12 / downgraded 1 / dropped 0 / added 1

## Summary

- An official agent skill exists, published by Emil Kowalski himself: `github.com/emilkowalski/skills` (MIT, "Copyright (c) 2026 Emil Kowalski", 13 skills, created 2026-03-16, HEAD `d16ebe6` of 2026-09-23; skills.sh counts 1.8M installs). The core file is `skills/emil-design-eng/SKILL.md`; `animate`, `review-animations` (+`STANDARDS.md`), `improve-animations` (+`AUDIT.md`) and `find-animation-opportunities` restate one rule catalog. Pin a commit and vendor the catalog: `review-animations`, `prototype` and `pick-ui-library` set `disable-model-invocation: true`, so agents launched by /execution cannot load them.
- The catalog is two gates, then ingredients. Gate 1, frequency: 100+ times a day (keyboard, command palette) means no animation, ever; tens a day means remove or near-imperceptible; occasional means standard; rare or first-time is the only place for delight. Gate 2, purpose: feedback, spatial consistency, state indication, preventing a jarring change, explanation (marketing and onboarding), delight (rare tier only). "It looks cool" blocks.
- Ingredients: `ease-out` for anything entering or exiting, never `ease-in` on UI, strong custom curves instead of CSS built-ins: `cubic-bezier(0.23, 1, 0.32, 1)` (easing.dev's "Out Quint"), `cubic-bezier(0.77, 0, 0.175, 1)` ("In Out Quart"), drawer `cubic-bezier(0.32, 0.72, 0, 1)` taken from Ionic's iOS modal (500 ms). Emil's own emil-design-eng examples still use the built-in `ease-out` keyword (button 160 ms, tooltip 125 ms); animate bans built-in `ease-out` only "on a deliberate animation" (F06). (corrected at verification: "Penner" attribution removed, easing.dev does not name Penner; built-in ease-out caveat added)
- Durations: press 100–160 ms, tooltips 125–200, dropdowns 150–250, modals and drawers 200–500 in the skill but 200–300 in the "Agents with Taste" post; UI under 300 ms; marketing may be longer; duration scales with distance; exits about 20% faster than entrances. No measurement backs these numbers: they are practitioner judgement (NN/g 2020 gives 100–500 ms, 100–400 typical).
- Press feedback `scale(0.97)` on `:active` (range 0.95–0.98; 0.9 is "too much"); entrances from scale 0.9–0.97 plus opacity, never `scale(0)`; `transform-origin` at the trigger (modals exempt); transitions or springs, not keyframes, for anything re-triggerable; bounce defaults to zero; animate only `transform` and `opacity`; reduced motion is "fewer and gentler, not zero"; hover motion gated by `(hover: hover) and (pointer: fine)`.
- Tell 12 (fade-in on scroll): Emil's scroll-reveal recipes are one-shot clip-path reveals (`once: true`); the RECIPES.md version adds "Marketing surfaces only", the emil-design-eng version carries no such restriction, and his clip-path post also teaches a scroll-linked progress line; his review skill flags "pure-fade entrances"; his exercise calls uniform stagger "artificial" and layered entrances a waste. Yet six of his web skill files (plus animate-expo's recipes) tell agents to add a 30–80 ms stagger where things appear together, and all three stagger examples (emil-design-eng, animate/RECIPES.md, review-animations/STANDARDS.md) are opacity + `translateY(8px)` keyframe fades in uniform 50 ms steps: an agent copying the skill literally gets most of the way to tell 12. (corrected at verification: "only scroll recipe ... marketing surfaces only" was stronger than the sources)
- Tell 13 (cursor-following beam): Emil permits decorative mouse tracking on marketing pages when spring-smoothed and says it would be wrong on functional data. He does not ban it. The owner's tell is stricter than Emil.
- Tell 14 (buttons fade on hover): Emil shows that a fading hover highlight on a list "trails behind your cursor", in an exercise framed around "something you’d use frequently" (a sidebar or menu used "hundreds of times a day"), and puts button feedback on `:active` scale; Vercel's guidelines require hover to increase contrast; shadcn's untouched Button ships `transition-all` plus `hover:bg-primary/90` and no press state (tells 11 and 14 at once). (corrected at verification: frequency framing of the exercise added)
- Checker design: Tailwind defaults (`transition-all`, `cubic-bezier(0.4, 0, 0.2, 1)`, 150 ms) are the weak signature the skill rejects, but Emil's own site's compiled CSS contains `transition-all`, `ease-in` and that curve 11 times. Presence of a class is not evidence: calibrate on control sites and measure per element at runtime (`document.getAnimations()`, Playwright reduced-motion emulation, CDP playback rate for slow-motion review). axe-core has no motion rule besides `blink`/`marquee`, and WCAG 2.3.3 is AAA, so /harden will not catch missing reduced-motion handling.
- Emil's own libraries break several of his rules (Sonner turns all motion off under reduced motion and animates `height`; Vaul uses keyframes, has no reduced-motion handling anywhere in `src/` and is unmaintained; swipe velocity thresholds are 0.11 in Sonner, "trial and error" in Emil's words, and 0.4 in Vaul). Treat his numbers as tuned defaults with documented exceptions, not laws.
- Added at verification: Emil's own blog sets every prose `<em>` in a separate serif italic face (26 instances on 11 pages, all in body paragraphs, none in headings), the visual pattern of tell 18; tell 18 must be scoped to display text (F31). Chromium enabled composited clip-path animations by default on 2026-07-14 (stable from tag 152.0.7970.0), so Emil's "hardware-accelerated" claim now holds for eligible clip-path animations in Chrome 152 and later, with main-thread fallbacks (F30).

## Findings

### FD03-F01 — An official skill encoding Emil Kowalski's principles exists: `emilkowalski/skills`, published by Emil Kowalski (MIT)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The repository `emilkowalski/skills` (description "Skills for Designers and Engineers.", homepage `https://emilkowal.ski/skill`, MIT license, copyright Emil Kowalski 2026) was created 2026-03-16T13:52:31Z and last pushed 2026-09-23 (HEAD `d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128`, "Update README.md"). It holds 13 skills: emil-design-eng, animate (+RECIPES.md), animate-expo (+RECIPES.md), review-animations (+STANDARDS.md), improve-animations (+AUDIT.md, PLAN-TEMPLATE.md), find-animation-opportunities, animation-vocabulary, apple-design, write-swift, pick-ui-library, prototype (+PICKER.md), mobile-native, ask-sonner (+API.md), plus `performance-cheatsheet.md`. The singular name `emilkowalski/skill` used on emilkowal.ski/skill resolves to the same repository id. Emil announced it on X on 2026-03-16. After the March init, commit history shows 12 skill-adding commits between 2026-06-18 and 2026-09-15, weekly in July and August (review 06-18, animation-vocabulary 06-29, apple 07-09, improve-animations 07-11, find-animation-opportunities 07-15, pick-ui-library 07-21, prototype 07-27, animate 08-05, ask-sonner 08-10, expo 08-18, write-swift 08-21, mobile-native 09-15), plus a 2026-07-21 refactor replacing Radix mentions with Base UI and a 2026-09-15 commit removing the course link from every skill's welcome line. (corrected: "skills added roughly monthly" understated the cadence; companion files of animate-expo and ask-sonner added)
- **Implication for /frontend:** Cite and vendor this repository, pinned to a commit, as the canonical source. Aggregators (h3nryprod01/design-taste "a merged synthesis of emilkowalski/skill, pbakaus/impeccable, and leonxlnx/taste-skill"; JaimeJunr/claude-code-frontend-skills) and the many forks are derivatives. Keep the MIT notice with any vendored file. Re-check the pin before each event: the repo changed weekly through the summer of 2026, and existing skill text was rewritten, not only extended. (corrected: "changes monthly")
- **Evidence:**
  - [emilkowalski/skills](https://github.com/emilkowalski/skills) — Emil Kowalski, HEAD d16ebe6 (2026-09-23), accessed 2026-09-30 — repository metadata via `gh api`.
    - `gh api repos/emilkowalski/skills` → `"created_at":"2026-03-16T13:52:31Z"`, `"pushed_at":"2026-09-23T23:18:27Z"`, `"homepage":"https://emilkowal.ski/skill"`, `"license":{"key":"mit"...}`, `"stargazers_count":42397`, `"forks_count":2411`; `gh api repos/emilkowalski/skill` returns the same `"id":1183325896`.
    - `gh api repos/emilkowalski/skills/commits` → first commits `2026-03-16 5282ea8 init`, then `2026-06-18 47226d9 Add review skill`, `2026-07-09 ... apple skill`, `2026-08-05 de33dbe Add /animate skill`, `2026-09-15 0b85d4b Add /mobile-native skill`, `2026-09-23 d16ebe6 Update README.md`.
  - [LICENSE](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/LICENSE) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — license file.
    - "MIT License" / "Copyright (c) 2026 Emil Kowalski"
  - [README.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/README.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — the tool's own file.
    - "npx skills@latest add emilkowalski/skills"
    - "Agents don’t have great taste"
    - "This is your shortcut to great interfaces. A shortcut to stand out in a sea of slop."
  - [AI Skills for Design Engineers](https://emilkowal.ski/skill) — Emil Kowalski, undated page, accessed 2026-09-30 — author's site.
    - "npx skills add emilkowalski/skill"
  - [X post 2033543717890465985](https://x.com/emilkowalski/status/2033543717890465985) — Emil Kowalski, 2026-03-16T13:59:38Z, accessed 2026-09-30 via `cdn.syndication.twimg.com/tweet-result` (x.com itself not fetchable) — social post.
    - "Turned my blog articles into one big design engineering skill that you can use with coding agents like Claude Code or Codex."
  - [emilkowalski/skills on skills.sh](https://skills.sh/emilkowalski/skills) — skills.sh (Vercel), accessed 2026-09-30 — vendor install telemetry.
    - "13 skills" · "1.8M total installs" · "emil-design-eng 310.9K"
  - Verification (2026-09-30): `gh api "repos/emilkowalski/skills/commits?per_page=100"` returned 54 commits; the skill-adding ones are listed in the claim. `gh api repos/emilkowalski/skills/commits/85e8e23` ("Remove course mention", 2026-09-15) shows each welcome line losing "If you want to dive even deeper, check out Emil’s course: [animations.dev](https://animations.dev/)." `gh api repos/emilkowalski/skills/commits/main` still returns d16ebe6.
- **Limits / false positives:** Stars and install counts are vendor telemetry and move daily (42,397 stars at research time, 42,407 at verification). The singular install path relies on a GitHub rename redirect.

### FD03-F02 — Three of the skills cannot be loaded by the model or preloaded into subagents, and every skill answers a bare invocation with a canned line; /execution cannot simply call them
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** `review-animations`, `prototype` and `pick-ui-library` declare `disable-model-invocation: true`. Claude Code's documentation says this prevents Claude from loading the skill automatically and also prevents preloading it into subagents. Each skill opens with an "Initial Response" block that returns one fixed sentence when invoked without a question. The `animate` skill tells the agent to "stop and invoke `pick-ui-library`", a skill the model is not allowed to invoke: the repo contradicts itself.
- **Implication for /frontend:** /frontend runs inside /execution's autonomous waves, so it should vendor the rule catalogs (STANDARDS.md, AUDIT.md, RECIPES.md, the emil-design-eng tables) as its own references and run its own checks. A human-invoked `/review-animations` pass can be offered to the owner as an optional step outside the loop. Always pass a concrete question when invoking the model-invocable ones (animate, emil-design-eng) or they reply with the canned sentence.
- **Evidence:**
  - [review-animations/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/review-animations/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 4).
    - "disable-model-invocation: true"
  - [pick-ui-library/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/pick-ui-library/SKILL.md) — same, line 3–4 — tool's own file.
    - "Only runs when explicitly invoked; it does not trigger on its own." / "disable-model-invocation: true"
  - [animate/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/SKILL.md) — same, line 81 — tool's own file.
    - "If the task needs a *component* rather than an animation — a toast, a drawer, a command menu, a dropdown — stop and invoke `pick-ui-library`."
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — same, lines 10–14 — tool's own file.
    - "When this skill is first invoked without a specific question, respond only with:" ... "Do not provide any other information until the user asks a question."
    - Command: for each of the 13 `skills/*/SKILL.md` at d16ebe6, `grep -c "## Initial Response"` → 1 in all 13.
  - [Extend Claude with skills](https://code.claude.com/docs/en/skills) — Anthropic, accessed 2026-09-30 — official docs.
    - "Set to true to prevent Claude from automatically loading this skill. Use for workflows you want to trigger manually with /name. Also prevents the skill from being preloaded into subagents."
    - "disable-model-invocation: true: Only you can invoke the skill."
- **Limits / false positives:** Claude Code behaviour can change between versions; the owner could fork the skills and drop the flag (MIT allows it).

### FD03-F03 — The public skill set is explicitly the smaller one; the course's 15 skills (including /scroll-animations and /animation-accessibility) are not public, and enrollment is closed until 2027
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Emil states that the animations.dev skill "consists of multiple files and is a lot more nuanced" than the public one. The course page lists 15 course skills, several absent from the public repo (/animation-performance, /css-animations, /gesture-ui, /motion-brief, /scroll-animations, /animation-accessibility, /debug-animation, /motion-react), plus "a set of custom easing curves that I use in my work". Enrollment is closed; the next window opens "sometime in 2027, for 10 days". A second, newer course exists: emilkowal.ski/skill calls the public skill "just the tip of the iceberg" and says aiforui.dev "comes with a much more thorough set of skills"; aiforui.dev shows only a waitlist, and all 14 emilkowal.ski pages fetched at verification carry the banner "My new course called aiforui.dev is in early access! Early access has closed." (corrected: the dossier treated animations.dev as the only non-public skill set)
- **Implication for /frontend:** Do not claim to embody either course. The public set has no dedicated scroll-animation or accessibility skill, so rules for tell 12 and for reduced motion must also rest on WCAG 2.3.3 and Vercel's guidelines (F15, F19, F28).
- **Evidence:**
  - [Building an animation course](https://emilkowal.ski/ui/building-an-animation-course) — Emil Kowalski, undated post, accessed 2026-09-30 — author's blog.
    - "While the animations.dev skill consists of multiple files and is a lot more nuanced, this one will still help you build better interfaces"
  - [animations.dev](https://animations.dev/) — Emil Kowalski, accessed 2026-09-30 — course landing page.
    - "Enrollment is closed" · "13,000+ designers and engineers have improved their animation skills with this course." · "The next enrollment opens sometime in 2027, for 10 days."
    - "You’ll also get a set of custom easing curves that I use in my work and 15 AI skills based on the course’s content to help you build great animations."
    - Skill names shown on the page (three groups of five, each group repeated three times in a scrolling strip): /animate, /animation-performance, /review-animations, /prototype, /animation-vocabulary; /css-animations, /find-animation-opportunities, /gesture-ui, /motion-brief, /pick-ui-library; /improve-animations, /scroll-animations, /animation-accessibility, /debug-animation, /motion-react.
    - Verification: the raw HTML holds 90 pills; 15 distinct names; a second layout reorders the same 15.
  - [AI Skills for Design Engineers](https://emilkowal.ski/skill) — Emil Kowalski, undated page, accessed 2026-09-30 — author's site (added at verification).
    - "This skill file is just the tip of the iceberg. My new course, aiforui.dev, teaches you how to use AI to build better user interfaces and comes with a much more thorough set of skills"
  - [aiforui.dev](https://aiforui.dev/) — Emil Kowalski, accessed 2026-09-30 — course landing page (added at verification).
    - "A course that teaches you how to use AI to help you build interfaces that people want to use." · "Join the Waitlist"
- **Limits / false positives:** Course content was not accessible (login or waitlist); the rules of either course may refine or contradict the public ones.

### FD03-F04 — Gate 1, frequency of use: 100+ times a day gets no animation, ever; keyboard-initiated actions are never animated
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Emil's first question is how often a user sees the animation. His table: 100+/day (keyboard shortcuts, command palette) no animation; tens/day (hover effects, list navigation) remove or drastically reduce; occasional (modals, drawers, toasts) standard; rare/first-time (onboarding, celebrations) can add delight. Keyboard-initiated actions are a disqualifier. Producing no animation is described as a success.
- **Implication for /frontend:** A hackathon site has two audiences. The jury sees the landing page once (rare tier: explanation and a small delight budget allowed). The product screens shown in the demo should look like a tool used daily (inference, not Emil's claim), so treat them as the tens/day tier: instant state changes, no decorative motion. Any keyboard shortcut in the demo app gets no animation. The frequency gate alone will rarely forbid motion on a one-view landing page, so the owner's tells must add the stricter layer.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 70–79).
    - "| 100+ times/day (keyboard shortcuts, command palette toggle) | No animation. Ever. |" · "| Tens of times/day (hover effects, list navigation) | Remove or drastically reduce |"
    - "**Never animate keyboard-initiated actions.** These actions are repeated hundreds of times daily. Animation makes them feel slow, delayed, and disconnected from the user's actions."
  - [animate/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/SKILL.md) — same, line 24 — tool's own file.
    - "**Animating something that shouldn't animate.** The gate below exists to produce zero lines of code sometimes. That's a success, not a dodge."
  - [You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "A hover effect is nice, but if used multiple times a day, it would likely benefit the most from having no animation at all."
    - "Sometimes this requires animations, but sometimes the best animation is no animation."
  - [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "Remove animations or hover interactions altogether if they are seen tens, maybe even hundreds of times a day. Instead of delighting your users, they’ll quickly become annoying and make your interface feel slower."
- **Limits / false positives:** Frequency is estimated by whoever builds, not measured. The tiers come from product UI practice (Raycast, Linear), not from studies.

### FD03-F05 — Gate 2, purpose: every animation must name one of six purposes; explanatory motion in the first viewport is the sanctioned marketing use
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Valid purposes are feedback, spatial consistency, state indication, preventing a jarring change, explanation (marketing and onboarding only) and delight (rare tier only). "It looks cool" on a frequently seen element blocks. Emil's positive marketing example is an animation that explains how a Linear feature works in the initial viewport, used instead of a static asset.
- **Implication for /frontend:** This matches the owner's goal (the jury must understand at once what the protocol does). The one motion worth spending effort on is an explanatory animation of the protocol's mechanism in the hero. Every other animation should carry a named purpose in a small motion manifest that the checker can read; an entry without a purpose is a finding.
- **Evidence:**
  - [animate/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 52–63).
    - "**Explanation** — demonstrating how something works (marketing/onboarding only)" · "**Delight** — allowed *only* at the rare/first-time tier"
    - `Can't name it? Don't build it. "It looks cool" on a frequently-seen element is a reason to stop.`
  - [You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "This animation explains how Product Intelligence (Linear’s feature) works. We could have used a static asset, but the animated version helps the user understand what this feature does, straight in the initial viewport of the page."
  - [Great Animations](https://emilkowal.ski/ui/great-animations) — Emil Kowalski, undated (not linked from the homepage index on 2026-09-30), accessed 2026-09-30 — author's blog.
    - "It’s easy to start adding animations everywhere. The user then becomes overwhelmed and animations lose their impact."
- **Limits / false positives:** Purpose naming is self-declared; an agent can label anything "explanation". The manifest needs a human glance or a rule such as "one explanatory animation per page".

### FD03-F06 — Easing: ease-out for anything entering or exiting, never ease-in on UI, strong custom curves instead of CSS built-ins
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** Emil's decision tree: entering or exiting → ease-out; moving on screen → ease-in-out; hover or color change → ease; constant motion → linear; default → ease-out. Built-in CSS curves are "too weak"; `ease` is the exception for basic hover color changes. His tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`. Provenance (observed): easing.dev labels the first "Out Quint" and the second "In Out Quart"; the drawer curve and its 500 ms duration are Ionic Framework's iOS modal values. Emil's own examples do not follow the custom-curve rule: emil-design-eng's button press (`transition: transform 160ms ease-out`, line 205), tooltip (`125ms ease-out`, line 253), hold-to-delete release (`200ms ease-out`, lines 415 and 594), stagger (`fadeIn 300ms ease-out`, line 611) and its checklist fix (`transition: transform 200ms ease-out`, line 664) all use the built-in keyword, as does the tooltip CSS in "7 Practical Animation Tips". The ban is scoped: animate's Never Ship row reads "Built-in `ease-out` on a deliberate animation" (line 184) and review-animations flags "weak built-in easing on a deliberate animation" (line 57). (corrected: the dossier missed that Emil's own examples use built-in `ease-out` and that the ban covers "deliberate" animations only)
- **Implication for /frontend:** Define the three tokens once in the design tokens and forbid ad-hoc curves. The checker flags `ease-in` on UI elements; it flags built-in `ease-out`/`ease-in-out` only on deliberate entrances (overlays, the hero, reveals), not on sub-200 ms press or tooltip feedback, or it fires on Emil's own examples; it allows `ease` on color-only hover transitions. (corrected: rule scoped to match the source)
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 95–123).
    - "**Critical: use custom easing curves.** The built-in CSS easings are too weak. They lack the punch that makes animations feel intentional."
    - "**Never use ease-in for UI animations.** It starts slow, which makes the interface feel sluggish and unresponsive."
  - [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "The duration for these dropdowns is identical, 300ms (you can inspect the code to verify this), but the ease-in one feels slower."
    - "The built-in easing curves in CSS are usually not strong enough, which is why I almost never use them."
  - [Good vs Great Animations](https://emilkowal.ski/ui/good-vs-great-animations) — Emil Kowalski, undated (not linked from the homepage index), accessed 2026-09-30 — author's blog.
    - "ease is an exception as it works well for basic hover effects like changing background color, but anything else requires a custom curve for the right feel."
  - [Easing Graphs](https://easing.dev/) — easing.dev, accessed 2026-09-30 — page HTML (OBSERVED).
    - `animation-timing-function:cubic-bezier(0.23, 1, 0.32, 1)` ... `<p>Out Quint</p>`; `cubic-bezier(0.77, 0, 0.175, 1)` ... `<p>In Out Quart</p>`
    - Verification: the page HTML contains no occurrence of "Penner".
  - [animate/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/SKILL.md) and [review-animations/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/review-animations/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own files (animate line 184, review-animations line 57; added at verification).
    - "| Built-in `ease-out` on a deliberate animation | `cubic-bezier(0.23, 1, 0.32, 1)` |"
    - "`ease-in` on any UI interaction; weak built-in easing on a deliberate animation"
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — line 205 — tool's own file (added at verification).
    - ".button { transition: transform 160ms ease-out; }"
  - [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips) — Emil Kowalski, accessed 2026-09-30 — author's blog (added at verification).
    - ".tooltip { transition : transform 0.125 s ease-out , opacity 0.125 s ease-out ;" (as extracted from the page's code block)
  - [ios.enter.ts](https://github.com/ionic-team/ionic-framework/blob/1c89743621a518a84cffc2f604a256ccdce550fd/core/src/components/modal/animations/ios.enter.ts) — Ionic, commit 1c89743 (2026-09-30), accessed 2026-09-30 — source code (lines 42–43).
    - ".easing('cubic-bezier(0.32,0.72,0,1)')" / ".duration(500)"
  - [Building a drawer component](https://emilkowal.ski/ui/building-a-drawer-component) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "The curve used in Vaul closely matches the one used in iOS; it’s from the Ionic Framework. Duration of 500ms is also supposed to mimic iOS’s Sheet."
- **Limits / false positives:** "Feels faster" is a perception claim with no measurement in these sources. NN/g is ambivalent on ease-in for exits: its text warns it "can feel unresponsive" while its demo uses it (F29). The course's own curve set is not public (F03). (corrected: "NN/g allows ease-in on exits" aligned with F29)

### FD03-F07 — Durations: UI under 300 ms with per-element budgets, duration scaling with distance, and speed as perceived performance; two of Emil's tables disagree on modals
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Skill budgets: button press 100–160 ms; tooltips and small popovers 125–200; dropdowns and selects 150–250; modals and drawers 200–500; marketing and explanatory "can be longer"; "UI animations should stay under 300ms". The "Agents with Taste" post gives a different table (micro-interactions 100–150, tooltips and dropdowns 150–250, modals and drawers 200–300) and adds: larger elements animate slower, exits ~20% faster, match duration to distance. Perceived performance: a faster spinner seems to load faster; a 180 ms select feels more responsive than a 400 ms one; subsequent tooltips open instantly. A full-screen menu is his stated exception to the 300 ms rule because of the distance traveled.
- **Implication for /frontend:** Encode budgets per element role: press ≤ 160 ms, tooltip ≤ 200, dropdown ≤ 250, modal ≤ 300 by default, up to 500 only for full-height sheets using the drawer curve; the hero's explanatory animation is exempt but must be named. Record which table was adopted and why, since the sources disagree.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 127–145).
    - "| Modals, drawers | 200-500ms |" · "**Rule: UI animations should stay under 300ms.** A 180ms dropdown feels more responsive than a 400ms one."
    - "A **fast-spinning spinner** makes loading feel faster (same load time, different perception)"
  - [Agents with Taste](https://emilkowal.ski/ui/agents-with-taste) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "| Modals, drawers | 200-300ms |"
    - "Larger elements animate slower than smaller ones" · "Exit animations can be ~20% faster than entrance" · "Match duration to distance - longer travel = longer duration"
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog; breakdown text is revealed after picking an option and is present in the page source (Next.js payload).
    - "A rule of thumb is to keep your UI animations under 300ms. That rule holds for most UI elements like tooltips, dropdowns, and buttons. But because in this case it’s a full-screen menu, the distance traveled is much larger, so a short duration feels jarring."
    - "Duration should scale with the distance traveled. Bigger elements are “heavier” and should animate slower. The same way a truck takes longer to stop than a bicycle."
  - [You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "Unless you are working on marketing sites, your animations have to be fast."
  - [Great Animations](https://emilkowal.ski/ui/great-animations) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "I use Raycast frequently and can’t imagine how frustrating it would be if every time I opened it, I was greeted with a 500ms enter animation."
- **Limits / false positives:** None of these numbers is backed by a study in Emil's sources; the spinner and 180/400 ms comparisons are demonstrations. Blog posts carry no dates, so which table is newer cannot be established from the pages; the skill files date from 2026-03 to 2026-09 by commit.
- **Verification note:** The public emil-design-eng has said "200-500ms" since its first commit (5282ea8, 2026-03-16), and none of the post's tables ("Practical Tips", "Easing Decision Flowchart", "Duration Guidelines", "Typography") appears in the init or the current version of that file. The post links to `/skill` and repeats the 2026-03-16 X announcement's wording ("I turned my blog articles into one big design engineering skill"), so it was published no earlier than the public skill (inference); its 200–300 ms table comes from a skill file that was never public.

### FD03-F08 — Tailwind's default motion is exactly the weak signature the skill rejects: `transition-all`, `cubic-bezier(0.4, 0, 0.2, 1)`, 150 ms
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** In Tailwind v4, `transition-all` compiles to `transition-property: all` with the default timing function `cubic-bezier(0.4, 0, 0.2, 1)` and 150 ms; `ease-in` is `cubic-bezier(0.4, 0, 1, 1)` and `ease-out` is `cubic-bezier(0, 0, 0.2, 1)`. Emil's `animate` skill names that default curve as the one an agent must not reach for, and lists `transition: all` under "Never Ship". Vercel's guidelines also forbid `transition: all`.
- **Implication for /frontend:** Deterministic signatures for a Tailwind build: `transition-all` classes, `ease-in` on UI elements, entrances using the default curve, `duration-500`/`700`/`1000` on UI elements. Replace with named properties and the F06 tokens (`ease-(--ease-out)`), e.g. `transition-[transform,opacity]`.
- **Evidence:**
  - [transition-property](https://tailwindcss.com/docs/transition-property) — Tailwind Labs, v4 docs, accessed 2026-09-30 — official docs.
    - Row `transition-all`: "transition-property: all; transition-timing-function: var(--default-transition-timing-function); /* cubic-bezier(0.4, 0, 0.2, 1) */ transition-duration: var(--default-transition-duration); /* 150ms */"
  - [transition-timing-function](https://tailwindcss.com/docs/transition-timing-function) — Tailwind Labs, v4 docs, accessed 2026-09-30 — official docs.
    - Row `ease-in`: "transition-timing-function: var(--ease-in); /* cubic-bezier(0.4, 0, 1, 1) */" · Row `ease-out`: "transition-timing-function: var(--ease-out); /* cubic-bezier(0, 0, 0.2, 1) */"
  - [animate/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 32, 181).
    - "**No approximated values.** Every curve, duration, and spring config comes from the tables below. Never invent `cubic-bezier(0.4, 0, 0.2, 1)` because it looks familiar."
    - "| `transition: all` | Name the exact properties |"
- **Limits / false positives:** Plain `transition` (not `-all`) lists specific properties, so it is not `transition: all`. The default curve on a color-only hover is compatible with Emil's "hover → ease" rule. A human-designed site also contains these utilities (F24).

### FD03-F09 — Press feedback: `scale(0.97)` on `:active`, 100–160 ms ease-out; 0.9 is too much
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** Every pressable element gets `transform: scale(0.97)` on `:active` with a `transform` transition around 160 ms ease-out; the range is 0.95–0.98. At 0.9 the press is "too much in most cases"; visible shrinking means the scale is too aggressive. `:active` needs no hover gating because it is a real press on touch.
- **Implication for /frontend:** Primary feedback on buttons comes from the press, not from a hover fade (tell 14). Checker: pressable elements (button, `[role=button]`, links styled as buttons) with no `:active` rule are a finding; `active:scale-90` or lower is a finding.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 199–213).
    - "Add `transform: scale(0.97)` on `:active`. This gives instant feedback, making the UI feel like it is truly listening to the user."
    - "This applies to any pressable element. The scale should be subtle (0.95-0.98)."
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog (breakdown in page source).
    - "At 0.9, which B uses, the button loses 10% of its size, that’s too much in most cases. At 0.97, the compression is barely visible but still felt."
    - "If you can clearly see the button shrinking, the scale is too aggressive. Subtlety reads as quality."
  - [animate/RECIPES.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/RECIPES.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 25).
    - "No hover gating needed here: `:active` is a real press on touch. Gate any `:hover` styling separately."
- **Limits / false positives:** Emil allows more compression for a "more playful vibe". "Disabled buttons should not scale" is the researcher's own inference: no Emil skill file mentions disabled states (grep for "disabled" across the 13 skills finds nothing outside write-swift). (corrected: unsourced sentence labelled as inference)

### FD03-F10 — Entrances start from scale 0.9–0.97 plus opacity; never `scale(0)`; the review skill flags pure-fade entrances
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** An element should never animate in from `scale(0)` ("comes out of nowhere"); start from 0.9 or higher with opacity (his demo uses 0.93, the skill defaults to 0.95). The strict review skill lists "`scale(0)` or pure-fade entrances with no initial transform" among the triggers to flag on sight.
- **Implication for /frontend:** Checker flags `scale(0)`/`scale-0` start states and opacity-only entrances in the no-preference media context. This rule catches only the opacity-only variant of tell 12. It does not catch the fade-up (opacity 0 plus `translateY`), which has an initial transform and is exactly what Emil's own stagger examples use (`opacity: 0; transform: translateY(8px)`, F18); tell 12 needs its own scroll-trigger signatures (F19). No source measures which variant is most common. (corrected: "catches the most common implementation of tell 12" was unsourced and overstated)
- **Evidence:**
  - [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "Try animating from a higher initial scale instead (0.9+). It makes the movement feel more gentle, natural, and elegant." · "I’m using an initial scale of 0.93 here."
  - [review-animations/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/review-animations/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 56; corrected from 57).
    - "`scale(0)` or pure-fade entrances with no initial transform"
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog (breakdown in page source).
    - "scale(0) means the element came from nowhere making it feel unnatural. Start from 0.90-0.95. It should feel like it was always almost there."
- **Limits / false positives:** Under `prefers-reduced-motion: reduce` a pure fade is the recommended fallback (F15), so evaluate this rule only without the reduce preference.

### FD03-F11 — Origin-aware popovers (modals exempt) and instant subsequent tooltips; Base UI exposes both hooks
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Popovers, dropdowns and tooltips scale from their trigger via `transform-origin`, not from center; modals keep `center`. Tooltips keep an initial delay, but once one is open, neighbours open with no delay and no animation. Base UI's docs confirm both hooks: a `--transform-origin` variable and a `data-instant` attribute, and a Tooltip Provider that shows adjacent tooltips instantly. Emil notes that shadcn/ui already sets the origin.
- **Implication for /frontend:** Build overlays on Base UI or Radix primitives, which expose the origin variables; add `[data-instant] { transition-duration: 0ms }` for tooltips. Checker: a trigger-anchored overlay animating `transform` without an origin variable is a finding; modals are exempt.
- **Evidence:**
  - [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "They should scale in from the trigger. You’ll need CSS’s transform-origin for this, but its default value is center, which is wrong in most cases."
    - "In the aggregate, unseen details become visible, they compound."
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 236).
    - "**Exception: modals.** Modals should keep `transform-origin: center` because they are not anchored to a specific trigger"
  - [Tooltip](https://base-ui.com/react/components/tooltip) — Base UI (MUI), accessed 2026-09-30 — official docs (page HTML).
    - "data-instant" · "Present if animations should be instant."
    - "--transform-origin" · "The coordinates that this element is anchored to."
    - "Provides a shared delay for multiple tooltips. The grouping logic ensures that once a tooltip becomes visible, the adjacent tooltips will be shown instantly."
  - [Good vs Great Animations](https://emilkowal.ski/ui/good-vs-great-animations) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "If you are using shadcn/ui, the work is already done for you."
- **Limits / false positives:** Base UI's tracker holds `data-instant` bugs, not Tooltip regressions: `gh search issues "data-instant" --repo mui/base-ui` returns #5593 (open, 2026-08-28, "[context menu] Right-click open is marked as instant") and #5350 (closed, 2026-07-27, "[combobox] Remove unsupported data-instant documentation"); neither concerns Tooltip. (corrected: "regressions" was unsupported)

### FD03-F12 — Interruptibility: CSS transitions or springs for anything that can be re-triggered; keyframes restart from zero
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Transitions retarget from the current value, keyframes restart, so anything a user can fire twice in a second (toasts, toggles, menus, modals, accordions, drawers) uses transitions, and gestures use springs. Sonner started with keyframes and moved to transitions for this reason. Rauno Freiberg and Vercel's guidelines state the same principle.
- **Implication for /frontend:** Checker: `@keyframes` or `animate-in`/`animate-out` utilities on toggleable UI are a finding (this includes untouched shadcn overlays, F22). One-shot keyframes (a hero illustration, a loader) are fine.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 271).
    - "CSS transitions can be interrupted and retargeted mid-animation. Keyframes restart from zero."
  - [Building a toast component](https://emilkowal.ski/ui/building-a-toast-component) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "When it comes to the code, I initially used CSS keyframes for the animations, but they aren’t interruptible."
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog (breakdown in page source).
    - "For any interactive element that can be toggled rapidly, like menus, modals, accordions, and drawers, prefer CSS transitions over keyframe animations since they are interruptible and animate smoothly to the new, updated value."
  - [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design) — Rauno Freiberg, July 2023, accessed 2026-09-30 — essay.
    - "Great interactions are modeled after properties from the real world, like interruptability. This sounds kinda silly because, duh, obviously flipping a page in a book is interruptible. But imagine if it were an animation that you had to wait for!"
- **Limits / false positives:** Emil's own libraries still use keyframes for some enter/exit paths (F23).

### FD03-F13 — Springs are for drag, interruptible gestures, "alive" elements and decorative pointer tracking; bounce defaults to zero
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** Springs fit drag with momentum, elements that should feel alive, interruptible gestures and decorative mouse tracking. Configs given: `{ type: "spring", duration: 0.5, bounce: 0.2 }` (labelled "Apple's approach (recommended — easier to reason about)" in emil-design-eng line 179, and used as the settle spring of RECIPES.md's drag-to-dismiss) or `{ mass: 1, stiffness: 100, damping: 10 }`; bounce 0.1–0.3 "when used", avoided in most UI. His exercise is firmer: "No bounce should be your default"; bounce reads as unserious for a finance app. His apple-design skill starts UI springs critically damped. On 2026-09-23 he posted that he replaced a spring with ease-out on a Linear dialog "so it feels less abrupt". (corrected: the label was quoted truncated as "Apple's approach (recommended)")
- **Implication for /frontend:** Crypto and finance protocols get zero bounce. Use springs only where a gesture exists; dialogs and popovers use the ease-out token. Do not copy the `bounce: 0.2` example as a default.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 151–195).
    - "Keep bounce subtle (0.1-0.3) when used. Avoid bounce in most UI contexts. Use it for drag-to-dismiss and playful interactions."
    - "Springs maintain velocity when interrupted — CSS animations and keyframes restart from zero."
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog (breakdown in page source).
    - "For a learning app, the bounce adds energy and personality, it feels approachable and alive. For a finance app, that same bounce feels unserious, and you want to feel like your money is in safe hands."
    - "I tend to avoid bounce in most cases, and if I do use it, it’s a very small value. No bounce should be your default."
  - [apple-design/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/apple-design/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 85–86).
    - "Start most UI at **damping `1.0`** (critically damped) — graceful and non-distracting."
  - [X post 2102798004281635184](https://x.com/emilkowalski/status/2102798004281635184) — Emil Kowalski, 2026-09-23T16:31:26Z, accessed 2026-09-30 via `cdn.syndication.twimg.com` — social post, corroboration only.
    - "Matched the previously mismatched animation duration of overlay and the dialog + swapped spring animaton for an ease-out one so it feels less abrupt."
- **Limits / false positives:** The X post is a single anecdote (D-level evidence on its own). The spring numbers are defaults, not measured optima.

### FD03-F14 — Enter versus exit: leave along the same path, and make the system's response faster than the user's deliberate phase
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Two distinct rules. Spatial symmetry: exit the way it entered (a toast from the bottom leaves through the bottom). Timing asymmetry: slow where the user is deciding (hold-to-confirm 2 s linear), snappy where the system responds (release 200 ms ease-out). The skill's checklist turns this into "make exit faster than enter", and the "Agents with Taste" post quantifies ~20%. NN/g gives 300 ms in, 200–250 ms out. Rauno notes macOS context menus appear with no motion but fade out.
- **Implication for /frontend:** Exit durations ≈ 0.8 × entrance; exit direction mirrors entrance. Destructive actions in a demo app can use hold-to-confirm (2 s linear fill, 200 ms release).
- **Evidence:**
  - [animate/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 147–148).
    - "**Exit the way it entered.** A toast that slides in from the bottom leaves through the bottom."
    - "**Asymmetric timing where the user is deciding.** Slow on the deliberate phase (a hold-to-confirm press: 2s linear), snappy on the system response (release: 200ms ease-out)."
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — same, line 673 — tool's own file.
    - "| Same enter/exit transition speed | Make exit faster than enter (e.g., enter 2s, exit 200ms) |"
  - [Agents with Taste](https://emilkowal.ski/ui/agents-with-taste) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "Exit animations can be ~20% faster than entrance"
  - [Executing UX Animations: Duration and Motion Characteristics](https://www.nngroup.com/articles/animation-duration/) — Page Laubheimer, NN/g, 2020-02-09, accessed 2026-09-30 — practitioner research article.
    - "a popup window may take 300ms to appear, but only 200 or 250ms to disappear."
  - [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design) — Rauno Freiberg, July 2023, accessed 2026-09-30 — essay.
    - "Interestingly enough, the menu subtly fades out."
- **Limits / false positives:** The checklist's "enter 2s, exit 200ms" comes from the hold-to-delete case; it is not a general 10:1 ratio.

### FD03-F15 — Reduced motion means "fewer and gentler, not zero"; nothing in /harden's axe pass checks it
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Emil: keep opacity and color transitions that aid comprehension, remove movement, ship reduced-motion handling with the animation, and treat reduced-motion code that "nukes all feedback" as a finding. WCAG 2.3.3 Animation from Interactions (Level AAA) requires that motion triggered by interaction can be disabled; its definition of motion animation excludes color and opacity changes (an erratum amends it so blurring is no longer excluded). axe-core's rule list has no motion rule except `blink` and `marquee` (observed). Playwright can emulate the preference (`page.emulateMedia({ reducedMotion: 'reduce' })`, since v1.12).
- **Implication for /frontend:** /frontend must own this check: load the site twice in Playwright (no-preference, reduce) and diff the animations (F25); under reduce, only opacity and color may animate. /harden's axe run with wcag2a..wcag22aa tags cannot catch it (2.3.3 is AAA and axe has no rule for it).
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 529).
    - "Animations can cause motion sickness. Reduced motion means fewer and gentler animations, not zero. Keep opacity and color transitions that aid comprehension. Remove movement and position animations."
  - [improve-animations/AUDIT.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/improve-animations/AUDIT.md) — same, line 95 — tool's own file.
    - "Hunt for: movement with no `prefers-reduced-motion` handling, ungated `:hover` motion, reduced-motion implementations that nuke all feedback."
  - [Understanding SC 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) — W3C WAI, WCAG 2.2 Understanding, accessed 2026-09-30 — standard.
    - "Motion animation triggered by interaction can be disabled, unless the animation is essential to the functionality or the information being conveyed."
    - "Motion animation does not include changes of color, blurring, or opacity which do not change the perceived size, shape, or position of the element."
    - Errata listed on the page: "Amending the definition to not exclude blurring"
  - [axe-core rule descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md) — Deque, develop 72e8624 (2026-09-30), accessed 2026-09-30 — source docs (OBSERVED).
    - `grep -i -E "motion|animat|blink|marquee|2\.3\.3"` → only "Ensure &lt;blink&gt; elements are not used" and "Ensure &lt;marquee&gt; elements are not used".
  - [class-page.md](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-page.md) — Microsoft Playwright, main, accessed 2026-09-30 — official API docs source.
    - "### option: Page.emulateMedia.reducedMotion" · "since: v1.12" · "Emulates `'prefers-reduced-motion'` media feature, supported values are `'reduce'`, `'no-preference'`."
- **Limits / false positives:** WCAG 2.3.3 is AAA, not required for AA conformance. Emil's own Sonner turns motion fully off under the preference (F23), so "not zero" is his recommendation, not universal practice.

### FD03-F16 — Gate hover motion behind `(hover: hover) and (pointer: fine)`; Tailwind v4's `hover:` adds `(hover: hover)` but not `(pointer: fine)`
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Touch devices fire `:hover` on tap and leave it stuck, so Emil gates hover motion behind both media features. Tailwind v4's `hover` variant compiles to `@media (hover: hover) { &:hover }` (no `pointer: fine`); Emil's mobile-native skill states the Tailwind v4 behaviour correctly.
- **Implication for /frontend:** The checker must read compiled CSS, not source classes. In Tailwind v4 projects, hover utilities are already half-gated; plain-CSS `:hover` transforms outside a media query are the real finding.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 555).
    - "Touch devices trigger hover on tap, causing false positives. Gate hover animations behind this media query."
  - [mobile-native/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/mobile-native/SKILL.md) — same, line 70 — tool's own file.
    - "In Tailwind v4 the `hover:` variant already compiles to `@media (hover: hover)`; in v3 set `future.hoverOnlyWhenSupported`."
  - [Upgrade guide](https://tailwindcss.com/docs/upgrade-guide) — Tailwind Labs, v4 docs, accessed 2026-09-30 — official docs.
    - "In v4 we've updated the hover variant to only apply when the primary input device supports hover:"
  - [Hover, focus, and other states](https://tailwindcss.com/docs/hover-focus-and-other-states) — Tailwind Labs, v4 docs, accessed 2026-09-30 — official docs (page HTML).
    - "@media (hover: hover) { &:hover }"
- **Limits / false positives:** Hybrid devices (touchscreen laptops) can report `hover: none`; a gated hover then never shows (reported in Tailwind discussion #17225, seen in search results only).
- **Verification note:** Discussion #17225 ("Tailwind v4.0.14 hover: is not working even on a simple button", 2025-03-15) was read through the GitHub GraphQL API. The touchscreen-laptop case is a user comment of 2026-01-19 ("it didn't catch the edge case where a desktop/laptop reports itself as a touch device because it has a touchscreen"), not a Tailwind statement; treat it as a D-level report. Emil's site itself compiles hover utilities under `@media (hover:hover) and (pointer:fine)` (F24).

### FD03-F17 — Performance: animate `transform` and `opacity`; in Motion use the full `transform` string; never drive child transforms through a parent CSS variable; blur under 20 px
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Emil: only `transform` and `opacity` skip layout and paint; Motion's `x`/`y`/`scale` shorthands run on the main thread and drop frames under load; CSS animations beat rAF-driven JS while the page is busy; changing a CSS variable on a parent recalculates styles for all children (the Vaul lag he spent hours on); keep animated blur under 20 px; add `will-change: transform` only when you see a 1 px shift. Motion's own docs confirm the shorthand claim and frame acceleration as progressive enhancement.
- **Implication for /frontend:** Checker: transitions on `width`/`height`/`top`/`left`/`margin`/`padding` (accordion height excepted), `transition: all`, `animate={{ x: ... }}` on content-heavy pages (low severity), `setProperty('--…')` inside pointer handlers driving child transforms.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 479–511).
    - "These properties skip layout and paint, running on the GPU. Animating `padding`, `margin`, `height`, or `width` triggers all three rendering steps."
    - "Framer Motion's shorthand properties (`x`, `y`, `scale`) are NOT hardware-accelerated."
  - [Animation performance guide](https://motion.dev/docs/performance) — Motion, undated docs page, accessed 2026-09-30 — official docs.
    - "Under the hood, it is animating CSS variables, and currently these are not accelerated, even though they're being applied to `transform`."
    - "We recommend treating acceleration like progressive enhancement. It's great when a browser supports it, but usually not essential."
  - [Building a drawer component](https://emilkowal.ski/ui/building-a-drawer-component) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "Since CSS Variables are inheritable, changing them will cause style recalculation for all children, meaning the more items I have in my drawer, the more expensive the calculation gets."
  - [performance-cheatsheet.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/performance-cheatsheet.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file.
    - "| Element shifts 1px as motion starts | `will-change: transform` (only once you see it) |"
- **Limits / false positives:** Motion's docs say layout-triggering properties can animate smoothly on isolated elements (`position: absolute`); the 20 px blur limit is an assertion without a benchmark.

### FD03-F18 — Stagger and tell 12: the skill tells agents to add 30–80 ms staggers wherever things appear together, while Emil's exercise says uniform stagger "feels artificial" and layered entrances should be avoided
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** The emil-design-eng checklist and animate's "Never Ship" list treat "everything entering at once" as a defect to fix with a 30–80 ms stagger, and the example uses equal 50 ms steps. The RECIPES version limits stagger to lists the user sees occasionally. In "Train Your Judgement", Emil rejects a hero whose elements stagger with identical timing ("the same effect on motion as a linear easing"), endorses hierarchy-based timing where the badge-like pill only fades, and rejects a panel whose items stagger in after the panel ("Avoid layered entry animations").
- **Implication for /frontend:** Do not import the "add stagger" checklist item as a default; it is the path by which an agent following Emil produces tell 12. Checker signatures: arithmetic delays (`nth-child` × constant, `index * 0.05`, `delay-[50ms]`, `delay-[100ms]`…), stagger on scroll-triggered sections, stagger inside an element that itself animates in. A hero may use one hierarchy-ordered entrance with unequal delays.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 614–635, 674).
    - ".item:nth-child(2) { animation-delay: 50ms; }" ... ".item:nth-child(4) { animation-delay: 150ms; }"
    - "| Elements all appear at once | Add stagger delay (30-80ms between items) |"
  - [animate/RECIPES.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/RECIPES.md) — same, line 172 — tool's own file.
    - "For a list or grid the user sees occasionally — not for a list they scroll past all day."
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog (breakdown in page source).
    - "Version B staggers every element top-to-bottom with identical timing. Same duration, same distance, same easing. It’s technically staggered, but it feels artificial, because each delay is exactly the same. It has the same effect on motion as a linear easing."
    - "Uniform stagger removes any sense of hierarchy and makes the movement feel artificial. Think about which elements deserve the most attention. Ensure the delays are not the same to make the motion feel more organic."
    - "The pill at the top doesn’t slide at all, it just fades in, because it’s the least important element."
    - "Avoid layered entry animations to save time and keep the user in their flow."
- **Limits / false positives:** The exercise page is undated, so it cannot be ordered against the skill text. The exercise's hero includes a pill above the headline (the owner's tell 9); Emil uses it as a neutral example, not a recommendation.
- **Verification note:** The stagger push is wider than the two files cited. `grep -rn -E "30(-|–)80" skills` at d16ebe6 finds it in six web files (emil-design-eng lines 635 and 674, animate line 193, review-animations line 68 as an "Aggressive Escalation Trigger", review-animations/STANDARDS.md line 151, improve-animations/AUDIT.md lines 101 and 104 "list/grid entrances with no stagger", find-animation-opportunities line 95) plus animate-expo/RECIPES.md line 245. Three files carry the same uniform-step example (`opacity: 0; transform: translateY(8px)`, delays in 50 ms steps: 50/100/150 ms in the first two, 50/100 ms in the third): emil-design-eng lines 607–633, animate/RECIPES.md lines 174–191, STANDARDS.md lines 153–158.

### FD03-F19 — Scroll reveal and tell 12: Emil's scroll-reveal recipes are one-shot clip-path reveals, one of them restricted to marketing surfaces; none of his sources recommends a fade on every section
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** The RECIPES.md scroll-reveal recipe says "Marketing surfaces only", triggers via IntersectionObserver or `useInView` with `{ once: true, margin: "-100px" }`, reveals with `clip-path: inset(0 0 100% 0)` → `inset(0 0 0 0)` over 600 ms, and must fire once. It is not his only scroll recipe: emil-design-eng's "Image reveals on scroll" (lines 431–433) gives the same clip-path reveal with `{ once: true, margin: "-100px" }` and no marketing-only restriction, and the clip-path post also builds a scroll-linked "Scroll progress" line with Framer Motion's `useScroll`. In that post Emil says he usually uses Framer Motion and recommends the Intersection Observer API only "if you are not using this library in your project already", because Framer Motion "is quite heavy". WCAG 2.3.3's intent names scroll-triggered movement as a vestibular trigger; NN/g warns about parallax and scroll-jacking. (corrected: "only scroll recipe ... marketing surfaces only" overclaimed, and the Intersection Observer advice is conditional)
- **Implication for /frontend:** Default policy for tell 12: no scroll-triggered entrance on text sections; at most one purposeful reveal per page (a diagram that explains the mechanism), `once: true`, no movement under reduced motion. Checker signatures: `whileInView`, `useInView`, IntersectionObserver callbacks toggling classes on elements with an initial `opacity: 0` (+ `translateY`), `once: false`, `data-aos` attributes, the same reveal repeated across N sections (N calibrated on control sites).
- **Evidence:**
  - [animate/RECIPES.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/RECIPES.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 238–253).
    - "Marketing surfaces only. Don't do this to functional UI a user visits daily."
    - "Trigger with `IntersectionObserver`, or Motion's `useInView` with `{ once: true, margin: "-100px" }`. Fire it once — re-animating on every scroll-by is an interface fighting its reader."
  - [The Magic of Clip Path](https://emilkowal.ski/ui/the-magic-of-clip-path) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "But if you are not using this library in your project already, I’d suggest you use the Intersection Observer API, as Framer Motion is quite heavy."
    - Added at verification: "I usually use Framer Motion for animations, so I’ll show you how to do it with it." · "Another scroll interaction we can create with clip-path is this vertical line that gets longer as we scroll down." · "In this case I used the useScroll hook from Framer Motion to get the scroll progress of our container."
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 431–433; added at verification).
    - "### Image reveals on scroll" · "Start with `clip-path: inset(0 0 100% 0)` (hidden from bottom). Animate to `inset(0 0 0 0)` when the element enters the viewport. Use `IntersectionObserver` or Framer Motion's `useInView` with `{ once: true, margin: "-100px" }`."
  - [Understanding SC 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) — W3C WAI, accessed 2026-09-30 — standard.
    - "For example, if scrolling a page causes elements to move (other than the essential movement associated with scrolling) it can trigger vestibular disorders."
    - "Only add non-essential animation to the scrolling interaction in a responsible way. Always give users the ability to turn off unnecessary movement."
  - [Executing UX Animations](https://www.nngroup.com/articles/animation-duration/) — Page Laubheimer, NN/g, 2020-02-09, accessed 2026-09-30 — practitioner article.
    - "(Be cautious with parallax or scroll-jacking animations, as these are frequently frustrating, dizzying, and annoying.)"
- **Limits / false positives:** Emil gives no numeric cap on reveals per page. A pure opacity fade is not "motion animation" under WCAG's definition, so WCAG alone does not forbid a fade-in on scroll; the ban comes from the owner's tell and Emil's pure-fade flag (F10).

### FD03-F20 — Pointer-tracking effects and tell 13: Emil permits decorative mouse tracking on marketing pages if spring-smoothed, so the owner's tell is stricter than Emil
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Emil lists "decorative mouse-tracking interactions" as a use for springs, says tying visuals directly to the mouse position "feels artificial" without spring interpolation, and restricts such effects to decoration: "on a marketing page, not on a graph in a banking app". His purpose gate still applies ("it looks cool" is not a purpose; delight only at the rare tier). He does not address beams or spotlights by name.
- **Implication for /frontend:** Adopt the owner's stricter rule: no cursor-following beam or spotlight by default. Any pointer-coupled effect that survives must (a) serve an explanatory purpose or live only in the one-time hero, (b) use spring interpolation, (c) be gated by `(hover: hover) and (pointer: fine)` and disabled under reduced motion. Checker signature: `mousemove`/`pointermove` listeners that write CSS custom properties, transforms, or `radial-gradient(… var(--x) var(--y))` backgrounds.
- **Evidence:**
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 156–175).
    - "Tying visual changes directly to mouse position feels artificial because it lacks motion. Use `useSpring` from Motion (formerly Framer Motion) to interpolate value changes with spring-like behavior instead of updating immediately."
    - "This works because the animation is **decorative** — it doesn't serve a function. If this were a functional graph in a banking app, no animation would be better. Know when decoration helps and when it hinders."
  - [animate/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/SKILL.md) — same, line 65 — tool's own file.
    - "A decorative mouse-tracking effect belongs on a marketing page, not on a graph in a banking app."
  - [Good vs Great Animations](https://emilkowal.ski/ui/good-vs-great-animations) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "Changing a component based on mouse position is a nice way to add interactivity to your UI in a subtle way. However, tying visual changes directly to mouse position can feel artificial, as it lacks motion."
- **Limits / false positives:** For a recorded-video submission (TOKEN2049 Origins), a pointer effect shows only along the path the recorder moves the cursor (inference, not from a source).

### FD03-F21 — Hover fades and tell 14: on a frequently used list, a fading hover highlight "trails behind your cursor"; Vercel requires hover to increase contrast; shadcn's default button fades its background on hover
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** In "Train Your Judgement", the list whose hover background "fades in gently" loses to the one with an instant highlight, because the fade lags the pointer; Emil adds that what looks better in a demo can serve the user worse. The verdict is scoped to frequency: the exercise asks "Which feels better for something you’d use frequently?" and the breakdown says the instant highlight wins "For something you interact with hundreds of times a day, like navigating a sidebar or scanning a menu". It concerns list items, not buttons, and under Emil's frequency table a page the jury sees once would sit in the rare/first-time tier (inference from the F04 table; Emil does not place marketing pages in a tier). His skill prescribes `ease` for hover color changes and puts button feedback on `:active` (F09). Vercel's guidelines: `:hover`, `:active`, `:focus` have more contrast than the rest state. shadcn's `new-york-v4` Button (observed) combines `transition-all` with `hover:bg-primary/90` (and `hover:bg-secondary/80`) and has no `active:` class. (corrected: the frequency scoping of the exercise was missing, which made the source look like a general rule against hover fades)
- **Implication for /frontend:** Checker rule for tell 14: on primary actions, hover styles that lower opacity (`hover:opacity-*` below 100, alpha-reduced `hover:bg-*/NN` on filled buttons) are a finding; replace with a contrast-increasing hover state (color change, no transition longer than about 150 ms) plus `:active` scale 0.97.
- **Evidence:**
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog (breakdown in page source).
    - "B feels smoother at first glance. The background fades in gently, it looks polished. But move your mouse quickly between items and you’ll notice the highlight trails behind your cursor. It’s always one step behind."
    - "A’s highlight is instant. It tracks your mouse perfectly. There’s no delay between your intention and the interface’s response."
    - "You need to be aware of what looks better in a demo versus what serves the user better in context."
    - Added at verification: "Hover through both lists. Which feels better for something you’d use frequently?" · "For something you interact with hundreds of times a day, like navigating a sidebar or scanning a menu, that direct connection matters more than smoothness or delight."
  - [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — vercel-labs, commit e3d624b (2026-08-18), accessed 2026-09-30 — official guidelines.
    - "**Interactions increase contrast.** `:hover`, `:active`, `:focus` have more contrast than rest state."
  - [button.tsx (new-york-v4)](https://github.com/shadcn-ui/ui/blob/b0fcb58a6e7c4df1a88f7f6327b083592c2dfd9c/apps/v4/registry/new-york-v4/ui/button.tsx) — shadcn, commit b0fcb58 (2026-09-30), accessed 2026-09-30 — source code (OBSERVED).
    - "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none ..."
    - `default: "bg-primary text-primary-foreground hover:bg-primary/90",` · `"bg-secondary text-secondary-foreground hover:bg-secondary/80",`
- **Limits / false positives:** That `bg-primary/90` lowers text contrast is my inference from alpha blending under shadcn's default tokens, not measured. Emil does not forbid animated hover color changes; "fade" in the owner's tell 14 is ambiguous (opacity drop versus any animated color change).

### FD03-F22 — Untouched shadcn/ui motion (tell 11) half-complies with Emil's rules
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** shadcn `new-york-v4` popover, dropdown-menu and tooltip are origin-aware (`origin-(--radix-…-transform-origin)`) and enter from `zoom-in-95` with a fade, which matches Emil's origin and scale rules. They animate through tw-animate-css keyframe utilities (`animate-in`/`animate-out`) whose defaults are 150 ms and the built-in `ease`, which conflicts with his interruptibility and "built-in easings are too weak" rules. The dialog uses `duration-200`. The Button uses `transition-all` and has no press state.
- **Implication for /frontend:** Restyle shadcn motion before shipping: named transition properties, `active:scale-[0.97]`, the strong ease-out token for overlays (`--tw-ease` or explicit classes), and transitions rather than keyframes for toggleable overlays. The exact class strings above double as a detector for "untouched shadcn".
- **Evidence:**
  - [popover.tsx, dropdown-menu.tsx, tooltip.tsx, dialog.tsx (new-york-v4)](https://github.com/shadcn-ui/ui/tree/b0fcb58a6e7c4df1a88f7f6327b083592c2dfd9c/apps/v4/registry/new-york-v4/ui) — shadcn, commit b0fcb58, accessed 2026-09-30 — source code (OBSERVED).
    - Command: `curl -sL …/new-york-v4/ui/popover.tsx | grep -o -E "(origin-\([^)]*\)|animate-[a-z-]+|fade-[a-z]+-[0-9]+|zoom-[a-z]+-[0-9]+|duration-[0-9]+)"` → `animate-in`, `animate-out`, `fade-in-0`, `fade-out-0`, `origin-(--radix-popover-content-transform-origin)`, `zoom-in-95`, `zoom-out-95` (dropdown and tooltip same pattern; dialog adds `duration-200`, no origin).
  - [tw-animate.css](https://github.com/Wombosvideo/tw-animate-css/blob/1fc30d2b5ad6ab18baf7897828e44ab20a0a62ed/src/tw-animate.css) — Wombosvideo, commit 1fc30d2 (2026-02-28), accessed 2026-09-30 — source code (lines 163, 166).
    - "--animate-in: enter var(--tw-animation-duration, var(--tw-duration, 150ms)) var(--tw-ease, ease)"
  - [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "The built-in easing curves in CSS are usually not strong enough, which is why I almost never use them."
- **Limits / false positives:** Read from source, not rendered. shadcn's other bases (`bases/base`, `bases/radix`) use `cn-*` classes and were only checked for `transition-all` (present in both).
- **Verification note:** Re-run at b0fcb58 (2026-09-30, "chore(templates): update starter templates"): same classes, plus `slide-in-from-{top,bottom,left,right}-2` on popover, dropdown-menu and tooltip, which the dossier's regex did not match, so these overlays also slide on entry by `2 * var(--spacing)` (tw-animate.css line 424), 0.5rem at Tailwind v4's default `--spacing: 0.25rem` (tailwindcss `packages/tailwindcss/theme.css` line 325, main, accessed 2026-09-30). The new-york-v4 style lists `tw-animate-css` as a devDependency and injects `@import "tw-animate-css"` (registry.ts lines 26 and 29), so the 150 ms / `ease` defaults apply to an untouched install.

### FD03-F23 — Emil's own libraries break several rules in his skill; treat his numbers as tuned defaults, not laws
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Sonner (commit 8e4662b, 2026-08-10) turns off all transitions and animations under `prefers-reduced-motion`, transitions `height` (a layout property), and uses keyframes for swipe-out; its 0.11 velocity threshold is, in Emil's words, from "trial and error". Vaul (commit 3e97aac, 2025-10-03) uses a different velocity threshold (0.4), animates open/close with `@keyframes`, has no reduced-motion handling in its CSS or main component, and its README says the repo is unmaintained. The skill's "13M+ weekly npm downloads" for Sonner is stale: npm reports 61,026,624 downloads for 2026-09-22..28 (Vaul 44,717,019).
- **Implication for /frontend:** The checker needs documented exceptions (toasts at ~400 ms `ease`, full-height drawers at 500 ms, one-shot exit keyframes) and must not import constants such as 0.11 as universal. Flag Vaul as unmaintained if an agent reaches for it.
- **Evidence:**
  - [sonner/src/styles.css](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/styles.css) — Emil Kowalski, commit 8e4662b, accessed 2026-09-30 — source code (OBSERVED).
    - "@media (prefers-reduced-motion) { [data-sonner-toast], [data-sonner-toast] > *, .sonner-loading-bar { transition: none !important; animation: none !important; } }"
    - "transition: transform 400ms, opacity 400ms, height 400ms, box-shadow 200ms;"
  - [Building a toast component](https://emilkowal.ski/ui/building-a-toast-component) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "// 0.11 is just a number that I ended up on through trial and error"
  - [vaul/src/constants.ts](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/constants.ts) and [style.css](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/style.css) — Emil Kowalski, commit 3e97aac, accessed 2026-09-30 — source code (OBSERVED).
    - "export const VELOCITY_THRESHOLD = 0.4;" · "animation-name: slideFromBottom;" · `grep -c -i "reduced-motion"` on style.css → 0; `grep -c -i "reduce"` on src/index.tsx → 0
  - [vaul README](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/README.md) — Emil Kowalski, accessed 2026-09-30 — repository file.
    - "This repo is unmaintained. I might come back to it at some point, but not in the near future."
  - [npm downloads API](https://api.npmjs.org/downloads/point/last-week/sonner) — npm, accessed 2026-09-30 — registry data (MEASURED by npm).
    - `{"downloads":61026624,"start":"2026-09-22","end":"2026-09-28","package":"sonner"}` · vaul: `{"downloads":44717019,…}`
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — line 559 — tool's own file.
    - "These principles come from building Sonner (13M+ weekly npm downloads)"
- **Limits / false positives:** Sonner's swipe-out keyframes run at the end of a gesture and are not re-triggered, a reasonable exception to the transitions rule.
- **Verification note:** 8e4662b and 3e97aac are still the HEADs of sonner and vaul on 2026-09-30; Sonner's `src/index.tsx` line 348 still dismisses on `velocity > 0.11` with `SWIPE_THRESHOLD = 45` (line 40). A grep of all 13 files under Vaul's `src/` for `reduced-motion|prefers-reduced|useReducedMotion` finds nothing, so the absence of reduced-motion handling holds for the whole library, not only the two files checked.

### FD03-F24 — A human-designed control site fails naive motion greps: emilkowal.ski's compiled CSS contains `transition-all`, `ease-in` and the Tailwind default curve 11 times
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The two stylesheets linked from emilkowal.ski (fetched 2026-09-30) define `.transition-all` with the Tailwind default curve and 150 ms, an `.ease-in` utility, 11 occurrences of `cubic-bezier(.4,0,.2,1)`, one reduced-motion rule (`motion-reduce:transition-none`), and hover utilities wrapped in `@media (hover:hover) and (pointer:fine)`. Tailwind only emits utilities found in the scanned source, so these are used somewhere on the site, possibly in deliberate counter-example demos (the ease-in dropdown in "7 Practical Animation Tips").
- **Implication for /frontend:** Like /prose, the motion checker must be tuned until silent on human control sites. Class presence is not evidence: measure per element and per context at runtime (F25), weight by role (entrance, overlay, hover), and exempt comparison demos. Include emilkowal.ski in the control corpus precisely because it is an expert site that trips naive rules.
- **Evidence:**
  - [emilkowal.ski](https://emilkowal.ski/) — Emil Kowalski, CSS `/_next/static/css/4691d38b7dfb2187.css` and `/_next/static/css/d54e455ee7d8468f.css`, accessed 2026-09-30 — site assets (OBSERVED).
    - Command: download both CSS files, then `grep -o -E 'cubic-bezier\([^)]*\)' all.css | sort | uniq -c` → `11 cubic-bezier(.4,0,.2,1)`, `2 cubic-bezier(.165,.84,.44,1)`, `1 cubic-bezier(0,0,.2,1)`, `1 cubic-bezier(.4,0,1,1)`, `1 cubic-bezier(.25,.46,.45,.94)`
    - Selectors: `.transition-all{transition-property:all;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}` · `.ease-in{transition-timing-function:cubic-bezier(.4,0,1,1)}` · `@media (prefers-reduced-motion:reduce){.motion-reduce\:transition-none{transition-property:none}` · `@media (hover:hover) and (pointer:fine){.hover\:-translate-y-2:hover{…}`
- **Limits / false positives:** I did not map utilities to elements or pages; the CSS is shared across the blog and its demos. One site is not a corpus.
- **Verification note:** Both stylesheets are still the ones linked from the homepage; the counts and selectors reproduce exactly. The compiled syntax (`--tw-translate-y`, `--tw-bg-opacity`, `:is(.dark …)`) is Tailwind v3 output. `transition-all` is not confined to counter-example demos: in the server-rendered HTML it sits on production buttons, the "Copy to clipboard" button on /skill (`… opacity-80 transition-all hover:bg-gray-300 …`) and two buttons on "Building an animation course" (`… shadow-sm transition-all hover:bg-[#F5F5F5] active:scale-[0.97] …`). No `ease-in` class appears in the rendered HTML of the 14 pages fetched, so the `.ease-in` utility likely lives in a client-rendered demo (not checked).

### FD03-F25 — What can be machine-checked at runtime, and what Emil says cannot be judged from code
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** `document.getAnimations()` returns all CSS Animations, CSS Transitions and Web Animations in effect (Baseline, Chrome 84), so a Playwright run can inventory each animation's target, duration, delay and easing during load, scroll, hover and click. The Chrome DevTools Protocol's experimental Animation domain can change the document timeline's playback rate (`Animation.setPlaybackRate`), which allows slow-motion recordings. Emil's own skills say some qualities cannot be settled from code and prescribe 2–5× slow motion, frame stepping, real devices and a next-day review.
- **Implication for /frontend:** Split the motion check in three: (1) static signatures (F08, F18–F22), (2) runtime inventory via `getAnimations()` in both reduced-motion states, checked against the budgets (F07) and easing rules (F06), (3) a slowed recording of the hero and key interactions for the owner's feel check. The "feel" verdict stays a human gate; do not let an agent self-approve it.
- **Evidence:**
  - [Document: getAnimations() method](https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations) — MDN, accessed 2026-09-30 — reference docs.
    - "returns an array of all Animation objects currently in effect whose target elements are descendants of the document. This array includes CSS Animations, CSS Transitions, and Web Animations."
    - MDN browser-compat-data `api/Document.json` → `{'chrome': '84', 'firefox': '75', 'safari': '14'}`
  - [browser_protocol.json](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json) — ChromeDevTools, master, accessed 2026-09-30 — protocol definition (OBSERVED).
    - Animation domain `experimental: True`; `setPlaybackRate` — "Sets the playback rate of the document timeline." (parameter `playbackRate`); events `animationCreated`, `animationStarted`, `animationUpdated`, `animationCanceled`.
  - [animate/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/animate/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 201).
    - "**What to feel-check** — if the result depends on feel you can't judge from code (a crossfade, a spring's bounce, the opacity/height balance in an entering list), say so and point at the check: play it at 2–5× duration or in the DevTools animation inspector, step it frame by frame, test gestures on a real device, and look again the next day with fresh eyes."
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "AI can write animation code. What it can’t do is know what feels right."
- **Limits / false positives:** `getAnimations()` does not see requestAnimationFrame-driven motion (Motion's independent transforms, canvas, pointer handlers), so tell 13 effects need the static signature. The CDP Animation domain is experimental and Chromium-only.

### FD03-F26 — Emil's non-motion rules bear on tells 5 and 18; his apple-design skill is in tension with tells 4 and 6
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Emil's README names "a solid border instead of a semi-transparent shadow" as a typical agent mistake (tell 5, colored border cards), and a typography rule quoted in "Agents with Taste" keeps italics for citations and linguistic stress because "italic hierarchy reads like print editorial" (tell 18, serif italic accents). His apple-design skill recommends translucent `backdrop-filter` layers for nav, toolbars and sheets (tension with tell 6, glassmorphism cards) and the platform system font before a custom face (a nuance for tell 4, Inter everywhere).
- **Implication for /frontend:** Cite Emil for tells 5 and 18. For tell 6, allow translucency only on sticky chrome with content scrolling under it, never on cards, never stacked. For tell 4, "system-ui" is not a neutral escape: it renders platform fonts (a typography dossier should verify which).
- **Evidence:**
  - [README.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/README.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file.
    - "Or they choose a solid border instead of a semi-transparent shadow for your UIs."
  - [Agents with Taste](https://emilkowal.ski/ui/agents-with-taste) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "Prefer bold for interface emphasis and keep italic for citations and linguistic stress in prose — italic hierarchy reads like print editorial, not UI hierarchy."
    - "Cap body text at about 65ch instead of stretching full width so line length stays comfortable to read."
  - [apple-design/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/apple-design/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (lines 183–184, 234).
    - "**Build nav/toolbars/sheets as translucent layers** (`backdrop-filter: blur()` + a semi-transparent background) with content scrolling underneath"
    - "**Never stack a light translucent surface on another** — legibility collapses."
    - "**Default to the platform's system font** before a custom face; it already ships optical sizing, tracking tables, and legibility tuning."
- **Limits / false positives:** The typography rules are quoted from "one of my skill files" that is not in the public repo (grep for `65ch` and `italic` in the repo finds nothing), probably the course set. apple-design is Emil's translation of Apple talks, not Apple's text.
- **Verification note:** Re-checked: no committed version of emil-design-eng (init 5282ea8 or d16ebe6) contains any of the post's tables. Emil's own blog follows his italic rule in a way that matters for tell 18: every prose `<em>` renders in a dedicated serif italic face (F31, added at verification).

### FD03-F27 — Rauno Freiberg, "Invisible Details of Interaction Design" (July 2023): frequency and novelty decide whether to animate
- **Grade:** C (downgraded from A) · **Kind:** ASSERTED · **Verdict:** DOWNGRADED
- **Downgrade reason:** Every quote checks out (date "July 2023", `<meta name="author" content="Rauno Freiberg">`, acknowledgements including Emil), but the grading scale reserves A for official docs, source code, studies and the tool's own files. This is a practitioner essay by someone other than the tool's author; its only evidence is a self-experiment on one bookmarking tool (an anecdote), and the essay itself says it is "not a tutorial nor a collection of guidelines". C (practitioner assertion) fits.
- **Claim:** Rauno lists object permanence, focal point and delight as reasons to animate, then argues that high-frequency, low-novelty interactions (command menus, macOS context menus, the macOS App Switcher, whose "overlay never animates") should not animate. He reports removing motion from core interactions of his own bookmarking tool after it felt sluggish within days. The essay thanks "Emil" among draft reviewers, so it is not fully independent of Emil.
- **Implication for /frontend:** A second voice for the frequency gate (F04) and interruptibility (F12). Note his self-experiment: motion that felt good on day one felt slow by day three, a reason to review the demo app after a break rather than right after building it.
- **Evidence:**
  - [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design) — Rauno Freiberg (meta author), July 2023, accessed 2026-09-30 — essay.
    - "As a designer, I love to animate everything. Object permanence, creating a focal point, and delight are all good reasons for doing so. But it's not so obvious when not to animate something."
    - "A good example for this would be command menus. It's tempting to throw an opacity and scale fade on the overlay. But if we for a moment consider the interaction frequency being hundreds of times a day, it does start to feel more like cognitive burden after seeing the same animation for the hundredth time."
    - "After a couple of days they began to feel sluggish. Despite making the motion even snappier, my perceived performance was making me feel like I have to wait too much when interfacing with the keyboard. I removed motion from core interactions and suddenly felt like I was moving much faster"
    - "Thanks to Paco, Alasdair, Emil, Thomas for reading early drafts and their insights and feedback."
- **Limits / false positives:** The essay says of itself: "This essay is not a tutorial nor a collection of guidelines." It is one designer's observation.

### FD03-F28 — Vercel's Web Interface Guidelines overlap with Emil's motion rules and add an autoplay rule
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** The Animations section requires honoring `prefers-reduced-motion`, prefers CSS over WAAPI over JS libraries ("Preference: CSS > Web Animations API > JavaScript libraries"), restricts animation to cause-and-effect or deliberate delight, requires interruptibility and a correct transform origin, forbids `transition: all`, and adds an "Input-driven" rule: no autoplay except muted, non-essential loops, and pause controls for motion over 5 seconds. Nothing in the file says it derives from Emil: the README's commits are mostly John Pham's (14 of 20 on README.md), its thanks list does not name Emil, and it links Emil once, as the source of the tooltip-timing rule in the Interactions section. (corrected: the title said the guidelines "restate Emil's motion rules", a derivation no source supports)
- **Implication for /frontend:** Where Emil and Vercel agree (necessity, interruptibility, origin, no `transition: all`, reduced motion), a rule has two sources that are only partly independent: the guidelines are published under vercel-labs, Emil's README says his experience comes from "companies like Vercel and Linear", and the tooltip rule cites Emil directly. The autoplay rule covers ambient hero loops that Emil's sources barely address; an explanatory hero animation that loops for more than 5 s needs a pause control.
- **Evidence:**
  - [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/README.md) — vercel-labs, commit e3d624b (2026-08-18), accessed 2026-09-30 — official guidelines (Animations section).
    - "**Necessity check.** Only animate when it clarifies cause & effect or when it adds deliberate delight"
    - "**Interruptible.** Animations are cancelable by user input."
    - "**Input-driven.** Avoid autoplay except for muted, non-essential loops. Automatically playing motion lasting [>5 seconds](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) alongside other content has pause, stop, or hide controls."
    - "**Never `transition: all`.** Explicitly list only the properties you intend to animate (typically `opacity`, `transform`)."
    - Added at verification: line 40 "Preference: CSS > Web Animations API > JavaScript libraries e.g., [motion](https://www.npmjs.com/package/motion)." · line 24 "**Tooltip timing.** Delay the first tooltip in a group; [subsequent peers have no delay](https://x.com/emilkowalski_/status/1962500739336462340)." · line 197 "Thanks to [Adam](https://x.com/argyleink), [Jimmy](https://x.com/wwwjim), [Jonnie](https://destroytoday.com/), [Lochie](https://x.com/lochieaxon), [Paco](https://pa.co), [Joe](https://joebell.studio/), & [Austin](https://x.com/austin_malerba) for feedback."
    - Command: `gh api "repos/vercel-labs/web-interface-guidelines/commits?path=README.md&per_page=100" --jq '.[].commit.author.name' | sort | uniq -c` → John Pham 14, Jarren San Jose 2, four others 1 each.
    - The linked post 1962500739336462340, read via `cdn.syndication.twimg.com`, is by Emil Kowalski (screen name `emilkowalski`), 2025-09-01: "Tooltips should have a delay before appearing to prevent accidental activation. Once a tooltip is open, hovering over other tooltips should open them with no delay and no animation."
- **Limits / false positives:** Another dossier presumably covers these guidelines in full; authorship of individual lines was not checked.

### FD03-F29 — NN/g (2020) corroborates the duration range but contradicts Emil on exit easing and on the cost of opacity
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** NN/g recommends 100–500 ms, "In most cases, a range of 100–400 ms", with 500 ms feeling like "a real drag", which brackets Emil's budgets. On exits it is ambivalent rather than permissive: the text says ease-in and ease-in-out "are sometimes used for elements leaving the screen, but that sort of easing curve can feel unresponsive", after "Most frequently, you’ll want to use an ease-out animation", while its own demo caption reads "The eased example uses ease-out when the box enters the frame, and ease-in when the box leaves the frame." Emil says never ease-in on UI. NN/g also says opacity changes can be computationally expensive on many platforms, where Emil and Motion treat opacity as compositor-cheap. (corrected: "allows ease-in for elements leaving the screen" dropped NN/g's own caveat; the demo caption is the only place NN/g endorses it)
- **Implication for /frontend:** "Never ease-in" is Emil's house style; NN/g half agrees (it warns ease-in "can feel unresponsive") and half disagrees (its demo uses ease-in on exit). Keep it as a style rule but grade ease-in on exits low severity. Keep opacity in the cheap set for the web (Motion's docs agree) and treat NN/g's platform-general remark as dated.
- **Evidence:**
  - [Executing UX Animations: Duration and Motion Characteristics](https://www.nngroup.com/articles/animation-duration/) — Page Laubheimer, NN/g, 2020-02-09, accessed 2026-09-30 — practitioner research article.
    - "In general, the duration of most animations should be in the range of 100–500 ms, depending on complexity and on how far the element is traveling."
    - "At 500ms, animations start to feel like a real drag for users — they become cumbersome and annoying. In most cases, a range of 100–400 ms is appropriate"
    - "Ease-in and ease-in-out are sometimes used for elements leaving the screen, but that sort of easing curve can feel unresponsive if the initial motion takes a little while to get going."
    - "Changing the opacity is another common transition, but on a lot of platforms it will be computationally expensive (resulting in suboptimal performance and smoothness), especially when many elements change all at once."
    - Added at verification: "Most frequently, you’ll want to use an ease-out animation, that starts quickly but slows down." · "The eased example uses ease-out when the box enters the frame, and ease-in when the box leaves the frame."
- **Limits / false positives:** Written in 2020 and platform-general (native apps included); no experiment reported for the duration ranges. Its sources list cites Pratt et al. (2010), "It's Alive! Animate motion captures visual attention", Psychological Science 21, an attention study, not a duration experiment.

### FD03-F30 — Emil calls clip-path animation "hardware-accelerated"; Motion's docs and a 2021 Chrome post said compositor support was coming, and Chromium turned it on by default in July 2026
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Emil's clip-path post says clip-path is hardware-accelerated and cheaper than animating height; his skill calls comparison sliders "fully hardware-accelerated" and treats clip-path as the sanctioned fourth animatable property. Motion's performance guide (undated) says Chrome is adding compositor support for clip-path "soon"; Chrome's own blog said the same in 2021. No chromestatus entry exists, but Chromium's source settles the status: commit 1489d51 (2026-07-14, "Enable Composited Clip-Path Animations by default") flips the Blink runtime feature `CompositeClipPathAnimation` from `status: "experimental"` to `status: "stable"`. The flag reads "experimental" at every release tag checked from 140.0.7339.0 through 151.0.7922.0 and "stable" at 152.0.7970.0 and on main (2026-09-30). The feature's commit history (2023–2026) shows many main-thread fallbacks (geometry-box, `backdrop-filter`, `shape()` arcs, fragmentation). So Emil's claim was premature for most of the post's life and holds for eligible clip-path animations in Chrome 152 and later; Safari and Firefox were not checked. (corrected: the dossier left the Chrome status "unresolved"; a primary source resolves it)
- **Implication for /frontend:** Allow clip-path reveals (they avoid layout shift). In Chromium 152+ an eligible clip-path animation runs on the compositor, but fallbacks exist and other engines are unverified, so do not list clip-path as free in the performance rules; profile any repeated clip-path animation in the target browser, and prefer transform/opacity for anything that runs more than once.
- **Evidence:**
  - [The Magic of Clip Path](https://emilkowal.ski/ui/the-magic-of-clip-path) — Emil Kowalski, undated, accessed 2026-09-30 — author's blog.
    - "clip-path is hardware-accelerated, so it’s more performant than animating the height of the image."
  - [emil-design-eng/SKILL.md](https://github.com/emilkowalski/skills/blob/d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128/skills/emil-design-eng/SKILL.md) — Emil Kowalski, d16ebe6, accessed 2026-09-30 — tool's own file (line 437).
    - "No extra DOM elements needed, fully hardware-accelerated."
  - [Animation performance guide](https://motion.dev/docs/performance) — Motion, undated, accessed 2026-09-30 — official docs.
    - "Browsers are adding more values to this list, too. For instance, Chrome and Firefox handle `filter` and SVGs entirely on the compositor, and Chrome is adding support for `background-color` and `clip-path` soon."
  - [Updates in hardware-accelerated animation capabilities](https://developer.chrome.com/blog/hardware-accelerated-animations) — Chrome for Developers (Una Kravets), last updated 2021-02-22, accessed 2026-09-30 — vendor blog.
    - "background-color and clip-path will soon join the list."
  - [Enable Composited Clip-Path Animations by default](https://github.com/chromium/chromium/commit/1489d51728df0e681cfffd921bdb108d740bdc6b) — Chromium (author Claire Chambers, microsoft.com address; reviewed by Kevin Ellis, chromium.org), 2026-07-14, Cr-Commit-Position refs/heads/main@{#1662023}, accessed 2026-09-30 via the GitHub mirror — source code (added at verification).
    - "After finally seeing good reliability in clip-path finch + edge experiment, it is time to enable composited clip-path animations by default."
    - Diff of `third_party/blink/renderer/platform/runtime_enabled_features.json5`: `name: "CompositeClipPathAnimation",` `-      status: "experimental",` `+      status: "stable",`
  - [runtime_enabled_features.json5](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/platform/runtime_enabled_features.json5) — Chromium, main, accessed 2026-09-30 — source (added at verification).
    - `name: "CompositeClipPathAnimation", status: "stable", public: true,` (line 1347). `CompositeBGColorAnimation` is also `status: "stable"`.
    - Command: for tags 140.0.7339.0, 145.0.7632.0, 147.0.7727.0, 148.0.7778.0, 149.0.7827.0, 150.0.7871.0, 151.0.7922.0 `curl raw.githubusercontent.com/chromium/chromium/<tag>/…/runtime_enabled_features.json5 | grep -A3 CompositeClipPathAnimation` → `status: "experimental"`; tags 152.0.7970.0 and 152.0.7970.1 → `status: "stable"`.
- **Limits / false positives:** "stable" in `runtime_enabled_features.json5` means on by default in that build; field rollout can still be gated, and the tag tells when the code was branched, not when a given user received it. No performance trace was taken. Safari and Firefox were not checked. A separate clip-path animation bug in Chrome 150–152 is open (crbug 538488442, "CSS clip-path: inset() with round fails to animate when an offset value is exactly 100%"), and Motion issue #3786 reports clip-path animations jumping to the end value in Chrome 151.0.7922.76; neither was investigated. (corrected: previous text called the status unresolved)

### FD03-F31 — Emil's own blog renders every prose emphasis in a dedicated serif italic face: the visual pattern of tell 18 on a human expert site (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:** emilkowal.ski defines a separate inline serif (`--font-serif-inline:"serifInline","serifInline Fallback"`, utility `.font-serif-inline`) and renders each `<em>` in body prose as `font-serif-inline text-[0.98em] font-normal italic text-gray-1200`. In the server-rendered HTML of the pages fetched on 2026-09-30, 26 such `<em>` elements appear on 11 pages (10 of the 12 /ui/ posts fetched, plus animations.dev), all inside `<p>`, none in a heading. Each wraps one or two stressed words ("why", "strict", "right", "never", "a lot"). animations.dev's h1 ("How do you craft animations that feel right?") carries no italic or serif class. The usage matches the rule Emil quotes in "Agents with Taste" (italic "for citations and linguistic stress in prose"), and it is the visual signature of the owner's tell 18 (serif italic accents).
- **Implication for /frontend:** Scope the tell-18 detector to display text (h1–h3, hero lines, taglines, badges, buttons) and to decorative accents; a serif italic stressing a word inside a body paragraph occurs on a respected human-designed site and must not fire. Put emilkowal.ski in the control corpus for typography as well as motion (F24): it trips a naive "serif italic present" rule 26 times.
- **Evidence:**
  - [emilkowal.ski stylesheets](https://emilkowal.ski/_next/static/css/4691d38b7dfb2187.css) (`4691d38b7dfb2187.css`, `d54e455ee7d8468f.css`) — Emil Kowalski, accessed 2026-09-30 — site assets (OBSERVED).
    - `.font-serif-inline{font-family:var(--font-serif-inline)}` · `--font-serif-inline:"serifInline","serifInline Fallback"`
  - [Train Your Judgement](https://emilkowal.ski/ui/train-your-judgement) — Emil Kowalski, accessed 2026-09-30 — server-rendered HTML (OBSERVED).
    - `know what feels <em class="font-serif-inline text-[0.98em] font-normal italic text-gray-1200">right</em>.</p>`
  - [animations.dev](https://animations.dev/) — Emil Kowalski, accessed 2026-09-30 — server-rendered HTML (OBSERVED).
    - `Can you <em class="font-serif-inline font-normal text-inherit italic">clearly</em> explain why the animation on the right`
  - Command: a Python HTMLParser pass over all 30 HTML pages saved during verification (14 emilkowal.ski pages, animations.dev, aiforui.dev and third-party docs), counting elements whose class contains `font-serif-inline` by nearest block ancestor → `{'p': 26}`, all on Emil's pages; per page: you-dont-need-animations 5, building-an-animation-course 6, agents-with-taste 3, friction-as-a-feature 3, building-a-toast-component 2, good-vs-great-animations 2, 7-practical-animation-tips 1, the-magic-of-clip-path 1, train-your-judgement 1, developing-taste 1, animations.dev 1; great-animations, building-a-drawer-component, the homepage and /skill 0.
  - [Agents with Taste](https://emilkowal.ski/ui/agents-with-taste) — Emil Kowalski, accessed 2026-09-30 — author's blog.
    - "Prefer bold for interface emphasis and keep italic for citations and linguistic stress in prose — italic hierarchy reads like print editorial, not UI hierarchy."
- **Limits / false positives:** Server-rendered HTML only; client-rendered demos were not scanned. The face behind "serifInline" was not identified (the font files are self-hosted with hashed names). One site is not a corpus; the owner's past hackathon sites would need the same scan to confirm tell 18 fires there in display text.

## Contradictions between sources

1. **Modal and drawer duration.** Skill files: "Modals, drawers | 200-500ms" (emil-design-eng, animate, STANDARDS). "Agents with Taste" post: "Modals, drawers | 200-300ms". Drawer recipe and Vaul use 500 ms; Sonner toasts 400 ms. All while "UI animations should stay under 300ms" (F07, F23).
2. **Stagger.** Skill checklist and example: add 30–80 ms stagger, uniform 50 ms steps. "Train Your Judgement": uniform stagger "feels artificial", layered entrances should be avoided (F18).
3. **Reduced motion.** Skill: "fewer and gentler animations, not zero", flag implementations "that nuke all feedback". Sonner's CSS: `transition: none !important; animation: none !important;` under the preference; Vaul: no handling (F15, F23).
4. **Keyframes.** Skill: keyframes restart and should be avoided for dynamic UI. Vaul opens and closes with `@keyframes`; shadcn overlays use keyframe utilities (F12, F22, F23).
5. **Velocity threshold.** Skill: "If velocity exceeds ~0.11, dismiss regardless of distance." Sonner 0.11 ("trial and error"), Vaul 0.4 (F23). (corrected at verification: the skill wording was paraphrased inside quote marks)
6. **Model invocation.** `animate` says "invoke `pick-ui-library`"; `pick-ui-library` sets `disable-model-invocation: true` (F02).
7. **Ease-in on exits.** Emil: never ease-in on UI. NN/g: ease-in "sometimes used for elements leaving the screen, but that sort of easing curve can feel unresponsive", yet its demo "uses … ease-in when the box leaves the frame" (F29). (corrected at verification: NN/g's caveat and demo caption added)
8. **Cost of opacity.** Emil and Motion: opacity is compositor-friendly. NN/g 2020: opacity "on a lot of platforms it will be computationally expensive" (F29).
9. **clip-path acceleration.** Emil: "hardware-accelerated". Motion docs and Chrome (2021): compositor support coming "soon". Resolved at verification by Chromium source: `CompositeClipPathAnimation` went from "experimental" to "stable" on 2026-07-14 (commit 1489d51), stable from tag 152.0.7970.0, with main-thread fallbacks (F30).
10. **Bounce default.** emil-design-eng labels `{ type: "spring", duration: 0.5, bounce: 0.2 }` "Apple's approach (recommended — easier to reason about)". "Train Your Judgement": "No bounce should be your default". apple-design: damping 1.0 default (F13). (corrected at verification: label quoted in full)
11. **Owner's tells versus Emil.** Tell 12: Emil sanctions one-shot scroll reveals on marketing surfaces. Tell 13: Emil sanctions spring-smoothed decorative mouse tracking on marketing pages. Tell 6: Emil's apple-design recommends translucent chrome. Tell 9: Emil's own exercise hero has a pill above the headline. The owner's list is stricter in each case (F18–F20, F26).
12. **Download figures.** Skill: Sonner "13M+ weekly". npm API: 61.0M for 2026-09-22..28; animations.dev: Sonner and Vaul "over 90,000,000 times per week" combined (npm: 105.7M) (F23).
13. **Built-in easing (added at verification).** Skill: "The built-in CSS easings are too weak." Same file: button press `160ms ease-out`, tooltip `125ms ease-out`, hold-to-delete release `200ms ease-out`, stagger `300ms ease-out`, all with the built-in keyword; animate's ban is limited to "Built-in `ease-out` on a deliberate animation" (F06).
14. **Serif italic accents (added at verification).** Owner's tell 18 treats serif italic accents as a slop signal. Emil's blog renders every prose `<em>` in a dedicated serif italic face, 26 times on 11 pages, always inside body paragraphs (F31).

## What could not be found, and how it was searched

- **Course lesson content and the 15 course skills** (including /scroll-animations, /animation-accessibility, /animation-performance, /motion-brief): behind login, enrollment closed until 2027. Searched: animations.dev landing page (curl), aiforui.dev and aiforui.dev/skills (curl; waitlist pages only), GitHub search for the skill names (only the public repo and forks). The aiforui.dev skill set, which emilkowal.ski/skill calls "a much more thorough set of skills", is likewise not public (F03).
- **Publication dates of Emil's blog posts:** none shown on the pages; no `datePublished`/`published_time` metadata. Searched the raw HTML of 12 posts for date patterns and JSON-LD. Verification added: `/sitemap.xml`, `/rss.xml`, `/feed.xml`, `/rss`, `/atom.xml`, `/feed` and `/robots.txt` on emilkowal.ski all return 404.
- **Any measurement behind Emil's numbers** (under 300 ms, 180 vs 400 ms, spinner speed, 0.97, 30–80 ms): none cited in the blog or skill files; the only number with stated provenance (0.11) is "trial and error". NN/g's article cites a 2010 attention study, not a duration experiment.
- **Emil on cursor beams or spotlight effects specifically:** not found; only generic mouse-tracking guidance. Searched blog texts and skill files for mouse, cursor, pointer, spotlight, glow, beam.
- **Emil explicitly labelling fade-in-on-scroll or hover fades as "AI slop":** not found in the blog or skills. The README says agents "don’t have great taste" and "Friction as a Feature" says vibe-coded apps "don’t feel designed, they just exist", but neither names these patterns. X could not be searched directly (x.com not fetchable); two known post IDs were read through `cdn.syndication.twimg.com`; web searches for Emil posts on scroll animations returned nothing relevant.
- **Current Chrome status of composited clip-path animation:** chromestatus API searches ("clip-path", "clip-path compositor", "Composited clip-path") returned no such feature entry. Found at verification in Chromium's own source instead: `runtime_enabled_features.json5` and commit 1489d51 (2026-07-14) show `CompositeClipPathAnimation` enabled by default from Chromium 152 (F30).
- **Rauno Freiberg on scroll reveals or hover fades:** the essay does not discuss them.

## Weak spots of this dossier

- Emil's rules are practitioner judgement from product work at Vercel and Linear. They are graded A as primary sources for what Emil says, not for being correct; no finding here rests on a controlled study.
- The "Train Your Judgement" breakdowns are hidden until the reader picks an option; I extracted them from the page's Next.js payload (`self.__next_f.push` chunks in view-source). A fact-checker must click through the exercises or read the page source to see them. A few quotes were reassembled around inline code spans (for example "At 0.9, which B uses, …").
- Blog posts are undated, so I could not order the blog tables against the skill files; the skill files are dated only by commit.
- Markdown table rows and multi-line CSS snippets are quoted with whitespace collapsed (table padding and line breaks removed); wording and values are unchanged. A script re-checked 174 quoted strings against the saved sources: all matched except label-prefixed lines and the "Train Your Judgement" breakdowns, which matched once inline code spans were flattened.
- The mapping of Emil's rules to the owner's tells 12, 13 and 14 is my interpretation; the tells' wording is ambiguous ("fade on hover" could mean opacity drop or any animated color change).
- Nothing was rendered: shadcn, Sonner, Vaul and emilkowal.ski were read as source or compiled CSS, not measured in a browser. The contrast effect of `hover:bg-primary/90` is inferred, not measured.
- The Exa search tool returned a 401 midway through the session; later searches used WebSearch and direct fetches instead. The skills.sh, Motion and Tailwind pages were read once; their numbers and wording can change.
- Out of scope and not read in full: `animate-expo`, `write-swift`, `ask-sonner` (React Native, Swift, Sonner API). apple-design's claims about WWDC talks (including a 2026 session) were not verified against Apple's videos.

## Dropped at verification

None. Every finding's sources opened and its quotes matched; the problems found were overclaims, omissions and one grade, handled as corrections and a downgrade.

## Verification notes

**Method.** Every source cited in the dossier was re-opened on 2026-09-30, none from memory:
- Repository: all 23 files of `emilkowalski/skills` at d16ebe6 via raw.githubusercontent.com; the init version of emil-design-eng (5282ea8); the full commit list, the tree and the diff of 85e8e23 via `gh api`. HEAD is still d16ebe6.
- Author pages via curl: emilkowal.ski (homepage, /skill, the 12 /ui/ posts including the two the researcher did not cite, "Developing Taste" and "Friction as a Feature"), its two stylesheets, animations.dev, aiforui.dev and /skills, skills.sh, and the two X posts through `cdn.syndication.twimg.com`.
- Standards and docs: Claude Code's skills docs (`code.claude.com/docs/en/skills.md`), four Tailwind v4 docs pages and `theme.css`, easing.dev, Base UI's Tooltip page, Motion's performance guide, W3C Understanding SC 2.3.3, MDN (content source, rendered page and browser-compat-data), NN/g, the Chrome for Developers post, the chromestatus API.
- Code at the cited commits: axe-core `rule-descriptions.md` (72e8624), Playwright `class-page.md`, Vercel's guidelines (e3d624b), the shadcn new-york-v4 components and `registry.ts` plus the bases' buttons (b0fcb58), tw-animate.css (1fc30d2), Sonner `styles.css` and `index.tsx` (8e4662b), all of Vaul's `src/` and README (3e97aac), Ionic `ios.enter.ts` (1c89743), CDP `browser_protocol.json`, the npm downloads API.
- Sources added at verification: Chromium's `runtime_enabled_features.json5` on main and at nine release tags, Chromium commit 1489d51, Tailwind discussion #17225 (GraphQL), Base UI issues (`gh search issues`), Motion issue #3786, crbug 538488442 metadata.

**Quote check.** A script collapsed whitespace and searched each quote in the page's visible text and in the decoded Next.js flight payload (`self.__next_f.push`), with inline `code`/`em` spans flattened. Every quote in the original dossier matched its source once spans were flattened, with two exceptions that were not verbatim and are now fixed: the truncated "Apple's approach (recommended)" (F13, contradiction 10) and the paraphrase "> ~0.11" (contradiction 5). The other mismatches were typographic only: "center ,", "Ionic Framework .", "Intersection Observer API ,", code-span letters in "Train Your Judgement". One line number was wrong: review-animations line 56, not 57 (F10). Git Bash heredocs on this machine eat backslashes, so regex helpers were written as files first.

**What changed and why.**
- The largest correction is F30. The dossier left Chrome's clip-path status "unresolved"; Chromium's own source shows composited clip-path animations on by default from 152.
- F06 and F31 record places where Emil's own material trips the naive rules a checker would use: the built-in `ease-out` keyword in his examples, and serif italic emphasis on his blog. Both reinforce F24's point that the checker must be tuned on control sites.
- F19, F21, F10 and F28 were overclaims: "only scroll recipe", a frequency-scoped hover exercise read as a general rule, "most common implementation of tell 12", "restate Emil's rules".
- F27 was regraded to the scale's definition of a practitioner essay.

**Sources that could not be opened.**
- crbug 538488442's page body sits behind a sign-in wall. Only its JSON metadata was readable (title; Chrome 150, 151 and 152); nothing in it names the compositor feature.
- Chromium's gitiles history pages return 403 "Please sign in", so the GitHub mirror `chromium/chromium` was used instead.
- x.com cannot be fetched directly; the syndication endpoint was used.
- Course content (animations.dev login, aiforui.dev waitlist) is closed.
- One WebSearch result summary claimed CompositeClipPathAnimation was "enabled by default". It was not relied on until the Chromium commit and the flag file confirmed it.

**Residual doubts.**
- The Chrome 152 stable-channel release date and any Finch gating of `CompositeClipPathAnimation` were not checked. Safari and Firefox behaviour for clip-path compositing was not checked either.
- Which non-public skill file "Agents with Taste" quotes (animations.dev or aiforui.dev) is unknown. The blog posts remain undated.
- The `.ease-in` utility in emilkowal.ski's CSS has no consumer in the server-rendered HTML of 14 pages, so it is presumably a client-rendered demo (not confirmed).
- The serif face behind `serifInline` was not identified.
- Mapping Emil's rules to the owner's tells 12, 13, 14 and 18 stays interpretation. Only running the checker on the owner's past hackathon sites can confirm those tells fire in display text.
- Install counts, stars and npm downloads are single readings and move daily.

**Scratch data.** Saved pages and helper scripts are in `C:/Users/UTILIS~1/AppData/Local/Temp/claude/C--Users-Utilisateur-Documents/fc5626a6-7e19-4dcf-8bf4-cc771beee170/scratchpad/research/tool-emil-kowalski/`. Nothing was cloned.
