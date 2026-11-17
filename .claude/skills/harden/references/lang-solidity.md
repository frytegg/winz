# Language: Solidity

> Purpose: run Solidity tools pinned and aware of the compiler version, keep storage layout, ABI and deployed bytecode frozen, send refactors through the few safe paths, and choose mutation and invariant tools that work.
> Read when: a `.sol` file, `foundry.toml`, `remappings.txt` or a Hardhat config is in scope.

## Contents
- Tooling baseline: SO-01 project toolchain and pinning · SO-02 compiler, pipeline and deployment record · SO-03 analyzer triage · SO-04 compiler and pragma
- Autofix safety: SO-05 forge fmt · SO-06 frozen storage, ABI and bytecode · SO-07 bulk and gas fixes · SO-08 custom errors
- Refactoring engines: SO-09 Nomic LS rename · SO-10 fallback protocol · SO-11 complexity splits and special code
- Dead code and dependencies: SO-12 unused locals · SO-13 unused internal items · SO-14 state variables · SO-15 libraries
- Language traps: SO-16 version-gated arithmetic cleanups · SO-17 unchecked blocks and downcasts · SO-18 division and rounding · SO-19 0.8.31 deprecations
- Test, mutation and fuzz tooling: SO-20 mutation tools · SO-21 run validity and survivor gate · SO-22 golden values and invariants
- Evidence limits

## Tooling baseline

Prefer the project's configured tools, versions and config files. Save every raw output with its version under `.harden/tools/`. Versions below were checked on 2026-09-23.
- Build and test gate: the project's `forge build` and `forge test`, or its Hardhat compile and test tasks.
- Slither 0.11.6 (Jul 2026, 100 detectors). Run it as `uvx --from slither-analyzer==0.11.6 slither ...`. The same package provides `slither-check-upgradeability` and `slither-mutate`.
- Foundry: `forge lint` needs v1.3.0 or later (93 lint ids). `forge test --mutate` needs v1.8.0 or later. v1.8.3 (2026-09-15) ships a `win32_amd64` asset.
- Aderyn v0.6.8 (Jan 2026) runs with no configuration on Foundry and Hardhat projects. No install route was verified, so use a copy at that exact release.
- Nomic Foundation language server `@nomicfoundation/solidity-language-server@0.9.1` (2026-09-16). Start it with an exact-version `pnpm dlx`.
- Gambit v1.0.6 ships prebuilt binaries only for Linux x86-64 and Mac, so build it from source on Windows. mewt v4.0.0 runs only on Linux or macOS, so on Windows it needs WSL2.
- Compiler bug data: `bugs_by_version.json` from the Solidity docs, plus the Solidity blog's security alerts.
- Search scope: contracts sit in `src/` under Foundry but elsewhere under Hardhat (often `contracts/`) and in monorepos, and a search of the wrong directory prints nothing, which reads as "no proxies". So no search below hard-codes a source directory: each runs `rg` over the repository with `-g '*.sol' -g '!lib/**' -g '!node_modules/**'`, and searches that count production contracts only also add `-g '!test/**' -g '!script/**'`, the paths SO-03's Slither run filters.

### SO-01 — Use the project's toolchain first; run extra tools pinned and ephemeral
- **Rule:** Run the project's own forge or Hardhat, `solc_version`, `[lint]` settings and remappings before anything else, and record every tool version. Run tools the project does not declare at exact versions in throwaway environments: `uvx --from <pkg>==<x.y.z> <cmd>`, `pnpm dlx <pkg>@<x.y.z>`, and `cargo install --locked --root .harden/tools/<crate> <crate>@<x.y.z>` for Rust tools built from source (PF-21). Never use `@latest` or mutable tags, and never add an audit-only dependency.
- **Detect:** `forge --version` (v1.3.0 or later for lint, v1.8.0 or later for `--mutate`); `grep -nE "solc_version|via_ir|\[lint\]" foundry.toml`. Check that every tool invocation in the agent's command log carries an exact version, and that `git diff --stat -- package.json foundry.toml remappings.txt` shows no audit-only change.
- **Not when:** Tools that need the project's dependencies, such as forge and Hardhat plugins, run inside the project environment. An exact pin does not protect against a malicious pinned release, so avoid versions published the same day. Pinning also freezes tool bugs, so record the version in the report.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [uv: Using tools](https://docs.astral.sh/uv/guides/tools/) (Astral, 2026); [pnpm dlx](https://pnpm.io/cli/dlx) (pnpm, 2026); [cargo install](https://doc.rust-lang.org/cargo/commands/cargo-install.html) (Cargo Book, 2026); [Foundry v1.3.0](https://github.com/foundry-rs/foundry/releases/tag/v1.3.0) (foundry-rs, 2025); [Foundry v1.8.3](https://github.com/foundry-rs/foundry/releases/tag/v1.8.3) (foundry-rs, 2026) · dossier: polyglot-tooling T25-F03; lang-solidity-go T24-F01; mutation-testing-practice G108-F09; eval-v1-calibration E01-F10

### SO-02 — Record compiler version, pipeline, deployment and proxy status before any rule
- **Rule:** Before applying any rule in this file, record four things for each contract: the solc version the build actually uses, whether via-IR is on, whether the contract is deployed, and whether it sits behind a proxy. The pragma does not select the compiler; the build config does. Gate every version-dependent rule on this record:
  - 0.8.4 introduced custom errors.
  - 0.8.22 generates unchecked loop increments automatically.
  - `require(bool, error)` works via-IR from 0.8.26 and on the legacy pipeline from 0.8.27.
  - 0.8.31 added deprecation warnings.
  - The transient-storage bug affects 0.8.28–0.8.33.
- **Detect:**
  - Compiler: `solc_version` and `via_ir` in `foundry.toml`, or the Hardhat config.
  - Pragmas: `rg --no-filename --no-line-number -o 'pragma solidity[^;]*;' -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' . | sort | uniq -c`.
  - Proxies: `rg -n "Initializable|UUPSUpgradeable|ERC1967|TransparentUpgradeableProxy|delegatecall|__gap|erc7201" -g '*.sol' -g '!lib/**' -g '!node_modules/**' .`, keeping tests and deploy scripts in scope because they show how contracts are deployed.
  - Deployment status: ask the owner (`--interactive`); in autonomous mode it stays unknown (Not when).
- **Not when:** No exception for the record itself. Upgradeability detection covers only common patterns; UUPS, Transparent, Beacon, Diamond and custom delegatecall proxies are not all recognised reliably. Treat unknown status as deployed and upgradeable.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [Layout of a Solidity Source File](https://docs.soliditylang.org/en/latest/layout-of-source-files.html) (Solidity docs, 2026); [Solidity 0.8.22](https://soliditylang.org/blog/2023/10/25/solidity-0.8.22-release-announcement/) (Solidity team, 2023); [Solidity 0.8.27](https://soliditylang.org/blog/2024/09/04/solidity-0.8.27-release-announcement/) (Solidity team, 2024); [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) (OpenZeppelin, 2026) · dossier: lang-solidity-go T24-F02, T24-F06, T24-F07, T24-F08

### SO-03 — Analyzer output is triage input; a clean run is never "secure"
- **Rule:** Run Slither, forge lint and Aderyn as a baseline and merge duplicate findings across tools. Label each finding as a true positive, accepted with a written reason, or a false positive before it becomes a candidate. Never report a clean run as secure, and never apply every suggested fix. List existing inline suppressions that have no adjacent reason as suppression-cleanup candidates.
- **Detect:**
  - Slither: `uvx --from slither-analyzer==0.11.6 slither . --filter-paths "lib/|test/|script/|node_modules/" --exclude-informational > .harden/tools/slither.txt 2>&1`, then a second pass without `--exclude-informational`. Do not use `--triage-mode` in the target tree, because it writes `slither.db.json`.
  - forge lint: `forge lint`, configured in `foundry.toml [lint]`.
  - Aderyn: `aderyn` from the project root.
  - Suppressions: `rg -n "slither-disable|forge-lint: disable" -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .`.
- **Not when:** These numbers bound what the tools can show:
  - Durieux et al. (ICSE 2020, 2019 tool versions): 9 tools tagged 97% of 47,518 contracts as vulnerable, yet all tools combined found only 42% of known vulnerabilities on a 69-contract annotated set.
  - Zhang et al. (ICSE 2023): 79.5% of in-scope exploitable bugs were beyond existing tools. That is 271 of 341 contest bugs and 35 of 44 real exploits, from 2021–2022.
  - Slither's 10.9% false-positive rate comes from Trail of Bits' own 2019 benchmark. No precision data exists for forge lint or Aderyn.
  - Access control, business logic and oracles belong to the web3 lens.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [Empirical Review of Automated Analysis Tools on 47,587 Ethereum Smart Contracts](https://arxiv.org/abs/1910.10601) (Durieux et al., 2020); [Demystifying Exploitable Bugs in Smart Contracts](https://raw.githubusercontent.com/ZhangZhuoSJTU/Web3Bugs/main/papers/icse23.pdf) (Zhang et al., 2023); [Slither Usage wiki](https://github.com/crytic/slither/wiki/Usage) (Crytic, 2026); [Forge lint](https://getfoundry.sh/forge/linting) (Foundry, 2026); [Aderyn README](https://github.com/Cyfrin/aderyn) (Cyfrin, 2026) · dossier: lang-solidity-go T24-F01; web3-audit-practice G207-F01

### SO-04 — Report compiler and pragma problems; never change the compiler in a hardening pass
- **Rule:** Flag two kinds of compiler problem. The first is more than one distinct pragma line. The second is a solc version whose known bugs touch features in use: via-IR, transient storage, memory `bytes` delete, or assembly. Report both kinds and never edit pragmas or `solc_version`, because a compiler change changes bytecode. For audited or certified code, also report the bounded compiler range that produces identical bytecode.
- **Detect:**
  - Run the pragma census from SO-02, plus slither `solc-version` and `pragma`, forge lint `pragma-inconsistent`, and aderyn `unspecific-solidity-pragma`. Check the version and settings against `bugs_by_version.json`.
  - Transient-storage clearing collision (rated high): affects 0.8.28–0.8.33 when via-IR is on, a transient state variable is cleared with `delete`, and a matching persistent clear sits in the same compilation unit. Fixed in 0.8.34; the workaround is to assign zero instead of `delete`.
  - Memory `bytes` element delete on the legacy pipeline: all versions up to 0.8.36. Fixed in 0.8.37 (10 Sep 2026).
  - Via-IR spill-slot collision: 0.7.2–0.8.36. Fixed in 0.8.37.
- **Not when:** Unresolved, so report both positions and never auto-fix:
  - Pragma form: Slither wants a simple range, Aderyn wants a specific version, and EthTrust v3 wants a range that produces identical bytecode, with certification naming a specific range.
  - Compiler freshness: EthTrust says to use the latest stable compiler. Trail of Bits says to compile with a stable release, check warnings with the latest, and not deploy with the newest.

  For a deployed immutable contract, change the compiler only when a redeploy is planned. OpenZeppelin `ReentrancyGuardTransient` clears its lock with `tstore(false)`, not `delete`, so it is outside the transient-bug path.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** A
- **Source:** [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) (EEA, 2025); [Transient Storage Clearing Helper Collision Bug](https://soliditylang.org/blog/2026/02/18/transient-storage-clearing-helper-collision-bug) (Solidity team, 2026); [Solidity 0.8.37](https://soliditylang.org/blog/2026/09/10/solidity-0.8.37-release-announcement) (Solidity team, 2026); [List of Known Bugs](https://docs.soliditylang.org/en/latest/bugs.html) (Solidity docs, 2026); [Development guidelines](https://secure-contracts.com/development-guidelines/guidelines.html) (Trail of Bits, n.d.) · dossier: lang-solidity-go T24-F02, T24-F03

## Autofix safety

### SO-05 — Run forge fmt only where the project already enforces it, on the item's files
- **Rule:** Apply `forge fmt` only when the repo already enforces it, meaning CI runs `forge fmt --check` or the tree already passes it, and only to the files the item touches, in a `style:` commit placed immediately before the item's semantic commit. No source here shows `forge fmt` limited to single files, so the run is T0 only when every file it changes is one the item touches; otherwise a whole-repo `forge fmt` is a T1 item that runs only after the user approves it, as its own `style:` commit. Never use a formatter or a style lint to reorder state variables or rename ABI-visible items.
- **Detect:** `forge fmt --check` exits with an error if any file needs formatting. Run `forge fmt` from a clean tree, and before committing check that `git diff --name-only` lists only the item's files, otherwise `git restore` the changed files and treat the run as the T1 whole-repo item. After formatting, `forge inspect <C> storageLayout` and `forge inspect <C> methodIdentifiers` must be unchanged.
- **Not when:**
  - Use one formatter per repo: if another formatter already owns `.sol` files, keep that one.
  - Style-guide naming and ordering fixes (forge lint info lints, slither `naming-convention`) are not formatter output. They are T1 for internal or private items only.
  - Standards override the style guide, e.g. ERC-20 `name`, `symbol` and `decimals`.
- **Tier:** T0 · **Class:** structural · **Fix risk:** low · **Grade:** A
- **Source:** [Formatting (forge fmt)](https://getfoundry.sh/forge/formatting) (Foundry, 2026); [Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html) (Solidity docs, 2026); [forge inspect](https://getfoundry.sh/forge/reference/forge-inspect) (Foundry, 2026) · dossier: lang-solidity-go T24-F09; autofix-trust G105-F08

### SO-06 — Freeze storage layout, ABI and bytecode of deployed or upgradeable contracts
- **Rule:** Capture each contract's storage layout, method identifiers and ABI before the first edit, and diff them after every commit. In a deployed or upgradeable contract, any of these diffs is a T2 finding and the commit is reverted:
  - a state variable removed, reordered, retyped or inserted before existing ones;
  - a storage variable made `constant` or `immutable`;
  - a public or external function, event, custom error or public state variable renamed.

  Any bytecode change to a deployed immutable contract means a redeploy, so report it.
- **Detect:**
  - Layout and interface: `forge inspect <C> storageLayout`, `methodIdentifiers` and `abi`, saved to `.harden/tools/` before and after.
  - Upgrade compatibility: `uvx --from slither-analyzer==0.11.6 slither-check-upgradeability . <V1> --new-contract-name <V2> [--proxy-name <Proxy>]`, where `missing-variables` is Medium and `order-vars-contracts` is High. The OpenZeppelin upgrades validation is an alternative.
- **Not when:**
  - Renaming an internal or private state variable keeps its stored value (OpenZeppelin), so it is not a layout break. A public one still changes its getter.
  - Adding a new `constant` takes no slot.
  - Code that is undeployed, not upgradeable and has no ABI consumers may change, with owner confirmation.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** high · **Grade:** A
- **Source:** [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) (OpenZeppelin, 2026); [Upgradeability Checks](https://github.com/crytic/slither/wiki/Upgradeability-Checks) (Crytic, 2026); [Contract ABI Specification](https://docs.soliditylang.org/en/latest/abi-spec.html) (Solidity docs, 2026); [forge inspect](https://getfoundry.sh/forge/reference/forge-inspect) (Foundry, 2026) · dossier: lang-solidity-go T24-F09, T24-F10; dead-code-tools T07-F22; agent-refactoring-engines G105-F09

### SO-07 — Never bulk-apply analyzer suggestions; gas lints and assembly are optional and measured
- **Rule:** Send each analyzer suggestion through the rule and tier that covers it; never apply every suggested fix at once. In a hardening pass, never introduce inline assembly, new `unchecked` blocks or other gas golfing. List gas-severity lints (`asm-keccak256`, `custom-errors`, `cache-array-length`, `costly-loop`) as optional items, with `forge snapshot --diff` as evidence. Each existing assembly block needs a justification comment, `("memory-safe")` only if it truly is, and a test against a plain-Solidity reference.
- **Detect:** Collect forge lint gas findings. Run `rg -n "assembly" -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .` and check each hit for a comment and a reference test. Use `forge snapshot --diff` for gas claims.
- **Not when:** The sources conflict. forge lint's `asm-keccak256` and OpenZeppelin's "significant efficiency gains" exception favour assembly. Trail of Bits ("Avoid inline assembly") and EthTrust ([S] No assembly {} unless its overrides are met) oppose it. This skill resolves the conflict by never introducing assembly and reporting the rest. For high-volume protocols gas is a cost users pay, so the owner decides. The evidence is consensus guidance, not measurement.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** C
- **Source:** [Gas optimization book](https://www.rareskills.io/post/gas-optimization) (RareSkills, 2025); [Development guidelines](https://secure-contracts.com/development-guidelines/guidelines.html) (Trail of Bits, n.d.); [OpenZeppelin GUIDELINES.md](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/GUIDELINES.md) (OpenZeppelin, 2026); [EEA EthTrust v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) (EEA, 2025) · dossier: lang-solidity-go T24-F12, T24-F01

### SO-08 — Replacing revert strings with custom errors changes revert data: report it
- **Rule:** Report `require(cond, "…")` and `revert("…")` as candidates for custom errors, named following the EIP-6093 rationale. Do not apply the change in a hardening pass: revert data is an observable interface that frontends, subgraphs and `vm.expectRevert("…")` tests depend on. Aderyn flags empty `require()` and `revert()`; fix those with a custom error, never a string.
- **Detect:**
  - `rg -n 'require\([^;]*,\s*"' -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .` and `rg -n 'revert\(\s*"' -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .`.
  - forge lint `custom-errors` (gas) and aderyn `require-without-string`.
  - Version gates: custom errors need 0.8.4 or later. `require(cond, Err())` needs 0.8.26 or later with via-IR, or 0.8.27 or later on any pipeline. Use 0.8.37 or later if named error arguments go into `require` via-IR, because earlier versions had an argument-order bug (rated very low).
- **Not when:** If code is undeployed and nobody decodes its revert data, the owner may approve the change as a behavioural change with updated expectations. For scale: OpenZeppelin measured a 12.84% average drop in deployment cost across its library when 5.0 switched to custom errors (2023).
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** A
- **Source:** [Custom Errors in Solidity](https://soliditylang.org/blog/2021/04/21/custom-errors/) (Solidity team, 2021); [Solidity 0.8.26](https://soliditylang.org/blog/2024/05/21/solidity-0.8.26-release-announcement/) (Solidity team, 2024); [Solidity 0.8.37](https://soliditylang.org/blog/2026/09/10/solidity-0.8.37-release-announcement) (Solidity team, 2026); [Introducing OpenZeppelin Contracts 5.0](https://www.openzeppelin.com/news/introducing-openzeppelin-contracts-5.0) (OpenZeppelin, 2023) · dossier: lang-solidity-go T24-F06

## Refactoring engines

### SO-09 — Rename only internal and private symbols, through the Nomic LS, then verify
- **Rule:** The Nomic Foundation language server 0.9.1 is the only semantic Solidity engine found. It offers rename, and its code actions only resolve solc warnings and errors. Use its rename and treat the returned WorkspaceEdit as a proposal. Rename only locals and internal or private functions, modifiers and state variables. Never rename public or external functions, events, custom errors or public state variables of a deployed or ABI-consumed contract. A selector is the first four bytes of the Keccak-256 hash of the function's name and parameter types, so a rename changes it.
- **Detect:**
  - Before: `rg -n -w -F OLD > before.txt`, including non-code files. Check visibility with `rg -n -w 'function OLD'`.
  - After, bound calls: `rg -n 'using [A-Za-z_]+ for'`. In the researcher's run, 0.9.1 missed the bound call `items.computeTotal(0)`, and solc then reported a TypeError.
  - After, selector strings: `rg -n 'abi[.]encodeWithSignature\|keccak256[(]\|[.]selector'`. The engine never rewrites these.
  - After, remaining uses: `rg -n -w OLD`, diffed against `before.txt`.
  - Gate: `forge build`, a diff of `forge inspect <C> abi`, then the tests.
- **Not when:** Renaming external functions is fine in undeployed code whose ABI nobody consumes. The missed bound call is one fixture run on 2026-09-23. Later Nomic releases and Slang-based tools were not checked.
- **Tier:** T1 · **Class:** structural · **Fix risk:** high · **Grade:** A
- **Source:** [hardhat-vscode server README](https://github.com/NomicFoundation/hardhat-vscode/blob/main/server/README.md) (Nomic Foundation, 2026); [Contract ABI Specification: Function Selector](https://docs.soliditylang.org/en/latest/abi-spec.html) (Solidity docs, 2026); [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) (OpenZeppelin, 2026) · dossier: agent-refactoring-engines G105-F09, G105-F05

### SO-10 — No engine exists for extract, inline or move: use the fallback protocol
- **Rule:** For a Solidity extract, inline, move or signature change, edit by hand only inside this protocol:
  1. census the old name;
  2. review the moved-block diff;
  3. diff the ABI and storage layout;
  4. compile;
  5. run the tests;
  6. commit one refactoring per commit.
- **Detect:**
  - Census: `rg -n -w -F OLD` before and after the edit, then review each remaining hit. A bare count hid a broken call in the researcher's run.
  - Moved blocks: `git -c color.diff.newMoved=cyan -c color.diff.oldMoved=magenta diff --color=always --color-moved=zebra --color-moved-ws=allow-indentation-change`. Blocks shorter than 20 alphanumeric characters show as plain adds and deletes.
  - ABI and layout: `forge inspect <C> abi` and `storageLayout`, before and after.
  - Gate: `forge build`, then `forge test`.
- **Not when:**
  - No study has evaluated this protocol, and the benchmarks behind its parts are mostly Java.
  - The ABI diff flags every intended public rename, so whitelist the expected changes.
  - Evidence from one agent study: removing or repairing tangled refactorings raised compilability from 19.34% to 38.33% (3,691 patches on Multi-SWE-bench, 2026).
  - Engine studies found Extract, Inline and Move were the most bug-prone types, making up 61% of 518 Java IDE engine bugs (2024).
- **Tier:** T1 · **Class:** structural · **Fix risk:** low · **Grade:** C
- **Source:** [git-diff --color-moved](https://git-scm.com/docs/git-diff) (Git project, 2026); ["Refactoring Runaway"](https://arxiv.org/abs/2605.22526) (Tian et al., 2026); [An Empirical Study of Refactoring Engine Bugs](https://arxiv.org/html/2409.14610v1) (Wang et al., 2024) · dossier: agent-refactoring-engines G105-F16, G105-F02

### SO-11 — Split complex functions inside the same contract; report undocumented special code
- **Rule:** Treat Slither's cyclomatic complexity above 11 as a review trigger, not a target. Split a flagged function only into internal functions of the same contract, never across contracts: a cross-contract split adds external calls and trust boundaries. Report special code that lacks a comment saying why it is needed and how misuse is prevented. Special code covers assembly, delegatecall, CREATE2, `block.timestamp` or `block.number`, oracles, pseudo-randomness, external calls and math that can overflow.
- **Detect:**
  - Complexity: slither and forge lint `cyclomatic-complexity`.
  - Structure: `uvx --from slither-analyzer==0.11.6 slither . --print inheritance-graph,function-summary`.
  - Special code: `rg -n "assembly|delegatecall|create2|new [A-Z][A-Za-z]*\{salt|block\.(timestamp|number)|unchecked" -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .`, then check each hit for a comment or `@dev` NatSpec.
- **Not when:** The threshold of 11 is a tool default with no empirical validation. ConsenSys notes that simple, short-lived contracts favour locality. A split changes bytecode, so a deployed immutable contract only gets a report.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** B
- **Source:** [Security Considerations](https://docs.soliditylang.org/en/latest/security-considerations.html) (Solidity docs, 2026); [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) (Crytic, 2026); [EEA EthTrust v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) (EEA, 2025); [Simplicity vs. Complexity](https://consensysdiligence.github.io/smart-contract-best-practices/general-philosophy/simplicity-vs-complexity/) (ConsenSys Diligence, n.d.) · dossier: lang-solidity-go T24-F11

## Dead code and dependencies

### SO-12 — Remove compiler-warned unused local variables
- **Rule:** After a green baseline, remove local variables that solc reports as "Unused local variable", in one commit for this rule family. If the right-hand side calls a function, keep the call and drop only the binding.
- **Detect:** Compiler warnings from `forge build`, or the project's Hardhat compile.
- **Not when:**
  - An unused success flag from `.call`, `.send`, `transfer` or `transferFrom` is an unchecked-return finding for the web3 lens, not dead code.
  - Unused parameters are not covered here: on an external function, removing one changes the selector.
  - "Unreachable code" warnings are T1 candidates (SO-13), because EthTrust allows unreachable code meant to handle unexpected errors, such as `assert()`.
- **Tier:** T0 · **Class:** structural · **Fix risk:** low · **Grade:** A
- **Source:** [EEA EthTrust v3, [Q] Code Linting](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) (EEA, 2025); [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) (Crytic, 2026) · dossier: lang-solidity-go T24-F08, T24-F04

### SO-13 — Unused internal or private functions, imports, errors and events are T1 after a whole-repo search
- **Rule:** Treat the following as heuristic candidates:
  - Slither `dead-code`;
  - forge lint `unused-import` and `unused-error`;
  - Aderyn `dead-code`, `useless-error` and `unused-import`;
  - compiler "Unreachable code" warnings.

  Remove a candidate only after a whole-repo text search (scripts, tests, deployment files, frontends) and with a green build. Never remove a public or external function as dead code, because it is part of the ABI.
- **Detect:** `uvx --from slither-analyzer==0.11.6 slither . --detect dead-code,unused-state` (unused-state results go to SO-14), the forge lint and aderyn ids above, and `git grep -n -w <name>` across the whole repo.
- **Not when:**
  - Internal functions in abstract bases or libraries may be meant for downstream inheritors.
  - Errors and events in interfaces may be part of a published ABI or an EIP.
  - EthTrust allows `assert()`-guarded defensive code.
  - Unused internal functions do not affect storage.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** A
- **Source:** [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) (Crytic, 2026); [Forge lint](https://getfoundry.sh/forge/linting) (Foundry, 2026); [Aderyn detectors](https://cyfrin.gitbook.io/cyfrin-docs/project-configuration/list-of-supported-detectors) (Cyfrin, 2026); [Automating dead code cleanup](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) (Meta, 2023) · dossier: lang-solidity-go T24-F08; dead-code-tools T07-F22, T07-F13

### SO-14 — Never remove or convert state variables in upgradeable or deployed contracts
- **Rule:** Report every unused state variable and every candidate for `constant` or `immutable`. In a contract that is upgradeable, behind a proxy or deployed, never delete, reorder, retype or convert these variables, and never remove `__gap` arrays. Removing a variable, or making it `constant` (which reserves no slot), shifts every later slot.
- **Detect:**
  - Tool ids: Slither `unused-state`, `constable-states` and `immutable-states`; forge lint `unused-state-variables`, `could-be-constant` and `could-be-immutable`; Aderyn `unused-state-variable`.
  - Proxy check: the grep in SO-02, then `slither-check-upgradeability` or the OpenZeppelin upgrades validation.
  - Layout: `forge inspect <C> storageLayout`, before and after.
- **Not when:**
  - For a non-upgradeable contract that is not yet deployed, dropping unused state or adding `constant` or `immutable` becomes a T1 candidate once the owner confirms that status.
  - OpenZeppelin's plugins flag `immutable` in implementations as unsafe by default, because the value sits in bytecode shared by every proxy.
  - Replacing magic numbers with constants rests on vendor detector advice only (grade B), and small literals such as 0, 1 or 10_000 basis points often read better inline.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** high · **Grade:** A
- **Source:** [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) (OpenZeppelin, 2026); [OpenZeppelin Upgrades FAQ](https://docs.openzeppelin.com/upgrades-plugins/faq) (OpenZeppelin, 2026); [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) (Crytic, 2026) · dossier: lang-solidity-go T24-F08, T24-F10; dead-code-tools T07-F22

### SO-15 — Libraries come through a pinned dependency manager; no vendored copies, no silent major upgrades
- **Rule:** Report audited libraries copied into the project's own source tree instead of consumed through a dependency manager at a pinned version. Also report forge lint `deprecated-oz-function` and `solmate-safe-transfer-lib` hits. Never bump an OpenZeppelin major version in a hardening pass. OpenZeppelin 5.0 moved to ERC-7201 namespaced storage and removed SafeMath and Counters, so an upgradeable system needs a storage-layout check before any major upgrade.
- **Detect:** Pins: `git submodule status` (Foundry `lib/`), or exact versions in `package.json`. Remappings: `cat remappings.txt`. Vendored copies: `rg -l "OpenZeppelin Contracts" -g '*.sol' -g '!lib/**' -g '!node_modules/**' .`. Plus the forge lint ids above.
- **Not when:** Pinning without monitoring freezes known bugs; Trail of Bits says "Always keep external sources up-to-date". ConsenSys describes duplication as common where self-owned, already-deployed contracts are unavailable, and requires any reused code without established trust to be in the security analysis. The evidence is practitioner consensus, not measurement.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** C
- **Source:** [Dependencies](https://scsfg.io/developers/dependencies/) (Smart Contract Security Field Guide, 2026); [Development guidelines](https://secure-contracts.com/development-guidelines/guidelines.html) (Trail of Bits, n.d.); [Introducing OpenZeppelin Contracts 5.0](https://www.openzeppelin.com/news/introducing-openzeppelin-contracts-5.0) (OpenZeppelin, 2023) · dossier: lang-solidity-go T24-F14

## Language traps

### SO-16 — Version-gated arithmetic cleanups: SafeMath on 0.8+, manual loop increments on 0.8.22+
- **Rule:** On solc 0.8 or later, replace plain SafeMath `add`, `sub` and `mul` with operators. OpenZeppelin 4.x SafeMath under `^0.8.0` already relies on the built-in checks and reverts with `Panic(0x11)`, so the behaviour is unchanged. On 0.8.22 or later, remove `unchecked { ++i; }` loop increments only where every compiler condition holds:
  - an `i < …` comparison;
  - operands of the same type;
  - a local built-in integer counter;
  - `i++` or `++i` as the increment;
  - no change to the counter in the loop body.

  Never turn checked code into unchecked code.
- **Detect:** `rg -n "using SafeMath|SafeMath\." -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .`, with the three-argument `errorMessage` overloads listed separately. `rg -n -B2 -A6 "unchecked \{" -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .` finds blocks that only increment a loop counter.
- **Not when:**
  - The SafeMath overloads `sub`, `div` and `mod(a, b, errorMessage)`, and pre-0.8 copies, revert with `Error(string)`. Removing them changes revert data, so they fall under SO-08.
  - Loops that use `<=` get no automatic optimisation. Removing their `unchecked` costs gas but stays safe.
  - Deployed immutable contracts get a report only.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** A
- **Source:** [Checked or Unchecked Arithmetic](https://docs.soliditylang.org/en/latest/control-structures.html) (Solidity docs, 2026); [OpenZeppelin SafeMath.sol v4.9.6](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v4.9.6/contracts/utils/math/SafeMath.sol) (OpenZeppelin, 2023); [Solidity 0.8.22](https://soliditylang.org/blog/2023/10/25/solidity-0.8.22-release-announcement/) (Solidity team, 2023) · dossier: lang-solidity-go T24-F07

### SO-17 — Every unchecked block and every downcast is justified or checked
- **Rule:** Every existing `unchecked` block needs a comment proving that overflow cannot happen; report blocks without one. In value-handling code, route explicit downcasts through OpenZeppelin SafeCast. Explicit conversions always truncate, and bitwise operators are never checked. Division and modulo by zero cannot be put in an `unchecked` block.
- **Detect:** `rg -n "unchecked\s*\{" -g "*.sol"` and `rg -n "\bu?int(8|16|32|40|48|64|96|112|128|160|192|224)\(" -g "*.sol"`; forge lint `unsafe-typecast`. Decurity's Semgrep rule `basic-arithmetic-underflow` exists, but its metadata gives it LOW confidence.
- **Not when:** Adding SafeCast turns a silent wrong value into a revert, which is a behavioural change: give it its own commit and a test showing the revert. A cast that is provably in range needs a comment, not SafeCast. `unchecked` remains appropriate for loops with natural upper bounds and for inputs already sanitised into reasonable ranges (RareSkills).
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** medium · **Grade:** A
- **Source:** [Checked or Unchecked Arithmetic](https://docs.soliditylang.org/en/latest/control-structures.html) (Solidity docs, 2026); [OpenZeppelin SafeCast.sol](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/utils/math/SafeCast.sol) (OpenZeppelin, 2026); [OpenZeppelin GUIDELINES.md](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/GUIDELINES.md) (OpenZeppelin, 2026); [EEA EthTrust v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) (EEA, 2025) · dossier: lang-solidity-go T24-F07; numeric-money-time G103-F09, G103-F10

### SO-18 — Integer division truncates: report operation order and rounding direction, never auto-fix them
- **Rule:** Report divide-before-multiply, and any quotient that can round to zero and is then used as a multiplier, share count or fee. Report every rounding site in value-moving math whose direction is implicit. Recommend a helper with an explicit direction, such as OpenZeppelin `Math.mulDiv(x, y, d, Rounding.Ceil)` with its full-precision intermediate. Pair it with documented rounding invariants and multi-operation invariant tests (SO-22): the direction rule alone is not enough. Treat comments that call rounding impact "minimal", "negligible" or "dust" as findings.
- **Detect:**
  - Order of operations: `uvx --from slither-analyzer==0.11.6 slither . --detect divide-before-multiply`, and forge lint `divide-before-multiply`.
  - Rounding sites: `rg -n "mulDown|divDown|mulDivDown|mulDivFloor|mulWadDown|divWadDown|Rounding\.(Floor|Trunc)|mulDivUp|mulWadUp|divUp" -g "*.sol"`.
  - Excusing comments: `rg -n -i "(round|precision|dust|truncat).{0,80}(minimal|negligible|insignificant|small enough|doesn.t matter)"`.
  - Compound formulas: `roundme analyze`. roundme is early-stage, with one release (0.1.0, 2023).
- **Not when:**
  - Multiplying first can overflow and revert, which becomes a denial of service. Use mulDiv rather than naive reordering; Slither itself adds "unless the limit of a smaller type makes this dangerous".
  - Deliberate truncation, such as bucketing into epochs, is intended.
  - Always favouring the protocol leaves 1-wei dust and breaks exact-output operations.
  - Balancer v2 (3 Nov 2025): `_upscale` always used `mulDown` under a comment calling the impact "minimal". Reported losses range from "more than $100M" (Trail of Bits) to $128.64M (Check Point).
- **Tier:** T2 · **Class:** report-only · **Fix risk:** high · **Grade:** A
- **Source:** [Slither divide-before-multiply](https://github.com/crytic/slither/wiki/Detector-Documentation) (Crytic, 2026); [Solidity Types](https://docs.soliditylang.org/en/latest/types.html) (Solidity docs, 2026); [OpenZeppelin Math.sol](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/utils/math/Math.sol) (OpenZeppelin, 2026); [Balancer hack analysis](https://blog.trailofbits.com/2025/11/07/balancer-hack-analysis-and-guidance-for-the-defi-ecosystem/) (Trail of Bits, 2025); [roundme](https://github.com/crytic/roundme) (Trail of Bits, 2023) · dossier: numeric-money-time G103-F07, G103-F06; lang-solidity-go T24-F07

### SO-19 — Compile once with solc 0.8.31 or later and treat deprecation warnings as findings
- **Rule:** In a throwaway worktree, compile once with solc 0.8.31 or later, and never commit that compiler change. Report every deprecation warning. These are the first batch of features scheduled for removal in 0.9.0:
  - `send` and `transfer` on addresses;
  - virtual modifiers;
  - ABI coder v1;
  - the `/// @solidity memory-safe-assembly` comment, which becomes `assembly ("memory-safe")`;
  - comparisons between contract types.

  Hand any replacement that touches value transfer or authorisation (`transfer` to `call`, `tx.origin`, `selfdestruct`) to the web3 lens.
- **Detect:**
  - Deprecated forms: `rg -n "tx\.origin|selfdestruct|suicide\(|memory-safe-assembly|pragma abicoder v1" -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .`.
  - Address sends: `rg -n "payable\([^)]*\)\.(send|transfer)\(|\.send\(" -g '*.sol' -g '!lib/**' -g '!node_modules/**' -g '!test/**' -g '!script/**' .`. An ERC-20 `.transfer(` is a false positive, so check the receiver's type.
  - Tool ids: slither `tx-origin` and `suicidal`; forge lint `tx-origin`.
- **Not when:** Replacing `transfer` with `call` forwards all gas, which re-opens reentrancy unless Checks-Effects-Interactions or a guard is in place. It also changes behaviour for recipients that used to run out of the 2300-gas stipend. EthTrust allows `tx.origin` under [Q], and `selfdestruct` under [M] when it is protected and documented.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** high · **Grade:** A
- **Source:** [Solidity v0.8.31 release](https://github.com/ethereum/solidity/releases/tag/v0.8.31) (ethereum/solidity, 2025); [Security Considerations](https://docs.soliditylang.org/en/latest/security-considerations.html) (Solidity docs, 2026); [EEA EthTrust v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) (EEA, 2025) · dossier: lang-solidity-go T24-F05

## Test, mutation and fuzz tooling

### SO-20 — Mutation tools: forge test --mutate or slither-mutate; Gambit only as a generator
- **Rule:** Use Foundry's `forge test --mutate <file> --mutation-jobs N` (v1.8.0 or later; an opt-in preview whose flags may change) or slither-mutate 0.11.6. Always run `forge clean` first. Use Gambit v1.0.6 only as a mutant generator behind your own test loop. Do not adopt vertigo-rs: its last push was 2024-09-05 and it has no releases. mewt v4.0.0 supports Solidity but has no Windows build.
- **Detect:**
  - Foundry: `forge clean && forge test --mutate <path/to/C.sol> --mutation-jobs 4`, with the contract's path as the search-scope `rg` found it (not assumed under `src/`).
  - Slither: `forge clean && uvx --from slither-analyzer==0.11.6 slither-mutate <path/to/C.sol> --test-cmd="forge test --match-contract <C>Test"`.
  - Search the log for "Test suite fails with mutations, aborting".
  - Run mewt in WSL2.
- **Not when:**
  - Up to v1.8.3, forge 1.8.x can abort a whole run with a worker stack overflow on large contracts; the fix landed after v1.8.3.
  - Foundry's span skipping and slither-mutate's severity-first order make verdicts depend on order and worker count. Use slither-mutate `--comprehensive` for audit-grade runs.
  - Native-Windows behaviour of both tools is untested.
  - Speed-up measured on one Vault.sol test contract: about 2.5x with 4 workers on 150 mutants (15.3 s vs 37.9 s).
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** B
- **Source:** [feat(forge): mutation testing #13091](https://github.com/foundry-rs/foundry/pull/13091) (foundry-rs, 2026); [Foundry v1.8.0](https://github.com/foundry-rs/foundry/releases/tag/v1.8.0) (foundry-rs, 2026); [Slither-mutate docs](https://github.com/crytic/slither/blob/master/docs/src/tools/Mutator.md) (Trail of Bits, 2026); [Gambit README](https://github.com/Certora/gambit) (Certora, 2025); [mewt README](https://github.com/trailofbits/mewt) (Trail of Bits, 2026) · dossier: mutation-testing-practice G108-F09, G108-F08, G108-F12

### SO-21 — Validate each mutation run; gate on scoped survivors, not a score
- **Rule:** Before triage, confirm three things: the unmutated suite passes, at least one mutant is killed, and timeouts do not cluster. slither-mutate's timeout is twice the initial test run, and a warm cache makes it too short, which produces false negatives. Scope mutants to the lines about to change, before the change. Give every in-scope survivor one disposition instead of gating on a global score:
  - real gap: a killing test, in a separate test-only commit;
  - equivalent: a reason naming whether reachability, infection or propagation (R/I/P) fails;
  - unproductive;
  - weakly tested behaviour, reported to the owner.
- **Detect:**
  - Abort: the log line from SO-20.
  - Timeouts: count Timeout results, and re-run clusters with a lower `--mutation-jobs`.
  - Scope: run per file with `--mutate <file>`.
  - Sampling: flag any score from Gambit `-n` or `--num_mutants` that is used to certify specific lines. Sampling only estimates a score; about 1,000 mutants gave roughly ±2% empirically (158 Java projects, 2015).
- **Not when:** No industrial deployment found computes or gates on mutation adequacy (Kaufman et al., ICSE 2022). The per-survivor gate itself is unvalidated (grade D). The equivalent-mutant rate (median 2.97% of all mutants) and triage time (about 5 minutes per mutant) come from Java studies, not Solidity.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** B
- **Source:** [Slither-mutate docs](https://github.com/crytic/slither/blob/master/docs/src/tools/Mutator.md) (Trail of Bits, 2026); [Prioritizing Mutants to Guide Mutation Testing](https://homes.cs.washington.edu/~rjust/publ/prioritizing_mutants_tcap_icse_2022.pdf) (Kaufman et al., 2022); [How Hard Does Mutation Analysis Have to Be, Anyway?](https://rahul.gopinath.org/resources/issre2015/gopinath2015howhard.pdf) (Gopinath et al., 2015) · dossier: mutation-testing-practice G108-F15, G108-F01, G108-F02, G108-F13, G108-F16

### SO-22 — Pin value-moving math with golden values, then add invariant and fuzz tests
- **Rule:** Before any change to value-moving math, add characterization tests with golden values in a test-only commit. Then add invariant or fuzz tests (Foundry invariant tests, Echidna or Medusa) for multi-operation flows:
  - depositing then redeeming never returns more than was deposited;
  - repeated minimal swaps never decrease the pool invariant;
  - when total supply is zero or tiny, an attacker who deposits 1 wei and donates N cannot make a victim's later deposit of less than N round to zero shares.
- **Detect:** For each vault, pool, fee or accounting contract, a missing invariant or fuzz test is the finding. For Compound v2 forks, run a pinned Semgrep with a local copy of Decurity's `compound-precision-loss` rule.
- **Not when:** Weak invariants give false comfort; Balancer had been audited. Run long fuzz campaigns nightly. Share-price defences on a live vault (virtual shares, a decimals offset, seed deposits) are migrations: report them only.
- **Tier:** T1 · **Class:** structural · **Fix risk:** low · **Grade:** B
- **Source:** [Balancer hack analysis](https://blog.trailofbits.com/2025/11/07/balancer-hack-analysis-and-guidance-for-the-defi-ecosystem/) (Trail of Bits, 2025); [How an Attacker Drained $128M from Balancer](https://research.checkpoint.com/2025/how-an-attacker-drained-128m-from-balancer-through-rounding-error-exploitation/) (Check Point, 2025); [ERC-4626 (OpenZeppelin 5.x docs)](https://docs.openzeppelin.com/contracts/5.x/erc4626) (OpenZeppelin, 2026); [Hundred Finance, REKT 2](https://rekt.news/hundred-rekt2) (rekt.news, 2023); [compound-precision-loss rule](https://raw.githubusercontent.com/Decurity/semgrep-smart-contracts/master/solidity/security/compound-precision-loss.yaml) (Decurity, 2025) · dossier: numeric-money-time G103-F20, G103-F06, G103-F08

## Evidence limits

- **Analyzer precision.** None is published for forge lint (93 lints) or Aderyn. Slither's 10.9% false-positive rate is a 2019 vendor benchmark. The Durieux figures use 2019 tool versions. Web3Bugs is mostly Code4rena contest findings, which may over-represent logic bugs.
- **Tool versions.** All are a snapshot from 2026-09-23: solc 0.8.37, Foundry v1.8.3, Slither 0.11.6, Aderyn v0.6.8, OpenZeppelin 5.7.0, Nomic LS 0.9.1, EthTrust v3 (March 2025). Check them again before each run.
- **Refactoring engines.** The engine results (the missed bound call, the fallback checks) are single fixture runs on one Windows machine. No Solidity engine for extract, inline or move was found, and Slang-based tooling was not checked.
- **Mutation tools.** No Solidity mutation tool was run in the research session. Native-Windows behaviour of `forge test --mutate` and slither-mutate is untested. Equivalent-mutant rates and triage times come from Java studies.
- **Search patterns.** The custom `rg` and `grep` patterns are untested; nobody has measured their precision.
- **Proxy detection.** Detection of upgradeability is unreliable for Diamond and custom delegatecall proxies. Treat any unknown contract as upgradeable.
- **OWASP edition.** The OWASP Smart Contract Top 10 is the 2026 edition on scs.owasp.org, which adds arithmetic rounding (SC07) and proxy and upgradeability (SC10). The owasp.org project page still shows 2025. Cite the edition you use.
- **Thresholds.** The complexity threshold of 11 and the mutation budgets are tool defaults or proposals, not validated values.
- **Not covered here:**
  - Security design (Checks-Effects-Interactions, unchecked external calls, access control, events): the web3 lens.
  - Exact Echidna, Medusa and Foundry invariant configuration.
  - Hardhat-specific commands.
