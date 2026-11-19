"use client";

import { useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { copy } from "@/lib/copy";
import { posterFilename } from "@/lib/og/poster";
import { renderQrPng } from "@/lib/qr";
import { copyText, downloadBlob, shareOrCopy } from "@/lib/share";

/**
 * What a merchant does with a live promo's link: copy it, hand it to the phone's share sheet, save
 * its QR code or its poster as a picture. One place for M8 and the share sheet of the promo detail, so both say
 * the same thing and fail the same way. Nothing happens until there is a link.
 */
export function usePromoShare(input: {
  url: string | null;
  slug: string | null;
  promise: string;
  merchantName: string;
}): {
  copyLink: () => Promise<void>;
  share: () => Promise<void>;
  downloadQr: () => Promise<void>;
  downloadPoster: () => Promise<void>;
  /** The poster is being drawn and fetched: its button waits. */
  posterBusy: boolean;
} {
  const toast = useToast();
  const { url, slug, promise, merchantName } = input;
  // The native sheet refuses a second call while one is open: a double tap must not read as a failure.
  const sharing = useRef(false);
  const posterRunning = useRef(false);
  // The same, for the screen: the button shows it is working. The ref is what stops a second tap that
  // arrives before the screen has had time to draw that.
  const [posterBusy, setPosterBusy] = useState(false);

  async function copyLink(): Promise<void> {
    if (url === null) return;
    if (await copyText(url)) toast.show(copy.common.copied);
    else toast.show(copy.common.genericError, "error");
  }

  async function share(): Promise<void> {
    if (url === null || sharing.current) return;
    sharing.current = true;
    // No share sheet on this browser (a desktop): copying the link is the plain, expected outcome.
    const hasSheet = typeof navigator.share === "function";
    try {
      const result = await shareOrCopy({
        title: copy.live.shareTitle(merchantName),
        text: copy.live.shareText(promise, merchantName),
        url,
      });
      if (result === "copied") toast.show(hasSheet ? copy.live.shareFailed : copy.common.copied);
      if (result === "failed") toast.show(copy.common.genericError, "error");
    } finally {
      sharing.current = false;
    }
  }

  async function downloadQr(): Promise<void> {
    if (url === null) return;
    try {
      downloadBlob(await renderQrPng(url), `winz-${slug ?? "promo"}-qr.png`);
      toast.show(copy.live.qrDownloaded);
    } catch {
      toast.show(copy.live.qrFailed, "error");
    }
  }

  /**
   * The poster is a public picture at `/poster/<slug>`. It is fetched, not linked: a link would save
   * whatever the server answers, an error included, as a file called `poster.png`. Here the answer is
   * checked, the server's own message is shown when there is no poster, and only a PNG is saved.
   */
  async function downloadPoster(): Promise<void> {
    if (slug === null || posterRunning.current) return;
    posterRunning.current = true;
    setPosterBusy(true);
    try {
      const response = await fetch(`/poster/${encodeURIComponent(slug)}`);
      if (!response.ok || response.headers.get("content-type")?.startsWith("image/png") !== true) {
        toast.show(await refusalMessage(response), "error");
        return;
      }
      downloadBlob(await response.blob(), posterFilename(slug));
      toast.show(copy.live.posterSaved);
    } catch {
      toast.show(copy.live.posterFailed, "error");
    } finally {
      posterRunning.current = false;
      setPosterBusy(false);
    }
  }

  return { copyLink, share, downloadQr, downloadPoster, posterBusy };
}

/** The message of an `{ error: { message } }` answer, or the generic one. */
async function refusalMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body;
      if (typeof error === "object" && error !== null && "message" in error) {
        const { message } = error;
        if (typeof message === "string" && message !== "") return message;
      }
    }
  } catch {
    // Not JSON (a proxy's page): the generic message below.
  }
  return copy.live.posterFailed;
}
