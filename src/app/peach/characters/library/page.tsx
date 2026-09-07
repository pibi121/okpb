import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { listCharacterPhotos } from "@/lib/character-dataset";
import { MarketplaceCard } from "@/components/marketplace-card";

export default async function CharacterLibraryPage() {
  const user = await requireUser();
  if (!user) return null;

  const characters = await prisma.character.findMany({
    orderBy: { updatedAt: "desc" },
    take: 48,
    select: {
      id: true,
      name: true,
      description: true,
      gender: true,
      userId: true,
    },
  });

  const cards = characters.map((ch) => {
    const photos = listCharacterPhotos(ch.id);
    const preview = photos[0]?.url;
    const isOwn = ch.userId === user.id;
    return { ...ch, preview, isOwn, isJuice: false };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-medium">Библиотека персонажей</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Готовые персонажи — бесплатно или с пометкой JUICE. Добавь в свой список и
          начни генерации.
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 p-10 text-center text-sm text-zinc-500">
          Пока нет персонажей в библиотеке.{" "}
          <Link href="/peach/characters" className="text-peach hover:underline">
            Создай своего
          </Link>
          .
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((ch) => (
            <MarketplaceCard
              key={ch.id}
              title={ch.name}
              description={
                ch.description?.slice(0, 120) ||
                (ch.isOwn ? "Твой персонаж" : "Добавить в коллекцию — скоро")
              }
              previewImage={ch.preview}
              badge={ch.isJuice ? "juice" : "free"}
              href={ch.isOwn ? `/peach/characters` : `/peach/characters/library`}
              useLabel={ch.isOwn ? "Открыть" : "Скоро"}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-600">
        Пока показываем персонажей из проекта. Публичная библиотека и покупка за
        кредиты (JUICE) — в следующих обновлениях.
      </p>
    </div>
  );
}
