/**
 * How long M8 waits for a funded promo to go live before it says that this is taking longer than
 * usual. On the real back end a paid budget becomes a live campaign in about 10 seconds (the webhook,
 * then the engine's transaction); a minute without it means something is stuck (the treasury has
 * too little to fund it, the engine is down, the webhook never came).
 */
export const LIVE_SLOW_AFTER_MS = 60_000;
