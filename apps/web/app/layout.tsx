import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { copy } from "@/lib/copy";

import "./globals.css";

export const metadata: Metadata = {
  title: copy.brand.name,
  description: copy.brand.tagline,
};

export const viewport: Viewport = {
  themeColor: "#0B0B0C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
