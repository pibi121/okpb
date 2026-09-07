import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getFilmProject } from "@/lib/film-pipeline";
import { FilmProjectStudio } from "@/components/video-lab-form";

type Ctx = { params: Promise<{ id: string }> };

export default async function PeachFilmProjectPage({ params }: Ctx) {
  const user = await requireUser();
  if (!user) return null;
  const { id } = await params;
  const project = await getFilmProject(user.id, id);
  if (!project) notFound();

  const characters = await prisma.character.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <FilmProjectStudio
      initial={project}
      characters={characters.map((c) => ({
        id: c.id,
        name: c.name,
        loraStatus: c.loraStatus,
        gender: c.gender,
      }))}
    />
  );
}
