"use client";

import { useState } from "react";

export function GalleryTgTransferButtons({
  itemId,
  kind,
  defaultTitle,
  onDone,
}: {
  itemId: string;
  kind: string;
  defaultTitle?: string | null;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<"both" | "tg" | null>(null);
  const [title, setTitle] = useState(defaultTitle || "");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  if (kind !== "photo" && kind !== "video") return null;

  async function transfer(mode: "both" | "tg") {
    setBusy(mode);
    setErr("");
    setOk("");
    try {
      const res = await fetch(`/api/peach/gallery/${itemId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          title: title.trim() || undefined,
          displayTitle: title.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setOk(mode === "both" ? "В сервисе и TG ✓" : "Только в TG ✓");
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-peach/25 bg-peach/5 p-2"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
        placeholder="Название в TG"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={!!busy}
          className="rounded bg-peach px-2 py-1 text-[10px] font-semibold text-black disabled:opacity-50"
          onClick={() => void transfer("both")}
        >
          {busy === "both" ? "…" : "ПЕРЕНЕСТИ В ОБА"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          className="rounded border border-peach/50 px-2 py-1 text-[10px] font-medium text-peach disabled:opacity-50"
          onClick={() => void transfer("tg")}
        >
          {busy === "tg" ? "…" : "ПЕРЕНЕСТИ В ТГ"}
        </button>
      </div>
      {ok ? <p className="text-[10px] text-emerald-600">{ok}</p> : null}
      {err ? <p className="text-[10px] text-red-500">{err}</p> : null}
    </div>
  );
}
