import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RosterIQ — Front-Office Roster Intelligence",
    template: "%s · RosterIQ",
  },
  description:
    "Salary-cap management, contract intelligence, transaction simulation, and player valuation for professional sports front offices.",
  applicationName: "RosterIQ",
  // Home Screen on iPhone: full screen, dark status bar over the navigation colour.
  appleWebApp: { capable: true, title: "RosterIQ", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#1e1b4b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
