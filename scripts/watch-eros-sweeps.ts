/**
 * Watchdog for in-flight eros park/animate sweeps.
 * - Keeps Comfy tunnel alive
 * - Does NOT steal GPU while the main resume shell (182766) is alive
 * - If that shell dies with work left, resumes missing variants
 *
 *   npx tsx scripts/watch-eros-sweeps.ts
 */
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ensureComfyReady } from "../src/lib/comfy-client";

const ROOT = path.resolve(__dirname, "..");
const prisma = new PrismaClient();
const ANIMATE_ID = "cmtadl2nh0027v9iwoeo712pr";

const PARK_TITLES = [
  "Eros sweep · BF16+furry 085 er_sde/7 (park-moscow)",
  "Eros sweep · BF16+furry 085 er_sde/8 (park-moscow)",
];
const ANIM_IDS = [
  "str045_s6",
  "str065_s6",
  "str085_s6",
  "str085_s7",
  "str085_s8",
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function resumeShellAlive(): boolean {
  try {
    // PowerShell: any process whose command line mentions the resume scripts
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-eros-park-remaining|run-eros-animate-sweep|watch-eros-sweeps' } | Select-Object -ExpandProperty ProcessId"`,
      { encoding: "utf8", timeout: 15_000 },
    );
    const pids = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // alive if park/animate worker exists (ignore only-watchdog self by requiring park/animate match in a second check)
    const workers = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-eros-park-remaining|run-eros-animate-sweep' } | Measure-Object | Select-Object -ExpandProperty Count"`,
      { encoding: "utf8", timeout: 15_000 },
    ).trim();
    return Number(workers) > 0;
  } catch {
    return false;
  }
}

async function ensureTunnel() {
  try {
    await ensureComfyReady(25, 2000);
    return true;
  } catch (e) {
    console.warn("[watch] tunnel/comfy:", e instanceof Error ? e.message : e);
    try {
      execSync("node scripts/start-comfy-tunnel-detached.mjs", {
        cwd: ROOT,
        stdio: "inherit",
        timeout: 60_000,
      });
    } catch {
      /* */
    }
    await sleep(8000);
    try {
      await ensureComfyReady(30, 2000);
      return true;
    } catch {
      return false;
    }
  }
}

async function parkMissing(): Promise<string[]> {
  const missing: string[] = [];
  for (const title of PARK_TITLES) {
    const hit = await prisma.quickVideoRun.findFirst({
      where: { title, status: "ready" },
    });
    if (!hit) missing.push(title);
  }
  return missing;
}

async function animMissing(): Promise<string[]> {
  const rows = await prisma.galleryItem.findMany({
    where: { title: { startsWith: "Оживление sweep ·" } },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const done = new Set<string>();
  for (const r of rows) {
    try {
      const m = JSON.parse(r.metaJson || "{}") as {
        status?: string;
        variantId?: string;
      };
      if (m.status === "ready" && m.variantId) done.add(m.variantId);
    } catch {
      /* */
    }
  }
  return ANIM_IDS.filter((id) => !done.has(id));
}

function runScript(script: string, args: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    console.log(`[watch] run ${script} ${args.join(" ")}`);
    const child = spawn("npx", ["tsx", script, ...args], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("[watch] started — babysitting park + animate sweeps");
  for (let tick = 0; tick < 300; tick++) {
    const ok = await ensureTunnel();
    const parkLeft = await parkMissing();
    const animLeft = await animMissing();
    const workers = resumeShellAlive();
    console.log(
      `[watch] t=${tick} comfy=${ok} workers=${workers} parkLeft=${parkLeft.length} animLeft=${animLeft.length}`,
    );

    if (!parkLeft.length && !animLeft.length) {
      console.log("[watch] ALL DONE");
      return;
    }

    if (workers) {
      // Main resume job still generating — only keep tunnel warm.
      await sleep(45_000);
      continue;
    }

    if (!ok) {
      await sleep(20_000);
      continue;
    }

    // Take over: finish missing park, then animate.
    if (parkLeft.length) {
      for (const title of parkLeft) {
        await prisma.quickVideoRun.updateMany({
          where: { title, status: "busy" },
          data: {
            status: "error",
            error: "watchdog reset stuck busy",
          },
        });
      }
      const code = await runScript("scripts/run-eros-park-remaining.ts");
      console.log(`[watch] park-remaining exit=${code}`);
      await sleep(5000);
      continue;
    }

    if (animLeft.length) {
      const code = await runScript("scripts/run-eros-animate-sweep.ts", [
        ANIMATE_ID,
      ]);
      console.log(`[watch] animate-sweep exit=${code}`);
      await sleep(5000);
      continue;
    }

    await sleep(30_000);
  }
  console.log("[watch] gave up after timeout");
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
