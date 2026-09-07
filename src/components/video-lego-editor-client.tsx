"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { VideoLegoFile } from "@/lib/prompt-lego-core";

type Section = "poses" | "actions" | "voices" | "cameras";

type Brick = {
  id: string;
  label: string;
  section?: string;
  sectionLabel?: string;
  text?: string;
  body?: string;
};

export function VideoLegoEditorClient() {
  const [catalog, setCatalog] = useState<VideoLegoFile | null>(null);
  const [section, setSection] = useState<Section>("poses");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/peach/video-lego");
    const data = await res.json();
    if (!res.ok) throw new Error(String(data.error || "error"));
    setCatalog(data.catalog as VideoLegoFile);
  }, []);

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "error"));
  }, [load]);

  const items = useMemo(() => {
    if (!catalog) return [] as Brick[];
    const rows = (catalog[section] || []) as Brick[];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.text || "").toLowerCase().includes(q),
    );
  }, [catalog, section, query]);

  const selected = items.find((i) => i.id === selectedId) || items[0];

  useEffect(() => {
    if (items[0] && !items.some((i) => i.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  function patchSelected(patch: Partial<Brick>) {
    if (!catalog || !selected) return;
    const next = { ...catalog };
    const list = [...((next[section] || []) as Brick[])];
    const idx = list.findIndex((r) => r.id === selected.id);
    if (idx < 0) return;
    list[idx] = { ...list[idx]!, ...patch };
    next[section] = list as never;
    setCatalog(next);
  }

  async function save() {
    if (!catalog) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/peach/video-lego", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalog }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "error"));
      setMsg("Сохранено в prompt_lego_video.json");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) {
    return <p className="text-sm text-zinc-500">{msg || "Загрузка…"}</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="flex flex-wrap gap-2">
          {(["poses", "actions", "voices", "cameras"] as Section[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={
                section === s
                  ? "rounded-full bg-peach px-3 py-1 text-xs font-medium text-black"
                  : "rounded-full border border-white/15 px-3 py-1 text-xs"
              }
            >
              {s}
            </button>
          ))}
        </div>
        <input
          className="mt-3 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
          placeholder="Поиск…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto text-sm">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={
                  selected?.id === item.id
                    ? "w-full rounded-lg bg-peach/15 px-2 py-1.5 text-left text-peach"
                    : "w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                }
              >
                <div className="font-medium">{item.label}</div>
                <div className="text-[10px] text-zinc-500">{item.id}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        {selected ? (
          <>
            <h3 className="font-medium">{selected.label}</h3>
            <p className="text-xs text-zinc-500">{selected.id}</p>
            <label className="mt-4 block text-sm">
              <span className="text-zinc-400">Label</span>
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
                value={selected.label}
                onChange={(e) => patchSelected({ label: e.target.value })}
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-zinc-400">text (короткий промпт)</span>
              <textarea
                rows={4}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm font-mono"
                value={selected.text || ""}
                onChange={(e) => patchSelected({ text: e.target.value })}
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-zinc-400">body (полный MiniMax / Ref2V блок)</span>
              <textarea
                rows={14}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-xs font-mono"
                value={selected.body || ""}
                onChange={(e) => patchSelected({ body: e.target.value })}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="mt-4 rounded-full bg-peach px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {busy ? "Сохраняю…" : "Сохранить JSON"}
            </button>
            {msg ? <p className="mt-2 text-sm text-emerald-400">{msg}</p> : null}
          </>
        ) : (
          <p className="text-sm text-zinc-500">Выбери элемент слева</p>
        )}
      </div>
    </div>
  );
}
