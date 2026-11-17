-- Winz: what the Gemini catalogue sync stores (task M-01, SPEC MD-1 and MD-3).
--
-- The first migration created `events` and `instruments` with the columns of SPEC section 10.
-- The sync also needs to remember the last quote it saw, the side of a contract, whether Gemini
-- still lists it, and how each contract settled. Same conventions as the first migration.

-- ---------------------------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------------------------

-- `status` is ours, a small set the rest of the system can switch on. `gemini_status` keeps the
-- string Gemini sent at the last catalogue sync, whatever it was.
--
--   Gemini status      events.status   meaning
--   approved           upcoming        listed, not trading yet
--   active             active          trading
--   closed             closed          trading over, result not published yet
--   settled            settled         every contract of the game has a yes/no outcome
--   invalid            void            cancelled by Gemini: every contract is void
--   anything else      closed          unknown to us: nothing may be sold on it
--
-- `settled` and `void` are also written by the settlement sync (MD-3), once every instrument of
-- the event has an outcome: `void` when all of them are void, `settled` otherwise. A later
-- catalogue sync never takes an event out of those two states.
alter table public.events
  add column gemini_status text,
  add column synced_at timestamptz;

alter table public.events drop constraint events_status_known;
alter table public.events
  add constraint events_status_known
    check (status in ('upcoming', 'active', 'closed', 'settled', 'void'));

-- ---------------------------------------------------------------------------------------------
-- instruments
-- ---------------------------------------------------------------------------------------------

-- side          the team the contract pays on, or 'tie' (the draw of a three-way moneyline).
--               Null on totals and when Gemini does not say.
-- outcome       how the contract settled (MD-3). Null until then; never changed afterwards.
-- settled_at    when the engine recorded the outcome.
-- best_bid_bps  best bid and ask of the YES side at the last catalogue sync, null when that side
-- best_ask_bps  of the book was empty. At most a minute old: live prices are in live_instruments.
-- active        false once Gemini no longer lists the contract as tradable. The row stays: a
--               campaign, a lot or an order may reference it.
-- synced_at     last catalogue sync that listed the contract.
alter table public.instruments
  add column side text,
  add column outcome text,
  add column settled_at timestamptz,
  add column best_bid_bps integer,
  add column best_ask_bps integer,
  add column active boolean not null default true,
  add column synced_at timestamptz,
  add constraint instruments_side_known check (side in ('home', 'away', 'tie')),
  add constraint instruments_outcome_known check (outcome in ('yes', 'no', 'void')),
  add constraint instruments_settled_at_with_outcome
    check ((outcome is null) = (settled_at is null)),
  add constraint instruments_best_bid_bps_range check (best_bid_bps between 0 and 10000),
  add constraint instruments_best_ask_bps_range check (best_ask_bps between 0 and 10000);

-- The index on (event_ticker) already exists (instruments_event_ticker_idx, first migration).
