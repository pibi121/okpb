import { getOpsSettings, MAINTENANCE_STUB_TEXT } from "@/lib/ops/settings";

/** Null when the bot is open. The phrase when tech work is on. */
export async function maintenanceStubText(): Promise<string | null> {
  const settings = await getOpsSettings();
  return settings.maintenance ? MAINTENANCE_STUB_TEXT : null;
}
