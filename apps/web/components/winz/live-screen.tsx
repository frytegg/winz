"use client";

import { Download, MapPin, Copy, Printer, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BackButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Diagonals } from "@/components/ui/diagonals";
import { Logo } from "@/components/ui/logo";
import { Splash } from "@/components/ui/splash";
import { useWizard } from "@/components/wizard/wizard-context";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { isMockApi } from "@/lib/api/mock-scenario";
import { useAsync } from "@/lib/api/use-async";
import { useAuth, useRouteGuard } from "@/lib/auth";
import { HOME_PATH } from "@/lib/auth/route-guard";
import { copy } from "@/lib/copy";
import {
  LIVE_GIVE_UP_AFTER_MS,
  LIVE_SLOW_AFTER_MS,
  keepsAsking,
  launchStage,
} from "@/lib/merchant/launch-state";
import { gameFromEvent } from "@/lib/fan/teams";

import { Celebration } from "./celebration";
import { QrCode } from "./qr-code";
import { QrFullscreen } from "./qr-fullscreen";
import { TeamBadge } from "./team-badge";
import { usePromoShare } from "./use-promo-share";

const POLL_MS = 1500;
/** In simulated mode the campaign is live at once: hold the waiting state this long so it can be seen. */
const SIMULATED_WAIT_MS = 1500;
const CELEBRATED_PREFIX = "winz.celebrated.";

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

/** The promo's own page in the merchant space: it shows the promo whatever its state. */
function promoHref(campaignId: string): string {
  return `/campaigns/${campaignId}`;
}

/**
 * The waiting state: the W drawn in lime, "Putting your promo live…". After a minute it says that this
 * is taking longer than usual, without ever saying the promo is live, and offers to check again or
 * to follow the promo from its page. After the bound it stops asking and says so (`gaveUp`).
 */
function PuttingLive({
  error,
  stage = "waiting",
  checking = false,
  onCheckAgain,
  campaignId,
}: {
  error?: string;
  /** `slow`: the wait has gone past what is usual. `gaveUp`: past the bound, M8 stopped asking. */
  stage?: "waiting" | "slow" | "gaveUp";
  /** A check the merchant asked for is in flight. */
  checking?: boolean;
  onCheckAgain?: () => void;
  campaignId: string;
}): React.JSX.Element {
  const slow = stage !== "waiting";
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
        {slow ? (
          <>
            <h1 className="text-title">
              {stage === "gaveUp" ? copy.live.gaveUpTitle : copy.live.slowTitle}
            </h1>
            <p className="text-body text-muted">
              {stage === "gaveUp" ? copy.live.gaveUpBody : copy.live.slowBody}
            </p>
          </>
        ) : (
          <p className="text-title">{copy.live.puttingLive}</p>
        )}
        {error === undefined ? null : <p className="text-body text-muted">{error}</p>}
        {slow ? (
          <div className="flex w-full max-w-xs flex-col gap-3 pt-2">
            <Button variant="white" loading={checking} onClick={onCheckAgain}>
              {copy.live.checkAgain}
            </Button>
            <Button href={promoHref(campaignId)} variant="dark" arrow={false}>
              {copy.live.openPromo}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A promo M8 cannot show as live: what happened to it, and where to find it. */
function NotLive({
  title,
  body,
  campaignId,
}: {
  title: string;
  body: string;
  campaignId: string;
}): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-promise">{title}</h1>
      <p className="text-body text-muted">{body}</p>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button href={promoHref(campaignId)} variant="white">
          {copy.live.openPromo}
        </Button>
        <Button href={HOME_PATH} variant="dark" arrow={false}>
          {copy.live.dashboard}
        </Button>
      </div>
    </div>
  );
}

/**
 * M8: waits for the campaign to be live (polling `GET /api/campaigns/:id` every 1.5 seconds while it
 * is `funding`, for five minutes at most), then opens with a wipe and a few diamonds, and shows what a
 * merchant needs at the counter: the countdown, the teams, the QR code, the link, share and the
 * poster (the promise, the merchant's name, the QR code and the link, drawn in the browser).
 * Every other status has its own sentence (`launchStage`): a cancelled game, a promo refunded
 * before it could go live, a promo whose sales are over.
 */
export function LiveScreen({ campaignId }: { campaignId: string }): React.JSX.Element {
  const guarded = useRouteGuard("merchant");
  const { me } = useAuth();
  const { reset } = useWizard();

  const [waited, setWaited] = useState(!isMockApi());
  const [qrOpen, setQrOpen] = useState(false);
  const [celebrate, setCelebrate] = useState<boolean | null>(null);

  // The wizard has done its job: its choices are cleared, so a new promo starts fresh.
  useEffect(() => {
    reset();
  }, [reset]);

  useEffect(() => {
    if (waited) return;
    const timer = setTimeout(() => setWaited(true), SIMULATED_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waited]);

  // How long M8 has waited, in steps: after a minute it says the wait is unusual, after the bound it
  // stops asking. « Check again » starts a new wait (`round`). Leaving the screen cancels the timers.
  const [waitedMs, setWaitedMs] = useState(0);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!guarded) return;
    setWaitedMs(0);
    const slowTimer = setTimeout(() => setWaitedMs(LIVE_SLOW_AFTER_MS), LIVE_SLOW_AFTER_MS);
    const overTimer = setTimeout(() => setWaitedMs(LIVE_GIVE_UP_AFTER_MS), LIVE_GIVE_UP_AFTER_MS);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(overTimer);
    };
  }, [guarded, round]);

  const detail = useAsync(
    (signal) => apiFetch("campaignDetail", { params: { id: campaignId }, signal }),
    [campaignId],
    {
      enabled: guarded && waitedMs < LIVE_GIVE_UP_AFTER_MS,
      pollMs: POLL_MS,
      shouldPoll: (data) => keepsAsking(launchStage(data, 0)),
    },
  );
  const campaign = detail.data;
  const { copyLink, share, downloadQr, downloadPoster, posterBusy } = usePromoShare({
    url: campaign?.url ?? null,
    slug: campaign?.slug ?? null,
    promise: campaign?.promise ?? "",
    merchantName: me?.merchant?.name ?? "",
  });
  const stage = launchStage(campaign, waitedMs);
  const live = stage === "live" && waited;

  function checkAgain(): void {
    setWaitedMs(0);
    setRound((current) => current + 1);
    detail.reload();
  }

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

  if (!guarded) return <Splash />;
  if (stage === "cancelled") {
    return (
      <NotLive
        title={copy.live.cancelledTitle}
        body={copy.live.cancelledBody}
        campaignId={campaignId}
      />
    );
  }
  if (stage === "refunded") {
    return (
      <NotLive
        title={copy.live.failedTitle}
        body={copy.live.refundedBody}
        campaignId={campaignId}
      />
    );
  }
  if (stage === "ended") {
    return (
      <NotLive title={copy.live.endedTitle} body={copy.live.endedBody} campaignId={campaignId} />
    );
  }
  if (stage === "failed") {
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
        stage={stage === "slow" || stage === "gaveUp" ? stage : "waiting"}
        checking={detail.loading}
        onCheckAgain={checkAgain}
        campaignId={campaignId}
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
  const merchantName = me?.merchant?.name ?? "";
  const teams = gameFromEvent(campaign.event);

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
          <Button
            size="md"
            variant="dark"
            icon={Printer}
            loading={posterBusy}
            onClick={() => void downloadPoster()}
          >
            {copy.live.downloadPoster}
          </Button>
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
