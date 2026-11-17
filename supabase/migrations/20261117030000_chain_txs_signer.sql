-- chain_txs: scope nonces by signing key and chain, not by role (review finding on X-01).
--
-- The first migration keyed the nonce sequence and the queue of sent rows by the role name only
-- (`signer` = 'relayer' or 'oracle'). A nonce belongs to an address on a chain, not to a role:
-- after a key rotation, or against another chain, on the same database, the new key inherited
-- the old key's next nonce, signed a transaction it could never get mined, and its queue stalled
-- for good.
--
-- Each row that holds a nonce now records the address that signed it and the chain it was signed
-- for, and a nonce can be used once per (address, chain). `signer` stays: it is the queue (the
-- role) a request is addressed to, and which key serves that role is configuration.
--
-- No deployed database exists yet, so there is nothing to backfill. Rather than guess the key
-- and chain of an existing row, the migration refuses to run while any row holds a nonce: on
-- such a database, read each row's key and chain back from its signed bytes
-- (payload._txSender.attempts[*].raw) and write them before applying this file.
--
-- Also: campaigns.unit_price must be positive. The escrow contract refuses a zero unit price, so
-- no campaign row may claim one.

do $$
declare
  rows_with_nonce bigint;
  free_campaigns bigint;
begin
  select count(*) into rows_with_nonce from public.chain_txs where nonce is not null;
  if rows_with_nonce > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'chain_txs holds %s row(s) with a nonce but no signer_address or chain_id', rows_with_nonce
      ),
      hint = 'Write the signing address and chain id of every such row (they are in the signed '
        || 'bytes of payload._txSender) before applying this migration; it does not guess them.';
  end if;

  select count(*) into free_campaigns from public.campaigns where unit_price = 0;
  if free_campaigns > 0 then
    raise exception using
      errcode = 'P0001',
      message = format('campaigns holds %s row(s) with a unit_price of 0', free_campaigns),
      hint = 'The escrow contract refuses a zero unit price: fix or remove those rows first.';
  end if;
end;
$$;

-- signer_address: lowercase address of the key that signed the row's transaction.
-- chain_id: EIP-155 chain id the transaction was signed for.
-- Both are written together with the nonce, in the statement that moves a row to `sent`.
alter table public.chain_txs
  add column signer_address text,
  add column chain_id integer,
  add constraint chain_txs_signer_address_format check (signer_address ~ '^0x[0-9a-f]{40}$'),
  add constraint chain_txs_chain_id_range check (chain_id > 0),
  add constraint chain_txs_nonce_has_signer check (
    nonce is null or (signer_address is not null and chain_id is not null)
  );

-- One nonce per key and chain, whatever the role that used the key.
drop index public.chain_txs_signer_nonce_key;
create unique index chain_txs_address_chain_nonce_key
  on public.chain_txs (signer_address, chain_id, nonce)
  where nonce is not null;

-- The `sent` rows of a role, by key and chain, in nonce order: what each worker drives first and
-- what the sender checks at start-up. Small: at most one row per key in normal operation.
create index chain_txs_sent_idx
  on public.chain_txs (signer, signer_address, chain_id, nonce)
  where status = 'sent';

alter table public.campaigns
  drop constraint campaigns_unit_price_range,
  add constraint campaigns_unit_price_range check (unit_price > 0);
