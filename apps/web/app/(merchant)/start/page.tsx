import type { Metadata } from "next";
import { Suspense } from "react";

import { Splash } from "@/components/ui/splash";

import { SignInFlow } from "./sign-in-flow";

export const metadata: Metadata = { title: "Sign in" };

/** M1. `useSearchParams` needs a Suspense boundary in a statically rendered page. */
export default function StartPage(): React.JSX.Element {
  return (
    <Suspense fallback={<Splash />}>
      <SignInFlow />
    </Suspense>
  );
}
