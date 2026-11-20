"use client";

import { Pause, Play, Square } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CashIcon, ReceiptIcon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/client";
import { copy } from "@/lib/copy";
import { bpsToWholePercent, formatMoney, formatPercent } from "@/lib/format";
import { budgetUsedTenths, formatBpsOneDecimal, formatTenths } from "@/lib/merchant/budget";
import { isRunning } from "@/lib/merchant/campaigns";
import type { OddsPoint } from "@/lib/merchant/odds-history";
import { promoResult, resultWords } from "@/lib/merchant/status";
import type { CampaignAction, CampaignDetailData } from "@/lib/merchant/use-campaign-detail";
import { cn } from "@/lib/utils";

import { LiveChanceChart } from "./live-chance-chart";
import { Money } from "./money";
import { StatTile } from "./stat-tile";

/** The after-the-game report (SCREENS, MD "Bilan"): it opens the Stats tab once `report` exists. */
function ReportCard({
  campaign,
}: {
  campaign: CampaignDetailData & { report: NonNullable<CampaignDetailData["report"]> };
}): React.JSX.Element {
  const { report } = campaign;
  // A report exists once there is an outcome; a cancelled game has its own words, never "Lost".
  const result = promoResult(campaign.status, campaign.outcome) ?? "lost";
  const words = resultWords(result);
  const t = copy.campaignDetail.report;
  return (
    <Card tone="raised" diagonals className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-label uppercase">{t.title}</h2>
        <span className="rounded-full bg-lime px-3 py-1 text-label uppercase text-ink">
          {words.badge}
        </span>
      </div>
      <p className="mt-3 text-body text-muted">{words.body}</p>
      <dl className="mt-4 flex flex-col divide-y divide-white/10">
        <Row label={t.sales}>{report.sales.toLocaleString("en-US")}</Row>
        <Row label={t.newCustomers}>{report.newCustomers.toLocaleString("en-US")}</Row>
        <Row label={t.cost}>
          {t.costValue(formatMoney(report.hedgeCost), formatBpsOneDecimal(report.hedgeCostBps))}
        </Row>
        <Row label={t.refundsPaid}>{formatMoney(report.refundsPaid)}</Row>
        <Row label={t.paidToYou}>{formatMoney(report.paidToMerchant)}</Row>
      </dl>
      {result === "cancelled" ? null : (
        <p className="mt-4 text-caption text-muted">
          {result === "won"
            ? t.sameAsWon(formatBpsOneDecimal(report.equivalentDiscountBps))
            : t.sameAs(formatBpsOneDecimal(report.equivalentDiscountBps))}
        </p>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-body text-muted">{label}</dt>
      <dd className="figures text-right text-body">{children}</dd>
    </div>
  );
}

/**
 * Stats: the report (after the game), the four tiles, what was received and what is pending, the
 * coverage gauge (0 to 100 % of the exposure), the live chance against the auto-pause line, and how
 * many more sales the budget allows.
 */
export function StatsTab({
  campaign,
  points,
  liveBps,
}: {
  campaign: CampaignDetailData;
  points: readonly OddsPoint[];
  /** The chance as the screen sees it (API plus live feed); `null` without a fresh quote. */
  liveBps: number | null;
}): React.JSX.Element {
  const t = copy.campaignDetail;
  const open = campaign.status === "live" || campaign.status === "paused";
  const tracking = open || campaign.status === "sales_closed";
  return (
    <div className="flex flex-col gap-3">
      {campaign.report === null ? null : (
        <ReportCard campaign={{ ...campaign, report: campaign.report }} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatTile label={t.sales} icon={ReceiptIcon}>
          {campaign.sales.toLocaleString("en-US")}
        </StatTile>
        <StatTile label={t.grossSales} icon={CashIcon}>
          <Money micro={campaign.revenue} compact />
        </StatTile>
        <StatTile label={t.exposure} icon={CashIcon}>
          <Money micro={campaign.exposure} compact />
        </StatTile>
        <StatTile label={t.coverageCost} icon={CashIcon}>
          <Money micro={campaign.hedgeSpent} compact />
        </StatTile>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="px-5 py-4">
          <p className="text-body font-light">{t.received}</p>
          <p className="figures mt-1 text-title">{formatMoney(campaign.received)}</p>
          <p className="text-caption text-muted">{t.receivedNote}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-body font-light">{t.pending}</p>
          <p className="figures mt-1 text-title">{formatMoney(campaign.pending)}</p>
          <p className="text-caption text-muted">{t.pendingNote}</p>
        </Card>
      </div>

      <Card className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body font-light">{t.coverage}</p>
          <p className="figures text-title">
            {bpsToWholePercent(campaign.hedgedBps).toString()}
            <span className="text-lime">%</span>
          </p>
        </div>
        <ProgressBar
          value={campaign.hedgedBps / 10_000}
          label={t.coverageBar}
          className="mt-3 h-3"
        />
        <p className="mt-2 text-caption text-muted">{t.coverageNote}</p>
      </Card>

      {tracking ? (
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-body">{t.liveChance}</h2>
              <p className="mt-0.5 flex items-center gap-2 text-caption text-muted">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-team-a" />
                <span className="truncate">{campaign.conditionLabel}</span>
              </p>
            </div>
            <p className="figures shrink-0 text-title">
              {liveBps === null ? "–" : formatPercent(liveBps)}
            </p>
          </div>
          <div className="mt-3">
            {points.length === 0 ? (
              <p className="py-10 text-center text-body text-muted">
                {liveBps === null ? t.chartNoQuote : t.chartEmpty}
              </p>
            ) : (
              <LiveChanceChart points={points} thresholdBps={campaign.pauseThresholdBps} />
            )}
          </div>
          <p className="mt-2 text-caption text-muted">
            {liveBps === null && points.length > 0
              ? t.chartNoQuote
              : points.length < 2
                ? t.chartEmpty
                : t.chartSince}
          </p>
        </Card>
      ) : null}

      {open ? (
        <p className="px-1 text-body text-muted">
          {/* "Up to N more sales" only while it sells: a paused promo sells none, and says why. */}
          {campaign.saleState === "open"
            ? t.moreSales(campaign.capacitySales)
            : t.saleState(
                campaign.saleState,
                bpsToWholePercent(campaign.pauseThresholdBps),
                campaign.subjectName,
              )}
        </p>
      ) : null}
    </div>
  );
}

/** Budget: spent and reserved over the budget, a bar, what is available, and "Add budget". */
export function BudgetTab({
  campaign,
  onAddBudget,
}: {
  campaign: CampaignDetailData;
  onAddBudget: () => void;
}): React.JSX.Element {
  const t = copy.campaignDetail;
  const tenths = budgetUsedTenths(campaign.hedgeSpent, campaign.hedgeReserved, campaign.budget);
  const used = BigInt(campaign.hedgeSpent) + BigInt(campaign.hedgeReserved);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-body font-light">{t.budgetTitle}</h2>
        <div className="mt-2 flex items-end justify-between gap-3">
          <p className="figures flex min-w-0 flex-wrap items-baseline gap-x-2">
            <Money micro={used} compact className="text-figure" />
            <span className="text-body text-muted">
              {t.budgetOf(formatMoney(campaign.budget).replace(/\.00$/, ""))}
            </span>
          </p>
          <p className="figures shrink-0 pb-1 text-body">
            {tenths === null ? "–" : t.budgetUsed(formatTenths(tenths))}
          </p>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={t.budgetBar}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={tenths === null ? 0 : Math.round(tenths / 10)}
        className="h-3 overflow-hidden rounded-full bg-card-raised"
      >
        <div
          className="h-full origin-left rounded-full bg-lime transition-transform duration-400 ease-out"
          style={{ transform: `scaleX(${((tenths ?? 0) / 1000).toString()})` }}
        />
      </div>
      <p className="figures flex items-baseline justify-between text-body">
        <span className="text-muted">{t.available}</span>
        <span>{formatMoney(campaign.budgetAvailable)}</span>
      </p>
      {isRunning(campaign.status) ? (
        <Button onClick={onAddBudget}>{t.addBudget}</Button>
      ) : (
        <p className="text-body text-muted">{t.addBudgetNotRunning}</p>
      )}
    </div>
  );
}

/** Controls: the state of the sales in words, pause or resume, close for good (asks first). */
export function ControlsTab({
  campaign,
  act,
}: {
  campaign: CampaignDetailData;
  act: (action: CampaignAction) => Promise<unknown>;
}): React.JSX.Element {
  const t = copy.campaignDetail;
  const toast = useToast();
  const [busy, setBusy] = useState<CampaignAction | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const pausePercent = bpsToWholePercent(campaign.pauseThresholdBps);
  const canPause = campaign.status === "live" && campaign.saleState === "open";
  const canResume = campaign.saleState === "paused_manual";
  const automaticPause =
    campaign.saleState.startsWith("paused") && campaign.saleState !== "paused_manual";
  const running = isRunning(campaign.status);

  async function run(action: CampaignAction): Promise<void> {
    if (busy !== null) return;
    setBusy(action);
    try {
      await act(action);
      toast.show(action === "pause" ? t.paused : action === "resume" ? t.resumed : t.closedDone);
      if (action === "close") setConfirmClose(false);
    } catch (error: unknown) {
      toast.show(errorMessage(error, t.actionFailed), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <p className="text-label uppercase text-muted">{t.stateLabel}</p>
        <p className="mt-2 flex items-center gap-3 text-lead">
          <span
            aria-hidden="true"
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              campaign.saleState === "open" ? "animate-pulse-dot bg-lime" : "bg-muted",
            )}
          />
          {t.saleState(campaign.saleState, pausePercent, campaign.subjectName)}
        </p>
        {automaticPause ? <p className="mt-3 text-caption text-muted">{t.cannotResume}</p> : null}
      </Card>

      {canPause ? (
        <Button
          variant="dark"
          icon={Pause}
          loading={busy === "pause"}
          disabled={busy !== null}
          onClick={() => void run("pause")}
        >
          {t.pause}
        </Button>
      ) : null}
      {canResume ? (
        <Button
          icon={Play}
          loading={busy === "resume"}
          disabled={busy !== null}
          onClick={() => void run("resume")}
        >
          {t.resume}
        </Button>
      ) : null}
      {running ? (
        <Button
          variant="dark"
          icon={Square}
          disabled={busy !== null}
          onClick={() => setConfirmClose(true)}
        >
          {t.closeNow}
        </Button>
      ) : null}

      <p className="px-1 text-caption text-muted">{t.promiseLocked}</p>

      <Sheet
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t.closeTitle}
        description={t.closeBody}
      >
        <div className="flex flex-col gap-3">
          <Button
            loading={busy === "close"}
            disabled={busy !== null}
            onClick={() => void run("close")}
          >
            {t.closeConfirm}
          </Button>
          <Button variant="dark" arrow={false} onClick={() => setConfirmClose(false)}>
            {t.keepSelling}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
