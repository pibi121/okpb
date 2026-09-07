"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrientationSelect } from "@/components/orientation-select";
import type { VideoOrientationId } from "@/lib/video-orientation";
import { clipCost, SKU } from "@/lib/peach-economics";
import {
  PEACH_VIDEO_RESTORE_EVENT,
  PEACH_VIDEO_TEMPLATE_APPLY_EVENT,
  type QuickVideoTemplateUsePayload,
  type VideoRestorePayload,
} from "@/lib/generation-restore";
import { QuickVideoSaveTemplateModal } from "@/components/quick-video-save-template-modal";
import type { TemplateSlotBlueprint } from "@/lib/quick-video-template";
import {
  composeQuickVideoMultiShotPrompt,
  defaultQuickVideoShots,
  EXTRA_SLOT_ROLE_OPTIONS,
  EXTRA_SLOT_START,
  fixedSlotRoleForIndex,
  IDENTITY_SLOT_COUNT,
  isReservedSlotIndex,
  LOCATION_SLOT_INDEX,
  MAX_QUICK_VIDEO_PICTURES,
  MIN_QUICK_VIDEO_SLOTS,
  parseQuickVideoShotsPlan,
  sumQuickVideoShotsSec,
  buildQuickVideoLegoContext,
  type QuickVideoImageSlot,
  type QuickVideoShotsPlan,
  type QuickVideoSlotRole,
} from "@/lib/quick-video-prompt";
import { QuickVideoShotsEditor } from "@/components/quick-video-shots-editor";
import { QuickVideoCustomModal } from "@/components/quick-video-custom-modal";
import type { LegoCharacterRef, VideoLegoFile } from "@/lib/prompt-lego-core";
import {
  createCustomCharacterId,
  filterDbCharacterIds,
  isCustomCharacterId,
  MAX_CUSTOM_CHARACTER_REFS,
  type QuickVideoCustomCharacter,
} from "@/lib/quick-video-custom-character";

type CharacterProp = LegoCharacterRef & {
  photoCount: number;
  refPhotoCount?: number;
  loraStatus: string;
};


type CharacterPhoto = { name: string; url: string };

type QuickRun = {
  id: string;
  title: string;
  status: string;
  prompt: string;
  composedPrompt: string;
  characterIds: string[];
  refImageUrls: string[];
  refVideoUrl: string;
  refSlots: QuickVideoImageSlot[];
  resultVideoUrl: string;
  width: number;
  height: number;
  durationSec: number;
  orientation: string;
  error: string | null;
  engine: string | null;
  createdAt: string;
};

type CustomCharacterState = QuickVideoCustomCharacter & {
  files: File[];
};

type UiSlot = {
  role: QuickVideoSlotRole;
  label: string;
  file: File | null;
  previewUrl: string | null;
};

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

const STATUS: Record<string, string> = {
  busy: "Генерирую видео…",
  ready: "Готово",
  error: "Ошибка",
};

function emptySlots(): UiSlot[] {
  return Array.from({ length: MIN_QUICK_VIDEO_SLOTS }, (_, i) => ({
    role: fixedSlotRoleForIndex(i),
    label: "",
    file: null,
    previewUrl: null,
  }));
}

function makeExtraSlot(index: number): UiSlot {
  return {
    role: fixedSlotRoleForIndex(index),
    label: "",
    file: null,
    previewUrl: null,
  };
}

function applyIdentityPicksToSlots(
  prev: UiSlot[],
  picks: Array<{ name: string; blob: Blob; characterName: string }>,
): UiSlot[] {
  const next =
    prev.length >= MIN_QUICK_VIDEO_SLOTS
      ? prev.map((s) => ({ ...s }))
      : emptySlots();
  let pi = 0;
  for (const pick of picks) {
    if (pi >= IDENTITY_SLOT_COUNT) break;
    const old = next[pi]!;
    if (old.previewUrl) URL.revokeObjectURL(old.previewUrl);
    const file = new File([pick.blob], pick.name, {
      type: pick.blob.type || "image/png",
    });
    next[pi] = {
      role: "identity",
      label: pick.characterName,
      file,
      previewUrl: URL.createObjectURL(file),
    };
    pi += 1;
  }
  return next;
}

async function blobFromUrl(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function restoreSlotsFromRun(run: QuickRun): Promise<UiSlot[]> {
  const urls = run.refImageUrls || [];
  const metas = run.refSlots || [];
  if (!urls.length) return emptySlots();

  const next = emptySlots();
  let identityFallback = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;
    const meta = metas[i];
    const roleRaw = (meta?.role || meta?.kind || "other") as string;
    const role = (
      roleRaw === "extra" ? "other" : roleRaw
    ) as QuickVideoSlotRole;

    let slotIdx = meta?.pictureIndex ? meta.pictureIndex - 1 : -1;
    if (slotIdx < 0 || slotIdx >= MAX_QUICK_VIDEO_PICTURES) {
      if (role === "location") slotIdx = LOCATION_SLOT_INDEX - 1;
      else if (role === "identity") {
        slotIdx = Math.min(identityFallback, IDENTITY_SLOT_COUNT - 1);
        identityFallback += 1;
      } else {
        slotIdx = Math.min(
          EXTRA_SLOT_START - 1 + i,
          MAX_QUICK_VIDEO_PICTURES - 1,
        );
      }
    }

    const blob = await blobFromUrl(url);
    if (!blob) continue;
    const enforcedRole = isReservedSlotIndex(slotIdx)
      ? fixedSlotRoleForIndex(slotIdx)
      : role;
    next[slotIdx] = {
      role: enforcedRole,
      label: meta?.characterName || meta?.label || "",
      file: new File([blob], `ref_${slotIdx}.png`, {
        type: blob.type || "image/png",
      }),
      previewUrl: URL.createObjectURL(blob),
    };
  }

  return next;
}

async function restoreCustomCharacterFromRun(
  run: QuickRun,
  customCharacters?: Array<{ id: string; name: string }>,
): Promise<CustomCharacterState | null> {
  const customId = run.characterIds.find(isCustomCharacterId);
  if (!customId) return null;

  const name =
    customCharacters?.find((c) => c.id === customId)?.name ||
    run.refSlots?.find((s) => s.role === "identity" || s.kind === "identity")
      ?.characterName ||
    run.refSlots?.find((s) => s.role === "identity" || s.kind === "identity")
      ?.label ||
    "Custom";

  const files: File[] = [];
  for (let i = 0; i < (run.refImageUrls?.length || 0); i++) {
    const meta = run.refSlots?.[i];
    const role = meta?.role || meta?.kind;
    if (role !== "identity") continue;
    const url = run.refImageUrls[i];
    if (!url) continue;
    const blob = await blobFromUrl(url);
    if (!blob) continue;
    files.push(
      new File([blob], `custom_${files.length}.png`, {
        type: blob.type || "image/png",
      }),
    );
  }

  if (!files.length) return { id: customId, name, files: [] };
  return { id: customId, name, files };
}

function applyShotsFromPrompt(
  prompt: string,
  durationSec?: number,
): QuickVideoShotsPlan | null {
  const plan = parseQuickVideoShotsPlan(prompt);
  if (plan) return plan;
  if (durationSec) {
    return {
      totalDurationSec: durationSec,
      shots: [{ id: "shot-1", durationSec, legoQuery: prompt || "" }],
    };
  }
  return null;
}

function locationRefTag(pictureIndex: number) {
  return `[location-ref:${pictureIndex}]`;
}

function legoHasLocationRef(legoQuery: string, pictureIndex: number) {
  return legoQuery.includes(`location-ref:${pictureIndex}`);
}

async function buildSlotsFromBlueprint(
  blueprint: TemplateSlotBlueprint[],
  identityFiles: File[],
  locationFile: File | null,
  defaultLocationUrl: string,
): Promise<UiSlot[]> {
  const next = emptySlots();
  let identityIdx = 0;
  let extraIdx = EXTRA_SLOT_START - 1;

  for (const bp of blueprint) {
    if (bp.role === "identity") {
      if (identityIdx >= IDENTITY_SLOT_COUNT) continue;
      const file = identityFiles[identityIdx++] || null;
      next[identityIdx - 1] = {
        role: "identity",
        label: bp.label || "",
        file,
        previewUrl: file ? URL.createObjectURL(file) : null,
      };
      continue;
    }
    if (bp.role === "location") {
      let file: File | null = locationFile;
      if (!file) {
        const url = bp.bakedRefUrl || defaultLocationUrl;
        if (url) {
          const blob = await blobFromUrl(url);
          if (blob) {
            file = new File([blob], "location.png", {
              type: blob.type || "image/png",
            });
          }
        }
      }
      next[LOCATION_SLOT_INDEX - 1] = {
        role: "location",
        label: bp.label || "",
        file,
        previewUrl: file ? URL.createObjectURL(file) : null,
      };
      continue;
    }
    if (bp.bakedRefUrl && extraIdx < MAX_QUICK_VIDEO_PICTURES) {
      const blob = await blobFromUrl(bp.bakedRefUrl);
      if (blob) {
        const file = new File([blob], `${bp.role}.png`, {
          type: blob.type || "image/png",
        });
        if (extraIdx >= next.length) {
          next.push(makeExtraSlot(extraIdx));
        }
        next[extraIdx] = {
          role: bp.role,
          label: bp.label || "",
          file,
          previewUrl: URL.createObjectURL(file),
        };
        extraIdx += 1;
      }
    }
  }
  return next;
}

function SlotCard({
  index,
  slot,
  compact,
  roleLocked,
  roleLabel,
  onUpdate,
  onClear,
  onInsertTag,
}: {
  index: number;
  slot: UiSlot;
  compact: boolean;
  roleLocked?: boolean;
  roleLabel?: string;
  onUpdate: (index: number, patch: Partial<UiSlot>) => void;
  onClear: (index: number) => void;
  onInsertTag: (tag: string) => void;
}) {
  const n = index + 1;
  const tag = `<Picture ${n}>`;
  const cardClass = compact
    ? "flex w-[88px] shrink-0 flex-col gap-1 rounded-lg border border-white/10 bg-[#0c0c0e] p-1.5"
    : "flex w-[88px] shrink-0 flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-50/60 p-1.5";
  const inputClass = compact
    ? "w-full rounded border border-white/10 bg-[#0c0c0e] px-1.5 py-1 text-[11px]"
    : "w-full rounded border bg-white px-1.5 py-1 text-[11px]";
  const dropClass = compact
    ? "relative flex h-[72px] w-[72px] cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-white/15 bg-[#08080a]"
    : "relative flex h-[72px] w-[72px] cursor-pointer items-center justify-center overflow-hidden rounded border border-dashed border-zinc-300 bg-white";

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onInsertTag(tag)}
          className="rounded bg-violet-700 px-1.5 py-0.5 font-mono text-[10px] text-white"
          title="Вставить тег в промпт"
        >
          {tag}
        </button>
        {slot.file ? (
          <button
            type="button"
            onClick={() => onClear(index)}
            className="text-[10px] text-zinc-500 underline"
          >
            убрать
          </button>
        ) : null}
      </div>
      <label className={dropClass}>
        {slot.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.previewUrl}
            alt={tag}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="px-2 text-center text-[11px] text-zinc-400">
            Загрузить
          </span>
        )}
        <input
          type="file"
          accept="image/*"
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            onUpdate(index, { file: f });
            e.target.value = "";
          }}
        />
      </label>
      {roleLocked ? (
        <p className="text-center text-[10px] text-zinc-500">{roleLabel}</p>
      ) : (
        <select
          className={inputClass}
          value={slot.role}
          onChange={(e) =>
            onUpdate(index, { role: e.target.value as QuickVideoSlotRole })
          }
        >
          {EXTRA_SLOT_ROLE_OPTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      )}
      <input
        className={inputClass}
        placeholder="Подпись"
        value={slot.label}
        onChange={(e) => onUpdate(index, { label: e.target.value })}
      />
    </div>
  );
}

export function QuickVideoLab({
  characters,
  videoLego,
  compact = false,
  onRunStarted,
}: {
  characters: CharacterProp[];
  videoLego: VideoLegoFile;
  compact?: boolean;
  onRunStarted?: () => void;
}) {
  const [runs, setRuns] = useState<QuickRun[]>([]);
  const [title, setTitle] = useState("Quick video");
  const [shotsPlan, setShotsPlan] = useState<QuickVideoShotsPlan>(() =>
    defaultQuickVideoShots(6),
  );
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<UiSlot[]>(() => emptySlots());
  const autoFillRef = useRef(false);
  const [poseVideo, setPoseVideo] = useState<File | null>(null);
  const [orientation, setOrientation] = useState<VideoOrientationId>("9_16");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [startedMsg, setStartedMsg] = useState("");
  const [customCharacter, setCustomCharacter] = useState<CustomCharacterState | null>(
    null,
  );
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [sourceRunId, setSourceRunId] = useState<string | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);

  const editorCharacters = useMemo((): LegoCharacterRef[] => {
    const base = characters.map((c) => ({
      id: c.id,
      name: c.name,
      gender: c.gender,
      triggerWord: c.triggerWord,
    }));
    if (customCharacter) {
      base.push({
        id: customCharacter.id,
        name: customCharacter.name,
        gender: "female",
        triggerWord: null,
      });
    }
    return base;
  }, [characters, customCharacter]);

  const legoCtx = useMemo(
    () => buildQuickVideoLegoContext({ videoLego, characters: editorCharacters }),
    [videoLego, editorCharacters],
  );

  const usedShotSec = useMemo(
    () => sumQuickVideoShotsSec(shotsPlan.shots),
    [shotsPlan.shots],
  );

  const genDurationSec = Math.max(4, usedShotSec || shotsPlan.totalDurationSec);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/peach/quick-video/runs");
    const data = await readJson(res);
    if (!res.ok) throw new Error(String(data.error || "ошибка"));
    setRuns((data.runs as QuickRun[]) || []);
  }, []);

  const applyVideoRestore = useCallback(
    async (payload: VideoRestorePayload) => {
      if (payload.title) setTitle(payload.title);
      if (payload.characterIds?.length) setCharacterIds(payload.characterIds);
      if (payload.orientation) {
        setOrientation(payload.orientation as VideoOrientationId);
      }
      if (payload.durationSec) {
        setShotsPlan(defaultQuickVideoShots(payload.durationSec));
      }

      const shotsRaw = payload.shotsJson || payload.prompt || "";
      const planFromPayload = applyShotsFromPrompt(
        shotsRaw,
        payload.durationSec,
      );
      if (planFromPayload) setShotsPlan(planFromPayload);

      let run: QuickRun | null = null;
      if (payload.runId) {
        try {
          const d = await fetch("/api/peach/quick-video/runs").then((r) =>
            r.json(),
          );
          run =
            ((d.runs as QuickRun[]) || []).find((x) => x.id === payload.runId) ||
            null;
        } catch {
          run = null;
        }
      }

      const revokeSlotPreviews = () => {
        setSlots((prev) => {
          for (const s of prev) {
            if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
          }
          return prev;
        });
      };

      if (run) {
        setTitle(run.title || payload.title || "Quick video");
        setCharacterIds(run.characterIds || payload.characterIds || []);
        if (run.orientation) setOrientation(run.orientation as VideoOrientationId);
        const plan = applyShotsFromPrompt(run.prompt, run.durationSec);
        if (plan) setShotsPlan(plan);

        const custom = await restoreCustomCharacterFromRun(
          run,
          payload.customCharacters,
        );
        if (custom) setCustomCharacter(custom);

        revokeSlotPreviews();
        const nextSlots = await restoreSlotsFromRun(run);
        if (nextSlots.some((s) => s.file)) setSlots(nextSlots);

        if (run.refVideoUrl) {
          const blob = await blobFromUrl(run.refVideoUrl);
          if (blob) {
            setPoseVideo(
              new File([blob], "pose.mp4", { type: blob.type || "video/mp4" }),
            );
          }
        } else {
          setPoseVideo(null);
        }
        if (run.status === "ready") setSourceRunId(run.id);
        setStartedMsg("Настройки загружены — можно редактировать и запустить снова");
        setError("");
        return;
      }

      if (payload.customCharacters?.length) {
        const c = payload.customCharacters[0]!;
        if (isCustomCharacterId(c.id)) {
          setCustomCharacter((prev) =>
            prev?.id === c.id
              ? prev
              : { id: c.id, name: c.name, files: prev?.files || [] },
          );
        }
      }

      if (payload.refImageUrls?.length) {
        const pseudoRun: QuickRun = {
          id: "",
          title: payload.title || "Quick video",
          status: "ready",
          prompt: shotsRaw,
          composedPrompt: "",
          characterIds: payload.characterIds || [],
          refImageUrls: payload.refImageUrls,
          refVideoUrl: payload.refVideoUrl || "",
          refSlots: payload.refSlots || [],
          resultVideoUrl: "",
          width: 0,
          height: 0,
          durationSec: payload.durationSec || 6,
          orientation: payload.orientation || "9_16",
          error: null,
          engine: null,
          createdAt: "",
        };
        const custom = await restoreCustomCharacterFromRun(
          pseudoRun,
          payload.customCharacters,
        );
        if (custom) setCustomCharacter(custom);
        revokeSlotPreviews();
        const nextSlots = await restoreSlotsFromRun(pseudoRun);
        if (nextSlots.some((s) => s.file)) setSlots(nextSlots);
      }

      if (payload.refVideoUrl) {
        const blob = await blobFromUrl(payload.refVideoUrl);
        if (blob) {
          setPoseVideo(
            new File([blob], "pose.mp4", { type: blob.type || "video/mp4" }),
          );
        }
      } else {
        setPoseVideo(null);
      }
      setStartedMsg("Настройки загружены — можно редактировать и запустить снова");
      setError("");
    },
    [compact],
  );

  const applyVideoTemplate = useCallback(
    async (payload: QuickVideoTemplateUsePayload) => {
      setTitle(payload.title);
      setOrientation(payload.orientation as VideoOrientationId);
      const plan = applyShotsFromPrompt(payload.shotsJson, payload.durationSec);
      if (plan) setShotsPlan(plan);
      setSourceRunId(null);

      setSlots((prev) => {
        for (const s of prev) {
          if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
        }
        return prev;
      });

      const nextSlots = await buildSlotsFromBlueprint(
        payload.slotBlueprint,
        payload.identityMode === "custom" ? payload.identityFiles || [] : [],
        payload.locationFile ?? null,
        payload.defaultLocationUrl,
      );
      setSlots(nextSlots);

      if (payload.refVideoUrl) {
        const blob = await blobFromUrl(payload.refVideoUrl);
        if (blob) {
          setPoseVideo(
            new File([blob], "pose.mp4", { type: blob.type || "video/mp4" }),
          );
        }
      } else {
        setPoseVideo(null);
      }

      if (payload.identityMode === "character") {
        setCustomCharacter(null);
        setCharacterIds(payload.characterIds || []);
      } else {
        const id = createCustomCharacterId();
        const name = payload.customName || "Model";
        const files = payload.identityFiles || [];
        setCustomCharacter({ id, name, files });
        setCharacterIds([id]);
      }

      setStartedMsg("Шаблон загружен — можно редактировать и запустить");
      setError("");
    },
    [compact],
  );

  useEffect(() => {
    void refresh().catch((e) =>
      setError(e instanceof Error ? e.message : "error"),
    );
  }, [refresh]);

  useEffect(() => {
    // Legacy: drop stale sessionStorage restores (refresh should start clean).
    try {
      sessionStorage.removeItem("peach-restore-video");
    } catch {
      /* ignore */
    }

    const onRestore = (event: Event) => {
      const payload = (event as CustomEvent<VideoRestorePayload>).detail;
      if (!payload) return;
      void applyVideoRestore(payload).catch(() =>
        setError("Не удалось загрузить настройки"),
      );
    };
    window.addEventListener(PEACH_VIDEO_RESTORE_EVENT, onRestore);
    const onTemplate = (event: Event) => {
      const payload = (event as CustomEvent<QuickVideoTemplateUsePayload>).detail;
      if (!payload) return;
      void applyVideoTemplate(payload).catch(() =>
        setError("Не удалось применить шаблон"),
      );
    };
    window.addEventListener(PEACH_VIDEO_TEMPLATE_APPLY_EVENT, onTemplate);
    return () => {
      window.removeEventListener(PEACH_VIDEO_RESTORE_EVENT, onRestore);
      window.removeEventListener(PEACH_VIDEO_TEMPLATE_APPLY_EVENT, onTemplate);
    };
  }, [applyVideoRestore, applyVideoTemplate]);

  useEffect(() => {
    if (!compact || !characterIds.length) return;
    if (autoFillRef.current) return;
    autoFillRef.current = true;
    void fillFromCharacters().finally(() => {
      autoFillRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterIds.join(","), compact, customCharacter?.id]);

  useEffect(() => {
    const anyBusy = runs.some((r) => r.status === "busy");
    if (!anyBusy) return;
    const t = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [runs, refresh]);

  useEffect(() => {
    return () => {
      for (const s of slots) {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filledSlots = useMemo(
    () =>
      slots
        .map((s, i) => ({ s, pictureIndex: i + 1 }))
        .filter((row) => row.s.file),
    [slots],
  );

  const previewSlots: QuickVideoImageSlot[] = useMemo(
    () =>
      filledSlots.map((row) => ({
        kind: row.s.role === "identity" ? "identity" : row.s.role,
        role: row.s.role,
        label: row.s.label,
        characterName: row.s.role === "identity" ? row.s.label : undefined,
        pictureIndex: row.pictureIndex,
      })),
    [filledSlots],
  );

  const pictureRemap = useMemo(() => {
    const m = new Map<number, number>();
    filledSlots.forEach((row, neu) => m.set(row.pictureIndex, neu + 1));
    return m;
  }, [filledSlots]);

  const composedPreview = useMemo(
    () =>
      composeQuickVideoMultiShotPrompt(
        shotsPlan,
        previewSlots,
        poseVideo ? 1 : 0,
        legoCtx,
        { pictureRemap },
      ),
    [shotsPlan, previewSlots, poseVideo, pictureRemap, legoCtx],
  );

  const hasShotContent = shotsPlan.shots.some((s) => s.legoQuery.trim().length > 0);
  const overBudget = usedShotSec > shotsPlan.totalDurationSec;

  const activeRun = useMemo(
    () => runs.find((r) => r.status === "busy") || runs[0],
    [runs],
  );

  const canStart =
    filledSlots.length > 0 ||
    characterIds.some(isCustomCharacterId) ||
    filterDbCharacterIds(characterIds).length > 0;

  function toggleCharacter(id: string) {
    if (isCustomCharacterId(id) && !customCharacter) return;
    setCharacterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function applyCustomToSlots(state: CustomCharacterState) {
    const picks = state.files.slice(0, MAX_CUSTOM_CHARACTER_REFS).map((file, i) => ({
      name: file.name || `custom_ref_${i}.png`,
      blob: file,
      characterName: state.name,
    }));
    setSlots((prev) => applyIdentityPicksToSlots(prev, picks));
  }

  function handleCustomSave(payload: { character: QuickVideoCustomCharacter; files: File[] }) {
    const id = customCharacter?.id || createCustomCharacterId();
    const next: CustomCharacterState = {
      id,
      name: payload.character.name,
      files: payload.files.slice(0, MAX_CUSTOM_CHARACTER_REFS),
    };
    setCustomCharacter(next);
    setCharacterIds((prev) => {
      const db = filterDbCharacterIds(prev);
      return [...db, id];
    });
    applyCustomToSlots(next);
    setCustomModalOpen(false);
    setError("");
  }

  function ensureLocationRefInShots(pictureIndex: number) {
    setShotsPlan((prev) => {
      const shots = [...prev.shots];
      const cur = shots[0]?.legoQuery || "";
      if (legoHasLocationRef(cur, pictureIndex)) return prev;
      const tag = locationRefTag(pictureIndex);
      const sep = !cur || /\s$/.test(cur) ? "" : " ";
      shots[0] = {
        ...(shots[0] || {
          id: "shot-1",
          durationSec: prev.totalDurationSec,
          legoQuery: "",
        }),
        legoQuery: `${cur}${sep}${tag}`,
      };
      return { ...prev, shots };
    });
  }

  function updateSlot(index: number, patch: Partial<UiSlot>) {
    setSlots((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      if (patch.file !== undefined && cur.previewUrl) {
        URL.revokeObjectURL(cur.previewUrl);
      }
      const enforcedRole = fixedSlotRoleForIndex(index);
      const merged: UiSlot = {
        ...cur,
        ...patch,
        role: isReservedSlotIndex(index) ? enforcedRole : (patch.role ?? cur.role),
        previewUrl:
          patch.file === null
            ? null
            : patch.file
              ? URL.createObjectURL(patch.file)
              : patch.previewUrl !== undefined
                ? patch.previewUrl
                : cur.previewUrl,
      };
      next[index] = merged;
      if (
        index === LOCATION_SLOT_INDEX - 1 &&
        merged.role === "location" &&
        merged.file
      ) {
        queueMicrotask(() => ensureLocationRefInShots(LOCATION_SLOT_INDEX));
      }
      return next;
    });
  }

  function clearSlot(index: number) {
    updateSlot(index, { file: null, previewUrl: null });
  }

  function insertPictureTag(tag: string) {
    setShotsPlan((prev) => {
      const shots = [...prev.shots];
      const i = 0;
      const cur = shots[i]?.legoQuery || "";
      const sep = !cur || /\s$/.test(cur) ? "" : " ";
      shots[i] = {
        ...(shots[i] || { id: "shot-1", durationSec: prev.totalDurationSec, legoQuery: "" }),
        legoQuery: `${cur}${sep}${tag}`,
      };
      return { ...prev, shots };
    });
  }

  function addSlot() {
    if (slots.length >= MAX_QUICK_VIDEO_PICTURES) return;
    setSlots((prev) => [...prev, makeExtraSlot(prev.length)]);
  }

  async function fillFromCharacters() {
    const dbIds = filterDbCharacterIds(characterIds);
    const customId = characterIds.find(isCustomCharacterId);
    if (!dbIds.length && !customId) {
      setError("Сначала выбери персонажа или создай Custom");
      return;
    }
    setError("");
    try {
      const picks: Array<{ name: string; blob: Blob; characterName: string }> =
        [];

      if (customId && customCharacter?.id === customId) {
        for (const file of customCharacter.files.slice(0, IDENTITY_SLOT_COUNT)) {
          picks.push({
            name: file.name || "custom.png",
            blob: file,
            characterName: customCharacter.name,
          });
        }
      }

      for (const id of dbIds) {
        const ch = characters.find((c) => c.id === id);
        const res = await fetch(`/api/characters/${id}/refs`);
        const data = await readJson(res);
        if (!res.ok) continue;
        const photos = (data.refs as CharacterPhoto[]) || [];
        if (!photos.length) continue;
        const room = IDENTITY_SLOT_COUNT - picks.length;
        if (room <= 0) break;
        for (const p of photos.slice(0, room)) {
          const imgRes = await fetch(p.url);
          const blob = await imgRes.blob();
          picks.push({
            name: p.name || "identity.png",
            blob,
            characterName: ch?.name || id,
          });
        }
      }

      if (!picks.length) {
        setError(
          customId
            ? "У Custom нет референсов — открой + Custom и добавь фото"
            : "У выбранных персонажей нет референсов — сгенерируй базовые ракурсы в Персонажах",
        );
        return;
      }

      setSlots((prev) => applyIdentityPicksToSlots(prev, picks));
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    }
  }

  async function startRun() {
    if (!canStart) {
      setError("Заполни хотя бы один слот <Picture N> или выбери персонажа");
      return;
    }
    if (!hasShotContent) {
      setError("Добавь блоки или текст хотя бы в одном шоте");
      return;
    }
    if (overBudget) {
      setError("Сумма шотов больше общей длительности");
      return;
    }
    setBusy(true);
    setError("");
    setStartedMsg("");
    try {
      const form = new FormData();
      form.set("title", title.trim() || "Quick video");
      form.set("shotsJson", JSON.stringify(shotsPlan));
      form.set("orientation", orientation);
      form.set("durationSec", String(genDurationSec));
      form.set("characterIds", JSON.stringify(characterIds));
      if (customCharacter) {
        form.set(
          "customCharacters",
          JSON.stringify([{ id: customCharacter.id, name: customCharacter.name }]),
        );
      }

      const slotMeta: Array<{
        pictureIndex: number;
        role: QuickVideoSlotRole;
        label?: string;
        characterName?: string;
      }> = [];

      slots.forEach((s, i) => {
        if (!s.file) return;
        const pictureIndex = i + 1;
        form.append(`picture_${pictureIndex}`, s.file);
        slotMeta.push({
          pictureIndex,
          role: s.role,
          label: s.label.trim() || undefined,
          characterName:
            s.role === "identity" ? s.label.trim() || undefined : undefined,
        });
      });
      form.set("slotMeta", JSON.stringify(slotMeta));
      if (poseVideo) form.append("poseVideo", poseVideo);

      const res = await fetch("/api/peach/quick-video/runs", {
        method: "POST",
        body: form,
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setStartedMsg("Видео в очереди — смотри блок «Сегодня» ниже");
      onRunStarted?.();
      document.getElementById("today-generations")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  const videoCost = clipCost(genDurationSec);
  const panelClass = compact
    ? "flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4"
    : "flex flex-col gap-3 rounded-lg border border-violet-200 bg-white p-4";
  const inputClass = compact
    ? "mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
    : "mt-1 w-full rounded-md border px-3 py-2 text-sm";

  return (
    <div
      id="quick-video-editor"
      className={compact ? "flex flex-col gap-4" : "grid gap-4 lg:grid-cols-2"}
    >
      <div className={panelClass}>
        {!compact ? (
          <div>
            <h3 className="font-medium">Быстрое видео · референсы</h3>
            <p className="mt-1 text-xs text-zinc-600">
              Picture 1–3 — персонаж, Picture 4 — локация, 5+ — по желанию. Тег{" "}
              <code className="rounded bg-zinc-100 px-1">&lt;Picture N&gt;</code> в описании.
            </p>
          </div>
        ) : null}

        {!compact ? (
          <label className="text-sm">
            Название
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        ) : null}

        <div className="text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-zinc-400">Персонаж</div>
            {!compact ? (
              <button
                type="button"
                onClick={() => void fillFromCharacters()}
                className="rounded border border-violet-300 px-2 py-1 text-[11px] text-violet-800 hover:bg-violet-50"
              >
                Заполнить слоты из персонажа
              </button>
            ) : null}
          </div>
          {characters.length || customCharacter ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCustomModalOpen(true)}
                className={`rounded-full border border-dashed px-3 py-1 text-xs font-medium ${
                  compact
                    ? "border-peach/50 text-peach hover:bg-peach/10"
                    : "border-peach/60 text-peach-700 hover:bg-peach/5"
                }`}
              >
                + Custom
              </button>
              {customCharacter ? (
                <button
                  type="button"
                  onClick={() => toggleCharacter(customCharacter.id)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    characterIds.includes(customCharacter.id)
                      ? compact
                        ? "border-peach bg-peach/15 text-peach"
                        : "border-peach bg-peach/10 text-peach-900"
                      : compact
                        ? "border-peach/30 bg-[#0c0c0e] text-zinc-300"
                        : "border-peach/40 bg-white text-zinc-700"
                  }`}
                >
                  {customCharacter.name}
                  <span className="opacity-70"> · custom · {customCharacter.files.length} реф.</span>
                </button>
              ) : null}
              {characters.map((c) => {
                const on = characterIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCharacter(c.id)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      on
                        ? compact
                          ? "border-violet-500 bg-violet-950/40 text-violet-200"
                          : "border-violet-600 bg-violet-50 text-violet-900"
                        : compact
                          ? "border-white/15 bg-[#0c0c0e] text-zinc-300"
                          : "border-zinc-300 bg-white text-zinc-700"
                    }`}
                  >
                    {c.name}
                    {(c.refPhotoCount ?? c.photoCount)
                      ? ` · ${c.refPhotoCount ?? c.photoCount} реф.`
                      : " · нет реф."}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCustomModalOpen(true)}
                className="rounded-full border border-dashed border-peach/50 px-3 py-1 text-xs font-medium text-peach hover:bg-peach/10"
              >
                + Custom
              </button>
              <p className="text-xs text-zinc-500 self-center">
                или загрузи рефы в Picture ниже
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-400">
              Референсы ({filledSlots.length}/{MAX_QUICK_VIDEO_PICTURES})
            </div>
            <button
              type="button"
              className="text-[11px] text-zinc-500 underline"
              onClick={() => {
                setSlots((prev) => {
                  for (const s of prev) {
                    if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
                  }
                  return emptySlots();
                });
              }}
            >
              Очистить
            </button>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">
              Персонаж · Picture 1–3
            </p>
            <div className="flex flex-wrap gap-2">
              {slots.slice(0, IDENTITY_SLOT_COUNT).map((slot, i) => (
                <SlotCard
                  key={i + 1}
                  index={i}
                  slot={slot}
                  compact={compact}
                  roleLocked
                  roleLabel="Личность / лицо"
                  onUpdate={updateSlot}
                  onClear={clearSlot}
                  onInsertTag={insertPictureTag}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">
              Локация · Picture {LOCATION_SLOT_INDEX}
            </p>
            <div className="flex flex-wrap gap-2">
              <SlotCard
                index={LOCATION_SLOT_INDEX - 1}
                slot={slots[LOCATION_SLOT_INDEX - 1]!}
                compact={compact}
                roleLocked
                roleLabel="Локация / окружение"
                onUpdate={updateSlot}
                onClear={clearSlot}
                onInsertTag={insertPictureTag}
              />
            </div>
          </div>

          {slots.length > MIN_QUICK_VIDEO_SLOTS ? (
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-500">
                Дополнительно · Picture {EXTRA_SLOT_START}+
              </p>
              <div className="flex flex-wrap gap-2">
                {slots.slice(MIN_QUICK_VIDEO_SLOTS).map((slot, offset) => {
                  const i = MIN_QUICK_VIDEO_SLOTS + offset;
                  return (
                    <SlotCard
                      key={i + 1}
                      index={i}
                      slot={slot}
                      compact={compact}
                      onUpdate={updateSlot}
                      onClear={clearSlot}
                      onInsertTag={insertPictureTag}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          {slots.length < MAX_QUICK_VIDEO_PICTURES ? (
            <button
              type="button"
              onClick={addSlot}
              className={
                compact
                  ? "rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-zinc-400 hover:border-peach/40 hover:text-peach"
                  : "rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-600 hover:border-violet-400 hover:text-violet-800"
              }
            >
              + Доп. реф (Picture {slots.length + 1})
            </button>
          ) : null}

          <p className="text-[10px] text-zinc-500">
            Picture 1–3 — лицо и тело. Picture 4 — место съёмки. Picture 5+ —
            анатомия, поза, реквизит. Пустые слоты не отправляются.
          </p>
        </div>

        {!compact ? (
          <label className="text-sm">
            Реф-поза видео (опционально)
            <input
              type="file"
              accept="video/*"
              className="mt-1 block w-full text-sm"
              onChange={(e) =>
                setPoseVideo(e.target.files?.[0] ? e.target.files[0] : null)
              }
            />
          </label>
        ) : null}

        <div>
          <div className="mb-1.5 text-sm text-zinc-500">Сцена · шоты</div>
          <QuickVideoShotsEditor
            plan={shotsPlan}
            onChange={setShotsPlan}
            selectedCharacterIds={characterIds}
            characters={editorCharacters}
            videoLego={videoLego}
            disabled={busy}
          />
        </div>

        {!compact ? (
          <details className="rounded border border-violet-100 bg-violet-50/40 p-2 text-xs">
            <summary className="cursor-pointer font-medium text-violet-900">
              Превью промпта
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-700">
              {composedPreview || "—"}
            </pre>
          </details>
        ) : (
          <details className="rounded border border-white/10 bg-[#0a0a0c] p-2 text-xs">
            <summary className="cursor-pointer text-zinc-400">Превью промпта</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-600">
              {composedPreview || "—"}
            </pre>
          </details>
        )}

        <label className="text-sm">
          <span className="text-zinc-500">Ориентация</span>
          <div className="mt-1">
            <OrientationSelect value={orientation} onChange={setOrientation} className={inputClass} />
          </div>
        </label>

        {error ? (
          <p className="rounded border border-red-400/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {startedMsg ? (
          <p className="rounded border border-emerald-400/30 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-300">
            {startedMsg}
          </p>
        ) : null}

        {sourceRunId ? (
          <button
            type="button"
            onClick={() => setSaveTemplateOpen(true)}
            className="rounded-full border border-peach/40 px-4 py-2 text-sm text-peach hover:bg-peach/10"
          >
            Сохранить как шаблон
          </button>
        ) : null}

        <button
          type="button"
          disabled={busy || !canStart}
          onClick={() => void startRun()}
          className={
            compact
              ? "rounded-full bg-peach px-4 py-2.5 text-sm font-medium text-black disabled:opacity-50"
              : "rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          }
        >
          {busy ? "Запуск…" : `Сгенерировать видео (${videoCost} кр.)`}
        </button>
      </div>

      {!compact ? (
      <div className="flex flex-col gap-3 rounded-lg border bg-white p-4">
        <h3 className="font-medium">Результат</h3>
        {activeRun ? (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2 text-xs text-zinc-600">
              <span>{STATUS[activeRun.status] || activeRun.status}</span>
              <span>
                {activeRun.width}×{activeRun.height}
              </span>
              <span>{activeRun.durationSec}s</span>
            </div>
            {activeRun.status === "error" && activeRun.error ? (
              <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {activeRun.error}
              </p>
            ) : null}
            {activeRun.resultVideoUrl ? (
              <video src={activeRun.resultVideoUrl} controls className="w-full rounded border" />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded border bg-zinc-50 text-xs text-zinc-500">
                {activeRun.status === "busy" ? "Создаём видео…" : "Видео появится здесь"}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Пока нет запусков</p>
        )}
      </div>
      ) : null}

      <QuickVideoCustomModal
        open={customModalOpen}
        initialName={customCharacter?.name || ""}
        initialFiles={customCharacter?.files || []}
        onClose={() => setCustomModalOpen(false)}
        onSave={handleCustomSave}
      />

      {sourceRunId ? (
        <QuickVideoSaveTemplateModal
          open={saveTemplateOpen}
          sourceRunId={sourceRunId}
          defaultTitle={title}
          onClose={() => setSaveTemplateOpen(false)}
          onSaved={() =>
            setStartedMsg("Шаблон сохранён — появится в Peach / Bitch")
          }
        />
      ) : null}
    </div>
  );
}
