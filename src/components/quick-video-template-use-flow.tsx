"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QuickVideoTemplateOnboardingModal } from "@/components/quick-video-template-onboarding-modal";
import {
  buildTemplateApplyPayload,
  type PublicQuickVideoTemplate,
  type QuickVideoTemplateDetail,
} from "@/lib/quick-video-template";
import { requestVideoTemplateApply } from "@/lib/generation-restore";
import { parseStoryH3Template } from "@/lib/story-h3-prompt";

type Char = { id: string; name: string };

export function QuickVideoTemplateUseFlow({
  characters,
}: {
  characters: Char[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get("qvTemplate");

  const [detail, setDetail] = useState<QuickVideoTemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [error, setError] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);

  const clearParam = useCallback(() => {
    const u = new URL(window.location.href);
    u.searchParams.delete("qvTemplate");
    router.replace(u.pathname + u.search);
  }, [router]);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/peach/quick-video/templates/${templateId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(String(data.error || "ошибка"));
        const tpl = data.template as QuickVideoTemplateDetail;
        if (parseStoryH3Template(tpl.shotsJson || "")) {
          if (!cancelled) {
            router.replace(`/peach/story-video?storyTemplate=${templateId}`);
          }
          return;
        }
        if (!cancelled) setDetail(tpl);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, router]);

  async function purchaseAndContinue() {
    if (!templateId) return;
    setPurchaseBusy(true);
    setError("");
    try {
      const buyRes = await fetch(
        `/api/peach/quick-video/templates/${templateId}/purchase`,
        { method: "POST" },
      );
      const buyData = await buyRes.json();
      if (!buyRes.ok) throw new Error(String(buyData.error || "ошибка покупки"));
      setDetail(buyData.template as QuickVideoTemplateDetail);
      setShowOnboarding(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setPurchaseBusy(false);
    }
  }

  useEffect(() => {
    if (!detail) return;
    if (detail.owned) setShowOnboarding(true);
  }, [detail]);

  if (!templateId) return null;

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#121214] px-4 py-3 text-sm text-zinc-400">
        Загрузка шаблона…
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
          Juice-шаблон · разовая покупка{" "}
          <strong className="text-peach">{detail.priceCredits} кр.</strong> (~$
          {(detail.priceCredits * 0.01).toFixed(2)}). После покупки — без доплат
          за использование, только генерация.
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

  if (!showOnboarding) return null;

  return (
    <QuickVideoTemplateOnboardingModal
      template={detail as PublicQuickVideoTemplate}
      characters={characters}
      onCancel={() => {
        setShowOnboarding(false);
        clearParam();
      }}
      onContinue={(result) => {
        const apply = buildTemplateApplyPayload(detail);
        requestVideoTemplateApply({
          ...apply,
          identityMode: result.identityMode,
          characterIds: result.characterIds,
          customName: result.customName,
          identityFiles: result.identityFiles,
          locationFile: result.locationFile,
        });
        setShowOnboarding(false);
        clearParam();
        document
          .getElementById("quick-video-editor")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    />
  );
}
