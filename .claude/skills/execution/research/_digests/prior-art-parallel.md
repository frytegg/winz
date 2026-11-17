# prior-art-parallel

## Summary
1. Do not build /execution on agent teams. In the 2.1.285 docs they are "experimental and disabled by default", interactive-only, and limited to one team per session with a local task list. They give no worktree isolation, and the docs admit task-status lag and a lead that stops early. The Task tools are off by default on Opus 5.x.
2. Use dynamic workflows instead: one workflow per wave, pipeline() inside it, and agent() with isolation:'worktree', agentType, model, effort and schema. Keep the plan-of-record in the repo, mirrored to Notion.
3. Parallelism: wave 0 is a contract wave that freezes and merges interfaces, shared config and hub files. After it, lanes are file-ownership partitions, each run in one Claude-created worktree per wave with worktree.baseRef "head".
4. Default 3 writing lanes plus at most 2 read-only verifiers. The runtime would allow min(16, CPUs-2) = 14, but RAM and disk bind first: 15.7 GB RAM, an auto-managed pagefile on C:, and free disk swinging 2.0-5.9 GB during this run.
5. A resource guard runs before each wave: free disk and commit memory, measured with PowerShell, not Git Bash du. Heavy builds are serialized.
6. Worktree cost: pnpm installs are hard links from a store on C: (cheap). The Yarn-based Hedera scaffold measured about 1.44 GB of node_modules plus 1.47 GB of .next per built copy (about 2.9 GB).
7. Never junction node_modules into a writing lane. A raw `git worktree remove` deleted a junction target in the owner's own measurement; Claude Code's own removal has been link-safe since 2.1.205. Remove merged worktrees immediately, because the automatic sweep waits 30 days.
8. Merge: GitHub's merge queue is unavailable for personal private repos, so /execution needs a local queue that applies the not-rocket-science rule. Rebase the lane on the integration tip, gate plus proof on that exact tree, then fast-forward origin/main by push (a non-fast-forward rejection is the CAS). In the classic study 33% of "clean" merges broke the build or tests; concurrent interface changes broke 97% of constructed agent pairs.
9. Two developers: static ownership fixed at plan approval, and Notion rows partitioned by owner (Notion is last-write-wins with no CAS; about 180 requests per minute). Cross-developer dependencies are satisfied by proof receipts on origin/main, not by Notion checkboxes. Git push serializes the two merge queues.
10. Verification, before the code: a different agent defines the proof and writes the acceptance checks before implementation. Implementers get read-only tests through PreToolUse hooks keyed on agent_type, and hidden checks are access-controlled (agents opened decoy grading files in 80% of sealed runs).
11. Verification, after the code: a fresh-context verifier re-runs the proof on the landed SHA. Money, keys, mainnet and absence claims go cross-model or to the owner. New tests must be seen to fail, and retries are capped at 2, then BLOCKED and proposed to the user.
12. "Build complete" requires a final proof replay on a fresh clone and the plan-level completion check, kept out of CI.

## Recommendations
1. Use dynamic workflows, one per wave, with pipeline() inside so lanes run implement, gate, merge and verify without barriers. Put manual tasks and user decisions between waves. Keep CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS unset or 0, and do not use the native Task tools as the plan-of-record (F01-F07).
2. Run wave 0 (the contract wave) alone. It freezes and merges public types, schemas and ABIs, the env schema, package.json, lockfile and workspace files (one shared resource), hub files (entry points, routers, barrels, shared utils), every task's proof command and acceptance checks, and an ownership map from glob to lane. Each contract item has one owner. Any later contract change is a plan amendment: propose, wait, then broadcast a change note to affected lanes (F26-F31).
3. Give worktrees to lanes, not to tasks. Launch at most one writing agent per lane per wave: agent(..., {isolation:'worktree', agentType:'execution-implementer'}), with worktree.baseRef "head", after local main has been fast-forwarded to origin/main. Implementers return {branch, head_sha, worktree_path, proof_run} through a schema (F08).
4. Run two tasks concurrently only if their write-sets are disjoint and they share no unary resource: wallet nonce or UTXO, port, database, signing device, human (F33).
5. On this laptop, default to 3 writing lanes, at most 2 read-only verifiers and 1 serial integrator; set CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS to about 6. Before each wave, install or heavy build, run a resource guard in PowerShell (Get-PSDrive and Win32_OperatingSystem, not Git Bash du): k = min(3, floor((freeGB - 2)/lane_footprint)); drop to 1 lane below about 4 GB commit-free; refuse new agents below 1.5 GB free disk. These thresholds are design choices to recalibrate in rehearsal (F22, F37, F51).
6. Footprints measured today: a pnpm lane is about 0.1 GB (hard links); a Yarn or npm lane about 1.4 GB of dependencies; next build adds about 1.5 GB. Standardize hackathon projects on pnpm. Run heavy builds only in the integrator, one at a time, and clean their caches after (F21, F22).
7. Install lane dependencies with `cd "<abs>" && pnpm install --frozen-lockfile --offline` as a single Bash call. Never junction or symlink node_modules into a writing lane, and keep pnpm enableGlobalVirtualStore off (F09, F21, F53).
8. Build a local merge queue, FIFO, per the not-rocket-science rule: (1) in the lane worktree, fetch and `rebase origin/main`; (2) on conflict, abort, send the conflict plus an upstream change summary back to the lane, max 2 attempts, then BLOCKED, and never auto-resolve inside files the lane does not own; (3) gate the rebased tree (offline install, typecheck, lint, tests, task proof, integrity scans); (4) `push origin HEAD:main`, and on rejection loop to (1); (5) fast-forward the local integration checkout; (6) commit proofs/<task>.json the same way; (7) remove the worktree with a link-safe method and delete the branch (F32-F35, F39).
9. Remove worktrees only through Claude Code, or a script that deletes links before `git worktree remove --force`. Never wait for the 30-day sweep. Stop lane servers and watchers first, and set core.longpaths=true in each project (F08, F09, F23, F24).
10. When disk binds, send lanes that need no local wallet, secret or Windows tool to `claude --cloud`. Their pushed branches enter the same queue (F12).
11. Two developers, rule 1: ownership is static at plan approval. Every task and path glob has one owner, and each /execution launches only its own tasks. The plan carries a content-hash version, and an instance refuses to run on a stale version (F38, F41).
12. Two developers, rule 2: Notion rows are write-partitioned by owner. Agents never write owner or dependency fields, and they write only at wave boundaries, within about 180 requests per minute plus the MCP tool limit (F38).
13. Two developers, rule 3: a cross-developer dependency is satisfied only by proofs/<task>.json plus a reproduced verifier verdict on origin/main; the Notion checkbox is a mirror. Both queues integrate into origin/main and are serialized by push CAS (F13, F39).
14. Two developers, rule 4: one named developer owns the contract; the other requests changes by plan amendment. Reassignment is a human plan amendment picked up at the next wave boundary. If dynamic pools are ever wanted, claims go into git (claims/<task>.json pushed with CAS) with a fencing check at merge time (F19, F40).
15. Verification, before code: a test-designer agent, not the implementer, writes each task's proof and acceptance checks at planning time. Proof kinds are a command exiting 0, a tx hash re-read on chain, a green CI run for a SHA, or a named file (F45, F50).
16. Verification, protecting the oracle: PreToolUse hooks keyed on agent_type block implementers from editing tests, proofs, test config, CI and hooks. Holdout checks live outside lane worktrees and are denied by permission rules and hooks, not by silence (F14, F43, F44).
17. Verification, integrity scans in the gate: tests unchanged unless it is a test task; no new skip or only markers; assertion count not reduced; test config unchanged; production diff scanned for test literals, test-environment detection and exit(0). A new test counts only after it is seen to fail against a planted defect or scoped mutant (F43, F47).
18. Verification, independent verifier: a fresh-context agent (agentType execution-verifier) that is read-only except for its verdict file. It receives only the spec, proof definition, diff and raw tool output, never the author's transcript or claims. It re-runs the proof on the landed SHA in a clean checkout, re-reads tx hashes through an independent explorer, and writes {task, sha, command, exit_code, output_sha256, verdict} (F42).
19. Verification, Tier 2: money, keys, signing, mainnet, security-sensitive code and absence claims need a cross-model reviewer or the owner. A mainnet proof also needs the owner's go, per decision 3 (F42).
20. Retry cap: 2 fix attempts from the last green state with fresh context, then BLOCKED with the failing output and a proposed option, and wait for the user (F48).
21. Tick rule: only the orchestrator ticks, and only when the change and proofs/<task>.json are on origin/main and a reproduced verdict names that SHA; then mirror the tick to Notion. Build complete = a plan-level completion check (generalized completion-check.mjs, out of CI) plus a final replay of every proof on a fresh clone of main, then hand over to /harden (F32, F50).
22. Give each agent its own namespaced scratch path (<scratch>/<run>/<task-id>/), and let no agent clean shared directories (F52).
23. Rehearse before 4 Oct: an isolation canary (a worktree agent must be refused writing the main checkout); a junction-removal canary; confirm workflow agent() worktrees honour baseRef head and report their branch; measure the Origins stack's per-lane footprint; observe usage-limit behaviour from a Remote Control-launched wave; pin the Claude Code version (F07, F10).

## Risks
1. Disk exhausted mid-wave. Worktrees, about 1.5 GB .next caches, non-hard-linked installs (about 1.4 GB), transcripts and pagefile growth all share C:. Free space moved about 3 GB within minutes today, and agents fail with misleading errors (F22, F51).
2. Junction-following deletion. A raw `git worktree remove` on a tree with a junctioned node_modules deleted the target in the owner's measurement; with pnpm's global virtual store it could reach the shared store (inferred) (F09, F21).
3. Stale lane base. Without worktree.baseRef head and a fast-forwarded local main, lanes build on origin/<default> and every merge conflicts (F08).
4. Isolation silently dropped. With agent teams enabled, named subagents become teammates in the main working directory; isolation leak bugs were fixed as late as 2.1.274 (F03, F10).
5. Clean merge, broken build. About a third of textually clean merges broke build or tests in the classic data, and 97% of constructed concurrent interface changes interfered (F28, F32).
6. Serial integrator bottleneck. Putting LLM verification inside the queue collapses throughput; keep the queue deterministic and verify after landing (inferred).
7. Notion lost updates and throttling. Last-write-wins with no CAS, about 180 requests per minute plus MCP limits; two instances or a human and an agent can overwrite each other silently (F38).
8. The oracle is gamed: tests weakened or special-cased, or hidden grading files read (80% of sealed runs) (F43, F44).
9. Rubber-stamp verification. A same-family verifier approves its sibling's work, worst on money, concurrency and absence claims (F42, F46).
10. Usage limits. Quota scales with concurrent agents. Waves launched from Remote Control or background sessions do not pause at the limit: agents fail and the relaunch replays from the first failure (F04, F07).
11. API stalls and memory reclaim at high concurrency: the owner saw a 29.5-min stall and a reclaimed shell at up to 18 subagents (F37).
12. Windows file locks. Dev servers, watchers and scanners make checkout, rebase or remove fail; long paths fail while core.longpaths is unset (F23, F24).
13. Scratchpad collisions between agents of one session: files vanished during this run (F52).
14. Unary resources shared by 'independent' lanes: one testnet wallet (nonce or UTXO), one port, one DB, one human.
15. Third-party orchestrator lock-in: vibe-kanban's company shut down and a release made projects export-only (F15).

## Open questions
1. Q1. On Windows without Developer Mode, does worktree.symlinkDirectories create a symlink or a junction, and does anything follow it on removal? The docs are silent; test in rehearsal.
2. Q2. Does a raw `git worktree remove` follow pnpm's nested junctions (node_modules/<pkg> -> .pnpm/...)? Harden measured only a top-level junction.
3. Q3. Do Workflow agent({isolation:'worktree'}) worktrees honour worktree.baseRef "head" and sparsePaths as Agent-tool subagents do, and how does the agent report its branch and SHA?
4. Q4. What is the real per-lane footprint for the Origins stack (Cardano/x402 toolchain, front end)? Measure install size, build cache and install time.
5. Q5. With agent teams enabled, can a Workflow agent() call launch as a teammate? The docs describe the conversion only for the Agent tool with a name.
6. Q6. Is a cross-model reviewer (Codex CLI or Gemini CLI) installed and authenticated for Tier-2 checks, or does Tier 2 fall back to the owner?
7. Q7. Can `claude --cloud` reach the testnet RPCs the lanes need under the default Trusted allowlist, and may any secret go into a cloud environment? That is the owner's decision.
8. Q8. Will dev B also be on Windows? Line endings, path case and core.longpaths must match, or the gate will see phantom diffs.
9. Q9. Can permission rules deny Bash reads of the holdout directory, or only Read-tool reads? Is the sandboxed Bash tool the stronger control? Not researched here.

## Findings
- F01 [verified-source, LB] Agent teams are still experimental and disabled by default in Claude Code 2.1.285 (changelog dated 29 Sept 2026).
  -> The Origins build (6-7 Oct) must not depend on agent teams; use dynamic workflows.
- F02 [verified-source, LB] Agent teams keep a lead, teammates, a file-locked shared task list and mailboxes, all local to one session. Limits: one team per session, no sharing across sessions, no nested teams, no resumption of in-process teammates, task status can lag, the lead can stop early, and split panes do not work in Windows Terminal.
  -> /execution needs its own proof-gated ledger; the native task list can be neither the shared plan nor the tick authority.
- F03 [verified-source, LB] Teammates spawn only in interactive sessions and share the lead's working directory. With teams enabled, a named subagent launches as a teammate and its frontmatter isolation is ignored.
  -> Keep CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS unset or 0 in /execution sessions, or worktree isolation can silently disappear.
- F04 [verified-source] Token and quota use grows roughly linearly with parallel agents; agent teams cost about 7x in plan mode, and multi-agent systems about 15x chat.
  -> Keep concurrency modest and budget quota per wave.
- F05 [verified-source, LB] Since v2.1.268 the Task tools are off by default on models other than Claude 3.x, Opus 4-4.7, Sonnet 4-4.6 and Haiku 4.5, which includes Opus 5.x. CLAUDE_CODE_TASK_LIST_ID shares a list only through a local directory.
  -> The plan-of-record must live in the repo, mirrored to Notion, not in the native task list.
- F06 [verified-source] A TaskCompleted hook exiting 2 blocks a task's completion; TaskCreated and TeammateIdle hooks also exist.
  -> This native 'tick only with proof' mechanism works only with Task tools on; implement the same rule in /execution's tick script.
- F07 [verified-source, LB] Dynamic workflows keep the plan in a script. Concurrency is capped at min(16, CPUs-2), which is 14 here. There is no mid-run user input, so each stage is its own workflow. A run pauses at a usage limit only in interactive sessions, not when launched from Remote Control, background, -p or teammate sessions.
  -> One workflow per wave with manual tasks between waves; set CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS to about 6; waves relaunched from the phone through Remote Control fail at usage limits rather than waiting.
- F08 [verified-source, LB] Worktrees branch from origin/<default> unless worktree.baseRef is "head". A worktree with changes stays until the cleanupPeriodDays sweep (default 30). symlinkDirectories, sparsePaths and .worktreeinclude settings exist.
  -> Set baseRef "head", fast-forward local main before each wave, and remove each merged lane worktree explicitly.
- F09 [verified-source, LB] Claude Code's own worktree removal has not followed NTFS junctions since v2.1.205, but plain `git worktree remove` deleted a junction target's files in the owner's own measurement.
  -> Remove worktrees only through Claude Code or a link-safe script; never junction node_modules into writing lanes.
- F10 [verified-source] Worktree isolation had a run of leak bugs fixed between May and September 2026.
  -> Pin the version during the event and run an isolation canary in rehearsal.
- F11 [verified-source] Background sessions and /batch give each worker its own worktree and publish a branch or PR; they never push to main or merge.
  -> The 'branch per worker, integrator merges' contract is the vendor default.
- F12 [verified-source] `claude --cloud` sessions run lanes off the laptop: they clone the pushed branch, run in parallel with no VM charge, share rate limits, and come back with --teleport (clean tree required).
  -> A relief valve when local disk binds, for lanes that need no local wallet, secret or Windows tool.
- F13 [verified-source, LB] Cross-session messaging reaches only the same account's sessions, so it cannot link dev A's and dev B's orchestrators.
  -> Git and Notion are the only channels shared by the two humans.
- F14 [verified-source, LB] Inside a subagent, hooks receive agent_id and agent_type, so role-specific rules can be enforced.
  -> PreToolUse hooks keyed on agent_type: implementers cannot edit tests or read holdouts; verifiers are read-only.
- F15 [verified-source] vibe-kanban gives each workspace a worktree and branch, runs a setup script per worktree, and merges by rebasing in the task worktree then fast-forwarding in the base worktree. Its company shut down on 10 Apr 2026.
  -> Rebase in the lane's own worktree (a branch can be checked out only once); avoid third-party orchestrator lock-in.
- F16 [verified-source] Conductor runs on macOS only and gives each workspace a worktree with setup scripts, a per-workspace port range and a nonconcurrent run mode.
  -> Copy the ideas of per-lane ports and a non-concurrent flag for unary resources.
- F17 [verified-source] claude-squad (tmux plus worktrees) is broken on native Windows.
  -> Not usable on this laptop.
- F18 [verified-source] CCPM uses one worktree per epic with several agents split by file streams in it, one designated stream for shared files, and conflicts never auto-resolved.
  -> Closest prior art for contract-first ownership; its raw removal is the F09 hazard.
- F19 [verified-source, LB] Anthropic's C-compiler harness ran 16 containerized agents with git-pushed lock files. Merge conflicts were frequent, parallelism collapsed on one giant task, and CI enforcement had to be added.
  -> Git push works as a lock primitive; parallelism needs independent tasks and a merge gate.
- F20 [verified-source] Container-per-agent tools need Docker, which has filled this C: drive before.
  -> No containers on this laptop.
- F21 [verified-executed, LB] The pnpm store is on C:, the same volume as the projects, so worktree installs are hard links. Without Developer Mode pnpm uses junctions. The global virtual store (off by default) points node_modules outside the worktree.
  -> Per-lane `pnpm install --frozen-lockfile --offline` is cheap; keep enableGlobalVirtualStore off.
- F22 [verified-executed, LB] In the Yarn-linker Hedera scaffold, one built copy weighs about 2.9 GB against a 6.1 MB checkout.
  -> Serialize heavy builds; non-pnpm projects cannot afford a worktree per lane; measure disk with PowerShell.
- F23 [verified-source] Windows file locks make git fail in a non-TTY agent shell: git answers no to its own retry prompt.
  -> Stop servers and watchers before rebase or worktree removal.
- F24 [verified-executed] On this machine core.longpaths is unset, core.symlinks is false, OS LongPathsEnabled is 1, and Developer Mode is off.
  -> Set core.longpaths=true per project; symlinks are unavailable, junctions are used.
- F25 [verified-source] Microsoft Dev Drive needs at least 50 GB free.
  -> Antivirus overhead cannot be mitigated with Dev Drive now.
- F26 [verified-source] Parnas (1972): simple interfaces let independent development begin much earlier.
  -> Foundation for a contract-first wave 0.
- F27 [verified-source, LB] Parallel agents that do not share decisions produce inconsistent work.
  -> Prescribe shared decisions (types, schemas, ABIs, env, units) upfront in a frozen contract.
- F28 [verified-source, LB] A concurrent interface change broke 97% of constructed agent pairs; a note describing the change recovered 82%.
  -> Freeze interfaces before parallel waves; broadcast contract-change notes; always test the combination.
- F29 [verified-source, LB] Cohesion-aware partitioning with hub files isolated beat naive file-based parallelism and Claude Code Agent Teams: up to 2.10x speedup, +14% pass rate, -35% cost. Agent Teams ran fastest but produced lower quality than sequential.
  -> Expect 1.5-2x, not Nx; hub files belong to the contract lane.
- F30 [verified-source] CodeTeam turns the design into a machine-checkable contract of file ownership, public interfaces and dependency constraints before implementation.
  -> Prior art for the wave-0 contract artifact.
- F31 [verified-source] Across 1,902 runs, naming a coordinator gave no reliable gain, shared files cut messaging tokens by about 42%, and interfaces between agents need owners.
  -> Give every contract item an owner; coordinate through files.
- F32 [verified-source, LB] 16% of merges had textual conflicts, and 33% of merges git reported as clean actually broke the build or tests.
  -> Re-run the gate on the combined tree after every rebase or merge.
- F33 [verified-source, LB] Scheduling so that tasks sharing files never run concurrently would have avoided most conflicts.
  -> Scheduler rule: concurrency only for disjoint write-sets and no shared unary resource.
- F34 [verified-source, LB] bors: test main plus the queued changes on a staging branch, then fast-forward main to exactly that commit.
  -> This is the local integrator's algorithm.
- F35 [verified-source, LB] GitHub's merge queue is unavailable for personal private repositories.
  -> Implement a local merge queue.
- F36 [verified-source] Worktree isolation defers conflicts to an expensive merge step, and parallel speedups vary widely.
  -> Keep lanes short-lived and integrate often; parallelism is not free speed.
- F37 [verified-source, LB] Recommended and measured concurrency is 3-5; the owner's pilot stalled at 18 concurrent subagents.
  -> Default 3 writing lanes plus at most 2 verifiers.
- F38 [verified-source, LB] Notion cannot act as a lock: no conditional update, last-write-wins, 409 errors on data collisions, and 180 requests per minute per connection on non-Business plans.
  -> Partition Notion rows by owner; take correctness from git.
- F39 [verified-source, LB] Git push is a compare-and-swap: a non-fast-forward push is refused, and --force-with-lease=<ref>:<expect> fails unless the remote still holds the expected value.
  -> Two merge queues serialize on origin/main; claim files pushed to git have a single winner.
- F40 [verified-source] Locks that only save duplicate work need less machinery than locks that protect correctness; correctness needs fencing tokens.
  -> Treat claims as efficiency locks; the integration CAS plus the tick rule guard correctness.
- F41 [verified-source] Without a shared claim substrate, 78% of work redid a teammate's task, and a file-based tracker lost concurrent writes.
  -> Static assignment is the simplest claim protocol and cannot race.
- F42 [verified-source, LB] A same-family verifier's approval is not independent evidence. A fresh context reduces anchoring but not self-preference; only regenerated executable evidence counts.
  -> The verifier re-runs the proof itself; cross-model or human review for money, security and absence claims.
- F43 [verified-source, LB] Agents weaken or game tests; hooks must make tests read-only, and production diffs must be scanned for special-casing.
  -> Hooks keyed on agent_type plus integrity scans in the merge gate.
- F44 [verified-source, LB] Agents seek out hidden grading material unprompted: 80% of sealed runs opened a decoy test file.
  -> Holdout checks must sit outside the lane worktree and be access-controlled.
- F45 [verified-source, LB] Tests written by a separate agent are more accurate than tests the implementer writes after its own code.
  -> A test-designer agent writes proof and acceptance checks at planning time.
- F46 [verified-source] Verification failures are common in multi-agent systems, and verifiers help without being a silver bullet.
  -> Use several layers of checks, not a single verifier pass.
- F47 [verified-source, LB] Every new test must be seen to fail; the owner already plants defects.
  -> A planted-defect or scoped-mutation check is required before a new test counts as proof.
- F48 [verified-source, LB] Gaming appears after repeated failures; retries should be capped and 'blocked' allowed as an outcome.
  -> Maximum 2 retries, then BLOCKED and proposed to the user (owner decision 2).
- F49 [verified-source] The C-compiler experiment's lesson: the verifier must be nearly perfect, and passing tests are rarely the end.
  -> Proof definitions deserve review at plan approval.
- F50 [verified-source, LB] The owner already gates completion on the plan, not the test suite, and keeps that gate out of CI.
  -> Generalize this script, fed by the plan, as the tick and build-complete gate.
- F51 [verified-executed, LB] RAM and disk bind before CPU on this laptop: 15.7 GB RAM, commit-free 5.5 GB, an auto-managed 14.4 GB pagefile on C:, and free disk moving 5.9, 4.0, 2.0 then 5.06 GB within about 30 minutes.
  -> Gate each wave on measured free disk and commit memory, not on CPU count.
- F52 [verified-executed] The session scratchpad is shared by all agents in the session; my subdirectory in it vanished mid-run.
  -> Namespace scratch paths per run and task; no agent cleans shared directories.
- F53 [reported] The owner's /harden pilots on this machine found the Git Bash pnpm shim broken and `cmd //c` hanging; installs work as one `cd "<abs>" && <cmd>` call.
  -> Lane install commands take one fixed shape; never go through cmd from Git Bash.