"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { copy } from "@/lib/copy";

import { IconButton } from "./icon-button";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * A bottom sheet (payment, share, withdrawals). A native modal `<dialog>`: focus is trapped inside,
 * Escape closes it, the page behind is inert. It rises in 280ms and a tap on the dimmed area closes it.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: SheetProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start on the title (read out by screen readers), not on the close button.
      titleRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="px-6 pb-[calc(1.5rem+var(--safe-bottom))] pt-3">
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-full bg-card-raised" />
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-promise outline-none">
              {title}
            </h2>
            {description === undefined ? null : (
              <p id={descriptionId} className="mt-1 text-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton
            icon={X}
            label={copy.common.close}
            tone="card"
            onClick={() => onOpenChange(false)}
          />
        </div>
        {children}
      </div>
    </dialog>
  );
}
