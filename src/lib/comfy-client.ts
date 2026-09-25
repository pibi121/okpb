/**
 * Comfy client — Node http/https only (no undici; Next cannot load node:undici).
 */
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { comfyBaseUrl } from "./metalnode-config";
import { stripImageMetadata } from "@/lib/strip-media-metadata";

export type ComfyImageRef = {
  filename: string;
  subfolder: string;
  type: string;
};

export type ComfyFileRef = ComfyImageRef & { kind?: string };

const COMFY_OUTPUT_ROOT = "/work/ComfyUI/output";

export function isTransientComfyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code || "")
      : "";
  return (
    /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ESOCKETTIMEDOUT|socket hang up|HTTP timeout|network|tunnel/i.test(
      msg,
    ) ||
    /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENOTFOUND/.test(code)
  );
}

/** Comfy validation: class type not loaded (restart / import race). */
export function isMissingNodeTypeError(msg: string): boolean {
  return /missing_node_type|Node\s+'[^']+'\s+not found/i.test(msg || "");
}

/**
 * Anatomy LoRA skip should only fire on real LoRA/file misses —
 * never on missing Comfy node types (e.g. MiniMaxH3ReferenceToVideo).
 */
export function isAnatomyLoraMissingError(msg: string): boolean {
  if (isMissingNodeTypeError(msg)) return false;
  return (
    /lora_name/i.test(msg) ||
    (/\.safetensors/i.test(msg) &&
      /not found|does not exist|No such file|not in list/i.test(msg)) ||
    (/lora/i.test(msg) &&
      /not found|does not exist|No such file|not in list/i.test(msg))
  );
}

function graphClassTypes(graph: Record<string, unknown>): string[] {
  const types = new Set<string>();
  for (const node of Object.values(graph)) {
    if (!node || typeof node !== "object") continue;
    const ct = (node as { class_type?: unknown }).class_type;
    if (typeof ct === "string" && ct) types.add(ct);
  }
  return [...types];
}

/** Wait until required custom nodes appear in /object_info (post-restart race). */
export async function ensureComfyNodeTypes(
  nodeTypes: string[],
  attempts = 30,
  delayMs = 2000,
): Promise<void> {
  const needed = [...new Set(nodeTypes.filter(Boolean))];
  if (!needed.length) return;
  await ensureComfyReady(Math.min(attempts, 10), delayMs);
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await comfyRequest("/object_info", undefined, 45_000);
      if (res.status >= 200 && res.status < 300) {
        const info = JSON.parse(res.body.toString("utf8") || "{}") as Record<
          string,
          unknown
        >;
        const missing = needed.filter((t) => !(t in info));
        if (missing.length === 0) return;
        console.warn(
          `[peach] Comfy nodes not ready: ${missing.join(",")} (${i + 1}/${attempts})`,
        );
      }
    } catch (e) {
      console.warn(
        `[peach] object_info wait ${i + 1}/${attempts}:`,
        e instanceof Error ? e.message.slice(0, 120) : e,
      );
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  throw new Error(
    `Comfy nodes not loaded: ${needed.join(", ")}. GPU ещё поднимает пайплайн — подождите ~1 мин и повторите.`,
  );
}

const LORA_NAME_ALIASES: Record<string, string> = {
  "krea2/RealisticSnapshotKrea2.safetensors":
    "krea2/realistic_snapshot_krea2.safetensors",
};

/** Extract missing lora_name from Comfy validation error JSON. */
export function extractMissingLoraName(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/lora_name:\s*'([^']+)'\s*not in/i);
  return m?.[1] || null;
}

/**
 * Remap aliased LoRA filenames, or strip the LoraLoader node and rewire the chain.
 * Returns true if graph was mutated.
 */
export function recoverMissingLoraInGraph(
  graph: Record<string, unknown>,
  missingName: string,
): boolean {
  const alias = LORA_NAME_ALIASES[missingName];
  let changed = false;
  for (const node of Object.values(graph)) {
    if (!node || typeof node !== "object") continue;
    const n = node as {
      class_type?: string;
      inputs?: Record<string, unknown>;
    };
    if (
      (n.class_type === "LoraLoader" ||
        n.class_type === "LoraLoaderModelOnly") &&
      n.inputs?.lora_name === missingName
    ) {
      if (alias) {
        n.inputs.lora_name = alias;
        changed = true;
      }
    }
  }
  if (changed) return true;

  // Strip node(s) and rewire model/clip refs that pointed at them.
  const dropIds = new Set<string>();
  for (const [id, node] of Object.entries(graph)) {
    if (!node || typeof node !== "object") continue;
    const n = node as {
      class_type?: string;
      inputs?: Record<string, unknown>;
    };
    if (
      (n.class_type === "LoraLoader" ||
        n.class_type === "LoraLoaderModelOnly") &&
      n.inputs?.lora_name === missingName
    ) {
      dropIds.add(id);
    }
  }
  if (!dropIds.size) return false;

  const redirectModel = new Map<string, [string, number]>();
  const redirectClip = new Map<string, [string, number]>();
  for (const id of dropIds) {
    const n = graph[id] as { inputs?: Record<string, unknown> };
    const model = n.inputs?.model;
    const clip = n.inputs?.clip;
    if (Array.isArray(model) && typeof model[0] === "string") {
      redirectModel.set(id, [
        model[0],
        typeof model[1] === "number" ? model[1] : 0,
      ]);
    }
    if (Array.isArray(clip) && typeof clip[0] === "string") {
      redirectClip.set(id, [
        clip[0],
        typeof clip[1] === "number" ? clip[1] : 0,
      ]);
    }
  }

  const rewriteRef = (ref: unknown): unknown => {
    if (!Array.isArray(ref) || typeof ref[0] !== "string") return ref;
    let cur: [string, number] = [
      ref[0],
      typeof ref[1] === "number" ? ref[1] : 0,
    ];
    const seen = new Set<string>();
    while (dropIds.has(cur[0]) && !seen.has(cur[0])) {
      seen.add(cur[0]);
      const map = cur[1] === 1 ? redirectClip : redirectModel;
      const next = map.get(cur[0]) || redirectModel.get(cur[0]);
      if (!next) break;
      cur = next;
    }
    return cur;
  };

  for (const [id, node] of Object.entries(graph)) {
    if (dropIds.has(id) || !node || typeof node !== "object") continue;
    const inputs = (node as { inputs?: Record<string, unknown> }).inputs;
    if (!inputs) continue;
    for (const [k, v] of Object.entries(inputs)) {
      if (Array.isArray(v) && typeof v[0] === "string" && dropIds.has(v[0])) {
        inputs[k] = rewriteRef(v);
      }
    }
  }
  for (const id of dropIds) delete graph[id];
  console.warn(
    `[peach] stripped missing LoRA from graph: ${missingName} (nodes ${[...dropIds].join(",")})`,
  );
  return true;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function ensureComfyReady(attempts = 40, delayMs = 2000): Promise<void> {
  if (await comfyPingWithRetry(Math.min(attempts, 4), 400)) return;

  try {
    const { ensureComfyTunnel } = await import("@/lib/ensure-comfy-tunnel");
    await ensureComfyTunnel({
      waitMs: Math.min(attempts * delayMs, 120_000),
    });
  } catch (e) {
    console.warn(
      "[peach] ensureComfyTunnel failed:",
      e instanceof Error ? e.message : e,
    );
  }

  if (await comfyPingWithRetry(attempts, delayMs)) return;
  throw new Error(
    "Comfy GPU временно недоступен. Подождите ~30 сек и повторите — связь восстанавливается автоматически.",
  );
}

async function withTransientRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 6,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientComfyError(e) || i === attempts - 1) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[peach] comfy ${label} transient ${i + 1}/${attempts}: ${msg.slice(0, 160)}`,
      );
      await sleep(800 + i * 700);
      try {
        const { ensureComfyTunnel } = await import("@/lib/ensure-comfy-tunnel");
        await ensureComfyTunnel({ waitMs: 45_000 });
      } catch {
        /* ignore */
      }
      await comfyPingWithRetry(8, 800);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function httpRequest(
  urlStr: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; body: Buffer }> {
  const url = new URL(urlStr);
  const lib = url.protocol === "https:" ? https : http;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const bodyBuf =
    opts.body == null
      ? undefined
      : Buffer.isBuffer(opts.body)
        ? opts.body
        : Buffer.from(opts.body, "utf8");

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    if (bodyBuf && !headers["Content-Length"]) {
      headers["Content-Length"] = String(bodyBuf.length);
    }
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: opts.method || "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HTTP timeout after ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on("error", reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function activeComfyBase(): string {
  try {
    // Lazy import avoids circular init with orchestrator ↔ generation paths.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { currentGpuComfyBaseUrl } = require("@/lib/gpu/orchestrator") as {
      currentGpuComfyBaseUrl: () => string | null;
    };
    return currentGpuComfyBaseUrl() || comfyBaseUrl();
  } catch {
    return comfyBaseUrl();
  }
}

async function comfyRequest(
  path: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  },
  timeoutMs = 120_000,
) {
  return httpRequest(`${activeComfyBase()}${path}`, {
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
    timeoutMs,
  });
}

export async function comfyPing(): Promise<boolean> {
  try {
    const res = await comfyRequest("/", undefined, 3_000);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

export async function comfyPingWithRetry(
  attempts = 5,
  delayMs = 1200,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await comfyPing()) return true;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

export async function comfyQueuePrompt(
  graph: Record<string, unknown>,
  clientId = "peachbitch",
  definitions?: unknown,
): Promise<string> {
  const body: Record<string, unknown> = { prompt: graph, client_id: clientId };
  if (definitions) body.definitions = definitions;
  const res = await comfyRequest(
    "/prompt",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    180_000,
  );
  const data = JSON.parse(res.body.toString("utf8") || "{}") as {
    prompt_id?: string;
    error?: unknown;
    node_errors?: Record<string, unknown>;
  };
  if (
    res.status < 200 ||
    res.status >= 300 ||
    data.error ||
    (data.node_errors && Object.keys(data.node_errors).length)
  ) {
    throw new Error(`Comfy queue failed: ${JSON.stringify(data).slice(0, 800)}`);
  }
  if (!data.prompt_id) throw new Error("Comfy: no prompt_id");
  return data.prompt_id;
}

function collectComfyFiles(
  outputs: Record<string, Record<string, unknown>> | undefined,
): ComfyFileRef[] {
  const files: ComfyFileRef[] = [];
  for (const out of Object.values(outputs || {})) {
    if (!out || typeof out !== "object") continue;
    for (const key of ["images", "gifs", "videos", "audio", "files"] as const) {
      const arr = out[key];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        if (typeof rec.filename !== "string") continue;
        files.push({
          filename: rec.filename,
          subfolder: typeof rec.subfolder === "string" ? rec.subfolder : "",
          type: typeof rec.type === "string" ? rec.type : "output",
          kind: key,
        });
      }
    }
  }
  return files;
}

export function comfyOutputAbsPath(ref: ComfyFileRef): string {
  const sub = (ref.subfolder || "").replace(/^\/+|\/+$/g, "");
  const name = ref.filename.replace(/^\/+/, "");
  const root = ref.type === "input" ? "/work/ComfyUI/input" : COMFY_OUTPUT_ROOT;
  return sub ? `${root}/${sub}/${name}` : `${root}/${name}`;
}

export function comfyI2VTimeoutMs(durationSec?: number | null) {
  const sec = Math.min(12, Math.max(4, Math.round(Number(durationSec) || 6)));
  return Math.min(1_800_000, 900_000 + sec * 60_000);
}

/** AutoEdit + VHS re-encodes every clip. Keep a long cap only as a last resort. */
export function comfyStitchTimeoutMs(clipCount?: number | null) {
  const n = Math.min(40, Math.max(2, Math.round(Number(clipCount) || 4)));
  return Math.min(14_400_000, 600_000 + n * 300_000);
}

async function comfyPromptBusy(promptId: string): Promise<boolean> {
  try {
    const res = await comfyRequest("/queue", undefined, 30_000);
    const q = JSON.parse(res.body.toString("utf8") || "{}") as {
      queue_running?: unknown[];
      queue_pending?: unknown[];
    };
    const hay = JSON.stringify([q.queue_running || [], q.queue_pending || []]);
    return hay.includes(promptId);
  } catch {
    return false;
  }
}

export async function comfyWaitHistory(
  promptId: string,
  timeoutMs = 300_000,
): Promise<{ images: ComfyImageRef[]; files: ComfyFileRef[]; raw: unknown }> {
  const t0 = Date.now();
  let lastErr: unknown = null;
  let idleSince: number | null = null;
  // Soft timeout + short history-lag grace. Callers that need hours (stitch/i2v)
  // pass a large timeoutMs — do NOT force a 4h floor (that made photos hang 13+ min).
  const hardCapMs = Math.max(30_000, timeoutMs + 120_000);
  while (Date.now() - t0 < hardCapMs) {
    try {
      const res = await comfyRequest(`/history/${promptId}`, undefined, 120_000);
      const hist = JSON.parse(res.body.toString("utf8") || "{}") as Record<
        string,
        {
          status?: {
            status_str?: string;
            completed?: boolean;
            messages?: unknown[];
          };
          outputs?: Record<string, Record<string, unknown>>;
        }
      >;
      const entry = hist[promptId];
      if (entry) {
        const st = entry.status?.status_str;
        if (st === "error") throw new Error(formatComfyHistoryError(entry));
        if (entry.status?.completed || st === "success") {
          const files = collectComfyFiles(entry.outputs);
          const images = files.filter(
            (f) => f.kind === "images" || /\.(png|jpg|jpeg|webp)$/i.test(f.filename),
          );
          if (!files.length) throw new Error("Comfy: no media in output");
          return { images, files, raw: entry };
        }
      }
      lastErr = null;
      const busy = await comfyPromptBusy(promptId);
      if (Date.now() - t0 >= timeoutMs) {
        if (busy) {
          // Still executing past the soft budget — hardCap will stop us shortly.
        } else {
          idleSince = idleSince ?? Date.now();
          // History lag after the job leaves the queue — wait up to 2 more minutes.
          if (Date.now() - idleSince > 120_000) {
            break;
          }
        }
      } else if (busy) {
        idleSince = null;
      }
    } catch (e) {
      if (
        e instanceof Error &&
        (/^Comfy job error/i.test(e.message) || isMissingNodeTypeError(e.message))
      ) {
        throw e;
      }
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  const extra =
    lastErr instanceof Error
      ? ` (last: ${lastErr.message})`
      : lastErr
        ? ` (last: ${String(lastErr)})`
        : "";
  throw new Error(`Comfy wait timeout after ${Math.round((Date.now() - t0) / 1000)}s${extra}`);
}

/** Pull exception_message from Comfy history status.messages (ops-readable, not raw JSON dump). */
function formatComfyHistoryError(entry: {
  status?: { messages?: unknown[] };
}): string {
  const messages = entry.status?.messages;
  const bits: string[] = [];
  if (Array.isArray(messages)) {
    for (const row of messages) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const kind = String(row[0] || "");
      if (!/execution_error|error/i.test(kind)) continue;
      const detail = row[1];
      if (!detail || typeof detail !== "object") continue;
      const d = detail as Record<string, unknown>;
      const msg = String(
        d.exception_message || d.message || d.traceback || "",
      ).trim();
      const node = String(d.node_type || d.node_id || "").trim();
      const et = String(d.exception_type || "").trim();
      const line = [et, node ? `node=${node}` : "", msg]
        .filter(Boolean)
        .join(" · ");
      if (line) bits.push(line.slice(0, 400));
    }
  }
  if (bits.length) return `Comfy job error: ${bits.join(" | ").slice(0, 700)}`;
  return "Comfy job error";
}

/**
 * User-facing text — no node class names, GPU hosts, keys, or model paths.
 */
export function publicComfyErrorMessage(
  err: unknown,
  locale: "ru" | "en" = "ru",
): string {
  const msg = err instanceof Error ? err.message : String(err || "");
  if (isMissingNodeTypeError(msg)) {
    return locale === "en"
      ? "Video engine is still warming up. Please try again in a minute."
      : "Движок видео ещё поднимается. Подожди минуту и попробуй снова.";
  }
  if (/Comfy wait timeout|недоступен|ECONN|ETIMEDOUT|tunnel|socket hang/i.test(msg)) {
    return locale === "en"
      ? "Generation timed out or the GPU dropped. Please try again."
      : "Генерация зависла или связь с GPU пропала. Попробуй ещё раз.";
  }
  if (/Comfy job error/i.test(msg)) {
    return locale === "en"
      ? "We failed to render this one — that's on us. You can try again."
      : "Не получилось собрать кадр — это сбой у нас. Можно запустить ещё раз.";
  }
  return locale === "en"
    ? "Generation failed. Please try again."
    : "Генерация не удалась. Попробуй ещё раз.";
}

export async function comfyDownloadImage(ref: ComfyImageRef): Promise<Buffer> {
  const q = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder || "",
    type: ref.type || "output",
  });
  const res = await comfyRequest(`/view?${q}`, undefined, 300_000);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Comfy view failed: ${res.status}`);
  }
  return res.body;
}

export async function comfyUploadImage(
  filename: string,
  bytes: Buffer,
  mime = "image/png",
  subfolder = "",
): Promise<string> {
  return withTransientRetry("upload", async () => {
    await ensureComfyReady(20, 1000);
    return uploadImageOnce(filename, bytes, mime, subfolder);
  });
}

async function uploadImageOnce(
  filename: string,
  bytes: Buffer,
  mime = "image/png",
  subfolder = "",
): Promise<string> {
  const safeName = filename.replace(/[^\w.\-]+/g, "_") || "peach_upload.png";
  const uploadBytes = mime.startsWith("image/") ? stripImageMetadata(bytes) : bytes;
  const boundary = `----PeachBoundary${Date.now().toString(36)}`;
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="${safeName}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
      "utf8",
    ),
    uploadBytes,
    Buffer.from(
      `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="overwrite"\r\n\r\n` +
        `true\r\n`,
      "utf8",
    ),
  ];
  if (subfolder) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="subfolder"\r\n\r\n` +
          `${subfolder}\r\n`,
        "utf8",
      ),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  const body = Buffer.concat(parts);
  const res = await comfyRequest(
    "/upload/image",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    },
    300_000,
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Comfy upload failed: ${res.status} ${res.body.toString("utf8").slice(0, 300)}`,
    );
  }
  const data = JSON.parse(res.body.toString("utf8") || "{}") as { name?: string };
  return data.name || safeName;
}

/** Photo / still renders — soft budget ~4 min (RTX 5090 Krea normally ~1–2 min). */
export const COMFY_PHOTO_TIMEOUT_MS = 240_000;

export async function runComfyAndDownload(
  graph: Record<string, unknown>,
  clientId = "peachbitch",
  timeoutMs = COMFY_PHOTO_TIMEOUT_MS,
): Promise<Buffer> {
  await ensureComfyReady();
  let promptId: string | null = null;
  let lastErr: unknown;
  let loraRecoveries = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!promptId) {
        promptId = await withTransientRetry("queue", () =>
          comfyQueuePrompt(graph, clientId),
        );
      }
      const { images, files } = await comfyWaitHistory(promptId, timeoutMs);
      const ref = images[0] || files[0];
      return await withTransientRetry("download", () => comfyDownloadImage(ref));
    } catch (e) {
      lastErr = e;
      const timedOut =
        e instanceof Error && /Comfy wait timeout/i.test(e.message);
      if (timedOut) {
        await comfyInterrupt().catch(() => undefined);
        promptId = null;
        throw e;
      }
      const missing = extractMissingLoraName(e);
      if (missing && loraRecoveries < 2 && recoverMissingLoraInGraph(graph, missing)) {
        loraRecoveries += 1;
        promptId = null;
        continue;
      }
      if (!isTransientComfyError(e) || attempt === 2) throw e;
      console.warn(
        `[peach] comfy still retry ${attempt + 1}/3:`,
        e instanceof Error ? e.message.slice(0, 160) : e,
      );
      await sleep(1000 + attempt * 800);
      await ensureComfyReady(15, 1000);
      // Keep promptId — job may still be running/finished on Metalnode after tunnel flap.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function runComfyJob(
  graph: Record<string, unknown>,
  clientId = "peachbitch",
  timeoutMs = 1_200_000,
  definitions?: unknown,
): Promise<{ bytes: Buffer; ref: ComfyFileRef; files: ComfyFileRef[] }> {
  await ensureComfyReady();
  const requiredNodes = graphClassTypes(graph);
  if (requiredNodes.length) {
    try {
      await ensureComfyNodeTypes(requiredNodes, 15, 2000);
    } catch (e) {
      // Soft: still attempt queue — history may work if nodes appear mid-flight
      console.warn(
        "[peach] ensureComfyNodeTypes:",
        e instanceof Error ? e.message.slice(0, 160) : e,
      );
    }
  }
  let promptId: string | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (!promptId) {
        promptId = await withTransientRetry("queue", () =>
          comfyQueuePrompt(graph, clientId, definitions),
        );
      }
      const { files } = await comfyWaitHistory(promptId, timeoutMs);
      const preferred =
        files.find((f) => /\.(mp4|webm|mkv)$/i.test(f.filename)) ||
        files.find((f) => /\.(flac|wav|mp3)$/i.test(f.filename)) ||
        files[0];
      const bytes = await withTransientRetry("download", () =>
        comfyDownloadImage(preferred),
      );
      return { bytes, ref: preferred, files };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (isMissingNodeTypeError(msg) && attempt < 5) {
        console.warn(
          `[peach] missing node type, waiting reload ${attempt + 1}/6:`,
          msg.slice(0, 160),
        );
        promptId = null;
        await ensureComfyNodeTypes(requiredNodes, 20, 3000).catch(() => undefined);
        continue;
      }
      if (!isTransientComfyError(e) || attempt === 5) throw e;
      console.warn(
        `[peach] comfy job retry ${attempt + 1}/6:`,
        msg.slice(0, 160),
      );
      await sleep(1000 + attempt * 800);
      await ensureComfyReady(15, 1000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Soft VRAM unload — not a Comfy restart. Use between video ↔ still undress. */
export async function comfyFreeMemory(): Promise<void> {
  try {
    await comfyRequest(
      "/free",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      },
      60_000,
    );
  } catch (e) {
    console.warn(
      "[peach] comfy /free failed:",
      e instanceof Error ? e.message.slice(0, 160) : e,
    );
  }
}

export async function comfyInterrupt(): Promise<void> {
  try {
    await comfyRequest("/interrupt", { method: "POST" }, 15_000);
  } catch {
    /* ignore */
  }
}
