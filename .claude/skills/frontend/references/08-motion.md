# Motion: when to animate, how, and how it is checked

Read when: any P5 task that adds a transition, animation, hover or press state, overlay, scroll effect, loop or
pointer effect; any change to the motion tokens or record mode; any fix for a failing `motion.*` gate.

## Purpose
Static by default. An animation exists only when the element is seen rarely enough and it serves a named purpose; the
one worth effort is an explanatory animation of the mechanism in the first viewport. Use the motion tokens, animate
`transform` and `opacity`, make reduced motion fewer and gentler but not zero, and hide nothing at rest. Record mode
freezes every loop. The checker measures rendered animations; the owner judges feel.

## Rules

### MO-01 - Pass the frequency gate first
- **Rule:** Estimate how often a user sees the element. 100 or more times a day (keyboard shortcuts, a command
  palette): no animation. Tens of times (hover effects, list navigation): none or near-imperceptible. Occasional
  (modals, drawers, toasts): standard. Rare or first-time: the only place for delight. Never animate a
  keyboard-initiated action. Treat demo product screens as the tens-a-day tier; the landing page a jury sees once is
  rare.
- **Why:** Emil's frequency table and keyboard rule; producing no animation counts as a success [FD03-F04]. Rauno
  removed motion from core interactions when it felt sluggish within days [FD03-F27].
- **Check:** critic (reads the tier in `design/motion.json`, MO-03).
- **Not when:** no exception.

### MO-02 - Name a purpose for every animation
- **Rule:** Each animation names one purpose: feedback, spatial consistency, state indication, preventing a jarring
  change, explanation (marketing and onboarding only) or delight (rare tier only). "It looks cool" is not a purpose.
  Spend the effort on one explanatory animation of the mechanism in the first viewport, used instead of a static
  asset.
- **Why:** Emil's purpose gate and his Linear example [FD03-F05]. Vercel animates only to clarify cause and effect or
  for deliberate delight [FD03-F28].
- **Check:** critic; motion.inventory reads only purpose `explanation` (budget exemption).
- **Not when:** no exception.

### MO-03 - Declare each animation in `design/motion.json`
- **Rule:** One entry per animation in `design/motion.json` (an array, or `{animations: [...]}`). motion-check reads
  `{selector, trigger, purpose, role}`: `selector` is required; `trigger` press sets role `press` and hover or focus
  sets role `hover`; `role` (press, tooltip, dropdown, modal, drawer, toast, hover, ui) picks the duration budget;
  purpose `explanation` exempts the animation from that budget. Add `tier`, `properties`, `reduced` and `record` for
  the critic; the checker ignores them. The file is optional for the gate, so a running animation with no entry is a
  critic finding, not a gate failure.
- **Why:** A small manifest the checker can read makes purposes auditable [FD03-F05]. `document.getAnimations()`
  lists every CSS animation, CSS transition and Web Animation in effect [FD03-F25].
- **Check:** motion.inventory (budgets per role, a malformed file fails); critic (undeclared animations).
- **Not when:** the page has no animation.

### MO-04 - Ease out; never ease in on UI
- **Rule:** Entering or exiting: the `ease-out` token. Moving on screen: `ease-in-out`. A colour-only hover: `ease`.
  Constant motion: `linear`. Never `ease-in` on a UI element. Use the custom tokens on deliberate animations
  (overlays, the hero, reveals).
- **Why:** Emil's decision tree and tokens; his ban on built-in curves covers deliberate animations only, and his own
  press and tooltip examples use built-in `ease-out` [FD03-F06]. NN/g warns that ease-in "can feel unresponsive", so
  an ease-in exit is low severity [FD03-F29].
- **Check:** `tells` (rule SL-MO2); motion.inventory notes it.
- **Not when:** press or tooltip feedback under 200 ms may use built-in `ease-out` [FD03-F06].

### MO-05 - Stay inside the role budgets
- **Rule:** Press 100-160 ms, tooltip 125-200, dropdown 150-250, modal 200-300, full-height drawer up to 500 on
  `ease-drawer`. UI motion stays under 300 ms; 500 ms or more on UI is a finding. Scale duration with distance. Exits
  run about 0.8 times the entrance and leave along the path they came in by.
- **Why:** Emil's budgets; his skill (200-500) and his post (200-300) disagree on modals, and this skill adopts
  200-300 [FD03-F07]. Exit symmetry and speed [FD03-F14]. NN/g: 100-400 ms in most cases [FD03-F29]. Values:
  05-tokens.md TK-20.
- **Check:** `tells` (rule SL-MO3); motion.inventory.
- **Not when:** the hero's named explanatory animation; toasts near 400 ms `ease` [FD03-F23]; a hold-to-confirm fill
  (2 s linear, 200 ms release) [FD03-F14].

### MO-06 - Give press feedback, not hover fades
- **Rule:** Every pressable element gets `transform: scale(0.97)` on `:active` (range 0.95-0.98) with a 100-160 ms
  `transform` transition. Never 0.9 or below. `:active` needs no hover gating.
- **Why:** "At 0.97, the compression is barely visible but still felt"; 0.9 is too much [FD03-F09].
- **Check:** critic; `tells` (rule SL-T14).
- **Not when:** disabled controls (the dossier's inference, not Emil's text) [FD03-F09].

### MO-07 - Enter from 0.9-0.97 scale with opacity, never from `scale(0)`
- **Rule:** An entering element starts at scale 0.9 to 0.97 plus opacity 0, never `scale(0)`, and never as a pure
  fade with no initial transform.
- **Why:** `scale(0)` "came from nowhere"; Emil's review skill flags pure-fade entrances [FD03-F10].
- **Check:** `tells` (rule SL-MO4).
- **Not when:** under reduced motion, a pure fade is the fallback [FD03-F10].

### MO-08 - Anchor popovers to their trigger; open sibling tooltips at once
- **Rule:** Popovers, dropdowns and tooltips scale from their trigger through the primitive's origin variable
  (`--transform-origin` in Base UI). Delay the first tooltip in a group; open its peers with no delay and no animation
  (`[data-instant] { transition-duration: 0ms }`).
- **Why:** The default `transform-origin: center` is "wrong in most cases"; Base UI exposes the origin and
  `data-instant` [FD03-F11]. Vercel's tooltip timing rule [FD03-F28].
- **Check:** critic.
- **Not when:** modals keep `center` [FD03-F11].

### MO-09 - Use transitions for anything that can be re-triggered
- **Rule:** Toggles, menus, modals, accordions, drawers and toasts animate with CSS transitions (springs for
  gestures), never keyframes.
- **Why:** Transitions retarget from the current value; keyframes restart from zero [FD03-F12].
- **Check:** critic.
- **Not when:** one-shot keyframes: a hero illustration, a loader, a swipe-out at the end of a gesture [FD03-F12]
  [FD03-F23].

### MO-10 - Springs only for gestures, with no bounce
- **Rule:** Springs drive drag, interruptible gestures and pointer-tied elements only. Bounce is 0 in crypto and
  finance products. Dialogs and popovers use the `ease-out` token.
- **Why:** "No bounce should be your default"; bounce reads as unserious for a finance app [FD03-F13].
- **Check:** critic.
- **Not when:** no exception.

### MO-11 - Animate `transform` and `opacity` only
- **Rule:** Never `transition: all` or `transition-all`; name the properties. No transitions on width, height, top,
  left, margin or padding. Animated blur stays under 20 px. Never write a parent CSS variable from a pointer handler to
  drive child transforms. Add `will-change: transform` only after seeing a 1 px shift. Clip-path reveals are allowed;
  profile any repeated one in the target browser.
- **Why:** Emil's performance rules [FD03-F17]; Tailwind's `transition-all` is the default signature [FD03-F08];
  Vercel's C30 and C31 [FD04 Appendix A]. A bare `transition` shorthand also computes to `all`, so the rendered check is
  the complete one [FD04-F24]. Clip-path compositing reached Chromium 152 with fallbacks [FD03-F30].
- **Check:** `tells` (rule SL-MO1); motion.inventory notes it.
- **Not when:** accordion height; an isolated, absolutely positioned element [FD03-F17].

### MO-12 - Make reduced motion fewer and gentler, not zero
- **Rule:** Ship the reduced variant with the animation. Under `prefers-reduced-motion: reduce`, remove movement and
  position changes, keep the opacity and colour changes that carry feedback, and stop decorative loops. With `motion`,
  wrap the tree in `MotionConfig reducedMotion="user"`. Never remove all feedback.
- **Why:** Emil's rule and his audit hunt list; WCAG 2.3.3 excludes colour and opacity from motion, and axe has no
  motion rule, so /harden cannot catch this [FD03-F15]. MotionConfig keeps opacity and colour [FD16-F21]. Vercel's C29
  and C36 [FD04 Appendix A].
- **Check:** motion.reduced; `tells` (rule SL-MO5).
- **Not when:** no exception.

### MO-13 - Hide nothing at rest
- **Rule:** All content is visible without scrolling it into view, without JavaScript-driven motion and under reduced
  motion. Never park content at `opacity: 0` waiting for an observer.
- **Why:** Full-page screenshots never scroll, so scroll-revealed content goes missing; the reveal probe compares each
  element's opacity before and after scrolling; content missing under reduced motion is an accessibility defect
  [FD06-F10].
- **Check:** motion.hidden-at-rest.
- **Not when:** lazy-loaded images, which the probe lists as candidates, not verdicts [FD06-F10].

### MO-14 - Tell 12: no scroll-triggered entrances on text
- **Rule:** No fade or slide on scroll for text sections. At most one purposeful reveal per page, of a diagram that
  explains the mechanism: fired once (`once: true`), a clip-path reveal, no movement under reduced motion. No uniform
  stagger, no stagger on scroll-triggered sections, no stagger inside an element that itself animates in. A hero may
  use one entrance ordered by hierarchy, with unequal delays.
- **Why:** Emil's scroll recipes are one-shot clip-path reveals [FD03-F19]; he calls uniform stagger "artificial" and
  rejects layered entrances, while his skill's 30-80 ms stagger checklist leads agents straight to tell 12
  [FD03-F18]. His one-shot marketing reveal is a documented exception the owner's rule narrows
  [FD03 Contradictions between sources].
- **Check:** `tells` (rule SL-T12); motion.hidden-at-rest.
- **Not when:** the single mechanism reveal described above.

### MO-15 - Tell 13: no pointer-following effects by default
- **Rule:** No cursor-following beam, spotlight or tilt. A pointer-coupled effect survives only if it explains the
  mechanism or lives in the one-time hero, is spring-smoothed, is gated by `(hover: hover) and (pointer: fine)`, is off
  under reduced motion and is off in record mode.
- **Why:** Emil allows spring-smoothed decorative tracking on marketing pages and never on functional data, so the
  owner's tell is stricter than Emil [FD03-F20]. Record mode disables cursor-following effects [FD20 Deliverable].
- **Check:** `tells` (rule SL-T13), a static signature: `getAnimations()` cannot see rAF-driven motion [FD03-F25].
- **Not when:** the owner approves an effect that meets every condition above.

### MO-16 - Tell 14: hover raises contrast; feedback comes from the press
- **Rule:** `:hover`, `:active` and `:focus` show more contrast than rest. On primary actions: no `hover:opacity-*`
  below 100 and no alpha-reduced `hover:bg-*/NN` on filled buttons; move the colour toward more contrast with a
  transition of about 150 ms or less, and put feedback on `:active` (MO-06). Gate hover motion, not colour, behind
  `(hover: hover) and (pointer: fine)`; Tailwind v4's `hover:` adds only `(hover: hover)`.
- **Why:** Vercel's C82; no hovered control lost opacity on 3 human sites (0 of 28) [FD04-F14]. shadcn's `/90`
  hover cut text contrast from 17.18:1 to 13.01:1 while `opacity` stayed 1, so the check compares rendered contrast,
  not opacity [FD04-F25]. A fading highlight trails the cursor on frequently used lists [FD03-F21]. Hover gating
  [FD03-F16].
- **Check:** `tells` (rule SL-T14).
- **Not when:** a colour fade toward higher contrast passes [FD04-F12].

### MO-17 - No autoplay beyond muted, non-essential loops
- **Rule:** Autoplay only muted, non-essential loops. Motion that plays on its own for more than 5 s beside other
  content gets pause, stop or hide controls. Decorative loops stop under reduced motion. Nothing blinks faster than
  333 ms per cycle.
- **Why:** Vercel's input-driven rule [FD03-F28]; C35 and C36 [FD04 Appendix A]. WCAG 2.3.2's three-flashes limit and
  the 333 ms design choice [FD20-F16].
- **Check:** motion.inventory; motion.reduced; recording.g12.
- **Not when:** no exception.

### MO-18 - Freeze motion in record mode
- **Rule:** With `?record=1`, freeze decorative loops, marquees, tickers, blinking badges, grain and pointer effects,
  and show hover content at rest. A state change that carries proof settles within 400 ms, then holds at least 0.33 s
  per word of its label and never less than 1.2 s. Scroll only between states. Recording rules: 09-recording.md.
- **Why:** A 100 ms transition spans 2.5 frames at 25 fps and reading needs about 0.3 s per word [FD20-F16].
  Playwright's clock does not freeze CSS animations, so the app's own record mode must [FD20-F20]. Hover-only content
  is absent from a recording [FD20-F15]. Record-mode contract [FD20 Deliverable].
- **Check:** recording.g11; recording.g12.
- **Not when:** the profile has no video and no stage format.

### MO-19 - Let the owner judge feel, in slow motion
- **Rule:** Record the hero animation and the key interactions at 2 to 5 times their duration (CDP
  `Animation.setPlaybackRate`) for the owner. The builder never approves feel. Review the demo app again after a break.
- **Why:** Emil says feel cannot be judged from code and prescribes slow motion, frame steps and a next-day look
  [FD03-F25]. Rauno's motion felt slow by day three [FD03-F27].
- **Check:** owner review.
- **Not when:** no animation beyond press feedback.

### MO-20 - Know the documented exceptions before flagging
- **Rule:** Do not flag: built-in `ease-out` on feedback under 200 ms; toasts near 400 ms `ease`; full-height drawers
  at 500 ms; one-shot exit keyframes; `ease` or Tailwind's default curve on a colour-only hover; plain `transition`,
  which lists properties. Judge each element at runtime, never by class presence.
- **Why:** Emil's own libraries and examples break his rules [FD03-F23] [FD03-F06]. His site's compiled CSS holds
  `transition-all`, `ease-in` and the default curve 11 times [FD03-F24]. Plain `transition` is not `transition: all`
  [FD03-F08].
- **Check:** critic (checks each finding against this list).
- **Not when:** no exception.

## Procedure

1. **Gate.** For each candidate animation answer MO-01 (tier) and MO-02 (purpose). No tier allows it, or no purpose:
   stop. No animation is a valid result.
2. **Declare** the entry in `design/motion.json` (MO-03).
3. **Implement** with the tokens of 05-tokens.md TK-20: a CSS transition on `transform` and `opacity`,
   `@starting-style` for entry, the trigger's origin for popovers, transitions for anything re-triggerable
   (MO-04 to MO-11). Library use: 13-stack.md SK-12.
4. **Reduce:** write the `prefers-reduced-motion: reduce` variant in the same change (MO-12).
5. **Record:** add the record-mode freeze when the profile has a video or stage (MO-18).
6. **Check:** `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates motion,tells --root <repo>
   --profile <abs path> --serve <built dir>`, adding `recording` when the profile has a video. motion-check.mjs loads
   each route twice (`reducedMotion` `no-preference`, then `reduce`) and diffs `document.getAnimations()` against the
   manifest and the budgets; it scrolls through the page and compares opacities before and after (the reveal probe).
   The `tells` rule SL-T14 compares rendered text contrast before and after hover [FD03-F25] [FD06-F10] [FD04-F25].
7. **Feel:** export the slowed recordings for the owner (MO-19).

## Gaps
- No measurement backs Emil's numbers (300 ms, 0.97, 30-80 ms); they are practitioner judgement [FD03-F07]
  [FD03 What could not be found, and how it was searched].
- Mapping tells 12, 13 and 14 to Emil's rules is interpretation, and "fade on hover" is ambiguous [FD03-F21].
- No motion rule is calibrated; human control sites trip naive greps [FD03-F24].
- `getAnimations()` misses rAF-driven motion (Motion's independent transforms, canvas, pointer handlers) [FD03-F25].
- The reveal probe checks opacity only; `visibility`, clip-path, off-screen transforms and mount-on-scroll reveals
  need further checks [FD06-F10].
- Composited clip-path is on from Chromium 152 only; Safari and Firefox are unchecked [FD03-F30].
- Hybrid devices can report `hover: none`, so a gated hover never shows there [FD03-F16].
- motion.inventory fails only on role budgets and on infinite loops outside `data-live` (CONTRACTS 6.2 v1.1). Ease-in
  entrances, `scale(0)` starts and `transition: all` are notes plus candidate-tier `tells` rules, so until calibration
  promotes SL-MO1, SL-MO2 and SL-MO4 nothing fails on them: critics must read the notes.
