"""Tests for scripts/doubling.py (run: python -m unittest discover -s scripts/tests -p "test_doubling.py" -v)."""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, Iterable, List

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import doubling as D  # noqa: E402


def write(tmp: Path, obj_or_text: Any, bom: bool = False, crlf: bool = False,
          name: str = "samples.json") -> Path:
    text = obj_or_text if isinstance(obj_or_text, str) else json.dumps(obj_or_text, indent=2)
    if crlf:
        text = text.replace("\n", "\r\n")
    if bom:
        text = chr(0xFEFF) + text
    path = tmp / name
    with open(path, "wb") as handle:
        handle.write(text.encode("utf-8"))
    return path


def run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS / "doubling.py"), *args],
                          capture_output=True, text=True, encoding="utf-8")


def quad(ns: Iterable[int]) -> Dict[int, List[int]]:
    return {n: [n * (n + 1) // 2] for n in ns}


def doc(samples: Dict[int, List[Any]], kind: str = "count") -> Dict[str, Any]:
    return {"kind": kind, "unit": "reads", "samples": {str(n): v for n, v in samples.items()}}


SIZES = [1000, 2000, 4000, 8000]
PILOT = {2000: [18], 4000: [71], 8000: [196], 16000: [135]}


class AnalyseVerdictTest(unittest.TestCase):
    def test_quadratic_counts_are_superlinear(self) -> None:
        r = D.analyse(quad(SIZES), "count")
        self.assertEqual(r["verdict"], "superlinear")
        self.assertLess(abs(r["b_estimate"] - 2.0), 0.01)
        self.assertEqual(len(r["steps"]), 3)

    def test_linear_counts_are_not_superlinear(self) -> None:
        r = D.analyse({n: [3 * n] for n in SIZES}, "count")
        self.assertEqual(r["verdict"], "not-superlinear")
        self.assertLess(abs(r["b_estimate"] - 1.0), 0.01)

    def test_n_log_n_counts_are_not_superlinear(self) -> None:
        r = D.analyse({n: [round(n * math.log2(n))] for n in SIZES}, "count")
        self.assertEqual(r["verdict"], "not-superlinear")
        self.assertTrue(1.0 < r["b_estimate"] < 1.2, r["b_estimate"])

    def test_pilot_single_timings_are_insufficient(self) -> None:
        r = D.analyse(PILOT, "time")
        self.assertEqual(r["verdict"], "insufficient-samples")
        self.assertIn("2000", r["reason"])

    def test_falling_median_is_inconclusive(self) -> None:
        r = D.analyse({n: v * 10 for n, v in PILOT.items()}, "time")
        self.assertEqual(r["verdict"], "inconclusive")
        self.assertLess(r["steps"][-1]["b"], 0)

    def test_disagreeing_largest_steps_are_inconclusive(self) -> None:
        r = D.analyse({1000: [1000], 2000: [4000], 4000: [16000], 8000: [32000]}, "count")
        self.assertEqual(r["verdict"], "inconclusive")

    def test_only_two_largest_steps_decide(self) -> None:
        series = {1000: 4.19, 2000: 17.18, 4000: 9.37, 8000: 36.05, 16000: 154.12}
        r = D.analyse({n: [v] * 10 for n, v in series.items()}, "time")
        self.assertEqual(r["verdict"], "superlinear")

    def test_medians_ignore_single_outliers(self) -> None:
        samples = {}
        for n in SIZES:
            v = (n / 1000) ** 2
            samples[n] = [v * (1 + 0.01 * k) for k in range(-4, 5)] + [50 * v]
        r = D.analyse(samples, "time")
        self.assertEqual(r["verdict"], "superlinear")
        for row in r["sizes"]:
            v = (row["n"] / 1000) ** 2
            self.assertLess(abs(row["median"] - v) / v, 0.05)

    def test_noisy_largest_size(self) -> None:
        samples: Dict[int, List[float]] = {}
        for n in SIZES[:-1]:
            v = (n / 1000) ** 2
            samples[n] = [v * (1 + 0.001 * k) for k in range(10)]
        samples[8000] = [16, 30, 45, 64, 80, 100, 120, 140, 160, 180]
        r = D.analyse(samples, "time")
        self.assertEqual(r["verdict"], "noisy")
        self.assertIn("8000", r["reason"])

    def test_noise_in_small_sizes_is_tolerated(self) -> None:
        samples: Dict[int, List[float]] = {500: [0.05, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]}
        for n in SIZES:
            v = (n / 1000) ** 2
            samples[n] = [v * (1 + 0.001 * k) for k in range(10)]
        r = D.analyse(samples, "time")
        self.assertGreater(r["sizes"][0]["rel_iqr"], 0.5)
        self.assertEqual(r["verdict"], "superlinear")

    def test_discard_first_removes_warmup(self) -> None:
        samples = {}
        for n in SIZES:
            v = (n / 1000) ** 2
            samples[n] = [1000 * v] + [v] * 10
        r = D.analyse(samples, "time", discard_first=1)
        for row in r["sizes"]:
            self.assertEqual(row["values"], 10)
            self.assertEqual(row["max"], row["min"])
        self.assertEqual(r["verdict"], "superlinear")
        raw = D.analyse(samples, "time")
        for row in raw["sizes"]:
            self.assertEqual(row["values"], 11)
            self.assertGreater(row["max"], 100 * row["min"])

    def test_discard_leaving_too_few_is_insufficient(self) -> None:
        samples = {n: [float(n)] * 10 for n in SIZES}
        r = D.analyse(samples, "time", discard_first=1)
        self.assertEqual(r["verdict"], "insufficient-samples")

    def test_nondeterministic_counts(self) -> None:
        samples = quad(SIZES)
        samples[4000] = [8002000, 8002001]
        r = D.analyse(samples, "count")
        self.assertEqual(r["verdict"], "nondeterministic")
        self.assertIn("8002000 to 8002001", r["reason"])

    def test_zero_median_is_below_resolution(self) -> None:
        samples: Dict[int, List[float]] = {1000: [0.0] * 10}
        for n in SIZES[1:]:
            samples[n] = [float(n)] * 10
        r = D.analyse(samples, "time")
        self.assertEqual(r["verdict"], "below-resolution")
        self.assertEqual(r["steps"], [])

    def test_non_doubling_sizes_use_size_ratio(self) -> None:
        r = D.analyse({n: [n ** 2] for n in (1000, 3000, 9000, 27000)}, "count")
        self.assertEqual(r["verdict"], "superlinear")
        for step in r["steps"]:
            self.assertEqual(step["ratio"], 9.0)
            self.assertLess(abs(step["b"] - 2.0), 1e-6)

    def test_threshold_option(self) -> None:
        r = D.analyse(quad(SIZES), "count", threshold=2.5)
        self.assertEqual(r["verdict"], "not-superlinear")

    def test_sizes_sorted_numerically(self) -> None:
        samples = {}
        for n in (16000, 2000, 8000, 4000):
            samples[n] = [n * n]
        r = D.analyse(samples, "count")
        self.assertEqual([s["from"] for s in r["steps"]], [2000, 4000, 8000])

    def test_fewer_than_four_sizes_raises(self) -> None:
        with self.assertRaises(D.InputError):
            D.analyse(quad(SIZES[:3]), "count")

    def test_discard_with_count_kind_raises(self) -> None:
        with self.assertRaises(D.InputError):
            D.analyse(quad(SIZES), "count", discard_first=1)

    def test_bad_parameters_raise(self) -> None:
        for kwargs in ({"threshold": 0}, {"threshold": float("nan")}, {"min_samples": 0},
                       {"max_rel_iqr": -1}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(D.InputError):
                    D.analyse(quad(SIZES), "count", **kwargs)


class LoadSamplesTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_bom_and_crlf_are_accepted(self) -> None:
        path = write(self.tmp, doc(quad(SIZES)), bom=True, crlf=True)
        kind, unit, samples = D.load_samples(path)
        self.assertEqual(kind, "count")
        self.assertEqual(unit, "reads")
        self.assertEqual(sorted(samples), SIZES)
        self.assertTrue(all(isinstance(n, int) for n in samples))

    def test_bad_size_keys_rejected(self) -> None:
        for key in ["1e3", "-5", "01000", "abc", "0", "1.5"]:
            with self.subTest(key=key):
                data = {"kind": "count", "samples": {"2000": [4], "4000": [16], "8000": [64],
                                                     key: [1]}}
                path = write(self.tmp, data)
                with self.assertRaises(D.InputError) as ctx:
                    D.load_samples(path)
                self.assertIn(key, str(ctx.exception))

    def test_bad_values_rejected(self) -> None:
        for values in ([True], [], ["3"], [-1]):
            with self.subTest(values=values):
                data = {"kind": "count", "samples": {"1000": values, "2000": [4], "4000": [16],
                                                     "8000": [64]}}
                with self.assertRaises(D.InputError):
                    D.load_samples(write(self.tmp, data))
        for constant in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(constant=constant):
                text = ('{"kind": "count", "samples": {"1000": [' + constant + '], '
                        '"2000": [4], "4000": [16], "8000": [64]}}')
                with self.assertRaises(D.InputError):
                    D.load_samples(write(self.tmp, text))

    def test_overflowing_values_rejected(self) -> None:
        for big in ("1e999", "9" * 400):
            with self.subTest(big=big[:10]):
                text = ('{"kind": "count", "samples": {"1000": [' + big + '], '
                        '"2000": [4], "4000": [16], "8000": [64]}}')
                try:
                    D.load_samples(write(self.tmp, text))
                except D.InputError:
                    pass
                except OverflowError:  # pragma: no cover - the failure this test guards
                    self.fail("OverflowError escaped")
                else:
                    self.fail("no InputError for " + big[:10])

    def test_duplicate_size_key_rejected(self) -> None:
        text = ('{"kind":"count","samples":{"1000":[1],"1000":[2],"2000":[4],"4000":[16],'
                '"8000":[64]}}')
        with self.assertRaises(D.InputError) as ctx:
            D.load_samples(write(self.tmp, text))
        self.assertIn("duplicate", str(ctx.exception))

    def test_kind_missing_and_override(self) -> None:
        data = {"samples": {str(n): v for n, v in quad(SIZES).items()}}
        path = write(self.tmp, data)
        kind, _unit, _samples = D.load_samples(path, "count")
        self.assertEqual(kind, "count")
        with self.assertRaises(D.InputError) as ctx:
            D.load_samples(path)
        self.assertIn("kind missing", str(ctx.exception))
        with self.assertRaises(D.InputError) as ctx:
            D.load_samples(write(self.tmp, doc(quad(SIZES))), "time")
        self.assertIn("kind mismatch", str(ctx.exception))
        bad = doc(quad(SIZES))
        bad["kind"] = "fast"
        with self.assertRaises(D.InputError):
            D.load_samples(write(self.tmp, bad))

    def test_unit_must_be_text(self) -> None:
        data = doc(quad(SIZES))
        data["unit"] = 5
        with self.assertRaises(D.InputError):
            D.load_samples(write(self.tmp, data))
        data["unit"] = "ms"
        self.assertEqual(D.load_samples(write(self.tmp, data))[1], "ms")

    def test_top_level_and_empty_file_rejected(self) -> None:
        for text in ("[]", "", "{}"):
            with self.subTest(text=text):
                with self.assertRaises(D.InputError):
                    D.load_samples(write(self.tmp, text))


class CliTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_cli_superlinear_exit_0_and_json_shape(self) -> None:
        path = write(self.tmp, doc(quad(SIZES)))
        proc = run_cli(str(path), "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertTrue({"tool", "version", "kind", "unit", "threshold", "min_samples",
                         "discard_first", "max_rel_iqr", "sizes", "steps", "b_estimate",
                         "verdict", "reason"} <= set(data))
        for row in data["sizes"]:
            self.assertEqual(set(row), {"n", "values", "median", "q1", "q3", "min", "max",
                                        "rel_iqr"})
        froms = [s["from"] for s in data["steps"]]
        self.assertTrue(all(isinstance(f, int) for f in froms))
        self.assertEqual(froms, sorted(froms))
        self.assertEqual(data["verdict"], "superlinear")

    def test_cli_not_conclusive_exit_3(self) -> None:
        path = write(self.tmp, {"kind": "time", "unit": "ms",
                                "samples": {str(n): v for n, v in PILOT.items()}})
        proc = run_cli(str(path))
        self.assertEqual(proc.returncode, 3, proc.stderr)
        self.assertIn("verdict: insufficient-samples", proc.stdout)

    def test_cli_bad_input_exit_2(self) -> None:
        proc = run_cli(str(self.tmp / "missing.json"))
        self.assertEqual(proc.returncode, 2)
        self.assertTrue(proc.stderr.strip())
        proc = run_cli(str(write(self.tmp, "{not json")))
        self.assertEqual(proc.returncode, 2)

    def test_cli_out_writes_file_with_os_separators(self) -> None:
        path = write(self.tmp, doc(quad(SIZES)))
        out = os.path.join(str(self.tmp), "a", "b", "r.json")
        proc = run_cli(str(path), "--json", "--out", out)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        raw = Path(out).read_bytes().decode("utf-8")
        self.assertEqual(json.loads(raw), json.loads(proc.stdout))
        self.assertTrue(raw.endswith("\n"))
        self.assertNotIn("\r\n", raw)

    def test_cli_out_refuses_to_overwrite_input(self) -> None:
        path = write(self.tmp, doc(quad(SIZES)))
        before = path.read_bytes()
        proc = run_cli(str(path), "--out", str(path))
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(path.read_bytes(), before)

    @unittest.skipUnless(os.name == "nt", "case-insensitive paths")
    def test_cli_out_refuses_input_in_other_case(self) -> None:
        path = write(self.tmp, doc(quad(SIZES)), name="Samples.json")
        before = path.read_bytes()
        proc = run_cli(str(path), "--out", str(path.parent / "sAMPLES.JSON"))
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(path.read_bytes(), before)

    def test_cli_rejects_bad_options(self) -> None:
        path = write(self.tmp, doc(quad(SIZES)))
        for option in (["--threshold", "0"], ["--min-samples", "0"], ["--max-rel-iqr", "-1"],
                       ["--kind", "slow"]):
            with self.subTest(option=option):
                self.assertEqual(run_cli(str(path), *option).returncode, 2)

    def test_cli_kind_override(self) -> None:
        path = write(self.tmp, {"samples": {str(n): v for n, v in quad(SIZES).items()}})
        proc = run_cli(str(path), "--kind", "count", "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["verdict"], "superlinear")

    def test_cli_help_exit_0(self) -> None:
        proc = run_cli("--help")
        self.assertEqual(proc.returncode, 0)
        self.assertIn("doubling", proc.stdout)


if __name__ == "__main__":
    unittest.main()
