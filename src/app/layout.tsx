import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ghostreviews.app"),
  title: "ghost.reviews — See the ghosts in your reviews",
  description:
    "Detect coordinated review-bombing attacks on your Google Business Profile. Get a transparent fraud-signal report and a drafted policy-violation removal request you submit to Google.",
  applicationName: "ghost.reviews",
  authors: [{ name: "asphyxeth-tech" }],
  keywords: [
    "review fraud detection",
    "fake review detection",
    "review bombing",
    "Google reviews",
    "FTC Consumer Review Rule",
    "reputation management",
  ],
  openGraph: {
    title: "ghost.reviews — See the ghosts in your reviews",
    description:
      "Detect coordinated review-bombing attacks on your Google Business Profile.",
    type: "website",
    siteName: "ghost.reviews",
  },
  twitter: {
    card: "summary_large_image",
    title: "ghost.reviews",
    description:
      "Detect coordinated review-bombing attacks on your Google Business Profile.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
