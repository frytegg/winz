"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { apiFetch } from "@/lib/api/client";
import { useAsync } from "@/lib/api/use-async";
import { copy } from "@/lib/copy";
import { orderForTab, type ListTab } from "@/lib/merchant/campaigns";

import { CampaignCard, CampaignCardSkeleton } from "./campaign-card";
import { LoadError } from "./load-error";
import { MerchantFrame } from "./merchant-header";

const TAB_OPTIONS = [
  { value: "inProgress", label: copy.campaigns.inProgress },
  { value: "closed", label: copy.campaigns.closed },
] as const satisfies readonly { value: ListTab; label: string }[];

/** MC: the promos, "In progress" or "Closed". Refreshed every 10 seconds. */
export function CampaignsScreen(): React.JSX.Element {
  const campaigns = useAsync((signal) => apiFetch("campaigns", { signal }), [], { pollMs: 10_000 });
  const [tab, setTab] = useState<ListTab>("inProgress");
  const list = campaigns.data?.campaigns ?? null;
  const shown = useMemo(() => (list === null ? null : orderForTab(list, tab)), [list, tab]);

  return (
    <MerchantFrame>
      <h1 className="sr-only">{copy.campaigns.title}</h1>
      <Segmented
        label={copy.campaigns.tabsLabel}
        options={TAB_OPTIONS}
        value={tab}
        onChange={setTab}
        className="mt-8 h-14"
      />
      {campaigns.error !== null && list === null ? (
        <LoadError error={campaigns.error} onRetry={campaigns.reload} />
      ) : shown === null ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <CampaignCardSkeleton />
          <CampaignCardSkeleton />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={tab === "inProgress" ? copy.campaigns.emptyInProgress : copy.campaigns.emptyClosed}
          action={
            tab === "inProgress" ? (
              <Button href="/new">{copy.campaigns.emptyCta}</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {shown.map((campaign) => (
            <li key={campaign.id}>
              <CampaignCard campaign={campaign} />
            </li>
          ))}
        </ul>
      )}
    </MerchantFrame>
  );
}
