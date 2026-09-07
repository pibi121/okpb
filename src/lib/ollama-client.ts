import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { loadMetalnodeConfig, ollamaIsRemote } from "./metalnode-config";
import { ensureLlmTunnel } from "./ensure-llm-tunnel";

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  /** Raw base64 image payloads (no data: prefix) for vision models */
  images?: string[];
};

export function ollamaBaseUrl(): string {
  const cfg = loadMetalnodeConfig();
  return (
    process.env.OLLAMA_URL ||
    cfg.llmOllamaUrl ||
    cfg.ollamaUrl ||
    "http://127.0.0.1:11434"
  ).replace(/\/$/, "");
}

function isTransientOllamaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code || "")
      : "";
  return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up|HTTP timeout|fetch failed|tunnel/i.test(
    `${msg} ${code}`,
  );
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function httpRequest(
  urlStr: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; body: Buffer }> {
  const url = new URL(urlStr);
  const lib = url.protocol === "https:" ? https : http;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const bodyBuf = opts.body != null ? Buffer.from(opts.body, "utf8") : undefined;

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

/** Streaming NDJSON chat — read body as it arrives. */
function httpStreamRequest(
  urlStr: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    onChunk: (text: string) => void;
  },
): Promise<{ status: number }> {
  const url = new URL(urlStr);
  const lib = url.protocol === "https:" ? https : http;
  const timeoutMs = opts.timeoutMs ?? 480_000;
  const bodyBuf = opts.body != null ? Buffer.from(opts.body, "utf8") : undefined;

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
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on("end", () => {
            reject(
              new Error(
                `Ollama ${status}: ${Buffer.concat(chunks).toString("utf8").slice(0, 400)}`,
              ),
            );
          });
          return;
        }
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (line.trim()) opts.onChunk(line);
          }
        });
        res.on("end", () => {
          if (buf.trim()) opts.onChunk(buf);
          resolve({ status });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("LLM timeout"));
    });
    req.on("error", reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

export async function ollamaPing(): Promise<boolean> {
  try {
    const res = await httpRequest(`${ollamaBaseUrl()}/api/tags`, { timeoutMs: 5_000 });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

export async function ollamaPingWithRetry(attempts = 12, delayMs = 1200): Promise<boolean> {
  if (await ollamaPing()) return true;
  // Tunnel often drops overnight — auto-respawn LLM SSH and wait
  if (await ensureLlmTunnel({ waitMs: Math.min(90_000, attempts * delayMs + 15_000) })) {
    return true;
  }
  for (let i = 0; i < attempts; i++) {
    if (await ollamaPing()) return true;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return false;
}

function isTimeoutError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === "TimeoutError" ||
      e.name === "AbortError" ||
      /timeout/i.test(e.message))
  );
}

export async function ollamaChat(opts: {
  messages: OllamaChatMessage[];
  model?: string;
  numPredict?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
  const model = opts.model || process.env.PROMPT_MODEL || "gemma4-heretic";
  const timeoutMs = opts.timeoutMs ?? 480_000;
  const payload = {
    model,
    stream: true,
    think: false,
    keep_alive: "8m",
    messages: opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images?.length ? { images: m.images } : {}),
    })),
    options: {
      num_predict: opts.numPredict ?? 450,
      temperature: opts.temperature ?? 0.65,
      num_ctx: 8192,
    },
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    let content = "";
    let thinking = "";
    try {
      if (!(await ollamaPing())) {
        const up = await ollamaPingWithRetry(20, 2000);
        if (!up) throw new Error("tunnel");
      }
      await httpStreamRequest(`${ollamaBaseUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs,
        onChunk: (row) => {
          try {
            const json = JSON.parse(row) as {
              message?: { content?: string; thinking?: string };
              error?: string;
            };
            if (json.error) throw new Error(`Ollama: ${json.error}`);
            content += json.message?.content || "";
            thinking += json.message?.thinking || "";
          } catch (e) {
            if (e instanceof Error && e.message.startsWith("Ollama:")) throw e;
          }
        },
      });
      const out = (content || thinking).trim();
      if (!out) throw new Error("Ollama вернул пустой ответ");
      return out.replace(/^```[\w]*\n?/i, "").replace(/\n?```$/i, "").trim();
    } catch (e) {
      lastErr = e;
      if (isTimeoutError(e)) {
        throw new Error(
          "LLM не успел ответить (холодный старт Gemma 1–3 мин). Повтори генерацию — модель уже должна быть в памяти.",
        );
      }
      if (!isTransientOllamaError(e) || attempt === 9) break;
      console.warn(
        `[peach] ollama transient ${attempt + 1}/10:`,
        e instanceof Error ? e.message.slice(0, 160) : e,
      );
      await ollamaPingWithRetry(15, 2000);
      await sleep(2000);
    }
  }
  if (isTransientOllamaError(lastErr)) {
    throw new Error(
      "LLM туннель оборвался и не поднялся за ~минуту. Подожди 10 сек и нажми ещё раз.",
    );
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Free VRAM so Comfy/Krea/MiniMax can load on the same GPU. Skipped when LLM is on a remote node. */
export async function ollamaUnload(model?: string): Promise<void> {
  if (ollamaIsRemote()) return;
  const m = model || process.env.PROMPT_MODEL || "gemma4-heretic";
  try {
    await httpRequest(`${ollamaBaseUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m, keep_alive: 0 }),
      timeoutMs: 30_000,
    });
  } catch {
    /* tunnel down — generation will fail later with a clearer error */
  }
}
