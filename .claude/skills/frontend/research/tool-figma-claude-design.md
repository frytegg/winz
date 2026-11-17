# Figma MCP and Claude Design: what each adds to a hackathon build

> Code FD07 · slug tool-figma-claude-design · researched 2026-09-30 · verified 2026-09-30 · counts: verified 15 / corrected 17 / downgraded 0 / dropped 0 / added 3

## Summary

- Figma's official MCP server (beta since 4 June 2025) is remote at `https://mcp.figma.com/mcp` or local in the Figma desktop app at `http://127.0.0.1:3845/mcp`. The tools page now lists 35 tools (18 read, 11 write, 6 Weave) plus one MCP prompt. Every name in the brief exists, but `create_design_system_rules` is a prompt, not a tool (F01, F02).
- Install in Claude Code with `claude plugin install figma@claude-plugins-official` (bundles Figma's agent skills; the marketplace pins plugin 2.2.120 while the repo's `main` is at 2.2.124), or with `claude mcp add --transport http figma https://mcp.figma.com/mcp` (add `--scope user` to cover all projects). OAuth is an interactive `/mcp` step. A leftover `figma-desktop` entry hides the remote-only write tools (F06).
- The binding cost is read quota. Starter (free) gets 20 read calls a month for any seat. View or Collab seats on paid plans get 6 a month. A Dev or Full seat gets 200 a day at 10 per minute on Professional, and 200 a day at 15 per minute on Organization. Figma's own GitHub README still says 6 a month for Starter; Figma support said 6 on 29 June 2026 and 20 on 14 September 2026. Calls that fail during execution still count, and there is no usage counter (F04, F05).
- Figma's value assumes a structured Figma file (components, variables, auto layout), and we have none. There are three ways to get a live site into Figma. `generate_figma_design` is free into drafts and exempt from the standard rate limits, but needs Playwright script injection for live sites. The Chrome extension capture needs a paid plan. html.to.design gives 10 or 12 free imports per 30 days, depending on which of its pages you read. Figma's two capture paths bring in layers with "No component and styles mapping yet"; html.to.design instead creates local text and color styles (F08 to F11).
- Reading captured layers back through `get_design_context` yields a React + Tailwind intermediate that hard-codes pixel widths and, in one test, mapped `#ffffff` to `bg-white`. One practitioner's comparison page lists 82% pixel similarity for it against 94% from curated raw data, but his own experiment page shows the 82% came from an extra AI conversion to HTML, which he withdrew as an "irrelevant comparison"; the MCP code built directly scored 94 to 98%. The loss sits in re-translating the output, the step /frontend would do to map it onto project tokens (F03, F14).
- Braintrust's July 2026 eval found that designing through Figma MCP gave no fidelity gain over another design MCP: 0.744 vs 0.741 visual similarity on 40 pages, where 0.93 is the ceiling. Figma runs also had 1.9 times the run-to-run variance and took 42% longer. Canvas self-checks missed broken browser output because "the composition genuinely looks right" on the canvas (F15).
- Claude Design (Anthropic Labs, 17 April 2026) became an artifact template on 16 September 2026. In this environment it is reachable through `/design` (Claude Code 2.1.265 or later; 2.1.286 is installed) and through the Artifact tool's core "Design" and "Design System" types. It needs no setup and no extra money, but it draws on the same usage pool as Claude Code. Launch-era tests, under the old separate meter, burned 80% of a Pro weekly design allowance in about 25 minutes (the rest went on a rebuild after the reviewer wiped his work by mistake), and 77% in 5 minutes on design-system ingestion alone (F17 to F22).
- The Design type's own rules ban part of the owner's list: "gradient washes, left-border cards, emoji; Inter, Roboto, Arial". They forbid recreating "other company's proprietary design", and admit Claude's default look: "Cream, serif display and clay are your habit". They also say "NEVER VERIFY UNLESS THE USER ASKED ... (no Playwright, browser, installs)". So /frontend's Playwright loop must be stated explicitly in its own contract and run on the built site (F23 to F25). The type's long-form `craft.md` adds three things: settle the aesthetic with the user or sketch 2 to 4 directions ("this is how you get slop"); refuse to recreate "a company's distinctive UI patterns ... or branded visual elements"; and, for unbranded work only, reach for "gradient meshes, noise textures ... grain overlays", which contradicts its own trope ban and several of the owner's tells (F33 to F35).
- A handoff bundle contains a README, the full chat transcripts and HTML prototypes. Its README tells the coding agent to "ask the user to confirm" when anything is ambiguous and not to take screenshots. Anthropic has not documented the format (F28).
- DesignSync is user-gated: it runs only under a user-started `/design-sync` and a plan the user has approved (F27). The Design System type stores tokens as `{name, value, usage}` lists and cannot read DTCG maps (F26). Help Center says a shared artifact needs a Claude account to open, so an artifact link is never what the jury gets (F29).
- Recommendation:
  - Use Claude Design for pre-build direction exploration: 2 or 3 directions pinned to /hackathon's customer references, laid out as artboards.
  - Draft logo candidates as inline-SVG artboards, under an explicit usage budget.
  - Keep the repo's token file as the single source of truth, and mirror it to a Design System artifact only for browsing.
  - Keep Figma MCP out of the default path. Offer it as an optional adapter when a sponsor or teammate supplies a structured Figma file, budgeted at about 3 to 4 read calls per frame.

## Findings

### FD07-F01 — Figma's MCP server runs remotely or inside the desktop app; a free account can only use the remote one
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Figma ships one MCP server in two deployments. The remote server at `https://mcp.figma.com/mcp` is the recommended one, has "the broadest set of features", signs in through OAuth, and is available on all seats and plans. The desktop server runs inside the Figma desktop app at `http://127.0.0.1:3845/mcp`, is enabled from Dev Mode, and needs a Dev or Full seat on a paid plan. Only clients listed in Figma's MCP catalog can connect (Claude Code is listed). On the remote server every request needs a link to a frame or layer; selection-based prompting is desktop-only. The server entered beta on 4 June 2025.
- **Implication for /frontend:** If a Figma step is ever used, configure the remote server only. The request must carry a Figma URL with a node id, so a Figma file must exist before any read tool is useful.
- **Evidence:**
  - [Introduction | Developer Docs](https://developers.figma.com/docs/figma-mcp-server/) — Figma, undated page, accessed 2026-09-30 — official documentation.
    - "We strongly recommend using the Remote MCP server, which connects directly to Figma’s hosted endpoint without requiring the Figma desktop app. The remote MCP server also provides the broadest set of features."
    - "Only clients listed in the Figma MCP Catalog can connect to the Figma MCP Server."
  - [Guide to the Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server) — Figma Help Center, undated, accessed 2026-09-30 — official documentation.
    - "The remote server is available on all seats and plans."
    - "The desktop server is available on a Dev or Full seat for all paid plans."
  - [Set up the desktop server (using desktop app)](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/) — Figma, undated, accessed 2026-09-30 — official documentation.
    - "The desktop server runs locally at `http://127.0.0.1:3845/mcp`."
  - [Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) — Figma, undated, accessed 2026-09-30 — official documentation.
    - "Selection-based prompting only works with the desktop MCP server. The remote server requires a link to a frame or layer to extract context."
  - [Introducing our Dev Mode MCP server: Bringing Figma into your workflow](https://www.figma.com/blog/introducing-figma-mcp-server/) — Jake Albaugh, Figma, 2025-06-04, accessed 2026-09-30 — vendor blog.
    - "Today we’re announcing the beta release of the Figma MCP server, which brings Figma directly into the developer workflow to help LLMs achieve design-informed code generation."
- **Limits / false positives:** "Available on all seats and plans" says nothing about per-plan quotas, which are the real constraint (F04). Figma for Government is desktop-only, which does not concern this project.

### FD07-F02 — The server exposes 35 tools and one prompt; the brief's names are real, but `create_design_system_rules` is a prompt, not a tool
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The official tools page lists 18 read tools, 11 write tools, 6 Weave tools and one MCP prompt. Verified names:
  - Available on both remote and desktop: `get_design_context`, `get_variable_defs`, `get_screenshot`, `get_metadata`, `get_code_connect_map`.
  - `create_design_system_rules` is documented as an MCP prompt, and "Not all agents and clients support MCP prompts."
  - Write and code-to-design tools added in 2026, all remote-only: `use_figma` (general-purpose create, edit and inspect), `generate_figma_design` (capture live UI as layers), `create_new_file`, `upload_assets`, and `generate_diagram` (FigJam from Mermaid).
  - Other read tools now present: `download_assets` (SVG/PDF/PNG/JPG exports, remote only), `search_design_system`, `get_libraries`, `get_motion_context` and `whoami`.
  - The official plugin's `.mcp.json` (header `figma_prod@2_2_124`) names 18 tools in its `ideToolTitles` map, and `create_design_system_rules` is not among them.
- **Implication for /frontend:** Never plan a call to `create_design_system_rules` as a tool; if needed, it is an MCP prompt that Claude Code may or may not surface. The design-to-code set that a /frontend adapter would budget is `get_metadata`, `get_design_context`, `get_variable_defs` and `get_screenshot`.
- **Evidence:**
  - [Tools and prompts | Developer Docs](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) — Figma, undated, accessed 2026-09-30 — official documentation.
    - "The Figma MCP server provides tools for reading designs out of Figma, writing designs into Figma, connecting designs to your codebase, and building generative plugins and shaders."
    - "Weave tools are listed separately. The server also provides one MCP prompt."
    - "A prompt for creating a rule file that provides agents with the right context to translate designs into high-quality, codebase-aware frontend code."
    - `use_figma` row: "General-purpose create, edit, and inspect"; `generate_figma_design` row: "Generates design layers from interfaces".
  - [figma/mcp-server-guide `.mcp.json`](https://raw.githubusercontent.com/figma/mcp-server-guide/main/.mcp.json) — Figma, main branch (repo pushed 2026-09-30), accessed 2026-09-30 — the tool's own configuration file.
    - Command run: `curl -sL https://raw.githubusercontent.com/figma/mcp-server-guide/main/.mcp.json`. Output: `"X-Figma-Plugin-Bundle": "figma_prod@2_2_124"`, and `ideToolTitles` keys `add_code_connect_map`, `create_new_file`, `generate_diagram`, `generate_figma_design`, `get_code_connect_map`, `get_code_connect_suggestions`, `get_context_for_code_connect`, `get_design_context`, `get_figjam`, `get_libraries`, `get_metadata`, `get_screenshot`, `get_variable_defs`, `search_design_system`, `send_code_connect_mappings`, `upload_assets`, `use_figma`, `whoami`.
- **Limits / false positives:** The page is undated and has grown fast (Weave tools, shaders, generative plugins). Re-check names before relying on them. The `ideToolTitles` map is a display-name map and may not list every tool the server exposes. Verification note: "added in 2026" was unsourced; the README history supports it. The README's tool list at commit 83b11c0 (2026-02-13) names eight tools and none of `generate_diagram`, `generate_figma_design`, `create_new_file` or `upload_assets`. `generate_diagram` and `generate_figma_design` are listed from 2026-02-27, `create_new_file` from 2026-03-25, and a Figma blog post of 2026-01-26 ("Think outside of the box—with Claude and FigJam") already describes FigJam diagrams from the MCP app in Claude. No dated source was found for `upload_assets`. The marketplace-pinned `.mcp.json` (commit 17292073) sends `figma_prod@2_2_120` with the same 18 titles.

### FD07-F03 — `get_design_context` returns React + Tailwind by default, and Figma's own rules say to treat it as a representation and to add no icon package
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** By default the design-context tool emits React + Tailwind, customisable by prompt. Figma's recommended agent rules in its guide repository say the output is "a representation of design and behavior, not as final code style". They forbid adding icon packages because assets come from the Figma payload, and say that without Code Connect "the model is guessing".
- **Implication for /frontend:** These vendor rules independently back two anti-slop rules. There is no default icon package (tell 10, Lucide everywhere), and no framework defaults left untouched (tell 11); values come from the design source and are mapped onto the project's tokens. If an adapter ever consumes `get_design_context`, it must translate utility classes into the project's tokens, never paste them.
- **Evidence:**
  - [Tools and prompts | Developer Docs](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) — Figma, undated, accessed 2026-09-30 — official documentation.
    - "By default, the output is React + Tailwind, but you can customize it through your prompt."
    - "Recommended to keep on: only turn it off if you're concerned about token limits." (about `get_screenshot`)
  - [figma/mcp-server-guide README](https://github.com/figma/mcp-server-guide/blob/main/README.md) — Figma, README last changed 2026-07-06 (commit a72c41ef), accessed 2026-09-30 — the tool's own repository.
    - "Treat the Figma MCP output (React + Tailwind) as a representation of design and behavior, not as final code style."
    - "IMPORTANT: DO NOT import/add new icon packages, all the assets should be in the Figma payload"
    - "This is the best way to get consistent component reuse in code. Without it, the model is guessing."
- **Limits / false positives:** These are vendor recommendations, not measured effects. They apply when a designed Figma file exists.

### FD07-F04 — Read quota: 20 calls a month on Starter for any seat, 6 a month for View or Collab seats on paid plans, 200 a day for paid Dev or Full seats
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The rate-limit table has the following cells:
  - Starter: "Up to 20/month". The cell spans both seat rows, so it covers every seat.
  - View and Collab seats on Professional, Organization or Enterprise: "Up to 6/month".
  - Dev and Full seats: Professional "Up to 200/day" at "10/min"; Organization "Up to 200/day" at "15/min"; Enterprise "Up to 600/day" at "20/min".

  Rate limits apply to read tools. `add_code_connect_map`, `create_new_file` and `whoami` are listed as exempt, and "Figma reserves the right to change rate limits." The pricing page repeats "20 tool calls / month" for Starter and "200 tool calls / day and 10 calls / min" for Professional. It renders Professional seat prices as Full "$16/mo", Dev "$12/mo" and Collab "$3/mo" with its Monthly/Annual toggle in the default state, whose label reads "Show annual billing prices: Annual selected". These are therefore per-month prices under annual billing. The monthly-billing prices are filled in client-side from `{price}` templates and were not visible in the static HTML. (corrected: the billing interval can be read from the toggle's aria-label; the dossier said it could not be determined)
- **Implication for /frontend:** Figma's own recommended flow fetches `get_design_context` and then `get_screenshot`, and adds `get_metadata` when a response is truncated. With `get_variable_defs` for tokens, one frame therefore costs 2 reads at minimum and typically 3 or 4 (an inference from the flow, not a Figma figure). The free tier covers roughly five frames a month across all of the owner's projects. Any Figma-driven build needs a paid Dev or Full seat.
- **Evidence:**
  - [Rate limits & access | Developer Docs](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) — Figma, undated, accessed 2026-09-30 — official documentation.
    - Command run: `curl -sL` on the page, then a Python parse of the `<table id="rate-limits-tier-table">`. Output: `<td rowspan="2">Up to 20/month</td>`, and the Dev/Full row `Up to 200/day<br>10/min | Up to 200/day<br>15/min | Up to 600/day<br>20/min`.
    - "Per-minute rate limits apply in addition to daily or monthly tool call limits."
    - "Rate limits apply to Figma MCP server tools that read data from Figma. Some tools, such as those that write to Figma files, are exempt from the rate limits."
    - "Figma reserves the right to change rate limits."
  - [Plans & Pricing | Figma](https://www.figma.com/pricing/) — Figma, accessed 2026-09-30 — vendor pricing page.
    - "Let AI agents access Figma context to generate code and make edits to Design, FigJam, Slides, and Make files. Rate limits vary by seat and plan." with `"starterPlan":{"hasFeature":true,"text":"20 tool calls / month"}` and `"professionalPlan":{"hasFeature":true,"text":"200 tool calls / day and 10 calls / min"}` in the page data.
    - Professional key feature: "Advanced Dev Mode inspection and MCP Server".
    - Verification command: Python search of the downloaded page for toggle labels and price fields. Output: `aria-label="Show annual billing prices: Annual selected"`, then `Full seat` `$16` `/mo`; the data fields `monthlyPrice` and `yearlyPrice` hold `{price}` templates.
  - [figma/mcp-server-guide README](https://github.com/figma/mcp-server-guide/blob/main/README.md) — Figma, accessed 2026-09-30.
    - "Run get_design_context first to fetch the structured representation for the exact node(s)." / "Run get_screenshot for a visual reference of the node variant being implemented."
- **Limits / false positives:** The limits changed during 2026 (F05). An automated summariser (WebFetch) misread the Organization row as 600/day; the raw HTML was used instead.

### FD07-F05 — Figma's own sources disagree on the Starter quota, and the quota cannot be watched
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The official README (last changed 2026-07-06) still limits Starter users to 6 calls a month, while the developer docs and the pricing page say 20. Figma community support wrote "6 tool calls per month" on 29 June 2026 and "20 tool calls per month" on 14 September 2026. The allowance therefore appears to have risen between those dates, without the README being updated. Other quota facts:
  - It resets monthly on the billing cycle.
  - The error message does not give the reset date.
  - Extra calls cannot be bought without upgrading.
  - Per Figma staff, a call that reaches the server and fails during execution still counts.
- **Implication for /frontend:** A Figma step cannot be planned on the free tier. The budget is small, invisible, and failed calls consume it. If an adapter runs, it calls `whoami` first (exempt), reports the seat and plan, and stops after a fixed number of reads.
- **Evidence:**
  - [figma/mcp-server-guide README](https://github.com/figma/mcp-server-guide/blob/main/README.md) — Figma, accessed 2026-09-30 — the tool's own repository.
    - "Users on the Starter plan or with View or Collab seats on paid plans will be limited to up to 6 tool calls per month."
    - Command run: `gh api "repos/figma/mcp-server-guide/commits?path=README.md&per_page=10"`. Latest entry: `{"date":"2026-07-06T11:44:59Z","msg":"Add video interaction mapper community skill (#71)...","sha":"a72c41ef"}`.
  - [When does the Figma MCP tool call limit reset?](https://forum.figma.com/report-a-problem-6/when-does-the-figma-mcp-tool-call-limit-reset-55405) — Celine_, Figma Community Support, 2026-06-29, accessed 2026-09-30 — vendor support forum.
    - "On the Starter plan, the limit resets monthly, aligned with your billing cycle."
    - "If you're on a Starter plan (6 tool calls per month), upgrade to a Pro, Organization, or Enterprise plan (with a Full or Dev seat) will provide a higher limit."
    - "Apologies that the error message doesn't show the exact reset date!"
  - [Starter plan MCP limit reached — need usage count and reset date](https://forum.figma.com/report-a-problem-6/starter-plan-mcp-limit-reached-need-usage-count-and-reset-date-57969) — Celyn_L, Figma Community Support, 2026-09-14, accessed 2026-09-30 — vendor support forum.
    - "Your understanding is correct - users on the Starter plan can make up to 20 tool calls per month, and this allowance is separate from Figma AI credits."
  - [Does education plan have mcp call limit](https://forum.figma.com/report-a-problem-6/does-education-plan-have-mcp-call-limit-51874) — adamsmasher, Figma staff, 2026-05-21, accessed 2026-09-30 — vendor support forum.
    - "If the MCP does receive the request and generates an error doing execution (as opposed to an auth error), then it does count against the limit."
- **Limits / false positives:** The forum answers are staff statements (grade D on their own) and serve only to date the change. The grade rests on the README-versus-docs disagreement, both of which are grade A.

### FD07-F06 — Installing in Claude Code takes one plugin command or one `claude mcp add`; a leftover desktop entry hides the write tools
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The setup steps, as documented:
  1. Preferred: `claude plugin install figma@claude-plugins-official`, which adds the MCP server settings and Figma's agent skills.
  2. Manual alternative: `claude mcp add --transport http figma https://mcp.figma.com/mcp`, or with `--scope user` to cover every project.
  3. Restart Claude Code, open `/mcp`, choose Authenticate, then Allow Access.

  Anthropic's official marketplace pins the `figma` plugin to figma/mcp-server-guide at commit 17292073 (2026-09-22, "skills: Sync skills from master and bump to 2.2.120"). At that commit `plugin.json` reports version 2.2.120 and `.mcp.json` sends `figma_prod@2_2_120`. The manifest on `main` reports 2.2.124, so a marketplace install lags `main`. (corrected: 2.2.124 is the version on `main`, not the pinned version the marketplace installs) The documented pitfall: if a desktop-server entry is also configured, the client may send calls to the desktop server "and never load the remote-only tools". The fix is `claude mcp remove figma-desktop` followed by a restart.
- **Implication for /frontend:** An adapter's setup check must cover three things: (1) authentication was done interactively before any autonomous run; (2) `/mcp` lists `use_figma` or `generate_figma_design` when those are needed; (3) no `http://127.0.0.1:3845/mcp` entry exists.
- **Evidence:**
  - [Set up the remote server (recommended)](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) — Figma, undated, accessed 2026-09-30 — official documentation.
    - "claude plugin install figma@claude-plugins-official"
    - "claude mcp add --transport http figma https://mcp.figma.com/mcp"
    - "claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp"
    - "Type`/mcp` in Claude to manage your MCP Servers and select figma." / "Select Authenticate." / "Click Allow Access."
  - [Set up the desktop server (using desktop app)](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/) — Figma, accessed 2026-09-30.
    - "claude mcp add --transport http figma-desktop http://127.0.0.1:3845/mcp"
  - [Code to canvas | Developer Docs](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/) — Figma, accessed 2026-09-30.
    - "This is the most common cause. If you set up the desktop server previously, that entry stays in your client configuration."
    - "your client may resolve Figma tool calls to the desktop server and never load the remote-only tools."
    - "claude mcp remove figma-desktop"
  - [anthropics/claude-plugins-official marketplace.json](https://raw.githubusercontent.com/anthropics/claude-plugins-official/HEAD/.claude-plugin/marketplace.json) — Anthropic, accessed 2026-09-30 — marketplace file.
    - Command run: download and filter for `figma`. Output: `"name": "figma"`, `"url": "https://github.com/figma/mcp-server-guide.git"`, `"sha": "172920731eedf414e9b22ae60017d9a5b6c9f81f"`.
  - [figma/mcp-server-guide `.claude-plugin/plugin.json`](https://raw.githubusercontent.com/figma/mcp-server-guide/main/.claude-plugin/plugin.json) — Figma, accessed 2026-09-30.
    - Output: `"name": "figma"`, `"version": "2.2.124"` (on `main`).
    - Verification command: `gh api "repos/figma/mcp-server-guide/commits/172920731eedf414e9b22ae60017d9a5b6c9f81f"` and `gh api "repos/figma/mcp-server-guide/contents/.claude-plugin/plugin.json?ref=172920731eedf414e9b22ae60017d9a5b6c9f81f"`. Output: `{"date":"2026-09-22T10:24:16Z","msg":"skills: Sync skills from master and bump to 2.2.120"}` and `"version": "2.2.120"`.
- **Limits / false positives:** The plugin also loads Figma's skills into the session. Their context cost was not measured.

### FD07-F07 — Forum reports: Figma's capture and write tools have failed in ways that cost hours
- **Grade:** D · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** Users report several distinct failures:
  - February 2026: `generate_figma_design` was missing from Claude Code sessions connected through the claude.ai connector. One user fixed it by adding the remote server directly and removing earlier instances; others still did not get the tool.
  - March 2026: capture hung on "processing" and ended in "Couldn't send to Figma", even for a page with no JavaScript. On 30 March the reporter got it working after waiting and replacing CDN-loaded Mermaid rendering. He suspected heavy rendered content plus rate limiting, which he could only guess at "because of no proper error reporting".
  - July 2026: `use_figma` disappeared from one Full-seat user's tool list in the claude.ai connector. Figma support replied that it had no information on an ongoing known bug, and the thread closed without a confirmed cause.
  - August 2026: Figma staff confirmed and resolved an issue that hid MCP tools such as `use_figma` from some Codex and ChatGPT users.
  - August 2026: identical read-only `use_figma` calls from a Dev seat in Codex were sometimes refused as needing a Full seat.

  (corrected: the dossier said `use_figma` "vanished from tool lists server-side until Figma fixed it" in July and August; only the August Codex/ChatGPT case was confirmed and fixed by Figma. The March reporter's eventual success was added.)
- **Implication for /frontend:** A Figma step cannot sit on /execution's critical path. Any Figma use needs a timebox and a fallback: skip it and continue from local sources.
- **Evidence:**
  - [generate_figma_design not available in Claude Code connector?](https://forum.figma.com/report-a-problem-6/generate-figma-design-not-available-in-claude-code-connector-51173) — forum thread started by Alex Xie, 2026-02-23, accessed 2026-09-30 — user forum.
    - "The tool simply isn't exposed in the tool list."
    - "claude mcp add --transport http figma-remote-mcp https://mcp.figma.com/mcp" / "Seems like claude code to figma feature is not available through connector."
    - "I tried disconnecting, removing all instances of the figma plugin, reauthorized the remote MCP, and the generate_figma_design tool is still not listed."
  - [Remote mcp generate_figma_design in Claude Code always fails with "Couldn't send to Figma"](https://forum.figma.com/report-a-problem-6/remote-mcp-generate-figma-design-in-claude-code-always-fails-with-couldn-t-send-to-figma-52135) — Carlos_Pires, 2026-03-19 and 2026-03-30, accessed 2026-09-30 — user forum.
    - "It NEVER works."
    - "Even a simple HTML/CSS page with no JS whatsoever fails."
    - "Which is a bummer because of no proper error reporting."
  - [use_figma (write to canvas) tool missing — read tools work fine, Full seat](https://forum.figma.com/report-a-problem-6/use-figma-write-to-canvas-tool-missing-read-tools-work-fine-full-seat-56176) — eediz, 2026-07-20, accessed 2026-09-30 — user forum.
    - "It disappeared without any change on my side."
    - Client: "Claude (claude.ai) with the official remote MCP server". Reply from Celine_ (Figma Community Support), same day: "I don't have any information on an ongoing known bug related to this at the moment". The topic is closed for replies.
  - Same thread as the March report above, Carlos_Pires, 2026-03-30:
    - "I managed to get this to work."
  - [Figma MCP use_figma tool is missing in Codex/ChatGPT](https://forum.figma.com/report-a-problem-6/figma-mcp-use-figma-tool-is-missing-in-codex-chatgpt-57256) — Jaycee Lewis, Figma staff, 2026-08-26, accessed 2026-09-30.
    - "The issue preventing some Codex and ChatGPT users from seeing MCP tools, such as `use_figma`, has been resolved."
  - [The same `use_figma` request sometimes requires a full seat, and sometimes doesn't](https://forum.figma.com/report-a-problem-6/the-same-use-figma-request-sometimes-requires-a-full-seat-and-sometimes-doesn-t-57311) — user report, 2026-08-28, accessed 2026-09-30.
    - "To use MCP tools that make edits, you'll need a Full seat." (denied call); "This call successfully returned the complete read-only comparison result." (identical call, five minutes later)
- **Limits / false positives:** These are anecdotes. One issue (August, Codex and ChatGPT) was confirmed and fixed by Figma, and none was reproduced here.

### FD07-F08 — Code to canvas (`generate_figma_design`) turns a running page into Figma layers; live third-party sites need a Playwright-injected script
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** The feature launched on 17 February 2026 in partnership with Anthropic, as "Claude Code to Figma". It works only through the remote server:
  - It converts live UI from a browser into editable frames, sent to a new file, an existing file or the clipboard.
  - Any seat can write into drafts; editing an existing file outside drafts needs a Full seat.
  - For a live web app or site, the client may inject Figma's script with Playwright; local UI does not need this.
  - The tools page says this tool is exempt from the standard rate limits.

  Figma's CEO frames the point as comparing options on a canvas.
- **Implication for /frontend:** With no Figma file, this is the one Figma tool that works on the free tier without spending read quota. It can drop sponsor-customer pages (a moodboard) or our own built pages (side-by-side review) into a drafts file. It produces neither code nor tokens by itself, and reading the layers back costs read calls (F04).
- **Evidence:**
  - [Code to canvas | Developer Docs](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/) — Figma, undated, accessed 2026-09-30 — official documentation.
    - "Using the remote Figma MCP server, you can convert live UI from your browser into editable Figma frames."
    - "You can have any seat to use the code to canvas tool to create or edit files in your drafts. To edit an existing file outside your drafts, you must have a Full seat and edit permission."
    - "If you're trying to capture your UI from a live web app or site, you can prompt your client to use a tool like Playwright to inject the required script. For local UI, this isn't necessary."
  - [Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) — Figma, accessed 2026-09-30.
    - "For use with select MCP clients. This tool is exempt from the standard rate limits for the Figma MCP server."
  - [The Future of Design Is Code and Canvas](https://www.figma.com/blog/the-future-of-design-is-code-and-canvas/) — Dylan Field, Figma, 2026-02-17, accessed 2026-09-30 — vendor blog.
    - "Just install the Figma MCP, type "Send this to Figma," and the browser's rendered state will automatically translate to fully editable Figma layers."
    - "Our point of view is that the design canvas is better at navigating lots of possibilities than prompting in an IDE or ADE."
  - [Figma partners with Anthropic to turn AI-generated code into editable designs](https://www.cnbc.com/2026/02/17/figma-anthropic-ai-code-designs.html) — Deirdre Bosa, CNBC, 2026-02-17, accessed 2026-09-30 — press.
    - "converts code generated in artificial intelligence tools like Claude Code into fully editable designs inside Figma"
- **Limits / false positives:** It works only with "select MCP clients". The Chrome-extension variant needs a paid plan (F10), and reliability reports exist (F07). No official statement was found on sites whose Content Security Policy blocks the injected script.

### FD07-F09 — Captured pages arrive as flat layers without components or styles, and flat Figma structure yields poor generated code
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** Figma's FAQ describes captures as flat layers with no library connection. The Help Center adds:
  - There is "No component and styles mapping yet".
  - Complex scroll-driven or canvas-rendered sites may capture imperfectly.
  - Variables bind only when matching variables already exist in the file, either created in it or from a library added before pasting. Adding published libraries is a paid-plan feature.

  Separately, a controlled practitioner test built the same login screen twice: once structured (auto layout, variables, components, semantic names) and once flat. The generated Flutter code scored 32 out of 35 against 10 out of 35 across seven 5-point items. Visual fidelity was close (5 against 4); the gap was in code structure, because the tool "directly reflects Figma's internal structure".

  (corrected: variables also bind from variables created in the file, not only from an added library; the zenn gap is in code structure, not in visual fidelity)
- **Implication for /frontend:** The route customer site → Figma capture → `get_design_context` → code stacks two translations. It also hands the code step the unstructured kind of file that produces the worst output. For the "inspire from / copy aspects of customer sites" step, extracting from the live DOM (computed styles, screenshots) is the shorter path and keeps real values. A Figma capture only adds a canvas that humans can annotate.
- **Evidence:**
  - [Figma MCP server FAQs](https://help.figma.com/hc/en-us/articles/39252411778583-Figma-MCP-server-FAQs) — Figma Help Center, undated, accessed 2026-09-30 — official documentation.
    - "Code to Canvas (generate_figma_design) captures a running app as flat Figma layers — fast mockups, but no library connection."
  - [Turn coded screens into editable design layers](https://help.figma.com/hc/en-us/articles/40826832449303-Turn-coded-screens-into-editable-design-layers) — Figma Help Center, undated, accessed 2026-09-30 — official documentation.
    - "No component and styles mapping yet. Captures come in as plain Figma layers with variables bound if any are available."
    - "Complex scroll-driven or canvas-rendered sites may capture imperfectly."
    - "Adding published libraries to a file is available on paid plans."
    - "Existing variables include variables that were created in the file and variables inside libraries that have been added to the file."
    - "Scroll first on animated pages."
  - [How You Build in Figma Determines the Code Generated by Figma MCP — A Verification](https://zenn.dev/yokkomystery/articles/3904e7db644ea1?locale=en) — yokkomystery, zenn.dev, 2026-03-27, accessed 2026-09-30 — practitioner measurement (grade B on its own).
    - "Result: 32 out of 35 vs. 10 out of 35."
    - "We evaluated 7 items on a 5-point scale." Visual Fidelity row: 5 and 4.
    - "The only score where Project B came close to A was "Visual Fidelity." The appearance is mostly reproduced."
    - "Figma MCP generates code that directly reflects Figma's internal structure."
- **Limits / false positives:** The zenn test covers one screen on a subjective 5-point scale. Captures do carry some auto layout and font properties (F10), so they are less flat than the zenn "Project B". The advice to extract from the DOM is an inference; it was not measured here.

### FD07-F10 — Figma's Chrome-extension capture needs a paid plan, and Figma markets grabbing UI from real sites for moodboards
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** The extension article's header says "Available on all plans", but code to canvas inside the extension turns on only for accounts signed in to a paid plan. Other extension features stay free. The extension reads the code behind page elements, and Figma's own use-case text endorses grabbing UI from real sites for pattern research and moodboards.
- **Implication for /frontend:** Figma treats capturing third-party UI for pattern research as normal. That matches the owner's step of drawing inspiration from customer sites, but it conflicts with Claude's Design rule against recreating another company's proprietary design (F23). In a hackathon on a free Figma account, the extension is not an option; the MCP tool (F08) or html.to.design (F11) is.
- **Evidence:**
  - [Figma Chrome extension](https://help.figma.com/hc/en-us/articles/9067379354135-Figma-Chrome-extension) — Figma Help Center, undated, accessed 2026-09-30 — official documentation.
    - "Available on all plans"
    - "Code to canvas is part of the same extension and turns on automatically once you're signed in to a paid plan."
    - "Other extension features (such as the Google Calendar integration) remain available on all plans."
    - "The Figma Chrome extension looks at the available code that's backing the web elements and translate it to Figma."
  - [Turn coded screens into editable design layers](https://help.figma.com/hc/en-us/articles/40826832449303-Turn-coded-screens-into-editable-design-layers) — Figma Help Center, accessed 2026-09-30.
    - "When you're researching patterns or building a moodboard, the extension lets you grab specific UI from real sites and assemble them in a Figma Design file or FigJam board."
    - "Refresh the tab, and ensure you have a paid plan."
- **Limits / false positives:** No terms-of-use statement on third-party content was read. The capture was not tested.

### FD07-F11 — html.to.design imports any URL into editable Figma layers, with 10 (or 12) free imports per 30 days
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** html.to.design (by ‹div›RIOTS) is a Figma plugin plus browser extension that converts a web page into editable Figma layers and creates local text and color styles. Its PRO page says the free tier allows "Up to 10 imports every 30 days", while its overview page says "12 free imports a month". PRO costs $12 per user per month billed annually or $18 billed monthly, with a fair-use cap of 1,000 imports a month.
- **Implication for /frontend:** A moodboard of 5 to 8 customer pages fits the free tier. The auto-created local styles are a fast visual read of a site's palette and type scale on a canvas. The same values are available from the DOM without Figma, so this stays optional.
- **Evidence:**
  - [What is html.to.design?](https://html.to.design/docs/what-is-html-to-design/) — ‹div›RIOTS, undated, accessed 2026-09-30 — the tool's own documentation.
    - "html.to.design is made up of a Figma plugin and browser extension, that convert any website into fully editable Figma designs."
    - "text and color styles are automatically created as local styles in Figma, ready-to-use in future designs."
    - "Try html.to.design with 12 free imports a month to discover the difference it can make in your design workflow."
  - [PRO plan](https://html.to.design/docs/pro-plan/) — ‹div›RIOTS, undated, accessed 2026-09-30 — the tool's own documentation.
    - "Up to 10 imports every 30 days"
    - "$12 per user/month Billed annually" / "$18 per user/month Billed monthly"
    - "The fair use policy limits usage to 1,000 imports per month."
- **Limits / false positives:** These are vendor claims and were not tested. The free-import count contradicts itself (see Contradictions).

### FD07-F12 — Write to canvas (`use_figma`) is a free beta that needs a Full seat and has hard limits
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** `use_figma` launched on 24 March 2026. It runs agent-written JavaScript through the Figma Plugin API. Writing needs a Full seat; Dev seats are read-only outside their drafts. Documented limits:
  - A 20 KB output response limit per call.
  - "No assets (image) support yet".
  - Custom fonts: "aren't supported yet" in the developer docs, but "must be uploaded to your account" in the FAQ.
  - "Beta-level quality — output may need manual review and cleanup".

  It "will eventually be a usage-based paid feature" and is free during the beta.
- **Implication for /frontend:** `use_figma` serves teams that already have a Figma design system. With no designer and no Figma system, pushing our site into Figma adds a step whose output a human must still review in Figma. It stays out of the default path.
- **Evidence:**
  - [Write to canvas | Developer Docs](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/) — Figma, undated, accessed 2026-09-30 — official documentation.
    - "Write to canvas works by letting your client execute JavaScript in the context of a Figma file through the Plugin API."
    - "You need a Full seat to write to Figma files with agents. Dev seat holders can use the Figma MCP server for read-only workflows such as pulling design context, variables, and screenshots."
    - "20kb output response limit per call" / "No assets (image) support yet - including no importing components that have images/videos, or creating GIFs" / "Custom fonts aren't supported yet"
  - [Figma MCP server FAQs](https://help.figma.com/hc/en-us/articles/39252411778583-Figma-MCP-server-FAQs) — Figma Help Center, created 2026-03-24, edited 2026-08-13, accessed 2026-09-30.
    - "A Full Seat is required to write to Figma files outside of drafts. Dev Seats get read-only access outside of their drafts"
    - "Fonts must be uploaded to your account to be available when writing to canvas."
    - "Beta-level quality — output may need manual review and cleanup"
    - "This will eventually be a usage-based paid feature, but is currently available for free during the beta period."
  - [Guide to the Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server) — Figma Help Center, edited 2026-07-14, accessed 2026-09-30.
    - "This will eventually be a usage-based paid feature, but is currently available for free during the beta period."
  - (corrected: "Beta-level quality — output may need manual review and cleanup" is in the Help Center FAQ, not on the developer docs' Write to canvas page; the "usage-based paid feature" sentence is in the FAQ and the Help Center guide, not on the developer docs' Tools and prompts page, where neither string appears)
  - [Agents, Meet the Figma Canvas](https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/) — Matt Colyer, Figma, 2026-03-24, accessed 2026-09-30 — vendor blog.
    - "Starting today, you can use AI agents to design directly on the Figma canvas."
- **Limits / false positives:** It is in beta, pricing may change, and Starter-plan behavior is undocumented.

### FD07-F13 — Figma's own agent skills forbid defaulting to Inter and require asserting the rendered font
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Figma's `figma-generate-design` skill tells agents to identify the product's font from the source and never default to Inter. It requires them to assert that rendered text uses the identified product font and to treat any mismatch as a failed validation, because loading Inter where the product uses another face is a failure even when nothing errors. The foundational `figma-use` skill notes, inside its text-editing recipe, that "Inter is preloaded in most environments so other families surface this bug more often"; the bug there is the unloaded-font error, so the line explains why a skipped font load goes unnoticed with Inter, not why agents choose Inter. The same skills state that `use_figma` and `generate_figma_design` both need an existing `fileKey`, and that `use_figma` cannot fetch external image URLs. (corrected: the dossier said `figma-use` "explains the mechanism" of defaulting to Inter; it only says the unloaded-font bug surfaces less with preloaded Inter)
- **Implication for /frontend:** This is independent vendor evidence for the owner's tell 4 (Inter everywhere). That an already-loaded font becomes the silent fallback when the agent never looks up the intended face is this dossier's inference from the `figma-use` line, not a statement in either skill. The vendor rule itself transfers directly: /frontend's checker should assert each rendered font family against the chosen type spec (computed style in the browser), not trust that a font "loaded".
- **Evidence:**
  - [figma/mcp-server-guide skills/figma-generate-design/SKILL.md](https://raw.githubusercontent.com/figma/mcp-server-guide/main/skills/figma-generate-design/SKILL.md) — Figma, main branch, accessed 2026-09-30 — the tool's own skill file (35,824 bytes, read locally).
    - "Identify the product's font family from the source. Do not default to Inter."
    - "loading Inter when the product uses SF Pro is a failure even if no errors occur."
    - "**You MUST explicitly assert that rendered text uses the product font(s) identified in Step 1**, and treat any mismatch as a failed validation."
    - "Both `use_figma` and `generate_figma_design` require an existing `fileKey`."
    - "The `use_figma` Plugin API cannot fetch external image URLs"
  - [figma/mcp-server-guide skills/figma-use/SKILL.md](https://raw.githubusercontent.com/figma/mcp-server-guide/main/skills/figma-use/SKILL.md) — Figma, main branch, accessed 2026-09-30 — the tool's own skill file.
    - "Inter is preloaded in most environments so other families surface this bug more often" (the preceding sentence names the bug: "Skipping the load throws `Cannot write to node with unloaded font "<family> <style>"`.")
- **Limits / false positives:** The preload applies to Figma's plugin sandbox, not to browsers. What transfers to web code is the font-assertion rule, not a documented mechanism.

### FD07-F14 — Measured, then withdrawn by its author: the 82% for `get_design_context` came from an extra AI conversion; its code built directly scored 94%
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** A tool builder (canicode) compared three inputs for generating the same 270+ node design. His wiki comparison page (created 2026-04-01) lists curated REST data at 94% pixel similarity with about 11,000 input tokens, `get_design_context` at 82% with about 21,265, and raw Figma JSON at 78% with about 58,898. His own Experiment 03 page (2026-03-27) contradicts that row. The 82% was an MCP → AI → HTML conversion, which he removed on 2026-03-27 as an "irrelevant comparison". MCP's React + Tailwind output built directly with Vite scored 94% on the same fixture, and 94 to 98% across six fixtures, with no model tokens spent. The MCP output hard-codes pixel widths at root and child levels. In an earlier side-by-side test on a simple frame (v0.8.2, 2026-03-22), its Tailwind step rewrote `#ffffff` as `bg-white`, which hid a raw-colour issue from canicode's analysis. (corrected: the dossier presented 82% as `get_design_context`'s fidelity; the same author withdrew that figure, and the MCP code rendered as-is scored 94 to 98%. The `bg-white` observation comes from the earlier simple-frame test, not the 270+ node experiment.)
- **Implication for /frontend:** If a Figma adapter runs, take token values from `get_variable_defs` (names and raw values), not from `get_design_context`'s class names. Expect fixed widths that break at phone size, and budget a responsive pass. The measured loss sits in re-translating the React + Tailwind output, which is the step an adapter would perform to map it onto /frontend's tokens (Figma's README asks for exactly that translation, F03). The evidence comes from one author and one design; the number of runs per fixture is not stated.
- **Evidence:**
  - [Figma MCP vs REST API](https://github.com/let-sunny/canicode/wiki/Figma-MCP-vs-REST-API) — let-sunny (canicode), wiki edited 2026-03-31, accessed 2026-09-30 — practitioner measurement.
    - "| Figma MCP (get_design_context) | ~21,265 | ~13,270 | 82% |" and "| design-tree (curated REST API) | ~11,000 | ~17,400 | 94% |"
    - "Figma MCP: Hard-codes pixel widths (e.g.,`w-[375px]`) at root AND child levels."
    - "During that generation,`#ffffff` was mapped to Tailwind's`bg-white` class." (under "Early Validation: Side-by-Side Analysis (v0.8.2)", "a simple Frame design (node `127:2`)")
    - Wiki page history (`git log` on the wiki repository): created 2026-04-01 00:15 +0900, last edited 2026-04-01 00:25 +0900 (2026-03-31 UTC).
  - [Experiment 03 — Input Comparison](https://github.com/let-sunny/canicode/wiki/Experiment-03-input-comparison) — let-sunny (canicode), dated 2026-03-27, model claude-sonnet-4-6, accessed 2026-09-30 — practitioner measurement.
    - "| **figma-mcp** (Vite build) | **0** | **0** | **0** | **94%** | **$0** |"
    - "94-98% regardless of design quality. Figma generates its own code, so it's always accurate. **However, MCP still can't properly align slot areas.**"
    - Commit 21fa72e, 2026-03-27 11:12 +0900: "Remove MCP AI conversion (82%) — irrelevant comparison". The removed row: "| figma-mcp (AI 변환) | 21,265 | 289 | 13,270 | 82% | ~$0.50 |", and a removed section "### figma-mcp → AI → HTML (82%)" whose note reads, in translation, "already code (React+Tailwind), but an HTML conversion step is added". The section kept beside it reads, in translation, that building and rendering MCP's React + Tailwind directly is the correct usage and that AI conversion added an unnecessary step.
- **Limits / false positives:** It covers one design (six fixture variants), the author is also the tool's builder, the pixel-similarity method is not described in detail, and his two pages disagree on the MCP figure.

### FD07-F15 — Measured: designing through Figma MCP did not improve recreation fidelity, and canvas self-checks missed browser failures
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** Braintrust ran headless Claude Code with a single design MCP per run, asking it to recreate a screenshot as HTML.
  - Visual similarity (CLIP; a perfect re-render scores 0.93): Figma 0.744 vs Paper 0.741 on 40 Design2Code pages, and 0.679 vs 0.716 on 27 complex designs (p = 0.21).
  - Figma's run-to-run variance was about 1.9 times Paper's; it ran 42% longer and cost $3.73 against $2.82 per point of visual quality.
  - Figma collapsed on two designs. On "park", all three trials shipped the artwork as a miniature, because a Figma composition has a fixed frame size that nothing forces to fill the browser viewport; two of those trials self-checked six and eight times and missed it, because the checks screenshot the canvas. The author calls the other collapse ("aiaf", 3D robots) variance, with one trial rendering the page as a narrow column. (corrected: the fixed-frame explanation is given for one collapse, not both)
  - Across runs, the number of self-checks did not predict quality: r = −0.19 for Figma, +0.01 for Paper.
  - In smoke tests, agents skipped the design tool entirely when given the choice.
  - Figma's output used semantic HTML tags more than three times as often as Paper's.
- **Implication for /frontend:** A design-canvas detour is not a quality lever by itself. Verification must render the real page in a browser at real viewport widths; a clean canvas proves nothing about the site.
- **Evidence:**
  - [Paper MCP vs Figma MCP for frontend agents](https://www.braintrust.dev/blog/paper-vs-figma-mcp) — Jess Wang, Braintrust, 2026-07-20, accessed 2026-09-30 — independent eval; the harness is described in the post (headless Claude Code, `--strict-mcp-config`, `claude-sonnet-5`), but no harness repository is linked. (corrected: the dossier said "published harness")
    - "On aiaf, the story is variance rather than repeatable failure."
    - "On visual similarity, a 0 to 1 score of how closely the recreation resembles the original (1.0 is identical), Paper averages 0.741 and Figma 0.744 across 40 pages."
    - "Figma's run-to-run variance is about 1.9 times Paper's, and it runs 42% longer while costing 32% more per point of visual quality ($3.73 vs $2.82)."
    - "a Figma composition has a fixed frame size and nothing forces it to fill a browser viewport when it becomes HTML"
    - "Two of those trials self-checked six and eight times and still shipped the miniature, which makes sense once you notice that the checks screenshot the Figma canvas, where the composition genuinely looks right."
    - "the correlation between how many times an agent checked its own canvas and its final visual similarity score is r = +0.01 for Paper and r = −0.19 for Figma, and neither is statistically meaningful."
    - "early smoke tests showed agents skip design tools entirely when given the choice."
- **Limits / false positives:** The eval compares two design MCPs, not a design MCP against no design MCP. CLIP similarity measures resemblance to a reference, not originality or the absence of slop. There is one evaluator.

### FD07-F16 — Phone review: Figma's app can view and comment; Claude's apps can only view designs
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** The Figma mobile app, on any plan, lets anyone with view access view files and leave comments (long-press on the canvas). It cannot edit Design files. The Claude iOS and Android apps show designs in the Artifacts tab. Starting from a template, editing and changing sharing all require web or desktop, and Claude Code's docs point reviewers to a desktop browser.
- **Implication for /frontend:** A Design artifact is view-only on a phone; commenting from the mobile app is not documented. The most useful phone review is the deployed preview URL opened in the phone browser, because it also tests the real mobile layout. Use the Design artifact for choosing directions, not for final review.
- **Evidence:**
  - [Guide to the Figma mobile app](https://help.figma.com/hc/en-us/articles/1500007537281-Guide-to-the-Figma-mobile-app) — Figma Help Center, undated, accessed 2026-09-30 — official documentation.
    - "Available on any team or plan."
    - "Anyone with at least `can view` access can view and leave comments on files, boards, slide decks, and prototypes"
    - "Note: It's not possible to edit Figma Design files or Figma Slides decks using the mobile app."
  - [What are artifacts and how do I use them?](https://support.claude.com/en/articles/17153992) — Anthropic Help Center, "Updated this week", accessed 2026-09-30 — official documentation.
    - "Claude for iOS and Claude for Android: Ask for a design, deck, or doc in any chat, and view the result in the Artifacts tab. To start from a template, edit, or change sharing settings, use Claude on the web or Claude Desktop."
  - [Share session output as artifacts](https://code.claude.com/docs/en/artifacts) — Anthropic, Claude Code docs, accessed 2026-09-30 — official documentation.
    - "Open the published artifact in a desktop browser to review the artboards."
- **Limits / false positives:** Neither mobile app was tested. Commenting from a mobile web browser is documented neither way.

### FD07-F17 — Claude Design launched on 17 April 2026 from Anthropic Labs: prompts, images, documents, codebases and a web capture tool in; HTML, PDF, PPTX, zip and a Claude Code handoff out
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Claude Design is a research-preview Anthropic Labs product powered by Claude Opus 4.7.
  - Inputs: text prompts, images, DOCX, PPTX and XLSX files, a codebase, and a web capture tool that grabs elements "from your website".
  - Refinement: conversation, inline comments, direct edits, and sliders that Claude generates.
  - Exports: an internal URL, a folder or zip, Canva, PDF, PPTX, standalone HTML, a list of third-party apps, and a Claude Code handoff (to a local coding agent or Claude Code Web).
- **Implication for /frontend:** The capabilities the owner wants (exploring directions, pulling a site's look, handing off to Claude Code) exist natively. No Figma seat is needed for them.
- **Evidence:**
  - [Introducing Claude Design by Anthropic Labs](https://www.anthropic.com/news/claude-design-anthropic-labs) — Anthropic, 2026-04-17, accessed 2026-09-30 — vendor announcement.
    - "Today, we’re launching Claude Design, a new Anthropic Labs product that lets you collaborate with Claude to create polished visual work like designs, prototypes, slides, one-pagers, and more."
    - "Claude Design is powered by our most capable vision model, Claude Opus 4.7, and is available in research preview for Claude Pro, Max, Team, and Enterprise subscribers."
    - "You can also use the web capture tool to grab elements directly from your website so prototypes look like the real product."
    - "Export anywhere. Share designs as an internal URL within your organization, save as a folder, or export to Canva, PDF, PPTX, or standalone HTML files."
    - "Handoff to Claude Code. When a design is ready to build, Claude packages everything into a handoff bundle that you can pass to Claude Code with a single instruction."
  - [Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) — Anthropic Help Center, "Updated this week", accessed 2026-09-30 — official documentation.
    - Export list: "Download as .zip", "Export as PDF", "Export as PPTX", "Export as standalone HTML", "Handoff to Claude Code", with "Send to local coding agent" and "Send to Claude Code Web".
- **Limits / false positives:** It is a beta or research preview. Anthropic's wording scopes web capture to "your website", and no official statement on third-party sites was found.

### FD07-F18 — Since 16 September 2026 Claude Design is an artifact template usable from Claude Code; Anthropic's pages disagree on whether Free plans get it
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The 16 September release notes put designs, decks and docs inside any conversation, including Claude Code, and say artifacts including Claude Design are available "on every plan, including Free". Three other Anthropic pages disagree:
  - The artifacts article says templates are paid-only.
  - The getting-started article lists Pro, Max, Team and Enterprise.
  - The product page says "included in all paid plans".

  The standalone claude.ai/design experience keeps working under its own setting. In this environment, the Artifact tool lists core types Design, Design System, Docs and Slides.
- **Implication for /frontend:** The Design and Design System types are usable here and now. Do not design /frontend around Free-plan access. claude.ai/design and the Design artifact are two surfaces with separate settings and stores.
- **Evidence:**
  - [Release notes](https://support.claude.com/en/articles/12138966-release-notes) — Anthropic Help Center, entry dated 2026-09-16, accessed 2026-09-30 — official release notes (raw HTML downloaded and parsed).
    - "You can now ask for a design, deck, or document in any conversation with Claude, including in Claude Code and the Artifacts tab, and edit it with Claude or directly as you work."
    - "Artifacts, including Claude Design, Claude Slides, and Claude Docs, are available on every plan, including Free."
  - [What are artifacts and how do I use them?](https://support.claude.com/en/articles/17153992) — Anthropic Help Center, accessed 2026-09-30.
    - "Templates (Claude Design, Claude Slides, and Claude Docs) are in beta on paid plans only."
  - [Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) — Anthropic Help Center, accessed 2026-09-30.
    - "Claude Design is available in beta on Pro, Max, Team, and Enterprise plans."
    - "The standalone Claude Design experience at claude.ai/design keeps working and has its own separate setting."
  - [Claude Design product page](https://claude.com/product/design) — Anthropic, accessed 2026-09-30 — vendor page (FAQ JSON-LD read from raw HTML).
    - "Claude Design is included in all paid plans. Admins must turn it on in Organization settings."
  - Artifact tool, `action: list`, `scope: types`, run 2026-09-30 — OBSERVED.
    - Output: `[core] "Design"`, `[core] "Design System"`, `[core] "Docs"`, `[core] "Slides"`.
- **Limits / false positives:** Availability is account-specific. The owner's plan was not checked. Verification note: a fifth Anthropic statement agrees with the paid-only side. The June 2026 blog's "Update, September 2026" note says Claude Design now works inside any conversation "in beta on paid plans".

### FD07-F19 — Claude Design draws on the same usage pool as Claude Code
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Since mid-June 2026, Design activity counts against the same limits as the rest of Claude, including Claude Code; before that it had a separate weekly allowance. Large codebases and many iterations cost more. At the limit, Design is unavailable until reset, unless usage credits are enabled.
- **Implication for /frontend:** In a hackathon, every design iteration comes out of the budget that /execution's agent waves need. /frontend needs an explicit design budget (number of directions and revision rounds) and should explore before the build waves start, not during them.
- **Evidence:**
  - [Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) — Anthropic Help Center, accessed 2026-09-30.
    - "Claude Design counts toward the same usage limits as the rest of Claude. Design activity draws from the same pool as the rest of your work with Claude, including Claude Code, so there's no separate Claude Design allowance to track. Complex projects with large codebases or many iterations consume more usage."
    - "If you reach your usage limits, Claude Design is unavailable until your limits reset."
    - "Note: Claude Design previously had its own weekly allowance, separate from your other usage limits."
  - [Claude Design now stays on brand for daily work](https://claude.com/blog/claude-design-stays-on-brand-for-daily-work) — Anthropic, 2026-06-17 (with a September 2026 update note), accessed 2026-09-30 — vendor blog.
    - "Claude Design also now shares usage limits with the rest of your work with Claude, including Claude Code"
  - [Claude Design product page](https://claude.com/product/design) — Anthropic, accessed 2026-09-30.
    - "Larger requests, like a full deck or design, use more of your limit than a typical message."
- **Limits / false positives:** No post-June measurement of design cost was found (see "What could not be found").

### FD07-F20 — Measured at launch: a Pro weekly design allowance lasted about 25 to 30 minutes, and design-system ingestion alone took 77%
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** On launch day, one Pro-plan reviewer used 80% of the weekly design allowance producing three variations in about 25 minutes. The meter hit zero five minutes later, while Claude rebuilt files he had wiped by mistaking the undo button for the back button, with the model switched down to Sonnet 4.6. He adds that even without that blunder he would not have got far into his review before the quota ran out. A product designer interviewed by Techloy lost 77% of a Pro allowance in 5 minutes while Claude Design ingested her design system, before generating anything; five UI pages then took the remaining 23%. The same task used 15% of a Max 5x allowance, and she noted there is no transparent token usage. (corrected: the last 20% of the PCWorld allowance went on a rebuild caused by the reviewer's own mistake, which the dossier omitted; the Techloy split was completed)
- **Implication for /frontend:** Ingesting a design system from a large source is the expensive step. Give Claude Design a small explicit token set and a few reference pages, never a whole repository. Keep a budget, and treat the owner's plan tier as a real constraint.
- **Evidence:**
  - [I tried Claude Design for half an hour. I’m already locked out for a week](https://www.pcworld.com/article/3117811/i-tried-claude-design-for-half-an-hour-im-already-locked-out-for-a-week.html) — Ben Patterson, PCWorld, 2026-04-17, accessed 2026-09-30 — press hands-on.
    - "Overall, it took Claude Design roughly 25 minutes to complete three variations of its AI token-explainer prototype."
    - "I’d already blown through 80 percent of my weekly Claude Design allowance."
    - "Five minutes later though, my weekly Claude Design meter hit zero."
    - "I mistook the “undo” button for the back button, instantly zapping all Claude’s work." / "I downshifted the model to the cheaper Sonnet 4.6 as Claude cleaned up my mess."
    - "But even had I not blundered into wiping my Claude Design files, I wouldn’t have made it far into the review process before my quota ran out."
  - [I Opened Claude Design — 77% of My Tokens Were Gone in 5 Minutes](https://www.techloy.com/i-opened-claude-design-77-of-my-tokens-were-gone-in-5-minutes/) — Damilare Odedina, Techloy, 2026-04-30, accessed 2026-09-30 — press interview.
    - "Setup ate 77% of her Pro plan tokens in those first five minutes."
    - "It used 15% of that tier's allocation."
    - "There is no transparent token usage in Claude Design, so I don't know exactly how many tokens it burned"
    - "she finally asked it to generate five UI pages in HTML. That work consumed the remaining 23% of her weekly limit."
- **Limits / false positives:** These are April 2026 figures under the old separate meter and Opus 4.7, from two single users. The pooled limits since June may behave differently; Anthropic's June blog asserts, without figures, that pooling gives "most people ... much more headroom".

### FD07-F21 — Claude Design's documented limits: no version history, unreliable multi-person editing, comments that vanish
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** The Help Center lists four relevant limits:
  - No version history.
  - Simultaneous editing by two or more people "may not work reliably".
  - Inline comments sometimes do not appear; the workaround is pasting the feedback into chat.
  - Design-system import is only as good as its source.

  PCWorld's reviewer lost all generated work to a single undo, which he pressed by mistake for the back button. (corrected: the dossier omitted that the undo was pressed by mistake)
- **Implication for /frontend:** Two developers should not edit the same canvas at once. Git is the history. Copy the chosen direction's tokens and logo SVG into the repo immediately after the pick, so that canvas loss costs nothing.
- **Evidence:**
  - [Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) — Anthropic Help Center, accessed 2026-09-30.
    - "Version history: Claude Design doesn't have version history yet."
    - "Multi-person editing: Two or more people editing a design project at the same time is still basic and may not work reliably."
    - "Comment persistence: Inline comments occasionally don't appear on the page, but you can still see them by opening the comments view."
    - "Design system import: Design system import is only as good as its source."
  - [PCWorld hands-on](https://www.pcworld.com/article/3117811/i-tried-claude-design-for-half-an-hour-im-already-locked-out-for-a-week.html) — Ben Patterson, 2026-04-17, accessed 2026-09-30.
    - "“The undo wiped everything. I need to rebuild all files from scratch.” Claude calmly told me."
- **Limits / false positives:** The undo loss is a single launch-day anecdote, caused by user error; it shows only that one undo could wipe every file at launch.

### FD07-F22 — In Claude Code, `/design` drafts artboards on a canvas; the Claude Code docs list PNG or PDF per artboard, and the Help Center adds .zip and standalone HTML for the whole design
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** `/design` with a brief drafts artboards on one canvas and publishes them as a Claude Design artifact. Edits made in a desktop browser save automatically, and each artboard exports as PNG or PDF. The Help Center's artifacts article adds that designs made from the template export "as a .zip, PDF, PowerPoint, or standalone HTML, or go straight to another tool". `/design` needs Claude Code 2.1.265 or later and a claude.ai login on Pro, Max, Team or Enterprise. Claude can read comments from 2.1.221 and auto-reply to comments sent to it from 2.1.228. The installed version is 2.1.286. (corrected: the dossier said artboards export "only" as PNG or PDF; the Help Center lists .zip and standalone HTML exports of the design)
- **Implication for /frontend:** Claude Design is usable for the owner's October events without setup. A logo candidate's SVG can be taken from the artboard source that Claude writes before publishing (the Design type keeps each artboard as a `.dc.html` file under a local root; see F23). A .zip or standalone-HTML export should also carry inline SVG, but that was not tested. Both points are inferences from the observed format, not documented features.
- **Evidence:**
  - [Share session output as artifacts](https://code.claude.com/docs/en/artifacts) — Anthropic, Claude Code docs, accessed 2026-09-30 — official documentation.
    - "To mock up a UI, a screen flow, a landing page, or a poster rather than build a page, run `/design` with a brief. Claude drafts the design as artboards on one canvas and publishes the canvas as a Claude Design artifact."
    - "Open the published artifact in a desktop browser to review the artboards. Select an element on an artboard and change it, and your edits save automatically. You can export each artboard as PNG or PDF."
    - "Both commands require Claude Code v2.1.265 or later and a session where artifacts are available."
    - "Artifacts are available on Pro, Max, Team, and Enterprise plans and require a session signed in with"
    - "You need Claude Code v2.1.221 or later." (reading comments)
  - [What are artifacts and how do I use them?](https://support.claude.com/en/articles/17153992) — Anthropic Help Center, "Updated this week", accessed 2026-09-30.
    - "Artifacts made from a template: Click "Export." Docs export to Word, PDF, Markdown, and Google Docs. Decks export to PowerPoint and PDF. Designs export as a .zip, PDF, PowerPoint, or standalone HTML, or go straight to another tool."
  - Command run 2026-09-30: `claude --version`. Output: `2.1.286 (Claude Code)`.
- **Limits / false positives:** The docs do not say whether a `/design` or Artifact publish from a non-interactive /execution subagent triggers a permission prompt.

### FD07-F23 — The Design type's own craft rules ban several of the owner's tells, and any recreation of another company's proprietary design
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The Design artifact type's instructions (release 1790780428-0f80) forbid "gradient washes, left-border cards, emoji; Inter, Roboto, Arial". They require touch targets of at least 44px, text contrast of 4.5:1 (3:1 at 24px and above), and pages that work at phone width. Icons must come from a mounted system or be inline stroke SVG, never emoji. Invented stats and lorem ipsum are banned. The only external network source allowed is a Google Fonts `css2` link; every other file must be an uploaded asset. Exact recreations are allowed only from real source, "no other company's proprietary design". Reference sizes: phone 390×844, desktop 1280 to 1440. (corrected: uploaded asset URLs are also allowed; and the implication below said the canvas "enforces" these rules, but they are instructions to the model, not a checker)
- **Implication for /frontend:** The canvas's instructions already tell the model to avoid part of the owner's list: tell 1 (via gradient washes), tell 3 (emoji), tell 4 (Inter) and tell 5 (left-border cards). Nothing on the canvas checks the output against them, and the type's own `craft.md` recommends gradient meshes and grain for unbranded work (F35). /frontend's banned list should cite these rules, add the rest, and enforce them itself. The proprietary-design line limits "copy aspects of customer sites" to patterns and measured values, not look-alike reproduction.
- **Evidence:**
  - Artifact tool, `action: read`, `type_url: https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd` (core type "Design", release 1790780428-0f80), run 2026-09-30 — the type's own SKILL.md, OBSERVED.
    - "No AI tropes (gradient washes, left-border cards, emoji; Inter, Roboto, Arial). Touch targets ≥44px; print body ≥12pt; no fake status bars; PAGEs work at phone width. Over-tall beats clipped. Recreations are exact only from real source; no other company's proprietary design."
    - "Text 4.5:1 (3:1 at 24px+)"
    - "icons: a mounted system's, by name, else inline stroke SVG, never emoji"
    - "No filler, invented stats or lorem ipsum; missing facts become placeholders like [YOUR PRICE]."
    - "no network except a Google Fonts `css2` `<link>` in `<helmet>` and step 3's urls"
    - "Sizes: phone 390×844, desktop 1280–1440."
    - "Work in ONE folder, `<root>`, each file at its canvas path under it."
- **Limits / false positives:** These rules govern the canvas type, not code Claude writes elsewhere, and a later release may change them. The type's `craft.md` reference is readable (F33 to F35); the dossier had said it could not be read.

### FD07-F24 — Claude's default look is documented: "cream, serif display and clay"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The Design type tells the model that, with no design system, it should build a small one from the subject. It also says cream, serif display and clay are the model's habit, allowed only when the brief or brand asks. On launch day, PCWorld's reviewer gave a bare one-line prompt. Claude Design then asked multiple-choice questions, including the overall style, with "New York Times-style editorial" among the options, and after he answered it proposed a "NYT/Pudding feel, serif headlines" look. The article does not say which style he picked, so this is not evidence of an unprompted default. (corrected: the dossier said Claude Design proposed the serif editorial look "given a bare brief"; the reviewer had answered style questions that offered an NYT editorial option first)
- **Implication for /frontend:** Tell 18 (serif italic accents) and tell 19 (Space Grotesk + Instrument Serif) are the kind of look the model reaches for when the brief is empty; this is an inference from the SKILL line's "serif display", and neither typeface in tell 19 is named there. /frontend must pin the direction from the /hackathon customer references (named sites, their measured type and colour) before any canvas work. The canvas should never start from an empty brief.
- **Evidence:**
  - Design type SKILL.md, read with the Artifact tool on 2026-09-30 (release 1790780428-0f80) — OBSERVED.
    - "No design system? Commit to a small one, from the subject: 1–3 typefaces, a ground, 0–2 accents of like chroma and lightness. Cream, serif display and clay are your habit: only if the brief or brand asks."
  - [PCWorld hands-on](https://www.pcworld.com/article/3117811/i-tried-claude-design-for-half-an-hour-im-already-locked-out-for-a-week.html) — Ben Patterson, 2026-04-17, accessed 2026-09-30.
    - "a clean editorial explainer (“NYT/Pudding feel, serif headlines, generous whitespace, one accent color”)"
    - "I took the barebones approach, starting from zero and submitting a simple prompt"; then "What should the overall style be (New York Times-style editorial, cartoonish)?" among the questions, and "Answering those questions took about a minute, and then Claude Design sketched out its overall approach".
- **Limits / false positives:** The SKILL line is guidance to the model, not a measurement of its outputs. PCWorld covers one session, and the look followed the reviewer's own answers.

### FD07-F25 — The canvas is told never to verify, and the handoff tells the coder not to screenshot; /frontend must require its own verification explicitly
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The Design type forbids reading back, rendering, screenshotting or opening the canvas (explicitly including Playwright) unless the user asks. The handoff README tells the coding agent not to render or screenshot the prototypes unless the user asks. Braintrust showed canvas self-checks missing broken browser output (F15).
- **Implication for /frontend:** /frontend's contract is the owner's instruction, so it can and must say that rendering and screenshot verification with Playwright on the built site is required. Canvases are for choosing; the site is where verification happens. The anti-slop checker runs on the built pages, never on canvas renders.
- **Evidence:**
  - Design type SKILL.md, read with the Artifact tool on 2026-09-30 — OBSERVED.
    - "NEVER VERIFY UNLESS THE USER ASKED, mid-run or after. Do NOT read it or your files back to check, re-check layout or sizes, render, screenshot or open it (no Playwright, browser, installs), or run a check these pages don't name. Need one? ASK first, and wait." (bold in original)
  - Handoff README observed in F28.
    - "Don't render these files in a browser or take screenshots unless the user asks you to." (bold in original)
  - [Braintrust eval](https://www.braintrust.dev/blog/paper-vs-figma-mcp) — Jess Wang, 2026-07-20, accessed 2026-09-30.
    - "the checks screenshot the Figma canvas, where the composition genuinely looks right."
- **Limits / false positives:** The canvas rule makes sense for canvases (it saves tokens). The conflict matters only if /frontend tried to verify on the canvas or deferred to the handoff README.

### FD07-F26 — The Design System type is a browsable brand reference, but its token format is not DTCG and it will not invent a logo
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The Design System type (release 1790789551-8144) keeps tokens as lists of `{name, value, usage}` and cannot read DTCG/W3C maps. It drops named colours, `var()` and `color-mix()` values. With no source it builds a small first system: 6 to 10 colours, 5 to 7 text styles, 4 spacing steps and 3 radii. It copies real assets and never approximates a mark; with no logo it uses plain type plus a note. Other agents must read its README and never guess values. Its checklist demands 4.5:1 text in every theme and bans blue-purple gradients, emoji cards and left-border cards. A system is capped at 1,008 files and 256 MiB.
- **Implication for /frontend:** It works as a human-browsable mirror of the tokens /frontend chooses, and its "small first system" is a sensible size for a hackathon brand. It is a poor single source of truth for autonomous build agents: it sits on claude.ai behind the Artifact tool, uses its own list format, and its logo slot needs a real file. Keep the repo's token file authoritative, generate the Design System files from it, and export list-shaped `tokens.json` with a usage note per token.
- **Evidence:**
  - Artifact tool, `action: read`, `type_url: https://claude.ai/artifact/5M7UeXXcx16TP3vzVFNDzd` (core type "Design System", release 1790789551-8144), run 2026-09-30 — the type's own SKILL.md, OBSERVED.
    - "A name-to-value MAP (the DTCG / W3C token format, `{"color":{"brand":{"$value":"#f00"}}}`) is valid JSON the page CANNOT read: the family shows empty and its entries leave the file at the person's first token edit."
    - "AVOID, each drops: named colours (`red`, `transparent`, `currentColor`), `var()`, `color-mix()`"
    - "Nothing to build from? Make a SMALL first system (6–10 colors in one theme, 5–7 text styles, 4 spacing steps, 3 radii, a one-paragraph README, no components) and say so."
    - "Assets copied, never approximated; no logo means plain type and a note."
    - "`read` `project/README.md` (never its page or a file listing); not served → say so, never guess its values"
    - "No AI tropes (blue-purple gradients, emoji cards, left-border cards)."
    - "Caps: a system 1,008 files and 256 MiB"
- **Limits / false positives:** These are observed instructions; the behaviour was not tested.

### FD07-F27 — DesignSync runs only when the user starts `/design-sync` and approves a plan, so /execution cannot use it
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The DesignSync tool definition limits it to the user-started `/design-sync` skill. Its job is keeping a local component library in sync with a claude.ai/design design-system project, one component at a time. It must never be used to make designs. Writes require a plan the user has reviewed and approved. The definition scopes it to "the user's claude.ai/design design-system projects", and the product page says design systems migrated from claude.ai/design each become an artifact, which suggests two stores. But the live Help Center presents `/design-sync` as the Claude Code route for creating a design system in the integrated feature, so which store `/design-sync` writes to in this version is unresolved. A third-party post describes `/design-sync pull` and `push` sub-commands that write `.claude/design-system/`; the tool as observed has no such methods (its methods are `list_projects`, `get_project`, `list_files`, `get_file`, `create_project`, `finalize_plan`, `write_files`, `delete_files`, `register_assets`, `unregister_assets` and `report_validate`). (corrected: "these are separate stores" was an inference that the Help Center partly contradicts)
- **Implication for /frontend:** /frontend must not plan an autonomous DesignSync step. A synced component library on claude.ai/design, if the owner wants one, is a manual step the owner starts after the build.
- **Evidence:**
  - DesignSync tool definition, loaded with ToolSearch `select:DesignSync` on 2026-09-30 (Claude Code 2.1.286) — OBSERVED.
    - "Read and update the user's claude.ai/design design-system projects through their claude.ai login"
    - "Use this only with the /design-sync skill, which the user starts, to keep a local component library in sync with one of those projects — incrementally, one component at a time, never as a wholesale replace. Never use it to make a design, deck or prototype: those are made from a Slides or Design Artifact type with the Artifact tool."
    - "`finalize_plan` — lock the exact set of paths you will write and delete ... Call this after the user has reviewed and approved the plan."
    - "Required ordering: list/read → finalize_plan → write/delete."
  - [Claude Design product page](https://claude.com/product/design) — Anthropic, accessed 2026-09-30.
    - "To bring an existing design system over, open the Design tab at the bottom of the sidebar and click Migrate team design systems in the banner. Each design system becomes an artifact Claude can use in any conversation, including in Claude Code."
  - [Set up your design system in Claude Design](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design) — Anthropic Help Center, "Updated this week", accessed 2026-09-30.
    - Under "Create a design system": "From Claude Code / If your design system already exists as React components, run /design-sync in Claude Code. It reads your tokens and components directly, and works best for product design systems in code."
  - [Claude Design + /design-sync: The Two-Way Bridge Between Design and Code](https://skills-hub.ai/blog/claude-design-sync-code-handoff-2026) — Skills-Hub Team, 2026-06-24, accessed 2026-09-30 — third-party blog (grade D, cited for the contradiction only).
    - "The pull command writes a `.claude/design-system/` directory to your project root."
- **Limits / false positives:** The bundled `/design-sync` skill text was not read; only the tool definition was.

### FD07-F28 — A real handoff bundle holds a README, the chat transcripts and HTML prototypes, and its README steers the coding agent
- **Grade:** B · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** A public repository stores 14 bundles presented as Claude Design handoff exports from April 2026. Its CLAUDE.md labels each bundle's README "Handoff README from claude.ai/design — do not edit", and its CONTRIBUTING.md says to keep that README "as-is". It makes no such claim for the prototypes, which the repository curates into two enforced token families. Each bundle has a README, a `chats/` folder and a `project/` folder. The README tells the coding agent to:
  - read the chat transcripts first;
  - ask the user to confirm anything ambiguous before implementing;
  - recreate the HTML/CSS/JS prototypes "pixel-perfectly" in the target stack;
  - not render or screenshot the files unless the user asks.

  An independent agent specification describes the same tarball layout (README, `chats/`, `project/`), not a structured manifest. Anthropic's announcement only says Claude packages a handoff bundle; it documents no format. (corrected: the dossier said the author labels the bundles "untouched"; only the README is labelled unedited)
- **Implication for /frontend:**
  1. The bundle contains the whole design conversation, so never commit it to a repo that will be flipped public.
  2. Its "ask the user" line would stall an autonomous /execution wave. /frontend should read bundles itself and resolve ambiguity from the spec.
  3. Its "don't screenshot" line conflicts with /frontend's verification loop (F25), and /frontend's contract overrides it.
- **Evidence:**
  - [miikeey1100/handoff-cdn bundles/agentic-ops/README.md](https://github.com/miikeey1100/handoff-cdn/blob/main/bundles/agentic-ops/README.md) — repository created 2026-04-18, last pushed 2026-04-21, accessed 2026-09-30 — third-party repository holding exported bundles, OBSERVED.
    - Command run: `gh api repos/miikeey1100/handoff-cdn/contents/bundles/agentic-ops`. Output: `file README.md 1995`, `dir chats 0`, `dir project 0`; `chats/chat1.md 2780`; `project/Agentic Ops.html 52230`.
    - "# CODING AGENTS: READ THIS FIRST"
    - "This is a handoff bundle from Claude Design (claude.ai/design)." (bold in original)
    - "Read the chat transcripts first." (bold in original)
    - "If anything is ambiguous, ask the user to confirm before you start implementing." (bold in original)
    - "The design medium is HTML/CSS/JS — these are prototypes, not production code. Your job is to recreate them pixel-perfectly in whatever technology makes sense for the target codebase (React, Vue, native, whatever fits)." (bold in original)
    - "Don't render these files in a browser or take screenshots unless the user asks you to." (bold in original)
  - [miikeey1100/handoff-cdn CLAUDE.md](https://github.com/miikeey1100/handoff-cdn/blob/main/CLAUDE.md) and [CONTRIBUTING.md](https://github.com/miikeey1100/handoff-cdn/blob/main/CONTRIBUTING.md) — accessed 2026-09-30.
    - "README.md            Handoff README from claude.ai/design — do not edit"
    - "README.md           (the Claude Design handoff README — keep as-is)"
    - "Every bundle belongs to exactly one family. The family is declared in `manifest.json` and enforced by `CLAUDE.md`."
  - [Claude Design Orchestrator](https://orchestkit.yonyon.ai/docs/reference/agents/claude-design-orchestrator) — OrchestKit, "Updated 2026-04-19 from real-world dogfood", accessed 2026-09-30 — third-party agent specification.
    - "Reality is different, Claude Design ships an HTML-prototype tarball, not a structured manifest."
  - [Introducing Claude Design by Anthropic Labs](https://www.anthropic.com/news/claude-design-anthropic-labs) — Anthropic, 2026-04-17, accessed 2026-09-30.
    - "Claude packages everything into a handoff bundle that you can pass to Claude Code with a single instruction."
- **Limits / false positives:** The repository has 2 stars and could contain edited files. The format dates from April 2026 and may have changed after the June and September updates.

### FD07-F29 — A shared Claude artifact is the wrong thing to hand a jury
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** The Help Center says everyone needs a Claude account to open a shared artifact, even with the link, except legacy chat artifacts. On Pro and Max the choices are "Only you" or "Anyone with the link", and sharing cannot be changed from the mobile apps. The Claude Code docs instead describe a public link that anyone can open "with no claude.ai sign-in required". People with only the public link cannot see or add comments.
- **Implication for /frontend:** Judges may not have Claude accounts, and Anthropic's pages disagree on whether a public link needs one. The jury-facing deliverable is the deployed site. Canvases stay internal to the owner and teammate, both signed in.
- **Evidence:**
  - [Share artifacts](https://support.claude.com/en/articles/9547008-share-artifacts) — Anthropic Help Center, "Updated today", accessed 2026-09-30 — official documentation.
    - "Everyone needs a Claude account. People without one can't open a shared artifact, even with the link. The only exception is a legacy artifact published from a chat."
    - "Pro and Max plans: "Only you" or "Anyone with the link." To give specific people access, invite them by email."
    - "Note: You can't change sharing settings in Claude for iOS or Claude for Android."
  - [Share session output as artifacts](https://code.claude.com/docs/en/artifacts) — Anthropic, Claude Code docs, accessed 2026-09-30.
    - "Publicly: share a link that anyone on the internet can open, with no claude.ai sign-in required." (bold "Publicly" in original)
    - "If you share an artifact publicly, people whose only access is the public link don't see its comments and can't add any."
- **Limits / false positives:** The disagreement may reflect two kinds of artifact (Claude Code session pages versus template artifacts), although the Help Center article says it "covers every plan and every place you make artifacts: in a chat, from a template, and in Claude Code". It was not tested. Verification note: the Share artifacts page now reads "Updated this week".

### FD07-F30 — Claude Design builds a design system from code or examples, and Anthropic advises feeding real finished pages
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** Claude Design extracts components, colours, typography and patterns from codebases, screenshots and web flows, slide decks, and individual assets (logos, palettes, type specimens). Anthropic advises including real finished examples, such as a landing page or marketing site, not just specs. Claude Code suits existing React design systems; a conversation suits brand systems made of fonts, colours and guidelines. `/design-sync` brings in systems from GitHub, design files, uploads or a local codebase.
- **Implication for /frontend:** A new protocol has no brand source, so the conversation path fits, seeded with the tokens /frontend chose. Feeding sponsor-customer pages as "real examples" matches Anthropic's advice for conveying feel, but the Design type forbids reproducing another company's proprietary design (F23). /frontend should use those pages as pattern and value references and state the line explicitly.
- **Evidence:**
  - [Set up your design system in Claude Design](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design) — Anthropic Help Center, "Updated this week", accessed 2026-09-30 — official documentation.
    - "A design system captures your colors, typography, components, and layout patterns, so Claude applies them to every new design and deck. Claude extracts them from the assets you provide, like codebases, slide decks, or other design references."
    - "Include real examples, not just specs. A finished landing page or marketing site tells Claude more about your brand’s feel than a color palette alone."
    - (corrected: the dossier's first quote, "It extracts reusable components ... foundation for every project created within your account", and its "Updated over 3 weeks ago" label come from Exa's cached copy; the live page has been rewritten and no longer contains that sentence)
  - [Claude Design product page](https://claude.com/product/design) — Anthropic, accessed 2026-09-30 (FAQ read from raw HTML).
    - "You can create a design system using Claude Code, which works best for organizations with existing React design systems, or in any conversation with Claude, which works best for brand design systems with fonts, colors and brand guidelines."
  - [Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) — Anthropic Help Center, accessed 2026-09-30.
    - "Bring in one or several design systems from a GitHub repo, design files, raw uploads, or your local codebase using the /design-sync command in Claude Code."
- **Limits / false positives:** Anthropic's advice concerns one's own brand examples, not third-party sites.

### FD07-F31 — A practitioner's Claude Design to Claude Code "production playbook" bakes several of the owner's tells into its templates
- **Grade:** C · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** A practitioner's handoff playbook (a premium article; only its free portion was read) gives a landing-page prompt template that fixes "Features (3 blocks)" with "Icons: Lucide", IntersectionObserver-triggered animation, and "fictional titles and names" for social proof. Its hero "Visual" slot offers gradient mesh as one of three examples. Separately, its example CLAUDE.md block, which declares the author's own existing design system as authoritative, sets "Inter Variable" as the font stack and shadcn/ui as the only component library. It also describes a bundle layout (a `manifest.json` plus TSX components) that the observed bundle does not have (F28). (corrected: nothing shows the article is "widely shared"; gradient mesh is one example option, and Inter and shadcn/ui come from the author's own project declaration, not a general prescription; the fixed three-block feature row and fictional social proof were missing)
- **Implication for /frontend:** Community prompt templates for these tools carry the tells: three icon blocks in a row (tell 8), Lucide (10), fade-in on scroll (12), and, as defaults a reader may copy, gradients (1 and 20), Inter (4) and untouched shadcn (11). Invented testimonials also collide with the Design type's ban on filler and invented stats (F23). /frontend should never import a community template without running its prose and tokens through the tells checker.
- **Evidence:**
  - [The Claude Design to Claude Code Handoff — A Production-Ready Playbook](https://claudelab.net/en/articles/claude-ai/claude-design-claude-code-handoff-production-guide) — Masaki Hirokawa, Claude Lab, 2026-04-22, accessed 2026-09-30 — practitioner article.
    - "- Visual: [specific — gradient mesh / 3D cards / video background]"
    - "# Features (3 blocks)"
    - "- Icons: Lucide"
    - "- No real company names. Use fictional titles and names." (under "# Social proof")
    - "Declare your design system authoritatively in CLAUDE.md before you run the handoff:" (introducing the block with the font stack and component library below)
    - "- Animations: respect prefers-reduced-motion, IntersectionObserver-triggered"
    - "Font stack: "Inter Variable", system-ui, sans-serif"
    - "Component library: shadcn/ui (do not introduce a second library)"
    - "manifest.json       # design-system info: tokens, fonts, colors"
- **Limits / false positives:** This is one article, and the author's goal was production hygiene, not aesthetics.

### FD07-F32 — A GitHub repository posed as a "Claude Design" desktop app and has since disappeared
- **Grade:** D · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** A search index returned a repository, `claude-design-anthropic/claude-design`, describing a local app that sends data "directly to Anthropic's servers" and copies elements from any live website "for reverse engineering". On 2026-09-30 both the repository and its owner return HTTP 404. Anthropic documents Claude Design only on claude.ai/design, in the Claude apps and in Claude Code; the Help Center names no separate download.
- **Implication for /frontend:** /frontend must never download or run a "Claude Design" binary. Its only integration points are the Artifact tool, `/design`, and claude.ai.
- **Evidence:**
  - Exa `web_search_exa` result for "Claude Design web capture tool ...", indexed 2026-04-21, accessed 2026-09-30 — search-index snapshot of `https://github.com/claude-design-anthropic/claude-design`.
    - "calculates the delta of changes right on your computer and sends the final packet directly to Anthropic's servers."
    - "A built-in utility lets you copy design elements directly from any "live" websites for reverse engineering."
  - Command run 2026-09-30: `gh api repos/claude-design-anthropic/claude-design` and `gh api users/claude-design-anthropic`. Output for both: `{"message":"Not Found",...,"status":"404"}`.
  - [Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) — Anthropic Help Center, accessed 2026-09-30.
    - Section "Where you can use Claude Design" lists a conversation, the Artifacts tab, Claude Code, the Claude app for iOS and Android, and claude.ai/design.
- **Limits / false positives:** The repository's intent cannot be checked now. Treat it as a lure pattern, not as confirmed malware. Verification note: Exa's snapshot of the repository (created 2026-04-21, 27 stars, topics such as `claude-design-installer`, one release) tells users to download `ClaudeDesign-Optimized_x64.exe` or a `.dmg` from Releases. An identical copy existed at `anthropic-claude-design/claude-design` (created 2026-04-18); `gh api` and the web page return 404 for both on 2026-09-30.

### FD07-F33 — (added at verification) The Design type's long-form craft rules: settle the aesthetic with the user, sketch 2 to 4 named directions, and treat filler, data slop and generic landing copy as defects
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:** The Design type ships `artifact-type/reference/craft.md` (15,973 characters, release 1790780428-0f80). It can be read with the Artifact tool's `read` on the type's URL plus `path`. Without an aesthetic, references or a design system from the user, it tells the model to ask, or to sketch 2 to 4 genuinely different low-fi direction artboards, "rather than picking your own aesthetic (this is how you get slop)". Each option should explore a nameable axis and come with an honest tradeoff, and mocking a full product from scratch is "a LAST RESORT". It bans "data slop" (unnecessary numbers, icons or stats), lorem ipsum, "Welcome to our website" and "interchangeable marketing filler". It asks for one primary action per page. Its trope list names aggressive gradient backgrounds, emoji unless part of the brand, left-border accent containers, and "overused font families (Inter, Roboto, Arial, Fraunces)".
- **Implication for /frontend:** Anthropic's own guidance matches /frontend's intended flow: pick the direction first, ground it in the /hackathon references, show 2 to 4 named options with tradeoffs, and draw copy from the spec. It backs tells 3, 4, 5 and 17 and part of tell 1, and it adds Fraunces to the fonts to avoid. "Data slop" is a useful name for invented metrics on a hackathon landing page.
- **Evidence:**
  - Artifact tool, `action: read`, `url: https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd`, `path: artifact-type/reference/craft.md`, run 2026-09-30 — the type's own reference file, OBSERVED.
    - "Without an aesthetic, references, or a design system from the user, get their input before committing — ask, or sketch 2–4 genuinely different low-fi direction artboards they can SEE — rather than picking your own aesthetic (this is how you get slop)."
    - "Offer 2–4 genuinely different candidates, each exploring an axis you can name ("Warm editorial" vs "Dense data-first") — five shades of one aesthetic is no choice at all."
    - "Give each option an honest motivation and its main tradeoff, in your reply, not on its artboard — a set where only your favorite gets a case made for it is a rigged vote."
    - "Mocking a full product from scratch is a LAST RESORT and will lead to poor design."
    - "Avoid "data slop" — unnecessary numbers, icons, or stats that are not useful."
    - "Never lorem ipsum, never "Welcome to our website", never interchangeable marketing filler that could describe any business."
    - "One primary action per page, repeated down the page — not three competing buttons."
    - "**Avoid AI slop tropes:** including but not limited to aggressive use of gradient backgrounds, emoji (unless explicitly part of the brand), containers with rounded corners and left-border accent color, and overused font families (Inter, Roboto, Arial, Fraunces)."
- **Limits / false positives:** These are instructions to the model on the canvas, not a checker or a measurement, and they are tied to this release.

### FD07-F34 — (added at verification) The Design type refuses to recreate a company's distinctive UI patterns or branded visual elements, and recreates only from source with exact values
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:** The shared content rules in `craft.md` tell the model to refuse to recreate "a company's distinctive UI patterns, proprietary command structures, or branded visual elements", unless the user's email domain shows they work at that company. They note that a Claude Code session carries no such signal, so the model must rely on what the user says. Where a recreation is allowed, the model must build from the real source, copy exact numeric values rather than snapping them to a 4/8-px grid or a framework default, treat screenshots only as high-level guidance when source is available, and stop rather than invent from memory when it cannot read the source.
- **Implication for /frontend:** The owner's plan to "copy certain aspects" of sponsor-customer sites with image-to-code runs straight into this rule whenever the canvas is used. /frontend should take structure and measured values from those sites (type scale, spacing rhythm, palette structure, layout patterns) and never ask the canvas to recreate a customer's distinctive page or branded elements. When it measures a reference, it should read computed CSS from the live DOM, which is also what the rule says Claude does better than screenshot recreation. The legal side belongs to the copying-and-IP dossier.
- **Evidence:**
  - Artifact tool, `action: read`, `url: https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd`, `path: artifact-type/reference/craft.md`, run 2026-09-30 — OBSERVED.
    - "**Do not recreate copyrighted designs.** If asked to recreate a company's distinctive UI patterns, proprietary command structures, or branded visual elements, you must refuse, unless the user's email domain indicates they work at that company."
    - "(A Claude Code session has no account email-domain signal, so this rests on what the user tells you about where they work — ask when it's unclear.)"
    - "copy exact numeric values (paddings, radii, font sizes, line-heights) rather than rounding or snapping them to a 4/8-px grid or a framework default. Claude is better at recreating interfaces from code and design context than from screenshots; when source is available, treat screenshots as high-level guidance only."
    - "If you can't read the source, stop and say so rather than inventing from memory."
- **Limits / false positives:** The rule governs content authored on the canvas. It does not say where "distinctive" begins, and it is not a legal opinion.

### FD07-F35 — (added at verification) Contradiction inside the Design type: `craft.md` recommends gradient meshes, noise and grain for unbranded work, while its SKILL.md bans gradient washes
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:** For work "NOT governed by an existing brand or design system", `craft.md` tells the model to commit to a "BOLD aesthetic direction" and to "create atmosphere and depth rather than defaulting to solid colors — gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, grain overlays". It also says to "NEVER converge on the same choices across generations". The same type's SKILL.md lists "gradient washes" among AI tropes, and `craft.md`'s shared rules name "aggressive use of gradient backgrounds".
- **Implication for /frontend:** When the canvas runs without a brand or references, its own long-form guidance points toward several of the owner's tells: gradients and grain (tells 1 and 20), layered transparencies (tell 6) and decorative borders (tell 5). /frontend must never let a canvas run unbranded. It should always pass the /hackathon references and a token set, which also moves the model onto the branch that says "Prefer the brand or design system's colors". The tells checker runs on the built site whatever the canvas produced.
- **Evidence:**
  - Artifact tool, `action: read`, `url: https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd`, `path: artifact-type/reference/craft.md`, run 2026-09-30 — OBSERVED.
    - "Use this guidance when designing work that is NOT governed by an existing brand or design system — and commit to a BOLD aesthetic direction before building:"
    - "**Backgrounds & visual details**: create atmosphere and depth rather than defaulting to solid colors — gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, grain overlays."
    - "Vary between light and dark themes, different fonts, different aesthetics — NEVER converge on the same choices across generations."
    - "Accents: 0–2, in oklch, sharing chroma and lightness, varying hue. Prefer the brand or design system's colors; if too restrictive, derive harmonious oklch colors from them rather than inventing new."
  - Design type SKILL.md, read with the Artifact tool on 2026-09-30 (release 1790780428-0f80) — OBSERVED.
    - "No AI tropes (gradient washes, left-border cards, emoji; Inter, Roboto, Arial)."
- **Limits / false positives:** "Aggressive use" and "gradient meshes" can be reconciled by degree, but neither file says how. The observed effect on outputs was not measured.

## Assessment and recommendation for a 24 to 48 hour build with two developers

The rows below apply the findings to the steps named in the brief. "Pick" is this dossier's recommendation, not a sourced finding.

| Step | Claude Design (Design / Design System artifacts, `/design`) | Figma MCP | Pick |
|---|---|---|---|
| Direction exploration, before the build | Native: 2 to 4 named directions as artboards side by side, no setup, and its own craft notes ask for exactly that (F22, F33). Costs shared quota (F19, F20). Its instructions call cream, serif display and clay the model's habit (F24), and push unbranded work toward gradient meshes and grain (F35). | Needs a Figma file. `use_figma` needs a Full seat outside drafts, is in beta and has no image support (F12). No fidelity gain, 42% slower (F15). | Claude Design, with the brief pinned to /hackathon's customer references |
| Inspiration from sponsor-customer sites | Web capture exists but is worded for "your website" (F17). Rules against another company's proprietary design and against recreating a company's distinctive UI patterns or branded elements (F23, F34). | `generate_figma_design` into drafts is exempt from rate limits and needs Playwright injection for live sites (F08). Captures are flat layers (F09). html.to.design allows 10 free imports (F11). | Neither is required. Extract from the live DOM (another dossier's method). A Figma moodboard is optional, when a human wants to annotate. |
| Logo exploration | Inline-SVG candidates as artboards. Take the SVG from the artboard source; per-artboard exports are PNG or PDF, and whether a .zip or standalone-HTML export keeps it intact was not tested (F22). The Design System type records a mark but never invents one (F26). | Hand vector editing is strong but needs a designer. `download_assets` exports SVG at the cost of read calls (F02, F04). | Claude Design for choosing; the SVG lives in the repo |
| Review on a phone | View only in the Claude apps; edit and share need web or desktop (F16). Two simultaneous editors is unreliable (F21). | Figma app: view and comment on any plan (F16). | The deployed preview URL on the phone; the Design artifact only to pick directions |
| Single source of truth for tokens | The Design System artifact is a browsable mirror with list-shaped tokens, not DTCG (F26). | Figma variables through `get_variable_defs`, only if a structured file exists (F14). | The repo's token file, mirrored to a Design System artifact on request |
| Build and verify | The canvas is told never to verify (F25). The handoff README says to ask the user and not screenshot (F28). | React + Tailwind intermediate with fixed widths; re-translating it into project conventions is where fidelity was lost in the one measurement (F03, F14). | /frontend builds in the repo and verifies with Playwright on the site |
| What the jury sees | Artifact links need a Claude account per the Help Center (F29). | Figma links need Figma access. | The deployed site only |

**Cost in money.**
- Claude Design costs nothing beyond the Claude plan; extra usage applies only if usage credits are enabled (F19).
- Figma costs nothing on Starter, which allows 20 read calls a month (F04). A paid Dev seat is rendered at $12 a month and a Full seat at $16 on Professional, both per month under annual billing; the monthly-billing prices were not visible (F04).
- html.to.design is free for about 10 imports, or $18 a month billed monthly (F11).

**Cost in time.**
- Claude Design needs no setup (F18, F22). Its hidden cost is quota shared with the build agents. At launch, under the old separate meter, about 25 minutes of iteration used 80% of a Pro weekly allowance (a rebuild after a user mistake used the rest), and ingesting a design system took 77% of one (F20).
- Figma needs one command plus an interactive OAuth when it works (F06). The documented and reported failure modes are tools missing from the tool list, stuck captures and unexplained quota errors (F05, F07), and each can cost an unmeasured number of hours.

**Failure modes to design around.**
- Figma: an invisible, tiny quota on the free plan (F05); desktop-entry shadowing (F06); capture hangs and missing tools (F07); captures without component or style mapping, and flat files that produce poorly structured code (F09); fixed pixel widths in the design-context output (F14); fixed-frame compositions that do not fill a viewport (F15).
- Claude Design: the model's habitual look, and gradient meshes and grain in unbranded work (F24, F35); quota drain (F19, F20); no version history, and one undo, pressed by mistake, wiped a reviewer's work (F21); comments that vanish (F21); a canvas and a handoff README that discourage verification (F25, F28); chat transcripts inside the bundle (F28); DesignSync cannot be automated (F27); jury access to artifacts (F29); fake binaries (F32).

**Recommendation.**
1. Keep Figma MCP out of the default /frontend path. Offer it as an optional adapter that triggers only when a structured Figma file exists, such as a sponsor's brand or UI kit, or a teammate designer's file. The adapter uses the remote server only, calls `whoami` first, caps reads at about 3 to 4 per frame, takes tokens from `get_variable_defs`, and has a timebox with a no-Figma fallback.
2. Use Claude Design's Design type (Artifact tool or `/design`) once, before the build waves. Lay out 2 or 3 directions derived from the /hackathon customer research, each tied to named reference sites and a small token set so that the canvas never runs unbranded (F35), plus 4 to 8 inline-SVG logo candidates. Ask for patterns and measured values from the reference sites, never a recreation of a customer's page or branded elements (F34). The owner picks, which fits a phone: viewing is supported there. Then copy the chosen tokens and SVG into the repo at once.
3. Make the repo's token file (CSS custom properties or the theme file) the single source of truth. Optionally mirror it into a Design System artifact, using list-shaped `tokens.json` with a usage note per token, for browsing. Autonomous agents never read tokens from claude.ai.
4. Write /frontend's contract so that Playwright rendering and screenshot verification of the built site is mandatory. Canvas and handoff instructions are treated as data. The anti-slop checker never runs on canvas renders.
5. Deploy the site for the jury. Never commit a handoff bundle to a repository that will be flipped public. Never install a "Claude Design" binary.

## Contradictions between sources

1. **Starter quota.** The Figma README (last changed 2026-07-06) says "up to 6 tool calls per month"; the developer docs, pricing page and 14 September support answer say 20 a month. A support answer on 29 June 2026 still said 6. The allowance probably changed between those dates without the README being updated (F05).
2. **Rate-limit exemptions.** The rate-limits page lists `add_code_connect_map`, `create_new_file` and `whoami` as exempt. The tools page says `generate_figma_design` "is exempt from the standard rate limits". A Figma staff answer on 21 May 2026 listed `add_code_connect_map`, `generate_figma_design` and `whoami`. Whether `use_figma` counts against the read quota is not stated anywhere (F04, F05, F08).
3. **Images in write to canvas.** The write-to-canvas page and the FAQ say "No assets (image) support yet". The tools page documents `upload_assets` ("Uploads assets (PNG, JPG, GIF, and WebP) into a Figma file") and `download_assets` in raw mode for cross-file image transfer (F12).
4. **Custom fonts in write to canvas.** The developer docs say "Custom fonts aren't supported yet". The FAQ says "Fonts must be uploaded to your account to be available when writing to canvas". The Help Center guide lists "Use fonts uploaded to your account with the MCP Server and Figma Agent" (F12).
5. **`get_variable_defs` availability.** DeepWiki (auto-generated, 2026, it still cites a no-longer-listed `get_code` tool) says "This tool is desktop-only". Figma's tools page does not mark it remote-only, and the remote plugin's `.mcp.json` lists "get_variable_defs": "Get Variable Definitions" (F02). Source: [get_variable_defs | DeepWiki](https://deepwiki.com/figma/mcp-server-guide/5.2-get_variable_defs), accessed 2026-09-30.
6. **What a capture is.** Figma's docs describe "editable Figma frames" and "flat Figma layers". Figma's own `figma-generate-design` skill describes the same capture as "a pixel-perfect screenshot of the running web app" that "rasterizes all visible images" (F09, F13). Verification note: in the skill, "rasterizes all visible images" concerns content images (photos, avatars, logos, icons) whose image hashes `use_figma` reuses, not the whole page; only the "pixel-perfect screenshot" wording conflicts with the docs.
7. **Chrome extension availability.** The article header says "Available on all plans", but capture "turns on automatically once you're signed in to a paid plan", and troubleshooting says "ensure you have a paid plan" (F10).
8. **html.to.design free tier.** "Up to 10 imports every 30 days" (PRO page) against "12 free imports a month" (overview page) (F11).
9. **Claude Design plan availability.** The 16 September 2026 release notes say "available on every plan, including Free". The artifacts article says templates are "in beta on paid plans only". Getting started says "Pro, Max, Team, and Enterprise". The product page says "included in all paid plans". The June blog's "Update, September 2026" note says "in beta on paid plans" (F18).
10. **Claude Design default state.** Getting started says it is "on by default on Pro, Max, and Team plans". The product page says "Admins must turn it on in Organization settings" (F18).
11. **Access to shared artifacts.** The Help Center says "Everyone needs a Claude account ... even with the link". The Claude Code docs say "Publicly: share a link that anyone on the internet can open, with no claude.ai sign-in required" (F29).
12. **Handoff bundle format.**
    - The observed bundle and the OrchestKit specification: a README, `chats/` and `project/*.html`.
    - Claude Lab: `manifest.json`, `pages/`, `components/` (TSX), `assets/`, `preview.mp4`, `build.log`.
    - A community skill file expects `layout.json`, `tokens.json`, `components.md` and `preview.png`.
    - A pipeline connection spec states that the format is undocumented, and records the prompt that "Send to local coding agent" produces.

    Anthropic's own pages describe no format (F28, F31). Sources:
    - [skills/automation/claude-design.md](https://github.com/Claudient/Claudient/blob/main/skills/automation/claude-design.md), rendered under repository UitbreidenOS/UitKit, frontmatter "updated: 2026-06-13", accessed 2026-09-30 (grade D): "# Expect: layout.json, tokens.json, components.md, preview.png".
    - [get-design-done connections/claude-design.md](https://cdn.jsdelivr.net/npm/@hegemonart/get-design-done@1.60.4/connections/claude-design.md), npm package version 1.60.4, accessed 2026-09-30 (grade C): "Handoff bundle format is undocumented by Anthropic." and "Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/<hash>".
13. **`/design-sync` semantics and token format.** The observed DesignSync tool has list, read, plan and write methods for claude.ai/design projects, gated by the user. Skills-Hub describes `/design-sync pull` and `push` that write `.claude/design-system/`. It also says GitHub repo import follows the "W3C Design Token Community Group format", while the Design System type says a DTCG map "is valid JSON the page CANNOT read" (F26, F27).
14. **Usage metering over time.** April reviews describe "a separate weekly meter", and the Help Center now says Design "counts toward the same usage limits ... including Claude Code". This is a documented change on 17 June 2026, not an error, but it makes the April measurements (F20) an imperfect guide.
15. **canicode's MCP fidelity figure (added at verification).** The wiki comparison page (created 2026-04-01) lists `get_design_context` at 82%. The same author's Experiment 03 page shows the 82% came from an MCP → AI → HTML conversion that he removed on 2026-03-27 as an "irrelevant comparison", and reports 94% (94 to 98% across six fixtures) for MCP's code built directly with Vite (F14).
16. **Design export formats (added at verification).** The Claude Code docs say "You can export each artboard as PNG or PDF". The Help Center's artifacts article says designs "export as a .zip, PDF, PowerPoint, or standalone HTML, or go straight to another tool". The two may describe different scopes (one artboard against the whole design), which neither page says (F22).
17. **Where `/design-sync` writes (added at verification).** The DesignSync tool definition scopes it to "the user's claude.ai/design design-system projects". The live Help Center presents `/design-sync` as the Claude Code route to create a design system in the integrated feature, whose systems are artifacts. Which store it writes to in Claude Code 2.1.286 is unresolved (F27).
18. **Figma plugin version (added at verification).** The marketplace pins the `figma` plugin to commit 17292073, where `plugin.json` says 2.2.120; `main` says 2.2.124 (F06).
19. **Gradients in the Design type (added at verification).** SKILL.md lists "gradient washes" among AI tropes and `craft.md`'s shared rules name "aggressive use of gradient backgrounds", while `craft.md`'s guidance for unbranded work recommends "gradient meshes, noise textures ... layered transparencies ... decorative borders, grain overlays" (F35).

## What could not be found, and how it was searched

- **Anthropic documentation of the handoff bundle format.** Searched the Anthropic Help Center (Get started, Set up your design system, artifacts, share, release notes), claude.com (product page, June blog), the Claude Code artifacts docs, and Exa for "handoff bundle contents". Only third-party descriptions exist (F28).
- **Whether `use_figma` calls count against the read quota.** Searched Figma's rate-limits page, tools page, FAQ, write-to-canvas page and forum threads. No statement found.
- **Whether `use_figma` works on the free Starter plan.** Figma's seat documentation covers Full and Dev seats but never addresses Starter. The same searches as above found nothing more.
- **Measured Claude Design cost after the 17 June 2026 pooling change.** Exa searches for measured consumption returned only April 2026 reports. The claim that per-turn usage was cut appears in a secondary source (Skills-Hub: "The June 17 update cuts token usage per turn with measurably fewer errors") but not in the Anthropic blog text that was opened.
- **Whether Claude Design's web capture tool is meant for third-party sites.** Anthropic's text says "from your website". Third-party guides say "any website". No official statement either way was found.
- **Whether comments can be added to a Design artifact from the Claude mobile apps.** The Help Center only states viewing.
- **Whether an Artifact or `/design` publish from a non-interactive /execution subagent raises a permission prompt.** The Claude Code docs describe prompts the user types. The Design type declares runtime capabilities, which the docs say can trigger review.
- **The Design type's reference files (`craft.md`, `format.md`, `brand-typography.md`).** The researcher's Artifact `read` with those paths on the type URL returned "artifact not found". (corrected at verification: `craft.md` is readable with `action: read`, `url` set to the type's URL and `path: artifact-type/reference/craft.md`; it was read and yields F33 to F35. `format.md` and `brand-typography.md` were not read.)
- **Whether Figma's injected capture script is blocked by strict Content Security Policy on third-party sites.** Only a one-star community repository description ("bypassing CSP") was found, without explanation. Not relied on.
- **The billing interval of Figma's rendered Professional prices.** (resolved at verification: the static HTML's toggle reads "Show annual billing prices: Annual selected", so the rendered prices are per month under annual billing; the monthly-billing prices are still not visible without running the page's script, F04)

## Weak spots of this dossier

- Nothing was exercised end to end: no Figma OAuth, no capture, no `use_figma`, no `/design` run. Behaviour claims are documented or reported, not tested. Only the tool definitions, type instructions, raw HTML tables, repository files and command outputs were observed directly.
- Kind convention: ASSERTED marks vendor documentation that was read but whose behaviour was not exercised; OBSERVED marks files or command outputs read directly.
- Vendor documentation moved fast during 2026. Figma's quota changed within three months, and Anthropic's pages contradict each other on plan availability and public access. Every number here should be re-checked before an event.
- The measurements are thin: Braintrust is one evaluator on 67 designs, canicode one design whose author contradicts himself on the MCP figure, zenn one screen, and PCWorld and Techloy are single users under the old metering.
- At least one quote (F30) came from Exa's cached copy of a Help Center page that has since been rewritten. Cached text can look current; the live pages were re-fetched at verification.
- The handoff bundle was observed through a third-party repository with 2 stars, from April 2026, and could be edited or outdated.
- An automated summariser misread Figma's Organization quota as 600/day. The raw HTML was used instead, but other summarised pages may hide similar slips; verbatim quotes were taken from full-text fetches wherever possible.
- The Design and Design System type instructions are tied to specific releases (1790780428-0f80 and 1790789551-8144) and may change without notice.
- The Assessment section's picks and budgets (2 or 3 directions, 4 to 8 logo candidates, 3 to 4 reads per frame) are this dossier's recommendations, derived from the findings rather than measured.

## Dropped at verification

None. Every finding's sources resolved, and no finding rested only on a source that failed verification. Where a quote or claim was wrong, the finding was corrected in place.

## Verification notes

**Method.** Every finding's cited sources were re-opened on 2026-09-30 and checked for resolution, verbatim quotes, numbers, dates, versions, attribution and overreach.
- Figma developer docs (intro, tools and prompts, both install pages, rate limits, code to canvas, write to canvas) were downloaded raw with `curl`, converted to text locally, and each quote was grepped. The rate-limit table was parsed from its `<table id="rate-limits-tier-table">`.
- Figma Help Center articles were read through the Zendesk JSON API (`help.figma.com/api/v2/help_center/en-us/articles/<id>.json`), which also gives created, edited and updated dates.
- The Figma pricing page was searched in its raw HTML for quota strings, prices and the billing toggle's aria-label.
- GitHub sources were read with `gh api` and `raw.githubusercontent.com`: the figma/mcp-server-guide README, `.mcp.json`, `plugin.json` and skill files, their commit histories, and the files at the marketplace-pinned commit. The same applies to Anthropic's marketplace.json, the handoff-cdn bundle, README, CLAUDE.md and CONTRIBUTING.md, and the 404 checks. The canicode wiki was cloned blob-less (history only) to date its pages and read commit 21fa72e.
- Anthropic Help Center pages, the Claude Code artifacts docs (`.md` endpoint), the announcement, the product page (FAQ JSON-LD) and the June blog were fetched live. The Design and Design System type instructions and the Design type's `craft.md` were read with the Artifact tool. The DesignSync definition was loaded with ToolSearch, and `claude --version` was run.
- Forum threads, press articles (PCWorld, Techloy, CNBC), Braintrust, zenn, html.to.design, Claude Lab, OrchestKit, Skills-Hub, get-design-done (jsDelivr) and the Claudient/UitKit skill file were fetched and grepped, with bylines and dates taken from page metadata. DeepWiki and the vanished lure repositories were read through Exa.

**What changed, in short.**
- The biggest correction is F14: the 82% `get_design_context` figure behind the dossier's "lossy step" claim was withdrawn by its own author, whose experiment page reports 94 to 98% for the MCP code rendered as-is.
- Two quotes were misattributed to Figma developer pages they do not appear on (F12).
- One Anthropic quote came from a stale Exa cache (F30).
- A version was taken from `main` rather than the marketplace pin (F06).
- Several findings overreached their sources: the Inter mechanism (F13), the "untouched" bundles (F28), a "bare brief" that was followed by style questions (F24), the "server-side" July outage (F07), "widely shared" and "prescribes" (F31), "only PNG or PDF" (F22), and "separate stores" (F27).
- The Design type's `craft.md`, which the dossier listed as unreadable, was read and added three findings (F33 to F35), including a contradiction inside Anthropic's own canvas guidance.

**Sources that could not be opened.** None of the cited sources failed outright. Techloy's article is member-only after its opening paragraphs, and Claude Lab's article is premium after its first sections; only their free portions were read, and all quoted lines are in those portions. The two lure repositories return 404 and were read only as Exa snapshots.

**Residual doubts.**
- The Starter quota's change date (6 to 20 calls) is inferred from two forum answers. The rate-limits page is undated, and no archived copy was checked.
- F27: which store `/design-sync` writes to in Claude Code 2.1.286 could only be settled by running it, which was out of scope.
- F22: whether a .zip or standalone-HTML export of a Design artifact carries the artboards' inline SVG was not tested.
- The addition date of `upload_assets` was not established (F02).
- F29's contradiction on public artifact links remains unresolved without a test from a signed-out browser.
- The Help Center pages change weekly ("Updated this week" on most of them), so every Anthropic quote here is a 2026-09-30 snapshot.
