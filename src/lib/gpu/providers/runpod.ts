/**
 * RunPod Secure burst for peak video.
 * Env:
 *   RUNPOD_API_KEY
 *   RUNPOD_TEMPLATE_ID          — preferred (Comfy image + ports)
 *   RUNPOD_NETWORK_VOLUME_ID    — Secure Network Volume with weights
 *   RUNPOD_GPU_TYPE_ID          — default NVIDIA GeForce RTX 5090
 *   RUNPOD_CLOUD_TYPE           — SECURE | COMMUNITY | ALL (default SECURE)
 *   RUNPOD_IMAGE_NAME           — fallback if no template
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
  const gpuTypeId = process.env.RUNPOD_GPU_TYPE_ID?.trim() || "NVIDIA GeForce RTX 5090";
  const templateId = process.env.RUNPOD_TEMPLATE_ID?.trim() || null;
  const networkVolumeId =
    process.env.RUNPOD_NETWORK_VOLUME_ID?.trim() ||
    process.env.RUNPOD_VOLUME_ID?.trim() ||
    null;
  const imageName = process.env.RUNPOD_IMAGE_NAME?.trim() || null;
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
  };
  if (templateId) input.templateId = templateId;
  if (networkVolumeId) input.networkVolumeId = networkVolumeId;
  if (imageName) input.imageName = imageName;

  try {
    const data = await gql<{
      podFindAndDeployOnDemand?: { id?: string; desiredStatus?: string };
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
      return { ok: false, message: "RunPod не вернул pod id", raw: data };
    }
    return {
      ok: true,
      podId: pod.id,
      message: `RunPod pod ${pod.id} (${pod.desiredStatus || "created"}) — Comfy поднимется после старта образа`,
      raw: pod,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message.slice(0, 280) : "RunPod spawn failed",
    };
  }
}

export async function terminateRunpodPod(podId: string): Promise<RunpodSpawnResult> {
  if (!apiKey()) return { ok: false, message: "нет RUNPOD_API_KEY" };
  if (process.env.RUNPOD_BURST_DRY_RUN === "1" || podId.startsWith("dryrun-")) {
    return { ok: true, podId, message: `DRY RUN terminate ${podId}` };
  }
  try {
    await gql(
      `mutation($id: String!) {
        podTerminate(input: { podId: $id }) { id }
      }`,
      { id: podId },
    );
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
