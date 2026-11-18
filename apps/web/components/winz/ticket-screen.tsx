"use client";

import type { Ticket } from "@winz/shared";
import { Share2, Ticket as TicketIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/ui/countdown";
import { Diagonals } from "@/components/ui/diagonals";
import { Gauge } from "@/components/ui/gauge";
import { LocalTime } from "@/components/ui/local-time";
import { Logo } from "@/components/ui/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { apiFetch, errorMessage, isApiError } from "@/lib/api/client";
import { isMockApi } from "@/lib/api/mock-scenario";
import { useAsync } from "@/lib/api/use-async";
import { copy } from "@/lib/copy";
import { setDemoMode } from "@/lib/demo/store";
import { formatMoney } from "@/lib/format";
import { shareOrCopy } from "@/lib/share";
import { FALLBACK_POLL_MS, useLiveOdds } from "@/lib/realtime/use-live-odds";
import { cn } from "@/lib/utils";

import { AddToHome } from "./add-to-home";
import { Celebration } from "./celebration";
import { Money } from "./money";
import { TicketShell } from "./ticket-shell";

/** Ticket polling when the live feed carries the odds (BRIEF section 7: 2 to 3 seconds). */
const POLL_MS = 3000;
const CELEBRATED_PREFIX = "winz.refunded.";

function isLive(phase: Ticket["phase"]): boolean {
  return phase === "pre_game" || phase === "in_game";
}

function celebratedBefore(token: string): boolean {
  try {
    return window.sessionStorage.getItem(`${CELEBRATED_PREFIX}${token}`) !== null;
  } catch {
    return false;
  }
}

function markCelebrated(token: string): void {
  try {
    window.sessionStorage.setItem(`${CELEBRATED_PREFIX}${token}`, "1");
  } catch {
    // Storage can be blocked: the confetti may then play again on a reload.
  }
}

/** The page's header: the wordmark, and what to do with the ticket. */
function Header({ tone }: { tone: "ink" | "lime" }): React.JSX.Element {
  return (
    <header className="relative flex h-12 items-center justify-between">
      <Logo tone={tone === "lime" ? "dark" : "lime"} />
      <span
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-full px-3 text-caption",
          tone === "lime" ? "border border-ink text-ink" : "bg-card-raised text-text",
        )}
      >
        <TicketIcon className="size-4" strokeWidth={1.5} aria-hidden="true" />
        {copy.ticket.showAtCounter}
      </span>
    </header>
  );
}

/** The venue's logo, or its initial: also when the link the venue gave is dead. */
function MerchantAvatar({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  if (logoUrl === null || failed) {
    return (
      <span
        aria-hidden="true"
        className="grid size-12 shrink-0 place-items-center rounded-full bg-card-raised text-lead"
      >
        {[...name.trim()][0]?.toUpperCase() ?? ""}
      </span>
    );
  }
  return (
    <img
      src={logoUrl}
      alt=""
      width={48}
      height={48}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-12 shrink-0 rounded-full object-cover"
    />
  );
}

/** The top of every ticket: the venue, what was bought and what was paid. */
function TicketTop({ ticket, tone }: { ticket: Ticket; tone: "card" | "ink" }): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-3">
        <MerchantAvatar name={ticket.merchant.name} logoUrl={ticket.merchant.logoUrl} />
        <div className="min-w-0">
          <p className="truncate text-title">{ticket.merchant.name}</p>
          <p className="truncate text-caption text-muted">
            {copy.ticket.bought} <LocalTime iso={ticket.purchasedAt} style="long" />
          </p>
        </div>
      </div>
      <div
        className={cn(
          "mt-4 flex items-center justify-between gap-3 rounded-card-sm px-4 py-3",
          tone === "card" ? "bg-card-raised" : "bg-card",
        )}
      >
        <p className="min-w-0 truncate text-body">
          {copy.checkout.lineItem(ticket.product, ticket.qty)}
        </p>
        <p
          className="figures flex shrink-0 items-baseline gap-1.5 text-body"
          aria-label={copy.ticket.paid(formatMoney(ticket.paid))}
        >
          <Money micro={ticket.paid} className="text-lead" />
          <span aria-hidden="true" className="text-caption text-muted">
            {copy.ticket.paidWord}
          </span>
        </p>
      </div>
    </>
  );
}

/** Which game this is, and when it starts. */
function MatchLine({ ticket }: { ticket: Ticket }): React.JSX.Element {
  return (
    <p className="flex items-center justify-center gap-2 text-label uppercase text-muted">
      <span className="truncate">{ticket.eventTitle}</span>
      <span aria-hidden="true">·</span>
      <LocalTime iso={ticket.startsAt} style="weekday-time" className="shrink-0" />
    </p>
  );
}

/** "Free if Texas wins by 14+", the promise the ticket carries. */
function Condition({ ticket }: { ticket: Ticket }): React.JSX.Element {
  return (
    <h1 className="text-balance text-center text-promise uppercase">
      {copy.ticket.freeIf(ticket.conditionLabel)}
    </h1>
  );
}

/** Before the game and during it: the ring with the live chance, and what is left to wait for. */
function LivePhase({ ticket, bps }: { ticket: Ticket; bps: number | null }): React.JSX.Element {
  const inGame = ticket.phase === "in_game";
  return (
    <div className="flex flex-col items-center gap-5">
      <MatchLine ticket={ticket} />
      <Condition ticket={ticket} />
      <Gauge bps={bps} />
      <p
        className={cn(
          "flex items-center gap-2 rounded-full bg-card-raised px-4 py-2 text-label uppercase",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-2 animate-pulse-dot rounded-full", inGame ? "bg-danger" : "bg-lime")}
        />
        {inGame ? copy.ticket.gameOn : copy.ticket.liveOdds}
      </p>
      {inGame ? (
        <p className="text-center text-body text-muted">{copy.ticket.gameOnBody}</p>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <span className="text-micro uppercase text-muted">{copy.ticket.kickoffIn}</span>
          <Countdown target={ticket.startsAt} size="sm" />
        </div>
      )}
    </div>
  );
}

function PhaseTag({ children }: { children: string }): React.JSX.Element {
  return (
    <p className="mx-auto w-fit rounded-full bg-card-raised px-3 py-1.5 text-label uppercase">
      {children}
    </p>
  );
}

/** The skeleton of a ticket: the same blocks, so nothing jumps when it arrives. */
function TicketSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-label={copy.common.loading} className="flex flex-col gap-4">
      <Skeleton className="h-40 rounded-card" />
      <Skeleton className="h-96 rounded-card" />
      <Skeleton className="h-14 rounded-full" />
    </div>
  );
}

/** The ticket, once the game is over and the promise did not hit, or the game was cancelled. */
function EndedTicket({ ticket }: { ticket: Ticket }): React.JSX.Element {
  const cancelled = ticket.phase === "cancelled";
  return (
    <div className="flex flex-col gap-5">
      <TicketShell
        top={<TicketTop ticket={ticket} tone="card" />}
        bottom={
          <div className="flex flex-col items-center gap-4 text-center">
            <PhaseTag>
              {cancelled ? copy.ticket.phases.cancelled : copy.ticket.notThisTimeTag}
            </PhaseTag>
            <h1 className="text-balance text-promise">
              {cancelled ? copy.ticket.cancelled : copy.ticket.notThisTime(ticket.merchant.name)}
            </h1>
            <p className="text-body text-muted">
              {cancelled
                ? copy.ticket.cancelledBody
                : copy.ticket.notThisTimeBody(ticket.conditionLabel)}
            </p>
            <MatchLine ticket={ticket} />
          </div>
        }
      />
      {cancelled ? null : (
        <Button href={`/c/${encodeURIComponent(ticket.campaignSlug)}`}>
          {copy.ticket.findAnother}
        </Button>
      )}
    </div>
  );
}

/** The whole screen goes lime: the promise hit and the money is back. */
function RefundedScreen({ ticket }: { ticket: Ticket }): React.JSX.Element {
  const toast = useToast();
  const [celebrate, setCelebrate] = useState(false);

  // The confetti play once per ticket and browser tab, not on every visit to a ticket already won.
  useEffect(() => {
    if (celebratedBefore(ticket.token)) return;
    markCelebrated(ticket.token);
    setCelebrate(true);
  }, [ticket.token]);

  async function share(): Promise<void> {
    const result = await shareOrCopy({
      title: copy.brand.productName,
      text: copy.ticket.shareWinText(ticket.merchant.name, formatMoney(ticket.refundable)),
      url: `${window.location.origin}/c/${encodeURIComponent(ticket.campaignSlug)}`,
    });
    if (result === "copied") toast.show(copy.ticket.linkCopied);
    if (result === "failed") toast.show(copy.common.genericError, "error");
  }

  return (
    <div className="relative flex min-h-dvh flex-col gap-4 overflow-hidden bg-lime px-5 pb-[calc(var(--safe-bottom)+1.5rem)] pt-[calc(var(--safe-top)+1.25rem)] text-ink">
      {celebrate ? (
        <Celebration tone="ink" wipe={false} onDone={() => setCelebrate(false)} />
      ) : null}
      <Header tone="lime" />
      <TicketShell
        tone="ink"
        notchColor="var(--color-lime)"
        className="my-auto animate-rise text-text"
        top={<TicketTop ticket={ticket} tone="ink" />}
        bottom={
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-label uppercase tracking-[0.12em] text-lime">
              {copy.ticket.refunded}
            </h1>
            <Money micro={ticket.refundable} className="text-figure" />
            <p className="text-lead">{copy.ticket.refundedHit(ticket.conditionLabel)}</p>
            <p className="text-body text-muted">{copy.ticket.refundedLine(ticket.merchant.name)}</p>
            {ticket.refundedAt === null ? null : (
              <p className="text-caption text-muted">
                {copy.ticket.refundedOn} <LocalTime iso={ticket.refundedAt} style="long" />
              </p>
            )}
          </div>
        }
      />
      <div className="flex flex-col gap-3 pt-2">
        <Button variant="dark" icon={Share2} onClick={() => void share()}>
          {copy.ticket.shareWin}
        </Button>
      </div>
    </div>
  );
}

/**
 * C3: the live ticket. It polls `GET /api/t/:token` while the game is not over, with the live odds
 * on top, and shows the phase the API says: before the game, game on, refunded (the whole screen
 * turns lime), not this time, or cancelled. No account: the link is the ticket.
 */
export function TicketScreen({ token }: { token: string }): React.JSX.Element {
  const [fastPoll, setFastPoll] = useState(!isMockApi());
  const live = useAsync(
    (signal) => apiFetch("ticketByToken", { params: { token }, signal }),
    [token],
    {
      pollMs: fastPoll ? FALLBACK_POLL_MS : POLL_MS,
      shouldPoll: (data) => isLive(data.phase),
    },
  );
  const ticket = live.data;

  const odds = useLiveOdds(
    ticket?.instrumentSymbol ?? null,
    ticket?.probabilityBps ?? null,
    ticket !== null && isLive(ticket.phase),
  );
  useEffect(() => {
    setFastPoll(!odds.connected && !isMockApi());
  }, [odds.connected]);

  useEffect(() => {
    if (ticket !== null) setDemoMode(ticket.demo);
  }, [ticket]);

  if (ticket === null) {
    const missing = isApiError(live.error) && live.error.status === 404;
    return (
      <div className="relative flex min-h-dvh flex-col gap-4 overflow-hidden px-5 pb-[calc(var(--safe-bottom)+1.5rem)] pt-[calc(var(--safe-top)+1.25rem)]">
        <Diagonals className="opacity-80" />
        <Header tone="ink" />
        {live.error === null || live.loading ? (
          <TicketSkeleton />
        ) : (
          <div
            role="alert"
            className="relative my-auto flex flex-col items-center gap-5 text-center"
          >
            <h1 className="text-promise">
              {missing ? copy.ticket.notFoundTitle : copy.ticket.loadFailedTitle}
            </h1>
            <p className="text-body text-muted">
              {missing
                ? copy.ticket.notFoundBody
                : errorMessage(live.error, copy.common.networkError)}
            </p>
            {missing ? null : (
              <Button variant="dark" onClick={live.reload}>
                {copy.common.tryAgain}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (ticket.phase === "refunded") return <RefundedScreen ticket={ticket} />;

  return (
    <div className="relative flex min-h-dvh flex-col gap-4 overflow-hidden px-5 pb-[calc(var(--safe-bottom)+1.5rem)] pt-[calc(var(--safe-top)+1.25rem)]">
      <Diagonals className="opacity-80" />
      <div className="relative flex flex-1 flex-col gap-4">
        <Header tone="ink" />
        {isLive(ticket.phase) ? (
          <>
            <TicketShell
              top={<TicketTop ticket={ticket} tone="card" />}
              bottom={<LivePhase ticket={ticket} bps={odds.bps} />}
            />
            <AddToHome />
          </>
        ) : (
          <EndedTicket ticket={ticket} />
        )}
      </div>
    </div>
  );
}
