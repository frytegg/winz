# Gemini WebSocket recordings

Raw frames of the public Gemini WebSocket `wss://ws.gemini.com`, recorded on 17 Nov 2026 between
16:19 and 16:29 UTC from a development machine, through an HTTP CONNECT proxy. The book feed
tests (`apps/engine/src/market-data/*.test.ts`) replay them through a fake socket.

## Files

Each line is one event of a recording session:

```json
{"t": 1794932401153, "kind": "msg", "data": "<the frame text, exactly as received>"}
```

`t` is the receive time (epoch ms). `kind` is `open`, `sent` (a frame we sent), `msg` (a text frame
received), `ping` (a WebSocket ping frame from the server, payload in hex), `close`, `error` or `end`.

| File | What | Trimmed |
| --- | --- | --- |
| `sports-depth10.jsonl` | Three sports moneylines (`GEMI-NBA-2611180030-NYK-TOR-M-NYK`, `GEMI-NCAAM-2611171700-HOF-MURR-M-MURR`, `GEMI-NCAAM-2611171900-RUT-HOU-M-HOU`), each on `@bookTicker`, `@depth10`, `@depth` and `@trade`, one subscribe request. | First 100 s of a 300 s session (898 snapshots, 185 depth updates, 25 tickers, 14 pings, no trade in the full 300 s). |
| `crypto-trades.jsonl` | 24 short crypto markets (5 and 15 minute) on `@trade`, four of them also on `@bookTicker`. Sports had no trade, so the trade shape comes from here. | The first 45 frames, every trade with two frames either side, every ping. Full session: 200 s, 1958 tickers, 3 trades. |
| `control-and-errors.jsonl` | Three short sessions (`session` field): accepted and refused subscriptions, `list_subscriptions`, `unsubscribe`, an unknown method, a request without `id`, `depth10@100ms`, `depth5`, and the close after a non-JSON frame. | At most 12 snapshots per session. |

## Verified message shapes

Prices are decimal strings with 4 decimals (`"0.5600"`), quantities decimal strings with 2
(`"953.00"`). Symbols are accepted in any case but always come back **lower-cased** (`"s"` or
`"symbol"`). Event times `E` are **nanoseconds** since the epoch (beyond 2^53, so a JSON number
loses the last digits; millisecond precision is intact). Update ids (`u`, `U`, `lastUpdateId`) are
about 1.76e15, inside the exact range of a double, and shared by every stream of an instrument.

**Requests and replies.** `{"id": 1, "method": "subscribe", "params": ["<symbol>@<stream>", ...]}`
is answered `{"id": 1, "status": 200}`. Several streams per request work (up to 79 tried).
`unsubscribe` takes the same form. `list_subscriptions` answers `{"id": n, "status": 200,
"result": ["<lower-case stream>", ...]}`, or `"result": null` when nothing is subscribed (once,
right after subscribe and unsubscribe in the same burst, it answered `[""]`). A request without
`id` is answered with `"id": null`.

**Errors.** A bad stream name: `{"id": 5, "status": 400, "error": {"code": -1013, "msg": "Invalid
stream name: NOPE-XYZ@bookTicker"}}`; the rest of the connection is unaffected. An unknown method:
`{"id": 7, "status": 400, "error": {"code": -1020, "msg": "Unsupported operation"}}`. A frame that
is not JSON makes the server **close the connection** with code 1003, reason `"Invalid payload"`.

**`<symbol>@depth10`**: `{"lastUpdateId": 1764531742505592, "symbol": "gemi-...", "bids": [["0.5600",
"953.00"], ...], "asks": [["0.5700", "4250.00"], ...]}`. Up to 10 levels a side, best first, an
empty side is `[]`. No `e`, no `E`: the message carries no timestamp. Sent about **once a second
whether or not the book changed**, so it doubles as a per-instrument heartbeat.

**`<symbol>@depth10@100ms`** (not in the documentation we had): the same message every ~100 ms.
`@depth5` also exists. The book feed uses `@depth10@100ms`.

**`<symbol>@depth`**: `{"e": "depthUpdate", "E": <ns>, "s": "gemi-...", "U": <first id>, "u": <last
id>, "b": [[price, qty], ...], "a": [...]}`, only when the book changes. A quantity `"0.00"` removes
the level. `U` equals the `lastUpdateId` of the previous snapshot (not that id plus one).

**`<symbol>@bookTicker`**: `{"u": <id>, "E": <ns>, "s": "gemi-...", "b": "0.5600", "B": "953.00",
"a": "0.5700", "A": "4250.00"}`. Sent once on subscribe, then on every change of the top of book.
An empty side is sent as **empty strings** (`"b": "", "B": ""`). The first message after
subscribing also carries `"c"` and `"C"`, presumably the last trade price and size (absent on one of
the three sports instruments; not confirmed against a trade). `E` of that first message is the time of the last change,
which can be minutes old.

**`<symbol>@trade`** (the stream name was not documented; `@aggTrade` is refused):
`{"E": 1794932625041067587, "s": "gemi-eth15m2611171630-up", "t": 1893456013557062, "p": "0.3000",
"q": "5.00", "m": true}`. No `e` field. `t` is the trade id, `m` is true when the buyer was the
maker. Trades are rare: none on the three sports instruments in 5 minutes before their games, 3 on
24 crypto markets in 200 s.

**Heartbeat.** The server sends a WebSocket **ping frame every 20 to 21 s** (payload: a UUID as
text). `ws` answers with a pong by itself. There is no application-level heartbeat message.
A client close without a code is reported as 1005.

## Differences from what we expected

- Symbols come back lower-cased: the feed maps them back to the catalogue spelling.
- `depth10` has no event time; the feed stamps books with the receive time.
- `depth10@100ms` exists and is what the feed subscribes to.
- The trade stream is `@trade`, with no `e` field.
- Empty sides of `bookTicker` are `""`, not absent.
- A non-JSON frame closes the socket (1003): the client must only ever send JSON.

## Not verified

- Sessions longer than 5 minutes, server-initiated disconnects, connection or subscription limits
  beyond 79 streams in one request.
- Trades on a sports instrument during a game (the shape was verified on crypto markets only).
- That the connection works from Render, the engine's host: only a development machine was tried.
- A 10-minute recording. The longest session is 5 minutes, trimmed here to stay under 200 KB.
