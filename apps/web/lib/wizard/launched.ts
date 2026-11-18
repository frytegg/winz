import { eventSummarySchema } from "@winz/shared";
import { z } from "zod";

/**
 * The game and the venue of the promo that was just created, kept for the "Your promo is live!"
 * screen: the campaign carries only `eventTitle`, no teams or sport (DEMANDES-ALEXANDRE, item 1), so
 * the screen draws the teams from what the merchant picked. After a reload of M8 on another
 * device there is no memory of it, and the screen falls back to the title alone.
 */
const KEY = "winz.launched";

const launchedSchema = z.object({
  campaignId: z.string(),
  event: eventSummarySchema,
  merchantName: z.string(),
});

export type Launched = z.infer<typeof launchedSchema>;

export function saveLaunched(launched: Launched): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(launched));
  } catch {
    // Storage can be blocked: M8 then falls back to the campaign title.
  }
}

export function readLaunched(campaignId: string): Launched | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = launchedSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.campaignId === campaignId ? parsed.data : null;
  } catch {
    return null;
  }
}
