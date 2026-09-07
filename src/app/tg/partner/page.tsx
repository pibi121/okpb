"use client";

import { useCallback, useEffect, useState } from "react";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";

type PartnerData = {
  balancePeaches: number;
  totalEarnedPeaches: number;
  commissionPct: number;
  code: string;
  referrals: number;
  purchases: number;
  purchaseGrossPeaches: number;
  commissionPeaches: number;
  mainUrl: string;
  links: Array<{
    id: string;
    slug: string;
    label: string;
    clicks: number;
    signups: number;
    purchases: number;
    purchaseGrossPeaches: number;
    commissionPeaches: number;
    url: string;
  }>;
  commissions: Array<{
    id: string;
    amountPeaches: number;
    grossPeaches: number;
    kind: string;
    createdAt: string;
  }>;
  withdrawals: Array<{
    id: string;
    amountPeaches: number;
    status: string;
    payoutDetails: string;
    createdAt: string;
  }>;
};

export default function TgPartnerPage() {
  const { status, error, profile, locale, apiFetch } = useTgMiniApp();
  const [data, setData] = useState<PartnerData | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawDetails, setWithdrawDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const ru = locale === "ru";

  const load = useCallback(async () => {
    const res = await apiFetch("/api/tg/partner");
    const json = await res.json();
    if (!res.ok) throw new Error(String(json.error || "error"));
    setData(json as PartnerData);
  }, [apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load().catch((e) => setLoadErr(e instanceof Error ? e.message : "error"));
  }, [status, load]);

  async function createLink() {
    setBusy(true);
    setMsg("");
    try {
      const res = await apiFetch("/api/tg/partner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_link", label: newLabel.trim() || "Ссылка" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error || "error"));
      setNewLabel("");
      await load();
      setMsg(ru ? "Ссылка создана" : "Link created");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setMsg("");
    try {
      const res = await apiFetch("/api/tg/partner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "withdraw",
          amountPeaches: Number(withdrawAmt),
          payoutDetails: withdrawDetails.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error || "error"));
      setWithdrawAmt("");
      setWithdrawDetails("");
      await load();
      setMsg(ru ? "Заявка на вывод отправлена" : "Withdrawal requested");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    setMsg(ru ? "Скопировано" : "Copied");
  }

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;
  if (loadErr) return <p className="tg-error">{loadErr}</p>;
  if (!data) return <p className="tg-loading">…</p>;

  return (
    <TgShell locale={locale}>
      <div className="tg-section">
        <div className="tg-settings">
          <div className="tg-settings-row">
            <span>{ru ? "Общее количество рефералов" : "Total referrals"}</span>
            <strong>{data.referrals}</strong>
          </div>
          <div className="tg-settings-row">
            <span>{ru ? "Покупок" : "Purchases"}</span>
            <strong>{data.purchases}</strong>
          </div>
          <div className="tg-settings-row">
            <span>{ru ? "Сумма покупок" : "Purchase volume"}</span>
            <strong>🍑 {data.purchaseGrossPeaches}</strong>
          </div>
          <div className="tg-settings-row">
            <span>{ru ? "Комиссия начислено" : "Commission earned"}</span>
            <strong>🍑 {data.commissionPeaches}</strong>
          </div>
          <div className="tg-settings-row">
            <span>{ru ? "Ставка комиссии" : "Commission rate"}</span>
            <strong>{data.commissionPct}%</strong>
          </div>
          <div className="tg-settings-row">
            <span>{ru ? "Баланс партнёра" : "Partner balance"}</span>
            <strong>🍑 {data.balancePeaches}</strong>
          </div>
        </div>
      </div>

      <div className="tg-section">
        <h2>{ru ? "Основная ссылка" : "Main link"}</h2>
        <p className="tg-muted tg-section-hint">{data.mainUrl}</p>
        <button type="button" className="tg-primary-btn" onClick={() => copy(data.mainUrl)}>
          {ru ? "Скопировать" : "Copy"}
        </button>
      </div>

      <div className="tg-section">
        <h2>{ru ? "UTM-ссылки" : "Tracking links"}</h2>
        <div className="tg-card-list">
          {data.links.map((l) => (
            <div key={l.id} className="tg-char-card">
              <div>
                <strong>{l.label}</strong>
                <small>
                  👆 {l.clicks} · 👤 {l.signups} · 🛒 {l.purchases} · 🍑{" "}
                  {l.purchaseGrossPeaches} · {ru ? "комиссия" : "fee"} 🍑{" "}
                  {l.commissionPeaches}
                </small>
              </div>
              <button type="button" className="badge" onClick={() => copy(l.url)}>
                Copy
              </button>
            </div>
          ))}
        </div>
        <input
          className="tg-input"
          style={{ width: "100%", marginTop: "0.5rem" }}
          placeholder={ru ? "Название новой ссылки" : "New link label"}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <button
          type="button"
          className="tg-secondary-btn"
          style={{ marginTop: "0.5rem", width: "100%" }}
          disabled={busy}
          onClick={() => void createLink()}
        >
          {ru ? "+ Создать ссылку" : "+ Create link"}
        </button>
      </div>

      <div className="tg-section">
        <h2>{ru ? "Вывод" : "Withdraw"}</h2>
        <p className="tg-muted tg-section-hint">
          {ru ? "Мин. 500 🍑 · USDT TRC20 / реквизиты" : "Min 500 🍑 · USDT TRC20"}
        </p>
        <input
          className="tg-input"
          style={{ width: "100%" }}
          placeholder="🍑"
          value={withdrawAmt}
          onChange={(e) => setWithdrawAmt(e.target.value)}
        />
        <textarea
          className="tg-input"
          style={{ width: "100%", marginTop: "0.5rem", minHeight: "4rem" }}
          placeholder={ru ? "Реквизиты" : "Payout details"}
          value={withdrawDetails}
          onChange={(e) => setWithdrawDetails(e.target.value)}
        />
        <button
          type="button"
          className="tg-primary-btn"
          style={{ marginTop: "0.5rem", width: "100%" }}
          disabled={busy}
          onClick={() => void withdraw()}
        >
          {ru ? "Запросить вывод" : "Request withdrawal"}
        </button>
      </div>

      {data.commissions.length > 0 && (
        <div className="tg-section">
          <h2>{ru ? "Начисления" : "Commissions"}</h2>
          <div className="tg-card-list">
            {data.commissions.slice(0, 15).map((c) => (
              <div key={c.id} className="tg-char-card">
                <div>
                  <strong>+{c.amountPeaches} 🍑</strong>
                  <small>
                    {c.kind} · {new Date(c.createdAt).toLocaleDateString()}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.withdrawals.length > 0 && (
        <div className="tg-section">
          <h2>{ru ? "Заявки на вывод" : "Payout requests"}</h2>
          <p className="tg-muted tg-section-hint">
            {ru
              ? "Заявки уходят в админку. Статус pending — ждёт обработки."
              : "Requests go to admin. Pending = waiting for review."}
          </p>
          <div className="tg-card-list">
            {data.withdrawals.map((w) => (
              <div key={w.id} className="tg-char-card">
                <div>
                  <strong>🍑 {w.amountPeaches}</strong>
                  <small>
                    {w.status} · {new Date(w.createdAt).toLocaleDateString()}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {msg ? <p className="tg-muted" style={{ padding: "0 1rem" }}>{msg}</p> : null}
    </TgShell>
  );
}
