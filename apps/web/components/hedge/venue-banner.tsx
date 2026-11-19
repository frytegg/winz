import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/lib/copy";

const T = copy.hedgeDesk.venue;

/**
 * Where the orders go, in clear (SPEC MDB-3): `venueLabel` as the API sends it ("PAPER · live Gemini
 * book"), on the one big lime surface of the screen, with `venueNote` (what the venue cannot do)
 * under it, in dark text (MASTER: never white on lime).
 *
 * Before the first answer there is nothing true to write, so the band holds the place with
 * skeletons. The label is never typed by hand here: a desk running on the live exchange must not
 * say "PAPER" because a request is slow.
 */
export function VenueBanner({
  label,
  note,
  unavailable = false,
}: {
  label: string | null;
  note: string | null;
  /** The desk could not be read and nothing was ever shown: say so, instead of waiting for ever. */
  unavailable?: boolean;
}): React.JSX.Element {
  return (
    <section aria-label={T.title}>
      <Card className="bg-lime p-5 text-ink lg:px-8 lg:py-7">
        <p className="text-caption font-semibold uppercase tracking-[0.12em] text-ink/70">
          {T.title}
        </p>
        {label === null && unavailable ? (
          <p className="mt-1 text-lead text-ink">{T.unavailable}</p>
        ) : label === null ? (
          <div aria-busy="true" className="mt-3 flex flex-col gap-3">
            <Skeleton className="h-9 w-72 max-w-full bg-ink/15" />
            <Skeleton className="h-4 w-full max-w-xl bg-ink/15" />
          </div>
        ) : (
          <>
            <h2 className="mt-1 text-balance text-promise font-medium sm:text-promise-lg">
              {label}
            </h2>
            {note === null ? null : <p className="mt-2 max-w-3xl text-body text-ink/80">{note}</p>}
          </>
        )}
      </Card>
    </section>
  );
}
