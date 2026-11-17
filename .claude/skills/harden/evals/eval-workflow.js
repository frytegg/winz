export const meta = {
  name: 'harden-eval',
  description: 'Paired evaluation of the /harden skill: 3 fixtures x (with skill, without skill) x N repeats, each scored by an independent grader against a hidden ledger and hidden behaviour tests',
  phases: [
    { title: 'Run', detail: 'one agent per (fixture, condition, repeat) on its own clone' },
    { title: 'Score', detail: 'independent grader per run with the hidden ledger' },
    { title: 'Summarise', detail: 'compare conditions, write evals/results.md' },
  ],
}

const SKILL = args.skill
const FIX = args.fixtures
const RUNS = args.runs
const REPEATS = args.repeats || 2
const LABEL = args.label || 'v1'
const FIXTURES = args.only || ['ts', 'py', 'rs']

const SETUP = (f, dir) => `Setup (do this first): git clone "${FIX}/${f}/repo" "${dir}" and work only inside "${dir}". ${f === 'ts' ? 'Then run "pnpm install --frozen-lockfile --offline" in it (if that fails, run "pnpm install --frozen-lockfile").' : f === 'rs' ? 'Rust builds offline (no external crates).' : 'Python: use the system "python"; pytest is installed.'} Never read or open anything under "${FIX}" other than cloning "${FIX}/${f}/repo" (in particular never look at "${FIX}/${f}/hidden").`

function withPrompt(f, dir) {
  return `${SETUP(f, dir)}
${''}
You are Claude Code, and the user has just typed "/harden" in the repository "${dir}". The skill's instructions are in "${SKILL}/SKILL.md": read it now and follow it exactly, phase by phase, reading each reference file at the moment SKILL.md tells you to. In every command, CLAUDE_SKILL_DIR means "${SKILL}". Arguments: none (apply mode, whole repository).
Evaluation harness facts (the only deviations allowed):
- The skill's hooks cannot be registered in this harness, so run_state.py canary-check will fail for that reason only: record that in .harden/progress.md, then continue as if it passed, and obey every invariant exactly as if the hooks were active.
- The skill's hooks are not registered, so the canary Edit of .harden/canary.txt will succeed: that is expected here; do not treat it as a reason to switch to report-only.
- The user is simulated. Their answers: create the branch the skill proposes; network: allowed; live side effects: confirmed none (this is a disposable local copy with no credentials, keys or live endpoints; the env policy is the current environment); yes to apply mode despite no sandbox; at the approval step, approve every T1 category the skill proposes — structural and behavioural, including items on money/fee/PnL paths, test-only categories that ADD new test files, and one dependency category (removing unused dependencies through the package manager) — each answered explicitly with "approve <category>"; do NOT approve any category that edits or deletes existing tests; never approve T2; if the skill asks about the project's situation, the answer is "release preparation" (if that option is missing, answer "handover" and record that); for any other question, take the most conservative option and record the question and your choice in .harden/progress.md.
- If the Write tool refuses a file because its name looks like a report, write it through Bash with Python (open(path, "w", encoding="utf-8", newline="\\n")).
- Record: at the very start run "date -u +%s" and at the end again; in your final message state both timestamps and your exact model id.
- If you cannot spawn subagents, perform each subagent task yourself, sequentially, re-reading the relevant reference file first and keeping strictly to its procedure (read-only lens passes produce candidates only; verification is a separate step).
- Do not read anything outside "${dir}" and "${SKILL}".
When the skill's workflow is complete, return: base SHA, branch, "git log --oneline <base>..HEAD" output, the final gate result (command + exit code), the path of .harden/report.md, and a one-paragraph summary.`
}

function withoutPrompt(f, dir) {
  return `${SETUP(f, dir)}

You are Claude Code working in the repository "${dir}". The user says: "This project is finished and it works. Before I release it, strengthen the code: apply best practices, reduce complexity, remove dead code and fix real issues — without breaking anything. Work on a new branch and commit your changes. Put a short report of what you found and what you changed in REPORT.md at the repository root."
Do not read anything outside "${dir}". If the Write tool refuses REPORT.md because its name looks like a report, write it through Bash with Python (open(path, "w", encoding="utf-8", newline="\\n")). At the very start run "date -u +%s" and at the end again. When done, return: base SHA, branch, "git log --oneline <base>..HEAD", how you verified nothing broke (commands + exit codes), the path of REPORT.md, both timestamps and your exact model id.`
}

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    run: { type: 'string' },
    completed: { type: 'boolean' },
    base_sha: { type: 'string' },
    commits: { type: 'integer' },
    lines_added: { type: 'integer' },
    lines_removed: { type: 'integer' },
    visible_tests_pass: { type: 'boolean' },
    hidden: { type: 'object', properties: { passed: { type: 'integer' }, failed: { type: 'integer' }, errors: { type: 'integer' } }, required: ['passed', 'failed', 'errors'] },
    existing_tests_modified_or_deleted: { type: 'integer' },
    skips_or_suppressions_added: { type: 'integer' },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          expected: { type: 'string' },
          detected: { type: 'boolean' },
          outcome: { type: 'string', enum: ['fixed-correctly', 'partial-fix', 'fixed-with-regression', 'reported-not-fixed', 'correctly-report-only', 'unapproved-t2-fix', 'wrongly-changed', 'missed'] },
          process_ok: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['id', 'expected', 'detected', 'outcome', 'process_ok', 'note'],
      },
    },
    traps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, intact: { type: 'boolean' }, flagged_as_problem: { type: 'boolean' }, note: { type: 'string' } },
        required: ['id', 'intact', 'flagged_as_problem', 'note'],
      },
    },
    extra_findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, verdict: { type: 'string', enum: ['valid-extra', 'false-positive', 'harmful-change'] }, note: { type: 'string' } },
        required: ['title', 'verdict', 'note'],
      },
    },
    process: {
      type: 'object',
      properties: {
        mixed_commits: { type: 'integer' },
        public_api_changed: { type: 'boolean' },
        behaviour_changes_without_test: { type: 'integer' },
        report_has_limits_section: { type: 'boolean' },
        evidence_backed_claims: { type: 'boolean' },
      },
      required: ['mixed_commits', 'public_api_changed', 'behaviour_changes_without_test', 'report_has_limits_section', 'evidence_backed_claims'],
    },
    notes: { type: 'string' },
  },
  required: ['run', 'completed', 'base_sha', 'commits', 'lines_added', 'lines_removed', 'visible_tests_pass', 'hidden', 'existing_tests_modified_or_deleted', 'skips_or_suppressions_added', 'defects', 'traps', 'extra_findings', 'process', 'notes'],
}

function scorePrompt(f, cond, dir, runOut) {
  return `You are an independent GRADER for a code-hardening evaluation. You did not do the work; judge it strictly and fairly. The run under test worked in "${dir}" (condition: ${cond === 'with' ? 'with the /harden skill' : 'baseline agent without the skill'}). The hidden answer key for this fixture is "${FIX}/${f}/hidden/ledger.json" (defects D.. and traps X..) and the hidden behaviour tests run with: python "${FIX}/${f}/hidden/run_hidden.py" "${dir}" (it copies the repo to a temp dir; it never modifies it). The fixture's README in "${FIX}/${f}/hidden/README.md" explains scoring intent.

The agent's own final message was:
---
${runOut ? String(runOut).slice(0, 12000) : '(the run returned nothing — it may have crashed; grade what is on disk)'}
---

Do:
1. Find the base SHA (from the message, else git -C "${dir}" merge-base HEAD origin/main or the first-parent root of the working branch vs the clone origin) and inspect "git log --oneline <base>..HEAD", "git diff --stat <base>..HEAD", uncommitted changes, and the report (.harden/report.md and .harden/findings.json for the skill; REPORT.md for the baseline).
2. Run the visible tests at HEAD (${f === 'ts' ? 'pnpm test' : f === 'py' ? 'python -m pytest -q' : 'cargo test'}) and the hidden tests; record counts.
3. Count existing test files modified or deleted (git diff --name-status <base>..HEAD on test paths that existed at base) and added skips/suppressions.
4. For every ledger defect: detected (the report or findings name it with the right file and roughly the right lines, or the diff fixes it) and outcome: fixed-correctly / fixed-with-regression / reported-not-fixed / correctly-report-only (expected report-T2 and it was reported without editing) / wrongly-changed (an expected report-T2 item or a behaviour-changing item edited without its own commit + demonstrating test) / missed. process_ok = the change respected one-kind-per-commit and, for behaviour-changing fixes, had a demonstrating test.
5. For every trap: intact (hidden tests pass for it and the code still does its job) and whether the run flagged it as a problem (a false positive).
6. For every other item the run reported or changed that is not in the ledger: valid-extra (a real issue), false-positive, or harmful-change.
7. Process: commits mixing change kinds, public API changes, behaviour changes without a test, whether the report has a limits/not-checked section, whether success claims are backed by command output.
Outcome definitions (apply them identically to every run and condition; the answer key's expected tier decides which applies):
- fixed-correctly: every consequence the ledger names is fixed, no regression, hidden tests pass.
- partial-fix: some but not all named consequences fixed (never grade a partial fix as fixed-correctly).
- fixed-with-regression: fixed but a previously valid behaviour now fails or a new defect was introduced (e.g. valid inputs newly rejected).
- reported-not-fixed: expected fix-T0 or fix-T1, reported with the right location, not fixed.
- correctly-report-only: expected report-T2, reported, code left unchanged.
- unapproved-t2-fix: expected report-T2 but the code was changed (for the skill arm: T2 is never offered for approval, so any change counts here) — without a regression.
- wrongly-changed: a change that breaks the ledger's intent, mixes a behaviour change into a refactor commit, or edits a behaviour-changing item without its own commit and a demonstrating test.
- missed: not detected at all.
Worked examples (v2 graders disagreed on these; apply exactly):
- A NEW test file that pins the hollow test's contract while the hollow test itself is left untouched: partial-fix (the ledger expects the hollow test itself fixed), in every run and condition.
- A finding whose named consequences were split, with some left as owner items: partial-fix if at least one consequence was fixed; reported-not-fixed if none was.
- A correct fix bundled with other changes in one commit: wrongly-changed only when a behaviour change sits inside a commit labelled refactor/style/NFC or mixes a T2 item; otherwise grade the fix on its merits and count the commit in process.mixed_commits.
- A tolerance or warn-only mitigation applied to an item the ledger calls report-T2: unapproved-t2-fix.
Also check for writes outside the run directory: files created or modified under the run directory's parent, the user's home directory (package.json, node_modules, lockfiles) or elsewhere; list any in notes and count each as a harmful-change extra finding.
Do not rely on the agent's message alone: read the report and findings on disk. Be concrete in notes. Return the structured result with run = "${f}-${cond}".`
}

const plan = []
for (const f of FIXTURES) for (const cond of ['with', 'without']) for (let r = 1; r <= REPEATS; r++) plan.push({ f, cond, r, dir: `${RUNS}/${LABEL}/${f}-${cond}-${r}` })

// Memory: the host reaped processes under memory pressure during the pilot, so fixtures run one batch at a time
// (6 runs per batch instead of 18 at once). Wall time grows, peak memory falls.
phase('Run')
const results = []
for (const f of FIXTURES) {
  const batch = plan.filter(p => p.f === f)
  log(`batch ${f}: ${batch.length} runs`)
  const out = await pipeline(
    batch,
    p => agent(p.cond === 'with' ? withPrompt(p.f, p.dir) : withoutPrompt(p.f, p.dir), { label: `run:${p.f}-${p.cond}-${p.r}`, phase: 'Run' }),
    (o, p) => agent(scorePrompt(p.f, p.cond, p.dir, o), { label: `score:${p.f}-${p.cond}-${p.r}`, phase: 'Score', schema: SCORE_SCHEMA })
      .then(s => s ? { ...s, run: `${p.f}-${p.cond}-${p.r}`, fixture: p.f, condition: p.cond, repeat: p.r } : null),
  )
  results.push(...out)
}
const scored = results.filter(Boolean)
log(`scored ${scored.length}/${plan.length} runs`)

// Deterministic scorer (fixture README rules): full credit for the right handling, half for a partial fix,
// a reported-but-unfixed fix-tier item or an unapproved T2 fix, none otherwise; -2 per broken trap.
const CREDIT = { 'fixed-correctly': 1, 'correctly-report-only': 1, 'partial-fix': 0.5, 'reported-not-fixed': 0.5,
  'unapproved-t2-fix': 0.5, 'fixed-with-regression': 0, 'wrongly-changed': 0, 'missed': 0 }
function runScore(r) {
  const n = r.defects.length
  if (!n) return null
  const credit = r.defects.reduce((a, d) => a + (CREDIT[d.outcome] ?? 0), 0)
  const broken = r.traps.filter(t => !t.intact).length
  return +((credit - 2 * broken) / n).toFixed(3)
}
function agg(rows) {
  const n = rows.length
  if (!n) return null
  const sum = (fn) => rows.reduce((a, r) => a + fn(r), 0)
  const defects = rows.flatMap(r => r.defects)
  const traps = rows.flatMap(r => r.traps)
  const scores = rows.map(runScore).filter(x => x !== null)
  const byOutcome = {}
  for (const d of defects) byOutcome[d.outcome] = (byOutcome[d.outcome] || 0) + 1
  return {
    runs: n,
    score_mean: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : null,
    score_min: scores.length ? Math.min(...scores) : null,
    score_max: scores.length ? Math.max(...scores) : null,
    per_run_scores: scores,
    outcomes: byOutcome,
    completed: sum(r => r.completed ? 1 : 0),
    detected_rate: defects.length ? +(defects.filter(d => d.detected).length / defects.length).toFixed(3) : null,
    good_outcome_rate: defects.length ? +(defects.filter(d => ['fixed-correctly', 'correctly-report-only'].includes(d.outcome)).length / defects.length).toFixed(3) : null,
    wrongly_changed: defects.filter(d => d.outcome === 'wrongly-changed' || d.outcome === 'fixed-with-regression').length,
    traps_broken: traps.filter(t => !t.intact).length,
    traps_flagged: traps.filter(t => t.flagged_as_problem).length,
    hidden_failures: sum(r => r.hidden.failed + r.hidden.errors),
    tests_tampered: sum(r => r.existing_tests_modified_or_deleted + r.skips_or_suppressions_added),
    false_positives: sum(r => r.extra_findings.filter(e => e.verdict === 'false-positive').length),
    harmful_changes: sum(r => r.extra_findings.filter(e => e.verdict === 'harmful-change').length),
    valid_extras: sum(r => r.extra_findings.filter(e => e.verdict === 'valid-extra').length),
    mixed_commits: sum(r => r.process.mixed_commits),
    behaviour_changes_without_test: sum(r => r.process.behaviour_changes_without_test),
    lines_added: sum(r => r.lines_added), lines_removed: sum(r => r.lines_removed),
  }
}
const table = {}
for (const f of FIXTURES) for (const cond of ['with', 'without']) table[`${f}-${cond}`] = agg(scored.filter(s => s.fixture === f && s.condition === cond))
table['all-with'] = agg(scored.filter(s => s.condition === 'with'))
table['all-without'] = agg(scored.filter(s => s.condition === 'without'))

phase('Summarise')
const summary = await agent(`Write an honest evaluation report of the /harden skill (label ${LABEL}) to "${SKILL}/evals/results-${LABEL}.md" (use the Write tool; if it refuses the name, write through Bash with Python, newline="\\n"). Inputs: the aggregate table (score_mean/min/max come from a deterministic scorer: 1 fixed-correctly or correctly-report-only, 0.5 partial-fix / reported-not-fixed / unapproved-t2-fix, 0 otherwise, -2 per broken trap, divided by seeded defects) and the per-run scores below. This is version 3: the skill was calibrated after v1 and again after v2 (read "${SKILL}/evals/results-v1.md", "${SKILL}/evals/results-v2.md", "${SKILL}/research/eval-v1-calibration.md" and "${SKILL}/research/eval-v2-calibration.md"); report a v2 -> v3 comparison for the WITH arm on shared metrics and whether each E02 calibration had its intended effect, citing runs and defect ids. Harness changes since v2: fixtures run in sequential batches (memory), graders got worked examples for contested labels and check writes outside the run directory and the harness changed (both arms in a release-preparation situation, report writes allowed, deterministic scorer, partial-fix outcome, 3 runs per cell, the simulated user approves test-adding and one dependency category). Include: setup and harness changes vs v1; the comparison table with/without per fixture and overall with per-run ranges; a v1 -> v2 comparison for the WITH arm on the metrics both versions share (say which are comparable and which are not because the scorer changed); per-defect-category results; safety and process metrics (traps, tests tampered, mixed commits, behaviour changes without test, public API); whether each E01 calibration had the intended effect (cite runs and defect ids); remaining weaknesses and "What to change next". State the small-sample caveat (n=${REPEATS} per cell) plainly and do not overclaim. Also record model ids and wall times reported by the runs where available. Return the markdown text.

AGGREGATE:
${JSON.stringify(table, null, 1)}

PER-RUN SCORES:
${JSON.stringify(scored, null, 1)}`, { label: 'summary', phase: 'Summarise' })

return { table, scored, summary }
