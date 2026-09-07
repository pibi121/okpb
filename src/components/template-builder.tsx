"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PublicTemplateFrame, PublicTemplatePack } from "@/lib/template-pack-types";
import { TemplateUseButton } from "@/components/template-use-button";
import { MediaLightbox } from "@/components/media-lightbox";

type ChatMsg = { role: "user" | "assistant"; text: string };
type CastSlot = { id?: string; name: string; gender?: string };
type AnimateModalState = {
  frameId: string;
  durationSec: number;
  note: string;
  dialogue: string;
  prompt: string;
  composing: boolean;
  submitting: boolean;
};

function genderRu(gender?: string) {
  if (gender === "male") return "муж";
  if (gender === "female") return "жен";
  return "";
}

function slotTitle(slots: CastSlot[], index: number) {
  const slot = slots[index];
  const g = genderRu(slot?.gender);
  if (slot?.name) return `Слот ${index + 1}: ${slot.name}${g ? ` (${g})` : ""}`;
  return `Слот ${index + 1}`;
}

function frameCastLabel(frame: PublicTemplateFrame, slots: CastSlot[]) {
  const clothes = frame.clothed ? "в одежде" : "без одежды";
  if (frame.soloCharacterIndex === 0) {
    return `${slots[0]?.name || "слот 1"} · ${clothes}`;
  }
  if (frame.soloCharacterIndex === 1) {
    return `${slots[1]?.name || "слот 2"} · ${clothes}`;
  }
  return `оба · ${clothes}`;
}

export function TemplateBuilder({
  initial,
  characters = [],
}: {
  initial: PublicTemplatePack;
  characters?: Array<{ id: string; name: string; gender: string }>;
}) {
  const [pack, setPack] = useState(initial);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(
    initial.frames[initial.frames.length - 1]?.id || null,
  );
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; kind: "photo" | "video" } | null>(
    null,
  );
  const dragId = useRef<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const [stitchMusic, setStitchMusic] = useState(false);
  const [composing, setComposing] = useState(false);
  const [animateModal, setAnimateModal] = useState<AnimateModalState | null>(null);
  const [castModalFrameId, setCastModalFrameId] = useState<string | null>(null);

  const slots: CastSlot[] = (pack.characterSlots?.length
    ? pack.characterSlots
    : pack.characterIds
        .map((id) => characters.find((c) => c.id === id))
        .filter(Boolean)
        .map((c) => ({ id: c!.id, name: c!.name, gender: c!.gender }))
  ).slice(0, 2);
  if (!slots[0]) slots[0] = { name: "первый выбранный" };
  if (!slots[1]) slots[1] = { name: "второй выбранный" };
  const slotOptions = [
    ...characters,
    ...slots
      .filter((s): s is CastSlot & { id: string } => !!s.id)
      .filter((s) => !characters.some((c) => c.id === s.id)),
  ];

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/peach/templates/${pack.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { pack: PublicTemplatePack };
      setPack(data.pack);
    } catch {
      // Polling may race with hot-reload or tab close.
    }
  }, [pack.id]);

  async function act(body: Record<string, unknown>) {
    setBusy(String(body.action));
    setErr("");
    try {
      const res = await fetch(`/api/peach/templates/${pack.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { pack?: PublicTemplatePack; error?: string };
      if (!res.ok) throw new Error(data.error || "ошибка");
      if (data.pack) setPack(data.pack);
      else await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy("");
    }
  }

  const active = pack.frames.find((f) => f.id === activeFrameId) || pack.frames[0];

  function applyOrder(frameIds: string[]) {
    setPack((p) => ({
      ...p,
      frames: frameIds
        .map((id, index) => {
          const f = p.frames.find((x) => x.id === id);
          return f ? { ...f, index } : null;
        })
        .filter(Boolean) as PublicTemplateFrame[],
    }));
  }

  async function reorderTo(frameIds: string[]) {
    applyOrder(frameIds);
    await act({ action: "reorder", frameIds });
  }

  async function moveFrame(frameId: string, dir: -1 | 1) {
    const ids = pack.frames.map((f) => f.id);
    const i = ids.indexOf(frameId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    const tmp = next[i];
    next[i] = next[j]!;
    next[j] = tmp!;
    await reorderTo(next);
  }

  async function removeFrame(frameId: string) {
    if (!window.confirm("Убрать этот кадр из шаблона?")) return;
    const leftover = pack.frames.filter((f) => f.id !== frameId);
    await act({ action: "delete_frame", frameId });
    if (activeFrameId === frameId) {
      setActiveFrameId(leftover[leftover.length - 1]?.id || leftover[0]?.id || null);
    }
  }

  function patchFrame(field: keyof PublicTemplateFrame, value: string | number | boolean | null) {
    if (!active) return;
    setPack((p) => ({
      ...p,
      frames: p.frames.map((f) => (f.id === active.id ? { ...f, [field]: value } : f)),
    }));
  }

  async function saveFrame() {
    if (!active) return;
    await act({
      action: "update_frame",
      frameId: active.id,
      patch: {
        title: active.title,
        beat: active.beat,
        never: active.never,
        stillPrompt: active.stillPrompt,
        videoPrompt: active.videoPrompt,
        dialogue: active.dialogue,
        videoFailNote: active.videoFailNote,
        durationSec: active.durationSec,
        soloCharacterIndex: active.soloCharacterIndex,
        clothed: active.clothed,
      },
    });
  }

  async function saveCastSettings(
    frameId: string,
    patch: { soloCharacterIndex: number | null; clothed: boolean },
  ) {
    setPack((p) => ({
      ...p,
      frames: p.frames.map((f) => (f.id === frameId ? { ...f, ...patch } : f)),
    }));
    await act({
      action: "update_frame",
      frameId,
      patch,
    });
    setCastModalFrameId(null);
  }

  async function sendCoach() {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput("");
    setChat((c) => [...c, { role: "user", text: msg }]);
    setChatBusy(true);
    try {
      const res = await fetch(`/api/peach/templates/${pack.id}/coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, frameId: active?.id }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "ошибка");
      setChat((c) => [...c, { role: "assistant", text: data.reply || "…" }]);
      await refresh();
    } catch (e) {
      setChat((c) => [
        ...c,
        { role: "assistant", text: e instanceof Error ? e.message : "ошибка LLM" },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, chatBusy]);

  const readOnly = pack.status === "published";
  const pendingWork =
    pack.stitchStatus === "pending" ||
    pack.frames.some((f) => f.clipStatus === "pending" || f.stillStatus === "pending");
  const readyClips = pack.frames.filter((f) => f.clipStatus === "ready").length;

  useEffect(() => {
    if (!pendingWork) return;
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [pendingWork, refresh]);

  async function composeVideo() {
    if (!active?.stillItemId) {
      setErr("У кадра нет фото");
      return;
    }
    setComposing(true);
    setErr("");
    try {
      const res = await fetch("/api/peach/compose-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video",
          stillId: active.stillItemId,
          userNote: [active.beat, active.videoFailNote].filter(Boolean).join("\n"),
          poseId: active.poseId,
          durationSec: active.durationSec,
          dialogue: active.dialogue,
        }),
      });
      const data = (await res.json()) as { prompt?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "ошибка промпта");
      patchFrame("videoPrompt", data.prompt || "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      setComposing(false);
    }
  }

  async function animateFrame(frame: PublicTemplateFrame) {
    await act({
      action: "animate_frame",
      frameId: frame.id,
      plot: frame.beat,
      note: frame.videoFailNote,
      composedPrompt: frame.videoPrompt.trim() || undefined,
      durationSec: frame.durationSec,
      dialogue: frame.dialogue,
    });
  }

  function openAnimateModal(frame: PublicTemplateFrame) {
    setAnimateModal({
      frameId: frame.id,
      durationSec: frame.durationSec || 6,
      note: frame.videoFailNote || "",
      dialogue: frame.dialogue || "",
      prompt: frame.videoPrompt || "",
      composing: false,
      submitting: false,
    });
  }

  async function composeInAnimateModal() {
    if (!animateModal) return;
    const frame = pack.frames.find((f) => f.id === animateModal.frameId);
    if (!frame?.stillItemId) {
      setErr("У кадра нет фото");
      return;
    }
    setAnimateModal((m) => (m ? { ...m, composing: true } : m));
    setErr("");
    try {
      const res = await fetch("/api/peach/compose-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video",
          stillId: frame.stillItemId,
          userNote: [frame.beat, animateModal.note].filter(Boolean).join("\n"),
          poseId: frame.poseId,
          durationSec: animateModal.durationSec,
          dialogue: animateModal.dialogue,
        }),
      });
      const data = (await res.json()) as { prompt?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "ошибка промпта");
      setAnimateModal((m) => (m ? { ...m, prompt: data.prompt || "", composing: false } : m));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
      setAnimateModal((m) => (m ? { ...m, composing: false } : m));
    }
  }

  async function submitAnimateModal() {
    if (!animateModal) return;
    const frame = pack.frames.find((f) => f.id === animateModal.frameId);
    if (!frame?.stillItemId) {
      setErr("У кадра нет фото");
      return;
    }
    setAnimateModal((m) => (m ? { ...m, submitting: true } : m));
    await act({
      action: "update_frame",
      frameId: frame.id,
      patch: {
        durationSec: animateModal.durationSec,
        videoFailNote: animateModal.note,
        dialogue: animateModal.dialogue,
        videoPrompt: animateModal.prompt,
      },
    });
    await act({
      action: "animate_frame",
      frameId: frame.id,
      plot: frame.beat,
      note: animateModal.note,
      composedPrompt: animateModal.prompt.trim() || undefined,
      durationSec: animateModal.durationSec,
      dialogue: animateModal.dialogue,
    });
    setAnimateModal(null);
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/peach/templates" className="text-xs text-zinc-500 underline">
              ← Шаблоны
            </Link>
            <h2 className="mt-1 text-lg font-medium">{pack.title}</h2>
            {pack.idea ? <p className="text-sm text-zinc-500">{pack.idea}</p> : null}
            <p className="mt-1 text-xs text-zinc-600">
              {pack.approvedCount}/{pack.frameCount} кадров одобрено ·{" "}
              {readOnly ? "опубликован" : "сборка"}
            </p>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
              <p className="text-xs text-zinc-400">
                Роли шаблона по именам. Слот 1 / слот 2 — кого подставлять в кадры «только она» и
                «только он». Подхватил из исходных фото; можно поправить.
              </p>
              <div className="flex flex-wrap gap-3">
                {[0, 1].map((i) => (
                  <label key={i} className="block text-xs text-zinc-500">
                    Слот {i + 1}
                    <select
                      className="mt-1 block min-w-[180px] rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-zinc-200"
                      value={pack.characterIds[i] || ""}
                      onChange={(e) => {
                        const next = [pack.characterIds[0] || "", pack.characterIds[1] || ""];
                        next[i] = e.target.value;
                        const unique = next.filter(Boolean);
                        void (async () => {
                          setBusy("slots");
                          setErr("");
                          try {
                            const res = await fetch(`/api/peach/templates/${pack.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ characterIds: unique }),
                            });
                            const data = (await res.json()) as {
                              pack?: PublicTemplatePack;
                              error?: string;
                            };
                            if (!res.ok) throw new Error(data.error || "ошибка");
                            if (data.pack) setPack(data.pack);
                          } catch (err) {
                            setErr(err instanceof Error ? err.message : "ошибка");
                          } finally {
                            setBusy("");
                          }
                        })();
                      }}
                    >
                      <option value="">не выбран</option>
                      {slotOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.gender === "male" ? "муж" : "жен"})
                        </option>
                      ))}
                    </select>
                    {slots[i]?.name ? (
                      <span className="mt-1 block text-[11px] text-peach">
                        {slots[i]!.name}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pack.frameCount > 0 ? (
              <TemplateUseButton packId={pack.id} label="Использовать как пользователь" />
            ) : null}
            {!readOnly && pack.frameCount > 0 && pack.approvedCount === pack.frameCount ? (
              <button
                type="button"
                disabled={!!busy}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => void act({ action: "publish" })}
              >
                {busy === "publish" ? "…" : "Сформировать шаблон"}
              </button>
            ) : null}
          </div>
        </div>

        {err ? <p className="text-sm text-red-400">{err}</p> : null}

        {!readOnly && pack.frames.length > 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <p className="text-xs text-zinc-400">
              Ролики: {readyClips}/{pack.frameCount} готово
              {pendingWork ? " · генерация в очереди…" : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!!busy || pendingWork}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => {
                  const missing = pack.frames.filter(
                    (f) => f.stillItemId && f.clipStatus !== "ready" && f.clipStatus !== "pending",
                  );
                  if (!missing.length) {
                    setErr("Все кадры с фото уже с роликом (или в очереди)");
                    return;
                  }
                  void (async () => {
                    for (const f of missing) await animateFrame(f);
                  })();
                }}
              >
                Оживить все без ролика
              </button>
              <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={stitchMusic}
                  onChange={(e) => setStitchMusic(e.target.checked)}
                />
                музыка на склейке
              </label>
              <button
                type="button"
                disabled={!!busy || readyClips < 2 || pack.stitchStatus === "pending"}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() =>
                  void act({ action: "stitch", withMusic: stitchMusic })
                }
              >
                {busy === "stitch" || pack.stitchStatus === "pending"
                  ? "Склеиваю…"
                  : `Склеить ${readyClips} роликов`}
              </button>
            </div>
            {pack.stitchError ? (
              <p className="text-xs text-red-400">{pack.stitchError}</p>
            ) : null}
            {pack.stitchUrl ? (
              <video
                src={pack.stitchUrl}
                controls
                className="mt-1 max-h-56 w-full rounded-lg bg-black"
                onClick={() => setLightbox({ src: pack.stitchUrl!, kind: "video" })}
              />
            ) : null}
          </div>
        ) : null}

        {pack.frames.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-zinc-500">
            Папка пустая. Сгенерируй фото в лабе, в галерее «В шаблон» — потом оживляй и склеивай
            ролики прямо здесь.
          </div>
        ) : (
          <div className="space-y-3">
            {!readOnly && pack.frames.length > 1 ? (
              <p className="text-xs text-zinc-500">
                Стрелки или перетаскивание — порядок. Кликни фото/видео — увеличить. «Убрать» — из
                шаблона, файл в галерее останется.
              </p>
            ) : null}
            {pack.frames.map((f, i) => (
              <FrameCard
                key={f.id}
                frame={f}
                active={f.id === active?.id}
                readOnly={readOnly}
                busy={busy}
                canUp={i > 0}
                canDown={i < pack.frames.length - 1}
                onSelect={() => setActiveFrameId(f.id)}
                onApprove={() => void act({ action: "approve_frame", frameId: f.id })}
                onDelete={() => void removeFrame(f.id)}
                onMoveUp={() => void moveFrame(f.id, -1)}
                onMoveDown={() => void moveFrame(f.id, 1)}
                onOpenMedia={(src, kind) => setLightbox({ src, kind })}
                onAnimate={() => openAnimateModal(f)}
                onCast={() => setCastModalFrameId(f.id)}
                slots={slots}
                onDragStart={() => {
                  dragId.current = f.id;
                }}
                onDropOn={() => {
                  const from = dragId.current;
                  dragId.current = null;
                  if (!from || from === f.id) return;
                  const ids = pack.frames.map((x) => x.id);
                  const fromI = ids.indexOf(from);
                  const toI = ids.indexOf(f.id);
                  if (fromI < 0 || toI < 0) return;
                  const next = [...ids];
                  next.splice(fromI, 1);
                  next.splice(toI, 0, from);
                  void reorderTo(next);
                }}
              />
            ))}
          </div>
        )}

        {active && !readOnly ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <h3 className="text-sm font-medium">Кадр #{active.index + 1}</h3>
            <label className="block text-xs text-zinc-500">
              Сюжетный бит
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                rows={2}
                value={active.beat}
                onChange={(e) => patchFrame("beat", e.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Never
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                value={active.never}
                onChange={(e) => patchFrame("never", e.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Still prompt (EN)
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs font-mono"
                rows={3}
                value={active.stillPrompt}
                onChange={(e) => patchFrame("stillPrompt", e.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Video prompt (EN) — правь и жми Оживить / Перегенерить
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs font-mono"
                rows={4}
                value={active.videoPrompt}
                onChange={(e) => patchFrame("videoPrompt", e.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Комментарий к видео (свободно, до/после генерации)
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                rows={2}
                value={active.videoFailNote}
                onChange={(e) => patchFrame("videoFailNote", e.target.value)}
                placeholder="Что поменять: темп, движение, ракурс, эмоции, интенсивность..."
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Диалоги персонажей (отдельное поле, можно пустым)
              <textarea
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                rows={2}
                value={active.dialogue}
                onChange={(e) => patchFrame("dialogue", e.target.value)}
                placeholder={'Она: «…»\nОн: «…»'}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Длительность ролика
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                value={active.durationSec}
                onChange={(e) => patchFrame("durationSec", Number(e.target.value))}
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
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs"
                onClick={() => void saveFrame()}
              >
                Сохранить правки
              </button>
              <button
                type="button"
                disabled={composing || !active.stillItemId}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => void composeVideo()}
              >
                {composing ? "Составляю…" : "Составить video prompt"}
              </button>
              <button
                type="button"
                disabled={!!busy || !active.stillItemId || active.clipStatus === "pending"}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => openAnimateModal(active)}
              >
                {active.clipStatus === "pending"
                  ? "Ролик в очереди…"
                  : active.clipStatus === "ready"
                    ? "Перегенерить ролик"
                    : "Оживить кадр"}
              </button>
            </div>
            {active.clipError ? (
              <p className="text-xs text-red-400">{active.clipError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {!readOnly ? (
        <aside className="w-full shrink-0 space-y-2 lg:w-[320px]">
          <div className="rounded-2xl border border-white/10 bg-[#121214] flex flex-col h-[420px]">
            <div className="border-b border-white/8 px-3 py-2 text-xs font-medium text-zinc-400">
              Prompt coach (LLM)
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
              {chat.length === 0 ? (
                <p className="text-xs text-zinc-600">
                  «Сделай бег быстрее», «добавь напряжение», «перепиши video prompt»…
                </p>
              ) : null}
              {chat.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-4 rounded-lg bg-peach/15 px-2 py-1.5 text-xs"
                      : "mr-2 rounded-lg bg-white/5 px-2 py-1.5 text-xs text-zinc-300 whitespace-pre-wrap"
                  }
                >
                  {m.text}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <div className="border-t border-white/8 p-2 flex gap-2">
              <input
                className="flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs"
                placeholder="Правка промпта…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendCoach();
                  }
                }}
              />
              <button
                type="button"
                disabled={chatBusy || !chatInput.trim()}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => void sendCoach()}
              >
                {chatBusy ? "…" : "→"}
              </button>
            </div>
          </div>
        </aside>
      ) : null}

      {castModalFrameId ? (
        <CastSettingsModal
          frame={pack.frames.find((f) => f.id === castModalFrameId) || null}
          slots={slots}
          busy={!!busy}
          onClose={() => setCastModalFrameId(null)}
          onSave={(patch) => void saveCastSettings(castModalFrameId, patch)}
        />
      ) : null}

      {animateModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAnimateModal(null)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-white/10 bg-zinc-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium">Оживить / перегенерить ролик</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Сначала задай тайминг и комментарий, потом запускай генерацию.
            </p>
            <label className="mt-3 block text-xs text-zinc-500">
              Длительность
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                value={animateModal.durationSec}
                onChange={(e) =>
                  setAnimateModal((m) =>
                    m ? { ...m, durationSec: Number(e.target.value) } : m,
                  )
                }
              >
                {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => (
                  <option key={s} value={s}>
                    {s} сек
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-zinc-500">
              Комментарий (что изменить/усилить)
              <textarea
                rows={3}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                value={animateModal.note}
                onChange={(e) =>
                  setAnimateModal((m) => (m ? { ...m, note: e.target.value } : m))
                }
                placeholder="Например: быстрее темп, меньше тряски камеры, акцент на лицо..."
              />
            </label>
            <label className="mt-3 block text-xs text-zinc-500">
              Диалоги персонажей (если говорят)
              <textarea
                rows={2}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
                value={animateModal.dialogue}
                onChange={(e) =>
                  setAnimateModal((m) => (m ? { ...m, dialogue: e.target.value } : m))
                }
                placeholder={'Она: «…»\nОн: «…»'}
              />
            </label>
            <label className="mt-3 block text-xs text-zinc-500">
              Video prompt (EN)
              <textarea
                rows={5}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs"
                value={animateModal.prompt}
                onChange={(e) =>
                  setAnimateModal((m) => (m ? { ...m, prompt: e.target.value } : m))
                }
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={animateModal.composing || animateModal.submitting}
                className="rounded border border-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => void composeInAnimateModal()}
              >
                {animateModal.composing ? "Составляю…" : "Составить prompt"}
              </button>
              <button
                type="button"
                disabled={animateModal.submitting || animateModal.composing}
                className="rounded bg-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
                onClick={() => void submitAnimateModal()}
              >
                {animateModal.submitting ? "Запускаю…" : "Запустить генерацию"}
              </button>
              <button
                type="button"
                className="rounded border border-white/15 px-3 py-1.5 text-xs"
                onClick={() => setAnimateModal(null)}
              >
                Отмена
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
    </div>
  );
}

function CastSettingsModal({
  frame,
  slots,
  busy,
  onClose,
  onSave,
}: {
  frame: PublicTemplateFrame | null;
  slots: CastSlot[];
  busy: boolean;
  onClose: () => void;
  onSave: (patch: { soloCharacterIndex: number | null; clothed: boolean }) => void;
}) {
  const [solo, setSolo] = useState<number | null>(frame?.soloCharacterIndex ?? null);
  const [clothed, setClothed] = useState(!!frame?.clothed);

  if (!frame) return null;

  const options: Array<{ value: number | null; label: string; hint: string }> = [
    {
      value: null,
      label: "Оба в кадре",
      hint: "Слот 1 и слот 2 вместе",
    },
    {
      value: 0,
      label: `Только ${slots[0]?.name || "слот 1"}`,
      hint: slotTitle(slots, 0),
    },
    {
      value: 1,
      label: `Только ${slots[1]?.name || "слот 2"}`,
      hint: slotTitle(slots, 1),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-white/10 bg-zinc-950 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium">Кадр #{frame.index + 1} — кто в кадре</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Слот 1 и слот 2 — это порядок выбора при «Использовать». Первый клик по персонажу =
          слот 1, второй = слот 2. Обычно слот 1 — девушка, слот 2 — парень.
        </p>
        <div className="mt-3 space-y-2">
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setSolo(opt.value)}
              className={
                solo === opt.value
                  ? "w-full rounded-lg border border-peach/50 bg-peach/10 px-3 py-2 text-left"
                  : "w-full rounded-lg border border-white/10 px-3 py-2 text-left hover:border-white/25"
              }
            >
              <div className="text-sm">{opt.label}</div>
              <div className="text-[11px] text-zinc-500">{opt.hint}</div>
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={clothed}
            onChange={(e) => setClothed(e.target.checked)}
          />
          В одежде
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded bg-white/15 px-3 py-1.5 text-xs disabled:opacity-40"
            onClick={() => onSave({ soloCharacterIndex: solo, clothed })}
          >
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
          <button
            type="button"
            className="rounded border border-white/15 px-3 py-1.5 text-xs"
            onClick={onClose}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

function FrameCard({
  frame,
  active,
  readOnly,
  busy,
  canUp,
  canDown,
  onSelect,
  onApprove,
  onDelete,
  onMoveUp,
  onMoveDown,
  onOpenMedia,
  onAnimate,
  onCast,
  slots,
  onDragStart,
  onDropOn,
}: {
  frame: PublicTemplateFrame;
  active: boolean;
  readOnly: boolean;
  busy: string;
  canUp: boolean;
  canDown: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpenMedia: (src: string, kind: "photo" | "video") => void;
  onAnimate: () => void;
  onCast: () => void;
  slots: CastSlot[];
  onDragStart: () => void;
  onDropOn: () => void;
}) {
  const hasBoth = frame.stillStatus === "ready" && frame.clipStatus === "ready";
  const approved = frame.status === "approved";

  return (
    <article
      onDragOver={(e) => {
        if (readOnly) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      className={
        active
          ? "rounded-xl border border-peach/40 bg-peach/5 p-3"
          : "rounded-xl border border-white/10 bg-white/[0.02] p-3 hover:border-white/20"
      }
    >
      <div className="flex gap-3">
        {!readOnly ? (
          <div className="flex shrink-0 flex-col justify-center gap-1">
            <button
              type="button"
              draggable
              title="Перетащить"
              className="cursor-grab rounded border border-white/15 px-1.5 py-0.5 text-[11px] leading-none active:cursor-grabbing"
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                onDragStart();
              }}
            >
              ⋮⋮
            </button>
            <button
              type="button"
              disabled={!canUp || !!busy}
              className="rounded border border-white/15 px-1.5 py-0.5 text-[11px] leading-none disabled:opacity-30"
              onClick={onMoveUp}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={!canDown || !!busy}
              className="rounded border border-white/15 px-1.5 py-0.5 text-[11px] leading-none disabled:opacity-30"
              onClick={onMoveDown}
            >
              ↓
            </button>
          </div>
        ) : null}
        <div className="flex shrink-0 gap-1">
          {frame.stillUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={frame.stillUrl}
              alt=""
              draggable={false}
              title="Увеличить"
              className="h-20 w-14 cursor-zoom-in rounded object-cover bg-zinc-800"
              onClick={() => onOpenMedia(frame.stillUrl!, "photo")}
            />
          ) : (
            <div className="h-20 w-14 rounded bg-zinc-800" />
          )}
          {frame.clipUrl ? (
            <video
              src={frame.clipUrl}
              title="Открыть видео"
              draggable={false}
              className="h-20 w-14 cursor-zoom-in rounded object-cover bg-zinc-800"
              muted
              playsInline
              onClick={() => onOpenMedia(frame.clipUrl!, "video")}
            />
          ) : (
            <div className="h-20 w-14 rounded bg-zinc-900 flex items-center justify-center text-[10px] text-zinc-600">
              {frame.clipStatus === "pending"
                ? "…"
                : frame.clipError
                  ? "err"
                  : "нет видео"}
            </div>
          )}
        </div>
        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={onSelect}
          onKeyDown={(e) => e.key === "Enter" && onSelect()}
          role="button"
          tabIndex={0}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">#{frame.index + 1}</span>
            {approved ? (
              <span className="rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-300">
                ✓
              </span>
            ) : null}
            {!readOnly ? <span className="text-[10px] text-zinc-600">порядок ←</span> : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{frame.beat || frame.title || "—"}</p>
          <p className="mt-0.5 text-[11px] text-zinc-400">{frameCastLabel(frame, slots)}</p>
          {!readOnly ? (
            <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={!!busy}
                className="rounded bg-white/10 px-2 py-0.5 text-[10px]"
                onClick={onCast}
              >
                Кто / одежда
              </button>
              {hasBoth && !approved ? (
                <button
                  type="button"
                  disabled={!!busy}
                  className="rounded bg-emerald-800/80 px-2 py-0.5 text-[10px] text-white"
                  onClick={onApprove}
                >
                  Одобрить
                </button>
              ) : null}
              {frame.stillItemId && frame.clipStatus !== "pending" ? (
                <button
                  type="button"
                  disabled={!!busy}
                  className="rounded bg-white/10 px-2 py-0.5 text-[10px]"
                  onClick={onAnimate}
                >
                  {frame.clipStatus === "ready" ? "Переген. ролик" : "Оживить"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={!!busy}
                className="rounded border border-red-900/50 px-2 py-0.5 text-[10px] text-red-300"
                onClick={onDelete}
              >
                Убрать
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
