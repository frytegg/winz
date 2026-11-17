# Critique: bounded rounds, separate critics, blind probes and the owner's three checkpoints

Read when: you run P7 or task FE-20, write or review `assets/wave-fragments/critique.js`, call `frontend-critic` or `frontend-probe`, or prepare H1, H2 or H3 for the owner.

## Purpose
Model critics are weak on taste and strong enough on defects when they compare, use checklists and see code with screenshots. This file sets how a critique round runs, when a candidate replaces the best-so-far, when the loop stops, how the blind probe tests first-sight comprehension, and what the owner decides at H1, H2 and H3.
Gates stay the proof (`10-gates.md`); critique only proposes fixes and accepts or rejects them. Wiring (fragments, agents, answer channel) is in `00-contract.md`.

## Rules

### CR-01 - Never let the builder grade its own work
- **Rule:** The agent that wrote a section never judges it. Critique runs in separate fresh-context agents: `frontend-critic` finds issues and gives pairwise verdicts; `frontend-probe` reads the first viewport blind. Mode A calls them from /execution's wave script through `feCritique`; mode B calls them from /frontend's own workflow through the same function.
- **Why:** Agents grading their own work skew positive, most of all on design, and a separate skeptical evaluator was far more tractable [FD15-F32]. Judges favour their own outputs and a position [FD17-F14]. "The agent doing the work isn't the one grading it" [FD15-F21].
- **Check:** owner review of the round receipt (a critic or probe agent behind every verdict).
- **Not when:** never.

### CR-02 - Compare pairwise, in both orders; never score alone
- **Rule:** Every acceptance decision is a pairwise verdict on the affected section, best-so-far against candidate, asked twice with the order swapped. The candidate wins only if preferred in both orders; disagreement counts as "no improvement". Log the share of inconsistent pairs per round: a high share means the two are too close for a judge, and the gates or the owner decide.
- **Why:** Pairwise beats single grading by over 8 points, and the best web judges plateau near 70% against 84.56% human agreement [FD17-F07]. Asking in both orders is MT-Bench's conservative rule [FD17-F14]; it measured no accuracy gain, so it guards against false accepts only [FD17-F28]. Absolute VLM scores drift while pairwise holds [FD08-F18]. Pairwise accuracy is near chance when candidates differ slightly [FD17-F06].
- **Check:** `critic` (the receipt holds both orders of each verdict).
- **Not when:** small tweaks (one spacing value, one shade) are decided by deterministic metrics, not by a judge [FD17-F06].

### CR-03 - Ask binary checklist items from the brief, with the rubric in the prompt
- **Rule:** Derive the checklist from `brief.json`. Per feature: (a) the heading names the feature in the user's terms; (b) a concrete artifact is shown (live widget, real transaction, code, product capture; an icon does not count); (c) one outcome or number is visible. Add the first-screen items. Each item is yes or no with a mark id. Score dimensions separately (visual task fit, aesthetics, code task fit, code quality), never one overall number. Screenshot critique uses contrast, repetition, alignment, proximity and Material's grouping principles; Nielsen's heuristics only for scripted flows. Put the rubric text itself in the prompt.
- **Why:** Binary rubric items beat Likert scales [FD17-F07]; per-task checklists with screenshots and code reached the highest measured agreement [FD17-F08]; a multi-dimensional judge agreed 69.5% against 48.5% for a single score [FD17-F09]; feedback without the guideline text was worse [FD17-F05]; Nielsen's heuristics need flows while CRAP fits a single screen [FD17-F19]. The feature items are B2 of [FD17 Deliverable A].
- **Check:** `critic`.
- **Not when:** never.

### CR-04 - Give critics code, marked tiles and element metadata; never ask for coordinates
- **Rule:** Each critic call gets the section's source, DOM-marked viewport tiles (numbered marks mapped to selectors), the element metadata JSON (rects, computed styles), several states per feature (initial, mid-interaction, result) and the gate JSON. Never ask a model for coordinates, sizes or spacing values: geometry comes from the DOM. Every issue cites a mark id.
- **Why:** Models localise UI problems poorly (best IoU 0.222 with numbered patches, GPT-5 below 0.20), and numbered marks let a model refer to regions [FD17-F03]. Code was the dominant modality [FD17-F07]; several staged screenshots plus code raised agreement to 90.95% [FD17-F08]; for edits, code beats screenshots, and models named UI defects with 0.27 accuracy [FD08-F08]. Opus 5.5 reads screenshots better, but its reading is not a measurement [FD15-F24].
- **Check:** `critic` (issues without a mark id are dropped, CR-06).
- **Not when:** never.

### CR-05 - Size tiles for what the model can see
- **Rule:** Desktop tiles 1440x900 at DPR 1 (1,716 visual tokens, not resized); mobile tiles 390x844 at DPR 2 (780x1688); `animations: "disabled"`; one viewport per tile, taken after real scrolling. Never a tall full-page capture. At most 20 images per critic conversation, counting earlier turns; above 20, every side must be 2,000 px or less or the image is rejected. Keep full-resolution files on disk and let the critic open crops.
- **Why:** An image costs ceil(w/28) x ceil(h/28) visual tokens, the high-resolution tier caps the long edge at 2,576 px, a 1440x6000 capture shrinks to about 618 px wide, and above 20 images the 2,000 px limit is a hard rejection [FD06-F13]. Claude reads 28 px patches and downscales larger images [FD17-F04]. Full-page captures never scroll, so reveals stay invisible [FD06-F10]. Crop and zoom still add accuracy [FD15-F24].
- **Check:** owner review of the round receipt (tile sizes, images per critic call).
- **Not when:** never.

### CR-06 - Keep at most 5 issues per round, each actionable
- **Rule:** A round yields at most 5 issues. Each names a mark id, the measured problem (from the DOM or a gate, never an impression) and one concrete change stated as the target state. Drop items missing any of the three. Phrase fixes as what to do, never as a list of patterns to avoid.
- **Why:** A zero-shot critic produced more comments and more invalid ones [FD17-F02]; generic feedback is weaker than specific feedback [FD17-F11]; the cap and the item format are layer 2 of [FD17 Deliverable A]; literal bad examples in instructions primed models to reproduce them [FD02-F33].
- **Check:** `critic` (the fragment rejects a round output above 5 issues or without mark ids).
- **Not when:** never.

### CR-07 - Keep an issue only if 2 of 3 critics raise it or a check confirms it
- **Rule:** Run `profile.critique.critics` (default 3) passes in separate contexts, each with its own rubric slice or persona, none seeing the others' notes. Merge by affinity. Keep an issue only when at least 2 passes raise it, or when a deterministic check confirms it.
- **Why:** A single evaluator finds about 35% of usability problems, three to five independent evaluators are recommended, and three samples of one model have correlated errors, hence the separate slices [FD17-F15].
- **Check:** `critic` (the receipt lists which passes raised each kept issue).
- **Not when:** a failing gate needs no critic agreement: fix it (`10-gates.md`).

### CR-08 - Fix one typed defect at a time and keep a history
- **Rule:** Each fix attempt targets one typed defect (completeness, layout, spacing, typography, colour, copy) with a scoped change, recorded in the round history so it is not argued again. Broken builds and renders come first; once the page renders cleanly, polish stops unless a typed defect is open.
- **Why:** Free-form self-refinement couples repairs, peaks around round 3 and collapsed in 18% of Claude Sonnet 4.5 trajectories; one targeted defect per round with a history did better [FD08-F13]. Iteration pays most on broken builds; polish rounds return little for Claude-class models [FD08-F14].
- **Check:** owner review of the history file in `critique/round-<n>/`.
- **Not when:** never.

### CR-09 - Accept a candidate only when it keeps every gate and wins both orders
- **Rule:** After each fix, rerun every gate the task's proof covers; any regression or broken render rejects the candidate. Then no deterministic sub-score may drop, and the candidate must win the pairwise verdict in both orders against the best-so-far (CR-02). Otherwise revert to the best-so-far snapshot and try a different fix, at most 2 retries per issue. When a functional fix lands on a section that passed a visual round, rerun the visual gates and the pairwise check on that section.
- **Why:** Without an acceptance rule revisions collapsed after 2 to 3 rounds; accepting only strict improvements over the best-so-far added 2.0 points [FD17-F10]. Functional edits damaged appearance until backtracking and select-best recovered it [FD17-F13]. Self-revision without an external signal can regress [FD17-F12]. The rule is layer 2 of [FD17 Deliverable A].
- **Check:** `frontend-check --phase {mode}` (`build` or `small`) exits 0 on the accepted candidate; `critic` verdicts in both orders sit in the receipt.
- **Not when:** never.

### CR-10 - Snapshot every round and ship the best, not the last
- **Rule:** Before round 1, record the incumbent as round 0 (commit SHA, tiles, gate JSON). Snapshot every round. The final state is the best-so-far under CR-09, never automatically the last round. Never select the best with the same judge call that reports its score.
- **Why:** Keeping the best version gave +10.8% against +6.1% after cycle 3, part of it selection on the same judge's noise [FD17-F09]; Anthropic's harness sometimes preferred a middle iteration [FD15-F32]; even a model trained to polish oscillates between rounds [FD08-F15]; most of the gain comes in cycle 1 [FD08-F12].
- **Check:** owner review of the receipt (the best-so-far SHA and the verdicts behind it).
- **Not when:** never.

### CR-11 - Cap the rounds from the profile and stop after 2 rejections
- **Rule:** At most `profile.critique.rounds_max` rounds per checkpoint (default 3, small mode 1). Stop earlier after 2 consecutive rejected candidates, or when no issue survives consolidation (CR-06, CR-07): there is then nothing to implement, and a further round would only re-ask the critics about an unchanged best-so-far (receipt `stop_reason: no-issue-kept`). Never stop because one critic says it is satisfied while a kept issue remains, and never continue past `rounds_max` because the critics still find something.
- **Why:** Gains concentrate in cycle 1 (+4.9%, then +0.9 and +0.3 points) while tokens grow about 20 times [FD17-F09]; revisions collapse after 2 to 3 rounds without acceptance [FD17-F10]; LLM feedback gets less accurate once the design improves (52% to 39% accurate) [FD17-F05]. Anthropic's harness ran 5 to 15 iterations over hours and plateaued, which a hackathon build has to cap [FD15-F32]; stop after two or three automatic continuations [FD15-F21].
- **Check:** owner review of the receipt (round count at most `rounds_max`).
- **Not when:** never.

### CR-12 - Run the blind probe and require 4 of 5
- **Rule:** Run `profile.critique.probes` (default 5) `frontend-probe` calls on the best-so-far. Each sees only the first-viewport tiles, desktop and mobile: no brief, spec, DOM, repo or project CLAUDE.md. Ask: what is this page about, what is offered, who is it for, what problem does it solve. A separate `frontend-critic` call marks each answer against the brief's category, user and problem. Pass: at least 4 of 5 probes restate the brief's one-line proposition on both viewports. A pass shows comprehension only, never legibility or the correctness of a number.
- **Why:** The 5-second questions and a vendor's "more than around 80%" bar become 4 of 5 fresh probes; a model reads copy instantly, so the probe is more lenient than a person [FD17-F18]. Viewers take one purpose from a first look [FD11-F14]. A model's blind read over-reads degraded text, so it checks comprehension only [FD20-F07]. The probe is B1 of [FD17 Deliverable A].
- **Check:** `critic` (the marking call); the receipt holds the 5 answers and their marks.
- **Not when:** never treat a pass as the jury's verdict: no study validates a model as a 5-second participant [FD17-F18].

### CR-13 - Keep critic prompts neutral and calibrated
- **Rule:** Critics receive the brief, the rubric slices and the tells catalogue (`11-tells.md`); builders receive the direction, the tokens and failure shapes. Put no aesthetic superlative ("museum quality", "premium") in a critic prompt. Once a bank of expert-style critiques from the owner's corpus and the control sites exists, retrieve the most similar ones as few-shot examples.
- **Why:** The harness's criteria wording ("museum quality") pushed designs toward one look, and its evaluator was calibrated with few-shot score breakdowns [FD15-F32]. Few-shot expert critiques retrieved by similarity raised critique quality by 55% [FD17-F02]. Literal bad examples prime builders [FD02-F33].
- **Check:** owner review of the agent definitions.
- **Not when:** never.

### CR-14 - Use the critic for defects, never for taste choices
- **Rule:** Never ask a critic which of two directions, palettes or logos is better: those are H1 and H2. For hierarchy, give blurred tiles (radius 5, 10 and 20 px, to calibrate) and ask for the three most prominent elements in order, compared with the declared intent per viewport.
- **Why:** On visual taste, off-the-shelf judges sit near chance on designer preference, and models converge to "equivalent" on near-identical pairs while designers commit [FD17-F16]. VLM judges correlate weakly with humans on creative SVG [FD12-F09]. The blur radii come from one NN/g illustration, not a protocol [FD17-F18].
- **Check:** owner review of the critic prompts.
- **Not when:** never.

### CR-15 - Run the loop only through feCritique
- **Rule:** Rounds, acceptance and revert live in `assets/wave-fragments/critique.js` (`async function feCritique(api, input)`, `api = {agent, parallel, pipeline, log}`), never in a hand-written wave script. Every command inside it (capture, gates, diff) is an `agent()` call that runs the command and returns its JSON; critics and probes are `agent(prompt, {agentType})` calls, the passes of one step issued in parallel. No imports, no `Date.now`, no `Math.random`. It returns the round receipt.
- **Why:** Agreed so /execution never re-implements rounds, acceptance or revert-to-best [agreement with /execution, 2026-10-01, CONTRACTS.md]. A workflow agent cannot spawn subagents, so each independent checker is a separate `agent()` call in the script [FD13-F03].
- **Check:** `grep -nE "Date\.now|Math\.random|^import " ~/.claude/skills/frontend/assets/wave-fragments/critique.js` prints nothing.
- **Not when:** never.

### CR-16 - H1: show 2 or 3 clearly different directions, then wait
- **Rule:** Present the screened directions (`10-gates.md` GT-12) as named options, each rendered at 1440x900 and 390x844 with the real copy, each with its rationale and its main trade-off. Make the case for every option, not only one. The owner picks; record the answer in `choices.json`.
- **Why:** The owner chooses among two or three clearly different options [FD17-F16]; differences must be detectable to a nondesigner or people invent a preference [FD17-F18]; a set where only one option gets a case is a rigged vote [FD15-F19].
- **Check:** owner review.
- **Not when:** never pick for the owner.

### CR-17 - H2: render the marks at real sizes and review defects only
- **Rule:** Show 3 to 5 candidates at 16, 32, 180 and 512 px with one-colour silhouettes on light and dark, plus 16x nearest-neighbour enlargements. The model reviews defects only (clipped strokes, merged counters at 16 px, off-grid edges, contrast on light and dark tabs), fed with the pipeline's measurements, for at most 2 rounds. The owner picks.
- **Why:** Revision alone added 1 to 2 points over two rounds, and structured measurements carried most of the measured gain [FD12-F10]; let the owner choose among 3 to 5 candidates [FD12-F09]; the 16 px render test and the enlargements [FD12-F16].
- **Check:** owner review; `brand.candidates`.
- **Not when:** never score the marks with a model.

### CR-18 - H3: sign off the deployed preview at recording size, before any recording
- **Rule:** After FE-20 and after the owner's /harden review, give the owner the deployed preview URL, the latest gate JSON, the critique receipt and the tiles. The first screen is checked at 1536x864 CSS px (1920x1080 at 125% zoom) and in the phone browser. Nothing is recorded before the owner signs off.
- **Why:** The final sign-off before recording is the owner's, since the best judges trail humans by about 14 points and critique quality falls as the page improves [FD17 Deliverable A]; the most useful phone review is the deployed preview in the phone browser [FD07-F16]; recordings are made at 125% zoom on a 1920x1080 screen [FD20 Deliverable].
- **Check:** owner review; the H3 entry in `choices.json`.
- **Not when:** never.

## Procedure
One critique checkpoint (FE-20):
1. Preconditions: the build is green and the task's gates exit 0. Record round 0 (SHA, tiles, gate JSON).
2. Capture marked tiles and element metadata (CR-04, CR-05) for every route in the judge's path.
3. Run the critic passes in parallel with the checklist (CR-03, CR-07).
4. Consolidate: at most 5 issues, each with mark id, measurement and target state (CR-06).
5. Fix one typed defect per attempt and append it to the history (CR-08).
6. Rerun the gates, then the pairwise verdict in both orders; accept or revert (CR-09, CR-10).
7. Stop at `rounds_max`, after 2 consecutive rejections, or when no issue is kept (CR-11).
8. Run the blind probe on the best-so-far (CR-12).
9. Write `critique/round-<n>/` (tiles, issues, verdicts, gate JSON, decision, best-so-far SHA); `feCritique` returns the receipt. Then run the task's proof: `--phase {mode}` (`build` in full mode, `small` in small mode).

## Gaps
- [FD17 Deliverable A] proposes a pixel diff of each tile against the previous round, flagging changes outside the edited section. No script implements it (no pixel-diff dependency in `scripts/package.json`), so critics compare the round's tiles by eye.
- No bank of expert-style critiques exists yet; CR-13's retrieval waits for the calibration corpus [FD17-F02].
- No non-Claude critic is installed, although a panel of disjoint model families beat one large judge [FD17-F15].
- Judge agreement figures come from older models; none was measured on Claude 4.7 or later, the models that build and judge these pages [FD17 What could not be found].
- The acceptance rule's "no deterministic sub-score drops" needs sub-scores that no gate id exposes yet (`10-gates.md` Gaps).
- The provisional sign-off bar (all gates pass and a weighted score of at least 85) is uncalibrated [FD17 Deliverable A].
- Claude Code's own 2,000 px display cap was observed, not documented [FD06-F13].
