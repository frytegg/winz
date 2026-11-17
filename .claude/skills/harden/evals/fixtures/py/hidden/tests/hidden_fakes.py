"""Fetchers loaded *by name* through ``--fetcher hidden_fakes:...`` in the hidden CLI tests."""

from __future__ import annotations

from datetime import datetime

from tradelog.live.fetchers import Quote

FAKE_PRICE = 123.45


class FixedPriceFetcher:
    """Instantiated with no arguments by the CLI (``module:Class`` form)."""

    async def __call__(self, symbol: str) -> Quote:
        return Quote(symbol=symbol, price=FAKE_PRICE, ts=datetime(2026, 1, 1))


async def fixed_price_fetcher(symbol: str) -> Quote:
    """Used as-is by the CLI (``module:function`` form)."""
    return Quote(symbol=symbol, price=FAKE_PRICE * 2, ts=datetime(2026, 1, 1))
