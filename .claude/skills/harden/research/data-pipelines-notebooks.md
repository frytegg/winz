# Correctness of dataframe, data-pipeline and notebook code (pandas, polars, NumPy, Jupyter)
> Code G109 · slug data-pipelines-notebooks · verified 2026-09-23 · counts: verified 11 / corrected 11 / downgraded 0 / dropped 0

## Summary

This dossier covers bugs in dataframe, pipeline and notebook code that return wrong results without raising an error. All 22 of the researcher's rules survived verification, 11 of them with corrections. The rules fall into seven areas:

1. **Joins:** cardinality, null keys, row order and as-of semantics (F01, F02).
2. **Copy-on-Write and chained assignment:** F03, and inplace handling in F21.
3. **Version-sensitive semantics** (F04, F05), checked against the release notes and migration guides:
   - pandas 3.0.0 came out on 21 Jan 2026. The current release is 3.0.6 (17 Sep 2026), and there is no 3.1 yet.
   - pandas 2.3.0 (4 Jun 2025) is the release that prepares for 3.0.
   - The polars Python docs are at py-1.44.2.
   - NumPy 2.x brings NEP 50 promotion, and the default integer on 64-bit Windows is now int64.
4. **NaN/null, dtype and index-alignment semantics:** F07, F08, F09.
5. **Load-boundary parsing and schema validation:** F10, F11. Validation runs in report mode first and is enforced later.
6. **Leakage and look-ahead in ML and backtest code:** F13, F14, F15.
7. **Notebook reproducibility** (F16 to F19), plus a golden-output (characterisation) harness to build before any refactor (F20). F22 covers what detectors can and cannot see.

Main empirical anchors, as re-checked against the primary texts:
- **Pimentel et al., MSR 2019.** Of 863,878 attempted executions of valid notebooks, "only 24.11% executed without errors and only 4.03% produced the same results".
- **Samuel & Mietchen, GigaScience 13 (2024).** The corpus had 22,578 Python notebooks:
  - 15,817 declared their dependencies;
  - 10,388 had dependencies that installed, and were re-run;
  - 1,203 ran without errors, and 879 of those gave identical results.
  - *Correction:* the researcher's "1,203 of 22,578" hid the intermediate denominators.
- **Yang et al., ASE '22.** Leakage appeared in 29.6% of 107,603 GitHub notebooks. The static detector's precision was 97.6% (40/41) and its recall 67.8% (40/59), measured on a labelled sample of 100 notebooks.
- **Kapoor & Narayanan.** *Correction:* three different sets of numbers exist.
  - The peer-reviewed version (Patterns 4(9), 2023) says leakage was found in 17 fields, affecting **294** papers.
  - The arXiv v1 (2022) says errors were found in 17 fields, affecting **329** papers, and that each field suffers from leakage.
  - The project site now says "41 papers from 30 fields where errors have been found, collectively affecting 648 papers".
- **Breck et al. (SysML 2019) and Shankar et al. (arXiv 2022).** Both report alert fatigue from spammy or overfitted validation. This supports curated schemas that report first and enforce later.

Main hazards for a hardening agent:
- **PD010, PD011 and NPY002 rewrites are not equivalent.**
  - PD010 turns pivot into pivot_table.
  - PD011 turns `.values` into `.to_numpy()`; the two differ for tz-aware, categorical and pandas 3 `str` data.
  - NPY002 moves from the legacy RNG to `Generator`.
  - *Correction:* Ruff's rule index shows **no automatic fix** for these three rules. The danger is an agent hand-applying the rule message mechanically, not `ruff --fix`.
  - PD002 (inplace) and NPY201 **do** have autofixes, so apply them one at a time with golden checks.
- **Most correctness fixes change outputs:** join `how`, NaN handling, dtype changes, leakage, look-ahead, timezones and library upgrades. Keep them report-only until they are confirmed against golden outputs.

Further corrections made during verification:
- **pandas has not yet deprecated `inplace`.** PDEP-8 is accepted, but pandas 3.0.x emits no deprecation for `inplace` on drop/rename/dropna/sort_values etc. (checked in the 3.0.0 release notes and on 3.0.6 locally).
- **scikit-learn `random_state` does not accept a NumPy `Generator`.** Only None, int or `RandomState` are accepted, so "pass `default_rng` everywhere" is wrong for sklearn.
- **dslinter is unmaintained.** The last release was 2.0.9 in June 2022. It pins pylint 2.12 and astroid 2.9, whose PyPI classifiers stop at Python 3.10. pandas 3 needs Python 3.11 or later.
- **leakage-analysis needs Python 3.8**, which reached end-of-life on 7 Oct 2024. Its last push was in May 2023.
- **Two quotes were replaced with the sources' real wording:** the TimeSeriesSplit quote and the dbt quote. The originals do not appear in the current pages.

Process caveat: WebSearch was exhausted for this verifier too (200/200). Every source was verified by direct fetch: WebFetch, curl plus pdftotext, and the Crossref, PyPI and GitHub APIs. Several library behaviours were also reproduced locally on pandas 3.0.6, NumPy 2.5.3 and polars 1.44.2 in a scratch venv; these are marked "verifier reproduction" and are supplementary to the published sources.

## Findings

### G109-F03 — Replace chained assignment with single-step indexing; never rely on writes through an extracted Series
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** pandas 3.0 made Copy-on-Write the only mode.
  - Chained forms never update `df`: `df['a'][mask] = v`, `df['a'].iloc[i] = v`, `df[mask]['a'] = v`, `df['a'].fillna(..., inplace=True)`.
  - They only emit `ChainedAssignmentError`, which is a `Warning` subclass (verifier reproduction: MRO is `ChainedAssignmentError -> Warning -> Exception`). The pipeline keeps running with stale values.
  - Under 2.x the same forms sometimes worked.
  - So the fix is behaviour-preserving on 2.x where the chain happened to work, and an output-changing bug fix on 3.x.
- **Evidence:**
  - [Copy-on-Write (CoW) user guide](https://pandas.pydata.org/docs/user_guide/copy_on_write.html) — pandas dev team, 2026 (docs 3.0.6) — official_docs — "Chained assignment will consistently never work and raise a ChainedAssignmentError warning with CoW enabled"; on warn mode: "We expect this mode to be very noisy ... The first two items of the following lists are the only cases that need to be addressed to make existing code work with CoW." — verified verbatim.
  - [pandas.errors.ChainedAssignmentError](https://pandas.pydata.org/docs/reference/api/pandas.errors.ChainedAssignmentError.html) — pandas dev team, 2026 — official_docs — "Warning raised when trying to set using chained assignment ... assigning through a chain can never update the original Series or DataFrame." — verified.
  - [What's new in 3.0.0 (January 21, 2026)](https://pandas.pydata.org/docs/whatsnew/v3.0.0.html) — pandas dev team, 2026 — official_docs — "chained assignment ... will stop working. Because this now consistently never works, the SettingWithCopyWarning is removed, and defensive .copy() calls to silence the warning are no longer needed." — verified.
  - [Copy-on-Write in pandas](https://phofl.github.io/cow-introduction.html) — Patrick Hoefler (pandas core dev), 23 Dec 2022 — engineering_blog — "The exact behavior is hard to predict, even for experienced users."; `df[df["score"] > 15]["user_id"] = 5` changes nothing and only raises SettingWithCopyWarning — verified.
  - [Code Smells for Machine Learning Applications (CAIN '22)](https://arxiv.org/abs/2203.13746) — Zhang, Cruz, van Deursen, 2022 — peer_reviewed — §4.3 Chain Indexing: "Using chain indexing may cause performance issues as well as error-prone code" — verified in the PDF text.
  - Verifier reproduction (pandas 3.0.6): `d["a"][d["a"]>1] = 99` leaves `d["a"] == [1,2,3]` and emits one ChainedAssignmentError.
- **Detect:**
  1. On pandas ≥ 3.0, which is the most reliable check, run `python -W error::pandas.errors.ChainedAssignmentError -m pytest`, or the pipeline entry point with the same flag. On 2.2/2.3, set `pd.options.mode.copy_on_write = "warn"` in conftest.py and collect the warnings.
  2. ast-grep patterns: `$D[$A][$B] = $V`, `$D[$A].iloc[$I] = $V`, `$D[$A].loc[$I] = $V`, `$D[$A].$M($$$, inplace=True)`.
  3. Under CoW, `to_numpy()` on a frame can return a read-only array. In-place writes to it then raise loudly, so fix those with `.copy()`.
- **Tools:** pytest `-W error::...`; pandas CoW warn mode (2.2/2.3); ast-grep. dslinter W5502 exists but see F22 on its maintenance status.
- **Applies to:** pandas, all versions; the semantics flip at 3.0.
- **When not to apply / counterpoints:**
  - The pandas guide itself says warn mode is noisy and only two categories must be fixed.
  - Keep defensive `.copy()` calls on code still pinned below 3.0.
  - On 3.0 the fix changes outputs: values that were silently not updated now are. Confirm with golden outputs (F20).
- **Fix risk:** medium

### G109-F04 — Never bump pandas, polars or NumPy major versions implicitly; gate upgrades with golden diffs and replace version-fragile idioms
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Major releases change results without raising.
  - **pandas 3.0.0:**
    - strings infer to `str`, so `dtype == "object"` becomes False;
    - `astype(str)` keeps NaN as missing instead of producing the string 'nan';
    - strings parse to microsecond resolution by default;
    - groupby `observed` now defaults to True;
    - `pd.offsets.Day` is a calendar day across DST;
    - NaN is treated as NA in nullable dtypes;
    - zoneinfo is the default timezone type.
  - **pandas 2.0 (PDEP-4):** consistent `to_datetime` format inference.
  - **polars 1.0:**
    - the `group_by_dynamic` default offset became zero;
    - `ewm_*` preserves nulls;
    - `replace` keeps the dtype;
    - the Series constructor converts to the given timezone rather than replacing it.
- **Evidence:**
  - [What's new in 3.0.0 (January 21, 2026)](https://pandas.pydata.org/docs/whatsnew/v3.0.0.html) — pandas dev team, 2026 — official_docs — `str` dtype "Inferred by default for string data (instead of object dtype)"; strings parse to microseconds (`datetime64[us]`); `Timestamp("2025-03-08 08:00", tz="US/Eastern") + Day(1)` gives 08:00-0400 (it was 09:00-0400); NaN becomes NA in nullable dtypes; zoneinfo is the default; groupby `observed` default changed to True (GH 51811) — verified.
  - [Migration guide for the new string data type](https://pandas.pydata.org/docs/user_guide/migration-3-strings.html) — pandas dev team, 2026 — official_docs — `ser.dtype == "object"` is now False, and `pd.api.types.is_string_dtype` works across 2.x/3.x; `astype("str")` gives `['1.5', nan]` rather than `'nan'`; setting 2.5 into a `str` Series raises TypeError; test ahead with `pd.options.future.infer_string = True` on 2.3 — verified.
  - [pandas.DataFrame.groupby](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.groupby.html) — pandas dev team, 2026 — official_docs — "Changed in version 3.0.0: The default value is now True." — verified.
  - [What's new in 2.3.0 (June 4, 2025)](https://pandas.pydata.org/docs/whatsnew/v2.3.0.html) — pandas dev team, 2025 — official_docs — "primarily focused on preparing for pandas 3.0"; `pd.options.future.infer_string = True`; `pd.options.mode.copy_on_write = "warn"` available since 2.2 — verified.
  - [Upgrade guide: Version 1 (polars)](https://docs.pola.rs/releases/upgrade/1/) — Polars, 2024 — official_docs — "Change default offset in group_by_dynamic from 'negative every' to 'zero'"; "Polars will no longer forward-fill null values in ewm methods"; "replace now always keeps the existing data type"; "Consistently convert to given time zone in Series constructor" (example: 00:00 CET becomes 01:00 CET) — verified.
  - [PDEP-4: Consistent datetime parsing](https://pandas.pydata.org/pdeps/0004-consistent-to-datetime-parsing.html) — pandas dev team, created 18 Sep 2022, status Implemented — standard — `['12-01-2000 00:00:00', '13-01-2000 00:00:00']` used to parse as 2000-12-01 and 2000-01-13; the format is now guessed from the first non-NaN element — verified.
  - Verifier reproduction (pandas 3.0.6): `pd.Series([1.5, nan]).astype(str)` gives `['1.5', nan]`, and `pd.Series(["a"]).dtype == object` is False.
- **Detect:**
  1. Check the lockfile (uv.lock / poetry.lock / requirements) for unpinned pandas, polars or numpy.
  2. `rg -n "dtype ?== ?['\"]?object|astype\((str|'str'|\"str\")\)|offsets\.Day|group_by_dynamic\(|ewm_(mean|std|var)\("`.
  3. ast-grep `$X.groupby($$$A)` on categorical keys without `observed=`.
  4. Run the suite on pandas 2.3 with `future.infer_string = True` and CoW `"warn"` before moving to 3.x.
- **Tools:** uv/pip lockfiles, ripgrep, ast-grep, pytest with pandas future options, golden-output harness (F20).
- **Applies to:** pandas 2.x→3.x, polars 0.20→1.x, NumPy 1→2 (F05).
- **When not to apply / counterpoints:**
  - Some upgrade diffs are latent-bug fixes, e.g. PDEP-4 and polars' strict `replace`. Classify each diff rather than assuming a regression.
  - Pinning forever accumulates security and compatibility debt. The goal is a gated upgrade.
- **Fix risk:** high

### G109-F01 — Every join states `how`, its expected cardinality (`validate`), and is audited once for unmatched and duplicated keys
- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  - The dplyr change dates from 1.1.1, not 1.1.0.
  - The Stata "m:m is a bad idea" analogy is qualified, because Stata's m:m pairs rows sequentially and is not a Cartesian join. dslinter is also flagged as unmaintained.
- **Rationale:**
  - Both pandas `merge` and polars `join` default to `how='inner'`. Neither checks cardinality by default: pandas `m:m` "does not result in checks", and polars `m:m` is the default.
  - So duplicated right-side keys multiply rows, and unmatched keys drop rows, with no error.
  - Zhang et al. list omitting `validate` as a smell because the result "might silently go wrong".
  - dplyr 1.1.1 changed its default to warn on many-to-many equality joins. Stata's `merge` requires the cardinality to be declared and offers `assert()` on match results.
  - Adding `validate` changes nothing when the assumption holds and raises when it does not. It is a fail-loudly hardening step.
- **Evidence:**
  - [pandas.merge](https://pandas.pydata.org/docs/reference/api/pandas.merge.html) — pandas dev team, 2026 (docs 3.0.6) — official_docs — `validate`: "'many_to_many' or 'm:m': allowed, but does not result in checks."; `how='inner'` default — verified.
  - [polars.DataFrame.join](https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.join.html) — Polars, 2026 (py-1.44.2) — official_docs — `validate` m:m is "(Default) Many-to-many", plus the note "This is currently not supported by the streaming engine."; `how='inner'` default — verified.
  - [Code Smells for ML Applications, §4.6](https://arxiv.org/abs/2203.13746) — Zhang, Cruz, van Deursen (CAIN '22), 2022 — peer_reviewed — "If the developer assumes the merge keys are unique in both left and right datasets, but that is not the case, and he does not specify this parameter, the result might silently go wrong." — verified in the PDF. Note that the catalogue classifies the smell's impact as "Readability".
  - [Stata [D] merge](https://www.stata.com/manuals/dmerge.pdf) — StataCorp (StataNow manual), 2025 — official_docs — "m:m specifies a many-to-many merge and is a bad idea ... Thus m:m merges are dependent on the current sort order--something which should never happen."; `assert(match master)` makes merge error on unexpected match results — verified. *Qualification:* Stata's m:m matches rows sequentially within key groups (first to first, and so on). It is not a SQL-style Cartesian product, so it is an analogy for "declare cardinality", not the same failure mode.
  - [dplyr mutating joins reference](https://dplyr.tidyverse.org/reference/mutate-joins.html) — Posit/tidyverse, 2025 — official_docs — `relationship = NULL` "for equality joins it will check for a many-to-many relationship (which is typically unexpected) and will warn if one occurs"; `unmatched = "error"` throws on unmatched keys — verified.
  - [dplyr NEWS, 1.1.1](https://dplyr.tidyverse.org/news/index.html) — Posit, 2023 — official_docs — "a warning was previously being thrown when a one-to-many or many-to-many relationship was detected ... but is now only thrown for a many-to-many relationship, which is much rarer and much more dangerous ... Cartesian explosion" — added by the verifier to fix the version attribution.
  - Verifier reproduction (pandas 3.0.6 / polars 1.44.2): see F02 for null-key behaviour.
- **Detect:**
  1. ast-grep (Python): `rule: {any: [{pattern: '$L.merge($$$A)'}, {pattern: 'pd.merge($$$A)'}, {pattern: '$L.join($$$A)'}], not: {has: {pattern: 'validate=$V', stopBy: end}}}`. `.join` also matches `str.join`, so triage hits by hand.
  2. Runtime audit, run once on real data in a test or scratch run: `out = left.merge(right, on=k, how='left', validate='m:1', indicator=True); out['_merge'].value_counts(); assert len(out) == len(left)`. For polars, `left.join(right, on=k, how='anti').height` counts unmatched left rows.
  3. Also check `right[k].duplicated().sum()` and `right[k].isna().sum()`.
  4. dslinter R5505 only in an old, isolated environment (see F22).
- **Tools:** ast-grep; pandas `validate` and `indicator`; polars `validate` and `how='anti'`; nbQA for notebooks.
- **Applies to:** pandas, polars (the same logic holds in SQL and dplyr); scripts and notebooks.
- **When not to apply / counterpoints:**
  - polars `validate` is not supported by the streaming engine. Under streaming, use an explicit uniqueness pre-check instead.
  - The check adds a uniqueness pass.
  - `indicator=True` changes the schema, so use it in audits only.
  - Genuine m:m joins should be declared as `m:m`.
  - No prevalence study quantifies silent join duplication (see open questions).
- **Fix risk:** low

### G109-F02 — Make null-key, row-order and as-of semantics explicit, especially when porting pandas to polars
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - pandas matches null keys to each other ("different from usual SQL join behaviour"). polars never matches nulls unless `nulls_equal=True`.
  - polars joins guarantee no output order unless `maintain_order` is set.
  - As-of joins default to backward/`allow_exact_matches=True` and need sorted keys. The polars in-memory engine cannot check sortedness when `by` groups are given.
  - Each of these gives misaligned or different rows without an error.
- **Evidence:**
  - [pandas.merge](https://pandas.pydata.org/docs/reference/api/pandas.merge.html) — pandas dev team, 2026 — official_docs — "If both key columns contain rows where the key is a null value, those rows will be matched against each other. This is different from usual SQL join behaviour and can lead to unexpected results." — verified verbatim.
  - [polars.DataFrame.join](https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.join.html) — Polars, 2026 — official_docs — `nulls_equal`: "By default null values will never produce matches."; `maintain_order`: "Do not rely on any observed ordering without explicitly setting this parameter, as your code may break in a future release. Not specifying any ordering can improve performance." — verified verbatim.
  - [polars.DataFrame.join_asof](https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.join_asof.html) — Polars, 2026 — official_docs — `strategy='backward'`, `allow_exact_matches=True`, `check_sortedness=True`; "Currently, the in-memory engine cannot check the sortedness if 'by' groups are provided." — verified.
  - [pandas.merge_asof](https://pandas.pydata.org/docs/reference/api/pandas.merge_asof.html) — pandas dev team, 2026 — official_docs — `direction` default "backward"; `allow_exact_matches` default True (≤ / ≥); "Both DataFrames must be first sorted by the merge key in ascending order before calling this function." — verified.
  - Verifier reproduction (pandas 3.0.6 / polars 1.44.2): the same two frames with one NaN key on each side give 2 rows from pandas `merge` (NaN matched to NaN) and 1 row from polars `join`.
- **Detect:**
  1. Count null keys on both sides before each join: `isna().sum()` in pandas, `null_count()` in polars.
  2. ast-grep `$L.join($$$A)` without `maintain_order=` in polars modules. Then check by hand whether the result is later combined by position.
  3. For every `pd.merge_asof`/`join_asof`, confirm an explicit upstream sort by `[by, on]`, and review direction/strategy, `allow_exact_matches` and `tolerance`.
  4. When porting, diff results on a fixture that contains null keys.
- **Tools:** ast-grep, pandas, polars, pytest fixtures with null keys.
- **Applies to:** pandas, polars; pandas→polars migrations.
- **When not to apply / counterpoints:**
  - `maintain_order` costs parallelism; polars says omitting it "can improve performance".
  - Some code relies deliberately on pandas null-key matching.
  - Setting `nulls_equal=True` to mimic pandas can preserve an old bug.
- **Fix risk:** medium

### G109-F05 — On NumPy 2.x, fix removed APIs with NPY201 and hunt NEP 50 promotion changes separately; give accumulations explicit dtypes
- **Grade:** A · **Verdict:** VERIFIED. The 2.0.0 release notes were added as an explicit Windows source.
- **Rationale:**
  - Under NEP 50, Python scalars are "weak", so values no longer influence the result type:
    - `np.float32(3) + 3.` now returns float32;
    - `np.uint8(100) + 200` now gives `uint8(44)` with a RuntimeWarning;
    - `array([1], uint8) + 1000` now raises.
  - The default integer on 64-bit Windows moved from int32 to int64. Integer accumulations that silently overflowed int32 now give different, correct values. This is relevant to this user's Windows host.
- **Evidence:**
  - [NumPy 2.0 migration guide](https://numpy.org/doc/stable/numpy_2_0_migration_guide.html) — NumPy developers, 2024 — official_docs — "np.float32(3) + 3. now returns a float32 when it previously returned a float64"; "For floating point values, this can lead to lower precision results ... For integers, errors or overflows are possible."; `np._set_promotion_state("weak_and_warn")` "may flag many changes that are irrelevant in practice"; NPY201 is recommended — verified.
  - [NumPy 2.0.0 release notes](https://numpy.org/doc/stable/release/2.0.0-notes.html) — NumPy developers, 2024 — official_docs — "The default integer type on Windows is now int64 rather than int32 ... the historic 32-bit default on Windows was a common source of issues." — added by the verifier.
  - [NEP 50: Promotion rules for Python scalars](https://numpy.org/neps/nep-0050-scalar-promotion.html) — Sebastian Berg, created 2021-05-25, status Final — standard — table rows: `uint8(100) + 200` goes from `int64(300)` to `uint8(44)` with a RuntimeWarning; `float32(1) + 3e100` goes from `float64(3e100)` to `float32(Inf)`; `array([1], uint8) + 1000` now raises an Exception; "code which only uses the default dtypes float64, or int32/int64 or more precise ones should not be affected" — verified.
  - [numpy.sum](https://numpy.org/doc/stable/reference/generated/numpy.sum.html) — NumPy developers, 2026 — official_docs — "the exact precision may vary depending on other parameters"; for float32 "it can be advisable to use dtype=np.float64" — verified.
  - Verifier reproduction (NumPy 2.4.3, Windows): `np.uint8(100)+200` gives `uint8(44)` with a RuntimeWarning; the default int dtype is int64; `np._set_promotion_state` does **not** exist on 2.4. The warn-mode check therefore needs NumPy 1.24–1.26, as the rule says.
- **Detect:**
  1. `ruff check --select NPY201 .` (stable, autofix available).
  2. ast-grep for low-precision scalar mixing, e.g. `np.float32($X) $OP $Y`, `.astype(np.float32)`, and arithmetic on uint8/int8/int16. Review hits by hand.
  3. On NumPy 1.26, run the tests with `np._set_promotion_state("weak_and_warn")` and collect the warnings.
  4. On Windows, diff golden outputs from NumPy 1.x and 2.x for `cumsum`, `prod` and large `arange`.
- **Tools:** Ruff NPY201, ast-grep, NumPy promotion-state warnings (1.x only), golden-output harness.
- **Applies to:** NumPy, and pandas/polars code that drops down to NumPy; especially on Windows.
- **When not to apply / counterpoints:**
  - weak_and_warn is noisy.
  - float64/int64-only code is largely unaffected.
  - Forcing float64 accumulators costs memory and speed.
- **Fix risk:** medium

### G109-F07 — Make NaN/null semantics explicit (equality tests, all-NA sums, NaN group keys, polars NaN vs null)
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Four behaviours give plausible numbers instead of errors:
  - `x == np.nan` is always False, so the branch never runs.
  - The sum of an all-NA group is 0 (and the product is 1), so a missing period looks like a zero return.
  - `groupby(dropna=True)`, the default, drops NaN-key rows.
  - polars treats NaN as a float value, not as missing. `pl.from_pandas` converts NaN to null by default, but the NumPy constructor does not. The same data can therefore aggregate differently depending on how it was loaded.
- **Evidence:**
  - [Working with missing data](https://pandas.pydata.org/docs/user_guide/missing_data.html) — pandas dev team, 2026 — official_docs — `np.nan == np.nan` gives False; `pd.Series([np.nan]).sum()` gives 0.0 and `.prod()` gives 1.0: "When summing data, NA values or empty data will be treated as zero"; reductions skip NA by default — verified.
  - [pandas.Series.sum (min_count)](https://pandas.pydata.org/docs/reference/api/pandas.Series.sum.html) — pandas dev team, 2026 — official_docs — "min_count int, default 0 ... If fewer than min_count non-NA values are present the result will be NA." — added by the verifier.
  - [pandas.DataFrame.groupby (dropna)](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.groupby.html) — pandas dev team, 2026 — official_docs — "If True, and if group keys contain NA values, NA values together with row/column will be dropped." — verified.
  - [Missing data (polars user guide)](https://docs.pola.rs/user-guide/expressions/missing-data/) — Polars, 2026 — official_docs — "NaN values are considered to be a type of floating point data and are not considered to be missing data in Polars."; `mean`/`sum` "skip the missing values ... whereas the value NaN is considered for the computation and typically propagates into the result." — verified.
  - [polars.from_pandas](https://docs.pola.rs/api/python/stable/reference/api/polars.from_pandas.html) and [DataFrame constructor](https://docs.pola.rs/api/python/stable/reference/dataframe/index.html) — Polars, 2026 — official_docs — `from_pandas` has `nan_to_null=True`; the constructor's `nan_to_null` defaults to False ("If the data comes from one or more numpy arrays...") — verified.
  - [Ruff PLW0177 nan-comparison](https://docs.astral.sh/ruff/rules/nan-comparison/) — Astral, 2026 — official_docs — "Comparing against a NaN value can lead to unexpected results ... x == float("NaN") will always return False"; stable since 0.12.0 — verified.
  - [Code Smells for ML Applications, §4.2](https://arxiv.org/abs/2203.13746) — Zhang et al., 2022 — peer_reviewed — "As Pandas treats None like np.nan ... a comparison of DataFrame elements with np.nan always returns False" — verified.
  - Verifier reproduction (pandas 3.0.6 / polars 1.44.2):
    - `pd.Series([nan]).sum()` gives 0.0; with `min_count=1` it gives NaN.
    - The groupby default drops the NaN key; `dropna=False` keeps it.
    - `pl.from_pandas` produces 1 null; `pl.DataFrame({"a": np.array([1.0, nan])})` produces 0 nulls.
- **Detect:**
  1. `ruff check --select PLW0177,PLR0124`.
  2. ast-grep `$X == np.nan`, `$X != np.nan`, `$X == float('nan')`, `$X == pd.NA`, `$X.eq(np.nan)`.
  3. Review `.sum()`/`.prod()` on groupby or resample in returns and PnL code for a missing `min_count=`.
  4. Check `df[keys].isna().sum()` before each groupby. In polars, count `is_nan()` next to `null_count()`.
  5. grep `from_pandas(` and `fill_null(` on float columns.
- **Tools:** Ruff, ast-grep, runtime null/NaN counters (dslinter E5501 only in a legacy environment, see F22).
- **Applies to:** pandas, polars, NumPy.
- **When not to apply / counterpoints:**
  - Fixing (a) makes a dead branch live, which changes behaviour.
  - Sometimes missing really does mean 0 (no trades means zero volume).
  - `dropna=False` adds a NaN group.
  - Converting NaN to null changes downstream aggregates.
- **Fix risk:** medium

### G109-F13 — Report, never auto-fix, train/test leakage (preprocessing, overlap, multi-test)
- **Grade:** A · **Verdict:** CORRECTED. The Kapoor & Narayanan figures now distinguish three versions:
  - the peer-reviewed Patterns 2023 version: 17 fields and **294** papers where leakage was found;
  - the arXiv v1: 329 papers affected by "errors", with each field suffering from leakage;
  - the project site: 648 papers in 30 fields.
  The Yang corpus size and the sample basis for the detector's accuracy were also made explicit.
- **Rationale:** Leakage inflates reported accuracy with no error signal.
  - **Yang et al.:** at least one form of leakage in 29.6% of 107,603 GitHub notebooks:
    - preprocessing leakage 12.3% (32.9% among notebooks that scale their data);
    - multi-test leakage 18.5%;
    - overlap leakage 6.5%.
  - Only 5.5% of those notebooks use pipelines, and 18.1% of those still leak.
  - **Kapoor & Narayanan** document leakage across 17 fields.
  - **scikit-learn's own example:** feature selection on the full data gives 0.76 accuracy on random labels, against 0.5 when the split comes first.
  - Fixing leakage changes metrics, so it is output-changing by nature.
- **Evidence:**
  - [Data Leakage in Notebooks: Static Detection and Better Processes (ASE '22)](https://www.cs.cmu.edu/~ckaestne/pdf/ase22.pdf) — Yang, Brower-Sinning, Lewis, Kästner, 2022 — peer_reviewed — the paper says:
    - "Applying our analysis to over 100,000 public notebooks, we detect data leakage issues in nearly 30 percent of them";
    - the table shows GitHub (all) 107,603 notebooks with 12.3 / 6.5 / 18.5 / 29.6%;
    - "yielding a precision of 97.6% (40 out of 41 detected issues)" and "a recall of 67.8% (40 out of 59)" on a labelled sample of 100 notebooks, 94 of which were analysable;
    - "only 5.5% notebooks use pipelines. Surprisingly, 18.1% of these notebooks still contain pre-processing leakage".
    — verified in the PDF text.
  - [Leakage and the reproducibility crisis in machine-learning-based science](https://doi.org/10.1016/j.patter.2023.100804) — Kapoor & Narayanan, Patterns 4(9), Sept 2023 — peer_reviewed — "we find 17 fields where leakage has been found, collectively affecting 294 papers"; taxonomy of eight leakage types — the abstract was verified via the Semantic Scholar API and the venue via Crossref. The verifier substituted this peer-reviewed version for the preprint as the primary citation.
  - [arXiv v1 of the same paper](https://arxiv.org/abs/2207.07048) — Kapoor & Narayanan, 14 Jul 2022 — preprint — "we find 17 fields where errors have been found, collectively affecting 329 papers"; Table 1 lists 20 papers across 17 fields, and "Each of these fields suffers from leakage" — verified in the PDF text.
  - [Project site](https://reproducible.cs.princeton.edu/) — Princeton, 2026 — other — "We find 41 papers from 30 fields where errors have been found, collectively affecting 648 papers." These are errors, not only leakage — verified.
  - [Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, 2026 (v1.9.1) — official_docs — "The general rule is to never call fit on the test data."; the SelectKBest example scores 0.76 when wrong and 0.5 when right — verified.
  - [Code Smells for ML Applications, §4.21](https://arxiv.org/abs/2203.13746) — Zhang et al., 2022 — peer_reviewed — "Use Pipeline() API in Scikit-Learn or check data segregation carefully ... to prevent data leakage" — verified.
- **Detect:**
  1. leakage-analysis (Yang et al.): `python3 -m src.main path` or `python3 -m src.run dir/`. Note that it needs Python 3.8, which reached end-of-life on 2024-10-07, plus Souffle and a bundled custom pyright. Its last push was May 2023. Run it in its Docker image only.
  2. For each file, check the order of `train_test_split(`/`TimeSeriesSplit(`/`KFold(` relative to `.fit(`, `.fit_transform(`, `SelectKBest(`, `SMOTE(`, `fit_resample(` and `PCA(` applied to the pre-split variable. Also flag `pd.concat([train, test])` followed by preprocessing.
  3. Confirm that a final test set is evaluated exactly once.
- **Tools:** leakage-analysis (malusamayo/leakage-analysis, Docker), ast-grep, manual review / model info sheets.
- **Applies to:** ML code in scripts and notebooks (sklearn, and pandas/polars feature pipelines).
- **When not to apply / counterpoints:**
  - Yang et al.: "experiments with notebooks in our corpus often just yielded marginal if any differences in accuracy". They envision warnings "as a starting point for reflection and discussion".
  - Recall is only 67.8%.
  - Kaggle-style combined preprocessing is sometimes allowed by competition rules.
- **Fix risk:** high

### G109-F16 — Verify notebooks with a static execution-count check plus a fresh-kernel run of a copy, before trusting or refactoring them
- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  - Samuel & Mietchen's denominators were restated.
  - The nbconvert docs do not literally say "fresh kernel". The run happens in a kernel process that nbconvert starts, separate from the interactive session; this is the verifier's inference from the docs, which describe `kernel_name` selection.
- **Rationale:**
  - **Pimentel et al.:**
    - of 863,878 attempted executions, 24.11% ran without errors and 4.03% reproduced the stored results;
    - among the 912,343 notebooks with unambiguous execution order, 36.36% had out-of-order cells and 76.90% had at least one skip in the execution count;
    - NameError occurred in 14.53% of executions;
    - they recommend "Re-run notebooks top to bottom before committing."
  - **Samuel & Mietchen:** 22,578 Python notebooks; 15,817 declared dependencies; 10,388 installed; 1,203 ran without errors; 879 were identical. ModuleNotFoundError/ImportError caused 41.65% of the failed executions.
  - **nbsafety** flagged potential safety errors in 117 of 666 real sessions.
- **Evidence:**
  - [A Large-scale Study about Quality and Reproducibility of Jupyter Notebooks (MSR 2019)](https://leomurta.github.io/papers/pimentel2019a.pdf) — Pimentel, Murta, Braganholo, Freire, 2019 — peer_reviewed (MSR 2019, DOI 10.1109/MSR.2019.00077) — "out of 863,878 attempted executions of valid notebooks ... only 24.11% executed without errors and only 4.03% produced the same results"; 36.36% out of order; 76.90% with at least one skip; NameError 14.53%; best practice 8, "Re-run notebooks top to bottom before committing." — verified in the PDF text.
  - [Computational reproducibility of Jupyter notebooks from biomedical publications](https://academic.oup.com/gigascience/article/doi/10.1093/gigascience/giad113/7516267) — Samuel & Mietchen, GigaScience 13, 2024 — peer_reviewed — "Out of 27,271 Jupyter notebooks ... 22,578 notebooks were written in Python, including 15,817 that had their dependencies declared ... For 10,388 of these, all declared dependencies could be installed ... 1,203 notebooks ran through without any errors, including 879 that produced results identical"; "6,588 (41.65%) of the executions failed because of ModuleNotFoundError and ImportError" — verified via the article page, Crossref and the [arXiv 2308.07333](https://arxiv.org/abs/2308.07333) text.
  - [Fine-Grained Lineage for Safer Notebook Interactions](https://arxiv.org/abs/2012.06981) — Macke, Gong, Lee, Head, Xin, Parameswaran, 2020 — preprint (technical report) — "replaying and analyzing 666 real notebook sessions ... identified 117 sessions with potential safety errors"; highlighted cells "were more than 7× more likely to be selected by users for re-execution" — verified in the PDF text.
  - [nbconvert: Executing notebooks](https://nbconvert.readthedocs.io/en/latest/execute_api.html) — Jupyter, 2026 — official_docs — `jupyter nbconvert --to notebook --execute mynotebook.ipynb`; "The default is 30 s"; `--ExecutePreprocessor.timeout=600`; halts with CellExecutionError unless `allow_errors` — verified. The docs do **not** use the phrase "fresh kernel".
  - [nbval](https://nbval.readthedocs.io/en/latest/) — computationalmodelling, 2026 — official_docs — "Validating the notebook means to rerun the notebook and make sure that it is generating the same output as has been stored."; `--nbval-lax` checks only cells marked `# NBVAL_CHECK_OUTPUT`; regex sanitize files — verified.
  - [papermill: Execute](https://papermill.readthedocs.io/en/latest/usage-execute.html) — nteract, 2026 — official_docs — `papermill local/input.ipynb s3://bkt/output.ipynb -p alpha 0.6 -p l1_ratio 0.1`; `pm.execute_notebook(...)` — verified.
- **Detect:**
  1. Static check of the .ipynb JSON. Flag code cells that have outputs but a null `execution_count`, non-increasing counts, gaps greater than 1, and absolute paths (regex `[A-Za-z]:\\|/home/|/Users/`).
  2. Run a **copy** with `jupyter nbconvert --to notebook --execute --ExecutePreprocessor.timeout=600 --output <tmp> nb.ipynb`, or with papermill on a sample. Use a clean venv built from the lockfile.
  3. Compare with `pytest --nbval-lax` or `nbdiff`.
  4. Classify each notebook: runs and matches / runs but differs / fails. For failures, NameError suggests hidden state, ModuleNotFoundError suggests dependencies, and FileNotFoundError suggests paths.
- **Tools:** nbconvert, papermill, nbval, nbdime, uv/venv lockfile.
- **Applies to:** Jupyter notebooks, including research and backtest notebooks.
- **When not to apply / counterpoints:**
  - Re-execution can be slow or costly; parametrise it.
  - Nondeterministic outputs need sanitisers.
  - SAFETY: never execute notebooks that call live trading or exchange APIs, send orders, write to production or spend money without explicit user approval. Run with keys absent.
  - Pimentel replayed cells in execution-count order, which the authors say may inflate NameErrors compared with a top-down run.
- **Fix risk:** low

### G109-F06 — Do not mechanically apply PD010 / PD011 / NPY002 rewrites; apply autofixable PD002 / NPY201 one at a time with golden checks
- **Grade:** A · **Verdict:** CORRECTED. The researcher framed these as Ruff "autofixes". Ruff's rule index shows **no automatic fix** for PD010, PD011 or NPY002 (no 🛠️ marker). PD002 and NPY201 are the ones marked fixable. The hazard is an agent hand-applying the rule message ("provides same functionality") as if it were an equivalence.
- **Rationale:**
  - **PD010 (pivot/unstack→pivot_table):** pivot raises on duplicate index/column pairs, while pivot_table silently aggregates them with the default mean. The rewrite changes values and hides a duplication bug.
  - **PD011 (.values→.to_numpy()):** for tz-aware data, `.values` is UTC datetime64 while `.to_numpy()` is an object array of tz-aware Timestamps. For categoricals, `.values` is a Categorical. For pandas 3 `str`, `.values` is an ArrowStringArray.
  - **NPY002 (legacy RNG→Generator):** gives different random streams.
- **Evidence:**
  - [Ruff rules index](https://docs.astral.sh/ruff/rules/) — Astral, 2026 — official_docs — PD010 ".pivot_table is preferred to .pivot or .unstack; provides same functionality"; PD011 "Use .to_numpy() or .array instead of .values"; PD002 and NPY201 marked "🛠️ Automatic fix available", while PD010, PD011 and NPY002 carry no fix marker; PD901 "Rule was removed in 0.13.0"; PLW0177 stable since 0.12.0 — verified by parsing the index HTML.
  - [Ruff PD010 page](https://docs.astral.sh/ruff/rules/pandas-use-of-dot-pivot-or-unstack/) — Astral, 2026 — official_docs — ".pivot_table is more general and can be used to implement the same behavior as .pivot and .unstack" — verified.
  - [pandas.DataFrame.pivot](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.pivot.html) — pandas dev team, 2026 — official_docs — "ValueError: Index contains duplicate entries, cannot reshape"; pivot_table is a "Generalization of pivot that can handle duplicate values for one index/column pair." — verified.
  - [pandas.Series.values](https://pandas.pydata.org/docs/reference/api/pandas.Series.values.html) and [pandas.Series.to_numpy](https://pandas.pydata.org/docs/reference/api/pandas.Series.to_numpy.html) — pandas dev team, 2026 — official_docs:
    - `.values` example: "Timezone aware datetime data is converted to UTC", e.g. `'2013-01-01T05:00:00'` for US/Eastern midnight;
    - `to_numpy(dtype=object)` gives `Timestamp('2000-01-01 00:00:00+0100', tz='CET')`.
    — verified.
  - [Random Generator: what's new or different](https://numpy.org/doc/stable/reference/random/new-or-different.html) — NumPy developers, 2026 — official_docs — "Because of the change in algorithms, it is not possible to reproduce the exact random values using Generator for these distributions or any distribution method that relies on them." — verified. *Correction:* the page says RandomState defaults to MT19937 but does not state Generator's default BitGenerator (PCG64 via `default_rng` is documented elsewhere), so the PCG64 claim was removed from this quote.
  - Verifier reproduction (pandas 3.0.6):
    - tz-aware `.values` has dtype `datetime64[us]` with the value `1999-12-31T23:00`, while `.to_numpy()` is object dtype holding `2000-01-01 00:00+01:00`;
    - categorical `.values` is a `Categorical`, while `.to_numpy()` is an `ndarray`;
    - `str` `.values` is an `ArrowStringArray`, while `.to_numpy()` is an object `ndarray`;
    - pivot raises on duplicates, while pivot_table averages them (1 and 3 become 2.0).
- **Detect:** `ruff check --select PD,NPY,PLW0177 --no-fix --output-format concise .`.
  - For each PD011 hit, check the dtype: tz-aware datetime, category or `str` needs a manual decision.
  - For each PD010 hit, check `df.duplicated([index, columns]).any()` on real data.
  - Apply PD002 and NPY201 fixes one at a time, each followed by a golden check (F20).
- **Tools:** Ruff (PD, NPY, PLW0177); golden-output harness.
- **Applies to:** pandas, NumPy.
- **When not to apply / counterpoints:**
  - Most PD rules are style-only and low value.
  - PD011's motivation (".values is ambiguous") is valid; only mechanical application is the problem.
  - pivot_table with an explicit `aggfunc` may be intentional.
- **Fix risk:** high

### G109-F08 — Keep integer-like columns integral when missing values appear (nullable dtypes, IDs as strings)
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - `reindex`, left/outer merges, `shift`, `where` and unstack introduce NaN. That coerces int64 columns to float64.
  - IDs above 2^53 (exchange trade IDs, ns epochs) then lose precision silently and later fail to join or deduplicate.
  - `fillna(0).astype(int)` erases the difference between missing and zero.
- **Evidence:**
  - [Nullable integer data type](https://pandas.pydata.org/docs/user_guide/integer_na.html) — pandas dev team, 2026 (docs 3.0.6) — official_docs — "Because NaN is a float, this forces an array of integers with any missing values to become floating point."; "Some integers cannot even be represented as floating point numbers."; "IntegerArray is currently experimental. Its API or implementation may change without warning." — verified; the experimental note is still present in 3.0.6.
  - [Working with missing data](https://pandas.pydata.org/docs/user_guide/missing_data.html) — pandas dev team, 2026 — official_docs — `pd.Series([1, 2], dtype=np.int64).reindex([0, 1, 2])` becomes float64; with `dtype="Int64"` it stays Int64 with `<NA>` — verified.
- **Detect:**
  1. Snapshot `df.dtypes` before and after each merge/reindex/shift, and flag int→float transitions.
  2. `(s.dropna() > 2**53).any()` on ID columns.
  3. ast-grep `$X.fillna($V).astype(int)`, `$X.fillna($V).astype('int64')`.
  4. `read_csv` calls without `dtype=` for ID columns (F10).
- **Tools:** runtime dtype snapshots, ast-grep, pandera dtype checks.
- **Applies to:** pandas with NumPy-backed dtypes. polars integers are natively nullable, but converting to pandas or NumPy reintroduces the problem.
- **When not to apply / counterpoints:**
  - IntegerArray is still marked experimental.
  - `pd.NA` propagates in comparisons, and some NumPy/sklearn code rejects extension arrays.
  - The dtype migration itself can change outputs, so report first.
- **Fix risk:** medium

### G109-F09 — Treat implicit index alignment as a hazard; assert index equality before combining objects from different frames
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Series arithmetic and `df['c'] = other` align on labels. After a filter, sort, `dropna` or `reset_index` on one side, mismatched labels silently become NaN or pair the wrong rows.
  - In polars, which has no index, positional combination is safe only with `maintain_order` or an explicit sort (F02).
- **Evidence:**
  - [Intro to data structures](https://pandas.pydata.org/docs/user_guide/dsintro.html) — pandas dev team, 2026 — official_docs — "The result of an operation between unaligned Series will have the union of the indexes involved. If a label is not found in one Series or the other, the result will be marked as missing NaN."; "When inserting a Series that does not have the same index as the DataFrame, it will be conformed to the DataFrame's index" (the `df["one_trunc"] = df["one"][:2]` example yields NaN rows) — verified.
- **Detect:**
  1. After each cross-frame assignment, compare `out[col].isna().sum()` with the source's NaN count.
  2. Add `a.index.equals(b.index)` assertions in tests.
  3. Review `df[$C] = $OTHER[...]` where $OTHER was filtered, sorted or reset (ast-grep `$D[$C] = $O`).
  4. Review `pd.concat(axis=1)` on frames with different indexes.
- **Tools:** runtime NaN counters, ast-grep, pytest assertions.
- **Applies to:** pandas; polars positional operations.
- **When not to apply / counterpoints:**
  - Alignment is often intended.
  - Switching to `.to_numpy()` removes a safety net.
  - Fix only where the intent is clear.
- **Fix risk:** medium

### G109-F10 — Pin types and missing-value parsing at every load boundary; log every coercion
- **Grade:** A · **Verdict:** CORRECTED. The `to_datetime(errors='coerce')` quote was reworded to the doc's actual text, "invalid parsing will be set as NaT". The researcher's "silently set" wording is not in the page.
- **Rationale:** Load-time inference is where silent type and NaN changes enter a pipeline:
  - default NA tokens such as 'NA', 'null' and 'None' become NaN;
  - `low_memory` chunking can infer mixed types;
  - polars infers the schema from 100 rows;
  - coercion flags turn bad values into NaN, NaT or null.
  Undocumented sentinel values keep the tools running on wrong data. Breck et al. report a production case where a backend emitting '-1' was the culprit.
- **Evidence:**
  - [IO tools: NA values](https://pandas.pydata.org/docs/user_guide/io.html) — pandas dev team, 2026 — official_docs — "The default NaN recognized values are ['-1.#IND', '1.#QNAN', '1.#IND', '-1.#QNAN', '#N/A N/A', '#N/A', 'N/A', 'n/a', 'NA', '<NA>', '#NA', 'NULL', 'null', 'NaN', '-NaN', 'nan', '-nan', 'None', '']" — verified verbatim.
  - [pandas.read_csv](https://pandas.pydata.org/docs/reference/api/pandas.read_csv.html) — pandas dev team, 2026 — official_docs — low_memory: "Internally process the file in chunks, resulting in lower memory use while parsing, but possibly mixed type inference. To ensure no mixed types either set False, or specify the type with the dtype parameter."; `keep_default_na` semantics — verified.
  - [polars.read_csv](https://docs.pola.rs/api/python/stable/reference/api/polars.read_csv.html) — Polars, 2026 — official_docs — `infer_schema_length` default 100, "The maximum number of rows to scan for schema inference"; `schema_overrides`; `ignore_errors` default False — verified.
  - [Data Smells in Public Datasets (CAIN '22)](https://arxiv.org/abs/2203.08007) — Shome, Cruz, van Deursen, 2022 — peer_reviewed — "analyse 25 public datasets and identify 14 data smells"; "Usage of undocumented dummy encoding is however worse as the data analysis tool will continue to operate." — verified in the PDF text.
  - [pandas.to_datetime](https://pandas.pydata.org/docs/reference/api/pandas.to_datetime.html) — pandas dev team, 2026 — official_docs — "If 'coerce', then invalid parsing will be set as NaT." — verified (reworded).
  - [Data Validation for Machine Learning](https://mlsys.org/Conferences/2019/doc/2019/167.pdf) — Breck et al., SysML 2019 — peer_reviewed — "if the highest change in frequency is observed in value '-1' then this might be an issue with some backend failing and producing a default value. (This is an actual situation observed in one of our production pipelines.)" — verified.
- **Detect:**
  1. ast-grep `pd.read_csv($$$A)` without `dtype=`, and `pl.read_csv`/`pl.scan_csv` without `schema`/`schema_overrides`.
  2. `rg -n "errors=['\"]coerce|strict=False|ignore_errors=True|infer_schema_length="`.
  3. `pytest -W error::pandas.errors.DtypeWarning`.
  4. Profile each loaded frame once: dtypes, `isna().sum()`, sentinel value counts (-9999, -1, '?', 'NA'), and whitespace differences.
  5. Pin dtypes in a behaviour-preserving way: write today's inferred dtypes explicitly and assert that dtypes and values are identical before and after.
- **Tools:** ast-grep, ripgrep, pytest -W error, pandera/patito (F11).
- **Applies to:** pandas, polars; CSV/JSON/Excel loaders. Parquet and Arrow carry schemas and are lower risk.
- **When not to apply / counterpoints:**
  - Pinning today's inferred dtypes preserves behaviour; changing NA handling or coercion flags does not.
  - Strict schemas can break on benign upstream additions.
  - The benefit is concentrated on text formats.
- **Fix risk:** medium

### G109-F12 — Normalise time at the boundary: parse once into tz-aware UTC with explicit `format=` and `unit=`
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Datetime parsing fails silently or differently across versions:
  - before pandas 2.0, the day/month order could switch within one column;
  - `dayfirst` is not strict;
  - mixed offsets raise unless `utc=True`;
  - `format='mixed'` is "risky";
  - pandas 3.0 changed resolution inference, the timezone backend and `Day` arithmetic across DST;
  - polars 1.0 converts rather than replaces the timezone in the constructor.
  Mixing naive and aware, or local and UTC, times shifts features by hours; in backtests that becomes look-ahead.
- **Evidence:**
  - [pandas.to_datetime](https://pandas.pydata.org/docs/reference/api/pandas.to_datetime.html) — pandas dev team, 2026 — official_docs — "Parsing datetimes with mixed time zones will raise a ValueError unless utc=True"; "dayfirst=True is not strict, but will prefer to parse with day first."; "'mixed', to infer the format for each element individually. This is risky, and you should probably use it along with dayfirst." — verified.
  - [PDEP-4](https://pandas.pydata.org/pdeps/0004-consistent-to-datetime-parsing.html) — pandas dev team, 2022 — standard — as in F04 — verified.
  - [What's new in 3.0.0](https://pandas.pydata.org/docs/whatsnew/v3.0.0.html) — pandas dev team, 2026 — official_docs — zoneinfo is the default timezone; the `Day` DST example; microsecond parsing default; `unit='s'` produces `datetime64[s]` — verified.
  - [Upgrade guide: Version 1 (polars)](https://docs.pola.rs/releases/upgrade/1/) — Polars, 2024 — official_docs — "always converting to the time zone specified in the data type" (00:00 CET becomes 01:00 CET) — verified.
  - [Ruff DTZ005](https://docs.astral.sh/ruff/rules/call-datetime-now-without-tzinfo/) — Astral, 2026 — official_docs — "a naive object does not contain enough information to unambiguously locate itself relative to other datetime objects"; use `datetime.now(tz=datetime.UTC)` — verified.
  - Verifier reproduction (pandas 3.0.6): an epoch-milliseconds value parsed with `unit="s"` silently gives `55840-11-08` (dtype `datetime64[s]`) with **no** OutOfBoundsDatetime error. Seconds parsed with `unit="ms"` silently give `1970-01-20`. This resolves the researcher's open question: only the plausible-range assertion below catches unit mistakes.
- **Detect:**
  1. `ruff check --select DTZ`.
  2. ast-grep:
     - `pd.to_datetime($X)` with no keyword arguments;
     - `format='mixed'`;
     - `errors='coerce'`;
     - `pd.to_datetime($X, unit=$U)`, then check the unit against the source API's docs;
     - `tz_localize(None)`.
  3. Runtime assertions after load:
     - the column is tz-aware UTC;
     - it is monotonic where expected;
     - there are no NaT values;
     - **min and max fall within a plausible date range**.
- **Tools:** Ruff DTZ, ast-grep, runtime assertions / pandera.
- **Applies to:** pandas, polars, Python datetime; trading and backtest data.
- **When not to apply / counterpoints:**
  - Converting naive-local data to UTC shifts values, so migrate with golden diffs.
  - Session logic may legitimately need local exchange time; store UTC and derive local fields.
  - An explicit `format=` equal to the inferred one preserves behaviour; verify it on the full column.
- **Fix risk:** high

### G109-F15 — Make randomness and model configuration explicit and recorded
- **Grade:** A · **Verdict:** CORRECTED. The researcher said to create `rng = np.random.default_rng(seed)` and pass it "to splitters, samplers and estimators". scikit-learn's `random_state` accepts only None, an int or a `np.random.RandomState` (`check_random_state`: "Otherwise raise ValueError"), so a NumPy `Generator` cannot be passed to sklearn. The corrected rule has three parts:
  - use a `Generator` for your own NumPy sampling;
  - pass an int seed, or a `RandomState` as sklearn's docs show, to sklearn;
  - pass `random_state=` (which accepts a Generator) to pandas `sample`, and `seed=` to polars `sample`.
- **Rationale:**
  - Uncontrolled randomness makes results irreproducible and hides regressions.
  - Default hyperparameters "may change in new versions of the library" (Zhang et al.).
  - Migrating legacy `np.random.*` to `Generator` changes the stream even with the same seed. Regenerate golden outputs deliberately.
- **Evidence:**
  - [Common pitfalls: controlling randomness](https://scikit-learn.org/stable/common_pitfalls.html) — scikit-learn developers, 2026 (v1.9.1) — official_docs — "In order to obtain reproducible (i.e. constant) results across multiple program executions, we need to remove all uses of random_state=None, which is the default."; the example uses `rng = np.random.RandomState(0)` — verified.
  - [sklearn.utils.check_random_state](https://scikit-learn.org/stable/modules/generated/sklearn.utils.check_random_state.html) — scikit-learn developers, 2026 — official_docs — "seed: None, int or instance of RandomState ... Otherwise raise ValueError." — added by the verifier for the correction.
  - [pandas.DataFrame.sample](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.sample.html) — pandas dev team, 2026 — official_docs — "random_state: int, array-like, BitGenerator, np.random.RandomState, np.random.Generator ... Default None results in sampling with the current state of np.random." — added by the verifier.
  - [polars.DataFrame.sample](https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.sample.html) — Polars, 2026 — official_docs — "seed: ... If set to None (default), a random seed is generated for each time the sample is called." — added by the verifier.
  - [Ruff NPY002 numpy-legacy-random](https://docs.astral.sh/ruff/rules/numpy-legacy-random/) — Astral, 2026 — official_docs — legacy functions delegate to a "global singleton RandomState instance"; replace `np.random.seed(1337); np.random.normal()` with `rng = np.random.default_rng(1337); rng.normal()` — verified. No autofix.
  - [Random Generator: what's new or different](https://numpy.org/doc/stable/reference/random/new-or-different.html) — NumPy developers, 2026 — official_docs — "it is not possible to reproduce the exact random values using Generator" — verified.
  - [Code Smells for ML Applications, §4.11 and §4.14](https://arxiv.org/abs/2203.13746) — Zhang et al., 2022 — peer_reviewed — "these default parameters may change in new versions of the library"; Randomness Uncontrolled is classed under Reproducibility — verified.
- **Detect:**
  1. `ruff check --select NPY002` (report only).
  2. ast-grep: `train_test_split`, `KFold`, estimators and `$X.sample(...)` without `random_state=` or `seed=`.
  3. grep `np.random.seed(` and `random.seed(`.
  4. Run the pipeline twice and diff the golden outputs. Any difference is uncontrolled nondeterminism, which can also come from thread-order float sums (F20).
- **Tools:** Ruff NPY002, ast-grep, double-run diff.
- **Applies to:** NumPy, pandas, polars, scikit-learn; Monte Carlo and bootstrap backtests.
- **When not to apply / counterpoints:**
  - A single fixed seed can hide variance; report research claims over several seeds.
  - sklearn notes that passing RandomState instances rather than ints gives more robust CV estimates.
  - Adding a seed changes outputs from random to fixed.
- **Fix risk:** medium

### G109-F21 — Prefer reassignment over `inplace=True`; fix `df = df.m(..., inplace=True)` and chained-inplace bugs
- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  - **Not yet deprecated.** PDEP-8 is *accepted*, but pandas 3.0.0–3.0.6 has **not** deprecated `inplace` on drop/rename/dropna/sort_values etc. The 3.0.0 notes deprecate it only for `Resampler.interpolate`, and `drop(inplace=True)` emits no warning on 3.0.6 (verifier reproduction). The rule is therefore a readability and correctness preference ahead of a *planned* deprecation.
  - **Still returns None.** `df = df.dropna(inplace=True)` still binds None on pandas 3.0 for all methods outside PDEP-8's "values-inplace" group. The researcher's "before pandas 3.0" is true only for fillna/replace/where/mask/interpolate/ffill/bfill/clip.
- **Rationale:**
  - PDEP-8 plans to deprecate `inplace` for methods that never truly worked in place, with removal planned for 4.0.
  - pandas 3.0 already makes the values-inplace methods return `self`.
  - Ruff PD002 notes that inplace "does not provide a performance benefit" in many cases.
  - Zhang et al. catalogue "In-Place APIs Misused" as error-prone.
- **Evidence:**
  - [PDEP-8: In-place methods in pandas](https://pandas.pydata.org/pdeps/0008-inplace-methods-in-pandas.html) — pandas dev team, created 16 Feb 2023, status Accepted — standard:
    - keep `inplace` for where, fillna, replace, mask, interpolate, ffill, bfill, clip;
    - deprecate it for drop, rename, rename_axis, reset_index, set_index, dropna, drop_duplicates, sort_values, sort_index, eval, query;
    - timeline: a DeprecationWarning in the first release after acceptance, a FutureWarning during 3.x, removal in 4.0.
    — verified.
  - [What's new in 3.0.0](https://pandas.pydata.org/docs/whatsnew/v3.0.0.html) — pandas dev team, 2026 — official_docs — "Methods that can operate in-place (replace(), fillna(), ffill(), bfill(), interpolate(), where(), mask(), clip()) now return the modified DataFrame or Series (self) instead of None when inplace=True (GH 63207)"; the only inplace deprecation listed is "Deprecated the inplace keyword from Resampler.interpolate()" — verified by full-text search of the release notes.
  - [Ruff PD002](https://docs.astral.sh/ruff/rules/pandas-use-of-inplace-argument/) — Astral, 2026 — official_docs — "Fix is sometimes available."; "in many cases, inplace=True does not provide a performance benefit, as pandas will often copy DataFrames in the background." — verified.
  - [Code Smells for ML Applications, §4.7](https://arxiv.org/abs/2203.13746) — Zhang et al., 2022 — peer_reviewed — "Remember to assign the result of an operation to a variable or set the in-place parameter in the API." — verified.
  - Verifier reproduction (pandas 3.0.6): `dropna(inplace=True)` returns None; `fillna(0, inplace=True)` returns the same object; `drop(columns=..., inplace=True)` emits no warnings.
- **Detect:**
  1. `ruff check --select PD002`, applying fixes one at a time.
  2. ast-grep `$X = $Y.$M($$$, inplace=True)`, which binds None for non-values-inplace methods on every pandas version.
  3. ast-grep `$D[$C].$M($$$, inplace=True)`, the chained form that does nothing under CoW (F03).
  4. Find expression statements that discard the result of non-inplace methods, e.g. `df.dropna()` on its own line.
- **Tools:** Ruff PD002, ast-grep.
- **Applies to:** pandas.
- **When not to apply / counterpoints:**
  - Rewriting `df.m(inplace=True)` to `df = df.m()` changes aliasing. A caller that passed `df` into a function and expected mutation will no longer see it.
  - The values-inplace methods keep the keyword by design.
- **Fix risk:** low

### G109-F11 — Validate schemas after load and at stage boundaries: observe first (lazy, non-mutating), enforce later with hand-written schemas
- **Grade:** B · **Verdict:** VERIFIED. The current pandera release is 0.33.1; the researcher cited 0.33.0.
- **Rationale:**
  - This meets the user's "validate shape and types after loading" standard without changing behaviour on day one.
  - pandera's `validate()` can return a modified frame: `coerce=True` converts dtypes, `strict='filter'` drops columns, and `add_missing_columns` inserts columns.
  - Production evidence (Google TFX) supports validation but warns that overfitted schemas cause spurious alerts, which may lead teams to switch validation off.
  - Shankar et al. found false-positive alerts to be the most discussed pain point.
- **Evidence:**
  - [Data Validation for Machine Learning (SysML 2019)](https://mlsys.org/Conferences/2019/doc/2019/167.pdf) — Breck, Polyzotis, Roy, Whang, Zinkevich, 2019 — peer_reviewed — "Hundreds of product teams use our system"; "on-calls tend to ignore alerts that are either spammy or not actionable"; "an overfitted schema is more likely to cause spurious alerts ... and may even lead them to switch off data validation altogether." — verified in the PDF text.
  - [Operationalizing Machine Learning: An Interview Study](https://arxiv.org/abs/2209.09125) — Shankar, Garcia, Hellerstein, Parameswaran, 2022 — preprint (arXiv v1) — 18 MLEs; "The most commonly discussed pain point was false-positive alerts"; "A surplus of false-positive alerts led to fatigue and silencing of alerts" — verified in the PDF text.
  - [pandera: lazy validation](https://pandera.readthedocs.io/en/stable/lazy_validation.html) — pandera/Union.ai, 2026 (0.33.1 on PyPI) — official_docs — `lazy=True` collects errors into `SchemaErrors` with `failure_cases` — verified.
  - [pandera: DataFrame schemas](https://pandera.readthedocs.io/en/stable/dataframe_schemas.html) — pandera, 2026 — official_docs — "calling schema.validate will first coerce the column into the specified dtype before applying validation checks"; `strict='filter'`; `add_missing_columns` — verified.
  - [pandera: polars integration](https://pandera.readthedocs.io/en/stable/polars.html) and [configuration](https://pandera.readthedocs.io/en/stable/configuration.html) — pandera, 2026 — official_docs — on a LazyFrame "it only does validations at the schema-level, e.g. column names and data types" unless `PANDERA_VALIDATION_DEPTH=SCHEMA_AND_DATA`; "setting the environment variable PANDERA_VALIDATION_ENABLED=False" disables validation (configuration page) — verified.
  - [patito documentation](https://patito.readthedocs.io/en/latest/) — JakobGM/patito (0.8.6 on PyPI), 2026 — official_docs — "declare pydantic data models which double as schema for your polars data frames" — verified. The maintainer attribution is corrected to JakobGM.
- **Detect:**
  1. List load sites (`pd.read_*`, `pl.read_*`, `pl.scan_*`) and check whether a `.validate(` follows.
  2. In existing schemas, grep `coerce=True|strict=['\"]filter|add_missing_columns=True`; these mutate data.
  3. Phase-1 wrapper: call `schema.validate(df, lazy=True)` inside try/except `SchemaErrors`, log `len(e.failure_cases)`, and continue with the original `df`.
- **Tools:** pandera (pandas and polars), patito (polars), structured logging.
- **Applies to:** pandas and polars pipelines, data loaders, backtest input data.
- **When not to apply / counterpoints:**
  - The evidence comes from Google-scale pipelines and is extrapolated to small repos, hence grade B.
  - Validation costs runtime.
  - LazyFrame data checks force a collect.
  - Enforcing too early breaks pipelines on benign drift.
- **Fix risk:** low

### G109-F14 — In time-series and backtest code, report look-ahead signals and add a truncation-invariance test
- **Grade:** B · **Verdict:** CORRECTED. Four changes:
  - The TimeSeriesSplit quote was replaced with the current doc text; the researcher's wording does not appear in the 1.9.1 page.
  - The Kapoor citation now points to the peer-reviewed Patterns version.
  - The QuantStart page shows no date, so "2014" is unconfirmed.
  - The Bailey et al. venue was confirmed as the Journal of Computational Finance.
- **Rationale:**
  - Temporal leakage means building a model with data "from the future" (Kapoor & Narayanan, L3.1). QuantStart lists index offsets (N+k), whole-dataset parameter fitting and same-bar highs/lows as typical causes.
  - Several documented defaults make look-ahead easy to write:
    - intraday resample and `group_by_dynamic` label left;
    - rolling `center` is just a flag;
    - as-of joins allow exact matches;
    - `train_test_split` shuffles by default.
  - These bugs produce false alpha rather than crashes.
  - Bailey et al. note that published backtests "almost never declare the number of trials", so record how many configurations were tried.
- **Evidence:**
  - [Leakage and the Reproducibility Crisis in ML-based Science — taxonomy L3.1](https://arxiv.org/abs/2207.07048) — Kapoor & Narayanan, 2022 (peer-reviewed version: [Patterns 4(9), 2023](https://doi.org/10.1016/j.patter.2023.100804)) — preprint plus peer_reviewed — "[L3.1] Temporal leakage ... the model is built using data 'from the future'" — verified in the arXiv text.
  - [Successful Backtesting of Algorithmic Trading Strategies, Part I](https://www.quantstart.com/articles/Successful-Backtesting-of-Algorithmic-Trading-Strategies-Part-I/) — QuantStart, undated on page — engineering_blog — "Incorrect offsets of these indices can lead to a look-ahead bias by incorporating data at N+k for non-zero k"; whole-dataset regression coefficients "retroactively applied"; "It is always necessary to lag high/low values by at least one period"; survivorship bias as "just another specific case of look-ahead bias" — verified.
  - [pandas.DataFrame.resample](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.resample.html) and [rolling](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.rolling.html) — pandas dev team, 2026 — official_docs — label/closed: "The default is 'left' for all frequency offsets except for 'ME', 'YE', 'QE', 'BME', 'BA', 'BQE', and 'W'"; rolling center default False, and "If True, set the window labels as the center of the window index." — verified.
  - [polars.DataFrame.group_by_dynamic](https://docs.pola.rs/api/python/stable/reference/dataframe/api/polars.DataFrame.group_by_dynamic.html) — Polars, 2026 — official_docs — `label='left'`, "lower boundary of the window"; `closed='left'` — verified.
  - [TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) and [train_test_split](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.train_test_split.html) — scikit-learn developers, 2026 (1.9.1) — official_docs — "Provides train/test indices to split time-ordered data, where other cross-validation methods are inappropriate, as they would lead to training on future data and evaluating on past data."; `gap` "Number of samples to exclude from the end of each train set before the test set"; `shuffle` default True — verified (quote corrected).
  - [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) — Bailey, Borwein, López de Prado, Zhu, author copy revised Feb 2015; published in the Journal of Computational Finance (DOI 10.21314/jcf.2016.322, per Crossref) — peer_reviewed — "Backtests published in academic or practitioners' publications almost never declare the number of trials involved in a discovery."; example PBOs of 74% and 0.04% — verified in the PDF text. Used as context only.
- **Detect:**
  1. ast-grep patterns:
     - `$X.shift(-$N)`, `shift(periods=-$N)`;
     - `rolling($$$, center=True)`, `FixedForwardWindowIndexer`;
     - `bfill`, `fillna(method='bfill')`, `fill_null(strategy='backward')`;
     - `interpolate`;
     - as-of joins with `forward`/`nearest`;
     - `resample`/`group_by_dynamic` (check how the label is consumed);
     - `train_test_split` without `shuffle=False` in time-series modules; `KFold`/`cross_val_score` on time-indexed data;
     - full-frame `StandardScaler().fit` and global z-scores.
  2. Confirm that each negative shift builds only the label.
  3. Truncation-invariance test: `full = features(df); part = features(df[df.ts <= T]); assert_frame_equal(full[full.ts <= T], part, check_exact=True)`, run for several values of T. This is a derived check, not a published, validated tool.
  4. For every external dataset, check that event time is not confused with publication time.
- **Tools:** ast-grep, pytest truncation-invariance test, pandas/polars `assert_frame_equal`, sklearn `TimeSeriesSplit(gap=...)`.
- **Applies to:** pandas, polars, NumPy; backtests, time-series ML, trading research notebooks.
- **When not to apply / counterpoints:**
  - Negative shifts are legitimate for labels.
  - Centred windows are fine for plots.
  - Exact matches are correct when timestamps mark availability.
  - Static patterns and the truncation test cannot see publication lags, vendor revisions or survivorship.
  - No prevalence study exists; the grade reflects documented mechanisms plus a peer-reviewed taxonomy.
  - Fixes usually make backtest results worse, so keep them report-only.
- **Fix risk:** high

### G109-F17 — Lint notebooks with notebook-aware configuration and report, not bulk-fix
- **Grade:** B · **Verdict:** VERIFIED. The venues were confirmed via Crossref: Grotov et al. at MSR 2022 and Wang et al. at ICSE-NIER 2020.
- **Rationale:**
  - Notebook code carries more issues than scripts, so it should not be excluded from linting.
  - Ruff ≥ 0.6.0 lints and formats .ipynb files by default and adapts some rules per cell; for example, E402 checks imports at the top of a cell.
  - Bulk formatting or fixing rewrites the JSON and interacts with hidden state (F16).
- **Evidence:**
  - [Ruff configuration: Jupyter Notebook discovery](https://docs.astral.sh/ruff/configuration/) — Astral, 2026 — official_docs — "Ruff has built-in support for linting and formatting Jupyter Notebooks, which are linted and formatted by default on version 0.6.0 and higher."; opt out via `extend-exclude = ["*.ipynb"]`; `"*.ipynb" = ["T20"]`; for notebooks E402 "detects imports at the top of a cell" — verified.
  - [nbQA README](https://nbqa.readthedocs.io/en/latest/readme.html) — nbQA-dev, 2026 (1.9.1 on PyPI) — official_docs — "Run ruff, isort, pyupgrade, mypy, pylint, flake8, black, blacken-docs, and more on Jupyter Notebooks" — verified.
  - [A Large-Scale Comparison of Python Code in Jupyter Notebooks and Scripts](https://arxiv.org/abs/2203.16718) — Grotov, Titov, Sotnikov, Golubev, Bryksin (JetBrains Research), MSR 2022 (DOI 10.1145/3524842.3528447) — peer_reviewed — 847,881 notebooks; "notebooks tend to have 1.4 times more stylistic issues, but ... some of them are caused by specific coding practices in notebooks and should be considered as false positives" — verified in the PDF text.
  - [Better Code, Better Sharing: On the Need of Analyzing Jupyter Notebooks](https://arxiv.org/abs/1906.05234) — Wang, Li, Zeller, ICSE-NIER 2020 (DOI 10.1145/3377816.3381724) — peer_reviewed — 1,982 notebooks / 202,332 LOC; "the PEP8 checker yields 73,371 errors, giving a ratio of 36.26%"; "803 notebooks (out of the 1,982) contain code with unused variables" — verified in the PDF text.
- **Detect:**
  - `ruff check . --output-format concise`, and confirm that .ipynb files appear in the output (`--show-files`).
  - `nbqa mypy notebooks/`.
  - Review `extend-exclude` entries for ipynb.
- **Tools:** Ruff ≥ 0.6, nbQA, mypy.
- **Applies to:** Jupyter notebooks.
- **When not to apply / counterpoints:**
  - Some notebook idioms are flagged falsely, as Grotov et al. note.
  - Formatting notebooks produces large diffs unless paired with jupytext.
- **Fix risk:** low

### G109-F20 — Build a golden-output (characterisation) harness before any pipeline or notebook refactor
- **Grade:** B · **Verdict:** CORRECTED. Two quotes were replaced with verified text:
  - The dbt quote "your refactored model should produce the same results as the original" was not found in the current guide.
  - The audit-helper wording "checking that a refactored model ... are identical" was not found in the README.
- **Rationale:**
  - Characterisation (golden-master) testing pins the *actual* behaviour of code without specs, which describes most finished research pipelines.
  - dbt's legacy-SQL refactoring guide states the discipline: move logic, do not change it, and defer fixes because "More changes = more auditing work". Outputs are audited with audit_helper.
  - The library assertion helpers provide the tolerance semantics.
  - NumPy documents that float summation precision varies, which justifies tight float tolerances and nothing looser.
  - Any diff stops the refactor until it is classified as an intended fix or a regression. Never loosen tolerances to make a diff pass.
- **Evidence:**
  - [Characterization test](https://en.wikipedia.org/wiki/Characterization_test) — Wikipedia (term coined by Michael Feathers, *Working Effectively with Legacy Code*), 2026 — other — "a characterization test (also known as Golden Master Testing) is a means to describe (characterize) the actual behavior of an existing piece of software" — verified. This is a tertiary source; the book itself was not re-checked here.
  - [Refactoring legacy SQL to dbt](https://docs.getdbt.com/guides/refactoring-legacy-sql) — dbt Labs, 2026 — engineering_blog — "While refactoring you'll be moving around a lot of logic, but ideally you won't be changing the logic. More changes = more auditing work, so if you come across anything you'd like to fix, try your best to card that up for another time"; step 6, "Audit the output of dbt models vs. legacy SQL" with audit_helper — verified (quote corrected).
  - [dbt-audit-helper](https://github.com/dbt-labs/dbt-audit-helper) — dbt Labs, 2026 (not archived) — official_docs — `quick_are_queries_identical` "can efficiently provide reassurance that a refactor introduced no changes"; the `compare_relations` example shows in_a/in_b = 6,870 both (99.74%), 9 only in A, 9 only in B — verified (quote corrected).
  - [pandas.testing.assert_frame_equal](https://pandas.pydata.org/docs/reference/api/pandas.testing.assert_frame_equal.html) — pandas dev team, 2026 (3.0.6) — official_docs — rtol 1e-5, atol 1e-8, check_dtype True; check_exact "Changed in version 2.2.0: Defaults to True for integer dtypes if none of check_exact, rtol and atol are specified"; `check_like` ignores the order of index and columns — verified.
  - [polars.testing.assert_frame_equal](https://docs.pola.rs/api/python/stable/reference/api/polars.testing.assert_frame_equal.html) — Polars, 2026 — official_docs — check_row_order True, check_dtypes True, check_exact False, rel_tol 1e-05, abs_tol 1e-08, categorical_as_str False; "Changed in version 1.32.3: The rtol and atol parameters were renamed to rel_tol and abs_tol" — verified.
  - [DataComPy](https://capitalone.github.io/datacompy/) — Capital One, 2026 (v1.0.4) — official_docs — "a replacement for SAS's PROC COMPARE"; reports rows unique to each side; backends are pandas, Polars, Spark and Snowflake; v0.19.x is no longer maintained — verified.
  - [pytest-regressions API](https://pytest-regressions.readthedocs.io/en/latest/api.html) — ESSS, 2026 — official_docs — `check(data_frame, ..., tolerances=..., default_tolerance=...)`, e.g. `default_tolerance=dict(atol=1e-7, rtol=1e-18)` — verified.
  - [pandas.util.hash_pandas_object](https://pandas.pydata.org/docs/reference/api/pandas.util.hash_pandas_object.html) — pandas dev team, 2026 — official_docs — "Return a data hash of the Index/Series/DataFrame"; `index` defaults to True; returns a Series of uint64 — verified.
- **Detect:**
  1. Look for tests that use `assert_frame_equal`, `dataframe_regression`, `datacompy` or parquet fixtures. If there are none, build a harness before refactoring.
  2. Capture, per stage:
     - shape, columns and order;
     - dtypes;
     - null and NaN counts;
     - key uniqueness;
     - numeric min/max/sum/mean;
     - `int(pd.util.hash_pandas_object(df, index=True).sum())`.
     In polars, use `null_count()`, `describe()` and `schema`.
  3. Run the unchanged code twice. If the two runs differ, fix the nondeterminism (F15) first.
- **Tools:** pandas.testing/polars.testing, pytest-regressions, datacompy, `hash_pandas_object`, parquet snapshots.
- **Applies to:** pandas, polars and NumPy pipelines; notebooks (combine with nbval).
- **When not to apply / counterpoints:**
  - A golden master also freezes today's bugs. Regenerate it deliberately, with a changelog entry, when a fix is meant to change output (F03, F07, F13, F14).
  - Hashes are order- and dtype-sensitive; use them as a fast screen, then compare sorted data with tolerances.
  - Sampling large inputs lowers sensitivity.
- **Fix risk:** low

### G109-F22 — Calibrate trust in automated detectors; a clean Ruff run is not evidence of dataframe correctness
- **Grade:** B · **Verdict:** CORRECTED. Tool-status facts were added:
  - dslinter's last release was 2.0.9 on 2022-06-17 (last push 2022-06-30). It pins `pylint>=2.12.2,<2.13`, `astroid>=2.9.3,<2.10` and `mypy==0.931.*`, whose PyPI classifiers stop at Python 3.10. Python 3.10 reaches end-of-life in Oct 2026, and pandas 3 needs Python ≥ 3.11. So dslinter can only run in an isolated legacy environment, and its current usefulness is unproven.
  - leakage-analysis requires Python 3.8, end-of-life since 2024-10-07; its last push was 2023-05-02.
- **Rationale:**
  - **Ruff** covers NaN comparison (PLW0177), NumPy 2 removals (NPY201), legacy RNG (NPY002), inplace (PD002) and `.values` (PD011). It has no rule for merge cardinality, chained assignment, groupby dropna, index alignment or look-ahead.
  - **dslinter** adds rules R5505, W5502, R5503, E5501, W5518, W5505 and R5506, but publishes no precision or recall and is unmaintained.
  - **leakage-analysis** is the only detector with published accuracy.
  - Zhang et al. note that API-specific smells are mostly documented in grey literature.
  - Fill the gaps with ast-grep rules, warnings-as-errors test runs and runtime invariants.
- **Evidence:**
  - [Ruff rules index](https://docs.astral.sh/ruff/rules/) — Astral, 2026 — official_docs — PD rules: PD002, PD003, PD004, PD007–PD013, PD015, PD101 (PD901 removed in 0.13.0); NPY001–NPY003 and NPY201; PLW0177. No merge-validate or chained-assignment rule — verified by parsing the index.
  - [dslinter README](https://github.com/Hynn01/dslinter) — Haiyin Zhang (TU Delft), 2022 — official_docs — lists chain-indexing-pandas W5502, datatype-pandas R5503, merge-parameter-pandas R5505, inplace-pandas W5503, dataframe-conversion-pandas W5504, nan-numpy E5501, scaler-missing-scikitlearn W5505, hyperparameters-scikitlearn R5506, pipeline-not-used-scikitlearn W5518; run with `pylint --load-plugins=dslinter`; no accuracy figures — verified. The [PyPI metadata](https://pypi.org/project/dslinter/) shows 2.0.9 (2022-06-17) and the pylint/astroid pins — added by the verifier.
  - [leakage-analysis README](https://github.com/malusamayo/leakage-analysis) — Chenyang Yang (CMU), 2022 — official_docs — `python3 -m src.main /path/to/file`, `python3 -m src.run /path/to/dir`; requires Python 3.8, Souffle and a custom pyright submodule; Docker option — verified. The GitHub API shows the last push on 2023-05-02 and the repo is not archived.
  - [Code Smells for Machine Learning Applications](https://arxiv.org/abs/2203.13746) — Zhang, Cruz, van Deursen, 2022 — peer_reviewed — "22 machine learning-specific code smells"; "16 smells are generic smells, while 6 are API-specific smells"; "most API-related smells are only reported by grey literature" — verified in the PDF text.
  - [Python devguide: versions](https://devguide.python.org/versions/) — PSF, 2026 — official_docs — 3.8 end-of-life 2024-10-07; 3.10 security support until 2026-10 — added by the verifier.
- **Detect:** Run the detector set in report mode:
  - `ruff check --select PD,NPY,PLW0177,DTZ --no-fix .`;
  - the custom ast-grep rule pack for F01/F02/F03/F10/F12/F14;
  - `pytest -W error::pandas.errors.ChainedAssignmentError -W error::pandas.errors.DtypeWarning`;
  - leakage-analysis in Docker for ML notebooks;
  - dslinter only in a separate Python ≤ 3.10 environment, with its output treated as unvalidated hints.
- **Tools:** Ruff, ast-grep, pytest -W error, leakage-analysis (Docker), dslinter (legacy environment only), nbQA.
- **Applies to:** pandas, polars, NumPy, notebooks.
- **When not to apply / counterpoints:**
  - Custom ast-grep patterns are syntactic and cannot see dtypes or data. Expect false positives such as `str.join`.
  - The two research tools are unmaintained research prototypes.
- **Fix risk:** low

### G109-F18 — Never strip notebook outputs in a hardening pass without approval; offer non-destructive diff tooling
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - nbstripout is designed as a git filter or pre-commit hook for users who do not want to track outputs. Once stripped versions are committed, the outputs are not in history. This follows from the tool's design and is not a quoted claim.
  - For research and backtest notebooks, saved figures and tables may be the only record of a result.
  - jupytext pairing and nbdime solve the diff problem without data loss.
- **Evidence:**
  - [nbstripout README](https://github.com/kynan/nbstripout) — kynan, 2026 (v0.9.1, released 2026-02-21) — official_docs — "Intended to be used as a Git filter or pre-commit hook for users who don't want to track output in Git."; `--keep-output` "Do not strip the output, only metadata"; `--dry-run` "Do a dry run and only list which files would have been stripped"; `--verify` fails if any files would be stripped — verified.
  - [Jupytext README](https://github.com/mwouts/jupytext) — Marc Wouts, 2026 — official_docs — "Only the notebook inputs (and optionally, the metadata) are included. Text notebooks are well suited for version control"; `jupytext --set-formats ipynb,py:percent notebook.ipynb`; `--sync` — verified.
  - [nbdime documentation](https://nbdime.readthedocs.io/en/latest/) — Jupyter, 2026 — official_docs — "content-aware" diff and merge; "auto-resolving conflicts on generated values such as execution counters"; `nbdime config-git --enable --global` — verified.
- **Detect:**
  1. Check `.gitattributes` for `filter=nbstripout` and pre-commit for nbstripout hooks.
  2. Run `nbstripout --dry-run notebooks/*.ipynb`.
  3. Check whether each notebook with outputs has a paired .py or .md.
- **Tools:** nbstripout (dry-run/verify), jupytext, nbdime, nbval.
- **Applies to:** Jupyter notebooks in git.
- **When not to apply / counterpoints:**
  - Stripping outputs is a legitimate team choice: it avoids huge diffs, leaks and merge conflicts.
  - Committed outputs can leak secrets or PII; flag those separately.
  - Library-style notebooks whose outputs are regenerated in CI should be stripped.
- **Fix risk:** high

### G109-F19 — Extract shared or result-critical notebook logic into imported, tested modules (after F16 and F20)
- **Grade:** C · **Verdict:** CORRECTED. The researcher said "other participants put each pipeline component in a notebook". This is one participant (P18). Other participants (P6, and those preferring notebooks in production) described related benefits, while P10 and P15 opposed notebooks in production.
- **Rationale:**
  - Pimentel et al. recommend abstracting code into modules and testing it, because notebooks "are not packed together with tests".
  - Joel Grus: "how do you write tests for code that's in a notebook? not easily".
  - A Shankar et al. interviewee (P10) lost "a day and a half" to a notebook run with the wrong inputs.
  - Counter-evidence exists (nbdev, R Markdown's fresh-session model, P18). So the trigger is shared or result-critical logic, not notebooks in general.
- **Evidence:**
  - [Pimentel et al., best practice 3](https://leomurta.github.io/papers/pimentel2019a.pdf) — Pimentel et al., MSR 2019 — peer_reviewed — "3. Abstract code into functions, classes, and modules and test them ... This is especially serious because notebooks are not packed together with tests." — verified.
  - [I Don't Like Notebooks (JupyterCon 2018)](https://docs.google.com/presentation/d/1n2RlMdmv1p25Xy5thJUhkKGvjtV-dkAIsUXP-AL4ffI/) — Joel Grus, 2018 — talk — "notebooks have tons of hidden state that's easy to screw up and difficult to reason about"; "how do you write tests for code that's in a notebook? not easily" — verified via the slides' text export.
  - [Operationalizing Machine Learning: An Interview Study](https://arxiv.org/abs/2209.09125) — Shankar et al., 2022 — preprint — P10: "Someone would, you know, run something with the wrong sort of inputs from the notebook, and I'm [debugging] for like a day and a half. Then [I'd] figure out this was all garbage."; P18: "We put each component of the pipeline in a notebook, which has made my life so much easier." — verified.
  - [nbdev+Quarto: A new secret weapon for productivity](https://www.fast.ai/posts/2022-07-28-nbdev2.html) — Hamel Husain & Jeremy Howard (fast.ai), 28 Jul 2022 — engineering_blog — "A single notebook can create a python module, tests, CI, pypi/conda packages, and more"; "increased our productivity by 300% or more" (self-reported) — verified.
- **Detect:**
  1. `jupytext --to py` into a temp directory, then run a duplicate-code checker on the exports (e.g. `pylint --disable=all --enable=duplicate-code`).
  2. grep for join, feature, label and PnL function definitions inside notebooks.
  3. Check whether `src/` already has equivalents that the notebooks re-implement.
- **Tools:** jupytext, pylint duplicate-code, pytest, golden-output harness.
- **Applies to:** Jupyter notebooks feeding research or production.
- **When not to apply / counterpoints:**
  - Yihui Xie: "Jupyter is not an IDE"; R Markdown compiles in new sessions.
  - nbdev users test inside notebooks.
  - Extraction can change behaviour if the code relied on globals from earlier cells, which is why the F16 check comes first.
- **Fix risk:** medium

## Practitioner voice

All 11 URLs were opened. Three gists were corrected (dplyr, Shankar, Stata).

- [Joel Grus, "I Don't Like Notebooks" (JupyterCon 2018)](https://docs.google.com/presentation/d/1n2RlMdmv1p25Xy5thJUhkKGvjtV-dkAIsUXP-AL4ffI/) — "notebooks have tons of hidden state that's easy to screw up and difficult to reason about". His original complaint came from helping a newcomer whose confusion was "100% on account of messed up hidden state in their notebook due to normal beginner sloppiness and out-of-order execution". Also: "how do you write tests for code that's in a notebook? not easily".
- [Yihui Xie, "The First Notebook War" (10 Sep 2018)](https://yihui.org/en/2018/09/notebook-war/) — pushback. "Jupyter is not an IDE", and R Markdown documents "should be compiled in new R sessions, which will (mostly) get rid of the problems of hidden state and out-of-order execution".
- [fast.ai, nbdev2 (Husain & Howard, 2022)](https://www.fast.ai/posts/2022-07-28-nbdev2.html) — counterpoint: notebooks can produce modules, tests, CI and packages. The authors self-report a productivity gain of "300% or more".
- [Shankar et al., interview study of 18 ML engineers](https://arxiv.org/abs/2209.09125) — four points:
  - A notebook run "with the wrong sort of inputs" cost "a day and a half" and turned out "all garbage". The team then moved to non-notebook pipelines ("Eight months ago, we [realized] this was not working"). *Corrected:* the researcher's "garbage for months" is not in the text.
  - Leakage was "typically discovered after the model was deployed".
  - A flipped ground-truth bug "[would've been] almost impossible to discover" without code review.
  - False-positive alerts led to "fatigue and silencing of alerts".
- [Yang, Brower-Sinning, Lewis, Kästner (ASE '22)](https://www.cs.cmu.edu/~ckaestne/pdf/ase22.pdf) — the authors heard (personal communication) of "multiple cases where models were accidentally evaluated on training data producing entirely misleading results in research teams at BigTech companies". They found tutorials leaking "for the sake of simplicity", yet their re-runs "often just yielded marginal if any differences in accuracy".
- [Patrick Hoefler, "Copy-on-Write in pandas" (Dec 2022)](https://phofl.github.io/cow-introduction.html) — a pandas core developer: copy-vs-view behaviour was "hard to predict, even for experienced users". `df[df["score"] > 15]["user_id"] = 5` silently did nothing, with only a SettingWithCopyWarning.
- [QuantStart, "Successful Backtesting ... Part I"](https://www.quantstart.com/articles/Successful-Backtesting-of-Algorithmic-Trading-Strategies-Part-I/) — look-ahead enters through index offsets ("data at N+k"), through regression coefficients computed on the whole dataset and "retroactively applied", and through un-lagged highs/lows. Survivorship bias is "just another specific case of look-ahead bias".
- [dbt Labs, "Refactoring legacy SQL to dbt"](https://docs.getdbt.com/guides/refactoring-legacy-sql) — "ideally you won't be changing the logic. More changes = more auditing work". Defer fixes and audit the outputs with audit_helper: the golden-master discipline applied to SQL.
- [Davis Vaughan, "dplyr 1.1.0: Joins" (31 Jan 2023)](https://www.tidyverse.org/blog/2023/01/dplyr-1-1-0-joins/) — multiple matches in equality joins "are typically unexpected (even though they are baked in to SQL)". Setting `multiple = "error"` is suggested as "a quality control check for production code where you might rerun analyses with new data". The post's update note says dplyr 1.1.1 "alters the behavior of multiple match detection so that you see warnings much less often", and it now warns only on many-to-many. *Corrected:* the researcher's "could mask data issues" is not in the post.
- [StataCorp, [D] merge manual](https://www.stata.com/manuals/dmerge.pdf) — "m:m specifies a many-to-many merge and is a bad idea", and "Because m:m merges are such a bad idea, we are not going to show you an example." Stata's merge syntax makes users declare 1:1/m:1/1:m and offers `assert()` on match results. *Corrected:* the researcher's "decades of practice converged" generalisation was removed, and Stata's m:m is sequential pairing, not a Cartesian join.
- [Breck et al., Google TFX data validation (SysML 2019)](https://mlsys.org/Conferences/2019/doc/2019/167.pdf) — "on-calls tend to ignore alerts that are either spammy or not actionable". An overfitted schema "may even lead them to switch off data validation altogether". This is the argument for curated, report-first schemas.

## Contradictions and open questions

Contradictions:
- **Linter wording vs library semantics.** Ruff's PD010 message says `.pivot_table` "provides same functionality" as `.pivot`/`.unstack`. pandas docs show that pivot raises on duplicates while pivot_table silently aggregates them. PD011's `.to_numpy()` also differs from `.values` for tz-aware, categorical and pandas 3 `str` data. The library docs win. Ruff offers no autofix for these rules, so the risk lies with agents or humans hand-applying them.
- **NPY002 vs scikit-learn.** NPY002 and the NumPy docs push `np.random.default_rng()` / `Generator`, but scikit-learn 1.9.1's `random_state` accepts only None, an int or a `RandomState`. One "use Generator everywhere" rule cannot hold across the stack.
- **PDEP-8 vs shipped pandas.** PDEP-8 (accepted 2023) plans to deprecate `inplace` on drop/rename/dropna/sort_values etc., but pandas 3.0.0–3.0.6 ships no such deprecation. Guidance that says "pandas deprecates inplace" runs ahead of the releases.
- **Notebooks.** One side argues notebooks breed hidden-state bugs: Pimentel (24.11% ran without errors, 4.03% reproduced), Samuel & Mietchen (879 identical out of 10,388 re-run), Grus and Shankar's P10. On the other side are nbdev (a self-reported productivity gain), Yihui Xie and Shankar's P18. The evidence supports "verify in a fresh kernel and extract critical logic", not "ban notebooks".
- **Leakage severity.** Yang et al. detect leakage in 29.6% of notebooks but often see only marginal accuracy differences. The sklearn example (0.76 vs 0.5 on random labels) and Kapoor & Narayanan's civil-war case ("complex ML models do not perform substantively better than decades-old LR models" once errors are corrected) show that leakage can invalidate results entirely.
- **Merge smell classification.** Zhang et al. class "Merge API Parameter Not Explicitly Set" as a readability smell, while their own text says results "might silently go wrong", and dplyr and Stata treat cardinality as a correctness issue.
- **Validation standard vs alert fatigue.** The user's "always validate data shape and types after loading" standard conflicts with the TFX and Shankar evidence that noisy or auto-inferred validation gets ignored or switched off. The resolution is curated, phased validation.
- **Null-key joins.** pandas matches NaN keys to each other and polars does not. Code that looks equivalent returns different rows (reproduced by the verifier).
- **CoW warn mode.** pandas says warn mode is "very noisy" and only two categories must be fixed, which conflicts with a naive "fix every warning" policy.
- **Kapoor & Narayanan numbers.** arXiv v1 (2022) reports 17 fields, 329 papers, "errors". Patterns (2023, peer-reviewed) reports 17 fields, 294 papers, "leakage". The project site (2026) reports 30 fields, 41 review papers, 648 papers, "errors". Cite the version you use.
- **dplyr defaults.** dplyr's default changed between 1.1.0 (warn on any multiple match) and 1.1.1 (warn only on many-to-many).

Open questions:
- No published precision/recall exists for dslinter or the Ruff pandas-vet rules. dslinter is also pinned to pylint 2.12 / astroid 2.9 (Python ≤ 3.10), so its behaviour on pandas 3 code (Python ≥ 3.11) is untested.
- No empirical study measures how often join-cardinality bugs occur in real dataframe code. The evidence is docs, cross-ecosystem design (dplyr, Stata) and grey-literature smell catalogues.
- No study measures look-ahead prevalence in open-source backtesting or trading code. The truncation-invariance test is a derived check, not a validated tool, and no maintained static detector for time-series look-ahead was found.
- Epoch-unit mistakes on pandas 3.0.6 were reproduced locally: milliseconds parsed as `unit='s'` silently give the year 55840 and do not raise. This is the verifier's reproduction, not a documented statement. The pandas 3.0 notes do document the non-nanosecond resolution inference (`unit='s'` gives `datetime64[s]`) that makes this possible.
- polars `join(validate=...)` is documented as unsupported by the streaming engine (py-1.44.2). No supported cardinality check for streaming pipelines was found.
- The case that schema validation reduces defects comes from Google-scale production. Its cost-benefit for small solo research codebases is extrapolated.
- Practitioner coverage gap: the WebSearch budget was exhausted for both the researcher and the verifier, so no HN, Reddit or Stack Overflow threads on silent pandas merge bugs were verified.
- The Netflix papermill blog (outputs as immutable run records) remains unverified (HTTP 403 for the researcher; not re-attempted).
- The Shankar et al. interview study was verified as arXiv v1 (Sept 2022). A later peer-reviewed version may exist, but its venue was not verified here.

## Dropped findings

None of the 22 findings was dropped. The following sub-claims were removed or replaced during verification:
- F01/practitioner — "dplyr (since 1.1) warns on many-to-many": re-dated to 1.1.1. The gist's "could mask data issues" is not in the post and was removed.
- F06 — the framing of PD010/PD011/NPY002 as Ruff "autofixes" was removed, because Ruff marks no fix for them. Also removed: the claim that the NumPy page says "Generator defaults to PCG64" (the page does not say so).
- F10 — the misquote "Invalid parsing is silently set as NaT" was replaced with the doc's actual wording.
- F13 — "Kapoor & Narayanan found leakage in every one of 17 fields (329 papers)" was replaced with the version-specific figures (Patterns 2023: 294 papers).
- F14 — the TimeSeriesSplit quote ("test indices must be higher than before, and thus shuffling ... is inappropriate") is not in the 1.9.1 docs and was replaced. QuantStart's "2014" date is unconfirmed on the page.
- F15 — "pass `default_rng` Generator to estimators" was removed for scikit-learn, which does not accept it.
- F16 — "nbconvert executes in a fresh kernel" is not stated in the docs; it is now marked as the verifier's inference. The "1,203 of 22,578" denominator was restated.
- F19/practitioner — "other participants put each component in a notebook" is only P18. "produced garbage for months" is not in the text.
- F20 — the dbt quote "your refactored model should produce the same results as the original" and the audit-helper phrase "checking that a refactored model ... are identical" were not found; verified quotes were substituted.
- F21 — "pandas is deprecating inplace" became "PDEP-8 plans it; not shipped in 3.0.x". "df bound to None before pandas 3.0" was narrowed to the values-inplace methods only.
- Practitioner (Stata) — "decades of applied-econometrics practice converged" was removed as an unsupported generalisation.
