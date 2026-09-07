"use client";

import { useCallback, useEffect, useState } from "react";

type MotionTemplate = {
  id: string;
  title: string;
  notes: string;
  drivingVideoUrl: string;
  referenceImageUrl: string;
  resultVideoUrl: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  status: string;
  published: boolean;
  error: string | null;
  engine: string | null;
};

type MotionRun = {
  id: string;
  templateId: string;
  referenceImageUrl: string;
  resultVideoUrl: string;
  status: string;
  error: string | null;
};

type Character = { id: string; name: string };

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function SocialMotionLab({ characters }: { characters: Character[] }) {
  const [tab, setTab] = useState<"use" | "admin">("admin");
  const [templates, setTemplates] = useState<MotionTemplate[]>([]);
  const [runs, setRuns] = useState<MotionRun[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Admin form
  const [title, setTitle] = useState("Танец · тест");
  const [notes, setNotes] = useState("");
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = templates.find((t) => t.id === selectedId) || null;

  // User form
  const [useTemplateId, setUseTemplateId] = useState("");
  const [useCharacterId, setUseCharacterId] = useState("");
  const [galleryStills, setGalleryStills] = useState<
    { id: string; title: string | null; resultUrl: string }[]
  >([]);
  const [useStillUrl, setUseStillUrl] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/peach/motion");
    const data = await readJson(res);
    if (!res.ok) throw new Error(String(data.error || "ошибка списка"));
    setTemplates((data.templates as MotionTemplate[]) || []);
    const runsRes = await fetch("/api/peach/motion/runs");
    const runsData = await readJson(runsRes);
    if (runsRes.ok) setRuns((runsData.runs as MotionRun[]) || []);
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : "error"));
  }, [refresh]);

  useEffect(() => {
    const anyBusy =
      templates.some((t) => t.status === "generating") ||
      runs.some((r) => r.status === "busy");
    if (!anyBusy) return;
    const t = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [templates, runs, refresh]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/peach/gallery");
      const data = await readJson(res);
      if (!res.ok) return;
      const items = (data.items as { id: string; kind: string; title: string | null; resultUrl: string }[]) || [];
      setGalleryStills(
        items.filter((i) => i.kind === "photo").slice(0, 40).map((i) => ({
          id: i.id,
          title: i.title,
          resultUrl: i.resultUrl,
        })),
      );
    })();
  }, []);

  async function createTemplate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/motion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Motion template",
          notes,
          ...(positive.trim() ? { positivePrompt: positive.trim() } : {}),
          ...(negative.trim() ? { negativePrompt: negative.trim() } : {}),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      const tpl = data.template as MotionTemplate;
      setSelectedId(tpl.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(kind: "driving" | "reference", file: File) {
    if (!selectedId) {
      setError("Сначала создай / выбери шаблон");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      const res = await fetch(`/api/peach/motion/${selectedId}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "upload failed"));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function generateSelected() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/peach/motion/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
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

  async function togglePublish() {
    if (!selectedId || !selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/peach/motion/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: selected.published ? "unpublish" : "publish",
        }),
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

  async function runAsUser(file?: File | null) {
    if (!useTemplateId) {
      setError("Выбери шаблон");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (file) {
        const fd = new FormData();
        fd.set("templateId", useTemplateId);
        if (useCharacterId) fd.set("characterId", useCharacterId);
        fd.set("file", file);
        const res = await fetch("/api/peach/motion/runs", { method: "POST", body: fd });
        const data = await readJson(res);
        if (!res.ok) throw new Error(String(data.error || "ошибка"));
      } else {
        if (!useStillUrl) throw new Error("Выбери фото из галереи или загрузи с ПК");
        const res = await fetch("/api/peach/motion/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: useTemplateId,
            referenceImageUrl: useStillUrl,
            characterId: useCharacterId || null,
          }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(String(data.error || "ошибка"));
      }
      await refresh();
      setTab("use");
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  const published = templates.filter((t) => t.published || t.status === "ready");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className={
            tab === "use"
              ? "rounded-md bg-zinc-900 px-3 py-1.5 text-white"
              : "rounded-md border px-3 py-1.5"
          }
          onClick={() => setTab("use")}
        >
          Шаблоны (пользователь)
        </button>
        <button
          type="button"
          className={
            tab === "admin"
              ? "rounded-md bg-violet-700 px-3 py-1.5 text-white"
              : "rounded-md border px-3 py-1.5"
          }
          onClick={() => setTab("admin")}
        >
          Создание шаблонов (админ)
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {tab === "admin" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-white p-4">
            <h3 className="font-medium text-violet-800">Новый / выбранный шаблон</h3>
            <p className="text-xs text-zinc-500">
              Загрузи с компьютера driving-видео (танец) и Krea-кадр в похожем ракурсе,
              затем сгенерируй превью через Wan Animate 2 и сохрани как шаблон.
            </p>

            <label className="flex flex-col gap-1 text-sm">
              Название
              <input
                className="rounded-md border px-3 py-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Заметки
              <textarea
                className="rounded-md border px-3 py-2"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Positive (опционально)
              <textarea
                className="rounded-md border px-3 py-2"
                rows={2}
                placeholder="Пусто = дефолт системы"
                value={positive}
                onChange={(e) => setPositive(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Negative (опционально)
              <textarea
                className="rounded-md border px-3 py-2"
                rows={2}
                placeholder="Пусто = дефолт системы"
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() => void createTemplate()}
              className="rounded-md bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "…" : "Создать шаблон"}
            </button>

            {selected ? (
              <div className="mt-2 flex flex-col gap-3 border-t pt-3">
                <div className="text-sm">
                  Выбран: <span className="font-medium">{selected.title}</span>{" "}
                  <span className="text-xs text-zinc-500">
                    · {selected.status}
                    {selected.published ? " · published" : ""}
                  </span>
                </div>
                {selected.error ? (
                  <p className="text-xs text-red-600">{selected.error}</p>
                ) : null}

                <label className="flex flex-col gap-1 text-sm">
                  Driving video (с компьютера)
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFile("driving", f);
                      e.target.value = "";
                    }}
                  />
                  {selected.drivingVideoUrl ? (
                    <video
                      src={selected.drivingVideoUrl}
                      controls
                      className="mt-1 max-h-40 rounded border"
                    />
                  ) : (
                    <span className="text-xs text-zinc-400">ещё не загружено</span>
                  )}
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  Reference фото / Krea-кадр (с компьютера)
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFile("reference", f);
                      e.target.value = "";
                    }}
                  />
                  {selected.referenceImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.referenceImageUrl}
                      alt="ref"
                      className="mt-1 max-h-40 rounded border object-contain"
                    />
                  ) : (
                    <span className="text-xs text-zinc-400">ещё не загружено</span>
                  )}
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      selected.status === "generating" ||
                      !selected.drivingVideoUrl ||
                      !selected.referenceImageUrl
                    }
                    onClick={() => void generateSelected()}
                    className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {selected.status === "generating"
                      ? "Генерируется…"
                      : "Сгенерировать превью (Wan Animate 2)"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || selected.status !== "ready"}
                    onClick={() => void togglePublish()}
                    className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {selected.published ? "Снять с публикации" : "Опубликовать шаблон"}
                  </button>
                </div>

                {selected.resultVideoUrl ? (
                  <video
                    src={selected.resultVideoUrl}
                    controls
                    className="max-h-64 w-full rounded border bg-black"
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border bg-white p-4">
            <h3 className="font-medium">Мои шаблоны</h3>
            <ul className="mt-3 divide-y">
              {templates.length === 0 ? (
                <li className="py-3 text-sm text-zinc-500">Пока пусто</li>
              ) : (
                templates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`w-full px-1 py-3 text-left text-sm hover:bg-zinc-50 ${
                        selectedId === t.id ? "bg-violet-50" : ""
                      }`}
                      onClick={() => {
                        setSelectedId(t.id);
                        setTitle(t.title);
                        setNotes(t.notes);
                        setPositive(t.positivePrompt);
                        setNegative(t.negativePrompt);
                      }}
                    >
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-zinc-500">
                        {t.status}
                        {t.published ? " · published" : ""}
                        {t.drivingVideoUrl ? " · video" : ""}
                        {t.referenceImageUrl ? " · still" : ""}
                        {t.resultVideoUrl ? " · preview" : ""}
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border bg-white p-4">
            <h3 className="font-medium">Сделать ролик по шаблону</h3>
            <p className="text-xs text-zinc-500">
              Выбери готовый шаблон движения и своё фото (с ПК или из галереи).
              Движения с шаблона перенесутся на фото через Wan Animate 2.
            </p>

            <label className="flex flex-col gap-1 text-sm">
              Шаблон
              <select
                className="rounded-md border px-3 py-2"
                value={useTemplateId}
                onChange={(e) => setUseTemplateId(e.target.value)}
              >
                <option value="">— выбери —</option>
                {published.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.status})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Персонаж (опционально)
              <select
                className="rounded-md border px-3 py-2"
                value={useCharacterId}
                onChange={(e) => setUseCharacterId(e.target.value)}
              >
                <option value="">—</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Фото с компьютера
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void runAsUser(f);
                  e.target.value = "";
                }}
              />
            </label>

            <div className="text-sm">
              <div className="mb-1 font-medium">Или фото из галереи</div>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                {galleryStills.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setUseStillUrl(s.resultUrl)}
                    className={
                      useStillUrl === s.resultUrl
                        ? "rounded border-2 border-violet-600"
                        : "rounded border"
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.resultUrl} alt="" className="h-16 w-12 object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={busy || !useTemplateId || !useStillUrl}
              onClick={() => void runAsUser(null)}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Запускаю…" : "Сгенерировать из галереи"}
            </button>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <h3 className="font-medium">Мои прогоны</h3>
            <ul className="mt-3 divide-y">
              {runs.length === 0 ? (
                <li className="py-3 text-sm text-zinc-500">Пока пусто</li>
              ) : (
                runs.map((r) => (
                  <li key={r.id} className="py-3 text-sm">
                    <div className="text-xs text-zinc-500">
                      {r.status}
                      {r.error ? ` · ${r.error}` : ""}
                    </div>
                    {r.resultVideoUrl ? (
                      <video
                        src={r.resultVideoUrl}
                        controls
                        className="mt-2 max-h-48 w-full rounded border bg-black"
                      />
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
