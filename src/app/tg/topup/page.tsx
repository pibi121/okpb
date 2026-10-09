"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";
import { TG_MIN_TOPUP_PEACHES, TG_QUICK_TOPUP_AMOUNTS } from "@/lib/tg-pricing";

const METHODS = [
  { id: "sbp", ru: "🇷🇺 Оплатить по СБП (рублями)", en: "🇷🇺 Pay via SBP (RUB)" },
  { id: "crypto", ru: "₿ Криптой (USDT, BTC, ETH и т.д)", en: "₿ Crypto (USDT, BTC…)" },
  { id: "sp_kz", ru: "🇰🇿 Картой КЗ", en: "🇰🇿 Kazakhstan card" },
  { id: "sp_by", ru: "🇧🇾 Картой Беларуси", en: "🇧🇾 Belarus card" },
  { id: "sp_ua", ru: "🇺🇦 Картой Украины", en: "🇺🇦 Ukraine card" },
] as const;

function priceLine(amount: number): string {
  const rubPerUsdt = 80;
  const usd = Math.round((amount / rubPerUsdt) * 100) / 100;
  return `${amount}₽ (≈ $${usd})`;
}

export default function TgTopupPage() {
  const router = useRouter();
  const { status, error, profile, locale, apiFetch } = useTgMiniApp();
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const peaches = useMemo(() => {
    if (amount && amount > 0) return amount;
    const n = Math.floor(Number(custom) || 0);
    return n > 0 ? n : 0;
  }, [amount, custom]);

  const ru = locale === "ru";

  async function pay(method: string) {
    if (peaches < TG_MIN_TOPUP_PEACHES) {
      setErr(
        ru
          ? `Минимум ${TG_MIN_TOPUP_PEACHES}₽`
          : `Minimum ${TG_MIN_TOPUP_PEACHES}₽`,
      );
      return;
    }
    setBusy(method);
    setErr("");
    try {
      const res = await apiFetch("/api/tg/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peaches, method, locale }),
      });
      const data = (await res.json()) as {
        paymentUrl?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.paymentUrl) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      const url = data.paymentUrl;
      const tg = window.Telegram?.WebApp as
        | { openLink?: (u: string) => void }
        | undefined;
      if (tg?.openLink) {
        tg.openLink(url);
      } else {
        window.open(url, "_blank");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy("");
    }
  }

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;

  return (
    <TgShell locale={locale}>
      <div className="tg-section">
        <div className="tg-settings">
          <h2>{ru ? "Пополнение" : "Top up"}</h2>
          <p style={{ color: "var(--tg-muted)", fontSize: 13, marginTop: 4 }}>
            {ru ? "Баланс" : "Balance"}: {profile?.balancePeaches ?? 0}₽
          </p>
          <p style={{ color: "var(--tg-muted)", fontSize: 12, marginTop: 8 }}>
            {ru
              ? "СБП, крипта или карты КЗ / Беларуси / Украины."
              : "SBP, crypto, or KZ / Belarus / Ukraine cards."}
          </p>

          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {TG_QUICK_TOPUP_AMOUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className="tg-lang"
                style={{
                  opacity: amount === n ? 1 : 0.75,
                  borderColor:
                    amount === n ? "var(--tg-accent, #f5a)" : undefined,
                }}
                onClick={() => {
                  setAmount(n);
                  setCustom("");
                  setErr("");
                }}
              >
                {n}₽
              </button>
            ))}
          </div>

          <label
            style={{
              display: "block",
              marginTop: 12,
              fontSize: 12,
              color: "var(--tg-muted)",
            }}
          >
            {ru ? "Своя сумма" : "Custom amount"}
            <input
              type="number"
              min={TG_MIN_TOPUP_PEACHES}
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setAmount(null);
              }}
              placeholder={String(TG_MIN_TOPUP_PEACHES)}
              style={{
                width: "100%",
                marginTop: 4,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "inherit",
              }}
            />
          </label>

          {peaches >= TG_MIN_TOPUP_PEACHES ? (
            <>
              <p style={{ marginTop: 16, fontWeight: 600 }}>
                {priceLine(peaches)}
              </p>
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!!busy}
                    onClick={() => void pay(m.id)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(255,255,255,0.06)",
                      color: "inherit",
                      fontWeight: 600,
                    }}
                  >
                    {busy === m.id ? "…" : ru ? m.ru : m.en}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p style={{ marginTop: 16, color: "var(--tg-muted)", fontSize: 13 }}>
              {ru
                ? `Выбери сумму от ${TG_MIN_TOPUP_PEACHES}₽`
                : `Pick an amount from ${TG_MIN_TOPUP_PEACHES}₽`}
            </p>
          )}

          {err ? (
            <p className="tg-error" style={{ marginTop: 12 }}>
              {err}
            </p>
          ) : null}

          <button
            type="button"
            style={{ marginTop: 20 }}
            onClick={() => router.back()}
          >
            {ru ? "← Назад" : "← Back"}
          </button>
        </div>
      </div>
    </TgShell>
  );
}
