import type { DemoSaleRequest } from "@winz/shared";
import { emailSchema, slugSchema } from "@winz/shared";

import { copy } from "@/lib/copy";

const T = copy.admin.sale.errors;

export interface SaleInput {
  slug: string;
  qty: number;
  email: string;
}

export type SaleField = "slug" | "email";

export type SaleCheck =
  | { ok: true; request: DemoSaleRequest }
  | { ok: false; errors: Partial<Record<SaleField, string>> };

/** The same rules as `POST /api/admin/demo/sale`, so a typo never costs a sale that goes nowhere. */
export function checkSale(input: SaleInput): SaleCheck {
  const errors: Partial<Record<SaleField, string>> = {};
  const slug = input.slug.trim().toLowerCase();
  const email = input.email.trim();
  if (!slugSchema.safeParse(slug).success) errors.slug = T.slug;
  if (!emailSchema.safeParse(email).success) errors.email = T.email;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { slug, qty: input.qty, email } };
}
