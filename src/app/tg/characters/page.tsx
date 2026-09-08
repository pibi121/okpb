"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";
import { TgCharacterBodyEditor } from "@/lib/tg/miniapp/character-body-editor";
import {
  fileToJpegDataUrl,
  isLikelyImageFile,
} from "@/lib/tg/miniapp/image-upload";
import { TG_LORA_TRAIN_PATH } from "@/lib/tg/miniapp-url";
import { ImageGeneration } from "@/components/image-generation";
import { BorderBeam } from "@/components/border-beam";

type CharTab = "showcase" | "personal" | "favorites";

type SavedPhoto = { name: string; url: string };

type TrainProgress = {
  percent: number;
  etaMinutes: number;
  estimateTotalMinutes?: number;
  etaLabel?: string;
  phase?: string;
  epoch?: number;
  epochs?: number;
};

const UI = {
  ru: {
    tabShowcase: "Каталог",
    tabPersonal: "Личные",
    tabFavorites: "Избранное",
    showcaseHint: "Актрисы студии — уже готовы к фото",
    personalHint: "Твои модели после подготовки внешности",
    favoritesHint: "Актрисы, отмеченные ★",
    emptyPersonal: "Пока нет своих моделей — создай и подготовь ниже",
    emptyFavorites: "Добавь актрис из каталога ★",
    photo: "Фото",
    video: "Видео",
    create: "+ Создать персонажа",
    createTitle: "Новая модель",
    namePh: "Имя",
    pickPhotos: "Выбрать фото",
    preparing: "Подготовка {done}/{total}…",
    uploading: "Загрузка {done}/{total}…",
    train: "Подготовить модель",
    training: "Подготовка…",
    photosOf: "фото",
    needMore: "Нужно ещё {n} фото",
    readyTrain: "Можно запускать",
    trainHint:
      "Создай модель → выбери сразу 5–20 фото → оплати подготовку.",
    uploadHint:
      "Выбери сразу несколько фото из галереи. Удаляй лишние крестиком.",
    uploadedMany: "Загружено {added} · всего {count}/{max}",
    trainPrice: "Подготовка: {price}🍑",
    trainBalance: "У вас на балансе: {balance}🍑",
    trainShort: "Не хватает: {need}🍑",
    insufficient: "Недостаточно персиков",
    topup: "Пополнить →",
    favAdd: "В избранное",
    favRemove: "Убрать из избранного",
    mockReady: "Нужно дозапустить подготовку",
    bannerTitle: "Создай свою модель",
    bannerSub: "5–20 фото · ~1–2 часа · макс. качество навсегда",
    bannerCta: "Начать",
    bannerPrice: "{price}🍑",
    deletePhoto: "Удалить",
    picked: "Выбрано {n} фото — загружаю…",
    partialFail: "Не удалось прочитать {n} фото (HEIC?) — остальные загружены",
    trainEta: "~{min} мин",
    trainProgress: "{pct}% · ~{min} мин",
    retryGpu: "Дозапустить подготовку · бесплатно",
    retryGpuHint: "Прошлая попытка не завершилась — оплата уже списана",
  },
  en: {
    tabShowcase: "Catalog",
    tabPersonal: "Personal",
    tabFavorites: "Favorites",
    showcaseHint: "Studio actresses — ready for photos",
    personalHint: "Your models after appearance setup",
    favoritesHint: "Actresses marked with ★",
    emptyPersonal: "No models yet — create and set up below",
    emptyFavorites: "Star actresses from the catalog",
    photo: "Photo",
    video: "Video",
    create: "+ Create character",
    createTitle: "New model",
    namePh: "Name",
    pickPhotos: "Choose photos",
    preparing: "Preparing {done}/{total}…",
    uploading: "Uploading {done}/{total}…",
    train: "Set up model",
    training: "Setting up…",
    photosOf: "photos",
    needMore: "Need {n} more photos",
    readyTrain: "Ready to start",
    trainHint:
      "Create a model → pick 5–20 photos at once → pay for setup.",
    uploadHint:
      "Select several photos from the gallery. Remove extras with ✕.",
    uploadedMany: "Uploaded {added} · total {count}/{max}",
    trainPrice: "Setup: {price}🍑",
    trainBalance: "Your balance: {balance}🍑",
    trainShort: "Need {need}🍑 more",
    insufficient: "Not enough peaches",
    topup: "Top up →",
    favAdd: "Add to favorites",
    favRemove: "Remove from favorites",
    mockReady: "Needs setup restart",
    bannerTitle: "Create your model",
    bannerSub: "5–20 photos · ~1–2 hours · max quality forever",
    bannerCta: "Start",
    bannerPrice: "{price}🍑",
    deletePhoto: "Remove",
    picked: "Selected {n} photos — uploading…",
    partialFail: "Could not read {n} photos (HEIC?) — rest uploaded",
    trainEta: "~{min} min",
    trainProgress: "{pct}% · ~{min} min",
    retryGpu: "Restart setup · free",
    retryGpuHint: "Previous run didn't finish — already paid",
  },
} as const;

function CharacterCard({
  name,
  coverUrl,
  subtitle,
  favorited,
  showStar,
  onToggleFavorite,
  onPhoto,
  onVideo,
  photoLabel,
  videoLabel,
  starAdd,
  starRemove,
  bodySlot,
  extraSlot,
  trainingProgress,
  trainLabel,
  progressLabel,
}: {
  name: string;
  coverUrl?: string | null;
  subtitle?: string;
  favorited?: boolean;
  showStar?: boolean;
  onToggleFavorite?: () => void;
  onPhoto: () => void;
  onVideo: () => void;
  photoLabel: string;
  videoLabel: string;
  starAdd: string;
  starRemove: string;
  bodySlot?: ReactNode;
  extraSlot?: ReactNode;
  trainingProgress?: TrainProgress | null;
  trainLabel?: string;
  progressLabel?: string;
}) {
  const pct = Math.max(
    0,
    Math.min(100, Math.round(trainingProgress?.percent ?? 0)),
  );
  const phase = trainingProgress?.phase || trainLabel || "";

  return (
    <div className="tg-portrait-card tg-portrait-card--static">
      <div className="tg-portrait-media">
        {trainingProgress ? (
          <BorderBeam className="h-full w-full">
            <div className="tg-train-pending">
              <ImageGeneration
                fill
                label={trainLabel || "…"}
                prompt={phase}
                resolution={`${pct}%`}
              />
            </div>
          </BorderBeam>
        ) : coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="tg-portrait-img" />
        ) : (
          <div className="tg-portrait-placeholder" />
        )}
        {showStar && onToggleFavorite ? (
          <button
            type="button"
            className={`tg-fav-star${favorited ? " is-on" : ""}`}
            aria-label={favorited ? starRemove : starAdd}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
          >
            {favorited ? "★" : "☆"}
          </button>
        ) : null}
      </div>
      <div className="tg-portrait-meta">
        <strong>{name}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
        {trainingProgress && progressLabel ? (
          <div className="tg-train-progress" aria-label={phase}>
            <div className="tg-train-progress-track">
              <div
                className="tg-train-progress-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <small className="tg-train-progress-label">{progressLabel}</small>
          </div>
        ) : null}
      </div>
      <div className="tg-char-actions">
        <button type="button" className="tg-char-action" onClick={onPhoto}>
          📸 {photoLabel}
        </button>
        <button type="button" className="tg-char-action" onClick={onVideo}>
          🎥 {videoLabel}
        </button>
      </div>
      {extraSlot}
      {bodySlot}
    </div>
  );
}

function TgCharactersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, error, profile, locale, apiFetch, refresh, sendAction } =
    useTgMiniApp();
  const u = UI[locale];
  const [tab, setTab] = useState<CharTab>("showcase");
  const [favBusy, setFavBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [photosByChar, setPhotosByChar] = useState<
    Record<string, SavedPhoto[]>
  >({});
  const [uploadProgress, setUploadProgress] = useState<{
    id: string;
    done: number;
    total: number;
  } | null>(null);
  const [panelErr, setPanelErr] = useState("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const keepPickingRef = useRef<string | null>(null);
  const trainSectionRef = useRef<HTMLDivElement | null>(null);
  const [trainById, setTrainById] = useState<Record<string, TrainProgress>>(
    {},
  );

  const favoriteIds = useMemo(
    () => new Set(profile?.favoriteCastIds || []),
    [profile?.favoriteCastIds],
  );

  const trainPrice = profile?.train?.pricePeaches ?? 1000;
  const minPhotos = profile?.train?.minPhotos ?? 5;
  const maxPhotos = profile?.train?.maxPhotos ?? 20;

  const personal =
    profile?.characters.filter(
      (c) =>
        !c.isStudioCast &&
        !c.videoRefOnly &&
        (c.loraUsable || c.loraStatus === "lora_ready"),
    ) || [];
  const drafting =
    profile?.characters.filter(
      (c) =>
        !c.isStudioCast &&
        !c.videoRefOnly &&
        c.loraStatus !== "lora_ready" &&
        c.loraStatus !== "lora_training",
    ) || [];
  const training =
    profile?.characters.filter(
      (c) =>
        !c.isStudioCast && !c.videoRefOnly && c.loraStatus === "lora_training",
    ) || [];
  const casts = profile?.casts || [];
  const favorites = casts.filter((c) => favoriteIds.has(c.id));

  const goToTrainSection = (opts?: { openCreate?: boolean }) => {
    setTab("personal");
    if (opts?.openCreate || drafting.length === 0) {
      setShowCreate(true);
    }
    window.setTimeout(() => {
      trainSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  };

  useEffect(() => {
    const section = searchParams.get("section");
    if (section !== "train" && section !== "lora") return;
    setTab("personal");
  }, [searchParams]);

  useEffect(() => {
    const section = searchParams.get("section");
    if (section !== "train" && section !== "lora") return;
    if (status !== "ready") return;
    if (drafting.length === 0) setShowCreate(true);
    window.setTimeout(() => {
      trainSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);
  }, [searchParams, status, drafting.length]);

  useEffect(() => {
    if (!training.length) return;
    let cancelled = false;

    const tick = async () => {
      await refresh();
      for (const c of training) {
        try {
          const res = await apiFetch(
            `/api/tg/characters/train?characterId=${encodeURIComponent(c.id)}`,
          );
          if (!res.ok || cancelled) continue;
          const j = (await res.json()) as { train?: TrainProgress };
          if (j.train) {
            setTrainById((prev) => ({ ...prev, [c.id]: j.train! }));
          }
        } catch {
          /* ignore */
        }
      }
    };

    void tick();
    const t = setInterval(() => void tick(), 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [training.map((c) => c.id).join(","), refresh, apiFetch]);

  const loadPhotos = async (characterId: string) => {
    try {
      const res = await apiFetch(
        `/api/tg/characters/photos?characterId=${encodeURIComponent(characterId)}`,
      );
      if (!res.ok) return;
      const j = (await res.json()) as { photos?: SavedPhoto[] };
      setPhotosByChar((prev) => ({
        ...prev,
        [characterId]: j.photos || [],
      }));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (status !== "ready") return;
    for (const c of drafting) {
      void loadPhotos(c.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, drafting.map((c) => c.id).join(",")]);

  const uploadFiles = async (characterId: string, files: File[]) => {
    if (!files.length) return;
    setErr("");
    setPanelErr("");
    setBusyId(characterId);
    setMsg(u.picked.replace("{n}", String(files.length)));
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");

    try {
      const preparedList: Array<{ name: string; dataUrl: string }> = [];
      let failed = 0;

      for (let i = 0; i < files.length; i++) {
        setUploadProgress({
          id: characterId,
          done: i + 1,
          total: files.length,
        });
        setMsg(
          u.preparing
            .replace("{done}", String(i + 1))
            .replace("{total}", String(files.length)),
        );
        try {
          const dataUrl = await fileToJpegDataUrl(files[i]!);
          preparedList.push({ name: `photo-${i + 1}.jpg`, dataUrl });
        } catch {
          failed += 1;
        }
      }

      if (!preparedList.length) {
        throw new Error(
          locale === "en"
            ? "Could not read photos (try JPG, or “Most Compatible” camera format)"
            : "Не удалось прочитать фото (попробуй JPG или «Наибольшая совместимость» в Камере)",
        );
      }

      let added = 0;
      let photoCount = 0;
      let lastPhotos: SavedPhoto[] = [];
      const chunkSize = 3;

      for (let i = 0; i < preparedList.length; i += chunkSize) {
        const chunk = preparedList.slice(i, i + chunkSize);
        setUploadProgress({
          id: characterId,
          done: Math.min(i + chunk.length, preparedList.length),
          total: preparedList.length,
        });
        setMsg(
          u.uploading
            .replace(
              "{done}",
              String(Math.min(i + chunk.length, preparedList.length)),
            )
            .replace("{total}", String(preparedList.length)),
        );

        const res = await apiFetch("/api/tg/characters/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            characterId,
            photos: chunk,
          }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          added?: number;
          photoCount?: number;
          photos?: SavedPhoto[];
        };
        if (!res.ok) throw new Error(j.error || "upload failed");
        added += j.added ?? chunk.length;
        photoCount = j.photoCount ?? photoCount;
        if (j.photos) lastPhotos = j.photos;
      }

      if (lastPhotos.length) {
        setPhotosByChar((prev) => ({ ...prev, [characterId]: lastPhotos }));
      } else {
        await loadPhotos(characterId);
      }
      await refresh();

      let doneMsg = u.uploadedMany
        .replace("{added}", String(added))
        .replace("{count}", String(photoCount))
        .replace("{max}", String(maxPhotos));
      if (failed > 0) {
        doneMsg += ` · ${u.partialFail.replace("{n}", String(failed))}`;
      }
      setMsg(doneMsg);
      keepPickingRef.current = null;
    } catch (e) {
      keepPickingRef.current = null;
      const text = e instanceof Error ? e.message : "error";
      setErr(text);
      setPanelErr(text);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("error");
      window.Telegram?.WebApp?.showAlert?.(text);
      await loadPhotos(characterId);
    } finally {
      setUploadProgress(null);
      setBusyId(null);
    }
  };

  const onPickFiles = (characterId: string, fileList: FileList | null) => {
    if (!fileList?.length) return;
    const current =
      photosByChar[characterId]?.length ||
      drafting.find((c) => c.id === characterId)?.photoCount ||
      0;
    const room = Math.max(0, maxPhotos - current);
    // Copy FileList immediately — iOS may clear it after the event.
    const copied = Array.from(fileList);
    let incoming = copied.filter(
      (f) => f.size > 0 && (isLikelyImageFile(f) || !f.type),
    );
    if (!incoming.length) {
      incoming = copied.filter((f) => f.size > 0);
    }
    incoming = incoming.slice(0, room);
    if (!incoming.length) {
      const text =
        locale === "en"
          ? "No valid images selected"
          : "Нет подходящих изображений";
      setPanelErr(text);
      window.Telegram?.WebApp?.showAlert?.(text);
      return;
    }
    void uploadFiles(characterId, incoming);
  };

  const deletePhoto = async (characterId: string, name: string) => {
    setErr("");
    setBusyId(characterId);
    try {
      const res = await apiFetch(
        `/api/tg/characters/photos?characterId=${encodeURIComponent(characterId)}&name=${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        photos?: SavedPhoto[];
      };
      if (!res.ok) throw new Error(j.error || "delete failed");
      setPhotosByChar((prev) => ({
        ...prev,
        [characterId]: j.photos || [],
      }));
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusyId(null);
    }
  };

  const toggleFavorite = async (characterId: string) => {
    setFavBusy(characterId);
    try {
      const res = await apiFetch("/api/tg/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (res.ok) await refresh();
    } finally {
      setFavBusy(null);
    }
  };

  const createCharacter = async () => {
    setErr("");
    setMsg("");
    setBusyId("create");
    try {
      const res = await apiFetch("/api/tg/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() || "Model" }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || "create failed");
      setNewName("");
      setShowCreate(false);
      setMsg(
        locale === "en" ? "Created — upload photos" : "Создано — загрузи фото",
      );
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusyId(null);
    }
  };

  const startTrain = async (characterId: string) => {
    setErr("");
    setMsg("");
    setBusyId(characterId);
    try {
      const res = await apiFetch("/api/tg/characters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId, locale }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (res.status === 402) {
        setErr(u.insufficient);
        return;
      }
      if (!res.ok) throw new Error(j.error || "train failed");
      setMsg(locale === "en" ? "Training started" : "Обучение запущено");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusyId(null);
    }
  };

  const draftActions = (c: {
    id: string;
    photoCount: number;
    loraStatus: string;
  }) => {
    const saved = photosByChar[c.id] || [];
    const count = Math.max(c.photoCount || 0, saved.length);
    const need = Math.max(0, minPhotos - count);
    const canTrain = need === 0;
    const slotsLeft = Math.max(0, maxPhotos - count);
    const progress = uploadProgress?.id === c.id ? uploadProgress : null;

    return (
      <div className="tg-train-panel">
        <p
          className="tg-muted"
          style={{ fontSize: "0.68rem", margin: "0.35rem 0" }}
        >
          {count}/{maxPhotos} {u.photosOf}
          {" · "}
          {canTrain
            ? u.readyTrain
            : u.needMore.replace("{n}", String(need))}
        </p>
        <p
          className="tg-muted"
          style={{
            fontSize: "0.62rem",
            margin: "0 0 0.35rem",
            lineHeight: 1.35,
          }}
        >
          {u.uploadHint}
        </p>
        {saved.length > 0 ? (
          <div className="tg-photo-grid">
            {saved.map((p) => (
              <div key={p.name} className="tg-photo-thumb-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="tg-photo-thumb" />
                <button
                  type="button"
                  className="tg-photo-del"
                  aria-label={u.deletePhoto}
                  disabled={busyId === c.id}
                  onClick={() => void deletePhoto(c.id, p.name)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {panelErr ? (
          <p className="tg-error" style={{ fontSize: "0.7rem" }}>
            {panelErr}
          </p>
        ) : null}
        {progress ? (
          <p className="tg-ok" style={{ fontSize: "0.7rem", margin: "0.25rem 0" }}>
            {u.uploading
              .replace("{done}", String(progress.done))
              .replace("{total}", String(progress.total))}
          </p>
        ) : null}
        <label
          className={`tg-file-btn-wrap${busyId === c.id || slotsLeft <= 0 ? " is-disabled" : ""}`}
        >
          <input
            ref={(el) => {
              fileRefs.current[c.id] = el;
            }}
            type="file"
            accept="image/*"
            multiple
            className="tg-file-input"
            disabled={busyId === c.id || slotsLeft <= 0}
            onChange={(e) => {
              const files = e.target.files;
              // Copy before reset — iOS Telegram can clear FileList.
              const snapshot = files ? Array.from(files) : [];
              e.target.value = "";
              if (!snapshot.length) return;
              const dt = new DataTransfer();
              for (const f of snapshot) dt.items.add(f);
              onPickFiles(c.id, dt.files);
            }}
          />
          <span className="tg-char-action tg-file-btn-label">
            📷 {busyId === c.id ? u.preparing.replace("{done}", "…").replace("{total}", "") : u.pickPhotos}
          </span>
        </label>
        <button
          type="button"
          className="tg-primary-btn"
          style={{ width: "100%", marginTop: "0.35rem" }}
          disabled={busyId === c.id || !canTrain}
          onClick={() => void startTrain(c.id)}
        >
          {busyId === c.id && !progress
            ? "…"
            : `🚀 ${u.train} · ${trainPrice}🍑`}
        </button>
      </div>
    );
  };

  return (
    <TgShell
      title={locale === "en" ? "Characters" : "Персонажи"}
      status={status}
      error={error}
      locale={locale}
    >
      <button
        type="button"
        className="tg-lora-banner"
        onClick={() => {
          if (typeof window !== "undefined") {
            const url = new URL(TG_LORA_TRAIN_PATH, window.location.origin);
            router.replace(url.pathname + url.search);
          }
          goToTrainSection({ openCreate: drafting.length === 0 });
        }}
      >
        <span className="tg-lora-banner-glow" aria-hidden />
        <span className="tg-lora-banner-copy">
          <strong>{u.bannerTitle}</strong>
          <small>{u.bannerSub}</small>
        </span>
        <span className="tg-lora-banner-cta">
          <span className="tg-lora-banner-price">
            {u.bannerPrice.replace("{price}", String(trainPrice))}
          </span>
          {u.bannerCta}
        </span>
      </button>

      <div className="tg-char-tabs">
        <button
          type="button"
          className={tab === "showcase" ? "active" : ""}
          onClick={() => setTab("showcase")}
        >
          {u.tabShowcase}
        </button>
        <button
          type="button"
          className={tab === "personal" ? "active" : ""}
          onClick={() => setTab("personal")}
        >
          {u.tabPersonal}
        </button>
        <button
          type="button"
          className={tab === "favorites" ? "active" : ""}
          onClick={() => setTab("favorites")}
        >
          {u.tabFavorites}
        </button>
      </div>

      {tab === "showcase" && (
        <div className="tg-section">
          <p className="tg-muted tg-section-hint">{u.showcaseHint}</p>
          <div className="tg-portrait-grid">
            {casts.map((c) => (
              <CharacterCard
                key={c.id}
                name={c.name}
                coverUrl={c.coverUrl}
                subtitle="PeachBitch Studio"
                showStar
                favorited={favoriteIds.has(c.id)}
                onToggleFavorite={() =>
                  favBusy === c.id ? undefined : void toggleFavorite(c.id)
                }
                photoLabel={u.photo}
                videoLabel={u.video}
                starAdd={u.favAdd}
                starRemove={u.favRemove}
                onPhoto={() =>
                  router.push(
                    `/tg/photo?characterId=${encodeURIComponent(c.id)}`,
                  )
                }
                onVideo={() =>
                  router.push(
                    `/tg/video?characterId=${encodeURIComponent(c.id)}`,
                  )
                }
              />
            ))}
          </div>
        </div>
      )}

      {tab === "personal" && (
        <div className="tg-section" ref={trainSectionRef} id="tg-lora-train">
          <p className="tg-muted tg-section-hint">{u.personalHint}</p>
          <p className="tg-muted tg-section-hint">{u.trainHint}</p>
          <p className="tg-muted tg-section-hint">
            {u.trainPrice.replace("{price}", String(trainPrice))}
          </p>
          <p className="tg-muted tg-section-hint">
            {u.trainBalance.replace(
              "{balance}",
              String(profile?.balancePeaches ?? 0),
            )}
          </p>
          {(profile?.balancePeaches ?? 0) < trainPrice ? (
            <>
              <p className="tg-error" style={{ margin: "0.25rem 0" }}>
                {u.trainShort.replace(
                  "{need}",
                  String(Math.max(0, trainPrice - (profile?.balancePeaches ?? 0))),
                )}
              </p>
              <button
                type="button"
                className="tg-primary-btn"
                style={{ width: "100%", marginBottom: "0.55rem" }}
                onClick={() => sendAction({ action: "topup" })}
              >
                {u.topup}
              </button>
            </>
          ) : null}
          {msg ? <p className="tg-ok">{msg}</p> : null}
          {err ? (
            <p className="tg-error">
              {err}
              {err === u.insufficient ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="tg-lang"
                    onClick={() => sendAction({ action: "topup" })}
                  >
                    {u.topup}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          <div className="tg-portrait-grid">
            {personal.length === 0 &&
              drafting.length === 0 &&
              training.length === 0 && (
                <p className="tg-muted tg-empty-grid">{u.emptyPersonal}</p>
              )}
            {personal.map((c) => {
              const needsGpu = Boolean(c.needsGpuTrain || (!c.loraUsable && c.loraStatus === "lora_ready"));
              return (
                <CharacterCard
                  key={c.id}
                  name={c.name}
                  coverUrl={c.coverUrl}
                  subtitle={c.loraUsable ? (locale === "en" ? "Ready" : "Готово") : u.mockReady}
                  photoLabel={u.photo}
                  videoLabel={u.video}
                  starAdd={u.favAdd}
                  starRemove={u.favRemove}
                  trainingProgress={
                    needsGpu
                      ? {
                          percent: 0,
                          etaMinutes: 90,
                          phase: u.retryGpuHint,
                        }
                      : null
                  }
                  trainLabel={needsGpu ? u.mockReady : undefined}
                  progressLabel={
                    needsGpu
                      ? u.trainProgress
                          .replace("{pct}", "0")
                          .replace("{min}", "90")
                      : undefined
                  }
                  onPhoto={() =>
                    router.push(
                      `/tg/photo?characterId=${encodeURIComponent(c.id)}`,
                    )
                  }
                  onVideo={() =>
                    router.push(
                      `/tg/video?characterId=${encodeURIComponent(c.id)}`,
                    )
                  }
                  extraSlot={
                    needsGpu ? (
                      <div className="tg-train-panel">
                        <p
                          className="tg-muted"
                          style={{
                            fontSize: "0.62rem",
                            margin: "0.35rem 0",
                            lineHeight: 1.35,
                          }}
                        >
                          {u.retryGpuHint}
                        </p>
                        <button
                          type="button"
                          className="tg-primary-btn"
                          style={{ width: "100%" }}
                          disabled={busyId === c.id}
                          onClick={() => void startTrain(c.id)}
                        >
                          {busyId === c.id ? "…" : `🚀 ${u.retryGpu}`}
                        </button>
                      </div>
                    ) : null
                  }
                  bodySlot={
                    <TgCharacterBodyEditor
                      characterId={c.id}
                      characterName={c.name}
                      locale={locale}
                      apiFetch={apiFetch}
                    />
                  }
                />
              );
            })}
            {training.map((c) => {
              const tp =
                trainById[c.id] ||
                c.train || {
                  percent: 5,
                  etaMinutes: 90,
                  phase: u.training,
                };
              return (
                <CharacterCard
                  key={c.id}
                  name={c.name}
                  coverUrl={c.coverUrl}
                  subtitle={tp.phase || u.training}
                  photoLabel={u.photo}
                  videoLabel={u.video}
                  starAdd={u.favAdd}
                  starRemove={u.favRemove}
                  trainingProgress={tp}
                  trainLabel={u.training}
                  progressLabel={u.trainProgress
                    .replace("{pct}", String(Math.round(tp.percent)))
                    .replace("{min}", String(tp.etaMinutes))}
                  onPhoto={() =>
                    router.push(
                      `/tg/photo?characterId=${encodeURIComponent(c.id)}`,
                    )
                  }
                  onVideo={() =>
                    router.push(
                      `/tg/video?characterId=${encodeURIComponent(c.id)}`,
                    )
                  }
                />
              );
            })}
            {drafting.map((c) => (
              <CharacterCard
                key={c.id}
                name={c.name}
                coverUrl={c.coverUrl}
                subtitle={`${c.photoCount} ${u.photosOf}`}
                photoLabel={u.photo}
                videoLabel={u.video}
                starAdd={u.favAdd}
                starRemove={u.favRemove}
                onPhoto={() =>
                  router.push(
                    `/tg/photo?characterId=${encodeURIComponent(c.id)}`,
                  )
                }
                onVideo={() =>
                  router.push(
                    `/tg/video?characterId=${encodeURIComponent(c.id)}`,
                  )
                }
                extraSlot={draftActions(c)}
                bodySlot={
                  <TgCharacterBodyEditor
                    characterId={c.id}
                    characterName={c.name}
                    locale={locale}
                    apiFetch={apiFetch}
                  />
                }
              />
            ))}
          </div>

          {showCreate ? (
            <div
              className="tg-body-editor-panel"
              style={{ marginTop: "0.75rem" }}
            >
              <strong style={{ fontSize: "0.85rem" }}>{u.createTitle}</strong>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={u.namePh}
                style={{
                  width: "100%",
                  marginTop: "0.4rem",
                  padding: "0.45rem",
                  borderRadius: 8,
                  border: "1px solid var(--tg-hairline)",
                  background: "var(--tg-bg)",
                  color: "var(--tg-fg)",
                }}
              />
              <button
                type="button"
                className="tg-primary-btn"
                style={{ width: "100%", marginTop: "0.5rem" }}
                disabled={busyId === "create"}
                onClick={() => void createCharacter()}
              >
                {busyId === "create" ? "…" : u.create}
              </button>
              <button
                type="button"
                className="tg-lang"
                style={{ width: "100%", marginTop: "0.35rem" }}
                onClick={() => setShowCreate(false)}
              >
                {locale === "en" ? "Cancel" : "Отмена"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="tg-primary-btn"
              style={{ marginTop: "0.75rem", width: "100%" }}
              onClick={() => setShowCreate(true)}
            >
              {u.create}
            </button>
          )}
        </div>
      )}

      {tab === "favorites" && (
        <div className="tg-section">
          <p className="tg-muted tg-section-hint">{u.favoritesHint}</p>
          <div className="tg-portrait-grid">
            {favorites.length === 0 && (
              <p className="tg-muted tg-empty-grid">{u.emptyFavorites}</p>
            )}
            {favorites.map((c) => (
              <CharacterCard
                key={c.id}
                name={c.name}
                coverUrl={c.coverUrl}
                subtitle="★"
                showStar
                favorited
                onToggleFavorite={() =>
                  favBusy === c.id ? undefined : void toggleFavorite(c.id)
                }
                photoLabel={u.photo}
                videoLabel={u.video}
                starAdd={u.favAdd}
                starRemove={u.favRemove}
                onPhoto={() =>
                  router.push(
                    `/tg/photo?characterId=${encodeURIComponent(c.id)}`,
                  )
                }
                onVideo={() =>
                  router.push(
                    `/tg/video?characterId=${encodeURIComponent(c.id)}`,
                  )
                }
              />
            ))}
          </div>
        </div>
      )}
    </TgShell>
  );
}

export default function TgCharactersPage() {
  return (
    <Suspense fallback={null}>
      <TgCharactersPageInner />
    </Suspense>
  );
}
