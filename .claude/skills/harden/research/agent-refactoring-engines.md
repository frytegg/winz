# Which semantic refactoring engines an AI agent can actually drive headlessly, per language, on Windows and Git Bash
> Code G105 · slug agent-refactoring-engines · verified 2026-09-23 · counts: verified 7 / corrected 10 / downgraded 1 / dropped 0

## How to read this dossier

This dossier mixes two kinds of evidence, and the skill must keep them apart.

- **External sources.** Papers, official docs, source code, issue trackers and forum posts. The fact-checker opened every one of them on 2026-09-23, through WebFetch, the GitHub API (`gh api`), the arXiv export API, the Hacker News Firebase API, the Stack Exchange API and the npm and PyPI registries.
- **The researcher's first-hand runs, marked (E).** On 2026-09-23 the researcher executed the engines on fixture repos of 2–5 files, on Windows 11 with Git Bash. The fact-checker did **not** re-run these fixtures. What was checked is that each tool version exists, carries the stated release date, and has the documented capability or limitation wherever documentation exists. An (E) result is **one observation from one run on one machine**, never a measured rate.

All version and date claims were confirmed against the registries and release pages:

| Tool | Version | Release date / status |
|---|---|---|
| typescript | 7.0.2 | 2026-07-08; npm `latest` |
| typescript | 6.0.2 | 2026-03-23 |
| ts-morph | 28.0.0 | depends on @ts-morph/common ~0.29.0, which bundles TS 6.0.2 |
| rope | 1.14.0 | — |
| basedpyright | 1.40.1 | — |
| python-lsp-server | 1.15.0 | — |
| pylsp-rope | 0.1.17 | — |
| LibCST | 1.9.0 | — |
| griffe | 2.3.0 | — |
| multilspy | 0.0.15 | — |
| gopls | v0.23.0 | 2026-07-07 |
| Go | go1.27.1 | — |
| rust-analyzer | release tag 2026-09-21 | Windows zip published 2026-09-21T04:43Z |
| clangd | 22.1.6 | clangd-windows-22.1.6.zip, 28,198,778 bytes, 2026-05-28 |
| @nomicfoundation/solidity-language-server | 0.9.1 | 2026-09-16 |
| Serena | v1.7.0 | 2026-08-09 |
| mcp-language-server | v0.1.1 | 2025-05-16 |
| cargo-semver-checks | v0.50.0 | 2026-08-01 |

## Summary

(This is the researcher's summary, corrected where the fact-check required it.)

On 2026-09-23 the researcher ran every engine below on Windows 11 Pro 26200 with Git Bash (MINGW64, git 2.51.1), Node 24.13 and Python 3.13.2. Each language had a tiny fixture repo tracked in git, so every edit could be diffed and rebuilt. The client was a stdlib-only Python LSP/MCP client of about 200 lines: Content-Length framing, initialize, didOpen, request, and WorkspaceEdit application.

**Main result.** Every language in scope has at least one engine that performs a semantic **rename** with no IDE and no UI, and none of them needed WSL or Docker. Beyond rename, coverage drops quickly:

- Extract and inline coverage is uneven.
- Change-signature is almost absent: rope has it, and gopls has only parameter-move and parameter-removal primitives.
- In the researcher's runs, every engine produced at least one build-breaking or behaviour-changing result on a fixture of a few files. These fixtures were deliberately adversarial: macros, path aliases, bound library calls and reflection.

So "the LLM chooses, the engine applies" is feasible, but only with mandatory post-checks. The evidence that engines beat LLM-authored edits comes from Java/IntelliJ studies. The evidence that engines themselves ship bugs comes from Java IDE studies. Nothing measures per-operation failure rates for the engines listed here.

Legend: E = executed by the researcher. N = not executed. OK / FAIL = result on the fixture.

**TypeScript.** npm `typescript@latest` is 7.0.2, the native (Go) port, released 2026-07-08.

- It ships only a `tsc` binary and no *stable* JS API. Microsoft's post says "it does not ship with an API"; a new API is expected in 7.1. The 7.0.2 package does export an unstable programmatic API (`./unstable/sync`, `./unstable/async`, `./unstable/ast`, `./unstable/fs`), but it has no refactor, rename or code-action methods (citation audit).
- Its LSP is started with `tsc --lsp --stdio`. The `--lsp` switch is in `tsc/cmd/tsc/main.go`.
- The staging repo `microsoft/typescript-go` was archived on 2026-09-01. The native code now lives in `microsoft/TypeScript` under `tsc/`.
- **Rename:** TS 7 LSP `textDocument/rename` E-OK. ts-morph 28.0.0 `node.rename()` E-OK.
- **File move:** TS 7 LSP `workspace/willRenameFiles` E-OK, and TS 6.0 `LanguageService.getEditsForFileRename` E-OK. Both rewrote the path alias `@util/math` into a relative import. ts-morph `sourceFile.move()` E-FAIL: it left the alias import broken (TS2307). This matches its docs, which promise updates only for relative specifiers, and issue #837, open since 2020.
- **Extract / inline / move-to-file:** only through the TS 6.0 LanguageService (`getApplicableRefactors` / `getEditsForRefactor`), for example via ts-morph's `compilerObject`. The native LS on `main` has quick-fix, organize/sort/remove-unused-imports and fixAll code actions, and no extract or inline refactor.
- **Change signature:** no engine.

**Python.**

- **rope 1.14.0 (library API):** rename, extract method, extract variable, inline, move global, move module and change signature, all E-OK mechanically. All of these are documented in rope's overview. rope ignores "unsure" occurrences unless an `unsure` callback is passed; this is documented in the `get_changes` docstring.
- **basedpyright 1.40.1:** rename E-OK. `willRenameFiles` across directories E-FAIL. This is consistent with issue #1888, which was reported 2026-09-15 with a code-level root cause; the reporter, not the maintainer, says a fix is coming.
- **pylsp 1.15 + pylsp-rope 0.1.17:** extract and inline via codeAction + executeCommand E-OK.
- **LibCST 1.9 `RenameCommand`:** E-FAIL as a symbol rename (usages rewritten, definition not).
- **Bowler:** archived.

**Rust.** rust-analyzer standalone release 2026-09-21.

- Rename, `willRenameFiles`, extract into function/variable and inline variable all E-OK, **except** that tokens inside `macro_rules!` bodies were not rewritten (E0425/E0433). This limitation is not documented in the rust-analyzer book; it is one fixture observation.
- `rust-analyzer ssr` E-OK, with a cold start of about 47 s.
- The rustup proxy fails unless the component is installed.

**Go.** gopls v0.23.0 with go1.27.1.

- `gopls rename -w`, `gopls codeaction -kind=refactor.extract.function|variable -exec -w`, `refactor.inline.call` and `gopls imports -w` all E-OK.
- Passing an 8.3 short path gave a silent partial rename.
- `gopls mcp` exposes `go_rename_symbol` and `go_package_api` among its tools; the tool names are confirmed in `gopls/internal/mcp/mcp.go`.

**C/C++.** clangd 22.1.6 Windows zip.

- Rename E-OK with `--background-index` and `compile_commands.json`.
- With no index, rename silently edited one file. Even with the index it missed a macro body; clangd documents that macro bodies "may not be renamed".
- Extract function/variable via `clangd.applyTweak` E-OK.
- clang-rename was removed in LLVM 20.
- clang-tidy `--fix` and clang-change-namespace: N.

**Solidity.** The Nomic Foundation language server 0.9.1 offers rename, plus code actions that only resolve solc warnings and errors. Its rename missed a `using PriceMath for uint256` bound call (solc TypeError).

**Generic bridges.**

- Serena 1.7 (language-server backend) `rename_symbol` over MCP: E-OK on Windows. Move, inline and "propagate deletions" exist only in the paid JetBrains plugin.
- mcp-language-server v0.1.1 rename: E-FAIL on Windows, because of the invalid `/C:/...` path.
- multilspy 0.0.15: its high-level API is navigation only.
- Claude Code's LSP tool: diagnostics and navigation only, per its docs (tools reference and plugin docs). Rename is not listed.

**Recommended defaults.**

| Language | Default engine and checks |
|---|---|
| TypeScript | TS LSP rename and `willRenameFiles`; TS 6.0 LanguageService for extract and inline |
| Python | rope API with an `unsure` callback, cross-checked against basedpyright references |
| Rust | rust-analyzer LSP, then `cargo check` plus a grep of macro bodies |
| Go | gopls CLI |
| C/C++ | clangd with an index, used only after indexing finishes |
| Solidity | manual edit, then solc/forge and grep; never rename ABI-visible names |

**Fallback protocol (grade C).** In order:

1. A census of the old name, before and after, with ripgrep.
2. `git diff --color-moved` in a block mode (`zebra`/`dimmed-zebra`). Git's own docs say `plain` "is not very useful in a review to determine if a block of code was moved without permutation".
3. An API-surface diff (`.d.ts` diff, `griffe check`, cargo-semver-checks, gopls `go_package_api`).
4. Compile.
5. Tests.
6. One refactoring per commit.

Benchmarks use the components of this protocol as oracles, but the benchmarks are Java-only, except "Refactoring Runaway", which uses the multi-language Multi-SWE-bench. No study evaluates the combined protocol.

## Findings

### G105-F02 — Never treat an engine-applied refactoring as proven safe; after every operation run the full type-check/compile, the tests, and a diff review; weight review effort extract > inline > move > rename
- **Grade:** A · **Verdict:** CORRECTED. The researcher wrote "four independent lines of evidence". Wang et al. 2024 and RETESTER 2025 come from the same group (Wang, Xu, Tan), so this is three research groups: Daniel/Dig/Marinov, Soares/Gheyi, and Wang/Tan/Tsantalis. There is one rounding fix: 242/518 compile errors is 46.7%, not 46.8%. All other numbers check out.
- **Rationale:** Production refactoring engines have shipped transformation bugs continuously for 18 years:
  - **Daniel et al. (ESEC/FSE 2007):** 21 new bugs in Eclipse and 24 in NetBeans, found with generated inputs.
  - **Soares & Gheyi (TSE 2013, CTD 2015 summary):** 153,444 transformations tested across Eclipse, NetBeans and the JastAdd Refactoring Tools, with more than 100 bugs found.
  - **Wang et al. 2024:** 518 engine bugs from Eclipse, IntelliJ IDEA and NetBeans. Symptoms: 242 compile errors (46.7%), 106 crashes, and 66 behaviour changes (12.7%). The most bug-prone refactoring types are Extract (149, 28.76%), Inline (88, 16.99%) and Move (80, 15.44%). "Incorrect transformations" are 165 of the 326 patched bugs (50.6%). The study also found 130 new bugs in current versions.
  - **RETESTER (FORGE 2025):** 18 more new bugs in the latest Eclipse and IntelliJ IDEA.

  The researcher's fixtures show the same pattern outside Java. Each of these produced a broken build or runtime error (E):
  - ts-morph move
  - basedpyright file move
  - LibCST rename
  - rust-analyzer rename
  - clangd rename
  - Nomic LS rename
  - gopls with an 8.3 path
  - rope change-signature
- **Evidence:**
  - [Automated Testing of Refactoring Engines](https://mir.cs.illinois.edu/marinov/publications/DanielETAL07ATRE.pdf) — Daniel, Dig, Garcia, Marinov (ESEC/FSE), 2007 — peer_reviewed — "we have exposed 21 new bugs in Eclipse and 24 new bugs in NetBeans." — verified in the PDF text (abstract and introduction).
  - [Automated Behavioral Testing of Refactoring Engines (CTD 2015 summary)](https://doi.org/10.5753/ctd.2015.9997) — Soares, Gheyi, 2015 (IEEE TSE 2013 original) — peer_reviewed — "testing up to 10 refactorings from Eclipse, NetBeans and the JastAdd Refactoring Tools. Our technique tested 153,444 transformations, and identified more than 100 bugs ... already fixed 35 bugs." — verified via the Crossref abstract; the TSE 2013 record (10.1109/TSE.2012.19) also exists.
  - [An Empirical Study of Refactoring Engine Bugs](https://arxiv.org/html/2409.14610v1) — Wang, Xu, Zhang, Tsantalis, Tan, 2024 — preprint — "Compile Error (242), Crash (106), and Behavior Change (66)"; "Extract (149/28.76%), Inline (88/16.99%), and Move (80/15.44%)"; Incorrect Transformations 165 of 326 patched; "130 new bugs ... Among the 21 bugs we submitted, 10 ... confirmed ... seven ... fixed." — verified in the HTML full text and the arXiv abstract.
  - [Testing Refactoring Engine via Historical Bug Report driven LLM (RETESTER)](https://arxiv.org/abs/2501.09879) — Wang, Xu, Tan (FORGE 2025), 2025 — peer_reviewed — "evaluate RETESTER on ... ECLIPSE, and INTELLIJ IDEA. It successfully revealed 18 new bugs ... seven of them were confirmed ... three were fixed." — verified (arXiv abstract and comment field).
- **Detect:** After every engine operation, run the language gate and then the tests. The tests matter because about 12.7% of the catalogued engine bugs are behaviour changes, which a compiler cannot catch.

  | Language | Gate |
  |---|---|
  | TypeScript | `npx tsc --noEmit -p .` (E) |
  | Python | `basedpyright` or `pyright`, then `python -m pytest` |
  | Rust | `cargo check --all-targets --all-features` (E) |
  | Go | `go build ./... && go vet ./...` (E) |
  | C/C++ | the real build, or at minimum `clangd --check=<each touched TU>` (E) |
  | Solidity | `forge build` or `npx solcjs --bin ...` (E) |
- **Tools:** tsc; basedpyright/pyright; cargo check; go build/vet; clangd --check; solc/forge; the project's test runner.
- **Applies to:** every engine and language in this dossier. The Java evidence carries over as a prior, not as a measured rate.
- **When not to apply / counterpoints:**
  - The studies count bugs; they do not give per-use failure rates. Engines may still be far safer per operation than LLM edits: RefactoringMirror avoided all 22 buggy LLM cases by replaying them through IntelliJ.
  - The researcher's fixtures were adversarial (macros, aliases, bound library calls, reflection), not a random sample.
- **Fix risk:** low

### G105-F08 — C/C++: rename through clangd with a compile_commands.json and `--background-index`, and only after indexing finishes; apply extract through clangd tweaks; do not plan on clang-rename (removed in LLVM 20); build and grep macro bodies after every operation
- **Grade:** A · **Verdict:** VERIFIED. The source check added one fact: clangd's tweak set on `release/22.x` includes ExtractFunction, ExtractVariable, DefineInline, DefineOutline, SwapBinaryOperands, SwapIfBranches, PopulateSwitch and others. There is no generic inline-function or change-signature tweak.
- **Rationale:**
  - **Documented limitations.** clangd's own docs say rename may miss references in templates and macro bodies, does not yet rename comments or disabled preprocessor sections, does not rename related symbols such as overrides, and relies on an up-to-date project index for cross-file renames.
  - **Rename with the index (E).** It edited three files but missed a `#define` body; `clangd --check` then reported `no_member`.
  - **Rename without the index (E).** It silently returned a single-file edit.
  - **Extract to function (E).** It worked, and reformatted an untouched signature line.
  - **clang-rename.** It exists on `release/19.x` and is absent on `release/20.x`, `release/22.x` and `main`. The Clang 20 release notes say "The clang-rename tool has been removed."
  - **Other tools.** clang-change-namespace, clang-move and clang-apply-replacements remain in clang-tools-extra `main`, but they are not in the clangd zip (N).
  - **File limit.** `--rename-file-limit` defaults to 50; the default is confirmed in `ClangdMain.cpp` on `release/22.x`.
- **Evidence:**
  - [clangd Features: Rename](https://clangd.llvm.org/features) — LLVM/clangd, 2026 — official_docs — "References in templates and macro bodies may not be renamed (difficult to analyze in general)"; "References in comments and disabled preprocessor sections are not yet renamed"; "Related symbols (e.g. overriden methods in a class hierarchy) are not yet renamed"; "Renaming symbols used in several files uses the project index, and works best when it is up-to-date" — verified.
  - [Clang 20 Release Notes (release/20.x ReleaseNotes.rst)](https://github.com/llvm/llvm-project/blob/release/20.x/clang/docs/ReleaseNotes.rst) — LLVM, 2025 — official_docs — "The ``clang-rename`` tool has been removed." — verified at line 47; directory presence per branch checked through the GitHub API.
  - [Clang-Tidy documentation](https://clang.llvm.org/extra/clang-tidy/) — LLVM, 2026 (page for 24.0.0git) — official_docs — `--fix`: "Apply suggested fixes. Without -fix-errors clang-tidy will bail out if any compilation errors were found."; `--export-fixes`: "...can be applied to the input source code with clang-apply-replacements." — verified.
  - [clangd release 22.1.6](https://github.com/clangd/clangd/releases/tag/22.1.6) — clangd, 2026 — official_docs — clangd-windows-22.1.6.zip, 28,198,778 bytes, published 2026-05-28 — verified through the GitHub API.
  - [ClangdMain.cpp (release/22.x)](https://github.com/llvm/llvm-project/blob/release/22.x/clang-tools-extra/clangd/tool/ClangdMain.cpp) — LLVM, 2026 — source — `rename-file-limit`: "Limit the number of files to be affected by symbol renaming. 0 means no limit (default=50)" — added by the fact-checker.
- **Detect:**
  - **Before renaming.** Confirm that `compile_commands.json` exists (CMake: `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`). Start clangd with `--background-index` and wait for its `$/progress` end notification.
  - **Check coverage.** Compare the files in the WorkspaceEdit with the files returned by `textDocument/references` (F11).
  - **After the edit.** Run `rg -n '#define' -A5 | rg -w OLD`, then `clangd --check=<file>` on each touched TU (E), then the full build and the tests.
  - **Large renames.** A rename touching more than 50 files fails unless you pass `--rename-file-limit=0`.
- **Tools:** clangd 22.1.6 (E); clangd --check (E); clang-tidy --fix/--export-fixes + clang-apply-replacements (N); clang-change-namespace, clang-move (N).
- **Applies to:** C and C++ projects with a compilation database. Code heavy in macros, templates or conditional compilation needs manual review.
- **When not to apply / counterpoints:**
  - The single-file-rename-without-index result comes from one fixture, and indexing time on a real code base was not measured.
  - Tweaks reformat touched lines according to `.clang-format` (LLVM style when there is none); see F14.
- **Fix risk:** medium

### G105-F07 — Go: drive the gopls CLI directly (no LSP client needed); pass repo-relative or long-form paths, 1-based columns, exclusive range end; gate each operation with `go build ./... && go vet ./...`
- **Grade:** A · **Verdict:** VERIFIED. Additions from the source check:
  - The gopls MCP tool names are confirmed in `gopls/internal/mcp/mcp.go`.
  - The gopls docs also warn that Extract and Inline "are prone to losing comments" (issue 20744).
- **Rationale:** The researcher ran gopls v0.23.0 (released 2026-07-07) with go1.27.1 (E).
  - **Rename.** `gopls rename -w mathx/mathx.go:6:6 CalcTotal` updated the definition, the cross-package calls and the doc comment. It left a string literal alone.
  - **Extract function.** `gopls codeaction -kind=refactor.extract.function -exec -w` produced `newFunction(...)`, and the build passed.
  - **Extract variable, off by one.** `refactor.extract.variable` with the range end one column short silently extracted a smaller, different expression.
  - **Inline call.** `refactor.inline.call` produced an immediately-invoked func literal.
  - **Imports.** `gopls imports -w` removed an unused import.

  The gopls docs rank the operations by rigour: Extract is "considerably less rigorous than the Rename and Inline operations", and for Inline "it's critical that the tool preserve the original behavior". Change-signature exists only as primitives (`moveParam`, `removeUnusedParam`), described as "a primitive building block of more general 'Change signature' operations"; these were not executed. `gopls mcp` runs headless over stdio.
- **Evidence:**
  - [gopls: Code transformation features](https://go.dev/gopls/features/transformation) — Go team, 2026 — official_docs — "gopls' Extract algorithms are considerably less rigorous than the Rename and Inline operations, and we are aware of a number of cases where it falls short."; Inline: "it's critical that the tool preserve the original behavior of the program."; moveParam: "a primitive building block of more general 'Change signature' operations"; caveat: "transformations such as Extract and Inline are prone to losing comments" — verified in the raw doc (golang/tools `gopls/doc/features/transformation.md`).
  - [gopls: Model Context Protocol (MCP) support](https://go.dev/gopls/features/mcp) — Go team, 2026 — official_docs — detached mode "only sees saved files on disk"; attached mode `gopls serve -mcp.listen=localhost:8092` — verified. The page does not list tool names.
  - [gopls/internal/mcp/mcp.go](https://github.com/golang/tools/blob/master/gopls/internal/mcp/mcp.go) — Go team, 2026 — source — tool names include `go_workspace`, `go_package_api`, `go_diagnostics`, `go_rename_symbol`, `go_symbol_references`, `go_search`, `go_file_context`, `go_vulncheck` (and `go_file_metadata`, `go_context`, `go_file_diagnostics`, `go_references`) — added by the fact-checker via the GitHub API.
  - [gopls v0.23.0 module proxy record](https://proxy.golang.org/golang.org/x/tools/gopls/@latest) — Go module proxy — registry — Version v0.23.0, Time 2026-07-07 — verified.
- **Detect:**
  - **Preview the rename.** Run `gopls prepare_rename FILE:L:C`, then `gopls rename -d FILE:L:C New` to see the diff. Apply with `-w` only if the diff touches every expected package; compare it with `gopls references FILE:L:C`.
  - **Gate.** `go build ./... && go vet ./...` (E).
  - **Reflection and JSON.** Run `rg -n 'json:|reflect[.]'` over the touched types.
- **Tools:** gopls v0.23.0 CLI (E); gopls mcp (tool list E); go build/vet (E).
- **Applies to:** Go modules and workspaces. Packages named `main` and `x_test` packages have documented rename restrictions.
- **When not to apply / counterpoints:**
  - The inliner favours safety over readability (func-literal inlining), so a human cleanup pass may be needed.
  - Extract and Inline may drop comments (documented).
  - Path handling on Windows is fragile (F12).
- **Fix risk:** low

### G105-F10 — Do not assume a generic LSP/MCP bridge gives an agent refactorings: as of Sept 2026 rename is the only refactoring bridges broadly expose; for extract, inline and move call the engine's own library/CLI or send raw codeAction/executeCommand requests
- **Grade:** A · **Verdict:** VERIFIED. The fact-checker added the Claude Code tools reference as a stronger source.
- **Rationale:**
  - **Serena** (v1.7.0, 2026-08-09; PyPI `serena-agent` 1.7.0). Its README refactoring table gives the language-server backend rename (symbols only) and no move, no inline and no "propagate deletions"; those exist only in the paid JetBrains plugin. The LS backend does offer symbolic editing: replace symbol body, insert before/after, and safe delete. `rename_symbol` over MCP worked on Windows (E).
  - **mcp-language-server** (v0.1.1, 2025-05-16, "beta software"). It exposes `rename_symbol`; it failed on Windows with an invalid `/C:/...` path (E).
  - **multilspy** (0.0.15). It offers definition, references, completion, hover and documentSymbol, and uses jedi-language-server for Python.
  - **cclsp.** It exposes `rename_symbol` / `rename_symbol_strict` with `dry_run` (N).
  - **gopls MCP.** It exposes `go_rename_symbol`.
  - **Claude Code's LSP tool.** It reports diagnostics after edits and offers navigation only: definition, references, type info, symbols, workspace symbol search, implementations and call hierarchy. Rename and code actions are not listed.
  - **OpenRewrite OSS.** Java, Kotlin and Groovy, plus data formats. JavaScript, C#, Python and other languages need Moderne.
- **Evidence:**
  - [Serena README](https://github.com/oraios/serena) — Oraios AI, 2026 — official_docs — "| rename | yes (only symbols) | yes (symbols, files, directories) |", "| move (symbol, file, directory) | -- | yes |", "| inline | -- | yes |", "| propagate deletions (remove unused code) | -- | yes |"; symbolic-editing table: "safe delete | yes | yes"; "paid plugin; free trial available" — verified in the raw README; release v1.7.0 on 2026-08-09 confirmed via the GitHub API.
  - [mcp-language-server README](https://github.com/isaacphi/mcp-language-server) — isaacphi, 2025 — official_docs — "rename_symbol: Rename a symbol across a project"; "This is beta software." — verified; latest release v0.1.1 on 2025-05-16; the repo is not archived (last push 2026-03-01).
  - [multilspy README](https://github.com/microsoft/multilspy) — Microsoft, 2026 — official_docs — "Please create an issue/PR to add any other LSP request not listed above"; Python via jedi-language-server — verified.
  - [Claude Code docs: Tools reference (LSP tool)](https://code.claude.com/docs/en/tools-reference) — Anthropic, 2026 — official_docs — "After each file edit, it automatically reports type errors and warnings ... Claude can also call it directly to navigate code: Jump to a symbol's definition; Find all references...; Get type information...; List symbols in a file; Search for a symbol by name across the workspace; Find implementations of an interface; Trace call hierarchies" — added by the fact-checker; no rename and no code actions.
  - [Claude Code docs: Discover plugins, Code intelligence](https://code.claude.com/docs/en/discover-plugins) — Anthropic, 2026 — official_docs — "Automatic diagnostics" and "Code navigation"; "In cloud sessions, Claude Code doesn't start plugin language servers"; "language servers like `rust-analyzer` and `pyright` can consume significant memory on large projects" — verified.
  - [cclsp README](https://github.com/ktnyt/cclsp) — ktnyt, 2026 — official_docs — "This tool now applies the rename to all affected files by default."; `dry_run`: "If true, only preview the changes without applying them" — verified.
  - [OpenRewrite: Supported languages](https://docs.openrewrite.org/reference/supported-languages) — Moderne/OpenRewrite, 2026 — official_docs — "As of June 2026, OpenRewrite supports: Java, Kotlin, Groovy"; "Moderne offers support for many more languages ... (such as JavaScript, C#, Python ...)" — verified.
- **Detect:** Inventory what the bridge can actually do before you rely on it.
  - **MCP:** send `tools/list`.
  - **LSP:** read `initialize.capabilities`: `renameProvider`, `codeActionProvider.codeActionKinds`, `executeCommandProvider.commands` and `workspace.fileOperations.willRename`.
  - If `refactor.extract` or `refactor.inline` is absent, do not ask the agent to "use LSP to extract"; route the operation to the library or CLI instead.
- **Tools:** Serena 1.7.0 (E); mcp-language-server v0.1.1 (E, failed on Windows); multilspy 0.0.15 (inspected); Claude Code LSP tool (docs); cclsp (N); gopls mcp (E).
- **Applies to:** any agent harness choosing between MCP/LSP bridges and direct engine calls.
- **When not to apply / counterpoints:**
  - Serena's README testimonials, written by AI agents, praise "cross-file renames, moves". The testimonial says "IDE-backed", so it most likely describes the JetBrains backend. Treat it as marketing (grade D).
  - lsp-skill's author argues that raw LSP endpoints force "10+ round trips" (HN 46549670); not evaluated here.
  - Bridges change quickly; re-check capabilities for each version.
- **Fix risk:** low

### G105-F03 — TypeScript: rename via the TS language server (TS 7: `tsc --lsp --stdio`; TS ≤6: tsserver/LanguageService); file moves via `willRenameFiles` (TS 7) or `getEditsForFileRename` (TS ≤6); extract/inline/move-to-file via the TS 6.0 LanguageService `getEditsForRefactor`; never ts-morph `sourceFile.move()` in a repo with tsconfig `paths` aliases
- **Grade:** A · **Verdict:** CORRECTED. Three fixes: (audit correction: TS 7.0.2 has no *stable* API but does ship an unstable `./unstable/*` programmatic API with no refactor, rename or code-action methods, so "no JS API" is wrong while the rule, extract/inline via the TS 6.0 LanguageService, stands.)
  1. The TS 7.0 post says "it does not ship with an API"; the quoted "does not **yet** ship" was a misquote. It separately says TS 7 "does not yet expose a stable programmatic API", so tools that embed TypeScript "can only currently rely on TypeScript 6.0". The citation audit found that the 7.0.2 `package.json` nevertheless exports `./unstable/sync`, `./unstable/async`, `./unstable/ast` (with factory, visitor and scanner) and `./unstable/fs`; on jsDelivr, `dist/api/sync/api.d.ts` declares classes `API`, `Snapshot`, `Project` and `Program` with `getSemanticDiagnostics` and similar methods. It exposes no refactor, rename or code-action methods, so the practical rule is unchanged.
  2. `microsoft/typescript-go` was **archived on 2026-09-01**. The native code moved to `microsoft/TypeScript` under `tsc/`. The fact-checker re-checked `tsc/internal/ls` on `main`: it has `codeactions_*` quick-fixes, `rename.go`, `file_rename.go` and `organizeimports.go`, and still no extract or inline file. `codeactions.go` only emits quickfix, source.fixAll and organize/sort/remove-unused-imports kinds.
  3. The `--lsp` switch is confirmed in `tsc/cmd/tsc/main.go`.
- **Rationale:** The researcher ran typescript 7.0.2 and ts-morph 28.0.0 (which bundles TS 6.0.2) on a fixture with a `@util/*` path alias.
  - **ts-morph (E).**
    - `rename()` fixed all static references.
    - `sourceFile.move()` left `from '@util/math'`, and tsc reported TS2307. This matches the docs, which cover relative specifiers only, and issue #837.
  - **TS 6.0 LanguageService (E),** obtained via `project.getLanguageService().compilerObject`.
    - `getApplicableRefactors` listed Extract Symbol, Inline variable, Move to a new file, Move to file and others. There is no change-signature refactor.
    - `getEditsForRefactor` for 'Extract Symbol'/'function_scope_1' and for 'Inline variable': OK.
    - `getEditsForFileRename` rewrote the alias import to `../lib/math`.
    - These methods correspond to tsserver protocol commands on the `release-6.0` branch.
  - **TS 7.0.2 native (E).** The LSP advertises `renameProvider`, `willRenameFiles` and the code-action kinds quickfix / organize / sort / remove-unused imports / fixAll. A request filtered to `refactor` returned nothing.
- **Evidence:**
  - [ts-morph docs: Source Files (move)](https://ts-morph.com/details/source-files) — ts-morph (David Sherret), 2026 — official_docs — "this will automatically update the module specifiers of the relative import and export declarations in the moving file and the relative import and export declarations in other files" — verified; the docs do not mention `paths` aliases.
  - [ts-morph issue #837: SourceFile#move: Support updating 'paths' module specifiers](https://github.com/dsherret/ts-morph/issues/837) — dsherret, 2020 — issue_tracker — open, created 2020-07-19 by the maintainer — verified.
  - [ts-morph docs: Renaming](https://ts-morph.com/manipulation/renaming) — ts-morph, 2026 — official_docs — rename "across _all_ files"; renameInComments / renameInStrings "false by default"; `usePrefixAndSuffixText` behaviour — verified.
  - [TypeScript src/server/protocol.ts (release-6.0)](https://github.com/microsoft/TypeScript/blob/release-6.0/src/server/protocol.ts) — Microsoft, 2026 — official_docs — `GetApplicableRefactors = "getApplicableRefactors"`, `GetEditsForRefactor = "getEditsForRefactor"`, `GetMoveToRefactoringFileSuggestions`, `OrganizeImports`, `GetEditsForFileRename`, `Rename` — verified.
  - [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) — Microsoft TypeScript team, 2026-07-08 — official_docs — "While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a new (and different) API"; "TypeScript 7 does not yet expose a stable programmatic API, and so tools (such as Volar) ... can only currently rely on TypeScript 6.0." — quote corrected.
  - [microsoft/TypeScript tsc/internal/ls (main)](https://github.com/microsoft/TypeScript/tree/main/tsc/internal/ls) and [tsc/cmd/tsc/main.go](https://github.com/microsoft/TypeScript/blob/main/tsc/cmd/tsc/main.go) — Microsoft, 2026 — source — file listing without extract/inline; `case "--lsp": return runLSP(args[1:])` — substituted by the fact-checker for the archived typescript-go path.
  - [microsoft/typescript-go README](https://github.com/microsoft/typescript-go) — Microsoft, 2026 (archived 2026-09-01) — official_docs — "Language service (LSP) | in progress | Nearly all features implemented"; "API | not ready" — verified, historical.
  - [npm registry: typescript](https://registry.npmjs.org/typescript) — npm — registry — `latest` 7.0.2 (2026-07-08); `next` 7.1.0-dev.20260923.1; `bin` is `tsc` only; 7.0.2 `exports` include `./unstable/sync`, `./unstable/async`, `./unstable/ast` and `./unstable/fs` — verified; the exports were added by the citation audit.
- **Detect:**
  - **Path aliases.** Run `grep -n '"paths"' tsconfig*.json`. If aliases exist, ban ts-morph `move()`.
  - **After any move.** Run `npx tsc --noEmit -p .` and look for TS2307. Also run `rg -n -F "from '@alias/oldname'"`, and the same with double quotes.
  - **TS version.** `node -p "require('typescript/package.json').version"`. On 7.x there is no stable JS API (only an unstable `typescript/unstable/*` API without refactor methods) and no refactor code actions.
  - **Headless LanguageService script (E).**

    ```js
    const { Project, ts } = require('ts-morph');
    const ls = new Project({ tsConfigFilePath: 'tsconfig.json' }).getLanguageService().compilerObject;
    ls.getEditsForRefactor(abs, fmt, { pos, end }, 'Extract Symbol', 'function_scope_1', { allowTextChangesInNewFiles: true });
    ```

    Pass the project's format settings as `fmt`, and apply the text changes from last to first.
- **Tools:** TypeScript 7.0.2 `tsc --lsp --stdio` (E); TypeScript 6.0.2 LanguageService via ts-morph 28 (E); ts-morph 28.0.0 (E); typescript-language-server (N); jscodeshift 17.4.0 (E); ast-grep 0.45.3 (E).
- **Applies to:** TypeScript and JavaScript repos. ts-morph and the LanguageService apply TS 6.0 semantics even when the repo pins TS 7. The TS 7 blog says 7.0 turns 6.0 deprecations into hard errors; the researcher saw TS5102 on `baseUrl`.
- **When not to apply / counterpoints:**
  - `willRenameFiles` and `getEditsForFileRename` "fix" an alias by converting it to a relative import. That is a style change which lint rules may reject.
  - The default FormatCodeSettings indent with 4 spaces, and extracted functions are named `newFunction` (F14).
  - Monorepos and project references were not tested.
  - TS 7.1 is expected to bring a new API, so re-check when it ships (`next` is already 7.1.0-dev).
- **Fix risk:** medium

### G105-F04 — Python: use the rope library API for rename, module/global moves, extract, inline and change-signature, always with an `unsure` callback whose hits become manual-review items; use basedpyright/pyright for rename and reference counting, not for file/module moves; never use LibCST `RenameCommand` as a symbol rename
- **Grade:** A · **Verdict:** CORRECTED. Two fixes:
  1. The comment "i think i have a fix for this" on basedpyright #1888 was written by the **reporter** (calebgregory, 2026-09-17), not by the maintainer. The maintainer (DetachHead) wrote "huh, i swear i had a test for this but i guess not...". No fix PR is linked, and the issue is open.
  2. The rope `rename.py` docstring was not fetched by the researcher; the fact-checker has now read it on GitHub `master`, and the rope overview docs are added as a source.

  The LibCST-as-rename failure rests on one run only (E).
- **Rationale:**
  - **rope 1.14.0.** Its documentation covers rename (including modules, and "Rename When Unsure"), move of globals, methods and modules, extract method/variable, inline, change signature and restructuring. The docstring says unsure occurrences are ignored when `unsure` is `None`. In the researcher's runs (E):
    - Rename, extract, inline and module move: OK.
    - Move global required the destination file to exist, and rewrote the call to a fully qualified import.
    - ChangeSignature missed a call made through `getattr`, which led to a runtime TypeError.
    - The `unsure` callback surfaced a duck-typed call that would otherwise have been skipped silently.
  - **pylsp-rope** exposes extract, inline and more as code actions (E-OK). Built-in pylsp Rope support is "limited to just renaming and completion".
  - **basedpyright 1.40.1.** Rename: OK. `willRenameFiles` across directories returned no usable edits, and the result was a ModuleNotFoundError (E). Issue #1888 gives the root cause in `RenameUsageFinder`: only the last dotted component is replaced.
  - **LibCST RenameCommand** ("Rename all instances of a local or imported object.") rewrote the importers but not the `def`, giving an ImportError (E).
  - **Bowler** is archived.
- **Evidence:**
  - [rope overview (refactorings)](https://rope.readthedocs.io/en/latest/overview.html) — python-rope, 2026 — official_docs — sections "Rename When Unsure", "Moving Global Classes/Functions/Variables", "Extract Method", "Inline Method Refactoring", "Automatic Default Insertion In Change Signature", "Restructurings"; "Rope will update all the imports" — added by the fact-checker.
  - [rope/refactor/rename.py (get_changes docstring)](https://github.com/python-rope/rope/blob/master/rope/refactor/rename.py) — python-rope, 2026 — official_docs — "`unsure`: decides what to do about unsure occurrences. If `None`, they are ignored."; "`docs`: when `True` rename refactoring will rename occurrences in comments and strings where the name is visible." — now verified on GitHub `master`; PyPI latest is 1.14.0.
  - [pylsp-rope README](https://github.com/python-rope/pylsp-rope) — python-rope, 2025 — official_docs — "python-lsp-server already has basic built-in support for using Rope, but it's currently limited to just renaming and completion." — verified.
  - [basedpyright issue #1888](https://github.com/DetachHead/basedpyright/issues/1888) — calebgregory (reporter), DetachHead (maintainer), 2026 — issue_tracker — "Moving a module to a different directory without changing its filename ... returns no edits."; "I verified this against basedpyright 1.40.1 by sending the requests directly to `basedpyright-langserver`"; maintainer: "huh, i swear i had a test for this but i guess not..." — verified via the GitHub API; the reporter authored the "fix" comment.
  - [LibCST codemods docs](https://libcst.readthedocs.io/en/latest/codemods.html) and [libcst/codemod/commands/rename.py](https://github.com/Instagram/LibCST/blob/main/libcst/codemod/commands/rename.py) — Instagram/Meta, 2026 — official_docs/source — "auto-formatting changed code according to a configured formatter"; `DESCRIPTION: str = "Rename all instances of a local or imported object."`; `--old_name`: "Full dotted name of object to rename" — verified.
  - [Bowler README (archived)](https://github.com/facebookincubator/Bowler) — facebookincubator, 2024 — official_docs — "Bowler 0.x is based on fissix (a fork of lib2to3) which was never intended to be a stable api."; "we recommend looking at LibCST codemods" — verified; archived=true, last push 2024-06-21.
- **Detect:**
  - **Headless rope.** Open the project with `Project('.', ropefolder=None)` so no `.ropeproject` folder is written. Inspect `get_changes().get_description()` before calling `proj.do(changes)`.
  - **Unsure occurrences.** Pass `unsure=lambda occ: log.append((occ.resource.path, occ.offset)) or False`, and abort if the list is not empty.
  - **After a move.** Search the old module path in code and config:

    ```
    rg -n -F 'old.module.path' -g '*.py' -g '*.toml' -g '*.cfg' -g '*.ini' -g '*.yaml'
    ```

    This catches `mock.patch` targets, importlib strings and entry points. Then run basedpyright, then pytest.
  - **LSP cross-check.** Call `textDocument/references` on basedpyright before and after the rename.
- **Tools:** rope 1.14.0 (E); basedpyright 1.40.1 (E); python-lsp-server 1.15.0 + pylsp-rope 0.1.17 (E); LibCST 1.9.0 (E); Bowler (archived).
- **Applies to:** Python 3 projects. rope's inference is weakest on duck-typed, getattr-heavy or framework-magic code (Django, pytest fixtures).
- **When not to apply / counterpoints:**
  - rope's `docs=True` renames matching strings and comments textually, so it can hit unrelated literals.
  - rope's move changes the import style.
  - The basedpyright move bug has no merged fix as of 2026-09-23.
  - Pylance was not tested.
  - LibCST is appropriate for pattern codemods; the problem is only that the name `RenameCommand` misleads.
- **Fix risk:** medium

### G105-F09 — Solidity: the only semantic engine is the Nomic Foundation LS rename (plus solc-fix code actions); treat its output as a proposal, rebuild, grep `using X for` sites; restrict quality renames to internal/private symbols and locals; never rename public/external functions, events or custom errors of deployed contracts; never reorder, retype, insert before, or remove state variables of upgradeable contracts
- **Grade:** A · **Verdict:** CORRECTED. The original rule said "never rename or reorder state variables of upgradeable contracts". OpenZeppelin's upgrade guide lists changing the order or type, inserting a variable before existing ones, and removing a variable as unsafe. It does **not** list renaming: a renamed variable "will keep the same value as before after upgrading". The corrected rule bans reorder, retype, insert-before and remove. Renaming a **public** state variable still changes its auto-generated getter, which is part of the ABI, so it falls under the ABI ban.
- **Rationale:** The researcher ran `@nomicfoundation/solidity-language-server` 0.9.1, published 2026-09-16 (E).
  - **Capabilities.** `renameProvider` true, `codeActionProvider` true, no `executeCommand`.
  - **Missed bound call.** Renaming `PriceMath.computeTotal` updated the definition and the qualified call, but not the bound call `items.computeTotal(0)` enabled by `using PriceMath for uint256`.
  - **Build failure.** solcjs 0.8.28 then reported "Member 'computeTotal' not found or not visible after argument-dependent lookup".
  - **Selector strings.** The engine leaves strings such as `keccak256('computeTotal(uint256,uint256)')` untouched.
  - **ABI.** A function selector is the first four bytes of the Keccak-256 hash of the function's name and parameter types. Renaming an external function therefore changes the ABI and breaks deployed callers.
  - **Code actions.** The README describes them as fixes for solc warnings and errors. There is no extract or inline.
- **Evidence:**
  - [Contract ABI Specification: Function Selector](https://docs.soliditylang.org/en/latest/abi-spec.html) — Solidity team, 2026 — official_docs — "The first four bytes of the call data for a function call specifies the function to be called. It is the first (left, high-order in big-endian) four bytes of the Keccak-256 hash of the signature of the function. The signature is defined as the canonical expression of the basic prototype without data location specifier, i.e. the function name with the parenthesised list of parameter types." — verified (raw `docs/abi-spec.rst`).
  - [hardhat-vscode server README](https://github.com/NomicFoundation/hardhat-vscode/blob/main/server/README.md) — Nomic Foundation, 2026 — official_docs — "Rename the identifier under the cursor and all of its references"; "Code actions, or quickfixes are refactorings suggested to resolve a solc warning or error." — verified; npm `latest` is 0.9.1.
  - [Writing Upgradeable Contracts: Modifying Your Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) — OpenZeppelin, 2026 — official_docs — "you cannot change the order in which the contract state variables are declared, nor their type"; nor "introduce a new variable before existing ones" or "remove an existing variable"; "if you rename a variable, then it will keep the same value as before after upgrading" — added by the fact-checker to correct the state-variable clause.
- **Detect:**
  - **Before a rename.** Check visibility with `rg -n -w 'function OLD'` and look for `public|external`. Also check event and error declarations, and public state variables (their getters). For upgradeable contracts, find them with `rg -n 'Initializable|UUPSUpgradeable|TransparentUpgradeableProxy'`.
  - **After a rename.** Run `rg -n 'using [A-Za-z_]+ for'` and `rg -n -w OLD`. Build with `forge build` or `npx solcjs --bin --base-path . <files>` (E). Diff `forge inspect <Contract> abi` before and after.
  - **Upgradeable contracts.** Use the OpenZeppelin upgrades validation (or diff `forge inspect <Contract> storageLayout`) to confirm the storage layout is unchanged.
- **Tools:** @nomicfoundation/solidity-language-server 0.9.1 (E); solcjs 0.8.28 (E); forge inspect (N); OpenZeppelin upgrades plugins (N).
- **Applies to:** Solidity contracts, especially deployed, verified or upgradeable contracts and libraries attached with `using for`.
- **When not to apply / counterpoints:**
  - For undeployed code whose ABI nobody consumes, renaming external functions is fine.
  - Slang-based tooling or later Nomic releases may add refactorings; not checked.
- **Fix risk:** high

### G105-F01 — Route every rename, move, extract and inline through a deterministic engine: the LLM only chooses the operation and its parameters, the engine produces the edit; an LLM-authored structural edit is acceptable only where no engine supports that operation in that language, and then only under the fallback protocol (F16)
- **Grade:** B · **Verdict:** CORRECTED. The researcher's quote "avoided all of the buggy solutions" is not RefactoringMirror's wording. The verbatim sentence is: "RefactoringMirror ... successfully reapplied most (94.3%=33/35) of the conducted refactorings whereas all bugs introduced by the large language models have been avoided". It is evaluated on the 22 buggy cases. Every other number checks out.
- **Rationale:** Across several studies, LLM-written refactorings are measurably unsafe, and re-executing the same intent through an IDE engine removed the unsafe cases.
  - **RefactoringMirror** (Liu et al., Automated Software Engineering 32(1), 2025): 13 of 176 ChatGPT solutions and 9 of 137 Gemini solutions changed functionality or introduced syntax errors. Replaying the detected refactorings through a tested engine reapplied 33 of 35 and avoided all the bugs.
  - **"Together We Go Further":** up to 76.3% of LLM extract-method suggestions are hallucinations.
  - **EM-Assist** (FSE 2024 demo) filters those suggestions and "uses the IntelliJ IDE to apply" the chosen one.
  - **MM-assist** (ICSME'25): up to 80% of move-method suggestions are hallucinated.
  - **Coordinated rename** (2026): "vanilla" LLMs give incomplete suggestions because they cannot "interact with refactoring tools".

  All of this is Java/IntelliJ work, largely from overlapping groups (Dig, Bryksin, Tsantalis, Liu). F03–F09 show that the same architecture can be reached headlessly for TS, Python, Rust, Go, C++ and Solidity, each with its gaps.
- **Evidence:**
  - [An Empirical Study on the Potential of LLMs in Automated Software Refactoring (RefactoringMirror)](https://arxiv.org/abs/2411.04444) — Bo Liu, Yanjie Jiang, Yuxia Zhang, Nan Niu, Guangjie Li, Hui Liu, 2025 — peer_reviewed (ASE journal 32(1)) — "13 out of the 176 solutions suggested by ChatGPT and 9 out of the 137 solutions suggested by Gemini were unsafe"; HTML: "successfully reapplied most (94.3%=33/35) of the conducted refactorings whereas all bugs introduced by the large language models have been avoided" — verified; quote corrected.
  - [EM-Assist: Safe Automated ExtractMethod Refactoring with LLMs](https://arxiv.org/abs/2405.20551) — Pomian, Bellur, Dilhara, Kurbatova, Bogomolov, Sokolov, Bryksin, Dig (FSE 2024 demo), 2024 — peer_reviewed — recall 53.4% in top-5 vs 39.4% on 1,752 real refactorings; "uses the IntelliJ IDE to apply the user-selected recommendation" — verified (abstract).
  - [Together We Go Further: LLMs and IDE Static Analysis for Extract Method Refactoring](https://arxiv.org/abs/2401.15298) — Pomian et al., 2024 — preprint — "up to 76.3% of the suggestions are hallucinations" — verified (abstract).
  - [Leveraging LLMs, IDEs, and Semantic Embeddings for Automated Move Method Refactoring](https://arxiv.org/abs/2503.20934) — Bellur, Batole, Ullah, Dilhara, Zharov, Bryksin, ..., Tsantalis, Dig (ICSME'25), 2025 — peer_reviewed — "up to 80% of the suggestions are hallucinations" — verified (abstract).
  - [Multi-Agent Coordinated Rename Refactoring](https://arxiv.org/abs/2601.00482) — Bellur, Ullah, Batole, Kansara, ..., Rajan, Dig, 2026 — preprint — "vanilla Large Language Models (LLMs) provide incomplete suggestions due to their limited context and inability to interact with refactoring tools"; "safely executes the changes by invoking the IDE's own trusted refactoring APIs" — verified. The abstract gives no outcome metrics; its formative study covers 609K commits and 205 developers.
- **Detect:**
  - **Engine log.** For each refactoring commit, require a log entry: tool, version, command or LSP request, and the returned edit list.
  - **Violation.** A diff that renames or moves an identifier across more than one file with no matching engine call in the agent transcript. For example, several Edit or `sed` calls replacing the same identifier in different files.
  - **Java.** RefactoringMiner (or ReExtractor) can list the refactorings in a diff so that each one can be matched to an engine call. For other languages this is a manual diff check.
- **Tools:** RefactoringMiner / ReExtractor (Java detection); IntelliJ refactoring engine; rope; TypeScript LanguageService / `tsc --lsp`; rust-analyzer; gopls; clangd.
- **Applies to:** all languages. The value is highest for multi-file renames and moves; per-language commands are in F03–F09.
- **When not to apply / counterpoints:**
  - All the quantitative evidence is Java/IntelliJ, and much of it comes from overlapping groups.
  - Engines have bugs of their own (F02).
  - Practitioners report that agents often skip the LSP rename even when it is installed (HN 48145363, 48370241).
  - For extract, the LLM still chooses the range, and a wrong range yields a different but valid refactoring (F15).
- **Fix risk:** low

### G105-F05 — Before any rename, move or signature change, take a textual census of the old name (code, strings, config, templates); after the engine runs, explain or hand-fix every remaining hit; a passing type-check is not evidence that the rename preserved behaviour
- **Grade:** B · **Verdict:** CORRECTED. The researcher's gopls quote was a WebFetch paraphrase; it is replaced below by the verbatim doc text. The Stack Exchange source dates from 2011.
- **Rationale:** In the researcher's runs, every semantic engine updated static references and left dynamic ones (E):
  - rope, basedpyright and Serena all left `getattr(mathx, 'compute_total')`, which fails at runtime.
  - The TS 7 LSP left `(m as any)['computeTotal']`. tsc reported 0 errors, but the program output changed.
  - gopls left a `'ComputeTotal'` string.
  - rope ChangeSignature left a getattr-invoked call with the old argument order.

  The gopls docs say the same thing explicitly: renaming "may introduce dynamic errors", including through reflection-based packages such as `encoding/json`. rope ignores unsure occurrences by default. ts-morph does not touch strings or comments by default. Behaviour changes are 66 of the 518 engine bugs in Wang et al., and a compiler cannot catch that class.
- **Evidence:**
  - [gopls: Code transformation features (Rename)](https://go.dev/gopls/features/transformation) — Go team, 2026 — official_docs — "Renaming should never introduce a compilation error, but it may introduce dynamic errors. ... Similar problems may arise with packages that use reflection, such as `encoding/json` or `text/template`. There is no substitute for good judgment and testing." — verbatim, verified in the raw doc (quote corrected).
  - [An Empirical Study of Refactoring Engine Bugs](https://arxiv.org/html/2409.14610v1) — Wang, Xu, Zhang, Tsantalis, Tan, 2024 — preprint — Behavior Change is the third most common symptom: 66 of 518 (12.7%) — verified.
  - [What deters developers from using automated refactoring tools? (answer 69717)](https://softwareengineering.stackexchange.com/questions/69714/what-deters-developers-from-using-automated-refactoring-tools) — kabluey, Software Engineering Stack Exchange, 2011-04-19 — practitioner_forum — "Metaprogramming code often can't run through refactoring tools." — verified via the Stack Exchange API. The source is old; treat it as a perennial practitioner observation.
  - [ts-morph docs: Renaming](https://ts-morph.com/manipulation/renaming) — ts-morph, 2026 — official_docs — renameInComments / renameInStrings "false by default" — verified.
  - [rope rename.py docstring](https://github.com/python-rope/rope/blob/master/rope/refactor/rename.py) — python-rope, 2026 — official_docs — "If `None`, they are ignored." — verified.
- **Detect:**
  - **Before the change,** save the census: `rg -n -w -F OLD --hidden -g '!node_modules' -g '!.git' > before.txt`. Include non-code files: yaml, json, toml, HTML templates, SQL, `.env.example` and docs.
  - **Reflective-access sweeps:**

    | Language | Command |
    |---|---|
    | Python | `rg -n 'getattr[(]\|setattr[(]\|hasattr[(]\|__getattr__\|import_module[(]\|mock[.]patch[(]\|globals[(][)]'` |
    | TS/JS | `rg -n "[[]['\"]OLD['\"][]]\|Reflect[.]"` |
    | Go | `rg -n 'reflect[.]\|MethodByName\|json:'` |
    | Rust | `rg -n 'macro_rules!\|serde[(]rename'` |
    | Solidity | `rg -n 'abi[.]encodeWithSignature\|keccak256[(]\|[.]selector'` |

  - **After the engine runs,** re-run the census and diff it against `before.txt`. Every surviving hit must be justified in the PR. Then run the tests.
- **Tools:** ripgrep; the language test runner; rope's `unsure` callback; LSP `textDocument/references`.
- **Applies to:** all languages. It is critical for Python, JS/TS code that uses `any`, Go with reflect or JSON tags, Rust serde and macros, Solidity selectors, and any framework that binds by name (DI containers, ORMs, routers, pytest fixtures, `mock.patch`).
- **When not to apply / counterpoints:**
  - Auto-renaming strings (rope `docs=True`, ts-morph `renameInStrings`) also renames unrelated literals, so keep the census as a manual-review list, not an automatic fix.
  - In statically typed code without reflection the residual risk is small, and the census adds noise.
- **Fix risk:** medium

### G105-F06 — Rust: drive rust-analyzer over LSP (rename, `willRenameFiles`, codeAction + resolve for extract/inline); use `rust-analyzer ssr` only for pattern migrations; after every operation run `cargo check` and grep `macro_rules!` bodies for the old name
- **Grade:** B (was A) · **Verdict:** DOWNGRADED. The documented parts check out: SSR syntax and semantics, the release asset, and the CLI's "no stability guarantees" note. The part the rule depends on, that rename and module rename skip tokens inside `macro_rules!` bodies, is **undocumented**. The rust-analyzer book's Rename section mentions no macro limitation, and a GitHub issue search found no issue describing it. It rests on one fixture run, so it cannot carry an A.
- **Rationale:** The researcher ran rust-analyzer `0.3.3057-standalone` from the 2026-09-21 release zip (E); the rustup proxy failed because the component was not installed.
  - **Capabilities.** Rename with prepare; code-action kinds `refactor.extract`, `refactor.inline` and `refactor.rewrite`; resolve; `willRenameFiles`.
  - **Rename.** It updated the definition, the use and the call, but not a path inside a `macro_rules!` body (E0425).
  - **Module rename.** It missed the same macro-body path (E0433).
  - **Extract into function and inline variable.** Both OK.
  - **SSR.** A cold run took about 47 s and rewrote only call sites: not the definition, not the macro body.
- **Evidence:**
  - [rust-analyzer User Manual: Features](https://rust-analyzer.github.io/book/features.html) — rust-analyzer project, 2026 — official_docs — "The syntax for a structural search replace command is `<search_pattern> ==>> <replace_pattern>`."; "Paths in the search pattern will then match the code if they resolve to the same item, even if they're written differently."; "Within a macro call, a placeholder will match up until whatever token follows the placeholder." — verified; the Rename section has no macro caveat.
  - [rust-analyzer release 2026-09-21](https://github.com/rust-lang/rust-analyzer/releases/tag/2026-09-21) — rust-lang/rust-analyzer, 2026 — official_docs — `rust-analyzer-x86_64-pc-windows-msvc.zip`, published 2026-09-21T04:42:45Z — verified through the GitHub API.
  - [rust-analyzer CLI flags (crates/rust-analyzer/src/cli/flags.rs)](https://github.com/rust-lang/rust-analyzer/blob/master/crates/rust-analyzer/src/cli/flags.rs) — rust-analyzer, 2026 — source — "Subcommands and their flags do not provide any stability guarantees and may be removed or..."; `cmd ssr` and `cmd search` exist — added by the fact-checker.
- **Detect:**
  - **Macro bodies.** `rg -n -U 'macro_rules!' -A40 | rg -w OLD`. Any hit after a rename or move needs a manual fix.
  - **Gate.** `cargo check --all-targets --all-features` (E). Feature-gated code is invisible unless its features are enabled.
  - **SSR dry run.** Run `rust-analyzer search '<pattern>'` before `rust-analyzer ssr '<rule>'`.
  - **Windows install.** `rustup component add rust-analyzer`, or unzip the standalone release.
- **Tools:** rust-analyzer standalone release (E); cargo check (E); ripgrep.
- **Applies to:** Rust crates and workspaces. Macro-heavy code, cfg- or feature-gated code and build.rs need manual verification.
- **When not to apply / counterpoints:**
  - Cold start was about 47 s even on a 2-file crate. Claude Code's docs warn about rust-analyzer's memory use on large projects.
  - The macro miss is one fixture observation.
  - SSR does not change definitions, so it is not a change-signature engine.
  - The CLI subcommands carry no stability guarantee, so pin the version.
- **Fix risk:** medium

### G105-F11 — Before trusting a server-side rename: wait until the server has finished loading/indexing; call `textDocument/references`; abort unless the WorkspaceEdit covers every referencing file plus the declaration (an exported symbol whose rename touches only one file is a failure)
- **Grade:** B · **Verdict:** VERIFIED. Two limits on that verdict: the reference-coverage check is the researcher's own design and has not been validated elsewhere, and the index dependency is documented only for clangd.
- **Rationale:**
  - **clangd without an index (E).** With no background index and only the definition file open, clangd answered rename with a single-file edit and no error. With the index it edited three files. Its docs say cross-file rename "uses the project index, and works best when it is up-to-date".
  - **gopls with an 8.3 path (E).** It edited only the definition file (F12).
  - **Stale state in Claude Code.** A practitioner reports that Claude Code's LSP integration is "constantly working on outdated views / compilation caches", and that their team "binned the LSP plugin".

  Completeness is therefore not guaranteed by the protocol; the client has to check it.
- **Evidence:**
  - [clangd Features: Rename](https://clangd.llvm.org/features) — LLVM/clangd, 2026 — official_docs — "Renaming symbols used in several files uses the project index, and works best when it is up-to-date" — verified.
  - [HN comment on agents and LSP](https://news.ycombinator.com/item?id=48370241) — xnorswap, Hacker News, 2026-06-02 — practitioner_forum — "the current implementation is worse than useless, because any changes aren't reflected fast enough, so it's constantly working on outdated views / compilation caches ... So we binned the LSP plugin" — verified via the HN API.
- **Detect:** In the agent's LSP client:
  1. After `initialize` and `didOpen`, wait for every `$/progress` end notification. Start clangd with `--background-index`.
  2. `refs = textDocument/references(includeDeclaration=true)`.
  3. `edit = textDocument/rename`.
  4. Assert that `set(files(refs))` is a subset of `set(files(edit))` and that `len(edits) >= len(refs)`.

  For gopls, compare `gopls references FILE:L:C` with the file list from `gopls rename -l`. Then run the build gate.
- **Tools:** LSP `textDocument/references`; gopls references / rename -l (E); clangd --background-index (E).
- **Applies to:** all LSP-based renames: clangd, rust-analyzer, the TS LSP, basedpyright, the Nomic LS, Serena and mcp-language-server.
- **When not to apply / counterpoints:**
  - References and rename share the same index, so a stale index can make both incomplete in the same way. The build gate and the census (F05) are still needed.
  - Full indexing of a large C++ or Rust repo can take minutes.
- **Fix risk:** low

### G105-F17 — Give rename first priority for engine coverage in the skill and forbid LLM-authored multi-file renames wherever a rename engine exists: rename types are among the most frequent agent refactorings, incorrect renaming is a leading cause of LLM refactoring failures, and rename is the one operation every in-scope language can execute headlessly
- **Grade:** B · **Verdict:** CORRECTED. The researcher made two overclaims:
  1. "Renames are the **most** frequent refactorings agents perform." In Agentic Refactoring (Java, AIDev), the top single type is Change Variable Type (11.8%); Rename Parameter (10.4%) and Rename Variable (8.5%) come next. Renames lead only when these two are summed (18.9%). In "How do Agents Refactor" (MSR 2026, Java), the five most common agent refactoring types are annotation-related.
  2. Rename is "the **most** common LLM failure in refactoring studies." In RefactorAssist (Java), "incorrect or inconsistent renaming" (15.3%) is **second**, after context misunderstanding/hallucination (24.3%).

  The rule survives in the weaker form stated in the title above.
- **Rationale:**
  - **Agent refactorings.** Agentic Refactoring studied 15,451 refactorings across 12,256 agent PRs and 14,988 commits, all Java. Two rename types are in its top three.
  - **LLM failures.** RefactorAssist, on 10 Java projects, found renaming errors to be the second-largest cause of test failures.
  - **Practitioners** say agents miss references on rename and reach for find/replace.
  - **Engine coverage.** Every engine in F03–F09 offers rename, which is documented for each: TS protocol `Rename`, rope, gopls, rust-analyzer, clangd and Nomic LS.
- **Evidence:**
  - [Agentic Refactoring: An Empirical Study of AI Coding Agents](https://arxiv.org/abs/2511.04824) — Horikawa, Li, Kashiwa, Adams, Iida, Hassan, 2025 — preprint — "analyzing 15,451 refactoring instances across 12,256 pull requests and 14,988 commits derived from the AIDev dataset"; "Change Variable Type (11.8%), Rename Parameter (10.4%), and Rename Variable (8.5%)"; Java only — verified (arXiv API abstract).
  - [RefactorAssist: Agentic Refinement for Reliable Code Refactoring](https://arxiv.org/abs/2608.00924) — Cordeiro, Noei, Zou, 2026 — preprint — "context misunderstanding/hallucination (24.3%), incorrect or inconsistent renaming (15.3%), ..." on "10 open-source Java projects" — verified; the ranking is corrected.
  - [How do Agents Refactor: An Empirical Study](https://arxiv.org/abs/2601.20160) — Ottenhof, Penner, Hindle, Lutellier (MSR 2026), 2026 — peer_reviewed — "agent refactorings are dominated by annotation changes (the 5 most common refactoring types done by agents are annotation related)"; Java, 86 projects per group — located and verified by the fact-checker; the researcher had cited it without a URL.
  - [HN comment (python-rope-refactor skill)](https://news.ycombinator.com/item?id=46356938) — brianyu8, Hacker News, 2025-12-22 — practitioner_forum — "it kept missing references when I asked it to rename or move symbols. So I built a skill that teaches it to use rope for mechanical python codebase refactors" — verified (thread: "Claude Code gets native LSP support"; the poster used Codex).
  - [HN comment](https://news.ycombinator.com/item?id=48370241) — xnorswap, Hacker News, 2026-06-02 — practitioner_forum — "It hurts my soul to see it reach for find/replace to rename a class, complete with mistakes made in complex solutions where you might have name clashes in different namespaces." — verified.
- **Detect:**
  - **Transcript.** Flag a rename done with several Edit or replace calls on the same identifier across two or more files, when the language has an engine (F03–F09).
  - **Diff.** Flag a whole-word identifier change spanning more than one file with no engine log.
- **Tools:** ripgrep; agent transcript review.
- **Applies to:** all languages in scope.
- **When not to apply / counterpoints:**
  - All the quantitative data is Java-only.
  - "Rename Variable" includes local renames that a single-file edit handles safely.
  - The refactoring mix differs across datasets (MSR 2026: annotation changes dominate).
- **Fix risk:** low

### G105-F18 — Treat file/module moves as the least reliable engine operation: use only an engine whose move you have verified on a fixture mirroring the repo's import style (path aliases, barrel/`__init__` re-exports, macro paths, string module paths), and search strings and config for the old module path before building
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Move results from the researcher's runs (E):
  - **ts-morph move:** left the path alias; TS2307. This matches its docs and issue #837.
  - **basedpyright `willRenameFiles`:** returned no edits for a directory move, followed by a ModuleNotFoundError (issue #1888). The same issue documents that a combined move and rename gives *wrong* edits.
  - **rust-analyzer module rename:** missed a macro-body path; E0433.
  - **rope move_global:** correct, but switched callers to fully qualified imports.
  - **Correct results:** TS 7 `willRenameFiles` and TS 6 `getEditsForFileRename` (both converted the alias to a relative import), and rope MoveModule.

  Wang et al. rank Move third among bug-prone refactoring types (80 bugs, 15.44%). Serena's LS backend has no move at all.
- **Evidence:**
  - [An Empirical Study of Refactoring Engine Bugs](https://arxiv.org/html/2409.14610v1) — Wang et al., 2024 — preprint — "Extract (149/28.76%), Inline (88/16.99%), and Move (80/15.44%) are the top three most error-prone refactoring types." — verified.
  - [basedpyright issue #1888](https://github.com/DetachHead/basedpyright/issues/1888) — calebgregory, 2026 — issue_tracker — "Moving and renaming in one step, e.g. `pkg/oldpkg/a.py` -> `pkg/b.py`, rewrites `from pkg.oldpkg import a` to `from pkg.oldpkg import b`, which points at a module that no longer exists. This case returns wrong edits rather than none." — verified in the issue body.
  - [ts-morph issue #837](https://github.com/dsherret/ts-morph/issues/837) — dsherret, 2020 — issue_tracker — "SourceFile#move: Support updating 'paths' module specifiers", open — verified.
  - [Serena README](https://github.com/oraios/serena) — Oraios AI, 2026 — official_docs — "| move (symbol, file, directory) | -- | yes |" — verified.
- **Detect:** After any move:
  - Run `rg -n -F 'old/module/path'` and `rg -n -F 'old.module.path'` across `*.ts`, `*.py`, `*.rs`, `*.json`, `*.toml`, `*.yaml` and `*.cfg`. In particular, check tsconfig `paths`, package.json `exports`, jest `moduleNameMapper`, pyproject entry points, `mock.patch` strings, Cargo features and `mod` paths inside `macro_rules!`.
  - Then run the full build and the tests.
  - Run `git diff --color-moved=zebra` to confirm the moved body is unchanged (F16).
- **Tools:** TS 7 willRenameFiles (E); TS LanguageService getEditsForFileRename (E); rope MoveModule/MoveGlobal (E); rust-analyzer willRenameFiles (E); ripgrep.
- **Applies to:** directory reorganisations and module splits or merges in any language.
- **When not to apply / counterpoints:**
  - Import-style changes (alias to relative, from-import to fully qualified) are correct but may fail lint rules.
  - For large reorganisations, a scripted engine move followed by a formatter and `lint --fix` may still beat hand edits.
  - Monorepos and project references were not tested.
- **Fix risk:** medium

### G105-F12 — On Windows with Git Bash: pass native engines repo-relative or long-form Windows paths (`cygpath -m -l`, `pwd -W`), never MSYS `/c/...` paths or 8.3 short names; prefix with `MSYS_NO_PATHCONV=1` when an argument starts with `/` or contains `=/`; normalise line endings after engine edits and check `git ls-files --eol`; install servers as native Windows binaries
- **Grade:** C · **Verdict:** CORRECTED. The researcher's two sources did not support the Windows claims: the git-diff page is unrelated, and basedpyright #1888 only shows that raw LSP requests reproduce editor behaviour. The fact-checker substituted four real sources for the **mechanisms**:
  - Git for Windows release notes, for `MSYS_NO_PATHCONV` and slash-argument conversion.
  - MSYS2 docs, for automatic argument conversion.
  - Cygwin `cygpath` docs, for `-m` and `-l`.
  - git-ls-files docs, for `w/mixed`.

  The engine-specific failures (the gopls 8.3 partial rename, the LF inserted into CRLF files) remain single-machine observations, so the grade stays C.
- **Rationale:** All engines ran natively on Windows; none needed WSL or Docker (E). The Windows-specific failures the researcher reproduced were:
  1. **MSYS argument conversion.** `--old_name=/pkg/util` reached the program as `C:/Program Files/Git/pkg/util`. Git for Windows documents this conversion and the `MSYS_NO_PATHCONV` escape hatch.
  2. **POSIX path handed to gopls.** A POSIX-form path ended up as `C:\c\Users\...`, and gopls failed.
  3. **8.3 short names.** `%TEMP%` expands to `C:\Users\UTILIS~1\...`. `cygpath -m` keeps the short form; `cygpath -m -l` prints the long form. gopls given the short path renamed only the file it was pointed at.
  4. **CRLF.** With `core.autocrlf=true`, the TS LanguageService extract and the gopls extract inserted LF lines, and `git ls-files --eol` reported `w/mixed`. rope preserved CRLF.
  5. **mcp-language-server** produced `/C:/...` paths (F10).
  6. **The rustup proxy** refused rust-analyzer without the component.
- **Evidence:**
  - [Git for Windows release notes (Known issues)](https://github.com/git-for-windows/build-extra/blob/main/ReleaseNotes.md) — Git for Windows, 2026 — official_docs — "If you specify command-line options starting with a slash, POSIX-to-Windows path conversion will kick in converting e.g. '/usr/bin/bash.exe' to 'C:\Program Files\Git\usr\bin\bash.exe'. When that is not desired ... you need to set the environment variable `MSYS_NO_PATHCONV` temporarily" — substituted by the fact-checker.
  - [MSYS2: Filesystem Paths](https://www.msys2.org/docs/filesystem-paths/) — MSYS2, 2026 — official_docs — arguments that look like Unix paths are converted for native programs; example `--dir=/foo` → `--dir=C:/msys64/foo`; opt-out via `MSYS2_ARG_CONV_EXCL` — substituted by the fact-checker. This page does not mention `MSYS_NO_PATHCONV`, which is specific to Git for Windows.
  - [cygpath](https://cygwin.com/cygwin-ug-net/cygpath.html) — Cygwin, 2026 — official_docs — `-m`: "like --windows, but with regular slashes (C:/WINNT)"; `-l`: "print Windows long form of NAMEs (with -w, -m only ...)" — substituted by the fact-checker.
  - [git-ls-files --eol](https://git-scm.com/docs/git-ls-files) — Git project, 2026 — official_docs — "<eolinfo> is either '-text', 'none', 'lf', 'crlf', 'mixed' or ''"; "i/<eolinfo>" for the index and "w/<eolinfo>" for the working tree — substituted by the fact-checker.
- **Detect:**
  - **Short names.** Run `rg -n 'UTILIS~\|~1'` over agent scripts, or check whether `echo "$TEMP"` contains `~`. Normalise with `cygpath -m -l`.
  - **Argument conversion.** Run native tools as `MSYS_NO_PATHCONV=1 <tool> ...` when an argument starts with `/` or contains `=/`.
  - **Line endings.** After engine edits, run `git ls-files --eol | rg 'w/mixed'`. Fix with the formatter, or with `git add --renormalize` when `.gitattributes` sets `text=auto`.
  - **gopls paths.** Prefer relative paths for gopls rename and codeaction; the relative path worked in the researcher's run (E).
- **Tools:** cygpath -m -l (E); MSYS_NO_PATHCONV (E); git ls-files --eol (E).
- **Applies to:** agents running on Windows through Git Bash/MSYS2. WSL and Linux CI avoid items 1–4 but bring their own path-translation problems.
- **When not to apply / counterpoints:**
  - These are single-machine reproductions: one user whose 11-character name has an 8.3 alias.
  - With `autocrlf=true`, git normalises EOL at commit, so mixed endings may never reach the repository.
  - GUI LSP clients normalise EOL on insert; the risk is specific to headless clients that apply `newText` verbatim.
- **Fix risk:** low

### G105-F13 — Use pattern rewriters (jscodeshift, ast-grep, LibCST codemods, rust-analyzer SSR, Bowler) only for API-migration patterns with an explicit semantic guard; never use them to rename or move a symbol when a semantic engine exists for the language
- **Grade:** C · **Verdict:** CORRECTED. In HN 48978866 the commenter's "I guess I was not particularly successful with having the agent actually do that" answers the claim that agents can "use LSP to build context". It is not about renames. The same comment adds "we do not have evals for this today ... we did not find a ton of evidence of LSP helping, even for finding data". The ast-grep quote itself is correct.
- **Rationale:** All four tools were executed on the TS or Python fixtures (E):
  - **jscodeshift 17.4.0,** with a naive transform on `Identifier{name:'computeTotal'}`, also renamed an unrelated module-local `const` and the exported object key `{ computeTotal }`. tsc still reported 0 errors.
  - **ast-grep 0.45.3** changed one bare call only; TS2304.
  - **LibCST RenameCommand** rewrote importers but not the definition (F04).
  - **Bowler** is archived and grammar-limited.

  These tools are scope-unaware or definition-unaware by design. They fit "replace every call to deprecated API X", not "rename symbol Z".
- **Evidence:**
  - [HN comment on OpenCode, LSP and ast-grep](https://news.ycombinator.com/item?id=48978866) — the_mitsuhiko, Hacker News, 2026-07-20 — practitioner_forum — "I found that making these refactors with ast-grep is quite efficient."; about LSP for context: "I guess I was not particularly successful with having the agent actually do that."; "we did not find a ton of evidence of LSP helping, even for finding data" — verified via the HN API; context corrected.
  - [Bowler README](https://github.com/facebookincubator/Bowler) — facebookincubator, 2024 — official_docs — "We've pretty much reached the limit of being able to add new language features" — verified.
  - [rust-analyzer book: SSR](https://rust-analyzer.github.io/book/features.html) — rust-analyzer, 2026 — official_docs — "Search and replace with named wildcards that will match any expression, type, path, pattern or item." — verified.
- **Detect:** In the agent transcript or the diff, flag any rename whose edits come from jscodeshift, ast-grep, `sed`, LibCST `RenameCommand` or SSR instead of an LSP or library rename. Then:
  - run tsc, pyright or cargo check;
  - diff the exported API (tsc `--declaration --emitDeclarationOnly` before and after, `griffe check`, cargo-semver-checks);
  - run `rg -n -w NEW` to find accidental captures of unrelated symbols.
- **Tools:** jscodeshift 17.4.0 (E); ast-grep 0.45.3 (E); LibCST 1.9.0 (E); rust-analyzer ssr (E).
- **Applies to:** all languages. Pattern tools are appropriate for migrations, deprecations and lint autofixes.
- **When not to apply / counterpoints:**
  - A well-written jscodeshift transform can check bindings with scope analysis; the researcher's transform was deliberately naive.
  - ast-grep rules can add relational constraints (`inside`, `has`, `not`).
- **Fix risk:** medium

### G105-F14 — After applying engine edits, run the project's formatter on the touched files only, and review whitespace/format-only changes separately from semantic changes
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Layout changes the researcher observed (E):
  - The TS LanguageService extract used 4-space indentation in a 2-space file.
  - clangd reformatted an untouched signature line.
  - pylsp-rope inserted one blank line where PEP 8 wants two.
  - The gopls inliner produced a func literal.
  - rope's global move switched to fully qualified imports.
  - gopls and the TS LanguageService inserted LF lines into CRLF files.

  The gopls docs add that Extract and Inline can drop comments. A practitioner who ran a Flow-to-TypeScript codemod pipeline ran prettier "after each step" and reports "the diff was much clearer".
- **Evidence:**
  - [HN comment: codemod pipeline with prettier](https://news.ycombinator.com/item?id=40694419) — striking, Hacker News, 2024-06-16 (thread "Reformatting 100k Files at Google in 2011") — practitioner_forum — "I ensured that a code formatting tool ... called `prettier` was executed after each step. We took a git snapshot of each step ... and the diff was much clearer with `prettier` in place" — verified.
  - [LibCST codemod docs](https://libcst.readthedocs.io/en/latest/codemods.html) — Instagram/Meta, 2026 — official_docs — "auto-formatting changed code according to a configured formatter" — verified.
  - [gopls transformation caveats](https://go.dev/gopls/features/transformation) — Go team, 2026 — official_docs — "transformations such as Extract and Inline are prone to losing comments" — added by the fact-checker.
- **Detect:**
  - Compare `git diff --stat` with `git diff -w --stat`; a large difference means format noise.
  - `git ls-files --eol | rg 'w/mixed'`.
  - Formatter checks on the touched files: `prettier --check`, `ruff format --check`, `gofmt -l`, `cargo fmt --check`, `clang-format --dry-run -Werror`.
  - Pass the project's format settings into engine APIs where supported, e.g. the TS `FormatCodeSettings`.
- **Tools:** prettier; ruff format / black; gofmt; cargo fmt; clang-format; git diff -w.
- **Applies to:** all engines and languages.
- **When not to apply / counterpoints:**
  - Formatting whole files pulls pre-existing drift into the refactoring commit. Restrict formatting to the touched ranges, or commit a format-only change first.
  - Some repositories deliberately have no formatter; then only EOL normalisation applies.
- **Fix risk:** low

### G105-F15 — Select code actions by exact kind plus exact title, pass exact ranges (know the tool's column base and end-exclusivity), and before applying check that the edit touches only the expected files and hunks; treat an empty, null or unexpectedly broad WorkspaceEdit as a failure
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Ambiguity and silent failures the researcher observed (E):
  - pylsp-rope lists "Extract method including similar statements" before "Extract method". Matching the title by substring picks the wrong variant.
  - A range one character short made pylsp-rope throw, but only on the server's stderr; the client got no error and no edit.
  - The same off-by-one in gopls silently extracted a different valid expression.
  - rope move needs an existing destination.
  - Serena's success message counts "2 changes" for three edits in two files.

  The gopls docs say its extract is "considerably less rigorous" than rename and inline.
- **Evidence:**
  - [gopls: Code transformation features (Extract)](https://go.dev/gopls/features/transformation) — Go team, 2026 — official_docs — "gopls' Extract algorithms are considerably less rigorous than the Rename and Inline operations, and we are aware of a number of cases where it falls short." — verified.
  - [pylsp-rope README](https://github.com/python-rope/pylsp-rope) — python-rope, 2025 — official_docs — variants: "Extract method; Extract global method; Extract method including similar statements; Extract global method including similar statements" — verified.
- **Detect:** In the client:
  - Filter by `action.kind` (e.g. `refactor.extract.function`) and compare `action.title` for exact equality. For gopls, use `-kind=<exact>` and `-title='^Extract function$'`.
  - Before applying, print the WorkspaceEdit and assert the expected file count and maximum hunk count. Fail if it is null or empty.
  - Capture the server's stderr and fail on ERROR lines.
  - After applying, `git diff --stat` must match the plan.
- **Tools:** gopls codeaction -kind/-title (E); pylsp-rope (E); custom LSP client (E).
- **Applies to:** every code-action-based engine: TS, rust-analyzer, clangd, pylsp-rope and gopls.
- **When not to apply / counterpoints:**
  - Exact title matching breaks when a server rewords its titles, so pin engine versions.
  - rust-analyzer and clangd give stable kinds, which reduce the need for title matching.
- **Fix risk:** low

### G105-F16 — When no engine exists for an operation (change-signature in TS/Rust/C++, any Solidity extract/move, macro-body fixes), use the fallback protocol: ripgrep census → moved-block diff → API-surface diff → compile → tests → one refactoring per commit
- **Grade:** C · **Verdict:** CORRECTED. Three fixes:
  1. **Diff mode.** The researcher specified `--color-moved=plain` and "require the moved body to be 100% moved lines". Git's docs say plain mode "picks up any moved line, but it is not very useful in a review to determine if a block of code was moved without permutation". The corrected protocol uses `--color-moved=zebra` or `dimmed-zebra`, with `--color-moved-ws=allow-indentation-change`. Block modes only detect moved blocks of at least 20 alphanumeric characters.
  2. **Benchmark languages.** SWE-Refactor and RefactorAssist are Java-only. "Refactoring Runaway" uses Multi-SWE-bench, which is multi-language.
  3. **griffe.** The griffe README is added as the source for `griffe check`.
- **Rationale:** The researcher executed each check (E):
  - Git move detection classified the relocated function body as moved and left only the import and call-site lines as real changes.
  - `griffe check` reported "Public object was removed".
  - A tsc declaration-emit diff isolated the exported signature change.
  - The rg census went from 5 to 4 hits, and the count alone did not reveal the broken getattr. The census must be a reviewed list, not a number.

  Published work uses the same oracle stack:
  - SWE-Refactor validates instances "via compilation, test execution, and automated refactoring detection tools".
  - RefactorAssist's static-repair-then-test loop reached a 94.2% cumulative pass rate in its best configuration.
  - "Refactoring Runaway" (3,691 patches on Multi-SWE-bench) found tangled refactorings "strongly associated with reduced compilability". Its selective removal or repair raised compilability from 19.34% to 38.33%, which supports one refactoring per commit.

  No study evaluates this exact protocol, so the grade stays C.
- **Evidence:**
  - [git-diff: --color-moved, --color-moved-ws](https://git-scm.com/docs/git-diff) — Git project (2.55.0 docs, updated 2026-06-29) — official_docs — plain: "This mode picks up any moved line, but it is not very useful in a review to determine if a block of code was moved without permutation."; blocks: "Blocks of moved text of at least 20 alphanumeric characters are detected greedily."; allow-indentation-change: "Initially ignore any whitespace in the move detection, then group the moved code blocks only into a block if the change in whitespace is the same per line." — verified; the mode recommendation is corrected.
  - [SWE-Refactor](https://arxiv.org/abs/2602.03712) — Yisen Xu, Jinqiu Yang, Tse-Hsun (Peter) Chen, 2026 — preprint — 1,099 refactorings from 18 Java projects; "Each instance is validated via compilation, test execution, and automated refactoring detection tools"; "an OpenAI Codex agent achieves only 39.4% success on compound instances" — verified.
  - [RefactorAssist](https://arxiv.org/abs/2608.00924) — Cordeiro, Noei, Zou, 2026 — preprint — "first applies a static repair step for missing imports, unbalanced brackets, and compilation errors without LLMs ... achieving up to a 70.8% repair rate on the remaining failures and a 94.2% cumulative pass rate under the best-performing configuration" — verified (Java).
  - ["Refactoring Runaway": Understanding and Mitigating Tangled Refactorings in Coding Agents for Issue Resolution](https://arxiv.org/abs/2605.22526) — Tian, Zhang, Xiao, Wang, Kondo, Chen, Kamei, 2026 — preprint — "3,691 valid patches ... on Multi-SWE-bench"; "tangled refactorings are strongly associated with reduced compilability, while exhibiting no significant association with functional correctness"; "improves compilability from 19.34% to 38.33%" — verified.
  - [griffe README (Check for API breaking changes)](https://github.com/mkdocstrings/griffe) — mkdocstrings, 2026 — official_docs — "Pass a relative path to the `griffe check` command"; `griffe check --search src mypackage` — added by the fact-checker.
  - [cargo-semver-checks README](https://github.com/obi1kenobi/cargo-semver-checks) — obi1kenobi, 2026 — official_docs — "Lint your crate API changes for semver violations." — verified; release v0.50.0, 2026-08-01 (not executed).
- **Detect:** Run in this order.
  1. **Census.** `rg -n -w -F OLD` before and after the edit, then diff the two lists and review every hit.
  2. **Moved blocks.** Review with:

     ```
     git -c color.diff.newMoved=cyan -c color.diff.oldMoved=magenta diff --color=always --color-moved=zebra --color-moved-ws=allow-indentation-change
     ```

     Moves smaller than 20 alphanumeric characters show as plain adds and deletes.
  3. **API-surface diff:**
     - TS: `npx tsc -p . --declaration --emitDeclarationOnly --outDir api-before`; repeat after the edit, then `git diff --no-index api-before api-after`.
     - Python: `uvx griffe check <pkg> --against <base-ref> --search .`
     - Rust: `cargo semver-checks` (N).
     - Go: gopls `go_package_api`, or apidiff (N).
     - Solidity: `forge inspect <Contract> abi` (N).
  4. **Compile gate, then tests.**
  5. **Commit** exactly one refactoring, with no behaviour change mixed in.
- **Tools:** ripgrep (E); git diff --color-moved (E); tsc declaration emit (E); griffe 2.3.0 (E); cargo-semver-checks (N); gopls go_package_api (listed).
- **Applies to:** any refactoring where no engine exists or the engine is known to be incomplete (macro bodies, bound Solidity calls, alias imports).
- **When not to apply / counterpoints:**
  - An API-surface diff flags every intended rename of a public name, so reviewers must whitelist the expected changes.
  - Tests may not cover the changed path. SafeRefactor-style generated tests are stronger but were not tried here.
- **Fix risk:** low

## Practitioner voice
- [HN 46356938 — rope skill for Codex](https://news.ycombinator.com/item?id=46356938) — 2025-12-22, on "Claude Code gets native LSP support". Codex "kept missing references when I asked it to rename or move symbols", so the author built a skill (brian-yu/python-rope-refactor) that forces rope for mechanical Python refactors, and is "pretty happy with it so far".
- [HN 48370241 — "we binned the LSP plugin"](https://news.ycombinator.com/item?id=48370241) — 2026-06-02. Claude Code's LSP integration is "constantly working on outdated views / compilation caches", so the team went back to find/replace, which trips over namespace clashes. They wish it could "leverage LSP to apply refactorings".
- [HN 48145363 — agent ignores LSP rename](https://news.ycombinator.com/item?id=48145363) — 2026-05-15, on "How Claude Code works in large codebases". With the LSP plugin installed, "CC doesn't to use LSP's symbol renaming and edits file one by one slowly". The poster asks for a robust harness example; adoption, not capability, is the bottleneck.
- [HN 48978866 — ast-grep over LSP](https://news.ycombinator.com/item?id=48978866) — 2026-07-20. ast-grep is "quite efficient" for agent refactors. The poster "was not particularly successful" getting the agent to use LSP to build context, has "no evals", and "did not find a ton of evidence of LSP helping". (Gist corrected: the lack of success was about LSP for context, not about renames.)
- [HN 46549670 — Show HN: LSP Skill](https://news.ycombinator.com/item?id=46549670) — 2026-01-09. Existing integrations ("Serena, cclsp, Claude Code LSP, etc.") "just expose raw LSP endpoints—agents need 10+ round trips". The author built a composed agent protocol (LSAP) on top.
- [HN 47665702 — Serena for safe renames](https://news.ycombinator.com/item?id=47665702) — 2026-04-06. Recommends Serena for symbol-level editing, including rename, alongside GitNexus for impact analysis. The commenter says Serena works "via tree-sitter"; Serena's README describes language-server and JetBrains backends.
- [HN 40694419 — prettier after every codemod step](https://news.ycombinator.com/item?id=40694419) — 2024-06-16. A Flow-to-TypeScript codemod pipeline (jscodeshift, ts-morph, ast-grep) ran prettier after each step and took a git snapshot of each step; "the diff was much clearer".
- [HN 24565146 — "Rope is installed. Refactoring failed"](https://news.ycombinator.com/item?id=24565146) — 2020-09-23. A variable rename through the VS Code Python extension failed after first asking to install rope. Python refactoring engines have a long-standing trust problem.
- [SE 69714 — What deters developers from automated refactoring tools?](https://softwareengineering.stackexchange.com/questions/69714/what-deters-developers-from-using-automated-refactoring-tools) — 2011. Answer 69717: "Metaprogramming code often can't run through refactoring tools"; "The quality of refactoring for Perl and Python a few years ago wasn't good"; "Tell me about a command line refactoring tool." Answer 69782: would not use the tools "without knowing what they do so I can predict the results". This is an old source; treat it as historical.
- [basedpyright #1888](https://github.com/DetachHead/basedpyright/issues/1888) — 2026-09-15. `willRenameFiles` in basedpyright 1.40.1 returns no edits for cross-directory moves, and wrong edits for a move plus rename, reproduced with raw LSP requests. The maintainer: "huh, i swear i had a test for this but i guess not..."; the reporter says a fix is coming.
- [ts-morph #837](https://github.com/dsherret/ts-morph/issues/837) — open since 2020-07-19. `SourceFile#move` does not update tsconfig `paths` module specifiers; the researcher reproduced this as TS2307.

## Contradictions and open questions

**Contradictions**

- **Wang et al. bug counts.** The brief's seed number of "130 bugs" is not the study size. The study analysed 518 historical engine bugs (637 related reports identified, out of 1,651 collected). Separately, its transferability study found 130 **new** bugs in the latest Eclipse, IntelliJ IDEA and NetBeans (21 submitted, 10 confirmed, 7 fixed).
- **ts-morph `move()` vs the TS LanguageService.** They disagree on path aliases even though ts-morph bundles TS 6.0.2. `move()` left `@util/math` broken, while `getEditsForFileRename` and TS 7's `willRenameFiles` rewrote it to a relative path: correct, but a change of import style.
- **Serena's testimonials vs its capability table.** The AI-written testimonials praise "cross-file renames, moves", but the table says the free LS backend has no move or inline. The testimonial says "IDE-backed", so it probably describes the paid JetBrains plugin.
- **LibCST `RenameCommand`.** It is documented as "Rename all instances of a local or imported object", yet in the researcher's run it left the definition untouched (ImportError).
- **Engines as oracles.** RefactoringMirror avoided every LLM-introduced bug by replaying refactorings through IntelliJ. Meanwhile, Daniel 2007, Soares 2013/2015, Wang 2024 and RETESTER 2025 show that the same class of engines ships compile-error and behaviour-change bugs. Both hold: engines are safer on common cases, but they are not oracles.
- **gopls rename.** The docs say it "takes great care" to avoid compile errors. On Windows, an 8.3 short path made it edit only one file and break the build. The environment, not the algorithm, caused the failure.
- **Practitioners on LSP for agents.** Some are "super bullish" and built rope or LSP skills. Others "binned" Claude Code's LSP plugin over staleness, or found little evidence LSP helps (the_mitsuhiko). Claude Code's LSP tool offers only navigation and diagnostics, so the rename benefit some commenters expected is not available through it.
- **Macro bodies.** The rust-analyzer book documents no macro limitation for rename, yet rename and module rename skipped a `macro_rules!` body in the researcher's run. clangd, by contrast, documents that macro bodies may not be renamed.
- **Tangled refactorings.** "Refactoring Runaway" finds that agents tangle refactorings less often than humans (21.43% vs 36.72%), yet tangling is strongly associated with reduced compilability, so one refactoring per commit still pays off.
- **Upgradeable-contract state variables.** The researcher said never to rename them. OpenZeppelin says renaming keeps the stored value and is not a layout violation, while reordering, retyping, inserting before and removing are. The dossier is corrected accordingly (F09).
- **Which refactorings agents do most.** Agentic Refactoring puts Change Variable Type and two rename types on top, while How do Agents Refactor (MSR 2026) finds annotation changes dominating. Both are Java-only, and the mix depends on the dataset.

**Open questions**

- **Scale.** All fixtures had 2–5 files. There were no monorepos, TS project references, pnpm or Cargo workspaces, or large `compile_commands.json`. Indexing latency and rename completeness at scale on Windows remain unmeasured.
- **TypeScript 7.x.** When will the native language server add `refactor.extract`, `refactor.inline` and move-to-file, and when will the 7.1 API ship? `next` is 7.1.0-dev.20260923.1. Until then, extract and inline for TS depend on TS 6.0.
- **rust-analyzer macros.** Is the `macro_rules!` rename gap a known limitation? No issue or documentation was found.
- **Serena JetBrains backend.** It was not executed. Its Windows reliability, its headless requirements, and its cost-benefit for a solo developer are unknown.
- **Other bridges.** cclsp and lsp-skill were not driven, and the Claude Code LSP tool was assessed from its docs only. Whether Claude Code will add a rename or code-action operation is unknown.
- **Unexecuted tools.** clang-tidy `--fix`, clang-change-namespace, clang-move and cargo-semver-checks were not run.
- **Per-operation failure rates.** No study measures how often LSP or library refactoring engines fail per operation in TypeScript, Python, Rust, Go, C++ or Solidity. All the quantitative engine-bug evidence is for Java IDE engines.
- **Fallback protocol.** It has no empirical evaluation for LLM-authored refactorings in these languages.
- **Solidity.** Is there a Slang-based or Foundry-integrated engine that offers extract, inline or move? None was found.
- **Python cross-validation.** Would rope's unsure-occurrence reports and basedpyright's references agree well enough to cross-validate each other automatically on real code bases?

## Dropped findings
None. All 18 findings survived verification. Ten were corrected (F01, F02, F03, F04, F05, F09, F12, F13, F16, F17) and one was downgraded (F06, from A to B). All 11 practitioner-voice URLs opened and say what is claimed; the gist of HN 48978866 was corrected.
