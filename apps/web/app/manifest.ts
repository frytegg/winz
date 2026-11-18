import type { MetadataRoute } from "next";

import { copy } from "@/lib/copy";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: copy.brand.productName,
    short_name: copy.brand.productName,
    description: copy.brand.description,
    lang: "en-US",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // The splash is ink; the status bar is the deeper black of the app background.
    background_color: "#131314",
    theme_color: "#0B0B0C",
    categories: ["sports", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
