import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

/** One panel of the demo panel: a title, one sentence on what it does, then its controls. */
export function PanelCard({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section aria-labelledby={`${id}-title`}>
      <Card className="p-5 lg:p-6">
        <div className="flex flex-col gap-5">
          <div>
            <h2 id={`${id}-title`} className="text-promise uppercase">
              {title}
            </h2>
            <p className="mt-1 max-w-[46ch] text-body text-muted">{lead}</p>
          </div>
          {children}
        </div>
      </Card>
    </section>
  );
}
