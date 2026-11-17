# Language: Go

> Purpose: Go-specific tool invocation, autofix trust, gopls-driven refactoring, dead-code and module checks, version-gated traps (loop variables, timers, goroutines, errors) and race/leak test tooling for a hardening pass.
> Read when: a `.go` file or a `go.mod` file is in scope.

## Contents
- Tooling baseline (GO-01 to GO-03)
- Autofix safety (GO-04 to GO-06)
- Refactoring engines (GO-07 to GO-10)
- Dead code and dependencies (GO-11 to GO-15)
- Language traps (GO-16 to GO-24)
- Test, mutation and fuzz tooling (GO-25 to GO-27)
- Evidence limits

## Tooling baseline

The project wins. First run the Go version, linters, linter configuration and tool versions the project already declares (go.mod `go`, `toolchain` and `tool` lines, the golangci-lint configuration, Makefiles, CI scripts), and never edit them. Only for a tool the project does not declare, run one exact version, never `@latest`, and save the raw output with tool name, version and command under `.harden/tools/` (output formats follow the detection reference). The format check runs on `F`, the in-scope `.go` files (`mapfile -t F < <(grep -E '\.go$' .harden/tools/inscope.txt)`), never on `.` (detection step 4; eval-v2-calibration E02-F08). If `go` is not on PATH, do not install a toolchain as part of the pass: record every Go check below as "not run" in the report's Limits and fall back to the manual checks in the rules. `go test -race` also needs cgo.

| Purpose | Command (report mode) | Version evidence (checked 2026-09) |
|---|---|---|
| Language version | `grep -E "^go \|^toolchain \|^tool " go.mod` | read before any rule (GO-16) |
| Build and vet gate | `go build ./... && go vet ./...` | toolchain, go1.27.1 |
| Format check | `test -z "$(gofmt -l "${F[@]}")"` | toolchain |
| Modernizers | `go fix -diff ./...` (Go 1.26+) | fixes to `go fix` itself in 1.26.1 and 1.27.1 |
| Module hygiene | `go mod tidy -diff`; `go mod verify`; `go list -m -u all` | toolchain |
| Races | `GORACE="halt_on_error=1" go test -race -count=10 ./...` | toolchain; needs cgo |
| Whole-program dead code | `go run golang.org/x/tools/cmd/deadcode@v0.50.0 -test ./...` | golang.org/x/tools v0.50.0 (2026-09-08) |
| Refactoring engine | gopls CLI, module `golang.org/x/tools/gopls` at v0.23.0 | released 2026-07-07 |
| Linters, scanners | golangci-lint v2 (`linters.default: standard`), staticcheck, errcheck, revive, govulncheck, each as `go run <package path>@<exact version>` | golangci-lint v2.13.2 (Aug 2026); staticcheck 2026.2.1 |

### GO-01 — Pin and record every Go tool; the project's versions win
- **Rule:** Run the toolchain and tools the project declares, at the versions it declares. For anything else, run one exact version and record tool, version, command and raw output. Report floating `go install …@latest` or `go run …@latest` in scripts and CI; since Go 1.24 a go.mod `tool` directive can pin developer tools instead.
- **Detect:** `grep -E "^go |^toolchain |^tool " go.mod`; `grep -rnE "go (install|run) [^ ]+@latest"` over scripts, Makefiles and CI files.
- **Not when:** Adding `tool` lines or changing `toolchain` is a go.mod change: propose it in the report, never apply it in the pass. Reproducibility is the stated reason for pinning; no source measures the drift caused by `@latest`.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** A
- **Source:** [Go Modules Reference](https://go.dev/ref/mod) (Go project, 2026); [Fixing For Loops in Go 1.22](https://go.dev/blog/loopvar-preview) (Chase, Cox, Go blog, 2023) · dossier: lang-solidity-go T24-F23, T24-F21

### GO-02 — Detect with go vet and golangci-lint v2 `standard`; report golint-era configs
- **Rule:** Detect with `go vet ./...` and golangci-lint v2 using the project's config, or `linters.default: standard` (errcheck, govet, ineffassign, staticcheck, unused; staticcheck now contains the former gosimple and stylecheck) when there is none. Treat vet and linter reports as heuristics to verify. Report a config that still enables golint ("deprecated and frozen") or the removed golangci-lint linters `deadcode`, `structcheck` and `varcheck`; propose staticcheck or revive without editing the config.
- **Detect:** `golangci-lint run`; `go vet ./...`; grep the golangci-lint config for `golint`, `deadcode`, `structcheck`, `varcheck`. The removed golangci-lint `deadcode` linter is not the x/tools `deadcode` command (GO-12).
- **Not when:** Never use `linters.default: all`: it adds many opinionated style findings that are not defects. Report tool and rule id instead of restating what gofmt and the linters enforce. The Uber guide's intro still says to run golint while its own Linting section calls revive golint's successor: follow the Linting section.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [golangci-lint v2 migration guide](https://golangci-lint.run/docs/product/migration-guide/) (golangci-lint, 2026); [golangci-lint linters](https://golangci-lint.run/docs/linters/) (golangci-lint, 2026); [golang/lint README](https://github.com/golang/lint) (Go project, archived 2021); [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) (Uber, 2026); [cmd/vet](https://pkg.go.dev/cmd/vet) (Go project, go1.27.1) · dossier: lang-solidity-go T24-F15

### GO-03 — Every `//nolint` names its linter and gives a reason
- **Rule:** Inventory suppressions. A blanket `//nolint`, an invalid form (`// nolint`, `//nolint :xxx`, `//nolint: xxx`) or one without a reason is a finding. Propose `//nolint:<linter> // <reason>` and removal of suppressions whose finding no longer reproduces, as one suppression-cleanup batch. On a large finished codebase, adopt a new linter for new code only (`new-from-rev` or `new-from-merge-base`) rather than adding suppressions.
- **Detect:** `git grep -nE "//\s*nolint($|[^:])" -- '*.go'`; nolintlint with `require-explanation: true` and `require-specific: true` (both default false) when the project enables it; re-run the named linter without the suppression to test staleness.
- **Not when:** Never add a `//nolint` or weaken the linter config to make a gate pass. A suppression whose reason the owner accepted stays.
- **Tier:** T1 · **Class:** structural · **Fix risk:** low · **Grade:** A
- **Source:** [golangci-lint: false positives](https://golangci-lint.run/docs/linters/false-positives/) (golangci-lint, 2026); [golangci-lint linter settings](https://golangci-lint.run/docs/linters/configuration/) (golangci-lint, 2026); [golangci-lint configuration file](https://golangci-lint.run/docs/configuration/file/) (golangci-lint, 2026) · dossier: lang-solidity-go T24-F15; eval-v2-calibration E02-F08

## Autofix safety

### GO-04 — gofmt and goimports: T0 only where the project enforces them, touched files only
- **Rule:** Apply gofmt (or goimports, "a superset of gofmt which additionally adds (and removes) import lines") automatically only when the project already enforces it in CI or hooks, and only to files the pass changed. Review format-only hunks separately from semantic hunks.
- **Detect:** `gofmt -l <touched files>`; compare `git diff --stat` with `git diff -w --stat` (a large gap is format noise); `git ls-files --eol | grep "w/mixed"` after engine edits (in one Windows run the gopls extract inserted LF lines into a CRLF file).
- **Not when:** A project with no enforced formatter gets a report item, not a mass reformat. Formatting whole files pulls pre-existing drift into the change: commit that drift first as its own T0 `style:` change (PC-11), or format only the touched ranges; a whole-repository run is T1 and needs its own explicit approval (PC-11).
- **Tier:** T0 · **Class:** structural · **Fix risk:** low · **Grade:** C
- **Source:** [Go Code Review Comments: Gofmt](https://go.dev/wiki/CodeReviewComments) (Go project, 2026); [HN: prettier after each codemod step](https://news.ycombinator.com/item?id=40694419) (2024); [git-ls-files --eol](https://git-scm.com/docs/git-ls-files) (Git project, 2026) · dossier: agent-refactoring-engines G105-F14, G105-F12; lang-solidity-go T24-F15

### GO-05 — `go fix` modernizers: preview, review, repeat to a fixed point, per build configuration
- **Rule:** On Go 1.26+, run `go fix -diff ./...` from a clean git tree, review the diff, apply only after the batch is approved, and repeat until a run produces no diff ("twice is usually enough"). Each run analyses one build configuration, so repeat per relevant `GOOS`/`GOARCH`/tag set. The Go team says the fixers "should not change the behavior", yet the command itself got bug fixes in 1.26.1 and 1.27.1, and a `slices.Clone` modernizer was excluded after it changed behaviour on empty slices.
- **Detect:** `git status --porcelain` prints nothing; `go fix -diff ./...`; `GOOS=windows go fix -diff ./...`, `GOOS=darwin go fix -diff ./...` for build-tagged files; then the build, vet and test gates.
- **Not when:** The `forvar` fixer (redundant `x := x` loop copies) is correct only where the module declares go 1.22 or later (GO-16), and removing those copies is cosmetic, never a bug fix. Never raise the `go` directive to unlock a modernizer.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** A
- **Source:** [Using go fix to modernize Go code](https://go.dev/blog/gofix) (Donovan, Go blog, 2026); [Go 1.26 Release Notes](https://go.dev/doc/go1.26) (Go project, 2026); [Go 1.27 Release Notes](https://go.dev/doc/go1.27) (Go project, 2026); [Go release history](https://go.dev/doc/devel/release) (Go project, 2026) · dossier: lang-solidity-go T24-F21; concurrency-async T29-F12

### GO-06 — Keep fixes that change exported signatures or error identity out of every autofix batch
- **Rule:** Report, never auto-apply, suggestions whose fix changes what callers observe: errorlint `errorf` (`%v` to `%w` makes the wrapped error part of the API), unparam or revive `unused-parameter` on exported functions and interface methods, panic-to-error conversions, renames of exported identifiers, and changed return types.
- **Detect:** Classify each fix-bearing finding by what it touches: exported (capitalised) identifiers, interface methods and their implementers, `fmt.Errorf` verbs on exported paths.
- **Not when:** The same fix on unexported code of a binary is an ordinary T1 item under its own rule (GO-11, GO-20, GO-21, GO-22). A module whose only consumers live in the same repository can be analysed as a whole program.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** high · **Grade:** A
- **Source:** [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors) (Neil, Amsterdam, Go blog, 2019); [golangci-lint linter settings](https://golangci-lint.run/docs/linters/configuration/) (golangci-lint, 2026); [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) (Uber, 2026); [deadcode command documentation](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) (Go team, 2026) · dossier: lang-solidity-go T24-F17, T24-F18, T24-F22, T24-F24; dead-code-tools T07-F12

## Refactoring engines

gopls is the only Go engine in the evidence. Every operation below was run once on 2–5 file fixtures (gopls v0.23.0, go1.27.1, Windows 11, 2026-09); treat those results as observations, not rates.

### GO-07 — Make every rename, extract and inline a gopls operation, gated after each one
- **Rule:** Produce renames, extracts, inlines and import cleanups with the gopls CLI (`gopls rename -w FILE:L:C New`, `gopls codeaction -kind=refactor.extract.function|refactor.extract.variable|refactor.inline.call -exec -w`, `gopls imports -w`), not with hand edits. After each operation run `go build ./... && go vet ./...`, the tests, and a diff review, weighting review by operation: gopls calls Extract "considerably less rigorous than the Rename and Inline operations", and Extract and Inline "are prone to losing comments".
- **Detect:** An engine log per refactoring commit (tool, version, command, files edited). Flag a multi-file identifier change made by several Edit or sed calls where gopls could have done it.
- **Not when:** Change-signature exists only as primitives (`moveParam`, `removeUnusedParam`), not executed in the evidence: use the fallback (text census, `git diff --color-moved=zebra`, API diff, compile, tests, one refactoring per commit). The inliner can leave an immediately invoked func literal that needs a readable follow-up. Engines ship bugs: 66 of 518 catalogued Java IDE engine bugs (12.7%) changed behaviour (2024), so tests stay mandatory.
- **Tier:** T1 · **Class:** structural · **Fix risk:** low · **Grade:** A
- **Source:** [gopls: Code transformation features](https://go.dev/gopls/features/transformation) (Go team, 2026); [An Empirical Study of Refactoring Engine Bugs](https://arxiv.org/html/2409.14610v1) (Wang et al., 2024); [RefactoringMirror](https://arxiv.org/abs/2411.04444) (Liu et al., 2025) · dossier: agent-refactoring-engines G105-F07, G105-F02, G105-F01, G105-F16

### GO-08 — Prove a rename is complete: references, edited files, text census
- **Rule:** Before a rename, run `gopls prepare_rename FILE:L:C` and `gopls references FILE:L:C`, preview with `gopls rename -d FILE:L:C New`, and apply with `-w` only when the edit covers every referencing file plus the declaration; an exported symbol whose rename touches one file is a failure. Take a text census of the old name first (code, strings, struct tags, templates, config, docs) and explain or hand-fix every surviving hit: gopls warns renaming "may introduce dynamic errors", including through `encoding/json` and `text/template`.
- **Detect:** Compare `gopls references FILE:L:C` with `gopls rename -l`; `rg -n -w -F OLD > before.txt` before and again after; `rg -n 'reflect[.]|MethodByName|json:'` over the touched types.
- **Not when:** Renaming an exported identifier of a library is a public API change (GO-06). Packages named `main` and `x_test` packages have documented rename restrictions. Auto-renaming strings also hits unrelated literals, so the census is a review list; in one run gopls left a `'ComputeTotal'` string behind while the build passed.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** B
- **Source:** [gopls: Code transformation features (Rename)](https://go.dev/gopls/features/transformation) (Go team, 2026); [An Empirical Study of Refactoring Engine Bugs](https://arxiv.org/html/2409.14610v1) (Wang et al., 2024) · dossier: agent-refactoring-engines G105-F05, G105-F11, G105-F17, G105-F07

### GO-09 — Select code actions by exact kind and title, with exact 1-based ranges
- **Rule:** Call extract and inline with an exact kind (`-kind=refactor.extract.function`) and an anchored title (`-title='^Extract function$'`), pass 1-based columns with an exclusive range end, and check after applying that only the planned file and hunks changed. Treat an empty, null or unexpectedly broad edit as a failure and revert it.
- **Detect:** `git diff --stat` must match the plan; re-read the extracted range against the intended one.
- **Not when:** In one run a range one column short made gopls silently extract a smaller, different valid expression, so a green build proves nothing about the range. Exact titles break when a server rewords them: keep gopls pinned (v0.23.0).
- **Tier:** T1 · **Class:** structural · **Fix risk:** low · **Grade:** C
- **Source:** [gopls: Code transformation features (Extract)](https://go.dev/gopls/features/transformation) (Go team, 2026); [gopls v0.23.0 module proxy record](https://proxy.golang.org/golang.org/x/tools/gopls/@latest) (Go module proxy, 2026) · dossier: agent-refactoring-engines G105-F15, G105-F07

### GO-10 — On Windows and Git Bash, pass gopls long-form or repo-relative paths
- **Rule:** Give gopls repo-relative paths or long-form Windows paths (`cygpath -m -l`, `pwd -W`), never MSYS `/c/...` paths or 8.3 short names such as `UTILIS~1`; prefix with `MSYS_NO_PATHCONV=1` when an argument starts with `/` or contains `=/`. Check line endings after every engine edit.
- **Detect:** `echo "$TEMP"` containing `~`; `git ls-files --eol | grep "w/mixed"`; the edited-file count against `gopls references` (GO-08).
- **Not when:** These are single-machine observations: an 8.3 path made gopls rename only the definition file and break the build, and a POSIX path became `C:\c\Users\...`. WSL and Linux CI avoid them. With `core.autocrlf=true`, mixed endings may be normalised at commit.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** C
- **Source:** [Git for Windows release notes](https://github.com/git-for-windows/build-extra/blob/main/ReleaseNotes.md) (Git for Windows, 2026); [cygpath](https://cygwin.com/cygwin-ug-net/cygpath.html) (Cygwin, 2026); [git-ls-files --eol](https://git-scm.com/docs/git-ls-files) (Git project, 2026) · dossier: agent-refactoring-engines G105-F12

## Dead code and dependencies

### GO-11 — Unused unexported identifiers: staticcheck U1000 or golangci-lint `unused`
- **Rule:** Propose removal of unexported constants, variables, functions and types reported by staticcheck U1000 (or golangci-lint `unused`) after a whole-repo text search for the name and a check for `//go:linkname`, assembly files and build-tagged files. U1000 treats every exported package-level identifier as used (since Staticcheck 2020.2), so it never finds dead exported API.
- **Detect:** `staticcheck ./...` filtered to U1000, or golangci-lint `unused`; `git grep -n -w NAME`; `git grep -n "//go:linkname" -- '*.go'`; `git ls-files '*.s'`.
- **Not when:** U1000 also treats go:linkname symbols, objects in generated files and all interface methods as used; regenerate generated code, never hand-edit it. A variable used only in `x_linux.go` is reported unused when staticcheck runs on darwin (go-tools #983), so apply GO-13. gopls `unusedfunc` gives editor feedback and is less precise than `deadcode`.
- **Tier:** T1 · **Class:** structural · **Fix risk:** low · **Grade:** A
- **Source:** [Staticcheck 2020.2 release notes](https://staticcheck.dev/changes/2020.2/) (Honnef, 2020); [unused source doc comment](https://raw.githubusercontent.com/dominikh/go-tools/master/unused/unused.go) (dominikh/go-tools, 2026); [unusedfunc analyzer](https://pkg.go.dev/golang.org/x/tools/gopls/internal/analysis/unusedfunc) (Go team, gopls v0.23.0); [go-tools #983](https://github.com/dominikh/go-tools/issues/983) (2021) · dossier: dead-code-tools T07-F08, T07-F09; lang-solidity-go T24-F22; eval-v2-calibration E02-F08

### GO-12 — Whole-program `deadcode` on binaries: verify each result before it becomes a candidate
- **Rule:** On modules with a `main` package, run `deadcode ./...` and `deadcode -test ./...`; a function dead without `-test` but live with it is reachable only from tests (handle those tests under the dead-code lens's test-deletion rule). Run `-whylive=<pkg>.<Func>` on any surprising result. Before proposing a deletion, rule out the documented blind spots: `//go:linkname` aliasing, functions called only from assembly, build configurations not analysed, and dead methods still needed to satisfy an interface.
- **Detect:** `go run golang.org/x/tools/cmd/deadcode@v0.50.0 ./...`, then with `-test`; `-whylive`; `-generated` only to include generated files (excluded by default, as are marker-interface methods); grep for linkname, `.s` files and `//go:build` around each candidate.
- **Not when:** In a library, exported functions reported dead may have callers you cannot see: report them (T2). Public API reported dead with `-test` may signal a test gap. The command doc says a reported function is not "unconditionally safe to delete" and "Some judgement is required". Reflection is not a reason to distrust it: RTA analyses calls through func values, interface methods and reflection soundly.
- **Tier:** T1 · **Class:** structural · **Fix risk:** high · **Grade:** A
- **Source:** [Finding unreachable functions with deadcode](https://go.dev/blog/deadcode) (Donovan, Go blog, 2023); [deadcode command documentation](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) (Go team, x/tools v0.50.0, 2026) · dossier: lang-solidity-go T24-F22; dead-code-tools T07-F08, T07-F04, T07-F12

### GO-13 — Dead only if dead in every shipped build configuration
- **Rule:** List the GOOS/GOARCH/build-tag combinations that ship, run the dead-code tools once per configuration, and propose only what every run reports: the analysis is "valid only for a single GOOS/GOARCH/-tags configuration".
- **Detect:** `staticcheck -matrix` (one line per GOOS or tag set), or separate runs combined with `-merge`; `GOOS=<os> deadcode ./...` per target; `git grep -n "//go:build" -- '*.go'` around every candidate.
- **Not when:** A single-target application may ship one configuration only: confirm that from build scripts and CI before skipping the extra runs. How many configurations to iterate by default is unresolved.
- **Tier:** T1 · **Class:** structural · **Fix risk:** high · **Grade:** A
- **Source:** [deadcode command documentation](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) (Go team, 2026); [Build tags (Running Staticcheck)](https://staticcheck.dev/docs/running-staticcheck/cli/build-tags/) (Staticcheck, 2026) · dossier: dead-code-tools T07-F09; lang-solidity-go T24-F22; eval-v2-calibration E02-F08

### GO-14 — `go mod tidy`: diff only during detection, one reviewed commit when applied
- **Rule:** During detection run only `go mod tidy -diff`, which prints the change as a diff, exits non-zero if there is one, and writes nothing; plain `go mod tidy` rewrites go.mod and go.sum. Apply tidy as its own dependency-removal commit after approval, then run the build, vet and test gates.
- **Detect:** `go mod tidy -diff`; `go mod tidy -v` names the removed modules; after applying, `git diff go.mod go.sum` shows exactly the approved change.
- **Not when:** Tidy also "adds any missing entries to go.sum", so an applied tidy can add lines as well as remove them. A requirement other modules still pull in transitively does not leave the build when its direct line goes. Record a requirement kept on purpose with a comment saying why.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** A
- **Source:** [go mod tidy](https://pkg.go.dev/cmd/go#hdr-Add_missing_and_remove_unused_modules) (Go team, 2026); [Go Modules Reference](https://go.dev/ref/mod) (Go project, 2026) · dossier: dead-code-tools T07-F08, T07-F16, T07-F21; lang-solidity-go T24-F22

### GO-15 — Vulnerabilities and integrity: govulncheck findings first, `go mod verify`
- **Rule:** Run `govulncheck ./...`, which surfaces only vulnerabilities whose vulnerable functions the code transitively calls, and fix those first; run `go mod verify` to confirm the module cache was not modified after download. Propose each fix as its own upgrade commit and run the full suite (with `-race` where available) after each bump, because upgrades can change behaviour.
- **Detect:** `govulncheck ./...`; `go mod verify`; `go list -m -u all` for available upgrades.
- **Not when:** A major-version upgrade is T2 report-only. Reachability analysis may miss plugin or dynamic loading (reasoning in the dossier, not a sourced claim).
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** medium · **Grade:** A
- **Source:** [Go Vulnerability Management](https://go.dev/doc/security/vuln/) (Go project, 2026); [Go Modules Reference](https://go.dev/ref/mod) (Go project, 2026) · dossier: lang-solidity-go T24-F23

## Language traps

### GO-16 — Read the `go` directive before any version-dependent rule; never raise it
- **Rule:** Record go.mod's `go` and `toolchain` lines first and gate rules on them. With go 1.22 or later, loop variables are per-iteration: `x := x` copies are redundant and loop-capture findings are obsolete; below 1.22 they are real bugs (a loop-variable reference caused Let's Encrypt's 2020 CAA bug, about 3M certificates affected and 1,706,505 revoked). When the main module declares go 1.23 or later, unstopped timers are collected, so "time.After leaks" advice (100 Go Mistakes #76) no longer applies; GODEBUG `asynctimerchan=1` restores the old behaviour. Never raise the `go` directive as a cleanup.
- **Detect:** `grep -E "^go |^toolchain " go.mod`; on go 1.22+, `git grep -nE "^\s*([a-zA-Z_][a-zA-Z0-9_]*) := \1$" -- '*.go'` (a backreference, a GNU extension to EREs; use `git grep -P` where Git was built with PCRE and `-E` rejects it), golangci-lint `copyloopvar`, go fix `forvar`; `go vet ./...` (stdversion; `go test` runs it by default from Go 1.27).
- **Not when:** Raising the directive changes semantics: forcing per-iteration loops at Google gave 58 failures in about 100,000 tests over about 1.3M loops, 36 of them t.Parallel tests that were not testing what they appeared to, and only 2 correct code actually broken (2022–2023). Libraries that support older Go versions keep the old idioms.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** A
- **Source:** [Fixing For Loops in Go 1.22](https://go.dev/blog/loopvar-preview) (Chase, Cox, Go blog, 2023); [golang/go discussion #56010](https://github.com/golang/go/discussions/56010) (Cox, 2022); [2020.02.29 CAA Rechecking Bug](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591) (Let's Encrypt, 2020); [Mozilla Bugzilla 1619047](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047) (Let's Encrypt, 2020); [Go 1.23 Release Notes](https://go.dev/doc/go1.23) (Go project, 2024); [Go 1.27 Release Notes](https://go.dev/doc/go1.27) (Go project, 2026) · dossier: lang-solidity-go T24-F21; concurrency-async T29-F20, T29-F12; eval-v2-calibration E02-F08

### GO-17 — Every goroutine needs an owner and a guaranteed exit
- **Rule:** For each `go` statement, write down how it exits (ctx.Done(), a channel close, WaitGroup or errgroup) and who waits for it. Report as leaks a goroutine that sends on an unbuffered channel while its parent can return on timeout or cancel (capacity 1 or a select on ctx.Done() is the documented fix), and fire-and-forget goroutines doing work that must finish. In Uber production, a leak detector found 10 critical leaks with 1 false positive, and fixing two cut the service's peak memory 2.5x and 5x (2022). Concurrency fixes stay in the human lane.
- **Detect:** `git grep -n "go func\|go [a-zA-Z_.]*(" -- '*.go'` with an exit condition per hit; `rg -n "make\(chan [^,)]+\)"` read inside a `select` with `time.After` or `ctx.Done()`; `/debug/pprof/goroutineleak` under load tests (generally available in Go 1.27, an experiment in 1.26).
- **Not when:** Long-lived background services legitimately outlive a request and need an application-level owner. Buffering a channel can hide a logic error in which nobody consumes the result. The runtime deadlock detector caught 2 of 21 reproduced blocking bugs (6 Go projects, 2019), so its silence is no evidence.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** A
- **Source:** [Go Code Review Comments: Goroutine Lifetimes](https://go.dev/wiki/CodeReviewComments) (Go project, 2026); [Google Go Style Guide: Decisions](https://google.github.io/styleguide/go/decisions) (Google, 2026); [LeakProf](https://www.uber.com/blog/leakprof-featherlight-in-production-goroutine-leak-detection/) (Saioc, Chabbi, Uber, 2022); [Goroutine Leak Profiles](https://go.dev/blog/goroutine-leak-profiles) (Saioc, Go blog, 2026); [Understanding Real-World Concurrency Bugs in Go](https://songlh.github.io/paper/go-study.pdf) (Tu et al., ASPLOS 2019) · dossier: lang-solidity-go T24-F19; concurrency-async T29-F12, T29-F16; eval-v2-calibration E02-F08

### GO-18 — Audit the recurring Go data-race patterns
- **Rule:** Report concurrent map writes, slices appended from several goroutines, mutexes copied by value, `WaitGroup.Add` inside the goroutine (on Go 1.25+ `wg.Go(f)` is the idiom), `err` or named results written from goroutines, channels that may be closed twice (`sync.Once`), cancel functions never called, and t.Parallel table tests sharing state. Do not convert between channels and mutexes as "hardening".
- **Detect:** `go vet ./...` (copylocks, lostcancel, waitgroup on Go 1.25+, atomic and testinggoroutine run by default); staticcheck SA2001 (empty critical section); `rg -n "close\(\w+\)"`; `rg -n "wg\.Add\("` inside `go func`; package-level `map[` written from handlers.
- **Not when:** Neither model is safer: message passing caused about 58% of blocking bugs and shared memory about 80% of non-blocking bugs (171 bugs, 6 Go projects, 2019). The Go 1.27 `waitgroup` to `waitgroupgo` rename is a go fix modernizer, not the vet analyzer.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [Data Race Patterns in Go](https://www.uber.com/blog/data-race-patterns-in-go/) (Chabbi, Ramanathan, Uber, 2022); [Go 1.25 Release Notes](https://go.dev/doc/go1.25) (Go team, 2025); [cmd/vet](https://pkg.go.dev/cmd/vet) (Go project, go1.27.1); [Staticcheck checks](https://staticcheck.dev/docs/checks/) (Honnef, 2026); [Understanding Real-World Concurrency Bugs in Go](https://songlh.github.io/paper/go-study.pdf) (Tu et al., 2019) · dossier: concurrency-async T29-F12; lang-solidity-go T24-F20, T24-F19, T24-F16

### GO-19 — Context placement and deadlines on every external wait
- **Rule:** Pass `context.Context` as the first parameter; do not store it in a struct (the one exception: methods whose signature must match an interface you do not control); never create custom context types (no exceptions). Every HTTP, RPC, database or queue wait takes its deadline from the caller's context, propagated rather than reset per call; gRPC sets no deadline by default.
- **Detect:** revive `context-as-argument`, `context-keys-type`; golangci-lint `contextcheck`; staticcheck SA1012 (nil context), SA1029 (bad WithValue key); vet `lostcancel`; `rg -n "http\.Client\{\s*\}|http\.(Get|Post)\(|context\.Background\(\)"` in request paths.
- **Not when:** A timeout adds a failure path, and a timed-out non-idempotent request may still have run on the server; no source here gives a method for choosing values, so without latency data use ER-21's fixed internal default (generous, documented where it is set, owner-tunable, never a new exported parameter) rather than leaving the wait unbounded (eval-v1-calibration E01-F05; pilot-auto-calibration A01-F10). Moving `ctx` in an exported signature is an API change (GO-06).
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** medium · **Grade:** A
- **Source:** [Go Code Review Comments: Contexts](https://go.dev/wiki/CodeReviewComments) (Go project, 2026); [Google Go Style Guide: Decisions](https://google.github.io/styleguide/go/decisions) (Google, 2026); [gRPC Deadlines](https://grpc.io/docs/guides/deadlines/) (gRPC, 2026) · dossier: lang-solidity-go T24-F19; concurrency-async T29-F13; eval-v1-calibration E01-F05; pilot-auto-calibration A01-F10

### GO-20 — Never drop an error silently
- **Rule:** Every returned error is handled, returned or deliberately discarded. Report dead error assignments, `if err != nil { return nil }`, ignored type-assertion results, and deferred `Close()` or `Flush()` on writers whose error is lost.
- **Detect:** `errcheck -blank -asserts ./...`, or golangci-lint errcheck with `check-blank` and `check-type-assertions` (both default false); staticcheck SA4006; ineffassign; nilerr; `git grep -nE "defer [a-zA-Z_.]+\.Close\(\)" -- '*.go'`, keeping writers (os.Create, OpenFile with write flags, gzip or bufio writers).
- **Not when:** `_ =` is contested: Code Review Comments says "Do not discard errors using _ variables", 100 Go Mistakes says to ignore explicitly with `_`, and errcheck accepts `_ =` unless `-blank` is set. Follow the project: where it checks blanks, `_ =` is a finding; otherwise accept `_ =` with a reason comment and report a bare one. errcheck's built-in exclude list covers calls documented never to fail.
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** medium · **Grade:** A
- **Source:** [Go Code Review Comments: Handle Errors](https://go.dev/wiki/CodeReviewComments) (Go project, 2026); [errcheck README](https://github.com/kisielk/errcheck) (kisielk, 2026); [Staticcheck checks](https://staticcheck.dev/docs/checks/) (Honnef, 2026); [golangci-lint linters](https://golangci-lint.run/docs/linters/) (golangci-lint, 2026); [100 Go Mistakes #53, #54](https://100go.co/) (Harsanyi, 2022) · dossier: lang-solidity-go T24-F16; eval-v2-calibration E02-F08

### GO-21 — Handle each error once, wrap with intent, compare with errors.Is and errors.As
- **Rule:** Log an error or return it, not both. When returning, add context the error does not already carry (no "failed to" prefixes). Use `%w` only when callers may inspect the cause and exposing it is intended API, `%v` when the cause is an implementation detail. Compare with `errors.Is`/`errors.As`, never `==` or a type assertion on errors that may be wrapped.
- **Detect:** golangci-lint `errorlint` (`comparison` and `asserts` catch `==` and assertions; `errorf` hits are design questions); staticcheck ST1005 (on by default); revive `error-strings`, `error-naming`; `if err != nil` blocks containing both a `log.`, `slog.` or `logger.` call and `return .*err`; `"failed to ` inside `fmt.Errorf` or `errors.New`.
- **Not when:** Removing a log line can remove the only record if a caller swallows the error: confirm the top level logs first. Sentinel errors checked with `errors.Is` are fine on Go 1.13+ (Go blog, Google guide, standard library); Cheney's 2016 advice to avoid them predates Go 1.13, so do not remove sentinels. Google allows `%w` at the start of the string for sentinel categories.
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** medium · **Grade:** A
- **Source:** [Google Go Style Guide: Best Practices](https://google.github.io/styleguide/go/best-practices) (Google, 2026); [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors) (Neil, Amsterdam, 2019); [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) (Uber, 2026); [Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) (Cheney, 2016); [Staticcheck checks](https://staticcheck.dev/docs/checks/) (Honnef, 2026) · dossier: lang-solidity-go T24-F17

### GO-22 — Libraries return errors; panic and exit stay at the edges
- **Rule:** In non-main packages, report `panic` used for ordinary error handling and any `os.Exit`, `log.Fatal*` or `log.Panic*`. Keep `panic` for impossible states and for `Must*` helpers called at program start; call `os.Exit` or `log.Fatal` only in `main()`, ideally once.
- **Detect:** revive `deep-exit`; `git grep -nE "\bpanic\(" -- '*.go' | grep -v _test.go`, excluding `func Must`, `init()` and unreachable branches; `git grep -nE "os\.Exit|log\.Fatal|log\.Panic" -- '*.go'` outside `package main`.
- **Not when:** Effective Go allows a panic at initialisation "if the library truly cannot set itself up"; Google allows panic/recover inside one package when panics never cross its boundary. Converting a panic to an error changes the signature and every caller: exported functions are GO-06.
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** medium · **Grade:** A
- **Source:** [Go Code Review Comments: Don't Panic](https://go.dev/wiki/CodeReviewComments) (Go project, 2026); [Google Go Style Guide: Decisions](https://google.github.io/styleguide/go/decisions) (Google, 2026); [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) (Uber, 2026); [revive rules](https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md) (mgechev, 2026); [Effective Go](https://go.dev/doc/effective_go) (Go project, 2009) · dossier: lang-solidity-go T24-F18; eval-v2-calibration E02-F08

### GO-23 — Package and API shape: report, do not restructure
- **Rule:** Report interfaces declared in the implementing package or before a real need exists, functions returning interfaces where a concrete type would do, test doubles exported only for tests, package-level mutable state and `init()` side effects, and `util`, `common` or `helper` package names. These are architecture or public API changes for the owner.
- **Detect:** List `type .* interface` declarations with their implementations and consumers; `git grep -n "^func init()" -- '*.go'`; `awk -F/ '{p=""; for(i=1;i<NF;i++){p=p $i "/"; if($i~/^(util.*|common|helpers)$/) print p}}' .harden/tools/inscope.txt | sort -u` (tracked directories only, never `find .`, which also walks `.harden/`); staticcheck ST1003 and ST1016 (both non-default); revive `receiver-naming`, `var-naming`, `unexported-return`, `import-shadowing`.
- **Not when:** Renaming exported identifiers, moving interfaces or changing return types breaks library users; removing a test-seam interface may break tests. Effective Go is "not actively updated" and predates generics and modules.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** A
- **Source:** [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) (Go project, 2026); [Google Go Style Guide: Decisions](https://google.github.io/styleguide/go/decisions) (Google, 2026); [Google Go Style Guide: Best Practices](https://google.github.io/styleguide/go/best-practices) (Google, 2026); [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) (Uber, 2026); [100 Go Mistakes #5–#7, #13](https://100go.co/) (Harsanyi, 2022) · dossier: lang-solidity-go T24-F24; eval-v2-calibration E02-F08

### GO-24 — Complexity findings: state the threshold, refactor only covered functions
- **Rule:** Report each complexity finding with the tool, the threshold used and where it came from. Propose flattening to the early-return shape (handle errors first, no `else` after `return`) or an extract only for functions the tests cover.
- **Detect:** golangci-lint `gocognit`, `cyclop`, `gocyclo`, `nestif`, `funlen`; revive `indent-error-flow`, `superfluous-else`, `early-return`, `max-control-nesting`, `cognitive-complexity`; `go test -coverprofile=c.out ./... && go tool cover -func=c.out`.
- **Not when:** Defaults disagree (revive cognitive 7; gocyclo and gocognit 30 with 10–20 recommended; cyclop 10; funlen 60 lines or 40 statements) and none is empirically validated for Go; the project's configured values win. `nestif` reports a complexity score of nested ifs (default 5), not a depth. Table-driven switches and generated parsers score high yet read easily.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** B
- **Source:** [Go Code Review Comments: Indent Error Flow](https://go.dev/wiki/CodeReviewComments) (Go project, 2026); [golangci-lint linter settings](https://golangci-lint.run/docs/linters/configuration/) (golangci-lint, 2026); [revive rules](https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md) (mgechev, 2026); [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) (Uber, 2026) · dossier: lang-solidity-go T24-F25

## Test, mutation and fuzz tooling

This file's evidence covers race and leak tooling only. Go mutation testing and native fuzzing are outside it; use the tests lens (lens-tests.md) for them.

### GO-25 — Race detector: a gate and a detector, never a proof
- **Rule:** Include `go test -race` in the baseline gates when cgo is available, and record it as not run otherwise. Pick the run count by purpose: `-count=1` for the gate (5 when a concurrency test is flaky), `GORACE="halt_on_error=1" go test -race -count=10 ./...` for detection, and `-count=100` to show a specific race fails before and passes after a fix. Treat every report as a bug; where concurrent paths are weakly covered, recommend a `-race` binary under a realistic workload.
- **Detect:** Gate commands in `.harden/config.json`; CI files for a `-race` job; tests that actually run concurrently (parallel requests, `t.Parallel()` table tests).
- **Not when:** It sees only executed interleavings: it caught 10 of 20 reproduced non-blocking bugs within 100 runs, 4 of them needing about 100 (6 Go projects, 2019), while Uber's rollout found about 2,000 races in six months (about 46–50M lines of Go, about 2,100 services, 2022). "No false positives" was observed only in that 20-bug experiment. Memory 5–10x and time 2–20x can rule it out for some integration suites.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [Data Race Detector](https://go.dev/doc/articles/race_detector) (Go project, 2026); [Understanding Real-World Concurrency Bugs in Go](https://songlh.github.io/paper/go-study.pdf) (Tu et al., ASPLOS 2019); [A Study of Real-World Data Races in Golang](https://arxiv.org/abs/2204.00764) (Chabbi, Ramanathan, PLDI 2022); [Data Race Patterns in Go](https://www.uber.com/blog/data-race-patterns-in-go/) (Uber, 2022) · dossier: lang-solidity-go T24-F20; concurrency-async T29-F11, T29-F24

### GO-26 — Goroutine-leak checks: goleak in tests, the leak profile under load
- **Rule:** Recommend `goleak.VerifyTestMain(m)` per package (not `defer goleak.VerifyNone(t)` where tests call `t.Parallel()`) and, on Go 1.27+, collecting `/debug/pprof/goroutineleak` during load tests. goleak is a new test dependency, so the recommendation goes to the report, not into the pass.
- **Detect:** `git grep -n "goleak\." -- '*_test.go'`; the go.mod `go` line for the profile; whether the service already serves pprof endpoints.
- **Not when:** goleak cannot tell leaks from goroutines of parallel tests still running. The profile misses goroutines blocked on I/O or on primitives reachable from globals or runnable goroutines, and its production false-positive and false-negative rates are unreported. Leak detection is diagnostic; prevention stays with the developer (Lobsters thread with a Go team member).
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [goleak](https://github.com/uber-go/goleak) (Uber, 2026); [Go 1.27 Release Notes](https://go.dev/doc/go1.27) (Go project, 2026); [Goroutine Leak Profiles](https://go.dev/blog/goroutine-leak-profiles) (Saioc, Go blog, 2026); [Lobsters: Goroutine leak profiles](https://lobste.rs/s/dpfpr3/goroutine_leak_profiles) (2026) · dossier: concurrency-async T29-F12; lang-solidity-go T24-F19, practitioner voice; eval-v2-calibration E02-F08

### GO-27 — Parallel subtests and test goroutines: report, never edit existing tests
- **Rule:** In modules declaring go below 1.22, report t.Parallel subtests that capture the table loop variable: in Google's loop-variable trial, 36 of 58 failures were t.Parallel tests not testing what they appeared to (2022–2023). Report `t.FailNow` called from a goroutine the test starts. Existing tests are read-only in the pass: record the finding; do not rewrite the test or raise the `go` directive to fix it.
- **Detect:** The go.mod `go` line; `git grep -n "t.Parallel()" -- '*_test.go'` inside loops over table cases; vet `testinggoroutine`; staticcheck SA2002.
- **Not when:** On go 1.22+ each iteration already has its own variable. Raising the directive makes such tests start testing what they claim, which can turn a green suite red.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** A
- **Source:** [golang/go discussion #56010](https://github.com/golang/go/discussions/56010) (Cox, 2022); [Fixing For Loops in Go 1.22](https://go.dev/blog/loopvar-preview) (Chase, Cox, Go blog, 2023); [cmd/vet](https://pkg.go.dev/cmd/vet) (Go project, go1.27.1); [Staticcheck checks](https://staticcheck.dev/docs/checks/) (Honnef, 2026) · dossier: lang-solidity-go T24-F21, T24-F20, T24-F16; eval-v2-calibration E02-F08

## Evidence limits

- Exact pinned commands exist only for tools whose package path and version the evidence confirms (deadcode in x/tools v0.50.0; gopls v0.23.0). For golangci-lint, staticcheck, errcheck, revive, govulncheck and goleak, take the package path from the tool's own docs at run time and record it.
- No precision or recall figures exist for `deadcode`, U1000, `unusedfunc` or golangci-lint on real projects; vet itself says its reports are heuristics.
- Concurrency numbers come from 171 bugs in 6 Go projects (ASPLOS 2019) and from one company's monorepo (Uber, 2022); the Google loop-variable figures are one company's test suite (2022–2023).
- Engine results are single runs on 2–5 file fixtures on one Windows machine (2026-09); all engine-bug rates are from Java IDE engines (2024).
- No Go-specific study links gocognit or gocyclo scores to defects; every threshold is a tool default.
- Not covered: Go blank imports (`import _ "pkg"`) as side-effect imports (named by the dead-code dossier as the same pattern, unverified); Go mutation testing and native fuzzing; `apidiff` (not executed) and gopls `go_package_api` (listed in source, not executed) for API diffs.
- Open: how many GOOS/GOARCH configurations to iterate by default; how far to trust `go fix` without human review; false-positive and false-negative rates of the goroutineleak profile.
- Versions checked 2026-09: go1.27.1, golangci-lint v2.13.2, staticcheck 2026.2.1, gopls v0.23.0, x/tools v0.50.0, x/sync v0.23.0. Re-verify on upgrade.
