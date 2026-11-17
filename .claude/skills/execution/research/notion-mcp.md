# Notion MCP as the shared plan and the phone-readable progress log

Dimension researched for the `/execution` skill design: the Notion MCP connector ("claude.ai Notion", hosted server
`https://mcp.notion.com/mcp`) as the shared task plan, the per-wave progress log read from a phone, and the channel through
which a developer answers manual tasks.

Research run: 2026-09-30, Claude Code 2.1.285 (native binary) on Windows 11, executed from inside a workflow subagent.
Notion was used strictly read-only: two `notion-get-tool-access` calls and one `notion-get-users {"user_id":"self"}` call.
Nothing was created, updated, moved, commented or uploaded. No Notion workspace content is reproduced here; the identity
details returned by `get-users` (name, e-mail, id) and the account/space identifiers embedded in upgrade links are omitted.
No headless (`claude -p`) experiment was run, because the brief did not allow experiments; it is listed as a rehearsal step.

Confidence vocabulary: **verified-executed** (I ran it and saw the result), **verified-source** (read in the live tool
schema, the official docs, or the installed binary), **reported** (vendor statement I could not test), **inferred**
(my reasoning, not sourced).

---

## Summary for the designer

1. Every tool /execution needs (create-database, create-pages, update-page, update-data-source, create-view, fetch,
   get/create-comment, get-async-task) is `available` on this connection. What is gated is optional: AI search, multi-source
   SQL, meeting notes, and SQL queries, which carry an undisclosed workspace quota (`available_with_limit`). Poll with
   **view-mode** queries: they are the only reads documented as quota-free on every plan.
2. The data model fits: SELECT with declared options for the state machine (MCP DDL cannot declare STATUS options),
   a self-RELATION for dependencies (two calls), PEOPLE, URL, NUMBER, CHECKBOX, RICH_TEXT (2,000 characters per object),
   FORMULA, and boards, filters, charts and timelines through `create-view`. DATE has no time-zone key through the MCP.
3. There is no concurrency control: each property is last-write-wins, there is no version or compare-and-set,
   `last_edited_time` is rounded down to the minute, and MCP writes carry the user's own identity (`type: person`).
   Notion therefore cannot tell an orchestrator's write from a phone edit, or orchestrator A from orchestrator B.
4. `create-pages` takes up to 100 rows per call, but `update-page` updates exactly one page per call, and writes can
   return async tasks. The budget is 180 MCP calls/min per user, shared by every subagent on the same connection.
5. Any subagent (foreground, background, workflow) and `claude -p` with a claude.ai login can reach the connector.
   Scripts cannot: MCP OAuth is interactive-only, and a rejected token needs `/login` at the terminal, not from the phone.
   Workflow agents run in acceptEdits plus the allowlist, so their Notion writes may prompt mid-run.
6. From the phone the user can read reports and edit, tick and comment. Nothing pushes into Claude Code, so the
   orchestrator polls one filtered view. Notion does not notify the user of his own (orchestrator) writes: use
   PushNotification over Remote Control, which also takes photos directly.
7. Two developers: a Free workspace with 2+ members is capped at 1,000 lifetime blocks, so dev B must be a guest or the
   plan upgraded. Each MCP connection is bound to one workspace, and the tool-name prefix differs if a dev adds Notion
   locally rather than through claude.ai.
8. **Recommendation:** make a repository file the source of truth: git push acts as the compare-and-set, the completion
   check runs offline, a crash recovers from disk, and the history lives in git. Notion becomes a mirror written only by
   each dev's orchestrator at wave boundaries, plus a typed input channel (human-owned fields and comments) that is
   ingested into the repo before anything acts on it.

---

## Findings

### A. Tools, gating and documentation

**F01 — The tools /execution needs are available on this connection; the gated ones are optional.**
- Evidence: `mcp__claude_ai_Notion__notion-get-tool-access {}` (executed 2026-09-30) returned, among others:
  `"create_database":{"status":"available"}`, `"create_pages":{"status":"available"}`,
  `"update_page":{"status":"available"}`, `"update_data_source":{"status":"available"}`,
  `"create_view":{"status":"available"}`, `"update_view":{"status":"available"}`, `"fetch":{"status":"available"}`,
  `"get_comments":{"status":"available"}`, `"create_comment":{"status":"available"}`,
  `"get_async_task":{"status":"available"}`, `"create_attachment":{"status":"available"}`,
  `"create_file_upload":{"status":"available"}`, `"query_data_sources":{"status":"available_with_limit",...}`,
  `"query_multiple_data_sources":{"status":"full_version_required",...}`, `"ai_search":{"status":"plan_required",...}`,
  `"query_meeting_notes":{"status":"plan_required",...}`, and for `search`:
  `"sort":"Sorting other than relevance requires Business or Enterprise."`,
  `"filters.last_edited_date_range":"Filtering by last edited date requires Business or Enterprise."`
- Confidence: verified-executed. Load-bearing: yes.

**F02 — Of the three read modes, only view mode is documented as quota-free on every plan.**
- Evidence (live description of `notion-query-data-sources`): "Limits: View mode is available without a tool-specific
  quota on every plan. SQL is unlimited on Business and Enterprise plans with Notion AI. Other plans have a shared
  workspace usage limit for single-data-source queries and cannot query multiple data sources at once." Rows mode:
  "Return up to 100 rows with faithful rich-text property values and optional structured filters and sorts." View mode:
  `page_size` "(default: 100, max: 100)" plus `start_cursor`. SQL mode: "SQL text properties are lossy: mention tokens and
  formatting can be omitted, and links can lose their destination." The size of the "shared workspace usage limit" is not
  published: two web searches found no official number.
- Confidence: verified-source (live server). Whether rows mode counts against the SQL quota is an open question.
- Load-bearing: yes.

**F03 — The Custom Agent session tools, `search_agents` and the two upsell tools are not exposed to this connection.**
- Evidence: a second `notion-get-tool-access` call naming `spawn_session`, `get_session_status`, `wait_session`,
  `send_message_to_session`, `stop_session`, `list_session_events`, `read_session_event`, `query_sessions`,
  `search_sessions`, `search_agents`, `check_mcp_next_steps` and `show_advanced_analysis_next_steps` returned none of them.
  The tool's contract says: "Unknown names and tools not exposed to this connection are omitted."
- What the other tools do (from their live descriptions):

| Tool | What it does | Use in /execution |
| --- | --- | --- |
| `notion-query-multiple-data-sources` | Read-only SQLite JOIN/UNION across 2+ data sources; "requires a Business or Enterprise plan with Notion AI" | none (gated) |
| `notion-move-pages` | Move up to 100 pages or databases to a new parent | only to relocate a mistaken draft |
| `notion-duplicate-page` | Duplicate a page; "completes asynchronously" | could clone a hub template (optional) |
| `notion-update-view` | Change a view's name, filters, sorts, grouping; `CLEAR FILTER`, `CLEAR SORT`, `CLEAR GROUP BY` | adjust views |
| `notion-create-attachment` | Upload a text file (inline, 200 KiB max) or a public URL (5 MiB free, 50 MiB paid); returns `markdown_source` | optional HTML/MD attachment |
| `notion-create-file-upload` | Short-lived URL for one local file up to 20 MiB (multipart POST) | screenshots into Notion |
| `notion-download-attachment` | Download a text attachment "created by the Notion MCP create-attachment tool" (200 KiB) | none |
| `notion-get-async-task` | Poll a task returned by an `allow_async` write: queued, running, retrying, succeeded, failed | confirm writes |
| `notion-spawn-session` and the session tools | Start, wait (60 s max), message, stop and read Notion **Custom Agent** sessions | none (not exposed) |
| `notion-create-folder`, `notion-update-folder` | Notion Folders for files | none |
| `notion-list-private/shared/favorite/recent-pages` | Browse sidebar sections | dev B can find a shared hub |
| `notion-convert-page-to-skill`, `notion-upload-skill`, `notion-download-skill` | Notion Skills | none |
| `notion-check-mcp-next-steps`, `notion-show-advanced-analysis-next-steps` | Upgrade cards, called "Only when a Notion fetch result instructs you to" | never, in autonomous mode |

- Confidence: verified-executed (exposure), verified-source (purposes). Load-bearing: no.

**F04 — The public Notion MCP docs lag behind the live server; trust `get-tool-access` at runtime.**
- Evidence: https://developers.notion.com/docs/mcp-supported-tools says of `notion-query-data-sources`: "Requires
  Enterprise plan with Notion AI." It also lists `notion-get-user`, `notion-get-self` and `notion-query-database-view`,
  none of which the live server exposes. The live server reports `query_data_sources` as `available_with_limit` on a
  non-Business workspace.
- Confidence: verified-source. Load-bearing: no.

**F05 — Claude Code truncates every long Notion tool description at 2 KB, so exact formats must come from elsewhere.**
- Evidence: https://code.claude.com/docs/en/mcp: "Claude Code truncates tool descriptions and server instructions at 2KB
  each. Keep them concise to avoid truncation, and put critical details near the start." Observed: the loaded schemas of
  `notion-create-pages`, `notion-update-page`, `notion-query-data-sources`, `notion-fetch`, `notion-create-database`,
  `notion-create-view`, `notion-create-comment` and `notion-create-attachment` all end with "... [truncated]".
  `notion-create-database`, for example, is cut inside its self-relation example, and `notion-fetch` at "Databases return all dat".
  The server's six documentation resources are complete when read with `ReadMcpResourceTool` (or `notion-fetch` with the
  `notion://docs/...` URI): `enhanced-markdown-spec`, `view-dsl-spec`, `database-page-layouts`, `setup-prompt`, `skills`,
  `when-to-create-a-notion-page-or-database`.
- Confidence: verified-source and verified-executed. Load-bearing: yes.

### B. Data model

**F06 — The DDL and value formats cover what a task graph needs, including a self-relation for dependencies (two steps).**
- Evidence (`notion-create-database` description): "Simple: TITLE, RICH_TEXT, DATE, PEOPLE, CHECKBOX, URL, EMAIL,
  PHONE_NUMBER, STATUS, FILES - SELECT('opt':color, ...) / MULTI_SELECT('opt':color, ...) - NUMBER [FORMAT 'dollar'] /
  FORMULA('expression') - RELATION('data_source_id') — one-way relation - RELATION('data_source_id', DUAL) — two-way
  relation ... RELATION('data_source_id', DUAL 'synced_name' 'synced_id') — two-way with synced name and ID (for
  self-relations) - ROLLUP('rel_prop', 'target_prop', 'function') - UNIQUE_ID [PREFIX 'X'] / CREATED_TIME /
  LAST_EDITED_TIME - Any column: COMMENT 'description text'". Also: "Self-relation (two-step: create database first, then
  use its data source ID with update_data_source to add self-relations)". The `notion-update-data-source` example:
  `ADD COLUMN "Parent" RELATION('f336d0bc-...', DUAL 'Children' 'children'); ADD COLUMN "Children" RELATION('f336d0bc-...', DUAL 'Parent' 'parent')`.
- Value formats (`notion-update-page`): "Date properties: Split into "date:{property}:start", "date:{property}:end"
  (optional), and "date:{property}:is_datetime" (0 or 1)"; "Number properties: Use JavaScript numbers (not strings)";
  "Checkbox properties: Use "__YES__" for checked, "__NO__" for unchecked"; "Relation properties: Use an array of related
  page URLs or page IDs"; "Person properties: Use an array of user IDs, user or agent URLs, or group references"; "Files
  properties: Use a JSON array of file IDs ..."; "Properties named "id" or "url" (case insensitive) must be prefixed with
  "userDefined:"". Also: "Use null to remove a property's value."
- Confidence: verified-source. Load-bearing: yes.

**F07 — STATUS options cannot be declared through the MCP DDL; SELECT options can.**
- Evidence: the MCP DDL lists STATUS among the "Simple" types (no options syntax), while SELECT takes
  `('opt':color, ...)`. On the REST side (https://developers.notion.com/reference/property-object): "When creating a status
  property without specifying options, defaults ("Not started", "In progress", "Done") with groups ("To-do", "In progress",
  "Complete") are created. ... To rename, reorder, or otherwise reconfigure groups, use the Notion UI."
- Confidence: verified-source (REST), inferred for the MCP (the syntax shown has no STATUS options form).
- Load-bearing: no. Implication: model the /execution state machine as a SELECT; board views can group by it.

**F08 — Date properties have no time-zone key through the MCP; page content can carry an IANA zone.**
- Evidence: REST date values accept `time_zone`: "The time zone of the date object, if any. E.g. America/Los_Angeles,
  Europe/London, etc." (https://developers.notion.com/reference/patch-page OpenAPI). The MCP exposes only
  `date:{property}:start`, `:end` and `:is_datetime` (quote in F06). Page content supports
  `<mention-date start="YYYY-MM-DD" startTime="HH:mm" timeZone="IANA_TIMEZONE"/>`, and "startTime requires timeZone;
  without timeZone the time is dropped" (`notion://docs/enhanced-markdown-spec`).
- Confidence: verified-source. How a `+08:00` datetime written through the MCP displays on the phone is untested.
- Load-bearing: no.

**F09 — Views, including a board grouped by state and a filter by owner, can be created through the MCP.**
- Evidence (`notion-create-view`): "Supported types: table, board, list, calendar, timeline, gallery, form, chart, map,
  dashboard." "GROUP BY "Property" — group by property (required for board views)". "FILTER "Property" = "value" — filter
  rows. Relation values must be a page URL or UUID; person values must be a user URI (user://<user_id>), user UUID, or
  "me". Names are not supported for either." From `notion://docs/view-dsl-spec`: "select/multi_select Option name, e.g.
  "Done""; "checkbox TRUE or FALSE"; `FILTER ("Status" = "Done" OR "Status" = "Archived") AND "Priority" > 3`;
  "CHART column|bar|line|donut|number". `parent_page_id` creates "an inline linked database view on a page ... appended at
  the end of the page".
- Confidence: verified-source. Load-bearing: no. A SELECT owner is simpler to filter on than PEOPLE, which needs user URIs.

**F10 — Size limits.**
- Evidence: REST (https://developers.notion.com/reference/request-limits): "Rich text object | `text.content` | 2000
  characters"; "Any array of all block types, including rich text objects | | 100 elements"; "Any relation | | 100 related
  pages"; "payloads have a maximum size of 1000 block elements and 500KB overall". Schema
  (https://developers.notion.com/reference/data-source): "Notion recommends a max property count of **500** or a max
  schema size of **50KB**." MCP: the comment `text.content` has `maxLength: 2000`; `create-attachment` "Inline content is
  limited to 200 KiB"; URL downloads "limited to 5 MiB for free workspaces and 50 MiB for paid workspaces";
  `create-file-upload` "Files are limited to 20 MiB for this single-part upload flow". Claude Code: MCP output "limits
  output to 25,000 tokens by default" (https://code.claude.com/docs/en/mcp).
- Confidence: verified-source. Load-bearing: no.

### C. Batching, rate, concurrency

**F11 — Creates batch (100 rows per call); updates do not (one page per call); writes may be asynchronous.**
- Evidence (`notion-create-pages`): `pages` has `"maxItems": 100`; "All pages created with a single call to this tool will
  have the same parent." `allow_async`: "Default to true for page creation. Set to false only when the next step needs the
  created pages immediately, or when async execution rejects the request as too large. When this create operation is
  accepted for background execution, it returns an async_task result. Use get_async_task to wait for a succeeded status
  before taking a dependent action on the pages. ... If omitted or false, the tool keeps the existing synchronous result
  shape." `notion-update-page` takes a single required `page_id`. Its `allow_async`: "If omitted or false, the tool waits for
  a synchronous result when possible, but may still return a pollable async_task response if queued execution exceeds
  the synchronous wait deadline."
- Confidence: verified-source. Load-bearing: yes.

**F12 — The rate budget is 180 MCP calls per minute per user, with search at 30/min and 429/529 handled via Retry-After.**
- Evidence: https://developers.notion.com/docs/mcp-supported-tools: "Standard API request limits apply per user's usage of
  Notion MCP (totaled across all tool calls). Currently, this is an average of 180 requests per minute (3 requests per
  second)." "Search: 30 requests per minute". https://developers.notion.com/reference/request-limits: "Per connection — an
  average of three requests per second, with some bursts beyond the average allowed. Per workspace — shared across all of
  the workspace's connections and scaled to the workspace's plan." "Connections should handle HTTP 429 and 529 responses
  and respect the `Retry-After` response header."
- Confidence: reported (vendor documentation). Load-bearing: no. For this use the budget is ample if writes are batched.

**F13 — The connector is reachable from subagents, including background and workflow agents, and they all share one connection.**
- Evidence: executed. This workflow subagent successfully called `notion-get-tool-access` (twice) and `notion-get-users`.
  https://code.claude.com/docs/en/sub-agents: "Subagents inherit the built-in tools and MCP tools available in the main
  conversation"; "a background subagent keeps every MCP tool"; "String references share the parent session's connection."
- Confidence: verified-executed and verified-source. Load-bearing: yes.

**F14 — Workflow agents run in acceptEdits plus the allowlist, so Notion writes from them may prompt mid-run.**
- Evidence: https://code.claude.com/docs/en/workflows: "The subagents the workflow spawns always run in `acceptEdits`
  mode and inherit your tool allowlist, regardless of your session's mode." "Shell commands, web fetches, and MCP tools
  that aren't in your allowlist can still prompt you mid-run." "No mid-run user input | Only agent permission prompts can
  pause a run". Observed in this run: the subagent's context stated "While bypass permissions mode is active", the user's
  `~/.claude/settings.json` holds no `mcp__` allow rule (grep found none), and the read-only Notion calls did not prompt.
  No write was attempted, so write behaviour is untested.
- Confidence: verified-source; verified-executed for reads only. Load-bearing: yes.

**F15 — Headless runs: claude.ai connectors load under a claude.ai login, except with `--bare`, `--strict-mcp-config`, an API key or a setup-token.**
- Evidence: https://code.claude.com/docs/en/mcp: "Connectors from claude.ai are fetched only when your active authentication
  method is a claude.ai subscription login. They aren't loaded, even if you previously ran `/login`, when:
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `apiKeyHelper` is active ... `CLAUDE_CODE_OAUTH_TOKEN` holds a token from
  `claude setup-token`, which can only make model requests". Installed binary
  (`C:/Users/Utilisateur/.local/bin/claude.exe`, 2.1.285): "claude.ai connectors are not loaded in this Claude Code session
  (MCP servers are restricted to explicitly passed config here, e.g. --strict-mcp-config or --bare)". The eligibility
  function checks `ENABLE_CLAUDEAI_MCP_SERVERS`/`disableClaudeAiConnectors`, safe mode, first-party provider, API-key
  precedence, the access token and the `user:mcp_servers` scope. It has no interactive-mode check.
  https://code.claude.com/docs/en/headless: "Without it, `claude -p` loads the same context an interactive session would".
- Confidence: verified-source (docs and binary); not executed. Load-bearing: yes.

**F16 — MCP OAuth is interactive-only, and recovering a rejected token needs the terminal.**
- Evidence: https://developers.notion.com/docs/get-started-with-mcp FAQ: "Can I use Notion MCP without interactive
  authorization? Not yet. Notion MCP currently requires you to complete the OAuth authorization flow." Claude Code MCP doc,
  for a connector showing `session token rejected`: "1. Run `/login` to sign in again. 2. Reconnect the connector from
  `/mcp`." https://code.claude.com/docs/en/remote-control lists what works from mobile ("`/mcp` ... The `reconnect`,
  `enable`, and `disable` subcommands work from both"). `/login` is not in that list, and "commands that only run in the
  terminal interface ... work only from the local CLI".
- Confidence: verified-source. Load-bearing: yes. A script, including an offline completion check, cannot read Notion
  through the MCP at all.

**F17 — MCP writes carry the user's own identity, so authorship cannot separate the orchestrator from the phone.**
- Evidence: executed `notion-get-users {"user_id":"self"}` returned `"type":"person"` (identity omitted), not a bot.
  https://developers.notion.com/docs/mcp-security-best-practices: "Connecting to Notion MCP provides the AI system you're
  using with the same access as your Notion user account". https://www.notion.com/help/updates-and-notifications: "You'll
  see an update in your inbox when: Someone @-mentions you or replies to your comment ... You're added to a `Person`
  property in a database." Notifications are about other people's actions.
- Confidence: verified-executed (type) and verified-source. That the user is not notified of his own orchestrator's
  writes is inferred. Load-bearing: yes.

**F18 — There is no versioning or compare-and-set; each property is last-write-wins at minute-granularity timestamps.**
- Evidence: the REST "Update page" body accepts only `properties`, `icon`, `cover`, `is_locked`, `template`,
  `erase_content`, `in_trash` and `is_archived`: no version or if-match field
  (https://developers.notion.com/reference/patch-page). MCP `update-page`: "Provide a non-null value to update a property's
  value. Omitted properties are left unchanged." Relations are set as whole arrays. 409 is transient: "`conflict_error` |
  The transaction could not be completed, potentially due to a data collision. Make sure the parameters are up to date and
  try again." (https://developers.notion.com/reference/status-codes). Timestamps: "the `last_edited_time` and
  `created_time` properties will be rounded down to the closest minute for `page`, `database`, and `block` objects"
  (https://developers.notion.com/changelog/last-edited-time-is-now-rounded-to-the-nearest-minute). One content-level
  precondition does exist: `update_content` requires `old_str` that "Must exactly match the page content" and "the
  operation fails if there are multiple matches". Notion's own agent guide: "If concurrent edits prevent a safe merge, save
  a "Pending proposal: ..." and report it." (`notion://docs/setup-prompt`).
- Confidence: verified-source. Load-bearing: yes.

**F19 — Comments: one read call per page; they can be read and written from the phone.**
- Evidence (`notion-get-comments`): "By default, returns page-level discussions only.", with parameters
  `include_all_blocks`, `include_resolved` and `discussion_id`. `notion-create-comment` offers three modes: "`page_id`
  alone: Add a top-level comment ... `page_id` + `selection_with_ellipsis`: Start a new discussion on the matching block ...
  `discussion_id`: Reply to an existing discussion thread". "Other block-level Markdown such as headings, lists, tables,
  blockquotes, and fenced code blocks is stored as plain comment text"; up to three file attachments.
  https://www.notion.com/help/notion-for-mobile: "Read, edit and comment on any of your Notion content from the mobile app."
- Confidence: verified-source. Load-bearing: no.

**F20 — Nothing pushes Notion changes into Claude Code; detection means polling.**
- Evidence: none of the Notion MCP tools subscribes to or waits on page or database changes (`notion-wait-session` waits on
  Custom Agent sessions and is not exposed; F03). Push exists only in the REST product: "Webhooks: Learn how your connection
  can automatically respond to workspace activity in real-time", with events such as "Page properties updated" and "Comment
  created" (https://developers.notion.com/llms.txt). Those events are delivered to a connection's HTTP endpoint, which an
  MCP client session does not provide.
- Confidence: verified-source (tool surface); inferred (no push path into a session). Load-bearing: yes.

**F21 — Remote Control keeps the local connector, forwards the phone's photos, and carries push notifications.**
- Evidence: https://code.claude.com/docs/en/remote-control: "Remote Control executes on your machine, so your local MCP
  servers, tools, and project configuration stay available." "Send images and files from your phone or browser ... Claude
  sees attached photos directly as part of your message." "the conversation and the progress of subagents and dynamic
  workflows stay in sync across all connected devices". The PushNotification tool: "This tool sends a desktop notification
  in the user's terminal. If Remote Control is connected, it also pushes to their phone." "Keep the message under 200
  characters".
- Confidence: verified-source. Load-bearing: no.

### D. Plans, workspaces and two developers

**F22 — A Free workspace with more than one member is capped at 1,000 lifetime blocks; guests do not count.**
- Evidence: https://developers.notion.com/reference/workspace-block-limits: "Free workspaces with more than one member have
  a limit of 1,000 lifetime blocks. Paid workspaces and single-member Free workspaces have unlimited blocks. Guests do not
  count as members. Deleting blocks does not restore capacity." "Notion MCP has a separate enforcement policy." "After
  grace expires, requests that create blocks fail." Pricing (https://www.notion.com/pricing): Free has "External guest
  limit 10", "File uploads Up to 5MB", "Page history 7 days"; "Unlimited charts" is listed as a Plus feature.
- Confidence: verified-source. Every task row is a page (a block) and every report paragraph is a block, so one
  hackathon would exhaust 1,000 blocks. Load-bearing: yes (two-developer setup).

**F23 — A connection is bound to one workspace; whether a guest can authorize the MCP on the host workspace is undocumented.**
- Evidence: https://developers.notion.com/docs/get-started-with-mcp: "After you authorize the connection, the client can
  read and update content that you can access in the selected Notion workspace." `notion-list-shared-pages`: "List pages
  and databases in the current user's Shared sidebar section." Nothing I found says whether a guest's MCP connection can
  select the workspace where he is a guest.
- Confidence: verified-source; open question for guests. Load-bearing: yes (dev B).

**F24 — The tool-name prefix depends on how Notion was connected; do not hardcode it.**
- Evidence: the tools in this session are named `mcp__claude_ai_Notion__notion-*` (executed). Binary: connectors are
  registered as `claude.ai ${display_name}` with `type:"claudeai-proxy"`. Claude Code MCP doc: "A server you've added in
  Claude Code takes precedence over a claude.ai connector that points at the same URL. When this happens, `/mcp` lists the
  connector as hidden". Notion's own Claude Code instruction is `claude mcp add --transport http notion https://mcp.notion.com/mcp`,
  whose tools would be `mcp__notion__notion-*`.
- Confidence: verified-executed and verified-source. Load-bearing: yes (dev B's "identical setup", hooks and allowlists).

**F25 — The mobile app collapses columns.**
- Evidence: https://www.notion.com/help/notion-for-mobile: "There are no columns on mobile. Any column structure that you
  created on desktop will be collapsed to a single column."
- Confidence: verified-source. Load-bearing: no. Reports should be a single column of headings, short tables and callouts.

**F26 — Without an explicit parent, the server's defaults produce private drafts.**
- Evidence (`notion-create-pages`): "use "creation_mode": "draft" as the safe default when the user clearly wants a durable
  page but has not named a destination ... Draft mode is server-enforced: it creates workspace-level private pages".
  `notion-create-database`: "If omitted, the database will be created as a private page at the workspace level."
- Confidence: verified-source. Load-bearing: no. Always pass the hub page as parent, so dev B can see it.

### E. Facts outside Notion that decide the recommendation

**F27 — Workflow runs resume only within the same session.**
- Evidence: https://code.claude.com/docs/en/workflows: "Resume works within the same Claude Code session. If you exit
  Claude Code while a workflow is running, the next session starts the workflow fresh." "An agent that was still running
  when you stopped isn't saved, so it starts over on resume." "Up to 16 concurrent agents, fewer on machines with limited
  CPU cores".
- Confidence: verified-source. Load-bearing: yes. Run state must live outside the workflow runtime.

**F28 — git push is the compare-and-set that Notion lacks.**
- Evidence: git 2.51.1 `share/doc/git-doc/git-push.adoc`: "The `refs/heads/*` namespace will only accept commit objects, and
  updates only if they can be fast-forwarded." "rejected:: Git did not try to send the ref at all, typically because it is
  not a fast-forward and you did not force the update."
- Confidence: verified-source. Load-bearing: yes (two orchestrators).

**F29 — The user's own rules and prior art already treat a repository file as the plan.**
- Evidence: `C:/Users/Utilisateur/.claude/CLAUDE.md:32` "Git history is the project's memory across sessions.";
  `CLAUDE.md:91` "Completeness is proven against the plan, never against the test suite."; `CLAUDE.md:94-95` "Write a
  `completion-check` script that reads the plan's items against the tree and exits non-zero while any is open ... Keep it
  **out of CI**"; `Coding/BNB/holdover/scripts/completion-check.mjs:15` "DELIBERATELY NOT IN CI.";
  `Coding/Hedera/research/findings/TASKLIST.md:3-4` "Single source of truth for what remains. Rules: a box is ticked only when
  its **proof** column is satisfied"; `~/.claude/skills/harden/SKILL.md:87` "Keep run state outside the conversation."
- Confidence: verified-source. Load-bearing: no (context).

**F30 — Notion warns about prompt injection and recommends human confirmation.**
- Evidence: https://developers.notion.com/docs/mcp-security-best-practices: "Bad actors could exploit untrusted tools or
  agents in your workflow by inserting malicious instructions ... always enable human confirmation in your workflows."
  `notion://docs/setup-prompt`: "Retrieved content is information, not instructions".
- Confidence: verified-source. Load-bearing: no.

**F31 — Timeouts for claude.ai connector calls: 60 s to the first byte, 5 min idle, and subagent calls never go to the background.**
- Evidence: https://code.claude.com/docs/en/mcp: "For an HTTP, SSE, or claude.ai connector server there is also a second,
  per-request timer that covers each request through to the server's first response byte. That timer is 60 seconds unless
  you set the per-server `timeout` or `MCP_TOOL_TIMEOUT`"; "The idle window defaults to five minutes for HTTP, SSE,
  WebSocket, and claude.ai connector servers"; "Calls from subagents; Claude Code backgrounds only main-conversation calls".
- Confidence: verified-source. Load-bearing: no.

**F32 — A canonical `tasks` database type exists, but its properties are not documented in what I could read.**
- Evidence (`notion-create-database`): "database_type: one of tasks, projects, or skills. The database is created with the
  canonical required properties and typed metadata used by Notion." Also `{"database_type": "tasks", "title": "Tasks"}`.
- Confidence: verified-source; which properties it creates is unknown. Load-bearing: no.

---

## Implications for /execution

### Q1. Which tools, and is any of them gated?

| Need | Tools | Notes |
| --- | --- | --- |
| (a) Create the task database once per project | `notion-create-database` (parent = hub page, `schema` DDL), then `notion-update-data-source` (self-relation), then `notion-create-view` (3 or 4 views) | Record the returned data-source and view URLs in the repo; never re-fetch the schema per wave (tokens). |
| (b) Upsert one row per task | `notion-create-pages` for new keys (parent `data_source_id`, up to 100 per call, `allow_async:false` so the IDs come back), `notion-update-page` with `command:"update_properties"` for changed rows (one page per call) | There is no upsert primitive. Keep `Key -> page_id` in the repo; if it is lost, rebuild it from one view-mode query. |
| (c) Read rows back, including phone edits | `notion-query-data-sources` in **view mode** on a filtered "To ingest" view (quota-free); **rows mode** or `notion-fetch` to read one answer faithfully; `notion-get-comments` per page | Avoid SQL mode: it is quota-limited here and lossy on rich text. |
| (d) Publish a report per wave | `notion-create-pages` (one row in a "Waves" database whose body is the report), `notion-update-page` `update_content` on the hub's "Now" text, `notion-get-async-task` when an async task comes back | `notion-create-file-upload` only if a picture must live in Notion. |

None of these is gated (F01). The gated tools (AI search, multi-source SQL, meeting notes) are not needed. SQL mode is
quota-limited, so /execution should not depend on it (F02). Call `notion-get-tool-access` once at setup and write the
result into the run log, because the public docs lag (F04).

### Q2. Data model and views

Every requested type exists: SELECT (use it instead of STATUS; F07), a self-RELATION for dependencies (two steps; F06),
PEOPLE, URL, NUMBER, DATE, CHECKBOX and RICH_TEXT. DATE has no time-zone key through the MCP (F08): keep instants in UTC in
the repo, write a human string such as "Wed 7 Oct 23:59 SGT" into a text column, and use
`<mention-date ... timeZone="Asia/Singapore"/>` in reports. Views are fully scriptable: a board grouped by a SELECT, and
filters on a SELECT owner (F09). Limits: 500 properties or 50 KB of schema, 2,000 characters per rich-text object, 100
rows per create call, 1,000 blocks and 500 KB per payload (REST), and 25k tokens of tool output in Claude Code (F10).

A draft of the task database (this is the tool's own grammar, **untested**; run it in rehearsal):

```text
CREATE TABLE (
  "Task" TITLE COMMENT 'Key and short name, set by /execution',
  "Key" RICH_TEXT COMMENT 'Stable id from the repo plan. Never edit.',
  "State" SELECT('Planned':gray, 'Ready':blue, 'Running':yellow, 'Proof pending':orange, 'Verified':green, 'Blocked':red, 'Needs you':purple, 'Answered':pink, 'Dropped':brown) COMMENT 'Set by /execution from the repo plan',
  "Owner" SELECT('Agent':blue, 'Dev A':green, 'Dev B':orange),
  "Orchestrator" SELECT('A':green, 'B':orange) COMMENT 'Only this orchestrator writes the row',
  "Wave" NUMBER,
  "Depends on keys" RICH_TEXT,
  "Proof" RICH_TEXT COMMENT 'Command, tx hash or file that proves done',
  "Proof link" URL,
  "Verified by" RICH_TEXT,
  "Est minutes" NUMBER,
  "Est ktokens" NUMBER,
  "Model" SELECT('opus':purple, 'sonnet':blue, 'haiku':gray),
  "Due" DATE,
  "Due text" RICH_TEXT COMMENT 'Deadline with its zone, for the phone',
  "Needs from you" RICH_TEXT COMMENT 'Manual tasks: what to do or bring back',
  "Answer" RICH_TEXT COMMENT 'HUMAN-OWNED',
  "Attachments" FILES COMMENT 'HUMAN-OWNED',
  "Answered" CHECKBOX COMMENT 'HUMAN-OWNED: tick when the answer is complete',
  "Decision" SELECT('Approve':green, 'Reject':red, 'See comment':gray) COMMENT 'HUMAN-OWNED: answers to proposals',
  "Ingested" CHECKBOX COMMENT 'Set by /execution once the answer is committed to the repo',
  "Updated" LAST_EDITED_TIME
)
```

Step 2, following the tool's own self-relation example:
`ADD COLUMN "Depends on" RELATION('<ds>', DUAL 'Blocks' 'blocks'); ADD COLUMN "Blocks" RELATION('<ds>', DUAL 'Depends on' 'depends_on')`.
Setting relations costs one `update-page` per row that has dependencies. If the budget is tight, keep only the
`Depends on keys` text column; the authoritative graph lives in the repo anyway.

Views: `Board` (board, `GROUP BY "State"`); `Needs Dev A` (list,
`FILTER "State" = "Needs you" AND "Owner" = "Dev A"`); `To ingest` (table,
`FILTER ("Answered" = TRUE OR "Decision" IS NOT EMPTY) AND "Ingested" = FALSE`), which is the orchestrator's polling view;
and optionally a `Progress` chart (`GROUP BY "State"; CHART donut`), which the Free plan may limit (F22). The second
database, `Waves`, holds `Report` TITLE, `Wave` NUMBER, `Orchestrator` SELECT, `Verified`, `Open` and `Needs you` as
NUMBER, and `Ended` DATE, with a list view `SORT BY "Wave" DESC`.

### Q3. Concurrency, rate and batching

Notion offers **last write wins per property**, with no versioning, no compare-and-set, and timestamps rounded to the
minute (F18). All writes also carry the same person identity (F17), so neither `Last edited by` nor timestamps can detect a
lost update between dev A's and dev B's orchestrators, or between an orchestrator and the phone. The design must therefore
avoid shared writes rather than detect conflicts:
- **Field ownership.** Orchestrator-owned fields (State, Proof, Verified by, estimates, Wave, Ingested) are written only by
  the orchestrator named in `Orchestrator`. Human-owned fields (Answer, Attachments, Answered, Decision) are never written
  by any orchestrator.
- **Row ownership between devs.** Each row is statically assigned to orchestrator A or B in the approved plan.
  Reassignment is a plan amendment committed and pushed; a rejected push means someone else changed the plan (F28).
- **Content.** Use `update_content` with the exact text last written (stored in the repo) as `old_str`: if a human edited
  it, the call fails instead of clobbering, and the orchestrator falls back to `insert_content`. Never use
  `replace_content` on the hub.

Rate: 180 calls/min per user covers every agent on the connection (F12, F13). A wave sync costs about 1 create
(new rows) + k updates (changed rows only) + 1 report + 1 hub update, run sequentially or at most 3 in flight, honouring
`Retry-After` on 429/529. When a write returns `async_task`, poll `get-async-task` before any dependent read (F11).

### Q4. The phone

- **Reading.** The user opens the hub page in the Notion app: the `Board` view (grouped by State) and the newest row of
  `Waves`, whose body is the wave report. The report is a single column (F25): a headline with counts, a "Needs you"
  callout linking each manual task with `<mention-page>`, a small table of the tasks verified this wave with their proof,
  blockers and proposals, the next wave, and the ETA against the deadline as a `<mention-date>` with its `timeZone`.
- **Answering a manual task.** He opens the task row, types the result into `Answer` (a tx hash, an observation, a
  judge's reply), attaches a photo to `Attachments` (5 MB each on Free), and ticks `Answered`, or picks `Decision` for a
  proposal. Free text goes in a comment on that row (F19).
- **Detection.** The orchestrator runs one view-mode query on `To ingest` at every wave boundary, and every 3-5 minutes
  while a manual task is on the critical path (F02, F20). For each hit it reads the row faithfully (rows mode or `fetch`),
  writes the answer into the repo (`.execution/answers/<key>.md`), commits, checks it mechanically where possible (for
  example, re-reading a tx hash on chain), then sets `Ingested`. Comments are read only on the rows with an open manual
  task, at one `get-comments` call each.
- **Faster path and alerting.** A reply in the Claude app over Remote Control reaches the session at once, and photos
  arrive directly (F21). Notion will not notify the user about his own orchestrator's writes (F17), so every "needs you"
  goes out as a PushNotification of under 200 characters that names the task key.

### Q5. Who may talk to Notion?

Technically, anyone: the main session, foreground, background and workflow subagents (F13), and `claude -p` under a
claude.ai login (F15). Scripts cannot (F16). **Only the orchestrator should**, for these reasons:
1. One writer per developer, so no races inside a dev's own run.
2. Workflow agents run in acceptEdits plus the allowlist, and a Notion write could stall an unattended wave on a
   permission prompt (F14).
3. One rate budget with no bursts from 16 parallel agents (F12).
4. The large Notion schemas (the `query-data-sources` filter grammar is the biggest by far, observed) and query results
   stay out of worker contexts.
5. Notion content, which cannot be attributed to a particular writer (F17) and may be injected (F30), stays away from
   agents that can execute code or send transactions.
6. A Notion outage can never stall a worker (F16).

Workers and verifiers write their receipts into the repo; the orchestrator mirrors them.

### Recommendation: a repository file as source of truth, mirrored to Notion

| Criterion | Notion as source of truth | Repo file as source of truth, Notion as mirror |
| --- | --- | --- |
| Two orchestrators | Per-property last-write-wins, no CAS, minute timestamps, identical authorship: lost claims go unseen (F17, F18) | git push rejects a non-fast-forward, a real CAS for plan edits and claims (F28); Notion rows partitioned by orchestrator |
| Crash recovery | Needs the network and a valid connector token; a rejected token needs `/login` at the laptop (F16); state rebuilt by queries | Read `.execution/*` from disk plus `git log`; the mirror catches up from an outbox; workflow runs do not survive a session anyway (F27) |
| Offline completion check | Impossible: MCP tools are callable only by the model, and OAuth is interactive-only (F16) | A node script reads the plan and the tree offline, like `completion-check.mjs` (F29) |
| Git history as memory | Page history is 7 days on Free (F22), not diffable, not in the repo | Every plan change is a conventional commit with a why (F29) |
| Rate limits and tokens | Every read of state is an MCP call | Reads cost nothing (disk); Notion calls happen only at wave boundaries and in polls |
| Phone and dev B visibility | Native | Identical: the full approved plan is mirrored row by row, and humans answer there |

This honours the user's decision 4, "the shared plan lives in Notion": Notion is where the plan is **shared, read and
answered**; the repository is where it is **decided and proven**. To present to the user: a field edited in Notion that
the orchestrator owns is detected as a divergence from the last value pushed and raised as a proposal. It is never
silently applied and never silently overwritten.

Files (following the `.harden/` house style, F29):
- `.execution/plan.json`: the approved graph, with owner, dependencies, wave, estimates, model and proof command.
  Committed.
- `EXECUTION.md`: the human view in TASKLIST style, generated from the plan. Committed.
- `.execution/progress.md`: UTC lines, one per event.
- `.execution/answers/<key>.md`: each ingested answer. Committed.
- `.execution/notion.json`: hub id, data-source and view URLs, and the `Key -> page_id` map. Committed so dev B can
  attach, and removed or ignored before the repo goes public, because it reveals a private workspace layout (these are not
  credentials).
- `.execution/local/mirror-state.json`: last-pushed hashes and last "Now" text. Ignored.
- `.execution/local/notion-outbox.jsonl`: mirror operations waiting while Notion is unreachable. Ignored.

### Rehearsal checklist (before Sun 4 Oct 12:00 Paris; about one hour)

1. Run `get-tool-access` and record the statuses.
2. On a scratch hub page: run the DDL above, add the self-relation, create the views. Record which DDL forms are refused.
3. Write one row with `date:Due:start` set to `2026-10-07T23:59:00+08:00` and `is_datetime` 1, then look at it on the
   phone. Also put one `<mention-date ... timeZone="Asia/Singapore"/>` in a page.
4. From the phone: type an Answer, attach a screenshot, tick Answered. Then run the view-mode poll and time how long
   detection takes. Read the row in rows mode and with fetch; try downloading the attachment through the signed URL.
5. Run 20 view-mode polls and a few rows-mode reads, watching for any quota message.
6. From inside a workflow agent, run one `update-page` on the scratch row. Does it prompt? Then choose between an explicit
   allow rule and orchestrator-only (recommended regardless).
7. Run `claude -p "/mcp"` in the project directory without `--bare`, and confirm "claude.ai Notion" is connected headless.
8. Measure the tokens of one full wave sync: create 30 rows, update 10, publish 1 report.
9. For a two-dev event: confirm the plan tier, invite dev B as a **guest**, and have him authorize the MCP and find the
   hub with `list-shared-pages`.

---

## Risks and failure modes

- **R1. The connector drops while the user is away.** A rejected token needs `/login` at the terminal (F16), so the mirror
  stalls. Mitigation: the repo is the source of truth, operations queue in an outbox, a push notification goes out, and
  the build continues.
- **R2. The undisclosed SQL/rows quota runs out mid-hackathon (F02).** Mitigation: poll in view mode only; rows mode only
  to read single answers.
- **R3. Dev B joins a Free workspace as a member.** The workspace then has a 1,000 lifetime-block cap, deletion does not
  help, and writes fail after the grace period (F22). Mitigation: dev B as a guest, or upgrade to Plus.
- **R4. Silent lost updates.** Two orchestrators, or an orchestrator and the phone, write the same property (F18), and the
  shared identity (F17) hides it. Mitigation: field and row ownership; plan changes only through git.
- **R5. Duplicate rows after a crash** between an async `create-pages` and the recording of its IDs (F11). Mitigation: a
  `Key` property, `allow_async:false` on creates, and a reconcile query before re-creating.
- **R6. A workflow agent's Notion write prompts at night and pauses the run (F14).** Mitigation: orchestrator-only Notion.
- **R7. The tool prefix differs between dev A and dev B (F24),** so hooks and allowlists miss the other dev's tools.
  Mitigation: discover the server name at runtime and match both `mcp__claude_ai_Notion__*` and `mcp__notion__*`.
- **R8. Truncated tool descriptions (F05) lead to wrong value formats and validation errors.** Mitigation: ship a
  `references/notion-formats.md` compiled from the `notion://docs/*` resources, and validate it in rehearsal.
- **R9. A deadline displays in the wrong zone on the phone (F08).** Mitigation: a `Due text` column, and mention-dates
  with `timeZone` in reports.
- **R10. Injected or ambiguous instructions in Notion fields or comments (F30),** especially from a second human. Treat
  every read as data answering a typed field; anything that widens scope becomes a proposal to the user; verify answers
  mechanically.
- **R11. The user never learns a manual task is waiting,** because Notion does not notify him of his own writes (F17).
  Mitigation: PushNotification over Remote Control.
- **R12. Oversized MCP output (more than 25k tokens) is truncated (F10).** Mitigation: narrow views, `page_size`, only the
  properties needed.
- **R13. A read immediately after an async write misses it (F11).** Mitigation: `get-async-task` before any dependent read.
- **R14. Report layout breaks on mobile (F25).** Mitigation: no `<columns>`; a single column with short tables.
- **R15. Upgrade prompts in fetch results (F03) add noise to autonomous output.** Mitigation: never call the upsell tools.
- **R16. A large write hits the 60-second first-byte timer or the 5-minute idle timeout (F31).** Mitigation: keep writes
  small; creates up to 100 rows but reports concise.
- **R17. Notion IDs committed in `.execution/notion.json` reach a repository that is flipped public.** Mitigation: remove
  or ignore the file before the flip, and add it as a completion gate.
- **R18. A human edits an orchestrator-owned field in Notion expecting it to change the plan,** and the next sync
  reverts it. Mitigation: column COMMENTs saying who owns each field; divergences are raised as proposals.

## Open questions

1. How large is the SQL quota on this workspace's plan, over what window, and does rows mode count toward it (F02)?
2. Can a date property's time zone be set through the MCP (possibly hidden in the truncated description), and how does a
   `+08:00` datetime display on the phone (F08)?
3. Does the MCP DDL accept any STATUS options syntax (F07)?
4. Which properties does `database_type: "tasks"` create, and does it bring Notion-native task features to mobile (F32)?
5. Do `update-page` and `create-pages` from a workflow agent prompt in this Claude Code build (F14)?
6. Can a guest authorize the Notion MCP on the host's workspace and see the shared hub (F23)?
7. Is the workspace on Free or Plus? This decides charts, 5 MB uploads, 7-day history and the block cap (F22).
8. What is Notion MCP's "separate enforcement policy" for the block cap (F22)?
9. Can a photo attached from the phone to a Files property be downloaded reliably by the orchestrator (signed URL from
   `fetch`), or should photos go through Remote Control (F21)?
10. What does one wave sync cost in tokens, as measured in rehearsal?
11. Does `claude -p` in this environment load the connector? This matters only if /execution relaunches headless (F15).
12. Worth raising with the user: would a deterministic sync script using a Notion personal access token (REST, zero
    model tokens) be acceptable, given that it adds a secret and departs from "through the Notion MCP"? Notion lists
    "Personal access tokens: Create and use personal access tokens for user-scoped API and Workers access" in its docs
    index. Not recommended for Origins given the time available.

## Sources

Notion MCP (live, this session):
- `mcp__claude_ai_Notion__notion-get-tool-access` (executed twice), `mcp__claude_ai_Notion__notion-get-users {"user_id":"self"}` (executed once)
- Live tool schemas loaded with ToolSearch: all 44 `mcp__claude_ai_Notion__*` tools listed in this session
- MCP resources: `notion://docs/when-to-create-a-notion-page-or-database`, `notion://docs/view-dsl-spec`,
  `notion://docs/enhanced-markdown-spec`, `notion://docs/database-page-layouts`, `notion://docs/setup-prompt`,
  `notion://docs/skills`

Notion documentation:
- https://developers.notion.com/docs/mcp
- https://developers.notion.com/docs/mcp-supported-tools
- https://developers.notion.com/docs/get-started-with-mcp
- https://developers.notion.com/docs/mcp-security-best-practices
- https://developers.notion.com/reference/request-limits
- https://developers.notion.com/reference/workspace-block-limits
- https://developers.notion.com/reference/status-codes
- https://developers.notion.com/reference/page
- https://developers.notion.com/reference/patch-page
- https://developers.notion.com/reference/property-object
- https://developers.notion.com/reference/page-property-values
- https://developers.notion.com/reference/data-source
- https://developers.notion.com/reference/update-a-data-source
- https://developers.notion.com/guides/data-apis/working-with-comments
- https://developers.notion.com/changelog/last-edited-time-is-now-rounded-to-the-nearest-minute
- https://developers.notion.com/llms.txt
- https://www.notion.com/help/notion-for-mobile
- https://www.notion.com/help/updates-and-notifications
- https://www.notion.com/help/understanding-block-usage
- https://www.notion.com/pricing

Claude Code documentation and binary:
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/workflows
- https://code.claude.com/docs/en/remote-control
- https://code.claude.com/docs/en/headless
- `C:/Users/Utilisateur/.local/bin/claude.exe` (2.1.285): string search for the claude.ai connector loader
- The PushNotification tool schema (this session)

Local files:
- `C:/Users/Utilisateur/.claude/CLAUDE.md` (lines 32, 91, 94-95)
- `C:/Users/Utilisateur/Documents/Coding/Hedera/research/findings/TASKLIST.md` (lines 3-5)
- `C:/Users/Utilisateur/Documents/Coding/BNB/holdover/scripts/completion-check.mjs` (lines 1-24)
- `C:/Users/Utilisateur/.claude/skills/harden/SKILL.md` (line 87)
- git 2.51.1 `share/doc/git-doc/git-push.adoc` (lines 102-103, 478-480, 511-516)

---

## Verification

Adversarial verification, 2026-09-30 (evening), run from a workflow subagent. The installed binary is now Claude Code
**2.1.286**: `C:/Users/Utilisateur/.local/bin/claude.exe` was replaced at 21:09, after the 2.1.285 research run.
Notion was used read-only: one `notion-get-tool-access {}` call and one `notion-get-users {"user_id":"self"}` call
(only `type` is recorded here). Two tiny headless runs were executed in
`C:/Users/UTILIS~1/AppData/Local/Temp/claude/C--Users-Utilisateur-Documents/1b81010d-85f5-4bc4-9aad-c09f0606fc88/scratchpad/cc-experiments/notion-verify/headless/`
(`runA.jsonl`, `runB_control.jsonl`) with `claude -p --model sonnet --max-turns 4 --no-session-persistence --settings
'{"disableAllHooks":true}'`. Each run loaded the `notion-fetch` and `notion-create-pages` schemas with ToolSearch and
quoted parts of them. No Notion tool was called, there were 0 permission denials, and both runs together cost about
$0.37. Documentation quotes come from the raw `.md` pages downloaded today, and line numbers refer to those files.
Several pages changed after the body's quotes were taken. **This section overrides the body where they differ.**

- **F01: partly-true.** *Correction:* all twelve listed tools are `available` (re-executed today, same statuses).
  The list omits `query_data_sources`, however, which is the tool the design polls with, and its status is
  `available_with_limit`. The core loop needs no upgrade only if polling uses view mode and single answers are read
  with `notion-fetch`, because rows mode is metered (F02). *Evidence:* `notion-get-tool-access {}` returned
  `create_pages`, `update_page`, `create_database`, `update_data_source`, `create_view`, `update_view`, `fetch`,
  `get_comments`, `create_comment`, `get_async_task`, `create_attachment` and `create_file_upload` as
  `"status":"available"`, `query_data_sources` as `"available_with_limit"`, `query_multiple_data_sources` as
  `"full_version_required"`, and `ai_search` and `query_meeting_notes` as `"plan_required"`.
  https://developers.notion.com/guides/mcp/mcp-supported-tools (.md:74): "`available_with_limit` (calls can be made up
  to the limit included with the workspace's plan)". Same page (.md:82): "For `query_data_sources`, view mode is always
  available; Business and Enterprise plans with Notion AI can query any number of data sources, while other plans
  receive metered single-data-source access."
- **F02: partly-true.** *Correction:* the vendor answers the body's open question: rows mode **is** metered. It also
  has no cursor: it returns at most 100 rows, 50 by default. View mode stays quota-free, but it is rate-limited like
  every `query-data-sources` call. Read single answers with `notion-fetch`, not rows mode. *Evidence:*
  mcp-supported-tools .md:332: "View mode is available on every plan without a tool-specific quota. SQL across one or
  more data sources is unlimited on Business and Enterprise plans with Notion AI. Other plans share a per-workspace
  usage limit for single-data-source SQL and receive an upgrade prompt after the allowance is exhausted. Rows mode uses
  the same allowance as single-data-source SQL." .md:321: "`limit` defaults to 50 and has a maximum of 100."
  .md:323: "Rows mode does not return a cursor." .md:571: "`notion-query-data-sources` (including saved view
  queries): 20 calls per 10 seconds." The live tool description quoted in the body is verbatim-correct.
- **F05: partly-true.** *Correction:* 2,048 characters is only the **default**. `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`
  (v2.1.280 or later) raises the limit for every MCP server. With it set to 60000, the complete Notion descriptions
  reached the model (executed). The six `notion://docs` resources are complete: all six were read to their natural
  end. **None of them contains the property-value formats** (`date:{property}:start`, `__YES__`, `userDefined:`),
  which exist only in tool descriptions, and the create-pages Date rule is invisible at the default limit. Launch the
  /execution session with the variable set; this is verified in the process environment, while setting it through
  `settings.json` `env` is untested. Keep `references/notion-formats.md` only as a fallback. The body's quote ("at 2KB
  each. Keep them concise to avoid truncation") is no longer the doc's wording. *Evidence:*
  https://code.claude.com/docs/en/mcp (.md:1443): "Claude Code truncates each tool description and each server's
  instructions at 2,048 characters by default. Keep them concise, and put critical details near the start." (.md:1445):
  "To change the limit for every MCP server in your session, set `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` to a number
  of characters. This variable requires Claude Code v2.1.280 or later." env-vars .md:307: "Maximum length in characters
  of each MCP tool description and each MCP server's instructions that Claude Code sends to the model (default: 2048)".
  In the 2.1.286 binary: `function XB(){return a.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH??fPo}`, `fPo=2048`, and
  `let s=XB();if(e.length<=s)return e;...return re(e,s)+"\u2026 [truncated]"`. `runA` (variable=60000) returned
  `"fetch_has_truncated_marker": false`. After "Databases return all dat", the text continues "a sources (collections).
  Each data source has a unique ID shown in `<data-source url="collection://...">` tags...". It also returned
  `"create_pages_date_rule": "Date properties: Split into \"date:{property}:start\", \"date:{property}:end\" (optional),
  and \"date:{property}:is_datetime\" (0 or 1)"`. `runB_control` (variable unset) returned both markers `true` and both
  continuations and the date rule `null`.
- **F06: confirmed (source only).** Every type and both quotes appear verbatim in the live `notion-create-database`,
  `notion-update-data-source` and `notion-update-page` schemas, re-loaded today. Nothing was executed, because Notion
  writes were out of scope. The DDL, and especially the two-statement self-relation example, still needs the rehearsal
  run. *Evidence:* create-database: "RELATION('data_source_id', DUAL 'synced_name' 'synced_id') — two-way with synced
  name and ID (for self-relations)", "UNIQUE_ID [PREFIX 'X'] / CREATED_TIME / LAST_EDITED_TIME", "Any column: COMMENT
  'description text'", and the example titled "Self-relation (two-step: create database first, then use its data
  source ID with update_data_source to add self-relations)". update-page: "Checkbox properties: Use "__YES__" for
  checked, "__NO__" for unchecked" and "Properties named "id" or "url" (case insensitive) must be prefixed with
  "userDefined:"".
- **F11: confirmed.** One addition: the update-page schema tells the model, for `allow_async`, to "Default to true for
  page updates". Any update can therefore come back as an `async_task`, and an update is done only when
  `get-async-task` returns `succeeded`. *Evidence:* live create-pages schema: `pages` `"maxItems": 100`, "All pages
  created with a single call to this tool will have the same parent." update-page requires one `page_id`.
  mcp-supported-tools .md:504: "When `allow_async` is omitted or `false`, `notion-create-pages` keeps its synchronous
  result shape. `notion-update-page` waits for a synchronous result when it can, but it can still return a pollable
  `async_task` if queued execution runs past the synchronous wait deadline, so handle both shapes." .md:498: "Wait for
  `succeeded` before any step that depends on the write".
- **F13: confirmed.** *Correction to the reasoning:* the single budget is not a consequence of connection sharing.
  The quoted "String references share the parent session's connection" is about the `mcpServers` frontmatter field,
  not default inheritance. Notion counts per user across all tool calls, so even two separate connections of the same
  user share one budget. *Evidence:* executed from this workflow subagent: `notion-get-tool-access` and
  `notion-get-users` both succeeded. sub-agents .md:424: "Subagents inherit the built-in tools and MCP tools available
  in the main conversation". .md:435: "a background subagent keeps every MCP tool". .md:509 (`mcpServers` context):
  "String references share the parent session's connection." mcp-supported-tools .md:568: "Notion MCP allows each user
  at least the standard API request limits, counted across all tool calls."
- **F14: refuted.** *Correction:* workflow subagents do not run in acceptEdits "whatever the session's mode". They
  use the session's permission rules and inherit the main conversation's mode when that mode is `bypassPermissions`,
  `acceptEdits` or `auto`. In the user's bypass sessions, Notion writes from workflow agents therefore do **not**
  prompt, and nothing stops them either (see Missed 5). Prompts occur only in Manual or acceptEdits sessions for tools
  outside the allow rules; in auto mode the classifier reviews the calls. What survives: the user has no `mcp__` allow
  rule, which matters for non-bypass and headless runs. Orchestrator-only Notion remains right for the other Q5
  reasons. *Evidence:* workflows .md:196: "The subagents the workflow spawns use your permission rules, and Claude Code
  picks their permission mode by the rules under which permission mode a subagent runs in. To avoid prompts on a long
  run, add the tools the agents need to your allow rules before starting." sub-agents .md:566: "If you leave it unset,
  the subagent inherits the main conversation's permission mode." .md:570: "When the main conversation is in
  `bypassPermissions`, `acceptEdits`, or auto mode, the subagent runs in that same mode and Claude Code ignores the
  `permissionMode` you set." The body's sentence ("always run in `acceptEdits` mode ... regardless of your session's
  mode") no longer exists in workflows.md: a grep for `acceptEdits` returns 0 hits. Executed: this subagent's context
  reads "While bypass permissions mode is active". Its `curl`, `dd`, `python` and `gh` calls, none covered by an
  allow rule and with no sandbox configured, ran without a prompt. `~/.claude/settings.json` has no `mcp__` rule and
  no `defaultMode`, and at :153 `"skipDangerousModePermissionPrompt": true`.
- **F15: confirmed (executed).** *Additions:* the headless run loaded the connector, but it started in
  `permissionMode: default`, because the user sets no `defaultMode`. A headless relaunch would have every Notion write
  **denied** unless it passes `--permission-mode bypassPermissions` or `--dangerously-skip-permissions`, or
  `--allowedTools` covering the Notion tools. `--bare` "will become the default for `-p` in a future release", which
  would silently drop the connector. At init, 2 of 16 MCP servers were still `pending`: connectors connect in the
  background, and the wait happens inside ToolSearch. *Evidence:* the `runA.jsonl` init event shows
  `permissionMode=default`, `apiKeySource=none`, `{"name":"claude.ai Notion","status":"connected","source":"claudeai"}`
  and 44 `mcp__claude_ai_Notion__*` tools. mcp .md:1134-1139 is verbatim as in the body. The 2.1.286 binary contains,
  verbatim, "claude.ai connectors are not loaded in this Claude Code session (MCP servers are restricted to explicitly
  passed config here, e.g. --strict-mcp-config or --bare)". headless .md:62: "`--bare` is the recommended mode for
  scripted and SDK calls, and will become the default for `-p` in a future release."
- **F16: partly-true.** *Correction:* "no script can read it" is too strong. First, a script can reach the claude.ai
  connector through `claude -p` under the subscription login (executed, F15); that path is model-mediated and costs
  tokens. Second, deterministic script access exists outside the hosted MCP: the REST API with a personal access token
  (this adds a secret, and guests cannot create one), or the unmaintained open-source server with a bearer token. The
  recovery half is confirmed, with a trap: from the phone, a typed `/mcp reconnect <server>` reports success even while
  the token is still rejected. *Evidence:* get-started-with-mcp .md:383-384: "Can I use Notion MCP without interactive
  authorization? Not yet. Notion MCP currently requires you to complete the OAuth authorization flow. We're working on
  support for non-interactive authorization for automated workflows." .md:396: the open-source server "is no longer
  actively maintained. It supports bearer token authentication". errors .md:1374: "claude.ai rejected the session
  token. Run /login, then reconnect." .md:1380: "the typed `/mcp reconnect <server>` form reports a successful
  reconnect even though the token is still rejected." remote-control .md:345 and :348: `/login` is not in the mobile
  list, while `/mcp` `reconnect` works from mobile.
- **F17: partly-true.** The identity half is confirmed by execution: `"type":"person"`, not a bot. The cited security
  sentence has changed. The page now says "A connected client can use Notion MCP to access content that you can
  access", and the help centre says "MCP tools act with your full Notion permissions". "Notion notifies users about
  other people's actions" is imprecise, because "You've set a reminder for yourself" is a documented self-trigger. The
  MCP cannot set reminders, though. In `notion://docs/enhanced-markdown-spec`, `<mention-date>` takes only `start`,
  `end`, `startTime`, `endTime` and `timeZone`, and date properties take only `:start`, `:end` and `:is_datetime`.
  PushNotification therefore stays the alert path. Whether a self-mention or a self-assignment to a Person property
  notifies is untested. *Evidence:* `notion-get-users {"user_id":"self"}` (2026-09-30) returned `type: person`.
  https://developers.notion.com/guides/mcp/mcp-security-best-practices; https://www.notion.com/help/notion-mcp.
  https://www.notion.com/help/updates-and-notifications: "You'll see an update in your inbox when: Someone @-mentions
  you or replies to your comment ... You're added to a Person property in a database. You've set a reminder for
  yourself, or someone else has set a reminder for you. You're invited to a page."
- **F18: confirmed.** One addition: the MCP update-page schema exposes no `is_locked`, so even the coarse REST page
  lock is unreachable through the MCP. *Evidence:* parsed OpenAPI for `PATCH /v1/pages/{page_id}`
  (https://developers.notion.com/reference/patch-page.md, API version 2026-03-11): the body keys are `properties, icon,
  cover, is_locked, template, erase_content, in_trash, is_archived`, and the parameters are `page_id,
  filter_properties, Notion-Version`. There is no version, ETag or If-Match anywhere. status-codes .md:31, 409
  `conflict_error`: "The transaction could not be completed, potentially due to a data collision. Make sure the
  parameters are up to date and try again." The body's changelog URL now resolves to
  https://developers.notion.com/guides/resources/historical-changelog.md:3990: "the `last_edited_time` and
  `created_time` properties will be rounded down to the closest minute for `page`, `database` , and `block` objects".
  The live update-page schema says "Omitted properties are left unchanged." and, for `old_str`, "Must exactly match the
  page content."
- **F20: confirmed.** *Nuance:* Claude Code does have a push path, channels, a research preview in which an MCP
  server can "push messages, alerts, and webhooks into your Claude Code session". It needs a server that declares
  `claude/channel` and the `--channels` flag, and the hosted Notion MCP is not such a server. Notion webhooks need a
  REST connection and a public HTTPS endpoint. For Origins, polling stands. *Evidence:* channels .md:7 and :10
  ("Channels are in research preview"). webhooks .md:77: "It must be a secure (SSL) and publicly available endpoint.
  Endpoints in localhost are not reachable." .md:33: "Within a minute, Notion sends a webhook request to your
  configured endpoint." `notion-wait-session`: "Wait for the latest turn in a Custom Agent session to stop running."
- **F22: confirmed, and stricter than stated.** *Additions:* blocks are counted **since signup**, so a Free workspace
  the user already uses may be over 1,000 the moment a second person joins. On Free, "People added to workspaces on a
  Free Plan can only join as workspace owners." There is a three-day grace period. After it, property edits still
  work, but new rows and reports fail with 403 `restricted_resource`. "Notion MCP has a separate enforcement policy",
  which is not described anywhere found. Pricing confirms the Free plan's uploads "Up to 5 MB", page history "7 days",
  "Charts 1" and "External guest limit 10". The guest mitigation collides with F23. *Evidence:* workspace-block-limits
  .md:15 (verbatim as in the body), :17, :21 and :44 ("Title and property edits still work").
  https://www.notion.com/help/understanding-block-usage: "We count blocks based on the amount of content created in
  your workspace since signing up" and "*People added to workspaces on a Free Plan can only join as workspace
  owners." https://www.notion.com/pricing.
- **F23: partly-true.** The one-workspace binding is confirmed verbatim. The guest case is not merely undocumented:
  a report in Notion's own MCP repository quotes the hosted server refusing guests at OAuth: "You are a guest, so you
  cannot connect to Notion MCP. Ask the workspace owner to upgrade you to a member, or switch workspaces." The issue has
  been open since 2026-03-12 with no vendor reply, and it is the only source found. Notion does document that guests
  cannot create PATs. Expect "dev B as a guest with his own Notion MCP" to **fail**. The realistic options are dev B as
  a member on a paid plan, or dev B without Notion MCP: he reads the hub in the app, and dev A's orchestrator mirrors
  dev B's rows from git. *Evidence:* get-started-with-mcp .md:9 (verbatim as in the body).
  https://github.com/makenotion/notion-mcp-server/issues/227 (read with `gh issue view`). personal-access-tokens
  .md:97: "Guests and restricted members cannot create PATs or log in with the Notion CLI (`ntn login`)."
- **F24: partly-true.** *Correction:* there is a third path. Notion's official Claude Code plugin
  (`makenotion/claude-code-notion-plugin`) declares server `notion` → `https://mcp.notion.com/mcp` in its `.mcp.json`,
  and plugin tools are named `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`. That gives a third prefix, likely
  `mcp__plugin_Notion_notion__*`; this is inferred from `plugin.json` `"name": "Notion"`. Hooks and allowlists should
  match the tool suffix (`notion-create-pages`, and so on), or discover the server at runtime, rather than two fixed
  prefixes. *Evidence:* mcp .md:500: "`mcp__plugin_<plugin-name>_<server-name>__<tool-name>`, where any character
  outside `A-Z`, `a-z`, `0-9`, `_`, and `-` is replaced with `_`". mcp .md:1152 (precedence, verbatim as in the body).
  get-started-with-mcp .md:47 (`claude mcp add --transport http notion https://mcp.notion.com/mcp`) and .md:61 ("Install
  the Notion plugin for Claude Code"). `gh api repos/makenotion/claude-code-notion-plugin/contents/.mcp.json`.
- **F27: partly-true.** *Correction:* exiting does not always restart the run. When a session is resumed with
  `claude --resume`, Claude can replay the saved results when it relaunches the workflow. Backgrounding the session, or
  "Move to background and exit" with agent view on, carries the run over. Only a *fresh* session starts over, and agents
  that were still running restart. A usage-limit hit pauses the run instead of failing it (v2.1.271 or later). Sixteen
  concurrent agents is a default: it is configurable with `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` (1-256, v2.1.269
  or later) and lower with fewer CPUs. The repo-held run state is still needed, for a machine or terminal loss, for
  dev B, and for the `nothing to resume` error. *Evidence:* workflows .md:365. .md:388: "You can resume a run within the
  same Claude Code session." .md:391: "Claude Code keeps the run's saved results under that session's directory in
  `~/.claude/projects/`, so a session you resume with `claude --resume` can replay them when you ask Claude to relaunch
  the workflow. In a session you start fresh, Claude has no earlier run to relaunch and starts the workflow over as a
  new run."
- **F28: confirmed.** *Caveats:* the rule binds only non-forced pushes, so /execution must never use `--force` or a
  `+refspec`; `--force-with-lease=<ref>:<expect>` is the explicit compare-and-set. The check is per ref, not per task.
  After a rejected push and a pull, git can auto-merge two semantically conflicting edits to `plan.json` without a
  conflict marker, so re-validate the merged plan mechanically before acting. *Evidence:* git 2.51.1
  `share/doc/git-doc/git-push.adoc:102-103`: "The `refs/heads/*` namespace will only accept commit objects, and updates
  only if they can be fast-forwarded." :478-480: "rejected:: Git did not try to send the ref at all, typically because
  it is not a fast-forward and you did not force the update." :238-242: "Usually, "git push" refuses to update a remote
  ref that is not an ancestor of the local ref used to overwrite it. ... This option overrides this restriction if the
  current value of the remote ref is the expected value."

### Missed

1. **`CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`** (F05) fixes the truncated Notion grammars at the source. Set it in the
   environment of every session that runs /execution, including dev B's, and check it once in rehearsal.
2. **Reads cost more than the body assumes.** Rows mode draws on the same metered allowance as SQL and has no cursor.
   `notion-query-data-sources`, saved view queries included, and `notion-search` are each limited to 20 calls per 10
   seconds. A rate limit arrives as a *tool error* carrying `code: "rate_limited"` and `retry_after_seconds`; Notion MCP
   retries by itself only when the wait is 2 seconds or less. It does not arrive as an HTTP 429 with `Retry-After`,
   the wording in the body's Q3 (mcp-supported-tools .md:566-577).
3. **Guests reportedly cannot use Notion MCP at all** (F23). User decision 4 ("dev B runs the identical setup ...
   Notion MCP") therefore requires dev B as a **member**. On Free, that brings the lifetime block cap counted since
   signup (F22), so a two-developer event effectively needs a paid plan. In rehearsal, read the block count under
   Settings → Upgrade plan and confirm the plan tier.
4. **Headless runs deny Notion writes by default.** `claude -p` starts in `default` mode, and there are no `mcp__`
   allow rules. Any headless relaunch must pass an explicit permission mode or `--allowedTools`. Because `--bare` is
   slated to become the default for `-p`, pin the flags rather than rely on defaults.
5. **"Orchestrator-only Notion" is not enforced by prompts in bypass sessions** (F14). Enforce it with deny rules,
   for example `disallowedTools` in the worker agent definitions ("Deny rules block in every mode, including
   `bypassPermissions`", permission-modes .md:30), or with a skill-scoped hook. The same applies to other write-capable
   connectors present in the session: Gmail, Drive, Calendar, Luma.
6. **A phone-side `/mcp reconnect <server>` can report success while the token is still rejected** (errors .md:1380).
   Before draining the Notion outbox, the orchestrator should confirm with a real read such as `notion-get-tool-access`.
7. **Notion's official Claude Code plugin produces a third tool prefix** (F24).
8. **After the block cap's grace period, property edits keep working and creation fails with 403
   `restricted_resource`.** The mirror should degrade to updates-only and record the missing reports in git rather
   than stall.
9. **Claude Code channels** (research preview; Telegram, Discord and iMessage plugins, each needing a bot token) are
   an optional instant phone-to-session path independent of Notion. Not for Origins.
10. **Source drift on 2026-09-30.** The Claude Code mcp, workflows and headless pages, the Notion security page and
   the changelog URL all changed wording or location, and the Notion MCP docs moved to `/guides/mcp/*.md`. The public
   supported-tools page now matches the live server (the query-data-sources plan text), so F04's "docs lag" is outdated
   there. Re-verify cited behaviour in rehearsal instead of trusting quotes.
