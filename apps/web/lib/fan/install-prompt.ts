"use client";

import { useCallback, useEffect, useState } from "react";

/** The event Chrome and Edge on Android fire when the app can be installed. Not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  /** Nothing to offer: already installed, or a browser that cannot add to the home screen. */
  | "hidden"
  /** The browser can show its own install dialog: `prompt()` opens it. */
  | "prompt"
  /** iPhone and iPad: no dialog exists, the shopper does it from the Share menu. */
  | "ios";

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

/** iPhone, iPad, and an iPad that presents itself as a Mac (desktop-class Safari). */
function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/**
 * "Add Winz to Home Screen" (C3). Android: the `beforeinstallprompt` event is kept and replayed on
 * tap. iOS: there is no API, so the screen explains the two taps. Hidden once installed.
 */
export function useInstallPrompt(): { state: InstallState; prompt: () => Promise<void> } {
  const [state, setState] = useState<InstallState>("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    if (isIos()) setState("ios");

    const onPrompt = (event: Event): void => {
      // Keep the event: the browser's own mini bar is replaced by our button.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setState("prompt");
    };
    const onInstalled = (): void => {
      setDeferred(null);
      setState("hidden");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const prompt = useCallback(async (): Promise<void> => {
    if (deferred === null) return;
    await deferred.prompt();
    // The event can be used once: offer it again only if the browser fires a new one.
    setDeferred(null);
    setState("hidden");
  }, [deferred]);

  return { state, prompt };
}
