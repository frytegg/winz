import {
  apiErrorSchema,
  createMerchantResponseSchema,
  meResponseSchema,
  type Merchant,
} from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as postMerchants } from "@/app/api/merchants/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { UserPrincipal } from "./auth";
import { setServerDepsForTesting } from "./deps";
import { createMerchant, getMe, merchantBalance, splitMoney } from "./me";
import { ApiRouteError } from "./route";
import {
  FakeIdentity,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
  serverDepsFor,
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
  setServerDepsForTesting(undefined);
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

  it("answers a repeat of the same creation exactly as the first call, changing nothing", async () => {
    const principal = await fan("joe@example.com");
    const body = {
      name: "Joe's Bar",
      category: "bar" as const,
      logoUrl: "https://cdn.example.com/j.png",
    };
    const first = await createMerchant(database.db, principal, body);
    const before = await database.db`
      select m.id, m.name, m.category, m.logo_url, m.updated_at, u.roles, u.updated_at as user_at
      from merchants m join users u on u.id = m.user_id
    `;

    expect(await createMerchant(database.db, principal, { ...body })).toEqual(first);
    expect(await createMerchant(database.db, principal, { ...body })).toEqual(first);
    const after = await database.db`
      select m.id, m.name, m.category, m.logo_url, m.updated_at, u.roles, u.updated_at as user_at
      from merchants m join users u on u.id = m.user_id
    `;
    expect(after).toEqual(before);

    // Without a logo: the absent logo is the stored null, so it is the same business too.
    const maya = await fan("maya@example.com");
    const plain = await createMerchant(database.db, maya, { name: "Maya's", category: "other" });
    expect(await createMerchant(database.db, maya, { name: "Maya's", category: "other" })).toEqual(
      plain,
    );
  });

  it("still refuses a different business with 409, whatever differs", async () => {
    const principal = await fan("joe@example.com");
    const body = {
      name: "Joe's Bar",
      category: "bar" as const,
      logoUrl: "https://cdn.example.com/j.png",
    };
    await createMerchant(database.db, principal, body);
    const others = [
      { ...body, name: "Joe's Other" },
      { ...body, name: "joe's bar" },
      { ...body, name: "Joe's Bar " },
      { ...body, category: "pizza" as const },
      { ...body, logoUrl: "https://cdn.example.com/other.png" },
      { name: body.name, category: body.category },
    ];
    for (const other of others) {
      const error = await createMerchant(database.db, principal, other).catch(
        (caught: unknown) => caught,
      );
      expect(error, JSON.stringify(other)).toBeInstanceOf(ApiRouteError);
      expect((error as ApiRouteError).status).toBe(409);
    }
    const rows = await database.db`select name, category, logo_url from merchants`;
    expect(rows).toEqual([{ name: "Joe's Bar", category: "bar", logo_url: body.logoUrl }]);
  });

  it("two simultaneous first calls: one business, both answered it", async () => {
    const principal = await fan("joe@example.com");
    const body = { name: "Joe's Pizza", category: "pizza" as const };
    const answers = await Promise.all(
      Array.from({ length: 4 }, () => createMerchant(database.db, principal, body)),
    );
    const ids = new Set(answers.map((answer) => answer.id));
    expect(ids.size).toBe(1);
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    const rows = await database.db`select id from merchants`;
    expect(rows).toEqual([{ id: answers[0]?.id }]);
    const [user] = await database.db<{ roles: string[] }[]>`
      select roles from users where id = ${principal.userId}
    `;
    expect(user?.roles).toEqual(["merchant"]);
  });

  it("a call blocked behind an uncommitted first creation answers its business", async () => {
    // The unique constraint on merchants.user_id decides: the second insert waits for the first
    // transaction, then fails on it. Held open here so that the wait is certain.
    for (const [second, expected] of [
      [{ name: "Joe's Pizza", category: "pizza" as const }, "merchant"],
      [{ name: "Joe's Other", category: "pizza" as const }, 409],
    ] as const) {
      await database.db`truncate users, merchants cascade`;
      const principal = await fan("joe@example.com");
      let pending: Promise<Merchant | ApiRouteError> | undefined;
      let settled = false;
      let firstId = "";
      await database.db.begin(async (tx) => {
        const [first] = await tx<{ id: string }[]>`
          insert into merchants (user_id, name, category)
          values (${principal.userId}, 'Joe''s Pizza', 'pizza') returning id
        `;
        firstId = first?.id ?? "";
        pending = createMerchant(database.db, principal, second).catch(
          (caught: unknown) => caught as ApiRouteError,
        );
        void pending.then(() => {
          settled = true;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        expect(settled).toBe(false);
      });
      const answer = await pending;
      if (expected === 409) {
        expect(answer).toBeInstanceOf(ApiRouteError);
        expect((answer as ApiRouteError).status).toBe(409);
      } else {
        expect(answer).toMatchObject({ id: firstId, name: "Joe's Pizza", category: "pizza" });
      }
      expect(await database.db`select id from merchants`).toEqual([{ id: firstId }]);
    }
  });

  it("the route answers a repeated creation with the first call's status and body", async () => {
    const identity = new FakeIdentity();
    identity.addUser("lee-token", "did:privy:lee", {
      email: "lee@example.com",
      walletAddress: randomWallet(),
    });
    setServerDepsForTesting(serverDepsFor(database.db, identity, now));
    const send = async (body: unknown): Promise<{ status: number; payload: unknown }> => {
      const response = await postMerchants(
        new Request("http://localhost/api/merchants", {
          method: "POST",
          headers: { authorization: "Bearer lee-token", "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({}) },
      );
      return { status: response.status, payload: await response.json() };
    };
    try {
      const body = { name: "Lee's Burgers", category: "burger" };
      const first = await send(body);
      expect(first.status).toBe(200);
      expect(createMerchantResponseSchema.parse(first.payload)).toEqual(first.payload);
      // The second tap, after the first answer was lost; and one with an unknown key the
      // route's validation strips.
      expect(await send(body)).toEqual(first);
      expect(await send({ ...body, extra: "ignored" })).toEqual(first);

      const other = await send({ name: "Lee's Bar", category: "bar" });
      expect(other.status).toBe(409);
      expect(apiErrorSchema.parse(other.payload).error).toEqual({
        code: "conflict",
        message: "You already have a business",
      });
      expect(await database.db`select name from merchants`).toEqual([{ name: "Lee's Burgers" }]);
    } finally {
      setServerDepsForTesting(undefined);
    }
  });
});
