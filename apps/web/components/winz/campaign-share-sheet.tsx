"use client";

import { Copy, Download, Printer, Share } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { copy } from "@/lib/copy";

import { QrCode } from "./qr-code";
import { QrFullscreen } from "./qr-fullscreen";
import { usePromoShare } from "./use-promo-share";

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
  const [qrOpen, setQrOpen] = useState(false);
  const { copyLink, share, downloadQr, downloadPoster, posterBusy } = usePromoShare({
    url,
    slug,
    promise,
    merchantName,
  });
  const shortUrl = url.replace(/^https?:\/\//, "");

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
          <Button
            size="md"
            variant="dark"
            icon={Printer}
            loading={posterBusy}
            onClick={() => void downloadPoster()}
          >
            {copy.live.downloadPoster}
          </Button>
        </div>
      </Sheet>
      <QrFullscreen open={qrOpen} onClose={() => setQrOpen(false)} value={url} />
    </>
  );
}
