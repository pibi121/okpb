import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOwnedPack, toPublicPack } from "@/lib/template-pack";
import { TemplateBuilder } from "@/components/template-builder";

type Ctx = { params: Promise<{ id: string }> };

export default async function PeachTemplatePage({ params }: Ctx) {
  const user = await requireUser();
  if (!user) return null;
  const { id } = await params;
  const owned = await getOwnedPack(user.id, id);
  if (!owned) notFound();
  const pack = await toPublicPack(id);
  if (!pack) notFound();
  const characters = await prisma.character.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, gender: true },
  });

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TemplateBuilder initial={pack} characters={characters} />
    </div>
  );
}
