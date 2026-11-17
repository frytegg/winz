import { describe, expect, it } from "vitest";

import { parseSettlements } from "./settlement";
import { fixtureEvents } from "./test-support";

describe("parseSettlements", () => {
  it("maps every instrument of the recorded settled page to yes or no", () => {
    const outcomes = parseSettlements(fixtureEvents("events-recently-settled"));

    expect(Object.fromEntries(outcomes)).toEqual({
      "GEMI-CMB-261118-D81702D65DE08ACB-CMB": "yes",
      "GEMI-CMB-261118-0F8569A608F2E3DD-CMB": "no",
      "GEMI-NHL-2611170230-VAN-UTA-M-VAN": "yes",
      "GEMI-NHL-2611170230-VAN-UTA-M-UTA": "no",
      "GEMI-NCAAM-2611170300-TXSO-UCSD-M-TXSO": "no",
      "GEMI-NCAAM-2611170300-TXSO-UCSD-M-UCSD": "yes",
    });
  });

  it("returns void for every instrument of an invalid event (hand-edited fixture: Gemini's `invalid` status was never observed live)", () => {
    const outcomes = parseSettlements(fixtureEvents("events-recently-settled.invalid-hand-edited"));

    expect(outcomes.get("GEMI-NCAAM-2611170300-TXSO-UCSD-M-TXSO")).toBe("void");
    expect(outcomes.get("GEMI-NCAAM-2611170300-TXSO-UCSD-M-UCSD")).toBe("void");
    // The other events of the page are untouched.
    expect(outcomes.get("GEMI-NHL-2611170230-VAN-UTA-M-VAN")).toBe("yes");
    expect(outcomes.get("GEMI-NHL-2611170230-VAN-UTA-M-UTA")).toBe("no");
    expect(outcomes.size).toBe(6);
  });

  it("voids an invalid event even if its contracts still carry a resolutionSide", () => {
    const events = fixtureEvents("events-recently-settled").map((event) =>
      event.ticker === "NHL-2611170230-VAN-UTA-M" ? { ...event, status: "invalid" } : event,
    );
    const outcomes = parseSettlements(events);
    expect(outcomes.get("GEMI-NHL-2611170230-VAN-UTA-M-VAN")).toBe("void");
    expect(outcomes.get("GEMI-NHL-2611170230-VAN-UTA-M-UTA")).toBe("void");
  });

  it("reports nothing for the recorded active page, where no contract is resolved", () => {
    expect(parseSettlements(fixtureEvents("events-active-sports")).size).toBe(0);
  });

  it("picks up contracts that settle early inside a nested child market", () => {
    const events = fixtureEvents("events-active-sports");
    const contract = events[0]?.events?.[0]?.contracts[0];
    if (!contract) throw new Error("fixture has no nested contract");
    contract.status = "settled";
    contract.resolutionSide = "no";

    const outcomes = parseSettlements(events);
    expect(Object.fromEntries(outcomes)).toEqual({ [contract.instrumentSymbol]: "no" });
  });
});
