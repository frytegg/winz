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
