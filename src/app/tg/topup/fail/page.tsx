"use client";

import { useRouter } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";

export default function TgTopupFailPage() {
  const router = useRouter();
  const { locale } = useTgMiniApp();
  const ru = locale === "ru";

  return (
    <TgShell locale={locale}>
      <div className="tg-section">
        <div className="tg-settings">
          <h2>{ru ? "Оплата не прошла" : "Payment failed"}</h2>
          <p style={{ color: "var(--tg-muted)", marginTop: 8 }}>
            {ru
              ? "Можно выбрать другой способ или попробовать снова."
              : "Try another method or pay again."}
          </p>
          <button
            type="button"
            style={{ marginTop: 16 }}
            onClick={() => router.push("/tg/topup")}
          >
            {ru ? "К пополнению" : "Back to top-up"}
          </button>
        </div>
      </div>
    </TgShell>
  );
}
