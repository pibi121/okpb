import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  if (process.env.BOOTSTRAP_ADMIN_ENABLED !== "1") return false;
  const expected =
    process.env.BOOTSTRAP_ADMIN_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "";
  const got = req.headers.get("x-bootstrap-secret")?.trim() || "";
  return Boolean(expected && got === expected);
}

function prodDbPath() {
  const url = process.env.DATABASE_URL || "file:./data/prod.db";
  if (url.startsWith("file:")) {
    const p = url.replace(/^file:/, "");
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }
  return path.join(process.cwd(), "data", "prod.db");
}

/** One-shot owner restore / DB import for Peach admin cabinet. */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") || "";

  // Multipart: field "db" = sqlite file to replace production DB.
  // Multipart: action=upload_gallery + fields relKey,file
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const action = String(form.get("action") || "import_db");

    if (action === "upload_gallery") {
      const relKey = String(form.get("relKey") || "").replace(/\\/g, "/").replace(/\.\./g, "");
      const file = form.get("file");
      if (!relKey || !(file instanceof File) || file.size < 1) {
        return NextResponse.json({ error: "relKey+file required" }, { status: 400 });
      }
      if (file.size > 80 * 1024 * 1024) {
        return NextResponse.json({ error: "file too large" }, { status: 400 });
      }
      const { galleryRoot, ensureDataDirs } = await import("@/lib/paths");
      ensureDataDirs();
      const abs = path.join(galleryRoot(), ...relKey.split("/").filter(Boolean));
      if (!abs.startsWith(galleryRoot())) {
        return NextResponse.json({ error: "bad path" }, { status: 400 });
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(await file.arrayBuffer()));
      return NextResponse.json({ ok: true, action: "upload_gallery", relKey, bytes: file.size });
    }

    if (action !== "import_db") {
      return NextResponse.json({ error: "unsupported multipart action" }, { status: 400 });
    }
    const file = form.get("db");
    if (!(file instanceof File) || file.size < 1000) {
      return NextResponse.json({ error: "db file required" }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "db too large (max 20MB)" }, { status: 400 });
    }
    const dest = prodDbPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const backup = `${dest}.bak-${Date.now()}`;
    if (fs.existsSync(dest)) fs.copyFileSync(dest, backup);
    const buf = Buffer.from(await file.arrayBuffer());
    const tmp = `${dest}.importing`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    return NextResponse.json({
      ok: true,
      action: "import_db",
      bytes: buf.length,
      dest,
      backup,
      note: "Restart the service so Prisma reconnects to the new DB, then call set_password.",
    });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    email?: string;
    password?: string;
    name?: string;
    telegramUserId?: string;
  };

  const action = body.action || "ensure_owner";

  if (action === "inspect") {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        source: true,
        _count: { select: { galleryItems: true, characters: true } },
        platformAccounts: {
          where: { platform: "telegram" },
          select: { platformUserId: true, username: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    return NextResponse.json({ ok: true, users });
  }

  if (action === "disk_stats" || action === "free_disk" || action === "purge_videos") {
    const { dataRoot, galleryRoot } = await import("@/lib/paths");
    const { execSync } = await import("node:child_process");
    const root = dataRoot();

    function walk(dir: string, out: { path: string; size: number }[], depth = 0) {
      if (depth > 8 || !fs.existsSync(dir)) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        try {
          if (e.isDirectory()) walk(full, out, depth + 1);
          else if (e.isFile()) out.push({ path: full, size: fs.statSync(full).size });
        } catch {
          /* skip */
        }
      }
    }

    let df = "";
    try {
      df = execSync("df -h /app/data /tmp / 2>/dev/null || df -h", {
        encoding: "utf8",
        timeout: 5000,
      }).slice(0, 800);
    } catch {
      df = "df_unavailable";
    }

    const before: { path: string; size: number }[] = [];
    walk(root, before);
    const beforeBytes = before.reduce((s, f) => s + f.size, 0);
    const largest = [...before].sort((a, b) => b.size - a.size).slice(0, 25);

    let deleted = 0;
    let freed = 0;
    const kill = (p: string) => {
      try {
        const sz = fs.statSync(p).size;
        fs.unlinkSync(p);
        deleted += 1;
        freed += sz;
      } catch {
        /* ignore */
      }
    };

    if (action === "free_disk" || action === "purge_videos") {
      for (const f of before) {
        const base = path.basename(f.path);
        const rel = path.relative(root, f.path).replace(/\\/g, "/");
        if (
          /\.bak($|-)/i.test(base) ||
          base.endsWith(".importing") ||
          base.endsWith(".tmp") ||
          rel.startsWith("backups/") ||
          /\.partial$/i.test(base)
        ) {
          kill(f.path);
        }
      }
      // Drop huge orphan videos over 40MB under gallery
      const gRoot = galleryRoot();
      for (const f of before) {
        if (!f.path.startsWith(gRoot)) continue;
        if (f.size < 40 * 1024 * 1024) continue;
        if (!/\.(mp4|webm|mov|mkv)$/i.test(f.path)) continue;
        kill(f.path);
      }
    }

    if (action === "purge_videos") {
      // Emergency: remove all gallery videos > 800KB to reclaim volume headroom.
      // DB rows stay; missing files show placeholders until re-synced.
      const gRoot = galleryRoot();
      const min = 800 * 1024;
      for (const f of before) {
        if (!f.path.startsWith(gRoot)) continue;
        if (f.size < min) continue;
        if (!/\.(mp4|webm|mov|mkv)$/i.test(f.path)) continue;
        kill(f.path);
      }
      try {
        await prisma.$executeRawUnsafe("VACUUM");
      } catch (e) {
        console.error("[bootstrap] VACUUM failed", e);
      }
    } else if (action === "free_disk") {
      try {
        await prisma.$executeRawUnsafe("VACUUM");
      } catch (e) {
        console.error("[bootstrap] VACUUM failed", e);
      }
    }

    const after: { path: string; size: number }[] = [];
    walk(root, after);
    const afterBytes = after.reduce((s, f) => s + f.size, 0);

    return NextResponse.json({
      ok: true,
      action,
      root,
      df,
      beforeBytes,
      afterBytes,
      deleted,
      freed,
      files: after.length,
      largest: largest.map((f) => ({
        path: path.relative(root, f.path).replace(/\\/g, "/"),
        mb: Math.round((f.size / 1024 / 1024) * 10) / 10,
      })),
    });
  }

  if (action === "fail_pending_gens") {
    const gallery = await prisma.galleryItem.findMany({
      select: { id: true, metaJson: true, resultUrl: true },
    });
    let galleryFailed = 0;
    for (const row of gallery) {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(row.metaJson || "{}") as Record<string, unknown>;
      } catch {
        meta = {};
      }
      if (meta.status !== "pending") continue;
      await prisma.galleryItem.update({
        where: { id: row.id },
        data: {
          metaJson: JSON.stringify({
            ...meta,
            status: "error",
            error:
              "Остановлено: GPU переехал, модели докачиваются. Запусти генерацию заново.",
          }),
        },
      });
      galleryFailed += 1;
    }

    const qv = await prisma.quickVideoRun.updateMany({
      where: { status: { in: ["busy", "pending"] } },
      data: {
        status: "error",
        error:
          "Остановлено: GPU переехал, модели докачиваются. Запусти генерацию заново.",
      },
    });

    const jobs = await prisma.renderJob.updateMany({
      where: { status: { in: ["queued", "running_still", "running_video", "busy"] } },
      data: {
        status: "error",
        errorMessage:
          "Остановлено: GPU переехал, модели докачиваются. Запусти генерацию заново.",
      },
    });

    return NextResponse.json({
      ok: true,
      action: "fail_pending_gens",
      galleryFailed,
      quickVideoFailed: qv.count,
      renderJobsFailed: jobs.count,
    });
  }

  if (action === "recover_stuck_qv") {
    const { resumeStuckQuickVideoRuns, tryRecoverQuickVideoFromComfy } =
      await import("@/lib/quick-video");
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (runId) {
      const run = await prisma.quickVideoRun.findUnique({
        where: { id: runId },
        select: {
          id: true,
          userId: true,
          status: true,
          title: true,
          resultVideoUrl: true,
          characterIdsJson: true,
        },
      });
      if (!run) {
        return NextResponse.json({ error: "run not found", runId }, { status: 404 });
      }
      const force = body.force === true || run.status === "ready";
      const ok = await tryRecoverQuickVideoFromComfy(run.id, run.userId, {
        force,
      });
      const after = await prisma.quickVideoRun.findUnique({
        where: { id: run.id },
        select: {
          status: true,
          resultVideoUrl: true,
          engine: true,
          galleryItemId: true,
        },
      });
      return NextResponse.json({
        ok,
        action: "recover_stuck_qv",
        runId: run.id,
        prevStatus: run.status,
        title: run.title,
        after,
      });
    }
    const n = await resumeStuckQuickVideoRuns({ allowRequeue: false });
    return NextResponse.json({ ok: true, action: "recover_stuck_qv", handled: n });
  }

  if (action === "resend_qv_notify") {
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!runId) {
      return NextResponse.json({ error: "runId required" }, { status: 400 });
    }
    const run = await prisma.quickVideoRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        userId: true,
        status: true,
        title: true,
        resultVideoUrl: true,
        characterIdsJson: true,
      },
    });
    if (!run?.resultVideoUrl) {
      return NextResponse.json(
        { error: "run not ready or missing video", run },
        { status: 404 },
      );
    }
    const charIds = JSON.parse(run.characterIdsJson || "[]") as string[];
    const { notifyTgVideoReady } = await import("@/lib/tg/generation-service");
    await notifyTgVideoReady(
      run.userId,
      run.resultVideoUrl,
      run.title,
      charIds[0],
    );
    return NextResponse.json({
      ok: true,
      action: "resend_qv_notify",
      runId: run.id,
      resultVideoUrl: run.resultVideoUrl,
    });
  }

  if (action === "retry_pending_li2v") {
    const galleryItemId =
      typeof body.galleryItemId === "string" ? body.galleryItemId.trim() : "";
    if (!galleryItemId) {
      return NextResponse.json({ error: "galleryItemId required" }, { status: 400 });
    }
    const item = await prisma.galleryItem.findUnique({
      where: { id: galleryItemId },
    });
    if (!item) {
      return NextResponse.json({ error: "gallery item not found" }, { status: 404 });
    }
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
    } catch {
      meta = {};
    }
    if (meta.jobAction !== "lora_i2v") {
      return NextResponse.json(
        { error: "not a lora_i2v item", meta },
        { status: 400 },
      );
    }
    const templateId = String(meta.loraI2vTemplateId || "");
    const characterId = String(item.characterId || meta.characterId || "");
    if (!templateId || !characterId) {
      return NextResponse.json(
        { error: "missing templateId/characterId", meta, characterId: item.characterId },
        { status: 400 },
      );
    }
    const acc = await prisma.platformAccount.findFirst({
      where: { userId: item.userId, platform: "telegram" },
      select: { platformUserId: true },
    });
    const { resumePendingLoraI2vGalleryItem } = await import(
      "@/lib/tg/generation-service"
    );
    await resumePendingLoraI2vGalleryItem({
      galleryItemId: item.id,
      userId: item.userId,
      platformUserId: acc?.platformUserId,
      templateId,
      characterId,
    });
    return NextResponse.json({
      ok: true,
      action: "retry_pending_li2v",
      galleryItemId: item.id,
      templateId,
      characterId,
    });
  }

  if (action === "list_video_templates") {
    const q = typeof body.q === "string" ? body.q.trim() : "";
    const rows = await prisma.quickVideoTemplate.findMany({
      where: {
        tgPublished: true,
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { tgDisplayTitle: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { tgSortOrder: "asc" },
      take: 80,
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
        refVideoUrl: true,
        previewVideoUrl: true,
        pricePeaches: true,
        tgSortOrder: true,
      },
    });
    const lora = await prisma.loraI2vTemplate.findMany({
      where: {
        tgPublished: true,
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { tgDisplayTitle: { contains: q } },
              ],
            }
          : {}),
      },
      take: 40,
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
        previewVideoUrl: true,
        pricePeaches: true,
      },
    });
    return NextResponse.json({
      ok: true,
      action: "list_video_templates",
      quickVideo: rows.map((r) => ({
        ...r,
        display: r.tgDisplayTitle.trim() || r.title,
      })),
      loraI2v: lora.map((r) => ({
        ...r,
        display: r.tgDisplayTitle.trim() || r.title,
      })),
    });
  }

  if (action === "user_recent_gallery") {
    const userId =
      typeof body.userId === "string"
        ? body.userId.trim()
        : "cmtl3bejr0000pc1u1zcy6vg0";
    const items = await prisma.galleryItem.findMany({
      where: { userId, kind: "video" },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        title: true,
        resultUrl: true,
        createdAt: true,
        metaJson: true,
      },
    });
    return NextResponse.json({
      ok: true,
      action: "user_recent_gallery",
      items: items.map((it) => {
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(it.metaJson || "{}") as Record<string, unknown>;
        } catch {
          meta = {};
        }
        return {
          id: it.id,
          title: it.title,
          resultUrl: it.resultUrl,
          createdAt: it.createdAt,
          status: meta.status,
          jobAction: meta.jobAction,
          quickVideoRunId: meta.quickVideoRunId,
          recoveredFromComfy: meta.recoveredFromComfy,
          engine: meta.engine,
        };
      }),
    });
  }

  if (action === "dump_qv_run") {
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!runId) {
      return NextResponse.json({ error: "runId required" }, { status: 400 });
    }
    const run = await prisma.quickVideoRun.findUnique({ where: { id: runId } });
    if (!run) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    let gallery: { title: string; resultUrl: string; metaJson: string } | null =
      null;
    if (run.galleryItemId) {
      gallery = await prisma.galleryItem.findUnique({
        where: { id: run.galleryItemId },
        select: { title: true, resultUrl: true, metaJson: true },
      });
    }
    const poseTemplates = await prisma.quickVideoTemplate.findMany({
      where: {
        OR: [
          { title: { contains: "резин" } },
          { title: { contains: "Прыгает" } },
          { title: { contains: "прыгает" } },
          { tgDisplayTitle: { contains: "резин" } },
          { tgDisplayTitle: { contains: "Прыгает" } },
          { tgDisplayTitle: { contains: "прыгает" } },
        ],
      },
      take: 20,
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
        refVideoUrl: true,
        tgPublished: true,
      },
    });
    const storyMatches = await prisma.quickVideoTemplate.findMany({
      where: {
        OR: [
          { title: { contains: "спор" } },
          { tgDisplayTitle: { contains: "спор" } },
          { title: { contains: "прохож" } },
          { tgDisplayTitle: { contains: "прохож" } },
        ],
      },
      take: 20,
      select: {
        id: true,
        title: true,
        tgDisplayTitle: true,
        refVideoUrl: true,
        tgPublished: true,
      },
    });
    return NextResponse.json({
      ok: true,
      action: "dump_qv_run",
      run: {
        id: run.id,
        userId: run.userId,
        title: run.title,
        status: run.status,
        engine: run.engine,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        resultVideoUrl: run.resultVideoUrl,
        refVideoUrl: run.refVideoUrl,
        prompt: (run.prompt || "").slice(0, 500),
        composedPrompt: (run.composedPrompt || "").slice(0, 1500),
        characterIdsJson: run.characterIdsJson,
        refImageUrls: run.refImageUrlsJson,
      },
      gallery,
      poseTemplates,
      storyMatches,
    });
  }

  if (action === "retry_last_story_h3" || action === "list_recent_qv") {
    const runs = await prisma.quickVideoRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        userId: true,
        title: true,
        status: true,
        error: true,
        createdAt: true,
        composedPrompt: true,
        galleryItemId: true,
        resultVideoUrl: true,
        engine: true,
      },
    });
    const mapped = runs.map((r) => {
      const story =
        (r.title || "").toLowerCase().includes("story") ||
        (r.composedPrompt || "").includes("retention_analysis") ||
        (r.composedPrompt || "").includes("detailed_description:");
      return {
        id: r.id,
        userId: r.userId,
        title: r.title,
        status: r.status,
        error: (r.error || "").slice(0, 200),
        createdAt: r.createdAt,
        story,
        galleryItemId: r.galleryItemId,
        resultVideoUrl: r.resultVideoUrl,
        engine: r.engine,
      };
    });

    if (action === "list_recent_qv") {
      return NextResponse.json({ ok: true, action, runs: mapped });
    }

    const target =
      mapped.find((r) => r.story && (r.status === "error" || r.status === "busy")) ||
      mapped.find((r) => r.story) ||
      mapped.find((r) => r.status === "error" || r.status === "busy");

    if (!target) {
      return NextResponse.json({ error: "no story/error run found", runs: mapped }, { status: 404 });
    }

    const { retryQuickVideoRun } = await import("@/lib/quick-video");
    const run = await retryQuickVideoRun(target.userId, target.id);
    return NextResponse.json({
      ok: true,
      action: "retry_last_story_h3",
      retried: { id: target.id, title: target.title, prevStatus: target.status },
      run,
      recent: mapped.slice(0, 5),
    });
  }

  if (action === "restore_tg") {
    const tgId = String(body.telegramUserId || "978491621");
    const email = `tg_${tgId}@peachbitch.local`;
    const acc = await prisma.platformAccount.findUnique({
      where: {
        platform_platformUserId: { platform: "telegram", platformUserId: tgId },
      },
      include: { user: true },
    });
    if (!acc) {
      return NextResponse.json({ error: "tg account not found", tgId }, { status: 404 });
    }
    // Free email if another row holds the synthetic address.
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.id !== acc.userId) {
      await prisma.user.update({
        where: { id: clash.id },
        data: { email: `clash_${Date.now()}_${clash.email}` },
      });
    }
    const updated = await prisma.user.update({
      where: { id: acc.userId },
      data: { email, source: "telegram" },
    });
    return NextResponse.json({
      ok: true,
      action: "restore_tg",
      userId: updated.id,
      email: updated.email,
      previousEmail: acc.user.email,
    });
  }

  if (action === "set_password" || action === "ensure_owner") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const name = String(body.name || "Admin").trim();
    if (!email) {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "password must be at least 8 chars" }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Do NOT steal telegram accounts. Create a fresh web owner.
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          ageConfirmed: true,
          credits: 100000,
          source: "web",
          adminRole: "owner",
        },
      });
      return NextResponse.json({
        ok: true,
        action: "created_owner",
        userId: user.id,
        email,
      });
    }

    // If this email currently belongs to a TG-linked user, refuse — restore_tg first.
    const tgLink = await prisma.platformAccount.findFirst({
      where: { userId: user.id, platform: "telegram" },
    });
    if (tgLink && user.source === "telegram") {
      return NextResponse.json(
        {
          error: "email_belongs_to_telegram_user",
          hint: "Call restore_tg first, then ensure_owner to create a separate web admin.",
          telegramUserId: tgLink.platformUserId,
        },
        { status: 409 },
      );
    }

    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        name: user.name || name,
        ageConfirmed: true,
        source: "web",
        adminRole: user.adminRole === "owner" ? user.adminRole : "owner",
      },
    });

    const counts = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        _count: { select: { galleryItems: true, characters: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      action: "set_password",
      userId: user.id,
      email: user.email,
      galleryItems: counts?._count.galleryItems ?? 0,
      characters: counts?._count.characters ?? 0,
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
