"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SaveQuickVideoTemplateButton } from "@/components/save-quick-video-template-button";
import {
  MAX_STORY_H3_SHOTS,
  storyH3LooksStructured,
} from "@/lib/story-h3-prompt";

type RunRow = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  resultVideoUrl?: string | null;
  durationSec?: number;
  createdAt?: string;
  engine?: string | null;
};

type ShotRow = {
  id: string;
  durationSec: number;
  prompt: string;
  runId: string | null;
};

const CHAR1_ID = "custom:hero1";
const CHAR2_ID = "custom:hero2";
const MAX_SHOTS = MAX_STORY_H3_SHOTS;
const MIN_SHOT_SEC = 4;
const MAX_SHOT_SEC = 12;
const DRAFT_KEY = "lab2-mini-film-draft-v1";

const AI_BRIEF = `Работай строго по прикреплённой инструкции (рефинстр / referensguide).
Верни ТОЛЬКО готовый 6-секционный промпт:
subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music.
Без пояснений и альтернатив.

Контекст Peachbitch (шаблон мини-фильма, 2 героя):
- В проде пользователь подставит СВОИ фото в слоты identity.
- Контракт слотов:
  • <Picture 1> = identity героя 1 (девушка) — лицо/волосы/кожа/тело с фото пользователя. Конкретных черт НЕ выдумывай.
  • <Picture 2> = identity героя 2 (парень) — то же.
  • <Video 1> = опциональный motion/pose ref (только если я скажу, что будет видео позы).
  • <Subject 1> = герой 1 из <Picture 1>, fully_preserved.
  • <Subject 2> = герой 2 из <Picture 2>, fully_preserved.
- Длительность до 12 сек на шот. Формат 9:16 (если не скажу иначе).
- Диалоги: естественный русский в <d>[Russian] …</d>, спикеры (S1)/(S2).
- Можно писать один полный H3 на весь фильм или отдельный H3/описание на каждый шот.

Пока я не пришлю бриф сцены — не пиши финальный промпт. Спроси коротко, чего не хватает, или жди.

Когда пришлю детали (сюжет, локация, одежда/состояние, камера, речь, тайминги шотов, NSFW, music/N/A) — выдай только 6 секций.`;

function newShotId() {
  return `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultShots(): ShotRow[] {
  return [
    { id: newShotId(), durationSec: 6, prompt: "", runId: null },
    { id: newShotId(), durationSec: 6, prompt: "", runId: null },
  ];
}

function wrapShotPrompt(
  raw: string,
  opts: { name1: string; name2: string; durationSec: number; shotIndex: number },
): string {
  const text = raw.trim();
  if (storyH3LooksStructured(text)) return text;
  const n1 = opts.name1 || "Девушка";
  const n2 = opts.name2 || "Парень";
  return [
    "subject_definitions:",
    `<Subject 1> is the woman from <Picture 1> (${n1}); preserve recognizable facial identity, hair, skin, and body from the picture; do not invent traits.`,
    `<Subject 2> is the man from <Picture 2> (${n2}); preserve recognizable facial identity, hair, skin, and body from the picture; do not invent traits.`,
    `<Picture 1> is ${n1}'s identity reference.`,
    `<Picture 2> is ${n2}'s identity reference.`,
    "",
    "summary:",
    `[reference generation] A ${opts.durationSec}s shot ${opts.shotIndex + 1} with <Subject 1> and <Subject 2>, identity fully preserved from <Picture 1> and <Picture 2>.`,
    "",
    "retention_analysis:",
    "<Subject 1> (throughout): fully_preserved — facial identity, hair, skin, body from <Picture 1>.",
    "<Subject 2> (throughout): fully_preserved — facial identity, hair, skin, body from <Picture 2>.",
    "",
    "detailed_description:",
    "High-quality cinematic realism with natural skin texture, believable motion, and stable identity.",
    "",
    `[Shot 1] ${text}`,
    "",
    "overall_soundscape:",
    "Natural room tone and diegetic sounds matching the visible action.",
    "",
    "non_diegetic_music:",
    "N/A",
  ].join("\n");
}

function composeFilmPrompt(shots: ShotRow[], name1: string, name2: string): string {
  const filled = shots.filter((s) => s.prompt.trim());
  if (filled.length === 1 && storyH3LooksStructured(filled[0]!.prompt)) {
    return filled[0]!.prompt.trim();
  }
  if (filled.every((s) => storyH3LooksStructured(s.prompt))) {
    // Prefer first full H3; append other shot bodies into a note in detailed_description is messy —
    // join detailed shot texts under one H3 shell.
  }
  const n1 = name1 || "Девушка";
  const n2 = name2 || "Парень";
  let cursor = 0;
  const shotBlocks = filled.map((s, i) => {
    const start = cursor;
    cursor += s.durationSec;
    const body = s.prompt.trim();
    const extracted = storyH3LooksStructured(body)
      ? body
          .split(/detailed_description\s*:\s*/i)[1]
          ?.split(/\n(?:overall_soundscape|non_diegetic_music)\s*:/i)[0]
          ?.trim() || body
      : body;
    const ts =
      i === 0
        ? `[Shot 1]`
        : `[Shot ${i + 1}] At ${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}.000,`;
    return `${ts} ${extracted.replace(/^\[Shot[^\]]*\]\s*/i, "")}`;
  });
  return [
    "subject_definitions:",
    `<Subject 1> is the woman from <Picture 1> (${n1}); preserve identity from the picture.`,
    `<Subject 2> is the man from <Picture 2> (${n2}); preserve identity from the picture.`,
    `<Picture 1> is ${n1}'s identity reference.`,
    `<Picture 2> is ${n2}'s identity reference.`,
    "",
    "summary:",
    `[reference generation] Multi-shot mini-film with <Subject 1> and <Subject 2>, identity fully preserved.`,
    "",
    "retention_analysis:",
    "<Subject 1> (throughout): fully_preserved.",
    "<Subject 2> (throughout): fully_preserved.",
    "",
    "detailed_description:",
    "High-quality cinematic realism with natural skin texture, believable motion, and stable identity.",
    "",
    shotBlocks.join("\n\n"),
    "",
    "overall_soundscape:",
    "Natural room tone and diegetic sounds matching the visible action.",
    "",
    "non_diegetic_music:",
    "N/A",
  ].join("\n");
}

export function Lab2MiniFilmClient() {
  const [name1, setName1] = useState("Девушка");
  const [name2, setName2] = useState("Парень");
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [poseVideo, setPoseVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("Мини-фильм");
  const [orientation, setOrientation] = useState<"9_16" | "16_9">("9_16");
  const [shots, setShots] = useState<ShotRow[]>(defaultShots);
  const [busyShotId, setBusyShotId] = useState<string | null>(null);
  const [stitchBusy, setStitchBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [briefCopied, setBriefCopied] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [stitchRunId, setStitchRunId] = useState<string | null>(null);

  const runById = useMemo(() => {
    const m = new Map<string, RunRow>();
    for (const r of runs) m.set(r.id, r);
    return m;
  }, [runs]);

  const readyShotRuns = shots
    .map((s) => (s.runId ? runById.get(s.runId) : null))
    .filter((r): r is RunRow => !!r && r.status === "ready" && !!r.resultVideoUrl);

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/peach/quick-video/runs");
    if (!res.ok) return;
    const data = (await res.json()) as { runs?: RunRow[] };
    setRuns(data.runs || []);
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const j = JSON.parse(raw) as {
          title?: string;
          name1?: string;
          name2?: string;
          orientation?: "9_16" | "16_9";
          stitchRunId?: string | null;
          shots?: ShotRow[];
        };
        if (typeof j.title === "string") setTitle(j.title);
        if (typeof j.name1 === "string") setName1(j.name1);
        if (typeof j.name2 === "string") setName2(j.name2);
        if (j.orientation === "9_16" || j.orientation === "16_9") {
          setOrientation(j.orientation);
        }
        if (typeof j.stitchRunId === "string" || j.stitchRunId === null) {
          setStitchRunId(j.stitchRunId);
        }
        if (Array.isArray(j.shots) && j.shots.length >= 1) {
          setShots(
            j.shots.slice(0, MAX_SHOTS).map((s) => ({
              id: typeof s.id === "string" ? s.id : newShotId(),
              durationSec: Math.min(
                MAX_SHOT_SEC,
                Math.max(MIN_SHOT_SEC, Number(s.durationSec) || 6),
              ),
              prompt: typeof s.prompt === "string" ? s.prompt : "",
              runId: typeof s.runId === "string" ? s.runId : null,
            })),
          );
        }
      }
    } catch {
      /* ignore */
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          title,
          name1,
          name2,
          orientation,
          stitchRunId,
          shots,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [draftReady, title, name1, name2, orientation, stitchRunId, shots]);

  useEffect(() => {
    void loadRuns();
    const t = setInterval(() => void loadRuns(), 4000);
    return () => clearInterval(t);
  }, [loadRuns]);

  function patchShot(id: string, patch: Partial<ShotRow>) {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addShot() {
    if (shots.length >= MAX_SHOTS) return;
    setShots((prev) => [
      ...prev,
      { id: newShotId(), durationSec: 6, prompt: "", runId: null },
    ]);
  }

  function removeShot(id: string) {
    setShots((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  }

  function moveShot(id: string, dir: -1 | 1) {
    setShots((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
  }

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(AI_BRIEF);
      setBriefCopied(true);
      setTimeout(() => setBriefCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать бриф");
    }
  }

  async function generateShot(shot: ShotRow, index: number) {
    setError("");
    setMsg("");
    if (!file1 || !file2) {
      setError("Нужны фото героя 1 и героя 2");
      return;
    }
    if (!shot.prompt.trim()) {
      setError(`Шот ${index + 1}: пустой промпт`);
      return;
    }
    const n1 = name1.trim() || "Девушка";
    const n2 = name2.trim() || "Парень";
    const text = wrapShotPrompt(shot.prompt, {
      name1: n1,
      name2: n2,
      durationSec: shot.durationSec,
      shotIndex: index,
    });

    const fd = new FormData();
    fd.set("title", `${title.trim() || "Мини-фильм"} · шот ${index + 1}`);
    fd.set("orientation", orientation);
    fd.set("durationSec", String(shot.durationSec));
    fd.set("storyH3", "1");
    fd.set("prompt", text);
    fd.set("characterIds", JSON.stringify([CHAR1_ID, CHAR2_ID]));
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

    setBusyShotId(shot.id);
    try {
      const res = await fetch("/api/peach/quick-video/runs", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { run?: RunRow; error?: string };
      if (!res.ok) throw new Error(data.error || "generate failed");
      const runId = data.run?.id || null;
      if (runId) patchShot(shot.id, { runId });
      setMsg(`Шот ${index + 1} запущен: ${runId || "ok"}. Жди ready.`);
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusyShotId(null);
    }
  }

  async function stitchShots() {
    setError("");
    setMsg("");
    const readyRows = shots.filter((s) => {
      if (!s.runId) return false;
      const r = runById.get(s.runId);
      return !!r && r.status === "ready" && !!r.resultVideoUrl;
    });
    if (readyRows.length < 2) {
      setError("Нужны минимум 2 готовых шота для склейки");
      return;
    }
    const pending = shots.length - readyRows.length;
    if (pending > 0) {
      setError(
        `Есть ${pending} шот(ов) без готового видео — сначала сгенерируй их, потом склей все ${shots.length}.`,
      );
      return;
    }
    const ids = readyRows.map((s) => s.runId!);
    setStitchBusy(true);
    try {
      const res = await fetch("/api/peach/quick-video/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runIds: ids,
          title: title.trim() || "Мини-фильм",
          prompt: composeFilmPrompt(shots, name1.trim(), name2.trim()),
          shots: readyRows.map((s) => ({
            durationSec: s.durationSec,
            prompt: s.prompt.trim(),
          })),
        }),
      });
      const data = (await res.json()) as {
        run?: RunRow;
        error?: string;
        engine?: string;
      };
      if (!res.ok) throw new Error(data.error || "stitch failed");
      setStitchRunId(data.run?.id || null);
      setMsg(
        `Склеено (${data.engine || "ok"}): ${data.run?.id || ""}. Старые клипы не перегенерировались. Можно сохранить шаблон.`,
      );
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ошибка склейки");
    } finally {
      setStitchBusy(false);
    }
  }

  async function restoreShotsFromStitch(runId: string) {
    setError("");
    setMsg("");
    const id = runId.trim();
    if (!id) {
      setError("Нужен id склейки (stitch run)");
      return;
    }
    setRestoreBusy(true);
    try {
      const res = await fetch(
        `/api/peach/quick-video/stitch?runId=${encodeURIComponent(id)}`,
      );
      const data = (await res.json()) as {
        error?: string;
        title?: string;
        stitchRunId?: string;
        shots?: Array<{
          runId: string;
          durationSec: number;
          prompt: string;
        }>;
      };
      if (!res.ok) throw new Error(data.error || "restore failed");
      const next = (data.shots || []).slice(0, MAX_SHOTS).map((s) => ({
        id: newShotId(),
        durationSec: Math.min(
          MAX_SHOT_SEC,
          Math.max(MIN_SHOT_SEC, Number(s.durationSec) || 6),
        ),
        prompt: s.prompt || "",
        runId: s.runId || null,
      }));
      if (next.length < 1) throw new Error("в склейке нет шотов");
      setShots(next);
      setStitchRunId(data.stitchRunId || id);
      if (data.title) setTitle(data.title);
      setMsg(
        `Восстановлено ${next.length} шотов из склейки (клипы на месте). Добавь новый шот → сгенерируй только его → склей снова.`,
      );
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ошибка восстановления");
    } finally {
      setRestoreBusy(false);
    }
  }

  const latestStitchRun = useMemo(() => {
    return (
      runs.find((r) => {
        if (r.status !== "ready") return false;
        const eng = (r.engine || "").toLowerCase();
        if (eng.includes("concat") || eng.includes("stitch") || eng.includes("autoedit")) {
          return true;
        }
        return /склей|мини-фильм|mini.?film/i.test(r.title || "");
      }) || null
    );
  }, [runs]);

  const totalSec = shots.reduce((a, s) => a + s.durationSec, 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-white/10 bg-[#121214]/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">
              Бриф для ИИ (промпт-райтер)
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Прикрепи рефинстр.md + этот бриф. Готовый H3 вставляй в шот(ы)
              ниже — без LEGO-табов.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyBrief()}
            className="rounded-full border border-peach/40 bg-peach/10 px-3 py-1.5 text-xs text-peach hover:bg-peach/20"
          >
            {briefCopied ? "Скопировано" : "Скопировать бриф"}
          </button>
        </div>
        <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/40 p-3 text-[11px] leading-relaxed text-zinc-400">
          {AI_BRIEF}
        </pre>
      </section>

      <section className="grid gap-4 rounded-2xl border border-white/10 bg-[#121214]/80 p-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-zinc-400">Имя героя 1 (Picture 1)</span>
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-foreground"
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
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-foreground"
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
            Видео позы / движения (опционально → Video 1, на все шоты)
          </span>
          <input
            type="file"
            accept="video/*"
            className="mt-1 block w-full text-xs text-zinc-400"
            onChange={(e) => setPoseVideo(e.target.files?.[0] || null)}
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Название</span>
          <input
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-foreground"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Ориентация</span>
          <select
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-foreground"
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">Шоты</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Генерируй каждый шот отдельно (4–12с), потом склей. Сумма сейчас{" "}
              {totalSec}с · до {MAX_SHOTS} шотов. В поле — полный H3 или текст
              шота с &lt;Picture 1/2&gt;.
            </p>
          </div>
          <button
            type="button"
            disabled={shots.length >= MAX_SHOTS || !!busyShotId || stitchBusy}
            onClick={addShot}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs hover:border-peach/40 disabled:opacity-40"
          >
            + Шот
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {shots.map((shot, index) => {
            const run = shot.runId ? runById.get(shot.runId) : null;
            const busy = busyShotId === shot.id;
            return (
              <div
                key={shot.id}
                className="rounded-xl border border-white/10 bg-[#0c0c0e] p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">
                    Шот {index + 1}
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                    сек
                    <input
                      type="number"
                      min={MIN_SHOT_SEC}
                      max={MAX_SHOT_SEC}
                      disabled={busy || stitchBusy}
                      value={shot.durationSec}
                      onChange={(e) =>
                        patchShot(shot.id, {
                          durationSec: Math.min(
                            MAX_SHOT_SEC,
                            Math.max(
                              MIN_SHOT_SEC,
                              Number(e.target.value) || MIN_SHOT_SEC,
                            ),
                          ),
                        })
                      }
                      className="w-14 rounded border border-white/10 bg-[#121214] px-2 py-1 text-sm text-foreground"
                    />
                  </label>
                  {run ? (
                    <span className="text-[11px] text-zinc-500">
                      {run.status}
                      {run.error ? ` · ${run.error}` : ""}
                    </span>
                  ) : null}
                  <div className="ml-auto flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={busy || stitchBusy || index === 0}
                      onClick={() => moveShot(shot.id, -1)}
                      className="rounded border border-white/10 px-2 py-0.5 text-xs disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy || stitchBusy || index === shots.length - 1
                      }
                      onClick={() => moveShot(shot.id, 1)}
                      className="rounded border border-white/10 px-2 py-0.5 text-xs disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={busy || stitchBusy || shots.length <= 1}
                      onClick={() => removeShot(shot.id)}
                      className="rounded border border-white/10 px-2 py-0.5 text-xs text-red-300 disabled:opacity-40"
                    >
                      ×
                    </button>
                    <button
                      type="button"
                      disabled={busy || stitchBusy || !!busyShotId}
                      onClick={() => void generateShot(shot, index)}
                      className="rounded-full bg-peach/90 px-3 py-0.5 text-xs font-medium text-black disabled:opacity-40"
                    >
                      {busy ? "…" : "Сгенерировать шот"}
                    </button>
                    {run?.status === "ready" && run.resultVideoUrl ? (
                      <a
                        href={run.resultVideoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-peach/40 px-3 py-0.5 text-xs text-peach"
                      >
                        видео
                      </a>
                    ) : null}
                  </div>
                </div>
                <textarea
                  value={shot.prompt}
                  disabled={busy || stitchBusy}
                  onChange={(e) =>
                    patchShot(shot.id, { prompt: e.target.value, runId: null })
                  }
                  rows={10}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground"
                  placeholder={
                    "subject_definitions:\n...\n\ndetailed_description:\n[Shot 1] …\n\nили короткий текст шота с <Picture 1>/<Picture 2>"
                  }
                />
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={
              stitchBusy ||
              restoreBusy ||
              readyShotRuns.length < 2 ||
              !!busyShotId ||
              readyShotRuns.length !== shots.length
            }
            onClick={() => void stitchShots()}
            className="rounded-full border border-peach/50 bg-peach/15 px-5 py-2 text-sm text-peach disabled:opacity-40"
          >
            {stitchBusy
              ? "Склеиваю…"
              : `Склеить готовые шоты (${readyShotRuns.length}/${shots.length})`}
          </button>
          <button
            type="button"
            disabled={
              restoreBusy ||
              stitchBusy ||
              !!busyShotId ||
              !(stitchRunId || latestStitchRun?.id)
            }
            onClick={() =>
              void restoreShotsFromStitch(stitchRunId || latestStitchRun?.id || "")
            }
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:border-peach/40 disabled:opacity-40"
            title="Подтянуть промпты и runId готовых клипов из последней склейки — без регена"
          >
            {restoreBusy ? "Восстанавливаю…" : "Вернуть шоты из склейки"}
          </button>
          {stitchRunId ? (
            <SaveQuickVideoTemplateButton
              sourceRunId={stitchRunId}
              defaultTitle={title}
              onSaved={() =>
                setMsg(
                  "Шаблон сохранён → /peach/lab2/transfer (Видео · MiniMax).",
                )
              }
            />
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Новый шот: «+ Шот» → сгенерируй только его → «Склеить». Старые клипы
          не пересчитываются. Черновик шотов держится в этой вкладке
          (sessionStorage).
        </p>
      </section>

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

      {stitchRunId ? (
        <section className="rounded-2xl border border-white/10 p-4">
          <h2 className="text-sm font-medium text-zinc-300">Склейка</h2>
          {(() => {
            const r = runById.get(stitchRunId);
            if (!r) return <p className="mt-2 text-sm text-zinc-500">…</p>;
            return (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-zinc-300">{r.title}</span>
                {r.resultVideoUrl ? (
                  <a
                    href={r.resultVideoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-peach underline"
                  >
                    смотреть
                  </a>
                ) : null}
              </div>
            );
          })()}
        </section>
      ) : null}
    </div>
  );
}
