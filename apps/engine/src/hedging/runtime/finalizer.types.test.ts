import { describe, expect, it } from "vitest";

import type { HedgeFinalizer as SettlementHedgeFinalizer } from "../../settlement/types";
import type { Hedging } from "./index";

describe("the finalizer handed to the settlement lane", () => {
  it("is assignable to the settlement lane's HedgeFinalizer (checked by the compiler)", () => {
    const asSettlement = (hedging: Hedging): SettlementHedgeFinalizer => hedging.finalizer;
    expect(typeof asSettlement).toBe("function");
  });
});
