import { describe, expect, it } from "vitest";

import { checkSale } from "./sale";

describe("checkSale", () => {
  it("builds the request, trimming and lower-casing the slug", () => {
    expect(checkSale({ slug: " Joes-Texas ", qty: 2, email: " fan@example.com " })).toEqual({
      ok: true,
      request: { slug: "joes-texas", qty: 2, email: "fan@example.com" },
    });
  });

  it("names the wrong fields", () => {
    const result = checkSale({ slug: "a", qty: 1, email: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["email", "slug"]);
  });
});
