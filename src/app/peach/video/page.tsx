import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { VideoHubClient } from "@/components/video-hub-client";
import type {
  PeachTemplateItem,
  QuickVideoTemplateItem,
} from "@/components/peach-templates-marketplace";
import { loadVideoLegoFile } from "@/lib/prompt-lego";
import { countCharacterRefPhotos } from "@/lib/character-ref-pack";
import { listPublishedQuickVideoTemplates } from "@/lib/quick-video-template";

export default async function PeachVideoPage() {
  const user = await requireUser();
  if (!user) return null;

  const [rawCharacters, socialTemplates, qvPeach, qvBitch, videoLego] =
    await Promise.all([
      prisma.character.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          gender: true,
          triggerWord: true,
          photoCount: true,
          loraStatus: true,
        },
      }),
      prisma.socialTemplate.findMany({
        where: { published: true, status: "ready" },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          notes: true,
          previewVideoUrl: true,
          previewPhotoUrl: true,
          durationSec: true,
        },
      }),
      listPublishedQuickVideoTemplates(user.id, "peach"),
      listPublishedQuickVideoTemplates(user.id, "bitch"),
      Promise.resolve(loadVideoLegoFile()),
    ]);

  const characters = await Promise.all(
    rawCharacters.map(async (c) => ({
      ...c,
      refPhotoCount: await countCharacterRefPhotos(user.id, c.id),
    })),
  );

  const peachTemplates: PeachTemplateItem[] = socialTemplates.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    previewVideoUrl: t.previewVideoUrl,
    previewPhotoUrl: t.previewPhotoUrl,
    durationSec: t.durationSec,
    isJuice: false,
  }));

  const toQvItem = (t: (typeof qvPeach)[0]): QuickVideoTemplateItem => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    previewVideoUrl: t.previewVideoUrl,
    previewPhotoUrl: t.previewPhotoUrl,
    durationSec: t.durationSec,
    isJuice: t.isJuice,
    priceCredits: t.priceCredits,
    owned: t.owned,
    category: t.category,
    isAuthor: t.isAuthor,
    tgPublished: t.tgPublished,
    tgDisplayTitle: t.tgDisplayTitle,
  });

  return (
    <VideoHubClient
      characters={characters}
      peachTemplates={peachTemplates}
      quickVideoPeachTemplates={qvPeach.map(toQvItem)}
      quickVideoBitchTemplates={qvBitch.map(toQvItem)}
      videoLego={videoLego}
    />
  );
}
