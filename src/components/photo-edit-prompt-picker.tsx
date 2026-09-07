"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PhotoEditPromptPreset,
  PhotoEditPromptPresetGroups,
} from "@/lib/photo-edit-prompt-presets";

const TAB_LABELS: Record<TabId, string> = {
  poses: "Позы",
  lighting: "Свет",
  events: "События",
  stylization: "Стилизация",
  body: "Тело",
};

type TabId = keyof PhotoEditPromptPresetGroups;

export function PhotoEditPromptPicker({
  value,
  onChange,
  compact,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  compact?: boolean;
  hint?: string;
}) {
  const [groups, setGroups] = useState<PhotoEditPromptPresetGroups | null>(null);
  const [tab, setTab] = useState<TabId>("poses");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(!compact);

  useEffect(() => {
    void fetch("/api/peach/photo/prompt-presets")
      .then((r) => r.json())
      .then((data) => {
        if (data.presets) setGroups(data.presets as PhotoEditPromptPresetGroups);
      })
      .catch(() => undefined);
  }, []);

  const items = useMemo(() => {
    if (!groups) return [];
    const list = groups[tab] || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.text.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [groups, tab, search]);

  function insertPreset(preset: PhotoEditPromptPreset) {
    const chunk = preset.text.trim();
    if (!chunk) return;
    const prev = value.trim();
    if (!prev) {
      onChange(chunk);
      return;
    }
    if (prev.includes(chunk)) return;
    onChange(`${prev}. ${chunk}`);
  }

  if (!groups) {
    return (
      <p className="text-xs text-zinc-600">Загрузка шаблонов промптов…</p>
    );
  }

  const tabs: TabId[] = ["poses", "lighting", "events", "stylization", "body"];

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[#0c0c0e] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-zinc-400">
            Шаблоны промптов
          </div>
          {hint ? (
            <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>
          ) : (
            <p className="mt-0.5 text-[11px] text-zinc-600">
              Клик — добавить текст в поле. Для TG dual-ref используй блок «Позы»
              + «Свет».
            </p>
          )}
        </div>
        {compact ? (
          <button
            type="button"
            className="text-xs text-peach underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Скрыть" : "Показать"}
          </button>
        ) : null}
      </div>

      {open ? (
        <>
          <input
            type="search"
            placeholder="Поиск…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#121214] px-3 py-1.5 text-xs"
          />
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => {
              const count = groups[t]?.length ?? 0;
              if (!count) return null;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    tab === t
                      ? "rounded-full border border-peach/50 bg-peach/15 px-2.5 py-0.5 text-[11px] text-peach"
                      : "rounded-full border border-white/15 px-2.5 py-0.5 text-[11px] text-zinc-500"
                  }
                >
                  {TAB_LABELS[t]} ({count})
                </button>
              );
            })}
          </div>
          <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto pr-1">
            {items.length === 0 ? (
              <p className="text-xs text-zinc-600">Ничего не найдено</p>
            ) : (
              items.map((p) => (
                <button
                  key={`${p.category}-${p.id}`}
                  type="button"
                  onClick={() => insertPreset(p)}
                  className="rounded-lg border border-white/8 bg-[#121214] px-2 py-1.5 text-left hover:border-peach/30"
                >
                  <div className="text-xs font-medium text-foreground">
                    {p.label}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] text-zinc-600">
                    {p.text}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
