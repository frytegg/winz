-- Demo data (task D-01): the running example of SPEC section 4.3 and of
-- packages/shared/src/api/examples.ts. Joe's Pizza, the Arkansas vs Texas game and its contracts.
-- No campaign: campaigns are created on-chain by the app.
-- Safe to run more than once.

insert into public.users (id, email, wallet, roles)
values (
  '00000000-0000-4000-8000-000000000001',
  'joe@example.com',
  '0x1111111111111111111111111111111111111111',
  array['merchant']
)
on conflict do nothing;

insert into public.merchants (id, user_id, name, category, logo_url)
values (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'Joe''s Pizza',
  'pizza',
  null
)
on conflict do nothing;

insert into public.events (
  ticker, title, sport, league,
  home_name, home_abbreviation, away_name, away_abbreviation,
  starts_at, sales_close_at, status
)
values (
  'NCAAF-2611212030-ARK-TEX-M', 'Arkansas vs Texas', 'football', 'NCAAF',
  'Texas Longhorns', 'TEX', 'Arkansas Razorbacks', 'ARK',
  '2026-11-21T20:30:00Z', '2026-11-21T20:25:00Z', 'active'
)
on conflict do nothing;

-- onchain_id = keccak256 of the symbol (UTF-8 bytes), computed with viem.
insert into public.instruments (symbol, event_ticker, label, type, strike, onchain_id)
values
  (
    'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', 'NCAAF-2611212030-ARK-TEX-M',
    'Texas wins by 14+', 'spread', 13.5,
    '0xac378e3ba3c010c5eb22fed87c7c22fd34cca53559eb89ccde81398c266f884c'
  ),
  (
    'GEMI-NCAAF-2611212030-ARK-TEX-M-TEX', 'NCAAF-2611212030-ARK-TEX-M',
    'Texas wins', 'moneyline', null,
    '0x8678dbb9a92e72e47ca9fdd2f06501129215ca70e19ea506c3abc845fb70b16f'
  ),
  (
    'GEMI-NCAAF-2611212030-ARK-TEX-M-ARK', 'NCAAF-2611212030-ARK-TEX-M',
    'Arkansas wins', 'moneyline', null,
    '0xd2917c210d0bad20fc7b5523aed118287e97cade5a8f7f5d2bdc8a38c00f533e'
  ),
  (
    'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX20', 'NCAAF-2611212030-ARK-TEX-M',
    'Texas wins by 21+', 'spread', 20.5,
    '0x9349c03e0cda46ed946f245d6ceec3ecc87bb115a5eee552fe372512c1014a88'
  )
on conflict do nothing;
