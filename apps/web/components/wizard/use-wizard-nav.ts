"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { HOME_PATH } from "@/lib/auth/route-guard";
import { previousStep, stepHref, type WizardStep } from "@/lib/wizard/draft";

import { useWizard } from "./wizard-context";

export interface WizardNav {
  /** Moves to the next step. A real navigation, so the browser's own back button steps back. */
  forward: (to: WizardStep) => void;
  /** The round chevron: one step back (through the history when it is the step we came from). */
  back: () => void;
  /** Jumps to a step without leaving a history entry for the one being left. */
  replace: (to: WizardStep) => void;
}

/**
 * The step is in the URL (`/new?step=…`), so forward is a `push` and the browser's back button
 * goes back one step. The on-screen chevron does the same through `router.back()` when this
 * session pushed the step; after a reload there is no history to rely on, so it goes to the
 * previous step by URL.
 */
export function useWizardNav(step: WizardStep): WizardNav {
  const router = useRouter();
  const { pushes } = useWizard();

  const forward = useCallback(
    (to: WizardStep): void => {
      pushes.current += 1;
      router.push(stepHref(to));
    },
    [pushes, router],
  );

  const back = useCallback((): void => {
    const previous = previousStep(step);
    if (previous === null) {
      router.push(HOME_PATH);
      return;
    }
    if (pushes.current > 0) {
      pushes.current -= 1;
      router.back();
    } else {
      router.replace(stepHref(previous));
    }
  }, [pushes, router, step]);

  const replace = useCallback(
    (to: WizardStep): void => {
      router.replace(stepHref(to));
    },
    [router],
  );

  return { forward, back, replace };
}
