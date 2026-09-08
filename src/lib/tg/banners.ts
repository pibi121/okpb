import { prisma } from "@/lib/db";

export type BannerKind = "horizontal" | "vertical";

export type BannerDto = {
  id: string;
  kind: BannerKind;
  imageUrl: string;
  href: string;
  label: string;
  sortOrder: number;
};

const TRAIN_HREF = "/tg/characters?section=train";
const GUIDE_HREF = "/tg/guide";

const SEED: Array<{
  kind: BannerKind;
  imageUrl: string;
  href: string;
  label: string;
  sortOrder: number;
}> = [
  {
    kind: "horizontal",
    imageUrl: "/tg/banners/bannerhoriz1.png",
    href: TRAIN_HREF,
    label: "Train character",
    sortOrder: 10,
  },
  {
    kind: "horizontal",
    imageUrl: "/tg/banners/bannerhoriz2.png",
    href: GUIDE_HREF,
    label: "Guide",
    sortOrder: 20,
  },
  {
    kind: "vertical",
    imageUrl: "/tg/banners/banner-vertical1.png",
    href: TRAIN_HREF,
    label: "Train character",
    sortOrder: 10,
  },
  {
    kind: "vertical",
    imageUrl: "/tg/banners/banner-vertical2.png",
    href: GUIDE_HREF,
    label: "Guide",
    sortOrder: 20,
  },
];

let seeded = false;

export async function ensureDefaultBanners() {
  if (seeded) return;
  const n = await prisma.miniAppBanner.count();
  if (n === 0) {
    for (const b of SEED) {
      await prisma.miniAppBanner.create({
        data: { ...b, enabled: true },
      });
    }
  }
  seeded = true;
}

export async function listBanners(kind?: BannerKind): Promise<BannerDto[]> {
  await ensureDefaultBanners();
  const rows = await prisma.miniAppBanner.findMany({
    where: {
      enabled: true,
      ...(kind ? { kind } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as BannerKind,
    imageUrl: r.imageUrl,
    href: r.href,
    label: r.label,
    sortOrder: r.sortOrder,
  }));
}

/**
 * Insert vertical banners into a feed:
 * - never in the first 3 content slots
 * - at most one banner per 6 content items between banners
 * - banners picked in shuffled order
 */
export function injectVerticalBanners<T extends { id: string }>(
  items: T[],
  banners: BannerDto[],
): Array<T | { kind: "banner"; id: string; imageUrl: string; href: string; label: string }> {
  if (!banners.length || items.length <= 3) {
    return items;
  }

  const shuffled = [...banners].sort(() => Math.random() - 0.5);
  let bi = 0;
  const out: Array<
    T | { kind: "banner"; id: string; imageUrl: string; href: string; label: string }
  > = [];
  let contentCount = 0;
  let nextInsertAt = 3 + Math.floor(Math.random() * 2); // after 3rd or 4th content card

  for (const item of items) {
    out.push(item);
    contentCount += 1;
    if (bi < shuffled.length && contentCount === nextInsertAt) {
      const b = shuffled[bi++];
      out.push({
        kind: "banner",
        id: `banner-${b.id}`,
        imageUrl: b.imageUrl,
        href: b.href,
        label: b.label,
      });
      nextInsertAt = contentCount + 6 + Math.floor(Math.random() * 3);
    }
  }

  return out;
}
