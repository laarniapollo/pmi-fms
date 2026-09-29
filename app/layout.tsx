import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";

import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

/**
 * Two faces, split by job rather than by decoration: Inter carries the
 * interface and every quantity, IBM Plex Mono carries identifiers — invoice
 * numbers, payment references, tax IDs. Anything a person would read aloud
 * character by character is mono; anything with magnitude is not.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PoultryMax FMS",
    template: "%s · PoultryMax FMS",
  },
  description:
    "PoultryMax financial management: capture invoices, route them for approval, and pay suppliers on a full audit trail.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F4F5F7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-canvas antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
