"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Logo } from "@/components/ui/logo";
import { Splash } from "@/components/ui/splash";
import { apiFetch } from "@/lib/api/client";
import { useAsync } from "@/lib/api/use-async";
import { FAN_SIGN_IN_PATH, useAuth, useRouteGuard } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { ticketsView } from "@/lib/fan/tickets-view";

import { LoadError } from "./load-error";
import { TicketCard, TicketCardSkeleton } from "./ticket-card";

/**
 * C4, « My tickets » (LT-2): every ticket of the signed-in person, from `GET /api/tickets`, as
 * Live, Won and Not this time, with what was refunded so far. Reached through the one sign-in
 * (e-mail and code, or Face ID) with the e-mail of the purchase: someone signed out is sent to it
 * (`/start?from=tickets`) and comes back here. A merchant who opens it sees his own tickets.
 * The DEMO MODE band follows the answer by itself (`apiFetch`).
 */
export function TicketsScreen(): React.JSX.Element {
  const ready = useRouteGuard("account");
  const { me, signOut } = useAuth();
  const router = useRouter();
  const tickets = useAsync((signal) => apiFetch("tickets", { signal }), [], { enabled: ready });
  const view = useMemo(
    () => (tickets.data === null ? null : ticketsView(tickets.data)),
    [tickets.data],
  );

  if (!ready) return <Splash />;

  async function switchEmail(): Promise<void> {
    await signOut();
    router.replace(FAN_SIGN_IN_PATH);
  }

  return (
    <main className="flex min-h-dvh flex-col gap-6 px-5 pb-[calc(var(--safe-bottom)+2rem)] pt-[calc(var(--safe-top)+1.25rem)]">
      <Link href="/" aria-label={copy.tickets.home} className="self-start py-2">
        <Logo className="h-[22px]" />
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-hero uppercase">{copy.tickets.title}</h1>
        {me === null ? null : (
          <p className="break-words text-body text-muted">
            {copy.tickets.signedInAs(me.user.email)} ·{" "}
            <button
              type="button"
              onClick={() => void switchEmail()}
              className="-my-3 inline-block py-3 text-lime underline underline-offset-4"
            >
              {copy.tickets.otherEmail}
            </button>
          </p>
        )}
        {view !== null && view.hasRefunds ? (
          <p className="figures text-title">
            <span className="text-lime">{view.refundedTotalText}</span>{" "}
            <span className="text-body text-muted">{copy.tickets.refundedSoFar}</span>
          </p>
        ) : null}
      </header>

      {tickets.error !== null && view === null ? (
        <LoadError
          error={tickets.error}
          onRetry={tickets.reload}
          title={copy.tickets.loadFailedTitle}
        />
      ) : view === null ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <TicketCardSkeleton />
          <TicketCardSkeleton />
        </div>
      ) : view.count === 0 ? (
        <EmptyState
          title={copy.tickets.empty}
          action={
            <div className="flex flex-col items-center gap-4">
              <p className="text-body text-muted">{copy.tickets.emptyHint}</p>
              <Button variant="dark" size="md" arrow={false} onClick={() => void switchEmail()}>
                {copy.tickets.otherEmail}
              </Button>
            </div>
          }
        />
      ) : (
        view.groups.map((group) => (
          <section key={group.key} aria-labelledby={`tickets-${group.key}`}>
            <h2 id={`tickets-${group.key}`} className="mb-3 text-label uppercase text-muted">
              {group.title}
            </h2>
            <ul aria-label={copy.tickets.listLabel(group.title)} className="flex flex-col gap-4">
              {group.rows.map((row) => (
                <li key={row.token}>
                  <TicketCard row={row} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
