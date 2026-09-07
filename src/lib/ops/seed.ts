import { prisma } from "@/lib/db";
import { M as I18N_DEFAULTS } from "@/lib/tg/i18n";
import { seedFunnelCopy, loadCopyOverlay } from "@/lib/ops/copy";
import { seedSystemNotices } from "@/lib/ops/notices";
import { ensureOpsOwner } from "@/lib/ops/auth";
import { getOpsSettings } from "@/lib/ops/settings";
import { setPriceOverlay } from "@/lib/ops/prices";

let booted = false;

export async function bootOps(): Promise<void> {
  if (booted) return;
  try {
    await ensureOpsOwner();
    await seedSystemNotices();
    await seedFunnelCopy(I18N_DEFAULTS);
    const settings = await getOpsSettings();
    setPriceOverlay(settings.pricesJson);
    await loadCopyOverlay();
    void import("@/lib/gpu/workers")
      .then(({ ensurePlaceholderWorkers }) => ensurePlaceholderWorkers())
      .catch(() => undefined);
    booted = true;
  } catch (e) {
    console.error("[ops] boot failed:", e);
  }
}
