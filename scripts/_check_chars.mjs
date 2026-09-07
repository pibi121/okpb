import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.character.findMany({
  orderBy: { updatedAt: "desc" },
  take: 8,
  select: {
    id: true,
    name: true,
    loraStatus: true,
    photoCount: true,
    triggerWord: true,
    loraPath: true,
    updatedAt: true,
  },
});
console.log(JSON.stringify(rows, null, 2));
await p.$disconnect();
