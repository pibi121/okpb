/**
 * Due scheduled broadcasts (status=scheduled, scheduledAt <= now).
 * In-process tick + file lock (same pattern as ops-telegram-digest).
 */
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { dataRoot, ensureDataDirs } from "@/lib/paths";
import { runBroadcast } from "@/lib/ops/broadcast";

const LOCK = () => path.join(dataRoot(), "ops-broadcast-schedule.lock");
const TICK_MS = 60_000;

function tryLock(): boolean {
  ensureDataDirs();
  const lock = LOCK();
  try {
    fs.writeFileSync(lock, `${process.pid}:${Date.now()}`, { flag: "wx" });
    return true;
  } catch {
    try {
      const st = fs.statSync(lock);
      if (Date.now() - st.mtimeMs > 120_000) {
        fs.unlinkSync(lock);
        fs.writeFileSync(lock, `${process.pid}:${Date.now()}`, { flag: "wx" });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK());
  } catch {
    /* ignore */
  }
}

export async function tickScheduledBroadcasts(): Promise<number> {
  const { maintenanceStubText } = await import("@/lib/ops/maintenance-stub");
  if (await maintenanceStubText()) return 0;
  if (!tryLock()) return 0;
  let started = 0;
  try {
    const due = await prisma.broadcast.findMany({
      where: {
        status: "scheduled",
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
      take: 3,
      select: { id: true, title: true },
    });
    for (const row of due) {
      try {
        await runBroadcast(row.id);
        started += 1;
        console.log(
          `[ops] scheduled broadcast started: ${row.id} (${row.title})`,
        );
      } catch (e) {
        console.error(
          `[ops] scheduled broadcast ${row.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } finally {
    releaseLock();
  }
  return started;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startBroadcastScheduler() {
  if (timer) return;
  const tick = () => {
    void tickScheduledBroadcasts().catch((e) =>
      console.error("[ops] broadcast scheduler tick:", e),
    );
  };
  setTimeout(tick, 25_000);
  timer = setInterval(tick, TICK_MS);
  console.log("[ops] broadcast scheduler every 60s (MSK scheduledAt→UTC)");
}
