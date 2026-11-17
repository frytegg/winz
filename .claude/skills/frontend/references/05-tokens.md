# Tokens: one source for colour, type, space, radius, shadow and motion

Read when: P4 tokens (FE-07), and any task that adds or changes a colour, font, type size, spacing step, radius,
shadow, duration or easing, edits Tailwind `@theme` or shadcn CSS variables, or touches `design/DESIGN.md` or a
Claude Design mirror.

## Purpose
`design/tokens.json` is the single source of the visual system. tokens.mjs generates the CSS custom properties, the
Tailwind `@theme` block, DESIGN.md and an optional Claude Design mirror from it; nobody edits those by hand. No
default palette, radius, shadow, font or curve of a framework or kit leaks through. Contrast is built into the tokens
with a pair table, because axe cannot see non-text contrast, gradients or image grounds. Type is at most two
families plus a mono with a role, self-hosted, licensed, with tabular figures proven.

## Rules

### TK-01 - Keep one source: `design/tokens.json`
- **Rule:** Put every colour, type role, font file, spacing step, radius, shadow and motion value in
  `design/tokens.json` (scripts/CONTRACTS.md section 6.2). Generate the CSS (`design/tokens.css` with the `@theme`
  block), `design/DESIGN.md` and any mirror with tokens.mjs. Never edit a generated file; never hard-code a value in a
  component.
- **Why:** Google's DESIGN.md spec and its philosophy disagree on whether tokens bind, so values must be enforced
  mechanically [FD05-F04]. Vercel moved type, spacing and layout into a stylesheet because agents kept inventing them
  (39 against 91 known failures) [FD05-F13]. The Design System type is a mirror, not a source [FD07-F26].
- **Check:** tokens.valid.
- **Not when:** no exception.

### TK-02 - Write values the mirror can read
- **Rule:** Token names match `[a-z0-9][a-z0-9-]{0,63}`; every token has a non-empty `usage`. Colour values are
  literal `oklch()`, `rgb()` or hex per theme. Never put a named colour (`red`, `transparent`, `currentColor`),
  `var()` or `color-mix()` in a token value. Keep lists of `{name, value, usage}`, never a DTCG name-to-value map.
- **Why:** The Design System type stores `{name, value, usage}` lists, cannot read DTCG maps, and drops named colours,
  `var()` and `color-mix()` [FD07-F26].
- **Check:** tokens.valid.
- **Not when:** no exception.

### TK-03 - Start small
- **Rule:** Start from 6 to 10 colours per theme, 5 to 7 text styles, 4 spacing steps and 3 radii. Add a token only
  when a screen needs a new role.
- **Why:** That is the Design System type's "small first system", sized for a hackathon brand [FD07-F26]. A fluid
  scale of 6 to 8 type steps replaces Tailwind's 13 [FD16-F18].
- **Check:** tokens.valid (counts reported); critic.
- **Not when:** an existing app's larger system: keep it and map it (13-stack.md).

### TK-04 - Reset Tailwind's namespaces before defining tokens
- **Rule:** In `@theme`, set `--color-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--blur-*`,
  `--radius-*`, `--animate-*`, `--ease-*`, `--font-*`, `--text-*`, `--tracking-*` and `--leading-*` to `initial`, then
  define the project's tokens. Point `--default-transition-duration` and `--default-transition-timing-function` at the
  motion tokens. After `--*: initial`, redefine `--spacing` and the breakpoints.
- **Why:** Theme variables decide which utilities exist; a reset deletes the defaults [FD16-F05]. Tailwind 4.3.3 ships
  288 colours with indigo, violet and purple scales, 13 type steps, black-alpha shadows, 4 to 64 px blurs and a default
  150 ms transition on `cubic-bezier(0.4, 0, 0.2, 1)` [FD16-F06].
- **Check:** tokens.leak.
- **Not when:** the stack has no Tailwind.

### TK-05 - Grep for the leaks a reset cannot stop
- **Rule:** Fail on `--color-indigo-*`, `--color-violet-*` or `--color-purple-*` in built CSS; on arbitrary values
  outside the token file (`-[#`, `-[oklch(`, `-[rgb(`, `bg-[linear-gradient`, `backdrop-blur-[` and the shorthand
  `-(--`); on class names from a deleted namespace (such as `from-purple-500`); on colour, gradient or blur literals in
  inline `style` or plain CSS.
- **Why:** Arbitrary values and `-(--x)` generate CSS whatever the theme holds; dead default class names show a
  reflex; inline styles and plain CSS bypass the theme [FD16-F05] [FD16 Default stack and de-defaulting checklist].
- **Check:** tokens.leak.
- **Not when:** values inside the token file and the generated CSS.

### TK-06 - Change every shadcn default token
- **Rule:** With shadcn: `--radius` other than `0.625rem`; `--primary` other than `oklch(0.205 0 0)`; dark
  `--sidebar-primary` other than `oklch(0.488 0.243 264.376)`; `--chart-1` to `--chart-5` matching neither the CLI's
  greys (`oklch(0.87 0 0)`, `0.556`, `0.439`, `0.371`, `0.269`) nor the docs palette; an explicit hover token instead
  of `hover:bg-primary/80` or `/90`. Re-pair light muted text on `--muted`.
- **Why:** These are the registry defaults and the docs palette [FD16-F09] [FD16-F23]. Light `--muted-foreground` on
  `--muted` measures 4.34:1 [FD16-F28]. The `/90` hover lowers text contrast [FD04-F25].
- **Check:** tokens.leak; `tells` (rule SL-T11).
- **Not when:** the project has no shadcn.

### TK-07 - Generate the palette from the brand hue with contrast targets
- **Rule:** Take the hue from the picked mark (H2) or the direction's token plan. Drive
  `@adobe/leonardo-contrast-colors` 1.1.0 with target ratios 3, 4.5 and 7 against each theme's background and write
  OKLCH values. Name steps by role: 1-2 backgrounds, 3-5 component states, 6-8 borders, 9-10 solid fills, 11-12 text.
  Keep every value inside the sRGB gamut. Never take a customer's or sponsor's exact hex as the primary.
- **Why:** Leonardo starts from contrast targets and is scriptable; Radix documents the step roles [FD16-F29]. OKLCH
  is Baseline [FD16-F27]. Out-of-gamut colours make a computed ratio depend on clipping [FD16-F28]. A customer's brand
  colour is identity, not language [FD05-F26]; Solana claims its colours as marks [FD21-F13].
- **Check:** tokens.valid; tokens.contrast.
- **Not when:** an existing app's palette: re-measure it and keep it unless a pair fails.

### TK-08 - Gate on WCAG 2.2 ratios
- **Rule:** Text 4.5:1; large text (18 pt, or 14 pt bold) 3:1; UI component boundaries, input borders, focus rings
  and chart strokes 3:1 against adjacent colours. APCA may be reported as advice; it never waives a WCAG 2 failure.
- **Why:** WCAG 3 has not chosen a contrast method; axe and /harden check WCAG 2 ratios [FD16-F27]. Vercel's
  guidelines prefer APCA, which conflicts with every gate in the pipeline [FD04-F08].
- **Check:** tokens.contrast.
- **Not when:** logos: WCAG exempts logotypes [FD12-F16].

### TK-09 - Build the token-pair contrast table for every theme
- **Rule:** At build time, compute each text-on-ground pair and each non-text pair (input border on field and page,
  focus ring on its neighbours, chart stroke on the plot ground) in every theme, and fail any pair below TK-08.
- **Why:** axe has no 1.4.11 rule and files text over gradients or images under "incomplete", so a violations-only
  gate never sees them; shadcn's default input borders measure 1.47:1 dark and 1.26:1 light [FD16-F28]. Dark mode is
  never rendered unless emulated [FD06-F07]. The Design System checklist asks 4.5:1 text in every theme [FD07-F26].
- **Check:** tokens.contrast; a11y.contrast.
- **Not when:** a filled input identified by its fill, not its border [FD16-F28].

### TK-10 - Put text only on solid grounds
- **Rule:** No text on a gradient, an image or grain without a solid plate behind it.
- **Why:** axe cannot resolve those grounds, so tells 2 and 20 escape the automated floor [FD16-F28]
  [FD16 Default stack and de-defaulting checklist].
- **Check:** a11y.contrast (pixel sampling); tokens.contrast.
- **Not when:** no exception.

### TK-11 - Make dark mode legible on screens, recordings and projectors
- **Rule:** In dark mode, secondary text reaches 4.5:1 and aims for 7:1 at small sizes (`tokens.contrast` enforces 4.5:1 only). Surface steps reach 1.1:1, or the
  surfaces get a border. For a projector or stage, prefer light surfaces or give dark UIs text of 7:1 or more
  (09-recording.md).
- **Why:** Apple's floor and aim, the direct fix for tell 7 [FD16-F27]; Tailwind `zinc-500` on `zinc-950` measures
  4.12:1 [FD16-F28]. Dark surfaces below 1.1:1 steps collapse under a colour-range fault [FD20-F12]. Projectors lift
  black and cost dark UIs more contrast [FD20-F17].
- **Check:** tokens.contrast.
- **Not when:** no dark theme and no stage.

### TK-12 - Two families at most, plus a mono with a role
- **Rule:** One or two families, plus a monospace face only with a role (figures, hashes, code). Write the role map in
  `type.families` (`display`, `body`, `mono`). Cap body text near 65ch. Use bold for interface emphasis; keep italic
  for citations and stress inside prose.
- **Why:** "Most documents can tolerate a second font. Few can tolerate a third", each with a consistent role
  [FD16-F15]. Claude Design's "1-3 families" yields to Butterick's two [FD16-F31]. Emil's measure and italic rules
  [FD03-F26]; italic stress in prose occurs on a human expert site, so only display italics are a tell [FD03-F31].
- **Check:** tokens.valid.
- **Not when:** a brand-mandated face, recorded with its reason.

### TK-13 - Choose faces from the research; justify reflex faces
- **Rule:** Pick faces by the classification and mood of the customers' sites, never by their font files. A face on
  the checker's dated reflex list needs a written reason in DESIGN.md. Never use a face shipped in a sponsor kit.
- **Why:** Tell-font lists disagree and move; a hit needs a reason, not a ban [FD16-F14]. Inter is on about 1.4-1.5%
  of pages, `system-ui` on 9.7% [FD16-F13]. Customer webfonts are licensed to the customer; google/fonts tags let you
  match a classification with an open face [FD09-F18] [FD09-F19]. Sponsor-kit fonts are not licensed to you
  [FD21-F15].
- **Check:** ip.fonts; `tells` (rules SL-T04, SL-T19).
- **Not when:** no exception.

### TK-14 - Self-host open fonts with their licence files
- **Rule:** OFL, Apache, UFL or MIT faces (the set `ip.fonts` accepts), or a system stack, self-hosted from `@fontsource(-variable)` 5.3.0, local
  woff2 or `next/font`. Commit the licence file beside the font files; list each face in `type.fonts` with `license`,
  `licenseFile` and `source`. Never load `fonts.googleapis.com` or `fonts.gstatic.com` at runtime. A classification
  system stack (Transitional or Industrial from Modern Font Stacks) is a valid choice for body or data text on screens
  people work in.
- **Why:** Google Fonts are mostly OFL and redistributable [FD16-F11]; the OFL text travels with self-hosted files
  [FD09-F19]. A German court awarded EUR 100 in damages and an injunction against a Google Fonts hotlink [FD09-F20]. Self-hosting removes the network risk of a stage
  demo; system stacks render differently per OS [FD16-F17].
- **Check:** ip.fonts; ip.hotlinks; render.fonts.
- **Not when:** no exception.

### TK-15 - Check the Reserved Font Name before subsetting
- **Rule:** Read each face's `OFL.txt` for "Reserved Font Name". None: subset freely. One (IBM Plex reserves "Plex"):
  ship the files unmodified, or rename the subset in its `name` table and in `@font-face`, or pick another face.
  Record the choice in DESIGN.md.
- **Why:** Subsetting is modification (OFL-FAQ 2.6) and normally loses the RFN; the owner's public Orma repo commits
  Plex subsets still named "IBM Plex Sans" [FD16-F30] [FD09-F19].
- **Check:** ip.fonts.
- **Not when:** no exception.

### TK-16 - Keep Fontshare FFL faces out of public repos and canvases
- **Rule:** Prefer OFL. If an FFL face is chosen: never subset or convert it, never commit it to a public repo, never
  upload it to Claude Design or another third-party tool.
- **Why:** FFL 2.0 forbids subsetting, conversion and distribution through repositories, public servers or design
  tools [FD16-F12].
- **Check:** ip.fonts.
- **Not when:** no exception.

### TK-17 - Prove tabular figures on every face that shows numbers
- **Rule:** For each face used for balances, prices, rates, tables or hashes, read the font file: it must carry the
  `tnum` feature or give digits 0-9 one advance width. Set `font-variant-numeric: tabular-nums` on number columns.
- **Why:** `tabular-nums` does nothing in DM Sans, Fraunces and Instrument Serif; IBM Plex Sans, Hanken Grotesk and
  JetBrains Mono are tabular by default [FD16-F16]. Tabular figures for columns [FD16-F15].
- **Check:** tokens.valid (reads `type.fonts` with opentype.js).
- **Not when:** monospace faces, tabular by construction [FD16-F16].

### TK-18 - Use a short fluid type scale
- **Rule:** Define 6 to 8 `--text-*` steps with `clamp()` between a small-screen and a large-screen ratio (Utopia's
  example: 1.2 at 320 px, 1.333 at 1500 px). Expect at most about 10 distinct computed sizes on a key screen.
- **Why:** Tailwind ships 13 steps; human award sites median 8 sizes against 10-13 for three AI outputs, which is weak
  evidence, so the count only flags [FD16-F18].
- **Check:** tokens.valid; the computed-size count is advisory (`tells`).
- **Not when:** no exception.

### TK-19 - Size for the recording when the profile has a video
- **Rule:** Text a judge must read: 16 px or more, 18 px for comfortable reading; text marked
  `data-rec-role="key"`: 24 px or more. These sizes assume Inter's x-height (0.547 em); scale other faces by their
  x-height. Structural borders are 2 px, or reach 1.5:1. No dark gradient surfaces and no grain on recorded screens.
- **Why:** Downscaling destroys small text: 18 px holds in a 720p copy, 24 px in a 540p copy [FD20-F04]; gate
  thresholds G1 to G9 [FD20 Deliverable]. 1 px hairlines fade at 720p [FD20-F11]. Dark gradients band after encoding
  and grain is erased [FD20-F09] [FD20-F10].
- **Check:** recording.g01; recording.g03; recording.g07; recording.g08; recording.g09.
- **Not when:** the profile has no video and no stage format.

### TK-20 - Define the motion tokens once
- **Rule:** Easing: `ease-out` = `cubic-bezier(0.23, 1, 0.32, 1)`, `ease-in-out` = `cubic-bezier(0.77, 0, 0.175, 1)`,
  `ease-drawer` = `cubic-bezier(0.32, 0.72, 0, 1)`. Durations: press 160 ms (budget 100-160), tooltip 125 ms (125-200),
  dropdown 180 ms (150-250), modal 300 ms in and 240 ms out (200-300), full-height drawer 500 ms on `ease-drawer`.
  Exits run about 0.8 times the entrance. When to use each: 08-motion.md.
- **Why:** Emil's curves and example durations [FD03-F06]; role budgets and the 180 ms dropdown [FD03-F07]; NN/g's
  300 ms in and 200-250 ms out, and exits about 20% faster [FD03-F14]. They replace Tailwind's 150 ms and
  `cubic-bezier(0.4, 0, 0.2, 1)` [FD03-F08] [FD16-F21].
- **Check:** tokens.valid; motion.inventory.
- **Not when:** no exception.

### TK-21 - Generate DESIGN.md as a view in Google's alpha format
- **Rule:** tokens.mjs writes `design/DESIGN.md`: YAML front matter (`colors`, `typography`, `rounded`, `spacing`,
  `components`), then Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts,
  then `## Motion`. The Overview names one concrete object from the customers' domain, never adjectives. Do's and
  Don'ts stay short. One family per `fontFamily`; fallbacks live in CSS. Record each face's licence, role, RFN choice
  and any reflex-list reason. Stay far below the collection's median of 544 lines, with no em dash. Never treat the
  official linter's exit code as a pass.
- **Why:** Format, section order, motion left open [FD05-F03]. "Adjectives describe a region. A specific reference
  describes a point" [FD05-F05]. The export quotes a whole stack into one family that renders as Times New Roman
  [FD05-F15]. Collection files run 125 to 852 lines [FD05-F16] and 23.3 em dashes per 1,000 words [FD05-F07]. The
  linter exited 0 on all 74 files with 1,357 warnings [FD05-F14].
- **Check:** tokens.valid.
- **Not when:** no exception.

### TK-22 - Pass the paths; never rely on loading
- **Rule:** Every implementer brief names `design/tokens.css` and `design/DESIGN.md` with "read before any UI".
- **Why:** Claude Code loads DESIGN.md only through an `@` import or an explicit path [FD05-F16].
- **Check:** critic (brief review).
- **Not when:** no exception.

### TK-23 - Mirror to Claude Design one way, on request
- **Rule:** Generate the Design System mirror from `tokens.json` only when the review surface is `claude-design`, and
  after H2 so the logo file exists. Agents never read tokens back from claude.ai. Use only open faces the canvas can
  load. Pass the direction and type pairing before asking the Design type for anything. A sync to claude.ai/design is
  the owner's own `/design-sync`.
- **Why:** The type copies assets and never approximates a mark; it is a browsable mirror [FD07-F26]. DesignSync runs
  only under the user's `/design-sync` with an approved plan [FD07-F27] [FD13-F30]. Without a brand, the Design type's
  craft file asks for gradient meshes and grain [FD16-F31]. FFL forbids design-tool upload [FD16-F12].
- **Check:** owner review.
- **Not when:** review surface `board` or `terminal`.

## Procedure

1. **Inputs.** The picked direction's token plan (H1), the mark's hue if it sets one (H2), the profile's `stack`,
   `format` and `review_surface`. Before T0 on an event that forbids designs, write no token file (04-brand.md BR-24).
2. **Palette.** Run Leonardo through tokens.mjs (TK-07); keep OKLCH values in gamut.
3. **Fonts.** Choose faces (TK-12, TK-13); read licences and RFNs (TK-14, TK-15); prove tabular figures (TK-17);
   place files and licences.
4. **Write `design/tokens.json`.** Shape (placeholders only; never copy values from an example):
   ```json
   {"name": "<project>", "version": 1,
    "color": {"themes": [{"id": "light", "name": "Light"}, {"id": "dark", "name": "Dark"}],
              "tokens": [{"name": "text-muted", "value": {"light": "oklch(<l c h>)", "dark": "oklch(<l c h>)"},
                          "usage": "secondary text, step 11, 4.5:1 or more on bg"}]},
    "type": {"fonts": [{"family": "<Face>", "file": "<path>.woff2", "weight": "<w>", "style": "normal",
                        "license": "OFL-1.1", "licenseFile": "<path>/OFL.txt", "source": "<google/fonts path>"}],
             "families": {"display": "<Face>", "body": "<Face>", "mono": "<Face>"},
             "groups": [{"name": "body", "family": "body",
                         "styles": [{"name": "body-m", "fontSize": "<clamp()>", "lineHeight": "<n>",
                                     "fontWeight": 400}]}]},
    "spacing": {"tokens": []}, "radius": {"tokens": []}, "shadow": {"tokens": []},
    "motion": {"tokens": [{"name": "ease-out", "value": "cubic-bezier(0.23, 1, 0.32, 1)", "usage": "enter and exit"}]},
    "meta": {"direction": "<H1 pick>", "rationale": "<one paragraph>", "sources": ["<pattern ledger ids>"]}}
   ```
5. **Generate the views** with tokens.mjs (`node ~/.claude/skills/frontend/scripts/tokens.mjs --help`): the CSS with
   the namespace resets (TK-04), DESIGN.md (TK-21) and, on request, the mirror (TK-23).
6. **Prove:** `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates tokens,ip.fonts,ip.hotlinks
   --root <repo> --profile <abs path>`. Exit 0 only when every requested gate is ok. Fix the token, never the gate.

## Gaps
- WCAG 3 has no contrast method yet; APCA may replace ratios later [FD16-F27].
- The tabular check read default instances only, without rendering; other instances of a variable font are unchecked
  [FD16-F16].
- The distinct-size threshold (about 10) rests on three AI outputs [FD16-F18].
- DESIGN.md is an `alpha` spec with three minor releases in three months; its linter rules may tighten [FD05-F14].
- The Design System type's handling of the mirror was read from its instructions, not tested [FD07-F26].
- Whether Google Fonts or IBM covers Google's served Plex subsets by a separate agreement is unknown [FD16-F30].
- Projector contrast minima come from trade press, not the standard's text [FD20-F17].
- MIT is in the licence set `ip.fonts` accepts, but no finding examines MIT-licensed fonts; OFL stays the preferred
  licence (TK-16).
