import type { ComponentType, SVGProps } from "react";

/** What a stat tile accepts as an icon: a lucide icon, or one of the two drawn below. */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * The two icons of the merchant stat tiles, redrawn from the mockups (MD-campaign-detail-stats-chart,
 * MH-merchant-home). Lucide has no equivalent: its `Receipt` is a ticket with text lines and its
 * `Banknote` has two side marks instead of four corner dots. They follow lucide's conventions
 * (16px box, `currentColor`, round caps and joins) so they sit next to the other icons.
 */

/** A bill with a torn bottom edge and a screen: "Covered order", "Coverage". */
export function ReceiptIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M2 12.6V3.6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v9" />
      <path d="M2 12.6c.7-1 1.3-1 2 0s1.3 1 2 0 1.3-1 2 0 1.3 1 2 0 1.3-1 2 0 1.3 1 2 0" />
      <rect
        x="5"
        y="5.2"
        width="6"
        height="3.4"
        rx=".5"
        fill="currentColor"
        fillOpacity=".55"
        stroke="none"
      />
    </svg>
  );
}

/** A banknote with a medallion and four corner dots: "Gross sales", "Coverage cost". */
export function CashIcon(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="1" y="3.5" width="14" height="9" rx="1" />
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 7.1 8.9 8 8 8.9 7.1 8Z" fill="currentColor" stroke="none" />
      <g fill="currentColor" stroke="none">
        <circle cx="3.4" cy="5.6" r=".55" />
        <circle cx="12.6" cy="5.6" r=".55" />
        <circle cx="3.4" cy="10.4" r=".55" />
        <circle cx="12.6" cy="10.4" r=".55" />
      </g>
    </svg>
  );
}

/**
 * The apple of the "Buy with Apple Pay" pill, solid, in the color of the label. Used only in the
 * simulated checkout: with the live version Stripe draws the real Apple Pay button.
 */
export function AppleMark(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}
