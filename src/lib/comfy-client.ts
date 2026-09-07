/**
 * Comfy client — Node http/https only (no undici; Next cannot load node:undici).
 */
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { comfyBaseUrl } from "./metalnode-config";

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
    "Comfy GPU недоступен (туннель :8188). Подождите ~30 сек и повторите — туннель поднимается автоматически.",
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

async function comfyRequest(
  path: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  },
  timeoutMs = 120_000,
) {
  return httpRequest(`${comfyBaseUrl()}${path}`, {
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
  const hardCapMs = Math.max(timeoutMs, 14_400_000);
  while (Date.now() - t0 < hardCapMs) {
    try {
      const res = await comfyRequest(`/history/${promptId}`, undefined, 120_000);
      const hist = JSON.parse(res.body.toString("utf8") || "{}") as Record<
        string,
        {
          status?: { status_str?: string; completed?: boolean };
          outputs?: Record<string, Record<string, unknown>>;
        }
      >;
      const entry = hist[promptId];
      if (entry) {
        const st = entry.status?.status_str;
        if (st === "error") throw new Error("Comfy job error");
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
      if (busy) {
        idleSince = null;
      } else if (Date.now() - t0 >= timeoutMs) {
        idleSince = idleSince ?? Date.now();
        // History lag after the job leaves the queue — wait 2 more minutes.
        if (Date.now() - idleSince > 120_000) {
          break;
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message === "Comfy job error") throw e;
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
  const boundary = `----PeachBoundary${Date.now().toString(36)}`;
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="${safeName}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
      "utf8",
    ),
    bytes,
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

export async function runComfyAndDownload(
  graph: Record<string, unknown>,
  clientId = "peachbitch",
): Promise<Buffer> {
  await ensureComfyReady();
  let promptId: string | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (!promptId) {
        promptId = await withTransientRetry("queue", () =>
          comfyQueuePrompt(graph, clientId),
        );
      }
      const { images, files } = await comfyWaitHistory(promptId, 600_000);
      const ref = images[0] || files[0];
      return await withTransientRetry("download", () => comfyDownloadImage(ref));
    } catch (e) {
      lastErr = e;
      if (!isTransientComfyError(e) || attempt === 5) throw e;
      console.warn(
        `[peach] comfy still retry ${attempt + 1}/6:`,
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
      if (!isTransientComfyError(e) || attempt === 5) throw e;
      console.warn(
        `[peach] comfy job retry ${attempt + 1}/6:`,
        e instanceof Error ? e.message.slice(0, 160) : e,
      );
      await sleep(1000 + attempt * 800);
      await ensureComfyReady(15, 1000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function comfyInterrupt(): Promise<void> {
  try {
    await comfyRequest("/interrupt", { method: "POST" }, 15_000);
  } catch {
    /* ignore */
  }
}
