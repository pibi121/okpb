"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type FolderRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  total: number;
  ready: number;
  pending: number;
  errors: number;
  rated: number;
  createdAt: string;
};

type Char = { id: string; name: string; loraStatus: string };

export function TestGalleryHome({
  folders,
  characters,
  daisyId,
}: {
  folders: FolderRow[];
  characters: Char[];
  daisyId: string | null;
}) {
  const router = useRouter();
  const [characterId, setCharacterId] = useState(
    daisyId || characters[0]?.id || "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startLoraPose(recreate: boolean) {
    if (!characterId) {
      setError("Выбери персонажа");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/test-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start_lora_pose",
          characterId,
          recreate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ошибка");
        return;
      }
      router.push(`/peach/tests/${data.folder.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const existing = folders.find((f) => f.slug === "lora-pose");

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h3 className="font-medium">Новая папка · Lora + Pose</h3>
        <p className="mt-1 text-sm text-zinc-600">
          3 кадра на каждую позу из списка (вертикаль / квадрат / горизонт). Потом
          оценка: плохо · нейтрально · хорошо.
        </p>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          Персонаж
          <select
            className="rounded-md border border-zinc-300 px-3 py-2"
            value={characterId}
            onChange={(e) => setCharacterId(e.target.value)}
            disabled={busy}
          >
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.loraStatus}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !characterId}
            onClick={() => void startLoraPose(false)}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy
              ? "Запуск…"
              : existing
                ? "Открыть / догнать очередь"
                : "Запустить Lora + Pose"}
          </button>
          {existing ? (
            <button
              type="button"
              disabled={busy || !characterId}
              onClick={() => {
                if (
                  confirm(
                    "Пересоздать папку и сгенерировать всё заново? Старые кадры удалятся.",
                  )
                ) {
                  void startLoraPose(true);
                }
              }}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50"
            >
              Пересоздать с нуля
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </div>

      <div>
        <h3 className="mb-2 font-medium">Папки</h3>
        {folders.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока пусто.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {folders.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/peach/tests/${f.id}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm hover:border-zinc-400"
                >
                  <span>
                    <span className="font-medium">{f.title}</span>
                    <span className="ml-2 text-zinc-500">{f.status}</span>
                  </span>
                  <span className="text-zinc-500">
                    {f.ready}/{f.total} готово · {f.rated} оценено
                    {f.pending ? ` · ${f.pending} в очереди` : ""}
                    {f.errors ? ` · ${f.errors} ошибок` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
