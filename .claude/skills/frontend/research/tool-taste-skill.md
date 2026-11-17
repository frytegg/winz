# The "taste skill" (Leonxlnx/taste-skill) for frontend design
> Code FD01 · slug tool-taste-skill · researched 2026-09-30 · verified 2026-09-30 · counts: verified 13 / corrected 16 / downgraded 0 / dropped 0 / added 1

## Summary

- The owner's "taste skill" is `github.com/Leonxlnx/taste-skill`. It is by Leon Lin (Munich, X handle `lexnlin` per his GitHub profile), MIT-licensed and created 2026-02-19. On 2026-09-30 it had 91,510 stars and 6,218 forks. skills.sh reports 3.8M installs for the repo and 440.1K for the default skill.
- It is a family of 13 skills, not one. The default, `design-taste-frontend` ("v2 experimental", in folder `skills/taste-skill`), is one SKILL.md of 1,206 lines and 87,126 characters. Its text last changed on 2026-05-26. Three later commits touched other files (a v1 fix on 2026-05-28, a stitch-skill link fix on 2026-06-09, the plugin manifest on 2026-06-12); every commit since 2026-06-13 is README, sponsor or README-asset work (corrected: the draft said every commit since 2026-05-26 was sponsorship or README work). There are no releases or tags, 37 issues and 36 PRs are open, and the community fixes to its code are unmerged.
- v2 is organised as follows:
  - a one-line "Design Read" of the brief;
  - three dials (DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY, baseline 8/6/4);
  - a map to official design systems;
  - about 30 "production-test" bans;
  - a 62-item pre-flight checklist.
- Its numbers can be reused:
  - hero headline 2 lines or fewer, subtext 20 words or fewer, top padding capped at `pt-24`, at most 4 text elements in the hero;
  - navigation on one line and 80px or less;
  - eyebrow labels capped at ceil(sections/3);
  - at least 4 layout families per 8 sections;
  - zero em dashes;
  - one accent colour, saturation under 80%.
- How it covers the owner's 20 tells:
  - clear rule for 10 (1, 3, 4, 7, 8, 10, 11, 16, 17, 18);
  - partial for 6 (2, 6, 9, 14, 15, 19);
  - missing or prescribed for 4. Colored-border cards (#5) are never mentioned. Fade-in on scroll (#12) is a canonical code skeleton and is mandatory at the default MOTION 6. Cursor-following effects (#13) appear in its pattern vocabulary. Grain over a gradient (#20) is treated only as a performance question.
- The sibling skills in the same repo prescribe several of the owner's tells: pill badges above headings, scroll fade-ins, Instrument Serif, grain and mesh gradients, glass nav pills. The headline install command targets the whole repo.
- Evidence: no anti-slop ban or threshold cites a source or published data; the only external references are Appendix B's install and documentation links for design systems and CSS features, and WCAG named without a link (corrected: the draft said no design rule cites an external source). The only data are counts in the round-4 and round-5 commit messages, from 18 unpublished builds that the author ran on Claude Opus 4.7. Fraunces/Instrument Serif appeared in 9/12 of them and the beige+brass palette in 4/4 cookware tests. The `research/` folder is about output truncation, and it credits the OPRO result (GSM8K 34.0 to 80.2, Google DeepMind) to "Microsoft Research".
- Defects checked against primary docs:
  - the GSAP sticky-stack skeleton animates the element it pins, which GSAP's docs warn against;
  - the horizontal-pan skeleton uses a stale distance and locks reduced-motion users out of its panels;
  - §7 prescribes `transition: all`, which contradicts §6.A;
  - the contrast rule sets large text at 18px, but WCAG sets it at 18pt (about 24px), or 14pt bold (about 18.5px).
- Cost and compliance:
  - Claude Code docs say to keep SKILL.md under 500 lines. After compaction they re-attach only the first 5,000 tokens of a skill. v2's §9 heading starts at character 50,329, so the bans would be dropped (corrected: the draft gave 50,365, the end of the heading line).
  - A vendor arena (AI judges, 3 tasks, one run) scored v2 8.0/10, tied with Anthropic's frontend-design, but it used 1.9M context tokens against 320K.
  - Users report that agents do not follow its rules reliably (issue #106).
- What /frontend should take from it:
  - Take the rules and numbers from v2, but do not install it or load it whole.
  - Pin a commit SHA. The skills CLI accepts a full SHA in a `/tree/<sha>/` URL since 2026-09-06 (F04).
  - Turn the checkable rules into static checks and Playwright-rendered checks behind a Stop hook, scoped to the frontend subagent: a hook in skill frontmatter stays registered for the rest of the session (F22).
  - Add the tells it misses.
  - Calibrate every rule on the owner's past frontends and on human-designed control sites.
  - Refuse its fallbacks that are dishonest at a hackathon: invented logos for invented brands, placeholder image slots, stock photos, invented numbers.
- Its image-to-code skill generates images first and is written for Codex. For the owner's plan of reusing customer sites, the right input is a Playwright screenshot of the real site. Its extraction checklist can still be reused on that screenshot.

## Findings

### FD01-F01 — The owner's "taste skill" is github.com/Leonxlnx/taste-skill, an MIT repository by Leon Lin with 91,510 stars
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The canonical project called "taste skill" is `Leonxlnx/taste-skill`. The owner account `Leonxlnx` shows display name Leon Lin, location Munich and X handle `lexnlin`. The repository was created 2026-02-19, is MIT-licensed, and its homepage is tasteskill.dev. On 2026-09-30 the GitHub API reports 91,510 stars, 6,218 forks and 289 watchers. The next repositories that come up for "taste-skill" are separate projects with a few hundred stars each. The README disclaims any crypto token.
- **Implication for /frontend:** Cite and pin `Leonxlnx/taste-skill` itself. Forks and mirrors (for example `gtmvalley/Leonxlnx-taste-skill`, `AdvisoryMonksConsulting/Taste-Skill`) are not the source. Given the owner's crypto context: any "taste skill" token is unaffiliated with the project, and the author says so.
- **Evidence:**
  - [Leonxlnx/taste-skill, repository API](https://api.github.com/repos/Leonxlnx/taste-skill) — GitHub, read 2026-09-30, accessed 2026-09-30 — repository metadata.
    - `gh api repos/Leonxlnx/taste-skill` → `"created_at":"2026-02-19T21:44:05Z","forks":6218,"homepage":"https://tasteskill.dev","license":"MIT","open_issues":73,"owner":"Leonxlnx","owner_type":"User","pushed_at":"2026-09-26T09:01:50Z","stars":91510,"watchers":289`
  - [GitHub user Leonxlnx, API](https://api.github.com/users/Leonxlnx) — GitHub, accessed 2026-09-30 — account profile.
    - `gh api users/Leonxlnx` → `"name":"Leon Lin","location":"Munich","twitter_username":"lexnlin","created_at":"2025-07-03T11:15:01Z","followers":2166`
  - [LICENSE](https://github.com/Leonxlnx/taste-skill/blob/main/LICENSE) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — license file.
    - "MIT License" … "Copyright (c) 2026 Leonxlnx"
  - [README.md](https://github.com/Leonxlnx/taste-skill/blob/main/README.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — project README.
    - "Taste Skill has no official token, coin, or crypto project. Any token using my name, image, or project is unaffiliated and not endorsed by me."
  - [GitHub repository search "taste-skill"](https://github.com/search?q=taste-skill&type=repositories) — GitHub, accessed 2026-09-30 — search.
    - `gh search repos taste-skill` → `Leonxlnx/taste-skill` 91510 stars; `codeswithroh/tastemaker` 428; `senlindesign/taste-skill` 372; `jaytel0/taste` 304.
- **Limits / false positives:** Star counts change daily; skills.sh showed 84.0K the same day. Stars measure attention, not design quality. At verification the API showed 91,518 and then 91,520 stars; every other field matched. The two named copies are not GitHub forks: `gtmvalley/Leonxlnx-taste-skill` describes itself as "Mirrored from Leonxlnx/taste-skill", and `AdvisoryMonksConsulting/Taste-Skill` gives the original URL as its description.

### FD01-F02 — The default skill has not changed since 2026-05-26; recent activity is sponsorship, and community fixes to its content are unmerged
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - main has 167 commits; the contributors API attributes 156 of them to Leonxlnx.
  - `skills/taste-skill/SKILL.md` was last modified by commit 3c7017d on 2026-05-26.
  - The 15 most recent commits (2026-08-22 to 2026-09-26) are README sponsor edits, several authored by "Cursor Agent".
  - There are no releases and no tags.
  - 37 issues and 36 pull requests are open. The API's `open_issues: 73` counts both.
  - Every recently merged PR is the owner's own README or sponsor change.
  - The open community PRs that touch skill content include #124 (motion skeleton fixes), #126 (`transition: all`), #111 (a validator plus the first block-library entries), #58 (reduced motion in gpt-taste and minimalist-ui, open since June) and #62 (name alignment).
- **Implication for /frontend:** Treat v2 as a frozen snapshot, not a maintained dependency. Pin by SHA and carry any fixes in /frontend (see F13, F14). Upstream is not fixing them. The file is byte-identical at HEAD `ce26fc2` and at `3c7017d`.
- **Evidence:**
  - [Commits touching skills/taste-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/commits/main/skills/taste-skill/SKILL.md) — GitHub, accessed 2026-09-30 — commit log.
    - `gh api "repos/Leonxlnx/taste-skill/commits?path=skills/taste-skill/SKILL.md"` → newest: `3c7017d 2026-05-26T19:31:36Z Leonxlnx | feat(skill): round-5 hardening from test-13/14/15 + test-16/17/18 (all Opus 4.7)`
    - main log → `ce26fc2 2026-09-26 Leon Lin | Merge pull request #125 …add-anthonyliuva-community-sponsor` … `87da8a4 2026-09-26 Cursor Agent | Add AnthonyLiuVa to the community sponsors list.` … `72e2995 2026-08-22 Leon Lin | Use interfaces.dev sponsorship tracking URL (#100)`
  - [Contributors, releases, tags, issues (API)](https://api.github.com/repos/Leonxlnx/taste-skill/contributors) — GitHub, accessed 2026-09-30 — API reads.
    - contributors → `Leonxlnx 156, cursoragent 5, devin-ai-integration[bot] 1, jkk442 1, Osamaali313 1, Blueemi 1, luojiyin1987 1`; commit pagination → `last page (=commit count): 167`; `releases` and `tags` → empty.
    - open issues without PRs → 37; open PRs → 36.
  - [Closed pull requests](https://github.com/Leonxlnx/taste-skill/pulls?q=is%3Apr+is%3Aclosed) — GitHub, accessed 2026-09-30 — PR list.
    - `#125 merged=2026-09-26 Leonxlnx | Add AnthonyLiuVa to community sponsors` … `#95 merged=2026-08-21 Leonxlnx | Add interfaces.dev as a company sponsor`
  - [Raw SKILL.md at a commit](https://raw.githubusercontent.com/Leonxlnx/taste-skill/3c7017d/skills/taste-skill/SKILL.md) — GitHub raw, accessed 2026-09-30 — pinned fetch.
    - `curl -sL …/ce26fc25c0e5e8cab638f883de62d9a86ee5e45b/skills/taste-skill/SKILL.md | wc -c` → `87253`; same file at `3c7017d` → `87253`.
- **Limits / false positives:** "Unmerged" describes 2026-09-30. The maintainer may still merge. Community fixes to other skills were merged in June: #37 (v1 `LAYOUT_VARIANCE` typo, commit f70fa02, 2026-05-28, merged 2026-06-12), #51 (stitch-skill dead link, 2026-06-09) and #53 (the `.claude-plugin/` manifest, 2026-06-12). No file under `skills/` has changed since 2026-06-12 (`gh api "repos/Leonxlnx/taste-skill/commits?path=skills&since=2026-05-27T00:00:00Z"`, checked at verification).

### FD01-F03 — "Taste skill" is a family of 13 skills whose install names differ from their folder names; the image-generation skills output images only
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - `skills/` holds 13 SKILL.md files.
  - Ten are implementation skills. Folder → install name: `taste-skill` → `design-taste-frontend` (v2), `taste-skill-v1` → `design-taste-frontend-v1` (corrected: the draft listed `taste-skill-v1` as if the folder name were the install name; the frontmatter and README L132 say `design-taste-frontend-v1`), `gpt-tasteskill` → `gpt-taste`, `image-to-code-skill` → `image-to-code`, `redesign-skill` → `redesign-existing-projects`, `soft-skill` → `high-end-visual-design`, `output-skill` → `full-output-enforcement`, `minimalist-skill` → `minimalist-ui`, `brutalist-skill` → `industrial-brutalist-ui`, `stitch-skill` → `stitch-design-taste`.
  - Three are image-generation skills that write no code: `imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit`.
  - The headline install command on the README and on tasteskill.dev names the whole repo. The skills CLI then asks which skills to install, or selects all of them with `-y`.
  - skills.sh lists 14 skills for the repo, including `image-taste-frontend`, which is not in the tree.
- **Implication for /frontend:** "Use the taste skill" is ambiguous. /frontend should name `design-taste-frontend` v2 and exclude the siblings, because they contradict it (F17).
- **Evidence:**
  - [README.md, Skills and Installing](https://github.com/Leonxlnx/taste-skill/blob/main/README.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — README.
    - "The `npx skills add` CLI scans the `skills/` folder in this repo, so **all skills below (code and image-generation) install the same way.**"
    - "Install a single skill by its **install name** (the `name:` field inside the SKILL frontmatter, not the folder name)"
    - "These produce design images only (no code). Use with ChatGPT Images, Codex image mode, or any agent that generates images."
  - [Repository tree](https://github.com/Leonxlnx/taste-skill/tree/main/skills) — GitHub, accessed 2026-09-30 — tree listing.
    - `gh api "repos/Leonxlnx/taste-skill/git/trees/HEAD?recursive=1"` → 13 `skills/*/SKILL.md` plus `skills/stitch-skill/DESIGN.md` and `skills/llms.txt`.
  - [tasteskill.dev](https://tasteskill.dev) — Taste Skill, accessed 2026-09-30 — project website.
    - "$npx skills add Leonxlnx/taste-skill"
  - [skills CLI source, add.ts](https://github.com/vercel-labs/skills/blob/main/src/add.ts) — Vercel Labs, HEAD 2026-09-30, accessed 2026-09-30 — source code.
    - `} else if (skills.length === 1 || options.yes) {` / `selectedSkills = skills;` … `message: 'Select skills to install'`
  - [skills.sh: leonxlnx/taste-skill](https://skills.sh/leonxlnx/taste-skill) — Vercel skills.sh, accessed 2026-09-30 — registry page.
    - "14 skills3.8M total installs" … "### image-taste-frontend"
  - [skills.sh: design-taste-frontend](https://skills.sh/leonxlnx/taste-skill/design-taste-frontend) — Vercel skills.sh, accessed 2026-09-30 — registry page.
    - "Installs 440.1K" … "GitHub Stars 84.0K" … "First Seen Feb 21, 2026"
- **Limits / false positives:** The skills.sh page does not say how it counts installs.

### FD01-F04 — In Claude Code it installs through `npx skills add` into `.claude/skills/<frontmatter name>/`, is invoked as `/design-taste-frontend` or automatically, and can be pinned only by commit SHA
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - The README install command is `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"`.
  - For Claude Code, the skills CLI installs to `.claude/skills/`, or to `~/.claude/skills/` with `-g`.
  - By default it keeps a canonical copy in `.agents/skills/<name>` and links it into the agent directory. `--copy` copies instead. On Windows the link is a directory junction.
  - The installed folder takes the skill's frontmatter `name`.
  - The CLI sends anonymous telemetry unless `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` is set.
  - In a personal or project skill directory, Claude Code takes the command from the frontmatter `name`, and the directory name also invokes the skill. The CLI names the folder after `name`, so both give `/design-taste-frontend` (corrected: the draft said the command comes from the directory name and quoted a docs sentence that is not on the page; the page says the opposite). It loads a skill automatically when the description matches, unless `disable-model-invocation: true` is set.
  - The repo also ships a `.claude-plugin/marketplace.json` whose plugin source is the repo root (`"./"`). The README does not document it.
  - Claude Code scans a plugin's default `skills/` folder, so a plugin install would expose all 13 skills.
  - `/plugin marketplace add owner/repo#ref` pins only a branch or tag, and the repo has no tags. A marketplace you write yourself can still pin the plugin: a `github` plugin source takes a full 40-character `sha`.
  - The skills CLI can also pin. Since vercel-labs/skills PR #1439 (merged 2026-09-06), a full 40-character SHA in a `/tree/<sha>/<path>` URL is installed by fetching that commit after `git clone --branch` fails. Its lock file (`.skill-lock.json`, added 2026-01-22) records a branch or tag `ref` and a folder hash for updates; it is not a pin. I read the source and did not run it.
  - A raw fetch at a commit SHA works.
  - (corrected: the draft named only the raw fetch as a SHA route.)
- **Implication for /frontend:**
  - Do not depend on a live install.
  - If /frontend quotes any taste-skill text, vendor that one file at a SHA into /frontend's references, keep the MIT notice, and never make it auto-invocable.
  - Better: derive and calibrate the rules (F18).
  - A global install on the owner's machine would add up to 13 auto-invocable skills. Their broad descriptions could compete with /frontend for triggering. This last point is my inference and was not tested.
- **Evidence:**
  - [README.md, Installing](https://github.com/Leonxlnx/taste-skill/blob/main/README.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — README.
    - `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"`
  - [vercel-labs/skills README](https://github.com/vercel-labs/skills) — Vercel Labs, HEAD 2026-09-30, accessed 2026-09-30 — CLI documentation.
    - "| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |"
    - "| `--copy` | Copy files instead of symlinking to agent directories |"
    - "Set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` to disable both entirely."
  - [vercel-labs/skills src/installer.ts](https://github.com/vercel-labs/skills/blob/main/src/installer.ts) — Vercel Labs, HEAD 2026-09-30, accessed 2026-09-30 — source code.
    - `const rawSkillName = skill.name || basename(skill.path);` … `// Canonical location: .agents/skills/<skill-name>` … `const symlinkType = platform() === 'win32' ? 'junction' : undefined;`
  - [Extend Claude with skills](https://code.claude.com/docs/en/skills) — Anthropic, Claude Code docs, accessed 2026-09-30 (re-read at verification as `skills.md`, 100,566 bytes) — official docs.
    - "The command you type to invoke a skill comes from where the skill file lives and, for skill directories and plugin skills, from the frontmatter `name` field. In a personal or project skill directory, `name` sets the command that the `/` menu shows and that you type, unless another command already uses that name. The directory name also invokes the skill. In a plugin skill, `name` sets the last segment of the command and the plugin prefix stays in place."
    - Frontmatter table: "| `name` | No | Command name shown in the `/` menu. Defaults to the directory name."
    - The draft's quote ("`name` sets only the display label shown in skill listings, and the command still comes from the directory or file name") was not found on the page at verification.
    - "| (default) | Yes | Yes | Description always in context, full skill loads when invoked |"
  - [.claude-plugin/marketplace.json](https://github.com/Leonxlnx/taste-skill/blob/main/.claude-plugin/marketplace.json) — added 2026-06-12 by commit fb534bc, accessed 2026-09-30 — manifest.
    - `"name": "taste-skill", … "version": "1.0.0", "source": "./"`
  - [Plugins reference](https://code.claude.com/docs/en/plugins-reference) — Anthropic, accessed 2026-09-30 — official docs.
    - "| Skills | `skills/` | One `<name>/SKILL.md` per skill."
  - [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins) — Anthropic, accessed 2026-09-30 — official docs.
    - "| GitHub repository | `owner/repo`. Add `#ref` to pin a branch or tag. |"
  - [Plugin marketplaces reference, plugin sources](https://code.claude.com/docs/en/plugins/marketplace-reference) — Anthropic, accessed 2026-09-30 (added at verification) — official docs.
    - "| `github` | `repo`, `ref`, `sha` | GitHub repository in `owner/repo` form |" … "**`sha`**: a full 40-character lowercase commit SHA. When you set both `ref` and `sha`, Claude Code checks out `sha`."
  - [vercel-labs/skills PR #1439](https://github.com/vercel-labs/skills/pull/1439) and [src/git.ts](https://github.com/vercel-labs/skills/blob/main/src/git.ts) — Vercel Labs, merged 2026-09-06, main @ 3694740 read 2026-09-30 (added at verification) — source code.
    - PR title: "feat: support installing skills pinned to a commit SHA"; body: "`skills add <url>` accepts a ref from `/-/tree/<ref>/` and `/tree/<ref>/` URLs, but a full commit SHA fails"
    - git.ts: "`--branch` cannot target a bare commit SHA. If the ref is a full SHA and the clone failed because the ref was not a branch or tag, retry by fetching the commit directly."
    - skill-lock.ts: "/** Branch or tag ref used for installation (for ref-aware updates) */" … "GitHub tree SHA for the entire skill folder."
- **Limits / false positives:** I did not run the installer or the plugin install; this environment forbids running projects. The plugin namespacing comes from the docs. PR #108 reports different naming behaviour (see Contradictions).

### FD01-F05 — v2 covers marketing surfaces only; dashboards, data tables and multi-step forms are explicitly out of scope
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** v2 targets landing pages, portfolios and redesigns. It lists dashboards, admin panels, data tables, multi-step forms, code editors, native mobile and realtime collaborative UIs as out of scope, and sends dense product UI to Fluent, Carbon, Atlassian or Polaris.
- **Implication for /frontend:** A hackathon protocol has two surfaces:
  - the explainer or landing page, which v2 covers;
  - the working app or dashboard shown in the demo video, which v2 does not cover.

  /frontend needs a second rule set for the app surface (see F29: web-design-guidelines, ui-ux-pro-max, design-system density rules).
- **Evidence:**
  - [skills/taste-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 experimental, commit 3c7017d (2026-05-26), accessed 2026-09-30 — the tool's own file.
    - L3: "Anti-slop frontend skill for landing pages, portfolios, and redesigns."
    - L8: "Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI."
    - L898-901: "This skill is NOT for: * Dashboards / dense product UI / admin panels (use Fluent, Carbon, Atlassian, or Polaris from Section 2.A). * Data tables (use TanStack Table or AG Grid). * Multi-step forms / wizards (use Form-specific patterns; this skill won't make them better)."
- **Limits / false positives:** The skill says to apply its marketing parts "to the surfaces where they apply" (L906). The Happycapy arena still ran it on a dashboard, where it scored 8.0 (F23).

### FD01-F06 — v2 opens with a one-line "Design Read" of the brief and allows at most one clarifying question
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Before any code, v2 requires the agent to infer six things from the brief: page kind, vibe words, reference signals, audience, existing brand assets and quiet constraints. It then states one line. It asks one question only when readings genuinely diverge.
- **Implication for /frontend:** Reuse the Design Read as /frontend's first artifact, with the audience fixed as the hackathon jury plus the sponsor's engineers. /hackathon's research (sponsors, their customers, use cases) is exactly the "reference signals" and "audience" input the read asks for. /frontend can write the read from those files instead of asking, which fits /execution's autonomous runs.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §0](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L15: "Most LLM design output is bad because the model jumps to a default aesthetic instead of reading the room."
    - L21: "**Audience** - B2B procurement panel vs. design-conscious consumer vs. recruiter scanning a portfolio. The audience picks the aesthetic, not your taste."
    - L26, as rendered: "Before any code, state in one line: **"Reading this as: <page kind> for <audience>, with a <vibe> language, leaning toward <design system or aesthetic family>."**"
    - L34: "Ask exactly **one** clarifying question - never a multi-question dump - and only when the design read genuinely diverges."
- **Limits / false positives:** The model declares the read itself. Nothing checks the read against the brief or the output against the read.

### FD01-F07 — Three dials (VARIANCE, MOTION, DENSITY; baseline 8/6/4) gate most rules; above MOTION 4 motion including scroll reveals is mandatory, at 1-3 there is no automatic animation
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Dial ranges: DESIGN_VARIANCE (1 perfect symmetry to 10 artsy chaos), MOTION_INTENSITY (1 static to 10 cinematic), VISUAL_DENSITY (1 art gallery to 10 cockpit).
  - Baseline 8/6/4. The skill gives an inference table and presets (SaaS landing 7/6/4; public sector 3/2/5).
  - MOTION 1-3 means "No automatic animations. CSS `:hover` and `:active` states only."
  - At MOTION above 4 the page "must actually move", including "scroll-reveal on key sections".
  - Above DESIGN_VARIANCE 4, centered heroes "are avoided" and split or asymmetric layouts are forced (L210), with an override for "editorial / manifesto / launch-announcement briefs" (L211) (corrected: the draft said "bans" and omitted the override).
  - VISUAL_DENSITY 8-10 requires `font-mono` for all numbers.
- **Implication for /frontend:**
  - The dials give /frontend a shared vocabulary.
  - For recorded demo videos and the owner's tells #12 and #13, the relevant setting is MOTION 1-3. It switches off the skill's own scroll-reveal requirement.
  - Any motion above that should be justified by a real state change in the protocol, which is the skill's own "motion must be motivated" rule.
  - v2's default of 6 would force motion in.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §1, §5, §7](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L51: "**Baseline:** `8 / 6 / 4`. Use these unless the design read overrides them. Do not ask the user to edit this file - overrides happen conversationally."
    - L60: "| "trust-first / public-sector / regulated / accessibility-critical" | 3-4 | 2-3 | 4-5 |"
    - L359: "**"Motion claimed, motion shown."** If `MOTION_INTENSITY > 4`, the page must actually move: entry transitions on hero, scroll-reveal on key sections, hover physics on CTAs, at minimum."
    - L360: "Before adding any animation, ask: "what does this animation communicate?" … Invalid answer: "it looked cool"."
    - L561: "**1-3 (Static):** No automatic animations. CSS `:hover` and `:active` states only."
    - L568: "**8-10 (Cockpit):** Tight paddings. No card boxes; 1px lines separate data. Mandatory: `font-mono` for all numbers."
    - L210-211 (added at verification): "**ANTI-CENTER BIAS:** Centered Hero / H1 sections are avoided when `DESIGN_VARIANCE > 4`. Force "Split Screen" (50/50), …" / "**Override:** centered hero is OK for editorial / manifesto / launch-announcement briefs where the message itself is the design."
- **Limits / false positives:** Nothing measured links dial values to perceived quality. The numbers are the author's scale.

### FD01-F08 — Typography: Inter is discouraged as a default, serif is "very discouraged", Fraunces and Instrument Serif are banned as defaults, and emphasis uses italic or bold of the same family
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - v2 sets display defaults (`text-4xl md:text-6xl tracking-tighter leading-none`) and a 65-character body measure.
  - It recommends Geist, Outfit, Cabinet Grotesk and Satoshi over Inter.
  - It calls "creative brief = serif" the most-tested AI tell.
  - It bans Fraunces and Instrument Serif as defaults, forbids mixing families for emphasis, and requires descender clearance on italic display words.
  - Space Grotesk is not mentioned anywhere in the 13 skills.
- **Implication for /frontend:**
  - Tells #4 and #18 are covered, and half of #19.
  - The replacement list is short, so a model using it will converge on the same four faces. /frontend should take type from the sponsor-customer references (F25), not from this list.
  - /frontend must add Space Grotesk itself.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §4.1](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L169: "**Discouraged as default:** `Inter`. Pick `Geist`, `Outfit`, `Cabinet Grotesk`, `Satoshi`, or a brand-appropriate serif first."
    - L174: "The agent's default mental model that "creative brief = serif" is the single most-tested AI tell in production rounds."
    - L179: "use **italic or bold of the SAME font**. Do NOT inject a random serif word into a sans headline (or vice versa) just to add visual interest. Mixed-family emphasis is amateur."
    - L180: "**Specifically BANNED as defaults:** `Fraunces` and `Instrument_Serif` (the two LLM-favorite display serifs)."
  - [grep over all 13 SKILL.md files](https://github.com/Leonxlnx/taste-skill/tree/main/skills) — command run 2026-09-30 on files fetched at main @ ce26fc2 — OBSERVED.
    - `grep -c "Space Grotesk" */SKILL.md` → 0 in every file.
- **Limits / false positives:** v2 still recommends "Inter Display" among sans display faces (L178) and the pairing "`Cabinet Grotesk` + `Inter Tight`" (L171). Inter is allowed for public-sector or "Linear-style" briefs (L170).

### FD01-F09 — Colour: one accent under 80% saturation, the purple/blue "AI glow" discouraged, consistency locks, and a hex-level ban on the beige+brass premium-consumer palette
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - One accent colour, saturation under 80%.
  - The "LILA RULE" discourages AI purple/blue unless the brand asks for it.
  - One accent across the whole page, and one theme across the whole page.
  - No pure `#000000` or `#ffffff`.
  - Hex lists for the "warm paper / brass / espresso" family that LLMs default to for premium-consumer briefs.
- **Implication for /frontend:**
  - Tell #1 is covered as a discouraged default with a brand override. Keep the override: a sponsor whose brand is purple should look purple. The skill's §11.C makes the same point.
  - The hex lists can go straight into a static checker. They were measured on cookware briefs (F18), not on crypto briefs.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §4.2, §8.B](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L186: "Max 1 accent color. Saturation < 80% by default."
    - L187: "**THE LILA RULE:** The "AI Purple / Blue glow" aesthetic is discouraged as a default. No automatic purple button glows, no random neon gradients."
    - L190: "Once an accent color is chosen for a page, it is used on the WHOLE page."
    - L194: "Backgrounds: `#f5f1ea`, `#f7f5f1`, `#fbf8f1`, `#efeae0`, `#ece6db`, `#faf7f1`, `#e8dfcb`"
    - L585: "**No pure `#000000` and no pure `#ffffff`** - use off-black (zinc-950, near-black warm gray) and off-white."
- **Limits / false positives:** The one-accent lock collides with semantic status colours. A protocol UI needs error and success colours (issue #86, F27).

### FD01-F10 — Layout rules come with testable numbers: hero ≤ 2 lines and ≤ 20 words, top padding ≤ pt-24, ≤ 4 hero text elements, nav on one line ≤ 80px, eyebrows ≤ ceil(sections/3), ≥ 4 layout families per 8 sections
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** §4.7 is headed "Hard Rules. Failing any of these is shipping broken work". The rules:
  - the hero fits the first viewport, CTA visible without scrolling;
  - capped hero top padding;
  - at most 4 hero text elements (eyebrow or brand strip, headline, subtext, CTAs);
  - logo wall below the hero;
  - one-line navigation of 80px or less;
  - bento grids with exactly as many cells as items;
  - at least 4 layout families across 8 sections;
  - no more than two zigzag image/text sections in a row;
  - no split header;
  - a mechanical eyebrow count.

  The ban on three equal feature cards is not a §4.7 hard rule. It sits in §9.C (L613), under §9's "Avoid these signatures unless the brief explicitly asks for them" (L597) (corrected: the draft listed it among the §4.7 hard rules).
- **Implication for /frontend:** These numbers serve the owner's goal that "the jury understands immediately": value stated in 20 words or fewer, CTA visible at first paint. How to check them:
  - hero fit, CTA wrap and nav height need a rendered check (Playwright at fixed viewports);
  - eyebrow count and word counts are text checks.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §4.7, §9.C](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L236: "**Hero MUST fit in the initial viewport.** Headline max 2 lines on desktop, subtext max **20 words** AND max 3-4 lines, CTAs visible without scroll."
    - L238: "**HERO TOP PADDING CAP (mandatory):** Hero top padding max `pt-24` (≈6rem) at desktop."
    - L248: "**Navigation height cap: 80px max desktop, default 64-72px.**"
    - L251: "A landing page with 8 sections must use at least 4 different layout families."
    - L254-256: "**Maximum 1 eyebrow per 3 sections.** Hero counts as 1. … count instances of `uppercase tracking` (or similar small-caps mono labels above headlines) across all section components. If count > ceil(sectionCount / 3), the output fails."
    - L613: "**NO 3-column equal feature cards.** The generic "three identical cards horizontally" feature row is banned."
- **Limits / false positives:** The thresholds are the author's choice and were never measured against human-designed sites. A centered hero is allowed for "manifesto / launch-announcement briefs" (L211). A protocol with exactly three real features would still trip the three-card ban. The eyebrow cap changed twice on one day with no published data: commit d124aaf (2026-05-26 15:20 UTC) set "max half of sections may use eyebrow", and commit 3c7017d (19:31 UTC) tightened it to "max 1 per 3 sections, mechanical count" (added at verification, from both commit messages).

### FD01-F11 — §9 "AI Tells" lists 52 bulleted bans, 31 of them the "production-test" tells of §9.F, and makes the em dash zero-tolerance
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** §9.A to §9.F hold 52 bulleted bans (9.A 5, 9.B 3, 9.C 2, 9.D 5, 9.E 6, 9.F 31), and §9.G adds the em-dash ban. Only §9.F's 31 are the ones the skill says "came out of real LLM-generated landing-page tests" (L632) (corrected: the draft's title said §9 bans "about 30 patterns seen in production tests", which fits §9.F alone). §9 bans the following:
  - glows, pure black, oversaturated accents, "excessive" gradient text, custom cursors;
  - Inter as a default, oversized H1s, three equal cards;
  - generic names ("Jane Doe") and startup brand names ("Acme", "Nexus");
  - filler verbs, hand-rolled icons, div-built fake screenshots (called the #1 tell);
  - version labels in the hero, section-number eyebrows, decorative status dots;
  - scroll cues, locale/weather strips, poetic labels, generic step labels ("Step 1", "Phase 01");
  - pills on images, photo-credit captions, version footers;
  - every em dash and separator en dash on the page.
- **Implication for /frontend:** This is the richest part of the repo for a slop checker, and many items can be detected in text:
  - em dash, "Scroll to explore", "Quietly in use at";
  - "Stage 1 / Step 1 / Phase 01", "00 / INDEX";
  - "BETA" or "V0.6" inside the hero;
  - "Acme" and "John Doe".

  The em-dash rule is stricter than /prose's measured PR-01 threshold (see Contradictions).
- **Evidence:**
  - [skills/taste-skill/SKILL.md §9](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L597: "Avoid these signatures unless the brief explicitly asks for them."
    - L632 (added at verification): "These patterns came out of real LLM-generated landing-page tests. They are the signatures the model defaults to when it tries to "look designed." Treat them as hard bans unless the brief explicitly calls for one."
    - Count at verification: a Python pass over L595-702 counting lines that start with `* ` per `### 9.x` heading → `{'9.A': 5, '9.B': 3, '9.C': 2, '9.D': 5, '9.E': 6, '9.F': 31, '9.G': 7}`; 9.G's seven bullets are one ban with its sub-rules.
    - L603-604: "**NO excessive gradient text** for large headers." / "**NO custom mouse cursors.** Outdated, accessibility-hostile, perf-hostile."
    - L655: "**NO div-based fake product UI in the hero** (fake task list, fake terminal, fake dashboard built from styled divs). It is the #1 LLM-design Tell."
    - L664: "**NO generic step labels.** "Stage 1 / Stage 2 / Stage 3", "Step 1 / Step 2 / Step 3", "Phase 01 / Phase 02 / Phase 03", "Pass One / Pass Two / Pass Three". Banned."
    - L682: "**Scroll cues are banned.** `Scroll`, `↓ scroll`, `Scroll to explore`, `Scroll to walk through it`, animated mouse-wheel icons."
    - L687: "**Em-dash (`—`) is COMPLETELY banned.** It is the LLM's signature stylistic crutch and it is the #1 visual Tell in production tests."
    - L701: "The agent has historically ignored em-dash limits when phrased as "use sparingly." The phrasing here is binary: zero em-dashes."
- **Limits / false positives:** Every §9 item carries the "unless the brief explicitly asks" escape (L597). Several items are aesthetic judgements with no measured basis. The skill's own prose keeps one em dash (L178).

### FD01-F12 — Content honesty: invented precise numbers are banned unless real or labelled mock, but the skill's fallbacks include invented numbers, invented monogram logos for invented brands, stock photos and placeholder image slots
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - §4.9 requires a copy self-audit and bans AI-invented precise numbers unless they come from real data or are labelled as mock.
  - §9.D tells the model to "Use organic, messy data" such as "47.2%", which contradicts §4.9.
  - When the brief calls for a "Trusted by / Used by / Customers" logo wall, §4.8 says to use real SVG logos (Simple Icons) and, for invented brand names, to draw an invented monogram SVG (L276-279). It does not require a logo wall; it says how to build one (corrected: the draft said §4.8 "tells the model to build" the wall).
  - When no image generator is available, §4.8 tells the model to fall back to picsum stock photos, then to "TODO" placeholder slots.
- **Implication for /frontend:**
  - At a hackathon, every number, logo and testimonial on the page must be real and traceable to a receipt from the build.
  - Adopt §4.9 and reject §9.D's "messy data".
  - Never build a "Trusted by" wall: real company logos imply an endorsement a hackathon project does not have, and invented brands are fabricated social proof.
  - Replace stock photos with real product captures or live components.
  - Treat placeholder slots as open gates. The owner's rule already says so for audience-visible TODOs.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §4.8, §4.9, §9.D](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L327-330: "**Fake-precise numbers are flagged.** Numbers like `92%`, `4.1×`, `48k`, `5.8 mm`, `13.4 lb` either: … Are AI-invented spec aesthetics - banned."
    - L618: "**NO fake-perfect numbers.** Avoid `99.99%`, `50%`, `1234567`. Use organic, messy data (`47.2%`, `+1 (312) 847-1928`)."
    - L276 (added at verification): "**Real company logos for social proof.** When the brief calls for a "Trusted by / Used by / Customers" logo wall, do NOT default to plain text wordmarks (`<span>Acme Co</span>` styled in a row). Use real SVG logos:"
    - L279: "**Make-up the brand name? Then make-up an SVG mark too.** Generate a simple monogram (one letter in a circle, two-letter ligature, abstract glyph) rendered as an inline `<svg>` matching the page style."
    - L269: "`https://picsum.photos/seed/{descriptive-seed}/{w}/{h}` for placeholder photography"
    - L272: "leave clearly-labeled placeholder slots (`<!-- TODO: hero product photo, 1600x1200 -->`)"
- **Limits / false positives:** The skill is written for generic marketing sites, where mock content is normal. The fallbacks are reasonable there and wrong for a graded submission.

### FD01-F13 — The canonical GSAP skeletons contradict GSAP's own documentation, and §7 contradicts §6.A; the fixes are proposed but unmerged
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - §5.A pins each card with `pin: true` and also tweens the same card's scale and opacity. Its markup keeps `sticky top-0` on the pinned card. GSAP's docs say not to animate the pinned element itself.
  - §5.B reads `distance` once, uses `x: -distance`, and sets `invalidateOnRefresh: true`. GSAP says only function-based values update on refresh.
  - §5.B keeps `overflow-hidden` when reduced motion skips GSAP, so panels beyond the viewport become unreachable. PR #124 measured it: "section scrollWidth 4096 vs 1280 viewport".
  - §7's MOTION 4-7 band prescribes `transition: all 0.3s …`, while §6.A says to animate only `transform` and `opacity`.
  - Issue #112 and PRs #124 and #126 report these problems. None is merged.
- **Implication for /frontend:**
  - Do not copy the skeletons.
  - If /frontend ever ships scroll-pinned sections, write them from GSAP's docs: animate an inner wrapper, use function-based values, and give reduced motion a fallback that keeps all content reachable.
  - Test with emulated `prefers-reduced-motion`.
  - Replace `transition: all` with an explicit property list. It also turns any hover colour or opacity change into a 300 ms fade, which is close to the owner's tell #14.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §5.A, §5.B, §6.A, §7](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L391: `pin: true,` … L394-396: `gsap.to(card, { scale: 0.92, opacity: 0.55,` … L415: `className="stack-card sticky top-0 min-h-[100dvh] flex items-center justify-center"`
    - L444: `if (reduce || !wrap.current || !track.current) return;` … L446: `const distance = track.current!.scrollWidth - window.innerWidth;` … L448: `x: -distance,` … L456: `invalidateOnRefresh: true,` … L464: `<section ref={wrap} className="relative overflow-hidden">`
    - L522: "Animate ONLY `transform` and `opacity`." … L562: "**4-7 (Fluid CSS):** `transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1)`."
  - [ScrollTrigger docs](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) — GSAP, accessed 2026-09-30 — official docs.
    - "Warning don't animate the pinned element itself because that will throw off the measurements (ScrollTrigger is highly optimized for performance and pre-calculates as much as possible). Instead, you could nest things such that you're animating only elements INSIDE the pinned element."
  - [ScrollTrigger tips & mistakes](https://gsap.com/resources/st-mistakes/) — GSAP, accessed 2026-09-30 — official docs.
    - "if you want the animation values to update, make sure the ones you want to update are function-based values and set invalidateOnRefresh: true in the ScrollTrigger."
  - [PR #124](https://github.com/Leonxlnx/taste-skill/pull/124) — abhinavflac, opened 2026-09-25, open, accessed 2026-09-30 — third-party fix with measurements.
    - "Headless Chromium measurements: `overflow-x: hidden`, section scrollWidth 4096 vs 1280 viewport, panels 3 and 4 sit entirely beyond the viewport and are unreachable by wheel, touch, or keyboard."
  - [PR #126](https://github.com/Leonxlnx/taste-skill/pull/126) — skindini, opened 2026-09-28, open, accessed 2026-09-30 — third-party fix.
    - "Section 7's **4-7 (Fluid CSS)** tier prescribes `transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1)`. That contradicts the skill's own **6.A**, "Animate ONLY `transform` and `opacity`""
- **Limits / false positives:** I did not run the code. The defects come from reading the code against GSAP's docs; PR #124's measurements are third-party. Issue #112 quotes GreenSock on `position: sticky`, and that quote is not on the two GSAP pages I opened. Note added at verification: the wording is still untraced, but GSAP's own forum gives the same advice. See [topic 39480](https://gsap.com/community/forums/topic/39480-problem-with-horizontal-scrolling-scrolltrigger-and-sticky-element/) (Cassie, 2024-01-04, marked as the solution): "TLDR - CSS sticky doesn't play nicely with this. The solution is to use GSAP's pinning abilities instead." See also [topic 45164](https://gsap.com/community/forums/topic/45164-display-issue-with-sticky-elements-in-conjunction-with-right-side-scrolling/) (mvaneijgen, 2025-11-05): "When working with ScrollTrigger you should have it handle all pinning, so you should not use position: sticky;". See F30.

### FD01-F14 — The contrast rule misstates WCAG's large-text threshold and is inconsistent about AA versus AAA
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - §4.5 allows 3:1 contrast for "large text 18px+".
  - WCAG 2.2 defines large-scale text as at least 18 point or 14 point bold. W3C's Understanding document converts these to about 24px and 18.5px.
  - §6.C asks for "AAA for body", while §8.B asks for "AA minimum for body text, AAA target for hero copy".
- **Implication for /frontend:**
  - Any contrast rule /frontend writes must use WCAG's thresholds: 4.5:1 below 24px regular or 18.5px bold. harden's axe-based floor already applies WCAG's definitions.
  - The button and form contrast audits, in both themes, remain a good addition against tell #7, low-contrast dark mode.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §4.5, §6.C, §8.B](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L225: "Audit every CTA: contrast ratio WCAG AA min (4.5:1 for body, 3:1 for large text 18px+)."
    - L534: "Maintain visual hierarchy, brand identity, and WCAG AA contrast (AAA for body) across both modes."
    - L582: "**Contrast** - WCAG AA minimum for body text, AAA target for hero copy."
  - [WCAG 2.2, definition of large scale (text)](https://www.w3.org/TR/WCAG22/) — W3C Recommendation, accessed 2026-09-30 — standard.
    - "large scale (text) with at least 18 point or 14 point bold or font size that would yield equivalent size for Chinese, Japanese and Korean (CJK) fonts"
  - [Understanding SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — W3C WAI, accessed 2026-09-30 — official guidance.
    - "The ratio between sizes in points and CSS pixels is 1pt = 1.333px , therefore 14pt and 18pt are equivalent to approximately 18.5px and 24px ."
- **Limits / false positives:** harden already covers automated contrast. The point is not to import the wrong threshold into /frontend's own rules.

### FD01-F15 — Coverage of the owner's 20 tells: 10 clear rules, 6 partial, 4 missing or contradicted
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Mapping of the owner's tells to v2. Line numbers refer to `skills/taste-skill/SKILL.md` @ 3c7017d; "grep" means a search over all 13 SKILL.md files.

  | # | Owner's tell | v2 rule | Status |
  |---|---|---|---|
  | 1 | purple-to-blue gradient | L39 anti-default "AI-purple gradients"; L187 LILA rule | Covered (discouraged default, brand override) |
  | 2 | gradient hero text | L603 "NO excessive gradient text" | Partial (the word "excessive") |
  | 3 | emojis in headings | L148 "Discouraged by default" (v1 said "BANNED") | Covered (softened in v2) |
  | 4 | Inter everywhere | L169, L607 "AVOID Inter as default" | Covered |
  | 5 | colored border cards | none; grep for `border-l`, "left-border", "colored border" → 0 | Missing |
  | 6 | glassmorphism cards | L39 "generic glassmorphism on everything"; L356 allowed for premium consumer | Partial (gated by context) |
  | 7 | low-contrast dark mode | L225, L228, L582 contrast checks, dual mode | Covered (threshold error, F14) |
  | 8 | 3 icon boxes in a row | L613 no 3-column equal cards | Covered |
  | 9 | badge above the headline | L240 allows one hero eyebrow; L635 bans version badges | Partial |
  | 10 | Lucide everywhere | L142 lucide discouraged, Phosphor and others instead | Covered (by substitution) |
  | 11 | untouched shadcn | L627 "NEVER in default state" | Covered (not mechanical) |
  | 12 | fade-in on scroll | L475-507 canonical scroll-reveal; L359 mandatory above MOTION 4 | Contradicted |
  | 13 | cursor-following beam | L604 bans custom cursors, but L719, L734-735, L754, L763 list cursor-tracking effects as vocabulary to "reach for when the design read calls for them" (L707); L357 prescribes cursor-pulling magnetic physics at MOTION > 5 for premium, playful or agency briefs | Missing (listed as vocabulary; magnetic pull prescribed at MOTION > 5) (corrected: the draft said "encouraged at high motion", which only L357's magnetic effect supports) |
  | 14 | buttons fade on hover | L224 `:active` press feedback only; L562 `transition: all` | Partial (no ban) |
  | 15 | inconsistent spacing | L612 "Mathematically perfect"; L566-567 section-gap bands | Partial (no spacing scale enforced) |
  | 16 | em dashes everywhere | L685-701 zero tolerance | Covered (stricter than the owner's own /prose) |
  | 17 | generic buzzword copy | L620 filler verbs; L321-326 copy self-audit | Covered (short word list) |
  | 18 | serif italic accents | L179 emphasis rule; L650 no italic line-break headlines | Covered |
  | 19 | Space Grotesk + Instrument Serif | L180 Instrument Serif banned as default; Space Grotesk 0 hits | Partial |
  | 20 | grain over a gradient | L544 grain is a performance rule; L116 aurora and mesh allowed; L259 requires "real visual variation" in 2-3 bento cells, and a brand-appropriate gradient is one of four allowed options (image, gradient, pattern, tint) | Missing (corrected: the draft said L259 requires gradients) |

- **Implication for /frontend:** taste-skill cannot serve as the tell list.
  - /frontend's list must add #5, #12, #13 and #14 as explicit rules, plus Space Grotesk (#19) and #20.
  - It must tighten #2 (any gradient text in headings), #6 (glass outside a justified use), #9 (any pill or badge above the H1) and #15 (a declared spacing scale).
- **Evidence:**
  - [skills/taste-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L507: "Use this for: feature lists, testimonial grids, logo walls, anything that just needs "enter on scroll.""
    - L735: "**Spotlight Border Card** - Borders illuminate under cursor."
    - L544: "Apply grain / noise filters EXCLUSIVELY to fixed, `pointer-events-none` pseudo-elements"
    - L259 (added at verification): "At least 2-3 cells in any multi-cell grid need real visual variation: a real image, a brand-appropriate gradient (not AI-purple), a pattern, a tinted background."
    - L357 (added at verification): "**Magnetic Micro-physics:** Use when `MOTION_INTENSITY > 5` AND the brief reads premium / playful / agency."
  - [grep over skills/*/SKILL.md](https://github.com/Leonxlnx/taste-skill/tree/main/skills) — command run 2026-09-30 on files fetched at main @ ce26fc2 — OBSERVED.
    - `grep -c -- "border-l" */SKILL.md` → 0 everywhere; `"left-border"` → 0; `"colored border"` → 0; `"Space Grotesk"` → 0.
- **Limits / false positives:** This is my mapping of the owner's short labels onto the skill's wording. "Badge above the headline" may mean an announcement pill link rather than an eyebrow label; either way v2 allows one element in that slot.

### FD01-F16 — What v2 adds beyond the 20 tells, as candidate rules
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Rules in v2 with no counterpart in the owner's list:
  - div-built fake product screenshots (L290, L655);
  - fake version labels and version footers (L635, L669);
  - section-number eyebrows (L639) and the eyebrow count (L253-256);
  - decorative status dots (L646, L683);
  - scroll cues (L682) and locale/weather strips (L681);
  - poetic section labels and "micro-meta" sentences (L660, L663);
  - generic step labels (L664);
  - pills on images and decorative photo credits (L667-668);
  - a duplicate-CTA-intent ban and a CTA wrap ban (L226-227);
  - a hero stack cap (L239-245);
  - nav one line and 80px or less (L247-248);
  - the section-layout repetition ban and zigzag cap (L251-252);
  - the bento cell-count rule (L250);
  - the split-header ban (L258);
  - logo walls with logos only (L281);
  - a colour, shape and theme lock (L190, L217, L343);
  - italic descender clearance (L183);
  - quotes of at most 3 lines (L335);
  - one copy register per page (L331);
  - "motion must be motivated" and at most one marquee (L360-361);
  - no raw scroll listeners (L511);
  - reduced motion mandatory above MOTION 3 (L526);
  - Core Web Vitals targets of LCP under 2.5s, INP under 200ms, CLS under 0.1 (L538-540);
  - a map to official design-system packages, with the rule "one system per project" (L86-104).
- **Implication for /frontend:** A candidate pool for the checker. Rules that fit the jury goal directly:
  - the ban on fake product UIs: show the real app, not a div drawing of it;
  - the hero stack cap;
  - one CTA per intent;
  - "motion must be motivated".

  Each rule has to earn its place by separating the owner's past frontends from human controls.
- **Evidence:**
  - [skills/taste-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L227: "**NO DUPLICATE CTA INTENT (mandatory):** Two CTAs with the same intent on one page is a Pre-Flight Fail."
    - L646: "**NO decorative colored status dots on every list/nav/badge.**"
    - L914: "**THIS IS NOT OPTIONAL. Run every box. If any box fails, the output is not done.**"
    - The §14 checklist (L916-977) has 62 checkbox items: `sed -n '910,980p' SKILL.md | grep -c '^- \[ \]'` → 62.
- **Limits / false positives:** None of these was validated against human-designed sites. Some would fire on good human work: human editorial sites do use eyebrows and three-column rows.

### FD01-F17 — The sibling skills in the same repository prescribe several of the owner's tells, contradicting v2
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - `soft-skill` (high-end-visual-design) mandates pill-shaped eyebrow badges above H1 and H2 headings (tell #9), a floating glass-pill navbar (#6, L58) and blur fade-ups on every element (#12). It also offers glowing purple and emerald orbs as an example ("e.g.") inside one of three pick-one archetypes, the SaaS/AI/Tech one, next to Vantablack cards with `backdrop-blur-2xl` (close to #1 and #6) (corrected: the draft said soft-skill "mandates" the orbs).
  - `minimalist-skill` lists Instrument Serif for hero headings (#19) and requires scroll-entry fades on all major blocks (#12).
  - `redesign-skill` prescribes grain and mesh-gradient backgrounds (#20), "staggered entry" opacity fades (#12), cursor "spotlight borders" (#13) and a serif header for editorial projects (a serif pairing, related to #18 but not an italic accent). It also tells the model to randomise blog dates "to appear real".
  - `gpt-taste` marks a centered hero "(Highly Preferred)". It gives a floating glass pill as one of two example navs (L23, "e.g., floating glass pill, or minimal split nav") and "grainy mesh gradients" as one of three background options (L64) (corrected: the draft said gpt-taste "prefers" the glass-pill nav).
  - `stitch-skill` recommends Fraunces and Instrument Serif and "Pulse on status dots".
  - `brutalist-skill` lists Inter as an optimal display face and a global noise filter.
  - `imagegen-frontend-web` offers a "Micro-noise gradient over solid" background.
- **Implication for /frontend:**
  - Never install the whole repo, and never let a sibling skill auto-invoke during a /frontend build.
  - If /frontend borrows from a sibling (for example redesign-skill's audit checklist), strip these prescriptions first.
- **Evidence:**
  - [skills/soft-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/soft-skill/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - L25: "**Ethereal Glass (SaaS / AI / Tech):** Deepest OLED black (`#050505`), radial mesh gradients (e.g., subtle glowing purple/emerald orbs) in the background."
    - L52: "**Eyebrow Tags:** Precede major H1/H2s with a microscopic, pill-shaped badge (`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-medium`)."
    - L69: "Elements never appear statically on load. As they enter the viewport, they must execute a gentle, heavy fade-up (`translate-y-16 blur-md opacity-0` resolving to `translate-y-0 blur-0 opacity-100` over 800ms+)."
    - L58 (added at verification): "**Closed State:** The Navbar is a floating glass pill detached from the top (`mt-6`, `mx-auto`, `w-max`, `rounded-full`)."
    - L22 (added at verification): "Before writing code, silently "roll the dice" and select ONE combination from the following archetypes"; L24 heading "### A. Vibe & Texture Archetypes (Pick 1)".
  - [skills/minimalist-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/minimalist-skill/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - L27: "Editorial Serif (Hero Headings & Quotes): Target: `font-family: 'Lyon Text', 'Newsreader', 'Playfair Display', 'Instrument Serif', serif`."
    - L83: "5. Add scroll-entry animations to all major content blocks."
    - L71 (added at verification): "Scroll Entry: Elements fade in gently as they enter the viewport. Use `translateY(12px)` + `opacity: 0` resolving over `600ms` with `cubic-bezier(0.16, 1, 0.3, 1)`."
  - [skills/redesign-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - L39: "**Flat design with zero texture.** Add subtle noise, grain, or micro-patterns to backgrounds."
    - L149: "**Staggered entry.** Elements cascade in with slight delays, combining Y-axis translation with opacity fade. Never mount everything at once."
    - L155: "**Spotlight borders.** Card borders that illuminate dynamically under the cursor."
    - L86: "**All blog post dates identical.** Randomize dates to appear real."
  - [skills/gpt-tasteskill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/gpt-tasteskill/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - L36: "*Cinematic Center (Highly Preferred):* Text perfectly centered, massive width."
    - L64: "Use deep radial blurs, grainy mesh gradients, or shifting dark overlays."
    - L23 (added at verification): "Every page MUST begin with a highly creative, premium Navigation Bar (e.g., floating glass pill, or minimal split nav)."
  - [skills/stitch-skill/SKILL.md and DESIGN.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/stitch-skill/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling files.
    - SKILL.md L51: "use only distinctive modern serifs: `Fraunces`, `Gambarino`, `Editorial New`, or `Instrument Serif`."
    - DESIGN.md L95: "Every active dashboard component has an infinite-loop state — Pulse on status dots, Typewriter on search bars, Float on feature icons, Shimmer on loading states"
  - [skills/brutalist-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/brutalist-skill/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - L28: "**Optimal Web Fonts:** Neue Haas Grotesk (Black), Inter (Extra Bold/Black), Archivo Black, Roboto Flex (Heavy), Monument Extended."
- **Limits / false positives:** The siblings are style presets meant for briefs that ask for that style. Their contradictions matter when they are installed or auto-invoked next to v2.

### FD01-F18 — v2's later hardening rules cite 18 unpublished builds that the author ran on Claude Opus 4.7; no anti-slop ban or threshold cites an external source or published data
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - The round-4 and round-5 hardening commits (d124aaf, 3c7017d, both 2026-05-26) cite the author's own test rounds (test-01 to test-18, "Opus 4.7 baseline") with counts: Fraunces or Instrument Serif "used in 9/12 tests", and the beige+brass palette "used in all 4 cookware tests". The CHANGELOG calls the em dash "the single most-violated stylistic Tell in pre-v2 testing".
  - Only those two rounds name tests. The commit that created v2 (56f8305, 2026-05-25) lists "Hardened production-tested bans" without test ids, and rules inherited from v1 (dials, typography, colour) cite nothing (corrected: the draft's title said v2's rules as a whole rest on the 18 builds).
  - The file does cite outside material, but not for its bans. Appendix B, "Canonical Sources (read these before reinventing)", links official design-system and MDN pages; Appendix C cites Apple's Liquid Glass docs; §4.5 and §8.B name WCAG AA without a link. None of these backs an anti-slop ban or a threshold (corrected: the draft said "no design rule cites an external source").
  - The repository contains no test prompts, outputs, scores or human-designed control set: there is no tests folder.
  - The README says the rules are "informed by dedicated research". The only research folder concerns output truncation (F19).
- **Implication for /frontend:**
  - This is the method /frontend should use, done in the open. Publish the corpus: the owner's past hackathon frontends as positives, human-designed sites as controls. Measure each rule's hit rate on both and keep the rules that separate them.
  - The Opus 4.7 tells may differ from those of the model running /execution (Opus 5.5 here), so re-measure on the current model.
- **Evidence:**
  - [Commit d124aaf](https://github.com/Leonxlnx/taste-skill/commit/d124aaf) — Leonxlnx, 2026-05-26, accessed 2026-09-30 — commit message.
    - "Recurring patterns identified across test-01 to test-12 (Opus 4.7 baseline):" … "Fraunces + Instrument_Serif banned as default (used in 9/12 tests)" … "Premium-Consumer Palette Ban: beige+brass+oxblood+espresso family banned with concrete hex codes (used in all 4 cookware tests)"
  - [Commit 3c7017d](https://github.com/Leonxlnx/taste-skill/commit/3c7017d) — Leonxlnx, 2026-05-26, accessed 2026-09-30 — commit message.
    - "feat(skill): round-5 hardening from test-13/14/15 + test-16/17/18 (all Opus 4.7)" … "Key recurring failures across 6 builds:"
  - [Commit 56f8305](https://github.com/Leonxlnx/taste-skill/commit/56f8305) — Leonxlnx, 2026-05-25, accessed 2026-09-30 (added at verification) — commit message.
    - "feat: promote v1.5 to default taste-skill, preserve v1 as taste-skill-v1" … "Hardened production-tested bans: section-number eyebrows, version labels, photo-credit captions, decoration hero strips, pills on images, locale strips, scroll cues, decorative dots, divider overuse"
  - [skills/taste-skill/SKILL.md, Appendix B](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 (added at verification) — the tool's own file.
    - L983: "# APPENDICES - Real Source-Backed Reference Material"; L1033: "## Appendix B - Canonical Sources (read these before reinventing)"
  - [CHANGELOG.md](https://github.com/Leonxlnx/taste-skill/blob/main/CHANGELOG.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — changelog.
    - "This was the single most-violated stylistic Tell in pre-v2 testing." … "Production testing showed the same Tells emerging across builds (em-dash everywhere, section-number eyebrows, "Quietly in use at", decorative dots, fake screenshots out of styled divs, broken GSAP scroll triggers)."
  - [README.md, Common Questions](https://github.com/Leonxlnx/taste-skill/blob/main/README.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — README.
    - "Multiple specialized variants, adjustable dials in key skills, anti-repetition rules informed by dedicated research."
- **Limits / false positives:** The counts are the author's own. Prompts, outputs and scoring are unpublished, the sample is 12 to 18 builds on one model, and there are no controls. Grade B is for "practitioner with a measurement" only.

### FD01-F19 — The repo's only research folder is about output truncation, and its headline figures are misattributed
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - `research/` covers "LLM Laziness" only.
  - It credits "Step-by-step instruction ('take a deep breath') | Accuracy: 34% to 80% on logic tasks" to a "Microsoft Research" study. That result is OPRO's, by Google DeepMind: in Table 1 of arXiv 2309.03409 on GSM8K, with PaLM 2-L as scorer, the empty instruction scores 34.0, "Take a deep breath and work on this problem step-by-step." scores 80.2, and "Let's think step by step." scores 71.8.
  - The research file also credits "+45% from a $200 tip" and "+115% combined" to EmotionPrompt/Microsoft Research. The EmotionPrompt abstract (arXiv 2307.11760) reports 8.00% on Instruction Induction, 115% on BIG-Bench and 10.9% in a human study, and mentions no tip.
  - `references.md` names studies ("LazyBench", "2025 Controlled Laziness Experiments") without authors, links or venues.
  - Community PR #108 proposed corrections and was closed by its own author.
- **Implication for /frontend:** The one place where the repo cites research has wrong attributions and framing. That is a concrete case for the family's rule: never import a rule or a number from a skill's prose without re-opening its source.
- **Evidence:**
  - [research/laziness/findings/empirical-results.md](https://github.com/Leonxlnx/taste-skill/blob/main/research/laziness/findings/empirical-results.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — the tool's own file.
    - "## Prompt Stimulus Effectiveness (Microsoft Research)" … "| Step-by-step instruction ("take a deep breath") | Accuracy: 34% to 80% on logic tasks |"
  - [research/laziness/findings/references.md](https://github.com/Leonxlnx/taste-skill/blob/main/research/laziness/findings/references.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — the tool's own file.
    - "**EmotionPrompt (Microsoft Research)** — Demonstrates that emotional and stakes-based prompt framing mathematically improves LLM reasoning quality and output length. Documents the +45% improvement from financial framing and +115% from combined stimuli."
  - [Large Language Models as Optimizers (OPRO)](https://arxiv.org/html/2309.03409) — Chengrun Yang et al., Google DeepMind; arXiv 2309.03409, first version 2023-09-07; accessed 2026-09-30 — paper (arXiv).
    - Table 1: "(empty string) 34.0 … PaLM 2-L-IT Take a deep breath and work on this problem step-by-step. 80.2" and "( Kojima et al., 2022 ) Let's think step by step. 71.8"; affiliation line: "Google DeepMind".
  - [Large Language Models Understand and Can be Enhanced by Emotional Stimuli](https://arxiv.org/abs/2307.11760) — Li, Wang, Zhang, Zhu, Hou, Lian, Luo, Yang, Xie; 2023-07-14; accessed 2026-09-30 — paper abstract.
    - "e.g., 8.00% relative performance improvement in Instruction Induction and 115% in BIG-Bench" … "we conducted a human study with 106 participants … (10.9% average improvement in terms of performance, truthfulness, and responsibility metrics)."
- **Limits / false positives:** I read the EmotionPrompt abstract, not the full paper. I did not search for "LazyBench". This folder concerns output completeness, not design, so it does not weaken the design rules directly. It weakens the README's "informed by dedicated research". Note added at verification: the "Microsoft Research" label is correct for EmotionPrompt itself. The paper's first page gives five of its nine authors (Jindong Wang, Kaijie Zhu, Wenxin Hou, Jianxun Lian, Xing Xie) the affiliation "Microsoft" ([arXiv PDF v7](https://arxiv.org/pdf/2307.11760v7), read at verification). The misattributions are OPRO's 34-to-80 figure and a "$200 tip +45%" figure that the abstract does not contain. "+115%" matches the abstract's BIG-Bench number; whether it comes from "combined" stimuli, as the repo says, was not checked in the full paper.

### FD01-F20 — At 1,206 lines and about 87K characters, v2 is 2.4 times Claude Code's recommended SKILL.md length, and its bans sit beyond what compaction keeps
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - v2 is 1,206 lines, 87,126 characters and 12,853 words. Issue #67 estimates it at about 22K tokens.
  - Claude Code's docs say to keep SKILL.md under 500 lines. They also say a loaded skill "stays in context across turns", with compaction as the exception below (corrected: the draft said "for the whole session", which the same docs qualify).
  - After auto-compaction, Claude Code re-attaches only the first 5,000 tokens of each invoked skill.
  - v2's §9 AI Tells heading starts at character 50,329 and §14's pre-flight heading at character 72,542, counted from 0 (corrected: the draft's 50,365 and 72,572 are the offsets of the ends of those heading lines). At roughly 3.5 to 4 characters per token, the first 5,000 tokens end near characters 17,500 to 20,000, inside §4.2 to §4.5.
- **Implication for /frontend:**
  - Suppose a long /execution build invokes the skill early and later compacts. It would keep the brief inference, the dials, the design-system map and part of §4, and lose the em-dash ban, the AI tells and the pre-flight.
  - /frontend's SKILL.md must stay short, and its bans must live in a checker that runs, not in prose that can be summarised away.
- **Evidence:**
  - [Character offsets computed on SKILL.md](https://raw.githubusercontent.com/Leonxlnx/taste-skill/3c7017d/skills/taste-skill/SKILL.md) — command run 2026-09-30 — OBSERVED.
    - Python over the file → `chars 87126 bytes 87253 lines 1206 words 12853`; `(595, 50365, '## 9. AI TELLS (Forbidden Patterns)')`; `(910, 72572, '## 14. FINAL PRE-FLIGHT CHECK')`; character 17,500 falls on line 207 and character 20,000 on line 226.
    - Re-run at verification: `t.find('## 9. AI TELLS')` → 50329 and `t.find('## 14. FINAL PRE-FLIGHT')` → 72542. The draft's figures add the heading lengths plus the newline (35+1 and 29+1). Line numbers, sizes and the 17,500 and 20,000 positions matched.
  - [Extend Claude with skills](https://code.claude.com/docs/en/skills) — Anthropic, Claude Code docs, accessed 2026-09-30 — official docs.
    - "Keep `SKILL.md` under 500 lines. Move detailed reference material to separate files."
    - "Once a skill loads, its content stays in context across turns, so every line is a recurring token cost."
    - "When the conversation is summarized to free context, Claude Code re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each. Re-attached skills share a combined budget of 25,000 tokens."
    - Added at verification, same page: "Claude Code fills this budget starting from the most recently invoked skill, so older skills can be dropped entirely after compaction if you have invoked many in one session." and "After compaction, Claude Code can keep only the start of an invoked skill, so put the most important instructions near the top of `SKILL.md`."
  - [Issue #67](https://github.com/Leonxlnx/taste-skill/issues/67) — Anneo22, 2026-07-01, open, accessed 2026-09-30 — community proposal.
    - "The flagship `SKILL.md` is ~87 KB (roughly 22K tokens)." … "Core: ~12 KB (~3.1K tokens), about a 7x cut in always-loaded size."
- **Limits / false positives:** The token boundary is an estimate; I did not run Anthropic's tokenizer. Invoking the skill again after compaction restores it.

### FD01-F21 — Users report that agents do not follow the rules reliably; community answers converge on validators and a completion gate
- **Grade:** D · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - One user reports that the agent never follows all the rules and still produces slop.
  - Two community replies recommend turning the rules into checks that run: static and structural validators, screenshot review for rules that need judgement, no self-approval by the coding agent, and a Claude Code Stop hook.
  - A reviewer lists the lack of automated checks as a limitation.
  - An open PR (#111) implements a small validator: text rules `no-em-dash`, `no-h-screen`, `no-scroll-listener`, `no-scroll-cue`, `no-placeholder-identity`, `no-ai-tell-copy`; structural rules `hero-max-four-text-blocks`, `hero-subtext-word-limit`, `one-design-system`. It leaves visual rules explicitly manual.
- **Implication for /frontend:** This matches the owner's plan: a deterministic slop checker (static and rendered) plus a screenshot review for judgement rules. PR #111's rule ids and its "static analysis boundaries" section are prior art to compare against.
- **Evidence:**
  - [Issue #106](https://github.com/Leonxlnx/taste-skill/issues/106) — xiNeRoar, 2026-09-03, open, accessed 2026-09-30 — user report.
    - "the agent never 100% all rule outlined in the skill. always return AI slop shit, how should i force it 100% obey all the steps and guide?"
    - Comment by dhruv-kashyap47, 2026-09-21: "Turn the skill into a **validation loop**, not a prompt." … "Never Let the Coding Agent Self-Approve"
    - Comment by MaxPrehoda, 2026-09-30: "Only some rules can be checked by a script. … "Don't make a generic SaaS hero" can't, so for those you still need a screenshot review, by you or by a second agent."
  - [Taste Skill Review — andrew.ooo](https://andrew.ooo/posts/taste-skill-anti-slop-ai-frontend-review/) — andrew.ooo, first published 2026-04-10 ("Last verified August 20, 2026"), accessed 2026-09-30 — practitioner review.
    - "No automated tests or visual regression. There's no way to verify the agent actually followed the rules short of reading the output. A future "taste-lint" tool would be a killer addition."
  - [PR #111](https://github.com/Leonxlnx/taste-skill/pull/111) and its [validator source](https://github.com/ThunderKhan/taste-skill/blob/6c183f1cf22b17167f6244e0b2bf8aefe49053ad/tools/lib/taste-check.mjs) — ThunderKhan, 2026-09-10, open, accessed 2026-09-30 — unmerged code.
    - "The goal is not to convert the entire Taste Skill into a linter. Many of its rules depend on visual judgment, context, interaction quality, or runtime behavior and cannot be reliably determined through static analysis."
    - `id: 'no-em-dash', severity: 'error', confidence: 'deterministic', … pattern: /—/g`
- **Limits / false positives:** This is one user's report. PR #111 is unreviewed: 0 reviews, and its one comment is a Codex bot reporting usage limits. Before any text rule runs, its `stripNonRenderableNoise()` blanks HTML comments, `/* */` and `//` comments, and fenced code in Markdown. So the em-dash rule does not match code comments. It can still match non-rendered strings such as console messages or data attributes. I read the code and did not run it (corrected: the draft said the pattern "also matches code comments"). MaxPrehoda's comment promotes his own repository, `MaxPrehoda/motif`: created 2026-09-16, 1 star, last pushed at 06:20 UTC, about 21 minutes before the 06:42 UTC comment.
    - `function stripNonRenderableNoise(content, extension) {` … `result = result.replace(/<!--[\s\S]*?-->/g, …)` … `result = result.replace(/\/\*[\s\S]*?\*\//g, …)` … `result = result.replace(/(^|[^:])\/\/[^\n]*/g, …)`; `runTextRules` applies every rule to `stripNonRenderableNoise(content, extension)` (taste-check.mjs @ 6c183f1, read at verification).

### FD01-F22 — Claude Code provides the enforcement hooks the taste-skill community is asking for
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - A `Stop` hook that exits with code 2 prevents Claude from stopping, and its stderr goes back to Claude as the reason. `SubagentStop` does the same for subagents.
  - Exit code 1 does not block.
  - Stop hooks receive `stop_hook_active`. Claude Code ends the turn after 8 consecutive continuations; `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises the cap.
  - Skills can declare hooks in frontmatter, but those hooks are not scoped to the skill's work. Claude Code registers them when the skill is invoked and keeps running them for the rest of the session, on later turns too. `once: true` removes a hook after its first successful run; a blocking run keeps it. Hooks in a subagent's frontmatter run only while that subagent runs, and a `Stop` hook there is converted to `SubagentStop` (corrected: the draft said skills "can declare hooks scoped to their own lifecycle").
  - The skills docs recommend hooks when Claude skips "a rule that must hold every time" (corrected: the draft quoted a sentence that is not on the page).
- **Implication for /frontend:**
  - Put the slop checker in the frontmatter of the frontend subagent that /execution dispatches: a `Stop` hook there becomes `SubagentStop` and ends with that subagent. It exits 2 with file:line findings, so no agent can declare the frontend done while checks fail.
  - Do not rely on a `Stop` hook in /frontend's own SKILL.md frontmatter for scoping. It would keep firing on every later stop in the session, including /harden and /prose turns, unless the script itself checks whether frontend files are in play. (corrected: the draft recommended a "skill-scoped `Stop` hook".)
  - Guard with `stop_hook_active`.
  - Plan for the 8-continuation cap by reporting unresolved findings rather than looping.
- **Evidence:**
  - [Hooks reference](https://code.claude.com/docs/en/hooks) — Anthropic, Claude Code docs, accessed 2026-09-30 — official docs.
    - "| `Stop` | Yes | Prevents Claude from stopping, continues the conversation |" … "| `SubagentStop` | Yes | Prevents the subagent from stopping |"
    - "For most hook events, exit code 2 is the only exit code that blocks through the code alone. Without valid JSON on stdout, Claude Code treats exit code 1 as a non-blocking error and proceeds with the action"
    - "Claude Code applies an 8-consecutive-continuation cap: after stop hooks have continued the turn eight times in a row, Claude Code overrides the next block and ends the turn."
    - Stop decision control: "A hook that blocks by exiting 2 routes the same way as `reason`: Claude receives the stderr message as the explanation for why it should continue."
    - Added at verification, hook locations table: "| [Skill](/docs/en/skills) frontmatter | The rest of the session once the skill is invoked." and "| [Subagent](/docs/en/sub-agents) frontmatter | While that subagent is running |"
    - Added at verification, "Hooks in skills and agents": "**Subagent hooks**: Claude Code runs them only while that subagent is running and removes them when it finishes. Claude Code converts a `Stop` hook here to `SubagentStop`, the event it fires when a subagent completes." / "**Skill hooks**: Claude Code registers them when you or Claude invoke the skill and keeps running them for the rest of the session, on turns after the skill's own turn as well. To have Claude Code remove a hook after its first successful run instead, set [`once: true`](#common-fields) on it."
    - Added at verification: "To raise the cap, set [`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`](/docs/en/env-vars)."
  - [Extend Claude with skills](https://code.claude.com/docs/en/skills) — Anthropic, accessed 2026-09-30 — official docs.
    - Frontmatter table as read at verification: "| `hooks` | No | Hooks that Claude Code registers when the skill is invoked and keeps running for the rest of the session." The draft's quote "Hooks scoped to this skill's lifecycle." was not on the page.
    - Troubleshooting, as read at verification: "**Claude skipped a rule that must hold every time**: move the rule into a [hook](/docs/en/hooks-guide). Claude Code runs a hook every time its event occurs, such as before each file edit, whether or not Claude is following the skill. To keep the rule with the skill, define the hook in the skill's [`hooks` frontmatter](/docs/en/hooks#hooks-in-skills-and-agents). That hook applies from the time the skill is invoked until the session ends." The draft's quote "Strengthen the skill's `description` and instructions so the model keeps preferring it, or use hooks to enforce behavior deterministically." was not on the page.
- **Limits / false positives:** This is harness behaviour, not part of taste-skill. How it interacts with /execution's wave scheduling needs its own design.

### FD01-F23 — In one blind arena judged by AI, design-taste-frontend tied Anthropic's frontend-design at 8.0/10 while using about 6 times the context, and it had the lowest distinctiveness of the three leaders
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - Happycapy's Skill Arena ran 6 skills on 3 tasks with Claude Sonnet 5. Two blind AI judges scored 5 axes.
  - design-taste-frontend averaged 8.0 (landing 8.0, portfolio 8.0, dashboard 8.0), tied with frontend-design (Anthropic) and superdesign.
  - Its axis scores: task completeness 9.0; distinctiveness 7.3, against 8.0 for frontend-design and 7.8 for superdesign.
  - Context processed across the 3 tasks: 1.9M tokens, against 320K for frontend-design and 65K for superdesign.
  - The sibling high-end-visual-design (soft-skill) scored 6.5.
  - The judges praised a pattern the owner lists as a tell: high-end-visual-design's "italic serif headings" (tell #18), scored 8.5. The portfolio winner's "oversized serif nameplate", also 8.5, is a serif display choice. v2 itself discourages serif as a default (L173-174), but a nameplate is not an italic accent, so it is not one of the owner's 20 tells as worded (corrected: the draft counted both as the owner's tells).
- **Implication for /frontend:**
  - Generic AI-judge "polish" scores reward what the owner calls tells, so /frontend's gate must detect the owner's tells directly, not ask an LLM for a quality score.
  - The token cost confirms F20: load a short skill and run a checker instead.
- **Evidence:**
  - [Best Frontend design AI Skills, Compared — Skill Arena](https://happycapy.ai/skill-arena/frontend-design) — Happycapy, undated page, accessed 2026-09-30 — vendor benchmark.
    - "Model: Claude Sonnet 5 6 competitors 3 tasks 2 blind judges"
    - "| design-taste-frontend | 8.0 | 8.0 | 8.0 | 8.0 |" … "| frontend-design | 7.0 | 8.5 | 8.5 | 8.0 |"
    - design-taste-frontend: "Task completeness 9.0 Distinctiveness 7.3" … "Watch out: Its ~87K-character SKILL.md makes it by far the most token-expensive to run."
    - "frontend-design quality #1 Generated 43K Context 320K" … "design-taste-frontend quality #2 Generated 60K Context 1.9M"
    - "Striking oversized serif nameplate, refined restraint, jewel-tone thumbnails" … "Cohesive warm earthy palette, italic serif headings, quote pull, muted card art"
    - "Limitations. This arena is a single run on Claude Sonnet 5 with 3 tasks, scored by AI judges rather than crowd votes."
- **Limits / false positives:** Happycapy sells runs of these skills, so it is vendor-run. It is one run with 3 tasks and 2 AI judges. No quality score is shown for a no-skill baseline; the page mentions one only for cost ("the no-skill baseline is cheapest").

### FD01-F24 — The repo's only showcase, Floria, predates v2 and shows several of the owner's tells
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - The README presents two Floria screenshots as "Created with taste-skill". They were committed on 2026-03-01, before v2 became the default on 2026-05-25.
  - Top screenshot:
    - a pill label "STUDIO & ARCHIVE" above the H1 (tell #9);
    - a second H1 line, "Architecture.", set in a lighter italic;
    - a "VIEW COMPLETE ARCHIVE ↗" link floated to the right of a section heading. v2 does not clearly ban this. Its floating-sub-text ban (L674) targets "a small explainer paragraph", and its split-header ban (L258) allows the right column when it "carries a visual or interactive element". A link is interactive (corrected: the draft said "a pattern v2 later banned");
    - circled step numbers "01", "02", "03".
  - Bottom screenshot:
    - a section heading "Clarity." and a footer tagline "Architecture of Nature", both in serif italic (tell #18);
    - five-star testimonial cards attributed to named people, with praise copy such as "A profound paradigm shift." and "The performance is staggering, yet serene." (tell #17, and invented social proof);
    - small green dots before the footer column headings, which v2 later banned as decorative.
- **Implication for /frontend:**
  - The v1 rules did not prevent these patterns. v2 added bans for some of them: decorative dots (L646, L683) and serif discipline, including the ban on mixed-family emphasis (L173-180). v2 would still allow Floria's single pill above the H1 (one eyebrow in the hero, L240). The repo publishes no v2 showcase to show the fix working (corrected: the draft also listed "floated sub-text", which does not match Floria's floated link). tasteskill.dev shows a second project, "Collective OS", labelled "a Technical UI project built with Taste Skill", with no version or date.
  - /frontend's calibration corpus needs before-and-after outputs on the same brief, not a single curated screenshot.
- **Evidence:**
  - [README.md, Examples](https://github.com/Leonxlnx/taste-skill/blob/main/README.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — README.
    - "Created with taste-skill:"
  - [Commit 4e2cf5a](https://github.com/Leonxlnx/taste-skill/commit/4e2cf5a) — Leonxlnx, 2026-03-01, accessed 2026-09-30 — commit log.
    - `gh api "repos/Leonxlnx/taste-skill/commits?path=examples/floria-top.webp"` → `4e2cf5a 2026-03-01T00:38:33Z | restructure: split into 3 independent skills, professional research docs, and example screenshots`
  - [examples/floria-top.webp](https://github.com/Leonxlnx/taste-skill/blob/main/examples/floria-top.webp) and [examples/floria-bottom.webp](https://github.com/Leonxlnx/taste-skill/blob/main/examples/floria-bottom.webp) — Leonxlnx, accessed 2026-09-30 — screenshots, converted to PNG with Pillow and viewed.
    - Visible text includes "STUDIO & ARCHIVE", "Botanic Architecture.", "VIEW COMPLETE ARCHIVE", "Clarity.", "Elegant, fluid, and brilliantly executed. It stands out by whispering instead of shouting. A profound paradigm shift.", "Architecture of Nature".
- **Limits / false positives:** This is my visual reading of two screenshots. Fonts cannot be identified from pixels, and the showcase may have been edited by hand. At verification I re-rendered both files (1906×3724 and 1906×3725) in four crops each and confirmed every item: the pill, the lighter italic second H1 line, the floated link, the circled 01-03, the serif-italic "Clarity." and green serif-italic footer tagline, the five-star named testimonials with the quoted copy, and the green dots before "Archive", "Studio" and "Contact".

### FD01-F25 — taste-skill's "image to code" generates images first and targets Codex; it is not screenshot-to-code, but its extraction checklist is reusable, and its brandkit forbids copying exact compositions
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - `image-to-code` is described as a skill "for Codex". It requires the agent to generate its own section images first, then analyse them and code to match them ("visually faithful").
  - It makes image-first conditional on image generation being available (L59, L383, L392, L1118) and accepts direct code first when the user already provides a precise design system (L407-411). It does not spell out a no-generator path; "direct code" in that case is an inference from the conditionals (corrected: the draft stated the no-generator fallback as the skill's own rule).
  - Its extraction lists (§21 to §25: text, typography, spacing, buttons and components, colour) are a structured way to read any reference image.
  - The README pairs the image skills with "ChatGPT Images or similar generators".
  - `brandkit` says to learn from references without copying the exact logo, brand name, composition, slogan or unique assets.
  - In this Claude Code session the Read tool displays images, and no image-generation tool exists.
- **Implication for /frontend:** The owner's plan is to take the sponsor-customers' websites, draw on them and copy some aspects through image to code. That maps onto four steps:
  - Playwright screenshots of the reference sites at fixed viewports;
  - Claude reads the screenshots;
  - the image-to-code extraction checklist is applied;
  - the result becomes design tokens and layout rhythm for /frontend.

  Copy the system (type scale, spacing rhythm, density, component shapes), not the composition, logos, copy or illustrations. This matches brandkit's rule and the Claude Design rule "no other company's proprietary design" noted in the brief.
- **Evidence:**
  - [skills/image-to-code-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/image-to-code-skill/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - L3: "Elite website image-to-code skill for Codex. For visually important web tasks, it must first generate the design image(s) itself, deeply analyze them, then implement the website to match them as closely as possible."
    - L407-411: "Direct-code first is more acceptable only when: - the task is mostly technical - the user wants a bug fix - the user already provides a precise design system - the task is mainly structural rather than visual"
    - L852-856: "The goal is not: - inspired by the image" … "The goal is: - visually faithful to the image, translated into real frontend"
    - Added at verification: L59 "Do not skip image generation when image generation is available."; L383 "Begin by creating the visual references first whenever image generation is available."; L1118 "if image generation is available and visual quality is central, generate the design image(s) first"; section headings L721-814 "## 21. TEXT EXTRACTION RULE" … "## 25. COLOR EXTRACTION RULE".
  - [README.md](https://github.com/Leonxlnx/taste-skill/blob/main/README.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — README.
    - "Pair them with **ChatGPT Images** or similar generators, then hand the frames to Codex, Cursor, or Claude Code for implementation."
  - [skills/brandkit/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/brandkit/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - "Do not copy: - exact logo - exact brand name - exact composition - exact slogan - unique visual asset" … "Use references as quality training, not as templates."
  - Claude Code Read tool, this session's tool description — Anthropic, observed 2026-09-30 — OBSERVED.
    - "Reads images (PNG, JPG, …) and presents them visually." I read the Floria PNGs this way; the session's tool list has no image-generation tool.
- **Limits / false positives:** The skill's "visually faithful" instruction applies to images the agent generated itself. Applied to a real company's site, the same fidelity would copy proprietary design.

### FD01-F26 — For the logo and favicon, taste-skill offers concept methods and restrictions, not an SVG or favicon pipeline
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - v2 strongly discourages hand-rolled SVG logos. It allows them when the brief explicitly asks for one, when the mark is a single simple geometric shape, or when the agent is "confident in the output quality". It bans hand-rolled SVG icons outright.
  - `brandkit` generates raster boards only. It gives five logo concept methods and an avoid list: generic lightning bolts, random animals, fake crests, copied marks, clipart, meaningless sparkles.
  - `redesign-skill` asks for "a branded favicon" and for title, description and og:image meta tags, with no specification.
- **Implication for /frontend:**
  - The protocol logo falls under v2's "brief explicitly calls for it" exception.
  - Borrow brandkit's five methods and its avoid list as a concept checklist.
  - The SVG construction, its optimisation (svgo is not installed here), the favicon set and the og:image need their own dossier and pipeline.
- **Evidence:**
  - [skills/taste-skill/SKILL.md §3.C, §4.8](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) — Leonxlnx, v2 @ 3c7017d, accessed 2026-09-30 — the tool's own file.
    - L143: "**NEVER hand-roll SVG icons.** If a glyph is missing, install a second library or compose from primitives - do not draw icon paths from scratch."
    - L285-288: "Hand-rolled decorative SVGs (custom illustrations, logos, marks): **strongly discouraged**, never as default. Acceptable only when: - The brief explicitly calls for it ("draw me an SVG logo") - It's a single, simple geometric mark (a square, a circle, a wordmark in display type) - You're confident in the output quality"
  - [skills/brandkit/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/brandkit/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - Headings "## 1. Monogram + Meaning", "## 2. Product Action", "## 3. Metaphor Fusion", "## 4. Negative Space", "## 5. Construction Geometry"; "Avoid: - generic lightning bolts unless strongly justified - random animals - fake luxury crests - copied famous marks - overcomplicated symbols - clipart-style icons - meaningless sparkles - inconsistent logo variants"
  - [skills/redesign-skill/SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md) — Leonxlnx, main @ ce26fc2, accessed 2026-09-30 — sibling file.
    - L109: "**Missing favicon.** Always include a branded favicon." … L121: "**Missing meta tags.** Add proper `<title>`, `description`, `og:image`, and social sharing meta tags."
- **Limits / false positives:** brandkit targets image generators; nothing in the repo produces or validates an SVG.

### FD01-F27 — The most substantive community critique: coupling to React and Next, the one-accent lock against semantic colours, and "all hard bans" weakening enforcement; plus a proposal to split the file 7 ways
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Issue #86 (open, no maintainer reply) argues three points:
  - §3 hard-codes RSC, Tailwind v4, `next/font`, Motion and GSAP, contradicting the README's framework-agnostic claim;
  - the one-accent lock suppresses legitimate status colours;
  - a document made mostly of hard bans risks over-suppression, and once the agent overrides one ban it may treat the whole document as advisory. It proposes a small objective hard core plus judged defaults.

  Issue #67 proposes a thin core and reference files, a 7x cut.
- **Implication for /frontend:**
  - Separate design rules that do not depend on the stack from stack code.
  - Exempt semantic status colours from any accent lock.
  - Keep a two-tier structure. The hard core: em-dash density, fake product UIs, invented identities, unlabelled numbers, contrast. The calibrated defaults: aesthetic bans. The owner's /prose already uses tiers.
- **Evidence:**
  - [Issue #86](https://github.com/Leonxlnx/taste-skill/issues/86) — ag-linden, 2026-07-23, open, accessed 2026-09-30 — community critique.
    - "An agent applying the skill to a Vue, Svelte, SolidStart, or vanilla project inherits instructions that do not fit, and either silently mis-applies them or has to discard a chunk of the document."
    - "Read literally, the lock tells the agent to suppress a red validation state because the page accent is emerald."
    - "Once the agent hits one ban it must override, it can start treating the whole document as advisory, which weakens the bans that should be absolute."
  - [Issue #67](https://github.com/Leonxlnx/taste-skill/issues/67) — Anneo22, 2026-07-01, open, accessed 2026-09-30 — community proposal.
    - "If a rule must fire every single time, deferring it weakens enforcement. So I kept the enforcement-critical rules in the always-on core"
- **Limits / false positives:** There is no maintainer response and no data on either side.

### FD01-F28 — Secondary write-ups misstate the skill; the more careful reviewers call the evidence thin and recommend pinning
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - andrew.ooo says the repo has no license file; an MIT LICENSE exists.
  - kondasamy.com says the skill flags a `#7C3AFF` to `#3B82F6` gradient, and it shows a Motion "canonical sticky-stack" snippet. Neither appears in the skill: §5.A uses GSAP, `#7C3AFF` occurs nowhere, and `#3B82F6` appears only as a recommended accent in stitch DESIGN.md.
  - soymarketingultra (2026-09-23) says the evidence is limited and advises testing from a pinned commit.
  - limpidreviews notes that installs pull the main branch with no pinning.
- **Implication for /frontend:** Blog summaries are not the source, which is the family's rule. Use only the repository files at a SHA.
- **Evidence:**
  - [andrew.ooo review](https://andrew.ooo/posts/taste-skill-anti-slop-ai-frontend-review/) — andrew.ooo, 2026-04-10, "Last verified August 20, 2026", accessed 2026-09-30 — practitioner review.
    - "No official license file. The repo doesn't ship an SPDX license header."
  - [Taste Skill: Teaching AI Agents to Stop Building the Same Purple Landing Page](https://kondasamy.com/blog/2026/taste-skill-anti-slop-frontend-framework/) — Kondasamy Jayaraman, 2026-07-04, accessed 2026-09-30 — blog.
    - "AI Purple (the `#7C3AFF` to `#3B82F6` gradient) is flagged as an LLM tell" … "// Taste Skill's canonical sticky-stack pattern (motion/react)"
    - `grep -rn -i "7C3AFF\|3B82F6" skills/` → only `skills/stitch-skill/DESIGN.md:34:- **Electric Blue** (#3B82F6) — For productivity, SaaS, developer tools`
  - [Taste Skill: AI Web Design Controls Reviewed](https://soymarketingultra.com/en/taste-skill-ai-web-design/) — Daniel Espinosa Ramos, 2026-09-23, accessed 2026-09-30 — review.
    - "Limited evidence: the documentation explains the approach, not an independent comparison of outcomes." … "To run a reproducible test, work from a specific commit and save that identifier."
  - [Taste Skill (B-) — Limpid](https://limpidreviews.fyi/tools/taste-skill) — Limpid, reviewed 2026-04-30, accessed 2026-09-30 — review.
    - "Installation via 'npx skills add Leonxlnx/taste-skill' fetches from the main branch with no version pinning or lockfile"
- **Limits / false positives:** Some statements were true when written. The LICENSE file was added on 2026-04-28 (commit 75dc4f0), after andrew.ooo's first run on 2026-04-10. Notes added at verification:
  - andrew.ooo still carries the no-license line under "Last verified August 20, 2026", and its own TL;DR says "MIT-style repo".
  - limpidreviews' "no version pinning or lockfile" describes the README's command. The skills CLI has kept an update-tracking `.skill-lock.json` since 2026-01-22 (vercel-labs/skills #85). It installs from a full commit SHA since 2026-09-06 (#1439, see F04).

### FD01-F29 — Other widely used anti-slop design skills, for sibling dossiers to cross-check
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** GitHub API metadata read 2026-09-30. Descriptions come from each repository's description or frontmatter. None was deep-read.

  | Skill / repository | Stars | Last push | License | What it is |
  |---|---|---|---|---|
  | [anthropics/skills, frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | 179,155 (repo) | 2026-09-29 | LICENSE.txt in the skill folder; the repo reports no SPDX license | "Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one." SKILL.md last changed 2026-09-03, "Update frontend-design skill to avoid generic design defaults (#1713)". |
  | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | 72,939 | 2026-09-30 | Apache-2.0 | "The design language that makes your AI harness better at design." |
  | [emilkowalski/skills](https://github.com/emilkowalski/skills) | 42,398 | 2026-09-23 | MIT | "Skills for Designers and Engineers." `repos/emilkowalski/skill` redirects here. |
  | [vercel-labs/agent-skills, web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | 31,762 (repo) | 2026-08-28 | none reported | "Review UI code for Web Interface Guidelines compliance." |
  | [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | 118,949 | 2026-09-21 | MIT | "A collection of DESIGN.md files analysis by popular brand design systems." |
  | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 131,967 | 2026-09-27 | MIT | "An AI skill that provides design intelligence for building professional UI/UX across multiple platforms." |
  | [superdesigndev/superdesign-skill](https://github.com/superdesigndev/superdesign-skill) | 619 | 2026-08-21 (corrected: the draft gave 2026-09-30, the API's `updated_at`, not the push date) | MIT (corrected: the draft said "not checked") | "Stop shipping AI-slop UI." The same organisation has `superdesign-extension`, "clones any website into a single self-contained HTML file", AGPL-3.0. |
  | [senlindesign/taste-skill](https://github.com/senlindesign/taste-skill) | 372 | 2026-07-07 | none | "reverse-engineer any website's design taste: concrete tokens + opinionated trade-offs". Relevant to the customer-site idea. |
  | [codeswithroh/tastemaker](https://github.com/codeswithroh/tastemaker) | 428 | 2026-09-29 | MIT | "grounds AI-generated UI in real reference images and a persistent per-developer taste profile". |
  | [educlopez/ui-craft](https://github.com/educlopez/ui-craft) | 365 | 2026-09-03 | MIT | listed in hesreallyhim/awesome-claude-code with "deterministic MCP gates and CLI". |
  | [MaxPrehoda/motif](https://github.com/MaxPrehoda/motif) | 1 | 2026-09-30 | MIT | design tokens plus `design-lint.mjs`, proposed as a Stop hook in issue #106. |
  | [h3nryprod01/design-taste](https://github.com/h3nryprod01/design-taste) | 60 | 2026-09-25 | MIT | "a merged synthesis of emilkowalski/skill, pbakaus/impeccable, and leonxlnx/taste-skill". |

  Evaluations:
  - the Happycapy Skill Arena (opened, F23);
  - [dani-z/frontend-design-skill-benchmark](https://github.com/dani-z/frontend-design-skill-benchmark), 24 stars. The repo is confirmed through the API; its README was seen only as search excerpts.

  Curated lists:
  - `travisvn/awesome-claude-skills` lists Anthropic's frontend-design;
  - `ComposioHQ/awesome-claude-skills` and `hesreallyhim/awesome-claude-code` show no line matching "taste" for taste-skill itself.
- **Implication for /frontend:**
  - Several of these are the owner's named tools: impeccable, Emil Kowalski, web design guidelines, awesome design md.
  - Others fill gaps this dossier found:
    - site-taste extraction (senlindesign);
    - site cloning, with an AGPL caution (superdesign-extension);
    - deterministic gates (ui-craft, motif);
    - comparative benchmarks.
- **Evidence:**
  - [GitHub API metadata](https://api.github.com/repos/pbakaus/impeccable) — GitHub, accessed 2026-09-30 — API reads.
    - `gh api repos/<each>` → the star, push and license fields in the table; `gh api repos/emilkowalski/skill` → `emilkowalski/skills`.
  - [anthropics/skills frontend-design SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) — Anthropic, SKILL.md last changed 2026-09-03, accessed 2026-09-30 — frontmatter.
    - "description: Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults."
  - [travisvn/awesome-claude-skills README](https://github.com/travisvn/awesome-claude-skills) — travisvn, accessed 2026-09-30 — curated list.
    - L78: "**[frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design)** - Instructs Claude to avoid "AI slop" or generic aesthetics and to make bold design decisions."
- **Limits / false positives:** This is metadata only. Stars are attention, and the descriptions are the authors' own claims. At verification (`gh api repos/<each>`), star counts were within daily drift: at most 14 above the draft (impeccable 72,953, awesome-design-md 118,954, ui-ux-pro-max-skill 131,977). Every push date, license and description matched except superdesign-skill's. `superdesign-extension` has 5 stars and was last pushed 2026-07-03.

### FD01-F30 — GreenSock's own agent skills state the pinning and reduced-motion rules that taste-skill's skeletons break, but their horizontal-scroll example is itself broken (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:**
  - `greensock/gsap-skills` is GreenSock's own repository: an organisation account, MIT, 15,835 stars, created 2026-03-04, last pushed 2026-07-29. It calls itself "Official AI skills for GSAP".
  - Its `gsap-scrolltrigger` skill states the rule that taste-skill's §5.A breaks: "Don't animate the pinned element itself; animate children." Its horizontal-scroll recipe animates content inside the pinned panel and gives a function-based `x` as the example value.
  - Its `gsap-core` skill handles reduced motion with `gsap.matchMedia()` and a `(prefers-reduced-motion: reduce)` condition. When the query stops matching, the animations and ScrollTriggers created in that run are reverted.
  - Its own horizontal-scroll code has defects:
    - `xPercent: () => Max.max(0, window.innerWidth - scrollingEl.offsetWidth)` calls `Max.max`. `Max` is not a JavaScript built-in and the example does not define it; the intended call is `Math.max`.
    - That expression is a pixel difference, but `xPercent` takes a percentage.
    - Even with `Math.max`, `max(0, negative)` is 0 once the content is wider than the viewport, so nothing would move.
    - Step 1 says "trigger = the full-viewport panel", and the caveats say "Avoid animating the trigger element itself horizontally; animate a child". Yet the example's `trigger` is the element it animates.
  - GSAP's official forum gives the issue #112 advice against `position: sticky` on pinned elements in substance (F13).
- **Implication for /frontend:**
  - If /frontend ever ships GSAP, take rules from `greensock/gsap-skills` pinned at a SHA, take code from the GSAP docs pages (F13), and copy neither skill's snippets.
  - Test every scroll-pinned section in Playwright at two viewports and with reduced motion emulated. Check that all panels stay reachable, because even the vendor's skill ships a broken example.
  - This is one more case for the family rule: a skill's prose, even a vendor's, is not a source until re-opened.
- **Evidence:**
  - [greensock/gsap-skills](https://github.com/greensock/gsap-skills) — GreenSock, API read 2026-09-30, accessed 2026-09-30 — repository metadata.
    - `gh api repos/greensock/gsap-skills` → `"created_at":"2026-03-04T17:22:35Z","description":"Official AI skills for GSAP. These skills teach AI coding agents how to correctly use GSAP (GreenSock Animation Platform), including best practices, common animation patterns, and plugin usage.","license":"MIT","owner_type":"Organization","pushed_at":"2026-07-29T17:36:08Z","stars":15835`
  - [skills/gsap-scrolltrigger/SKILL.md](https://github.com/greensock/gsap-skills/blob/main/skills/gsap-scrolltrigger/SKILL.md) — GreenSock, last changed 2026-03-09 by commit 96c4b01, accessed 2026-09-30 — the vendor's own skill.
    - L54: "| **pin** | Boolean \| String \| Element | Pin an element while active. `true` = pin the trigger. Don't animate the pinned element itself; animate children. |"
    - L226-227: "1. Pin the section (trigger = the full-viewport panel)." / "2. Build a tween that animates the inner content’s **x** or **xPercent** (e.g. to `x: () => (targets.length - 1) * -window.innerWidth` or a negative `xPercent` to move left)."
    - L235-239: `xPercent: () => Max.max(0, window.innerWidth - scrollingEl.offsetWidth),` … `trigger: scrollingEl,` / `pin: scrollingEl.parentNode, // wrapper so that we're not animating the pinned element`
    - L257: "**Caveats:** Pinning and snapping are not available on ScrollTriggers that use **containerAnimation**. … Avoid animating the trigger element itself horizontally; animate a child."
  - [skills/gsap-core/SKILL.md](https://github.com/greensock/gsap-skills/blob/main/skills/gsap-core/SKILL.md) — GreenSock, accessed 2026-09-30 — the vendor's own skill.
    - L208: "**gsap.matchMedia()** (GSAP 3.11+) runs setup code only when a media query matches; when it stops matching, all animations and ScrollTriggers created in that run are **reverted automatically**."
    - L222: `reduceMotion: "(prefers-reduced-motion: reduce)"`
  - [GSAP forum, topic 39480](https://gsap.com/community/forums/topic/39480-problem-with-horizontal-scrolling-scrolltrigger-and-sticky-element/) — Cassie, 2024-01-04, marked as the solution, accessed 2026-09-30 — official forum.
    - "TLDR - CSS sticky doesn't play nicely with this. The solution is to use GSAP's pinning abilities instead."
- **Limits / false positives:** I read the files and did not run the example; the `Max.max` call would throw a ReferenceError when GSAP evaluates the function, but I did not confirm that in a browser. Forum answers are not documentation, and I did not verify the responders' roles at GreenSock.

## Contradictions between sources

1. **Framework claim.** The README FAQ says "Rules target design intent, not a single framework API". v2 §3 hard-codes React/Next, Tailwind v4, `next/font`, Motion and GSAP (issue #86; andrew.ooo also notes "React/Next.js lock-in in examples").
2. **Serif bans.** v2 §4.1 bans Fraunces and Instrument Serif as defaults (L180). stitch-skill (SKILL L51; DESIGN.md L104) and minimalist-skill (L27) recommend them. redesign-skill (L22) says "pair a serif header with a sans-serif body".
3. **Eyebrows.** v2 caps eyebrows at one per three sections (L254). soft-skill requires a pill eyebrow before every major H1 and H2 (L52).
4. **Status dots.** v2 sets "ZERO decorative status dots by default" (L683). stitch DESIGN.md prescribes "Pulse on status dots" (L95). v1 put infinite animations on "status dots" (v1 L70).
5. **Scroll reveals.** v2 makes scroll reveals canonical (§5.C) and mandatory above MOTION 4 (L359). soft-skill and minimalist-skill require them on every block. The owner lists fade-in on scroll as a tell.
6. **Motion properties.** v2 §6.A says "Animate ONLY `transform` and `opacity`" (L522). v2 §7 prescribes `transition: all 0.3s` (L562). PR #126 raises this.
7. **GSAP skeletons.** v2 §5.A animates the pinned element; GSAP's docs say not to. v2 §5.B uses a static `x` with `invalidateOnRefresh`; GSAP's tips say values must be function-based.
8. **Untraced GSAP wording, supported substance.** Issue #112 quotes GreenSock: "Never apply CSS position: sticky to an element that is being pinned by ScrollTrigger." PR #124 repeats it as "GSAP's documented guidance". I did not find that wording on the ScrollTrigger docs page or on the "tips & mistakes" page. GSAP's official forum gives the same advice: Cassie, 2024-01-04, accepted solution, "CSS sticky doesn't play nicely with this. The solution is to use GSAP's pinning abilities instead."; mvaneijgen, 2025-11-05, "you should not use position: sticky". (corrected: the draft headed this "Unsupported GSAP quote"; see F13 and F30.)
9. **Large-text threshold.** v2 §4.5 gives "3:1 for large text 18px+". WCAG 2.2 defines large text as 18pt (about 24px) or 14pt bold (about 18.5px).
10. **AA versus AAA.** v2 §6.C says "WCAG AA contrast (AAA for body)". v2 §8.B says "WCAG AA minimum for body text, AAA target for hero copy".
11. **Invented numbers.** v2 §9.D says "Use organic, messy data (`47.2%`…)". v2 §4.9 bans "AI-invented spec aesthetics" unless the numbers are real or labelled mock.
12. **Em dash, zero versus density.** taste-skill bans every em dash. The owner's /prose PR-01 fires above 2.0 em dashes per 1000 words, calibrated on a human corpus measured at 0.0 to 0.5 (`~/.claude/skills/prose/scripts/prose_check.py`: "Measured: 0.0 per 1000 words across ripgrep, esbuild, curl, svelte and Diataxis; 0.5 in the Rust book").
13. **Research attributions.** taste-skill's research credits "34% to 80%" and "+45%/+115%" to Microsoft Research. The 34.0 to 80.2 figure is from OPRO (Google DeepMind), measured on GSM8K from an empty instruction; the step-by-step baseline was 71.8. The EmotionPrompt abstract reports 8.00%, 115% and 10.9%, and no tip. Five of EmotionPrompt's nine authors list Microsoft, so the "Microsoft Research" label fits that paper; it does not fit the OPRO number attached to it (note added at verification).
14. **Folder name versus frontmatter name.** PR #108 (2026-09-07) says Claude Code registers plugin skills by folder name. Its test copied two skills into a scratch project, where a fresh session listed the folder names. The docs as read on 2026-09-30 say the opposite for project skills: "`name` sets the command that the `/` menu shows and that you type", and "The directory name also invokes the skill". For plugin skills, the docs say "`name` sets the last segment of the command and the plugin prefix stays in place". Claude Code's changelog records three plugin-naming changes: v2.1.94 (frontmatter `name` replaces the directory basename for `"skills": ["./"]` plugins), v2.1.216 ("Fixed plugin skills with a `name` frontmatter field losing their plugin prefix in slash-command autocomplete") and v2.1.246 (fixed a doubled prefix). PR #108 does not state its Claude Code version, so the conflict is unresolved. (corrected: the draft said the docs give the directory name as the command for project skills, and that the plugin `name` behaviour "changed at v2.1.216"; the docs say `name` sets the command, and v2.1.216 is a prefix fix.)
15. **Registry versus GitHub.** skills.sh shows 84.0K stars and 14 skills, including `image-taste-frontend`. The GitHub API shows 91,510 stars, and the tree has 13 skills.
16. **Tuning the dials.** andrew.ooo says there is "No official license file" and advises tuning by editing "the first block of skills/taste-skill/SKILL.md". The repo has an MIT LICENSE, and v2 says "Do not ask the user to edit this file - overrides happen conversationally" (L51). The repo's own README still says "Numbers at the top of the file are 1-10 dials" (Settings section), which invites the editing v2 rules out (note added at verification).
17. **kondasamy.com.** It quotes a Motion sticky-stack "canonical" snippet and a `#7C3AFF` to `#3B82F6` rule. Neither is in the skill, and `#3B82F6` is a recommended accent in stitch DESIGN.md.
18. **Line count.** The tasteskill.dev changelog says v2 is "Around 900 lines". The file has 1,206.
19. **CLI link.** The README links the `npx skills add` CLI to `vercel-labs/agent-skills`. The CLI is `vercel-labs/skills`.
20. **Corner radius.** redesign-skill says "Uniform border-radius on everything. Vary the radius" (L53). v2's Shape Consistency Lock requires one radius system (L217).
21. **gpt-taste.** It prefers "Cinematic Center (Highly Preferred)", while v2 avoids a centered hero above VARIANCE 4 unless the brief is editorial, manifesto or launch-announcement (L210-211). Its "deterministic seed (e.g., character count of the user prompt modulo math)" (L15) also produces the same page for the same brief, which contradicts its own "forbidden from defaulting to the same UI twice" (L20). (corrected: the draft said v2 "bans" a centered hero, and cut "modulo math" from inside the quoted parenthesis.)
22. **AI judges versus the owner's tells.** Happycapy's AI judges gave the top portfolio scores (8.5 each) to an "oversized serif nameplate" and to "italic serif headings". Only the italic serif headings match the owner's tell #18; the nameplate is a serif display choice that v2 discourages but the owner's list does not name. (corrected: the draft counted both as tell #18.)

## What could not be found, and how it was searched

- **Data behind v2's "production tests" (test-01 to test-18):** no prompts, outputs or scores. Searched the full repository tree through the GitHub API (no tests folder), the commit messages for SKILL.md, the README, the CHANGELOG, tasteskill.dev and its changelog, and the open issues. Not found.
- **An independent evaluation of design-taste-frontend against a no-skill baseline, with numbers:** searched Exa ("blind comparison experiment frontend design skills taste-skill impeccable frontend-design same prompt results rated"), WebSearch ("taste-skill" claude code frontend slop review) and Exa ("taste-skill Leonxlnx review criticism"). Only the Happycapy arena was opened; it shows no baseline quality score. Seen in search results but not opened: ui-design-bench.vercel.app, vaporaviator.com "We Tested 80+ Open-Source Design Skills", Jaksenc/taste, openvibeeval.com. At verification I opened the VaporAviator article (dated 2026-08-02 on its blog index). It is a wall of screenshots from one shared prompt with "no hand-picking", and it gives no scores and no no-skill baseline.
- **Any taste-skill rule on colored or left-border cards, Space Grotesk, hover fades, cursor-following spotlights as a ban, or grain over gradients as a ban:** grep over all 13 SKILL.md files and DESIGN.md for `border-l`, "left-border", "colored border", "Space Grotesk", "beam", "spotlight", "fade", "hover", "grain", "noise". No such ban exists.
- **Any mention of Playwright, rendered-screenshot verification, Figma, hackathons, juries or pitches:** grep over all skills for "playwright", "Playwright", "screenshot", "Figma", "hackathon", "jury", "judge", "pitch". Zero, apart from "screenshot" in the fake-screenshot bans.
- **The §12 Block Library implementations:** the tree listing has no `skills/taste-skill/blocks/`. §12 is a schema with no blocks (L839: "Blocks will be added iteratively"). PR #111 adds two blocks and is unmerged.
- **Sources for "LazyBench", the "2025 Controlled Laziness Experiments" and the "$200 tip +45%":** the repository gives no links. I opened only the OPRO and EmotionPrompt sources.
- **X/Twitter discussion of taste-skill:** not searched on X, which needs a login. The author's handle was confirmed through the GitHub API field `twitter_username`.
- **The GreenSock "position: sticky" quote in issue #112:** searched the ScrollTrigger docs page and the "tips & mistakes" page for "sticky". No match. At verification, an Exa search found the same advice, in other words, on GSAP's official forum (topics 39480 and 45164, see Contradiction 8). The exact sentence remains untraced.
- **The second tasteskill.dev showcase ("Collective OS"):** not examined. At verification the site's HTML labels it "Screenshot of Collective OS, a Technical UI project built with Taste Skill" and links https://collectiveos.vercel.app/. It gives no skill version or date, and it was not rendered.

## Weak spots of this dossier

- I did not run taste-skill on a brief. This environment forbids running projects. Every behavioural claim comes from reading the files, the docs, the issues and one vendor arena.
- Token figures are estimates from character counts. The compaction effect (F20) is inferred from the docs and the file offsets, not observed in a session.
- The map of the 20 tells (F15) is my interpretation of the owner's short labels and of the skill's wording. Another reader could class #2, #9 or #14 differently.
- The Floria reading (F24) is visual judgement on two screenshots. Fonts cannot be identified from pixels.
- The Happycapy arena is weak evidence: vendor-run, AI judges, one run, 3 tasks, no baseline score. The secondary reviews (F28) are low grade.
- Sibling skills in other repositories (F29) were not deep-read, by design.
- Stars and install counts change daily. Line numbers refer to `skills/taste-skill/SKILL.md` at commit ce26fc2, whose content is identical to 3c7017d.
- The plugin-install behaviour in F4 comes from the Claude Code docs and was not tested.
- (Added at verification.) Three quotations attributed to the Claude Code skills page were not on it as fetched on 2026-09-30: one in F04 (the `name` "display label" sentence) and two in F22 (the `hooks` table row and the "Strengthen the skill's `description`" sentence). The page says something different, in F04's case the opposite. Docs can change within a day, so a page update cannot be ruled out, but the dossier must rest on the text that is there now. F04, F22 and Contradiction 14 were rewritten against it.
- For EmotionPrompt I read the abstract, not the full paper.

## Dropped at verification

None. No finding rested on a source that failed to open or on a claim that collapsed entirely. Sixteen were corrected in place (see each finding's `(corrected: …)` notes).

## Verification notes

**Result.** 29 original findings: 13 verified, 16 corrected, 0 downgraded, 0 dropped. 1 finding added (F30). The summary, Contradictions 8, 13, 14, 16, 21 and 22, and "What could not be found" were also corrected or annotated in place.

**The corrections that change what /frontend should do:**
- **F22.** A hook in skill frontmatter is not scoped to the skill. Claude Code keeps it for the rest of the session. Scope the slop checker to the frontend subagent instead, where a `Stop` hook becomes `SubagentStop`.
- **F04.** For personal and project skills, frontmatter `name` sets the command. SHA pinning is available in the skills CLI since PR #1439 (2026-09-06) and through a self-authored plugin marketplace entry.
- **F21.** PR #111's validator strips comments before its em-dash rule runs.
- **F29.** superdesign-skill was last pushed on 2026-08-21, and it is MIT-licensed.
- **Precision fixes:** F20's character offsets, F11's §9 count, F03's v1 install name, F17's "e.g." options misread as mandates, and F24's "banned" floated link.

**Method.** Every cited source was re-opened on 2026-09-30. Nothing was taken from memory.
- **Repository.** Metadata came from `gh api`: the repo, its owner, commits by path (with `since`), contributors with pagination, releases, tags, open-issue and open-PR counts from the search API, PR states and merge dates, #108's events, and the #106 and #111 comments. Single files came from raw.githubusercontent.com at ce26fc2, and v2 also at 3c7017d; `cmp` showed the two v2 copies are identical. No repository was cloned.
- **v2 file.** Python recomputed characters, bytes, lines, words and heading offsets. It also counted the §9 bullets per subsection and the §14 checkboxes. Every quoted v2 line was read against the numbered file.
- **Sibling skills.** Each quoted line was printed with `sed`. The pattern greps behind the tell map were re-run over all 13 SKILL.md files and DESIGN.md.
- **Floria screenshots.** Both files were converted with Pillow, cut into four crops each and viewed.
- **Claude Code docs.** `skills.md`, `hooks.md`, `plugins-reference.md`, `discover-plugins.md` and `plugins/marketplace-reference.md` were fetched as markdown and grepped for each quoted sentence. The Claude Code CHANGELOG.md was grepped for skill-naming entries.
- **Standards and papers.** The GSAP ScrollTrigger docs, GSAP's "tips & mistakes" page, WCAG 2.2 (Recommendation, 12 December 2024) and Understanding SC 1.4.3 were fetched as HTML and searched. For the papers I used the arXiv abstract pages for 2307.11760 and 2309.03409, the OPRO HTML Table 1, and page 1 of the EmotionPrompt PDF (read via Exa).
- **skills CLI.** The vercel-labs/skills README and six source files at main 3694740, plus PR #1439.
- **Web pages via Exa's text extraction.** skills.sh, tasteskill.dev and its changelog, the Happycapy arena, andrew.ooo, kondasamy.com, soymarketingultra.com and limpidreviews.fyi. For tasteskill.dev I also fetched the raw HTML.
- **Curated lists and F29 repositories.** The lists were fetched as raw READMEs; every F29 repository was checked through the GitHub API.
- **Sources added at verification.** greensock/gsap-skills (API metadata and two SKILL.md files), GSAP forum topics 39480 and 45164, the VaporAviator article, the Claude Code marketplace reference and changelog, and vercel-labs/skills PR #1439 with `src/git.ts`.

**Sources I could not open.** None of the cited sources failed to open. Limits of how I read them:
- The marketing and review pages were read through Exa's text extraction, not rendered. Layout and any hidden content were not checked.
- I read the EmotionPrompt paper's first page and abstract, not the whole paper.
- I did not check the roles of the GSAP forum responders.

**Residual doubts:**
- **Docs quotations.** Three quotations the draft attributed to the Claude Code skills page are not on it now. I cannot tell whether the page changed after the researcher read it or whether the text was never there. The corrected findings rest on the page as fetched at verification.
- **PR #108.** Its test saw folder names for copied project skills, which conflicts with the current docs. Settling it needs a live Claude Code test, which this environment does not allow.
- **Not run: installs.** The SHA-pinned CLI install, the `sha`-pinned marketplace entry and the plugin exposure of all 13 skills come from source code and docs.
- **Not run: code.** The PR #111 validator and GreenSock's `Max.max` example were read, not executed. A regex comment-stripper can still misfire on `//` inside strings that are not preceded by a colon.
- **Interpretive findings.** The tell map (F15) and the Floria reading (F24) remain interpretations. I re-checked every line reference and every visible element, and corrected two rows and one claim. Another reader could still class #2, #9 or #14 differently.
- **Undated or unchecked figures.** Happycapy's arena page is undated and may be re-run. The repo's "+115% from combined stimuli" framing was not checked against EmotionPrompt's full paper.
