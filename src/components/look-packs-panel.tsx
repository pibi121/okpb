"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Lab2KeyboardPreview,
  type PreviewButton,
} from "@/components/lab2-keyboard-preview";
import {
  defaultFunnelKeyboardCatalog,
  type FunnelKeyboardCatalog,
  type TgButtonStyle,
} from "@/lib/tg/funnel-v2/keyboard-layout";

type Scene = { editPrompt: string };

const BUTTON_STYLES: Array<{ id: TgButtonStyle; label: string }> = [
  { id: "", label: "Обычная" },
  { id: "primary", label: "Синяя" },
  { id: "success", label: "Зелёная" },
  { id: "danger", label: "Красная" },
];

type Pack = {
  id: string;
  title: string;
  notes: string;
  tgDisplayTitle: string;
  pricePeaches: number;
  previewVideoUrl: string;
  funnelV2Published: boolean;
  sortOrder: number;
  buttonStyle: TgButtonStyle;
  rowBreak: boolean;
  scenes: Scene[];
  ready: boolean;
};

const emptyScenes = (): Scene[] =>
  Array.from({ length: 5 }, () => ({ editPrompt: "" }));

const blank = (): Pack => ({
  id: "",
  title: "",
  notes: "",
  tgDisplayTitle: "",
  pricePeaches: 270,
  previewVideoUrl: "",
  funnelV2Published: false,
  sortOrder: 0,
  buttonStyle: "",
  rowBreak: false,
  scenes: emptyScenes(),
  ready: false,
});

export function LookPacksPanel() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [draft, setDraft] = useState<Pack>(blank());
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyboard, setKeyboard] = useState<FunnelKeyboardCatalog>(
    defaultFunnelKeyboardCatalog(),
  );
  const [previewPage, setPreviewPage] = useState(0);
  const [dragId, setDragId] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/peach/look-packs");
    const json = await res.json();
    if (!res.ok) throw new Error(String(json.error || "Не удалось загрузить"));
    setPacks((json.packs || []) as Pack[]);
    if (json.keyboard) setKeyboard(json.keyboard as FunnelKeyboardCatalog);
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

  async function uploadTeaser(file: File) {
    setBusy(true);
    setErr("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/peach/look-packs", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error || "Не загрузилось"));
      setDraft((d) => ({ ...d, previewVideoUrl: String(json.url || "") }));
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
          buttonStyle: draft.buttonStyle,
          rowBreak: draft.rowBreak,
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

  async function saveKeyboard(patch: Partial<FunnelKeyboardCatalog>) {
    const next = { ...keyboard, ...patch };
    setKeyboard(next);
    const res = await fetch("/api/peach/look-packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "keyboard",
        customRows: next.customRows,
        firstPageSize: next.firstPageSize,
        nextPageSize: next.nextPageSize,
      }),
    });
    if (!res.ok) setErr("Не удалось сохранить раскладку");
  }

  async function reorder(fromId: string, toId: string) {
    if (!fromId || !toId || fromId === toId) return;
    const ids = packs.map((p) => p.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setPacks(ids.map((id, index) => {
      const pack = packs.find((p) => p.id === id)!;
      return { ...pack, sortOrder: index };
    }));
    const res = await fetch("/api/peach/look-packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", ids }),
    });
    if (!res.ok) setErr("Не удалось сохранить порядок");
  }

  const previewItems: PreviewButton[] = packs
    .filter((p) => (draft.id === p.id ? draft.funnelV2Published : p.funnelV2Published))
    .map((p) => {
      const src = draft.id === p.id ? draft : p;
      return {
        key: p.id,
        label: (src.tgDisplayTitle || src.title || "Образ").slice(0, 40),
        rowBreak: src.rowBreak,
        style: src.buttonStyle,
      };
    });

  return (
    <div className="grid gap-4">
      <p className="text-sm text-zinc-400">
        Сначала прогони 5 промптов на одной фотке. Если результат ок — вставь эти промпты сюда,
        напиши название и прикрепи видео-тизер. Человек пришлёт своё фото, и пак соберётся по
        этим промптам. В боте раздел появится только после публикации.
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
            draggable
            onDragStart={() => setDragId(p.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              void reorder(dragId, p.id);
              setDragId("");
            }}
            onClick={() => setDraft(p)}
            className={`rounded-2xl border px-3 py-2 text-left text-xs ${
              draft.id === p.id
                ? "border-peach/50 bg-peach/10"
                : "border-white/10 bg-[#121214]/80"
            }`}
          >
            <div className="font-medium">{p.tgDisplayTitle || p.title}</div>
            <div className="text-zinc-500">
              {p.funnelV2Published ? "в боте" : "скрыт"} · {p.pricePeaches}₽ · перетащи
            </div>
          </button>
        ))}
      </div>

      <Lab2KeyboardPreview
        title="Клавиатура образов"
        hint="Как у поз: перетащи карточки выше для порядка. Длинное название — «Новая строка». Короткие — «В ряд с предыдущей»."
        items={previewItems}
        settings={keyboard}
        page={previewPage}
        onPage={setPreviewPage}
        onSettings={(patch) => void saveKeyboard(patch)}
        onResetRows={() => void saveKeyboard({ customRows: false })}
      />

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
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-500">Ряд</span>
          <button
            type="button"
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              keyboard.customRows && draft.rowBreak
                ? "border-peach/40 bg-peach/10 text-peach"
                : "border-white/10 text-zinc-400"
            }`}
            onClick={() => {
              setDraft({ ...draft, rowBreak: true });
              if (!keyboard.customRows) void saveKeyboard({ customRows: true });
            }}
          >
            Новая строка
          </button>
          <button
            type="button"
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              keyboard.customRows && !draft.rowBreak
                ? "border-peach/40 bg-peach/10 text-peach"
                : "border-white/10 text-zinc-400"
            }`}
            onClick={() => {
              setDraft({ ...draft, rowBreak: false });
              if (!keyboard.customRows) void saveKeyboard({ customRows: true });
            }}
          >
            В ряд с предыдущей
          </button>
          <span className="ml-1 text-[11px] text-zinc-500">Цвет</span>
          {BUTTON_STYLES.map((s) => (
            <button
              key={s.id || "plain"}
              type="button"
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                draft.buttonStyle === s.id
                  ? "border-peach/40 bg-peach/10 text-peach"
                  : "border-white/10 text-zinc-400"
              }`}
              onClick={() => setDraft({ ...draft, buttonStyle: s.id })}
            >
              {s.label}
            </button>
          ))}
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
          Видео-тизер
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="text-xs text-zinc-400"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadTeaser(file);
            }}
          />
          {draft.previewVideoUrl ? (
            <video
              className="mt-1 max-h-40 rounded-lg"
              src={draft.previewVideoUrl}
              controls
              muted
            />
          ) : null}
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
            <div className="text-xs font-medium text-zinc-300">Промпт {i + 1}</div>
            <textarea
              className="min-h-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
              placeholder="Промпт этого кадра"
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
