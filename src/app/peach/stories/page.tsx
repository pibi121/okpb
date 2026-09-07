import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { loadPromptTemplates } from "@/lib/prompt-templates";
import { listStoryPacks } from "@/lib/story-pack";
import { StoryPackCreate } from "@/components/story-pack-create";
import Link from "next/link";

export default async function PeachStoriesPage() {
  const user = await requireUser();
  if (!user) return null;

  const [characters, templates, packs] = await Promise.all([
    prisma.character.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    }),
    Promise.resolve(loadPromptTemplates()),
    listStoryPacks(user.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-medium">Сюжеты</h2>
        <p className="text-sm text-zinc-600">
          Тренируй карточки: идея → кадры по очереди → фото ок → видео ок.
          Потом эти рецепты можно будет подставлять другим персонажам.
        </p>
      </div>

      <StoryPackCreate
        characters={characters.map((c) => ({ id: c.id, name: c.name }))}
        styles={templates.styles.map((s) => ({ id: s.id, label: s.label }))}
      />

      <div>
        <h3 className="mb-2 text-sm font-medium">Твои сюжеты</h3>
        {packs.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока пусто.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-white">
            {packs.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/peach/stories/${p.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-zinc-50"
                >
                  <div>
                    <div className="font-medium">{p.title}</div>
                    <div className="text-xs text-zinc-500">
                      {p.genre && p.genre !== "other" ? `${p.genre} · ` : ""}
                      {p.approvedBeats}/{p.beatCount} · {p.status}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-600">{p.idea}</p>
                  </div>
                  <span className="text-sm text-zinc-500">открыть →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
