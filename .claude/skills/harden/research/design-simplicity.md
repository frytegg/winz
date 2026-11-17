# Design complexity, abstraction and modularity (and the debates)
> Code T05 · slug design-simplicity · verified 2026-09-23 · counts: verified 9 / corrected 6 / downgraded 2 / dropped 0

## Summary

This dossier covers complexity at the design level:
- when to extract a function and when to inline one;
- pass-through methods and shallow layers;
- wrong and speculative abstractions;
- how to decide about duplication;
- information hiding;
- coupling (connascence, cycles, co-change);
- inheritance and class size;
- how to make these changes without breaking behaviour.

Outside sources broadly agree that complexity comes from dependencies and hidden knowledge more than from length (Parnas 1972; Ousterhout; Hickey; Beck and Constantine).

**The Ousterhout-Martin exchange.** The public discussion between Ousterhout and Martin (September 2024 to February 2025) shows that the leading voices disagree about how far to decompose. Martin called "a fair assessment" the joint summary saying that *Clean Code* 1st ed. "doesn't provide much guidance on how to recognize over-decomposition". In the same exchange, Martin's rewrite split one early-exit loop into two, and Ousterhout measured a 3-4x slowdown. Martin replied that he "would have caught that too had I thought to profile". He then wrote a version that was still decomposed and was faster than Ousterhout's (440 ms vs 561 ms for a million primes). So the regression came from splitting the loop, not from decomposition as such.

**The strongest empirical evidence is at the architecture level.**
- Mo, Cai, Kazman, Xiao and Feng (IEEE TSE 47(5), 2021) studied 19 projects: 15 open-source Java projects and 4 commercial C# projects. Files involved in architecture anti-patterns are much more bug-prone and change-prone. The largest gap was about 120x the bug-fix frequency in Cassandra, and in Camel such files changed more than 6x as often. Unstable Interface and Crossing contribute the most; Package Cycle contributes less. These results are correlations, and the authors say they may not generalise beyond OO languages.
- Oyetoyan et al. (SANER 2015) found that cycles among Java classes are associated with higher change-proneness of nearby classes. They found no simple criterion that separates harmful cycles from harmless ones.

**Evidence at the class and method level conflicts.**
- **Smelly and God classes.** Palomba et al. (EMSE 2018; 13 smell types, 30 projects) found smelly classes more change- and fault-prone. Olbrich et al. (ICSM 2010, three systems) found God and Brain classes more change- and defect-prone in absolute terms, but less so once normalised by size.
- **Inheritance depth.** Daly et al. (EMSE 1996) found 3 levels of inheritance quicker to maintain than flat code. Prechelt et al. re-ran the experiment (JSS 2003) and found that less inheritance was faster for their tasks. Their joint conclusion is that depth as such matters little; the number of relevant methods explains maintenance effort better.
- **Design patterns.** A controlled experiment (Prechelt et al., TSE 2001; 29 professional engineers, nine tasks) found positive effects from pattern flexibility in most tasks. One such effect held even though the Decorator's flexibility was superfluous. There were negative effects in a few tasks, such as an unnecessary Observer. The authors recommend the pattern "unless there is a clear reason to prefer the simpler solution", which partly cuts against YAGNI.

**Official guidance** is firmly against speculative interfaces and over-engineering: Google Testing on the Toilet (2017), the Google code review guide, Go CodeReviewComments and the Google Go style guide.

**Duplication cuts both ways.** Practitioner sources (Metz, Abramov, tef, Dodds, grug) prefer duplication to the wrong abstraction. HN pushback and GitClear's 2025 vendor data point the other way. In GitClear's data, lines classified as copy/pasted rose from 8.3% to 12.3% of changed lines from 2021 to 2024, while lines associated with refactoring (moved) fell from 25% to under 10%. This happened while AI assistants spread. The data is industry-wide and correlational, and it is not split into AI-authored and human-authored lines. The skill therefore has to judge duplication in both directions.

**How the rules are built.** They rely on two-sided tests (deep vs shallow; the Rule of Three plus co-change evidence) rather than one-directional mandates. They rank architecture and co-change findings above size-based ones. They restrict changes to non-exported code by default and require commits that change structure only.

**Limitations.**
- WebSearch budgets ran out in both the research and verification passes. Sources were then reached by direct fetches, publisher and author PDFs, HAL, Crossref, Semantic Scholar, the HN Algolia API and the StackExchange API.
- OpenAlex rate-limited this pass. The academic abstracts were re-confirmed from author PDFs or open archives where possible, and this is noted per source.
- Reddit was not reachable.
- The books by Ousterhout (APOSD 2nd ed.), Beck (*Tidy First?*) and Fowler (*Refactoring* 2nd ed.) were checked through the authors' own lecture notes, the Ousterhout-Martin document, publisher (InformIT) excerpts, and secondary notes and reviews (Sivers, Warne).

## Findings

### T05-F10 — Treat architecture anti-patterns as top-priority risk signals (Unstable Interface and Crossing first, then modularity violations and cycles), break cycles case by case, and lock in dependency rules in CI
- **Grade:** A for the association between anti-patterns and bug/change-proneness; B for the remedy (breaking them). · **Verdict:** CORRECTED.
  - The rule was re-weighted. The source says Unstable Interface and Crossing "contribute the most by far" and Package Cycle "has smaller impact", so cycles are no longer the headline.
  - The findings are correlational and cover Java and C# only.
  - The 120x figure is the maximum observed, in Cassandra. Across projects, the increase in bug frequency ranged from 117% (OpenJPA) to 11,968% (Cassandra).
  - No study shows directly that breaking these structures reduces defects.
- **Rationale:**
  - Mo et al. studied 19 projects. Files in anti-patterns were more bug- and change-prone, and the more anti-patterns a file is in, the worse it gets. All tests were significant with large effect sizes (Hedges' g of 1.8, 1.2, 2.7 and 1.8 for the four measures).
  - Oyetoyan et al. independently found that cycles raise the change-proneness of nearby Java classes.
  - The closest evidence on the remedy is Kim et al. (2012). Windows 7 binaries refactored by a dedicated team showed fewer inter-module dependencies. The top 25% most frequently refactored binaries reduced post-release defects 12.2% more than other modified binaries. This is observational.
- **Evidence:**
  - [Architecture Anti-patterns: Automatically Detectable Violations of Design Principles](https://www.cs.drexel.edu/~yc349/papers/2019/tse2019.pdf) — Mo, Cai, Kazman, Xiao, Feng, IEEE TSE 47(5), 2021 (DOI 10.1109/TSE.2019.2910856) — peer_reviewed. Verified in the full PDF; venue confirmed via Crossref.
    - Abstract: "Through our analyses of 19 large-scale software projects... 1) files involved in these architecture anti-patterns are more error-prone and change-prone; 2) the more anti-patterns a file is involved in, the more error-prone and change-prone it is; and 3) ... Unstable Interface and Crossing contribute the most by far."
    - Camel: change-frequency increase of 640%, "changed more than 6 times as much". "The greatest increase is 11,968%, Bug Frequency (BF) of Cassandra... about 120 times more than non-infected files."
    - "Package Cycle has smaller impact."
    - Threats to validity: "We only analyzed nineteen projects implemented in Java or C#... we can not claim that our results are generalizable across all software projects, especially for those using non-object-oriented languages."
  - [Circular dependencies and change-proneness: An empirical study](https://hal.science/hal-01203525v1) — Oyetoyan, Falleri, Dietrich, Ježek, SANER 2015, pp. 241-250 (DOI 10.1109/SANER.2015.7081834) — peer_reviewed — "(1) the presence of cycles can have a significant impact on the change proneness of the classes near these cycles and (2) neither subtype knowledge nor the location of the cycle within the package containment tree are suitable criteria to distinguish between critical and harmless cycles." — Abstract verified on HAL; metadata via Crossref. The study covers Java classes only.
  - [A field study of refactoring challenges and benefits](https://thomas-zimmermann.com/publications/files/kim-fse-2012.pdf) — Kim, Zimmermann, Nagappan, FSE 2012 (DOI 10.1145/2393596.2393655) — peer_reviewed — "the binary modules refactored by this team experienced significant reduction in the number of inter-module dependencies and post-release defects"; "the top 25% of frequently refactored binaries reduced the number of post-release defects 12.2% more than other modified binaries on average." — Verified in the author PDF.
  - [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — sverweij, 2026 — official_docs — `circular`: "A Boolean indicating whether or not to match module dependencies that end up where you started (a.k.a. circular dependencies)". Example rule `"to": { "circular": true }`. Also an `orphan` attribute and folder-scope cycle detection. — Verified in the raw markdown.
  - [Import Linter contract types](https://import-linter.readthedocs.io/en/stable/contract_types/) — seddonym, 2026 — official_docs — "Layers: Enforce a 'layered architecture'", "Independence: Prevent a set of modules depending on each other", "Acyclic siblings: Forbid dependency cycles between siblings". The CLI is `lint-imports`. — Verified; the repo is active (pushed Sep 2026).
  - [ArchUnit User Guide](https://www.archunit.org/userguide/html/000_Index.html) — ArchUnit 1.5.0 guide — official_docs — `slices().matching("com.myapp.(*)..").should().beFreeOfCycles()` and `.whereLayer("Service").mayOnlyBeAccessedByLayers("Controller")` — Verified.
  - [Code Maat README](https://github.com/adamtornhill/code-maat) — Adam Tornhill — official_docs — "Logical coupling refers to modules that tend to change together. Modules that are logically coupled have a hidden, implicit dependency between them". Defaults: `--min-coupling 30`, `--max-changeset-size 30`, `--min-revs 5`. — Verified. The repo is not archived; the last push was July 2025 and the last release is v1.0.4 (Feb 2023). The README says the analyses "have evolved into CodeScene".
  - [The Go Programming Language Specification](https://go.dev/ref/spec) — The Go Authors — official_docs — "It is illegal for a package to import itself, directly or indirectly" — Verified.
- **Detect:**
  - JS/TS: add the dependency-cruiser rule `{ name: 'no-circular', severity: 'error', from: {}, to: { circular: true } }` and run `depcruise src`.
  - Python: import-linter with `layers`, `independence` or acyclic-siblings contracts; run `lint-imports`.
  - JVM: ArchUnit, `slices().matching("..myapp.(*)..").should().beFreeOfCycles()`.
  - Go: the compiler already forbids import cycles, so look for co-change at package level instead.
  - Co-change: build a git2 log with `git log --all --numstat --date=short --pretty=format:'--%h--%ad--%aN' --no-renames > logfile.log`, then run `java -jar code-maat-1.0.4-standalone.jar -l logfile.log -c git2 -a coupling`.
  - Flag coupled pairs with no import edge (modularity violation).
  - Flag high fan-in files that are also in the top decile of change frequency (unstable interface).
  - Flag files with both high fan-in and high fan-out (crossing).
  - Rank these above cycles.
- **Tools:** dependency-cruiser, import-linter, ArchUnit, code-maat, git.
- **Applies to:** Any multi-module codebase. The co-change parts need git history, so this is most useful on projects older than a few months or with 100+ commits. The empirical base is OO (Java/C#).
- **When not to apply / counterpoints:**
  - Oyetoyan et al. found no reliable criterion that separates harmful cycles from harmless ones, so each cycle needs judgement.
  - Mo et al. note that many low-level smells "do not incur high maintenance costs".
  - Breaking a cycle is a structural change that touches many files.
  - In JS/TS, Python and Ruby, import cycles determine module initialisation order. Breaking one can change side-effect ordering, such as top-level registration and singletons. (Engineering caution, not from a source.)
  - Thresholds such as code-maat's 30% default are tool defaults, not validated cut-offs. Mo et al. also leave their thresholds configurable and to "future work".
- **Fix risk:** high

### T05-F17 — Do not split a large class or module because of size alone; split on low cohesion, heavy use of another class's data (feature envy), or separate co-change clusters
- **Grade:** B · **Verdict:** VERIFIED. The wording was tightened in two places:
  - PMD's GodClass combines complexity (WMC), access to foreign data (ATFD) and low cohesion (TCC). It is not a raw size measure.
  - Palomba's result concerns "smelly classes" across 13 smell types, not God classes only.
- **Rationale:** The size-based evidence conflicts.
  - Palomba et al. (30 projects, 395 releases, 17,350 manually validated smell instances) found smelly classes more change- and fault-prone.
  - Olbrich et al. (three open-source systems, 7-10 years of history) found God and Brain classes more change- and defect-prone in absolute terms, but less so once normalised by size. Their conclusion: such classes "may be an efficient way of organizing code".
  - Ousterhout treats "thin classes" and "classitis" (too many classes) as red flags.
- **Evidence:**
  - [On the diffuseness and the impact on maintainability of code smells: a large scale empirical investigation](https://doi.org/10.1007/s10664-017-9535-z) — Palomba, Bavota, Di Penta, Fasano, Oliveto, De Lucia, Empirical Software Engineering (online 2017; issue 2018) — peer_reviewed — "395 releases of 30 open source projects and considering 17,350 manually validated instances of 13 different code smell kinds... smells characterized by long and/or complex code (e.g., Complex Class) are highly diffused, and that smelly classes have a higher change- and fault-proneness than smell-free classes." — Abstract verified via the Semantic Scholar API.
  - [Are all code smells harmful? A study of God Classes and Brain Classes in the evolution of three open source systems](https://doi.org/10.1109/icsm.2010.5609564) — Olbrich, Cruzes, Sjøberg, ICSM 2010 — peer_reviewed — "when we normalized the measured effects with respect to size, then God and Brain Classes were less subject to change and had fewer defects than other classes. Hence, under the assumption that God and Brain Classes contain on average as much functionality per line of code as other classes, the presence of God and Brain Classes is not necessarily harmful; in fact, such classes may be an efficient way of organizing code." — Verified in the camera-ready PDF, from a [Wayback copy](http://web.archive.org/web/20110401103456/http://www.idi.ntnu.no/grupper/su/publ/daniela/OlbrichCodeSmells-CameraReady.pdf) of the NTNU author page.
  - [PMD Java design rules - GodClass](https://pmd.github.io/pmd/pmd_rules_java_design.html) — PMD 7.28.0-SNAPSHOT docs, 2026 — official_docs — "The rule identifies a god class by looking for classes which have all of the following properties: High WMC, High ATFD, Low TCC". It cites Lanza and Marinescu, *Object-Oriented Metrics in Practice* (2006). — Verified.
  - [Modular Design (CS 190 lecture notes)](https://web.stanford.edu/~ouster/cgi-bin/cs190-spring16/lecture.php?topic=modularDesign) — John Ousterhout, Stanford, Spring 2016 — other (author's own lecture notes) — "Thin classes don't hide much information"; "Related problem: classitis / Too many classes"; "Rule of thumb: 200-2000 lines is a good size for classes. Below 200 lines: probably pretty thin. Above 2000 lines: internal complexity of the class can become unmanageable." — Verified. The line range is a teaching heuristic, not a measured result.
- **Detect:**
  - JVM: PMD GodClass, which reports WMC, ATFD and TCC.
  - Other languages: for each large class or module, map each method to the fields it reads and writes.
    - Disconnected clusters mean low cohesion, so the class is a split candidate.
    - Many accesses to another class's data are feature envy, so the method is a move candidate.
  - Confirm with co-change inside the file: commits that touch method group A rarely touch group B.
  - Do not act on LOC or method-count thresholds alone (PMD TooManyMethods, NcssCount). Use them for triage only.
- **Tools:** PMD GodClass; PMD TooManyMethods and NcssCount (triage only); code-maat; IDE call hierarchy.
- **Applies to:** OO and module-oriented code in all languages. Also large files or modules in functional and procedural code.
- **When not to apply / counterpoints:**
  - Palomba shows that smelly classes are riskier in practice.
  - Olbrich's normalisation assumes the same functionality per line and covers only three systems.
  - Splitting changes object identity, construction and serialisation, and may break DI wiring.
- **Fix risk:** medium

### T05-F08 — Enforce information hiding: each design decision likely to change is owned by exactly one module
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Each design decision that is likely to change should be owned by one module. Examples: file or wire format, schema and column names, config keys, protocol constants, units, choice of algorithm.
  - When the same knowledge appears in two or more modules (information leakage), move it behind one interface.
  - Do not organise modules by execution step (read, parse, transform, write) when several steps share knowledge of one format.
- **Rationale:**
  - Parnas (1972) showed with worked examples that decomposing by flowchart steps puts design decisions into interfaces. Decomposing by "difficult design decisions or design decisions which are likely to change" lets each module hide one decision.
  - Ousterhout's "information leakage" red flag and Mo et al.'s modularity violation (files that co-change with no structural dependency) are modern, detectable forms of the same failure.
  - Only the modularity-violation form has empirical support (see F10).
- **Evidence:**
  - [On the Criteria To Be Used in Decomposing Systems into Modules](https://www.win.tue.nl/~wstomv/edu/2ip30/references/criteria_for_modularization.pdf) — David L. Parnas, CACM 15(12), Dec 1972 — peer_reviewed — "it is almost always incorrect to begin the decomposition of a system into modules on the basis of a flowchart. We propose instead that one begins with a list of difficult design decisions or design decisions which are likely to change. Each module is then designed to hide such a decision from the others." — Verified in the PDF. The argument is by example, not measurement.
  - [Philosophy of Software Design (book notes)](https://sive.rs/book/PoSD) — Derek Sivers' notes on Ousterhout, APOSD 2nd ed. (ISBN 173210221X), read 2024-06-10 — book, confirmed via secondary source — "Information leakage occurs when the same knowledge is used in multiple places." / "Information hiding can often be improved by making a class slightly larger." — Verified.
  - [Architecture Anti-patterns (IEEE TSE)](https://www.cs.drexel.edu/~yc349/papers/2019/tse2019.pdf) — Mo et al., 2021 — peer_reviewed — the Modularity Violation Group contains "two files without structural relations but changed together frequently in revision history" — Verified.
  - [connascence.io - Strength](https://connascence.io/strength.html) — connascence.io (concept by Meilir Page-Jones, per Wikipedia) — other — "connascence of meaning is considered a stronger form of connascence since semantic meaning is harder to find across an entire codebase." — Verified.
- **Detect:**
  1. Shared literals: `rg -o --no-filename '"[a-z_]{3,}"' src | sort | uniq -c | sort -rn`. Keep keys, column names, header names, date formats and regexes that occur in two or more modules.
  2. Paired encoders and decoders for the same format in different files (serialize/parse, toX/fromX, reader/writer).
  3. Hidden co-change: code-maat `-a coupling` pairs at 30% or more (the tool default) with no import relation.
  4. Temporal decomposition: modules named after pipeline steps that each know the same schema.
- **Tools:** ripgrep; code-maat; dependency-cruiser (import graph); ast-grep.
- **Applies to:** All languages and architectures, including multi-service systems, where the "module" is a service and the leaked knowledge is a payload schema.
- **When not to apply / counterpoints:**
  - Centralising knowledge in shared libraries can couple deployments. Segment's shared libraries, used across 140+ services, drifted to different versions (see Practitioner voice).
  - Locality of Behaviour argues for keeping behaviour next to where it is used, even at the cost of some repetition.
  - Parnas argues from examples, not measured data.
- **Fix risk:** medium

### T05-F07 — Remove speculative generality (YAGNI smells)
- **Grade:** B · **Verdict:** VERIFIED. The Prechelt 2001 counterpoint is now given in full. (audit correction: the Decorator sentence is in the author's preprint abstract dated 2 Dec 2000, not in the published TSE abstract, which omits it as indexed by OpenAlex; the rule is unaffected.)
  - The author's preprint abstract (dated 2 Dec 2000) does state "a positive effect occurs despite superfluous flexibility (and hence complexity) introduced by a certain application of the Decorator pattern". The researcher's summary of it was accurate.
  - The published TSE abstract, as indexed by OpenAlex for DOI 10.1109/32.988711, leaves out that whole sentence. It keeps only the "nine tasks", "In a few cases ... negative effects" and "unless there is a clear reason" parts. IEEE Xplore was unreachable, so the published abstract was not confirmed directly. Cite the Decorator result to the preprint, not to the TSE abstract.
  - The same paper also reports negative effects. An earlier draft of this dossier wrongly called the researcher's claim unsupported; that is reversed here.
- **Rule:** Remove speculative generality:
  - interfaces or abstract bases with exactly one implementation and no boundary role;
  - extension hooks and plugin points that nothing uses;
  - parameters that are always passed the same value;
  - code exercised only by tests;
  - public or protected members that could be private.

  In Go, and as a general heuristic, define interfaces on the consumer side, and only when a real use exists.
- **Rationale:**
  - Fowler describes the "cost of carry" of presumptive features.
  - Google's review guide tells reviewers to be "especially vigilant about over-engineering".
  - Google TotT lists single-subclass bases, test-only code, unsubclassed extensible classes, over-exposed members and constant flags as YAGNI smells.
  - Go's official guidance: "Do not define interfaces before they are used". Google's Go style: "The most common mistake is creating an interface before a real need exists."
  - Fowler and Beck: when "the only users of a function or class are test cases", delete the test case and remove the dead code.
- **Evidence:**
  - [Yagni](https://martinfowler.com/bliki/Yagni.html) — Martin Fowler, 26 May 2015 — engineering_blog — "The code for the presumptive feature adds some complexity to the software, this complexity makes it harder to modify and debug that software, thus increasing the cost of other features." Caveat: "Yagni only applies to capabilities built into the software to support a presumptive feature, it does not apply to effort to make the software easier to modify." — Verified.
  - [Code Health: Eliminate YAGNI Smells](https://testing.googleblog.com/2017/08/code-health-eliminate-yagni-smells.html) — Marc Eaddy, Google Testing Blog, 14 Aug 2017 — engineering_blog — Verified in the page text:
    - "creating a base class or interface with only one subclass may indicate a speculation that more subclasses will be needed in the future".
    - The list of other smells: "Code that has never been executed other than by tests", "Classes designed to be subclassed (have virtual methods and/or protected members) that are not actually subclassed", "Public or protected methods or fields that could be private", "Parameters, variables, or flags that always have the same value".
  - [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google Engineering Practices — official_docs — "Reviewers should be especially vigilant about over-engineering. Encourage developers to solve the problem they know needs to be solved now, not the problem that the developer speculates might need to be solved in the future." — Verified.
  - [Go Code Review Comments - Interfaces](https://go.dev/wiki/CodeReviewComments) — The Go Authors — official_docs — "Do not define interfaces on the implementor side of an API 'for mocking'"; "Do not define interfaces before they are used: without a realistic example of usage, it is too difficult to see whether an interface is even necessary, let alone what methods it ought to contain." — Verified.
  - [Go Style Best Practices - Interfaces](https://google.github.io/styleguide/go/best-practices) — Google — official_docs — Verified:
    - Under "Avoid unnecessary interfaces": "The most common mistake is creating an interface before a real need exists."
    - "Avoid forcing an interface if a single, robust concrete type can handle the abstraction internally."
  - [Refactoring 2nd ed., ch.3 - Speculative Generality](https://www.informit.com/articles/article.aspx?p=2952392&seqNum=15) — Fowler and Beck, 2018 (publisher excerpt) — book — "Speculative generality can be spotted when the only users of a function or class are test cases. If you find such an animal, delete the test case and apply Remove Dead Code (237)." — Verified.
  - [A Controlled Experiment in Maintenance Comparing Design Patterns to Simpler Solutions](https://page.mi.fu-berlin.de/prechelt/Biblio/patmain_tse2001.pdf) — Prechelt, Unger, Tichy, Brössler, Votta, IEEE TSE 27(12):1134-1144, Dec 2001 (DOI 10.1109/32.988711) — peer_reviewed (counter-evidence). Read in the author's preprint; metadata via Crossref.
    - Setup: 29 professional software engineers; programs of about 280-680 lines.
    - Preprint abstract (2 Dec 2000; the published TSE abstract omits the Observer/Decorator sentence): "In most of our nine maintenance tasks we found positive effects from using a design pattern... In a few cases we found negative effects... a negative effect occurs although a certain application of the Observer pattern appears to be well justified and a positive effect occurs despite superfluous flexibility (and hence complexity) introduced by a certain application of the Decorator pattern. Overall, we conclude that unless there is a clear reason to prefer the simpler solution, it is probably wise to choose the flexibility provided by the design pattern, because unexpected new requirements often appear."
    - Body: an unnecessary Observer had a negative effect; Visitor was "neutral"; Decorator was "easier to change, but more error-prone to call".
- **Detect:**
  1. Single-implementation interfaces: count implementers with `rg -c 'implements X\b|extends X\b|: X\b'`, or use IDE "find implementations" in Go. A count of 1 with no process, IO or plugin boundary makes it a candidate.
  2. Test-only code: symbols whose references are all in test paths.
  3. Constant parameters: every call site passes the same literal.
  4. Over-exposure: IDE "can be private" inspections.
  5. Unused hooks: empty template methods and no-op callbacks that are never overridden.
- **Tools:** ripgrep; IDE find-implementations and "can be private" inspections; ast-grep; language dead-code tools.
- **Applies to:** All languages. Strongest in:
  - Java, C# and TypeScript codebases with interface-per-class conventions;
  - Go written in a Java style;
  - AI-scaffolded "enterprise" structures.
- **When not to apply / counterpoints:**
  - Prechelt et al. give mixed results that partly favour flexibility.
  - The accepted top SE answer (247 votes) says YAGNI "strictly" applies, but it is better to err towards defining the interface, for mocks. A 199-vote answer says interfaces belong at subsystem boundaries "no matter how many classes implement them". An 88-vote answer calls automatic interface-per-class "an anti-pattern".
  - DI containers, mocking frameworks, reflection, plugin loaders and serialisation can refer to an interface by name. Removing it can break runtime wiring the compiler does not see.
  - Ousterhout's "somewhat general-purpose" advice (see Contradictions) pulls in the other direction.
- **Fix risk:** medium

### T05-F16 — By default, restrict inlining, interface removal, signature changes and module moves to non-exported, internal code
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** At published boundaries, treat any structural change as a breaking behaviour change. Deprecate and document; do not delete during a hardening pass. Published boundaries are:
  - library or SDK exports;
  - HTTP, RPC and GraphQL APIs;
  - CLI flags;
  - config keys;
  - DB schemas;
  - event payloads.
- **Rationale:**
  - Hyrum's Law: with enough users, "all observable behaviors of your system will be depended on by somebody".
  - Google Go style: "Exporting an interface commits you to maintaining that API for external callers".
  - Go review guidance: return concrete types so that "new methods can be added to implementations without requiring extensive refactoring".
- **Evidence:**
  - [Hyrum's Law](https://www.hyrumslaw.com/) — Hyrum Wright — engineering_blog — "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody." It is presented as "An observation on Software Engineering" from "low-level infrastructure migrations in one of the most complex software systems on the planet". — Verified.
  - [Go Style Best Practices - Interface ownership and visibility](https://google.github.io/styleguide/go/best-practices) — Google — official_docs — "Do not export interface types unnecessarily: If an interface is only used internally within a package to satisfy a specific logic flow, keep the interface unexported. Exporting an interface commits you to maintaining that API for external callers." — Verified.
  - [Go Code Review Comments - Interfaces](https://go.dev/wiki/CodeReviewComments) — The Go Authors — official_docs — "The implementing package should return concrete (usually pointer or struct) types: that way, new methods can be added to implementations without requiring extensive refactoring." — Verified.
- **Detect:** List the public surface before touching anything:
  - TS/JS: `package.json` `exports` and `main`, plus barrel exports;
  - Python: `__all__` and public names in published packages;
  - Go: capitalised identifiers in non-internal packages;
  - Java and C#: public types in published artefacts;
  - also OpenAPI and proto files, CLI `--help`, config schemas and migrations.

  After changes, diff the surface, with api-extractor for TS or a regenerated OpenAPI spec.
- **Tools:** api-extractor (TS); OpenAPI/protobuf diff; git diff; language export listings.
- **Applies to:** Libraries, SDKs, services with external clients, and monorepos with multiple consumers. In a single-deployable app with no outside consumers, "exported" often does not mean "public". Confirm with the owner.
- **When not to apply / counterpoints:**
  - Too much caution preserves the speculative abstractions that F07 targets.
  - In a closed application, the compiler and tests can prove there are no other consumers.
  - Hyrum's Law is an observation, not a measured study.
- **Fix risk:** high

### T05-F11 — Prioritise design refactoring by change history, and respect Chesterton's fence
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Spend refactoring effort on code that actually changes: hotspots, co-change clusters, and files in anti-patterns.
  - Do not restructure stable, working code only because it looks bad.
  - Before removing or reshaping code whose purpose is unclear, find out why it exists.
- **Rationale:**
  - Beck: coupling is "only potential cost. If nothing ever triggers the coupling, the cost is never realized". Also: cost(software) ~= cost(change).
  - Mo et al.'s strongest anti-patterns (Unstable Interface, Crossing, Modularity Violation) are defined using revision history. Their introduction adds that "cloned code that never changes may not need attention".
  - Kim et al. found that developers perceive refactoring as costly and risky. Yet a targeted Windows 7 refactoring coincided with fewer dependencies and defects.
  - The Code Maat README states that pre-release churn predicts post-release defects. That is a tool-author claim; the underlying study was not verified in this pass.
- **Evidence:**
  - [Coupling and Cohesion](https://newsletter.kentbeck.com/p/coupling-and-cohesion) — Kent Beck, 31 May 2024 (republished from 2009) — engineering_blog — "These static properties are only potential cost. If nothing ever triggers the coupling, the cost is never realized." / "elements in a design should not be coupled with respect to the changes that actually take place." — Verified.
  - [Constantine's Equivalence](https://newsletter.kentbeck.com/p/constantines-equivalence) — Kent Beck, 15 Aug 2022 — engineering_blog — "cost(software) ~= cost(change)". The period before changes begin is "economically insignificant". — Verified.
  - [Architecture Anti-patterns (IEEE TSE)](https://www.cs.drexel.edu/~yc349/papers/2019/tse2019.pdf) — Mo et al., 2021 — peer_reviewed — "many of these low-level problems do not incur high maintenance costs [14], [15]. For example, cloned code that never changes may not need attention." — Verified. This is an introductory claim that cites prior work, not a result of the paper.
  - [A field study of refactoring challenges and benefits](https://thomas-zimmermann.com/publications/files/kim-fse-2012.pdf) — Kim, Zimmermann, Nagappan, FSE 2012 — peer_reviewed — "developers perceive that refactoring involves substantial cost and risks". Refactored Windows 7 binaries showed reduced dependencies and post-release defects. — Verified in the author PDF.
  - [Code Maat README](https://github.com/adamtornhill/code-maat) — Adam Tornhill — official_docs — "The pre-release churn of a module is a good predictor of its number of post-release defects. Such an analysis is supported in Code Maat by the `-a entity-churn` option." — Verified (tool README).
  - [The Grug Brained Developer](https://grugbrain.dev/) — Carson Gross — engineering_blog — "many older grug learn this lesson well not start tearing code out willy nilly, no matter how ugly look"; "here tests often good hint for why fence not to be smashed!" — Verified.
- **Detect:**
  - Churn ranking: `git log --format= --name-only --since=12.months | grep -v '^$' | sort | uniq -c | sort -rn | head -50`. The blank-line filter was added to the researcher's command.
  - Cross the churn list with the complexity triage (F03) and anti-pattern membership (F10), and handle hotspots first.
  - For code of unclear purpose:
    - run `git log -S'<symbol>' --oneline` and `git blame -w -C`;
    - read the linked issues;
    - check which tests fail when the code is removed.
  - With little history, fall back to ranking by fan-in times complexity.
- **Tools:** git; code-maat (`-a entity-churn`, `-a coupling`); test runner.
- **Applies to:** All projects with version history. Weaker for brand-new "finished" projects.
- **When not to apply / counterpoints:**
  - A freshly finished project may not have enough history.
  - Some code is stable only because nobody dares touch it (reasoning, not sourced).
  - Practitioners split on this:
    - "Code that meets its requirements needs to be left alone" ([HN 35106801](https://news.ycombinator.com/item?id=35106801), 2023).
    - You may "not realise you needed an abstraction until it catches fire in multiple places" ([HN 48620718](https://news.ycombinator.com/item?id=48620718), 2026).
- **Fix risk:** low

### T05-F01 — Inline or deepen pass-through methods and shallow wrappers; remove pass-through variables
- **Grade:** B · **Verdict:** VERIFIED. Minor notes:
  - The pylint docs are now v4.0.9.
  - Martin's "They can always be inlined" refers to decompositions in general, not to wrappers specifically.
  - For TypeScript, use `@typescript-eslint/no-useless-constructor`. It extends the base rule to handle parameter properties and non-public constructors.
- **Rule:**
  - A pass-through is a function whose body only forwards (near-identical) arguments to one callee and adds no validation, translation, policy, error mapping or naming abstraction. It hides nothing. Inline it into its callers, or merge the responsibilities of the two classes.
  - Remove pass-through variables: parameters threaded unchanged through intermediate functions that never use them. Give the value to the component that uses it, for example through its constructor or a context object.
- **Rationale:**
  - Ousterhout treats a module's benefit as the functionality it hides and its cost as its interface. A pass-through adds interface cost, hides nothing, and signals overlapping responsibilities.
  - Fowler and Beck's "Lazy Element" smell and Beck's "fewest elements" rule reach the same conclusion.
  - Official linters flag the most trivial cases (forwarding constructors, overrides that only call super) as removable without behaviour change.
- **Evidence:**
  - [Philosophy of Software Design (book notes)](https://sive.rs/book/PoSD) — Derek Sivers' notes on Ousterhout, APOSD 2nd ed., read 2024-06-10 — book, confirmed via secondary source — Verified:
    - "A pass-through method is one that does nothing except pass its arguments to another method."
    - "Pass-through variables add complexity because they force all of the intermediate methods to be aware of their existence."
    - "One example where it's useful for a method to call another method with the same signature is a dispatcher."
    - "The solution is to introduce a context object representing configuration options."
  - [Modular Design (CS 190 lecture notes)](https://web.stanford.edu/~ouster/cgi-bin/cs190-spring16/lecture.php?topic=modularDesign) — John Ousterhout, Stanford, 2016 — other (author's own notes) — "It takes almost as much code to invoke a method as it would take to just retype the method inline". Red flag: "Very deep call stacks (especially if one method simply calls another with essentially the same arguments)". — Verified.
  - [Refactoring 2nd ed., ch.3 - Lazy Element](https://www.informit.com/articles/article.aspx?p=2952392&seqNum=14) — Fowler and Beck, 2018 (publisher excerpt) — book — "It may be a function that's 'named the same as its body code reads,' or a class that is essentially one simple function... such program elements need to 'die with dignity.' Usually this means using Inline Function (115) or Inline Class (186)." — Verified.
  - [useless-parent-delegation / W0246](https://pylint.readthedocs.io/en/stable/user_guide/messages/warning/useless-parent-delegation.html) — Pylint 4.0.9 docs — official_docs — "Used whenever we can detect that an overridden method is useless, relying on parent or super() delegation to do the same thing as another method from the MRO." — Verified.
  - [no-useless-constructor](https://eslint.org/docs/latest/rules/no-useless-constructor) — ESLint — official_docs — "This rule flags class constructors that can be safely removed without changing how the class works." Not deprecated. — Verified. For TS, see [typescript-eslint's extension](https://typescript-eslint.io/rules/no-useless-constructor/) (verified).
  - [PMD Java design rules - UselessOverridingMethod](https://pmd.github.io/pmd/pmd_rules_java_design.html) — PMD 7.28.0-SNAPSHOT docs — official_docs — "The overriding method merely calls the same method defined in a superclass." (`category/java/design.xml/UselessOverridingMethod`) — Verified.
  - [Beck Design Rules](https://martinfowler.com/bliki/BeckDesignRules.html) — Martin Fowler, 2 March 2015 — engineering_blog — "anything that doesn't serve the three prior rules should be removed"; "the extra complexity of all of these elements usually made the system harder to modify" — Verified.
- **Detect:**
  1. Linter subset: ESLint and typescript-eslint `no-useless-constructor`, pylint W0246, PMD UselessOverridingMethod.
  2. ast-grep structural search, then check by hand that the arguments are essentially the parameters. The `$$$` multi-meta-variable syntax is confirmed in the ast-grep pattern docs.
     - JS/TS: `function $F($$$P) { return $G($$$A); }`
     - Class-method form: `$M($$$P) { return this.$D.$G($$$A); }`
     - Python: `def $F($$$P):\n    return $G($$$A)`
  3. For each hit, confirm that the wrapper adds none of: validation, conversion, logging, auth, transaction, retry, error mapping, or a higher-level name. Check for decorators and annotations.
  4. Pass-through variables: a parameter whose only use is as an argument to another call, across two or more stacked functions.
- **Tools:** ESLint no-useless-constructor (plus the typescript-eslint variant); pylint W0246; PMD UselessOverridingMethod; ast-grep; ripgrep; IDE Inline Function.
- **Applies to:** All languages, but only non-exported, private or internal code (see F16). Most common in layered backends, OO codebases and AI-generated scaffolding.
- **When not to apply / counterpoints:**
  - Ousterhout exempts dispatchers.
  - Deliberate adapters, facades at process or IO boundaries, compatibility shims and framework-required wrappers are legitimate.
  - PMD LawOfDemeter ("only talk to friends") and Fowler's Hide Delegate push towards adding delegating methods.
  - Martin: decompositions "can always be inlined if we judge them to have gone too far".
  - A context object can itself become a hidden global dependency.
- **Fix risk:** low

### T05-F12 — Make every design-hardening change structure-only, in small, separately revertible commits
- **Grade:** B · **Verdict:** VERIFIED. Beck's book was confirmed via a secondary review.
- **Rule:**
  - Keep structural changes separate from behaviour changes.
  - Tests must be green and unmodified before and after, except for mechanical renames.
  - If a design improvement needs a behaviour change (for example F15, or removing a public API), do not bundle it. Flag it for explicit approval.
- **Rationale:**
  - Beck's *Tidy First?* separates structural "tidyings" from behavioural changes.
  - Kim et al. document that practitioners perceive refactoring as risky and that in practice it is often not strictly semantics-preserving.
  - grug observes that larger refactors fail more often.
  - Fowler: YAGNI "requires (and enables) malleable code".
- **Evidence:**
  - [Tidy First? (book review)](https://henrikwarne.com/2024/01/10/tidy-first/) — Henrik Warne reviewing Kent Beck (O'Reilly 2023), 10 Jan 2024 — engineering_blog (secondary) — "Each individual tidying is very simple. They only change the structure of the code, never the behavior." / "structural and behavioral changes should be kept in separate PRs (or at least in separate commits). In many work places, there are high fixed costs (in time and effort) associated with PR reviews." — Verified.
  - [A field study of refactoring challenges and benefits](https://thomas-zimmermann.com/publications/files/kim-fse-2012.pdf) — Kim, Zimmermann, Nagappan, FSE 2012 — peer_reviewed — "the refactoring definition in practice is not confined to a rigorous definition of semantics-preserving code transformations and that developers perceive that refactoring involves substantial cost and risks." — Verified in the author PDF. This is indirect support.
  - [The Grug Brained Developer](https://grugbrain.dev/) — Carson Gross — engineering_blog — "larger refactor, more likely failure appear to be so grug try to keep refactors relatively small... ideally system work entire time and each step of finish before other begin"; "introducing too much abstraction often lead to refactor failure and system failure" — Verified.
  - [Yagni](https://martinfowler.com/bliki/Yagni.html) — Martin Fowler, 2015 — engineering_blog — "Yagni is not a justification for neglecting the health of your code base. Yagni requires (and enables) malleable code." — Verified.
  - [Book Review: Tidy First?](https://www.pathsensitive.com/2024/04/book-review-tidy-first.html) — Jimmy Koppel, 1 Apr 2024 — engineering_blog (dissent) — "a rather impoverished repertoire. (E.g.: they can't solve any of the refactoring challenges I've been running lately.)" — Verified.
- **Detect:**
  - For each commit, run `git diff --stat -M -C` and `git diff --color-moved=zebra` to confirm that moves are pure moves.
  - Flag commits that touch both production logic and test assertions.
  - Run the full tests, type-check and lint after each step.
  - Diff the public surface before and after.
  - Add characterisation tests before risky steps.
- **Tools:** git; test runner; type checker; IDE automated refactorings.
- **Applies to:** All languages and all T05 findings. This is the execution protocol.
- **When not to apply / counterpoints:**
  - Koppel argues that small tidyings cannot achieve deep restructurings.
  - Breaking cycles (F10) and changing hierarchies (F14) need coordinated multi-file steps.
  - Separate PRs carry review overhead, as Warne notes.
  - "Structure-only" refactorings can still change behaviour through reflection, serialisation, initialisation order or performance (see F13).
- **Fix risk:** low

### T05-F03 — Extract a block into its own function only if the result is deep; use metrics only for triage
- **Grade:** C · **Verdict:** CORRECTED.
  - The researcher said the Linux kernel style "rejects fixed length limits". It does not. It sets a default ("fit on one or two screenfuls of text", "do just one thing"), relaxes it for long but simple case statements, and tightens it for complex functions.
  - Carmack does explicitly disagree with page-length rules.
  - The single-call-site detection command was fixed.
- **Rule:**
  - Apply a two-sided test before extracting. A reader of the parent should not need the child's body, and a reader of the child should not need the parent's state.
  - Inline helpers with a single call site whose name merely restates their body.
  - Do not split long but simple sequential code, such as flat switch tables, just to meet a line limit.
- **Rationale:**
  - Ousterhout and Martin agree that over-decomposition is possible. Martin called the joint summary "a fair assessment"; it says Clean Code 1st ed. gives little guidance on recognising over-decomposition.
  - Carmack: "If a function is only called from a single place, consider inlining it."
  - The kernel style ties maximum length inversely to complexity and indentation.
  - A meta-analysis (about 24,000 evaluations of 427 snippets) found that Cognitive Complexity correlates with comprehension time and with subjective understandability. Results for correctness were mixed. So the metric is useful for triage, not for verdicts.
- **Evidence:**
  - [A Philosophy of Software Design vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout and Martin, Sep 2024 to Feb 2025 — other (primary debate text) — Verified in the raw README.
    - Ousterhout: "decomposition can be taken too far... The amount of functionality hidden behind each interface drops, while the interfaces often become more complex."
    - Summary: "We agree that it is possible to over-decompose, and that Clean Code 1st ed. doesn't provide much guidance on how to recognize over-decomposition."
    - UB: "I think this is a fair assessment of our agreements and disagreements."
    - Martin: "if I must err, I'd rather err on the side of decomposition... They can always be inlined if we judge them to have gone too far."
  - [Philosophy of Software Design (book notes)](https://sive.rs/book/PoSD) — Sivers on Ousterhout — book, confirmed via secondary source — Verified:
    - Extracting a subtask makes sense if "(a) someone reading the child method doesn't need to know anything about the parent method (b) someone reading the parent method doesn't need to understand the implementation of the child method."
    - "You shouldn't break up a method unless it makes the overall system simpler."
  - [John Carmack on Inlined Code](http://number-none.com/blow/john_carmack_on_inlined_code.html) — John Carmack (email 13 Mar 2007; preface 26 Sep 2014), hosted by Jonathan Blow — engineering_blog — Verified via curl:
    - "If a function is only called from a single place, consider inlining it."
    - "I know there are some rules of thumb about not making functions larger than a page or two, but I specifically disagree with that now -- if a lot of operations are supposed to happen in a sequential fashion, their code should follow sequentially."
    - He recommends "large comment blocks inside the major function to delimit the minor functions".
  - [Linux kernel coding style §6 Functions](https://www.kernel.org/doc/html/latest/process/coding-style.html) — Linux kernel documentation — official_docs — Verified in the .rst source:
    - "Functions should be short and sweet, and do just one thing. They should fit on one or two screenfuls of text (the ISO/ANSI screen size is 80x24...)".
    - "The maximum length of a function is inversely proportional to the complexity and indentation level of that function. So, if you have a conceptually simple function that is just one long (but simple) case-statement... it's OK to have a longer function."
    - "Use helper functions with descriptive names".
    - Local variables "shouldn't exceed 5-10".
    - "if you need more than 3 levels of indentation, you're screwed anyway".
  - [An Empirical Validation of Cognitive Complexity as a Measure of Source Code Understandability](https://arxiv.org/abs/2007.12520) — Muñoz Barón, Wyrich, Wagner, ESEM 2020 — peer_reviewed (meta-analysis) — "about 24,000 understandability evaluations of 427 code snippets... Cognitive Complexity positively correlates with comprehension time and subjective ratings of understandability. The metric showed mixed results for the correlation with the correctness of comprehension tasks and with physiological measures." — Verified.
  - [Is it OK to split long functions and methods into smaller ones even though they won't be called by anything else?](https://softwareengineering.stackexchange.com/questions/195989) — SE StackExchange, accepted answer (score 240, April 2013) — practitioner_forum (dissent) — quoting a co-worker: "If, when describing the activity of the code to another programmer you use the word 'and', the method needs to be split into at least one more part." — Verified via the StackExchange API.
- **Detect:**
  - Triage with:
    - PMD CognitiveComplexity (default `reportLevel` 15, verified);
    - PMD AvoidDeeplyNestedIfStmts (default `problemDepth` 3, verified);
    - roughly 10 or more locals (the kernel says 5-10).
  - Apply the two-sided test to each flagged function.
  - Inline candidates are non-exported functions with exactly one call site:
    - count total occurrences with `rg -w -o 'name' src | wc -l` (2 means the definition plus one call; `rg -c` counts per file, not in total);
    - also require a body of 3 statements or fewer, or a name that paraphrases the body.
  - Do not flag flat long functions. Use section comments instead, as Carmack suggests.
- **Tools:** PMD CognitiveComplexity; PMD AvoidDeeplyNestedIfStmts; PMD NcssCount; Sonar's cognitive-complexity rule (its rule page was not re-fetched); ripgrep; IDE Extract/Inline Function.
- **Applies to:** All languages. Especially AI-generated code with many tiny helpers or very long functions.
- **When not to apply / counterpoints:**
  - Martin and the accepted SE answer favour splitting.
  - The kernel style itself recommends helper functions for complex code.
  - No controlled experiment directly compares tiny and deep decompositions. Ousterhout's side rests on argument and examples.
- **Fix risk:** low

### T05-F04 — Recombine entangled methods and remove hidden state channels
- **Grade:** C · **Verdict:** CORRECTED.
  - Wording tightened: qntm says 13 of 15 private methods "either have side effects... or call out to other methods which have side effects". Not all of them act on fields directly.
  - The researcher's counterpoint "Ousterhout's own example needed two loops combined for performance" was misattributed. The two-loop split was in Martin's rewrite, and Ousterhout measured the slowdown (see F13).
- **Rule:**
  - Two methods are entangled when understanding one requires reading the other. Merge them.
  - When methods communicate through member fields that one sets and another reads (temporal coupling), merge them or turn the fields into explicit parameters and return values.
  - When extracting, prefer pure functions.
- **Rationale:**
  - Ousterhout defines entanglement and recommends combining such methods.
  - qntm's review of Clean Code's own model refactoring documents fields used as hidden parameters.
  - Carmack names "unexpected dependency and mutation of state" as the real enemy.
  - Hickey: state "complects value and time".
  - PMD SingularField detects the mechanical case.
- **Evidence:**
  - [A Philosophy of Software Design vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout and Martin, 2024-2025 — other — "Two methods are entangled (or 'conjoined' in APOSD terminology) if, in order to understand how one of them works internally, you also need to read the code of the other... Entangled methods can usually be improved by combining them so that all the code is in one place." — Verified.
  - [It's probably time to stop recommending Clean Code](https://qntm.org/clean) — qntm, 28 Jun 2020 — engineering_blog — Verified via curl (WebFetch returned 403):
    - "Of the fifteen private methods, fully thirteen of them either have side effects... or call out to other methods which have side effects".
    - "Martin makes a distressing habit of having the first method set a member variable which the second method, or some other method, then reads back."
  - [John Carmack on Inlined Code](http://number-none.com/blow/john_carmack_on_inlined_code.html) — Carmack, 2014 preface — engineering_blog — "The real enemy addressed by inlining is unexpected dependency and mutation of state, which functional programming solves more directly and completely." / "figure out how to factor blocks out into pure functions (and don't let them slide back into impurity!)" — Verified.
  - [Simple Made Easy (transcript)](https://github.com/matthiasn/talk-transcripts/blob/master/Hickey_Rich/SimpleMadeEasy.md) — Rich Hickey, Strange Loop 2011 — talk — "Having state in your program is never simple because it has a fundamental complecting that goes on in its artifacts. It complects value and time." — Verified.
  - [PMD Java design rules - SingularField](https://pmd.github.io/pmd/pmd_rules_java_design.html) — PMD docs — official_docs — "Reports fields which may be converted to a local variable. This is so because in every method where the field is used, it is assigned before it is first read." — Verified.
- **Detect:**
  - PMD SingularField (Java).
  - Elsewhere, list each class's fields, then run `rg -n 'this\.field|self\.field'`. A field written in one method and read only by methods called right after it is a hidden parameter.
  - Look for order-dependency guards (`if (!this.initialized)`) and "must call X first" comments.
  - Apply the "flip back and forth" review test.
- **Tools:** PMD SingularField; ripgrep; ast-grep; IDE "field can be local" inspections.
- **Applies to:** OO code in all languages, especially "method object" classes produced by aggressive Extract Method.
- **When not to apply / counterpoints:**
  - Martin believes that ordering methods top-down compensates for entanglement; this is recorded in the agreed summary.
  - Builders, parsers, state machines and iterators legitimately keep state between calls.
  - Merging makes functions longer.
- **Fix risk:** medium

### T05-F05 — Treat a shared function with accumulated flag or mode parameters and caller-specific branches as a wrong abstraction
- **Grade:** C · **Verdict:** VERIFIED. Two counterpoints were added:
  - Carmack's contrary advice.
  - Prechelt's Decorator-vs-flags task.
- **Rule:**
  1. Inline the function back into every caller.
  2. In each caller, constant-fold the flags so that only that caller's branches remain, and delete the rest.
  3. Re-extract only what is genuinely common.
- **Rationale:**
  - Metz documents how the abstraction degrades. A new requirement is "almost" a fit, so parameters and conditionals are added until the code is incomprehensible. Her remedy: "the fastest way forward is back".
  - Dodds describes the same failure.
  - Google's YAGNI smells list "Parameters, variables, or flags that always have the same value".
- **Evidence:**
  - [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) — Sandi Metz, 20 Jan 2016 — engineering_blog — "duplication is far cheaper than the wrong abstraction" / "Re-introduce duplication by inlining the abstracted code back into every caller. Within each caller, use the parameters being passed to determine the subset of the inlined code that this specific caller executes. Delete the bits that aren't needed for this particular caller." — Verified.
  - [AHA Programming](https://kentcdodds.com/blog/aha-programming) — Kent C. Dodds, 22 Jun 2020 — engineering_blog — "If you abstract early though, you'll think the function or component is perfect for your use case and so you just bend the code to fit your new use case. This goes on several times until the abstraction is basically your whole application in if statements and loops" — Verified.
  - [Code Health: Eliminate YAGNI Smells](https://testing.googleblog.com/2017/08/code-health-eliminate-yagni-smells.html) — Marc Eaddy, Google, 2017 — engineering_blog — "Parameters, variables, or flags that always have the same value"; "Code must handle the case when hibernate is true, even though all callers pass false" — Verified.
  - [HN comment on "Prefer duplication over the wrong abstraction (2016)"](https://news.ycombinator.com/item?id=48620623) — dofm, 21 Jun 2026 — practitioner_forum (counter-experience) — a site "written by subcontractors who clearly believed that duplication is better than the wrong abstraction. Until one day, along came a change – MySQL 4 to MySQL 5 – and a significant duplicated query no longer worked" — Verified via the HN Algolia API.
  - [John Carmack on Inlined Code](http://number-none.com/blow/john_carmack_on_inlined_code.html) — Carmack, 2007 — engineering_blog (counterpoint) — "If a function is called from multiple places, see if it is possible to arrange for the work to be done in a single place, perhaps with flags, and inline that." — Verified.
  - [A Controlled Experiment in Maintenance Comparing Design Patterns to Simpler Solutions](https://page.mi.fu-berlin.de/prechelt/Biblio/patmain_tse2001.pdf) — Prechelt et al., IEEE TSE 2001 — peer_reviewed (counter-evidence) — Read in the author's PDF.
    - Program: Communication Channels. The alternative version "comprises but a single class, that uses flags and if-sequences for turning functionality on or off".
    - Task 1: the Decorator (pattern) groups were 38% faster, and no errors occurred in them. Errors were made by 7 of 8 Pre-Alt and 6 of 7 Post-Alt subjects.
    - Task 2: the flag version was 53% faster, with "6 wrong solutions (out of 14)" in the pattern group.
- **Detect:**
  1. Use ast-grep to find calls with literal boolean arguments and functions that branch on a parameter.
  2. List each function's call sites and the literals they pass. If callers use disjoint subsets of the branches, the function is a candidate.
  3. Run `git log -L :funcName:path` and look for repeated "add option for X" commits.
  4. Remove parameters that every caller passes with the same value.
- **Tools:** ast-grep; ripgrep; git log -L; IDE Inline Function and Change Signature.
- **Applies to:** All languages. Shared utilities, UI components with many boolean props, and service methods with option bags.
- **When not to apply / counterpoints:**
  - Duplicated copies can drift and break together (dofm).
  - When the flags encode real variants of one concept, polymorphism may be better. Prechelt's Decorator version was easier to extend but more error-prone to configure.
  - Carmack deliberately consolidates work "perhaps with flags" to reduce state bugs.
  - Inlining increases code volume and can trigger duplication detectors.
- **Fix risk:** medium

### T05-F06 — Deduplicate knowledge, not text: merge copies only with evidence
- **Grade:** C · **Verdict:** CORRECTED. Three fixes:
  1. The causal claim "because assistants copy code rather than reuse it" now matches what the data shows. GitClear's figures are industry-wide trends from 2020 to 2024, when AI assistants spread. They are vendor data and correlational, and the headline percentages are not split into AI-authored and human-authored lines. The causal reading rests only on practitioner anecdote.
  2. PMD CPD is multi-language, not "for JVM languages".
  3. The Rule of Three attribution rests on Wikipedia (tertiary) and Carlo; Fowler's book passage was not accessed.
- **Rule:**
  - Merge copies only when they encode the same rule that must change together.
  - Require evidence: three or more occurrences (Rule of Three), or git history showing that the copies co-change.
  - Also require a clear name for the shared concept.
  - Leave two coincidentally similar blocks alone.
  - In AI-assisted codebases, scan actively for clones as well as for wrong abstractions.
- **Rationale:**
  - Waiting for more instances makes the right abstraction visible.
  - tef and the Go proverbs argue that copying avoids premature dependencies.
  - Beck's simple-design rules still rank "no duplication" (third) above "fewest elements" (fourth).
  - GitClear's data and HN reports show the opposite risk growing: clones that drift apart and do not propagate changes.
- **Evidence:**
  - [Rule of three (computer programming)](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming)) — Wikipedia — other (tertiary) — "Two instances of similar code do not require refactoring, but when similar code is used three times, it should be extracted into a new procedure. The rule was popularised by Martin Fowler in Refactoring and attributed to Don Roberts." — Verified on the page.
  - [Don't make Clean Code harder to maintain, use the Rule of Three](https://understandlegacycode.com/blog/refactoring-rule-of-three/) — Nicolas Carlo, n.d. (site © 2019-2026) — engineering_blog — "Don't force an over-abstraction into the codebase. If you can't give it a clear name, it's not clear enough. In doubt, it's fine to break the rule. Wait for more duplication." — Verified.
  - [Write code that is easy to delete, not easy to extend](https://programmingisterrible.com/post/139222674273/write-code-that-is-easy-to-delete-not-easy-to) — tef, 13 Feb 2016 — engineering_blog — Verified via the Wayback snapshot of 2026-09-10, because the live page served a JS bot-check:
    - "It's good to copy-paste code a couple of times, rather than making a library function, just to get a handle on how it will be used. Once you make something a shared API, you make it harder to change."
    - "repeat yourself to avoid creating dependencies, but don't repeat yourself to manage them".
  - [Go Proverbs](https://go-proverbs.github.io/) — Rob Pike, Gopherfest SV 2015 — other — "A little copying is better than a little dependency." — Verified.
  - [AI Copilot Code Quality: 2025 Look Back at 12 Months of Data](https://www.gitclear.com/ai_assistant_code_quality_2025_research) — GitClear, 2025 — industry_report (vendor; landing-page abstract only) — "211 million changed lines of code, authored between January 2020 and December 2024... the percentage of changed code lines (associated with refactoring) sunk from 25% of changed lines in 2021, to less than 10% in 2024, while lines classified as 'copy/pasted' (cloned) rose from 8.3% to 12.3% in the same period." — Verified. The full PDF is gated, and the classifications are GitClear's own.
  - [Goodbye, Clean Code](https://overreacted.io/goodbye-clean-code/) — Dan Abramov, 11 Jan 2020 — engineering_blog — "My code traded the ability to change requirements for reduced duplication, and it was not a good trade." — Verified.
  - [Beck Design Rules](https://martinfowler.com/bliki/BeckDesignRules.html) — Fowler, 2015 — engineering_blog — rules in order: passes the tests, reveals intention, no duplication, fewest elements — Verified.
- **Detect:**
  1. Run a token clone detector (jscpd, or the multi-language PMD CPD) to list clone groups.
  2. Keep groups with 3 or more members, or pairs that co-change according to the code-maat git2 log with `-a coupling`.
  3. Naming test: write the shared function's name and a one-sentence contract. If it needs "and" or flags, stop (see F05).
  4. Otherwise extract, preferably as a pure function.
- **Tools:** jscpd (active; pushed Sep 2026); PMD CPD; code-maat (`-a coupling`); git; IDE Extract Function.
- **Applies to:** All languages. Raise the priority on AI-assisted repos and multi-service repos.
- **When not to apply / counterpoints:**
  - Metz, Abramov, Dodds and tef stress the cost of premature abstraction.
  - HN reports the reverse failure: drifting copies, and LLM-heavy code where a change "assuming common code / styling was reused" did not propagate ([HN 48620737](https://news.ycombinator.com/item?id=48620737), verified).
  - No empirical validation of the Rule of Three was found.
- **Fix risk:** medium

### T05-F09 — Use connascence (strength × degree × locality) to decide which coupling to fix
- **Grade:** C · **Verdict:** CORRECTED. connascence.io does not state the researcher's three-tier grouping ("weak: name, type; stronger: meaning, position, algorithm; strongest: execution, timing, value, identity").
  - The site lists the static forms (Name, Type, Meaning, Position, Algorithm) and the dynamic forms (Execution, Timing, Value, Identity).
  - It says only that static forms are weaker than dynamic ones and that meaning is stronger than name.
  - Any finer ordering is conventional and was not verified.
  - Wikipedia attributes the concept to Meilir Page-Jones.
- **Rule:**
  - Rate each coupling by strength, by degree (how many elements are involved) and by locality.
  - Refactor strong forms that cross module boundaries into weaker ones:
    - same-typed positional parameters become named parameters or an object;
    - shared magic values become a named constant or enum;
    - a required call order becomes a single entry point.
  - Tolerate strong coupling inside one function or class.
  - When abstraction would move behaviour far from the code it affects, prefer keeping it close (Locality of Behaviour).
- **Rationale:**
  - connascence.io says stronger forms are acceptable within a module and weaker forms should be used between distant entities.
  - Gross's essay on Locality of Behaviour (LoB) says a violation is more severe the further behaviour moves from its unit, and names the trade-off with DRY and separation of concerns.
  - Hickey notes that modular code can still be "completely complected".
- **Evidence:**
  - [connascence.io - Locality](https://connascence.io/locality.html) — connascence.io — other — "Many of the stronger forms of connascence that can be devastating to the readability and maintainability of a codebase when they appear far apart are innocuous when close together." / "Locality matters! Stronger connascences are more acceptible within a module. Weaker connascences should be used between entities that are far apart (in separate modules or even codebases)." — Verified.
  - [connascence.io - Strength](https://connascence.io/strength.html) — connascence.io — other — "Static connascences are considered to be weaker than dynamic connascences, since static connascences can be determined simply by examining the source code." — Verified.
  - [Connascence](https://en.wikipedia.org/wiki/Connascence) — Wikipedia — other (tertiary) — "a software design metric introduced by Meilir Page-Jones" — Verified (attribution only).
  - [Locality of Behaviour (LoB)](https://htmx.org/essays/locality-of-behaviour/) — Carson Gross, 29 May 2020 — engineering_blog — "The behaviour of a unit of code should be as obvious as possible by looking only at that unit of code" / "the further behaviour gets from the code unit it effects, the more severe the violation of LoB" / "There is no hard and fast rule" — Verified.
  - [Simple Made Easy (transcript)](https://github.com/matthiasn/talk-transcripts/blob/master/Hickey_Rich/SimpleMadeEasy.md) — Rich Hickey, 2011 — talk — "You can write modular software with all kinds of interconnections between them. They may not call each other, but they're completely complected." — Verified.
  - [PMD Java design rules - ExcessiveParameterList](https://pmd.github.io/pmd/pmd_rules_java_design.html) — PMD docs — official_docs — "When parameters share similar datatypes, they become prone to mix-ups during refactoring or when calling the method with positional arguments." — Verified.
- **Detect:**
  - Position: exported functions with 4 or more parameters, or 2 or more adjacent parameters of the same primitive type (PMD ExcessiveParameterList, or ast-grep).
  - Meaning: domain literals repeated across files.
  - Execution: "call X before Y" comments and init methods.
  - Algorithm: two places that must hash, encode or round identically.
  - Rate each by locality, and fix only the strong forms that cross modules.
- **Tools:** PMD ExcessiveParameterList; ast-grep; ripgrep.
- **Applies to:** All languages. Most valuable at module, package and service boundaries.
- **When not to apply / counterpoints:**
  - The strength ordering is a heuristic taxonomy, not an empirically validated ranking.
  - LoB openly conflicts with DRY and separation of concerns.
  - Parameter objects can become shallow data classes (F01).
- **Fix risk:** low

### T05-F13 — In measured hot paths, keep the less abstract version unless a benchmark shows the refactor is neutral
- **Grade:** C · **Verdict:** CORRECTED.
  - The researcher wrote that "neither author noticed until Ousterhout measured it". In fact it was Martin's rewrite. Ousterhout measured the slowdown, and Martin replied "Good catch! I would have caught that too had I thought to profile the solution".
  - Martin then produced a version that was still decomposed and was faster (440 ms vs 561 ms). So the lesson is "measure before and after", not "decomposition is slow".
  - The "performance hammer" quote now has its real source: Martin, in the Muratori-Martin Q&A.
- **Rule:**
  - Do not replace switch or table dispatch with polymorphic hierarchies without before-and-after measurements.
  - Do not split a single-pass, early-exit loop into several passes without them.
  - Do not add per-element indirection without them.
  - The reverse also holds: performance is not a reason to keep complexity in cold code.
- **Rationale:**
  - Muratori's microbenchmark measured 1.5x for switch over virtual dispatch, about 10x for a table-driven version, nearly 15x with one extra property, and 20-25x with AVX.
  - In the Ousterhout-Martin exchange, splitting one early-exit loop into two gave 5-10x more loop iterations and a 3-4x slowdown. It was fixed once measured.
- **Evidence:**
  - [Clean Code, Horrible Performance](https://www.computerenhance.com/p/clean-code-horrible-performance) — Casey Muratori, 28 Feb 2023 — engineering_blog — Verified via curl. This is a single-author toy microbenchmark.
    - "around 35 cycles to do the 'clean' code area calculation"; "an immediate 1.5x performance increase" from switch.
    - Table-driven: "3.0-3.5 cycles per shape range. That's a 10x speed improvement".
    - "the lookup table version is nearly 15x faster".
    - AVX: "The speed differences range from 20-25x".
  - [A Philosophy of Software Design vs Clean Code - Bob's Rewrite of PrimeGenerator2](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout and Martin, 2025 — other — Verified in the raw README.
    - Ousterhout: "I measured a factor of 3-4x slowdown compared to either of the earlier revisions... you changed the processing of a particular candidate from a single loop to two loops... This results in 5-10x as many loop iterations and a 3-4x overall slowdown."
    - UB: "Good catch! I would have caught that too had I thought to profile the solution... My updated version is now faster than yours! A million primes in 440ms as opposed to yours which takes 561ms."
  - [Clean Code Q&A (Muratori-Martin exchange)](https://github.com/cmuratori/misc/blob/main/cleancodeqa.md) — Casey Muratori and Robert C. Martin, 2023 (mirrored at unclebob/cmuratori-discussion) — other — Martin: "I am not an expert in performance... To a performance hammer, everything looks like a nail. ;-)" — Verified in both raw files.
  - [HN comment on the "Clean Code, Horrible Performance" discussion](https://news.ycombinator.com/item?id=35106042) — Barrin92, 11 Mar 2023 — practitioner_forum (dissent) — "one thing I thought that's missing that's also incredibly important is simply safety... Casey seems to take so much of his advice from his experience on game engines, which are an incredibly forgiving domain" — Verified via the HN API.
- **Detect:**
  - Get a profile (perf, py-spy, `node --cpu-prof`, JFR, dotnet-trace) or benchmark results.
  - Treat functions above about 5% of CPU as hot. This threshold is a heuristic, not sourced.
  - In diffs that touch hot functions, flag:
    - early-exit loops turned into chains or multiple passes;
    - switch or table dispatch turned into virtual dispatch;
    - per-item allocations or closures.
  - Require before-and-after benchmarks (hyperfine, JMH, pytest-benchmark, vitest bench).
- **Tools:** profilers (perf, py-spy, JFR, Chrome DevTools); hyperfine; JMH; pytest-benchmark; vitest bench.
- **Applies to:** Numeric, trading, game, parsing, serialisation and data-pipeline inner loops. Rarely matters in IO-bound handlers.
- **When not to apply / counterpoints:**
  - Muratori's benchmark is a toy.
  - Martin argues that most business software needs little CPU and should conserve programmer time. HN commenters argue that correctness and safety dominate.
  - The PrimeGenerator case shows that decomposed code can be made fast once it is measured.
- **Fix risk:** high

### T05-F15 — Look for APIs whose edge cases force every caller to repeat the same check, and propose "defining errors out of existence" as an approved behaviour change
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:**
  - Look for patterns repeated at call sites:
    - an exists check before every delete;
    - identical try/catch blocks;
    - the same null or empty guard at every call site.
  - Propose redefining the operation so that the normal path covers the edge case, or handling it once at a higher level.
  - Classify this as a behaviour change that needs approval and new tests.
- **Rationale:**
  - Ousterhout teaches to "reduce the number of places where exceptions must be handled": define errors out of existence, mask them, or collapse them.
  - tef makes the related end-to-end argument.
- **Evidence:**
  - [Exception Handling (CS 190 lecture notes)](https://web.stanford.edu/~ouster/cgi-bin/cs190-spring16/lecture.php?topic=exceptions) — John Ousterhout, Stanford, 2016 — other (author's own notes) — Verified:
    - "Key idea: reduce the number of places where exceptions must be handled."
    - Techniques: define errors out of existence, mask exceptions, collapse exceptions.
    - "Before throwing an exception, think about how the caller will handle it."
  - [Philosophy of Software Design (book notes)](https://sive.rs/book/PoSD) — Sivers on Ousterhout — book, confirmed via secondary source — "Special cases can result in code that is riddled with if statements, which make the code hard to understand and are prone to bugs." / "Design the normal case in a way that automatically handles the edge conditions without any extra code." — Verified.
  - [Write code that is easy to delete, not easy to extend](https://programmingisterrible.com/post/139222674273/write-code-that-is-easy-to-delete-not-easy-to) — tef, 2016 — engineering_blog — "Error handling, and recovery are best done at the outer layers of your code base. This is known as the end-to-end principle." — Verified (Wayback).
- **Detect:**
  - Repeated guards: `rg -B3 '\bF\('` shows the same precondition at 3 or more sites.
  - Identical catch bodies around the same call at 3 or more sites.
  - Exceptions rethrown unchanged through several layers.
  - APIs that throw for "already done" states.
- **Tools:** ripgrep; ast-grep.
- **Applies to:** Library and module APIs, especially file, resource, collection and idempotent operations.
- **When not to apply / counterpoints:**
  - This conflicts with fail-fast policies: masking can hide bugs in the caller.
  - In safety-critical, financial or trading code, a loud failure is often required.
  - The source is one author's teaching.
  - It is always a semantic change, so it is out of scope for a purely structural pass unless approved.
- **Fix risk:** high

### T05-F02 — Collapse middle-man classes and layers that add no abstraction
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. The support is book authority (Fowler and Beck; Ousterhout via secondary notes) plus two anecdotes. There is no empirical study. This matches how the researcher graded similar book-and-practitioner rules (F05, F15). Minor fix: the HN source is a developer describing a friend they hired, not a generic "hiring manager".
- **Rule:**
  - If about half or more of a class's public methods only delegate to the same collaborator, remove the middle man.
  - If two adjacent layers expose the same operations with the same signatures, fold one into the other.
  - Each remaining layer must give a different abstraction from its neighbours.
- **Rationale:**
  - Fowler and Beck give an explicit threshold: "half the methods are delegating". They also acknowledge that "Encapsulation often comes with delegation... All well and good... However, this can go too far."
  - Ousterhout's layering rule is that each layer provides a different abstraction.
  - Practitioners report chains of thin layers that hide nothing.
- **Evidence:**
  - [Refactoring 2nd ed., ch.3 - Middle Man](https://www.informit.com/articles/article.aspx?p=2952392&seqNum=18) — Fowler and Beck, 2018 (publisher excerpt) — book — "You look at a class's interface and find half the methods are delegating to this other class. After a while, it is time to use Remove Middle Man (192) and talk to the object that really knows what's going on. If only a few methods aren't doing much, use Inline Function (115) to inline them into the caller." — Verified via curl.
  - [Philosophy of Software Design (book notes)](https://sive.rs/book/PoSD) — Sivers on Ousterhout — book, confirmed via secondary source — "Each layer provides a different abstraction from the layers above and below it." A pass-through method indicates "An overlap in responsibility between the classes." — Verified.
  - [HN comment on "Clean Code vs. A Philosophy Of Software Design"](https://news.ycombinator.com/item?id=43168907) — jbm, 25 Feb 2025 — practitioner_forum — "I was horrified at the unnecessary use of indirection; 4 or 5 levels in order to do something simple (like a database call)... I've spent the past 4 weeks building the real project, while tossing out the unnecessary junk." — Verified via the HN Algolia API.
  - [Lobsters comment on "It's probably time to stop recommending Clean Code"](https://lobste.rs/c/swjjoc) — akbiggs, 28 Jun 2020, score 56 — practitioner_forum — "I kept adding more and more functions into my code at different layers, and it made my code into a mess with way too much indirection for relatively simple problems." — Verified.
- **Detect:**
  - Per class: count public methods whose body is a single call on the same field. A ratio of 0.5 or more makes the class a candidate.
  - Per layer pair: compare the signatures of X-Service and X-Repository. Identical names and parameters, with no mapping, validation or transaction logic, mean the layer adds no abstraction.
  - At runtime: count consecutive stack frames that pass the same arguments.
- **Tools:** ast-grep; ripgrep; IDE Remove Middle Man / Inline Class; debugger stack traces.
- **Applies to:** OO and layered backends (Spring, .NET, NestJS, Django/FastAPI service layers), hexagonal or "clean architecture" codebases, and AI-scaffolded CRUD apps.
- **When not to apply / counterpoints:**
  - A thin layer may carry cross-cutting behaviour through annotations, decorators or AOP (@Transactional, auth, caching, metrics). Removing it silently drops that behaviour.
  - Ports-and-adapters teams keep thin ports on purpose.
  - A 199-vote SE answer puts interfaces at subsystem boundaries regardless of how many classes implement them.
  - PMD LawOfDemeter and Hide Delegate push in the opposite direction.
- **Fix risk:** medium

### T05-F14 — Flatten needless inheritance; do not add depth during hardening
- **Grade:** C (was B) · **Verdict:** DOWNGRADED, with corrections. The empirical support conflicts or is indirect:
  - Daly et al. (1996) favour 3 levels of inheritance.
  - Prechelt et al.'s published JSS 2003 abstract says less inheritance was faster for their tasks. It also concludes that "there is no such thing as usefulness or harmfulness of a certain inheritance depth as such". The researcher quoted only the 1998 tech report's "flattened versions clearly tended to be superior".
  - Cartwright and Shepperd studied a single industrial system with "little use of OO constructs such as inheritance". Their result is correlational.
  - Mo et al.'s "Unhealthy Inheritance Hierarchy" covers specific LSP and DIP violations, where a parent depends on a child or a client depends on both. It is not about depth or reuse by inheritance, so the researcher mischaracterised it as general support.

  Authoritative guidance (Fowler and Beck, Google TotT) still supports collapsing single-subclass hierarchies and replacing reuse-inheritance with delegation.
- **Rule:**
  - Collapse hierarchies where an abstract base has a single subclass.
  - Replace inheritance that is used only for code reuse with delegation or composition.
  - Do not add inheritance depth.
  - Treat deep hierarchies as areas to test heavily, not as automatic rewrite targets.
- **Rationale:**
  - Fowler and Beck: "Subclasses are always going to know more about their parents than their parents would like them to know".
  - Google lists unsubclassed extensible classes as a YAGNI smell.
  - On depth, the empirical evidence conflicts. Prechelt et al. point to the number of relevant methods, not depth, as the better predictor of maintenance effort.
- **Evidence:**
  - [Refactoring 2nd ed., ch.3 - Insider Trading](https://www.informit.com/articles/article.aspx?p=2952392&seqNum=19) — Fowler and Beck, 2018 (publisher excerpt) — book — "Inheritance can often lead to collusion. Subclasses are always going to know more about their parents than their parents would like them to know. If it's time to leave home, apply Replace Subclass with Delegate (381) or Replace Superclass with Delegate (399)." — Verified. The Lazy Element excerpt also recommends Collapse Hierarchy (380).
  - [Code Health: Eliminate YAGNI Smells](https://testing.googleblog.com/2017/08/code-health-eliminate-yagni-smells.html) — Marc Eaddy, Google, 2017 — engineering_blog — "Classes designed to be subclassed (have virtual methods and/or protected members) that are not actually subclassed" — Verified.
  - [An empirical investigation of an object-oriented software system](http://bura.brunel.ac.uk/bitstream/2438/4805/1/Fulltext.pdf) — Cartwright and Shepperd, IEEE TSE 26(8):786-796, 2000 (DOI 10.1109/32.879814) — peer_reviewed — "an industrial object-oriented (OO) system comprising 133,000 lines of C++... there was little use of OO constructs such as inheritance and therefore polymorphism. It was also found that there was a significant difference in the defect densities between those classes that participated in inheritance structures and those that did not, with the former being approximately three times more defect prone." — Verified in the Brunel repository full text.
  - [A Controlled Experiment on Inheritance Depth as a Cost Factor for Code Maintenance](http://page.mi.fu-berlin.de/prechelt/Biblio/inherit_jss2003.pdf) — Prechelt, Unger, Philippsen, Tichy, JSS 65(2):115-126, Feb 2003 (DOI 10.1016/S0164-1212(02)00053-5) — peer_reviewed. Verified in the author's submission PDF; metadata via Crossref.
    - "we compare the performance on code maintenance tasks for three equivalent programs with 0, 3, and 5 levels of inheritance. For the given tasks, which focus on understanding effort more than change effort, programs with less inheritance were faster to maintain."
    - About Daly et al.: "the 5-level program tended to be harder to maintain than the 0-level program, while the 3-level program was significantly easier to maintain than the 0-level program."
    - "the previous results plus ours suggest that there is no such thing as usefulness or harmfulness of a certain inheritance depth as such. Code maintenance effort is hardly correlated with inheritance depth, but rather depends on other factors (partly related to inheritance depth)... the number of relevant methods".
  - [Evaluating inheritance depth on the maintainability of object-oriented software](https://doi.org/10.1007/BF00368701) — Daly, Brooks, Miller, Roper, Wood, Empirical Software Engineering 1(2):109-132, 1996 — peer_reviewed — The metadata was confirmed via Crossref. The results were confirmed only through Prechelt et al.'s abstract (secondary). The earlier researcher link was an OpenAlex search URL, which could not be re-checked because of rate limits.
- **Detect:**
  1. Count the direct subclasses of each base. A count of 1 makes it a Collapse Hierarchy candidate.
  2. DIT above 3, from a metrics tool or IDE. Use this for triage only, given the Prechelt result.
  3. Protected fields written by subclasses (Insider Trading).
  4. Parent classes that reference their subclasses, and clients that depend on both a base and its subclasses (Mo et al.'s Unhealthy Inheritance Hierarchy).
  5. PMD UselessOverridingMethod for overrides that only call super.
- **Tools:** ripgrep; IDE type hierarchy; PMD UselessOverridingMethod; OO metrics tools (DIT).
- **Applies to:** OO languages.
- **When not to apply / counterpoints:**
  - The evidence on depth conflicts (Daly vs Prechelt), and Prechelt's own conclusion is that depth per se is not the driver.
  - Framework-mandated hierarchies cannot be flattened.
  - Collapsing a hierarchy can break overrides, super calls, instanceof checks, serialisation discriminators and ORM inheritance mappings.
- **Fix risk:** high

## Practitioner voice

All of these were opened and confirmed in this pass: HN via the Algolia API, StackExchange via its API, and Lobsters and blogs via WebFetch or curl.

- [Lobsters: worst code after reading Clean Code](https://lobste.rs/c/swjjoc) — akbiggs (score 56, 2020) wrote "some of the worst code of my entire life" after reading Clean Code, with "way too much indirection for relatively simple problems". Later, "every single file I had written had been thrown out because the senior developer on the project was sick of having to deal with it."
- [HN 43168907: 4-5 levels of indirection for a DB call](https://news.ycombinator.com/item?id=43168907) — The poster hired a friend who was a "huge Uncle Bob mark". The friend built "4 or 5 levels" of indirection for a database call and had juniors "build entire classes as an interface". The poster spent 4 weeks rebuilding the project, "tossing out the unnecessary junk" (Feb 2025).
- [HN 48620623: duplication broke on MySQL 4 to 5](https://news.ycombinator.com/item?id=48620623) — Counter-experience to "prefer duplication". A duplicated query pattern in "hundreds of places" broke on a MySQL upgrade. The commenter cites twenty years of small shops that "tie themselves in knots" by avoiding abstractions (Jun 2026).
- [HN 48620737: LLM code didn't reuse shared code](https://news.ycombinator.com/item?id=48620737) — In LLM-heavy code, the commenter expected a change to propagate, "assuming common code / styling was reused, only to find it wasn't". They will not use LLMs on client code without heavy scrutiny of every line (Jun 2026).
- [HN 35108619: strategy pattern for a twice-used one-liner](https://news.ycombinator.com/item?id=35108619) — The commenter has pushed back on PRs that generalise "one-liners that pop up twice in the whole project" with a strategy pattern, "replacing two expressions with three classes" (Mar 2023).
- [HN 35106042: safety vs Muratori's style](https://news.ycombinator.com/item?id=35106042) — Concurrent, networked and safety-critical apps need abstractions that keep state valid. Game engines are "an incredibly forgiving domain" (Mar 2023).
- [HN 43167069: five years to trust own judgement](https://news.ycombinator.com/item?id=43167069) — The commenter read Clean Code in their first job and let its asterisk-free rules override their judgement. "5 years sounds about right" for how long it took to trust their judgement again (Feb 2025).
- [HN 48621156: abstraction right the third time](https://news.ycombinator.com/item?id=48621156) — Framework authors "had done similar things two or so times previously and got it right the third time". It was hard to write slow or hard-to-operate code there (Jun 2026).
- [HN 35106801: leave working code alone](https://news.ycombinator.com/item?id=35106801) — "Code that meets its requirements needs to be left alone." (Mar 2023)
- [HN 48620718: abstraction need appears when it catches fire](https://news.ycombinator.com/item?id=48620718) — You may "not realise you needed an abstraction until it catches fire in multiple places". Also: "there is rarely budget to electively replace code that isn't broken" (Jun 2026).
- [Abramov: Goodbye, Clean Code](https://overreacted.io/goodbye-clean-code/) — He deduplicated a colleague's code without talking to them, and his boss asked him to revert it. It "traded the ability to change requirements for reduced duplication, and it was not a good trade" (Jan 2020).
- [Segment: Goodbye Microservices](https://segment.com/blog/goodbye-microservices/) — Alexandra Noonan, 10 Jul 2018; the URL now redirects to twilio.com. With 140+ services, engineers under time pressure updated shared libraries in one destination only, and versions diverged. After consolidation, shared-library improvements went from 32 to 46 the following year. "One engineer can deploy the service in a matter of minutes."
- [Ousterhout-Martin debate](https://github.com/johnousterhout/aposd-vs-clean-code) — Martin's rewrite split one early-exit loop into two: 5-10x more iterations and a 3-4x slowdown. After Ousterhout measured it, Martin produced a still-decomposed version that was faster (440 ms vs 561 ms). Martin also said he "could not figure out why those moving parts generated a list of prime numbers", both in his own 18-year-old Clean Code version and in Ousterhout's commented one.
- [grugbrain.dev](https://grugbrain.dev/) — Introducing OSGi to "trap" complexity made it "much more powerful" and "took multiple man year of best developers to rework". The advice: keep refactors small and respect Chesterton's fence.
- [Koppel review of Tidy First?](https://www.pathsensitive.com/2024/04/book-review-tidy-first.html) — Koppel calls the tidyings "a rather impoverished repertoire" (1 Apr 2024). He has "started to turn against" deleting unused code just because version control keeps it.
- [SE 159813: interfaces with one implementation](https://softwareengineering.stackexchange.com/questions/159813) — The accepted top answer (247) says YAGNI strictly applies, but it is better to err towards defining the interface, for mocks. The second answer (199) puts interfaces at subsystem boundaries "no matter how many classes implement them". An 88-vote answer calls automatic Foo/FooImpl pairs "an anti-pattern". These are the top answers, not a measured majority. They directly oppose Go's official guidance.
- [Muratori-Martin Q&A](https://github.com/cmuratori/misc/blob/main/cleancodeqa.md) — Martin: "I am not an expert in performance... To a performance hammer, everything looks like a nail. ;-)" (2023)

## Contradictions and open questions

**Contradictions**

- **Decomposition depth.**
  - Ousterhout says over-decomposition creates shallow, entangled methods and that the One Thing Rule "lacks guardrails".
  - Martin: "if I must err, I'd rather err on the side of decomposition."
  - The accepted SE answer (240) says to split whenever a description needs "and".
  - Both authors agree that Clean Code 1st ed. gives little guidance on recognising over-decomposition.
- **Inlining and length.**
  - Carmack: "If a function is only called from a single place, consider inlining it." He disagrees with page-length rules.
  - The Linux kernel sets a default of one or two 80x24 screens and "do just one thing". It relaxes the default for simple case statements and recommends "helper functions with descriptive names" that the compiler can inline.
- **Duplication vs abstraction.**
  - Tolerate duplication: Metz, tef, Dodds, Abramov and the Go proverbs.
  - Deduplicate: Beck's simple-design rules rank "no duplication" above "fewest elements".
  - GitClear vendor data (2021-2024, correlational with the spread of AI assistants) shows copy/pasted lines rising from 8.3% to 12.3% of changed lines and moved/refactored lines falling from 25% to under 10%. HN failure reports show duplicated code drifting and breaking.
- **Flags in shared code.** Metz treats accumulated flag parameters as the sign of a wrong abstraction. Carmack advises consolidating work into one place "perhaps with flags". Prechelt's flag-based alternative was slower to extend and more error-prone in one task, but faster and error-free in another.
- **Speculative flexibility.**
  - Against it: Google TotT, the Google code review guide, Go CodeReviewComments and Google Go style: no interfaces before a real need.
  - For it: the top SE answers (interfaces for mocks and at boundaries).
  - Mixed: Prechelt et al. (TSE 2001) found mostly positive effects, including one despite superfluous Decorator flexibility, and a few negative ones. They recommend the pattern "unless there is a clear reason to prefer the simpler solution".
  - Ousterhout himself advises "Implement a mechanism that can be used to address a broad range of problems, not just the ones that are important today" (Sivers' notes). This is in tension with a strict YAGNI reading, though Fowler's YAGNI explicitly exempts effort that makes code easier to modify.
- **Delegation.** The Middle Man smell and Ousterhout's pass-through red flag push against delegation. PMD LawOfDemeter and Fowler's Hide Delegate push towards it. Fowler treats them as a balance.
- **Inheritance depth.**
  - Daly et al. (EMSE 1996): 3 levels quicker to maintain than flat.
  - Prechelt et al. (JSS 2003): less inheritance was faster for their tasks; depth as such is neither useful nor harmful; the number of relevant methods explains effort better.
  - Cartwright and Shepperd (TSE 2000): classes in inheritance structures were about 3x more defect-prone, in one system with little inheritance.
- **God and large classes.**
  - Palomba et al. (30 projects): smelly classes are riskier.
  - Olbrich et al. (3 systems): God and Brain classes are less risky per line once normalised by size.
  - Ousterhout's teaching heuristic is 200-2000 lines per class.
- **Locality of Behaviour vs DRY and separation of concerns.** Gross states the conflict explicitly and says there is "no hard and fast rule".
- **Performance vs "clean" structure.** Muratori measured penalties of 1.5x to 25x on a microbenchmark. In the PrimeGenerator case, the slowdown was fixed without abandoning decomposition. Critics argue that safety and changeability dominate in most business code.
- **Tidying value.** Beck presents small, structure-only tidyings as the core tool. Koppel calls them insufficient and disputes "delete dead code because VCS keeps it".
- **Cycles.**
  - Oyetoyan et al. found that cycles raise change-proneness, but found no criterion that separates harmful cycles from harmless ones.
  - Mo et al. rank Package Cycle below Unstable Interface and Crossing.
  - Blanket "no cycles" rules are therefore stronger than the evidence.

**Open questions**

- No controlled experiment compares "many tiny methods" with "fewer deep methods" on realistic modern code.
- There is no validated automated metric for module depth. Linters catch only degenerate pass-throughs.
- Thresholds for co-change (code-maat's 30% defaults) and for anti-patterns (Mo et al.'s configurable thresholds) are tool defaults. What should trigger action on a small, recently finished repository is unclear.
- For AI-generated codebases, outcome data is missing: is it better to consolidate clones or keep local, regenerable copies? GitClear measures prevalence, not outcomes, and does not separate AI-authored lines.
- No evidence was found on whether breaking cycles or anti-patterns reduces defects. Kim et al.'s Windows 7 result is the only intervention-like data, and it is observational.
- A 2024 study in *Information and Software Technology* ("Prevalence and severity of design anti-patterns in open source programs") was seen only as a search snippet by the researcher and could not be opened. Its numbers are excluded.
- Reddit (r/ExperiencedDevs) could not be accessed.
- The primary texts of APOSD 2nd ed., *Tidy First?* and the Rule of Three passage in *Refactoring* were not read directly.
- Palomba et al. was checked from the abstract only. Whether it controls for class size was not verified.

## Dropped findings

None. All 17 findings survived: 9 verified, 6 corrected, 2 downgraded. Every practitioner-voice URL opened and supported its gist after the wording fixes noted above.

An earlier draft of this dossier removed a Prechelt 2001 sub-claim from F07 ("a positive effect even with superfluous Decorator flexibility"). That removal was wrong: the author's preprint abstract (2 Dec 2000) states it verbatim. The published TSE 2001 abstract, as indexed by OpenAlex, omits that sentence (citation audit), so the claim is restored in F07 with the preprint as its source.
