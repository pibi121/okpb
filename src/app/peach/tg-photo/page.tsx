import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TgPhotoLabClient } from "@/components/tg-photo-lab-client";

export default async function TgPhotoLabPage() {
  const user = await requireUser();
  if (!user) return null;

  const characters = await prisma.character.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">TG фото-шаблоны</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Полигон для сценария бота: фото лица + шаблон с превью. Те же{" "}
          <code className="text-xs">PhotoTemplate</code>, что пойдут в Telegram.
        </p>
      </div>
      <TgPhotoLabClient characters={characters} />
    </div>
  );
}
