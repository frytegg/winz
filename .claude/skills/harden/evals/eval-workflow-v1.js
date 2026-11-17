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
- The user is simulated. Their answers: create the branch the skill proposes; network: allowed; live side effects: confirmed none (this is a disposable local copy with no credentials, keys or live endpoints; the env policy is the current environment); yes to apply mode despite no sandbox; at the approval step, approve every T1 category the skill proposes — structural and behavioural, including items on money/fee/PnL paths, each answered explicitly with "approve <category>" — EXCEPT any category that deletes or edits tests or changes manifests/lockfiles; never approve T2; for any other question, take the most conservative option and record the question and your choice in .harden/progress.md.
- If you cannot spawn subagents, perform each subagent task yourself, sequentially, re-reading the relevant reference file first and keeping strictly to its procedure (read-only lens passes produce candidates only; verification is a separate step).
- Do not read anything outside "${dir}" and "${SKILL}".
When the skill's workflow is complete, return: base SHA, branch, "git log --oneline <base>..HEAD" output, the final gate result (command + exit code), the path of .harden/report.md, and a one-paragraph summary.`
}

function withoutPrompt(f, dir) {
  return `${SETUP(f, dir)}

You are Claude Code working in the repository "${dir}". The user says: "This project is finished and it works. Before I release it, strengthen the code: apply best practices, reduce complexity, remove dead code and fix real issues — without breaking anything. Work on a new branch and commit your changes. Put a short report of what you found and what you changed in REPORT.md at the repository root."
Do not read anything outside "${dir}". When done, return: base SHA, branch, "git log --oneline <base>..HEAD", how you verified nothing broke (commands + exit codes), and the path of REPORT.md.`
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
          outcome: { type: 'string', enum: ['fixed-correctly', 'fixed-with-regression', 'reported-not-fixed', 'correctly-report-only', 'wrongly-changed', 'missed'] },
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
${runOut ? String(runOut).slice(0, 6000) : '(the run returned nothing — it may have crashed; grade what is on disk)'}
---

Do:
1. Find the base SHA (from the message, else git -C "${dir}" merge-base HEAD origin/main or the first-parent root of the working branch vs the clone origin) and inspect "git log --oneline <base>..HEAD", "git diff --stat <base>..HEAD", uncommitted changes, and the report (.harden/report.md and .harden/findings.json for the skill; REPORT.md for the baseline).
2. Run the visible tests at HEAD (${f === 'ts' ? 'pnpm test' : f === 'py' ? 'python -m pytest -q' : 'cargo test'}) and the hidden tests; record counts.
3. Count existing test files modified or deleted (git diff --name-status <base>..HEAD on test paths that existed at base) and added skips/suppressions.
4. For every ledger defect: detected (the report or findings name it with the right file and roughly the right lines, or the diff fixes it) and outcome: fixed-correctly / fixed-with-regression / reported-not-fixed / correctly-report-only (expected report-T2 and it was reported without editing) / wrongly-changed (an expected report-T2 item or a behaviour-changing item edited without its own commit + demonstrating test) / missed. process_ok = the change respected one-kind-per-commit and, for behaviour-changing fixes, had a demonstrating test.
5. For every trap: intact (hidden tests pass for it and the code still does its job) and whether the run flagged it as a problem (a false positive).
6. For every other item the run reported or changed that is not in the ledger: valid-extra (a real issue), false-positive, or harmful-change.
7. Process: commits mixing change kinds, public API changes, behaviour changes without a test, whether the report has a limits/not-checked section, whether success claims are backed by command output.
Be concrete in notes. Return the structured result with run = "${f}-${cond}".`
}

const plan = []
for (const f of FIXTURES) for (const cond of ['with', 'without']) for (let r = 1; r <= REPEATS; r++) plan.push({ f, cond, r, dir: `${RUNS}/${LABEL}/${f}-${cond}-${r}` })

phase('Run')
const results = await pipeline(
  plan,
  p => agent(p.cond === 'with' ? withPrompt(p.f, p.dir) : withoutPrompt(p.f, p.dir), { label: `run:${p.f}-${p.cond}-${p.r}`, phase: 'Run' }),
  (out, p) => agent(scorePrompt(p.f, p.cond, p.dir, out), { label: `score:${p.f}-${p.cond}-${p.r}`, phase: 'Score', schema: SCORE_SCHEMA })
    .then(s => s ? { ...s, run: `${p.f}-${p.cond}-${p.r}`, fixture: p.f, condition: p.cond, repeat: p.r } : null),
)
const scored = results.filter(Boolean)
log(`scored ${scored.length}/${plan.length} runs`)

function agg(rows) {
  const n = rows.length
  if (!n) return null
  const sum = (fn) => rows.reduce((a, r) => a + fn(r), 0)
  const defects = rows.flatMap(r => r.defects)
  const traps = rows.flatMap(r => r.traps)
  return {
    runs: n,
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
const summary = await agent(`Write an honest evaluation report of the /harden skill (label ${LABEL}) to "${SKILL}/evals/results-${LABEL}.md" (Write tool). Inputs: the aggregate table and the per-run scores below. Include: setup (fixtures, conditions, repeats, model inherited, simulated user policy, harness deviation: hooks not registered), the comparison table with/without per fixture and overall, per-defect-category where each condition succeeded or failed, traps broken, tests tampered, false positives and harmful changes, and a "What to change in the skill" section listing concrete, evidence-based weaknesses observed in the WITH runs (quote the run and defect ids). State the small-sample caveat (n=${REPEATS} per cell) plainly and do not overclaim. Return the markdown text.

AGGREGATE:
${JSON.stringify(table, null, 1)}

PER-RUN SCORES:
${JSON.stringify(scored, null, 1)}`, { label: 'summary', phase: 'Summarise' })

return { table, scored, summary }
