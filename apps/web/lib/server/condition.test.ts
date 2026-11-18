import { INSTRUMENT_TYPES, OUTCOMES, type InstrumentType, type Outcome } from "@winz/shared";
import { describe, expect, it } from "vitest";

import {
  conditionResult,
  conditionSubject,
  conditionTeam,
  conditionText,
  conditionWords,
  parseCondition,
  type InstrumentSide,
} from "./condition";

/**
 * Every instrument type and every outcome. The labels are the ones the engine's catalogue sync
 * writes (`moneylineLabel`, `spreadLabel`, `totalLabel` in apps/engine/src/market-data).
 */
const CASES: {
  type: InstrumentType;
  label: string;
  subject: string | null;
  yes: string;
  no: string;
}[] = [
  {
    type: "moneyline",
    label: "Texas wins",
    subject: "Texas",
    yes: "Texas won",
    no: "Texas did not win",
  },
  {
    type: "moneyline",
    label: "Draw",
    subject: null,
    yes: "The game ended in a draw",
    no: "The game did not end in a draw",
  },
  {
    type: "spread",
    label: "Texas wins by 14+",
    subject: "Texas",
    yes: "Texas won by 14+",
    no: "Texas did not win by 14+",
  },
  {
    // A team of several words, as Gemini names some.
    type: "spread",
    label: "Real Madrid wins by 2+",
    subject: "Real Madrid",
    yes: "Real Madrid won by 2+",
    no: "Real Madrid did not win by 2+",
  },
  {
    type: "total",
    label: "Over 45.5 points",
    subject: null,
    yes: "The game went over 45.5 points",
    no: "The game did not go over 45.5 points",
  },
  {
    type: "total",
    label: "Over 2.5 goals",
    subject: null,
    yes: "The game went over 2.5 goals",
    no: "The game did not go over 2.5 goals",
  },
];

describe("parseCondition and the words built from it", () => {
  it.each(CASES)("$type $label", ({ type, label, subject, yes, no }) => {
    const condition = parseCondition(type, label);
    expect(condition.kind).not.toBe("unknown");
    // The label is rendered back character for character: the three fields share one reading.
    expect(conditionText(condition)).toBe(label);
    expect(conditionSubject(condition)).toBe(subject);
    expect(conditionResult(condition, "yes")).toBe(yes);
    expect(conditionResult(condition, "no")).toBe(no);
    expect(conditionResult(condition, "void")).toBeNull();
    expect(conditionResult(condition, null)).toBeNull();
    expect(conditionWords(type, label, "yes")).toEqual({
      conditionLabel: label,
      subjectName: subject,
      resultLabel: yes,
    });
  });

  it("covers every instrument type and every outcome of the domain", () => {
    expect(new Set(CASES.map((entry) => entry.type))).toEqual(new Set(INSTRUMENT_TYPES));
    const outcomes: readonly (Outcome | null)[] = [...OUTCOMES, null];
    for (const outcome of outcomes) {
      for (const { type, label } of CASES) {
        const result = conditionWords(type, label, outcome).resultLabel;
        if (outcome === "yes" || outcome === "no") expect(result).not.toBeNull();
        else expect(result).toBeNull();
      }
    }
  });

  it.each([
    // A label of another type's shape is not read as that shape.
    ["moneyline", "Texas wins by 14+"],
    ["spread", "Texas wins"],
    ["total", "Texas wins"],
    ["spread", "Over 45.5 points"],
    ["moneyline", "Over 45.5 points"],
    // Shapes the catalogue never writes.
    ["spread", "Texas wins by 14"],
    ["spread", "Texas wins by more than 13.5 points"],
    ["moneyline", " Texas wins"],
    ["moneyline", "Texas wins "],
    ["total", "Over"],
    ["moneyline", "draw"],
    ["moneyline", ""],
  ] as const)("reads %s %j as unknown: shown as stored, no team", (type, label) => {
    const condition = parseCondition(type, label);
    expect(condition).toEqual({ kind: "unknown", label });
    expect(conditionText(condition)).toBe(label);
    expect(conditionSubject(condition)).toBeNull();
    expect(conditionTeam(condition, "home")).toBeNull();
    expect(conditionResult(condition, "yes")).toBe(`It happened: ${label}`);
    expect(conditionResult(condition, "no")).toBe(`It did not happen: ${label}`);
    expect(conditionResult(condition, "void")).toBeNull();
  });
});

describe("conditionTeam", () => {
  const sides: readonly (InstrumentSide | null)[] = ["home", "away", "tie", null];

  it("is the instrument's side for a condition on one team", () => {
    for (const [type, label] of [
      ["moneyline", "Texas wins"],
      ["spread", "Texas wins by 14+"],
    ] as const) {
      const condition = parseCondition(type, label);
      expect(sides.map((side) => conditionTeam(condition, side))).toEqual([
        "home",
        "away",
        null,
        null,
      ]);
    }
  });

  it("is null for a total and a draw, whatever the side says", () => {
    for (const [type, label] of [
      ["total", "Over 45.5 points"],
      ["moneyline", "Draw"],
    ] as const) {
      const condition = parseCondition(type, label);
      expect(sides.map((side) => conditionTeam(condition, side))).toEqual([null, null, null, null]);
    }
  });
});
