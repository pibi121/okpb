"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  kind: string;
  title: string | null;
  resultUrl: string;
  thumbUrl: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  runId: string | null;
  user: { id: string; name: string | null; email: string };
};

/** Inline video like prod, but src only while in (or near) viewport. */
function LazyOpsVideo({ src }: { src: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hot, setHot] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setHot(e.isIntersecting);
      },
      { threshold: 0.15, rootMargin: "80px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="flex h-52 w-full items-center justify-center bg-[#0a0a0b]">
      {hot ? (
        <video
          key={src}
          src={src}
          className="h-52 w-full object-contain"
          muted
          controls
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="text-xs text-zinc-600">видео…</div>
      )}
    </div>
  );
}

export default function OpsJobsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [msg, setMsg] = useState("");
  const [viewer, setViewer] = useState<Row | null>(null);

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

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl">Работы</h1>
      <div className="flex gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        >
          <option value="">Любой статус</option>
          <option value="pending">В очереди</option>
          <option value="ready">Готово</option>
          <option value="error">Ошибка</option>
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        >
          <option value="">Фото и видео</option>
          <option value="photo">Фото</option>
          <option value="video">Видео</option>
        </select>
      </div>
      {msg ? <p className="text-sm text-coral">{msg}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const canOpen = r.status === "ready" && Boolean(r.resultUrl);
          return (
            <div
              key={r.id}
              className="overflow-hidden rounded-2xl border border-white/10"
            >
              {r.kind === "photo" && (r.thumbUrl || r.resultUrl) ? (
                <button
                  type="button"
                  className="block w-full bg-[#0a0a0b]"
                  onClick={() => {
                    if (canOpen) setViewer(r);
                  }}
                  title={canOpen ? "Открыть полностью" : undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.thumbUrl || r.resultUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="mx-auto h-52 w-full object-contain"
                  />
                </button>
              ) : r.kind === "video" && r.resultUrl ? (
                <LazyOpsVideo src={r.resultUrl} />
              ) : (
                <div className="flex h-52 w-full items-center justify-center bg-[#0a0a0b] text-xs text-zinc-600">
                  нет превью
                </div>
              )}
              <div className="p-3 text-sm">
                <div>
                  {r.kind} · {r.status}
                </div>
                <Link
                  href={`/ops/users/${r.user.id}`}
                  className="text-xs text-peach"
                >
                  {r.user.name || r.user.email}
                </Link>
                <div className="text-[11px] text-zinc-500">
                  {fmtTime(r.createdAt)}
                </div>
                {r.error ? (
                  <div className="mt-1 text-xs text-coral">{r.error}</div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-3">
                  {canOpen ? (
                    <button
                      type="button"
                      className="text-xs text-peach"
                      onClick={() => setViewer(r)}
                    >
                      Увеличить
                    </button>
                  ) : null}
                  {r.runId && r.status === "error" ? (
                    <button
                      type="button"
                      className="text-xs text-peach"
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
                  {canOpen ? (
                    <button
                      type="button"
                      className="text-xs text-peach"
                      onClick={() =>
                        opsFetch("/api/ops/jobs", {
                          method: "POST",
                          body: JSON.stringify({
                            action: "resend_tg",
                            itemId: r.id,
                          }),
                        })
                          .then(() => setMsg("Отправлено в Telegram-очередь"))
                          .catch((e) =>
                            setMsg(e instanceof Error ? e.message : "ошибка"),
                          )
                      }
                    >
                      Снова в Telegram
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {viewer ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setViewer(null)}
        >
          <div
            className="relative flex max-h-[92vh] max-w-[96vw] flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
              <span>
                {viewer.kind} · {viewer.user.name || viewer.user.email} ·{" "}
                {fmtTime(viewer.createdAt)}
              </span>
              <div className="flex gap-3">
                <a
                  href={viewer.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-peach"
                >
                  Файл
                </a>
                <button
                  type="button"
                  className="text-zinc-400 hover:text-white"
                  onClick={() => setViewer(null)}
                >
                  Закрыть
                </button>
              </div>
            </div>
            {viewer.kind === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewer.resultUrl}
                alt=""
                className="max-h-[85vh] max-w-[96vw] object-contain"
              />
            ) : (
              <video
                src={viewer.resultUrl}
                className="max-h-[85vh] max-w-[96vw] object-contain"
                controls
                autoPlay
                playsInline
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
