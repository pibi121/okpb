/**
 * Recover partner attributions + commissions lost to the /start race
 * (user created before ref payload was applied).
 */
import { prisma } from "@/lib/db";
import {
  attributeUserToPartner,
  creditPartnerCommission,
  parsePartnerRefPayload,
  recordPartnerClick,
} from "@/lib/tg/partner-program";

const START_EVENTS = ["bot.start", "bot.start.returning", "bot.start.photos_upload"];

function payloadFromMeta(metaJson: string | null): string {
  if (!metaJson) return "";
  try {
    const meta = JSON.parse(metaJson) as { payload?: unknown };
    return String(meta.payload || "").trim();
  } catch {
    return "";
  }
}

export type PartnerBackfillReport = {
  dryRun: boolean;
  funnelRefHits: number;
  usersWithRef: number;
  attributed: number;
  alreadyAttributed: number;
  skippedSelfOrMissingPartner: number;
  commissionsCreated: number;
  commissionsSkippedExisting: number;
  topupsScanned: number;
  details: Array<Record<string, unknown>>;
};

export async function backfillPartnerRefsFromFunnel(opts?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<PartnerBackfillReport> {
  const dryRun = Boolean(opts?.dryRun);
  const limit = Math.min(5000, Math.max(1, opts?.limit || 2000));

  const events = await prisma.funnelEvent.findMany({
    where: { eventKey: { in: START_EVENTS } },
    orderBy: { at: "asc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      at: true,
      eventKey: true,
      metaJson: true,
      platformUserId: true,
    },
  });

  /** First ref_ payload per user (chronological). */
  const firstRef = new Map<
    string,
    { payload: string; code: string; linkSlug?: string; at: Date; eventKey: string }
  >();
  let funnelRefHits = 0;

  for (const ev of events) {
    const payload = payloadFromMeta(ev.metaJson);
    if (!payload.startsWith("ref_")) continue;
    funnelRefHits += 1;
    if (firstRef.has(ev.userId)) continue;
    const { code, linkSlug } = parsePartnerRefPayload(payload);
    if (!code) continue;
    firstRef.set(ev.userId, {
      payload,
      code,
      linkSlug,
      at: ev.at,
      eventKey: ev.eventKey,
    });
  }

  const report: PartnerBackfillReport = {
    dryRun,
    funnelRefHits,
    usersWithRef: firstRef.size,
    attributed: 0,
    alreadyAttributed: 0,
    skippedSelfOrMissingPartner: 0,
    commissionsCreated: 0,
    commissionsSkippedExisting: 0,
    topupsScanned: 0,
    details: [],
  };

  /** userIds that have (or would have) partner attribution after this pass */
  const attributedUserIds = new Set<string>();

  for (const [userId, ref] of firstRef) {
    const existing = await prisma.partnerAttribution.findUnique({
      where: { userId },
      select: { id: true, partnerId: true },
    });
    if (existing) {
      report.alreadyAttributed += 1;
      attributedUserIds.add(userId);
      continue;
    }

    const partner = await prisma.partnerProfile.findFirst({
      where: { code: ref.code, status: "active" },
    });
    if (!partner || partner.userId === userId) {
      report.skippedSelfOrMissingPartner += 1;
      report.details.push({
        userId,
        action: "skip_partner",
        code: ref.code,
        reason: !partner ? "partner_not_found" : "self_referral",
      });
      continue;
    }

    if (!dryRun) {
      await recordPartnerClick(ref.code, ref.linkSlug);
      const attr = await attributeUserToPartner({
        userId,
        code: ref.code,
        linkSlug: ref.linkSlug,
      });
      if (!attr) {
        report.skippedSelfOrMissingPartner += 1;
        report.details.push({
          userId,
          action: "skip_attr_null",
          code: ref.code,
        });
        continue;
      }
    }

    attributedUserIds.add(userId);
    report.attributed += 1;
    report.details.push({
      userId,
      action: dryRun ? "would_attribute" : "attributed",
      code: ref.code,
      linkSlug: ref.linkSlug || null,
      at: ref.at.toISOString(),
      eventKey: ref.eventKey,
    });
  }

  // Also commission any attributions that already existed but had no funnel hit in this scan.
  const attrs = await prisma.partnerAttribution.findMany({
    select: {
      userId: true,
      partnerId: true,
      linkId: true,
      partner: { select: { commissionPct: true, status: true, code: true } },
    },
  });
  for (const a of attrs) attributedUserIds.add(a.userId);

  for (const userId of attributedUserIds) {
    const attr = attrs.find((a) => a.userId === userId);
    let partnerStatus = attr?.partner.status;
    let partnerId = attr?.partnerId;

    if (!attr) {
      // dryRun path: attribution not written yet — resolve from firstRef
      const ref = firstRef.get(userId);
      if (!ref) continue;
      const partner = await prisma.partnerProfile.findFirst({
        where: { code: ref.code, status: "active" },
        select: { id: true, status: true, commissionPct: true },
      });
      if (!partner) continue;
      partnerStatus = partner.status;
      partnerId = partner.id;
    }

    if (partnerStatus !== "active" || !partnerId) continue;

    const ledgers = await prisma.ledgerEntry.findMany({
      where: {
        userId,
        amount: { gt: 0 },
        OR: [
          { reason: { contains: "topup" } },
          { reason: { contains: "cashera" } },
          { reason: { contains: "payment" } },
          { reason: { contains: "начисл" } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, amount: true, reason: true, createdAt: true },
    });

    const existingComms = await prisma.partnerCommission.findMany({
      where: { referredUserId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        grossPeaches: true,
        createdAt: true,
      },
    });
    const usedCommIds = new Set<string>();

    for (const led of ledgers) {
      report.topupsScanned += 1;
      const match = existingComms.find(
        (c) =>
          !usedCommIds.has(c.id) &&
          c.grossPeaches === led.amount &&
          Math.abs(c.createdAt.getTime() - led.createdAt.getTime()) <
            7 * 24 * 3600 * 1000,
      );
      if (match) {
        usedCommIds.add(match.id);
        report.commissionsSkippedExisting += 1;
        continue;
      }

      if (!dryRun) {
        await creditPartnerCommission({
          referredUserId: userId,
          grossPeaches: led.amount,
          kind: "topup_backfill",
        });
      }
      report.commissionsCreated += 1;
      report.details.push({
        userId,
        action: dryRun ? "would_commission" : "commission",
        grossPeaches: led.amount,
        reason: led.reason,
        ledgerId: led.id,
        at: led.createdAt.toISOString(),
      });
    }
  }

  return report;
}

export async function listFunnelRefPayloads(limit = 100) {
  const take = Math.min(500, Math.max(1, limit));
  const events = await prisma.funnelEvent.findMany({
    where: { eventKey: { in: START_EVENTS } },
    orderBy: { at: "desc" },
    take: take * 5,
    select: {
      id: true,
      userId: true,
      at: true,
      eventKey: true,
      metaJson: true,
      platformUserId: true,
    },
  });

  const out: Array<{
    userId: string;
    platformUserId: string;
    at: string;
    eventKey: string;
    payload: string;
    code?: string;
    linkSlug?: string;
  }> = [];

  for (const ev of events) {
    const payload = payloadFromMeta(ev.metaJson);
    if (!payload.startsWith("ref_")) continue;
    const { code, linkSlug } = parsePartnerRefPayload(payload);
    out.push({
      userId: ev.userId,
      platformUserId: ev.platformUserId,
      at: ev.at.toISOString(),
      eventKey: ev.eventKey,
      payload,
      code,
      linkSlug,
    });
    if (out.length >= take) break;
  }
  return out;
}
