"use client";

import { Share, SquarePlus, Smartphone } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { copy } from "@/lib/copy";
import { useInstallPrompt } from "@/lib/fan/install-prompt";

/**
 * "Add Winz to Home Screen" (C3). On Android the browser's install dialog opens; on iPhone there is
 * no such dialog, so a sheet shows the two gestures. It renders nothing where installing is not
 * possible or the app is already installed.
 */
export function AddToHome(): React.JSX.Element | null {
  const { state, prompt } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  if (state === "hidden") return null;

  return (
    <>
      <Button
        variant="dark"
        arrow={false}
        leading={<Smartphone className="size-5" strokeWidth={1.5} aria-hidden="true" />}
        onClick={() => (state === "prompt" ? void prompt() : setOpen(true))}
      >
        {copy.ticket.addToHome}
      </Button>
      {state === "ios" ? (
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title={copy.ticket.addToHomeIos}
          description={copy.ticket.addToHomeIosBody}
        >
          <ol className="flex flex-col gap-3">
            {copy.ticket.addToHomeIosSteps.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-4 rounded-card-sm bg-card-raised p-4 text-body"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-lime">
                  {index === 0 ? (
                    <Share className="size-5" strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <SquarePlus className="size-5" strokeWidth={1.5} aria-hidden="true" />
                  )}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5">
            <Button variant="dark" onClick={() => setOpen(false)}>
              {copy.ticket.addToHomeDone}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
