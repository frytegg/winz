# TypeScript / JavaScript best practices from authoritative sources
> Code T20 · slug lang-typescript · verified 2026-09-23 · counts: verified 14 / corrected 10 / downgraded 0 / dropped 0

## Summary

Toolchain state, checked against the sources on 2026-09-23:
- **TypeScript 6.0** was released on 23 March 2026. It turns on `strict`, `noUncheckedSideEffectImports` and `types: []` by default. It deprecates `target: es5`, `downlevelIteration`, `moduleResolution node/node10/classic`, `baseUrl`, `module amd/umd/systemjs`, and `esModuleInterop`/`allowSyntheticDefaultImports: false`. It removes `outFile` completely.
- **TypeScript 7.0** was released on 8 July 2026. It is the native Go port. The announcement calls it "10x faster", with "8x and 12x" speedups on typical full builds; the VS Code check went from 125.7 s to 10.6 s. TS 7 turns the TS 6 deprecations into unsupported options. It has no stable programmatic API yet; one is expected in 7.1.
- **typescript-eslint v8.70.1** (npm, 21 Sep 2026) supports TypeScript `>=4.8.4 <6.1.0`. The npm `latest` tag of `typescript` is already **7.0.2**, so a fresh `npm install -D typescript` leaves typed linting on an unsupported compiler. Type-aware linting on a TS 7 project therefore still needs the `"typescript": "npm:@typescript/typescript6@^6.0.2"` alias, with TS 7 installed alongside as `"@typescript/native": "npm:typescript@^7.0.2"`. This is the TS team's own recommendation.
- **ESLint v10.11.0** (18 Sep 2026) is current. It supports flat config only, and v9 reached end of life on 2026-08-06.
- **Node.js type stripping** is stable in v25.2.0 / v24.12.0. v26 removed `--experimental-transform-types`, so Node's built-in TS support cannot run enums, runtime namespaces or parameter properties at all.

The evidence falls into three groups:

**(1) Well supported (grade A, mostly official docs):**
- Make `strict` plus type-aware linting the first gate.
- The type-aware rules that matter most are `no-floating-promises`, `no-misused-promises`, `return-await` in try/catch, the `no-unsafe-*` family and `switch-exhaustiveness-check`.
- Several high-value rules are in **no** preset and must be switched on by hand: `switch-exhaustiveness-check`, `require-array-sort-compare` and `strict-boolean-expressions`. `consistent-type-imports` is also in no preset, but it duplicates `verbatimModuleSyntax`, so enable only one of the two.
- A log-only `unhandledRejection` handler silently disables Node's default crash-on-rejection (Node CLI docs). Process-level handlers must exit.
- Find dead code with knip. depcheck's README says it is no longer maintained and recommends knip.
- Avoid TS-only runtime syntax through `erasableSyntaxOnly`.
- Require a justification on every suppression comment.

**(2) Supported but contested:**
- **Removing barrel files in app code.** Atlassian measured a 75% cut in build minutes and 88% fewer unit tests run. The test figure comes from their dependency-graph-based test selection, so it only carries over to projects that run affected tests only. TkDodo measured 68% fewer modules loaded. Hagemeister's numbers come from a synthetic benchmark (he says so himself). Critics argue that tooling should fix this instead.
- **Enums versus unions.**
- **How far to push strictness.** The TS team calls `noUncheckedIndexedAccess` "noisy". Matt Pocock calls `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch` "too 'noisy'", although `@tsconfig/strictest` enables all of them. typescript-eslint recommends `strict-type-checked` only when a nontrivial share of the team is highly proficient in TS.

**(3) Thin, sometimes conflicting empirical data:**
- Static types would have caught 15% of public JS bugs (Gao, Bird & Barr, ICSE 2017).
- Yet TS projects were *not* less bug-prone than JS projects (Bogner & Merkel, MSR 2022, 604 projects; correlational).
- In a 2026 preprint on 633 TS bugs (Tang et al.), the largest category was tooling/config. The paper's prose gives 27.8%, but its table counts give 172/633 = 27.2%; the paper is internally inconsistent.
- AI agents use `any` 9x more often than humans, and their TypeScript PRs are accepted 1.8x more often (arXiv 2602.17955, a preprint). This supports strict `no-unsafe-*` rules and a type-coverage ratchet on agent-written code.
- Node Best Practices' line "80% of bugs not caught by types" is **not independent evidence**. It is a restatement of Gao et al., rounded to "~20%".

**Autofixes that change behaviour.** Many autofixes and "cleanups" that look safe actually change runtime behaviour:
- `||` → `??`
- `==` → `===`
- adding `await` / `return await`
- sequential loop → `Promise.all`
- removing "unnecessary" conditions
- turning on `verbatimModuleSyntax`
- enum → object
- removing barrel files
- numeric comparator on `sort`

Each finding therefore gives a fix risk and says when not to apply it.

**Research limits.** Reddit, Lobsters and StackExchange were not sampled. Practitioner voice comes from Hacker News (read through the Algolia API; every item was re-read by the verifier) and from engineering blogs.

## Findings

### T20-F01: Make a clean `tsc --noEmit` under `strict` the first gate, not the whole audit
- **Grade:** A · **Verdict:** CORRECTED. Node Best Practices' "80%" is derived from Gao et al., not an independent source. The eye-tracking study's sample is 26 undergraduate students. Reid et al. is marked as indirect support.
- **Rule:**
  - Make a clean `tsc --noEmit` under `strict: true` the first gate of the hardening pass. Green tests alone are not enough.
  - Plain-JS projects get the same checks from `checkJs` or a per-file `// @ts-check`.
  - Any tsconfig that sets `strict: false`, or turns off a strict-family flag (`strictNullChecks`, `noImplicitAny`, `useUnknownInCatchVariables`, `strictBuiltinIteratorReturn`, …), must justify it in a comment.
  - Treat every remaining error as a potential bug.
- **Rationale:**
  - `strict` is the official switch for the strict-family checks. It has been the default since TS 6.0, and future versions may add checks under it.
  - Static types would have flagged about 15% of public JS bugs, meaning bugs that had already passed testing and review.
  - Types do not replace tests. A 604-project study found TS apps were not less bug-prone than JS apps.
  - So the type gate is a cheap first filter, not a whole audit.
- **Evidence:**
  - [TSConfig Reference: strict](https://www.typescriptlang.org/tsconfig/#strict), Microsoft/TypeScript, 2026, official docs.
    - Quote: "Future versions of TypeScript may introduce additional stricter checking under this flag, so upgrades of TypeScript might result in new type errors in your program."
    - The strict family is alwaysStrict, strictNullChecks, strictBindCallApply, strictBuiltinIteratorReturn, strictFunctionTypes, strictPropertyInitialization, noImplicitAny, noImplicitThis and useUnknownInCatchVariables.
    - Verified; the page shows the default as `true`.
  - [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), Microsoft/TypeScript, 23 Mar 2026, official docs.
    - Quote: "strict is now true by default"; also "noUncheckedSideEffectImports is now true by default" and "types now defaults to []".
    - Verified in the page text.
  - [To Type or Not to Type: Quantifying Detectable Bugs in JavaScript](https://earlbarr.com/publications/typestudy.pdf), Gao, Bird & Barr, ICSE 2017, peer reviewed.
    - Quote: "both Flow 0.30 and TypeScript 2.0 successfully detect 15%!"
    - Verified in the page-1 abstract of the PDF.
  - [To Type or Not to Type? JS vs TS software quality](https://arxiv.org/abs/2203.11115), Bogner & Merkel, MSR 2022, peer reviewed.
    - Data: 604 projects, 16M LoC. "bug proneness and bug resolution time of our TS sample were not significantly lower than for JS". Mean bug-fix commit ratio 0.126 (JS) vs 0.206 (TS).
    - Verified in the abstract. The study is correlational repository mining.
  - [Node.js Best Practices §1.6](https://github.com/goldbergyoni/nodebestpractices), Goldberg et al., living README, practitioner guide.
    - Quote: "80% of other bugs were not discovered using types … Only efficient tests can discover the whole spectrum of bugs".
    - Verified. **The section itself cites Gao et al.'s PDF and says "~20%"**, so this is a derived restatement, not independent evidence.
  - [Using the TypeScript compiler to fix erroneous Node.js snippets](https://arxiv.org/abs/2308.12079), Reid, Treude & Wagner, SCAM 2023, peer reviewed.
    - Quote: "73.7% of the code snippets in NPM documentation have errors; with the use of NCC's corrections, this number was reduced to 25.1%". The TS-compiler approach found more errors than linters.
    - Verified in the abstract. **Indirect**: it is about documentation snippets, not finished projects.
- **Detect:**
  - Count errors: `npx tsc -p tsconfig.json --noEmit --pretty false | grep -c 'error TS'`.
  - Check every tsconfig (monorepos): `grep -rnE '"(strict|strictNullChecks|noImplicitAny)"\s*:\s*false' --include='tsconfig*.json' .`
  - JS projects: `npx tsc --noEmit --allowJs --checkJs` as a dry run.
  - Check that CI actually runs `tsc`. esbuild, swc and Vite strip types without checking them.
- **Tools:** tsc (6.x/7.x), grep.
- **Applies to:** all TS projects; JS projects via `checkJs` / `@ts-check`.
- **When not to apply / counterpoints:**
  - Types catch a minority of bugs: 15% in Gao et al., and no bug-proneness difference in Bogner & Merkel.
  - An eye-tracking study with 26 undergraduate students ([arXiv 2602.04824](https://arxiv.org/abs/2602.04824), Flint, Dyer & Sharif, 2026) found participants did not look at type-annotation lines more often when annotations were present.
  - On a large JS codebase, turning on `checkJs` globally can produce thousands of errors. Use per-file `// @ts-check`, or a separate tsconfig that grows over time (the VS Code approach, see F02).
- **Fix risk:** low (turning on the check); fixing individual errors can carry medium risk.

### T20-F03: Run type-aware linting with typescript-eslint, and switch on the no-preset rules by hand
- **Grade:** A · **Verdict:** CORRECTED. `consistent-type-imports` is now conditional: typescript-eslint says that combining it with `verbatimModuleSyntax` "can lead to conflicting and/or duplicate reports" (see F17). The TS 7 note is also more precise: npm `latest` for `typescript` is 7.0.2, which is outside typescript-eslint's supported range.
- **Rule:**
  - Use `recommendedTypeChecked` at minimum.
  - Add `strictTypeChecked` and `stylisticTypeChecked` only if the team is proficient in TS.
  - Enable by hand the high-value rules that are in **no** preset: `switch-exhaustiveness-check`, `require-array-sort-compare` and `strict-boolean-expressions` (with the caution in F12).
  - Add `consistent-type-imports` when `verbatimModuleSyntax` is off, or when you want its autofix. With `verbatimModuleSyntax` on, tsc already enforces `import type`, and the rule mostly duplicates it.
  - Pin the typescript-eslint version, because the strict presets can change outside semver.
  - Check that `typescript` in `package.json` resolves to a version typescript-eslint supports (`<6.1.0` as of v8.70.1).
- **Rationale:**
  - The most valuable TS-specific checks need type information: promises, `any` leakage, deprecated APIs and unsafe enum comparisons.
  - The official docs strongly recommend type-aware linting.
  - The docs also mark the strict configs as not semver-stable.
- **Evidence:**
  - [Shared Configs](https://typescript-eslint.io/users/configs/), typescript-eslint v8.70.1, 2026, official docs.
    - Quote: "We recommend a TypeScript project extend from `plugin:@typescript-eslint/strict` only if a nontrivial percentage of its developers are highly proficient in TypeScript."
    - `strict`, `strict-type-checked`, `all`, `disable-type-checked` and `strict-type-checked-only` are marked as not semver-stable.
    - Verified.
  - [Linting with Type Information](https://typescript-eslint.io/getting-started/typed-linting/), typescript-eslint, 2026, official docs.
    - Quote: "We strongly recommend you do use type-aware linting". The setup uses `projectService: true`, and "For small projects this takes a negligible amount of time (a few seconds or less)".
    - Verified.
  - [Rules index](https://typescript-eslint.io/rules/), typescript-eslint, 2026, official docs.
    - switch-exhaustiveness-check, strict-boolean-expressions, require-array-sort-compare, consistent-type-imports, explicit-module-boundary-types, explicit-function-return-type and promise-function-async have no preset column checked.
    - Verified on the index. Individual rule pages show no "extending … enables this rule" line.
  - [Avoiding anys with Linting and TypeScript](https://typescript-eslint.io/blog/avoiding-anys), Josh Goldberg / typescript-eslint, 21 Jan 2025, official blog.
    - Recommends `recommendedTypeChecked` or `strictTypeChecked`, and says `noImplicitAny` alone is insufficient.
    - Verified.
  - [ESLint v10 migration guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0) and the [ESLint blog](https://eslint.org/blog/), ESLint, 2026, official docs.
    - The old configuration format is no longer supported. Blog banner: "ESLint v9.x reached end-of-life on 2026-08-06 and is no longer maintained". v10.11.0 was released on 18 Sep 2026.
    - Verified.
  - [consistent-type-imports: Comparison with verbatimModuleSyntax](https://typescript-eslint.io/rules/consistent-type-imports/), typescript-eslint, 2026, official docs.
    - Quote: "using both this rule and verbatimModuleSyntax at the same time can lead to conflicting and/or duplicate reports on the same import … If TypeScript's diagnostics are sufficient for your project, you can disable this rule to avoid duplicate reports."
    - Verified in the raw page; added by the verifier.
  - [Dependency Versions](https://typescript-eslint.io/users/dependency-versions/), typescript-eslint, 2026, official docs, plus the npm registry.
    - Supported TypeScript is `>=4.8.4 <6.1.0`. The npm registry shows `typescript` latest = 7.0.2 (8 Jul 2026) and `typescript-eslint` latest = 8.70.1 (21 Sep 2026).
    - Verified on 2026-09-23.
- **Detect:** Flat config (`eslint.config.mjs`) sketch:

  ```js
  import { defineConfig } from 'eslint/config';
  import js from '@eslint/js';
  import tseslint from 'typescript-eslint';

  export default defineConfig({
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked, // or strictTypeChecked
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { allowDefaultCaseForExhaustiveSwitch: false, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/require-array-sort-compare': 'error',
      // only if verbatimModuleSyntax is off (see F17):
      // '@typescript-eslint/consistent-type-imports': 'error',
    },
  });
  ```

  - Check that the rules are live: `npx eslint --print-config src/index.ts | grep -E 'no-floating-promises|no-unsafe'`.
  - Gate CI with `npx eslint . --max-warnings=0`.
- **Tools:** typescript-eslint v8, ESLint v10 (requires Node ≥20.19 / ≥22.13 / ≥24).
- **Applies to:** TS projects. JS files need `tseslint.configs.disableTypeChecked` or `checkJs`.
- **When not to apply / counterpoints:**
  - Typed linting costs roughly one type-check per lint run. A practitioner reports ESLint as "a 5 minute affair" on a large codebase (HN 44588258).
  - `strict-type-checked` is officially advised only for proficient teams, and its noise can push people to disable rules wholesale.
  - On a TS 7 project, the `@typescript/typescript6` alias is needed. A plain `npm install -D typescript` now installs 7.0.2.
- **Fix risk:** low (config only).

### T20-F04: Handle every Promise; no async callbacks in void slots
- **Grade:** A · **Verdict:** VERIFIED (the Node crash condition is stated more precisely)
- **Rule:**
  - Every Promise must be awaited, returned, `.catch`-ed with real handling, or passed to a documented fire-and-forget helper that catches internally.
  - No async callbacks where a void callback is expected: `arr.forEach(async …)`, event listeners, React effects.
  - No Promise used as a condition.
  - Enforce with `no-floating-promises`, `no-misused-promises` and `await-thenable`, all in `recommended-type-checked`.
- **Rationale:**
  - Since Node 15, an unhandled rejection crashes the process by default, but only when no `unhandledRejection` listener is registered. If any listener exists, Node hands the rejection to it instead (see F06).
  - TypeScript alone does not report floating promises.
  - `void` silences the rule but handles nothing.
- **Evidence:**
  - [no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/), typescript-eslint, 2026, official docs.
    - Quote: "one that is created without any code set up to handle any errors it might throw". Also: "Voiding a Promise doesn't handle it or change the runtime behavior … Such Promise rejections will still be unhandled." When Not To Use It: "can be difficult to enable on large existing projects that set up many floating Promises".
    - Verified.
  - [no-misused-promises](https://typescript-eslint.io/rules/no-misused-promises/), typescript-eslint, 2026, official docs.
    - `checksConditionals`, `checksVoidReturn` and `checksSpreads` all default to true. Examples include `forEach(async …)` and `addEventListener('click', async …)`.
    - Verified.
  - [Node.js CLI: --unhandled-rejections](https://nodejs.org/api/cli.html#--unhandled-rejectionsmode), Node.js (v26.10 docs), official docs.
    - "v15.0.0: Changed the default mode from warn to throw". The modes are throw/strict/warn/warn-with-error-code/none. Default mode quote: "throw: Emit unhandledRejection. If this hook is not set, raise the unhandled rejection as an uncaught exception."
    - Verified in the raw page.
  - [From Logic to Toolchains: bugs in the TS ecosystem](https://arxiv.org/html/2601.21186), Tang, Alimadadi & Sumner (SFU), arXiv Jan 2026, preprint.
    - Data: 633 bugs from 16 projects. The table has Async/Event = 21 (3.3%; the prose says 3.6%) and Error Handling = 5 (0.8%). Quote: "Asynchrony / Event Handling Bugs … remain nontrivial despite language-level support for async/await". Patterns: missing await, races, unhandled rejections.
    - Verified from the HTML full text. The paper's percentages are internally inconsistent.
  - [HN comment on typescript-eslint rules](https://news.ycombinator.com/item?id=38655130), clarkdave, Dec 2023, practitioner forum.
    - Quote: "the no-floating-promise rule catches some easily-made mistakes involving promises in a way that TypeScript doesn't on its own."
    - Verified via the Algolia API.
- **Detect:**
  - Rules: `@typescript-eslint/no-floating-promises`, `no-misused-promises`, `await-thenable`.
  - Greps and patterns: `grep -rnE '\.forEach\(\s*async' src`; ast-grep `$A.forEach(async ($$$) => $$$)`.
  - Audit silenced sites: `grep -rnE '^\s*void [a-zA-Z_.]+\(' src`. Check that each voided call catches internally.
  - Without typed ESLint: `oxlint --type-aware` (needs TS 7 plus `oxlint-tsgolint`), or Biome's `noFloatingPromises` (nursery, partial coverage; see F21).
- **Tools:** the three typescript-eslint rules, ast-grep, oxlint `--type-aware`, Biome `noFloatingPromises`.
- **Applies to:** all TS; JS through `checkJs` plus typed lint, oxlint or Biome.
- **When not to apply / counterpoints:**
  - The docs admit the rule is hard to enable on large existing projects. Global unhandled-rejection handlers reduce the crash impact (both rule pages say so).
  - Thenable query builders (e.g. Knex) trigger the rule on every builder, and teams end up suppressing it wholesale (HN 44588258).
  - HN practitioners use `void` to mark intentional fire-and-forget, but the docs say `void` handles nothing.
  - AI-suggested "fixes" that add `await` inside a non-async React `useEffect` callback are wrong (HN 42458712).
- **Fix risk:** medium. Adding `await` changes timing and error propagation.

### T20-F05: `return await` inside try/catch/finally
- **Grade:** A · **Verdict:** VERIFIED (one supporting source added)
- **Rule:**
  - Inside `try`/`catch`/`finally` blocks of async functions, return awaited promises.
  - Enforce with `@typescript-eslint/return-await`, set to `in-try-catch` (the rule default) or `error-handling-correctness-only` (the value used by `strict-type-checked`).
  - Retire ESLint core `no-return-await`, which is deprecated.
- **Rationale:** Returning an un-awaited promise inside `try` lets a rejection skip the local `catch`, and lets `finally` run before the promise settles. A naive "remove redundant await" refactor introduces exactly this bug.
- **Evidence:**
  - [return-await](https://typescript-eslint.io/rules/return-await/), typescript-eslint, 2026, official docs.
    - `defaultOptions = 'in-try-catch'`; "configured with 'error-handling-correctness-only' in the strict-type-checked config"; `never` is deprecated. Quote: "If you return a promise within a try block, it should be awaited in order to trigger subsequent catch or finally blocks as expected." Also "If you previously used no-return-await, this rule's in-try-catch option has the closest behavior".
    - Verified.
  - [Node.js Best Practices §2.12](https://github.com/goldbergyoni/nodebestpractices), Goldberg et al., living README, practitioner guide.
    - Quote: "Always do `return await` when returning a promise to benefit full error stacktrace".
    - Verified; added by the verifier.
- **Detect:**
  - `@typescript-eslint/return-await: ['error', 'error-handling-correctness-only']`.
  - ast-grep for `try { $$$ return $CALL($$$) $$$ } catch ($E) { $$$ }` in async functions.
  - `grep -rn 'no-return-await' .` finds leftover config.
- **Tools:** `@typescript-eslint/return-await`, ast-grep.
- **Applies to:** async TS/JS functions.
- **When not to apply / counterpoints:**
  - Outside try/catch the choice is mostly stylistic. Node Best Practices and the typescript-eslint docs note a stack-trace benefit even there, but do not churn code for it.
  - The autofix changes behaviour on purpose (errors now reach the local catch), so review each fix against what callers expect.
- **Fix risk:** medium.

### T20-F07: Throw only Errors, chain causes, never swallow silently
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Throw and reject only `Error` instances or subclasses.
  - Type caught values as `unknown` and narrow them.
  - When re-throwing, chain the original: `new Error(msg, { cause: err })`.
  - No empty `catch` block unless a comment explains why.
  - Enforce with:
    - `only-throw-error` (recommended-type-checked)
    - `prefer-promise-reject-errors` (recommended-type-checked)
    - `use-unknown-in-catch-callback-variable` (strict-type-checked)
    - ESLint `preserve-caught-error` (in `eslint:recommended` since v10)
- **Rationale:**
  - Non-Error throws lose stack traces.
  - Re-throwing without `cause` erases the root cause.
  - Google's style guide says an empty catch is "very rarely correct".
- **Evidence:**
  - [only-throw-error](https://typescript-eslint.io/rules/only-throw-error/), typescript-eslint, 2026, official docs.
    - Quote: "The fundamental benefit of Error objects is that they automatically keep track of where they were built and originated." Defaults: allowRethrowing, allowThrowingAny and allowThrowingUnknown are all true.
    - Verified.
  - [preserve-caught-error](https://eslint.org/docs/latest/rules/preserve-caught-error), ESLint, 2026, official docs.
    - Added in v9.35.0; in recommended. Incorrect: `throw new Error("Something went wrong: " + error.message)`. Correct: `throw new Error("Something went wrong", { cause: error })`. Offers suggestions.
    - Verified.
  - [ESLint v10 migration guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0), ESLint, 2026, official docs.
    - `no-unassigned-vars`, `no-useless-assignment` and `preserve-caught-error` are newly enabled in `eslint:recommended`.
    - Verified.
  - [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), Google, living guide, style standard.
    - Quotes: "if the thrown or rejected value is not an Error, it does not populate stack trace information" and "It is very rarely correct to do nothing in response to a caught exception … the reason this is justified is explained in a comment."
    - Verified.
  - [TSConfig: useUnknownInCatchVariables](https://www.typescriptlang.org/tsconfig/#useUnknownInCatchVariables), Microsoft/TypeScript, official docs.
    - Default is true when `strict` is on; released in 4.4.
    - Verified.
- **Detect:**
  - The rules above.
  - Empty catch: ast-grep `try { $$$ } catch ($E) {}`, or `grep -rnPzo 'catch\s*(\(\w*\))?\s*\{\s*\}' src`.
  - String throws: `grep -rnE "throw ['\"\x60]" src`.
  - Promise swallowers: `grep -rnE '\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)' src`.
- **Tools:** the typescript-eslint rules above, ESLint `preserve-caught-error`, ast-grep.
- **Applies to:** all TS/JS.
- **When not to apply / counterpoints:**
  - Some libraries throw non-Errors: use `allowRethrowing` or `allow`, and narrow with `instanceof`.
  - Wrapping errors changes what upstream `instanceof` / `err.code` checks see. Check the callers first.
- **Fix risk:** medium.

### T20-F06: Process-level handlers log, clean up and exit
- **Grade:** A · **Verdict:** CORRECTED
  - The Node Best Practices §2.6 quotation was condensed inside quote marks and has been restored verbatim.
  - The `none` mode was misquoted as "Silently ignore unhandled rejections". The docs say "none: Silence all warnings."
  - Added the key mechanism: in the default `throw` mode, registering *any* `unhandledRejection` listener stops the crash. So a handler that only logs keeps a broken process alive.
- **Rule:**
  - `process.on('uncaughtException'|'unhandledRejection')` handlers may log, flush and do synchronous cleanup, then must exit non-zero.
  - They must never resume normal operation.
  - Never run production with `--unhandled-rejections=warn|none`.
  - Let an external supervisor (systemd, an orchestrator, PM2) restart the process.
- **Rationale:**
  - Node's docs say that resuming after `uncaughtException` is unsafe because the app is in an undefined state.
  - A handler that swallows the error turns a crash into silent corruption.
  - This applies to rejections as well. In the default `throw` mode, Node emits `unhandledRejection` and raises an uncaught exception only "If this hook is not set". A log-only `process.on('unhandledRejection', …)` therefore quietly turns off the Node ≥15 crash-on-rejection default.
- **Evidence:**
  - [Warning: Using 'uncaughtException' correctly](https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly), Node.js, 2026, official docs.
    - Quote: "The correct use of 'uncaughtException' is to perform synchronous cleanup of allocated resources … before shutting down the process. It is not safe to resume normal operation after 'uncaughtException'." Also: "an external monitor should be employed in a separate process to detect application failures and recover or restart as needed."
    - Verified.
  - [Node.js Best Practices §2.6 / §2.10](https://github.com/goldbergyoni/nodebestpractices), Goldberg et al., living README, practitioner guide.
    - Verbatim: "When an unknown error occurs (catastrophic error, see best practice 2.3) - there is uncertainty about the application healthiness. In this case, there is no escape from making the error observable, shutting off connections and exiting the process." §2.10 is "Catch unhandled promise rejections".
    - Verified; quote corrected.
  - [Node.js CLI: --unhandled-rejections](https://nodejs.org/api/cli.html#--unhandled-rejectionsmode), Node.js, official docs.
    - Quotes: "none: Silence all warnings." and "throw: Emit unhandledRejection. If this hook is not set, raise the unhandled rejection as an uncaught exception. This is the default." `strict` raises the exception even when the hook is set. The default has been `throw` since v15.
    - Verified in the raw page; the `none` quote was corrected.
- **Detect:**
  - `grep -rnE "process\.on\(['\"](uncaughtException|unhandledRejection)" src`, then read each handler. It must end in `process.exit(1)` or a rethrow, after logging. Pay particular attention to `unhandledRejection` handlers: one that only logs silently overrides Node's default crash.
  - To keep crash-on-rejection no matter what handlers exist, consider `--unhandled-rejections=strict`.
  - `grep -rnE 'unhandled-rejections=(warn|none)|NODE_OPTIONS' package.json Dockerfile* *.yml .env* 2>/dev/null`.
- **Tools:** grep, manual review.
- **Applies to:** Node.js services and CLIs.
- **When not to apply / counterpoints:** Libraries should not install process-level handlers at all; that is the application's job. For CLIs, the default crash may already be acceptable.
- **Fix risk:** medium.

### T20-F08: Contain `any`, ratchet type coverage (especially for agent-written code)
- **Grade:** A · **Verdict:** CORRECTED
  - "Reviewers are not catching it" was the researcher's inference and is now labelled as such. The paper only urges developers to confirm type safety.
  - The `any`/quality correlation is weak (ρ 0.17–0.26) and concerns code smells and cognitive complexity, not bugs.
  - The Effective TypeScript item *titles* are confirmed on the TOC, but the item numbers 43/45/46/49 are not shown there.
- **Rule:**
  - Ban explicit `any` (`no-explicit-any`) and block its spread with the `no-unsafe-*` family: argument, assignment, call, member-access, return.
  - Use `unknown` for truly unknown values.
  - Keep any unavoidable `any` in the narrowest scope, inside a well-typed function.
  - Track type coverage with a ratchet so it can only go up.
  - Apply this with extra rigour to agent-written code.
- **Rationale:**
  - The Handbook describes `any` as "please turn off type checking for this thing".
  - `any` enters silently through `JSON.parse`, `.json()` and Storage.
  - Less `any` correlated weakly with better code-smell and cognitive-complexity metrics, but not with bug proneness.
  - Agents use `any` 9x more than humans, and agentic TS PRs are accepted 1.8x more often. The verifier's inference (not the paper's claim) is that review does not filter this out.
- **Evidence:**
  - [Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html), TypeScript Handbook, official docs.
    - Quote: "Don't use any as a type unless you are in the process of migrating a JavaScript project to TypeScript. The compiler effectively treats any as 'please turn off type checking for this thing'."
    - Verified.
  - [Avoiding anys with Linting and TypeScript](https://typescript-eslint.io/blog/avoiding-anys), Josh Goldberg / typescript-eslint, Jan 2025, official blog.
    - Quote: "JSON.parse(), .json(), and Storage properties are all typed as any by default". Lists no-explicit-any plus no-unsafe-argument/assignment/call/member-access/return, and mentions ts-reset.
    - Verified.
  - [Mining Type Constructs Using Patterns in AI-Generated Code](https://arxiv.org/abs/2602.17955), Lee, Hassan & Hindle, arXiv Feb 2026 (v2 Apr 2026), **preprint**.
    - Quotes: "AI agents are 9x more prone to use the 'any' keyword" and "Agentic pull requests (PRs) have 1.8x higher acceptance rates compared to humans for TypeScript". The paper encourages developers "to carefully confirm the type safety of their codebases whenever they coordinate with AI agents".
    - Verified in the abstract via the arXiv API.
  - [Bogner & Merkel, MSR 2022](https://arxiv.org/abs/2203.11115), peer reviewed.
    - Quote: "reducing the usage of the any type in TS apps was significantly correlated with all metrics except bug proneness (Spearman's rho between 0.17 and 0.26)". The metrics are code smells/LoC, cognitive complexity/LoC and resolution time.
    - Verified.
  - [type-coverage](https://github.com/plantain-00/type-coverage), plantain-00, v2.30.1 (Jul 2026), tool README.
    - Quote: "the type coverage rate = the count of identifiers whose type is not any / the total count of identifiers". Flags `--at-least` and `--detail`. `--strict` also counts `any` type arguments, `as`/`!` assertions, `Object` and `{}` as uncovered.
    - Verified.
  - [Effective TypeScript, 2nd ed.](https://effectivetypescript.com/), Dan Vanderkam (O'Reilly, 2024), book.
    - Chapter 5 "Unsoundness and the any Type" lists "Use the Narrowest Possible Scope for any Types", "Hide Unsafe Type Assertions in Well-Typed Functions", "Use unknown Instead of any for Values with an Unknown Type" and "Track Your Type Coverage to Prevent Regressions in Type Safety".
    - Book, confirmed via the author's site TOC (titles only; item text not read).
  - [no-explicit-any](https://typescript-eslint.io/rules/no-explicit-any/), typescript-eslint, official docs.
    - `fixToUnknown` defaults to false: "Switching types to unknown is safer but is likely to cause additional type errors."
    - Verified.
- **Detect:**
  - Baseline: `npx type-coverage --detail --strict`. Then gate CI with `npx type-coverage --strict --at-least <baseline>`.
  - `grep -rnE '(:\s*any\b|\bas any\b|<any>|any\[\])' src | wc -l`.
  - Lint: `no-explicit-any` and `no-unsafe-*`.
  - Optional, apps only: `@total-typescript/ts-reset`.
- **Tools:** type-coverage, typescript-eslint `no-explicit-any` / `no-unsafe-*`, ts-reset (apps only).
- **Applies to:** TS projects, especially code written or edited by AI agents.
- **When not to apply / counterpoints:**
  - The docs accept `any` during migration, for untyped third-party packages, and for types TS cannot express.
  - no-unsafe-assignment docs: "It may be easier to skip the no-unsafe-* rules pending increasing type safety in unsafe areas".
  - ts-reset README: "Use ts-reset in applications, not libraries", because it changes the global scope.
- **Fix risk:** low for the lint and ratchet; replacing `any` can surface real type errors.

### T20-F12: Do not mass-convert `||`→`??`, `==`→`===` or truthiness checks
- **Grade:** A · **Verdict:** VERIFIED (Google's `== null` exception added)
- **Rule:**
  - Each of these conversions changes behaviour for `''`, `0`, `NaN` or `false`.
  - Use `prefer-nullish-coalescing` (stylistic-type-checked) and `eqeqeq` with `['error','always',{null:'ignore'}]` to find candidates.
  - Decide site by site whether the falsy fallback was intended.
  - Keep `x == null` as the idiom for "null or undefined".
- **Rationale:**
  - `??` only coalesces null/undefined, while `||` coalesces every falsy value. typescript-eslint therefore reports most cases as suggestions, not autofixes.
  - ESLint's `eqeqeq` autofixes only `typeof` and same-type-literal comparisons, because other fixes "can change runtime behavior".
- **Evidence:**
  - [prefer-nullish-coalescing](https://typescript-eslint.io/rules/prefer-nullish-coalescing/), typescript-eslint, official docs.
    - Quote: "only coalesces when the original value is null or undefined". `ignoreConditionalTests` defaults to true because those tests "intentionally use the falsy fallthrough behavior … fixing the operator to the nullish coalesce operator could cause bugs". Has `ignorePrimitives`. Requires strictNullChecks; in stylistic-type-checked.
    - Verified.
  - [eqeqeq](https://eslint.org/docs/latest/rules/eqeqeq), ESLint, official docs.
    - Quotes: "A problem is only fixed if one of the operands is a typeof expression, or if both operands are literals with the same type." and "In other cases a suggestion is offered which can change runtime behavior". `allow-null` is deprecated in favour of `{"null": "ignore"}`.
    - Verified.
  - [Google TypeScript Style Guide: Equality checks](https://google.github.io/styleguide/tsguide.html), Google, style standard.
    - Quote: "Always use triple equals (===) and not equals (!==)". Also: "Exception: Comparisons to the literal null value may use the == and != operators to cover both null and undefined values."
    - Verified; exception added by the verifier.
- **Detect:**
  - Run `prefer-nullish-coalescing` and `eqeqeq` in report-only mode.
  - `grep -rnE '\|\| (0|""|false|\[\]|\{\})' src` shows sites where a falsy default may be intended.
  - For each site, list which falsy values the left operand can hold. Number, string and boolean operands are the dangerous ones.
  - Consider `ignorePrimitives: { string: true, number: true }`.
- **Tools:** `prefer-nullish-coalescing`, `strict-boolean-expressions`, ESLint `eqeqeq`.
- **Applies to:** all TS/JS.
- **When not to apply / counterpoints:** Conversion is safe only when the left operand's type is `object | null | undefined`. On a finished codebase, the stylistic gain rarely justifies the behaviour risk for number, string or boolean operands.
- **Fix risk:** high.

### T20-F19: Do not blindly parallelise `await`-in-loop into `Promise.all`
- **Grade:** A · **Verdict:** VERIFIED (MDN's "does not cancel" sentence added)
- **Rule:**
  - Before replacing a sequential loop with `Promise.all`, confirm there is no ordering dependency, rate limit, retry/backoff logic or bounded resource.
  - `Promise.all` rejects on the first failure without cancelling the other operations.
  - Use `Promise.allSettled` when every outcome matters, and a concurrency limiter when resources are bounded.
  - Treat `no-await-in-loop` as a review prompt, not an auto-refactor.
- **Rationale:** Parallelising changes side-effect order, rate-limit behaviour and partial-failure semantics. It is a behaviour change dressed up as a performance fix.
- **Evidence:**
  - [no-await-in-loop](https://eslint.org/docs/latest/rules/no-await-in-loop), ESLint, official docs.
    - Quote: "each successive operation will not start until the previous one has completed". Legitimate exceptions include rate limits ("we'll exceed our rate limit if we make all the network calls in parallel"), dependent iterations, retries, bounded resources and serial I/O.
    - Verified.
  - [Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all), MDN, official docs.
    - Quotes: "It rejects when any of the input's promises rejects, with this first rejection reason." Also: "Promise.allSettled() will wait for all input promises to complete, regardless of whether or not one rejects." And: "Rejecting the returned promise does not cancel the remaining operations".
    - Verified in the raw page.
- **Detect:**
  - Run `no-await-in-loop` in report mode, or ast-grep `for ($$$) { $$$ await $X $$$ }`.
  - For each hit, record four things: data dependency, external rate limit, side-effect order, and the error semantics wanted (fail-fast or collect).
- **Tools:** ESLint `no-await-in-loop`, ast-grep.
- **Applies to:** async JS/TS, especially exchange and API clients, DB migrations, and file processing.
- **When not to apply / counterpoints:** When iterations really are independent and idempotent, parallelising is a clear win, as in read-heavy fan-out.
- **Fix risk:** high.

### T20-F11: Use `no-unnecessary-condition` only where types are sound
- **Grade:** A · **Verdict:** CORRECTED. Issue #1798 is **closed**, not long-running. Issue #6632 was read now: it is open, labelled bug/accepting PRs, and shows a false positive on `foo[bar] ??= 0`.
- **Rule:**
  - Use `@typescript-eslint/no-unnecessary-condition` (strict-type-checked) as a dead-branch finder only where types are sound: `noUncheckedIndexedAccess` on, and no `as` or `any` on the data path.
  - Apply its suggestions (it has no autofix) one by one.
  - Never remove a null check or `?.` on data that crosses a trust boundary without runtime validation.
- **Rationale:** The rule trusts the declared types. The docs say TS "optimistically assumes that indexed access will always return a value".
- **Evidence:**
  - [no-unnecessary-condition](https://typescript-eslint.io/rules/no-unnecessary-condition/), typescript-eslint, official docs.
    - Quote: "By default, TypeScript optimistically assumes that indexed access will always return a value". The workaround is `noUncheckedIndexedAccess` or `.at()`. Projects that are not accurately typed may find it "difficult to enable this rule". Suggestions only; in strict-type-checked.
    - Verified.
  - [Issue #1798: ignore array index return](https://github.com/typescript-eslint/typescript-eslint/issues/1798), typescript-eslint, opened Mar 2020, issue tracker.
    - `const bar = foo[5]; if (bar)` is reported as unnecessary; labelled enhancement/accepting PRs.
    - Verified. **Status: closed.**
  - [Issue #6632: conditional assignment to index signature](https://github.com/typescript-eslint/typescript-eslint/issues/6632), typescript-eslint, opened Mar 2023, issue tracker.
    - `const foo: Record<string, number> = {}; foo[bar] ??= 0;` is flagged as unnecessary.
    - Verified now; open.
- **Detect:**
  - `npx eslint . --rule '{"@typescript-eslint/no-unnecessary-condition":"error"}'`, with `noUncheckedIndexedAccess` enabled.
  - Before accepting any "unnecessary" verdict, trace the value back to its source. If it comes from JSON.parse, fetch, env, DB rows or an `as` cast, keep the guard and fix the type.
- **Tools:** `no-unnecessary-condition`, tsc `noUncheckedIndexedAccess`.
- **Applies to:** TS codebases with sound types; low value where `any` and assertions are common.
- **When not to apply / counterpoints:** Removing a "dead" guard passes tests and then fails in production on malformed input.
- **Fix risk:** high.

### T20-F13: Remove dead code with knip, in order, on a clean tree
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Work top-down in knip's documented order: unused files, then unresolved imports, then unused exports, then unused dependencies.
  - Configure entry points first: dynamic imports, framework conventions, scripts.
  - Use `--fix` only on a clean git tree. Delete files only with the explicit `--allow-remove-files`.
  - Complement knip with `@typescript-eslint/no-unused-vars` (underscore-ignore config) and ESLint's `no-useless-assignment` / `no-unassigned-vars`.
  - Replace depcheck.
- **Rationale:**
  - tsc's `noUnusedLocals` only sees dead code inside a file. Unused exports, files and dependencies need whole-project reachability.
  - Knip's findings chain: removing files first shrinks the other lists.
- **Evidence:**
  - [Knip: Handling Issues](https://knip.dev/guides/handling-issues), Knip, 2026 (knip v6.38.0), official docs.
    - Order: unused files, unresolved imports, unused exports, unused dependencies. Quotes: "Findings come in chains", "Hiding a result is not the same as resolving it", "Dynamic import specifiers aren't resolved", "Reach for ignore* options only as a last resort".
    - Verified.
  - [Knip: Auto-fix](https://knip.dev/features/auto-fix), Knip, official docs.
    - `--fix` removes export keywords, enum/namespace members, dependencies and catalog entries. "Add --allow-remove-files to allow Knip to remove unused files". Quote: "Use a VCS (version control system) like Git to review and undo changes as necessary." `--fix-type` takes dependencies|exports|types|files|catalog.
    - Verified.
  - [depcheck README](https://github.com/depcheck/depcheck), depcheck maintainers, README.
    - Quotes: "Depcheck is no longer actively maintained" and "We strongly recommend switching to knip".
    - Verified. The repository was also **archived by its owner on 16 Jun 2025** (read-only).
  - [ts-prune README](https://github.com/nadeesha/ts-prune), nadeesha, README.
    - Quote: "This project has been resurrected after a long hiatus … It needs to keep working."
    - Verified.
  - [Vanderkam: "Use knip to detect dead code"](https://effectivetypescript.com/2023/07/29/knip/), Dan Vanderkam, 2023, practitioner blog.
    - ts-prune "couldn't detect unused dependencies or mutually recursive dead code".
    - Verified.
  - [no-useless-assignment](https://eslint.org/docs/latest/rules/no-useless-assignment) and [no-unassigned-vars](https://eslint.org/docs/latest/rules/no-unassigned-vars), ESLint, official docs.
    - Both are in recommended. no-useless-assignment reports dead stores; it deliberately skips some reassignments in `try` blocks.
    - Verified.
  - [no-unused-vars](https://typescript-eslint.io/rules/no-unused-vars/), typescript-eslint, official docs.
    - Quote: "These lint rules are more configurable than TypeScript's compiler options". The FAQ config uses `args:'all'`, `argsIgnorePattern:'^_'`, `caughtErrors:'all'`, `caughtErrorsIgnorePattern:'^_'`, `destructuredArrayIgnorePattern:'^_'`, `varsIgnorePattern:'^_'` and `ignoreRestSiblings:true`.
    - Verified.
- **Detect:**
  - Report: `npx knip`.
  - Then work in order: `--include files`, then `--include exports,types`, then `--include dependencies`.
  - Apply on a clean tree with `npx knip --fix --fix-type exports,types`, then run tsc and the full test suite.
  - Delete files with `--allow-remove-files` only after reviewing the list.
  - Grep for dynamic loading that knip cannot see: `grep -rnE 'import\(\s*[^\x27"\x60]|require\(\s*[^\x27"]' src`.
- **Tools:** knip, `@typescript-eslint/no-unused-vars`, ESLint `no-useless-assignment` / `no-unassigned-vars`, tsc `noUnusedLocals` / `noUnusedParameters`.
- **Applies to:** all JS/TS repos, including monorepos (knip advertises 150+ plugins).
- **When not to apply / counterpoints:**
  - In a library, "unused" exports are the public API, so removing `export` is a breaking change.
  - DI and reflection, string-based dynamic imports, framework file conventions, and code used only by scripts produce false positives until entries are configured.
- **Fix risk:** medium.

### T20-F10: Make every switch over a union exhaustive
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Enable `@typescript-eslint/switch-exhaustiveness-check` (in **no** preset) with `allowDefaultCaseForExhaustiveSwitch: false` and `requireDefaultForNonUnion: true`.
  - Where a runtime guard is still needed, end with a `never` assertion.
  - Keep `noFallthroughCasesInSwitch` on where the project already uses it (opt-in; see F02).
- **Rationale:** This is the official TS pattern for catching unhandled union members when the union grows. With the options above, the rule also flags a `default` branch that can never run.
- **Evidence:**
  - [Narrowing: Exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking), TypeScript Handbook, official docs.
    - `default: const _exhaustiveCheck: never = shape;`; adding Triangle gives "Type 'Triangle' is not assignable to type 'never'."
    - Verified.
  - [switch-exhaustiveness-check](https://typescript-eslint.io/rules/switch-exhaustiveness-check/), typescript-eslint, official docs.
    - `allowDefaultCaseForExhaustiveSwitch` (default true), `requireDefaultForNonUnion` (default false), `considerDefaultExhaustiveForUnions` (default false). When not to use it: "If you don't frequently switch over union types or enums with many parts".
    - Verified; the page shows no preset.
- **Detect:**
  - Enable the rule with the options above.
  - `grep -rn 'assertNever\|: never =' src` shows where the pattern already exists.
- **Tools:** `switch-exhaustiveness-check`, tsc `noFallthroughCasesInSwitch` (optional).
- **Applies to:** discriminated unions, enums, state machines, reducers, message handlers.
- **When not to apply / counterpoints:**
  - With `allowDefaultCaseForExhaustiveSwitch: false`, a defensive `default` for unvalidated runtime input gets flagged. Keep that setting only where input is validated (F09).
  - `noFallthroughCasesInSwitch` is optional strictness (see F02: Pocock calls it "too noisy"). The lint rule and the `never` pattern carry the exhaustiveness guarantee on their own.
- **Fix risk:** low.

### T20-F18: Remove silent-coercion bugs (sort, template strings)
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Every `sort` / `toSorted` on a non-string array needs a comparator: `require-array-sort-compare` (no preset).
  - Template literals must not receive objects, nullish or `any` values: `restrict-template-expressions` and `no-base-to-string`, both recommended-type-checked.
- **Rationale:** `[1,2,3,10,20,30].sort()` returns `[1,10,2,20,3,30]`. Interpolated objects become "[object Object]".
- **Evidence:**
  - [require-array-sort-compare](https://typescript-eslint.io/rules/require-array-sort-compare/), typescript-eslint, official docs.
    - `[1, 2, 3, 10, 20, 30].sort(); //→ [1, 10, 2, 20, 3, 30]`. Covers `Array#sort()` and `Array#toSorted()`. `ignoreStringArrays` defaults to true.
    - Verified.
  - [restrict-template-expressions](https://typescript-eslint.io/rules/restrict-template-expressions/), typescript-eslint, official docs.
    - Quote: "The default toString() method of objects uses the format "[object Object]"". The recommended config allows any/boolean/nullish/number/RegExp; strict-type-checked sets these to false.
    - Verified.
- **Detect:**
  - Enable `require-array-sort-compare`, `restrict-template-expressions` and `no-base-to-string`.
  - `grep -rnE '\.(sort|toSorted)\(\s*\)' src`.
- **Tools:** the three typescript-eslint rules.
- **Applies to:** all TS; JS via `checkJs` plus typed lint.
- **When not to apply / counterpoints:**
  - Adding a numeric comparator changes output order. That is the fix, but check consumers first: snapshots, persisted orderings, pagination cursors.
  - The strict-type-checked `allowNumber: false` is noisy; many teams keep it true.
- **Fix risk:** low to medium (ordering change).

### T20-F22: Every suppression is justified and still needed
- **Grade:** A · **Verdict:** CORRECTED
  - Google does **not** ban all three directives outright: it permits `@ts-expect-error` in unit tests ("though you generally should not").
  - The TypeScript team's own guidance (TS 3.9 release notes) was added. It names a legitimate `@ts-ignore` case: code that errors in one TS version but not another during an upgrade. That case matters for the TS 6/TS 7 dual install.
- **Rule:**
  - Ban `@ts-ignore` and `@ts-nocheck`.
  - Allow `@ts-expect-error` only with a description (the `ban-ts-comment` defaults, in recommended).
  - Require a `-- reason` on every `eslint-disable`.
  - Fail CI on unused disable directives.
- **Rationale:** `@ts-expect-error` fails once the error disappears; `@ts-ignore` does not. ESLint can report stale disables.
- **Evidence:**
  - [ban-ts-comment](https://typescript-eslint.io/rules/ban-ts-comment/), typescript-eslint, official docs.
    - Defaults: `minimumDescriptionLength: 3, 'ts-check': false, 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true`. In recommended.
    - Verified.
  - [Google TypeScript Style Guide: @ts-ignore](https://google.github.io/styleguide/tsguide.html), Google, style standard.
    - Quotes: "Do not use @ts-ignore nor the variants @ts-expect-error or @ts-nocheck." and "You may use @ts-expect-error in unit tests, though you generally should not."
    - Verified; nuance added.
  - [Configure Rules: unused disable directives](https://eslint.org/docs/latest/use/configure/rules#report-unused-eslint-disable-comments), ESLint, official docs.
    - `reportUnusedDisableDirectives` defaults to "warn". CLI: `--report-unused-disable-directives` and `--report-unused-disable-directives-severity`. Descriptions go after "two or more consecutive - characters".
    - Verified.
  - [TypeScript 3.9 release notes: // @ts-expect-error](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html), Microsoft/TypeScript, 2020, official docs.
    - An unneeded directive yields "Unused '@ts-expect-error' directive." Suggested uses of `ts-ignore`: "You are in the middle of an upgrade between two different versions of TypeScript, and a line of code errors in one version but not another", and "You have a larger project and new errors have appeared in code with no clear owner".
    - Verified; added by the verifier.
- **Detect:**
  - `grep -rnE '@ts-(ignore|nocheck)' src | wc -l`.
  - `grep -rnE '@ts-expect-error\s*$' src` finds directives with no reason.
  - `grep -rnE 'eslint-disable(-next-line|-line)?\s+[^-]*$' src` finds disables with no `--` reason.
  - `npx eslint . --report-unused-disable-directives-severity error`.
- **Tools:** `ban-ts-comment`, ESLint `reportUnusedDisableDirectives`, grep.
- **Applies to:** all TS/JS.
- **When not to apply / counterpoints:**
  - Replacing a suppression may surface real type errors that need code changes.
  - While a codebase is type-checked by two compilers (TS 6 for tooling via the alias, TS 7 for `tsc`), a line that errors in only one of them cannot carry `@ts-expect-error`. The TS team's own guidance allows `@ts-ignore` there; require a reason and an issue link.
- **Fix risk:** low.

### T20-F16: Prefer ECMAScript constructs over TS-only runtime syntax
- **Grade:** A · **Verdict:** VERIFIED (Node v26 note added)
- **Rule:**
  - Turn on `erasableSyntaxOnly` (TS ≥5.8) to find enums, runtime namespaces, parameter properties and `import =`.
  - Never use `const enum` across package boundaries.
  - Replace enums with string-literal unions or `as const` objects where that is low-risk.
  - At minimum, enable `no-unsafe-enum-comparison` (recommended-type-checked).
- **Rationale:**
  - Node type stripping (stable since v24.12/v25.2) rejects these constructs. v26 removed `--experimental-transform-types`.
  - The Handbook documents the pitfalls of `const enum`.
- **Evidence:**
  - [Node.js: Modules: TypeScript](https://nodejs.org/api/typescript.html), Node.js, official docs.
    - Stable in v25.2.0 / v24.12.0; on by default since v23.6.0 / v22.18.0.
    - Unsupported: enum declarations, namespaces with runtime code, parameter properties, import aliases and decorators.
    - Recommended tsconfig includes `erasableSyntaxOnly`, `verbatimModuleSyntax` and `rewriteRelativeImportExtensions`.
    - Verified.
  - [Announcing TypeScript 5.8](https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/), Microsoft/TypeScript, 28 Feb 2025, official docs.
    - The flag disallows enums, runtime namespaces/modules, parameter properties and `import =` aliases. Quote: "it must be possible to easily erase or 'strip out' any TypeScript-specific syntax".
    - Verified.
  - [Handbook: Enums](https://www.typescriptlang.org/docs/handbook/enums.html), TypeScript Handbook, official docs.
    - Quote: "The biggest argument in favour of this format over TypeScript's enum is that it keeps your codebase aligned with the state of JavaScript". Const-enum version skew causes "surprising bugs, like taking the wrong branches of if statements". String enum members get no reverse mapping.
    - Verified.
  - [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), Google, style standard.
    - Quotes: "Code must not use const enum; use plain enum instead." and "Your code must not use the namespace Foo { ... } construct."
    - Verified.
  - [Effective TypeScript 2e, Item 72](https://effectivetypescript.com/), Vanderkam, 2024, book.
    - "Item 72: Prefer ECMAScript Features to TypeScript Features".
    - Book, confirmed via the author's site.
  - [An ode to TypeScript enums](https://blog.disintegrator.dev/posts/ode-to-typescript-enums/), Georges Haidar, 30 Apr 2025, practitioner blog.
    - Quote: "the degraded inline documentation is by far the toughest pill to swallow in moving to literal unions".
    - Verified.
- **Detect:**
  - `npx tsc --noEmit --erasableSyntaxOnly | grep -c 'error TS'`.
  - `grep -rnE '\b(const\s+)?enum\s+\w+' src`.
  - Lint ban: `no-restricted-syntax` with selector `TSEnumDeclaration` (or `TSEnumDeclaration[const=true]` for const enums only), per the typescript-eslint FAQ.
- **Tools:** tsc `--erasableSyntaxOnly`, `no-restricted-syntax`, `no-unsafe-enum-comparison`.
- **Applies to:** all TS. Mandatory under Node type stripping or single-file transpilers.
- **When not to apply / counterpoints:**
  - Google still permits plain enums.
  - Converting a numeric enum removes reverse mappings and changes `Object.keys/values` output and serialized values.
  - For a library, the conversion is an API break.
- **Fix risk:** medium.

### T20-F17: Make type-only imports explicit
- **Grade:** A · **Verdict:** VERIFIED (nuance added: inline `type` specifiers keep a side-effect import; the lint rule and the flag overlap)
- **Rule:**
  - Turn on `verbatimModuleSyntax` (TS 5.0+; it replaces the deprecated `importsNotUsedAsValues` / `preserveValueImports`).
  - Otherwise, use `isolatedModules` plus `consistent-type-imports` (in no preset, autofixable).
  - Re-export types with `export type`.
- **Rationale:** Node type stripping requires the `type` keyword. Explicit elision is deterministic.
- **Evidence:**
  - [TSConfig: verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html), Microsoft/TypeScript, official docs.
    - Quotes: "Any imports or exports without a type modifier are left around. Anything that uses the type modifier is dropped entirely." With ESM syntax and CommonJS output, "Instead, you'll get an error." `importsNotUsedAsValues` and `preserveValueImports` are "being deprecated in its favor".
    - Verified.
  - [consistent-type-imports](https://typescript-eslint.io/rules/consistent-type-imports/), typescript-eslint, official docs.
    - Quote: "The rule will not report any errors in files that contain decorators when both experimentalDecorators and emitDecoratorMetadata are turned on." `fixStyle` takes `separate-type-imports` (default) or `inline-type-imports`.
    - Comparison table: under `verbatimModuleSyntax`, `import { type T } from 'T'` emits `import {} from 'T'`, so the module still loads. Using both mechanisms "can lead to conflicting and/or duplicate reports".
    - Verified.
  - [Node.js: Modules: TypeScript](https://nodejs.org/api/typescript.html), Node.js, official docs.
    - The `type` keyword is mandatory for type stripping; a missing `type` gives a runtime error.
    - Verified.
  - [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), Google, style standard.
    - Quote: "Use export type when re-exporting a type".
    - Verified.
- **Detect:**
  - Migration size: `npx tsc --noEmit --verbatimModuleSyntax | grep -c 'error TS'`.
  - Lint: `consistent-type-imports` with `fixStyle: 'inline-type-imports'`.
  - First check `grep -rn 'emitDecoratorMetadata' tsconfig*.json`.
- **Tools:** tsc, `consistent-type-imports`.
- **Applies to:** TS projects; required with Node type stripping and esbuild/swc/Babel/Vite.
- **When not to apply / counterpoints:**
  - Imports that used to be elided now execute, so side effects and new runtime cycles can appear.
  - CommonJS emit from ESM syntax errors out.
  - Projects using `emitDecoratorMetadata` (NestJS, TypeORM, older Angular DI) must not convert decorator-referenced imports to `import type`.
  - Inline `import { type X } from 'm'` still leaves `import {} from 'm'` under `verbatimModuleSyntax`. To drop the module load entirely, use top-level `import type { X } from 'm'`.
  - Pick one enforcement mechanism (tsc via `verbatimModuleSyntax`, or the lint rule) to avoid duplicate reports.
- **Fix risk:** medium.

### T20-F20: Remove deprecated APIs and toolchain options
- **Grade:** A · **Verdict:** CORRECTED
  - `outFile` was already **removed in TS 6.0**, not only deprecated.
  - The TS 7 speed figures are "10x" as a headline, "8x and 12x" on typical full builds, and VS Code 125.7 s → 10.6 s (11.9x).
  - TS 7.1 is expected to ship a new API.
- **Rule:**
  - Enable `no-deprecated` (strict-type-checked).
  - Clear the options that TS 7 no longer supports: `target: es5`, `downlevelIteration`, `moduleResolution: node/node10/classic`, `module: amd/umd/systemjs/none`, `baseUrl`, and `esModuleInterop` / `allowSyntheticDefaultImports: false`.
  - Remove `outFile`; it is already gone in TS 6.0.
  - Move ESLint to v10 flat config.
  - For typescript-eslint on TS 7, alias `typescript` to `@typescript/typescript6`, and install TS 7 alongside it as `"@typescript/native": "npm:typescript@^7.0.2"`. This is the TS 7 post's recipe; the alias alone leaves you with only a `tsc6` binary.
- **Rationale:** Deprecated options are removed in TS 7, and APIs tagged `@deprecated` are future breakages.
- **Evidence:**
  - [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), Daniel Rosenwasser / Microsoft, 8 Jul 2026, official docs.
    - Removed/unsupported: "target: es5 is no longer supported", "downlevelIteration", "moduleResolution: node/node10", "classic", "module: amd, umd, systemjs, none", "baseUrl".
    - Quote: "TypeScript 7 does not yet expose a stable programmatic API". Alias: `"typescript": "npm:@typescript/typescript6@^6.0.2"`, recommended because "some tools like typescript-eslint expect to import from typescript directly". Quote: "doing this will leave you only with a tsc6 executable". To get TS 7's `tsc`, add `"@typescript/native": "npm:typescript@^7.0.2"`.
    - Speed: VS Code 125.7 s → 10.6 s.
    - Verified.
  - [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/), Microsoft, 23 Mar 2026, official docs.
    - Quote: "The --outFile option has been removed from TypeScript 6.0". The deprecation list also covers `--alwaysStrict false`, legacy `module` namespace syntax, and `asserts` on imports.
    - Verified.
  - [Dependency Versions](https://typescript-eslint.io/users/dependency-versions/), typescript-eslint, official docs.
    - TypeScript `>=4.8.4 <6.1.0`; ESLint `^8.57.0 || ^9.0.0 || ^10.0.0`.
    - Verified.
  - [no-deprecated](https://typescript-eslint.io/rules/no-deprecated/), typescript-eslint, official docs.
    - Quote: "Disallow using code marked as @deprecated". In strict-type-checked; editors only show a strikethrough.
    - Verified.
  - [ESLint blog](https://eslint.org/blog/), ESLint, official.
    - Quote: "ESLint v9.x reached end-of-life on 2026-08-06 and is no longer maintained."
    - Verified.
- **Detect:**
  - `grep -nE '"(baseUrl|outFile|downlevelIteration)"|"moduleResolution"\s*:\s*"(node|node10|classic)"|"target"\s*:\s*"es5"|"(esModuleInterop|allowSyntheticDefaultImports)"\s*:\s*false' tsconfig*.json`.
  - `ls .eslintrc* 2>/dev/null` finds legacy config, which is ignored on v10.
  - Check versions: `npx eslint --version`, `npx tsc -v`.
- **Tools:** `no-deprecated`, tsc 6/7, ESLint v10.
- **Applies to:** all TS/JS projects hardened from late 2026 on.
- **When not to apply / counterpoints:**
  - Removing `baseUrl` means rewriting `paths`.
  - Changing `moduleResolution` can change which files resolve.
  - Per the TS 7 post, Vue, MDX, Astro, Svelte and Volar-based tooling "will likely not yet be able to leverage TypeScript 7", and Angular needs TS 6 for editor support.
- **Fix risk:** medium.

### T20-F09: Validate untrusted data at trust boundaries; do not assert it
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Replace `JSON.parse(x) as T`, `await res.json() as T`, `process.env.X!` and `{} as Foo` with runtime validation. Options: a schema library, JSON Schema + Ajv, or code generated from OpenAPI/GraphQL.
  - Inside the codebase, prefer annotations or `satisfies` to `as`.
  - Forbid object-literal assertions: `consistent-type-assertions` with `objectLiteralTypeAssertions: 'never'`. Note that the rule's default is `'allow'` and it sits in the stylistic preset.
  - Flag `!` with `no-non-null-assertion` (strict preset).
- **Rationale:**
  - Types are erased at runtime.
  - `as` and `!` "only silence the TypeScript compiler".
  - An object-literal assertion also hides missing required fields.
- **Evidence:**
  - [Google TypeScript Style Guide: Type and non-nullability assertions](https://google.github.io/styleguide/tsguide.html), Google, style standard.
    - Quotes: "Type assertions (x as SomeType) and non-nullability assertions (y!) are unsafe. Both only silence the TypeScript compiler, but do not insert any runtime checks" and "you should not use type and non-nullability assertions without an obvious or explicit reason".
    - Verified.
  - [consistent-type-assertions](https://typescript-eslint.io/rules/consistent-type-assertions/), typescript-eslint, official docs.
    - Quote: "const x: { foo: number } = {}; will fail to compile, but const x = {} as { foo: number } will succeed." `objectLiteralTypeAssertions` takes allow (default), allow-as-parameter or never.
    - Verified.
  - [Item 74: Know How to Reconstruct Types at Runtime](https://effectivetypescript.com/2024/10/31/runtime-types/), Dan Vanderkam, 31 Oct 2024, book excerpt on the author's blog.
    - Quote: "TypeScript types aren't 'real': they're erased at runtime". Three options: generate from a specification (OpenAPI/GraphQL/JSON Schema) + Ajv, a runtime library such as Zod, or typescript-json-schema + Ajv. Libraries are called "contagious".
    - Verified.
  - [Node.js Best Practices §2.11](https://github.com/goldbergyoni/nodebestpractices), Goldberg et al., practitioner guide.
    - Quote: "Assert API input to avoid nasty bugs that are much harder to track later … using a modern validation library like ajv, zod, or typebox".
    - Verified.
  - [no-non-null-assertion](https://typescript-eslint.io/rules/no-non-null-assertion/), typescript-eslint, official docs.
    - Quote: "Using assertions to tell the type system new information is often a sign that code is not fully type-safe." In the strict preset; suggestions only.
    - Verified.
- **Detect:**
  - ast-grep: `JSON.parse($X) as $T`, `(await $R.json()) as $T`, `$X as unknown as $T`.
  - `grep -rnE 'as unknown as|JSON\.parse\([^)]*\)\s+as\s|process\.env\.[A-Z_]+!' src`.
  - Lint: `consistent-type-assertions`, `no-non-null-assertion`, `no-unnecessary-type-assertion` (recommended, autofixable).
- **Tools:** ast-grep, the typescript-eslint rules above, Zod / Ajv / OpenAPI codegen.
- **Applies to:** HTTP handlers, queue consumers, config/env loading, file and DB reads, third-party API clients.
- **When not to apply / counterpoints:**
  - VS Code allowed `!` freely in tests.
  - Schema libraries are "contagious" and bring a second type syntax.
  - Trusted internal boundaries may not justify the cost.
- **Fix risk:** high. Validation can reject data that used to be accepted.

### T20-F14: Remove barrel files in application code
- **Grade:** B · **Verdict:** CORRECTED
  - Atlassian's "88% fewer tests" comes from their dependency-graph-based test selection ("only runs tests for affected areas"). It is not a general effect, and projects that run the whole suite on every commit will not see it.
  - Biome's `noReExportAll` was confirmed to exist (performance group, v1.6.0).
  - `noBarrelFile` is not enabled by default.
  - Hagemeister acknowledged his benchmark setup is synthetic.
- **Rule:**
  - In app code, remove barrel files (an `index.ts` that re-exports its siblings) and import from the defining module.
  - Keep a single barrel only at a published library's package entry point.
  - Enforce with Biome `performance/noBarrelFile` and `noReExportAll`, or an equivalent ESLint rule.
  - Migrate with a codemod, in waves.
- **Rationale:** ESM must evaluate every module a barrel re-exports. Reported effects:
  - Hagemeister: "many tasks 60-80% faster" (a claim from a synthetic benchmark plus his experience).
  - TkDodo: 68% fewer modules loaded.
  - Atlassian: 75% fewer build minutes and 88% fewer unit tests run. The test reduction depends on their affected-test selection.
- **Evidence:**
  - [The barrel file debacle](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/), Marvin Hagemeister, 8 Oct 2023, engineering blog.
    - Benchmark: 500 empty modules load in 0.15 s, 50,000 in 48.44 s. Quotes: "It's a common misconception among JavaScript developers that modules would only be loaded when needed" and "a free optimization you can apply that makes many tasks 60-80% faster".
    - Verified. On HN he says: "the setup shown in the article is synthetic".
  - [Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files), Dominik Dorfmeister, 26 Jul 2024, engineering blog.
    - Data: over 11k modules taking 5-10 s, cut by 68% (to about 3.5k). Quote: "bundlers crash with the weirdest of error messages". A library entry point is the exception.
    - Verified.
  - [Faster builds by removing barrel files](https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files), Tim Sebastian / Atlassian, 26 Jun 2025, engineering blog.
    - Data: "75% reduction in build minutes consumed"; 88% fewer unit tests (1,600 → 200); almost 100,000 files changed with a fixable ESLint rule, landed in three waves.
    - Caveats: modest bundle-size change, lost encapsulation, more coupling.
    - Mechanism quote: "We use a dependency graph-based test selection system … only runs tests for affected areas. By reducing the effective dependency graph through removing barrel files, the number of 'affected tests' dropped significantly."
    - Verified in the raw page.
  - [noBarrelFile](https://biomejs.dev/linter/rules/no-barrel-file/) and [noReExportAll](https://biomejs.dev/linter/rules/no-re-export-all/), Biome, official docs.
    - Performance group, since v1.6.0. Quote: "Avoid barrel files, they slow down performance, and cause large module graphs with modules that go unused." Not recommended by default; ignores `.d.ts` files and type-only exports.
    - Verified.
  - [HN discussion 37814701](https://news.ycombinator.com/item?id=37814701), Hacker News, Oct 2023, practitioner forum.
    - Quotes: "This is the kind of thing that should be fixed by improving tooling" (Sophistifunk) and "There are typically useful ways (tools) in most bundlers to tree shake barrel files" (TheFragenTaken). The author mentions 3000-6000 barrel files and 30-60k modules.
    - Verified via the Algolia API.
- **Detect:**
  - `find src -name 'index.[jt]s*' -exec grep -lE '^export (\*|\{[^}]*\}) from' {} +`.
  - Biome config: `{"linter":{"rules":{"performance":{"noBarrelFile":"error","noReExportAll":"error"}}}}`.
  - Measure before and after: test wall time, dev-server module count, `tsc --extendedDiagnostics`.
- **Tools:** Biome, a codemod (jscodeshift or ast-grep), madge.
- **Applies to:** application code, especially large apps using Jest/Vitest and dev servers. Not a library's public entry point.
- **When not to apply / counterpoints:**
  - The evidence is mostly about dev servers, tests and CI minutes. Production bundles may tree-shake barrels (`sideEffects: false`).
  - The 88% test reduction needs affected-test selection (Nx/Turborepo-style or custom). Without it, expect gains only in module-load time.
  - Removal changes module evaluation order and can break code that relied on a barrel's import side effects.
  - Atlassian reports lost encapsulation.
- **Fix risk:** medium.

### T20-F02: Enable selected flags beyond `strict`, sized to the error count
- **Grade:** B (was A) · **Verdict:** CORRECTED
  - The Total TypeScript cheat sheet (published 2023-09-13, last changelog entry 2024-04-23, not 2025) enables only `strict`, `noUncheckedIndexedAccess` and `noImplicitOverride`.
  - Pocock explicitly calls `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch` "too 'noisy'", to be added "only if you want them".
  - Only the community `@tsconfig/strictest` enables all of them.
  - The researcher's "enable unconditionally" rule is therefore reduced to `noImplicitOverride`. The other two flags become opt-in, and the grade is lowered.
  - The Zod `exactOptionalPropertyTypes` pain point (HN, Oct 2024) is partly outdated: Zod merged `.exactOptional()` in Dec 2025 (issue #635).
- **Rule:**
  - On top of `strict`, enable `noImplicitOverride`. It is recommended by both Total TypeScript and `@tsconfig/strictest`.
  - Enable `noUncheckedIndexedAccess` when its error count is manageable.
  - Treat `noFallthroughCasesInSwitch` and `noImplicitReturns` as opt-in house-style strictness. They are in `@tsconfig/strictest` but called "too noisy" by Pocock. Measure the error count before deciding.
  - Enable `exactOptionalPropertyTypes` only if your schema and validation libraries support it. Zod versions that ship `.exactOptional()`, Valibot and TypeBox all distinguish `?` from `| undefined`.
  - Fix index-access errors by restructuring (for-of, `.at()` plus a check), never by sprinkling `!`.
- **Rationale:**
  - None of these flags is in `strict`.
  - The TS team keeps `noUncheckedIndexedAccess` out of `strict` because it is noisy. Pocock, by contrast, says it "should really be included in strict".
- **Evidence:**
  - [TypeScript 4.1 release notes: Checked Indexed Accesses](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-1.html), Microsoft, 2020, official docs.
    - Quote: "it might be noisy for a lot of code, so it is not automatically enabled by the strict flag". Also: "If you don't need the indexes, you can iterate over individual elements by using a for-of loop or a forEach call."
    - Verified.
  - [TSConfig: exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html), Microsoft, official docs.
    - Error text: "Type 'undefined' is not assignable to type '"dark" | "light"' with 'exactOptionalPropertyTypes: true'."
    - Verified.
  - [tsconfig/bases strictest.json](https://github.com/tsconfig/bases/blob/main/bases/strictest.json), tsconfig/bases (community), v2.0.0, community preset.
    - Enables strict, allowUnusedLabels/allowUnreachableCode false, exactOptionalPropertyTypes, noFallthroughCasesInSwitch, noImplicitOverride, noImplicitReturns, noPropertyAccessFromIndexSignature, noUncheckedIndexedAccess, noUnusedLocals/Parameters and isolatedModules.
    - Verified against the raw file.
  - [TSConfig Cheat Sheet](https://www.totaltypescript.com/tsconfig-cheat-sheet), Matt Pocock, published 2023-09-13, last changelog 2024-04-23, practitioner blog.
    - Strictness block: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`. Quotes: "Prevents you from accessing an array or object without first checking if it's defined … should really be included in strict", and "These options include lots of rules which I consider too 'noisy', like noImplicitReturns, noUnusedLocals, noUnusedParameters, and noFallthroughCasesInSwitch. I recommend you add these rules to your tsconfig.json only if you want them."
    - Verified in the raw page; scope of the claim corrected.
  - [Zod issue #635: .optional() and --exactOptionalPropertyTypes](https://github.com/colinhacks/zod/issues/635), Zod issue tracker, 2021–2025.
    - Final maintainer comment (31 Dec 2025): "Merged `.exactOptional()` in https://github.com/colinhacks/zod/pull/5589".
    - Verified via the GitHub API; added by the verifier. The release version that ships it was not checked.
  - [Strict null checking the VS Code codebase](https://code.visualstudio.com/blogs/2019/05/23/strict-null), Matt Bierner / Microsoft, May 2019, engineering blog.
    - Data: 1800 files, over 500k lines, 4500 errors. A separate strict-null config started with zero files, with a CI check. The fixes were not automated. Quote: "introduced a few new bugs". `!` was used more freely in tests.
    - Verified.
- **Detect:**
  - Size each flag before committing to it: `npx tsc -p . --noEmit --noUncheckedIndexedAccess | grep -c 'error TS'` (same for the other flags).
  - After enabling, find the anti-pattern fix: `grep -rnE '\]!' src`.
  - Report new `!` uses with `no-non-null-assertion`.
- **Tools:** tsc, `@tsconfig/strictest`, `no-non-null-assertion`.
- **Applies to:** TS apps and libraries.
- **When not to apply / counterpoints:**
  - The TS team calls `noUncheckedIndexedAccess` noisy. HN users expect "errors all over the place".
  - `exactOptionalPropertyTypes` was a pain point with Zod (HN 41790557, Oct 2024). Zod has since merged `.exactOptional()` (Dec 2025), so check the installed version before ruling the flag out.
  - `noFallthroughCasesInSwitch` and `noImplicitReturns` are contested: `@tsconfig/strictest` enables them, and Pocock calls them "too noisy".
  - VS Code's migration took months. On a finished project, prefer a separate tsconfig that grows over time.
- **Fix risk:** medium.

### T20-F24: Do not mass-add explicit return types as "hardening"
- **Grade:** B · **Verdict:** VERIFIED (a supporting quote added)
- **Rule:**
  - Do not turn on `explicit-function-return-type` / `explicit-module-boundary-types` as a blanket hardening step. Both are in no preset.
  - Require explicit types on exported API only where it pays: libraries (especially with `isolatedDeclarations`), complex or recursive return types, and type-check hotspots.
- **Rationale:**
  - Google leaves return-type annotations to the author, and says a project-wide requirement is a local policy.
  - typescript-eslint says you don't need the rule unless the clarity is worth the cost or type-check performance matters.
- **Evidence:**
  - [Google TypeScript Style Guide: Return types](https://google.github.io/styleguide/tsguide.html), Google, style standard.
    - Quote: "Whether to include return type annotations for functions and methods is up to the code author … Projects may have a local policy to always require return types, but this is not a general TypeScript style requirement."
    - Verified.
  - [explicit-function-return-type](https://typescript-eslint.io/rules/explicit-function-return-type/), typescript-eslint, official docs.
    - Quote: "If you don't find the added cost of explicitly writing function return types to be worth the visual clarity, or your project is not large enough for it to be a factor in type checking performance, then you will not need this rule."
    - Verified.
  - [TSConfig: isolatedDeclarations](https://www.typescriptlang.org/tsconfig/isolatedDeclarations.html), Microsoft, TS 5.5, official docs.
    - Quote: "Require sufficient annotation on exports so other tools can trivially generate declaration files."
    - Verified.
- **Detect:**
  - Libraries: `npx tsc --noEmit --declaration --isolatedDeclarations`.
  - Apps: no action unless `tsc --extendedDiagnostics` shows hotspots.
- **Tools:** tsc `--isolatedDeclarations`, optional `explicit-module-boundary-types`.
- **Applies to:** libraries at export boundaries; applications generally no.
- **When not to apply / counterpoints:**
  - This user's own global coding standard requires explicit return types everywhere. That is a legitimate house style that Google explicitly allows as a "local policy", but it is not a hardening requirement.
  - Mass-annotating can freeze an over-wide inferred type into the API.
- **Fix risk:** low.

### T20-F21: Biome and oxlint are fast complements, not verified drop-in replacements for typed rules
- **Grade:** B · **Verdict:** CORRECTED. The claimed contradiction ("Biome's rule page claims comprehensive coverage") could not be found. The rule page carries no such text and marks `noFloatingPromises` as **nursery (experimental)**, with an *unsafe* "Add await" fix. The 75% figure dates from June 2025.
- **Rule:**
  - If you switch linters, first confirm on your own codebase that the promise and `any` rules still fire.
  - Formatting belongs to Prettier's or Biome's `--check`, not to ESLint plugins.
  - Turn off the import rules that duplicate TypeScript's checks.
- **Rationale:**
  - Biome's own figure is about 75% of typescript-eslint's floating-promise detections.
  - oxlint type-aware mode claims 59 of 61 rules and needs TS 7.
- **Evidence:**
  - [Biome v2 announcement](https://biomejs.dev/blog/biome-v2/), Biome, 17 Jun 2025, vendor docs.
    - Quote: "Our noFloatingPromises rule can detect floating promises in about 75% of the cases that would be detected by using typescript-eslint, at a fraction of the performance impact."
    - Verified. The figure is self-reported and may be outdated.
  - [Biome noFloatingPromises](https://biomejs.dev/linter/rules/no-floating-promises/), Biome, 2026, vendor docs.
    - Quote: "This rule is part of the nursery group. This means that it is experimental and the behavior can change at any time." The fix is labelled "Unsafe fix: Add await operator".
    - Verified; added by the verifier.
  - [Oxlint: Type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html), Oxc, 2026, vendor docs.
    - Quote: "Type-aware linting currently supports 59 out of 61 type-aware rules from typescript-eslint". Requires TypeScript 7.0+ and `oxlint-tsgolint`; "very large codebases may encounter high memory usage".
    - Verified.
  - [Typed linting performance](https://typescript-eslint.io/troubleshooting/typed-linting/performance/), typescript-eslint, official docs.
    - Use Prettier's `--check` instead of eslint-plugin-prettier. Avoid `**/*` include globs.
    - Disable import/named, namespace, default, no-named-as-default-member and no-unresolved.
    - Run import/no-cycle, no-unused-modules and no-deprecated only at CI/push time.
    - Verified.
  - [HN thread 44588258](https://news.ycombinator.com/item?id=44588258), renewiltord / WorldMaker, Jul 2025, practitioner forum.
    - A codebase that "took minutes to compile" and "could not behave correctly without a linter rule no-floating-promises". The reply suggests `deno lint`/oxlint in the inner loop and ESLint as a CI-mostly second pass.
    - Verified via Algolia.
- **Detect:**
  - Run `npx eslint . -f json` with only the typed rules, and `npx oxlint --type-aware -f json` (or `biome lint --reporter=json`).
  - Diff the hit sets on the same commit before retiring ESLint.
  - `grep -n 'eslint-plugin-prettier\|import/named\|import/no-unresolved' eslint.config.*`.
- **Tools:** typescript-eslint, oxlint + oxlint-tsgolint, Biome v2, Prettier `--check`.
- **Applies to:** projects choosing or tuning a lint stack.
- **When not to apply / counterpoints:** For small projects, typed ESLint takes seconds, and a second linter only adds config drift.
- **Fix risk:** low.

### T20-F15: Detect and break runtime circular imports (ignoring type-only edges)
- **Grade:** C · **Verdict:** VERIFIED (maintenance note added)
- **Rule:**
  - Run madge, or `import/no-cycle` in CI only.
  - Treat each value-level cycle as a defect.
  - Fix by extracting shared code into a lower-level module, or by using `import type`.
- **Rationale:** Cycles cause bundler failures (TkDodo). Both tools can skip type-only imports. typescript-eslint recommends running `import/no-cycle` only at CI or push time.
- **Evidence:**
  - [madge README](https://github.com/pahen/madge), pahen, README.
    - `madge --circular`, `--extensions`. The TS config is `"detectiveOptions": {"ts": {"skipTypeImports": true}}`.
    - Verified. **The latest npm release is 8.0.0 (Aug 2024), with no release for over 2 years.**
  - [import/no-cycle](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md), eslint-plugin-import, docs.
    - Quote: "This rule is comparatively computationally expensive." It ignores `import type`; options `maxDepth` and `ignoreExternal`.
    - Verified. The latest release is 2.32.0 (Jun 2025). A maintained fork, eslint-plugin-import-x, exists (not verified here).
  - [Typed linting performance](https://typescript-eslint.io/troubleshooting/typed-linting/performance/), typescript-eslint, official docs.
    - `import/no-cycle` belongs at CI/push time.
    - Verified.
- **Detect:**
  - `npx madge --circular --extensions ts,tsx src/` with a `.madgerc` that sets skipTypeImports.
  - A CI-only ESLint override: `'import/no-cycle': ['error', { ignoreExternal: true }]`.
- **Tools:** madge, `eslint-plugin-import(-x)` `no-cycle`.
- **Applies to:** medium and large TS/JS apps.
- **When not to apply / counterpoints:**
  - Some cycles are harmless when references are only used inside functions called after initialisation.
  - Breaking a cycle can reorder initialisation side effects.
  - The evidence for cycles as a defect source is mostly anecdotal, hence grade C.
- **Fix risk:** medium.

### T20-F23: Audit dependencies with e18e, then remove unused ones with knip
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:**
  - Use `@e18e/eslint-plugin` (`ban-dependencies`, backed by the module-replacements manifests) to find packages that native APIs or maintained alternatives can replace.
  - Remove unused dependencies with knip.
  - Replace a dependency only after checking that the native API has identical semantics for the project's usage.
- **Rationale:** Curated community manifests list native, micro-utility and "preferred" replacements. Fewer dependencies means a smaller supply-chain surface.
- **Evidence:**
  - [@e18e/eslint-plugin](https://github.com/e18e/eslint-plugin), e18e, v0.8.1 (Sep 2026), README.
    - Categories: modernization (prefer-array-at, prefer-object-has-own, …), module replacements (`ban-dependencies`), performance. Presets: `recommended`, `modernization`, `moduleReplacements`, `performanceImprovements`. It can lint `package.json`.
    - Verified.
  - [module-replacements](https://github.com/es-tooling/module-replacements), e18e / es-tooling, v3.4.0 (Sep 2026), README.
    - Repo description: "A manifest of JS modules and their more modern/active replacements". The README calls the micro-utility list "more opinionated" and the preferred list "very opinionated".
    - Verified.
  - [eslint-plugin-depend](https://github.com/es-tooling/eslint-plugin-depend), es-tooling, README.
    - Quote: "help detect dependency tree bloat and redundant polyfills". Also: "The functionality of this plugin is now available in the @e18e/eslint-plugin".
    - Verified.
- **Detect:**
  - `npx knip --include dependencies,unlisted,binaries`.
  - Add `e18e.configs.moduleReplacements` and lint `package.json` together with the source.
  - List call sites per flagged package before replacing it.
- **Tools:** `@e18e/eslint-plugin`, module-replacements, knip.
- **Applies to:** Node and browser JS/TS.
- **When not to apply / counterpoints:**
  - The lists are self-described as opinionated.
  - Native replacements can differ in edge cases such as deep clone or date parsing.
  - There is no measured outcome data, hence grade C.
- **Fix risk:** medium.

## Practitioner voice

- [Atlassian: faster builds by removing barrel files](https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files) (Jun 2025). About 100k files changed with a fixable ESLint rule, landed in three waves. 75% fewer build minutes, 88% fewer unit tests run (1,600 → 200), 73% lower unit-test runtime. Caveats: modest bundle-size change, lost encapsulation.
- [TkDodo: Please stop using barrel files](https://tkdodo.eu/blog/please-stop-using-barrel-files) (Jul 2024). A Next.js app went from over 11k modules (5-10 s) to 68% fewer. Barrels in the same directory cause cycles that crash bundlers. One barrel as a library entry point is fine.
- [HN: barrel-file debacle thread](https://news.ycombinator.com/item?id=37814701) (Oct 2023). The author cites real projects with 3000-6000 barrel files and 30-60k modules, and admits the article's setup is synthetic. Dissent: "should be fixed by improving tooling"; bundlers can tree-shake; `sideEffects: false` helps.
- [HN: no-floating-promises and lint speed](https://news.ycombinator.com/item?id=44588258) (Jul 2025). A production TS codebase "could not behave correctly without" `no-floating-promises`, but ESLint was "a 5 minute affair". Knex's thenable query builders forced blanket suppressions. Replies suggest `void` for intentional fire-and-forget, and deno lint/oxlint in the inner loop with ESLint in CI.
- [HN: Copilot review "fix" critique](https://news.ycombinator.com/item?id=42458712) (Dec 2024). Copilot's showcased fix added `await` inside a non-async (likely `useEffect`) callback. The commenter says the naive fix "leads to subtle bugs", and that `no-floating-promises` already catches the issue.
- [HN: agent fixing a missing-await race](https://news.ycombinator.com/item?id=43725905) (Apr 2025). The hardest TS bug an agent (Gemini 2.5 Pro) helped fix was "an async race condition due to missing await causing a property to be overwritten with invalid value". It still needed manual debugging input from the developer.
- [HN: typescript-eslint rules complement tsc](https://news.ycombinator.com/item?id=38655130) (Dec 2023). `no-floating-promises` and `no-unsafe-argument` catch "easily-made mistakes involving promises in a way that TypeScript doesn't on its own". `noImplicitAny` still lets `JSON.parse()` values spread as `any`.
- [VS Code: strict null checking the codebase](https://code.visualstudio.com/blogs/2019/05/23/strict-null) (May 2019). Covers 1800 files, over 500k lines and 4500 errors. The team used a separate growing tsconfig with a CI gate and did not automate fixes. It "introduced a few new bugs", and `!` was used more freely in tests.
- [HN: TypeScript enums debate](https://news.ycombinator.com/item?id=42766729) (Jan 2025). Against enums: they break type stripping and are nominal, so two versions of a shared enum package become incompatible. For: "I use TS enums like I use Java enums and I literally never have issues".
- [Georges Haidar: An ode to TypeScript enums](https://blog.disintegrator.dev/posts/ode-to-typescript-enums/) (Apr 2025). Member-level JSDoc and `@deprecated` are lost when moving to literal unions: "the toughest pill to swallow".
- [HN: exactOptionalPropertyTypes vs Zod](https://news.ycombinator.com/item?id=41790557) (Oct 2024). Zod not distinguishing `?` from `| undefined` under the flag "has been a pain point for me". A reply (x1000) says it "was enough to nullify the benefits of using zod at all". Others point to TypeBox and Valibot, which do distinguish the two. *Partly outdated:* Zod merged `.exactOptional()` in Dec 2025.
- [HN: noUncheckedIndexedAccess migration fear](https://news.ycombinator.com/item?id=41083807) (Jul 2024). Replying to TS lead Ryan Cavanaugh ([parent](https://news.ycombinator.com/item?id=41083291)), a user expects the flag "would produce errors all over the place, and would therefore be a real pain to migrate to". He admits: "I don't have a real empirical sense of that, though."
- [HN: TS "death by a thousand cuts"](https://news.ycombinator.com/item?id=40257073) (May 2024). `strict: true` "should be called recommended" because it does not enable noFallthroughCasesInSwitch, noImplicitOverride, noImplicitReturns, noUncheckedIndexedAccess and others. Configs differ across projects. `!` invites "developer laziness".
- [HN: static gates as agent guardrails](https://news.ycombinator.com/item?id=47045380) (Feb 2026). The author of a Claude Code tooling project puts strict TS errors, Knip dead-code findings and formatting into the agent's loop to give it "immediate stderr signals so it stays on the rails".
- [Knip homepage testimonials](https://knip.dev/) (vendor-curated, weak). "Knip helped us delete ~300k lines of unused code at Vercel"; another user removed over 41k lines from a legacy codebase. Claims 40M downloads/month and 150+ plugins.

## Contradictions and open questions

**Contradictions**
- **Do static types reduce bugs?** Gao et al. (ICSE 2017) say types would detect 15% of public bugs. Bogner & Merkel (MSR 2022, correlational) found TS apps were not less bug-prone; they had better code-smell and cognitive-complexity metrics. Tang et al. (2026 preprint) say typing moved fragility toward tooling and config. Node Best Practices' "80% not caught" restates Gao and is not independent. Net: the type gate is necessary but far from sufficient.
- **Tang et al. are internally inconsistent.** The prose gives Tooling/Config 27.8%, API Misuse 14.5%, Async 3.6%. The table counts give 172, 88 and 21 of 633, i.e. 27.2%, 13.9% and 3.3%. The abstract also stresses "asynchronous error-handling issues", yet Async plus Error Handling are small shares in the table.
- **Enums.** The Handbook, erasableSyntaxOnly, Node type stripping and Effective TS Item 72 push away from enums. Google still permits plain `enum` and bans only `const enum`. Practitioners defend enums for member-level documentation.
- **Barrel files.** Hagemeister, TkDodo, Atlassian and Biome favour removal. HN commenters say bundlers can tree-shake barrels and tooling should fix the cost. Atlassian itself lists lost encapsulation and more coupling.
- **Strictness level.** typescript-eslint limits strict-type-checked to proficient teams, and its strict presets are not semver-stable. @tsconfig/strictest pushes maximal strictness. The TS team keeps noUncheckedIndexedAccess out of `strict`, while Pocock says it "should really be included in strict".
- **Extra tsconfig flags.** @tsconfig/strictest enables noImplicitReturns, noFallthroughCasesInSwitch, noUnusedLocals and noUnusedParameters. Total TypeScript calls these same flags "too 'noisy'" and makes them opt-in.
- **Suppression comments.** Google bans @ts-ignore and @ts-nocheck and discourages @ts-expect-error (allowed in unit tests). typescript-eslint allows @ts-expect-error with a description everywhere. The TS team's own 3.9 release notes list legitimate @ts-ignore uses, for example code that errors in only one of two TS versions during an upgrade. That situation is live with the TS 6/TS 7 dual install.
- **Crash-on-rejection.** Node ≥15 crashes on unhandled rejections by default. Node Best Practices §2.10 tells you to register an `unhandledRejection` handler. Node's docs show that registering one disables the default crash unless it exits itself or `--unhandled-rejections=strict` is set. Both pieces of advice are compatible only if the handler terminates the process.
- **`void` on promises.** typescript-eslint: "Voiding a Promise doesn't handle it", yet `ignoreVoid` defaults to true. HN practitioners recommend `void` as the fire-and-forget marker.
- **`return await` everywhere versus only in try/catch.** Node Best Practices §2.12 says "Always do return await" for full stack traces. typescript-eslint's default (`in-try-catch`) requires `await` only in error-handling contexts and forbids it elsewhere.
- **Explicit return types.** The user's global standard requires them. Google calls it the author's choice and allows a project "local policy". typescript-eslint puts the rules in no preset. Only isolatedDeclarations (libraries) makes them mandatory for exports.
- **TS 7 vs lint tooling.** TS 7 is about 10x faster (VS Code 125.7 s → 10.6 s), but typescript-eslint supports only TS <6.1, so teams run two compilers through the `@typescript/typescript6` alias. Oxlint's type-aware mode, by contrast, requires TS 7.
- **AI-agent code.** Agents use `any` 9x more than humans, yet agentic TS PRs are accepted 1.8x more often (preprint). That review is not filtering this out is an inference, not a measured result.
- *Removed from the researcher's list:* "Biome's rule page claims comprehensive coverage". No such text exists on the page, which instead marks the rule experimental (nursery).
- *Confirmed from the researcher's list:* ts-prune is **not** deprecated (its README says it was "resurrected after a long hiatus"). depcheck is the unmaintained one, and its README recommends knip.

**Open questions**
- No peer-reviewed study measures the defect yield of *retrofitting* noUncheckedIndexedAccess, exactOptionalPropertyTypes or strict-type-checked on existing codebases.
- No quantitative study was found on incidents prevented by no-floating-promises / no-misused-promises. The OOPSLA 2018 "broken promises" paper (Alimadadi et al.) was not fetched.
- When will typescript-eslint support TS 7? The TS team expects a new API in 7.1. No typescript-eslint roadmap post was found.
- How much do barrel costs matter for production bundles, as opposed to dev servers, tests and CI minutes? Atlassian reports only a slight bundle-size drop.
- Biome and oxlint rule parity has only self-reported figures (75% as of Jun 2025; 59/61 rules). There is no independent measurement on real repos, and Biome's rule is still nursery.
- Practitioner coverage is skewed toward HN and engineering blogs. Reddit, Lobsters and StackExchange were not sampled.
- Effective TypeScript 2e: item titles were confirmed on the author's site TOC and the Item 74 excerpt was read. The item numbers 43/45/46/49 and the item texts were not.
- madge (last release Aug 2024) and eslint-plugin-import (last release Jun 2025) are slow-moving. Their long-term maintenance, and eslint-plugin-import-x as the successor, were not assessed.
- Which Zod release first ships `.exactOptional()` (merged Dec 2025, PR #5589) was not checked.
- Atlassian's test-count reduction depends on affected-test selection. No public measurement was found for barrel removal in a repo that runs the full suite.
- *Resolved:* Biome `noReExportAll` exists (performance group, since v1.6.0).

## Dropped findings

None. All 24 findings had at least one confirmed primary source. No finding was dropped. One contradiction claim was removed (Biome "comprehensive coverage", see above).
