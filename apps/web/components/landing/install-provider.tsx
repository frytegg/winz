"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  createSessionFlag,
  demoClickOutcome,
  detectPlatform,
  footerClickOutcome,
  isIpad,
  type BrowserFacts,
  type ClickOutcome,
  type InstallTarget,
  type Platform,
  type SessionFlag,
  type SheetKind,
} from "@/lib/landing/install";

import { InstallSheet, type OpenSheet } from "./install-sheet";

/** The event Chrome and Edge on Android fire when the app can be installed. Not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** Kept by the small script of `install-early.ts`, which runs before the page is interactive. */
    __winzInstallPrompt?: BeforeInstallPromptEvent;
  }
}

export interface InstallApi {
  /** `null` until the page has read the browser (and for ever without a script). */
  readonly platform: Platform | null;
  /** The click of a "Try the live demo" link: opens the sheet where there is one to open. */
  readonly onDemoClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** The click of the footer's "Add to Home Screen". */
  readonly onFooterClick: (event: MouseEvent<HTMLElement>) => void;
  /** The click of "Best on your phone": the QR panel of a desktop. */
  readonly onBestOnPhoneClick: (event: MouseEvent<HTMLElement>) => void;
}

/** What a button gets with no provider (a test, a page that does not mount one): the link just works. */
const INERT: InstallApi = {
  platform: null,
  onDemoClick: () => undefined,
  onFooterClick: () => undefined,
  onBestOnPhoneClick: () => undefined,
};

const InstallContext = createContext<InstallApi>(INERT);

export function useInstall(): InstallApi {
  return useContext(InstallContext);
}

const DISMISSED_KEY = "winz-install-sheet-dismissed";

function readFacts(): BrowserFacts {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: iosStandalone || window.matchMedia("(display-mode: standalone)").matches,
  };
}

function subscribeToDisplayMode(onChange: () => void): () => void {
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getPlatform(): Platform {
  return detectPlatform(readFacts());
}

function getServerPlatform(): null {
  return null;
}

function sessionStorageOrNull(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.sessionStorage;
  } catch {
    // Reading `sessionStorage` throws where it is blocked: the flag then lives in memory.
    return null;
  }
}

/**
 * Everything "Try the live demo" and "Add to Home Screen" share (`sections/09-install-flow.md`): what the
 * visitor's platform is, the install event that Android fires (kept from the first moment, replayed on a
 * tap), the one sheet, and whether it was dismissed during this session. The buttons stay links and buttons
 * that work with no script; this only changes what a click does once the page is alive.
 *
 * Nothing is read from the browser during the first render: the server and the first client render agree
 * (`platform` is `null`), and the real platform arrives right after.
 */
export function InstallProvider({
  demo,
  footer,
  children,
}: {
  demo: InstallTarget;
  footer: InstallTarget;
  children: ReactNode;
}): React.JSX.Element {
  const platform = useSyncExternalStore(subscribeToDisplayMode, getPlatform, getServerPlatform);
  const [canPrompt, setCanPrompt] = useState(false);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const flag = useRef<SessionFlag | null>(null);

  const dismissedFlag = useCallback((): SessionFlag => {
    flag.current ??= createSessionFlag(DISMISSED_KEY, sessionStorageOrNull());
    return flag.current;
  }, []);

  useEffect(() => {
    // The event may have fired before this component did: the early script kept it.
    if (window.__winzInstallPrompt !== undefined) {
      deferred.current = window.__winzInstallPrompt;
      setCanPrompt(true);
    }
    const onPrompt = (event: Event): void => {
      // Keep the event: the browser's own mini bar is replaced by our sheet.
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };
    const onInstalled = (): void => {
      deferred.current = null;
      window.__winzInstallPrompt = undefined;
      setCanPrompt(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const openSheet = useCallback(
    (kind: SheetKind, origin: "demo" | "footer", opener: HTMLElement): void => {
      const rect = opener.getBoundingClientRect();
      setSheet({
        kind,
        origin,
        anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        ipad: isIpad(readFacts()),
      });
    },
    [],
  );

  /** Acts on what the pure table decided: lets the link go, opens the app here, or opens the sheet. */
  const apply = useCallback(
    (outcome: ClickOutcome, origin: "demo" | "footer", event: MouseEvent<HTMLElement>): void => {
      if (outcome.action === "follow") return;
      event.preventDefault();
      if (outcome.action === "open-app") {
        const target = origin === "demo" ? demo.url : footer.url;
        if (target !== null) window.location.assign(target);
        return;
      }
      openSheet(outcome.kind, origin, event.currentTarget);
    },
    [demo.url, footer.url, openSheet],
  );

  const onDemoClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>): void => {
      apply(
        demoClickOutcome({
          platform,
          canPrompt,
          dismissedThisSession: dismissedFlag().get(),
        }),
        "demo",
        event,
      );
    },
    [apply, canPrompt, dismissedFlag, platform],
  );

  const onFooterClick = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      apply(footerClickOutcome({ platform, canPrompt }), "footer", event);
    },
    [apply, canPrompt, platform],
  );

  const onBestOnPhoneClick = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      openSheet("desktop-qr", "demo", event.currentTarget);
    },
    [openSheet],
  );

  const closeSheet = useCallback((): void => {
    // Closed or refused: the demo buttons go to the app from now on, this session.
    dismissedFlag().set();
    setSheet(null);
  }, [dismissedFlag]);

  /** The Android install dialog. Accepted: say so. Refused: the app, in the browser. */
  const install = useCallback(async (): Promise<void> => {
    const event = deferred.current;
    if (event === null) {
      setSheet((current) => (current === null ? null : { ...current, kind: "android-menu" }));
      return;
    }
    // The event can be used once: offered again only if the browser fires a new one.
    deferred.current = null;
    window.__winzInstallPrompt = undefined;
    setCanPrompt(false);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") {
        dismissedFlag().set();
        setSheet((current) => (current === null ? null : { ...current, kind: "android-accepted" }));
        return;
      }
    } catch {
      // The browser refused to show its dialog (used up, or no gesture): the menu steps still work.
      setSheet((current) => (current === null ? null : { ...current, kind: "android-menu" }));
      return;
    }
    dismissedFlag().set();
    setSheet(null);
    const target = demo.url;
    if (target !== null) window.location.assign(target);
  }, [demo.url, dismissedFlag]);

  const api = useMemo<InstallApi>(
    () => ({ platform, onDemoClick, onFooterClick, onBestOnPhoneClick }),
    [platform, onDemoClick, onFooterClick, onBestOnPhoneClick],
  );

  const target = sheet?.origin === "footer" ? footer : demo;

  return (
    <InstallContext.Provider value={api}>
      {children}
      <InstallSheet
        sheet={sheet}
        openUrl={target.url}
        qr={target.qr}
        onClose={closeSheet}
        onInstall={() => void install()}
      />
    </InstallContext.Provider>
  );
}
