import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

type Clip = {
  id: string;
  title: string;
  url: string;
  group: "classroom" | "park" | "animate";
  pipeline: "ref2v" | "i2v";
  variantId: string;
  furryStrength: number | null;
  steps: number | null;
  durationSec: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  genSec: number | null;
  engine: string | null;
};

function parseMeta(raw: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function variantFromTitle(title: string): {
  variantId: string;
  strength: number | null;
  steps: number | null;
} {
  const m = title.match(/furry\s+(0?\d+)\s+er_sde\/(\d+)/i);
  if (m) {
    const raw = m[1];
    const strength = raw.startsWith("0")
      ? Number(`0.${raw.slice(1)}`)
      : Number(raw) / 100;
    return {
      variantId: `str${raw}_s${m[2]}`,
      strength: Number.isFinite(strength) ? strength : null,
      steps: Number(m[2]),
    };
  }
  return { variantId: "unknown", strength: null, steps: null };
}

async function main() {
  const clips: Clip[] = [];

  const qv = await prisma.quickVideoRun.findMany({
    where: {
      status: "ready",
      OR: [
        { title: { startsWith: "Eros sweep ·" } },
        { title: { startsWith: "Eros Civit · BF16+furry" } },
        { title: { startsWith: "Eros Civit · BF16 er_sde" } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  for (const r of qv) {
    const title = r.title || "";
    let group: Clip["group"] | null = null;
    if (/classroom/i.test(title)) group = "classroom";
    else if (/park/i.test(title)) group = "park";
    if (!group) continue;
    // Prefer strength/steps sweep; also include bare BF16 civit as reference if present
    const v = variantFromTitle(title);
    const isSweep = /Eros sweep/i.test(title);
    const isHybrid085 =
      /BF16\+furry e31/i.test(title) && /er_sde\/6/i.test(title);
    const isBareBf16 = /BF16 er_sde\/6/i.test(title) && !/furry/i.test(title);
    if (!isSweep && !isHybrid085 && !isBareBf16) continue;

    let variantId = v.variantId;
    let strength = v.strength;
    let steps = v.steps;
    if (isBareBf16) {
      variantId = "bf16_alone_s6";
      strength = 0;
      steps = 6;
    } else if (isHybrid085 && !isSweep) {
      variantId = "str085_s6_civit_hybrid";
      strength = 0.85;
      steps = 6;
    }

    clips.push({
      id: r.id,
      title,
      url: r.resultVideoUrl || "",
      group,
      pipeline: "ref2v",
      variantId,
      furryStrength: strength,
      steps,
      durationSec: r.durationSec,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.createdAt.toISOString(),
      finishedAt: r.updatedAt.toISOString(),
      genSec: Math.max(
        0,
        Math.round((r.updatedAt.getTime() - r.createdAt.getTime()) / 1000),
      ),
      engine: r.engine,
    });
  }

  const gallery = await prisma.galleryItem.findMany({
    where: {
      kind: "video",
      OR: [
        { title: { startsWith: "Оживление sweep" } },
        { title: "Animate: Peach still" },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  for (const g of gallery) {
    const meta = parseMeta(g.metaJson);
    if (meta.status && meta.status !== "ready") continue;
    if (!g.resultUrl || g.resultUrl.includes("placeholder")) continue;
    const title = g.title || "";
    const isBaseline = title === "Animate: Peach still";
    const v = isBaseline
      ? { variantId: "baseline_stock_i2v", strength: null as number | null, steps: null as number | null }
      : variantFromTitle(title);
    const strength =
      typeof meta.furryStrength === "number" ? meta.furryStrength : v.strength;
    const steps = typeof meta.steps === "number" ? meta.steps : v.steps;
    clips.push({
      id: g.id,
      title,
      url: g.resultUrl,
      group: "animate",
      pipeline: "i2v",
      variantId: isBaseline
        ? "baseline_stock_i2v"
        : String(meta.variantId || v.variantId),
      furryStrength: isBaseline ? null : strength,
      steps: isBaseline ? null : steps,
      durationSec:
        typeof meta.durationSec === "number" ? meta.durationSec : 8,
      createdAt: g.createdAt.toISOString(),
      startedAt: g.createdAt.toISOString(),
      finishedAt: g.updatedAt.toISOString(),
      genSec: Math.max(
        0,
        Math.round((g.updatedAt.getTime() - g.createdAt.getTime()) / 1000),
      ),
      engine: typeof meta.engine === "string" ? meta.engine : null,
    });
  }

  // Deduplicate by title+url keeping latest
  const byKey = new Map<string, Clip>();
  for (const c of clips) {
    const key = `${c.group}|${c.variantId}|${c.title}`;
    const prev = byKey.get(key);
    if (!prev || prev.createdAt < c.createdAt) byKey.set(key, c);
  }
  const out = [...byKey.values()].sort((a, b) => {
    const go = { classroom: 0, park: 1, animate: 2 }[a.group] -
      { classroom: 0, park: 1, animate: 2 }[b.group];
    if (go !== 0) return go;
    return a.title.localeCompare(b.title, "ru");
  });

  const dest = path.join(process.cwd(), "data", "eros-eval-clips.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify({ generatedAt: new Date().toISOString(), clips: out }, null, 2), "utf8");
  console.log("wrote", dest, "clips", out.length);
  for (const c of out) {
    console.log(c.group, c.pipeline, c.variantId, c.genSec + "s", c.title.slice(0, 60));
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
