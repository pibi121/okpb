"use client";

import { useCallback, useEffect, useState } from "react";

type Scene = { sceneImageUrl: string; editPrompt: string };

type Pack = {
  id: string;
  title: string;
  notes: string;
  tgDisplayTitle: string;
  pricePeaches: number;
  previewVideoUrl: string;
  funnelV2Published: boolean;
  sortOrder: number;
  scenes: Scene[];
  ready: boolean;
};

const emptyScenes = (): Scene[] =>
  Array.from({ length: 5 }, () => ({ sceneImageUrl: "", editPrompt: "" }));

const blank = (): Pack => ({
  id: "",
  title: "",
  notes: "",
  tgDisplayTitle: "",
  pricePeaches: 270,
  previewVideoUrl: "",
  funnelV2Published: false,
  sortOrder: 0,
  scenes: emptyScenes(),
  ready: false,
});

export function LookPacksPanel() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [draft, setDraft] = useState<Pack>(blank());
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/peach/look-packs");
    const json = await res.json();
    if (!res.ok) throw new Error(String(json.error || "Не удалось загрузить"));
    setPacks((json.packs || []) as Pack[]);
  }, []);

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : "error"));
  }, [load]);

  function patchScene(i: number, patch: Partial<Scene>) {
    setDraft((d) => {
      const scenes = d.scenes.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
      return { ...d, scenes };
    });
  }

  async function uploadScene(i: number, file: File) {
    setBusy(true);
    setErr("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/peach/look-packs", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error || "Не загрузилось"));
      patchScene(i, { sceneImageUrl: String(json.url || "") });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const res = await fetch("/api/peach/look-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id || undefined,
          title: draft.title,
          tgDisplayTitle: draft.tgDisplayTitle,
          notes: draft.notes,
          pricePeaches: Number(draft.pricePeaches) || 0,
          previewVideoUrl: draft.previewVideoUrl,
          funnelV2Published: draft.funnelV2Published,
          sortOrder: Number(draft.sortOrder) || 0,
          scenes: draft.scenes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error || "Не сохранилось"));
      setDraft(json.pack as Pack);
      await load();
      setOk(draft.funnelV2Published ? "Опубликован. Раздел в боте откроется." : "Сохранено. В боте ещё скрыто.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!id) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/peach/look-packs?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Не удалось удалить");
      if (draft.id === id) setDraft(blank());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-zinc-400">
        Один образ — 5 поз. В боте раздел «Look-образы» появится только после публикации
        хотя бы одного. Пока галочка снята, люди его не видят.
      </p>
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {ok ? <p className="text-sm text-emerald-400/90">{ok}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-white/15 px-3 py-2 text-xs"
          onClick={() => setDraft(blank())}
        >
          Новый образ
        </button>
        {packs.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setDraft(p)}
            className={`rounded-2xl border px-3 py-2 text-left text-xs ${
              draft.id === p.id
                ? "border-peach/50 bg-peach/10"
                : "border-white/10 bg-[#121214]/80"
            }`}
          >
            <div className="font-medium">{p.tgDisplayTitle || p.title}</div>
            <div className="text-zinc-500">
              {p.funnelV2Published ? "в боте" : "скрыт"} · {p.pricePeaches}₽
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-3 rounded-2xl border border-white/10 bg-[#121214]/80 p-4">
        <label className="grid gap-1 text-xs text-zinc-400">
          Название
          <input
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Текст кнопки в боте
          <input
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
            value={draft.tgDisplayTitle}
            onChange={(e) => setDraft({ ...draft, tgDisplayTitle: e.target.value })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-zinc-400">
            Цена пака, ₽
            <input
              type="number"
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
              value={draft.pricePeaches}
              onChange={(e) =>
                setDraft({ ...draft, pricePeaches: Number(e.target.value) })
              }
            />
          </label>
          <label className="grid gap-1 text-xs text-zinc-400">
            Порядок
            <input
              type="number"
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
              value={draft.sortOrder}
              onChange={(e) =>
                setDraft({ ...draft, sortOrder: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label className="grid gap-1 text-xs text-zinc-400">
          Короткое описание
          <textarea
            className="min-h-16 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Видео-превью (ссылка)
          <input
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
            value={draft.previewVideoUrl}
            onChange={(e) => setDraft({ ...draft, previewVideoUrl: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.funnelV2Published}
            onChange={(e) =>
              setDraft({ ...draft, funnelV2Published: e.target.checked })
            }
          />
          Опубликовать в боте
        </label>

        {draft.scenes.map((scene, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-white/10 p-3">
            <div className="text-xs font-medium text-zinc-300">Сцена {i + 1}</div>
            <input
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-foreground"
              placeholder="Ссылка на картинку сцены"
              value={scene.sceneImageUrl}
              onChange={(e) => patchScene(i, { sceneImageUrl: e.target.value })}
            />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="text-xs text-zinc-400"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadScene(i, file);
              }}
            />
            <textarea
              className="min-h-16 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
              placeholder="Промпт этой позы"
              value={scene.editPrompt}
              onChange={(e) => patchScene(i, { editPrompt: e.target.value })}
            />
          </div>
        ))}

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-peach px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
            disabled={busy || !draft.title.trim()}
            onClick={() => void save()}
          >
            {busy ? "Сохраняю…" : "Сохранить образ"}
          </button>
          {draft.id ? (
            <button
              type="button"
              className="rounded-lg border border-white/15 px-4 py-2 text-sm"
              disabled={busy}
              onClick={() => void remove(draft.id)}
            >
              Удалить
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
