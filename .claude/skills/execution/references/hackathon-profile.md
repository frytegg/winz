# The hackathon profile

Read this when the profile's event is a hackathon: at planning (Phase B tasks, prework rule, UI budget, deliverable
sub-plan), before T0 (`/execution pre-t0`), and when the clock reaches an anchor of the event (recon pass, demo audit,
freezes). /hackathon's own references stay the source of each practice; this file says how /execution schedules
them. SKILL.md standing rules 12 and 15 apply.

## Phase B as scheduled tasks

/hackathon's Phase B practices are tasks of the execution library (`execution:EX-HB-*`), each with `brief_refs` into
`~/.claude/skills/hackathon/references/` so the agent reads the practice there:
- **Claims ledger**: opened at T0, rows added by verifiers (marked `unverified` at ingest), closed at the freeze.
  EX-HB-CLAIMS-VERIFY is a gate before FE-20: a verifier re-runs each row's evidence and marks it verified before the
  UI renders any figure from it.
- **DX journal**: implementers write a row at the moment of friction with the verbatim error; ingest appends it
  marked `UNVERIFIED` in /hackathon's column format.
- **Recon passes**: on the cadence table mapped to the real clock (Origins: Tuesday evening, Wednesday morning, and a
  narrow final pass early enough to act on), anchored to event instants and computed by `exec.py due`.
- **Demo audit at T-6h**: an anchored task, never a cron.
- **Adapted preflight that can say no**: /hackathon's shipped skeleton exits 0 on stale state; the adapted one fails.
- **Visibility calendar** for remote builds, and **the judge's fetch run twice** before submitting.

## Prework

When the event forbids prework, `profile.prework` says so and invariant P-16 enforces it: no task of kind code,
test, infra, deploy or tx, and no template task of prework class design or code, is released before
`prework.until_utc`; the product-repo bootstrap is released at or after it, so the first-commit timestamp of the
event repo is after T0. The policy's fences deny agent reads of `<private_dir>/research/probes/**` and writes
outside the repo. No visual before T0 (tokens, logo, mock). Before T0 only the knowledge-level skeleton runs, in
`pre-t0` mode: `exec.py init --project <slug> --executor A --pre-t0 --state <private_dir>/execution-pre`, then
`exec.py plan instantiate --pre-t0` and `exec.py wave emit --pre-t0` for /frontend's FE-00 and FE-02 (research, with
the frontend state under `<private_dir>/frontend/`), FE-01 posted to the owner through Notion or Remote Control.
Nothing of the pre-T0 wave is approved or done: at T0 `exec.py init --project <slug> --executor A --import-from
<dir>` imports the knowledge files and the frontend state, and a verifier proves their outputs after T0.

## UI budget

/frontend runs in `small` mode (about 1-2 hours of UI) or `full` mode. The planner proposes the mode from the
rubric's UX weight (Origins: the Cardano track weighs UX and design at 20 %, so small mode is proposed); the owner
confirms it at approval, where the summary states the mode and its hours. The mode (`profile.frontend.mode`) decides
the estimates of every FE template and the phase of /frontend's checker in the build gate: `FRONTEND.build` and
harden-ready H14 pass `--phase small` in small mode and `--phase build` in full mode (`references/frontend.md`).

## Deliverable sub-plan

Present in the plan from the start for scheduling, blocked until the build-complete gate, /harden's review
(EX-HARDEN-REVIEW) and the newest fix gate (EX-FIX-GATE): build → harden → fix → record → ship (P-17). In order:
FE-21 (the owner's sign-off of the deployed preview at recording size), the deck lock, the recording, EX-DLV-PROSE
(the owner types /prose on the README and docs, after the recording), the slides, the Drive upload, the submission
form, the public flip (with its whole-history never-show proof), the tag (before the push freeze), and README
screenshots last (taken headlessly when Windows is not activated: the activation watermark would show). The schedule
counts these steps in the build-complete deadline, so the build is due early enough for them.

## Event-shipped tools

Some events ship their own tools into the workspace (an organiser's capture hooks, a feedback skill). The profile's
`event_tools` slot records them; they must coexist with /execution's hooks and guard (they keep their own settings
entries; `exec.py hooks install` touches only entries tagged as ours). An event tool that would conflict with a
standing rule (for example one that adds attribution to commits) is a decision for the owner, never a silent
override in either direction.
