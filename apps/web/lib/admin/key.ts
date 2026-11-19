/**
 * The admin key of the demo panel (SCREENS "Admin du mode démo", U-07).
 *
 * It is a secret that opens the demo routes, so where it lives is deliberately narrow:
 * - `sessionStorage` only: it dies with the browser tab. Never `localStorage` (it would outlive the
 *   session on a shared laptop), never the URL (history, referrer, a link pasted in a chat), never
 *   a log line or an error message.
 * - When the browser refuses storage (a private window, blocked site data) the key is kept in
 *   memory for as long as the page lives, and nowhere else.
 * - It leaves the page in one place: the `x-admin-key` header of an admin request.
 */

const STORAGE_KEY = "winz.admin-key";

let memoryKey: string | null = null;
const listeners = new Set<() => void>();

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : (window.sessionStorage ?? null);
  } catch {
    return null;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** The key of this tab, or `null` when none was entered (or it was locked). */
export function readAdminKey(): string | null {
  const storage = session();
  if (storage !== null) {
    try {
      const stored = storage.getItem(STORAGE_KEY);
      if (stored !== null && stored !== "") return stored;
    } catch {
      // Blocked storage: the in-memory copy below is the only one.
    }
  }
  return memoryKey;
}

/** Keeps `key` for this tab. A blank key is refused: it returns `false` and stores nothing. */
export function saveAdminKey(key: string): boolean {
  const value = key.trim();
  if (value === "") return false;
  memoryKey = value;
  const storage = session();
  if (storage !== null) {
    try {
      storage.setItem(STORAGE_KEY, value);
    } catch {
      // Quota or blocked storage: the key stays in memory.
    }
  }
  notify();
  return true;
}

/** Forgets the key (a wrong key, or the person locking the panel). */
export function clearAdminKey(): void {
  memoryKey = null;
  const storage = session();
  if (storage !== null) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing more to do: the in-memory copy is already gone.
    }
  }
  notify();
}

export function subscribeAdminKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when the page keeps its key in memory only, because `sessionStorage` is not usable. */
export function adminKeyIsMemoryOnly(): boolean {
  return session() === null;
}
