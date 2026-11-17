"""Hidden behaviour tests: the command-line interface and its output contracts."""

from __future__ import annotations

import csv
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
EXAMPLES = REPO / "examples"


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO / "src") + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def _run_module(*args: str) -> subprocess.CompletedProcess[str]:
    """Run ``python -m tradelog`` in a fresh interpreter (no state shared with this process)."""
    return subprocess.run(
        [sys.executable, "-m", "tradelog", *args],
        cwd=REPO,
        env=_env(),
        capture_output=True,
        text=True,
        timeout=120,
    )


def _main(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, str]:
    from tradelog.cli import main

    code = main(list(args))
    return code, capsys.readouterr().out


# ------------------------------------------------------------------ pnl (X02)


def test_pnl_text(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(
        capsys, "pnl", str(EXAMPLES / "fills.csv"), "--marks", str(EXAMPLES / "marks.json")
    )
    assert code == 0
    for symbol in ("BTCUSD", "ETHUSD", "SOLUSDT"):
        assert symbol in out
    for label in ("realized", "unrealized", "fees", "net"):
        assert re.search(rf"^{label}\s+-?[\d.]+$", out, re.M), label
    assert re.search(r"^net\s+1317\.02$", out, re.M)


def test_pnl_json_contract(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(
        capsys,
        "pnl",
        str(EXAMPLES / "fills.csv"),
        "--marks",
        str(EXAMPLES / "marks.json"),
        "--format",
        "json",
    )
    assert code == 0
    payload = json.loads(out)
    assert set(payload) >= {"totals", "positions"}
    assert set(payload["totals"]) >= {"realized", "unrealized", "fees", "net"}
    assert float(payload["totals"]["realized"]) == pytest.approx(1296.875)
    assert float(payload["totals"]["unrealized"]) == pytest.approx(346.5)
    rows = {row["symbol"]: row for row in payload["positions"]}
    assert set(rows) == {"BTCUSD", "ETHUSD", "SOLUSDT"}
    for row in rows.values():
        assert set(row) >= {
            "symbol", "qty", "avg_price", "realized", "unrealized", "fees", "fill_count",
        }
    assert rows["BTCUSD"]["fill_count"] == 6
    assert rows["ETHUSD"]["fill_count"] == 3
    assert rows["SOLUSDT"]["fill_count"] == 2


def test_pnl_csv_format_is_reachable(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(capsys, "pnl", str(EXAMPLES / "fills.csv"), "--format", "csv")
    assert code == 0
    lines = out.strip().splitlines()
    assert lines[0] == "symbol,qty,avg_price,realized,unrealized,fees,fill_count"
    rows = list(csv.DictReader(io.StringIO(out)))
    assert [r["symbol"] for r in rows] == ["BTCUSD", "ETHUSD", "SOLUSDT"]
    assert [int(r["fill_count"]) for r in rows] == [6, 3, 2]


def test_renderers_resolve_by_format_name() -> None:
    from tradelog import build_positions, load_fills, summarize
    from tradelog.reporting import FORMATS, get_renderer, render

    positions = build_positions(load_fills(EXAMPLES / "fills.csv"))
    summary = summarize(positions)
    assert set(FORMATS) == {"text", "json", "csv"}
    for fmt in FORMATS:
        assert callable(get_renderer(fmt))
        assert render(summary, positions, fmt).strip()
    with pytest.raises(ValueError):
        get_renderer("xml")


def test_pnl_without_marks(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(capsys, "pnl", str(EXAMPLES / "fills.csv"), "--venue", "binance")
    assert code == 0
    assert re.search(r"^unrealized\s+0\.00$", out, re.M)


def test_missing_fills_file_exit_code(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    from tradelog.cli import main

    assert main(["pnl", str(tmp_path / "missing.csv")]) == 2
    assert "error" in capsys.readouterr().err


# ---------------------------------------------------------------- journal


def test_journal_command() -> None:
    proc = _run_module("journal", str(EXAMPLES / "fills.csv"))
    assert proc.returncode == 0, proc.stderr
    lines = proc.stdout.strip().splitlines()
    assert len(lines) == 12
    actions = [line.split()[6] for line in lines[:-1]]
    assert actions == [
        "open", "open", "reduce", "reduce", "add", "open", "close", "reduce", "flip", "close", "open",
    ]
    assert lines[-1] == "actions: add=1, close=2, flip=1, open=4, reduce=3"


# -------------------------------------------------- backtest (X01, X05, X06)


def test_strategies_listing_in_fresh_interpreter() -> None:
    proc = _run_module("strategies")
    assert proc.returncode == 0, proc.stderr
    names = [line.split()[0] for line in proc.stdout.strip().splitlines()]
    assert names == ["momentum", "sma_cross"]


def test_registry_populated_by_package_import() -> None:
    code = "import tradelog.strategies as s; print(','.join(s.list_strategies()))"
    proc = subprocess.run(
        [sys.executable, "-c", code], cwd=REPO, env=_env(), capture_output=True, text=True
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "momentum,sma_cross"


def test_backtest_json_output_contract(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(
        capsys, "backtest", "--symbol", "BTCUSD", "--param", "fast=5", "--param", "slow=20", "--json"
    )
    assert code == 0
    payload = json.loads(out)
    assert payload["schema_version"] == 1
    assert payload["symbol"] == "BTCUSD"
    assert payload["strategy"] == "sma_cross"
    assert payload["params"] == {"fast": 5, "slow": 20, "ma": "sma", "allow_short": False}
    assert payload["trade_count"] == 8 == len(payload["trades"])
    assert "max_drawdown" in payload and "win_rate" in payload
    assert payload["trades"][0]["entry_day"] == "2025-06-21"
    assert payload["trades"][-1]["exit_day"] == "2026-01-16"


def test_backtest_from_config_file(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(capsys, "backtest", "--config", str(EXAMPLES / "config.toml"), "--json")
    assert code == 0
    payload = json.loads(out)
    assert payload["schema_version"] == 1
    assert payload["symbol"] == "ETHUSD"
    assert payload["strategy"] == "mean_revert"
    assert payload["params"] == {"window": 20, "entry_z": 1.5, "exit_z": 0.25, "allow_short": True}
    assert payload["trade_count"] == 18
    sides = [t["side"] for t in payload["trades"]]
    assert sides.count("buy") == 8 and sides.count("sell") == 10
    assert [(t["entry_day"], t["exit_day"]) for t in payload["trades"][:3]] == [
        ("2025-06-24", "2025-07-03"),
        ("2025-07-20", "2025-07-25"),
        ("2025-07-25", "2025-08-03"),
    ]


def test_backtest_text_summary_and_param_override(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(
        capsys, "backtest", "--config", str(EXAMPLES / "config.toml"), "--param", "window=10"
    )
    assert code == 0
    assert out.splitlines()[0].startswith("ETHUSD  mean_revert(")
    assert "window=10" in out
    for label in ("bars", "trades", "win rate", "final equity", "total return", "max drawdown"):
        assert label in out


def test_backtest_bad_param_is_an_error(capsys: pytest.CaptureFixture[str]) -> None:
    from tradelog.cli import main

    assert main(["backtest", "--param", "fast"]) == 2
    assert main(["backtest", "--param", "nonsense=1"]) == 2
    assert main(["backtest", "--strategy", "no_such_strategy"]) == 2


def test_version_flag() -> None:
    proc = _run_module("--version")
    assert proc.returncode == 0
    assert proc.stdout.strip() == "tradelog 0.1.0"


# ------------------------------------------------------------------ poll


def test_poll_with_static_fetcher(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(
        capsys, "poll", "BTCUSD", "ETHUSD", "--fetcher", "static",
        "--iterations", "1", "--interval", "0", "--spacing", "0",
    )
    assert code == 0
    lines = out.strip().splitlines()
    assert len(lines) == 2
    assert re.search(r"\bBTCUSD\s+71,016\.79$", lines[0])
    assert re.search(r"\bETHUSD\s+1,710\.24$", lines[1])


def test_poll_fetcher_class_loaded_by_name(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(
        capsys, "poll", "BTCUSD", "--fetcher", "hidden_fakes:FixedPriceFetcher",
        "--iterations", "2", "--interval", "0", "--spacing", "0",
    )
    assert code == 0
    assert out.count("123.45") == 2


def test_poll_fetcher_function_loaded_by_name(capsys: pytest.CaptureFixture[str]) -> None:
    code, out = _main(
        capsys, "poll", "ETHUSD", "--fetcher", "hidden_fakes:fixed_price_fetcher",
        "--iterations", "1", "--interval", "0",
    )
    assert code == 0
    assert "246.90" in out


def test_poll_unknown_fetcher_reference_is_an_error(capsys: pytest.CaptureFixture[str]) -> None:
    from tradelog.cli import main

    assert main(["poll", "BTCUSD", "--fetcher", "no_such_module:Thing", "--iterations", "1"]) == 2
