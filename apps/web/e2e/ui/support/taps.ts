import type { Locator } from "@playwright/test";

/**
 * Counts what a person does with their thumb (SPEC section 17, criterion 1): every tap, every key
 * pressed on its own, and every field typed into (one field typed counts as one, whatever its
 * length). Scrolling and waiting cost nothing. Every gesture of a counted flow goes through here, so
 * the count cannot forget one.
 */
export class TapCounter {
  private readonly steps: string[] = [];

  get count(): number {
    return this.steps.length;
  }

  /** The gestures in order, for the failure message and the receipts. */
  get log(): string {
    return this.steps.map((step, index) => `${(index + 1).toString()}. ${step}`).join(" · ");
  }

  async tap(target: Locator, what: string): Promise<void> {
    await target.tap();
    this.steps.push(`tap ${what}`);
  }

  /** Typing a whole field (or pasting, or the keyboard's one-time-code suggestion) is one gesture. */
  async type(target: Locator, text: string, what: string): Promise<void> {
    await target.fill(text);
    this.steps.push(`type ${what}`);
  }

  async press(target: Locator, key: string, what: string): Promise<void> {
    await target.press(key);
    this.steps.push(`key ${key} (${what})`);
  }
}
