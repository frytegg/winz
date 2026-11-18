"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { MatchSummary } from "@/components/winz/match-summary";
import { PromoCard } from "@/components/winz/promo-card";
import { copy } from "@/lib/copy";
import { journeyProgress } from "@/lib/journey";

import { useWizardNav } from "./use-wizard-nav";
import { useWizard } from "./wizard-context";
import { WizardFrame } from "./wizard-frame";

const ADVANCE_DELAY_MS = 260;

/** M4: pick the promo. The first available one with the lowest cost is "Recommended". */
export function StepPromo(): React.JSX.Element | null {
  const nav = useWizardNav("promo");
  const { draft, update } = useWizard();
  const [picked, setPicked] = useState<string | null>(draft.templateId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const event = draft.event;

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const recommendedId = useMemo(() => {
    const candidates = (event?.templates ?? []).filter(
      (template) => template.available && template.costBps !== null,
    );
    let best: (typeof candidates)[number] | undefined;
    for (const template of candidates) {
      if (best === undefined || (template.costBps ?? 0) < (best.costBps ?? 0)) best = template;
    }
    return best?.id ?? null;
  }, [event]);

  if (event === null) return null;

  return (
    <WizardFrame
      stepKey="promo"
      progress={journeyProgress("promo")}
      stepNumber={copy.wizard.stepNumber.promo}
      title={copy.wizard.steps.promo}
      subtitle={copy.pickPromo.body}
      onBack={nav.back}
    >
      <MatchSummary event={event} />
      {event.templates.length === 0 ? (
        <EmptyState title={copy.pickPromo.empty} />
      ) : (
        <div className="flex flex-col gap-4">
          {event.templates.map((template) => (
            <PromoCard
              key={template.id}
              headline={template.headline}
              refundBps={template.refundBps}
              costBps={template.costBps}
              probabilityBps={template.probabilityBps}
              recommended={template.id === recommendedId}
              selected={picked === template.id}
              unavailableReason={template.available ? null : template.unavailableReason}
              onSelect={() => {
                if (timer.current !== null) return;
                setPicked(template.id);
                update({ templateId: template.id });
                timer.current = setTimeout(() => {
                  timer.current = null;
                  nav.forward("offer");
                }, ADVANCE_DELAY_MS);
              }}
            />
          ))}
        </div>
      )}
    </WizardFrame>
  );
}
