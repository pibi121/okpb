/**
 * Age Gate "api" engine: vision model estimate via AITUNNEL (OpenAI-compatible).
 * The API key comes ONLY from Age Gate settings in the DB (never from env) and
 * must never be logged, returned to the client or written to the audit log.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { dataRoot, ensureDataDirs } from "@/lib/paths";

export const AGE_API_BASE = "https://api.aitunnel.ru/v1";
export const AGE_API_DEFAULT_MODEL = "gpt-5.4-mini";
export const AGE_API_MODELS = [
  "gpt-5.4-mini",
  "gemini-3.8-flash",
  "gpt-6.1-sol",
  "claude-sonnet-5.5",
] as const;

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_000;
const CACHE_MAX = 5000;

const PROMPT =
  "Estimate the apparent age of the person in this photo. " +
  "Reply with JSON only, no prose: " +
  '{"face_found":boolean,"age_min":number,"age_max":number,"age_best":number,"confidence":"low|medium|high"}. ' +
  "age_min/age_max is the plausible range in years. If there is no clear human face, set face_found=false.";

export type AgeApiVerdict =
  | {
      kind: "estimate";
      faceFound: boolean;
      ageMin: number | null;
      ageMax: number | null;
      ageBest: number | null;
      confidence: string;
      model: string;
      cached: boolean;
    }
  | { kind: "refusal"; model: string; detail: string; cached: boolean }
  | { kind: "error"; error: string; status?: number; retryable: boolean };

type CacheEntry =
  | {
      t: "estimate";
      faceFound: boolean;
      ageMin: number | null;
      ageMax: number | null;
      ageBest: number | null;
      confidence: string;
      at: number;
    }
  | { t: "refusal"; detail: string; at: number };

let cache: Map<string, CacheEntry> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function cacheFile(): string {
  return path.join(dataRoot(), "age-gate", "api-cache.json");
}

function loadCache(): Map<string, CacheEntry> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as Record<
      string,
      CacheEntry
    >;
    for (const [k, v] of Object.entries(raw || {})) {
      if (v && (v.t === "estimate" || v.t === "refusal")) cache.set(k, v);
    }
  } catch {
    /* no cache yet / corrupted file → start empty */
  }
  return cache;
}

function scheduleCacheSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const m = loadCache();
      while (m.size > CACHE_MAX) {
        const oldest = m.keys().next().value;
        if (oldest === undefined) break;
        m.delete(oldest);
      }
      ensureDataDirs();
      fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
      const tmp = `${cacheFile()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(m)), "utf8");
      fs.renameSync(tmp, cacheFile());
    } catch (e) {
      console.warn(
        "[age-gate] api cache save failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }, 1500);
  (saveTimer as unknown as { unref?: () => void }).unref?.();
}

/** Strip anything key-like from text that may reach logs / ops errors. */
export function redactSecrets(text: string, key?: string): string {
  let out = String(text || "");
  if (key && key.length >= 6) out = out.split(key).join("***");
  return out.replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function prepareJpeg(buf: Buffer): Promise<string> {
  const out = await sharp(buf)
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
  return out.toString("base64");
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
          ? (p as { text: string }).text
          : "",
      )
      .join("\n");
  }
  return "";
}

const REFUSAL_RE =
  /(i\s*(can'?t|cannot|won'?t|am\s+unable|'m\s+unable|am\s+not\s+able)|unable\s+to|i'?m\s+sorry|sorry,|content\s+policy|against\s+(my|the)\s+(policy|guidelines)|не\s+могу|не\s+в\s+состоянии|извин|отказ)/i;

const FILTER_BODY_RE =
  /content[_\s-]?(filter|policy)|safety|moderation|responsible[_\s-]?ai|prohibited|blocked\s+by/i;

type Raw =
  | { t: "ok"; verdict: Omit<Extract<AgeApiVerdict, { kind: "estimate" }>, "cached" | "model"> }
  | { t: "refusal"; detail: string }
  | { t: "error"; error: string; status?: number; retryable: boolean };

async function callOnce(key: string, model: string, b64: string): Promise<Raw> {
  let res: Response;
  try {
    res = await fetch(`${AGE_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${b64}` },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const timeout = name === "TimeoutError" || name === "AbortError";
    return {
      t: "error",
      error: timeout ? "timeout" : "network",
      retryable: true,
    };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    if (res.status === 400 && FILTER_BODY_RE.test(text)) {
      return { t: "refusal", detail: `http_400_filter` };
    }
    return {
      t: "error",
      error: `http_${res.status}`,
      status: res.status,
      retryable: res.status >= 500 || res.status === 429,
    };
  }

  let j: {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: unknown; refusal?: unknown };
    }>;
  } = {};
  try {
    j = JSON.parse(text);
  } catch {
    return { t: "error", error: "bad_api_json", retryable: false };
  }
  const choice = j.choices?.[0];
  if (choice?.finish_reason === "content_filter") {
    return { t: "refusal", detail: "content_filter" };
  }
  if (typeof choice?.message?.refusal === "string" && choice.message.refusal.trim()) {
    return { t: "refusal", detail: "refusal_field" };
  }
  const content = contentText(choice?.message?.content);
  const m = content.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> | null = null;
  if (m) {
    try {
      parsed = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    if (REFUSAL_RE.test(content)) {
      return { t: "refusal", detail: "refusal_text" };
    }
    return { t: "error", error: "unparsed_answer", retryable: false };
  }

  if (parsed.face_found === false) {
    return {
      t: "ok",
      verdict: {
        kind: "estimate",
        faceFound: false,
        ageMin: null,
        ageMax: null,
        ageBest: null,
        confidence: String(parsed.confidence ?? ""),
      },
    };
  }
  let ageMin = num(parsed.age_min);
  let ageMax = num(parsed.age_max);
  const ageBest = num(parsed.age_best);
  if (ageMin == null) {
    return { t: "error", error: "bad_answer_fields", retryable: false };
  }
  if (ageMax == null) ageMax = ageBest ?? ageMin;
  if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
  return {
    t: "ok",
    verdict: {
      kind: "estimate",
      faceFound: true,
      ageMin,
      ageMax,
      ageBest: ageBest ?? Math.round(((ageMin + ageMax) / 2) * 10) / 10,
      confidence: String(parsed.confidence ?? ""),
    },
  };
}

/**
 * Ask the vision model about the photo. Cached by sha256 + model (estimates and
 * refusals only; technical errors are never cached).
 */
export async function queryAgeApi(
  buf: Buffer,
  photoHash: string,
  opts: { apiKey: string; apiModel: string },
): Promise<AgeApiVerdict> {
  const model = opts.apiModel || AGE_API_DEFAULT_MODEL;
  const ckey = `${model}:${photoHash}`;
  const c = loadCache();
  const hit = c.get(ckey);
  if (hit) {
    if (hit.t === "refusal") {
      return { kind: "refusal", model, detail: hit.detail, cached: true };
    }
    return {
      kind: "estimate",
      faceFound: hit.faceFound,
      ageMin: hit.ageMin,
      ageMax: hit.ageMax,
      ageBest: hit.ageBest,
      confidence: hit.confidence,
      model,
      cached: true,
    };
  }

  let b64: string;
  try {
    b64 = await prepareJpeg(buf);
  } catch {
    return { kind: "error", error: "bad_image", retryable: false };
  }

  let raw = await callOnce(opts.apiKey, model, b64);
  if (raw.t === "error" && raw.retryable) {
    await sleep(RETRY_DELAY_MS);
    raw = await callOnce(opts.apiKey, model, b64);
  }

  if (raw.t === "error") {
    return {
      kind: "error",
      error: raw.error,
      status: raw.status,
      retryable: raw.retryable,
    };
  }
  if (raw.t === "refusal") {
    c.set(ckey, { t: "refusal", detail: raw.detail, at: Date.now() });
    scheduleCacheSave();
    return { kind: "refusal", model, detail: raw.detail, cached: false };
  }
  c.set(ckey, {
    t: "estimate",
    faceFound: raw.verdict.faceFound,
    ageMin: raw.verdict.ageMin,
    ageMax: raw.verdict.ageMax,
    ageBest: raw.verdict.ageBest,
    confidence: raw.verdict.confidence,
    at: Date.now(),
  });
  scheduleCacheSave();
  return { ...raw.verdict, model, cached: false };
}

/** GET /v1/aitunnel/balance → {balance, budget}. Key is never echoed back. */
export async function checkAgeApiKey(key: string): Promise<{
  ok: boolean;
  status?: number;
  balance?: unknown;
  budget?: unknown;
  error?: string;
}> {
  if (!key.trim()) return { ok: false, error: "Ключ не задан" };
  try {
    const res = await fetch(`${AGE_API_BASE}/aitunnel/balance`, {
      headers: { authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? "ключ не подходит"
          : res.status === 402
            ? "нет средств"
            : `ответ ${res.status}`;
      return { ok: false, status: res.status, error: hint };
    }
    let j: { balance?: unknown; budget?: unknown } = {};
    try {
      j = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, error: "непонятный ответ API" };
    }
    return { ok: true, status: res.status, balance: j.balance, budget: j.budget };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return {
      ok: false,
      error: name === "TimeoutError" || name === "AbortError" ? "таймаут" : "сеть недоступна",
    };
  }
}

const alertAt = new Map<string, number>();
const ALERT_THROTTLE_MS = 5 * 60_000;

/**
 * Technical API failure → ops errors (throttled per error class).
 * Message deliberately avoids words that ops error filter treats as "expected".
 */
export async function reportAgeApiFailure(
  error: string,
  status: number | undefined,
  model: string,
): Promise<void> {
  const cls = `${status ?? error}`;
  const now = Date.now();
  const prev = alertAt.get(cls) || 0;
  if (now - prev < ALERT_THROTTLE_MS) return;
  alertAt.set(cls, now);
  try {
    const { reportOpsError } = await import("@/lib/ops/errors");
    const label =
      status === 402
        ? "no funds on AITUNNEL account"
        : status === 401 || status === 403
          ? "AITUNNEL key rejected"
          : error;
    await reportOpsError({
      kind: "bot",
      message: `AITUNNEL vision check failed: ${label}`,
      stage: "photo_check_api",
      meta: { status: status ?? null, error, model },
    });
  } catch (e) {
    console.warn(
      "[age-gate] api failure report:",
      e instanceof Error ? e.message : e,
    );
  }
}
