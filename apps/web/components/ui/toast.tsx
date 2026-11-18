"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

const VISIBLE_MS = 3000;
const LEAVE_MS = 180;

interface ToastItem {
  id: number;
  message: string;
  tone: "default" | "error";
  leaving: boolean;
}

interface ToastApi {
  show: (message: string, tone?: "default" | "error") => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** `useToast().show("Link copied")`. A toast waits 3 seconds and leaves faster than it came. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const show = useCallback((message: string, tone: "default" | "error" = "default") => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-2), { id, message, tone, leaving: false }]);
    const leave = setTimeout(() => {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, leaving: true } : item)),
      );
      const remove = setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, LEAVE_MS);
      timers.current.add(remove);
    }, VISIBLE_MS);
    timers.current.add(leave);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--safe-bottom)+1rem)] z-[60] flex flex-col items-center gap-2 px-5"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "toast pointer-events-auto max-w-sm rounded-full px-5 py-3 text-body",
              item.tone === "error" ? "bg-danger text-ink" : "bg-white-pill text-ink",
              item.leaving && "translate-y-3 opacity-0",
            )}
            style={{ transitionDuration: item.leaving ? `${LEAVE_MS.toString()}ms` : undefined }}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
