"use client";

import { ChevronRight, ExternalLink, LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { useAsync } from "@/lib/api/use-async";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { formatMoney } from "@/lib/format";

import { MerchantFrame } from "./merchant-header";

interface ExplorerLink {
  id: string;
  promise: string;
  url: string;
}

/** Up to this many promos get their link: each one costs a request. */
const MAX_LINKS = 10;

/**
 * The links of the technical details: the campaigns list has no `onchain`, so the detail of each of
 * the latest promos is read, once, when the section is opened.
 */
async function loadExplorerLinks(signal: AbortSignal): Promise<ExplorerLink[]> {
  const { campaigns } = await apiFetch("campaigns", { signal });
  const details = await Promise.allSettled(
    campaigns
      .slice(0, MAX_LINKS)
      .map((campaign) => apiFetch("campaignDetail", { params: { id: campaign.id }, signal })),
  );
  if (signal.aborted) return [];
  const links: ExplorerLink[] = [];
  details.forEach((result, index) => {
    const listed = campaigns[index];
    if (listed === undefined || result.status !== "fulfilled" || result.value.onchain === null) {
      return;
    }
    // The id of the list entry is the key: it is unique even where two answers look alike.
    links.push({
      id: listed.id,
      promise: result.value.promise,
      url: result.value.onchain.explorerUrl,
    });
  });
  return links;
}

function TechnicalDetails({ address }: { address: string | null }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const links = useAsync(loadExplorerLinks, [], { enabled: open });

  return (
    <details
      className="group rounded-card bg-card"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-body">{copy.settings.technical}</span>
        <ChevronRight
          className="size-5 shrink-0 text-muted transition-transform duration-200 ease-out group-open:rotate-90"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-5 px-5 pb-5">
        <p className="text-caption text-muted">{copy.settings.technicalNote}</p>
        <div>
          <p className="text-label uppercase">{copy.settings.address}</p>
          <p className="mt-1 break-all text-body">{address ?? copy.settings.noAddress}</p>
          <p className="mt-1 text-caption text-muted">{copy.settings.addressNote}</p>
        </div>
        <div className="flex flex-col gap-2">
          {links.error !== null && links.data === null ? (
            <p role="alert" className="text-body text-danger">
              {copy.settings.explorerFailed}
            </p>
          ) : links.data === null ? (
            <Skeleton className="h-11 rounded-full" />
          ) : links.data.length === 0 ? (
            <p className="text-body text-muted">{copy.settings.explorerNone}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {links.data.map((link) => (
                <li key={link.id}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center justify-between gap-3 rounded-full bg-card-raised px-4 text-body"
                  >
                    <span className="min-w-0 truncate">{link.promise}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-caption text-muted">
                      {copy.settings.explorer}
                      <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}

/** Settings: the profile, the balance, sign out, and the technical details folded away. */
export function SettingsScreen(): React.JSX.Element {
  const { me, signOut } = useAuth();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const merchant = me?.merchant ?? null;

  async function leave(): Promise<void> {
    setSigningOut(true);
    try {
      await signOut();
      // The route guard sends a signed-out user back to the sign-in screen.
    } catch {
      toast.show(copy.settings.signOutFailed, "error");
      setSigningOut(false);
    }
  }

  return (
    <MerchantFrame>
      <h1 className="text-step uppercase">{copy.settings.title}</h1>

      <section aria-labelledby="profile" className="flex flex-col gap-3">
        <h2 id="profile" className="text-label uppercase">
          {copy.settings.profile}
        </h2>
        <Card tone="raised" className="p-5">
          <div className="flex items-center gap-4">
            {merchant?.logoUrl != null ? (
              <img
                src={merchant.logoUrl}
                alt=""
                width={56}
                height={56}
                className="size-14 shrink-0 rounded-full bg-white-pill object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="grid size-14 shrink-0 place-items-center rounded-full bg-lime text-lead font-semibold text-ink"
              >
                {(merchant?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-title">{merchant?.name ?? ""}</p>
              <p className="text-body text-muted">
                {merchant === null ? "" : copy.business.categories[merchant.category]}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="text-body text-muted">{copy.settings.email}</p>
            <p className="min-w-0 truncate text-body">{me?.user.email ?? ""}</p>
          </div>
        </Card>
      </section>

      <Link
        href="/balance"
        className="flex min-h-16 items-center gap-4 rounded-card bg-card px-5 py-3 transition-transform duration-150 ease-out active:scale-[0.985]"
      >
        <Wallet className="size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-body">{copy.settings.balanceLink}</span>
          <span className="figures block text-caption text-muted">
            {me?.balance === null || me?.balance === undefined
              ? ""
              : formatMoney(me.balance.available)}
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted" strokeWidth={1.5} aria-hidden="true" />
      </Link>

      <TechnicalDetails address={me?.user.walletAddress ?? null} />

      <Button
        variant="dark"
        arrow={false}
        loading={signingOut}
        leading={<LogOut className="size-5" strokeWidth={1.5} aria-hidden="true" />}
        onClick={() => void leave()}
      >
        {signingOut ? copy.settings.signingOut : copy.settings.signOut}
      </Button>
    </MerchantFrame>
  );
}
