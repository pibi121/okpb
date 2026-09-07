"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicPlayFrame, PublicPlayRun } from "@/lib/template-play-types";
import { MediaLightbox } from "@/components/media-lightbox";

type CharacterOpt = { id: string; name: string; gender: string };

const STEPS = [
  { id: "characters", n: 1, label: "Персонажи" },
  { id: "stills", n: 2, label: "Сцены" },
  { id: "animate", n: 3, label: "Оживление" },
] as const;

function stepIndex(step: PublicPlayRun["step"]) {
  if (step === "characters") return 0;
  if (step === "stills") return 1;
  return 2;
}

export function TemplatePlay({
  initial,
  characters,
}: {
  initial: PublicPlayRun;
  characters: CharacterOpt[];
}) {
  const [run, setRun] = useState(initial);
  const [picked, setPicked] = useState<string[]>(initial.characterIds);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [lightbox, setLightbox] = useState<{ src: string; kind: "photo" | "video" } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/peach/play/${run.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { run: PublicPlayRun };
      setRun(data.run);
    } catch {
      /* ignore poll errors */
    }
  }, [run.id]);

  async function act(body: Record<string, unknown>) {
    setBusy(String(body.action));
    setErr("");
    try {
      const res = await fetch(`/api/peach/play/${run.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { run?: PublicPlayRun; error?: string };
      if (!res.ok) throw new Error(data.error || "ошибка");
      if (data.run) setRun(data.run);
      else await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy("");
    }
  }

  const pending =
    run.frames.some((f) => f.stillStatus === "pending" || f.clipStatus === "pending");

  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [pending, refresh]);

  function patchLocal(frameId: string, field: keyof PublicPlayFrame, value: string | number) {
    setRun((r) => ({
      ...r,
      frames: r.frames.map((f) => (f.id === frameId ? { ...f, [field]: value } : f)),
    }));
  }

  async function saveFrame(frame: PublicPlayFrame) {
    await act({
      action: "update_frame",
      frameId: frame.id,
      patch: {
        videoNote: frame.videoNote,
        dialogue: frame.dialogue,
        durationSec: frame.durationSec,
      },
    });
  }

  const active = stepIndex(run.step);
  const stillsReady = run.frames.length > 0 && run.frames.every((f) => f.stillStatus === "ready");
  const canAnimate = stillsReady || run.step === "animate" || run.step === "done";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link href="/peach/templates" className="text-xs text-zinc-500 underline">
          ← Шаблоны
        </Link>
        <h2 className="mt-1 text-lg font-medium">{run.packTitle}</h2>
        {run.packIdea ? <p className="text-sm text-zinc-500">{run.packIdea}</p> : null}
      </div>

      <ol className="flex gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={
              i === active
                ? "rounded-full bg-peach/20 px-3 py-1 text-peach"
                : i < active
                  ? "rounded-full bg-emerald-900/40 px-3 py-1 text-emerald-300"
                  : "rounded-full bg-white/5 px-3 py-1 text-zinc-500"
            }
          >
            {s.n}. {s.label}
          </li>
        ))}
      </ol>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {pending ? <p className="text-xs text-zinc-500">Генерация в очереди GPU…</p> : null}

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
        <h3 className="text-sm font-medium">1. Выбери персонажей</h3>
        <p className="text-xs text-zinc-500">
          Порядок важен. Первый выбранный = слот 1, второй = слот 2.
          {run.characterSlots.length ? (
            <>
              {" "}
              В этом шаблоне так:{" "}
              {run.characterSlots.map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? ", " : ""}
                  <span className="text-zinc-300">
                    слот {i + 1} — {s.name} ({s.gender === "male" ? "муж" : "жен"})
                  </span>
                </span>
              ))}
              . Поставь своих людей в том же порядке ролей.
            </>
          ) : (
            <> Шаблон рассчитан примерно на {run.suggestedCount}.</>
          )}
        </p>
        {picked.length ? (
          <p className="text-xs text-zinc-300">
            Сейчас:{" "}
            {picked.map((id, i) => {
              const ch = characters.find((c) => c.id === id);
              return (
                <span key={id}>
                  {i > 0 ? " → " : ""}
                  <span className="text-peach">{i + 1}. {ch?.name || id}</span>
                  <span className="text-zinc-500">
                    {" "}
                    ({ch?.gender === "male" ? "муж" : "жен"})
                  </span>
                </span>
              );
            })}
            {picked.length >= 2 ? (
              <button
                type="button"
                className="ml-2 underline text-zinc-400"
                onClick={() =>
                  setPicked((ids) => {
                    if (ids.length < 2) return ids;
                    const next = [...ids];
                    const a = next[0]!;
                    next[0] = next[1]!;
                    next[1] = a;
                    return next;
                  })
                }
              >
                поменять местами 1 и 2
              </button>
            ) : null}
          </p>
        ) : null}
        {characters.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Нет персонажей.{" "}
            <Link href="/peach/characters" className="underline">
              Создай
            </Link>
            .
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {characters.map((ch) => {
              const on = picked.includes(ch.id);
              return (
                <li key={ch.id}>
                  <button
                    type="button"
                    disabled={!!busy || (active > 0 && stillsReady)}
                    onClick={() =>
                      setPicked((ids) =>
                        on ? ids.filter((id) => id !== ch.id) : [...ids, ch.id].slice(0, 4),
                      )
                    }
                    className={
                      on
                        ? "w-full rounded-xl border border-peach/50 bg-peach/10 px-3 py-2 text-left text-sm"
                        : "w-full rounded-xl border border-white/10 px-3 py-2 text-left text-sm hover:border-white/25"
                    }
                  >
                    <span className="font-medium">{ch.name}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {ch.gender === "male" ? "муж" : "жен"}
                    </span>
                    {on ? (
                      <span className="ml-2 rounded bg-peach/20 px-1.5 py-0.5 text-[10px] text-peach">
                        слот {picked.indexOf(ch.id) + 1}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          disabled={!!busy || picked.length === 0}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => void act({ action: "set_characters", characterIds: picked })}
        >
          {busy === "set_characters" ? "…" : "Дальше — сцены"}
        </button>
      </section>

      <section
        className={
          active < 1
            ? "rounded-2xl border border-white/5 p-4 opacity-40 pointer-events-none"
            : "rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3"
        }
      >
        <h3 className="text-sm font-medium">2. Поставить генерацию сцен</h3>
        <p className="text-xs text-zinc-500">
          Кадры шаблона перерисуются с выбранными персонажами. Потом можно оживлять.
        </p>
        <button
          type="button"
          disabled={!!busy || active < 1}
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          onClick={() => void act({ action: "generate_stills" })}
        >
          {busy === "generate_stills" ? "Ставлю в очередь…" : "Сгенерировать сцены"}
        </button>
        <div className="grid gap-3 sm:grid-cols-2">
          {run.frames.map((f) => (
            <article key={f.id} className="rounded-xl border border-white/10 p-2">
              <p className="text-xs text-zinc-400">
                #{f.index + 1} {f.beat || f.title || "сцена"}
              </p>
              {f.stillUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.stillUrl}
                  alt=""
                  className="mt-2 h-40 w-full cursor-zoom-in rounded object-cover bg-zinc-800"
                  onClick={() => setLightbox({ src: f.stillUrl!, kind: "photo" })}
                />
              ) : (
                <div className="mt-2 flex h-40 items-center justify-center rounded bg-zinc-900 text-xs text-zinc-500">
                  {f.stillStatus === "pending"
                    ? "генерируется…"
                    : f.stillError || "ещё нет"}
                </div>
              )}
              {f.stillError ? <p className="mt-1 text-[11px] text-red-400">{f.stillError}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <section
        className={
          !canAnimate
            ? "rounded-2xl border border-white/5 p-4 opacity-40 pointer-events-none"
            : "rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-4"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">3. Комментарии и диалоги → ролики</h3>
          <button
            type="button"
            disabled={!!busy || !stillsReady}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
            onClick={async () => {
              for (const f of run.frames) await saveFrame(f);
              await act({ action: "animate_all" });
            }}
          >
            {busy === "animate_all" ? "Ставлю…" : "Оживить все кадры"}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Комментарий — как двигаться. Диалог — отдельное поле, только если персонажи говорят.
        </p>
        {run.frames.map((f) => (
          <article key={f.id} className="rounded-xl border border-white/10 p-3 space-y-2">
            <div className="flex gap-3">
              {f.stillUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.stillUrl} alt="" className="h-24 w-16 rounded object-cover bg-zinc-800" />
              ) : (
                <div className="h-24 w-16 rounded bg-zinc-800" />
              )}
              {f.clipUrl ? (
                <video
                  src={f.clipUrl}
                  className="h-24 w-16 cursor-zoom-in rounded object-cover bg-black"
                  muted
                  playsInline
                  onClick={() => setLightbox({ src: f.clipUrl!, kind: "video" })}
                />
              ) : (
                <div className="flex h-24 w-16 items-center justify-center rounded bg-zinc-900 text-[10px] text-zinc-500">
                  {f.clipStatus === "pending" ? "…" : "нет видео"}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">#{f.index + 1}</p>
                <p className="text-xs text-zinc-500">{f.beat || "—"}</p>
                {f.clipError ? <p className="text-[11px] text-red-400">{f.clipError}</p> : null}
              </div>
            </div>
            <label className="block text-xs text-zinc-500">
              Комментарий для оживления
              <textarea
                rows={2}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                value={f.videoNote}
                onChange={(e) => patchLocal(f.id, "videoNote", e.target.value)}
                placeholder="Темп, камера, интенсивность, что усилить…"
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Диалоги персонажей (отдельное поле, можно пустым)
              <textarea
                rows={2}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                value={f.dialogue}
                onChange={(e) => patchLocal(f.id, "dialogue", e.target.value)}
                placeholder={'Она: «…»\nОн: «…»'}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Длительность
              <select
                className="mt-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                value={f.durationSec}
                onChange={(e) => patchLocal(f.id, "durationSec", Number(e.target.value))}
              >
                {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => (
                  <option key={s} value={s}>
                    {s} сек
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy}
                className="rounded border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => void saveFrame(f)}
              >
                Сохранить
              </button>
              <button
                type="button"
                disabled={!!busy || f.stillStatus !== "ready" || f.clipStatus === "pending"}
                className="rounded bg-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={async () => {
                  await saveFrame(f);
                  await act({ action: "animate_frame", frameId: f.id });
                }}
              >
                {f.clipStatus === "pending"
                  ? "В очереди…"
                  : f.clipStatus === "ready"
                    ? "Перегенерить ролик"
                    : "Оживить кадр"}
              </button>
            </div>
          </article>
        ))}
      </section>

      {lightbox ? (
        <MediaLightbox src={lightbox.src} kind={lightbox.kind} onClose={() => setLightbox(null)} />
      ) : null}
    </div>
  );
}
