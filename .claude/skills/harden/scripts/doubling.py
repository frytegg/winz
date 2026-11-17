#!/usr/bin/env python3
"""Judge a doubling run: how a measured cost grows as the input size grows.

Purpose
    PE-09 confirms a suspected super-linear defect by measuring at n, 2n, 4n, 8n. A single
    timing per size is noise (the autonomous pilot read 18, 71, 196 and 135 ms as
    "inconclusive" and parked a quadratic loop; pilot-auto-calibration A01-F13), so the verdict
    is computed here, the same way every time, from operation counts (deterministic) or from
    the medians of repeated timings.

    For consecutive sizes n_i < n_(i+1) with medians m_i, the step exponent is
        b_i = ln(m_(i+1) / m_i) / ln(n_(i+1) / n_i)
    (log2 of the ratio when the size doubles): about 1 is linear, about 2 quadratic.
    Constant factors, JIT tiers, garbage collection and caches distort small sizes, so only the
    two largest steps decide:
        superlinear      both >= --threshold (default 1.5, halfway between linear and quadratic)
        not-superlinear  both >= 0 and < --threshold
        inconclusive     they disagree, or one is negative (a median fell as n grew)
    not-superlinear means below --threshold, not linear: doubling cannot separate a
    logarithmic factor (n log n gives b of about 1.1).
    Checked first, in this order; the first that applies is the verdict:
        insufficient-samples  a size has fewer than --min-samples values after --discard-first
                              (defaults: 10 for kind time, hyperfine's default run count;
                              1 for kind count)
        nondeterministic      kind count and the values of one size differ
        below-resolution      a size's median is 0
        noisy                 kind time and one of the three largest sizes has a relative
                              interquartile range (q3 - q1) / median above --max-rel-iqr (0.5)
    The thresholds are conventions, not validated values (lens-performance PE-09).

Input (UTF-8; a byte-order mark and CRLF line ends are accepted)
    {"kind": "count" | "time", "unit": "<free text>", "samples": {"<n>": [<number>, ...], ...}}
    n is a positive decimal integer without leading zeros; at least 4 sizes; every value is a
    finite, non-negative number (true/false, NaN, Infinity, strings and duplicate sizes are
    rejected). Other top-level keys are ignored.

CLI
    python doubling.py <samples.json> [--kind count|time] [--threshold B] [--min-samples N]
                       [--discard-first K] [--max-rel-iqr R] [--json] [--out PATH]
    (use python3 on macOS/Linux)
    --kind           used when the file has no "kind"; a file "kind" that differs is an error
    --discard-first  drop the first K values of each size (warm-up runs); kind time only
    --json           print the JSON result instead of the text table
    --out PATH       also write the JSON result there (parent directories are created); it may
                     not be the input file

Exit codes
    0  conclusive: superlinear or not-superlinear
    2  unreadable or invalid input, or a bad option
    3  not conclusive: inconclusive, noisy, insufficient-samples, below-resolution or
       nondeterministic (measure again: operation counts, larger n or more repetitions)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import statistics
import sys
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)

VERSION = 1
KINDS = ("count", "time")
CONCLUSIVE = ("superlinear", "not-superlinear")
MIN_SIZES = 4
SIZE_KEY_RE = re.compile(r"^[1-9][0-9]*$")


class InputError(Exception):
    """Bad input file or option."""


def _reject_constant(name: str) -> Any:
    raise InputError("non-finite value {} is not allowed".format(name))


def _reject_duplicates(pairs: List[Tuple[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise InputError("duplicate key {}".format(key))
        out[key] = value
    return out


def load_samples(path: Path, kind_override: Optional[str] = None
                 ) -> Tuple[str, Optional[str], Dict[int, List[float]]]:
    """Read a samples file; return (kind, unit, {n: [values]})."""
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise InputError("{}: cannot read: {}".format(path, exc)) from exc
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise InputError("{}: not UTF-8".format(path)) from exc
    try:
        doc = json.loads(text, parse_constant=_reject_constant,
                         object_pairs_hook=_reject_duplicates)
    except json.JSONDecodeError as exc:
        raise InputError("{}: not valid JSON: {}".format(path, exc.msg)) from exc
    if not isinstance(doc, dict):
        raise InputError("top level must be an object")
    kind = doc.get("kind")
    if kind is not None and kind not in KINDS:
        raise InputError("kind must be 'count' or 'time', not {!r}".format(kind))
    if kind_override is not None:
        if kind_override not in KINDS:
            raise InputError("--kind must be 'count' or 'time'")
        if kind is not None and kind != kind_override:
            raise InputError("kind mismatch: file says {}, --kind says {}".format(
                kind, kind_override))
        kind = kind_override
    if kind is None:
        raise InputError('kind missing: give "kind" in the file or --kind')
    unit = doc.get("unit")
    if unit is not None and not isinstance(unit, str):
        raise InputError("unit must be a string")
    raw = doc.get("samples")
    if not isinstance(raw, dict):
        raise InputError("samples must be an object mapping sizes to value lists")
    samples: Dict[int, List[float]] = {}
    for key, values in raw.items():
        if not SIZE_KEY_RE.match(key):
            raise InputError("size {} is not a positive integer".format(key))
        if not isinstance(values, list) or not values:
            raise InputError("size {}: values must be a non-empty list".format(key))
        converted: List[float] = []
        for index, value in enumerate(values):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise InputError("size {}: value {} is not a number".format(key, index))
            try:
                number = float(value)
            except OverflowError as exc:
                raise InputError("size {}: value {} is too large".format(key, index)) from exc
            if not math.isfinite(number):
                raise InputError("size {}: value {} is not finite".format(key, index))
            if number < 0:
                raise InputError("size {}: value {} is negative".format(key, index))
            converted.append(number)
        samples[int(key)] = converted
    if len(samples) < MIN_SIZES:
        raise InputError("at least {} sizes are needed, got {}".format(MIN_SIZES, len(samples)))
    return kind, unit, samples


def _positive_finite(value: float, name: str) -> None:
    if not (isinstance(value, (int, float)) and math.isfinite(value) and value > 0):
        raise InputError("{} must be a finite number above 0".format(name))


def _row(n: int, vals: List[float]) -> Dict[str, Any]:
    if not vals:
        return {"n": n, "values": 0, "median": None, "q1": None, "q3": None, "min": None,
                "max": None, "rel_iqr": None}
    median = statistics.median(vals)
    if len(vals) >= 2:
        q1, _q2, q3 = statistics.quantiles(vals, n=4, method="inclusive")
    else:
        q1 = q3 = vals[0]
    rel = round((q3 - q1) / median, 4) if median > 0 else None
    return {"n": n, "values": len(vals), "median": median, "q1": q1, "q3": q3,
            "min": min(vals), "max": max(vals), "rel_iqr": rel}


def analyse(samples: Mapping[int, Sequence[float]], kind: str, threshold: float = 1.5,
            min_samples: Optional[int] = None, discard_first: int = 0,
            max_rel_iqr: float = 0.5) -> Dict[str, Any]:
    """Compute the per-size statistics, the step exponents and the verdict."""
    if kind not in KINDS:
        raise InputError("kind must be 'count' or 'time'")
    if len(samples) < MIN_SIZES:
        raise InputError("at least {} sizes are needed, got {}".format(MIN_SIZES, len(samples)))
    _positive_finite(threshold, "--threshold")
    _positive_finite(max_rel_iqr, "--max-rel-iqr")
    if min_samples is not None and (isinstance(min_samples, bool) or min_samples < 1):
        raise InputError("--min-samples must be at least 1")
    if discard_first < 0:
        raise InputError("--discard-first must be 0 or more")
    if discard_first and kind == "count":
        raise InputError("--discard-first applies to kind time only")
    resolved_min = min_samples if min_samples is not None else (10 if kind == "time" else 1)
    sizes = sorted(samples)
    kept = {n: list(samples[n])[discard_first:] for n in sizes}
    rows = [_row(n, kept[n]) for n in sizes]
    steps: List[Dict[str, Any]] = []
    exponents: List[float] = []
    if all(r["values"] >= 1 and r["median"] is not None and r["median"] > 0 for r in rows):
        for a, b in zip(rows, rows[1:]):
            ratio = b["median"] / a["median"]
            exponent = math.log(ratio) / math.log(b["n"] / a["n"])
            exponents.append(exponent)
            steps.append({"from": a["n"], "to": b["n"], "ratio": round(ratio, 4),
                          "b": round(exponent, 4)})
    b_estimate = round((exponents[-1] + exponents[-2]) / 2, 4) if len(exponents) >= 2 else None

    verdict, reason = _verdict(kind, rows, kept, steps, exponents, threshold, resolved_min,
                               discard_first, max_rel_iqr)
    return {"tool": "doubling.py", "version": VERSION, "kind": kind, "threshold": threshold,
            "min_samples": resolved_min, "discard_first": discard_first,
            "max_rel_iqr": max_rel_iqr, "sizes": rows, "steps": steps, "b_estimate": b_estimate,
            "verdict": verdict, "reason": reason}


def _num(value: float) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return repr(value)


def _verdict(kind: str, rows: List[Dict[str, Any]], kept: Mapping[int, List[float]],
             steps: List[Dict[str, Any]], exponents: List[float], threshold: float,
             min_samples: int, discard_first: int, max_rel_iqr: float) -> Tuple[str, str]:
    for r in rows:
        if r["values"] < min_samples:
            return ("insufficient-samples",
                    "size {} has {} value(s) after discarding {}; at least {} needed".format(
                        r["n"], r["values"], discard_first, min_samples))
    if kind == "count":
        for r in rows:
            vals = kept[r["n"]]
            if min(vals) != max(vals):
                return ("nondeterministic", "size {} has differing counts: {} to {}".format(
                    r["n"], _num(min(vals)), _num(max(vals))))
    for r in rows:
        if r["median"] == 0:
            return ("below-resolution",
                    "size {} has a median of 0; use larger n or a finer timer".format(r["n"]))
    if kind == "time":
        for r in rows[-3:]:
            if r["rel_iqr"] is not None and r["rel_iqr"] > max_rel_iqr:
                return ("noisy", "size {} has a relative IQR of {} (limit {})".format(
                    r["n"], r["rel_iqr"], max_rel_iqr))
    last = exponents[-2:]
    for step, exponent in zip(steps[-2:], last):
        if exponent < 0:
            return ("inconclusive", "a median fell as n grew (step {}->{}, b = {:.3f})".format(
                step["from"], step["to"], exponent))
    b1, b2 = last
    if b1 >= threshold and b2 >= threshold:
        return ("superlinear", "both largest steps at or above {} (b = {:.3f}, {:.3f})".format(
            threshold, b1, b2))
    if b1 < threshold and b2 < threshold:
        return ("not-superlinear", "both largest steps below {} (b = {:.3f}, {:.3f})".format(
            threshold, b1, b2))
    return ("inconclusive", "the two largest steps disagree (b = {:.3f}, {:.3f}; threshold {})"
            .format(b1, b2, threshold))


def format_text(result: Dict[str, Any]) -> str:
    """A small text table: sizes, steps and the verdict."""
    lines = ["doubling.py  kind={}  unit={}  threshold={}".format(
        result["kind"], result.get("unit") or "-", result["threshold"])]
    lines.append("{:>12}  {:>6}  {:>14}  {:>8}".format("n", "values", "median", "rel_iqr"))
    for r in result["sizes"]:
        median = "-" if r["median"] is None else "{:.6g}".format(r["median"])
        rel = "-" if r["rel_iqr"] is None else "{:.4f}".format(r["rel_iqr"])
        lines.append("{:>12}  {:>6}  {:>14}  {:>8}".format(r["n"], r["values"], median, rel))
    for s in result["steps"]:
        lines.append("step {} -> {}: ratio {}, b {}".format(s["from"], s["to"], s["ratio"],
                                                           s["b"]))
    lines.append("verdict: {} ({})".format(result["verdict"], result["reason"]))
    return "\n".join(lines)


def _same_file(a: Path, b: Path) -> bool:
    if os.path.normcase(str(a.resolve())) == os.path.normcase(str(b.resolve())):
        return True
    try:
        return a.exists() and b.exists() and os.path.samefile(str(a), str(b))
    except OSError:
        return False


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        prog="doubling.py",
        description="Judge a doubling run (PE-09): the growth exponent of the two largest steps.")
    parser.add_argument("samples", help="samples JSON file")
    parser.add_argument("--kind", choices=KINDS, help="kind when the file has none")
    parser.add_argument("--threshold", type=float, default=1.5,
                        help="exponent at or above which a step is super-linear (default 1.5)")
    parser.add_argument("--min-samples", type=int, default=None,
                        help="values needed per size (default 10 for time, 1 for count)")
    parser.add_argument("--discard-first", type=int, default=0,
                        help="drop the first K values of each size (warm-up; kind time only)")
    parser.add_argument("--max-rel-iqr", type=float, default=0.5,
                        help="noise limit for the three largest sizes (default 0.5)")
    parser.add_argument("--json", action="store_true", help="print the JSON result")
    parser.add_argument("--out", help="also write the JSON result to this path")
    args = parser.parse_args(argv)
    in_path = Path(args.samples)
    if args.out and _same_file(Path(args.out), in_path):
        print("doubling.py: --out would overwrite the input", file=sys.stderr)
        return 2
    try:
        kind, unit, samples = load_samples(in_path, args.kind)
        result = analyse(samples, kind, threshold=args.threshold, min_samples=args.min_samples,
                         discard_first=args.discard_first, max_rel_iqr=args.max_rel_iqr)
    except InputError as exc:
        print("doubling.py: {}".format(exc), file=sys.stderr)
        return 2
    ordered: Dict[str, Any] = {}
    for key, value in result.items():
        ordered[key] = value
        if key == "kind":
            ordered["unit"] = unit
    if args.json:
        print(json.dumps(ordered, indent=2, ensure_ascii=False))
    else:
        print(format_text(ordered))
    if args.out:
        try:
            C.write_json(Path(args.out), ordered)
        except OSError as exc:
            print("doubling.py: cannot write --out: {}".format(exc), file=sys.stderr)
            return 2
    return 0 if ordered["verdict"] in CONCLUSIVE else 3


if __name__ == "__main__":
    sys.exit(main())
