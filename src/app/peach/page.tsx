import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PeachHomeClient } from "@/components/peach-home-client";

export default async function PeachHomePage() {
  const user = await requireUser();
  if (!user) return null;

  const [chars, gallery, presets] = await Promise.all([
    prisma.character.count({ where: { userId: user.id } }),
    prisma.galleryItem.count({ where: { userId: user.id } }),
    prisma.peachPreset.count({
      where: { OR: [{ userId: user.id }, { isBuiltin: true }] },
    }),
  ]);

  return <PeachHomeClient stats={{ chars, gallery, presets }} />;
}
