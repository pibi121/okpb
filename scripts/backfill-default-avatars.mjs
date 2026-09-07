/** One-time: assign random default avatars to users without avatarUrl */
import { PrismaClient } from "@prisma/client";
import { listDefaultAvatarUrls, pickRandomAvatarUrl } from "../src/lib/default-avatars";

const prisma = new PrismaClient();

async function main() {
  const avatars = listDefaultAvatarUrls();
  if (!avatars.length) {
    console.log("No avatars in public/avatars/default");
    return;
  }
  const users = await prisma.user.findMany({
    where: { OR: [{ avatarUrl: null }, { avatarUrl: "" }] },
    select: { id: true, email: true },
  });
  for (const u of users) {
    await prisma.user.update({
      where: { id: u.id },
      data: { avatarUrl: pickRandomAvatarUrl(u.email) },
    });
  }
  console.log(`Updated ${users.length} users with avatars (${avatars.length} in pool)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
