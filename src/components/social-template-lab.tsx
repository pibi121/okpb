"use client";

import { useCallback, useEffect, useState } from "react";
import { OrientationSelect } from "@/components/orientation-select";
import type { SocialOrientationId } from "@/lib/video-orientation";

type Character = { id: string; name: string };

type SocialTemplate = {
  id: string;
  title: string;
  notes: string;
  kreaPhotoPrompt: string;
  scenePrompt: string;
  motionPrompt: string;
  sam3Target: string;
  durationSec: number;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  published: boolean;
  status: string;
  hasDrivingVideo: boolean;
};

type SocialRun = {
  id: string;
  templateId: string | null;
  characterId: string | null;
  title: string;
  status: string;
  kreaPhotoUrl: string;
  resultVideoUrl: string;
  width: number;
  height: number;
  durationSec: number;
  error: string | null;
  engine: string | null;
  prompt?: string;
  template?: { id: string; title: string; previewVideoUrl: string };
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

const STATUS_LABEL: Record<string, string> = {
  krea_busy: "Генерирую фото…",
  awaiting_photo: "Подтверди фото",
  video_busy: "Делаю видео…",
  ready: "Готово",
  error: "Ошибка",
};

export function SocialTemplateLab({ characters }: { characters: Character[] }) {
  const [tab, setTab] = useState<"use" | "admin">("use");
  const [templates, setTemplates] = useState<SocialTemplate[]>([]);
  const [runs, setRuns] = useState<SocialRun[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [templateId, setTemplateId] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [clothed, setClothed] = useState(false);
  const [wardrobeNote, setWardrobeNote] = useState("");
  const [changeOrientation, setChangeOrientation] = useState(false);
  const [orientation, setOrientation] = useState<SocialOrientationId>("9_16");
  const [wardrobePreview, setWardrobePreview] = useState<{
    wardrobeLine: string;
    detailEn: string | null;
    source: string;
  } | null>(null);

  const [adminTitle, setAdminTitle] = useState("Новый шаблон");
  const [adminNotes, setAdminNotes] = useState("");
  const [kreaPrompt, setKreaPrompt] = useState("");
  const [scenePrompt, setScenePrompt] = useState("");
  const [motionPrompt, setMotionPrompt] = useState("");
  const [sam3Target, setSam3Target] = useState("The woman");
  const [durationSec, setDurationSec] = useState(10);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = templates.find((t) => t.id === selectedId) || null;

  const activeRun =
    runs.find((r) => r.id === activeRunId) ||
    runs.find((r) =>
      ["krea_busy", "awaiting_photo", "video_busy"].includes(r.status),
    ) ||
    null;

  const refresh = useCallback(async () => {
    const tplRes = await fetch(
      tab === "use"
        ? "/api/peach/social/templates?published=1"
        : "/api/peach/social/templates",
    );
    const tplData = await readJson(tplRes);
    if (!tplRes.ok) throw new Error(String(tplData.error || "ошибка шаблонов"));
    setTemplates((tplData.templates as SocialTemplate[]) || []);

    const runsRes = await fetch("/api/peach/social/runs");
    const runsData = await readJson(runsRes);
    if (runsRes.ok) setRuns((runsData.runs as SocialRun[]) || []);
  }, [tab]);

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : "error"));
  }, [refresh]);

  useEffect(() => {
    const polling =
      runs.some((r) =>
        ["krea_busy", "video_busy"].includes(r.status),
      ) || (activeRunId && activeRun?.status !== "ready" && activeRun?.status !== "error");
    if (!polling) return;
    const t = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 3500);
    return () => clearInterval(t);
  }, [runs, activeRunId, activeRun?.status, refresh]);

  useEffect(() => {
    if (characters.length && !characterId) {
      setCharacterId(characters[0]!.id);
    }
  }, [characters, characterId]);

  const published = templates.filter((t) => t.published);

  async function previewWardrobe() {
    if (!clothed) {
      setWardrobePreview({
        wardrobeLine:
          "WARDROBE: completely nude, naked, bare skin, no clothes…",
        detailEn: null,
        source: "nude",
      });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/social/wardrobe-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clothed: true,
          wardrobeNote: wardrobeNote.trim(),
          templateId: templateId || undefined,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setWardrobePreview({
        wardrobeLine: String(data.wardrobeLine || ""),
        detailEn: data.detailEn ? String(data.detailEn) : null,
        source: String(data.source || "fallback"),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  function parseRunWardrobePrompt(raw: string): typeof wardrobePreview {
    if (!raw?.trim()) return null;
    try {
      const j = JSON.parse(raw) as {
        wardrobeLine?: string;
        wardrobeDetailEn?: string | null;
        wardrobeSource?: string;
      };
      if (!j.wardrobeLine) return null;
      return {
        wardrobeLine: j.wardrobeLine,
        detailEn: j.wardrobeDetailEn || null,
        source: j.wardrobeSource || "run",
      };
    } catch {
      return null;
    }
  }

  async function startRun() {
    if (!templateId) {
      setError("Выбери шаблон");
      return;
    }
    if (!characterId) {
      setError("Выбери модель");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/social/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          templateId,
          characterId,
          clothed,
          wardrobeNote: clothed ? wardrobeNote.trim() : "",
          orientation: changeOrientation ? orientation : "match_photo",
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка запуска"));
      const run = data.run as SocialRun;
      setActiveRunId(run.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function approvePhoto() {
    if (!activeRun) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/peach/social/runs/${activeRun.id}?action=approve`,
        { method: "POST" },
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function regenPhoto() {
    if (!activeRun) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/peach/social/runs/${activeRun.id}?action=regen-photo`,
        { method: "POST" },
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function createTemplate() {
    if (!kreaPrompt.trim()) {
      setError("Нужен Krea photo prompt");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/social/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: adminTitle.trim() || "Social template",
          notes: adminNotes,
          kreaPhotoPrompt: kreaPrompt.trim(),
          scenePrompt: scenePrompt.trim() || undefined,
          motionPrompt: motionPrompt.trim() || undefined,
          sam3Target: sam3Target.trim() || undefined,
          durationSec,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const tpl = data.template as SocialTemplate;
      setSelectedId(tpl.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveSelectedPatch(patch: Partial<SocialTemplate>) {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/peach/social/templates/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadDriving(file: File) {
    if (!selectedId) {
      setError("Сначала создай / выбери шаблон");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("kind", "driving");
      fd.set("file", file);
      const res = await fetch(
        `/api/peach/social/templates/${selectedId}?action=upload`,
        { method: "POST", body: fd },
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "upload failed"));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function publishSelected() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/peach/social/templates/${selectedId}?action=publish`,
        { method: "POST" },
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selectedId || !confirm("Удалить шаблон?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/peach/social/templates/${selectedId}`, {
        method: "DELETE",
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setSelectedId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className={
            tab === "use"
              ? "rounded-md bg-violet-700 px-3 py-1.5 text-white"
              : "rounded-md border px-3 py-1.5"
          }
          onClick={() => setTab("use")}
        >
          Создать видео
        </button>
        <button
          type="button"
          className={
            tab === "admin"
              ? "rounded-md bg-zinc-900 px-3 py-1.5 text-white"
              : "rounded-md border px-3 py-1.5"
          }
          onClick={() => setTab("admin")}
        >
          Шаблоны (админ)
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {tab === "use" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4 rounded-lg border border-violet-200 bg-white p-4">
            <div>
              <h3 className="font-medium text-violet-900">Шаг 1 · Шаблон</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Выбери готовый ролик. Исходное видео шаблона скрыто — система
                подставит его сама.
              </p>
            </div>
            {published.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Пока нет опубликованных шаблонов. Добавь их во вкладке «Шаблоны
                (админ)».
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {published.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={
                      templateId === t.id
                        ? "rounded-lg border-2 border-violet-600 bg-violet-50 p-2 text-left"
                        : "rounded-lg border p-2 text-left hover:border-violet-300"
                    }
                  >
                    <div className="text-sm font-medium">{t.title}</div>
                    {t.previewVideoUrl ? (
                      <video
                        src={t.previewVideoUrl}
                        muted
                        playsInline
                        className="mt-2 max-h-28 w-full rounded bg-black object-cover"
                      />
                    ) : t.previewPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.previewPhotoUrl}
                        alt=""
                        className="mt-2 max-h-28 w-full rounded object-cover"
                      />
                    ) : (
                      <div className="mt-2 flex h-20 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500">
                        ~{t.durationSec}s
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div>
              <h3 className="font-medium text-violet-900">Шаг 2 · Модель</h3>
              <select
                className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
                value={characterId}
                onChange={(e) => setCharacterId(e.target.value)}
              >
                {characters.length === 0 ? (
                  <option value="">— нет персонажей —</option>
                ) : (
                  characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>

              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={clothed}
                  onChange={(e) => setClothed(e.target.checked)}
                />
                Одежда
              </label>
              {clothed ? (
                <>
                  <textarea
                    className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
                    rows={2}
                    value={wardrobeNote}
                    onChange={(e) => {
                      setWardrobeNote(e.target.value);
                      setWardrobePreview(null);
                    }}
                    placeholder="По-русски или по-английски: розовый топик и трусики, только шорты, часы на руке…"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void previewWardrobe()}
                    className="mt-2 rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Проверить промпт одежды (LLM)
                  </button>
                  {wardrobePreview ? (
                    <div className="mt-2 rounded border border-violet-100 bg-violet-50 p-2 text-xs text-zinc-700">
                      <div className="font-medium text-violet-800">
                        {wardrobePreview.source === "llm"
                          ? "LLM · English"
                          : wardrobePreview.source === "nude"
                            ? "Голая"
                            : "Fallback (LLM недоступен)"}
                      </div>
                      {wardrobePreview.detailEn ? (
                        <p className="mt-1 italic">{wardrobePreview.detailEn}</p>
                      ) : null}
                      <p className="mt-1 font-mono text-[10px] leading-snug opacity-80">
                        {wardrobePreview.wardrobeLine}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-zinc-500">
                      LLM развернёт описание на английском. Без LLM — базовый
                      шаблон (можно тестировать текстом кнопкой выше).
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">
                  Без галочки модель будет голой.
                </p>
              )}

              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={changeOrientation}
                  onChange={(e) => setChangeOrientation(e.target.checked)}
                />
                Изменить ориентацию
              </label>
              {changeOrientation ? (
                <div className="mt-2 space-y-2">
                  <OrientationSelect
                    mode="social"
                    includeMatch
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={orientation}
                    onChange={setOrientation}
                  />
                  <p className="text-xs text-amber-800">
                    При смене ориентации действия на видео могут сильно
                    измениться относительно исходного шаблона.
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">
                  По умолчанию ориентация видео = как на сгенерированном фото.
                </p>
              )}
            </div>

            <div>
              <h3 className="font-medium text-violet-900">Шаг 3 · Генерация</h3>
              <button
                type="button"
                disabled={busy || !templateId || !characterId}
                onClick={() => void startRun()}
                className="mt-2 w-full rounded-md bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {busy ? "Запускаю…" : "Сгенерировать"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border bg-white p-4">
            <h3 className="font-medium">Прогресс</h3>
            {!activeRun ? (
              <p className="text-sm text-zinc-500">
                После запуска здесь появится фото для проверки, затем итоговое
                видео.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  <div className="font-medium">{activeRun.title}</div>
                  <div className="text-xs text-zinc-500">
                    {STATUS_LABEL[activeRun.status] || activeRun.status}
                    {activeRun.engine ? ` · ${activeRun.engine}` : ""}
                  </div>
                  {activeRun.error ? (
                    <p className="mt-1 text-xs text-red-600">{activeRun.error}</p>
                  ) : null}
                </div>

                {activeRun.kreaPhotoUrl ? (
                  <div className="space-y-2">
                    {(() => {
                      const wp = parseRunWardrobePrompt(activeRun.prompt || "");
                      return wp ? (
                        <div className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs">
                          <div className="font-medium">
                            Одежда в промпте ({wp.source})
                          </div>
                          {wp.detailEn ? (
                            <p className="mt-1 italic">{wp.detailEn}</p>
                          ) : null}
                        </div>
                      ) : null;
                    })()}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeRun.kreaPhotoUrl}
                      alt="Krea still"
                      className="max-h-80 w-full rounded border object-contain bg-zinc-50"
                    />
                    {activeRun.status === "awaiting_photo" ||
                    (activeRun.status === "error" && activeRun.kreaPhotoUrl) ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void approvePhoto()}
                          className="rounded-md bg-green-700 px-3 py-2 text-sm text-white disabled:opacity-50"
                        >
                          {activeRun.status === "error"
                            ? "Повторить видео"
                            : "Норм · делай видео"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void regenPhoto()}
                          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                        >
                          Перегенерировать фото
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : activeRun.status === "krea_busy" ? (
                  <p className="text-xs text-violet-700">
                    Krea рисует кадр модели… обычно 1–2 минуты
                  </p>
                ) : null}

                {activeRun.resultVideoUrl ? (
                  <video
                    src={activeRun.resultVideoUrl}
                    controls
                    className="max-h-72 w-full rounded border bg-black"
                  />
                ) : activeRun.status === "video_busy" ? (
                  <p className="text-xs text-violet-700">
                    MiniMax Ref2VA READY… обычно ~5–7 минут
                  </p>
                ) : null}
              </div>
            )}

            {runs.length > 0 ? (
              <div className="border-t pt-3">
                <h4 className="text-sm font-medium text-zinc-700">История</h4>
                <ul className="mt-2 max-h-40 divide-y overflow-y-auto text-xs">
                  {runs.slice(0, 8).map((r) => (
                    <li key={r.id} className="py-2">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setActiveRunId(r.id)}
                      >
                        {r.title} · {STATUS_LABEL[r.status] || r.status}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-white p-4">
            <h3 className="font-medium text-violet-800">Новый шаблон</h3>
            <p className="text-xs text-zinc-500">
              Загрузи driving-видео (скрыто от пользователя), зафиксируй Krea
              prompt для кадра модели. После ручной проверки — опубликуй.
            </p>

            <label className="flex flex-col gap-1 text-sm">
              Название
              <input
                className="rounded-md border px-3 py-2"
                value={adminTitle}
                onChange={(e) => setAdminTitle(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Заметки
              <textarea
                className="rounded-md border px-3 py-2"
                rows={2}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Krea photo prompt *
              <textarea
                className="rounded-md border px-3 py-2 font-mono text-xs"
                rows={4}
                value={kreaPrompt}
                onChange={(e) => setKreaPrompt(e.target.value)}
                placeholder="full body shot, same pose as template, ..."
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Scene prompt (опц.)
              <textarea
                className="rounded-md border px-3 py-2 font-mono text-xs"
                rows={2}
                value={scenePrompt}
                onChange={(e) => setScenePrompt(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Motion prompt (опц.)
              <textarea
                className="rounded-md border px-3 py-2 font-mono text-xs"
                rows={2}
                value={motionPrompt}
                onChange={(e) => setMotionPrompt(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm">
                SAM3 target
                <input
                  className="rounded-md border px-3 py-2 text-sm"
                  value={sam3Target}
                  onChange={(e) => setSam3Target(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Длительность (сек)
                <input
                  type="number"
                  min={3}
                  max={12}
                  className="rounded-md border px-3 py-2"
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value) || 10)}
                />
              </label>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void createTemplate()}
              className="rounded-md bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Создать шаблон
            </button>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border bg-white p-4">
            <h3 className="font-medium">Мои шаблоны</h3>
            <ul className="divide-y text-sm">
              {templates.length === 0 ? (
                <li className="py-2 text-zinc-500">Пока пусто</li>
              ) : (
                templates.map((t) => (
                  <li key={t.id} className="py-2">
                    <button
                      type="button"
                      className={
                        selectedId === t.id
                          ? "font-medium text-violet-800"
                          : "hover:underline"
                      }
                      onClick={() => {
                        setSelectedId(t.id);
                        setKreaPrompt(t.kreaPhotoPrompt);
                        setScenePrompt(t.scenePrompt);
                        setMotionPrompt(t.motionPrompt);
                        setSam3Target(t.sam3Target);
                        setDurationSec(t.durationSec);
                        setAdminTitle(t.title);
                        setAdminNotes(t.notes);
                      }}
                    >
                      {t.title}{" "}
                      <span className="text-xs text-zinc-500">
                        · {t.status}
                        {t.published ? " · live" : ""}
                        {t.hasDrivingVideo ? " · video ✓" : " · no video"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>

            {selected ? (
              <div className="flex flex-col gap-3 border-t pt-3">
                <label className="flex flex-col gap-1 text-sm">
                  Driving video (скрыто от пользователя)
                  <input
                    type="file"
                    accept="video/*"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadDriving(f);
                      e.target.value = "";
                    }}
                  />
                </label>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void saveSelectedPatch({
                      title: adminTitle,
                      notes: adminNotes,
                      kreaPhotoPrompt: kreaPrompt,
                      scenePrompt,
                      motionPrompt,
                      sam3Target,
                      durationSec,
                    })
                  }
                  className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                >
                  Сохранить поля
                </button>

                {!selected.published ? (
                  <button
                    type="button"
                    disabled={busy || !selected.hasDrivingVideo}
                    onClick={() => void publishSelected()}
                    className="rounded-md bg-green-700 px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    Опубликовать для пользователей
                  </button>
                ) : (
                  <p className="text-xs text-green-700">Шаблон опубликован</p>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteSelected()}
                  className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700"
                >
                  Удалить
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
