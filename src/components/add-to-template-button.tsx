"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Pack = { id: string; title: string; status: string };

export function AddToTemplateButton({
  itemId,
  kind,
  onDone,
}: {
  itemId: string;
  kind: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/peach/templates");
    if (!res.ok) return;
    const data = (await res.json()) as { packs: Pack[] };
    setPacks(data.packs.filter((p) => p.status !== "published"));
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  async function add(packId: string) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/peach/templates/${packId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_gallery", itemId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "ошибка");
      setOpen(false);
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (kind !== "photo" && kind !== "video") return null;

  return (
    <div ref={rootRef} className="relative z-30 w-full">
      <button
        type="button"
        className="rounded border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-xs text-amber-200"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        В шаблон
      </button>
      {open ? (
        <div className="relative z-30 mt-2 w-full rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          {packs.length === 0 ? (
            <p className="px-1 py-1 text-xs text-zinc-500">
              Нет папок. Создай в разделе «Шаблоны».
            </p>
          ) : (
            packs.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                className="block w-full rounded px-2 py-1.5 text-left text-xs text-zinc-800 hover:bg-zinc-100 disabled:opacity-50"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void add(p.id);
                }}
              >
                {p.title}
              </button>
            ))
          )}
          {err ? <p className="mt-1 text-[10px] text-red-500">{err}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
