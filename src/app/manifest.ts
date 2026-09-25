import type { MetadataRoute } from "next";

/** Installable app ("Add to Home Screen"): opens full screen with the RosterIQ icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RosterIQ",
    short_name: "RosterIQ",
    description: "Hockey operations: cap, scouting, prospects, standings and live scores.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#1e1b4b",
    theme_color: "#1e1b4b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
