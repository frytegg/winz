#!/usr/bin/env python3
"""Self-setup: infer the run profile, and clear every command before it runs.

Purpose
    protocol-preflight step 6a and PF-23 (user-policy-autonomy U01-F05, U01-F08 to U01-F10;
    pilot-auto-calibration A01-F23 to A01-F26). In autonomous mode without an owner profile the
    owner's /harden invocation is the consent, and this script writes the run profile itself.
    It lists every candidate command (GitHub Actions steps, package.json scripts, the
    inventory's toolchain and task-runner commands), resolves each one's script chain to leaves
    the way each package manager documents it, scans the files each leaf loads or executes for
    live, key, secret-file and network signals, and gives each candidate a verdict:
      forbidden     a leaf deploys, signs, publishes, pushes, forks or selects a live network,
                    handles keys, downloads outside the lockfile, selects a live-tier
                    configuration, or loads a secret file that exists: banned in
                    forbidden_commands, in package-manager and execution forms anchored at a
                    command position;
      excluded      left out, with the reason: unresolved, long-running, writes files, installs
                    mid-chain, starts a browser, runs a secret scanner, needs a missing tool, is
                    a tool the classifier does not know, or shows a weak network signal without
                    CI evidence ("unproven");
      allowed-ci    a GitHub-hosted Actions job runs it literally with no secrets, vars or
                    environment reference, no continue-on-error and no job-level `if:`;
      allowed-source every leaf is a known static, build, runner or file leaf whose scan
                    completed and found no network client.
    Allowed candidates become gates when they cover a static, build or runner leaf no earlier
    gate covers (CI-evidenced candidates first, then the others, each in priority order). A
    strong live signal forbids a command even when CI runs it.

    Scope of this version (the reviewer's scoped v1): npm, pnpm, Yarn 1 to 4 and bun chains,
    run-s/run-p/npm-run-all, concurrently, turbo and lerna run, make and just targets; the
    GitHub Actions parser (job-level `if:`, matrix runs-on, defaults.run.working-directory);
    static leaves (tsc, eslint, next lint, prettier --check, and the other checkers of the
    table below), build leaves, the runners vitest, jest, mocha, hardhat test, node --test,
    pytest, cargo test, go test, forge test and bun test, and file leaves with their local
    import graph. Anything else is `excluded: unsupported`, which is safe.

Guarantees
    - It reads only files tracked at the base commit (from the working tree), and never a file
      whose name matches SECRET_FILE_RE (dotenv files, keys, keystores, .npmrc and the like), a
      vendored or generated path, a file under .yarn/ or node_modules/, a file over 1 MiB or a
      tracked symlink that leaves the repository. Exceptions, third-party manifests rather than
      secrets: node_modules/<runner>/package.json (its "bin" only) and .yarnrc.yml (the keys
      yarnPath, nodeLinker, enableTelemetry and injectEnvironmentFiles, by line).
    - Untracked paths (dotenv targets, node_modules, .pnp.cjs, .venv, dotenv files of ancestor
      directories, .harden/active) are checked for existence only, never opened.
    - It reads environment variable names, never a value (PATH only through shutil.which).
    - `infer` and `finalize` run no project code. Their only subprocesses are git commands that
      list files, resolve revisions and read core.hooksPath, and `git ls-files --others
      --ignored --exclude-standard --directory` (names only). `probe` is the one part that runs
      project code: each gate alone through gates.py, with the inferred environment.
    - probe also proposes a CLI's documented offline subcommands (pilot-auto-calibration
      A01-F57): it reads the built JavaScript of the entry and of the local modules it imports
      (inside the package directory, never under node_modules, never a secret-named file, at
      most 1 MiB each), and runs each surviving name once under Node's permission model where
      it is stable and then twice exactly as persisted, under `assets/offline-guard.cjs`, with
      NODE_OPTIONS emptied; a name is kept only when both runs exit 0 with the same non-empty
      normalised output that differs from the help output, draw no guard refusal, print
      nothing that looks like a secret and leave the tree clean (at most 3 per CLI, 8 in all).
    - Every snippet it writes goes through redact().
    - The same repository, inventory, environment names, review and --now give byte-identical
      outputs.

Classification
    Leaves and the files scanned for each (configs; executed or selected files):
      static   tsc, vue-tsc, eslint, next lint, prettier --check, biome, oxlint, stylelint,
               markdownlint, solhint, shellcheck, ruff, black, isort, flake8, mypy, pyright,
               basedpyright, gofmt, go vet, golangci-lint, forge fmt --check: an executable
               JS/TS config only.
      build    next build (next.config.* and app/, pages/), hardhat compile|check|typechain
               (hardhat config and its import graph), cargo check|clippy|build, forge build,
               vite build, webpack, tsup, esbuild, rollup, parcel. hardhat clean writes and
               hardhat flatten prints sources: neither is a gate.
      runner   vitest, jest, mocha, hardhat test, node --test, pytest, python -m pytest|
               unittest, cargo test, go test, forge test, bun test: the runner config and
               setup files, and the selected test files.
      file     node|ts-node|tsx|bun|deno run|python|bash|sh <tracked file>, hardhat run <file>:
               the file and its local import graph (depth 4, 400 files).
    Signals: L1 publish/deploy/push, L2 live network or fork, L3 key handling (file leaves),
    L4 live-tier config or include glob, L5 unpinned download, L6 live-default client, T name
    tokens, S1 secret file load (dotenv, Next.js and Vite env files, Yarn 4 .env.yarn), S3 key
    file read (and Hardhat vars named like a secret) forbid; S2 secret-named env reads are
    recorded; N1 URL literals, N2 network clients and graph_incomplete (dynamic imports,
    spawned processes, shell files) are weak and make a candidate without CI evidence
    "unproven". SECRET_NAME_RE is PF-03's list: the gates' allowlist strips every such name.

Outputs (--out-dir, default <repo>/.harden)
    profile.inferred.json         the draft profile (the final one after finalize)
    profile-inference.json        every candidate with its chain, leaves, signals, verdict and
                                  evidence; installs, CI jobs, bans with their signal ids,
                                  environment names, credential files (names), commit hooks,
                                  money_path_hints, review list, limits
    profile-probe.config.json     the draft's gates and e2e checks as gates.py gates (only when
                                  there is one)
    profile-install.config.json   config_install as gates.py gates (only with an install entry)
    profile-setup.config.json     the installs whose dependencies are missing (only then)
    project-env.sh                sourced before any project command run outside gates.py: it
                                  unsets the excluded variable names and turns telemetry off
    profile-probe-e2e-more.config.json  the probe's discovered-subcommand checks (A01-F57)
    profile-e2e-discovery.json    every proposed subcommand with its state and reason, the
                                  node version and the permission flags the probe used

CLI
    python infer_profile.py infer    [--repo DIR] [--base REV] [--inventory FILE] [--out-dir DIR]
                                     [--review FILE] [--owner-profile FILE] [--now ISO] [--json]
    python infer_profile.py probe    [--repo DIR] [--out-dir DIR] [--json]
    python infer_profile.py finalize [--repo DIR] [--base REV] [--out-dir DIR] [--probe FILE]...
                                     [--install] [--json]
    (use python3 on macOS/Linux)
    infer     classifies and writes the outputs; never .harden/profile.json. --review applies
              .harden/profile-review.json ({"drop": [...], "forbid": [...]}), which may only
              drop a gate or e2e check or add a ban, each with <tracked path>:<line> evidence.
              --owner-profile fills owner_comparison and writes nothing else of the owner's.
    probe     runs each gate of profile-probe.config.json alone through gates.py (label
              infer-probe-<gate>), restores and records any tracked file a gate changed
              (gates/infer-probe-writers.json), then the e2e checks twice (infer-probe-e2e),
              then the discovered subcommands (infer-probe-e2e-more-perm once under Node's
              permission model where it is stable, infer-probe-e2e-more twice as persisted;
              A01-F57). It needs a clean tree.
    finalize  reads the probe records (every gates/infer-probe-*.json, plus --probe FILE):
              drops a gate that could not run or wrote a tracked file, keeps a test, build or
              typecheck gate that ran red (PF-11 decides), turns a red lint or format gate
              with a countable violation line into a ratchet, drops a red e2e check, sets
              mode report-only without a test gate (PF-20). --install validates the profile
              and writes the untracked .harden/profile.json.

Exit codes
    0  written (probe: every gate ran, whatever its verdict)
    2  usage or environment error: not a git work tree, the inventory missing, a run active
       (infer), a bad --review, a dirty tree (probe), a missing draft or a probe record of
       other gate definitions (finalize)
    3  --install refused: a run is active, an owner or tracked profile exists, or the result is
       invalid
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as C  # noqa: E402
import gates as G  # noqa: E402
import inventory as inv  # noqa: E402
import validate_profile as vp  # noqa: E402
import verify_branch as vb  # noqa: E402

TOOL = "infer_profile.py"
TOOL_VERSION = 1
SCHEMA_VERSION = 1
MAX_FILE_BYTES = 1024 * 1024
MAX_CHAIN_DEPTH = 12
GRAPH_DEPTH = 4
GRAPH_FILES = 400
SCOPE_FILES = 2000
IGNORED_WALK_DEPTH = 4
IGNORED_WALK_ENTRIES = 5000
REPARSE_POINT = 0x400
# The ancestor-directory walk for dotenv files stops here (tests set their temp root); None
# walks to the filesystem root.
ANCESTOR_STOP: Optional[str] = None

PROFILE_NAME = "profile.json"
DRAFT_NAME = "profile.inferred.json"
REPORT_NAME = "profile-inference.json"
PROBE_CONFIG_NAME = "profile-probe.config.json"
INSTALL_CONFIG_NAME = "profile-install.config.json"
SETUP_CONFIG_NAME = "profile-setup.config.json"
ENV_SCRIPT_NAME = "project-env.sh"
PREVIOUS_NAME = "profile.previous.json"
WRITERS_NAME = "infer-probe-writers.json"
PROBE_PREFIX = "infer-probe-"
PROBE_E2E_LABEL = "infer-probe-e2e"
PROBE_E2E_MORE_LABEL = "infer-probe-e2e-more"
PROBE_E2E_PERM_LABEL = "infer-probe-e2e-more-perm"
E2E_MORE_CONFIG_NAME = "profile-probe-e2e-more.config.json"
DISCOVERY_NAME = "profile-e2e-discovery.json"
GUARD_PATH = (Path(__file__).resolve().parent.parent / "assets" / "offline-guard.cjs").as_posix()
GUARD_MARK = "harden-offline-guard: refused "
GUARD_EXIT = 97
# A CLI keeps at most 3 subcommands so that one package cannot crowd out the others of a
# monorepo; 8 in all bound the verifier: 8 checks x 2 clones x the 60 s timeout is 16 minutes
# at worst per iteration, while a typical informational subcommand exits in under a second.
E2E_MORE_PER_BIN = 3
E2E_MORE_TOTAL = 8
# At most this many candidates are probed before run start (A01-F57).
E2E_PROBE_PER_BIN = 6
E2E_PROBE_TOTAL = 16
E2E_MORE_TIMEOUT_S = 60          # the timeout the --help checks already use
# Closure bounds: an informational subcommand reaches tens of bodies; a closure past these
# bounds is not proven and the name is excluded (the conservative default).
CLOSURE_MAX_BODIES = 300
CLOSURE_MAX_FILES = 60
CLOSURE_MAX_DEPTH = 12
WIDEN_MAX_FILES = 200
SUBCOMMAND_RE = re.compile(r"^[a-z][a-z0-9:_-]{0,39}$")
ACTIVE_NAME = "active"
CONSENT = "the owner's /harden invocation (user-policy-autonomy U01-F05)"

SECRET_FILE_RE = re.compile(
    r"(?i)^(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?"
    r"|.*keystore.*|.*\.secret|secrets?\.(json|ya?ml|toml)|credentials(\.json)?|\.npmrc"
    r"|\.pypirc|\.netrc|\.envrc|\.dev\.vars|\.git-credentials|.*\.tfvars(\.json)?"
    r"|.*\.tfstate(\.backup)?|.*\.jks|.*\.gpg|.*\.kdbx|.*service[-_]?account.*\.json)$")
# PF-03's credential-like names: S2 records them and the allowlist strips them.
SECRET_NAME_RE = re.compile(r"prod|DATABASE_URL|TOKEN|SECRET|KEY|PASSWORD|PRIVATE|MNEMONIC|SEED"
                            r"|RPC|AWS_|GOOGLE_APPLICATION|RAILWAY|VERCEL", re.IGNORECASE)
T_TOKENS = frozenset(["deploy", "publish", "release", "push", "live", "mainnet", "testnet",
                      "fork", "forking", "signed", "sign", "signer", "wallet", "account",
                      "accounts", "key", "keys", "pk", "privkey", "secret", "secrets", "mnemonic",
                      "reveal", "faucet", "broadcast", "airdrop"])
LIVE_ENV_TOKENS = frozenset(["fork", "forking", "mainnet", "testnet", "live"])
# Verbs whose conventional meaning mutates state, reaches a service, prints configuration or
# financial state, or runs until stopped: a proposed subcommand whose name holds one of these
# tokens is never run at all (a denylist only removes; pilot-auto-calibration A01-F57).
SUBCOMMAND_DENY = frozenset(T_TOKENS | {
    "serve", "server", "start", "dev", "watch", "daemon", "listen", "run", "exec", "shell",
    "repl", "console", "init", "install", "uninstall", "add", "remove", "rm", "delete", "del",
    "clean", "reset", "migrate", "seed", "upgrade", "update", "login", "logout", "auth", "sync",
    "upload", "send", "submit", "order", "trade", "buy", "sell", "withdraw", "transfer", "mint",
    "burn", "approve", "stake", "unstake", "swap", "bridge", "claim", "pull", "fetch",
    "download", "open", "edit", "set", "write", "import", "export", "backup", "restore",
    "config", "configure", "env", "settings", "credentials", "creds", "token", "tokens",
    "whoami", "balance", "balances", "portfolio", "positions", "test", "bench", "benchmark",
    "generate", "gen", "build", "compile", "fix", "format", "fmt", "lint", "clear", "purge",
    "prune", "kill", "stop", "restart", "reload", "notify"})
NETWORK_MODULES = frozenset([
    "net", "http", "https", "http2", "tls", "dgram", "dns", "undici", "axios", "got", "ky",
    "node-fetch", "superagent", "ws", "socket.io-client", "ethers", "viem", "web3", "ccxt",
    "@hashgraph/sdk", "@solana/web3.js", "pg", "mysql2", "mongodb", "redis", "ioredis",
    "nodemailer", "@prisma/client", "openai", "@anthropic-ai/sdk"])  # plus @aws-sdk/, @google-cloud/
CHILD_MODULES = frozenset(["child_process", "worker_threads", "cluster", "execa"])
STATE_MODULES = frozenset(["node:sqlite", "sqlite", "better-sqlite3", "sqlite3", "level",
                           "classic-level", "lmdb", "typeorm", "sequelize", "knex", "drizzle-orm",
                           "@mikro-orm/core", "kysely", "lowdb", "nedb", "@seald-io/nedb", "conf",
                           "configstore", "rc", "env-paths", "keytar", "@napi-rs/keyring"])
WRITE_RE = re.compile(r"\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream"
                      r"|mkdirSync|mkdtemp|mkdtempSync|rmSync|rmdirSync|unlink|unlinkSync"
                      r"|rename|renameSync|copyFile|copyFileSync|cpSync|symlinkSync|truncateSync)"
                      r"\s*\(|\bfs\.(?:mkdir|rm|rmdir|cp|symlink|truncate)\s*\(")
WORKER_RE = re.compile(r"\bnew\s+Worker\s*\(|\bprocess\.dlopen\b|\bprocess\.loadEnvFile\s*\(")
USER_STATE_RE = re.compile(r"\bos\.homedir\s*\(|\bhomedir\s*\(|\bprocess\.env\.(?:HOME|USERPROFILE"
                           r"|APPDATA|LOCALAPPDATA|XDG_[A-Z_]+)\b|\bprocess\.env\[\s*[\"'](?:HOME"
                           r"|USERPROFILE|APPDATA|LOCALAPPDATA|XDG_[A-Z_]+)[\"']\s*\]")
BROWSER_PACKAGES = frozenset(["playwright", "@playwright/test", "puppeteer", "puppeteer-core",
                              "cypress", "selenium-webdriver", "webdriverio"])
SWITCH_CONTEXT_TOKENS = frozenset(["fork", "forking", "mainnet", "testnet", "rpc"])
FIXED_LIVE_SWITCHES = ("HARDHAT_NETWORK", "FOUNDRY_ETH_RPC_URL", "ETH_RPC_URL")
TELEMETRY_ENV = {"yarn": ("YARN_ENABLE_TELEMETRY", "0"),
                 "next": ("NEXT_TELEMETRY_DISABLED", "1")}
LOCAL_NETWORKS = frozenset(["hardhat", "localhost", "in-process"])
IGNORED_WALK_SKIP = frozenset(["node_modules", ".next", "artifacts", "cache", "typechain-types",
                               "coverage", "dist", "build", "target", ".venv", ".git"])
DOTENV_NAMES = (".env", ".env.local", ".env.production")
MODE_ENV_NAMES = (".env", ".env.local", ".env.development", ".env.development.local",
                  ".env.production", ".env.production.local", ".env.test", ".env.test.local")
COUNT_REGEXES = {"vitest": r"Tests\s+(\d+) passed", "mocha": r"(\d+) passing",
                 "hardhat test": r"(\d+) passing", "pytest": r"(\d+) passed",
                 "cargo test": r"test result: ok\. (\d+) passed"}
# assets/config.example.json's violation counts (PF-11 ratchets).
RATCHET_REGEXES = {"eslint": (r"(\d+) problems? \(", "sum"),
                   "ruff check": (r"Found (\d+) errors?\.", "sum"),
                   "ruff format": (r"(\d+) files? would be reformatted", "sum"),
                   "cargo fmt": (r"^Diff in ", "matches")}
COULD_NOT_RUN_RE = re.compile(
    r"MODULE_NOT_FOUND|Cannot find module|command not found|is not recognized as an internal "
    r"or external command|ERR_PNPM_|Usage Error|No test files found|no tests ran")
PROBE_REVIEW_KINDS = ("test", "build", "typecheck")
HOSTED_RUNNER_RE = re.compile(r"^(ubuntu|windows|macos)-[\w.-]+$|^xcode-\d+$")
TRUSTED_STEP_IFS = frozenset(["success()", "always()", "!cancelled()", "${{ !cancelled() }}",
                              "${{ success() }}", "${{ always() }}"])
NAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]")
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ASSIGN_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.S)


class InferError(RuntimeError):
    """A usage or environment problem (exit 2)."""


class InstallRefused(RuntimeError):
    """finalize --install refused (exit 3)."""


# ---------------------------------------------------------------------------
# Text helpers: tokens, redaction, comment-free copies
# ---------------------------------------------------------------------------

_CAMEL_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+")


def name_tokens(text: str) -> List[str]:
    """Lower-case tokens of a name, split on non-alphanumerics, camelCase and digits."""
    return [t.lower() for t in _CAMEL_RE.findall(text or "")]


def t_hits(text: str) -> List[str]:
    """The T tokens of a name (script name, path, glob, config file name, env name)."""
    return sorted({t for t in name_tokens(text) if t in T_TOKENS})


def _invisible_ranges() -> List[Tuple[int, int]]:
    return [(0x200B, 0x200F), (0x202A, 0x202E), (0x2060, 0x2064), (0x2066, 0x2069),
            (0xFEFF, 0xFEFF), (0xE0000, 0xE007F)]


_INVISIBLE_RE = re.compile("[" + "".join(
    "{}-{}".format(re.escape(chr(a)), re.escape(chr(b))) for a, b in _invisible_ranges()) + "]")
_BACKSLASH = chr(92)
_URL_CRED_RE = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@")
_MNEMONIC_CALL_RE = re.compile(r"((?:Mnemonic\.)?(?:fromMnemonic|mnemonicToSeed(?:Sync)?"
                               r"|fromPhrase)\s*\()([^)]*)")
_MNEMONIC_WORDS_RE = re.compile(r"([\"'`])(?:[a-z]+ ){11,}[a-z]+\1")
_ASSIGN_SECRET_RE = re.compile(r"(?i)((?:key|secret|token|passw(?:or)?d|mnemonic|seed|private"
                               r"|auth)[\w.-]*)\s*[:=]\s*(\"[^\"]*\"|'[^']*'|\S+)")
_HEX_RE = re.compile(r"(?:0x)?[0-9a-fA-F]{32,}")
_LONG_RE = re.compile(r"[A-Za-z0-9+/=_-]{40,}")


def redact(text: Any, limit: int = 120) -> str:
    """A snippet safe to write: secrets, long tokens and invisible characters masked, at most
    `limit` characters (GA-06 guarantee 5)."""
    out = str(text if text is not None else "")
    out = _INVISIBLE_RE.sub(lambda m: "{}u{{{:04X}}}".format(_BACKSLASH, ord(m.group(0))), out)
    out = _URL_CRED_RE.sub(lambda m: m.group(1) + "<user>:<redacted>@", out)
    out = _MNEMONIC_CALL_RE.sub(lambda m: m.group(1) + "<mnemonic>", out)
    out = _MNEMONIC_WORDS_RE.sub("<mnemonic>", out)
    out = _ASSIGN_SECRET_RE.sub(lambda m: m.group(1) + "=<redacted>", out)
    out = _HEX_RE.sub(lambda m: "<hex:{}>".format(len(m.group(0)) - (
        2 if m.group(0)[:2].lower() == "0x" else 0)), out)
    out = _LONG_RE.sub(lambda m: "<redacted:{}>".format(len(m.group(0))), out)
    out = out.replace("\r", " ").replace("\n", " ").strip()
    return out if len(out) <= limit else out[:limit - 3] + "..."


JS_EXTS = frozenset([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".json",
                     ".jsonc", ".sol", ".rs", ".go", ".java", ".kt", ".c", ".cc", ".cpp", ".h",
                     ".hpp", ".cs", ".swift", ".vue", ".svelte"])
PY_EXTS = frozenset([".py", ".pyi"])
SH_EXTS = frozenset([".sh", ".bash", ".zsh", ".ksh"])
CONF_EXTS = frozenset([".toml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".properties"])


def language_kind(path: str) -> str:
    """js, py, sh, conf or text: which comment syntax the scanner strips."""
    base = posixpath.basename(path).lower()
    ext = os.path.splitext(base)[1]
    if ext in JS_EXTS:
        return "js"
    if ext in PY_EXTS:
        return "py"
    if ext in SH_EXTS or base in ("makefile", "justfile", "gnumakefile"):
        return "sh"
    if ext in CONF_EXTS or base.startswith(".") and ext == "":
        return "conf"
    return "text"


class Code:
    """A comment-free copy of a text and a per-character kind: c code, s string, m comment."""

    def __init__(self, text: str, kind: str) -> None:
        self.text = text
        chars = list(text)
        kinds = bytearray(b"c" * len(text))
        if kind == "js":
            _strip_js(text, chars, kinds)
        elif kind == "py":
            _strip_hash(text, chars, kinds, triple=True)
        elif kind in ("sh", "conf"):
            _strip_hash(text, chars, kinds, triple=False)
        self.clean = "".join(chars)
        self.kinds = bytes(kinds)
        self._lines: Optional[List[int]] = None

    def is_code(self, pos: int) -> bool:
        return 0 <= pos < len(self.kinds) and self.kinds[pos] == ord("c")

    def is_comment(self, pos: int) -> bool:
        return 0 <= pos < len(self.kinds) and self.kinds[pos] == ord("m")

    def line_of(self, pos: int) -> int:
        if self._lines is None:
            self._lines = [i for i, ch in enumerate(self.text) if ch == "\n"]
        lo, hi = 0, len(self._lines)
        while lo < hi:
            mid = (lo + hi) // 2
            if self._lines[mid] < pos:
                lo = mid + 1
            else:
                hi = mid
        return lo + 1

    def line_text(self, line: int) -> str:
        lines = self.clean.split("\n")
        return lines[line - 1] if 0 < line <= len(lines) else ""


def _blank(chars: List[str], kinds: bytearray, start: int, end: int, mark: int) -> None:
    for k in range(start, min(end, len(chars))):
        kinds[k] = mark
        if mark == ord("m") and chars[k] != "\n":
            chars[k] = " "


def _strip_js(text: str, chars: List[str], kinds: bytearray) -> None:
    """C-like comments and strings, with template literals and their ${} expressions."""
    n = len(text)
    i = 0
    stack: List[int] = []
    depth = 0

    def template(start: int) -> Tuple[int, bool]:
        j = start
        while j < n:
            ch = text[j]
            if ch == "\\":
                j += 2
                continue
            if ch == "`":
                return j, True
            if ch == "$" and j + 1 < n and text[j + 1] == "{":
                return j, False
            j += 1
        return n, True

    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            j = text.find("\n", i)
            j = n if j < 0 else j
            _blank(chars, kinds, i, j, ord("m"))
            i = j
            continue
        if ch == "/" and nxt == "*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            _blank(chars, kinds, i, j, ord("m"))
            i = j
            continue
        if ch == "/" and _regex_allowed(text, i):
            j = i + 1
            in_class = False
            while j < n and text[j] != "\n":
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "[":
                    in_class = True
                elif text[j] == "]":
                    in_class = False
                elif text[j] == "/" and not in_class:
                    break
                j += 1
            if j < n and text[j] == "/":
                _blank(chars, kinds, i, j + 1, ord("s"))
                i = j + 1
                continue
        if ch in "\"'":
            j = i + 1
            while j < n and text[j] != ch and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            _blank(chars, kinds, i, min(j + 1, n), ord("s"))
            i = j + 1
            continue
        if ch == "`":
            j, ended = template(i + 1)
            if ended:
                _blank(chars, kinds, i, min(j + 1, n), ord("s"))
                i = j + 1
            else:
                _blank(chars, kinds, i, j, ord("s"))
                stack.append(depth)
                depth += 1
                i = j + 2
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if stack and stack[-1] == depth:
                stack.pop()
                j, ended = template(i + 1)
                if ended:
                    _blank(chars, kinds, i + 1, min(j + 1, n), ord("s"))
                    i = j + 1
                else:
                    _blank(chars, kinds, i + 1, j, ord("s"))
                    stack.append(depth)
                    depth += 1
                    i = j + 2
                continue
        i += 1


_REGEX_KEYWORDS = frozenset(["return", "typeof", "case", "do", "else", "in", "of", "void",
                             "yield", "await", "delete", "instanceof", "new", "throw"])


def _regex_allowed(text: str, i: int) -> bool:
    """True when a `/` at i starts a regular-expression literal (not a division)."""
    k = i - 1
    while k >= 0 and text[k] in " \t\n":
        k -= 1
    if k < 0:
        return True
    prev = text[k]
    if prev in "(,=:[!&|?{};+-*%<>~^":
        return True
    if prev.isalnum() or prev in "_$":
        start = k
        while start > 0 and (text[start - 1].isalnum() or text[start - 1] in "_$"):
            start -= 1
        return text[start:k + 1] in _REGEX_KEYWORDS
    return False


def _strip_hash(text: str, chars: List[str], kinds: bytearray, triple: bool) -> None:
    """#-comments (a comment starts at a line start or after whitespace or `;`) and quotes."""
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if ch == "#" and (i == 0 or text[i - 1] in " \t\n;("):
            j = text.find("\n", i)
            j = n if j < 0 else j
            _blank(chars, kinds, i, j, ord("m"))
            i = j
            continue
        if ch in "\"'":
            quote = ch
            if triple and text.startswith(ch * 3, i):
                quote = ch * 3
            j = i + len(quote)
            while j < n and not text.startswith(quote, j):
                if text[j] == "\\" and quote != "'":
                    j += 2
                    continue
                if len(quote) == 1 and text[j] == "\n":
                    break
                j += 1
            end = min(j + len(quote), n)
            _blank(chars, kinds, i, end, ord("s"))
            i = end
            continue
        i += 1


def load_jsonc(text: str) -> Any:
    """JSON with comments and trailing commas (tsconfig), or ValueError."""
    clean = Code(text, "js").clean
    clean = re.sub(r",(\s*[}\]])", r"\1", clean)
    return json.loads(clean)


def string_literals(fragment: str) -> List[str]:
    """The quoted string literals of a code fragment, in order."""
    return [m.group(2) for m in re.finditer(r"([\"'`])((?:\\.|(?!\1).)*)\1", fragment)]


def fold(text: str) -> str:
    """Whitespace runs folded to one space (the form bans are matched against)."""
    return vp.normalise_command(text)


# ---------------------------------------------------------------------------
# The repository: tracked files, what may be read, existence checks
# ---------------------------------------------------------------------------


def rel_join(directory: str, name: str) -> str:
    """Normalised repo-relative POSIX join ("." for the root)."""
    joined = posixpath.normpath(posixpath.join(directory or ".", C.to_posix(name)))
    return "." if joined in ("", ".") else joined


def rel_dir(path: str) -> str:
    d = posixpath.dirname(path)
    return d if d else "."


def under(path: str, directory: str) -> bool:
    return directory in (".", "") or path == directory or path.startswith(directory + "/")


class Repo:
    """The repository at the base commit: what may be read, and existence checks."""

    def __init__(self, root: Path, base: str, base_sha: str, tracked: Sequence[str]) -> None:
        self.root = root
        self.base = base
        self.base_sha = base_sha
        self.tracked = sorted(set(tracked))
        self.tracked_set = set(self.tracked)
        self._text: Dict[str, Optional[str]] = {}
        self._code: Dict[str, Optional[Code]] = {}
        self.skipped: Dict[str, str] = {}
        self.dirs: Set[str] = set()
        for path in self.tracked:
            d = rel_dir(path)
            while True:
                self.dirs.add(d)
                if d == ".":
                    break
                d = rel_dir(d)

    def abs(self, rel: str) -> Path:
        return self.root / rel if rel not in ("", ".") else self.root

    def exists(self, rel: str) -> bool:
        """Existence only; the path is never opened (guarantee 2)."""
        return os.path.exists(str(self.abs(rel)))

    def isdir(self, rel: str) -> bool:
        return os.path.isdir(str(self.abs(rel)))

    def unreadable(self, rel: str) -> Optional[str]:
        """Why a path may not be read (guarantee 1), or None."""
        if rel not in self.tracked_set:
            return "not tracked"
        base = posixpath.basename(rel)
        if SECRET_FILE_RE.match(base):
            return "secret-named file"
        segs = rel.split("/")
        if "node_modules" in segs[:-1] or rel.startswith(".yarn/"):
            return "dependency directory"
        generated = C.path_generated_reason(rel)
        if generated:
            return generated
        full = self.abs(rel)
        try:
            if os.path.islink(str(full)):
                real = os.path.realpath(str(full))
                root = os.path.realpath(str(self.root))
                if os.path.commonpath([real, root]) != root:
                    return "symlink outside the repository"
            if not full.is_file():
                return "missing in the working tree"
            if full.stat().st_size > MAX_FILE_BYTES:
                return "over 1 MiB"
        except (OSError, ValueError):
            return "cannot be read"
        return None

    def read(self, rel: str) -> Optional[str]:
        """The text of a readable tracked file (BOM dropped, CRLF as LF), or None."""
        if rel in self._text:
            return self._text[rel]
        why = self.unreadable(rel)
        text: Optional[str] = None
        if why is None:
            try:
                text = C.read_text(self.abs(rel), MAX_FILE_BYTES)
            except OSError as exc:
                why = "cannot be read: {}".format(exc.__class__.__name__)
        if text is not None:
            text = text.lstrip(chr(0xFEFF)).replace("\r\n", "\n").replace("\r", "\n")
        else:
            self.skipped[rel] = why or "cannot be read"
        self._text[rel] = text
        return text

    def code(self, rel: str) -> Optional[Code]:
        if rel not in self._code:
            text = self.read(rel)
            self._code[rel] = None if text is None else Code(text, language_kind(rel))
        return self._code[rel]

    def files_under(self, directory: str) -> List[str]:
        return [p for p in self.tracked if under(p, directory)]

    def glob(self, directory: str, patterns: Sequence[str]) -> List[str]:
        """Tracked files under `directory` whose path relative to it matches a glob."""
        out = []
        for p in self.files_under(directory):
            relp = p if directory in (".", "") else p[len(directory) + 1:]
            if any(C.glob_match(relp, pat) for pat in patterns):
                out.append(p)
        return out


# ---------------------------------------------------------------------------
# Packages, package managers, installs
# ---------------------------------------------------------------------------

PM_WORDS = ("npm", "pnpm", "yarn", "bun")
FIXTURE_SEGMENTS = frozenset(["fixtures", "__fixtures__", "fixture", "testdata", "examples",
                              "example", "templates", "template"])


class Package:
    """One tracked package.json."""

    def __init__(self, path: str, data: Dict[str, Any], text: str) -> None:
        self.path = path
        self.dir = rel_dir(path)
        self.data = data
        self.name = data.get("name") if isinstance(data.get("name"), str) else None
        raw = data.get("scripts") if isinstance(data.get("scripts"), dict) else {}
        self.scripts: Dict[str, str] = {k: v for k, v in raw.items()
                                        if isinstance(k, str) and isinstance(v, str)}
        self.script_order = list(self.scripts)
        self.script_lines = _script_lines(text, self.script_order)
        self.kind = "root" if self.dir == "." else "separate"
        self.pm = "npm"
        self.pm_evidence = ""
        self.flavour: Optional[str] = None
        self.project = self.dir
        deps: Set[str] = set()
        for key in ("dependencies", "devDependencies", "optionalDependencies",
                    "peerDependencies"):
            value = data.get(key)
            if isinstance(value, dict):
                deps.update(k for k in value if isinstance(k, str))
        self.deps = deps
        bins = data.get("bin")
        if isinstance(bins, str) and self.name:
            self.bins = {self.name.split("/")[-1]: bins}
        elif isinstance(bins, dict):
            self.bins = {k: v for k, v in bins.items() if isinstance(k, str) and isinstance(v, str)}
        else:
            self.bins = {}


def _script_lines(text: str, names: Sequence[str]) -> Dict[str, int]:
    lines = text.split("\n")
    start = next((i for i, ln in enumerate(lines) if re.search(r"\"scripts\"\s*:", ln)), None)
    found: Dict[str, int] = {}
    if start is None:
        return found
    for name in names:
        needle = re.compile(r"^\s*" + re.escape(json.dumps(name)) + r"\s*:")
        for i in range(start, len(lines)):
            if needle.search(lines[i]):
                found[name] = i + 1
                break
    return found


class Yarnrc:
    """The four .yarnrc.yml keys self-setup may read (guarantee 1)."""

    def __init__(self) -> None:
        self.yarn_path: Optional[str] = None
        self.node_linker: Optional[str] = None
        self.telemetry: Optional[str] = None
        self.inject: List[str] = []
        self.inject_set = False


def read_yarnrc(repo: Repo, directory: str) -> Yarnrc:
    rc = Yarnrc()
    path = rel_join(directory, ".yarnrc.yml")
    if path not in repo.tracked_set:
        return rc
    try:
        text = C.read_text(repo.abs(path), MAX_FILE_BYTES)
    except OSError:
        return rc
    lines = text.replace("\r\n", "\n").split("\n")
    for idx, line in enumerate(lines):
        m = re.match(r"^(yarnPath|nodeLinker|enableTelemetry|injectEnvironmentFiles)\s*:\s*(.*)$",
                     line)
        if not m:
            continue
        key, value = m.group(1), m.group(2).split(" #")[0].strip().strip("\"'")
        if key == "yarnPath":
            rc.yarn_path = C.to_posix(value) or None
        elif key == "nodeLinker":
            rc.node_linker = value or None
        elif key == "enableTelemetry":
            rc.telemetry = value or None
        else:
            rc.inject_set = True
            if value.startswith("["):
                rc.inject = [v.strip().strip("\"'") for v in value.strip("[]").split(",")
                             if v.strip()]
            else:
                for follow in lines[idx + 1:]:
                    item = re.match(r"^\s+-\s*(.+?)\s*$", follow)
                    if not item:
                        break
                    rc.inject.append(item.group(1).strip("\"'"))
    return rc


def yarn_major(pkg_root: Package, repo: Repo) -> Optional[int]:
    value = pkg_root.data.get("packageManager")
    m = vb.PACKAGE_MANAGER_RE.match(value) if isinstance(value, str) else None
    if m and m.group(1).lower() == "yarn":
        return int(m.group(2))
    return None


class Discovery:
    """Everything self-setup learns from the tree before classifying."""

    def __init__(self, repo: Repo) -> None:
        self.repo = repo
        self.packages: Dict[str, Package] = {}
        self.by_name: Dict[str, Package] = {}
        self.workspace_dirs: Set[str] = set()
        self.yarnrc: Dict[str, Yarnrc] = {}
        self.limits: List[str] = []
        self.package_managers: List[Dict[str, Any]] = []
        self.installs: List[Dict[str, Any]] = []
        self.lockfiles: Dict[str, str] = {}

    def package_at(self, directory: str) -> Optional[Package]:
        return self.packages.get(directory)

    def project_root(self, directory: str) -> str:
        pkg = self.nearest_package(directory)
        return pkg.project if pkg is not None else "."

    def nearest_package(self, directory: str) -> Optional[Package]:
        d = directory
        while True:
            if d in self.packages:
                return self.packages[d]
            if d == ".":
                return None
            d = rel_dir(d)

    def pm_of(self, directory: str) -> Tuple[str, Optional[str]]:
        pkg = self.nearest_package(directory)
        if pkg is None:
            return "npm", None
        return pkg.pm, pkg.flavour


def discover_packages(disc: Discovery) -> None:
    repo = disc.repo
    skipped_fixtures = 0
    for path in repo.tracked:
        if posixpath.basename(path) != "package.json":
            continue
        segs = path.split("/")
        if "node_modules" in segs or C.path_generated_reason(path):
            continue
        if any(s.lower() in FIXTURE_SEGMENTS for s in segs[:-1]) or (
                path != "package.json" and C.is_test_path(path)):
            skipped_fixtures += 1
            continue
        text = repo.read(path)
        if text is None:
            continue
        try:
            data = json.loads(text)
        except ValueError:
            disc.limits.append("{} is not valid JSON: its scripts are not candidates".format(path))
            continue
        if isinstance(data, dict):
            disc.packages[rel_dir(path)] = Package(path, data, text)
    if skipped_fixtures:
        disc.limits.append("{} package.json file(s) under a fixture, example, template or test "
                           "directory are not treated as projects".format(skipped_fixtures))
    root = disc.packages.get(".")
    patterns: List[str] = []
    if root is not None:
        ws = root.data.get("workspaces")
        if isinstance(ws, dict):
            ws = ws.get("packages")
        if isinstance(ws, list):
            patterns += [p for p in ws if isinstance(p, str)]
    pnpm_ws = repo.read("pnpm-workspace.yaml") if "pnpm-workspace.yaml" in repo.tracked_set \
        else None
    if pnpm_ws:
        inside = False
        for line in pnpm_ws.split("\n"):
            if re.match(r"^packages\s*:", line):
                inside = True
                continue
            if inside:
                item = re.match(r"^\s+-\s*(['\"]?)(.+?)\1\s*$", line)
                if item:
                    patterns.append(item.group(2))
                elif line.strip() and not line.startswith((" ", "\t")):
                    inside = False
    include = [p.rstrip("/") for p in patterns if not p.startswith("!")]
    exclude = [p[1:].rstrip("/") for p in patterns if p.startswith("!")]
    for d, pkg in disc.packages.items():
        if d == ".":
            continue
        if any(C.glob_match(d, p) for p in include) and not any(C.glob_match(d, p)
                                                                 for p in exclude):
            pkg.kind = "workspace"
            pkg.project = "."
            disc.workspace_dirs.add(d)
    for pkg in disc.packages.values():
        if pkg.name and pkg.name not in disc.by_name:
            disc.by_name[pkg.name] = pkg
    lock_paths = [p for p in repo.tracked if C.lockfile_manager(p)]
    pkgs_data = {p.path: p.data for p in disc.packages.values()}
    for pkg in sorted(disc.packages.values(), key=lambda p: p.path):
        project_pkg = disc.packages.get(pkg.project, pkg)
        pm, evidence = inv.js_package_manager(repo.root, project_pkg.path, pkgs_data, lock_paths)
        pkg.pm, pkg.pm_evidence = pm, evidence
        if pm == "yarn":
            pkg.flavour = yarn_flavour(disc, project_pkg)
    seen: Set[Tuple[str, str]] = set()
    for pkg in sorted(disc.packages.values(), key=lambda p: p.path):
        key = (pkg.project, pkg.pm)
        if key in seen:
            continue
        seen.add(key)
        entry: Dict[str, Any] = {"dir": pkg.project, "name": pkg.pm, "flavour": pkg.flavour,
                                 "lockfile": _lockfile_in(repo, pkg.project),
                                 "evidence": [{"source": pkg.pm_evidence.split(" ")[0] or
                                               pkg.path, "line": None,
                                               "detail": redact(pkg.pm_evidence)}]}
        disc.package_managers.append(entry)


def _lockfile_in(repo: Repo, directory: str) -> Optional[str]:
    for name in ("pnpm-lock.yaml", "yarn.lock", "package-lock.json", "npm-shrinkwrap.json",
                 "bun.lock", "bun.lockb", "uv.lock", "poetry.lock", "Cargo.lock", "go.sum"):
        path = rel_join(directory, name)
        if path in repo.tracked_set:
            return path
    return None


def yarn_flavour(disc: Discovery, project_pkg: Package) -> str:
    """berry (Yarn 2+) or classic, as verify_branch.yarn_install decides."""
    repo = disc.repo
    d = project_pkg.dir
    major = yarn_major(project_pkg, repo)
    if major is not None:
        return "berry" if major >= 2 else "classic"
    if rel_join(d, ".yarnrc.yml") in repo.tracked_set:
        return "berry"
    lock = rel_join(d, "yarn.lock")
    if lock in repo.tracked_set:
        try:
            with open(str(repo.abs(lock)), "rb") as handle:
                head = handle.read(vb.YARN_LOCK_HEAD_BYTES).decode("utf-8", errors="replace")
        except OSError:
            head = ""
        if vb.YARN_MODERN_LOCK_RE.search(head):
            return "berry"
    return "classic"


INSTALL_RECORDS = {"npm": "node_modules/.package-lock.json", "pnpm": "node_modules/.modules.yaml",
                   "berry": ".yarn/install-state.gz", "classic": "node_modules/.yarn-integrity"}


def _mtime(repo: Repo, rel: str) -> Optional[float]:
    try:
        return os.stat(str(repo.abs(rel))).st_mtime
    except OSError:
        return None


def deps_present(disc: Discovery, directory: str, lockfile: str) -> Tuple[bool, Optional[str]]:
    """Whether a project directory's dependencies are installed and not older than its lockfile
    (pilot-auto-calibration A01-F24); existence and modification times only."""
    repo = disc.repo
    name = posixpath.basename(lockfile)
    manager = C.lockfile_manager(name) or ""
    if name == "uv.lock":
        return repo.isdir(rel_join(directory, ".venv")), None
    if name in ("Cargo.lock", "go.sum"):
        return True, None
    if name == "poetry.lock":
        return True, "cannot tell whether the poetry dependencies of {} are installed".format(
            directory)
    pkg = disc.packages.get(directory)
    flavour = pkg.flavour if pkg is not None else None
    key = "berry" if manager == "yarn" and flavour == "berry" else (
        "classic" if manager == "yarn" else manager)
    if key == "berry":
        rc = disc.yarnrc.get(directory) or Yarnrc()
        if rc.node_linker in (None, "pnp") and not repo.isdir(rel_join(directory,
                                                                         "node_modules")):
            if not repo.exists(rel_join(directory, ".pnp.cjs")):
                return False, None
        elif not repo.isdir(rel_join(directory, "node_modules")):
            return False, None
    elif not repo.isdir(rel_join(directory, "node_modules")):
        return False, None
    record = INSTALL_RECORDS.get(key)
    if record is None:
        return True, None
    rec_time = _mtime(repo, rel_join(directory, record))
    lock_time = _mtime(repo, lockfile)
    if rec_time is None:
        return False, "no install record {} in {}".format(record, directory)
    if lock_time is not None and rec_time + 1 < lock_time:
        return False, "the install record {} is older than {} (A01-F24)".format(
            rel_join(directory, record), lockfile)
    return True, None


def install_name(directory: str) -> str:
    return "install-" + ("root" if directory in (".", "") else NAME_SAFE_RE.sub("-", directory))


def discover_installs(disc: Discovery, telemetry: bool = True) -> None:
    repo = disc.repo
    dirs = ["."] + sorted(p.dir for p in disc.packages.values() if p.kind == "separate")
    for directory in dirs:
        lock = _lockfile_in(repo, directory)
        if lock is None:
            continue
        found = vb.lockfile_install(repo.abs(directory))
        if found is None:
            continue
        lockfile, argv, reason = found
        present, why = deps_present(disc, directory, rel_join(directory, lockfile))
        if why:
            disc.limits.append(why)
        entry: Dict[str, Any] = {"name": install_name(directory), "cmd": list(argv),
                                 "cwd": directory, "timeout_s": vb.INSTALL_TIMEOUT_S,
                                 "lockfile": rel_join(directory, lockfile), "reason": reason,
                                 "deps_present": present}
        pkg = disc.packages.get(directory)
        if telemetry and argv and argv[0] == "yarn" and pkg is not None and \
                pkg.flavour == "berry":
            entry["env"] = {TELEMETRY_ENV["yarn"][0]: TELEMETRY_ENV["yarn"][1]}
        disc.installs.append(entry)
        disc.lockfiles[directory] = rel_join(directory, lockfile)


# ---------------------------------------------------------------------------
# GitHub Actions (line-based) and other CI files
# ---------------------------------------------------------------------------


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _yaml_value(raw: str) -> str:
    value = raw.strip()
    if " #" in value and not value.startswith(("'", "\"")):
        value = value.split(" #", 1)[0].rstrip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value


def _block_scalar(lines: Sequence[str], start: int, indent: int, style: str) -> Tuple[List[
        Tuple[int, str]], int]:
    """Lines of a block scalar that starts after line index `start` (key at `indent`):
    ([(line number, command text)], next index)."""
    body: List[Tuple[int, str]] = []
    j = start + 1
    block_indent: Optional[int] = None
    raw: List[Tuple[int, str]] = []
    while j < len(lines):
        line = lines[j]
        if line.strip() == "":
            raw.append((j + 1, ""))
            j += 1
            continue
        ind = _indent(line)
        if ind <= indent:
            break
        if block_indent is None:
            block_indent = ind
        raw.append((j + 1, line[block_indent:] if ind >= block_indent else line.strip()))
        j += 1
    while raw and raw[-1][1] == "":
        raw.pop()
    if style.startswith(">"):
        current: List[str] = []
        first = 0
        for num, text in raw + [(0, "")]:
            if text.strip() == "":
                if current:
                    body.append((first, " ".join(current)))
                current = []
                continue
            if not current:
                first = num
            current.append(text.strip())
    else:
        pending = ""
        first = 0
        for num, text in raw:
            stripped = text.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if not pending:
                first = num
            if stripped.endswith(_BACKSLASH):
                pending += stripped[:-1].rstrip() + " "
                continue
            body.append((first, (pending + stripped).strip()))
            pending = ""
        if pending:
            body.append((first, pending.strip()))
    return body, j


def _matrix_values(block: Sequence[str], key: str) -> Optional[List[str]]:
    """Literal values of strategy.matrix.<key> in a job block, or None."""
    for idx, line in enumerate(block):
        m = re.match(r"^(\s*)" + re.escape(key) + r"\s*:\s*(.*)$", line)
        if not m:
            continue
        value = m.group(2).strip()
        if value.startswith("["):
            if "${{" in value:
                return None
            return [_yaml_value(v) for v in value.strip("[]").split(",") if v.strip()]
        if value == "":
            items = []
            ind = len(m.group(1))
            for follow in block[idx + 1:]:
                item = re.match(r"^(\s*)-\s*(.+)$", follow)
                if not item or len(item.group(1)) < ind:
                    break
                items.append(_yaml_value(item.group(2)))
            return items or None
        return None if "${{" in value else [_yaml_value(value)]
    return None


def parse_workflow(path: str, text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(jobs, commands) of one GitHub Actions workflow (GA-06 6.3, revision 9)."""
    lines = text.replace("\r\n", "\n").split("\n")
    jobs: List[Dict[str, Any]] = []
    commands: List[Dict[str, Any]] = []
    workflow_taint: Optional[str] = None
    workflow_wd: Optional[str] = None
    i = 0
    jobs_start = None
    while i < len(lines):
        line = lines[i]
        if re.match(r"^env\s*:", line):
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or lines[j].startswith((" ", "\t"))):
                if re.search(r"\$\{\{[^}]*\b(secrets|vars)\.", lines[j]):
                    workflow_taint = "workflow-level env references secrets or vars (line {})" \
                        .format(j + 1)
                j += 1
        if re.match(r"^defaults\s*:", line):
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or lines[j].startswith((" ", "\t"))):
                wd = re.match(r"^\s+working-directory\s*:\s*(.+)$", lines[j])
                if wd:
                    workflow_wd = _yaml_value(wd.group(1))
                j += 1
        if re.match(r"^jobs\s*:", line):
            jobs_start = i
            break
        i += 1
    if jobs_start is None:
        return jobs, commands
    job_indent: Optional[int] = None
    spans: List[Tuple[str, int, int]] = []
    j = jobs_start + 1
    current: Optional[Tuple[str, int]] = None
    while j < len(lines):
        line = lines[j]
        if line.strip() and not line.startswith((" ", "\t")) and not line.startswith("#"):
            break
        m = re.match(r"^(\s+)([A-Za-z0-9_-]+)\s*:\s*(#.*)?$", line)
        if m and (job_indent is None or len(m.group(1)) == job_indent):
            if job_indent is None:
                job_indent = len(m.group(1))
            if current is not None:
                spans.append((current[0], current[1], j))
            current = (m.group(2), j)
        j += 1
    if current is not None:
        spans.append((current[0], current[1], j))
    for job_id, start, end in spans:
        block = lines[start + 1:end]
        job = _parse_job(path, job_id, start, block, workflow_taint, workflow_wd, commands)
        jobs.append(job)
    return jobs, commands


def _parse_job(path: str, job_id: str, start: int, block: Sequence[str],
               workflow_taint: Optional[str], workflow_wd: Optional[str],
               commands: List[Dict[str, Any]]) -> Dict[str, Any]:
    why: List[str] = []
    content = [ln for ln in block if ln.strip() and not ln.strip().startswith("#")]
    key_indent = min((_indent(ln) for ln in content), default=0)
    keys: Dict[str, Tuple[int, str]] = {}
    for idx, ln in enumerate(block):
        if ln.strip() and _indent(ln) == key_indent:
            m = re.match(r"^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$", ln)
            if m:
                keys.setdefault(m.group(1), (idx, m.group(2)))
    if workflow_taint:
        why.append(workflow_taint)
    if any(re.search(r"\$\{\{[^}]*\b(secrets|vars)\.", ln) for ln in block):
        why.append("the job references secrets or vars")
    if "secrets" in keys:
        why.append("the job passes secrets")
    if "environment" in keys:
        why.append("the job uses an environment")
    if "continue-on-error" in keys and _yaml_value(keys["continue-on-error"][1]) == "true":
        why.append("job-level continue-on-error")
    if "uses" in keys:
        why.append("the job calls a reusable workflow")
    if "if" in keys:
        why.append("job-level if: may never run in this repository")
    if any(re.search(r"(^|\s)[&*][A-Za-z0-9_-]+(\s|$)", ln.split("#")[0]) and
           not re.search(r"run\s*:", ln) for ln in block) or \
            any(re.match(r"^\s*-\s*\{", ln) for ln in block):
        why.append("not parsed: anchors, aliases or flow-style steps")
    runs_on = _yaml_value(keys["runs-on"][1]) if "runs-on" in keys else ""
    hosted = False
    labels: List[str] = []
    matrix = re.match(r"^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$", runs_on)
    if matrix:
        values = _matrix_values(block, matrix.group(1))
        labels = values or []
        hosted = bool(values) and all(HOSTED_RUNNER_RE.match(v) for v in values)
    elif runs_on and "${{" not in runs_on and not runs_on.startswith(("[", "{")):
        labels = [runs_on]
        hosted = bool(HOSTED_RUNNER_RE.match(runs_on))
    if not hosted:
        why.append("runs-on {} is not a GitHub-hosted label".format(redact(runs_on or "(none)")))
    job_wd = workflow_wd
    if "defaults" in keys:
        for ln in block[keys["defaults"][0] + 1:]:
            if ln.strip() and _indent(ln) <= key_indent:
                break
            wd = re.match(r"^\s+working-directory\s*:\s*(.+)$", ln)
            if wd:
                job_wd = _yaml_value(wd.group(1))
    eligible = not why
    job = {"file": path, "line": start + 1, "job": job_id, "runs_on": labels or [runs_on],
           "hosted": hosted, "eligible": eligible, "why": "; ".join(why) or "eligible"}
    if "steps" not in keys:
        return job
    steps_idx = keys["steps"][0]
    step_items: List[Tuple[int, int]] = []
    step_indent: Optional[int] = None
    k = steps_idx + 1
    while k < len(block):
        ln = block[k]
        if ln.strip() and _indent(ln) <= key_indent:
            break
        m = re.match(r"^(\s*)-\s", ln)
        if m and (step_indent is None or len(m.group(1)) == step_indent):
            step_indent = len(m.group(1))
            step_items.append((k, 0))
        k += 1
    steps_end = k
    bounds = [s for s, _ in step_items] + [steps_end]
    for n_step in range(len(step_items)):
        s_start, s_end = bounds[n_step], bounds[n_step + 1]
        _parse_step(path, job, block, s_start, s_end, start, job_wd, commands)
    return job


def _parse_step(path: str, job: Dict[str, Any], block: Sequence[str], s_start: int, s_end: int,
                job_start: int, job_wd: Optional[str], commands: List[Dict[str, Any]]) -> None:
    first = block[s_start]
    base_indent = _indent(first) + 2
    fields: Dict[str, Tuple[int, str]] = {}
    inline = re.match(r"^\s*-\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$", first)
    if inline:
        fields[inline.group(1)] = (s_start, inline.group(2))
    for idx in range(s_start + 1, s_end):
        ln = block[idx]
        if ln.strip() and _indent(ln) == base_indent:
            m = re.match(r"^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$", ln)
            if m:
                fields.setdefault(m.group(1), (idx, m.group(2)))
    if "run" not in fields:
        return
    run_idx, run_value = fields["run"]
    style = run_value.strip()
    if style[:1] in ("|", ">"):
        texts, _ = _block_scalar(block, run_idx, base_indent, style)
    else:
        texts = [(job_start + run_idx + 2, _yaml_value(run_value))]
    texts = [(job_start + num + 1 if style[:1] in ("|", ">") else num, t) for num, t in texts]
    why: List[str] = []
    evidence = bool(job["eligible"])
    if not job["eligible"]:
        why.append(job["why"])
    if "continue-on-error" in fields and _yaml_value(fields["continue-on-error"][1]) != "false":
        evidence = False
        why.append("step continue-on-error")
    if "if" in fields:
        cond = _yaml_value(fields["if"][1])
        if cond not in TRUSTED_STEP_IFS:
            evidence = False
            why.append("step if: {}".format(redact(cond, 60)))
    if "shell" in fields and _yaml_value(fields["shell"][1]) not in ("bash", "sh"):
        evidence = False
        why.append("step shell {}".format(redact(_yaml_value(fields["shell"][1]), 30)))
    cwd = "."
    if "working-directory" in fields:
        cwd = _yaml_value(fields["working-directory"][1])
    elif job_wd:
        cwd = job_wd
    for num, text in texts:
        if not text:
            continue
        item_why = list(why)
        item_evidence = evidence
        if "${{" in text or "${{" in cwd:
            item_evidence = False
            item_why.append("holds a ${{ }} expression: recorded, never matched")
        commands.append({"file": path, "line": num, "job": job["job"],
                         "cwd": C.to_posix(cwd).strip("/") or ".", "text": text,
                         "evidence": item_evidence, "why": "; ".join(item_why) or "evidence"})


def discover_ci(repo: Repo, limits: List[str]) -> Dict[str, Any]:
    files: List[str] = []
    jobs: List[Dict[str, Any]] = []
    commands: List[Dict[str, Any]] = []
    for path in repo.tracked:
        if not any(rx.search(path) for rx in inv.CI_FILE_RES):
            continue
        files.append(path)
        if re.match(r"^\.github/workflows/[^/]+\.ya?ml$", path):
            text = repo.read(path)
            if text is None:
                continue
            j, c = parse_workflow(path, text)
            jobs += j
            commands += c
        elif re.match(r"^\.gitlab-ci\.ya?ml$", path):
            try:
                extracted = inv.extract_ci_commands(repo.root, [path])
            except (OSError, ValueError):
                extracted = []
            for item in extracted:
                commands.append({"file": path, "line": item.get("line"), "job": None,
                                 "cwd": C.to_posix(str(item.get("cwd") or ".")),
                                 "text": str(item.get("cmd") or ""), "evidence": False,
                                 "why": "GitLab settings variables reach jobs without a line in "
                                        "the file (U01-F09)"})
        else:
            limits.append("{}: not parsed; not evidence".format(path))
    return {"files": files, "jobs": jobs, "commands": commands}


# ---------------------------------------------------------------------------
# Documentation, commit hooks, credential files
# ---------------------------------------------------------------------------

DOC_COMMAND_RE = re.compile(r"^\s*(?:\$\s+)?((?:npm|npx|pnpm|yarn|bun|bunx|make|just|cargo|go|uv|"
                            r"poetry|python3?|pytest|forge|hardhat|node|tsc|eslint)\b.*)$")


def discover_docs(repo: Repo) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for path in repo.tracked:
        base = posixpath.basename(path)
        if not re.match(r"(?i)^(README|CONTRIBUTING)(\.[\w.]+)?$", base):
            continue
        text = repo.read(path)
        if text is None:
            continue
        fenced = False
        for num, line in enumerate(text.split("\n"), 1):
            if line.strip().startswith(("```", "~~~")):
                fenced = not fenced
                continue
            m = DOC_COMMAND_RE.match(line) if fenced else None
            if m:
                out.append({"file": path, "line": num, "text": redact(m.group(1))})
    return out[:200]


def discover_hooks(repo: Repo) -> Dict[str, Any]:
    hooks_path = C.git_ok(repo.root, ["config", "--get", "core.hooksPath"])
    files: List[str] = []
    runs: List[str] = []
    candidates = [".husky/pre-commit", ".pre-commit-config.yaml"]
    if hooks_path:
        hp = C.to_posix(hooks_path).rstrip("/")
        candidates.append(hp + "/pre-commit")
        if hp.endswith("/_"):
            candidates.append(hp[:-2] + "/pre-commit")
    for path in candidates:
        if path in repo.tracked_set and path not in files:
            files.append(path)
            text = repo.read(path) or ""
            for line in text.split("\n"):
                s = line.strip()
                if s and not s.startswith(("#", "repos:", "-", "exec ", ". ")) and \
                        not s.startswith("#!"):
                    runs.append(redact(s))
                    break
            if path.endswith(".pre-commit-config.yaml"):
                runs.append("pre-commit hooks of {}".format(path))
    return {"hooks_path": redact(hooks_path) if hooks_path else None, "files": files,
            "runs": runs}


def _is_reparse(entry: "os.DirEntry[str]") -> bool:
    try:
        if entry.is_symlink():
            return True
        if os.name == "nt":
            attrs = getattr(entry.stat(follow_symlinks=False), "st_file_attributes", 0)
            return bool(attrs & REPARSE_POINT)
    except OSError:
        return True
    return False


def ignored_secret_files(repo: Repo, limits: List[str]) -> List[str]:
    """Ignored paths whose name matches SECRET_FILE_RE (names only; GA-06 revision 2)."""
    try:
        listed = C.git_bytes(repo.root, ["ls-files", "-z", "--others", "--ignored",
                                         "--exclude-standard", "--directory",
                                         "--no-empty-directory"], check=False)
    except (OSError, C.GitError) as exc:
        limits.append("ignored files not listed: {}".format(exc.__class__.__name__))
        return []
    found: List[str] = []
    budget = [IGNORED_WALK_ENTRIES]
    for raw in listed.split(b"\0"):
        if not raw:
            continue
        rel = raw.decode("utf-8", errors="replace").rstrip("/")
        base = posixpath.basename(rel)
        if raw.endswith(b"/"):
            if base in IGNORED_WALK_SKIP or rel == ".yarn/cache" or rel.endswith("/.yarn/cache"):
                continue
            _walk_ignored(repo, rel, 1, found, budget)
        elif SECRET_FILE_RE.match(base):
            found.append(rel)
    if budget[0] <= 0:
        limits.append("ignored-file walk stopped at {} entries".format(IGNORED_WALK_ENTRIES))
    return sorted(set(found))


def _walk_ignored(repo: Repo, rel: str, depth: int, found: List[str], budget: List[int]) -> None:
    if depth > IGNORED_WALK_DEPTH or budget[0] <= 0:
        return
    try:
        entries = sorted(os.scandir(str(repo.abs(rel))), key=lambda e: e.name)
    except OSError:
        return
    for entry in entries:
        budget[0] -= 1
        if budget[0] <= 0:
            return
        if _is_reparse(entry):
            continue
        child = rel + "/" + entry.name
        try:
            is_dir = entry.is_dir(follow_symlinks=False)
        except OSError:
            continue
        if is_dir:
            if entry.name not in IGNORED_WALK_SKIP:
                _walk_ignored(repo, child, depth + 1, found, budget)
        elif SECRET_FILE_RE.match(entry.name):
            found.append(child)


def _stop_key() -> Optional[str]:
    """ANCESTOR_STOP as the ancestor walks compare it. Real paths on both sides: tempfile can
    return a Windows 8.3 short name (C:/Users/UTILIS~1/...) while the resolved repository root
    walks through the long one, and an abspath comparison then never stops the walk."""
    return os.path.normcase(os.path.realpath(ANCESTOR_STOP)) if ANCESTOR_STOP else None


def _at_stop(current: str, stop: Optional[str]) -> bool:
    return stop is not None and os.path.normcase(os.path.realpath(current)) == stop


def ancestor_dotenv_files(repo: Repo) -> List[str]:
    """Absolute POSIX paths of .env, .env.local and .env.production in ancestor directories of
    the repository (existence only; the walk stops at ANCESTOR_STOP)."""
    out: List[str] = []
    current = os.path.dirname(os.path.abspath(str(repo.root)))
    stop = _stop_key()
    seen: Set[str] = set()
    while current and current not in seen:
        seen.add(current)
        for name in DOTENV_NAMES:
            candidate = os.path.join(current, name)
            if os.path.exists(candidate):
                out.append(C.to_posix(candidate))
        if _at_stop(current, stop):
            break
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return out


# ---------------------------------------------------------------------------
# Shell splitting (GA-06 6.5)
# ---------------------------------------------------------------------------


class Simple:
    """One simple command of a chain."""

    def __init__(self, op: Optional[str], words: List[str], raw: str, posix: bool,
                 dynamic: bool) -> None:
        self.op = op
        self.words = words
        self.raw = raw.strip()
        self.posix = posix
        self.dynamic = dynamic
        self.background = False
        self.env: Dict[str, str] = {}


POSIX_CHARS = set("*?[$`><'")


def split_chain(text: str) -> List[Simple]:
    """Simple commands separated by &&, ||, ;, |, & and newlines; subshells and brace groups
    flattened; `set NAME=value&&` of cmd.exe read as an assignment."""
    out: List[Simple] = []
    words: List[str] = []
    word: List[str] = []
    raw: List[str] = []
    in_word = False
    posix = False
    dynamic = False
    op: Optional[str] = None
    i = 0
    n = len(text)

    def end_word() -> None:
        nonlocal word, in_word
        if in_word:
            words.append("".join(word))
        word = []
        in_word = False

    def end_cmd(next_op: Optional[str]) -> None:
        nonlocal words, raw, posix, dynamic, op
        end_word()
        if words:
            out.append(Simple(op, words, "".join(raw), posix, dynamic))
        words = []
        raw = []
        posix = False
        dynamic = False
        op = next_op

    while i < n:
        ch = text[i]
        if ch in "\"'":
            quote = ch
            j = i + 1
            buf: List[str] = []
            while j < n and text[j] != quote:
                if quote == "\"" and text[j] == _BACKSLASH and j + 1 < n and \
                        text[j + 1] in "\"\\$`":
                    buf.append(text[j + 1])
                    j += 2
                    continue
                if quote == "\"" and text[j] in "$`":
                    dynamic = dynamic or text[j] == "`" or text.startswith("$(", j)
                buf.append(text[j])
                j += 1
            if quote == "'":
                posix = True
            word.extend(buf)
            in_word = True
            raw.append(text[i:j + 1])
            i = j + 1
            continue
        if ch == _BACKSLASH and i + 1 < n:
            if text[i + 1] == "\n":
                i += 2
                continue
            word.append(text[i + 1] if text[i + 1] in " \"'\\" else ch + text[i + 1])
            in_word = True
            raw.append(text[i:i + 2])
            i += 2
            continue
        two = text[i:i + 2]
        if two in ("&&", "||"):
            end_cmd(two)
            i += 2
            continue
        if ch == "&" and i > 0 and text[i - 1] == ">":
            word.append(ch)
            in_word = True
            raw.append(ch)
            i += 1
            continue
        if ch == "&" and text[i + 1:i + 2] == ">":
            posix = True
            word.append(ch)
            in_word = True
            raw.append(ch)
            i += 1
            continue
        if ch in ";|&\n":
            if ch == "&":
                end_word()
                if words:
                    words_copy = list(words)
                    end_cmd("&")
                    if out and out[-1].words == words_copy:
                        out[-1].background = True
                else:
                    end_cmd("&")
            else:
                end_cmd("|" if ch == "|" else ";")
            i += 1
            continue
        if ch in "()":
            if ch == "(" and word and word[-1] == "$":
                dynamic = True
            end_word()
            raw.append(" ")
            i += 1
            continue
        if ch in " \t":
            end_word()
            raw.append(ch)
            i += 1
            continue
        if ch in POSIX_CHARS:
            posix = True
            if ch in "$`":
                dynamic = dynamic or ch == "`" or not in_word
        word.append(ch)
        in_word = True
        raw.append(ch)
        i += 1
    end_cmd(None)
    for cmd in out:
        cmd.words = [w for w in cmd.words if w not in ("{", "}")]
        if len(cmd.words) >= 2 and cmd.words[0].lower() == "set" and "=" in cmd.words[1]:
            name, _, value = cmd.words[1].partition("=")
            cmd.env[name] = value
            cmd.words = cmd.words[2:]
    return [c for c in out if c.words or c.env]


def needs_posix(text: str) -> bool:
    return any(c.posix for c in split_chain(text))


def take_env(words: List[str]) -> Tuple[Dict[str, str], List[str], List[str]]:
    """Leading NAME=value words, cross-env[-shell] and env [-u X] prefixes:
    (assignments, unset names, the rest)."""
    env: Dict[str, str] = {}
    unset: List[str] = []
    rest = list(words)
    changed = True
    while rest and changed:
        changed = False
        m = ASSIGN_RE.match(rest[0])
        if m:
            env[m.group(1)] = m.group(2)
            rest = rest[1:]
            changed = True
            continue
        if rest[0] in ("cross-env", "cross-env-shell"):
            rest = rest[1:]
            changed = True
            continue
        if rest[0] == "env":
            rest = rest[1:]
            while rest and rest[0] in ("-u", "--unset") and len(rest) > 1:
                unset.append(rest[1])
                rest = rest[2:]
            while rest and rest[0].startswith("-") and rest[0] not in ("-u", "--unset"):
                rest = rest[1:]
            changed = True
    return env, unset, rest


# ---------------------------------------------------------------------------
# Leaves (GA-06 6.5)
# ---------------------------------------------------------------------------

STATIC_TOOLS = frozenset(["tsc", "vue-tsc", "biome", "oxlint", "stylelint", "markdownlint",
                          "markdownlint-cli2", "solhint", "shellcheck", "ruff", "black", "isort",
                          "flake8", "mypy", "pyright", "basedpyright", "gofmt", "golangci-lint",
                          "prettier", "eslint", "pylint"])
BUILD_TOOLS = frozenset(["webpack", "tsup", "esbuild", "rollup", "parcel"])
LONG_TOOLS = frozenset(["anvil", "ganache", "ganache-cli", "nodemon", "serve", "http-server",
                        "uvicorn", "live-server"])
SCANNER_TOOLS = frozenset(["gitleaks", "trufflehog", "detect-secrets", "secretlint", "ggshield"])
BROWSER_TOOLS = frozenset(["playwright", "cypress"])
NOOP_WORDS = frozenset(["echo", "true", ":", "printf", "exit", "test", "[", "export"])
WRITER_WORDS = frozenset(["rm", "rimraf", "del", "del-cli", "mkdir", "cp", "mv", "touch", "shx",
                          "cpy", "copyfiles", "ln", "chmod", "sed", "tee"])
INSTALL_FORMS = (("npm", ("ci", "install", "i")), ("pnpm", ("install", "i")),
                 ("yarn", ("install",)), ("bun", ("install",)), ("uv", ("sync",)),
                 ("pip", ("install",)), ("pip3", ("install",)), ("poetry", ("install",)))
FILE_LAUNCHERS = frozenset(["node", "ts-node", "tsx", "bun", "deno", "python", "python3", "bash",
                            "sh"])
L1_TOOL_FORMS: Tuple[Tuple[str, Optional[Sequence[str]]], ...] = (
    ("hardhat", ("deploy", "verify", "ignition")), ("cast", ("send", "publish")),
    ("forge", ("create", "verify-contract")), ("twine", ("upload",)), ("gh", ("release", "pr")),
    ("vercel", None), ("netlify", ("deploy",)), ("firebase", ("deploy",)),
    ("wrangler", ("deploy", "publish")), ("fly", ("deploy",)), ("flyctl", ("deploy",)),
    ("railway", ("up",)), ("serverless", ("deploy",)), ("sls", ("deploy",)),
    ("terraform", ("apply",)), ("pulumi", ("up",)), ("kubectl", ("apply", "create", "delete")),
    ("helm", ("install", "upgrade")), ("docker", ("push", "login")), ("changeset", ("publish",)),
    ("semantic-release", None), ("lerna", ("publish",)), ("truffle", ("migrate",)),
    ("solana", ("program",)), ("anchor", ("deploy",)), ("git", ("push",)),
    ("cargo", ("publish",)), ("uv", ("publish",)), ("poetry", ("publish",)),
    ("npm", ("publish",)), ("pnpm", ("publish",)), ("bun", ("publish",)))
DOWNLOAD_WORDS = frozenset(["npx", "pnpx", "bunx", "uvx"])
KNOWN_BIN_TOOLS = STATIC_TOOLS | BUILD_TOOLS | frozenset(
    ["vitest", "jest", "mocha", "hardhat", "next", "vite", "forge", "tsx", "ts-node",
     "playwright", "cypress", "concurrently", "run-s", "run-p", "npm-run-all", "turbo", "lerna",
     "cross-env", "dotenv", "env-cmd", "lint-staged", "husky"])


def new_leaf(kind: str, argv: Sequence[str], cwd: str, env: Dict[str, str], **extra: Any
             ) -> Dict[str, Any]:
    leaf: Dict[str, Any] = {"kind": kind, "tool": None, "sub": None, "argv": list(argv),
                            "cwd": cwd, "env": dict(env), "config": None, "file": None,
                            "reason": None, "scan": [], "pm": None}
    leaf.update(extra)
    return leaf


def leaf_identity(leaf: Dict[str, Any]) -> Tuple[str, str, str, str]:
    """Coverage identity (kind, tool+subcommand or file, cwd, config); flags are ignored."""
    what = leaf.get("file") or " ".join(x for x in (leaf.get("tool"), leaf.get("sub")) if x)
    return (leaf["kind"], what, leaf["cwd"], leaf.get("config") or "")


class Resolver:
    """Resolves a command text to leaves and chain entries (GA-06 6.5)."""

    def __init__(self, disc: Discovery, repo: Repo) -> None:
        self.disc = disc
        self.repo = repo
        self.yarn_on_path = shutil.which("yarn") is not None

    # -- entry points -------------------------------------------------------------------
    def resolve_text(self, text: str, cwd: str, depth: int, stack: Tuple[Tuple[str, str], ...],
                     extra: Sequence[str] = ()) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        leaves: List[Dict[str, Any]] = []
        chain: List[Dict[str, Any]] = []
        cmds = split_chain(text)
        if extra and cmds:
            cmds[-1].words = cmds[-1].words + list(extra)
        current = cwd
        for index, cmd in enumerate(cmds):
            env, _unset, words = take_env(cmd.words)
            env.update(cmd.env)
            if cmd.dynamic and (not words or words[0].startswith(("$", "`"))):
                leaves.append(new_leaf("unresolved", words, current, env, op=cmd.op,
                                       reason="dynamic command"))
                continue
            if words and words[0] == "cd" and len(words) >= 2 and not cmd.posix:
                current = rel_join(current, words[1])
                continue
            if words and words[0] == "cd":
                leaves.append(new_leaf("unresolved", words, current, env, op=cmd.op,
                                       reason="dynamic command"))
                continue
            got_leaves, got_chain = self.resolve_words(words, current, env, depth, stack)
            for leaf in got_leaves:
                leaf.setdefault("op", cmd.op)
                if cmd.background:
                    leaf["background"] = True
                leaf["position"] = index
            leaves += got_leaves
            chain += got_chain
        return leaves, chain

    def resolve_words(self, words: List[str], cwd: str, env: Dict[str, str], depth: int,
                      stack: Tuple[Tuple[str, str], ...]
                      ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if not words:
            return [], []
        if depth > MAX_CHAIN_DEPTH:
            return [new_leaf("unresolved", words, cwd, env, reason="depth limit")], []
        first = C.to_posix(words[0])
        base = posixpath.basename(first)
        if first.startswith(("./node_modules/.bin/", "node_modules/.bin/")):
            words = [base] + words[1:]
            first = base
        if first.startswith(("$", "`")) or first in ("eval",) or re.match(r"^\d*[<>]", first):
            return [new_leaf("unresolved", words, cwd, env, reason="dynamic command")], []
        if first in ("dotenv", "env-cmd"):
            return self._env_wrapper(words, cwd, env, depth, stack)
        if first in ("node",) and len(words) >= 2 and re.search(r"yarn[^/\s]*\.c?js$",
                                                                  C.to_posix(words[1])):
            return self._yarn(["yarn"] + words[2:], cwd, env, depth, stack)
        if first in PM_WORDS:
            return self._pm(words, cwd, env, depth, stack)
        if first in DOWNLOAD_WORDS:
            return self._download_or_bin(words, cwd, env, depth, stack)
        if first in ("run-s", "run-p", "npm-run-all"):
            return self._run_all(words, cwd, env, depth, stack)
        if first == "concurrently":
            leaves: List[Dict[str, Any]] = []
            chain: List[Dict[str, Any]] = []
            for arg in words[1:]:
                if arg.startswith("-"):
                    continue
                got = self.resolve_text(arg, cwd, depth + 1, stack)
                leaves += got[0]
                chain += got[1]
            return leaves, chain
        if first in ("turbo", "lerna") and len(words) >= 3 and words[1] == "run":
            return self._every_workspace(words[2], words[3:], cwd, env, depth, stack)
        if first == "nx":
            return [new_leaf("unresolved", words, cwd, env, reason="nx target")], []
        if first in ("make", "just"):
            return self._make(words, cwd, env, depth, stack)
        if first in ("uv", "poetry") and len(words) >= 3 and words[1] == "run":
            rest = [w for w in words[2:] if w not in ("--frozen", "--locked")]
            leaves, chain = self.resolve_words(rest, cwd, env, depth + 1, stack)
            for leaf in leaves:
                leaf["runner_prefix"] = first
            return leaves, chain
        if first == "sudo":
            return [new_leaf("unsupported", words, cwd, env, reason="unsupported: sudo")], []
        return [self.tool_leaf(words, cwd, env)], []

    # -- package managers ------------------------------------------------------------------
    def _target_dir(self, args: List[str], cwd: str) -> Tuple[str, List[str], Dict[str, Any]]:
        """Strip --prefix/-C/--dir/--cwd and workspace/filter flags: (dir, rest, flags)."""
        rest: List[str] = []
        flags: Dict[str, Any] = {"workspaces": [], "filters": [], "recursive": False,
                                 "all_workspaces": False}
        target = cwd
        i = 0
        while i < len(args):
            a = args[i]
            key, eq, val = a.partition("=")
            if key in ("--prefix", "-C", "--dir", "--cwd"):
                value = val if eq else (args[i + 1] if i + 1 < len(args) else "")
                target = rel_join(cwd, value)
                i += 1 if eq else 2
                continue
            if key in ("-w", "--workspace") and not rest:
                value = val if eq else (args[i + 1] if i + 1 < len(args) else "")
                flags["workspaces"].append(value)
                i += 1 if eq else 2
                continue
            if key in ("--filter", "-F") and not rest:
                value = val if eq else (args[i + 1] if i + 1 < len(args) else "")
                flags["filters"].append(value)
                i += 1 if eq else 2
                continue
            if a in ("-r", "--recursive") and not rest:
                flags["recursive"] = True
                i += 1
                continue
            if a in ("-ws", "--workspaces") and not rest:
                flags["all_workspaces"] = True
                i += 1
                continue
            rest.append(a)
            i += 1
        return target, rest, flags

    def _pm(self, words: List[str], cwd: str, env: Dict[str, str], depth: int,
            stack: Tuple[Tuple[str, str], ...]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        pm = words[0]
        if pm == "yarn":
            return self._yarn(words, cwd, env, depth, stack)
        target, rest, flags = self._target_dir(words[1:], cwd)
        args = list(rest)
        while args and args[0].startswith("-") and args[0] != "--":
            args = args[1:]
        if not args:
            if pm == "bun":
                return [new_leaf("unsupported", words, target, env, reason="unsupported: bun")], []
            return [new_leaf("unsupported", words, target, env,
                             reason="unsupported: {} without a command".format(pm))], []
        sub = args[0]
        if (pm, sub) in (("npm", "ci"), ("npm", "install"), ("npm", "i"), ("pnpm", "install"),
                         ("pnpm", "i"), ("bun", "install")):
            return [new_leaf("install", words, target, env, tool=pm, sub=sub, pm=pm)], []
        if sub == "publish":
            return [new_leaf("tool", words, target, env, tool=pm, sub=sub, pm=pm)], []
        if pm == "npm" and sub in ("run", "run-script", "rum", "urn"):
            return self._scripts(pm, args[1:2], args[2:], target, flags, env, depth, stack,
                                 after_dash=True)
        if pm == "npm" and sub in ("test", "t", "tst", "start", "stop", "restart"):
            name = "test" if sub in ("t", "tst") else sub
            return self._scripts(pm, [name], args[1:], target, flags, env, depth, stack,
                                 after_dash=True)
        if pm in ("npm", "pnpm") and sub == "exec" or pm == "bun" and sub == "x":
            rest_args = args[1:]
            if rest_args and rest_args[0] == "--":
                rest_args = rest_args[1:]
            return self._local_bin(pm, rest_args, target, env, depth, stack)
        if pm == "pnpm" and sub == "dlx":
            return [self._download_leaf(words, args[1:], target, env)], []
        if pm == "bun" and sub == "test":
            leaf = new_leaf("runner", words, target, env, tool="bun test", pm=pm)
            return [leaf], []
        if pm == "bun" and sub == "run":
            return self._bun_run(args[1:], target, env, depth, stack)
        if pm == "pnpm" and sub == "run":
            return self._scripts(pm, args[1:2], args[2:], target, flags, env, depth, stack,
                                 after_dash=True)
        if pm == "pnpm" and sub not in inv.PM_BUILTINS:
            return self._scripts(pm, [sub], args[1:], target, flags, env, depth, stack,
                                 after_dash=True)
        if pm == "bun" and sub not in inv.PM_BUILTINS:
            return self._bun_run(args, target, env, depth, stack)
        return [new_leaf("unsupported", words, target, env,
                         reason="unsupported: {} {}".format(pm, sub))], []

    def _bun_run(self, args: List[str], cwd: str, env: Dict[str, str], depth: int,
                 stack: Tuple[Tuple[str, str], ...]
                 ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if not args:
            return [new_leaf("unsupported", ["bun", "run"], cwd, env,
                             reason="unsupported: bun run")], []
        pkg = self.disc.nearest_package(cwd)
        if pkg is not None and args[0] in pkg.scripts:
            return self._scripts("bun", args[:1], args[1:], cwd, {}, env, depth, stack)
        if rel_join(cwd, args[0]) in self.repo.tracked_set:
            return [self.file_leaf(["bun"] + args, cwd, env, rel_join(cwd, args[0]))], []
        return self._local_bin("bun", args, cwd, env, depth, stack)

    def _yarn(self, words: List[str], cwd: str, env: Dict[str, str], depth: int,
              stack: Tuple[Tuple[str, str], ...]
              ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        target, rest, flags = self._target_dir(words[1:], cwd)
        args = list(rest)
        while args and args[0].startswith("-") and args[0] != "--":
            args = args[1:]
        pkg = self.disc.nearest_package(target)
        berry = (pkg.flavour if pkg is not None else None) == "berry"
        if not args or args[0] == "install":
            return [new_leaf("install", words, target, env, tool="yarn", sub="install",
                             pm="yarn")], []
        sub = args[0]
        if sub == "run":
            if len(args) < 2:
                return [new_leaf("unsupported", words, target, env,
                                 reason="unsupported: yarn run")], []
            return self._yarn_script(args[1], args[2:], target, env, depth, stack, berry, words)
        if sub == "workspace" and len(args) >= 3:
            ws = self.disc.by_name.get(args[1])
            if ws is None:
                return [new_leaf("unresolved", words, target, env,
                                 reason="unknown workspace {}".format(args[1]))], []
            leaves, chain = self._yarn(["yarn"] + args[2:], ws.dir, env, depth + 1, stack)
            return leaves, chain
        if sub == "workspaces" and len(args) >= 2 and args[1] == "foreach":
            return self._yarn_foreach(args[2:], target, env, depth, stack, words)
        if sub == "exec":
            return self.resolve_text(" ".join(args[1:]), target, depth + 1, stack)
        if sub == "dlx":
            return [self._download_leaf(words, args[1:], target, env)], []
        if sub == "npm" and len(args) >= 2 and args[1] == "publish":
            return [new_leaf("tool", words, target, env, tool="yarn", sub="npm publish",
                             pm="yarn")], []
        if sub == "publish":
            return [new_leaf("tool", words, target, env, tool="yarn", sub="publish",
                             pm="yarn")], []
        if sub == "node" and len(args) >= 2:
            return [self.tool_leaf(["node"] + args[1:], target, env)], []
        yarn_builtins = {"add", "remove", "up", "upgrade", "set", "config", "cache", "info",
                         "why", "dedupe", "plugin", "version", "init", "bin", "constraints",
                         "explain", "link", "unlink", "patch", "patch-commit", "rebuild",
                         "stage", "pack", "npm", "global", "import", "outdated", "audit",
                         "check", "create", "generate-lock-entry", "licenses", "login", "logout",
                         "owner", "policies", "tag", "team", "upgrade-interactive"}
        if sub in yarn_builtins and not (pkg is not None and sub in pkg.scripts):
            return [new_leaf("unsupported", words, target, env,
                             reason="unsupported: yarn {}".format(sub))], []
        return self._yarn_script(sub, args[1:], target, env, depth, stack, berry, words)

    def _yarn_script(self, name: str, extra: List[str], cwd: str, env: Dict[str, str],
                     depth: int, stack: Tuple[Tuple[str, str], ...], berry: bool,
                     words: List[str]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        pkg = self.disc.nearest_package(cwd)
        if pkg is not None and name in pkg.scripts:
            return self._script(pkg, name, extra, env, depth, stack, "yarn",
                                prepost=not berry)
        if self._has_bin(name, cwd) or name in KNOWN_BIN_TOOLS:
            return [self.tool_leaf([name] + extra, cwd, env)], []
        if berry and ":" in name:
            owners = [p for p in self.disc.packages.values()
                      if name in p.scripts and (p.kind == "workspace" or p.dir == ".")]
            if len(owners) == 1:
                return self._script(owners[0], name, extra, env, depth, stack, "yarn",
                                    prepost=False)
        return [new_leaf("unresolved", words, cwd, env,
                         reason="unknown script {}".format(name))], []

    def _yarn_foreach(self, args: List[str], cwd: str, env: Dict[str, str], depth: int,
                      stack: Tuple[Tuple[str, str], ...], words: List[str]
                      ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        include: List[str] = []
        exclude: List[str] = []
        rest: List[str] = []
        i = 0
        while i < len(args):
            a = args[i]
            if a in ("--include", "--exclude") and i + 1 < len(args):
                (include if a == "--include" else exclude).append(args[i + 1])
                i += 2
                continue
            if a.startswith("-"):
                i += 1
                continue
            rest.append(a)
            i += 1
        if rest and rest[0] == "run":
            rest = rest[1:]
        if not rest:
            return [new_leaf("unsupported", words, cwd, env,
                             reason="unsupported: yarn workspaces foreach")], []
        name = rest[0]
        leaves: List[Dict[str, Any]] = []
        chain: List[Dict[str, Any]] = []
        for pkg in sorted(self.disc.packages.values(), key=lambda p: p.path):
            if pkg.kind != "workspace" or name not in pkg.scripts:
                continue
            pname = pkg.name or pkg.dir
            if include and not any(C.glob_match(pname, g) for g in include):
                continue
            if any(C.glob_match(pname, g) for g in exclude):
                continue
            got = self._script(pkg, name, rest[1:], env, depth, stack, "yarn", prepost=False)
            leaves += got[0]
            chain += got[1]
        return leaves, chain

    def _scripts(self, pm: str, names: List[str], extra: List[str], target: str,
                 flags: Dict[str, Any], env: Dict[str, str], depth: int,
                 stack: Tuple[Tuple[str, str], ...], after_dash: bool = False
                 ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if not names:
            return [new_leaf("unsupported", [pm, "run"], target, env,
                             reason="unsupported: {} run without a script".format(pm))], []
        name = names[0]
        if after_dash:
            extra = extra[extra.index("--") + 1:] if "--" in extra else \
                [e for e in extra if not e.startswith("-")]
        pkgs: List[Package] = []
        if flags.get("workspaces") or flags.get("filters"):
            for sel in list(flags.get("workspaces") or []) + list(flags.get("filters") or []):
                found = self._select(sel, target)
                if found is None:
                    return [new_leaf("unresolved", [pm, name], target, env,
                                     reason="unresolved selector {}".format(sel))], []
                pkgs += found
        elif flags.get("recursive") or flags.get("all_workspaces"):
            pkgs = [p for p in sorted(self.disc.packages.values(), key=lambda p: p.path)
                    if p.kind == "workspace" and name in p.scripts]
        else:
            pkg = self.disc.nearest_package(target)
            if pkg is None or name not in pkg.scripts:
                return [new_leaf("unresolved", [pm, "run", name], target, env,
                                 reason="unknown script {}".format(name))], []
            pkgs = [pkg]
        leaves: List[Dict[str, Any]] = []
        chain: List[Dict[str, Any]] = []
        for pkg in pkgs:
            if name not in pkg.scripts:
                continue
            got = self._script(pkg, name, extra, env, depth, stack, pm, prepost=True)
            leaves += got[0]
            chain += got[1]
        return leaves, chain

    def _select(self, selector: str, cwd: str) -> Optional[List[Package]]:
        sel = selector.rstrip(".").rstrip(".").rstrip(".") if selector.endswith("...") else selector
        if sel.startswith("./") or sel.startswith("../") or sel == ".":
            pkg = self.disc.packages.get(rel_join(cwd, sel))
            return [pkg] if pkg is not None else None
        if sel in self.disc.by_name:
            return [self.disc.by_name[sel]]
        if "*" in sel:
            return [p for p in sorted(self.disc.packages.values(), key=lambda p: p.path)
                    if p.name and C.glob_match(p.name, sel)]
        pkg = self.disc.packages.get(rel_join(".", sel))
        return [pkg] if pkg is not None else None

    def _script(self, pkg: Package, name: str, extra: Sequence[str], env: Dict[str, str],
                depth: int, stack: Tuple[Tuple[str, str], ...], pm: str, prepost: bool
                ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        key = (pkg.dir, name)
        if key in stack:
            return [new_leaf("unresolved", [pm, name], pkg.dir, env, reason="cycle")], []
        leaves: List[Dict[str, Any]] = []
        chain: List[Dict[str, Any]] = []
        order = [name]
        if prepost:
            order = [n for n in ("pre" + name,) if n in pkg.scripts] + [name] + \
                [n for n in ("post" + name,) if n in pkg.scripts]
        for script in order:
            body = pkg.scripts[script]
            chain.append({"kind": "script", "package": pkg.path, "script": script,
                          "line": pkg.script_lines.get(script), "body": redact(body, 200),
                          "pm": pm})
            got_leaves, got_chain = self.resolve_text(
                body, pkg.dir, depth + 1, stack + (key,),
                extra=list(extra) if script == name else ())
            for leaf in got_leaves:
                if leaf.get("pm") is None:
                    leaf["pm"] = pm
                leaf.setdefault("script_env", dict(env))
                if env:
                    merged = dict(env)
                    merged.update(leaf.get("env") or {})
                    leaf["env"] = merged
            leaves += got_leaves
            chain += got_chain
        return leaves, chain

    def _every_workspace(self, name: str, extra: List[str], cwd: str, env: Dict[str, str],
                         depth: int, stack: Tuple[Tuple[str, str], ...]
                         ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        leaves: List[Dict[str, Any]] = []
        chain: List[Dict[str, Any]] = []
        for pkg in sorted(self.disc.packages.values(), key=lambda p: p.path):
            if pkg.kind == "workspace" and name in pkg.scripts:
                got = self._script(pkg, name, extra, env, depth, stack, pkg.pm, prepost=True)
                leaves += got[0]
                chain += got[1]
        if not leaves:
            leaves.append(new_leaf("unresolved", [name], cwd, env,
                                   reason="no workspace defines {}".format(name)))
        return leaves, chain

    def _run_all(self, words: List[str], cwd: str, env: Dict[str, str], depth: int,
                 stack: Tuple[Tuple[str, str], ...]
                 ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        pkg = self.disc.nearest_package(cwd)
        if pkg is None:
            return [new_leaf("unresolved", words, cwd, env, reason="no package.json")], []
        leaves: List[Dict[str, Any]] = []
        chain: List[Dict[str, Any]] = []
        for arg in words[1:]:
            if arg.startswith("-"):
                continue
            rx = re.compile("^" + re.escape(arg).replace(_BACKSLASH + "*", "[^:]*") + "$")
            names = [n for n in pkg.script_order if rx.match(n)]
            if not names:
                leaves.append(new_leaf("unresolved", [arg], cwd, env,
                                       reason="unknown script {}".format(arg)))
            for n in names:
                got = self._script(pkg, n, (), env, depth, stack, pkg.pm, prepost=True)
                leaves += got[0]
                chain += got[1]
        return leaves, chain

    def _make(self, words: List[str], cwd: str, env: Dict[str, str], depth: int,
              stack: Tuple[Tuple[str, str], ...]
              ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        just = words[0] == "just"
        names = ["justfile", "Justfile", ".justfile"] if just else ["Makefile", "makefile",
                                                                    "GNUmakefile"]
        path = next((rel_join(cwd, n) for n in names if rel_join(cwd, n) in
                     self.repo.tracked_set), None)
        if path is None:
            return [new_leaf("unresolved", words, cwd, env, reason="no {}".format(
                "justfile" if just else "Makefile"))], []
        text = self.repo.read(path)
        if text is None:
            return [new_leaf("unresolved", words, cwd, env, reason="unreadable " + path)], []
        targets = {t[0]: t for t in inv.parse_make_like(text, just)}
        variables: Dict[str, str] = {}
        for line in text.split("\n"):
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:?=\s*(.*)$", line)
            if m:
                variables[m.group(1)] = m.group(2).strip()
        goals = [w for w in words[1:] if not w.startswith("-") and "=" not in w]
        if not goals:
            first = next(iter(targets), None)
            goals = [first] if first else []
        leaves: List[Dict[str, Any]] = []
        chain: List[Dict[str, Any]] = []
        for goal in goals:
            if goal not in targets:
                leaves.append(new_leaf("unresolved", words, cwd, env,
                                       reason="unknown target {}".format(goal)))
                continue
            key = (path, goal)
            if key in stack:
                leaves.append(new_leaf("unresolved", words, cwd, env, reason="cycle"))
                continue
            _name, line, recipe = targets[goal]
            chain.append({"kind": "make" if not just else "just", "package": path,
                          "script": goal, "line": line, "body": redact("; ".join(recipe), 200)})
            for raw_line in recipe:
                cmd = raw_line.lstrip("@-").strip()
                unresolved = False

                def sub_var(m: "re.Match[str]") -> str:
                    nonlocal unresolved
                    name = m.group(1) or m.group(2)
                    if name == "MAKE":
                        return "make"
                    if name in variables:
                        return variables[name]
                    unresolved = True
                    return m.group(0)
                cmd = re.sub(r"\$\(([A-Za-z_][A-Za-z0-9_]*)\)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
                             sub_var, cmd)
                if unresolved:
                    leaves.append(new_leaf("unresolved", [cmd], cwd, env,
                                           reason="make variable"))
                    continue
                got = self.resolve_text(cmd, cwd, depth + 1, stack + (key,))
                leaves += got[0]
                chain += got[1]
        return leaves, chain

    def _env_wrapper(self, words: List[str], cwd: str, env: Dict[str, str], depth: int,
                     stack: Tuple[Tuple[str, str], ...]
                     ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        targets: List[str] = []
        i = 1
        while i < len(words):
            w = words[i]
            if w in ("-e", "-f", "--file") and i + 1 < len(words):
                targets.append(rel_join(cwd, words[i + 1]))
                i += 2
                continue
            if w == "--":
                i += 1
                break
            if w.startswith("-"):
                i += 1
                continue
            break
        if not targets:
            targets = [rel_join(cwd, ".env")]
        leaves, chain = self.resolve_words(words[i:], cwd, env, depth + 1, stack)
        marker = new_leaf("dotenv", words[:i], cwd, env, tool=words[0], dotenv_targets=targets)
        return [marker] + leaves, chain

    # -- bins and downloads ------------------------------------------------------------------
    def _has_bin(self, name: str, cwd: str) -> bool:
        d = cwd
        while True:
            if self.repo.exists(rel_join(d, "node_modules/.bin/" + name)) or \
                    self.repo.exists(rel_join(d, "node_modules/.bin/" + name + ".cmd")):
                return True
            if d == ".":
                return False
            d = rel_dir(d)

    def _declared(self, name: str, cwd: str) -> bool:
        pkg = self.disc.nearest_package(cwd)
        root = self.disc.packages.get(".")
        return any(p is not None and name in p.deps for p in (pkg, root))

    def _local_bin(self, pm: str, args: List[str], cwd: str, env: Dict[str, str], depth: int,
                   stack: Tuple[Tuple[str, str], ...]
                   ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if not args:
            return [new_leaf("unsupported", [pm, "exec"], cwd, env,
                             reason="unsupported: {} exec".format(pm))], []
        return [self.tool_leaf(args, cwd, env)], []

    def _download_or_bin(self, words: List[str], cwd: str, env: Dict[str, str], depth: int,
                         stack: Tuple[Tuple[str, str], ...]
                         ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        args = [w for w in words[1:]]
        while args and args[0].startswith("-"):
            args = args[1:]
        if args and args[0] == "--":
            args = args[1:]
        if not args:
            return [new_leaf("unsupported", words, cwd, env, reason="unsupported: " +
                             words[0])], []
        spec = args[0]
        name, version = split_package_spec(spec)
        if words[0] == "npx" and version is None and (self._has_bin(name, cwd) or
                                                      self._declared(name, cwd)):
            return [self.tool_leaf([name] + args[1:], cwd, env, via=words[0])], []
        return [self._download_leaf(words, args, cwd, env)], []

    def _download_leaf(self, words: List[str], args: List[str], cwd: str,
                       env: Dict[str, str]) -> Dict[str, Any]:
        spec = next((a for a in args if not a.startswith("-")), "")
        name, version = split_package_spec(spec)
        exact = version is not None and re.match(r"^\d+\.\d+\.\d+([-+][\w.]+)?$", version)
        return new_leaf("download", words, cwd, env, tool=words[0], sub=name,
                        package=name, version=version, exact=bool(exact))

    # -- tools and files -------------------------------------------------------------------------
    def file_leaf(self, words: List[str], cwd: str, env: Dict[str, str], path: str,
                  preloads: Sequence[str] = ()) -> Dict[str, Any]:
        leaf = new_leaf("file", words, cwd, env, tool=words[0], file=path)
        leaf["preloads"] = list(preloads)
        return leaf

    def tool_leaf(self, words: List[str], cwd: str, env: Dict[str, str], via: Optional[str] = None
                  ) -> Dict[str, Any]:
        tool = posixpath.basename(C.to_posix(words[0]))
        if tool.endswith((".cmd", ".exe")):
            tool = tool[:-4]
        args = words[1:]
        positional = [a for a in args if not a.startswith("-")]
        sub = positional[0] if positional else None
        leaf = new_leaf("unknown", words, cwd, env, tool=tool, sub=None, via=via)
        text = " ".join(words)
        for tool_name, subs in L1_TOOL_FORMS:
            if tool == tool_name and (subs is None or sub in subs):
                leaf.update(kind="l1", sub=sub)
                return leaf
        if tool in FILE_LAUNCHERS:
            return self._launcher(words, cwd, env, leaf)
        if tool in NOOP_WORDS:
            leaf.update(kind="noop")
            return leaf
        if tool in WRITER_WORDS:
            leaf.update(kind="writer", reason="writes files ({})".format(tool))
            return leaf
        if tool in SCANNER_TOOLS:
            leaf.update(kind="scanner", reason="secret scanner {}: its output may print "
                                               "secrets".format(tool))
            return leaf
        if tool in BROWSER_TOOLS:
            if sub == "install":
                leaf.update(kind="download", sub="install", package=tool, version=None,
                            exact=False)
                return leaf
            leaf.update(kind="browser", reason="browser ({})".format(tool))
            return leaf
        if tool in LONG_TOOLS or re.search(r"(^|\s)(--watch|--watchAll)(\s|=|$)", text):
            leaf.update(kind="long", reason="long-running ({})".format(tool))
            return leaf
        config = _flag_value(args, ("-c", "--config", "-p", "--project"))
        if tool in ("vitest", "jest", "mocha"):
            if tool == "vitest" and sub in ("dev", "watch"):
                leaf.update(kind="long", reason="long-running (vitest watch)")
                return leaf
            if tool == "jest" and re.search(r"(^|\s)(-u|--updateSnapshot)(\s|$)", text):
                leaf.update(kind="writer", reason="writes snapshots (jest -u)")
                return leaf
            if tool == "vitest" and re.search(r"(^|\s)(-u|--update)(\s|$)", text):
                leaf.update(kind="writer", reason="writes snapshots (vitest -u)")
                return leaf
            leaf.update(kind="runner", config=_rel_config(cwd, config))
            return leaf
        if tool == "hardhat":
            return self._hardhat(words, cwd, env, leaf, sub)
        if tool == "next":
            if sub == "lint":
                leaf.update(kind="static", sub="lint")
            elif sub == "build":
                leaf.update(kind="build", sub="build")
            elif sub in ("dev", "start", None):
                leaf.update(kind="long", sub=sub, reason="long-running (next {})".format(
                    sub or "dev"))
            else:
                leaf.update(kind="unsupported", reason="unsupported: next {}".format(sub))
            return leaf
        if tool == "vite":
            if sub == "build":
                leaf.update(kind="build", sub="build", config=_rel_config(cwd, config))
            else:
                leaf.update(kind="long", reason="long-running (vite)")
            return leaf
        if tool == "tsx" and sub == "watch":
            leaf.update(kind="long", reason="long-running (tsx watch)")
            return leaf
        if tool in ("forge", "cargo", "go"):
            return self._toolchain(tool, sub, args, text, leaf, config, cwd)
        if tool == "prettier":
            if re.search(r"(^|\s)(--check|-c|-l|--list-different)(\s|$)", text):
                leaf.update(kind="static", sub="--check")
            else:
                leaf.update(kind="writer", reason="writes files (prettier without --check)")
            return leaf
        if tool == "eslint":
            if re.search(r"(^|\s)--fix(-dry-run)?(\s|=|$)", text) and "--fix-dry-run" not in text:
                leaf.update(kind="writer", reason="writes files (eslint --fix)")
            else:
                leaf.update(kind="static", config=_rel_config(cwd, _flag_value(args, (
                    "-c", "--config"))))
            return leaf
        if tool in ("ruff",):
            if sub == "format" and "--check" not in args:
                leaf.update(kind="writer", reason="writes files (ruff format)")
            elif "--fix" in args:
                leaf.update(kind="writer", reason="writes files (ruff --fix)")
            else:
                leaf.update(kind="static", sub=sub)
            return leaf
        if tool in ("black", "isort") and "--check" not in args and "--check-only" not in args:
            leaf.update(kind="writer", reason="writes files ({} without --check)".format(tool))
            return leaf
        if tool in STATIC_TOOLS:
            if inv.WRITE_FLAGS_RE.search(text):
                leaf.update(kind="writer", reason="writes files ({})".format(tool))
            else:
                resolved = _rel_config(cwd, config)
                if tool in ("tsc", "vue-tsc") and resolved and not resolved.endswith(".json"):
                    resolved = rel_join(resolved, "tsconfig.json")
                leaf.update(kind="static", config=resolved)
            return leaf
        if tool in BUILD_TOOLS:
            leaf.update(kind="build", config=_rel_config(cwd, config))
            return leaf
        if tool == "pytest":
            leaf.update(kind="runner", tool="pytest")
            return leaf
        if inv.WRITE_FLAGS_RE.search(text):
            leaf.update(kind="writer", reason="writes files ({})".format(tool))
            return leaf
        leaf.update(kind="unknown", reason="unknown tool {}".format(tool))
        return leaf

    def _launcher(self, words: List[str], cwd: str, env: Dict[str, str],
                  leaf: Dict[str, Any]) -> Dict[str, Any]:
        tool = leaf["tool"]
        args = words[1:]
        preloads: List[str] = []
        env_files: List[str] = []
        i = 0
        if tool == "deno":
            if not args or args[0] != "run":
                leaf.update(kind="unsupported", reason="unsupported: deno")
                return leaf
            i = 1
        if tool in ("python", "python3") and len(args) >= 2 and args[0] == "-m":
            module = args[1]
            if module == "pytest":
                leaf.update(kind="runner", tool="pytest")
            elif module == "unittest":
                leaf.update(kind="runner", tool="unittest")
            elif module == "http.server":
                leaf.update(kind="long", reason="long-running (python -m http.server)")
            elif module in ("mypy", "ruff", "black", "isort", "flake8", "pylint"):
                return self.tool_leaf([module] + args[2:], cwd, env)
            else:
                leaf.update(kind="unsupported", reason="unsupported: python -m {}".format(module))
            return leaf
        if tool == "node" and "--test" in args:
            paths = [a for a in args if not a.startswith("-")]
            leaf.update(kind="runner", tool="node", sub="--test", test_paths=paths)
            return leaf
        while i < len(args):
            a = args[i]
            key, eq, val = a.partition("=")
            if key in ("-r", "--require", "--import", "--loader", "--experimental-loader") \
                    and (eq or i + 1 < len(args)):
                preloads.append(val if eq else args[i + 1])
                i += 1 if eq else 2
                continue
            if key in ("--env-file", "--env-file-if-exists"):
                env_files.append(rel_join(cwd, val if eq else (args[i + 1] if i + 1 < len(args)
                                                               else "")))
                i += 1 if eq else 2
                continue
            if a in ("-e", "--eval", "-p", "--print", "-c"):
                leaf.update(kind="unresolved", reason="dynamic command (inline code)")
                return leaf
            if a.startswith("-"):
                i += 1
                continue
            break
        rest = args[i:]
        if not rest:
            leaf.update(kind="unsupported", reason="unsupported: {} without a file".format(tool))
            return leaf
        target = rel_join(cwd, C.to_posix(rest[0]))
        if "secret-scan" in target.lower():
            leaf.update(kind="scanner", file=target, reason="secret scanner {}: its output may "
                                                            "print secrets".format(target))
            return leaf
        if target not in self.repo.tracked_set:
            if tool in ("bash", "sh") and rest[0] == "-c":
                leaf.update(kind="unresolved", reason="dynamic command")
                return leaf
            if tool == "bun":
                return self.tool_leaf(rest, cwd, env)
            leaf.update(kind="unresolved", reason="untracked file {}".format(redact(rest[0], 80)))
            return leaf
        file_leaf = self.file_leaf(words, cwd, env, target, preloads)
        file_leaf["env_files"] = env_files
        file_leaf["file_args"] = rest[1:]
        return file_leaf

    def _hardhat(self, words: List[str], cwd: str, env: Dict[str, str], leaf: Dict[str, Any],
                 sub: Optional[str]) -> Dict[str, Any]:
        args = words[1:]
        positional = [a for a in args if not a.startswith("-")]
        network = _flag_value(args, ("--network",))
        if network and network in positional:
            positional.remove(network)
        sub = positional[0] if positional else None
        leaf.update(sub=sub, network=network, config=None)
        if sub == "test":
            leaf.update(kind="runner", tool="hardhat", sub="test")
        elif sub in ("compile", "check", "typechain"):
            leaf.update(kind="build")
        elif sub == "clean":
            leaf.update(kind="writer", reason="writes files (hardhat clean deletes build outputs)")
        elif sub == "flatten":
            leaf.update(kind="unsupported", reason="unsupported: hardhat flatten prints sources; "
                                                   "not a check")
        elif sub == "run" and len(positional) >= 2:
            target = rel_join(cwd, positional[1])
            if target in self.repo.tracked_set:
                file_leaf = self.file_leaf(words, cwd, env, target)
                file_leaf.update(tool="hardhat", sub="run", network=network)
                return file_leaf
            leaf.update(kind="unresolved", reason="untracked file {}".format(positional[1]))
        elif sub == "node":
            leaf.update(kind="long", reason="long-running (hardhat node)", live=True)
        elif sub in ("deploy", "verify", "ignition"):
            leaf.update(kind="l1")
        else:
            leaf.update(kind="unknown", reason="unknown tool hardhat {}".format(sub or ""))
        return leaf

    def _toolchain(self, tool: str, sub: Optional[str], args: List[str], text: str,
                   leaf: Dict[str, Any], config: Optional[str], cwd: str) -> Dict[str, Any]:
        leaf["sub"] = sub
        if tool == "forge":
            if sub == "build":
                leaf.update(kind="build")
            elif sub == "test":
                leaf.update(kind="runner")
            elif sub == "fmt":
                leaf.update(kind="static" if "--check" in args else "writer",
                            reason=None if "--check" in args else "writes files (forge fmt)")
            elif sub == "script" and "--broadcast" in args:
                leaf.update(kind="l1")
            else:
                leaf.update(kind="unknown", reason="unknown tool forge {}".format(sub or ""))
        elif tool == "cargo":
            if sub in ("check", "clippy", "build"):
                leaf.update(kind="build")
            elif sub == "test":
                leaf.update(kind="runner")
            elif sub == "fmt":
                leaf.update(kind="static" if "--check" in args else "writer",
                            reason=None if "--check" in args else "writes files (cargo fmt)")
            else:
                leaf.update(kind="unknown", reason="unknown tool cargo {}".format(sub or ""))
        else:
            if sub == "vet":
                leaf.update(kind="static")
            elif sub == "test":
                leaf.update(kind="runner")
            elif sub == "build":
                leaf.update(kind="build")
            elif sub == "fmt":
                leaf.update(kind="writer", reason="writes files (go fmt)")
            else:
                leaf.update(kind="unknown", reason="unknown tool go {}".format(sub or ""))
        return leaf


def _flag_value(args: Sequence[str], names: Sequence[str]) -> Optional[str]:
    for i, a in enumerate(args):
        key, eq, val = a.partition("=")
        if key in names:
            if eq:
                return val
            if i + 1 < len(args):
                return args[i + 1]
    return None


def _rel_config(cwd: str, value: Optional[str]) -> Optional[str]:
    return rel_join(cwd, value) if value else None


def split_package_spec(spec: str) -> Tuple[str, Optional[str]]:
    """(name, version or None) of an npm package spec such as @scope/pkg@1.2.3."""
    if spec.startswith("@"):
        at = spec.find("@", 1)
    else:
        at = spec.find("@")
    if at <= 0:
        return spec, None
    return spec[:at], spec[at + 1:] or None


def install_leaf_form(words: Sequence[str]) -> bool:
    """True when a simple command is an install (npm ci, yarn [install], pip install...)."""
    if not words:
        return False
    if words[0] == "yarn":
        rest = [w for w in words[1:] if not w.startswith("-")]
        return not rest or rest[0] == "install"
    for tool, subs in INSTALL_FORMS:
        if words[0] == tool:
            rest = [w for w in words[1:] if not w.startswith("-")]
            args = []
            skip = False
            for w in words[1:]:
                if skip:
                    skip = False
                    continue
                if w in ("--prefix", "-C", "--dir", "--cwd"):
                    skip = True
                    continue
                if not w.startswith("-"):
                    args.append(w)
            del rest
            return bool(args) and args[0] in subs
    return False


# ---------------------------------------------------------------------------
# Signals (GA-06 6.6)
# ---------------------------------------------------------------------------

def _rx(*patterns: str, flags: int = 0) -> List["re.Pattern[str]"]:
    return [re.compile(p, flags) for p in patterns]


N2_RES = {
    "js": _rx(r"\b(?:fetch|axios(?:\.\w+)?|got|ky|superagent)\s*\(",
              r"\bhttps?\.(?:get|request)\s*\(",
              r"\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\s*\(",
              r"\b(?:createPublicClient|createWalletClient)\s*\(",
              r"\bnew\s+(?:ethers\.)?(?:JsonRpcProvider|WebSocketProvider|AlchemyProvider"
              r"|InfuraProvider|EtherscanProvider)\s*\(",
              r"\bnew\s+Web3\s*\(",
              r"\breqwest::", r"\bureq::", r"\bTcpStream::connect\b",
              r"\bhttp\.(?:Get|Post|Head|NewRequest|DefaultClient)\b", r"\bnet\.Dial\b",
              r"\bethclient\.Dial\b"),
    "py": _rx(r"\brequests\.(?:get|post|put|patch|delete|head|request|Session)\b",
              r"\bhttpx\.(?:get|post|Client|AsyncClient|request)\b",
              r"\baiohttp\.ClientSession\b", r"\burllib\.request\.urlopen\b",
              r"\bsocket\.create_connection\b"),
    "sh": _rx(r"(?:^|[\s;&|(])(?:curl|wget|Invoke-WebRequest|iwr)\b"),
}
STUB_MARKERS = re.compile(
    r"vi\.stubGlobal\(|vi\.mock\(|jest\.mock\(|jest\.spyOn\([^)]*fetch|vi\.spyOn\([^)]*fetch"
    r"|globalThis\.fetch\s*=|global\.fetch\s*=|\bnock\(|setupServer\(|fetchFn\s*:"
    r"|responses\.activate|\brespx\b|requests_mock|httpretty|pytest_httpserver")
L6_RE = re.compile(r"\bClient\.for(?:Testnet|Mainnet|Previewnet|Name)\s*\(|"
                   r"(?:\bethers\.)?\bgetDefaultProvider\s*\(|\bnew\s+ccxt\.\w+\s*\(")
L3_RE = re.compile(r"\bfromEncryptedJson\b|\bfromMnemonic\b|\bmnemonicToSeed\b|"
                   r"\bPrivateKey\.from\w*\s*\(|\bnew\s+Wallet\s*\(|\bWallet\.createRandom\b|"
                   r"\bHDNodeWallet\b|\bwriteFileSync\s*\([^)\n]*\.env|\benvfile\b[^\n]*\bstringify\b")
L1_CODE_RE = re.compile(r"(?i)\b(?:sourcify|etherscan)\b|verify:verify|\bverifyContract\s*\(")
SPAWN_RE = re.compile(r"\bchild_process\b|\bexeca\b|\bspawn(?:Sync)?\s*\(|\bexec(?:Sync|File|"
                      r"FileSync)?\s*\(|\bBun\.spawn\b|\bsubprocess\.|\bos\.system\s*\(")
S2_RES = _rx(r"\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)",
             r"\bprocess\.env\[\s*[\"'`]([^\"'`]+)[\"'`]\s*\]",
             r"\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)",
             r"\bDeno\.env\.get\(\s*[\"']([^\"']+)[\"']",
             r"\bos\.environ\[\s*[\"']([^\"']+)[\"']", r"\bos\.environ\.get\(\s*[\"']([^\"']+)",
             r"\bos\.getenv\(\s*[\"']([^\"']+)", r"\benv::var\(\s*\"([^\"]+)\"",
             r"\bos\.Getenv\(\s*\"([^\"]+)\"")
COMPUTED_ENV_RE = re.compile(r"\bprocess\.env\[\s*([A-Za-z_$][\w$]*)\s*\]")
CONST_RE = re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[\w.]+\s*)?=\s*"
                      r"[\"'`]([A-Za-z_][A-Za-z0-9_]*)[\"'`]")
S1_JS_RES = _rx(r"\bdotenv\s*\.\s*config\s*\(", r"\brequire\(\s*[\"']dotenv[\"']\s*\)\s*\.\s*config\s*\(",
                r"\bimport\s+[\"']dotenv/config[\"']", r"\brequire\(\s*[\"']dotenv/config[\"']\s*\)",
                r"\bprocess\.loadEnvFile\s*\(", r"\bloadEnvConfig\s*\(", r"\bloadEnv\s*\(")
S1_PY_RES = _rx(r"\bload_dotenv\s*\(", r"\bfind_dotenv\s*\(", r"\bdotenv_values\s*\(")
S1_SH_RE = re.compile(r"(?:^|[;&|]\s*)(?:source|\.)\s+([^\s;&|]*\.env[\w.-]*)")
S3_RE = re.compile(r"\b(?:readFileSync|readFile|open|Path)\s*\(\s*([\"'`])([^\"'`\n]+)\1")
VARS_RE = re.compile(r"\bvars\.(?:get|has)\s*\(\s*[\"']([A-Za-z_][A-Za-z0-9_]*)[\"']")
CONFIG_VARIABLE_RE = re.compile(r"\bconfigVariable\s*\(")
N1_RE = re.compile(r"\b(?:https?|wss?)://([^/\s\"'`]+)")
N1_SCHEMA_HOSTS = frozenset(["json-schema.org", "www.w3.org", "schemastore.org",
                             "www.schemastore.org", "json.schemastore.org"])
SOL_FORK_RE = re.compile(r"\bvm\.(?:createFork|createSelectFork|rpcUrl)\s*\(")
IMPORT_RES = _rx(r"\bimport\s+(?:type\s+)?(?:[^'\";]*?\sfrom\s+)?[\"']([^\"']+)[\"']",
                 r"\bexport\s+[^'\";]*?\sfrom\s+[\"']([^\"']+)[\"']",
                 r"\brequire\s*\(\s*[\"']([^\"']+)[\"']\s*\)",
                 r"\bimport\s*\(\s*[\"']([^\"']+)[\"']\s*\)")
DYNAMIC_IMPORT_RE = re.compile(r"\b(?:import|require)\s*\(\s*(?![\"'][^\"'\n]*[\"']\s*[),])")
SH_CALL_RE = re.compile(r"(?:^|[\s;&|(])(?:bash|sh|source|\.)\s+[\"']?([^\s\"';&|]+\.sh)\b")
PY_IMPORT_RES = _rx(r"^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import\b", r"^[ \t]*import[ \t]+([\w.]+)",
                    flags=re.M)
JS_RESOLVE_EXTS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json")
LIVE_TIER_HINT = "live-tier configuration"


def host_is_local(host: str) -> bool:
    h = host.lower().split("@")[-1]
    if h.startswith("["):
        return h.startswith("[::1]")
    h = h.split(":")[0]
    if h in ("localhost", "0.0.0.0") or h.endswith(".localhost") or re.match(r"^127\.", h):
        return True
    for tld in (".test", ".example", ".invalid"):
        if h.endswith(tld):
            return True
    if re.search(r"(^|\.)example\.(com|net|org)$", h):
        return True
    return h in N1_SCHEMA_HOSTS


def signal(sid: str, path: Optional[str], line: Optional[int], text: str, detail: str
           ) -> Dict[str, Any]:
    return {"id": sid, "file": path, "line": line, "text": redact(text), "detail": detail}


STRONG_IDS = ("L1", "L2", "L3", "L4", "L5", "L6", "T", "S1", "S3")


class Scanner:
    """Per-file signal extraction, cached by (path, role)."""

    def __init__(self, repo: Repo) -> None:
        self.repo = repo
        self.cache: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
        self._aliases: Dict[str, List[Tuple[str, List[str]]]] = {}

    # -- import graphs ----------------------------------------------------------------------
    def tsconfig_aliases(self, directory: str) -> List[Tuple[str, List[str]]]:
        d = directory
        while True:
            path = rel_join(d, "tsconfig.json")
            if path in self.repo.tracked_set:
                if path not in self._aliases:
                    self._aliases[path] = self._read_aliases(path, 0)
                return self._aliases[path]
            if d == ".":
                return []
            d = rel_dir(d)

    def _read_aliases(self, path: str, depth: int) -> List[Tuple[str, List[str]]]:
        text = self.repo.read(path)
        if text is None or depth > 5:
            return []
        try:
            data = load_jsonc(text)
        except ValueError:
            return []
        if not isinstance(data, dict):
            return []
        opts = data.get("compilerOptions") if isinstance(data.get("compilerOptions"), dict) \
            else {}
        out: List[Tuple[str, List[str]]] = []
        paths = opts.get("paths") if isinstance(opts.get("paths"), dict) else None
        base = rel_join(rel_dir(path), opts.get("baseUrl") or ".") \
            if isinstance(opts.get("baseUrl"), str) else rel_dir(path)
        if paths:
            for key, targets in paths.items():
                if isinstance(key, str) and isinstance(targets, list):
                    out.append((key, [rel_join(base, t) for t in targets if isinstance(t, str)]))
        ext = data.get("extends")
        if not paths and isinstance(ext, str) and ext.startswith("."):
            parent = rel_join(rel_dir(path), ext if ext.endswith(".json") else ext + ".json")
            out = self._read_aliases(parent, depth + 1)
        return out

    def resolve_import(self, from_file: str, spec: str) -> Optional[str]:
        spec = C.to_posix(spec).split("?")[0]
        bases: List[str] = []
        if spec.startswith("."):
            bases.append(rel_join(rel_dir(from_file), spec))
        else:
            for key, targets in self.tsconfig_aliases(rel_dir(from_file)):
                if key.endswith("*") and spec.startswith(key[:-1]):
                    tail = spec[len(key) - 1:]
                    bases += [t[:-1] + tail if t.endswith("*") else t for t in targets]
                elif key == spec:
                    bases += targets
        for base in bases:
            tries = [base] + [base + e for e in JS_RESOLVE_EXTS] + \
                [rel_join(base, "index" + e) for e in JS_RESOLVE_EXTS]
            stem, ext = os.path.splitext(base)
            swap = {".js": (".ts", ".tsx"), ".mjs": (".mts",), ".cjs": (".cts",),
                    ".jsx": (".tsx",)}
            tries += [stem + e for e in swap.get(ext, ())]
            for t in tries:
                if t in self.repo.tracked_set:
                    return t
        return None

    def graph(self, roots: Sequence[str], depth_cap: int = GRAPH_DEPTH,
              file_cap: int = GRAPH_FILES) -> Tuple[List[str], List[Dict[str, Any]], bool]:
        """(files, incompleteness notes, truncated) of the local import graph of `roots`."""
        seen: List[str] = []
        notes: List[Dict[str, Any]] = []
        truncated = False
        frontier = [(r, 0) for r in roots]
        visited: Set[str] = set()
        while frontier:
            path, depth = frontier.pop(0)
            if path in visited:
                continue
            visited.add(path)
            seen.append(path)
            if len(seen) > file_cap:
                truncated = True
                break
            code = self.repo.code(path)
            if code is None:
                continue
            kind = language_kind(path)
            children: List[str] = []
            if kind == "js":
                for rx in IMPORT_RES:
                    for m in rx.finditer(code.clean):
                        if not code.is_code(m.start()):
                            continue
                        target = self.resolve_import(path, m.group(1))
                        if target is not None:
                            children.append(target)
                for m in DYNAMIC_IMPORT_RE.finditer(code.clean):
                    if code.is_code(m.start()):
                        line = code.line_of(m.start())
                        notes.append(signal("graph", path, line, code.line_text(line).strip(),
                                            "non-literal dynamic import or require"))
            elif kind == "py":
                for rx in PY_IMPORT_RES:
                    for m in rx.finditer(code.clean):
                        target = self._py_module(path, m.group(1))
                        if target is not None:
                            children.append(target)
            elif kind == "sh":
                for m in SH_CALL_RE.finditer(code.clean):
                    target = self._sh_target(path, m.group(1))
                    if target is not None:
                        children.append(target)
            if depth >= depth_cap:
                if any(c not in visited for c in children):
                    truncated = True
                continue
            for child in children:
                if child not in visited:
                    frontier.append((child, depth + 1))
        return seen, notes, truncated

    def _sh_target(self, from_file: str, spec: str) -> Optional[str]:
        """A shell file another shell file runs or sources (`$HERE/x.sh` read as a sibling)."""
        spec = C.to_posix(spec)
        tries = [rel_join(rel_dir(from_file), posixpath.basename(spec))] if "$" in spec else \
            [rel_join(rel_dir(from_file), spec), rel_join(".", spec)]
        return next((t for t in tries if t in self.repo.tracked_set), None)

    def _py_module(self, from_file: str, module: str) -> Optional[str]:
        if not module:
            return None
        dots = len(module) - len(module.lstrip("."))
        name = module.lstrip(".").replace(".", "/")
        bases = []
        if dots:
            d = rel_dir(from_file)
            for _ in range(dots - 1):
                d = rel_dir(d)
            bases.append(rel_join(d, name) if name else d)
        else:
            bases += [rel_join(rel_dir(from_file), name), name]
        for base in bases:
            for t in (base + ".py", rel_join(base, "__init__.py")):
                if t in self.repo.tracked_set:
                    return t
        return None

    # -- one file ---------------------------------------------------------------------------------
    def scan(self, path: str, role: str, cwd: str) -> Dict[str, Any]:
        """Signals of one file in one role (config, setup, test, file, build, shell, e2e)."""
        key = (path, role, cwd)
        if key in self.cache:
            return self.cache[key]
        result: Dict[str, Any] = {"signals": [], "weak": [], "recorded": [], "incomplete": [],
                                  "s1": [], "switches": [], "unsupported": None,
                                  "secret_file": None, "computed": []}
        self.cache[key] = result
        # The Hardhat config's import graph is read as a config, without N1 (GA-06 6.6).
        hardhat_graph = role == "hhconfig"
        if hardhat_graph:
            role = "config"
        base = posixpath.basename(path)
        if SECRET_FILE_RE.match(base):
            result["secret_file"] = path
            return result
        code = self.repo.code(path)
        if code is None:
            return result
        kind = language_kind(path)
        clean = code.clean
        lines = clean.split("\n")

        def at(m: "re.Match[str]") -> Tuple[int, str]:
            line = code.line_of(m.start())
            return line, lines[line - 1] if line - 1 < len(lines) else ""

        def code_matches(rx: "re.Pattern[str]") -> Iterable["re.Match[str]"]:
            for m in rx.finditer(clean):
                if code.is_code(m.start()):
                    yield m

        # S2 (recorded; L3 in file leaves) and computed env reads.
        names: List[Tuple[str, int]] = []
        for rx in S2_RES:
            for m in code_matches(rx):
                line, _txt = at(m)
                names.append((m.group(1), line))
        consts = dict(CONST_RE.findall(clean))
        if kind == "js" and COMPUTED_ENV_RE.search(clean):
            for rx in IMPORT_RES:
                for m in rx.finditer(clean):
                    target = self.resolve_import(path, m.group(1)) if code.is_code(m.start()) \
                        else None
                    imported = self.repo.code(target) if target else None
                    if imported is not None:
                        for cname, cvalue in CONST_RE.findall(imported.clean):
                            consts.setdefault(cname, cvalue)
        for m in code_matches(COMPUTED_ENV_RE):
            line, txt = at(m)
            if m.group(1) in consts:
                names.append((consts[m.group(1)], line))
            else:
                result["computed"].append(signal("S2", path, line, txt.strip(),
                                                 "computed env read"))
        for name, line in names:
            if SECRET_NAME_RE.search(name):
                sid = "L3" if role == "file" else "S2"
                entry = signal(sid, path, line, lines[line - 1].strip() if line <= len(lines)
                               else name, "reads secret-named variable {}".format(name))
                (result["signals"] if sid == "L3" else result["recorded"]).append(entry)
        # Live switches (runner configs): env reads near a fork, mainnet, testnet or rpc token.
        if role == "config":
            for name, line in names:
                window = " ".join(lines[max(0, line - 6):line + 5])
                if SWITCH_CONTEXT_TOKENS & set(name_tokens(window)):
                    result["switches"].append((name, path, line))
        # L1 in file-leaf code (strings too: the endpoint is usually a literal).
        if role in ("file", "shell"):
            for m in L1_CODE_RE.finditer(clean):
                line, txt = at(m)
                result["signals"].append(signal("L1", path, line, txt.strip(),
                                                "verification or explorer publishing"))
                break
        if role == "file" and kind in ("js", "py"):
            for m in code_matches(L3_RE):
                line, txt = at(m)
                result["signals"].append(signal("L3", path, line, txt.strip(), "key handling"))
            for m in code_matches(SPAWN_RE):
                line, txt = at(m)
                result["incomplete"].append(signal("graph", path, line, txt.strip(),
                                                   "spawns a process the scan cannot follow"))
                break
        if role in ("test", "file", "setup", "e2e"):
            for m in code_matches(L6_RE):
                line, txt = at(m)
                result["signals"].append(signal("L6", path, line, txt.strip(),
                                                "live-default client"))
        if kind == "js" and base.endswith(".sol") and role in ("test", "file"):
            for m in code_matches(SOL_FORK_RE):
                line, txt = at(m)
                result["signals"].append(signal("L2", path, line, txt.strip(), "fork cheatcode"))
        # N2 network clients (weak).
        if role in ("config", "setup", "test", "build", "file", "e2e", "shell"):
            stubbed = role == "test" and STUB_MARKERS.search(clean) is not None
            rx_list = N2_RES.get(kind if kind in N2_RES else "js", [])
            if kind == "sh" or role == "shell":
                rx_list = N2_RES["sh"]
            if not stubbed:
                for rx in rx_list:
                    for m in code_matches(rx):
                        line, txt = at(m)
                        result["weak"].append(signal("N2", path, line, txt.strip(),
                                                     "network client"))
                        break
        # N1 URL literals (weak): configs other than Hardhat's, setup files, file leaves.
        is_hardhat_config = base.startswith("hardhat.config.")
        if role in ("config", "setup", "file") and not is_hardhat_config and not hardhat_graph:
            for m in N1_RE.finditer(clean):
                if code.is_comment(m.start()) or host_is_local(m.group(1)):
                    continue
                line, txt = at(m)
                result["weak"].append(signal("N1", path, line, txt.strip(), "URL literal"))
                break
        # S1 secret-file loads and S3 key-file reads.
        if role in ("config", "setup", "file", "shell", "e2e"):
            self._s1(path, code, kind, cwd, result)
            for m in S3_RE.finditer(clean):
                if code.is_comment(m.start()):
                    continue
                if SECRET_FILE_RE.match(posixpath.basename(C.to_posix(m.group(2)))):
                    line, txt = at(m)
                    result["signals"].append(signal("S3", path, line, txt.strip(),
                                                    "reads a key or secret file"))
        if role == "config" and is_hardhat_config or role == "config" and kind == "js":
            for m in code_matches(VARS_RE):
                if not SECRET_NAME_RE.search(m.group(1)):
                    continue
                keys = enclosing_keys(code, m.start())
                network = _network_of(keys)
                if network is not None and network not in LOCAL_NETWORKS:
                    continue
                line, txt = at(m)
                result["signals"].append(signal("S3", path, line, txt.strip(),
                                                "Hardhat configuration variable {} read from "
                                                "its plain-text store".format(m.group(1))))
            for m in code_matches(CONFIG_VARIABLE_RE):
                line, _txt = at(m)
                result["unsupported"] = "unsupported (Hardhat 3 configuration variables at " \
                                        "{}:{})".format(path, line)
                break
        if role == "config" and is_hardhat_config:
            self._hardhat_config(path, code, result)
        if role == "config" and base == "foundry.toml":
            self._foundry(path, code, result)
        return result

    def _s1(self, path: str, code: Code, kind: str, cwd: str, result: Dict[str, Any]) -> None:
        clean = code.clean
        file_dir = rel_dir(path)
        entries: List[Tuple["re.Match[str]", str]] = []
        if kind == "js":
            for rx in S1_JS_RES:
                entries += [(m, "js") for m in rx.finditer(clean) if code.is_code(m.start())]
            if re.search(r"\bfrom\s+[\"']dotenv[\"']", clean):
                entries += [(m, "js") for m in re.finditer(r"(?<![.\w])config\s*\(", clean)
                            if code.is_code(m.start())]
        elif kind == "py":
            for rx in S1_PY_RES:
                entries += [(m, "py") for m in rx.finditer(clean) if code.is_code(m.start())]
        elif kind == "sh":
            for m in S1_SH_RE.finditer(clean):
                line = code.line_of(m.start())
                result["s1"].append({"file": path, "line": line,
                                     "text": redact(code.line_text(line).strip()),
                                     "targets": [rel_join(cwd, m.group(1))], "resolved": True})
            return
        seen_lines: Set[int] = set()
        for m, lang in entries:
            line = code.line_of(m.start())
            if line in seen_lines:
                continue
            seen_lines.add(line)
            call = m.group(0)
            args = _call_args(clean, m.end()) if call.rstrip().endswith("(") else ""
            targets, resolved = _s1_targets(call, args, lang, cwd, file_dir)
            result["s1"].append({"file": path, "line": line,
                                 "text": redact(code.line_text(line).strip()),
                                 "targets": targets, "resolved": resolved})

    def _hardhat_config(self, path: str, code: Code, result: Dict[str, Any]) -> None:
        clean = code.clean
        switch_vars: Set[str] = set()
        switch_names = {n for n, _p, _l in result["switches"]} | set(FIXED_LIVE_SWITCHES)
        for m in re.finditer(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)", clean):
            refs = re.findall(r"process\.env(?:\.|\[\s*[\"'])([A-Za-z_][A-Za-z0-9_]*)", m.group(2))
            if any(r in switch_names or LIVE_ENV_TOKENS & set(name_tokens(r)) for r in refs):
                switch_vars.add(m.group(1))
        m = re.search(r"\bdefaultNetwork\s*:\s*[\"'`]([\w-]+)[\"'`]", clean)
        if m and code.is_code(m.start()) and m.group(1) not in LOCAL_NETWORKS:
            line = code.line_of(m.start())
            result["signals"].append(signal("L2", path, line, code.line_text(line).strip(),
                                            "defaultNetwork {}".format(m.group(1))))
        networks: List[str] = []
        for m in re.finditer(r"\burl\s*:", clean):
            if not code.is_code(m.start()):
                continue
            net = _network_of(enclosing_keys(code, m.start()))
            if net and net not in LOCAL_NETWORKS and net not in networks:
                networks.append(net)
        result["networks"] = networks
        for m in re.finditer(r"\bforking\s*:", clean):
            if not code.is_code(m.start()):
                continue
            keys = enclosing_keys(code, m.start())
            if _network_of(keys) != "hardhat":
                continue
            guards = " ".join(g for _k, g in keys)
            window = clean[max(0, m.start() - 400):m.start()]
            guarded = any(re.search(r"\b" + re.escape(v) + r"\b", guards + " " + window[-160:])
                          for v in switch_vars) or re.search(
                r"process\.env\.(" + "|".join(re.escape(n) for n in sorted(switch_names)) + ")",
                guards) is not None
            if not guarded:
                line = code.line_of(m.start())
                result["signals"].append(signal("L2", path, line, code.line_text(line).strip(),
                                                "networks.hardhat.forking without a switch"))

    def _foundry(self, path: str, code: Code, result: Dict[str, Any]) -> None:
        section = ""
        for num, line in enumerate(code.clean.split("\n"), 1):
            head = re.match(r"^\s*\[([^\]]+)\]", line)
            if head:
                section = head.group(1).strip()
                continue
            if section == "profile.default" and re.match(r"^\s*(eth_rpc_url|fork_url)\s*=", line):
                result["signals"].append(signal("L2", path, num, line.strip(),
                                                "fork URL in the default profile"))
            if section == "profile.default" and re.match(r"^\s*ffi\s*=\s*true", line):
                result["signals"].append(signal("L2", path, num, line.strip(), "ffi = true"))


def _call_args(text: str, start: int) -> str:
    depth = 1
    i = start
    while i < len(text) and i - start < 400:
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[start:i]
        i += 1
    return text[start:i]


def _s1_targets(call: str, args: str, lang: str, cwd: str, file_dir: str
                ) -> Tuple[List[str], bool]:
    """(targets, resolved) of one dotenv-style load (GA-06 S1 target resolution)."""
    a = args.strip()
    if "dotenv/config" in call:
        return [rel_join(cwd, ".env")], True
    if lang == "py":
        if "find_dotenv" in call or not a or a.startswith("find_dotenv"):
            return ["<ancestors>:" + file_dir], True
        lits = string_literals(a)
        return ([rel_join(cwd, lits[0])], True) if lits and a.startswith(("'", "\"")) else ([],
                                                                                            False)
    if "loadEnvConfig" in call or re.search(r"\bloadEnv\s*\(", call):
        parts = [p.strip() for p in a.split(",")]
        root_arg = parts[0] if "loadEnvConfig" in call else (parts[1] if len(parts) > 1 else "")
        directory = _dir_arg(root_arg, cwd, file_dir)
        if directory is None:
            return [], False
        return [rel_join(directory, n) for n in MODE_ENV_NAMES], True
    if not a or a == "{}":
        return [rel_join(cwd, ".env")], True
    if "loadEnvFile" in call:
        lits = string_literals(a)
        return ([rel_join(cwd, lits[0])], True) if lits and a[0] in "\"'`" else ([], False)
    if not a.startswith("{"):
        return [], False
    pm = re.search(r"\bpath\s*:\s*(.+?)(?:,\s*[A-Za-z_]\w*\s*:|\}\s*$|$)", a, re.S)
    if not pm:
        return [rel_join(cwd, ".env")], True
    value = pm.group(1).strip().rstrip(",").strip()
    if value[:1] in "\"'`" and "${" not in value:
        lits = string_literals(value)
        return ([rel_join(cwd, lits[0])], True) if lits else ([], False)
    joined = re.match(r"^(?:path\.)?(?:resolve|join)\s*\(\s*__dirname\s*,(.*)\)\s*$", value, re.S)
    if joined:
        lits = string_literals(joined.group(1))
        if lits and len(lits) == joined.group(1).count(",") + 1:
            return [rel_join(file_dir, "/".join(lits))], True
        return [], False
    url = re.match(r"^new\s+URL\s*\(\s*([\"'])([^\"']+)\1\s*,\s*import\.meta\.url\s*\)", value)
    if url:
        return [rel_join(file_dir, url.group(2))], True
    return [], False


def _dir_arg(value: str, cwd: str, file_dir: str) -> Optional[str]:
    v = value.strip()
    if v in ("process.cwd()", "\".\"", "'.'", ""):
        return cwd
    if v == "__dirname":
        return file_dir
    lits = string_literals(v)
    if lits and v[:1] in "\"'":
        return rel_join(cwd, lits[0])
    return None


def enclosing_keys(code: Code, pos: int) -> List[Tuple[str, str]]:
    """Object keys enclosing `pos`, innermost first: [(key, text between `key:` and `{`)]."""
    text = code.clean
    out: List[Tuple[str, str]] = []
    depth = 0
    i = pos - 1
    while i >= 0:
        ch = text[i]
        if code.is_code(i):
            if ch in "}])":
                depth += 1
            elif ch in "{[(":
                if depth == 0:
                    if ch == "{":
                        before = text[max(0, i - 160):i]
                        m = re.search(r"([A-Za-z_$][\w$]*|\"[^\"]+\"|'[^']+')\s*:\s*([^{}:,;]*)$",
                                      before)
                        if m:
                            out.append((m.group(1).strip("\"'"), m.group(2).strip()))
                        else:
                            out.append(("", before[-40:].strip()))
                else:
                    depth -= 1
        i -= 1
    return out


def _network_of(keys: Sequence[Tuple[str, str]]) -> Optional[str]:
    names = [k for k, _g in keys]
    if "networks" in names:
        idx = names.index("networks")
        if idx >= 1:
            return names[idx - 1]
    return None


def argv_signals(leaf: Dict[str, Any], networks: Sequence[str], where: Tuple[Optional[str],
                 Optional[int]]) -> List[Dict[str, Any]]:
    """Signals read from a leaf's argv and chain env (L1 tools, L2, L5, T env names)."""
    out: List[Dict[str, Any]] = []
    words = leaf.get("argv") or []
    text = " ".join(words)
    path, line = where
    kind = leaf.get("kind")
    if kind == "l1" or kind == "tool" and leaf.get("sub") in ("publish", "npm publish"):
        out.append(signal("L1", path, line, text, "{} {}".format(leaf.get("tool"),
                                                                leaf.get("sub") or "")))
    if kind == "download":
        if not leaf.get("exact"):
            out.append(signal("L5", path, line, text, "download without an exact version"))
    network = leaf.get("network") or _flag_value(words, ("--network",))
    if network and network not in LOCAL_NETWORKS and (network in networks or not networks):
        if network in networks:
            out.append(signal("L2", path, line, text, "--network {}".format(network)))
    if re.search(r"(^|\s)(--fork-url|--fork|--rpc-url)(\s|=|$)", text):
        out.append(signal("L2", path, line, text, "fork or RPC URL flag"))
    if leaf.get("tool") == "hardhat" and leaf.get("sub") == "node":
        out.append(signal("L2", path, line, text, "hardhat node"))
    for name in sorted((leaf.get("env") or {})):
        toks = set(name_tokens(name))
        if toks & LIVE_ENV_TOKENS:
            out.append(signal("L2", path, line, "{}=...".format(name),
                              "chain env {} names a live switch".format(name)))
        elif toks & T_TOKENS:
            out.append(signal("T", path, line, "{}=...".format(name),
                              "chain env name token {}".format(sorted(toks & T_TOKENS)[0])))
    if re.search(r"\b(?:curl|wget)\b[^|]*\|\s*(?:ba)?sh\b|\biwr\b[^|]*\|\s*iex\b", text):
        out.append(signal("L5", path, line, text, "piped download"))
    return out


SHELL_L5_RE = re.compile(r"\b(?:npx|pnpm\s+dlx|pnpx|yarn\s+dlx|bunx|uvx|pipx\s+run)\s+(?:-\S+\s+)*"
                         r"[\"']?([@\w./-]+)")
SHELL_ASSIGN_RE = re.compile(r"^\s*(?:readonly\s+|export\s+|local\s+|declare\s+(?:-\w+\s+)?)?"
                             r"([A-Za-z_][A-Za-z0-9_]*)=([\"']?)([^\"'\s$`]*)\2\s*$")


def shell_line_signals(path: str, code: Code) -> List[Dict[str, Any]]:
    """L1 and L5 in the lines of a shell file leaf, with the file's literal NAME=value
    assignments substituted (its commands are not resolved)."""
    out: List[Dict[str, Any]] = []
    raw_lines = code.text.split("\n")
    values: Dict[str, str] = {}
    for raw in raw_lines:
        m = SHELL_ASSIGN_RE.match(raw)
        if m and m.group(3):
            values[m.group(1)] = m.group(3)

    def substitute(text: str) -> str:
        return re.sub(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?",
                      lambda m: values.get(m.group(1), m.group(0)), text)
    for num, raw_line in enumerate(code.clean.split("\n"), 1):
        line = substitute(raw_line)
        if not line.strip():
            continue
        for cmd in split_chain(line):
            _env, _unset, words = take_env(cmd.words)
            if not words:
                continue
            tool = posixpath.basename(words[0])
            positional = [w for w in words[1:] if not w.startswith("-")]
            sub = positional[0] if positional else None
            for tool_name, subs in L1_TOOL_FORMS:
                if tool == tool_name and (subs is None or sub in subs):
                    out.append(signal("L1", path, num, line.strip(), "{} {}".format(tool,
                                                                                    sub or "")))
            if tool == "yarn" and positional[:2] == ["npm", "publish"]:
                out.append(signal("L1", path, num, line.strip(), "yarn npm publish"))
        for m in SHELL_L5_RE.finditer(line):
            name, version = split_package_spec(m.group(1))
            exact = version is not None and re.match(r"^\d+\.\d+\.\d+([-+][\w.]+)?$", version)
            if not exact:
                out.append(signal("L5", path, num, line.strip(),
                                  "download of {} without an exact version".format(name)))
        if re.search(r"\b(?:curl|wget)\b[^|]*\|\s*(?:ba)?sh\b", line):
            out.append(signal("L5", path, num, line.strip(), "piped download"))
    return out


# ---------------------------------------------------------------------------
# Scan scopes per leaf (GA-06 6.5 table)
# ---------------------------------------------------------------------------

ESLINT_CONFIGS = ("eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts",
                  "eslint.config.mts", "eslint.config.cts", ".eslintrc.js", ".eslintrc.cjs")
NEXT_CONFIGS = ("next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts",
                "next.config.mts")
VITEST_CONFIGS = tuple("{}.config.{}".format(stem, ext) for stem in ("vitest", "vite")
                       for ext in ("ts", "mts", "cts", "js", "mjs", "cjs"))
JEST_CONFIGS = tuple("jest.config." + ext for ext in ("ts", "mts", "cts", "js", "mjs", "cjs",
                                                       "json"))
MOCHA_CONFIGS = (".mocharc.js", ".mocharc.cjs", ".mocharc.mjs", ".mocharc.json", ".mocharc.jsonc",
                 ".mocharc.yml", ".mocharc.yaml")
HARDHAT_CONFIGS = tuple("hardhat.config." + ext for ext in ("ts", "js", "cjs", "mjs", "cts",
                                                             "mts"))
PRETTIER_CONFIGS = ("prettier.config.js", "prettier.config.cjs", "prettier.config.mjs",
                    "prettier.config.ts", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs")
VITEST_DEFAULT_RE = re.compile(r"(^|/)[^/]*\.(test|spec)\.(c|m)?[jt]sx?$")
JEST_DEFAULT_RE = re.compile(r"(^|/)__tests__/.*\.[jt]sx?$|(^|/)[^/]*[.](spec|test)\.[jt]sx?$")
NODE_TEST_DEFAULT_RE = re.compile(r"(^|/)([^/]*\.test|[^/]*-test|[^/]*_test|test-[^/]*|test)"
                                  r"\.(c|m)?js$|(^|/)test/.*\.(c|m)?js$")
BUN_TEST_RE = re.compile(r"(^|/)[^/]*[._-](test|spec)\.[^/]+$")
GLOBAL_TOOLS = frozenset(["node", "python", "python3", "bash", "sh", "go", "cargo", "forge", "deno",
                          "bun", "make", "just", "shellcheck", "gofmt", "golangci-lint", "docker",
                          "uv", "poetry", "git", "anvil"])


def expand_braces(pattern: str) -> List[str]:
    m = re.search(r"\{([^{}]*)\}", pattern)
    if not m:
        return [pattern]
    out: List[str] = []
    for alt in m.group(1).split(","):
        out += expand_braces(pattern[:m.start()] + alt + pattern[m.end():])
    return out


def glob_files(repo: Repo, base_dir: str, patterns: Sequence[str]) -> List[str]:
    """Tracked files under base_dir matching any glob (braces expanded; extglob ?(x) read as
    optional)."""
    expanded: List[str] = []
    for p in patterns:
        p = re.sub(r"\?\(([^()]*)\)", lambda m: "{," + m.group(1).replace("|", ",") + "}", p)
        p = p[2:] if p.startswith("./") else p
        expanded += expand_braces(p)
    return repo.glob(base_dir, expanded)


def find_upwards(repo: Repo, directory: str, names: Sequence[str]) -> Optional[str]:
    d = directory
    while True:
        for n in names:
            path = rel_join(d, n)
            if path in repo.tracked_set:
                return path
        if d == ".":
            return None
        d = rel_dir(d)


def first_in(repo: Repo, directory: str, names: Sequence[str]) -> Optional[str]:
    for n in names:
        path = rel_join(directory, n)
        if path in repo.tracked_set:
            return path
    return None


def config_texts(repo: Repo, paths: Sequence[str]) -> str:
    return "\n".join((repo.code(p).clean if repo.code(p) is not None else "") for p in paths)


def literal_list(text: str, key: str) -> Tuple[Optional[List[str]], bool]:
    """(string literals of `key: [...]` or `key: "..."`, present) in comment-free config text."""
    m = re.search(r"\b" + re.escape(key) + r"\s*:\s*(\[[^\]]*\]|[\"'`][^\"'`]*[\"'`]|[^,}\n]+)", text)
    if not m:
        return None, False
    value = m.group(1).strip()
    lits = string_literals(value)
    if value.startswith("[") and not lits and value.strip("[] \n"):
        return None, True
    if not value.startswith(("[", "\"", "'", "`")) and "?" not in value:
        return None, True
    return lits, True


class LeafScan:
    def __init__(self) -> None:
        self.files: List[Tuple[str, str]] = []
        self.strong: List[Dict[str, Any]] = []
        self.weak: List[Dict[str, Any]] = []
        self.recorded: List[Dict[str, Any]] = []
        self.incomplete: List[Dict[str, Any]] = []
        self.excluded: List[str] = []
        self.s1_absent: List[str] = []
        self.truncated = False
        self.switches: List[Tuple[str, str, int]] = []
        self.networks: List[str] = []
        self.review_files: List[str] = []


class Classifier:
    """Candidates, verdicts, gates, e2e checks and bans (GA-06 6.4 to 6.10)."""

    def __init__(self, repo: Repo, disc: Discovery, inventory: Dict[str, Any],
                 environ_names: Sequence[str], native_windows: bool) -> None:
        self.repo = repo
        self.disc = disc
        self.inventory = inventory or {}
        self.environ_names = list(environ_names)
        self.native_windows = native_windows
        self.resolver = Resolver(disc, repo)
        self.scanner = Scanner(repo)
        self.limits = disc.limits
        self.candidates: List[Dict[str, Any]] = []
        self.index: Dict[Tuple[str, ...], Dict[str, Any]] = {}
        self.switches: Dict[str, Tuple[str, int]] = {}
        self.live_networks: List[str] = []
        self.extra_installs: Dict[str, Dict[str, Any]] = {}
        self.network_notes: List[Dict[str, Any]] = []
        root = disc.packages.get(".")
        self.yarn_major = yarn_major(root, repo) if root is not None else None
        self._leaf_cache: Dict[str, LeafScan] = {}
        self.built_gates: Dict[str, Optional[str]] = {}
        self.discovery: List[Dict[str, Any]] = []
        for path in repo.tracked:
            if posixpath.basename(path) in HARDHAT_CONFIGS:
                res = self.scanner.scan(path, "config", rel_dir(path))
                for net in res.get("networks") or []:
                    if net not in self.live_networks:
                        self.live_networks.append(net)

    # -- leaf scanning ---------------------------------------------------------------------------
    def scan_leaf(self, leaf: Dict[str, Any]) -> LeafScan:
        key = json.dumps([leaf.get("kind"), leaf.get("tool"), leaf.get("sub"), leaf.get("argv"),
                          leaf.get("cwd"), leaf.get("file"), leaf.get("config"),
                          sorted((leaf.get("env") or {}).items()), leaf.get("pm")],
                         sort_keys=True)
        if key in self._leaf_cache:
            return self._leaf_cache[key]
        ls = LeafScan()
        self._leaf_cache[key] = ls
        kind, tool, sub, cwd = leaf["kind"], leaf.get("tool"), leaf.get("sub"), leaf["cwd"]
        s1_loads: List[Dict[str, Any]] = []
        configs: List[str] = []
        setups: List[str] = []
        tests: List[str] = []
        builds: List[str] = []
        file_roots: List[str] = []
        explicit_config = leaf.get("config")
        if explicit_config and explicit_config not in self.repo.tracked_set:
            ls.excluded.append("unresolved: config {} is not tracked".format(explicit_config))
        if explicit_config:
            hits = t_hits(posixpath.basename(explicit_config))
            if hits:
                ls.strong.append(signal("L4", explicit_config, None, explicit_config,
                                        "{}: config file name token {}".format(LIVE_TIER_HINT,
                                                                               hits[0])))
        if kind == "static":
            if tool in ("eslint",) or tool == "next" and sub == "lint":
                cfg = explicit_config or first_in(self.repo, cwd, ESLINT_CONFIGS) or \
                    find_upwards(self.repo, cwd, ESLINT_CONFIGS)
                configs += [cfg] if cfg else []
            if tool == "next":
                cfg = first_in(self.repo, cwd, NEXT_CONFIGS)
                configs += [cfg] if cfg else []
                s1_loads.append({"file": None, "line": None, "text": "next",
                                 "targets": [rel_join(cwd, n) for n in MODE_ENV_NAMES],
                                 "resolved": True})
            if tool == "prettier":
                cfg = first_in(self.repo, cwd, PRETTIER_CONFIGS)
                configs += [cfg] if cfg else []
        elif kind == "build":
            if tool == "next":
                cfg = first_in(self.repo, cwd, NEXT_CONFIGS)
                configs += [cfg] if cfg else []
                for d in ("app", "pages", "src/app", "src/pages"):
                    builds += self.repo.files_under(rel_join(cwd, d))
                s1_loads.append({"file": None, "line": None, "text": "next build",
                                 "targets": [rel_join(cwd, n) for n in MODE_ENV_NAMES],
                                 "resolved": True})
                self._download_note(leaf, "font and telemetry downloads of next build")
            elif tool == "hardhat":
                cfg = find_upwards(self.repo, cwd, HARDHAT_CONFIGS)
                configs += [cfg] if cfg else []
                if sub == "compile" or sub in ("check", "typechain"):
                    self._download_note(leaf, "compiler download when not cached ({})".format(
                        self._solc_version(cfg)))
            elif tool == "cargo":
                build_rs = find_upwards(self.repo, cwd, ("build.rs",))
                configs += [build_rs] if build_rs else []
            elif tool == "forge":
                cfg = find_upwards(self.repo, cwd, ("foundry.toml",))
                configs += [cfg] if cfg else []
                self._download_note(leaf, "compiler download when not cached (solc)")
            else:
                cfg = explicit_config or first_in(self.repo, cwd, tuple(
                    "{}.config.{}".format(tool, e) for e in ("ts", "js", "mjs", "cjs", "mts")))
                configs += [cfg] if cfg else []
                if tool == "vite":
                    s1_loads.append({"file": None, "line": None, "text": "vite",
                                     "targets": [rel_join(cwd, n) for n in MODE_ENV_NAMES],
                                     "resolved": True})
        elif kind == "runner":
            self._runner_scope(leaf, ls, configs, setups, tests, s1_loads)
        elif kind == "file":
            file_roots.append(leaf["file"])
            for pre in leaf.get("preloads") or []:
                if pre in ("dotenv/config",):
                    s1_loads.append({"file": None, "line": None, "text": "-r dotenv/config",
                                     "targets": [rel_join(cwd, ".env")], "resolved": True})
                elif pre.startswith("."):
                    target = rel_join(cwd, pre)
                    if target in self.repo.tracked_set:
                        file_roots.append(target)
            for target in leaf.get("env_files") or []:
                s1_loads.append({"file": None, "line": None, "text": "--env-file",
                                 "targets": [target], "resolved": True})
            if leaf.get("tool") == "hardhat":
                cfg = find_upwards(self.repo, cwd, HARDHAT_CONFIGS)
                configs += [cfg] if cfg else []
        elif kind == "dotenv":
            s1_loads.append({"file": None, "line": None, "text": leaf.get("tool") or "dotenv",
                             "targets": leaf.get("dotenv_targets") or [], "resolved": True})
        if leaf.get("pm") == "yarn" and (self.yarn_major or 0) >= 4:
            rc = self.disc.yarnrc.get(".") or Yarnrc()
            targets = [".env.yarn"] if not rc.inject_set else [
                t.rstrip("?") for t in rc.inject]
            s1_loads.append({"file": ".yarnrc.yml" if rc.inject_set else None, "line": None,
                             "text": "Yarn 4 injectEnvironmentFiles",
                             "targets": [rel_join(".", t) for t in targets], "resolved": True})
        # config graphs (runner and tool configs import local modules)
        for cfg in configs:
            graph, notes, truncated = self.scanner.graph([cfg])
            ls.truncated = ls.truncated or truncated
            ls.incomplete += notes
            role = "hhconfig" if posixpath.basename(cfg) in HARDHAT_CONFIGS else "config"
            for path in graph:
                if (path, "config") not in ls.files and (path, "hhconfig") not in ls.files:
                    ls.files.append((path, role))
        for path in setups:
            ls.files.append((path, "setup"))
        for path in tests:
            ls.files.append((path, "test"))
        for path in builds:
            ls.files.append((path, "build"))
        if file_roots:
            graph, notes, truncated = self.scanner.graph(file_roots)
            ls.truncated = ls.truncated or truncated
            ls.incomplete += notes
            for path in graph:
                role = "shell" if language_kind(path) == "sh" else "file"
                ls.files.append((path, role))
                if role == "shell":
                    code = self.repo.code(path)
                    if code is not None:
                        ls.strong += shell_line_signals(path, code)
                    ls.incomplete.append(signal("graph", path, None, path,
                                                "shell file: the commands it runs are not "
                                                "resolved"))
            for path in file_roots:
                hits = t_hits(path)
                if hits:
                    ls.strong.append(signal("T", path, None, path,
                                            "file-leaf path token {}".format(hits[0])))
        for path, role in ls.files:
            res = self.scanner.scan(path, role, cwd)
            if res.get("secret_file"):
                ls.excluded.append("reads a secret-named file {}".format(path))
                continue
            if res.get("unsupported"):
                ls.excluded.append(res["unsupported"])
            for sig in res["signals"]:
                ls.strong.append(sig)
            ls.weak += res["weak"]
            ls.recorded += res["recorded"]
            ls.incomplete += res["incomplete"]
            if res["computed"]:
                ls.recorded += res["computed"]
                ls.review_files.append(path)
            ls.switches += res.get("switches") or []
            s1_loads += res["s1"]
            if path not in self.repo.tracked_set or self.repo.read(path) is None:
                if path in self.repo.tracked_set and self.repo.unreadable(path) not in (
                        None, "secret-named file") and not C.path_generated_reason(path):
                    ls.incomplete.append(signal("graph", path, None, path, "unread: {}".format(
                        self.repo.unreadable(path))))
        for load in s1_loads:
            self._s1_outcome(load, ls)
        if ls.weak or ls.incomplete:
            ls.review_files += sorted({s["file"] for s in ls.weak + ls.incomplete if s["file"]})
        return ls

    def _download_note(self, leaf: Dict[str, Any], what: str) -> None:
        entry = {"cwd": leaf["cwd"], "tool": "{} {}".format(leaf.get("tool"), leaf.get("sub") or
                                                             "").strip(), "detail": what}
        if entry not in self.network_notes:
            self.network_notes.append(entry)

    def _solc_version(self, cfg: Optional[str]) -> str:
        code = self.repo.code(cfg) if cfg else None
        if code is None:
            return "solc"
        m = re.search(r"\bversion\s*:\s*[\"']([\d.]+)[\"']", code.clean) or \
            re.search(r"\bsolidity\s*:\s*[\"']([\d.]+)[\"']", code.clean)
        return "solc {}".format(m.group(1)) if m else "solc"

    def _s1_outcome(self, load: Dict[str, Any], ls: LeafScan) -> None:
        where = "{}:{}".format(load["file"], load["line"]) if load.get("file") else \
            load.get("text") or "chain"
        if not load.get("resolved"):
            ls.excluded.append("unresolvable dotenv target at {}".format(where))
            return
        for target in load.get("targets") or []:
            paths: List[str] = []
            if target.startswith("<ancestors>:"):
                start = os.path.abspath(str(self.repo.abs(target.split(":", 1)[1])))
                stop = _stop_key()
                current = start
                seen: Set[str] = set()
                while current and current not in seen:
                    seen.add(current)
                    paths.append(C.to_posix(os.path.join(current, ".env")))
                    if _at_stop(current, stop):
                        break
                    parent = os.path.dirname(current)
                    if parent == current:
                        break
                    current = parent
            else:
                paths.append(target)
            for p in paths:
                full = p if os.path.isabs(p) or re.match(r"^[A-Za-z]:", p) else \
                    str(self.repo.abs(p))
                shown = self._shown(full)
                if os.path.exists(full):
                    ls.strong.append(signal("S1", load.get("file"), load.get("line"),
                                            load.get("text") or "",
                                            "loads the existing secret file {}".format(shown)))
                elif shown not in ls.s1_absent:
                    ls.s1_absent.append(shown)

    def _shown(self, full: str) -> str:
        rel = os.path.relpath(full, str(self.repo.root))
        return C.to_posix(rel)

    def _runner_scope(self, leaf: Dict[str, Any], ls: LeafScan, configs: List[str],
                      setups: List[str], tests: List[str], s1_loads: List[Dict[str, Any]]
                      ) -> None:
        tool, sub, cwd = leaf.get("tool"), leaf.get("sub"), leaf["cwd"]
        args = leaf.get("argv") or []
        repo = self.repo
        if tool in ("vitest", "jest"):
            names = VITEST_CONFIGS if tool == "vitest" else JEST_CONFIGS
            cfg = leaf.get("config") or first_in(repo, cwd, names)
            if cfg:
                configs.append(cfg)
            graph, _n, _t = self.scanner.graph([cfg]) if cfg else ([], [], False)
            text = config_texts(repo, [p for p in graph])
            include, present = literal_list(text, "include" if tool == "vitest" else "testMatch")
            if present and include is None:
                ls.incomplete.append(signal("graph", cfg, None, cfg or "", "the test include "
                                            "list is not a literal"))
            base = rel_dir(cfg) if cfg else cwd
            if include:
                hits = [h for g in include for h in t_hits(g)]
                if hits:
                    ls.strong.append(signal("L4", cfg, None, ", ".join(include)[:120],
                                            "{}: include glob token {}".format(LIVE_TIER_HINT,
                                                                               hits[0])))
                selected = glob_files(repo, base, include)
            else:
                rx = VITEST_DEFAULT_RE if tool == "vitest" else JEST_DEFAULT_RE
                selected = [p for p in repo.files_under(base) if rx.search(p)
                            and "node_modules/" not in p]
            filters = [a for a in args[1:] if not a.startswith("-") and a not in ("run",)
                       and a != (leaf.get("config") or "")]
            cfg_value = _flag_value(args, ("-c", "--config"))
            filters = [f for f in filters if f != cfg_value]
            if filters and tool == "vitest":
                selected = [p for p in selected if any(f in p for f in filters)]
            for key in ("setupFiles", "globalSetup", "setupFilesAfterEach", "setupFilesAfterEnv"):
                lits, present = literal_list(text, key)
                for lit in lits or []:
                    target = rel_join(base, lit.replace("<rootDir>/", ""))
                    if target in repo.tracked_set:
                        setups.append(target)
                if present and lits is None:
                    ls.incomplete.append(signal("graph", cfg, None, key, "{} is not a "
                                                "literal".format(key)))
            tests += selected
            if tool == "vitest":
                s1_loads.append({"file": None, "line": None, "text": "vitest",
                                 "targets": [rel_join(cwd, n) for n in MODE_ENV_NAMES],
                                 "resolved": True})
        elif tool == "mocha" or tool == "hardhat" and sub == "test":
            if tool == "hardhat":
                cfg = find_upwards(repo, cwd, HARDHAT_CONFIGS)
                if cfg:
                    configs.append(cfg)
                    code = repo.code(cfg)
                    dirs: List[str] = []
                    if code is not None:
                        m = re.search(r"\btests\s*:\s*([^,}\n]+)", code.clean)
                        if m:
                            dirs = string_literals(m.group(1))
                            if not dirs:
                                ls.incomplete.append(signal("graph", cfg, code.line_of(m.start()),
                                                            m.group(0), "paths.tests is not a "
                                                                        "literal"))
                    base = rel_dir(cfg)
                    positional = [a for a in args[2:] if not a.startswith("-")]
                    if positional:
                        tests += [rel_join(cwd, p) for p in positional
                                  if rel_join(cwd, p) in repo.tracked_set]
                    else:
                        for d in dirs or ["test"]:
                            tests += [p for p in repo.files_under(rel_join(base, d))
                                      if re.search(r"\.(c|m)?[jt]s$", p)]
            else:
                cfg = first_in(repo, cwd, MOCHA_CONFIGS)
                if cfg:
                    configs.append(cfg)
                positional = [a for a in args[1:] if not a.startswith("-")]
                if positional:
                    for p in positional:
                        tests += glob_files(repo, cwd, [p]) or (
                            repo.files_under(rel_join(cwd, p)))
                else:
                    tests += [p for p in repo.files_under(rel_join(cwd, "test"))
                              if re.search(r"\.(c|m)?[jt]s$", p)]
        elif tool == "node" and sub == "--test":
            paths = leaf.get("test_paths") or []
            if paths:
                for p in paths:
                    target = rel_join(cwd, p)
                    if target in repo.tracked_set:
                        tests.append(target)
                    else:
                        tests += glob_files(repo, cwd, [p]) or repo.files_under(target)
            else:
                tests += [p for p in repo.files_under(cwd) if NODE_TEST_DEFAULT_RE.search(
                    p if cwd == "." else p[len(cwd) + 1:]) and "node_modules/" not in p]
        elif tool in ("pytest", "unittest"):
            for name in ("pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"):
                path = find_upwards(repo, cwd, (name,))
                if path:
                    configs.append(path)
            setups += [p for p in repo.files_under(cwd) if posixpath.basename(p) == "conftest.py"]
            testpaths: List[str] = []
            for cfg in configs:
                code = repo.code(cfg)
                if code is not None:
                    m = re.search(r"testpaths\s*=\s*(\[[^\]]*\]|[^\n]+)", code.clean)
                    if m:
                        testpaths = string_literals(m.group(1)) or m.group(1).split()
                        base = rel_dir(cfg)
                        testpaths = [rel_join(base, t) for t in testpaths]
                        break
            for d in testpaths or [cwd]:
                tests += [p for p in repo.files_under(d)
                          if re.search(r"(^|/)(test_[^/]*|[^/]*_test)\.py$", p)]
        elif tool == "cargo":
            crate = find_upwards(repo, cwd, ("Cargo.toml",))
            crate_dir = rel_dir(crate) if crate else cwd
            build_rs = rel_join(crate_dir, "build.rs")
            if build_rs in repo.tracked_set:
                configs.append(build_rs)
            tests += [p for p in repo.files_under(crate_dir) if p.endswith(".rs")]
        elif tool == "go":
            tests += [p for p in repo.files_under(cwd) if p.endswith("_test.go")]
        elif tool == "forge":
            cfg = find_upwards(repo, cwd, ("foundry.toml",))
            if cfg:
                configs.append(cfg)
            tests += [p for p in repo.files_under(rel_join(cwd, "test")) if p.endswith(".t.sol")]
        elif tool == "bun":
            tests += [p for p in repo.files_under(cwd) if BUN_TEST_RE.search(p)
                      and "node_modules/" not in p]
        if len(tests) > SCOPE_FILES:
            ls.truncated = True
            del tests[SCOPE_FILES:]
        for p in tests + setups:
            if SECRET_FILE_RE.match(posixpath.basename(p)):
                ls.excluded.append("reads a secret-named file {}".format(p))

    # -- tool presence ---------------------------------------------------------------------------
    def tool_missing(self, leaf: Dict[str, Any]) -> Optional[str]:
        tool = leaf.get("tool")
        kind = leaf.get("kind")
        if not tool or kind in ("noop", "unresolved", "unsupported", "install", "download",
                                "dotenv", "l1"):
            return None
        cwd = leaf["cwd"]
        prefix = leaf.get("runner_prefix")
        if prefix in ("uv", "poetry"):
            project = find_upwards(self.repo, cwd, ("pyproject.toml",))
            pdir = rel_dir(project) if project else cwd
            lock = rel_join(pdir, "uv.lock" if prefix == "uv" else "poetry.lock")
            if prefix == "uv" and lock in self.repo.tracked_set:
                present, _ = deps_present(self.disc, pdir, lock)
                if present and not any(self.repo.exists(rel_join(pdir, ".venv/{}/{}{}".format(
                        b, tool, e))) for b in ("bin", "Scripts") for e in ("", ".exe")):
                    return "tool missing: {} (not in {}/.venv)".format(tool, pdir)
            return None
        if kind == "file":
            launcher = posixpath.basename(C.to_posix(leaf["argv"][0])) if leaf.get("argv") \
                else str(tool)
            if launcher not in ("ts-node", "tsx", "hardhat"):
                return None if shutil.which(launcher) else "tool missing: {}".format(launcher)
            tool = launcher
        elif tool in GLOBAL_TOOLS:
            return None if shutil.which(tool) else "tool missing: {}".format(tool)
        project = self.disc.project_root(cwd)
        lock = self.disc.lockfiles.get(project)
        if leaf.get("pm") or leaf.get("via"):
            if lock is None:
                return None
            present, _ = deps_present(self.disc, project, lock)
            if present and not self.resolver._has_bin(tool, cwd) and not \
                    self.resolver._has_bin(tool, project):
                return "tool missing: {} (not in node_modules/.bin)".format(tool)
            return None
        if shutil.which(tool) is None and not self.resolver._has_bin(tool, cwd):
            return "tool missing: {}".format(tool)
        return None

    # -- candidates (GA-06 6.4) -------------------------------------------------------------
    def script_key(self, text: str, cwd: str) -> Optional[Tuple[str, str, str]]:
        """("script", package dir, name) when `text` is one package-manager script invocation."""
        cmds = split_chain(text)
        if len(cmds) != 1:
            return None
        _env, _unset, words = take_env(cmds[0].words)
        if not words:
            return None
        if words[0] == "node" and len(words) >= 2 and re.search(r"yarn[^/\s]*\.c?js$",
                                                               C.to_posix(words[1])):
            words = ["yarn"] + words[2:]
        if words[0] not in PM_WORDS:
            return None
        target, rest, flags = self.resolver._target_dir(words[1:], cwd)
        if flags["workspaces"] or flags["filters"] or flags["recursive"] or \
                flags["all_workspaces"]:
            return None
        args = [a for a in rest if not a.startswith("-")]
        if not args:
            return None
        pm = words[0]
        if pm == "yarn":
            if args[0] == "workspace" and len(args) >= 3:
                ws = self.disc.by_name.get(args[1])
                if ws is None:
                    return None
                return self.script_key(" ".join(["yarn"] + args[2:]), ws.dir)
            name = args[1] if args[0] == "run" and len(args) > 1 else args[0]
        elif pm == "npm":
            if args[0] in ("run", "run-script", "rum", "urn") and len(args) > 1:
                name = args[1]
            elif args[0] in ("test", "t", "tst", "start", "stop", "restart"):
                name = "test" if args[0] in ("t", "tst") else args[0]
            else:
                return None
        else:
            name = args[1] if args[0] == "run" and len(args) > 1 else args[0]
            if args[0] != "run" and name in inv.PM_BUILTINS:
                return None
        pkg = self.disc.nearest_package(target)
        if pkg is None or name not in pkg.scripts:
            return None
        return ("script", pkg.dir, name)

    def add_candidate(self, origin: str, text: str, cwd: str, provenance: Dict[str, Any],
                      ci: Optional[Dict[str, Any]] = None, script: Optional[Tuple[Package, str]]
                      = None) -> Dict[str, Any]:
        key: Tuple[str, ...]
        skey = self.script_key(text, cwd) if script is None else ("script", script[0].dir,
                                                                    script[1])
        key = skey if skey is not None else ("text", fold(text), cwd)
        existing = self.index.get(key)
        if existing is not None:
            existing["provenance"].append(provenance)
            if ci is not None:
                existing["ci_refs"].append(ci)
                if existing["ci_evidence"] is None and ci.get("evidence"):
                    existing["ci_evidence"] = {"file": ci["file"], "line": ci["line"],
                                               "job": ci["job"]}
            if script is not None and existing.get("script") is None:
                existing["script"] = (script[0].dir, script[1])
            return existing
        cand: Dict[str, Any] = {
            "id": "c{:02d}".format(len(self.candidates) + 1), "origin": origin, "text": text,
            "cwd": cwd, "provenance": [provenance], "ci_refs": [ci] if ci else [],
            "ci_evidence": {"file": ci["file"], "line": ci["line"], "job": ci["job"]}
            if ci and ci.get("evidence") else None,
            "script": (skey[1], skey[2]) if skey is not None else None}
        self.candidates.append(cand)
        self.index[key] = cand
        return cand

    def build_candidates(self, ci: Dict[str, Any]) -> None:
        for item in ci["commands"]:
            if "${{" in item["text"] or "${{" in item["cwd"]:
                self.add_candidate("ci", item["text"], "." if "${{" in item["cwd"] else
                                   item["cwd"], {"source": item["file"], "line": item["line"],
                                                 "detail": "CI step `{}`, job {} ({})".format(
                                                     redact(item["text"], 80), item["job"],
                                                     item["why"])}, ci=dict(item, evidence=False))
                continue
            cwd = rel_join(".", item["cwd"]) if item["cwd"] not in ("", ".") else "."
            self.add_candidate("ci", item["text"], cwd, {
                "source": item["file"], "line": item["line"],
                "detail": "CI step `{}`, job {}: {}".format(redact(item["text"], 80),
                                                           item["job"], item["why"])}, ci=item)
        root = self.disc.packages.get(".")
        ordered: List[Package] = []
        if root is not None:
            ordered.append(root)
        ordered += sorted((p for p in self.disc.packages.values() if p.kind == "workspace"),
                          key=lambda p: p.path)
        ordered += sorted((p for p in self.disc.packages.values() if p.kind == "separate"
                           and p.dir != "."), key=lambda p: p.path)
        first = ("test", "lint", "build", "typecheck", "format:check")
        for pkg in ordered:
            names = [n for n in first if n in pkg.scripts and pkg is root] + \
                [n for n in pkg.script_order if not (pkg is root and n in first)]
            for name in names:
                self.add_candidate("script", self.invocation_text(pkg, name), pkg.dir, {
                    "source": pkg.path, "line": pkg.script_lines.get(name),
                    "detail": "scripts.{}: {}".format(name, redact(pkg.scripts[name], 100))},
                    script=(pkg, name))
        for category, items in sorted((self.inventory.get("command_candidates") or {}).items()):
            for item in items if isinstance(items, list) else []:
                if not isinstance(item, dict) or not isinstance(item.get("cmd"), str):
                    continue
                source = str(item.get("source") or "")
                if source.startswith("ci:") or "scripts." in source:
                    continue
                cwd = C.to_posix(str(item.get("cwd") or ".")) or "."
                origin = "make" if re.search(r"(?i)makefile|justfile", source) else "toolchain"
                self.add_candidate(origin, item["cmd"], cwd, {
                    "source": source.split(" ")[0] or "inventory", "line": item.get("line"),
                    "detail": "inventory candidate ({}): {}".format(category,
                                                                   redact(item["cmd"], 80))})

    def invocation(self, pkg: Package, name: str) -> List[str]:
        if pkg.pm == "yarn":
            project = self.disc.packages.get(pkg.project, pkg)
            rc = self.disc.yarnrc.get(project.dir) or Yarnrc()
            if not self.resolver.yarn_on_path and rc.yarn_path and \
                    rel_join(project.dir, rc.yarn_path) in self.repo.tracked_set:
                return ["node", posixpath.relpath(rel_join(project.dir, rc.yarn_path), pkg.dir),
                        name]
            return ["yarn", name]
        if pkg.pm == "bun":
            return ["bun", "run", name]
        return [pkg.pm, "run", name]

    def invocation_text(self, pkg: Package, name: str) -> str:
        return " ".join(_quote(w) for w in self.invocation(pkg, name))

    # -- classification (GA-06 6.5 to 6.7) -------------------------------------------------------
    def classify_all(self) -> None:
        for cand in self.candidates:
            self.classify(cand)

    def classify(self, cand: Dict[str, Any]) -> None:
        text, cwd = cand["text"], cand["cwd"]
        if "${{" in text:
            text = re.sub(r"\$\{\{.*?\}\}", "CI_EXPRESSION", text)
            cand["ci_expression"] = True
        cand["gate_text"] = text
        cand["gate_cwd"] = cwd
        cand["installs"] = []
        if cand.get("script") is not None:
            pkg = self.disc.packages[cand["script"][0]]
            body = pkg.scripts[cand["script"][1]]
            extracted = self._leading_installs(body, pkg.dir)
            prepost = pkg.pm != "yarn" or pkg.flavour != "berry"
            has_hooks = prepost and any(("pre" + cand["script"][1]) in pkg.scripts or
                                        ("post" + cand["script"][1]) in pkg.scripts
                                        for _ in (0,))
            if extracted is not None and not has_hooks:
                cand["gate_text"], cand["gate_cwd"] = extracted[0], pkg.dir
                cand["installs"] = extracted[1]
        else:
            extracted = self._leading_installs(text, cwd)
            if extracted is not None:
                cand["gate_text"] = extracted[0]
                cand["installs"] = extracted[1]
        leaves, chain = self.resolver.resolve_text(cand["gate_text"], cand["gate_cwd"], 0, ())
        if cand.get("script") is not None and cand["gate_text"] == text:
            pass
        elif cand.get("script") is not None:
            pkg = self.disc.packages[cand["script"][0]]
            chain = [{"kind": "script", "package": pkg.path, "script": cand["script"][1],
                      "line": pkg.script_lines.get(cand["script"][1]),
                      "body": redact(pkg.scripts[cand["script"][1]], 200), "pm": pkg.pm}] + chain
        cand["leaves_raw"] = leaves
        cand["chain"] = chain
        name = cand["script"][1] if cand.get("script") else None
        category = None
        if name is not None:
            pkg = self.disc.packages[cand["script"][0]]
            category = inv.classify_script(name, pkg.scripts[name], pkg.script_order)
        elif cand["origin"] == "ci":
            category = inv.classify_ci_command(text)
        if category is None:
            category = self._leaf_category(leaves)
        cand["category"] = category or "other"
        self._verdict(cand, leaves, chain)
        if cand.get("ci_expression") and cand["verdict"] in ("allowed-ci", "allowed-source"):
            cand["verdict"] = "excluded"
            cand["reason"] = "holds a ${{ }} expression: recorded, never matched (GA-06 6.3)"
            cand["review"] = False
            cand["review_files"] = []

    def _leaf_category(self, leaves: Sequence[Dict[str, Any]]) -> Optional[str]:
        kinds = [(l["kind"], l.get("tool"), l.get("sub")) for l in leaves]
        if any(k == "runner" for k, _t, _s in kinds):
            return "test"
        if any(k == "build" for k, _t, _s in kinds):
            return "build"
        if any(k == "static" and t in ("tsc", "vue-tsc", "mypy", "pyright", "basedpyright")
               for k, t, _s in kinds):
            return "typecheck"
        if any(k == "static" and (t == "prettier" or s == "--check") for k, t, s in kinds):
            return "format_check"
        if any(k == "static" for k, _t, _s in kinds):
            return "lint"
        return None

    def _leading_installs(self, text: str, cwd: str
                          ) -> Optional[Tuple[str, List[Dict[str, Any]]]]:
        cmds = split_chain(text)
        k = 0
        installs: List[Dict[str, Any]] = []
        while k < len(cmds):
            _env, _unset, words = take_env(cmds[k].words)
            if not install_leaf_form(words):
                break
            if k > 0 and cmds[k].op != "&&":
                return None
            installs.append({"words": words, "cwd": cwd, "raw": cmds[k].raw})
            k += 1
        if not installs or k >= len(cmds) or cmds[k].op != "&&":
            return None
        rest = cmds[k:]
        parts = [rest[0].raw]
        for c in rest[1:]:
            parts.append(" {} ".format(c.op or ";") + c.raw)
        return "".join(parts), installs

    def _verdict(self, cand: Dict[str, Any], leaves: List[Dict[str, Any]],
                 chain: List[Dict[str, Any]]) -> None:
        strong: List[Dict[str, Any]] = []
        excluded: List[str] = []
        weak: List[Dict[str, Any]] = []
        recorded: List[Dict[str, Any]] = []
        incomplete: List[Dict[str, Any]] = []
        review_files: List[str] = []
        s1_absent: List[str] = []
        unknown: List[str] = []
        truncated = False
        where = (cand["provenance"][0].get("source"), cand["provenance"][0].get("line"))
        for entry in chain:
            hits = t_hits(entry.get("script") or "")
            if hits:
                strong.append(signal("T", entry.get("package"), entry.get("line"),
                                     entry.get("script") or "",
                                     "script name token {}".format(hits[0])))
            elif entry.get("kind") == "script" and inv.SKIP_SCRIPT_NAME_RE.search(
                    (entry.get("script") or "").lower()):
                excluded.append("writes files, runs long or is a lifecycle hook (script name "
                                "{})".format(entry.get("script")))
        leaf_views: List[Dict[str, Any]] = []
        for leaf in leaves:
            kind = leaf["kind"]
            if kind == "noop":
                continue
            ls = self.scan_leaf(leaf)
            strong += argv_signals(leaf, self.live_networks, where)
            strong += ls.strong
            weak += ls.weak
            recorded += ls.recorded
            incomplete += ls.incomplete
            excluded += ls.excluded
            s1_absent += [p for p in ls.s1_absent if p not in s1_absent]
            truncated = truncated or ls.truncated
            review_files += [f for f in ls.review_files if f not in review_files]
            for name, path, line in ls.switches:
                self.switches.setdefault(name, (path, line))
            for name in leaf.get("env") or {}:
                if LIVE_ENV_TOKENS & set(name_tokens(name)):
                    self.switches.setdefault(name, (where[0] or "chain", where[1] or 0))
            if kind in ("unresolved", "unsupported"):
                excluded.append(leaf.get("reason") if kind == "unsupported" else
                                "unresolved: {}".format(leaf.get("reason")))
            elif kind in ("long", "writer", "browser", "scanner"):
                excluded.append(leaf.get("reason") or kind)
            elif kind == "install":
                excluded.append("install mid-chain: {}".format(redact(" ".join(leaf["argv"]), 60)))
            elif kind == "download" and leaf.get("exact"):
                excluded.append("download beyond the lockfile: {}".format(
                    redact(" ".join(leaf["argv"]), 60)))
            elif kind == "unknown":
                unknown.append(leaf.get("tool") or "?")
            if leaf.get("background"):
                excluded.append("long-running (background &)")
            if kind not in ("download", "install", "l1"):
                missing = self.tool_missing(leaf)
                if missing:
                    excluded.append(missing)
            leaf_views.append({"kind": kind, "tool": leaf.get("tool"), "sub": leaf.get("sub"),
                               "file": leaf.get("file"), "cwd": leaf["cwd"],
                               "config": leaf.get("config"),
                               "env_names": sorted(leaf.get("env") or {}),
                               "argv": redact(" ".join(leaf.get("argv") or []), 120),
                               "reason": leaf.get("reason")})
        cand["leaves"] = leaf_views
        cand["signals"] = _dedup_signals(strong + weak + incomplete + recorded)
        cand["dotenv_absent"] = s1_absent
        review = False
        only_installs = any(l["kind"] == "install" for l in leaves) and all(
            l["kind"] in ("install", "noop") for l in leaves)
        if only_installs and not strong:
            cand["verdict"] = "excluded"
            cand["reason"] = "install: the setup and verifier installs run the lockfile install " \
                             "(pilot-auto-calibration A01-F24)"
            cand["review"] = False
            cand["review_files"] = []
            cand["strong_ids"] = []
            cand["role"] = "install"
            cand["covered_by"] = None
            cand["leaves_scan"] = leaves
            return
        if strong:
            first = strong[0]
            cand["verdict"] = "forbidden"
            cand["reason"] = "{} {}{}: {}".format(
                first["id"], first.get("file") or "chain",
                ":{}".format(first["line"]) if first.get("line") else "", first["detail"])
        elif excluded:
            cand["verdict"] = "excluded"
            cand["reason"] = excluded[0]
        elif cand.get("ci_evidence"):
            cand["verdict"] = "allowed-ci"
            cand["reason"] = "CI step {}:{} (job {})".format(
                cand["ci_evidence"]["file"], cand["ci_evidence"]["line"],
                cand["ci_evidence"]["job"])
            review = bool(weak or incomplete or unknown or truncated or
                          any(s["detail"] == "computed env read" for s in recorded))
        elif unknown:
            cand["verdict"] = "excluded"
            cand["reason"] = "unknown tool {}, no CI evidence".format(unknown[0])
        elif truncated:
            cand["verdict"] = "excluded"
            cand["reason"] = "unproven: a scan stopped at its cap; no CI evidence"
        elif weak or incomplete:
            first = (weak + incomplete)[0]
            cand["verdict"] = "excluded"
            cand["reason"] = "unproven: {} at {}:{}; no CI evidence".format(
                first["detail"], first.get("file"), first.get("line") or "-")
        else:
            cand["verdict"] = "allowed-source"
            cand["reason"] = "chain, configs and executed files show no network client"
        cand["review"] = review
        cand["review_files"] = review_files if review else []
        cand["strong_ids"] = sorted({s["id"] for s in strong})
        cand["role"] = "none"
        cand["covered_by"] = None
        cand["leaves_scan"] = leaves

    # -- selection (GA-06 6.7) -----------------------------------------------------------------
    def select(self) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        allowed = [c for c in self.candidates if c["verdict"] in ("allowed-ci", "allowed-source")]
        ordered = [c for c in allowed if c["verdict"] == "allowed-ci"] + \
            [c for c in allowed if c["verdict"] == "allowed-source"]
        covered: Dict[Tuple[str, str, str, str], str] = {}
        gates: List[Dict[str, Any]] = []
        names: Set[str] = set()
        for cand in ordered:
            if not (cand["verdict"] == "allowed-ci" or cand["category"] in (
                    "test", "lint", "typecheck", "build", "format_check")):
                continue
            idents = [leaf_identity(l) for l in cand["leaves_scan"]
                      if l["kind"] in ("static", "build", "runner")]
            fresh = [i for i in idents if i not in covered]
            if not fresh:
                if idents:
                    cand["covered_by"] = covered[idents[0]]
                    cand["reason"] += "; covered by {}".format(covered[idents[0]])
                continue
            gate, problem = self.gate_object(cand, names)
            if gate is None:
                cand["verdict"] = "excluded"
                cand["reason"] = problem or "no gate form"
                continue
            names.add(gate["name"])
            for i in idents:
                covered.setdefault(i, gate["name"])
            cand["role"] = "gate"
            gates.append(gate)
            shuffled = self.shuffled_gate(cand, gate, names)
            if shuffled is not None:
                names.add(shuffled["name"])
                gates.append(shuffled)
        e2e = self.e2e_checks(gates, names)
        return gates, e2e

    def gate_name(self, cand: Dict[str, Any], names: Set[str]) -> str:
        if cand.get("script"):
            base = cand["script"][1]
        else:
            same = [c for c in self.candidates if c.get("role") == "gate" and
                    not c.get("script") and c["category"] == cand["category"]]
            base = "{}-{}".format(cand["category"], len(same) + 1)
        base = NAME_SAFE_RE.sub("-", base.replace(":", "-")).strip("-") or "gate"
        directory = cand["script"][0] if cand.get("script") else cand["cwd"]
        if directory not in (".", ""):
            base = "{}-{}".format(NAME_SAFE_RE.sub("-", posixpath.basename(directory)), base)
        name = base
        n = 2
        while name in names:
            name = "{}-{}".format(base, n)
            n += 1
        return name

    def gate_object(self, cand: Dict[str, Any], names: Set[str]
                    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        text, cwd = cand["gate_text"], cand["gate_cwd"]
        cmd: Any
        shell: Optional[str] = None
        if cand.get("script") and text == cand["text"]:
            pkg = self.disc.packages[cand["script"][0]]
            cmd = self.invocation(pkg, cand["script"][1])
            cwd = pkg.dir
        else:
            cmds = split_chain(text)
            posix = any(c.posix for c in cmds)
            if posix:
                first_word = (take_env(cmds[0].words)[2] or [""])[0] if cmds else ""
                if self.native_windows and first_word in PM_WORDS + ("npx",):
                    return None, "needs a POSIX shell and a package-manager shim"
                cmd, shell = text, "bash"
            elif len(cmds) == 1 and not cmds[0].env and not take_env(cmds[0].words)[0]:
                cmd = list(cmds[0].words)
                if cmd[:2] == ["uv", "run"] and "--frozen" not in cmd and "--locked" not in cmd:
                    cmd = cmd[:2] + ["--frozen"] + cmd[2:]
            else:
                cmd = text
        runners = [l for l in cand["leaves_scan"] if l["kind"] == "runner"]
        gate: Dict[str, Any] = {"name": self.gate_name(cand, names), "cmd": cmd, "cwd": cwd,
                                "timeout_s": 1800 if cand["category"] == "test" else 900}
        if shell:
            gate["shell"] = shell
        if len(runners) == 1:
            regex = self._count_regex(runners[0])
            if regex:
                gate["count_regex"] = regex
        env = self.telemetry_env(cand["leaves_scan"], cand)
        if env:
            gate["env"] = env
        gate["inherit_env"] = False
        gate["env_allowlist"] = []
        cand["gate_name"] = gate["name"]
        return gate, None

    def _count_regex(self, leaf: Dict[str, Any]) -> Optional[str]:
        tool, sub = leaf.get("tool"), leaf.get("sub")
        if tool == "vitest":
            return COUNT_REGEXES["vitest"]
        if tool == "mocha":
            return COUNT_REGEXES["mocha"]
        if tool == "hardhat" and sub == "test":
            return COUNT_REGEXES["hardhat test"]
        if tool in ("pytest",):
            return COUNT_REGEXES["pytest"]
        if tool == "cargo" and sub == "test":
            return COUNT_REGEXES["cargo test"]
        return None

    def telemetry_env(self, leaves: Sequence[Dict[str, Any]], cand: Optional[Dict[str, Any]]
                      ) -> Dict[str, str]:
        env: Dict[str, str] = {}
        berry = any(l.get("pm") == "yarn" for l in leaves) or bool(
            cand and cand.get("script") and self.disc.packages[cand["script"][0]].pm == "yarn")
        if berry:
            pkg = self.disc.packages.get(".")
            if pkg is not None and pkg.flavour == "berry" or any(
                    (self.disc.nearest_package(l["cwd"]) or pkg) is not None and
                    (self.disc.nearest_package(l["cwd"]) or pkg).flavour == "berry"
                    for l in leaves):
                env[TELEMETRY_ENV["yarn"][0]] = TELEMETRY_ENV["yarn"][1]
        if any(l.get("tool") == "next" for l in leaves):
            env[TELEMETRY_ENV["next"][0]] = TELEMETRY_ENV["next"][1]
        return env

    def seed(self) -> int:
        value = int(self.repo.base_sha[:8], 16) % 2147483647 if self.repo.base_sha else 1
        return value or 1

    def shuffled_gate(self, cand: Dict[str, Any], gate: Dict[str, Any], names: Set[str]
                      ) -> Optional[Dict[str, Any]]:
        """A seeded shuffled copy of a single-runner test gate (pilot-auto-calibration A01-F23)."""
        if cand["category"] != "test":
            return None
        runners = [l for l in cand["leaves_scan"] if l["kind"] == "runner"]
        if len(runners) != 1:
            return None
        leaf = runners[0]
        tool = leaf.get("tool")
        seed = self.seed()
        cmd: Optional[List[str]] = None
        if tool in ("vitest", "jest"):
            extra = ["--sequence.shuffle", "--sequence.seed={}".format(seed)] if tool == "vitest" \
                else ["--randomize", "--seed={}".format(seed)]
            args = list(leaf["argv"][1:])
            bin_path = self._runner_bin(tool, leaf["cwd"])
            if bin_path is not None:
                cmd = ["node", bin_path] + args + extra
            else:
                pm = leaf.get("pm") or self.disc.pm_of(leaf["cwd"])[0]
                if pm == "pnpm":
                    cmd = ["pnpm", "exec", tool] + args + extra
                elif pm == "yarn":
                    cmd = ["yarn", tool] + args + extra
                elif pm == "npm":
                    cmd = ["npm", "exec", "--no", "--", tool] + args + extra
                else:
                    self.limits.append("no shuffled gate for {}: the {} bin was not found and "
                                       "{} has no local exec form".format(gate["name"], tool, pm))
                    return None
                self.limits.append("shuffled gate {}-shuffled runs {} through {} (its "
                                   "node_modules/{}/package.json was not found)".format(
                                       gate["name"], tool, cmd[0], tool))
        elif tool == "go" and leaf.get("sub") == "test":
            pkgs = [a for a in leaf["argv"][2:] if not a.startswith("-")] or ["./..."]
            cmd = ["go", "test", "-count=1", "-shuffle={}".format(seed)] + pkgs
        if cmd is None:
            return None
        name = gate["name"] + "-shuffled"
        while name in names:
            name += "-2"
        env = dict(leaf.get("env") or {})
        env.update(self.telemetry_env([leaf], None))
        shuffled: Dict[str, Any] = {"name": name, "cmd": cmd, "cwd": leaf["cwd"],
                                    "timeout_s": gate["timeout_s"]}
        if "count_regex" in gate:
            shuffled["count_regex"] = gate["count_regex"]
        if env:
            shuffled["env"] = env
        shuffled["inherit_env"] = False
        shuffled["env_allowlist"] = []
        shuffled["_seed"] = seed
        shuffled["_of"] = gate["name"]
        return shuffled

    def _runner_bin(self, tool: str, cwd: str) -> Optional[str]:
        d = cwd
        while True:
            manifest = rel_join(d, "node_modules/{}/package.json".format(tool))
            full = self.repo.abs(manifest)
            if os.path.isfile(str(full)):
                try:
                    data = C.read_json(full)
                except (OSError, ValueError):
                    data = None
                bins = data.get("bin") if isinstance(data, dict) else None
                target = bins if isinstance(bins, str) else (
                    bins.get(tool) if isinstance(bins, dict) else None)
                if isinstance(target, str):
                    path = rel_join(rel_dir(manifest), target)
                    return posixpath.relpath(path, cwd) if cwd != "." else path
                return None
            if d == ".":
                return None
            d = rel_dir(d)

    # -- e2e (GA-06 6.7) -----------------------------------------------------------------------
    def e2e_checks(self, gates: List[Dict[str, Any]], names: Set[str]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        built = self._built_outputs(gates)
        for pkg in sorted(self.disc.packages.values(), key=lambda p: p.path):
            for bin_name, bin_path in sorted(pkg.bins.items()):
                target = rel_join(pkg.dir, bin_path)
                source = target if target in self.repo.tracked_set else built.get(target)
                if source is None:
                    continue
                problem = self._module_scope_problem(source, pkg.dir)
                if problem:
                    self.limits.append("e2e {} not added: {}".format(bin_name, problem))
                    continue
                name = NAME_SAFE_RE.sub("-", "{}-help".format(bin_name))
                while name in names:
                    name += "-2"
                names.add(name)
                out.append({"name": name, "cmd": ["node", posixpath.relpath(target, pkg.dir)
                                                  if pkg.dir != "." else target, "--help"],
                            "cwd": pkg.dir, "timeout_s": 60, "compare": True,
                            "inherit_env": False, "env_allowlist": [],
                            "_source": source, "_entry": bin_name, "_bin": True,
                            "_pkg": pkg.dir, "_target": target,
                            "_build_gate": self.built_gates.get(target)})
        for cand in self.candidates:
            if not cand.get("script") or cand["verdict"] != "allowed-source":
                continue
            sname = cand["script"][1]
            if not re.search(r"^(smoke|boot|probe)(:|$)|(^|:)(smoke|boot-check)$", sname):
                continue
            if any(l["kind"] in ("browser", "long") for l in cand["leaves_scan"]):
                continue
            browser = self._browser_package(cand)
            if browser:
                self.limits.append("e2e {} not added: its files import {} (A01-F57)".format(
                    sname, browser))
                continue
            name = NAME_SAFE_RE.sub("-", sname.replace(":", "-"))
            while name in names:
                name += "-2"
            names.add(name)
            pkg = self.disc.packages[cand["script"][0]]
            cand["role"] = "e2e"
            out.append({"name": name, "cmd": self.invocation(pkg, sname), "cwd": pkg.dir,
                        "timeout_s": 300, "compare": False, "inherit_env": False,
                        "env_allowlist": [], "_entry": sname,
                        "_source": pkg.path})
        probed_dirs = {e["cwd"] for e in out if not e.get("_bin")}
        for pkg in sorted(self.disc.packages.values(), key=lambda p: p.path):
            if "next" in pkg.deps and pkg.dir not in probed_dirs:
                self.limits.append("web app {}: no offline route-probe script; its end-to-end "
                                   "checks are the gates (next build is a build gate) "
                                   "(A01-F57)".format(pkg.dir))
        return out

    def _browser_package(self, cand: Dict[str, Any]) -> Optional[str]:
        """A browser-automation package any file leaf's import graph imports, or None
        ("Each version of Playwright needs specific versions of browser binaries")."""
        roots = [l["file"] for l in cand["leaves_scan"] if l["kind"] == "file" and l.get("file")]
        if not roots:
            return None
        graph, _notes, _truncated = self.scanner.graph(roots)
        for path in graph:
            code = self.repo.code(path)
            if code is None or language_kind(path) != "js":
                continue
            for rx in IMPORT_RES:
                for m in rx.finditer(code.clean):
                    spec = m.group(1)
                    if code.is_code(m.start()) and _package_name(spec) in BROWSER_PACKAGES:
                        return _package_name(spec)
        return None

    def _built_outputs(self, gates: Sequence[Dict[str, Any]]) -> Dict[str, str]:
        """{built file: tracked source} for the outputs of selected `tsc -p <tsconfig>` builds;
        self.built_gates maps each built file to the gate that builds it."""
        out: Dict[str, str] = {}
        for cand in self.candidates:
            if cand.get("role") != "gate":
                continue
            for leaf in cand["leaves_scan"]:
                if leaf.get("tool") != "tsc" or leaf["kind"] != "static":
                    continue
                project = _flag_value(leaf["argv"][1:], ("-p", "--project"))
                if not project:
                    continue
                cfg = rel_join(leaf["cwd"], project)
                if not cfg.endswith(".json"):
                    cfg = rel_join(cfg, "tsconfig.json")
                opts = self._tsconfig_options(cfg, 0)
                out_dir, root_dir = opts.get("outDir"), opts.get("rootDir")
                if not isinstance(out_dir, str) or not isinstance(root_dir, str):
                    continue
                base = rel_dir(cfg)
                out_rel, root_rel = rel_join(base, out_dir), rel_join(base, root_dir)
                for src in self.repo.files_under(root_rel):
                    stem, ext = os.path.splitext(src[len(root_rel) + 1:] if root_rel != "." else
                                                 src)
                    mapping = {".ts": ".js", ".mts": ".mjs", ".cts": ".cjs", ".tsx": ".js"}
                    if ext in mapping and not src.endswith(".d.ts"):
                        out[rel_join(out_rel, stem + mapping[ext])] = src
                        self.built_gates[rel_join(out_rel, stem + mapping[ext])] = \
                            cand.get("gate_name")
        return out

    def _tsconfig_options(self, path: str, depth: int) -> Dict[str, Any]:
        text = self.repo.read(path)
        if text is None or depth > 5:
            return {}
        try:
            data = load_jsonc(text)
        except ValueError:
            return {}
        if not isinstance(data, dict):
            return {}
        opts: Dict[str, Any] = {}
        ext = data.get("extends")
        if isinstance(ext, str) and ext.startswith("."):
            parent = rel_join(rel_dir(path), ext if ext.endswith(".json") else ext + ".json")
            inherited = self._tsconfig_options(parent, depth + 1)
            for key in ("outDir", "rootDir"):
                if isinstance(inherited.get(key), str):
                    opts[key] = posixpath.relpath(rel_join(rel_dir(parent), inherited[key]),
                                                  rel_dir(path))
        own = data.get("compilerOptions") if isinstance(data.get("compilerOptions"), dict) else {}
        opts.update({k: v for k, v in own.items() if k in ("outDir", "rootDir")})
        return opts

    def _module_scope_problem(self, source: str, cwd: str) -> Optional[str]:
        """Why an entry's module-scope graph disqualifies it as an e2e check (N2, L6, S1 or S3
        at module scope), or None."""
        graph, _notes, truncated = self.scanner.graph([source])
        if truncated:
            return "the entry's import graph passed its cap"
        for path in graph:
            if SECRET_FILE_RE.match(posixpath.basename(path)):
                return "imports a secret-named file {}".format(path)
            code = self.repo.code(path)
            if code is None:
                continue
            kind = language_kind(path)
            top = _top_level(code, kind)
            checks: List[Tuple[str, "re.Pattern[str]"]] = [
                ("N2", rx) for rx in N2_RES.get(kind, N2_RES["js"])]
            checks.append(("L6", L6_RE))
            checks += [("S1", rx) for rx in (S1_PY_RES if kind == "py" else S1_JS_RES)]
            for sid, rx in checks:
                for m in rx.finditer(code.clean):
                    if code.is_code(m.start()) and top(m.start()):
                        return "{} at module scope in {}:{}".format(sid, path,
                                                                     code.line_of(m.start()))
            for m in S3_RE.finditer(code.clean):
                if SECRET_FILE_RE.match(posixpath.basename(C.to_posix(m.group(2)))) and \
                        top(m.start()):
                    return "S3 at module scope in {}:{}".format(path, code.line_of(m.start()))
        return None


def _top_level(code: Code, kind: str) -> Any:
    """A predicate: is this offset at module scope (brace depth 0 in JS/TS code, no
    indentation in Python)?"""
    text = code.clean
    if kind == "py":
        def py(pos: int) -> bool:
            start = text.rfind("\n", 0, pos) + 1
            return not text[start:start + 1] in (" ", "\t")
        return py
    depths: List[int] = []
    depth = 0
    for i, ch in enumerate(text):
        depths.append(depth)
        if code.is_code(i):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth = max(0, depth - 1)
    return lambda pos: 0 <= pos < len(depths) and depths[pos] == 0


# ---------------------------------------------------------------------------
# Offline e2e subcommands (pilot-auto-calibration A01-F57)
# ---------------------------------------------------------------------------

JS_KEYWORDS = frozenset(
    "break case catch class const continue debugger default delete do else export extends "
    "finally for function if import in instanceof let new return super switch this throw try "
    "typeof var void while with yield async await of static get set true false null undefined "
    "arguments from as".split())
CONTROL_WORDS = frozenset(["if", "for", "while", "switch", "catch", "with"])
IDENT_TOKEN_RE = re.compile(r"(?<![\w$])[A-Za-z_$][\w$]*")
DECL_FUNC_RE = re.compile(r"(?:\bexport\s+(?:default\s+)?)?(?:\basync\s+)?\bfunction\b\s*\*?\s*"
                          r"([A-Za-z_$][\w$]*)\s*\(")
DECL_CLASS_RE = re.compile(r"(?:\bexport\s+(?:default\s+)?)?\bclass\s+([A-Za-z_$][\w$]*)")
DECL_VAR_RE = re.compile(r"(?:\bexport\s+)?\b(?:const|let|var)\s+")
IMPORT_FROM_RE = re.compile(r"\bimport\s+(?:type\s+)?([^;'\"]*?)\s*\bfrom\s*([\"'])([^\"']+)\2"
                            r"|\bimport\s*([\"'])([^\"']+)\4")
EXPORT_FROM_RE = re.compile(r"\bexport\s+(?:type\s+)?(\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})"
                            r"\s*from\s*([\"'])([^\"']+)\2")
EXPORT_LIST_RE = re.compile(r"\bexport\s*\{([^}]*)\}(?!\s*from)")
EXPORT_DEFAULT_RE = re.compile(r"\bexport\s+default\s+(?!function\b|class\b|async\s+function\b)")
REQUIRE_DECL_RE = re.compile(r"\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*"
                             r"require\s*\(\s*([\"'])([^\"']+)\2\s*\)")
LITERAL_LOAD_RE = re.compile(r"\b(?:import|require)\s*\(\s*([\"'])([^\"'\n]+)\1\s*\)")
TERMINATES_RE = re.compile(r"^(?:return|throw)\b|^process\s*\.\s*exit\s*\(")
CONTINUATION_START = (".", "?", ":", "+", "-", "*", "/", "&", "|", ",", ")")
HELP_HEADING_RE = re.compile(r"(?i)^\s*(?:available\s+|sub)?commands?\s*:?\s*$")
HELP_ENTRY_RE = re.compile(
    r"^\s{1,8}(?:(?P<prog>\S+)\s+)?(?P<name>[a-z][a-z0-9:_-]{0,39})(?:[|,]\s*[a-z][\w:-]*)*"
    r"(?:\s+(?:\[[^\]]*\]|<[^>]*>))*(?:\s{2,}\S.*)?$")
HELP_ENTRY_NO_PROG_RE = re.compile(
    r"^\s{1,8}(?P<name>[a-z][a-z0-9:_-]{0,39})(?:[|,]\s*[a-z][\w:-]*)*"
    r"(?:\s+(?:\[[^\]]*\]|<[^>]*>))*(?:\s{2,}\S.*)?$")
HELP_VERSION_RE = re.compile(r"(?:^|[\s,])--version\b")
NODE_VERSION_RE = re.compile(r"v?(\d+)\.(\d+)\.(\d+)")


def _package_name(spec: str) -> str:
    """The package a bare import specifier names (a `node:` prefix dropped)."""
    text = spec[5:] if spec.startswith("node:") else spec
    parts = text.split("/")
    return "/".join(parts[:2]) if text.startswith("@") and len(parts) > 1 else parts[0]


def package_signal(spec: str) -> Optional[str]:
    """Why reaching an import of this package excludes a subcommand, or None."""
    name = _package_name(spec)
    if spec in STATE_MODULES or name in STATE_MODULES:
        return "local state module {}".format(spec)
    if name in NETWORK_MODULES or name.startswith(("@aws-sdk/", "@google-cloud/")):
        return "N2-package {}".format(spec)
    if name in CHILD_MODULES:
        return "child process or worker module {}".format(spec)
    return None


def parse_help(text: str, prog_names: Sequence[str]) -> Dict[str, Any]:
    """The commands a --help text lists under a Commands heading, and whether it offers
    --version. Help text is data: a name that fails SUBCOMMAND_RE is never returned."""
    clean = G.ANSI_RE.sub("", text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = clean.split("\n")
    commands: List[Dict[str, Any]] = []
    version_line: Optional[int] = None
    progs = {p for p in prog_names if p}
    in_block = False
    blank = False
    for number, line in enumerate(lines, start=1):
        if version_line is None and HELP_VERSION_RE.search(line):
            version_line = number
        if HELP_HEADING_RE.match(line):
            in_block, blank = True, False
            continue
        if not in_block:
            continue
        if not line.strip():
            blank = True
            continue
        if (blank and not line[:1].isspace()) or re.match(r"^\S.*:\s*$", line):
            in_block = False
            continue
        blank = False
        plain = HELP_ENTRY_NO_PROG_RE.match(line)
        m = plain or HELP_ENTRY_RE.match(line)
        if not m:
            continue
        prog = None if plain else m.group("prog")
        name = m.group("name")
        if prog is not None and not (prog in progs or prog == "$0" or
                                     re.search(r"\.(?:js|mjs|cjs|ts)$", prog)):
            continue
        if SUBCOMMAND_RE.match(name) and name not in [c["name"] for c in commands]:
            commands.append({"name": name, "line": number})
    return {"commands": commands, "version_flag": version_line is not None,
            "version_line": version_line}


def permission_flags(version_text: str) -> List[str]:
    """Node's permission model flags where the model is stable (v22.13.0 and v23.5.0 on),
    else none; an unparsable version gets none."""
    m = NODE_VERSION_RE.search(version_text or "")
    if not m:
        return []
    major, minor, _patch = (int(g) for g in m.groups())
    if (major, minor) < (22, 13) or (major == 23 and minor < 5):
        return []
    return ["--permission", "--allow-fs-read=*"]


class JsFile:
    """A JavaScript file: comment-free text, matched brackets, top-level declarations, imports
    and exports (read by SubcommandClosure; pilot-auto-calibration A01-F57)."""

    def __init__(self, path: str, text: str) -> None:
        self.path = path
        self.code = Code(text, "js")
        self.clean = self.code.clean
        n = len(self.clean)
        self.match: Dict[int, int] = {}
        self.rmatch: Dict[int, int] = {}
        self.depth = [0] * (n + 1)
        stack: List[int] = []
        for i, ch in enumerate(self.clean):
            self.depth[i] = len(stack)
            if not self.code.is_code(i):
                continue
            if ch in "({[":
                stack.append(i)
            elif ch in ")}]" and stack:
                opened = stack.pop()
                self.match[opened] = i
                self.rmatch[i] = opened
                self.depth[i] = len(stack)
        self.depth[n] = len(stack)
        self.decls: Dict[str, Tuple[int, int, str]] = {}
        self.bodies: List[Tuple[int, int]] = []
        self.name_pos: Set[int] = set()
        self.exported: Dict[str, str] = {}
        self.imports: Dict[str, Tuple[str, str]] = {}
        self.import_spans: List[Tuple[int, int]] = []
        self.reexports: List[Tuple[str, Dict[str, str]]] = []
        self._parse()

    # -- helpers -------------------------------------------------------------------------------
    def top(self, pos: int) -> bool:
        return 0 <= pos < len(self.depth) and self.depth[pos] == 0

    def prev_code(self, pos: int) -> int:
        k = pos - 1
        while k >= 0 and self.clean[k].isspace():
            k -= 1
        return k

    def next_code(self, pos: int) -> int:
        k = pos
        n = len(self.clean)
        while k < n and self.clean[k].isspace():
            k += 1
        return k

    def word_before(self, pos: int) -> str:
        k = self.prev_code(pos)
        end = k + 1
        while k >= 0 and (self.clean[k].isalnum() or self.clean[k] in "_$"):
            k -= 1
        return self.clean[k + 1:end]

    def statement_end(self, start: int, level: int) -> int:
        """End (exclusive) of the statement starting at `start` at bracket depth `level`: its
        `;`, or a newline after which no continuation follows, or the closing bracket."""
        n = len(self.clean)
        i = self.next_code(start)
        while i < n:
            if self.code.is_code(i):
                if self.depth[i] < level:
                    return i
                ch = self.clean[i]
                if self.depth[i] == level:
                    if ch == ";":
                        return i + 1
                    if ch == "\n":
                        after = self.next_code(i + 1)
                        before = self.prev_code(i)
                        last = self.clean[before] if before >= 0 else ""
                        if after < n and not self.clean.startswith(CONTINUATION_START, after) \
                                and last not in ("=", "(", ",", "{", "[", ":", "?", "+", "-",
                                                 "*", "&", "|"):
                            return i
                if ch in ")}]" and self.depth[i] < level:
                    return i
            i += 1
        return n

    # -- parsing -------------------------------------------------------------------------------
    def _parse(self) -> None:
        clean = self.clean
        for m in IMPORT_FROM_RE.finditer(clean):
            if not self.code.is_code(m.start()) or not self.top(m.start()):
                continue
            end = m.end()
            k = self.next_code(end)
            if k < len(clean) and clean[k] == ";":
                end = k + 1
            self.import_spans.append((m.start(), end))
            if m.group(3) is None:
                continue
            spec = m.group(3)
            clause = m.group(1).strip()
            self._bind_clause(clause, spec)
        for m in REQUIRE_DECL_RE.finditer(clean):
            if not self.code.is_code(m.start()):
                continue
            self.import_spans.append((m.start(), m.end()))
            target, spec = m.group(1), m.group(3)
            if target.startswith("{"):
                for part in target.strip("{} ").split(","):
                    part = part.strip()
                    if not part:
                        continue
                    name, _sep, alias = part.partition(":")
                    self.imports[(alias or name).strip()] = (spec, name.strip())
            else:
                self.imports[target] = (spec, "default")
        for m in EXPORT_FROM_RE.finditer(clean):
            if not self.code.is_code(m.start()):
                continue
            self.import_spans.append((m.start(), m.end()))
            head, spec = m.group(1), m.group(3)
            mapping: Dict[str, str] = {}
            if head.startswith("*"):
                alias = re.match(r"\*\s+as\s+([A-Za-z_$][\w$]*)", head)
                if alias:
                    mapping[alias.group(1)] = "*"
                else:
                    mapping["*"] = "*"
            else:
                for part in head.strip("{} ").split(","):
                    part = part.strip()
                    if not part:
                        continue
                    name, _as, alias = [p.strip() for p in re.split(r"\s+(as)\s+", part)] \
                        if re.search(r"\s+as\s+", part) else (part, "", part)
                    mapping[alias] = name
            self.reexports.append((spec, mapping))
        for rx, kind in ((DECL_FUNC_RE, "function"), (DECL_CLASS_RE, "class")):
            for m in rx.finditer(clean):
                if not self.code.is_code(m.start()) or not self.top(m.start()):
                    continue
                name = m.group(1)
                body = self._body_after(m.end() - 1 if kind == "function" else m.end(), kind)
                if body is None:
                    continue
                self.decls[name] = (m.start(), body[1] + 1, kind)
                self.name_pos.add(m.start(1))
                # A function declaration runs nothing where it stands; a class declaration
                # evaluates its heritage clause, so only its body is left out.
                self.bodies.append((m.start(), body[1] + 1) if kind == "function" else
                                   (body[0] + 1, body[1]))
                if clean[m.start():m.start() + 6] == "export":
                    self.exported[name] = name
                    if re.match(r"export\s+default\b", clean[m.start():m.start() + 20]):
                        self.exported["default"] = name
        for m in DECL_VAR_RE.finditer(clean):
            if not self.code.is_code(m.start()) or not self.top(m.start()):
                continue
            if any(a <= m.start() < b for a, b in self.import_spans):
                continue
            end = self.statement_end(m.end(), 0)
            names: List[str] = []
            k = self.next_code(m.end())
            if k < len(clean) and clean[k] in "{[" and k in self.match:
                names = [t for t in IDENT_TOKEN_RE.findall(clean[k:self.match[k] + 1])
                         if t not in JS_KEYWORDS]
            else:
                first = IDENT_TOKEN_RE.match(clean, k)
                if first:
                    names.append(first.group(0))
                    self.name_pos.add(first.start())
            for name in names:
                self.decls.setdefault(name, (m.start(), end, "var"))
                if clean[m.start():m.start() + 6] == "export":
                    self.exported[name] = name
        for m in EXPORT_LIST_RE.finditer(clean):
            if not self.code.is_code(m.start()):
                continue
            for part in m.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                pieces = re.split(r"\s+as\s+", part)
                self.exported[pieces[-1].strip()] = pieces[0].strip()
        for m in EXPORT_DEFAULT_RE.finditer(clean):
            if not self.code.is_code(m.start()) or not self.top(m.start()):
                continue
            end = self.statement_end(m.end(), 0)
            self.decls.setdefault("__default__", (m.start(), end, "default"))
            self.exported.setdefault("default", "__default__")

    def _bind_clause(self, clause: str, spec: str) -> None:
        clause = clause.strip()
        if not clause:
            return
        named = re.search(r"\{([^}]*)\}", clause)
        if named:
            for part in named.group(1).split(","):
                part = part.strip()
                if not part or part.startswith("type "):
                    continue
                pieces = re.split(r"\s+as\s+", part)
                self.imports[pieces[-1].strip()] = (spec, pieces[0].strip())
            clause = (clause[:named.start()] + clause[named.end():]).strip(" ,")
        star = re.search(r"\*\s+as\s+([A-Za-z_$][\w$]*)", clause)
        if star:
            self.imports[star.group(1)] = (spec, "*")
            clause = (clause[:star.start()] + clause[star.end():]).strip(" ,")
        default = clause.strip(" ,")
        if default and re.match(r"^[A-Za-z_$][\w$]*$", default):
            self.imports[default] = (spec, "default")

    def _body_after(self, pos: int, kind: str) -> Optional[Tuple[int, int]]:
        clean = self.clean
        n = len(clean)
        i = pos
        if kind == "function":
            if i >= n or clean[i] != "(" or i not in self.match:
                return None
            i = self.match[i] + 1
        while i < n:
            if self.code.is_code(i) and clean[i] == "{" and i in self.match:
                close = self.match[i]
                k = self.next_code(close + 1)
                if kind == "function" and k < n and clean[k] == "{" and k in self.match:
                    return k, self.match[k]
                return i, close
            if self.code.is_code(i) and clean[i] in ";" and kind == "function":
                return None
            i += 1
        return None

    def module_scope(self) -> List[Tuple[int, int]]:
        """The module scope: the file without function declarations, class declaration
        bodies and import statements (function and arrow expressions stay: they may run at
        load)."""
        cuts = sorted(self.bodies + self.import_spans)
        return _subtract([(0, len(self.clean))], cuts)

    def enclosing_function(self, pos: int) -> Optional[Tuple[int, int, int]]:
        """(declaration start, body open, body close) of the innermost function whose body
        encloses `pos`: a block preceded by a parameter list or `=>`; None at module scope."""
        k = pos
        while True:
            opened = self._enclosing_open(k, "{")
            if opened is None:
                return None
            before = self.prev_code(opened)
            if before >= 1 and self.clean[before - 1:before + 1] == "=>":
                return self._decl_start(opened), opened, self.match.get(opened, len(self.clean))
            if before >= 0 and self.clean[before] == ")" and before in self.rmatch:
                word = self.word_before(self.rmatch[before])
                if word not in CONTROL_WORDS:
                    return self._decl_start(opened), opened, self.match.get(opened,
                                                                           len(self.clean))
            k = opened

    def _decl_start(self, opened: int) -> int:
        for start, end, _kind in self.decls.values():
            if start <= opened < end:
                return start
        return opened

    def _enclosing_open(self, pos: int, kind: Optional[str] = None) -> Optional[int]:
        depth = 0
        k = pos - 1
        while k >= 0:
            if self.code.is_code(k):
                ch = self.clean[k]
                if ch in ")}]":
                    depth += 1
                elif ch in "({[":
                    if depth == 0:
                        if kind is None or ch == kind:
                            return k
                        return self._enclosing_open(k, kind)
                    depth -= 1
            k -= 1
        return None

    def line_of(self, pos: int) -> int:
        return self.code.line_of(pos)


def _subtract(segments: Sequence[Tuple[int, int]], cuts: Sequence[Tuple[int, int]]
              ) -> List[Tuple[int, int]]:
    out: List[Tuple[int, int]] = []
    for start, end in segments:
        pieces = [(start, end)]
        for c_start, c_end in cuts:
            nxt: List[Tuple[int, int]] = []
            for a, b in pieces:
                if c_end <= a or c_start >= b:
                    nxt.append((a, b))
                    continue
                if a < c_start:
                    nxt.append((a, c_start))
                if c_end < b:
                    nxt.append((c_end, b))
            pieces = nxt
        out.extend(p for p in pieces if p[1] > p[0])
    return out


def find_sites(js: JsFile) -> List[Dict[str, Any]]:
    """Dispatch sites of subcommand names: `case '<name>':` (K1), an `===`/`==` operand in an
    if condition (K2), the first argument of `.command(` (K3); an operand of `!==`/`!=` in an if
    condition is recorded as "unsupported". Array elements, object keys and messages are not
    sites."""
    clean, kinds = js.clean, js.code.kinds
    n = len(clean)
    sites: List[Dict[str, Any]] = []
    i = 0
    while i < n:
        if not (kinds[i] == ord("s") and clean[i] in "'\"`" and (i == 0 or
                                                                 kinds[i - 1] != ord("s"))):
            i += 1
            continue
        j = i
        while j < n and kinds[j] == ord("s"):
            j += 1
        literal = clean[i:j]
        start, end = i, j
        i = j
        if len(literal) < 2 or literal[-1] != literal[0] or "${" in literal:
            continue
        inner = literal[1:-1]
        prev = js.prev_code(start)
        nxt = js.next_code(end)
        before = clean[max(0, prev - 2):prev + 1]
        after = clean[nxt:nxt + 3]
        site: Optional[Dict[str, Any]] = None
        if js.word_before(start) == "case" and nxt < n and clean[nxt] == ":":
            site = {"kind": "K1", "name": inner}
        elif before.endswith("==") or after.startswith("=="):
            negated = before.endswith("!==") or before[-2:] == "!=" or after.startswith("!=")
            opened = js._enclosing_open(start, "(")
            if opened is not None and js.word_before(opened) == "if":
                site = {"kind": "unsupported" if negated else "K2", "name": inner,
                        "cond": (opened, js.match.get(opened, n))}
        elif after.startswith("!="):
            opened = js._enclosing_open(start, "(")
            if opened is not None and js.word_before(opened) == "if":
                site = {"kind": "unsupported", "name": inner}
        elif prev >= 0 and clean[prev] == "(" and js.word_before(prev) == "command" and \
                js.prev_code(js.prev_code(prev) - len("command") + 1) >= 0 and \
                clean[js.prev_code(js.prev_code(prev) - len("command") + 1)] == ".":
            site = {"kind": "K3", "name": inner.split()[0] if inner.split() else "",
                    "paren": prev}
        if site is None:
            continue
        name = site["name"]
        if not (SUBCOMMAND_RE.match(name) or (name == "--version" and site["kind"] in
                                              ("K1", "K2", "unsupported"))):
            continue
        site.update(pos=start, end=end, line=js.line_of(start))
        _site_region(js, site)
        sites.append(site)
    return sites


def _site_region(js: JsFile, site: Dict[str, Any]) -> None:
    """The code a site runs: its region, and whether the region ends in return, throw or
    process.exit (`terminates`)."""
    clean = js.clean
    n = len(clean)
    region: Tuple[int, int] = (site["end"], site["end"])
    if site["kind"] == "K1":
        colon = js.next_code(site["end"])
        level = js.depth[site["pos"]]
        k = colon + 1
        stop = n
        while k < n:
            if js.code.is_code(k):
                if js.depth[k] < level:
                    stop = k
                    break
                if js.depth[k] == level and re.match(r"\b(?:case|default)\b", clean[k:k + 7]) \
                        and (k == 0 or not (clean[k - 1].isalnum() or clean[k - 1] in "_$")):
                    stop = k
                    break
            k += 1
        region = (colon + 1, stop)
    elif site["kind"] in ("K2", "unsupported") and site.get("cond"):
        close = site["cond"][1]
        k = js.next_code(close + 1)
        if k < n and clean[k] == "{" and k in js.match:
            region = (k, js.match[k] + 1)
        else:
            region = (close + 1, js.statement_end(close + 1, js.depth[close + 1]
                                                  if close + 1 < n else 0))
    elif site["kind"] == "K3":
        level = js.depth[site["paren"]]
        region = (site["pos"], js.statement_end(site["pos"], level))
    site["region"] = region
    site["terminates"] = _terminates(js, region)


def _terminates(js: JsFile, region: Tuple[int, int]) -> bool:
    start, end = region
    text = js.clean[start:end].strip()
    if text.startswith("{") and text.endswith("}"):
        start = js.clean.index("{", start) + 1
        end = js.clean.rindex("}", start - 1, end)
        text = js.clean[start:end]
    level = js.depth[start] if start < len(js.depth) else 0
    statements: List[str] = []
    current: List[str] = []
    for k in range(start, min(end, len(js.clean))):
        ch = js.clean[k]
        current.append(ch)
        if js.code.is_code(k) and js.depth[k] == level and ch in ";}":
            statements.append("".join(current).strip())
            current = []
    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    statements = [s.strip("; \n\t") for s in statements if s.strip("; \n\t")]
    if not statements:
        return False
    return bool(TERMINATES_RE.match(statements[-1]))


class SubcommandClosure:
    """The reference closure of a subcommand's dispatch branch in built JavaScript
    (pilot-auto-calibration A01-F57). A name is `clear` only when the code its branch reaches
    names no network client or package, local database or per-user state, dotenv or
    secret-file read, credential-named variable, child process, worker, native addon or file
    write. It reads JavaScript text, not a type-checked call graph: a call through an
    interface or a computed name is not followed, and the guarded runs cover that."""

    def __init__(self, root: Path, pkg_dir: str) -> None:
        self.root = Path(root)
        self.pkg_dir = pkg_dir if pkg_dir not in ("", ".") else "."
        self.files: Dict[str, Any] = {}

    def read(self, rel: str) -> Tuple[Optional[JsFile], Optional[str]]:
        """A file of the package (repo-relative), or (None, why it may not be read)."""
        if rel in self.files:
            value = self.files[rel]
            return (value, None) if isinstance(value, JsFile) else (None, value)
        why: Optional[str] = None
        full = self.root / rel
        segs = rel.split("/")
        if not under(rel, self.pkg_dir):
            why = "outside the package"
        elif "node_modules" in segs:
            why = "under node_modules"
        elif SECRET_FILE_RE.match(posixpath.basename(rel)):
            why = "secret-named file"
        else:
            try:
                real = os.path.realpath(str(full))
                root = os.path.realpath(str(self.root))
                if os.path.commonpath([os.path.normcase(real), os.path.normcase(root)]) != \
                        os.path.normcase(root):
                    why = "a link that leaves the repository"
                elif not os.path.isfile(real):
                    why = "missing"
                elif os.path.getsize(real) > MAX_FILE_BYTES:
                    why = "over 1 MiB"
            except (OSError, ValueError):
                why = "cannot be read"
        if why is None:
            try:
                data = full.read_bytes()
                text = data.decode("utf-8", errors="replace").lstrip(chr(0xFEFF))
                text = text.replace("\r\n", "\n").replace("\r", "\n")
                self.files[rel] = JsFile(rel, text)
                return self.files[rel], None
            except OSError as exc:
                why = "cannot be read: {}".format(exc.__class__.__name__)
        self.files[rel] = why
        return None, why

    def resolve(self, from_rel: str, spec: str) -> Optional[str]:
        base = rel_join(rel_dir(from_rel), C.to_posix(spec).split("?")[0])
        for cand in (base, base + ".js", base + ".mjs", base + ".cjs", rel_join(base, "index.js")):
            if under(cand, self.pkg_dir) and os.path.isfile(str(self.root / cand)):
                return cand
        return None

    def find_export(self, rel: str, name: str, hops: int = 0
                    ) -> Optional[Tuple[str, Optional[Tuple[int, int, str]]]]:
        """(file, declaration) exporting `name`, following re-exports up to 5 hops; the
        declaration is None when the file can only be taken whole."""
        js, _why = self.read(rel)
        if js is None or hops > 5:
            return None
        local = js.exported.get(name)
        if local is not None and local in js.decls:
            return rel, js.decls[local]
        if local is not None and local in js.imports:
            spec, imported = js.imports[local]
            if spec.startswith("."):
                target = self.resolve(rel, spec)
                if target is not None:
                    return self.find_export(target, imported, hops + 1)
            return None
        for spec, mapping in js.reexports:
            if not spec.startswith("."):
                continue
            target = self.resolve(rel, spec)
            if target is None:
                continue
            if name in mapping and mapping[name] != "*":
                return self.find_export(target, mapping[name], hops + 1)
            if "*" in mapping:
                found = self.find_export(target, name, hops + 1)
                if found is not None:
                    return found
        if name in js.decls:
            return rel, js.decls[name]
        return (rel, None) if js.exported or js.reexports else None

    def classify(self, entry_rel: str, name: str) -> Dict[str, Any]:
        result: Dict[str, Any] = {"verdict": "excluded", "reason": "", "evidence": None,
                                  "path": [], "bodies": 0, "files": [], "incomplete": [],
                                  "unresolved_member_calls": 0, "unresolved_packages": []}
        if name == "--version":
            result.update(verdict="clear", reason="cleared like --help (module-scope check) "
                                                  "plus the guarded runs; no dispatch closure")
            return result
        js, why = self.read(entry_rel)
        if js is None:
            result["reason"] = "excluded: cannot read {} ({})".format(entry_rel, why)
            return result
        sites = [s for s in find_sites(js) if s["name"] == name]
        if not sites:
            result["reason"] = "excluded: no dispatch site for \"{}\" in {}".format(name,
                                                                                    entry_rel)
            return result
        usable = [s for s in sites if s["kind"] != "unsupported"]
        if not usable:
            result["reason"] = "excluded: unsupported dispatch form"
            return result
        merged: Dict[str, Any] = {}
        for site in usable:
            one = self._classify_site(js, entry_rel, site, name)
            if one["verdict"] != "clear":
                return one
            merged = one if not merged else dict(merged, bodies=merged["bodies"] + one["bodies"],
                                                 incomplete=(merged["incomplete"] +
                                                             one["incomplete"])[:10])
        return merged

    def _classify_site(self, js: JsFile, entry_rel: str, site: Dict[str, Any], name: str
                       ) -> Dict[str, Any]:
        result: Dict[str, Any] = {"verdict": "clear", "reason": "", "evidence": None,
                                  "path": [], "bodies": 0, "files": [], "incomplete": [],
                                  "unresolved_member_calls": 0, "unresolved_packages": []}
        excluded: Dict[str, List[Tuple[int, int]]] = {entry_rel: self._pruned_away(js, site)}
        roots: List[Tuple[str, List[Tuple[int, int]], List[str]]] = []
        roots.append((entry_rel, js.module_scope(), ["module scope of " + entry_rel]))
        if site["kind"] in ("K1", "K2"):
            func = js.enclosing_function(site["pos"])
            if func is not None:
                roots.append((entry_rel, [(func[0], func[2] + 1)],
                              ["branch {} of {}".format(name, entry_rel)]))
            else:
                roots.append((entry_rel, [(0, len(js.clean))],
                              ["branch {} at module scope".format(name)]))
        else:
            roots.append((entry_rel, [site["region"]], ["command {}".format(name)]))
        # Every local module the entry loads statically runs its module scope: each is
        # scanned for the signals (a reference there, such as a factory handed to a
        # registry, is not followed into a body it does not call).
        loaded = self._static_graph(entry_rel, result)
        if result["verdict"] != "clear":
            return result
        for rel in loaded:
            other, _why = self.read(rel)
            if other is None or rel == entry_rel:
                continue
            for start, end in other.module_scope():
                hit = self._signals(other, rel, start, end, ["module scope of " + rel])
                if hit is not None:
                    result.update(verdict="excluded", reason="excluded: " + hit[0],
                                  evidence=hit[1], path=["module scope of " + rel])
                    return result
        seen: Set[Tuple[str, int, int]] = set()
        queue: List[Tuple[str, List[Tuple[int, int]], List[str], int]] = [
            (f, segs, path, 0) for f, segs, path in roots]
        files: Set[str] = set()
        while queue:
            rel, segments, path, depth = queue.pop(0)
            segments = _subtract(segments, excluded.get(rel, []))
            key = (rel, segments[0][0] if segments else 0, segments[-1][1] if segments else 0)
            if key in seen or not segments:
                continue
            seen.add(key)
            files.add(rel)
            result["bodies"] += 1
            if result["bodies"] > CLOSURE_MAX_BODIES:
                return dict(result, verdict="excluded",
                            reason="excluded: closure passed its cap (bodies)")
            if len(files) > CLOSURE_MAX_FILES:
                return dict(result, verdict="excluded",
                            reason="excluded: closure passed its cap (files)")
            if depth > CLOSURE_MAX_DEPTH:
                return dict(result, verdict="excluded",
                            reason="excluded: closure passed its cap (depth)")
            cur, why = self.read(rel)
            if cur is None:
                return dict(result, verdict="excluded",
                            reason="excluded: cannot read {} ({})".format(rel, why))
            hit = self._scan(cur, rel, segments, path, depth, queue, result)
            if hit is not None:
                result.update(verdict="excluded", reason="excluded: " + hit[0],
                              evidence=hit[1], path=path)
                return result
        result["files"] = sorted(files)
        result["incomplete"] = result["incomplete"][:10]
        return result

    def _pruned_away(self, js: JsFile, site: Dict[str, Any]) -> List[Tuple[int, int]]:
        """The parts of the site's enclosing function the branch never runs."""
        if site["kind"] == "K3":
            others = [s for s in find_sites(js) if s["kind"] == "K3" and s["pos"] != site["pos"]]
            return [s["region"] for s in others]
        func = js.enclosing_function(site["pos"])
        body_close = func[2] if func is not None else len(js.clean)
        region_end = site["region"][1]
        if site["terminates"]:
            keep = self._catch_blocks(js, site["pos"], func[1] if func else 0)
            return _subtract([(region_end, body_close)], keep)
        cuts: List[Tuple[int, int]] = []
        if site["kind"] == "K1":
            switch_open = js._enclosing_open(site["pos"], "{")
            if switch_open is not None:
                level = js.depth[site["pos"]]
                starts = [k for k in range(switch_open + 1, js.match.get(switch_open,
                                                                        len(js.clean)))
                          if js.code.is_code(k) and js.depth[k] == level and
                          re.match(r"\b(?:case|default)\b", js.clean[k:k + 7]) and
                          not (js.clean[k - 1].isalnum() or js.clean[k - 1] in "_$")]
                close = js.match.get(switch_open, len(js.clean))
                own_group = site["region"]
                breaks = bool(re.search(r"\bbreak\s*;?\s*$", js.clean[own_group[0]:
                                                                     own_group[1]].strip()))
                for index, begin in enumerate(starts):
                    finish = starts[index + 1] if index + 1 < len(starts) else close
                    if begin < site["pos"] and finish <= site["pos"]:
                        cuts.append((begin, finish))
                    elif begin >= own_group[1] and breaks:
                        cuts.append((begin, finish))
        elif site["kind"] == "K2":
            k = js.next_code(site["region"][1])
            if js.clean[k:k + 4] == "else" and not (js.clean[k + 4:k + 5].isalnum()):
                body = js.next_code(k + 4)
                if js.clean[body:body + 1] == "{" and body in js.match:
                    cuts.append((k, js.match[body] + 1))
                else:
                    cuts.append((k, js.statement_end(body, js.depth[body]
                                                     if body < len(js.depth) else 0)))
        return cuts

    def _catch_blocks(self, js: JsFile, pos: int, floor: int) -> List[Tuple[int, int]]:
        """The catch and finally blocks of every try that encloses `pos` above `floor`."""
        keep: List[Tuple[int, int]] = []
        k = pos
        while True:
            opened = js._enclosing_open(k, "{")
            if opened is None or opened < floor:
                return keep
            if js.word_before(opened) == "try" and opened in js.match:
                after = js.match[opened] + 1
                for _ in range(2):
                    nxt = js.next_code(after)
                    word = re.match(r"(catch|finally)\b", js.clean[nxt:nxt + 7])
                    if not word:
                        break
                    brace = js.clean.find("{", nxt)
                    if brace < 0 or brace not in js.match:
                        break
                    keep.append((nxt, js.match[brace] + 1))
                    after = js.match[brace] + 1
            k = opened

    def _static_graph(self, entry_rel: str, result: Dict[str, Any]) -> List[str]:
        """The local modules the entry loads statically, transitively (their module scopes
        run at load)."""
        seen: List[str] = []
        frontier = [entry_rel]
        while frontier:
            rel = frontier.pop(0)
            if rel in seen:
                continue
            seen.append(rel)
            if len(seen) > CLOSURE_MAX_FILES:
                result.update(verdict="excluded",
                              reason="excluded: closure passed its cap (files)")
                return seen
            js, why = self.read(rel)
            if js is None:
                result.update(verdict="excluded",
                              reason="excluded: cannot read {} ({})".format(rel, why))
                return seen
            for spec, _imported in list(js.imports.values()):
                if spec.startswith("."):
                    target = self.resolve(rel, spec)
                    if target is not None and target not in seen:
                        frontier.append(target)
            for a, b in js.import_spans:
                m = re.search(r"([\"'])(\.[^\"']*)\1", js.clean[a:b])
                if m:
                    target = self.resolve(rel, m.group(2))
                    if target is not None and target not in seen:
                        frontier.append(target)
        return seen

    def _scan(self, js: JsFile, rel: str, segments: Sequence[Tuple[int, int]],
              path: List[str], depth: int,
              queue: List[Tuple[str, List[Tuple[int, int]], List[str], int]],
              result: Dict[str, Any]) -> Optional[Tuple[str, str]]:
        """References first (declarations, imports, packages), then the signal scan. Returns
        (reason, evidence) for the first hit, or None."""
        clean = js.clean
        for start, end in segments:
            for m in IDENT_TOKEN_RE.finditer(clean, start, end):
                pos = m.start()
                if not js.code.is_code(pos) or any(a <= pos < b for a, b in js.import_spans):
                    continue
                word = m.group(0)
                if word in JS_KEYWORDS or pos in js.name_pos:
                    continue
                before = js.prev_code(pos)
                if before >= 0 and clean[before] == ".":
                    k = js.next_code(m.end())
                    if k < len(clean) and clean[k] == "(":
                        result["unresolved_member_calls"] += 1
                    continue
                if word in js.decls:
                    start_d, end_d, _kind = js.decls[word]
                    queue.append((rel, [(start_d, end_d)], path + [word], depth + 1))
                    continue
                if word not in js.imports:
                    continue
                spec, imported = js.imports[word]
                if not spec.startswith("."):
                    why = package_signal(spec)
                    if why:
                        return "{} referenced at {}:{}".format(why, rel, js.line_of(pos)), \
                            "{}:{}".format(rel, js.line_of(pos))
                    if spec not in result["unresolved_packages"]:
                        result["unresolved_packages"].append(spec)
                    continue
                target = self.resolve(rel, spec)
                if target is None:
                    result["incomplete"].append("{}:{} imports {} that does not resolve"
                                                .format(rel, js.line_of(pos), spec))
                    continue
                if imported == "*":
                    member = re.match(r"\s*\.\s*([A-Za-z_$][\w$]*)", clean[m.end():m.end() + 80])
                    imported = member.group(1) if member else "*"
                found = self.find_export(target, imported) if imported != "*" else None
                other, why_other = self.read(target)
                if other is None:
                    return "cannot read {} ({})".format(target, why_other), target
                if found is None or found[1] is None:
                    queue.append((target, [(0, len(other.clean))], path + [word],
                                  depth + 1))
                else:
                    queue.append((found[0], [(found[1][0], found[1][1])], path + [word],
                                  depth + 1))
            for m in LITERAL_LOAD_RE.finditer(clean, start, end):
                if not js.code.is_code(m.start()):
                    continue
                spec = m.group(2)
                if not spec.startswith("."):
                    why = package_signal(spec)
                    if why:
                        return "{} loaded at {}:{}".format(why, rel, js.line_of(m.start())), \
                            "{}:{}".format(rel, js.line_of(m.start()))
                    continue
                target = self.resolve(rel, spec)
                other, _why = self.read(target) if target else (None, None)
                if other is not None:
                    queue.append((target, [(0, len(other.clean))], path + [spec], depth + 1))
            hit = self._signals(js, rel, start, end, path)
            if hit is not None:
                return hit
            for m in DYNAMIC_IMPORT_RE.finditer(clean, start, end):
                if not js.code.is_code(m.start()):
                    continue
                note = "{}:{} non-literal dynamic import or require".format(
                    rel, js.line_of(m.start()))
                if note not in result["incomplete"]:
                    result["incomplete"].append(note)
                widened = self._widen(rel)
                if widened is not None:
                    return widened
        return None

    def _signals(self, js: JsFile, rel: str, start: int, end: int, path: List[str]
                 ) -> Optional[Tuple[str, str]]:
        clean = js.clean
        checks: List[Tuple[str, "re.Pattern[str]"]] = [("N2", rx) for rx in N2_RES["js"]]
        checks += [("L6", L6_RE), ("L3 (key handling)", L3_RE), ("L1", L1_CODE_RE)]
        checks += [("S1 (dotenv)", rx) for rx in S1_JS_RES]
        checks += [("SPAWN (child process)", SPAWN_RE), ("WRITE (file write)", WRITE_RE),
                   ("WORKER (worker, native addon or dotenv file)", WORKER_RE),
                   ("USER-STATE (reads per-user state)", USER_STATE_RE)]
        for label, rx in checks:
            for m in rx.finditer(clean, start, end):
                if js.code.is_code(m.start()) and not any(
                        a <= m.start() < b for a, b in js.import_spans):
                    line = js.line_of(m.start())
                    return "{} at {}:{} via {}".format(label, rel, line, " -> ".join(path)), \
                        "{}:{}".format(rel, line)
        for m in S3_RE.finditer(clean, start, end):
            if SECRET_FILE_RE.match(posixpath.basename(C.to_posix(m.group(2)))):
                line = js.line_of(m.start())
                return "S3 (secret file read) at {}:{} via {}".format(
                    rel, line, " -> ".join(path)), "{}:{}".format(rel, line)
        for rx in S2_RES:
            for m in rx.finditer(clean, start, end):
                if js.code.is_code(m.start()) and SECRET_NAME_RE.search(m.group(1)):
                    line = js.line_of(m.start())
                    return "S2 (credential-named variable {}) at {}:{} via {}".format(
                        m.group(1), rel, line, " -> ".join(path)), "{}:{}".format(rel, line)
        return None

    def _widen(self, rel: str) -> Optional[Tuple[str, str]]:
        """A non-literal dynamic import: the module scope of every .js/.mjs/.cjs file under
        the importing file's directory (depth 2) is scanned; a hit excludes."""
        base = self.root / rel_dir(rel)
        found: List[str] = []
        for dirpath, dirnames, filenames in os.walk(str(base)):
            depth = len(Path(dirpath).relative_to(base).parts)
            dirnames[:] = [d for d in dirnames if d != "node_modules" and depth < 2]
            for filename in filenames:
                if filename.endswith((".js", ".mjs", ".cjs")):
                    found.append(C.to_posix(os.path.relpath(os.path.join(dirpath, filename),
                                                            str(self.root))))
            if len(found) > WIDEN_MAX_FILES:
                return "closure passed its cap (widened files)", rel
        for other_rel in sorted(found):
            other, why = self.read(other_rel)
            if other is None:
                return "cannot read {} ({})".format(other_rel, why), other_rel
            for start, end in other.module_scope():
                hit = self._signals(other, other_rel, start, end,
                                    ["dynamic import in " + rel, other_rel])
                if hit is not None:
                    return hit
        return None


# -- infer: candidates from dispatch sites and the README ---------------------------------------


def _readme_names(cls: "Classifier", pkg: Package, bin_name: str, entry: str
                  ) -> List[Tuple[str, str]]:
    """(name, "<file>:<line>") of the README's fenced invocations of a CLI entry."""
    spellings = {entry, "./" + entry}
    if pkg.dir != ".":
        spellings |= {rel_join(pkg.dir, entry), "./" + rel_join(pkg.dir, entry)}
    scripts = [s for s, body in pkg.scripts.items()
               if (split_chain(body)[0].words[:2] if split_chain(body) else [])[:1] == ["node"]
               and len(split_chain(body)[0].words) == 2
               and split_chain(body)[0].words[1] in spellings]
    out: List[Tuple[str, str]] = []
    docs = [p for p in cls.repo.tracked
            if rel_dir(p) in (".", pkg.dir) and
            re.match(r"(?i)^(README|CONTRIBUTING)(\.[\w.]+)?$", posixpath.basename(p))]
    for path in docs:
        text = cls.repo.read(path)
        if text is None:
            continue
        fenced = False
        for number, line in enumerate(text.split("\n"), 1):
            if line.strip().startswith(("```", "~~~")):
                fenced = not fenced
                continue
            if not fenced:
                continue
            body = re.sub(r"^\s*\$\s+", "", line).strip()
            chain = split_chain(body) if body else []
            words = chain[0].words if chain else []
            tail: Optional[List[str]] = None
            if len(words) >= 2 and words[0] == "node" and words[1] in spellings:
                tail = words[2:]
            elif words[:1] == [bin_name]:
                tail = words[1:]
            elif len(words) >= 2 and words[0] in ("npx", "bunx", "yarn") and \
                    words[1] == bin_name:
                tail = words[2:]
            elif words[:3] == ["pnpm", "exec", bin_name]:
                tail = words[3:]
            elif len(words) >= 2 and words[0] in PM_WORDS:
                if len(words) >= 3 and words[1] == "run" and words[2] in scripts:
                    tail = words[3:]
                elif words[1] in scripts:
                    tail = words[2:]
            if tail is None:
                continue
            if tail[:1] == ["--"]:
                tail = tail[1:]
            if not tail:
                continue
            first = tail[0]
            name: Optional[str] = None
            if first in ("--version", "-V"):
                name = "--version"
            elif not first.startswith("-") and SUBCOMMAND_RE.match(first):
                name = first
            if name:
                out.append((name, "{}:{}".format(path, number)))
    return out


def e2e_discovery(cls: "Classifier", e2e: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Candidate subcommands of every CLI whose --help check self-setup proposes: string
    literals at dispatch sites of its source and of the local files the source imports, and
    the README's fenced invocations (pilot-auto-calibration A01-F57). Runs no project code."""
    entries: List[Dict[str, Any]] = []
    for check in e2e:
        if not check.get("_bin"):
            continue
        pkg = cls.disc.packages.get(check["_pkg"])
        if pkg is None:
            continue
        bin_name = check["_entry"]
        target = check["_target"]
        source = check["_source"]
        entry = posixpath.relpath(target, pkg.dir) if pkg.dir != "." else target
        names: Dict[str, List[str]] = {}
        for name, where in _readme_names(cls, pkg, bin_name, entry):
            names.setdefault(name, [])
            if where not in names[name]:
                names[name].append(where)
        files = [source]
        code = cls.repo.code(source)
        if code is not None and language_kind(source) == "js":
            for rx in IMPORT_RES:
                for m in rx.finditer(code.clean):
                    if code.is_code(m.start()):
                        found = cls.scanner.resolve_import(source, m.group(1))
                        if found is not None and found not in files:
                            files.append(found)
        for path in files:
            text = cls.repo.read(path)
            if text is None or language_kind(path) != "js":
                continue
            for site in find_sites(JsFile(path, text)):
                if site["kind"] == "unsupported":
                    continue
                if site["name"] == "--version" and site["kind"] not in ("K1", "K2"):
                    continue
                where = "{}:{}".format(path, site["line"])
                names.setdefault(site["name"], [])
                if where not in names[site["name"]]:
                    names[site["name"]].append(where)
        for name, sources in names.items():
            entries.append({
                "bin": bin_name, "help_check": check["name"], "pkg_dir": pkg.dir,
                "entry": entry, "entry_repo": target, "source": source, "name": name,
                "argv_tail": ["--version"] if name == "--version" else [name],
                "sources": sources, "state": "pending", "reason": "",
                "build_gate": check.get("_build_gate"),
                "scripts": [s for s, body in pkg.scripts.items()
                            if body.strip() in ("node " + entry, "node ./" + entry)],
                "pm": pkg.pm})
    for item in entries:
        if set(name_tokens(item["name"])) & SUBCOMMAND_DENY:
            item.update(state="denylisted", reason="a mutating, service or long-running verb "
                                                   "(SUBCOMMAND_DENY)")
    return entries


def discovery_name(entry: Dict[str, Any]) -> str:
    word = "version" if entry["name"] == "--version" else entry["name"]
    return NAME_SAFE_RE.sub("-", "{}-{}".format(entry["bin"], word))


def canonical_forms(entry: Dict[str, Any]) -> List[str]:
    """The invocations a ban may be written for (A01-F57): node <entry>, the guarded argv,
    the bin, npx / pnpm exec, and <pm> [run] <script> for scripts that run the entry."""
    tail = " ".join(entry["argv_tail"])
    forms = ["node {} {}".format(entry["entry"], tail),
             "node --require {} {} {}".format(GUARD_PATH, entry["entry"], tail),
             "{} {}".format(entry["bin"], tail), "npx {} {}".format(entry["bin"], tail),
             "pnpm exec {} {}".format(entry["bin"], tail)]
    for script in entry.get("scripts") or []:
        pm = entry.get("pm") or "npm"
        forms += ["{} run {} {}".format(pm, script, tail), "{} {} {}".format(pm, script, tail)]
    return forms


def _ban_discovery(entries: Sequence[Dict[str, Any]],
                   patterns: Sequence["vp.ForbiddenPattern"]) -> None:
    """An entry any canonical form of which a ban matches is banned (never run)."""
    for item in entries:
        if item["state"] not in ("pending",):
            continue
        for form in canonical_forms(item):
            hit = vp.forbidden_match(form, patterns)
            if hit is not None:
                item.update(state="banned", reason="matches ban {}".format(hit.raw))
                break


def _quote(word: str) -> str:
    return word if re.match(r"^[\w@%+=:,./-]+$", word) else "\"" + word.replace("\"", "\\\"") + "\""


def _dedup_signals(items: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Set[Tuple[Any, ...]] = set()
    out: List[Dict[str, Any]] = []
    for s in items:
        key = (s["id"], s.get("file"), s.get("line"), s.get("detail"))
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out[:40]


# ---------------------------------------------------------------------------
# Bans (GA-06 6.8, revision 1)
# ---------------------------------------------------------------------------

BAN_ANCHOR = (r"(?:^|[;&|(\x60]|\$\(|(?:^|\s)(?:-c|xargs|exec|nohup|time|npx|env|"
              r"cross-env(?:-shell)?)\s)\s*(?:[A-Za-z_]\w*=\S*\s+)*")
BAN_PM = r"(?:npm|pnpm|yarn|bun|node\s+\S*yarn[^\s]*\.c?js)\b"
BAN_END = r"(?=$|[\s;&|)'\"])"
BAN_FLAGS = r"(?:--prefix|-C|--dir|--cwd|--filter|-w|--workspace|\bworkspace)[\s=]+[\"']?(?:\./)?"
BAN_BUILTINS = frozenset(["install", "i", "ci", "add", "remove", "exec", "dlx", "run"])


def _alts(pkgs: Sequence[Package]) -> str:
    parts: List[str] = []
    for p in pkgs:
        if p.dir not in (".", ""):
            parts.append(re.escape(p.dir))
        if p.name:
            parts.append(re.escape(p.name))
    return "|".join(sorted(set(parts)))


def script_bans(script: str, forbidden: Sequence[Package], others: Sequence[Package]
                ) -> List[str]:
    """The package-manager bans of one forbidden script name (anchored at a command position;
    the other packages whose same-named script is not forbidden stay reachable)."""
    s = re.escape(script)
    if any(p.dir == "." for p in others):
        named = [p for p in forbidden if p.dir != "."]
        out = []
        if named:
            alts = _alts(named)
            out.append("/" + BAN_ANCHOR + BAN_PM + r"[^;&|]*?" + BAN_FLAGS + "(?:" + alts +
                       r")(?=$|[\s/;&|)\"'])[^;&|]*?(?:^|\s)" + s + BAN_END + "/i")
            dirs = "|".join(sorted({re.escape(p.dir) for p in named}))
            out.append(r"/\bcd\s+[\"']?(?:\./)?(?:" + dirs + r")[\"']?\s*(?:&&|;)\s*" + BAN_PM +
                       r"[^;&|]*?(?:^|\s)" + s + BAN_END + "/i")
        return out
    look = ""
    for p in sorted(others, key=lambda x: x.path):
        alts = _alts([p])
        if alts:
            look += r"(?![^;&|]*" + BAN_FLAGS + "(?:" + alts + r")(?=$|[\s/;&|)\"']))"
    return ["/" + BAN_ANCHOR + BAN_PM + look + r"[^;&|]*?(?:^|\s)" + s + BAN_END + "/i"]


def file_ban(basename: str) -> str:
    b = re.escape(basename)
    return (r"/\b(?:node|ts-node|tsx|bun|deno(?:\s+run)?|python3?|bash|sh)\b[^;&|]*?"
            r"(?:^|[\s/\\\"'])" + b + BAN_END + "/i")


def secret_path_ban(repo_root: Path, path: str, where: str) -> str:
    """A ban over the spellings of a credential file (relative, ../, absolute Windows and MSYS),
    components joined by [\\/], ending before a word character, a dot or a glob."""
    end = r"(?![\w.*?\[-])"
    name = re.escape(posixpath.basename(path))
    if where == "ancestor":
        parent = re.escape(posixpath.basename(posixpath.dirname(C.to_posix(path))))
        return (r"/(?:\.\.|[A-Za-z]:[\\/](?:[^\s;&|]*[\\/])?" + parent +
                r"|/[A-Za-z]/(?:[^\s;&|]*/)?" + parent + r"|~[\\/](?:[^\s;&|]*[\\/])?" + parent +
                r")[\\/]" + name + end + "/i")
    parts = [re.escape(p) for p in C.to_posix(path).split("/")]
    joined = r"[\\/]".join(parts)
    if len(parts) == 1:
        return r"/(?:^|[\s\"'=:/\\])(?:\.[\\/])?" + joined + end + "/i"
    return r"/(?:^|[\s\"'=:/\\])(?:\.[\\/])?" + joined + end + "/i"


def tool_ban(leaf: Dict[str, Any]) -> Optional[str]:
    tool, sub = leaf.get("tool"), leaf.get("sub")
    kind = leaf.get("kind")
    if kind == "download":
        if tool in BROWSER_TOOLS:
            return r"/\b" + re.escape(tool) + r"\s+install\b/i"
        pkg = leaf.get("package") or sub
        if not pkg:
            return None
        return (r"/\b(?:npx|pnpm\s+dlx|pnpx|yarn\s+dlx|bunx|uvx|pipx\s+run)\s+(?:-\S+\s+)*" +
                re.escape(pkg) + r"(?:@(?!\d+\.\d+\.\d+(?:$|[\s;&|)'\"]))[^\s;&|]*)?" + BAN_END +
                "/i")
    if tool == "hardhat" and sub == "node":
        return r"/\bhardhat\s+node\b/i"
    if kind in ("l1", "tool") and tool:
        if tool in PM_WORDS:
            return None
        if sub and tool != "vercel" and tool != "semantic-release":
            return r"/\b" + re.escape(tool) + r"\s+(?:\S+\s+)*?" + re.escape(sub) + r"\b/i"
        return r"/\b" + re.escape(tool) + r"\b/i"
    return None


class Bans:
    def __init__(self) -> None:
        self.items: List[Dict[str, Any]] = []
        self.seen: Set[str] = set()

    def add(self, pattern: str, source: str, why: str, signals: Sequence[str],
            line: Optional[int] = None) -> None:
        if pattern in self.seen:
            return
        parsed, problem = vp.parse_pattern(pattern)
        if parsed is None:
            raise InferError("internal: ban {} is unusable: {}".format(pattern, problem))
        self.seen.add(pattern)
        self.items.append({"pattern": pattern, "from": source, "line": line, "why": redact(why, 160),
                           "signals": sorted(set(signals))})

    def compiled(self) -> List["vp.ForbiddenPattern"]:
        patterns, _problems = vp.compile_patterns([b["pattern"] for b in self.items])
        return patterns


def build_bans(cls: Classifier, credential_files: Sequence[Dict[str, Any]]) -> Bans:
    bans = Bans()
    for raw in vp.GENERIC_BANS:
        bans.add(raw, "rule", "generic ban (PF-10; never push unless asked)", ["generic"])
    by_name: Dict[str, Dict[str, List[Package]]] = {}
    for cand in cls.candidates:
        if not cand.get("script"):
            continue
        pkg = cls.disc.packages[cand["script"][0]]
        slot = by_name.setdefault(cand["script"][1], {"forbidden": [], "other": []})
        (slot["forbidden"] if cand["verdict"] == "forbidden" else slot["other"]).append(pkg)
    for cand in cls.candidates:
        if cand["verdict"] != "forbidden":
            continue
        signals = cand.get("strong_ids") or []
        source = cand["provenance"][0].get("source") or "candidate"
        line = cand["provenance"][0].get("line")
        if cand.get("script") and cand["script"][1] not in BAN_BUILTINS:
            name = cand["script"][1]
            slot = by_name[name]
            for pattern in script_bans(name, slot["forbidden"], slot["other"]):
                bans.add(pattern, source, "script {} ({}): {}".format(name, cand["id"],
                                                                      cand["reason"]),
                         list(signals) + ["script"], line)
        for leaf in cand.get("leaves_scan") or []:
            leaf_strong = leaf.get("_strong") or []
            if not leaf_strong:
                continue
            ids = sorted({s["id"] for s in leaf_strong})
            why = "{} ({}): {}".format(leaf.get("file") or leaf.get("tool"), cand["id"],
                                       leaf_strong[0]["detail"])
            if leaf["kind"] == "file" and leaf.get("file"):
                bans.add(file_ban(posixpath.basename(leaf["file"])), leaf["file"], why, ids)
                if leaf.get("tool") == "hardhat":
                    bans.add(r"/\bhardhat\s+run\b[^;&|]*?" + re.escape(
                        posixpath.basename(leaf["file"])) + "/i", leaf["file"], why, ids)
            if leaf["kind"] == "runner" and leaf.get("config"):
                bans.add(r"/\b(?:vitest|jest|mocha|playwright)\b[^;&|]*?" + re.escape(
                    posixpath.basename(leaf["config"])) + "/i", leaf["config"], why, ids)
            ban = tool_ban(leaf)
            if ban:
                bans.add(ban, source, why, ids)
            for env_name in sorted(leaf.get("env") or {}):
                if LIVE_ENV_TOKENS & set(name_tokens(env_name)) or env_name.upper() in {
                        n.upper() for n in cls.switches}:
                    bans.add(r"/\b" + re.escape(env_name) + r"\s*=/i", source,
                             "live switch {} set in a chain ({})".format(env_name, cand["id"]),
                             ["L2"])
    if cls.live_networks:
        bans.add(r"/--network(?:\s+|=)(?:" + "|".join(re.escape(n) for n in cls.live_networks) +
                 r")\b/i", "hardhat config", "live Hardhat networks with a URL: {}".format(
                     ", ".join(cls.live_networks)), ["L2"])
    for cred in credential_files:
        bans.add(secret_path_ban(cls.repo.root, cred["path"], cred["where"]),
                 cred["path"] if cred["where"] != "ancestor" else "ancestor directory",
                 "credential file ({}): never named in a command".format(cred["where"]),
                 ["secret-file"])
    return bans


# ---------------------------------------------------------------------------
# Environment (GA-06 6.10) and project-env.sh
# ---------------------------------------------------------------------------


def environment(cls: Classifier) -> Dict[str, Any]:
    switches = dict(cls.switches)
    for name in FIXED_LIVE_SWITCHES:
        switches.setdefault(name, ("rule", 0))
    upper = {n.upper(): (n, where) for n, where in switches.items()}
    excluded: List[Dict[str, Any]] = []
    allow: List[str] = []
    for name in sorted(set(cls.environ_names)):
        if SECRET_NAME_RE.search(name):
            excluded.append({"name": name, "why": "PF-03 credential-like name"})
        elif name.upper() in upper:
            where = upper[name.upper()][1]
            excluded.append({"name": name, "why": "live switch at {}:{}".format(*where)})
        else:
            allow.append(name)
    return {"allowlist": allow, "excluded": excluded,
            "live_switches": sorted({n for n in switches}),
            "telemetry": {TELEMETRY_ENV["yarn"][0]: TELEMETRY_ENV["yarn"][1],
                          TELEMETRY_ENV["next"][0]: TELEMETRY_ENV["next"][1]}}


SECRET_NAME_GLOBS = ("*PROD*", "*DATABASE_URL*", "*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*",
                     "*PRIVATE*", "*MNEMONIC*", "*SEED*", "*RPC*", "*AWS_*", "*GOOGLE_APPLICATION*",
                     "*RAILWAY*", "*VERCEL*")


def project_env_script(env: Dict[str, Any]) -> Tuple[str, List[str]]:
    """The text of project-env.sh and the names bash cannot unset (GA-06 6.10, revision 11)."""
    names = sorted({e["name"] for e in env["excluded"]} | set(env["live_switches"]))
    good = sorted({n.upper() for n in names if ENV_NAME_RE.match(n)})
    bad = sorted(n for n in names if not ENV_NAME_RE.match(n))
    arms = good + list(SECRET_NAME_GLOBS)
    lines = [
        "# Written by infer_profile.py (self-setup, protocol-preflight PF-23). Source it before "
        "any project command",
        "# run outside gates.py: it removes, by name only and without regard to case, the "
        "variables self-setup keeps",
        "# away from project code (PF-03's credential-like names and the live switches), and "
        "turns telemetry off.",
        "# No value is read or written here.",
    ]
    for n in bad:
        lines.append("# cannot be unset from bash (not an identifier): {}".format(redact(n, 80)))
    lines += [
        "for __harden_v in $(compgen -e); do",
        "  case \"${__harden_v^^}\" in",
        "    {}) unset \"$__harden_v\" ;;".format("|".join(arms)),
        "  esac",
        "done",
        "unset __harden_v",
        "export {}={} {}={}".format(TELEMETRY_ENV["yarn"][0], TELEMETRY_ENV["yarn"][1],
                                    TELEMETRY_ENV["next"][0], TELEMETRY_ENV["next"][1]),
        "harden_run() {{ env {}\"$@\"; }}".format("".join("-u '{}' ".format(n.replace("'", ""))
                                                          for n in names)),
        "",
    ]
    return "\n".join(lines), bad


# ---------------------------------------------------------------------------
# Money-path hints (GA-06 6.11, revision 8): the report's classification table only
# ---------------------------------------------------------------------------

MONEY_WORDS = frozenset(["sign", "signtransaction", "signmessage", "signtypeddata", "signer",
                         "getsigner", "getsigners", "privatekey", "mnemonic", "keystore", "wallet",
                         "hdnodewallet", "fromencryptedjson", "walletclient", "usewalletclient",
                         "writecontract", "writecontractasync", "sendtransaction",
                         "sendrawtransaction", "eth_sendrawtransaction", "transfertransaction",
                         "contractexecutetransaction", "tokenassociatetransaction",
                         "accountallowanceapprovetransaction", "amount", "price", "fee", "fees",
                         "balance", "swap", "liquidity", "transfer", "payment", "payout",
                         "withdraw", "deposit", "slippage", "tinybar", "tinybars", "wei", "gwei",
                         "parseunits", "formatunits", "parseether", "formatether", "allowance",
                         "approve", "createorder", "placeorder", "cancelorder"])
IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*")


def money_keyword(code: Code) -> Optional[Tuple[int, str]]:
    for m in IDENT_RE.finditer(code.clean):
        if not code.is_code(m.start()):
            continue
        ident = m.group(0)
        low = ident.lower()
        if low in MONEY_WORDS:
            return code.line_of(m.start()), ident
        for tok in name_tokens(ident):
            if tok in MONEY_WORDS or (tok.endswith("s") and tok[:-1] in MONEY_WORDS):
                return code.line_of(m.start()), ident
    return None


def money_path_hints(repo: Repo, limits: List[str]) -> List[Dict[str, Any]]:
    matched: Dict[str, Tuple[int, str]] = {}
    production: List[str] = []
    for path in repo.tracked:
        if path.startswith(".harden/") or C.is_test_path(path) or C.is_doc_path(path) or \
                C.path_generated_reason(path):
            continue
        ext = os.path.splitext(path)[1].lower()
        lang = C.language_of(path)
        if ext not in (".sol", ".vy") and not C.is_source_language(lang):
            continue
        production.append(path)
        if ext in (".sol", ".vy"):
            matched[path] = (1, "contract source")
            continue
        segs = path.split("/")
        code = repo.code(path)
        if code is None:
            continue
        if any(s in ("deploy", "deployments", "scripts", "tasks") for s in segs[:-1]) and \
                t_hits(path):
            matched[path] = (1, "path token {}".format(t_hits(path)[0]))
            continue
        hit = money_keyword(code)
        if hit is not None:
            matched[path] = hit
    patterns: List[Dict[str, Any]] = []
    covered: Set[str] = set()
    dirs = sorted({rel_dir(p) for p in matched}, key=lambda d: (d.count("/"), d))
    for d in dirs:
        if d == "." or any(under(d, c) for c in covered):
            continue
        members = [p for p in production if under(p, d)]
        if len(members) >= 3 and all(p in matched for p in members):
            covered.add(d)
            first = sorted(members)[0]
            patterns.append({"pattern": d + "/", "source": first, "line": matched[first][0],
                             "keyword": matched[first][1]})
    for path in sorted(matched):
        if any(under(path, c) for c in covered):
            continue
        if path.startswith("!") or "\\" in path:
            limits.append("money-path hint skipped (not expressible as a glob): {}".format(path))
            continue
        glob = path.replace("[", "[[]").replace("*", "[*]").replace("?", "[?]")
        patterns.append({"pattern": glob, "source": path, "line": matched[path][0],
                         "keyword": matched[path][1]})
    if len(patterns) > 400:
        tops = sorted({p["source"].split("/")[0] + "/" for p in patterns if "/" in p["source"]})
        limits.append("money-path hints collapsed to {} top-level directories (over 400 "
                      "patterns)".format(len(tops)))
        patterns = [{"pattern": t, "source": t, "line": None, "keyword": "collapsed"}
                    for t in tops]
    good = [p for p in patterns if vp.money_glob_problem(p["pattern"]) is None]
    for p in good:
        p["detail"] = "keyword `{}` (generous inference, U01-F05)".format(redact(p["keyword"], 60))
    return good


# ---------------------------------------------------------------------------
# The whole inference
# ---------------------------------------------------------------------------


def resolve_base(root: Path, base: str) -> Tuple[str, str]:
    sha = C.git_ok(root, ["rev-parse", "--verify", "-q", base + "^{commit}"])
    if sha:
        return base, sha
    if base != "HEAD":
        raise InferError("the base {!r} is not a commit of this repository".format(base))
    return base, ""


def load_review(path: Path, repo: Repo) -> Dict[str, Any]:
    """Validate a review file (GA-06 6.13): it may only drop checks or add bans."""
    try:
        data = C.read_json(path)
    except (OSError, ValueError) as exc:
        raise InferError("cannot read the review {}: {}".format(path, exc)) from exc
    if not isinstance(data, dict) or set(data) - {"drop", "forbid"}:
        raise InferError("a review only restricts: allowed keys drop, forbid")
    for key, fields in (("drop", ("name", "why", "evidence")),
                        ("forbid", ("pattern", "why", "evidence"))):
        items = data.get(key, [])
        if not isinstance(items, list):
            raise InferError("a review only restricts: allowed keys drop, forbid")
        for item in items:
            if not isinstance(item, dict) or set(item) != set(fields) or not all(
                    isinstance(item[f], str) and item[f].strip() for f in fields):
                raise InferError("a review only restricts: allowed keys drop, forbid; each {} "
                                 "entry has exactly {}".format(key, ", ".join(fields)))
            m = re.match(r"^(.+):(\d+)$", item["evidence"].strip())
            if not m or C.to_posix(m.group(1)) not in repo.tracked_set:
                raise InferError("review evidence {!r} must be <tracked path>:<line>".format(
                    item["evidence"]))
            text = repo.read(C.to_posix(m.group(1)))
            count = len(text.split("\n")) if text is not None else 0
            if not 1 <= int(m.group(2)) <= max(count, 1) or text is None:
                raise InferError("review evidence {!r} names no line of that file".format(
                    item["evidence"]))
    return {"drop": data.get("drop", []), "forbid": data.get("forbid", [])}


def infer_document(repo_path: Path, inventory: Dict[str, Any], environ_names: Sequence[str],
                   base: str = "HEAD", now: Optional[str] = None,
                   review: Optional[Dict[str, Any]] = None,
                   owner_profile: Optional[Dict[str, Any]] = None,
                   native_windows: Optional[bool] = None) -> Dict[str, Any]:
    """Classify the repository and return the report (profile-inference.json) with the draft
    profile under "profile". Writes nothing and runs no project code."""
    top = vp.work_tree_top(Path(repo_path))
    if top is None:
        raise InferError("{} is not a git work tree".format(C.to_posix(str(repo_path))))
    root = Path(top).resolve()
    base, base_sha = resolve_base(root, base)
    tracked = vp.tracked_files(root, base) or []
    repo = Repo(root, base, base_sha, tracked)
    disc = Discovery(repo)
    discover_packages(disc)
    for pkg in disc.packages.values():
        if pkg.project == pkg.dir and pkg.pm == "yarn":
            disc.yarnrc[pkg.dir] = read_yarnrc(repo, pkg.dir)
    discover_installs(disc)
    ci = discover_ci(repo, disc.limits)
    windows = vp.native_windows() if native_windows is None else native_windows
    cls = Classifier(repo, disc, inventory, environ_names, windows)
    cls.build_candidates(ci)
    cls.classify_all()
    _attribute_leaf_signals(cls)
    gates, e2e = cls.select()
    cls.discovery = e2e_discovery(cls, e2e)
    hooks = discover_hooks(repo)
    creds = [{"path": p, "where": "ignored"} for p in ignored_secret_files(repo, disc.limits)]
    creds += [{"path": p, "where": "ancestor"} for p in ancestor_dotenv_files(repo)]
    tracked_secret = [p for p in repo.tracked if SECRET_FILE_RE.match(posixpath.basename(p))]
    for p in tracked_secret:
        disc.limits.append("tracked secret-named file {} (an SE-17 candidate); never "
                           "opened".format(p))
    bans = build_bans(cls, creds)
    review_notes: List[Dict[str, Any]] = []
    if review:
        gates, e2e = _apply_review(cls, review, gates, e2e, bans, review_notes)
    env = environment(cls)
    for check in gates + e2e:
        check["env_allowlist"] = list(env["allowlist"])
    installs = _config_installs(cls, gates)
    patterns = bans.compiled()
    gates, e2e, installs = _ban_check(cls, gates, e2e, installs, patterns)
    _ban_discovery(cls.discovery, patterns)
    for entry in installs:
        entry["inherit_env"] = False
        entry["env_allowlist"] = list(env["allowlist"])
    hints = money_path_hints(repo, disc.limits)
    report = _report(cls, repo, ci, gates, e2e, bans, env, installs, creds, hooks, hints,
                     now or C.utc_iso(), windows, review_notes)
    if owner_profile is not None:
        report["owner_comparison"] = owner_comparison(cls, bans, owner_profile)
    report["profile"] = build_profile(report, cls)
    return report


def _attribute_leaf_signals(cls: Classifier) -> None:
    """Store on each leaf the strong signals it carries (for the per-leaf bans)."""
    for cand in cls.candidates:
        where = (cand["provenance"][0].get("source"), cand["provenance"][0].get("line"))
        for leaf in cand.get("leaves_scan") or []:
            if leaf["kind"] == "noop":
                continue
            ls = cls.scan_leaf(leaf)
            leaf["_strong"] = argv_signals(leaf, cls.live_networks, where) + [
                s for s in ls.strong if s["id"] != "T" or leaf["kind"] == "file"]


def _apply_review(cls: Classifier, review: Dict[str, Any], gates: List[Dict[str, Any]],
                  e2e: List[Dict[str, Any]], bans: Bans, notes: List[Dict[str, Any]]
                  ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    names = {g["name"] for g in gates} | {e["name"] for e in e2e}
    proposed = {discovery_name(entry): entry for entry in cls.discovery}
    for item in review["drop"]:
        if item["name"] not in names and item["name"] not in proposed:
            raise InferError("review drop {!r} names no selected gate, e2e check or proposed "
                             "subcommand (proposed: {})".format(
                                 item["name"], ", ".join(sorted(proposed)) or "none"))
    dropped = {item["name"]: item for item in review["drop"]}
    for name, item in dropped.items():
        entry = proposed.get(name)
        if entry is not None:
            entry.update(state="dropped-by-review", reason="review: {} ({})".format(
                redact(item["why"]), item["evidence"]))
    for cand in cls.candidates:
        if cand.get("gate_name") in dropped:
            item = dropped[cand["gate_name"]]
            cand["verdict"] = "excluded"
            cand["role"] = "none"
            cand["reason"] = "review: {} ({})".format(redact(item["why"]), item["evidence"])
    kept_gates = [g for g in gates if g["name"] not in dropped and g.get("_of") not in dropped]
    kept_e2e = [e for e in e2e if e["name"] not in dropped]
    for item in review["forbid"]:
        pattern, problem = vp.parse_pattern(item["pattern"])
        if pattern is None:
            raise InferError("review ban {!r} {}".format(item["pattern"], problem))
        for check in kept_gates + kept_e2e:
            if vp.forbidden_match(vp.command_text(check["cmd"]), [pattern]) is not None:
                raise InferError("this ban matches kept gate {}: drop it in the same "
                                 "review".format(check["name"]))
        source, _, line = item["evidence"].rpartition(":")
        bans.add(item["pattern"], "review", "{} ({})".format(item["why"], item["evidence"]),
                 ["review"], int(line) if line.isdigit() else None)
        bans.items[-1]["review"] = True
        del source
    for item in review["drop"]:
        notes.append({"drop": item["name"], "why": redact(item["why"]),
                      "evidence": item["evidence"]})
    for item in review["forbid"]:
        notes.append({"forbid": item["pattern"], "why": redact(item["why"]),
                      "evidence": item["evidence"]})
    return kept_gates, kept_e2e


def _config_installs(cls: Classifier, gates: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_dir = {i["cwd"]: dict(i) for i in cls.disc.installs}
    needed: List[str] = ["."] if "." in by_dir else []
    gate_names = {g["name"] for g in gates}
    for cand in cls.candidates:
        if cand.get("gate_name") not in gate_names:
            continue
        for inst in cand.get("installs") or []:
            target, _rest, _flags = cls.resolver._target_dir(inst["words"][1:], inst["cwd"])
            if target not in by_dir:
                cand["verdict"] = "excluded"
                cand["reason"] = "leading install without a tracked lockfile in {}".format(target)
                continue
            if target not in needed:
                needed.append(target)
        for leaf in cand.get("leaves_scan") or []:
            for d in by_dir:
                if d != "." and under(leaf["cwd"], d) and d not in needed:
                    needed.append(d)
    return [by_dir[d] for d in needed]


def _ban_check(cls: Classifier, gates: List[Dict[str, Any]], e2e: List[Dict[str, Any]],
               installs: List[Dict[str, Any]], patterns: Sequence["vp.ForbiddenPattern"]
               ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Revision 1: every kept check and install passes the final ban list, or is dropped."""
    def ok(check: Dict[str, Any], what: str) -> bool:
        hit = vp.forbidden_match(vp.command_text(check["cmd"]), patterns)
        if hit is None:
            return True
        cls.limits.append("{} {} dropped: it reaches a forbidden command: {}".format(
            what, check["name"], hit.raw))
        for cand in cls.candidates:
            if cand.get("gate_name") == check["name"]:
                cand["verdict"] = "excluded"
                cand["role"] = "none"
                cand["reason"] = "reaches a forbidden command: {}".format(hit.raw)
        return False
    kept_gates = [g for g in gates if ok(g, "gate")]
    kept_names = {g["name"] for g in kept_gates}
    kept_gates = [g for g in kept_gates if not g.get("_of") or g["_of"] in kept_names]
    kept_e2e = [e for e in e2e if ok(e, "e2e check")]
    kept_installs = [i for i in installs if ok(i, "install")]
    found = vb.lockfile_install(cls.repo.root)
    if found is not None and vp.forbidden_match(" ".join(found[1]), patterns) is not None:
        cls.limits.append("the default lockfile install {} matches a ban; the verifier would skip "
                          "it".format(" ".join(found[1])))
    return kept_gates, kept_e2e, kept_installs


def owner_comparison(cls: Classifier, bans: Bans, owner: Dict[str, Any]) -> Dict[str, Any]:
    not_cleared: List[Dict[str, Any]] = []
    checks = [c for c in (owner.get("gates") or []) + (owner.get("e2e") or [])
              if isinstance(c, dict)]
    for check in checks:
        text = vp.command_text(check.get("cmd"))
        cwd = C.to_posix(str(check.get("cwd") or "."))
        key = cls.script_key(text, cwd)
        cand = cls.index.get(key if key is not None else ("text", fold(text), cwd))
        if cand is not None and cand["verdict"] in ("forbidden", "excluded"):
            not_cleared.append({"name": check.get("name"), "cmd": redact(text),
                                "verdict": cand["verdict"], "reason": cand["reason"]})
    to_add: List[str] = []
    for ban in bans.items:
        pattern, _problem = vp.parse_pattern(ban["pattern"])
        if pattern is None:
            continue
        if not any(vp.forbidden_match(vp.command_text(c.get("cmd")), [pattern]) for c in checks):
            to_add.append(ban["pattern"])
    return {"owner_gates_not_cleared": not_cleared, "bans_to_add": to_add}


def _public_check(check: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in check.items() if not k.startswith("_")}


def _report(cls: Classifier, repo: Repo, ci: Dict[str, Any], gates: List[Dict[str, Any]],
            e2e: List[Dict[str, Any]], bans: Bans, env: Dict[str, Any],
            installs: List[Dict[str, Any]], creds: List[Dict[str, Any]], hooks: Dict[str, Any],
            hints: List[Dict[str, Any]], now: str, windows: bool,
            review_notes: List[Dict[str, Any]]) -> Dict[str, Any]:
    candidates = []
    for cand in cls.candidates:
        candidates.append({
            "id": cand["id"], "name": cand["script"][1] if cand.get("script") else None,
            "origin": cand["origin"], "cmd": redact(cand["text"], 200), "cwd": cand["cwd"],
            "gate_cmd": redact(cand.get("gate_text") or "", 200) if cand.get("gate_text") !=
            cand["text"] else None,
            "category": cand["category"], "chain": cand.get("chain") or [],
            "leaves": cand.get("leaves") or [], "signals": cand.get("signals") or [],
            "dotenv_absent": cand.get("dotenv_absent") or [],
            "ci_evidence": cand.get("ci_evidence"), "provenance": cand["provenance"],
            "verdict": cand["verdict"], "reason": cand["reason"][:240],
            "review": bool(cand.get("review")), "review_files": cand.get("review_files") or [],
            "role": cand.get("role") or "none", "covered_by": cand.get("covered_by"),
            "gate": cand.get("gate_name") if cand.get("role") == "gate" else None})
    review = [{"id": c["id"], "why": "weak signals on a CI-evidenced command: {}".format(
        c["reason"]), "files": c["review_files"]} for c in candidates if c["review"]]
    for check in e2e:
        review.append({"id": check["name"], "why": "CLI entry: ban subcommands whose handlers "
                                                   "reach a network client, key or signer "
                                                   "(A01-F26)",
                       "files": [check.get("_source")] if check.get("_source") else []})
    for bin_name in dict.fromkeys(e["bin"] for e in cls.discovery):
        items = [e for e in cls.discovery if e["bin"] == bin_name]
        review.append({"id": "{}-subcommands".format(bin_name),
                       "why": "offline e2e candidates {}: drop any whose handler reaches a "
                              "network client, a key, a signer or writes files (A01-F57)".format(
                                  ", ".join(discovery_name(e) for e in items)),
                       "files": [items[0]["source"]]})
    limits = list(dict.fromkeys(cls.limits))
    for note in cls.network_notes:
        limits.append("{} in {}: {} (existence checks only; PF-23 Not when)".format(
            note["tool"], note["cwd"], note["detail"]))
    for entry in hooks["runs"]:
        limits.append("every commit the run makes executes {}; it may rewrite staged "
                      "files".format(entry))
    dirty = C.git_ok(repo.root, ["status", "--porcelain=v1", "--untracked-files=no"])
    if dirty:
        limits.append("the working tree has uncommitted changes to tracked files")
    return {
        "schema_version": SCHEMA_VERSION, "tool": TOOL, "tool_version": TOOL_VERSION,
        "repo": C.posix_abs(repo.root), "base": repo.base, "base_sha": repo.base_sha or None,
        "generated_utc": now,
        "platform": {"os": os.name, "native_windows": windows},
        "package_managers": cls.disc.package_managers,
        "installs": cls.disc.installs,
        "ci": ci, "candidates": candidates,
        "gates": [_public_check(g) for g in gates], "e2e": [_public_check(e) for e in e2e],
        "forbidden_commands": bans.items,
        "money_path_hints": hints,
        "env": env, "config_install": installs,
        "config_env": {"inherit_env": False, "env_allowlist": list(env["allowlist"])},
        "setup_install": [i for i in installs if not i.get("deps_present")],
        "credential_files": creds, "commit_hooks": hooks,
        "documented": discover_docs(repo), "review": review, "review_applied": review_notes,
        "e2e_discovery": [dict(e) for e in cls.discovery],
        "shuffle_seed": cls.seed(), "live_networks": cls.live_networks,
        "limits": limits, "owner_comparison": None,
        "unread_files": {p: why for p, why in sorted(repo.skipped.items())
                         if why not in ("secret-named file",)},
    }


def build_profile(report: Dict[str, Any], cls: Classifier) -> Dict[str, Any]:
    """The draft profile (GA-06 6.12) with its provenance."""
    gates = report["gates"]
    e2e = report["e2e"]
    prov: Dict[str, List[Dict[str, Any]]] = {}
    for cand in cls.candidates:
        name = cand.get("gate_name")
        if not name or cand.get("role") not in ("gate", "e2e"):
            continue
        entries: List[Dict[str, Any]] = []
        for p in cand["provenance"][:3]:
            entries.append({"source": p.get("source") or "candidate", "line": p.get("line"),
                            "detail": redact(p.get("detail") or "", 200)})
        for entry in (cand.get("chain") or [])[:4]:
            entries.append({"source": entry.get("package") or "chain", "line": entry.get("line"),
                            "detail": "scripts.{}: {}".format(entry.get("script"),
                                                              entry.get("body") or "")[:200]})
        weak = [s for s in cand.get("signals") or [] if s["id"] in ("N1", "N2", "graph")]
        entries.append({"source": "rule", "line": None, "detail": "{}; weak signals: {}".format(
            cand["verdict"], ", ".join("{} {}:{}".format(s["id"], s.get("file"), s.get("line") or
                                                          "-") for s in weak[:5]) or "none")})
        unique: List[Dict[str, Any]] = []
        for entry in entries:  # a script is both a manifest entry and its own chain's first link
            if entry not in unique:
                unique.append(entry)
        prov["gates." + name] = unique
    for check in gates:
        if check.get("_of") or check.get("name", "").endswith("-shuffled"):
            prov.setdefault("gates." + check["name"], [{
                "source": "rule", "line": None,
                "detail": "shuffled copy of {} with seed {} from the base commit "
                          "(pilot-auto-calibration A01-F23)".format(
                              check["name"][:-len("-shuffled")], report["shuffle_seed"])}])
    for check in e2e:
        prov.setdefault("e2e." + check["name"], [{
            "source": "rule", "line": None,
            "detail": "entry point {} (GA-06 e2e forms)".format(check["name"])}])
    for index, ban in enumerate(report["forbidden_commands"]):
        prov["forbidden_commands[{}]".format(index)] = [{
            "source": ban["from"] or "rule", "line": ban.get("line"),
            "detail": "{} [{}]".format(ban["why"], ", ".join(ban["signals"]))}]
    lock = next((i["lockfile"] for i in report["installs"]), None)
    network = "registry-only" if lock or cls.disc.packages else "denied"
    prov["network"] = [{"source": lock or "rule", "line": 1 if lock else None,
                        "detail": "{} (a manifest or lockfile exists)".format(network)
                        if network == "registry-only" else "denied: no manifest or lockfile"}]
    if report["config_install"]:
        prov["install"] = [{"source": i["lockfile"], "line": 1, "detail": "{}: {} in {}".format(
            i["name"], " ".join(i["cmd"]), i["cwd"])} for i in report["config_install"]]
    env = report["env"]
    prov["env"] = [{"source": "platform", "line": None, "detail": redact(
        "inherit_env false; {} names allowed; excluded: {}".format(
            len(env["allowlist"]), ", ".join("{} ({})".format(e["name"], e["why"])
                                               for e in env["excluded"][:12])), 400)}]
    has_test = any(g.get("count_regex") and not g.get("ratchet") for g in gates) or any(
        c.get("role") == "gate" and any(l["kind"] == "runner" for l in c["leaves_scan"])
        for c in cls.candidates)
    mode = "auto" if has_test else "report-only"
    prov["mode"] = [{"source": "rule", "line": None,
                     "detail": "auto (the owner's /harden invocation, U01-F05)" if has_test else
                     "report-only: no runnable test gate (PF-20)"}]
    live = "none" if gates else "unconfirmed"
    prov["live_side_effects"] = [{"source": "rule", "line": None, "detail": (
        "none: self-setup's classification cleared {} gate(s) (PF-23)".format(len(gates))
        if gates else "unconfirmed: self-setup cleared no gate")}]
    prov["sandbox_ack"] = [{"source": "owner decision", "line": None, "detail":
                            "the owner's /harden invocation (U01-F05); native Windows: {} "
                            "(PF-03)".format("yes" if report["platform"]["native_windows"]
                                             else "no")}]
    prov["situation"] = [{"source": "rule", "line": None, "detail":
                          "this skill's own trigger (prioritization step 3; eval-v1-calibration "
                          "E01-F01)"}]
    prov["future_work"] = [{"source": "default", "line": None, "detail":
                            "not inferred: no owner answer (DC-17 reads it as none)"}]
    prov["budget"] = [{"source": "default", "line": None, "detail":
                       "not inferred: budget.py sizes the deadline on the in-scope LOC"}]
    for key in ("structural", "behavioural", "dependencies", "money_paths", "owner_judgement"):
        prov["auto_apply." + key] = [{"source": "owner decision", "line": None,
                                      "detail": "2026-09-25 (U01-F06)"}]
    prov["auto_apply.dependency_versions"] = [{"source": "rule", "line": None, "detail":
                                               "no new dependency version unattended (U01-F08)"}]
    profile: Dict[str, Any] = {
        "comment": [
            "Inferred by self-setup (infer_profile.py; protocol-preflight PF-23): the owner's "
            "/harden invocation is the consent (user-policy-autonomy U01-F05).",
            "Each field's source is under provenance; every candidate command with its verdict "
            "is in .harden/profile-inference.json.",
            "To keep an edited copy, set origin.kind to \"owner\": an owner profile wins, and "
            "self-setup then never replaces it.",
        ],
        "version": 1,
        "mode": mode,
        "gates": [_public_check(g) for g in gates],
        "e2e": [_public_check(e) for e in e2e],
        "network": network,
        "live_side_effects": live,
        "forbidden_commands": [b["pattern"] for b in report["forbidden_commands"]],
        "situation": "release preparation",
        "auto_apply": {"structural": True, "behavioural": True, "dependencies": True,
                       "money_paths": True, "owner_judgement": True,
                       "dependency_versions": False},
        "sandbox_ack": True,
        "origin": {"kind": "inferred", "tool": TOOL, "tool_version": TOOL_VERSION,
                   "created_utc": _utc_z(report["generated_utc"]),
                   "base_sha": report["base_sha"] or "0" * 40,
                   "report_sha256": "0" * 64, "consent": CONSENT},
        "provenance": prov,
    }
    if not report["base_sha"]:
        del profile["origin"]["base_sha"]
    return profile


def _utc_z(value: str) -> str:
    m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)", value or "")
    return (m.group(1) + "Z") if m else C.utc_iso()[:19] + "Z"


# ---------------------------------------------------------------------------
# Outputs (GA-06 6.15)
# ---------------------------------------------------------------------------

GATE_CONFIG_KEYS = ("name", "cmd", "cwd", "timeout_s", "shell", "env", "pipefail", "count_regex",
                    "count_mode", "ratchet", "inherit_env", "env_allowlist")


def _gate_config(check: Dict[str, Any]) -> Dict[str, Any]:
    return {k: check[k] for k in GATE_CONFIG_KEYS if k in check}


def _config_doc(comment: str, allowlist: Sequence[str], checks: Sequence[Dict[str, Any]]
                ) -> Dict[str, Any]:
    return {"$comment": comment, "env_policy": "allowlist", "inherit_env": False,
            "env_allowlist": list(allowlist), "gates": [_gate_config(c) for c in checks]}


def _json_bytes(data: Any) -> bytes:
    return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def write_outputs(out_dir: Path, report: Dict[str, Any], profile: Dict[str, Any]) -> List[str]:
    """Write every output; returns the written file names. Stale optional outputs of an earlier
    run are removed."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: List[str] = []
    C.write_json(out_dir / REPORT_NAME, report)
    written.append(REPORT_NAME)
    digest = hashlib.sha256((out_dir / REPORT_NAME).read_bytes()).hexdigest()
    profile["origin"]["report_sha256"] = digest
    C.write_json(out_dir / DRAFT_NAME, profile)
    written.append(DRAFT_NAME)
    allow = report["config_env"]["env_allowlist"]
    optional = {
        PROBE_CONFIG_NAME: (profile["gates"] or profile["e2e"],
                            "Self-setup's draft gates and e2e checks (infer_profile.py probe runs "
                            "each alone; PF-23)",
                            list(profile["gates"]) + [{k: v for k, v in e.items() if k != "compare"}
                                                      for e in profile["e2e"]]),
        INSTALL_CONFIG_NAME: (report["config_install"],
                              "The lockfile installs the gates need, root first (the fresh-clone "
                              "replay runs them; A01-F24)", report["config_install"]),
        SETUP_CONFIG_NAME: (report["setup_install"],
                            "The installs whose dependencies are missing or stale (run once "
                            "before the probe; A01-F24)", report["setup_install"]),
    }
    for name, (present, comment, checks) in optional.items():
        path = out_dir / name
        if present:
            C.write_json(path, _config_doc(comment, allow, checks))
            written.append(name)
        elif path.exists():
            path.unlink()
    script, _bad = project_env_script(report["env"])
    _write_text(out_dir / ENV_SCRIPT_NAME, script)
    written.append(ENV_SCRIPT_NAME)
    return written


def summary_lines(report: Dict[str, Any], profile: Dict[str, Any], out_dir: Path) -> List[str]:
    counts: Dict[str, int] = {}
    for cand in report["candidates"]:
        counts[cand["verdict"]] = counts.get(cand["verdict"], 0) + 1
    lines = ["self-setup: {} candidate(s): {}".format(
        len(report["candidates"]), ", ".join("{} {}".format(v, counts[v])
                                             for v in sorted(counts)))]
    lines.append("mode {}; network {}; live_side_effects {}".format(
        profile["mode"], profile["network"], profile["live_side_effects"]))
    for g in profile["gates"]:
        lines.append("  gate {}: {} (cwd {})".format(g["name"], vp.command_text(g["cmd"]),
                                                     g.get("cwd", ".")))
    for e in profile["e2e"]:
        lines.append("  e2e {}: {} (cwd {})".format(e["name"], vp.command_text(e["cmd"]),
                                                    e.get("cwd", ".")))
    if not profile["gates"]:
        lines.append("  report only for execution: self-setup cleared no gate")
    lines.append("forbidden_commands: {}".format(len(profile["forbidden_commands"])))
    for cand in report["candidates"]:
        if cand["verdict"] in ("forbidden", "excluded"):
            lines.append("  {} {} [{}]: {}".format(cand["verdict"], cand["cmd"][:60],
                                                   cand["cwd"], cand["reason"][:120]))
    for item in report["review"]:
        lines.append("review {}: {} ({})".format(item["id"], item["why"][:100],
                                                ", ".join(item["files"][:4])))
    for entry in report["config_install"]:
        lines.append("install {}: {} (cwd {}; dependencies {})".format(
            entry["name"], " ".join(entry["cmd"]), entry["cwd"],
            "present" if entry.get("deps_present") else "missing"))
    here = C.to_posix(os.path.dirname(os.path.abspath(__file__)))
    py = C.default_python_command()
    if report["setup_install"]:
        lines.append("Next: {} \"{}/gates.py\" --config \"{}\" --label infer-setup".format(
            py, here, C.to_posix(str(out_dir / SETUP_CONFIG_NAME))))
    if profile["gates"] or profile["e2e"]:
        lines.append("Next: {} \"{}/infer_profile.py\" probe".format(py, here))
    lines.append("Next: {} \"{}/infer_profile.py\" finalize --install".format(py, here))
    return lines


# ---------------------------------------------------------------------------
# probe (GA-06 revision 3): the one part that runs project code, through gates.py
# ---------------------------------------------------------------------------


def _git_run(root: Path, args: Sequence[str]) -> "subprocess.CompletedProcess[bytes]":
    return subprocess.run(["git", "-C", str(root)] + list(args), stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=C.git_env(),
                          check=False, timeout=120)


def changed_tracked(root: Path) -> List[str]:
    proc = _git_run(root, ["-c", "core.quotePath=false", "status", "--porcelain=v1", "-z",
                           "--untracked-files=no"])
    if proc.returncode != 0:
        raise InferError("git status failed: {}".format(proc.stderr.decode("utf-8", "replace")
                                                         .strip()[:200]))
    out: List[str] = []
    entries = proc.stdout.split(b"\0")
    i = 0
    while i < len(entries):
        entry = entries[i].decode("utf-8", errors="replace")
        i += 1
        if len(entry) < 4:
            continue
        status, path = entry[:2], entry[3:]
        out.append(path)
        if "R" in status or "C" in status:
            i += 1
    return out


def run_probe(root: Path, out_dir: Path) -> Dict[str, Any]:
    config = out_dir / PROBE_CONFIG_NAME
    draft_path = out_dir / DRAFT_NAME
    if not config.is_file() or not draft_path.is_file():
        raise InferError("no {} in {}: run infer first (a draft without a gate needs no "
                         "probe)".format(PROBE_CONFIG_NAME, C.to_posix(str(out_dir))))
    if changed_tracked(root):
        raise InferError("the probe needs a clean tree (tracked files have uncommitted changes)")
    try:
        draft = C.read_json(draft_path)
    except (OSError, ValueError) as exc:
        raise InferError("cannot read {}: {}".format(draft_path, exc)) from exc
    gates_dir = out_dir / "gates"
    script = str(Path(__file__).resolve().parent / "gates.py")
    writers: Dict[str, List[str]] = {}
    ran: List[Dict[str, Any]] = []
    for gate in draft.get("gates") or []:
        name = gate["name"]
        proc = subprocess.run([sys.executable, script, "--repo", str(root), "--config",
                               str(config), "--out-dir", str(gates_dir), "--label",
                               PROBE_PREFIX + name, "--only", name],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        changed = changed_tracked(root)
        if changed:
            _git_run(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--"] + changed)
            writers[name] = changed
        ran.append({"name": name, "exit": proc.returncode, "wrote": changed})
    C.write_json(gates_dir / WRITERS_NAME, {"schema_version": SCHEMA_VERSION,
                                            "generated_utc": C.utc_iso(), "writers": writers})
    e2e_names = [e["name"] for e in draft.get("e2e") or []]
    if e2e_names:
        proc = subprocess.run([sys.executable, script, "--repo", str(root), "--config",
                               str(config), "--out-dir", str(gates_dir), "--label",
                               PROBE_E2E_LABEL, "--repeat", "2", "--only", ",".join(e2e_names)],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        changed = changed_tracked(root)
        if changed:
            _git_run(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--"] + changed)
            writers["e2e"] = changed
            C.write_json(gates_dir / WRITERS_NAME, {"schema_version": SCHEMA_VERSION,
                                                    "generated_utc": C.utc_iso(),
                                                    "writers": writers})
        ran.append({"name": PROBE_E2E_LABEL, "exit": proc.returncode, "wrote": changed})
    discovery = run_e2e_discovery(root, out_dir, draft, gates_dir, writers)
    return {"ran": ran, "writers": writers, "discovery": {
        "ran": discovery.get("ran"), "reason": discovery.get("reason"),
        "states": {e.get("probe_name") or discovery_name(e): e.get("state")
                   for e in discovery.get("entries") or []}}}


# ---------------------------------------------------------------------------
# probe and finalize: the discovered subcommands (pilot-auto-calibration A01-F57)
# ---------------------------------------------------------------------------


def _untracked_paths(root: Path) -> Set[str]:
    """Untracked, non-ignored files outside .harden/ (a guard bypass would show as one)."""
    proc = _git_run(root, ["-c", "core.quotePath=false", "status", "--porcelain=v1", "-z",
                           "--untracked-files=all"])
    if proc.returncode != 0:
        return set()
    out: Set[str] = set()
    for entry in proc.stdout.decode("utf-8", errors="replace").split("\0"):
        if entry.startswith("?? "):
            path = entry[3:]
            if not (path == ".harden" or path.startswith(".harden/")):
                out.add(path)
    return out


def _record_results(path: Path) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Any]]:
    """({gate name: its run results in order}, {gate name: its description}) of a gates.py
    record, or empty maps."""
    try:
        data = C.read_json(path)
    except (OSError, ValueError):
        return {}, {}
    if not isinstance(data, dict):
        return {}, {}
    results: Dict[str, List[Dict[str, Any]]] = {}
    for run in data.get("runs") or []:
        for r in run.get("results") or [] if isinstance(run, dict) else []:
            if isinstance(r, dict):
                results.setdefault(str(r.get("name")), []).append(r)
    described = {str(g.get("name")): g for g in data.get("gates") or [] if isinstance(g, dict)}
    return results, described


def _log_text(result: Dict[str, Any], kind: str) -> str:
    """A run's full stdout or stderr log (bytes decoded as UTF-8), else its tail."""
    path = (result.get("log_paths") or {}).get(kind)
    if isinstance(path, str):
        try:
            return Path(path).read_bytes().decode("utf-8", errors="replace")
        except OSError:
            pass
    return str(result.get(kind + "_tail") or "")


def _guard_marker(results: Sequence[Dict[str, Any]]) -> Optional[str]:
    """The first offline-guard refusal of these runs (its text after the mark), or None."""
    for r in results:
        for line in _log_text(r, "stderr").splitlines():
            if line.startswith(GUARD_MARK):
                return line[len(GUARD_MARK):].strip()[:120] or "?"
    for r in results:
        if r.get("exit_code") == GUARD_EXIT:
            return "(exit {})".format(GUARD_EXIT)
    return None


def _discovery_check(item: Dict[str, Any], allow: Sequence[str], cmd: List[str],
                     name: str) -> Dict[str, Any]:
    return {"name": name, "cmd": list(cmd), "cwd": item["pkg_dir"],
            "timeout_s": E2E_MORE_TIMEOUT_S, "inherit_env": False,
            "env_allowlist": list(allow), "env": {"NODE_OPTIONS": ""}}


def _documented(item: Dict[str, Any], parsed: Dict[str, Any]) -> bool:
    if item["name"] == "--version" and parsed.get("version_flag"):
        return True
    if item["name"] in {c["name"] for c in parsed.get("commands") or []}:
        return True
    return any(re.match(r"(?i)^(?:.*/)?(README|CONTRIBUTING)(\.[\w.]+)?:\d+$", s)
               for s in item.get("sources") or [])


def run_e2e_discovery(root: Path, out_dir: Path, draft: Dict[str, Any], gates_dir: Path,
                      writers: Dict[str, List[str]]) -> Dict[str, Any]:
    """Probe the proposed subcommands: keep the documented ones no ban, denylisted verb or
    static closure excludes, then run each once under Node's permission model where it is
    stable and twice exactly as persisted, under the offline guard (A01-F57)."""
    path = out_dir / DISCOVERY_NAME
    try:
        report = C.read_json(out_dir / REPORT_NAME)
    except (OSError, ValueError):
        report = {}
    entries = [dict(e) for e in (report.get("e2e_discovery") or []) if isinstance(e, dict)]
    if not entries:
        result = {"ran": False, "reason": "no discovery candidate"}
        C.write_json(path, result)
        return result
    node = shutil.which("node")
    if node is None:
        result = {"ran": False, "reason": "no node on PATH"}
        C.write_json(path, result)
        return result
    try:
        inside = os.path.commonpath([os.path.normcase(os.path.realpath(node)),
                                     os.path.normcase(os.path.realpath(str(root)))]) == \
            os.path.normcase(os.path.realpath(str(root)))
    except ValueError:
        inside = False
    if inside:
        result = {"ran": False, "reason": "node resolves inside the repository"}
        C.write_json(path, result)
        return result
    skill_dir = str(Path(__file__).resolve().parent.parent)
    try:
        proc = subprocess.run([node, "--version"], cwd=skill_dir, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
                              check=False)
        version = proc.stdout.decode("utf-8", errors="replace").strip()
    except (OSError, subprocess.TimeoutExpired):
        version = ""
    flags = permission_flags(version)
    allow = list((report.get("config_env") or {}).get("env_allowlist") or [])
    patterns = vp.compile_patterns(draft.get("forbidden_commands") or [])[0]
    help_results, _described = _record_results(gates_dir / (PROBE_E2E_LABEL + ".json"))
    helps: Dict[str, Dict[str, Any]] = {}
    for help_name in dict.fromkeys(e["help_check"] for e in entries):
        runs = help_results.get(help_name) or []
        if len(runs) >= 2 and all(r.get("passed") for r in runs):
            first = next(e for e in entries if e["help_check"] == help_name)
            parsed = parse_help(_log_text(runs[0], "stdout"),
                                [first["bin"], posixpath.basename(first["entry"])])
            parsed["log"] = (runs[0].get("log_paths") or {}).get("stdout") or help_name
            helps[help_name] = parsed
            if parsed["version_flag"] and not any(
                    e["help_check"] == help_name and e["name"] == "--version" for e in entries):
                entries.append(dict(first, name="--version", argv_tail=["--version"],
                                    sources=["{}:{}".format(
                                        C.to_posix(str(parsed["log"])), parsed["version_line"])],
                                    state="pending", reason=""))
    for item in entries:
        if item["state"] == "pending" and set(name_tokens(item["name"])) & SUBCOMMAND_DENY:
            item.update(state="denylisted", reason="a mutating, service or long-running verb "
                                                   "(SUBCOMMAND_DENY)")
    _ban_discovery(entries, patterns)
    closures: Dict[str, SubcommandClosure] = {}
    for item in entries:
        if item["state"] != "pending":
            continue
        parsed = helps.get(item["help_check"])
        if parsed is None:
            item.update(state="not-probed", reason="help check {} not green twice at the "
                                                   "probe".format(item["help_check"]))
            continue
        if not _documented(item, parsed):
            item.update(state="undocumented", reason="neither --help nor the README lists it")
            continue
        build = item.get("build_gate")
        if build:
            runs = _record_results(gates_dir / (PROBE_PREFIX + build + ".json"))[0].get(build)
            if not runs or not all(r.get("passed") for r in runs):
                item.update(state="not-probed", reason="not-probed: build gate {} not green at "
                                                       "the probe".format(build))
                continue
        closure = closures.setdefault(item["pkg_dir"], SubcommandClosure(root, item["pkg_dir"]))
        verdict = closure.classify(item["entry_repo"], item["name"])
        item["closure"] = {k: verdict[k] for k in ("verdict", "reason", "evidence", "bodies",
                                                   "incomplete", "unresolved_member_calls",
                                                   "unresolved_packages")}
        if verdict["verdict"] != "clear":
            item.update(state="excluded-static", reason=verdict["reason"])
    names = {g["name"] for g in draft.get("gates") or []} | \
        {e["name"] for e in draft.get("e2e") or []}
    per_bin: Dict[str, int] = {}
    selected: List[Dict[str, Any]] = []
    for item in entries:
        if item["state"] != "pending":
            continue
        if per_bin.get(item["bin"], 0) >= E2E_PROBE_PER_BIN:
            item.update(state="not-probed", reason="probe cap: {} per CLI".format(
                E2E_PROBE_PER_BIN))
            continue
        if len(selected) >= E2E_PROBE_TOTAL:
            item.update(state="not-probed", reason="probe cap: {} in all".format(
                E2E_PROBE_TOTAL))
            continue
        per_bin[item["bin"]] = per_bin.get(item["bin"], 0) + 1
        selected.append(item)
    definitions: List[Dict[str, Any]] = []
    for item in selected:
        base = discovery_name(item)
        name, n = base, 2
        while name in names or name + "--perm" in names:
            name, n = "{}-{}".format(base, n), n + 1
        names.add(name)
        persist = ["node", "--require", GUARD_PATH, item["entry"]] + list(item["argv_tail"])
        item.update(probe_name=name, probe_cmd=persist, persist_cmd=persist, state="probed")
        if flags:
            perm = ["node"] + flags + ["--require", GUARD_PATH, item["entry"]] + \
                list(item["argv_tail"])
            item.update(perm_name=name + "--perm", perm_cmd=perm)
            definitions.append(_discovery_check(item, allow, perm, name + "--perm"))
        definitions.append(_discovery_check(item, allow, persist, name))
    config = out_dir / E2E_MORE_CONFIG_NAME
    result: Dict[str, Any] = {"ran": True, "node_version": version, "permission_flags": flags,
                              "entries": entries, "untracked_new": []}
    if not selected:
        C.write_json(path, result)
        return result
    C.write_json(config, _config_doc("Self-setup's discovered subcommands under the offline "
                                     "guard (A01-F57)", allow, definitions))
    script = str(Path(__file__).resolve().parent / "gates.py")
    before = _untracked_paths(root)

    def gates_run(label: str, repeat: int, only: Sequence[str]) -> None:
        subprocess.run([sys.executable, script, "--repo", str(root), "--config", str(config),
                        "--out-dir", str(gates_dir), "--label", label, "--repeat", str(repeat),
                        "--only", ",".join(only)], stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        changed = changed_tracked(root)
        if changed:
            _git_run(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--"] + changed)
            writers["e2e-more"] = sorted(set(writers.get("e2e-more", [])) | set(changed))
        new = sorted(_untracked_paths(root) - before)
        if new:
            writers["e2e-more"] = sorted(set(writers.get("e2e-more", [])) | set(new))
            result["untracked_new"] = sorted(set(result["untracked_new"]) | set(new))
        if changed or new:
            C.write_json(gates_dir / WRITERS_NAME, {"schema_version": SCHEMA_VERSION,
                                                    "generated_utc": C.utc_iso(),
                                                    "writers": writers})

    stage_b = [item["probe_name"] for item in selected]
    if flags:
        gates_run(PROBE_E2E_PERM_LABEL, 1, [item["perm_name"] for item in selected])
        perm_results, _ = _record_results(gates_dir / (PROBE_E2E_PERM_LABEL + ".json"))
        stage_b = [item["probe_name"] for item in selected
                   if all(r.get("passed") for r in perm_results.get(item["perm_name"]) or [{}])
                   and _guard_marker(perm_results.get(item["perm_name"]) or []) is None]
    if stage_b:
        gates_run(PROBE_E2E_MORE_LABEL, 2, stage_b)
    C.write_json(path, result)
    return result


def _secret_like(texts: Sequence[str]) -> bool:
    return any(rx.search(text) for text in texts
               for rx in (_URL_CRED_RE, _MNEMONIC_CALL_RE, _MNEMONIC_WORDS_RE, _ASSIGN_SECRET_RE))


def _discovered_e2e(root: Path, out_dir: Path, profile: Dict[str, Any], report: Dict[str, Any],
                    kept_e2e: List[Dict[str, Any]], notes: List[str], limits: List[str],
                    prov: Dict[str, List[Dict[str, Any]]], allow: Sequence[str]) -> None:
    """Add each probed subcommand whose guarded runs are clean as a compare: true e2e check
    that keeps the guard; drop the rest with the reason (A01-F57). Never makes the profile
    invalid."""
    try:
        disc = C.read_json(out_dir / DISCOVERY_NAME)
    except (OSError, ValueError):
        disc = None
    if not isinstance(disc, dict) or not disc.get("ran"):
        why = disc.get("reason") if isinstance(disc, dict) else None
        notes.append("e2e discovery not run" + (": " + str(why) if why else ""))
        return
    entries = [e for e in disc.get("entries") or [] if isinstance(e, dict)]
    gates_dir = out_dir / "gates"
    results_b, described_b = _record_results(gates_dir / (PROBE_E2E_MORE_LABEL + ".json"))
    results_a, _ = _record_results(gates_dir / (PROBE_E2E_PERM_LABEL + ".json"))
    help_results, _ = _record_results(gates_dir / (PROBE_E2E_LABEL + ".json"))
    try:
        writers = (C.read_json(gates_dir / WRITERS_NAME) or {}).get("writers") or {}
    except (OSError, ValueError):
        writers = {}
    kept_help = {e["name"] for e in kept_e2e}
    forbidden = vp.compile_patterns(profile.get("forbidden_commands") or [])[0]
    roots = [C.posix_abs(root)]
    added: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    per_bin: Dict[str, int] = {}
    for item in entries:
        name = item.get("probe_name")
        if not name:
            continue
        check = _discovery_check(item, allow, item["persist_cmd"], name)
        reason: Optional[str] = None
        described = described_b.get(name)
        if described is not None:
            try:
                expected = G.parse_gates({"gates": [check], "inherit_env": False,
                                          "env_allowlist": list(allow)}, root)[0]
                if described.get("gate_sha256") != expected.identity_sha256():
                    reason = "probe record describes other definitions"
            except G.ConfigError as exc:
                reason = "invalid check: {}".format(exc)
        if reason is None and item["help_check"] not in kept_help:
            reason = "help check {} not kept".format(item["help_check"])
        if reason is None:
            hit = vp.forbidden_match(vp.command_text(check["cmd"]), forbidden)
            if hit is not None:
                reason = "matches ban {}".format(hit.raw)
        if reason is None and item.get("perm_name"):
            runs_a = results_a.get(item["perm_name"]) or []
            marker = _guard_marker(runs_a)
            if marker is not None:
                reason = "offline guard refused {} under the permission model (stage A)".format(
                    marker)
            elif not runs_a or not all(r.get("passed") for r in runs_a):
                reason = "stage A refused or red (exit {})".format(
                    ", ".join(str(r.get("exit_code")) for r in runs_a) or "not run")
        runs = results_b.get(name) or []
        if reason is None:
            marker = _guard_marker(runs)
            if marker is not None:
                reason = "offline guard refused {}".format(marker)
            elif len(runs) < 2 or any(r.get("exit_code") != 0 or r.get("timed_out")
                                      for r in runs):
                reason = "red or timed out at the guarded probe"
        outs = [vb.normalise_output(_log_text(r, "stdout"), roots) for r in runs[:2]]
        if reason is None and len(set(outs)) > 1:
            reason = "outputs differ between the two guarded runs"
        if reason is None and not outs[0].strip():
            reason = "printed nothing"
        if reason is None:
            help_runs = help_results.get(item["help_check"]) or []
            if help_runs and outs[0] == vb.normalise_output(_log_text(help_runs[0], "stdout"),
                                                             roots):
                reason = "same output as --help"
        if reason is None and _secret_like(outs):
            reason = "output looks like a secret"
        if reason is None and writers.get("e2e-more"):
            reason = "wrote tracked files"
        if reason is None and per_bin.get(item["bin"], 0) >= E2E_MORE_PER_BIN:
            reason = "cap: {} per CLI".format(E2E_MORE_PER_BIN)
        if reason is None and len(added) >= E2E_MORE_TOTAL:
            reason = "cap: {} in all".format(E2E_MORE_TOTAL)
        if reason is not None:
            item.update(state="not-added", reason=reason)
            continue
        entry = dict(check, compare=True)
        kept_e2e.append(entry)
        added.append((item, entry))
        per_bin[item["bin"]] = per_bin.get(item["bin"], 0) + 1
        closure = item.get("closure") or {}
        cleared = "cleared like --help (module-scope check) plus the guarded runs; no dispatch " \
                  "closure" if item["name"] == "--version" else \
            "static closure clear ({} bodies, {} unresolved member calls)".format(
                closure.get("bodies", 0), closure.get("unresolved_member_calls", 0))
        prov["e2e." + name] = [{"source": "rule", "line": None, "detail": redact(
            "subcommand {} from {}; {}; guarded runs 2/2 (as persisted){} (pilot-auto-"
            "calibration A01-F57)".format(" ".join(item["argv_tail"]),
                                          ", ".join(item.get("sources") or [])[:120], cleared,
                                          " + 1 under the permission model"
                                          if item.get("perm_name") else ""), 400)}]
        item.update(state="added", reason="")
    for _ in range(len(added) + 1):
        trial = dict(profile, e2e=kept_e2e)
        check_result = vp.validate(trial)
        bad = None
        for error in check_result.errors:
            m = re.match(r"^e2e\[(\d+)\]", error)
            if m and int(m.group(1)) < len(kept_e2e) and any(
                    entry is kept_e2e[int(m.group(1))] for _item, entry in added):
                bad = (int(m.group(1)), error)
                break
        if bad is None:
            break
        entry = kept_e2e.pop(bad[0])
        for item, candidate in added:
            if candidate is entry:
                item.update(state="not-added", reason="invalid check: {}".format(bad[1][:160]))
                prov.pop("e2e." + entry["name"], None)
    for new in disc.get("untracked_new") or []:
        limits.append("e2e discovery: new untracked file {} (left in place)".format(new))
    report["e2e_discovery"] = entries
    added_names = [i.get("probe_name") for i in entries if i.get("state") == "added"]
    others = ["{} ({})".format(discovery_name(i), (i.get("reason") or i.get("state"))[:80])
              for i in entries if i.get("state") != "added"]
    line = "e2e discovery: added {}".format(", ".join(added_names) or "none")
    if others:
        line += "; not added: " + "; ".join(others[:12]) + ("; ..." if len(others) > 12 else "")
    limits.append(line)


# ---------------------------------------------------------------------------
# finalize (GA-06 6.14 with revision 3)
# ---------------------------------------------------------------------------


def _probe_records(out_dir: Path, explicit: Sequence[str]) -> List[Dict[str, Any]]:
    paths: List[Path] = [Path(p) for p in explicit]
    gates_dir = out_dir / "gates"
    if gates_dir.is_dir():
        for p in sorted(gates_dir.glob(PROBE_PREFIX + "*.json")):
            if p.name != WRITERS_NAME and not p.name.startswith(PROBE_E2E_MORE_LABEL) and \
                    p not in paths:
                paths.append(p)
    records = []
    for p in paths:
        try:
            data = C.read_json(p)
        except (OSError, ValueError) as exc:
            raise InferError("cannot read the probe record {}: {}".format(p, exc)) from exc
        if isinstance(data, dict):
            records.append(data)
    return records


def _could_not_run(recs: Sequence[Dict[str, Any]]) -> bool:
    for r in recs:
        if r.get("error") or r.get("timed_out") or r.get("exit_code") in (127, 9009, None):
            return True
        if COULD_NOT_RUN_RE.search((r.get("stdout_tail") or "") + "\n" +
                                   (r.get("stderr_tail") or "")):
            return True
    return False


def _ratchet_form(cand: Optional[Dict[str, Any]]) -> Optional[Tuple[str, str]]:
    if cand is None or cand.get("category") not in ("lint", "format_check"):
        return None
    statics = [l for l in cand.get("leaves") or [] if l["kind"] == "static"]
    if len(statics) != 1:
        return None
    leaf = statics[0]
    tool, sub = leaf.get("tool"), leaf.get("sub")
    if tool == "eslint":
        return RATCHET_REGEXES["eslint"]
    if tool == "ruff" and sub == "format":
        return RATCHET_REGEXES["ruff format"]
    if tool == "ruff":
        return RATCHET_REGEXES["ruff check"]
    if tool == "cargo" and sub == "fmt":
        return RATCHET_REGEXES["cargo fmt"]
    return None


def finalize(root: Path, out_dir: Path, base: str, explicit: Sequence[str]
             ) -> Tuple[Dict[str, Any], Dict[str, Any], List[str]]:
    try:
        profile = C.read_json(out_dir / DRAFT_NAME)
        report = C.read_json(out_dir / REPORT_NAME)
    except (OSError, ValueError) as exc:
        raise InferError("no draft to finalize ({}): run infer first".format(exc)) from exc
    allow = report.get("config_env", {}).get("env_allowlist") or []
    records = _probe_records(out_dir, explicit)
    probed = bool(records)
    by_name = {c["name"]: c for c in profile.get("gates") or []}
    by_name.update({e["name"]: dict(e) for e in profile.get("e2e") or []})
    results: Dict[str, List[Dict[str, Any]]] = {}
    summaries: Dict[str, Dict[str, Any]] = {}
    for rec in records:
        for described in rec.get("gates") or []:
            name = described.get("name")
            if name not in by_name:
                raise InferError("the probe ran other gate definitions ({} is not in the "
                                 "draft)".format(name))
            entry = {k: v for k, v in by_name[name].items() if k != "compare"}
            try:
                expected = G.parse_gates({"gates": [entry], "inherit_env": False,
                                          "env_allowlist": list(allow)}, root)[0]
            except G.ConfigError as exc:
                raise InferError("draft check {} is not a valid gate: {}".format(name, exc)) \
                    from exc
            if described.get("gate_sha256") != expected.identity_sha256():
                raise InferError("the probe ran other gate definitions ({})".format(name))
        for run in rec.get("runs") or []:
            for r in run.get("results") or []:
                results.setdefault(r.get("name"), []).append(r)
        for name, s in (rec.get("summary") or {}).items():
            summaries[name] = s
    writers: Dict[str, List[str]] = {}
    try:
        writers = (C.read_json(out_dir / "gates" / WRITERS_NAME) or {}).get("writers") or {}
    except (OSError, ValueError):
        writers = {}
    cands = {c.get("gate"): c for c in report.get("candidates") or [] if c.get("gate")}
    prov = profile.setdefault("provenance", {})
    limits = report.setdefault("limits", [])
    notes: List[str] = []
    kept: List[Dict[str, Any]] = []
    plain_green: Set[str] = set()
    for gate in profile.get("gates") or []:
        name = gate["name"]
        key = "gates." + name
        recs = results.get(name) or []
        if not probed:
            prov.setdefault(key, []).append({"source": "probe", "line": None,
                                             "detail": "not probed"})
            kept.append(gate)
            continue
        if name in writers:
            notes.append("dropped {}: writes tracked files ({})".format(
                name, ", ".join(writers[name][:3])))
            prov.pop(key, None)
            continue
        if not recs:
            notes.append("dropped {}: not probed".format(name))
            prov.pop(key, None)
            continue
        failed = [r for r in recs if not r.get("passed")]
        if not failed:
            plain_green.add(name)
            prov.setdefault(key, []).append({"source": "probe", "line": None, "detail":
                                             "green in .harden/gates/{}{}.json".format(
                                                 PROBE_PREFIX, name)})
            kept.append(gate)
            continue
        codes = sorted({str(r.get("exit_code")) for r in failed})
        if _could_not_run(failed):
            last = (failed[0].get("stderr_tail") or failed[0].get("stdout_tail") or
                    failed[0].get("error") or "").strip().split("\n")[-1]
            notes.append("dropped {}: could not run at the pre-start probe (exit {}; last line: "
                         "{})".format(name, ", ".join(codes), redact(last)))
            prov.pop(key, None)
            continue
        cand = cands.get(name)
        form = _ratchet_form(cand)
        if form is not None:
            gate["ratchet"] = True
            gate["count_regex"], gate["count_mode"] = form
            prov.setdefault(key, []).append({"source": "probe", "line": None, "detail":
                                             "probe: red (exit {}): PF-11 ratchet".format(
                                                 ", ".join(codes))})
            kept.append(gate)
            continue
        category = (cand or {}).get("category")
        if name.endswith("-shuffled") and name[:-len("-shuffled")] in plain_green:
            notes.append("dropped {}: red while its plain gate is green".format(name))
            limits.append("order-dependent outcome: PF-12 candidate {}".format(
                name[:-len("-shuffled")]))
            prov.pop(key, None)
            continue
        if category in PROBE_REVIEW_KINDS or name.endswith("-shuffled"):
            limits.append("red at the pre-start probe: {} (exit {}): the baseline will be red "
                          "and the run report-only (PF-11)".format(name, ", ".join(codes)))
            prov.setdefault(key, []).append({"source": "probe", "line": None, "detail":
                                             "red at the probe (exit {}); kept: PF-11 "
                                             "decides".format(", ".join(codes))})
            kept.append(gate)
            continue
        last = (failed[0].get("stdout_tail") or "").strip().split("\n")[-1]
        notes.append("dropped {}: red at the pre-start probe (exit codes {}; last line: "
                     "{})".format(name, ", ".join(codes), redact(last)))
        prov.pop(key, None)
    kept_e2e: List[Dict[str, Any]] = []
    for check in profile.get("e2e") or []:
        name = check["name"]
        key = "e2e." + name
        recs = results.get(name) or []
        if not probed:
            prov.setdefault(key, []).append({"source": "probe", "line": None,
                                             "detail": "not probed"})
            kept_e2e.append(check)
            continue
        if not recs or any(not r.get("passed") for r in recs) or "e2e" in writers:
            notes.append("dropped e2e {}: {}".format(name, "not probed" if not recs else
                                                     "red or writing at the probe"))
            prov.pop(key, None)
            continue
        outs = {vb.normalise_output(r.get("stdout_tail") or "", [C.posix_abs(root)])
                for r in recs}
        if check.get("compare") and len(recs) >= 2 and len(outs) > 1:
            check["compare"] = False
            prov.setdefault(key, []).append({"source": "probe", "line": None, "detail":
                                             "outputs differed between two probe runs"})
        else:
            prov.setdefault(key, []).append({"source": "probe", "line": None, "detail":
                                             "green twice in .harden/gates/{}.json".format(
                                                 PROBE_E2E_LABEL)})
        kept_e2e.append(check)
    if probed:
        _discovered_e2e(root, out_dir, profile, report, kept_e2e, notes, limits, prov, allow)
    profile["gates"] = kept
    profile["e2e"] = kept_e2e
    if not probed:
        notes.append("gates not probed: a red one makes the baseline red (PF-11)")
    if not kept:
        profile["live_side_effects"] = "unconfirmed"
        prov["live_side_effects"] = [{"source": "probe", "line": None,
                                      "detail": "no gate survived the probe"}]
        notes.append("report only for execution: self-setup cleared no gate")
    has_test = any(g.get("count_regex") and not g.get("ratchet") for g in kept) or any(
        (cands.get(g["name"]) or {}).get("category") == "test" for g in kept)
    if not has_test:
        profile["mode"] = "report-only"
        prov["mode"] = [{"source": "rule", "line": None,
                         "detail": "no runnable test gate (PF-20)"}]
    report["finalize"] = {"probed": probed, "notes": notes, "records": len(records)}
    report["gates"] = kept
    report["e2e"] = kept_e2e
    C.write_json(out_dir / REPORT_NAME, report)
    profile["origin"]["report_sha256"] = hashlib.sha256(
        (out_dir / REPORT_NAME).read_bytes()).hexdigest()
    C.write_json(out_dir / DRAFT_NAME, profile)
    return profile, report, notes


def install_profile(root: Path, out_dir: Path, profile: Dict[str, Any], base: str
                    ) -> Tuple[Path, str, "vp.ProfileCheck"]:
    hdir = C.harden_dir(root)
    if (hdir / ACTIVE_NAME).exists():
        raise InstallRefused("a run is active; its profile cannot change")
    target = hdir / PROFILE_NAME
    if target.exists():
        try:
            tracked = vp.tracked_by_repository(target, root, base)
        except vp.TrackingCheckError as exc:
            raise InstallRefused("cannot tell whether {} is tracked: {}".format(target, exc)) \
                from exc
        if tracked:
            raise InstallRefused("{} is tracked by the repository ({})".format(
                C.to_posix(str(target)), tracked))
        try:
            current = C.read_json(target)
        except (OSError, ValueError):
            current = None
        kind = ((current or {}).get("origin") or {}).get("kind") if isinstance(current, dict) \
            else None
        if kind != "inferred":
            raise InstallRefused("an owner profile exists; it wins (U01-F05)")
        shutil.copyfile(str(target), str(hdir / PREVIOUS_NAME))
    check = vp.check_document(profile, repo=root, base=base)
    if check.errors:
        raise InstallRefused("the inferred profile is invalid: " + "; ".join(check.errors[:6]))
    C.ensure_harden_dir(root, True)
    C.write_json(target, profile)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    return target, digest, check


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def environ_names() -> List[str]:
    """The current environment's variable names (never a value; guarantee 3)."""
    return sorted(os.environ.keys())


def _root(repo_arg: str) -> Path:
    top = vp.work_tree_top(Path(repo_arg))
    if top is None:
        raise InferError("{} is not a git work tree".format(C.to_posix(repo_arg)))
    return Path(top).resolve()


def _out_dir(root: Path, value: Optional[str], create_default: bool) -> Path:
    if value:
        return Path(value).resolve()
    if create_default:
        return C.ensure_harden_dir(root, True)
    return C.harden_dir(root)


def cmd_infer(args: argparse.Namespace) -> int:
    root = _root(args.repo)
    if (C.harden_dir(root) / ACTIVE_NAME).exists():
        raise InferError("a run is active (.harden/active): self-setup runs before run_state.py "
                         "start")
    default_out = C.harden_dir(root)
    inv_path = Path(args.inventory) if args.inventory else (
        Path(args.out_dir) / "inventory.json" if args.out_dir else default_out / "inventory.json")
    try:
        inventory = C.read_json(inv_path)
    except (OSError, ValueError) as exc:
        raise InferError("run inventory.py first: cannot read {} ({})".format(
            C.to_posix(str(inv_path)), exc.__class__.__name__)) from exc
    base_repo = Repo(root, args.base, "", vp.tracked_files(root, args.base) or [])
    review = load_review(Path(args.review), base_repo) if args.review else None
    owner = None
    if args.owner_profile:
        try:
            owner = C.read_json(Path(args.owner_profile))
        except (OSError, ValueError) as exc:
            raise InferError("cannot read the owner profile: {}".format(exc)) from exc
    report = infer_document(root, inventory if isinstance(inventory, dict) else {},
                            environ_names(), base=args.base, now=args.now, review=review,
                            owner_profile=owner if isinstance(owner, dict) else None)
    profile = report.pop("profile")
    out_dir = _out_dir(root, args.out_dir, True)
    written = write_outputs(out_dir, report, profile)
    if args.json:
        print(json.dumps({"out_dir": C.to_posix(str(out_dir)), "written": written,
                          "profile": profile}, indent=2, ensure_ascii=False))
    else:
        print("\n".join(summary_lines(report, profile, out_dir)))
        print("written to {}: {}".format(C.to_posix(str(out_dir)), ", ".join(written)))
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    root = _root(args.repo)
    out_dir = _out_dir(root, args.out_dir, False)
    result = run_probe(root, out_dir)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for item in result["ran"]:
            print("probe {}: gates.py exit {}{}".format(item["name"], item["exit"],
                                                       "; restored " + ", ".join(item["wrote"])
                                                       if item["wrote"] else ""))
    return 0


def cmd_finalize(args: argparse.Namespace) -> int:
    root = _root(args.repo)
    out_dir = _out_dir(root, args.out_dir, False)
    profile, report, notes = finalize(root, out_dir, args.base, args.probe or [])
    lines = notes + summary_lines(report, profile, out_dir)[:1 + len(profile["gates"]) +
                                                            len(profile["e2e"]) + 1]
    if args.install:
        target, digest, check = install_profile(root, out_dir, profile, args.base)
        lines.append("installed {} sha256 {}".format(C.to_posix(str(target)), digest))
        lines += ["warning: " + w for w in check.warnings]
    if args.json:
        print(json.dumps({"notes": notes, "profile": profile}, indent=2, ensure_ascii=False))
    else:
        print("\n".join(lines))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="infer_profile.py", description=(
        "Self-setup: infer the run profile and clear every command before it runs "
        "(protocol-preflight PF-23)."))
    sub = parser.add_subparsers(dest="command")
    p = sub.add_parser("infer", help="classify the repository and write the draft profile")
    p.add_argument("--repo", default=".")
    p.add_argument("--base", default="HEAD")
    p.add_argument("--inventory")
    p.add_argument("--out-dir")
    p.add_argument("--review")
    p.add_argument("--owner-profile")
    p.add_argument("--now")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("probe", help="run each draft gate alone through gates.py")
    p.add_argument("--repo", default=".")
    p.add_argument("--out-dir")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("finalize", help="apply the probe and write the profile")
    p.add_argument("--repo", default=".")
    p.add_argument("--base", default="HEAD")
    p.add_argument("--out-dir")
    p.add_argument("--probe", action="append")
    p.add_argument("--install", action="store_true")
    p.add_argument("--json", action="store_true")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code not in (0, None) else 0
    if not args.command:
        parser.print_help()
        return 2
    try:
        if args.command == "infer":
            return cmd_infer(args)
        if args.command == "probe":
            return cmd_probe(args)
        return cmd_finalize(args)
    except InstallRefused as exc:
        C.eprint("infer_profile.py: refused: {}".format(exc))
        return 3
    except (InferError, vp.TrackingCheckError, C.GitError) as exc:
        C.eprint("infer_profile.py: {}".format(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
