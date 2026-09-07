import { prisma } from "@/lib/db";
import { invalidateOpsSettings } from "@/lib/ops/settings";

/** One-shot secret commands to capture funnel video-notes (кругляшки). */
export const FUNNEL_NOTE_CMD_RU = "PB_SET_FUNNEL_NOTE_RU";
export const FUNNEL_NOTE_CMD_EN = "PB_SET_FUNNEL_NOTE_EN";

export function isFunnelNoteCommand(text: string): boolean {
  const t = text.trim().toUpperCase();
  return t === FUNNEL_NOTE_CMD_RU || t === FUNNEL_NOTE_CMD_EN;
}

export async function handleFunnelNoteCommand(
  text: string,
): Promise<{ reply: string }> {
  const cmd = text.trim().toUpperCase();
  const locale = cmd === FUNNEL_NOTE_CMD_EN ? "en" : "ru";

  const row = await prisma.opsSetting.upsert({
    where: { id: "main" },
    create: { id: "main" },
    update: {},
  });

  const already =
    locale === "en" ? row.tgFunnelNoteEnFileId : row.tgFunnelNoteRuFileId;
  if (already) {
    return {
      reply:
        locale === "en"
          ? "⛔ Command unavailable — EN video note is already saved."
          : "⛔ Команда недоступна — RU-кругляшок уже сохранён.",
    };
  }

  await prisma.opsSetting.update({
    where: { id: "main" },
    data: { tgFunnelNoteCapture: locale },
  });
  invalidateOpsSettings();

  return {
    reply:
      locale === "en"
        ? "📹 Send the EN video note (circle) as the next message. After save this command turns off."
        : "📹 Пришли RU video-note (кругляшок) следующим сообщением. После сохранения команда отключится.",
  };
}

export async function tryCaptureFunnelVideoNote(
  fileId: string,
): Promise<{ captured: boolean; reply?: string }> {
  const row = await prisma.opsSetting.findUnique({ where: { id: "main" } });
  const mode = (row?.tgFunnelNoteCapture || "").toLowerCase();
  if (mode !== "ru" && mode !== "en") {
    return { captured: false };
  }

  if (mode === "en" && row?.tgFunnelNoteEnFileId) {
    await prisma.opsSetting.update({
      where: { id: "main" },
      data: { tgFunnelNoteCapture: "" },
    });
    invalidateOpsSettings();
    return {
      captured: true,
      reply: "⛔ EN note already set — capture cancelled.",
    };
  }
  if (mode === "ru" && row?.tgFunnelNoteRuFileId) {
    await prisma.opsSetting.update({
      where: { id: "main" },
      data: { tgFunnelNoteCapture: "" },
    });
    invalidateOpsSettings();
    return {
      captured: true,
      reply: "⛔ RU note already set — capture cancelled.",
    };
  }

  await prisma.opsSetting.update({
    where: { id: "main" },
    data:
      mode === "en"
        ? { tgFunnelNoteEnFileId: fileId, tgFunnelNoteCapture: "" }
        : { tgFunnelNoteRuFileId: fileId, tgFunnelNoteCapture: "" },
  });
  invalidateOpsSettings();

  return {
    captured: true,
    reply:
      mode === "en"
        ? "✅ EN video note saved. Command PB_SET_FUNNEL_NOTE_EN is now disabled."
        : "✅ RU-кругляшок сохранён. Команда PB_SET_FUNNEL_NOTE_RU больше недоступна.",
  };
}
