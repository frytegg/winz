---
description: Scaffold a new project from a description — analyzes requirements, asks clarifying questions, then builds the full codebase architecture
allowed-tools: Task, Read, Write, Edit, Bash, Glob, Grep, WebSearch, AskUserQuestion, EnterPlanMode
---

# New Project: $ARGUMENTS

## Context

Read the setup guide first:
- `~/.claude/NEW-PROJECT-SETUP-GUIDE.md` — contains the full setup workflow, project type templates, and crypto/quant domain rules

## Phase 1: Analyze the Description

Parse the project description:

> **$ARGUMENTS**

From this description, determine:
1. **Project type** — CEX trading bot, DeFi agent, MEV bot, data pipeline, backtesting engine, signal generator, web app, CLI tool, library, or other
2. **Primary language** — TypeScript, Python, Rust, or multi-language
3. **Key integrations** — exchanges (Binance, Bybit...), chains (Ethereum, Solana...), databases, APIs, protocols
4. **Scope** — simple script, medium project, or large platform (see section 12 of the guide)
5. **Domain** — is this a crypto/quant project? If yes, which domain rules from sections 13-18 of the guide apply?

## Phase 2: Ask Clarifying Questions

Based on the analysis, identify any gaps and ask the user using AskUserQuestion. Typical questions:

- **Architecture**: monorepo vs single package? Microservices vs monolith?
- **Exchanges/chains**: which specific ones? Testnet only or mainnet too?
- **Data**: real-time (WebSocket) vs polling vs historical? Storage needs?
- **Deployment target**: Docker, AWS, Vercel, Railway, local only?
- **Strategy specifics**: what signals, what timeframes, what risk parameters?
- **Dependencies**: any specific libraries they want to use or avoid?

Only ask what's genuinely missing — don't ask questions the description already answers. Group related questions together (max 4 at a time). If the description is detailed enough, skip directly to Phase 3.

## Phase 3: Plan the Architecture

Once all information is gathered, use the **architect** subagent to propose:

1. **Directory structure** — full tree with explanations
2. **Core abstractions** — interfaces, base classes, key types
3. **Data flow** — how data moves through the system (diagram if helpful)
4. **Key dependencies** — with version recommendations (reference section 18 of the guide if crypto)
5. **Configuration approach** — env vars, config files, validation strategy

Present the plan and **WAIT for explicit approval** before writing any code.

## Phase 4: Scaffold the Project

Once approved, execute the setup following the guide (sections 2-10):

### 4a. Initialize project
- Create project directory
- Initialize package manager (pnpm init / cargo init / python -m venv)
- Set up TypeScript config (strict: true) if applicable
- Set up linting + formatting config
- Set up testing framework

### 4b. Create the directory structure
- All directories from the approved architecture
- Placeholder files where needed (index.ts, mod.rs, __init__.py)

### 4c. Set up Claude Code local config
Following the guide:
- `CLAUDE.md` in project root (use template from section 3 of the guide)
- `.claude/settings.json` with project-specific permissions (section 5)
- `.claude/agents/` with project-specific subagents (section 6)
- `.claude/commands/` with project-specific slash commands (section 7)
- `.claude/rules/` with domain-specific rules — for crypto/quant projects, adapt the rules from sections 13-16 of the guide based on project type:
  - CEX trading bot → all rules (trading-safety, monetary-values, trading-errors, trading-logging)
  - On-chain / DeFi → skip CEX parts, add on-chain safety
  - Data pipeline / backtesting → skip live trading safety, keep monetary precision
  - Signal / research → monetary precision + logging only
  - Non-crypto project → skip domain rules entirely

### 4d. Environment setup
- `.env.example` with all expected variables (section 9, plus section 17 if crypto)
- `.gitignore` (section 10)

### 4e. Foundation code
- Core interfaces and types from the approved architecture
- Configuration validation (zod / pydantic)
- Logger setup (pino / structlog)
- Entry point / main file with graceful shutdown
- Initial test file with at least one smoke test

### 4f. MCP configuration (if needed)
- `.mcp.json` for project-scoped MCP servers (section 8 of the guide)

## Phase 5: Git Init & Report

1. `git init`
2. Initial commit: `chore: scaffold project structure`
3. Report to the user:
   - What was created (file tree)
   - What each key file does
   - Suggested next steps (what to implement first)
   - Any manual setup needed (API keys, env vars to fill in, services to start)

## Rules
- **ASK before writing code** — the architecture must be approved first
- **Reference the guide** — don't reinvent, follow the established patterns
- **Explain decisions** — every architectural choice should have a reason
- **Don't over-scaffold** — match complexity to project scope (simple script ≠ enterprise platform)
- **Follow all conventions** from the global CLAUDE.md (strict TS, pnpm, conventional commits, etc.)
