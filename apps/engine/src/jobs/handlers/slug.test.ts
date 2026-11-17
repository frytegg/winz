import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { slugSchema } from "@winz/shared";

import type { Db } from "../../db";
import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { allocateSlug, campaignSlugBase, slugCandidate } from "./slug";

describe("campaignSlugBase", () => {
  it.each([
    ["Joe's Bar", "Texas wins", "joes-bar-texas-wins"],
    ["Café Crème", "Arkansas by 14+", "cafe-creme-arkansas-by-14"],
    ["Fish & Chips", "Over 52.5", "fish-and-chips-over-52-5"],
    ["  --  ", "!!", "promo"],
    ["A", "", "a-promo"],
  ])("%s + %s → %s", (merchant, condition, expected) => {
    expect(campaignSlugBase(merchant, condition)).toBe(expected);
  });

  it("stays within 64 characters and the shared schema", () => {
    const slug = campaignSlugBase("x".repeat(70), "Texas wins by a lot");
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slugSchema.safeParse(slug).success).toBe(true);
    const suffixed = slugCandidate(slug, 12);
    expect(suffixed.length).toBeLessThanOrEqual(64);
    expect(suffixed.endsWith("-12")).toBe(true);
    expect(slugSchema.safeParse(suffixed).success).toBe(true);
  });
});

describe("allocateSlug", () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = database.db;
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("takes the first free candidate, public rows included", async () => {
    await db`insert into live_campaigns (slug, sale_state) values ('taken-promo', 'open')`;
    await db`insert into live_campaigns (slug, sale_state) values ('taken-promo-2', 'open')`;
    const slug = await db.begin((sql) => allocateSlug(sql, "taken-promo"));
    expect(slug).toBe("taken-promo-3");
    expect(await db.begin((sql) => allocateSlug(sql, "free-promo"))).toBe("free-promo");
  });
});
