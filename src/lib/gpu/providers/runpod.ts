/**
 * RunPod Secure burst for peak video.
 * Env:
 *   RUNPOD_API_KEY
 *   RUNPOD_TEMPLATE_ID          — preferred (Comfy image + start cmd)
 *   RUNPOD_NETWORK_VOLUME_ID    — Secure Network Volume with weights (EU-RO-1)
 *   RUNPOD_DATA_CENTER_ID       — default EU-RO-1 (must match volume)
 *   RUNPOD_GPU_TYPE_ID          — default NVIDIA GeForce RTX 5090
 *   RUNPOD_CLOUD_TYPE           — SECURE | COMMUNITY | ALL (default SECURE)
 *   RUNPOD_IMAGE_NAME           — fallback if no template
 *   RUNPOD_DOCKER_START_CMD     — optional override / used with IMAGE_NAME
 *   RUNPOD_COMFY_PORT           — http port exposed (default 8188)
 *   RUNPOD_BURST_DRY_RUN=1      — skip live rent, return fake id
 */

export type RunpodReady = {
  ok: boolean;
  missing: string[];
  dryRun: boolean;
};

export type RunpodSpawnResult = {
  ok: boolean;
  podId?: string;
  message: string;
  raw?: unknown;
};

/** Boot: official Comfy image + symlink Metalnode weights from network volume */
export const DEFAULT_RUNPOD_DOCKER_START_CMD =
  'bash -lc \'set -euo pipefail; TARGET=/workspace/runpod-slim/ComfyUI; if [ ! -f "$TARGET/main.py" ]; then mkdir -p /workspace/runpod-slim; cp -a /opt/comfyui-baked "$TARGET"; fi; rm -rf "$TARGET/models" "$TARGET/custom_nodes"; ln -sfn /workspace/ComfyUI/models "$TARGET/models"; ln -sfn /workspace/ComfyUI/custom_nodes "$TARGET/custom_nodes"; cd "$TARGET"; exec python3 main.py --listen 0.0.0.0 --port 8188 --enable-cors-header\'';

function apiKey() {
  return process.env.RUNPOD_API_KEY?.trim() || "";
}

export function runpodReady(): RunpodReady {
  const missing: string[] = [];
  if (!apiKey()) missing.push("RUNPOD_API_KEY");
  const hasTemplate = Boolean(process.env.RUNPOD_TEMPLATE_ID?.trim());
  const hasImage = Boolean(process.env.RUNPOD_IMAGE_NAME?.trim());
  if (!hasTemplate && !hasImage) missing.push("RUNPOD_TEMPLATE_ID|RUNPOD_IMAGE_NAME");
  if (!process.env.RUNPOD_NETWORK_VOLUME_ID?.trim() && !process.env.RUNPOD_VOLUME_ID?.trim()) {
    missing.push("RUNPOD_NETWORK_VOLUME_ID");
  }
  return {
    ok: missing.length === 0,
    missing,
    dryRun: process.env.RUNPOD_BURST_DRY_RUN === "1",
  };
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const key = apiKey();
  const res = await fetch(`https://api.runpod.io/graphql?api_key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || body.errors?.length) {
    const msg = body.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!body.data) throw new Error("RunPod empty response");
  return body.data;
}

export async function spawnRunpodVideoBurst(actorId: string): Promise<RunpodSpawnResult> {
  const ready = runpodReady();
  if (!ready.ok) {
    return {
      ok: false,
      message: `RunPod не готов: не хватает ${ready.missing.join(", ")}`,
    };
  }

  const cloudType = (process.env.RUNPOD_CLOUD_TYPE || "SECURE").toUpperCase();
  const preferredGpu = process.env.RUNPOD_GPU_TYPE_ID?.trim() || "NVIDIA GeForce RTX 5090";
  const gpuFallbacks = (
    process.env.RUNPOD_GPU_FALLBACKS?.trim() ||
    `${preferredGpu},NVIDIA GeForce RTX 4090,NVIDIA L4`
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dataCenterId = process.env.RUNPOD_DATA_CENTER_ID?.trim() || "EU-RO-1";
  const templateId = process.env.RUNPOD_TEMPLATE_ID?.trim() || null;
  const networkVolumeId =
    process.env.RUNPOD_NETWORK_VOLUME_ID?.trim() ||
    process.env.RUNPOD_VOLUME_ID?.trim() ||
    null;
  const imageName =
    process.env.RUNPOD_IMAGE_NAME?.trim() ||
    (!templateId ? "runpod/comfyui:cuda12.8" : null);
  const dockerStartCmd =
    process.env.RUNPOD_DOCKER_START_CMD?.trim() || DEFAULT_RUNPOD_DOCKER_START_CMD;
  const comfyPort = process.env.RUNPOD_COMFY_PORT?.trim() || "8188";
  const name = `peach-burst-video-${Date.now().toString(36)}`;

  if (ready.dryRun) {
    const podId = `dryrun-${Date.now().toString(36)}`;
    return {
      ok: true,
      podId,
      message: `DRY RUN: pod ${podId} (actor=${actorId}). Живая аренда выключена RUNPOD_BURST_DRY_RUN=1.`,
    };
  }

  let lastError = "RunPod spawn failed";
  for (const gpuTypeId of gpuFallbacks) {
    const input: Record<string, unknown> = {
      cloudType,
      gpuCount: 1,
      volumeInGb: 0,
      containerDiskInGb: Number(process.env.RUNPOD_CONTAINER_DISK_GB || 40),
      minVcpuCount: 4,
      minMemoryInGb: 24,
      gpuTypeId,
      name,
      volumeMountPath: "/workspace",
      ports: `${comfyPort}/http,22/tcp`,
      dataCenterId,
      startSsh: true,
    };
    if (templateId) input.templateId = templateId;
    if (networkVolumeId) input.networkVolumeId = networkVolumeId;
    if (imageName) input.imageName = imageName;
    if (dockerStartCmd) input.dockerArgs = dockerStartCmd;

    try {
      const data = await gql<{
        podFindAndDeployOnDemand?: { id?: string; desiredStatus?: string; costPerHr?: number };
      }>(
        `mutation($input: PodFindAndDeployOnDemandInput!) {
          podFindAndDeployOnDemand(input: $input) {
            id
            desiredStatus
            imageName
            costPerHr
          }
        }`,
        { input },
      );
      const pod = data.podFindAndDeployOnDemand;
      if (!pod?.id) {
        lastError = `RunPod не вернул pod id (${gpuTypeId})`;
        continue;
      }
      return {
        ok: true,
        podId: pod.id,
        message: `RunPod pod ${pod.id} (${pod.desiredStatus || "created"}, ${gpuTypeId}) — Comfy поднимется после старта образа`,
        raw: { ...pod, gpuTypeId },
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 280) : "RunPod spawn failed";
      // try next GPU type on capacity miss
      if (!/no longer any instances|capacity|stock|available/i.test(lastError)) {
        return { ok: false, message: lastError };
      }
    }
  }

  return { ok: false, message: lastError };
}

export async function terminateRunpodPod(podId: string): Promise<RunpodSpawnResult> {
  if (!apiKey()) return { ok: false, message: "нет RUNPOD_API_KEY" };
  if (process.env.RUNPOD_BURST_DRY_RUN === "1" || podId.startsWith("dryrun-")) {
    return { ok: true, podId, message: `DRY RUN terminate ${podId}` };
  }
  try {
    // podTerminate returns Void — no selection set
    await gql(`mutation($id: String!) { podTerminate(input: { podId: $id }) }`, { id: podId });
    return { ok: true, podId, message: `RunPod ${podId} terminated` };
  } catch (e) {
    return {
      ok: false,
      podId,
      message: e instanceof Error ? e.message.slice(0, 280) : "terminate failed",
    };
  }
}

/** Public proxy URL once the pod is running (http port). */
export function runpodProxyUrl(podId: string, port = "8188") {
  return `https://${podId}-${port}.proxy.runpod.net`;
}
