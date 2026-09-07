import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./miniapp.css";

export const metadata: Metadata = {
  title: "PeachBitch Studio",
  description: "Лента шаблонов и персонажи PeachBitch",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#070708",
};

export default function TgRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <div className="tg-app">{children}</div>
    </>
  );
}
