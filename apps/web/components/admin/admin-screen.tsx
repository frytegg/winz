"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { clearAdminKey, readAdminKey, subscribeAdminKey } from "@/lib/admin/key";
import { useHydrated } from "@/lib/hooks";

import { AdminPanel } from "./admin-panel";
import { KeyGate } from "./key-gate";

/**
 * `/admin`: the key screen until a key is held, then the panel. Only the fact that a key exists is
 * read here (a boolean), so the key itself never sits in a component's props or state. When the
 * key disappears without the person pressing Lock, the server has refused it: the key screen says
 * so instead of leaving a panel whose next action would fail.
 */
export function AdminScreen(): React.JSX.Element {
  const hydrated = useHydrated();
  const unlocked = useSyncExternalStore(
    subscribeAdminKey,
    () => readAdminKey() !== null,
    () => false,
  );
  const [sessionEnded, setSessionEnded] = useState(false);
  const hadKey = useRef(false);
  const locking = useRef(false);

  useEffect(() => {
    if (unlocked) {
      hadKey.current = true;
      setSessionEnded(false);
      return;
    }
    if (hadKey.current && !locking.current) setSessionEnded(true);
    hadKey.current = false;
    locking.current = false;
  }, [unlocked]);

  if (!hydrated) {
    return (
      <main
        aria-busy="true"
        className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center gap-4 px-5"
      >
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-72 rounded-card" />
      </main>
    );
  }

  if (!unlocked) {
    return <KeyGate sessionEnded={sessionEnded} onUnlocked={() => setSessionEnded(false)} />;
  }
  return (
    <AdminPanel
      onLock={() => {
        locking.current = true;
        clearAdminKey();
      }}
    />
  );
}
