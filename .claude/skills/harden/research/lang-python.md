# Python best practices from authoritative sources
> Code T21 · slug lang-python · verified 2026-09-23 · counts: verified 9 / corrected 15 / downgraded 1 / dropped 0

## How this was checked
I opened every cited source on 2026-09-23 and found the quoted text or data myself. This dossier was checked twice on that date. The second pass, when the workflow resumed, downloaded every source again and checked it independently of the first pass. It confirmed nearly all of the first pass's corrections and made five changes:
- **F07:** changed from VERIFIED to CORRECTED. The "27% intentional" counterpoint misreads PEP 765.
- **F03:** added RUF008, the rule that actually covers mutable dataclass defaults.
- **F16:** corrected the date of a Bandit #333 comment.
- **F22:** added that Python 3.15 is not released yet.
- **F12 and F05:** added two Ruff details, the `keep-runtime-typing` setting and a change to BLE001's behaviour in 0.16.

The methods were:
- **Web pages and docs:** curl or WebFetch, then a grep of the text.
- **Ruff default set:** parsed the Ruff default-rules page directly. It lists 413 unique codes.
- **GitHub:** checked issues and search counts with the `gh` API. The counts (276 / 105 / 36) reproduced exactly.
- **Hacker News:** read every comment through the HN Algolia items API.
- **Papers:** read abstracts through the arXiv and OpenAlex APIs. For Zhang et al. (ICSE 2023) I also read the PDF.
- **Effective Python:** matched item numbers against the official table of contents on effectivepython.com. Only titles were checked, not the book text.

WebSearch was already used up for this session, so any other source was reached by following links.

## Summary
(This is the researcher's summary, corrected.)

Versions current on 2026-09-23, all confirmed on the official pages:

| Tool or document | Version | Note |
|---|---|---|
| Ruff | 0.16.8 (2026-09-16) | 0.16.0, released 2026-07-23, raised the default set from 59 to 413 rules and dropped 18 E/F rules from it |
| mypy docs | 2.3.1 | |
| Python docs | 3.14.7 | |
| pandas | 3.0.6 | |
| polars | 1.44.2 | |
| Black | 26.5.1 | |
| pip-audit | 2.10.1 | version used in the README's pre-commit example |

Status of the PEPs cited:

| PEP | Status |
|---|---|
| PEP 8 | last modified 2025-04-04 |
| PEP 735 | Final, resolved 2024-10-10 |
| PEP 751 | Final, resolved 2025-03-31 |
| PEP 760 | Withdrawn |
| PEP 765 | Final, Python 3.14 |
| PEP 686 | Final, Python 3.15 |
| PEP 649 / PEP 749 | Final, Python 3.14 |

**1. Tooling rules are well documented but only safe with discipline.**
- Pin the linter and make the rule set explicit.
- Apply autofixes one rule family at a time, with tests between batches.
- Never apply unsafe fixes blindly.

The Ruff tracker has 276 issues labelled both `fixes` and `bug`, and 105 issues that contain the phrase "should be unsafe". Wrong fix-safety labels have hit stable default rules: F541 (#18807, still open), F504, C408 and RUF015. One correction: the July 2026 RUF055 example the researcher cited is a **preview** rule. It does not show that stable rules still have this problem.

**2. Several high-value rules are not in Ruff 0.16's defaults and must be added explicitly.** Each of these is backed by official Python or library documentation:
- RUF006 (dangling asyncio task)
- B904 (raise without from)
- S113, S301, S307, S506, S602, S608 (security)
- PGH003 / PGH004 (blanket suppressions)
- PLW0603 (global statement)
- C901 / PLR09xx (complexity) and ERA001 (commented-out code), which should be report-only

**3. Empirical anchors specific to Python:**
- **Khan et al. (IEEE TSE 2021):** mypy could have prevented 15% of the defects in 210 projects. The authors call this a lower bound.
- **Di Grazia & Pradel (ESEC/FSE 2022):** 78.3% of commits were made even though the code had type errors.
- **PEP 765:** of 203 return/break/continue statements inside `finally` in the top 8,000 PyPI packages, 149 (73%) were wrong. Of the rest, 46 were test fixtures that exercise the pattern on purpose, and only 8 (about 4%) looked like plausibly correct use in real code.
- **Ruohonen et al. (PST 2021):** a Bandit scan of 197k PyPI packages found exception handling and code injection were the most common issue types. These are flagged patterns, not confirmed bugs.
- **Zhang et al. (ICSE 2023):** in real code, Pythonic idiom rewrites made little difference to speed, and some were slower.
- **Vavrová & Zaytsev (2017):** code-smell prevalence in Python differs sharply from Java. Corrected: the paper does not test whether Java thresholds "transfer".
- **2026 preprints on agent-written Python PRs:** in one, 24.17% of modified files gained new Pylint issues. Another reports GPT-4o refactorings that reduce smells but also reduce readability.

**4. Practitioner feedback confirms the high-value rules.** HN comments and GitHub issues describe real bugs from mutable defaults, dangling tasks, blocking the event loop, and a bare except that hid a wrong-arity call.

**5. The same feedback pushes back on noisy rules and on big rule-set upgrades.**
- Rules singled out as noisy: RUF012, TRY003, S603 and `except Exception`.
- After the 0.16 upgrade, one person reported 2,900 new errors. Another reported 100+ unfixable errors in under 10k lines of code.
- Agents have been seen "fixing" lint by deleting tests or bloating the code.

**Conclusion:** treat correctness rules as gates and complexity and style rules as ranked worklists. Treat every fix as a change that can break behaviour and needs tests.

## Findings

### T21-F08 — Enforce structured asyncio task lifecycles (no dangling tasks, never swallow CancelledError)
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Keep a reference to every `asyncio.create_task` / `ensure_future` result. Detect this with RUF006, which is stable since v0.0.247 but not in the 0.16 defaults, so add it. flake8-async's ASYNC300 is the equivalent.
  - Prefer `asyncio.TaskGroup` (3.11+). For long-lived background tasks, keep them in a set and call `add_done_callback(set.discard)`.
  - Never swallow `asyncio.CancelledError` without re-raising it. That includes swallowing it through a bare `except:` or `except BaseException`. If suppression really is intended, also call `Task.uncancel()`.
  - Run the test suite with asyncio debug mode on.
- **Rationale:** The asyncio docs say the event loop "only keeps weak references to tasks", so an unreferenced task "may get garbage collected at any time, even before it's done". They also say TaskGroup, unlike gather, cancels the remaining tasks when one fails. Structured-concurrency primitives "might misbehave if a coroutine swallows asyncio.CancelledError".
- **Evidence:**
  - [Coroutines and Tasks](https://docs.python.org/3/library/asyncio-task.html) — PSF, Python 3.14.7 docs, 2026 — official_docs — "Save a reference to the result of this function, to avoid a task disappearing mid-execution. The event loop only keeps weak references to tasks." / "TaskGroup provides stronger safety guarantees than gather…" / "in cases when suppressing asyncio.CancelledError is truly desired, it is necessary to also call uncancel()" — all three passages confirmed verbatim.
  - [Developing with asyncio](https://docs.python.org/3/library/asyncio-dev.html) — PSF, 2026 — official_docs — debug mode is enabled by PYTHONASYNCIODEBUG=1, Python Development Mode, `asyncio.run(debug=True)` or `loop.set_debug()`. It reports never-awaited coroutines, never-retrieved exceptions and callbacks slower than 100 ms — confirmed.
  - [asyncio-dangling-task (RUF006)](https://docs.astral.sh/ruff/rules/asyncio-dangling-task/) — Astral, 2026 — official_docs — "the event loop only retains a weak reference to tasks… your tasks may or may not run to completion" — confirmed. The rules index says "stable since v0.0.247", and my parse of the default-rules page confirms RUF006 is not in the 413 defaults.
  - [flake8-async rules (ASYNC300 create-task-no-reference)](https://flake8-async.readthedocs.io/en/latest/rules.html) — python-trio, 2026 — official_docs — added by the checker as a corroborating second source.
  - [The Heisenbug lurking in your async code](https://textual.textualize.io/blog/2023/02/11/the-heisenbug-lurking-in-your-async-code/) — Will McGugan (Textualize), 2023-02-11 — engineering_blog — "if you don't hold a reference to the task object returned by create_task then the task may disappear without warning when Python runs garbage collection" — confirmed.
  - [HN: "A Heisenbug lurking in async Python"](https://news.ycombinator.com/item?id=34754276) — HN, 2023 — practitioner_forum — story 34754276: 696 points, 232 comments, confirmed via Algolia. Comment [34755050](https://news.ycombinator.com/item?id=34755050) by notatoad: "this absolutely explains a heisenbug that i've been chasing for a while" — confirmed.
- **Detect:**
  - `ruff check --select RUF006,ASYNC .`
  - Grep for `asyncio.create_task(` / `ensure_future(` calls used as bare statements.
  - Grep for `except (asyncio.)?CancelledError`, `except BaseException` and bare `except:` inside `async def`, then check that each handler re-raises.
  - At runtime: `PYTHONASYNCIODEBUG=1 python -X dev -m pytest`, then grep the output for "never awaited" and "never retrieved".
- **Tools:** ruff (RUF006, ASYNC), flake8-async (ASYNC300), asyncio debug mode
- **Applies to:** asyncio code such as servers, bots, websocket clients and exchange connectors.
- **When not to apply / counterpoints:**
  - Moving from gather to TaskGroup changes behaviour: sibling tasks are cancelled on the first failure, and errors arrive as an ExceptionGroup.
  - `gather(return_exceptions=True)` is legitimate for independent jobs.
  - Short scripts rarely hit the garbage-collection window.
- **Fix risk:** medium

### T21-F07 — Remove return/break/continue that exit a `finally` block (B012)
- **Grade:** A · **Verdict:** CORRECTED (the "about 27% intentional" counterpoint misread PEP 765. Most of that 27% were linter test fixtures; only about 4% of the instances were plausibly intentional in real code.)
- **Rule:** Remove `return`, `break` and `continue` statements inside `finally` (B012, in the 0.16 defaults). Move the return after the try statement or restructure the logic. Where swallowing the exception really is intended, make that explicit (for example `except BaseException: ...; return`).
- **Rationale:** PEP 765 makes these a SyntaxWarning in 3.14 because "exceptions are not re-raised" when they run. Its survey of the top 8,000 PyPI packages (120,964,221 LOC) found 203 instances. 149 (73%) were "clearly incorrect". 73 issues were filed. Maintainers reacted on 40: 15 opened a fix PR and 20 acknowledged the problem. The rule fires rarely, but when it does it is usually a real bug.
- **Evidence:**
  - [PEP 765](https://peps.python.org/pep-0765/) — Irit Katriel & Alyssa Coghlan, created 2024-11-15 — standard — Final, Python 3.14. The figures above are confirmed. PEP 765 splits the 203 instances as follows:
    - 46 "are correct, and appear in tests that target this pattern as a feature (e.g., tests for linters that detect it)"
    - 8 "seem like they could be correct"
    - 149 "were clearly incorrect"
  - [jump-statement-in-finally (B012)](https://docs.astral.sh/ruff/rules/jump-statement-in-finally/) — Astral, 2026 — official_docs — "can cause exceptions to be silenced" — confirmed. B012 is in the defaults (checked).
- **Detect:** `ruff check --select B012 .`. On 3.14, also run `python -W error::SyntaxWarning -m compileall src`.
- **Tools:** ruff (B012), CPython 3.14 SyntaxWarning
- **Applies to:** all code with try/finally.
- **When not to apply / counterpoints:**
  - The researcher wrote that "about 27%" of the sample was intentional. That is 54 of 203, and 46 of those 54 were linter test fixtures.
  - Only 8 of 203 (about 4%) were plausibly correct uses in real code. Even for those, PEP 765 recommends rewriting: use `except BaseException:` to swallow deliberately, or move the `return` after the `finally` block.
  - Keep the jump only in code that tests a linter.
- **Fix risk:** medium

### T21-F05 — Narrow exception handling; broad catches only at isolation boundaries
- **Grade:** A · **Verdict:** CORRECTED (the PEP 760 withdrawal reason was misattributed, and the Ruohonen data is flagged prevalence, not confirmed bugs)
- **Rule:**
  - No bare `except:` (E722). No `except Exception/BaseException` unless the handler re-raises or logs with the traceback (BLE001). No `try/except: pass` (S110) or `try/except: continue` (S112). All four are in the 0.16 defaults.
  - Catch only the exception types the code can actually handle.
  - Keep the try body to the smallest code that can raise the handled error, and move follow-on code to `else:`. The matching rule is PLW0717, which is preview only and defaults to at most 5 statements in a try.
  - Allow broad catches only at isolation boundaries: a request handler, job loop or plugin call. There, log with `logger.exception` / `exc_info=True`, then re-raise or record the failure explicitly.
- **Rationale:**
  - PEP 8 says to catch specific exceptions and to "limit the try clause to the absolute minimum amount of code necessary… this avoids masking bugs".
  - The Google guide forbids catch-all handlers except to re-raise or at an isolation point.
  - PEP 20: "Errors should never pass silently."
  - A Bandit scan of 197k PyPI packages found exception-handling patterns (try/except/pass and similar) among the most frequently flagged issues. That shows the pattern is common; it does not show harm.
  - A practitioner describes a bare except that hid a wrong-arity call and led to leaking threads that crashed a server.
- **Evidence:**
  - [PEP 8 — Programming Recommendations](https://peps.python.org/pep-0008/) — PSF, last modified 2025-04-04 — standard — "mention specific exceptions whenever possible instead of using a bare except: clause"; "A bare except: clause will catch SystemExit and KeyboardInterrupt exceptions"; "limit the try clause to the absolute minimum amount of code necessary. Again, this avoids masking bugs" — confirmed verbatim.
  - [Google Python Style Guide §2.4](https://google.github.io/styleguide/pyguide.html) — Google — official_docs — "Never use catch-all except: statements, or catch Exception or StandardError, unless you are re-raising the exception, or creating an isolation point…"; "Minimize the amount of code in a try/except block." — confirmed.
  - [PEP 20](https://peps.python.org/pep-0020/) — Tim Peters, 2004 — standard — "Errors should never pass silently." — confirmed.
  - [blind-except (BLE001)](https://docs.astral.sh/ruff/rules/blind-except/) — Astral — official_docs — exceptions that are re-raised, or logged with exc_info, are not flagged — confirmed. The [0.16.0 changelog](https://raw.githubusercontent.com/astral-sh/ruff/main/CHANGELOG.md) stabilised a wider exemption: "BLE001 is now suppressed when the exception is logged via logging methods other than critical, error and exception". So a broad catch that only logs can now pass BLE001. The skill still has to check by hand that the handler re-raises or records the failure.
  - [Ruohonen, Hjerppe, Rindell, PST 2021](https://arxiv.org/abs/2107.12699) — peer_reviewed (IEEE PST 2021) — "over 197 thousand packages and over 749 thousand security issues… about 46%… exception handling and different code injections have been the most common issues" — confirmed in the abstract. Checker's note: these are Bandit-flagged patterns (B110/B112), which shows prevalence, not defects.
  - [HN comment by lgunsch](https://news.ycombinator.com/item?id=20306339) — 2019 — practitioner_forum — "a bare try-except hiding a function call with a missing argument; 2 args passed instead of 3" — confirmed.
  - [AIRA: AI-Induced Risk Audit](https://arxiv.org/abs/2604.17587) — William M. Parris, 2026 — preprint (single author) — AI-attributed files show 0.435 high-severity findings per file against 0.242 in human controls (1.80x), across 955+955 files. The effect is "strongest" in exception-handling patterns — confirmed in the abstract. Weak evidence: one unreviewed preprint.
  - [PEP 760 discussion thread](https://discuss.python.org/t/pep-760-no-more-bare-excepts/67182) — discuss.python.org, 2024 — practitioner_forum — the authors withdrew the PEP because "the consensus is that the benefits doesn't justify the cost". In the thread, Barry Warsaw argues that a bare except with an unconditional `raise` is legitimate for transactional rollback. This source was added by the checker; the researcher had presented the rollback point as the official withdrawal reason.
- **Detect:**
  - `ruff check --select E722,BLE001,S110,S112 .`
  - `ruff check --preview --select PLW0717 .`
  - Manual review of each broad handler: is it at a boundary, does it log the traceback, and does it re-raise or return an explicit failure? (The researcher's ast-grep pattern for multi-line try/except was not tested by the checker.)
- **Tools:** ruff (E722, BLE001, S110, S112, PLW0717-preview), ast-grep
- **Applies to:** all code, especially worker loops, retry wrappers, plugin loaders and code written by agents.
- **When not to apply / counterpoints:**
  - One practitioner reports "exactly 0 bugs" from `except Exception` in 20 years ([HN 49058556](https://news.ycombinator.com/item?id=49058556)).
  - A bare except followed by re-raise is legitimate.
  - Top-level handlers in daemons have to catch broadly.
  - Narrowing too far turns graceful degradation into crashes.
- **Fix risk:** high

### T21-F03 — Replace mutated mutable defaults (B006/B008) and shared mutable class attributes (RUF012/RUF008/RUF009)
- **Grade:** A · **Verdict:** CORRECTED (PEP 8 was removed as a source because it says nothing about mutable defaults. RUF008 `mutable-dataclass-default` was added, because RUF009 is `function-call-in-dataclass-default-argument` and does not cover mutable dataclass defaults.)
- **Rule:** Replace mutable default arguments and shared mutable class attributes where the default can be mutated or can escape the function.
  - For arguments, use a `None` sentinel and build the object inside the function, or use an immutable default (tuple, frozenset).
  - For dataclasses, use `field(default_factory=...)`.
  - Keep an intentional memo cache only when it is explicit: `functools.lru_cache`, or a private `_cache` keyword argument with a comment.
- **Rationale:** The Python FAQ explains that defaults are created once, when the function is defined, so mutations persist across calls. Ruff B006 gives the same reason. The Google guide (§2.12) and Effective Python 3rd ed. item 36 both use the None-sentinel idiom. The researcher also cited PEP 8, but PEP 8 contains no guidance on mutable defaults.
- **Evidence:**
  - [Programming FAQ — Why are default values shared between objects?](https://docs.python.org/3/faq/programming.html) — PSF, Python 3.14.7 — official_docs — defaults are created once. It shows the `if mydict is None: mydict = {}` idiom and the memoization example `def expensive(arg1, arg2, *, _cache={})` — confirmed.
  - [mutable-argument-default (B006)](https://docs.astral.sh/ruff/rules/mutable-argument-default/) — Astral — official_docs — "Function defaults are evaluated once, when the function is defined." The fix is marked unsafe, and "Known problems" recommends `functools.lru_cache` for intentional caching — confirmed.
  - [mutable-class-default (RUF012)](https://docs.astral.sh/ruff/rules/mutable-class-default/) — Astral — official_docs — "Mutable default values share state across all instances of the class, while not being obvious." — confirmed.
  - [Google Python Style Guide §2.12](https://google.github.io/styleguide/pyguide.html) — Google — official_docs — "Okay to use with the following caveat: Do not use mutable objects as default values in the function or method definition." — confirmed.
  - [Effective Python, 3rd ed.](https://effectivepython.com/) — Brett Slatkin, Pearson, Nov 2024 — book — item 36 "Use None and Docstrings to Specify Dynamic Default Arguments". Book confirmed via the author's TOC page; the item number was checked against the TOC, the text was not read.
  - [HN comment by IshKebab](https://news.ycombinator.com/item?id=49061460) — 2026 — practitioner_forum — "Probably the most common is the mutable default argument gotcha." — confirmed.
- **Detect:** `ruff check --select B006,B008,RUF008,RUF009,RUF012 .`. All five are in the 0.16 defaults (checked against the parsed default list). The rules index names them:
  - RUF008: mutable-dataclass-default
  - RUF009: function-call-in-dataclass-default-argument
  - B008: function-call-in-default-argument

  For each hit, check whether the default is mutated, returned or stored on `self`. If not, the hit is style-only.
- **Tools:** ruff
- **Applies to:** all Python code.
- **When not to apply / counterpoints:**
  - The FAQ documents intentional memoization through a default argument.
  - anticodon: "mutable default argument is not a bug. It is a bug only if … mutated" ([HN 49065551](https://news.ycombinator.com/item?id=49065551)). IshKebab disagrees: "It's quite common in my experience" ([49067179](https://news.ycombinator.com/item?id=49067179)).
  - RUF012 was called "the most idiotic rule I've ever seen" ([49058556](https://news.ycombinator.com/item?id=49058556)).
  - Never-mutated constants gain nothing from the change.
- **Fix risk:** medium

### T21-F04 — Fix late-binding closures created in loops (B023)
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Fix closures and lambdas created in loops that read the loop variable after the loop has moved on (B023, in the 0.16 defaults). Bind the value when the closure is defined, with `functools.partial` or a default argument (`lambda x, i=i: ...`). Prefer `partial` when the callable is part of an API, because a default argument adds a parameter that callers can override.
- **Rationale:** The FAQ explains that the loop variable is looked up when the closure is called, so every closure sees the last value. Ruff B023 shows adders returning `[3, 3, 3]`. The bug is silent and depends on the data.
- **Evidence:**
  - [Programming FAQ — lambdas in a loop](https://docs.python.org/3/faq/programming.html) — PSF — official_docs — fix `lambda n=x: n**2`; "applies to regular functions too" — confirmed.
  - [function-uses-loop-variable (B023)](https://docs.astral.sh/ruff/rules/function-uses-loop-variable/) — Astral — official_docs — "it will always have the value it had in the last iteration when the function is called"; the `[3, 3, 3]` example — confirmed.
  - [Hitchhiker's Guide — Common Gotchas](https://docs.python-guide.org/writing/gotchas/) — Kenneth Reitz et al. — online guide — "Sometimes you want your closures to behave this way. Late binding is good in lots of situations."; `functools.partial` alternative — confirmed.
- **Detect:** `ruff check --select B023 .`. Manually review callbacks registered in loops: GUI handlers, `call_soon`, thread targets and dispatch dicts.
- **Tools:** ruff (B023)
- **Applies to:** loops that build callbacks.
- **When not to apply / counterpoints:** late binding is sometimes intended. B023 also flags closures that are called immediately inside the same iteration, where no bug exists.
- **Fix risk:** low

### T21-F25 — Don't use `assert` for runtime validation
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Do not use `assert` to validate inputs, configuration or invariants that must hold in production. Raise explicit exceptions instead. Keep `assert` for internal sanity checks and tests. Detect with S101, which is not in the defaults, and ignore it in test paths.
- **Rationale:** Under `-O`, "The current code generator emits no code for an assert statement". The Google guide says: "Do not use assert statements in place of conditionals or validating preconditions."
- **Evidence:**
  - [Language Reference — assert](https://docs.python.org/3/reference/simple_stmts.html#the-assert-statement) — PSF — official_docs — confirmed verbatim.
  - [Google Python Style Guide §2.4](https://google.github.io/styleguide/pyguide.html) — Google — official_docs — confirmed verbatim. The guide adds: "They must not be critical to the application logic."
  - [Bandit plugins (B101 assert_used)](https://bandit.readthedocs.io/en/latest/plugins/index.html) — PyCQA — official_docs — confirmed.
- **Detect:** `ruff check --select S101 .`, with `per-file-ignores` `"tests/**" = ["S101"]`.
- **Tools:** ruff (S101), bandit (B101)
- **Applies to:** library and service code that might run under `-O` / PYTHONOPTIMIZE.
- **When not to apply / counterpoints:**
  - Most deployments never use `-O`.
  - `assert isinstance` is used for type narrowing.
  - Converting an assert changes the exception type from AssertionError, so callers that catch it will break.
- **Fix risk:** medium

### T21-F16 — Gate on a high-signal subset of flake8-bandit (S) rules
- **Grade:** A · **Verdict:** CORRECTED (the Bandit #333 responder was a commenter, not a maintainer)
- **Rule:** Gate on:
  - S102 exec (default) and S307 eval
  - S301 pickle and S506 `yaml.load`
  - S602/S604/S605 shell invocation
  - S608 SQL built from strings
  - S113 no timeout, S501 `verify=False`, S324 weak hash

  Treat these as review hints only:
  - S101 (see F25)
  - S603/S607
  - S105–S107 (password-name heuristics)

  Apart from S102, none of the gating rules is in the 0.16 defaults (checked).
- **Rationale:** Official docs back each gating rule. Bandit is not a data-flow analyzer, so S603 flags every subprocess call and should not be a gate.
- **Evidence:**
  - [subprocess — Security Considerations](https://docs.python.org/3/library/subprocess.html#security-considerations) — PSF — official_docs — "If the shell is invoked explicitly, via shell=True, it is the application's responsibility to ensure that all whitespace and metacharacters are quoted appropriately to avoid shell injection vulnerabilities." — confirmed.
  - [pickle](https://docs.python.org/3/library/pickle.html) — PSF — official_docs — "The pickle module is not secure… execute arbitrary code during unpickling." — confirmed.
  - [Requests — Timeouts](https://requests.readthedocs.io/en/latest/user/advanced/#timeouts) — Requests — official_docs — "By default, requests do not time out unless a timeout value is set explicitly. Without a timeout, your code may hang for minutes or more." — confirmed.
  - [Bandit test plugins](https://bandit.readthedocs.io/en/latest/plugins/index.html) — PyCQA — official_docs — B101, B110, B113, B506, B602, B603, B608, B614 pytorch_load and B615 huggingface_unsafe_download are all listed. The Ruff rules index has no S614/S615 (checked).
  - [Bandit issue #333 "B603 false positive?"](https://github.com/PyCQA/bandit/issues/333) — GitHub, opened 2018, still open — practitioner_forum — commenter bcaller (GitHub association: NONE, so not a maintainer): "bandit isn't a code-flow analy[zer]"; "the test is a bit dumb. It will flag any use of check_output regardless." A 2023-08-12 comment by nfantone says "the same is also true for B603 in Ruff". Corrected: the researcher called this a maintainer admission.
  - [Ruohonen et al., PST 2021](https://arxiv.org/abs/2107.12699) — peer_reviewed — "The subprocess module stands out in this regard." — confirmed.
- **Detect:** `ruff check --select S102,S301,S307,S324,S501,S506,S602,S604,S605,S608,S113 .`. For ML model loading (B614/B615), which has no Ruff equivalent, run `bandit -r src/`.
- **Tools:** ruff (S), bandit
- **Applies to:** services, CLIs that handle external input, and ML/data code that loads artifacts.
- **When not to apply / counterpoints:**
  - There is no taint analysis, so every hit is a candidate, not a vulnerability.
  - S105–S107 fire on any variable named "token".
  - Flow-aware SAST tools were not evaluated.
- **Fix risk:** medium

### T21-F20 — Keep modules import-safe; minimise shared mutable state
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Top-level code only defines things. Scripts use `if __name__ == "__main__": main()`. Do no I/O, network calls, thread starts or heavy config parsing at import time.
  - Flag `global` rebinding with PLW0603 (not default). PLW0602 is in the defaults; checked by parsing the page, even though the fetch tool wrongly said otherwise.
  - No `lru_cache`/`cache` on methods (B019, default) unless the cache is bounded and keeping instances alive longer is acceptable. Prefer `cached_property`.
  - Do not rely on the atomicity of built-in types across threads. Use locks or queues.
- **Rationale:**
  - The Google guide: top-level code runs on import, "Avoid mutable global state", and "Do not rely on the atomicity of built-in types".
  - Ruff B019: the cache "will retain a reference to the instance".
  - The free-threading HOWTO: the internal locks of built-in types are "a description of the current implementation, not a guarantee of current or future behavior".
- **Evidence:**
  - [Google Python Style Guide §3.17, §2.5, §2.18](https://google.github.io/styleguide/pyguide.html#317-main) — Google — official_docs — all three quotes confirmed.
  - [global-statement (PLW0603)](https://docs.astral.sh/ruff/rules/global-statement/) — Astral — official_docs — "global mutable state is a common source of bugs and confusing behavior" — confirmed.
  - [cached-instance-method (B019)](https://docs.astral.sh/ruff/rules/cached-instance-method/) — Astral — official_docs — confirmed. The rule ignores methods on Enum classes.
  - [Programming FAQ — How do I cache method calls?](https://docs.python.org/3/faq/programming.html#how-do-i-cache-method-calls) — PSF — official_docs — lru_cache keeps instances "alive until they age out of the cache". `cached_property` "does not create a reference to the instance". It presents `@lru_cache(maxsize=20)` on a method as a legitimate trade-off — confirmed.
  - [Python support for free threading](https://docs.python.org/3/howto/free-threading-python.html) — PSF 3.14 — official_docs — "not a guarantee"; "It's recommended to use the threading.Lock…". Overhead is about 1% on macOS aarch64 and 8% on x86-64 Linux — confirmed.
- **Detect:** `ruff check --select PLW0603,PLW0602,B019 .`. Manually review module top levels for calls, connections, `open()`, `Thread().start()` and `load_dotenv`.
- **Tools:** ruff
- **Applies to:** libraries, services, multi-threaded code, and anything imported by tests.
- **When not to apply / counterpoints:**
  - Module-level loggers, compiled regexes and frozen settings are fine.
  - Framework decorators that register things at import are intentional.
  - The FAQ treats a bounded `lru_cache` on a method as acceptable.
- **Fix risk:** medium

### T21-F22 — Remove environment-dependent implicit defaults (naive datetimes, implicit text encoding)
- **Grade:** A · **Verdict:** VERIFIED (the checker added a detection step, PEP 597's EncodingWarning, and noted that Python 3.15 ships on 2026-10-01, so the PEP 686 UTF-8 default is not in any released CPython yet)
- **Rule:**
  - (a) Replace `datetime.utcnow()` / `utcfromtimestamp()`, deprecated since 3.12, and naive `now()` used for instants with aware values such as `datetime.now(timezone.utc)`. Detect with DTZ001–DTZ012 and DTZ901, all in the 0.16 defaults (checked).
  - (b) Pass `encoding=` explicitly to `open()`, `read_text()` and `write_text()`. The rule is PLW1514 (preview, fix always unsafe).
- **Rationale:**
  - Datetime docs: "naive datetime objects are treated by many datetime methods as local times".
  - PEP 686: "many Python developers using Unix forget that the default encoding is platform dependent". Its Backward Compatibility section says: "this change mostly affects Windows users".
- **Evidence:**
  - [datetime — utcnow()](https://docs.python.org/3/library/datetime.html) — PSF — official_docs — the quote and the "Deprecated since version 3.12" note are confirmed.
  - [PEP 686](https://peps.python.org/pep-0686/) — Inada Naoki, 2022 — standard — Final, Python 3.15. Both quotes confirmed. It recommends finding affected call sites with EncodingWarning (PEP 597).
  - [PEP 790 — Python 3.15 release schedule](https://peps.python.org/pep-0790/) — PSF — standard — "3.15.0 final: Thursday, 2026-10-01". Added by the checker. On the verification date (2026-09-23), no released CPython has UTF-8 mode on by default, so every supported release still uses the locale encoding. Explicit `encoding=` stays necessary for code that must run on 3.14 or older.
  - [unspecified-encoding (PLW1514)](https://docs.astral.sh/ruff/rules/unspecified-encoding/) — Astral — official_docs — "This fix is always unsafe… may cause UnicodeDecodeError on non-UTF-8 systems"; preview — confirmed.
- **Detect:**
  - `ruff check --select DTZ .` and `ruff check --preview --select PLW1514 .`
  - `python -X warn_default_encoding -m pytest` to surface EncodingWarning.
  - Grep for `utcnow()`.
- **Tools:** ruff, CPython `-X warn_default_encoding`
- **Applies to:** timestamp handling (logs, trading, APIs, databases) and cross-platform file I/O.
- **When not to apply / counterpoints:**
  - Naive local times are fine for wall-clock display.
  - Some legacy files really are in the locale encoding; use `encoding="locale"` for those.
  - Changing a timestamp from naive to aware changes how it compares and serialises. That is why fix risk is high.
- **Fix risk:** high

### T21-F19 — Vectorise per-row Python loops in numpy/pandas/polars, pinned by golden-output tests
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Replace `for i in range(len(arr))`, `iterrows`, `apply(axis=1)` and `map_elements` with native vectorised or expression APIs.
  - Keep a UDF only where no native operation exists.
  - Pin behaviour with golden-output tests that check dtypes, NaN handling and float tolerance.
- **Rationale:** Vectorised code runs "at near-C speeds". The pandas docs show a row-wise apply at 111 ms against 887 µs / 677 µs for Cython-typed array code, about 125–164x. That is a compiled baseline, not plain numpy vectorisation. Polars says map_elements is "much slower than the native expressions API". The behaviour changes are documented too: iterrows upcasts int to float64, and numpy integers overflow silently.
- **Evidence:**
  - [What is NumPy?](https://numpy.org/doc/stable/user/whatisnumpy.html) — NumPy — official_docs — "behind the scenes in optimized, pre-compiled C code"; "near-C speeds" — confirmed.
  - [Enhancing performance](https://pandas.pydata.org/docs/user_guide/enhancingperf.html) — pandas 3.0.6 — official_docs — 111 ms / 887 µs / 677 µs; "It's always worth optimising in Python first"; eval "only… more than 10,000 rows"; 2.94 ms vs 4.18 ms — all confirmed.
  - [polars.Expr.map_elements](https://docs.pola.rs/api/python/stable/reference/expressions/api/polars.Expr.map_elements.html) — Polars 1.44.2 — official_docs — "much slower… Only use it if you cannot implement your logic otherwise"; UDFs must be pure — confirmed.
  - [DataFrame.iterrows](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.iterrows.html) — pandas — official_docs — "does not preserve dtypes across the rows"; the int→float64 example — confirmed.
  - [Data types — overflow](https://numpy.org/doc/stable/user/basics.types.html) — NumPy — official_docs — `np.int32(-1486618624)`; `np.power(100, 100, dtype=np.int64)` → 0; "Python integers… will not overflow" — confirmed.
- **Detect:** grep for `.iterrows(`, `.itertuples(`, `apply(.*axis=1`, `map_elements(` and `for .* in range(len(`. Profile first to confirm the path is hot.
- **Tools:** numpy, pandas, polars, numba (optional), cProfile
- **Applies to:** data, quant/backtesting, ETL and scientific code.
- **When not to apply / counterpoints:**
  - On small data the gain is negligible, and `pd.eval` is slower on small frames.
  - Vectorised temporaries use more memory.
  - Path-dependent recursions need numba or a scan.
- **Fix risk:** high

### T21-F21 — Standardise logging (module loggers, NullHandler in libraries, logger.exception)
- **Grade:** A · **Verdict:** CORRECTED (the HOWTO quote about pre-formatting was not verbatim; replaced with the real text)
- **Rule:**
  - Use `logger = logging.getLogger(__name__)`.
  - Libraries add only a NullHandler and never log to the root logger (LOG015, default).
  - In handlers, use `logger.exception` (TRY400, not default) without passing the exception object as well (TRY401, default).
  - Pass arguments to the logger rather than pre-formatting. G004 is optional and contested.
  - No `print()` in library code (T201 as a hint).
- **Rationale:** The Logging HOWTO sets the library conventions. It also states: "Formatting of message arguments is deferred until it cannot be avoided." The researcher's quote "Pass arguments separately… rather than pre-formatting strings" does not appear on the page.
- **Evidence:**
  - [Logging HOWTO](https://docs.python.org/3/howto/logging.html) — PSF, 3.14.7 — official_docs — "It is strongly advised that you do not add any handlers other than NullHandler to your library's loggers."; "It is strongly advised that you do not log to the root logger in your library."; `logger = logging.getLogger(__name__)`; "Formatting of message arguments is deferred until it cannot be avoided." — confirmed.
  - [Ruff default rules](https://docs.astral.sh/ruff/default-rules/) — Astral — official_docs — LOG001, LOG002, LOG009, LOG014, LOG015, G010, G101, G201, G202 and TRY401 are in the defaults; G004 and TRY400 are not. Checked by parsing the page.
- **Detect:** `ruff check --select LOG,G,TRY400,TRY401,T201 .`. Grep library packages for `addHandler(`.
- **Tools:** ruff
- **Applies to:** libraries (strictly) and applications (the module-logger convention).
- **When not to apply / counterpoints:**
  - G004 only matters for high-volume disabled levels.
  - structlog has its own conventions.
  - CLIs legitimately print.
- **Fix risk:** low

### T21-F10 — Pin a type checker in CI and ratchet strictness; don't flip to --strict at once
- **Grade:** A · **Verdict:** CORRECTED (mypy's strictness ladder given in full; practitioner claim softened from "practitioners confirm" to one report)
- **Rule:**
  - First pass: mypy with `check_untyped_defs = true`, or pyright in "standard" mode (the default).
  - Then climb mypy's documented order: warn_unused_configs, warn_redundant_casts, warn_unused_ignores, strict_equality, check_untyped_defs, disallow_subclassing_any, disallow_untyped_decorators, disallow_any_generics, disallow_untyped_calls, disallow_incomplete_defs, disallow_untyped_defs, no_implicit_reexport, warn_return_any, extra_checks.
  - Use per-module overrides, pyright `strict` paths, or a basedpyright baseline, so new code is strict while legacy debt is tracked.
  - Avoid a global `ignore_missing_imports`.
- **Rationale:** Khan et al. (210 projects) found mypy could have prevented 15% of defects, a lower bound. Di Grazia & Pradel (9,655 projects) found a 0.704 correlation between annotations and type errors found, yet 78.3% of commits were made with type errors present. Mypy only checks the bodies of unannotated functions if asked to.
- **Evidence:**
  - [Khan, Chen, Varró, McIntosh — IEEE TSE 2021 (OpenAlex record)](https://api.openalex.org/works/doi:10.1109/tse.2021.3082068) — peer_reviewed — "15 percent of the defects could have been prevented by mypy… redefinition of Python references, dynamic attribute initialization and incorrectly handled Null objects… lower bound" — confirmed in the abstract.
  - [Di Grazia & Pradel — ESEC/FSE 2022 (OpenAlex record)](https://api.openalex.org/works/doi:10.1145/3540250.3549114) — peer_reviewed — "1,414,936 type annotation changes… 9,655 projects… (0.704 correlation)… many commits (78.3%) are committed despite having such errors" — confirmed. The authors call for "better integration of gradual type checking into the development process".
  - [Using mypy with an existing codebase](https://mypy.readthedocs.io/en/stable/existing_code.html) — mypy 2.3.1 — official_docs — "5,000 to 50,000 lines"; "Make sure everyone runs mypy with the same version"; ignore_missing_imports "can hide errors later on" — confirmed. Full ordered list as given above.
  - [mypy command line](https://mypy.readthedocs.io/en/stable/command_line.html) — mypy 2.3.1 — official_docs — "(By default the bodies of functions without annotations are not type checked.)"; `--warn-unreachable` is not in `--strict`; the strict flag list "may change over time" — confirmed.
  - [Pyright configuration](https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md) — Microsoft — official_docs — typeCheckingMode off/basic/standard/strict, default "standard"; `strict` path array — confirmed.
  - [basedpyright baseline](https://docs.basedpyright.com/latest/benefits-over-pyright/baseline/) — basedpyright — official_docs — "only report errors on new or modified code"; `basedpyright --writebaseline` — confirmed.
  - [HN ubercore](https://news.ycombinator.com/item?id=42777558) (2025) — "it has missed some things that pyright caught, which were legitimate bugs". [HN KaiserPro](https://news.ycombinator.com/item?id=42254374) (2024) — gradual pyre enforcement leaves "a million errors" in old code — both confirmed.
- **Detect:**
  - `mypy --check-untyped-defs src/` and count the errors.
  - `pyright`, or `basedpyright --writebaseline`.
  - Check the config for a global `ignore_missing_imports = true`.
  - Check that CI pins the checker version.
- **Tools:** mypy 2.x, pyright/basedpyright; ty (reported as immature by one practitioner, HN 49060908)
- **Applies to:** applications and libraries larger than scripts.
- **When not to apply / counterpoints:**
  - "Most of the 'bugs' I find with the type checker are type annotation bugs" ([HN toxik 42260337](https://news.ycombinator.com/item?id=42260337)).
  - Untyped third-party libraries produce false positives that people learn to ignore ([HN agubelu 42254198](https://news.ycombinator.com/item?id=42254198)).
  - mypy and pyright disagree on edge cases.
- **Fix risk:** low

### T21-F11 — Annotate the public API first and keep annotations honest
- **Grade:** A (type-choice rules) / B (prioritising public APIs, which rests on one preprint) · **Verdict:** VERIFIED
- **Rule:**
  - Parameters take abstract types (Iterable, Sequence, Mapping, Protocol); returns use concrete types.
  - Use `object` rather than `Any` for accept-anything values.
  - Avoid union return types.
  - Write `X | None` with None last (RUF036, stable since 0.16.0 but **not** in the defaults).
  - Every `# type: ignore` names a code (PGH003) and is checked for staleness (warn_unused_ignores).
  - Treat ANN401 as a review signal.
- **Rationale:** The typing best-practices guide recommends exactly these. A 2026 study of 1,000 repositories finds library hints act mainly as API contracts. That describes what maintainers do; it does not show defect impact.
- **Evidence:**
  - [Typing best practices](https://typing.python.org/en/latest/reference/best_practices.html) — typing.python.org — official_docs — "use Any when a type cannot be expressed appropriately…"; "use object instead of Any"; "For arguments, prefer protocols and abstract types (Mapping, Sequence, Iterable, etc.)"; "For return values, prefer concrete types"; "Avoid union return types, since they require isinstance() checks. Use Any or X | Any if necessary."; "None should be the last element of an union." — confirmed.
  - [Magalhães, Petrillo, Montandon — Type Hints in Python Libraries and Frameworks](https://arxiv.org/abs/2609.02782) — 2026-09-02 — preprint — 91%; 45.8% / 35.9% median coverage; "primarily serve as API contracts" — confirmed.
  - [blanket-type-ignore (PGH003)](https://docs.astral.sh/ruff/rules/blanket-type-ignore/) — Astral — official_docs — confirmed. It notes the mypy equivalent `enable_error_code = ["ignore-without-code"]`.
- **Detect:** `ruff check --select PGH003,ANN401,RUF036 .`; `mypy --warn-unused-ignores`.
- **Tools:** ruff, mypy
- **Applies to:** public functions of libraries and services.
- **When not to apply / counterpoints:** union returns are sometimes unavoidable in parsers and legacy APIs. Full annotation of private helpers adds little.
- **Fix risk:** low

### T21-F01 — Pin the linter and make the rule set explicit before changing code
- **Grade:** A · **Verdict:** CORRECTED ("correctness baseline" was an overstatement: the 413 defaults mix correctness, modernisation and style rules)
- **Rule:**
  - Pin ruff (0.16.x) in a dev dependency group.
  - Declare `[tool.ruff.lint] select = [...]` explicitly and never use a bare `ALL`.
  - Treat the 0.16 default set as a vendor-curated starting set, not a pure correctness set. It includes I001 import sorting, many UP pyupgrade rewrites, and FA/UP annotation rules.
  - Explicitly add: B904, RUF006, S113, S301, S307, S506, S602, S608, PGH003, PGH004, PLW0603. S102 is already in the defaults.
  - Run C901/PLR0911/PLR0912/PLR0913/PLR0915 and ERA001 as report-only.
  - Every suppression names a code: `# noqa: B006` or the new `# ruff: ignore[B006]`. RUF100 (default) flags stale ones and removes them with `--fix`.
  - Require pydocstyle D1xx only on the public API. D1xx is not in the defaults.
- **Rationale:**
  - 0.16.0 moved the defaults from 59 to 413 rules and dropped 18 E/F rules. Without a pin, a routine upgrade floods an unchanged codebase with new findings.
  - Ruff docs: "Prefer lint.select over lint.extend-select to make your rule set explicit" and "Use ALL with discretion. Enabling ALL will implicitly enable new rules whenever you upgrade."
  - Astral's only published reason for the choice is that "many of these rules catch severe issues". There are no per-rule criteria.
- **Evidence:**
  - [Ruff CHANGELOG](https://raw.githubusercontent.com/astral-sh/ruff/main/CHANGELOG.md) — Astral, 2026 — official_docs — 0.16.0 dated 2026-07-23, 0.16.8 dated 2026-09-16; "Ruff now enables a much larger set of rules by default (413, up from 59)"; the 18 removed codes; the `ruff: ignore` syntax; RUF036 stabilised — all confirmed.
  - [Default Rules](https://docs.astral.sh/ruff/default-rules/) — Astral — official_docs — the checker parsed the HTML and found 413 unique codes. Confirmed present: E722, BLE001, S110, S112, B006, B008, B012, B019, B023, RUF009, RUF012, RUF100, S102, PLW0602, ASYNC210/220/221/222/230/251, DTZ001–012, LOG015, TRY002, TRY401, F401/F811/F841, PERF101/102/402, FA100/FA102, UP006/UP007/UP045, I001. Confirmed absent: RUF006, RUF036, B904, S113, S301, S307, S506, S602, S608, C901, PLR0911–0915, ERA001, PLW0603, TRY003, TRY400, G004, PGH003, PGH004, S101, T201, TC001–003, D1xx.
  - [The Ruff Linter](https://docs.astral.sh/ruff/linter/) — Astral — official_docs — both quotes confirmed verbatim.
  - [Ruff v0.16.0 blog post](https://astral.sh/blog/ruff-v0.16.0) — Brent Westbrook (Astral), 2026-07-23 — official_docs — rules grew from 708 to 968 since v0.1.0; old behaviour restored with `select = ["E4", "E7", "E9", "F"]`; "many of these rules catch severe issues" — confirmed.
  - [HN apelapan](https://news.ycombinator.com/item?id=49057504) — 2026 — practitioner_forum — "more like 10% autofixable… 100+ unfixable errors across less than 10k lines… Previous ruff version labeled it perfectly clean" — confirmed.
  - [HN maratc](https://news.ycombinator.com/item?id=49081177) — 2026 — practitioner_forum — "I've got only 2900 errors -- which weren't errors at all just yesterday." — confirmed.
  - [PEP 257](https://peps.python.org/pep-0257/) — PSF, 2001 — standard — the docstring coverage sentence is confirmed verbatim.
- **Detect:**
  - Look at the ruff pin in pyproject/uv.lock.
  - Look for `ALL`, `extend-select`, or no `select` at all.
  - `ruff check --statistics .` sizes the backlog.
  - `ruff check --select PGH004,RUF100 .` finds blanket and stale suppressions.
  - Grep for `type: ignore$`.
  - `ruff check --add-noqa` snapshots legacy violations.
- **Tools:** ruff 0.16.x, uv
- **Applies to:** every Python project, most of all finished or legacy code.
- **When not to apply / counterpoints:**
  - anticodon ([HN 49058556](https://news.ycombinator.com/item?id=49058556)): 0 bugs in 20 years from unsorted imports or `except Exception`.
  - alentred ([HN 49056554](https://news.ycombinator.com/item?id=49056554)): pylint with most rules on led to "hacks to make pylint happy at the cost of illegible code".
  - Astral published no false-positive rates.
  - A legacy repo may keep E4/E7/E9/F and ratchet up from there.
- **Fix risk:** low

### T21-F02 — Apply autofixes as a controlled, test-gated process
- **Grade:** A · **Verdict:** CORRECTED (RUF055 is a preview rule; the stable-rule examples are now given first)
- **Rule:**
  - Run safe fixes only, one rule family per commit, with the full test suite between batches.
  - Preview each batch with `--diff`.
  - Never use `--unsafe-fixes` or broad `extend-safe-fixes` without reading every hunk.
  - Treat even "safe" fixes as behaviour-risking.
  - Never delete or skip a test to silence a diagnostic.
- **Rationale:** Ruff defines unsafe fixes as ones that may alter runtime behaviour. Its example is RUF015 turning `list(...)[0]` into `next(iter(...))`, which changes IndexError to StopIteration. Fix-safety labels are sometimes wrong, including on stable default rules:
  - F541 when a string becomes a docstring (#18807, still open)
  - F504 with side-effecting arguments (#18806)
  - C408 (#16234)
  - RUF015 (#6148)

  RUF055 (#27024, July 2026) is **preview-only** (since 0.8.1), so it only matters to users who run `--preview`. Practitioners report that 10–30% of a new rule set's findings can be autofixed.
- **Evidence:**
  - [The Ruff Linter — Fix safety](https://docs.astral.sh/ruff/linter/) — Astral — official_docs — confirmed.
  - [Ruff issue #27024](https://github.com/astral-sh/ruff/issues/27024) — GitHub, 2026-07-20, open — other — "The RUF055 fix is classified as safe, but it changes behavior… The original assertion passes. The replacement fails" — confirmed. Checker's note: RUF055 is in preview.
  - [Ruff issue search: label:fixes label:bug](https://github.com/astral-sh/ruff/issues?q=is%3Aissue+label%3Afixes+label%3Abug) — GitHub — other — reproduced on 2026-09-23: 276 (fixes+bug), 105 ("should be unsafe", all issues, open and closed), 36 (fixes + "changes behavior"). The titles of #18807, #18806, #18209, #16234 and #6148 are confirmed. #18807 is still open; the others are closed.
  - [HN vasachi](https://news.ycombinator.com/item?id=49057474) — 2026 — replying to biorach's "ruff check --fix Generally gets you 90% there" ([49057319](https://news.ycombinator.com/item?id=49057319)): "In reality it got me 30% there." — confirmed.
  - [HN mikeydiamonds](https://news.ycombinator.com/item?id=49057551) — 2026 — "I watched one agent 'fix' an unfamiliar rule by deleting the test; perfect compliance, tiny misunderstanding." — confirmed.
- **Detect:**
  - `ruff check --diff .` to preview, then `ruff check --select <PREFIX> --fix .` per family.
  - `ruff check --unsafe-fixes --diff --select <CODE>` for review only.
  - After each batch, run `git diff --stat` and pytest. Reject batches that touch tests/ or add suppressions.
- **Tools:** ruff, git, pytest
- **Applies to:** any automated lint remediation, especially by an agent.
- **When not to apply / counterpoints:** for a large, well-tested codebase, batching all safe fixes is efficient. biorach reports ~90% fixable; vasachi and apelapan report 10–30%.
- **Fix risk:** medium

### T21-F09 — Remove blocking work from coroutines and bound concurrency
- **Grade:** A · **Verdict:** CORRECTED (ASYNC211 and ASYNC232 exist only in flake8-async, not in Ruff; flake8-async's own description of ASYNC9xx restored)
- **Rule:**
  - No sync HTTP (ASYNC210), subprocess or wait (ASYNC220–222), `open()` (ASYNC230) or `time.sleep` (ASYNC251) inside `async def`. All are in the 0.16 defaults (checked).
  - In Ruff, also review ASYNC212/240/250, which are stable but not default. ASYNC211/232 exist only in flake8-async.
  - Use async libraries, `asyncio.to_thread` / `run_in_executor` for blocking I/O, and a process pool for CPU-bound work.
  - Bound fan-out with a Semaphore or `asyncio.Queue(maxsize=N)`.
- **Rationale:** The asyncio docs: "Blocking (CPU-bound) code should not be called directly." `to_thread` is "primarily intended… for IO-bound functions… that would otherwise block the event loop". Debug mode logs callbacks slower than 100 ms. Practitioners report investigations that took days.
- **Evidence:**
  - [Developing with asyncio](https://docs.python.org/3/library/asyncio-dev.html) — PSF — official_docs — both quotes confirmed.
  - [asyncio.to_thread](https://docs.python.org/3/library/asyncio-task.html) — PSF — official_docs — confirmed verbatim.
  - [blocking-http-call-in-async-function (ASYNC210)](https://docs.astral.sh/ruff/rules/blocking-http-call-in-async-function/) — Astral — official_docs — "will block the entire event loop" — confirmed.
  - [flake8-async rules](https://flake8-async.readthedocs.io/en/latest/rules.html) — python-trio — official_docs — ASYNC230/251/211/232 are confirmed. The 9xx rules "are disabled by default due to the higher volume of warnings" (corrected from "opinionated").
  - [HN zzzeek](https://news.ycombinator.com/item?id=16579496) — SQLAlchemy author, 2018 — "Three days of acquiring and poring over HAProxy debug logs…" — confirmed.
  - [HN CraigJPerry](https://news.ycombinator.com/item?id=49056394) — 2026, in a Django thread — `asyncio.Queue() # oops`, unbounded gather, `requests.get` blocking the loop, garbage-collected tasks — confirmed.
- **Detect:**
  - `ruff check --select ASYNC .`
  - Grep for `asyncio.Queue()` with no maxsize, and for `gather(*(` over unbounded iterables.
  - Run with PYTHONASYNCIODEBUG=1 and look for "Executing … took" warnings.
- **Tools:** ruff (ASYNC), flake8-async, asyncio debug mode
- **Applies to:** all asyncio/anyio/trio code.
- **When not to apply / counterpoints:**
  - Tiny blocking calls are usually negligible.
  - `to_thread` brings thread-safety concerns and the default pool's worker cap.
  - zer01 ([HN 28881294](https://news.ycombinator.com/item?id=28881294)) prefers plain threads.
- **Fix risk:** medium

### T21-F15 — Normalise packaging metadata (pyproject, floors not caps, locks for apps, dependency groups, src layout)
- **Grade:** A · **Verdict:** CORRECTED (the "floor, don't cap" quote is Brett Cannon's, quoted by Schreiner)
- **Rule:**
  - One pyproject.toml with `[build-system]` and PEP 621 `[project]`.
  - `requires-python` with a lower bound only.
  - Libraries set floors and exclude only known-bad releases.
  - Applications commit a full transitive lock.
  - Dev tools go in `[dependency-groups]` (PEP 735).
  - License as an SPDX expression (PEP 639).
  - Use the src/ layout for importable packages.
- **Rationale:**
  - The PyPA guide calls `[build-system]` "strongly recommended" and warns "Think twice before applying an upper bound like requires-python".
  - Schreiner quotes Brett Cannon's floor-not-cap advice and adds "applications only have one choice: They should supply a lock file".
  - Hynek: without src/, "your tests do not run against the package as it will be installed by its users".
- **Evidence:**
  - [Writing your pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/) — PyPA — official_docs — both quotes plus PEP 639 SPDX confirmed.
  - [Should You Use Upper Bound Version Constraints?](https://iscinumpy.dev/post/bound-version-constraints/) — Henry Schreiner, 2021-12-09 (page updated 2026) — engineering_blog — "Libraries/packages should be setting a floor…" is Schreiner **quoting Brett Cannon** (Python Steering Council). "applications only have one choice…" and "Never provide an upper cap to your Python version" are Schreiner's own — confirmed.
  - [Semantic Versioning Will Not Save You](https://hynek.me/articles/semver-will-not-save-you/) — Hynek Schlawack, 2021 — engineering_blog — "Pin your dependencies and their transitive dependencies to their exact versions"; "relying on updates not breaking… means relying on software being bug-free" — confirmed.
  - [Testing & Packaging](https://hynek.me/articles/testing-packaging/) — Hynek Schlawack, 2015, updated 2021-01-04 — engineering_blog — confirmed verbatim.
  - [PEP 735](https://peps.python.org/pep-0735/) — Stephen Rosen, Final, resolved 2024-10-10 — standard — "not included in any built distribution of the project" — confirmed.
- **Detect:**
  - setup.py / setup.cfg / requirements*.txt used as the source of truth.
  - Missing `[build-system]`.
  - `<` in requires-python, or caps in library dependencies.
  - No lock file committed for an application.
  - A flat layout.
- **Tools:** uv, deptry; validate-pyproject (not verified)
- **Applies to:** distributable packages and deployable applications.
- **When not to apply / counterpoints:**
  - Moving to src/ changes import paths and tooling config.
  - A flat layout is fine for scripts.
  - Some ecosystems argue for defensive caps in lockless applications.
- **Fix risk:** medium

### T21-F23 — Adopt one formatter in a single isolated commit, ignored in blame
- **Grade:** A · **Verdict:** CORRECTED (D203 added to the conflicting-rule list)
- **Rule:**
  - Adopt `ruff format` or Black in one dedicated commit with no semantic changes.
  - Record that commit in `.git-blame-ignore-revs` and set `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
  - With ruff format, avoid these conflicting lint rules: W191, E111, E114, E117, D203, D206, D300, Q000–Q004, COM812, COM819, and ISC002 when used without ISC001 and `allow-multiline = false`.
  - Since 0.16 the formatter also formats Python blocks in Markdown by default.
- **Rationale:**
  - Black recommends reformatting "in one massive commit". GitHub and GitLab 17.10+ honour the ignore-revs file.
  - Ruff formats "> 99.9% of lines" the same as Black on Django and Zulip.
- **Evidence:**
  - [Introducing Black to your project](https://black.readthedocs.io/en/stable/guides/introducing_black_to_your_project.html) — Black 26.5.1 — official_docs — confirmed, including the GitLab 17.10 note.
  - [The Ruff Formatter](https://docs.astral.sh/ruff/formatter/) — Astral — official_docs — 99.9% figure and conflicting-rule list confirmed. The list includes D203, which the researcher omitted.
  - [Ruff CHANGELOG 0.16.0](https://raw.githubusercontent.com/astral-sh/ruff/main/CHANGELOG.md) — Astral — official_docs — "format Python code blocks in Markdown files and will do this by default" — confirmed.
- **Detect:** `ruff format --check .`. Check that `.git-blame-ignore-revs` exists and that no conflicting rules are enabled.
- **Tools:** ruff format / black, git
- **Applies to:** all repositories. Do this first, before any semantic hardening.
- **When not to apply / counterpoints:**
  - Formatters destroy intentional alignment ([HN maratc 49056752](https://news.ycombinator.com/item?id=49056752)).
  - Drive-by reformatting is noisy ([HN toxik 49061267](https://news.ycombinator.com/item?id=49061267)).
- **Fix risk:** low

### T21-F06 — Chain translated exceptions (B904); raise rather than return None at API boundaries; don't enforce TRY003
- **Grade:** B · **Verdict:** CORRECTED (Ruff's B904 wording is milder than the researcher's; PEP 8 and Effective Python item 88 added as stronger sources for chaining)
- **Rule:**
  - When translating an exception inside `except`, write `raise NewError(...) from err` (B904, not default), or `from None` when hiding the cause is deliberate.
  - At API boundaries, prefer raising to returning None, and give a package a root exception class.
  - Do not enforce TRY003.
  - Useful triage: TRY002 (default), TRY400 (not default), TRY401 (default).
- **Rationale:**
  - PEP 8: "Use exception chaining appropriately. raise X from Y should be used to indicate explicit replacement without losing the original traceback."
  - Ruff B904 says that without `from`, `__cause__` is not set, "which may make debugging slightly more difficult". The researcher had called this "obscuring the root cause".
  - TRY003 has an open dispute (#14398, labelled needs-decision).
- **Evidence:**
  - [PEP 8](https://peps.python.org/pep-0008/) — PSF — standard — chaining quote confirmed. Added by the checker.
  - [raise-without-from-inside-except (B904)](https://docs.astral.sh/ruff/rules/raise-without-from-inside-except/) — Astral — official_docs — confirmed, with the milder wording.
  - [Effective Python 3rd ed.](https://effectivepython.com/) — Brett Slatkin, 2024 — book — items 32 "Prefer Raising Exceptions to Returning None", 88 "Consider Explicitly Chaining Exceptions to Clarify Tracebacks", 121 "Define a Root Exception to Insulate Callers from APIs" and 86. Item numbers were checked against the official TOC; titles only.
  - [Ruff issue #14398](https://github.com/astral-sh/ruff/issues/14398) — 2024, open — practitioner_forum — "defining a separate exception for every case is redundant and would bloat the code" — confirmed.
- **Detect:** `ruff check --select B904,TRY002,TRY400,TRY401 .`. Grep for `return None` inside except blocks.
- **Tools:** ruff
- **Applies to:** library and service code that wraps lower-level errors.
- **When not to apply / counterpoints:**
  - Adding `from` changes traceback text, which can break snapshot tests.
  - Replacing a None return with a raise is an API change.
  - Some teams want TRY003 for i18n.
- **Fix risk:** low

### T21-F12 — Check for runtime annotation consumers before applying TC/FA/UP annotation fixes
- **Grade:** B · **Verdict:** VERIFIED (checker adds: FA100/FA102/UP006/UP007/UP045 are **in the 0.16 defaults**, but their fixes are marked unsafe in the risky cases; TC001–003 are not defaults)
- **Rule:**
  - Before applying TC001–003, FA100/FA102 or UP006/UP007/UP045 fixes, look for runtime annotation consumers: pydantic, SQLAlchemy 2 `Mapped[]`, FastAPI/typer, attrs/cattrs, `get_type_hints`, and DI frameworks.
  - If any exist, configure `runtime-evaluated-base-classes` / `runtime-evaluated-decorators`, or leave those modules alone. On targets below 3.10, also set `lint.pyupgrade.keep-runtime-typing = true`.
  - Set `project.requires-python` correctly, because Ruff derives target-version from it.
- **Rationale:** Ruff TC002 says: "This rule's fixes are unsafe because changing when a module is imported can affect runtime behavior, including import-time side effects". It names Pydantic and SQLAlchemy. More fix-safety notes:
  - FA100/FA102 fixes are unsafe: "adding from __future__ import annotations may change the semantics of the program".
  - UP007's fix is unsafe before 3.10 because of Pydantic.
  - UP006's fix is unsafe before 3.9.

  The tracker shows configuration gaps.
- **Evidence:**
  - [typing-only-third-party-import (TC002)](https://docs.astral.sh/ruff/rules/typing-only-third-party-import/) — Astral — official_docs — both quotes confirmed. On 3.15+ the fix prefers `lazy` imports.
  - [FA100](https://docs.astral.sh/ruff/rules/future-rewritable-type-annotation/), [UP007](https://docs.astral.sh/ruff/rules/non-pep604-annotation-union/), [UP006](https://docs.astral.sh/ruff/rules/non-pep585-annotation/) — Astral — official_docs — fix-safety texts confirmed. Added by the checker.
  - [Ruff issue #7866](https://github.com/astral-sh/ruff/issues/7866) — 2023, open — "TCH001 seems to incorrectly trigger… only when from __future__ import annotations is present" — confirmed.
  - [Ruff issue #14140](https://github.com/astral-sh/ruff/issues/14140) — 2024, open — "require that the context… be available during runtime" — confirmed. [#6510](https://github.com/astral-sh/ruff/issues/6510) "SQLAlchemy issues with TCH003" is closed.
  - [Ruff settings — target-version](https://docs.astral.sh/ruff/settings/) — Astral — official_docs — confirmed verbatim. The same page documents a mitigation: `lint.pyupgrade.keep-runtime-typing` "avoid[s] PEP 585… and PEP 604… rewrites even if a file imports from __future__ import annotations". It applies only when the target is below 3.9 or 3.10, and is "most commonly used when working with libraries like Pydantic and FastAPI". Added by the checker.
- **Detect:**
  - Grep for `BaseModel|Mapped\[|DeclarativeBase|@inject|get_type_hints|typer|cattrs|@validate_call`.
  - `ruff check --select TC,FA,UP --diff`.
  - After applying, import every module and run the tests.
- **Tools:** ruff, pytest
- **Applies to:** pydantic/FastAPI/SQLAlchemy/attrs/typer/DI projects, and libraries that support old Python versions.
- **When not to apply / counterpoints:** pure libraries and CLIs benefit from TC moves. PEP 649/749 (Final, 3.14) change annotation evaluation; their effect on these fixes was not verified.
- **Fix risk:** high

### T21-F13 — Remove dead code in confidence order, checking for dynamic references first
- **Grade:** B · **Verdict:** CORRECTED (Ruff F841's docs give only comment deletion as the unsafe-fix reason; the "drops side-effecting calls" claim was not on the page and is removed)
- **Rule:** Remove dead code in this order:
  1. F401 / F841 / F811 (default).
  2. vulture at `--min-confidence 100`, then 90, then 60 with `--sort-by-size`.
  3. ERA001, reviewed one by one.

  Before deleting anything, search for dynamic references: getattr/importlib strings, entry points, `__all__`, registries, framework conventions and public APIs. Keep a vulture whitelist.
- **Rationale:**
  - Ruff F401: unused imports "add a performance overhead at runtime, and risk creating import cycles". Removing third-party/stdlib imports in `__init__.py` is unsafe "because the module's interface changes".
  - F841's fix is unsafe "because removing an unused variable assignment may delete comments".
  - Vulture: "static code analyzers like Vulture are likely to miss some dead code. Also, code that is only called implicitly may be reported as unused."
  - ERA001 is "Prone to false positives".
- **Evidence:**
  - [unused-import (F401)](https://docs.astral.sh/ruff/rules/unused-import/) — Astral — official_docs — confirmed.
  - [unused-variable (F841)](https://docs.astral.sh/ruff/rules/unused-variable/) — Astral — official_docs — confirmed. Only the comment-deletion reason appears; the side-effect claim is removed.
  - [Vulture README](https://github.com/jendrikseipp/vulture) — Jendrik Seipp — official_docs — confidence levels (100% for arguments and unreachable code, 90% for imports, 60% for the rest), both warnings, `--make-whitelist` and `--sort-by-size` — confirmed.
  - [commented-out-code (ERA001)](https://docs.astral.sh/ruff/rules/commented-out-code/) — Astral — official_docs — confirmed.
- **Detect:**
  - `ruff check --select F401,F811,F841 .`
  - `vulture src/ --min-confidence 100`, then `--min-confidence 60 --sort-by-size`
  - `ruff check --select ERA001 .`
  - For each candidate: `grep -rn '<name>'` across code, strings and config.
- **Tools:** ruff, vulture
- **Applies to:** applications first; in libraries, only private symbols.
- **When not to apply / counterpoints:**
  - A library's public API looks unused inside its own repo.
  - Side-effect imports look unused.
  - Code with no test coverage may be a rarely used production path.
- **Fix risk:** medium

### T21-F14 — Audit dependencies (deptry, pip-audit, lock freshness in CI)
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Run deptry: DEP001 missing, DEP002 unused, DEP003 transitive, DEP004 dev dependency used in production code, DEP005 stdlib listed as a dependency.
  - Run `pip-audit --locked .` or `-r requirements.txt`.
  - In CI, use `uv lock --check` / `uv sync --locked`, never `--frozen`. `pylock.toml` (PEP 751) is the tool-neutral lock format.
  - Only use `pip-audit --fix` after a `--dry-run` review and a test run.
- **Rationale:**
  - deptry maps dependency hygiene to stable rule ids.
  - pip-audit uses the PyPA advisory database and OSV. It says you "must not assume that pip-audit will defend you against malicious packages" and that it is "not a static code analyzer".
  - uv: `--locked` errors on a stale lock; `--frozen` skips the check.
- **Evidence:**
  - [deptry — Rules and violations](https://deptry.com/rules-violations/) — deptry — official_docs — DEP001–DEP005 confirmed.
  - [pip-audit README](https://github.com/pypa/pip-audit) — PyPA / Trail of Bits — official_docs — all quotes and flags confirmed. The pre-commit example uses rev v2.10.1.
  - [uv — Locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/) — Astral — official_docs — confirmed. The [uv CLI reference](https://docs.astral.sh/uv/reference/cli/) confirms that `uv lock --check` is "Equivalent to --locked".
  - [PEP 751](https://peps.python.org/pep-0751/) — Brett Cannon, Final, resolved 2025-03-31 — standard — confirmed.
- **Detect:** `deptry .`; `pip-audit --locked .`; `uv lock --check`. Check CI for `--locked` rather than `--frozen`.
- **Tools:** deptry, pip-audit, uv
- **Applies to:** any project that ships or deploys.
- **When not to apply / counterpoints:**
  - deptry reports false positives when import names differ from package names, and for optional or plugin imports.
  - pip-audit only knows about published advisories.
  - Automatic upgrades can change behaviour.
- **Fix risk:** medium

### T21-F18 — Optimise only profiled hot spots; fix complexity-class issues, not idioms
- **Grade:** B · **Verdict:** CORRECTED (the dissenting 2022 study is peer-reviewed ICPC 2022, not a preprint; URL replaced with its arXiv page)
- **Rule:**
  - Profile first, and verify every change with a benchmark.
  - Do not justify idiom rewrites by speed.
  - Fix complexity-class hot spots: list membership in loops (use a set or dict), `pop(0)`/`insert(0, x)` (use deque), string concatenation in loops (use `''.join`).
  - PERF101/102/402 are defaults. PERF401 and PLR6201 (preview) are hints.
  - PERF203 is enforced only before Python 3.11.
- **Rationale:** Zhang et al. (ICSE 2023) measured 24,126 synthetic and 54,879 real-project idiom pairs. In real code, "only truth-value-test may significantly speed up the performance, but chances are it may slow down…". For the other idioms "the differences… are generally small", and "It may not be worth sacrificing the readability for some trivial performance speedup or even the risk of slowdown." CPython's TimeComplexity page documents the complexity-class differences.
- **Evidence:**
  - [Zhang, Xing, Xia, Xu, Zhu, Lu — ICSE 2023](https://arxiv.org/abs/2301.12633) — peer_reviewed — quotes confirmed in the PDF.
  - [TimeComplexity](https://wiki.python.org/moin/TimeComplexity) — Python Wiki — list `x in s` O(n); pop intermediate and insert O(n); deque popleft/appendleft O(1) — confirmed.
  - [try-except-in-loop (PERF203)](https://docs.astral.sh/ruff/rules/try-except-in-loop/) — Astral — official_docs — "only enforced for Python versions prior to 3.11". It also notes tight-loop refactors can still help on 3.11+ when exceptions are raised — confirmed.
  - [Effective Python 3rd ed.](https://effectivepython.com/) — Slatkin, 2024 — book — item 92 "Profile Before Optimizing" (TOC-verified).
  - [Leelaprute et al., "Does Coding in Pythonic Zen Peak Performance?"](https://arxiv.org/abs/2203.14484) — ICPC 2022 — peer_reviewed (preliminary study) — "can save up to 7,000 MB and up to 32.25 seconds", on synthetic code at scale. Corrected: the researcher linked an arXiv API query and labelled the paper a preprint.
- **Detect:**
  - `python -m cProfile -o prof.out <entry>`.
  - Grep hot functions for `in <list>`, `.pop(0)`, `.insert(0,` and `+=` on str.
  - `ruff check --select PERF .`
- **Tools:** cProfile, ruff (PERF, PLR6201), pytest-benchmark/timeit
- **Applies to:** CPU-bound hot paths only.
- **When not to apply / counterpoints:**
  - Converting a list to a set loses order and duplicates, and needs hashable elements.
  - Truthiness rewrites change semantics for 0, "" and numpy arrays.
- **Fix risk:** medium

### T21-F24 — Enforce before/after quality gates when an AI agent does the hardening
- **Grade:** B · **Verdict:** CORRECTED (authors added for 2605.21453 and 2605.30478; the RL study is flagged as indirect evidence)
- **Rule:**
  - Snapshot these before and after each batch: ruff `--statistics`, type-checker error count, S/bandit count, deptry output, test count and pass status, and branch coverage.
  - Reject any batch that raises a count, removes or skips tests, adds blanket `noqa`/`type: ignore`, widens an except, or edits tests to match new behaviour.
  - Refactor only code the tests exercise. Otherwise write characterisation tests first.
- **Rationale:**
  - Cynthia et al.: in 1,210 merged agent bug-fix PRs, "code smells dominate" and "merge success does not reliably reflect post-merge code quality".
  - Almukhtar et al.: 24.17% of modified files gained new Pylint issues and 4.7% new Bandit findings, yet 73.5% of PRs were merged. The authors "motivate stronger tool-in-the-loop quality and security gating".
  - Midolo et al.: GPT-4o refactorings preserve behaviour but reduce readability.
  - Skopin & Kotelnikov: rewarding only on lint penalties biased small models toward shorter code without better correctness. This is indirect evidence (RL training on MBPP, not hardening).
- **Evidence:**
  - [Cynthia, Muttakin, Roy — Beyond Bug Fixes](https://arxiv.org/abs/2601.20109) — 2026 — preprint — confirmed. The abstract also says raw issue-count differences "largely disappear after normalizing by code churn".
  - [Almukhtar, Ghammam, Ming — Quality and Security Signals in AI-Generated Python Refactoring PRs](https://arxiv.org/abs/2605.21453) — 2026 — preprint — confirmed.
  - [Midolo, Tramontana, Di Penta — From Human to Machine Refactoring](https://arxiv.org/abs/2601.13139) — 2026 — preprint — 100 ClassEval classes; confirmed.
  - [Skopin, Kotelnikov — Improving Small Language Models… RL from Verification Feedback](https://arxiv.org/abs/2605.30478) — 2026, accepted at AINL-2026 — preprint — confirmed. Indirect.
  - [HN alentred](https://news.ycombinator.com/item?id=49056554) — "coding agents… disabling the tests !!!" — and [HN storus](https://news.ycombinator.com/item?id=49058601) — "agent fixes complaints at the cost of code bloat" — both 2026, confirmed.
  - [coverage.py — Branch coverage](https://coverage.readthedocs.io/en/latest/branch.html) — Ned Batchelder — official_docs — confirmed.
- **Detect:**
  - Snapshot the counts before and after.
  - `pytest --collect-only -q | tail -1` for the test count.
  - `coverage run --branch -m pytest && coverage report`.
  - `git diff --name-only | grep -E '(^|/)tests?/'`.
  - Grep the diff for `# noqa$`, `type: ignore$`, `pytest.mark.skip` and `except Exception`.
- **Tools:** ruff, mypy/pyright, coverage.py, pytest, git
- **Applies to:** any hardening pass run by an LLM agent.
- **When not to apply / counterpoints:**
  - The evidence is mostly single, unreviewed 2026 preprints.
  - Agent issue counts mostly scale with churn.
  - Strict gates block legitimate test updates when behaviour is changed on purpose; those need human sign-off.
- **Fix risk:** low

### T21-F17 — Use complexity rules as a ranked refactoring worklist, not a hard gate
- **Grade:** C (was B) · **Verdict:** DOWNGRADED (the Vavrová & Zaytsev claim was overstated, and no source links these thresholds to Python defects)
- **Rule:**
  - Report these, ranked, without failing the build:
    - C901 > 10
    - PLR0912 > 12 branches
    - PLR0915 > 50 statements
    - PLR0911 > 6 returns
    - PLR0913 / PLR0917 > 5 arguments / positional arguments
    - PLR1702 (preview) > 5 nested blocks
  - None of these is in the 0.16 defaults. PLR0917 has been stable since 0.16.0.
  - Refactor the worst offenders with dispatch dicts (Ruff's C901 example), guard clauses and extracted pure helpers.
  - Keep comprehensions to one `for` plus a filter.
  - Calibrate thresholds to the project's own distribution.
- **Rationale:** The threshold values and Google's "Optimize for readability, not conciseness" are confirmed. The researcher said Vavrová & Zaytsev show "Java-derived thresholds mis-fire". What the paper actually found is that smell *prevalence* in Python differs sharply from Java (long methods more common, long parameter lists rarer), using thresholds relative to each project. That indirectly supports calibrating to the project, but it does not validate any threshold. No cited source links C901/PLR09xx values to Python defect rates. The "worklist, not gate" advice therefore rests on tool docs, practitioner anecdotes and one readability finding.
- **Evidence:**
  - [Ruff settings](https://docs.astral.sh/ruff/settings/) — Astral — official_docs — defaults max-complexity 10, max-branches 12, max-statements 50, max-args 5, max-positional-args 5, max-returns 6, max-nested-blocks 5, max-locals 15, max-statements-in-try 5 — all confirmed.
  - [complex-structure (C901)](https://docs.astral.sh/ruff/rules/complex-structure/) — Astral — official_docs — the STATUS_TRANSITIONS dict example is confirmed.
  - [Vavrová & Zaytsev — Does Python Smell Like Java?](https://arxiv.org/abs/1703.10882) — The Art, Science, and Engineering of Programming 1(2), 2017 — peer_reviewed — "more than twice as many methods in Python can be considered too long (statistically extremely longer than their neighbours within the same project)… long parameter lists are seven times less likely… 32'058'823 lines" — confirmed. This measures smell prevalence, not threshold validity.
  - [Google Python Style Guide §2.7](https://google.github.io/styleguide/pyguide.html) — Google — official_docs — "multiple for clauses or filter expressions are not permitted. Optimize for readability, not conciseness." — confirmed.
  - [Effective Python 3rd ed.](https://effectivepython.com/) — item 41 "Avoid More Than Two Control Subexpressions in Comprehensions" — TOC-verified.
  - [Midolo et al. 2026](https://arxiv.org/abs/2601.13139) — preprint — smell reduction "at the cost of decreased readability" — confirmed (counterpoint).
- **Detect:** `ruff check --select C901,PLR0911,PLR0912,PLR0913,PLR0915,PLR0917 --statistics .` and `ruff check --preview --select PLR1702 .`. Sort by the metric and look at the top 5–10% only.
- **Tools:** ruff
- **Applies to:** business logic in long-lived modules. Skip generated code, parsers and state machines.
- **When not to apply / counterpoints:**
  - Thresholds are arbitrary.
  - Splitting functions to satisfy counters can hurt readability (HN alentred 49056554, storus 49058601; Midolo et al.).
- **Fix risk:** high

## Practitioner voice
All of the following were opened through the HN Algolia API or the GitHub API and say what is described.
- [apelapan — Ruff 0.16 about 10% autofixable](https://news.ycombinator.com/item?id=49057504) — one codebase under 10k LOC went from "perfectly clean" to 100+ unfixable errors; used LLMs to triage.
- [maratc — 2900 new errors](https://news.ycombinator.com/item?id=49081177) — "which weren't errors at all just yesterday".
- [kstenerud — welcomes strong defaults](https://news.ycombinator.com/item?id=49056368) — "With the advent of agentic coding, strong linting is more important than ever."
- [anticodon — 0 bugs from except Exception](https://news.ycombinator.com/item?id=49058556) — 20 years, 0 bugs from unsorted imports or `except Exception`; calls RUF012 "idiotic cargo-cult".
- [IshKebab — mutable default is the most common real catch](https://news.ycombinator.com/item?id=49061460) — rebuttal to anticodon in [49067179](https://news.ycombinator.com/item?id=49067179).
- [mikeydiamonds — agent deleted a test](https://news.ycombinator.com/item?id=49057551) — "perfect compliance, tiny misunderstanding"; also "Default on lint is good for agent fleets".
- [alentred — pylint hacks, agents disabling tests](https://news.ycombinator.com/item?id=49056554) — trusts AI correctness, not its judgement on code quality.
- [storus — lint-driven code bloat](https://news.ycombinator.com/item?id=49058601) — "ruff complains, agent fixes complaints at the cost of code bloat… Nobody reads PRs anymore".
- [biorach — "Generally gets you 90% there"](https://news.ycombinator.com/item?id=49057319) and [vasachi — "In reality it got me 30% there"](https://news.ycombinator.com/item?id=49057474).
- [appplication — ty vs basedpyright](https://news.ycombinator.com/item?id=49060908) — moved from ty to basedpyright because of false positives and missing baselining ("insanely awesome feature").
- [notatoad — dangling-task Heisenbug](https://news.ycombinator.com/item?id=34755050) — on the Textual post (story 34754276: 696 points, 232 comments).
- [CraigJPerry — async footguns](https://news.ycombinator.com/item?id=49056394) — unbounded Queue and gather, `requests.get` in coroutines, garbage-collected tasks with "super tricky forensics".
- [zzzeek — three days of HAProxy logs](https://news.ycombinator.com/item?id=16579496) — CPU-bound code in asyncio made MySQL drop connections; the fix was moving to threads.
- [zer01 — accidental blocking bugs](https://news.ycombinator.com/item?id=28881294) — "infuriatingly difficult to pin down"; prefers threads.
- [lgunsch — bare except hid a wrong-arity call](https://news.ycombinator.com/item?id=20306339) — leaking threads crashed a server.
- [ubercore — pyright caught bugs mypy missed](https://news.ycombinator.com/item?id=42777558); same theme from [IshKebab](https://news.ycombinator.com/item?id=45402745): "Mypy is trash but Pyright is very good."
- [toxik — type-checker "bugs" are mostly annotation bugs](https://news.ycombinator.com/item?id=42260337).
- [agubelu — untyped libraries produce ignorable noise](https://news.ycombinator.com/item?id=42254198).
- [KaiserPro — gradual enforcement leaves "a million errors"](https://news.ycombinator.com/item?id=42254374).
- [Ruff #27024 — "safe" RUF055 fix changed behaviour](https://github.com/astral-sh/ruff/issues/27024) — preview rule, July 2026.
- [Bandit #333 — B603 flags every check_output](https://github.com/PyCQA/bandit/issues/333) — a commenter (not a maintainer) concedes "the test is a bit dumb"; still open.
- [Ruff #14398 — TRY003 pushback](https://github.com/astral-sh/ruff/issues/14398) — using ValueError/TypeError with a message is standard practice.
- [Ruff #7866 — TC001 false positive with pydantic across files](https://github.com/astral-sh/ruff/issues/7866) — still open.

## Contradictions and open questions

**Contradictions**
1. **How broad the rule set should be.** Astral grew the defaults to 413 because "many of these rules catch severe issues", and kstenerud and mikeydiamonds welcome strong defaults for agent-driven coding. anticodon, maratc and apelapan report thousands of non-bugs and 10–30% autofix rates. Astral published no per-rule false-positive data, and the 413 include import sorting and pyupgrade rules as well as correctness rules.
2. **Mutable defaults.** B006 and the Google guide forbid them. The Python FAQ documents a deliberate `_cache={}` memoization idiom. anticodon says they are only a bug when mutated; IshKebab says that is common.
3. **Broad exceptions.** PEP 8, Google and PEP 20 discourage catch-alls, and E722/BLE001/S110 are defaults. PEP 760 (ban bare except) was withdrawn as not worth the cost, and in the discussion thread bare except with re-raise was defended for rollback. A 20-year practitioner reports 0 bugs from `except Exception`.
4. **Value of type checking.** Khan et al. (15% of defects preventable, a lower bound) and Di Grazia & Pradel (more annotations find more errors) argue for it. toxik reports that most findings are annotation bugs, and agubelu reports false-positive noise from untyped libraries. Practitioners also disagree on mypy versus pyright.
5. **Performance idioms.** Leelaprute et al. (ICPC 2022, synthetic, at scale) report large savings. Zhang et al. (ICSE 2023, real projects) find differences "generally small" and possible slowdowns.
6. **Caching on methods.** B019 (default) flags every `lru_cache` on a method. The Python FAQ presents a bounded `lru_cache(maxsize=20)` on a method as a legitimate trade-off.
7. **LLM refactoring.** Midolo et al. find GPT-4o refactors preserve behaviour and reduce smells but lower readability. In agent-PR studies, 24% of files gain Pylint issues and 4.7% gain Bandit findings, but issue counts mostly scale with churn. Whether the net effect on maintainability is positive is unresolved.
8. **TRY003.** tryceratops/Ruff want exception messages defined inside exception classes. Common practice and user pushback favour ValueError/TypeError with inline messages. It is not in the defaults.

**Open questions**
- There is no per-rule precision data for Ruff's 0.16 defaults. Which rules are gates and which are hints rests on official rationale plus anecdotes.
- No empirical study was found that measures how often dangling tasks, swallowed CancelledError or blocking calls cause production incidents.
- No Python-specific study linking C901/PLR09xx thresholds to defect- or change-proneness was verified. Chen et al. 2017 (IST) was paywalled and not checked. This is why F17 is graded C.
- How PEP 649/749 deferred annotations (Final, 3.14) change the risk of the TC/FA/UP fixes for pydantic and SQLAlchemy users was not verified.
- The maturity and false-positive rate of ty (Astral's type checker) as of 2026-09 is unclear; the only data point is one practitioner report.
- The real-world impact of free-threaded CPython on code that relies on GIL-implied atomicity has not been measured.
- The practitioner voice leans heavily on Hacker News and GitHub. Reddit and Lobsters blocked automated access, and WebSearch was exhausted.
- Whether annotation coverage in applications (as opposed to libraries) correlates with fewer defects is still open.

## Dropped findings
(none: all 25 findings had real sources that support the core claim. Misattributions were fixed in place and are listed in each finding's verdict line.)
