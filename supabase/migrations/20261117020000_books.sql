-- Order books shared between the engine and the web app.
--
-- The engine is the only process that talks to Gemini (one rate limiter, one WebSocket). The web
-- app never calls Gemini: it reads the latest book here, and asks the engine to follow an
-- instrument by inserting a row in tracked_instruments.

-- book_cache: latest order book (up to 10 levels a side) of every instrument the engine follows.
--   bids, asks   JSON arrays of {"priceBps": integer, "qty": "<micro-contracts as digits>"},
--                best level first (bids descending, asks ascending).
--   observed_at  when the engine observed this book. A book older than 10 s is stale and must
--                not be priced or traded against.
--   source       'ws' (Gemini WebSocket), 'rest' (Gemini REST poll) or 'demo' (demo-mode book).
create table public.book_cache (
  symbol text primary key references public.instruments (symbol),
  bids jsonb not null default '[]'::jsonb,
  asks jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null,
  source text not null,
  updated_at timestamptz not null default now(),
  constraint book_cache_bids_is_array check (jsonb_typeof(bids) = 'array'),
  constraint book_cache_asks_is_array check (jsonb_typeof(asks) = 'array'),
  constraint book_cache_source_known check (source in ('ws', 'rest', 'demo'))
);
create trigger book_cache_set_updated_at before update on public.book_cache
  for each row execute function public.set_updated_at();

-- tracked_instruments: instruments the web app asked the engine to follow although no live
-- campaign uses them yet (a merchant is looking at a promo on screens M4 to M6). The engine
-- follows the instruments of live campaigns plus every row here whose expires_at is in the future.
create table public.tracked_instruments (
  symbol text primary key references public.instruments (symbol),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint tracked_instruments_expiry_after_request check (expires_at > requested_at)
);
create index tracked_instruments_expires_at_idx on public.tracked_instruments (expires_at);

alter table public.book_cache enable row level security;
alter table public.tracked_instruments enable row level security;

-- No policy: only the service role reads or writes these tables.
revoke all on table public.book_cache, public.tracked_instruments from anon, authenticated;
