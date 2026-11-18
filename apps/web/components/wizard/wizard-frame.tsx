import type { ReactNode } from "react";

import { BackButton } from "@/components/ui/icon-button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

interface WizardFrameProps {
  /** 0 to 1, from `journeyProgress`. */
  progress: number;
  /** The wizard's own number (1 to 5), colored lime. Omit on the sign-in and business screens. */
  stepNumber?: number;
  title: string;
  subtitle?: ReactNode;
  /** `href` or `onBack`: where the round chevron goes. */
  backHref?: string;
  onBack?: () => void;
  /** The pinned bottom area: the main button. Omit on a step that moves on by itself (M3, M4). */
  footer?: ReactNode;
  children?: ReactNode;
  /** Changes when the step changes, so the content slides in again (24px + fade, 240ms). */
  stepKey: string;
}

/**
 * The shell of every screen from sign-in to review: the round back button and the one continuous
 * progress bar on top, the capitalised title, the content, and the button pinned to the bottom
 * (above the keyboard and the home indicator).
 */
export function WizardFrame({
  progress,
  stepNumber,
  title,
  subtitle,
  backHref,
  onBack,
  footer,
  children,
  stepKey,
}: WizardFrameProps): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 px-5 pt-[calc(var(--safe-top)+1.25rem)]">
        <BackButton href={backHref} onClick={onBack} />
        <ProgressBar value={progress} label={copy.wizard.progress} />
      </header>

      <main key={stepKey} className="flex flex-1 animate-screen-in flex-col px-5 pt-8">
        <h1
          className={cn("text-step uppercase text-text", stepNumber === undefined && "font-bold")}
        >
          {stepNumber === undefined ? null : (
            <span className="text-lime">{stepNumber.toString()}. </span>
          )}
          {title}
        </h1>
        {subtitle === undefined ? null : <p className="mt-3 text-body text-muted">{subtitle}</p>}
        <div className="mt-6 flex flex-1 flex-col gap-6 pb-6">{children}</div>
      </main>

      {footer === undefined ? (
        <div aria-hidden="true" className="h-[calc(var(--safe-bottom)+1rem)]" />
      ) : (
        <footer className="sticky bottom-0 z-10 bg-gradient-to-t from-ink from-70% to-transparent px-4 pb-[calc(var(--safe-bottom)+1rem)] pt-8">
          {footer}
        </footer>
      )}
    </div>
  );
}
