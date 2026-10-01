/**
 * Age Gate info feed → ops topic «AgeGate» (photo + who + time + status, no buttons).
 *
 * Disk queue on the data volume (survives restarts), one message per ~3s so we
 * stay under Telegram group limits, never blocks the user's check, one notice
 * per photo hash. Technical errors are NOT posted here (they go to ops errors).
 */
import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { dataRoot, ensureDataDirs } from "@/lib/paths";
import type { AgeGateConfig, AgeGateResult } from "@/lib/age-gate";

const QUEUE_MAX = 500;
const SEND_GAP_MS = 3000;
const MAX_ATTEMPTS = 5;
const NOTIFIED_MAX = 5000;

type Notice = {
  hash: string;
  userId: string | null;
  at: string;
  status: "approved" | "rejected";
  reason: string;
  detail: string;
  attempts: number;
};

function queueDir(): string {
  return path.join(dataRoot(), "age-gate", "notify-queue");
}

function notifiedFile(): string {
  return path.join(dataRoot(), "age-gate", "notified.json");
}

let notified: Set<string> | null = null;

function loadNotified(): Set<string> {
  if (notified) return notified;
  notified = new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(notifiedFile(), "utf8")) as string[];
    if (Array.isArray(arr)) for (const h of arr) notified.add(String(h));
  } catch {
    /* none yet */
  }
  return notified;
}

function saveNotified() {
  try {
    const set = loadNotified();
    while (set.size > NOTIFIED_MAX) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
    fs.mkdirSync(path.dirname(notifiedFile()), { recursive: true });
    fs.writeFileSync(notifiedFile(), JSON.stringify([...set]), "utf8");
  } catch (e) {
    console.warn(
      "[age-gate] notified save:",
      e instanceof Error ? e.message : e,
    );
  }
}

const REASON_RU: Record<string, string> = {
  no_face: "нет лица на фото",
  probable_minor: "похоже на несовершеннолетнего",
  probable_uncertain: "возраст под сомнением",
};

/** null → not a photo verdict (tech error, allowlist, refusal → quality topic). */
export function classifyForNotice(
  r: AgeGateResult,
): { status: "approved" | "rejected"; reason: string } | null {
  if (r.skipped) return null;
  if (r.engine === "allowlist" || r.reason === "allowlisted") return null;
  if (r.reason === "model_refusal") return null;
  if (!r.ok) return null;
  if (
    r.reason === "checker_unavailable" ||
    r.reason === "checker_error" ||
    r.reason === "opencv_unavailable" ||
    r.reason === "empty_image" ||
    r.reason === "no_photos"
  ) {
    return null;
  }
  if (r.blocked || r.uncertain) {
    return {
      status: "rejected",
      reason: REASON_RU[r.reason || ""] || r.reason || "отклонено",
    };
  }
  return { status: "approved", reason: "" };
}

function describeVerdict(r: AgeGateResult): string {
  if (r.engine === "api") {
    if (r.apiAgeMin != null) {
      const conf = r.apiConfidence ? ` (${r.apiConfidence})` : "";
      return `Оценка API: ${r.apiAgeMin}–${r.apiAgeMax ?? r.apiAgeMin} лет${conf} · модель ${r.apiModel || "?"}`;
    }
    return `Движок: api · модель ${r.apiModel || "?"}`;
  }
  const age =
    r.ageYears != null ? `~${Math.round(r.ageYears)} лет` : r.ageLabel || "";
  const score = r.score != null ? ` · score ${r.score}` : "";
  return `Движок: ${r.engine || "?"}${age ? ` · ${age}` : ""}${score}`;
}

function hashOf(buf: Buffer, r: AgeGateResult): string {
  return r.photoHash || createHash("sha256").update(buf).digest("hex");
}

function listQueue(): string[] {
  try {
    return fs
      .readdirSync(queueDir())
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

function dropItem(jsonName: string) {
  const base = path.join(queueDir(), jsonName.replace(/\.json$/, ""));
  for (const ext of [".json", ".jpg"]) {
    try {
      fs.unlinkSync(base + ext);
    } catch {
      /* gone */
    }
  }
}

/** Queue one verdict for the AgeGate topic (honours toggles + once-per-hash). */
export async function queueAgeGateNotice(opts: {
  buf: Buffer;
  result: AgeGateResult;
  cfg: AgeGateConfig;
  userId: string | null;
}): Promise<void> {
  const { buf, result, cfg } = opts;
  if (!cfg.notifyAll) return;
  const cls = classifyForNotice(result);
  if (!cls) return;
  if (cls.status === "approved" && !cfg.notifyApproved) return;
  if (cls.status === "rejected" && !cfg.notifyRejected) return;

  const hash = hashOf(buf, result);
  const seen = loadNotified();
  if (seen.has(hash)) return;
  seen.add(hash);
  saveNotified();

  let jpg: Buffer;
  try {
    jpg = await sharp(buf)
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return;
  }

  ensureDataDirs();
  fs.mkdirSync(queueDir(), { recursive: true });
  const stamp = `${Date.now()}-${hash.slice(0, 12)}`;
  const notice: Notice = {
    hash,
    userId: opts.userId,
    at: new Date().toISOString(),
    status: cls.status,
    reason: cls.reason,
    detail: describeVerdict(result),
    attempts: 0,
  };
  fs.writeFileSync(path.join(queueDir(), `${stamp}.jpg`), jpg);
  fs.writeFileSync(path.join(queueDir(), `${stamp}.json`), JSON.stringify(notice));

  const all = listQueue();
  if (all.length > QUEUE_MAX) {
    const over = all.slice(0, all.length - QUEUE_MAX);
    for (const f of over) dropItem(f);
    console.warn(`[age-gate] notice queue overflow: dropped ${over.length} oldest`);
  }
  kick();
}

let running = false;

function kick() {
  if (running) return;
  running = true;
  void loop()
    .catch((e) =>
      console.error("[age-gate] notice loop:", e instanceof Error ? e.message : e),
    )
    .finally(() => {
      running = false;
    });
}

/** Called on boot: send whatever was left in the queue before restart. */
export function resumeAgeGateNoticeQueue() {
  if (listQueue().length) kick();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function buildCaption(n: Notice): Promise<string> {
  const ops = await import("@/lib/ops/ops-telegram");
  const ident = n.userId ? await ops.loadOpsUserIdentity(n.userId).catch(() => null) : null;
  const who = ident?.who || (n.userId ? `<code>${ops.escHtml(n.userId)}</code>` : "—");
  const head =
    n.status === "approved" ? "✅ <b>Фото одобрено</b>" : "⛔ <b>Фото отклонено</b>";
  return [
    head,
    `Кто: ${who}`,
    `Время: ${ops.formatMsk(new Date(n.at))} МСК`,
    n.status === "rejected" ? `Причина: ${ops.escHtml(n.reason)}` : "",
    ops.escHtml(n.detail),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);
}

async function loop(): Promise<void> {
  for (;;) {
    const files = listQueue();
    if (!files.length) return;
    const name = files[0];
    const base = path.join(queueDir(), name.replace(/\.json$/, ""));
    let notice: Notice;
    let bytes: Buffer;
    try {
      notice = JSON.parse(fs.readFileSync(base + ".json", "utf8")) as Notice;
      bytes = fs.readFileSync(base + ".jpg");
    } catch {
      dropItem(name);
      continue;
    }

    const ops = await import("@/lib/ops/ops-telegram");
    if (!ops.opsTelegramConfigured()) {
      // No ops chat configured → nothing to deliver to.
      dropItem(name);
      continue;
    }

    try {
      const caption = await buildCaption(notice);
      await ops.sendOpsTelegramPhoto("agegate", bytes, caption);
      dropItem(name);
      await sleep(SEND_GAP_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const wait = Number(msg.match(/retry after (\d+)/i)?.[1] || 0);
      notice.attempts += 1;
      if (notice.attempts >= MAX_ATTEMPTS) {
        console.warn("[age-gate] notice dropped after retries:", msg.slice(0, 160));
        dropItem(name);
      } else {
        try {
          fs.writeFileSync(base + ".json", JSON.stringify(notice));
        } catch {
          /* keep going */
        }
      }
      await sleep(Math.max(10_000, wait * 1000 + 1000));
    }
  }
}
