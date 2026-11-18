"use client";

import { Copy, Download, Share } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { copy } from "@/lib/copy";
import { renderQrPng } from "@/lib/qr";
import { copyText, shareOrCopy } from "@/lib/share";

import { QrCode } from "./qr-code";
import { QrFullscreen } from "./qr-fullscreen";

/**
 * "Share this promo" (MD, share button): the QR code, the link with a copy button, Share and
 * Download QR, as on M8 but in a sheet. Tapping the code opens it full screen.
 */
export function CampaignShareSheet({
  open,
  onOpenChange,
  url,
  slug,
  promise,
  merchantName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  slug: string | null;
  promise: string;
  merchantName: string;
}): React.JSX.Element {
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);
  const shortUrl = url.replace(/^https?:\/\//, "");

  async function copyLink(): Promise<void> {
    if (await copyText(url)) toast.show(copy.common.copied);
    else toast.show(copy.common.genericError, "error");
  }

  async function share(): Promise<void> {
    const result = await shareOrCopy({
      title: copy.live.shareTitle(merchantName),
      text: copy.live.shareText(promise, merchantName),
      url,
    });
    if (result === "copied") toast.show(copy.live.shareFailed);
    if (result === "failed") toast.show(copy.common.genericError, "error");
  }

  async function downloadQr(): Promise<void> {
    try {
      const blob = await renderQrPng(url);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `winz-${slug ?? "promo"}-qr.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      toast.show(copy.live.qrDownloaded);
    } catch {
      toast.show(copy.live.qrFailed, "error");
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={copy.campaignDetail.shareTitle}>
        <div className="flex flex-col gap-4">
          <button
            type="button"
            aria-label={copy.live.enlargeQr}
            onClick={() => setQrOpen(true)}
            className="mx-auto block w-[min(60vw,224px)] rounded-2xl transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            <QrCode value={url} label={copy.live.qrAlt} />
          </button>
          <div className="flex h-14 items-center justify-between gap-2 rounded-full bg-card-raised pl-5 pr-1">
            <span className="min-w-0 truncate text-body">{shortUrl}</span>
            <button
              type="button"
              aria-label={copy.live.copyLink}
              onClick={() => void copyLink()}
              className="grid size-12 shrink-0 place-items-center rounded-full bg-lime text-ink transition-transform duration-150 ease-out active:scale-[0.94]"
            >
              <Copy className="size-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <div className="flex gap-3">
            <Button size="md" variant="dark" icon={Share} onClick={() => void share()}>
              {copy.live.share}
            </Button>
            <Button size="md" variant="dark" icon={Download} onClick={() => void downloadQr()}>
              {copy.live.downloadQr}
            </Button>
          </div>
        </div>
      </Sheet>
      <QrFullscreen open={qrOpen} onClose={() => setQrOpen(false)} value={url} />
    </>
  );
}
