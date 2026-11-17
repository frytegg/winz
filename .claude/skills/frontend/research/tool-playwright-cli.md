# Playwright CLI for coding agents, and the build-screenshot-iterate loop
> Code FD06 · slug tool-playwright-cli · researched 2026-09-30 · verified 2026-09-30 · counts: verified 20 / corrected 9 / downgraded 0 / dropped 0 / added 1

## Summary

- The tool is `@playwright/cli` on npm, repo `microsoft/playwright-cli` (Apache-2.0). Latest 0.1.22, published 2026-09-28; 31 versions since 0.0.60 on 2026-01-26. Every release pins an unreleased Playwright alpha (0.1.22 pins 1.64.0-alpha-1790635538000; stable Playwright is 1.63.0). It is a thin client over `playwright-core`: each page command calls the same tool as Playwright MCP (`screenshot` calls `browser_take_screenshot`); session and install commands such as `open`, `close`, `list` and `install` are handled by the CLI itself. (corrected: "each command" overstated the mapping; see F02)
- It ran on this machine (Windows 11, Git Bash, node 24.13). It uses the installed Google Chrome by default (`channel: 'chrome'`), so it downloaded no browser. The bundled Chromium for 0.1.22 (revision 1247) is not installed; each Chromium revision takes about 0.66 GB here (browser plus headless shell), and C: has 4.9 GB free.
- Commands for the design loop that I verified by running them: `open`, `resize`, `set-color-scheme`, `set-reduced-motion`, `screenshot --full-page/--hires`, `open --device`, `run-code --filename`, `eval --filename`, `snapshot --boxes`, `find`, `--raw`, `--json`, `list`, `close`. Errors exit with code 1.
- Version gates: the media-emulation commands exist only since 0.1.21 (2026-09-18) and are in no stable Playwright release. `--hires` and `--mobile` date from 1.62. `--full-page` dates from 1.59, but the README and the installed SKILL.md do not mention it.
- Cost comes from turns more than from tokens. Slack measured about 85 turns for the CLI against about 40 for MCP, about 6M tokens against 3.8M (both on Opus 4.6), and failure rates of 12–20% against 0–12%. Outpost measured half the context for the CLI but double the wall-clock. Checkly and a July re-benchmark measured near parity. The widely quoted "114k vs 27k" figure appears in no official text. A single `run-code` call captured 8 full-page screenshots in 3.8 s, which is the direct fix for the turn count.
- Visual traps I observed:
  - A full-page screenshot does not scroll, so content revealed on scroll stays invisible (issue #40941; Playwright has no built-in fix).
  - The accessibility snapshot lists opacity-0 content as normal text.
  - `resize 375` keeps a desktop context (hover:hover, DPR 1). `--device="iPhone 15"` gives 393 px, DPR 3, hover:none and pointer:coarse.
- Pixel diffs detect change, not quality. `toHaveScreenshot` defaults to threshold 0.2 (YIQ) and 0 allowed pixels. At `maxDiffPixelRatio: 0.01`, a change of the fixture's accent colour passed (0.35% and 0.14% of pixels; in the fixture the accent paints only the 1 px borders of three cards), and the error message rounds the ratio up. (corrected: "a full accent-colour change" overstated what the fixture's accent covers; see F15) Baselines carry a platform suffix (`-win32`). The default `outputDir` is `<package.json dir>/test-results`, which is the home folder on this machine.
- Critique budget: an image costs ⌈w/28⌉×⌈h/28⌉ visual tokens. The high-resolution tier caps images at 2576 px on the long edge and 4784 visual tokens. Above 20 images per request, each side should stay ≤2000 px. Claude Code showed a 375x2185 capture at 343x2000. The critique should therefore look at viewport slices (1440x900 costs 1716 visual tokens), not at tall full-page images.
- Audit primitives: a `run-code` computed-style tally (764 bytes for the whole fixture), CDP `CSS.getPlatformFontsForNode` (returns the fonts that actually rendered), and a scroll-reveal probe (it found the fixture's fade-in section).
- Chrome DevTools MCP 1.10.1 is the tool for performance traces and Core Web Vitals, plus Lighthouse accessibility, SEO and best-practice audits. It sends usage statistics by default.

## Findings

### FD06-F01 — The package is @playwright/cli 0.1.22 (2026-09-28); every release pins a Playwright alpha
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The npm registry lists `@playwright/cli`, created 2026-01-26 (first version 0.0.60), latest `0.1.22` published 2026-09-28T23:24:31Z, 31 versions including one alpha. The repository field points to `microsoft/playwright-cli`, license Apache-2.0, `engines.node >=18`. Version 0.1.22 depends on `playwright` and `playwright-core` `1.64.0-alpha-1790635538000`; every version since 0.0.60 pinned an alpha of the next Playwright (for example 0.1.21 used `1.64.0-alpha-1789764292000`), while the latest stable `playwright` on npm is `1.63.0` (published 2026-09-04). The GitHub repository was created 2020-06-19 and still carries an older description ("CLI for common Playwright actions. Record and generate Playwright code, inspect selectors and take screenshots."), so its creation date predates the coding-agent CLI. Its stars mostly do not: Wayback Machine captures of the repository page show 1,018 stars on 2025-09-15 and 1,070 on 2026-01-24 (the day of the v0.0.58 announcement), against 13,693 through the API on 2026-09-30, so about 92% of the stars arrived after the CLI launch. (corrected: the dossier said the 13,692 stars predate the coding-agent CLI; archived counts show only about 1,070 did) The CLI was first announced in the `@playwright/mcp` v0.0.58 release notes (2026-01-24).
- **Implication for /frontend:** Pin an exact version in the setup step (for example `@playwright/cli@0.1.22`) and log `playwright-cli --version` in each run's receipt. The command surface moved fast (31 releases in 8 months, see F07 and F25), so "latest" is not a stable contract.
- **Evidence:**
  - [npm registry: @playwright/cli](https://registry.npmjs.org/@playwright/cli) — npm, accessed 2026-09-30 — registry metadata (OBSERVED by `curl` + JSON parse).
    - `dist-tags {'next': '0.1.18-alpha-1787870902000', 'latest': '0.1.22'}` / `created 2026-01-26T22:39:51.625Z` / `('0.1.22', '2026-09-28T23:24:31.286Z')` / `n versions 31`
  - [microsoft/playwright-cli package.json](https://github.com/microsoft/playwright-cli/blob/main/package.json) — Microsoft, v0.1.22, accessed 2026-09-30 — the tool's own file.
    - `"playwright": "1.64.0-alpha-1790635538000"`, `"engines": { "node": ">=18" }`
  - [GitHub API repos/microsoft/playwright-cli](https://api.github.com/repos/microsoft/playwright-cli) — GitHub, accessed 2026-09-30 — repository metadata (OBSERVED via `gh api`).
    - `"created_at":"2020-06-19T18:34:03Z"`, `"license":"Apache-2.0"`, `"stargazers_count":13692`
  - [Wayback Machine capture 2025-09-15](https://web.archive.org/web/20250915144714/https://github.com/microsoft/playwright-cli) and [capture 2026-01-24](https://web.archive.org/web/20260124054708/https://github.com/microsoft/playwright-cli) — Internet Archive, accessed 2026-09-30 — archived repository page (added at verification).
    - 2025-09-15: `aria-label="1018 users starred this repository"`; 2026-01-24: `aria-label="1070 users starred this repository"`; `gh api repos/microsoft/playwright-cli` on 2026-09-30 → `"stargazers_count":13693`
  - [npm registry: playwright](https://registry.npmjs.org/playwright) — npm, accessed 2026-09-30 — registry metadata.
    - `playwright dist-tags {... 'latest': '1.63.0', ... 'next': '1.64.0-alpha-2026-09-30'}`, latest time `2026-09-04T22:45:21.732Z`
  - [Release v0.0.58 · microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.58) — Pavel Feldman (Microsoft), 2026-01-24, accessed 2026-09-30 — release notes.
    - "We are adding a new token-efficient CLI mode of operation to Playwright with the skills located at [playwright-cli](https://github.com/microsoft/playwright-cli)."
- **Limits / false positives:** Registry timestamps are publication times, not feature dates. Because the CLI rides an alpha, some behaviour differs from the stable Playwright docs (see F07).

### FD06-F02 — The CLI is a thin client over playwright-core that calls the same tools as Playwright MCP; `npx playwright cli` exists since Playwright 1.59
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - `playwright-cli.js` loads `playwright-core/lib/tools/cli-client/program`, and a per-session daemon keeps the browser alive between commands.
  - Each page command is declared with the MCP tool it runs. `screenshot` runs `browser_take_screenshot`, the `set-*` emulation commands run `browser_emulate_media`, `snapshot` runs `browser_snapshot` and `resize` runs `browser_resize`. In `commands.ts` on main (the same 102 command names as the 0.1.22 `help.json`), 88 of the 102 declared commands name a tool directly, 4 pick one from their options (`console`, `requests`, `highlight`, `show --annotate`), and 10 session and install commands (`open`, `close`, `detach`, `list`, `close-all`, `kill-all`, `delete-data`, `install`, `install-browser`, `tray`) carry an empty `toolName` and are handled by the CLI itself. (corrected: "each CLI command" overstated the mapping)
  - The same CLI is registered in `playwright-core` as a `cli` subcommand: hidden in v1.59.0, v1.60.0 and v1.61.0, listed from v1.62.0 (and in v1.63.0). (corrected: the dossier said hidden in v1.59.0 and v1.60.0 and listed in v1.63.0; it is also hidden in v1.61.0 and already listed in v1.62.0) Running `node node_modules/playwright/cli.js cli --help` on the 1.64 alpha printed "playwright-cli - run playwright mcp commands from terminal".
- **Implication for /frontend:** The CLI and MCP share capabilities and differ in transport and output shape. Choose between them on loop design (turn count, where the evidence files live), not on features. In a project that already depends on `@playwright/test` 1.59 or later, `pnpm exec playwright cli ...` should work without a global install (the subcommand exists in the source at those tags; I ran it only on the 1.64 alpha), with the command set of that Playwright version (see F07).
- **Evidence:**
  - [playwright-cli.js](https://github.com/microsoft/playwright-cli/blob/main/playwright-cli.js) — Microsoft, v0.1.22, accessed 2026-09-30 — the tool's own file.
    - `const { program } = require('playwright-core/lib/tools/cli-client/program');`
  - [commands.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/cli-daemon/commands.ts) — Microsoft, main branch, accessed 2026-09-30 — source code.
    - `toolName: 'browser_take_screenshot',` and `toolName: 'browser_emulate_media',`
    - Session commands, for example `name: 'list'` … `toolName: '',` (count of 88 / 4 / 10 made at verification by parsing every `declareCommand` block on main, and repeated with the same result on `lib/coreBundle.js` of playwright-core 1.64.0-alpha-1790635538000)
  - [program.ts at v1.59.0](https://github.com/microsoft/playwright/blob/v1.59.0/packages/playwright-core/src/cli/program.ts) and [at v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/cli/program.ts) — Microsoft, accessed 2026-09-30 — source code.
    - v1.59.0: `.command('cli', { hidden: true })`; v1.63.0: `.command('cli')`
    - Re-checked at verification: `.command('cli', { hidden: true })` at v1.59.0, v1.60.0 and v1.61.0; `.command('cli')` at v1.62.0 and v1.63.0; absent at v1.58.0. `node node_modules/playwright/cli.js cli --help` on the 1.64 alpha printed "playwright-cli - run playwright mcp commands from terminal" (re-run at verification).
  - [MCP vs CLI: Are CLIs Really More Token-Efficient?](https://www.checklyhq.com/blog/mcp-vs-cli-token-efficiency/) — Stefan Judis (Checkly), 2026-07-30, accessed 2026-09-30 — vendor blog.
    - "By now, `playwright-cli` commands literally invoke the MCP tools by name under the hood (`click` calls `browser_click`, `find` calls `browser_find`)."
- **Limits / false positives:** I read tool mappings on the main branch and confirmed the specific items quoted in F03 and F06 in the published 0.1.22 bundle. The mapping may differ in older versions.

### FD06-F03 — By default the CLI drives the installed Google Chrome, so on this machine it needs no browser download
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - With no browser configured, the published bundle sets `browserName = "chromium"` with `channel = "chrome"`, that is the system Google Chrome. `playwright-cli install` looks for Chrome, then Edge, and downloads Playwright's Chromium only if neither exists.
  - Observed: sessions reported `browser-type: chrome`. `install --skills` printed "Found chrome, will use it as the default browser." and downloaded only ffmpeg (1.3 MiB) and winldd (0.1 MiB) into the redirected cache; both already exist in the real `%LOCALAPPDATA%\ms-playwright`.
  - Bundled Chromium for 0.1.22 would be revision 1247 (Chrome for Testing 155.0.8059.12), which is not installed. Installed are 1208 (Playwright 1.58.x) and 1217 (Playwright 1.59.x): 394–408 MB each plus 259–266 MB of headless shell, against 4.9 GB free on C:.
- **Implication for /frontend:**
  - Keep the Chrome channel on this machine and never run `install-browser` as a reflex.
  - For Playwright Test visual checks, set `use: { channel: 'chrome' }` so a new Playwright version does not pull roughly 0.66 GB of Chromium.
  - Chrome auto-updates, which moves screenshot baselines (F14). Use baselines only within one session.
- **Evidence:**
  - [playwright-core 1.64.0-alpha-1790635538000 lib/coreBundle.js](https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1790635538000.tgz) — Microsoft, accessed 2026-09-30 — published bundle (OBSERVED, unpacked and read).
    - `if (!browserName) { browserName = "chromium"; if (browser.launchOptions.channel === void 0) browser.launchOptions.channel = "chrome"; }` (line breaks collapsed)
    - `const channels = ["chrome", "msedge"];` (in `findOrInstallDefaultBrowser`)
  - Command run: `playwright-cli list` → `browser-type: chrome`, `user-data-dir: <in-memory>`, `headed: false`; `playwright-cli install --skills` → "Found chrome, will use it as the default browser." (evidence/tool-playwright-cli/outputs/observed-session.md).
  - [browsers.json in the same tarball](https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1790635538000.tgz) — Microsoft, accessed 2026-09-30.
    - `"name": "chromium", "revision": "1247", ... "browserVersion": "155.0.8059.12"`
  - [browsers.json at v1.58.0](https://github.com/microsoft/playwright/blob/v1.58.0/packages/playwright-core/browsers.json) / [v1.59.0](https://github.com/microsoft/playwright/blob/v1.59.0/packages/playwright-core/browsers.json) / [v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/browsers.json) — Microsoft, accessed 2026-09-30.
    - v1.58.0 chromium 1208; v1.59.0 chromium 1217; v1.63.0 chromium 1243
  - Command run: `du -sh %LOCALAPPDATA%/ms-playwright/*` → `394M chromium-1208`, `408M chromium-1217`, `259M chromium_headless_shell-1208`, `266M chromium_headless_shell-1217`; `df -h /c` → `4.9G` available.
- **Limits / false positives:** The Chrome default was read in the 1.64 alpha; I did not check older versions. On a machine without Chrome or Edge, the first `install` downloads Chromium.

### FD06-F04 — Element refs (`e15`) come from the AI-mode aria snapshot; a stale ref fails loudly with exit code 1
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - A target matching `^(f\d+)?e\d+$` (for example `e15`, or `f1e3` inside a frame) is resolved through an `aria-ref=` locator on the snapshot taken with `ariaSnapshot({ mode: 'ai' })`.
  - Any other string is treated as a CSS selector or a Playwright locator (`getByRole(...)`, `getByTestId(...)`).
  - Observed: `playwright-cli click e999` printed "Error: Ref e999 not found in the current page snapshot. Try capturing new snapshot." and exited with code 1.
- **Implication for /frontend:** Refs are per-snapshot handles. Scripted capture passes should target stable selectors or role locators inside `run-code`, not refs. Interactive checks should re-snapshot after each navigation, and the loop should detect failure by exit code.
- **Evidence:**
  - [tab.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/backend/tab.ts) — Microsoft, main, accessed 2026-09-30 — source code.
    - `if (!param.target.match(/^(f\d+)?e\d+$/)) {` … `` let locator = this.page.locator(`aria-ref=${param.target}`); ``
  - [Page.ariaSnapshot](https://playwright.dev/docs/api/class-page#page-aria-snapshot) (source: docs/src/api/class-page.md) — Microsoft, since v1.59, accessed 2026-09-30 — official docs.
    - "When set to `"ai"`, returns a snapshot optimized for AI consumption: including element references like `[ref=e2]` and snapshots of `<iframe>`s."
  - Command run: `playwright-cli click e999; echo $?` → `Error: Ref e999 not found in the current page snapshot. Try capturing new snapshot.` / `1`.
- **Limits / false positives:** None found.

### FD06-F05 — Command output goes to files and the responses are small; `.playwright-cli/` must stay out of the repo
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Page-changing commands print a short status (the generated Playwright code, page URL, title and console counts) and a link to a YAML snapshot in `.playwright-cli/page-<timestamp>.yml`.
  - Observed sizes on the fixture: a `click` response was 268 bytes and the full snapshot 341 bytes.
  - `--raw` returns only the result value, `--json` wraps it as JSON, `find` greps the snapshot, `snapshot --depth=N` limits depth and `snapshot --boxes` adds `[box=x,y,w,h]` in CSS pixels.
  - Workspace initialisation appends `.playwright-cli/` to `.gitignore` under the comment "Playwright CLI output (may contain credentials)".
- **Implication for /frontend:** Keep `.playwright-cli/` and the capture folders gitignored and out of every deliverable. Use `--raw` whenever a command's output feeds the slop checker. Use `snapshot --boxes` when a check needs geometry, for example target sizes or "three boxes in a row" (tell 8).
- **Evidence:**
  - [README.md](https://github.com/microsoft/playwright-cli/blob/main/README.md) — Microsoft, v0.1.22, accessed 2026-09-30 — the tool's own file.
    - "After each command, playwright-cli provides a snapshot of the current browser state."
  - [SKILL.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md) — Microsoft, v0.1.22, accessed 2026-09-30 — the tool's skill file.
    - "The global `--raw` option strips page status, generated code, and snapshot sections from the output, returning only the result value."
  - Command run: `playwright-cli click e5 | wc -c` → `268`; `playwright-cli --raw snapshot --boxes` → `- button "Start" [active] [ref=e5] [box=24,121,44,21]`.
  - [coreBundle.js, patchGitIgnore](https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1790635538000.tgz) — Microsoft, accessed 2026-09-30 — published bundle.
    - `"# Playwright CLI output (may contain credentials)\n.playwright-cli/\n"`
- **Limits / false positives:** The fixture has 11 elements. Real pages produce much larger snapshot files; one practitioner reports about 97,000 characters for a heavy page (F23).

### FD06-F06 — `screenshot` supports `--full-page`, `--hires`, `--type` and element targets, but the README and SKILL.md omit `--full-page`, and the CLI never disables animations
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - The 0.1.22 help text lists `screenshot [target]` with `--filename`, `--type` (png, jpeg, webp), `--full-page` and `--hires`.
  - The CLI default is `scale: 'css'`, whereas Playwright's `page.screenshot` default is `"device"`; `--hires` switches to device pixels.
  - The CLI passes no `animations` option, so `page.screenshot`'s default `"allow"` applies. The generated code I observed was `page.screenshot({ fullPage: true, path: ..., scale: 'css', type: 'png' })`. By contrast, `toHaveScreenshot` defaults to `"disabled"`.
  - Playwright's screenshotter waits for `document.fonts.ready` before capturing.
  - `--full-page` has been in the CLI's `commands.ts` since v1.59.0, and the playwright.dev agent-cli pages document it. The repo README and the installed SKILL.md list only `screenshot [ref]`, `--filename` and `--hires`.
- **Implication for /frontend:**
  - State `--full-page` explicitly in /frontend, because the installed skill will not teach it.
  - For critique captures, use `run-code` with `animations: 'disabled'`, or emulate reduced motion, so entrance and hover animations are not caught half-way.
  - Use `--hires` only when judging hairlines and raster assets: it multiplies the pixel count and the visual-token cost (F13).
- **Evidence:**
  - [playwright-cli 0.1.22 help (help.json in playwright-core 1.64.0-alpha-1790635538000)](https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1790635538000.tgz) — Microsoft, accessed 2026-09-30 — published file (copy in evidence/tool-playwright-cli/outputs/cli-0.1.22-help.txt).
    - "--full-page                 when true, takes a screenshot of the full scrollable page, instead of the currently visible viewport."
    - "--hires                     when true, captures a high-resolution screenshot using device pixels (accounts for the device pixel ratio), instead of css pixels."
  - [screenshot.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/backend/screenshot.ts) — Microsoft, main, accessed 2026-09-30 — source code.
    - `scale: z.enum(['css', 'device']).default('css')`
  - [params.md, screenshot options](https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md) — Microsoft, main, accessed 2026-09-30 — official API docs source.
    - page.screenshot `animations`: "Defaults to `"allow"` that leaves animations untouched."; toHaveScreenshot `animations`: "Defaults to `"disabled"` that disables animations."; page.screenshot `scale`: "Defaults to `"device"`."
  - [screenshotter.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/screenshotter.ts) — Microsoft, main, accessed 2026-09-30 — source code.
    - `progress.log('waiting for fonts to load...');` followed by an evaluation of `'document.fonts.ready'`
  - [Screenshots & PDF (agent-cli docs)](https://playwright.dev/agent-cli/commands/screenshots-pdf) (source: microsoft/playwright.dev agent-cli/commands/screenshots-pdf.mdx, last docs sync 2026-09-08) — Microsoft, accessed 2026-09-30 — official docs.
    - "| `screenshot --full-page` | Full scrollable page instead of the viewport |"
    - "`--hires` accounts for the device pixel ratio, which makes text legible in a captured design review — but its pixel coordinates no longer line up with the CSS-pixel coordinates that [mouse commands](./keyboard-mouse.mdx) take."
  - Command run: `curl .../v1.59.0/.../commands.ts | grep -c full-page` → `2` (the same count at v1.60.0 through v1.63.0).
- **Limits / false positives:** I observed the animation behaviour through the generated code only; I did not photograph a running animation.

### FD06-F07 — Colour-scheme and reduced-motion commands exist only since 0.1.21 (2026-09-18); on stable Playwright use `run-code` with `emulateMedia`
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - The v0.1.21 release (2026-09-18) added `set-color-scheme`, `set-reduced-motion`, `set-forced-colors`, `set-contrast`, `set-media` and the matching `clear-*` commands. None of them appears in `commands.ts` at tags v1.59.0 through v1.63.0.
  - `--hires` and `--mobile` first appear at v1.62.0.
  - The skill's own reference documents the older route: `run-code "async page => { await page.emulateMedia({ colorScheme: 'dark' }); }"`.
  - Observed on 0.1.22: after `set-color-scheme dark` and `set-reduced-motion reduce`, `matchMedia` reported both preferences as true.
  - Playwright contexts default to `colorScheme: 'light'` and `reducedMotion: 'no-preference'`.
- **Implication for /frontend:**
  - Require `@playwright/cli` 0.1.21 or later, or use `run-code` with `page.emulateMedia(...)`, which works on every version.
  - Dark mode is never rendered unless it is emulated explicitly. The colour-scheme axis must therefore be part of every capture pass; tell 7, low-contrast dark mode, is invisible otherwise.
- **Evidence:**
  - [Release v0.1.21](https://github.com/microsoft/playwright-cli/releases/tag/v0.1.21) — Microsoft, 2026-09-18, accessed 2026-09-30 — release notes.
    - "an agent working on a dark theme had no way to see it mid-session. New `set-color-scheme`, `set-reduced-motion`, `set-forced-colors`, `set-contrast` and `set-media` commands emulate media features on the fly"
  - Command run: `grep -c set-color-scheme` on commands.ts at v1.59.0, v1.60.0, v1.61.0, v1.62.0 and v1.63.0 → `0` each; `grep -c hires` → `0` at v1.61.0, `2` at v1.62.0.
  - [running-code.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/references/running-code.md) — Microsoft, v0.1.22, accessed 2026-09-30 — skill reference.
    - `await page.emulateMedia({ colorScheme: 'dark' });` and `await page.emulateMedia({ reducedMotion: 'reduce' });`
  - [params.md, context options](https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md) — Microsoft, main, accessed 2026-09-30 — official docs source.
    - colorScheme: "Defaults to `'light'`."; reducedMotion: "Defaults to `'no-preference'`."
  - Command run: `playwright-cli --raw eval "() => JSON.stringify({scheme: matchMedia('(prefers-color-scheme: dark)').matches, rm: matchMedia('(prefers-reduced-motion: reduce)').matches, ...})"` → `"{\"scheme\":true,\"rm\":true,...}"`.
- **Limits / false positives:** Command presence was checked by grepping source files at release tags, not by running each stable version.

### FD06-F08 — `resize` narrows the viewport but keeps a desktop context; `open --device` is the real mobile check
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - `resize <w> <h>` calls `page.setViewportSize`. At 375 px the fixture's `max-width: 767px` layout switched to one column, but `(hover: hover)` stayed true and `devicePixelRatio` stayed 1.
  - `open --device="iPhone 15"` on the Chrome channel gave `innerWidth` 393, DPR 3, `hover: none`, `pointer: coarse` and an iPhone user agent. `screenshot --hires` then produced 1179x1977.
  - Playwright defines `isMobile` as "Whether the meta viewport tag is taken into account and touch events are enabled".
  - Registry sizes relevant to the owner's widths: 'iPhone SE (3rd gen)' 375x667 at DPR 2, 'iPad Mini' 768x1024 at DPR 2, 'Desktop Chrome' 1280x720. `--mobile` uses 'Pixel 10' (360x732) on Chromium.
  - One example config on the agent-cli configuration page, labelled "Device emulation", sets only a 375x812 viewport and a user-agent string, which is the desktop-context case. The same page's own "Device emulation" section recommends `open --mobile` and `open --device="iPhone 15"`, which do emulate a device. (corrected: the dossier said the configuration docs illustrate device emulation only with viewport and user agent; only one example config does)
- **Implication for /frontend:**
  - Width-only `resize` is enough for layout review at 375, 768, 1280 and 1440.
  - Add at least one `--device` pass ('iPhone SE (3rd gen)' for 375, 'iPad Mini' for 768) to catch affordances that work only on hover, touch-only layout differences and DPR-dependent rendering (hairlines, raster logos, favicon sharpness).
  - Set the viewport before navigating, as the Playwright docs advise.
- **Evidence:**
  - [common.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/backend/common.ts) — Microsoft, main, accessed 2026-09-30 — source code.
    - `await tab.page.setViewportSize({ width: params.width, height: params.height });`
  - [Page.setViewportSize](https://playwright.dev/docs/api/class-page#page-set-viewport-size) — Microsoft, accessed 2026-09-30 — official docs.
    - "A lot of websites don't expect phones to change size, so you should set the viewport size before navigating to the page."
  - [Emulation](https://playwright.dev/docs/emulation) — Microsoft, accessed 2026-09-30 — official docs.
    - "Whether the meta viewport tag is taken into account and touch events are enabled."
  - [deviceDescriptorsSource.json](https://github.com/microsoft/playwright/blob/main/packages/isomorphic/deviceDescriptorsSource.json) — Microsoft, main (207 devices), accessed 2026-09-30 — source data.
    - `iPhone SE (3rd gen) {'width': 375, 'height': 667} dsf 2`, `iPad Mini {'width': 768, 'height': 1024} dsf 2`, `Pixel 10 {'width': 360, 'height': 732} dsf 3`
  - Commands run: after `resize 375 812`, the eval returned `"w":375,"dpr":1,"hover":true`. With `-s=mobile open ... --device="iPhone 15"` it returned `{"w":393,"h":659,"dpr":3,"hover":false,"coarse":true,"ua":"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Apple"}`.
  - [Configuration (agent-cli docs)](https://playwright.dev/agent-cli/configuration) (source: agent-cli/configuration.mdx) — Microsoft, accessed 2026-09-30 — official docs.
    - `"viewport": { "width": 375, "height": 812 },` / `"userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)..."`
    - Same page, section "## Device emulation" (configuration.mdx line 24, read at verification): "# Emulate a named device from the Playwright device registry" / `playwright-cli open --device="iPhone 15"`
  - Re-run at verification on 0.1.22 (Chrome channel): after `resize 375 812`, `{"w":375,"h":812,"dpr":1,"hover":true,"coarse":false}`; with `--device="iPhone 15"`, `{"w":393,"h":659,"dpr":3,"hover":false,"coarse":true}` and `screenshot --hires` 1179x1977; with `--device="iPhone SE (3rd gen)"`, `{"w":375,"h":667,"dpr":2,"hover":false,"coarse":true}`.
- **Limits / false positives:** WebKit is not installed here, so iPhone descriptors ran on the Chromium engine. This checks responsive behaviour, not Safari rendering.

### FD06-F09 — One `run-code --filename` call can capture the whole matrix; this is the fix for the turn-count cost
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Observed: one `run-code --filename=capture-matrix.js` captured 8 full-page screenshots (375, 768, 1280 and 1440 wide, light and dark, reduced motion) in 3.8 s of wall-clock time and returned only the list of paths.
  - One `run-code --filename=slice-capture.js` captured 22 viewport-sized slices (four sizes, two schemes, scrolling by one viewport) in 7.5 s.
  - `run-code` runs in an isolated context: no `require`, no `process`, no Node modules. Since 0.1.22 it has timers, `fetch`, `URL`, `Buffer`, `crypto`, `AbortController` and `TextEncoder`/`TextDecoder`.
  - Playwright calls that write files (`page.screenshot({ path })`) work. Relative paths resolved against the directory the session was opened from, which was also the invoking shell's directory in all my runs.
- **Implication for /frontend:** Ship the capture pass as script files that the skill owns (for example `.frontend/capture-matrix.js`), run by one command per pass. Never issue one CLI command per viewport per scheme. This follows the Slack and Outpost measurements (F21, F22) and the skill's own advice for videos.
- **Evidence:**
  - Commands run: `time playwright-cli run-code --filename=capture-matrix.js` → 8 paths, `real 0m3.792s`; `time playwright-cli -s=fe --raw run-code --filename=slice-capture.js` → `{"count":22,...}`, `real 0m7.486s` (scripts in evidence/tool-playwright-cli/scripts/).
  - Re-run at verification with the same scripts and fixture: slice capture `{"count":22,...}` in `real 0m7.738s`; capture matrix 8 paths in `real 0m2.708s`. Counts match; timings vary run to run.
  - [running-code.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/references/running-code.md) — Microsoft, v0.1.22, accessed 2026-09-30 — skill reference.
    - "The code runs in an isolated context, not in a full Node.js environment."
  - [Release v0.1.22](https://github.com/microsoft/playwright-cli/releases/tag/v0.1.22) — Microsoft, 2026-09-28, accessed 2026-09-30 — release notes.
    - "`run-code` scripts can use timers, `fetch`, `URL`, `Buffer`, `crypto`, `AbortController` and `TextEncoder`/`TextDecoder`; `require` and `process` stay unavailable"
  - [video-recording.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/references/video-recording.md) — Microsoft, v0.1.22, accessed 2026-09-30 — skill reference.
    - "When recording a video for the user or as a proof of work, it is best to create a code snippet and execute it with run-code."
- **Limits / false positives:** Timings come from a tiny static fixture with no web fonts or images. Real pages take longer, and each emulation switch can trigger re-layout.

### FD06-F10 — Full-page screenshots never scroll, so content revealed on scroll or lazy-loaded is missing; slices and a reveal probe catch it
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - The fixture has a below-the-fold section that starts at `opacity: 0` and gains a `.visible` class from an IntersectionObserver. It was absent (a blank region) in `screenshot --full-page` at 375 px.
  - It was visible after `set-reduced-motion reduce`, because the fixture's CSS honours that preference, and in viewport slices taken after scrolling.
  - A probe comparing each element's opacity before and after scrolling through the page returned exactly that section: `{"id":"below","top":1792,"opacity":0,"after":1}`.
  - Playwright issue #40941 gives the mechanism and lists what is missed. A pull request adding a `loadLazyContent` option (#40933) was closed without merging; the request was folded into #19861, open since 2023, where a maintainer said there is no generic solution.
  - Playwright's docs describe a full-page screenshot "as if you had a very tall screen", which does not hold for content gated on scrolling.
- **Implication for /frontend:**
  - Never judge a page from a single full-page capture.
  - Critique viewport slices taken after real scrolling.
  - Run the reveal probe as a mechanical signal for tell 12 (fade-in on scroll) and for content that is invisible when motion or JavaScript is off.
  - Compare a no-preference pass with a reduced-motion pass: content missing in the reduced-motion pass is an accessibility defect, not a style choice.
- **Evidence:**
  - Command run: `playwright-cli screenshot --full-page --filename=shots/375-light-full.png` → 375x2185, section invisible (evidence/tool-playwright-cli/outputs/375-light-full.png). After `set-color-scheme dark` and `set-reduced-motion reduce` → 375x2161, section visible (outputs/375-dark-reduced-full.png). The `reveal-probe.js` output is quoted above.
  - [Issue #40941: Screenshot option to render lazy / scroll-triggered content before capture](https://github.com/microsoft/playwright/issues/40941) — eran132, 2026-05-21 (closed as duplicate), accessed 2026-09-30 — issue tracker.
    - "Full-page screenshots render the document off-screen without ever moving the visual viewport — Chromium uses `captureBeyondViewport`, Firefox a document-sized clip, WebKit `Page.snapshotRect` with `coordinateSystem: 'Page'`. As far as the page's JavaScript is concerned, nothing scrolls."
    - "scroll-triggered reveal animations"; "virtualized lists (react-window, TanStack Virtual) — only rows near the real viewport render"
    - Maintainer dgozman: "Folding into #19861."
  - [PR #40933: feat(screenshot): add loadLazyContent option](https://github.com/microsoft/playwright/pull/40933) — eran132, closed 2026-05-21 without merge, accessed 2026-09-30.
  - [Issue #19861](https://github.com/microsoft/playwright/issues/19861) — opened 2023-01-04, open, accessed 2026-09-30.
    - mxschmitt: "Each website is different, so there is not a generic solution which works for all the websites."
  - [Screenshots](https://playwright.dev/docs/screenshots) — Microsoft, accessed 2026-09-30 — official docs.
    - "Full page screenshot is a screenshot of a full scrollable page, as if you had a very tall screen and the page could fit it entirely."
- **Limits / false positives:** The probe checks opacity only. Reveals built on `visibility`, `clip-path`, `transform` offscreen or a mount triggered on scroll need extra checks. Legitimate lazy images also appear in its output, so a match is a candidate, not a verdict.

### FD06-F11 — The accessibility snapshot does not show what the page looks like; the bundled skill steers agents away from screenshots
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The fixture's snapshot listed the invisible `opacity: 0` section as ordinary text: `- generic [ref=e11]: Below-the-fold content revealed on scroll`. Aria snapshots carry roles, names and text, not rendering. The bundled SKILL.md tells agents that screenshots are "rarely used", while the agent-cli docs name the screenshot as the tool for "Verifying visual layout".
- **Implication for /frontend:** Design judgements (hierarchy, colour, spacing, the owner's 20 tells) must rest on pixels plus computed styles, never on snapshots. /frontend must explicitly override the default preference of the playwright-cli skill during review passes.
- **Evidence:**
  - Command run: `cat .playwright-cli/page-2026-09-30T19-36-14-139Z.yml` → contains `- generic [ref=e11]: Below-the-fold content revealed on scroll` while the element's computed opacity was 0 (evidence/tool-playwright-cli/outputs/snapshot-sample.yml).
  - [SKILL.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - "# take a screenshot (rarely used, as snapshot is more common)"
  - [Screenshots & PDF (agent-cli docs)](https://playwright.dev/agent-cli/commands/screenshots-pdf) — Microsoft, accessed 2026-09-30.
    - "| Verifying visual layout | Screenshot |"
- **Limits / false positives:** None found.

### FD06-F12 — A bulk computed-style audit and the fonts that actually rendered can be collected in one call each
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - A `run-code` script walking `body *` and tallying 19 computed properties returned a 764-byte JSON summary for all rendered elements (10 on the fixture) through `--raw`. The properties were font family, size, weight, line-height and letter-spacing; colour and background colour; background image; top border colour and left border width; border radius, box shadow, backdrop filter and opacity; transition property and animation name; top margin, top padding and gap.
  - `eval ... --filename=f` writes a full per-element dump to a file instead of into the context.
  - `getComputedStyle` returns the declared font stack. CDP `CSS.getPlatformFontsForNode` returns the platform fonts actually used, with glyph counts; the protocol marks its CSS domain as experimental.
  - Through `page.context().newCDPSession(page)` inside `run-code` it returned `Georgia-Bold` for the h1 and `ArialMT` for the native button.
  - Returning `JSON.stringify(...)` from `eval` double-encodes the output, whereas returning an object does not.
- **Implication for /frontend:**
  - The slop checker's DOM stage can rest on these primitives. My proposed mapping, not yet calibrated:
    - fonts that actually rendered: tells 4 and 19
    - `background-image` gradients and `background-clip: text`: tells 1, 2 and 20
    - `backdrop-filter`: tell 6
    - per-side border colours: tell 5
    - `transition-property` on buttons: tell 14
    - the spread of margin, padding and gap values: tell 15
  - Return aggregated tallies, never per-element dumps, into the agent's context.
- **Evidence:**
  - Command run: `playwright-cli --raw run-code --filename=style-audit.js > style-audit.json` → 764 bytes, beginning `{"elements":10,"tally":{"font-family":{"Georgia, serif":9,"Arial":1},...` (evidence/tool-playwright-cli/outputs/style-audit.json).
  - Command run: `playwright-cli --raw run-code --filename=used-fonts.js` → `{"h1":[{"familyName":"Georgia","postScriptName":"Georgia-Bold","isCustomFont":false,"glyphCount":15}],...,"button":[{"familyName":"Arial","postScriptName":"ArialMT",...}]}`.
  - [element-attributes.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/references/element-attributes.md) — Microsoft, v0.1.22, accessed 2026-09-30 — skill reference.
    - `playwright-cli eval "el => getComputedStyle(el).display" e7`
  - [browser_protocol.json](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json) — Chrome DevTools team, protocol 1.3, repo updated 2026-09-30, accessed 2026-09-30 — protocol definition.
    - getPlatformFontsForNode: "Requests information about platform fonts which we used to render child TextNodes in the given node."; CSS domain `"experimental": true`
- **Limits / false positives:**
  - CDP works on Chromium only. An experimental domain can change between Chrome versions.
  - The tell mapping is my proposal, not a sourced rule. It needs the control-corpus calibration the skill family requires.

### FD06-F13 — What the model can see: visual-token cost, downscaling and the 20-image rule favour viewport slices over tall full-page captures
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - An image costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens.
  - High-resolution tier (Claude 4.7 and later): at most 2576 px on the long edge and 4784 visual tokens. Standard tier: 1568 px and 1568 tokens. Larger images are downscaled.
  - When a request holds more than 20 images, a stricter per-image limit applies. That count includes images from earlier turns, so each side should stay at or below 2000 px.
  - Observed in Claude Code 2.1.286: reading a 375x2185 screenshot produced "[Image: original 375x2185, displayed at 343x2000...]".
  - My arithmetic from the documented formula (approximate; the exact resize rule sits on a page I did not open): a 1440x900 slice costs 1716 visual tokens and is not resized; a 375x812 slice costs 406; a 1440x6000 full-page capture would be shrunk to roughly 618x2576 (scale about 0.43), so 16 px body text would render near 7 px.
- **Implication for /frontend:**
  - Critique from viewport-sized slices (1440x900 or smaller) and element crops, never from tall full-page images.
  - Budget about 1.7k visual tokens per desktop slice.
  - Images pile up in the conversation, so run capture and critique in a subagent, or cap the images per pass, to stay under 20 images per request.
- **Evidence:**
  - [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) — Anthropic, accessed 2026-09-30 — official docs.
    - "An image, therefore, costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens."
    - "| High-resolution | Claude 4.7 and later models | 2576 px       | 4784              |"
    - "To stay under the limit on all platforms, either resize each image so that neither dimension exceeds 2000 px, or keep the request to 20 or fewer image and document blocks."
  - Observed in this session: the Read tool on `shots/375-light-full.png` returned "[Image: original 375x2185, displayed at 343x2000. Multiply coordinates by 1.09 to map to original image.]"; the 1440x900 slice was displayed without a resize note.
  - [Vision](https://platform.claude.com/docs/en/build-with-claude/vision), Request limits section — Anthropic, accessed 2026-09-30 (added at verification).
    - "Images exceeding the stricter limit are rejected with an `invalid_request_error` whose message references "many-image requests" and states the current limit in pixels." Above 20 images the API rejects oversized images rather than downscaling them, which makes the 2000 px ceiling a hard limit for a many-image critique pass.
  - [How Claude resizes and pads images](https://platform.claude.com/docs/en/build-with-claude/vision-coordinates#how-claude-resizes-and-pads-images) — Anthropic, accessed 2026-09-30 — official docs, opened at verification.
    - "Claude finds the largest aspect-preserving size that satisfies both of the model's image limits"; the page's reference implementation `resized_size(width, height, max_edge=2576, max_tokens=4784)`, run at verification, returns 1440x900 unchanged (1716 tokens), 375x812 unchanged (406 tokens) and 1440x6000 → 618x2576 (2116 tokens, scale 0.429), which confirms the arithmetic above.
    - Re-observed at verification: Read on the evidence copy of `375-light-full.png` again displayed it at 343x2000, and a 1440x900 slice was shown without a resize note.
- **Limits / false positives:** Claude Code's own display resizing is observed behaviour, not documented policy, and may change between versions. The token figures are derived, not measured.

### FD06-F14 — `toHaveScreenshot`: the baseline is written on the first run, is named per platform, and the defaults are strict and dependent on the machine
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - The first run fails and writes the actual screenshot as the baseline. The observed message was "A snapshot doesn't exist at ...\home.spec.mjs-snapshots\home-w1440-win32.png, writing actual."
  - Baseline names carry the project and the platform (`home-w375-win32.png`). Playwright retakes screenshots until two consecutive ones match.
  - Defaults:
    - `threshold` 0.2, a perceived colour difference measured in YIQ
    - no pixel tolerance when neither `maxDiffPixels` nor `maxDiffPixelRatio` is set
    - animations disabled, caret hidden, CSS scale
    - waiting for fonts to load
  - The docs warn that rendering varies with OS, version, settings, hardware, power source and headless mode.
  - A failure writes expected, actual and diff PNGs plus an `error-context.md` addressed to an agent: "Explain why, be concise, respect Playwright best practices."
- **Implication for /frontend:**
  - Use `toHaveScreenshot` only as a before-and-after change detector on one machine, within one Chrome version and session.
  - Do not commit `-win32` baselines to a CI that runs on Linux.
  - Read the diff PNG, not just the pass or fail status.
- **Evidence:**
  - [Visual comparisons](https://playwright.dev/docs/test-snapshots) — Microsoft, accessed 2026-09-30 — official docs.
    - "Browser rendering can vary based on the host OS, version, settings, hardware, power source (battery vs. power adapter), headless mode, and other factors."
    - "This method took a bunch of screenshots until two consecutive screenshots matched"
    - "`threshold` defines which pixels are considered different. It is an acceptable perceived color difference between the same pixel in compared images, between `0` (strict) and `1` (lax). Defaults to `0.2`."
  - [params.md](https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md) — Microsoft, main, accessed 2026-09-30.
    - maxDiffPixelRatio: "An acceptable ratio of pixels that are different to the total amount of pixels, between `0` and `1`."
  - [comparators.ts](https://github.com/microsoft/playwright/blob/main/packages/utils/comparators.ts) — Microsoft, main, accessed 2026-09-30 — source code.
    - `threshold: options.threshold ?? 0.2,` and `maxDiffPixels = maxDiffPixels1 ?? maxDiffPixels2 ?? 0;`
  - Command run: `node node_modules/playwright/cli.js test` (twice) → run 1 wrote baselines `home-w375-win32.png` and `home-w1440-win32.png`; run 2 "2 passed (3.1s)". error-context.md call log: "disabled all CSS animations", "waiting for fonts to load...", "waiting 100ms before taking screenshot" (evidence/tool-playwright-cli/outputs/visual-error-context-w375.md).
- **Limits / false positives:** Observed with the Chrome channel only.

### FD06-F15 — A pixel-diff gate measures change, not design quality: a change of the fixture's accent colour (1 px card borders only) passed at `maxDiffPixelRatio: 0.01`
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Changing the accent colour of all three cards from `#0a5` to `#c05` passed both projects at `maxDiffPixelRatio: 0.01`. In the fixture the accent paints only the 1 px borders of the three cards (`.card { border: 1px solid var(--accent) }`), with no fills or text, so the change touched few pixels. (corrected: the title called it "a full accent-colour change", which reads as a brand-colour swap on a real page; the result holds only for a hairline accent)
  - With the ratio set to 0 the same change failed:
    - 375 wide: 2,874 differing pixels out of 810,375 (0.35%)
    - 1440 wide: 3,632 out of 2,642,400 (0.14%)
  - Both messages printed "ratio 0.01", because Playwright rounds the ratio up to two decimals before printing it.
- **Implication for /frontend:**
  - "Visual regression passed" says nothing about brand, hierarchy or slop. Never let a percentage gate stand in for the slop checker or for critique.
  - When a diff gate is used to detect unintended change, set an absolute `maxDiffPixels` or a ratio of 0, log the true ratio computed from the count, and look at the diff PNG.
- **Evidence:**
  - Commands run: run 3 (accent changed, ratio 0.01) → "2 passed (4.2s)"; run 4 (ratio 0) → "2874 pixels (ratio 0.01 of all image pixels) are different." and "3632 pixels (ratio 0.01 of all image pixels) are different." (diff image in evidence/tool-playwright-cli/outputs/visual-diff-w1440.png).
  - [comparators.ts](https://github.com/microsoft/playwright/blob/main/packages/utils/comparators.ts) — Microsoft, main, accessed 2026-09-30 — source code.
    - `const ratio = Math.ceil(count / (expected.width * expected.height) * 100) / 100;`
- **Limits / false positives:** This is one fixture, and 1 px borders are a worst case for ratio gates. Large-area colour changes would trip a 1% gate.

### FD06-F16 — On this machine, a Playwright Test run without its own package.json writes `test-results` into the home folder
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - `TestConfig.outputDir` defaults to `<package.json-directory>/test-results`.
  - `C:/Users/Utilisateur/package.json` exists. A run from a scratch folder without its own package.json therefore created `C:/Users/Utilisateur/test-results` (created 21:38:43, removed after the check).
  - With an explicit `outputDir: './test-results'`, the artifacts stayed in the project folder.
- **Implication for /frontend:** Any Playwright config that /frontend generates must set `outputDir`, and the checks must run from the project root that has its own `package.json`. Otherwise failure artifacts land outside the repo and `/harden` or `/execution` receipts point at the wrong place.
- **Evidence:**
  - [TestConfig.outputDir](https://playwright.dev/docs/api/class-testconfig#test-config-output-dir) — Microsoft, accessed 2026-09-30 — official docs.
    - "The output directory for files created during test execution. Defaults to `<package.json-directory>/test-results`."
  - Command run: `Get-Item C:\Users\Utilisateur\test-results` → CreationTime 30/09/2026 21:38:43; `Test-Path C:\Users\Utilisateur\package.json` → True.
- **Limits / false positives:** This is specific to this machine's home-level package.json, but every monorepo has the same rule of the nearest package.json.

### FD06-F17 — Starting the dev server and checking it is up: use `webServer` for Playwright Test; for the CLI, the exit code of `open` is the check
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Playwright Test's `webServer` starts a command and waits until `url` answers with 2xx, 3xx, 400, 401, 402 or 403. The default timeout is 60000 ms, and `reuseExistingServer: !process.env.CI` is the recommended setting.
  - Its graceful-shutdown option is ignored on Windows.
  - With the CLI, `open` or `goto` to a closed port printed `net::ERR_CONNECTION_REFUSED` and exited with code 1; with `--json` it returned `{"isError": true, ...}`.
  - Navigation (`open <url>`, `goto`) waits for `"domcontentloaded"`, then waits up to 5 s for the `load` event and continues silently if it has not fired. At verification, `goto` to a page whose only image never loads returned after 5.7 s with no error and `document.readyState` still `"interactive"`, against 0.6 s for the fixture. (corrected: the dossier said navigation waits only for "domcontentloaded"; the call log it cited came from a refused connection, which fails before the load wait)
- **Implication for /frontend:**
  - Start the dev server in the background (in Claude Code, `run_in_background`; this environment's Bash tool blocks a foreground `sleep` and points to a polling loop instead).
  - Poll readiness by the exit code of `playwright-cli open`, or by `curl`.
  - Before capturing, wait for fonts (the screenshot does this) and for images or data. The CLI's own `load` wait is capped at 5 s and a slow page is then captured half-loaded without any error, so the capture script must wait explicitly (`page.waitForLoadState('load')` inside `run-code`, which is bound by Playwright's own timeout rather than the CLI's 5 s cap, or a selector for client-side data). (corrected: implication adjusted to the 5 s load cap)
  - On Windows, stop the dev server explicitly after the pass.
- **Evidence:**
  - [Web server](https://playwright.dev/docs/test-webserver) — Microsoft, accessed 2026-09-30 — official docs.
    - "URL of your http server that is expected to return a 2xx, 3xx, 400, 401, 402, or 403 status code when the server is ready to accept connections."
    - "Windows doesn't support `SIGTERM` and `SIGINT` signals, so this option is ignored on Windows."
    - "`timeout` | How long to wait for the process to start up and be available in milliseconds. Defaults to 60000."
  - Command run: `playwright-cli open http://127.0.0.1:8799/ > out.txt; echo $?` → `1`; the output contains "Error: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8799/" and "waiting until "domcontentloaded"". `playwright-cli --json goto ...` → `{"isError": true, "error": "Error: net::ERR_CONNECTION_REFUSED ..."}`. (Re-run at verification with the same results.)
  - [tab.ts, `navigate()`](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/backend/tab.ts) — Microsoft, main, accessed 2026-09-30 — source code (added at verification); the same two calls are in `lib/coreBundle.js` of playwright-core 1.64.0-alpha-1790635538000, which 0.1.22 ships.
    - `await this.page.goto(url, { waitUntil: 'domcontentloaded', ...this.navigationTimeoutOptions });` … `// Cap load event to 5 seconds, the page is operational at this point.` / `await this.waitForLoadState('load', { timeout: 5000 });`
  - Command run at verification: a page containing only `<img src="http://10.255.255.1/never.png">`; `time playwright-cli -s=vfy goto http://127.0.0.1:8766/slow.html` → `real 0m5.671s`, no error; `--raw eval "() => document.readyState"` → `"interactive"`. The fixture page: `real 0m0.630s`.
- **Limits / false positives:** I did not start a real Vite or Next dev server; the fixture was served by `python -m http.server`.

### FD06-F18 — `install --skills` puts the upstream skill in `.claude/skills/playwright-cli`; do not vendor a copy of it
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - `playwright-cli install --skills` initialises the workspace: it creates `.playwright/`, patches `.gitignore` if a `.git` exists, copies SKILL.md (15,428 bytes) and 10 reference files into `.claude/skills/playwright-cli`, and then resolves a browser. (corrected: the dossier put browser resolution before the skill copy; `initWorkspace` installs the skill first, which matches the observed output order)
  - `--skills=agents` targets `.agents/skills` instead. `-g` installs into the home folder and skips workspace initialisation.
  - The skill's frontmatter pre-approves `Bash(playwright-cli:*) Bash(npx playwright:*) Bash(npx --no-install playwright:*)`.
  - The CLI checks at most once a day whether an installed SKILL.md differs from the bundled one, and warns that it "does not match the tool version". The check reads only `<cwd>/.claude/skills/playwright-cli` and `<cwd>/.agents/skills/playwright-cli`, so a copy installed with `-g` into the home folder is never compared, and the whole check is skipped when `NO_UPDATE_NOTIFIER` or `CI` is set. (corrected: added the scope of the check, which the implication below depended on)
  - The plugin route announced in v0.0.58 (`/plugin marketplace add microsoft/playwright-cli`) has no plugin or marketplace files in the current repository tree.
- **Implication for /frontend:**
  - Depend on the upstream skill (installed per project or with `-g`), or on `playwright-cli --help`.
  - Put only the design-specific knowledge the upstream skill lacks in /frontend's own text: `--full-page`, emulation passes, batching, slices, the reveal probe.
  - A vendored copy goes stale. It triggers the mismatch warning only when it sits in the project's `.claude/skills/playwright-cli`; a global (`-g`) copy, or any run with `NO_UPDATE_NOTIFIER`/`CI` set, goes stale silently, so /frontend should reinstall the skill with the pinned CLI version, or compare the installed SKILL.md with the bundled `playwright-core/lib/tools/skills/playwright-cli/SKILL.md` itself (the frontmatter carries no version field). (corrected: the warning does not cover global installs)
- **Evidence:**
  - [installSkills.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/utils/installSkills.ts) — Microsoft, main, accessed 2026-09-30 — source code.
    - ``const destDir = path.join(baseDir, `.${target}`, 'skills', skill);``
  - [SKILL.md frontmatter](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - `allowed-tools: Bash(playwright-cli:*) Bash(npx playwright:*) Bash(npx --no-install playwright:*)`
  - [skillCheck.js](https://github.com/microsoft/playwright-cli/blob/main/skillCheck.js) — Microsoft, v0.1.22, accessed 2026-09-30.
    - `` `does not match the tool version.`, ``
    - `{ dir: path.join(cwd, '.claude', 'skills', 'playwright-cli'), command: 'playwright-cli install --skills' },` and the matching `.agents` entry are the only targets (read at verification).
  - [playwright-cli.js](https://github.com/microsoft/playwright-cli/blob/main/playwright-cli.js) — Microsoft, v0.1.22, accessed 2026-09-30 (added at verification).
    - `if (process.env.NO_UPDATE_NOTIFIER || process.env.CI)` / `return;` precedes both the daily `checkInstalledSkills()` call and the npm `latest` lookup.
  - [coreBundle.js, initWorkspace](https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1790635538000.tgz) — Microsoft, accessed 2026-09-30 (added at verification).
    - Order in `initWorkspace`: `mkdir(.playwright)` → `patchGitIgnore(cwd)` → `installSkills([...])` → `ensureConfiguredBrowserInstalled()`; with `--global`, the workspace steps and the browser step are skipped.
  - Command run (empty scratch workspace): `playwright-cli install --skills` → "Workspace initialized at ...", "Skill installed to `.claude\skills\playwright-cli`.", "Found chrome, will use it as the default browser."; `ls .claude/skills/playwright-cli/references | wc -l` → `10`.
  - Command run: `gh api repos/microsoft/playwright-cli/git/trees/main?recursive=1` filtered for `plugin|marketplace` → no match.
  - [Release v0.1.19](https://github.com/microsoft/playwright-cli/releases/tag/v0.1.19) — Microsoft, 2026-09-01, accessed 2026-09-30.
    - "The installed-skill check honors `NO_UPDATE_NOTIFIER` / `CI` and runs at most once a day"
- **Limits / false positives:** The agent-cli installation page describes the `.gitignore` edit differently from the code (see Contradictions).

### FD06-F19 — Sessions, profiles and configuration: headless, in-memory profile, 1280x720, idle shutdown after one hour
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - The browser profile is in memory by default; the v0.0.58 notes had said persistent by default. `--persistent` and `--profile=<dir>` persist it.
  - Named sessions: `-s=name` or the `PLAYWRIGHT_CLI_SESSION` variable.
  - The CLI is headless by default. A headless session gets a 1280x720 viewport; a headed session gets `viewport: null`, the size of the window.
  - A headless session shuts down after one hour without commands (since 0.1.20); `--idle-timeout` changes this.
  - Configuration merges `.playwright/cli.config.json` over `~/.playwright/cli.config.json`. Environment variables use the `PLAYWRIGHT_MCP_` prefix.
- **Implication for /frontend:** Run capture passes in a dedicated named session (for example `-s=frontend`) so they never collide with other agents' sessions on the same machine, and close it at the end of the pass. The in-memory default suits design review because no stale cookies or theme preference carry over.
- **Evidence:**
  - [README.md](https://github.com/microsoft/playwright-cli/blob/main/README.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - "Playwright CLI keeps the browser profile in memory by default."; "Playwright CLI is headless by default."; "A headless session shuts down on its own after an hour without commands"
  - [Release v0.0.58 · playwright-mcp](https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.58) — Microsoft, 2026-01-24, accessed 2026-09-30.
    - "Playwright CLI will use a dedicated persistent profile by default."
  - [coreBundle.js, validateBrowserConfig](https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1790635538000.tgz) — Microsoft, accessed 2026-09-30.
    - `browser.contextOptions.viewport = { width: 1280, height: 720 };` (headless) / `browser.contextOptions.viewport = null;` (headed)
  - Command run: `playwright-cli list` → `user-data-dir: <in-memory>`, `headed: false`.
- **Limits / false positives:** None found.

### FD06-F20 — Windows: works; mind `&` in URLs, avoid `kill-all`, and require 0.1.19 or later
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Observed working on Windows 11 with Git Bash and node 24.13.0, with daemon state under `%LOCALAPPDATA%\ms-playwright\daemon`.
  - The skill warns that `&` in URLs is a command separator in cmd.exe and PowerShell.
  - `kill-all` on Windows runs PowerShell `Get-CimInstance Win32_Process` and force-stops every process whose command line contains `run-mcp-server`, `run-cli-server`, `cli-daemon`, `cliDaemon.js` or `dashboardApp.js`.
  - Release 0.1.19 fixed a console window opening for each daemon on Windows, and long workspace paths truncating the daemon socket path.
- **Implication for /frontend:**
  - Close sessions by name (`-s=frontend close`) and never use `kill-all`, which also stops other agents' Playwright daemons.
  - Require 0.1.19 or later on Windows.
  - Quote URLs. Git Bash is unaffected by the `&` issue when the URL is quoted.
- **Evidence:**
  - [SKILL.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - "On Windows, `cmd.exe` and PowerShell treat `&` as a command separator, so URLs with multiple query parameters get truncated before `playwright-cli` runs. Escape `&` with `^&` in `cmd.exe`, or use `--%` in PowerShell:"
  - [cli-client/program.js in playwright-core 1.64.0-alpha-1790635538000](https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0-alpha-1790635538000.tgz) — Microsoft, accessed 2026-09-30 — published file.
    - `const daemonProcessPatterns = ["run-mcp-server", "run-cli-server", "cli-daemon", "cliDaemon.js", "dashboardApp.js"];` and `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { ${whereClause} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force ...`
  - [Release v0.1.19](https://github.com/microsoft/playwright-cli/releases/tag/v0.1.19) — Microsoft, 2026-09-01, accessed 2026-09-30.
    - "The session daemon no longer opens a console window on Windows"; "Long workspace paths no longer truncate the daemon socket path, which left sessions stuck with `EADDRINUSE`"
  - Commands run: all CLI commands in evidence/tool-playwright-cli/outputs/observed-session.md.
- **Limits / false positives:** I did not test invocation from cmd.exe or PowerShell, or headed mode.

### FD06-F21 — Slack's 200-run study: the CLI took about twice the turns, used more tokens and failed more often than MCP
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - Setup: more than 200 runs, 20 per configuration, with Claude Sonnet 4.5 driving MCP and CLI and Claude Opus 4.6 generating tests, through non-interactive `claude -p`. Flows were a thread reply of about 15–20 steps and a search discovery of about 25–30 steps.
  - Failure rates: MCP 0% and about 12%; CLI about 12% and about 20%; generated tests about 8% and about 48%.
  - Runtimes: MCP about 5–8 min, CLI about 9–11 min, generated tests about 3 min.
  - Tokens on the search flow: MCP (Opus 4.6) about 3.8M against CLI (Opus 4.6) about 6M.
  - Turns: about 40 for MCP (Opus and Sonnet), about 85 for the CLI.
  - Slack attributes most CLI failures to the execution layer (authentication, navigation, session instability), not to reasoning.
  - No tool versions were stated.
- **Implication for /frontend:** The CLI's per-response thrift does not lower total cost when the loop issues one command per step. /frontend must batch (F09) and keep evidence in files the agent reads selectively. Otherwise the CLI loop is slower and costlier than MCP.
- **Evidence:**
  - [Agentic Testing: Where Agents Fit in the E2E Testing Stack](https://slack.engineering/agentic-testing-where-agents-fit-in-the-e2e-testing-stack/) — Sergii Gorbachov (Slack), 2026-06-11, accessed 2026-09-30 — engineering blog with data.
    - "On average, CLI took 85 turns compared to MCP’s ~40-60 because each browser interaction was split across multiple commands, such as actions, waits, snapshots, reads, and element lookups. MCP combined interaction and state return into a single round trip."
    - "Most failures in CLI-based runs came from authentication and navigation issues (sign-in errors, timeouts, and session instability), suggesting that many failures were caused by the execution layer rather than the agent’s reasoning."
    - Token table: "MCP (Opus 4.6) | ~3.8M" … "CLI (Opus 4.6) | ~6M"
- **Limits / false positives:**
  - These are E2E test flows with login, not design captures.
  - The CLI version was unstated and at most 0.1.14 by the publication date, predating the idle-timeout and Windows fixes.
  - The turn counts mix models.
  - The source is internally inconsistent on the CLI's model: its "Experiment Setup" names Claude Sonnet 4.5 as the agent model for MCP and CLI, while its turn and token tables label the only CLI row "CLI (Opus 4.6)". (note added at verification)

### FD06-F22 — Outpost/Ranger: the CLI used half the context but took twice as long, and cost about the same
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - Setup: two scenarios of about 10 steps each, Claude Sonnet 4.6.
  - Context: the Playwright CLI (and Vercel's agent-browser) ended scenario 1 at about 22k–24k tokens against 50k for MCP.
  - Speed: MCP runs took about 90 s and 120 s; CLI runs took double or more, because the agents made 2–3 times more tool calls. Each CLI step needed a Grep or file read of the snapshot.
  - Cost: average cost was slightly lower for MCP. In one example, MCP took 15 turns and $0.39 against 42 turns and $0.54 for the CLI.
- **Implication for /frontend:** Same lesson as F21. Design each capture pass so the agent needs no follow-up read of a snapshot file to know the state. Return a compact JSON summary (paths, probe results, style tallies) from the `run-code` script itself.
- **Evidence:**
  - [The Hidden Cost of Fewer Tokens: Why context efficiency makes the Playwright CLI slower](https://outpost.ranger.net/post/the-hidden-cost-of-fewer-tokens/) — Mikayla Thompson (Ranger), 2026-04-03, accessed 2026-09-30 — vendor blog with data.
    - "The MCP case consistently took about half the time as the CLI."
    - "the agents used dramatically more tool calls (2-3x) to accomplish the same goal with the CLIs."
    - "the Playwright CLI and agent-browser average about 22k-24k tokens to complete scenario 1. The MCP requires 50k."
    - "Average costs were slightly lower for the MCP."
- **Limits / false positives:** Small runs, versions unstated (the CLI was at most 0.1.5 on the publication date; 0.1.1 was the latest from 2026-02-14 to 2026-03-31, so the runs may have used it or an earlier build), and the vendor sells a product built on MCP. (corrected: "around 0.1.2–0.1.5" gave a lower bound the post does not support)

### FD06-F23 — By mid-2026 the per-action token gap between CLI and MCP had largely closed
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - Checkly (3 runs per side, same shopping task, Claude Code): MCP ended at 48k–50k tokens of context and the CLI at 45k–48k. Checkly attributes the change to deferred MCP tool loading and to MCP writing snapshots to disk.
  - Aswani Kumar re-ran a 7-step flow with MCP 0.0.78 and CLI 0.1.17: about 3,580 against about 3,620 characters returned into context, "within ~1%". In a separate test, a single `navigate` to a heavy 300-row page, both returned a path of about 230 characters instead of the tree of about 97,000 characters. (corrected: the 230 vs 97,000 figure comes from that separate single-navigate test, not from the 7-step flow)
  - Earlier, Better Stack (Feb 2026, one run) measured the CLI's upfront cost at 68 tokens against 3,600 for MCP's tool schemas, with 16% against 18% of a 200k window at the end.
  - Observed in this Claude Code session: MCP tools are listed as deferred names whose schemas load on demand.
- **Implication for /frontend:** Do not justify the CLI by token savings. Justify it by shell composability (scripts, files, exit codes, `--raw` pipes into the checker) and by the fact that /execution's agents already run in a shell. Keep Playwright MCP out of the loop unless a specific capability needs it.
- **Evidence:**
  - [MCP vs CLI: Are CLIs Really More Token-Efficient?](https://www.checklyhq.com/blog/mcp-vs-cli-token-efficiency/) — Stefan Judis (Checkly), 2026-07-30, accessed 2026-09-30 — vendor blog with a measurement.
    - "The MCP session ended at 48k to 50k tokens of context, the CLI session at 45k to 48k."
    - "The viral Playwright video that made me switch was accurate when it was recorded and stale within a quarter."
  - [Playwright CLI vs Playwright MCP: Which Should You Use with Claude Code?](https://dev.to/aswani25/playwright-cli-vs-playwright-mcp-which-should-you-use-with-claude-code-1olh) — Aswani Kumar, 2026-07-15 (updated 2026-07-24), accessed 2026-09-30 — practitioner blog with a measurement.
    - "On an identical login → dashboard flow the two tools landed within ~1% of each other, not 114k vs 27k."
  - [Playwright CLI vs. MCP: Browser Automation for Coding Agents](https://betterstack.com/community/guides/ai/playwright-cli-vs-mcp-browser/) — Stanley Ulili (Better Stack), updated 2026-02-22, accessed 2026-09-30 — vendor guide with one run.
    - "The entire 'cost' of making the agent aware of the vast capabilities of Playwright via the CLI is just 68 description tokens."; "A whopping 3,600 tokens are consumed just to define the available functions."
  - Observed: this session's ToolSearch tool description reads "Deferred tools appear by name in <system-reminder> messages. Until fetched, only the name is known".
- **Limits / false positives:** Every measurement is small (n=1 to 3) and on a different task, and none is on a design-review loop.

### FD06-F24 — The quoted "114k vs 27k tokens, Microsoft's benchmark" appears in no official text I could find
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The official texts describe the CLI as token-efficient but give no numbers:
  - the README says "Token-efficient. Does not force page data into LLM."
  - the Playwright docs' comparison table rates token cost as "Lower" against "Higher"
  - the official video's description lists "Token efficiency" without a number

  Secondary sources attribute "~114K tokens via MCP versus ~27K via CLI" to "Microsoft’s benchmarks" without linking a source.
- **Implication for /frontend:** Do not repeat the 114k/27k figure in /frontend, in the README or in a pitch. If a number is needed, measure the /frontend loop itself.
- **Evidence:**
  - [README.md](https://github.com/microsoft/playwright-cli/blob/main/README.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - "- **Token-efficient**. Does not force page data into LLM."
  - [Playwright CLI introduction](https://playwright.dev/agent-cli/introduction) (source: agent-cli/introduction.mdx) — Microsoft, accessed 2026-09-30.
    - "| **Token cost** | Lower — concise CLI output, skills loaded on demand | Higher — tool schemas + snapshots in context |"
  - [Playwright CLI vs MCP - a new tool for your coding agent](https://www.youtube.com/watch?v=Be0ceKN81S8) — Playwright channel, 2026-02-06, accessed 2026-09-30 — the description read through the page's `shortDescription` field; the video itself was not watched.
    - "✅ Token efficiency"
  - [Playwright MCP Burns 114K Tokens Per Test. The New CLI Uses 27K.](https://scrolltest.medium.com/playwright-mcp-burns-114k-tokens-per-test-the-new-cli-uses-27k-heres-when-to-use-each-65dabeaac7a0) — Pramod Dutta, 2026-02-24, accessed 2026-09-30 — practitioner blog.
    - "Microsoft’s benchmarks: ~114K tokens via MCP versus ~27K via CLI for the same task. A 4x reduction."
    - Re-read at verification through Exa (medium.com returned HTTP 403 to curl and WebFetch): published Feb 24, 2026, byline "Prrammod Dutta", no link attached to the figure. The same post reports the author's own run as "Total: ~89,000 tokens" for MCP and "Total: ~24,000 tokens" for the CLI.
  - GitHub code search at verification (added at verification): `gh search code "114K" --repo microsoft/playwright-mcp`, `"114k" --repo microsoft/playwright-cli` and `"27k" --repo microsoft/playwright.dev` → no results, while `"token-efficient" --repo microsoft/playwright-mcp` returned the README line, so the search itself worked. The Playwright MCP README's own comparison says CLI invocations "are more token-efficient", with no number.
- **Limits / false positives:** The number may be spoken in the official video, which I could not review. At verification the video's auto-generated caption track returned HTTP 404, so the spoken content remains unchecked.

### FD06-F25 — Command names changed between versions; blogs and old skills cite commands that 0.1.22 does not have
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - The v0.0.58 notes used `playwright-cli network`, `session-list`, `session-stop` and `--session=`. In 0.1.22 these are `requests`, `list`, `close` and `-s=`.
  - The 0.1.22 help has 102 commands and none of the old names.
  - A February 2026 article instructs `playwright-cli text e31`. No `text` command exists in 0.1.22 or in the v0.0.58 command list.
- **Implication for /frontend:** Generate every command /frontend emits from the installed version's `--help` (or `playwright-cli --help <command>`), never from memory or blog posts, and fail loudly on unknown commands. This matches the skill family's rule against rules from model memory.
- **Evidence:**
  - [Release v0.0.58 · playwright-mcp](https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.58) — Microsoft, 2026-01-24, accessed 2026-09-30.
    - "playwright-cli session-list             # list all sessions"; "playwright-cli network                  # list all network requests since loading the page"
  - Command run: parsing help.json of 0.1.22 → `102` commands; `'text' in cmds, 'network' in cmds, 'session-list' in cmds` → `False False False`.
  - [Medium article by Pramod Dutta](https://scrolltest.medium.com/playwright-mcp-burns-114k-tokens-per-test-the-new-cli-uses-27k-heres-when-to-use-each-65dabeaac7a0) — 2026-02-24, accessed 2026-09-30.
    - "uses `playwright-cli text e31` to extract KPI values." (the text extractor I used dropped the space before the code span; spacing may differ on the page)
- **Limits / false positives:** I did not check every intermediate version for a short-lived `text` command.

### FD06-F26 — Chrome DevTools MCP 1.10.1 is the tool for performance traces and Lighthouse; it sends telemetry and CrUX lookups by default
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - `chrome-devtools-mcp` (latest 1.10.1, 2026-09-23) records performance traces with `performance_start_trace`, `performance_stop_trace` and `performance_analyze_insight`, aimed at Core Web Vitals (LCP, INP, CLS).
  - `lighthouse_audit` covers accessibility, SEO, best practices and "agentic browsing", and excludes performance.
  - `get_css_styles` returns the matched cascade for an element, with source lines.
  - `emulate` supports CPU and network throttling and a `viewport` string of the form `<w>x<h>x<dpr>[,mobile][,touch]`.
  - It ships an experimental `chrome-devtools` CLI.
  - Usage statistics are enabled by default; `--no-usage-statistics` or `CI` turns them off. Trace URLs may be sent to the CrUX API; `--no-performance-crux` turns that off.
  - It officially supports only Google Chrome and Chrome for Testing.
  - The Playwright CLI's `tracing-start` records a Playwright trace (actions, DOM, network), not a Chrome performance profile.
- **Implication for /frontend:** Keep performance and Core Web Vitals out of /frontend's core loop. If a pass needs them (for example a heavy hero animation), use Chrome DevTools MCP with `--no-usage-statistics --no-performance-crux`, especially on NDA or client work. `get_css_styles` answers "why is this element styled this way" per element, whereas F12's tally covers the whole page.
- **Evidence:**
  - [chrome-devtools-mcp README](https://github.com/ChromeDevTools/chrome-devtools-mcp) — Chrome DevTools team, npm 1.10.1 (2026-09-23), accessed 2026-09-30 — the tool's own docs.
    - "Performance tools may send trace URLs to the Google CrUX API to fetch real-user experience data."
    - "Data collection is **enabled by default**. You can opt-out by passing the `--no-usage-statistics` flag"
    - "`chrome-devtools-mcp` officially supports Google Chrome and [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing/) only."
  - [tool-reference.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md) — accessed 2026-09-30.
    - performance_start_trace: "Start a performance trace on the target webpage. Use to find frontend performance issues, Core Web Vitals (LCP, INP, CLS), and improve page load speed."
    - lighthouse_audit: "Get Lighthouse score and reports for accessibility, SEO, best practices, and agentic browsing. This excludes performance."
  - [docs/cli.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md) — accessed 2026-09-30.
    - "The `chrome-devtools-mcp` package includes an **experimental** CLI interface"
  - [tracing.md (playwright-cli skill)](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/references/tracing.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - "Capture detailed execution traces for debugging and analysis. Traces include DOM snapshots, screenshots, network activity, and console logs."
- **Limits / false positives:** Read from the docs, not run. Lighthouse accessibility overlaps with /harden's axe-core floor, so /frontend should not duplicate it.

### FD06-F27 — `show --annotate` lets the owner draw on the live page and hand the annotations back to the agent (not tested)
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** The skill documents `playwright-cli show --annotate`: the user draws boxes on the live page and types comments, and the agent receives the annotated screenshot, the snapshot of the marked region and the notes. The MCP counterpart, `browser_annotate`, "Returns the annotated screenshot, ARIA snapshot, and the list of annotations."
- **Implication for /frontend:** This is a candidate channel for the owner's design feedback during /execution. It is structured and tied to regions, and cheaper than prose descriptions of "the thing top-left". Test it on this Windows machine before relying on it.
- **Evidence:**
  - [SKILL.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - "Ask the user for UI review or design feedback. The user draws boxes on the live page and types comments; you receive the annotated screenshot, the snapshot of the marked region, and the user's notes."
  - [Playwright MCP README](https://github.com/microsoft/playwright-mcp/blob/main/README.md) — Microsoft, npm 0.0.83 (2026-09-28), accessed 2026-09-30.
    - "Open the Playwright Dashboard in annotation mode for the current page and wait for the user to draw annotations. Returns the annotated screenshot, ARIA snapshot, and the list of annotations."
- **Limits / false positives:** Not run; it needs a GUI session and a human.

### FD06-F28 — Scripted "hero" videos with cursor, chapters and overlays belong to the deliverable phase, not to /frontend's loop
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - `video-start [file] --cursor --fps=60` records WebM, 25 fps by default. `--cursor` paces actions by 800 ms.
  - `video-chapter` adds chapter cards, and `page.screencast.showChapter/showActions/showOverlay` (present in the 1.63.0 and 1.64 alpha typings) script overlays from `run-code`.
  - The skill notes a GitHub upload limit of 10 MB for videos on free plans (100 MB on paid).
- **Implication for /frontend:** /frontend may leave the recording scripts ready, but a recorded demo is a deliverable. The owner's rule puts it after "build complete, then harden, then fix". /frontend should not produce the TOKEN2049 video during the build.
- **Evidence:**
  - [video-recording.md](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/references/video-recording.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - "Videos are limited to 10 MB on free plans and 100 MB on paid plans"
  - 0.1.22 help: "--cursor                    render an animated mouse cursor that travels to each action point. paces actions by 800ms so that the cursor has time to travel."; "--fps                       video frame rate in frames per second, defaults to 25."
  - Command run: `grep -n "showChapter|showActions|showOverlay" types/types.d.ts` → matches at lines 18807, 18876 and 18894 (1.64 alpha); `grep -cE "showChapter|showActions|showOverlay"` on the v1.63.0 `packages/playwright-core/types/types.d.ts` → `9`, with the three method declarations at lines 18674, 18703 and 18721. (corrected: the dossier gave a count of 7; the re-run count is 9, and the conclusion that the methods exist in 1.63.0 stands)
- **Limits / false positives:** Video recording was not run (the ffmpeg-1011 it needs is installed).

### FD06-F29 — The build-screenshot-critique-fix loop, with the steps I verified marked
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The sequence below ran end to end on this machine against a local fixture served on 127.0.0.1:8765, except the steps marked NOT RUN. It needs 4 commands per capture pass, whatever the number of viewports and schemes.

```bash
# 0. Setup, once per project. The pnpm line was NOT RUN: the 0.1.22 tarballs were unpacked into a scratch node_modules instead.
pnpm add -D @playwright/cli@0.1.22          # then call it as: pnpm exec playwright-cli ...
pnpm exec playwright-cli install --skills   # RUN (scratch): .claude/skills/playwright-cli + .playwright/, found system Chrome
# add to .gitignore: .playwright-cli/  .frontend/shots/

# 1. Dev server in the background. NOT RUN (fixture served by: python -m http.server 8765 --bind 127.0.0.1)
pnpm dev --port 5173 --strictPort           # Claude Code: run_in_background

# 2. Readiness + session. RUN: exits 1 with net::ERR_CONNECTION_REFUSED until the server answers
pnpm exec playwright-cli -s=frontend open http://127.0.0.1:5173/

# 3. Capture pass: ONE call. RUN: 22 slices of 4 sizes x 2 schemes in 7.5 s
#    (full-page variant: 8 shots in 3.8 s, only for page-length overview, never for critique)
pnpm exec playwright-cli -s=frontend --raw run-code --filename=.frontend/slice-capture.js

# 4. Probes: ONE call each. RUN
pnpm exec playwright-cli -s=frontend --raw run-code --filename=.frontend/reveal-probe.js  > .frontend/reveal.json
pnpm exec playwright-cli -s=frontend --raw run-code --filename=.frontend/style-audit.js  > .frontend/style-audit.json
pnpm exec playwright-cli -s=frontend --raw run-code --filename=.frontend/used-fonts.js   > .frontend/fonts.json

# 5. Mobile truth pass (touch, DPR). RUN with --device="iPhone 15"; the "iPhone SE (3rd gen)" name is from the registry, NOT RUN
pnpm exec playwright-cli -s=mobile open http://127.0.0.1:5173/ --device="iPhone SE (3rd gen)"
pnpm exec playwright-cli -s=mobile screenshot --filename=.frontend/shots/iphone-se.png
pnpm exec playwright-cli -s=mobile close

# 6. Critique: the agent Reads viewport slices (<= 1440x900 each, <= 20 images per request) plus the JSON probes.
# 7. Fix: edit code; the dev server reloads; rerun steps 3-4 into a new iteration folder; compare before/after slices.
# 8. Close the named session (never kill-all). RUN
pnpm exec playwright-cli -s=frontend close
```

  The capture script is in evidence/tool-playwright-cli/scripts/slice-capture.js. For each colour scheme it calls `page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' })`. It sets each viewport in [375x812, 768x1024, 1280x800, 1440x900], scrolls one viewport at a time and waits 250 ms per step, then calls `page.screenshot({ path, animations: 'disabled' })`. It returns `{count, first, last}`. The iPhone SE device name was taken from the registry but not run; I ran `--device="iPhone 15"`.
- **Implication for /frontend:**
  - Ship this loop as the skill's capture primitive, with its scripts as versioned files.
  - The receipt for each iteration is the folder of slices plus the three JSON probes.
  - Critique reads slices, never full-page captures (F10, F13).
  - A pass that changes nothing visible should still produce a diff (F15) so "no change" is proven, not assumed.
- **Evidence:**
  - Commands and outputs: evidence/tool-playwright-cli/outputs/observed-session.md (all runs of 2026-09-30); scripts in evidence/tool-playwright-cli/scripts/.
  - [SKILL.md, Open parameters](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md) — Microsoft, v0.1.22, accessed 2026-09-30.
    - "playwright-cli open --device=\"iPhone 15\""
- **Limits / false positives:**
  - Verified on a static fixture with 11 elements, Chrome 154 and no web fonts.
  - Hot reload of a Vite or Next server, authenticated pages and pages that keep animating were not exercised.
  - `pnpm exec` resolution was not run.
  - Verification (2026-09-30) re-ran steps 2, 3, 4 and 8 on 0.1.22 against the same fixture, plus the `open --device="iPhone SE (3rd gen)"` line of step 5 marked NOT RUN above: it opened with innerWidth 375, height 667, DPR 2, hover none and pointer coarse (the step-5 screenshot itself was not re-run). Step 2 relies on `open` returning only after a capped `load` wait (F17): a page that is still loading after 5 s is not reported as an error. (note added at verification)

### FD06-F30 — Piping `--raw` output needs care: a string returned by `eval` arrives JSON-encoded, so the bundled skill's own `jq` recipe fails (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:**
  - SKILL.md 0.1.22 documents `playwright-cli --raw eval "JSON.stringify(performance.timing)" | jq '.loadEventEnd - .navigationStart'` under "Raw output".
  - On 0.1.22 that exact pipe fails: `--raw` prints the returned string as a JSON string literal (`"{\"connectStart\":...}"`), and `jq` stops with `jq: error (at <stdin>:1): Cannot index string with string "navigationStart"`, exit code 5.
  - Returning an object works: `--raw eval "() => performance.timing.toJSON()" | jq '.loadEventEnd - .navigationStart'` printed `269`, and so did the original command piped to `jq 'fromjson | .loadEventEnd - .navigationStart'`.
  - With `--json`, error text keeps its terminal colour codes: the `ERR_CONNECTION_REFUSED` error string contained `\u001b[2m` sequences.
- **Implication for /frontend:** Every probe that feeds the slop checker should return a plain object from `eval` or `run-code`, never `JSON.stringify(...)`, and the checker should parse the output once and fail loudly if the result is still a string. Strip ANSI sequences before matching on `--json` error text. Do not copy the recipes in the upstream skill's "Raw output" section into /frontend without running them. This extends F12's note on double encoding and gives it a concrete failure.
- **Evidence:**
  - [SKILL.md, "Raw output"](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md) — Microsoft, v0.1.22 (identical to the copy bundled in playwright-core 1.64.0-alpha-1790635538000), accessed 2026-09-30.
    - `playwright-cli --raw eval "JSON.stringify(performance.timing)" | jq '.loadEventEnd - .navigationStart'`
  - Commands run at verification (fixture served on 127.0.0.1:8766, session `-s=vfy`, jq from scoop): the SKILL.md line verbatim → `jq: error (at <stdin>:1): Cannot index string with string "navigationStart"`, `PIPESTATUS[1]` = `5`; `--raw eval "() => JSON.stringify({a:1})"` → `"{\"a\":1}"`; `--raw eval "() => ({a:1})"` → a JSON object; `--json goto http://127.0.0.1:8799/` → `"error": "Error: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8799/\nCall log:\n\u001b[2m  - navigating to ...`.
- **Limits / false positives:** Observed with jq 1.8.1 on Git Bash only. `performance.timing` is a deprecated API and was used only because the skill's example uses it.

## Contradictions between sources

1. **Token efficiency.**
   - Playwright's docs rate the CLI's token cost "Lower" and MCP's "Higher" (F24).
   - Slack measured the CLI at about 6M tokens against MCP's 3.8M, in about 85 turns against 40, with 12–20% failures against 0–12% (F21).
   - Outpost measured half the context for the CLI but double the time and a slightly higher cost (F22).
   - Checkly and Kumar measured parity by July 2026 (F23).
   - The official claim holds for how full the context is at a given moment, not for total billed tokens, wall-clock or reliability.
2. **"114k vs 27k, Microsoft's benchmark".** Secondary sources give this attribution; the README, the docs and the video description contain no number (F24).
3. **Node requirement.** The README and `package.json` (`engines`) say Node 18 or newer; playwright.dev's getting-started-cli and agent-cli installation pages say Node 20 or newer.
4. **`--full-page`.** It is present in the 0.1.22 help and in the agent-cli docs, and absent from the README and the installed SKILL.md (F06).
5. **`video-stop --filename=f`.**
   - docs/src/getting-started-cli.md lists `playwright-cli video-stop --filename=f`.
   - The 0.1.22 help shows `video-stop` with no options; the filename goes on `video-start [filename]`.
6. **Default profile.** The v0.0.58 notes say "a dedicated persistent profile by default"; the current README says "in memory by default" (F19).
7. **The `.gitignore` edit.**
   - The agent-cli installation page says install "creates a `.playwright` directory ... adds it to `.gitignore`".
   - The code appends `.playwright-cli/` and leaves `.playwright/`, which holds `cli.config.json`, untouched.
8. **Full-page semantics.** The Screenshots doc says "as if you had a very tall screen". Issue #40941 and my fixture show that content gated on scrolling is not rendered (F10).
9. **pixelmatch.**
   - Playwright vendors a 2019 Mapbox pixelmatch using YIQ (`// 35215 is the maximum possible value for the YIQ difference metric`) and passes `threshold` 0.2.
   - The latest published pixelmatch, 7.2.0 (npm, 2026-04-29), still uses YIQ: its `index.js` carries the same `35215` comment and `threshold = 0.1` as default. The switch to OKLab ("the OKLab color space used for color difference", README on the main branch) landed on pixelmatch's main branch in July 2026 (commit 50872182, "switch OKLab HyAB perceptual color difference", 2026-07-03), after the 7.2.0 tag, and is unreleased on npm as of 2026-09-30. (corrected: the dossier said 7.2.0 uses OKLab; the published 7.2.0 tarball uses YIQ)
   - The default thresholds already differ (0.1 upstream, 0.2 as Playwright passes it), and a future pixelmatch release on OKLab will change the metric itself, so a threshold tuned in one tool does not carry over to the other.
10. **Device emulation.** One example config on the agent-cli configuration page, labelled "Device emulation", emulates a phone with viewport and user agent only. The Emulation doc's `isMobile` semantics, and my observation (hover stays `hover`, DPR 1), show that this is not mobile emulation (F08). The same page's "Device emulation" section itself recommends `open --mobile` and `open --device`, which are. (corrected: the contradiction is within one page, between an example config and the page's own recommendation)
11. **Screenshot versus snapshot.** SKILL.md calls screenshots "rarely used"; the agent-cli docs make the screenshot the tool for visual layout (F11). This is a difference of emphasis that matters for a design skill.
12. **Reliability.** Slack found MCP more reliable (F21). Better Stack's single run had the CLI succeed where MCP's screenshot step failed (F23). Both are small samples on different tasks.
13. **The skill's `--raw` + `jq` recipe versus the tool.** SKILL.md 0.1.22 pipes `--raw eval "JSON.stringify(performance.timing)"` into `jq '.loadEventEnd - .navigationStart'`; on 0.1.22 the output is a JSON-encoded string and `jq` exits 5 (F30). (added at verification)

## What could not be found, and how it was searched

- **An official Microsoft or Playwright token benchmark with numbers.**
  - Searched: the playwright-cli README and SKILL.md; docs/src/getting-started-cli.md; the agent-cli docs (introduction, installation, skills, screenshots, vision-mode, configuration); the Playwright MCP README; the v0.0.58 and v0.1.18–v0.1.22 release notes.
  - GitHub search `repo:microsoft/playwright-cli 114k OR "114,000" OR "27k" OR "27,000"` returned 0 results, and `repo:microsoft/playwright-cli tokens MCP comparison` returned 0.
  - The official YouTube video's description was read (oEmbed plus the page's `shortDescription`); the video content was not reviewed.
- **Tool versions used in the Slack, Outpost, Checkly and Better Stack measurements.** None is stated in those posts.
- **A built-in way to load lazy or scroll-triggered content before a full-page capture.**
  - GitHub search `repo:microsoft/playwright fullPage lazy load screenshot` (12 results) and `"full page" screenshot IntersectionObserver` (3 results).
  - Only #40933 (closed, not merged), #40941 (duplicate) and #19861 (open) were found.
- **Documentation of Claude Code's own image resizing when the Read tool opens a PNG.** Only the in-session display message was observed. The exact API resize rule sits on the vision-coordinates page, which I did not open. (Verification opened it: the reference implementation there confirms the F13 arithmetic. Claude Code's own 2000 px display cap is still undocumented.)
- **When `--full-page` first reached the CLI.** It is present at the v1.59.0 tag. The earlier history, when the CLI lived in `@playwright/mcp`, was not traced: the commit history of `commands.ts` holds only 58 commits after a path move.
- **A current Claude Code plugin for playwright-cli.** The repository tree has no plugin or marketplace files; the v0.0.58 notes are the only mention.

## Weak spots of this dossier

- All my runs used a static fixture of 11 elements, served by Python, on system Chrome 154 instead of the bundled Chromium 155. Timings (3.4 s open, 3.8 s for 8 shots, 7.5 s for 22 slices) and sizes (268-byte response, 341-byte snapshot, 764-byte style tally) do not generalise to a real hackathon frontend with web fonts, images and client-side data.
- My own numbers are bytes, never tokens. Every token figure comes from third parties with small samples and different tasks, and none measured a design-review loop.
- Not exercised:
  - headed mode, and invocation from cmd.exe or PowerShell
  - Firefox and WebKit
  - `show --annotate`, video recording, tracing
  - `attach --cdp`
  - a real Vite or Next dev server with hot reload
  - `pnpm exec` resolution
  - a global install
- Much of the source was read on the `main` branch of `microsoft/playwright`. Only the items quoted as coming from the published bundle (the Chrome default, `--full-page`, the help texts, install behaviour, `kill-all` patterns) were confirmed against the version that 0.1.22 ships.
- The visual-token figures for resized images are derived from the documented formula with an approximate fitting rule. (Verification re-derived them with the reference implementation on the vision-coordinates page; they match.)
- The mapping from computed-style tallies and the reveal probe to the owner's 20 tells is my proposal, and is not yet calibrated against the owner's past frontends or the human control sites.
- One side effect occurred and was reverted: a Playwright Test run wrote `C:/Users/Utilisateur/test-results`, which held only its `.last-run.json` and was deleted after verification (F16). Nothing else was written outside the scratch folder and this research folder.

## Verification notes

Adversarial fact-check, 2026-09-30. Every cited source was re-opened in this session; nothing was taken from memory.

**Method.**
- Registries: `registry.npmjs.org` JSON for `@playwright/cli`, `playwright`, `playwright-core`, `@playwright/mcp`, `chrome-devtools-mcp` and `pixelmatch` (versions, publication times, dependencies, dist-tags).
- GitHub: `gh api` for repository metadata, releases (playwright-cli v0.1.19 to v0.1.22, playwright-mcp v0.0.55 to v0.0.58 and the release list), issues #40941 and #19861 with their comments, PR #40933, commit histories (`commands.ts`, pixelmatch) and tree listings; `raw.githubusercontent.com` for every quoted source file at `main` and at tags v1.58.0 to v1.63.0 (`program.ts`, `commands.ts`, `browsers.json`, `types.d.ts`), the docs sources (`params.md`, `class-page.md`, `test-snapshots-js.md`, `screenshots.md`, `test-webserver-js.md`, `emulation.md`, `class-testconfig.md`, `getting-started-cli.md`) and the `microsoft/playwright.dev` agent-cli `.mdx` sources.
- Published bundle: the playwright-core 1.64.0-alpha-1790635538000 tarball was unpacked in scratch and grepped for every "published bundle" quote (Chrome default, `findOrInstallDefaultBrowser`, `patchGitIgnore`, `initWorkspace`, viewport defaults, `navigate()`, `kill-all` patterns, `help.json`, `browsers.json`, bundled SKILL.md, identical to the repo copy). The pixelmatch 7.2.0 tarball was unpacked to check its colour metric.
- Web pages: curl plus text extraction for playwright.dev, the Anthropic vision and vision-coordinates pages (`.md` variants), Slack Engineering, Outpost, Checkly and Better Stack; the dev.to API for Aswani Kumar's post (publish and edit dates); Exa for the Medium post; YouTube oEmbed and the watch page's embedded JSON for the video; the Wayback Machine CDX index and two captures for the star history.
- Re-runs: a minimal copy of `@playwright/cli` 0.1.22 with the same alpha `playwright` and `playwright-core` tarballs (19 MB) in the verification scratch folder, `LOCALAPPDATA` redirected to scratch so daemon state stayed there, `NO_UPDATE_NOTIFIER=1`, system Chrome 154, the evidence fixture served on 127.0.0.1:8766. Re-run and matching the dossier: `--version`, `list`, `click e999` exit 1, `click e5` = 268 bytes, `snapshot --boxes`, the snapshot listing the opacity-0 section, `resize 375 812` probes, `set-color-scheme`/`set-reduced-motion`, full-page shots at 375x2185 and 375x2161, `--device="iPhone 15"` with `--hires` 1179x1977, the refused-port exit code and `--json` error, the reveal probe, the 22-slice capture, the 8-shot matrix, the 764-byte style tally, the CDP font probe, and `playwright/cli.js cli --help`. New runs: `--device="iPhone SE (3rd gen)"`, a slow page for the load wait (F17), and the SKILL.md `jq` recipe (F30). Sessions were closed by name (`kill-all` never used), the server was stopped, and the scratch install was deleted afterwards.
- Not re-run: the Playwright Test visual comparison runs behind F14 to F16 (checked against `comparators.ts`, the docs and the evidence files only, to avoid a second write into the home folder), `install --skills` (checked against the bundle code and the evidence log), and the 3.4 s `open` timing.

**Material corrections.** F01 (star history), F02 (the `cli` subcommand is hidden through v1.61.0 and listed from v1.62.0; only page commands map to MCP tools), F08 and contradiction 10 (the agent-cli configuration page does document real device emulation), F15 (the "full accent-colour change" was a hairline border change), F17 (navigation also waits up to 5 s for `load`, then continues silently), F18 (install order; the skill-mismatch check ignores `-g` installs and `NO_UPDATE_NOTIFIER`/`CI` runs), F22 (CLI version range), F23 (the 230 vs 97,000 character figure belongs to a separate test), F28 (grep count), and contradiction 9 (published pixelmatch 7.2.0 still uses YIQ; OKLab is unreleased on main).

**Sources that could not be opened.**
- The official video's spoken content: the auto-generated caption track (`/api/timedtext`) returned HTTP 404, so whether "114k" is said aloud remains unchecked (F24).
- medium.com directly: HTTP 403 to curl and to WebFetch; the post was read through Exa's fetch instead.
- The GitHub stargazers API returned HTTP 404, so the star history in F01 rests on two Wayback Machine captures rather than a full timeline.

**Residual doubts.**
- F24 is an absence claim. It covers the README, SKILL.md, the playwright.dev agent-cli and getting-started pages, the MCP README, the release notes read, a code search of three Microsoft repositories and the video description, not the video's audio or non-indexed Microsoft material.
- F01's "about 92%" is computed from 1,070 (archive, 2026-01-24) against 13,693 (API, 2026-09-30). Archive pages show the count at capture time, not an audited total.
- All timings and byte counts come from one static 11-element fixture on one machine; the re-runs reproduced the counts, but timings varied (the matrix took 2.7 s against 3.8 s).
- F21's source names Sonnet 4.5 as the CLI agent in its setup but Opus 4.6 in its tables. The dossier keeps the table figures.
- F02's command-to-tool count was made on `main` and repeated on the 0.1.22 bundle (`coreBundle.js` of the pinned alpha): the same 88 / 10 / 4 split and the same command names. Only the parsing script, not a Playwright test, supports that count.
