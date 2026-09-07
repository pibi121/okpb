"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  kind: string;
  title: string | null;
  resultUrl: string;
  status: string;
  error: string | null;
  createdAt: string;
  runId: string | null;
  user: { id: string; name: string | null; email: string };
};

export default function OpsJobsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (kind) q.set("kind", kind);
    const d = await opsFetch<{ rows: Row[] }>(`/api/ops/jobs?${q}`);
    setRows(d.rows);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, [status, kind]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl">Работы</h1>
      <div className="flex gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm">
          <option value="">Любой статус</option>
          <option value="pending">В очереди</option>
          <option value="ready">Готово</option>
          <option value="error">Ошибка</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm">
          <option value="">Фото и видео</option>
          <option value="photo">Фото</option>
          <option value="video">Видео</option>
        </select>
      </div>
      {msg ? <p className="text-sm text-coral">{msg}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.id} className="overflow-hidden rounded-2xl border border-white/10">
            {r.kind === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.resultUrl} alt="" className="h-40 w-full object-cover" />
            ) : (
              <video src={r.resultUrl} className="h-40 w-full object-cover" muted controls />
            )}
            <div className="p-3 text-sm">
              <div>
                {r.kind} · {r.status}
              </div>
              <Link href={`/ops/users/${r.user.id}`} className="text-xs text-peach">
                {r.user.name || r.user.email}
              </Link>
              <div className="text-[11px] text-zinc-500">{fmtTime(r.createdAt)}</div>
              {r.error ? <div className="mt-1 text-xs text-coral">{r.error}</div> : null}
              {r.runId && r.status === "error" ? (
                <button
                  className="mt-2 text-xs text-peach"
                  onClick={() =>
                    opsFetch("/api/ops/jobs", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "retry",
                        runId: r.runId,
                        userId: r.user.id,
                      }),
                    }).then(() => load())
                  }
                >
                  Повторить видео
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
