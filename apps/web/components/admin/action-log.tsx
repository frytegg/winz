import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { JournalEntry } from "@/lib/admin/journal";
import { copy } from "@/lib/copy";
import { formatTimeSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

const T = copy.admin.log;

function StatusMark({ status }: { status: JournalEntry["status"] }): React.JSX.Element {
  // The word is always written next to the mark: a state is never carried by colour alone.
  return (
    <span className="inline-flex items-center gap-1.5 text-caption font-semibold">
      {status === "done" ? (
        <CircleCheck className="size-4 text-lime" strokeWidth={1.75} aria-hidden="true" />
      ) : status === "error" ? (
        <CircleAlert className="size-4 text-danger" strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="size-2 animate-pulse-dot rounded-full bg-lime" />
      )}
      <span className={cn(status === "error" ? "text-danger" : "text-text")}>
        {T.status[status]}
      </span>
    </span>
  );
}

/** Every action sent from this page and what the server answered, newest first. Not saved. */
export function ActionLog({ entries }: { entries: readonly JournalEntry[] }): React.JSX.Element {
  return (
    <section aria-labelledby="admin-log-title">
      <Card className="p-5 lg:p-6">
        <div className="flex flex-col gap-5">
          <div>
            <h2 id="admin-log-title" className="text-promise uppercase">
              {T.title}
            </h2>
            <p className="mt-1 max-w-[60ch] text-body text-muted">{T.lead}</p>
          </div>
          {entries.length === 0 ? (
            <p className="rounded-card-sm bg-card-raised p-5 text-body text-muted">{T.empty}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {entries.map((entry) => (
                <li key={entry.id} className="rounded-card-sm bg-card-raised px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <p className="text-body text-text">{T.actions[entry.action]}</p>
                    <div className="flex items-center gap-3">
                      <StatusMark status={entry.status} />
                      <time dateTime={entry.at} className="figures text-caption text-muted">
                        {formatTimeSeconds(entry.at)}
                      </time>
                    </div>
                  </div>
                  <p className="mt-1 text-caption text-muted [overflow-wrap:anywhere]">
                    {entry.summary}
                  </p>
                  <p className="mt-1 text-caption text-text [overflow-wrap:anywhere]">
                    {entry.message ?? T.noAnswer}
                  </p>
                  {entry.ticketToken === null ? null : (
                    <Link
                      href={`/t/${encodeURIComponent(entry.ticketToken)}`}
                      target="_blank"
                      rel="noopener"
                      className="mt-1 inline-flex min-h-11 items-center text-caption text-lime underline underline-offset-4"
                    >
                      {copy.admin.sale.openTicket}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </section>
  );
}
