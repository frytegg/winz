/**
 * Which express payment C1's main button names (review section 3: it said « Buy with Apple Pay »
 * everywhere, Android included). A guess from the browser, before Stripe's own button is mounted in
 * the sheet: that button shows what is really available, and the card form takes over where nothing
 * is. Apple Pay on Apple's devices (iPhone, iPad, and Safari on a Mac), Google Pay on Android and in
 * the browsers that carry it (Chrome, Edge), neither elsewhere.
 */
export type ExpressPay = "apple" | "google" | null;

export function expressPayOf(userAgent: string, platform = "", maxTouchPoints = 0): ExpressPay {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "apple";
  // An iPad that presents itself as a Mac (desktop-class Safari).
  if (platform === "MacIntel" && maxTouchPoints > 1) return "apple";
  if (/Android/.test(userAgent)) return "google";
  if (/Chrome\/|Chromium\/|Edg\//.test(userAgent)) return "google";
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent)) return "apple";
  return null;
}
