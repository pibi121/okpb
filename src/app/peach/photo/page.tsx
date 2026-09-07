import { loadPromptTemplates } from "@/lib/prompt-templates";
import { loadLegoFile } from "@/lib/prompt-lego";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PhotoHubClient } from "@/components/photo-hub-client";
import { listPublishedPeachPhotoTemplates } from "@/lib/peach-photo-template";
import type { PeachPhotoTemplateItem } from "@/components/peach-templates-marketplace";

export default async function PeachPhotoPage() {
  const user = await requireUser();
  if (!user) return null;

  const [characters, templates, lego, photoPeach, photoBitch] =
    await Promise.all([
      prisma.character.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
      }),
      Promise.resolve(loadPromptTemplates()),
      Promise.resolve(loadLegoFile()),
      listPublishedPeachPhotoTemplates(user.id, "peach"),
      listPublishedPeachPhotoTemplates(user.id, "bitch"),
    ]);

  const toItem = (t: Awaited<ReturnType<typeof listPublishedPeachPhotoTemplates>>[0]): PeachPhotoTemplateItem => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    previewImageUrl: t.previewImageUrl,
    orientation: t.orientation,
    isJuice: t.isJuice,
    priceCredits: t.priceCredits,
    owned: t.owned,
    category: t.category,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Фото</h2>
        <p className="text-sm text-zinc-500">
          Собери сцену: персонаж, поза, свет и стиль — получи готовый кадр.
          Готовые фото можно сохранить как шаблон.
        </p>
      </div>
      <PhotoHubClient
        characters={characters.map((c) => ({
          id: c.id,
          name: c.name,
          gender: c.gender,
          loraStatus: c.loraStatus,
          triggerWord: c.triggerWord,
        }))}
        poses={templates.poses}
        lego={{
          lighting: lego.lighting,
          events: lego.events,
          stylization: lego.stylization,
          body: lego.body || [],
        }}
        peachPhotoTemplates={photoPeach.map(toItem)}
        bitchPhotoTemplates={photoBitch.map(toItem)}
      />
    </div>
  );
}
