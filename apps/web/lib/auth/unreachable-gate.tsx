"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { copy } from "@/lib/copy";

import { useAuth } from "./auth-context";
import { isSignInFreePath } from "./provider-choice";

/**
 * « Can't reach Winz », with a retry, in place of the screen while the API could not say who is
 * signed in (`status === "unreachable"`, review 2.2). The session is kept: the retry asks
 * `GET /api/me` again, and the screen comes back as soon as it answers. Not on M0 nor on the pages
 * that need no sign-in, which never ask who this is.
 */
export function UnreachableGate({ children }: { children: ReactNode }): React.JSX.Element {
  const { status, reconnect } = useAuth();
  const pathname = usePathname();
  if (status !== "unreachable" || pathname === "/" || isSignInFreePath(pathname)) {
    return <>{children}</>;
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col justify-center px-6">
      <Card className="p-6" role="alert">
        <div className="flex flex-col items-start gap-4">
          <h1 className="text-title">{copy.signIn.unreachableTitle}</h1>
          <p className="text-body text-muted">{copy.signIn.unreachableBody}</p>
          <Button variant="dark" size="md" arrow={false} onClick={reconnect}>
            {copy.common.tryAgain}
          </Button>
        </div>
      </Card>
    </main>
  );
}
