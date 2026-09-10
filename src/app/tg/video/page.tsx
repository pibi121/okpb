"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";
import { TgCatalogVideo } from "@/lib/tg/miniapp/catalog-video";
import {
  TgBannerCarousel,
  useHorizontalBanners,
} from "@/lib/tg/miniapp/banners-ui";
import { TgCostBalanceBar } from "@/lib/tg/miniapp/cost-balance-bar";
import {
  clipSpeechText,
  countSpeechSignificantChars,
} from "@/lib/speech-slots";

type SpeechSlotDto = {
  id: string;
  speaker: string;
  lang: string;
  text: string;
  label: string;
  maxChars: number;
};

type VideoRef = { id: string; name: string; photoCount: number; ready: boolean };
type VideoTpl = {
  id: string;
  title: string;
  pricePeaches: number;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  durationSec?: number;
  templateKind?: "quick_video" | "lora_i2v";
  requiresLora?: boolean;
  hasSpeech?: boolean;
  speechSlots?: SpeechSlotDto[];
};

type LoraChar = { id: string; name: string; loraStatus?: string };

const UI = {
  ru: {
    title: "Сделать видео",
    pick: "1. Выбери позу",
    upload: "2. Загрузи фото персонажа",
    useSaved: "Или выбери сохранённую модель",
    pickLora: "2. Выбери готовую модель",
    needLora: "Нужна обученная модель",
    bestQuality: "Макс. качество",
    bestHint:
      "Этот формат работает только с обученной моделью — твоя или актриса студии. Обычное фото «с телефона» не подойдёт.",
    trainPitch:
      "Хочешь своё лицо в макс. качестве? Создай модель за ~1–2 часа (от 5 фото) — и этот уровень откроется навсегда.",
    trainCta: "Создать модель →",
    openCasts: "Актрисы студии",
    speech: "3. Речь в видео",
    speechHint: "По умолчанию — как в превью. Сними галочку, чтобы заменить фразы.",
    keepSpeech: "Хочу речь, как в превью",
    customSpeech: "Свои фразы (можно править)",
    generate: "Снять видео",
    choose: "Выбрать",
    back: "← К позам",
    needPhoto: "Нужно минимум 1 фото",
    starting: "Запускаю…",
    line: "Реплика",
    topup: "Пополнить баланс",
    needPeaches: "Недостаточно персиков",
  },
  en: {
    title: "Make video",
    pick: "1. Pick a pose",
    upload: "2. Upload character photos",
    useSaved: "Or pick a saved model",
    pickLora: "2. Pick a ready model",
    needLora: "Need a trained model",
    bestQuality: "Max quality",
    bestHint:
      "This format only works with a trained model — yours or a studio actress. A plain phone selfie won't work.",
    trainPitch:
      "Want your face in max quality? Create a model in ~1–2 hours (from 5 photos) — unlock this level forever.",
    trainCta: "Create model →",
    openCasts: "Studio actresses",
    speech: "3. Dialogue",
    speechHint: "Default: same as preview. Untick to replace lines.",
    keepSpeech: "Keep speech as in preview",
    customSpeech: "Custom lines (edit below)",
    generate: "Shoot video",
    choose: "Choose",
    back: "← Poses",
    needPhoto: "Need at least 1 photo",
    starting: "Starting…",
    line: "Line",
    topup: "Top up balance",
    needPeaches: "Not enough peaches",
  },
} as const;

function togglePreview(el: HTMLVideoElement) {
  if (el.paused) void el.play().catch(() => undefined);
  else el.pause();
}

function VideoPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const presetId = params.get("templateId") || "";
  const presetCharacterId = params.get("characterId") || "";

  const { status, error, locale, apiFetch, refresh, profile, sendAction } =
    useTgMiniApp();
  const u = UI[locale];
  const banners = useHorizontalBanners(apiFetch);

  const [templates, setTemplates] = useState<VideoTpl[]>([]);
  const [templateId, setTemplateId] = useState(presetId);
  const [refs, setRefs] = useState<VideoRef[]>([]);
  const [loraChars, setLoraChars] = useState<LoraChar[]>([]);
  const [characterId, setCharacterId] = useState<string | null>(
    presetCharacterId || null,
  );
  const [photoCount, setPhotoCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [usePreviewSpeech, setUsePreviewSpeech] = useState(true);
  const [speechFills, setSpeechFills] = useState<
    Record<string, { text: string; lang: string }>
  >({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [tRes, rRes, meRes] = await Promise.all([
      apiFetch(`/api/tg/templates?kind=video&locale=${locale}`),
      apiFetch("/api/tg/video-refs"),
      apiFetch(`/api/tg/me?locale=${locale}`),
    ]);
    if (tRes.ok) {
      const data = (await tRes.json()) as { video: VideoTpl[] };
      setTemplates(data.video || []);
      if (presetId && data.video.some((v) => v.id === presetId)) {
        setTemplateId(presetId);
      }
    }
    if (rRes.ok) {
      const data = (await rRes.json()) as { refs: VideoRef[] };
      setRefs(data.refs || []);
      if (presetCharacterId) {
        const hit = (data.refs || []).find((r) => r.id === presetCharacterId);
        if (hit?.ready) {
          setCharacterId(hit.id);
          setPhotoCount(hit.photoCount);
          setReady(true);
        }
      }
    }
    if (meRes.ok) {
      const data = (await meRes.json()) as {
        characters?: LoraChar[];
        casts?: Array<{ id: string; name: string }>;
      };
      const pool: LoraChar[] = [
        ...(data.characters || []).filter((c) => c.loraStatus === "lora_ready"),
        ...(data.casts || []).map((c) => ({
          id: c.id,
          name: c.name,
          loraStatus: "lora_ready",
        })),
      ];
      const seen = new Set<string>();
      setLoraChars(
        pool.filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        }),
      );
    }
  }, [apiFetch, locale, presetId, presetCharacterId]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  const tpl = templates.find((t) => t.id === templateId) || null;
  const isLoraI2v = tpl?.templateKind === "lora_i2v" || !!tpl?.requiresLora;
  const speechSlots = tpl?.speechSlots || [];

  useEffect(() => {
    if (!tpl) return;
    const next: Record<string, { text: string; lang: string }> = {};
    for (const s of tpl.speechSlots || []) {
      next[s.id] = { text: s.text, lang: "ru" };
    }
    setSpeechFills(next);
    setUsePreviewSpeech(true);
  }, [tpl?.id]);

  useEffect(() => {
    if (!tpl || !isLoraI2v) return;
    if (characterId && loraChars.some((c) => c.id === characterId)) {
      setReady(true);
      return;
    }
    if (loraChars[0]) {
      setCharacterId(loraChars[0].id);
      setReady(true);
    } else {
      setReady(false);
    }
  }, [tpl, isLoraI2v, loraChars, characterId]);

  const ensureCharacter = async (): Promise<string | null> => {
    if (characterId) return characterId;
    const res = await apiFetch("/api/tg/video-refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Модель" }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { id: string };
    setCharacterId(j.id);
    return j.id;
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr("");
    const cid = await ensureCharacter();
    if (!cid) {
      setErr("error");
      return;
    }
    for (let i = 0; i < files.length; i++) {
      const fd = new FormData();
      fd.set("characterId", cid);
      fd.set("file", files[i]!);
      const res = await apiFetch("/api/tg/video-refs", { method: "PUT", body: fd });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error || (locale === "en" ? "Upload failed" : "Не удалось загрузить фото"));
        return;
      }
      const j = (await res.json()) as { photoCount: number; ready: boolean };
      setPhotoCount(j.photoCount);
      setReady(j.ready);
    }
  };

  const resetSpeechDefaults = () => {
    const next: Record<string, { text: string; lang: string }> = {};
    for (const s of speechSlots) {
      next[s.id] = { text: s.text, lang: "ru" };
    }
    setSpeechFills(next);
  };

  const onGenerate = async () => {
    if (!templateId || !characterId) {
      setErr(isLoraI2v ? u.needLora : u.needPhoto);
      return;
    }
    if (!isLoraI2v && !ready) {
      setErr(u.needPhoto);
      return;
    }
    setBusy(true);
    setErr("");
    const fills = speechSlots.map((s) => {
      const raw = usePreviewSpeech
        ? s.text
        : speechFills[s.id]?.text ?? s.text;
      return {
        id: s.id,
        text: raw.trim(), // server clips by significant chars
        lang: "ru",
      };
    });
    const res = await apiFetch("/api/tg/generate/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId,
        characterId,
        locale,
        speechFills: fills,
        speechLine: fills[0]?.text,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        need?: number;
        balance?: number;
        message?: string;
      };
      if (j.error === "insufficient_balance") {
        setErr(
          `${u.needPeaches} (${j.need ?? tpl?.pricePeaches} / ${j.balance ?? profile?.balancePeaches ?? 0})`,
        );
      } else if (j.error === "need_lora_ready") {
        setErr(j.message || u.needLora);
      } else {
        setErr(j.error || j.message || "error");
      }
      return;
    }
    void refresh();
    try {
      sessionStorage.setItem(
        "tg_just_generated",
        JSON.stringify({ at: Date.now(), kind: "video" }),
      );
    } catch {
      /* ignore */
    }
    router.push("/tg/gallery");
  };

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;

  return (
    <TgShell locale={locale}>
      <TgBannerCarousel banners={banners} />
      {!tpl ? (
        <>
          <div className="tg-section" style={{ paddingBottom: "0.35rem" }}>
            <h2 style={{ margin: 0 }}>{u.pick}</h2>
            <p className="tg-muted tg-section-hint">
              {locale === "ru"
                ? "Превью играет само. Нажми — пауза, ещё раз — снова."
                : "Previews play muted. Tap to pause, tap again to play."}
            </p>
          </div>
          <div className="tg-portrait-grid" style={{ padding: "0 0.75rem 1rem" }}>
            {templates.map((t) => (
              <div key={t.id} className="tg-portrait-card">
                <div className="tg-portrait-media">
                  {t.previewVideoUrl ? (
                    <TgCatalogVideo
                      src={t.previewVideoUrl}
                      poster={t.previewPhotoUrl}
                      className="tg-video-preview"
                      onClick={togglePreview}
                    />
                  ) : t.previewPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.previewPhotoUrl}
                      alt=""
                      className="tg-video-preview"
                    />
                  ) : (
                    <div className="tg-portrait-placeholder tg-catalog-video-skeleton" />
                  )}
                </div>
                <div className="tg-portrait-meta">
                  <strong>{t.title}</strong>
                  {(t.templateKind === "lora_i2v" || t.requiresLora) && (
                    <span className="tg-best-badge">{u.bestQuality}</span>
                  )}
                  <small>
                    {t.pricePeaches} 🍑
                    {t.durationSec ? ` · ~${t.durationSec}с` : ""}
                    {t.hasSpeech ? (locale === "ru" ? " · речь" : " · speech") : ""}
                  </small>
                </div>
                <button
                  type="button"
                  className="tg-primary-btn"
                  style={{ width: "100%", marginTop: "0.4rem" }}
                  onClick={() => setTemplateId(t.id)}
                >
                  {u.choose}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ padding: "0 1rem 1rem" }}>
          <button type="button" className="tg-lang" onClick={() => setTemplateId("")}>
            {u.back}
          </button>
          <div style={{ marginTop: "0.75rem" }}>
            <strong>{tpl.title}</strong>
            {tpl.previewVideoUrl && (
              <TgCatalogVideo
                src={tpl.previewVideoUrl}
                poster={tpl.previewPhotoUrl}
                className="tg-reel-media"
                style={{
                  marginTop: "0.5rem",
                  maxHeight: 240,
                  width: "100%",
                  borderRadius: 12,
                }}
                onClick={togglePreview}
              />
            )}
          </div>

          <TgCostBalanceBar
            cost={tpl.pricePeaches}
            balance={profile?.balancePeaches ?? 0}
            locale={locale}
            onTopup={() => sendAction({ action: "topup" })}
          />

          {isLoraI2v ? (
            <>
              <p className="tg-muted tg-section-hint" style={{ marginTop: "0.75rem" }}>
                <span className="tg-best-badge" style={{ position: "static", display: "inline-block", marginRight: "0.4rem" }}>
                  {u.bestQuality}
                </span>
                {u.bestHint}
              </p>
              <h2 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem" }}>
                {u.pickLora}
              </h2>
              {loraChars.length === 0 ? (
                <div className="tg-card-list">
                  <p className="tg-muted">{u.trainPitch}</p>
                  <button
                    type="button"
                    className="tg-primary-btn"
                    style={{ width: "100%" }}
                    onClick={() => router.push("/tg/characters?section=train")}
                  >
                    {u.trainCta}
                  </button>
                  <button
                    type="button"
                    className="tg-lang"
                    style={{ width: "100%", marginTop: "0.4rem" }}
                    onClick={() => router.push("/tg/characters")}
                  >
                    {u.openCasts}
                  </button>
                </div>
              ) : (
                <div className="tg-card-list">
                  {loraChars.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`tg-char-card ${characterId === c.id ? "active" : ""}`}
                      onClick={() => {
                        setCharacterId(c.id);
                        setReady(true);
                      }}
                    >
                      <div>
                        <strong>{c.name}</strong>
                        <small>{u.bestQuality}</small>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="tg-lang"
                    style={{ width: "100%", marginTop: "0.35rem" }}
                    onClick={() => router.push("/tg/characters?section=train")}
                  >
                    {u.trainCta}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <h2 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem" }}>{u.upload}</h2>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void onUpload(e.target.files)}
              />
              <button
                type="button"
                className="tg-primary-btn"
                style={{ width: "100%" }}
                onClick={() => fileRef.current?.click()}
              >
                📷 {u.upload} {photoCount > 0 ? `(${photoCount})` : ""}
              </button>

              {refs.length > 0 && (
                <>
                  <h2 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem" }}>
                    {u.useSaved}
                  </h2>
                  <div className="tg-card-list">
                    {refs.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`tg-char-card ${characterId === r.id ? "active" : ""}`}
                        disabled={!r.ready}
                        onClick={() => {
                          if (!r.ready) return;
                          setCharacterId(r.id);
                          setPhotoCount(r.photoCount);
                          setReady(true);
                        }}
                      >
                        <div>
                          <strong>{r.name}</strong>
                          <small>📸 {r.photoCount}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {speechSlots.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h2 style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>{u.speech}</h2>
              <p className="tg-muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
                {u.speechHint}
              </p>
              <label className="tg-speech-toggle">
                <span>{u.keepSpeech}</span>
                <input
                  type="checkbox"
                  checked={usePreviewSpeech}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setUsePreviewSpeech(on);
                    if (on) resetSpeechDefaults();
                  }}
                />
              </label>
              {!usePreviewSpeech && (
                <>
                  <p className="tg-muted" style={{ margin: "0 0 0.55rem", fontSize: "0.8rem" }}>
                    {u.customSpeech}
                  </p>
                  {speechSlots.map((s, i) => {
                    const max = s.maxChars || countSpeechSignificantChars(s.text) || 1;
                    const value = speechFills[s.id]?.text ?? s.text;
                    const used = countSpeechSignificantChars(value);
                    return (
                      <div
                        key={s.id}
                        style={{
                          marginBottom: "0.85rem",
                          padding: "0.75rem",
                          borderRadius: 12,
                          background: "rgba(255,255,255,0.04)",
                        }}
                      >
                        <div
                          style={{
                            marginBottom: "0.4rem",
                            fontSize: "0.85rem",
                          }}
                        >
                          <strong>{s.label || `${u.line} ${i + 1}`}</strong>
                        </div>
                        <textarea
                          value={value}
                          placeholder={s.text || undefined}
                          rows={2}
                          onChange={(e) =>
                            setSpeechFills((prev) => ({
                              ...prev,
                              [s.id]: {
                                text: clipSpeechText(e.target.value, max),
                                lang: "ru",
                              },
                            }))
                          }
                          style={{
                            width: "100%",
                            borderRadius: 10,
                            border: "1px solid rgba(255,255,255,0.15)",
                            background: "rgba(0,0,0,0.2)",
                            color: "inherit",
                            padding: "0.55rem 0.65rem",
                            resize: "vertical",
                            font: "inherit",
                          }}
                        />
                        <small className="tg-muted">
                          {used}/{max}
                          {locale === "ru" ? " (без пробелов)" : " (no spaces)"}
                        </small>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {err && (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="tg-error">{err}</p>
              {(err.includes(u.needPeaches) || /персик|peach/i.test(err)) && (
                <button
                  type="button"
                  className="tg-primary-btn"
                  style={{ width: "100%", marginTop: "0.4rem" }}
                  onClick={() => sendAction({ action: "topup" })}
                >
                  {u.topup}
                </button>
              )}
              {(err === u.needLora || /lora/i.test(err)) && (
                <button
                  type="button"
                  className="tg-primary-btn"
                  style={{ width: "100%", marginTop: "0.4rem" }}
                  onClick={() => router.push("/tg/characters?section=train")}
                >
                  {u.trainCta}
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            className="tg-primary-btn"
            style={{ marginTop: "1rem", width: "100%" }}
            disabled={!ready || busy || (isLoraI2v && !characterId)}
            onClick={() => void onGenerate()}
          >
            {busy ? u.starting : u.generate}
          </button>
        </div>
      )}
    </TgShell>
  );
}

export default function TgVideoPage() {
  return (
    <Suspense fallback={<p className="tg-loading">…</p>}>
      <VideoPageInner />
    </Suspense>
  );
}
