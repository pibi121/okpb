/**
 * Lightweight in-process rate limiter.
 *
 * Safe for Railway single-process deploys. For multi-instance scale-out,
 * replace the Map with an Upstash Redis store (@upstash/ratelimit).
 *
 * Usage:
 *   const ok = checkRateLimit(`login:${ip}`, 5, 60_000);   // 5 req / min
 *   if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Housekeeping: prune stale buckets every 5 minutes to avoid memory growth.
let lastPrune = Date.now();
const PRUNE_EVERY_MS = 5 * 60_000;

function pruneIfNeeded() {
  const now = Date.now();
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
  }
}

/**
 * Returns true if the request is within the allowed rate.
 * Returns false when the limit is exceeded — caller should respond 429.
 *
 * @param key      Unique bucket key, e.g. `login:${ip}` or `gen:${userId}`
 * @param max      Max requests allowed within the window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  pruneIfNeeded();
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

/** Convenience: get caller IP from Next.js request headers. */
export function getClientIp(req: Request): string {
  const h = req as Request & { headers: Headers };
  return (
    h.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Pre-configured limit helpers for common cases. */
export const limits = {
  /** Ops login: 5 attempts / minute per IP */
  opsLogin: (ip: string) => checkRateLimit(`ops-login:${ip}`, 5, 60_000),

  /** TG auth (initData exchange): 20 req / minute per IP */
  tgAuth: (ip: string) => checkRateLimit(`tg-auth:${ip}`, 20, 60_000),

  /** Photo generation: 10 req / minute per userId (GPU cost) */
  generatePhoto: (userId: string) => checkRateLimit(`gen-photo:${userId}`, 10, 60_000),

  /** Video generation: 5 req / minute per userId (GPU cost ×5) */
  generateVideo: (userId: string) => checkRateLimit(`gen-video:${userId}`, 5, 60_000),

  /** File upload: 30 req / minute per userId */
  upload: (userId: string) => checkRateLimit(`upload:${userId}`, 30, 60_000),

  /** Character photo upload: 60 photos / 5 minutes per userId */
  charPhotos: (userId: string) => checkRateLimit(`char-photos:${userId}`, 60, 5 * 60_000),
} as const;
