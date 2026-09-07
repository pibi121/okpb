import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const stills = await p.galleryItem.findMany({
    where: { kind: "photo" },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      title: true,
      resultUrl: true,
      createdAt: true,
      width: true,
      height: true,
      prompt: true,
      metaJson: true,
      characterId: true,
    },
  });
  for (const s of stills) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(s.metaJson || "{}");
    } catch {
      /* ignore */
    }
    console.log(
      JSON.stringify({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt.toISOString(),
        url: s.resultUrl,
        wh: [s.width, s.height],
        status: meta.status,
        engine: meta.engine,
        char: s.characterId,
        promptHead: (s.prompt || "").slice(0, 100),
      }),
    );
  }

  const social = await p.socialRef2VRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      title: true,
      status: true,
      kreaPhotoUrl: true,
      resultVideoUrl: true,
      createdAt: true,
    },
  });
  console.log("--- social ---");
  for (const r of social) console.log(JSON.stringify(r));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
