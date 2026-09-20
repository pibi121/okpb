"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  status: string;
  kind: string;
  chargedPeaches: number;
  refundedPeaches: number;
  createdAt: string;
  reviewedAt: string | null;
  userClaimsTotal: number;
  user: {
    id: string;
    name: string | null;
    email: string;
    balancePeaches: number;
    tgUsername: string | null;
    tgId: string | null;
  };
  item: {
    id: string;
    kind: string;
    title: string | null;
    resultUrl: string;
    thumbUrl: string | null;
    createdAt: string;
  };
};

export default function OpsQualityPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("pending");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    const d = await opsFetch<{ rows: Row[] }>(`/api/ops/quality?${q}`);
    setRows(d.rows);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, [status]);

  async function act(claimId: string, action: "approve" | "reject") {
    setBusy(claimId + action);
    setMsg("");
    try {
      await opsFetch("/api/ops/quality", {
        method: "POST",
        body: JSON.stringify({ claimId, action }),
      });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl">Контроль качества</h1>
      <div className="flex gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        >
          <option value="pending">Ожидают</option>
          <option value="approved">Одобрены</option>
          <option value="rejected">Отклонены</option>
          <option value="">Все</option>
        </select>
      </div>
      {msg ? <p className="text-sm text-coral">{msg}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((r) => {
          const open = openId === r.id;
          return (
            <div
              key={r.id}
              className="overflow-hidden rounded-2xl border border-white/10 bg-[#121214]"
            >
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => setOpenId(open ? null : r.id)}
              >
                {r.kind === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.item.resultUrl}
                    alt=""
                    className={
                      open
                        ? "max-h-[70vh] w-full object-contain bg-black"
                        : "h-48 w-full object-cover"
                    }
                  />
                ) : (
                  <video
                    src={r.item.resultUrl}
                    className={
                      open
                        ? "max-h-[70vh] w-full bg-black"
                        : "h-48 w-full object-cover"
                    }
                    controls
                    playsInline
                  />
                )}
              </button>
              <div className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-white/5 px-2 py-0.5 text-xs">
                    {r.kind === "video" ? "видео" : "фото"}
                  </span>
                  <span className="rounded-lg bg-white/5 px-2 py-0.5 text-xs">
                    {r.status === "pending"
                      ? "не рассмотрено"
                      : r.status === "approved"
                        ? "одобрено"
                        : "отклонено"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {r.chargedPeaches} 🍑
                    {r.refundedPeaches
                      ? ` · возврат ${r.refundedPeaches}`
                      : ""}
                  </span>
                </div>
                <div>
                  <Link
                    href={`/ops/users/${r.user.id}`}
                    className="text-peach"
                  >
                    {r.user.name || r.user.email}
                  </Link>
                  {r.user.tgUsername ? (
                    <span className="text-xs text-zinc-500">
                      {" "}
                      @{r.user.tgUsername}
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-zinc-500">
                  Заявок у юзера: {r.userClaimsTotal} · баланс{" "}
                  {r.user.balancePeaches} 🍑 · {fmtTime(r.createdAt)}
                </div>
                {r.item.title ? (
                  <div className="text-xs text-zinc-400">{r.item.title}</div>
                ) : null}
                <div className="flex flex-wrap gap-3 pt-1">
                  <a
                    href={r.item.resultUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-peach"
                  >
                    Открыть файл
                  </a>
                  {r.status === "pending" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy === r.id + "approve"}
                        className="text-xs text-emerald-400 disabled:opacity-40"
                        onClick={() => act(r.id, "approve")}
                      >
                        Принять
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.id + "reject"}
                        className="text-xs text-coral disabled:opacity-40"
                        onClick={() => act(r.id, "reject")}
                      >
                        Отклонить
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!rows.length ? (
        <p className="text-sm text-zinc-500">Пока пусто.</p>
      ) : null}
    </div>
  );
}
