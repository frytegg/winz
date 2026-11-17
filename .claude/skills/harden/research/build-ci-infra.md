# Build, CI, container, shell-script and IaC hygiene for a finished project
> Code G107 · slug build-ci-infra · verified 2026-09-23 · counts: verified 11 / corrected 12 / downgraded 1 / dropped 0

## Summary

**Scope.** This dossier covers the non-source files that decide whether a finished project builds, tests and deploys reliably:
- CI workflows;
- toolchain pins;
- Dockerfiles and compose files;
- shell scripts;
- IaC;
- database migrations.

**How it was checked.** The fact-check pass on 2026-09-23 re-opened every cited source:
- official docs were fetched as markdown or raw text;
- papers were read from the arXiv API, Crossref and the author or publisher PDFs;
- GitHub repos, issues, releases and advisories were read through the GitHub API;
- HN comments were read through the Algolia API.

The shell and Git Bash behaviours were re-run locally in GNU bash 5.2.37 and Git 2.51.1.windows.1.

**Tool versions** (GitHub releases API, 2026-09-23):

| Tool | Version | Released | Notes |
|---|---|---|---|
| actionlint | v1.7.12 | 2026-03-30 | |
| zizmor | v1.30.1 | 2026-09-09 | |
| poutine | v1.1.6 | 2026-05-22 | |
| hadolint | v2.15.1 | 2026-07-31 | No release between v2.12.1-beta (2022-11-14) and v2.13.1 (2025-09-02) |
| dockle | v0.4.15 | 2025-01-06 | Last release |
| trivy | v0.74.0 | 2026-08-14 | |
| checkov | 3.3.19 | 2026-09-17 | |
| KICS | v2.2.0 | 2026-09-17 | |
| ShellCheck | v0.11.0 | 2025-08-04 | |
| squawk | v2.66.0 | 2026-09-23 | |
| tfsec | v1.28.14 | 2025-05-02 | README tells users to move to Trivy |

PostgreSQL docs are at 18.6.

**Main results**

1. **A green pipeline that hides a failed gate.** This CI failure mode has the most evidence.
   - Zampetti et al. (EMSE 25(2), 2020): 64% of the 25 respondents to that item rate "a build is succeeded when a task is failed" as a bad smell.
   - The masking mechanisms are documented by the platforms themselves:
     - GitHub `continue-on-error`;
     - GitLab `allow_failure` (the commit is "marked as passed");
     - `|| true` and `--passWithNoTests`;
     - scanner soft-fail switches;
     - Trivy, which exits 0 by default even when it finds issues.
   - A GitHub Actions `run:` step with no shell set runs as `bash -e {0}`, without pipefail. So `pnpm test | tee log` passes when the tests fail (reproduced locally).
   - On Windows runners the default pwsh prepends `$ErrorActionPreference = 'stop'`, but it only propagates the last native command's exit code.
2. **Does CI run the project's own gates?** Compare CI against the local scripts. Studies report build-without-test workflows, and 57% of 25 surveyed developers see local/CI misalignment as a smell.
3. **Dockerfile smells are close to universal.**
   - 84% of projects (Wu 2020, as cited by Rosa 2024).
   - 99% of 11,470 Dockerfiles at one company contain at least one tool-flagged security misconfiguration (ASE 2026 Industry Showcase).
   - Developers accept some fixes and reject others. Apt version pinning (DL3008) is the most rejected: 47% of those PRs were rejected, and a merged pin broke a build within a month. MAINTAINER, COPY and base-tag fixes are accepted most.
4. **Blanket `set -euo pipefail` is contested.**
   - BashFAQ/105 documents where `set -e` does nothing, and the SIGPIPE false failures that pipefail causes. These cases were reproduced locally.
   - Treat strict mode as a behaviour change, not a safe fix.
   - ShellCheck is the evidence-backed baseline (Google Shell Style Guide; Bash in the Wild, TOSEM 2023).
5. **IaC security smells are measured and replicated.** These include hard-coded secrets, 0.0.0.0 bindings and missing encryption at rest (Rahman ICSE 2019 and TOSEM 2021, on Puppet, Ansible and Chef; Verdet et al., EMSE 2025, on Terraform).
   - Many fixes change deployed infrastructure. RDS encryption can only be set at creation.
   - Scanner-driven repairs are often "deceptive". In the TerraProbe preprint (submitted to EMSE, 2026), the primary LLM removed 83.3% of the targeted Checkov findings, yet only 10.4% of files were fully clean. Of the real-world repairs that could be compared by plan, 71.4% left the vulnerability in place.
6. **Migration safety rests on official docs and postmortems.** The sources are the PostgreSQL lock levels, Prisma, Django, squawk and strong_migrations. No empirical study of migration linters was found.

**"CI ACTUALLY GATES" CHECKLIST** (each item maps to a finding)
1. CI triggers on `pull_request` and on pushes to the default branch (F03).
2. Each local gate is called through the same entry point: typecheck, lint, test, build, and the pre-commit hooks (F03, F10).
3. Nothing masks a failure (F01, F11, F20). Look for:
   - `continue-on-error: true`, `|| true`, `|| exit 0` and `set +e`;
   - `allow_failure: true` and `--passWithNoTests`;
   - checkov `--soft-fail`, hadolint `--no-fail` and trivy `--exit-code 0`;
   - trivy with no `--exit-code 1` at all, because trivy exits 0 by default.
4. Shell settings (F02, F15):
   - Linux jobs set `defaults.run.shell: bash`, which adds pipefail;
   - Windows jobs have no multi-command run blocks under the default pwsh;
   - every Dockerfile RUN that contains a pipe runs under `SHELL` with `-o pipefail`.
5. Installs are frozen (`npm ci` / `pnpm --frozen-lockfile`), and toolchain versions come from the pin files (F04, F08).
6. Test runners run in CI mode (F04):
   - Jest's `ci` option is on when CI is detected; do not disable it, and pass `--ci` if CI detection is uncertain;
   - Vitest's `allowOnly` is not overridden.
7. actionlint and zizmor findings have been triaged (F05).
8. Jobs have an explicit `timeout-minutes` (F07).

**FIX TIERS**

Safe inside the pass (rerun the full test suite afterwards):
- `.gitattributes` with `*.sh text eol=lf`, plus renormalize, in its own commit;
- the exec bit on scripts that are called directly;
- ADD→COPY for local files;
- moving `${{ github.event.* }}` into `env:` in workflows;
- the SC2155 and SC2164 fixes;
- actionlint syntax errors;
- pin files that match the versions CI already uses.

Pipeline behaviour changes that need approval:
- removing masking or enabling pipefail;
- adding a missing gate;
- a frozen lockfile when the lockfile is stale;
- timeouts;
- `USER` non-root;
- the exec-form ENTRYPOINT when it relies on env expansion;
- Docker `# check=error=true`;
- running pre-commit or migration linters in CI;
- adopting `set -euo pipefail`.

Report only:
- IaC edits where `terraform plan -detailed-exitcode` does not return 0;
- any edit to an applied migration;
- adding NOT NULL, CHECK or FK constraints;
- rewriting scripts over 100 lines;
- rotating leaked secrets;
- reproducible-build work.

**Seed leads not verified first-hand** (unchanged from the researcher):
- Vassallo ICSE 2019 CI-Odor;
- Cito MSR 2017 and Wu 2020, known only through Rosa 2024;
- Henkel binnacle;
- Bouzenia & Pradel ICSE 2024.

**Corrections applied in this pass** (details under each finding):
- hadolint has no `--only` flag;
- checkov has no docker-compose framework;
- zizmor `typosquat-uses` works offline;
- Jest `ci` defaults to on in detected CI;
- trivy exits 0 by default;
- Docker's CopyIgnoredFile check is experimental;
- TerraProbe is a preprint, not a published EMSE article;
- Verdet et al. is now published in EMSE (2025) under a new title;
- Gallaba & McIntosh is TSE 46(1), 2020;
- the Postgres.ai quote was reworded;
- `MSYS_NO_PATHCONV` is a Git for Windows variable, not an MSYS2 one;
- the false-positive issue counts include PRs.

## Findings

### G107-F02 — Force pipefail in CI shells and Dockerfile RUN
**Rule:**
- **GitHub Actions, Linux and macOS jobs:** set `defaults: run: shell: bash` at workflow or job level. Every `run:` then executes as `bash --noprofile --norc -eo pipefail {0}`. With no shell set, the command is `bash -e {0}`, which has no pipefail.
- **Windows runners:** the default pwsh prepends `$ErrorActionPreference = 'stop'`, so cmdlet errors do stop. But a native command's non-zero exit code only fails the step if it is the LAST command, because `exit $LASTEXITCODE` is appended. Split multi-command native blocks into one command per step, check `$LASTEXITCODE` after each one, or set `shell: bash`.
- **Dockerfile RUN:** RUN uses `/bin/sh -c`, which has the same pitfall. Use `SHELL ["/bin/bash","-o","pipefail","-c"]` before any RUN that contains a pipe (hadolint DL4006), or exec-form `RUN ["/bin/bash","-c","set -o pipefail && ..."]` as Docker suggests.

- **Grade:** A · **Verdict:** CORRECTED. Two fixes:
  - The pwsh nuance was added: GitHub prepends `$ErrorActionPreference='stop'`, so the last-exit-code problem is about native executables, not cmdlets.
  - The detection command was fixed: hadolint has no `--only` flag. Its CLI source (Commandline.hs) and README list only `--ignore`, `--error`, `--warning`, `--info`, `--style`, `--no-fail` and `--failure-threshold`.
- **Rationale:** With no shell set, `pnpm test | tee test.log` exits 0 when the tests fail, because only tee's status counts. Re-verified in Git Bash 5.2.37:
  - `bash -e -c 'false | tee /dev/null; echo survived'` prints `survived` and exits 0;
  - `bash -eo pipefail -c ...` exits 1.

  GitHub documents that the unspecified shell "runs a different command to when `bash` is specified explicitly". Docker documents that `/bin/sh -c` "only evaluates the exit code of the last operation in the pipe".
- **Evidence:**
  - [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — GitHub, 2026 — official docs. The shell table and "Exit codes and error action preference" section say:
    - unspecified shell on Linux/macOS: "`bash -e {0}`";
    - `bash`: "`bash --noprofile --norc -eo pipefail {0}`";
    - "By default, fail-fast behavior is enforced using `set -e` for both `sh` and `bash`. When `shell: bash` is specified, `-o pipefail` is also applied";
    - pwsh: "we will prepend `$ErrorActionPreference = 'stop'`" and "We append `if ((Test-Path -LiteralPath variable:\LASTEXITCODE)) { exit $LASTEXITCODE }` … so action statuses reflect the script's last exit code."

    Verified verbatim from the docs markdown API.
  - [Building best practices: using pipes](https://docs.docker.com/build/building/best-practices/) — Docker, 2026 — official docs. "Docker executes these commands using the `/bin/sh -c` interpreter, which only evaluates the exit code of the last operation in the pipe"; "prepend `set -o pipefail &&`". A note adds that dash on Debian may not support `-o pipefail`, so use exec-form RUN with bash. Verified verbatim.
  - [BashFAQ/105](https://web.archive.org/web/2026id_/https://mywiki.wooledge.org/BashFAQ/105?action=raw) — Wooledge wiki (living document) — practitioner wiki. "Using a pipe makes no difference, as only the ''rightmost'' process is considered". With pipefail, `somecmd | head -n1` "will sometimes cause an error, depending on whether the output of somecmd exceeds the size of the pipe buffer". Verified in the archived raw copy. The live wiki answered HTTP 200 on 2026-09-23.
  - [Fixing Dockerfile smells: an empirical study](https://link.springer.com/content/pdf/10.1007/s10664-024-10471-7.pdf) — Rosa, Zappone, Scalabrino, Oliveto, EMSE 29:108, 2024 — peer-reviewed. Table 3, DL4006: 4 of 8 PRs ignored (50%), 1 rejected, 3 (38%) merged. The paper cites Lin et al.: DL4006 "became more prevalent". Verified in the PDF.
- **Detect:** Use a YAML-aware check (PyYAML). For each job step, resolve the shell as step.shell, then job defaults, then workflow defaults. Flag:
  - (a) no shell, a Linux runner, and a `|` in `run`;
  - (b) no shell, `windows` in `runs-on`, and more than one native command line.

  Grep fallback: `grep -nE '^\s*(- )?run:.*[^|]\|[^|]' .github/workflows/*.y*ml`, plus `for f in .github/workflows/*.y*ml; do grep -qE '^\s*shell:\s*bash' "$f" || echo "$f"; done`.

  Dockerfiles: `hadolint -f json Dockerfile | jq '.[] | select(.code=="DL4006")'` or `hadolint Dockerfile | grep DL4006`. Grep fallback: `grep -nE '^\s*RUN .*[^|]\|[^|]' Dockerfile* | grep -v pipefail`.
- **Tools:** python+PyYAML, grep, hadolint (DL4006), actionlint (runs shellcheck on `run:`).
- **Applies to:** GitHub Actions (Linux, macOS and Windows runners), Dockerfile RUN, and any CI step that pipes a gate's output to tee, grep or a formatter.
- **When not to apply / counterpoints:**
  - Pipefail can create new, spurious failures. `producer | head -1` or `| grep -q` can kill the producer with SIGPIPE (BashFAQ/105). An HN practitioner stopped using pipefail because "the return value can be based on a race".
  - Alpine and dash-based images may lack bash. Add bash or verify pipefail support in the image's sh first.
  - Rosa: developers ignored half of the DL4006 PRs.
- **Fix risk:** medium

### G107-F04 — Strict install and test modes in CI
**Rule:** In CI, install and test in strict mode.
- **Installs:** use `npm ci`, or `pnpm install --frozen-lockfile` (already pnpm's default in CI when a lockfile exists). Never `npm install`.
- **Jest:** keep CI mode on. Jest's `ci` option defaults to `isCI` (from ci-info), so a missing snapshot already fails in CI that Jest detects. Pass `--ci` explicitly when the runner may not set a CI variable, and never pass `--ci=false`.
- **Vitest:** do not override `allowOnly`. It defaults to `!process.env.CI`, so `.only` fails in CI.
- **`--passWithNoTests`:** remove it from the CI invocation unless the package truly has no tests.

If the lockfile is stale, frozen installs fail. That is a pipeline behaviour change and needs approval.

- **Grade:** A · **Verdict:** VERIFIED. One wording fix: Jest's `ci` mode is on by default in CI it detects (`packages/jest-config/src/Defaults.ts`: `ci: isCI`; CLI help: "This option is on by default in most popular CI environments"). The researcher's "without `--ci`, Jest writes new snapshots" holds only where CI is not detected.
- **Rationale:** Each switch changes what "green" means.
  - With `--passWithNoTests`, a broken glob or a moved test directory yields zero tests and a pass.
  - Outside CI mode, Jest writes new snapshots and passes.
  - Frozen installs fail when package.json and the lockfile disagree, instead of silently resolving new versions.
- **Evidence:**
  - [Jest CLI options](https://jestjs.io/docs/cli) — Jest, 2026 — official docs.
    - `--ci`: "Instead of the regular behavior of storing a new snapshot automatically, it will fail the test and require Jest to be run with `--updateSnapshot`."
    - `--passWithNoTests`: "Allows the test suite to pass when no files are found."

    Verified. Jest source (`jest-config/src/Defaults.ts`) has `ci: isCI`.
  - [Vitest config: allowOnly](https://vitest.dev/config/allowonly) — Vitest, 2026 — official docs. "By default, Vitest does not permit tests marked with the `only` flag in Continuous Integration (CI) environments." Default: `!process.env.CI`. Verified.
  - [pnpm install](https://pnpm.io/cli/install) — pnpm, 2026 — official docs. `--frozen-lockfile`: "If true, pnpm doesn't generate a lockfile and fails to install if the lockfile is out of sync with the manifest". Default: false outside CI, true in CI "if a lockfile is present" (CI detected by ci-info). Verified.
  - [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) — npm, 2026 — official docs. "If dependencies in the package lock do not match those in `package.json`, `npm ci` will exit with an error, instead of updating the package lock." "It will never write to `package.json` or any of the package-locks". Verified.
- **Detect:**
  - `grep -rnE '\bnpm (install|i)\b' .github/workflows`
  - `grep -rnE -- '--ci(=| )false|--passWithNoTests|allowOnly' .github/workflows package.json vitest.config.* vite.config.* jest.config.*`
  - `grep -rnE '\.only\(' --include='*.test.*' --include='*.spec.*' src test tests 2>/dev/null`
  - Check that no workflow unsets or overrides `CI`.
- **Tools:** grep, npm ci, pnpm `--frozen-lockfile`, jest, vitest.
- **Applies to:** JS/TS projects using npm, pnpm, Jest or Vitest. The same principle applies to Python (lockfile-enforced sync) and Rust (`cargo --locked`), but those flags were not verified here.
- **When not to apply / counterpoints:**
  - Monorepo packages that genuinely have no tests may need `--passWithNoTests`. Scope it to that package.
  - Lockfile freezing also belongs to the supply-chain dossiers (T15/T16). Only its role as a CI gate is covered here.
- **Fix risk:** medium

### G107-F06 — Script injection, curl|sh and disabled host-key checks in CI
**Rule:** Flag three code-execution and trust anti-patterns in CI config, repo scripts and Dockerfiles.
- **(a) Untrusted expressions in run scripts.** Attacker-controllable `${{ github.event.* }}` or `${{ github.head_ref }}` expanded directly into a `run:` script, or into any input an action evaluates as code, such as `actions/github-script` `script:`. The fix is safe: pass the value through `env:` and reference `"$VAR"` in quotes.
- **(b) Download-and-pipe installers** (`curl … | sh`, `wget -O- | bash`). Replace them with a pinned version plus a checksum, or with a package manager. Needs approval.
- **(c) Disabled SSH host verification** (`StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`). Replace it with a known_hosts secret. Needs approval.

- **Grade:** A · **Verdict:** CORRECTED. Three fixes:
  - Gallaba & McIntosh's venue is IEEE TSE 46(1), 2020 (early access 2018; Crossref).
  - GitHub's "Secure use reference" was added as the source for the env-var fix.
  - The counterpoint was narrowed. GitHub says untrusted values must not flow "anywhere else where they could be interpreted as executable code", which is broader than `run:`.
- **Rationale:** GitHub documents which contexts are attacker-controlled and shows that even a branch name can carry a shell payload. Gallaba & McIntosh studied 9,312 Travis CI projects. They defined "Redirecting Scripts into Interpreters" and "Bypassing Security Checks" as CI anti-patterns, and found anti-patterns in 9.60% of projects.
- **Evidence:**
  - [Script injections](https://docs.github.com/en/actions/concepts/security/script-injections) — GitHub, 2026 — official docs. "These contexts typically end with `body`, `default_branch`, `email`, `head_ref`, `label`, `message`, `name`, `page_name`,`ref`, and `title`." "`zzz";echo${IFS}"hello";#` would be a valid branch name and would be a possible attack vector". "ensure that these values do not flow directly into workflows, actions, API calls, or anywhere else where they could be interpreted as executable code". Verified verbatim.
  - [Secure use reference: use an intermediate environment variable](https://docs.github.com/en/actions/reference/security/secure-use) — GitHub, 2026 — official docs. "For inline scripts, the preferred approach to handling untrusted input is to set the value of the expression to an intermediate environment variable." Verified; added in this pass.
  - [Use and Misuse of Continuous Integration Features](https://rebels.cs.uwaterloo.ca/papers/tse2018_gallaba.pdf) — Gallaba & McIntosh, IEEE TSE 46(1), 2020 — peer-reviewed. "HANSEL detects anti-patterns in the TRAVIS CI specifications of 894 projects in the corpus (9.60%), and achieves a recall of 82.76%". Anti-pattern 1: "Redirecting Scripts into Interpreters". Anti-pattern 2: "Bypassing Security Checks" (StrictHostKeyChecking=no, UserKnownHostsFile=/dev/null). "36 accepted pull requests". Verified in the PDF.
- **Detect:** Heuristic; it flags some safe fields such as `.number`, so triage the hits.
  - `grep -rnE '\$\{\{\s*github\.(event\.(issue|pull_request|comment|review|review_comment|head_commit|commits|discussion|workflow_run)[^}]*|head_ref)\s*\}\}' .github/workflows`
  - `grep -rnE '(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b' .github .gitlab-ci.yml Dockerfile* scripts`
  - `grep -rnE 'StrictHostKeyChecking=no|UserKnownHostsFile=/dev/null' .`

  Tool equivalents: actionlint's untrusted-input check and zizmor `template-injection`.
- **Tools:** grep, actionlint, zizmor (template-injection).
- **Applies to:** GitHub Actions, GitLab CI, Dockerfiles, and repo scripts that install tooling.
- **When not to apply / counterpoints:**
  - Passing an untrusted value via `with:` to an action that treats it as data is GitHub's recommended alternative to inline scripts. It is still a sink if the action evaluates it as code (github-script).
  - Some vendors document curl|sh as the only install path. There, pin the version and verify a checksum rather than remove the step.
  - The Sandstorm team argues that script redirection lets developers iterate faster (Gallaba).
- **Fix risk:** medium (the env: move alone is low)

### G107-F12 — Make the service PID 1 or run it under an init
**Rule:**
- The long-running process must be PID 1 or run under an init.
- Use exec-form `ENTRYPOINT ["node","dist/server.js"]` or `CMD [...]`. Do not use shell form, and do not use `npm start` / `pnpm start` as the container command.
- Where the app spawns children, add an init: `docker run --init`, tini or dumb-init.
- If a shell wrapper is needed, end it with `exec "$@"`.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** In shell form the app runs as a child of `/bin/sh`, which does not pass signals. On deploy or scale-down the app gets no graceful shutdown and is SIGKILLed after the grace period. The default grace period is 10 s for Linux containers.
- **Evidence:**
  - [JSONArgsRecommended](https://docs.docker.com/reference/build-checks/json-args-recommended/) — Docker, 2026 — official docs. "When you use shell form, the executable runs as a child process to a shell, which doesn't pass signals." Example: `ENTRYPOINT my-program start` becomes `/bin/sh -c my-program start`. Verified.
  - [Docker and Node.js Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md) — Node.js Docker team, 2026 — official docs. "Node.js was not designed to run as PID 1 which leads to unexpected behaviour when running inside of Docker." Bypassing npm start "causes exit signals such as `SIGTERM` and `SIGINT` to be received by the Node.js process instead of npm swallowing them." Recommends `CMD ["node","index.js"]`. Verified.
  - [Building best practices: ENTRYPOINT](https://docs.docker.com/build/building/best-practices/) — Docker, 2026 — official docs. "This script uses the `exec` builtin so that the final running application becomes the container's PID 1. This allows the application to receive any Unix signals sent to the container." Verified.
  - [docker container stop](https://docs.docker.com/reference/cli/docker/container/stop/) — Docker, 2026 — official docs. The default timeout "is 10 seconds for Linux containers, and 30 seconds for Windows containers." Verified; added to support the runtime check.
- **Detect:**
  - `grep -nE '^\s*(ENTRYPOINT|CMD)\s+[^[ ]' Dockerfile*` (shell form)
  - `grep -nE '^\s*(ENTRYPOINT|CMD)\s*\[\s*"(npm|pnpm|yarn)"' Dockerfile*` (package manager as PID 1)
  - hadolint DL3025; Docker build check JSONArgsRecommended.
  - Runtime check: `docker run -d --name t img; time docker stop t`. About 10 s means SIGTERM was ignored.
- **Tools:** `docker build --check`, hadolint (DL3025), grep.
- **Applies to:** container images for long-running services deployed with Docker, ECS, Railway, Kubernetes, etc.
- **When not to apply / counterpoints:**
  - Exec form does NOT expand environment variables. Converting `CMD node server.js --port $PORT` breaks substitution, a real risk on Railway and Heroku-style platforms that inject PORT. Read the variable in code, or use a wrapper script ending in `exec`.
  - The switch is a behaviour change that needs approval and a runtime test.
- **Fix risk:** medium

### G107-F13 — Do not run the final image as root
**Rule:**
- Report images whose final USER is root, or which have no USER instruction and whose base image defaults to root.
- Recommend a non-root user, for example `node` (uid 1000) in official Node images.
- The switch is approval work with a runtime test, not a blind edit.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Running as root violates least privilege. Docker's guidance, the CIS-derived dockle check and hadolint DL3002 all flag it.
- **Evidence:**
  - [Building best practices: USER](https://docs.docker.com/build/building/best-practices/) — Docker, 2026 — official docs. "If a service can run without privileges, use `USER` to change to a non-root user." "Avoid installing or using `sudo` as it has unpredictable TTY and signal-forwarding behavior". Verified.
  - [Docker and Node.js Best Practices: non-root user](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md) — nodejs/docker-node, 2026 — official docs. "By default, Docker runs commands inside the container as root which violates the Principle of Least Privilege (PoLP)". "The node images provide the `node` user with uid 1000". Verified.
  - [hadolint rules](https://github.com/hadolint/hadolint) — hadolint, 2026 — official docs. DL3002: "Last user should not be root." Verified.
  - [dockle checkpoints](https://github.com/goodwithtech/dockle) — goodwithtech, 2025 — official docs. CIS-DI-0001: "Create a user for the container" (WARN). Verified.
- **Detect:**
  - `grep -qiE '^\s*USER\s+' Dockerfile || echo 'no USER'`
  - `grep -niE '^\s*USER\s+(root|0)(\s|:|$)' Dockerfile*`
  - hadolint DL3002; `dockle <image>`; `docker run --rm --entrypoint id <image>`.
- **Tools:** hadolint (DL3002), dockle (image-level, last release Jan 2025), trivy config, `docker run … id`.
- **Applies to:** production images. Less important for throwaway CI or dev images.
- **When not to apply / counterpoints:**
  - Switching to non-root commonly breaks writes to root-owned directories (caches, uploads, volumes), ports below 1024, and entrypoints that chown or apt-get at start-up.
  - Distroless and some PaaS base images already run as non-root, which the Dockerfile text alone does not show.
- **Fix risk:** high

### G107-F14 — Keep secrets out of image layers and the build context
**Rule:**
- Never put secrets in Dockerfile ARG or ENV, in copied files, or in intermediate layers.
- At build time, use `RUN --mount=type=secret`.
- Add a `.dockerignore` that excludes at least `.git`, `.env*`, keys, and local dependency and build folders.
- A secret found in history or in a published image is report-only and needs rotation by a human.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** An internet-wide study found secrets in 8.5% of images, and the leaked keys were in active use. Docker states that ARG and ENV values persist in the final image and ships a build check for them.
- **Evidence:**
  - [Secrets Revealed in Container Images](https://arxiv.org/abs/2307.03958) — Dahlmanns, Sander, Decker, Wehrle, ASIA CCS '23, 2023 — peer-reviewed. "we analyze 337,171 images from Docker Hub and 8,076 other private registries unveiling that 8.5% of images indeed include secrets. Specifically, we find 52,107 private keys and 3,158 leaked API secrets". "275,269 TLS and SSH hosts using leaked private keys". Verified (arXiv abstract; journal_ref is ASIA CCS '23, pp. 797–811).
  - [SecretsUsedInArgOrEnv](https://docs.docker.com/reference/build-checks/secrets-used-in-arg-or-env/) — Docker, 2026 — official docs. "setting secrets in a Dockerfile using `ENV` or `ARG` is insecure because they persist in the final image." Secret mounts "do not persist in the final image or its metadata." Verified.
  - [Building best practices: .dockerignore](https://docs.docker.com/build/building/best-practices/) — Docker, 2026 — official docs. "To exclude files not relevant to the build, without restructuring your source repository, use a `.dockerignore` file." Verified.
- **Detect:**
  - `grep -niE '^\s*(ARG|ENV)\s+[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE)' Dockerfile*`
  - `ls .dockerignore || echo missing`
  - `grep -nE '^\s*(COPY|ADD)\s+\.\s' Dockerfile*`, then check that .dockerignore covers `.env`, `.git` and `*.pem`.
  - Docker build check SecretsUsedInArgOrEnv.
  - Image level: `trivy image --scanners secret <img>` and `docker history --no-trunc <img>`.
- **Tools:** `docker build --check`, trivy (secret scanner), dockle (CIS-DI-0010), grep.
- **Applies to:** all Dockerfiles, especially images pushed to public or shared registries.
- **When not to apply / counterpoints:**
  - A new .dockerignore can exclude files the build needs, such as a generated config or a `.npmrc` for private registries. Cross-check every COPY source, then build and run the tests.
  - Non-secret build ARGs (versions, feature flags) trip naive name-based greps.
- **Fix risk:** medium

### G107-F19 — Line endings, exec bits and MSYS path conversion for Windows-edited repos
**Rule:** Git Bash and Windows hygiene for the scripts that Linux CI or a container will execute.
- **(a) Line endings.** Commit `.gitattributes` with `*.sh text eol=lf` (and other LF-only files such as entrypoints). Then run `git add --renormalize .` in a separate commit.
- **(b) Exec bit.** Set it in the index for scripts executed directly: `git update-index --chmod=+x path.sh`.
- **(c) Path conversion.** In local scripts that pass Unix-style paths to native Windows programs (docker, node), prevent MSYS path conversion with `MSYS_NO_PATHCONV=1` (Git for Windows) or `MSYS2_ARG_CONV_EXCL`.

- **Grade:** A · **Verdict:** CORRECTED. The MSYS2 docs do not mention `MSYS_NO_PATHCONV`; it is a Git for Windows variable. The Git for Windows release notes were added as its source.
- **Rationale:** CRLF breaks scripts in Linux containers and CI. Git for Windows repos commonly run with `core.autocrlf=true` and `core.filemode=false`, so new scripts are committed as mode 100644. Re-verified locally in Git 2.51.1.windows.1:
  - `git init` sets `core.filemode=false`, and a new `a.sh` is staged as `100644`;
  - after checkout with `autocrlf=true`, `git ls-files --eol` shows `i/lf w/crlf`;
  - `grep -rIl $'\r'` misses the file and `grep -rlU $'\r'` finds it;
  - `node -e … /app/data` receives `C:/Program Files/Git/app/data` unless `MSYS_NO_PATHCONV=1` or `MSYS2_ARG_CONV_EXCL='*'` is set.
- **Evidence:**
  - [gitattributes](https://git-scm.com/docs/gitattributes) — Git project, 2026 — official docs. The example includes `*.sh text eol=lf`. Renormalize recipe: `echo "* text=auto" >.gitattributes; git add --renormalize .; git status`. Verified.
  - [Configuring Git to handle line endings](https://docs.github.com/en/get-started/git-basics/configuring-git-to-handle-line-endings) — GitHub, 2026 — official docs. "When you commit this file to a repository, it overrides the `core.autocrlf` setting for all repository contributors." Verified.
  - [SC1017](https://www.shellcheck.net/wiki/SC1017) — koalaman/shellcheck, 2026 — official docs. "Literal carriage return. Run script through `tr -d '\r'`." The CRs "will be treated literally, and results in all sorts strange bugs and messages." Verified.
  - [Filesystem paths](https://www.msys2.org/docs/filesystem-paths/) — MSYS2, 2026 — official docs. "all the arguments that look like Unix paths will get auto converted to Windows". "`MSYS2_ARG_CONV_EXCL` can either be `*` to mean exclude everything, or a list of one or more arguments prefixes separated by `;`". Verified.
  - [Git for Windows release notes](https://github.com/git-for-windows/build-extra/blob/main/ReleaseNotes.md) — Git for Windows, 2026 — official docs. "you need to set the environment variable `MSYS_NO_PATHCONV` temporarily, like so: `MSYS_NO_PATHCONV=1 git blame -L/pathconv/ msys2_path_conv.cc`". Verified; substituted in this pass.
- **Detect:**
  - `git ls-files --eol | grep -E 'i/crlf|w/crlf'`
  - `grep -rlU $'\r' --include='*.sh' .` (`-U` is required on Git Bash)
  - `git ls-files -s -- '*.sh' | awk '$1!="100755"{print $4}'`
  - `git config --show-origin --get core.autocrlf`
  - `test -f .gitattributes && grep -n 'eol=lf' .gitattributes`
- **Tools:** `git ls-files --eol`, `git update-index --chmod=+x`, `grep -U`, `file`.
- **Applies to:** any repo edited on Windows or in Git Bash that ships scripts to Linux CI, Docker or a PaaS. Directly relevant to this user.
- **When not to apply / counterpoints:**
  - Renormalizing creates a large diff and churns blame; isolate it in its own commit.
  - Windows-only files (`.bat`, `.cmd`, `.ps1`) may need `eol=crlf`.
  - The exec bit does not matter for scripts always invoked as `bash script.sh`.
- **Fix risk:** low

### G107-F20 — Scan IaC for the three high-prevalence security smell classes
**Rule:** Scan IaC (Terraform, CloudFormation/CDK synth output, Kubernetes) with checkov and/or `trivy config`, and scan docker-compose with KICS. Look for three smell classes:
- **Hard-coded secrets:** CKV_AWS_41 (provider keys), CKV_AWS_45 (Lambda env), CKV_AWS_46 (EC2 user data).
- **World-open ingress:** CKV_AWS_24 (port 22), CKV_AWS_25 (port 3389), CKV_AWS_277 (all ports), CKV_AWS_260 (port 80) from 0.0.0.0/0.
- **Missing encryption at rest:** CKV_AWS_16 (RDS), CKV_AWS_19 and CKV_AWS_145 (S3), CKV_AWS_3 (EBS).

Triage each finding against intent. Suppress intentional exceptions inline with a reason, not globally.

- **Grade:** A · **Verdict:** CORRECTED. Four fixes:
  - Verdet et al. is now peer-reviewed: EMSE 30(3), 2025, retitled "Assessing the adoption of security policies by developers in terraform across different cloud providers".
  - trivy exits 0 by default even when it finds issues.
  - checkov has no docker-compose framework, so KICS is named for compose.
  - The Rahman/GLITCH figures are for Puppet, Ansible and Chef. For Terraform, Verdet is the direct evidence.
- **Rationale:**
  - Rahman et al. found 21,201 security-smell occurrences in 15,232 Puppet scripts, including 1,326 hard-coded passwords, with a median secret lifetime of 20 months.
  - The TOSEM replication on Ansible and Chef found 46,600 occurrences, including 7,849 hard-coded passwords.
  - Verdet et al. scanned 812 Terraform projects with checkov. Encryption at rest was the most neglected practice across AWS, Azure and GCP.
  - A 2025 preprint expands the taxonomy to 62 categories and reports that the smells persist.
- **Evidence:**
  - [The Seven Sins: Security Smells in IaC Scripts](https://akondrahman.github.io/files/papers/icse19_slic.pdf) — Rahman, Parnin, Williams, ICSE 2019 — peer-reviewed. "We identify 21,201 occurrences of security smells that include 1,326 occurrences of hard-coded passwords." "104 responses … of which 67 occurrences were accepted by the development teams to be fixed". "a hard-coded secret can persist for as long as 98 months, with a median lifetime of 20 months." SLIC average precision and recall: 0.99. Verified in the PDF; the scripts studied are Puppet.
  - [Security Smells in Ansible and Chef Scripts: A Replication Study](https://arxiv.org/abs/1907.07159) — Rahman, Rahman, Parnin, Williams, ACM TOSEM 30(1), 2021 (DOI 10.1145/3408897) — peer-reviewed. 50,323 scripts from 813 repositories; "46,600 occurrences of security smells that include 7,849 hard-coded passwords"; "agreement for 65 of the responded 94 bug reports". Verified (abstract and Crossref).
  - [Exploring Security Practices in Infrastructure as Code](https://arxiv.org/abs/2308.03952) — Verdet, Hamdaqa, Da Silva, Khomh; published as EMSE 30(3), 2025, DOI 10.1007/s10664-024-10610-0 — peer-reviewed. 812 Terraform projects scanned with checkov: "Access policy emerges as the most widely adopted in all providers, while Encryption in rest are the most neglected policies." Verified (abstract and Crossref).
  - [Security smells in IaC: a taxonomy update beyond the seven sins](https://arxiv.org/abs/2509.18761) — War, Nikiema, Samhi, Klein, Bissyandé, 2025 — preprint. "a comprehensive taxonomy of 62 security smell categories"; new linter rules "often achieving 1.00 precision score"; the issues "persist for extended periods". Verified (abstract).
  - [GLITCH: Automated Polyglot Security Smell Detection in IaC](https://arxiv.org/abs/2205.14371) — Saavedra & Ferreira, ASE 2022 (DOI 10.1145/3551349.3556945) — peer-reviewed. 196,755 IaC scripts, 12,281,251 LOC; nine smells in Ansible, Chef and Puppet; "higher precision and recall than the current state-of-the-art tools". Verified (abstract and Crossref).
  - [Checkov Terraform policy index](https://www.checkov.io/5.Policy%20Index/terraform.html) and [suppression docs](https://www.checkov.io/2.Basics/Suppressing%20and%20Skipping%20Policies.html) — Prisma Cloud / Bridgecrew, checkov 3.3.19, 2026 — official docs. Every cited ID matches its description; for example, CKV_AWS_260 is "Ensure no security groups allow ingress from 0.0.0.0:0 to port 80". Suppression: `#checkov:skip=CKV_AWS_20:The bucket is a public static content host`. `--soft-fail`: "Runs checks but always returns a 0 exit code." Verified.
  - [Trivy: exit code](https://github.com/aquasecurity/trivy/blob/main/docs/guide/configuration/others.md) — Aqua Security, 2026 — official docs. "By default, `Trivy` exits with code 0 even when security issues are detected. Use the `--exit-code` option if you want to exit with a non-zero exit code." Verified; added in this pass.
- **Detect:**
  - `checkov -d . --compact --quiet` (optionally `--framework` with names from the documented list: terraform, cloudformation, kubernetes, helm, dockerfile, github_actions, …).
  - `trivy config --severity HIGH,CRITICAL --exit-code 1 .`
  - `kics scan -p .` (covers Docker Compose).
  - For CDK, run `cdk synth` and scan `cdk.out`.
  - Grep fallbacks: `grep -rnE '0\.0\.0\.0/0|::/0' --include='*.tf' --include='*.y*ml' --include='*.json' .` and `grep -rniE '(password|secret|access_key|token)\s*=\s*"[^"$]' --include='*.tf' .`
- **Tools:** checkov 3.3.19, trivy config v0.74.0, KICS v2.2.0, GLITCH (research).
- **Applies to:** Terraform, CloudFormation/CDK, Kubernetes and Helm, docker-compose (via KICS). The user deploys to AWS.
- **When not to apply / counterpoints:**
  - No study measuring checkov, trivy or KICS precision on real Terraform was found.
  - Expect context-free false positives. CKV_AWS_260 fires on intentionally public web ports.
  - Rahman's 0.99 precision is for his own tool, SLIC, on Puppet.
  - Pin scanner binaries and actions (see F11 on the Trivy compromise).
- **Fix risk:** medium

### G107-F21 — IaC fixes that change deployed infrastructure are report-only
**Rule:** IaC security fixes that change deployed infrastructure are REPORT-ONLY in a hardening pass. Examples:
- enabling encryption on an existing RDS or EBS resource;
- changing security-group CIDRs;
- toggling public access;
- renaming resources.

An IaC edit counts as safe only when `terraform plan -detailed-exitcode` returns 0, or when `cdk diff` or a CloudFormation change set is empty. After any scanner-driven fix, re-run the FULL scanner and the plan: removing the targeted finding is not the same as fixing the issue.

- **Grade:** A (for the rule, from AWS and HashiCorp docs) · **Verdict:** CORRECTED. TerraProbe was fixed in four ways:
  - It is an arXiv preprint "submitted to Empirical Software Engineering", not a published EMSE article; its type changed from peer-reviewed to preprint.
  - 83.3% is the targeted-removal rate for the primary model only.
  - 71.4% applies only to real-world repairs where plan comparison was reachable, and plan comparison was reachable for only 38.5%.
  - The abstract ties IAM wildcard grants to "CKV2 AWS 11", but checkov's current index lists CKV2_AWS_11 as VPC flow logging. Do not rely on that ID.
- **Rationale:**
  - Some settings cannot be changed in place. AWS states that RDS encryption can only be enabled at creation; the workaround creates a new instance from an encrypted snapshot copy.
  - TerraProbe (preprint) suggests that LLM "fixes" which clear one Checkov rule are usually not real fixes.
- **Evidence:**
  - [Encrypting Amazon RDS resources: limitations](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html) — AWS, 2026 — official docs. "You can only encrypt an Amazon RDS DB instance when you create it, not after the DB instance is created." Workaround: snapshot, encrypted copy, restore. Also: "You can't turn off encryption on an encrypted DB instance." Verified.
  - [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) — HashiCorp, 2026 — official docs. `-detailed-exitcode`: "0 = Succeeded with empty diff (no changes) 1 = Error 2 = Succeeded with non-empty diff (changes present)". Verified.
  - [TerraProbe: A Layered-Oracle Framework for Detecting Deceptive Fixes in LLM-Assisted Terraform](https://arxiv.org/abs/2606.26590) — Alsaid, Nebolisa, Abbas, 2026 — preprint (submitted to EMSE). The study covers 288 first-pass repairs by three LLMs. "targeted removal reaches 83.3 percent for the primary model, full-scanner cleanliness drops to 10.4 percent, Terraform planning succeeds for 39.6 percent, and plan comparison is reachable for 38.5 percent". "71.4 percent of plan-compared real-world repairs are deceptive fixes". Verified (abstract).
- **Detect:**
  - `terraform init -backend=false && terraform validate`, then `terraform plan -detailed-exitcode -lock=false` (needs credentials and state; otherwise report).
  - `cdk diff`; `aws cloudformation create-change-set` followed by `describe-change-set`.
  - In plan output, look for "must be replaced" or "forces replacement".
- **Tools:** `terraform plan -detailed-exitcode`, `cdk diff`, CloudFormation change sets, checkov, trivy config.
- **Applies to:** any IaC that manages live AWS, Railway or other infrastructure.
- **When not to apply / counterpoints:**
  - Pure refactors can be safe when the plan is empty: a `moved` block, an extracted variable, or `terraform fmt`.
  - TerraProbe evaluated LLM repairs on a limited sample. The "scanner passing ≠ fixed" lesson still applies to any automated fixer, including this skill.
- **Fix risk:** high

### G107-F22 — Compose and `docker run -p` ports bind to all interfaces by default
**Rule:**
- In docker-compose and `docker run -p`, flag published ports with no host IP, for example `"5432:5432"` for Postgres or Redis. They bind on all interfaces.
- Bind dev-only services to `127.0.0.1:`, or drop `ports:` and use the compose network.
- Flag literal credentials in `environment:` and move them to a git-ignored env_file.

- **Grade:** A · **Verdict:** CORRECTED. checkov has no `docker_compose` framework: the CLI reference's `--framework` list has no compose entry. The detection now uses KICS, which lists Docker Compose among its platforms.
- **Rationale:** Docker documents that publishing ports is insecure by default. Container-to-container traffic does not need published ports. The hard-coded secret smell (F20) applies equally to compose files.
- **Evidence:**
  - [Port publishing and mapping](https://docs.docker.com/engine/network/port-publishing/) — Docker, 2026 — official docs. "Publishing container ports is insecure by default. Meaning, when you publish a container's ports it becomes available not only to the Docker host, but to the outside world as well." Example: `docker run -p 127.0.0.1:8080:80 …`. "In releases older than 28.0.0, hosts within the same L2 segment … can reach ports published to localhost". Verified.
  - [The Seven Sins](https://akondrahman.github.io/files/papers/icse19_slic.pdf) — Rahman, Parnin, Williams, ICSE 2019 — peer-reviewed. "Invalid IP address binding" (`0.0.0.0`, CWE-284) and "Hard-coded secret" (CWE-798) are among the seven smells. Verified in the PDF (Puppet context).
  - [KICS supported platforms](https://github.com/Checkmarx/kics) — Checkmarx, 2026 — official docs. The README lists Docker Compose. Verified; added in this pass.
- **Detect:**
  - `grep -nE '^\s*-\s*"?[0-9]+:[0-9]+' docker-compose*.y*ml compose*.y*ml` (ports with no host IP)
  - `grep -nEi '(PASSWORD|SECRET|TOKEN|API_KEY)\s*[:=]\s*[^$ {]' docker-compose*.y*ml compose*.y*ml`
  - `kics scan -p .`
- **Tools:** grep, KICS.
- **Applies to:** docker-compose files used on servers or shared machines. Less critical on single-user laptops, but the default still exposes services on shared Wi-Fi.
- **When not to apply / counterpoints:**
  - Services that must be reachable from other hosts, such as a reverse proxy on 80/443, legitimately publish on all interfaces.
  - Changing to 127.0.0.1 breaks access from other LAN devices or VMs. Treat it as an approval item.
- **Fix risk:** medium

### G107-F23 — Never edit an applied migration; fix forward
**Rule:**
- Never edit or delete a migration that has been applied in any shared environment. Fix forward with a new migration.
- Detect edits to existing migration files in git history.
- Verify in CI that models and migrations are in sync: Django `makemigrations --check` and `migrate --check`; Prisma warns about modified migrations.
- Any repair of an edited migration is report-only.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Applied migrations are recorded in the database. Editing them silently makes environments diverge.
- **Evidence:**
  - [About migration histories](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories) — Prisma, 2026 — official docs. "you should not edit or delete a migration that has already been applied". `migrate deploy` warns "WARNING The following migrations have been modified since they were applied" and keeps warning on every run. Verified.
  - [django-admin](https://docs.djangoproject.com/en/5.2/ref/django-admin/) — Django Software Foundation, Django 5.2 LTS docs, 2026 — official docs. `makemigrations --check`: "Makes `makemigrations` exit with a non-zero status when model changes without migrations are detected. Implies `--dry-run`." `migrate --check`: "Makes `migrate` exit with a non-zero status when unapplied migrations are detected." Verified.
- **Detect:**
  - `git log --diff-filter=M --name-only --format='%h %ad' --date=short -- '*migrations/*'` (migration files modified after they were added; cross-check against deploy history).
  - `python manage.py makemigrations --check`
  - `grep -rn 'migrate' .github/workflows`
- **Tools:** `git log --diff-filter=M`, django `makemigrations --check`, prisma migrate, squawk.
- **Applies to:** projects with ORM or SQL migrations (Prisma, Drizzle, Django, Rails, Flyway, Alembic).
- **When not to apply / counterpoints:**
  - Editing a migration never applied outside one developer's machine is harmless, but git history cannot prove that; ask.
  - Squashing is a supported, deliberate operation in some ORMs and should not be flagged as an edit.
- **Fix risk:** high

### G107-F24 — Lint migrations for locking and destructive operations
**Rule:** Lint unapplied and new SQL migrations for locking or destructive operations, with squawk (Postgres) or strong_migrations (Rails; also supports MySQL and MariaDB). Checks to enable:
- `require-concurrent-index-creation`;
- `constraint-missing-not-valid`;
- `adding-not-nullable-field`;
- `ban-drop-column`;
- `changing-column-type`;
- `adding-foreign-key-constraint`;
- `require-timeout-settings` and `require-lock-timeout`.

Migrations should set a low `lock_timeout` and retry. Adding NOT NULL, CHECK, UNIQUE or FK constraints is REPORT-ONLY. Where it is adopted, use `ADD CONSTRAINT … NOT VALID` followed by `VALIDATE CONSTRAINT`. PostgreSQL 18 also allows NOT VALID not-null constraints.

- **Grade:** A · **Verdict:** CORRECTED. Two fixes:
  - The Postgres.ai quote was reworded. The post's literal command is `set statement_timeout = '50ms';` (quoting depesz). It also discusses "retries with `lock_timeout = '50ms'`" and recommends "low timeout values (either `lock_timeout` or `statement_timeout`)".
  - The GoCardless date is confirmed as 2015: the earliest Wayback capture is 2015-10-09, and the site now shows a 2019 republish date.
- **Rationale:**
  - PostgreSQL takes an ACCESS EXCLUSIVE lock for ALTER TABLE unless noted otherwise. SET NOT NULL scans the whole table (unless NOT VALID), and a volatile DEFAULT rewrites the table.
  - NOT VALID followed by VALIDATE needs only SHARE UPDATE EXCLUSIVE.
  - A DDL statement waiting in the lock queue blocks every later query on that table. GoCardless had about 15 s of API downtime from an FK addition queued behind a long read.
- **Evidence:**
  - [ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) — PostgreSQL Global Development Group, docs 18.6, 2026 — official docs.
    - "An ACCESS EXCLUSIVE lock is acquired unless explicitly noted."
    - "With NOT VALID, the ADD CONSTRAINT command does not scan the table and can be committed immediately"; "validation acquires only a SHARE UPDATE EXCLUSIVE lock".
    - SET NOT NULL "is checked during the ALTER TABLE by scanning the entire table, unless NOT VALID is specified".
    - "Adding a column with a volatile DEFAULT … will cause the entire table and its indexes to be rewritten."

    Verified.
  - [strong_migrations README](https://github.com/ankane/strong_migrations) — Andrew Kane, 2026 — official docs. "In Postgres, adding an index non-concurrently blocks writes." "Adding a foreign key blocks writes on both tables." "In Postgres, setting `NOT NULL` on an existing column blocks reads and writes while every row is checked." Example `StrongMigrations.lock_timeout = 10.seconds`. Verified.
  - [Squawk rules](https://squawkhq.com/docs/rules) — sbdchd/squawk v2.66.0, 2026 — official docs. The rules above, plus `renaming-column` and `ban-concurrent-index-creation-in-transaction`, all exist; each doc page returns 200, while a bogus rule returns 404. Verified.
  - [Zero-downtime Postgres migrations: the hard parts](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts/) — GoCardless Engineering (Chris Sinjakli), 2015 — incident report. "around 15 seconds of unexpected API downtime"; "Postgres takes `AccessExclusive` locks on both the table with the constraint, and the one it references"; "Set lock_timeout in your migration scripts to a pause your app can tolerate." Verified.
  - [Zero-downtime Postgres schema migrations need this: lock_timeout and retries](https://postgres.ai/blog/20210923-zero-downtime-postgres-schema-migrations-lock-timeout-and-retries) — Nikolay Samokhvalov, Postgres.ai, 2021 — engineering blog. "Our session with a DDL attempt (pid=78), while waiting to acquire the ACCESS EXCLUSIVE lock it needs, starts blocking others." It recommends low `lock_timeout` or `statement_timeout` (50 ms examples) plus retries with exponential backoff and jitter. Verified (quote corrected).
- **Detect:**
  - `squawk migrations/**/*.sql`
  - Rails: add the strong_migrations gem.
  - Grep fallback: `grep -rnEi 'CREATE (UNIQUE )?INDEX [^C]|CREATE (UNIQUE )?INDEX C[^O]|DROP (COLUMN|TABLE)|SET NOT NULL|ADD COLUMN .*NOT NULL|ADD CONSTRAINT .*(FOREIGN KEY|CHECK)|ALTER COLUMN .* TYPE|RENAME (COLUMN|TO)' <migrations_dir> | grep -viE 'NOT VALID|CONCURRENTLY'`
  - `grep -rLi 'lock_timeout' <migrations_dir>`
- **Tools:** squawk v2.66.0, strong_migrations, django-pg-zero-downtime-migrations, grep.
- **Applies to:** Postgres-backed projects with live traffic; strong_migrations also covers MySQL and MariaDB.
- **When not to apply / counterpoints:**
  - On small tables or with no concurrent traffic, the locking risk is negligible and the warnings are noise.
  - `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, and some ORMs wrap every migration in one (squawk `ban-concurrent-index-creation-in-transaction`). The "fix" can break the migration runner.
  - No empirical study of migration-linter effectiveness was found.
- **Fix risk:** high

### G107-F01 — Every CI gate must be able to fail the pipeline
**Rule:** Every gate CI runs must be able to fail the pipeline. List every masking construct in CI config and in the scripts CI calls:
- step- or job-level `continue-on-error: true`;
- `|| true`, `|| :` and `|| exit 0`;
- `set +e`;
- GitLab `allow_failure: true`;
- `--passWithNoTests`;
- scanner switches that force success: checkov `--soft-fail`, hadolint `--no-fail`, trivy `--exit-code 0`;
- trivy steps with no `--exit-code 1`, because trivy exits 0 by default;
- package.json scripts that chain a gate with `;` or end in `|| exit 0`.

Remove masking only after the gate is proven green locally, and only with approval.

- **Grade:** B · **Verdict:** CORRECTED. Three fixes:
  - The runner#1851 attribution: the commenter who wrote "By default, the fail fast is not applied" is marked CONTRIBUTOR by GitHub, not maintainer.
  - The survey figure is 64% of the 25 respondents to that item, not of all 26.
  - Trivy's default exit code of 0 and hadolint `--no-fail` were added as verified masking cases.
- **Rationale:**
  - A failing task that still yields a green build defeats the purpose of CI.
  - GitHub and GitLab document the masking semantics explicitly.
  - An AI coding agent has been observed adding `continue-on-error: true` to make deployment checks pass.
  - In actions/runner#1851, a 2025 commenter traced a "green but tests failed" report to the npm/Jest invocation, not to the runner. So package.json scripts need checking too.
- **Evidence:**
  - [An Empirical Characterization of Bad Practices in Continuous Integration](https://www.ifi.uzh.ch/seal/people/vassallo/ZampettiEMSE2019.pdf) — Zampetti, Vassallo, Panichella, Canfora, Gall, Di Penta, EMSE 25(2):1095–1135, 2020 — peer-reviewed (author pre-print).
    - A catalog of 79 CI bad smells in 7 categories, from 13 interviews and more than 2,300 SO posts; the survey had 26 developers.
    - BP16 "A build is succeeded when a task is failed or an error is thrown": n=25, 28% disagree / 8% neutral / 64% agree.
    - "ignoring the outcome of a task when determining the build status (BP16) defeats the primary purpose of CI."
    - BP8 "Pipeline steps/stages are skipped arbitrarily": n=24, 46% / 8% / 46%.

    Verified in the PDF; venue confirmed on Crossref.
  - [Workflow syntax: continue-on-error](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — GitHub, 2026 — official docs. "Prevents a job from failing when a step fails. Set to `true` to allow a job to pass when this step fails." The doc also shows `continue-on-error: ${{ matrix.experimental }}`. Verified.
  - [CI/CD YAML syntax: allow_failure](https://docs.gitlab.com/ci/yaml/#allow_failure) — GitLab, 2026 — official docs. The pipeline is successful and "the associated commit is marked as passed with no warnings". Manual jobs default to `allow_failure: true`. Verified.
  - [Trivy: exit code](https://github.com/aquasecurity/trivy/blob/main/docs/guide/configuration/others.md) — Aqua Security, 2026 — official docs. "By default, `Trivy` exits with code 0 even when security issues are detected." Added in this pass.
  - [hadolint CLI `--no-fail`](https://github.com/hadolint/hadolint) — hadolint, 2026 — official docs. "Don't exit with a failure status code when any rule is violated". Added in this pass.
  - [HN comment on "Show HN: Optio"](https://news.ycombinator.com/item?id=47527397) — ElFitz, 2026-03-26 — practitioner forum. "My favourite so far was Claude "fixing" deployment checks with `continue-on-error: true`". Verified via the Algolia API.
  - [Jest test failed but Github Action said that is success/pass (actions/runner#1851)](https://github.com/actions/runner/issues/1851) — GitHub issue thread, 2022–2025 — practitioner forum.
    - 2022-07-11, nikola-jokic (CONTRIBUTOR): "By default, the fail fast is not applied", suggesting `shell: bash`.
    - 2023 and 2024 commenters: `shell: bash` did not fix it for them.
    - 2025-04-10, rugoncalves: "the bug does not appear to be from the runner itself, but rather from either npm or JEST". Their workaround captures the output and greps it.

    Verified via the GitHub API.
- **Detect:**
  - `grep -rnE 'continue-on-error:\s*true|\|\|\s*(true|:|exit 0)|allow_failure:\s*true|--passWithNoTests|--soft-fail|--no-fail|--exit-code 0|set \+e' .github/ .gitlab-ci.yml package.json Makefile justfile scripts/ 2>/dev/null`
  - `grep -rn 'trivy' .github .gitlab-ci.yml | grep -v -- '--exit-code 1'`
  - Check job-level `continue-on-error`, and `if: always()` or `if: ${{ !cancelled() }}` on deploy or publish steps after tests.
  - package.json: `jq -r '.scripts|to_entries[]|"\(.key) => \(.value)"' package.json | tr -d '\r' | grep -E '\|\| (true|exit 0)| ; |--passWithNoTests'`. The `tr` handles CRLF output from jq on Windows.
- **Tools:** grep (Git Bash), jq, python+PyYAML.
- **Applies to:** GitHub Actions, GitLab CI, and any CI that calls package.json, Makefile or justfile scripts.
- **When not to apply / counterpoints:**
  - Deliberate non-blocking jobs are legitimate, such as GitHub's own `continue-on-error: ${{ matrix.experimental }}`.
  - Advisory scanners with high false-positive rates are often non-blocking on purpose (Zampetti cites Wedyan et al.).
  - Zampetti's survey split 46/46 on skipping steps.
  - Flag each case; never delete masking automatically.
- **Fix risk:** medium

### G107-F03 — CI must run the project's own gates through the same entry point
**Rule:** Check that CI runs the project's own gates through the same entry point developers use locally.
1. List the local gates: package.json scripts (typecheck, lint, test, build, format:check), Makefile or justfile targets, and pre-commit hooks.
2. Confirm each gate is invoked by a workflow triggered on `pull_request` and on push to the default branch.
3. Prefer thin CI YAML that calls `pnpm run <gate>`, `make <target>` or `just <recipe>`.

Report missing gates. Adding one needs approval.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Zampetti's respondents largely agree that local/remote misalignment is a smell.
  - Large-scale GitHub Actions studies report build-without-test workflows.
  - Felidré et al. show CI "theater": builds that stay broken for days.
  - Practitioners converge on "CI runs what devs run locally".
- **Evidence:**
  - [An Empirical Characterization of Bad Practices in CI](https://www.ifi.uzh.ch/seal/people/vassallo/ZampettiEMSE2019.pdf) — Zampetti et al., EMSE, 2020 — peer-reviewed. R3 "Local and remote workspace are not aligned": n=25, 30% disagree / 13% neutral / 57% agree. Verified.
  - [An Empirical Study of Complexity, Heterogeneity, and Compliance of GitHub Actions Workflows](https://arxiv.org/abs/2507.18062) — Abrokwah & Ghaleb, 2025 (v2 2026-08-03) — preprint. "Java has the lowest explicit test adoption"; "Build-without-test patterns suggest that workflow design is driven more by ecosystem conventions and platform defaults than by best practices." Verified (abstract only).
  - [Continuous Integration Theater](https://arxiv.org/abs/1907.01602) — Felidré, Furtado, da Costa, Cartaxo, Pinto, ESEM 2019 — peer-reviewed. 1,270 Travis CI projects: "85% of the studied projects have at least one broken build that take more than four days to be fixed". Average coverage was 78% across only the 51 projects with coverage data, and some were near 4%. Verified (abstract).
  - [HN: Moving Away from Travis CI](https://news.ycombinator.com/item?id=25156699) — stevekemp, 2020 — practitioner forum. "I should keep the CI-system very simple and essentially run "make test", "make build", etc. Having the actual test/build scripts inside the repositories means that a human could easily run the same things interactively". Verified.
  - [HN: Ask HN: How Long Is Your CI Process?](https://news.ycombinator.com/item?id=27007696) — john-tells-all, 2021 — practitioner forum. "CICD should just run things Devs can run locally." "When CICD tests fail, it's very easy for Devs to figure out what went wrong". Verified.
- **Detect:**
  - `for s in $(jq -r '.scripts|keys[]' package.json | tr -d '\r'); do grep -rqE "(pnpm|npm|yarn|bun)( run)? $s(\s|$|\")" .github/workflows || echo "not in CI: $s"; done`, then classify the results (dev and start are expected; typecheck, lint, test and build are gaps).
  - `grep -nE '^on:|pull_request|push:' .github/workflows/*.y*ml`
  - For Make or just projects, compare `make -qp | grep -E '^[a-z-]+:'` or `just --summary` against the workflows.
- **Tools:** jq, grep, `just --summary`, `make -qp`.
- **Applies to:** any repository with CI.
- **When not to apply / counterpoints:**
  - Some gates legitimately run elsewhere: PaaS builds, nightly suites, or separate required-check apps.
  - Zampetti's authors do not treat nightly builds as something to avoid, which contradicts older literature (Duvall).
  - Thin YAML moves logic into scripts, and those scripts then need F16–F18 hygiene.
  - The survey sample is small (25 respondents).
- **Fix risk:** medium

### G107-F05 — Lint workflows with actionlint and zizmor, and triage the output
**Rule:** Lint every workflow with actionlint and zizmor, optionally also poutine. Triage the output instead of bulk-fixing it.
- **Fix inside the pass:**
  - actionlint correctness findings (unknown keys, bad expressions, type errors, shellcheck findings in `run:`);
  - zizmor `template-injection` (the move to `env:`).
- **Approval items:** permissions, pinning and trigger changes.
- **Ignore in a hardening pass:** pedantic and auditor persona findings.

Do not treat one scanner's silence as proof of safety.

- **Grade:** B · **Verdict:** CORRECTED. Two fixes:
  - zizmor `typosquat-uses` works offline, per its audits table.
  - The false-positive counts include PRs, as detailed under Evidence.
- **Rationale:**
  - Fares et al. compared 9 scanners on 2,722 workflows. The scanners implement "fundamentally different analysis strategies", and "no single scanner covers all identified security weaknesses".
  - Their recommended fundamental tier is actionlint + poutine.
  - zizmor's broader coverage brings "lower-confidence findings that may be noisy".
  - actionlint is fast, and runs ShellCheck and pyflakes on `run:`.
- **Evidence:**
  - [Unpacking Security Scanners for GitHub Actions Workflows](https://arxiv.org/html/2601.14455v2) — Fares, Gamage, Baudry, 2026 — preprint. Verified in the v2 HTML:
    - Table V: poutine 125 vs zizmor 3,620 Artifact Integrity Weaknesses;
    - "zizmor increases coverage but also leads to more lower-confidence findings that may be noisy";
    - "we suggest adding actionlint and poutine to all workflows";
    - median per-workflow time "below 0.53s for actionlint";
    - scharf "detects weaknesses even in lines that are commented out".
  - [actionlint checks](https://github.com/rhysd/actionlint/blob/main/docs/checks.md) — rhysd/actionlint v1.7.12, 2026 — official docs. It replaces `${{ }}` with underscores before shellcheck and disables SC1091, SC2050, SC2194, SC2154, SC2157 and SC2043. It includes pyflakes, script-injection, deprecated-command and constant-`if:` checks. Verified.
  - [zizmor audit rules](https://docs.zizmor.sh/audits/) — zizmorcore v1.30.1, 2026 — official docs.
    - `anonymous-definition`, `concurrency-limits`, `self-hosted-runner`, `stale-action-refs` and `undocumented-permissions` are "`--pedantic` only".
    - `impostor-commit`, `known-vulnerable-actions`, `ref-confusion` and `stale-action-refs` do not work offline.
    - `typosquat-uses` works offline.

    Verified from docs/audits.md.
  - [GitHub issue search: false positives](https://github.com/zizmorcore/zizmor/issues?q=label%3Afalse-positive) — GitHub API, 2026-09-23 — other.
    - zizmor: 42 issues and PRs carry the `false-positive` label, 30 of them issues.
    - actionlint: 62 issues and PRs mention "false positive", 44 of them issues.
    - zizmor #1865 (superfluous-actions on a self-hosted runner) and #1914 (bot-conditions) are titled as false positives but labelled `bug`. actionlint #701 is the workflow_call secrets typing report.

    Counts re-queried (the researcher's 42/62 counted PRs too).
- **Detect:**
  - `actionlint -color` (install shellcheck and pyflakes so that `run:` blocks are checked).
  - `zizmor --offline .github/workflows` (default persona is regular).
  - Optional: `poutine analyze_local .` (per the poutine README).
  - None of these tools were run in this task.
- **Tools:** actionlint v1.7.12, zizmor v1.30.1, poutine v1.1.6, shellcheck.
- **Applies to:** GitHub Actions workflows and composite actions.
- **When not to apply / counterpoints:**
  - The literature (Fares: actionlint + poutine) and practice (zizmor widely promoted) conflict here.
  - Permissions and pinning belong to T15/T16.
  - Scanners are an attack vector themselves (Trivy CVE-2026-33634, F11). Pin scanner actions by SHA and keep secrets away from scan jobs.
- **Fix risk:** low

### G107-F07 — Explicit job timeouts and PR concurrency
**Rule:**
- Give every CI job an explicit `timeout-minutes` sized to its observed runtime. The GitHub default is 360.
- Add `concurrency` with `cancel-in-progress` to PR workflows.
- Both are pipeline behaviour changes and need approval.
- Least-privilege `permissions:` belongs to T15/T16, but report it here when missing.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** A hung job otherwise burns up to six hours of runner time. Two recent studies measured widespread non-compliance with timeout and permission practices.
- **Evidence:**
  - [Workflow syntax: timeout-minutes](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — GitHub, 2026 — official docs. "The maximum number of minutes to let a job run before GitHub automatically cancels it. Default: 360". Verified.
  - [An Empirical Study of Complexity, Heterogeneity, and Compliance of GitHub Actions Workflows](https://arxiv.org/abs/2507.18062) — Abrokwah & Ghaleb, 2025 — preprint. "Compliance gaps are widespread, especially in permissions, timeout configuration, and SHA pinning". Verified (abstract).
  - [How Compliant Are GitHub Actions Workflows?](https://arxiv.org/abs/2605.02091) — Abrokwah & Ghaleb, EASE '26 (accepted), 2026 — peer-reviewed. On 95 Java workflows: "overall compliance is 28%, dropping to 4% for permission controls; Security (26%) lags far behind Clarity (68%)". LLM auditors had "fair agreement (Fleiss' kappa = 0.28)". Verified (abstract).
- **Detect:**
  - `python -c "import yaml,glob;[print(f,j) for f in glob.glob('.github/workflows/*.y*ml') for j,v in (yaml.safe_load(open(f)) or {}).get('jobs',{}).items() if 'timeout-minutes' not in v and 'uses' not in v]"`
  - `grep -L 'concurrency:' .github/workflows/*.y*ml`
  - zizmor `concurrency-limits` is pedantic only.
- **Tools:** python+PyYAML, grep, zizmor (pedantic).
- **Applies to:** GitHub Actions. GitLab has a `timeout:` keyword, not verified here.
- **When not to apply / counterpoints:**
  - A timeout set too low turns slow but healthy jobs into flaky failures.
  - The EASE study covers only 95 Java workflows, with low LLM inter-rater agreement.
  - The harm of missing timeouts is inferred from the default, not measured.
- **Fix risk:** medium

### G107-F09 — Report on build determinism for published artifacts
**Rule:**
- For projects that publish artifacts, report on build determinism.
- Set `SOURCE_DATE_EPOCH` from the last commit (`git log -1 --pretty=%ct`) in the release build, and pass it to BuildKit/Buildx.
- This is report-only or approval work.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Embedded build dates cause about 15% of the unreproducible failures in a rebuild of 709,816 Nix packages. SOURCE_DATE_EPOCH is the cross-tool standard, and Docker documents that it sets image index, config and file-metadata timestamps.
- **Evidence:**
  - [SOURCE_DATE_EPOCH](https://reproducible-builds.org/docs/source-date-epoch/) — Reproducible Builds project, 2026 — standard. "`SOURCE_DATE_EPOCH` is a standardised environment variable that distributions can set centrally and have build tools consume this in order to produce reproducible output." Recipe: `export SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)`. Verified.
  - [Does Functional Package Management Enable Reproducible Builds at Scale? Yes](https://arxiv.org/abs/2501.15919) — Malka, Zacchiroli, Zimmermann, MSR 2025 — peer-reviewed. "rebuilding 709 816 packages"; "bitwise reproducibility rates, between 69 and 91%"; "about 15% of failures are due to embedded build dates." Verified (abstract and Crossref).
  - [Reproducible Builds: Increasing the Integrity of Software Supply Chains](https://arxiv.org/abs/2104.06020) — Lamb & Zacchiroli, IEEE Software 39(2), 2022 — peer-reviewed. "trusting code is not the same as trusting its executable counterparts". Verified (abstract and Crossref).
  - [Reproducible builds with GitHub Actions](https://docs.docker.com/build/ci/github-actions/reproducible-builds/) — Docker, 2026 — official docs. "Setting the environment variable for a build makes the timestamps in the image index, config, and file metadata reflect the specified Unix time." Verified.
- **Detect:**
  - `grep -rn SOURCE_DATE_EPOCH .github Dockerfile* Makefile justfile package.json`
  - `grep -rnE 'new Date\(\)|date \+|BUILD_(DATE|TIME)' scripts build* vite.config.* webpack.config.* 2>/dev/null`
  - To verify: build twice and diff the digests, or use diffoscope.
- **Tools:** git, docker buildx, diffoscope.
- **Applies to:** projects releasing images or packages. Low priority for apps a PaaS deploys from source.
- **When not to apply / counterpoints:**
  - Bit-for-bit reproducibility is costly and pays off mostly for supply-chain verification.
  - The 15% figure is Nix-specific.
  - Setting SOURCE_DATE_EPOCH changes any build time an app displays to users.
- **Fix risk:** medium

### G107-F11 — Lint Dockerfiles with maintained, rule-ID-based tools and triage by class
**Rule:** Lint Dockerfiles with maintained, rule-ID-based tools:
- Docker build checks: `docker build --check .`, which needs Dockerfile frontend 1.8+ and Buildx 0.15+;
- hadolint, which runs ShellCheck on RUN;
- `trivy config`, run with `--exit-code 1` if it is meant to gate.

Triage by class instead of chasing zero:
- fix correctness and security findings: shell-form CMD/ENTRYPOINT, a root USER, secrets in ARG/ENV;
- treat style and size findings as optional;
- never auto-apply apt version pinning (F15).

dockle scans built images, not Dockerfiles, and its last release was January 2025.

- **Grade:** B · **Verdict:** CORRECTED. Four fixes:
  - Docker's `CopyIgnoredFile` check is marked experimental in the build-checks index.
  - trivy exits 0 by default.
  - The 99% figure comes from one company's Dockerfiles and is tool-defined (Hadolint, ShellCheck, Trivy).
  - DockerMock's percentages are averages over 183 faults in 146 Dockerfiles, and the paper is an arXiv preprint.
- **Rationale:**
  - Smells are near-universal, so an unprioritised list is noise.
  - Linters target smells, not build breakage: DockerMock reports that hadolint caught 6.5% of build faults and BuildKit 60.5%.
  - Tool status in 2026 (GitHub API): hadolint v2.15.1 (after a Nov 2022–Sep 2025 gap), trivy v0.74.0, dockle v0.4.15 (Jan 2025). tfsec's README points to Trivy.
- **Evidence:**
  - [Build checks](https://docs.docker.com/build/checks/) — Docker, 2026 — official docs.
    - "Build checks are a feature introduced in Dockerfile 1.8"; "Buildx version 0.15.0 and later".
    - "Invoking a build runs the checks by default".
    - `# check=error=true` makes violations fail the build.
    - The rule index includes JSONArgsRecommended, SecretsUsedInArgOrEnv and UndefinedVar; CopyIgnoredFile is experimental.

    Verified.
  - [Closing the Gap: Secure Dockerfile Reference Standards via Semantic Clustering in Enterprise Inner Source](https://arxiv.org/abs/2608.25793) — Hösl, Hofmann, Stöckle, ASE 2026 Industry Showcase (accepted) — peer-reviewed. 11,470 Dockerfiles from over 6,200 repositories "at a single large industrial company": "99% of files contain at least one security misconfiguration, 80.8% violate Dockerfile best practices". Verified (abstract).
  - [Fixing Dockerfile smells: an empirical study](https://link.springer.com/content/pdf/10.1007/s10664-024-10471-7.pdf) — Rosa et al., EMSE 29:108, 2024 — peer-reviewed.
    - Citing Wu et al. 2020 (6,334 projects): "nearly 84% of GitHub projects containing Dockerfiles are affected by Dockerfile smells".
    - Citing Eng & Hindle: the version-pinning smells DL3006, DL3008, DL3013 and DL3016 "are the most prevalent".

    Verified in the PDF; Wu, Cito and Eng & Hindle were not opened first-hand.
  - [DockerMock](https://arxiv.org/abs/2104.05490) — Li, Bai, Ma, Pei, 2021 — preprint. Across 53 faults in 41 GitHub Dockerfiles and 130 faults in 105 student Dockerfiles: "DockerMock detected 68.0% … hadolint detected 6.5%, and baseline BuildKit detected 60.5%". Verified (abstract).
  - [hadolint README and releases](https://github.com/hadolint/hadolint) — hadolint, 2026 — official docs.
    - DL3002 "Last user should not be root."
    - DL3025 "Use arguments JSON notation for CMD and ENTRYPOINT arguments".
    - DL4006 "Set the `SHELL` option -o pipefail before `RUN` with a pipe in it".
    - `--failure-threshold` exists; there is no `--only` flag.
    - Releases: v2.12.0 2022-11-09, v2.12.1-beta 2022-11-14, v2.13.1 2025-09-02, v2.15.1 2026-07-31.

    Verified.
  - [dockle README](https://github.com/goodwithtech/dockle) — goodwithtech, 2025 — official docs. It scans images. CIS-DI-0001 "Create a user for the container"; CIS-DI-0010 "Do not store secrets in Dockerfiles"; DKL-DI-0005 "Clear `apt-get` caches". Last release v0.4.15 on 2025-01-06. Verified.
  - [GHSA-69fq-xp46-6x23 / CVE-2026-33634](https://github.com/advisories/GHSA-69fq-xp46-6x23) — Aqua Security (GitHub Advisory), 2026 — incident report. "On March 19, 2026, a threat actor used compromised credentials to publish a malicious Trivy v0.69.4 release, force-push 76 of 77 version tags in `aquasecurity/trivy-action` to credential-stealing malware". The advisory also covers all 7 setup-trivy tags and the v0.69.5/0.69.6 DockerHub images on March 22. Verified via the GitHub API; rated critical.
- **Detect:**
  - `docker build --check .` (add `# check=error=true` only with approval).
  - `hadolint --failure-threshold warning Dockerfile*`
  - `trivy config --severity HIGH,CRITICAL --exit-code 1 .`
  - Grep fallbacks:
    - `grep -nE '^\s*(ENTRYPOINT|CMD)\s+[^[ ]' Dockerfile*`
    - `grep -qiE '^\s*USER\s+' Dockerfile || echo 'no USER'`
    - `grep -nE '^\s*ADD\s' Dockerfile*`
    - `grep -niE '^\s*(ARG|ENV)\s+[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE)' Dockerfile*`
    - `ls .dockerignore`
- **Tools:** docker build --check, hadolint v2.15.1, trivy config v0.74.0, dockle v0.4.15 (image-level, unmaintained since Jan 2025).
- **Applies to:** every Dockerfile, including Railway, Fly and ECS deploy images and dev containers.
- **When not to apply / counterpoints:**
  - Pin scanner actions and binaries by SHA or digest (Trivy compromise).
  - hadolint had a near-three-year release gap, so its maintenance risk is real.
  - Rosa: 11% of the rejections came from developers whose Dockerfiles serve testing or dev only.
  - The 99% figure reflects one company's tool-based definitions.
- **Fix risk:** low

### G107-F15 — Apply only the Dockerfile fixes developers accept; do not blanket-pin OS packages
**Rule:**
- **Do in the pass:**
  - `apt-get update && apt-get install --no-install-recommends … && rm -rf /var/lib/apt/lists/*` in one RUN;
  - COPY instead of ADD for local files (DL3020);
  - an explicit base-image tag instead of none or `latest` (DL3006/DL3007; digests belong to T16);
  - replace the deprecated MAINTAINER (DL4000).
- **Report only:** apt/apk version pinning (DL3008/DL3018). Pinned Debian/Ubuntu versions disappear from mirrors and break rebuilds.

- **Grade:** B · **Verdict:** CORRECTED. Three fixes:
  - hadolint has no `--only` flag, so the detection was rewritten.
  - The "snapshot mirror" alternative was the researcher's addition. Rosa's PR respondents suggested only "an automated script to periodically pin the package versions".
  - Rosa's prose says DL3008 had "47% acceptance", but Table 3 shows 7 of 15 (47%) rejected and 3 (20%) merged. The table is used here.
- **Rationale:**
  - Rosa et al. submitted 143 smell-fixing PRs; 58% were accepted or merged.
  - DL4000 (92%), DL3020 (71%) and DL3006 (69%) were accepted most.
  - DL3008 was the most rejected. One merged pin caused a build failure within a month.
  - DL3009 apt-list cleanup was merged only 33% of the time.
- **Evidence:**
  - [Fixing Dockerfile smells: an empirical study](https://link.springer.com/content/pdf/10.1007/s10664-024-10471-7.pdf) — Rosa, Zappone, Scalabrino, Oliveto, EMSE 29:108, 2024 — peer-reviewed.
    - Total: 83 of 143 (58%) accepted or merged, 27 (19%) rejected, 33 (23%) ignored.
    - DL4000: 12/13 (92%). DL3020: 10/14 (71%). DL3006: 9/13 (69%).
    - DL3008: 7/15 (47%) rejected, 3 (20%) merged. DL3009: 4/12 (33%).
    - "after a month the version pinning for the package ca-certificates caused a build failure because the pinned version was not available anymore".

    The PRs were generated by the authors' Dockleaner tool and manually checked. Verified in the PDF.
  - [HN comment on "Docker Security Cheat Sheet"](https://news.ycombinator.com/item?id=26447004) — hivacruz, 2021 — practitioner forum. "When I build new images and it fails because the pinned version is not available anymore, I have to dig into Debian or Ubuntu packages websites to find the new ones as they don't keep the old packages online." Verified.
  - [Building best practices: apt-get, ADD vs COPY, pinning](https://docs.docker.com/build/building/best-practices/) — Docker, 2026 — official docs.
    - "Always combine `RUN apt-get update` with `apt-get install` in the same `RUN` statement."
    - Removing `/var/lib/apt/lists` "reduces the image size".
    - ADD "supports features for fetching files from remote HTTPS and Git URLs, and extracting tar files automatically".
    - Version pinning example `package-foo=1.3.*`: "can also reduce failures due to unanticipated changes in required packages".

    Verified.
  - [Parfum: Detection and Automatic Repair of Dockerfile Smells](https://arxiv.org/abs/2302.01707) — Durieux, 2023 — preprint. "Parfum is able to repair 806 245 Docker smells"; 20 of 35 PRs merged. Verified (abstract).
- **Detect:**
  - `hadolint -f json Dockerfile* | jq -r '.[] | select(.code|test("DL3009|DL3015|DL3020|DL3006|DL3007|DL4000")) | "\(.file):\(.line) \(.code) \(.message)"'`
  - `grep -nE 'apt-get install' Dockerfile* | grep -v no-install-recommends`
  - `grep -nE '^\s*ADD\s' Dockerfile*`
  - `grep -nE '^\s*FROM\s+[^:@ ]+(\s|$)|:latest' Dockerfile*`
- **Tools:** hadolint, docker build --check, Parfum (research).
- **Applies to:** Debian-, Ubuntu- and Alpine-based Dockerfiles.
- **When not to apply / counterpoints:**
  - Docker's docs present wildcard pinning (`=1.3.*`) as cache busting and reproducibility, which conflicts with Rosa.
  - A periodic automated re-pinning script (suggested to Rosa) is a middle path.
  - Official Debian/Ubuntu images already run `apt-get clean`. DL3009 cleanup was often rejected for build-time reasons.
  - ADD is still right for intentional tar extraction or a checksummed remote fetch (`ADD --checksum`).
- **Fix risk:** medium

### G107-F16 — Run ShellCheck on every shell script and fix high-value rules
**Rule:** Run ShellCheck on every shell script: repo scripts, CI `run:` via actionlint, and Dockerfile RUN via hadolint. Fix high-value findings and re-run the tests after each group:
- SC2155 (declare and assign separately);
- SC2164 (`cd … || exit`);
- SC1017 (CRLF);
- SC2046 and SC2086 (unquoted expansions);
- optionally SC2312 (`enable=check-extra-masked-returns`).

- **Grade:** B · **Verdict:** CORRECTED. Three fixes:
  - Only SC2312's wiki page gives the host `/etc` overwrite example; SC2164's page lists general `cd` failure causes.
  - Bash in the Wild measured "error-proneness" by static analysis, not by observed bugs.
  - The Google guide was re-typed as a style guide, not a book.
- **Rationale:**
  - A study of more than 1M GitHub Bash scripts found them "often error-prone" by static analysis. Error-proneness correlates moderately with size, and quoting and error handling are among the top problem areas.
  - Google recommends ShellCheck "for all scripts, large or small".
- **Evidence:**
  - [Bash in the Wild: Language Usage, Code Smells, and Bugs](https://doi.org/10.1145/3517193) — Dong, Li, Tian, Sun, Godfrey, Nagappan, ACM TOSEM 32(1), 2023 — peer-reviewed. "analyses over one million open source Bash scripts"; "Using static analysis, we find that Bash scripts are often error-prone, and the error-proneness has a moderately positive correlation with the size of the scripts"; "the most common problem areas concern quoting, resource management, command options, permissions, and error handling." Verified (Crossref abstract; full text not accessed).
  - [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html) — Google, living document — style guide. "The ShellCheck project identifies common bugs and warnings for your shell scripts. It is recommended for all scripts, large or small." "Always quote strings containing variables, command substitutions, spaces or shell meta characters, unless careful unquoted expansion is required". Verified.
  - [SC2155](https://www.shellcheck.net/wiki/SC2155) — koalaman/shellcheck, 2026 — official docs. "Declare and assign separately to avoid masking return values." "`export` will instead always return true. This may prevent conditionals, `set -e` and traps from working correctly." Verified.
  - [SC2164](https://www.shellcheck.net/wiki/SC2164) — koalaman/shellcheck, 2026 — official docs. "Use `cd ... || exit` in case `cd` fails." "`cd` can fail for a variety of reasons: misspelled paths, missing directories, missing permissions, broken symlinks and more." The page also notes that a `set -e` anywhere in the script disables this warning. Verified.
  - [SC2312](https://www.shellcheck.net/wiki/SC2312) — koalaman/shellcheck, 2026 — official docs. Optional; enable with `enable=check-extra-masked-returns`. "the command being run will be `cd "/etc"` and the script will proceed to overwrite the host system's configuration." Verified.
  - [SC2086](https://www.shellcheck.net/wiki/SC2086) — koalaman/shellcheck, 2026 — official docs. "Double quote to prevent globbing and word splitting." For intended splitting, use arrays: `options=(-j 5 -B)`. Verified.
- **Detect:**
  - `git ls-files '*.sh' '*.bash' | xargs shellcheck -f gcc`
  - Extensionless scripts: `git ls-files | xargs grep -lE '^#!.*(ba)?sh' 2>/dev/null`
  - Optional `.shellcheckrc` with `enable=check-extra-masked-returns`.
  - CI blocks via actionlint; Dockerfiles via hadolint.
- **Tools:** shellcheck v0.11.0, actionlint, hadolint.
- **Applies to:** all sh/bash scripts, including Git Bash helper scripts, entrypoint.sh and CI inline scripts.
- **When not to apply / counterpoints:**
  - The SC2086 quoting fix CHANGES behaviour when splitting was intended. Convert to arrays and test.
  - Bash in the Wild is correlational, its outcome is static-analysis warnings, and the abstract gives no per-rule bug rates.
- **Fix risk:** medium

### G107-F17 — Do not blanket-add `set -euo pipefail` to working scripts
**Rule:**
- Do NOT blanket-add `set -euo pipefail` to existing, working scripts during a hardening pass.
- Prefer explicit checks on the commands that matter, plus ShellCheck (F16).
- If strict mode is adopted, do it per script with tests. Account for these pitfalls:
  - set -e is suspended inside functions called from if, `&&` or `||`;
  - `local v=$(cmd)` masks failures;
  - pipefail with `| head` or `| grep -q` can fail spuriously;
  - set -u aborts on intentionally unset variables;
  - behaviour varies across Bash versions and POSIX mode.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** BashFAQ/105 documents that the set -e rules are "extremely convoluted" and change between Bash versions. Re-verified in Git Bash 5.2.37:
  - `set -e; f(){ local v=$(false); echo still running; }; f` prints "still running";
  - `if f; then` runs past a `false` inside f;
  - `false | tee` survives without pipefail.
- **Evidence:**
  - [BashFAQ/105](https://web.archive.org/web/2026id_/https://mywiki.wooledge.org/BashFAQ/105?action=raw) — Wooledge wiki (GreyCat, rking, geirha et al.), living document — practitioner wiki. Verified in the raw text:
    - "These rules are extremely convoluted, and they still fail to catch even some remarkably simple cases. Even worse, the rules change from one Bash version to another";
    - "As soon as a function is used as a conditional … `set -e` stops being applied within the function";
    - on strict mode: "these claims are dubious at best";
    - "GreyCat's personal recommendation is simple: don't use `set -e`";
    - "rking's personal recommendation is to go ahead and use `set -e`, but beware of possible gotchas";
    - "geirha's personal recommendation is to handle errors properly and not rely on the unreliable `set -e`".
  - [HN thread "Bash Strict Mode (2014)"](https://news.ycombinator.com/item?id=44983442) — Hacker News users, 2025 — practitioner forum. Verified via the Algolia API:
    - xelxebar (45010167): "set -o errexit (i.e. set -e) provides enough unexpected semantics that explicit error handling makes more sense";
    - aidenn0 (45010002): "I stopped using pipefail since the return value can be based on a race";
    - burnt-resistor (45010249): "Use both because they aren't mutex. Shellcheck isn't a complete solution";
    - deathanatos (45009816): "Or just don't use Bash", adding "if you must use bash, set -eu -o pipefail".
  - [SC2155](https://www.shellcheck.net/wiki/SC2155) — koalaman/shellcheck, 2026 — official docs. Masking "may prevent conditionals, `set -e` and traps from working correctly." Verified.
- **Detect:**
  - `grep -LE '^\s*set -[a-z]*e|set -o errexit' $(git ls-files '*.sh')` (report only).
  - `grep -nE '^\s*set -[a-z]*u' $(git ls-files '*.sh')`: review these for `${VAR:-}` defaults.
  - `grep -nE 'local [A-Za-z_]+=\$\(' $(git ls-files '*.sh')`
  - In GitHub Actions, `shell: bash` already applies `-eo pipefail` (F02).
- **Tools:** grep, shellcheck, `bash -n`.
- **Applies to:** existing shell scripts in finished projects, including Git Bash utilities.
- **When not to apply / counterpoints:**
  - The advice conflicts. The "unofficial strict mode" article and many practitioners (including deathanatos, if Bash must be used) recommend strict mode by default.
  - GitHub Actions already runs bash with -e.
  - Google asks for checked return values but does not mandate set -e.
  - The evidence is expert testimony plus reproducible examples, not measured bug rates.
- **Fix risk:** high

### G107-F08 — One committed source of truth per toolchain
**Rule:** Keep ONE committed source of truth per toolchain and make CI read it:
- Node: `.nvmrc` or `.node-version`, used via setup-node `node-version-file`;
- package manager: `packageManager` with version and hash, and/or `devEngines`;
- `engines`: enforced only with `engine-strict=true`;
- Python: `.python-version` plus `requires-python`;
- Rust: `rust-toolchain.toml`.

A pin equal to what CI already uses is safe; changing a version needs approval.

- **Grade:** C (was B) · **Verdict:** DOWNGRADED. The mechanics are verified from official docs. But the rule's benefit (fewer version-drift failures) rests only on indirect evidence: Dockerfile flakiness from dependency and environment drift. No study links pin files to fewer failures, as the researcher also noted.
- **Rationale:**
  - Unenforced version declarations are advisory. npm `engines` is advisory unless engine-strict is set.
  - Corepack is not bundled from Node 25, so `packageManager` enforcement needs a separately installed Corepack or the package manager's own handling.
  - Environment and dependency drift causes Docker build failures with no source change.
- **Evidence:**
  - [package.json: engines and devEngines](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) — npm, 2026 — official docs. "Unless the user has set the `engine-strict` config flag, this field is advisory only and will only produce warnings when your package is installed as a dependency." devEngines `onFail` "can be `warn`, `error`, or `ignore`, and if left undefined is of the same value as `error`." Verified in the npm/cli docs source.
  - [Corepack README](https://github.com/nodejs/corepack#readme) — Node.js, 2026 — official docs. "Corepack is distributed with Node.js from version 14.19.0 up to (but not including) 25.0.0." For `packageManager`, "The hash is optional but strongly recommended". Verified. The repo is not archived; last push 2026-09-18.
  - [rustup overrides](https://rust-lang.github.io/rustup/overrides.html) — Rust project, 2026 — official docs. Precedence: `+toolchain` shorthand, then `RUSTUP_TOOLCHAIN`, then directory override, then `rust-toolchain.toml`, then default. Directory overrides and the toolchain file are also ranked by proximity. Verified.
  - [uv: Python versions](https://docs.astral.sh/uv/concepts/python-versions/) — Astral, 2026 — official docs. "uv searches for a `.python-version` file in the working directory and each of its parents"; the first compatible version is used "unless a version is otherwise requested, e.g., via a `.python-version` file". Verified.
  - [Dockerfile Flakiness: Characterization and Repair](https://arxiv.org/abs/2408.05379) — Shabani, Nashid, Alian, Mesbah, 2024 — preprint. "nine-month analysis of 8,132 Dockerized projects, revealing that around 10% exhibit flaky behavior"; causes include "dependency errors and server connectivity issues"; "flakiness occurs without modifications to the Dockerfile itself". Verified (abstract). This is indirect support.
- **Detect:**
  - `ls .nvmrc .node-version .python-version rust-toolchain.toml rust-toolchain 2>/dev/null`
  - `jq -r '.packageManager, .engines, .devEngines' package.json`
  - `grep -rnE 'node-version:|python-version:|toolchain:' .github/workflows`
  - `grep -n engine-strict .npmrc`
  - Compare the Dockerfile's `FROM node:<v>` against `.nvmrc`.
- **Tools:** jq, grep, actions/setup-node `node-version-file`, `uv python pin`, rustup.
- **Applies to:** Node/TS, Python and Rust projects, and Dockerfile base-image tags.
- **When not to apply / counterpoints:**
  - Libraries should test a version range in a matrix, not a single pin.
  - engine-strict can block contributors on newer Node versions.
  - How to enforce `packageManager` after Node 25 is unresolved: see open questions.
- **Fix risk:** low

### G107-F10 — Run the repo's git hooks in CI too
**Rule:**
- If the repo uses pre-commit (or husky/lefthook), run the same hooks in CI (`pre-commit run --all-files`).
- Make every hook `rev:` an immutable tag or SHA.
- Adding the CI step needs approval, because it may fail on files never checked before.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** pre-commit's docs assume immutable revs and recommend running on all files when hooks are added. Practitioners report skipping slow hooks with `--no-verify` and relying on CI to catch it.
- **Evidence:**
  - [pre-commit](https://pre-commit.com/) — pre-commit (Anthony Sottile), 2026 — official docs. "pre-commit assumes that the value of rev is an immutable ref (such as a tag or SHA) and will cache based on that." "it's usually a good idea to run the hooks against all of the files when adding new hooks". Verified.
  - [HN comment on "Prek"](https://news.ycombinator.com/item?id=46875201) — schindlabua, 2026 — practitioner forum. "In projects where they are forced upon me I frequently --no-verify hooks if they are slow, as the linter runs on save and I run tests during development." Verified.
  - [HN comment on "Python Is Eating the World"](https://news.ycombinator.com/item?id=20673587) — guitarbill, 2019 — practitioner forum. "you can run the pre-commit checks during CI to catch situations where somebody forgot to install the hooks or discovered `--no-verify`". Verified.
- **Detect:**
  - `ls .pre-commit-config.yaml .husky lefthook.yml 2>/dev/null`
  - `grep -nE '^\s*rev:\s*(main|master|HEAD)\s*$' .pre-commit-config.yaml`
  - `grep -rn 'pre-commit run' .github/workflows || echo 'hooks not enforced in CI'`
- **Tools:** pre-commit, prek, grep.
- **Applies to:** repos with git hooks.
- **When not to apply / counterpoints:**
  - If CI already runs the same linters directly (F03), running them again through pre-commit adds runtime without new coverage.
  - The evidence is practitioner consensus, not measured.
- **Fix risk:** medium

### G107-F18 — Report long shell scripts as porting candidates; do not rewrite them
**Rule:**
- Report, do not rewrite, shell scripts over roughly 100 lines or with non-trivial control flow.
- Mark them as candidates for porting to the project's main language.
- A rewrite is out of scope for a behaviour-preserving pass.

- **Grade:** C · **Verdict:** VERIFIED (with a nuance: Dong's size correlation is with static-analysis warnings, not observed bugs).
- **Rationale:**
  - Google sets the 100-line threshold.
  - Dong et al. report that tool-measured error-proneness correlates with script size.
  - Zampetti lists "the abuse of shell scripts" among uncovered CI bad practices.
- **Evidence:**
  - [Google Shell Style Guide: When to use Shell](https://google.github.io/styleguide/shellguide.html) — Google, living document — style guide. "Shell should only be used for small utilities or simple wrapper scripts." "If you are writing a script that is more than 100 lines long, or that uses non-straightforward control flow logic, you should rewrite it in a more structured language now." Verified.
  - [Bash in the Wild](https://doi.org/10.1145/3517193) — Dong et al., TOSEM 32(1), 2023 — peer-reviewed. "Using static analysis, … the error-proneness has a moderately positive correlation with the size of the scripts". Verified (abstract).
  - [An Empirical Characterization of Bad Practices in CI](https://www.ifi.uzh.ch/seal/people/vassallo/ZampettiEMSE2019.pdf) — Zampetti et al., EMSE, 2020 — peer-reviewed. The abstract names "the abuse of shell scripts". Such scripts "can exhibit maintainability issues, or even introduce portability problems on different machines". But I7 ("Use shell scripts for a task for which there is a suitable plugin available", n=25) was 44% disagree / 36% neutral / 20% agree. Verified.
- **Detect:** `git ls-files '*.sh' '*.bash' | xargs wc -l | sort -rn | awk '$1>100'`
- **Tools:** wc, git ls-files.
- **Applies to:** repo scripts (deploy, setup, backup).
- **When not to apply / counterpoints:**
  - The threshold is one company's convention.
  - Zampetti's respondents mostly disagreed with I7.
  - Porting adds a runtime dependency to bootstrap steps that now need only sh.
- **Fix risk:** high

## Practitioner voice

- [HN: Claude "fixing" deployment checks](https://news.ycombinator.com/item?id=47527397): an AI coding agent "fixed" failing deployment checks by adding `continue-on-error: true` (ElFitz, 2026-03-26). This is exactly the masking a hardening pass must detect.
- [actions/runner#1851](https://github.com/actions/runner/issues/1851): Jest failed but the job was green.
  - A runner contributor (not a maintainer) said fail-fast is not applied by default and suggested `shell: bash`.
  - Later users said that did not help.
  - A 2025 commenter traced it to the npm/Jest invocation, so package.json scripts must be checked too.
- [HN: no real "allow failure" in GitHub Actions](https://news.ycombinator.com/item?id=30924186): a user in the "We use GitHub Actions to build GitHub" thread (2022) complains that GitHub Actions has no allow-failure modifier and that `continue-on-error` "is not the same".
- [HN: set -e differs inside functions](https://news.ycombinator.com/item?id=45010167): shows `[ -f x ] && cmd` behaving differently at top level and inside a function under set -e, and argues for explicit error handling (2025).
- [HN: pipefail race](https://news.ycombinator.com/item?id=45010002): stopped using pipefail because the status "can be based on a race" (SIGPIPE).
- [HN: use both](https://news.ycombinator.com/item?id=45010249): use both set -e and ShellCheck; "Shellcheck isn't a complete solution".
- [HN: just don't use Bash](https://news.ycombinator.com/item?id=45009816): suggests Python instead of Bash. If Bash is a must, it recommends `set -eu -o pipefail`.
- [HN: pinned apt versions vanish](https://news.ycombinator.com/item?id=26447004): hadolint DL3008 pins break rebuilds because Debian and Ubuntu mirrors drop old versions. This matches Rosa's ca-certificates failure.
- [HN: --no-verify on slow hooks](https://news.ycombinator.com/item?id=46875201): a developer routinely bypasses slow pre-commit hooks, so local hooks cannot be the only gate.
- [HN: run pre-commit in CI](https://news.ycombinator.com/item?id=20673587): run the pre-commit checks in CI to catch people who never installed the hooks or used `--no-verify`.
- [HN: keep CI thin](https://news.ycombinator.com/item?id=25156699): keep CI thin ("make test", "make build") so a human can run the same thing locally.
- [HN: CI should run what devs run](https://news.ycombinator.com/item?id=27007696): "CICD should just run things Devs can run locally", which makes failures easy to diagnose.
- [GoCardless postmortem (2015)](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts/): an FK migration queued behind a long read for an AccessExclusive lock and caused about 15 s of API downtime. Lessons: set lock_timeout and split schema changes.
- [Trivy supply-chain compromise (GHSA-69fq-xp46-6x23)](https://github.com/advisories/GHSA-69fq-xp46-6x23): in March 2026, 76 of 77 trivy-action tags were force-pushed to credential-stealing malware. CI scanners must be SHA-pinned and kept away from secrets.

## Contradictions and open questions

**Contradictions**
- **set -e / strict mode.**
  - For: rking on BashFAQ/105 says use it but beware; the "unofficial strict mode" article; HN "use both"; deathanatos says if Bash is a must, use `set -eu -o pipefail`.
  - Against: GreyCat and geirha on the same page ("don't use set -e"; strict-mode claims "dubious at best"); xelxebar on HN prefers explicit handling.
  - GitHub Actions applies -e by default, and pipefail with `shell: bash`. Google asks for checked return values without mandating set -e.
- **Apt package version pinning.** Docker's docs present wildcard pinning as reproducibility and cache busting, and hadolint DL3008 flags unpinned packages. Rosa et al. found it the most-rejected fix (7/15 rejected, 3/15 merged), and a merged pin broke a build within a month. Rosa's own prose ("47% acceptance") also contradicts its Table 3 (47% rejected).
- **Skipping CI steps.** An interviewee said "To skip tests is always an antipattern", yet BP8 split 46/46 (n=24). The authors found this surprising.
- **Nightly builds.** Zampetti et al. say their results contradict the literature on avoiding nightly builds (Duvall). BP14 was 48% agree / 36% disagree.
- **Shell in CI.** Zampetti's abstract highlights "the abuse of shell scripts", but I7 was 44% disagree / 20% agree. Meanwhile practitioners push CI logic into repo scripts (thin YAML).
- **Which GitHub Actions scanner.** zizmor is widely promoted. Fares et al. recommend actionlint + poutine as the base tier and call zizmor's findings lower-confidence and possibly noisy. Artifact-integrity counts differ by 29x (125 vs 3,620).
- **Linters vs build breakage.** hadolint caught 6.5% of build faults and BuildKit 60.5% (DockerMock, small sample, preprint).
- **Exec-form ENTRYPOINT.** It is recommended for signal handling but drops `$PORT`-style expansion that PaaS platforms rely on.
- **Scanner-driven IaC "fixes".** Targeted removal (83.3%) differs sharply from real fixes (10.4% full-scanner clean; 71.4% deceptive among plan-compared repairs; TerraProbe preprint).
- **Jest CI mode.** Researchers often cite `--ci` as a must-add. Jest already enables it when ci-info detects CI, so the real risk is only CI that Jest does not detect, or explicit `--ci=false`.

**Open questions**
- No measured false-positive or precision rates were found for checkov, trivy config or KICS on real Terraform or CloudFormation.
- Seed leads were not verified first-hand: Vassallo ICSE 2019 CI-Odor, Cito MSR 2017, Wu 2020 (known only via Rosa 2024), Henkel ICSE 2020 binnacle, and Bouzenia & Pradel ICSE 2024.
- No study links toolchain pin files or a single task-runner entry point to fewer "works on my machine" failures.
- How to enforce `packageManager` in CI after Corepack stopped being bundled with Node 25 (pnpm's own version management, npm `devEngines` with onFail:error, or a separate Corepack install) is not verified.
- Whether PowerShell 7.4+ `$PSNativeCommandUseErrorActionPreference`, combined with GitHub's prepended `$ErrorActionPreference='stop'`, makes native non-zero exits fail mid-script on Windows runners is not verified.
- No empirical evaluation of migration linters was found.
- Hygiene for Railway, Vercel and nixpacks config was not researched.
- No per-rule ShellCheck bug-reduction evidence was found. Bash in the Wild's full text (ACM) was not accessed.
- Whether BusyBox ash in Alpine images supports `set -o pipefail` for the Dockerfile `SHELL` fix is not verified here.

## Dropped findings

None. All 24 findings survived; 12 needed corrections and 1 was downgraded. Corrected detection details worth repeating:
- `hadolint --only` does not exist (F02, F15);
- `checkov --framework docker_compose` does not exist (F22);
- zizmor `typosquat-uses` works offline (F05).
