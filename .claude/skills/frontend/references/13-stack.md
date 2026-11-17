# Stack: framework, components, icons, fonts, charts and wallet kits

Read when: P5 scaffold (FE-08 shell and first screen), any task that adds a dependency, a component library, an icon
set, a font loader, a chart or a wallet connection, and every mode B pass on an existing app.

## Purpose
The stack is a profile field, not a habit. Default to a client-only Vite SPA; use Next only when the spec needs a
server; keep small mode and existing apps plain. Pin exact versions. Kits are code generators or primitives styled
from the tokens, never shipped untouched. Icons are rare and labelled, charts are recoloured, and wallet UI is the
project's own dialog on the chain's hooks. Hosting has no research behind it yet: see Gaps.

## Rules

### SK-01 - Take the stack from the profile
- **Rule:** Read `profile.stack`. `vite-react` (default when no server is needed): Vite 8.3.1, React 19.3.0 and
  Tailwind 4.3.3, built to static files. `next`: Next 16.3.8, only when the spec needs server code (an API proxy that
  holds a key, server rendering for SEO). `static-html`: plain HTML and CSS. `existing`: the app's own stack (SK-04).
- **Why:** A Vite SPA is the smaller surface; Next's static export rejects Server Actions, cookies, rewrites,
  redirects, headers, proxy and default image optimisation [FD16-F02]. A client-only build sidesteps the RSC CVE series
  and wagmi's hydration flash [FD16-F03]. The owner's Orma build ran this stack (Vite 8.3.0) on this machine
  [FD16-F02].
- **Check:** owner review (stack recorded in the profile).
- **Not when:** the owner overrides, recorded (SK-16).

### SK-02 - Pin exact versions; check peers; make the install reproducible
- **Rule:** Write exact versions (no `^`) and commit the lockfile. Re-query the registry on the day. Read a kit's peer
  ranges before installing it. A teammate installs with `pnpm install --frozen-lockfile` and runs the app with no
  machine-local configuration.
- **Why:** `next` 16.3.8 was published during the research session [FD16-F01]. RainbowKit peers wagmi 2 and
  ConnectKit React 17/18 [FD16-F24]. `@meshsdk/react`'s `latest` is a beta pinning another wallet package [FD18-F04].
  Dev B must run the setup alone; a machine-local hook already failed him once [FD13-F27].
- **Check:** `pnpm install --frozen-lockfile` exits 0 on a clean checkout.
- **Not when:** no exception.

### SK-03 - Use Next only within its constraints
- **Rule:** Without a server, set `output: 'export'` and treat its unsupported list (dynamic routes without
  `generateStaticParams()`, Route Handlers that rely on the request, Server Actions, cookies, rewrites, redirects,
  headers, proxy, ISR, the default image loader, draft mode, intercepting routes) as a build gate. With wagmi under
  SSR, set `ssr: true` and render wallet state after mount.
- **Why:** Next's static export lists every server feature as unsupported [FD16-F02]. wagmi under SSR mismatches on hydration unless `ssr: true` is set, and then shows empty connection data until the client store hydrates [FD16-F03].
- **Check:** the project's build command exits 0; render.console.
- **Not when:** the stack is not `next`.

### SK-04 - Keep small mode and existing apps plain
- **Rule:** Small mode: one static page, no framework, CSS generated from the tokens, self-hosted fonts. Existing app
  (mode B): keep its stack and delivery rules (BNB: one HTTP response, no CDN, no external font, favicon inlined as a
  data URI); its running data is the contract. In both, run /frontend's own axe pass, meet contrast and target size,
  and pre-empt /harden's FE-19 fixes: `lang`, linked labels, names on icon-only buttons, `type="button"`.
- **Why:** /harden's frontend lens loads only for React, Next, Vue, Svelte or Vite, so the BNB board and a
  no-framework page get no axe floor from it [FD13-F22]. The Origins plan is a static page of about 1.0-1.5 h
  [FD13-F26]. The BNB board is one response with zero external resources [FD13-F28]. An existing app's contract is its
  own data [FD13-F20].
- **Check:** a11y.axe; a11y.targets; ip.hotlinks.
- **Not when:** no exception.

### SK-05 - Start empty and delete starter residue
- **Rule:** Use create-next-app's empty templates (`app-empty`, `app-tw-empty`) or delete create-vite's demo files.
  Grep for `Geist`, `#aa3bff`, "Create Next App" and "Vite + React" and remove every hit.
- **Why:** The starters, not Tailwind, bring Geist and a purple accent [FD16-F04].
- **Check:** `tells` (rule SL-G02).
- **Not when:** a Vercel-owned brand, where Geist is the brand font [FD16-F04].

### SK-06 - Use shadcn as a code generator, or build on primitives
- **Rule:** `shadcn` 4.21.0: `init -t vite -b base -p <own preset>` with `font`, `fontHeading` and `iconLibrary` set
  on purpose; never `--defaults`. Commit and diff before any `shadcn apply`, which reinstalls every component. To own
  the whole style layer, use unstyled primitives (`@base-ui/react` 1.8.0 or `react-aria-components` 1.21.1) styled
  from the tokens. Install current names only, never `@base-ui-components/react`. Tokens: 05-tokens.md TK-06.
- **Why:** `--defaults` means base-nova with Lucide and Geist; 5 of 8 presets use Lucide and 4 use Inter [FD16-F08].
  Style, base colour and CSS-variable mode change only through a full reinstall [FD16-F07]. The levers are the tokens
  and the inlined class files [FD16-F09]. The old Base UI name is deprecated [FD16-F10].
- **Check:** `tells` (rule SL-T11).
- **Not when:** no exception.

### SK-07 - Restyle kit interactions before shipping
- **Rule:** Replace `transition-all` with named properties, add `active:scale-[0.97]`, replace `hover:bg-primary/80`
  or `/90` with a contrast-increasing hover token, and use transitions instead of keyframe utilities on toggleable
  overlays (08-motion.md).
- **Why:** The untouched Button has `transition-all`, an alpha hover that lowers contrast and no press state
  [FD03-F22] [FD04-F25]; overlays run 150 ms `ease` keyframes [FD03-F22].
- **Check:** `tells` (rules SL-T11, SL-T14, SL-MO1).
- **Not when:** no kit in the project.

### SK-08 - No icons in content; a label on every icon used
- **Rule:** Content sections carry no icons. Controls pair an icon with a visible label, or an `aria-label` when it
  stands alone. One set at one weight, matched to the type (Phosphor Light with a light face, Radix 15 px for dense
  data), or 3 to 6 custom glyphs. Swapping Lucide for Tabler does not change the look. Never derive the logo from an
  icon set.
- **Why:** A text label must accompany an icon; an unclear icon is "visual noise" [FD16-F19]. Lucide and Tabler share
  drawing rules; Remix Icon's licence bans logo use [FD16-F20].
- **Check:** `tells` (rules SL-T08, SL-T10); a11y.axe.
- **Not when:** universal glyphs (search, close, menu) on controls [FD16-F19].

### SK-09 - Keep every asset's licence and notice
- **Rule:** Record each icon set, image, chart library and font in `design/provenance.json`. Keep Lucide's ISC and
  MIT notices. Font Awesome's CC BY attribution sits in file comments that SVGO strips: add the notice elsewhere when
  you optimise. Never ship a customer's images, icons or illustrations.
- **Why:** Web assets default to all rights reserved; Lucide carries ISC and MIT notices, and Font Awesome's CC BY attribution lives in comments an optimiser strips [FD09-F21]. Customer images, icons and illustrations carry no licence for us [FD09 Policy table].
- **Check:** ip.provenance.
- **Not when:** no exception.

### SK-10 - Load fonts from your own origin
- **Rule:** Load faces from local woff2 files, `@fontsource(-variable)` 5.3.0 or `next/font` (which downloads at
  build time), never from a CDN at runtime. For a live stage or venue demo, test at the presenting machine's zoom.
  Licences, RFNs and tabular figures: 05-tokens.md.
- **Why:** Self-hosting removes the network risk that made Orma ban web fonts; `next/font/google` needs network at
  build [FD16-F17]. A German court awarded EUR 100 in damages and an injunction against a Google Fonts hotlink [FD09-F20]. A live stage needs self-hosted fonts and a
  zoom test [FD13-F27].
- **Check:** ip.hotlinks; render.fonts.
- **Not when:** no exception.

### SK-11 - Choose charts by data shape and recolour them
- **Rule:** Time series: `lightweight-charts` 5.2.1, with its NOTICE text and a link to tradingview.com reachable on
  the page (`attributionLogo: true` covers the link), and `layout.fontFamily`, `textColor` and `background` set from
  the tokens. Bars and lines in a shadcn project: Recharts 3.10.1 through shadcn chart with the project's `--chart-*`
  tokens. Bespoke: `@visx/xychart` 4.0.0. ECharts 6.1.0 only for chart types the others lack. No `#8884d8` or
  `#82ca9d`. Tabular figures on axes and tooltips.
- **Why:** Licence and defaults [FD16-F22]. Data shapes, sizes, the Recharts example colours and both shadcn chart
  palettes [FD16-F23].
- **Check:** `tells`; ip.provenance (chart notice).
- **Not when:** no chart.

### SK-12 - Animate with CSS first
- **Rule:** CSS transitions and `@starting-style` for entry and state changes. Add `motion` 13.4.6 only for exit,
  layout and drag, imported from `motion/react` as `m` inside `LazyMotion` under `MotionConfig reducedMotion="user"`:
  `domAnimation` (+15 kB) for exit, variants and tap, hover and focus; `domMax` (+25 kB) for layout and drag. When to
  animate: 08-motion.md.
- **Why:** Bundle costs, features per bundle and reduced-motion behaviour [FD16-F21]; `motion` is the new name of
  framer-motion [FD16-F10]; CSS before WAAPI before JS libraries [FD03-F28].
- **Check:** `tells` (rule SL-MO5).
- **Not when:** no exception.

### SK-13 - EVM wallets: the project's own dialog on wagmi
- **Rule:** Default: `wagmi` 3.7.7, `viem` 2.57.1 and `@tanstack/react-query` 5.104.0 with the project's own connect
  dialog. If a sponsor requires a prebuilt modal: RainbowKit 2.2.11 with `wagmi` pinned at 2.19.5, the v2 hook names
  (`useAccount`, not `useConnection`) and a full custom `Theme` (fonts, radii, shadows, overlay blur, colours). Avoid
  ConnectKit on React 19. Reown AppKit only when a sponsor requires it: ship "Portions © 2025 Reown, Inc. All Rights
  Reserved", the licence copy and its branding, accept that it must use Reown's network, and never patch its files.
  States: 07-states-web3.md.
- **Why:** Versions and peers [FD16-F24]; theming depth per kit, own dialog first [FD16-F25]; AppKit's licence
  [FD16-F26].
- **Check:** `tells` (rule SL-G03); ip.provenance.
- **Not when:** no EVM chain.

### SK-14 - Cardano: the project's own dialog on raw CIP-30
- **Rule:** Build the connect dialog on CIP-30; never ship Mesh's `CardanoWallet` or the Cardano Foundation's
  `ConnectWalletButton` in a judged demo. One transaction SDK: `@lucid-evolution/lucid` 0.6.5 or `@meshsdk/core`
  1.9.1. Never install `@meshsdk/react` or `@meshsdk/wallet` unpinned; if Mesh React is required, pin `core`,
  `wallet`, `common` and `react` together at 1.8.14. Optional: `@cardano-foundation/cardano-connect-with-wallet-core`
  0.2.12 for the wallet registry; `bech32` 2.0.0 with a length limit above 90. Avoid `lucid-cardano` (deprecated).
- **Why:** The prebuilt dialogs show "Powered by Mesh SDK", `mesh-dark`, an `alert(` fallback and "Awesome DApp", and
  hide failures [FD18-F05]. Versions, licences and the beta trap [FD18-F04] [FD18 Deliverable].
- **Check:** `tells` (rule SL-G03).
- **Not when:** no Cardano.

### SK-15 - Ledger: the Device Management Kit, from a click
- **Rule:** EVM: `@ledgerhq/device-management-kit` 1.10.0 with `rxjs` 7.8.2 exactly,
  `@ledgerhq/device-transport-kit-web-hid` 1.2.4 (`@ledgerhq/device-transport-kit-speculos` 1.2.1 for work without a
  device), `@ledgerhq/device-signer-kit-ethereum` 1.18.1 and `@ledgerhq/context-module` 2.6.0. One DMK instance;
  subscribe to the observable, never a promise wrapper. Start discovery from a click, serve over HTTPS or localhost,
  feature-detect `navigator.hid`. Cardano with a Ledger: the user's CIP-30 wallet, or dApp-side
  `@cardano-foundation/ledgerjs-hw-app-cardano` 8.0.0 or raw APDUs through the DMK, tested on a real device before
  recording. `@ledgerhq/ledger-wallet-provider` 1.4.3 only with Ledger's partner configuration (its v2 packages peer
  DMK 1.9.0 exactly). Name the device in text; no Ledger logo.
- **Why:** LedgerJS is deprecated and no Cardano signer kit exists [FD18-F08]. Promise wrappers discard the
  interaction states [FD18-F09]. WebHID needs desktop Chromium, a secure context and a user gesture [FD18-F10].
  Minswap drives a Ledger from the dApp [FD18-F27]. Wallet Provider needs partner keys [FD21-F19] [FD18 Deliverable].
  Ledger's marks [FD18-F13].
- **Check:** `tells`; owner review (device test).
- **Not when:** no Ledger flow.

### SK-16 - Record every stack override
- **Rule:** A deviation from the profile's stack, a kit the rules exclude or a font rule is an owner decision written
  with its date in the profile or DESIGN.md. No silent drift.
- **Why:** The XRPL (Orma) spec banned component libraries and web fonts, then the build switched to shadcn and
  self-hosted Plex mid-event; rules need an override record [FD13 Contradictions between sources].
- **Check:** owner review.
- **Not when:** no exception.

### SK-17 - Host per profile and verify the deployed URL
- **Rule:** Deploy to `profile.hosting`. A Vite SPA with deep links on Vercel needs one rewrite in `vercel.json`;
  offline, run the build and `vite preview` (SPA fallback). Keep the link up through judging and respect deploy
  freezes. Check every route and external link by rendering it, not by status code. Fetch `/icon.svg` and expect
  `Content-Type: image/svg+xml`.
- **Why:** Vercel and `vite preview` [FD16-F02]. Links must stay accessible through judging [FD13-F13]; BNB allows no
  deploys from 4 to 8 Oct [FD13-F28]. A single-page app answers 200 for routes it renders as not-found [FD13-F24]. The
  SVG favicon MIME type [FD12-F22]. What else to verify per host: Gaps.
- **Check:** render.requests; brand.favicons; owner review (deployed preview at H3).
- **Not when:** `hosting: local`.

## Procedure

1. **Decide** from `profile.stack` (SK-01) and record any override (SK-16). Mode B: inventory the existing stack and
   its delivery rules first (SK-04).
2. **Scaffold** with the pins below (SK-02, SK-05); Tailwind resets and tokens come from 05-tokens.md.
3. **Components:** shadcn with an explicit preset, or primitives (SK-06); restyle interactions (SK-07).
4. **Charts:** load the built-in dataviz skill before chart code, then SK-11 (ARCHITECTURE section 4, P5).
5. **Wallets:** SK-13, SK-14, SK-15; states and copy in 07-states-web3.md.
6. **Untouched-kit checklist**, all mechanical [FD16 Default stack and de-defaulting checklist]:
   - nothing of the framework starter remains: its fonts, accent colour, page metadata and demo CSS are replaced
     (`tokens.leak` and `tells` rule SL-G02 name each leftover);
   - shadcn tokens differ from the registry and docs defaults (05-tokens.md TK-06); `iconLibrary`, `font` and
     `fontHeading` set on purpose;
   - every icon labelled, one set, one weight, no icon-in-a-box feature rows;
   - duration and easing tokens replace the framework's default duration and curve; no looping attention
     animation from the utility kit; no scroll reveals (`08-motion.md`);
   - chart colours from tokens, chart fonts set with tabular figures, the lightweight-charts attribution present;
   - wallet UI is an own dialog, or a kit themed on every token, with any required notice shipped.
7. **Install check:** delete `node_modules`, run `pnpm install --frozen-lockfile` and the build (SK-02).
8. **Prove:** `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates render,a11y,tells,ip
   --root <repo> --profile <abs path> --serve <built dir>`.

Pins on 2026-09-30 and 2026-10-01; re-query before use [FD16-F01] [FD18 Deliverable]:

| use | package @ version | licence |
|---|---|---|
| build | `vite` 8.3.1, `@vitejs/plugin-react` 6.1.1 | MIT |
| runtime | `react`, `react-dom` 19.3.0 | MIT |
| styles | `tailwindcss`, `@tailwindcss/vite` 4.3.3 | MIT |
| server (only if needed) | `next` 16.3.8 | MIT |
| components | `shadcn` 4.21.0; `@base-ui/react` 1.8.0; `react-aria-components` 1.21.1 | MIT; MIT; Apache-2.0 |
| motion | `motion` 13.4.6 | MIT |
| icons (if any) | `@phosphor-icons/react` 2.1.10; `@tabler/icons-react` 3.48.0; `@radix-ui/react-icons` 1.3.2 | MIT |
| fonts | `@fontsource(-variable)/<family>` 5.3.0 | font's own |
| charts | `lightweight-charts` 5.2.1; `recharts` 3.10.1; `@visx/xychart` 4.0.0 | Apache-2.0; MIT; MIT |
| EVM | `wagmi` 3.7.7, `viem` 2.57.1, `@tanstack/react-query` 5.104.0 | MIT |
| Cardano | `@lucid-evolution/lucid` 0.6.5 or `@meshsdk/core` 1.9.1; `bech32` 2.0.0 | MIT or Apache-2.0; MIT |
| Ledger | DMK 1.10.0, `rxjs` 7.8.2, web-hid 1.2.4, signer-kit-ethereum 1.18.1, context-module 2.6.0 | Apache-2.0 |
| spinner delay | `spin-delay` 2.0.1 (show after 500 ms, keep 200 ms) | MIT |

## Gaps
- **Hosting has no dossier** (research/_critic-round1.md, M12). Verify per host before the event, with receipts:
  - deep links: does an unknown path serve the app or a 404, and is a fallback file or rewrite needed?
  - base path: is the site served under a sub-path that breaks root-absolute icon paths [FD12-F26]?
  - MIME types for `.svg` [FD12-F22] and `.webmanifest`; caching of the hashed OG image [FD12-F28];
  - HTTPS for WebHID [FD18-F10]; `robots.txt` leaves the favicon and home page crawlable [FD12-F29];
  - uptime and access through the whole judging window [FD13-F13], and the event's deploy freezes [FD13-F28];
  - whether the host injects scripts or external requests when `external_requests` is false;
  - build-time network for `next/font` on the host [FD16-F17].
- Wallet kits were judged from docs and registry data, never installed or rendered; ConnectKit on React 19 and the
  offline behaviour of Privy and Dynamic are untested [FD16-F24] [FD16-F25].
- Plutus V3 support in Lucid Evolution and Mesh, and every real-device Ledger flow, are unverified [FD18-F04]
  [FD18-F08]. Non-EVM wallets other than Cardano (XRPL, Hedera) were not researched [FD16 Weak spots of this dossier].
- Tree-shaken chart and motion sizes in a real Vite build were not measured; the kB figures are whole-package or
  vendor numbers [FD16-F21] [FD16-F23] [FD16 What could not be found, and how it was searched].
