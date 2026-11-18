"use client";

import { apiExamples } from "@winz/shared";
import {
  ArrowDownLeft,
  Beer,
  Hamburger,
  Pizza,
  Search,
  ShoppingBag,
  Store,
  Share2,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { BackButton, IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Countdown } from "@/components/ui/countdown";
import { Field } from "@/components/ui/field";
import { Gauge } from "@/components/ui/gauge";
import { LimePercent } from "@/components/ui/lime-percent";
import { Logo } from "@/components/ui/logo";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { BalancePill } from "@/components/winz/balance-pill";
import { BottomNav } from "@/components/winz/bottom-nav";
import { CampaignHero } from "@/components/winz/campaign-hero";
import { MatchCard } from "@/components/winz/match-card";
import { Money } from "@/components/winz/money";
import { PromoCard } from "@/components/winz/promo-card";
import { StatTile } from "@/components/winz/stat-tile";
import { TeamBadge } from "@/components/winz/team-badge";
import { TicketShell } from "@/components/winz/ticket-shell";
import { setDemoMode } from "@/lib/demo/store";
import { copy } from "@/lib/copy";
import { formatMoney, parseDollarsToCents, centsToMicro } from "@/lib/format";

const COLORS = [
  ["lime", "bg-lime"],
  ["lime-press", "bg-lime-press"],
  ["lime-dim", "bg-lime-dim"],
  ["ink", "bg-ink"],
  ["ink-deep", "bg-ink-deep"],
  ["card", "bg-card"],
  ["card-raised", "bg-card-raised"],
  ["muted", "bg-muted"],
  ["subtle", "bg-subtle"],
  ["danger", "bg-danger"],
  ["team-a", "bg-team-a"],
  ["team-b", "bg-team-b"],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-label uppercase text-lime">{title}</h2>
      {children}
    </section>
  );
}

const game = apiExamples.eventsExample.events[0];
const promos = game?.templates ?? [];
const inOneDay = new Date(Date.now() + 2 * 86_400_000 + 4 * 3_600_000 + 45 * 60_000).toISOString();

export function KitDemo(): React.JSX.Element {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState<"stats" | "budget" | "controls">("stats");
  const [period, setPeriod] = useState<"month" | "week" | "today">("month");
  const [category, setCategory] = useState<"bar" | "pizza" | "burger" | "retail" | "other">(
    "pizza",
  );
  const [sport, setSport] = useState<"all" | "football">("football");
  const [selectedGame, setSelectedGame] = useState(true);
  const [selectedPromo, setSelectedPromo] = useState<string>("tpl_tex13_full");
  const [price, setPrice] = useState(2000);
  const [margin, setMargin] = useState(65);
  const [minMargin, setMinMargin] = useState(45);
  const [budget, setBudget] = useState(100_000);
  const [chance, setChance] = useState(1200);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  if (game === undefined) return <p>No example game.</p>;

  return (
    <main className="flex flex-col gap-10 px-5 pb-nav pt-8">
      <header className="flex items-center justify-between">
        <Logo />
        <span className="text-label uppercase text-muted">Component kit</span>
      </header>

      <Section title="Colors">
        <div className="grid grid-cols-4 gap-2">
          {COLORS.map(([name, background]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className={`h-12 rounded-card-sm border border-white/10 ${background}`} />
              <span className="text-caption text-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <p className="text-hero uppercase">All the hype. None of the risk.</p>
        <p className="text-step">
          <span className="text-lime">4.</span> Set a budget
        </p>
        <p className="text-promise uppercase">
          <LimePercent text="100% back if Texas wins by 14+" />
        </p>
        <p className="text-figure">
          <Money micro="2145450000" />
        </p>
        <Countdown target={inOneDay} size="lg" />
        <p className="text-body">
          Body 15/22: pay the normal price, get it back if Texas wins by 14+.
        </p>
        <p className="text-label uppercase">Field label 13/16</p>
        <p className="text-caption text-muted">Caption 12/16, muted</p>
      </Section>

      <Section title="Buttons">
        <Button onClick={() => toast.show(copy.common.copied)}>Start a promo</Button>
        <Button disabled>Disabled</Button>
        <Button
          loading={loading}
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1600);
          }}
        >
          Loading on tap
        </Button>
        <Button variant="white" size="md" arrow={false}>
          Buy with Apple Pay
        </Button>
        <Button variant="dark" size="md" arrow={false}>
          Pay with card
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button size="md" icon={ArrowDownLeft}>
            Withdraw
          </Button>
          <Button size="md" variant="white">
            Deposit
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <BackButton />
          <IconButton icon={Share2} label="Share" tone="white" />
          <IconButton icon={Search} label="Search" tone="card" />
          <IconButton icon={Share2} label="Share" tone="lime" />
        </div>
      </Section>

      <Section title="Progress and fields">
        <ProgressBar value={0.45} label="Journey" />
        <Field
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@yourbusiness.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          label="Business name"
          placeholder="Joe's Pizza"
          error="Add your business name."
          shakeKey={1}
        />
        <Field label="Disabled" disabled value="Locked" readOnly />
      </Section>

      <Section title="Steppers and slider">
        <Stepper
          label="Product price"
          prefix="$"
          value={price}
          onChange={setPrice}
          step={100}
          min={50}
          max={99_999_999}
          format={(cents) => formatMoney(centsToMicro(cents)).slice(1)}
          parse={parseDollarsToCents}
        />
        <div className="grid grid-cols-2 gap-3">
          <Stepper
            label="Usual margin"
            suffix="%"
            value={margin}
            onChange={setMargin}
            step={1}
            min={0}
            max={100}
          />
          <Stepper
            label="Budget"
            prefix="$"
            value={budget}
            onChange={setBudget}
            step={5000}
            min={50}
            max={99_999_999}
            format={(cents) => (cents / 100).toLocaleString("en-US")}
            parse={parseDollarsToCents}
          />
        </div>
        <Slider
          label="Minimum margin to keep"
          value={minMargin}
          onChange={setMinMargin}
          min={0}
          max={margin}
          display={`${minMargin.toString()}%`}
        />
      </Section>

      <Section title="Segmented and chips">
        <Segmented
          label="Period"
          options={[
            { value: "month", label: copy.home.periods.month },
            { value: "week", label: copy.home.periods.week },
            { value: "today", label: copy.home.periods.today },
          ]}
          value={period}
          onChange={setPeriod}
        />
        <Segmented
          label="Campaign view"
          semantics="tabs"
          options={[
            { value: "stats", label: copy.campaignDetail.tabs.stats },
            { value: "budget", label: copy.campaignDetail.tabs.budget },
            { value: "controls", label: copy.campaignDetail.tabs.controls },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
          <Chip label="All" active={sport === "all"} onClick={() => setSport("all")} />
          <Chip
            label={copy.sports.football}
            active={sport === "football"}
            onClick={() => setSport("football")}
          />
          <Chip label={copy.sports.basketball} disabled />
        </div>
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
          {(
            [
              ["bar", Beer],
              ["pizza", Pizza],
              ["burger", Hamburger],
              ["retail", ShoppingBag],
              ["other", Store],
            ] as const
          ).map(([key, icon]) => (
            <Chip
              key={key}
              variant="fill"
              icon={icon}
              label={copy.business.categories[key]}
              active={category === key}
              onClick={() => setCategory(key)}
            />
          ))}
        </div>
      </Section>

      <Section title="Match cards">
        <MatchCard
          sport={game.sport}
          away={game.away}
          home={game.home}
          startsAt={game.startsAt}
          awayChanceBps={900}
          homeChanceBps={9100}
          selected={selectedGame}
          onSelect={() => setSelectedGame((value) => !value)}
        />
        <MatchCard
          sport="basketball"
          away={{ name: "Villanova", abbreviation: "VILL", logoUrl: null }}
          home={{ name: "Pittsburgh", abbreviation: "PITT", logoUrl: null }}
          startsAt={game.startsAt}
          onSelect={() => undefined}
        />
        <MatchCard
          sport="hockey"
          away={{ name: "Bruins", abbreviation: "BOS", logoUrl: null }}
          home={{ name: "Canadiens", abbreviation: "MTL", logoUrl: null }}
          startsAt={game.startsAt}
          disabled
          disabledLabel={copy.pickGame.oddsNotOpen}
        />
        <div className="flex gap-4">
          <TeamBadge abbreviation="TEX" src="/sports/football-38.png" size={56} />
          <TeamBadge abbreviation="ARK" src={null} side="a" size={56} />
          <TeamBadge abbreviation="PIT" src={null} side="b" size={56} />
        </div>
      </Section>

      <Section title="Promo cards">
        {promos.map((promo, index) => (
          <PromoCard
            key={promo.id}
            headline={promo.headline}
            refundBps={promo.refundBps}
            costBps={promo.costBps}
            probabilityBps={promo.probabilityBps}
            recommended={index === 0}
            selected={selectedPromo === promo.id}
            unavailableReason={promo.unavailableReason}
            onSelect={() => setSelectedPromo(promo.id)}
          />
        ))}
      </Section>

      <Section title="Campaign hero, stats, balance">
        <CampaignHero
          promise="100% back if Texas wins by 14+"
          merchantName="Joe's Pizza"
          statusLabel={copy.campaigns.liveBadge}
          pulsing
          closesAt={inOneDay}
        />
        <div className="grid grid-cols-2 gap-3">
          <StatTile label={copy.campaignDetail.sales}>47</StatTile>
          <StatTile label="Long amount">
            <Money micro="12420500000" />
          </StatTile>
          <StatTile label={copy.campaignDetail.grossSales}>
            <Money micro="940000000" compact />
          </StatTile>
        </div>
        <div className="flex items-center justify-between">
          <BalancePill micro="2145450000" href="/balance" />
          <BalancePill micro={null} href="/balance" />
        </div>
        <Card tone="raised" diagonals className="p-6">
          <p className="text-center text-muted">Current balance</p>
          <p className="text-center text-figure">
            <Money micro="2145450000" />
          </p>
        </Card>
      </Section>

      <Section title="Ticket">
        <Gauge bps={chance} />
        <Slider
          label="Live odds"
          value={chance}
          onChange={setChance}
          min={0}
          max={10_000}
          step={100}
          display={`${(chance / 100).toString()}%`}
        />
        <TicketShell
          top={
            <div>
              <p className="text-[17px] font-semibold">Joe&apos;s Pizza</p>
              <p className="text-muted">Large pizza × 1</p>
              <p className="mt-3">
                <Money micro="20000000" /> paid
              </p>
            </div>
          }
          bottom={
            <div>
              <p className="text-label uppercase text-muted">Arkansas vs Texas</p>
              <p className="mt-2 text-promise uppercase">Free if Texas wins by 14+</p>
            </div>
          }
        />
      </Section>

      <Section title="Sheet, toast, demo banner, skeletons">
        <Button variant="dark" size="md" arrow={false} onClick={() => setSheet(true)}>
          Open the sheet
        </Button>
        <Button
          variant="dark"
          size="md"
          arrow={false}
          onClick={() => toast.show(copy.common.copied)}
        >
          Show a toast
        </Button>
        <Button
          variant="dark"
          size="md"
          arrow={false}
          onClick={() => toast.show(copy.common.genericError, "error")}
        >
          Show an error toast
        </Button>
        <Button variant="dark" size="md" arrow={false} onClick={() => setDemoMode(true)}>
          Turn DEMO MODE on
        </Button>
        <Button variant="dark" size="md" arrow={false} onClick={() => setDemoMode(false)}>
          Turn DEMO MODE off
        </Button>
        <Skeleton className="h-40" />
        <div className="flex gap-3">
          <Skeleton className="h-24 flex-1" />
          <Skeleton className="h-24 flex-1" />
        </div>
      </Section>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title={copy.home.withdrawTitle}
        description={copy.home.withdrawBody}
      >
        <Button onClick={() => setSheet(false)}>{copy.common.confirm}</Button>
      </Sheet>

      <BottomNav activeHref="/home" />
    </main>
  );
}
