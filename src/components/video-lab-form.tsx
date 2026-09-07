"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MediaLightbox } from "@/components/media-lightbox";
import {
  estimateFilmQuote,
  type PublicFilmProject,
} from "@/lib/film-project";
import { OrientationSelect } from "@/components/orientation-select";
import type { VideoOrientationId } from "@/lib/video-orientation";

type Char = { id: string; name: string; loraStatus: string; gender?: string };
type Pose = { id: string; label: string };
type Style = { id: string; label: string };
type Still = { id: string; title: string | null; kind: string; resultUrl?: string };

export function VideoLabForm({
  characters,
  stills,
  poses,
  styles,
  initialProjects,
}: {
  characters: Char[];
  stills: Still[];
  poses: Pose[];
  styles: Style[];
  initialProjects: PublicFilmProject[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"animate" | "film" | "ref2v">("film");
  const [filmMode, setFilmMode] = useState<"studio" | "fast">("studio");
  const [projects, setProjects] = useState(initialProjects);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Animate from gallery still
  const [stillId, setStillId] = useState(stills[0]?.id || "");
  const [animatePlot, setAnimatePlot] = useState("");
  const [durationSec, setDurationSec] = useState(6);
  const [withMusic, setWithMusic] = useState(false);

  // Film idea form
  const [idea, setIdea] = useState("");
  const [withDialogue, setWithDialogue] = useState(true);
  const [characterIds, setCharacterIds] = useState<string[]>(
    characters.slice(0, 1).map((c) => c.id),
  );
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [lockScenes, setLockScenes] = useState(false);
  const [sceneCount, setSceneCount] = useState(4);
  const [aspect, setAspect] = useState<VideoOrientationId>("9_16");
  const [styleId, setStyleId] = useState(styles[0]?.id || "");

  const quote = useMemo(
    () =>
      estimateFilmQuote({
        sceneCount: lockScenes ? sceneCount : 4,
        withMusic: false,
      }),
    [lockScenes, sceneCount],
  );

  function toggleChar(id: string) {
    setCharacterIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  function togglePose(id: string) {
    setPoseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function animateStill() {
    if (!stillId) {
      setError("Выбери фото из галереи");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "animate",
          itemId: stillId,
          plot: animatePlot.trim() || "match the still pose",
          withMusic,
          durationSec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ошибка");
      router.push("/peach/gallery");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function startFilm() {
    if (idea.trim().length < 3) {
      setError("Опиши идею фильма");
      return;
    }
    if (characterIds.length < 1) {
      setError("Выбери 1–2 персонажа");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/films", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: filmMode,
          idea: idea.trim(),
          withDialogue,
          characterIds,
          poseIds: filmMode === "fast" ? poseIds : poseIds,
          sceneCount: lockScenes ? sceneCount : null,
          aspect,
          styleId: styleId || null,
          durationSec: 6,
        }),
      });
      const createRaw = await res.text();
      let data: { project?: { id: string }; error?: string } = {};
      try {
        data = JSON.parse(createRaw) as typeof data;
      } catch {
        throw new Error(`Ошибка сервера при создании (${res.status})`);
      }
      if (!res.ok) throw new Error(data.error || "ошибка");
      const id = data.project?.id as string;
      if (!id) throw new Error("проект не создан");

      const actionName = filmMode === "fast" ? "fast_run" : "script";
      const act = await fetch(`/api/peach/films/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName }),
      });
      const actRaw = await act.text();
      let actData: { error?: string } = {};
      try {
        actData = JSON.parse(actRaw) as typeof actData;
      } catch {
        throw new Error(`Не удалось запустить (${act.status}). Обнови страницу.`);
      }
      if (!act.ok) throw new Error(actData.error || "не удалось запустить");
      router.push(`/peach/video/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function startRef2V() {
    if (idea.trim().length < 3) {
      setError("Опиши сюжет");
      return;
    }
    if (characterIds.length < 1) {
      setError("Выбери персонажа (по фото из галереи)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/peach/films", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "fast",
          idea: idea.trim(),
          withDialogue,
          characterIds,
          poseIds,
          sceneCount: lockScenes ? sceneCount : null,
          aspect,
          styleId: styleId || null,
          durationSec: 6,
        }),
      });
      const raw = await res.text();
      let data: { project?: { id: string }; error?: string } = {};
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(
          res.ok
            ? "Сервер вернул не JSON — перезапусти npm run dev"
            : `Ошибка сервера (${res.status})`,
        );
      }
      if (!res.ok) throw new Error(data.error || "ошибка");
      const id = data.project?.id;
      if (!id) throw new Error("проект не создан");
      const act = await fetch(`/api/peach/films/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ref2v_run" }),
      });
      const actRaw = await act.text();
      let actData: { error?: string } = {};
      try {
        actData = JSON.parse(actRaw) as typeof actData;
      } catch {
        throw new Error(
          `Не удалось запустить Ref2V (${act.status}). Обнови страницу и попробуй ещё раз.`,
        );
      }
      if (!act.ok) throw new Error(actData.error || "не удалось запустить");
      router.push(`/peach/video/${id}`);
      router.refresh();
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
            tab === "film"
              ? "rounded-md bg-zinc-900 px-3 py-1.5 text-white"
              : "rounded-md border px-3 py-1.5"
          }
          onClick={() => setTab("film")}
        >
          Мини-фильм
        </button>
        <button
          type="button"
          className={
            tab === "ref2v"
              ? "rounded-md bg-violet-700 px-3 py-1.5 text-white"
              : "rounded-md border px-3 py-1.5"
          }
          onClick={() => setTab("ref2v")}
        >
          Быстрое видео по фото
        </button>
        <button
          type="button"
          className={
            tab === "animate"
              ? "rounded-md bg-zinc-900 px-3 py-1.5 text-white"
              : "rounded-md border px-3 py-1.5"
          }
          onClick={() => setTab("animate")}
        >
          Оживить фото
        </button>
      </div>

      {tab === "ref2v" ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex max-w-xl flex-1 flex-col gap-3 rounded-lg border border-violet-200 bg-white p-4">
            <div>
              <h3 className="font-medium text-violet-800">Быстрое видео по фото</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Опиши сюжет — система сгенерирует многосценный ролик напрямую из фото персонажей.
                Не нужны отдельные кадры Krea — MiniMax H3 Ref2V строит видео прямо по рефу.
              </p>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              Сюжет (что происходит)
              <textarea
                className="rounded-md border px-3 py-2"
                rows={3}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Она открывает дверь, впускает его. Он раздевает её. Секс на диване. Финал…"
              />
            </label>

            <div className="text-sm">
              <div className="mb-1 font-medium">Персонажи (нужно фото в галерее)</div>
              <div className="flex flex-wrap gap-2">
                {characters.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleChar(c.id)}
                    className={
                      characterIds.includes(c.id)
                        ? "rounded-md bg-violet-700 px-2 py-1 text-xs text-white"
                        : "rounded-md border px-2 py-1 text-xs"
                    }
                  >
                    {c.name}
                  </button>
                ))}
                {characters.length === 0 && (
                  <p className="text-xs text-zinc-400">Нет персонажей — сначала добавь</p>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                Последнее фото из галереи будет использовано как реф-изображение
              </p>
            </div>

            <div className="text-sm">
              <div className="mb-1 font-medium">Позы для секс-сцен</div>
              <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                {poses.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePose(p.id)}
                    className={
                      poseIds.includes(p.id)
                        ? "rounded-md bg-zinc-800 px-2 py-1 text-xs text-white"
                        : "rounded-md border px-2 py-1 text-xs"
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={lockScenes}
                onChange={(e) => setLockScenes(e.target.checked)}
              />
              Зафиксировать число сцен
            </label>
            {lockScenes && (
              <label className="flex flex-col gap-1 text-sm">
                Сцен: {sceneCount}
                <input
                  type="range"
                  min={3}
                  max={8}
                  value={sceneCount}
                  onChange={(e) => setSceneCount(Number(e.target.value))}
                />
              </label>
            )}

            <label className="flex flex-col gap-1 text-sm">
              Ориентация
              <OrientationSelect
                className="rounded-md border px-3 py-2"
                value={aspect}
                onChange={setAspect}
              />
            </label>

            <button
              type="button"
              disabled={busy || characterIds.length === 0}
              onClick={() => void startRef2V()}
              className="rounded-md bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Запускаю…" : "Снять фильм по фото"}
            </button>
          </div>

          <div className="flex-1 rounded-lg border border-zinc-200 bg-white p-4">
            <h3 className="font-medium">Проекты</h3>
            <ul className="mt-3 divide-y">
              {projects.length === 0 ? (
                <li className="py-3 text-sm text-zinc-500">Пока пусто</li>
              ) : (
                projects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full px-1 py-3 text-left text-sm hover:bg-zinc-50"
                      onClick={() => router.push(`/peach/video/${p.id}`)}
                    >
                      <div className="font-medium">{p.title || p.idea.slice(0, 40) || "Без названия"}</div>
                      <div className="text-xs text-zinc-500">
                        {p.mode} · {p.step} · {p.status}
                        {p.scenes.length ? ` · ${p.scenes.length} сцен` : ""}
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : tab === "animate" ? (
        <div className="flex max-w-xl flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-600">
            Персонаж уже в кадре. Выбери фото из галереи и оживи через MiniMax.
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Фото
            <select
              className="rounded-md border px-3 py-2"
              value={stillId}
              onChange={(e) => setStillId(e.target.value)}
            >
              {stills.length === 0 ? (
                <option value="">Нет фото — сначала сгенерируй</option>
              ) : (
                stills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || s.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Пожелания к движению (опц.)
            <textarea
              className="rounded-md border px-3 py-2"
              rows={2}
              value={animatePlot}
              onChange={(e) => setAnimatePlot(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Длина: {durationSec}с
            <input
              type="range"
              min={4}
              max={12}
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withMusic}
              onChange={(e) => setWithMusic(e.target.checked)}
            />
            Добавить музыку
          </label>
          <button
            type="button"
            disabled={busy || !stillId}
            onClick={() => void animateStill()}
            className="rounded-md bg-rose-800 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Оживить
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex max-w-xl flex-1 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                className={
                  filmMode === "studio"
                    ? "rounded-md bg-zinc-900 px-3 py-1.5 text-white"
                    : "rounded-md border px-3 py-1.5"
                }
                onClick={() => setFilmMode("studio")}
              >
                Studio
              </button>
              <button
                type="button"
                className={
                  filmMode === "fast"
                    ? "rounded-md bg-zinc-900 px-3 py-1.5 text-white"
                    : "rounded-md border px-3 py-1.5"
                }
                onClick={() => setFilmMode("fast")}
              >
                Fast creation
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              {filmMode === "studio"
                ? "Сценарий → раскадровка → клипы → склейка. Можно править каждый шаг."
                : "Выбери персонажей и позы — система сама пройдёт весь пайплайн."}
            </p>

            <label className="flex flex-col gap-1 text-sm">
              Идея фильма
              <textarea
                className="rounded-md border px-3 py-2"
                rows={3}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Кратко: кто, где, что происходит…"
              />
            </label>

            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={withDialogue}
                  onChange={() => setWithDialogue(true)}
                />
                С диалогами
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!withDialogue}
                  onChange={() => setWithDialogue(false)}
                />
                Без диалогов
              </label>
            </div>

            <div className="text-sm">
              <div className="mb-1 font-medium">Персонажи (1–2)</div>
              <div className="flex flex-wrap gap-2">
                {characters.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleChar(c.id)}
                    className={
                      characterIds.includes(c.id)
                        ? "rounded-md bg-rose-800 px-2 py-1 text-xs text-white"
                        : "rounded-md border px-2 py-1 text-xs"
                    }
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {(filmMode === "fast" || true) && (
              <div className="text-sm">
                <div className="mb-1 font-medium">Позы для секса (пресеты)</div>
                <p className="mb-1 text-xs text-zinc-500">
                  Если не выбрать — секс-сцены сами возьмут позы из каталога (doggy, BJ, cowgirl…). Не секс (дверь, aftercare) без позы.
                </p>
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                  {poses.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePose(p.id)}
                      className={
                        poseIds.includes(p.id)
                          ? "rounded-md bg-zinc-800 px-2 py-1 text-xs text-white"
                          : "rounded-md border px-2 py-1 text-xs"
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={lockScenes}
                onChange={(e) => setLockScenes(e.target.checked)}
              />
              Зафиксировать число сцен
            </label>
            {lockScenes ? (
              <label className="flex flex-col gap-1 text-sm">
                Сцен: {sceneCount}
                <input
                  type="range"
                  min={3}
                  max={8}
                  value={sceneCount}
                  onChange={(e) => setSceneCount(Number(e.target.value))}
                />
              </label>
            ) : (
              <p className="text-xs text-zinc-500">LLM сама выберет 3–8 сцен под историю</p>
            )}

            <label className="flex flex-col gap-1 text-sm">
              Ориентация
              <OrientationSelect
                className="rounded-md border px-3 py-2"
                value={aspect}
                onChange={setAspect}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Стиль
              <select
                className="rounded-md border px-3 py-2"
                value={styleId}
                onChange={(e) => setStyleId(e.target.value)}
              >
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-md bg-zinc-50 p-3 text-sm">
              <div>
                Оценка: <strong>{quote.credits} кр.</strong> · {quote.estimateLabel}
              </div>
              <div className="text-xs text-zinc-500">
                ~{quote.sceneCount} сцен × (кадр + клип) + монтаж
              </div>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void startFilm()}
              className="rounded-md bg-rose-800 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {filmMode === "fast"
                ? "Fast: снять фильм"
                : "Сгенерировать сценарий"}
            </button>
          </div>

          <div className="flex-1 rounded-lg border border-zinc-200 bg-white p-4">
            <h3 className="font-medium">Сохранённые проекты</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Можно вернуться к сценарию / раскадровке / клипам
            </p>
            <ul className="mt-3 divide-y">
              {projects.length === 0 ? (
                <li className="py-3 text-sm text-zinc-500">Пока пусто</li>
              ) : (
                projects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full px-1 py-3 text-left text-sm hover:bg-zinc-50"
                      onClick={() => router.push(`/peach/video/${p.id}`)}
                    >
                      <div className="font-medium">
                        {p.title || p.idea.slice(0, 40) || "Без названия"}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {p.mode} · {p.step} · {p.status}
                        {p.scenes.length ? ` · ${p.scenes.length} сцен` : ""}
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button
              type="button"
              className="mt-2 text-xs text-zinc-500 underline"
              onClick={async () => {
                const res = await fetch("/api/peach/films");
                const data = await res.json();
                if (res.ok) setProjects(data.projects || []);
              }}
            >
              Обновить список
            </button>
          </div>
        </div>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

export function FilmProjectStudio({
  initial,
  characters,
}: {
  initial: PublicFilmProject;
  characters: Char[];
}) {
  const router = useRouter();
  const [project, setProject] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sceneCountEdit, setSceneCountEdit] = useState(
    project.sceneCount || project.scenes.length || 4,
  );
  const [lightbox, setLightbox] = useState<{
    src: string;
    kind: "photo" | "video";
  } | null>(null);
  const [editNote, setEditNote] = useState<Record<number, string>>({});
  const [musicOpen, setMusicOpen] = useState(false);
  const [withMusic, setWithMusic] = useState(project.withMusic);
  const [musicNote, setMusicNote] = useState(project.musicNote);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/peach/films/${project.id}`);
    const data = await res.json();
    if (res.ok && data.project) setProject(data.project);
  }, [project.id]);

  useEffect(() => {
    if (project.status !== "busy") return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [project.status, refresh]);

  async function action(
    act: string,
    extra: Record<string, unknown> = {},
  ) {
    setBusy(true);
    setError("");
    try {
      // save scene text edits first (incl. regen — otherwise old synopsis is used)
      if (
        act === "shoot_stills" ||
        act === "script" ||
        act === "regen_still" ||
        act === "edit_still" ||
        act === "regen_clip" ||
        act === "edit_clip" ||
        act === "shoot_clips"
      ) {
        const save = await fetch(`/api/peach/films/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenes: project.scenes }),
        });
        if (!save.ok) {
          const err = await save.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error || "не удалось сохранить сцены",
          );
        }
      }
      const res = await fetch(`/api/peach/films/${project.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: act, ...extra }),
      });
      const raw = await res.text();
      let data: { error?: string; project?: typeof project } = {};
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(
          `Сервер вернул не JSON (${res.status}). Обнови страницу (Ctrl+F5) или перезапусти npm run dev.`,
        );
      }
      if (!res.ok) {
        throw new Error(
          data.error === "проект занят"
            ? "Проект ещё генерирует — подожди «idle» и нажми Regen ещё раз"
            : data.error || "ошибка",
        );
      }
      if (data.project) setProject(data.project);
      else await refresh();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  function updateScene(i: number, patch: Partial<(typeof project.scenes)[0]>) {
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  }

  const quote = estimateFilmQuote({
    sceneCount: project.scenes.length || project.sceneCount || 4,
    withMusic,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <button
            type="button"
            className="text-xs text-zinc-500 underline"
            onClick={() => router.push("/peach/video")}
          >
            ← к списку
          </button>
          <h2 className="text-lg font-medium">
            {project.title || "Мини-фильм"}
          </h2>
          <p className="text-sm text-zinc-600">
            {project.mode} · шаг: {project.step} ·{" "}
            {project.status === "busy" ? "работает…" : project.status}
          </p>
        </div>
        <div className="rounded-md bg-zinc-50 px-3 py-2 text-sm">
          {quote.credits} кр. · {quote.estimateLabel}
        </div>
      </div>

      {project.error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {project.error}
        </p>
      ) : null}

      <div className="rounded-lg border bg-white p-4 text-sm">
        <div className="font-medium">Идея</div>
        <p className="mt-1 text-zinc-700">{project.idea}</p>
        <p className="mt-2 text-xs text-zinc-500">
          Персонажи:{" "}
          {project.characterIds
            .map((id) => characters.find((c) => c.id === id)?.name || id)
            .join(", ")}
          {" · "}
          {project.withDialogue ? "с диалогами" : "без диалогов"} · {project.aspect}
        </p>
        {project.filmBible ? (
          <p className="mt-2 rounded bg-zinc-50 p-2 text-xs text-zinc-600">
            <strong>Bible:</strong> {project.filmBible}
          </p>
        ) : null}
      </div>

      {/* Script step controls */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || project.status === "busy"}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => void action("script_variant")}
        >
          Другой сценарий
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span>Сцен:</span>
          <input
            type="number"
            min={3}
            max={8}
            className="w-16 rounded border px-2 py-1"
            value={sceneCountEdit}
            onChange={(e) => setSceneCountEdit(Number(e.target.value))}
          />
          <button
            type="button"
            disabled={busy || project.status === "busy"}
            className="rounded-md border px-2 py-1 text-sm"
            onClick={() =>
              void action("rescript_count", { sceneCount: sceneCountEdit })
            }
          >
            Пересобрать сюжет
          </button>
        </div>
        <button
          type="button"
          disabled={busy || project.status === "busy" || project.scenes.length < 3}
          className="rounded-md bg-rose-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          onClick={() => void action("shoot_stills")}
        >
          Снять фильм (кадры)
        </button>
        {project.scenes.length > 0 &&
        project.scenes.every((s) => s.stillUrl || s.status === "still_ready") ? (
          <button
            type="button"
            disabled={busy || project.status === "busy"}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            onClick={() => void action("shoot_clips")}
          >
            Сгенерировать видео
          </button>
        ) : null}
        {project.scenes.every(
          (s) => s.status === "clip_ready" || s.clipUrl,
        ) && project.scenes.length > 0 ? (
          <button
            type="button"
            disabled={busy || project.status === "busy"}
            className="rounded-md border border-rose-700 px-3 py-1.5 text-sm text-rose-800"
            onClick={() => setMusicOpen(true)}
          >
            Склеить
          </button>
        ) : null}
      </div>

      {/* Scenes */}
      <div className="grid gap-4">
        {project.scenes.map((scene, i) => (
          <article
            key={i}
            className="rounded-lg border border-zinc-200 bg-white p-4"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-medium">Сцена {i + 1}</h3>
              <span className="text-xs text-zinc-500">
                {scene.status}
                {scene.poseId ? ` · поза ${scene.poseId}` : ""}
              </span>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Сюжет
              <textarea
                className="rounded-md border px-2 py-1.5"
                rows={2}
                value={scene.synopsis}
                onChange={(e) =>
                  updateScene(i, { synopsis: e.target.value })
                }
              />
            </label>
            {project.withDialogue ? (
              <label className="mt-2 flex flex-col gap-1 text-sm">
                Диалог
                <textarea
                  className="rounded-md border px-2 py-1.5"
                  rows={2}
                  value={scene.dialogue || ""}
                  onChange={(e) =>
                    updateScene(i, { dialogue: e.target.value })
                  }
                />
              </label>
            ) : null}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {scene.stillUrl ? (
                <button
                  type="button"
                  className="overflow-hidden rounded border"
                  onClick={() =>
                    setLightbox({ src: scene.stillUrl!, kind: "photo" })
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={scene.stillUrl}
                    src={scene.stillUrl}
                    alt={`scene ${i + 1}`}
                    className="aspect-[3/4] w-full object-cover"
                  />
                </button>
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center rounded border bg-zinc-50 text-xs text-zinc-400">
                  Кадр ещё не готов
                </div>
              )}
              {scene.clipUrl ? (
                <button
                  type="button"
                  className="overflow-hidden rounded border"
                  onClick={() =>
                    setLightbox({ src: scene.clipUrl!, kind: "video" })
                  }
                >
                  <video
                    src={scene.clipUrl}
                    className="aspect-[3/4] w-full object-cover"
                    muted
                    playsInline
                  />
                </button>
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center rounded border bg-zinc-50 text-xs text-zinc-400">
                  Клип ещё не готов
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="min-w-[160px] flex-1 rounded border px-2 py-1 text-xs"
                placeholder="Заметка для edit/regen"
                value={editNote[i] || ""}
                onChange={(e) =>
                  setEditNote((m) => ({ ...m, [i]: e.target.value }))
                }
              />
              <button
                type="button"
                disabled={busy || project.status === "busy"}
                className="rounded border px-2 py-1 text-xs"
                onClick={() =>
                  void action("edit_still", {
                    sceneIndex: i,
                    editNote: editNote[i] || "улучши кадр",
                  })
                }
              >
                Edit кадр
              </button>
              <button
                type="button"
                disabled={busy || project.status === "busy"}
                className="rounded border px-2 py-1 text-xs"
                onClick={() => void action("regen_still", { sceneIndex: i })}
              >
                Regen кадр
              </button>
              <button
                type="button"
                disabled={busy || project.status === "busy" || !scene.stillUrl}
                className="rounded border px-2 py-1 text-xs"
                onClick={() =>
                  void action("edit_clip", {
                    sceneIndex: i,
                    editNote: editNote[i] || "улучши движение",
                  })
                }
              >
                Edit клип
              </button>
              <button
                type="button"
                disabled={busy || project.status === "busy" || !scene.stillUrl}
                className="rounded border px-2 py-1 text-xs"
                onClick={() => void action("regen_clip", { sceneIndex: i })}
              >
                Regen клип
              </button>
              {scene.clipUrl ? (
                <a
                  className="rounded border px-2 py-1 text-xs"
                  href={scene.clipUrl}
                  download
                >
                  Скачать клип
                </a>
              ) : null}
            </div>
            {scene.error ? (
              <p className="mt-1 text-xs text-red-600">{scene.error}</p>
            ) : null}
          </article>
        ))}
      </div>

      {musicOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4">
            <h3 className="font-medium">Склейка</h3>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withMusic}
                onChange={(e) => setWithMusic(e.target.checked)}
              />
              Добавить музыку
            </label>
            {withMusic ? (
              <textarea
                className="mt-2 w-full rounded border px-2 py-1.5 text-sm"
                rows={2}
                placeholder="Стиль музыки своими словами"
                value={musicNote}
                onChange={(e) => setMusicNote(e.target.value)}
              />
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-sm"
                onClick={() => setMusicOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="rounded bg-rose-800 px-3 py-1.5 text-sm text-white"
                onClick={() => {
                  setMusicOpen(false);
                  void action("stitch", { withMusic, musicNote });
                }}
              >
                Монтаж
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <MediaLightbox
          src={lightbox.src}
          kind={lightbox.kind}
          onClose={() => setLightbox(null)}
        />
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {project.status === "busy" ? (
        <p className="text-sm text-zinc-600">Идёт генерация — страница обновляется…</p>
      ) : null}
    </div>
  );
}
