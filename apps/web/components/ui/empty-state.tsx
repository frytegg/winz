import type { ReactNode } from "react";

import { Card } from "./card";

/**
 * An empty list that still looks designed (MASTER section 8: no blank screens): the field lines
 * behind a short message, and an optional action.
 */
export function EmptyState({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <Card tone="raised" diagonals className="px-6 py-10 text-center">
      <p className="mx-auto max-w-[18rem] text-lead">{title}</p>
      {action === undefined ? null : <div className="mt-6 flex justify-center">{action}</div>}
    </Card>
  );
}
