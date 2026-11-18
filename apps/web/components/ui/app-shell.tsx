"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Screens built for a laptop (the jury's) use the full width; the rest is a 430px column. */
const FULL_WIDTH_PREFIXES = ["/hedge-desk", "/admin"];

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const fullWidth = FULL_WIDTH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (fullWidth) {
    return <div className="min-h-dvh bg-ink">{children}</div>;
  }
  return <div className="app-column">{children}</div>;
}
