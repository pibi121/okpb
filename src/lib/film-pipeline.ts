/**
 * Sequential Peach film pipeline: stills → clips → stitch.
 * Stops on failure until the current scene succeeds.
 */
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { backupDatabase, saveGalleryBinary } from "@/lib/local-store";
import { galleryRoot } from "@/lib/paths";
import {
  GALLERY_PLACEHOLDER_URL,
  parseGalleryMeta,
} from "@/lib/gallery-meta";
import {
  filmAspectSize,
  newFilmSeed,
  parseScenes,
  toPublicFilm,
  type FilmScene,
  type PublicFilmProject,
} from "@/lib/film-project";
import {
  composeFilmStillPrompt,
  composeFilmVideoPrompt,
  generateFilmScript,
} from "@/lib/film-screenwriter";
import {
  generatePhotoBytes,
  runI2VFromStillPublic,
  runRef2VClipPublic,
  stitchFilmClips,
} from "@/lib/peach-lab-film";
import { localBytesFromResultUrl } from "@/lib/peach-lab";
import { extractLastFramePng } from "@/lib/ffmpeg-stitch";

async function setBusy(id: string, patch: Record<string, unknown>) {
  return prisma.peachFilmProject.update({
    where: { id },
    data: { status: "busy", error: null, ...patch },
  });
}

async function setIdle(id: string, patch: Record<string, unknown> = {}) {
  return prisma.peachFilmProject.update({
    where: { id },
    data: { status: "idle", ...patch },
  });
}

async function setError(id: string, error: string, scenes?: FilmScene[]) {
  return prisma.peachFilmProject.update({
    where: { id },
    data: {
      status: "error",
      error,
      ...(scenes ? { scenesJson: JSON.stringify(scenes) } : {}),
    },
  });
}

export async function getFilmProject(
  userId: string,
  id: string,
): Promise<PublicFilmProject | null> {
  const row = await prisma.peachFilmProject.findFirst({
    where: { id, userId },
  });
  return row ? toPublicFilm(row) : null;
}

export async function listFilmProjects(userId: string) {
  const rows = await prisma.peachFilmProject.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  return rows.map(toPublicFilm);
}

export async function createFilmProject(
  userId: string,
  opts: {
    mode?: "studio" | "fast";
    idea: string;
    withDialogue?: boolean;
    characterIds?: string[];
    poseIds?: string[];
    sceneCount?: number | null;
    aspect?: string;
    styleId?: string | null;
    durationSec?: number;
  },
) {
  const row = await prisma.peachFilmProject.create({
    data: {
      userId,
      mode: opts.mode === "fast" ? "fast" : "studio",
      step: "idea",
      status: "idle",
      idea: opts.idea.trim(),
      withDialogue: !!opts.withDialogue,
      characterIdsJson: JSON.stringify(opts.characterIds || []),
      poseIdsJson: JSON.stringify(opts.poseIds || []),
      sceneCount: opts.sceneCount ?? null,
      aspect: opts.aspect || "9_16",
      styleId: opts.styleId || null,
      seed: newFilmSeed(),
      durationSec: Math.min(12, Math.max(4, opts.durationSec || 6)),
    },
  });
  return toPublicFilm(row);
}

export async function updateFilmProject(
  userId: string,
  id: string,
  patch: {
    idea?: string;
    withDialogue?: boolean;
    characterIds?: string[];
    poseIds?: string[];
    sceneCount?: number | null;
    aspect?: string;
    styleId?: string | null;
    scenes?: FilmScene[];
    withMusic?: boolean;
    musicNote?: string;
    durationSec?: number;
    step?: string;
  },
) {
  const existing = await prisma.peachFilmProject.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error("project not found");
  if (existing.status === "busy") throw new Error("проект занят — подожди");

  const row = await prisma.peachFilmProject.update({
    where: { id },
    data: {
      ...(patch.idea != null ? { idea: patch.idea } : {}),
      ...(patch.withDialogue != null ? { withDialogue: patch.withDialogue } : {}),
      ...(patch.characterIds ? { characterIdsJson: JSON.stringify(patch.characterIds) } : {}),
      ...(patch.poseIds ? { poseIdsJson: JSON.stringify(patch.poseIds) } : {}),
      ...(patch.sceneCount !== undefined ? { sceneCount: patch.sceneCount } : {}),
      ...(patch.aspect ? { aspect: patch.aspect } : {}),
      ...(patch.styleId !== undefined ? { styleId: patch.styleId } : {}),
      ...(patch.scenes ? { scenesJson: JSON.stringify(patch.scenes) } : {}),
      ...(patch.withMusic != null ? { withMusic: patch.withMusic } : {}),
      ...(patch.musicNote != null ? { musicNote: patch.musicNote } : {}),
      ...(patch.durationSec != null ? { durationSec: patch.durationSec } : {}),
      ...(patch.step ? { step: patch.step } : {}),
      error: null,
    },
  });
  return toPublicFilm(row);
}

async function ensureFolder(projectId: string, userId: string, title: string) {
  const proj = await prisma.peachFilmProject.findUniqueOrThrow({
    where: { id: projectId },
  });
  if (proj.folderItemId) {
    const folder = await prisma.galleryItem.findFirst({
      where: { id: proj.folderItemId, userId },
    });
    if (folder) return folder;
  }
  const folder = await prisma.galleryItem.create({
    data: {
      userId,
      kind: "film_folder",
      title: title || "Мини-фильм",
      prompt: proj.idea.slice(0, 200),
      resultUrl: GALLERY_PLACEHOLDER_URL,
      metaJson: JSON.stringify({
        status: "pending",
        filmProjectId: projectId,
        isFolder: true,
        childIds: [],
      }),
    },
  });
  await prisma.peachFilmProject.update({
    where: { id: projectId },
    data: { folderItemId: folder.id },
  });
  return folder;
}

async function linkChild(folderId: string, childId: string) {
  const folder = await prisma.galleryItem.findUnique({ where: { id: folderId } });
  if (!folder) return;
  const meta = parseGalleryMeta(folder.metaJson);
  const childIds = Array.isArray(meta.childIds)
    ? (meta.childIds as string[])
    : [];
  if (!childIds.includes(childId)) childIds.push(childId);
  await prisma.galleryItem.update({
    where: { id: folderId },
    data: {
      metaJson: JSON.stringify({
        ...meta,
        isFolder: true,
        childIds,
        status: "ready",
      }),
      ...(folder.resultUrl === GALLERY_PLACEHOLDER_URL
        ? {}
        : {}),
    },
  });
}

export async function enqueueFilmAction(
  userId: string,
  projectId: string,
  action:
    | "script"
    | "script_variant"
    | "rescript_count"
    | "shoot_stills"
    | "shoot_clips"
    | "stitch"
    | "regen_still"
    | "regen_clip"
    | "edit_still"
    | "edit_clip"
    | "fast_run"
    | "ref2v_run",
  opts: { sceneIndex?: number; editNote?: string; sceneCount?: number } = {},
) {
  // Mark busy before after() so the client sees it immediately.
  // runFilmAction must NOT treat this as a double-run (that was a race bug).
  await setBusy(projectId, {});

  after(() => {
    void runFilmAction(userId, projectId, action, opts, false).catch(async (e) => {
      console.error("[peach] film action failed:", e);
      await setError(
        projectId,
        e instanceof Error ? e.message : "film action failed",
      );
    });
  });
}

async function runFilmAction(
  userId: string,
  projectId: string,
  action: string,
  opts: { sceneIndex?: number; editNote?: string; sceneCount?: number },
  nested: boolean,
) {
  const proj = await prisma.peachFilmProject.findFirst({
    where: { id: projectId, userId },
  });
  if (!proj) throw new Error("project not found");

  // Top-level calls are already busy from enqueueFilmAction.
  // Nested fast_run steps re-assert busy between phases.
  if (nested) await setBusy(projectId, {});

  try {
    if (action === "script" || action === "script_variant" || action === "rescript_count") {
      const characterIds = JSON.parse(proj.characterIdsJson) as string[];
      const poseIds = JSON.parse(proj.poseIdsJson) as string[];
      const sceneCount =
        action === "rescript_count" && opts.sceneCount != null
          ? opts.sceneCount
          : proj.sceneCount;
      const script = await generateFilmScript({
        idea: proj.idea,
        withDialogue: proj.withDialogue,
        characterIds,
        poseIds,
        sceneCount,
        styleId: proj.styleId,
        variant: action === "script_variant",
      });
      await setIdle(projectId, {
        title: script.title,
        filmBible: script.filmBible,
        scenesJson: JSON.stringify(script.scenes),
        sceneCount: script.scenes.length,
        step: "script",
        error: null,
      });
      if (!nested) return;
      await setBusy(projectId, {});
      return;
    }

    if (action === "fast_run") {
      await runFilmAction(userId, projectId, "script", {}, true);
      await setBusy(projectId, {});
      await runFilmAction(userId, projectId, "shoot_stills", {}, true);
      await setBusy(projectId, {});
      await runFilmAction(userId, projectId, "shoot_clips", {}, true);
      await setBusy(projectId, {});
      await runFilmAction(userId, projectId, "stitch", {}, true);
      return;
    }

    if (action === "ref2v_run") {
      await runFilmAction(userId, projectId, "script", {}, true);
      await setBusy(projectId, {});
      await shootRef2VClips(userId, projectId);
      await setBusy(projectId, {});
      await runFilmAction(userId, projectId, "stitch", {}, true);
      return;
    }

    if (action === "shoot_stills" || action === "regen_still" || action === "edit_still") {
      await shootStills(userId, projectId, {
        ...opts,
        freshSeed: action === "regen_still" || action === "edit_still",
      });
      return;
    }

    if (action === "shoot_clips" || action === "regen_clip" || action === "edit_clip") {
      await shootClips(userId, projectId, opts);
      return;
    }

    if (action === "stitch") {
      await stitchProject(userId, projectId);
      return;
    }

    throw new Error(`unknown action ${action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setError(projectId, msg);
    throw e;
  }
}

async function shootStills(
  userId: string,
  projectId: string,
  opts: { sceneIndex?: number; editNote?: string; freshSeed?: boolean },
) {
  let proj = await prisma.peachFilmProject.findFirstOrThrow({
    where: { id: projectId, userId },
  });
  const characterIds = JSON.parse(proj.characterIdsJson) as string[];
  const aspect = filmAspectSize(proj.aspect);
  const seed = Number(proj.seed) || undefined;
  let scenes = parseScenes(proj.scenesJson);
  const folder = await ensureFolder(projectId, userId, proj.title || "Мини-фильм");

  const indices =
    opts.sceneIndex != null
      ? [opts.sceneIndex]
      : scenes.map((_, i) => i);

  await setIdle(projectId, { step: "storyboard", status: "busy" });

  for (const i of indices) {
    const scene = scenes[i];
    if (!scene) continue;
    scenes[i] = { ...scene, status: "still_pending", error: undefined };
    await prisma.peachFilmProject.update({
      where: { id: projectId },
      data: { scenesJson: JSON.stringify(scenes), status: "busy" },
    });

    try {
      let stillPrompt = await composeFilmStillPrompt({
        filmBible: proj.filmBible,
        synopsis: scene.synopsis,
        dialogue: scene.dialogue,
        characterIds,
        styleId: proj.styleId,
        aspectHint: aspect.label,
        poseId: scene.poseId,
      });
      if (opts.editNote?.trim() && opts.sceneIndex === i) {
        stillPrompt = `${stillPrompt}. Edit: ${opts.editNote.trim()}`;
      }

      const sceneSeed =
        opts.freshSeed || seed == null
          ? Math.floor(Math.random() * 1e12)
          : seed + i * 97;

      const out = await generatePhotoBytes({
        userId,
        characterIds,
        characterId: characterIds[0] || null,
        title: `Film · ${proj.title || "scene"} · ${i + 1}`,
        composedPrompt: stillPrompt,
        width: aspect.width,
        height: aspect.height,
        // First shoot: per-scene offset of project seed. Regen/edit: new noise.
        seed: sceneSeed,
        usePreset: false,
        poseId: scene.poseId,
        negativePrompt:
          "child, underage, extra people, extra woman, extra man, twins, clone, duplicate face, extra limbs, deformed hands, mosaic, censored, blurry",
      });
      const saved = saveGalleryBinary(userId, "png", out.bytes, `film_${projectId}_s${i}`);
      const item = await prisma.galleryItem.create({
        data: {
          userId,
          characterId: characterIds[0] || null,
          kind: "photo",
          title: `Сцена ${i + 1} · кадр`,
          prompt: stillPrompt,
          resultUrl: saved.publicUrl,
          width: out.width,
          height: out.height,
          metaJson: JSON.stringify({
            status: "ready",
            filmProjectId: projectId,
            sceneIndex: i,
            folderId: folder.id,
            localKey: saved.relKey,
            engine: out.engine,
            galleryDir: galleryRoot(),
            poseId: scene.poseId,
            styleId: proj.styleId,
            characterIds,
            userNote: scene.synopsis,
            seed: sceneSeed,
          }),
        },
      });
      await linkChild(folder.id, item.id);
      if (!folder.resultUrl || folder.resultUrl === GALLERY_PLACEHOLDER_URL) {
        await prisma.galleryItem.update({
          where: { id: folder.id },
          data: { resultUrl: saved.publicUrl, thumbUrl: saved.publicUrl },
        });
      }

      scenes[i] = {
        ...scenes[i],
        stillPrompt,
        stillItemId: item.id,
        stillUrl: saved.publicUrl,
        status: "still_ready",
        error: undefined,
      };
      await prisma.peachFilmProject.update({
        where: { id: projectId },
        data: { scenesJson: JSON.stringify(scenes) },
      });
      backupDatabase("film-still");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      scenes[i] = { ...scenes[i], status: "still_error", error: msg };
      await setError(projectId, `Сцена ${i + 1} (кадр): ${msg}`, scenes);
      throw e;
    }
  }

  await setIdle(projectId, {
    scenesJson: JSON.stringify(scenes),
    step: "storyboard",
    error: null,
  });
}

async function shootClips(
  userId: string,
  projectId: string,
  opts: { sceneIndex?: number; editNote?: string },
) {
  const proj = await prisma.peachFilmProject.findFirstOrThrow({
    where: { id: projectId, userId },
  });
  let scenes = parseScenes(proj.scenesJson);
  const folder = await ensureFolder(projectId, userId, proj.title || "Мини-фильм");
  const indices =
    opts.sceneIndex != null
      ? [opts.sceneIndex]
      : scenes.map((_, i) => i);

  for (const i of indices) {
    const scene = scenes[i];
    if (!scene?.stillUrl && !scene?.stillItemId) {
      throw new Error(`Сцена ${i + 1}: сначала нужен кадр`);
    }
    scenes[i] = { ...scene, status: "clip_pending", error: undefined };
    await prisma.peachFilmProject.update({
      where: { id: projectId },
      data: { scenesJson: JSON.stringify(scenes), status: "busy", step: "clips" },
    });

    try {
      const stillItem = scene.stillItemId
        ? await prisma.galleryItem.findFirst({
            where: { id: scene.stillItemId, userId },
          })
        : null;
      const stillBytes = stillItem
        ? localBytesFromResultUrl(stillItem.resultUrl)
        : null;
      if (!stillBytes) throw new Error("still file missing");

      let videoPrompt =
        scene.videoPrompt ||
        (await composeFilmVideoPrompt({
          stillPrompt: scene.stillPrompt || stillItem?.prompt || "",
          synopsis: scene.synopsis,
          dialogue: scene.dialogue,
          durationSec: proj.durationSec,
          poseId: scene.poseId,
        }));
      if (opts.editNote?.trim() && opts.sceneIndex === i) {
        videoPrompt = `${videoPrompt} User edit: ${opts.editNote.trim()}`;
      }

      const out = await runI2VFromStillPublic({
        stillBytes,
        prompt: videoPrompt,
        width: stillItem?.width || 888,
        height: stillItem?.height || 1176,
        filenamePrefix: `peach/stitch/${projectId}/s${String(i + 1).padStart(2, "0")}`,
        withMusic: false,
        durationSec: proj.durationSec,
        extraHints: [scene.synopsis, scene.stillPrompt, scene.dialogue, opts.editNote],
      });

      const saved = saveGalleryBinary(userId, "mp4", out.bytes, `film_${projectId}_c${i}`);
      const item = await prisma.galleryItem.create({
        data: {
          userId,
          kind: "video",
          title: `Сцена ${i + 1} · клип`,
          prompt: videoPrompt,
          sourceUrl: scene.stillUrl || stillItem?.resultUrl,
          resultUrl: saved.publicUrl,
          width: out.size.width,
          height: out.size.height,
          metaJson: JSON.stringify({
            status: "ready",
            filmProjectId: projectId,
            sceneIndex: i,
            folderId: folder.id,
            localKey: saved.relKey,
            engine: out.engine,
            durationSec: out.durationSec,
          }),
        },
      });
      await linkChild(folder.id, item.id);

      scenes[i] = {
        ...scenes[i],
        videoPrompt,
        clipItemId: item.id,
        clipUrl: saved.publicUrl,
        status: "clip_ready",
        error: undefined,
      };
      await prisma.peachFilmProject.update({
        where: { id: projectId },
        data: { scenesJson: JSON.stringify(scenes) },
      });
      backupDatabase("film-clip");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      scenes[i] = { ...scenes[i], status: "clip_error", error: msg };
      await setError(projectId, `Сцена ${i + 1} (видео): ${msg}`, scenes);
      throw e;
    }
  }

  await setIdle(projectId, {
    scenesJson: JSON.stringify(scenes),
    step: "clips",
    error: null,
  });
}

/**
 * Ref2V mode: generate video clips directly from character reference photos.
 * No Krea still generation — each scene goes directly to MiniMax H3 Ref2V.
 * Uses the last frame of the previous clip as a context reference for continuity.
 */
async function shootRef2VClips(userId: string, projectId: string) {
  const proj = await prisma.peachFilmProject.findFirstOrThrow({
    where: { id: projectId, userId },
  });
  const characterIds = JSON.parse(proj.characterIdsJson) as string[];
  const aspect = filmAspectSize(proj.aspect);
  let scenes = parseScenes(proj.scenesJson);
  const folder = await ensureFolder(projectId, userId, proj.title || "Мини-фильм (Ref2V)");

  // Load the best reference portrait photo for each character
  const refPhotoBytes: Buffer[] = [];
  for (const charId of characterIds.slice(0, 4)) {
    const photo = await prisma.galleryItem.findFirst({
      where: {
        userId,
        characterId: charId,
        kind: "photo",
        NOT: { resultUrl: GALLERY_PLACEHOLDER_URL },
      },
      orderBy: { createdAt: "desc" },
    });
    if (photo) {
      const bytes = localBytesFromResultUrl(photo.resultUrl);
      if (bytes?.length) refPhotoBytes.push(bytes);
    }
  }

  await setIdle(projectId, { step: "clips", status: "busy" });

  let prevClipPath: string | null = null;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene) continue;
    scenes[i] = { ...scene, status: "clip_pending", error: undefined };
    await prisma.peachFilmProject.update({
      where: { id: projectId },
      data: { scenesJson: JSON.stringify(scenes), status: "busy" },
    });

    try {
      // Build video prompt: filmBible + synopsis + motion hints
      const videoPrompt = await composeFilmVideoPrompt({
        stillPrompt: [proj.filmBible, scene.synopsis].filter(Boolean).join(". "),
        synopsis: scene.synopsis,
        dialogue: scene.dialogue,
        durationSec: proj.durationSec,
        poseId: scene.poseId,
      });

      // Extract last frame of previous clip for continuity
      let contextFrameBuffer: Buffer | null = null;
      if (prevClipPath) {
        try {
          contextFrameBuffer = await extractLastFramePng(prevClipPath);
        } catch (e) {
          console.warn(`[peach] ref2v: context frame extract failed for scene ${i}:`, e instanceof Error ? e.message : e);
        }
      }

      const out = await runRef2VClipPublic({
        refImageBuffers: refPhotoBytes,
        contextFrameBuffer,
        prompt: videoPrompt,
        width: aspect.width,
        height: aspect.height,
        durationSec: proj.durationSec,
        filenamePrefix: `peach/stitch/${projectId}/s${String(i + 1).padStart(2, "0")}`,
        extraHints: [scene.synopsis, proj.filmBible, scene.dialogue],
      });

      // Remember local path for next scene's context frame
      if (out.videoPath) {
        prevClipPath = out.videoPath;
      }

      const saved = saveGalleryBinary(userId, "mp4", out.bytes, `film_${projectId}_r${i}`);
      const item = await prisma.galleryItem.create({
        data: {
          userId,
          kind: "video",
          title: `Сцена ${i + 1} · Ref2V`,
          prompt: videoPrompt,
          resultUrl: saved.publicUrl,
          width: out.size.width,
          height: out.size.height,
          metaJson: JSON.stringify({
            status: "ready",
            filmProjectId: projectId,
            sceneIndex: i,
            folderId: folder.id,
            localKey: saved.relKey,
            engine: out.engine,
            durationSec: out.durationSec,
            galleryDir: galleryRoot(),
            ref2v: true,
          }),
        },
      });
      await linkChild(folder.id, item.id);

      scenes[i] = {
        ...scenes[i],
        videoPrompt,
        clipItemId: item.id,
        clipUrl: saved.publicUrl,
        status: "clip_ready",
        error: undefined,
      };
      await prisma.peachFilmProject.update({
        where: { id: projectId },
        data: { scenesJson: JSON.stringify(scenes) },
      });
      backupDatabase("film-ref2v");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      scenes[i] = { ...scenes[i], status: "clip_error", error: msg };
      await setError(projectId, `Сцена ${i + 1} (Ref2V): ${msg}`, scenes);
      throw e;
    }
  }

  await setIdle(projectId, {
    scenesJson: JSON.stringify(scenes),
    step: "clips",
    error: null,
  });
}

async function stitchProject(userId: string, projectId: string) {
  const proj = await prisma.peachFilmProject.findFirstOrThrow({
    where: { id: projectId, userId },
  });
  const scenes = parseScenes(proj.scenesJson);
  const clipPaths: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.clipItemId) throw new Error(`Сцена ${i + 1}: нет клипа`);
    const item = await prisma.galleryItem.findFirst({
      where: { id: s.clipItemId, userId },
    });
    if (!item) throw new Error(`Сцена ${i + 1}: клип не найден`);
    const meta = parseGalleryMeta(item.metaJson);
    // Prefer server path from engine meta if present; else local file via stitch helper
    clipPaths.push(item.resultUrl);
  }

  const folder = await ensureFolder(projectId, userId, proj.title || "Мини-фильм");
  const stitched = await stitchFilmClips({
    userId,
    projectId,
    clipResultUrls: clipPaths,
    withMusic: proj.withMusic,
    musicNote: proj.musicNote,
    durationSec: proj.durationSec * scenes.length,
  });

  const item = await prisma.galleryItem.create({
    data: {
      userId,
      kind: "film",
      title: proj.title || "Мини-фильм",
      prompt: proj.idea.slice(0, 300),
      resultUrl: stitched.publicUrl,
      width: stitched.width,
      height: stitched.height,
      metaJson: JSON.stringify({
        status: "ready",
        filmProjectId: projectId,
        folderId: folder.id,
        localKey: stitched.relKey,
        engine: stitched.engine,
        isFinal: true,
      }),
    },
  });
  await linkChild(folder.id, item.id);
  await prisma.galleryItem.update({
    where: { id: folder.id },
    data: {
      resultUrl: stitched.publicUrl,
      metaJson: JSON.stringify({
        ...parseGalleryMeta(
          (await prisma.galleryItem.findUnique({ where: { id: folder.id } }))!
            .metaJson,
        ),
        status: "ready",
        finalFilmId: item.id,
        isFolder: true,
      }),
    },
  });

  await setIdle(projectId, { step: "done", error: null });
  backupDatabase("film-stitch");
}
