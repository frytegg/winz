# MODULES.md — the Python package, its public functions and its dependency graph

Python >= 3.11, standard library only (dev B's machine runs it as is: no pip, no `tzdata` assumption). Type hints on
every function, `from __future__ import annotations` in every module, dataclasses for structured values, `pathlib`
for paths, the exception hierarchy of `errors.py`, JSON-lines logging to stderr through `log.py`, machine output
only through `envelope.py`. Never `print` for logs. Never swallow an exception: catch only to add context and
re-raise, or (hooks only) to fail open after logging. All randomness is `random.Random(seed)`; all clocks come from
`clock.utcnow(ctx)`.

---

## 1. Layout

```
scripts/
  exec.py                  thin entry (below)
  execlib/
    __init__.py            VERSION = "1.0.0"; CONTRACT = "execution/1"
    errors.py  log.py  clock.py  paths.py  jsonio.py  model.py           (layer 0)
    schema.py  procutil.py  globs.py  resources.py  graph.py             (layer 1)
    locks.py  envelope.py  gitutil.py                                    (layer 2)
    events.py  state.py                                                  (layer 3)
    plan.py  statusio.py  decisionsio.py  nevershow.py                   (layer 4)
    validate.py  templates.py  catalogue.py  status.py                   (layer 5)
    decisions.py  results.py  integrity.py  hardenbridge.py  quota.py
    governor.py  due.py  schedule.py  wavejs.py                          (layer 6)
    reconcile.py  proof.py  amend.py  answers.py  manual.py  briefs.py
    planning.py  agents.py                                               (layer 7)
    merge.py  wave.py  notion.py  report.py  completion.py  ingest.py
    initcmd.py  preflight.py  syncstate.py  hooksinstall.py
    heartbeat.py  replay.py  fixture.py  fixmode.py                      (layer 8)
    hardenready.py  resume.py                                            (layer 9)
    handover.py                                                          (layer 10)
    cli.py                 argparse surface + lazy dispatch              (top; no import-time edges)
    hookcore.py            standalone, stdlib only, imported only by scripts/hooks/*.py
  hooks/
    py.sh                  fail-open launcher (copy of ~/.claude/hooks/py.sh with `-S`)
    stop_gate.py  session_start.py  session_end.py  stop_failure.py  pre_tool_guard.py  user_prompt.py
  tests/
    _support.py            shared helpers (temp git repos with a bare origin, fixed clock, doc builders)
    fixtures/<lane>/...    per-lane fixtures (LANES.md)
    js/wave-harness.mjs    runs a generated wave script under Node with a fake agent()
    test_*.py              unittest, run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
    e2e/test_*.py          end-to-end on the fixture (slow; LANES.md L11)
```

`exec.py`:
```python
#!/usr/bin/env python3
"""/execution command line. See contract/CLI.md."""
from __future__ import annotations
import sys
if sys.version_info < (3, 11):
    sys.stdout.write('{"ok":false,"command":"","data":null,"errors":[{"code":"E_PYTHON","message":"Python >= 3.11 required"}]}\n')
    raise SystemExit(3)
from pathlib import Path
# Pipes default to the ANSI code page (cp1252) on Windows: the envelope carries French text (summary_fr, push_text_fr).
sys.stdout.reconfigure(encoding="utf-8", newline="\n")
sys.stderr.reconfigure(encoding="utf-8", newline="\n")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from execlib.cli import main  # noqa: E402
raise SystemExit(main(sys.argv[1:]))
```

---

## 2. Shared types (layer 0)

### `errors.py`
```python
@dataclass(frozen=True)
class ErrorItem:
    code: str                      # ^[EW]_[A-Z0-9_]{2,40}$
    message: str
    path: str | None = None        # file, JSON pointer or file:line
    task: str | None = None
    hint: str | None = None
    def to_dict(self) -> dict[str, str]: ...

class ExecError(Exception):
    exit_code: int = 3
    default_code: str = "E_INTERNAL"
    def __init__(self, message: str, *, code: str | None = None, items: list[ErrorItem] | None = None,
                 hint: str | None = None, data: dict | None = None) -> None: ...
    def items(self) -> list[ErrorItem]: ...          # self.items_ or [ErrorItem(code, message, hint=hint)]

class UsageError(ExecError):        exit_code = 2; default_code = "E_USAGE"
class CheckFailed(ExecError):       exit_code = 1; default_code = "E_CHECK"
class ValidationFailed(CheckFailed):               default_code = "E_SCHEMA"
class CasRejected(CheckFailed):                    default_code = "E_CAS_REJECTED"
class DependencyMissing(CheckFailed):              default_code = "E_DEPENDENCY_MISSING"   # data carries proposal id
class EnvError(ExecError):          exit_code = 3; default_code = "E_ENV"
class GitError(EnvError):                          default_code = "E_GIT"
class LockTimeout(EnvError):                       default_code = "E_LOCK_TIMEOUT"
class InternalError(ExecError):     exit_code = 3; default_code = "E_INTERNAL"
class PolicyRefused(ExecError):     exit_code = 4; default_code = "E_POLICY"
class TransitionRefused(PolicyRefused):            default_code = "E_TRANSITION_REFUSED"
class ImmutableFile(PolicyRefused):                default_code = "E_IMMUTABLE"
```

### `log.py`
```python
def get_logger(module: str) -> logging.Logger                    # e.g. get_logger("execlib.merge")
def configure(level: str = "info") -> None                       # once, from cli.main; JsonLinesFormatter to stderr
class JsonLinesFormatter(logging.Formatter)                       # {"ts": "...Z", "level": "info", "module": ..., "msg": ..., **record.data}
def redact(text: str) -> str                                     # masks private-key, mnemonic, bearer and API-key shapes
```
Every line: `ts` (UTC, milliseconds, Z), `level` (error|warning|info|debug), `module`, `msg`, plus the `data` dict
passed as `extra={"data": {...}}`. Never a secret, never an env value, never matched never-show text.

### `clock.py`
```python
@dataclass(frozen=True)
class ZoneSpec: label: str; iana: str; fallback_utc_offset_min: int
def utcnow(override: str | None = None) -> datetime                 # aware UTC; override = --now, or EXEC_NOW only when EXEC_TEST=1 (else W_CLOCK_OVERRIDE logged, system clock)
def is_overridden() -> bool                                          # True when the last utcnow() used an override (digest "clock: override")
def parse_utc(text: str) -> datetime                                 # strict ...Z; UsageError otherwise
def format_utc(dt: datetime) -> str                                  # YYYY-MM-DDTHH:MM:SSZ
def format_utc_precise(dt: datetime) -> str                          # with microseconds, for events
def from_epoch(seconds: int | float) -> datetime
def stamp(dt: datetime) -> str                                       # YYYYMMDDTHHMMSSZ (run ids, batch ids)
def display(dt: datetime, zones: Sequence[ZoneSpec]) -> tuple[dict[str, str], list[ErrorItem]]
    # {"SGT": "Wed 7 Oct 23:59 SGT", "Paris": "Wed 7 Oct 17:59 Paris"}; W_TZ_FALLBACK when zoneinfo lacks data
def minutes_between(a: datetime, b: datetime) -> float
```

### `paths.py`
```python
SKILL_DIR: Path                                                    # Path(__file__).resolve().parents[2]
def skill_path(*parts: str) -> Path
def other_skill(name: Literal["frontend", "harden", "hackathon"]) -> Path    # ~/.claude/skills/<name>
def posix(p: Path) -> str                                          # forward slashes, drive letter kept
def exec_cmd() -> str                                              # 'python "<SKILL_DIR posix>/scripts/exec.py"' for this machine (every recovery string)
def resolve_repo(cwd: Path, override: str | None) -> Path
    # the main working tree: parent of `git rev-parse --path-format=absolute --git-common-dir` (a linked worktree
    # resolves to its main repository); UsageError inside .execution/
@dataclass(frozen=True)
class Layout:                                                      # every path of SCHEMAS.md 1.1
    repo: Path | None; state: Path
    plan: Path; plan_candidate: Path; planner_draft: Path; profile: Path; policy: Path; catalogue_default: Path
    events: Path; decisions: Path; gates_json: Path; completion_script: Path; execution_md: Path
    local: Path; local_state: Path; active: Path; hooks_state: Path; hook_events_dir: Path; hook_errors: Path
    merge_pending_dir: Path; timings: Path
    def proof_run_copy(self, task: str, run_id: str) -> Path         # proofs/runs/<task>/<run_id>.json (tracked)
    def impl_copy(self, task: str, attempt: int) -> Path             # proofs/impl/<task>.a<n>.json (tracked)
    def merge_copy(self, task: str, attempt: int) -> Path            # proofs/merge/<task>.a<n>.json (tracked)
    def merge_intent(self, task: str, attempt: int, rerun: int) -> Path
    def status(self, executor: str) -> Path
    def receipt(self, task: str) -> Path
    def receipt_history(self, task: str, attempt: int) -> Path
    def result(self, wave: str, task: str | None, role: str, attempt: int) -> Path
    def inbox(self, wave: str) -> Path
    def proof_run_dir(self, task: str, run_id: str) -> Path
    def merge_gates_dir(self, task: str, attempt: int, rerun: int) -> Path   # local/merge-gates/<task>-a<n>r<k>/gates
    def answer(self, key: str) -> Path
    def wave_script(self, wave: str) -> Path
    def wave_manifest(self, wave: str) -> Path
    def brief(self, task: str, attempt: int) -> Path
    def report(self, wave: str) -> Path
    def lock(self, name: str) -> Path
    def notion_batch(self, batch_id: str) -> Path
    notion_outbox: Path; harden_ready_dir: Path; completion_dir: Path; schedule_cache: Path; digest: Path
def layout_for(repo: Path | None, state: Path | None) -> Layout
def scratch_dir(profile: dict, project: str, *parts: str) -> Path  # never inside a git work tree (checked)
```

### `jsonio.py`
```python
def read_json(path: Path) -> Any                                   # UTF-8; a BOM is stripped with W_BOM logged
def write_json_atomic(path: Path, obj: Any, *, sort_keys: bool = True, indent: int = 2) -> None
    # temp file in the same dir, LF, final newline, os.replace; parents created. Windows: os.replace onto a file
    # another process holds open (the hooks read state files on every agent tool call; Python opens without
    # FILE_SHARE_DELETE) raises PermissionError (WinError 5/32): retried 10 times with backoff 20, 40, ... capped at
    # 200 ms (about 1.5 s in all), then EnvError(E_ENV); the temp file is removed on failure.
def write_text_atomic(path: Path, text: str) -> None               # refuses \r; LF only; same retry
def read_json_retry(path: Path) -> Any                              # read_json with the same bounded retry on PermissionError (a reader racing os.replace)
def canonical_bytes(obj: Any) -> bytes                             # SCHEMAS.md 1.4
def sha256_bytes(b: bytes) -> str
def sha256_file(path: Path) -> str
def sha256_json(obj: Any) -> str
def append_jsonl(path: Path, obj: Any) -> None
    # one os.write of canonical bytes + b"\n", O_APPEND, fsync. Only for files with a single writer at a time (callers
    # hold the state or notion lock): O_APPEND through the MSVC CRT is seek-then-write, not atomic across processes.
    # Concurrent writers (hooks) never append: they write one file per event (MODULES 6).
def read_jsonl(path: Path) -> Iterator[tuple[int, dict | ErrorItem]]   # line number, document or E_JSONL_LINE
```

### `model.py`
Frozen dataclasses built from validated JSON, used for computation; documents stay dicts on disk (`to_dict()`
reproduces the schema shape exactly).
```python
@dataclass(frozen=True) class Estimate: p10: float; p50: float; p90: float; source: str
@dataclass(frozen=True) class Requirement: id: str; title: str; priority: str; required: bool; group: str | None; surface: str; status_expected: str | None
@dataclass(frozen=True) class Lane: id: str; executor: str; globs: tuple[str, ...]; contract: bool
@dataclass(frozen=True) class Deadline: id: str; at: datetime; kind: str; irrecoverable: bool; gate_phase: str
@dataclass(frozen=True) class Task:
    id: str; num: int; title: str; kind: str; phase: str; owner: str; executor: str; lane: str | None
    depends_on: tuple[str, ...]; covers: tuple[str, ...]; priority: str; required: bool
    writes: tuple[str, ...]; resources: tuple[str, ...]; estimate: Estimate
    model: str | None; effort: str | None; release: datetime | None; deadline: datetime | None
    anchor: dict | None; template: str | None; proof: dict; manual: dict | None; max_attempts: int; raw: dict
    @property def is_agent(self) -> bool
    @property def is_human(self) -> bool
@dataclass(frozen=True) class PlanModel:
    raw: dict; version: int; approved: bool; tasks: tuple[Task, ...]; by_id: Mapping[str, Task]
    requirements: tuple[Requirement, ...]; lanes: tuple[Lane, ...]; deadlines: tuple[Deadline, ...]
    protected: tuple[str, ...]
    @staticmethod def from_raw(raw: dict) -> PlanModel
@dataclass(frozen=True) class TaskState: status: str; since: datetime; attempts: int; reruns: int; raw: dict
@dataclass(frozen=True) class Ctx:
    layout: Layout; executor: str | None; now: datetime; by: str; pretty: bool; command: str; log: logging.Logger
@dataclass class CommandResult:
    data: dict | None; warnings: list[ErrorItem] = field(default_factory=list); exit_code: int = 0
    errors: list[ErrorItem] = field(default_factory=list)       # for exit 1 results that are data, not exceptions
```

---

## 3. Layer 1-3 (core)

### `schema.py` — the internal JSON Schema subset validator
```python
SUPPORTED: frozenset[str]          # the keyword list below
@dataclass(frozen=True) class SchemaIssue: instance_path: str; schema_path: str; keyword: str; message: str
@dataclass(frozen=True) class ExternalCheck: instance_path: str; skill: str; rel_path: str; on_missing: str; relation: str | None
@dataclass(frozen=True) class Report:
    issues: tuple[SchemaIssue, ...]; externals: tuple[ExternalCheck, ...]
    @property def ok(self) -> bool
class Registry:
    def __init__(self, schema_dir: Path = SKILL_DIR / "assets/schemas") -> None
    def get(self, name: str) -> dict                      # "plan" or "plan.schema.json"; loads, checks keywords
    def resolve(self, ref: str, base_name: str) -> tuple[dict, str]   # local "#/..." or "<file>#/<pointer>"
def default_registry() -> Registry                         # cached per process
def validate(instance: Any, name: str, *, registry: Registry | None = None) -> Report
def check(instance: Any, name: str, *, what: str) -> None  # raises ValidationFailed with one ErrorItem per issue
def validate_with(instance: Any, schema: dict, *, base_dir: Path) -> Report     # another skill's schema file
def run_externals(instance: Any, report: Report) -> tuple[list[SchemaIssue], list[ExternalCheck]]
    # validates against each x-external schema that exists; returns (issues, missing) — the caller decides
    # (plan-time commands: missing frontend profile schema = DependencyMissing; never a silent pass)
def bundle(name: str) -> dict                               # inline every $ref (for an agent() schema option)
```
Supported keywords, with these exact semantics (Draft 2020-12 subset):
- Annotations ignored: `$schema`, `$id` (registry key = file name), `$comment`, `title`, `description`, `default`,
  `examples`, any `x-*` other than `x-external`.
- `$defs`; `$ref` (alone or with siblings, siblings also apply) to `#<pointer>` or `<file>.schema.json#<pointer>`,
  resolved by file name in the schema directory, any JSON pointer depth (e.g. `#/$defs/task/properties/verify`),
  with `~0`/`~1` unescaping. A cycle of refs is caught by a depth limit (64) → E_SCHEMA_DEPTH.
- `type` (string or array): `null`, `boolean`, `object`, `array`, `string`, `integer` (int and not bool, or a float
  with no fractional part), `number` (int or float, never bool).
- `enum`, `const`: JSON equality — `True != 1`, `1 == 1.0`, objects by keys and values, arrays by order.
- `properties`, `required`, `additionalProperties` (bool or schema; applies to keys matched by neither
  `properties` nor `patternProperties`), `patternProperties`, `propertyNames`, `minProperties`, `maxProperties`.
- `items` (one schema for all items), `minItems`, `maxItems`, `uniqueItems` (JSON equality).
- `minLength`, `maxLength` (code points), `pattern` (Python `re`, compiled once, `re.search` semantics; every pattern
  in our schemas is anchored), `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`.
- `allOf`, `anyOf`, `oneOf` (exactly one), `not`, `if`/`then`/`else`.
- `x-external: {skill, path, on_missing, relation?}`: collected into `Report.externals`, never validated inline.
- Any other keyword in one of our schemas: E_SCHEMA_KEYWORD at registry load (a test loads them all). In another
  skill's schema: W_SCHEMA_UNSUPPORTED_KEYWORD naming it, and the keyword is skipped (reported, not silent).
- Issues are sorted by (instance_path, schema_path); `anyOf`/`oneOf` failures report the branch with the fewest
  issues. Messages name the instance path as a JSON pointer.

### `procutil.py`
```python
@dataclass(frozen=True) class RunResult: argv: list[str] | str; exit_code: int | None; stdout: str; stderr: str; timed_out: bool; duration_s: float
def run(argv: list[str] | str, *, cwd: Path, timeout_s: float, env: Mapping[str, str] | None = None,
        shell: Literal["none", "bash", "cmd"] = "none", input_text: str | None = None) -> RunResult
    # stdin DEVNULL unless input_text; output decoded UTF-8 with replacement; on timeout the whole tree is killed
    # (Windows: taskkill /T /F; POSIX: process group SIGTERM then SIGKILL); bash = Git Bash located explicitly,
    # never C:/Windows/System32/bash.exe
def powershell(script: str, *, timeout_s: float = 30) -> RunResult      # powershell.exe -NoProfile -NonInteractive -Command
def pid_alive(pid: int) -> bool                                         # ctypes OpenProcess+GetExitCodeProcess on Windows; never os.kill there
def process_created(pid: int) -> int | None                              # creation time (Windows GetProcessTimes FILETIME; POSIX /proc start time); None when gone
def holder_alive(pid: int, created: int | None) -> bool                  # pid alive AND same creation time (a reused pid is not the holder)
def which(name: str) -> Path | None                                      # PATHEXT-aware
def python_exe() -> str                                                  # sys.executable
```

### `globs.py`, `resources.py`
```python
def normalize(glob: str) -> str
def matches(glob: str, path: str) -> bool
def intersects(a: str, b: str) -> bool                     # SCHEMAS.md 7.1, conservative
def contains(outer: str, inner: str) -> bool               # SCHEMAS.md 7.2, conservative
def overlapping(a: Sequence[str], b: Sequence[str]) -> list[tuple[str, str]]
def is_manifest_glob(glob: str) -> bool                    # SCHEMAS.md 7.3
@dataclass(frozen=True) class Resource: kind: str; name: str | None
ORDERED: frozenset[str] = frozenset({"manifest", "wallet", "db"})
SERIALIZED: frozenset[str] = frozenset({"browser", "disk-heavy", "port", "human"})
def parse(resource: str) -> Resource
def ordered_conflicts(a: Sequence[str], b: Sequence[str]) -> list[str]
def serialized_conflicts(a: Sequence[str], b: Sequence[str]) -> list[str]
```

### `locks.py`
```python
LOCK_ORDER: tuple[str, ...] = ("merge", "plan", "git-state", "state", "notion")
TIMEOUTS_S: Mapping[str, float]; STALE_S: Mapping[str, float]       # CLI.md 0.3
@contextmanager
def hold(layout: Layout, name: str, *, command: str, timeout_s: float | None = None) -> Iterator[None]
    # O_CREAT|O_EXCL lock file with {pid, process_created, host, command, acquired_utc}; re-entrant per process;
    # acquiring a lock that precedes one already held raises InternalError(E_LOCK_ORDER); broken only when the holder
    # is dead (procutil.holder_alive false); a live holder older than STALE_S logs W_LOCK_OLD and is waited for
def is_held(name: str) -> bool
```

### `envelope.py`
```python
def emit(envelope: dict, *, pretty: bool) -> None                 # the only writer of stdout
def run(command: str, fn: Callable[[], CommandResult], *, pretty: bool) -> int
    # calls fn; maps ExecError subclasses to exit codes, any other exception to E_INTERNAL exit 3 (logged with
    # traceback, never swallowed); builds {ok, command, data, errors, warnings, exit_code, contract} and validates it
    # against envelope.schema.json before printing
```

### `gitutil.py`
```python
@dataclass(frozen=True) class RebaseOutcome: ok: bool; conflicts: tuple[str, ...]
@dataclass(frozen=True) class PushOutcome: ok: bool; rejected_non_ff: bool; stderr_tail: str
class Git:
    def __init__(self, cwd: Path, *, timeout_s: float = 120) -> None
    def run(self, *args: str, check: bool = True) -> RunResult            # GitError on non-zero when check
    def head(self) -> str | None
    def rev_parse(self, ref: str) -> str
    def fetch(self, remote: str = "origin") -> None
    def is_ancestor(self, a: str, b: str) -> bool
    def status_porcelain(self) -> list[str]                               # --porcelain=v1 --untracked-files=all
    def changed_paths(self, base: str, head: str) -> list[str]
    def commit_messages(self, base: str, head: str) -> list[tuple[str, str]]
    def added_lines(self, base: str, head: str) -> Iterator[tuple[str, int, str]]
    def rebase(self, onto: str) -> RebaseOutcome                          # aborts itself on conflict
    def push_head(self, branch: str = "main") -> PushOutcome              # never --force, never a +refspec
    def ff(self, branch: str, to: str) -> None
    def commit_paths(self, paths: Sequence[str], message: str, *, scratch: Path) -> str
        # message written to a file, `git commit -F file -- <paths>`; refuses a message with an attribution trailer
    def exclude_add(self, line: str) -> bool                              # .git/info/exclude, once
    def ls_files(self, *pathspec: str) -> list[str]
    def untracked(self) -> list[str]
    def config_get(self, key: str) -> str | None
    def config_set(self, key: str, value: str) -> None
    def clone_no_local(self, dest: Path) -> Git                           # -c core.longpaths=true clone --no-local --config core.longpaths=true; fetches refs/exec/*
    def checkout(self, sha: str) -> None
    def worktrees(self) -> list[Path]
    def worktree_remove_link_safe(self, path: Path) -> None               # remove junctions/symlinks first
    def common_dir_root(self) -> Path                                     # parent of --git-common-dir (the main working tree)
    def push_sha(self, sha: str, branch: str = "main") -> PushOutcome     # git push origin <sha>:refs/heads/<branch>; never --force
    def resync_to_origin(self) -> dict                                    # `reset --mixed origin/main` only when local main is an ancestor of it; files untouched
def remote_is_private(remote: str) -> bool | None                         # gh repo view --json visibility,isPrivate; local paths and file:// are private; None = unknown
FORBIDDEN_ARGS: frozenset[str]                                            # --force, -f with push, filter-branch, ...
```

### `events.py`
```python
def append(ctx: Ctx, type_: str, data: dict, *, actor: str | None = None, event_id: str | None = None) -> dict
    # requires locks.is_held("state"); validates against event.schema.json; seq from local state
def read_all(layout: Layout, *, since: datetime | None = None) -> tuple[list[dict], list[ErrorItem]]
    # sorted by (ts, executor, seq), deduplicated by id
def actor_for(ctx: Ctx) -> str                                            # exec:<command>@<executor> or agent:<role>@<executor>
```

### `state.py`
```python
RUN_TRANSITIONS: Mapping[str, frozenset[str]]
    # INIT→PREFLIGHT→INGEST→PLAN→AWAIT_APPROVAL→RUNNING; RUNNING⇄{AWAITING_HUMAN, AWAITING_DECISION, PAUSED_QUOTA,
    # PAUSED_RESOURCES, STUCK}; RUNNING→BUILD_COMPLETE→HANDED_OVER→FIX→RUNNING; BUILD_COMPLETE→RUNNING (reason
    # amendment:<version>: new work after a convergence pass or a reassignment); RUNNING→HANDED_OVER (handover --final,
    # reason deliverables complete); any non-terminal→STUCK; STUCK→RUNNING; PLAN→PLAN and AWAIT_APPROVAL→PLAN
    # (re-plan before approval)
def load(layout: Layout) -> dict                                   # validates local-state; E_STATE_INVALID
def save(ctx: Ctx, st: dict) -> None                               # requires the state lock
def default(executor: str, project: str, now: datetime) -> dict
def set_run_state(ctx: Ctx, st: dict, to: str, reason: str) -> None   # TransitionRefused outside RUN_TRANSITIONS; event run.state
def read_active(layout: Layout) -> dict | None
def write_active(layout: Layout, marker: dict) -> None
def read_hooks_state(layout: Layout) -> dict                        # defaults when absent
```

---

## 4. Layers 4-6 (documents and engines)

### `plan.py`
```python
def load_raw(layout: Layout) -> dict                               # schema-checked
def load(layout: Layout) -> PlanModel
def save(ctx: Ctx, raw: dict) -> None                              # requires the plan lock; refuses approved plans unless called by amend/decisions (flag)
def plan_digest(raw: dict) -> str                                  # SCHEMAS.md 1.4
def proof_digest(task_raw: dict) -> str
def max_id_num(raw: dict) -> int
```

### `graph.py` (layer 1, pure computation on `model.PlanModel`)
```python
class Graph:
    @staticmethod def of(plan: PlanModel) -> Graph
    def ancestors(self, task_id: str) -> frozenset[str]
    def descendants(self, task_id: str) -> frozenset[str]
    def joined(self, a: str, b: str) -> bool                        # a path either way (int bitset closure)
    def topo(self) -> list[str]
    def successors_count(self, task_id: str) -> int
    def remaining_path_min(self, task_id: str, durations: Mapping[str, float]) -> float
```

### `statusio.py` (layer 4, read side and raw write of status files)
```python
def load(layout: Layout, executor: str) -> dict                     # default empty doc when absent; schema-checked
def load_all(layout: Layout) -> dict[str, dict]                     # {"A": doc, "B": doc}
def state_of(task_id: str, statuses: Mapping[str, dict], plan: PlanModel) -> TaskState   # planned when absent
def save(ctx: Ctx, doc: dict) -> None                               # own executor only; state lock; seq + 1
```

### `decisionsio.py` (layer 4, read side of decisions.md)
```python
def read_blocks(layout: Layout) -> list[dict]                       # headers, validated against decision.schema.json
def find(layout: Layout, decision_id: str) -> tuple[dict | None, dict | None]   # (proposal, resolution)
def open_proposals(layout: Layout) -> list[dict]
def next_id(layout: Layout, executor: str) -> str                   # A: D-001..D-499, B: D-500..D-999
def append_block(ctx: Ctx, header: dict, prose: str) -> None        # state lock; the only writer of decisions.md
```

### `nevershow.py`
```python
@dataclass(frozen=True) class Entry: id: str; cls: str; pattern: str; regex: bool; case_sensitive: bool; until: datetime | None; scope: str
@dataclass(frozen=True) class Hit: entry_id: str; file: str | None; line: int | None        # never the matched text
def load(path: Path) -> tuple[list[Entry], list[ErrorItem]]        # our schema + /frontend's when present (W_NEVER_SHOW_SCHEMA_DRIFT)
def active(entries: Sequence[Entry], now: datetime, scopes: frozenset[str] = frozenset({"repo", "both"})) -> list[Entry]
def scan_text(text: str, entries: Sequence[Entry], *, file: str | None = None) -> list[Hit]
def scan_lines(lines: Iterable[tuple[str, int, str]], entries: Sequence[Entry]) -> list[Hit]
def fold(text: str) -> str                                         # NFKC + lower(), never casefold (Q-F9)
```

### `validate.py`
```python
@dataclass(frozen=True) class Check: id: str; fn: Callable[[PlanModel, "VContext"], list[ErrorItem]]
@dataclass(frozen=True) class VContext: profile: dict | None; policy: dict | None; statuses: Mapping[str, dict] | None; now: datetime; skills_present: Mapping[str, bool]
CHECKS: tuple[Check, ...]                                           # P-01 ... P-27, one function each, in id order
@dataclass(frozen=True) class VReport: errors: tuple[ErrorItem, ...]; warnings: tuple[ErrorItem, ...]; stats: dict
def validate_plan(raw: dict, vctx: VContext) -> VReport            # schema first; plan invariants only if the schema passes
```

### `templates.py`
```python
@dataclass(frozen=True) class Library: name: str; version: str; sha256: str; raw: dict
def load_library(name: Literal["execution", "frontend"]) -> Library   # DependencyMissing for frontend when absent
def resolve_params(lib: Library, given: Mapping[str, Any], profile: dict) -> dict
def substitute(text: str, mapping: Mapping[str, str]) -> str           # closed vocabulary, SCHEMAS.md 6.1
def builtins(layout: Layout, profile: dict) -> dict[str, str]
def instantiate(draft: dict, profile: dict, policy: dict, layout: Layout, now: datetime) -> tuple[dict, dict[str, str]]
    # SCHEMAS.md 6.2 steps 1-9: returns (plan raw, key -> id); deterministic
def instantiate_more(plan_raw: dict, additions: dict, profile: dict, layout: Layout, now: datetime) -> tuple[dict, dict[str, str]]
    # for amend: new ids above the maximum
def assign_ids(keys_in_topo_order: Sequence[str], start: int) -> dict[str, str]
```

### `catalogue.py`
```python
def generate(plan_raw: dict) -> list[dict]                          # SCHEMAS.md 6.3
def write(ctx: Ctx, profile: dict, entries: list[dict]) -> Path    # to profile.paths.feature_catalogue; schema-checked
```

### `status.py` (transitions; reads and writes through statusio)
```python
@dataclass(frozen=True) class Rule: frm: frozenset[str]; to: str; commands: frozenset[str]; evidence: str   # SCHEMAS.md 4.2 row
TRANSITIONS: tuple[Rule, ...]
def transition(ctx: Ctx, doc: dict, task: Task, to: str, *, evidence: list[str], reason: str | None = None) -> None
    # finds the Rule for (current, to, ctx.command), runs its evidence check, appends history, emits task.status;
    # TransitionRefused otherwise
def check_done_evidence(layout: Layout, plan: PlanModel, task: Task, ts: TaskState, git: Git) -> list[ErrorItem]   # SCHEMAS.md 4.3
def cmd_set_status(ctx: Ctx, args: Namespace) -> CommandResult
```

### `decisions.py`, `results.py`
```python
# decisions.py (write side and effects; reading is decisionsio)
def propose(ctx: Ctx, *, kind: str, title: str, options: list[dict], tasks: list[str], deadline: datetime | None,
            recommended: str | None, extra: dict | None = None) -> tuple[str, bool]    # (id, deduplicated)
def resolve(ctx: Ctx, *, decision_id: str, choice: str, by: str, source: str, quote: str) -> dict   # applies effects
def cmd_propose(ctx: Ctx, args: Namespace) -> CommandResult
def cmd_resolve(ctx: Ctx, args: Namespace) -> CommandResult

ROLE_SCHEMAS: Mapping[str, str]   # implementer -> result-implementer, verifier -> result-verifier, ..., merge -> merge-receipt
def put(ctx: Ctx, *, wave: str | None, task: str | None, role: str, attempt: int, file: Path) -> Path
def load(layout: Layout, wave: str, task: str | None, role: str, attempt: int) -> dict | None
def find_any_wave(layout: Layout, task: str, role: str, attempt: int) -> tuple[str, dict] | None
    # (wave, result) for this task's role and attempt in ANY wave (newest wave first): reruns and crash recovery
def landed_receipt(layout: Layout, task: str, attempt: int | None = None) -> dict | None   # latest outcome landed
def write_gate_receipt(ctx: Ctx, task: Task, wave: str, attempt: int, origin_sha: str) -> Path   # mode gate (SCHEMAS 4.2)
def finalize_merge_intents(ctx: Ctx, git: Git) -> list[str]     # intents whose head_sha is on origin/main -> landed receipts
def recover_from_journal(journal: Path) -> list[tuple[str, str, int, dict]]   # (task, role, attempt, result)
def cmd_put(ctx: Ctx, args: Namespace) -> CommandResult
```

### `integrity.py`, `hardenbridge.py`
```python
@dataclass(frozen=True) class Scan: id: str; state: str; detail: str; positive_control: dict | None
def scan_trailers(messages: Sequence[tuple[str, str]]) -> Scan            # same regex family as ~/.claude/hooks/guard.py
def scan_conventional(messages: Sequence[tuple[str, str]]) -> Scan        # first line ^(feat|fix|refactor|test|docs|chore|perf|ci|build|revert)(\([^)]+\))?!?: \S
def scan_secrets_text(text: str, *, where: str, public: frozenset[str] = frozenset()) -> Scan   # the secret scan on free text (state repo diff, Notion op text, answers); values in `public` and explorer-link values are not hits (README.md 8)
def scan_secrets(added: Sequence[tuple[str, int, str]], *, public: frozenset[str] = frozenset()) -> Scan
def load_public_values(layout: Layout) -> frozenset[str]                  # the values of public-values.jsonl (lower-cased); empty when the file is absent
def register_public_value(layout: Layout, *, value: str, kind: str, chain: str, network: str, proven: str, source: str) -> bool   # appends one line under the state lock; False when already listed; refuses (E_POLICY) without a chain proof
def scan_never_show(added: Sequence[tuple[str, int, str]], entries: Sequence[Entry]) -> Scan
def scan_writes_scope(paths: Sequence[str], writes: Sequence[str]) -> Scan
def scan_protected(paths: Sequence[str], protected: Sequence[str], allowed: bool) -> Scan
def scan_test_integrity(git: Git, base: str, head: str) -> Scan          # skip/only/xfail markers, assertion counts, runner config
def scan_todo(added: Sequence[tuple[str, int, str]], judge_globs: Sequence[str]) -> Scan
def with_positive_control(scanner: Callable[..., Scan], planted: Any, *args: Any) -> Scan
    # runs the scanner on a planted violation first; a scanner that misses its plant fails the scan ("blind scan")

HARDEN: Path                                                              # other_skill("harden")
def assert_out_dir_safe(out_dir: Path) -> None                            # parent holds no 'active'; not under .harden/
@dataclass(frozen=True) class GatesOutcome: exit_code: int; result: dict | None; result_path: Path; flaky: tuple[str, ...]
def gates(config: Path, repo: Path, out_dir: Path, label: str, *, repeat: int = 1, timeout_s: float = 3600) -> GatesOutcome
def prescan(repo: Path, out: Path) -> RunResult
def inventory(repo: Path, out: Path) -> RunResult
def infer(repo: Path, inventory_path: Path, out_dir: Path) -> RunResult
def probe(repo: Path, out_dir: Path) -> RunResult
def finalize(repo: Path, out_dir: Path) -> RunResult                      # never passes --install (asserted)
def agents_status() -> RunResult                                          # harden_agents.py status --json
```

### `quota.py`, `governor.py`, `due.py`, `schedule.py`
```python
@dataclass(frozen=True) class Snapshot: captured: datetime; five_pct: float | None; five_resets: datetime | None; seven_pct: float | None; seven_resets: datetime | None
def read_snapshot(path: Path) -> Snapshot | None
def decide(snap: Snapshot | None, now: datetime, profile: dict, projection: dict, *, override: dict | None,
           limit_evidence_utc: datetime | None) -> dict    # CLI.md quota rules 1-5 (override, null storm, >= 100 %)
def cmd_quota(ctx: Ctx, args: Namespace) -> CommandResult

@dataclass(frozen=True) class Readings: disk_free_gb: float | None; scratch_disk_free_gb: float | None; ram_free_gb: float | None; commit_free_gb: float | None; ac_power: bool | None; network: bool | None; harden_active: bool
def read(profile: dict, repo: Path | None) -> Readings                     # one PowerShell call returning JSON
def decide_launch(r: Readings, profile: dict, for_what: str) -> dict      # CLI.md governor rules
def sweep_candidates(layout: Layout, profile: dict) -> dict
def apply_sweep(sweep: dict) -> dict
def cmd_governor(ctx: Ctx, args: Namespace) -> CommandResult

def anchor_instant(anchor: dict, plan: PlanModel, statuses: Mapping[str, dict], profile: dict) -> datetime | None
def due_items(plan: PlanModel, statuses: Mapping[str, dict], profile: dict, now: datetime, horizon_min: int) -> list[dict]
def cmd_due(ctx: Ctx, args: Namespace) -> CommandResult

REFERENCE_CLASS: Mapping[str, Estimate]     # assets/reference-class.json (build 6.2/26.7/46.0, verify 1.6/6.7/31.1, research 13.0/24.9/40.6)
def lognormal(p50: float, p90: float) -> tuple[float, float]               # mu = ln p50, sigma = ln(p90/p50)/1.2816
@dataclass(frozen=True) class Cpm: es: Mapping[str, float]; lf: Mapping[str, float]; slack: Mapping[str, float]; critical: tuple[str, ...]
def cpm(plan: PlanModel, statuses: Mapping[str, dict], now: datetime, durations: Mapping[str, float]) -> Cpm
def priority_key(task: Task, cpm: Cpm, graph: Graph) -> tuple            # (LST, -remaining path, -successors, id)
def dispatch(plan: PlanModel, statuses: Mapping[str, dict], *, now: datetime, lanes: int, durations: Mapping[str, float],
             calendars: Mapping[str, list[tuple[datetime, datetime]]], browser_slots: int) -> dict[str, tuple[datetime, datetime]]
    # parallel schedule generation with release times, unary resources, human calendars (SCHEMAS.md 7.4)
def simulate(plan: PlanModel, statuses: Mapping[str, dict], profile: dict, *, samples: int, seed: int, lanes: int,
             now: datetime, calibration: Mapping[str, float], what_if: dict | None = None) -> dict
    # Per sample and task: a running task samples its duration from the lognormal conditioned on its elapsed time
    # (draw from the distribution truncated at elapsed, minus elapsed); an agent task adds the verifier stage (the
    # verify reference class 1.6/6.7/31.1, or the template's verify estimate) and, with the calibrated per-kind failure
    # probability, extra implement-plus-verify cycles up to max_attempts; a manual or decision task adds the owner's
    # response latency (assets/reference-class.json "human_response", p50 30 / p90 120 min unless calibrated) inside
    # awake windows. Every iteration over a set or dict is sorted (graph.ancestors returns frozenset): outputs never
    # depend on PYTHONHASHSEED.
def zones(sim: dict, deadlines: Sequence[Deadline], now: datetime) -> list[dict]     # green >= .8, yellow .5-.8, red < .5
def build_complete_deadline(profile: dict, plan: PlanModel, harden_p80_min: float) -> datetime
def cut_candidates(plan: PlanModel, statuses: Mapping[str, dict], sim: dict) -> list[str]   # optional, then P3, then P2, off the must-have path
def recalibrate(calibration: dict, done: Sequence[tuple[Task, float]]) -> dict
def cmd_schedule(ctx: Ctx, args: Namespace) -> CommandResult
def cmd_simulate(ctx: Ctx, args: Namespace) -> CommandResult
```

---

## 5. Layers 7-10 (commands)

| module | public functions (besides its `cmd_*` handlers, CLI.md) |
|---|---|
| `reconcile.py` | `reconcile(ctx, plan, statuses) -> dict` (transitions applied, hook events imported, merge intents finalised, `launching` waves resolved, run_state derived); `import_hook_events(ctx) -> int` (the files of `local/hook-events/` in name order, each deleted after its event is appended); `derive_run_state(plan, statuses, local_state, hooks_state) -> str` (a `stop-failure` stuck record superseded by a later `stop.*` event of the same session is dropped; `rate_limit` feeds quota); `digest_text(ctx, data, max_chars) -> str` (first line: `paths.exec_cmd()`); `cmd_status` |
| `proof.py` | `make_run_id(task, sha, now, n) -> str`; `clean_checkout(repo, sha, dest) -> Path` (`core.longpaths`, fetches `refs/exec/*`); `run_proof(ctx, plan, task, sha, *, negative_control, checkout, keep, tree=None) -> dict` (governor reading first, `disk-heavy` file lock, 0.6 budget, environment-failure classification); `check_file(spec) -> dict` (`json_checks`; also used for manual and decision file proofs); `write_verdict(ctx, plan, task, run_id, verdict, findings, attempt, model, effort) -> dict` (expected SHA from `results.landed_receipt`, attestation, tracked copies, transitions through `status.transition`, kept checkout deleted); per-type `_run_command`, `_run_tx`, `_run_ci`, `_run_file`, `_run_url`, `_run_attest`; `cmd_run`, `cmd_verdict` |
| `amend.py` | `apply_patch(plan_raw, patch, decision, layout, profile, now) -> tuple[dict, dict]`; `cas_amend(ctx, decision_id, patch) -> dict` (push own pending commits, fetch, apply, validate with TD-A1..A6, commit, push; on rejection `reset --keep HEAD~1` + `pull --rebase`, retry ≤ 3); `cmd_amend` |
| `answers.py` | `verify(bring_back, value, attachments, ctx) -> dict` (strict pattern first, argv only, reader JSON compared); `write_answer(ctx, header, body) -> Path` (redacted text tracked, raw text local); `parse_answer(path) -> tuple[dict, str]`; `cmd_ingest` |
| `manual.py` | `push_text_fr(task, profile) -> str` (≤ 200 chars, names the id); `post(ctx, task_ids, repost, link) -> dict` (decision tasks open a proposal of the template's `decision_kind`); `cmd_post` |
| `briefs.py` | `STANDING_RULES: str`; `render(task, plan, profile, policy, layout, *, role, attempt, rerun, wave, findings=None, resume_note=None) -> str` (from `assets/briefs/<role>.md`; names every `brief_refs` path, the inbox file to Write, the exact `result put`, `merge` and `snapshot` commands with explicit `--repo` and `--state`, the "Already recorded" paths of every wave for this task and attempt, the standing rules, the CLAUDE.md overrides) |
| `wavejs.py` | `FORBIDDEN: tuple[str, ...]` (`Date.now`, `Math.random`, `new Date()`, `require(`, `import `, `process.`); `strip_js(js) -> str` (comments, string and template literals removed by a small JS-aware scanner, line numbers kept); `load_fragment(name) -> tuple[str, str]` (source, sha256; DependencyMissing); `js_literal(obj) -> str` (JSON with U+2028/2029 escaped); `render(manifest, fragments) -> str` (from `assets/workflows/wave.template.js`); `static_check(js) -> list[ErrorItem]` (on `strip_js(js)`; E_WAVE_FORBIDDEN_TOKEN); `node_check(path) -> RunResult` (`node --check`, when node is present) |
| `planning.py` | `insert_build_complete_deadline(plan_raw, profile) -> dict` (uses `schedule.build_complete_deadline`; P-24); `apply_proofs(candidate, td_result) -> dict` (`--proofs`); `cmd_instantiate`, `cmd_validate`, `cmd_catalogue` (glue: templates + deadline + validate + catalogue + decisions approval proposal; `EXECUTION.md` is regenerated by the orchestrator's next `report --view`) |
| `merge.py` | `merge_task(ctx, plan, task, *, attempt, rerun, wave, worktree, branch, single_tree, message_file) -> dict` (CLI.md merge: already-landed and intent checks, steps 1-8, budget); `build_commit_from_paths(git, base, paths, message_file, index_path) -> str` (temporary index, `commit-tree`; used by single-tree merge and `snapshot`); `integration_worktree(git, sha, dest, shared_checkout) -> Path` (node_modules junction unless a manifest changed); `fe_workspace(ctx, task, attempt, rerun) -> dict` (idempotent per run key); `cmd_merge`, `cmd_snapshot`, `cmd_fe_workspace` (the shared-checkout re-sync is `gitutil.Git.resync_to_origin`, called by `wave ingest`) |
| `wave.py` | `next_wave_id(layout, executor) -> str` (O_EXCL on `waves/Wnn.json` under the state lock, executor ranges); `select(ctx, plan, statuses, schedule, governor, live_waves, max_tasks, include, force_critical) -> list[Task]` (live waves occupy lanes, resources, writes and slots); `build_manifest(...) -> dict` (chains, `fix_attempts`, gate receipts through `results.write_gate_receipt`); `emit(ctx, ...) -> dict` (status `launching`, tasks → running); `launched(ctx, wave, run_id, transcript_dir, error, relaunch) -> dict`; `ingest(ctx, wave, journal, finished) -> dict` (receipts of any wave, keyed rows, calibration recomputed, single-tree re-sync); `emit_planner(ctx, rounds, mode) -> dict` (`plan emit`); `cmd_emit`, `cmd_launched`, `cmd_ingest`, `cmd_plan_emit` |
| `notion.py` | `STATE_LABELS_FR: Mapping[str, str]` (task status → SELECT option); `DDL_TASKS`, `DDL_WAVES`, `VIEWS`; `row_properties(task, ts, profile) -> dict` (text through `log.redact` and `integrity.scan_secrets_text`); `row_hash(props) -> str`; `diff(ctx, plan, statuses, profile, *, init, wave, replay_outbox) -> dict`; `ack(ctx, batch_id, op_id, result, error, retry_after) -> dict`; `ack_pending_as_crashed(ctx) -> list[str]` (resume R9); `poll_plan(ctx, profile) -> dict`; `cmd_diff`, `cmd_ack`, `cmd_poll_plan` |
| `report.py` | `render_wave_fr(ctx, wave, plan, statuses, schedule_cache: dict, governor: dict \| None, quota: dict \| None) -> str` (from `assets/report-templates/wave.fr.md`; `schedule_cache` is `local/schedule.json`); `render_execution_md(plan, statuses, profile) -> str`; `push_text_fr(...) -> str \| None`; `cmd_report` |
| `completion.py` | `gate_specs(plan, profile) -> list[dict]`; `generate(ctx, plan, profile) -> Path` (from `assets/completion-check.template.mjs`); `run(layout, phase) -> dict`; `cmd_generate`, `cmd_run` |
| `ingest.py` | `merge_draft(existing, draft, schema_name) -> tuple[dict, list[dict]]` (document, missing); `spec_info(path) -> dict` (sha256, requirement ids found by regex); `cmd_ingest` |
| `initcmd.py` | `init_state(ctx, project, executor, state_remote, pre_t0, import_from) -> dict` (checks `gitutil.remote_is_private`); `install_commit_msg_hook(git) -> str` (`assets/githooks/commit-msg`, `core.hooksPath`); `cmd_init` |
| `preflight.py` | `CHECKS: tuple[tuple[str, Callable], ...]` (PF-01 … PF-29); `run(ctx, profile, for_what, confirm) -> dict` (`ok` false while a check fails or is open); `cmd_preflight` |
| `syncstate.py` | `sync(ctx, pull_only, push_only) -> dict` (fetch, then the state lock for commit and rebase, secret scan of the staged diff, private-remote check before push); `cmd_sync` |
| `hooksinstall.py` | `TAG = "# execution-hook v1"`; `entries(skill_dir, prompt_hook) -> dict` (the settings `hooks` block, absolute paths); `install(ctx, prompt_hook) -> dict`; `uninstall(ctx) -> dict`; `canary(ctx, nonce) -> dict` (`CLAUDE_CODE_SESSION_ID` cross-check, `permission_mode`); `cmd_install`, `cmd_uninstall`, `cmd_canary` |
| `agents.py` | `OURS: tuple[str, ...]` (the five execution-* names); `THEIRS: tuple[str, ...]` (frontend-critic, frontend-probe); `render(name) -> str`; `install(force) -> dict`; `status() -> dict`; `probe_script(ctx) -> dict` (from `assets/workflows/probe.template.js`); `probe_check(ctx, result_path) -> dict`; `cmd_install`, `cmd_status`, `cmd_probe`, `cmd_probe_check` |
| `heartbeat.py` | `cron_for(profile) -> dict` (minutes `sorted({(offset + k*every) % 60})`, absolute prompt); `cmd_plan`, `cmd_record` (session id recorded) |
| `replay.py` | `rebuild_local_state(ctx) -> dict` (the quota override rebuilt from its decision); `cmd_replay` |
| `fixture.py` | `create(dest, variant, with_remote, *, two_dev: bool = False, frontend_mode: Literal["small", "full"] = "small", now: datetime) -> dict`; `cmd_new` |
| `fixmode.py` | `parse_report(text) -> list[dict]`; `fix_patch(items, selected, plan, profile) -> dict`; `cmd_fix` |
| `hardenready.py` | `CHECKS` (H1 … H14, one function each); `run(ctx, plan, profile, only, scratch, keep, after_harden) -> dict`; `cmd_harden_ready` |
| `resume.py` | `steps(ctx) -> list[dict]` (R0 … R10); `takeover(ctx) -> dict`; `cmd_resume` |
| `handover.py` | `draft_harden_profile(plan, profile, minutes_left) -> dict`; `handover(ctx, decision, final) -> dict`; `cmd_handover` |

`cli.py`:
```python
@dataclass(frozen=True) class CommandSpec: words: str; module: str; function: str; orchestrator_only: bool
COMMANDS: tuple[CommandSpec, ...]          # one per row of CLI.md section 9, e.g. CommandSpec("wave emit", "wave", "cmd_emit", True)
def build_parser() -> argparse.ArgumentParser     # every option of CLI.md; exit 2 on usage errors through UsageError
def main(argv: list[str]) -> int                  # configure logging, build Ctx, envelope.run(spec handler)
```
Dispatch imports `execlib.<module>` lazily inside `main`; an absent module or function is E_NOT_IMPLEMENTED (exit 3),
so the core lane ships a complete surface before the other lanes exist.

---

## 6. Hooks (`hookcore.py` and `scripts/hooks/*.py`)

`hookcore.py` imports only the standard library (it must start in well under 100 ms with `python -S`).
```python
@dataclass(frozen=True) class HookEnv: state_dir: Path; repo: Path; marker: dict; layout_local: Path
def read_payload() -> dict                         # json.loads(sys.stdin.buffer.read().decode("utf-8")): never the text stream (cp1252 on Windows pipes)
def locate(payload: dict) -> HookEnv | None        # payload cwd, then CLAUDE_PROJECT_DIR, then parents, for .execution/local/active
def is_orchestrator(env: HookEnv, payload: dict) -> bool        # marker session_id == payload session_id and no agent_id
def is_agent(payload: dict) -> bool                              # agent_id present
def agent_in_run(env: HookEnv, payload: dict) -> bool
    # an agent call this run guards: its payload session_id is the marker's session_id or one of previous_session_ids,
    # or the run's probe found workflow agents not session-scoped (local state hooks.agent_session_scoped false), in
    # which case every agent in the repository is guarded unless <repo>/.harden/active exists (HOOKS.md 2.2)
def emit(obj: dict) -> None                        # sys.stdout.buffer.write(json.dumps(obj, ensure_ascii=True).encode("ascii") + b"\n"); flush
def emit_context(event: str, text: str) -> None    # emit({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}})
def emit_deny(reason: str) -> None                 # PreToolUse: permissionDecision deny + reason, exit 0 (never exit 2)
def append_event(env: HookEnv, hook: str, type_: str, payload: dict, data: dict) -> None
    # one file per event: local/hook-events/<utc compact with microseconds>-<pid>-<n>.json, O_CREAT|O_EXCL (a
    # collision retries with n+1); never an append to a shared file (O_APPEND is not atomic through the MSVC CRT)
def read_json_quiet(path: Path) -> dict | None     # None when missing; raises on corrupt; PermissionError retried 3 × 20 ms
def write_json_atomic(path: Path, obj: dict) -> None   # temp + os.replace, 3 retries 20 ms apart on PermissionError, then fail open
def utcnow() -> datetime                           # datetime.now(timezone.utc); EXEC_NOW honoured only when EXEC_TEST=1
def fail_open(main: Callable[[], None], hook: str) -> NoReturn
    # runs main; any exception → one JSON line to <state>/local/hook-errors.log (else ~/.claude/hooks/execution-hooks.log), exit 0
```
Launcher in settings (CLI.md hooks install): `bash "C:/Users/Utilisateur/.claude/skills/execution/scripts/hooks/py.sh"
stop_gate.py # execution-hook v1`. `py.sh` resolves its sibling script, converts the path with `cygpath -m`, exits 0
when the script is missing, exports `PYTHONUTF8=1`, and runs `python -S` (Python's exit 2 on a missing script would
otherwise block).

Common gate for every hook: no `local/active` → exit 0 silently. Performance budget per call: p95 ≤ 250 ms on this
machine (tested). No hook starts a subprocess (git is never called from a hook); they read only `local/active`,
`local/state.json`, `local/hooks-state.json`, `local/schedule.json`, `local/digest.txt`, `policy.json`,
`plan.json` (protected globs), `profile.json` (scratch root, project) and the skill's
`assets/report-templates/push.fr.json` (the French STUCK push text).

### 6.1 Stop gate (`stop_gate.py`)
The decision table is HOOKS.md 4.1 (rows 0-9, first match wins): not the orchestrator → nothing; `stop_hook_active`
false resets the counter; a running background task → allow; set-up states → allow; BUILD_COMPLETE, HANDED_OVER,
STUCK → allow; awaiting or paused AND the heartbeat armed → allow; nothing ready to launch (or launching forbidden by
the governor or quota) AND the heartbeat armed → allow (`idle-armed`); `background_tasks` absent AND a launched,
unfinished wave AND the heartbeat armed → allow; the fifth consecutive continuation → allow and record STUCK;
otherwise continue with `additionalContext` (≤ 600 chars, the absolute exec.py command, naming the ready tasks when
something can launch, or only the heartbeat when nothing is armed). "Armed" = `session_crons` holding the heartbeat,
or, when the array is absent, the recorded heartbeat of the **bound** session under 7 days old (HOOKS.md 4.2). Never
`decision: block`, never exit 2.

### 6.2 SessionStart (`session_start.py`, matcher startup|resume|clear|compact)
- source clear, marker `rekey_armed_until_utc` in the future → re-key: previous id appended to
  `previous_session_ids`, `session_id` = payload id, the recorded heartbeat cleared, `hooks.rekeyed` event.
- Orchestrator session (after re-key) → `additionalContext` ≤ 2,000 chars: the absolute exec.py command, the content
  of `local/digest.txt` (written by the last `exec.py status`) prefixed with its age, or a run_state line from local
  state when the file is absent, then "Re-read <SKILL_DIR>/SKILL.md (standing rules, state machine, tick) and
  <SKILL_DIR>/references/tick.md; run <exec_cmd> status first."; for sources `resume` and `clear` (after a re-key)
  also the resume line (HOOKS.md 5.1). Other sessions → nothing.

### 6.3 SessionEnd (`session_end.py`)
Orchestrator session with reason `clear` → `rekey_armed_until_utc = now + 120 s`. Nothing else.

### 6.4 StopFailure (`stop_failure.py`)
Orchestrator session → a `stop.failure {error, error_details, keys}` event (fields `error`, a string enum, and the
optional `error_details`); `stuck = {reason, source: stop-failure}` in hooks-state only when `error` is not
`rate_limit` (rate_limit feeds the quota decision). `status` drops the stuck record when a later `stop.*` event of the
same session shows the turn went on (a helper's or subagent's error, vendor #91419). No output.

### 6.5 PreToolUse guard (`pre_tool_guard.py`)
Applies when the marker exists and either the session is the orchestrator's (full rules), another main-thread session
in the repository (only the run lease, HOOKS.md 8.2), or the call comes from an agent of this run
(`hookcore.agent_in_run`). Deny with a one-line reason; never exit 2. Allowed `exec.py proof verdict` and `exec.py
merge` calls from agents write a `guard.attest` event (CLI.md `proof verdict`). The full rule table is HOOKS.md 8.4;
the summary below is the minimum.
- **Binding** (main thread, Bash, command contains `exec.py hooks canary --nonce <marker bind_nonce>`): write
  `session_id`, emit `hooks.bound` and `hooks.canary` events; allow.
- **Everyone**: `git push` with `-f`, `--force`, `--force-with-lease`, `--mirror`, `--delete` or a `+` refspec;
  `filter-branch`, `filter-repo`, `reset --hard origin`; any `git push` after `policy.git.push_freeze_utc`
  (`flags.push_frozen`); `policy.mainnet.broadcast_patterns` while `flags.mainnet_open` is false; any
  `policy.deny_endpoints` pattern in a command or a fetched URL; Read, Grep, Glob or a Bash read verb on a path
  under `policy.fences.deny_read`; Write, Edit, MultiEdit or a Bash redirection onto an exec.py-owned state file
  (`plan.json`, `status/**`, `proofs/**`, `events.jsonl`, `decisions.md`, `answers/**`, `waves/**`, `briefs/**`,
  `profile.json`, `policy.json`, `completion-check.mjs`, `gates.json`, `local/state.json`, `local/active`,
  `local/hooks-state.json`, `local/results/**`): only exec.py writes them. The orchestrator may Write its drafts
  (`local/*.draft.json`, `local/planner/**`, `local/notion/results/**`) and answer texts it hands to exec.py.
- **Agents** (any `agent_id`), additionally: Write, Edit, MultiEdit, NotebookEdit and Bash redirections to a path
  outside the repo (and outside `policy.fences.allow_write_outside`) when `deny_write_outside_repo`; to
  `.execution/**` except `local/inbox/**`, `frontend/**` (FE task agents) and `local/planner/**`
  (execution-planner); to `.claude/**`, `.githooks/**`,
  `.git/**`; exec.py subcommands outside SCHEMAS.md 5.3 for their `agent_type`; every Notion and other write-capable
  connector tool (`mcp__*` whose name ends with a Notion tool suffix, Gmail, Drive, Calendar, Luma, Artifact),
  PushNotification, CronCreate, CronDelete, RemoteTrigger, SendMessage, Monitor.
- **By agent_type**: execution-implementer: no write to `plan.protected` globs; execution-verifier,
  execution-reviewer, frontend-critic, frontend-probe: no Write/Edit outside the inbox, no `git commit`, `git push`,
  `git rebase`, `git reset`; execution-test-designer: may write protected globs (it authors them). An unknown or
  generic agent type (`workflow-subagent`, `general-purpose`) gets the strictest agent rules (implementer rules
  minus `merge`).
- Every denial appends a `guard.deny` hook event `{tool, rule, agent_type}` (never the full command when it may hold
  a secret: the first 120 characters through `redact`). The global `~/.claude/hooks/guard.py` stays the authority on
  attribution trailers and secret reads; this guard never relaxes it and never needs to read a secret path itself.

### 6.6 UserPromptSubmit (`user_prompt.py`)
Prompt starting with `<task-notification>` → nothing (it is a workflow completion, not the owner). Orchestrator
session otherwise → one line of context: "execution: <run_state>, <n> waves running, awaiting <ids>; run exec.py
status first."

---

## 7. The generated wave script (contract with `assets/workflows/wave.template.js`)

Plain JavaScript evaluated by the Workflow runtime: no imports, no Node APIs, no `Date.now()`, `Math.random()` or
argless `new Date()`. Globals used: `agent`, `parallel`, `pipeline`, `log`, `phase`, `args`. Structure:
- `const MANIFEST = <js_literal(manifest)>;` and the inlined fragments (`async function feCritique(api, input)`,
  `async function feDirections(api, input)`, verbatim, their sha256 in the manifest).
- A promise per task; a task starts when every `deps_in_wave` promise resolved with outcome `done`; a dependency that
  ended otherwise resolves the dependent as `skipped-dep` (`wave ingest` puts it back to `planned`, no rerun counted).
- A priority queue (manifest `priority_rank`) under two semaphores: writers (`limits.writers`) and verifiers
  (`limits.verifiers`); a `browser` resource also takes one of `limits.browser_slots`; tasks sharing any resource
  never overlap.
- Per task: for each step of `chain`, one `agent(prompt, {label, phase, schema, model, effort, agentType, isolation})`
  with the prompt "Read your brief at <brief_path> and follow it exactly. Role: <role>. Task <id>, wave <wave>,
  attempt <n>." and `schema` = the bundled result schema of the role. A `null` return → outcome `rerun` (never
  done); a **throw** → outcome `infra-error` with the error text logged (an unknown agent type, an unsatisfiable
  schema or a spent budget throws on every retry: it is never a rerun). Implementer `status` failed or blocked, or
  `merge.outcome` other than landed → outcome failed/blocked without a verifier; an implementer result whose merge
  exit code is 3 → `rerun`. Otherwise the verifier's prompt adds "Landed SHA: <merge.landed_sha>" (the verifier
  re-checks it against the merge receipt and origin/main itself). Verifier verdict pass **with a non-null
  `receipt_sha256`** → `done`; fail → `failed`; pass without a receipt (a refused or failed `proof verdict`) →
  `rerun`. FE critique and directions steps call the inlined fragments with `api = {agent, parallel, pipeline, log}`.
- `args.skip` tasks are not run and resolve as `done` for their dependents.
- `log()` one line per step; the script returns `{wave, outcomes: {task: outcome}}` only. Every fact the orchestrator
  acts on is re-read by `wave ingest` from files (results, merge receipts, proof runs, receipts), never from this
  return value.

---

## 8. Dependency graph (acyclic; `tests/test_import_graph.py` enforces it from the AST)

Each module may import only modules of a strictly lower layer (section 1), plus `errors`, `log`, `clock`, `paths`,
`jsonio`, `model` everywhere. Explicit edges above layer 2:

```
graph       -> (layer 0 only)
events      -> locks, schema            (reads the seq counter of local/state.json through jsonio, not through state)
state       -> schema, locks
plan        -> schema
statusio    -> schema, locks             (works on model.PlanModel; never imports plan, same layer)
decisionsio -> schema, locks, events
nevershow   -> schema
validate    -> plan, graph, globs, resources, nevershow, decisionsio, statusio
templates   -> plan, graph, schema
catalogue   -> plan, schema
status      -> plan, statusio, events, state, gitutil, schema
decisions   -> plan, decisionsio, statusio, status, events, state, schema
results     -> schema, events, gitutil, locks
integrity   -> gitutil, nevershow, globs
hardenbridge-> procutil
quota       -> plan, statusio
governor    -> procutil, state, events, gitutil
due         -> plan, statusio, graph
schedule    -> plan, statusio, graph, resources, globs, events
wavejs      -> schema
reconcile   -> status, statusio, results, decisions, decisionsio, events, state, gitutil, plan, quota
proof       -> plan, status, statusio, results, events, gitutil, procutil, hardenbridge, governor, schema   (answer files read through jsonio)
amend       -> plan, graph, validate, templates, catalogue, decisionsio, statusio, status, events, gitutil, locks
answers     -> status, statusio, decisions, events, gitutil, procutil, plan, integrity
manual      -> status, statusio, events, state, plan, decisions
briefs      -> plan, results
agents      -> wavejs
planning    -> templates, validate, catalogue, decisions, decisionsio, schedule, plan, statusio, events
merge       -> gitutil, integrity, hardenbridge, proof, results, governor, events, locks, plan, statusio, nevershow
wave        -> schedule, governor, quota, briefs, wavejs, results, status, statusio, reconcile, decisions, events, state, plan, graph
notion      -> plan, statusio, state, events, integrity
report      -> plan, statusio, state            (reads local/schedule.json as data, never imports schedule)
completion  -> plan, statusio, procutil, schema
ingest      -> schema, decisions, decisionsio, events, state
initcmd     -> gitutil, state, events
preflight   -> governor, quota, procutil, hardenbridge, state, agents
syncstate   -> gitutil, validate, plan, locks, events, integrity
hooksinstall-> state, events, gitutil
heartbeat   -> state, events
replay      -> events, state, statusio, reconcile
fixture     -> gitutil
fixmode     -> amend, decisions, decisionsio, plan
hardenready -> hardenbridge, gitutil, completion, governor, plan, statusio, procutil
resume      -> state, gitutil, replay, reconcile, events, notion, results
handover    -> completion, hardenready, hooksinstall, report, state, events
cli         -> envelope (all handlers imported lazily by name)
hookcore    -> (stdlib only)
```
Rejected edges (must not exist): events → state and proof → answers (same layer); report → schedule (report reads
the schedule cache file); any edge into `cli` or `hookcore`.

Lane rule: a lane may call a function of a module owned by another lane only through the signature written here;
its tests use fakes for modules of lanes not yet integrated (LANES.md section 3).
