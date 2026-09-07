import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import {
  canAccessSection,
  isOpsRole,
  type OpsRole,
  type OpsSection,
} from "@/lib/ops/roles";

export type OpsActor = {
  id: string;
  email: string;
  name: string | null;
  adminRole: OpsRole;
};

export async function getOpsActor(): Promise<OpsActor | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, adminRole: true },
  });
  if (!user || !isOpsRole(user.adminRole)) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    adminRole: user.adminRole,
  };
}

export async function requireOps(section?: OpsSection): Promise<OpsActor | null> {
  const actor = await getOpsActor();
  if (!actor) return null;
  if (section && !canAccessSection(actor.adminRole, section)) return null;
  return actor;
}

export function ownerEmails(): string[] {
  return [process.env.OPS_OWNER_EMAIL, process.env.ADMIN_EMAIL]
    .map((s) => s?.trim().toLowerCase())
    .filter((s): s is string => !!s);
}

/** Grant owner to configured email if they have no role yet. */
export async function ensureOpsOwner(): Promise<void> {
  const emails = ownerEmails();
  if (!emails.length) return;
  const ownerExists = await prisma.user.findFirst({
    where: { adminRole: "owner" },
    select: { id: true },
  });
  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;
    if (user.adminRole === "owner") return;
    if (!user.adminRole || user.adminRole === "") {
      await prisma.user.update({
        where: { id: user.id },
        data: { adminRole: "owner" },
      });
      return;
    }
  }
  if (!ownerExists) {
    const first = await prisma.user.findFirst({
      where: { email: { in: emails } },
    });
    if (first) {
      await prisma.user.update({
        where: { id: first.id },
        data: { adminRole: "owner" },
      });
    }
  }
}
