import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The font-size and radius tokens of `app/globals.css` (`--text-*`, `--radius-*`).
 *
 * tailwind-merge only knows Tailwind's own scale. Without this list it reads `text-lead` or
 * `text-body` as a text COLOR, finds it in conflict with `text-ink`, and silently drops one of them:
 * that is how a pill ended up with white text on lime. `utils.test.ts` checks this list against
 * the CSS, so a new token cannot be added to one and forgotten in the other.
 */
export const FONT_SIZE_TOKENS = [
  "hero",
  "step",
  "promise",
  "promise-lg",
  "figure",
  "figure-sm",
  "countdown",
  "countdown-lg",
  "countdown-sm",
  "lead",
  "title",
  "clock",
  "chance",
  "body",
  "label",
  "caption",
  "micro",
] as const;

export const RADIUS_TOKENS = ["screen", "card", "card-sm"] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZE_TOKENS] }],
      rounded: [{ rounded: [...RADIUS_TOKENS] }],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts (the shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
