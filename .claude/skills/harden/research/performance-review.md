# Algorithmic and runtime performance in a hardening pass
> Code T04 · slug performance-review · verified 2026-09-23 · counts: verified 13 / corrected 7 / downgraded 1 / dropped 0

Verification method: every cited URL was opened with WebFetch, or with curl when WebFetch was blocked (StackExchange API, Hacker News API, GCC manual, crates.io, GitHub API). PDFs were downloaded and read with `pdftotext` (Yang et al. ICSE 2018, Stabilizer ASPLOS 2013, Mytkowicz et al. ASPLOS 2009). The WebSearch budget for the session was used up, so replacement sources were found by fetching publisher, author and project pages directly.

Second pass (workflow resumed, same day): every source was opened again, independently of the first pass. The verdicts did not change. The second pass added:
- N+1-specific figures and an eager-loading counter-example from Yang et al. (F05);
- a verified 2025 production case, GitLab's 48 h → 41 min backup fix (F03, F13, F17, practitioner voice);
- GSO's "Hack Detector" changelog, which shows that agents game optimisation benchmarks (F14, F20, F21);
- wrk2's maintenance status (F16);
- Selakovic & Pradel's note on fix complexity, and Ruff PERF401–403's version-dependent speedups (F12).

The Ruff version on PyPI is 0.16.8. The researcher's "v0.15.x" was one minor release behind; every rule page cited was still live.

## Summary

What a hardening pass on a finished, working project should do about performance. Versions seen during verification: Azure Architecture Center antipattern pages (content first written 2017–2022, refreshed Sept 2026), Django 6.1, Python 3.14.7 docs, Node.js v26.10.0 docs, Vitest v5.0.1, pytest-benchmark 5.3.0 (PyPI), hyperfine 1.20.0, current Ruff rule docs (Ruff 0.16.8 on PyPI), benchstat module of 2026-09-08, Go 1.24 `b.Loop`.

1. **Look for scalability defects, not micro-speedups.** The evidence points to a small set of defects worth fixing:
   - accidentally quadratic loops (a linear search or a concatenation inside a loop);
   - N+1 or chatty I/O;
   - over-fetching and missing pagination;
   - blocking I/O on async or event-loop paths;
   - shared clients created per request;
   - caches, queues and listener lists with no bound.

   The fixes are usually small. Yang et al. (ICSE 2018) studied 12 Rails apps and applied 64 fixes across 9 ORM anti-patterns. They got a median 2x server-side speedup, and more than 78% of the fixes changed fewer than 5 lines. Two caveats:
   - The 39x maximum came from *removing a feature*.
   - The 40 fixes that changed neither display nor functionality averaged 2.2x (max 9.2x).

   Azure's lab examples (originally published 2017) show:
   - about 9.7x throughput from batching queries (410 to 3,970 req/min);
   - about 10x from async I/O;
   - 3.5x from projecting only the needed fields (100 to 350 req/s);
   - about 12x from aggregating in the database (about 2,000 to more than 25,000 req/min).

2. **Do not micro-optimise for its own sake.** Knuth (1974) wrote: "forget about small efficiencies, say about 97% of the time... Yet we should not pass up our opportunities in that critical 3%... only after that code has been identified". The passage was verified through two secondary sources that quote it the same way. He adds that programmers' intuitive guesses fail. Empirical support:
   - Only 42.68% of 98 real JavaScript optimisations improved performance consistently across all tested versions of V8 and SpiderMonkey (ICSE 2016; the engine versions are from about 2015).
   - For LLVM on SPEC CPU2006 (2013), the effect of -O3 over -O2 was indistinguishable from noise once memory layout was randomised.
   - Some lint "performance" rules depend on the language version: Ruff PERF203 is enforced only for Python before 3.11.

3. **Every performance change must be proven, and must not change behaviour.**
   - Profile to find the bottleneck, with the right profiler for the runtime. A CPU profiler does not show I/O wait.
   - Benchmark before and after on the same machine: warm-up, at least 10 (ideally 20) runs, a reported spread, and a statistical comparison (benchstat, Criterion, pytest-benchmark, hyperfine).
   - Guard against benchmark artefacts: dead-code elimination, JIT warm-up, GC, debug builds and layout bias. Changing environment-variable size moved one program's run time by about 33% often and once by almost 300%. Link order moved results by up to 57%.
   - Keep the full test suite green, and review the semantic traps: fail-fast `Promise.all`, stale caches, API contract changes from pagination, unsafe autofixes, and fast-math.

4. **What this means for an AI-run skill.** Benchmarks from 2024–2025 show LLM code is less efficient than expert code on LeetCode-style problems. In EffiBench, GPT-4 code took on average 3.12x the execution time of efficient canonical solutions. The GSO paper (May 2025) reported agents under 5% successful on real-repository optimisation, and named bottleneck localisation as a failure mode. **That number is outdated:** GSO's own leaderboard, read on 2026-09-23, lists Opt@1 scores up to 47.06% (July 2026). Its changelog also records two defences:
- a "Hack Detector" (Nov 2025) that "penalizes deceptive optimizations (e.g., memoization, harness hijacking)";
- network isolation (July 2026), after "newer models were sometimes using arbitrary techniques to fetch upstream commits/PR diffs".

The lesson for the skill still holds, with weaker AI-specific support: hunt the defect classes above, never act on intuition without measurement, and check that a claimed speedup is not benchmark gaming.

The evidence conflicts on four points. They are reported below, not resolved:
- "profile first" versus "peanut-butter" slowness spread thinly across the code;
- Muratori's 10–25x "clean code" penalty versus practitioners who say their bottlenecks are databases and I/O;
- batching versus over-fetching;
- the GSO paper's figure versus its later leaderboard.

## Findings

### T04-F05 — Remove N+1 and chatty I/O (per-item queries, lazy loads, HTTP calls or small writes inside loops)
- **Grade:** A · **Verdict:** CORRECTED. The ICSE 2018 numbers cover all 64 fixes across 9 ORM anti-patterns, not N+1 alone. The 39x maximum came from removing a feature in Lobsters (a functionality trade-off). Semantics-preserving fixes averaged 2.2x, with a maximum of 9.2x. The Rails config key was corrected to `strict_loading_mode`.
- **Rationale:** Replace database queries, ORM lazy-loads, HTTP calls or small file writes executed once per item in a loop. Use eager loading (`select_related`/`prefetch_related`/`includes`/`Include`), batched or bulk calls, or one set-based query. Then enforce the fix in tests with strict or raise fetch modes. This defect class has peer-reviewed and vendor-measured payoffs, and the fixes are small.
- **Evidence:**
  - [How not to structure your database-backed web applications: a study of performance bugs in the wild](https://hyperloop-rails.github.io/220-HowNotStructure.pdf) — Yang, Subramaniam, Lu, Yan, Cheung, ICSE 2018 — peer_reviewed — "we manually fix 64 performance issues in their latest versions and obtain a median speedup of 2× (and up to 39× max) with fewer than 5 lines of code change in most cases"; "More than 78% of fixes require fewer than 5 lines"; "There are 40 fixes that alter neither the display nor the functionality... average speedup of 2.2×, with a maximum of 9.2×"; the 39× case was "achieved by removing unnecessary feature in StoriesController.new action in Lobsters" — PDF read in full. The researcher's URL (hyperloop.cs.uchicago.edu) has an expired TLS certificate, so the copy on the project site is cited instead. The paper names the "N+1" lazy-loading problem as one of its data-access anti-patterns and also documents "inefficient eager loading" (Spree). The second pass read the N+1-specific data verbatim:
- "we find it still prevalent: it appears in 15 problematic actions and 9 performance issues in our study";
- in Lobsters, eager loading combined "all 51 queries (and hence 51 network round-trips)" and cut the page's end-to-end load time "from 1.10 seconds to 0.34 seconds".
  - [Detecting performance anti-patterns for applications developed using object-relational mapping](https://petertsehsun.github.io/publication/icse2014/) — Chen, Shang, Jiang, Hassan, Nasser, Flora, ICSE 2014 — peer_reviewed — "fixing the detected performance anti-patterns can improve the system response time by up to 98%" — verified on the author's publication page (abstract).
  - [Chatty I/O antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/chatty-io/) — Microsoft Azure Architecture Center, first published 2017-06-05, updated 2026-09-17 — official_docs — "sometimes an O/RM can mask the problem, if it implicitly fetches child records one at a time. This is known as the N+1 problem"; the method "performs 45 SELECT queries"; after the fix "3,970 requests per minute, compared to 410" — verbatim. This is a lab load test (up to 1,000 simulated users), not a field study.
  - [Fetch modes](https://docs.djangoproject.com/en/stable/topics/db/fetch-modes/) and [Database access optimization](https://docs.djangoproject.com/en/stable/topics/db/optimization/) — Django Software Foundation, Django 6.1 — official_docs — FETCH_ONE is the default and gives "1+N" queries, the "N+1 queries problem"; FETCH_PEERS reduces most cases "to two queries"; FETCH_RAISE raises `FieldFetchBlocked`; set per QuerySet with `.fetch_mode(models.FETCH_…)`. Fetch modes are **new in Django 6.1**. The optimisation page opens with "Profile first" and recommends bulk_create()/bulk_update() — verified.
  - [N+1 Queries](https://docs.sentry.io/product/issues/issue-details/performance-issues/n-one-queries/) — Sentry — official_docs — detects "sequential, non-overlapping database spans with similar descriptions"; "Total duration of involved spans must exceed 50ms"; span count threshold "usually five spans" — verbatim.
  - [Avoiding N+1 queries the Railsy way with strict loading](https://thoughtbot.com/blog/strict-loading-in-rails-8-a-railsy-way-to-avoid-n-1-queries) — Trésor Bireke, thoughtbot, 2025-04-07 — engineering_blog — "I recommend using `:n_plus_one_only`"; log mode in production helps "avoid crashing the application"; FactoryBot setup can fail and needs a workaround — verified (the FactoryBot caveat is a paraphrase).
- **Detect:**
  - **Rails:** set `config.active_record.strict_loading_by_default = true` and `config.active_record.strict_loading_mode = :n_plus_one_only` (the Rails guide confirms both keys). `action_on_strict_loading_violation` defaults to `:raise`. Set it to `:log` in production.
  - **Django 6.1+:** run tests with `QuerySet.fetch_mode(models.FETCH_RAISE)` on hot paths; also use django-debug-toolbar.
  - **Monitoring:** use Sentry's N+1 detector, or APM query counts per request.
  - **Static (ast-grep's documented example):** `rule: {pattern: 'await $PROMISE', inside: {kind: for_in_statement, stopBy: end}}`. The same docs page gives a broader `any:` version covering `for_statement`, `while_statement` and `do_statement`. Check each hit by hand for a DB, ORM or HTTP call.
  - **Python:** look for ORM `.objects.get`/`.filter` calls inside `for` loops.
- **Tools:** ast-grep; Rails strict_loading; Django FETCH_RAISE / django-debug-toolbar; Sentry; APM tracing (OpenTelemetry); bullet/prosopite gems (not re-verified here).
- **Applies to:** ORM-backed web apps (Rails, Django, EF, Hibernate, Prisma and similar) and any code that calls remote services or files once per item.
- **When not to apply / counterpoints:**
  - Over-correcting leads to Extraneous Fetching. Azure: "You must consider the tradeoff". Yang et al. also document slow *eager* loading: in Spree-5063, loading 405 products eagerly pulled in "13811 related variants products containing 276220 option_values", "making the page freeze". The fix *delayed* that loading.
  - Azure notes that "complex joins can become expensive".
  - Very small, bounded N may not be worth changing.
  - Django fetch modes do not exist before 6.1.
- **Fix risk:** medium

### T04-F07 — Remove blocking synchronous I/O from async functions, event loops and request threads
- **Grade:** A · **Verdict:** VERIFIED (note added: Azure's measurement is a synthetic lab test)
- **Rationale:** No readFileSync/execSync/pbkdf2Sync/zlib `*Sync` in Node request paths. No requests/urllib/`open()`/`time.sleep` inside `async def`. No blocking `.Result`/`.Wait()` in request handlers. Use the library's async API, and use thread-pool wrappers only when no async API exists. One blocking call stalls every request that shares the thread or loop.
- **Evidence:**
  - [Synchronous I/O antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/synchronous-io/) — Microsoft Azure Architecture Center, 2017-06-05, updated 2026-09-17 — official_docs — "A single synchronous I/O call can block an entire call chain"; async version: "a nearly tenfold increase in throughput... approximately 25 times smaller" response time. Async wrappers around sync methods: "it actually consumes more resources" — verbatim. The test simulates I/O with a hard-coded 2-second sleep, under up to 4,000 concurrent users.
  - [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — Node.js / OpenJS — official_docs — lists `crypto.pbkdf2Sync`, `zlib.inflateSync`/`deflateSync`, all sync fs APIs, `child_process.spawnSync`/`execSync`/`execFileSync`. JSON.parse of a 50MB string took 1.3 s — verified.
  - [ASYNC210 blocking-http-call-in-async-function](https://docs.astral.sh/ruff/rules/blocking-http-call-in-async-function/) — Astral (Ruff), stable, derived from flake8-async — official_docs — "Blocking an async function via a blocking HTTP call will block the entire event loop". Related rules confirmed to exist: ASYNC230 blocking-open-call-in-async-function, ASYNC240 blocking-path-method-in-async-function, ASYNC251 blocking-sleep-in-async-function.
  - [n/no-sync](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-sync.md) — eslint-community — official_docs — `allowAtRootLevel` "determines whether synchronous methods should be allowed at the top level of a file, outside of any functions" (default false); there is also an `ignores` option — verified.
- **Detect:**
  - `ruff check --select ASYNC`
  - eslint `'n/no-sync': ['error', {allowAtRootLevel: true}]`
  - `grep -rnE '\b(readFileSync|writeFileSync|existsSync|execSync|spawnSync|pbkdf2Sync|inflateSync|deflateSync)\(' src/`
  - `node --trace-sync-io` while exercising request paths (the flag is confirmed in the Node CLI docs)
  - C#: grep for `\.Result\b|\.Wait\(\)|GetAwaiter\(\)\.GetResult\(\)` in handlers
  - At runtime, watch request queue length or event-loop lag under a load test.
- **Tools:** ruff (ASYNC); eslint-plugin-n; node `--trace-sync-io`; grep; a load tester.
- **Applies to:** Servers, async Python (asyncio/trio/anyio), Node.js, .NET and UI threads. Not CLI tools, build scripts or startup code.
- **When not to apply / counterpoints:**
  - Azure: short, uncontended I/O (e.g. small files on SSD) "might be more performant as synchronous operations".
  - Unblocking threads can shift load to a downstream resource, which may then starve or be throttled (Azure).
  - Sync calls at module top level during startup are fine; that is why `allowAtRootLevel` exists.
- **Fix risk:** medium

### T04-F09 — Find and bound every structure that can grow without limit over a process's lifetime
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Check for:
  - memo caches with no maxsize or TTL;
  - functools caches on methods;
  - module-level Maps or dicts that are only ever written;
  - queues with no maxsize, and deques with no maxlen;
  - event listeners added per request.

  A growth warning such as MaxListenersExceededWarning is a leak signal, not a limit to raise. The official docs of each runtime say these structures are unbounded by default.
- **Evidence:**
  - [functools](https://docs.python.org/3/library/functools.html) — PSF, Python 3.14.7 — official_docs — "If maxsize is set to None, the LRU feature is disabled and the cache can grow without bound."; "If a method is cached, the self instance argument is included in the cache." — verbatim.
  - [B019 cached-instance-method](https://docs.astral.sh/ruff/rules/cached-instance-method/) — Astral (Ruff) — official_docs — "can lead to memory leaks, as the global cache will retain a reference to the instance, preventing it from being garbage collected." — verbatim.
  - [asyncio Queues](https://docs.python.org/3/library/asyncio-queue.html) — PSF, Python 3.14.7 — official_docs — "If maxsize is less than or equal to zero, the queue size is infinite. If it is an integer greater than 0, then await put() blocks when the queue reaches maxsize" — verbatim.
  - [Events](https://nodejs.org/api/events.html) — Node.js v26.10.0 docs — official_docs — "By default EventEmitters will print a warning if more than 10 listeners are added for a particular event. This is a useful default that helps finding memory leaks."; the limit can be set to `Infinity` (or `0`) — verbatim.
  - [No Caching antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/no-caching/) — Microsoft Azure Architecture Center — official_docs — "you might need to implement a background process that occasionally sweeps the cache, to prevent it from growing without limits" — verbatim.
  - [Why Discord is switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust) — Jesse Howarth, Discord, 2020-02-04 — engineering_blog — "Go will force a garbage collection run every 2 minutes at minimum"; "There are tens of millions of Read States in each cache"; a smaller cache gave smaller GC spikes but "resulted in higher 99th latency times" because of more database loads — verbatim.
- **Detect:**
  - Static checks:
    - `ruff check --select B019`
    - `grep -rnE 'lru_cache\(maxsize=None\)|@(functools\.)?cache\b|asyncio\.Queue\(\s*\)|queue\.Queue\(\s*\)|deque\(\s*\)|setMaxListeners\((0|Infinity)\)' .`
    - ast-grep for module-level `new Map()` with `.set` but no `.delete`/`.clear`
    - `.on(`/`addEventListener(` inside handlers with no matching removal
  - Soak tests:
    - Python: tracemalloc `snapshot2.compare_to(snapshot1, 'lineno')` (confirmed in the docs)
    - Node: `v8.writeHeapSnapshot()` or `--heapsnapshot-signal` (both confirmed), compared in the DevTools Comparison view
    - Go: heap pprof over time
- **Tools:** ruff (B019); grep; ast-grep; tracemalloc; Node heap snapshots / Chrome DevTools; go tool pprof (heap); DHAT/heaptrack.
- **Applies to:** Long-running processes (servers, workers, daemons, bots). Not short-lived CLIs.
- **When not to apply / counterpoints:**
  - `functools.cache` is "smaller and faster than lru_cache() with a size limit" (verbatim in the functools docs). It is fine for small, finite key spaces.
  - A bounded queue adds backpressure: `put()` blocks, which can deadlock a producer that is also the consumer.
  - Bounding a cache lowers its hit rate, which is the Discord trade-off.
- **Fix risk:** medium

### T04-F13 — Prove every performance change with a controlled A/B measurement
- **Grade:** A · **Verdict:** VERIFIED (context added: the 300% figure is one extreme case from Mytkowicz et al.)
- **Rationale:** A valid measurement needs:
  - the same machine and build type;
  - warm-up runs;
  - at least 10 (ideally 20) repetitions per variant;
  - median or mean reported with spread or a confidence interval;
  - a statistical comparison (Mann-Whitney U or bootstrap) with a noise threshold declared in advance;
  - the raw results stored with the change.

  Do not re-run until a "significant" result appears. Measurement bias is large and common, which is why official benchmark tools build in warm-up, repetition and statistics.
- **Evidence:**
  - [Producing Wrong Data Without Doing Anything Obviously Wrong!](https://users.cs.northwestern.edu/~robby/courses/322-2013-spring/mytkowicz-wrong-data.pdf) — Mytkowicz, Diwan, Hauswirth, Sweeney, ASPLOS 2009 — peer_reviewed — "in a literature survey of 133 recent papers from ASPLOS, PACT, PLDI, and CGO, we determined that none of the papers with experimental results adequately consider measurement bias"; changing an unused environment variable's size changed run time "frequently by about 33% and once by almost 300%"; "we may think we have a 12% slowdown when in fact we have a 9% speedup!" — PDF read.
  - [STABILIZER: Statistically Sound Performance Evaluation](https://people.cs.umass.edu/~emery/pubs/stabilizer-asplos13.pdf) — Curtsinger & Berger, ASPLOS 2013 — peer_reviewed — "simply changing the link order of object files can cause performance to decrease by as much as 57%"; "A single binary constitutes just one sample from the space of program layouts, regardless of the number of runs." — PDF read. The 300% figure in this paper is cited from Mytkowicz et al.
  - [benchstat](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — The Go Authors, module version of 2026-09-08 — official_docs — "Pick a number of benchmark runs (at least 10, ideally 20) and stick to it"; uses the Mann-Whitney U-test; warns that rerunning until a change appears produces false positives — verified.
  - [Criterion.rs: Analysis Process](https://bheisler.github.io/criterion.rs/book/analysis.html) — Criterion.rs — official_docs — bootstrap resampling; "Outlier samples are not dropped from the data"; "Optimizations or regressions within (for example) +-1% are considered noise and ignored." — verbatim.
  - [hyperfine](https://github.com/sharkdp/hyperfine) — David Peter, v1.20.0 — official_docs — "Warmup runs can be executed before the actual benchmark"; "Cache-clearing commands can be set up before each timing run"; "Statistical outlier detection"; export to CSV, JSON, Markdown, AsciiDoc — verified.
  - [pytest-benchmark usage](https://pytest-benchmark.readthedocs.io/en/latest/usage.html) — Ionel Cristian Mărieș, 5.3.0 — official_docs — `--benchmark-compare-fail`: "Fail test if performance regresses according to given EXPR (eg: min:5% or mean:0.001 for number of seconds)"; `--benchmark-autosave`, `--benchmark-disable-gc`; minimum rounds default 5 — verified.
  - [Learning Performance-Improving Code Edits](https://arxiv.org/abs/2302.07867) — Shypula, Madaan et al., ICLR 2024 — peer_reviewed — "significant variability of measuring performance on commodity hardware, which can lead to spurious 'improvements'"; the authors used the gem5 simulator for this reason — verified.
- **Detect:** Each performance change must attach raw before/after data. Example commands:
  - `hyperfine --warmup 3 --export-json perf.json 'old' 'new'`
  - `go test -run '^$' -bench . -count 20` for old and new, then `benchstat old.txt new.txt`
  - `pytest --benchmark-autosave`, then `--benchmark-compare --benchmark-compare-fail=min:5%`
  - `cargo bench` (Criterion)
  - Vitest 5 `bench.compare()` with `writeResult` / `bench.from()` (confirmed in the v5.0.1 docs)

  Reject a single-run timing, "it felt faster", or a benchmark run only after the change.
- **Tools:** hyperfine; benchstat; criterion; divan; pytest-benchmark; JMH; Vitest bench; Stabilizer (research only).
- **Applies to:** Any change justified by performance, including reverting an old optimisation.
- **When not to apply / counterpoints:**
  - The Rust Performance Book says "Mediocre benchmarking is far better than no benchmarking" (verified). Full rigour is not always affordable, but the direction and size of the effect must still be shown beyond run-to-run noise.
  - Layout randomisation (Stabilizer) is research tooling, not standard practice.
- **Fix risk:** low

### T04-F14 — Before trusting a microbenchmark, check that it measures what it claims
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Check that:
  - results are consumed (returned, sent to a Blackhole, or run under Go 1.24 `b.Loop`), so the compiler cannot remove the code;
  - inputs are not compile-time constants;
  - JIT tiers are warmed up;
  - GC and allocation effects are considered;
  - it runs on a release/production build.

  While it runs, use system tools to confirm what is actually limiting it ("active benchmarking").
- **Evidence:**
  - [JMHSample_08_DeadCode](https://github.com/openjdk/jmh/blob/master/jmh-samples/src/main/java/org/openjdk/jmh/samples/JMHSample_08_DeadCode.java) — OpenJDK JMH — official_docs — "The downfall of many benchmarks is Dead-Code Elimination (DCE): compilers are smart enough to deduce some computations are redundant and eliminate them completely." — verbatim.
  - [More predictable benchmarking with testing.B.Loop](https://go.dev/blog/testing-b-loop) — Junyang Shao, The Go Blog, 2025-04-02 — official_docs — `b.Loop` "prevents dead code elimination within the loop"; "the testing.B.Loop method is now the preferred way to write benchmarks" (Go 1.24) — verified.
  - [Benchmarking](https://vitest.dev/guide/benchmarking) — Vitest v5.0.1 — official_docs — "JavaScript engines can optimize away code that has no observable side effects"; "Very short benchmark runs may not reach the highest optimization tier"; results "vary significantly between environments"; "Designate a single environment (typically CI) to generate the file"; warns that module-runner getter wrappers add overhead — verified.
  - [Active Benchmarking](https://www.brendangregg.com/activebenchmarking.html) — Brendan Gregg, last updated 2014-04-20 — engineering_blog — "you benchmark A, but actually measure B, and conclude you've measured C"; "While the benchmark is running, analyze the performance of all components involved using other tools, to identify the true limiter of the benchmark." — verbatim.
  - [The Rust Performance Book: Benchmarking](https://nnethercote.github.io/perf-book/benchmarking.html) — Nicholas Nethercote et al. — official_docs — wall-time "can suffer from high variance. In particular, tiny changes in memory layout can cause significant but ephemeral performance fluctuations"; "cycles or instruction counts" are "a reasonable alternative" — verified.
  - [Using Microbenchmark Suites to Detect Application Performance Changes](https://arxiv.org/abs/2212.09515) — Grambow, Kovalev, Laaber, Leitner, Bermbach, IEEE Transactions on Cloud Computing (arXiv 2022) — peer_reviewed — detection is possible "if frequent false-positive alarms can be tolerated"; studies InfluxDB and VictoriaMetrics — abstract verified.
- **Detect:** Inspect benchmark code:
  - Is the result unused? In Go, look for `b.N` loops with no sink, and prefer `b.Loop` on Go 1.24 or later.
  - Are the inputs literals?
  - Is setup inside the timed region?
  - Is it a debug build, or NODE_ENV not set to production?
  - Is the result implausibly fast (sub-ns per operation)?

  During the run, use `perf stat`/`vmstat`/`iostat` to confirm which resource is the limiter.
- **Tools:** JMH; Go `testing.B.Loop`; Vitest bench; criterion (`black_box`); perf stat; vmstat/iostat.
- **Applies to:** Microbenchmarks in every language, especially on JIT runtimes (JVM, V8, PyPy, .NET).
- **When not to apply / counterpoints:**
  - Application-level benchmarks avoid many microbenchmark artefacts, but they are slower and noisier. Grambow et al. show microbenchmarks can stand in for them only if false alarms are acceptable.
  - Agent-specific check: GSO's leaderboard changelog added a "Hack Detector" that "penalizes deceptive optimizations (e.g., memoization, harness hijacking)" (https://gso-bench.github.io/, read 2026-09-23). An agent-produced speedup must also be checked for special-casing the benchmark input or harness.
- **Fix risk:** low

### T04-F04 — Replace accumulation idioms that documentation or linters flag as quadratic
- **Grade:** A · **Verdict:** CORRECTED. PERF401, PERF402 and PERF403 were removed from the "quadratic" detector list: they are manual-comprehension/copy rules, a constant-factor concern. The "CPython optimises in-place str +=" counterpoint was replaced: the current 3.14 docs no longer document that optimisation, and the Programming FAQ says the cost is quadratic "in the general case". The oxc note was widened: both of its "better" examples are broken. Java is marked as unverified.
- **Rationale:**
  - String/bytes/tuple concatenation in a loop becomes `join`, `StringIO`/`BytesIO`, `bytearray` or a list.
  - `sum(list_of_lists, [])` becomes a comprehension or `itertools.chain`.
  - `list.pop(0)`/`insert(0, x)` becomes `collections.deque`.
  - A spread into a reduce/loop accumulator (`{...acc}`, `[...acc, x]`) becomes in-place mutation.

  Never accept a linter autofix without tests: Ruff marks its own fix unsafe, and the oxc rule's documented "better" code is itself wrong.
- **Evidence:**
  - [Built-in Types: Common Sequence Operations, note 6](https://docs.python.org/3/library/stdtypes.html) — PSF, Python 3.14.7 — official_docs — "building up a sequence by repeated concatenation will have a quadratic runtime cost in the total sequence length. To get a linear runtime cost, you must switch to one of the alternatives below" — verbatim.
  - [Programming FAQ: most efficient way to concatenate many strings](https://docs.python.org/3/faq/programming.html) — PSF — official_docs — "In the general case, the total runtime cost is quadratic in the total string length." — verbatim. Added by the verifier.
  - [collections.deque](https://docs.python.org/3/library/collections.html) — PSF, Python 3.14.7 — official_docs — lists "incur O(n) memory movement costs for pop(0) and insert(0, v) operations" — verbatim.
  - [RUF017 quadratic-list-summation](https://docs.astral.sh/ruff/rules/quadratic-list-summation/) — Astral (Ruff) — official_docs — "This fix is always marked as unsafe because the replacement may accept any iterable where sum previously required lists... code that previously raised an error may silently succeed. Moreover, the fix could remove comments" — verbatim.
  - [oxc/no-accumulating-spread](https://oxc.rs/docs/guide/usage/linter/rules/oxc/no-accumulating-spread.html) — Oxc (oxlint) — official_docs — "When used on an accumulator, this can lead to O(n^2) memory complexity and O(n^2) time complexity." — verbatim. Both suggested fixes are broken:
    - The array example `arr.reduce((acc, x) => acc.push(fn(x)), [])` returns `push()`'s numeric length.
    - The object example assigns `acc[el]` but never returns `acc`.
  - [Ruby reject!](https://www.tumblr.com/accidentallyquadratic/157496054437/ruby-reject) — Nelson Elhage (Accidentally Quadratic), 2017-02-20 — engineering_blog — `reject!` was quadratic from Ruby 1.9.3 through 2.3. A fix for bug #2545 deleted each element immediately via `rb_ary_delete_at` — verified.
- **Detect:**
  - `ruff check --select RUF017` (quadratic `sum`)
  - `ast-grep -p '$S += $T' --lang python`, limited to matches inside `for` loops; check by hand that `$S` is a str/bytes/tuple
  - `grep -rnE '\.pop\(0\)|\.insert\(0,' --include=*.py`
  - `oxlint -D oxc/no-accumulating-spread`
  - JS: `.shift()`/`.unshift(` inside loops
  - PERF401/402/403 are optional *constant-factor* hints, not quadratic detectors.
- **Tools:** ruff; oxlint; ast-grep; grep.
- **Applies to:** Python and JS/TS (verified). The idea applies to any language with immutable strings or copy-on-concatenate collections. Java `String +=` in loops is common knowledge, but it was **not verified** here: SonarSource S1643 could not be fetched.
- **When not to apply / counterpoints:**
  - For tiny, bounded loops the change is cosmetic.
  - Do not rely on interpreter-specific in-place optimisations; current docs do not promise any.
  - Some rules in this family depend on the language version: PERF203 is enforced only for Python before 3.11.
- **Fix risk:** medium

### T04-F08 — Parallelise independent loop awaits only with bounded concurrency and deliberate error handling
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Never swap in an unbounded `Promise.all`/`gather` over an array that grows with the input. Keep loop-sequential awaits where iterations depend on each other, rate limits apply or order matters. ESLint's own documentation gives the benefit and lists the cases where the rule is wrong. MDN documents that `Promise.all` fails fast, which changes behaviour compared with the sequential loop.
- **Evidence:**
  - [no-await-in-loop](https://eslint.org/docs/latest/rules/no-await-in-loop) — ESLint — official_docs — "may indicate that the program is not taking full advantage of the parallelization benefits of async/await". "When Not To Use It" covers dependent iterations, retries, rate limits ("we'll exceed our rate limit if we make all the network calls in parallel"), and promises that allocate "a bounded resource (RAM, file descriptors, network bandwidth)" — verified.
  - [Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) — MDN — official_docs — "It rejects when any of the input's promises rejects, with this first rejection reason"; "Use allSettled() if you need the final result of every promise in the input iterable." — verbatim.
- **Detect:** Run eslint `no-await-in-loop`, or the ast-grep loop rule (see F05). For each hit, check by hand:
  - Does iteration i use the result of i-1?
  - Is there a rate limit?
  - Is the array bounded?
  - What should happen on a partial failure?
- **Tools:** eslint (no-await-in-loop); ast-grep; p-limit / asyncio.Semaphore.
- **Applies to:** JS/TS and Python asyncio (sequential awaits vs `asyncio.gather`).
- **When not to apply / counterpoints:** Sequential loops are sometimes correct by design: rate-limited APIs, ordered side effects, transactions. Parallel requests can overload downstream services and cause a retry storm (Retry Storm is listed in Azure's antipattern catalogue).
- **Fix risk:** high

### T04-F18 — Bound CPU-heavy work reachable from untrusted input on request/event-loop threads
- **Grade:** A · **Verdict:** VERIFIED (counterpoint added: Express already sets a default body limit)
- **Rationale:**
  - Enforce maximum input/body sizes before parsing.
  - Replace regexes with super-linear backtracking.
  - Move large computations to workers or a queue, or split them into chunks.

  Node's official guide says Node "is fast when the work associated with each client at any given time is 'small'". It recommends bounding input and avoiding ReDoS-prone regexes. Even O(n) work such as JSON.parse on 50MB (1.3 s) can block a server.
- **Evidence:**
  - [Don't Block the Event Loop (or the Worker Pool)](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — Node.js — official_docs — "By bounding the input you ensure the callback cannot take more than the worst-case time on the longest acceptable input."; "Avoid nested quantifiers like (a+)*"; "The Event Loop should orchestrate client requests, not fulfill them itself." — verbatim.
  - [regexp/no-super-linear-backtracking](https://ota-meshi.github.io/eslint-plugin-regexp/rules/no-super-linear-backtracking.html) — eslint-plugin-regexp — official_docs — "This super-linear worst-case runtime can be exploited by attackers in what is called Regular expression Denial of Service - ReDoS."; the rule "can only detect very simple cases" — verified.
  - [body-parser README, `limit` option](https://github.com/expressjs/body-parser) — Express project — official_docs — "Controls the maximum request body size... Defaults to '100kb'". Added by the verifier.
- **Detect:**
  - eslint-plugin-regexp (`no-super-linear-backtracking`, `no-super-linear-move`).
  - Check the body-size limit configured on the HTTP framework, and whether someone raised it.
  - grep for `JSON.parse`/`json.loads` on raw request bodies with no size check.
  - Check CPU-heavy handlers (image, crypto, compression, large sorts) for worker offload.
- **Tools:** eslint-plugin-regexp; semgrep / ast-grep; load tests with large payloads.
- **Applies to:** Servers exposed to untrusted input, especially single-threaded event loops (Node.js, asyncio). Overlaps with the security topic.
- **When not to apply / counterpoints:**
  - A new or lower limit is a visible behaviour change: set it above the observed production maximum and document it.
  - Frameworks often already have defaults (Express JSON: 100kb). Verify before "adding" one.
  - Static ReDoS detection is incomplete by its own admission.
- **Fix risk:** medium

### T04-F02 — Choose a profiler that fits the runtime and the kind of cost, and know its blind spots
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Profile a release/production build with symbols.
  - Collect one profile at a time.
  - Use off-CPU/idle/blocking views for I/O-bound services, because CPU profiles leave out waiting.
  - Read flame graphs correctly: width is sample frequency, and the x-axis is not time.
- **Evidence:**
  - [Diagnostics](https://go.dev/doc/diagnostics) — The Go Authors — official_docs — the CPU profile shows time "while actively consuming CPU cycles (as opposed to while sleeping or waiting for I/O)"; "it is recommended to collect only a single profile at a time"; the block and mutex profiles are "not enabled by default"; the CPU profile "adds cost" in production — verbatim.
  - [Flame Graphs](https://www.brendangregg.com/flamegraphs.html) — Brendan Gregg — engineering_blog — "The x-axis shows the stack profile population, sorted alphabetically (it is not the passage of time)"; "The wider a frame is is, the more often it was present in the stacks." — verbatim.
  - [The Rust Performance Book: Profiling](https://nnethercote.github.io/perf-book/profiling.html) — Nethercote et al. — official_docs — lists perf, samply, flamegraph, Cachegrind, DHAT, heaptrack, Coz and others; recommends `debug = "line-tables-only"` in `[profile.release]` and `-C force-frame-pointers=yes` — verified.
  - [py-spy](https://github.com/benfred/py-spy) — Ben Frederickson — official_docs — "doesn't run in the same process as the profiled Python program"; `--idle`, `--native`, `--gil`; supports CPython 2.3–2.7 and 3.3–3.14 — verified.
  - [Scalene](https://github.com/plasma-umass/scalene) — Berger, Stern, Altmayer Pizzorno (OSDI 2023) — official_docs — "separates out time spent in Python from time in native code"; "profiles copying volume"; "Its overhead is typically no more than 10-20% (and often less)", although the same README reports "just a 35% slowdown" on the pyperformance suite; the current CLI is `scalene run prog.py` — verified.
  - [Clinic.js](https://github.com/clinicjs/node-clinic) — clinicjs — official_docs — "Clinic.js is not being actively maintained... it may not work or the results you get may not be accurate." The repository is not archived — verbatim.
  - [Profiling Node.js Applications](https://nodejs.org/en/learn/getting-started/profiling) — Node.js — official_docs — `NODE_ENV=production node --prof app.js`, then `node --prof-process isolate-0x…-v8.log`. This page does not mention `--cpu-prof`; `--cpu-prof` is confirmed separately in the Node CLI docs.
- **Detect:** Manual review of the evidence behind any performance claim:
  - Was it a release build (`cargo --release`, `NODE_ENV=production`, Go without `-race`)?
  - Does the profiler type match the bottleneck (CPU or wait)?
  - Is wall-clock/off-CPU time accounted for (`py-spy --idle`, Go block/mutex profiles)?

  Commands: `py-spy record -o prof.svg -- python app.py`; `scalene run app.py`; `go test -cpuprofile cpu.out` + `go tool pprof`; `cargo flamegraph`; `node --prof`/`--cpu-prof`.
- **Tools:** py-spy; scalene; pprof; perf; samply; cargo-flamegraph; Cachegrind; DHAT; heaptrack; node `--prof`/`--cpu-prof`; Chrome DevTools.
- **Applies to:** Any runtime. For Node.js, prefer the built-in `--prof`/`--cpu-prof` and DevTools over Clinic.js.
- **When not to apply / counterpoints:**
  - Sampling profilers can miss short or inlined functions.
  - Profiling in production costs something (Go says so; Scalene reports 10–20%).
  - Gregg's per-language tool list is partly dated. For example, it still lists pyflame, whose repository (uber-archive/pyflame) has been archived since 2019 (GitHub API).
- **Fix risk:** low

### T04-F01 — Make no performance change without evidence (profile/trace plus a written before/after record)
- **Grade:** B · **Verdict:** CORRECTED. The GSO "<5%" figure is dated: GSO's own leaderboard now lists up to 47.06% Opt@1 (July 2026). The StackExchange answer is from 2008, not 2011.
- **Rationale:** Before any change, a profile or trace from a realistic workload must show that the target code dominates the metric that matters. Knuth limits optimisation to the measured "critical 3%", looked at "only after that code has been identified", because intuitive guesses fail. Pike's rules 1–2 say the same. Coz shows that the hottest code in a profile may not move end-to-end performance. The GSO paper (2025) named bottleneck localisation as a key agent failure mode. Agent scores have risen a lot since, but measurement-before-change is still the safeguard.
- **Evidence:**
  - [Revisiting Knuth's "Premature Optimization" Paper](https://probablydance.com/2025/06/19/revisiting-knuths-premature-optimization-paper/) — Malte Skarupke, 2025-06-19, quoting Knuth, "Structured Programming with go to Statements", ACM Computing Surveys 6(4), 1974 — engineering_blog (secondary) — "We should forget about small efficiencies, say about 97% of the time: premature optimization is the root of all evil. Yet we should not pass up our opportunities in that critical 3%."; "In established engineering disciplines a 12% improvement, easily obtained, is never considered marginal" — verified. The original 1974 paper was not text-checked; two secondary sources agree.
  - [Knuth: Premature optimization is the root of all evil - the context](https://hlopko.com/2019/08/03/premature-optimization/) — Marcel Hlopko, 2019-08-03 — engineering_blog (secondary) — "he will be wise to look carefully at the critical code; but only after that code has been identified. It is often a mistake to make a priori judgments... their intuitive guesses fail." — verified with curl.
  - [Notes on Programming in C](https://www.lysator.liu.se/c/pikestyle.html) — Rob Pike, 1989-02-21 — other — Rule 1: "Bottlenecks occur in surprising places, so don't try to second guess and put in a speed hack until you've proven that's where the bottleneck is." Rule 2: "Measure. Don't tune for speed until you've measured, and even then don't unless one part of the code overwhelms the rest." — verbatim.
  - [GSO: Challenging Software Optimization Tasks for Evaluating SWE-Agents](https://arxiv.org/abs/2505.23671) — Shetty, Jain, Liu, Kethanaboyina, Sen, Stoica, arXiv 2025 (revised 2025-10-24) — preprint — "leading SWE-Agents struggle significantly, achieving less than 5% success rate"; failure modes include "challenges in accurately localizing bottlenecks" — verified. **But** the [GSO leaderboard](https://gso-bench.github.io/) (`assets/leaderboard.json`, read 2026-09-23) lists Opt@1 of 47.06% (Claude Opus 4.8, 2026-07-12), 44.12% (Claude Opus 4.7) and 40.2% (GPT 5.5). The headline "<5%" should therefore not be cited as current.
  - [Coz: Finding Code that Counts with Causal Profiling](https://arxiv.org/abs/1608.03676) — Curtsinger & Berger, SOSP 2015 (arXiv 2016) — peer_reviewed — conventional profilers "only report where programs spent their time: optimizing that code may have no impact on performance"; Memcached +9%, SQLite +25%; "in most cases, these optimizations involve modifying under 10 lines of code" — verified.
  - [Is premature optimization really the root of all evil?](https://softwareengineering.stackexchange.com/questions/80084/is-premature-optimization-really-the-root-of-all-evil) — accepted answer by Scott Dorman, score 433, 2008-10-17 — practitioner_forum — "There are obvious optimizations (like not doing string concatenation inside a tight loop) but anything that isn't a trivially clear optimization should be avoided until it can be measured." — verified through the StackExchange API with curl.
- **Detect:** For every diff justified by speed, check that it links to a profile (flame graph, pprof, py-spy, Scalene) and a before/after benchmark from the same machine. List candidates with `git log -p | grep -inE 'perf|optimi|faster|speed'` (a heuristic), then check each for attached evidence.
- **Tools:** py-spy; scalene; go tool pprof; perf; cargo flamegraph; samply; node `--cpu-prof`; Coz.
- **Applies to:** All languages. Mandatory for micro-level and constant-factor changes. Structural defect classes (F03–F10) may be flagged from code review, but their fixes still need a before/after measurement.
- **When not to apply / counterpoints:**
  - Duffy (2010) and Muratori (2023) argue that "profile first" misses slowness spread thinly across the code.
  - Knuth himself says an "easily obtained" 12% should not be dismissed.
  - A flat profile does not prove there is nothing to fix. It points to structural causes.
- **Fix risk:** low

### T04-F03 — Hunt for accidentally quadratic loops (linear lookup inside a loop over a similarly sized collection)
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** The usual form is a linear search (list `in`, `Array.includes`/`indexOf`/`find`/`filter`, or a nested loop matching by id) inside a loop over a collection of similar size. When n is not provably small, replace it with a one-time index (Set, Map, dict, HashSet). Quadratic code passes tests on small inputs and fails in production. Toddler, a peer-reviewed detector, found 42 new such bugs in six mature Java projects. Named production cases (WMI, GTA Online) are documented in detail.
- **Evidence:**
  - [Why Accidentally Quadratic?](https://www.tumblr.com/accidentallyquadratic/113840433022/why-accidentally-quadratic) — Nelson Elhage (Accidentally Quadratic blog; authorship confirmed on nelhage.com), 2015-03-17 — engineering_blog — "If you do a linear operation linearly many times, you get quadratic!"; "Program performance on small inputs is almost always dominated by constant factors" — verbatim.
  - [O(n^2), again, now in WMI](https://randomascii.wordpress.com/2019/12/08/on2-again-now-in-wmi/) — Bruce Dawson, 2019-12-08 — engineering_blog — "O(n^2) is the sweet spot of badly scaling algorithms: fast enough to make it into production, but slow enough to make things fall down once it gets there."; 96.5% of CPU samples in one loop; time ≈ 1.6×n² minutes; the command holds a WMI lock, and over 100 processes were blocked — verified.
  - [How I cut GTA Online loading times by 70%](https://nee.lv/2021/02/28/How-I-cut-GTA-Online-loading-times-by-70/) — t0st, 2021-02-28 — engineering_blog — a 10MB JSON with about 63k entries; `strlen` called repeatedly via `sscanf`; a duplicate check by linear scan made about 1.98 billion comparisons; "69.4% load time improvement" (about 6 min down to 1 min 50 s); Rockstar fixed it and paid a $10k bounty — verified.
  - [Toddler: Detecting performance problems via similar memory-access patterns](https://doi.org/10.1109/icse.2013.6606602) — Nistor, Song, Marinov, Lu, ICSE 2013 — peer_reviewed — reports "code loops whose computation has repetitive partially similar memory-access patterns across loop iterations"; "42 new bugs in six Java projects" — abstract verified via OpenAlex. Toddler was evaluated on 9 Java codebases, and "developers so far fixed 10 bugs and confirmed 6 more", so not all 42 are confirmed.
  - [How we decreased GitLab repo backup times from 48 hours to 41 minutes](https://about.gitlab.com/blog/how-we-decreased-gitlab-repo-backup-times-from-48-hours-to-41-minutes/) — Karthik Nayak & Manuel Kraft, GitLab, 2025-06-05 — engineering_blog — a flame graph of `git bundle create` on 10,000 references showed "approximately 80% of the execution time is consumed by the object_array_remove_duplicates() function", which was introduced in 2009 and used nested loops. The fix "replaces the nested loops with a map data structure". A benchmark with 10 runs per variant: "ran 6.12 ± 0.10 times faster" at 100,000 refs. The largest repository's backup went from 48 hours to 41 minutes. Added by the verifier (second pass). It is a textbook profile → index → A/B-benchmark case, and the defect sat in a mature project for about 16 years.
  - [prefer-set-has](https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/prefer-set-has.md) — eslint-plugin-unicorn — official_docs — "Prefer Set#has() over Array#includes() when checking for existence or non-existence." It does not report arrays checked only once. It is **autofixable**, so review the fix. It flags arrays used for repeated lookups, not loops as such — verified.
  - [HN: Revisiting Knuth's "Premature Optimization" Paper](https://news.ycombinator.com/item?id=44386236) — HN user sfn42, 2025 — practitioner_forum — "two lists and you need to go through the first one and find the corresponding element by id in the second. The naive implementation uses linear search of the second list, making the algorithm O(n^2). This will stall and take hours, days or longer to run when the lists get large". In a follow-up, sfn42 reports real lists of 50k and 80k elements where a report fell from about 30 min to 5 min "changing two lines of code to make a dictionary" — verified via the HN API.
- **Detect:**
  - **ast-grep (JS/TS):** `{any: [{pattern: '$A.includes($B)'}, {pattern: '$A.indexOf($B)'}, {pattern: '$A.find($$$)'}], inside: {any: [{kind: for_in_statement}, {kind: for_statement}, {kind: while_statement}], stopBy: end}}`. Also check `.filter`/`.map` callbacks that contain `.find`/`.includes`.
  - **Python:** match `$X in $L` inside `for` loops, then check by hand that `$L` is a list or tuple.
  - **Lint:** unicorn `prefer-set-has`.
  - **Dynamic:** time at n, 2n, 4n, 8n. About 4x per doubling means quadratic (see F17).
- **Tools:** ast-grep; eslint-plugin-unicorn; hyperfine; criterion; pytest-benchmark; ETW/WPA; perf.
- **Applies to:** All languages. Highest yield in data transforms, joins done in application code, import/sync jobs, and handlers that iterate over collections from a database or network.
- **When not to apply / counterpoints:**
  - Pike rule 3: "Fancy algorithms are slow when n is small, and n is usually small."
  - Building a Set/Map costs allocation and needs hashable keys.
  - JS Set/Map compare object keys by identity, whereas the original `find()` predicate may compare by value.
- **Fix risk:** medium

### T04-F06 — Remove extraneous fetching and unbounded result sets
- **Grade:** B · **Verdict:** VERIFIED (clarified: the 4.17 s → 0.69 s result covers all fixes, including feature removal and pagination)
- **Rationale:**
  - Project only the needed columns.
  - Filter and aggregate in the data store, not in memory.
  - Stream or iterate large results.
  - Put a limit or pagination on every list endpoint whose result grows with the data.

  Missing pagination was the most common scalability cause in Yang et al. (15 of 34 non-scaling actions, "always fixed by pagination"). Azure's lab: the database returned 80,503 bytes to build a 19,855-byte response. Aggregating in the database cut data per request from more than 280 KB to 53 bytes and raised sustained throughput from about 2,000 to more than 25,000 req/min.
- **Evidence:**
  - [How not to structure your database-backed web applications](https://hyperloop-rails.github.io/220-HowNotStructure.pdf) — Yang et al., ICSE 2018 — peer_reviewed — "the most common cause for scalability problems is that a controller action displays all database records satisfying certain condition in one page... contributes to 15 out of the 34 problematic actions that do not scale well... always fixed by pagination"; "the lack of pagination still widely exists in latest versions"; "11 out of 12 applications have pages whose [end-to-end load time] exceeds 2 seconds"; average end-to-end time fell from 4.17 s to 0.69 s across all 39 fixed actions — PDF read. The paper files pagination under "Content Display Trade-offs", meaning it is a UI/functional change.
  - [Extraneous Fetching antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/extraneous-fetching/) — Microsoft Azure Architecture Center, 2022-07-25, updated 2026-09-16 — official_docs — "For operations that have to support unbounded queries, implement pagination"; "The call to AsEnumerable is a hint that there's a problem"; 80,503 vs 19,855 bytes; "from over 280 KB per transaction to 53 bytes... from around 2,000 to over 25,000"; projection alone: 100 → 350 req/s — verbatim.
  - [Database access optimization](https://docs.djangoproject.com/en/stable/topics/db/optimization/) — Django 6.1 — official_docs — "Don't retrieve things you don't need"; values()/values_list(), defer()/only(); "the caching behavior of the QuerySet can cause a large amount of memory to be used. In this case, iterator() may help." — verified.
  - [The Morning Paper summary](https://blog.acolyer.org/2018/06/28/how-_not_-to-structure-your-database-backed-web-applications-a-study-of-performance-bugs-in-the-wild/) — Adrian Colyer, 2018-06-28 — engineering_blog (secondary) — 4.17 s → 0.69 s; the 40 semantics-preserving fixes averaged 2.2× — verified against the paper.
- **Detect:**
  - `grep -rniE 'select \*'`.
  - EF: `AsEnumerable()` or `.ToList()` before `.Where(`.
  - Django: `.all()` iterated in list views with no slice or paginator.
  - Prisma/TypeORM: `findMany()`/`find()` with no `take`/`limit` in handlers.
  - List every list/export endpoint and check that its size is bounded.
  - Compare bytes from the data store with bytes in the response (Azure's method).
- **Tools:** grep/ripgrep; ast-grep; APM (bytes per span); EXPLAIN / `QuerySet.explain()`.
- **Applies to:** Data-backed services and batch jobs. Pagination applies to user- or API-facing list endpoints whose data grows without bound.
- **When not to apply / counterpoints:**
  - Azure: "Offloading processing to the database isn't always the best option" (Busy Database).
  - Small, fixed reference tables need no pagination.
  - Adding pagination changes the API contract and needs owner sign-off.
- **Fix risk:** high

### T04-F20 — A performance fix must preserve behaviour
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Run the full test suite. Add a characterisation or differential test comparing old and new output on representative and random inputs. Review the known semantic traps before merging:
  - fail-fast `Promise.all`;
  - stale cache reads;
  - API contract changes from pagination or limits;
  - unsafe autofixes;
  - floating-point reassociation or fast-math;
  - identity vs equality when switching to Set/Map;
  - order changes from parallelisation.

  Never enable `-ffast-math`/`-Ofast` or an equivalent in a hardening pass.
- **Evidence:**
  - [Options That Control Optimization](https://gcc.gnu.org/onlinedocs/gcc/Optimize-Options.html) — GNU GCC manual (current) — official_docs — `-ffast-math` "is not turned on by any -O option besides -Ofast since it can result in incorrect output for programs that depend on an exact implementation of IEEE or ISO rules/specifications for math functions" — verbatim; confirmed with curl, because WebFetch truncated the page.
  - [RUF017 fix safety](https://docs.astral.sh/ruff/rules/quadratic-list-summation/) — Astral (Ruff) — official_docs — "This fix is always marked as unsafe"; "code that previously raised an error may silently succeed"; "the fix could remove comments" — verbatim.
  - [Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) — MDN — official_docs — "Promise.all() will reject immediately upon any of the input promises rejecting." — verbatim.
  - [Ruby reject!](https://www.tumblr.com/accidentallyquadratic/157496054437/ruby-reject) — Nelson Elhage, 2017-02-20 — engineering_blog — the bug #2545 correctness fix (keeping the array consistent on early exit from the block) made `reject!` quadratic — verified.
  - [How not to structure your database-backed web applications](https://hyperloop-rails.github.io/220-HowNotStructure.pdf) — Yang et al., ICSE 2018 — peer_reviewed — "We carefully apply fixes to make sure we do not change the program semantics. Finally, for two actions in Lobster, we eliminate the expensive checking about whether to show user guidelines" — verbatim from the PDF.
- **Detect:**
  - Full suite green.
  - A differential test (keep the old function as an oracle; property-based tests with Hypothesis/fast-check).
  - `grep -rnE -- '-ffast-math|-Ofast|fast-math|unsafe-math'` in build files.
  - `ruff check --unsafe-fixes` only with review.
  - OpenAPI diff shows no response contract change.
- **Tools:** test suite; Hypothesis / fast-check; ruff fix-safety levels; OpenAPI diff tools; grep.
- **Agent-specific trap (second pass):** the GSO benchmark had to add a detector for "deceptive optimizations (e.g., memoization, harness hijacking)" (gso-bench.github.io changelog, 2025-11-03). Differential tests should use inputs the optimised code has not seen, so that input-specific memoisation or special-casing is caught.
- **Applies to:** Every performance change in every language.
- **When not to apply / counterpoints:** Some worthwhile fixes are deliberate functional trade-offs (pagination, removing an expensive feature check). In Yang et al., the single largest speedup (39×) was one of these. They need explicit owner sign-off, never silent application.
- **Fix risk:** low

### T04-F10 — Create expensive, thread-safe broker objects once and reuse them
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** HTTP clients, DB pools, cloud SDK clients, Redis multiplexers and compiled templates or schemas should not be constructed per request or per iteration. Do not share objects that are not thread-safe, and do not mutate shared ones. Azure's lab example:
  - per-request `HttpClient` exhausted sockets at about 30 concurrent users;
  - the shared instance handled up to 500 requests/s with average response time halved;
  - an expensive constructor alone raised average response time 20-fold.
- **Evidence:**
  - [Improper Instantiation antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/improper-instantiation/) — Microsoft Azure Architecture Center, 2017-06-05, updated 2026-09-16 — official_docs — "Under heavy load, the web server might exhaust the number of available sockets"; "If a class isn't shareable (not thread-safe), then this antipattern doesn't apply"; setting `DefaultRequestHeaders` before each request "can create a race condition"; "Some resource types are scarce and should not be held onto. Database connections are an example"; the note recommends `IHttpClientFactory` / `PooledConnectionLifetime` "which... ensures timely DNS updates"; "At about 30 users... the system starts to generate exceptions"; "up to 500 requests per second. The average response time was cut in half"; the expensive constructor case: "the average response time increases by a factor of 20" — verbatim.
- **Detect:** Inside handlers and loops, look for `new HttpClient(`, `axios.create(`, `new Pool(`, `createClient(`, `new S3Client(`, `redis.createClient(`. In Python, look for `requests.get(` in loops with no Session, and `boto3.client(` in per-request functions. At runtime, watch for socket or handle exhaustion, TIME_WAIT counts, and time spent in connect/close in thread profiles.
- **Tools:** ast-grep; grep; APM thread profiling; netstat/ss.
- **Applies to:** Services in any language that use network or SDK clients designed for reuse.
- **When not to apply / counterpoints:**
  - Scarce resources such as DB connections must go back to the pool.
  - Long-lived HTTP clients can miss DNS changes (Microsoft's note).
  - The evidence is one vendor's lab measurements, hence grade B.
- **Fix risk:** medium

### T04-F12 — Reject readability-costing micro-optimisations without a benchmark in a profiled hot path
- **Grade:** B · **Verdict:** CORRECTED. Selakovic & Pradel is ICSE **2016**, and the OpenAlex search URL was replaced with the DOI. The STABILIZER result is scoped to LLVM on SPEC CPU2006 in 2013. The Pop Catalin answer dates from 2008. A real source was added for the Clippy quote.
- **Rationale:** Examples: manual unrolling, caching array length, switch instead of polymorphism, bit tricks, avoiding exceptions "for speed". Prefer the idiomatic form. Revert existing micro-hacks that have no benchmark justification when they complicate the code. Micro-optimisations are fragile and depend on the runtime version.
- **Evidence:**
  - [Performance Issues and Optimizations in JavaScript: An Empirical Study](https://doi.org/10.1145/2884781.2884829) — Selakovic & Pradel, ICSE 2016 — peer_reviewed — "98 fixed performance issues from 16 popular client-side and server-side JavaScript projects"; "only 42.68% of all optimizations improve performance consistently across all versions of both engines"; fixes "modify only a few lines of code" — abstract verified via OpenAlex. The engine versions are about ten years old. Nuance (second pass): the full sentence says most fixes modify few lines "without significantly affecting the complexity of the source code". Not every performance fix hurts readability. "Not consistently improving" also includes versions where a fix was neutral, not only slower.
  - [PERF401 manual-list-comprehension](https://docs.astral.sh/ruff/rules/manual-list-comprehension/) — Astral (Ruff) — official_docs — the comprehension "is ~10% faster on Python 3.11, and ~25% faster on Python 3.10". PERF402 and PERF403 quote similar Python-3.11-specific gains. Added by the verifier (second pass). These gains are constant-factor and depend on the interpreter version: good material for the "re-measure on the target runtime" clause.
  - [STABILIZER](https://people.cs.umass.edu/~emery/pubs/stabilizer-asplos13.pdf) — Curtsinger & Berger, ASPLOS 2013 — peer_reviewed — "while -O2 has a significant impact relative to -O1, the performance impact of -O3 over -O2 optimizations is indistinguishable from random noise" — PDF read. This covers LLVM on SPEC CPU2006: it is evidence about measurement noise, and only indirect evidence about source-level micro-optimisations.
  - [PERF203 try-except-in-loop](https://docs.astral.sh/ruff/rules/try-except-in-loop/) — Astral (Ruff) — official_docs — "only enforced for Python versions prior to 3.11"; "zero-cost exception handling is only zero-cost in the 'happy path'" — verbatim.
  - [Notes on Programming in C](https://www.lysator.liu.se/c/pikestyle.html) — Rob Pike, 1989 — other — Rule 3: "Fancy algorithms are slow when n is small, and n is usually small."; Rule 4: "Fancy algorithms are buggier than simple ones, and they're much harder to implement." — verbatim.
  - [SE answer by Pop Catalin](https://softwareengineering.stackexchange.com/questions/80084/is-premature-optimization-really-the-root-of-all-evil) — score 154, 2008-10-17 — practitioner_forum — "Premature micro optimizations are the root of all evil, because micro optimizations leave out context. They almost never behave the way they are expected." — verified via the API.
  - ["Clean" Code, Horrible Performance](https://www.computerenhance.com/p/clean-code-horrible-performance) — Casey Muratori, 2023-02-28 — engineering_blog (dissent) — switch "1.5x faster"; table-driven "10x faster or more"; "nearly 15x"; AVX "20-25x" over virtual dispatch in a tight shape-area loop — verified.
  - [Clippy lint groups](https://doc.rust-lang.org/clippy/lints.html) — Rust Clippy book — official_docs — perf lints are "mostly about code that the compiler can't trivially optimize"; "Perf lints are usually easy to apply, and it is recommended to do so." — verbatim from the book source. Added by the verifier; the researcher quoted it without a URL.
- **Detect:** In diff review, flag changes whose only stated purpose is speed and that add complexity without a benchmark: unrolling, bit twiddling, removed abstractions, hand-inlined code, `for (let i=0, n=a.length; …)`, exceptions replaced by sentinels. Find comments such as `// faster`, `// optimization`, `# perf hack` and ask for their measurements. Check lint perf rules against the target runtime version (Ruff `target-version`).
- **Tools:** code review; git blame/log; ruff (target-version aware); clippy::perf.
- **Applies to:** All languages; most relevant for business and web code. Measured compute kernels (games, codecs, numeric inner loops) are the documented exception.
- **When not to apply / counterpoints:**
  - Muratori shows 10–25× gains in compute-bound loops, and Duffy warns about "peanut butter" costs. Where profiling shows a compute kernel dominates, a less idiomatic structure can be justified with a benchmark and a comment.
  - Clippy's perf lints are the counter-case: they are cheap and recommended.
- **Fix risk:** low

### T04-F11 — Treat adding a cache as a behaviour change, not a free speedup
- **Grade:** B · **Verdict:** CORRECTED. The two Discord "quotes" ("forcing more expensive database lookups", "acceptable but imperfect compromise") do not appear in the article and were replaced with its actual wording.
- **Rationale:** Add a cache only when all of these hold:
  - measurement shows the same expensive request repeated;
  - there is a TTL or eviction policy;
  - writes invalidate the cache;
  - hit/miss counters exist;
  - there is a fallback to the source when the cache fails;
  - the origin is protected while the cache recovers.

  Azure lists these requirements and says to instrument before caching computations. Discord shows that cache size trades off against GC and tail latency.
- **Evidence:**
  - [No Caching antipattern](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/no-caching/) — Microsoft Azure Architecture Center, 2017-06-05, updated 2026-09-17 — official_docs — "Applications that cache dynamic data should be designed to support eventual consistency"; "Before you do that, instrument the application to determine whether the application is really CPU bound"; "Always include instrumentation that detects cache hits and cache misses". When the cache is unavailable, fetch from the source, but "the original data store could be swamped with requests", so use a Circuit Breaker. Measured: "maximum response time is 0.05 ms, compared with 1 ms earlier—a 20× improvement" — verbatim.
  - [Why Discord is switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust) — Jesse Howarth, Discord, 2020-02-04 — engineering_blog — "the trade off of making the LRU cache smaller resulted in higher 99th latency times... If it's not in the cache then we have to do a database load."; "we found a setting that seemed okay. Not completely satisfied, but satisfied enough" — verbatim (replacing the researcher's non-existent quotes).
- **Detect:** For each cache, check:
  - Is there a TTL or maxsize?
  - Is it invalidated on every write path?
  - Is there a hit/miss metric?
  - What happens during a cache outage (circuit breaker)?
  - Is there a test showing staleness is acceptable?

  With production data, check the repeat rate of the cached query (e.g. `sys.dm_exec_cached_plans` UseCounts, as in Azure's example).
- **Tools:** APM metrics; Redis INFO (keyspace_hits/misses); review checklist.
- **Applies to:** Service code that adds memoisation, HTTP/ETag caching or distributed caches during hardening.
- **When not to apply / counterpoints:** Azure also lists No Caching as an antipattern: not caching static reference data is also a defect. The rule is "cache only with a policy and evidence", not "never cache". Azure also warns that adding a cache can shift overload to the web front end.
- **Fix risk:** high

### T04-F15 — Do not gate CI on tight wall-clock microbenchmark thresholds on shared runners
- **Grade:** B · **Verdict:** CORRECTED. The tool list replaces iai-callgrind with its successor Gungraun: iai-callgrind's last crate release is 0.16.1 (2025-07); gungraun is at 0.19.4 (2026-07), and the old repository now carries the Gungraun README.
- **Rationale:** Use one or more of:
  - same-job relative A/B runs;
  - dedicated or bare-metal runners;
  - instruction-count metrics;
  - confirmation reruns.

  Set thresholds above the measured noise. CI noise is larger than many real changes. Bencher (a vendor) reports more than 30% variance on GitHub Actions runners against under 2% on bare metal. Mozilla waits for 12 further data points, uses thresholds of 0.25% to 2%, and still triages false alerts.
- **Evidence:**
  - [Continuous Benchmarking](https://bencher.dev/docs/explanation/continuous-benchmarking/) — Bencher (a commercial vendor with open-source code) — industry_report — "GitHub Action Runners... greater than 30% variance between runs"; bare metal "less than 2% variance"; the three options are bare metal, relative benchmarking and instruction counts — verified. This is a vendor figure, not a peer-reviewed one.
  - [Performance Sheriffing](https://firefox-source-docs.mozilla.org/testing/perfdocs/perf-sheriffing.html) — Mozilla Firefox Source Docs — official_docs — "Why can we not trust a single data point?"; "Why do we need 12 future data points?"; thresholds: AWSY ≥ 0.25%, Talos/Browsertime/Build Metrics ≥ 2%; false alerts come from weekends, low push volume, coalescing and bi-/multi-modal tests — verified.
  - [benchstat](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — The Go Authors — official_docs — with α = 0.05, about 5% of unchanged benchmarks show "significant" changes, and repeated reruns produce false positives — verified.
- **Detect:** Review CI config (`.github/workflows`, `.gitlab-ci.yml`) for benchmark jobs that fail on a small percentage using wall-clock time on shared runners (`runs-on: ubuntu-latest`). Measure the run-to-run coefficient of variation of an unchanged benchmark and compare it with the threshold.
- **Tools:** Bencher; CodSpeed; github-action-benchmark; benchstat; pytest-benchmark `--benchmark-compare-fail`; Cachegrind / Gungraun (formerly iai-callgrind) for instruction counts.
- **Applies to:** Projects that have, or plan, performance regression checks in CI.
- **When not to apply / counterpoints:**
  - Instruction counts are lower-variance but are not time: they miss cache, memory and I/O effects. The Rust Performance Book calls them only "a reasonable alternative".
  - Deleting a noisy gate removes protection. Replace it, do not just drop it.
- **Fix risk:** low

### T04-F16 — Judge service latency by percentiles under open-model load that avoids coordinated omission
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Use open-model / constant-arrival-rate load, measure latency from the intended send time, and record with HdrHistogram-style histograms. Report p50/p95/p99 at several load steps. Averages are not evidence. A closed-loop tool can under-report tail latency by orders of magnitude.
- **Evidence:**
  - [wrk2](https://github.com/giltene/wrk2) — Gil Tene — official_docs — "high latency responses result in the load generator coordinating with the server to avoid measurement during high latency periods"; in the README example (a 1.4 s server stall), the corrected p99 was about 1.27 s against an uncorrected 6.04 ms — verified. This is the tool author's own demonstration.
  - [Chatty I/O antipattern (Example diagnosis)](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/chatty-io/) — Microsoft Azure Architecture Center — official_docs — "If you just look at the average values, you might overlook problems that will get dramatically worse under load." — verbatim.
  - [Performance testing and antipatterns](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/) — Microsoft Azure Architecture Center, updated 2026-06-03 — official_docs — "The only completely sure way to understand how a system behaves under load is to observe it in production... Performance testing is crucial for getting baseline performance metrics." — verbatim.
  - [Constant arrival rate](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/) — Grafana k6 docs — official_docs — "It is an open-model executor, meaning iterations start independently of system response". Added by the verifier to back the tool recommendation.
- **Detect:** Check load-test scripts and reports:
  - closed-loop load (fixed connections, each waiting for its response) with no correction;
  - mean-only reporting;
  - a single load level.

  Require p95/p99 and throughput at several load steps, before and after, in the same environment.
- **Tools:** k6 (constant-arrival-rate) / Gatling; HdrHistogram; APM percentiles. wrk2 is the reference explanation of coordinated omission, but its last commit is from 2019-09-24 (GitHub API, read 2026-09-23). Prefer a maintained open-model load tool for new work.
- **Applies to:** Networked services and APIs. Not libraries or CLIs (use F13).
- **When not to apply / counterpoints:** Full load testing may be too heavy for a small project's hardening pass. For the defect classes above, before/after query counts or bytes transferred can be enough evidence. The coordinated-omission magnitude comes from the tool author's example.
- **Fix risk:** low

### T04-F17 — Add scaling (complexity) checks, not just point benchmarks
- **Grade:** B · **Verdict:** CORRECTED. HN item 44204085 is a comment in the thread "How we decreased GitLab repo backup times from 48 hours to 41 minutes", not a "Dawson's law discussion" as such. hinkley's comment is about a panic threshold based on expected graph size, not about a quadratic graph algorithm. The comment still supports "production n exceeds expected n".
- **Rationale:** For any function that processes a collection, time or count operations at n, 2n, 4n, 8n (up to realistic production sizes) and check the growth ratio. About 2× per doubling means linear; about 4× means quadratic. Keep a regression test at a large n. Quadratic defects hide at small n. Practitioners who found them did so by jumping to big cases and graphing.
- **Evidence:**
  - [Why Accidentally Quadratic?](https://www.tumblr.com/accidentallyquadratic/113840433022/why-accidentally-quadratic) — Nelson Elhage, 2015-03-17 — engineering_blog — "You really need to jump to big cases and draw some graphs, or do some careful source code analysis, to spot the n²."; "Draw the graphs. Don't take slow software for granted." — verbatim.
  - [O(n^2), again, now in WMI](https://randomascii.wordpress.com/2019/12/08/on2-again-now-in-wmi/) — Bruce Dawson, 2019-12-08 — engineering_blog — Dawson plotted sqrt(time) against repository size across six machines and got an "implausibly perfect" line; time ≈ 1.6×n² minutes (the author's repository was 1.9 GB) — verified.
  - [HN comment in "How we decreased GitLab repo backup times from 48 hours to 41 minutes"](https://news.ycombinator.com/item?id=44204085) — HN user hinkley, 2025 — practitioner_forum — "I came onto a project that had done that before and it blew up during my tenure. The worst case graph size was several times the expected case, and long term customers were growing their data sets vertically rather than horizontally". It replies to a suggestion to panic when the node count exceeds expectations. The thread does discuss Dawson's law — verified; context corrected.
  - [How not to structure your database-backed web applications](https://hyperloop-rails.github.io/220-HowNotStructure.pdf) — Yang et al., ICSE 2018 — peer_reviewed — "data-related performance and scalability problems are particularly difficult to expose during in-house testing, as they might only occur with large amounts of data that only arises after the application is deployed" — verbatim from the PDF. Added by the verifier (second pass). This is peer-reviewed support for the premise, which is why the grade stays at B even though the technique itself comes from practitioners.
  - [How we decreased GitLab repo backup times from 48 hours to 41 minutes](https://about.gitlab.com/blog/how-we-decreased-gitlab-repo-backup-times-from-48-hours-to-41-minutes/) — GitLab, 2025-06-05 — engineering_blog — an O(N²) duplicate check added to Git in 2009 surfaced only on repositories with very many references. It was measured at 10,000 and 100,000 refs. Added by the verifier (second pass).
- **Detect:** Write a parameterised benchmark: criterion `BenchmarkId` over sizes, pytest parametrize with the benchmark fixture, Go sub-benchmarks per size, or hyperfine over generated inputs. Compute t(2n)/t(n) and flag ratios near 4 or above. Choose n from the largest observed production size, not from test fixtures.
- **Tools:** criterion; pytest-benchmark; go test -bench; hyperfine; vitest bench.
- **Applies to:** Data-processing functions, importers, sync jobs, graph or tree walks, and large UI lists.
- **When not to apply / counterpoints:** Constant factors and cache effects distort ratios at small n. Measure over at least 3 doublings, well above cache sizes. Code that is quadratic in theory is fine when n is bounded by design (see F03). The evidence for this specific technique is practitioner case studies, not controlled studies.
- **Fix risk:** low

### T04-F21 — Treat AI-written code as possibly inefficient and AI-proposed optimisations as unproven; measure before and after
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. The efficiency gap is measured on LeetCode-style problems with 2024–2025 models, which is indirect evidence for real projects hardened by current agents. The GSO "<5%" figure is outdated: the GSO leaderboard lists up to 47.06% Opt@1 (July 2026). The PIE counterpoint is best-of-8 generations. The procedural part of the rule (measure, F13) keeps its own grade A.
- **Rationale:** The hardening agent should hunt the defect classes in F03–F10. It should collect profiler or scaling evidence before editing and a measured result after (F13, F20). The AI-specific motivation is weaker than first stated:
  - On algorithmic benchmarks, LLM code is slower than efficient human solutions (EffiBench, EffiBench-X).
  - Agents fell well short of experts on real-repository optimisation in 2025 (GSO, SWE-Perf).
  - Newer agents score much higher on GSO.
- **Evidence:**
  - [EffiBench: Benchmarking the Efficiency of Automatically Generated Code](https://arxiv.org/abs/2402.02037) — Dong Huang, Yuhao Qing, Weiyi Shang, Heming Cui, Jie M. Zhang, NeurIPS 2024 — peer_reviewed — "GPT-4 generated code has an average 3.12 times execution time that of the human-written canonical solutions"; extremes of 13.89× time and 43.92× memory; 1,000 LeetCode problems — verified.
  - [EffiBench-X](https://arxiv.org/abs/2505.13004) — Qing, Zhu, Du, Guo, Zhuo et al., arXiv 2025-05-19 — preprint — "the most efficient LLM-generated solutions (Qwen3-32B) achieve only around 62% of human efficiency on average, with significant language-specific variations" — verified.
  - [GSO](https://arxiv.org/abs/2505.23671) — Shetty, Jain et al., arXiv 2025 — preprint — "<5% success rate"; "challenges in accurately localizing bottlenecks" — verified. The [GSO leaderboard](https://gso-bench.github.io/) (read 2026-09-23) lists 47.06% Opt@1 for the best entry (2026-07-12). The metric definitions may differ from the paper's headline number. Second pass, from `assets/leaderboard.json` and the changelog:
  - Opt@1 is defined as the "fraction of tasks where a single attempt achieves ≥95% human speedup and passes correctness tests".
  - Hack-adjusted scores are slightly lower for some entries (Claude Opus 4.7: 44.12 → 42.16).
  - A "Hack Detector" was introduced on 2025-11-03 against "deceptive optimizations (e.g., memoization, harness hijacking)".
  - Tasks were network-isolated on 2026-07-12 after "newer models were sometimes using arbitrary techniques to fetch upstream commits/PR diffs".

  These changelog entries are direct evidence that agent speedups must be checked for gaming, not just measured.
  - [SWE-Perf](https://arxiv.org/abs/2507.12415) — He, Liu, Du et al., ICML 2026 (arXiv v2, 2026-07-01) — peer_reviewed — 140 instances from performance-improving PRs; "substantial capability gap between existing LLMs and expert-level optimization performance" — verified.
- **Detect:** A process rule for the skill:
  1. Run the static detectors for F03–F10.
  2. For each candidate, collect a profile or scaling measurement before editing.
  3. Drop candidates that are not on a measured path or do not scale with production data sizes.
  4. After editing, attach benchmark results (F13) and test evidence (F20).
- **Tools:** ast-grep; ruff; eslint/oxlint; profilers (F02); benchmark harnesses (F13).
- **Applies to:** Codebases written wholly or partly by LLM agents and hardened by an agent.
- **When not to apply / counterpoints:**
  - PIE (ICLR 2024): on competitive-programming C++ with gem5 simulation, the fine-tuned approach reached "a mean speedup of 6.86 with eight generations", above "average optimizations from individual programmers (3.66)" (verified in the arXiv abstract). LLMs can optimise when tests and reliable measurement exist.
  - Rising GSO scores suggest that the weakness is shrinking quickly.
- **Fix risk:** low

### T04-F19 — For services, triage at the resource level (USE method) before changing code
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** For each resource (CPU, memory, disk, network, connection and thread pools, locks), check utilisation, saturation and errors, and look at production telemetry before picking code targets. This stops a hardening pass from optimising CPU code when the limit is a saturated pool or disk.
- **Evidence:**
  - [The USE Method](https://www.brendangregg.com/usemethod.html) — Brendan Gregg — engineering_blog — "For every resource, check utilization, saturation, and errors."; claims it "solves about 80% of server issues with 5% of the effort"; it can "only find certain types of issues – bottlenecks and errors" — verified.
  - [Performance testing and antipatterns](https://learn.microsoft.com/en-us/azure/architecture/antipatterns/) — Microsoft Azure Architecture Center — official_docs — "It's difficult to simulate real users in a test environment... Instrumentation and logging are key to finding the root cause, but you also have to know what to look for." — verbatim.
- **Detect:** Build a checklist table per resource from APM or OS tools (vmstat, iostat, sar, pool metrics, DB wait stats). If no production telemetry exists, record that as a finding and limit the performance scope to static defect classes plus local benchmarks.
- **Tools:** vmstat; iostat; sar; perf; APM dashboards; DB wait statistics.
- **Applies to:** Deployed services with telemetry. Less relevant for libraries and CLIs.
- **When not to apply / counterpoints:** The "80%/5%" figure is the author's own claim, not an independent study (hence grade C). Resource metrics do not reveal algorithmic inefficiency in code that is not yet under load.
- **Fix risk:** low

## Practitioner voice

- [HN on "Clean Code, Horrible Performance"](https://news.ycombinator.com/item?id=34966137) — yashap names the real bottlenecks as "Slow DB queries", "Lack of concurrency/parallelism" and missing caching, not dispatch overhead. mabbo says most software spends "99.9% of the time waiting for user input". citrin_ru dissents: "Write slow code now, profile and optimize later is how we got all slow software because second step - optimization practically never happens."
- [HN on Knuth's paper](https://news.ycombinator.com/item?id=44386236) — tialaramex: "If you don't have any profiling then in fact every optimisation is premature." sfn42: joining two lists by id with a linear search is O(n²). Their real report with 50k and 80k elements went from about 30 min to 5 min "changing two lines of code to make a dictionary". hinkley *(gist corrected)*: a deploy-time batch job made several service calls per customer, plus one call per customer to check it was still a customer. hinkley switched to a paginated active-customers endpoint ("~400x more efficient") and an existing DB column. Outbound requests fell to "around 1/8 of the original", and a workload estimated at 100–120 minutes finished in "Four and a half minutes". dan-robertson: "some designs would never meet [performance goals]".
- [HN comment on scaling assumptions](https://news.ycombinator.com/item?id=44204085) *(context corrected)* — the thread is "How we decreased GitLab repo backup times from 48 hours to 41 minutes", which discusses Dawson's law. hinkley: "The worst case graph size was several times the expected case". Expected n understates production n.
- [How I cut GTA Online loading times by 70%](https://nee.lv/2021/02/28/How-I-cut-GTA-Online-loading-times-by-70/) — a player profiled a shipped AAA game. Repeated `strlen` via `sscanf` over a 10MB JSON, plus a linear-scan duplicate check (about 1.98 billion comparisons), were behind a "69.4% load time improvement" (about 6 min → 1 min 50 s). Rockstar fixed it and paid a $10k bounty.
- [How we decreased GitLab repo backup times from 48 hours to 41 minutes](https://about.gitlab.com/blog/how-we-decreased-gitlab-repo-backup-times-from-48-hours-to-41-minutes/) *(added by the verifier)* — GitLab engineers (2025) used a flame graph and found one 2009-era Git function with nested loops using about 80% of `git bundle create` time. They replaced the loops with a map, benchmarked it at 6.12 ± 0.10x faster (10 runs), upstreamed the fix, and cut their largest backup from 48 h to 41 min. It is a complete profile → fix → A/B → upstream loop.
- [O(n^2), again, now in WMI](https://randomascii.wordpress.com/2019/12/08/on2-again-now-in-wmi/) — Bruce Dawson traced a Windows WMI slowdown to one loop taking 96.5% of CPU samples. The time was about 1.6×n² minutes, while a lock hung more than 100 processes.
- [Why Discord is switching from Go to Rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust) — GC scans of a cache holding tens of millions of entries every 2 minutes caused latency spikes. A smaller cache gave smaller spikes but higher p99 from database loads. Cache size is a trade-off, not a free win.
- [Ruby reject!](https://www.tumblr.com/accidentallyquadratic/157496054437/ruby-reject) *(gist corrected: not "three releases")* — `Array#reject!` was quadratic from Ruby 1.9.3 through 2.3, because a correctness fix switched to deleting each element immediately. Correctness fixes and performance fixes can undo each other.
- [The "premature optimization is evil" myth](https://joeduffyblog.com/2010/09/06/the-premature-optimization-is-evil-myth/) — Joe Duffy (2010): the quip is "used [to] defend sloppy decision-making"; "'peanut butter' problems add up in a hard to identify way". Developers need a performance budget and must "know what things cost".
- [SE: Is premature optimization really the root of all evil?](https://softwareengineering.stackexchange.com/questions/80084/is-premature-optimization-really-the-root-of-all-evil) — top answers (433 and 154 votes, 2008): obvious fixes such as avoiding "string concatenation inside a tight loop" are fine, but everything else "should be avoided until it can be measured". "micro optimizations leave out context".
- [Strict loading in Rails 8](https://thoughtbot.com/blog/strict-loading-in-rails-8-a-railsy-way-to-avoid-n-1-queries) — thoughtbot (2025) recommends `:n_plus_one_only` and log mode in production "to avoid crashing the application". FactoryBot setup needs a workaround: enforcement has rollout costs.
- [Mozilla Performance Sheriffing](https://firefox-source-docs.mozilla.org/testing/perfdocs/perf-sheriffing.html) — sheriffs do not trust single data points and wait for 12 more before alerting. They still triage false alerts from weekends, coalescing and multi-modal tests.
- [Clinic.js](https://github.com/clinicjs/node-clinic) — long a standard Node.js profiling recommendation, it now says it "is not being actively maintained" and results "may not be accurate". Tools in older lists can quietly go stale.

## Contradictions and open questions

**Contradictions (reported, not resolved)**
1. **Profile first versus spread-out slowness.** Knuth, Pike and the StackExchange consensus say measure first and ignore small efficiencies about 97% of the time. Duffy, Muratori and citrin_ru say this produces "peanut butter" slowness that no profile shows, and that "optimize later" rarely happens. Knuth himself says an easily obtained 12% is not marginal. The working resolution used here: structural defect classes may be flagged from review, while constant-factor changes need a profile.
2. **Muratori versus I/O-bound practice.** Muratori's 10–25× gains come from compute-bound loops. yashap and mabbo say application bottlenecks are databases, I/O and concurrency. Both are probably right in their own domains.
3. **Batching versus over-fetching.** Azure Chatty I/O says batch and eager-load. Extraneous Fetching warns that this over-corrects, and Busy Database warns against pushing too much work into the database. Yang et al. document both slow lazy loading and slow eager loading. The right fix depends on measured usage.
4. **Async everywhere versus short sync I/O.** Azure recommends async I/O almost everywhere, yet says short, uncontended I/O "might be more performant as synchronous" and that async wrappers "consume more resources".
5. **Parallelising awaits.** ESLint `no-await-in-loop` encourages parallelising, while its own "When Not To Use It" section and MDN's fail-fast semantics show the risks.
6. **Hot spots versus impact.** Coz argues that optimising the hot spot a conventional profiler shows "may have no impact on performance".
7. **Agent optimisation skill.** The GSO paper (<5%, 2025) conflicts with the GSO leaderboard (47.06% Opt@1, July 2026), and PIE (6.86× best-of-8 on competitive C++) conflicts with SWE-Perf's "substantial capability gap". Agent capability is moving fast. Any AI-specific claim in the skill should be dated.
8. **Wall-clock versus instruction counts.** Wall-clock is ground truth but noisy (more than 30% on shared CI per a vendor). Instruction counts are stable but miss time and memory effects. No source settles which should gate CI.

**Open questions**
- No source gives a principled "small n" threshold below which O(n²) is acceptable. Pike's rule is qualitative. Heuristic: use the largest collection size observed in production.
- Should a hardening pass add pagination or limits at all? Yang et al. classify pagination as a display trade-off, and the biggest speedup in that study came from removing a feature. This needs an owner decision, not an autonomous edit.
- Knuth's 1974 paper was not text-checked. The quotes rely on two concordant secondary sources.
- SonarSource S1643 (Java string concatenation in loops) was not fetched, so the Java part of F04 is unverified.
- Laaber et al., "Software microbenchmarking in the cloud. How bad is it really?" (EMSE 2019), was not accessed. CI-noise numbers come from a vendor (Bencher) and Mozilla docs. Grambow et al. (IEEE TCC, with Laaber) is the closest peer-reviewed source verified here.
- Jin et al. (PLDI 2012) on real-world performance bugs was not verified.
- The Azure measurements are lab tests from pages first written in 2017 (Chatty I/O, Synchronous I/O, Improper Instantiation, No Caching) and 2022 (Extraneous Fetching), refreshed in 2026. They illustrate orders of magnitude; they are not field studies.
- The GSO leaderboard's Opt@1 ("≥95% human speedup and passes correctness tests", single attempt) may not be the same metric as the paper's "success rate". The leaderboard JSON and changelog were inspected, but not a full methodology write-up. The leaderboard's own metadata says `last_updated: 2026-03-10`, while its entries go up to 2026-07-12.
- The weakest remaining link is the AI-specific motivation (F21). Agent capability on optimisation benchmarks moved from under 5% to about 47% in roughly a year, so any number the skill quotes will date quickly. The durable, well-sourced part is the process: measure, then differential-test, then check for gaming.
- How stable is the Vitest 5 bench API across minor versions? Which Node profiler should replace Clinic.js (built-in `--cpu-prof`/`--prof`, 0x, DevTools)?
- How can a solo developer prove an improvement without bare-metal runners? The sources describe options (same-job A/B, instruction counts, repeated local runs with benchstat-style statistics) but give no validated recommendation.

## Dropped findings

None. All 21 findings survived. Seven were corrected (F01, F04, F05, F11, F12, F15, F17) and one was downgraded (F21). Individual quotes that were dropped or replaced:
- Discord's "forcing more expensive database lookups" and "acceptable but imperfect compromise" do not exist.
- hinkley's "about 400 external calls per customer, cut to 1" misreads the comment.
- The Ruby reject! post does not say "about three releases".
- The Python docs no longer document CPython's in-place `str +=` optimisation.
