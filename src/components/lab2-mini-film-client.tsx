"use client";

import { useCallback, useEffect, useState } from "react";
import { SaveQuickVideoTemplateButton } from "@/components/save-quick-video-template-button";
import { storyH3LooksStructured } from "@/lib/story-h3-prompt";

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
- Длительность до 12 сек. Формат 9:16 (если не скажу иначе).
- Диалоги: естественный русский в <d>[Russian] …</d>, спикеры (S1)/(S2).
- Стиль/качество — из гайда; NSFW — по гайду, без эвфемизмов если сцена интимная.

Пока я не пришлю бриф сцены — не пиши финальный промпт. Спроси коротко, чего не хватает, или жди.

Когда пришлю детали (сюжет, локация, одежда/состояние, камера, речь, тайминги шотов, NSFW, music/N/A) — выдай только 6 секций.`;

export function Lab2MiniFilmClient() {
  const [name1, setName1] = useState("Девушка");
  const [name2, setName2] = useState("Парень");
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [poseVideo, setPoseVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("Мини-фильм");
  const [orientation, setOrientation] = useState<"9_16" | "16_9">("9_16");
  const [durationSec, setDurationSec] = useState(8);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [briefCopied, setBriefCopied] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [lastReadyId, setLastReadyId] = useState<string | null>(null);

  const promptLen = prompt.trim().length;
  const structured = promptLen >= 80 && storyH3LooksStructured(prompt);

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

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(AI_BRIEF);
      setBriefCopied(true);
      setTimeout(() => setBriefCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать бриф");
    }
  }

  async function generate() {
    setError("");
    setMsg("");
    if (!file1 || !file2) {
      setError("Нужны фото героя 1 и героя 2");
      return;
    }
    const text = prompt.trim();
    if (text.length < 80) {
      setError("Вставь полный H3-промпт (минимум ~80 символов)");
      return;
    }
    if (text.length > 24000) {
      setError("Промпт слишком длинный (макс ~24k)");
      return;
    }

    const n1 = name1.trim() || "Девушка";
    const n2 = name2.trim() || "Парень";

    const fd = new FormData();
    fd.set("title", title.trim() || "Мини-фильм");
    fd.set("orientation", orientation);
    fd.set("durationSec", String(durationSec));
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

    setBusy(true);
    try {
      const res = await fetch("/api/peach/quick-video/runs", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { run?: RunRow; error?: string };
      if (!res.ok) throw new Error(data.error || "generate failed");
      setMsg(
        `Запущено: ${data.run?.id || "ok"}. Жди status=ready ниже.` +
          (structured
            ? ""
            : " Промпт слабо похож на 6 секций H3 — лучше полный вывод ИИ."),
      );
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-white/10 bg-[#121214]/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">
              Бриф для ИИ (промпт-райтер)
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Прикрепи рефинстр.md + этот бриф. Детали сцены — следующим
              сообщением. Ответ ИИ вставь в поле ниже.
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
            Видео позы / движения (опционально → Video 1)
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
              Можно не загружать — сцена только по H3-промпту + фото героев.
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
        <label className="text-sm sm:col-span-2">
          <span className="text-zinc-400">Длительность: {durationSec}s</span>
          <input
            type="range"
            min={4}
            max={12}
            value={durationSec}
            disabled={busy}
            className="mt-2 block w-full max-w-md"
            onChange={(e) => setDurationSec(Number(e.target.value))}
          />
        </label>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#121214]/80 p-4">
        <label className="block text-sm">
          <span className="font-medium text-zinc-300">
            Полный H3-промпт (6 секций)
          </span>
          <p className="mt-1 text-xs text-zinc-500">
            Без LEGO-табов. Пиши{" "}
            <code className="text-zinc-400">&lt;Picture 1&gt;</code> /{" "}
            <code className="text-zinc-400">&lt;Picture 2&gt;</code> /{" "}
            <code className="text-zinc-400">&lt;Subject N&gt;</code>. При
            генерации система подставит загруженные фото в эти слоты; в шаблон
            identity не запекается.
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            rows={18}
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-100"
            placeholder={
              "subject_definitions:\n...\n\nsummary:\n...\n\nretention_analysis:\n...\n\ndetailed_description:\n...\n\noverall_soundscape:\n...\n\nnon_diegetic_music:\nN/A"
            }
          />
          <span className="mt-1 block text-[11px] text-zinc-600">
            {promptLen} символов
            {promptLen >= 80
              ? structured
                ? " · структура H3 ок"
                : " · слабо похоже на 6 секций"
              : ""}
          </span>
        </label>
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
