import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadPromptTemplates } from "@/lib/prompt-templates";
import { getOwnedPack, toPublicPack } from "@/lib/story-pack";
import { StoryPackWizard } from "@/components/story-pack-wizard";

type Ctx = { params: Promise<{ id: string }> };

export default async function PeachStoryPackPage({ params }: Ctx) {
  const user = await requireUser();
  if (!user) return null;
  const { id } = await params;
  const owned = await getOwnedPack(user.id, id);
  if (!owned) notFound();
  const pack = await toPublicPack(id);
  if (!pack) notFound();
  const templates = loadPromptTemplates();

  return (
    <StoryPackWizard
      initial={pack}
      poses={templates.poses.map((p) => ({ id: p.id, label: p.label }))}
    />
  );
}
