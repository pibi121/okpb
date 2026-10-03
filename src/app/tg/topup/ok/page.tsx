"use client";

import { useRouter } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";

export default function TgTopupOkPage() {
  const router = useRouter();
  const { locale, refresh } = useTgMiniApp();
  const ru = locale === "ru";

  return (
    <TgShell locale={locale}>
      <div className="tg-section">
        <div className="tg-settings">
          <h2>{ru ? "Оплата принята" : "Payment received"}</h2>
          <p style={{ color: "var(--tg-muted)", marginTop: 8 }}>
            {ru
              ? "Если баланс ещё не обновился — подожди несколько секунд и обнови. Зачисление идёт после подтверждения от платёжной системы."
              : "If the balance hasn't updated yet, wait a few seconds and refresh. Credits arrive after the payment provider confirms."}
          </p>
          <button
            type="button"
            style={{ marginTop: 16 }}
            onClick={() => {
              void refresh(locale);
              router.push("/tg/profile");
            }}
          >
            {ru ? "К профилю" : "To profile"}
          </button>
        </div>
      </div>
    </TgShell>
  );
}
