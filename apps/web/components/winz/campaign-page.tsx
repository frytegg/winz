"use client";

import type { PublicCampaign } from "@winz/shared";
import { CreditCard, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Diagonals } from "@/components/ui/diagonals";
import { AppleMark } from "@/components/ui/icons";
import { BackButton } from "@/components/ui/icon-button";
import { LimePercent } from "@/components/ui/lime-percent";
import { QtyStepper } from "@/components/ui/qty-stepper";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { getMockScenario, isMockApi } from "@/lib/api/mock-scenario";
import { useAsync } from "@/lib/api/use-async";
import { setDemoMode } from "@/lib/demo/store";
import { copy } from "@/lib/copy";
import { totalMicro } from "@/lib/fan/amount";
import { teamsFromTitle } from "@/lib/fan/teams";
import { bpsToWholePercent } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { FALLBACK_POLL_MS, useLiveOdds } from "@/lib/realtime/use-live-odds";

import { CheckoutSheet, type PayMethod } from "./checkout-sheet";
import { Money } from "./money";
import { TeamBadge } from "./team-badge";

const MIN_QTY = 1;
const MAX_QTY = 20;
/** With the live feed connected the API only confirms the sale state; without it, it is the odds. */
const SLOW_POLL_MS = 5000;

function isPaused(state: PublicCampaign["saleState"]): boolean {
  return state !== "open" && state !== "closed";
}

function Teams({ title }: { title: string }): React.JSX.Element {
  const teams = teamsFromTitle(title);
  if (teams === null) return <p className="text-lead">{title}</p>;
  const side = (team: NonNullable<typeof teams>["away"], tone: "a" | "b"): React.JSX.Element => (
    <div className="flex w-28 flex-col items-center gap-1.5">
      <TeamBadge abbreviation={team.abbreviation} src={team.art} side={tone} size={72} />
      <span className="max-w-full truncate text-lead">{team.name}</span>
      <span className="text-label uppercase text-muted">{team.abbreviation}</span>
    </div>
  );
  return (
    <div
      role="group"
      aria-label={copy.campaign.teams(teams.away.name, teams.home.name)}
      className="flex w-full items-start justify-center gap-2"
    >
      {side(teams.away, "a")}
      <span
        aria-hidden="true"
        className="mt-6 grid size-14 shrink-0 place-items-center rounded-full bg-lime text-lead text-ink"
      >
        {copy.pickGame.vs}
      </span>
      {side(teams.home, "b")}
    </div>
  );
}

/** The skeleton of the page: same blocks, so nothing jumps when the promo arrives. */
function CampaignSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-label={copy.common.loading} className="flex flex-1 flex-col gap-6">
      <Skeleton className="mx-auto h-4 w-48 rounded-full" />
      <Skeleton className="h-28" />
      <Skeleton className="mx-auto h-12 w-64" />
      <Skeleton className="h-28" />
      <Skeleton className="mt-auto h-32" />
    </div>
  );
}

/** What the promo says once the game is over. */
function Settled({ campaign }: { campaign: PublicCampaign }): React.JSX.Element {
  const yes = campaign.outcome === "yes";
  const voided = campaign.outcome === "void";
  const title = yes ? copy.campaign.won : voided ? copy.campaign.voided : copy.campaign.lost;
  const body = yes
    ? copy.campaign.wonBody(campaign.conditionLabel)
    : voided
      ? copy.campaign.voidedBody
      : copy.campaign.lostBody(campaign.merchant.name);
  return (
    <Card
      tone={yes ? "default" : "raised"}
      diagonals
      className={yes ? "bg-lime px-6 py-8 text-center text-ink" : "px-6 py-8 text-center"}
      role="status"
    >
      <h2 className="text-promise">{title}</h2>
      <p className={yes ? "mt-2 text-body text-ink" : "mt-2 text-body text-muted"}>{body}</p>
    </Card>
  );
}

/**
 * C1: the promo page. `initial` is what the server read (the promise is in the HTML); from there the
 * page keeps itself fresh: the odds live, the sale state every few seconds. Nothing here needs an
 * account.
 */
export function CampaignPage({
  slug,
  initial,
  initialScenario,
}: {
  slug: string;
  initial: PublicCampaign | null;
  /** The mock scenario the server asked for, to tell when this browser remembers another one. */
  initialScenario: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const hydrated = useHydrated();
  const [qty, setQty] = useState(MIN_QTY);
  const [method, setMethod] = useState<PayMethod>("apple-pay");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [fastPoll, setFastPoll] = useState(!isMockApi());

  const live = useAsync(
    (signal) => apiFetch("publicCampaign", { params: { slug }, signal }),
    [slug],
    {
      pollMs: fastPoll ? FALLBACK_POLL_MS : SLOW_POLL_MS,
      shouldPoll: (data) => data.outcome === null,
    },
  );

  // In the simulated mode the browser may remember a scenario the server did not know about: the
  // server's copy is then another example, so wait for the first answer instead of flashing it.
  const trustInitial = !hydrated || getMockScenario() === initialScenario;
  const campaign = live.data ?? (trustInitial ? initial : null);

  const odds = useLiveOdds(campaign?.instrumentSymbol ?? null, campaign?.probabilityBps ?? null);
  useEffect(() => {
    setFastPoll(!odds.connected && !isMockApi());
  }, [odds.connected]);

  useEffect(() => {
    if (campaign !== null) setDemoMode(campaign.demo);
  }, [campaign]);

  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);

  const header = (
    <div className="relative h-12">
      {canGoBack ? <BackButton onClick={() => router.back()} /> : null}
    </div>
  );

  if (campaign === null) {
    return (
      <div className="relative flex min-h-dvh flex-col overflow-hidden px-5 pb-[calc(var(--safe-bottom)+1.5rem)] pt-[calc(var(--safe-top)+1.25rem)]">
        <Diagonals className="opacity-80" />
        <div className="relative flex flex-1 flex-col gap-4">
          {header}
          {live.error === null || live.loading ? (
            <CampaignSkeleton />
          ) : (
            <div role="alert" className="my-auto flex flex-col items-center gap-5 text-center">
              <h1 className="text-promise">{copy.campaign.loadFailedTitle}</h1>
              <p className="text-body text-muted">
                {errorMessage(live.error, copy.common.networkError)}
              </p>
              <Button variant="dark" onClick={live.reload}>
                {copy.common.tryAgain}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const settled = campaign.outcome !== null;
  const closed = campaign.saleState === "closed" && !settled;
  const paused = isPaused(campaign.saleState) && !settled;
  const canBuy = campaign.saleState === "open" && !settled;
  const percent = odds.bps === null ? null : bpsToWholePercent(odds.bps);

  function openSheet(next: PayMethod): void {
    setMethod(next);
    setSheetOpen(true);
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden px-5 pb-[calc(var(--safe-bottom)+1.25rem)] pt-[calc(var(--safe-top)+1rem)]">
      <Diagonals className="opacity-80" />
      <div className="relative flex flex-1 flex-col">
        {header}

        <main className="flex flex-1 flex-col items-center gap-3 text-center">
          <p className="flex items-center gap-2 text-label uppercase">
            <span aria-hidden="true" className="size-2 rounded-full bg-lime" />
            {copy.campaign.badge}
          </p>
          <h1 className="text-promise-lg uppercase">
            <LimePercent text={campaign.promise} />
          </h1>
          <p className="-mt-1 flex items-center gap-1.5 text-body">
            <MapPin className="size-4 text-lime" strokeWidth={1.5} aria-hidden="true" />
            {campaign.merchant.name}
          </p>

          {settled || closed ? null : (
            <div className="flex flex-col items-center gap-1">
              <span className="text-micro uppercase text-muted">{copy.campaign.salesCloseIn}</span>
              <Countdown target={campaign.salesCloseAt} size="lg" onExpire={live.reload} />
            </div>
          )}

          <Teams title={campaign.eventTitle} />

          {settled ? null : (
            <p
              className="figures flex items-center gap-2 rounded-full bg-card-raised px-4 py-2 text-lead"
              aria-live="off"
            >
              {percent === null ? (
                <span className="text-muted">{copy.campaign.chanceUpdating}</span>
              ) : (
                <>
                  <AnimatedNumber
                    value={percent}
                    format={(n) => `${n.toString()}%`}
                    className="figures text-lime"
                  />
                  <span>{copy.campaign.chanceSuffix}</span>
                </>
              )}
            </p>
          )}

          <div
            className={cn(
              "flex w-full flex-col gap-3",
              settled || closed ? "my-auto" : "mt-auto pt-2",
            )}
          >
            {settled ? (
              <Settled campaign={campaign} />
            ) : closed ? (
              <Card tone="raised" className="px-6 py-8 text-center" role="status">
                <h2 className="text-promise">{copy.campaign.closed}</h2>
              </Card>
            ) : (
              <>
                {paused ? (
                  <p role="status" className="rounded-card-sm bg-card-raised px-4 py-3 text-body">
                    {copy.campaign.paused}
                  </p>
                ) : null}
                <Card tone="raised" className="rounded-card-sm p-4 text-left">
                  <p className="truncate text-promise">{campaign.product}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <Money micro={totalMicro(campaign.unitPrice, qty)} className="text-figure-sm" />
                    <QtyStepper
                      value={qty}
                      onChange={setQty}
                      min={MIN_QTY}
                      max={MAX_QTY}
                      label={copy.campaign.quantity}
                      disabled={!canBuy}
                    />
                  </div>
                </Card>
                <Button
                  variant="white"
                  arrow={false}
                  disabled={!canBuy}
                  leading={<AppleMark className="size-5" />}
                  onClick={() => openSheet("apple-pay")}
                >
                  {copy.campaign.buyApplePay}
                </Button>
                <Button
                  variant="dark"
                  arrow={false}
                  disabled={!canBuy}
                  leading={<CreditCard className="size-5" strokeWidth={1.5} aria-hidden="true" />}
                  onClick={() => openSheet("card")}
                >
                  {copy.campaign.payWithCard}
                </Button>
                {paused ? null : (
                  <p className="px-2 text-caption text-muted">
                    {copy.campaign.pitch(campaign.conditionLabel)}
                  </p>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      <CheckoutSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        campaign={campaign}
        qty={qty}
        method={method}
        canPay={canBuy}
      />
    </div>
  );
}
