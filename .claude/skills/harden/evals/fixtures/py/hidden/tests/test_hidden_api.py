"""Hidden behaviour tests: library API.

These pin observable behaviour that any behaviour-preserving cleanup must keep.
They deliberately avoid pinning values a legitimate behaviour-changing fix would
alter (sub-cent fee rounding, short-side backtest fees, epoch timestamps in the
local zone, max_drawdown, what happens to malformed rows).
"""

from __future__ import annotations

import enum
import math
from datetime import date, datetime
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
EXAMPLES = REPO / "examples"


def _f(x: object) -> float:
    """Compare money-ish values as floats so a Decimal migration still passes."""
    return float(x)  # type: ignore[arg-type]


def _naive(ts: datetime) -> datetime:
    return ts.replace(tzinfo=None)


# ------------------------------------------------------------- public API (X03)


def test_documented_library_api_is_exported() -> None:
    import tradelog

    for name in (
        "build_positions",
        "create_strategy",
        "effective_fee_rate",
        "estimate_fee",
        "list_strategies",
        "load_fills",
        "load_series",
        "parse_fills",
        "run_backtest",
        "schedule_for",
        "summarize",
    ):
        assert hasattr(tradelog, name), name
        assert name in tradelog.__all__, name


def test_effective_fee_rate_public_api() -> None:
    from tradelog import Fill, Side, effective_fee_rate

    fills = [
        Fill("a", datetime(2026, 1, 1), "BTCUSD", Side.BUY, 1.0, 10_000.0, fee=10.0),
        Fill("b", datetime(2026, 1, 2), "BTCUSD", Side.SELL, 1.0, 10_000.0, fee=10.0),
    ]
    assert _f(effective_fee_rate(fills)) == pytest.approx(0.001)
    assert _f(effective_fee_rate([])) == 0.0


def test_indicators_public_api() -> None:
    from tradelog.indicators import ema, pct_change, rolling_std, sma, zscore

    assert ema([1, 2, 3, 4, 5, 6], 3) == [None, None, 2.0, 3.0, 4.0, 5.0]
    assert sma([2, 4, 6], 2) == [None, 3.0, 5.0]
    assert pct_change([10, 12], 1)[1] == pytest.approx(0.2)
    assert rolling_std([1, 3], 2)[1] == pytest.approx(1.0)
    assert zscore([1, 2, 3, 10], 3)[-1] == pytest.approx((10 - 5) / math.sqrt(38 / 3))


def test_live_package_exports() -> None:
    from tradelog.live import HttpFetcher, PricePoller, Quote, StaticFetcher

    assert callable(HttpFetcher) and callable(StaticFetcher)
    assert PricePoller and Quote


# ----------------------------------------------------------------- fills parsing


DIALECTS = """id,time,symbol,side,qty,price,fee,fee_currency,fee_type,venue
r1,2026-03-01T10:00:00Z,btc/usdt,B,0.5,40000,0.1%,,,
r2,2026-03-01T11:00:00Z,ETH-EUR,buy,-2,2000,1.5,,,binance
r3,2026-03-01T12:00:00Z,SOLUSDT,sell,-10,100,-0.25,,rebate,kraken
r4,2026-03-01T13:00:00Z,BTCUSD,,-1,41000,-4.1,,,coinbase
r5,2026-03-01T14:00:00Z,BTCUSD,,3,41500,,USDC,,Coinbase
r6,2026-03-01T15:00:00+01:00,XYZ,short,1,5,0.01,,,
r1,2026-03-01T16:00:00Z,BTCUSD,buy,99,1,0,,,
"""


def _dialect_fills():
    from tradelog.fills import parse_fills

    return {f.fill_id: f for f in parse_fills(DIALECTS.splitlines(), default_venue="paper")}


def test_dialect_sides_and_quantities() -> None:
    from tradelog.models import Side

    fills = _dialect_fills()
    assert set(fills) == {"r1", "r2", "r3", "r4", "r5", "r6"}
    expected = {
        "r1": (Side.BUY, 0.5),
        "r2": (Side.SELL, 2.0),
        "r3": (Side.SELL, 10.0),
        "r4": (Side.SELL, 1.0),
        "r5": (Side.BUY, 3.0),
        "r6": (Side.SELL, 1.0),
    }
    for fid, (side, qty) in expected.items():
        assert fills[fid].side is side, fid
        assert _f(fills[fid].qty) == pytest.approx(qty), fid


def test_dialect_fees() -> None:
    fills = _dialect_fills()
    assert _f(fills["r1"].fee) == pytest.approx(20.0)  # 0.1% of 0.5 * 40000
    assert _f(fills["r2"].fee) == pytest.approx(1.5)
    assert _f(fills["r3"].fee) == pytest.approx(-0.25)  # rebate keeps its sign
    assert _f(fills["r4"].fee) == pytest.approx(4.1)  # negative non-rebate is normalised
    assert _f(fills["r5"].fee) == 0.0


def test_dialect_fee_currency_symbol_and_venue() -> None:
    fills = _dialect_fills()
    assert {fid: f.fee_currency for fid, f in fills.items()} == {
        "r1": "USDT",
        "r2": "EUR",
        "r3": "USDT",
        "r4": "USD",
        "r5": "USDC",
        "r6": "USD",
    }
    assert {fid: f.symbol for fid, f in fills.items()} == {
        "r1": "BTCUSDT",
        "r2": "ETHEUR",
        "r3": "SOLUSDT",
        "r4": "BTCUSD",
        "r5": "BTCUSD",
        "r6": "XYZ",
    }
    assert fills["r1"].venue == "paper"  # default venue
    assert fills["r5"].venue == "coinbase"


def test_duplicate_id_keeps_first_occurrence() -> None:
    fills = _dialect_fills()
    assert fills["r1"].symbol == "BTCUSDT"
    assert _f(fills["r1"].qty) == pytest.approx(0.5)


def test_fills_sorted_by_utc_time() -> None:
    from tradelog.fills import parse_fills

    ordered = [f.fill_id for f in parse_fills(DIALECTS.splitlines())]
    # r6 is 15:00+01:00 == 14:00Z, i.e. same instant as r5; stable sort keeps file order
    assert ordered == ["r1", "r2", "r3", "r4", "r5", "r6"]
    r6 = [f for f in parse_fills(DIALECTS.splitlines()) if f.fill_id == "r6"][0]
    assert _naive(r6.ts) == datetime(2026, 3, 1, 14, 0)


def test_many_duplicates_are_collapsed() -> None:
    from tradelog.fills import parse_fills

    rows = ["id,time,symbol,side,qty,price"]
    for i in range(3000):
        rows.append(f"id{i % 1000},2026-01-01T00:00:{i % 60:02d}Z,BTCUSD,buy,{i + 1},100")
    fills = parse_fills(rows)
    assert len(fills) == 1000
    assert sorted(_f(f.qty) for f in fills) == [float(i + 1) for i in range(1000)]


def test_missing_required_column_is_an_error() -> None:
    from tradelog.fills import FillParseError, parse_fills

    with pytest.raises(FillParseError):
        parse_fills(["id,time,symbol,side,price", "a,2026-01-01T00:00:00Z,BTCUSD,buy,1"])
    with pytest.raises(FillParseError):
        parse_fills([])


def test_iso_timestamps_are_utc() -> None:
    from tradelog.timeutil import format_ts, parse_ts

    assert _naive(parse_ts("2026-01-05T12:00:00+02:00")) == datetime(2026, 1, 5, 10, 0)
    assert _naive(parse_ts(" 2026-01-05T12:00:00Z ")) == datetime(2026, 1, 5, 12, 0)
    assert parse_ts("1767225600") == parse_ts("1767225600000")
    assert format_ts(datetime(2026, 1, 5, 10, 0)) == "2026-01-05T10:00:00Z"
    with pytest.raises(ValueError):
        parse_ts("   ")


# --------------------------------------------------------- positions, pnl, journal


def test_example_positions() -> None:
    from tradelog import build_positions, load_fills

    fills = load_fills(EXAMPLES / "fills.csv")
    assert [f.fill_id for f in fills] == [f"f-10{i:02d}" for i in range(1, 12)]
    positions = build_positions(fills)
    btc, eth, sol = positions["BTCUSD"], positions["ETHUSD"], positions["SOLUSDT"]
    assert _f(btc.qty) == pytest.approx(0.2)
    assert _f(btc.avg_price) == pytest.approx(63_500.0)
    assert _f(btc.realized_pnl) == pytest.approx(596.0)
    assert btc.fill_count == 6
    assert eth.is_flat
    assert _f(eth.realized_pnl) == pytest.approx(494.625)
    assert _f(sol.qty) == pytest.approx(15.0)
    assert _f(sol.realized_pnl) == pytest.approx(206.25)


def test_example_summary_with_marks() -> None:
    from tradelog import build_positions, load_fills, summarize

    positions = build_positions(load_fills(EXAMPLES / "fills.csv"))
    summary = summarize(positions, {"BTCUSD": 64_250.0, "SOLUSDT": 155.2})
    assert _f(summary.realized) == pytest.approx(1296.875)
    assert _f(summary.unrealized) == pytest.approx(150.0 + 196.5)
    assert _f(summary.fees) == pytest.approx(326.3552)
    assert _f(summary.net) == pytest.approx(1296.875 + 346.5 - 326.3552)


def test_unmarked_symbol_contributes_no_unrealized() -> None:
    from tradelog import build_positions, load_fills, summarize

    positions = build_positions(load_fills(EXAMPLES / "fills.csv"))
    assert _f(summarize(positions, {}).unrealized) == pytest.approx(0.0)


def test_unknown_side_is_rejected_by_the_default_branch() -> None:
    """X07: the ``case _`` branch of apply_fill guards future Side variants."""
    from tradelog.models import Fill, Position
    from tradelog.positions import apply_fill

    future_side = enum.Enum("FutureSide", {"HOLD": "hold"}).HOLD
    with pytest.raises((ValueError, TypeError)):
        fill = Fill("x", datetime(2026, 1, 1), "BTCUSD", future_side, 1.0, 100.0)  # type: ignore[arg-type]
        apply_fill(Position(symbol="BTCUSD"), fill)


def test_journal_actions_and_realized() -> None:
    from tradelog import load_fills
    from tradelog.journal import action_counts, build_journal

    entries = build_journal(load_fills(EXAMPLES / "fills.csv"))
    assert [e.action for e in entries] == [
        "open", "open", "reduce", "reduce", "add", "open", "close", "reduce", "flip", "close", "open",
    ]
    assert [round(_f(e.realized), 6) for e in entries] == [
        0.0, 0.0, 135.0, 108.375, 0.0, 0.0, 386.25, 206.25, 391.0, 70.0, 0.0,
    ]
    assert action_counts(entries, {}) == {"open": 4, "reduce": 3, "add": 1, "close": 2, "flip": 1}


# -------------------------------------------------------------------- fees (X04)


def test_unknown_venue_falls_back_to_default_schedule() -> None:
    from tradelog.fees import DEFAULT_SCHEDULE, FeeSchedule, schedule_for

    assert schedule_for("some-new-venue") == DEFAULT_SCHEDULE
    assert schedule_for("") == DEFAULT_SCHEDULE
    assert DEFAULT_SCHEDULE == FeeSchedule(maker_bps=10.0, taker_bps=20.0)
    assert schedule_for(" KRAKEN ").taker_bps == 26.0


def test_estimate_fee_for_unknown_venue_uses_conservative_default() -> None:
    from tradelog import Fill, Side, estimate_fee

    buy = Fill("a", datetime(2026, 1, 1), "BTCUSD", Side.BUY, 1.0, 10_000.0, venue="nowhere")
    sell = Fill("b", datetime(2026, 1, 1), "BTCUSD", Side.SELL, 1.0, 10_000.0, venue="nowhere")
    assert _f(estimate_fee(buy)) == pytest.approx(20.0)
    assert _f(estimate_fee(sell)) == pytest.approx(20.0)
    assert _f(estimate_fee(buy, maker=True)) == pytest.approx(10.0)


# ------------------------------------------------------- strategies (X01, X05)


def test_config_referenced_strategy_loads_by_name() -> None:
    from tradelog.strategies import create_strategy, get_strategy

    cls = get_strategy("tradelog.strategies.mean_revert:MeanReversion")
    strategy = create_strategy("tradelog.strategies.mean_revert:MeanReversion", {"window": 10})
    assert isinstance(strategy, cls)
    assert strategy.name == "mean_revert"
    assert strategy.params["window"] == 10


def test_non_strategy_reference_is_rejected() -> None:
    from tradelog.plugins import PluginError
    from tradelog.strategies import get_strategy

    with pytest.raises(TypeError):
        get_strategy("tradelog.fees:FeeSchedule")
    with pytest.raises(PluginError):
        get_strategy("tradelog.nope:Thing")
    with pytest.raises(PluginError):
        get_strategy("tradelog.strategies.sma_cross:Missing")


def test_load_config_example() -> None:
    from tradelog.config import load_config

    cfg = load_config(EXAMPLES / "config.toml")
    assert cfg.symbol == "ETHUSD"
    assert cfg.strategy == "tradelog.strategies.mean_revert:MeanReversion"
    assert cfg.params == {"window": 20, "entry_z": 1.5, "exit_z": 0.25}
    assert _f(cfg.cash) == 10_000.0


def test_config_price_path_is_relative_to_the_config_file(tmp_path: Path) -> None:
    from tradelog.config import load_config

    (tmp_path / "cfg.toml").write_text('[backtest]\nprices = "p.csv"\n', encoding="utf-8")
    cfg = load_config(tmp_path / "cfg.toml")
    assert Path(cfg.prices) == (tmp_path / "p.csv").resolve()
    (tmp_path / "bad.toml").write_text('[backtest]\nsymbl = "X"\n', encoding="utf-8")
    with pytest.raises(ValueError):
        load_config(tmp_path / "bad.toml")


# --------------------------------------------------------------- backtest (X06)


def test_long_only_backtest_trades() -> None:
    from tradelog import create_strategy, load_series, run_backtest

    result = run_backtest(load_series("BTCUSD"), create_strategy("sma_cross", {"fast": 5, "slow": 20}))
    assert [(t.entry_day, t.exit_day) for t in result.trades] == [
        (date(2025, 6, 21), date(2025, 6, 25)),
        (date(2025, 7, 9), date(2025, 7, 18)),
        (date(2025, 8, 2), date(2025, 8, 19)),
        (date(2025, 9, 18), date(2025, 9, 26)),
        (date(2025, 9, 29), date(2025, 10, 15)),
        (date(2025, 10, 28), date(2025, 11, 10)),
        (date(2025, 11, 25), date(2026, 1, 7)),
        (date(2026, 1, 12), date(2026, 1, 16)),
    ]
    assert _f(result.final_equity) == pytest.approx(11_460.65, rel=1e-4)
    assert len(result.equity_curve) == 320


def test_backtest_to_dict_contract() -> None:
    from tradelog import create_strategy, load_series, run_backtest

    result = run_backtest(load_series("ETHUSD"), create_strategy("momentum"))
    payload = result.to_dict()
    assert payload["schema_version"] == 1
    assert payload["trade_count"] == len(payload["trades"]) == len(result.trades)
    assert {
        "schema_version", "symbol", "strategy", "params", "initial_cash", "final_equity",
        "total_return", "max_drawdown", "win_rate", "trade_count", "trades",
    } <= set(payload)
    assert payload["strategy"] == "momentum"
    for trade in payload["trades"]:
        assert set(trade) >= {
            "symbol", "side", "entry_day", "entry_price", "exit_day", "exit_price", "qty",
            "fees", "pnl",
        }


def test_signal_executes_next_bar() -> None:
    from tradelog.backtest import run_backtest
    from tradelog.prices import Bar, PriceSeries
    from tradelog.strategies import Signal, Strategy

    class Flip(Strategy):
        def signals(self, closes):  # type: ignore[no-untyped-def]
            return [Signal.LONG, Signal.LONG, Signal.FLAT, Signal.FLAT][: len(closes)]

    bars = tuple(Bar(date(2026, 1, d), c) for d, c in zip((1, 2, 3, 4), (100.0, 100.0, 120.0, 90.0)))
    result = run_backtest(PriceSeries("T", bars), Flip(), fee_bps=0.0)
    assert len(result.trades) == 1
    trade = result.trades[0]
    assert (trade.entry_day, trade.exit_day) == (date(2026, 1, 2), date(2026, 1, 4))
    assert _f(trade.entry_price) == 100.0 and _f(trade.exit_price) == 90.0
    assert _f(result.final_equity) == pytest.approx(9_000.0)


def test_price_series_helpers() -> None:
    from tradelog.prices import available_symbols, load_series, parse_series

    assert available_symbols() == ["BTCUSD", "ETHUSD"]
    series = load_series("btcusd")
    assert len(series) == 320 and series.symbol == "BTCUSD"
    window = series.between(date(2025, 7, 1), date(2025, 7, 31))
    assert len(window) == 31
    with pytest.raises(ValueError):
        parse_series("X", "date,close\n2026-01-02,1\n2026-01-01,2\n")
    with pytest.raises(FileNotFoundError):
        load_series("DOGEUSD")
