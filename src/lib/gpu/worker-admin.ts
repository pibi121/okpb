import { prisma } from "@/lib/db";
import { pingWorkerComfy } from "@/lib/gpu/workers";

const RESERVED_KEYS = new Set([
  "metalnode-primary",
  "burst-video-slot",
  "burst-lora-slot",
]);

function slugKey(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeComfyUrl(url: string) {
  const u = url.trim().replace(/\/$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) {
    return `http://${u}`;
  }
  return u;
}

export type ManualWorkerInput = {
  key?: string;
  label: string;
  provider?: string;
  pool?: string;
  comfyUrl: string;
  costRubPerHour?: number;
  enabled?: boolean;
  meta?: Record<string, unknown>;
};

export async function createManualWorker(input: ManualWorkerInput) {
  const label = input.label.trim();
  if (!label) throw new Error("Нужно название карты");
  const comfyUrl = normalizeComfyUrl(input.comfyUrl);
  if (!comfyUrl) throw new Error("Нужен URL Comfy (например http://host:8188)");

  let key = slugKey(input.key || label);
  if (!key) key = `gpu-${Date.now().toString(36)}`;
  if (RESERVED_KEYS.has(key)) {
    throw new Error(`Ключ «${key}» зарезервирован системой`);
  }
  const existing = await prisma.gpuWorker.findUnique({ where: { key } });
  if (existing) throw new Error(`Карта с ключом «${key}» уже есть`);

  const pool = ["photo", "video", "lora", "any"].includes(String(input.pool))
    ? String(input.pool)
    : "any";
  const provider = (input.provider || "manual").trim().slice(0, 40) || "manual";
  const cost =
    typeof input.costRubPerHour === "number" && input.costRubPerHour > 0
      ? Math.round(input.costRubPerHour)
      : 55;

  const ping = await pingWorkerComfy(comfyUrl);
  const row = await prisma.gpuWorker.create({
    data: {
      key,
      label,
      provider,
      pool,
      comfyUrl,
      enabled: input.enabled !== false,
      status: ping.ok ? "online" : "dead",
      lastHeartbeatAt: new Date(),
      lastError: ping.ok ? "" : ping.detail,
      costRubPerHour: cost,
      metaJson: JSON.stringify({
        source: "manual",
        ...(input.meta || {}),
        lastPing: ping,
      }),
    },
  });
  return {
    worker: row,
    message: ping.ok
      ? `Карта «${label}» добавлена и онлайн`
      : `Карта «${label}» добавлена, но Comfy пока не отвечает: ${ping.detail}`,
  };
}

export async function updateManualWorker(
  id: string,
  patch: Partial<ManualWorkerInput> & { enabled?: boolean },
) {
  const row = await prisma.gpuWorker.findUnique({ where: { id } });
  if (!row) throw new Error("Карта не найдена");

  const data: Record<string, unknown> = {};
  if (typeof patch.label === "string" && patch.label.trim()) {
    data.label = patch.label.trim();
  }
  if (typeof patch.provider === "string" && patch.provider.trim()) {
    data.provider = patch.provider.trim().slice(0, 40);
  }
  if (patch.pool && ["photo", "video", "lora", "any"].includes(patch.pool)) {
    data.pool = patch.pool;
  }
  if (typeof patch.comfyUrl === "string") {
    const url = normalizeComfyUrl(patch.comfyUrl);
    if (!url && row.key === "metalnode-primary") {
      // allow primary to keep tunnel localhost
    } else if (!url) {
      throw new Error("Нужен URL Comfy");
    } else {
      data.comfyUrl = url;
    }
  }
  if (typeof patch.costRubPerHour === "number" && patch.costRubPerHour > 0) {
    data.costRubPerHour = Math.round(patch.costRubPerHour);
  }
  if (typeof patch.enabled === "boolean") {
    data.enabled = patch.enabled;
    if (!patch.enabled) data.status = "offline";
  }

  const updated = await prisma.gpuWorker.update({ where: { id }, data });
  if (updated.enabled && updated.comfyUrl) {
    const ping = await pingWorkerComfy(updated.comfyUrl);
    return prisma.gpuWorker.update({
      where: { id },
      data: {
        status: ping.ok ? (updated.currentJobId ? "busy" : "online") : "dead",
        lastHeartbeatAt: new Date(),
        lastError: ping.ok ? "" : ping.detail,
      },
    });
  }
  return updated;
}

export async function deleteManualWorker(id: string) {
  const row = await prisma.gpuWorker.findUnique({ where: { id } });
  if (!row) throw new Error("Карта не найдена");
  if (row.key === "metalnode-primary") {
    throw new Error("Основную Metalnode нельзя удалить — выключите или смените URL");
  }
  if (row.currentJobId) {
    throw new Error("На карте идёт джоб — сначала дождитесь или сбросьте зависшие");
  }
  await prisma.gpuWorker.delete({ where: { id } });
  return { ok: true, message: `Карта «${row.label}» удалена` };
}

/** Soft budgets by pool — fail hung ledger rows so кабинет не врёт «в работе 13 мин». */
function staleLimitMs(kind: string, pool: string) {
  const k = `${kind} ${pool}`.toLowerCase();
  if (k.includes("train") || pool === "lora") return 150 * 60_000;
  if (pool === "video" || /video|clip|film|i2v|quick|animate/.test(k)) {
    return 40 * 60_000;
  }
  // photo / any
  return 8 * 60_000;
}

export async function sweepStaleGpuJobs(): Promise<number> {
  const active = await prisma.gpuJob.findMany({
    where: { status: { in: ["queued", "assigned", "running"] } },
    take: 80,
  });
  const now = Date.now();
  let n = 0;
  for (const job of active) {
    const started = (job.startedAt || job.queuedAt).getTime();
    const limit = staleLimitMs(job.kind, job.pool);
    if (now - started < limit) continue;
    const mins = Math.round((now - started) / 60_000);
    await prisma.gpuJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        stage: "error",
        error: `stale timeout after ${mins} min (limit ${Math.round(limit / 60_000)} min)`,
        finishedAt: new Date(),
        runMs: job.startedAt
          ? Math.max(0, now - job.startedAt.getTime())
          : null,
      },
    });
    if (job.workerId) {
      await prisma.gpuWorker
        .update({
          where: { id: job.workerId },
          data: { currentJobId: null, status: "online" },
        })
        .catch(() => undefined);
    }
    if (job.refType === "galleryItem" && job.refId) {
      try {
        const item = await prisma.galleryItem.findUnique({
          where: { id: job.refId },
        });
        if (item) {
          let meta: Record<string, unknown> = {};
          try {
            meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
          } catch {
            meta = {};
          }
          if (meta.status === "pending") {
            await prisma.galleryItem.update({
              where: { id: item.id },
              data: {
                metaJson: JSON.stringify({
                  ...meta,
                  status: "error",
                  error: `Таймаут GPU (~${mins} мин)`,
                }),
              },
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
    n += 1;
  }
  return n;
}
