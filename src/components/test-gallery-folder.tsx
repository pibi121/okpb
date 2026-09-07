"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageGeneration } from "@/components/image-generation";

function orientLabel(id: string) {
  if (id === "9_16") return "Вертикаль";
  if (id === "1_1") return "Квадрат";
  if (id === "16_9") return "Горизонт";
  return id;
}

type Shot = {
  id: string;
  poseId: string;
  poseLabel: string;
  orientation: string;
  width: number;
  height: number;
  status: string;
  resultUrl: string | null;
  engine: string | null;
  error: string | null;
  rating: number | null;
  sortIndex: number;
};

type Folder = {
  id: string;
  title: string;
  status: string;
  error: string | null;
  character: { id: string; name: string; triggerWord: string | null } | null;
  shots: Shot[];
};

type PoseSummary = {
  poseId: string;
  poseLabel: string;
  ready: number;
  bad: number;
  neutral: number;
  good: number;
  unrated: number;
};

const ORIENT_ORDER = ["9_16", "1_1", "16_9"];

export function TestGalleryFolderView({
  initialFolder,
  initialSummary,
}: {
  initialFolder: Folder;
  initialSummary: PoseSummary[];
}) {
  const [folder, setFolder] = useState(initialFolder);
  const [summary, setSummary] = useState(initialSummary);
  const [filter, setFilter] = useState<"all" | "unrated" | "ready">("all");

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/peach/test-gallery?folderId=${folder.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setFolder(data.folder);
    setSummary(data.poseSummary || []);
  }, [folder.id]);

  useEffect(() => {
    if (folder.status !== "running" && folder.status !== "pending") return;
    const t = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [folder.status, refresh]);

  async function rate(shotId: string, rating: number | null) {
    setFolder((prev) => ({
      ...prev,
      shots: prev.shots.map((s) => (s.id === shotId ? { ...s, rating } : s)),
    }));
    await fetch("/api/peach/test-gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rate", shotId, rating }),
    });
    void refresh();
  }

  const byPose = useMemo(() => {
    const map = new Map<string, { label: string; shots: Shot[] }>();
    for (const s of folder.shots) {
      let g = map.get(s.poseId);
      if (!g) {
        g = { label: s.poseLabel, shots: [] };
        map.set(s.poseId, g);
      }
      g.shots.push(s);
    }
    for (const g of map.values()) {
      g.shots.sort(
        (a, b) =>
          ORIENT_ORDER.indexOf(a.orientation) - ORIENT_ORDER.indexOf(b.orientation),
      );
    }
    return [...map.entries()];
  }, [folder.shots]);

  const visible = byPose.filter(([, g]) => {
    if (filter === "all") return true;
    if (filter === "ready") return g.shots.some((s) => s.status === "ready");
    return g.shots.some(
      (s) => s.status === "ready" && (s.rating === null || s.rating === undefined),
    );
  });

  const readyN = folder.shots.filter((s) => s.status === "ready").length;
  const pendingN = folder.shots.filter((s) => s.status === "pending").length;
  const ratedN = folder.shots.filter(
    (s) => s.rating === -1 || s.rating === 0 || s.rating === 1,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/peach/tests" className="text-sm text-zinc-500 hover:underline">
            ← Галерея тестов
          </Link>
          <h2 className="text-lg font-medium">{folder.title}</h2>
          <p className="text-sm text-zinc-600">
            {folder.character?.name || "—"} · {folder.status} · {readyN}/
            {folder.shots.length} готово · {ratedN} оценено
            {pendingN ? ` · ${pendingN} в очереди` : ""}
          </p>
          {folder.error ? (
            <p className="text-sm text-red-600">{folder.error}</p>
          ) : null}
        </div>
        <div className="flex gap-1 text-sm">
          {(
            [
              ["all", "Все"],
              ["ready", "Готовые"],
              ["unrated", "Без оценки"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={
                filter === id
                  ? "rounded-full bg-zinc-900 px-3 py-1 text-white"
                  : "rounded-full border px-3 py-1"
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-full border px-3 py-1"
          >
            Обновить
          </button>
        </div>
      </div>

      {summary.length ? (
        <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Сводка по позам</summary>
          <div className="mt-2 max-h-48 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="py-1">Поза</th>
                  <th>−</th>
                  <th>○</th>
                  <th>+</th>
                  <th>?</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.poseId} className="border-t border-zinc-200">
                    <td className="py-1 pr-2">{r.poseLabel}</td>
                    <td>{r.bad}</td>
                    <td>{r.neutral}</td>
                    <td>{r.good}</td>
                    <td>{r.unrated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <div className="flex flex-col gap-8">
        {visible.map(([poseId, group]) => (
          <section key={poseId} className="rounded-lg border border-zinc-200 bg-white p-4">
            <h3 className="mb-3 font-medium">{group.label}</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {group.shots.map((shot) => (
                <div key={shot.id} className="flex flex-col gap-2">
                  <div className="text-xs text-zinc-500">
                    {orientLabel(shot.orientation)} · {shot.width}×{shot.height}
                    {shot.engine ? ` · ${shot.engine}` : ""}
                  </div>
                  {shot.status === "ready" && shot.resultUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={shot.resultUrl}
                      alt={shot.poseLabel}
                      className="w-full rounded-md border border-zinc-200 object-contain"
                    />
                  ) : shot.status === "error" ? (
                    <div className="flex aspect-[3/4] items-center justify-center rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      {shot.error || "ошибка"}
                    </div>
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
                      <ImageGeneration
                        fill
                        label="В очереди…"
                        resolution={`${shot.width} × ${shot.height}`}
                        prompt={shot.poseLabel}
                      />
                    </div>
                  )}
                  <div className="flex gap-1">
                    {(
                      [
                        [-1, "Плохо", "bg-rose-700"],
                        [0, "Нейтр.", "bg-zinc-600"],
                        [1, "Хорошо", "bg-emerald-700"],
                      ] as const
                    ).map(([val, label, active]) => (
                      <button
                        key={val}
                        type="button"
                        disabled={shot.status !== "ready"}
                        onClick={() =>
                          void rate(shot.id, shot.rating === val ? null : val)
                        }
                        className={`flex-1 rounded px-2 py-1.5 text-xs disabled:opacity-40 ${
                          shot.rating === val
                            ? `${active} text-white`
                            : "border border-zinc-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
