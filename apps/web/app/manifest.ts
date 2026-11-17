import type { MetadataRoute } from "next";

import { copy } from "@/lib/copy";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: copy.brand.name,
    short_name: copy.brand.name,
    description: copy.brand.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#0B0B0C",
    theme_color: "#0B0B0C",
    icons: [],
  };
}
