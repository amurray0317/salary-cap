import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RosterIQ — Front-Office Roster Intelligence",
    template: "%s · RosterIQ",
  },
  description:
    "Salary-cap management, contract intelligence, transaction simulation, and player valuation for professional sports front offices.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
