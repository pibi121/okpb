"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TgShell, useTgMiniApp } from "@/lib/tg/miniapp/client";

const UI = {
  ru: {
    title: "Раздеть",
    price: "Стоимость: {n}🍑",
    free: "Тебе доступно 1 бесплатное раздевание",
    upload: "Загрузить фото",
    go: "Раздеть",
    busy: "Раздеваю…",
    err: "Ошибка",
    needPhoto: "Сначала загрузи фото",
    disclaimer: `Раздеть по 1 фото — пробная функция. Качество среднее по сравнению с видео/фото по образу и видео по 1 фото.

Если хочешь супер качество — выбери эти режимы в меню. Здесь можно быстро попробовать раздевание за 10–15 секунд.`,
  },
  en: {
    title: "Undress",
    price: "Price: {n}🍑",
    free: "You have 1 free undress",
    upload: "Upload photo",
    go: "Undress",
    busy: "Undressing…",
    err: "Error",
    needPhoto: "Upload a photo first",
    disclaimer: `Undress from 1 photo is a trial feature. Quality is average vs photo/video by look and video from 1 photo.

For best quality use those modes. Here you can quickly try undressing in 10–15 seconds.`,
  },
} as const;

function UndressInner() {
  const router = useRouter();
  const params = useSearchParams();
  const claimFree = params.get("free") === "1";
  const { status, locale, apiFetch, refresh } = useTgMiniApp();
  const u = UI[locale];

  const [price, setPrice] = useState(25);
  const [freeCredits, setFreeCredits] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch("/api/tg/undress");
    if (!res.ok) return;
    const data = (await res.json()) as {
      pricePeaches: number;
      freeCredits: number;
    };
    setPrice(data.pricePeaches);
    setFreeCredits(data.freeCredits);
  }, [apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load, claimFree]);

  const onFile = (f: File | null) => {
    setFile(f);
    setErr("");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : "");
  };

  const generate = async () => {
    if (!file) {
      setErr(u.needPhoto);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await apiFetch(`/api/tg/undress?locale=${locale}`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        setErr(data.error || u.err);
        return;
      }
      void refresh();
      try {
        sessionStorage.setItem(
          "tg_just_generated",
          JSON.stringify({ at: Date.now(), kind: "undress" }),
        );
      } catch {
        /* ignore */
      }
      router.push("/tg/gallery");
    } catch {
      setErr(u.err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TgShell locale={locale}>
      <div className="tg-undress">
        <h1>{u.title}</h1>
        <div className="tg-undress-price">
          {freeCredits >= 1
            ? u.free
            : u.price.replace("{n}", String(price))}
        </div>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="tg-undress-preview" />
        ) : null}
        <div className="tg-undress-actions">
          <label className="tg-undress-upload">
            {u.upload}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            type="button"
            className="tg-undress-go"
            disabled={busy || !file}
            onClick={() => void generate()}
          >
            {busy ? u.busy : u.go}
          </button>
        </div>
        {err ? <p style={{ color: "#f88" }}>{err}</p> : null}
        <p className="tg-undress-disclaimer">{u.disclaimer}</p>
      </div>
    </TgShell>
  );
}

export default function UndressPage() {
  return (
    <Suspense fallback={null}>
      <UndressInner />
    </Suspense>
  );
}
