import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** restart_lora waits for upload/SSH start */
export const maxDuration = 900;

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

    if (action === "lab_add_photo") {
      const characterId = String(form.get("characterId") || "").trim();
      const file = form.get("file");
      if (!characterId || !(file instanceof File) || file.size < 50) {
        return NextResponse.json({ error: "characterId+file required" }, { status: 400 });
      }
      if (file.size > 25 * 1024 * 1024) {
        return NextResponse.json({ error: "file too large" }, { status: 400 });
      }
      const ch = await prisma.character.findUnique({ where: { id: characterId } });
      if (!ch) return NextResponse.json({ error: "character not found" }, { status: 404 });
      const { saveCharacterPhoto, listCharacterPhotos } = await import(
        "@/lib/character-dataset"
      );
      const name = (file instanceof File ? file.name : "photo.jpg") || "photo.jpg";
      const buf = Buffer.from(await file.arrayBuffer());
      // Lab overnight seed — intentionally skip age-gate.
      saveCharacterPhoto(characterId, name, buf, ch.triggerWord);
      const photos = listCharacterPhotos(characterId);
      await prisma.character.update({
        where: { id: characterId },
        data: { photoCount: photos.length },
      });
      return NextResponse.json({
        ok: true,
        action: "lab_add_photo",
        characterId,
        photoCount: photos.length,
        bytes: buf.length,
      });
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

  if (action === "probe_age_gate") {
    const { spawnSync } = await import("node:child_process");
    // Do NOT re-enable age-gate here — probe is read-only diagnostics.
    const bins = ["python3", "python", "/mise/shims/python3", "/mise/shims/python"];
    const found: Array<{ bin: string; version?: string; cv2?: string; error?: string }> = [];
    for (const bin of bins) {
      const v = spawnSync(bin, ["-V"], { encoding: "utf8", timeout: 8000 });
      if (v.error || v.status !== 0) continue;
      const cv = spawnSync(
        bin,
        ["-c", "import cv2,numpy; print(cv2.__version__)"],
        { encoding: "utf8", timeout: 60_000 },
      );
      found.push({
        bin,
        version: (v.stdout || v.stderr || "").trim(),
        cv2: (cv.stdout || "").trim() || undefined,
        error: cv.status === 0 ? undefined : (cv.stderr || "").slice(0, 240),
      });
    }

    // 1x1 jpeg is too small; use a tiny valid JPEG with no face → should not block.
    const tinyJpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z",
      "base64",
    );
    const { checkImageBufferAgeGate, getAgeGateConfig } = await import("@/lib/age-gate");
    const cfg = await getAgeGateConfig();
    const sample = await checkImageBufferAgeGate(tinyJpeg, cfg);
    return NextResponse.json({
      ok: true,
      action: "probe_age_gate",
      python: found,
      config: cfg,
      sample,
      scriptExists: fs.existsSync(path.join(process.cwd(), "scripts", "age-gate-check.py")),
    });
  }

  if (action === "set_age_gate") {
    const { saveOpsSettings, invalidateOpsSettings } = await import("@/lib/ops/settings");
    const enabled = body.enabled === true;
    const failClosed = body.failClosed === true;
    const blockBuckets =
      typeof body.blockBuckets === "string" && body.blockBuckets.trim()
        ? body.blockBuckets.trim()
        : "(0-2),(4-6),(8-12),(15-20)";
    await saveOpsSettings({
      ageGateEnabled: enabled,
      ageGateJson: JSON.stringify({
        blockBuckets,
        faceThresh: typeof body.faceThresh === "number" ? body.faceThresh : 0.6,
        minScore: typeof body.minScore === "number" ? body.minScore : 0.55,
        failClosed,
      }),
    });
    invalidateOpsSettings();
    const { getAgeGateConfig } = await import("@/lib/age-gate");
    return NextResponse.json({
      ok: true,
      action: "set_age_gate",
      config: await getAgeGateConfig(),
    });
  }

  if (action === "user_recent_all_gallery") {
    const userId = String(body.userId || "").trim();
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const take = Math.min(40, Math.max(5, Number(body.take) || 25));
    const items = await prisma.galleryItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        kind: true,
        title: true,
        resultUrl: true,
        createdAt: true,
        metaJson: true,
        characterId: true,
      },
    });
    const jobs = await prisma.gpuJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        kind: true,
        error: true,
        createdAt: true,
        finishedAt: true,
        stage: true,
        refType: true,
        refId: true,
      },
    });
    return NextResponse.json({
      ok: true,
      action: "user_recent_all_gallery",
      items: items.map((it) => {
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(it.metaJson || "{}") as Record<string, unknown>;
        } catch {
          meta = {};
        }
        return {
          id: it.id,
          kind: it.kind,
          title: it.title,
          resultUrl: it.resultUrl,
          characterId: it.characterId,
          createdAt: it.createdAt,
          status: meta.status,
          error: meta.error,
          jobAction: meta.jobAction,
        };
      }),
      jobs,
    });
  }

  if (action === "retry_gallery_item") {
    const galleryItemId = String(body.galleryItemId || "").trim();
    if (!galleryItemId) {
      return NextResponse.json({ error: "galleryItemId required" }, { status: 400 });
    }
    const item = await prisma.galleryItem.findUnique({ where: { id: galleryItemId } });
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(item.metaJson || "{}") as Record<string, unknown>;
    } catch {
      meta = {};
    }
    await prisma.galleryItem.update({
      where: { id: item.id },
      data: {
        metaJson: JSON.stringify({
          ...meta,
          status: "pending",
          error: undefined,
          retriedAt: new Date().toISOString(),
          retryNote: "bootstrap retry_gallery_item",
        }),
      },
    });
    return NextResponse.json({
      ok: true,
      action: "retry_gallery_item",
      galleryItemId: item.id,
      note: "marked pending — re-run generate in UI (in-memory queue does not survive restart)",
    });
  }

  if (action === "find_character") {
    const q = String((body as { q?: string }).q || body.name || "").trim();
    if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
    const rows = await prisma.character.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { triggerWord: { contains: q } },
          { id: { contains: q } },
        ],
      },
      select: {
        id: true,
        name: true,
        triggerWord: true,
        loraStatus: true,
        loraPath: true,
        userId: true,
        updatedAt: true,
        createdAt: true,
        isStudioCast: true,
        videoRefOnly: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const byUser = new Map(users.map((u) => [u.id, u]));
    const {
      characterImagesDir,
      characterTrainMetaPath,
      listCharacterPhotos,
      readTrainMeta,
    } = await import("@/lib/character-dataset");
    const enriched = rows.map((r) => {
      let photoCount = 0;
      try {
        photoCount = listCharacterPhotos(r.id).length;
      } catch {
        try {
          const dir = characterImagesDir(r.id);
          if (fs.existsSync(dir)) {
            photoCount = fs
              .readdirSync(dir)
              .filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).length;
          }
        } catch {
          /* ignore */
        }
      }
      return {
        ...r,
        updatedAt: r.updatedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        user: byUser.get(r.userId) || null,
        photoCount,
        trainMetaPath: characterTrainMetaPath(r.id),
        trainMeta: readTrainMeta(r.id),
      };
    });
    return NextResponse.json({ ok: true, action: "find_character", q, rows: enriched });
  }

  if (action === "restart_lora") {
    const q = String((body as { q?: string }).q || body.name || "").trim();
    if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
    const row = await prisma.character.findFirst({
      where: {
        OR: [
          { name: { equals: q } },
          { name: { contains: q } },
          { triggerWord: { contains: q } },
          { id: { equals: q } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) return NextResponse.json({ error: "character not found", q }, { status: 404 });

    const { metalnodeCheck } = await import("@/lib/metalnode-ssh");
    const check = await metalnodeCheck();
    if (!check.ok) {
      return NextResponse.json(
        { error: "metalnode_unreachable", detail: check.detail, characterId: row.id },
        { status: 503 },
      );
    }

    const { startKreaLoraTrain } = await import("@/lib/krea-lora-train");
    const { readTrainMeta } = await import("@/lib/character-dataset");
    try {
      const started = await startKreaLoraTrain({
        userId: row.userId,
        characterId: row.id,
        triggerWord: row.triggerWord || row.name,
        force: true,
      });
      // Wait until upload/SSH reaches training or error (bg job).
      let trainMeta = readTrainMeta(row.id);
      for (let i = 0; i < 90; i++) {
        if (
          trainMeta.status === "training" ||
          trainMeta.status === "error" ||
          trainMeta.status === "ready"
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
        trainMeta = readTrainMeta(row.id);
      }
      const ok = trainMeta.status === "training" || trainMeta.status === "ready";
      return NextResponse.json({
        ok,
        action: "restart_lora",
        character: {
          id: row.id,
          name: row.name,
          triggerWord: row.triggerWord,
          loraStatus: ok ? "lora_training" : row.loraStatus,
        },
        started,
        trainMeta,
        ssh: check.detail,
        error: ok ? undefined : trainMeta.error || "train did not reach running state",
      }, { status: ok ? 200 : 500 });
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : String(e),
          characterId: row.id,
          trainMeta: readTrainMeta(row.id),
          ssh: check.detail,
        },
        { status: 400 },
      );
    }
  }

  if (action === "disk_stats" || action === "free_disk" || action === "purge_videos") {
    const { freeGalleryDisk, getDiskStats } = await import("@/lib/disk-hygiene");
    const { dataRoot } = await import("@/lib/paths");
    const root = dataRoot();

    if (action === "disk_stats") {
      const stats = getDiskStats();
      return NextResponse.json({
        ok: true,
        action,
        root,
        df: stats.df,
        beforeBytes: stats.bytes,
        afterBytes: stats.bytes,
        deleted: 0,
        freed: 0,
        files: stats.files,
        largest: stats.largest,
      });
    }

    const emergency = action === "purge_videos";
    const result = freeGalleryDisk({
      emergency,
      targetFreeMb: emergency ? 120 : 80,
    });
    try {
      await prisma.$executeRawUnsafe("VACUUM");
    } catch (e) {
      console.error("[bootstrap] VACUUM failed", e);
    }

    return NextResponse.json({
      ok: true,
      action,
      root,
      df: result.df,
      beforeBytes: result.beforeBytes,
      afterBytes: result.afterBytes,
      deleted: result.deleted,
      freed: result.freed,
      files: 0,
      largest: [],
    });
  }

  if (action === "fail_placeholder_ready") {
    const rows = await prisma.galleryItem.findMany({
      select: { id: true, metaJson: true, resultUrl: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    });
    let fixed = 0;
    for (const row of rows) {
      const isPh =
        !row.resultUrl?.trim() ||
        row.resultUrl === "/api/peach/gallery/placeholder" ||
        row.resultUrl.startsWith("data:image/svg");
      if (!isPh) continue;
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(row.metaJson || "{}") as Record<string, unknown>;
      } catch {
        meta = {};
      }
      if (meta.status === "error") continue;
      await prisma.galleryItem.update({
        where: { id: row.id },
        data: {
          metaJson: JSON.stringify({
            ...meta,
            status: "error",
            error:
              "Файл не сохранился — на сервере закончилось место. Запусти генерацию ещё раз.",
          }),
        },
      });
      fixed += 1;
    }
    return NextResponse.json({ ok: true, action: "fail_placeholder_ready", fixed });
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

  if (action === "repair_tg_video_previews") {
    const { repairMissingTgVideoPreviews } = await import(
      "@/lib/tg/repair-tg-video-previews"
    );
    const result = await repairMissingTgVideoPreviews({ force: true });
    return NextResponse.json({
      ok: true,
      action: "repair_tg_video_previews",
      ...result,
    });
  }

  if (action === "set_tg_video_preview") {
    const kind = String(body.kind || "video").trim(); // video | lora_i2v
    const id = String(body.id || body.templateId || "").trim();
    const videoUrl = String(body.videoUrl || body.url || "").trim();
    if (!id || !videoUrl) {
      return NextResponse.json(
        { error: "id + videoUrl required" },
        { status: 400 },
      );
    }
    const { resolveVideoLocalPath } = await import(
      "@/lib/quick-video-template-preview"
    );
    const { copyAssetToTgCatalog } = await import("@/lib/tg/tg-publish");
    if (!resolveVideoLocalPath(videoUrl)) {
      return NextResponse.json(
        { error: "videoUrl file not found on disk", videoUrl },
        { status: 404 },
      );
    }
    if (kind === "lora_i2v") {
      const slug = `li2v-${id.slice(0, 10)}`;
      const previewVideoUrl = copyAssetToTgCatalog(
        videoUrl,
        `${slug}-preview`,
        ".mp4",
      );
      const updated = await prisma.loraI2vTemplate.update({
        where: { id },
        data: {
          previewVideoUrl: previewVideoUrl || videoUrl,
          tgPublished: true,
        },
      });
      return NextResponse.json({
        ok: true,
        action,
        kind,
        id,
        previewVideoUrl: updated.previewVideoUrl,
      });
    }
    const slug = `qv-${id.slice(0, 10)}`;
    const previewVideoUrl = copyAssetToTgCatalog(
      videoUrl,
      `${slug}-preview`,
      ".mp4",
    );
    const { ensureTemplatePreviewPhoto } = await import(
      "@/lib/quick-video-template-preview"
    );
    const row = await prisma.quickVideoTemplate.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    await prisma.quickVideoTemplate.update({
      where: { id },
      data: {
        previewVideoUrl: previewVideoUrl || videoUrl,
        refVideoUrl: row.refVideoUrl || videoUrl,
      },
    });
    const thumb = await ensureTemplatePreviewPhoto(
      {
        id,
        userId: row.userId,
        previewVideoUrl: previewVideoUrl || videoUrl,
        previewPhotoUrl: "",
      },
      { force: true, atSec: 1 },
    );
    const previewPhotoUrl = thumb
      ? copyAssetToTgCatalog(thumb, `${slug}-frame-thumb`, ".png")
      : "";
    const updated = await prisma.quickVideoTemplate.update({
      where: { id },
      data: {
        previewPhotoUrl: previewPhotoUrl || thumb || "",
        tgPublished: true,
      },
    });
    return NextResponse.json({
      ok: true,
      action,
      kind: "video",
      id,
      previewVideoUrl: updated.previewVideoUrl,
      previewPhotoUrl: updated.previewPhotoUrl,
    });
  }

  if (action === "unpublish_broken_tg_video_previews") {
    const { resolveVideoLocalPath } = await import(
      "@/lib/quick-video-template-preview"
    );
    const quick = await prisma.quickVideoTemplate.findMany({
      where: { tgPublished: true },
      select: { id: true, title: true, tgDisplayTitle: true, previewVideoUrl: true },
    });
    const lora = await prisma.loraI2vTemplate.findMany({
      where: { tgPublished: true },
      select: { id: true, title: true, tgDisplayTitle: true, previewVideoUrl: true },
    });
    const unpublished: string[] = [];
    for (const row of quick) {
      if (resolveVideoLocalPath(row.previewVideoUrl || "")) continue;
      await prisma.quickVideoTemplate.update({
        where: { id: row.id },
        data: { tgPublished: false },
      });
      unpublished.push(row.tgDisplayTitle.trim() || row.title);
    }
    for (const row of lora) {
      if (resolveVideoLocalPath(row.previewVideoUrl || "")) continue;
      await prisma.loraI2vTemplate.update({
        where: { id: row.id },
        data: { tgPublished: false },
      });
      unpublished.push(row.tgDisplayTitle.trim() || row.title);
    }
    return NextResponse.json({
      ok: true,
      action: "unpublish_broken_tg_video_previews",
      unpublished,
    });
  }

  if (action === "inspect_video_template") {
    const id = String(body.id || body.templateId || "").trim();
    const q = String(body.q || "").trim();
    const { resolveVideoLocalPath } = await import(
      "@/lib/quick-video-template-preview"
    );
    const rows = id
      ? await prisma.quickVideoTemplate.findMany({ where: { id }, take: 1 })
      : await prisma.quickVideoTemplate.findMany({
          where: {
            OR: [
              { title: { contains: q || "спор" } },
              { tgDisplayTitle: { contains: q || "спор" } },
            ],
          },
          take: 5,
        });
    const out = [];
    for (const row of rows) {
      const run = row.sourceRunId
        ? await prisma.quickVideoRun.findUnique({
            where: { id: row.sourceRunId },
            select: {
              id: true,
              title: true,
              status: true,
              resultVideoUrl: true,
              refVideoUrl: true,
              galleryItemId: true,
            },
          })
        : null;
      const gal = run?.galleryItemId
        ? await prisma.galleryItem.findUnique({
            where: { id: run.galleryItemId },
            select: { id: true, resultUrl: true, title: true },
          })
        : null;
      const urls = [
        row.previewVideoUrl,
        row.refVideoUrl,
        run?.resultVideoUrl,
        run?.refVideoUrl,
        gal?.resultUrl,
      ].filter(Boolean) as string[];
      out.push({
        id: row.id,
        title: row.title,
        tgDisplayTitle: row.tgDisplayTitle,
        tgPublished: row.tgPublished,
        sourceRunId: row.sourceRunId,
        previewVideoUrl: row.previewVideoUrl,
        refVideoUrl: row.refVideoUrl,
        run,
        gal,
        local: urls.map((url) => ({
          url,
          exists: Boolean(resolveVideoLocalPath(url)),
        })),
      });
    }
    const lora = q
      ? await prisma.loraI2vTemplate.findMany({
          where: {
            OR: [
              { title: { contains: q } },
              { tgDisplayTitle: { contains: q } },
            ],
          },
          take: 5,
        })
      : [];
    return NextResponse.json({
      ok: true,
      action: "inspect_video_template",
      quick: out,
      lora: lora.map((r) => ({
        id: r.id,
        title: r.title,
        tgDisplayTitle: r.tgDisplayTitle,
        previewVideoUrl: r.previewVideoUrl,
        sourceVideoId: r.sourceVideoId,
        exists: Boolean(resolveVideoLocalPath(r.previewVideoUrl)),
      })),
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

  // ——— Lab overnight seed helpers (skip age-gate; not TG-published) ———
  if (action === "lab_create_character") {
    const userId = String(body.userId || "").trim();
    const name = String(body.name || "").trim();
    const triggerWord = String(body.triggerWord || name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
    const gender = body.gender === "male" ? "male" : "female";
    if (!userId || !name || !triggerWord) {
      return NextResponse.json({ error: "userId+name required" }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

    const existing = await prisma.character.findFirst({
      where: {
        userId,
        OR: [{ triggerWord }, { name }],
        isStudioCast: false,
        videoRefOnly: false,
      },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      const updated = await prisma.character.update({
        where: { id: existing.id },
        data: {
          name,
          triggerWord,
          gender,
          consentGiven: true,
          isStudioCast: false,
          videoRefOnly: false,
        },
      });
      return NextResponse.json({
        ok: true,
        action: "lab_create_character",
        reused: true,
        character: {
          id: updated.id,
          name: updated.name,
          triggerWord: updated.triggerWord,
          loraStatus: updated.loraStatus,
          loraPath: updated.loraPath,
        },
      });
    }

    const { suggestedLookbook } = await import("@/lib/lookbook");
    const created = await prisma.character.create({
      data: {
        userId,
        name,
        gender,
        consentGiven: true,
        photoCount: 0,
        status: "draft",
        loraStatus: "none",
        triggerWord,
        isStudioCast: false,
        videoRefOnly: false,
        lookbookJson: JSON.stringify(suggestedLookbook(gender)),
      },
    });
    const { ensureCharacterDirs } = await import("@/lib/character-dataset");
    ensureCharacterDirs(created.id);
    return NextResponse.json({
      ok: true,
      action: "lab_create_character",
      reused: false,
      character: {
        id: created.id,
        name: created.name,
        triggerWord: created.triggerWord,
        loraStatus: created.loraStatus,
      },
    });
  }

  if (action === "lab_set_ready_lora") {
    const userId = String(body.userId || "").trim();
    const name = String(body.name || "").trim();
    const triggerWord = String(body.triggerWord || name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
    const loraPath = String(body.loraPath || "").trim().replace(/^\/+/, "");
    if (!userId || !name || !triggerWord || !loraPath) {
      return NextResponse.json(
        { error: "userId+name+triggerWord+loraPath required" },
        { status: 400 },
      );
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

    const existing = await prisma.character.findFirst({
      where: {
        userId,
        OR: [{ triggerWord }, { name }],
        isStudioCast: false,
        videoRefOnly: false,
      },
      orderBy: { updatedAt: "desc" },
    });
    const { suggestedLookbook } = await import("@/lib/lookbook");
    const data = {
      name,
      triggerWord,
      gender: "female" as const,
      consentGiven: true,
      photoCount: Math.max(existing?.photoCount || 0, 10),
      status: "ready",
      loraStatus: "lora_ready",
      loraPath,
      isStudioCast: false,
      videoRefOnly: false,
      lookbookJson: JSON.stringify(suggestedLookbook("female")),
    };
    const row = existing
      ? await prisma.character.update({ where: { id: existing.id }, data })
      : await prisma.character.create({ data: { userId, ...data } });
    return NextResponse.json({
      ok: true,
      action: "lab_set_ready_lora",
      character: {
        id: row.id,
        name: row.name,
        triggerWord: row.triggerWord,
        loraPath: row.loraPath,
        loraStatus: row.loraStatus,
      },
    });
  }

  if (action === "lab_start_train") {
    const characterId = String(body.characterId || "").trim();
    const force = body.force !== false;
    if (!characterId) {
      return NextResponse.json({ error: "characterId required" }, { status: 400 });
    }
    const row = await prisma.character.findUnique({ where: { id: characterId } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    try {
      const { metalnodeCheck } = await import("@/lib/metalnode-ssh");
      const check = await metalnodeCheck();
      if (!check.ok) {
        return NextResponse.json(
          { error: "metalnode_unreachable", detail: check.detail },
          { status: 503 },
        );
      }
      const { startKreaLoraTrain } = await import("@/lib/krea-lora-train");
      const { readTrainMeta, listCharacterPhotos } = await import("@/lib/character-dataset");
      const started = await startKreaLoraTrain({
        userId: row.userId,
        characterId: row.id,
        triggerWord: row.triggerWord || undefined,
        force,
        skipAgeGate: true,
      });
      return NextResponse.json({
        ok: true,
        action: "lab_start_train",
        characterId: row.id,
        photos: listCharacterPhotos(row.id).length,
        started,
        trainMeta: readTrainMeta(row.id),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string })?.code;
      console.error("[bootstrap] lab_start_train", msg);
      return NextResponse.json(
        { error: "lab_start_train_failed", detail: msg, code: code || null },
        { status: 500 },
      );
    }
  }

  if (action === "lab_train_status") {
    const characterId = String(body.characterId || "").trim();
    if (!characterId) {
      return NextResponse.json({ error: "characterId required" }, { status: 400 });
    }
    const row = await prisma.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        triggerWord: true,
        loraStatus: true,
        loraPath: true,
        photoCount: true,
        userId: true,
      },
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    try {
      const { refreshKreaLoraTrainStatus } = await import("@/lib/krea-lora-train");
      await refreshKreaLoraTrainStatus({ userId: row.userId, characterId: row.id });
    } catch (e) {
      console.error("[bootstrap] refresh train", e);
    }
    const fresh = await prisma.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        triggerWord: true,
        loraStatus: true,
        loraPath: true,
        photoCount: true,
      },
    });
    const { readTrainMeta, listCharacterPhotos } = await import("@/lib/character-dataset");
    return NextResponse.json({
      ok: true,
      action: "lab_train_status",
      character: fresh,
      photos: listCharacterPhotos(characterId).length,
      trainMeta: readTrainMeta(characterId),
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
