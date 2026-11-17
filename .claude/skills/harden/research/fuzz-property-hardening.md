# Fuzzing and property-based testing as a behaviour-neutral hardening step on a finished project
> Code G206 · slug fuzz-property-hardening · verified 2026-09-23 · counts: verified 13 / corrected 7 / downgraded 0 / dropped 0

Verification method: every cited URL was opened directly on 2026-09-23. HTML pages were read with WebFetch, or with curl plus text extraction where WebFetch did not render the body. All 14 PDFs were downloaded and searched in full text: CCS'21, FSE'20, ICSE'24, OOPSLA'25, SoK'24, USENIX Sec'22, the SOSP'21 ShardStore paper, and the arXiv papers by Klees, Kim, Hatfield-Dodds, Maaz, Vikram, Konstantinou and Klooster. Release dates, versions and platform claims were checked against the GitHub API, npm and PyPI. Venues were checked on arXiv abstract pages and Crossref. WebSearch was not available: the session's 200-search budget was exhausted before verification began. No source had to be replaced by a search result.

## Summary

Generative testing suits a pass that must not change behaviour. It adds harnesses, properties, seed corpora and regression inputs, and never needs to touch production code. Every mainstream tool already turns a failure into a replayable regression artefact:
- **Go** minimises the input and writes it to `testdata/fuzz/<FuzzTest>/<hash>`.
- **proptest** writes to `proptest-regressions/`.
- **Hypothesis** has `@example`, including `@example(...).xfail()`.
- **fast-check** has `seed`/`path` replay and `examples`.
- **libFuzzer and AFL++** produce minimised crash files.

**Caveat:** a failing input committed to Go's `testdata/fuzz` or to `proptest-regressions/` replays automatically, so it breaks the suite until the bug is fixed. See F12.

**Yield on mature code is real but uneven:**
- Projects newly added to OSS-Fuzz usually show an initial burst of 2-3 bug reports a day, then a steady 3-4 a week. 77% of 23k OSS-Fuzz bugs are regressions (Zhu & Böhme, CCS 2021).
- Code under continuous fuzzing saturates. SQLite: "OSS Fuzz no longer finds historical bugs".
- Each additional bug costs exponentially more compute (Böhme & Falk, FSE 2020).
- New harness shapes reopen "already fuzzed" code. Google's AI-generated OSS-Fuzz targets found 26 new vulnerabilities in projects that "already had hundreds of thousands of hours of fuzzing". One was CVE-2024-9143 in OpenSSL, "likely present for two decades".
- The USENIX Sec 2022 "no lifetime reduction" result is a case study of Linux memory-related CVEs only. Its authors add that "fuzzing old code seems to still produce results even for 'extensively tested' targets".

**Property-based testing (PBT):** the best recent quantitative evidence is Ravi & Coblenz (OOPSLA 2025). They mutation-tested 40 Python projects, most under 10k LOC, drawn from a February 2022 corpus.
- Each PBT killed about 50x the mutants of an average unit test. This is correlational, but it still held when controlling for coverage.
- 55% of kills came on the first input, 76% within 20 inputs, 86% within 100 and 96% within 350.
- Exception, inclusion and type-check properties were strongest. The abstract says "over 19 times" more effective than other PBT categories; the conclusion of the same paper says "over 14 times".

**Where to aim:**
- In industrial practice, PBT is dominated by differential/model-based properties (17 of 30 Jane Street interviewees) and round-trip properties (11/30).
- Fuzz targets should be narrow, fast and deterministic: parsers, decoders, validators.

**Triage must count root causes, not "unique crashes".** In one experiment on cxxfilt, 57,142 coverage-unique crashing inputs were fixed by 9 patches. Stack hashing gave about 46 hashes per bug, and about 16% of a bug's hashes were shared with another bug.

**LLM-generated properties and harnesses:**
- In the agentic PBT study (Maaz et al., NeurIPS 2025 DL4Code workshop), about 56% of reports were valid (95% CI 42-70%). This is estimated from a random sample of 50 of the 984 reports, drawn from the top 80% by LLM-graded score. It is not a review of all 984.
- GPT-4, in a 2023/2024 study, wrote correct PBTs for 21% of properties extractable from API docs.
- LLM oracles tend to capture actual rather than expected behaviour.

So LLM-written properties must be derived from specs or docs, and every failure needs independent validation.

**Budgets:** research-grade fuzzer comparisons use at least 10 trials (Klees used 30) of 24 h. That is for comparing fuzzers, not for hardening. For a one-shot pass:
- at least 10-15 min per target (CIFuzz default and minimum is 600 s);
- 15-minute CI campaigns "can still uncover important bugs", with a Klooster preprint on 9 Magma libraries as support;
- stop on a coverage plateau;
- expect long tails: AFL found 0 crashes at 13 h and 39 at 24 h on gif2png.

**Windows / Git Bash (checked against docs, release assets and registries):**
- **Native:** Hypothesis, fast-check (4.x, Node >= 12.17) with @fast-check/vitest, proptest, Go native fuzzing (amd64/arm64), Schemathesis, RESTler, Foundry (Git Bash or WSL), Medusa (win-x64 release asset), and libFuzzer via clang-cl + ASan or MSVC `/fsanitize=fuzzer` (experimental).
- **jazzer.js:** lists Windows x86_64, and its latest release is v4.0.0 of **15 April 2026** (not 2024).
- **Echidna:** ships an x86_64 Windows zip in release v2.3.3, but its README documents only Linux/macOS/Docker.
- **WSL2 needed:** Atheris (Linux/macOS only) and AFL++ (install docs cover Linux/macOS, plus Docker).
- **cargo-fuzz:** its README ("not Windows") and its book ("Windows (thanks to the MSVC AddressSanitizer)") contradict each other.

## Findings

### G206-F01 — Run generative testing as an additive, test-only step
**Rule:**
- The pass may add property tests, fuzz harnesses, seed corpora, dictionaries and regression inputs.
- It must not edit production code or existing tests.
- Each confirmed failure is committed as a NEW regression test or corpus file in a test-only commit.
- The fix goes in a separate, reviewed change outside the hardening pass.

- **Grade:** A · **Verdict:** VERIFIED (added reviewer note on CI-breaking auto-replay; see F12)
- **Rationale:** The official tooling is built for this workflow:
  - Go minimises the failing input, writes it to `testdata/fuzz`, and plain `go test` replays it from then on.
  - OSS-Fuzz asks that fuzz targets be regularly *run* (not necessarily fuzzed) in regression testing.
  - SQLite keeps its historical fuzz cases in a regression harness (fuzzcheck) that runs on every `make test`.

  Generating inputs never modifies the system under test, so the behaviour-neutral constraint holds as long as fixes stay out of the pass. The "additive only" policy is the skill's design choice; the sources support the mechanism, not the policy itself.
- **Evidence:**
  - [Go Fuzzing](https://go.dev/doc/security/fuzz/) — The Go Authors, living doc — official_docs — "The fuzzing engine wrote this failing input to the seed corpus for that fuzz test, and it will now be run by default with `go test`, serving as a regression test once the bug has been fixed." — verified verbatim. The page also shows minimisation, then "Failing input written to testdata/fuzz/FuzzFoo/<hash>".
  - [Ideal integration with OSS-Fuzz](https://google.github.io/oss-fuzz/advanced-topics/ideal-integration/) — Google OSS-Fuzz, living doc — official_docs — "Fuzz targets should be regularly tested (not necessarily fuzzed!) as a part of the project's regression testing process." — verified verbatim.
  - [How SQLite Is Tested](https://www.sqlite.org/testing.html) — SQLite, living doc — engineering_blog — "Historical test cases from AFL, OSS Fuzz, and dbsqlfuzz are collected in a set of database files ... and then rerun by the 'fuzzcheck' utility program whenever one runs 'make test'." — verified verbatim. The page adds: "Fuzzcheck only runs a few thousand 'interesting' cases out of the billions of cases that the various fuzzers have examined."
  - [Hypothesis: replaying failures](https://hypothesis.readthedocs.io/en/latest/tutorial/replaying-failures.html) — Hypothesis maintainers, living doc (PyPI current 6.168.1, uploaded 2026-09-23) — official_docs — "If you want to ensure an input is run every time, use @example." — verified verbatim.
- **Detect:**
  - After the pass, run `git diff --name-only <base>..HEAD`. Every path must sit under a test or fuzz location: tests/, test/, __tests__/, spec/, fuzz/, testdata/fuzz/, proptest-regressions/, corpus/.
  - `git diff --diff-filter=M --name-only <base>..HEAD -- tests/` must be empty, so no existing test was modified.
  - Review harnesses for monkeypatching of production modules.
- **Tools:** git, go test, pytest, cargo test, vitest
- **Applies to:** All languages and all generative techniques: PBT, coverage-guided fuzzing, API schema fuzzing, and smart-contract invariant fuzzing.
- **When not to apply / counterpoints:**
  - Some targets are unreachable without a testability seam, such as an exposed parse function or a build flag. Dropbox notes that its randomized testing was built "on top of our test-friendly architecture". Add such seams outside this pass, or skip the target.
  - Sanitizer and fuzzer builds change compiler flags. That is a build variant, not a source change, but keep it out of the production build configuration.
  - *Reviewer note:* a failing input committed to Go's `testdata/fuzz` or to proptest's `proptest-regressions/` is replayed automatically and makes the suite fail until the fix lands. F12 covers how to commit without breaking CI.
- **Fix risk:** low

### G206-F09 — Fuzz native code only with sanitizers enabled
**Rule:** Fuzz native code (C/C++, unsafe Rust) only with sanitizers enabled: at least ASan, ideally UBSan. The sanitizer is the bug oracle. On Windows:
- **libFuzzer with clang-cl:** requires ASan and is unsupported with /MD.
- **MSVC:** pass `/fsanitize=address` and `/fsanitize=fuzzer` as separate options. The fuzzer option is experimental, available from VS 2022 17.0. ASan is limited to x86/x64.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Without sanitizers most memory corruption does not crash, so the fuzzer never observes it. Microsoft describes ASan as exposing bugs "with **zero** false positives", which makes sanitizer reports high-precision triage input. Microsoft also lists "Fuzzing - building with the libFuzzer wrapper" as one of the three recommended ASan workflows.
- **Evidence:**
  - [libFuzzer](https://llvm.org/docs/LibFuzzer.html) — LLVM Project, living doc — official_docs — "Any build of Clang 9 supports it." "Using libFuzzer on Windows without ASAN is unsupported." "Building fuzzers with the /MD (dynamic runtime library) compile option is unsupported." It also says /INCREMENTAL (or /DEBUG, which implies it) is unsupported. And: "The original authors of libFuzzer have stopped active work on it and switched to working on another fuzzing engine, Centipede. LibFuzzer is still fully supported in that important bugs will get fixed." — verified.
  - [/fsanitize (Enable sanitizers)](https://learn.microsoft.com/en-us/cpp/build/reference/fsanitize) — Microsoft Learn, updated 2026-07-30 — official_docs — "The /fsanitize=fuzzer compiler option enables experimental support for LibFuzzer"; "available starting in Visual Studio 2022 version 17.0"; "doesn't allow comma-separated syntax ... These options must be specified individually." — verified verbatim.
  - [AddressSanitizer (MSVC)](https://learn.microsoft.com/en-us/cpp/sanitizers/asan) — Microsoft Learn, updated 2026-07-09 — official_docs — "zero false positives"; "Support is limited to x86 and x64 on Windows 10 and later"; works with "/MD, /MDd, /MT, and /MTd"; turn off /ZI, /RTC1 and /INCREMENTAL; "AddressSanitizer shouldn't be used in production." The page lists thread/leak/memory/undefined only as possible *future* sanitizers. — verified.
  - [AFL++ fuzzing_in_depth.md](https://github.com/AFLplusplus/AFLplusplus/blob/stable/docs/fuzzing_in_depth.md) — AFL++ team — official_docs — AFL_USE_ASAN / AFL_USE_UBSAN / AFL_USE_MSAN; "Run only one afl-fuzz instance per sanitizer type"; ASan and MSan cannot be combined. — verified.
- **Detect:**
  - clang: `-fsanitize=fuzzer,address,undefined -g -O1`.
  - MSVC: `/fsanitize=address /fsanitize=fuzzer /Zi`.
  - Flag harness build scripts without sanitizers: `rg -n "fsanitize" fuzz/ CMakeLists.txt build.rs Makefile`.
  - On MSVC, flag /MD combined with libFuzzer, and /ZI, /RTC1 or /INCREMENTAL combined with ASan.
- **Tools:** clang/clang-cl, MSVC cl.exe, AFL++, cargo-fuzz (uses `-Z` sanitizer flags on nightly)
- **Applies to:** C, C++, unsafe Rust, and native extensions for Python or Node.
- **When not to apply / counterpoints:**
  - MSVC's ASan page says ASan works with /MD, while LLVM says libFuzzer on Windows is unsupported with /MD. Resolve this by using /MT for fuzz builds. That resolution is the reviewer's; neither vendor states it.
  - MSVC has no UBSan, MSan or TSan, so Windows-only fuzzing misses those bug classes. Use WSL2 with clang for them.
  - Keep ASan in a separate build configuration: Microsoft says it "shouldn't be used in production".
  - libFuzzer is in maintenance mode. It is fine for a hardening pass, but expect no new features.
- **Fix risk:** low

### G206-F10 — A harness must follow the documented rules
**Rule:**
- deterministic for a given input (no rand, no clock, no environment-dependent branches);
- no mutable global state carried between iterations;
- never calls exit;
- tolerates any input;
- no disk I/O after initialisation;
- memory under about 1.5 GB.

Treat crashes that happen instantly or inside harness code as presumed harness bugs until proven otherwise.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Non-determinism makes crashes irreproducible and shrinking meaningless. Crashes inside the target wrapper usually mean the harness miscalled the API; OSS-Fuzz uses this as a false-positive signal when it assesses LLM-generated targets.
- **Evidence:**
  - [What makes a good fuzz target](https://github.com/google/fuzzing/blob/master/docs/good-fuzz-target.md) — Google (google/fuzzing), living doc — official_docs — "A fuzz target needs to be deterministic, i.e. given the same input it should have the same behavior." "Ideally, a fuzz target should not modify a global state because otherwise the fuzz target may be non-deterministic." It also says to avoid rand(), stdout/stderr output, disk reads outside initialisation and any disk writes. RAM "less than 1.5GB" is stated "as of 2019". — verified.
  - [libFuzzer](https://llvm.org/docs/LibFuzzer.html) — LLVM Project — official_docs — "It must not exit() on any input." "It must tolerate any kind of input (empty, huge, malformed, etc)." "Try avoiding cubic or greater complexity, logging, or excessive memory consumption." "It must be as deterministic as possible." — verified.
  - [LLM-based fuzz target generation](https://google.github.io/oss-fuzz/research/llms/target_generation/) — Google OSS-Fuzz, 2023-2024 (linked to an Aug 2023 announcement) — official_docs — "Whether it crashes instantly or within the fuzz target. This often means that there is some miscalled API and the crashes are likely to be false positives." — verified verbatim.
- **Detect:**
  - Scan the harness code: `rg -n "\brand\(|srand\(|time\(|random\.|Math\.random|exit\(|process\.exit|getenv|fopen\(|static [^c].*=" fuzz/`.
  - Replay the corpus twice with `-runs=0` and compare outcomes.
  - Check libFuzzer's `exec/s`: under 10 signals a problem, and about 1000/core is normal.
  - Check each crash's top frame; if it is in the harness file, suspect the harness.
- **Tools:** ripgrep, libFuzzer, go test -fuzz
- **Applies to:** All coverage-guided fuzz harnesses, including Atheris, jazzer.js, cargo-fuzz and Go fuzz tests.
- **When not to apply / counterpoints:**
  - Some real bugs only appear through stateful sequences. There, a deterministic, input-driven command interpreter in the harness is legitimate state.
  - The 1000 exec/s figure is unrealistic for heavyweight targets. SQLite's dbsqlfuzz runs "about 400 test cases per second" per instance, and external fuzz reports have "all but stopped" since it was added.
- **Fix risk:** low

### G206-F11 — Triage by root cause, never by crash count
**Rule:** Triage in four steps:
1. Minimise each crashing input.
2. Reproduce it at least twice.
3. Bucket by symbolised top stack frames, as a first pass only.
4. Confirm distinct ROOT CAUSES by inspection or by fix/bisect.

Never report "unique crash" or stack-hash counts as bug counts. Keep only findings reachable through the public API with inputs that respect documented preconditions.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Coverage-profile and stack-hash deduplication badly overcount bugs, and stack hashes can also merge distinct bugs. REST API fuzzing shows the same effect: unique 500 errors collapse to 3-7x fewer failure points. Checking inputs against realistic usage separates real bugs from harness or precondition violations.
- **Evidence:**
  - [Evaluating Fuzz Testing](https://arxiv.org/abs/1808.09700) — Klees, Ruef, Cooper, Wei, Hicks, CCS 2018 (journal ref confirmed on arXiv) — peer_reviewed — "all 57,142 crashing inputs deemed 'unique' by coverage profiles were addressed by 9 distinct patches". A bug mapping to "say 500 AFL coverage-unique crashes ... would map to about 46 stack hashes, on average", and "roughly 16% of hashes for crashes from one bug were shared by crashes from another bug". — verified in full text. Single target: cxxfilt.
  - [Automated Test Generation for REST APIs: No Time to Rest Yet](https://arxiv.org/abs/2204.08348) — Kim, Xin, Sinha, Orso, ISSTA 2022 — peer_reviewed — "on average, there are 3 to 7 times fewer failure points than errors"; "approximately half of the unique failure points occur in library methods". — verified in full text.
  - [libFuzzer](https://llvm.org/docs/LibFuzzer.html) — LLVM Project — official_docs — `-minimize_crash`: "If 1, minimizes the provided crash input." — verified.
  - [Agentic Property-Based Testing](https://arxiv.org/html/2510.09907) — Maaz, DeVoe, Hatfield-Dodds, Carlini, 2025 (NeurIPS 2025 DL4Code workshop) — preprint/workshop — the agent's triage rubric asks "Can you create a minimal standalone reproduction script?" and "Does the failing input represent realistic usage?", distinguishing standard user inputs from "Extreme edge cases that violate implicit preconditions". — verified verbatim.
- **Detect:**
  - Minimise: `./fuzz_target -minimize_crash=1 -runs=100000 crash-<sha1>`, `afl-tmin -i crash -o crash.min -- ./target @@`, or `cargo fuzz tmin <target> <artifact>`. Go and the PBT libraries shrink automatically.
  - Reproduce, symbolise, then bucket by the top 3 frames.
  - Write a one-line root-cause statement for each bucket. Merge buckets that share a root cause.
  - Record the precondition check: which public entry point reaches the bug, and within what documented input domain.
- **Tools:** libFuzzer -minimize_crash, afl-tmin, cargo fuzz tmin, casr-afl (named in the AFL++ docs), git bisect
- **Applies to:** All fuzzing and PBT failures. Group API-fuzzing failures by failure point.
- **When not to apply / counterpoints:**
  - Precondition filtering can wrongly discard real bugs. Report undocumented preconditions as documentation or validation gaps rather than dropping them.
  - Confirming a root cause by fix/bisect needs a fix, which is outside this pass, so a reasoned root-cause statement is accepted.
  - The Klees numbers come from a single target.
- **Fix risk:** low

### G206-F08 — Seed from existing fixtures and add a dictionary
**Rule:**
- Seed coverage-guided fuzzers from the project's existing test fixtures and sample files, minimised to one input per behaviour.
- Add a token dictionary for text formats.
- Also run at least one campaign from an empty seed, because seeds can change results by orders of magnitude.

- **Grade:** A (seed corpus and dictionary); the empty-seed clause is B · **Verdict:** VERIFIED (scope note added)
- **Rationale:** OSS-Fuzz calls seed-corpus quality a huge factor and says dictionaries can have a dramatic impact. Klees et al. measured large seed effects. The empty-seed clause extrapolates from a fuzzer-*evaluation* recommendation ("evaluate different seeds"), supported by a single fuzzer/target example, so treat it as B.
- **Evidence:**
  - [Ideal integration with OSS-Fuzz](https://google.github.io/oss-fuzz/advanced-topics/ideal-integration/) — Google OSS-Fuzz — official_docs — "The quality of the seed corpus has a huge impact on fuzzing efficiency; the higher the quality, the easier it is for the fuzzer to discover new code paths." "For some input types, a simple dictionary of tokens used by the input language can have a dramatic impact on fuzzing efficiency." — verified verbatim.
  - [Evaluating Fuzz Testing](https://arxiv.org/abs/1808.09700) — Klees et al., CCS 2018 — peer_reviewed — "with an empty seed AFLFast found more than 1000 crashes in nm but with a small non-empty seed it found only 24" — verified verbatim.
  - [AFL++ fuzzing_in_depth.md](https://github.com/AFLplusplus/AFLplusplus/blob/stable/docs/fuzzing_in_depth.md) — AFL++ team — official_docs — afl-cmin removes inputs that do not add new coverage; usage `afl-cmin -i INPUTS -o INPUTS_UNIQUE -- bin/target -someopt @@` — verified.
- **Detect:**
  - Locate fixtures: `find . -type d \( -name fixtures -o -name testdata -o -name samples -o -name corpus \)`.
  - Minimise with `./fuzz_target -merge=1 corpus_min/ raw_fixtures/`, `afl-cmin`, or `cargo fuzz cmin <target>`.
  - Pass the dictionary with `-dict=tokens.dict`.
  - Flag any campaign that ran only from an empty seed, or only from fixtures.
- **Tools:** libFuzzer -merge / -dict, afl-cmin, cargo fuzz cmin
- **Applies to:** Coverage-guided fuzzing of parsers and of file or protocol formats.
- **When not to apply / counterpoints:**
  - A saturated corpus is a poor starting point. The SoK 2024 relays the FuzzBench observation that fuzzers "are barely capable of augmenting it" (verified).
  - Fixtures containing secrets or customer data must not be copied into a committed corpus.
- **Fix risk:** low

### G206-F16 — Choose tools that run in the user's environment
**Rule:** Choose tools that run natively on Windows with Git Bash. Fall back to WSL2 (or Docker) only where official docs exclude Windows. Per-language recipe:
- **Python:** Hypothesis via pytest runs natively. Atheris needs WSL2.
- **TypeScript:** fast-check 4.x with @fast-check/vitest runs natively. jazzer.js lists Windows x86_64.
- **Rust:** proptest runs under `cargo test`. cargo-fuzz needs nightly and its Windows support is contested, so prefer WSL2.
- **C/C++:** clang-cl + ASan + libFuzzer, or MSVC `/fsanitize=address /fsanitize=fuzzer` (experimental), run natively. AFL++ needs WSL2 or Docker.
- **Go:** `go test -fuzz` runs natively, with coverage instrumentation only on amd64/arm64.
- **Solidity:** Foundry needs Git Bash or WSL. Medusa ships a win-x64 binary. Echidna ships an x86_64 Windows zip, but its README does not document it, so fall back to WSL2 or Docker.
- **OpenAPI:** Schemathesis and RESTler run natively.

- **Grade:** A · **Verdict:** CORRECTED
  - **jazzer.js:** the latest release is v4.0.0 of **2026-04-15**, not 2024-04-15 (GitHub API and npm). The previous release was v2.1.0 of 2023-10-23, and the repo was pushed 2026-09-14. The "more than two years without a release / weaker maintenance" claim is wrong.
  - **fast-check:** there is no fast-check v5. npm `latest` is 4.10.2 (2026-09-19) with `engines.node >= 12.17.0`. The Node >= 22.12 requirement belongs to **Vitest 5** as used through @fast-check/vitest, which needs Node >= 20.19 for Vitest 4 and >= 22.12 for Vitest 5.
  - **Echidna:** the release assets show a Windows binary, so its Windows status is not simply "unverified".
- **Rationale:** Each item below was checked against official docs, release assets or registry metadata.
  - **Hypothesis:** PyPI lists Windows.
  - **Go:** the tutorial says its commands work on Windows.
  - **Atheris:** documents Linux and macOS only, and PyPI wheels for 3.1.0 are manylinux x86_64 only.
  - **AFL++:** INSTALL covers Linux, macOS and iOS, plus Docker.
  - **cargo-fuzz:** the README and the rust-fuzz book disagree.
  - **Foundry:** foundryup needs Git Bash or WSL.
  - **RESTler:** runs on Windows or Linux.
  - **jazzer.js:** lists Windows x86_64.
  - **fast-check:** pure JS/TS.
  - **Schemathesis:** PyPI says "OS Independent".
- **Evidence:**
  - [hypothesis on PyPI](https://pypi.org/project/hypothesis/) — Hypothesis maintainers, v6.168.1 uploaded 2026-09-23 — official_docs — classifiers "Microsoft :: Windows", "POSIX", "Unix"; requires Python >= 3.10 — verified through the PyPI JSON API.
  - [Atheris README](https://github.com/google/atheris) — Google — official_docs — "Atheris supports Linux (32- and 64-bit) and Mac OS X, Python versions 3.11-3.14." — verified verbatim. PyPI 3.1.0 wheels are manylinux x86_64 only.
  - [Tutorial: Getting started with fuzzing](https://go.dev/doc/tutorial/fuzz) — The Go Authors — official_docs — "The commands you use will work on Windows too." "Go fuzzing with coverage instrumentation is only available on AMD64 and ARM64 architectures currently." — verified verbatim.
  - [cargo-fuzz README](https://github.com/rust-fuzz/cargo-fuzz) — rust-fuzz (latest 0.13.2, 2026-06-09) — official_docs — "only works on x86-64 and Aarch64, and only on Unix-like operating systems (not Windows). This also needs a nightly compiler" — verified verbatim.
  - [Rust Fuzz Book: setup](https://rust-fuzz.github.io/book/cargo-fuzz/setup.html) — rust-fuzz — official_docs — "this works on x86-64 Linux, x86-64 macOS and Apple-Silicon (aarch64) macOS, and Windows (thanks to the MSVC AddressSanitizer)" — verified verbatim.
  - [Foundry installation](https://getfoundry.sh/introduction/installation) — Foundry — official_docs — "Foundryup requires Git Bash or WSL. PowerShell and Command Prompt are not supported." — verified. The page's wording is "PowerShell", not "Power Shell".
  - [jazzer.js releases](https://github.com/CodeIntelligenceTesting/jazzer.js/releases) — Code Intelligence — official_docs — the README lists "Linux x86_64, macOS x86_64 and arm64, Windows x86_64" and "Node.js LTS versions". Latest release **v4.0.0, 2026-04-15** — CORRECTED against the GitHub API and the npm `@jazzer.js/core` time map.
  - [AFL++ INSTALL.md](https://github.com/AFLplusplus/AFLplusplus/blob/stable/docs/INSTALL.md) — AFL++ team (latest v5.03c, 2026-09-02) — official_docs — instructions for Linux x86, macOS x86_64/arm64 and iOS; no Windows, WSL or Cygwin; "An easy way to install AFL++ with everything compiled is available via docker" — verified.
  - [@fast-check/vitest](https://github.com/dubzzz/fast-check/tree/main/packages/vitest) — fast-check — official_docs — `test.prop([fc.nat(), fc.nat()], { seed: 4242 })`; "You can provide a fixed seed to force a replay by adding this line: fc.configureGlobal({ seed })". Compatibility: Vitest ^4.1.0 || ^5.0.0, fast-check ^3 || ^4, Node >= 20.19 (Vitest 4) or >= 22.12 (Vitest 5) — verified. The fast-check version was checked on npm (4.10.2).
  - [Echidna releases](https://github.com/crytic/echidna/releases) — Trail of Bits (crytic), v2.3.3 of 2026-07-27 — official_docs — assets include `echidna-2.3.3-x86_64-windows.zip`. The README documents only Linux and macOS binaries, Homebrew and Docker — added and verified by the reviewer.
  - [Medusa releases](https://github.com/crytic/medusa/releases) — Trail of Bits (crytic), v1.5.1 of 2026-03-11 — official_docs — assets include `medusa-win-x64.tar.gz`. The README points to "binaries for Windows and Linux" — added and verified by the reviewer.
  - [RESTler README](https://github.com/microsoft/restler-fuzzer) — Microsoft Research — official_docs — "designed to run on 64-bit machines with Windows or Linux. Experimental support for macOS is also enabled." Prerequisites are Python 3.12.8 and .NET 8.0 — verified.
- **Detect:**
  - `uname -s` in Git Bash: MINGW64 means native Windows.
  - `wsl --status`.
  - `clang-cl --version`, and `cl` (look for VS 2022 17.0+).
  - `go version`: amd64 or arm64.
  - `rustup toolchain list`: is nightly present?
  - `node --version`: >= 20.19 for Vitest 4 or >= 22.12 for Vitest 5. fast-check itself needs only >= 12.17.
  - Record per tool whether it ran natively or under WSL2.
- **Tools:** Git Bash, WSL2, Docker, clang-cl / MSVC, go, rustup, pnpm
- **Applies to:** This user's Windows/Git Bash environment. The matrix also helps other Windows developers.
- **When not to apply / counterpoints:**
  - The cargo-fuzz docs contradict each other.
  - The Echidna Windows binary exists but is undocumented and was not run by the reviewer.
  - HypoFuzz's platform support is unverified: PyPI lists no OS classifiers.
  - WSL2 adds file-system overhead when the repository lives on NTFS.
- **Fix risk:** low

### G206-F02 — Classify components before spending budget
**Rule:** Classify each candidate component before spending budget:
- **Never fuzzed or never property-tested:** put the budget here.
- **Already under continuous fuzzing:** a one-shot local pass has low marginal yield unless it brings a new harness shape: new entry points, structure-aware inputs, or new properties.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Expected yield per class:
  - **Newly fuzzed projects:** an initial burst of 2-3 bug reports a day on OSS-Fuzz, then a constant 3-4 reports a week (≈3.5).
  - **Continuously fuzzed code:** saturates. SQLite says OSS-Fuzz no longer finds historical bugs there.
  - **Cost:** each additional bug needs exponentially more machine time.
  - **Aggregate:** OSS-Fuzz reports more than 10,000 vulnerabilities and 36,000 bugs across 1,000 projects as of August 2023. The November 2024 Google blog says "over 11,000 vulnerabilities in the 8 years of the project".
  - **New harnesses:** new harness shapes keep finding old bugs. The AI-generated targets found 26 new vulnerabilities in projects "that already had hundreds of thousands of hours of fuzzing".
- **Evidence:**
  - [Regression Greybox Fuzzing](https://mboehme.github.io/paper/CCS21.pdf) — Zhu & Böhme, CCS 2021 — peer_reviewed — "For a newly added project, there is usually an initial burst of new reports at 2-3 bugs per day. However, after that initial burst ... we still get a constant rate of 3-4 bug reports per week." "77% of 23k bugs are regressions." — verified in full text.
  - [Fuzzing: On the Exponential Cost of Vulnerability Discovery](https://mboehme.github.io/paper/FSE20.EmpiricalLaw.pdf) — Böhme & Falk, ESEC/FSE 2020 — peer_reviewed — "finding linearly more bugs in the same time requires exponentially more machines. For instance, for every new bug we want to find in 24 hours, we might need twice more machines." The data cover "over four CPU years" and "almost three hundred open source programs". — verified verbatim.
  - [How SQLite Is Tested](https://www.sqlite.org/testing.html) — SQLite — engineering_blog — "OSS Fuzz no longer finds historical bugs in SQLite. But it is still running and does occasionally find issues in new development check-ins." — verified verbatim.
  - [OSS-Fuzz documentation home](https://google.github.io/oss-fuzz/) — Google — official_docs — "As of August 2023, OSS-Fuzz has helped identify and fix over 10,000 vulnerabilities and 36,000 bugs across 1,000 projects." — verified verbatim.
  - [Leveling Up Fuzzing: Finding more vulnerabilities with AI](https://security.googleblog.com/2024/11/leveling-up-fuzzing-finding-more.html) — Oliver Chang, Dongge Liu, Jonathan Metzman (Google Open Source Security Team), 20 Nov 2024 — industry_report — "272 C/C++ projects on OSS-Fuzz (up from 160), adding 370k+ lines of new code coverage"; "26 new vulnerabilities in projects on OSS-Fuzz that already had hundreds of thousands of hours of fuzzing"; CVE-2024-9143 "has likely been present for two decades and wouldn't have been discoverable with existing fuzz targets written by humans" — verified verbatim (page body extracted via curl).
- **Detect:**
  - Look for existing generative tests: `rg -l "LLVMFuzzerTestOneInput|func Fuzz[A-Z]|@given\(|fc\.(assert|property)|test\.prop\(|proptest!|fuzz_target!|atheris\.Setup|function invariant_|function testFuzz"`.
  - Also check for `fuzz/`, `testdata/fuzz/` and `.clusterfuzzlite/`, and for an entry under google/oss-fuzz `projects/<name>`.
  - If harnesses exist, replay their corpus once with coverage, then target the uncovered input-handling code.
- **Tools:** ripgrep, libFuzzer -runs=0, go test, coverage tools (llvm-cov, coverage.py, c8/istanbul)
- **Applies to:** All projects. The classification drives budget allocation.
- **When not to apply / counterpoints:** Alexopoulos et al. (USENIX Sec 2022) ran a case study on **Linux memory-related CVEs** and found that "the introduction of fuzzers does not significantly reduce the lifetimes of memory-related vulnerabilities". The same paper also says:
  - "Continues fuzzing finds large numbers of bugs (e.g. >3,000 Linux bugs discovered by syzkaller and fixed)", mostly without CVEs;
  - "fuzzing old code seems to still produce results even for 'extensively tested' targets";
  - "the notion of 'already fuzzed' may be misleading".

  So saturation is harness-specific, not code-specific (all verified in full text). The OSS-Fuzz yield data come from C/C++ open-source libraries.
- **Fix risk:** low

### G206-F03 — Pick targets by leverage
**Rule:** Pick targets in this order:
1. Code that parses or decodes untrusted bytes or strings: parsers, deserializers, decompressors, validators, and protocol or file-format readers.
2. Function pairs that should invert each other.
3. Components that have a simpler reference implementation.
4. State machines with a small command API.

Keep each fuzz target narrow (one format per target), deterministic and fast (about 1000+ exec/s per core).

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Jane Street interviewees relied on a few high-leverage idioms: differential properties (17/30), round-trip properties (11/30) and catastrophic-failure properties (7/30). P9 summed PBT up as "most useful when... you have a really good abstraction with a complicated implementation". Google's fuzz-target guidance says narrower targets are better and gives throughput thresholds.
- **Evidence:**
  - [Property-Based Testing in Practice](https://harrisongoldste.in/papers/icse24-pbt-in-practice.pdf) — Goldstein, Cutler, Dickstein, Pierce, Head, ICSE 2024 (Crossref DOI 10.1145/3597503.3639581) — peer_reviewed — "Differential Properties (17/30)"; "Round-Trip Properties (11/30)"; "Catastrophic Failure Properties (7/30)"; "Differential properties were by far the most widely implemented kind of property"; P9: "[PBT is] most useful when. . . you have a really good abstraction with a complicated implementation." — verified in full text. The data are 30 interviews at one company (OCaml).
  - [What makes a good fuzz target](https://github.com/google/fuzzing/blob/master/docs/good-fuzz-target.md) — Google — official_docs — "Usually, the narrower the target the better. E.g. if your target can parse several data formats, split it into several targets, one per format." About 1000 exec/s per core; under 10 exec/s indicates problems — verified.
  - [In praise of property-based testing](https://increment.com/testing/in-praise-of-property-based-testing/) — David R. MacIver, Increment issue 10, Aug 2019 — engineering_blog — "This is often a very useful test to write with property-based testing, as it's easy to implement and often flushes out a surprising number of errors." Examples: dateutil parsed 0005-01-01T00:00:05 as 0001-05-01T00:00:05, "swapping the year and the month"; Argon2 "if the hash length is greater than 512, it hits an internal fixed-size buffer in the underlying C library" and the hash then silently fails to verify — verified verbatim.
- **Detect:**
  - **Parsers and decoders:** `rg -n "def (parse|loads|decode|deserialize|from_(json|bytes|str))|JSON\.parse\(|serde_json::from_|json\.Unmarshal\(|\bparse[A-Z]\w*\("`.
  - **Inverse pairs:** `rg -n "(encode|serialize|dumps|to_\w+)\b"`, matched against their inverses.
  - **HTTP handlers and validators:** check route and schema-validation modules.
  - For each candidate, ask whether a property can be stated without re-implementing the function. If not, prefer a pure does-not-crash target.
- **Tools:** ripgrep, ast-grep
- **Applies to:** Any language. Numeric and accounting code is a good target, but not the only one (see F04).
- **When not to apply / counterpoints:**
  - Round-trip properties miss bugs that are symmetric in both directions.
  - Does-not-crash properties "provide less confidence in code quality (there can still be logical errors, even if the code does not crash)" (Goldstein et al., verified).
  - Targets with heavy I/O or global state make poor fuzz targets without a seam.
- **Fix risk:** low

### G206-F04 — Write the first properties in a fixed order
**Rule:** Write the first properties in a finished project in this order:
1. **No unexpected exceptions:** only documented exception types, for any input in the documented domain.
2. **Round-trip.**
3. **Inclusion/membership and type/shape invariants.**
4. **Richer semantic properties,** only after the first three.

For Python, `hypothesis write` (the ghostwriter) can draft these; treat its output as a starting point.

- **Grade:** B · **Verdict:** VERIFIED (counterpoint wording tightened)
- **Rationale:** Ravi & Coblenz mutation-tested 40 Python projects and found that each PBT killed about 50x as many mutants as the average unit test. Exception, inclusion and type-check tests were the most effective categories. Hypothesis ships ghostwriters for fuzz, roundtrip, idempotent, equivalent and binary-operation properties.
- **Evidence:**
  - [An Empirical Evaluation of Property-Based Testing in Python](https://cseweb.ucsd.edu/~mcoblenz/assets/pdf/OOPSLA_2025_PBT.pdf) — Savitha Ravi, Michael Coblenz, OOPSLA 2025 (PACMPL 9 OOPSLA2, Art. 412, Oct 2025) — peer_reviewed — "each property-based test finds about 50 times as many mutations as the average unit test". The abstract says exception, inclusion and type-check tests "are over 19 times more effective"; the conclusion says "over 14 times". The dataset is 40 projects with 350 PBTs and 21,222 unit tests, using 100 randomly sampled mutants per project. Project sizes range from 531 to 55,189 LOC, most under 10k. The corpus is the Boa February 2022 snapshot. — all verified in full text.
  - [Hypothesis integrations reference (ghostwriter)](https://hypothesis.readthedocs.io/en/latest/reference/integrations.html) — Hypothesis maintainers — official_docs — "Ghostwritten tests are intended as a starting point for human authorship". CLI options: `--roundtrip`, `--equivalent`, `--errors-equivalent`, `--idempotent`, `--binary-op` — verified.
  - [In praise of property-based testing](https://increment.com/testing/in-praise-of-property-based-testing/) — David R. MacIver, 2019 — engineering_blog — the round-trip test is "easy and ubiquitous enough that it's worth knowing about from the start" — verified verbatim.
- **Detect:**
  - For each F03 target, check for an existing property test: `rg -n "@given\(|test\.prop\(|fc\.assert\(|proptest!"`.
  - Draft with `hypothesis write --roundtrip mypkg.encode mypkg.decode` or `hypothesis write mypkg.module`.
  - Allowed exceptions must come from the docs or docstrings, not from whatever the code raises today.
- **Tools:** Hypothesis ghostwriter, fast-check, proptest
- **Applies to:** Libraries and application modules with pure or near-pure functions. The strongest evidence is for Python.
- **When not to apply / counterpoints:**
  - This is one study of 40 projects from a 2022 corpus. The authors themselves say "we cannot infer causation from our corpus study, which did not involve random assignment". They report that the advantage held "when controlling for overall code coverage".
  - 55% of kills came on the first input. The reading that part of the effect may come from PBTs being better-written tests is the researcher's inference, not the authors' claim.
  - The study does not measure authoring cost. It partly supersedes dossier T13's "thin evidence" claim, but only for mutation kills, not for real-bug yield.
  - It contradicts G103's restriction of invariant and fuzz tests to numeric code.
- **Fix risk:** low

### G206-F05 — Prefer differential properties when a simpler counterpart exists
**Rule:** For complex components with a simpler trustworthy counterpart, prefer differential (model-based) properties over hand-derived expected values.
- Useful oracles: a naive or slow implementation, a previous version, an uncached path, or a standard or reference library.
- Generate operation sequences and assert that the optimised and reference implementations agree.

- **Grade:** B · **Verdict:** CORRECTED (the AWS claim is re-attributed: the 16 issues came from PBT *plus* stateless model checking, not PBT alone; the full SOSP'21 paper was substituted for the abstract page)
- **Rationale:** Differential properties were the most common idiom among experienced industrial users.
  - **AWS S3 ShardStore:** checked against executable reference models with property-based testing for functional correctness and crash consistency, and with stateless model checking for concurrency. Together these checks "prevented 16 issues from reaching production". Property definitions and harnesses make up 12% of the ShardStore code base.
  - **Dropbox:** runs tens of millions of seeded randomized runs nightly, with deterministic replay and automatic shrinking.
- **Evidence:**
  - [Property-Based Testing in Practice](https://harrisongoldste.in/papers/icse24-pbt-in-practice.pdf) — Goldstein et al., ICSE 2024 — peer_reviewed — "Differential properties were by far the most widely implemented kind of property" (17/30). One participant found PBT challenging "because a good reference implementation was not available (P1)" — verified verbatim.
  - [Using Lightweight Formal Methods to Validate a Key-Value Storage Node in Amazon S3 (full paper PDF)](https://cdn.amazon.science/77/5e/4a7c238f4ce890efdc325df83263/using-lightweight-formal-methods-to-validate-a-key-value-storage-node-in-amazon-s3-2.pdf) — Bornholt et al. (Amazon), SOSP 2021 — peer_reviewed — "For functional correctness, we apply property-based testing to check that the implementation and model agree on random sequences of API operations ... For concurrency, we apply stateless model checking"; "These checks have prevented 16 issues from reaching production, including subtle crash-consistency and concurrency issues that evaded traditional testing methods"; "the combined property definitions and test harnesses comprise 12% of the ShardStore code base". Uses `#[proptest]`. — verified in full text. The [abstract page](https://www.amazon.science/publications/using-lightweight-formal-methods-to-validate-a-key-value-storage-node-in-amazon-s3) does not mention property-based testing.
  - [Testing sync at Dropbox](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine) — Isaac Goldberg (Dropbox), 20 Apr 2020 — engineering_blog — "Every night we run tens of millions of randomized test runs. In general, they are 100% green on the latest master." A failing seed is "guaranteed to fail again", and CanopyCheck minimises inputs — verified verbatim.
- **Detect:**
  - Look for oracle pairs: `rg -n "(naive|reference|slow|legacy|_v1\b|_old\b|fast_|optimized|cached|uncached)"`, or functions duplicated between a hot path and a fallback.
  - Check manually that the oracle does not call the implementation under test.
- **Tools:** Hypothesis stateful testing, fast-check model-based testing (fc.commands), proptest (proptest-state-machine)
- **Applies to:** Data structures, caches, query engines, accounting and ledger logic, sync and replication, and anything with an optimised path.
- **When not to apply / counterpoints:**
  - If the reference shares code or assumptions with the implementation, both can be wrong the same way.
  - Writing a new reference is new code, possibly too much for a hardening pass.
  - Jane Street users called handwritten generators "tedious" (6/30) or "high-effort" (7/30) (verified).
  - Concurrency bugs at AWS were found by stateless model checking, not by PBT.
- **Fix risk:** low

### G206-F06 — Use two settings profiles
**Rule:** Keep two settings profiles:
- **Hunting run (one-shot, local):** about 1000 examples per property, deadlines off, statistics printed.
- **Committed tests:** library defaults or lower (Hypothesis 100, fast-check 100, proptest 256, Foundry 256), with deterministic seeding in CI.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Mutant kills saturate quickly: 76% within 20 inputs, 86% within 100 and 96% within 350. That supports about 1000 examples for a hunting run and defaults in CI. Hypothesis's documented defaults on CI are `deadline=None` and `derandomize=True`. The reason behind them (avoiding timing and randomness flakiness) is an interpretation, not a quote. Schemathesis documents 1000 examples for thorough runs.
- **Evidence:**
  - [An Empirical Evaluation of Property-Based Testing in Python](https://cseweb.ucsd.edu/~mcoblenz/assets/pdf/OOPSLA_2025_PBT.pdf) — Ravi & Coblenz, OOPSLA 2025 — peer_reviewed — "Over half of the mutations (55%) were found with a single input to a PBT. 76% of mutations were found within the first 20 inputs to a PBT function, 86% within the first 100 inputs, and 96% within the first 350 inputs." — verified verbatim. The sweep was capped at 500 inputs, and 2 projects were excluded for timeouts.
  - [Hypothesis API reference (settings)](https://hypothesis.readthedocs.io/en/latest/reference/api.html) — Hypothesis maintainers — official_docs — "The default max examples is 100"; "The default deadline is 200 milliseconds. If running on CI, the default is None instead."; for derandomize, "The default is False. If running on CI, the default is True instead." — verified verbatim.
  - [fast-check Parameters](https://fast-check.dev/docs/api/interfaces/Parameters/) — fast-check (N. Dubien), current 4.x — official_docs — numRuns "100 by default"; seed "Date.now() by default"; timeout and interruptAfterTimeLimit "disabled by default" — verified. The version is 4.x, not "v5.x".
  - [proptest Config](https://docs.rs/proptest/latest/proptest/test_runner/struct.Config.html) — proptest 1.11.0 — official_docs — "The default is 256, which can be overridden by setting the PROPTEST_CASES environment variable." — verified verbatim.
  - [Schemathesis: Optimizing for Maximum Bug Detection](https://schemathesis.readthedocs.io/en/stable/guides/config-optimization/) — Schemathesis (current 4.28.0) — official_docs — default 100; `--max-examples 1000` recommended; "Higher example counts improve bug detection and coverage."; `--max-time SECONDS` is also available — verified.
- **Detect:**
  - **Python:** `pytest tests/props --hypothesis-show-statistics` with `settings(max_examples=1000, deadline=None)` from an uncommitted local profile.
  - **Rust:** `PROPTEST_CASES=1000 cargo test`.
  - **TypeScript:** `fc.configureGlobal({ numRuns: 1000 })` in a local setup file.
  - In committed tests, flag `rg -n "max_examples\s*=\s*\d{4,}|numRuns:\s*\d{4,}"`, and flag suppressed deadlines or health checks that have no justification.
- **Tools:** pytest + Hypothesis, fast-check / @fast-check/vitest, proptest, Foundry
- **Applies to:** All PBT frameworks.
- **When not to apply / counterpoints:** The saturation figures describe mutants, which are mostly shallow. Real bugs that need rare structured inputs can need far more examples. For those, use coverage-guided back ends: HypoFuzz, or Hypothesis's `fuzz_one_input` (documented as "Run the test as a fuzz target, driven with the buffer of bytes") driven by an external fuzzer.
- **Fix risk:** low

### G206-F07 — Coverage-guided fuzzing budget for a one-shot pass
**Rule:**
- Give each target at least 10-15 min of wall-clock time, preferably across several parallel jobs or independent runs with different seeds.
- Stop a target when coverage plateaus: no new coverage or corpus entries for a long stretch, or a flattened Good-Turing estimate f1/n.
- Do not scale CPU expecting proportionally more bugs.
- Record the budget and the plateau evidence.

- **Grade:** B · **Verdict:** CORRECTED
  - Klooster et al.'s "~63%" effort reduction applies to three of the nine libraries studied (more than 40% for six). It is not a general figure.
  - The wording is aligned to the source ("important bugs" / "sophisticated bugs").
  - The full Klooster PDF was read, not just the abstract.
- **Rationale:** Evidence for short budgets:
  - CIFuzz defaults to 600 s and calls that the minimum.
  - A 15-minute CI campaign "can still uncover important bugs, but may also reduce its capability to detect sophisticated bugs". In that study, at least one bug was reached, triggered and detected within 15 min for half of the 9 Magma libraries.
  - REST API tools often reached their highest coverage within 10 minutes.

  Evidence against trusting short budgets:
  - Research methodology uses at least 10 trials of 24 h, because single short runs mislead: AFL found 0 crashes in gif2png at 13 h and 39 at 24 h.
  - Bug discovery has an exponential cost.

  A hardening pass is not a fuzzer comparison, but several independent runs still reduce variance.
- **Evidence:**
  - [Continuous Integration (CIFuzz)](https://google.github.io/oss-fuzz/getting-started/continuous-integration/) — Google OSS-Fuzz — official_docs — fuzz-seconds: "The default is 600 seconds."; "This value should be at minimum 600 seconds and scale with project size." — verified verbatim.
  - [Effectiveness and Scalability of Fuzzing Techniques in CI/CD Pipelines](https://arxiv.org/abs/2205.14964) — Klooster, Turkmen, Broenink, ten Hove, Böhme, arXiv v2 of 7 Jun 2022, no venue listed — preprint — "A shorter fuzzing campaign such as 15 minutes (as opposed to the wisdom of 24 hours in the field) facilitates a faster pipeline and can still uncover important bugs, but may also reduce its capability to detect sophisticated bugs"; effort "can be reduced by ~63% in three of the nine libraries we analyzed (>40% for six libraries)" — verified in full text. The benchmark is Magma (9 C/C++ libraries).
  - [Evaluating Fuzz Testing](https://arxiv.org/abs/1808.09700) — Klees et al., CCS 2018 — peer_reviewed — "AFL found no crashes in gif2png after 13 hours, while AFLFast had found nearly 40. But after 24 hours AFL had found 39 and AFLFast had found 52."; "we generally measured at least 30 trials per configuration" of 24 h — verified.
  - [SoK: Prudent Evaluation Practices for Fuzzing](https://mschloegel.me/paper/schloegel2024sokfuzzevals.pdf) — Schloegel et al. (CISPA), IEEE S&P 2024 (Crossref DOI 10.1109/SP54263.2024.00137) — peer_reviewed — "a statistical evaluation should use a sufficient number of trials, ideally 10 or more"; "55% (83) of the papers use fewer than 10 trials in at least one experiment"; "63% (94) conduct no statistical test at all" — verified verbatim.
  - [The Fuzzing Book: When To Stop Fuzzing](https://www.fuzzingbook.org/html/WhenToStopFuzzing.html) — Zeller, Gopinath, Böhme, Fraser, Holler; chapter last changed 2024-11-09 — book (open online) — Good-Turing: the discovery probability is estimated "as the number f1 of trigrams observed exactly once divided by the total number n", i.e. p0 = f1/n, applied to fuzzing — verified.
  - [AFL++ fuzzing_in_depth.md](https://github.com/AFLplusplus/AFLplusplus/blob/stable/docs/fuzzing_in_depth.md) — AFL++ team — official_docs — "if no new path is found for a long time (e.g., for a day or a week), then you can expect that your fuzzing won't be fruitful anymore" — verified.
- **Detect:**
  - **libFuzzer:** `./fuzz_target corpus/ -max_total_time=900 -jobs=4`. Watch the `cov:` and `ft:` counters.
  - **Go:** `go test -run=^$ -fuzz=^FuzzParse$ -fuzztime=15m ./pkg/parser`.
  - **AFL++:** `afl-plot` and `afl-whatsup` ("last new find").
  - In the report, flag targets fuzzed for under 10 min or with no plateau evidence.
- **Tools:** libFuzzer, AFL++ (afl-plot, afl-whatsup), go test -fuzz, cargo fuzz run
- **Applies to:** Coverage-guided fuzzing of native code, Go and Rust. The same logic applies to API fuzzers.
- **When not to apply / counterpoints:**
  - Research methodology (24 h, 10-30 trials) and CI practice (10-15 min) conflict.
  - The CI numbers are tuned for incremental changes. A never-fuzzed finished project may deserve hours on its top 1-3 targets.
  - Klooster et al. is an unreviewed preprint on 9 C/C++ libraries.
- **Fix risk:** low

### G206-F12 — Crash-to-regression protocol
**Rule:**
- Encode each confirmed, minimised failure as a NEW test in the project's native replay mechanism.
- So the pass keeps CI green, commit it as expected-to-fail, with an issue link:
  - pytest: `xfail(strict=True, raises=...)`;
  - Hypothesis: `@example(...).xfail(raises=...)`;
  - Vitest: `test.fails`;
  - Go: `t.Skip` with a reason.
- The fix commit later removes the marker.
- Never rely on tool caches as the regression store.

- **Grade:** B · **Verdict:** VERIFIED (reviewer additions: Hypothesis `example.xfail`, and the auto-replay conflict below)
- **Rationale:** Each tool documents its own persistence mechanism:
  - **Go:** persists minimised inputs to testdata/fuzz.
  - **proptest:** persists to proptest-regressions/ and recommends committing them.
  - **Hypothesis:** says to use @example for permanent cases, and that its database and reproduce_failure blobs are not stable across versions. It also offers `@example(...).xfail()`, "similarly to pytest.mark.xfail(strict=True)".
  - **fast-check:** supports seed/path replay and `examples`.
  - **Schemathesis:** ships a curl reproducer.
  - **Foundry:** prints the failing call sequence.

  A strict xfail turns into a suite failure once the bug is fixed, which forces the marker to be removed.
- **Evidence:**
  - [Hypothesis: replaying failures](https://hypothesis.readthedocs.io/en/latest/tutorial/replaying-failures.html) — Hypothesis maintainers — official_docs — the database: "Hypothesis may invalidate it when upgrading (because e.g. the internal format may have changed)"; @reproduce_failure: "the binary blob is not stable across Hypothesis versions, so you should not leave this decorator on your tests permanently." — verified verbatim.
  - [Hypothesis API reference (example.xfail)](https://hypothesis.readthedocs.io/en/latest/reference/api.html) — Hypothesis maintainers — official_docs — `example.xfail(condition=True, *, reason='', raises=BaseException)`: "Mark this example as an expected failure, similarly to pytest.mark.xfail(strict=True)." — added and verified by the reviewer.
  - [Failure persistence](https://proptest-rs.github.io/proptest/proptest/failure-persistence.html) — proptest book — official_docs — "It is recommended to check these files in to your source control so that other test runners (e.g., collaborators or a CI system) also replay these cases." — verified verbatim.
  - [Read test reports (fast-check)](https://fast-check.dev/docs/tutorials/quick-start/read-test-reports/) — fast-check — official_docs — `{ seed: -1819918769, path: '0:...:3', endOnFailure: true }`; path lets you "start the execution directly on the reduced counterexample". The page says nothing about seed stability across versions — verified.
  - [How to use skip and xfail](https://docs.pytest.org/en/stable/how-to/skipping.html) — pytest — official_docs — strict=True "will make XPASS ('unexpectedly passing') results from this test to fail the test suite"; with `raises`, a test is "reported as a regular failure if it fails with an exception not mentioned in raises" — verified verbatim.
  - [Vitest test API](https://vitest.dev/api/test) — Vitest, current docs — official_docs — "Use test.fails to indicate that an assertion will fail explicitly." — verified verbatim.
  - [Schemathesis documentation](https://schemathesis.readthedocs.io/en/stable/) — Schemathesis — official_docs — "Every finding ships with a minimal curl reproducer." — verified verbatim.
- **Detect:**
  - **Go:** commit testdata/fuzz/FuzzX/<hash> (but see the counterpoint).
  - **proptest:** commit proptest-regressions/.
  - **Hypothesis:** use `@example(<minimal>).xfail(raises=...)`. `rg -n "@reproduce_failure"` must return 0 hits.
  - **fast-check:** add the minimal counterexample to `examples:` or write an explicit unit test.
  - **libFuzzer/AFL++:** add the minimised file to a replay corpus.
  - **Schemathesis:** turn the curl reproducer into an API test.
  - **Foundry:** turn the `-vvvv` sequence into a concrete test.
  - Each new test must fail on current code for the documented reason.
- **Tools:** go test, proptest, Hypothesis, fast-check, libFuzzer, pytest xfail, Vitest test.fails, forge test -vvvv
- **Applies to:** All languages. This is the core deliverable of the pass.
- **When not to apply / counterpoints:**
  - *Reviewer note, not sourced:* Go replays every file in `testdata/fuzz` on plain `go test`, and proptest replays every `proptest-regressions` entry. Committing a still-failing input there makes the suite fail until the fix lands, and neither has a per-input xfail. Options: guard the whole fuzz test with `t.Skip` and an issue link, keep the reproducer in a quarantine path outside the auto-replay directory until the fix commit, or ship the reproducer only with the fix.
  - The same applies to the property itself. A property that has found a bug will keep failing, non-deterministically, until the fix.
  - Some teams forbid merging known-failing tests even when marked. That is compatible if the reproducer file is committed with an issue.
  - The claim that fast-check seeds are unstable across versions remains an unverified inference.
- **Fix risk:** low

### G206-F13 — Prove the generator exercises the code
**Rule:** Before trusting a green property or invariant run, prove that the generator exercises the code:
- Check the distribution with Hypothesis `--hypothesis-show-statistics`/`event()`, or with a coverage report of the property run.
- Keep health checks on.
- Prefer bounding over rejection: Foundry `bound()` instead of `vm.assume()`, and strategy construction instead of `.filter()`/`assume()`.
- Inject one deliberate bug to confirm the property fails.

- **Grade:** B · **Verdict:** CORRECTED. Foundry's docs say "Use bound() instead of vm.assume()" and "Log call counts – Verify all functions are being exercised". They do **not** say that assume-filtering yields vacuous invariant tests; that is an inference. The detection step that relied on "per-handler revert counts in the output" is replaced with the documented call-count logging.
- **Rationale:**
  - More than a third of Jane Street users (11/30) said they did not think as hard as they should about test effectiveness. One missed a published bug because the generator was "not generating the case that [they] had in mind" (P19).
  - Hypothesis ships health checks for excessive filtering.
  - Foundry's invariant best practices recommend bounding and call-count logging.
- **Evidence:**
  - [Property-Based Testing in Practice](https://harrisongoldste.in/papers/icse24-pbt-in-practice.pdf) — Goldstein et al., ICSE 2024 — peer_reviewed — "11 of them--more than a third--said they did not think as hard as they should about testing effectiveness". Validation techniques used: Mutation Testing (7/30), Example Inspection (8/30), Code Coverage (2/30) — verified verbatim.
  - [Hypothesis API reference](https://hypothesis.readthedocs.io/en/latest/reference/api.html) — Hypothesis maintainers — official_docs — filter_too_much: "Check for when the test is filtering out too many test cases, either through use of assume() or .filter()". event() statistics are shown via `--hypothesis-show-statistics` — verified.
  - [Invariant testing](https://getfoundry.sh/forge/invariant-testing) — Foundry — official_docs — best-practices table: "Bound inputs: Use bound() instead of vm.assume()"; "Log call counts: Verify all functions are being exercised". Defaults: `runs = 256`, `depth = 100`, `fail_on_revert = false` — verified. The word "vacuous" does not appear.
- **Detect:**
  - `rg -n "suppress_health_check|HealthCheck\.(filter_too_much|too_slow)|\.filter\(|assume\(|vm\.assume\("` in test code.
  - Run `pytest --hypothesis-show-statistics`.
  - Run coverage over the property tests only and confirm the target branches are hit.
  - For Foundry invariants with `fail_on_revert=false`, add ghost call counters per handler, as the docs advise, and check that every handler makes successful calls.
  - Sanity mutation: flip one comparison in a throwaway branch, confirm the property fails, then discard the branch.
- **Tools:** Hypothesis statistics, coverage.py / c8 / llvm-cov, Foundry forge test, manual mutant in a throwaway branch
- **Applies to:** All PBT and invariant fuzzing.
- **When not to apply / counterpoints:**
  - Coverage does not prove the assertions are strong.
  - Mutation testing at scale is expensive; Ravi & Coblenz sampled only 100 mutants per project.
  - The sanity mutant must live in a throwaway branch.
- **Fix risk:** low

### G206-F14 — Run schema fuzzers only against disposable instances
**Rule:** Run OpenAPI/GraphQL schema fuzzers (Schemathesis, RESTler) only against a disposable local or staging instance, never production.
- Start with RESTler test (smoke) mode or a short Schemathesis run.
- Triage 5xx and crash-class failures first.
- Expect most other findings to be schema/implementation mismatches.
- Record schema gaps separately from code bugs.

- **Grade:** B · **Verdict:** CORRECTED
  - Schemathesis's rank in Kim et al. is **sixth of ten** overall on average unique 500 errors (9.5), i.e. fifth among the nine black-box tools. The researcher's "fifth" did not say which ranking.
  - Kim et al. tested Schemathesis **v3.7.1**; the current release is 4.28.0, so the ranking may be outdated.
  - The Schemathesis paper's venue is confirmed as the ICSE 2022 Companion Proceedings.
- **Rationale:** Schema-derived fuzzers find real defects. In its authors' evaluation, Schemathesis found 1.4-4.5x more unique defects than the second-best fuzzer per target, and it was the only one to find defects in 4 targets. On the other hand:
  - "almost 99%" of 1,000+ apis.guru specs contain some mismatch;
  - the best tool (white-box EvoMasterWB) reached under 53% line coverage in an hour;
  - "in many cases, the tools already achieved their highest level of code coverage in 10 minutes";
  - RESTler warns that aggressive fuzzing can cause outages and backend corruption.
- **Evidence:**
  - [Deriving Semantics-Aware Fuzzers from Web API Schemas](https://arxiv.org/abs/2112.10328) — Hatfield-Dodds & Dygalo, arXiv Dec 2021; published in the ICSE 2022 Companion Proceedings (Crossref DOI 10.1145/3510454.3528637) — peer_reviewed (industry/companion track) — "running eight fuzzers against sixteen real-world open source web services"; "Schemathesis finds 1.4 to 4.5 more unique defects than the respectively second-best fuzzer for each target, and is the only fuzzer to find defects in four targets" — verified in full text. Author-run evaluation.
  - [Automated Test Generation for REST APIs: No Time to Rest Yet](https://arxiv.org/abs/2204.08348) — Kim, Xin, Sinha, Orso, ISSTA 2022 — peer_reviewed — 10 tools, 20 services, 1 h x 10 trials plus one 24 h run. "In one hour, the best-performing tool (EvoMasterWB) achieved less than 53% line coverage". Table 3 average unique 500s: EvoMasterWB 33.3, Dredd 18.5, APIFuzzer 16.4, RESTler 15.1, Tcases 14.2, Schemathesis 9.5. Schemathesis line coverage is 43.01%, second among black-box tools after EvoMasterBB's 45.41%. Also: "almost 99%" of specs contain some mismatch — verified in full text. The Schemathesis version evaluated was 3.7.1.
  - [RESTler README](https://github.com/microsoft/restler-fuzzer) — Microsoft Research — official_docs — "This type of fuzzing is more aggressive and may create outages in the service under test if the service is poorly implemented (e.g., fuzzing might create resource leaks, perf degradation, backend corruptions, etc.)". Test mode is "also called a smoketest" — verified verbatim.
  - [Schemathesis: Triaging Failures](https://schemathesis.readthedocs.io/en/stable/guides/triage/) — Schemathesis — official_docs — "These are gaps between what your application does and what its schema says it does — usually a one-line annotation to fix."; server errors are "Fewest and most severe"; "Record it in a baseline rather than disabling the checks." — verified.
- **Detect:**
  - **Schemathesis:** `uvx schemathesis run http://localhost:8080/openapi.json --report junit`, plus `--max-examples 1000` or `--max-time <s>`.
  - **RESTler:** compile, then test (smoke), then fuzz-lean, then fuzz.
  - Confirm the target host and credentials are not production, and that the database is disposable.
  - Classify results into three groups: 5xx/crash, schema conformance, and auth/setup noise.
- **Tools:** Schemathesis, RESTler, EvoMaster (white-box)
- **Applies to:** HTTP services with an OpenAPI or GraphQL schema.
- **When not to apply / counterpoints:**
  - The independent study (Kim et al.) and the author-run one disagree on ranking, and both are 2021-2022 comparisons with older tool versions.
  - Fixing the schema is a documentation change; fixing the handler changes behaviour. Keep both out of this pass.
- **Fix risk:** low

### G206-F15 — Solidity: fuzz and invariant tests, cross-checked
**Rule:** For Solidity:
- Add Foundry stateless fuzz tests and handler-based invariant tests. Size the hunting run above the defaults (fuzz 256 runs; invariant runs 256, depth 100).
- Constrain inputs with `bound()`, not `vm.assume()`.
- Cross-check with Echidna (testLimit 50,000, seqLen 100) or Medusa.
- Spend most of the effort on stating the invariants.

- **Grade:** B · **Verdict:** CORRECTED. Trail of Bits did **not** "break formally verified invariants". Their post shows Echidna *rediscovering two bugs originally found with formal verification tools*: the MakerDAO DAI fundamental invariant and a Compound V3 Comet liquidation issue. Both were found "in a matter of minutes, running on a typical development laptop"; the DAI invariant fell in "less than a minute".
- **Rationale:** The Trail of Bits experiment suggests a fuzzer with a well-stated invariant can rediscover bugs that formal tools found. Their stated lesson is "Writing good invariants is 80% of the work". Trail of Bits builds Echidna and Medusa, so this is a vendor opinion. Foundry documents the handler pattern and its defaults.
- **Evidence:**
  - [Invariant testing](https://getfoundry.sh/forge/invariant-testing) — Foundry — official_docs — `[invariant] runs = 256, depth = 100, fail_on_revert = false`; "Handlers wrap target contracts to constrain inputs and track state"; replay with `forge test --match-test invariant_Solvency -vvvv` — verified.
  - [Fuzz testing](https://getfoundry.sh/forge/fuzz-testing) — Foundry — official_docs — "Forge generates random inputs and runs the test multiple times (256 by default)" — verified verbatim. The page shows both `vm.assume()` and `bound()`.
  - [Echidna default.yaml](https://github.com/crytic/echidna/blob/master/tests/solidity/basic/default.yaml) — Trail of Bits (crytic) — official_docs — `testLimit: 50000`, `seqLen: 100`, `shrinkLimit: 5000`, `corpusDir: null` ("by default is disabled"), workers default "the clamp of the number cores between 1 and 4" — verified in the raw file.
  - [Why fuzzing over formal verification?](https://blog.trailofbits.com/2024/03/22/why-fuzzing-over-formal-verification/) — Josselin Feist, Tarun Bansal, Gustavo Grieco (Trail of Bits), 22 Mar 2024 — engineering_blog — "Our fuzzer found both bugs in a matter of minutes, running on a typical development laptop"; "Echidna took less than a minute on an i5 12-GB RAM Linux machine to violate the invariant"; "Writing good invariants is 80% of the work; the tool used to check/verify them is important but secondary." — verified verbatim (characterisation corrected).
  - [Medusa README](https://github.com/crytic/medusa) — Trail of Bits (crytic), v1.5.1 — official_docs — "cross-platform go-ethereum-based smart contract fuzzer inspired by Echidna"; parallel workers; coverage-guided; AGPLv3; binaries for Windows and Linux — verified.
- **Detect:**
  - `rg -n "function (testFuzz|invariant)_|targetContract\(|vm\.assume\(" test/`.
  - Read foundry.toml `[fuzz]`/`[invariant]`.
  - Raise runs and depth in a local profile for the hunting run.
  - Log per-handler call counts.
  - Keep an Echidna `corpusDir` so the corpus can be replayed.
- **Tools:** Foundry forge, Echidna, Medusa
- **Applies to:** Solidity/EVM smart contracts.
- **When not to apply / counterpoints:**
  - `fail_on_revert=false` can hide handlers that almost always revert.
  - Invariants derived from the current code encode current behaviour (see F18).
  - The "80%" figure is practitioner opinion from a fuzzing-tool vendor.
  - The two rediscovered bugs were chosen by the authors, so the experiment is n=2.
- **Fix risk:** low

### G206-F17 — Aim the first harnesses at churn
**Rule:** Point the first harnesses at the most recently and most frequently changed input-handling modules. Do not treat old, stable code as clean: if it has never been fuzzed, it is "new" to fuzzing.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - 77% of 23k OSS-Fuzz bugs were regressions, meaning a bug-introducing commit could be identified.
  - The chance that a report is a regression rises from 20% for a project's first bug to 92% after a few hundred reports.
  - The USENIX 2022 study shows fuzzers "keep discovering very old vulnerabilities for years".

  So churn is a good prioritiser, but only after an initial never-fuzzed sweep.
- **Evidence:**
  - [Regression Greybox Fuzzing](https://mboehme.github.io/paper/CCS21.pdf) — Zhu & Böhme, CCS 2021 — peer_reviewed — "What you change is what you fuzz! ... four in every five bugs have been introduced by recent code changes. That is, 77% of 23k bugs are regressions"; the regression probability "increases from 20% for the first bug to 92% after a few hundred bug reports" — verified verbatim.
  - [How Long Do Vulnerabilities Live in the Code?](https://www.usenix.org/system/files/sec22-alexopoulos.pdf) — Alexopoulos, Brack, Wagner, Grube, Mühlhäuser, USENIX Security 2022 — peer_reviewed — average lifetime "around 4 years ... (~2 years for Chromium, ~7 years for OpenSSL)"; "fuzzers keep discovering very old vulnerabilities for years"; it cites Zhu and Böhme that "with limited resources, fuzzing code that has recently changed is the best vulnerability discovery strategy" — verified in full text (C/C++ projects only).
- **Detect:** Rank files by churn with `git log --since="12 months ago" --name-only --pretty=format: -- src/ | sort | uniq -c | sort -rn | head -30`, then intersect with the F03 candidates.
- **Tools:** git log, ripgrep
- **Applies to:** Any project with version history.
- **When not to apply / counterpoints:**
  - For never-fuzzed code, the first reports are mostly NOT regressions (20% for the first bug).
  - Churn also correlates with how actively code is maintained.
  - The evidence comes from C/C++ open-source projects.
- **Fix risk:** low

### G206-F18 — Rules for properties and harnesses written by an LLM
**Rule:** For harnesses and properties written by an LLM, including the agent running this skill:
- Derive expected behaviour from docs, specs, type contracts or an independent reference, never by reading the implementation.
- Mark each property with its provenance.
- Treat every failure as UNVALIDATED until it is checked against documented intent.
- Reject tautological properties.

- **Grade:** B · **Verdict:** CORRECTED
  - **Maaz et al.:** the 56% validity rate is estimated from a random sample of **n = 50** reports drawn from the top 80% by an LLM-graded rubric score, not from a review of all 984. The authors also give a false-discovery-rate 95% CI of [30.2%, 57.8%].
  - **Intent ambiguity** is the paper's stated "secondary limitation", illustrated by one example (requests' `LookupDict`). It was not measured as the main cause of false positives.
  - **Venue:** the paper is a 4-page NeurIPS 2025 DL4Code workshop paper, and its authors are Anthropic-affiliated.
  - **Vikram et al.:** the 21% result is from GPT-4-era models (GPT-4, Gemini-1.5-Pro, Claude-3-Opus).
- **Rationale:** LLM-generated tests and properties find real bugs and also produce false alarms.
  - OSS-Fuzz-gen's AI harnesses found 26 new vulnerabilities, including CVE-2024-9143.
  - The agentic PBT study (100 packages, 984 reports) estimates about 56% valid and 32% worth reporting from a 50-report sample, at $9.93 per valid bug. It notes that the agent "cannot distinguish intentional design violations from bugs".
  - GPT-4 produced correct PBTs for 21% of the properties extractable from docs.
  - LLM oracles tend to capture actual rather than expected behaviour, which would turn a bug into a "passing" property.
- **Evidence:**
  - [Agentic Property-Based Testing: Finding Bugs Across the Python Ecosystem](https://arxiv.org/abs/2510.09907) — Maaz, DeVoe, Hatfield-Dodds, Carlini (MATS/Anthropic, Northeastern), NeurIPS 2025 DL4Code workshop — workshop paper — "The agent generated 984 bug reports"; "We randomly sampled n = 50 bug reports from the top 80% by score"; "56.0% (95% CI: 42.2%, 69.8%) of reports were determined to be valid bugs, and 32.0% (95% CI: 19.1%, 44.9%) were valid and worth reporting"; "$5.56/bug report"; "$9.93/valid bug"; "The secondary limitation is intent ambiguity: the agent cannot distinguish intentional design violations from bugs." — verified in full text.
  - [Can Large Language Models Write Good Property-Based Tests?](https://arxiv.org/abs/2307.04346) — Vikram, Lemieux, Sunshine, Padhye, arXiv v2 of 22 Jul 2024 — preprint — "a valid and sound PBT can be synthesized in 2.4 samples on average"; "the best model (GPT-4) is able to automatically synthesize correct PBTs for 21% of properties extractable from API documentation"; 40 API methods across 10 Python libraries — verified.
  - [Do LLMs generate test oracles that capture the actual or the expected program behaviour?](https://arxiv.org/abs/2410.21136) — Konstantinou, Degiovanni, Papadakis, Oct 2024 — preprint — "LLM-based test generation approaches are also prone on generating oracles that capture the actual program behaviour rather than the expected one"; 24 open-source Java repositories — verified.
  - [Leveling Up Fuzzing](https://security.googleblog.com/2024/11/leveling-up-fuzzing-finding-more.html) — Google, Nov 2024 — industry_report — 26 new vulnerabilities; coverage "from 77 lines to 5434 lines"; crash triage asks whether "Crash is caused by bug in fuzz driver" or "Crash is caused by bug in project" — verified.
  - [OSS-Fuzz-gen README](https://github.com/google/oss-fuzz-gen) — Google — official_docs — "valid fuzz targets ... for 160 C/C++ projects"; "The maximum line coverage increase is 29%"; "we have reported 30 new bugs/vulnerabilities found by automatically generated targets" — verified. The README's project count is older than the blog's 272.
- **Detect:**
  - **Tautology check:** `rg -n "assert\s+(\w+)\((.*)\)\s*==\s*\1\("`, then a manual check that no assertion computes its expected value with the function under test.
  - **Provenance check:** every property cites the doc, spec or reference it encodes; `rg -L "(spec|doc|RFC|reference):" tests/props`.
  - **Failure check:** every failure records the documentation sentence it violates. If there is none, label it "ambiguous intent" for a human decision.
- **Tools:** ripgrep, ast-grep, Hypothesis ghostwriter (draft only)
- **Applies to:** Any property, invariant or harness generated with AI assistance, which is the default in this skill.
- **When not to apply / counterpoints:**
  - Doc-only properties miss undocumented but relied-upon behaviour.
  - Characterisation tests are legitimate for refactoring safety, but they are NOT properties.
  - The LLM-PBT evidence covers libraries (preprint and workshop quality) and older models. Yield on business logic is unmeasured.
- **Fix risk:** low

### G206-F19 — Report only minimised, root-caused findings
**Rule:**
- Report only minimised, reproducible, root-caused findings, each with severity and a reachability statement.
- Never inflate counts.
- Never label a finding a vulnerability or CVE without exploitability analysis.
- Batch schema-conformance noise into one item.

- **Grade:** C · **Verdict:** VERIFIED (added a supporting SoK data point)
- **Rationale:**
  - **curl:** 66% of 415 bug-bounty reports were neither security issues nor normal bugs. This counts all bounty reports, not only AI or fuzz reports. The more plausible a bad report looks, the more it costs to reject.
  - **libxml2:** its maintainer spends several hours a week on third-party security reports.
  - **SoK 2024:** criticises CVEs of questionable quality obtained from fuzzing research. Of 339 such CVEs, only 42% (143) were valid and fixed.
- **Evidence:**
  - [The I in LLM stands for intelligence](https://daniel.haxx.se/blog/2024/01/02/the-i-in-llm-stands-for-intelligence/) — Daniel Stenberg (curl), 2 Jan 2024 — engineering_blog — "We have received 415 vulnerability reports. Out of those, 64 were ultimately confirmed security problems. 77 of the report were informative ... Making 66% of the reports neither a security issue nor a normal bug."; "The better the crap, the longer time and the more energy we have to spend on the report until we close it." — verified verbatim.
  - [libxml2 issue #913: Triaging security issues reported by third parties](https://gitlab.gnome.org/GNOME/libxml2/-/issues/913) — Nick Wellnhofer (nwellnhof), 8 May 2025, closed — practitioner_forum — "I have to spend several hours each week dealing with security issues reported by third parties. Most of these issues aren't critical but it's still a lot of work. In the long term, this is unsustainable for an unpaid volunteer like me." — verified through the GitLab API. The issue does not mention fuzzers.
  - [SoK: Prudent Evaluation Practices for Fuzzing](https://mschloegel.me/paper/schloegel2024sokfuzzevals.pdf) — Schloegel et al., IEEE S&P 2024 — peer_reviewed — "authors requesting and receiving CVEs of questionable quality"; "only 42% (143) of the 339 assigned CVEs are valid and have been fixed"; "Unique crashes are not a reliable metric" — verified verbatim.
- **Detect:** Each reported item must have:
  - a minimised input;
  - a reproduction command;
  - a symbolised stack or failing assertion;
  - a root-cause sentence;
  - a public entry point;
  - a severity with rationale;
  - a duplicate-of link, if any.

  Reject any report whose headline number is a crash count.
- **Tools:** issue template, libFuzzer/AFL++ minimisers
- **Applies to:** Findings reported to the owner, and especially upstream reports to third-party dependencies.
- **When not to apply / counterpoints:**
  - The evidence is practitioner testimony about two projects plus one systematisation paper.
  - Over-filtering can suppress real but hard-to-explain bugs. Keep a private list of unconfirmed findings.
- **Fix risk:** low

### G206-F20 — Skip or narrow the step when preconditions fail
**Rule:** Skip or narrow the step when any of these holds:
1. There is no input-handling surface and no statable property or reference.
2. The targets are effectful or non-deterministic, with no seam.
3. The only reachable API instance is production.
4. The code is already under continuous fuzzing with a saturated corpus, and no new harness shape is planned.
5. No viable tool runs natively or in WSL2.
6. The budget cannot give each target about 10 min or more.

State the reason instead of shipping shallow harnesses.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Each condition has direct support:
  - **Oracle:** PBT pays off where a good abstraction exists.
  - **Effects:** effectful code "may not be safe to access over and over during testing".
  - **Production:** aggressive API fuzzing can corrupt backends.
  - **Saturation:** saturated corpora yield little.
  - **Budget:** API-fuzzer coverage often peaks within 10 minutes.

  Each condition is sourced, but the combined checklist is a synthesis.
- **Evidence:**
  - [Property-Based Testing in Practice](https://harrisongoldste.in/papers/icse24-pbt-in-practice.pdf) — Goldstein et al., ICSE 2024 — peer_reviewed — "effectful code might rely on external files, databases, or networks, which may not be safe to access over and over during testing"; developers "succeeded in applying PBT by being opportunistic in their choice of when to apply it" — verified.
  - [RESTler README](https://github.com/microsoft/restler-fuzzer) — Microsoft Research — official_docs — fuzzing "may create outages in the service under test" — verified.
  - [How SQLite Is Tested](https://www.sqlite.org/testing.html) — SQLite — engineering_blog — "Since dbsqlfuzz has been added to the SQLite internal test suite, bug reports from external fuzzers such as OSSFuzz have all but stopped." — verified verbatim.
  - [Testing sync at Dropbox](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine) — Isaac Goldberg, 2020 — engineering_blog — randomized testing systems "we built on top of our test-friendly architecture" — verified.
- **Detect:** Pre-flight checklist for each module:
  - Does F03 find a parser, validator or inverse pair?
  - Can a property be written from the docs alone?
  - Is the entry point callable in-process without network or database access?
  - Does a non-production instance exist?
  - Is there an existing harness plus a coverage plateau?
  - Is a tool available natively or in WSL2?
  - Is the budget at least 10 min per target?
- **Tools:** manual checklist, ripgrep, git
- **Applies to:** The planning phase of the hardening pass.
- **When not to apply / counterpoints:**
  - "No oracle" underuses crash-only fuzzing. Does-not-crash properties need no oracle and "often flush out a surprising number of errors" (MacIver).
  - Where there is a lot of untrusted input, adding a seam is often worth a separate reviewed change after the pass.
- **Fix risk:** low

## Practitioner voice

- [Testing sync at Dropbox](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine) — Isaac Goldberg, 2020.
  - "Tens of millions" of seeded randomized runs nightly, usually 100% green on master.
  - A failing seed "is guaranteed to fail again", and CanopyCheck shrinks inputs.
  - The randomized testing was built on a test-friendly architecture. It exposed the directory-cycle bug.
- [How SQLite Is Tested](https://www.sqlite.org/testing.html)
  - AFL was "adept at finding arcane bugs", mostly false assert() conditions plus crashes and a few wrong results.
  - OSS-Fuzz "no longer finds historical bugs".
  - dbsqlfuzz runs on about 16 cores at about 400 cases/s per instance, roughly 500M cases a day. External fuzz reports have "all but stopped".
  - Fuzz cases live on in fuzzcheck.
  - "Fuzz testing and 100% MC/DC testing are in tension with one another."
- [The I in LLM stands for intelligence](https://daniel.haxx.se/blog/2024/01/02/the-i-in-llm-stands-for-intelligence/) — Daniel Stenberg.
  - 66% of 415 curl bug-bounty reports were neither security issues nor normal bugs.
  - AI-generated reports with hallucinated details cost more triage time the more plausible they look.
- [libxml2 #913](https://gitlab.gnome.org/GNOME/libxml2/-/issues/913) — Nick Wellnhofer, May 2025.
  - "Several hours each week" go to third-party security reports, "Most of these issues aren't critical", and this is "unsustainable for an unpaid volunteer".
  - He proposes treating security issues like any other bug.
  - *Corrected:* the issue does not say the reports are fuzzer-driven.
- [Why fuzzing over formal verification?](https://blog.trailofbits.com/2024/03/22/why-fuzzing-over-formal-verification/) — Trail of Bits, 2024.
  - Echidna rediscovered two bugs originally found by formal verification (MakerDAO DAI, Compound V3 Comet) within minutes on a laptop.
  - "Writing good invariants is 80% of the work."
  - This is a vendor blog, and the characterisation is corrected.
- [Property-based testing in a screencast editor](https://wickstrom.tech/2019-03-02-property-based-testing-in-a-screencast-editor-introduction.html) — Oskar Wickström, 2019.
  - Online examples focus on fundamentals: reversing lists, algebraic laws, encoders/decoders.
  - The challenge is PBT for the "ugly" parts of a real app (Komposition).
  - PBT found video-classifier bugs "that would be very hard to find using example-based tests or using a static type system".
- [Property-Based Testing in Practice](https://harrisongoldste.in/papers/icse24-pbt-in-practice.pdf) — Jane Street interviewees.
  - Writing generators is "the biggest annoyance".
  - Combining generators for coverage versus realism: "that way lies madness".
  - "I hate writing shrinkers".
  - A published bug was missed because the generator was "not generating the case that [they] had in mind".
- [Property Tests + Contracts = Integration Tests](https://www.hillelwayne.com/post/pbt-contracts/) — Hillel Wayne, Dec 2017.
  - PBT plus contracts is "acting as a fuzzer", and contracts are checked through nested calls.
  - "I tried combining PBT and contracts for a task at work and it seems promising".
  - "One of the big challenges in PBT is coming up with invariants".
- [Property-based testing is fuzzing](https://blog.nelhage.com/post/property-testing-is-fuzzing/) — Nelson Elhage, Oct 2017.
  - "by the simple expedient of assert(property()) we can turn any property into an assertion about not-crashing".
  - He recommends Hypothesis as "worlds ahead".
- [In praise of property-based testing](https://increment.com/testing/in-praise-of-property-based-testing/) — David R. MacIver, 2019.
  - Real finds: dateutil swapping year and month, and an Argon2 C-library buffer issue at hash_len > 512 that caused silent verification failures.
  - Advice: start with does-not-crash and round-trip tests.
- [ShardStore (SOSP 2021)](https://cdn.amazon.science/77/5e/4a7c238f4ce890efdc325df83263/using-lightweight-formal-methods-to-validate-a-key-value-storage-node-in-amazon-s3-2.pdf) — AWS.
  - Checked against executable reference models with PBT (proptest), plus stateless model checking for concurrency.
  - Together these prevented 16 issues from reaching production, and non-experts later extended the approach.
  - *Corrected:* the 16 issues are not attributable to PBT alone.

## Contradictions and open questions

**Contradictions (verified on both sides):**
- **Fuzzing and CVE lifetimes (dossier T23).** Alexopoulos et al. (USENIX Sec 2022) find no significant lifetime reduction for Linux memory-related CVEs after fuzzers were introduced. The same paper also says:
  - syzkaller found more than 3,000 fixed Linux bugs, mostly without CVEs;
  - "fuzzing old code seems to still produce results even for 'extensively tested' targets".

  Meanwhile OSS-Fuzz and Zhu & Böhme report large bug counts and quick regression detection. Fuzzing finds bugs; whether it measurably shortens CVE lifetimes is unresolved.
- **cargo-fuzz on Windows.** The README says "not Windows"; the rust-fuzz book says Windows works through MSVC ASan. Treat native Windows as experimental and prefer WSL2.
- **Ravi & Coblenz, internal inconsistency.** The abstract says "over 19 times", the conclusion "over 14 times".
- **Fuzzing budget.** Research practice is 24 h with at least 10-30 trials (Klees 2018; SoK 2024). CI practice is 600 s (CIFuzz) or 15 min (Klooster, preprint on 9 Magma libraries). Kim et al. saw REST coverage peak within 10 minutes "in many cases". The purposes differ, and none measures a one-shot pass on never-fuzzed application code.
- **/MD on Windows.** LLVM says libFuzzer with /MD is unsupported; Microsoft says ASan works with /MD and /MT. For fuzz builds, use /MT (reviewer's resolution).
- **Scope of invariant and fuzz tests (dossier G103).** G103 limits them to numeric code. Ravi & Coblenz found exception, inclusion and type-check properties most effective, and Jane Street usage is mostly differential and round-trip.
- **PBT evidence (dossier T13).** Ravi & Coblenz give quantitative mutation-kill evidence: correlational, a 2022 corpus, mostly under 10k LOC, and no measure of real-bug yield or authoring cost.
- **Best REST API fuzzer.** The author-run evaluation says Schemathesis finds 1.4-4.5x more defects than the next-best fuzzer. The independent Kim et al. study ranks EvoMasterWB best by a wide margin, with Schemathesis sixth of ten on unique 500 errors, and it tested Schemathesis 3.7.1.
- **Hypothesis defaults.** Locally the deadline is 200 ms and derandomize is False. On CI the deadline is None and derandomize is True.

**Contradictions found during verification:**
- **jazzer.js status.** The researcher said the last release was April 2024. The GitHub API and npm say v4.0.0 on 15 April 2026, after a gap since v2.1.0 (October 2023).
- **fast-check version.** The researcher said "v5 needs Node >= 22.12". npm `latest` is 4.10.2 with Node >= 12.17; the Node 22.12 floor comes from Vitest 5.
- **Echidna on Windows.** The README documents only Linux/macOS/Docker, but release v2.3.3 ships an x86_64 Windows zip.
- **Committed regression inputs versus green CI.** The researcher recommended committing failing inputs to Go `testdata/fuzz` and `proptest-regressions`. Both auto-replay on the normal test command and fail until the fix. See F12 for workarounds (reviewer observation, not sourced).

**Open questions:**
- No source measured bug yield per CPU-hour for a ONE-SHOT local pass on mature application code (TypeScript, Python business logic, Solidity). Yield figures there remain anecdotal.
- Forum-level practitioner voice is missing: no Hacker News, Reddit or StackExchange threads. WebSearch was exhausted in both research and verification, and Hacker News returned 429 during research. Engineering blogs and maintainer statements stand in.
- Open platform questions:
  - Is the Echidna Windows binary functional? It exists but was not run.
  - What platforms does HypoFuzz support? PyPI lists no OS classifiers.
  - What is the Windows status of bolero's engines?
- Does committing expected-failure tests (pytest xfail strict, Vitest `test.fails`, Hypothesis `example.xfail`) conflict with the rule that existing tests are read-only and CI must stay green? The fallback is a quarantined reproducer file plus an issue.
- The real-bug yield of LLM-written properties on application code is unmeasured. Studies cover libraries (Maaz), documented API methods (Vikram, with GPT-4-era models) and Java oracles (Konstantinou).
- There is no real-bug saturation curve beyond 1000 examples. The Ravi & Coblenz sweep used mutants and was capped at 500 inputs.
- Some CLI flags remain unverified: forge command-line overrides for fuzz and invariant runs, RESTler time-budget flags, and Echidna CLI equivalents of its config keys. Only the config keys and commands shown in the docs are used here.

## Dropped findings

None. All 20 findings survived: 13 verified, 7 corrected (F05, F07, F13, F14, F15, F16, F18). No practitioner-voice URL was dropped. Three practitioner gists were corrected: libxml2, Trail of Bits and AWS ShardStore.
