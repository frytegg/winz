# Default stack, components, typography, icons, motion, charts and wallet UI
> Code FD16 · slug stack-components-typography · researched 2026-09-30 · verified 2026-09-30 · counts: verified 19 / corrected 10 / downgraded 0 / dropped 0 / added 2

## Summary

- Default for a 24 to 48 h dApp frontend: a client-only single-page app on Vite 8.3.1 + React 19.3.0 + Tailwind 4.3.3, deployed as static files (Vercel with one SPA rewrite, or `vite preview` offline). Use Next 16.3.8 only when the build needs a server. Its `output: 'export'` rejects Server Actions, cookies, rewrites, redirects, headers, proxy and default image optimisation (F02).
- A build with no React server sidesteps the RSC CVE series: CVE-2025-55182 (CVSS 10.0), then seven follow-ups in `react-server-dom-*`, the latest CVE-2026-44907 on 2026-07-21. React's advisory says "If your app’s React code does not use a server, your app is not affected". It also avoids wagmi's SSR hydration flash (F03). The owner's last build, Orma (Sept 2026), already ran Vite 8.3.0, React 19.3.0, Tailwind 4.3.3 and shadcn 4.21.0 on this machine, per its `pnpm-lock.yaml` (F02). (corrected at verification: the advisory page stops at January 2026, but facebook/react's security advisories list three more RSC CVEs; Orma's lockfile resolves React 19.3.0, and "19.2" was only the declared range)
- The first defaults come from the starters, not from Tailwind. Tailwind 4.3.3's `--font-sans` is a system stack. But create-next-app and the Next font docs import Geist, create-vite ships a `#aa3bff` purple accent, and `shadcn init --defaults` means the Lucide + Geist preset. Of shadcn's 8 presets, 5 use Lucide and 4 use Inter (F04, F08).
- In Tailwind v4, theme variables decide which utilities exist. Resetting a namespace (`--color-*: initial`, and likewise for shadow, blur, radius, animate, ease, font, text) stops `bg-indigo-500`, `backdrop-blur-md` and `animate-pulse` from generating CSS. Arbitrary values (`bg-[#…]`, `backdrop-blur-[12px]`) still pass, so a source grep stays necessary (F05, F06).
- shadcn in 2026 offers three bases (Base UI, the default since 2026-07-02; Radix; React Aria), 8 styles and presets. The components.json docs say `style`, `baseColor` and `cssVariables` "cannot be changed after initialization", but since 2026-04-08 `shadcn apply --preset` re-runs init, reinstalls every component and writes a new style and base colour, keeping only the base and RTL. So these choices can change later, but only through a full reinstall that overwrites hand edits. A partial `--only theme` or `--only font` apply keeps the components. The CLI inlines the style's classes into files the project owns, so the levers are the tokens and those files. Nova's default button hover is `hover:bg-primary/80` (F07 to F09). (corrected at verification: "frozen at init" is contradicted by the CLI's own `apply` command)
- Font licences: Google Fonts are mostly OFL, which allows self-hosting, bundling and redistribution. Subsetting an OFL webfont counts as modification: it is allowed, but a subset normally may not keep a Reserved Font Name, and IBM Plex reserves "Plex" (F30). Fontshare's ITF FFL 2.0 allows free commercial use and self-hosting on your own servers. Its §02 forbids subsetting and format conversion, and forbids making the files available through a "repository", "publicly accessible servers" or a third-party "platform" or "design tool". Keep FFL files out of any public repo and off third-party canvases (F11, F12).
- Overexposure can be measured. Inter is on about 1.4 to 1.5% of all pages (Web Almanac 2025, up from about 1% in 2024). It has `popularity` value 5 in the Google Fonts catalogue of 1,950 families, which puts it fourth in the list, after Roboto, Open Sans and Google Sans (corrected at verification: the value is not the ordinal rank). Instrument Serif is "on over 16,000 websites" (WSJ, Nov 2025). `system-ui` is on 9.7% of desktop pages (F13).
- Tell-font lists disagree and keep moving. impeccable flags Fraunces, Instrument Serif and Sans, Geist, Space Grotesk and Plus Jakarta Sans, and its skill also lists IBM Plex and Newsreader. Claude Design adds Fraunces. A small 2026 measurement found AI output converging on a serif display face over a warm ground, not on Inter. A list hit should require a reason drawn from the research, and should not decide on its own (F14).
- Figures: in the Google Fonts builds I inspected, DM Sans, Fraunces and Instrument Serif have no `tnum` feature and proportional default digits, so `font-variant-numeric: tabular-nums` does nothing. Inter, Geist, Space Grotesk, Manrope, Public Sans and Plus Jakarta Sans have `tnum`. IBM Plex Sans, Hanken Grotesk and JetBrains Mono have tabular digits by default (F16).
- Butterick: "Most documents can tolerate a second font. Few can tolerate a third." Mix fonts that are "identifiably different" and give each "a consistent role". System fonts are "overexposed", yet "For screen display, like presentations and websites, the A and B lists are fine" (F15, F17).
- Icons: NN/g says "a text label must be present alongside an icon". Lucide and Tabler share the same drawing rules (24 px grid, 2 px stroke, round caps), so swapping one for the other keeps the look (F19, F20).
- Motion: CSS first. `@starting-style` and view transitions are Baseline "newly available", and scroll-driven animations are not Baseline. `motion` 13.4.6 wraps framer-motion 13.4.6, and `m` + LazyMotion costs about 4.6 kB against 34 kB for the full component. Exit animations fit in `domAnimation` (+15 kB), while layout and drag need `domMax` (+25 kB) (F21).
- Charts: lightweight-charts 5.2.1 is Apache-2.0 with a NOTICE plus a link requirement, which the default `attributionLogo: true` satisfies. Recharts' docs use `#8884d8` in 18 example files. A default shadcn CLI install writes greyscale `--chart-1..5` (`oklch(0.87 0 0)` to `oklch(0.269 0 0)`), and every base colour's dark `--sidebar-primary` is the indigo `oklch(0.488 0.243 264.376)`. shadcn's theming and chart docs still tell you to paste an older palette whose dark `--chart-1` is that indigo and whose dark `--chart-4` is a purple (F22, F23). (corrected at verification: the indigo `--chart-1` comes from the docs, not from what the CLI installs)
- Wallets: RainbowKit 2.2.11 still peers `wagmi ^2.9.0`, while wagmi's latest is 3.7.7. ConnectKit 1.9.2 peers React 17/18 only: npm refuses the install, and pnpm installs with a warning because `strictPeerDependencies` defaults to false. Whether it runs on React 19 is untested. Reown AppKit exposes 7 theme variables, and its licence requires a Reown notice, "applicable logo and branding" and use of the Reown network. Plain wagmi hooks give full visual control (F24 to F26).
- Colour: OKLCH has been Baseline widely available since 2025-11-09. Gate on WCAG 2.2 ratios: 4.5:1 for text, 3:1 for large text and UI boundaries. The WCAG 3 draft of 10 Sept 2026 says its contrast algorithm "is yet to be determined", while Radix and Harmonizer default to APCA (F27, F29).
- axe-core, harden's accessibility floor, has no WCAG 1.4.11 rule and skips text over background images or gradients. It files those under incomplete ("needs review"), not violations, so a violations-only gate never sees them. By my computation, shadcn's default input borders measure 1.47:1 (dark) and 1.26:1 (light), and white on Tailwind v4 `blue-500` measures 3.76:1. /frontend must put contrast into the tokens (F28).

## Default stack and de-defaulting checklist (derived from the findings below)

Versions are npm `latest` on 2026-09-30 (F01). Pin exact versions in the scaffold and re-query on the day, because `next` 16.3.8 was published the same afternoon.

| Layer | Default choice | Pinned version | Why (finding) |
|---|---|---|---|
| Build | `vite`, `@vitejs/plugin-react` | 8.3.1, 6.1.1 | Static SPA, no React server (F02, F03) |
| Runtime | `react`, `react-dom` | 19.3.0 | Current. RainbowKit, Privy and Dynamic accept React 19 in their peer ranges; ConnectKit does not; `@reown/appkit` declares no React peer (F24) |
| Styling | `tailwindcss`, `@tailwindcss/vite` | 4.3.3 | Namespace resets remove defaults (F05, F06) |
| Components | `shadcn` CLI as a code generator, `init -t vite -b base -p <own preset>` | 4.21.0 | Owned files, choose base, style and fonts explicitly (F07 to F09) |
| Primitives | `@base-ui/react` (alt: `react-aria-components`) | 1.8.0 (alt 1.21.1) | Unstyled, accessible (F10) |
| Motion | CSS transitions and `@starting-style`; `motion` only for exit, layout and gesture work | 13.4.6 | F21 |
| Icons | none by default; if needed, one deliberate set such as `@phosphor-icons/react` or custom glyphs | 2.1.10 | F19, F20 |
| Charts | `lightweight-charts` for time series (with attribution); `recharts` via shadcn chart; `@visx/*` for bespoke | 5.2.1, 3.10.1, 4.0.0 | F22, F23 |
| Wallet | `wagmi` + `viem` + `@tanstack/react-query` with an own connect dialog | 3.7.7, 2.57.1, 5.104.0 | F24, F25 |
| Wallet (prebuilt modal) | `@rainbow-me/rainbowkit` with `wagmi` pinned to 2.x and a full custom `Theme` | 2.2.11 + wagmi 2.19.5 | F24, F25 |
| Fonts | OFL faces self-hosted via `@fontsource(-variable)/<family>` or local woff2 | 5.3.0 | F11, F17 |
| Palette | `@adobe/leonardo-contrast-colors` (contrast-first generation) | 1.1.0 | F29 |
| Alternative framework | `next` with `output: 'export'` when routing or metadata matter and no server is needed | 16.3.8 | F02 |

Checklist. Every line can be tested mechanically:

1. **Tailwind namespaces.** In `@theme`, reset `--color-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--blur-*`, `--radius-*`, `--animate-*`, `--ease-*`, `--font-*`, `--text-*`, `--tracking-*` and `--leading-*` to `initial`, then define the project tokens. Test: the built CSS contains no `--color-indigo-*`, `--color-violet-*` or `--color-purple-*`. The source contains no arbitrary colour, gradient or blur values outside the token file (F05, F06).
2. **Starter residue.** No Geist import, no `#aa3bff`, no "Create Next App" metadata, no Vite demo CSS. Start from `app-tw-empty` or delete the Vite demo files (F04).
3. **shadcn tokens differ from the registry defaults.** At minimum: `--radius` ≠ `0.625rem`, `--primary` ≠ `oklch(0.205 0 0)`, and the dark `--sidebar-primary` ≠ `oklch(0.488 0.243 264.376)`. `--chart-1..5` match neither the CLI's greyscale defaults (`oklch(0.87 0 0)`, `0.556`, `0.439`, `0.371`, `0.269`) nor the docs palette (light `oklch(0.646 0.222 41.116)`…, dark `oklch(0.488 0.243 264.376)`…). The primary hover is an explicit token, not `hover:bg-primary/80` or `/90`. `iconLibrary`, `font` and `fontHeading` are set deliberately, and `--defaults` is never used (F08, F09, F23). (corrected at verification: the CLI installs greyscale chart tokens; the indigo `--chart-1` comes only from the docs)
4. **Fonts.** At most two families, plus a monospace face only with a reason. Each has a licence file (OFL or Apache), or is an FFL font not committed to a public repo. Self-hosted. An FFL face is never subset or converted. An OFL face whose `OFL.txt` declares a Reserved Font Name is shipped whole, or renamed if subset (F30). The face used for numbers has `tnum` or tabular default digits, verified with fontTools. A hit on the combined reflex list needs a written reason in DESIGN.md (F11 to F17, F30).
5. **Type scale.** Explicit `--text-*` steps, fluid with `clamp()`. Count the distinct computed font sizes on key screens: more than about 10 is a flag, and that threshold rests on weak evidence (F18).
6. **Icons.** Every icon has a visible label, or an `aria-label` when it stands alone on a control. One set and one weight. No icon-in-a-box feature rows (F19, F20).
7. **Motion.** Duration and easing tokens replace Tailwind's 150 ms and `cubic-bezier(0.4, 0, 0.2, 1)`. `prefers-reduced-motion` is honoured, with `MotionConfig reducedMotion="user"` when motion is used. No scroll reveals. No `animate-pulse` or `animate-bounce` (F21).
8. **Charts.** Series colours come from brand tokens: no `#8884d8` or `#82ca9d`, and no untouched shadcn chart tokens. Axis and tooltip fonts are set, with tabular figures. lightweight-charts attribution is present (F22, F23).
9. **Wallet UI.** Either an own dialog on wagmi hooks, or a kit themed on every token: fonts, radii, shadows, overlay blur and colours. If AppKit is used, the Reown notice and licence copy ship with it (F24 to F26).
10. **Colour.** OKLCH tokens generated from the brand hue with a contrast-first tool. Text pairs are at least 4.5:1. Large text, input borders, focus rings and chart strokes are at least 3:1 against what sits next to them, checked by /frontend because axe does not check them. No text on a gradient or image without a solid plate. Secondary text in dark mode is at least 4.5:1, with 7:1 as the aim for small text (F27 to F29).

## Findings

### FD16-F01 — Pinned versions on the npm registry, 2026-09-30
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (all 28 rows, covering 32 packages, re-queried from `registry.npmjs.org` at verification: every version, date, licence and peer range matches; `motion` and `framer-motion` 13.4.6 were published 69 seconds apart; `next` canary is 16.4.0-canary.53)
- **Claim:** The `latest` dist-tags, publication times, licences and relevant peer ranges on 2026-09-30 are:

  | Package | latest | published (UTC) | licence | peer notes |
  |---|---|---|---|---|
  | next | 16.3.8 | 2026-09-30 16:07 | MIT | canary 16.4.0-canary.53 |
  | vite | 8.3.1 | 2026-09-24 | MIT | |
  | @vitejs/plugin-react | 6.1.1 | 2026-08-28 | MIT | |
  | react, react-dom | 19.3.0 | 2026-09-09 | MIT | |
  | tailwindcss, @tailwindcss/vite, @tailwindcss/postcss | 4.3.3 | 2026-07-16 | MIT | |
  | shadcn | 4.21.0 | 2026-09-04 | MIT | |
  | radix-ui | 1.6.7 | 2026-07-24 | MIT | |
  | @base-ui/react | 1.8.0 | 2026-09-04 | MIT | |
  | react-aria-components | 1.21.1 | 2026-09-04 | Apache-2.0 | |
  | motion, framer-motion | 13.4.6 | 2026-09-29 | MIT | published a minute apart |
  | recharts | 3.10.1 | 2026-07-25 | MIT | react ^16.8 to ^19 |
  | echarts | 6.1.0 | 2026-05-19 | Apache-2.0 | |
  | @visx/xychart | 4.0.0 | 2026-06-11 | MIT | react ^18 or ^19 |
  | lightweight-charts | 5.2.1 | 2026-08-12 | Apache-2.0 | |
  | @observablehq/plot | 0.6.17 | 2025-02-14 | ISC | |
  | wagmi | 3.7.7 | 2026-08-27 | MIT | |
  | viem | 2.57.1 | 2026-09-29 | MIT | |
  | @tanstack/react-query | 5.104.0 | 2026-09-26 | MIT | |
  | @rainbow-me/rainbowkit | 2.2.11 | 2026-05-06 | MIT | wagmi ^2.9.0 |
  | connectkit | 1.9.2 | 2026-03-24 | "BSD-2-Clause license" (field text) | react 17.x or 18.x |
  | @reown/appkit | 1.8.24 | 2026-09-16 | "SEE LICENSE IN LICENSE.md" | |
  | @privy-io/react-auth | 3.46.0 | 2026-09-28 | Apache-2.0 | react ^18 or ^19 |
  | @dynamic-labs/sdk-react-core | 5.9.2 | 2026-09-28 | MIT | react >=18 <20 |
  | lucide-react | 1.49.0 | 2026-09-29 | ISC | |
  | @phosphor-icons/react | 2.1.10 | 2025-05-22 | MIT | |
  | @tabler/icons-react | 3.48.0 | 2026-09-22 | MIT | |
  | @radix-ui/react-icons | 1.3.2 | 2024-11-14 | MIT | |
  | @heroicons/react | 2.2.0 | 2024-11-18 | MIT | |

- **Implication for /frontend:**
  - The scaffold step writes exact versions, not `^` ranges, and re-queries the registry on the day. `next` changed during this research session.
  - Several icon and chart packages have not shipped in 10 or more months. They are usable, but they will not receive fixes during an event.
- **Evidence:**
  - [npm registry metadata](https://registry.npmjs.org/) — npm, Inc., queried 2026-09-30, accessed 2026-09-30 — registry API. Each package was read from `https://registry.npmjs.org/<name>`.
    - Command: `curl -s "https://registry.npmjs.org/<name>" | python -c "... dist-tags.latest, time[latest], versions[latest].license, peerDependencies ..."`
    - Output excerpts: `next: latest= 16.3.8 published= 2026-09-30T16:07:21.198Z` · `vite: latest= 8.3.1 published= 2026-09-24T12:26:19.940Z` · `@rainbow-me/rainbowkit: latest= 2.2.11 ... peer= {'viem': '2.x', 'react': '>=18', 'wagmi': '^2.9.0', ...}` · `connectkit: latest= 1.9.2 ... peer= {'viem': '2.x', 'react': '17.x || 18.x', 'wagmi': '2.x', ...}`
- **Limits / false positives:** This is a snapshot. `latest` is what the registry serves; it is not a statement of stability for a given project.

### FD16-F02 — For a dApp demo, a Vite SPA is the smaller surface; Next 16's static export forbids the server features
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (all quotes re-read on raw source: `vercel/next.js` canary `docs/01-app/02-guides/static-exports.mdx`, `vitejs/vite` `docs/config/shared-options.md` and `docs/blog/announcing-vite8.md`, the Vercel page, "Last updated August 26, 2026", and the Next 16 post of Tuesday 21 October 2025. Verification note: Orma's `app/pnpm-lock.yaml` resolves `vite` 8.3.0, `react` 19.3.0, `tailwindcss` 4.3.3 and `shadcn` 4.21.0, and `app/dist/` exists, so the stack did build here. Orma used `radix-ui` with the `radix-nova` style and `iconLibrary: "lucide"` (`app/components.json`), not Base UI. This machine runs Node v24.13.0.)
- **Claim:**
  - Next.js supports a static export (`output: 'export'` produces an `out` folder). It lists as unsupported everything that needs a server: dynamic routes without `generateStaticParams()`, Route Handlers that rely on Request, cookies, rewrites, redirects, headers, proxy, ISR, image optimisation with the default loader, Draft Mode, Server Actions and intercepting routes.
  - Vite's default `appType` is `'spa'`, which uses an SPA fallback in dev and in `vite preview`.
  - Vercel deploys Vite projects, but SPA deep links need one rewrite in `vercel.json`.
  - Vite 8 requires Node 20.19+ or 22.12+; this machine runs Node 24.13.
  - Both vendors claim large speed-ups, each measured against its own previous bundler: Turbopack against webpack, Rolldown against Rollup. I found no head-to-head comparison.
  - The owner's Orma build (Sept 2026) used Vite ^8.3.0, React ^19.2.8, Tailwind ^4.3.3, `@vitejs/plugin-react` ^6.1.1 and shadcn ^4.21.0. This combination is already proven on this machine.
- **Implication for /frontend:**
  - Default to a Vite SPA.
  - Choose Next only when the spec needs server code, such as an API proxy that holds a key or server rendering for SEO. Then harden's server/client lens applies in full.
  - If Next is used without a server, set `output: 'export'` and treat the unsupported list as a build gate.
  - Offline demo: `vite build && vite preview` (SPA fallback), or serve `out/` with `try_files`.
- **Evidence:**
  - [How to create a static export of your Next.js application](https://nextjs.org/docs/app/guides/static-exports) — Vercel, docs version 16.3.8, lastUpdated 2026-08-25, accessed 2026-09-30 — official docs.
    - "After running `next build`, Next.js will create an `out` folder with the HTML/CSS/JS assets for your application."
    - "Features that require a Node.js server, or dynamic logic that cannot be computed during the build process, are **not** supported:" followed by "Cookies", "Rewrites", "Redirects", "Headers", "Proxy", "Image Optimization with the default `loader`", "Server Actions".
  - [Vite shared options: appType](https://vite.dev/config/shared-options.html) — Vite team, accessed 2026-09-30 — official docs.
    - "`'spa'`: include HTML middlewares and use SPA fallback. Configure sirv with `single: true` in preview"
  - [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) — Vercel, last_updated 2026-08-26, accessed 2026-09-30 — official docs.
    - "If your Vite app is configured to deploy as a Single Page Application (SPA), deep linking won't work out of the box."
  - [Vite 8.0 is out!](https://vite.dev/blog/announcing-vite8) (source: `vitejs/vite/docs/blog/announcing-vite8.md`) — Vite team, 2026-03-12, accessed 2026-09-30 — release post.
    - "Vite 8 ships with Rolldown as its single, unified, Rust-based bundler, delivering up to 10-30x faster builds while maintaining full plugin compatibility."
    - "Vite 8 requires Node.js 20.19+, 22.12+, the same requirements as Vite 7."
  - [Next.js 16](https://nextjs.org/blog/next-16) — Vercel, 2025-10-21, accessed 2026-09-30 — release post.
    - "2–5× faster production builds" · "Up to 10× faster Fast Refresh" · "Minimum version now 20.9.0 (LTS)"
  - Local file `C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/app/package.json` — owner's Orma build, read 2026-09-30 — OBSERVED.
    - `"@tailwindcss/vite": "^4.3.3"`, `"react": "^19.2.8"`, `"shadcn": "^4.21.0"`, `"vite": "^8.3.0"`
- **Limits / false positives:** Next brings file-based routing, the Metadata API and OG images at no extra cost. A multi-page marketing site with SEO needs may justify it. The speed claims are vendor numbers.

### FD16-F03 — Server-side React adds a CVE series and wagmi hydration work that a client-only build avoids
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - React disclosed CVE-2025-55182 (CVSS 10.0) in `react-server-dom-*` on 2025-12-03. Seven more advisories on the same packages followed: CVE-2025-55183 (source exposure, 5.3), then denial-of-service CVE-2025-55184, CVE-2025-67779, CVE-2026-23864 (2026-01-26), CVE-2026-23869 (2026-04-08), CVE-2026-23870 (2026-05-06) and CVE-2026-44907 (2026-07-21, "Denial of Service in Server Functions"), each rated 7.5. The advisory states that apps without a React server are not affected. (corrected: the dossier stopped at 2026-01-26 because the react.dev advisory's last update is dated 26 January 2026; facebook/react's GitHub security advisories list three later CVEs)
  - wagmi warns that SSR frameworks produce hydration mismatches unless `ssr: true` is set. With `ssr: true`, the UI shows "empty" connection data until the client store hydrates. Its cookie persistence depends on server cookies, which Next's static export does not support (F02).
- **Implication for /frontend:**
  - A SPA keeps wallet state client-only, which removes the "disconnected, then reconnecting" flash that shows in a recorded demo.
  - A SPA also shrinks the surface harden has to audit for Server Functions and RSC.
  - If Next is used, set `ssr: true` and render wallet state after mount.
- **Evidence:**
  - [Critical Security Vulnerability in React Server Components](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components) (source: `reactjs/react.dev/src/content/blog/2025/12/03/...md`) — React team, 2025-12-03 with later updates, accessed 2026-09-30 — official advisory.
    - "This vulnerability was disclosed as CVE-2025-55182 and is rated CVSS 10.0."
    - "If your app’s React code does not use a server, your app is not affected by this vulnerability."
    - "Denial of Service - High Severity: January 26, 2026 CVE-2026-23864 (CVSS 7.5)"
  - [facebook/react security advisories](https://github.com/facebook/react/security/advisories) — Meta / React team, read via `gh api repos/facebook/react/security-advisories`, accessed 2026-09-30 — primary advisory list (added at verification).
    - `GHSA-479c-33wc-g2pg CVE-2026-23869 2026-04-08 high` · `GHSA-rv78-f8rc-xrxh CVE-2026-23870 2026-05-06 high` · `GHSA-wx67-qw84-cm4g CVE-2026-44907 2026-07-21 high "Denial of Service in Server Functions"`. All three have CVSS 7.5 and affect `react-server-dom-webpack`, `-parcel` and `-turbopack`.
  - [wagmi SSR guide](https://github.com/wevm/wagmi/blob/main/site/react/guides/ssr.md) — wevm, main branch, accessed 2026-09-30 — official docs source.
    - "frameworks which incorporate SSR (such as Next.js) will throw hydration warnings on the client when it identifies mismatches between the server-rendered HTML and the client-rendered HTML."
    - "This means that you will still see a flash of \"empty\" data on the client (e.g. a `\"disconnected\"` account instead of a `\"reconnecting\"` account, or an empty address instead of the last connected address) until after the first mount, when the store hydrates."
- **Limits / false positives:** A Next static export also runs no React server at runtime. The CVE concern applies to deployed RSC servers.

### FD16-F04 — The starters, not Tailwind, bring the first defaults: Geist in Next.js, a purple accent in create-vite
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (template files, the fonts doc, "Last updated May 27, 2026", `theme.css` 4.3.3 and Orma's DESIGN.md line 231 re-read. create-vite's dark mode swaps the accent to `#c084fc`, also purple)
- **Claim:**
  - create-next-app's Tailwind template imports Geist and Geist Mono. The Next font docs use Geist in their examples.
  - create-vite's React TS template ships a CSS file with `--accent: #aa3bff`, a purple, and a `system-ui` stack.
  - Tailwind 4.3.3's own `--font-sans` is a system stack, not Inter.
  - In the owner's Orma build, `@fontsource-variable/geist` arrived with the shadcn init and was removed the same day.
  - create-next-app also offers empty templates (`app-empty`, `app-tw-empty`).
- **Implication for /frontend:** Start from the empty template, or delete the Vite demo CSS. Then run a starter-residue grep for `Geist`, `#aa3bff`, "Create Next App" and "Vite + React". The history of create-next-app's fonts is in FD10-F06.
- **Evidence:**
  - [create-next-app template app-tw/ts/app/layout.tsx](https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/app-tw/ts/app/layout.tsx) — Vercel, canary branch, accessed 2026-09-30 — source.
    - `import { Geist, Geist_Mono } from "next/font/google";` · `title: "Create Next App",`
  - [create-vite template-react-ts/src/index.css](https://github.com/vitejs/vite/blob/main/packages/create-vite/template-react-ts/src/index.css) — Vite team, main, accessed 2026-09-30 — source.
    - `--accent: #aa3bff;` · `--sans: system-ui, 'Segoe UI', Roboto, sans-serif;`
  - [Next.js Font Optimization](https://nextjs.org/docs/app/getting-started/fonts) — Vercel, docs 16.3.8, lastUpdated 2026-05-27, accessed 2026-09-30.
    - `import { Geist } from 'next/font/google'`
  - [tailwindcss@4.3.3/theme.css](https://unpkg.com/tailwindcss@4.3.3/theme.css) — Tailwind Labs, 4.3.3, accessed 2026-09-30 — package file.
    - `--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif, ...`
  - Local file `C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/DESIGN.md` — owner's Orma design log, read 2026-09-30.
    - "`@fontsource-variable/geist` est arrivé avec l'init — **désinstallé le jour même**." (It arrived with the init and was uninstalled the same day.)
- **Limits / false positives:** Geist on a Vercel-owned domain is a brand font, not a tell.

### FD16-F05 — Tailwind v4 theme variables decide which utilities exist; resetting a namespace deletes its default utilities, arbitrary values still pass
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Setting a theme namespace to `initial` removes every default utility in it. For example, `--color-*: initial` removes `bg-red-500`. Setting `--*: initial` removes all of them.
  - Backdrop blur utilities read `--blur-*`, so resetting that namespace removes `backdrop-blur-md`.
  - Arbitrary values in square brackets generate classes on the fly, whatever the theme contains.
- **Implication for /frontend:**
  - The token file resets the colour, shadow, blur, radius, animate, ease, font and type namespaces, then defines the project's values.
  - Tells #1 (purple-to-blue gradient) and #6 (glassmorphism) then cannot be built from default utilities.
  - The checker still greps for arbitrary values: `-[#`, `-[oklch(`, `-[rgb(`, `bg-[linear-gradient`, `backdrop-blur-[`. It also greps the v4 custom-property shorthand `-(--`, for example `backdrop-blur-(--x)` or `bg-(--x)`, which the same docs list as generating CSS whatever the theme contains. (corrected: the parenthesis form was missing from the grep list)
  - It also greps for class names from a deleted namespace, such as `from-purple-500`. These silently generate nothing, and their presence shows a default reflex.
- **Evidence:**
  - [Theme variables](https://tailwindcss.com/docs/theme) (source: `tailwindlabs/tailwindcss.com/src/docs/theme.mdx`) — Tailwind Labs, accessed 2026-09-30 — official docs.
    - "Theme variables are special CSS variables defined using the `@theme` directive that influence which utility classes exist in your project."
    - "When you do this, all of the default utilities that use that namespace _(like `bg-red-500`)_ will be removed, and only your custom values _(like `bg-midnight`)_ will be available."
    - "To completely disable the default theme and use only custom values, set the global theme variable namespace to `initial`"
  - [backdrop-filter: blur()](https://tailwindcss.com/docs/backdrop-filter-blur) — Tailwind Labs, accessed 2026-09-30 — official docs.
    - `backdrop-blur-md` → `backdrop-filter: blur(var(--blur-md)); /* 12px */`
    - `backdrop-blur-(<custom-property>)` → `backdrop-filter: blur(var(<custom-property>));` · `backdrop-blur-[<value>]` → `backdrop-filter: blur(<value>);` (source `src/docs/backdrop-filter-blur.mdx`, re-read at verification)
  - [Adding custom styles](https://tailwindcss.com/docs/adding-custom-styles) — Tailwind Labs, accessed 2026-09-30 — official docs.
    - "use Tailwind's square bracket notation to generate a class on the fly with any arbitrary value"
- **Limits / false positives:**
  - `--*: initial` also removes `--spacing` and the breakpoints, which then have to be redefined.
  - Inline `style` attributes and plain CSS bypass the theme entirely.

### FD16-F06 — Tailwind 4.3.3's default token inventory, the list /frontend must replace
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** `theme.css` in tailwindcss 4.3.3 declares:
  - 288 `--color-*` variables, including the indigo, violet and purple scales (`--color-indigo-500: oklch(58.5% 0.233 277.117)`).
  - A 13-step type scale from `--text-xs: 0.75rem` to `--text-9xl: 8rem`.
  - Radii from `--radius-xs: 0.125rem` to `--radius-4xl: 2rem`.
  - Black-alpha shadows. `--shadow-sm` to `--shadow-xl` use `rgb(0 0 0 / 0.1)`, `2xs` and `xs` use 0.05, `2xl` uses 0.25, the inset shadows 0.05 and the drop shadows 0.05 to 0.15. This matches the "same soft grey shadow" named in FD10-F08. (corrected: not every shadow uses 0.1)
  - Blurs from 4 px to 64 px.
  - `--animate-spin`, `--animate-ping`, `--animate-pulse` and `--animate-bounce`.
  - `--default-transition-duration: 150ms` with `cubic-bezier(0.4, 0, 0.2, 1)`.
  - A system `--font-sans` stack.
  - Preflight sets `line-height: 1.5` on `html`.
- **Implication for /frontend:** Each item is a checklist line. After the reset, any use of a default name is either dead code or proof that the reset was skipped.
- **Evidence:**
  - [tailwindcss@4.3.3/theme.css](https://unpkg.com/tailwindcss@4.3.3/theme.css) and [preflight.css](https://unpkg.com/tailwindcss@4.3.3/preflight.css) — Tailwind Labs, 4.3.3, accessed 2026-09-30 — package files (I grepped them locally).
    - `--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);`
    - `--animate-pulse: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;`
    - `--default-transition-duration: 150ms;`
    - `grep -c "^\s*--color-" theme.css` → `288`
- **Limits / false positives:** These defaults are reasonable in themselves. The tell is shipping them unexamined, not using them.

### FD16-F07 — shadcn/ui in 2026: three bases, eight styles, presets; three choices change only by a full reinstall
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Base UI has been the default base since 2026-07-02. Radix remains available (`-b radix`), and React Aria has been a first-class base since 2026-07-17.
  - There are eight styles: Vega, Nova, Maia, Lyra, Mira, Luma, Rhea and Sera.
  - The components.json docs say `style`, `tailwind.baseColor` and `tailwind.cssVariables` "cannot be changed after initialization". The CLI contradicts this. Since 2026-04-08, `shadcn apply --preset` re-runs init with the new preset (`runInit` with `reinstall` and `cssVariables: true`), reinstalls every existing component, and patches `style`, `tailwind.baseColor` and `tailwind.cssVariables` in components.json. It keeps only the current base and RTL. So these choices are not frozen, but a full apply reinstalls every component and overwrites hand edits. A partial apply, `--only theme` or `--only font` (changelog 2026-04-22), keeps them: "Keep your components. Apply only what you want." (corrected: the dossier took the components.json docs at their word)
  - The CLI has templates for next, start, vite, react-router, laravel and astro.
  - Sera is "Minimal. Editorial. Typographic. Underline Controls and Uppercase Headings." Its buttons use `rounded-none ... uppercase tracking-widest`, close to the "broadsheet" cluster named in FD15 and FD10-F04.
- **Implication for /frontend:** Decide the base, style and base colour from the design direction before `shadcn init`, and pass them explicitly (`-t vite -b base -p ...`; `-p, --preset [name]` exists in init.ts). Never run `--defaults`. Treat the eight styles as eight recognisable looks, not as distinct designs. A late change of style goes through `shadcn apply`, which reinstalls every component, so hand edits must be committed and diffed first (F09).
- **Evidence:**
  - [July 2026 - Base UI as the Default](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx) — shadcn, 2026-07-02, accessed 2026-09-30 — project changelog.
    - "Starting today, **Base UI is the default component library in shadcn/ui**." · "npx shadcn init -b radix"
  - [July 2026 - React Aria](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-react-aria.mdx) — shadcn, 2026-07-17, accessed 2026-09-30.
    - "**All eight styles** - Use React Aria with Vega, Nova, Maia, Lyra, Mira, Luma, Rhea, or Sera."
  - [components.json docs](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/(root)/components-json.mdx) — shadcn, accessed 2026-09-30.
    - "The style for your components. **This cannot be changed after initialization.**"
  - [packages/shadcn/src/commands/apply.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/commands/apply.ts) and [April 2026 - shadcn apply](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-04-shadcn-apply.mdx) — shadcn, main, accessed 2026-09-30 — source and changelog (added at verification).
    - "We added `shadcn apply` so you can switch presets in an existing project without starting over." · "The CLI keeps the current base and RTL settings from your existing project, even when the preset URL was generated with different values."
    - [April 2026 - Partial Preset Apply](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-04-partial-preset-apply.mdx) (2026-04-22): "Keep your components. Apply only what you want." · "Partial preset apply currently supports `theme` and `font`."
    - `const patch = { style: config.style, tailwind: { baseColor: config.tailwind.baseColor, cssVariables: config.tailwind.cssVariables, }, ...` (in `syncApplyWorkspaceConfigs`) · `return await runInit({ ... reinstall: shouldReinstallComponents, ... cssVariables: true, ...`
  - [April 2026 - Introducing Sera](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-04-sera.mdx) — shadcn, 2026-04-16, accessed 2026-09-30.
    - "Minimal. Editorial. Typographic. Underline Controls and Uppercase Headings."
  - [packages/shadcn/src/commands/init.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/commands/init.ts) — shadcn, main, accessed 2026-09-30 — source.
    - `"the template to use. (next, start, vite, react-router, laravel, astro)"` · `"the component library to use. (base, radix, aria)"`
  - [apps/v4/registry/styles/style-sera.css](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/styles/style-sera.css) — shadcn, main, accessed 2026-09-30.
    - `.cn-button { @apply ... rounded-none border border-transparent bg-clip-padding text-xs font-semibold uppercase tracking-widest ...`
- **Limits / false positives:** Radix is still supported and is not being deprecated. An existing Radix project gains nothing from switching during a hackathon.

### FD16-F08 — shadcn's own presets put tells #4, #10 and #19 on the menu
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (`defaults.ts`, `preset.ts` and `init.ts` re-read on `main`: 8 presets, Lucide 5 of 8, Inter 4 of 8, 26 fonts, 5 icon libraries, `DEFAULT_PRESET_CONFIG` takes each list's first value. Verification note: every preset sets `chartColor: "neutral"`, except sera, which sets `taupe` (see F23). Orma's own `components.json` shows `"style": "radix-nova"` and `"iconLibrary": "lucide"`)
- **Claim:**
  - The eight built-in presets pair icons with fonts as follows: nova Lucide/Geist, vega Lucide/Inter, maia Hugeicons/Figtree, lyra Phosphor/JetBrains Mono, mira Hugeicons/Inter, luma Lucide/Inter, sera Lucide/"Noto Sans + Playfair Display", rhea Lucide/Inter. That is Lucide in 5 of 8 and Inter in 4 of 8.
  - `--defaults` means `--template=next --preset=base-nova`.
  - `DEFAULT_PRESET_CONFIG` takes the first value of every option list: style `nova`, font `inter`, iconLibrary `lucide`.
  - The 26-entry font menu includes `space-grotesk`, `instrument-serif`, `instrument-sans`, `dm-sans`, `geist` and `playfair-display`.
  - The icon menu offers lucide, hugeicons, tabler, phosphor and remixicon.
- **Implication for /frontend:** A preset is a menu of today's defaults, not a choice. The /frontend preset sets `font` and `fontHeading` to the researched faces (or `inherit` plus its own `@font-face`) and sets `iconLibrary` deliberately. The default-equality check is described in FD10-F07.
- **Evidence:**
  - [packages/shadcn/src/preset/defaults.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/preset/defaults.ts) — shadcn, main, accessed 2026-09-30 — source.
    - `description: "Lucide / Geist",` (nova) · `description: "Lucide / Inter",` (vega, luma, rhea) · `description: "Lucide / Noto Sans + Playfair Display",` (sera)
  - [packages/shadcn/src/preset/preset.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/preset/preset.ts) — shadcn, main, accessed 2026-09-30.
    - `export const PRESET_FONTS = [ "inter", ... "dm-sans", ... "geist", ... "space-grotesk", ... "instrument-sans", "eb-garamond", "instrument-serif", ] as const`
    - `export const DEFAULT_PRESET_CONFIG: PresetConfig = Object.fromEntries( PRESET_FIELDS_V2.map((f) => [f.key, f.values[0]]) ) as PresetConfig`
  - [init.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/commands/init.ts) — accessed 2026-09-30.
    - `"use default configuration: --template=next --preset=base-nova"`
- **Limits / false positives:** Picking a preset font on purpose, with a reason, is legitimate. Only the unexamined default is the tell.

### FD16-F09 — What changes the shadcn look: tokens, the inlined style classes, and `shadcn apply`
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (`transform-style-map.ts` exports `transformStyleMap` and calls both functions quoted; `style-nova.css` card and button classes, `theming.mdx` radius multipliers and `--radius: 0.625rem`, the apply changelog, and the `--no-css-variables` option in `init.ts` all re-read on `main`)
- **Claim:**
  - At install, the CLI's `transformStyleMap` (ts-morph) replaces the registry's `cn-*` placeholder classes with the chosen style's utilities. The installed files therefore contain concrete classes. In nova, a card is `ring-foreground/10 ... rounded-xl ... ring-1 [--card-spacing:--spacing(4)]` and the default button is `hover:bg-primary/80`.
  - Theming works through semantic tokens under `:root` and `.dark`.
  - The radius scale derives from one `--radius`: `sm` ×0.6, `md` ×0.8, `lg` ×1, `xl` ×1.4, `2xl` ×1.8, `3xl` ×2.2, `4xl` ×2.6. The default is `--radius: 0.625rem`.
  - New tokens are exposed with `@theme inline`.
  - `shadcn apply --preset` reinstalls the existing components and rewrites theme, colours, CSS variables, fonts and icons.
  - `--no-css-variables` is an install-time choice.
- **Implication for /frontend:** Apply the levers in this order:
  1. Tokens in the CSS file: brand colours in OKLCH, one `--radius`, `--chart-1..5`, `--sidebar-*`.
  2. Hand edits to the installed files for hover, active, focus, ring, shadow and density.
  3. Never run `shadcn apply` after hand edits without a diff, because it reinstalls the components.

  An "untouched" check compares token values and key classes with the registry.
- **Evidence:**
  - [packages/shadcn/src/styles/transform-style-map.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/styles/transform-style-map.ts) — shadcn, main, accessed 2026-09-30 — source.
    - `applyToCvaCalls(sourceFile, styleMap, matchedClasses)` · `applyToClassNameAttributes(sourceFile, styleMap, matchedClasses)`
  - [apps/v4/registry/styles/style-nova.css](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/styles/style-nova.css) — shadcn, main, accessed 2026-09-30.
    - `.cn-button-variant-default { @apply bg-primary text-primary-foreground hover:bg-primary/80; }`
  - [Theming](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/(root)/theming.mdx) — shadcn, accessed 2026-09-30 — official docs source.
    - "Override those tokens in your CSS to change the look of your app without rewriting component classes."
    - `--radius-sm: calc(var(--radius) * 0.6);` · `--radius: 0.625rem;`
    - "To add a new token, define it under `:root` and `.dark`, then expose it to Tailwind with `@theme inline`."
  - [April 2026 - shadcn apply](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-04-shadcn-apply.mdx) — shadcn, 2026-04-08, accessed 2026-09-30.
    - "When you run `npx shadcn@latest apply` in an existing project, we apply a new preset, reinstall your existing components, and update your theme, colors, CSS variables, fonts, and icons."
- **Limits / false positives:** Token-only changes leave the geometry of the style intact: rings, radii ratios and spacing. That geometry is why a re-coloured shadcn app still reads as shadcn. See FD10-F08 for the default classes that encode tells.

### FD16-F10 — Unstyled primitives are the alternative; two renamed packages trap agents
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (README line 3, registry dates and the deprecation message re-read. `beta.6`, `beta.7` and `rc.0` of `@base-ui-components/react` all carry "Package was renamed to @base-ui/react")
- **Claim:**
  - `@base-ui/react` 1.8.0 (MIT) calls itself "an unstyled UI component library for building accessible user interfaces". 1.0.0 shipped on 2025-12-11 and 1.6.0 on 2026-06-18.
  - `react-aria-components` 1.21.1 is Apache-2.0, and `radix-ui` 1.6.7 is MIT.
  - The old package `@base-ui-components/react` stopped at 1.0.0-rc.0 and is deprecated: "Package was renamed to @base-ui/react".
  - `motion` 13.4.6 depends on `framer-motion` ^13.4.6. It is the new name for the same code, imported from `motion/react`.
- **Implication for /frontend:**
  - When the whole style layer is to be the project's own, build on the primitives with project CSS instead of editing a shadcn style.
  - The install step pins the new names.
  - The checker flags imports of `@base-ui-components/react` (deprecated) as a stale-name reflex, and `framer-motion` as a naming drift.
- **Evidence:**
  - [mui/base-ui README](https://github.com/mui/base-ui/blob/master/README.md) — MUI / Base UI team, accessed 2026-09-30 — repository file.
    - "From the creators of Radix, Floating UI, and Material UI, Base UI is an unstyled UI component library for building accessible user interfaces."
  - [npm: @base-ui-components/react@1.0.0-rc.0](https://registry.npmjs.org/@base-ui-components%2Freact/1.0.0-rc.0) — npm, accessed 2026-09-30 — registry.
    - `deprecated: Package was renamed to @base-ui/react`
  - [npm: motion@13.4.6](https://registry.npmjs.org/motion/13.4.6) — accessed 2026-09-30.
    - `motion deps: {'tslib': '^2.4.0', 'framer-motion': '^13.4.6'}`
  - [npm: @base-ui/react](https://registry.npmjs.org/@base-ui%2Freact) — accessed 2026-09-30.
    - `1.0.0 2025-12-11T15:56:18.070Z` · `1.6.0 2026-06-18T12:04:15.326Z` · `1.8.0 2026-09-04T08:52:51.986Z`
- **Limits / false positives:** `framer-motion` is not deprecated, and importing it works.

### FD16-F11 — Open-licence font sources and what their licences allow
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (google/fonts README lines 34 and 57 to 59, the OFL official text, the Velvetyne about page, the Collletttivo Apfel Grotezk page, "Licensed under SIL Open Font License", the Fontsource README and `@fontsource/inter` 5.3.0 of 2026-07-19 all re-read. The OFL also says "No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted". The OFL FAQ gap named in the limits below is closed by F30)
- **Claim:**
  - Google Fonts: most families are OFL 1.1, some are Apache 2.0, and the Ubuntu family uses the UFL. All carry permission to redistribute, and the repository points to self-hosting.
  - The OFL lets fonts be bundled, redistributed and sold with software, but not sold by themselves. A modified version may not use a Reserved Font Name. Documents made with the font are exempt from the licence.
  - Velvetyne's fonts are libre, and the foundry asks users to credit the designer and the foundry.
  - Collletttivo publishes a licence per typeface; Apfel Grotezk, for example, is OFL.
  - Fontsource packages Google and other open fonts as npm packages; version 5.3.0 was current on 2026-07-19.
- **Implication for /frontend:**
  - Default sources are the Google Fonts catalogue (self-hosted through Fontsource or `next/font`), Velvetyne, Collletttivo and other OFL foundries.
  - Commit `OFL.txt` next to the font files.
  - Credit Velvetyne designers in the README or footer.
  - Record the licence of every face in DESIGN.md.
- **Evidence:**
  - [google/fonts README](https://github.com/google/fonts/blob/main/README.md) — Google Fonts, main, accessed 2026-09-30 — repository file.
    - "Most of the fonts in the collection use the SIL Open Font License, v1.1." · "Some fonts use the Apache 2 license." · "The Ubuntu fonts use the Ubuntu Font License v1.0."
    - "Since all the fonts available here are licensed with permission to redistribute, subject to the license terms, you can self-host using a variety of third-party projects."
  - [SIL Open Font License 1.1, official text](https://openfontlicense.org/open-font-license-official-text/) — SIL International, accessed 2026-09-30 — licence text.
    - "Original or Modified Versions of the Font Software may be bundled, redistributed and/or sold with any software, provided that each copy contains the above copyright notice and this license."
    - "Neither the Font Software nor any of its individual components, in Original or Modified Versions, may be sold by itself."
    - "The requirement for fonts to remain under this license does not apply to any document created using the Font Software."
  - [Velvetyne — About](https://velvetyne.fr/about/) — Velvetyne Type Foundry, accessed 2026-09-30 — foundry page.
    - "All the fonts hosted on Velvetyne are libre and open-source."
    - "Remember that you must credit the name of the type designer and of our foundry whenever you use one of our fonts."
  - [Collletttivo — Apfel Grotezk](https://www.collletttivo.it/typefaces/apfel-grotezk) — Collletttivo, accessed 2026-09-30 — foundry page.
    - "Licensed under SIL Open Font License"
  - [fontsource/fontsource README](https://github.com/fontsource/fontsource/blob/main/README.md) — Fontsource, accessed 2026-09-30.
    - "An updating monorepo full of self-hostable Open Source fonts bundled into individual NPM packages!"
- **Limits / false positives:**
  - Velvetyne's credit request is the foundry's own condition on top of the OFL text.
  - Whether subsetting a font that has a Reserved Font Name creates a "Modified Version" is covered in the OFL FAQ, which I did not open.

### FD16-F12 — Fontshare's free fonts are not open source: FFL 2.0 forbids sharing the files and modifying them, including subsetting
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - Fontshare's "Closed Source" fonts fall under the ITF Free Font License (FFL), version 2.0 of 17 Aug 2026.
  - They are free for personal and commercial use and may be self-hosted on "your own servers or infrastructure".
  - The licence defines "Derivative Work" to include subsetting and format conversion.
  - The FAQ forbids sharing the files publicly or with third parties, modifying the font software, and converting formats.
  - Fontshare's "Open Source" fonts are OFL instead.
- **Implication for /frontend:**
  - For a hackathon repo that goes public, prefer OFL.
  - If an FFL face is chosen, load it from the Fontshare API or self-host it outside the public repo, and never run a subsetter or format converter on it.
  - Claude Design canvases load Google Fonts or uploaded assets only (FD07). Do not upload FFL files to a Claude Design canvas or any other third-party tool. The grant covers "your own servers or infrastructure". §02 forbids making the files "available to any other person or entity", including through an "application or platform" or "publicly accessible servers". It also forbids making them available to third parties "through any website, application, online service, SaaS platform, design tool". Use an OFL face on the canvas instead. (corrected: the dossier said the licence does not address third-party canvases; its §02 does. This is a plain reading, not legal advice)
- **Evidence:**
  - [Fontshare licenses: ITF Free Font License](https://www.fontshare.com/licenses/itf-ffl) — Indian Type Foundry, FFL "Version 2.0 - 17 Aug 2026", accessed 2026-09-30 via Exa fetch — licence text.
    - "All Fontshare fonts are 100% free for personal and commercial use."
    - "You may self-host the Font Software on your own servers or infrastructure for use on your own websites and applications, including through standard webfont technologies such as CSS @font-face."
    - "“Derivative Work” refers to any modified, adapted, altered or otherwise derived version of the Font Software or the typeface designs embodied therein, including modifications to font files (such as OTF, TTF, WOFF, WOFF2 or variable fonts), glyphs, characters, spacing, kerning, metrics, naming, subsetting, format conversion or other font data."
    - §02 Limitations of Usage (added at verification): "This includes modifying or replacing glyphs, subsetting, format conversion, or altering font names, copyright information, ownership information or other metadata." · "This includes distributing the Font Software through another font website, font library, marketplace, repository, download service, application or platform, or by email, removable media, publicly accessible servers, file-sharing services, peer-to-peer networks or any other means." · "You may not host, serve, embed or otherwise make the Font Software available for use by third parties through any website, application, online service, SaaS platform, design tool, template editor or similar service."
  - [Fontshare FAQ](https://www.fontshare.com/faq) — Indian Type Foundry, page states "Last updated on 11 Dec 2021", accessed 2026-09-30.
    - "Closed Source fonts: You may share Fontshare links to these fonts, but you may not share the original font files publicly or with third parties."
    - "However, you are not allowed to modify the original font software itself." · "You also cannot convert the fonts using any third-party font format converters."
- **Limits / false positives:**
  - The licence text itself (§02) lists "repository" and "publicly accessible servers" among the forbidden means of distribution. So a public GitHub repo holding FFL files contradicts the licence, not just the FAQ (corrected: the dossier called this its own reading of the FAQ). This is still not a legal opinion.
  - The FAQ date predates FFL 2.0.

### FD16-F13 — Overexposure can be measured: Inter, `system-ui` and Instrument Serif
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED (catalogue JSON re-downloaded, 2,710,508 bytes: all 17 popularity values, 1,950 families and the 2 to 2121 range match. Almanac quotes re-read on the source markdown, with dates from the pages' JSON-LD: 2024 published 2024-11-11, 2025 published 2026-01-15 and modified 2026-02-10. WSJ re-read via archive.is: byline Katie Deighton, Nov. 13, 2025, both quotes verbatim. Verification note: the values have gaps. Inter's value 5 is fourth by ordinal, after Roboto 2, Open Sans 3 and Google Sans 4, so "rank 5" in the old summary was imprecise)
- **Claim:**
  - The Google Fonts catalogue metadata has an undocumented `popularity` integer that behaves as a rank: unique values 2 to 2121 across 1,950 families, lower meaning more popular. Values include Roboto 2, Open Sans 3, Inter 5, Montserrat 7, Poppins 8, DM Sans 21, Playfair Display 25, Manrope 31, Outfit 33, Plus Jakarta Sans 39, Figtree 43, JetBrains Mono 45, IBM Plex Sans 52, Space Grotesk 59, Instrument Serif 86, Fraunces 91 and Geist 100.
  - HTTP Archive's Web Almanac put Inter at about 1% of sites in 2024, and wrote that it expected Inter in the top 10. In 2025 Inter was on 1.4 to 1.5% of pages.
  - `system-ui` rose from 3.6% (2022) to 7.2% (2024), then 9.7% of desktop pages (2025).
  - The WSJ reported Instrument Serif "on over 16,000 websites" and quoted a designer calling it "a negative signal".
- **Implication for /frontend:** Exposure data justifies flagging the most-served families as "needs a reason". Geist's Google Fonts rank understates its use, because `next/font` and npm packages serve it outside Google's CDN.
- **Evidence:**
  - [Google Fonts catalogue metadata](https://fonts.google.com/metadata/fonts) — Google, accessed 2026-09-30 — JSON data (2.7 MB), parsed locally.
    - `Inter | popularity 5 | trending 718 | dateAdded 2020-01-24` · `Instrument Serif | popularity 86` · `Geist | popularity 100` · `unique pop values: 1950 of 1950 min 2 max 2121`
  - [Web Almanac 2024, Fonts](https://almanac.httparchive.org/en/2024/fonts) (source: `HTTPArchive/almanac.httparchive.org/src/content/en/2024/fonts.md`) — Bram Stein, Charles Berret, HTTP Archive, 2024-11-11, accessed 2026-09-30 — measured crawl.
    - "The meteoric rise of Inter should also not go unnoticed, as it also stands around 1%. Due to its prominence in frameworks and libraries, we expect Inter to rise into the top 10 within the next few years."
    - "While `system-ui` fonts were only represented on about 3.6% of desktop and mobile websites, it is now at 7.2%, roughly double what was seen in 2022."
  - [Web Almanac 2025, Fonts](https://almanac.httparchive.org/en/2025/fonts) — Charles Berret, HTTP Archive, published 2026-01-15, updated 2026-02-10, accessed 2026-09-30 — measured crawl.
    - "One notable climber is Inter, which is now on roughly 1.4-1.5% of pages."
    - "The `system-ui` value (...) is now used on about 9.7% of pages (desktop) and 9.3% (mobile)."
  - [The Skinny Font Taking Over Tech Companies and the White House](https://archive.is/veZ3N) — Katie Deighton, The Wall Street Journal, 2025-11-13, accessed 2026-09-30 via archive.is — news report.
    - "The main target of their ire is the rapid adoption of Instrument Serif, the two-year-old font that is free to license. It’s on over 16,000 websites."
    - "“It has proliferated to a point where now it’s a negative signal instead of a positive,” said Alessio."
- **Limits / false positives:**
  - Exposure is not proof of AI origin, and brand fonts on their own sites are legitimate.
  - The WSJ gives no method for the 16,000 figure.
  - The meaning of `popularity` is inferred, not documented.

### FD16-F14 — Tell-font lists disagree and chase a moving centroid; a hit should require a reason, not decide
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (`constants.rs` lines 84 to 105 and `new-work.md` line 67 re-read on HEAD; last commit touching `constants.rs` is e2ff625, 2026-09-04; repo Apache-2.0. craft.md re-read with the Artifact tool, quote verbatim; the read did not display a release id, so "1790780428-0f80" is unconfirmed. anthropics/skills 0075614 is dated 2025-12-04, quote verbatim; the current `main` no longer names Space Grotesk or system fonts. Convergence page re-read, both quotes verbatim. See F31 for what the same craft.md prescribes)
- **Claim:**
  - impeccable's detector constant `OVERUSED_FONTS` has two groups. The "older monoculture" is Inter, Roboto, Open Sans, Lato, Montserrat, Arial and Helvetica. The "newer monoculture (the Anthropic-skill / Vercel / GitHub default wave)" is Fraunces, Instrument Sans, Instrument Serif, Geist, Geist Sans, Geist Mono, Mona Sans, Plus Jakarta Sans, Space Grotesk and Recoleta.
  - Its skill text has a longer list of "training-data defaults" that includes IBM Plex and Newsreader. The same text says "system stacks and workhorse UI faces" serve Operate and Read surfaces well.
  - The Claude Design type's craft file lists "Inter, Roboto, Arial, Fraunces".
  - Anthropic's December 2025 frontend-design skill named Space Grotesk as a convergence point.
  - An anonymous 2026 measurement gave one brief to five tools and measured three outputs. None used Inter. Four of five converged on a serif display face over a warm ground, two of them on Fraunces.
- **Implication for /frontend:**
  - The typeface comes from the research: the classification and mood of the sponsor's customers' sites, not their actual fonts (FD09).
  - The combined, dated list only triggers a written justification in DESIGN.md.
  - Re-check the list before each event.
  - Background detail is in FD02-F13, FD10-F20 and FD15.
- **Evidence:**
  - [pbakaus/impeccable crates/foundation/src/constants.rs](https://github.com/pbakaus/impeccable/blob/HEAD/crates/foundation/src/constants.rs) — Paul Bakaus, last commit 2026-09-04, Apache-2.0, accessed 2026-09-30 — source.
    - `// Older monoculture (still ubiquitous):` · `// Newer monoculture (the Anthropic-skill / Vercel / GitHub default wave):` · `"fraunces", "instrument sans", "instrument serif", "geist", ... "plus jakarta sans", "space grotesk", "recoleta",`
  - [pbakaus/impeccable skill/reference/new-work.md](https://github.com/pbakaus/impeccable/blob/HEAD/skill/reference/new-work.md) — accessed 2026-09-30.
    - "Operate and Read surfaces are well served by system stacks and workhorse UI faces; Persuade and Experience surfaces want faces with a point of view, and these training-data defaults mean you stopped looking: Fraunces, Playfair Display, Cormorant, Lora, Crimson, Newsreader, Syne, Space Grotesk, Space Mono, IBM Plex, Inter-as-display, DM Sans, DM Serif, Outfit, Plus Jakarta Sans, Instrument Sans."
  - Design Artifact type, file `artifact-type/reference/craft.md` (type URL https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd) — Anthropic core type "Design", release 1790780428-0f80, read with the Artifact tool, accessed 2026-09-30 — type file.
    - "overused font families (Inter, Roboto, Arial, Fraunces)"
  - [anthropics/skills frontend-design SKILL.md @ 0075614](https://github.com/anthropics/skills/blob/0075614/skills/frontend-design/SKILL.md) — Anthropic, commit of 2025-12-04, accessed 2026-09-30.
    - "NEVER converge on common choices (Space Grotesk, for example) across generations."
  - [Machine-made websites converge on each other](https://ai-design-convergence.vercel.app/) — anonymous (no byline), undated, accessed 2026-09-30 via Exa fetch — small measurement (Grade C on its own).
    - "Nobody used Inter. Nobody made a purple gradient. Nobody shipped the rounded-card grid."
    - "four of five independently produced a warm brass accent on a warm ground with a serif display face and uppercase letterspaced labels — two of them landing on the same typeface, Fraunces, with no coordination."
- **Limits / false positives:**
  - The convergence study measured three outputs from one brief, and the brief itself mentions brass.
  - Brand-mandated fonts are the main false positive.

### FD16-F15 — Butterick's rules for mixing fonts, system fonts and figures
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (all eleven quotes found verbatim in the three pages' HTML after stripping soft hyphens. Verification note: the recommended same-designer pair, IBM Plex, reserves the name "Plex", so a subset must be renamed (F30))
- **Claim:**
  - At most two fonts.
  - Any two fonts that are identifiably different can be mixed, and lower contrast between them can beat higher contrast.
  - Each font should have a consistent role. Pairing fonts by the same designer works reliably.
  - System fonts are overexposed, and his three problems concern printed documents. For screen display, the A and B lists of system fonts are fine. "don’t use Arial".
  - Use proportional figures in body text and tabular figures in columns of numbers.
- **Implication for /frontend:**
  - Two families at most, plus a monospace face only with a role.
  - A fixed role map (headings / body / data) in DESIGN.md.
  - A same-designer pair is the safe default (for example IBM Plex Sans with Plex Mono).
  - Tabular figures in tables, tickers and balances.
- **Evidence:**
  - [Mixing fonts](https://practicaltypography.com/mixing-fonts.html) — Matthew Butterick, Butterick's Practical Typography, accessed 2026-09-30 — author's online book (text checked after stripping soft hyphens).
    - "Most documents can tolerate a second font. Few can tolerate a third. Almost none can tolerate four or more."
    - "You can mix any two fonts that are identifiably different. If you’ve heard that you can only mix a serif font with a sans serif font, it’s not true. On the contrary, much like mixing colors, lower contrast between fonts can be more effective than higher contrast."
    - "Font mixing is most successful when each font has a consistent role in the document." · "combine fonts by the same font designer."
  - [System fonts](https://practicaltypography.com/system-fonts.html) — same author, accessed 2026-09-30.
    - "Avoid if you can, choose wisely if you can’t" · "In printed documents they present three problems." · "All system fonts are overexposed."
    - "For screen display, like presentations and websites, the A and B lists are fine." · "But don’t use Arial. It’s the sans serif of last resort."
  - [Alternate figures](https://practicaltypography.com/alternate-figures.html) — same author, accessed 2026-09-30.
    - "In body text, proportional figures are preferred because they tend to have more even spacing and a more consistent appearance. But tabular figures are essential for one purpose: vertically aligned columns, like you find in grids of numbers."
- **Limits / false positives:** Butterick writes mainly about documents, and he sells his own typefaces. Bringhurst was not opened (see "What could not be found").

### FD16-F16 — `tabular-nums` does nothing in DM Sans, Fraunces and Instrument Serif
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (re-measured independently: I downloaded the 14 upright builds from google/fonts `main` and ran my own fontTools 4.60.1 script. All three groups reproduce exactly, including Newsreader in both. Digit advances: DM Sans 9 distinct widths, Fraunces 9, Instrument Serif 9; Hanken Grotesk all 560, IBM Plex Sans all 600, JetBrains Mono all 600, Newsreader all 1100. The default instances are not always Regular (Manrope ExtraLight, Public Sans Thin, Space Grotesk Light, Bricolage 96pt ExtraBold). MDN and webstatus.dev re-read)
- **Claim:** I read the GSUB feature list and the default-instance digit advances of 14 Google Fonts builds (google/fonts `main`, 2026-09-30) with fontTools 4.60.1:
  - **No `tnum` and proportional default digits, so `tabular-nums` has no effect:** DM Sans, Fraunces, Instrument Serif.
  - **`tnum` present:** Inter, Geist, Space Grotesk, Manrope, Public Sans, Plus Jakarta Sans, Bricolage Grotesque, Newsreader.
  - **Tabular digits by default, no `tnum` needed:** IBM Plex Sans (also has `zero`), Hanken Grotesk, JetBrains Mono, Newsreader.

  `font-variant-numeric` has been Baseline widely available since 2022-07-15. `tabular-nums` maps to the OpenType `tnum` feature.
- **Implication for /frontend:** The font gate runs a short fontTools check on every face that displays numbers (balances, APRs, prices, tables). The face must have `tnum` or equal digit advances, otherwise it is rejected for data. Orma's rule "Every number on every screen is `--mono` with `font-variant-numeric: tabular-nums`" is the right intent, but it needs this check to work on any face.
- **Evidence:**
  - Local measurement — my command, 2026-09-30 — fonts fetched from [google/fonts](https://github.com/google/fonts) `ofl/<family>/`.
    - Command: `TTFont(f)['GSUB'].table.FeatureList.FeatureRecord` tags, plus `hmtx` advances of the glyphs mapped from '0' to '9'. A reusable version is saved as `C:/Users/Utilisateur/.claude/skills/frontend/research/_scripts/fd16/tnum_check.py`, and its re-run on DM Sans printed `tnum=False default_tabular=False -> NO TABULAR FIGURES`.
    - Output: `DM Sans 9pt tnum=False pnum=False ... default_digits_tabular=False` · `Fraunces tnum=False ... default_digits_tabular=False` · `Instrument Serif tnum=False ... default_digits_tabular=False` · `Inter tnum=True ... zero=True` · `IBM Plex Sans tnum=False ... zero=True default_digits_tabular=True` · `Hanken Grotesk tnum=False ... default_digits_tabular=True`
  - [MDN font-variant-numeric](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric) (source: `mdn/content/files/en-us/web/css/reference/properties/font-variant-numeric/index.md`) — Mozilla, accessed 2026-09-30 — reference docs.
    - "`tabular-nums` activating the set of figures where numbers are all of the same size, allowing them to be easily aligned like in tables. It corresponds to the OpenType values `tnum`."
  - [webstatus.dev: font-variant-numeric](https://api.webstatus.dev/v1/features/font-variant-numeric) — Google web-platform-dx, accessed 2026-09-30 — API.
    - `{'high_date': '2022-07-15', 'low_date': '2020-01-15', 'status': 'widely'}`
- **Limits / false positives:**
  - I checked the default instance only, and did not render text.
  - Other builds (Fontshare, foundry releases) can differ.
  - A monospace face is tabular by construction.

### FD16-F17 — A system font stack is a deliberate option; self-hosting removes the network risk that motivated Orma's
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (Modern Font Stacks README lines 10, 91 and 421; the repo is CC0-1.0, pushed 2026-03-10. Orma spec §6.2 at `docs/20-SPEC-FRONTEND.md` line 894, DESIGN.md lines 106 to 111, commit cda7f4f of 2026-09-12 and both Almanac quotes re-read. The limit on `next/font/google` is confirmed by the API reference `docs/01-app/03-api-reference/02-components/font.mdx`: "CSS and font files are downloaded at build time and self-hosted with the rest of your static assets." Orma's self-hosted Plex is a latin subset of a font with a Reserved Font Name, see F30)
- **Claim:**
  - Modern Font Stacks (CC0) publishes system stacks by classification. Examples: Transitional `Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif` and Industrial `Bahnschrift, 'DIN Alternate', 'Franklin Gothic Medium', 'Nimbus Sans Narrow', sans-serif-condensed, sans-serif`.
  - The Web Almanac 2025 describes a common hybrid: system fonts for UI text and a few custom fonts for branding.
  - Orma's spec banned web fonts because "a missing font on stage is a visible failure". The team later reread the rule: the risk is the network, not the file. They self-hosted IBM Plex (OFL, latin subset, 60 KB) with system fallbacks.
  - `next/font` self-hosts Google Fonts at build time, and Fontsource does the same through npm.
  - On the other side, Anthropic's December 2025 skill counted "system fonts" among overused families, and the 2024 Almanac calls them "not ideal from a design perspective".
- **Implication for /frontend:**
  - For a recorded video (Origins) and for venue demos, every face is self-hosted and nothing is loaded from a CDN at runtime.
  - A classification stack (Charter, Bahnschrift) is a real choice for body or data text in Operate surfaces, and it avoids the neo-grotesque default look.
  - Such a stack renders differently on each OS, so the recording machine fixes what judges see.
- **Evidence:**
  - [system-fonts/modern-font-stacks README](https://github.com/system-fonts/modern-font-stacks/blob/main/README.md) — Modern Font Stacks, CC0-1.0, pushed 2026-03-10, accessed 2026-09-30.
    - "The fastest fonts available. No downloading, no layout shifts, no flashes — just instant renders."
    - `font-family: Bahnschrift, 'DIN Alternate', 'Franklin Gothic Medium', 'Nimbus Sans Narrow', sans-serif-condensed, sans-serif;`
  - [Web Almanac 2025, Fonts](https://almanac.httparchive.org/en/2025/fonts) — Charles Berret, 2026-01-15, accessed 2026-09-30.
    - "Developers often use a hybrid approach, system fonts (or at least a safe generic fallback like `sans-serif`) for most UI text, and then load a few custom fonts for branding or headers."
  - Local files `C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/docs/20-SPEC-FRONTEND.md` §6.2 and `DESIGN.md` — owner's Orma project, read 2026-09-30.
    - "Two families, both system — **no web fonts**. Venue wifi is a risk and a missing font on stage is a visible failure."
    - "Le spec interdit les webfonts parce qu'« une police manquante sur scène est un échec visible » — le risque décrit est le **réseau**, pas le fichier." (the risk described is the network, not the file)
    - "`fonts/plex-*.woff2` | IBM Plex Sans variable + Plex Mono 400/500, subset latin, 60 Ko | **OFL 1.1**, self-hostées. Aucune requête réseau à l'exécution." (self-hosted, no network request at runtime)
  - [Next.js Font Optimization](https://nextjs.org/docs/app/getting-started/fonts) — Vercel, docs 16.3.8, accessed 2026-09-30.
    - "Fonts are included as static assets and served from the same domain as your deployment, meaning no requests are sent to Google by the browser when the user visits your site."
  - [Web Almanac 2024, Fonts](https://almanac.httparchive.org/en/2024/fonts) — accessed 2026-09-30.
    - "While system font families are not ideal from a design perspective, as universally available options they offer a useful fallback in case self-hosted or web fonts fail to load for some reason."
- **Limits / false positives:** Orma's DESIGN.md is private (commit `cda7f4f`, "keep DESIGN.md out of the public repo"). `next/font/google` needs network access at build time.

### FD16-F18 — Type scale: Tailwind's 13 default steps, fluid scales, and one small measurement of AI pages
- **Grade:** C · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - Tailwind's default scale runs 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96 and 128 px.
  - Utopia's method defines one modular scale for a small screen and one for a large screen, then interpolates between them. Its example uses 1.2 at 320 px and 1.333 at 1500 px.
  - The anonymous convergence study reports a median of 8 distinct type sizes on 945 award-listed human sites, against 10 to 13 on the AI outputs.
- **Implication for /frontend:**
  - Replace `--text-*` with a fluid scale of about 6 to 8 steps.
  - Have Playwright count the distinct computed font sizes per key screen. More than about 10 is a flag, not a failure, given the weak evidence.
- **Evidence:**
  - [tailwindcss@4.3.3/theme.css](https://unpkg.com/tailwindcss@4.3.3/theme.css) — accessed 2026-09-30.
    - `--text-xs: 0.75rem;` ... `--text-9xl: 8rem;`
  - [Designing with fluid type scales](https://utopia.fyi/blog/designing-with-fluid-type-scales/) — James Gilyead (byline "By James Gilyead"; Utopia itself was "Created by James Gilyead & Trys Mudford", supported by Clearleft), first published 1 February 2020, accessed 2026-09-30 — practitioner method. (corrected: the article is by Gilyead alone, and the first-person "I defined a typographic scale" is his)
    - "Define a type scale for a small screen" · "Define a type scale for a large screen" · "Tell the browser to interpolate between the two scales, based on the current viewport width"
    - "I defined a typographic scale of 1.2x at 320px (mobile-ish) and 1.333x at 1500px (desktop-ish)."
  - [Machine-made websites converge on each other](https://ai-design-convergence.vercel.app/) — anonymous, accessed 2026-09-30.
    - "Distinct type sizes | 8 | 10–13"
- **Limits / false positives:**
  - Three AI outputs are a tiny sample.
  - The study counts sizes after `document.fonts.ready`, so /frontend's measurement must wait for fonts as well.

### FD16-F19 — Icons need text labels; decorative icons are noise
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED (all four quotes found verbatim. The page's JSON-LD gives datePublished 2014-07-27 and dateModified 2024-01-29. The universal examples are verbatim: "The icons for home, print, and the magnifying glass for search are such instances.")
- **Claim:**
  - NN/g (2014) finds that users read icons through past experience and that few icons are recognised universally: home, print and the search magnifier.
  - A text label must accompany an icon.
  - The 5-second rule: if choosing an icon takes more than 5 seconds, an icon will not communicate the meaning.
  - An icon whose meaning is not immediately clear is "eye candy" and "visual noise".
- **Implication for /frontend:**
  - Content sections carry no icons by default.
  - Controls pair icons with visible labels.
  - This is the design reason behind tells #8 (three icon boxes) and #10 (Lucide everywhere): the icon usually carries no meaning.
- **Evidence:**
  - [Icon Usability](https://www.nngroup.com/articles/icon-usability/) — Aurora Harley, Nielsen Norman Group, 2014-07-27, accessed 2026-09-30 — research-firm article.
    - "A user’s understanding of an icon is based on previous experience."
    - "a text label must be present alongside an icon to clarify its meaning in that particular context."
    - "if it takes you more than 5 seconds to think of an appropriate icon for something, it is unlikely that an icon can effectively communicate that meaning."
    - "the icon is reduced to mere eye candy — confusing, frustrating, eye candy — and to visual noise that hinders people from completing a task."
- **Limits / false positives:** The article gives no study data inline and is 12 years old. Standard glyphs (search, close, menu) are well recognised.

### FD16-F20 — Swapping Lucide for Tabler keeps the look; Phosphor and Radix change the grammar
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Lucide requires a 24 × 24 canvas, 2 px strokes, round joins and round caps.
  - Tabler (6,220 icons) is drawn on a 24 × 24 grid with a 2 px stroke, and its SVGs use round caps and joins.
  - Phosphor comes in six weights: Thin, Light, Regular, Bold, Fill and Duotone. The pinned `@phosphor-icons/react` 2.1.10 ships 1,512 icon modules (`dist/csr/*.es.js`), while the homepage README still says "1,248 icons and counting". (corrected: 1,248 is the README's stale count)
  - Radix Icons are a 15 × 15 set.
  - Heroicons ships 24 px outline, 24 px solid, 20 px solid and 16 px solid, and accepts no new icons.
  - Licences: Lucide ISC, with the Feather-derived icons under MIT, which is why GitHub reports `NOASSERTION`. Tabler, Phosphor, Radix Icons and Heroicons are MIT. Hugeicons' free set is MIT (npm `@hugeicons/core-free-icons` 4.3.5; GitHub `hugeicons/hugeicons-react` MIT). Remix Icon has its own licence v1.0 (January 2026). It allows use in products, forbids standalone icon sales, and in §3.3 forbids using any icon, "modified or unmodified", as "A logo, trademark, or brand identifier" or as a "brand mark, app icon, or identity symbol". (corrected: the dossier left out the logo ban and Lucide's MIT portion)
- **Implication for /frontend:**
  - Changing the package does not remove tell #10 when the drawing rules stay the same.
  - If icons are needed, pick a set whose stroke and weight match the type: Phosphor Light with a light face, Radix 15 px for dense data UIs. Alternatively, draw 3 to 6 custom glyphs.
  - The checker treats "24 px viewBox, `stroke-width="2"`, round caps" SVGs as the Lucide family, whatever the package.
  - The logo step never starts from a library icon. For Remix Icon the licence forbids it outright (§3.3). For the others, a stock glyph as a mark is the same reflex as tell #10.
- **Evidence:**
  - [Lucide icon design guide](https://lucide.dev/contribute/icon-design-guide) — Lucide contributors, accessed 2026-09-30 — project docs.
    - "Icons must be designed on a 24 × 24-pixel canvas." · "Strokes must be 2 pixels wide." · "Strokes must use round line joins." · "Open paths must use round line caps."
  - [tabler/tabler-icons README](https://github.com/tabler/tabler-icons/blob/main/README.md) — Tabler, accessed 2026-09-30.
    - "A set of 6220 free, MIT-licensed, high-quality SVG icons for your web projects. Each icon is designed on a 24x24 grid with a 2px stroke." · `stroke-linecap="round"` · `stroke-linejoin="round"`
  - [phosphor-icons/homepage README](https://github.com/phosphor-icons/homepage/blob/master/README.md) — Phosphor Icons, accessed 2026-09-30.
    - "1,248 icons and counting" · "6 weights: **Thin**, **Light**, **Regular**, **Bold**, **Fill**, and **Duotone**"
  - [radix-ui/icons README](https://github.com/radix-ui/icons/blob/master/README.md) — WorkOS, accessed 2026-09-30.
    - "A crisp set of 15×15 icons designed by the WorkOS team."
  - [tailwindlabs/heroicons README](https://github.com/tailwindlabs/heroicons/blob/master/README.md) — Tailwind Labs, accessed 2026-09-30.
    - "**We're not accepting contributions for new icons or adding support for other frameworks like Svelte or SolidJS**."
  - [Remix Icon License v1.0](https://github.com/Remix-Design/RemixIcon/blob/master/License) — Remix Design, January 2026, accessed 2026-09-30.
    - "Sell, sublicense, or distribute the Icons as a standalone product" (listed under "You may NOT")
    - §3.3 "Prohibited: Logo, Trademark, and Brand Identity Use": "You may NOT use the Icons, whether modified or unmodified, as: - A logo, trademark, or brand identifier - The primary visual identity of a company, product, or service" (added at verification)
  - [@phosphor-icons/react@2.1.10 file listing](https://unpkg.com/@phosphor-icons/react@2.1.10/dist/csr/?meta) — unpkg, accessed 2026-09-30 — package files (added at verification): 3,024 files, 1,512 of them `.es.js` icon modules (for example `Acorn.es.js`, `AddressBook.es.js`).
  - [lucide-icons/lucide LICENSE](https://github.com/lucide-icons/lucide/blob/main/LICENSE) — accessed 2026-09-30 (added at verification): "ISC License" … "The following Lucide icons are derived from the Feather project:" … "The MIT License (MIT) (for the icons listed above)".
  - GitHub repository metadata via `gh api repos/<owner>/<repo>` — accessed 2026-09-30 — OBSERVED: tabler MIT, heroicons MIT, radix icons MIT, phosphor homepage MIT, lucide `NOASSERTION` (npm `lucide-react` declares ISC).
- **Limits / false positives:** A consistent library used sparingly, with labels, is fine. The tell is the reflex, not the package.

### FD16-F21 — Motion: CSS first; `motion` only for exit, layout and gesture work; reduced motion is built in
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Framer Motion became the independent "Motion" in November 2024. Migrating means installing `motion` and importing from `"motion/react"`.
  - The `motion` component cannot tree-shake below 34 kB. With `m` + `LazyMotion` the initial render costs "just under 4.6kb", plus 15 kB (`domAnimation`) or 25 kB (`domMax`). `useAnimate` comes in mini (2.3 kB) and hybrid (17 kB) sizes. Bundlephobia measures the whole `motion` package at 47.6 kB min+gzip.
  - `MotionConfig reducedMotion="user"` disables transform and layout animations and keeps opacity and colour animations.
  - WCAG 2.3.3 Animation from Interactions is Level AAA, and C39 (`prefers-reduced-motion`) is a sufficient technique for it.
  - In CSS, `@starting-style` became Baseline newly available on 2024-08-06 and view transitions on 2025-10-14. Scroll-driven animations are "limited", not Baseline.
  - Tailwind's default transition is 150 ms with `cubic-bezier(0.4, 0, 0.2, 1)` (F06).
- **Implication for /frontend:**
  - Entry and state changes use CSS transitions, with duration and easing tokens and `@starting-style`.
  - Use `motion` only for exit, layout and drag work, through `m` + `LazyMotion` under `MotionConfig reducedMotion="user"`. Load `domAnimation` (+15 kB) for exit animations, variants and tap, hover and focus gestures. Load `domMax` (+25 kB) when layout animations or pan and drag are needed, because `domAnimation` does not include them. (corrected: the dossier put layout and drag work under `domAnimation`)
  - No scroll reveals: a CSS-only version is not cross-browser, and JS reveals are tell #12.
  - Craft rules for easing and durations are in FD03.
- **Evidence:**
  - [Framer Motion is now independent, introducing Motion](https://motion.dev/blog/framer-motion-is-now-independent-introducing-motion) — Matt Perry, 2024-11-12, accessed 2026-09-30 — vendor blog.
    - "With Framer's blessing and support, Framer Motion is now completely independent."
  - [Motion upgrade guide](https://motion.dev/docs/react-upgrade-guide) — Motion, accessed 2026-09-30 — official docs (checked in raw HTML).
    - "To upgrade to Motion for React, uninstall framer-motion and install motion" · "Then simply swap imports from \"framer-motion\" to \"motion/react\""
  - [Reduce bundle size](https://motion.dev/docs/react-reduce-bundle-size) — Motion, accessed 2026-09-30 (raw HTML).
    - "it's impossible for bundlers to tree shake it any smaller than 34kb" · "to just under 4.6kb for the initial render" · "( +15kb )" · "( +25kb )" · "It comes in two sizes, mini (2.3kb) and hybrid (17kb)."
    - "domAnimation : This provides support for animations, variants, exit animations, and tap/hover/focus gestures. ( +15kb )" · "domMax : This provides support for all of the above, plus pan/drag gestures and layout animations. ( +25kb )" (re-read at verification)
  - [Motion accessibility](https://motion.dev/docs/react-accessibility) — Motion, accessed 2026-09-30 (raw HTML).
    - "By setting reducedMotion it to \"user\", all motion components will automatically disable transform and layout animations, while preserving the animation of other values like opacity and backgroundColor."
  - [Understanding SC 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) — W3C WAI, accessed 2026-09-30.
    - "Motion animation triggered by interaction can be disabled, unless the animation is essential to the functionality or the information being conveyed." (Level AAA; technique "C39: Using the CSS prefers-reduced-motion query to prevent motion")
  - [webstatus.dev API](https://api.webstatus.dev/v1/features/starting-style) — accessed 2026-09-30 — API.
    - `starting-style: {'low_date': '2024-08-06', 'status': 'newly'}` · `view-transitions: {'low_date': '2025-10-14', 'status': 'newly'}` · `scroll-driven-animations: {'status': 'limited'}`
  - [bundlephobia: motion@13.4.6](https://bundlephobia.com/package/motion@13.4.6) — bundlephobia, accessed 2026-09-30 — third-party measurement (B).
    - `min 142213 gzip 47603 deps 2`
- **Limits / false positives:** Motion's kB figures are the vendor's own. "Newly available" means that recent browsers support the feature, but older ones may not.

### FD16-F22 — TradingView Lightweight Charts: Apache-2.0 plus an attribution notice and a link
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (README lines 127 to 130, NOTICE and `layout-options.ts` lines 119 to 130 re-read on `master`. `layout-options-defaults.ts` gives `color: '#FFFFFF'`, `textColor: '#191919'`, `fontSize: 12` and `attributionLogo: true`. The system stack is `defaultFontFamily` in `src/helpers/make-font.ts`: `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`)
- **Claim:**
  - lightweight-charts is Apache-2.0. Its README adds that the licence requires naming TradingView as the product creator and placing the NOTICE text plus a link to tradingview.com on a page users can reach.
  - The `attributionLogo` option, `true` by default, satisfies the link requirement.
  - Other defaults: white background, text `#191919`, font size 12, and a system font stack.
- **Implication for /frontend:**
  - For price and position time series: include the NOTICE line in a credits or about section, and keep `attributionLogo: true` or add a visible link.
  - Set `layout.fontFamily`, `textColor` and `background` from the tokens so the chart does not look like a stock TradingView widget.
- **Evidence:**
  - [tradingview/lightweight-charts README](https://github.com/tradingview/lightweight-charts/blob/master/README.md) — TradingView, accessed 2026-09-30 — repository file.
    - "This license requires specifying TradingView as the product creator."
    - "You shall add the \"attribution notice\" from the NOTICE file and a link to <https://www.tradingview.com/> to the page of your website or mobile application that is available to your users."
  - [NOTICE](https://github.com/tradingview/lightweight-charts/blob/master/NOTICE) — TradingView, accessed 2026-09-30.
    - "TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/"
  - [src/model/layout-options.ts](https://github.com/tradingview/lightweight-charts/blob/master/src/model/layout-options.ts) and [src/api/options/layout-options-defaults.ts](https://github.com/tradingview/lightweight-charts/blob/master/src/api/options/layout-options-defaults.ts) — accessed 2026-09-30 — source.
    - "Using this attribution logo is sufficient for meeting this linking requirement." · `@defaultValue true`
    - `textColor: '#191919',` · `attributionLogo: true,`
- **Limits / false positives:** The README puts the notice on "the page of your website", while the source comment says "to your code" (see Contradictions).

### FD16-F23 — Chart libraries: choose by data shape, and replace the colours each one ships
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (the shadcn token bullet was wrong about what the CLI installs. Everything else was re-checked and holds. The shadcn chart page gives lines 10, 29 and 50. visx README lines 16 and 21. ECharts 6.0.0 was published 2025-07-30, and its notes add "The default theme has been changed". Plot v0.6.17 was published 2025-02-14. The Recharts example lines and a GitHub code-search total of 18 reproduce. All four Bundlephobia figures match to the byte)
- **Claim:**
  - shadcn's chart component is Recharts, not a wrapper, and now on Recharts v3.
  - visx is a set of "low-level visualization components", and v4 needs React 18 or 19.
  - ECharts 6.0.0 (2025-07-30) introduced a new default theme.
  - Observable Plot's last release is v0.6.17 (2025-02-14).
  - Bundlephobia sizes (whole package, min+gzip): lightweight-charts 61.6 kB, Recharts 151.5 kB, Observable Plot 128.0 kB, ECharts 368.0 kB.
  - Recharts' docs examples use `#8884d8`. GitHub code search finds it in 18 files under `www/src/docs/exampleComponents`, including a gradient area fill fading from 0.8 to 0 opacity.
  - shadcn ships two chart palettes.
    - What the CLI installs: every preset sets `chartColor: "neutral"` (sera: `taupe`), and `buildRegistryTheme` copies that theme's `chart-1..5` into the project. For the default nova/neutral install, these are greys in both modes: `oklch(0.87 0 0)`, `0.556`, `0.439`, `0.371` and `0.269`. The live `https://ui.shadcn.com/r/colors/neutral.json` serves the same values.
    - What the docs show: `theming.mdx` and the chart page's manual-install step ("Add the following colors to your CSS file") give an older palette. Its dark `--chart-1` is `oklch(0.488 0.243 264.376)` (indigo) and its dark `--chart-4` is `oklch(0.627 0.265 303.9)` (purple).
    - In both, the dark `--sidebar-primary` of all seven base colours is the indigo `oklch(0.488 0.243 264.376)`.
    - (corrected: the dossier presented the docs palette as shadcn's installed default)
- **Implication for /frontend:**
  - Time series: lightweight-charts. Standard bars and lines in a shadcn project: Recharts with project `--chart-*` tokens. Bespoke: visx. ECharts only when its chart types are needed.
  - The checker flags `#8884d8` and `#82ca9d` literals and unchanged shadcn chart tokens. It checks against both palettes: the CLI's greys and the docs' indigo and purple set.
- **Evidence:**
  - [shadcn chart docs (Base)](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/components/base/chart.mdx) — shadcn, accessed 2026-09-30.
    - "We use Recharts under the hood." · "We do not wrap Recharts." · "The `chart` component now uses Recharts v3."
  - [airbnb/visx README](https://github.com/airbnb/visx/blob/master/README.md) — Airbnb, accessed 2026-09-30.
    - "visx is a collection of reusable low-level visualization components." · "visx v4 is the current stable release and requires React 18 or 19."
  - [Apache ECharts 6.0.0 release](https://github.com/apache/echarts/releases/tag/6.0.0) — Apache ECharts, 2025-07-30, accessed 2026-09-30.
    - "[Feature] [theme] New theme for ECharts 6.0."
  - [observablehq/plot releases](https://github.com/observablehq/plot/releases) — Observable, accessed 2026-09-30.
    - `{"published_at":"2025-02-14T16:05:17Z","tag_name":"v0.6.17"}`
  - [recharts AreaChartExample.tsx](https://github.com/recharts/recharts/blob/main/www/src/docs/exampleComponents/AreaChart/AreaChartExample.tsx) and [CellBarExample.tsx](https://github.com/recharts/recharts/blob/main/www/src/docs/exampleComponents/Cell/CellBarExample.tsx) — Recharts, main, accessed 2026-09-30.
    - `<stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />` · `const colors = ['#8884d8', '#83a6ed', '#8dd1e1', '#82ca9d', '#a4de6c', 'url(#pattern-checkers)'];`
    - `gh api search/code -f q='repo:recharts/recharts 8884d8 path:www/src/docs/exampleComponents' --jq .total_count` → `18`
  - [shadcn theming (default theme CSS)](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/(root)/theming.mdx) — accessed 2026-09-30.
    - `--chart-1: oklch(0.488 0.243 264.376);` · `--chart-4: oklch(0.627 0.265 303.9);` · `--sidebar-primary: oklch(0.488 0.243 264.376);` (all under `.dark`). The same palette appears in `components/base/chart.mdx` lines 102 to 115, under "Add the following colors to your CSS file".
  - [apps/v4/registry/themes.ts](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/themes.ts), [apps/v4/registry/config.ts](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/config.ts) and [packages/shadcn/src/preset/defaults.ts](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/src/preset/defaults.ts) — shadcn, main, accessed 2026-09-30 — registry source (added at verification).
    - neutral theme, light and dark alike: `"chart-1": "oklch(0.87 0 0)", "chart-2": "oklch(0.556 0 0)", "chart-3": "oklch(0.439 0 0)", "chart-4": "oklch(0.371 0 0)", "chart-5": "oklch(0.269 0 0)"`. Dark: `"sidebar-primary": "oklch(0.488 0.243 264.376)"`.
    - `// Apply chart color override.` `const chartTheme = getTheme(config.chartColor)` … `lightVars[key] = chartLight[key]` · nova preset: `chartColor: "neutral",`
    - `preset.ts`: "Before v2, base-color themes had colored chart palettes borrowed from these colored themes." (`V1_CHART_COLOR_MAP`: `neutral: "blue"`)
  - [bundlephobia API](https://bundlephobia.com/api/size?package=recharts@3.10.1) — accessed 2026-09-30 — third-party measurement.
    - `lightweight-charts@5.2.1: min 194247 gzip 61584` · `recharts@3.10.1: min 566317 gzip 151514` · `echarts@6.1.0: min 1114829 gzip 367958` · `@observablehq/plot@0.6.17: min 384511 gzip 127958`
- **Limits / false positives:**
  - Bundlephobia measures the whole package, and tree-shaking (for example `echarts/core`) reduces it.
  - That `#8884d8` in AI output comes from these examples is my inference, not a measurement.
  - Older presets (v1 codes) decode with coloured chart palettes through `V1_CHART_COLOR_MAP`, so a project installed from an old preset code can carry a blue palette instead of greys.

### FD16-F24 — Wallet kits against React 19.3 and wagmi 3.7.7: two of the five lag
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (registry peers and dates re-queried. Issue #2626: the DanielSinclair comment of 2026-05-05 is verbatim. PR #2591 was authored by DanielSinclair and closed unmerged on 2026-07-07. ConnectKit #473 is still open, created 2025-09-12, and its error lines are verbatim. The wagmi guide lists ConnectKit, Dynamic and Privy. The v2-to-v3 guide confirms the rename: "`useAccount`, `useAccountEffect`, and `useSwitchAccount` are renamed to `useConnection`, `useConnectionEffect`, and `useSwitchConnection`". Dynamic's headless hooks are `@dynamic-labs-sdk/react-hooks` 1.36.0, whose npm entry declares no licence field. The pnpm question is answered in the limits)
- **Claim:**
  - wagmi 3.0.0 and the last 2.x (2.19.5) both shipped on 2025-11-19.
  - RainbowKit 2.2.11 (npm and `main`) peers `wagmi ^2.9.0`. A maintainer wrote on 2026-05-05 that "RainbowKit v3 with Wagmi v3 support is out today!". The registry has no 3.x version, and PR #2591 ("wagmi v3 compatibility") closed unmerged on 2026-07-07.
  - ConnectKit 1.9.2 peers React `17.x || 18.x` and wagmi 2.x. Its React 19 install issue (#473, `ERESOLVE`) has been open since 2025-09-12.
  - Reown's wagmi adapter 1.8.24 peers wagmi `>=2.19.5`.
  - Privy 3.46.0 peers React `^18 || ^19`.
  - Dynamic's legacy React SDK 5.9.2 peers React `>=18 <20`, and its headless hooks 1.36.0 peer React `^18 || ^19`.
  - wagmi's v3 docs list ConnectKit, Dynamic and Privy as third-party connect libraries, but not RainbowKit.
  - RainbowKit states that it works with Turbopack (Next 16+) and webpack, provides a Vite example, and needs a WalletConnect `projectId` for WalletConnect.
- **Implication for /frontend:**
  - Default: wagmi 3.7.7 with the project's own dialog (F25).
  - If a prebuilt modal is required, use RainbowKit 2.2.11 with wagmi pinned to 2.19.5 and the v2 hook names (`useAccount`, not `useConnection`).
  - Avoid ConnectKit on React 19.
  - The scaffold step checks peer ranges before installing.
- **Evidence:**
  - npm registry (see F01), accessed 2026-09-30.
    - `3.0.0 2025-11-19T19:37:45.063Z` · `latest 2.x 2.19.5 2025-11-19T18:55:25.827Z` (wagmi) · `2.2.11 {'@tanstack/react-query': '>=5.0.0', 'react': '>=18', 'react-dom': '>=18', 'viem': '2.x', 'wagmi': '^2.9.0'}` (rainbowkit `main` package.json)
  - [rainbow-me/rainbowkit issue #2626](https://github.com/rainbow-me/rainbowkit/issues/2626) — accessed 2026-09-30 — issue thread.
    - "RainbowKit v3 with Wagmi v3 support is out today!" (DanielSinclair, 2026-05-05)
  - [rainbow-me/rainbowkit PR #2591](https://github.com/rainbow-me/rainbowkit/pull/2591) — accessed 2026-09-30.
    - `{"closedAt":"2026-07-07T00:33:18Z","mergedAt":null,"state":"CLOSED","title":"feat: wagmi v3 compatibility"}`
  - [family/connectkit issue #473](https://github.com/family/connectkit/issues/473) — opened 2025-09-12, open on 2026-09-30.
    - "npm error Could not resolve dependency: npm error peer react@\"17.x || 18.x\" from connectkit@1.9.1"
  - [wagmi Connect Wallet guide](https://github.com/wevm/wagmi/blob/main/site/react/guides/connect-wallet.md) — wevm, main, accessed 2026-09-30.
    - "You can use a pre-built Connect Wallet module from a third-party library such as:" followed by ConnectKit, Dynamic and Privy.
  - [RainbowKit installation docs](https://github.com/rainbow-me/rainbowkit/blob/main/site/data/en-US/docs/installation.mdx) — accessed 2026-09-30.
    - "RainbowKit works with both Turbopack (the default bundler in Next.js 16+) and webpack." · "Every dApp that relies on WalletConnect now needs to obtain a `projectId` from WalletConnect Cloud."
- **Limits / false positives:** Peer ranges are declarations. A kit may run outside them, but npm refuses to install without `--legacy-peer-deps`. pnpm's docs give `strictPeerDependencies` "Default: **false**", and only when enabled do "commands … fail if there is a missing or invalid peer dependency". So pnpm 10.19 installs ConnectKit on React 19 with a warning, and whether it runs was not tested ([pnpm settings: peer dependencies](https://github.com/pnpm/pnpm.io/blob/main/docs/settings/peer-dependencies.md), accessed 2026-09-30, added at verification). ConnectKit 1.9.2 also depends on `framer-motion ^6.3.11`.

### FD16-F25 — How far each kit can be themed, and the fully custom path
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (RainbowKit: `theming.mdx` defaults `fontStack` `rounded` and `overlayBlur` `none`, and `custom-theme.mdx` has exactly 30 colour tokens; its note continues onto the next line, "…in the near future", and ends "We recommend sticking with the built-in themes for now". ConnectKit: 8 themes, the quote, and `embedGoogleFonts` "turned off by default". Reown: 7 `--apkt-*` rows and the quote. Privy: 20 `--privy-*` variables, none for fonts. Dynamic: both quotes, and the page itself recommends the JS SDK with React hooks for new React apps. wagmi: `createConfig.md` lines 103 and 104)
- **Claim:**
  - **RainbowKit.** Its theme functions take `accentColor`, `accentColorForeground`, `borderRadius`, `fontStack` (default `rounded`, which tries SF Pro Rounded) and `overlayBlur` (default `none`). A custom `Theme` type exposes the overlay blur, about 30 colour tokens, `fonts.body`, radii and shadows, and the docs call it "unstable and likely to change". `ConnectButton.Custom` replaces the button, but the modal stays RainbowKit's.
  - **ConnectKit.** 8 themes, plus `customTheme` CSS variables that are "isn't a stable feature yet". `embedGoogleFonts` is off by default.
  - **Reown AppKit.** Says it "can be fully customized", yet lists 7 `--apkt-*` variables: font family, accent, colour mix, colour mix strength, font size master, border radius master and z-index.
  - **Privy.** `theme` accepts light, dark or a hex value, and derives the other colours from it. There are 20 CSS variables (radii and colours; no font variable listed), and "whitelabel" hooks for a fully custom UI.
  - **Dynamic.** The legacy SDK themes a shadow-DOM widget through CSS variables, including `--dynamic-font-family-primary`. The new JavaScript SDK is headless.
  - **wagmi.** Documents "Build Your Own". EIP-6963 multi-provider discovery defaults to `true`.
- **Implication for /frontend:**
  - Ranked by visual control: own dialog (wagmi hooks, Privy whitelabel or Dynamic headless) > RainbowKit custom `Theme` > Dynamic legacy CSS variables > Privy CSS variables > ConnectKit `customTheme` > Reown's 7 variables.
  - Build the connect dialog from the project's own primitives unless the sponsor mandates a kit.
- **Evidence:**
  - [RainbowKit theming](https://github.com/rainbow-me/rainbowkit/blob/main/site/data/en-US/docs/theming.mdx) and [custom theme](https://github.com/rainbow-me/rainbowkit/blob/main/site/data/en-US/docs/custom-theme.mdx) — Rainbow, main, accessed 2026-09-30.
    - "The font stack used throughout the UI. Note that `rounded` attempts to use SF Pro Rounded, falling back to system fonts when it isn't available."
    - "> Note: This API is unstable and likely to change in the near future."
  - [ConnectKit theming](https://family.co/docs/connectkit/theming) — Family, accessed 2026-09-30 (raw HTML).
    - "Overriding theme variables isn't a stable feature yet and could change in future versions of ConnectKit."
  - [Reown AppKit theming](https://docs.reown.com/appkit/react/core/theming) (raw `.md`) — Reown, accessed 2026-09-30.
    - "The theme for the AppKit integration in your dApp can be fully customized." · table rows `--apkt-font-family`, `--apkt-accent`, `--apkt-color-mix`, `--apkt-color-mix-strength`, `--apkt-font-size-master`, `--apkt-border-radius-master`, `--apkt-z-index`
  - [Privy: Configuring appearance](https://docs.privy.io/basics/get-started/dashboard/configuring-appearance.md) and [Whitelabel](https://docs.privy.io/authentication/user-authentication/whitelabel.md) — Privy, accessed 2026-09-30.
    - "All other colors will be automatically generated by modulating the luminance of the theme color you set."
    - "All of Privy's frontend SDKs let you fully customize authentication to match your app’s brand and user experience."
  - [Dynamic: CSS Variables](https://www.dynamic.xyz/docs/react/using-our-ui/design-customizations/css/css-variables.md) and [JavaScript SDK Overview](https://www.dynamic.xyz/docs/javascript/overview.md) — Dynamic Labs, accessed 2026-09-30.
    - "We recommend setting these CSS variables in your host site by targeting the `dynamic-shadow-dom` class."
    - "This SDK is headless: no built-in modal, wallet picker, or login form. You control every pixel of the UI."
  - [wagmi Connect Wallet guide](https://github.com/wevm/wagmi/blob/main/site/react/guides/connect-wallet.md) and [createConfig](https://github.com/wevm/wagmi/blob/main/site/shared/createConfig.md) — wevm, accessed 2026-09-30.
    - "It takes less than five minutes to get up and running with Browser Wallets, WalletConnect, and Coinbase Wallet."
    - "Enables discovery of injected providers via EIP-6963 using the `mipd` library and converting to injected connectors." · "Defaults to `true`."
- **Limits / false positives:**
  - I judged theming depth from documentation and type definitions, without rendering any kit.
  - Privy and Dynamic need an app or environment ID from a hosted dashboard. I did not test their offline behaviour.

### FD16-F26 — Reown AppKit's licence requires a Reown notice, "applicable logo and branding", and the Reown network
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (`@reown/appkit@1.8.24/LICENSE.md` re-read, 19,971 bytes: release date, notice clause, network clause, both limits and the assignment clause are all verbatim. The assignment carries a grant-back licence "solely in conjunction with the AppKit Items" and requires "prominent notices stating that You changed the files")
- **Claim:** The package ships the Reown Community License Agreement (release date 25 August 2025). Anyone distributing a product built on AppKit must:
  - include "Portions © 2025 Reown, Inc. All Rights Reserved" in the notices, the readme or the website's about section;
  - include a copy of the licence;
  - include "applicable logo and branding".

  In addition:
  - all use must connect to Reown's gateway and WalletConnect network unless Reown approves otherwise;
  - above 2,500,000 RPC calls or 500 MAU a month, a commercial licence is due;
  - modifications to AppKit itself are assigned to Reown.
- **Implication for /frontend:**
  - Use AppKit only when a sponsor requires it. If so, add the notice to the README and about page, ship the licence copy, and never patch AppKit's own files.
  - Otherwise prefer MIT or Apache kits (F24).
- **Evidence:**
  - [@reown/appkit@1.8.24 LICENSE.md](https://unpkg.com/@reown/appkit@1.8.24/LICENSE.md) — Reown, Inc., accessed 2026-09-30 — licence file in the npm package.
    - "**Release Date: 25 August 2025**"
    - "You must (i) include the following copyright notice in the notices or readme.txt of the product, or the about section of the website for the services: “Portions © 2025 Reown, Inc. All Rights Reserved” ; (ii) provide a copy of this License Agreement with any applications or wallets containing such AppKit Items or that are required for the use thereof; and (iii) applicable logo and branding."
    - "all use, distribution or derivatives works of the AppKit Items must connect to the proprietary Reown gateway infrastructure, or its successor, and its related WalletConnect messaging protocol"
    - "Monthly RPC limit of 2,500,000" · "Monthly MAU limit of 500"
- **Limits / false positives:** This is not legal advice. "Applicable logo and branding" is not defined in the excerpt I read.

### FD16-F27 — Colour: OKLCH is Baseline; gate on WCAG 2.2 ratios, because WCAG 3 has not chosen a contrast method
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (the webstatus.dev `oklab` entry and Tailwind `compatibility.mdx` lines 10 to 12 re-read. WCAG 2.2 is "W3C Recommendation 12 December 2024", and both SC texts are verbatim. The WCAG 3.0 page is "W3C Working Draft 10 September 2026" (WD-wcag-3.0-20260910), the editor's note is verbatim, and "APCA" appears 0 times in the extracted text. Radix `understanding-the-scale.mdx` lines 100 and 101, and the Apple HIG JSON sentence, re-read)
- **Claim:**
  - Oklab/OkLCh has been Baseline widely available since 2025-11-09 (newly available since 2023-05-09).
  - Tailwind 4.3.3's palette and shadcn's tokens are written in OKLCH. Tailwind v4 needs Chrome 111, Safari 16.4 and Firefox 128.
  - WCAG 2.2 AA: text at least 4.5:1, large-scale text (18 pt, or 14 pt bold) at least 3:1, and UI component or state indicators at least 3:1 against adjacent colours.
  - The WCAG 3.0 Working Draft of 10 September 2026 carries an editor's note that the contrast algorithm "is yet to be determined". The string "APCA" does not appear in the draft.
  - Radix Colors guarantees its text steps in APCA Lc terms, and Harmonizer defaults to APCA.
  - Apple's HIG sets 4.5:1 as the minimum and 7:1 as the aim for small text in custom colours.
- **Implication for /frontend:**
  - Generate palettes in OKLCH, but verify with WCAG 2 ratios, the metric harden's axe floor uses.
  - Dark-mode secondary text: at least 4.5:1, aiming for 7:1 at small sizes. This is the direct fix for tell #7.
- **Evidence:**
  - [webstatus.dev: Oklab and OkLCh](https://api.webstatus.dev/v1/features/oklab) — accessed 2026-09-30 — API.
    - `{"baseline":{"high_date":"2025-11-09","low_date":"2023-05-09","status":"widely"}, ... "name":"Oklab and OkLCh"}`
  - [Tailwind compatibility](https://tailwindcss.com/docs/compatibility) — Tailwind Labs, accessed 2026-09-30.
    - "Chrome 111 _(released March 2023)_" · "Safari 16.4 _(released March 2023)_" · "Firefox 128 _(released July 2024)_"
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — W3C, Recommendation (12 December 2024 version per the fetch), accessed 2026-09-30 — standard.
    - "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for the following: Large Text Large-scale text and images of large-scale text have a contrast ratio of at least 3:1;"
    - "The visual presentation of the following have a contrast ratio of at least 3:1 against adjacent color(s): User Interface Components Visual information required to identify user interface components and states, except for inactive components or where the appearance of the component is determined by the user agent and not modified by the author;"
  - [WCAG 3.0 Working Draft](https://www.w3.org/TR/wcag-3.0/) — W3C AG WG, Working Draft dated 10 September 2026, accessed 2026-09-30 — draft standard (text extracted locally).
    - "Editor's note The contrast algorithm used in WCAG 3 is yet to be determined."
  - [Radix Colors: understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) — WorkOS, accessed 2026-09-30.
    - "Steps `11` and `12`—which are designed for text—are guaranteed to Lc 60 and Lc 90 APCA contrast ratio on top of a step `2` background from the same scale."
  - [Apple HIG: Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) (JSON: `developer.apple.com/tutorials/data/design/human-interface-guidelines/dark-mode.json`) — Apple, accessed 2026-09-30.
    - "At a minimum, make sure the contrast ratio between colors is no lower than 4.5:1. For custom foreground and background colors, strive for a contrast ratio of 7:1, especially in small text."
- **Limits / false positives:** APCA may still become the WCAG 3 method. A palette tuned only to APCA can fail a WCAG 2 ratio check.

### FD16-F28 — Contrast has to be built into the tokens: kit defaults measured, and what axe cannot see
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (all eight ratios and the three validation values reproduced to two decimals by my own script. I did not reuse the researcher's `contrast.py`. My script uses Ottosson's OKLab matrices, sRGB clipping and WCAG relative luminance. Verification notes follow. First, `blue-500`, `violet-500` and `indigo-500` are outside the sRGB gamut, so those three ratios depend on clipping; clipped hex values are `#2b7fff`, `#8e51ff` and `#615fff`. Second, the shadcn input and muted values used are the ones the current registry installs (`themes.ts` neutral), not only the docs. Third, axe-core 4.13.0 is npm `latest`, published 2026-08-05; code search finds no `wcag1411` tag. Fourth, axe files text over images and gradients under incomplete, "needs review", not under violations, with the messages "Element's background color could not be determined due to a background image" and "...due to a background gradient" (`locales/_template.json`). A gate that reads only `violations` never sees them.)
- **Claim:** I computed WCAG 2 ratios from the OKLCH values in shadcn's theme and Tailwind 4.3.3, using OKLCH → linear sRGB and relative luminance, with alpha composited in sRGB. The script was validated against known values: `#767676` on white = 4.54, `zinc-950` → `#09090b`, v3 `blue-500` on white = 3.68.

  | Pair | Ratio | Result |
  |---|---|---|
  | shadcn dark `--muted-foreground` 0.708 on `--background` 0.145 | 7.63:1 | pass |
  | shadcn dark `--muted-foreground` on `--card` 0.205 | 6.91:1 | pass |
  | shadcn light `--muted-foreground` 0.556 on `--muted` 0.97 | 4.34:1 | fails 4.5 |
  | white on Tailwind v4 `blue-500` | 3.76:1 | fails 4.5 |
  | white on `violet-500` / `indigo-500` | 4.40 / 4.58:1 | fail / pass |
  | Tailwind `zinc-500` on `zinc-950` | 4.12:1 | fails 4.5 (as FD10-F24) |
  | shadcn dark `--input` (white at 15%) over 0.145 | 1.47:1 | below 3:1 (non-text) |
  | shadcn light `--input`/`--border` 0.922 on white | 1.26:1 | below 3:1 (non-text) |

  axe-core 4.13 has `color-contrast` (tagged `wcag143`) and `color-contrast-enhanced` (`wcag146`), and no rule for 1.4.11. The `color-contrast` rule "will not report on text elements that have a background-image". Its docs list CSS background gradients among the cases it cannot resolve.
- **Implication for /frontend:**
  - Compute a token-pair contrast table at build time: text pairs, input borders, focus rings and chart strokes against their neighbours.
  - Forbid text over a gradient, image or grain without a solid plate, because harden's axe run cannot catch it. Tells #2 and #20 escape the automated floor.
  - Fix shadcn's "muted on muted" pairing in light mode.
- **Evidence:**
  - Local computation — my script, saved as `C:/Users/Utilisateur/.claude/skills/frontend/research/_scripts/fd16/contrast.py` (values copied from `tailwindcss@4.3.3/theme.css` and shadcn's theming defaults), run 2026-09-30.
    - Output: `7.63:1 PASS 4.5 shadcn dark: muted-foreground 0.708 on background 0.145` · `4.34:1 PASS 3.0 only shadcn light: muted-foreground 0.556 on muted 0.97` · `3.76:1 PASS 3.0 only white on blue-500` · `1.47:1 shadcn dark --input 15% white over bg 0.145 (non-text)` · `4.54:1 #767676 vs white (known 4.54)`
  - [axe-core rule descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md) — Deque, develop branch (latest 4.13.0), accessed 2026-09-30.
    - `color-contrast | Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds | ... wcag2aa, wcag143 ...`
  - [axe rule color-contrast 4.13](https://dequeuniversity.com/rules/axe/4.13/color-contrast) — Deque University, accessed 2026-09-30 (raw HTML).
    - "Note: This rule will not report on text elements that have a background-image, are obscured by other elements or are images of text."
    - "Color transparency and opacity in the foreground is more difficult to detect and account for due to: 1:1 colors in foreground and background. CSS background gradients."
  - [WCAG 2.2 SC 1.4.11](https://www.w3.org/TR/WCAG22/#non-text-contrast) — W3C, accessed 2026-09-30.
    - "Visual information required to identify user interface components and states"
- **Limits / false positives:**
  - 1.4.11 applies to an input border only when that border is what identifies the control. A filled field can pass on its fill.
  - My conversion clips out-of-gamut values.
  - Alpha compositing in sRGB matches browser behaviour in the common case.

### FD16-F29 — Palette generators an agent can drive from a brand hue
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - Adobe's Leonardo generates colours from target contrast ratios. It is Apache-2.0, available on npm as `@adobe/leonardo-contrast-colors` 1.1.0 (published 2026-02-18; corrected from 2026-07-08), and scriptable.
  - Radix's custom palette page takes Accent, Gray and Background inputs and produces 12-step scales. Radix documents a role for each step: 1 and 2 backgrounds, 3 to 5 component states, 6 to 8 borders, 9 and 10 solid fills, 11 and 12 text.
  - Evil Martians' Harmonizer builds OKLCH palettes with "consistent chroma and contrast", uses APCA by default or WCAG, and exports Tailwind, CSS variables or JSON. Its repository has no licence file.
  - shadcn's "Adding New Tokens" pattern wires the result into Tailwind.
- **Implication for /frontend:**
  - Pipeline: brand hue (from the logo, FD12) → Leonardo with WCAG targets 3, 4.5 and 7 → OKLCH tokens → Tailwind `@theme` and shadcn `:root`/`.dark`.
  - Name the tokens with Radix's step roles so borders, hovers and text land on predictable steps.
  - Use Harmonizer only as a web app, and in WCAG mode.
- **Evidence:**
  - [adobe/leonardo README](https://github.com/adobe/leonardo/blob/main/README.md) — Adobe, Apache-2.0, accessed 2026-09-30.
    - "Authoring adaptive color palettes for generating color based on a desired contrast ratio."
    - "by using contrast ratio as the starting point, rather than a post-color-selection auditing process."
  - [npm @adobe/leonardo-contrast-colors](https://registry.npmjs.org/@adobe%2Fleonardo-contrast-colors) — accessed 2026-09-30.
    - `time["1.1.0"]: 2026-02-18T01:24:52.253Z` (1.0.1 published the same night at 00:27:18). (corrected: the dossier gave `2026-07-08T08:12:21.756Z`, which is the package's `time.modified` stamp, not the 1.1.0 publication. The adobe/leonardo repo was last pushed 2026-07-08T22:10:56Z)
  - [Radix Colors: create a custom palette](https://www.radix-ui.com/colors/custom) — WorkOS, accessed 2026-09-30 — tool page. The fetch showed sections labelled "Accent", "Gray" and "Background", scales numbered 1 to 12 and no explanatory text. Re-fetched at verification: the page also labels the step groups "Backgrounds", "Interactive components", "Borders and separators", "Solid colors" and "Accessible text".
  - [Radix Colors: understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) — accessed 2026-09-30.
    - "Steps `6`, `7`, and `8` are designed for borders." · "Steps `11` and `12` are designed for text."
  - [evilmartians/harmonizer README](https://github.com/evilmartians/harmonizer/blob/HEAD/README.md) — Evil Martians, pushed 2026-08-05, accessed 2026-09-30.
    - "Consistent contrast calculation using APCA (default) or WCAG" · "Developer exports: Tailwind, CSS variables, JSON."
    - `gh api repos/evilmartians/harmonizer --jq .license.spdx_id` → `null`
- **Limits / false positives:** Generated palettes still need a person's judgement on hue. The Radix guarantee is in APCA terms (F27).

### FD16-F30 — Subsetting an OFL webfont is modification: a subset may not keep a Reserved Font Name, and IBM Plex reserves "Plex" (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:**
  - The OFL FAQ (version 1.1-update7, November 2023) asks whether subsetting a webfont is modification, and answers yes. Removing unused glyphs or smart-font code for a browser is modification. The OFL permits it, but it "would not normally allow the use of RFNs" (Reserved Font Names).
  - A modified webfont may keep the RFN only if it preserves "Functional Equivalence": the same full character inventory and the same smart-font behaviour. The FAQ calls this "technically very difficult and often impractical". Otherwise, "you simply need to pick your own font name".
  - The licence text limits the RFN restriction to "the primary font name as presented to the users".
  - google/fonts' IBM Plex Sans `OFL.txt` declares `Reserved Font Name "Plex"`. Inter's `OFL.txt` declares none.
  - The owner's Orma repo is public (`BuzzBallz/orma`, `visibility: public`) and commits five Plex files under `app/public/assets/fonts/`. Its assets README says they are "the latin subsets Google Fonts serves for IBM Plex (fonts.gstatic.com), downloaded once and committed". I read their name tables with fontTools. `plex-sans-var.woff2` keeps the family name "IBM Plex Sans" with 270 glyphs, against 1,025 in the full google/fonts build. The Mono and Serif files also keep "IBM Plex Mono" and "IBM Plex Serif", with 263 to 280 glyphs.
- **Implication for /frontend:**
  - The font gate reads each face's `OFL.txt` for "Reserved Font Name".
  - With no RFN (Inter and most Google Fonts families), subsetting is free.
  - With an RFN (IBM Plex), there are three options: ship the unmodified files; rename the subset in its `name` table and in `@font-face`; or pick a face without an RFN.
  - Committing a provider's pre-built subsets to a public repo counts as redistributing a Modified Version. Record it in DESIGN.md with the licence line.
  - Orma's committed Plex subsets are a case to raise with the owner before the next public repo, not a finding of infringement.
- **Evidence:**
  - [OFL-FAQ](https://openfontlicense.org/ofl-faq/) — SIL International; site maintained by Victor Gaultney and Nicolas Spalinger; "OFL-FAQ version 1.1-update7 (November 2023)"; page "Last updated on 12 January 2026"; accessed 2026-09-30 — licence steward's FAQ.
    - "2.6 Is subsetting a webfont considered modification? Yes. Removing any parts of the font when delivering a webfont to a browser, including unused glyphs and smart font code, is considered modification. This is permitted by the OFL but would not normally allow the use of RFNs."
    - "2.7 Are there any situations in which a modified webfont could use RFNs? Yes. If a webfont is optimized only in ways that preserve Functional Equivalence (see entry 2.8), then it may use RFNs, … However this is technically very difficult and often impractical, so a much better scenario is for the webfont service or provider to sign a separate agreement with the author(s) that allows the use of RFNs for Modified Versions."
    - "Like other Modified Versions, it would not be allowed to use any RFNs and you simply need to pick your own font name."
  - [SIL Open Font License 1.1, official text](https://openfontlicense.org/open-font-license-official-text/) — accessed 2026-09-30.
    - "No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted by the corresponding Copyright Holder. This restriction only applies to the primary font name as presented to the users."
  - [google/fonts ofl/ibmplexsans/OFL.txt](https://github.com/google/fonts/blob/main/ofl/ibmplexsans/OFL.txt) — accessed 2026-09-30: `Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"`. [ofl/inter/OFL.txt](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt): `Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)`, with no RFN.
  - Local files: Orma `app/public/assets/README.md` lines 61 to 73, and `app/public/assets/fonts/*.woff2`. I read the name tables with fontTools 4.66.1 and brotli 1.2.0 in a scratch venv on 2026-09-30 — OBSERVED.
    - Output: `plex-sans-var.woff2 | family: IBM Plex Sans | glyphs: 270` · `plex-mono-400.woff2 | family: IBM Plex Mono | glyphs: 280` · `plex-serif-400.woff2 | family: IBM Plex Serif | glyphs: 263` · `google/fonts IBMPlexSans[wdth,wght].ttf glyphs: 1025`.
    - `gh api repos/BuzzBallz/orma` returned `false` for `private` and `public` for `visibility`.
- **Limits / false positives:**
  - This is not legal advice.
  - I did not find whether Google Fonts or IBM has a separate agreement covering Google's served subsets, the case FAQ 2.7 describes.
  - Only the Plex Sans and Inter `OFL.txt` files were read; every other family needs its own check.
  - The "as presented to the users" wording may leave room for a CSS alias. The FAQ's own answer is to rename.

### FD16-F31 — Claude Design's craft file bans four fonts but prescribes the display-plus-body pairing and, without a brand, gradient meshes and grain (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:**
  - The Design type's `artifact-type/reference/craft.md` lists these among AI slop tropes: "aggressive use of gradient backgrounds", "containers with rounded corners and left-border accent color" and "overused font families (Inter, Roboto, Arial, Fraunces)".
  - Its "When no brand or design system governs" section asks for a different set of moves.
    - Typography: "Pair a distinctive display font with a refined body font".
    - Backgrounds: "gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, grain overlays". Together, gradient meshes and grain overlays make up tell #20 (grain over a gradient).
  - It sizes the type system at "1–3 families" and loads Google Fonts only ("no other webfont host does").
  - The anonymous convergence study measured Claude Design's output at z-distance 2.16 from the centroid of 945 award-listed sites. That is more typical than the median human site (3.01). The study also found four of five tools on a serif display face (F14).
- **Implication for /frontend:**
  - When /frontend drives the Design type, it always passes the brand direction and the type pairing from its research first, so the file's no-brand branch never applies.
  - /frontend keeps Butterick's two families (F15) rather than the file's "1–3".
  - Google-only font loading on the canvas matches F12: FFL faces stay off the canvas.
- **Evidence:**
  - Design Artifact type, file `artifact-type/reference/craft.md` (type URL https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd) — Anthropic core type "Design", read with the Artifact tool (`action: read`, `path`), 15,973 characters, accessed 2026-09-30 — type file.
    - "Typography: choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt for distinctive, characterful choices. Pair a distinctive display font with a refined body font."
    - "Backgrounds & visual details: create atmosphere and depth rather than defaulting to solid colors — gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, grain overlays."
    - "A type pairing: Google Fonts load in the artifact (one `fonts.googleapis.com/css2?family=…&display=swap` `<link>` in `<helmet>`; no other webfont host does); 1–3 families"
    - "Avoid AI slop tropes: including but not limited to aggressive use of gradient backgrounds, emoji (unless explicitly part of the brand), containers with rounded corners and left-border accent color, and overused font families (Inter, Roboto, Arial, Fraunces)."
  - [Machine-made websites converge on each other](https://ai-design-convergence.vercel.app/) — anonymous, undated, accessed 2026-09-30 — small measurement (Grade C on its own).
    - "| Claude Design | 2.16 |" · "| Median human site | 3.01 |"
- **Limits / false positives:**
  - The bold-direction list is framed as inspiration ("Use these for inspiration but design one that is true to the aesthetic direction"), so grain is suggested, not mandated.
  - The study measured one output per tool from one brief, and does not say which release of the Design type produced it.
  - The Design type's own scope is covered in FD07. This finding records only its typography and background rules.

## Contradictions between sources

1. **RainbowKit v3.** A maintainer wrote on 2026-05-05 that "RainbowKit v3 with Wagmi v3 support is out today!". The registry's newest version is 2.2.11 (2026-05-06), with peer `wagmi ^2.9.0`. `main` still reads 2.2.11. PR #2591 closed unmerged on 2026-07-07 (F24).
2. **wagmi's list and ConnectKit.** wagmi's v3 docs recommend ConnectKit as "built on top of Wagmi". ConnectKit 1.9.2 declares wagmi 2.x and React 17/18 only (F24).
3. **Reown's claim versus its API.** Reown says AppKit theming "can be fully customized", but the documented surface is seven variables (F25).
4. **System fonts.** Butterick calls them "overexposed", but says his three problems are about "printed documents" and that for websites "the A and B lists are fine". Anthropic's December 2025 skill listed "system fonts" as generic. impeccable says system stacks serve Operate and Read surfaces well. The 2024 Almanac calls them "not ideal from a design perspective". Orma used them, then moved to self-hosted Plex (F15, F17).
5. **Reflex lists against recommendations.** impeccable's skill lists IBM Plex, Newsreader and Fraunces as training-data defaults. A vendor blog recommends the same faces as escapes from Geist: [Geist Is the New Inter](https://sailop.com/blog/geist-the-new-inter-ai-font-fingerprint-2026) (Sailop, 2026-06-13, fetched via Exa, Grade D; its "three in five" figure has no method). It says: "Or use IBM Plex Sans — free, a genuine grotesque, and almost nobody in the AI-startup cohort uses it, so it carries no fingerprint." and "Source Serif 4, Newsreader, or Fraunces (at a low optical/wonk setting) in your H1s". Orma chose IBM Plex. taste-skill recommends Geist, which impeccable flags (FD10-F20).
6. **shadcn docs against themselves.** `components-json.mdx` shows `"style": "new-york"` and says the `default` style is deprecated. `theming.mdx` and the CLI's `--defaults` use `base-nova`. `DEFAULT_PRESET_CONFIG` resolves the font to `inter`, while the nova preset uses Geist (F07, F08).
7. **lightweight-charts attribution placement.** The README says to add the NOTICE "to the page of your website or mobile application". The source comment says "to your code". Both require the link (F22).
8. **OKLCH Baseline date.** A WebFetch summary of MDN's `oklch()` page said "Widely available since May 2023". webstatus.dev gives newly available on 2023-05-09 and widely available on 2025-11-09. I used the webstatus data. The summary probably merged the two dates (F27).
9. **APCA in tools, WCAG 2 in the standard.** Radix guarantees APCA Lc values and Harmonizer defaults to APCA. WCAG 2.2 is the Recommendation, the WCAG 3 draft leaves the algorithm undecided, and axe checks WCAG 2 ratios (F27, F28).
10. **Speed claims.** Next 16 reports 2 to 5 times faster builds against webpack. Vite 8 reports 10 to 30 times faster against Rollup. The baselines differ, so the numbers cannot be compared (F02).
11. **Google Fonts dates.** The catalogue JSON gives Space Grotesk `dateAdded 2020-10-06`, while `METADATA.pb` (FD10-F20) gives 2020-10-07. Instrument Serif and Geist are also one day apart. The likeliest cause is timezone; the discrepancy does not matter here.
12. **Dynamic's two SDKs.** Dynamic's docs recommend the headless JavaScript SDK for new apps, but the legacy React SDK (5.9.2) was still published on 2026-09-28 (F24, F25).
13. **shadcn's docs against its registry: chart colours** (added at verification). `theming.mdx` and the chart page's manual-install step give the old palette, whose dark `--chart-1` is indigo and dark `--chart-4` purple. What the CLI installs by default (`chartColor: "neutral"`, `themes.ts`) is greyscale. The indigo survives only in every base colour's dark `--sidebar-primary` (F23).
14. **shadcn's docs against its CLI: frozen fields** (added at verification). `components-json.mdx` says `style`, `baseColor` and `cssVariables` "cannot be changed after initialization". A full `shadcn apply` (2026-04-08) patches all three and reinstalls every component (F07).
15. **Claude Design's craft file against itself** (added at verification). It lists "aggressive use of gradient backgrounds" as an AI slop trope. Its no-brand section recommends "gradient meshes, noise textures … grain overlays" (F31).
16. **React's advisory page against its advisory list** (added at verification). The react.dev post was last updated on 26 January 2026. facebook/react's GitHub security advisories add RSC CVEs on 2026-04-08, 2026-05-06 and 2026-07-21 (F03).
17. **Phosphor's README against its package** (added at verification). The homepage README says "1,248 icons and counting". `@phosphor-icons/react` 2.1.10 ships 1,512 icon modules (F20).

## What could not be found, and how it was searched

- **Bringhurst's *The Elements of Typographic Style*.** It is a print book with no legitimately hosted full text. I did not open it, so no rule here rests on it. The only reference I read was Anthropic's skill ("set a clear type scale following the default guidance of The Elements of Typographic Style"). Verification note: that sentence is in the current `main` of `anthropics/skills` (`skills/frontend-design/SKILL.md` line 21), not in the 2025-12-04 commit cited in F14.
- **An independent head-to-head benchmark of Next 16 against Vite 8 for a dApp-sized app.** Not found. I read both release posts; each measures against its own previous bundler.
- **Measured prevalence of DM Sans and Plus Jakarta Sans on AI-generated sites.** Searched with Exa for "analysis of fonts used by AI-generated websites (Lovable, v0, Bolt)". I found only vendor or practitioner assertions (Sailop, uxskill.laithjunaidy.com) and a Swiss agency article (digitalawards.ch, 2026-07-31). That article cites a "Stack-Overflow-Umfrage unter 1'200 V0-Nutzern, Mai 2026" and a "Lovable v1.4 Internal Analysis" with no link or data, so I could not verify them and did not use them.
- **Material Design's dark theme guidance (`#121212`, opacity levels).** `m2.material.io/design/color/dark-theme.html` now serves a "Material 2 is no longer maintained" stub, fetched via WebFetch and Exa. I used Apple's HIG instead.
- **A published RainbowKit 3.x.** Searched npm dist-tags, the npm search API ("rainbowkit"), GitHub releases and the `main` package.json. Nothing found.
- **Harmonizer's licence.** `gh api repos/evilmartians/harmonizer` returns no licence. The web app has no descriptive text (WebFetch).
- **Whether FFL fonts may be uploaded to a Claude Design canvas.** Resolved at verification. FFL 2.0 §02 forbids making the files available to "any other person or entity", including through a "platform" or a "design tool". The self-hosting grant covers only "your own servers or infrastructure" (F12).
- **Tree-shaken chart and motion sizes inside a real Vite build.** Not measured, because I did not run projects. Only bundlephobia's whole-package figures and Motion's own figures are reported.
- **Hugeicons' free-set licence text.** Only the npm licence field ("MIT") was read. At verification, `@hugeicons/core-free-icons` 4.3.5 declares MIT, and GitHub reports MIT for `hugeicons/hugeicons-react`. The licence text itself was still not read.

## Weak spots of this dossier

- **Versions are a snapshot** of the afternoon of 2026-09-30, and `next` 16.3.8 was published during the session.
- **The contrast figures are my own computation.** The OKLCH conversion reproduces known hex values, but gamut clipping is naive, and nothing was measured in a browser. A second, independent script at verification gave the same eight ratios to two decimals. Three of the colours, Tailwind `blue-500`, `violet-500` and `indigo-500`, are outside the sRGB gamut.
- **The `tnum` check** covers 14 Google Fonts builds at the default instance only, without rendering. An independent re-run at verification reproduced every result.
- **Several key claims rest on single sources.** The convergence study is anonymous and small (3 AI outputs). The WSJ gives no method for "16,000 websites". Google's `popularity` field is undocumented.
- **Wallet-kit theming depth comes from docs and type definitions.** No kit was installed or rendered, and pnpm's peer-dependency behaviour was not tested. At verification, pnpm's docs give `strictPeerDependencies` "Default: **false**", so a mismatch warns rather than fails. Runtime behaviour remains untested.
- **The wallet findings cover EVM kits built on wagmi only.** The owner's memory lists a Cardano x402 track for TOKEN2049 Origins, and Ledger OP3N's chain is not fixed. Non-EVM connect UIs (CIP-30 wallets, XRPL, Hedera) were not researched here.
- **The Next versus Vite recommendation** rests on documented constraints and the owner's recent build, not on a timed comparison.
- **Some pages were read only through the WebFetch summariser:** Tailwind compatibility, Vercel Vite, Vite `appType`, WCAG 2.3.3, the Reown theming summary, the Next 16 blog and the Radix scale page. I re-checked the others that carry quotes on raw text: Butterick, NN/g, Motion, axe, WCAG 2.2, Tailwind theme, Utopia, React advisory and the Lucide guide. Verification note: all seven summarised pages were re-read at verification, on raw HTML, the docs-repository source files or the `.md` endpoints, and every quote in them holds.
- **Overlap with other dossiers.** Font tell lists (FD10-F20, FD02-F13), shadcn default classes (FD10-F07, FD10-F08), dark-grey contrast (FD10-F24) and Anthropic's guidance history (FD15) are cross-referenced, not repeated. Where numbers overlap (`zinc-500` on `zinc-950` 4.12:1), they agree.

## Dropped at verification

None. Every original finding held at least in part. The ten corrections are marked in place with "(corrected: …)".

## Verification notes

**Method.** Every cited source was re-opened in this session, and nothing was taken from the dossier's own excerpts.
- **npm.** All 32 packages in F01's 28 rows, plus `@fontsource/inter`, `@adobe/leonardo-contrast-colors`, `@reown/appkit-adapter-wagmi`, `@base-ui-components/react`, `@dynamic-labs-sdk/react-hooks` and `@hugeicons/core-free-icons`, were re-queried from `registry.npmjs.org` with a Python script: `dist-tags`, `time[version]`, licence and peers.
- **GitHub repositories.** Files were read as raw files, through `raw.githubusercontent.com` or `gh api`, never through rendered summaries. That covers `vercel/next.js` canary docs and templates, `vitejs/vite`, `tailwindlabs/tailwindcss.com` docs sources, and `shadcn-ui/ui` (changelogs, `init.ts`, `apply.ts`, `preset.ts`, `defaults.ts`, `transform-style-map.ts`, `registry/themes.ts`, `registry/config.ts`, style CSS files, `theming.mdx`, chart docs). It also covers `reactjs/react.dev`, `wevm/wagmi`, `rainbow-me/rainbowkit`, `pbakaus/impeccable`, `anthropics/skills` at 0075614 and at `main`, `google/fonts`, `tradingview/lightweight-charts`, `recharts/recharts`, `airbnb/visx`, `dequelabs/axe-core`, `radix-ui/website`, `adobe/leonardo`, `evilmartians/harmonizer`, `system-fonts/modern-font-stacks`, the icon-set repositories, `HTTPArchive/almanac.httparchive.org`, `mdn/content` and `pnpm/pnpm.io`.
- **Issues, pull requests and advisories.** Read with `gh api`: RainbowKit #2626, PR #2591, ConnectKit #473, and facebook/react's security advisories.
- **Web pages.** Read as raw HTML with `curl`, or with Exa fetch where curl got a JavaScript shell. Covered: Fontshare licence and FAQ, the WSJ via archive.is, the convergence study, Sailop, Utopia, NN/g, Butterick, Motion, Deque, W3C WCAG 2.2, WCAG 2.3.3 and WCAG 3.0, the OFL and its FAQ, Velvetyne, Collletttivo, Vercel, ConnectKit, Reown, Privy and Dynamic `.md` endpoints, the Apple HIG JSON, Radix Colors, the Material 2 stub, and Bundlephobia's API.
- **The Design type's `craft.md`.** Read with the Artifact tool.
- **Local files.** The owner's Orma repo was read: `app/package.json`, `pnpm-lock.yaml`, `components.json`, `DESIGN.md`, `docs/20-SPEC-FRONTEND.md`, `app/public/assets/README.md`, and git log and commit cda7f4f.
- **Measurements redone independently.** The `tnum` check ran on 14 fonts downloaded from google/fonts `main` with my own fontTools script, and all results match. The WCAG contrast table was recomputed with my own OKLCH-to-sRGB script, and all eight ratios and three validation values match. Both scripts are saved as `_scripts/fd16/verify_tnum.py` and `_scripts/fd16/verify_contrast.py`, next to the researcher's. Orma's Plex subsets were inspected with fontTools 4.66.1 and brotli 1.2.0 in a throwaway venv, deleted afterwards. The Google Fonts catalogue JSON was re-parsed. GitHub code search for `8884d8` returned 18 again. Bundlephobia sizes match to the byte.

**The corrections that matter for the skill's rules:**
- F03: the RSC CVE series did not end in January 2026. It ran to 2026-07-21, eight advisories in all.
- F07: shadcn's "frozen at init" is contradicted by `shadcn apply`.
- F12: FFL 2.0 §02 does address public repositories and third-party design tools.
- F20: Remix Icon's licence bans logo, brand-mark and app-icon use (§3.3), and Phosphor's pinned package has 1,512 icons, not 1,248.
- F21: layout and drag need `domMax`, not `domAnimation`.
- F23: the shadcn CLI installs greyscale chart tokens. The indigo `--chart-1` is a docs-only palette, and the indigo lives in the dark `--sidebar-primary`.
- F29: Leonardo 1.1.0 dates from 2026-02-18.
- F02 summary: Orma resolved React 19.3.0.
- F13 summary: Inter's value 5 is fourth by ordinal.

**The additions:**
- F30: OFL subsetting and Reserved Font Names. It turned up a live case: the owner's public Orma repo commits Google-served latin subsets of IBM Plex that keep the reserved name "Plex".
- F31: the Design type's own craft file recommends grain and gradient meshes when no brand is given.

**Sources I could not open or confirm:**
- The Design type release id "1790780428-0f80" cited in F14. The Artifact read returned the file without a release id.
- The FD02, FD07, FD10 and FD15 cross-references. They were not re-verified here, because they belong to other dossiers.
- Whether Google Fonts or IBM has a separate agreement covering Google's served Plex subsets (F30).
- The Hugeicons licence text; only metadata was read.
- The WebFetch summary of MDN's `oklch()` page cited in Contradiction 8 is a summariser output, not a source that can be re-opened. The webstatus.dev dates the dossier uses instead are verified.

**Residual doubts:**
- The three Tailwind 500-step contrast ratios depend on sRGB clipping. Those colours are outside the sRGB gamut, and browsers on P3 displays render them differently.
- `@phosphor-icons/react`'s count assumes that every `dist/csr/*.es.js` module is one icon.
- The ConnectKit-on-React-19 runtime is untested under pnpm.
- The wagmi, RainbowKit and shadcn facts rest on `main` branches that can move after 2026-09-30.
- The shadcn claim about the CLI's installed chart tokens rests on reading `buildRegistryTheme` and the live `r/colors/neutral.json`, not on running `shadcn init`, since running projects was out of scope.
