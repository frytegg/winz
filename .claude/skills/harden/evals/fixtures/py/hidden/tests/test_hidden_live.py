"""Hidden behaviour tests: the asyncio price poller and fetchers."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime

import pytest

from tradelog.live.fetchers import Quote, StaticFetcher
from tradelog.live.poller import PricePoller


class ConcurrencyProbe:
    """Fetcher that records call order and how many calls overlap."""

    def __init__(self, delay: float = 0.01) -> None:
        self.delay = delay
        self.in_flight = 0
        self.max_in_flight = 0
        self.order: list[str] = []
        self.started: list[float] = []

    async def __call__(self, symbol: str) -> Quote:
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        self.order.append(symbol)
        self.started.append(time.monotonic())
        try:
            await asyncio.sleep(self.delay)
        finally:
            self.in_flight -= 1
        return Quote(symbol=symbol, price=float(len(self.order)), ts=datetime(2026, 1, 1))


async def _drain() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


def test_requests_are_sequential_and_in_symbol_order() -> None:
    """X08: symbols are fetched one at a time (rate limit), never concurrently."""
    probe = ConcurrencyProbe()
    poller = PricePoller(probe, ["a", "b", "c", "d", "e"], interval=0, request_spacing=0)
    quotes = asyncio.run(poller.poll_once())
    assert probe.max_in_flight == 1
    assert probe.order == ["A", "B", "C", "D", "E"]
    assert [q.symbol for q in quotes] == ["A", "B", "C", "D", "E"]


def test_request_spacing_is_honoured() -> None:
    probe = ConcurrencyProbe(delay=0.0)
    poller = PricePoller(probe, ["A", "B", "C"], interval=0, request_spacing=0.1)
    asyncio.run(poller.poll_once())
    gaps = [b - a for a, b in zip(probe.started, probe.started[1:])]
    assert len(gaps) == 2
    assert all(gap >= 0.07 for gap in gaps)  # timer granularity on Windows is ~16 ms


def test_latest_quote_per_symbol() -> None:
    probe = ConcurrencyProbe(delay=0.0)
    poller = PricePoller(probe, ["A", "B"], interval=0, request_spacing=0)

    async def scenario() -> int:
        rounds = await poller.run(iterations=2)
        await _drain()
        return rounds

    assert asyncio.run(scenario()) == 2
    assert poller.latest["A"].price == 3.0
    assert poller.latest["B"].price == 4.0


def test_sync_and_async_listeners_receive_every_quote() -> None:
    probe = ConcurrencyProbe(delay=0.0)
    poller = PricePoller(probe, ["A", "B"], interval=0, request_spacing=0)
    seen_sync: list[str] = []
    seen_async: list[str] = []

    async def async_listener(quote: Quote) -> None:
        await asyncio.sleep(0)
        seen_async.append(quote.symbol)

    poller.subscribe(lambda q: seen_sync.append(q.symbol))
    poller.subscribe(async_listener)

    async def scenario() -> None:
        await poller.run(iterations=2)
        await _drain()

    asyncio.run(scenario())
    assert sorted(seen_sync) == ["A", "A", "B", "B"]
    assert sorted(seen_async) == ["A", "A", "B", "B"]


def test_stop_ends_run_loop() -> None:
    probe = ConcurrencyProbe(delay=0.0)
    poller = PricePoller(probe, ["A"], interval=0, request_spacing=0)
    poller.subscribe(lambda q: poller.stop() if q.price >= 3 else None)

    async def scenario() -> int:
        rounds = await poller.run()
        await _drain()
        return rounds

    rounds = asyncio.run(asyncio.wait_for(scenario(), timeout=5))
    assert 3 <= rounds <= 4


def test_static_fetcher() -> None:
    fetcher = StaticFetcher({"btcusd": 10.5})
    quote = asyncio.run(fetcher("BTCUSD"))
    assert quote.symbol == "BTCUSD" and quote.price == 10.5
    bundled = StaticFetcher.from_bundled(["ETHUSD"])
    assert asyncio.run(bundled("ethusd")).price == 1710.24
    with pytest.raises(KeyError):
        asyncio.run(fetcher("DOGEUSD"))


def test_poller_argument_validation() -> None:
    probe = ConcurrencyProbe()
    with pytest.raises(ValueError):
        PricePoller(probe, [])
    with pytest.raises(ValueError):
        PricePoller(probe, ["A"], interval=-1)
    with pytest.raises(ValueError):
        PricePoller(probe, ["A"], request_spacing=-0.5)
