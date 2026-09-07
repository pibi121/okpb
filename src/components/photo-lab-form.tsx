"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OrientationSelect } from "@/components/orientation-select";
import { PromptLegoEditor } from "@/components/prompt-lego-editor";
import { PhotoEditPromptPicker } from "@/components/photo-edit-prompt-picker";
import {
  PhotoRefSlotStrip,
  buildPhotoIdentitySlotsFromBlueprint,
  emptyPhotoIdentitySlots,
  photoIdentitySlotsToFormMeta,
  useIdentityRefsReady,
  type PhotoUiSlot,
} from "@/components/photo-ref-slot-strip";
import {
  analyzeLegoTokens,
  buildLegoCatalog,
  parseLegoQuery,
  type LegoCatalogItem,
  type LegoCharacterRef,
} from "@/lib/prompt-lego-core";
import { photoBatchCost, SKU } from "@/lib/peach-economics";
import {
  PEACH_PHOTO_TEMPLATE_APPLY_EVENT,
  loadPhotoRestore,
  type PeachPhotoTemplateUsePayload,
  type PhotoRestorePayload,
} from "@/lib/generation-restore";
import {
  createCustomCharacterId,
  filterDbCharacterIds,
  isCustomCharacterId,
  type QuickVideoCustomCharacter,
} from "@/lib/quick-video-custom-character";
import { PHOTO_FACE_REF_COUNT } from "@/lib/photo-refs-shared";
import {
  kreaStillSize,
  type VideoOrientationId,
} from "@/lib/video-orientation";

type PoseProp = {
  id: string;
  label: string;
  text: string;
  videoMotion?: string;
};

type Char = LegoCharacterRef & {
  loraStatus: string;
};

type LegoStatic = {
  lighting: Array<Omit<LegoCatalogItem, "kind">>;
  events: Array<Omit<LegoCatalogItem, "kind">>;
  stylization: Array<Omit<LegoCatalogItem, "kind">>;
  body?: Array<Omit<LegoCatalogItem, "kind">>;
};

type CustomCharacterState = QuickVideoCustomCharacter & {
  files: File[];
};

type CharacterPhoto = { name: string; url: string };

async function readJson(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер вернул не JSON (${res.status})`);
  }
}

export function PhotoLabForm({
  characters,
  poses,
  lego,
  onRunStarted,
}: {
  characters: Char[];
  poses: PoseProp[];
  lego: LegoStatic;
  onRunStarted?: () => void;
}) {
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [customCharacter, setCustomCharacter] = useState<CustomCharacterState | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [orientation, setOrientation] = useState<VideoOrientationId>("9_16");
  const [photoCount, setPhotoCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [fillBusy, setFillBusy] = useState(false);
  const [error, setError] = useState("");
  const [templateMsg, setTemplateMsg] = useState("");
  const [photoTemplateId, setPhotoTemplateId] = useState("");
  const [refSlots, setRefSlots] = useState<PhotoUiSlot[]>(() =>
    emptyPhotoIdentitySlots(),
  );

  const hasCharacters = characters.length > 0;
  const blocked = !hasCharacters;
  const identityRefsReady = useIdentityRefsReady(refSlots);
  const hasCustom =
    characterIds.some(isCustomCharacterId) || !!customCharacter?.files.length;
  const useIdentityDualRef =
    !!photoTemplateId || hasCustom || identityRefsReady;

  useEffect(() => {
    const restored = loadPhotoRestore();
    if (restored) {
      applyPhotoRestore(restored);
    } else if (characters[0]) {
      setCharacterIds([characters[0].id]);
    }
  }, [characters]);

  function applyPhotoRestore(payload: PhotoRestorePayload) {
    setQuery(payload.legoQuery);
    setCharacterIds(payload.characterIds);
    if (payload.orientationId) {
      setOrientation(payload.orientationId as VideoOrientationId);
    }
    setTemplateMsg("Настройки загружены — выбери персонажа и запусти");
  }

  const applyPhotoTemplate = useCallback(
    async (payload: PeachPhotoTemplateUsePayload) => {
      setQuery(payload.legoQuery);
      setOrientation(payload.orientation as VideoOrientationId);
      setPhotoTemplateId(payload.templateId);
      setError("");

      if (payload.identityMode === "character") {
        setCustomCharacter(null);
        setCharacterIds(payload.characterIds || []);
      } else {
        const id = createCustomCharacterId();
        setCustomCharacter({
          id,
          name: payload.customName || "Model",
          files: payload.identityFiles || [],
        });
        setCharacterIds([id]);
      }

      const nextSlots = await buildPhotoIdentitySlotsFromBlueprint(
        payload.slotBlueprint,
        payload.identityFiles || [],
      );
      setRefSlots(nextSlots);
      setTemplateMsg(
        `Шаблон «${payload.title}» — поза из превью, лицо из твоего рефа`,
      );

      if (payload.identityMode === "character" && !(payload.identityFiles?.length)) {
        const id = payload.characterIds?.[0];
        if (id) {
          try {
            const res = await fetch(`/api/characters/${id}/refs`);
            const data = await readJson(res);
            if (res.ok && (data.refs as CharacterPhoto[])?.[0]) {
              const p = (data.refs as CharacterPhoto[])[0]!;
              const imgRes = await fetch(p.url);
              const blob = await imgRes.blob();
              const file = new File([blob], p.name || "face.png", {
                type: blob.type || "image/png",
              });
              setRefSlots([
                {
                  role: "identity",
                  label:
                    characters.find((c) => c.id === id)?.name || "face",
                  file,
                  previewUrl: URL.createObjectURL(file),
                },
              ]);
            }
          } catch {
            /* fill manually */
          }
        }
      }
    },
    [characters],
  );

  useEffect(() => {
    const onTemplate = (event: Event) => {
      const payload = (event as CustomEvent<PeachPhotoTemplateUsePayload>).detail;
      if (!payload) return;
      void applyPhotoTemplate(payload);
    };
    window.addEventListener(PEACH_PHOTO_TEMPLATE_APPLY_EVENT, onTemplate);
    return () =>
      window.removeEventListener(PEACH_PHOTO_TEMPLATE_APPLY_EVENT, onTemplate);
  }, [applyPhotoTemplate]);

  const size = useMemo(() => kreaStillSize(orientation), [orientation]);
  const batchCost = photoBatchCost(photoCount);

  const baseCatalog = useMemo(
    () =>
      buildLegoCatalog({
        poses,
        lighting: lego.lighting,
        events: lego.events,
        stylization: lego.stylization,
        body: lego.body || [],
        characters,
      }),
    [poses, lego, characters],
  );

  const liveCatalog = useMemo(() => {
    const nonChar = baseCatalog.filter((c) => c.kind !== "character");
    const selected = characters.filter((c) => characterIds.includes(c.id));
    const chars: LegoCatalogItem[] = selected.map((c) => ({
      id: c.id,
      label: c.name,
      kind: "character" as const,
      aliases: [c.name, c.triggerWord || ""].filter(Boolean) as string[],
    }));
    if (customCharacter) {
      chars.push({
        id: customCharacter.id,
        label: customCharacter.name,
        kind: "character",
        aliases: [customCharacter.name],
      });
    }
    return [...chars, ...nonChar];
  }, [baseCatalog, characters, characterIds, customCharacter]);

  const analyzed = useMemo(() => {
    const tokens = parseLegoQuery(query, liveCatalog);
    return analyzeLegoTokens(tokens, characters, liveCatalog);
  }, [query, liveCatalog, characters]);

  function toggleCharacter(id: string) {
    setCustomCharacter(null);
    setCharacterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function fillFromCharacters() {
    const dbIds = filterDbCharacterIds(characterIds);
    const customId = characterIds.find(isCustomCharacterId);
    if (!dbIds.length && !customId) {
      setError("Сначала выбери персонажа или Custom");
      return;
    }
    setFillBusy(true);
    setError("");
    try {
      const picks: Array<{ name: string; blob: Blob; characterName: string }> =
        [];

      if (customId && customCharacter?.id === customId) {
        const file = customCharacter.files[0];
        if (file) {
          picks.push({
            name: file.name || "custom.png",
            blob: file,
            characterName: customCharacter.name,
          });
        }
      }

      for (const id of dbIds) {
        if (picks.length >= PHOTO_FACE_REF_COUNT) break;
        const ch = characters.find((c) => c.id === id);
        const res = await fetch(`/api/characters/${id}/refs`);
        const data = await readJson(res);
        if (!res.ok) continue;
        const photos = (data.refs as CharacterPhoto[]) || [];
        if (!photos.length) continue;
        const p = photos[0]!;
        const imgRes = await fetch(p.url);
        const blob = await imgRes.blob();
        picks.push({
          name: p.name || "identity.png",
          blob,
          characterName: ch?.name || id,
        });
      }

      if (!picks.length) {
        setError("Нет референсов — сгенерируй identity pack в Персонажах");
        return;
      }

      const next = refSlots.map((s) => ({ ...s }));
      let pi = 0;
      for (const pick of picks.slice(0, PHOTO_FACE_REF_COUNT)) {
        if (pi >= PHOTO_FACE_REF_COUNT) break;
        if (next[pi]?.previewUrl) URL.revokeObjectURL(next[pi]!.previewUrl!);
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
      setRefSlots(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setFillBusy(false);
    }
  }

  async function generate() {
    setError("");
    if (blocked) return;
    if (!query.trim() && characterIds.length === 0) {
      setError("Добавь персонажа или опиши сцену блоками");
      return;
    }
    if (useIdentityDualRef && !filterDbCharacterIds(characterIds).length && !customCharacter) {
      setError("Для identity ref нужен персонаж или Custom с фото лица");
      return;
    }
    setSubmitting(true);
    try {
      const castIds =
        photoTemplateId || useIdentityDualRef
          ? characterIds
          : analyzed.characterIdsInOrder.length > 0
            ? analyzed.characterIdsInOrder
            : characterIds;

      const skinOn = !!analyzed.skinDetail;

      if (photoTemplateId || useIdentityDualRef || refSlots.some((s) => s.file)) {
        const form = new FormData();
        form.set("action", "photo");
        form.set("characterIds", JSON.stringify(castIds));
        form.set("legoQuery", query);
        form.set("orientationId", orientation);
        form.set("width", String(size.width));
        form.set("height", String(size.height));
        form.set("skinDetail", skinOn ? "1" : "0");
        form.set(
          "skinDetailStrength",
          String(skinOn ? analyzed.skinDetailStrength ?? 1.2 : 0),
        );
        if (photoTemplateId) form.set("photoTemplateId", photoTemplateId);
        form.set(
          "useIdentityDualRef",
          photoTemplateId || useIdentityDualRef ? "1" : "0",
        );
        form.set(
          "slotMeta",
          JSON.stringify(photoIdentitySlotsToFormMeta(refSlots)),
        );
        for (let i = 0; i < refSlots.length; i++) {
          const f = refSlots[i]?.file;
          if (f) form.set(`picture_${i + 1}`, f);
        }
        if (customCharacter?.files[0]) {
          form.append("customIdentityPhotos", customCharacter.files[0]);
        }
        const res = await fetch("/api/peach/generate", {
          method: "POST",
          body: form,
        });
        const data = await readJson(res);
        if (!res.ok) {
          setError(String(data.error || "ошибка"));
          return;
        }
      } else {
        const res = await fetch("/api/peach/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "photo",
            characterIds: castIds,
            characterId: castIds[0] || null,
            poseId: analyzed.poseId,
            styleId: analyzed.styleId,
            userNote: query,
            legoQuery: query,
            orientationId: orientation,
            photoCount,
            usePreset: !!analyzed.poseId,
            width: size.width,
            height: size.height,
            skinDetail: skinOn,
            skinDetailStrength: skinOn ? analyzed.skinDetailStrength ?? 1.2 : 0,
            title: photoCount > 1 ? `Фото ×${photoCount}` : undefined,
          }),
        });
        const data = await readJson(res);
        if (!res.ok) {
          setError(String(data.error || "ошибка"));
          return;
        }
      }

      setTemplateMsg("");
      onRunStarted?.();
      document.getElementById("today-generations")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div id="photo-lab-form" className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div
          className={`relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#121214] p-4 ${blocked ? "pointer-events-none opacity-45" : ""}`}
        >
          {blocked ? (
            <div className="pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-[#0c0c0e]/75 p-6 text-center backdrop-blur-sm">
              <p className="text-sm text-zinc-400">
                Сначала нужен хотя бы один персонаж — без него генерация недоступна.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link
                  href="/peach/characters"
                  className="rounded-full bg-peach px-4 py-2 text-sm font-medium text-black"
                >
                  Создать персонажа
                </Link>
                <Link
                  href="/peach/characters/library"
                  className="rounded-full border border-white/15 px-4 py-2 text-sm"
                >
                  Библиотека персонажей
                </Link>
              </div>
            </div>
          ) : null}

          <h2 className="font-medium">Генерация фото</h2>
          <p className="text-xs text-zinc-500">
            Персонаж или Custom → рефы лица (Picture 1–3). Сцена только в LEGO
            ниже.
          </p>

          <div>
            <div className="mb-1.5 text-sm text-zinc-500">Персонажи</div>
            <div className="flex flex-wrap gap-1.5">
              {characters.map((c) => {
                const on = characterIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCharacter(c.id)}
                    className={
                      on
                        ? "rounded-full border border-peach/50 bg-peach/15 px-3 py-1 text-sm text-peach"
                        : "rounded-full border border-white/15 px-3 py-1 text-sm text-zinc-400 hover:border-white/25"
                    }
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <PhotoRefSlotStrip
            slots={refSlots}
            onChange={setRefSlots}
            onFillFromCharacter={() => void fillFromCharacters()}
            fillBusy={fillBusy}
          />

          <div>
            <div className="mb-1.5 text-sm text-zinc-500">Сцена</div>
            <PromptLegoEditor
              catalog={baseCatalog}
              characters={characters}
              selectedIds={characterIds}
              value={query}
              onChange={setQuery}
              disabled={submitting || blocked}
              variant="photo"
            />
            <div className="mt-3">
              <PhotoEditPromptPicker
                value={query}
                onChange={setQuery}
                compact
                hint="Добавить готовый текст позы/света в LEGO-поле (для LoRA-пути)."
              />
            </div>
          </div>

          <label className="flex flex-col gap-2 text-sm">
            <span className="text-zinc-500">Ориентация кадра</span>
            <OrientationSelect
              value={orientation}
              onChange={setOrientation}
              className="w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
              disabled={submitting || blocked}
            />
            <span className="text-xs text-zinc-600">
              {size.ratio} · {size.width}×{size.height}
            </span>
          </label>

          {!useIdentityDualRef ? (
            <label className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between text-zinc-500">
                <span>Сколько фото</span>
                <span>{photoCount}</span>
              </div>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={photoCount}
                disabled={submitting || blocked}
                onChange={(e) => setPhotoCount(Number(e.target.value))}
                className="accent-peach"
              />
              <span className="text-xs text-zinc-600">
                {SKU.photo} кр. × {photoCount} = {batchCost} кр.
              </span>
            </label>
          ) : (
            <p className="text-xs text-zinc-600">
              Identity ref: сцена из промпта + лицо из рефа (Krea) · {SKU.photo}{" "}
              кр.
            </p>
          )}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {templateMsg ? (
            <p className="text-sm text-emerald-400">{templateMsg}</p>
          ) : null}

          <button
            type="button"
            disabled={submitting || blocked}
            onClick={() => void generate()}
            className="rounded-full bg-peach px-4 py-2.5 text-sm font-medium text-black disabled:opacity-50"
          >
            {submitting
              ? "В очередь…"
              : useIdentityDualRef
                ? `Сгенерировать (лицо из рефа, ${SKU.photo} кр.)`
                : `Сгенерировать (${batchCost} кр.)`}
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#121214] p-4 text-sm">
          <p className="font-medium text-foreground">Как пользоваться</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-500">
            <li>Выбери персонажа (или Custom через шаблон).</li>
            <li>
              Шаблон Peach/Bitch ниже — сначала персонаж в модалке, потом сцена.
            </li>
            <li>Picture 1–3 — только лицо (персонаж или custom).</li>
            <li>Сцена, свет, поза — блоки LEGO, не отдельный реф.</li>
            <li>Опиши сцену блоками LEGO и запусти генерацию.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
