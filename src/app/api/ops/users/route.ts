import { prisma } from "@/lib/db";
import { jsonOk } from "@/lib/ops/http";
import { withOps } from "@/lib/ops/http";

export async function GET(req: Request) {
  return withOps("users", async () => {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const take = 40;
    const skip = (page - 1) * take;
    const where = q
      ? {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { adminNotes: { contains: q } },
            {
              platformAccounts: {
                some: {
                  OR: [
                    { username: { contains: q } },
                    { platformUserId: { contains: q } },
                    { firstName: { contains: q } },
                  ],
                },
              },
            },
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          name: true,
          email: true,
          source: true,
          locale: true,
          balancePeaches: true,
          blocked: true,
          createdAt: true,
          ageConfirmed: true,
          adminRole: true,
          trafficLink: { select: { code: true, label: true } },
          platformAccounts: {
            where: { platform: "telegram" },
            select: {
              platformUserId: true,
              username: true,
              lastSeenAt: true,
            },
            take: 1,
          },
        },
      }),
    ]);
    return jsonOk({
      total,
      page,
      rows: rows.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
        tg: u.platformAccounts[0] || null,
      })),
    });
  });
}
