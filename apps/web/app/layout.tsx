import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import type { ReactNode } from "react";

import { MockScenarioPicker } from "@/components/dev/mock-scenario-picker";
import { AppShell } from "@/components/ui/app-shell";
import { DemoBanner } from "@/components/ui/demo-banner";
import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/lib/auth";
import { copy } from "@/lib/copy";

import "./globals.css";

/** The interface font. If Figma uses another one, change it here and nowhere else. */
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: copy.brand.productName, template: `%s · ${copy.brand.productName}` },
  description: copy.brand.description,
  applicationName: copy.brand.productName,
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: copy.brand.productName,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0C",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Paint under the notch and the home indicator; screens pad themselves with env(safe-area-inset-*).
  viewportFit: "cover",
  // The keyboard shrinks the layout, so bottom-pinned buttons stay above it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={sora.variable}>
      <body>
        <DemoBanner />
        <AuthProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </AuthProvider>
        <MockScenarioPicker />
      </body>
    </html>
  );
}
