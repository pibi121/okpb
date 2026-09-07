/**
 * Quick video templates: one-time purchase, unlimited use (generation billed separately).
 */
import { prisma } from "@/lib/db";
import {
  parseQuickVideoShotsPlan,
  serializeQuickVideoShotsPlan,
  type QuickVideoImageSlot,
  type QuickVideoSlotRole,
} from "@/lib/quick-video-prompt";
import { filterDbCharacterIds } from "@/lib/quick-video-custom-character";
import { sanitizeVideoLegoQuery } from "@/lib/template-scene";
import { isSafeVideoTemplateThumb } from "@/lib/quick-video-preview-safe";

export type TemplateCategory = "peach" | "bitch";

export type TemplateSlotBlueprint = {
  role: QuickVideoSlotRole;
  label?: string;
  /** Baked into template (location default, anatomy, pose, …). */
  bakedRefUrl?: string;
  /** Original 1-based Picture index from the source run (Story H3 / Ref2V). */
  pictureIndex?: number;
};

export type PublicQuickVideoTemplate = {
  id: string;
  title: string;
  notes: string;
  category: TemplateCategory;
  isJuice: boolean;
  priceCredits: number;
  identityPersonCount: number;
  hasLocationSlot: boolean;
  previewVideoUrl: string;
  previewPhotoUrl: string;
  orientation: string;
  durationSec: number;
  owned: boolean;
  isAuthor: boolean;
  tgPublished?: boolean;
  tgDisplayTitle?: string;
};

export type QuickVideoTemplateDetail = PublicQuickVideoTemplate & {
  shotsJson: string;
  slotBlueprint: TemplateSlotBlueprint[];
  defaultLocationUrl: string;
  refVideoUrl: string;
};

function parseBlueprint(raw: string): TemplateSlotBlueprint[] {
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j.filter((row) => row && typeof row.role === "string");
  } catch {
    return [];
  }
}

function slotRoleOf(
  slot: QuickVideoImageSlot | undefined,
): QuickVideoSlotRole {
  const r = slot?.role || slot?.kind;
  if (r === "identity" || r === "extra") {
    return r === "identity" ? "identity" : "other";
  }
  return (r || "other") as QuickVideoSlotRole;
}

function buildBlueprintFromRun(
  refSlots: QuickVideoImageSlot[],
  refImageUrls: string[],
): TemplateSlotBlueprint[] {
  const blueprint: TemplateSlotBlueprint[] = [];
  for (let i = 0; i < refSlots.length; i++) {
    const slot = refSlots[i]!;
    const role = slotRoleOf(slot);
    const url = refImageUrls[i] || "";
    const pictureIndex = slot.pictureIndex ?? i + 1;
    if (role === "identity") {
      // Never bake author name/face into the template — consumer supplies cast.
      blueprint.push({
        role: "identity",
        label: "Subject",
        pictureIndex,
      });
      continue;
    }
    blueprint.push({
      role,
      label: slot.label,
      bakedRefUrl: url || undefined,
      pictureIndex,
    });
  }
  return blueprint;
}

function authorNamesFromRun(
  characterRows: Array<{ name: string }>,
  refSlots: QuickVideoImageSlot[],
): string[] {
  const names = new Set<string>();
  for (const c of characterRows) {
    if (c.name.trim()) names.add(c.name.trim());
  }
  for (const slot of refSlots) {
    if (slotRoleOf(slot) !== "identity") continue;
    const n = (slot.characterName || slot.label || "").trim();
    if (n) names.add(n);
  }
  return [...names];
}

function sanitizeShotsJsonForTemplate(
  shotsJson: string,
  authorNames: string[],
): string {
  const plan = parseQuickVideoShotsPlan(shotsJson);
  if (!plan) return shotsJson;
  const list = authorNames.map((n) => n.trim()).filter(Boolean);
  if (!list.length) return shotsJson;
  plan.shots = plan.shots.map((s) => ({
    ...s,
    legoQuery: sanitizeVideoLegoQuery(s.legoQuery, list),
  }));
  return serializeQuickVideoShotsPlan(plan);
}

/** Bind viewer's cast into template shots (strip foreign cast names, inject selected). */
export function bindQuickVideoShotsToCharacter(
  shotsJson: string,
  characterName: string,
  foreignCastNames: string[] = [],
): string {
  const plan = parseQuickVideoShotsPlan(shotsJson);
  if (!plan) return shotsJson;
  const selected = characterName.trim();
  const list = foreignCastNames
    .map((n) => n.trim())
    .filter(
      (n) =>
        n &&
        n !== "Subject" &&
        n.toLowerCase() !== selected.toLowerCase(),
    );
  const tag = selected ? `[${selected}]` : "";
  plan.shots = plan.shots.map((s) => {
    let q = sanitizeVideoLegoQuery(s.legoQuery, list);
    if (tag && !new RegExp(`\\[${escapeRegExp(selected)}\\]`, "i").test(q)) {
      q = `${tag}${q}`.trim();
    }
    return { ...s, legoQuery: q };
  });
  return serializeQuickVideoShotsPlan(plan);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identityPersonCountFromRun(characterIds: string[]): number {
  // Custom Story models use custom:* ids — still one person for the consumer cast.
  const n = characterIds.filter(Boolean).length;
  return Math.max(1, Math.min(4, n || 1));
}

/** Build detail from a just-created row (always visible to author). */
function detailFromCreatedRow(
  row: {
    id: string;
    userId: string;
    title: string;
    notes: string;
    category: string;
    isJuice: boolean;
    priceCredits: number;
    identityPersonCount: number;
    hasLocationSlot: boolean;
    previewVideoUrl: string;
    previewPhotoUrl: string;
    orientation: string;
    durationSec: number;
    tgPublished?: boolean;
    tgDisplayTitle?: string;
    shotsJson: string;
    slotBlueprintJson: string;
    defaultLocationUrl: string;
    refVideoUrl: string;
  },
  viewerUserId: string,
): QuickVideoTemplateDetail {
  const pub = toPublic(row, viewerUserId, false);
  return {
    ...pub,
    shotsJson: row.shotsJson,
    slotBlueprint: parseBlueprint(row.slotBlueprintJson),
    defaultLocationUrl: row.defaultLocationUrl,
    refVideoUrl: row.refVideoUrl,
  };
}

export function userOwnsTemplate(opts: {
  isAuthor: boolean;
  isJuice: boolean;
  priceCredits: number;
  purchased: boolean;
}): boolean {
  if (opts.isAuthor) return true;
  if (!opts.isJuice || opts.priceCredits <= 0) return true;
  return opts.purchased;
}

function toPublic(
  row: {
    id: string;
    userId: string;
    title: string;
    notes: string;
    category: string;
    isJuice: boolean;
    priceCredits: number;
    identityPersonCount: number;
    hasLocationSlot: boolean;
    previewVideoUrl: string;
    previewPhotoUrl: string;
    orientation: string;
    durationSec: number;
    tgPublished?: boolean;
    tgDisplayTitle?: string;
  },
  viewerUserId: string,
  purchased: boolean,
): PublicQuickVideoTemplate {
  const isAuthor = row.userId === viewerUserId;
  const owned = userOwnsTemplate({
    isAuthor,
    isJuice: row.isJuice,
    priceCredits: row.priceCredits,
    purchased,
  });
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    category: row.category as TemplateCategory,
    isJuice: row.isJuice,
    priceCredits: row.priceCredits,
    identityPersonCount: row.identityPersonCount,
    hasLocationSlot: row.hasLocationSlot,
    previewVideoUrl: row.previewVideoUrl,
    previewPhotoUrl: isSafeVideoTemplateThumb(row.previewPhotoUrl)
      ? row.previewPhotoUrl
      : "",
    orientation: row.orientation,
    durationSec: row.durationSec,
    owned,
    isAuthor,
    tgPublished: row.tgPublished,
    tgDisplayTitle: row.tgDisplayTitle,
  };
}

export async function listPublishedQuickVideoTemplates(
  userId: string,
  category?: TemplateCategory,
) {
  const rows = await prisma.quickVideoTemplate.findMany({
    where: {
      published: true,
      ...(category ? { category } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  const ids = rows.map((r) => r.id);
  const purchases = ids.length
    ? await prisma.quickVideoTemplatePurchase.findMany({
        where: { userId, templateId: { in: ids } },
        select: { templateId: true },
      })
    : [];
  const ownedSet = new Set(purchases.map((p) => p.templateId));
  return rows.map((r) =>
    toPublic(r, userId, ownedSet.has(r.id)),
  );
}

export async function getQuickVideoTemplateDetail(
  userId: string,
  templateId: string,
): Promise<QuickVideoTemplateDetail | null> {
  const row = await prisma.quickVideoTemplate.findFirst({
    where: {
      id: templateId,
      OR: [
        { published: true },
        { tgPublished: true },
        // Author drafts (e.g. TG-only transfer before tgPublished flip)
        { userId },
      ],
    },
  });
  if (!row) return null;
  const purchase = await prisma.quickVideoTemplatePurchase.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });
  const pub = toPublic(row, userId, !!purchase);
  if (!pub.owned) {
    return {
      ...pub,
      shotsJson: "",
      slotBlueprint: [],
      defaultLocationUrl: "",
      refVideoUrl: "",
    };
  }
  return {
    ...pub,
    shotsJson: row.shotsJson,
    slotBlueprint: parseBlueprint(row.slotBlueprintJson),
    defaultLocationUrl: row.defaultLocationUrl,
    refVideoUrl: row.refVideoUrl,
  };
}

export async function createQuickVideoTemplateFromRun(opts: {
  userId: string;
  sourceRunId: string;
  title: string;
  notes?: string;
  category: TemplateCategory;
  isJuice: boolean;
  priceCredits: number;
  published?: boolean;
  /** Admin: save from another user's run */
  allowForeignRun?: boolean;
}) {
  const run = await prisma.quickVideoRun.findFirst({
    where: { id: opts.sourceRunId },
  });
  if (!run) throw new Error("Run not found");
  if (run.userId !== opts.userId && !opts.allowForeignRun) {
    throw new Error("Можно сохранять только свои успешные генерации");
  }
  if (run.status !== "ready") {
    throw new Error("Сохраняй шаблон только после успешной генерации");
  }

  const { isStoryH3RunPrompt, serializeStoryH3Template } = await import(
    "@/lib/story-h3-prompt"
  );
  const qvPlan = parseQuickVideoShotsPlan(run.prompt);
  let isStory = !qvPlan && isStoryH3RunPrompt(run.prompt);
  if (!qvPlan && !isStory && run.galleryItemId) {
    try {
      const item = await prisma.galleryItem.findUnique({
        where: { id: run.galleryItemId },
        select: { metaJson: true },
      });
      const meta = JSON.parse(item?.metaJson || "{}") as {
        storyH3?: boolean;
        jobAction?: string;
      };
      isStory = meta.storyH3 === true || meta.jobAction === "story_h3_video";
    } catch {
      /* ignore */
    }
  }
  if (!qvPlan && !isStory) {
    throw new Error("В run нет плана шотов");
  }

  let refSlots: QuickVideoImageSlot[] = [];
  let refImageUrls: string[] = [];
  try {
    refSlots = JSON.parse(run.refSlotsJson) as QuickVideoImageSlot[];
  } catch {
    refSlots = [];
  }
  try {
    refImageUrls = JSON.parse(run.refImageUrlsJson) as string[];
  } catch {
    refImageUrls = [];
  }

  let characterIds: string[] = [];
  try {
    characterIds = JSON.parse(run.characterIdsJson) as string[];
  } catch {
    characterIds = [];
  }

  const authorChars = characterIds.length
    ? await prisma.character.findMany({
        where: { id: { in: characterIds } },
        select: { name: true, triggerWord: true },
      })
    : [];
  const authorNames = authorNamesFromRun(authorChars, refSlots);
  const shotsJson = isStory
    ? serializeStoryH3Template({
        prompt: run.prompt,
        totalDurationSec: run.durationSec,
        bodyLookbook: await (async () => {
          if (!run.galleryItemId) return undefined;
          try {
            const item = await prisma.galleryItem.findUnique({
              where: { id: run.galleryItemId },
              select: { metaJson: true },
            });
            const meta = JSON.parse(item?.metaJson || "{}") as {
              bodyLookbook?: Record<string, string>;
            };
            return meta.bodyLookbook;
          } catch {
            return undefined;
          }
        })(),
      })
    : sanitizeShotsJsonForTemplate(run.prompt, authorNames);

  const { extractSpeechSlots } = await import("@/lib/speech-slots");
  const speechSlots = extractSpeechSlots(
    isStory
      ? shotsJson
      : (() => {
          try {
            const plan = parseQuickVideoShotsPlan(shotsJson);
            return (plan?.shots || []).map((s) => s.legoQuery || "").join("\n\n");
          } catch {
            return shotsJson;
          }
        })(),
  );

  const blueprint = buildBlueprintFromRun(refSlots, refImageUrls);
  const locationSlot = blueprint.find((s) => s.role === "location");
  const priceCredits = opts.isJuice
    ? Math.max(0, Math.min(500, Math.floor(opts.priceCredits)))
    : 0;

  const tpl = await prisma.quickVideoTemplate.create({
    data: {
      userId: opts.userId,
      title: opts.title.trim().slice(0, 120) || run.title,
      notes: (opts.notes || "").trim().slice(0, 500),
      category: opts.category,
      isJuice: opts.isJuice,
      priceCredits,
      published: opts.published !== false,
      sourceRunId: run.id,
      shotsJson,
      slotBlueprintJson: JSON.stringify(blueprint),
      identityPersonCount: identityPersonCountFromRun(characterIds),
      hasLocationSlot: !!locationSlot,
      defaultLocationUrl: locationSlot?.bakedRefUrl || "",
      refVideoUrl: run.refVideoUrl || "",
      previewVideoUrl: run.resultVideoUrl || "",
      // Never use identity/pose ref stills as public thumbs.
      // Frame thumb is filled by ensureTemplatePreviewPhoto (API / TG publish / migrate).
      previewPhotoUrl: "",
      orientation: run.orientation,
      durationSec: run.durationSec,
      previewIdentityKey: filterDbCharacterIds(characterIds)[0] || "",
      hasSpeech: speechSlots.length > 0,
    },
  });

  return (
    (await getQuickVideoTemplateDetail(opts.userId, tpl.id)) ||
    detailFromCreatedRow(tpl, opts.userId)
  );
}

export async function purchaseQuickVideoTemplate(
  userId: string,
  templateId: string,
) {
  const row = await prisma.quickVideoTemplate.findFirst({
    where: { id: templateId, published: true },
  });
  if (!row) throw new Error("Шаблон не найден");

  const existing = await prisma.quickVideoTemplatePurchase.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });
  if (existing || row.userId === userId) {
    return getQuickVideoTemplateDetail(userId, templateId);
  }

  const price = row.isJuice ? Math.max(0, row.priceCredits) : 0;
  if (price <= 0) {
    await prisma.quickVideoTemplatePurchase.create({
      data: { userId, templateId, paidCredits: 0 },
    });
    return getQuickVideoTemplateDetail(userId, templateId);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("auth");
  if (user.credits < price) {
    throw new Error(
      `Нужно ${price} кредитов для покупки шаблона, у вас ${user.credits}`,
    );
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: price } },
    }),
    prisma.quickVideoTemplatePurchase.create({
      data: { userId, templateId, paidCredits: price },
    }),
    prisma.ledgerEntry.create({
      data: {
        userId,
        amount: -price,
        reason: "quick_video_template_purchase",
        metaJson: JSON.stringify({ templateId, title: row.title }),
      },
    }),
  ]);

  return getQuickVideoTemplateDetail(userId, templateId);
}

export type QuickVideoTemplateApplyPayload = {
  templateId: string;
  title: string;
  shotsJson: string;
  orientation: string;
  durationSec: number;
  slotBlueprint: TemplateSlotBlueprint[];
  defaultLocationUrl: string;
  refVideoUrl: string;
  identityPersonCount: number;
  hasLocationSlot: boolean;
};

export function buildTemplateApplyPayload(
  detail: QuickVideoTemplateDetail,
): QuickVideoTemplateApplyPayload {
  return {
    templateId: detail.id,
    title: detail.title,
    shotsJson: detail.shotsJson,
    orientation: detail.orientation,
    durationSec: detail.durationSec,
    slotBlueprint: detail.slotBlueprint,
    defaultLocationUrl: detail.defaultLocationUrl,
    refVideoUrl: detail.refVideoUrl,
    identityPersonCount: detail.identityPersonCount,
    hasLocationSlot: detail.hasLocationSlot,
  };
}

/** Count db character ids saved on run — for display only. */
export { filterDbCharacterIds };
