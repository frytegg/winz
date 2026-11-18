import type { Me, MerchantProfile } from "./auth-context";

/**
 * `me` with a merchant laid over it: the answer of `GET /api/me` for a user who has just created
 * their business on M2, before the next round trip would tell. Shared by both sign-in providers.
 */
export function withMerchant(me: Me, merchant: MerchantProfile): Me {
  return {
    ...me,
    user: { ...me.user, roles: [...new Set([...me.user.roles, "merchant" as const])] },
    merchant,
    balance: me.balance ?? { available: "0", pending: "0" },
  };
}
