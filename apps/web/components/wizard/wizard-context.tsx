"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { EMPTY_DRAFT, parseDraft, type WizardDraft } from "@/lib/wizard/draft";

const STORAGE_KEY = "winz.wizard";

interface WizardApi {
  draft: WizardDraft;
  /** False until the saved draft has been read: a step must not decide on an empty draft. */
  ready: boolean;
  update: (patch: Partial<WizardDraft>) => void;
  reset: () => void;
  /** How many steps this session moved forward by itself: a "back" can then use the history. */
  pushes: { current: number };
}

const WizardContext = createContext<WizardApi | null>(null);

function readSaved(): WizardDraft {
  try {
    return parseDraft(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY_DRAFT;
  }
}

function save(draft: WizardDraft): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be blocked (private window): the draft then lives only in memory.
  }
}

/**
 * The wizard's choices (M3 to M7), kept in `sessionStorage`: going back, reloading the page or
 * pasting a step's link never loses them. Cleared when the promo is created.
 */
export function WizardProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT);
  const [ready, setReady] = useState(false);
  const pushes = useRef(0);

  useEffect(() => {
    setDraft(readSaved());
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<WizardDraft>): void => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback((): void => {
    setDraft(EMPTY_DRAFT);
    save(EMPTY_DRAFT);
    pushes.current = 0;
  }, []);

  const value = useMemo<WizardApi>(
    () => ({ draft, ready, update, reset, pushes }),
    [draft, ready, update, reset],
  );
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardApi {
  const value = useContext(WizardContext);
  if (value === null) throw new Error("useWizard must be used inside <WizardProvider>");
  return value;
}
