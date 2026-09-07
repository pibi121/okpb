import { prisma } from "@/lib/db";

export async function writeAudit(opts: {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}) {
  await prisma.adminAudit.create({
    data: {
      actorId: opts.actorId,
      action: opts.action,
      targetType: opts.targetType || "",
      targetId: opts.targetId || "",
      detailJson: JSON.stringify(opts.detail || {}),
    },
  });
}
