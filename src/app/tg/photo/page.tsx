"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";
import { PHOTO_SCENE_CATEGORIES, photoMatchesSceneCategory, shuffleInPlace } from "@/lib/tg/feed-order";
import {
  TgBannerCarousel,
  useHorizontalBanners,
} from "@/lib/tg/miniapp/banners-ui";
import { TgCostBalanceBar } from "@/lib/tg/miniapp/cost-balance-bar";

type PhotoTpl = {
  id: string;
  title: string;
  notes: string;
  pricePeaches: number;
  previewImageUrl: string;
  sceneCategory?: string;
};

const UI = {
  ru: {
    title: "Сделать фото",
    pickTpl: "1. Выбери шаблон",
    pickChar: "2. Выбери персонажа",
    filter: "Фильтр",
    all: "Всё",
    generate: "Сделать фото",
    starting: "…",
    back: "← К шаблонам",
    showcase: "Каталог студии",
    personal: "Твои модели",
    emptyTpl: "Нет шаблонов в этой категории",
    emptyChar: "Нет обученных моделей — создай свою",
    create: "🚀 Создать модель",
    err: "Ошибка",
    topup: "Пополнить баланс",
    needPeaches: "Недостаточно персиков",
  },
  en: {
    title: "Make photo",
    pickTpl: "1. Pick a template",
    pickChar: "2. Pick a character",
    filter: "Filter",
    all: "All",
    generate: "Make photo",
    starting: "…",
    back: "← Templates",
    showcase: "Studio catalog",
    personal: "Your models",
    emptyTpl: "No templates in this category",
    emptyChar: "No trained models — create yours",
    create: "🚀 Create model",
    err: "Error",
    topup: "Top up balance",
    needPeaches: "Not enough peaches",
  },
} as const;

function PhotoPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const presetTpl = params.get("templateId") || "";
  const presetCharacterId = params.get("characterId") || params.get("castId") || "";

  const { status, error, profile, locale, apiFetch, refresh, sendAction } =
    useTgMiniApp();
  const u = UI[locale];
  const banners = useHorizontalBanners(apiFetch);

  const [templates, setTemplates] = useState<PhotoTpl[]>([]);
  const [templateId, setTemplateId] = useState(presetTpl);
  const [filterOpen, setFilterOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/tg/templates?kind=photo&locale=${locale}`);
    if (!res.ok) return;
    const data = (await res.json()) as { photo: PhotoTpl[] };
    setTemplates(shuffleInPlace([...(data.photo || [])]));
  }, [apiFetch, locale]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  const visible = templates.filter((t) =>
    photoMatchesSceneCategory(t.sceneCategory, category),
  );
  const castIdsKey = (profile?.casts || []).map((c) => c.id).join(",");
  const showcaseCasts = useMemo(() => {
    return shuffleInPlace([...(profile?.casts || [])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castIdsKey]);
  const selected = templates.find((t) => t.id === templateId);
  const lockedCharacter =
    presetCharacterId &&
    ([
      ...(profile?.casts || []).map((c) => ({ id: c.id, name: c.name })),
      ...(profile?.characters || []).map((c) => ({ id: c.id, name: c.name })),
    ].find((c) => c.id === presetCharacterId) || { id: presetCharacterId, name: "" });

  const onGenerate = async (characterId: string, tplId = templateId) => {
    if (!tplId) return;
    setBusy(presetCharacterId ? tplId : characterId);
    setErr("");
    const res = await apiFetch("/api/tg/generate/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: tplId, characterId, locale }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        need?: number;
        balance?: number;
      };
      if (j.error === "insufficient_balance") {
        setErr(
          `${u.needPeaches} (${j.need ?? selected?.pricePeaches} / ${j.balance ?? profile?.balancePeaches ?? 0})`,
        );
      } else {
        setErr(j.error || u.err);
      }
      return;
    }
    void refresh();
    try {
      sessionStorage.setItem(
        "tg_just_generated",
        JSON.stringify({ at: Date.now(), kind: "photo" }),
      );
    } catch {
      /* ignore */
    }
    router.push("/tg/gallery");
  };

  const pickTemplate = (id: string) => {
    if (presetCharacterId) {
      void onGenerate(presetCharacterId, id);
      return;
    }
    setTemplateId(id);
  };

  if (status === "loading") return <p className="tg-loading">…</p>;
  if (status === "error") return <p className="tg-error">{error}</p>;

  const personal =
    profile?.characters.filter(
      (c) => !c.isStudioCast && c.loraStatus === "lora_ready",
    ) || [];

  return (
    <TgShell locale={locale}>
      <TgBannerCarousel banners={banners} />
      {!templateId || !selected ? (
        <>
          <div className="tg-toolbar">
            <h2 style={{ margin: 0, fontSize: "0.95rem" }}>
              {u.pickTpl}
              {lockedCharacter && lockedCharacter.name
                ? ` · ${lockedCharacter.name}`
                : ""}
            </h2>
            <button
              type="button"
              className="tg-filter-btn"
              onClick={() => setFilterOpen((v) => !v)}
              aria-label={u.filter}
            >
              ⚙ {u.filter}
            </button>
          </div>
          {filterOpen && (
            <div className="tg-filter-sheet">
              <button
                type="button"
                className={!category ? "active" : ""}
                onClick={() => {
                  setCategory("");
                  setFilterOpen(false);
                }}
              >
                {u.all}
              </button>
              {PHOTO_SCENE_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={category === c.id ? "active" : ""}
                  onClick={() => {
                    setCategory(c.id);
                    setFilterOpen(false);
                  }}
                >
                  {locale === "en" ? c.en : c.ru}
                </button>
              ))}
            </div>
          )}
          {visible.length === 0 && <p className="tg-muted">{u.emptyTpl}</p>}
          <div className="tg-portrait-grid" style={{ padding: "0 0.75rem 1rem" }}>
            {visible.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tg-portrait-card"
                disabled={!!busy}
                onClick={() => pickTemplate(t.id)}
              >
                <div className="tg-portrait-media">
                  {t.previewImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.previewImageUrl} alt="" className="tg-portrait-img" />
                  ) : (
                    <div className="tg-portrait-placeholder" />
                  )}
                  <span className="tg-portrait-action ready">
                    {busy === t.id ? u.starting : u.generate}
                  </span>
                </div>
                <div className="tg-portrait-meta">
                  <strong>{t.title}</strong>
                  <small>{t.pricePeaches} 🍑</small>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="tg-section" style={{ paddingBottom: "0.25rem" }}>
            <button type="button" className="tg-lang" onClick={() => setTemplateId("")}>
              {u.back}
            </button>
            <p className="tg-section-hint" style={{ marginTop: "0.55rem" }}>
              {selected.title}
            </p>
            <TgCostBalanceBar
              cost={selected.pricePeaches}
              balance={profile?.balancePeaches ?? 0}
              locale={locale}
              onTopup={() => sendAction({ action: "topup" })}
            />
            <h2 style={{ fontSize: "1rem", margin: "0.75rem 0 0.35rem" }}>
              {u.pickChar}
            </h2>
          </div>
          {err && (
            <div style={{ padding: "0 0.75rem" }}>
              <p className="tg-error">{err}</p>
              {(err.includes(u.needPeaches) || /персик|peach/i.test(err)) && (
                <button
                  type="button"
                  className="tg-primary-btn"
                  style={{ width: "100%", marginTop: "0.35rem" }}
                  onClick={() => sendAction({ action: "topup" })}
                >
                  {u.topup}
                </button>
              )}
            </div>
          )}

          <div className="tg-section">
            <p className="tg-muted tg-section-hint">{u.showcase}</p>
            <div className="tg-portrait-grid">
              {showcaseCasts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="tg-portrait-card"
                  disabled={busy === c.id}
                  onClick={() => void onGenerate(c.id)}
                >
                  <div className="tg-portrait-media">
                    {c.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.coverUrl} alt="" className="tg-portrait-img" />
                    ) : (
                      <div className="tg-portrait-placeholder" />
                    )}
                    <span className="tg-portrait-action ready">
                      {busy === c.id ? u.starting : u.generate}
                    </span>
                  </div>
                  <div className="tg-portrait-meta">
                    <strong>{c.name}</strong>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="tg-section">
            <p className="tg-muted tg-section-hint">{u.personal}</p>
            <div className="tg-portrait-grid">
              {personal.length === 0 && (
                <p className="tg-muted tg-empty-grid">{u.emptyChar}</p>
              )}
              {personal.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="tg-portrait-card"
                  disabled={busy === c.id}
                  onClick={() => void onGenerate(c.id)}
                >
                  <div className="tg-portrait-media">
                    {c.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.coverUrl} alt="" className="tg-portrait-img" />
                    ) : (
                      <div className="tg-portrait-placeholder" />
                    )}
                    <span className="tg-portrait-action ready">
                      {busy === c.id ? u.starting : u.generate}
                    </span>
                  </div>
                  <div className="tg-portrait-meta">
                    <strong>{c.name}</strong>
                    <small>{locale === "en" ? "Ready" : "Готово"}</small>
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="tg-primary-btn"
              style={{ marginTop: "0.75rem", width: "100%" }}
              onClick={() => router.push("/tg/characters?section=train")}
            >
              {u.create}
            </button>
          </div>
        </>
      )}
    </TgShell>
  );
}

export default function TgPhotoPage() {
  return (
    <Suspense fallback={<p className="tg-loading">…</p>}>
      <PhotoPageInner />
    </Suspense>
  );
}
