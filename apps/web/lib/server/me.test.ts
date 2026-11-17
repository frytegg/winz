import { createMerchantResponseSchema, meResponseSchema } from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { UserPrincipal } from "./auth";
import { createMerchant, getMe, merchantBalance, splitMoney } from "./me";
import { ApiRouteError } from "./route";
import {
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
} from "./testing/fixtures";

let database: TestDatabase;
const now = new Date();

beforeAll(async () => {
  database = await createTestDatabase();
  await insertEvent(database.db, { ticker: "EV-1", startsAt: minutesFrom(now, 600) });
  await insertInstrument(database.db, {
    symbol: "SYM-1",
    eventTicker: "EV-1",
    label: "Texas wins",
  });
});
afterAll(async () => {
  await database.drop();
});
beforeEach(async () => {
  await database.db`truncate users, merchants, campaigns, tickets cascade`;
});

async function fan(email: string): Promise<UserPrincipal> {
  const wallet = randomWallet();
  const [row] = await database.db<{ id: string }[]>`
    insert into users (email, privy_id, wallet) values (${email}, ${`did:${email}`}, ${wallet})
    returning id
  `;
  return {
    kind: "user",
    userId: row?.id ?? "",
    privyUserId: `did:${email}`,
    email,
    walletAddress: wallet,
    roles: [],
    merchantId: null,
  };
}

describe("splitMoney", () => {
  it("adds the non-refundable parts and the settled refundable parts", () => {
    expect(splitMoney({ nonRefundable: 5n, refundableSettled: 7n, refundableOpen: 11n })).toEqual({
      available: 12n,
      pending: 11n,
    });
  });
});

describe("GET /api/me", () => {
  it("answers a fan with no business and no balance", async () => {
    const principal = await fan("maya@example.com");
    const me = await getMe(database.db, principal);
    expect(meResponseSchema.parse(me)).toEqual(me);
    expect(me).toEqual({
      user: {
        id: principal.userId,
        email: "maya@example.com",
        roles: [],
        walletAddress: principal.walletAddress,
      },
      merchant: null,
      balance: null,
    });
  });

  it("answers a merchant with a zero balance when nothing was sold", async () => {
    const principal = await fan("joe@example.com");
    await createMerchant(database.db, principal, { name: "Joe's Pizza", category: "pizza" });
    const me = await getMe(database.db, principal);
    expect(meResponseSchema.parse(me)).toEqual(me);
    expect(me.balance).toEqual({ available: "0", pending: "0" });
    expect(me.merchant?.defaultUsualMarginBps).toBe(6500);
  });

  it("splits the balance between settled and open campaigns", async () => {
    const { merchantId, userId } = await insertMerchant(database.db, {
      email: "joe@example.com",
      privyId: "did:joe",
    });
    const open = await insertCampaign(database.db, {
      merchantId,
      instrument: "SYM-1",
      eventTicker: "EV-1",
      salesClose: minutesFrom(now, 595),
      slug: "joes-open",
    });
    const settled = await insertCampaign(database.db, {
      merchantId,
      instrument: "SYM-1",
      eventTicker: "EV-1",
      salesClose: minutesFrom(now, 595),
      slug: "joes-settled",
      status: "settled_no",
      saleState: "closed",
      outcome: "no",
    });
    // R = 50 % on a $20 sale: $10 paid out at once, $10 in escrow.
    await insertTicket(database.db, {
      campaignId: open,
      buyer: randomWallet(),
      paid: 20_000_000n,
      refundable: 10_000_000n,
    });
    await insertTicket(database.db, {
      campaignId: open,
      buyer: randomWallet(),
      qty: 2,
      paid: 40_000_000n,
      refundable: 40_000_000n,
    });
    await insertTicket(database.db, {
      campaignId: settled,
      buyer: randomWallet(),
      paid: 20_000_000n,
      refundable: 20_000_000n,
    });

    expect(await merchantBalance(database.db, merchantId)).toEqual({
      available: 10_000_000n + 20_000_000n,
      pending: 10_000_000n + 40_000_000n,
    });
    const me = await getMe(database.db, {
      kind: "user",
      userId,
      privyUserId: "did:joe",
      email: "joe@example.com",
      walletAddress: null,
      roles: ["merchant"],
      merchantId,
    });
    expect(me.balance).toEqual({ available: "30000000", pending: "50000000" });
  });
});

describe("POST /api/merchants", () => {
  it("creates the business, adds the merchant role and pre-fills the usual margin", async () => {
    const principal = await fan("joe@example.com");
    const merchant = await createMerchant(database.db, principal, {
      name: "Joe's Bar",
      category: "bar",
      logoUrl: "https://cdn.example.com/joe.png",
    });
    expect(createMerchantResponseSchema.parse(merchant)).toEqual(merchant);
    expect(merchant).toEqual({
      id: expect.any(String),
      name: "Joe's Bar",
      category: "bar",
      logoUrl: "https://cdn.example.com/joe.png",
      defaultUsualMarginBps: 7000,
    });
    const [user] = await database.db<{ roles: string[] }[]>`
      select roles from users where id = ${principal.userId}
    `;
    expect(user?.roles).toEqual(["merchant"]);
  });

  it("keeps the fan role and does not add merchant twice", async () => {
    const principal = await fan("maya@example.com");
    await database.db`update users set roles = '{fan}' where id = ${principal.userId}`;
    await createMerchant(database.db, principal, { name: "Maya's", category: "other" });
    const [user] = await database.db<{ roles: string[] }[]>`
      select roles from users where id = ${principal.userId}
    `;
    expect(user?.roles).toEqual(["fan", "merchant"]);
  });

  it("refuses a second business with 409 and changes nothing", async () => {
    const principal = await fan("joe@example.com");
    await createMerchant(database.db, principal, { name: "Joe's Pizza", category: "pizza" });
    const error = await createMerchant(database.db, principal, {
      name: "Joe's Other",
      category: "bar",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRouteError);
    expect((error as ApiRouteError).status).toBe(409);
    const rows = await database.db`select name from merchants`;
    expect(rows).toEqual([{ name: "Joe's Pizza" }]);
  });
});
