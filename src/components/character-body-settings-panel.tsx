"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  VIDEO_BODY_LOOKBOOK_FIELD_IDS,
  bodyShapeAppearanceForPrompt,
  fieldsForGender,
  lookbookSelectValue,
  parseLookbook,
  toCustomValue,
  customPayload,
  isCustomValue,
  type LookbookValues,
} from "@/lib/lookbook";

type CharOption = { id: string; name: string };

/**
 * Compact figure-preset editor for video labs.
 * Saves into character.lookbookJson via PATCH /api/characters.
 */
export function CharacterBodySettingsPanel({
  characters,
  characterId,
  onCharacterIdChange,
}: {
  characters: CharOption[];
  characterId: string;
  onCharacterIdChange?: (id: string) => void;
}) {
  const [lookbook, setLookbook] = useState<LookbookValues>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const bodyFields = fieldsForGender("female").filter((f) =>
    VIDEO_BODY_LOOKBOOK_FIELD_IDS.female.has(f.id),
  );

  const load = useCallback(async (id: string) => {
    if (!id) {
      setLookbook({});
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/characters");
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const list = (data.characters || data || []) as Array<{
        id: string;
        lookbookJson?: string;
        gender?: string;
      }>;
      const ch = list.find((c) => c.id === id);
      if (!ch) {
        setLookbook({});
        return;
      }
      const g = ch.gender === "male" ? "male" : "female";
      setLookbook(parseLookbook(ch.lookbookJson, g));
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    }
  }, []);

  useEffect(() => {
    void load(characterId);
  }, [characterId, load]);

  async function save() {
    if (!characterId) return;
    setBusy(true);
    setMsg("");
    setError("");
    try {
      const res = await fetch("/api/characters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: characterId, lookbook }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "не сохранилось"));
      setMsg("Тело сохранено — подхватится в следующей генерации");
      setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  const preview = bodyShapeAppearanceForPrompt(lookbook, "female");

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-zinc-200">Параметры тела (видео)</div>
        <Link
          href="/peach/characters"
          className="text-[11px] text-peach hover:underline"
        >
          Полный lookbook →
        </Link>
      </div>
      <p className="mt-1 text-[11px] text-zinc-600">
        Пресет фигуры (рост + тип) уходит в Story/видео. Без слов про грудь/попу. Лицо — с фото.
      </p>

      {onCharacterIdChange ? (
        <label className="mt-2 block text-[11px] text-zinc-500">
          Персонаж
          <select
            value={characterId}
            onChange={(e) => onCharacterIdChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value="">— не выбран —</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!characterId ? (
        <p className="mt-2 text-[11px] text-zinc-500">Выбери персонажа, чтобы править тело.</p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-1">
          {bodyFields.map((field) => {
            const stored = lookbook[field.id] || "";
            const selectVal = lookbookSelectValue(field, stored);
            const showCustom =
              selectVal === "__custom__" || isCustomValue(stored);
            return (
              <label key={field.id} className="flex flex-col gap-1 text-[11px] text-zinc-400">
                {field.label}
                <select
                  className="rounded border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
                  value={selectVal}
                  disabled={busy}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLookbook((prev) => ({
                      ...prev,
                      [field.id]:
                        v === "__custom__"
                          ? toCustomValue(customPayload(prev[field.id]) || "")
                          : v,
                    }));
                  }}
                >
                  {field.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                  <option value="__custom__">Своё…</option>
                </select>
                {showCustom ? (
                  <input
                    className="rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                    placeholder="EN описание"
                    value={
                      isCustomValue(stored) ? customPayload(stored) : ""
                    }
                    disabled={busy}
                    onChange={(e) =>
                      setLookbook((prev) => ({
                        ...prev,
                        [field.id]: toCustomValue(e.target.value),
                      }))
                    }
                  />
                ) : null}
              </label>
            );
          })}
        </div>
      )}

      {preview ? (
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-zinc-500">
          → {preview}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!characterId || busy}
          onClick={() => void save()}
          className="rounded-full border border-peach/40 bg-peach/10 px-3 py-1 text-xs text-peach disabled:opacity-40"
        >
          {busy ? "…" : "Сохранить тело"}
        </button>
        {msg ? <span className="text-[11px] text-emerald-400">{msg}</span> : null}
        {error ? <span className="text-[11px] text-red-400">{error}</span> : null}
      </div>
    </div>
  );
}
