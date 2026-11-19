export type AdminAction = "book" | "result" | "sale" | "reset";

/**
 * - `sending`: the request left and no answer came yet. Nothing is claimed.
 * - `following`: (a sale) the server answered but the ticket is not issued yet; its payment is read
 *   until it ends.
 * - `done`: the server answered success, and, for a sale, the ticket exists.
 * - `error`: the server refused, did not answer, or the payment ended without a ticket.
 */
export type EntryStatus = "sending" | "following" | "done" | "error";

export interface JournalEntry {
  id: number;
  /** ISO time the action was sent. */
  at: string;
  action: AdminAction;
  /** What was sent, in words ("Bid 11% · ask 13% …"). Never carries the key. */
  summary: string;
  status: EntryStatus;
  /** What the server (or the client, when it never got an answer) said. `null` while `sending`. */
  message: string | null;
  paymentIntentId: string | null;
  ticketToken: string | null;
  /** A sale that may exist although no answer proves it (a dropped connection, a server error). */
  uncertain: boolean;
}

export type JournalEvent =
  | { type: "start"; entry: JournalEntry }
  | { type: "patch"; id: number; patch: Partial<Omit<JournalEntry, "id" | "at" | "action">> };

/** The log keeps the last 50 actions, newest first. */
export const JOURNAL_LIMIT = 50;

export function journalReducer(entries: JournalEntry[], event: JournalEvent): JournalEntry[] {
  if (event.type === "start") return [event.entry, ...entries].slice(0, JOURNAL_LIMIT);
  return entries.map((entry) => (entry.id === event.id ? { ...entry, ...event.patch } : entry));
}

export function newEntry(id: number, action: AdminAction, summary: string, at: Date): JournalEntry {
  return {
    id,
    at: at.toISOString(),
    action,
    summary,
    status: "sending",
    message: null,
    paymentIntentId: null,
    ticketToken: null,
    uncertain: false,
  };
}

/** The most recent entry of an action, which is what its panel reports. */
export function latestOf(
  entries: readonly JournalEntry[],
  action: AdminAction,
): JournalEntry | null {
  return entries.find((entry) => entry.action === action) ?? null;
}

/** An action is busy while one of its entries has no final answer: its button stays locked. */
export function isBusy(entries: readonly JournalEntry[], action: AdminAction): boolean {
  return entries.some(
    (entry) =>
      entry.action === action && (entry.status === "sending" || entry.status === "following"),
  );
}
