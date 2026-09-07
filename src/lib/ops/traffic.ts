import { prisma } from "@/lib/db";
import { getActiveBotUrl } from "@/lib/tg/bot-config";

const PREFIX = "m_";

export function parseTrafficPayload(payload: string | undefined): string | undefined {
  if (!payload?.trim()) return undefined;
  const p = payload.trim();
  if (!p.startsWith(PREFIX)) return undefined;
  const code = p.slice(PREFIX.length).trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(code)) return undefined;
  return code;
}

export async function recordTrafficClick(code: string) {
  const link = await prisma.trafficLink.findUnique({ where: { code } });
  if (!link) return null;
  await prisma.trafficLink.update({
    where: { id: link.id },
    data: { clicks: { increment: 1 } },
  });
  return link;
}

export async function attributeTrafficSignup(userId: string, code: string) {
  const link = await prisma.trafficLink.findUnique({ where: { code } });
  if (!link) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trafficLinkId: true },
  });
  if (!user || user.trafficLinkId) return;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { trafficLinkId: link.id },
    }),
    prisma.trafficLink.update({
      where: { id: link.id },
      data: { signups: { increment: 1 } },
    }),
  ]);
}

export async function recordTrafficPurchase(userId: string, peaches: number) {
  if (peaches <= 0) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trafficLinkId: true },
  });
  if (!user?.trafficLinkId) return;
  await prisma.trafficLink.update({
    where: { id: user.trafficLinkId },
    data: {
      purchases: { increment: 1 },
      purchasePeaches: { increment: peaches },
    },
  });
}

export async function trafficStartUrl(code: string): Promise<string> {
  const bot = await getActiveBotUrl();
  const u = bot.replace(/\/$/, "");
  return `${u}?start=${PREFIX}${code}`;
}

export function normalizeLinkCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
}
