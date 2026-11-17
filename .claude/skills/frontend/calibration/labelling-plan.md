# Labelling plan: the owner's calibration session

Plan v1, written 2026-10-01 against `corpus.json` v1. Nothing is rendered yet: the session runs once the screens of
section 3 exist (order of work in section 8).

## 1. What the labels are for

`../ARCHITECTURE.md` section 5.2 asks for "the owner's labels (a 15-minute session: per screen, vibecoded or not,
and which tells)", and section 14 decision 6 schedules that session. The labels do two jobs:

1. **Check that each set means what it claims.** Positives and synthetic pages should read as vibecoded and controls
   should not. A positive the owner reads as "not" is information, not an error: Orma, for one, was built from a spec
   with explicit anti-slop bans (FD14-F18).
2. **Audit the detectors rule by rule.** For each registry rule, `calibrate.mjs` compares the screens where the owner
   saw the tell with the screens where its runtime detector fired: agreement, misses, false alarms. Tiers still come
   from detectors firing on positives and staying silent on controls (section 5.1); the labels say whether a rule that
   fires matches what a person sees.

Exemplars are not labelled. Nothing of them is captured for now, and they feed per-category allowlists, never tiers.

## 2. Which sites

| set | entries | ready on 2026-10-01 | joins the session when |
|---|---|---|---|
| positive | 12 | 8 | the four builds have run (Hedera, both SuiShield entries, TOKENA) |
| control | 11 | 9 | primer.style/css and demo.ghost.io have a verified snapshot (at most two requests each) |
| synthetic | 8 | 0 | the six pages are generated; the two TOKEN2049 pages not before 2026-10-08T11:00Z |

That is at most 31 sites, 29 while the TOKEN2049 hold stands. An entry that is not `ready` when the session is built
goes into `session.skipped` with its reason. It is never replaced by a stand-in.

| entry | set | status on 2026-10-01 | first route (S0, S1, S2) | viewport | routes left for short pages |
|---|---|---|---|---|---|
| `pos-xrpl-orma` | positive | ready | `/` | desktop | `/facility`, `/event`, `/methodology`, `/evidence` |
| `pos-bnb-holdover` | positive | ready | `/` | desktop | none |
| `pos-hedera-scaffold` | positive | needs-build | `/` | desktop | `/swap`, `/positions`, `/debug` |
| `pos-monad-auramaxx-web` | positive | ready | `/` | mobile | none |
| `pos-monad-auramaxx-mockups` | positive | ready | `/telephone/onboarding.html` | mobile | `/telephone/mise.html`, `/projo/classement.html` (projector), `/projo/freeze.html` (projector), `/operateur/index.html` (desktop) |
| `pos-inflexion` | positive | ready | `/` | desktop | `/dashboard`, `/protect`, `/earn`, `/markets`, `/underwrite`, `/data` |
| `pos-sui-figma-export` | positive | needs-build | `/` | desktop | none |
| `pos-sui-shipped` | positive | needs-build | `/` | desktop | none |
| `pos-basebatches-spark` | positive | ready | `/` | desktop | none |
| `pos-ethdenver-agentfi` | positive | ready | `/` | desktop | `/marketplace`, `/dashboard`, `/my-agents`, `/dashboard/create` |
| `pos-xrpl-tokena` | positive | needs-build | `/` | desktop | `/mpt/create-issuance`, `/mpt/send`, `/mpt/balance`, `/mpt/authorize`, `/mpt/clawback`, `/mpt/sales` |
| `pos-monad-flashscope` | positive | ready | `/` | desktop | `/dashboard` |
| `ctl-brios` | control | ready | `/` | desktop | none |
| `ctl-tailwindcss` | control | ready | `/` | desktop | none |
| `ctl-uniswap-interface` | control | ready | `/` | desktop | none |
| `ctl-guardian-dcr` | control | ready | `/uk` | desktop | none |
| `ctl-radix-website` | control | ready | `/` | desktop | none |
| `ctl-hyper-site` | control | ready | `/` | desktop | none |
| `ctl-paco` | control | ready | `/` | desktop | none |
| `ctl-govuk-frontend` | control | ready | `/` | desktop | none |
| `ctl-mozilla-protocol` | control | ready | `/` | desktop | none |
| `ctl-primer-css` | control | unavailable | `/css` | desktop | none |
| `ctl-ghost-casper` | control | unavailable | `/` | desktop | none |
| `syn-holdover-1`, `syn-holdover-2` | synthetic | needs-build | `/` | desktop | none |
| `syn-orma-1`, `syn-orma-2` | synthetic | needs-build | `/` | desktop | none |
| `syn-hedera-1`, `syn-hedera-2` | synthetic | needs-build | `/` | desktop | none |
| `syn-t2049-1`, `syn-t2049-2` | synthetic | unavailable (held) | `/` | desktop | none |

## 3. The screens: the first viewport and two scroll slices per site

**Three screens per site**, all from its first route (`first: true` in `corpus.json`), at that route's viewport:
desktop 1440x900 at DPR 1 unless the route names mobile (390x844, DPR 2, touch) or projector (1600x900, DPR 1).

| screen | scroll position | why |
|---|---|---|
| S0 | 0, the first viewport | where a first impression forms: appeal is judged within 50 ms (FD11-F01, F02) |
| S1 | one viewport height down (900 px on desktop, 844 on mobile) | the second screenful: 74% of attention falls within two screenfuls (FD11-F10) |
| S2 | two viewport heights down | the third screenful: 81% within three (FD11-F10) |

**Short pages.** A slice is kept only when at least half of it is new, that is when the document is at least
`k x H + H / 2` tall for slice k and viewport height H. Otherwise it is replaced by the first viewport of the next
route listed in `routes`, at that route's own viewport, and the screen records `replaced_by_route`. With no route
left, the site has fewer than three screens and the missing ones are recorded. Never a tall full-page image: it does
not read like a screen and the critic's images are capped at 2,576 px (FD06-F13).

**How each screen is made.** From the same frozen render that `calibrate.mjs` scores, so the owner and the detectors
see the same pixels: the first load records a HAR file, every capture replays it.

- Readiness as `scripts/CONTRACTS.md` section 3 `waitReady`: `document.readyState` complete, `document.fonts.ready`,
  every image complete, two animation frames, never `networkidle`.
- After each scroll, 1,200 ms of settling plus two animation frames, so scroll-triggered reveals have finished.
- The default motion setting, not reduced motion: the look a visitor gets is what is labelled.
- No hover, no click, no consent dismissal. A cookie or consent layer that hides more than a third of the screen sets
  the capture flag `obstructed`.
- Page-only PNG: no browser chrome, no URL, no title bar. File names are opaque: `s-` plus the first 8 hex digits of
  SHA-256 of `session id + entry id + screen`.
- Wayback entries load `replay_url` (the `if_` form, no toolbar) with every request outside `web.archive.org`
  blocked, so nothing from today leaks into a 2022 page; one site at a time, at least 5 s apart.
- Live entries are rendered shortly before the session, and each screen keeps its render time: Holdover's and Orma's
  figures change from day to day, and the screen is what was labelled.
- `serve` entries use `scripts/lib/serve.mjs`; `build` entries are built first (section 8), never by the session.

**Where the pixels live.** Renders, HAR files and screens of every site go to a private folder outside any git work
tree, with a SHA-256 manifest, and are deleted with a receipt once `labels.json` is merged and `calibrate.mjs` has
run. That is FD19's rule for captures of third-party sites (`../ARCHITECTURE.md` section 11b), applied to every
screen so one rule covers the session. Only `labels.json`, which holds no pixels, stays in the skill;
`calibration/.gitignore` is a safety net, not the plan.

## 4. A blind, shuffled order that mixes the three sets

**Two passes in one sitting.** Pass 1 shows every site's S0 (at most 31 screens). Pass 2 shows every S1 and S2 (at
most 62) plus four repeats. The first viewport is where a jury's first impression forms, so if time runs out after
pass 1 the session still holds one complete, comparable label per site.

**Shuffle.**

1. `order_seed` = `frontend-calibration-` plus the session id (for example `frontend-calibration-L1`). The PRNG is
   mulberry32, seeded with the first 8 hex digits of SHA-256(`order_seed`). Each pass is a Fisher-Yates shuffle.
2. Constraints. Pass 1: no more than 2 consecutive screens from the same set. Pass 2: no more than 3 consecutive from
   the same set, and two screens of one site at least 8 positions apart.
3. Repair by reshuffling from the same PRNG stream, up to 1,000 times. If that fails, relax the spacing one step at a
   time and record the relaxation in `constraints_relaxed`.
4. Repeats: four S0 screens (two positives, two controls, drawn by the same PRNG) are shown again in pass 2, each at
   least 20 positions after its first showing. They measure test-retest agreement.

**Blindness.** The session builder writes two files. `order.json` holds the display order as opaque screen ids and
image files, and it is all the labelling page loads. `key.json` maps each screen id to its entry, set, route, slice
and source; the labelling page never loads it. Names, sets, authorship and URLs never appear on screen.

**Known limit.** The owner will recognise his own projects and some famous controls (the Guardian, GOV.UK,
tailwindcss.com). The `recognised` flag records it, and every derived figure is also reported without the recognised
screens (section 6).

## 5. The two questions per screen

**Q1, "Vibecoded or not?"**: `vibecoded`, `not` or `unsure`. A gut read; it must be answered before moving on. There
is no time limit, and the time spent is recorded.

**Q2, "Which tells do you see?"**: a multi-select; an empty list means none. The ids are the rule ids of
`scripts/rules/registry.json`, so labels join detector findings without a mapping table.

- **Row A, always on screen: the owner's tells a still image can show (17).** `SL-T01` purple-to-blue gradient,
  `SL-T02` gradient hero text, `SL-T03` emojis in headings, `SL-T04` Inter everywhere, `SL-T05` coloured border
  cards, `SL-T06` glassmorphism cards, `SL-T07` low-contrast dark mode, `SL-T08` three icon boxes in a row, `SL-T09`
  badge above the headline, `SL-T10` Lucide icons everywhere, `SL-T11` untouched shadcn UI, `SL-T15` inconsistent
  spacing, `SL-T16` em dashes everywhere, `SL-T17` generic buzzword copy, `SL-T18` serif italic accents, `SL-T19`
  Space Grotesk + Instrument Serif, `SL-T20` grain over a gradient.
- **Row B, one key opens it: the other still-visible rules (22).** `SL-M01` to `SL-M17` (cream, serif and clay;
  tracked ALL-CAPS eyebrows; 01/02/03 markers; stat banner with invented numbers; fake testimonials and "trusted by"
  walls; FAQ accordion; SaaS-card kit; near-black and zinc dark default; glows and blurred blobs; logo or text
  marquee; bento grid; centred hero with "Get started" and "Learn more"; template chrome; grid-line background;
  nested cards; shape-built illustrations and fake screenshots; "Built for X" headlines), `SL-C01` pill buttons
  everywhere, `SL-C02` 100vh hero, `SL-C03` everything centred, `SL-X01` unsourced metric, `SL-X02` placeholder names
  and copy.
- **Not offered, because a still cannot show them:** `SL-T12` fade-in on scroll, `SL-T13` cursor-following beam,
  `SL-T14` buttons fade on hover, `SL-MO1` to `SL-MO5` (motion), and the code-level generator signatures `SL-G01` to
  `SL-G04`. These rules calibrate on detector output alone.
- **`other`**: free text up to 200 characters, for anything the rows do not name.

**Proposed keys.** Q1: `z` vibecoded, `x` not, `c` unsure. Row A: `1` to `9` for `SL-T01` to `SL-T09`, `0` for
`SL-T10`, then `q` `SL-T11`, `w` `SL-T15`, `e` `SL-T16`, `r` `SL-T17`, `t` `SL-T18`, `y` `SL-T19`, `u` `SL-T20`.
Row B: `Tab` opens the panel; typing filters it by name, `Enter` toggles the highlighted rule, `Esc` closes it.
Flags: `b` broken render, `o` obstructed, `g` recognised. `.` focuses the `other` field. With the panel closed,
`Enter` saves and moves on (only once Q1 is answered) and `Backspace` goes back one screen.

**On screen:** the image at its CSS size, scaled down to fit the display if needed and never cropped; the row A legend;
a counter such as "17 / 91". Nothing else: no id, no name, no set.

## 6. The format of `calibration/labels.json`

The labelling page exports `labels.raw.json` into the private session folder: the session block and the labels, keyed
by screen id only. `calibrate.mjs` joins it with `key.json` and writes `calibration/labels.json`, the only file of the
session kept in the skill. A second sitting appends a session; it never rewrites an earlier one.

```json
{
  "version": 1,
  "corpus_sha256": "SHA-256 of the calibration/corpus.json the session was built from",
  "registry_sha256": "SHA-256 of scripts/rules/registry.json when the session was built",
  "sessions": [
    {
      "id": "L1",
      "labeller": "owner",
      "started_at": "2026-10-02T08:00:00Z",
      "ended_at": "2026-10-02T08:15:40Z",
      "order_seed": "frontend-calibration-L1",
      "display": "laptop",
      "questions": { "verdict": "Vibecoded or not?", "tells": "Which tells do you see?" },
      "tells_offered": { "row_a": ["SL-T01", "SL-T02"], "row_b": ["SL-M01", "SL-X02"] },
      "passes": [ { "pass": 1, "screens": 29 }, { "pass": 2, "screens": 62 } ],
      "skipped": [ { "entry": "syn-t2049-1", "reason": "held until 2026-10-08T11:00Z" } ],
      "constraints_relaxed": null,
      "notes": ""
    }
  ],
  "screens": [
    {
      "screen": "s-3f9c1a07",
      "session": "L1",
      "entry": "pos-bnb-holdover",
      "set": "positive",
      "made_by": "owner",
      "route": "/",
      "viewport": "desktop",
      "slice": 0,
      "scroll_y": 0,
      "replaced_by_route": null,
      "source_url": "https://holdover.fly.dev/",
      "rendered_at": "2026-10-02T07:41:12Z",
      "har_sha256": "SHA-256 of the HAR replayed for this screen",
      "png_sha256": "SHA-256 of the PNG the owner saw",
      "capture_flags": [],
      "repeat_of": null
    }
  ],
  "labels": [
    {
      "screen": "s-3f9c1a07",
      "session": "L1",
      "pass": 1,
      "position": 7,
      "verdict": "vibecoded",
      "tells": ["SL-T16", "SL-M13"],
      "other": "",
      "flags": [],
      "ms": 6400,
      "answered_at": "2026-10-02T08:02:31Z"
    }
  ],
  "derived": {
    "by": "scripts/calibrate.mjs",
    "at": "2026-10-02T08:20:00Z",
    "entries": [
      {
        "entry": "pos-bnb-holdover",
        "set": "positive",
        "verdict": "vibecoded",
        "first_view": "vibecoded",
        "votes": { "vibecoded": 2, "not": 1, "unsure": 0 },
        "screens": 3,
        "excluded": 0,
        "recognised": true,
        "tells": { "SL-T16": 2, "SL-M13": 1 }
      }
    ],
    "sets": { "positive": { "vibecoded": 0, "not": 0, "unsure": 0 } },
    "test_retest": { "pairs": 4, "verdict_agreement": 0.75, "tells_jaccard_mean": 0.5 },
    "without_recognised": { "sets": { "positive": { "vibecoded": 0, "not": 0, "unsure": 0 } } }
  }
}
```

| field | rule |
|---|---|
| `labeller` | always the role `owner`, never a name or an email address |
| `screen` | opaque id from section 3; unique across sessions |
| `slice` | 0, 1 or 2 (S0, S1, S2); a repeat carries the slice of the screen it repeats and its id in `repeat_of` |
| `scroll_y` | CSS pixels at capture; 0 for a slice replaced by another route's first viewport |
| `replaced_by_route` | the route path that supplied this slice, or null |
| `capture_flags` | set by the renderer: `obstructed`, `broken` (blank page, missing styles, a load error on screen) |
| `verdict` | `vibecoded`, `not` or `unsure` |
| `tells` | registry ids from this session's `tells_offered`, no duplicates; an empty list means none seen |
| `other` | free text, at most 200 characters; stays in this file |
| `flags` | set by the owner: `broken`, `obstructed`, `recognised` |
| `ms` | integer milliseconds from the screen appearing to `Enter` |
| `position` | 1-based place in the session's display order, repeats included |

**Derivation (written by `calibrate.mjs`, never typed by the owner):**

- A screen flagged `broken` by the renderer or by the owner is excluded from every figure. `obstructed` screens
  count, and are also reported apart.
- The entry verdict is the majority of its remaining S0, S1 and S2 verdicts, `unsure` left out; a repeat counts once,
  with its first answer. A tie goes to S0. With no decisive screen the verdict is `unsure`. The verdict is copied into
  `corpus.json` as the entry's `label_owner`.
- `first_view` keeps S0's verdict alone, since the first viewport carries the first impression (FD11-F01, F02).
- `tells` per entry counts the screens on which each id was marked.
- Test-retest: the share of repeat pairs with the same verdict, and the mean Jaccard index of the two tell sets.
- Every set-level figure is reported twice: all screens, and without the screens flagged `recognised`.

## 7. Time budget

At most 31 sites, so 93 screens plus 4 repeats = 97; with the TOKEN2049 hold, 29 sites and 91 screens. At about
12 s per first viewport and 7 s per slice, pass 1 takes about 6 minutes and pass 2 about 8, so about 15 minutes when
row B is used sparingly. If the session runs long, it stops after pass 1, and pass 2 becomes a second session with
its own seed over the same screens.

## 8. Order of work before the session

1. Build the four `needs-build` positives with the commands in `corpus.json` (outputs to a scratch folder outside any
   git work tree; the Hedera bounty is due 2026-10-04, so render it after submission or at a pinned commit).
2. Retry `ctl-primer-css` and `ctl-ghost-casper`: one CDX lookup for an exact 200 text/html capture in 2022, then one
   replay of that exact timestamp, 5 s apart.
3. Generate the six unheld synthetic pages under their prompt files' protocol, then set their entries to `ready`.
4. Render every `ready` entry once with HAR recording, then cut the screens of section 3.
5. Build the session (`order.json`, `key.json`, the labelling page) and run it.
6. Merge into `labels.json`, fill `label_owner` in `corpus.json`, run `calibrate.mjs`, then delete the private
   session folder with a receipt.
7. Ask the owner the questions the manifest cannot answer: the authorship of `pos-xrpl-tokena` (FD10-F29 assumes the
   owner's own work; git says v0 plus a teammate) and of `pos-monad-flashscope` (git says mostly Andrea), the origin
   of the AURAMAXX mockups ("Cowork Design"), and the customer pages of Spark (spark.finance or spark.fi), Euler
   (euler.finance) and Curve (www.curve.finance).
