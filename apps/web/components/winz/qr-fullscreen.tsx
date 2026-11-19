"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { copy } from "@/lib/copy";
import { useScreenAwake } from "@/lib/use-screen-awake";

import { QrCode } from "./qr-code";

/**
 * The QR code at full size, for a customer to scan from across the counter. A native modal
 * `<dialog>`: Escape closes it and focus stays inside. A tap anywhere closes it too, and the screen
 * is kept awake while it is up (a browser cannot raise the brightness: the caption asks for it).
 */
export function QrFullscreen({
  open,
  onClose,
  value,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useScreenAwake(open);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={copy.live.qrAlt}
      onClose={onClose}
      onClick={onClose}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-white-pill p-0 text-ink open:grid open:place-items-center"
    >
      <button
        type="button"
        aria-label={copy.live.closeQr}
        onClick={onClose}
        className="absolute right-5 top-[calc(var(--safe-top)+1.25rem)] grid size-12 place-items-center rounded-full bg-ink text-text transition-transform duration-150 ease-out active:scale-[0.94]"
      >
        <X className="size-5" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <div className="flex w-[min(88vw,76dvh,560px)] flex-col items-center gap-5">
        <QrCode value={value} label={copy.live.qrAlt} />
        <p className="text-center text-body">{copy.live.qrBrightness}</p>
      </div>
    </dialog>
  );
}
