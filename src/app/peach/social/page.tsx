import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SocialHub } from "@/components/social-hub";

export default async function PeachSocialPage() {
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
        <h2 className="text-lg font-medium">Соцсети</h2>
        <p className="text-sm text-zinc-600">
          Выбери шаблон и модель — система сгенерирует кадр в Krea, покажет его
          на проверку, затем соберёт итоговое видео по шаблону (MiniMax Ref2VA
          READY).
        </p>
      </div>
      <SocialHub characters={characters} />
    </div>
  );
}
