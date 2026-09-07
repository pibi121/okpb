import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { VideoLabForm } from "@/components/video-lab-form";
import { listFilmProjects } from "@/lib/film-pipeline";
import { loadPromptTemplates } from "@/lib/prompt-templates";

/** Старый функционал мини-фильма — только dev / legacy */
export default async function PeachVideoLegacyPage() {
  const user = await requireUser();
  if (!user) return null;

  const templates = loadPromptTemplates();
  const [characters, stills, projects] = await Promise.all([
    prisma.character.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.galleryItem.findMany({
      where: { userId: user.id, kind: "photo" },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    listFilmProjects(user.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Видео (legacy)</h2>
        <p className="text-sm text-zinc-600">
          Архив: Studio / Fast мини-фilm. Актуальный user-flow —{" "}
          <a href="/peach/video" className="text-peach hover:underline">
            /peach/video
          </a>
          .
        </p>
      </div>
      <VideoLabForm
        characters={characters.map((c) => ({
          id: c.id,
          name: c.name,
          loraStatus: c.loraStatus,
          gender: c.gender,
        }))}
        stills={stills.map((s) => ({
          id: s.id,
          title: s.title,
          kind: s.kind,
          resultUrl: s.resultUrl,
        }))}
        poses={templates.poses.map((p) => ({ id: p.id, label: p.label }))}
        styles={templates.styles.map((s) => ({ id: s.id, label: s.label }))}
        initialProjects={projects}
      />
    </div>
  );
}
