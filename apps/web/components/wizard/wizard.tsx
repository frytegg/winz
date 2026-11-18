"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Splash } from "@/components/ui/splash";
import { useRouteGuard } from "@/lib/auth";
import { isWizardStep, resolveStep, stepHref } from "@/lib/wizard/draft";

import { StepGame } from "./step-game";
import { StepMargin } from "./step-margin";
import { StepOffer } from "./step-offer";
import { StepPromo } from "./step-promo";
import { StepReview } from "./step-review";
import { useWizard } from "./wizard-context";

/**
 * M3 to M7 in one client assistant: the step is in the URL (`/new?step=game|promo|offer|margin|review`),
 * the choices are in the wizard context. A step whose requirements are missing (a pasted link, a
 * reload that lost the game) is replaced by the earliest one that can be shown.
 */
export function Wizard(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const guarded = useRouteGuard("merchant");
  const { draft, ready } = useWizard();

  const asked = params.get("step");
  const requested = isWizardStep(asked) ? asked : "game";
  const step = resolveStep(requested, draft);

  useEffect(() => {
    if (guarded && ready && step !== asked) router.replace(stepHref(step));
  }, [guarded, ready, step, asked, router]);

  if (!guarded || !ready) return <Splash />;

  switch (step) {
    case "game":
      return <StepGame />;
    case "promo":
      return <StepPromo />;
    case "offer":
      return <StepOffer />;
    case "margin":
      return <StepMargin />;
    case "review":
      return <StepReview onLaunched={(id) => router.replace(`/new/${id}/live`)} />;
  }
}
