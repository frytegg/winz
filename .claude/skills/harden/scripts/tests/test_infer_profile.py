"""Tests for scripts/infer_profile.py (unittest, temporary git repositories, no network).

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import builtins
import contextlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import infer_profile as ip  # noqa: E402
import validate_profile as vp  # noqa: E402
import verify_branch as vb  # noqa: E402

NOW = "2026-09-25T22:00:00Z"
_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None
ENV_NAMES = ["PATH", "HOME", "SYSTEMROOT", "TEMP", "HEDERA_FORKING", "HEDERA_RPC_URL",
             "MY_API_TOKEN", "NODE_OPTIONS"]


def setUpModule() -> None:
    """Isolate git from the user's global and system configuration."""
    global _GIT_HOME
    _GIT_HOME = tempfile.mkdtemp(prefix="harden-ip-gitcfg-")
    cfg = Path(_GIT_HOME) / "gitconfig"
    cfg.write_text("[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                   "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                   "[core]\n\tautocrlf = false\n", encoding="utf-8")
    for key, value in {"GIT_CONFIG_GLOBAL": str(cfg), "GIT_CONFIG_NOSYSTEM": "1"}.items():
        _SAVED_ENV[key] = os.environ.get(key)
        os.environ[key] = value


def tearDownModule() -> None:
    for key, value in _SAVED_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    if _GIT_HOME:
        _rmtree(_GIT_HOME)


def _rmtree(path: str) -> None:
    def fix(func, target, _exc):  # type: ignore[no-untyped-def]
        os.chmod(target, stat.S_IWRITE)
        func(target)
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=fix)
    else:
        shutil.rmtree(path, onerror=fix)


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=str(repo), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0:
        raise RuntimeError("git {} failed: {}".format(args, proc.stderr.decode(
            errors="replace")))
    return proc.stdout.decode("utf-8", errors="replace")


def fake_which(missing: Any = ("shellcheck",)) -> Any:
    def which(name: str, *args: Any, **kwargs: Any) -> Optional[str]:
        base = os.path.basename(str(name))
        return None if base in missing else "/usr/bin/" + base
    return which


def pkg(name: Optional[str], scripts: Dict[str, str], **extra: Any) -> str:
    data: Dict[str, Any] = {}
    if name:
        data["name"] = name
    data.update(extra)
    data["scripts"] = scripts
    return json.dumps(data, indent=2) + "\n"


LINT_YAML = """name: Lint
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  ci:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest]
        node: [lts/*]
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Install dependencies
        run: yarn install --immutable
      - name: Lint
        run: yarn lint:strict
      - name: Types
        run: yarn typecheck
      - name: Unit tests
        run: yarn test:unit
      - name: Mock tier
        run: yarn test:mock
      - name: Tools
        run: yarn check:tools
      - name: Route probe
        run: yarn probe:routes:check
      - name: ShellCheck
        run: shellcheck tools/gate/*.sh
"""

GATE_YAML = """name: Gate
on:
  push:
    branches: [main]
jobs:
  scaffold:
    if: github.repository_owner == 'someone'
    runs-on: ubuntu-latest
    steps:
      - name: Tests of the gate tooling
        run: node --test tools/gate/routes.test.mjs
"""

HARDHAT_CONFIG = """import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig } from "hardhat/config";
// The chain and test scripts set HEDERA_FORKING: the whole fork tier at once.
const forkingTier = process.env.HEDERA_FORKING === "true";
const hederaRpcUrl = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  paths: {
    tests: forkingTier ? "test/fork" : "test/mock",
  },
  networks: {
    hardhat: forkingTier
      ? {
          forking: {
            url: hederaRpcUrl,
          },
        }
      : {},
    hederaTestnet: {
      url: "https://testnet.hashio.io/api",
    },
    hederaMainnet: {
      url: "https://mainnet.hashio.io/api",
    },
  },
};
export default config;
"""

ROOT_SCRIPTS = {
    "test": "yarn hardhat:test",
    "test:mock": "yarn hardhat:test:mock",
    "test:unit": "yarn next:test",
    "typecheck": "yarn next:check-types && yarn hardhat:check-types",
    "lint:strict": "yarn next:lint:all --max-warnings=0 && yarn hardhat:lint --max-warnings=0",
    "check:tools": ("yarn hardhat:lint:tools && yarn hardhat:check-types:tools && "
                    "node tools/checks/run-tests.mjs && node --test tools/gate/routes.test.mjs"),
    "probe:routes:check": ("npm ci --prefix tools/route-probe && npm run test --prefix "
                           "tools/route-probe && npm run check-types --prefix tools/route-probe"),
    "probe:routes": ("npm ci --omit=dev --prefix tools/route-probe && npm run browsers --prefix "
                     "tools/route-probe && node tools/route-probe/src/cli.mjs --serve"),
    "hardhat:test": "yarn workspace @sh/hardhat test",
    "hardhat:test:mock": "yarn workspace @sh/hardhat test:mock",
    "hardhat:chain": "yarn workspace @sh/hardhat chain",
    "hardhat:deploy": "yarn workspace @sh/hardhat deploy",
    "hardhat:deploy:testnet": "yarn hardhat:deploy --network hederaTestnet",
    "hardhat:verify": "yarn workspace @sh/hardhat verify",
    "hardhat:check-types": "yarn workspace @sh/hardhat check-types",
    "hardhat:check-types:tools": "yarn workspace @sh/hardhat check-types:tools",
    "hardhat:lint": "yarn workspace @sh/hardhat lint",
    "hardhat:lint:tools": "yarn workspace @sh/hardhat lint:tools",
    "hardhat:account:reveal-pk": "yarn workspace @sh/hardhat account:reveal-pk",
    "next:test": "yarn workspace @sh/nextjs test",
    "next:check-types": "yarn workspace @sh/nextjs check-types",
    "next:lint:all": "yarn workspace @sh/nextjs lint:all",
    "next:check:live": "yarn workspace @sh/nextjs check:live",
    "check:live": "yarn next:check:live",
    "evidence": "yarn workspace @sh/nextjs evidence",
    "preflight": "node packages/nextjs/lib/hedera/__live__/preflight.mjs",
    "gate:local": "bash tools/gate/local.sh",
    "dev": "yarn workspace @sh/nextjs dev",
    "format": "yarn workspace @sh/nextjs format",
}

MONOREPO: Dict[str, str] = {
    "package.json": pkg("sh", ROOT_SCRIPTS, private=True,
                        workspaces={"packages": ["packages/hardhat", "packages/nextjs"]},
                        packageManager="yarn@3.2.3"),
    ".yarnrc.yml": "nodeLinker: node-modules\n\nyarnPath: .yarn/releases/yarn-3.2.3.cjs\n",
    ".yarn/releases/yarn-3.2.3.cjs": "// yarn release\n",
    "yarn.lock": "__metadata:\n  version: 6\n",
    ".gitignore": "node_modules/\n.env\nloop/\n",
    ".husky/pre-commit": "yarn lint-staged --verbose\n",
    ".github/workflows/lint.yaml": LINT_YAML,
    ".github/workflows/gate.yml": GATE_YAML,
    "packages/hardhat/package.json": pkg("@sh/hardhat", {
        "test": "cross-env HEDERA_FORKING=true hardhat test",
        "test:mock": "hardhat test",
        "chain": "cross-env HEDERA_FORKING=true hardhat node --network hardhat --no-deploy",
        "deploy": "ts-node scripts/runHardhatDeployWithPK.ts",
        "verify": "hardhat run scripts/verifySourcify.ts",
        "check-types": "hardhat compile --quiet && tsc --noEmit --incremental",
        "check-types:tools": "tsc -p ../../tools/checks && tsc -p ../../tools/gate",
        "lint": "eslint",
        "lint:tools": "prettier --check \"../../tools/**/*.{mjs,json}\"",
        "account:reveal-pk": "hardhat run scripts/revealPK.ts",
    }),
    "packages/hardhat/hardhat.config.ts": HARDHAT_CONFIG,
    "packages/hardhat/eslint.config.mjs": "export default [];\n",
    "packages/hardhat/tsconfig.json": "{\n  // comment\n  \"compilerOptions\": {\"strict\": true,},\n}\n",
    "packages/hardhat/.env.example": "DEPLOYER_PRIVATE_KEY=\n",
    "packages/hardhat/test/mock/pool.mock.test.ts": "describe('pool', () => { it('works', () => {}); });\n",
    "packages/hardhat/test/fork/pool.test.ts": "describe('fork', () => {});\n",
    "packages/hardhat/scripts/revealPK.ts": "console.log(process.env.DEPLOYER_PRIVATE_KEY);\n",
    "packages/hardhat/scripts/runHardhatDeployWithPK.ts": "import { Wallet } from 'ethers';\nnew Wallet(process.env.PK!);\n",
    "packages/hardhat/scripts/verifySourcify.ts": "const API = \"https://sourcify.dev/server/v2\";\nfetch(API);\n",
    "packages/nextjs/package.json": pkg("@sh/nextjs", {
        "test": "vitest run",
        "check-types": "tsc --noEmit --incremental",
        "lint:all": "next lint --dir app --dir lib",
        "check:live": "vitest run --config vitest.live.config.ts",
        "evidence": "vitest run --config vitest.evidence.config.ts",
        "dev": "next dev",
        "format": "prettier --write .",
    }),
    "packages/nextjs/vitest.config.ts": (
        "import { defineConfig } from \"vitest/config\";\n"
        "export default defineConfig({\n"
        "  resolve: { alias: [{ find: /^~~\\//, replacement: \".\" }] },\n"
        "  test: { include: [\"lib/**/*.test.ts\"], environment: \"node\" },\n"
        "});\n"),
    "packages/nextjs/vitest.live.config.ts": (
        "import unit from \"./vitest.config\";\n"
        "export default { resolve: unit.resolve, test: { include: [\"lib/__live__/*.live.ts\"] } };\n"),
    "packages/nextjs/vitest.evidence.config.ts": (
        "import unit from \"./vitest.config\";\n"
        "export default { test: { include: [\"lib/__live__/*.signed.ts\"] } };\n"),
    "packages/nextjs/next.config.mjs": "export default {};\n",
    "packages/nextjs/lib/swap.ts": "export function swap(amountIn: bigint) { return amountIn; }\n",
    "packages/nextjs/lib/swap.test.ts": (
        "import { vi } from \"vitest\";\nvi.mock(\"./net\");\n"
        "it(\"swaps\", async () => { await fetch(\"/x\"); });\n"),
    "packages/nextjs/lib/__live__/a.live.ts": "it('reads', () => {});\n",
    "packages/nextjs/lib/hedera/__live__/preflight.mjs": "console.log('preflight');\n",
    "tools/route-probe/package.json": pkg("route-probe", {
        "test": "node --test", "check-types": "tsc --project tsconfig.json",
        "browsers": "playwright install chromium"}),
    "tools/route-probe/package-lock.json": "{\"lockfileVersion\": 3}\n",
    "tools/route-probe/tsconfig.json": "{}\n",
    "tools/route-probe/test/routes.test.mjs": "import test from 'node:test';\ntest('x', () => {});\n",
    "tools/checks/run-tests.mjs": "import { spawnSync } from 'node:child_process';\nspawnSync('node', ['x']);\n",
    "tools/checks/tsconfig.json": "{}\n",
    "tools/gate/tsconfig.json": "{}\n",
    "tools/gate/routes.test.mjs": "import test from 'node:test';\ntest('routes', () => {});\n",
    "tools/gate/local.sh": "#!/usr/bin/env bash\nHERE=\"$(dirname \"$0\")\"\nbash \"$HERE/scaffold-and-check.sh\" \"$@\"\n",
    "tools/gate/scaffold-and-check.sh": ("#!/usr/bin/env bash\nCLI_PACKAGE=\"create-scaffold-hbar@latest\"\n"
                                         "npx \"$CLI_PACKAGE\" --help\n"),
}

MONOREPO_UNTRACKED: Dict[str, str] = {
    "packages/nextjs/node_modules/vitest/package.json": json.dumps(
        {"name": "vitest", "bin": {"vitest": "./vitest.mjs"}}),
}


class RepoCase(unittest.TestCase):
    """A temporary git repository per test."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-ip-"))
        self.addCleanup(_rmtree, str(self.tmp))
        self.repo = self.tmp / "repo space"
        self.repo.mkdir()
        _git(self.repo, "init", "-q")
        patcher = mock.patch.object(ip, "ANCESTOR_STOP", str(self.tmp))
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, files: Dict[str, str], commit: bool = True) -> None:
        for rel, text in files.items():
            path = self.repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(str(path), "w", encoding="utf-8", newline="") as handle:
                handle.write(text)
        if commit:
            _git(self.repo, "add", "-A")
            _git(self.repo, "commit", "-q", "-m", "fixture")

    def infer(self, inventory: Optional[Dict[str, Any]] = None, names: List[str] = ENV_NAMES,
              windows: bool = False, **kwargs: Any) -> Dict[str, Any]:
        with mock.patch.object(ip.shutil, "which", fake_which()):
            return ip.infer_document(self.repo, inventory or {}, names, now=NOW,
                                     native_windows=windows, **kwargs)


def cand_by(report: Dict[str, Any], cmd: str, cwd: str = ".") -> Dict[str, Any]:
    for c in report["candidates"]:
        if c["cmd"] == cmd and c["cwd"] == cwd:
            return c
    raise AssertionError("no candidate {} in {}".format(cmd, cwd))


class MonorepoTests(RepoCase):
    """The self-setup go/no-go shape of the Hedera monorepo (GA-06 review: tests 29 and 30)."""

    def setUp(self) -> None:
        super().setUp()
        self.write(MONOREPO)
        self.write(MONOREPO_UNTRACKED, commit=False)
        (self.tmp / ".env").write_text("NOT_READ=1\n", encoding="utf-8")
        self.report = self.infer()
        self.profile = self.report["profile"]

    def test_gates_are_the_ci_gates_with_a_seeded_shuffled_copy(self) -> None:
        names = [g["name"] for g in self.profile["gates"]]
        self.assertEqual(names, ["lint-strict", "typecheck", "test-unit", "test-unit-shuffled",
                                 "test-mock", "check-tools", "probe-routes-check"])
        probe = next(g for g in self.profile["gates"] if g["name"] == "probe-routes-check")
        self.assertEqual(probe["cmd"], "npm run test --prefix tools/route-probe && npm run "
                                       "check-types --prefix tools/route-probe")
        self.assertEqual(probe["cwd"], ".")
        unit = next(g for g in self.profile["gates"] if g["name"] == "test-unit")
        self.assertEqual(unit["count_regex"], ip.COUNT_REGEXES["vitest"])
        mock_gate = next(g for g in self.profile["gates"] if g["name"] == "test-mock")
        self.assertEqual(mock_gate["count_regex"], ip.COUNT_REGEXES["hardhat test"])
        for gate in self.profile["gates"]:
            self.assertIs(gate["inherit_env"], False)
            self.assertNotIn("HEDERA_FORKING", gate["env_allowlist"])
            self.assertNotIn("HEDERA_RPC_URL", gate["env_allowlist"])
            self.assertNotIn("MY_API_TOKEN", gate["env_allowlist"])
            self.assertIn("PATH", gate["env_allowlist"])

    def test_shuffled_gate_carries_a_seed_from_the_base_sha(self) -> None:
        base = _git(self.repo, "rev-parse", "HEAD").strip()
        seed = int(base[:8], 16) % 2147483647 or 1
        gate = next(g for g in self.profile["gates"] if g["name"] == "test-unit-shuffled")
        self.assertEqual(gate["cmd"], ["node", "node_modules/vitest/vitest.mjs", "run",
                                       "--sequence.shuffle", "--sequence.seed={}".format(seed)])
        self.assertEqual(gate["cwd"], "packages/nextjs")
        self.assertEqual(self.report["shuffle_seed"], seed)

    def test_installs_are_canonical_root_first(self) -> None:
        installs = self.report["config_install"]
        self.assertEqual([(i["name"], i["cmd"], i["cwd"]) for i in installs],
                         [("install-root", ["yarn", "install", "--immutable"], "."),
                          ("install-tools-route-probe", ["npm", "ci"], "tools/route-probe")])
        self.assertEqual(installs[0]["env"], {"YARN_ENABLE_TELEMETRY": "0"})
        self.assertEqual(len(self.report["setup_install"]), 2)

    def test_forbidden_scripts(self) -> None:
        verdicts = {(c["cmd"], c["cwd"]): c["verdict"] for c in self.report["candidates"]}
        for script in ("test", "hardhat:test", "hardhat:chain", "hardhat:deploy",
                       "hardhat:deploy:testnet", "hardhat:verify", "hardhat:account:reveal-pk",
                       "check:live", "evidence", "preflight", "gate:local", "probe:routes"):
            with self.subTest(script=script):
                self.assertEqual(verdicts[("yarn " + script, ".")], "forbidden")
        self.assertEqual(verdicts[("yarn dev", ".")], "excluded")
        self.assertEqual(verdicts[("yarn format", ".")], "excluded")
        self.assertEqual(verdicts[("shellcheck tools/gate/*.sh", ".")], "excluded")
        self.assertIn("tool missing", cand_by(self.report, "shellcheck tools/gate/*.sh")["reason"])

    def test_bans_refuse_and_allow(self) -> None:
        patterns, problems = vp.compile_patterns(self.profile["forbidden_commands"])
        self.assertEqual(problems, [])
        refused = ["yarn test", "yarn run test", "yarn workspace @sh/hardhat test",
                   "cd packages/hardhat && yarn test", "bash -c \"yarn test\"",
                   "cross-env HEDERA_FORKING=true hardhat test", "yarn hardhat:deploy:testnet",
                   "hardhat run scripts/revealPK.ts", "node packages/nextjs/lib/hedera/"
                   "__live__/preflight.mjs", "bash tools/gate/local.sh", "cat ../.env",
                   "npx hardhat compile --network hederaMainnet", "yarn playwright install"]
        allowed = ["npm run test --prefix tools/route-probe", "yarn workspace @sh/nextjs test",
                   "git commit -m \"x\" -m \"Found with yarn lint:strict. The new test fails "
                   "at its parent\"", "grep -n \"yarn test\" README.md", "yarn test:mock",
                   "git add packages/nextjs/lib/hedera/__live__/preflight.mjs",
                   "git diff -- packages/hardhat/.env.example", "rg --files -g '.env*'"]
        for cmd in refused:
            with self.subTest(refused=cmd):
                self.assertIsNotNone(vp.forbidden_match(cmd, patterns))
        for cmd in allowed:
            with self.subTest(allowed=cmd):
                self.assertIsNone(vp.forbidden_match(cmd, patterns))
        for check in self.profile["gates"] + self.profile["e2e"] + self.report["config_install"]:
            with self.subTest(check=check["name"]):
                self.assertIsNone(vp.forbidden_match(vp.command_text(check["cmd"]), patterns))
        found = vb.lockfile_install(self.repo)
        self.assertIsNotNone(found)
        self.assertIsNone(vp.forbidden_match(" ".join(found[1]), patterns))

    def test_bans_carry_their_signal_ids(self) -> None:
        by_pattern = {b["pattern"]: b for b in self.report["forbidden_commands"]}
        self.assertEqual(by_pattern[vp.GENERIC_BANS[0]]["signals"], ["generic"])
        secret = [b for b in self.report["forbidden_commands"] if "secret-file" in b["signals"]]
        self.assertEqual(len(secret), 1)
        self.assertTrue(any("L2" in b["signals"] for b in self.report["forbidden_commands"]))

    def test_profile_is_valid_and_verify_branch_preconditions_hold(self) -> None:
        check = vp.check_document(self.profile, repo=self.repo)
        self.assertEqual(check.errors, [])
        config = {"gates": self.profile["gates"], "install": self.report["config_install"],
                  "inherit_env": False, "env_allowlist": self.report["config_env"]["env_allowlist"]}
        notes: List[str] = []
        checks = vb.build_checks(config, None, check.resolved, notes)
        patterns, _ = vp.compile_patterns(self.profile["forbidden_commands"])
        self.assertEqual(len(checks), len(self.profile["gates"]))
        for item in checks:
            vb.validate_definition(item, self.repo, {})
            self.assertIsNone(vp.forbidden_match(vp.command_text(item.raw["cmd"]), patterns))

    def test_job_level_if_is_not_evidence(self) -> None:
        jobs = {j["job"]: j for j in self.report["ci"]["jobs"]}
        self.assertFalse(jobs["scaffold"]["eligible"])
        self.assertIn("job-level if", jobs["scaffold"]["why"])
        self.assertTrue(jobs["ci"]["eligible"])
        self.assertTrue(jobs["ci"]["hosted"])
        routes = cand_by(self.report, "node --test tools/gate/routes.test.mjs")
        self.assertIsNone(routes["ci_evidence"])
        self.assertEqual(routes["covered_by"], "check-tools")

    def test_review_lists_weak_signals_of_ci_evidenced_commands(self) -> None:
        ids = {c["id"]: c for c in self.report["candidates"]}
        reviewed = [ids[r["id"]] for r in self.report["review"] if r["id"] in ids]
        self.assertTrue(any(c["cmd"] == "yarn check:tools" for c in reviewed))
        tools = cand_by(self.report, "yarn check:tools")
        self.assertEqual(tools["verdict"], "allowed-ci")
        self.assertIn("tools/checks/run-tests.mjs", tools["review_files"])

    def test_secret_files_are_never_opened_and_values_never_written(self) -> None:
        opened: List[str] = []
        real_open = builtins.open

        def spy(file: Any, *args: Any, **kwargs: Any) -> Any:
            opened.append(str(file))
            return real_open(file, *args, **kwargs)
        os.environ["HARDEN_IP_CANARY_TOKEN"] = "canary-value-7f3a9"
        self.addCleanup(os.environ.pop, "HARDEN_IP_CANARY_TOKEN", None)
        with mock.patch("builtins.open", spy):
            report = self.infer(names=sorted(os.environ))
        for path in opened:
            self.assertIsNone(ip.SECRET_FILE_RE.match(os.path.basename(path)), path)
        dumped = json.dumps(report)
        self.assertNotIn("canary-value-7f3a9", dumped)
        self.assertNotIn("NOT_READ", dumped)
        self.assertIn("HARDEN_IP_CANARY_TOKEN", [e["name"] for e in report["env"]["excluded"]])
        self.assertTrue(any("packages/hardhat/.env.example" in line for line in report["limits"]))

    def test_deterministic(self) -> None:
        again = self.infer()
        self.assertEqual(json.dumps(self.report, sort_keys=True),
                         json.dumps(again, sort_keys=True))

    def test_commit_hook_and_money_hints(self) -> None:
        self.assertEqual(self.report["commit_hooks"]["runs"], ["yarn lint-staged --verbose"])
        hints = {h["pattern"] for h in self.report["money_path_hints"]}
        self.assertIn("packages/nextjs/lib/swap.ts", hints)
        self.assertNotIn("money_paths_globs", self.profile)

    def test_owner_comparison(self) -> None:
        owner = {"gates": [{"name": "t", "cmd": "yarn test"}, {"name": "u", "cmd": "yarn test:unit"}]}
        report = self.infer(owner_profile=owner)
        names = [g["name"] for g in report["owner_comparison"]["owner_gates_not_cleared"]]
        self.assertEqual(names, ["t"])
        self.assertTrue(report["owner_comparison"]["bans_to_add"])

    def test_yarn_path_fallback_when_yarn_is_not_on_path(self) -> None:
        with mock.patch.object(ip.shutil, "which", fake_which(("yarn", "shellcheck"))):
            report = ip.infer_document(self.repo, {}, ENV_NAMES, now=NOW, native_windows=False)
        gate = next(g for g in report["profile"]["gates"] if g["name"] == "lint-strict")
        self.assertEqual(gate["cmd"], ["node", ".yarn/releases/yarn-3.2.3.cjs", "lint:strict"])


class ReviewTests(RepoCase):
    def setUp(self) -> None:
        super().setUp()
        self.write(MONOREPO)
        self.base_repo = ip.Repo(self.repo, "HEAD", "", vp.tracked_files(self.repo) or [])

    def review(self, data: Dict[str, Any]) -> Dict[str, Any]:
        path = self.tmp / "review.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        return ip.load_review(path, self.base_repo)

    def test_review_drops_a_gate_and_adds_a_ban(self) -> None:
        review = self.review({"drop": [{"name": "check-tools", "why": "spawns node",
                                        "evidence": "tools/checks/run-tests.mjs:2"}],
                              "forbid": [{"pattern": "/\\bnode\\s+tools/checks\\b/i",
                                          "why": "spawns", "evidence":
                                          "tools/checks/run-tests.mjs:1"}]})
        report = self.infer(review=review)
        self.assertNotIn("check-tools", [g["name"] for g in report["profile"]["gates"]])
        self.assertIn("/\\bnode\\s+tools/checks\\b/i", report["profile"]["forbidden_commands"])
        self.assertIn("review:", cand_by(report, "yarn check:tools")["reason"])

    def test_review_only_restricts(self) -> None:
        for data, needle in (({"add": []}, "only restricts"),
                             ({"drop": [{"name": "x", "why": "y"}]}, "only restricts"),
                             ({"drop": [{"name": "x", "why": "y", "evidence": "nope.txt:1"}]},
                              "<tracked path>:<line>"),
                             ({"drop": [{"name": "x", "why": "y",
                                         "evidence": "package.json:9999"}]}, "names no line")):
            with self.subTest(needle=needle):
                with self.assertRaises(ip.InferError) as ctx:
                    self.review(data)
                self.assertIn(needle, str(ctx.exception))
        bad_drop = self.review({"drop": [{"name": "nope", "why": "y",
                                          "evidence": "package.json:1"}]})
        with self.assertRaises(ip.InferError):
            self.infer(review=bad_drop)
        loosen = self.review({"forbid": [{"pattern": "/yarn/", "why": "y",
                                          "evidence": "package.json:1"}]})
        with self.assertRaises(ip.InferError) as ctx:
            self.infer(review=loosen)
        self.assertIn("matches kept gate", str(ctx.exception))


class SmallRepoTests(RepoCase):
    """Package-manager resolution, CI parsing and signals on small repositories."""

    def test_unknown_tool_without_ci_is_excluded(self) -> None:
        self.write({"package.json": pkg("a", {"test": "frobnicate --all"}),
                    "package-lock.json": "{}\n"})
        cand = cand_by(self.infer(), "npm run test")
        self.assertEqual(cand["verdict"], "excluded")
        self.assertEqual(cand["reason"], "unknown tool frobnicate, no CI evidence")

    def test_yarn4_env_yarn_excludes(self) -> None:
        self.write({"package.json": pkg("a", {"lint": "eslint ."}, packageManager="yarn@4.5.0"),
                    "yarn.lock": "__metadata:\n  version: 8\n", ".yarnrc.yml": "nodeLinker: pnp\n",
                    ".gitignore": ".env.yarn\n"})
        clean = cand_by(self.infer(), "yarn lint")
        self.assertNotEqual(clean["verdict"], "forbidden")
        (self.repo / ".env.yarn").write_text("X=1\n", encoding="utf-8")
        cand = cand_by(self.infer(), "yarn lint")
        self.assertEqual(cand["verdict"], "forbidden")
        self.assertIn("S1", cand["reason"])

    def test_hardhat_vars_secret_excludes(self) -> None:
        config = ("import { vars } from 'hardhat/config';\n"
                  "const key = vars.get('DEPLOYER_KEY');\n"
                  "export default { networks: { hardhat: {} } };\n")
        self.write({"package.json": pkg("a", {"test": "hardhat test"}),
                    "package-lock.json": "{}\n", "hardhat.config.ts": config,
                    "test/a.test.ts": "it('a', () => {});\n"})
        cand = cand_by(self.infer(), "npm run test")
        self.assertEqual(cand["verdict"], "forbidden")
        self.assertIn("Hardhat configuration variable", cand["reason"])
        scoped = config.replace("const key = vars.get('DEPLOYER_KEY');\n", "").replace(
            "hardhat: {} }", "hardhat: {}, sepolia: { url: 'https://x.invalid', accounts: "
            "[vars.get('DEPLOYER_KEY')] } }")
        self.write({"hardhat.config.ts": scoped})
        self.assertNotEqual(cand_by(self.infer(), "npm run test")["verdict"], "forbidden")

    def test_hardhat3_config_variable_is_unsupported(self) -> None:
        self.write({"package.json": pkg("a", {"test": "hardhat test"}),
                    "package-lock.json": "{}\n",
                    "hardhat.config.ts": "import { configVariable } from 'hardhat/config';\n"
                                         "const k = configVariable('X');\nexport default {};\n"})
        cand = cand_by(self.infer(), "npm run test")
        self.assertEqual(cand["verdict"], "excluded")
        self.assertIn("Hardhat 3", cand["reason"])

    def test_dotenv_target_existing_forbids_absent_records(self) -> None:
        files = {"package.json": pkg("a", {"start:job": "node job.js"}),
                 "package-lock.json": "{}\n",
                 "job.js": "require('dotenv').config({ path: '.env.local' });\n"}
        self.write(files)
        cand = cand_by(self.infer(), "npm run start:job")
        self.assertIn(".env.local", " ".join(cand["dotenv_absent"]))
        (self.repo / ".env.local").write_text("A=1\n", encoding="utf-8")
        self.assertEqual(cand_by(self.infer(), "npm run start:job")["verdict"], "forbidden")

    def test_python_dotenv_walks_ancestors(self) -> None:
        self.write({"pyproject.toml": "[project]\nname = 'a'\n",
                    "tool.py": "from dotenv import load_dotenv\nload_dotenv()\n"})
        inventory = {"command_candidates": {"test": [{"cmd": "python tool.py", "cwd": ".",
                                                      "source": "pyproject.toml"}]}}
        self.assertNotEqual(cand_by(self.infer(inventory), "python tool.py")["verdict"],
                            "forbidden")
        (self.tmp / ".env").write_text("A=1\n", encoding="utf-8")
        self.assertEqual(cand_by(self.infer(inventory), "python tool.py")["verdict"],
                         "forbidden")

    def test_unguarded_fork_and_live_network(self) -> None:
        config = ("export default { networks: { hardhat: { forking: { url: 'https://rpc.x.io' } },"
                  " main: { url: 'https://main.x.io' } } };\n")
        self.write({"package.json": pkg("a", {"test": "hardhat test",
                                              "ship": "hardhat run s.ts --network main"}),
                    "package-lock.json": "{}\n", "hardhat.config.ts": config, "s.ts": "1;\n",
                    "test/a.test.ts": "it('a', () => {});\n"})
        report = self.infer()
        self.assertEqual(cand_by(report, "npm run test")["verdict"], "forbidden")
        self.assertIn("forking", cand_by(report, "npm run test")["reason"])
        self.assertEqual(cand_by(report, "npm run ship")["verdict"], "forbidden")
        self.assertIn("/--network(?:\\s+|=)(?:main)\\b/i", report["profile"]["forbidden_commands"])

    def test_npm_prefix_pnpm_filter_and_recursive(self) -> None:
        self.write({"package.json": pkg("root", {"t": "pnpm --filter @x/a test",
                                                 "all": "pnpm -r run test",
                                                 "p": "npm run test --prefix sub"},
                                        packageManager="pnpm@10.0.0"),
                    "pnpm-workspace.yaml": "packages:\n  - 'pkgs/*'\n",
                    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
                    "pkgs/a/package.json": pkg("@x/a", {"test": "vitest run"}),
                    "pkgs/a/a.test.ts": "it('a', () => {});\n",
                    "sub/package.json": pkg("sub", {"test": "node --test"}),
                    "sub/test/x.test.mjs": "1;\n"})
        report = self.infer()
        t = cand_by(report, "pnpm run t")
        self.assertEqual([l["tool"] for l in t["leaves"]], ["vitest"])
        self.assertEqual(t["leaves"][0]["cwd"], "pkgs/a")
        self.assertEqual([l["cwd"] for l in cand_by(report, "pnpm run all")["leaves"]], ["pkgs/a"])
        self.assertEqual(cand_by(report, "pnpm run p")["leaves"][0]["cwd"], "sub")

    def test_yarn_classic_runs_pre_scripts_berry_does_not(self) -> None:
        scripts = {"pretest": "frobnicate", "test": "vitest run"}
        self.write({"package.json": pkg("a", scripts), "yarn.lock": "# yarn lockfile v1\n",
                    "a.test.ts": "it('a', () => {});\n"})
        classic = cand_by(self.infer(), "yarn test")
        self.assertIn("frobnicate", [l["tool"] for l in classic["leaves"]])
        self.write({"package.json": pkg("a", scripts, packageManager="yarn@3.2.3")})
        berry = cand_by(self.infer(), "yarn test")
        self.assertNotIn("frobnicate", [l["tool"] for l in berry["leaves"]])

    def test_yarn_berry_colon_rule(self) -> None:
        self.write({"package.json": pkg("r", {"go": "yarn lint:web"}, packageManager="yarn@3.2.3",
                                        workspaces=["web"]),
                    "yarn.lock": "__metadata:\n", "web/package.json": pkg("web", {
                        "lint:web": "eslint ."})})
        cand = cand_by(self.infer(), "yarn go")
        self.assertEqual([(l["tool"], l["cwd"]) for l in cand["leaves"]], [("eslint", "web")])

    def test_cycle_and_make_variables(self) -> None:
        self.write({"package.json": pkg("a", {"a": "npm run b", "b": "npm run a"}),
                    "package-lock.json": "{}\n",
                    "Makefile": "PY = python3\ntest:\n\t$(PY) -m unittest\nlint:\n\t$(NOPE) x\n",
                    "test_a.py": "import unittest\n"})
        report = self.infer({"command_candidates": {"test": [
            {"cmd": "make test", "cwd": ".", "source": "Makefile target test"},
            {"cmd": "make lint", "cwd": ".", "source": "Makefile target lint"}]}})
        self.assertIn("cycle", cand_by(report, "npm run a")["reason"])
        self.assertEqual(cand_by(report, "make test")["leaves"][0]["tool"], "unittest")
        self.assertIn("make variable", cand_by(report, "make lint")["reason"])

    def test_uv_run_gets_frozen(self) -> None:
        self.write({"pyproject.toml": "[project]\nname = 'a'\n", "uv.lock": "version = 1\n",
                    "tests/test_a.py": "def test_a():\n    assert True\n"})
        report = self.infer({"command_candidates": {"test": [
            {"cmd": "uv run pytest -q", "cwd": ".", "source": "pyproject.toml"}]}})
        gate = report["profile"]["gates"][0]
        self.assertEqual(gate["cmd"], ["uv", "run", "--frozen", "pytest", "-q"])
        self.assertEqual(gate["count_regex"], ip.COUNT_REGEXES["pytest"])

    def test_workflow_parsing_edge_cases(self) -> None:
        wf = ("jobs:\r\n  a:\r\n    runs-on: self-hosted\r\n    steps:\r\n      - run: npm test\r\n"
              "  b:\r\n    runs-on: ubuntu-latest\r\n    environment: prod\r\n    steps:\r\n"
              "      - run: npm test\r\n"
              "  c:\r\n    runs-on: ubuntu-latest\r\n    steps:\r\n      - run: >\r\n"
              "          npm run lint\r\n          ${{ matrix.x }}\r\n"
              "      - if: failure()\r\n        run: npm run fmt\r\n"
              "  d:\r\n    runs-on: ubuntu-latest\r\n    defaults:\r\n      run:\r\n"
              "        working-directory: sub\r\n    steps:\r\n      - run: |\r\n"
              "          npm ci\r\n          npm test \\\r\n            --silent\r\n")
        jobs, commands = ip.parse_workflow(".github/workflows/x.yml", wf)
        by = {j["job"]: j for j in jobs}
        self.assertFalse(by["a"]["eligible"])
        self.assertFalse(by["b"]["eligible"])
        self.assertTrue(by["c"]["eligible"])
        texts = [(c["job"], c["text"], c["cwd"], c["evidence"]) for c in commands]
        self.assertIn(("c", "npm run lint ${{ matrix.x }}", ".", False), texts)
        self.assertIn(("c", "npm run fmt", ".", False), texts)
        self.assertIn(("d", "npm ci", "sub", True), texts)
        self.assertIn(("d", "npm test --silent", "sub", True), texts)

    def test_bom_crlf_and_jsonc(self) -> None:
        text = pkg("a", {"typecheck": "tsc --noEmit"}).replace("\n", "\r\n")
        self.write({"package.json": chr(0xFEFF) + text, "package-lock.json": "{}\n",
                    "tsconfig.json": "{\n // c\n \"compilerOptions\": {\"strict\": true,},\n}\n"})
        report = self.infer()
        self.assertEqual(cand_by(report, "npm run typecheck")["verdict"], "allowed-source")
        self.assertEqual(report["profile"]["gates"][0]["name"], "typecheck")
        self.assertEqual(ip.load_jsonc("{\n// c\n\"a\": [1,],\n}"), {"a": [1]})

    def test_e2e_bin_built_by_tsc(self) -> None:
        self.write({"package.json": pkg("pw", {"build": "tsc -p tsconfig.build.json",
                                               "test": "vitest run"}, bin={"pw": "./dist/cli.js"},
                                        packageManager="pnpm@10.0.0"),
                    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
                    "tsconfig.build.json": "{\"compilerOptions\": {\"outDir\": \"dist\", "
                                           "\"rootDir\": \"src\"}}\n",
                    "src/cli.ts": "import { run } from './lib.js';\nexport function main() "
                                  "{ return run(); }\n",
                    "src/lib.ts": "export function run() { return fetch('https://x.io'); }\n",
                    "tests/a.test.ts": "it('a', () => {});\n"})
        report = self.infer()
        self.assertEqual([e["name"] for e in report["profile"]["e2e"]], ["pw-help"])
        e2e = report["profile"]["e2e"][0]
        self.assertEqual(e2e["cmd"], ["node", "dist/cli.js", "--help"])
        self.assertTrue(any(r["id"] == "pw-help" for r in report["review"]))
        self.write({"src/lib.ts": "export const r = fetch('https://x.io');\n"})
        self.assertEqual(self.infer()["profile"]["e2e"], [])

    def test_windows_posix_shell_with_pm_is_excluded(self) -> None:
        self.write({"package.json": pkg("a", {}), "package-lock.json": "{}\n",
                    ".github/workflows/ci.yml": "jobs:\n  a:\n    runs-on: ubuntu-latest\n"
                                                "    steps:\n      - run: npm exec tsc -- --noEmit "
                                                "$FLAGS\n"})
        report = self.infer(windows=True)
        cand = report["candidates"][0]
        self.assertEqual(cand["verdict"], "excluded")
        self.assertIn("POSIX shell", cand["reason"])

    def test_gate_provenance_has_no_duplicate_entries(self) -> None:
        self.write({"package.json": pkg("a", {"test": "vitest run", "typecheck": "tsc --noEmit"}),
                    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n"})
        profile = self.infer()["profile"]
        self.assertTrue(profile["gates"])
        for key, entries in profile["provenance"].items():
            with self.subTest(key=key):
                self.assertEqual(len(entries), len({json.dumps(e, sort_keys=True)
                                                    for e in entries}))

    def test_empty_repository_has_no_gate(self) -> None:
        self.write({"README.md": "# x\n"})
        report = self.infer()
        self.assertEqual(report["profile"]["gates"], [])
        self.assertEqual(report["profile"]["mode"], "report-only")
        self.assertEqual(report["profile"]["live_side_effects"], "unconfirmed")
        self.assertEqual(report["profile"]["network"], "denied")

    def test_ignored_walk_skips_junction_cycles(self) -> None:
        self.write({"package.json": pkg("a", {}), ".gitignore": "loop/\n"})
        loop = self.repo / "loop"
        (loop / "inner").mkdir(parents=True)
        (loop / "inner" / "id_rsa").write_text("x\n", encoding="utf-8")
        link = loop / "inner" / "back"
        try:
            if os.name == "nt":
                proc = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(loop)],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
                if proc.returncode != 0:
                    self.skipTest("cannot create a junction")
            else:
                os.symlink(str(loop), str(link))
        except OSError:
            self.skipTest("cannot create a link")
        started = time.monotonic()
        limits: List[str] = []
        repo = ip.Repo(self.repo.resolve(), "HEAD", "", vp.tracked_files(self.repo) or [])
        found = ip.ignored_secret_files(repo, limits)
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(found, ["loop/inner/id_rsa"])
        if os.name == "nt":
            os.rmdir(str(link))


class HelperTests(unittest.TestCase):
    def test_redact(self) -> None:
        self.assertEqual(ip.redact("API_KEY=abc123 rest"), "API_KEY=<redacted> rest")
        self.assertIn("<hex:64>", ip.redact("0x" + "ab" * 32))
        self.assertIn("<redacted:44>", ip.redact("t " + "Z" * 44))
        self.assertIn("<user>:<redacted>@", ip.redact("https://bob:pw@host/x"))
        self.assertIn("<mnemonic>", ip.redact("Wallet.fromMnemonic(phrase)"))
        words = " ".join(["abandon"] * 12)
        self.assertIn("<mnemonic>", ip.redact("const m = \"{}\";".format(words)))
        self.assertIn("u{202E}", ip.redact("a" + chr(0x202E) + "b"))
        self.assertLessEqual(len(ip.redact("x " * 200)), 120)

    def test_name_tokens(self) -> None:
        self.assertEqual(ip.t_hits("hardhat:account:reveal-pk"), ["account", "pk", "reveal"])
        self.assertEqual(ip.t_hits("runHardhatDeployWithPK.ts"), ["deploy", "pk"])
        self.assertEqual(ip.t_hits("OLIVE_DELIVERY"), [])
        self.assertEqual(ip.t_hits("keyless"), [])

    def test_split_chain(self) -> None:
        cmds = ip.split_chain("A=1 cross-env B=2 x --y && (z; w) || set C=3&& v 2>&1 &")
        self.assertEqual([c.op for c in cmds], [None, "&&", ";", "||", "&&"])
        self.assertEqual(cmds[-1].words, ["v", "2>&1"])
        self.assertTrue(cmds[-1].background)
        self.assertEqual(cmds[3].env, {"C": "3"})
        env, _unset, rest = ip.take_env(cmds[0].words)
        self.assertEqual((env, rest), ({"A": "1", "B": "2"}, ["x", "--y"]))
        self.assertTrue(ip.needs_posix("ls *.sh"))
        self.assertFalse(ip.needs_posix("npm run a && npm run b"))

    def test_code_strips_comments_and_keeps_strings(self) -> None:
        code = ip.Code("const a = /x\\//; // fetch(\nconst u = `https://${h}/`; /* b */", "js")
        self.assertNotIn("fetch", code.clean)
        self.assertIn("https://", code.clean)
        self.assertFalse(code.is_code(code.clean.index("https")))

    def test_secret_path_ban_spellings(self) -> None:
        raw = ip.secret_path_ban(Path("/r"), "C:/Users/me/Hedera/.env", "ancestor")
        pattern, problem = vp.parse_pattern(raw)
        self.assertIsNone(problem)
        for cmd in ("cat ../.env", "type C:\\Users\\me\\Hedera\\.env", "cat /c/Users/me/Hedera/.env",
                    "cat C:/Users/me/Hedera/.env"):
            self.assertIsNotNone(vp.forbidden_match(cmd, [pattern]), cmd)
        for cmd in ("cat .env.example", "cat ../.env.example", "rg -g '../.env*'"):
            self.assertIsNone(vp.forbidden_match(cmd, [pattern]), cmd)

    @unittest.skipUnless(os.name == "nt", "8.3 short names exist on Windows only")
    def test_ancestor_walk_stops_at_a_stop_given_by_its_short_name(self) -> None:
        import ctypes
        tmp = Path(os.path.realpath(tempfile.mkdtemp(prefix="harden-stop-")))
        self.addCleanup(_rmtree, str(tmp))
        (tmp / ".env.local").write_text("NOT_READ=1\n", encoding="utf-8")
        stop = tmp / "stop dir with a long name"
        root = stop / "repo"
        root.mkdir(parents=True)
        buf = ctypes.create_unicode_buffer(1024)
        ctypes.windll.kernel32.GetShortPathNameW(str(stop), buf, len(buf))
        if not buf.value or os.path.normcase(buf.value) == os.path.normcase(str(stop)):
            self.skipTest("this volume has no 8.3 short names")
        with mock.patch.object(ip, "ANCESTOR_STOP", buf.value):
            found = ip.ancestor_dotenv_files(ip.Repo(root, "HEAD", "", []))
        self.assertEqual(found, [], "the walk went past a stop directory given by its short name")

    def test_project_env_script(self) -> None:
        env = {"excluded": [{"name": "MY_TOKEN", "why": "x"}, {"name": "ASL.LOG_KEY", "why": "x"}],
               "live_switches": ["HEDERA_FORKING"]}
        text, bad = ip.project_env_script(env)
        self.assertEqual(bad, ["ASL.LOG_KEY"])
        self.assertIn("case \"${__harden_v^^}\" in", text)
        self.assertIn("HEDERA_FORKING|MY_TOKEN|*PROD*", text)
        self.assertIn("export YARN_ENABLE_TELEMETRY=0 NEXT_TELEMETRY_DISABLED=1", text)
        self.assertIn("-u 'ASL.LOG_KEY'", text)
        self.assertNotIn("\r", text)


def _python_gate(name: str, code: str, **extra: Any) -> Dict[str, Any]:
    gate = {"name": name, "cmd": [sys.executable, "-c", code], "cwd": ".", "timeout_s": 120,
            "inherit_env": False, "env_allowlist": sorted(os.environ)}
    gate.update(extra)
    return gate


class ProbeFinalizeTests(RepoCase):
    """probe runs each gate alone through gates.py; finalize applies it (GA-06 revision 3)."""

    def setUp(self) -> None:
        super().setUp()
        self.write({"a.txt": "a\n", "README.md": "# r\n"})
        self.out = self.repo / ".harden"
        self.out.mkdir()
        _git(self.repo, "rev-parse", "HEAD")

    def draft(self, gates: List[Dict[str, Any]], e2e: List[Dict[str, Any]],
              categories: Dict[str, str], leaves: Optional[Dict[str, List[Dict[str, Any]]]] = None
              ) -> None:
        base = _git(self.repo, "rev-parse", "HEAD").strip()
        profile = {"version": 1, "mode": "auto", "gates": gates, "e2e": e2e,
                   "network": "denied", "live_side_effects": "none",
                   "forbidden_commands": list(vp.GENERIC_BANS), "situation": "release preparation",
                   "sandbox_ack": True,
                   "auto_apply": {"structural": True, "behavioural": True, "dependencies": True,
                                  "money_paths": True, "owner_judgement": True,
                                  "dependency_versions": False},
                   "origin": {"kind": "inferred", "tool": ip.TOOL, "tool_version": 1,
                              "created_utc": NOW, "base_sha": base, "report_sha256": "0" * 64,
                              "consent": ip.CONSENT},
                   "provenance": {"gates." + g["name"]: [{"source": "rule"}] for g in gates}}
        profile["provenance"].update({"e2e." + e["name"]: [{"source": "rule"}] for e in e2e})
        report = {"candidates": [{"gate": n, "category": c, "leaves": (leaves or {}).get(n, [])}
                                 for n, c in categories.items()],
                  "config_env": {"env_allowlist": sorted(os.environ)}, "limits": []}
        (self.out / ip.DRAFT_NAME).write_text(json.dumps(profile), encoding="utf-8")
        (self.out / ip.REPORT_NAME).write_text(json.dumps(report), encoding="utf-8")
        (self.out / ip.PROBE_CONFIG_NAME).write_text(json.dumps(ip._config_doc(
            "t", sorted(os.environ), gates + [{k: v for k, v in e.items() if k != "compare"}
                                              for e in e2e])), encoding="utf-8")

    def test_red_test_gate_that_ran_is_kept_and_limits_names_pf11(self) -> None:
        gates = [_python_gate("unit", "import sys; print('1 failed'); sys.exit(1)",
                              count_regex="(\\d+) passed"),
                 _python_gate("gone", "import sys; print('Cannot find module x'); sys.exit(1)"),
                 _python_gate("lint", "import sys; print('3 problems (3 errors, 0 warnings)'); "
                                      "sys.exit(1)")]
        self.draft(gates, [], {"unit": "test", "gone": "test", "lint": "lint"},
                   {"lint": [{"kind": "static", "tool": "eslint", "sub": None}]})
        ip.run_probe(self.repo, self.out)
        profile, report, notes = ip.finalize(self.repo, self.out, "HEAD", [])
        names = [g["name"] for g in profile["gates"]]
        self.assertEqual(names, ["unit", "lint"])
        self.assertTrue(any("red at the pre-start probe: unit" in l and "PF-11" in l
                            for l in report["limits"]))
        self.assertTrue(any("could not run" in n for n in notes))
        lint = profile["gates"][1]
        self.assertTrue(lint["ratchet"])
        self.assertEqual(lint["count_regex"], ip.RATCHET_REGEXES["eslint"][0])

    def test_gate_that_writes_a_tracked_file_is_dropped_and_restored(self) -> None:
        gates = [_python_gate("writer", "open('a.txt', 'w').write('changed')"),
                 _python_gate("unit", "print('ok')")]
        self.draft(gates, [], {"writer": "lint", "unit": "test"})
        result = ip.run_probe(self.repo, self.out)
        self.assertEqual(result["writers"], {"writer": ["a.txt"]})
        self.assertEqual((self.repo / "a.txt").read_text(encoding="utf-8"), "a\n")
        profile, _report, notes = ip.finalize(self.repo, self.out, "HEAD", [])
        self.assertEqual([g["name"] for g in profile["gates"]], ["unit"])
        self.assertTrue(any("writes tracked files" in n for n in notes))

    def test_e2e_outputs_that_differ_lose_compare(self) -> None:
        gates = [_python_gate("unit", "print('ok')")]
        e2e = [dict(_python_gate("cli", "import uuid; print(uuid.uuid4())"), compare=True)]
        self.draft(gates, e2e, {"unit": "test"})
        ip.run_probe(self.repo, self.out)
        profile, _report, _notes = ip.finalize(self.repo, self.out, "HEAD", [])
        self.assertIs(profile["e2e"][0]["compare"], False)

    def test_no_test_gate_makes_report_only_and_probe_mismatch_is_refused(self) -> None:
        gates = [_python_gate("lint", "print('ok')")]
        self.draft(gates, [], {"lint": "lint"})
        ip.run_probe(self.repo, self.out)
        profile, _report, _notes = ip.finalize(self.repo, self.out, "HEAD", [])
        self.assertEqual(profile["mode"], "report-only")
        changed = [_python_gate("lint", "print('other')")]
        self.draft(changed, [], {"lint": "lint"})
        with self.assertRaises(ip.InferError) as ctx:
            ip.finalize(self.repo, self.out, "HEAD", [])
        self.assertIn("other gate definitions", str(ctx.exception))

    def test_probe_needs_a_clean_tree(self) -> None:
        self.draft([_python_gate("unit", "print(1)")], [], {"unit": "test"})
        (self.repo / "a.txt").write_text("dirty\n", encoding="utf-8")
        with self.assertRaises(ip.InferError):
            ip.run_probe(self.repo, self.out)

    def test_install_refusals_and_replacement(self) -> None:
        self.draft([_python_gate("unit", "print(1)")], [], {"unit": "test"})
        profile, _report, _notes = ip.finalize(self.repo, self.out, "HEAD", [])
        (self.out / "active").write_text("{}", encoding="utf-8")
        with self.assertRaises(ip.InstallRefused):
            ip.install_profile(self.repo, self.out, profile, "HEAD")
        (self.out / "active").unlink()
        (self.out / "profile.json").write_text(json.dumps({"version": 1}), encoding="utf-8")
        with self.assertRaises(ip.InstallRefused) as ctx:
            ip.install_profile(self.repo, self.out, profile, "HEAD")
        self.assertIn("owner profile", str(ctx.exception))
        previous = dict(profile)
        (self.out / "profile.json").write_text(json.dumps(previous), encoding="utf-8")
        target, digest, check = ip.install_profile(self.repo, self.out, profile, "HEAD")
        self.assertEqual(check.errors, [])
        self.assertTrue((self.out / ip.PREVIOUS_NAME).is_file())
        self.assertEqual(len(digest), 64)
        del target


class CliTests(RepoCase):
    def test_infer_cli_writes_outputs_outside_the_repo(self) -> None:
        self.write({"package.json": pkg("a", {"test": "vitest run"}), "package-lock.json": "{}\n",
                    "a.test.ts": "it('a', () => {});\n"})
        out = self.tmp / "out"
        out.mkdir()
        (out / "inventory.json").write_text("{}", encoding="utf-8")
        buf = io.StringIO()
        with mock.patch.object(ip.shutil, "which", fake_which()), \
                contextlib.redirect_stdout(buf):
            code = ip.main(["infer", "--repo", str(self.repo), "--out-dir", str(out),
                            "--now", NOW])
        self.assertEqual(code, 0, buf.getvalue())
        for name in (ip.REPORT_NAME, ip.DRAFT_NAME, ip.PROBE_CONFIG_NAME,
                     ip.INSTALL_CONFIG_NAME, ip.SETUP_CONFIG_NAME, ip.ENV_SCRIPT_NAME):
            self.assertTrue((out / name).is_file(), name)
        self.assertFalse((self.repo / ".harden").exists())
        draft = json.loads((out / ip.DRAFT_NAME).read_text(encoding="utf-8"))
        digest = ip.hashlib.sha256((out / ip.REPORT_NAME).read_bytes()).hexdigest()
        self.assertEqual(draft["origin"]["report_sha256"], digest)
        self.assertNotIn(b"\r", (out / ip.ENV_SCRIPT_NAME).read_bytes())

    def test_cli_exit_codes(self) -> None:
        self.write({"README.md": "# r\n"})
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ip.main(["infer", "--repo", str(self.repo), "--out-dir",
                                      str(self.tmp / "o")]), 2)
            self.assertIn("run inventory.py first", err.getvalue())
            self.assertEqual(ip.main(["infer", "--repo", str(self.tmp)]), 2)
            (self.repo / ".harden").mkdir()
            (self.repo / ".harden" / "active").write_text("{}", encoding="utf-8")
            self.assertEqual(ip.main(["infer", "--repo", str(self.repo)]), 2)
            self.assertEqual(ip.main(["finalize", "--repo", str(self.repo)]), 2)


# ---------------------------------------------------------------------------
# Offline e2e subcommands (pilot-auto-calibration A01-F57)
# ---------------------------------------------------------------------------

PILOT3_HELP = """Usage: pricewatch <command> [options]

Commands:
  value       Value the portfolio at current prices
  pnl         Realized and unrealized PnL from a trade export
  alerts      Evaluate the alert rules once and notify
  watch       Evaluate the alert rules repeatedly
  snapshot    Print the portfolio as a versioned JSON document
  plugins     List built-in notifier plugins and exchanges

Options:
  -c, --config <file>    Config file (default: pricewatch.config.json)
  -h, --help             Show this help
      --version          Print the version
"""

NOTES_CLI = """import { createClient } from './net.mjs';
import { listPlugins } from './plugins.mjs';
const COMMANDS = ['value', 'plugins'];
export async function main(argv) {
  const cmd = argv[0];
  if (cmd === '--version') { console.log('1.0.0'); return 0; }
  try {
    if (cmd === 'plugins') return await runPlugins();
    const client = createClient();
    switch (cmd) {
      case 'value': return await client.get('/v');
      default: return 2;
    }
  } catch (e) { console.error(String(e)); return 1; }
}
async function runPlugins() { for (const p of await listPlugins()) console.log(p); return 0; }
main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
"""
NOTES_NET = ("export function createClient() { return { get: (p) => "
             "fetch('http://127.0.0.1:9' + p) }; }\n")
NOTES_PLUGINS = "export async function listPlugins() { return ['console', 'webhook']; }\n"


class E2eDiscoveryTests(RepoCase):
    def closure(self, files: Dict[str, str]) -> Any:
        self.write(files)
        return ip.SubcommandClosure(self.repo, ".")

    def test_parse_help_reads_commands_and_version_flag(self) -> None:
        parsed = ip.parse_help(PILOT3_HELP, ["pricewatch", "cli.js"])
        self.assertEqual([c["name"] for c in parsed["commands"]],
                         ["value", "pnl", "alerts", "watch", "snapshot", "plugins"])
        self.assertIs(parsed["version_flag"], True)
        cases = [("Commands:\n  info [options]  show info\n  help [command]  display help",
                  ["info", "help"]),
                 ("Available Commands:\n  completion  Generate the autocompletion script",
                  ["completion"]),
                 ("Commands:\n  cli.js serve [port]  start the server", ["serve"])]
        for text, names in cases:
            with self.subTest(text=text):
                self.assertEqual([c["name"] for c in ip.parse_help(text, [])["commands"]], names)

    def test_parse_help_rejects_non_names(self) -> None:
        parsed = ip.parse_help("Commands:\n  rm -rf /  x\n  Plugins  y\n  $(curl x)  z", [])
        self.assertEqual(parsed["commands"], [])

    def test_permission_flags_by_node_version(self) -> None:
        for text in ("v24.13.0", "v22.13.0", "v23.5.0", "v26.10.0"):
            with self.subTest(version=text):
                self.assertEqual(ip.permission_flags(text),
                                 ["--permission", "--allow-fs-read=*"])
        for text in ("v22.12.0", "v23.4.0", "v20.19.0", "garbage"):
            with self.subTest(version=text):
                self.assertEqual(ip.permission_flags(text), [])

    def test_dispatch_sites_if_case_command_and_non_sites(self) -> None:
        text = ("if (cmd === 'plugins') return run();\n"
                "switch (cmd) { case 'list': return 1; }\n"
                "program.command('info').action(fn);\n"
                "const C = ['value'];\n"
                "if (cmd !== 'x') { y(); }\n")
        sites = {s["name"]: s for s in ip.find_sites(ip.JsFile("a.js", text))}
        self.assertEqual((sites["plugins"]["kind"], sites["plugins"]["terminates"]), ("K2", True))
        self.assertEqual((sites["list"]["kind"], sites["list"]["terminates"]), ("K1", True))
        self.assertEqual(sites["info"]["kind"], "K3")
        self.assertNotIn("value", sites)
        self.assertEqual(sites["x"]["kind"], "unsupported")

    def test_closure_clear_for_offline_branch_excluded_for_network_branch(self) -> None:
        closure = self.closure({"bin/cli.mjs": NOTES_CLI, "bin/net.mjs": NOTES_NET,
                                "bin/plugins.mjs": NOTES_PLUGINS})
        self.assertEqual(closure.classify("bin/cli.mjs", "plugins")["verdict"], "clear")
        value = closure.classify("bin/cli.mjs", "value")
        self.assertEqual(value["verdict"], "excluded")
        self.assertEqual(value["evidence"], "bin/net.mjs:1")
        self.assertIn("createClient", value["path"])

    def test_import_clause_names_are_not_references(self) -> None:
        closure = self.closure({"bin/cli.mjs": NOTES_CLI, "bin/net.mjs": NOTES_NET,
                                "bin/plugins.mjs": NOTES_PLUGINS})
        result = closure.classify("bin/cli.mjs", "plugins")
        self.assertEqual(result["verdict"], "clear", result["reason"])

    def test_non_terminating_case_includes_code_after_switch(self) -> None:
        cli = ("export function main(cmd) {\n  switch (cmd) {\n    case 'x': doX(); break;\n"
               "    case 'y': return 1;\n  }\n  fetch('http://127.0.0.1:9');\n}\n"
               "function doX() { return 1; }\nmain(process.argv[2]);\n")
        result = self.closure({"bin/cli.mjs": cli}).classify("bin/cli.mjs", "x")
        self.assertEqual(result["verdict"], "excluded")
        self.assertIn("N2", result["reason"])

    def test_dynamic_import_widens_to_module_scope(self) -> None:
        plugins = ("export async function listPlugins() { const file = './a.mjs'; "
                   "const m = await import(file); return [m.name]; }\n")
        files = {"bin/cli.mjs": NOTES_CLI, "bin/net.mjs": NOTES_NET, "bin/plugins.mjs": plugins}
        clear = self.closure(files).classify("bin/cli.mjs", "plugins")
        self.assertEqual(clear["verdict"], "clear", clear["reason"])
        self.assertTrue(any("dynamic import" in n for n in clear["incomplete"]))
        closure = self.closure({"bin/side.mjs": "fetch('http://127.0.0.1:9/x');\n"})
        result = closure.classify("bin/cli.mjs", "plugins")
        self.assertEqual(result["verdict"], "excluded")
        self.assertIn("bin/side.mjs", result["reason"])

    def test_writes_spawns_secret_env_and_network_packages_exclude(self) -> None:
        cases = {
            "WRITE": "import { writeFileSync } from 'node:fs';\nexport function main(cmd) {\n"
                     "  if (cmd === 'go') { writeFileSync('out.txt', 'x'); return 0; }\n"
                     "  return 1;\n}\nmain(process.argv[2]);\n",
            "child process": "import { spawn } from 'node:child_process';\n"
                             "export function main(cmd) {\n"
                             "  if (cmd === 'go') { spawn('ls'); return 0; }\n  return 1;\n}\n"
                             "main(process.argv[2]);\n",
            "S2": "export function main(cmd) {\n  if (cmd === 'go') { console.log("
                  "process.env.API_KEY); return 0; }\n  return 1;\n}\nmain(process.argv[2]);\n",
            "N2-package axios": "import axios from 'axios';\nexport function main(cmd) {\n"
                                "  if (cmd === 'go') { return axios.get('http://127.0.0.1:9'); }\n"
                                "  return 1;\n}\nmain(process.argv[2]);\n"}
        for index, (expected, text) in enumerate(cases.items()):
            with self.subTest(expected=expected):
                name = "bin/c{}.mjs".format(index)
                result = self.closure({name: text}).classify(name, "go")
                self.assertEqual(result["verdict"], "excluded")
                self.assertIn(expected, result["reason"])

    def test_state_and_user_state_exclude(self) -> None:
        state = ("import Database from 'better-sqlite3';\nexport function main(cmd) {\n"
                 "  if (cmd === 'go') { new Database('x.db'); return 0; }\n  return 1;\n}\n"
                 "main(process.argv[2]);\n")
        home = ("import os from 'node:os';\nexport function main(cmd) {\n"
                "  if (cmd === 'go') { console.log(os.homedir()); return 0; }\n  return 1;\n}\n"
                "main(process.argv[2]);\n")
        closure = self.closure({"bin/s.mjs": state, "bin/h.mjs": home})
        self.assertIn("local state module better-sqlite3",
                      closure.classify("bin/s.mjs", "go")["reason"])
        self.assertIn("per-user state", closure.classify("bin/h.mjs", "go")["reason"])

    def test_unreadable_closure_file_excludes(self) -> None:
        cli = ("import { big } from './big.mjs';\nexport function main(cmd) {\n"
               "  if (cmd === 'go') { return big(); }\n  return 1;\n}\nmain(process.argv[2]);\n")
        closure = self.closure({"bin/cli.mjs": cli,
                                "bin/big.mjs": "export function big() { return 1; }\n" +
                                "//" + "x" * (ip.MAX_FILE_BYTES + 1) + "\n"})
        result = closure.classify("bin/cli.mjs", "go")
        self.assertEqual(result["verdict"], "excluded")
        self.assertIn("cannot read", result["reason"])
        outside = self.tmp / "outside.mjs"
        outside.write_text("export function big() { return 1; }\n", encoding="utf-8")
        link = self.repo / "bin" / "link.mjs"
        try:
            os.symlink(str(outside), str(link))
        except OSError:
            return  # no symlink privilege on this machine
        linked = cli.replace("./big.mjs", "./link.mjs")
        (self.repo / "bin" / "cli2.mjs").write_text(linked, encoding="utf-8")
        result = ip.SubcommandClosure(self.repo, ".").classify("bin/cli2.mjs", "go")
        self.assertEqual(result["verdict"], "excluded")
        self.assertIn("cannot read", result["reason"])

    def test_closure_cap_excludes(self) -> None:
        chain = "".join("function f{}() {{ return f{}(); }}\n".format(i, i + 1)
                        for i in range(310))
        cli = chain + "function f310() { return 0; }\nexport function main(cmd) {\n" \
                      "  if (cmd === 'go') { return f0(); }\n  return 1;\n}\n" \
                      "main(process.argv[2]);\n"
        result = self.closure({"bin/cli.mjs": cli}).classify("bin/cli.mjs", "go")
        self.assertEqual(result["verdict"], "excluded")
        self.assertIn("cap", result["reason"])

    def discovery_repo(self, readme: str) -> Dict[str, Any]:
        self.write({
            "package.json": pkg("cli", {"test": "node --test", "cli": "node bin/cli.mjs"},
                                bin={"cli": "./bin/cli.mjs"}),
            "bin/cli.mjs": NOTES_CLI, "bin/net.mjs": NOTES_NET,
            "bin/plugins.mjs": NOTES_PLUGINS, "README.md": readme})
        return self.infer()

    def test_infer_lists_discovery_with_review_and_bans(self) -> None:
        readme = "# cli\n\n```sh\nnode bin/cli.mjs plugins\npnpm cli deploy\n```\n"
        report = self.discovery_repo(readme)
        entries = {e["name"]: e for e in report["e2e_discovery"]}
        self.assertIn("README.md:4", entries["plugins"]["sources"])
        self.assertEqual(entries["deploy"]["state"], "denylisted")
        self.assertTrue(any(r["id"] == "cli-subcommands" for r in report["review"]))
        review = {"drop": [], "forbid": [{"pattern": "/\\bnode\\s+\\S*cli\\.mjs\\b.*\\bvalue\\b/",
                                          "why": "value reaches the network",
                                          "evidence": "bin/cli.mjs:11"}]}
        banned = {e["name"]: e for e in self.infer(review=review)["e2e_discovery"]}
        self.assertEqual(banned["value"]["state"], "banned")
        review = {"drop": [{"name": "cli-plugins", "why": "owner said so",
                            "evidence": "bin/cli.mjs:8"}], "forbid": []}
        dropped = {e["name"]: e for e in self.infer(review=review)["e2e_discovery"]}
        self.assertEqual(dropped["plugins"]["state"], "dropped-by-review")

    def test_readme_arguments_are_not_replayed(self) -> None:
        report = self.discovery_repo("# cli\n\n```\nnode bin/cli.mjs plugins --out x.json\n```\n")
        entries = {e["name"]: e for e in report["e2e_discovery"]}
        self.assertEqual(entries["plugins"]["argv_tail"], ["plugins"])

    def test_denylist_matches_tokens(self) -> None:
        for name in ("db:migrate", "send-alert", "show-config"):
            with self.subTest(name=name):
                self.assertTrue(set(ip.name_tokens(name)) & ip.SUBCOMMAND_DENY)
        self.assertFalse(set(ip.name_tokens("plugins")) & ip.SUBCOMMAND_DENY)

    def test_browser_package_script_excluded_and_next_limits_line(self) -> None:
        self.write({
            "package.json": pkg("web", {"test": "node --test", "smoke": "node scripts/smoke.mjs",
                                        "routes": "node scripts/routes.mjs"},
                                dependencies={"next": "15.0.0"}),
            "scripts/smoke.mjs": "import { chromium } from 'playwright';\nconsole.log('ok');\n",
            "scripts/routes.mjs": "console.log('routes');\n"})
        report = self.infer()
        names = [e["name"] for e in report["e2e"]]
        self.assertNotIn("smoke", names)
        self.assertNotIn("routes", names)
        self.assertTrue(any("web app .: no offline route-probe script" in line
                            for line in report["limits"]), report["limits"])


DISCOVERY_CLI = """const HELP = `Usage: cli <command>

Commands:
  plugins   list plugins
  value     portfolio value
  sneaky    sneaky
  random    random
  help      show help
  alpha     alpha
  beta      beta
  gamma     gamma
  delta     delta
  epsilon   epsilon
  zeta      zeta
  eta       eta
  theta     theta

Options:
  --version  show the version`;
export async function main(argv) {
  const cmd = argv[0];
  if (cmd === '--help' || cmd === 'help') { console.log(HELP); return 0; }
  if (cmd === '--version') { console.log('1.0.0'); return 0; }
  if (cmd === 'plugins') { console.log('console\\nwebhook'); return 0; }
  if (cmd === 'sneaky') { const f = globalThis['fe' + 'tch']; try { await f('http://127.0.0.1:9/'); } catch {} console.log('ok'); return 0; }
  if (cmd === 'random') { console.log(Math.random()); return 0; }
  if (cmd === 'alpha') { console.log('A'); return 0; }
  if (cmd === 'beta') { console.log('B'); return 0; }
  if (cmd === 'gamma') { console.log('G'); return 0; }
  if (cmd === 'delta') { console.log('D'); return 0; }
  if (cmd === 'epsilon') { console.log('E'); return 0; }
  if (cmd === 'zeta') { console.log('Z'); return 0; }
  if (cmd === 'eta') { console.log('H'); return 0; }
  if (cmd === 'theta') { console.log('T'); return 0; }
  if (cmd === 'about') { console.log('apiKey: abc123'); return 0; }
  if (cmd === 'value') { return await fetch('http://127.0.0.1:9/v'); }
  return 2;
}
main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
"""


@unittest.skipUnless(shutil.which("node"), "node is needed")
class DiscoveryProbeTests(RepoCase):
    """probe runs the discovered subcommands under the offline guard; finalize keeps the
    clean ones (pilot-auto-calibration A01-F57)."""

    draft = ProbeFinalizeTests.draft

    def setUp(self) -> None:
        super().setUp()
        self.write({"a.txt": "a" + chr(10), "README.md": "# r" + chr(10),
                    "package.json": pkg("cli", {}, bin={"cli": "./bin/cli.mjs"}),
                    "bin/cli.mjs": DISCOVERY_CLI})
        self.out = self.repo / ".harden"
        self.out.mkdir()

    def entry(self, name: str, **extra: Any) -> Dict[str, Any]:
        item = {"bin": "cli", "help_check": "cli-help", "pkg_dir": ".", "entry": "bin/cli.mjs",
                "entry_repo": "bin/cli.mjs", "source": "bin/cli.mjs", "name": name,
                "argv_tail": [name], "sources": ["bin/cli.mjs:1"], "state": "pending",
                "reason": "", "build_gate": None, "scripts": [], "pm": "npm"}
        item.update(extra)
        return item

    def setup_discovery(self, names: List[str], gates: Optional[List[Dict[str, Any]]] = None,
                        help_cmd: Optional[List[str]] = None, **entry_extra: Any) -> None:
        gates = gates or [_python_gate("unit", "print('1 passed')", count_regex="(\\d+) passed")]
        e2e = [{"name": "cli-help", "cmd": help_cmd or ["node", "bin/cli.mjs", "--help"],
                "cwd": ".", "timeout_s": 60, "compare": True, "inherit_env": False,
                "env_allowlist": sorted(os.environ)}]
        self.draft(gates, e2e, {g["name"]: "test" for g in gates})
        report = json.loads((self.out / ip.REPORT_NAME).read_text(encoding="utf-8"))
        report["e2e_discovery"] = [self.entry(n, **entry_extra) for n in names]
        (self.out / ip.REPORT_NAME).write_text(json.dumps(report), encoding="utf-8")

    def run_all(self) -> Any:
        ip.run_probe(self.repo, self.out)
        return ip.finalize(self.repo, self.out, "HEAD", [])

    def test_discovered_subcommands_added_after_two_equal_guarded_runs(self) -> None:
        self.setup_discovery(["plugins", "value", "sneaky", "random"])
        profile, _report, _notes = self.run_all()
        self.assertEqual([e["name"] for e in profile["e2e"]],
                         ["cli-help", "cli-plugins", "cli-version"])
        plugins = profile["e2e"][1]
        self.assertEqual(plugins["cmd"], ["node", "--require", ip.GUARD_PATH, "bin/cli.mjs",
                                          "plugins"])
        self.assertEqual(plugins["env"], {"NODE_OPTIONS": ""})
        self.assertIs(plugins["compare"], True)
        self.assertIn("guarded runs 2/2", profile["provenance"]["e2e.cli-plugins"][0]["detail"])
        self.assertEqual(vp.check_document(profile).errors, [])
        for check in profile["e2e"]:
            vb.validate_definition(vb.CheckDef(check["name"], "e2e", "profile", check),
                                   self.repo, {"inherit_env": False, "env_allowlist": []})

    def test_guard_refusal_drops_a_statically_clear_subcommand(self) -> None:
        self.setup_discovery(["sneaky"])
        profile, report, notes = self.run_all()
        self.assertNotIn("cli-sneaky", [e["name"] for e in profile["e2e"]])
        text = " ".join(notes + report["limits"])
        self.assertIn("offline guard refused fetch", text)

    def test_unstable_output_and_static_exclusion_not_added(self) -> None:
        self.setup_discovery(["random", "value"])
        _profile, report, _notes = self.run_all()
        states = {e["name"]: e for e in report["e2e_discovery"]}
        self.assertIn("outputs differ", states["random"]["reason"])
        self.assertEqual(states["value"]["state"], "excluded-static")
        config = json.loads((self.out / ip.E2E_MORE_CONFIG_NAME).read_text(encoding="utf-8"))
        self.assertNotIn("cli-value", [g["name"] for g in config["gates"]])

    def test_cap_three_per_bin(self) -> None:
        self.setup_discovery(["alpha", "beta", "gamma", "delta", "epsilon"])
        profile, report, _notes = self.run_all()
        added = [e["name"] for e in profile["e2e"] if e["name"] != "cli-help"]
        self.assertEqual(len(added), 3)
        self.assertTrue(any("cap: 3 per CLI" in line for line in report["limits"]))

    def test_probe_caps_candidates(self) -> None:
        self.setup_discovery(["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta",
                              "theta"])
        ip.run_probe(self.repo, self.out)
        disc = json.loads((self.out / ip.DISCOVERY_NAME).read_text(encoding="utf-8"))
        probed = [e for e in disc["entries"] if e.get("probe_name")]
        self.assertLessEqual(len(probed), ip.E2E_PROBE_PER_BIN)
        self.assertTrue(any("probe cap" in (e.get("reason") or "") for e in disc["entries"]))

    def test_same_as_help_not_added(self) -> None:
        self.setup_discovery(["help"])
        _profile, report, _notes = self.run_all()
        states = {e["name"]: e for e in report["e2e_discovery"]}
        self.assertEqual(states["help"]["reason"], "same output as --help")

    def test_secret_looking_output_not_added(self) -> None:
        self.setup_discovery(["about"], sources=["README.md:1"])
        _profile, report, _notes = self.run_all()
        states = {e["name"]: e for e in report["e2e_discovery"]}
        self.assertEqual(states["about"]["reason"], "output looks like a secret")

    def test_probe_config_uses_permission_flags_but_profile_does_not(self) -> None:
        self.setup_discovery(["plugins"])
        with mock.patch.object(ip, "permission_flags",
                               return_value=["--permission", "--allow-fs-read=*"]):
            profile, _report, _notes = self.run_all()
        config = json.loads((self.out / ip.E2E_MORE_CONFIG_NAME).read_text(encoding="utf-8"))
        self.assertTrue(any("--permission" in g["cmd"] for g in config["gates"]))
        persisted = [e for e in profile["e2e"] if e["name"] == "cli-plugins"][0]
        self.assertNotIn("--permission", persisted["cmd"])

    def test_persisted_form_is_the_probed_form(self) -> None:
        self.setup_discovery(["plugins"])
        profile, _report, _notes = self.run_all()
        config = json.loads((self.out / ip.E2E_MORE_CONFIG_NAME).read_text(encoding="utf-8"))
        probed = [g for g in config["gates"] if g["name"] == "cli-plugins"][0]
        persisted = [e for e in profile["e2e"] if e["name"] == "cli-plugins"][0]
        self.assertEqual(probed["cmd"], persisted["cmd"])

    def test_discovered_check_matching_a_ban_is_dropped_not_fatal(self) -> None:
        self.setup_discovery(["plugins"])
        ip.run_probe(self.repo, self.out)
        draft = json.loads((self.out / ip.DRAFT_NAME).read_text(encoding="utf-8"))
        draft["forbidden_commands"].append("/\\bplugins\\b/")
        (self.out / ip.DRAFT_NAME).write_text(json.dumps(draft), encoding="utf-8")
        profile, report, _notes = ip.finalize(self.repo, self.out, "HEAD", [])
        states = {e["name"]: e for e in report["e2e_discovery"]}
        self.assertIn("matches ban", states["plugins"]["reason"])
        self.assertNotIn("cli-plugins", [e["name"] for e in profile["e2e"]])
        ip.install_profile(self.repo, self.out, profile, "HEAD")

    def test_help_check_dropped_drops_its_subcommands(self) -> None:
        self.setup_discovery(["plugins"], help_cmd=["node", "bin/cli.mjs", "--nope"])
        profile, report, _notes = self.run_all()
        self.assertNotIn("cli-plugins", [e["name"] for e in profile["e2e"]])
        states = {e["name"]: e for e in report["e2e_discovery"]}
        self.assertIn(states["plugins"]["state"], ("not-probed", "not-added"))

    def test_new_untracked_file_blocks_discovery(self) -> None:
        self.setup_discovery(["plugins"])
        calls: List[int] = []
        real = ip._untracked_paths

        def growing(root: Path) -> set:
            calls.append(1)
            found = set(real(root))
            return found | {"stray.txt"} if len(calls) > 1 else found

        with mock.patch.object(ip, "_untracked_paths", side_effect=growing):
            profile, report, _notes = self.run_all()
        self.assertNotIn("cli-plugins", [e["name"] for e in profile["e2e"]])
        self.assertTrue(any("new untracked file stray.txt" in line
                            for line in report["limits"]))

    def test_stale_build_skips_discovery(self) -> None:
        gates = [_python_gate("unit", "print('1 passed')", count_regex="(\\d+) passed"),
                 _python_gate("build", "import sys; sys.exit(1)")]
        self.setup_discovery(["plugins"], gates=gates, build_gate="build")
        _profile, report, _notes = self.run_all()
        states = {e["name"]: e for e in report["e2e_discovery"]}
        self.assertIn("build gate build not green", states["plugins"]["reason"])

    def test_finalize_ignores_e2e_more_record_in_generic_loop(self) -> None:
        self.setup_discovery(["plugins"])
        ip.run_probe(self.repo, self.out)
        self.assertTrue((self.out / "gates" / (ip.PROBE_E2E_MORE_LABEL + ".json")).exists())
        ip.finalize(self.repo, self.out, "HEAD", [])


if __name__ == "__main__":
    unittest.main()
