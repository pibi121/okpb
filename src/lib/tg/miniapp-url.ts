import { publicSiteBaseUrl } from "@/lib/tg/public-site-url";

/** Base URL for TG Mini App (always /tg, not web cabinet). */
export function tgMiniAppBase(): string {
  const raw = process.env.TELEGRAM_MINIAPP_URL?.trim() || "";
  let base = raw
    ? raw.replace(/\/tg\/templates\/?$/i, "/tg").replace(/\/$/, "")
    : `${publicSiteBaseUrl()}/tg`;
  if (!/\/tg$/i.test(base)) {
    base = base.includes("/tg/") ? base.replace(/\/tg\/.*$/, "/tg") : `${base}/tg`;
  }
  return base;
}

export function tgMiniAppUrl(path = ""): string {
  const base = tgMiniAppBase();
  const p = path.replace(/^\//, "");
  return p ? `${base}/${p}` : base;
}

/** Mini App deep link straight into LoRA train UI. */
export const TG_LORA_TRAIN_PATH = "/tg/characters?section=train";

export function tgLoraTrainMiniAppUrl(): string {
  return tgMiniAppUrl("characters?section=train");
}

/** @deprecated use tgMiniAppUrl */
export function castsMiniAppUrl(): string {
  return tgMiniAppUrl("characters");
}
