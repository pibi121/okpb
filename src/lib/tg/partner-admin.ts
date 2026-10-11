import { prisma } from "@/lib/db";

/** Future admin cabinet: pending payout requests. */
export async function listPendingPartnerWithdrawals() {
  return prisma.partnerWithdrawal.findMany({
    where: { status: "pending", isFake: false, partnerId: { not: null } },
    orderBy: { createdAt: "asc" },
    include: {
      partner: {
        select: {
          id: true,
          userId: true,
          code: true,
          balancePeaches: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
  });
}
