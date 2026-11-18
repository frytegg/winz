"use client";

import { useSyncExternalStore } from "react";

import {
  allScenarioNames,
  getMockScenario,
  isMockApi,
  setMockScenario,
} from "@/lib/api/mock-scenario";
import { copy } from "@/lib/copy";

const noop = (): (() => void) => () => undefined;

/**
 * A floating picker for the mock API's scenarios, in development only
 * (`NEXT_PUBLIC_APP_API_MOCK=true`). It reloads the page so every request carries the new
 * `x-mock-scenario`. A route with no scenario of that name answers with its default.
 */
export function MockScenarioPicker(): React.JSX.Element | null {
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  if (!isMockApi() || !mounted) return null;
  const current = getMockScenario() ?? "";
  return (
    <label className="fixed bottom-[calc(7.5rem+var(--safe-bottom))] left-2 z-[70] flex items-center gap-1.5 rounded-full bg-card-raised/95 py-1 pl-3 pr-1 text-caption text-muted">
      {copy.demo.scenarioPicker}
      <select
        value={current}
        onChange={(event) => {
          setMockScenario(event.target.value === "" ? null : event.target.value);
          window.location.reload();
        }}
        className="h-8 max-w-36 rounded-full bg-ink px-2 text-base text-text"
      >
        <option value="">default</option>
        {allScenarioNames().map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
