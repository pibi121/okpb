import { prisma } from "@/lib/db";
import type { TgLocale } from "@/lib/tg/i18n";

export type OpsSettings = {
  maintenance: boolean;
  maintenanceMessageRu: string;
  maintenanceMessageEn: string;
  loadMode: boolean;
  loadMessageRu: string;
  loadMessageEn: string;
  lastBroadcastAt: Date | null;
  pricesJson: string;
  sloJson: string;
  gpuOrchestratorJson: string;
  tgFunnelNoteRuFileId: string;
  tgFunnelNoteEnFileId: string;
  tgFunnelNoteCapture: string;
};

const DEFAULT_MAINT_RU =
  "Сейчас идут технические работы. Генерации временно недоступны — напишем, как всё заработает.";
const DEFAULT_MAINT_EN =
  "We're doing a short maintenance. Generations are paused — we'll message you when we're back.";
const DEFAULT_LOAD_RU =
  "Сейчас большая нагрузка: очередь длиннее обычного. Можно подождать или зайти чуть позже.";
const DEFAULT_LOAD_EN =
  "We're under heavy load — the queue is longer than usual. You can wait or come back in a bit.";

let cache: { at: number; value: OpsSettings } | null = null;

export async function getOpsSettings(): Promise<OpsSettings> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const row = await prisma.opsSetting.upsert({
    where: { id: "main" },
    create: {
      id: "main",
      maintenanceMessageRu: DEFAULT_MAINT_RU,
      maintenanceMessageEn: DEFAULT_MAINT_EN,
      loadMessageRu: DEFAULT_LOAD_RU,
      loadMessageEn: DEFAULT_LOAD_EN,
    },
    update: {},
  });
  const value: OpsSettings = {
    maintenance: row.maintenance,
    maintenanceMessageRu: row.maintenanceMessageRu || DEFAULT_MAINT_RU,
    maintenanceMessageEn: row.maintenanceMessageEn || DEFAULT_MAINT_EN,
    loadMode: row.loadMode,
    loadMessageRu: row.loadMessageRu || DEFAULT_LOAD_RU,
    loadMessageEn: row.loadMessageEn || DEFAULT_LOAD_EN,
    lastBroadcastAt: row.lastBroadcastAt,
    pricesJson: row.pricesJson || "{}",
    sloJson: row.sloJson || "{}",
    gpuOrchestratorJson: row.gpuOrchestratorJson || "{}",
    tgFunnelNoteRuFileId: row.tgFunnelNoteRuFileId || "",
    tgFunnelNoteEnFileId: row.tgFunnelNoteEnFileId || "",
    tgFunnelNoteCapture: row.tgFunnelNoteCapture || "",
  };
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateOpsSettings() {
  cache = null;
}

export async function saveOpsSettings(
  patch: Partial<
    Omit<OpsSettings, "lastBroadcastAt"> & {
      lastBroadcastAt?: Date | null;
    }
  >,
) {
  await prisma.opsSetting.upsert({
    where: { id: "main" },
    create: {
      id: "main",
      ...patch,
    },
    update: patch,
  });
  invalidateOpsSettings();
  return getOpsSettings();
}

export function opsMessage(
  settings: OpsSettings,
  slot: "maintenance" | "load",
  locale: TgLocale,
): string {
  if (slot === "maintenance") {
    return locale === "en"
      ? settings.maintenanceMessageEn
      : settings.maintenanceMessageRu;
  }
  return locale === "en" ? settings.loadMessageEn : settings.loadMessageRu;
}
