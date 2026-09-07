/**
 * Turn off lookbook text overlay for user-trained GPU LoRAs.
 * Fixes emptyLookbook defaults (buzz cut, etc.) fighting character weights.
 */
import { prisma } from "@/lib/db";
import { lookbookJsonWithPromptOverlayOff } from "@/lib/lookbook";
import { isUserTrainedRealLora } from "@/lib/tg/studio-cast";

let migratePromise: Promise<number> | null = null;

export async function migrateUserLoraLookbookOverlayOff(): Promise<number> {
  if (migratePromise) return migratePromise;
  migratePromise = (async () => {
    const rows = await prisma.character.findMany({
      where: {
        isStudioCast: false,
        loraStatus: "lora_ready",
        triggerWord: { not: null },
        NOT: { loraPath: { startsWith: "mock://" } },
      },
      select: {
        id: true,
        gender: true,
        lookbookJson: true,
        loraStatus: true,
        triggerWord: true,
        loraPath: true,
        isStudioCast: true,
      },
    });

    let updated = 0;
    for (const ch of rows) {
      if (!isUserTrainedRealLora(ch)) continue;
      const gender = ch.gender === "male" ? "male" : "female";
      const next = lookbookJsonWithPromptOverlayOff(ch.lookbookJson, gender);
      if (next === ch.lookbookJson) continue;
      // Skip if already fully off
      try {
        const parsed = JSON.parse(ch.lookbookJson || "{}") as Record<string, string>;
        if (parsed._supplement === "0") {
          const keys = Object.keys(parsed).filter((k) => k.startsWith("_prompt_"));
          if (keys.length && keys.every((k) => parsed[k] === "0")) continue;
        }
      } catch {
        /* rewrite */
      }
      await prisma.character.update({
        where: { id: ch.id },
        data: { lookbookJson: next },
      });
      updated += 1;
    }
    if (updated > 0) {
      console.log(`[peach] lookbook overlay off for ${updated} user LoRA(s)`);
    }
    return updated;
  })().catch((e) => {
    migratePromise = null;
    throw e;
  });
  return migratePromise;
}
