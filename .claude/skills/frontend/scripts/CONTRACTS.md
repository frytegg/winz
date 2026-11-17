# /frontend scripts: interface contracts (v1.1, 2026-10)

Every script, test and reference in this skill follows this file. When a builder needs something it does not define,
it adds the smallest extension here first, in the same commit, and says so in its report. `../ARCHITECTURE.md` says
why; this file says how the pieces fit. Additions made when the contract was reconciled with the built code carry
the mark **v1.1 (2026-10)**; every shape change that /execution must know is also in `../CHANGELOG.md`. A module's
`--help` text is the authority on its own flags; this file lists what other pieces rely on.

---

## 1. Toolchain and conventions

- Node >= 20 (the owner's machine runs 24.13). Plain ESM JavaScript, `.mjs`, with `// @ts-check` on line 1 and JSDoc
  types; `pnpm run typecheck` runs `tsc --noEmit` over `scripts/**/*.mjs` (`allowJs`, `checkJs`, `strict`). No build
  step: every script runs with `node <script>.mjs`.
- Dependencies are pinned exactly in `scripts/package.json` and installed with `pnpm install --frozen-lockfile` from
  `scripts/` (its own package.json, so nothing resolves to a parent folder). Runtime dependencies:
  `playwright-core 1.59.1` (its Chromium revision 1217 is already installed in `%LOCALAPPDATA%/ms-playwright`, no
  download), `@axe-core/playwright 4.13.0`, `axe-core 4.13.0`, `opentype.js 2.0.0`, `svgo 4.1.0`, `png-to-ico 3.0.2`,
  `@adobe/leonardo-contrast-colors 1.1.0`. Dev: `typescript`, `@types/node` (exact pins in package.json). Adding a
  dependency is a contract change: justify it in the report; prefer Node built-ins.
- Tests: `node --test` (built-in runner), files `scripts/tests/**/*.test.mjs`, fixtures under `scripts/tests/fixtures/`.
  Browser tests use `lib/serve.mjs` on fixtures, never the network. `pnpm test` runs all; `pnpm test:fast` skips files
  named `*.browser.test.mjs`. **v1.1 (2026-10):** `test:fast` selects files with the glob
  `tests/**/!(*.browser).test.mjs` (Node's test-runner glob reads extglob), so a browser file is never loaded and its
  hooks never run; `--test-skip-pattern` matched test names, not file names. **2026-10-19:** `pnpm test` is
  `test:fast` then `test:browser`, which runs the browser files two at a time with a 300 s timeout per test. Under
  Node's default concurrency (one file per core but one) a 16-core Windows machine near its memory commit limit
  started a dozen headless Chromium at once and the run stalled, with no output and no failure, until killed;
  two at a time it passed 334 of 334 in about 5 min, and the timeout turns any stall into a failure.
- No network by default. Only `capture.mjs` (through `capture-gate.mjs`) and commands given an explicit `--network`
  flag may fetch. Never a CDN font, never telemetry.
- Text files are written UTF-8 with LF (`fs.writeFileSync(p, s)` with `\n` only; never CRLF). No BOM.
- Paths: accept Windows and POSIX forms; normalise with `path.resolve`; print forward slashes in reports.
- Logging: human progress to **stderr**, one line per step; machine output (`--json`) to **stdout** only; large outputs
  go to files under `--out`, never to the terminal.
- Exit codes for every CLI: `0` ok; `1` a gate failed or findings above the gate's threshold; `2` usage error (bad
  flags, missing input file); `3` environment error (no browser, no Node module, port in use). Never exit 0 after a
  caught error.
  **v1.1 (2026-10):** `capture-gate.mjs` and `capture.mjs` map every policy refusal (verdicts `skip-site`, `stop`,
  `needs-human-review`, `refused`) to exit 1 (CheckError), never to the FD19 reference gate's codes 2 to 6, which
  clash with this table; the verdict and its reason are in the `--json` output, and callers act on the verdict, never
  on the exit code alone.
- Every CLI supports `--help` (usage, flags, exit codes) and parses flags with `node:util` `parseArgs` through
  `lib/args.mjs`.
- Errors: throw `FrontendError` subclasses from `lib/errors.mjs` (`UsageError` exit 2, `EnvError` exit 3,
  `CheckError` exit 1), always with a message that says what to do.
- **v1.1 (2026-10), writes:** a check module's `run(ctx, selected)` writes large outputs only under
  `ctx.args.outDir`, with one exception: when `ctx.args.out` is absent, a module may also write its own state files
  listed in section 6.3 (`tells/<UTC>.json`, `firstview/`, `recording/<UTC>/`). When `ctx.args.out` is set
  (frontend-check was given `--out`), the state folder is read-only for the whole run: nothing is created, appended
  or excluded there, and every output goes under `ctx.args.outDir` (Q-F14, agreed with /execution).

## 2. Layout

```
scripts/
  package.json  pnpm-lock.yaml  tsconfig.json  CONTRACTS.md
  lib/          args, errors, browser, ready, serve, report, profile, paths, text, dom, color, fsutil, routes
  rules/        registry.json, load.mjs (registry loader and runner), static/<RULE-ID>.mjs, runtime/<RULE-ID>.mjs
  brief.mjs  capture-gate.mjs  capture.mjs  extract.mjs  tokens.mjs  brand.mjs  board.mjs
  slop-check.mjs  qa.mjs  coverage.mjs  firstview.mjs  brand-check.mjs  ip-check.mjs  motion-check.mjs
  recording-check.mjs  frontend-check.mjs  critique.mjs  calibrate.mjs  install-agents.mjs  check-refs.mjs
  tests/        *.test.mjs, fixtures/
```
**v1.1 (2026-10):** the skill folder also holds `ledger/past-directions.json` (the cross-project directions ledger,
section 6.3, created by the first `board.mjs record`), `CHANGELOG.md` and `HANDOFF.md`.

## 3. Shared library (`scripts/lib/`): exact API

```js
// args.mjs
export function parseCli(argv, spec)        // spec: {options: parseArgs options, help: string} -> {values, positionals}; prints help and exits 0 on --help; throws UsageError
export function isMainModule(moduleUrl)      // v1.1: true when the module is the started script, compared as real paths (case-insensitive on Windows),
                                             // so a CLI started through a symlink, junction or subst drive runs; every CLI uses it
// errors.mjs
export class FrontendError extends Error { constructor(message, {exitCode, cause}) }
export class UsageError extends FrontendError {}   // exitCode 2
export class EnvError extends FrontendError {}     // exitCode 3
export class CheckError extends FrontendError {}   // exitCode 1
export function exitWith(err)                // prints message to stderr, exits with its code (3 for unknown errors)
// browser.mjs
export async function launch({headless = true} = {})          // playwright-core chromium; env FRONTEND_CHROMIUM overrides the executable; throws EnvError with the install command if missing
export async function newContext(browser, view)                // view: Viewport (below); sets viewport, deviceScaleFactor, isMobile, hasTouch, colorScheme, reducedMotion, locale 'en-US', timezoneId 'UTC'
export async function withPage(browser, view, url, fn)         // opens a page, goto(url, {waitUntil: 'load'}), await waitReady(page), returns await fn(page), always closes
// ready.mjs
export async function waitReady(page, {timeoutMs = 15000, readyFlag = false} = {})
  // waits: document.readyState === 'complete'; document.fonts.ready; every <img> complete; if readyFlag, window.__FRONTEND_READY__ === true; then two animation frames. Never 'networkidle'.
// serve.mjs
export async function serveStatic(dir, {port = 0, spaFallback = true} = {})   // node:http static server -> {url, close()}; correct MIME types; SPA fallback to index.html for extensionless paths
// report.mjs
export function gate(id, title, ifDropped)   // -> GateResult builder: .ok(detail, evidence?) .fail(detail, evidence?) .skip(reason)
export function aggregate(results)           // GateResult[] -> GateReport {ok, counts:{ok,fail,skipped}, gates}
export function writeReport(report, outDir, name)  // writes <outDir>/<name>.json; returns path
// profile.mjs
export function loadProfile(path?)           // reads /execution profile.json (uses its .frontend block) or a standalone frontend profile; applies defaults (section 6); validates required fields; -> Profile
export const DEFAULT_VIEWPORTS               // section 6
// paths.mjs
export function stateDir(root, profile)      // mode A '<root>/.execution/frontend', mode B '<root>/.frontend'; creates it; for mode B appends '.frontend/' to .git/info/exclude once
export function designDir(root, profile)     // '<root>/design' unless profile.paths.design
// text.mjs
export function stripComments(source, kind)  // kind: 'js'|'ts'|'jsx'|'tsx'|'css'|'html'|'vue'|'svelte'; keeps line numbers (comments replaced by spaces/newlines); string, template and regex aware
export function lineOf(source, index)        // 1-based line number
export function wordCount(text)              // Unicode word count used by every per-1,000-words rate
export function emDashRate(text)             // {count, words, per1000}; counts U+2014 only
export function normaliseText(s)             // NFKC, collapse whitespace, trim
// dom.mjs  (functions passed to page.evaluate; each returns plain JSON)
export const collectElements                 // (opts) -> [{sel, tag, role, box:{x,y,w,h}, visible, text, styles:{...whitelist}, attrs:{data-*}}]; whitelist below
export const collectText                     // () -> [{sel, text, fontSize, fontFamily, fontWeight, fontStyle, color, bg, box, inViewport, recRole}]
export const collectAnimations               // () -> [{sel, name, duration, delay, easing, iterations, properties}] from document.getAnimations()
export const selectorFor                     // (el) -> short stable CSS selector (id, data-feature, data-testid, nth-of-type chain)
// color.mjs
export function parseColor(css)              // rgb()/rgba()/#hex/hsl()/oklch()/oklab()/color(srgb ...)/'transparent' -> {r,g,b,a} in 0..1 sRGB, or null
export function toOklch({r,g,b})             // -> {l,c,h}
export function relativeLuminance(rgb)       // WCAG 2.x
export function contrastRatio(fg, bg)        // WCAG 2.x, alpha-composited over bg
export function hueOf(css)                   // degrees or null for achromatic (chroma < 0.03)
// fsutil.mjs
export function walk(root, {include, exclude})   // -> repo-relative POSIX paths; default exclude: node_modules, .git, dist, build, out, .next, coverage, .execution, .frontend, vendor
export function readText(path)               // UTF-8, strips BOM
export function writeText(path, text)        // UTF-8, LF, creates parent dirs
export function sha256File(path)
// routes.mjs
export function loadRoutes(root, profile)    // reads <design>/routes.json (section 6); default [{path:'/', name:'home', first:true, features:[]}]
export function routeUrl(base, route, profile)   // appends '?record=1' (or '&record=1') when profile.record_mode
```

Element style whitelist for `collectElements`: `display, position, visibility, opacity, color, backgroundColor,
backgroundImage, backgroundClip, webkitBackgroundClip, backdropFilter, filter, mixBlendMode, borderTop/Right/Bottom/
LeftWidth, borderTop/Right/Bottom/LeftColor, borderRadius, boxShadow, fontFamily, fontSize, fontWeight, fontStyle,
letterSpacing, textTransform, lineHeight, textAlign, marginTop/Bottom, paddingTop/Right/Bottom/Left, gap, transition,
transitionProperty, transitionDuration, transitionTimingFunction, animationName, transform, pointerEvents, zIndex,
cursor, gridTemplateColumns`.

**v1.1 (2026-10), library extensions as built** (every v1 signature above still holds):

```js
// browser.mjs
withPage(browser, view, url, fn, {readyFlag, timeoutMs, navigationTimeoutMs, beforeGoto(page, context)})
                                             // fn receives (page, response); beforeGoto attaches console/request listeners before the load
                                             // an unreachable URL is an EnvError; a load that never finishes a CheckError
newContext(...)                              // defaults colorScheme 'light', reducedMotion 'no-preference'; Viewport may set both
export async function goto(page, url, timeout); export const INSTALL_HINT
newContext(browser, view, {network = false, origins = []}) // offline unless network (section 1): a request to another host is aborted
                                             // (blockedbyclient) and a WebSocket to another host is closed before it connects;
                                             // loopback, data:/blob: and the allowed origins pass. Allowed: `origins`, plus every URL
                                             // loaded through goto() or withPage() (allowOrigin(context, url) for a caller's own
                                             // page.goto). A navigation the page starts itself (location.href, meta refresh, link,
                                             // popup) to another host is aborted, and gains that host nothing (review fix 2026-10-12).
                                             // A route registered later runs first. withPage takes {network} too; ip, motion,
                                             // recording and calibrate pass their --network. Extra: leavesHost(url), originOf(url),
                                             // allowOrigin(context, url), offlineAllows(request, allowed)
// ready.mjs
waitReady(...) -> {elapsedMs, lazySkipped}   // off-screen lazy images are not waited for; a timeout is a CheckError naming every unmet condition
// serve.mjs
serveStatic(...) -> {url (no trailing slash), port, root, close()}   // 127.0.0.1 only; clean URLs, the build's 404.html, GET/HEAD, byte ranges,
                                             // Cache-Control no-store; 403 on '..', NUL, ':' on Windows and symlinks leaving the folder
// report.mjs
gate({id, title, ifDropped})                 // also accepts a GATES entry; ifDropped is required
gate(...).advise(detail, evidence?)          // v1.1: an ok marked `advisory: true`: a gate that can only warn, or whose threshold is not calibrated
                                             // yet; it never fails a run and counts.advisory (present only when > 0) counts it apart from real passes
aggregate(results, {allowSkip, requested, tool, target, at})   // allowSkip: exact ids or a bare group; requested ids with no result become skipped;
                                             // with tool: the full section 4 header; an empty list gives ok:false; duplicate ids are a TypeError
export function utcStamp(at)                 // colon-free UTC stamp for file names (2026-10-01T10-00-00Z); utcSeconds(at); GATE_ID; REPORT_VERSION
writeReport(...)                             // refuses names that are not plain file names
// profile.mjs
loadProfile(path?, {root})                   // discovery: <root>/.execution/profile.json, then <root>/.frontend/profile.json, else defaults
export function resolveProfile(raw, {path}); export function defaultProfile(overrides); export const REQUIRED_FIELDS
// paths.mjs
stateDir(root, profile, override?)           // override (--state) wins and is created; mode A needs <root>/.execution (EnvError otherwise); a root
                                             // that is not a folder is a UsageError
export function statePath(root, profile, override?)   // the same folder, resolved only: nothing created, checked or excluded (--out runs, dry runs)
export function checkStateDir(root, profile, override, out)   // review fix 2026-10-12: statePath when out (--out) is given, after checking the root
                                             // is a folder, else stateDir; every check module CLI resolves its state with it (Q-F14)
export function gitExcludeFile(start)        // info/exclude of the repository whose work tree holds start, found as git does: a .git folder
                                             // counts only with HEAD, objects/ and refs/ (a .git file only when its gitdir is one); a stray
                                             // .git/info/ (seen in a home folder) is skipped, so no exclude file outside the product repository
                                             // is ever written; null outside any repository
export function ensureExcluded(file, pattern)
// text.mjs
export function foldNeverShow(s)             // NFKC then toLowerCase(), never a full casefold (Q-F9, section 6.1b)
export function neverShowRegexProblem(pattern)   // why a regex entry is outside the JS/Python common subset, or null (section 6.1b)
export function commentRanges(source, kind)  // extra kinds scss/less/json and aliases mjs/cjs/mts/cts/htm/sass; emDashRate per1000 is 0 with no words
// dom.mjs
// ElementInfo adds meta {id, class, href, src, alt, ariaLabel, ariaHidden, type}, parent, depth; TextInfo adds bgImage, tag,
// source ('text'|'before'|'after'|'value'|'placeholder'), visible, opacity, textTransform, letterSpacing, lineHeight (invisible
// text is returned with visible:false); AnimationInfo adds type, endDelay, direction, fill, playState, pseudo, keyframes.
// Boxes are in document coordinates. Options: collectElements {root, max, textMax, svgChildren, styles}; collectText {max};
// collectAnimations {maxKeyframes}. export const STYLE_WHITELIST. The computed `transition` shorthand drops 'all': read
// styles.transitionProperty.
// color.mjs
// also hsl/hwb/lab/lch, every predefined color() space and the 148 named colours; out-of-gamut values clipped per channel as
// Chromium draws them; contrastRatio returns null for unparseable input. Extra: NAMED_COLORS, ACHROMATIC_CHROMA, composite, toHex
// fsutil.mjs
walk(root, {include, exclude, defaultExcludes = true, nocase})  // exclude adds to the defaults; symlinks are not followed; the defaults also
                                             // skip .venv, venv, site-packages, __pycache__ and .yarn (review fix 2026-10-12)
// readText and sha256File turn a missing file into a UsageError; writeText converts CRLF to LF, strips a BOM, returns the path.
// Extra: DEFAULT_EXCLUDES, compileGlob, matchGlob, sha256Text, toPosix
// routes.mjs
// routes are normalised (first, features and states always present; the first entry is first when none is marked); routeUrl
// keeps a base path prefix, merges query strings, never adds record=1 twice and refuses non-http(s) bases. Extra: DEFAULT_ROUTES
```

## 4. Gate output (the proof format)

```json
{
  "ok": false,
  "tool": "frontend-check", "version": "1", "at": "2026-10-01T10:00:00Z",
  "target": {"root": "...", "url": "...", "routes": 3, "viewports": ["desktop", "mobile"]},
  "counts": {"ok": 12, "fail": 1, "skipped": 2},
  "gates": [
    {"id": "render.console", "title": "No console errors on any route",
     "ifDropped": "a page that throws in front of the jury would pass",
     "state": "ok|fail|skipped", "detail": "one line", "evidence": [{"route": "/", "viewport": "desktop", "selector": "", "file": "", "line": 0, "value": ""}]}
  ]
}
```
`ok` is true only when no gate is `fail` AND no requested gate is `skipped` unless the caller passed `--allow-skip <id>`.
A skipped gate never counts as passing.
**v1.1 (2026-10):** with `--allow-skip <id>` (an id or a group of the run) the accepted skipped gate does not make `ok`
false, so the run can exit 0. Task proofs never pass `--allow-skip` (references/00-contract.md CT-07). Evidence entries
may carry more keys than the example: `severity` (`fail|warn|note|ok`) and `finding` (recording-check), `rule`;
`line: 0` means a file without lines (a binary favicon). frontend-check serialises a non-scalar `value` and drops an
invalid `line`, so the report always matches `assets/schemas/gate-output.schema.json`.

Target flags shared by every check CLI: `--root <repo>`, `--profile <abs path>` (an /execution profile.json, whose
`frontend` block is read, or a bare frontend block file in mode B), `--state <dir>` (overrides `stateDir()`, used
when work runs before T0 into `<workspace.private_dir>/frontend/`), and one of `--serve <dir>` (a static build),
`--url <url>` (a running app) or `--start "<cmd>" --url http://127.0.0.1:<port>` (frontend-check spawns the server,
waits until the URL answers, runs, then kills the process tree). frontend-check never builds: a proof chains the
build, for example `pnpm -C <ui> build && node <skill>/scripts/frontend-check.mjs --json --gates render,coverage
--serve <ui>/dist --profile <abs>`, so a verifier rebuilds from the landed commit, offline.

Gate ids (group.name). A group name selects the whole group (`--gates render,coverage,tells`). Gates that take
arguments read flags, never a colon syntax: `--features FR-003,FR-007` restricts `coverage.features` to those
requirement ids. Exit semantics: **exit 0 if and only if every requested gate is `ok`**; a requested gate that is
`skipped` exits 1 (agreed with /execution, whose command-proof runner reads only the exit code).

| group | gates (module) |
|---|---|
| brief | `brief.complete` (brief.mjs) |
| refs | `refs.ledger`, `refs.receipts` (extract.mjs) |
| directions | `directions.present`, `directions.screened` (board.mjs) |
| brand | `brand.candidates`, `brand.favicons`, `brand.templates`, `brand.icon-dark`, `brand.og`, `brand.drift` (brand-check.mjs) |
| tokens | `tokens.valid`, `tokens.contrast`, `tokens.leak` (tokens.mjs) |
| render | `render.console`, `render.requests`, `render.fonts`, `render.images`, `render.overflow`, `render.clipping`, `render.cls` (qa.mjs) |
| a11y | `a11y.axe`, `a11y.contrast`, `a11y.targets` (qa.mjs) |
| coverage | `coverage.features`, `coverage.metrics`, `coverage.hero`, `coverage.nevershow`, `coverage.placeholders` (coverage.mjs) |
| firstview | `firstview.contract`, `firstview.complexity` (firstview.mjs) |
| tells | `tells.tier1`, `tells.tier2`, `tells.score` (slop-check.mjs) |
| ip | `ip.fonts`, `ip.hotlinks`, `ip.logos`, `ip.provenance`, `ip.concept-label`, `ip.copy-overlap`, `ip.sponsor-marks` (ip-check.mjs) |
| motion | `motion.reduced`, `motion.hidden-at-rest`, `motion.inventory` (motion-check.mjs) |
| recording | `recording.*` (recording-check.mjs; ids G1-G16 of research FD20 as `recording.g01`...) |

`--phase build` = every group except `refs`, `directions` and `brand.candidates`, plus `recording` only when the
profile has a video format.

**v1.1 (2026-10), phases:** `--phase small` = `render`, `a11y`, `coverage`, `firstview`, `tells`, `ip`: small mode's
essential set, with no brand, tokens or motion gate (a small-mode UI is one static page with a wordmark).
`--phase full` is an alias of `--phase build`, so a task template can pass `--phase {mode}`; FE-20's proof does.
/execution's `FRONTEND.build` completion gate and H14 pass `--phase small` in small mode and `--phase build` in full
mode. With neither `--gates` nor `--phase`, frontend-check runs `--phase build` and says so on stderr; `--gates`
adds to a phase.

**v1.1 (2026-10), selection:** `--gates` tokens are group names, gate ids, `<group>.*` or `all`; repeated `--gates`,
`--features` and `--allow-skip` flags accumulate; a colon token (`coverage:FR-003`) is a usage error naming the
`--features` form. A gate id the contract names but a loaded module does not declare is reported `skipped` ("does not
declare this gate"); a module whose own `GATES` add ids to its group runs them with the group.

**v1.1 (2026-10), frontend-check flags beyond the shared ones:** `--phase build|full|small`, `--features`,
`--allow-skip <id>` (never in proofs), `--out <dir>`, `--json`, `--start-timeout <s>` (with `--start`, default 60),
and four module inputs it only passes through in `ctx.args`: `--network` (ip, motion and recording let the page's
external requests through), `--master <file>` (recording.g10), `--deck <file>` (recording.g16), `--workspace <dir>`
(brief.complete). Module flags that could weaken a proof are deliberately not exposed: `--registry`, `--rules-dir`,
`--layers`, `--rules`, `--sponsor-allowlist`, `--routes`, `--viewports`, and board.mjs's `--generic` and `--past`.

**v1.1 (2026-10), where the report goes (Q-F14):** without `--out`, the report is `<state>/gates/<UTC>.json`
(`<UTC>-2.json` and so on within one second) and large outputs go to `<state>/gates/<UTC>/`. With `--out <dir>`,
the report is `<dir>/frontend-check.json`, large outputs go to `<dir>`, and the state folder is only read: it is not
created, nothing is written into it, and no exclude line is added (`lib/paths.mjs statePath`). In mode A, `--out`
also lifts the "run /execution's bootstrap first" error, since nothing is created. A `--root` that is not an existing
folder is a usage error either way.
The module CLIs follow the same rule with their own `--out` (review fix 2026-10-12, `lib/paths.mjs checkStateDir`):
brand-check, coverage, firstview, ip-check (except `--index-copy`, whose output is a state file), motion-check,
recording-check and qa only read the state folder when given `--out`, and pass `outDir` to their module.

**v1.1 (2026-10), exit codes on module trouble:** a module file that does not exist reports its gates `skipped`
("module missing: scripts/<file> does not exist yet"), exit 1. A module that fails to import or lacks `GATES` or
`run()` fails its gates and the run exits 3. A module whose `run()` throws fails its gates and the exit code becomes
the error's own (2 for a UsageError such as a malformed input file, 3 for an EnvError or an unexpected exception).
The report is written in every case. A duplicate, malformed or invalid-state result fails its gate; unrequested ids
are dropped and logged.

Every check module exports:
```js
export const GATES = [{id, title, ifDropped}]             // static metadata
export async function run(ctx, selected)                  // -> GateResult[] for the selected ids of this module
```
with `ctx: CheckContext = {root, profile, state, design, routes, baseUrl, browser, viewports, args, log}`
(`frontend-check.mjs` builds it once, launches one browser, serves `--serve <dir>` or uses `--url`). Each module also
has a CLI that builds its own context with the same flags as frontend-check (`--root --profile --url|--serve --out
--json --gates`).

**v1.1 (2026-10), the context:**
- `ctx.browser` is `null` when only file groups are selected (`brief`, `refs`, `tokens`); `directions` and `brand`
  launch the browser because their screens and raster lints render. `ctx.baseUrl` is `null` when no `--serve`,
  `--url` or `--start` is given; modules then report the gates that need a page `skipped`, so a file-only selection
  (FE-00, FE-02, FE-03, FE-05, FE-07 before any build exists) needs no target flag.
- `ctx.state` is where the state lives (created with stateDir, or only resolved with statePath under `--out`).
- `ctx.args` holds the flags that were given, shaped as a module CLI parsing the same flags with `lib/args.mjs` sees
  them: comma lists stay one comma-separated string (`features: "FR-003,FR-007"`), paths are absolute with forward
  slashes, booleans are `true` only when given. On top: `gateIds` (the selected ids), `featureIds` (the `--features`
  list, or null), `allowSkip` (list) and `outDir` (`--out`, else `<state>/gates/<UTC>/`). Modules read: coverage
  `features`; firstview, recording `outDir`; recording `out`, `master`, `deck`; ip, motion, recording `network`;
  brief `workspace`; qa `timeoutMs` (its own CLI's `--timeout`); slop-check `rules`, `layers`, `registry`,
  `sponsor-allowlist` (its own CLI only); board `generic`, `past`, `registry`, `rulesDir` (its own CLI only).

**v1.1 (2026-10), module CLIs** (beyond `--root --profile --state --serve|--url --out --json --gates --allow-skip`;
`--help` lists each fully):

| script | commands and extra flags |
|---|---|
| brief.mjs | `--workspace <dir>`, `--check` (gate only), `--dry-run` (nothing written); writes brief.json, brief.md and `receipts/brief-discovery.json` |
| capture-gate.mjs | `check --url <https url> [--out <captures root>]`, `purge <capture folder or root> [--state]`, `policy` |
| capture.mjs | `--url --root (alias --project-root) --terms-reviewed <terms url> [--profile] [--state] [--out] [--viewports] [--slices] [--delete-by] [--dry-run]`, `--purge <folder>`; no identity, headed, proxy or retry flag exists (an identity flag exits 2) |
| extract.mjs | `[extract] [dirs...] [--out <file>]`; `validate-ledger [ledger] [--gates refs.ledger,refs.receipts]`; also exports `GATES` and `run` for the refs group |
| board.mjs | `render [--direction A\|B\|C] [--comp auto\|hero\|template]`, `screen [--direction] [--generic <dir>] [--past <file>]`, `board [--title]`, `logos [--title]`, `record [--pick A\|B\|C\|none] [--project] [--past]`, gates mode `[--gates directions...]`; `--registry`/`--rules-dir` for tests |
| brand.mjs | `wordmark`, `lint`, `render`, `icons`, `og`, `sheet`, `name-check [--out]`, `hashes <file>` (normalised identities for the template list) |
| brand-check.mjs | the brand gates; a `--serve` folder must hold the built `index.html` (a 4xx or 5xx route fails every rendered gate with how to fix it); a server-rendered app needs `--url` or frontend-check `--start` |
| tokens.mjs | `validate`, `contrast`, `leak`, `check` (default with flags only), `build [--css <file>] [--mirror <dir>] [--force] [--font-face no] [--dark-media no]`, `palette [--ground <css>] [--ground-token bg]` |
| qa.mjs | `--routes <paths>`, `--viewports <names>`, `--timeout <ms>`; with `--state` writes `<state>/gates/<UTC>-qa.json` (`-qa-2.json` and so on within one second), with `--out` only `<out>/qa.json` and the state folder is only read (Q-F14); exports `GATE_IDS`, `AXE_TAGS`, `LIMITS`, `TUNING`, `selectGates`, `judgeGate`, `planPages` |
| coverage.mjs, firstview.mjs | `--features` (coverage), `--now <ISO UTC>` (coverage); no `--start` (frontend-check owns it) |
| slop-check.mjs | `--rules <ids>`, `--layers static,runtime`, `--registry <file>`, `--sponsor-allowlist <file>`, `--ui-paths <list>` (replaces profile `paths.ui`), `--report` (prints the findings document, per-rule counts in `byRule`, instead of the gate report; exit 0 unless a detector failed); findings to `<state>/tells/<UTC>.json`, or `<out>/tells/` with `--out` (state only read). Without `--state` or `--out` and with no existing state folder it writes nothing into the repository: findings go to a fresh temp folder |
| ip-check.mjs | `--network`, `--sponsor-allowlist <file>`, `--index-copy` (writes `<state>/copy-shingles.json`) |
| motion-check.mjs | `--network` |
| recording-check.mjs | `--master <video>`, `--deck <file>`, `--network`; `--gates` accepts `G7` aliases |
| critique.mjs | `prepare [target] [--round] [--label] [--out] [--max-tiles <=10]`; `measure [target] --round --label [--ui-root] [--gates <ids> \| --gates-report <file>] [--checker <file>]` (runs frontend-check `--phase build`, or `--gates`, as a child process and prints the `measure` object of `assets/schemas/fragment-commands.schema.json`); `issues --round [--best] [--critic <file>]...`; `accept --round [--best] [--candidate] [--critic]... [--pairwise-ab] [--pairwise-ba] [--probes <dir>] [--best-gates] [--candidate-gates]` (exit 1 when the candidate is rejected); `probes --round [--probes <dir>]`; `ui-copy [target] [--out <file>]`; `--verify-receipt <receipt.json> [--root] [--ui-root]` (exit 1 when the receipt is invalid, not ok, or its `best.ui_tree` is not in HEAD); `--start` with `--start-timeout <s>` in seconds, as in frontend-check |
| calibrate.mjs | `--corpus --registry --base --out --sets --entries --viewports --layers --network --har <dir> --labels --tier1-share --min-positives --min-controls --timeout --detector-timeout --wayback-delay`; `--apply <proposal.json>` |
| check-refs.mjs | `--root <skill dir>`, `--strict` |
| install-agents.mjs | `--check`, `--dry-run`, `--force`, `--home <dir>` or `--agents-dir <dir>` |

**v1.1 (2026-10), gate notes the proofs depend on:**
- `brand.candidates` requires `<state>/brief.json` with `project.name_status` `final` and a browser (raster lint);
  `brand.drift` fails when `brand/mark.svg` is missing and skips only when there is neither a target nor an inlined
  copy in the source. An existing app can run the brand gates without a brief:
  `--gates brand.favicons,brand.templates,brand.icon-dark,brand.og,brand.drift`.
- `recording.*`: an FD20 FAIL row fails its gate; a WARN row leaves it ok with each warning in the evidence
  (`severity: "warn"`). g02, g04, g06, g08, g09 and g13 have WARN rows only, so they can never fail: their ok is
  advisory (`advisory: true`, counted in `counts.advisory`) and a verifier reads it as a note, not a passed check.
  g03 fails when no route marks any text `data-rec-role="key"` (section 6.6): the 540p tier then measured nothing. g15 fails when a package.json names an `@ledgerhq` device package and no source reads
  `requiredUserInteraction` or shows a device prompt. g16 is ok when the profile has no video or embeds mp4, and is
  skipped for a pptx or key embed until `--deck <file>` is given. g07 (CAMBI) needs ffmpeg with libx264 and libvmaf
  and is skipped without them; g10's master check needs ffprobe.
- `tells.score` with `profile.tells.score_max` null returns `ok` with "report only" in the detail. Detector errors
  and pages that never become ready make the tells gates judging those rules `fail`, never `skipped`.
- `firstview.complexity` is advisory (ok with `advisory: true`, "advisory until calibrated") until its band has
  `calibrated: true`.
- **v1.1 (2026-10), review fixes:** `--start` (frontend-check, and critique, which reuses frontend-check's
  startServer) lists the process tree before killing it, kills every listed process and checks that none survives;
  a surviving process makes the run exit 3 even when every gate passed. `--allow-skip` accepts only a gate id or
  group selected in this run.
- **v1.1 (review fix 2026-10-12), advisory oks:** a gate that judged nothing binding returns `gate(...).advise()`
  (section 3): state `ok` with `advisory: true`. `aggregate` counts it in `counts.ok` (which counts states) and
  again in `counts.advisory`, a key present only when at least one gate is advisory; frontend-check keeps the flag
  from a module's result. It never fails a run and never changes `ok` or the exit code. Gates that emit it:
  `tells.tier1` and `tells.tier2` when the run judges no rule of their tier (every registry rule is `candidate`
  until calibration), `tells.score` while `profile.tells.score_max` is null (the "report only" ok above),
  `firstview.complexity` until its band is calibrated, and recording g02, g04, g06, g08, g09 and g13 always.
- **v1.1 (review fix 2026-10-12), motion-check passes:** each page pass (one route, one viewport, `no-preference`
  or `reduce`) carries `unsettled`, the phases (`load`, `scroll`) whose settle wait timed out: motion-check's
  internal `settle()` returns false when a finite animation still runs after 4 s, so the text read then may be
  mid-animation. `motion.reduced` is `skipped`, not judged, when no animation still moves under reduce, no text
  block goes missing in a pass pair that settled, and some text block looks missing under reduce only in a pair
  where either pass's `scroll` phase did not settle; the detail names the routes and viewports and says to rerun on
  an idle machine or shorten the animation. Missing text in a settled pair still fails the gate.
- `coverage.nevershow` with no never-show file configured, or a configured file that does not exist, is `skipped`; an
  entry that cannot be checked fails it. Evidence names the entry id and the place, never the matched text.

## 5. Rule registry and detectors (`scripts/rules/`)

`registry.json`:
```json
{"version": 1, "rules": [{
  "id": "SL-T01", "family": "owner-tell|missing-tell|claude-era|generator|invented|motion|copy|web3",
  "title": "Purple-to-blue gradient", "tell": 1,
  "static": true, "runtime": true,
  "tier": "candidate|tier1|tier2|advisory",
  "anchor": false, "weight": 1,
  "scope": "what the detectors look at", "falsePositives": "documented legitimate uses",
  "fix": "fix direction", "sources": ["FD10 T01", "FD14-F07"],
  "allowlist": "sponsor-hash|category|none",
  "calibration": {"positives": {"fired": 0, "total": 0}, "controls": {"fired": 0, "total": 0}, "exemplars": {"fired": 0, "total": 0}, "date": null, "notes": ""}
}]}
```
- Detector files are named by id: `rules/static/SL-T01.mjs` and/or `rules/runtime/SL-T01.mjs`, matching the
  `static`/`runtime` flags. One file per rule per layer, so builders never edit the same file.
- Static detector: `export function detect(ctx)` with `ctx = {files: [{path, kind, text, code}], profile, allowlist}`
  where `text` is the raw source and `code` the comment-stripped source (same line numbers). Returns
  `Finding[] = [{rule, layer: 'static', file, line, excerpt (<= 120 chars), value, detail}]`.
- Runtime detector: `export async function detect(ctx)` with `ctx = {page, route, viewport, profile, allowlist,
  cache}` where `cache` memoises `collectElements`, `collectText` and `collectAnimations` per page. Returns
  `Finding[] = [{rule, layer: 'runtime', route, viewport, selector, value, detail}]`. A runtime detector may interact
  (hover, scroll, mouse path) only on a fresh page it opens through `ctx.freshPage()`, never on the shared page.
- Only rendered usages count: the runtime layer is authoritative. A static finding with no runtime confirmation is
  reported with `confirmed: false` and never fails `tells.tier1` on its own; for rules with `runtime: false` the static
  finding counts as confirmed.
- Exemptions are never by colour or by name alone: the sponsor allowlist matches official files by SHA-256
  (`../assets/sponsor-allowlist.json`), the category allowlist by rule id plus a recorded reason, and waivers come from
  `<design>/waivers.json`.
- `tells.tier1` fails when any tier-1 rule has a confirmed finding not covered by an exemption. `tells.tier2` fails
  when a tier-2 rule fires without a waiver whose `reason` and `evidence` are non-empty. `tells.score` sums the weights
  of confirmed candidate and advisory findings, counting anchor rules double, and fails above
  `profile.tells.score_max` (default: report only until calibration sets it).

**v1.1 (2026-10), findings and detectors as built:**
- A finding of a sponsor-hash rule may carry `asset` (static: a repo-relative path; runtime: a same-origin http(s)
  or `data:` URL) and/or `sha256`. slop-check hashes `file` and `asset` itself (only inside the root), fetches a
  runtime asset only from the page's own origin (no redirects) and never from another origin. Runtime SL-T01 reads
  computed CSS gradients, which have no file to hash, so a sponsor's CSS gradient is exempted only through a category
  entry or a waiver with its reason.
- Runtime findings also carry `box` (document coordinates, or null) and put `total` (instances on the page) in
  `value`; a rule reports at most 20 findings per page. `value` may hold rule-specific fields the gates and critics
  read (for example T01 `prominence`, T06 `cooccurrence`, T12 `reducedMotion`, T14 `gated`, T15 `check`, T16 `kind`
  and `trigger`, T04/T19 `sponsorFont`).
- A runtime detector may stop early inside the runner's 30 s budget and record what it covered (T12 18 s, T13 15 s,
  T14 20 s). SL-T13 and SL-T14 return nothing on a viewport without a hover-capable pointer.
  **Review fix 2026-10-12:** SL-T13 and SL-T14 no longer return an empty, clean result when the budget cuts them
  short: when probing (T13, pointer points) or hovering (T14, CTAs) stops at the budget with nothing found yet, the
  detector throws, the runner records a detector error, and the tells gates judging the rule fail (section 4). A cut
  after a finding returns the findings, whose `value` says what was covered (T13 `probed` and `points`, T14
  `hovered: {checked, of}`). SL-T12 still completes its verdict and only skips its reduced-motion reload past its
  budget, saying so in the detail. SL-T13 also returns nothing when the page registers no move listener.
- Detector files may export helpers that other detectors of the same layer import (SL-T01 gradients, SL-T03
  `emojiIn`, SL-T04 rendered fonts memoised per `ctx.cache`, SL-T05 `subtree`, SL-M01 `rendered`, SL-MO2 the
  load-time motion log in its own fresh contexts, SL-X01 number classification). A change to such an export is a
  change to every importer.
- **Review fix 2026-10-12, reachability (`rules/static/SL-T08.mjs`):** `export function mountedFiles(files) ->
  Set<string> | null` holds every file reachable from a page entry (HTML pages; Next.js app and pages routes; Vite
  and CRA `src/main` or `src/index`; SvelteKit, Remix and Nuxt routes and roots) through imports whose bindings are
  used, side-effect and dynamic imports, re-exports, `require()`, CSS `@import` and HTML script and stylesheet
  references; null when no entry is recognised, and callers then treat every file as mounted. `export function
  mountedByEntry(files) -> Array<{entry, files: Set<string>}> | null` gives one such set per page entry, seeded with
  the wrappers above it (Next.js layouts and templates, `pages/_app` and `_document`, SvelteKit `+layout`, Remix
  `app/root`, Nuxt `app.vue`); null likewise, and callers then treat the project as one page. SL-M09, SL-M11, SL-MO1
  and SL-MO5 count mounted files only (`mountedFiles`); SL-T20 (grain over a gradient) and SL-M01 (the cluster) need
  their parts inside one page entry's set (`mountedByEntry`). SL-T12, SL-T13 and SL-T14 define private functions of
  the same name and do not import these.
- Static detectors skip test, spec and story files, comments, compiled bundles (a Tailwind banner after leading
  `@import`/`@charset` rules), and CSS rules on classes no shipped file uses.
- Registry entries may carry `templateIcons: [{sha256, template}]` (SL-G02 reads it, so calibration adds template
  favicon hashes without a code change); `generated`, `note` and `grade` are allowed at the top level.
- Fixtures: `tests/fixtures/rules/<RULE-ID>/{static-pos,static-neg}/` folders and `runtime-pos.html`,
  `runtime-neg.html` (more negatives as `static-neg-<case>/`); detector tests build contexts with `rules/load.mjs`.

**v1.1 (2026-10), exemptions and gates as built (slop-check):**
- The category allowlist lives in `<design>/waivers.json` under `category: [{rule, category, reason, source}]`; an
  entry without a reason is a usage error. Sponsor-hash and category exemptions apply only when the rule's
  `allowlist` names them; a category entry for a rule whose allowlist is `none` is ignored and reported. Waivers
  apply to any rule.
- Waiver scope grammar (`waivers[].scope`): `/route` (every finding on that route); `/route <css selector>` (the
  matched element or anything inside it, tested with `Element.closest` in the live page); a bare CSS selector (every
  route); a repo file path or glob with an optional `:line` (static findings). Whole-site scopes are refused: empty,
  `*`, `**`, `site`, `all`, `global`, `everywhere`, `html`, `:root`, `body`, `document`, and `/*`, `/**`, `/**/*`
  without a narrowing selector. An invalid waiver covers nothing and is reported in the findings file.
- A waiver citing a sponsor whose allowlist entry has `colours.claimed_as_mark: true` (matched by display name or id,
  whole word, in its reason and evidence, over the whole allowlist file) is refused at every tier (FD21, TL-10).
- Confirmation: a static finding of a runtime rule is confirmed by any rendered finding of the same rule; when every
  rendered finding is exempt, the static twin takes the exemption kind `rendered`.
- `tells.tier1` accepts sponsor-hash, category and waiver exemptions; `tells.tier2` accepts waivers with a reason and
  evidence, category entries and hash-matched official files; "fires" means a confirmed finding. `tells.score` counts
  each firing rule once (co-occurrence, FD10), exempt findings add nothing, anchors count double; the findings file
  adds a per-route breakdown.
- Without a browser or a target the runtime layer does not run and gates whose rules need it are `skipped`.
- Waivers whose `rule` is a gate id (section 6.2, `coverage.features`) are read by their gate's module; slop-check
  lists them as "not in the registry" in its findings file and they never cover a tell.
- **Review fix 2026-10-12, score folding:** slop-check's `Score` (exported `scoreOf(ev, routes)`) is `{total,
  anchors, rules: [{rule, tier, weight, anchor, points, findings}], byRoute: [{route, score, rules}], collapsed:
  [{rule, into}]}`; the findings file adds `max` (profile.tells.score_max). Rules are taken by points, highest first
  (ties by id). A rule whose every counted finding sits on a place a higher-scoring rule already claimed (static:
  the same file and line; runtime: the same route, viewport and selector) adds nothing: it is left out of `rules`
  and `total` and listed in `collapsed` with the rule it was folded into, and the `tells.score` detail names each
  fold ("<rule> folded into <rule> (same places)"). One installed primitive line is one decision, not several tells.
- **Review fix 2026-10-12, `--registry`:** detectors of both layers are loaded from the `static/` and `runtime/`
  folders beside the given registry file; when neither folder exists there (a tiered copy of the registry, a
  calibration proposal), from the skill's own `scripts/rules/`.
- **Review fix 2026-10-12, `--report`:** slop-check's CLI prints the findings document (section 6.3,
  `tells/<UTC>.json`) with `--json`, or without it one line per rule in `byRule` and a closing `report: <n> rule(s)
  with findings, <m> detector error(s)` line, instead of the gate report. It exits 1 when the document records a
  detector error, else 0 whatever the gates say; usage and environment errors keep exits 2 and 3. With `--out` the
  gate report is still written to `<out>/slop-check.json`, and the gates are in the document either way.

Registry loader and runner (`rules/load.mjs`, written with `lib/` so detector builders can test against it):
```js
export function loadRegistry(path?)                      // -> {version, rules}; validates ids, flags and that each flagged detector file exists
export function sourceFiles(root, profile)               // walk() + stripComments -> [{path, kind, text, code}] for .js/.jsx/.ts/.tsx/.mjs/.vue/.svelte/.html/.css/.scss and package.json
export function loadAllowlists(root, profile)            // -> {sponsorHashes: Set<sha256>, sponsors: [...entries of assets/sponsor-allowlist.json for profile.sponsors], waivers: [...], category: [...]}
export function staticContext(root, profile, allowlist)  // -> static ctx (section 5)
export async function runtimeContext(browser, page, route, viewport, profile, allowlist)
                                                         // -> runtime ctx with cache.{elements,text,animations}() memoised and freshPage() opening a new page at the same URL and viewport
export async function runStatic(rules, ctx)              // imports rules/static/<id>.mjs for rules with static:true -> Finding[]
export async function runRuntime(rules, ctx)             // imports rules/runtime/<id>.mjs for rules with runtime:true -> Finding[]; a detector that throws yields one finding {rule, layer:'runtime', error} and never aborts the run
```
Detector tests build contexts with these same functions, never with hand-made look-alikes.

**v1.1 (2026-10), loader as built:**
```js
loadRegistry(path?, {strict})     // -> {version, rules, path, dir}; strict also flags detector files for an unflagged layer and orphan files;
                                  // every problem in one error: UsageError for a caller's path, EnvError for the skill's own registry
sourceFiles(root, profile, {paths})  // also .cjs/.mts/.cts/.htm; leaves out *.min.js, *.min.css and a profile private_dir or research folder
                                  // inside the root; .scss files are kind 'css' stripped with SCSS rules; package.json is kind 'json'.
                                  // Review fix 2026-10-12: inside a git work tree only git-visible files (gitVisibleFiles: ls-files
                                  // --cached --others --exclude-standard; null when git lists nothing, e.g. a root inside an ignored
                                  // folder), never a file in a nested work tree (nestedRepoTest: a folder holding .git, so submodules),
                                  // and with profile paths.ui (or {paths}, which replaces it) only those paths plus the package.json
                                  // files on the way down (uiScope)
loadAllowlists(root, profile, {sponsorFile})   // -> {sponsorHashes, sponsors, waivers, category, unknownSponsors}
staticContext(...)                // adds root; runtimeContext(...) adds browser and closeFresh()
runStatic(rulesOrRegistry, ctx, {dir}); runRuntime(rulesOrRegistry, ctx, {dir, timeoutMs = 30000})
                                  // detectors receive {...ctx, rule}; a static detector that throws also yields {rule, layer, error};
                                  // findings are normalised (rule and layer forced, excerpt cut to 120, route and viewport filled)
```
- **Review fix 2026-10-12, the shipped UI surface:** `staticContext(root, profile, allowlist)` returns `{root,
  files, profile, allowlist, surface}`, where `files` is `shippedSources(root, sourceFiles(root, profile), {uiPaths:
  profile.paths.ui}).files`: every static detector judges the same files, and a proof re-run from a clean checkout
  sees them too. `export function shippedSources(root, files, {uiPaths = null} = {}) -> {files, surface}` applies
  three cuts: (1) files git would not track (sourceFiles already leaves them out); (2) paths matching `export const
  NOT_SHIPPED` at any depth (test, spec, mock, fixture and story folders and files, e2e, Cypress and Playwright
  folders, `.d.ts` declarations, `.yarn/`, `.pnpm-store/`, `.venv/`, `venv/`, `site-packages/`, `__pycache__/`,
  tool caches and framework outputs such as `.cache/`, `.turbo/`, `.vercel/`, `.output/`, `.svelte-kit/`, `.nuxt/`,
  `.docusaurus/`, `.astro/`, and `.idea/`, `.vscode/`), plus `scripts/` and `tools/` folders that sit directly in a
  package folder or the root; (3) when some package (a folder with a package.json, the root included) is a UI
  package (it holds `index.html`, its folder is named like a web app, such as `web`, `frontend`, `app` or
  `dashboard`, or it depends on a UI framework or Vite), the files whose nearest package is not one; with no UI
  package every shipped file counts. Named UI paths (`profile.paths.ui`, section 6.1, or slop-check `--ui-paths`,
  which replaces it in the profile) replace cut 3: the owner's list beats the inference. `surface` is `{uiPackages:
  string[], notShipped: number, outsideUi: number, keep(paths: string[]): string[]}`: the UI package folders (`''`
  is the root; empty when none was found or the paths are named), how many source files cuts 2 and 3 left out, and
  `keep`, which applies the same cuts, the named paths and git visibility to repo-relative paths a detector walks
  itself (SL-G01's Markdown files, SL-G02's favicons and v0 asset files). Also exported: `gitVisibleFiles(root) ->
  Set<string> | null`, `nestedRepoTest(root) -> (rel) => boolean`, `uiScope(paths) -> (rel) => boolean`,
  `SOURCE_GLOBS`, `SOURCE_EXCLUDES`. Many detector files still carry their own narrower not-shipped filter; the
  shared cut runs before every static rule.
- The sponsor allowlist is read in FD21's shape (a `sponsor_allowlist` array, or `sponsors`/`entries`, or a top-level
  array), entries keyed by `sponsor` or `id`, matched case-insensitively; `sponsorHashes` holds every 64-hex `sha256`
  in the selected entries, lower-cased.
- **Q-FX-5 (agreed with /execution):** a profile sponsor id the allowlist does not know has no marks to exempt. It is
  listed in `unknownSponsors` and is never an error; every module reading sponsors follows the same rule. A missing or
  unreadable allowlist file while sponsors are named is an EnvError (the skill's own assets are broken); with no
  sponsors the file is never read.

The rule list (ids are stable; `sources` point at research): owner tells `SL-T01`-`SL-T20` (FD10 catalogue T01-T20);
missing tells `SL-M01`-`SL-M17` (FD10 catalogue M01-M17); Claude-era additions `SL-C01` pill buttons everywhere,
`SL-C02` 100vh hero, `SL-C03` everything centred (FD15); generator scaffolds `SL-G01` Figma Make signatures, `SL-G02`
create-next-app and create-vite leftovers (titles, `#aa3bff`, default favicons by normalised hash, FD12-F27), `SL-G03`
prebuilt wallet-connect defaults ("Awesome DApp", "Powered by Mesh SDK", `alert(`, FD18), `SL-G04` effect-catalogue
components (React Bits, Magic UI, Aceternity) not bound to product state (FD14); invented content `SL-X01` unsourced
metric (an element with digits styled as a stat without `data-ledger` or `data-source`), `SL-X02` placeholder names and
copy (Acme, John Doe, Jane Doe, lorem, TODO, example.com in rendered text); motion `SL-MO1` `transition: all` on
interactive elements, `SL-MO2` ease-in on UI entrances, `SL-MO3` UI durations of 500 ms or more, `SL-MO4` entrances from
`scale(0)`, `SL-MO5` motion without any `prefers-reduced-motion` handling (FD03). Every rule starts at `tier:
candidate` until `calibrate.mjs` and the owner's review set its tier.

## 6. Data contracts

### 6.1 Profile (`frontend` block of /execution's profile.json, or `.frontend/profile.json` in mode B)
```json
{
  "mode": "full|small", "run_mode": "A|B",
  "judged_surface": "site|app|site+app|video|readme",
  "format": {"stage": false, "projector_zoom": 1.25, "video": {"max_s": 180, "width": 1920, "height": 1080, "embed": "pptx|key|mp4"}, "async_readme": false},
  "viewports": [{"name": "desktop", "width": 1440, "height": 900, "dpr": 1}, {"name": "mobile", "width": 390, "height": 844, "dpr": 2, "isMobile": true, "hasTouch": true}, {"name": "reflow", "width": 320, "height": 640, "dpr": 1}],
  "record_mode": false, "ready_flag": false,
  "stack": "vite-react|next|static-html|existing", "hosting": "vercel|gh-pages|fly|existing|local",
  "external_requests": false,
  "prework_designs": {"allowed": true, "until_utc": null},
  "review_surface": "claude-design|board|terminal",
  "critique": {"rounds_max": 3, "critics": 3, "probes": 5},
  "budget": {"ui_hours": null, "tokens": null},
  "references": [{"customer": "", "url": "", "source": "", "owner_confirmed": false}],
  "sponsors": ["cardano"],
  "tells": {"score_max": null},
  "paths": {"design": "design", "claims_ledger": null, "never_show": null, "feature_catalogue": null, "spec": null, "research": null, "ui": null},
  "workspace": {"private_dir": null}
}
```
Defaults: `mode full`, `run_mode B`, the three viewports above, `review_surface claude-design`, `critique` 3/3/5,
`external_requests false`, `record_mode false`.

One truth per fact when the profile is /execution's: its top-level `prework` {code, designs, until_utc} is
authoritative (`frontend.prework_designs` only overrides it); `phase_b.claims_ledger` is the claims ledger;
`workspace.private_dir` (top level or in the block) holds captures and pre-T0 outputs. Paths are absolute and outside
the product repo, because a verifier re-runs proofs from a clean checkout.

**v1.1 (2026-10), profile as built (`lib/profile.mjs`, `assets/schemas/profile-frontend.schema.json`):**
- `judged_surface`, `stack` and `hosting` have no default: a profile file missing any of them is a usage error that
  lists every problem. With no profile file at all, `loadProfile` returns the defaults (`site`, `existing`, `local`).
- `run_mode` defaults to `A` for an /execution profile and `B` for a bare block. `critique.rounds_max` defaults to 1
  in small mode. `format.video` defaults to null; a video object's missing fields default to 180 s, 1920x1080, mp4.
- `sponsor_allowlist` is accepted as an alias of `sponsors` (the name /execution's ARCHITECTURE 4.3 uses); it may
  hold ids or FD21 entries, of which only the id is kept. An unknown id exempts nothing (Q-FX-5, section 5).
- `firstview.complexity`: the band `{min_kib, max_kib, width?, height?, dpr?, quality?, calibrated?, source?}` that
  `firstview.complexity` compares the first viewport's JPEG quality-70 size with (min_kib at most max_kib). The chain
  is this field, then `calibration/firstview-complexity.json` (same fields, written by calibration), then the
  provisional 38.1-119.7 KiB band (FD11-F05's exemplars re-encoded with Chromium). Measure with firstview.mjs's own
  settings: Chromium JPEG q70, animations disabled, caret hidden, scale device, scroll 0.
- `paths.ui` (review fix 2026-10-12): null (the whole repository), or a non-empty list of repository-relative paths
  (no `..`, not absolute) holding the judged UI's source; the static tells layer reads only those and the package.json
  files on the way down. A single string is read as a one-item list.
- Paths from top level and from the block that name the same fact must be equal, else a usage error; relative paths
  resolve against the profile file's folder and come out absolute with forward slashes. Extra Profile fields:
  `prework`, `project`, `firstview`, `source {path, kind, unknown[]}`.

### 6.1b Files shared with /execution
- **Never-show list** (`paths.never_show`, JSON; /execution's banned-phrase grep before commits and before the public
  flip reads the same file): `{version: 1, entries: [{id, class: "do-not-carry|undisclosed-security|never-public|
  embargo", pattern, regex: false, case_sensitive: false, until_utc: null, scope: "rendered|repo|both", note,
  source}]}`. An entry with `until_utc` in the past is inactive. Schema: `../assets/schemas/never-show.schema.json`.
- **Feature catalogue** (`paths.feature_catalogue`, JSON, generated by /execution from plan.json requirements):
  `[{id: "FR-003", group: "G1", title, priority: "P1|P2|P3", status_expected?: "live|testnet|simulated|planned"}]`.
  /frontend maps each id to a route in `<design>/routes.json` and renders it as `data-feature="FR-003"`.
- **Wave fragments** (`../assets/wave-fragments/*.js`): plain JS functions with no imports and no
  `Date.now`/`Math.random`, inlined by /execution's wave emitter or /frontend's own workflow: `async function
  feCritique(api, input)` and `async function feDirections(api, input)`, `api = {agent, parallel, pipeline, log}`,
  each returning a receipt object. A workflow script cannot run Node, so every script step inside a fragment is an
  `agent()` call that runs the command and returns its JSON.

**v1.1 (2026-10), never-show matching (Q-F9, agreed with /execution):**
- Folding: NFKC then `toLowerCase()` on both sides, never a full casefold (Python `unicodedata.normalize('NFKC',
  s).lower()`): `lib/text.mjs foldNeverShow`. A literal entry with `case_sensitive: false` matches when the folded
  pattern is a substring of the folded text; with `case_sensitive: true` it matches the NFKC text as written. A regex
  entry with `case_sensitive: false` gets the ignore-case flag (`i`, `re.IGNORECASE`) and is tested on the folded
  text. /frontend also removes soft hyphens and zero-width characters and collapses whitespace before matching
  rendered text.
- Regex subset: only constructs JavaScript and Python `re` read the same way. Accepted: character classes,
  quantifiers (greedy and lazy), alternation, capturing and non-capturing groups, lookahead, the anchors `^ $ \b \B`,
  `\d \w \s` and their negations, `\xhh`, `\uhhhh`, `\t \n \v \f \r` and escaped punctuation. Refused (the entry
  cannot be checked: /frontend fails `coverage.nevershow` on it, /execution reports E_SCHEMA): named groups and named
  backreferences, lookbehind, numbered backreferences, inline flag groups (`(?i)`, `(?-i:...)`), atomic groups,
  possessive quantifiers, comment and conditional groups, `\A \Z \z`, `\p{...}`, `\c`, any other letter escape, and a
  class that starts with `]` (`[]`, `[^]`). `lib/text.mjs neverShowRegexProblem` is the escape-aware check; the
  schema carries a textual approximation of it that is stricter, never looser.
- Hits are reported by entry id and place, never with the matched text.

**v1.1 (2026-10), agreements with /execution recorded here** (its `contract/FRONTEND.md` holds its side):
- Template ids `FE-xx` are instantiated as T-ids with `template: "frontend:FE-xx"`; FE-1x gives one task per feature
  group (one task with every id in small mode). Dependencies resolve at instantiation through params (`references:
  on|off`, `mode: full|small`), never as OR or runtime conditions; `decision:project-name` and `manual:harden-review`
  are symbolic dependencies /execution maps to its own tasks. FE-21 (H3) sits in phase deliverable, after the
  /harden review task and before any recording task. The template file is `../assets/task-templates/frontend.json`
  (schema `task-templates.schema.json`); template and agent efforts are capped at `high`.
- Agents `frontend-critic` and `frontend-probe` (`../assets/agents/`) are read-only: /execution's disallowed tools
  plus PowerShell, Skill, WebFetch, WebSearch and `mcp__*`; the probe also has no Grep or Glob.
- The review board (H1, H2) is published by the orchestrator only; answers reach /frontend through one channel, a
  Notion decision field or a Remote Control reply (AskUserQuestion or the terminal in mode B), written into
  `<state>/choices.json`. Canvas comments are not answers.
- Fragment inputs and receipts: the input shape is documented at the head of each fragment; receipts follow
  `critique-receipt.schema.json` and `directions-receipt.schema.json`; every command a fragment runs prints the JSON
  of `fragment-commands.schema.json` (critique.mjs `measure`, `ui-copy`, `--verify-receipt`; board.mjs `render`,
  `screen`, `board`; restore is `git revert --no-edit {sha}..HEAD`; `input.commands` overrides any of them). The
  critique receipt is written to `<state>/critique/receipt.json` by a runner agent and carries an FNV-1a 32 checksum
  over its compact JSON without the checksum key. In small mode feCritique measures with the `--phase small` gate set.
- **Q-F15:** the fragments never dictate a commit message: the fixer is told to commit under its own commit rules,
  so /execution's merge checks apply.
- **Q-F3:** FE-08 and FE-20 write `{ui_root}/**` narrowed by /execution; the UI package manifest and install belong
  to /execution's contract wave.

### 6.2 `<design>/` in the product repo (no secrets, committed)
- `tokens.json`: the single source of the visual system, list-shaped so it mirrors Claude Design's Design System
  format: `{name, version, color: {themes: [{id, name}], tokens: [{name, value: {<theme>: css}, usage}]}, type: {fonts:
  [{family, file, weight, style, license, licenseFile, source}], families: {display, body, mono}, groups: [{name,
  family, styles: [{name, fontSize, lineHeight, fontWeight, letterSpacing?}]}]}, spacing: {tokens: [...]}, radius:
  {tokens: [...]}, shadow: {tokens: [...]}, motion: {tokens: [...]}, meta: {direction, rationale, sources: []}}`. Token
  names match `[a-z0-9][a-z0-9-]{0,63}`; every token has a non-empty `usage`.
- `routes.json`: `[{path, name, first?: true, features: ["FR-003"], states?: ["empty", "error"]}]`.
- `waivers.json`: `{waivers: [{rule, scope, reason, evidence, approved_by: "owner|research", date}]}`.
- `provenance.json`: `{assets: [{path, kind: "font|image|icon|logo|data|video", source, license, licenseFile?, ai:
  "generated|assisted|none", tool?, notes?}]}`; every file under `brand/`, `public/` (or the stack's static folder)
  and `<design>/` fonts has an entry.
- `DESIGN.md`: a generated view of tokens.json (Google design.md alpha plus a `## Motion` section). Never edited by
  hand; `tokens.mjs` regenerates it.

**v1.1 (2026-10), `tokens.json` as tokens.mjs reads it:**
- Colour pairs are declared in each colour token's `usage` (there is no `pairs` field): the token names after `on`,
  `over` or `against`, joined by commas, `and`, `or` or a slash (`"secondary text, 4.5:1 or more on bg"`). Names also
  pair: `on-<x>` on `<x>`, `<x>-foreground` on `<x>`, `foreground` on `background`. The words before `on` set the
  kind: large text 3:1, text 4.5:1, a UI part (border, ring, focus, icon, input, chart) 3:1, a surface a 1.1:1 step in
  dark themes only, decoration none, anything else text. An explicit ratio may raise the minimum, never lower it. A
  text or UI colour naming no ground, or a ground name shaped like a token that matches none, fails `tokens.contrast`.
- Colour values are hex, `rgb()` or `oklch()`; `var()`, `color-mix()`, relative and named colours fail. Spacing,
  radius, shadow and motion values are a scalar or one value per theme id; a bare number is px for spacing and
  radius and ms for motion; motion tokens may carry extra keys (`easing`, `role`).
- Generated views: `<design>/tokens.css` by default (`tokens.mjs build --css <file>` writes the app's copy), with a
  header naming the tokens path, a SHA-256 of the canonical JSON and the build options, and `<design>/DESIGN.md`.
  `tokens.valid` regenerates both and fails on a stale, hand-edited or missing view.
- Optional `<design>/motion.json` (motion-check): an array, or `{animations: [...]}`, of `{selector, trigger,
  purpose, role}`; purpose `explanation` exempts that animation from the role budget. Infinite animations are allowed
  only on `data-live` elements (section 6.6). Motion tokens may name a `role` and carry `max_ms` or `budget: [min,
  max]` for that role; such a value may only tighten the role budget of references/08-motion.md, never widen it.

**v1.1 (2026-10), `waivers.json` as built:** `waivers[].scope` follows the grammar of section 5; `evidence` is a
string or a list of strings (a list only for tell waivers); `category: [{rule, category, reason, source}]` is the
category allowlist (section 5). A waiver whose `rule` is `coverage.features` is the owner's written decision to keep
feature rows off the page (BD-06, BF-07): `scope` lists the FR ids (`FR-003` or `FR-003, FR-007`), `approved_by`
must be `owner` (a research approval exempts nothing) and `reason` and `evidence` are non-empty strings; without
such a mechanism a CLI-only catalogue row would make the build phase unpassable. Schema:
`../assets/schemas/waivers.schema.json`.

**v1.1 (2026-10), `brand/`:** the repository's `brand/` folder holds the picked mark and wordmark (`brand/mark.svg`
and other `<stem>.svg`); `brand.drift` compares every inlined copy (a `data-brand="<stem>"` element, a data-URI
favicon, an inline SVG of the same shape) with `brand/<stem>.svg`.

**v1.1 (review fix 2026-10-12), `glossary.json`:** optional `<design>/glossary.json`, `{"terms": [...]}` or a bare
array of strings, written from the domain research. SL-T17 reads it (trimmed, case-insensitive) and stops counting
the protocol vocabulary words it lists (`decentralized`, `decentralised`, `autonomous`, `ecosystem`) as stock
template phrases; other terms change nothing, and the promotional phrases are never removed by it. No file, no
exemption. A file that is not valid JSON, or not a list of strings, makes SL-T17 throw a UsageError, which the
runner records as a detector error, so the tells gates judging SL-T17 fail until the file is fixed.

### 6.3 State directory (`stateDir()`; never committed to the product repo)
`brief.json`, `brief.md`, `refs-index.json` (pointer to the private capture folder plus receipts), `pattern-ledger.json`
and `.md`, `directions/<A|B|C>/{tokens.json, hero-desktop.png, hero-mobile.png, notes.md}`, `choices.json` (H1, H2, H3
answers with UTC times), `brand/candidates/<n>/...`, `gates/<UTC>.json`, `critique/round-<n>/...`, `ui-copy.md`,
`receipts/`.

**v1.1 (2026-10), state files as built:**
- `choices.json`: `assets/schemas/choices.schema.json`: `{version: 1, H1: {pick: "A"|"B"|"C"|"none", reason?,
  change, answered_at, by, channel, source, canvas_url?, type_release?, published_at?}, H2: {pick: <candidate n>,
  ...same without reason}, H3: {signed_off, changes[], url?, answered_at, by, channel, source}}`; channels
  `notion|remote-control|ask-user-question|terminal`; times UTC. **Q-F11:** `canvas_url` (https), `type_release` and
  `published_at` record the private review canvas the owner looked at for H1 and H2. A key is absent until its
  checkpoint is answered. **Review fix 2026-10-12:** H1 `pick: "none"` records that the owner rejected every
  direction (DR-12) and then requires `reason`, a string with a non-blank character. board.mjs `record` accepts
  `--pick A|B|C|none` (or reads H1.pick) and with `none` records every direction with `picked: false`. FE-04's proof
  still fails on `none`, since no direction folder is named so, and a new round of directions follows.
- **Review fix 2026-10-12, `tells/<UTC>.json`** (`<UTC>-<n>.json` within one second; under `<out>/tells/` with
  `--out`; under a fresh temp folder when slop-check's CLI finds no state folder and has no `--state` or `--out`):
  `{tool, version, at, target, registry: {path, rules, run}, layers: {requested, ran, notes}, gates, score (section
  5, with max), counts: {findings, counted, exempt, unconfirmed, errors, pageErrors}, byRule: [{rule, tier,
  findings, confirmed, unconfirmed, exempt, counted, errors}], findings, errors, pageErrors, waivers, category,
  sponsors: {ids, hashes}}`. `byRule` has one row per rule that found something or failed to run, in registry order.
- `receipts/brief-discovery.json`: the workspace root and the matcher that found each brief source (brief.complete
  resolves relative sources through it).
- `refs-index.json`: `{version: 1, captures_root, captures: [{host, slug, url, dir, receipt, manifest, captured_at,
  delete_by, viewports, purged, deletion_receipt}]}` (capture.mjs writes it; ip-check also accepts its older
  `references`/`refs` lists).
- Captures never sit in the state folder or any git work tree: their root is `--out`, else
  `<workspace.private_dir>/frontend/captures`, else `<os tmp>/frontend-captures`, laid out
  `<root>/<host>/<slug>/{slices per viewport, styles.json, fonts.json, landmarks.json, reveal.json, manifest.json,
  gate-receipt.json}` plus `<root>/<host>/host-log.json` and a `.capture.lock`; a purge deletes the listed files and
  writes `deletion-receipt.json`. `refs-extract.json` is written to the captures root.
- `copy-shingles.json`: `ip-check.mjs --index-copy`: salted 8-word shingles of the customers' copy (boilerplate
  shared by two references removed), so `ip.copy-overlap` can run after the purge.
- `directions/<X>/{render.json, screen.json, hero.html?, hero.template.html?, hero-*.board.png}`,
  `similar-prompt/` (the generic plan of the similar-prompt test), `board/{board.json, canvas/project/...}`,
  `board/logos/{sheet.png, candidate-<n>.png, board.json, canvas/project/...}`.
- `brand/candidates/<n>/{candidate.json (text, font, license, intervention, one_feature, flag_reasons, ai, tool),
  mark.svg, wordmark.svg, wordmark.json, render/render.json (markSha256), render/mark-*, silhouette-light-* and
  silhouette-dark-<16|32|180|512>.png}`, `brand/sheet.png` and `sheet.json`, `brand/name-checks.json`.
- `critique/round-<n>/<label>/{tiles/, squint/, marks.json, checklist.json, measure-problems.json, task.md,
  gates.json, measure.json}`, `critique/round-<n>/{critics/*.json, pairwise-ab.json, pairwise-ba.json,
  probes/<viewport>/, issues.json, probes.json, receipt.json}`, `critique/best.json`, `critique/history.json`,
  `critique/receipt.json`.
- `tells/<UTC>.json` (slop-check findings, exemptions and waiver problems), `firstview/` (the measured JPEG when no
  outDir is given), `recording/<UTC>/` (captures when no `--out` is given), `gates/<UTC>-qa.json` (qa.mjs CLI).
- Outside the state folder: `<skill>/ledger/past-directions.json` (override `$FRONTEND_PAST_DIRECTIONS` or `--past`):
  `{version: 1, entries: [{project, direction, name, picked, recorded_at, ground, accent, display, body, signature,
  tokens_sha256}]}`, appended by `board.mjs record` after H1.

### 6.4 brief.json
```json
{
  "project": {"name": "", "name_status": "final|working|pending", "source": ""},
  "sentences": {"broken": "", "did": "", "source": ""},
  "hero": {"h1": "", "sentence": "", "source": ""},
  "gap": {"text": "", "who_loses": "", "how_much": "", "source": ""},
  "sponsors": [{"id": "cardano", "name": "", "strategy": "", "source": ""}],
  "customers": [{"name": "", "category": "", "url": "", "url_source": "", "owner_confirmed": false}],
  "use_case": {"text": "", "source": ""},
  "features": [{"id": "FR-003", "group": "", "title": "", "status": "live|testnet|simulated|planned", "route": null, "proof": null, "source": ""}],
  "claims": {"path": "", "ids": []},
  "never_show": [{"class": "do-not-carry|undisclosed-security|never-public|embargo", "pattern": "", "regex": false, "until_utc": null, "source": ""}],
  "judge_path": {"beats": [], "source": ""},
  "missing": [{"field": "", "action": "manual-task|question", "why": ""}]
}
```
Every non-empty field carries the `source` path (and line when known) it came from. A field with no source is
`missing`, never guessed.
**v1.1 (2026-10):** brief.mjs fills prose fields only from labelled lines (`H1: ...`, `**Broken:** ...`, a two-cell
table row); sources that disagree become a `missing` entry naming both. A catalogue feature without
`status_expected` is recorded as `planned` and listed as `features[].status` in `missing`.

### 6.5 pattern-ledger.json
`{references: [{id, customer, url, page, captured_at, viewports, receipt, purged}], patterns: [{id, kind:
"convention|relationship|domain|fact", statement, values, from: [ref ids, at least 2 unrelated unless kind is fact],
not_borrowed}], excluded: [...]}`.
**v1.1 (2026-10), as `refs.ledger` enforces it:** the schema `../assets/schemas/pattern-ledger.schema.json` (unknown
keys refused; `values` and `not_borrowed` required); one page per host (RF-03); no colour literal in a statement
(RF-15); at most 4 hosts; "unrelated" means a different owner (customer name without legal suffixes) AND a different
registrable domain; `receipt: "manual-notes"` marks the owner's own notes (RF-12), which need no capture receipt.
`refs.receipts` checks each capture's gate receipt (verdict captured, same URL, `frontend-capture/1.0` in the agent,
terms attestation, manifest SHA-256) and its purge, and fails on a capture in `refs-index.json` missing from the
ledger that still holds files.

### 6.6 DOM markers the generated UI must carry (the checks read them)
| marker | on | meaning |
|---|---|---|
| `data-feature="FR-003"` | the root of a feature's surface (the spec's requirement id) | coverage: visible in record mode |
| `data-status="live|testnet|simulated|planned"` | the feature's status label | honesty label |
| `data-metric` | an element showing a figure meant as a claim | must also carry `data-ledger` or `data-source` |
| `data-ledger="C-012"` | a claim backed by the claims ledger | traceability |
| `data-source="live|testnet|simulated"` + `data-as-of` | a figure from a data source | provenance and time |
| `data-proof="C-012"` | a transaction link, hash or receipt | proof display |
| `data-hero="h1"`, `data-hero="sentence"` | the first-view headline and sentence | equal to brief.hero |
| `data-surface="product"` | the product shown in the first view | first-screen contract |
| `data-concept-label` | the disclaimer beside any concept frame naming a company | ip.concept-label |
| `data-rec-role="key|decor"` | text a judge must read in a recording / decoration | recording gates |
| `window.__FRONTEND_READY__ = true` | set by the app when data is loaded | readiness when `ready_flag` |
| `?record=1` | URL parameter: named demo data, fixed clock, no loops, hover content shown at rest | record mode |

**v1.1 (2026-10):** `data-brand="<stem>"` marks an inlined copy of `brand/<stem>.svg` (brand.drift); `data-live`
marks an element allowed an infinite animation (motion.inventory, recording.g12); `data-source` with `data-as-of` is
also accepted from the nearest enclosing data region for `coverage.metrics` and `recording.g13`; a `data-feature`
root also needs a visible heading, and unless its status is `planned` a visible `data-proof`, `data-ledger` or
`data-source` (coverage.features, BD-06).

## 7. Tests (the definition of done for every builder)

- Every script has unit tests; every detector has at least one positive and one negative fixture
  (`tests/fixtures/rules/<RULE-ID>/{pos,neg}.html` or source files) and a test asserting it fires on pos and not on neg.
- Every gate has a test with a passing and a failing fixture, and a test that a skipped gate makes `ok` false.
  **Exception (review fix 2026-10-12):** a gate whose only outcome is advisory (`advisory: true`: recording g02, g04,
  g06, g08, g09, g13, and firstview.complexity until calibrated) cannot fail, so it has a fixture that raises its
  warnings and a test that its ok carries `advisory: true` instead of a failing fixture.
- `pnpm test` and `pnpm run typecheck` exit 0 before a builder reports done; the report pastes the summary lines and
  the exit codes, never a claim without them.
- **v1.1 (2026-10), end to end:** `tests/e2e.browser.test.mjs` copies `tests/fixtures/e2e/good-site/` (built the way
  the skill says) and `bad-site/` (the owner's past habits, no markers), compiles each brief with brief.mjs and runs
  `frontend-check --phase build --serve <copy>/site --out <dir>`: good-site passes every gate with no confirmed tell,
  bad-site fails coverage, first view and placeholders and confirms its planted tells. `node
  tests/e2e/build-fixtures.mjs` regenerates the derived files (fonts, tokens views, brand files, provenance).
- **v1.1 (2026-10):** tests create temporary folders under `os.tmpdir()` (or `$FRONTEND_TEST_TMP`) and delete them;
  a browser test file creates its folders in `before()`, so a run that never loads it leaves nothing behind. A test
  that needs a git repository builds a real git dir (HEAD, objects, refs), since lib/paths.mjs ignores a bare
  `.git/info/`.
