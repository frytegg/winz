"use client";

import { useEffect } from "react";

import { pinDemoMode } from "@/lib/demo/store";

/**
 * Keeps the DEMO MODE band on every admin page, from the key screen to the panel (SCREENS: "bandeau
 * DEMO MODE permanent"). The band itself is the global `<DemoBanner />` of the root layout; this
 * only holds it up while an admin page is mounted.
 */
export function DemoModePin(): null {
  useEffect(() => pinDemoMode(), []);
  return null;
}
