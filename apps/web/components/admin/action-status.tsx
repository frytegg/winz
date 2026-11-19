import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";

import { copy } from "@/lib/copy";
import { formatTimeSeconds } from "@/lib/format";
import type { JournalEntry } from "@/lib/admin/journal";
import { cn } from "@/lib/utils";

const T = copy.admin;

/**
 * What the last attempt of an action says, taken from its line of the log. It reads "sending" until
 * the server's answer arrives; "done" is written only from that answer (see `useAdminActions`).
 * A refusal is announced to a screen reader at once, the rest politely.
 */
export function ActionStatus({
  entry,
  sendingText,
}: {
  entry: JournalEntry | null;
  /** What to say while the request is out and no answer has come. */
  sendingText: string;
}): React.JSX.Element | null {
  if (entry === null) return null;
  const pending = entry.status === "sending" || entry.status === "following";
  const failed = entry.status === "error";
  const text = pending
    ? entry.status === "following"
      ? (entry.message ?? sendingText)
      : sendingText
    : (entry.message ?? "");

  return (
    <div
      role={failed ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-card-sm bg-card-raised p-4 text-body",
        failed && "ring-1 ring-inset ring-danger",
      )}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {pending ? (
          <span className="mt-1.5 block size-2.5 animate-pulse-dot rounded-full bg-lime" />
        ) : failed ? (
          <CircleAlert className="size-5 text-danger" strokeWidth={1.5} />
        ) : (
          <CircleCheck className="size-5 text-lime" strokeWidth={1.5} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("[overflow-wrap:anywhere]", failed ? "text-danger" : "text-text")}>
          {text}
        </p>
        {entry.ticketToken === null ? null : (
          <Link
            href={`/t/${encodeURIComponent(entry.ticketToken)}`}
            target="_blank"
            rel="noopener"
            className="mt-2 inline-flex min-h-11 items-center text-body text-lime underline underline-offset-4"
          >
            {T.sale.openTicket}
          </Link>
        )}
        <p className="figures mt-1 text-caption text-muted">
          {T.log.status[entry.status]} · {formatTimeSeconds(entry.at)}
        </p>
      </div>
    </div>
  );
}
