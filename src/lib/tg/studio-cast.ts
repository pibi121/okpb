import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";
import { ensureTgBootstrap } from "@/lib/tg/tg-bootstrap";
import { seedCastCoverUrl } from "@/lib/tg/tg-catalog-seed";
import {
  TG_STUDIO_CAST_NAMES,
  TG_STUDIO_CAST_SPEC,
  TG_STUDIO_CAST_TRIGGERS,
} from "@/lib/tg/tg-launch-constants";
import { tgCastDisplayName } from "@/lib/tg/tg-publish";
import { resolveTgCatalogAssetUrl } from "@/lib/tg/catalog-asset-url";
import { studioCastCoverUrl } from "@/lib/tg/tg-static-previews";
import { galleryRoot } from "@/lib/paths";

export { castsMiniAppUrl, tgMiniAppUrl } from "@/lib/tg/miniapp-url";

/** Cover copied at publish time: cast-{id10}.ext on volume (media API). */
function castCoverFromDisk(characterId: string): string | null {
  const slug = `cast-${characterId.slice(0, 10)}`;
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const name = `${slug}${ext}`;
    const vol = path.join(galleryRoot(), "tg-catalog", name);
    if (fs.existsSync(vol)) return `/api/media/tg-catalog/${name}`;
    // Do not return /tg/catalog for runtime casts — Next won't serve post-build public writes.
  }
  return null;
}

function catalogAssetExists(url: string): boolean {
  const name =
    url.match(/\/(?:tg\/catalog|api\/media\/tg-catalog)\/([^/?#]+)/i)?.[1] ||
    "";
  if (!name) return false;
  const pub = path.join(process.cwd(), "public", "tg", "catalog", name);
  if (fs.existsSync(pub)) return true;
  return fs.existsSync(path.join(galleryRoot(), "tg-catalog", name));
}

/** Pick a cover path that Mini App can load (prefer static seed / catalog). */
export function resolveStudioCastCoverUrl(ch: {
  id?: string;
  triggerWord?: string | null;
  tgCoverUrl?: string | null;
  name?: string;
}): string | null {
  const seed =
    seedCastCoverUrl(ch.triggerWord) || studioCastCoverUrl(ch.triggerWord);
  const custom = ch.tgCoverUrl?.trim() || "";

  if (custom) {
    const resolved = resolveTgCatalogAssetUrl(custom);
    if (
      resolved.startsWith("/tg/catalog/") ||
      resolved.startsWith("/api/media/tg-catalog/") ||
      resolved.startsWith("/tg/previews/") ||
      resolved.startsWith("/api/media/")
    ) {
      // Seeds / previews / volume media. For cast-* always prefer media API path
      // even if a stale public/ copy exists (Next won't serve runtime public writes).
      const name =
        resolved.match(
          /\/(?:tg\/catalog|api\/media\/tg-catalog)\/([^/?#]+)/i,
        )?.[1] || "";
      if (/^cast-/i.test(name) && catalogAssetExists(resolved)) {
        return `/api/media/tg-catalog/${name}`;
      }
      if (
        resolved.startsWith("/tg/previews/") ||
        catalogAssetExists(resolved)
      ) {
        return resolved;
      }
    }
  }

  if (ch.id) {
    const fromDisk = castCoverFromDisk(ch.id);
    if (fromDisk) return fromDisk;
  }

  return seed || null;
}

/** Real Krea LoRA on GPU — not lookbook-only and not mock. */
export function hasRealCharacterLora(ch: {
  loraStatus?: string;
  triggerWord?: string | null;
  loraPath?: string | null;
  name?: string;
}): boolean {
  if (ch.loraStatus !== "lora_ready" || !ch.triggerWord?.trim()) return false;
  const loraPath = (ch.loraPath || "").trim();
  if (loraPath && !loraPath.startsWith("mock://")) return true;
  if (ch.name && TG_STUDIO_CAST_NAMES.includes(ch.name)) return true;
  if (ch.triggerWord && TG_STUDIO_CAST_TRIGGERS.includes(ch.triggerWord)) return true;
  return ch.triggerWord === "olh_person";
}

/**
 * User-trained GPU LoRA (not studio cast, not mock://).
 * For these, prompts must rely on the trigger+weights — never emptyLookbook defaults.
 */
export function isUserTrainedRealLora(ch: {
  isStudioCast?: boolean;
  loraStatus?: string;
  triggerWord?: string | null;
  loraPath?: string | null;
}): boolean {
  if (ch.isStudioCast) return false;
  if (ch.loraStatus !== "lora_ready" || !ch.triggerWord?.trim()) return false;
  const loraPath = (ch.loraPath || "").trim();
  return Boolean(loraPath && !loraPath.startsWith("mock://"));
}

/** Paid/finished in Mini App but never got a real GPU LoRA file. */
export function isMockCharacterLora(ch: {
  loraStatus?: string;
  loraPath?: string | null;
}): boolean {
  return (
    ch.loraStatus === "lora_ready" &&
    Boolean((ch.loraPath || "").trim().startsWith("mock://"))
  );
}

async function findStudioCastCandidates() {
  const rows = await prisma.character.findMany({
    where: { isStudioCast: true, loraStatus: "lora_ready" },
    orderBy: { updatedAt: "desc" },
  });

  const out: typeof rows = [];
  const seen = new Set<string>();

  // Prefer one row per known house LoRA (Daisy / Masha / Lora).
  for (const spec of TG_STUDIO_CAST_SPEC) {
    const matches = rows.filter(
      (r) => r.triggerWord && spec.triggers.includes(r.triggerWord),
    );
    if (!matches.length) continue;
    const hit = [...matches].sort((a, b) => {
      const score = (c: typeof a) =>
        (c.tgDisplayName?.trim() ? 4 : 0) +
        (c.tgCoverUrl?.trim() ? 2 : 0) +
        (c.updatedAt.getTime() / 1e12);
      return score(b) - score(a);
    })[0]!;
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      out.push(hit);
    }
  }

  // Extra studio casts (e.g. Nastya) not in the fixed SPEC list.
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    if (!hasRealCharacterLora(r)) continue;
    seen.add(r.id);
    out.push(r);
  }

  return out;
}

/** Mark house LoRA models; unmark everything else. */
export async function ensureStudioCasts(): Promise<void> {
  await ensureTgBootstrap();
  const candidates = await findStudioCastCandidates();
  const realIds = new Set<string>();

  for (const ch of candidates) {
    if (!hasRealCharacterLora(ch)) continue;
    realIds.add(ch.id);
    const patch: { isStudioCast: boolean; loraPath?: string } = {
      isStudioCast: true,
    };
    if (ch.loraPath?.startsWith("mock://") && ch.triggerWord === "olh_person") {
      patch.loraPath = "krea2/olh_person_krea2.safetensors";
    }
    if (!ch.isStudioCast || patch.loraPath) {
      await prisma.character.update({ where: { id: ch.id }, data: patch });
    }
  }

  const stale = await prisma.character.findMany({
    where: { isStudioCast: true, id: { notIn: [...realIds] } },
  });
  for (const s of stale) {
    await prisma.character.update({
      where: { id: s.id },
      data: { isStudioCast: false },
    });
  }
}

export async function listStudioCasts(_locale: "ru" | "en" = "ru") {
  // Avoid heavy ensureStudioCasts on every Mini App /me — casts already seeded in prod.
  const candidates = await findStudioCastCandidates();
  const out: Array<{ id: string; name: string; coverUrl: string | null }> = [];

  for (const ch of candidates) {
    if (!hasRealCharacterLora(ch)) continue;
    const spec = TG_STUDIO_CAST_SPEC.find(
      (s) =>
        s.names.includes(ch.name) ||
        (ch.triggerWord && s.triggers.includes(ch.triggerWord)),
    );
    const rawCover = resolveStudioCastCoverUrl(ch);
    const coverUrl = rawCover || null;
    const version = ch.updatedAt.getTime();
    out.push({
      id: ch.id,
      name: tgCastDisplayName({
        name: spec?.displayName || ch.name,
        tgDisplayName: ch.tgDisplayName,
      }),
      coverUrl: coverUrl
        ? `${coverUrl}${coverUrl.includes("?") ? "&" : "?"}v=${version}`
        : null,
    });
  }

  return out;
}

export async function getStudioCast(characterId: string) {
  await ensureStudioCasts();
  const ch = await prisma.character.findFirst({
    where: {
      id: characterId,
      isStudioCast: true,
      loraStatus: "lora_ready",
    },
  });
  if (!ch || !hasRealCharacterLora(ch)) return null;
  return ch;
}

export function isStudioCastCharacter(ch: { isStudioCast?: boolean }): boolean {
  return Boolean(ch.isStudioCast);
}

export function characterUsesLoraPhoto(ch: {
  isStudioCast?: boolean;
  loraStatus?: string;
  triggerWord?: string | null;
  loraPath?: string | null;
  name?: string;
}): boolean {
  if (isStudioCastCharacter(ch)) return hasRealCharacterLora(ch);
  return ch.loraStatus === "lora_ready" && hasRealCharacterLora(ch);
}
