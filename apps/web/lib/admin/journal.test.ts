import { describe, expect, it } from "vitest";

import {
  JOURNAL_LIMIT,
  isBusy,
  journalReducer,
  latestOf,
  newEntry,
  type JournalEntry,
} from "./journal";

const at = new Date("2026-11-19T20:00:00Z");

function started(entries: JournalEntry[], id: number, action: "book" | "sale"): JournalEntry[] {
  return journalReducer(entries, {
    type: "start",
    entry: newEntry(id, action, `entry ${id.toString()}`, at),
  });
}

describe("the action log", () => {
  it("starts an entry as `sending`, with no answer claimed", () => {
    const [entry] = started([], 1, "book");
    expect(entry).toMatchObject({ status: "sending", message: null, ticketToken: null });
  });

  it("lists the newest first and patches only the entry it names", () => {
    let entries = started([], 1, "book");
    entries = started(entries, 2, "sale");
    entries = journalReducer(entries, {
      type: "patch",
      id: 1,
      patch: { status: "done", message: "ok" },
    });
    expect(entries.map((entry) => [entry.id, entry.status])).toEqual([
      [2, "sending"],
      [1, "done"],
    ]);
  });

  it("is busy for an action until its entry has a final answer", () => {
    let entries = started([], 1, "sale");
    expect(isBusy(entries, "sale")).toBe(true);
    expect(isBusy(entries, "book")).toBe(false);
    entries = journalReducer(entries, { type: "patch", id: 1, patch: { status: "following" } });
    expect(isBusy(entries, "sale")).toBe(true);
    entries = journalReducer(entries, { type: "patch", id: 1, patch: { status: "error" } });
    expect(isBusy(entries, "sale")).toBe(false);
  });

  it("reports the latest entry of an action", () => {
    let entries = started([], 1, "book");
    entries = started(entries, 2, "book");
    expect(latestOf(entries, "book")?.id).toBe(2);
    expect(latestOf(entries, "sale")).toBeNull();
  });

  it("keeps the last 50", () => {
    let entries: JournalEntry[] = [];
    for (let id = 1; id <= JOURNAL_LIMIT + 5; id += 1) entries = started(entries, id, "book");
    expect(entries).toHaveLength(JOURNAL_LIMIT);
    expect(entries[0]?.id).toBe(JOURNAL_LIMIT + 5);
  });
});
