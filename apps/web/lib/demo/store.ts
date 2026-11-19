/**
 * Whether the DEMO MODE banner shows. `apiFetch` reports every answer that carries a `demo` field;
 * the last one wins, so the banner follows the screen the user is on.
 */

let demo = false;
/** Screens that hold the band up whatever the last answer said (the admin panel). */
let pins = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function setDemoMode(next: boolean): void {
  if (demo === next) return;
  const before = getDemoMode();
  demo = next;
  if (getDemoMode() !== before) notify();
}

/**
 * Holds the DEMO MODE band up until the returned function is called. The admin pages are the demo
 * panel itself: the band stays on them for as long as they are open, even when an answer says
 * `demo: false` (the hedge desk read on the same page, with no override in force yet). The pins
 * count, so two screens that pin do not release each other.
 */
export function pinDemoMode(): () => void {
  const before = getDemoMode();
  pins += 1;
  if (getDemoMode() !== before) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const wasOn = getDemoMode();
    pins -= 1;
    if (getDemoMode() !== wasOn) notify();
  };
}

export function subscribeDemoMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDemoMode(): boolean {
  return demo || pins > 0;
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
