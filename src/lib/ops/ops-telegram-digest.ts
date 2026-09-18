/**
 * Marketing digest for the ops Telegram forum.
 * Slots (Europe/Moscow): 07:00, 15:00, 00:00 — funnel clicks since previous slot.
 */
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { dataRoot, ensureDataDirs } from "@/lib/paths";
import { getFunnelStep } from "@/lib/ops/funnel-catalog";
import {
  escHtml,
  formatMsk,
  formatOpsWho,
  loadOpsTelegramState,
  opsTelegramConfigured,
  saveOpsTelegramState,
  sendOpsTelegram,
} from "@/lib/ops/ops-telegram";

const MSK_OFFSET_MS = 3 * 3600_000;
const CATCHUP_MS = 10 * 3600_000;

export type DigestSlot = "00" | "07" | "15";

const SLOT_LABEL: Record<DigestSlot, string> = {
  "00": "15:00–00:00",
  "07": "00:00–07:00",
  "15": "07:00–15:00",
};

function mskWall(d: Date) {
  const shifted = new Date(d.getTime() + MSK_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  };
}

function mskUtc(y: number, mo: number, day: number, h: number, mi = 0) {
  return new Date(Date.UTC(y, mo, day, h - 3, mi, 0, 0));
}

function addUtcDays(y: number, mo: number, day: number, delta: number) {
  const d = new Date(Date.UTC(y, mo, day + delta));
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate() };
}

/** Last window for this slot whose end is <= `at` (MSK). */
export function digestWindow(
  slot: DigestSlot,
  at: Date,
): { from: Date; to: Date; key: string; label: string } {
  const w = mskWall(at);
  const closeHour = slot === "00" ? 0 : slot === "07" ? 7 : 15;
  let end = { y: w.y, mo: w.mo, day: w.day };
  const todayClose = mskUtc(w.y, w.mo, w.day, closeHour);
  if (at.getTime() < todayClose.getTime()) {
    end = addUtcDays(w.y, w.mo, w.day, -1);
  }

  if (slot === "00") {
    const prev = addUtcDays(end.y, end.mo, end.day, -1);
    const from = mskUtc(prev.y, prev.mo, prev.day, 15);
    const to = mskUtc(end.y, end.mo, end.day, 0);
    const key = `${end.y}-${pad(end.mo + 1)}-${pad(end.day)}-00`;
    return { from, to, key, label: SLOT_LABEL["00"] };
  }

  const fromH = slot === "07" ? 0 : 7;
  const from = mskUtc(end.y, end.mo, end.day, fromH);
  const to = mskUtc(end.y, end.mo, end.day, closeHour);
  const key = `${end.y}-${pad(end.mo + 1)}-${pad(end.day)}-${slot}`;
  return { from, to, key, label: SLOT_LABEL[slot] };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dueSlots(now: Date, lastKey: string | undefined): DigestSlot[] {
  const due: DigestSlot[] = [];
  for (const slot of ["00", "07", "15"] as DigestSlot[]) {
    const win = digestWindow(slot, now);
    if (now.getTime() < win.to.getTime()) continue;
    if (now.getTime() - win.to.getTime() > CATCHUP_MS) continue;
    if (lastKey === win.key) continue;
    // skip if we already sent a later key the same day — lastKey compare by string works
    // because keys sort lexicographically: YYYY-MM-DD-00/07/15
    if (lastKey && lastKey > win.key) continue;
    due.push(slot);
  }
  return due;
}

export async function buildMarketingDigest(
  from: Date,
  to: Date,
): Promise<string> {
  const where = { at: { gte: from, lt: to } };

  const [byEvent, bySource, usersTouched, recent, newUsers, paidOrders] =
    await Promise.all([
      prisma.funnelEvent.groupBy({
        by: ["eventKey"],
        where,
        _count: { _all: true },
        orderBy: { _count: { eventKey: "desc" } },
        take: 40,
      }),
      prisma.funnelEvent.groupBy({
        by: ["sourceKind", "sourceCode"],
        where,
        _count: { _all: true },
        orderBy: { _count: { sourceKind: "desc" } },
        take: 15,
      }),
      prisma.funnelEvent.findMany({
        where,
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.funnelEvent.findMany({
        where,
        orderBy: { at: "desc" },
        take: 22,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              source: true,
              platformAccounts: {
                where: { platform: "telegram" },
                select: {
                  platformUserId: true,
                  username: true,
                  firstName: true,
                },
                take: 1,
              },
            },
          },
        },
      }),
      prisma.user.count({
        where: { createdAt: { gte: from, lt: to } },
      }),
      prisma.paymentOrder
        .findMany({
          where: { creditedAt: { gte: from, lt: to } },
          select: { peaches: true, amountMinor: true },
        })
        .catch((e) => {
          console.warn(
            "[ops-tg] payments query:",
            e instanceof Error ? e.message : e,
          );
          return [] as Array<{ peaches: number; amountMinor: number }>;
        }),
    ]);

  const coreKeys = [
    "bot.start",
    "bot.rules.agree",
    "bot.welcome.after_rules",
    "miniapp.open",
    "bot.menu.generation",
    "bot.gen.confirm",
    "bot.gen.started",
    "bot.gen.delivered",
    "bot.topup.paid",
  ];
  const uniquePerKey: Record<string, number> = {};
  for (const key of coreKeys) {
    const u = await prisma.funnelEvent.findMany({
      where: { ...where, eventKey: key },
      distinct: ["userId"],
      select: { userId: true },
    });
    uniquePerKey[key] = u.length;
  }

  const peaches = paidOrders.reduce((s, o) => s + o.peaches, 0);
  const rub = paidOrders.reduce((s, o) => s + o.amountMinor, 0) / 100;

  const byStage = new Map<string, number>();
  for (const row of byEvent) {
    const step = getFunnelStep(row.eventKey);
    byStage.set(step.stage, (byStage.get(step.stage) || 0) + row._count._all);
  }

  const STAGE_RU: Record<string, string> = {
    acquisition: "вход",
    onboarding: "онбординг",
    activation: "активация",
    generation: "генерация",
    monetization: "оплата",
    retention: "удержание",
    navigation: "навигация",
    support: "помощь",
    partner: "партнёрка",
    system: "система",
  };

  const lines: string[] = [];
  lines.push(`👥 Активных людей: <b>${usersTouched.length}</b>`);
  lines.push(`🆕 Регистраций: <b>${newUsers}</b>`);
  lines.push(
    `💳 Оплат: <b>${paidOrders.length}</b> · ${peaches} 🍑 · ${rub.toFixed(0)} ₽`,
  );
  lines.push("");
  lines.push("<b>Воронка (уникальные люди)</b>");
  for (const key of coreKeys) {
    const n = uniquePerKey[key] || 0;
    if (!n && key !== "bot.topup.paid") continue;
    lines.push(`· ${escHtml(getFunnelStep(key).title)} — ${n}`);
  }

  if (byStage.size) {
    lines.push("");
    lines.push("<b>Этапы (клики)</b>");
    const staged = [...byStage.entries()].sort((a, b) => b[1] - a[1]);
    for (const [stage, n] of staged) {
      lines.push(`· ${STAGE_RU[stage] || stage}: ${n}`);
    }
  }

  if (byEvent.length) {
    lines.push("");
    lines.push("<b>Куда жали</b>");
    for (const row of byEvent.slice(0, 18)) {
      const step = getFunnelStep(row.eventKey);
      lines.push(`· ${escHtml(step.title)} — ${row._count._all}`);
    }
  }

  if (bySource.length) {
    lines.push("");
    lines.push("<b>Источники</b>");
    for (const s of bySource) {
      const code = s.sourceCode ? `:${s.sourceCode}` : "";
      lines.push(`· ${escHtml(s.sourceKind)}${escHtml(code)} — ${s._count._all}`);
    }
  }

  if (recent.length) {
    lines.push("");
    lines.push("<b>Последние действия</b>");
    for (const r of recent) {
      const who = formatOpsWho(r.user).split(" · ").slice(0, 2).join(" ");
      const t = formatMsk(r.at).replace(/^\d{2}\s+\S+\s+/, "");
      lines.push(
        `· ${t} ${who} — ${escHtml(r.stepTitle || getFunnelStep(r.eventKey).title)}`,
      );
    }
  }

  if (usersTouched.length === 0 && newUsers === 0 && paidOrders.length === 0) {
    lines.push("");
    lines.push("Тихо: кликов и оплат за окно не было.");
  }

  return lines.join("\n");
}

export async function sendMarketingDigest(opts?: {
  from?: Date;
  to?: Date;
  slot?: DigestSlot;
  force?: boolean;
}): Promise<{ sent: boolean; key: string; detail: string }> {
  if (!opsTelegramConfigured()) {
    return { sent: false, key: "", detail: "ops telegram не настроен" };
  }
  const now = new Date();
  const slot = opts?.slot || "07";
  const win = opts?.from && opts?.to
    ? {
        from: opts.from,
        to: opts.to,
        key: `manual-${now.toISOString()}`,
        label: `${formatMsk(opts.from)}–${formatMsk(opts.to)}`,
      }
    : digestWindow(slot, now);

  const state = loadOpsTelegramState();
  if (!opts?.force && state?.lastDigestKey === win.key) {
    return { sent: false, key: win.key, detail: "уже отправляли этот слот" };
  }

  const body = await buildMarketingDigest(win.from, win.to);
  const header = [
    `📊 <b>Маркетинг · ${win.label} МСК</b>`,
    `${formatMsk(win.from)} → ${formatMsk(win.to)}`,
    "",
  ].join("\n");
  await sendOpsTelegram("marketing", header + body);
  if (!win.key.startsWith("manual-")) {
    saveOpsTelegramState({
      lastDigestKey: win.key,
      lastDigestAt: now.toISOString(),
    });
  }
  return { sent: true, key: win.key, detail: "отправлено" };
}

const LOCK = () => path.join(dataRoot(), "ops-telegram.digest.lock");

function tryDigestLock(): boolean {
  ensureDataDirs();
  const lock = LOCK();
  try {
    fs.writeFileSync(lock, `${process.pid}:${Date.now()}`, { flag: "wx" });
    return true;
  } catch {
    try {
      const st = fs.statSync(lock);
      if (Date.now() - st.mtimeMs > 120_000) {
        fs.unlinkSync(lock);
        fs.writeFileSync(lock, `${process.pid}:${Date.now()}`, { flag: "wx" });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}

function releaseDigestLock() {
  try {
    fs.unlinkSync(LOCK());
  } catch {
    /* ignore */
  }
}

export async function tickOpsTelegramDigest(): Promise<void> {
  if (!opsTelegramConfigured()) return;
  if (!tryDigestLock()) return;
  try {
    const last = loadOpsTelegramState()?.lastDigestKey;
    const due = dueSlots(new Date(), last);
    for (const slot of due) {
      try {
        const r = await sendMarketingDigest({ slot });
        if (r.sent) console.log("[ops-tg] digest", r.key);
      } catch (e) {
        console.error("[ops-tg] digest", slot, e);
      }
    }
  } finally {
    releaseDigestLock();
  }
}

let digestTimer: ReturnType<typeof setInterval> | null = null;

export function startOpsTelegramScheduler() {
  if (digestTimer) return;
  if (!opsTelegramConfigured()) {
    console.log("[ops-tg] scheduler idle — нет OPS_TG_CHAT_ID");
    return;
  }
  const tick = () => {
    void tickOpsTelegramDigest().catch((e) =>
      console.error("[ops-tg] tick:", e),
    );
  };
  setTimeout(tick, 20_000);
  digestTimer = setInterval(tick, 60_000);
  console.log("[ops-tg] digest scheduler 07/15/00 Europe/Moscow");
}
