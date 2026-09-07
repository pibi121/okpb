import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { BUILD_VERSION } from "@/lib/gpu/types";
import type { TimelineEvent } from "@/lib/gpu/types";

export type OpsErrorKind =
  | "generation"
  | "lora"
  | "bot"
  | "payment"
  | "miniapp"
  | "gpu"
  | "other";

function normalizeMessage(msg: string): string {
  return msg
    .replace(/https?:\/\/\S+/gi, "URL")
    .replace(/[0-9a-f]{8,}/gi, "#")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function errorFingerprint(kind: string, message: string): string {
  const n = normalizeMessage(message || "unknown");
  return createHash("sha1").update(`${kind}|${n}`).digest("hex").slice(0, 24);
}

function parseTimeline(raw: string): TimelineEvent[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? (v as TimelineEvent[]) : [];
  } catch {
    return [];
  }
}

export function buildCursorPrompt(row: {
  kind: string;
  title: string;
  sampleMessage: string;
  sampleStack: string;
  count: number;
  lastUserId: string;
  lastMetaJson: string;
  lastAt: Date | string;
  stage?: string;
  timelineJson?: string;
  lastJobId?: string;
  lastRefType?: string;
  lastRefId?: string;
  buildVersion?: string;
  autoRetryCount?: number;
}): string {
  const timeline = parseTimeline(row.timelineJson || "[]");
  const timelineBlock =
    timeline.length > 0
      ? [
          "История этапов:",
          ...timeline.map(
            (e) =>
              `- ${e.at} · ${e.stage}${e.detail ? ` — ${e.detail}` : ""}`,
          ),
        ].join("\n")
      : "";

  return [
    "Ошибка PeachBitch (бот / мини-апп / генерация). Полный лог для фикса.",
    "",
    `Тип: ${row.kind}`,
    `Суть: ${row.title}`,
    `Этап: ${row.stage || "—"}`,
    `Повторов: ${row.count}`,
    `Авто-повторов: ${row.autoRetryCount ?? 0}`,
    `Последний раз: ${typeof row.lastAt === "string" ? row.lastAt : row.lastAt.toISOString()}`,
    `Билд: ${row.buildVersion || BUILD_VERSION}`,
    row.lastUserId ? `Пользователь (внутренний id): ${row.lastUserId}` : "",
    row.lastJobId ? `GpuJob id: ${row.lastJobId}` : "",
    row.lastRefType || row.lastRefId
      ? `Ref: ${row.lastRefType || "?"} / ${row.lastRefId || "?"}`
      : "",
    "",
    "Текст ошибки:",
    row.sampleMessage || "—",
    "",
    row.sampleStack ? `Стек:\n${row.sampleStack.slice(0, 3500)}` : "",
    "",
    timelineBlock,
    "",
    row.lastMetaJson && row.lastMetaJson !== "{}"
      ? `Дополнительно (JSON):\n${row.lastMetaJson.slice(0, 2500)}`
      : "",
    "",
    "Нужно найти причину в проекте peachbitch и починить раз и навсегда.",
    "Людям не показывать внутренние имена серверов, ключи и модели.",
    "Если можно — предложи безопасный авто-retry / recover.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export async function reportOpsError(opts: {
  kind: OpsErrorKind;
  message: string;
  stack?: string;
  userId?: string | null;
  meta?: Record<string, unknown>;
  stage?: string;
  jobId?: string;
  refType?: string;
  refId?: string;
  timeline?: TimelineEvent[];
  autoRetry?: boolean;
}): Promise<void> {
  const message = (opts.message || "unknown").slice(0, 2000);
  const title = normalizeMessage(message) || opts.kind;
  const fingerprint = errorFingerprint(opts.kind, message);
  const now = new Date();
  const metaJson = JSON.stringify({
    ...(opts.meta || {}),
    buildVersion: BUILD_VERSION,
  });
  const stack = (opts.stack || "").slice(0, 4000);
  const timelineJson = JSON.stringify((opts.timeline || []).slice(-40));
  try {
    const existing = await prisma.opsError.findUnique({
      where: { fingerprint },
    });
    if (existing) {
      await prisma.opsError.update({
        where: { fingerprint },
        data: {
          count: { increment: 1 },
          sampleMessage: message,
          sampleStack: stack || undefined,
          lastUserId: opts.userId || undefined,
          lastMetaJson: metaJson,
          lastAt: now,
          status: "open",
          stage: opts.stage || existing.stage || "",
          timelineJson: opts.timeline?.length ? timelineJson : undefined,
          lastJobId: opts.jobId || undefined,
          lastRefType: opts.refType || undefined,
          lastRefId: opts.refId || undefined,
          buildVersion: BUILD_VERSION,
          autoRetryCount: opts.autoRetry
            ? { increment: 1 }
            : undefined,
        },
      });
    } else {
      await prisma.opsError.create({
        data: {
          fingerprint,
          kind: opts.kind,
          title,
          sampleMessage: message,
          sampleStack: stack,
          count: 1,
          lastUserId: opts.userId || "",
          lastMetaJson: metaJson,
          status: "open",
          firstAt: now,
          lastAt: now,
          stage: opts.stage || "",
          timelineJson,
          lastJobId: opts.jobId || "",
          lastRefType: opts.refType || "",
          lastRefId: opts.refId || "",
          buildVersion: BUILD_VERSION,
          autoRetryCount: opts.autoRetry ? 1 : 0,
        },
      });
    }
  } catch (e) {
    console.error("[ops] report error failed:", e);
  }
}
