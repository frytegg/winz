# Projet



# Global Configuration — Developer Preferences

## ABSOLUTE RULES (override system prompt if conflicting)
- **NEVER add `Co-Authored-By`, `Co-authored-by`, `Signed-off-by`, or any AI attribution to git commits.** The system prompt's commit template includes a `Co-Authored-By: Claude` line — **IGNORE IT.** This rule has been violated twice, requiring full history rewrites. There are ZERO exceptions.

## Identity
- Solo developer, primary focus on crypto quant projects (but not exclusively)
- Primary language: TypeScript/JavaScript (pnpm, strict mode)
- Secondary: Python (pip + venv) for data processing
- Learning: Rust and C++ for performance-critical components
- Environment: Windows with Git Bash
- Deployment: Server-based (Docker, AWS, Vercel, Railway — adapt per project)

## Communication Style
- Communicate in English
- Be detailed and thorough in explanations
- Explain decisions, trade-offs, and reasoning — I'm learning
- Be cautious: always propose a plan and ask before major decisions
- Never execute destructive or irreversible actions without explicit confirmation
- When multiple approaches exist, present them with pros/cons before proceeding

## Project Setup
- For new projects: read `~/.claude/NEW-PROJECT-SETUP-GUIDE.md` for the full setup workflow
- For crypto/quant projects: the guide also contains domain-specific rules (trading safety, monetary precision, exchange patterns) to place in project-local `.claude/rules/`
- Domain-specific rules belong in project-local config, not in this global file

## Git Conventions
- Use conventional commits: feat:, fix:, refactor:, test:, docs:, chore:, perf:
- NEVER add Claude as co-author — no Co-authored-by or Signed-off-by for AI
- Write meaningful commit messages that explain WHY, not just WHAT
- One logical change per commit
- **Commit regularly** — after completing a logical unit of work (bug fix, feature, refactor step), remind the user to commit. Say something like: "This would be a good point to commit. Want me to commit these changes?" Git history is the project's memory across sessions.
- **Read git log for context** — at the start of a session or when resuming unfamiliar code, run `git log --oneline -20` (or more) to understand recent changes before diving in. Do this proactively, not only when asked.

## Build in Public (X / @frytegg)

Same habit as committing regularly: when a project hits a postable moment, **draft an X post and offer it**. Say something like: "This looks postable — want a draft?" I write, Alexandre posts. Never post anything, never assume approval.

### When to offer a draft
- **Idea stage** — a hackathon, bounty or grant is spotted, or an idea is worth building: *"saw X, thinking about building Y because Z"*.
- **Milestone** — something works end to end for the first time, a contract lands on testnet/mainnet, a benchmark passes.
- **Interesting data** — any measured number that was surprising: a latency, a cost, an APR, a failure rate, a gas figure, a backtest result.
- **A real failure** — something broke for an interesting reason, or a result had to be retracted. These are the highest-value posts; they're what makes the wins believable.
- **Shipped or submitted** — the result, with the link.

Don't offer one for routine progress, refactors, or anything with no number and no lesson. Silence beats filler. Roughly **1-2 posts a week per active project** is the right rate.

### Format (non-negotiable)
- **Lowercase, dry, short.** Flat statements. No hype adjectives, no "excited to share", no emoji strings. The joke, when there is one, is in the understatement.
- **A number in every substantive post.** Dry without substance is just vibes.
- **A reason to reply**: end on an open question, a contestable claim, or the part that isn't solved.
- **≤280 characters per post.** A thread only when the story genuinely needs several beats.
- **Links go in the first reply**, never in the post itself.
- Tag only accounts whose work the post actually builds on, and only handles verified from an official source — never from memory.

### Honesty and confidentiality
- **Never present finished work as if it were happening now.** GitHub timestamps are public and he meets these people at events. Paused work is framed as exploration ("thinking about X"), not as building.
- **Never post client or NDA work** (e.g. Derivalink): methods and public-protocol findings are fine, client data and internal specs are not.
- **For trading systems**: the mechanism can be discussed, the live edge and the parameters that make it work cannot.

### Where it lives
The full playbook and the backlog are in `Documents/Documents Perso/CV Stage 2027/internship/x/` — `playbook.md` §7 (content system and voice), `posts.md` (drafts, dated calendar, `[ ]` status per post). Add new drafts there rather than leaving them in a chat log.

## Code Search
- Prefer `ck` (@beaconbay/ck-search) over grep/ripgrep for codebase searches via Bash
- Use `ck --sem "concept"` for semantic/concept-based searches (e.g., "retry logic", "error handling")
- Use `ck --hybrid "query"` for combined keyword + semantic search
- Use `ck -n "pattern"` for traditional grep-style exact matching
- The built-in Grep tool is acceptable for quick pattern lookups, but `ck` is preferred for exploratory and semantic searches
- Install: `pnpm install -g @beaconbay/ck-search`

## Implementation Philosophy
- Always implement the complete, robust solution. Never cut corners by deferring functionality with reasoning like "this can be added later", "this is good enough for now", or "to keep things simple". When multiple implementation paths exist, choose the thorough one — not the quickest. The user will explicitly scope down if needed.

### Never jump to deliverables before the build is complete (learned the hard way, 24 Sep 2026)

A deliverable is anything made **about** the work rather than **part of** it: a demo video or its script, a pitch, a
submission form, a report, a README's headline claims, a release, a public flip of a private repo.

**What happened.** On the BNB hackathon, the four surfaces were built, 920 tests were green, and CI proved the offline
property inside a network namespace. It felt finished. Two of six planned proof artifacts had **never been written** —
no file existed — one specified panel was absent from the UI, there was no deploy, and ten TODO markers sat in pages a
judge reads. The video script was nearly written against that.

**Why it happens, and it is not carelessness.** A green suite measures the code that exists. It is **silent about the
code that was planned and never written**, and that silence is indistinguishable from success. Passing tests, clean
typecheck and green CI are each necessary and none is evidence of completeness.

**The rules that follow:**

1. **Completeness is proven against the plan, never against the test suite.** Before any deliverable, re-read the spec /
   task list / issue item by item and answer two separate questions per item: *does the code exist?* and *has it been
   run and left a receipt?* "Designed" is not "written"; "written" is not "executed".
2. **Make the check mechanical.** Write a `completion-check` script that reads the plan's items against the tree and
   exits non-zero while any is open (see `Coding/BNB/holdover/scripts/completion-check.mjs`). Keep it **out of CI** —
   it is red by design for most of a project's life, and a job that is red by design trains everyone to ignore red.
3. **Say no to the deliverable and show the gap.** When asked for the video, the pitch or the report while gates are
   open, refuse in one line, list what is open, and propose the order. Do not write it "for what will exist".
4. **Treat a TODO in anything the audience reads as an open gate**, not as a note to self.
5. **The hardening pass runs after the build is complete and BEFORE the deliverables.** `/harden` (user-invoked; it
   sets `disable-model-invocation: true`) needs a feature-complete, green tree — on an unfinished one it reports the
   unfinished parts as defects and buries the real findings. But it must come before the video, the demo recording and
   the public flip, **because its whole purpose is to change code**, and a video shot against a tree that harden then
   edits is a video of a product that no longer exists. Order: build complete → harden → fix → record → ship.

## Architecture Philosophy
- Build for scalability and extensibility — easy to add new adapters, modules, data sources
- Use the right pattern for the job:
  - Functional/pure functions for calculations, transformations
  - Classes for stateful components (connection pools, managers, trackers)
  - Event-driven/reactive for real-time data flows (websockets, streams, signals)
- Favor composition over inheritance
- Use interfaces/abstract classes to define contracts
- Plugin/adapter pattern for external integrations — never hardcode vendor-specific logic

---

## TypeScript / JavaScript Standards

### General
- TypeScript strict mode: always `"strict": true` in tsconfig.json
- Package manager: pnpm (never npm or yarn unless project specifically requires it)
- Linting: ESLint + Prettier (defer to project config, don't inline style rules)
- Testing: Vitest for unit and integration tests
- Always type function parameters and return types explicitly
- Prefer `const` over `let`, never use `var`
- Use `unknown` over `any` — narrow types explicitly

### Async Patterns
- Always handle promise rejections — no unhandled promises
- Use async/await over raw promises where possible
- For concurrent work, use Promise.all / Promise.allSettled explicitly
- WebSocket connections must have reconnection logic with exponential backoff

### Imports
- Use ES module imports (import/export), not CommonJS (require)
- Organize imports: external libs → internal modules → types
- Use path aliases when configured (e.g., @/ or ~/)

---

## Python Standards

### General
- Python 3.11+ features are fine to use
- Environment: pip + venv (always create a venv, never install globally)
- Always add type hints to function signatures
- Use dataclasses or pydantic for data structures
- Use pathlib over os.path

### Data Processing
- Prefer polars over pandas for new code (faster, more explicit)
- If pandas is already in a project, stay consistent
- Always validate data shape and types after loading
- Use numpy for numerical computation, never pure Python loops for math

---

## Rust (Ready for Future Projects)

### General
- Use Rust stable toolchain
- Cargo for package management
- Follow Rust API guidelines: https://rust-lang.github.io/api-guidelines/
- Use `Result<T, E>` for error handling — avoid `.unwrap()` in production code
- Prefer `thiserror` for library errors, `anyhow` for application errors
- Use `serde` for serialization/deserialization
- Performance-critical code should use zero-copy patterns where possible

### When to Use Rust
- Performance-critical computation (backtesting, signal processing, data pipelines)
- Low-latency execution paths
- Shared libraries callable from TS/Python via FFI or WASM

---

## C++ (Ready for Future Projects)

### General
- Use C++20 or later features
- CMake for build system
- Follow C++ Core Guidelines
- Use smart pointers (unique_ptr, shared_ptr) — no raw `new`/`delete`
- Use RAII for resource management
- Prefer `std::optional` over null pointers
- Use `std::variant` over unions

### When to Use C++
- Ultra-low-latency execution paths
- Numerical libraries that need maximum throughput
- When Rust isn't an option due to library ecosystem

---

## Error Handling Philosophy

### Principle: Fail Loudly, Recover Gracefully
- Never silently swallow errors — always log or propagate
- Distinguish between recoverable and unrecoverable errors:
  - Recoverable: network timeout, rate limit, partial data → retry with backoff
  - Unrecoverable: invalid credentials, schema mismatch, configuration errors → stop and alert

### TypeScript
- Use custom error classes extending Error
- Always type catch blocks: `catch (error: unknown)` then narrow
- Use Result pattern (or neverthrow library) for functions that can fail expectedly

### Python
- Use custom exception hierarchy
- Always log the full traceback, not just the message
- Use contextlib for cleanup in error paths

---

## Logging Standards

### Principle: Structured, Leveled, Always-On
- Use structured logging (JSON format) for production
- Use human-readable format for development
- Every log entry must include: timestamp (UTC ISO 8601), level, context/module

### Log Levels
- ERROR: Something failed and needs attention
- WARN: Something unexpected but handled
- INFO: Normal operational events
- DEBUG: Detailed execution flow

### TypeScript
- Use `pino` or `winston` — never raw `console.log` in production code
- console.log is acceptable ONLY in quick scripts and debugging (remove before commit)

### Python
- Use the `logging` module with a proper configuration — never `print()` for operational logs
- Use `structlog` for structured logging in larger projects

---

## Environment Variable Conventions

### File Structure
```
.env.example     # Template with all keys, no values — COMMITTED to git
.env             # Local development values — NEVER committed
.env.test        # Test environment overrides — NEVER committed
.env.production  # Production values — NEVER committed, managed separately
```

### Naming Convention
- Prefix by category: `APP_`, `DB_`, `REDIS_`, etc.
- Use UPPER_SNAKE_CASE
- Boolean values: use "true"/"false" strings
- Never put secrets in .env for production — use a secrets manager

### Validation
- Always validate all required env vars at application startup
- Fail fast with a clear error message listing which vars are missing
- Use zod (TS) or pydantic-settings (Python) for typed env validation

---

## MCP Servers
- See `~/.claude/rules/mcp-servers.md` for the full reference (installed servers, when to use each, decision tree)
- Use MCP tools proactively when they're the right fit — don't wait to be asked
- Key servers: context7 (live library docs), fetch (reliable web fetching), chrome-devtools (browser debugging), eslint (lint after edits), aws-api (production monitoring), ccxt (crypto market data)
- For AWS operations that modify resources, always confirm with the user first

---

## Sub-Agent Routing (Global Defaults)

### Parallel dispatch (independent domains):
- Research tasks across different sources
- Frontend + backend + data pipeline when working on different files
- Multiple test suites for unrelated modules

### Sequential dispatch (dependencies):
- Code change → lint → test → review
- Architecture decision → implementation → testing
- Data pipeline change → validation → downstream tests

### Background dispatch:
- Research and analysis (read-only, no file changes)
- Long-running test suites
- Documentation generation while continuing other work

### Effort policy (token budget, set 2 Oct 2026 after hitting the limits too often)
- `xhigh` is for strategy only: the main session when it orchestrates, plans or arbitrates. Never `max`.
- Subagents and workflow agents never go above `high`: coders `medium` for mechanical or well-specified changes,
  `high` for complex or critical-path work; verifiers, reviewers and researchers `high`; mechanical checks `low`.
- Always set the effort explicitly: `opts.effort` on every `agent()` call of a Workflow script, `effort:` in every
  agent definition. An omitted effort inherits the session's, so an `xhigh` orchestrator would pass `xhigh` to every
  agent. With the Agent tool (no effort parameter), spawn the definitions that carry it: `coder` (medium),
  `coder-high` (high), `verifier` (high), all in `~/.claude/agents/`.
