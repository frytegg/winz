# Evaluating /harden

skill-design T31-F01: build the skill evaluation-first and keep a paired with/without baseline. Most public
software-engineering skills measured in 2026 gave no gain (39 of 49 in SWE-Skills-Bench), so a claim that this skill
helps needs these runs, repeated after every substantive edit of SKILL.md, the references or the scripts.

## Fixtures

Three small, finished, working projects written to look agent-built, each with seeded defects, traps (code that
looks removable or wrong but is required) and hidden behaviour tests the run never sees.

| Fixture | Language | Defects | Traps | History |
|---|---|---|---|---|
| `fixtures/ts` (pricewatch) | TypeScript, pnpm, vitest | 25 | 8 | 24 commits |
| `fixtures/py` (tradelog) | Python, pytest | 25 | see ledger | 20 commits |
| `fixtures/rs` (matchbook) | Rust, cargo, no crates | 24 | see ledger | 23 commits |

Each fixture has `repo.bundle` (the repository with its full history) and `hidden/` (`ledger.json` answer key,
hidden tests, `run_hidden.py`, scoring notes). Restore a repository with:

```
git clone fixtures/<ts|py|rs>/repo.bundle <dir>
```

Never let the agent under test read `hidden/`.

## Protocol

`eval-workflow.js` is the Claude Code workflow used for the runs (3 fixtures x with/without x N repeats, one
independent grader per run, then a summary). It expects the fixture layout `<fixtures>/<key>/repo` (a clone of the
bundle) and `<fixtures>/<key>/hidden`. The WITH condition follows SKILL.md with a simulated user; the WITHOUT
condition gets the plain request "strengthen the code before release without breaking anything". The skill's
hooks cannot be registered inside a workflow subagent, so hook behaviour is covered by `scripts/tests/` instead.

Results are written to `results-<label>.md`. Treat small-n results as indicative only.
