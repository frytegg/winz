import { isApiError } from "@/lib/api/client";

/**
 * `409 conflict` on `POST /api/merchants`: the user already has a business, different from this
 * body. An equal repeat (a second tap after a lost answer) is answered the business itself, so a
 * 409 means the user has a business already: the session is read again, and the route guard,
 * seeing it, moves on.
 */
export function isBusinessAlreadyThere(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === "conflict";
}

/** What M2's submit leads to. */
export type BusinessOutcome<M> =
  /** The business was created (or the same one answered again): the screen adopts it. */
  | { kind: "created"; merchant: M }
  /** The user already had one: the session read again has it, and the guard moves on. */
  | { kind: "existing" };

/**
 * M2's submit. `create` is `POST /api/merchants`; `refreshMe` reads the session again and says
 * whether it now has a business. On a 409 the session is read again; when it still has no
 * business (or cannot be read), the 409 itself is thrown, for the screen to show its message.
 */
export async function submitBusiness<M>(
  create: () => Promise<M>,
  refreshMe: () => Promise<{ hasBusiness: boolean }>,
): Promise<BusinessOutcome<M>> {
  try {
    return { kind: "created", merchant: await create() };
  } catch (error: unknown) {
    if (!isBusinessAlreadyThere(error)) throw error;
    let refreshed: { hasBusiness: boolean };
    try {
      refreshed = await refreshMe();
    } catch {
      // The session could not be read: the 409's own message says what happened.
      throw error;
    }
    if (!refreshed.hasBusiness) throw error;
    return { kind: "existing" };
  }
}
