"use client";

import type { HedgeFill, HedgeOrder } from "@winz/shared";
import {
  Ban,
  Check,
  ChevronDown,
  CircleDashed,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { copy } from "@/lib/copy";
import { formatTimeSeconds, formatMoney } from "@/lib/format";
import { formatPriceBps, formatQty } from "@/lib/hedge/format";
import { newestFirst } from "@/lib/hedge/view";
import { cn } from "@/lib/utils";

/** Rows shown before "Show all": the newest, which is what a jury looks at. */
const COLLAPSED_ROWS = 6;

interface Column<T> {
  key: string;
  header: string;
  align?: "right";
  /** Share of the table, so a fixed layout keeps the columns apart. */
  width: string;
  /** Left padding, to keep a left-aligned column off the right-aligned one before it. */
  inset?: boolean;
  cell: (row: T) => ReactNode;
}

/**
 * A table for a laptop and a list for a phone, from the same rows: five columns of 12px figures do
 * not fit 329px, so under `md` each row becomes two lines. Newest first; past six rows the rest folds
 * behind a button, so a busy instrument does not push the others off the screen.
 */
function Feed<T extends { id: string; at: string }>({
  title,
  empty,
  rows,
  columns,
  mobile,
}: {
  title: string;
  empty: string;
  rows: readonly T[];
  columns: readonly Column<T>[];
  mobile: (row: T) => ReactNode;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const sorted = newestFirst(rows);
  const shown = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);

  return (
    <section aria-label={title}>
      <h4 className="flex items-baseline gap-2 text-label font-semibold uppercase tracking-[0.02em] text-text">
        {title}
        <span className="figures text-caption font-normal normal-case text-muted">
          {sorted.length.toString()}
        </span>
      </h4>
      {sorted.length === 0 ? (
        <p className="mt-3 rounded-card-sm border border-dashed border-stroke px-4 py-5 text-body text-muted">
          {empty}
        </p>
      ) : (
        <>
          <table className="mt-2 hidden w-full table-fixed border-collapse md:table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    style={{ width: column.width }}
                    className={cn(
                      "pb-2 text-caption font-normal text-muted",
                      column.align === "right" ? "text-right" : "text-left",
                      column.inset === true && "pl-4",
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className="border-t border-white/10">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "figures py-2.5 text-caption text-text [overflow-wrap:anywhere]",
                        column.align === "right" ? "text-right" : "text-left",
                        column.inset === true && "pl-4",
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-2 md:hidden">
            {shown.map((row) => (
              <li key={row.id} className="border-t border-white/10 py-3 text-caption">
                {mobile(row)}
              </li>
            ))}
          </ul>
          {sorted.length > COLLAPSED_ROWS ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-label text-text transition-colors duration-150 hover:text-lime"
            >
              {expanded ? copy.hedgeDesk.showLess : copy.hedgeDesk.showAll(sorted.length)}
              <ChevronDown
                className={cn(
                  "size-4 transition-transform duration-240 ease-out",
                  expanded && "rotate-180",
                )}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

const STATUS_ICON: Record<HedgeOrder["status"], LucideIcon> = {
  working: CircleDashed,
  filled: Check,
  partially_filled: CircleDashed,
  cancelled: Ban,
  rejected: TriangleAlert,
};

function StatusLabel({ status }: { status: HedgeOrder["status"] }): React.JSX.Element {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        status === "rejected" ? "text-danger" : status === "filled" ? "text-text" : "text-muted",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {copy.hedgeDesk.orders.statuses[status]}
    </span>
  );
}

const O = copy.hedgeDesk.orders;
const F = copy.hedgeDesk.fills;

function orderType(order: Pick<HedgeOrder, "kind" | "side">): string {
  return `${O.kind[order.kind]} ${O.side[order.side].toLowerCase()}`;
}

function filledOf(order: HedgeOrder): string {
  return `${formatQty(order.filledQty)} / ${formatQty(order.qty)}`;
}

const ORDER_COLUMNS: readonly Column<HedgeOrder>[] = [
  { key: "time", width: "19%", header: O.time, cell: (order) => formatTimeSeconds(order.at) },
  { key: "type", width: "17%", header: O.type, cell: orderType },
  {
    key: "price",
    width: "12%",
    header: O.price,
    align: "right",
    cell: (order) => formatPriceBps(order.priceBps),
  },
  { key: "filled", width: "27%", header: O.filled, align: "right", cell: filledOf },
  {
    key: "status",
    width: "25%",
    header: O.status,
    inset: true,
    cell: (order) => <StatusLabel status={order.status} />,
  },
];

const FILL_COLUMNS: readonly Column<HedgeFill>[] = [
  { key: "time", width: "26%", header: F.time, cell: (fill) => formatTimeSeconds(fill.at) },
  { key: "type", width: "20%", header: F.type, cell: (fill) => O.kind[fill.kind] },
  {
    key: "price",
    width: "16%",
    header: F.price,
    align: "right",
    cell: (fill) => formatPriceBps(fill.priceBps),
  },
  { key: "qty", width: "20%", header: F.qty, align: "right", cell: (fill) => formatQty(fill.qty) },
  {
    key: "fee",
    width: "18%",
    header: F.fee,
    align: "right",
    cell: (fill) => formatMoney(fill.fee),
  },
];

export function OrdersTable({ orders }: { orders: readonly HedgeOrder[] }): React.JSX.Element {
  return (
    <Feed
      title={O.title}
      empty={O.empty}
      rows={orders}
      columns={ORDER_COLUMNS}
      mobile={(order) => (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="figures font-semibold text-text">
              {orderType(order)} · {formatPriceBps(order.priceBps)}
            </span>
            <StatusLabel status={order.status} />
          </div>
          <div className="figures mt-1 flex justify-between gap-3 text-muted">
            <span>{formatTimeSeconds(order.at)}</span>
            <span>
              {O.filled} {filledOf(order)}
            </span>
          </div>
        </>
      )}
    />
  );
}

export function FillsTable({ fills }: { fills: readonly HedgeFill[] }): React.JSX.Element {
  return (
    <Feed
      title={F.title}
      empty={F.empty}
      rows={fills}
      columns={FILL_COLUMNS}
      mobile={(fill) => (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="figures font-semibold text-text">
              {O.kind[fill.kind]} · {formatPriceBps(fill.priceBps)} × {formatQty(fill.qty)}
            </span>
            <span className="figures text-text">
              {F.fee} {formatMoney(fill.fee)}
            </span>
          </div>
          <div className="figures mt-1 text-muted">{formatTimeSeconds(fill.at)}</div>
        </>
      )}
    />
  );
}
