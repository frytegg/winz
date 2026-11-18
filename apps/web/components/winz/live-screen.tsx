"use client";

import { Download, MapPin, Copy, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BackButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Diagonals } from "@/components/ui/diagonals";
import { Logo } from "@/components/ui/logo";
import { Splash } from "@/components/ui/splash";
import { useToast } from "@/components/ui/toast";
import { useWizard } from "@/components/wizard/wizard-context";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { isMockApi } from "@/lib/api/mock-scenario";
import { useAsync } from "@/lib/api/use-async";
import { useAuth, useRouteGuard } from "@/lib/auth";
import { HOME_PATH } from "@/lib/auth/route-guard";
import { copy } from "@/lib/copy";
import { pickTeamArt } from "@/lib/team-art";
import { readLaunched } from "@/lib/wizard/launched";
import { splitEventTitle } from "@/lib/wizard/draft";
import { renderQrPng } from "@/lib/qr";

import { Celebration } from "./celebration";
import { QrCode } from "./qr-code";
import { QrFullscreen } from "./qr-fullscreen";
import { TeamBadge } from "./team-badge";

const POLL_MS = 1500;
/** In simulated mode the campaign is live at once: hold the waiting state this long so it can be seen. */
const SIMULATED_WAIT_MS = 1500;
const CELEBRATED_PREFIX = "winz.celebrated.";

interface TeamView {
  name: string;
  abbreviation: string;
  art: string | null;
}

function celebratedBefore(id: string): boolean {
  try {
    return window.sessionStorage.getItem(`${CELEBRATED_PREFIX}${id}`) !== null;
  } catch {
    return false;
  }
}

function markCelebrated(id: string): void {
  try {
    window.sessionStorage.setItem(`${CELEBRATED_PREFIX}${id}`, "1");
  } catch {
    // Storage can be blocked: the celebration may then play again on a reload.
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and insecure origins: fall back to a hidden field and the copy command.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** The waiting state: the W drawn in lime, "Putting your promo live…". */
function PuttingLive({ error }: { error?: string }): React.JSX.Element {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink px-6">
      <img
        src="/brand/icon-winz-background.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-x-0 top-1/2 w-full -translate-y-1/2 opacity-[0.15]"
      />
      <div role="status" className="relative flex flex-col items-center gap-6 text-center">
        <Logo variant="glyph" className="h-16 animate-draw" />
        <p className="text-title">{copy.live.puttingLive}</p>
        {error === undefined ? null : <p className="text-body text-muted">{error}</p>}
      </div>
    </div>
  );
}

/**
 * M8: waits for the campaign to be live (polling `GET /api/campaigns/:id` every 1.5 seconds while it
 * is `funding`), then opens with a wipe and a few diamonds, and shows what a merchant needs at the
 * counter: the countdown, the teams, the QR code, the link, share and download.
 */
export function LiveScreen({ campaignId }: { campaignId: string }): React.JSX.Element {
  const guarded = useRouteGuard("merchant");
  const { me } = useAuth();
  const { reset } = useWizard();
  const toast = useToast();

  const [waited, setWaited] = useState(!isMockApi());
  const [qrOpen, setQrOpen] = useState(false);
  const [celebrate, setCelebrate] = useState<boolean | null>(null);
  const launched = useMemo(
    () => (typeof window === "undefined" ? null : readLaunched(campaignId)),
    [campaignId],
  );

  // The wizard has done its job: its choices are cleared, so a new promo starts fresh.
  useEffect(() => {
    reset();
  }, [reset]);

  useEffect(() => {
    if (waited) return;
    const timer = setTimeout(() => setWaited(true), SIMULATED_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waited]);

  const detail = useAsync(
    (signal) => apiFetch("campaignDetail", { params: { id: campaignId }, signal }),
    [campaignId],
    { enabled: guarded, pollMs: POLL_MS, shouldPoll: (data) => data.status === "funding" },
  );
  const campaign = detail.data;

  const failed = campaign !== null && (campaign.status === "void" || campaign.status === "draft");
  const live =
    campaign !== null &&
    !failed &&
    campaign.status !== "funding" &&
    campaign.slug !== null &&
    campaign.url !== null &&
    waited;

  // Decide once, when the screen first becomes live, whether to play the opening.
  useEffect(() => {
    if (live && celebrate === null) {
      const first = !celebratedBefore(campaignId);
      setCelebrate(first);
      if (first) {
        markCelebrated(campaignId);
      }
    }
  }, [live, celebrate, campaignId]);

  const teams = useMemo((): { away: TeamView; home: TeamView } | null => {
    if (campaign === null) return null;
    if (launched !== null) {
      const art = pickTeamArt(
        launched.event.sport,
        launched.event.away.abbreviation,
        launched.event.home.abbreviation,
      );
      return {
        away: { ...launched.event.away, art: launched.event.away.logoUrl ?? art?.away ?? null },
        home: { ...launched.event.home, art: launched.event.home.logoUrl ?? art?.home ?? null },
      };
    }
    // No memory of the pick (another device): the names come from the title, in football art.
    const names = splitEventTitle(campaign.eventTitle);
    if (names === null) return null;
    const [away, home] = names.map((name) => ({
      name,
      abbreviation: name
        .replace(/[^A-Za-z]/g, "")
        .slice(0, 3)
        .toUpperCase(),
    })) as [{ name: string; abbreviation: string }, { name: string; abbreviation: string }];
    const art = pickTeamArt("football", away.abbreviation, home.abbreviation);
    return {
      away: { ...away, art: art?.away ?? null },
      home: { ...home, art: art?.home ?? null },
    };
  }, [campaign, launched]);

  if (!guarded) return <Splash />;
  if (failed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-promise">{copy.live.failedTitle}</h1>
        <p className="text-body text-muted">{copy.live.failedBody}</p>
        <Button href="/new?step=game" variant="dark">
          {copy.home.newPromo}
        </Button>
      </div>
    );
  }
  if (!live || campaign === null || campaign.url === null) {
    return (
      <PuttingLive
        error={
          detail.error !== null && campaign === null
            ? errorMessage(detail.error, copy.common.networkError)
            : undefined
        }
      />
    );
  }

  const url = campaign.url;
  const shortUrl = url.replace(/^https?:\/\//, "");
  const merchantName = me?.merchant?.name ?? launched?.merchantName ?? "";

  async function copyLink(): Promise<void> {
    toast.show((await copyText(url)) ? copy.common.copied : copy.common.genericError);
  }

  async function share(): Promise<void> {
    if (typeof navigator.share !== "function") {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: copy.live.shareTitle(merchantName),
        text: copy.live.shareText(campaign?.promise ?? "", merchantName),
        url,
      });
    } catch (error: unknown) {
      if (isAbort(error)) return;
      if (await copyText(url)) toast.show(copy.live.shareFailed);
      else toast.show(copy.common.genericError, "error");
    }
  }

  async function downloadQr(): Promise<void> {
    try {
      const blob = await renderQrPng(url);
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `winz-${campaign?.slug ?? "promo"}-qr.png`;
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
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-ink px-5 pb-[calc(var(--safe-bottom)+1.5rem)] pt-[calc(var(--safe-top)+1.25rem)]">
      <Diagonals className="opacity-80" />
      {celebrate === true ? <Celebration /> : null}

      <div className="relative">
        <BackButton href={HOME_PATH} />
      </div>

      <main className="relative flex flex-1 animate-screen-in flex-col items-center gap-4 text-center">
        <p className="flex items-center gap-2 text-label uppercase">
          <span aria-hidden="true" className="size-2 animate-pulse-dot rounded-full bg-lime" />
          {copy.live.badge}
        </p>
        <h1 className="text-promise-lg uppercase">{copy.live.title}</h1>
        {merchantName === "" ? null : (
          <p className="-mt-1 flex items-center gap-1.5 text-body text-muted">
            <MapPin className="size-4 text-lime" strokeWidth={1.5} aria-hidden="true" />
            {merchantName}
          </p>
        )}

        <Countdown target={campaign.salesCloseAt} size="lg" />

        {teams === null ? (
          <p className="text-lead">{campaign.eventTitle}</p>
        ) : (
          <div className="flex w-full items-center justify-center gap-3">
            <div className="flex w-24 flex-col items-center gap-1">
              <TeamBadge
                abbreviation={teams.away.abbreviation}
                src={teams.away.art}
                side="a"
                size={80}
              />
              <span className="text-lead">{teams.away.abbreviation}</span>
            </div>
            <span
              aria-hidden="true"
              className="grid size-14 place-items-center rounded-full bg-lime text-lead text-ink"
            >
              {copy.pickGame.vs}
            </span>
            <div className="flex w-24 flex-col items-center gap-1">
              <TeamBadge
                abbreviation={teams.home.abbreviation}
                src={teams.home.art}
                side="b"
                size={80}
              />
              <span className="text-lead">{teams.home.abbreviation}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          aria-label={copy.live.enlargeQr}
          onClick={() => setQrOpen(true)}
          className="w-[min(58vw,232px)] rounded-2xl transition-transform duration-150 ease-out active:scale-[0.98]"
        >
          <QrCode value={url} label={copy.live.qrAlt} />
        </button>

        <div className="mt-auto flex w-full flex-col gap-3 pt-2">
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
            <Button size="md" icon={Share2} onClick={() => void share()}>
              {copy.live.share}
            </Button>
            <Button size="md" icon={Download} onClick={() => void downloadQr()}>
              {copy.live.downloadQr}
            </Button>
          </div>
          <Link
            href={HOME_PATH}
            className="mx-auto inline-flex h-11 items-center px-3 text-body text-muted underline underline-offset-4"
          >
            {copy.live.dashboard}
          </Link>
        </div>
      </main>

      <QrFullscreen open={qrOpen} onClose={() => setQrOpen(false)} value={url} />
    </div>
  );
}
