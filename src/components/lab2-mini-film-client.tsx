"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QuickVideoShotsEditor } from "@/components/quick-video-shots-editor";
import { SaveQuickVideoTemplateButton } from "@/components/save-quick-video-template-button";
import type { LegoCharacterRef, VideoLegoFile } from "@/lib/prompt-lego-core";
import {
  MAX_QUICK_VIDEO_TOTAL_SEC,
  splitDurationEvenly,
  sumQuickVideoShotsSec,
  type QuickVideoShotsPlan,
} from "@/lib/quick-video-prompt";

type RunRow = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  resultVideoUrl?: string | null;
  durationSec?: number;
  createdAt?: string;
};

const CHAR1_ID = "custom:hero1";
const CHAR2_ID = "custom:hero2";

function defaultPlan(): QuickVideoShotsPlan {
  const total = 8;
  const parts = splitDurationEvenly(total, 2);
  return {
    totalDurationSec: total,
    shots: parts.map((durationSec, i) => ({
      id: `shot-${i + 1}`,
      durationSec,
      legoQuery: "",
    })),
  };
}

export function Lab2MiniFilmClient({
  videoLego,
}: {
  videoLego: VideoLegoFile;
}) {
  const [name1, setName1] = useState("Девушка");
  const [name2, setName2] = useState("Парень");
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [poseVideo, setPoseVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("Мини-фильм");
  const [orientation, setOrientation] = useState<"9_16" | "16_9">("9_16");
  const [plan, setPlan] = useState<QuickVideoShotsPlan>(defaultPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [lastReadyId, setLastReadyId] = useState<string | null>(null);

  const characters: LegoCharacterRef[] = useMemo(
    () => [
      {
        id: CHAR1_ID,
        name: name1.trim() || "Девушка",
        gender: "female",
        triggerWord: null,
      },
      {
        id: CHAR2_ID,
        name: name2.trim() || "Парень",
        gender: "male",
        triggerWord: null,
      },
    ],
    [name1, name2],
  );

  const selectedCharacterIds = useMemo(
    () => [CHAR1_ID, CHAR2_ID],
    [],
  );

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/peach/quick-video/runs");
    if (!res.ok) return;
    const data = (await res.json()) as { runs?: RunRow[] };
    const list = data.runs || [];
    setRuns(list.slice(0, 12));
    const ready = list.find((r) => r.status === "ready");
    if (ready) setLastReadyId(ready.id);
  }, []);

  useEffect(() => {
    void loadRuns();
    const t = setInterval(() => void loadRuns(), 4000);
    return () => clearInterval(t);
  }, [loadRuns]);

  async function generate() {
    setError("");
    setMsg("");
    if (!file1 || !file2) {
      setError("Нужны фото героя 1 и героя 2");
      return;
    }
    const filled = plan.shots.filter((s) => s.legoQuery.trim());
    if (!filled.length) {
      setError("Заполни промпт хотя бы одного шота");
      return;
    }
    const used = sumQuickVideoShotsSec(filled);
    if (used < 4 || used > MAX_QUICK_VIDEO_TOTAL_SEC) {
      setError(`Сумма шотов ${used}с — нужно от 4 до ${MAX_QUICK_VIDEO_TOTAL_SEC}`);
      return;
    }

    const n1 = name1.trim() || "Девушка";
    const n2 = name2.trim() || "Парень";
    const shotsPlan: QuickVideoShotsPlan = {
      totalDurationSec: used,
      shots: filled,
    };

    const fd = new FormData();
    fd.set("title", title.trim() || "Мини-фильм");
    fd.set("orientation", orientation);
    fd.set("durationSec", String(used));
    fd.set("shotsJson", JSON.stringify(shotsPlan));
    fd.set("prompt", filled.map((s) => s.legoQuery).join("\n\n"));
    fd.set(
      "characterIds",
      JSON.stringify([CHAR1_ID, CHAR2_ID]),
    );
    fd.set(
      "customCharacters",
      JSON.stringify([
        { id: CHAR1_ID, name: n1 },
        { id: CHAR2_ID, name: n2 },
      ]),
    );
    fd.set(
      "slotMeta",
      JSON.stringify([
        {
          pictureIndex: 1,
          role: "identity",
          characterName: n1,
          label: n1,
        },
        {
          pictureIndex: 2,
          role: "identity",
          characterName: n2,
          label: n2,
        },
      ]),
    );
    fd.set("picture_1", file1);
    fd.set("picture_2", file2);
    if (poseVideo) fd.set("poseVideo", poseVideo);

    setBusy(true);
    try {
      const res = await fetch("/api/peach/quick-video/runs", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { run?: RunRow; error?: string };
      if (!res.ok) throw new Error(data.error || "generate failed");
      setMsg(`Запущено: ${data.run?.id || "ok"}. Жди status=ready ниже.`);
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 rounded-2xl border border-white/10 bg-[#121214]/80 p-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-zinc-400">Имя героя 1 (Picture 1)</span>
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={name1}
            onChange={(e) => setName1(e.target.value)}
          />
          <input
            type="file"
            accept="image/*"
            className="mt-2 block w-full text-xs text-zinc-400"
            onChange={(e) => setFile1(e.target.files?.[0] || null)}
          />
          {file1 ? (
            <p className="mt-1 text-[11px] text-emerald-400/90">{file1.name}</p>
          ) : null}
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Имя героя 2 (Picture 2)</span>
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={name2}
            onChange={(e) => setName2(e.target.value)}
          />
          <input
            type="file"
            accept="image/*"
            className="mt-2 block w-full text-xs text-zinc-400"
            onChange={(e) => setFile2(e.target.files?.[0] || null)}
          />
          {file2 ? (
            <p className="mt-1 text-[11px] text-emerald-400/90">{file2.name}</p>
          ) : null}
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-zinc-400">
            Видео позы / движения (опционально, одно на весь фильм)
          </span>
          <input
            type="file"
            accept="video/*"
            className="mt-1 block w-full text-xs text-zinc-400"
            onChange={(e) => setPoseVideo(e.target.files?.[0] || null)}
          />
          {poseVideo ? (
            <p className="mt-1 text-[11px] text-emerald-400/90">
              {poseVideo.name}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-zinc-600">
              Можно не загружать — шоты поедут только по тексту + фото героев.
            </p>
          )}
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Название прогона / шаблона</span>
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Ориентация</span>
          <select
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
            value={orientation}
            onChange={(e) =>
              setOrientation(e.target.value === "16_9" ? "16_9" : "9_16")
            }
          >
            <option value="9_16">9:16</option>
            <option value="16_9">16:9</option>
          </select>
        </label>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#121214]/80 p-4">
        <h2 className="text-sm font-medium text-zinc-300">Шоты</h2>
        <p className="mt-1 text-xs text-zinc-500">
          В LEGO используй имена героев ({name1 || "Девушка"} /{" "}
          {name2 || "Парень"}) или отсылки к Picture 1 / Picture 2. Сумма
          длительностей ≤ {MAX_QUICK_VIDEO_TOTAL_SEC}с.
        </p>
        <div className="mt-3">
          <QuickVideoShotsEditor
            plan={plan}
            onChange={setPlan}
            selectedCharacterIds={selectedCharacterIds}
            characters={characters}
            videoLego={videoLego}
            disabled={busy}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate()}
          className="rounded-full bg-peach/90 px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {busy ? "Запуск…" : "Сгенерировать тест"}
        </button>
        {lastReadyId ? (
          <SaveQuickVideoTemplateButton
            sourceRunId={lastReadyId}
            defaultTitle={title}
            onSaved={() =>
              setMsg(
                "Шаблон сохранён. Открой /peach/lab2/transfer → вкладка Видео · MiniMax.",
              )
            }
          />
        ) : null}
      </div>

      {error ? (
        <p className="rounded border border-red-400/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {msg ? (
        <p className="rounded border border-emerald-400/30 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-300">
          {msg}
        </p>
      ) : null}

      <section className="rounded-2xl border border-white/10 p-4">
        <h2 className="text-sm font-medium text-zinc-300">Последние прогоны</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {runs.length === 0 ? (
            <li className="text-zinc-500">Пока пусто</li>
          ) : (
            runs.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 py-2"
              >
                <div>
                  <div className="text-zinc-200">{r.title || r.id}</div>
                  <div className="text-[11px] text-zinc-500">
                    {r.status}
                    {r.durationSec ? ` · ${r.durationSec}с` : ""}
                    {r.error ? ` · ${r.error}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.status === "ready" && r.resultVideoUrl ? (
                    <a
                      href={r.resultVideoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-peach underline"
                    >
                      видео
                    </a>
                  ) : null}
                  {r.status === "ready" ? (
                    <SaveQuickVideoTemplateButton
                      sourceRunId={r.id}
                      defaultTitle={r.title || title}
                      onSaved={() =>
                        setMsg(
                          "Шаблон сохранён → /peach/lab2/transfer (Видео · MiniMax).",
                        )
                      }
                    />
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
