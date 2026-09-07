"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Char = { id: string; name: string };

export function StoryPackCreate({
  characters,
  styles,
}: {
  characters: Char[];
  styles: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [genre, setGenre] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [styleId, setStyleId] = useState("");
  const [characterIds, setCharacterIds] = useState<string[]>(
    characters[0] ? [characters[0].id] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setCharacterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 2),
    );
  }

  async function create(suggest: boolean) {
    setError("");
    if (idea.trim().length < 4) {
      setError("Опиши идею сюжета");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/peach/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || idea.trim().slice(0, 48),
          idea: idea.trim(),
          genre: genre.trim() || "other",
          characterIds,
          locationNote,
          styleId: styleId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ошибка");
      const id = data.pack.id as string;
      if (suggest) {
        const s = await fetch(`/api/peach/stories/${id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "suggest_beats" }),
        });
        const sd = await s.json();
        if (!s.ok) {
          router.push(`/peach/stories/${id}`);
          throw new Error(sd.error || "нарезка не вышла — добавь кадры вручную");
        }
      }
      router.push(`/peach/stories/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="font-medium">Новый сюжет</h3>
      <p className="mt-1 text-sm text-zinc-600">
        Идея → нарезка кадров → на каждом кадре фото «ок», потом видео «ок».
      </p>
      <label className="mt-3 flex flex-col gap-1 text-sm">
        Название
        <input
          className="rounded-md border px-3 py-2"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Бег от маньяка"
        />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-sm">
        Идея
        <textarea
          className="rounded-md border px-3 py-2"
          rows={3}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="Девушка бежит ночью по парковке, маньяк сзади…"
        />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Метка <span className="font-normal text-zinc-500">(необязательно)</span>
          <input
            className="rounded-md border px-3 py-2"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="погоня, доставка, что угодно — или пусто"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Стиль (необязательно)
          <select
            className="rounded-md border px-3 py-2"
            value={styleId}
            onChange={(e) => setStyleId(e.target.value)}
          >
            <option value="">—</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1 text-sm">
        Локация (слот)
        <input
          className="rounded-md border px-3 py-2"
          value={locationNote}
          onChange={(e) => setLocationNote(e.target.value)}
          placeholder="ночная парковка у ТЦ, фонари"
        />
      </label>
      <div className="mt-3 text-sm">
        Персонажи (до 2)
        <div className="mt-1 flex flex-wrap gap-2">
          {characters.length === 0 ? (
            <span className="text-zinc-500">Сначала создай персонажа</span>
          ) : (
            characters.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 rounded border px-2 py-1">
                <input
                  type="checkbox"
                  checked={characterIds.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                {c.name}
              </label>
            ))
          )}
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          onClick={() => void create(true)}
        >
          {busy ? "…" : "Создать и набросать кадры"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => void create(false)}
        >
          Создать пустым
        </button>
      </div>
    </div>
  );
}
