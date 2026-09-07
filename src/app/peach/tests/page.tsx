import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TestGalleryHome } from "@/components/test-gallery-home";
import { listTestGalleryFolders } from "@/lib/test-gallery";

export default async function PeachTestsPage() {
  const user = await requireUser();
  if (!user) return null;

  const [folders, characters] = await Promise.all([
    listTestGalleryFolders(user.id),
    prisma.character.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, loraStatus: true },
    }),
  ]);

  const daisy =
    characters.find((c) => /daisy/i.test(c.name))?.id ||
    characters.find((c) => c.loraStatus === "lora_ready")?.id ||
    null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Галерея тестов</h2>
        <p className="text-sm text-zinc-600">
          Автопрогоны поз/LoRA по ориентациям. Оцени кадры — потом решим, что
          оставить в списке.
        </p>
      </div>
      <TestGalleryHome
        folders={folders}
        characters={characters}
        daisyId={daisy}
      />
    </div>
  );
}
