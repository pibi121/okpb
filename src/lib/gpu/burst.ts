import { prisma } from "@/lib/db";
import { getOpsSettings, saveOpsSettings } from "@/lib/ops/settings";
import {
  runpodReady,
  runpodProxyUrl,
  spawnRunpodVideoBurst,
  terminateRunpodPod,
} from "@/lib/gpu/providers/runpod";
import {
  vastReady,
  spawnVastLoraBurst,
  destroyVastInstance,
} from "@/lib/gpu/providers/vast";

function parseOrch(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function providerReadiness() {
  const rp = runpodReady();
  const vs = vastReady();
  return {
    runpod: Boolean(process.env.RUNPOD_API_KEY?.trim()),
    vast: Boolean(process.env.VAST_API_KEY?.trim()),
    runpodSpawnReady: rp.ok,
    vastSpawnReady: vs.ok,
    runpodMissing: rp.missing,
    vastMissing: vs.missing,
    runpodDryRun: rp.dryRun,
    vastDryRun: vs.dryRun,
  };
}

async function markBurstWorker(opts: {
  key: string;
  label: string;
  provider: string;
  pool: "video" | "lora";
  status: string;
  enabled: boolean;
  comfyUrl: string;
  meta: Record<string, unknown>;
  costRubPerHour: number;
}) {
  await prisma.gpuWorker.upsert({
    where: { key: opts.key },
    create: {
      key: opts.key,
      label: opts.label,
      provider: opts.provider,
      pool: opts.pool,
      comfyUrl: opts.comfyUrl,
      enabled: opts.enabled,
      status: opts.status,
      costRubPerHour: opts.costRubPerHour,
      metaJson: JSON.stringify(opts.meta),
    },
    update: {
      label: opts.label,
      provider: opts.provider,
      pool: opts.pool,
      comfyUrl: opts.comfyUrl,
      enabled: opts.enabled,
      status: opts.status,
      costRubPerHour: opts.costRubPerHour,
      metaJson: JSON.stringify(opts.meta),
      lastHeartbeatAt: new Date(),
      lastError: opts.status.startsWith("error") ? String(opts.meta.lastError || "") : "",
    },
  });
}

export async function requestVideoBurst(actorId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const settings = await getOpsSettings();
  const orch = parseOrch(settings.gpuOrchestratorJson);
  const ready = runpodReady();

  if (!ready.ok) {
    orch.pendingBurstVideo = {
      at: new Date().toISOString(),
      by: actorId,
      status: "awaiting_provider_config",
      missing: ready.missing,
    };
    await saveOpsSettings({ gpuOrchestratorJson: JSON.stringify(orch) });
    await markBurstWorker({
      key: "burst-video-slot",
      label: "Пик видео (RunPod) — ждёт конфиг",
      provider: "runpod",
      pool: "video",
      status: "pending_provider",
      enabled: false,
      comfyUrl: "",
      costRubPerHour: 80,
      meta: { role: "burst", missing: ready.missing },
    });
    return {
      ok: true,
      message: `Заявка записана. Для авто-аренды задайте в Railway: ${ready.missing.join(", ")}`,
    };
  }

  const spawned = await spawnRunpodVideoBurst(actorId);
  orch.pendingBurstVideo = {
    at: new Date().toISOString(),
    by: actorId,
    status: spawned.ok ? "spawned" : "spawn_failed",
    podId: spawned.podId || null,
    detail: spawned.message,
  };
  await saveOpsSettings({ gpuOrchestratorJson: JSON.stringify(orch) });

  if (!spawned.ok || !spawned.podId) {
    await markBurstWorker({
      key: "burst-video-slot",
      label: "Пик видео (RunPod) — ошибка",
      provider: "runpod",
      pool: "video",
      status: "error",
      enabled: false,
      comfyUrl: "",
      costRubPerHour: 80,
      meta: { role: "burst", lastError: spawned.message, raw: spawned.raw || null },
    });
    return { ok: false, message: spawned.message };
  }

  const comfyUrl = runpodProxyUrl(spawned.podId, process.env.RUNPOD_COMFY_PORT || "8188");
  await markBurstWorker({
    key: "burst-video-slot",
    label: `Пик видео RunPod ${spawned.podId}`,
    provider: "runpod",
    pool: "video",
    status: ready.dryRun ? "pending_provider" : "booting",
    enabled: !ready.dryRun,
    comfyUrl: ready.dryRun ? "" : comfyUrl,
    costRubPerHour: 80,
    meta: {
      role: "burst",
      podId: spawned.podId,
      dryRun: ready.dryRun,
      spawnedAt: new Date().toISOString(),
      by: actorId,
    },
  });

  return { ok: true, message: spawned.message };
}

export async function requestLoraBurst(actorId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const settings = await getOpsSettings();
  const orch = parseOrch(settings.gpuOrchestratorJson);
  const ready = vastReady();

  if (!ready.ok) {
    orch.pendingBurstLora = {
      at: new Date().toISOString(),
      by: actorId,
      status: "awaiting_provider_config",
      missing: ready.missing,
    };
    await saveOpsSettings({ gpuOrchestratorJson: JSON.stringify(orch) });
    await markBurstWorker({
      key: "burst-lora-slot",
      label: "LoRA burst — ждёт конфиг",
      provider: "vast",
      pool: "lora",
      status: "pending_provider",
      enabled: false,
      comfyUrl: "",
      costRubPerHour: 40,
      meta: { role: "lora_burst", missing: ready.missing },
    });
    return {
      ok: true,
      message: `Заявка записана. Для авто-аренды задайте в Railway: ${ready.missing.join(", ")}`,
    };
  }

  const spawned = await spawnVastLoraBurst(actorId);
  orch.pendingBurstLora = {
    at: new Date().toISOString(),
    by: actorId,
    status: spawned.ok ? "spawned" : "spawn_failed",
    instanceId: spawned.instanceId ?? null,
    offerId: spawned.offerId ?? null,
    detail: spawned.message,
  };
  await saveOpsSettings({ gpuOrchestratorJson: JSON.stringify(orch) });

  if (!spawned.ok || spawned.instanceId == null) {
    await markBurstWorker({
      key: "burst-lora-slot",
      label: "LoRA burst — ошибка",
      provider: "vast",
      pool: "lora",
      status: "error",
      enabled: false,
      comfyUrl: "",
      costRubPerHour: 40,
      meta: { role: "lora_burst", lastError: spawned.message, raw: spawned.raw || null },
    });
    return { ok: false, message: spawned.message };
  }

  await markBurstWorker({
    key: "burst-lora-slot",
    label: `LoRA Vast ${spawned.instanceId}`,
    provider: "vast",
    pool: "lora",
    status: ready.dryRun ? "pending_provider" : "booting",
    enabled: false, // SSH/Comfy URL unknown until instance reports ports
    comfyUrl: "",
    costRubPerHour: 40,
    meta: {
      role: "lora_burst",
      instanceId: spawned.instanceId,
      offerId: spawned.offerId ?? null,
      dryRun: ready.dryRun,
      spawnedAt: new Date().toISOString(),
      by: actorId,
      note: "Подставь Comfy URL в GpuWorker когда инстанс поднимется",
    },
  });

  return { ok: true, message: spawned.message };
}

export async function clearBurstRequests(): Promise<{ ok: boolean; message: string }> {
  const settings = await getOpsSettings();
  const orch = parseOrch(settings.gpuOrchestratorJson);
  const video = orch.pendingBurstVideo as { podId?: string } | undefined;
  const lora = orch.pendingBurstLora as { instanceId?: string | number } | undefined;

  const notes: string[] = [];
  if (video?.podId) {
    const t = await terminateRunpodPod(video.podId);
    notes.push(t.message);
  }
  if (lora?.instanceId != null) {
    const d = await destroyVastInstance(lora.instanceId);
    notes.push(d.message);
  }

  delete orch.pendingBurstVideo;
  delete orch.pendingBurstLora;
  await saveOpsSettings({ gpuOrchestratorJson: JSON.stringify(orch) });

  await markBurstWorker({
    key: "burst-video-slot",
    label: "Пик видео (RunPod) — слот свободен",
    provider: "runpod",
    pool: "video",
    status: "pending_provider",
    enabled: false,
    comfyUrl: "",
    costRubPerHour: 80,
    meta: { role: "burst", clearedAt: new Date().toISOString() },
  });
  await markBurstWorker({
    key: "burst-lora-slot",
    label: "LoRA burst — слот свободен",
    provider: "vast",
    pool: "lora",
    status: "pending_provider",
    enabled: false,
    comfyUrl: "",
    costRubPerHour: 40,
    meta: { role: "lora_burst", clearedAt: new Date().toISOString() },
  });

  return {
    ok: true,
    message: notes.length
      ? `Заявки очищены. ${notes.join(" · ")}`
      : "Заявки на докупку GPU очищены.",
  };
}
