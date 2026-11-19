"use client";

import { LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Logo } from "@/components/ui/logo";
import { checkAdminKey } from "@/lib/admin/api";
import { adminKeyIsMemoryOnly, saveAdminKey } from "@/lib/admin/key";
import { isMockApi } from "@/lib/api/mock-scenario";
import { copy } from "@/lib/copy";
import { useHydrated } from "@/lib/hooks";

const T = copy.admin;

/** A key typed on a page that is neither HTTPS nor this machine would cross the network in clear. */
function isInsecureOrigin(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (protocol === "https:") return false;
  return !["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

/**
 * The key screen. The key is checked with the server before it is kept: a wrong one never reaches
 * `sessionStorage`, and the person is told so here rather than at the first action. The field is a
 * password field that no password manager is asked to remember.
 */
export function KeyGate({
  sessionEnded,
  onUnlocked,
}: {
  /** The server refused a key that had been accepted earlier. */
  sessionEnded: boolean;
  onUnlocked: () => void;
}): React.JSX.Element {
  const hydrated = useHydrated();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [shake, setShake] = useState(0);
  const [checking, setChecking] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page cancels a check in flight; React strict mode mounts twice, so it is made here.
  useEffect(() => {
    return () => controller.current?.abort();
  }, []);

  async function submit(): Promise<void> {
    if (checking) return;
    const key = value.trim();
    if (key === "") {
      setError(T.gate.empty);
      setShake((count) => count + 1);
      return;
    }
    setError(undefined);
    setChecking(true);
    controller.current = new AbortController();
    try {
      const result = await checkAdminKey(key, controller.current.signal);
      if (result.outcome === "rejected") {
        setError(T.gate.rejected);
        setShake((count) => count + 1);
        return;
      }
      if (result.outcome === "unknown") {
        setError(result.message);
        return;
      }
      if (saveAdminKey(key)) {
        setValue("");
        onUnlocked();
      }
    } catch {
      // The check was cancelled by leaving the page: nothing to say.
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-6 px-5 py-10 pt-[calc(var(--safe-top)+2.5rem)]">
      <Logo />
      <Card tone="raised" className="p-6">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <h1 className="flex items-center gap-3 text-step uppercase">
              <LockKeyhole
                className="size-7 shrink-0 text-lime"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              {T.title}
            </h1>
            <p className="text-body text-muted">{T.gate.lead}</p>
          </div>

          {sessionEnded ? (
            <p role="alert" className="rounded-card-sm bg-card p-4 text-body text-text">
              {T.gate.sessionEnded}
            </p>
          ) : null}

          <Field
            label={T.keyLabel}
            hint={T.gate.keyHint}
            type="password"
            name="winz-demo-panel-key"
            // `off` is honoured by few browsers for a password field; `new-password` is the one
            // that stops them offering a saved credential or asking to save this one.
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error !== undefined) setError(undefined);
            }}
            error={error}
            shakeKey={shake}
            disabled={checking}
            autoFocus
          />

          {isMockApi() ? <p className="text-caption text-muted">{T.gate.mockNote}</p> : null}
          {hydrated && adminKeyIsMemoryOnly() ? (
            <p className="text-caption text-muted">{T.gate.memoryOnly}</p>
          ) : null}
          {hydrated && isInsecureOrigin() ? (
            <p role="alert" className="text-caption text-danger">
              {T.gate.insecure}
            </p>
          ) : null}

          <Button type="submit" loading={checking}>
            {checking ? T.gate.checking : T.gate.unlock}
          </Button>
        </form>
      </Card>
    </main>
  );
}
