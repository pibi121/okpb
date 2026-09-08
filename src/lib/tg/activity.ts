import { prisma } from "@/lib/db";

/** Touch last activity; clears idle winback flags so they can fire again later. */
export async function touchTgActivity(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        tgLastActiveAt: new Date(),
        tgIdle3dSent: false,
        tgIdle7dSent: false,
      },
    });
  } catch (e) {
    console.error("[tg-activity]", userId, e);
  }
}
