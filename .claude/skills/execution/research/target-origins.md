# Dossier: the first real target (TOKEN2049 Origins) and the machine /execution runs on

Researcher dimension: first real target + machine. Read-only research, 2026-09-30, about 20:55-21:45 Paris (CEST, UTC+2).
Every time below says its zone. SGT = Asia/Singapore = UTC+8 = Paris + 6 h during October 2026.
Confidence labels: **verified-executed** (I ran it today), **verified-source** (read in a primary file/page, quoted),
**reported** (a memory or a report says so, not re-checked), **inferred** (my reasoning, marked as such).

---

## Summary for the designer

1. Origins is in person at Marina Bay Sands for 36 h: kickoff Tue 6 Oct 12:00 SGT, submission locked Wed 7 Oct 23:59 SGT (organiser API today: `submission_deadline_effective` 2026-10-07T15:59Z); top-5 live pitch Thu 8 Oct 16:00 SGT; the demo is a screen recording embedded in a .ppt/.keynote deck.
2. "No code, designs, or prototypes before kickoff": the research's own boundary table counts a CLI shape, schema, report layout or architecture diagram as a design and bans even an empty pre-created repo, so /execution can only pre-stage knowledge, provisioning and itself; the design-level plan must be produced and approved at T+0.
3. No validated spec exists. The nearest input is wave-3 `_recommendation.md` (21 Sept: primary = Cardano dispute-settlement rail, fallback = Chainlink "Unit Guard", decision still "pending"); it predates a new Cardano-track rubric (live by 24 Sept) that weights UX & Design 20 % and Impact 20 %, while the plan cuts its viewer third.
4. The plan has fixed decision gates (H+2 collaborator and x402 in/out, H+4 escrow bank, H+5 path-B verdict, H+18-20 ugly take, T-6h audit) and a side-effect policy stricter than the standing authorisation: preprod writes only, mainnet read-only, banned endpoints, five undisclosed matters, a do-not-carry phrase list.
5. The ground moved in 9 days: @x402/cardano 2.26.0 -> 2.28.0, the CF x402 page went 404 -> live ("The hosted facilitator URL and the support channel will be published here."), and the Cardano track went from 81 to 231 registrations (55 teams). None of the P0 actions of 21 Sept is recorded as done.
6. Machine: i7-11800H 8C/16T, 15.69 GB RAM, one 453 GB drive. During this workflow C: free swung 4.17 -> 1.89 -> 4.83 GB in 28 min and free RAM stayed 1.4-2.3 GB. Disk and RAM bind, not CPU. One npm install of the Cardano starter = 701 MB / 128,046 files, so per-agent npm worktrees are impossible today.
7. Pre-flight gates the engine needs: at least ~25 GB free (inferred), RAM >= 2.5 GB, AC power (the laptop sleeps after 600 s on battery), explicit time zones (auto time zone is ON), network (the uplink today is an iPhone USB tether), 5h/7d subscription quota headroom, and window capture for recordings (Windows is not activated).
8. Two-developer mode (Ledger OP3N) starts 12 h into Origins (7 Oct 00:00 SGT), with dev B = Eli, whose tooling is unconfirmed. One machine cannot run both projects at once.

---

## Findings

### F01. The hack window, in three zones, from the organiser's own API (verified-executed)
- Claim: kickoff Tue 6 Oct 12:00 SGT (04:00 UTC, 06:00 Paris). Submission deadline Wed 7 Oct 23:59 SGT (15:59 UTC, 17:59 Paris), no late entries. The event record now ends Thu 8 Oct 17:30 SGT, which covers demo day. Time zone Asia/Singapore, mode onsite.
- Evidence: `curl https://edge.builderbase.com/events/public/token2049-origins-hackathon` (2026-09-30 ~19:35 UTC):
  `"tz":"Asia/Singapore","start_at":"2026-10-06T04:00:00+00:00"`, `submission_deadline_effective: 2026-10-07T15:59:00+00:00`,
  `end_at: 2026-10-08T09:30:00+00:00` (was `2026-10-07T16:00:00+00:00` in the 17 Sept snapshot
  `research/probes/builderbase/tracks/_events-public-token2049-origins-hackathon.json`), `mode_effective: onsite`.
  Same API, main-track text: "Submission deadline: 12:00am on 8 October (submit by 11:59pm on 7 October). No late entries allowed."
  Zone conversions computed with Python `zoneinfo` (window = 35.98 h).
- Confidence: verified-executed.

### F02. Physical presence for the full 36 hours, no remote participation, no showers (verified-executed)
- Evidence (live page `https://token2049.com/singapore/2049-origins`, fetched today): "Physical attendance at Marina Bay Sands in Singapore is required for the full 36 hours. We do not offer online or remote participation." ... "Rest and chill-out spaces are available on a first-come, first-served basis. However, there are no shower facilities at the venue, so we recommend booking comfortable accommodation nearby."
- Implication: the laptop runs at the venue for 36 h, and the user sleeps (5 h budgeted) either at the venue or away from it. The phone is the only remote console.
- Confidence: verified-executed.

### F03. The prior-work rule, verbatim (verified-executed)
- Evidence, live FAQ today: "Can I start working on my project before the event beings? No. To maintain fairness, all project work must begin after the official hacking period starts. You can brainstorm ideas, but no code, designs, or prototypes before kickoff."
  Organiser API, main track, today: "Built during Origins — All submitted projects must be built entirely within the 36-hour Origins Hackathon. Projects, prototypes or substantial code developed prior to the official start of the hackathon are not eligible. Publicly available libraries, frameworks, APIs and developer tooling may of course be used."
- Confidence: verified-executed.

### F04. Where the user's own research drew the line, and one past breach of it (verified-source)
- Claim: knowledge crosses the start line. Code, designs and artefacts do not. A CLI shape, a schema, a report layout or an architecture diagram all count as designs. No repo may be created before 12:00 SGT, not even an empty scaffold. The probe code must be quarantined. An agent has already written outside the fence once.
- Evidence:
  - `C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/cand-facilitator-conformance-layers.md:145-146`: "A vector file schema, report layout, CLI shape or architecture diagram drafted before kickoff (these are **designs**)" | "A pre-built GitHub repo, even an empty scaffold with the name".
  - same file :149-152: "**Quarantine before kickoff.** Before 6 Oct 12:00 SGT, zip `probes/facilitators/`, `probes/starter-2.14/` and `probes/cand-facilitator-conformance/`, record the zip's SHA-256 ..." / "**New repo created after 12:00 SGT.** The first commit is timestamped in the window. No force-pushes that rewrite dates."
  - `research/findings/wave3/_recommendation.md:510-511`: "**No repository, no scaffold, no snippet, no starter — not even a `package.json`.** Research, measurement, provisioning and reading cross the line. Code does not."
  - `research/findings/known-behaviour.md:24` (K16): "Boundary incident: 4 copies of upstream `@x402/cardano` source had been written to `token2049/src/exact/` (outside the fence)."
  - `token2049/.gitignore`: "# Knowledge crosses into the event; nothing in research/ is ever committed to the submission." then `research/`.
  - `_recommendation.md:488-491`: the answer to "did you build this before?" is "the committed kickoff freshness diff, the `findings/` research dated before the event **with no source file in it**, and the rule stated plainly in the README".
- Confidence: verified-source.

### F05. What gets submitted (verified-executed)
- Claim: every team submits to the main track: a GitHub repo (public or with judge access), a project link (a live URL or hosted demo) and slides (a Google Drive link to a .ppt or .keynote file, with the demo video embedded). The deck is locked at submission. The Cardano track adds a demo video of at most 3 minutes, a write-up, an open-source repo with docs, and a working prototype on a Cardano network. The partner track is added after the main submission.
- Evidence, organiser API today: main track "What every team submits": "GitHub repo — public, or with judge access granted", "Project link — live URL or hosted demo", "Presentation slides — Google Drive link to a .ppt or .keynote file"; stage notes: "Locked at submission — No changes after the deadline, so make sure your deck is stage-ready before you submit." Cardano track: "Submit to the main track for the Top 5, then add this track." ... "Demo video (max 3 minutes) showing the product in action." ... "Project write-up : problem, technical approach and how it could be deployed or scaled."
- Confidence: verified-executed.

### F06. The main-track rubric, unchanged since 17 Sept (verified-executed)
- Evidence, API today: `('Functionality & Execution','0.3'), ('Technical Implementation & Integration','0.25'), ('Innovation & Originality','0.2'), ('Usefulness & Potential Impact','0.15'), ('Demo & Presentation','0.1')`; `config_json`: `"scoring_input_mode": "slider"`, `"team_limits": {"max_team_size": 4, "min_team_size": 1}`, `"team_application_mode": "individual"`. It matches `research/findings/rubric.md:13-21`.
- Confidence: verified-executed.

### F07. NEW: the Cardano track now has its own rubric, and 20 % of it is UX & Design (verified-executed)
- Claim: since at least 24 Sept, Cardano scores its track on 30 % Technical Execution & Use of Cardano Tech, 20 % Innovation & Creativity, 20 % User Experience & Design, 20 % Impact & Feasibility and 10 % Pitch & Presentation. To qualify, a project needs "a DApp with a frontend, or a tool/agent with a live demo". The 21 Sept plan was written before this rubric existed. It treats the viewer as cut #3 and puts the primary's weakest axis, money and impact, at 15 %.
- Evidence, API `events/public/cardano-agentic-commerce` today (`updated_at 2026-09-24T13:39:53Z`): "This track has its own criteria. Weights show how much each counts toward the track score. 30% Technical Execution & Use of Cardano Tech ... 20% Innovation & Creativity ... 20% User Experience & Design Is the design intuitive and user-friendly? Does it consider real-world onboarding and usability? Could someone new to blockchain understand it quickly? 20% Impact & Feasibility ... 10% Pitch & Presentation"; "To qualify A working prototype on Cardano network : a DApp with a frontend, or a tool/agent with a live demo." Also: "This track is scored on the Cardano criteria above; the main-track rubric applies to your main-track submission."
  Contrast: `_recommendation.md:225` "3. **The viewer** (−2.0 h, if no collaborator) — committed JSON plus one static HTML table."
- Confidence: verified-executed.

### F08. The format: live pitch with slides, recorded demo, deck frozen at the deadline (verified-executed + reported)
- Evidence, API today: "Slides are a visual aid for your live pitch. Keep them visual and punchy." / "Live demos are prohibited to avoid technical errors on stage. Use a screen recording and embed the video directly in your slides. Do not link to YouTube or external video." / ".ppt or .keynote only. Google Slides, Gamma or Vercel page links are not accepted".
  Top-5 slot: `C:/Users/Utilisateur/Documents/Documents Perso/CV Stage 2027/internship/networking/singapore.md:32` "Thu 8 | Workout → main stage day 2 → **top-5 demos 16:00, prizes 16:40**" (reported, the user's planning file). Consistent with API `end_at` 17:30 SGT.
  Whether a screening round precedes the top 5 is not published. `research/findings/prior-2026-09-10/recon_rules-and-form.md:29` infers two-stage judging from the BuilderBase playbook (inferred).
- Confidence: verified-executed for the format, reported for the 16:00 slot.

### F09. The chosen direction and the state of the spec, with dates (verified-source)
- Claim: as of the latest files (21 Sept), the primary is the Cardano dispute-settlement rail (`cardano-disputes` candidate A, working title "Accord", which must be renamed because the name is taken) and the fallback is Chainlink CRE "Unit Guard". The default is the Cardano idea, but the user had not signed it off, and his own notes list claims still to verify with the jury. No spec/PRD file exists. The closest thing to a plan is `_recommendation.md` section 2.1.6: 12 parts, about 25 h solo with x402 cut, 27.5 h usable.
- Evidence:
  - `research/findings/wave3/_recommendation.md:26-27`: "**`cardano-disputes` candidate A (working title *Accord*, and it must be renamed) as primary**, with **`chainlink-feed-identity` C1 *Unit Guard* as the fallback**".
  - `research/findings/wave3/DECISION-fr.md:128`: "**Par défaut : idée 1 (Cardano).**" (written 2026-09-21).
  - `C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur/memory/project_token2049_origins.md:3` (modified 2026-09-21): "primary = Cardano dispute-settlement rail, fallback = Chainlink Unit Guard; track decision and P0 actions pending".
  - `token2049/cardano_pitc.txt:7` (2026-09-21 15:29, user's notes): "A verifier reelement, et a prévenir avant avec les jurys pour savoir si l'on peut dire ca lors de la démo ou non".
  - `_recommendation.md:212` "**Solo total, x402 cut** | **≈25.0 h** | | **2.5 h slack against 27.5 h**"; `:387` "**At the event.** Do **not** switch clusters after kickoff".
  - No file in `research/findings/` is newer than 2026-09-21 13:23 (`find ... -printf` listing).
- Confidence: verified-source.

### F10. The plan's fixed decision gates (verified-source)
- Evidence, `_recommendation.md`:
  - :195-196: "36 h wall clock − 5 sleep − 2 kickoff/venue/organiser questions − 1.5 submission mechanics = **≈27.5 h usable solo**".
  - :204: "**the only genuinely unexecuted mechanism. Hours 1–5, before anything depends on it.**"
  - :236-238: "**Hour 2 is the irreversible decision point:** collaborator yes/no, and x402 in/out." / "**Hour 18–20: record a complete, ugly take.**"
  - :249: "**Pre-lock a bank of 6–8 preprod escrows at hour 4**".
  - :349-351 (fallback only): "if `cre workflow simulate --broadcast` has not put a transaction into a receiver by **hour 6**, switch to the written fallback".
  - `C:/Users/Utilisateur/.claude/skills/hackathon/SKILL.md:181-182`: "Run `04-demo-audit.md` at T-6h whatever the state of the build."
- The same gates in SGT (Python `zoneinfo`): H+2 Tue 14:00, H+4 Tue 16:00, H+5 Tue 17:00, H+6 Tue 18:00, H+18 Wed 06:00, H+28 Wed 16:00, T-6h Wed 17:59, deadline Wed 23:59.
- Confidence: verified-source.

### F11. The team: solo as of 21 Sept, with any on-site recruit decided by hour 2 (verified-source + verified-executed)
- Evidence: `_recommendation.md:513` 'Owner is the applicant unless stated. "Collab" = the on-site collaborator, who does not exist yet.'; `:577` "Decide the team question before kickoff, and recruit in the first two hours or not at all ... The collaborator takes the **viewer, the hosted GitHub Pages link, the README and the slides** ... and **must not touch the transaction layer**." Live FAQ: "Solo applicants are welcome. If you’d like to join a team but don’t have one, we'll help you find a team." API today: main event `team_count: 98`, `registration_count: 285`.
- Implication (inferred): a dev B at Origins would be a human recruited on site, without Claude Code, /execution or Notion set up the same way. The user's decision 4 (identical setup) holds for Ledger, not for Origins.
- Confidence: verified-source (team status 21 Sept), verified-executed (counts).

### F12. Stack and toolchain for the primary and the fallback (verified-source, versions verified-executed)
- Primary: TypeScript. Cardano **preprod** for writes, against the deployed Masumi V1 `vested_pay` Plutus V3 bytes. Keyless Koios plus a second provider (Blockfrost or NOWNodes Blockfrost-compatible) for mainnet reads. `@evolution-sdk/evolution` for transaction chaining and partial signing. Mesh `signData`/`checkSignature` for CIP-8. `@x402/cardano` via route (b) or not at all. Aiken 1.1.23 for reading validators. A static GitHub Pages project page.
  - `_recommendation.md:534`: "**`@evolution-sdk/evolution`** transaction chaining and partial signing; **Mesh** `signData` / `checkSignature`."
  - `:251`: "**Every transaction must carry an explicit `invalid_hereafter`.** ... Also: exactly one script input per tx, at most one script output."
  - `:187-189`: judge re-run commands "`census:mainnet` (keyless, public endpoint), `verify:<txhash>` ... and `demo:preprod` (the only key-bearing command ...)".
  - `:493-497`: "Host a static page on **GitHub Pages** (same repo, no backend, no framework, **not Vercel**)".
- Fallback: CRE CLI (simulation accepted), bun, Foundry, Base Sepolia (`_recommendation.md:349-362`).
- Confidence: verified-source.

### F13. The Origins side-effect policy is stricter than the standing authorisation (verified-source)
- Claim: for this project mainnet is read-only, even after a wallet is set up, which overrides user decision 3. Writes go only to preprod escrows we lock ourselves. Live Masumi endpoints are never called. The CF-hosted Java facilitator is never called or probed. Five undisclosed security matters must never be demoed, slid or published.
- Evidence, `_recommendation.md:455-458`: "**Mainnet is read-only.** For the primary: no transaction is built, evaluated or submitted against any mainnet escrow UTxO, **not even in evaluation mode**; every write is preprod, on escrows we locked ourselves; `POST /request-repair` and every other live Masumi endpoint is **never called**". `:442-444`: "self-host the **upstream TypeScript** facilitator only; never call the CF-hosted Java facilitator; never probe it; never file a public issue; never put it on a slide." `:436-439`: "These are **private-disclosure candidates and are not yet disclosed**." The do-not-carry phrases are `research/findings/wave2/_summary.md` section 5 (line 607) and `_recommendation.md` section 3.1 (lines 393-434).
- Confidence: verified-source.

### F14. Pre-event actions still open (verified-source; I found no later record of any being done)
- P0 (`_recommendation.md:515-524`, due "before 28 Sept acceptance"): send the organiser questions; file the K9 private disclosure to the Cardano Foundation; rename the project; fund a second preprod party wallet; fund a Base Sepolia key (fallback); run `cre account access` (fallback). Both outbox drafts are dated 2026-09-21 12:52 and carry no sent marker (`research/outbox/01-organiser-questions.md`, `02-cardano-foundation-disclosure.md`). `MEMORY.md:10` still reads "security disclosure owed to CF".
- Wallets, `research/findings/known-behaviour.md:75` (K33, 21 Sept): "preprod **buyer** wallet holds **9,707.899 tADA** (+1 asset); the declared preprod **seller** address returns **404 — never seen on chain, 0 tADA**".
- Prior-art hole, `known-behaviour.md:76` (K34): "**Still open and needing a human with a browser: ETHGlobal showcase (client-rendered), Devfolio, DoraHacks**".
- P3 toolchain, re-checked today: bun is now on PATH in Git Bash and PowerShell (was a gap on 21 Sept). `forge` is still not on the PowerShell PATH. `~/.svm` is absent. `cre` is still v1.34.0. The last three matter only for the fallback.
- P4 freshness re-runs "on 5 Oct AND on the morning of 6 Oct, and commit the diff as the kickoff freshness artefact" (`_recommendation.md:559-560`). The switch rule is evaluated on the morning of 5 Oct (`:377-384`).
- Confidence: verified-source for the open list; verified-executed for the toolchain items.

### F15. Inputs that decayed between 21 and 30 Sept (verified-executed)
- `npm view`: `@x402/cardano` and `@x402/core` are at **2.28.0** (`time.modified` 2026-09-29), up from 2.26.0 (K31). At manifest level there are still 0 hits for refund|settle|dispute|exit|arbitrat, and the exports are unchanged (`./exact/{client,server,facilitator}`). So switch-rule 1 is still unrealised, but only at manifest level.
- `developers.cardano.org/x402` now 301 -> `/x402/` 200 (it was 404 on 17 and 21 Sept, K2/K33). The page says, verbatim: "The hosted facilitator URL and the support channel will be published here." It also offers an "Express starter — Client, server and a local facilitator, ready to run in two terminals." `x402.cardano.org` is still NXDOMAIN (`nslookup`). `cardano-foundation/x402-cardano-demo` was pushed 2026-09-30T10:18:28Z (`gh api`).
- BuilderBase Cardano track: still no "x402 payment on preprod through the provided facilitator" item (0 hits for "preprod" and "facilitator").
- Chainlink track FAQ, verbatim: "Do I need deploy access to compete? No. A successful simulation with cre workflow simulate satisfies the track requirement." This answers organiser question Q5.
- Field size (API today vs `findings/wave1/_summary.md:39-43` on 17 Sept):

  | Track | 17 Sept registrations | 30 Sept registrations | 30 Sept teams |
  |---|---|---|---|
  | Main | 311 | 285 | 98 |
  | Cardano | 83 | 231 | 55 |
  | Chainlink | 70 | 188 | 44 |
  | Solana | 92 | 228 | 49 |
  | NOWNodes | 32 | 150 | 42 |

- Confidence: verified-executed.

### F16. Event and sponsor channels (verified-source / verified-executed / reported)
- No hackathon-specific Discord or Telegram was published as of 10 Sept. `recon_rules-and-form.md:33`: "Official comms: X twitter.com/token2049, Telegram t.me/token2049official, info@token2049.com; no hackathon-specific Discord or Telegram is published anywhere [VERIFIED]".
- The BuilderBase app is the in-event channel (login required). The API route table has `help-requests`, `announcements` and `broadcasts` (`recon_rules-and-form.md:25`, inferred as the real channel). Participant app URL from the live page JSON-LD: `https://app.builderbase.com/event/token2049-origins-hackathon`.
- Cardano developer Discord (developers.cardano.org navbar today): `href="https://discord.gg/MmeqpAzKbp" ... aria-label="Engineering and Development Discord"`. The CF x402 "support channel will be published" on developers.cardano.org/x402 (F15).
- Mentors: `prior-2026-09-10/bounty_cardano.md:155` "**Cardano Foundation mentors on site throughout the 36 hours** (page text)" (reported). NOWNodes support: "live chat / Telegram, claimed 3-minute first response, 24/7" (`bounty_nownodes.md:256`, reported).
- Reading constraints: Discord is manual copy-paste only (`memory/project_hedera_scaffold_bounty.md:80-81`: "Discord cannot be scraped via MCP ... use search + copy-paste"). BuilderBase needs the user's browser login. The acceptance e-mail of 28 Sept, which may name channels, is in no local file.
- Confidence: mixed, as marked.

### F17. The sponsor publishes AI-assistant skills (verified-executed)
- Evidence (Cardano track resources, API today): "Code with AI · Agent Skills AI-assisted development on Cardano: agent skills for your coding assistant. developers.cardano.org/docs/developers/curriculum/start-building/ai-assisted-development" and "Code with AI · Masumi Skills Masumi skills for AI coding assistants, from the Masumi documentation. masumi.network/dev/masumi/documentation/integrations/masumi-skills".
- Implication (inferred): these are public developer tooling, which the rule allows. /execution can load them into build agents at T+0. Neither the rules nor the FAQ say anything about AI coding assistants.
- Confidence: verified-executed.

### F18. The hardware (verified-executed)
- `Get-CimInstance`: "CPU: 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz", "Cores: 8  LogicalProcessors: 16", "RAM total GB: 15.69", "OS: Microsoft Windows 11 Professionnel build 26200", "C: NTFS size GB 453.5". Only one fixed drive is present. E: is not connected today; per memory it is exFAT and "never run workloads on E:" (`project_xrpl_core_dev_bootcamp.md:28-31`).
- Confidence: verified-executed.

### F19. Disk is the binding constraint, and it swings by about 3 GB under agent load (verified-executed)
- Free space on C: read with `Win32_LogicalDisk`: **21:01 4.17 GB -> 21:12 2.38 -> 21:19 1.89 -> 21:22 4.53 -> 21:29 4.83** (Paris). The brief records 6.9 GB earlier today. The pagefile did not grow (14,985 MB allocated), and `Temp/claude` stayed at 20.07 GB between two reads, so the transient writer was elsewhere. I did not identify it (sibling experiment sessions were active).
- The largest consumers, measured with robocopy `/L` listing and `Get-Item` (read-only):

  | Item | Size |
  |---|---|
  | `C:/Users/Utilisateur/AppData/Local/Temp/claude` | 20.07 GB |
  | ... of which scratch of session `07b2a7e3...` (/harden development pilots, last written 25 Sept) | 10.66 GB |
  | ... of which BNB (keep: "BNB holds ~7 GB of on-chain research data", memory) | 7.17 GB |
  | ... of which XRPL-Hackathon-2026 | 1.25 GB |
  | Ubuntu-24.04 `ext4.vhdx` (xrpld build, kept for the NYC bootcamp) | 17.80 GB |
  | Docker `docker_data.vhdx` (needed later for Ledger Speculos) | 9.57 GB |
  | `C:/pagefile.sys`, system-managed | ~14.6 GB |
  | pnpm store `C:/pnpm-temp/store/v10` | 4.35 GB |
  | npm cache | 1.61 GB |

- Precedents: `memory/project_hedera_scaffold_bounty.md:59-60` "**Disk C: filled up during wave 2b** (parallel installs + Docker vhdx 12 GB ...): run ONE install at a time"; `project_ledger_op3n.md:62` "**Disk incident 24 Sept:** C: fell to 0.78 GB".
- Confidence: verified-executed.

### F20. What one install of the Origins stack costs (verified-executed)
- robocopy listing of the research installs: `probes/starter-2.14/node_modules` (the official Cardano x402 starter, npm, `package-lock.json`) is **701 MB, 128,046 files**. `probes/cre/node_modules` is 92 MB, 15,998 files. `probes/masumi-refute/node_modules` is 76 MB, 16,520 files.
- Implication (inferred): each npm-installed worktree adds about 0.7 GB and 128k files that Defender (MsMpEng, 876 MB private) scans. With pnpm, the store is on the same volume (`pnpm store path` -> `C:\pnpm-temp\store\v10`), so worktrees can hardlink instead.
- Confidence: verified-executed.

### F21. RAM is the second binding constraint (verified-executed + reported)
- Free RAM ranged from 1.42 to 2.26 GB during this workflow. Commit free was 1.20-4.66 GB of a 30.33 GB commit limit.
- The heaviest process groups by private bytes (21:01):

  | Process group | Private memory |
  |---|---|
  | `claude` x15 | 5,155 MB |
  | `node` x9 | 2,283 MB |
  | `chrome` x17 | 1,792 MB |
  | `msedgewebview2` x20 | 1,519 MB |
  | `Discord` | 1,067 MB |
  | `MsMpEng` | 876 MB |
  | `grep` x73 | 767 MB |
  | `Notion` | 760 MB |
  | `mysqld` | 667 MB |
  | `sqlservr` | 509 MB |
  | `Telegram` | 442 MB |
  | `mongod` | 405 MB |
  | `EpicGamesLauncher` | 267 MB |
  | `ms-teams` | 179 MB |

- 21 Sept baseline, `research/findings/wave3/solana-approvals-3-feasibility.md:61`: "15.69 GB total, **0.79 GB free at measurement**; 38.4 GB free on C:; 16 logical cores".
- The house rule, `C:/Users/Utilisateur/.claude/skills/hackathon/references/06-operations.md:65-70`: "The demo backend was killed three times in one night, always under 1 GB free." ... "Measure free memory. Below ~2.5 GB, act."
- Confidence: verified-executed.

### F22. Subagents run in-process, so the cost of parallelism is the tools they run (process tree verified-executed; mapping inferred)
- Evidence: five interactive `claude.exe` sessions were launched from `powershell.exe` (11:22, 11:40, 20:12, 20:35, 20:57), using 582-987 MB private each. Their only children are `bash.exe`, never a `claude.exe` per researcher, even though this workflow runs several researchers in parallel. One older `claude` (16:08) has 9 `claude.exe` children.
- Implication (inferred): budget RAM per concurrent heavy tool process (install, `tsc`, test runner, dev server, browser), not per agent. Test runners default to roughly one worker per core, 16 here, so cap them per agent.
- Confidence: inferred (built on a verified process table).

### F23. Tool timeouts leave orphan processes (verified-executed)
- Evidence: 74 `grep.exe` at 21:01 (34 at 21:29), created 20:24-21:01, and their parent processes are gone. Example command line: `"C:\Program Files\Git\usr\bin\grep.exe" -rn manifest packages --include=*.ts ... -l` paired with `grep -v node_modules` (from another session's recursive search).
- The house rule, `06-operations.md:89-91`: "Background tasks that were killed by the system leave residue holding memory. Sweep them."
- Confidence: verified-executed.

### F24. Toolchain versions today (verified-executed)
- Present: node v24.13.0, pnpm 10.19.0, npm 11.6.2, git 2.51.1.windows.1, gh 2.86.0 ("Logged in to github.com account frytegg (keyring)", protocol https), Python 3.13.2 (`python` and `py`, no `python3`), bun 1.4.2 (both shells), aiken v1.1.23+8949565, CRE CLI v1.34.0, forge/anvil 1.8.3 (Git Bash only), rustc/cargo 1.90.0, Docker client 29.2.1, OpenJDK 11.0.16.1, Claude Code 2.1.285, uv 0.10.9, ffmpeg (scoop), OBS Studio, PowerPoint (`POWERPNT.EXE`), Snipping Tool 11.2607 and Clipchamp.
- Absent: solana, anchor, deno. `yarn` is refused: "This project is configured to use pnpm because C:\Users\Utilisateur\package.json has a "packageManager" field".
- Confidence: verified-executed.

### F25. Docker and WSL: installed, stopped, not needed for the Origins primary (verified-executed)
- `wsl --list --verbose`: `* Ubuntu-24.04 Stopped 2`, `docker-desktop Stopped 2`. `~/.wslconfig`: `memory=6GB processors=4 swap=2GB`. `Docker Desktop.exe` is present but no Docker process is running (only `wslservice`).
- Implication (inferred): the primary is TS + HTTP APIs + preprod, so keeping WSL and Docker off saves up to 6 GB of RAM. Ledger needs Docker for Speculos later.
- Confidence: verified-executed.

### F26. Power, time and network (verified-executed)
- `powercfg /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE`: AC `0x00000000` (never), DC `0x00000258` (600 s). The lid-close action is hidden in the active scheme and could not be read. Battery was at 56 % when checked.
- `tzutil /g` = "Romance Standard Time". `tzautoupdate Start` = 3 (automatic time zone ON) and location consent is Allow, so the clock will likely switch to SGT in Singapore (inferred).
- `Get-NetRoute 0.0.0.0/0`: "Ethernet 2 via 172.20.10.1". The adapter is "Apple Mobile Device Ethernet", i.e. iPhone USB tethering. Wi-Fi is Disconnected.
- Confidence: verified-executed.

### F27. Windows is not activated, which puts a watermark on desktop recordings (verified-executed + reported)
- `SoftwareLicensingProduct`: "Windows(R), Professional edition | LicenseStatus 5" (5 = Notification, not activated).
- House rule, `06-operations.md:138`: "Activate the operating system, or every recording and screenshot carries a watermark."
- Confidence: verified-executed (status), reported (the watermark effect).

### F28. Git defaults on this machine (verified-executed)
- `git config --show-origin`: `C:/Program Files/Git/etc/gitconfig core.autocrlf=true` and `init.defaultBranch=master`. `core.longpaths` is unset. The OS has `LongPathsEnabled=1`. Developer Mode is off, so symlinks need admin (junctions do not).
- Precedent: /harden found "H-069 (no `.gitattributes`, `deploy.sh` CRLF on Windows)" (`memory/project_xrpl_vault_oracle.md:40-41`).
- Confidence: verified-executed.

### F29. Subscription quota is a hard ceiling that /execution can observe (verified-source)
- Evidence: Claude Code status line docs (`https://code.claude.com/docs/en/statusline.md`, lines 193-194): "`rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage` | Percentage of the 5-hour or 7-day rate limit consumed" and "`resets_at` | Unix epoch seconds when ... resets". Line 339: "`rate_limits`: appears only for claude.ai Pro and Max subscribers ... and only after the first API response in the session."
  The user's `~/.claude/statusline.py:47-51` already renders the 5h and 7d windows. The plan tier (Pro, Max 5x or Max 20x) is unknown. A 36 h run spans about seven 5-hour windows.
- Cost precedent: /harden, `memory/project_harden_skill.md:49-50`: "90 min, USD 35" (one autonomous pilot); `:28-29` "a WITH run costs ~3.7x baseline wall time (~2h20)".
- Confidence: verified-source.

### F30. Ledger OP3N, only what matters for two-developer mode (verified-source + reported)
- Dates, `Documents/Coding/Ledger Op3n/research/inbox/2026-09-22-op3n-hackathon-brief.md:11-15`: "October 6th, 6PM CET: Start of the hackathon / October 13th, 11:59PM CET: Submission close / ... October 16th, 3PM CET, Paris HQ: Final pitches". The organiser said "CET" means Paris time (`research/findings/rubric.md:381`). So the start is Tue 6 Oct 18:00 Paris = **Wed 7 Oct 00:00 SGT, 12 h into Origins**. The close is Tue 13 Oct 23:59 Paris = 21:59 UTC. The internal freeze is 21:00 Paris (`rubric.md:171`).
- Finals, `rubric.md:380`: "**10 min max = 5 min pitch + 5 min Q&A**; slides free; **live demo preferred if possible**". Speculos is fine (`:374`). There are no mentors at weekends (brief :24). At most 2 people on stage (brief :17).
- Team: `memory/project_ledger_op3n.md:17`: "Teammate: **Eli** (DVB, not met yet)". `research/RAPPORT-ELI.md:86-89`: "**Alexandre** est à Singapour (TOKEN2049) jusqu'au matin du 12 octobre ... **Eli** porte donc le build du 6 au 11 octobre → l'idée doit être réalisable par lui seul, avec un environnement qui tourne sur sa machine avant le 6." Open questions to Eli, `:391-392`: "Qu'est-ce que tu codes (TypeScript ? Solidity ? Python ?) et combien d'heures du 6 au 13 ? As-tu un Ledger ?" `:427` "Consignes si tu colles ce document dans un autre LLM": Eli may not use Claude Code (inferred).
- Promise: `memory/project_ledger_op3n.md:45-46`: "the user promised **no code before 6 Oct** — keep pre-event work to research/specs/pitch"; `rubric.md:387`: "**No product code before 6 Oct 18:00 Paris.**"
- The rubric, T&C and submission form were not published as of 23 Sept (`rubric.md:3-4`).
- Confidence: verified-source (files), reported (Eli's setup).

### F31. The calendar before the flight is short and shared (verified-source)
- From 30 Sept 21:00 Paris there are 87 h to the flight (Sun 4 Oct 12:00 Paris = 18:00 SGT) and 129 h to kickoff (zoneinfo). The Hedera bounty closes "Sun 4 Oct 2026 23:59 ET (= Mon 5 Oct 05:59 Paris)" (`memory/project_hedera_scaffold_bounty.md:20`), with an internal target of about 2 Oct. BNB holdover: "Fri 2026-10-03 freeze · 4-8 Oct Singapore, no deploys" (`C--Users-Utilisateur-Documents-Coding-BNB/memory/project_bnb_holdover.md:43`).
- Confidence: verified-source.

### F32. Secrets live outside the reach of the agents (verified-source)
- `research/findings/access.md:3-4`: "Secrets live in `research/.env` (gitignored). Probes must load them through `research/probes/lib/secrets.mjs` and print only through `safeLog`/`redact`. Never echo, log, or write a key or mnemonic into any report." Hedera pattern (`memory/project_hedera_scaffold_bounty.md:58`): "key in workspace `.env`, portal format; only ever loaded via `node --env-file`". The global guard hook blocks secret reads (`memory/project_harden_skill.md:70`: "hooks/guard.py (no AI attribution in commits, no secret reads incl. .npmrc/.pypirc)").
- Implication (inferred): the new repo's keys must be provisioned by the user (manual task), and programs load them without any agent reading them. The research `.env` must not be copied into the repo.
- Confidence: verified-source (I did not open any `.env`).

### F33. The order of the deliverable chain has to fit inside the locked deadline (verified-source + inferred)
- `~/.claude/CLAUDE.md` rule 5: "Order: build complete → harden → fix → record → ship." /harden cost 90 min to about 2 h 20 on fixtures and budgets "up to 10 h by repo size" (`project_harden_skill.md:60`). The recommendation reserves "Recording ... + 8–10 slides + the three rehearsed sentences | **3.0**" h (`_recommendation.md:211`). The deck is "Locked at submission" (F05).
- Inferred: working back from 23:59 SGT, build-complete has to land by about Wed 16:00-17:00 SGT (H+28-29). That coincides with the T-6h audit (17:59), and /harden needs an explicit time cap. The "ugly take" at H+18-20 is insurance and must not be treated as the final recording, which comes after harden.
- Confidence: inferred (from verified inputs).

---

## Draft event profile: TOKEN2049 Origins 2026

Stored times should be UTC with the zone attached. Display in SGT.

| Field | Value | Source |
|---|---|---|
| Event | TOKEN2049 Origins Hackathon 2026. BuilderBase slug `token2049-origins-hackathon`, event id `189f01dd-487a-4c37-8e54-82800c109052` | F01 |
| Venue, mode | Marina Bay Sands, 10 Bayfront Ave, Singapore. **Onsite only, physical presence for the full 36 h**. No showers; rest areas first-come | F02 |
| Event time zone | Asia/Singapore (UTC+8). User's home zone Paris CEST (UTC+2, 6 h behind). The laptop auto-switches zone | F01, F26 |
| Kickoff | Tue 6 Oct 12:00 SGT = 04:00 UTC = 06:00 Paris | F01 |
| Submission deadline | Wed 7 Oct 23:59 SGT = 15:59 UTC = 17:59 Paris. No late entries. **Deck locked at submission** | F01, F05 |
| Event end / demo day | Thu 8 Oct: top-5 live pitch 16:00 SGT, prizes 16:40 (reported). API `end_at` 17:30 SGT | F08 |
| Solo or team | Solo as of 21 Sept. Teams 1-4. The organisers help match solos. Recruit decision by H+2 (Tue 14:00 SGT). An on-site dev B would **not** have the /execution setup | F11 |
| Judging mode | Structured rubric, slider scoring. Screening before the top 5 is unpublished (two-stage inferred). The top 5 give a **live pitch**, and their demo is a **recorded** video inside the deck | F06, F08 |
| Main rubric | Functionality & Execution 30 / Technical Implementation & Integration 25 / Innovation & Originality 20 / Usefulness & Potential Impact 15 / Demo & Presentation 10 | F06 |
| Cardano rubric (primary's track) | Technical Execution & Use of Cardano Tech 30 / Innovation & Creativity 20 / **UX & Design 20** / **Impact & Feasibility 20** / Pitch 10. Qualify: "a DApp with a frontend, or a tool/agent with a live demo" | F07 |
| Chainlink rubric (fallback's track) | The main rubric, with Chainlink-specific criteria to be announced. CLI simulation suffices | F15 |
| Deliverables | Repo (public or judge access). Project link (live URL/hosted demo: GitHub Pages planned). Slides as a Google Drive link to .ppt/.keynote with the video embedded (no YouTube). Cardano: video of at most 3 min, write-up (problem, approach incl. Cardano infra, deploy/scale), open-source repo with docs. Submit main, then add the track (BuilderBase form, manual) | F05 |
| Prizes | Main: top 5 share $100k in AWS credits. Cardano $15k / $7.5k / $5k + Cometa Labs intro. Solana $5k / $3k / $2k. Chainlink 5 x $2k. NOWNodes EUR 3.3k / 2.2k / 1k in credits | `rubric.md:10-68`, F07 |
| Field (30 Sept) | Main 285 registrations / 98 teams. Cardano 231/55. Chainlink 188/44. Solana 228/49. NOWNodes 150/42 | F15 |
| Prior-work rule | "no code, designs, or prototypes before kickoff". Built entirely within the 36 h. Public libraries/tooling OK. Research crosses the line, code and designs do not. Repo created after 12:00 SGT, first commit in the window, no date rewriting. Probes quarantined (zip + SHA-256) | F03, F04 |
| AI assistants | Not addressed by the rules. The sponsor publishes agent skills (Cardano, Masumi) | F17 |
| Direction (21 Sept) | Primary: Cardano dispute-settlement rail (`cardano-disputes` A, "Accord", **rename required**). Fallback: Chainlink CRE "Unit Guard". Switch rule evaluated on the morning of 5 Oct. No cluster switch after kickoff | F09 |
| Spec status | **No validated spec/PRD.** Nearest: `_recommendation.md` section 2.1 (21 Sept) plus `DECISION-fr.md`. User sign-off pending. Not re-validated against the Cardano rubric of 24 Sept | F07, F09 |
| Minimum shippable core | 12 parts, about 25 h solo (x402 cut) against 27.5 h usable. The Functionality-30 % minimum is about 12-14 h. The cut list is ordered, and the solver is never cut to zero | `_recommendation.md:193-233` |
| Fixed gates (SGT) | H+2 Tue 14:00 collaborator + x402 route (b)/none. H+4 Tue 16:00 pre-lock 6-8 preprod escrows. H+5 Tue 17:00 path-B verdict (else path A). H+6 Tue 18:00 fallback broadcast rule (fallback only). H+18-20 Wed 06:00-08:00 complete ugly take. Build complete about H+28 Wed 16:00. T-6h Wed 17:59 demo audit. Deadline Wed 23:59 | F10, F33 |
| Recon cadence (/hackathon) | The 24-hour row: "once at the halfway point, once about two hours before you submit". A 36 h event sits between the 24-hour and weekend rows. Reading is manual except Telegram | `01-find-the-gap.md:294-300`, F16 |
| Sleep | 5 h budgeted. Agents continue, and manual tasks must not fall inside it | `_recommendation.md:195` |
| Primary stack | TypeScript. Cardano preprod (writes). Mainnet read via keyless Koios + second provider. `@evolution-sdk/evolution`, Mesh (CIP-8). `@x402/cardano` 2.28.0 (route b or none). Aiken 1.1.23 for reading. GitHub Pages | F12, F15 |
| Fallback stack | CRE CLI 1.34.0 (simulation), bun 1.4.2, Foundry 1.8.3 (Git Bash only), Base Sepolia (no funded key) | F12, F14, F24 |
| Side-effect policy | Commits/pushes: standing OK. **Testnet (preprod) txs: standing OK, only on escrows we lock. Mainnet: read-only, stricter than decision 3.** Never call live Masumi endpoints. Never call/probe the CF Java facilitator. Five undisclosed matters: never in repo/deck/voice. Do-not-carry phrase list | F13 |
| Needs user approval (inferred) | Repo visibility flip (public/judge access). Enabling GitHub Pages. Upload of the deck to Google Drive. The BuilderBase submission form. Any scope cut (decision 2) | F05, F13 |
| Wallets and keys | Preprod buyer 9,707.899 tADA (21 Sept). Preprod seller **unfunded** (404, 21 Sept). Blockfrost preprod + NOWNodes keys in `research/.env` (not to be copied into the repo by agents). No funded EVM key | F14, F32 |
| Channels | BuilderBase app (announcements/broadcasts/help-requests, login, manual). TOKEN2049 Telegram `t.me/token2049official`. Cardano developer Discord `discord.gg/MmeqpAzKbp` (manual copy-paste). The CF x402 support channel will be published on developers.cardano.org/x402. CF mentors on site. NOWNodes support chat | F16 |
| Deliverable chain | build complete -> /harden (time-capped) -> fix -> final recording (manual, user voice) -> /prose (README, write-up, deck) -> README screenshots last -> deck to Drive -> BuilderBase form -> clean-clone and link check, all before 23:59 SGT | F33, user decision 5 |

---

## What must exist before the hack starts

Owner: A = Alexandre, C = Claude/agent. "Latest" is the last safe moment. Status is as of 30 Sept 21:45 Paris.

| # | Item | Owner | Proof of done | Latest | Status |
|---|---|---|---|---|---|
| 1 | Acceptance confirmed and BuilderBase team/solo registration done | A | acceptance mail pasted into the workspace + team page screenshot | before flight (Sun 4 Oct 12:00 Paris) | no local record |
| 2 | Track decision (primary vs fallback) and project rename | A | a dated decision line in the spec | Sat 3 Oct | pending since 21 Sept |
| 3 | Spec/PRD validated against **both** rubrics (main 30/25/20/15/10, Cardano 30/20/20/20/10), including the UI scope. Knowledge-level only: no file layout, CLI shape, schema or diagram | A approves, C drafts | spec file + rubric mapping + A's approval line | Sat 3 Oct | missing |
| 4 | This event profile stored where /execution reads it | C | file exists and validates | Fri 2 Oct | draft here |
| 5 | Organiser questions sent. Q5 is now answered by the Chainlink page. Q2 is partly answered by the CF page | A | sent-message screenshot | ASAP (was due 28 Sept) | not recorded |
| 6 | CF private disclosure (K9) sent | A | sent mail | before the event | owed |
| 7 | Manual prior-art check: ETHGlobal showcase, Catalyst, Devfolio, DoraHacks | A (browser) | notes file | Mon 5 Oct | open since 21 Sept |
| 8 | Preprod seller funded, buyer re-checked | A (faucet), C re-reads | balance read > 0 for both addresses | Mon 5 Oct | seller 404 on 21 Sept |
| 9 | Base Sepolia key funded (fallback only) | A | balance read | Mon 5 Oct | none |
| 10 | Hack env file outside any repo, loaded by path (`node --env-file=<path>`) | A | agent checks existence only | Sat 3 Oct | not started |
| 11 | Freshness re-runs (census, x402 manifest, incumbent routes, new disputes, RF-1 concessions) | C (measurement is allowed) | dated diff files in `research/findings/` | 5 Oct and 6 Oct morning SGT | scheduled in plan only |
| 12 | Switch-rule evaluation | A decides from C's diff | decision line | 5 Oct morning SGT | pending |
| 13 | Probe quarantine: zip + SHA-256 of `research/probes/`, and a read fence active during the hack | C with A's OK | hash in findings + a fence test that denies a read | before 6 Oct 12:00 SGT | not started |
| 14 | /execution built and rehearsed end to end on a fixture (never on Origins content): Notion report, manual pause/resume, Remote Control relaunch | C + A | rehearsal report + green completion check | before flight | in design |
| 15 | Notion plan database + wave-report page (template only) and an MCP write test | A connects, C tests | test page visible on the phone | before flight | not started |
| 16 | Remote Control tested against a running session | A | relaunch done from the phone | before flight | not started |
| 17 | Disk freed to at least ~25 GB (threshold inferred) | A approves each deletion, C executes | free space read >= 25 GB | before flight | 4.8 GB |
| 18 | Venue RAM plan: stop DB services, Discord, Notion desktop, Teams, Epic and other Claude sessions | A | pre-flight shows >= 2.5 GB free with the stack running | at kickoff | not started |
| 19 | Power and network plan: charger + socket, stay on AC (DC sleep at 600 s), venue Wi-Fi + hotspot fallback | A | pre-flight gate | at kickoff | not started |
| 20 | Recording setup: OBS **window** capture (avoids the activation watermark) or Windows activated. PowerPoint .ppt with embedded video. Drive upload path tested | A | test clip + test Drive link | before flight | tools present |
| 21 | Fallback-only toolchain: forge on the PowerShell PATH, `~/.svm` populated, CRE update-or-pin | C/A | version commands | before flight | open |
| 22 | Kickoff runbook T+0 -> T+0:30: `gh repo create` after 12:00 SGT, README provenance paragraph, `.gitattributes` (eol=lf), `main` branch, kickoff freshness commit, plan detailing, approval, wave 1 launch (path-B spike first) | C drafts (knowledge-level), A approves | runbook file | before flight | not started |
| 23 | Banned-claims list for agents: wave-2 section 5 + recommendation section 3 + the five undisclosed matters (routing only) | C | file + a pre-commit grep check that fails on a planted phrase | before flight | sources exist |

---

## Machine limits for parallel agents and worktrees

| Resource | Measured today | Effect | Suggested limit (inferred unless noted) |
|---|---|---|---|
| CPU | i7-11800H, 8 cores / 16 threads | not binding | at most ~6 CPU-heavy tool processes at once; cap test-runner workers at about 2 per agent |
| RAM | 15.69 GB total; 1.42-2.26 GB free with background apps; commit free 1.20-4.66 GB | **binding** | Gate: >= 2.5 GB free (house rule). With apps and services closed, expect about 8-10 GB usable, so 3 concurrent heavy build agents (4 max) + the orchestrator. Agents that only read and write text are cheap (in-process) |
| Disk | C: 4.17 -> 1.89 -> 4.83 GB free in 28 min | **binding** | Before the hack >= ~25 GB. Stop launching new installs or worktrees below 5 GB. One install at a time (Hedera lesson) |
| Worktrees | npm install of the starter = 701 MB / 128,046 files; pnpm store on C: | npm worktrees unaffordable now | Only with pnpm (hardlinks) and >= 25 GB free, at most ~3. Otherwise one working tree with file-disjoint agents |
| Agent processes | subagents are in-process; interactive sessions cost 0.6-1.0 GB each | the tools are the cost | Count tool processes, not agents. Close other Claude sessions (5 were open today) |
| Quota | 5h and 7d windows (Pro/Max), tier unknown | **binding over 36 h** | Pace on `rate_limits.five_hour.used_percentage` via a status-line side channel. Cheaper models for verifiers |
| Power | AC: never sleeps; DC: sleeps after 600 s; lid action unknown | an unattended run stops | Gate: on AC, and the laptop is set not to sleep when the lid closes (A's choice) |
| Network | iPhone USB tether now; Koios 429s measured in research | failed API calls, false data | Retry with backoff and a hole counter; hotspot fallback |
| Orphans | 74 orphan `grep.exe` | leak | Sweep between waves (match command line, keep the port owner) |
| Docker/WSL | installed, stopped; WSL VM cap 6 GB | would take RAM | Keep off for Origins |

---

## Ledger OP3N: facts for two-developer mode

| Field | Value | Source |
|---|---|---|
| Teammate (dev B) | Eli, DVB, "not met yet" (22 Sept). Skills, hours and tooling unconfirmed. May use another LLM | F30 |
| Build window | Tue 6 Oct 18:00 Paris (= Wed 7 Oct 00:00 SGT) -> Tue 13 Oct 23:59 Paris (21:59 UTC). Internal freeze 21:00 Paris | F30 |
| Dev A availability | Busy with Origins 6 Oct 06:00 -> end of 8 Oct Paris. In Singapore until the morning of 12 Oct. Dev B carries 6-11 Oct | F30 |
| Mentors | Discord, weekdays only (none Sat 10 / Sun 11) | F30 |
| Finals | Fri 16 Oct 15:00 Paris HQ, 5 min pitch + 5 min Q&A, live demo preferred, at most 2 on stage, Speculos accepted | F30 |
| Prior-work promise | No product code before 6 Oct 18:00 Paris (said to the organiser on 23 Sept) | F30 |
| Submission | Form + X/LinkedIn post from the club account with #LedgerN3XTCollab + GitHub + short video. Rubric/T&C/form unpublished as of 23 Sept | F30 |
| Infrastructure | Speculos runs under Docker (vhdx 9.57 GB on this machine) | `project_ledger_op3n.md:49-65`, F19 |

---

## Implications for /execution

1. **Plan at T+0, not before.** For an event with a no-designs rule, the engine needs a two-step plan. Before the event it holds a knowledge-level skeleton: parts, hours, proofs, gates, owners, and no file layout, CLI shape, schema or diagram (F03, F04). At T+0 it adds the design-level detail and gets the single approval by about T+0:30 SGT. So the planner must run in minutes, and the rehearsal must use a fixture, never Origins content.
2. **Event profile as data.** A machine-readable profile (UTC instants with zones, gates, deliverables, rubric weights per track, side-effect policy, channels, manual-task list) that the engine reads. The table above is a draft of it.
3. **The per-project policy overrides standing authorisations.** Origins needs "mainnet read-only" even though decision 3 allows mainnet later. It also needs endpoint deny-lists (Masumi live endpoints, the CF Java facilitator) and a banned-claims check that runs on README, deck and write-up text before each commit (F13).
4. **Fences during the build.** A skill-scoped hook in the /harden style should deny agent reads of `research/probes/**`. Findings prose stays readable. The hook should also deny writes outside the new repo. This is needed because of the K16 breach and the quarantine protocol (F04).
5. **Repo bootstrap is a T+0 task with provenance.** `gh repo create` after 12:00 SGT. A README paragraph that says research crossed the line and code did not. A kickoff freshness diff. `.gitattributes` eol=lf and a `main` branch (F28). Never backdate commits, never force-push. The visibility flip and GitHub Pages need explicit user approval (inferred).
6. **Decision gates are first-class tasks.** H+2 (collaborator, x402), H+4 (escrow bank), H+5 (path-B verdict), H+18-20 (ugly take), T-6h (audit), recon passes, and a computed "build complete by about H+28" (F10, F33). Each gate that needs the user is a WAIT task (decision 2), and unaffected waves keep running.
7. **UI scope has to be decided before kickoff.** With 20 % UX & Design on the Cardano track and "a DApp with a frontend, or a tool/agent with a live demo" as the bar, the "simple UI" of decision 6 needs a named minimum: the hosted GitHub Pages page of the recommendation, planned early rather than cut third. The engine must propose this and wait (decision 2), not decide it (F07).
8. **Resource governor with pre-flight gates.** Before every wave check AC power, network, free disk (with a margin for about 3 GB swings), free RAM >= 2.5 GB and quota headroom. After every wave, sweep orphans and scratch. Install one thing at a time. Cap test-runner workers. Allow worktrees only with pnpm and enough disk (F19-F23, F26, F29).
9. **Time zones are explicit.** Store UTC and display SGT in Notion reports, because the laptop's zone will change mid-trip (F26). Put both zones in the report when dev B is in Paris.
10. **Manual tasks are scheduled around the user's location.** At the venue the user can act from the phone (Remote Control) but reads Discord and BuilderBase by hand. Telegram is MCP-readable only if the connector covers public channels (open). Recording, voiceover, Drive upload and the BuilderBase form are manual. None may fall inside the 5 h sleep window (F16, F33).
11. **Two-developer mode must allow very unequal availability.** Dev A can be away for days. Dev B may be a human without /execution (Origins on-site recruit) or a teammate with an unconfirmed setup (Eli). Notion task claims act as locks, each dev works on their own branch, and one machine runs one project at a time (F11, F30).
12. **The deliverable chain is a sub-plan with a hard end.** harden (capped) -> fix -> final recording -> /prose -> screenshots last -> Drive -> form -> clean-clone link check, all before 23:59 SGT because the deck is locked at submission (F05, F33). /execution's "build complete" hand-over has to happen early enough for the rest to fit.

---

## Risks and failure modes

1. **Disk exhaustion mid-hack.** 4.8 GB free now, with about 3 GB transient swings observed during a read-only workflow (F19). A build adds installs (0.7 GB each), build outputs and recordings. When the disk is full, writes fail, git and transcripts can corrupt, and the orchestrator dies. Mitigation: free space before the flight (user approval), set gates and thresholds, install one thing at a time.
2. **RAM exhaustion kills the demo or the recorder.** Measured 0.79-2.26 GB free across two dates (F21). The house rule says the demo backend died three times under 1 GB. Mitigation: stop background apps and services, record the final take on a quiet machine, cap test runners.
3. **The quota runs out in a 5 h window** in the middle of the build (F29). Mitigation: quota-aware pacing, cheaper models for verification, no other sessions running.
4. **The laptop stops.** It sleeps after 600 s on battery, the lid may be closed, the phone tether leaves with the user, or venue Wi-Fi saturates with about 285 builders (F26). The autonomous run halts silently. Mitigation: a pre-flight gate plus a heartbeat in the Notion report, so a missing report is visible from the phone.
5. **A prior-work breach by an agent.** Reading or copying `research/probes` code, a pre-created repo, a pre-written design in the Notion plan, or a README that implies prior build (F03, F04). The project could be disqualified. Mitigation: fences, T+0 planning, provenance statement.
6. **A spec not re-validated against the 24 Sept Cardano rubric.** UI underweighted, Impact 20 % against the primary's "about $500" money line (F07, F09). Mitigation: a re-validation task before kickoff, with the user's decision.
7. **Stale inputs.** The facilitator page is live, x402 is at 2.28.0, and the field tripled (F15). Mitigation: scheduled freshness tasks on 5 and 6 Oct, and again at H+0.
8. **A leak of undisclosed matters or do-not-carry phrases** into public artefacts written by agents (F13). Mitigation: a banned-claims check before commits and before the flip to public.
9. **An agent writes to mainnet** under the general authorisation (F13). Mitigation: a per-project deny policy enforced by a hook, not just by prompt.
10. **Time zone confusion.** The auto-switched clock, Paris vs SGT reports, and Ledger starting at 00:00 SGT 7 Oct in the middle of the Origins night (F26, F30).
11. **A watermark in the recording or the README screenshots** because Windows is not activated (F27). Mitigation: window capture, or headless browser screenshots.
12. **Pre-flight time squeeze.** 87 h to the flight, shared with the Hedera submission and the BNB freeze (F31), so the /execution rehearsal could be skipped. The first real run would then be the hack itself.
13. **Orphan processes and stale dev servers** accumulate over 36 h (F23). Mitigation: a sweep between waves.
14. **Notion MCP or the network is down.** The per-wave reports fail. Mitigation: write the report locally first, then sync, and show the failure in the next successful report.

---

## Open questions

1. Was Origins acceptance received on 28 Sept, and what did the mail give (channels, check-in time, schedule, team formation, submission form)? It is in no local file.
2. Has the user signed off primary vs fallback, and chosen the new name? (Pending on 21 Sept.)
3. Were the organiser questions and the CF disclosure sent, and were any answered?
4. Origins team: still solo? If someone joins on site, what does dev B mean for the engine?
5. Given the Cardano rubric (UX & Design 20 %), what is the minimum UI the user wants /execution to build before /frontend exists: the GitHub Pages census and reachability page, or more?
6. Where is the line between a plan and a design for the organisers? Should the question go to them, or should the pre-event plan stay knowledge-level by policy?
7. Is personal, project-agnostic tooling (/execution, /hackathon) "publicly available developer tooling"? Should its use be disclosed in the README?
8. What is the Claude plan tier, and what 7-day headroom will be left on 6-7 Oct after the Hedera push and the rehearsal?
9. Can the Telegram MCP read public channels such as `t.me/token2049official`? (The connector exposed here is named "DR Profit VIP", scope unknown.)
10. Which space may be freed before the flight: the 10.66 GB `/harden` dev scratch, caches, compacting the Ubuntu and Docker vhdx? (Each needs the user's OK.)
11. Venue logistics: sockets at the tables, lid-close setting, whether the laptop can stay running while the user sleeps.
12. Will the CF hosted facilitator URL be published at kickoff? It decides the x402 route (b)/none choice at H+2.
13. Ledger: Eli's tooling (Claude Code? Notion?), hours on 6-13 Oct, and whether the "identical setup" of decision 4 is realistic for him.

---

## Sources

Local files (read-only):
- `C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/rubric.md`
- `.../research/findings/wave3/_recommendation.md` (lines cited above), `.../wave3/DECISION-fr.md`
- `.../research/findings/known-behaviour.md` (K16, K31, K33, K34), `.../research/findings/access.md`
- `.../research/findings/cand-facilitator-conformance-layers.md:130-160`
- `.../research/findings/prior-2026-09-10/recon_rules-and-form.md`, `.../bounty_cardano.md:155`, `.../bounty_nownodes.md:256`
- `.../research/findings/wave1/_summary.md:35-43`, `.../wave2/_summary.md:607`
- `.../research/findings/wave3/solana-approvals-3-feasibility.md:51-62`, `.../wave3/tron-poisoning-4-judge-build.md:148-162`
- `.../research/outbox/01-organiser-questions.md`, `.../02-cardano-foundation-disclosure.md` (header only)
- `.../research/README.md`, `C:/Users/Utilisateur/Documents/Documents Perso/token2049/.gitignore`, `.../cardano_pitc.txt`
- `.../research/probes/builderbase/tracks/_events-public-*.json` (17 Sept snapshots)
- `C:/Users/Utilisateur/Documents/Documents Perso/CV Stage 2027/internship/networking/singapore.md`
- `C:/Users/Utilisateur/Documents/Coding/Ledger Op3n/research/inbox/2026-09-22-op3n-hackathon-brief.md`, `.../research/findings/rubric.md` (sections 1, 4, 10), `.../research/RAPPORT-ELI.md`
- Memory: `C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur/memory/` `project_token2049_origins.md`, `project_ledger_op3n.md`, `project_execution_skill.md`, `project_harden_skill.md`, `project_hedera_scaffold_bounty.md`, `project_xrpl_core_dev_bootcamp.md`, `project_xrpl_vault_oracle.md`, `feedback_windows_file_writing.md`, `MEMORY.md`. Also `.../C--Users-Utilisateur-Documents-Documents-Perso-CV-Stage-2027/memory/project_internship_action_plan.md` and `.../C--Users-Utilisateur-Documents-Coding-BNB/memory/project_bnb_holdover.md:43`
- `C:/Users/Utilisateur/.claude/skills/hackathon/SKILL.md`, `references/01-find-the-gap.md:280-311`, `references/06-operations.md`
- `C:/Users/Utilisateur/.claude/statusline.py`, `C:/Users/Utilisateur/.claude/CLAUDE.md` (rule 5)

Web (read-only, fetched 2026-09-30 about 19:30-19:45 UTC):
- `https://edge.builderbase.com/events/public/token2049-origins-hackathon` and the four track slugs (`cardano-agentic-commerce`, `chainlink-best-workflow-with-cre`, `solana-best-use-of-solana`, `nownodes-multichain-infrastructure-challenge`)
- `https://token2049.com/singapore/2049-origins`
- `https://developers.cardano.org/x402/`; `x402.cardano.org` (NXDOMAIN); `gh api repos/cardano-foundation/x402-cardano-demo`
- `npm view @x402/cardano@2.28.0`, `npm view @x402/core@2.28.0`
- `https://code.claude.com/docs/en/statusline.md` (lines 186-195, 339)

Commands run on the machine (read-only; Docker and WSL were not started): `Get-CimInstance` (Win32_ComputerSystem, Win32_OperatingSystem, Win32_Processor, Win32_LogicalDisk, Win32_Process, Win32_PageFileUsage, Win32_Service, SoftwareLicensingProduct, Win32_Battery), `Get-Process`, perf counters, `wsl.exe --list --verbose`, `wsl --status`, `powercfg /q`, `tzutil /g`, `Get-NetRoute`, `Get-NetAdapter`, robocopy `/L` size listings, tool `--version` calls, `gh auth status` (filtered), `git config --show-origin`, `Get-MpPreference` (counts only). No `.env`, key or credential file was opened.
