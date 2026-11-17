# target-origins

## Summary
1. Origins is in person at Marina Bay Sands for 36 h. Kickoff is Tue 6 Oct 12:00 SGT (04:00 UTC). The submission is locked Wed 7 Oct 23:59 SGT (organiser API today: submission_deadline_effective 2026-10-07T15:59Z). The top 5 pitch live Thu 8 Oct 16:00 SGT, with the demo as a screen recording embedded in a .ppt/.keynote deck.
2. The rule says "no code, designs, or prototypes before kickoff". The user's own research counts a CLI shape, schema, report layout or diagram as a design, and bans even an empty pre-created repo. So /execution can pre-stage only knowledge, provisioning and itself. The design-level plan and the single approval must happen at T+0.
3. No validated spec exists. The closest is wave-3 _recommendation.md (21 Sept): primary = Cardano dispute-settlement rail, which must be renamed; fallback = Chainlink "Unit Guard"; sign-off still pending. A new Cardano-track rubric, live by 24 Sept, gives UX & Design 20 % and Impact 20 %, and the old plan cuts its UI third.
4. The plan has fixed gates (H+2, H+4, H+5, H+18-20, T-6h, build complete by about H+28). Its side-effect policy is stricter than the standing authorisation: preprod only, mainnet read-only, banned endpoints, five undisclosed matters, a do-not-carry list.
5. Inputs decayed in 9 days. x402 went from 2.26.0 to 2.28.0. The CF x402 page went live and says the hosted facilitator URL "will be published here". The Cardano track grew from 81 to 231 registrations (55 teams). None of the P0 actions of 21 Sept is recorded as done (organiser questions, CF disclosure, rename, seller wallet funding, manual prior-art check).
6. Machine: i7-11800H 8C/16T, 15.69 GB RAM, one 453 GB drive. C: free swung 4.17 -> 1.89 -> 4.83 GB within 28 min during this workflow, and free RAM stayed at 1.4-2.3 GB. Disk and RAM bind, not CPU. One npm install of the Cardano starter is 701 MB / 128,046 files, so per-agent npm worktrees are impossible now. Target at least ~25 GB free, and use pnpm or a single tree.
7. Other gates: the laptop sleeps after 600 s on battery, auto time zone is ON, the uplink today is an iPhone USB tether, Windows is not activated (watermark risk), and the 5h/7d Pro/Max quota is observable via status-line rate_limits.
8. Two-developer mode (Ledger OP3N) starts 7 Oct 00:00 SGT, 12 h into Origins. Dev B = Eli, whose tooling is unconfirmed. An Origins on-site recruit would not have the setup. One machine cannot run both projects at once.

## Recommendations
1. Make the event profile a machine-readable data file with UTC instants and zones, fixed gates, deliverables, rubric weights per track, the side-effect policy, channels and manual tasks. The draft Origins table in the dossier is the template.
2. Plan in two steps for events with a no-designs rule. Before the event: a knowledge-level skeleton (parts, hours, proofs, gates, owners; no file layout, CLI shape, schema or diagram). At T+0: design-level detail and a single user approval by about T+0:30. The planner must run in minutes, and the rehearsal must use a fixture, never Origins content.
3. Let a per-project policy narrow the standing authorisations, enforced by skill-scoped hooks in the /harden style. For Origins: mainnet read-only, deny live Masumi endpoints and the CF Java facilitator, a banned-claims grep (do-not-carry list plus undisclosed matters) before commits and before any visibility flip.
4. Fence the build: deny agent reads of research/probes/** and writes outside the new repo while the hack is active. Make repo bootstrap a T+0 task: gh repo create after 12:00 SGT, README provenance paragraph, kickoff freshness commit, .gitattributes eol=lf, main branch, no backdating or force-push.
5. Model decision gates as first-class timed tasks. For Origins: H+2, H+4, H+5, H+6 (fallback), H+18-20 ugly take, T-6h audit, and a computed latest build-complete (about H+28). Gates that need the user are WAIT tasks and the other waves keep running.
6. Add a pre-event checklist phase with owners and proofs (the TASKLIST pattern) that must be green before T+0: spec validated against both rubrics, rename, seller wallet funded, env file provisioned, disk >= ~25 GB, Notion and Remote Control tested, probe quarantine hash, freshness runs on 5 and 6 Oct.
7. Build a resource governor with pre-flight gates before every wave: AC power, network reachable, disk free above threshold with ~3 GB margin, RAM >= 2.5 GB, quota headroom from status-line rate_limits. After every wave: sweep orphan processes and scratch. Install one thing at a time and cap test-runner workers per agent.
8. Choose the worktree strategy by measured disk. Only pnpm (store on C:, hardlinks) with enough free space and at most ~3 worktrees; otherwise one working tree with file-disjoint agents. Never npm-install per worktree on this machine.
9. Pace on quota through a status-line side channel (statusline.py also writes rate_limits to a state file), use cheaper models for verification, and require other Claude sessions to be closed during the run.
10. Store times in UTC and display both SGT and Paris in Notion reports. Include a heartbeat, resource readings and the next manual tasks, so a stalled laptop is visible from the phone. Write the report locally first when Notion or the network fails.
11. Schedule manual tasks by the user's location and sleep: channel reads (Discord and BuilderBase by copy-paste; Telegram via MCP only if it covers public channels), recording and voiceover, Drive upload, BuilderBase form, visibility flip, Pages enable. Never inside the 5 h sleep window.
12. Two-developer mode: Notion task claims act as locks, each dev has their own branch, availability windows per dev, and a 'human dev B without /execution' variant (the Origins on-site recruit). One project per machine at a time.
13. Before kickoff, propose and wait for the Origins UI minimum (Cardano rubric: UX & Design 20 %, 'DApp with a frontend, or a tool/agent with a live demo'). Plan the hosted GitHub Pages page early rather than as cut #3.
14. Treat the deliverable chain as a sub-plan with a hard end at the deck lock (23:59 SGT): time-capped /harden, then the final recording, then /prose, README screenshots last (headless capture, because Windows is not activated), Drive, form, and a clean-clone link check.

## Risks
1. Disk exhaustion mid-hack. C: had 4.8 GB free with ~3 GB transient swings during a read-only workflow, and each npm install is 0.7 GB / 128k files. Failed writes can corrupt git and transcripts and kill the orchestrator.
2. RAM exhaustion. Free RAM was 0.79-2.26 GB across two dates, and the house rule records the demo backend killed three times under 1 GB. It can hit the dev server or the screen recorder during the one irreplaceable take.
3. The 5-hour quota window runs out mid-build and stalls every agent, and the 7-day window is already shared with the Hedera push and the rehearsal.
4. The laptop stops silently: it sleeps after 600 s on battery, the lid may be closed, the iPhone tether leaves with the user, or venue Wi-Fi saturates. The autonomous run halts without anyone noticing unless a heartbeat is watched.
5. A prior-work breach: an agent reads or copies research/probes code (K16 shows a previous fence breach), a repo or scaffold is created before 12:00 SGT, the Notion plan holds pre-written designs, or the README implies prior build. The project could be disqualified.
6. The spec is not re-validated against the 24 Sept Cardano rubric: UX & Design 20 % underbuilt, and Impact 20 % against a primary whose money is about $500.
7. Stale inputs drive the plan: the facilitator page is now live, x402 is at 2.28.0, and the field has tripled. The switch rule or x402 route decision gets made on 21 Sept data.
8. An undisclosed security matter or a do-not-carry phrase leaks into a public README, write-up or deck written by an agent.
9. An agent writes to mainnet under the general authorisation, even though Origins is mainnet read-only.
10. Time zone confusion: the laptop auto-switches to SGT, reports mix Paris and SGT, and the Ledger start lands at 00:00 SGT on 7 Oct in the middle of the Origins night.
11. The 'Activate Windows' watermark ends up in the recorded demo or in the README screenshots.
12. The rehearsal is skipped because the 87 h before the flight are shared with Hedera and BNB, so the first real run of /execution is the hack itself.
13. Orphan processes and stale dev servers accumulate over 36 h and hold RAM and ports.
14. A Notion MCP or network outage breaks the per-wave reports that the user relies on from the phone.
15. An on-site dev B (human, no setup) or Eli (unconfirmed setup) breaks the assumption of an identical /execution instance per developer.

## Open questions
1. Was the Origins acceptance received on 28 Sept, and what did the mail give (channels, check-in time, schedule, team formation, submission form)? No local file records it.
2. Has the user signed off primary vs fallback, and chosen the new project name? (Pending on 21 Sept.)
3. Were the organiser questions and the Cardano Foundation private disclosure sent, and were any answered?
4. Is the user still solo for Origins? If someone joins on site, how should the engine treat a dev B without the setup?
5. Given UX & Design at 20 % on the Cardano track, what UI minimum does the user want /execution to build before /frontend exists?
6. Where is the line between a plan and a design in the organisers' eyes? Should it be asked, or should the pre-event plan stay knowledge-level by policy?
7. Does personal, project-agnostic tooling (/execution, /hackathon) count as 'publicly available developer tooling', and should its use be disclosed in the README?
8. What is the Claude plan tier, and what 7-day headroom will remain on 6-7 Oct?
9. Can the Telegram MCP read public channels such as t.me/token2049official? The connector exposed here is named 'DR Profit VIP' and its scope is unknown.
10. Which space may be freed before the flight: the 10.66 GB /harden dev scratch, the caches, compaction of the Ubuntu and Docker vhdx? Each needs the user's approval.
11. Venue logistics: sockets at the tables, the lid-close setting, and whether the laptop can keep running while the user sleeps.
12. Will the CF hosted facilitator URL be published at kickoff? It decides x402 route (b) or none at H+2.
13. Ledger: does Eli use Claude Code and Notion MCP, what are his hours for 6-13 Oct, and is the 'identical setup' of decision 4 realistic for him?

## Findings
- F01 [verified-executed] The hack window: kickoff Tue 6 Oct 12:00 SGT (04:00 UTC, 06:00 Paris). Submission deadline Wed 7 Oct 23:59 SGT (15:59 UTC, 17:59 Paris). The event record now ends Thu 8 Oct 17:30 SGT (demo day). Zone Asia/Singapore, onsite.
  -> Store gates as UTC instants with the zone attached, display them in SGT, and derive every gate from start_at and the deadline.
- F02 [verified-executed] Physical presence at Marina Bay Sands is required for the full 36 h, with no remote participation and no showers.
  -> The laptop runs at the venue all the time, and the phone (Remote Control + Notion) is the only remote console.
- F03 [verified-executed, LB] The rule forbids code, designs or prototypes before kickoff. Projects must be built entirely within the 36 h. Public libraries and developer tooling are allowed.
  -> /execution cannot pre-build or pre-design anything for Origins. Planning is two-step: a knowledge-level skeleton before the event, design-level detail and approval at T+0. The rehearsal must use a fixture.
- F04 [verified-source, LB] The user's research defines the boundary. A CLI shape, schema, report layout or architecture diagram is a design. Even an empty pre-created repo is banned. The repo is created after 12:00 SGT with no date rewriting, and the probes are quarantined (zip + SHA-256). An agent already breached the fence once (K16).
  -> During the build, a skill-scoped hook should deny agent reads of research/probes/** and writes outside the new repo. The repo bootstrap and a README provenance paragraph are T+0 tasks. Never backdate or force-push.
- F05 [verified-executed] Deliverables: a repo (public or judge access), a project link (live URL or hosted demo), and slides as a Google Drive link to .ppt/.keynote with the video embedded. The deck is locked at submission. The Cardano track adds a video of at most 3 min, a write-up and an open-source repo with docs, and is added after the main submission.
  -> The deliverable sub-plan (deck, Drive upload, BuilderBase form, visibility flip) has a hard end at 23:59 SGT and includes manual or approval-gated steps.
- F06 [verified-executed] The main-track rubric is unchanged since 17 Sept: 30/25/20/15/10, slider scoring, teams of 1-4.
  -> These are rubric weights for effort allocation in the event profile.
- F07 [verified-executed, LB] NEW since the 21 Sept plan: the Cardano track has its own rubric of 30 % Technical/Cardano tech, 20 % Innovation, 20 % UX & Design, 20 % Impact & Feasibility and 10 % Pitch. It qualifies 'a DApp with a frontend, or a tool/agent with a live demo'. The 21 Sept plan cuts its viewer third.
  -> The 'simple UI' of decision 6 needs a named minimum for Origins, planned early. The spec must be re-validated against this rubric before kickoff, and the engine proposes this and waits for the user (decision 2).
- F08 [verified-executed] The format is a live pitch with slides, while the demo must be a screen recording embedded in the deck (live demos prohibited). The top-5 pitch is Thu 8 Oct 16:00 SGT, prizes 16:40.
  -> Recording and voiceover are manual tasks that must be done before the deadline. Screening before the top 5 is unpublished (two-stage judging is inferred).
- F09 [verified-source, LB] No validated spec/PRD exists. The latest direction (21 Sept) is primary = Cardano dispute-settlement rail ('Accord', rename required) and fallback = Chainlink CRE 'Unit Guard'. The user's sign-off is pending and his own notes list claims still to verify. The recommendation's 12-part core (about 25 h solo, x402 cut) is the closest plan.
  -> /execution's input is missing for its first real run. A spec-validation step (user-approved, knowledge-level) must come before T+0, and the engine must refuse to plan against an unvalidated spec.
- F10 [verified-source, LB] The Origins plan has fixed decision gates. In SGT: H+2 14:00 collaborator and x402 in/out; H+4 16:00 pre-lock 6-8 preprod escrows; H+5 17:00 path-B verdict; H+6 18:00 broadcast rule (fallback only); H+18-20 Wed 06:00-08:00 complete ugly take; T-6h Wed 17:59 demo audit. The usable budget is about 27.5 h solo.
  -> Gates must be first-class timed tasks. Gates needing the user are WAIT tasks, and unaffected waves continue. The event profile should carry them as data.
- F11 [verified-source, LB] The team was solo as of 21 Sept, and any on-site collaborator is decided by H+2. Such a dev B would be a human without Claude Code, /execution or Notion set up. 98 teams exist on the platform.
  -> Two-developer mode must support a human dev B who does not run the identical setup. The user's instance tracks and verifies dev B's tasks.
- F12 [verified-source] Stack for the primary: TypeScript, Cardano preprod writes against the deployed Masumi V1 Plutus V3 bytes, keyless Koios plus a second provider for mainnet reads, Evolution SDK and Mesh CIP-8, @x402/cardano via route (b) or not at all, Aiken for reading, GitHub Pages. Every transaction needs an explicit invalid_hereafter. Fallback: CRE CLI simulation, bun, Foundry, Base Sepolia.
  -> This is the stack for the event profile and fixes the toolchain pre-flight list.
- F13 [verified-source, LB] The Origins side-effect policy is stricter than the standing authorisation. Mainnet is read-only even after a wallet is set up, which overrides decision 3. Writes go only to preprod escrows we lock. Live Masumi endpoints are never called. The CF Java facilitator is never called or probed. Five undisclosed matters and a do-not-carry phrase list must never reach any artefact.
  -> The engine needs a per-project policy that can narrow the standing authorisations, enforced by hooks (network and endpoint deny, banned-claims grep before commits and before going public).
- F14 [verified-source, LB] Pre-event actions due before 28 Sept are not recorded as done: organiser questions, the CF private disclosure, the rename, funding the preprod seller wallet (404 on 21 Sept), a Base Sepolia key (fallback), cre account access (fallback), the manual prior-art check (ETHGlobal/Catalyst/Devfolio/DoraHacks), and freshness re-runs on 5 and 6 Oct. bun is now on PATH in both shells. forge is still missing from the PowerShell PATH and ~/.svm is absent.
  -> These are manual A-owned tasks that gate wave 1 (seller funding, decision, rename). /execution needs a pre-event checklist with proofs, not only an in-event plan.
- F15 [verified-executed, LB] Inputs decayed between 21 and 30 Sept. x402 is at 2.28.0, with still no exit or settle helper at manifest level. developers.cardano.org/x402 went 404 -> live and says the hosted facilitator URL will be published there. x402.cardano.org is still NXDOMAIN. The Chainlink page confirms that simulation suffices. The Cardano track went from 83 to 231 registrations (55 teams).
  -> The event profile needs a re-verification task class (freshness runs on a schedule and at T+0), and the plan must be re-derivable when an input flips, e.g. the facilitator URL decides x402 route (b)/none at H+2.
- F16 [verified-source] Channels: no hackathon-specific Discord or Telegram was published (as of 10 Sept). The BuilderBase app (announcements/broadcasts/help-requests, login) is the in-event channel. Also TOKEN2049 Telegram t.me/token2049official, the Cardano developer Discord discord.gg/MmeqpAzKbp, a CF x402 support channel still to be published, and CF mentors on site. The 28 Sept acceptance mail is in no local file.
  -> Channel reads are manual copy-paste tasks except Telegram, if the MCP covers public channels. Schedule them outside the sleep window.
- F17 [verified-executed] The sponsor publishes agent skills for AI coding assistants (Cardano AI-assisted development, Masumi skills). The rules say nothing about AI assistants.
  -> At T+0, the build agents can load these as public developer tooling.
- F18 [verified-executed] Hardware: i7-11800H, 8 cores / 16 threads, 15.69 GB RAM, Windows 11 Pro build 26200, a single 453.5 GB NTFS drive C: (external E: not connected; never used for workloads).
  -> CPU is not the binding constraint for parallel agents.
- F19 [verified-executed, LB] Disk is the binding constraint and swings by about 3 GB under agent load: C: free 4.17 GB (21:01) -> 2.38 (21:12) -> 1.89 (21:19) -> 4.53 (21:22) -> 4.83 (21:29 Paris). The main consumers are Temp/claude 20.07 GB (10.66 GB of it one /harden dev session's scratch), the Ubuntu vhdx 17.80 GB, the Docker vhdx 9.57 GB, the pagefile ~14.6 GB, the pnpm store 4.35 GB and the npm cache 1.61 GB.
  -> A disk gate is needed before every wave (with margin for about 3 GB swings), plus scratch cleanup after each wave, one install at a time, and a before-flight manual task to free about 25 GB with user approval.
- F20 [verified-executed, LB] One npm install of the official Cardano x402 starter is 701 MB and 128,046 files. The pnpm store is on the same volume (C:/pnpm-temp/store/v10), so pnpm worktrees can hardlink.
  -> No per-agent npm worktrees at the current free space. Use pnpm plus a small number of worktrees only with enough disk, otherwise one working tree with file-disjoint agents.
- F21 [verified-executed, LB] RAM is the second binding constraint. Free RAM ran 1.42-2.26 GB during this workflow, and commit free 1.20-4.66 GB of 30.33 GB. Heavy background: 15 claude.exe (5.16 GB private), Chrome 1.79 GB, Edge WebView2 1.52 GB, Discord 1.07 GB, Defender 0.88 GB, Notion desktop 0.76 GB, MySQL, SQL Server, MongoDB, Teams, Epic. On 21 Sept it was 0.79 GB free.
  -> Gate at >= 2.5 GB free. A venue RAM plan (stop services and apps, close other Claude sessions) is a manual pre-kickoff task. Cap concurrent heavy build agents at about 3 (4 max).
- F22 [inferred] This workflow's subagents run in-process (no claude.exe per researcher; their children are bash.exe), so the RAM cost of parallelism is the tool processes the agents run, not the agents.
  -> The governor should count heavy tool processes (installs, tsc, test runners, dev servers, browsers) and measure free RAM, rather than cap the number of agents.
- F23 [verified-executed] Tool timeouts leave orphan processes. 74 grep.exe (34 later) had dead parents, e.g. a recursive grep over packages from another session.
  -> Sweep orphans between waves by matching command lines.
- F24 [verified-executed] Toolchain today: node v24.13.0, pnpm 10.19.0, npm 11.6.2, git 2.51.1, gh 2.86.0 (logged in as frytegg), Python 3.13.2 (no python3), bun 1.4.2, aiken 1.1.23, CRE CLI 1.34.0, forge/anvil 1.8.3 (Git Bash only), rustc 1.90.0, Docker client 29.2.1, Java 11, Claude Code 2.1.285, uv 0.10.9, OBS, PowerPoint, ffmpeg. solana, anchor and deno are absent, and yarn is refused because of a pnpm packageManager pin in the home dir.
  -> These are the toolchain pre-flight values. The primary needs nothing new installed; fallback items are listed separately.
- F25 [verified-executed] Docker Desktop is installed but not running. The WSL distros Ubuntu-24.04 (default) and docker-desktop are both Stopped. .wslconfig caps the WSL VM at 6 GB and 4 processors. The Origins primary does not need Docker or WSL.
  -> Keep Docker and WSL off during Origins to save RAM. Ledger's Speculos later needs Docker.
- F26 [verified-executed, LB] Power, time and network: on AC the laptop never sleeps, on battery it sleeps after 600 s, and the lid action is unreadable. Automatic time zone is ON, so the clock will switch to SGT. The current uplink is iPhone USB tethering (default route 172.20.10.1) with Wi-Fi disconnected.
  -> Pre-flight gates need AC, awake and online. Times must be stored in UTC with explicit display zones. A per-wave heartbeat in Notion makes a stalled laptop visible from the phone.
- F27 [verified-executed] Windows is not activated (LicenseStatus 5, Notification), so desktop recordings and screenshots can carry a watermark.
  -> Record with window capture (OBS) and take README screenshots headlessly, or activate Windows first.
- F28 [verified-executed] Git system defaults are core.autocrlf=true and init.defaultBranch=master, with core.longpaths unset. OS long paths are enabled and Developer Mode is off.
  -> The T+0 repo bootstrap adds .gitattributes (eol=lf) and a main branch.
- F29 [verified-source, LB] The 5-hour and 7-day subscription quotas cap a 36 h run, and they are observable: the status line JSON carries rate_limits.five_hour and seven_day used_percentage and resets_at for Pro/Max. The user's statusline.py already renders them. The plan tier is unknown.
  -> Pace on quota: a status-line side channel writes rate_limits to a state file that the engine reads, cheaper models do verification, and no other sessions run during the hack.
- F30 [verified-source, LB] Ledger OP3N two-dev facts: dev B = Eli (DVB, not met as of 22 Sept; skills, hours and tooling unconfirmed; may use another LLM). The window is 6 Oct 18:00 -> 13 Oct 23:59 Paris (= 7 Oct 00:00 SGT, 12 h into Origins; internal freeze 21:00). Dev A is unavailable 6-8 Oct and in Singapore until 12 Oct morning, so Eli carries 6-11 Oct. Finals: 16 Oct 15:00 Paris, 5+5 min, live demo preferred, Speculos OK. No product code before 6 Oct 18:00 Paris (promised). Mentors on weekdays only.
  -> Two-dev mode must handle very unequal availability (dev A away for days), use Notion claims as locks with per-dev branches, and not assume dev B's identical setup. One machine runs one project at a time.
- F31 [verified-source, LB] From 30 Sept 21:00 Paris there are 87 h to the flight (Sun 4 Oct 12:00 Paris) and 129 h to kickoff. The Hedera bounty (closes 5 Oct 05:59 Paris, internal ~2 Oct) and the BNB freeze (Fri 3 Oct) compete for the same hours.
  -> Scope /execution v1 to what can be built and rehearsed on a fixture in about 3 days. If the rehearsal is skipped, the first real run is the hack itself.
- F32 [verified-source, LB] Keys live in research/.env (gitignored) and are loaded only by programs with redaction. The global guard hook blocks agents from reading secrets.
  -> Provisioning the new repo's env is a manual user task (a file outside any repo, loaded by path). Standing testnet authorisation works through programs, never through agents reading keys.
- F33 [inferred, LB] The deliverable chain (build complete -> /harden -> fix -> record -> /prose -> screenshots last -> Drive -> form) must finish before the 23:59 SGT deck lock. /harden took 90 min to about 2h20 on fixtures, and the recording plus slides take about 3 h. So build-complete must land by about Wed 16:00-17:00 SGT (H+28-29). The H+18-20 ugly take is insurance, not the final recording.
  -> The engine computes a latest build-complete gate from the deadline, hands /harden an explicit time cap, and schedules the final recording after harden.