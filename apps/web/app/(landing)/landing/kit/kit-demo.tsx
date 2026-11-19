"use client";

import { useState } from "react";

import { PrimaryButton } from "@/components/landing/primary-button";

/** Every shape of the primary button, on the two surfaces it sits on. Hover and focus are real. */
export function KitDemo(): React.JSX.Element {
  const [clicks, setClicks] = useState(0);

  const row = (tone: "on-dark" | "on-light"): React.JSX.Element => (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-16 pb-12">
      <figure className="grid gap-3">
        <PrimaryButton href="/" tone={tone}>
          Try the live demo
        </PrimaryButton>
        <figcaption className="text-sm opacity-70">link to a path of the site</figcaption>
      </figure>
      <figure className="grid gap-3">
        <PrimaryButton href="https://github.com/frytegg/winz" tone={tone}>
          View the code
        </PrimaryButton>
        <figcaption className="text-sm opacity-70">external link, new tab</figcaption>
      </figure>
      <figure className="grid gap-3">
        <PrimaryButton onClick={() => setClicks((n) => n + 1)} tone={tone}>
          Try the live demo
        </PrimaryButton>
        <figcaption className="text-sm opacity-70">action ({clicks} clicks)</figcaption>
      </figure>
      <figure className="grid gap-3">
        <PrimaryButton href={null} tone={tone}>
          View the code
        </PrimaryButton>
        <figcaption className="text-sm opacity-70">inactive: href is null</figcaption>
      </figure>
      <figure className="grid gap-3">
        <PrimaryButton unavailable onClick={() => setClicks((n) => n + 1)} tone={tone}>
          Try the live demo
        </PrimaryButton>
        <figcaption className="text-sm opacity-70">inactive: unavailable (never clicks)</figcaption>
      </figure>
    </div>
  );

  return (
    <main>
      <section className="bg-landing-ink px-6 pt-12 text-white">
        <h1 className="mb-8 text-2xl font-semibold">Primary button, on a dark section</h1>
        {row("on-dark")}
      </section>
      <section className="bg-landing-lime-from px-6 pt-12">
        <h1 className="mb-8 text-2xl font-semibold">Primary button, on a light section</h1>
        {row("on-light")}
      </section>
    </main>
  );
}
