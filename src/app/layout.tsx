import type { Metadata } from "next";
import { Geist_Mono, Onest } from "next/font/google";
import { AppHeader } from "@/components/app-header";
import { AppChrome } from "@/components/app-chrome";
import "./globals.css";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "peachbitch",
  description: "Peach lab — still / video / presets",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${onest.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
        />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <AppChrome header={<AppHeader />}>{children}</AppChrome>
      </body>
    </html>
  );
}
