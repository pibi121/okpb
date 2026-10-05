import { prisma } from "@/lib/db";
import {
  getFunnelStep,
  resolveBotCallback,
  type FunnelSurface,
} from "@/lib/ops/funnel-catalog";

export type TrackFunnelInput = {
  userId: string;
  eventKey: string;
  surface?: FunnelSurface;
  platformUserId?: string;
  meta?: Record<string, unknown>;
  /** Override title/detail (rare) */
  stepTitle?: string;
  stepDetail?: string;
  at?: Date;
  /**
   * Critical path (e.g. bot.start): await + retries instead of silent drop.
   * Default false keeps fire-and-forget callers cheap.
   */
  critical?: boolean;
};

type SourceCache = {
  kind: string;
  code: string;
  createdAt: Date;
};

const sourceCache = new Map<string, { at: number; value: SourceCache }>();

async function resolveSource(userId: string): Promise<SourceCache> {
  const hit = sourceCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      trafficLink: { select: { code: true } },
      partnerAttribution: {
        select: {
          partner: { select: { code: true } },
          link: { select: { slug: true } },
        },
      },
    },
  });

  let kind = "organic";
  let code = "";
  if (user?.trafficLink?.code) {
    kind = "traffic";
    code = user.trafficLink.code;
  } else if (user?.partnerAttribution?.partner?.code) {
    kind = "partner";
    const linkSlug = user.partnerAttribution.link?.slug;
    code = linkSlug
      ? `${user.partnerAttribution.partner.code}:${linkSlug}`
      : user.partnerAttribution.partner.code;
  }

  const value: SourceCache = {
    kind,
    code,
    createdAt: user?.createdAt || new Date(),
  };
  sourceCache.set(userId, { at: Date.now(), value });
  return value;
}

function dayIndexFrom(createdAt: Date, at: Date) {
  const ms = at.getTime() - createdAt.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function writeFunnelEvent(input: TrackFunnelInput): Promise<void> {
  const step = getFunnelStep(input.eventKey);
  const at = input.at || new Date();
  const source = await resolveSource(input.userId);
  await prisma.funnelEvent.create({
    data: {
      userId: input.userId,
      platformUserId: input.platformUserId || "",
      at,
      dayIndex: dayIndexFrom(source.createdAt, at),
      surface: input.surface || step.surface,
      eventKey: input.eventKey,
      stepTitle: input.stepTitle || step.title,
      stepDetail: input.stepDetail || step.detail,
      sourceKind: source.kind,
      sourceCode: source.code,
      metaJson: JSON.stringify(input.meta || {}),
    },
  });
}

/**
 * Persist funnel event. With `critical: true` retries up to 3 attempts.
 * Never throws to callers (logs on final failure).
 */
export async function trackFunnelEvent(input: TrackFunnelInput): Promise<void> {
  const attempts = input.critical ? 3 : 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await writeFunnelEvent(input);
      return;
    } catch (e) {
      lastErr = e;
      if (i + 1 < attempts) await sleep(40 * (i + 1));
    }
  }
  console.error("[funnel-track]", input.eventKey, lastErr);
}

export function trackFunnelEventBg(input: TrackFunnelInput): void {
  void trackFunnelEvent(input);
}

export function trackBotCallback(
  userId: string,
  platformUserId: string,
  data: string,
): void {
  if (!data) return;
  const blurAmount = /^fv2:tu:ba:(\d+)$/.exec(data);
  if (blurAmount) {
    const amount = Number(blurAmount[1]) || 0;
    trackFunnelEventBg({
      userId,
      platformUserId,
      eventKey: "bot.topup.open",
      surface: "bot",
      meta: { callback: data, fromBlur: true },
    });
    trackFunnelEventBg({
      userId,
      platformUserId,
      eventKey: "bot.topup.amount",
      surface: "bot",
      meta: { amount, callback: data, fromBlur: true },
    });
    return;
  }
  const resolved = resolveBotCallback(data);
  trackFunnelEventBg({
    userId,
    platformUserId,
    eventKey: resolved.key,
    surface: "bot",
    meta: resolved.meta,
  });
}

export async function formatUserFunnelTimeline(userId: string, limit = 500) {
  const rows = await prisma.funnelEvent.findMany({
    where: { userId },
    orderBy: { at: "asc" },
    take: limit,
  });
  return rows.map((r) => ({
    at: r.at.toISOString(),
    dayIndex: r.dayIndex,
    surface: r.surface,
    eventKey: r.eventKey,
    stepTitle: r.stepTitle,
    stepDetail: r.stepDetail,
    sourceKind: r.sourceKind,
    sourceCode: r.sourceCode,
    meta: safeJson(r.metaJson),
    /** One line for AI: timestamp + human step + detail */
    aiLine: [
      r.at.toISOString(),
      `день${r.dayIndex}`,
      r.surface,
      r.stepTitle,
      r.stepDetail,
      r.sourceKind !== "organic" ? `источник=${r.sourceKind}:${r.sourceCode}` : "",
      r.metaJson && r.metaJson !== "{}" ? `meta=${r.metaJson}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  }));
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}
