import { describe, expect, it } from "vitest";

import { EARLY_INSTALL_PROMPT_SCRIPT } from "./install-early";

/** Runs the script against a window that only knows how to register a listener, and hands back both. */
function run(): { win: Record<string, unknown>; fire: (event: object) => void } {
  const listeners = new Map<string, (event: object) => void>();
  const win: Record<string, unknown> = {
    addEventListener: (name: string, handler: (event: object) => void) => {
      listeners.set(name, handler);
    },
  };
  new Function("window", EARLY_INSTALL_PROMPT_SCRIPT)(win);
  return {
    win,
    fire: (event) => {
      listeners.get("beforeinstallprompt")?.(event);
    },
  };
}

describe("EARLY_INSTALL_PROMPT_SCRIPT", () => {
  it("listens for beforeinstallprompt and nothing else", () => {
    const listeners: string[] = [];
    const win = { addEventListener: (name: string) => void listeners.push(name) };
    new Function("window", EARLY_INSTALL_PROMPT_SCRIPT)(win);
    expect(listeners).toEqual(["beforeinstallprompt"]);
  });

  it("keeps the event for the sheet, and stops the browser's own install bar", () => {
    const { win, fire } = run();
    let prevented = false;
    const event = { preventDefault: () => (prevented = true) };
    fire(event);
    expect(prevented).toBe(true);
    expect(win["__winzInstallPrompt"]).toBe(event);
  });

  it("keeps the latest event when the browser fires another one", () => {
    const { win, fire } = run();
    const first = { preventDefault: () => undefined };
    const second = { preventDefault: () => undefined };
    fire(first);
    fire(second);
    expect(win["__winzInstallPrompt"]).toBe(second);
  });

  it("uses nothing an old browser lacks", () => {
    expect(EARLY_INSTALL_PROMPT_SCRIPT).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });
});
