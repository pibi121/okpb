import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOwnedRun, toPublicRun } from "@/lib/template-play";
import { TemplatePlay } from "@/components/template-play";

type Ctx = { params: Promise<{ runId: string }> };

export default async function PeachPlayPage({ params }: Ctx) {
  const user = await requireUser();
  if (!user) return null;
  const { runId } = await params;
  const owned = await getOwnedRun(user.id, runId);
  if (!owned) notFound();
  const run = await toPublicRun(runId);
  if (!run) notFound();

  const characters = await prisma.character.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, gender: true },
  });

  return <TemplatePlay initial={run} characters={characters} />;
}
