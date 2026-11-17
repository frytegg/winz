"""The stdout envelope (contract/README.md 4-6, MODULES.md 3 envelope; TESTS.md 1.7; LANES.md B01).

Protects: each ExecError subclass maps to its exit code; an uncaught exception is E_INTERNAL exit 3 with a logged
traceback (never swallowed); ok iff exit 0; warnings collected by lower layers reach the envelope; the envelope always
validates and is exactly one stdout line; a handler returning non-serialisable data becomes E_INTERNAL, not a crash.

Run: python -m unittest discover -s scripts/tests -p "test_envelope.py" -v
"""
from __future__ import annotations

import contextlib
import io
import json
import unittest
from pathlib import Path

import _support as S  # noqa: F401  (puts scripts/ on sys.path)
from execlib import envelope, errors, schema
from execlib.errors import (CasRejected, CheckFailed, DependencyMissing, EnvError, ErrorItem, ExecError, GitError,
                            ImmutableFile, InternalError, LockTimeout, PolicyRefused, TransitionRefused, UsageError,
                            ValidationFailed)
from execlib.model import CommandResult

EXPECTED = [(UsageError, 2, "E_USAGE"), (CheckFailed, 1, "E_CHECK"), (ValidationFailed, 1, "E_SCHEMA"),
            (CasRejected, 1, "E_CAS_REJECTED"), (DependencyMissing, 1, "E_DEPENDENCY_MISSING"),
            (EnvError, 3, "E_ENV"), (GitError, 3, "E_GIT"), (LockTimeout, 3, "E_LOCK_TIMEOUT"),
            (InternalError, 3, "E_INTERNAL"), (PolicyRefused, 4, "E_POLICY"),
            (TransitionRefused, 4, "E_TRANSITION_REFUSED"), (ImmutableFile, 4, "E_IMMUTABLE")]


def capture(fn, command: str = "status", pretty: bool = False) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = envelope.run(command, fn, pretty=pretty)
    return code, out.getvalue(), err.getvalue()


class Envelope(unittest.TestCase):
    def setUp(self) -> None:
        errors.drain_warnings()

    def check_one(self, text: str) -> dict:
        lines = [ln for ln in text.split("\n") if ln]
        self.assertEqual(len(lines), 1, text)
        env = json.loads(lines[0])
        self.assertTrue(schema.validate(env, "envelope").ok)
        return env

    def test_success(self) -> None:
        code, out, _ = capture(lambda: CommandResult({"n": 1}))
        env = self.check_one(out)
        self.assertEqual((code, env["ok"], env["exit_code"], env["data"], env["errors"]), (0, True, 0, {"n": 1}, []))
        self.assertEqual(env["contract"], "execution/1")

    def test_each_exec_error_maps_to_its_exit_code(self) -> None:
        for cls, exit_code, code_str in EXPECTED:
            with self.subTest(cls=cls.__name__):
                def fn(c=cls):  # type: ignore[no-untyped-def]
                    raise c("it failed", data={"why": "test"})
                code, out, _ = capture(fn)
                env = self.check_one(out)
                self.assertEqual(code, exit_code)
                self.assertEqual(env["exit_code"], exit_code)
                self.assertFalse(env["ok"])
                self.assertEqual(env["errors"][0]["code"], code_str)
                self.assertEqual(env["data"], {"why": "test"})
        self.assertTrue(issubclass(LockTimeout, ExecError))

    def test_refined_code_and_items(self) -> None:
        def fn() -> CommandResult:
            raise CheckFailed("two problems", code="E_PLAN_INVALID",
                              items=[ErrorItem("E_TASK_ID", "bad id", task="T001"),
                                     ErrorItem("E_DEP_ORDER", "bad order", path="/tasks/1")])
        _code, out, _ = capture(fn)
        env = self.check_one(out)
        self.assertEqual([e["code"] for e in env["errors"]], ["E_TASK_ID", "E_DEP_ORDER"])
        self.assertEqual(env["errors"][0]["task"], "T001")

    def test_uncaught_exception_is_internal_with_traceback(self) -> None:
        def fn() -> CommandResult:
            raise RuntimeError("kaboom")
        code, out, err = capture(fn)
        env = self.check_one(out)
        self.assertEqual((code, env["exit_code"], env["errors"][0]["code"]), (3, 3, "E_INTERNAL"))
        logs = [json.loads(ln) for ln in err.split("\n") if ln.strip()]
        tracebacks = [ln for ln in logs if "traceback" in ln]
        self.assertTrue(tracebacks, "the uncaught exception is logged with its traceback")
        self.assertIn("RuntimeError: kaboom", tracebacks[0]["traceback"])
        self.assertEqual(tracebacks[0]["level"], "error")

    def test_check_failure_result_keeps_data(self) -> None:
        code, out, _ = capture(lambda: CommandResult({"gates": ["x"]}, exit_code=1,
                                                     errors=[ErrorItem("E_GATES", "a gate failed")]))
        env = self.check_one(out)
        self.assertEqual((code, env["data"], env["errors"][0]["code"]), (1, {"gates": ["x"]}, "E_GATES"))
        code2, out2, _ = capture(lambda: CommandResult({}, exit_code=1))
        self.assertEqual(self.check_one(out2)["errors"][0]["code"], "E_CHECK")
        self.assertEqual(code2, 1)

    def test_warnings_from_lower_layers(self) -> None:
        def fn() -> CommandResult:
            errors.warn(ErrorItem("W_BOM", "stripped"))
            errors.warn(ErrorItem("W_BOM", "stripped"))
            return CommandResult({}, warnings=[ErrorItem("W_TZ_FALLBACK", "fixed offset")])
        code, out, _ = capture(fn)
        env = self.check_one(out)
        self.assertEqual(code, 0)
        self.assertEqual([w["code"] for w in env["warnings"]], ["W_TZ_FALLBACK", "W_BOM"])

    def test_non_serialisable_data_is_internal(self) -> None:
        code, out, _ = capture(lambda: CommandResult({"path": Path("x")}))
        env = self.check_one(out)
        self.assertEqual((code, env["errors"][0]["code"]), (3, "E_INTERNAL"))

    def test_command_name_fallback_and_pretty(self) -> None:
        _c, out, _ = capture(lambda: CommandResult({}), command="Not A Command!")
        self.assertEqual(self.check_one(out)["command"], "exec")
        _c, out2, _ = capture(lambda: CommandResult({"a": 1}), pretty=True)
        self.assertGreater(len(out2.strip().split("\n")), 1)
        self.assertTrue(json.loads(out2)["ok"])

    def test_error_item_validation(self) -> None:
        with self.assertRaises(ValueError):
            ErrorItem("bad-code", "x")
        self.assertEqual(ErrorItem("E_X1", "m", path="/a").to_dict(), {"code": "E_X1", "message": "m", "path": "/a"})


if __name__ == "__main__":
    unittest.main()
