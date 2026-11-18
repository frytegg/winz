/**
 * Whether the DEMO MODE banner shows. `apiFetch` reports every answer that carries a `demo` field;
 * the last one wins, so the banner follows the screen the user is on.
 */

let demo = false;
const listeners = new Set<() => void>();

export function setDemoMode(next: boolean): void {
  if (demo === next) return;
  demo = next;
  for (const listener of listeners) listener();
}

export function subscribeDemoMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDemoMode(): boolean {
  return demo;
}

/**
 * Reads the `demo` flag of an API answer: a plain `demo` field, or a list of tickets that each
 * carry one. Returns `null` when the answer has no such field (it must not change the banner).
 */
export function readDemoFlag(data: unknown): boolean | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.demo === "boolean") return record.demo;
  const tickets = record.tickets;
  if (Array.isArray(tickets)) {
    return tickets.some(
      (ticket: unknown) =>
        typeof ticket === "object" &&
        ticket !== null &&
        (ticket as Record<string, unknown>).demo === true,
    );
  }
  return null;
}
