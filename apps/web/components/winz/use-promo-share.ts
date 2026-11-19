"use client";

import { useRef } from "react";

import { useToast } from "@/components/ui/toast";
import { copy } from "@/lib/copy";
import { renderQrPng } from "@/lib/qr";
import { copyText, downloadBlob, shareOrCopy } from "@/lib/share";

/**
 * What a merchant does with a live promo's link: copy it, hand it to the phone's share sheet, save
 * its QR code as a picture. One place for M8 and the share sheet of the promo detail, so both say
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
} {
  const toast = useToast();
  const { url, slug, promise, merchantName } = input;
  // The native sheet refuses a second call while one is open: a double tap must not read as a failure.
  const sharing = useRef(false);

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

  return { copyLink, share, downloadQr };
}
