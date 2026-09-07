import { prisma } from "@/lib/db";

export async function listFavoriteCastIds(userId: string): Promise<string[]> {
  const rows = await prisma.tgCastFavorite.findMany({
    where: { userId },
    select: { characterId: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => r.characterId);
}

export async function toggleFavoriteCast(
  userId: string,
  characterId: string,
): Promise<{ favorited: boolean }> {
  const cast = await prisma.character.findFirst({
    where: { id: characterId, isStudioCast: true },
    select: { id: true },
  });
  if (!cast) throw new Error("cast_not_found");

  const existing = await prisma.tgCastFavorite.findUnique({
    where: {
      userId_characterId: { userId, characterId },
    },
  });
  if (existing) {
    await prisma.tgCastFavorite.delete({ where: { id: existing.id } });
    return { favorited: false };
  }
  await prisma.tgCastFavorite.create({
    data: { userId, characterId },
  });
  return { favorited: true };
}
