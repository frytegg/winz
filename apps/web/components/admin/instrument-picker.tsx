import type { HedgeInstrument } from "@winz/shared";

import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { bpsToPercentText } from "@/lib/admin/book";
import { copy } from "@/lib/copy";
import { formatWeekdayTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const T = copy.admin.instrument;

/**
 * The instrument the odds and result panels act on: the ones the hedge desk lists (read from
 * `GET /api/hedge-desk`), or any symbol typed by hand. The typed symbol is the single source of
 * truth; a row of the list only fills it in.
 */
export function InstrumentPicker({
  instruments,
  loading,
  failed,
  symbol,
  onChange,
}: {
  instruments: readonly HedgeInstrument[];
  loading: boolean;
  failed: boolean;
  symbol: string;
  onChange: (symbol: string) => void;
}): React.JSX.Element {
  const chosen = symbol.trim();
  return (
    <section aria-labelledby="admin-instrument-title">
      <Card className="p-5 lg:p-6">
        <div className="flex flex-col gap-5">
          <div>
            <h2 id="admin-instrument-title" className="text-promise uppercase">
              {T.title}
            </h2>
            <p className="mt-1 text-body text-muted">{T.lead}</p>
          </div>

          {loading ? (
            <div aria-busy="true" aria-label={T.deskLoading} className="flex flex-col gap-2">
              <Skeleton className="h-14 rounded-card-sm" />
              <Skeleton className="h-14 rounded-card-sm" />
            </div>
          ) : instruments.length > 0 ? (
            <div role="radiogroup" aria-label={T.fromDesk} className="flex flex-col gap-2">
              <p className="text-label uppercase text-text">{T.fromDesk}</p>
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                {instruments.map((instrument) => {
                  const active = instrument.symbol === chosen;
                  return (
                    <button
                      key={instrument.symbol}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onChange(instrument.symbol)}
                      className={cn(
                        "flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-card-sm bg-card-raised px-4 py-2.5 text-left",
                        "transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.99]",
                        active && "ring-1 ring-inset ring-lime",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-body text-text">
                          {instrument.label}
                        </span>
                        <span className="block truncate text-caption text-muted">
                          {instrument.eventTitle} · {formatWeekdayTime(instrument.startsAt)}
                        </span>
                      </span>
                      <span className="figures text-caption text-muted">
                        {T.bidAsk(
                          bpsToPercentText(instrument.bidBps),
                          bpsToPercentText(instrument.askBps),
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-body text-muted">{failed ? T.deskFailed : T.deskEmpty}</p>
          )}

          <Field
            label={T.symbolLabel}
            hint={T.symbolHint}
            value={symbol}
            onChange={(event) => onChange(event.target.value)}
            placeholder={T.symbolPlaceholder}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="[&_input]:font-mono [&_input]:text-body"
          />
        </div>
      </Card>
    </section>
  );
}
