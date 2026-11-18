import { errorMessage } from "@/lib/api/client";
import { copy } from "@/lib/copy";

import { Button } from "../ui/button";
import { Card } from "../ui/card";

/** What a merchant screen shows when its data did not load: the API's own message, and a retry. */
export function LoadError({
  error,
  onRetry,
  title = copy.merchantSpace.loadFailedTitle,
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
}): React.JSX.Element {
  return (
    <Card className="p-6" role="alert">
      <div className="flex flex-col items-start gap-4">
        <h2 className="text-title">{title}</h2>
        <p className="text-body text-muted">{errorMessage(error, copy.common.genericError)}</p>
        <Button variant="dark" size="md" arrow={false} onClick={onRetry}>
          {copy.merchantSpace.retry}
        </Button>
      </div>
    </Card>
  );
}
