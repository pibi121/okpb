"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QuickVideoTemplateOnboardingModal } from "@/components/quick-video-template-onboarding-modal";
import {
  buildPhotoTemplateApplyPayload,
  type PeachPhotoTemplateDetail,
} from "@/lib/peach-photo-template-shared";
import { requestPhotoTemplateApply } from "@/lib/generation-restore";

type Char = { id: string; name: string };

export function PhotoTemplateUseFlow({ characters }: { characters: Char[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get("photoTemplate");

  const [detail, setDetail] = useState<PeachPhotoTemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [error, setError] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);

  const clearParam = useCallback(() => {
    const u = new URL(window.location.href);
    u.searchParams.delete("photoTemplate");
    router.replace(u.pathname + u.search, { scroll: false });
  }, [router]);

  useEffect(() => {
    if (!templateId) {
      setDetail(null);
      setShowOnboarding(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetch(`/api/peach/photo/templates/${templateId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.template) {
          setError("Шаблон не найден");
          return;
        }
        setDetail(data.template as PeachPhotoTemplateDetail);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить шаблон");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  async function purchaseAndContinue() {
    if (!templateId) return;
    setPurchaseBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/peach/photo/templates/${templateId}/purchase`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "ошибка"));
      setDetail(data.template as PeachPhotoTemplateDetail);
      setShowOnboarding(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setPurchaseBusy(false);
    }
  }

  useEffect(() => {
    if (!detail?.owned) return;
    setShowOnboarding(true);
  }, [detail?.owned, detail?.id]);

  if (!templateId) return null;

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#121214] px-4 py-3 text-sm text-zinc-400">
        Загрузка шаблона фото…
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-950/20 px-4 py-3 text-sm text-red-300">
        {error}
        <button type="button" className="ml-3 underline" onClick={clearParam}>
          Закрыть
        </button>
      </div>
    );
  }

  if (!detail) return null;

  const needsPurchase =
    !detail.owned && detail.isJuice && detail.priceCredits > 0;

  if (needsPurchase && !showOnboarding) {
    return (
      <div className="rounded-xl border border-peach/30 bg-peach/5 p-4">
        <h3 className="font-medium">{detail.title}</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Juice-шаблон · разблокировка{" "}
          <strong className="text-peach">{detail.priceCredits} кр.</strong>
        </p>
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-2 text-sm"
            onClick={clearParam}
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={purchaseBusy}
            className="rounded-full bg-peach px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            onClick={() => void purchaseAndContinue()}
          >
            {purchaseBusy ? "Покупаю…" : `Купить за ${detail.priceCredits} кр.`}
          </button>
        </div>
      </div>
    );
  }

  if (!detail.owned && !needsPurchase && !showOnboarding) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#121214] p-4">
        <h3 className="font-medium">{detail.title}</h3>
        <p className="mt-1 text-sm text-zinc-400">Бесплатный шаблон фото</p>
        <button
          type="button"
          className="mt-3 rounded-full bg-peach px-4 py-2 text-sm font-medium text-black"
          onClick={() => setShowOnboarding(true)}
        >
          Выбрать персонажа и открыть
        </button>
      </div>
    );
  }

  if (!showOnboarding) return null;

  return (
    <QuickVideoTemplateOnboardingModal
      template={{
        id: detail.id,
        title: detail.title,
        notes: detail.notes,
        category: detail.category,
        isJuice: detail.isJuice,
        priceCredits: detail.priceCredits,
        identityPersonCount: 1,
        hasLocationSlot: false,
        previewVideoUrl: "",
        previewPhotoUrl: detail.previewImageUrl,
        orientation: detail.orientation,
        durationSec: 0,
        owned: detail.owned,
        isAuthor: detail.isAuthor,
        defaultLocationUrl: detail.defaultLocationUrl,
      }}
      characters={characters}
      onCancel={() => {
        setShowOnboarding(false);
        clearParam();
      }}
      onContinue={(result) => {
        const apply = buildPhotoTemplateApplyPayload(detail);
        requestPhotoTemplateApply({
          ...apply,
          identityMode: result.identityMode,
          characterIds: result.characterIds,
          customName: result.customName,
          identityFiles: result.identityFiles,
          locationFile: result.locationFile,
        });
        setShowOnboarding(false);
        clearParam();
        document.getElementById("photo-lab-form")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }}
    />
  );
}
