/**
 * Vast.ai Verified Datacenter burst for LoRA (and overflow video).
 * Env:
 *   VAST_API_KEY
 *   VAST_TEMPLATE_HASH_ID   — preferred
 *   VAST_IMAGE              — fallback image if no template
 *   VAST_DISK_GB            — default 64
 *   VAST_MAX_DPH            — max $/hr (default 0.55)
 *   VAST_GPU_NAME           — substring filter, default RTX_5090
 *   VAST_BURST_DRY_RUN=1
 */

export type VastReady = {
  ok: boolean;
  missing: string[];
  dryRun: boolean;
};

export type VastSpawnResult = {
  ok: boolean;
  instanceId?: string | number;
  offerId?: number;
  message: string;
  raw?: unknown;
};

function apiKey() {
  return process.env.VAST_API_KEY?.trim() || "";
}

function baseUrl() {
  return (process.env.VAST_API_BASE || "https://console.vast.ai").replace(/\/$/, "");
}

export function vastReady(): VastReady {
  const missing: string[] = [];
  if (!apiKey()) missing.push("VAST_API_KEY");
  const hasTpl = Boolean(process.env.VAST_TEMPLATE_HASH_ID?.trim());
  const hasImage = Boolean(process.env.VAST_IMAGE?.trim());
  if (!hasTpl && !hasImage) missing.push("VAST_TEMPLATE_HASH_ID|VAST_IMAGE");
  return {
    ok: missing.length === 0,
    missing,
    dryRun: process.env.VAST_BURST_DRY_RUN === "1",
  };
}

async function vastFetch(path: string, init?: RequestInit) {
  const key = apiKey();
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    const msg =
      typeof json === "object" && json && "msg" in json
        ? String((json as { msg: unknown }).msg)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

type Offer = {
  id?: number;
  dph_total?: number;
  gpu_name?: string;
  reliability?: number;
  verified?: boolean | number;
  num_gpus?: number;
};

export async function searchVastLoraOffer(): Promise<{
  ok: boolean;
  offer?: Offer;
  message: string;
}> {
  const maxDph = Number(process.env.VAST_MAX_DPH || 0.55);
  const gpuName = process.env.VAST_GPU_NAME?.trim() || "RTX_5090";
  // Vast search query language — keep filters conservative (verified DC).
  const q = JSON.stringify({
    verified: { eq: true },
    rentable: { eq: true },
    num_gpus: { eq: 1 },
    gpu_name: { eq: gpuName },
    dph_total: { lte: maxDph },
    reliability2: { gte: 0.95 },
  });
  try {
    const data = (await vastFetch(
      `/api/v0/bundles/?q=${encodeURIComponent(q)}&order=dph_total&limit=5`,
    )) as { offers?: Offer[] } | Offer[];
    const offers = Array.isArray(data) ? data : data.offers || [];
    const offer = offers.find((o) => o.id != null);
    if (!offer?.id) {
      return {
        ok: false,
        message: `Vast: нет офферов (${gpuName}, ≤$${maxDph}/ч, verified)`,
      };
    }
    return { ok: true, offer, message: `offer ${offer.id} @ $${offer.dph_total}/hr` };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message.slice(0, 280) : "Vast search failed",
    };
  }
}

export async function spawnVastLoraBurst(actorId: string): Promise<VastSpawnResult> {
  const ready = vastReady();
  if (!ready.ok) {
    return {
      ok: false,
      message: `Vast не готов: не хватает ${ready.missing.join(", ")}`,
    };
  }

  if (ready.dryRun) {
    const instanceId = `dryrun-${Date.now().toString(36)}`;
    return {
      ok: true,
      instanceId,
      message: `DRY RUN: instance ${instanceId} (actor=${actorId}). Живая аренда выключена VAST_BURST_DRY_RUN=1.`,
    };
  }

  const found = await searchVastLoraOffer();
  if (!found.ok || !found.offer?.id) {
    return { ok: false, message: found.message };
  }

  const disk = Number(process.env.VAST_DISK_GB || 64);
  const body: Record<string, unknown> = {
    disk,
    runtype: "ssh_direct",
  };
  const tpl = process.env.VAST_TEMPLATE_HASH_ID?.trim();
  const image = process.env.VAST_IMAGE?.trim();
  if (tpl) body.template_hash_id = tpl;
  if (image) body.image = image;
  if (!tpl && !image) body.image = "pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime";

  try {
    const created = (await vastFetch(`/api/v0/asks/${found.offer.id}/`, {
      method: "PUT",
      body: JSON.stringify(body),
    })) as { success?: boolean; new_contract?: number | string; msg?: string };

    const instanceId = created.new_contract;
    if (instanceId == null) {
      return {
        ok: false,
        offerId: found.offer.id,
        message: created.msg || "Vast не вернул new_contract",
        raw: created,
      };
    }
    return {
      ok: true,
      instanceId,
      offerId: found.offer.id,
      message: `Vast instance ${instanceId} с offer ${found.offer.id} (${found.message})`,
      raw: created,
    };
  } catch (e) {
    return {
      ok: false,
      offerId: found.offer.id,
      message: e instanceof Error ? e.message.slice(0, 280) : "Vast spawn failed",
    };
  }
}

export async function destroyVastInstance(instanceId: string | number): Promise<VastSpawnResult> {
  if (!apiKey()) return { ok: false, message: "нет VAST_API_KEY" };
  if (
    process.env.VAST_BURST_DRY_RUN === "1" ||
    String(instanceId).startsWith("dryrun-")
  ) {
    return { ok: true, instanceId, message: `DRY RUN destroy ${instanceId}` };
  }
  try {
    await vastFetch(`/api/v0/instances/${instanceId}/`, { method: "DELETE" });
    return { ok: true, instanceId, message: `Vast ${instanceId} destroyed` };
  } catch (e) {
    return {
      ok: false,
      instanceId,
      message: e instanceof Error ? e.message.slice(0, 280) : "destroy failed",
    };
  }
}
