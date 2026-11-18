import type { InstrumentType, Outcome, TeamSide } from "@winz/shared";

/**
 * A promo's condition, read back from the label the engine's catalogue sync writes on each
 * instrument (`apps/engine/src/market-data/normalize.ts`: `moneylineLabel`, `spreadLabel`,
 * `totalLabel`) and that a campaign copies into `condition_label`. The wire's `conditionLabel`,
 * `subjectName` and `resultLabel` are all rendered from the one `Condition` read here, so the
 * three cannot disagree: a label is only read as a known shape when rendering that shape gives the
 * label back character for character; anything else is `unknown`, shown as stored, with no team.
 *
 * The shapes, by instrument type:
 *
 * | type      | label               | subjectName | YES                         | NO                                 |
 * | --------- | ------------------- | ----------- | --------------------------- | ---------------------------------- |
 * | moneyline | `Texas wins`        | `Texas`     | `Texas won`                 | `Texas did not win`                |
 * | moneyline | `Draw`              | null        | `The game ended in a draw`  | `The game did not end in a draw`   |
 * | spread    | `Texas wins by 14+` | `Texas`     | `Texas won by 14+`          | `Texas did not win by 14+`         |
 * | total     | `Over 45.5 points`  | null        | `The game went over 45.5 points` | `The game did not go over 45.5 points` |
 * | any       | anything else       | null        | `It happened: <label>`      | `It did not happen: <label>`       |
 *
 * A total is about both teams together, and a draw about neither: both have no subject.
 */

export type Condition =
  /** A moneyline on one team: "Texas wins". */
  | { kind: "win"; subject: string }
  /** The draw of a three-way moneyline: "Draw". */
  | { kind: "draw" }
  /** A spread: "Texas wins by 14+" (the smallest whole margin above the strike). */
  | { kind: "win_by"; subject: string; margin: string }
  /** A game total: "Over 45.5 points" (strike, then the metric). */
  | { kind: "over"; line: string }
  /** A label of no known shape for its type: shown as stored. */
  | { kind: "unknown"; label: string };

const WIN = /^(\S(?:.*\S)?) wins$/;
const WIN_BY = /^(\S(?:.*\S)?) wins by (\d+)\+$/;
const OVER = /^Over (\S(?:.*\S)?)$/;
const DRAW = "Draw";

/** The condition in the present tense, as the catalogue writes it. */
export function conditionText(condition: Condition): string {
  switch (condition.kind) {
    case "win":
      return `${condition.subject} wins`;
    case "draw":
      return DRAW;
    case "win_by":
      return `${condition.subject} wins by ${condition.margin}+`;
    case "over":
      return `Over ${condition.line}`;
    case "unknown":
      return condition.label;
  }
}

function candidate(type: InstrumentType, label: string): Condition | null {
  switch (type) {
    case "moneyline": {
      if (label === DRAW) return { kind: "draw" };
      const subject = WIN.exec(label)?.[1];
      // "Texas wins by 14+" is no moneyline label: the spread pattern is checked first.
      if (subject === undefined || WIN_BY.test(label)) return null;
      return { kind: "win", subject };
    }
    case "spread": {
      const match = WIN_BY.exec(label);
      if (!match?.[1] || !match[2]) return null;
      return { kind: "win_by", subject: match[1], margin: match[2] };
    }
    case "total": {
      const line = OVER.exec(label)?.[1];
      return line === undefined ? null : { kind: "over", line };
    }
  }
}

/** A stored label read as a `Condition` of its instrument's type. */
export function parseCondition(type: InstrumentType, label: string): Condition {
  const read = candidate(type, label);
  if (read !== null && conditionText(read) === label) return read;
  return { kind: "unknown", label };
}

/** The team the condition is about, as the label writes it; null when it is not about one team. */
export function conditionSubject(condition: Condition): string | null {
  return condition.kind === "win" || condition.kind === "win_by" ? condition.subject : null;
}

/**
 * The condition in the past tense once the result is known: what happened on YES, what did not
 * on NO. Null before the result and for a void game (no result: the game was cancelled).
 */
export function conditionResult(condition: Condition, outcome: Outcome | null): string | null {
  if (outcome !== "yes" && outcome !== "no") return null;
  const yes = outcome === "yes";
  switch (condition.kind) {
    case "win":
      return yes ? `${condition.subject} won` : `${condition.subject} did not win`;
    case "draw":
      return yes ? "The game ended in a draw" : "The game did not end in a draw";
    case "win_by":
      return yes
        ? `${condition.subject} won by ${condition.margin}+`
        : `${condition.subject} did not win by ${condition.margin}+`;
    case "over":
      return yes
        ? `The game went over ${condition.line}`
        : `The game did not go over ${condition.line}`;
    case "unknown":
      return yes ? `It happened: ${condition.label}` : `It did not happen: ${condition.label}`;
  }
}

/** `instruments.side`: the team a contract pays on, "tie" for a draw, null when unknown. */
export type InstrumentSide = "home" | "away" | "tie";

/**
 * Which team of the game the condition is about: the instrument's `side` when it names a team and
 * the condition is about one team (never a total or a draw, whatever the side says); else null.
 */
export function conditionTeam(condition: Condition, side: InstrumentSide | null): TeamSide | null {
  if (condition.kind !== "win" && condition.kind !== "win_by") return null;
  return side === "home" || side === "away" ? side : null;
}

/** What the wire carries about a condition, all from one `Condition`. */
export interface ConditionWords {
  conditionLabel: string;
  subjectName: string | null;
  resultLabel: string | null;
}

/** The label, subject and result of a stored label of an instrument type, for an outcome. */
export function conditionWords(
  type: InstrumentType,
  label: string,
  outcome: Outcome | null,
): ConditionWords {
  const condition = parseCondition(type, label);
  return {
    conditionLabel: conditionText(condition),
    subjectName: conditionSubject(condition),
    resultLabel: conditionResult(condition, outcome),
  };
}
