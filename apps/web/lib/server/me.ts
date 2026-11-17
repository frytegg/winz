import {
  DEFAULT_USUAL_MARGIN_BPS,
  type CreateMerchantRequest,
  type MeResponse,
  type Merchant,
  type MerchantCategory,
} from "@winz/shared";

import type { UserPrincipal } from "./auth";
import type { Db } from "./db";
import { ApiRouteError } from "./route";
import { digits, safeUrl } from "./wire";

export interface MerchantRow {
  id: string;
  name: string;
  category: MerchantCategory;
  logo_url: string | null;
}

/** A `merchants` row on the wire, with the usual margin pre-filled for its category. */
export function toMerchant(row: MerchantRow): Merchant {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    logoUrl: safeUrl(row.logo_url),
    defaultUsualMarginBps: DEFAULT_USUAL_MARGIN_BPS[row.category],
  };
}

export interface MoneySplit {
  /** Non-refundable parts of every sale, plus the refundable parts of settled campaigns. */
  available: bigint;
  /** Refundable parts of the sales of campaigns not settled yet. */
  pending: bigint;
}

/**
 * Splits what a merchant earned (SPEC 4.6), from the `tickets` and `campaigns` tables:
 *
 * - every sale pays the merchant its non-refundable part at once: `paid − refundable`;
 * - the refundable part stays in escrow until the game: it is `pending` while the campaign has
 *   no outcome, and becomes `available` once it has one, whatever it is (released from escrow on
 *   NO or VOID, paid by the hedge on YES).
 *
 * The hedge budget is not part of it (it is the merchant's own money, shown on the campaign), and
 * neither are withdrawals, which are simulated and not recorded yet.
 */
export function splitMoney(tickets: {
  nonRefundable: bigint;
  refundableSettled: bigint;
  refundableOpen: bigint;
}): MoneySplit {
  return {
    available: tickets.nonRefundable + tickets.refundableSettled,
    pending: tickets.refundableOpen,
  };
}

/** `splitMoney` over every ticket of the merchant's campaigns. Zero and zero when none. */
export async function merchantBalance(db: Db, merchantId: string): Promise<MoneySplit> {
  const [row] = await db<
    { non_refundable: bigint; refundable_settled: bigint; refundable_open: bigint }[]
  >`
    select
      coalesce(sum(t.paid - t.refundable), 0)::bigint as non_refundable,
      coalesce(sum(t.refundable) filter (where c.outcome is not null), 0)::bigint
        as refundable_settled,
      coalesce(sum(t.refundable) filter (where c.outcome is null), 0)::bigint as refundable_open
    from tickets t
    join campaigns c on c.id = t.campaign_id
    where c.merchant_id = ${merchantId}
  `;
  return splitMoney({
    nonRefundable: row?.non_refundable ?? 0n,
    refundableSettled: row?.refundable_settled ?? 0n,
    refundableOpen: row?.refundable_open ?? 0n,
  });
}

async function merchantOf(db: Db, userId: string): Promise<MerchantRow | undefined> {
  const rows = await db<MerchantRow[]>`
    select id, name, category, logo_url from merchants where user_id = ${userId}
  `;
  return rows[0];
}

/** GET /api/me: the signed-in person, their business and its balance (null for a fan). */
export async function getMe(db: Db, principal: UserPrincipal): Promise<MeResponse> {
  const merchant = await merchantOf(db, principal.userId);
  const balance = merchant ? await merchantBalance(db, merchant.id) : null;
  return {
    user: {
      id: principal.userId,
      email: principal.email,
      roles: principal.roles,
      walletAddress: principal.walletAddress,
    },
    merchant: merchant ? toMerchant(merchant) : null,
    balance: balance
      ? { available: digits(balance.available), pending: digits(balance.pending) }
      : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

/**
 * POST /api/merchants: creates the business of the signed-in user (screen M2) and gives them the
 * `merchant` role, in one transaction. One business per user: a second one answers 409.
 */
export async function createMerchant(
  db: Db,
  principal: UserPrincipal,
  body: CreateMerchantRequest,
): Promise<Merchant> {
  try {
    const row = await db.begin(async (tx) => {
      const [created] = await tx<MerchantRow[]>`
        insert into merchants (user_id, name, category, logo_url)
        values (${principal.userId}, ${body.name}, ${body.category}, ${body.logoUrl ?? null})
        returning id, name, category, logo_url
      `;
      await tx`
        update users set roles = array_append(roles, 'merchant')
        where id = ${principal.userId} and not ('merchant' = any(roles))
      `;
      return created;
    });
    if (!row) throw new Error("merchant insert returned no row");
    return toMerchant(row);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new ApiRouteError(409, "conflict", "You already have a business");
    }
    throw error;
  }
}
