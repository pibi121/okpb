import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { hashPassword } from "@/lib/auth";
import { isOpsRole, roleLabel } from "@/lib/ops/roles";
import { writeAudit } from "@/lib/ops/audit";
import { randomBytes } from "crypto";

export async function GET() {
  return withOps("team", async () => {
    const rows = await prisma.user.findMany({
      where: { adminRole: { not: "" } },
      select: {
        id: true,
        email: true,
        name: true,
        adminRole: true,
        createdAt: true,
      },
      orderBy: { email: "asc" },
    });
    const audit = await prisma.adminAudit.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    return jsonOk({
      staff: rows.map((r) => ({
        ...r,
        roleLabel: roleLabel(r.adminRole),
        createdAt: r.createdAt.toISOString(),
      })),
      audit: audit.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("team", async (actor) => {
    if (actor.adminRole !== "owner") return jsonErr("Только хозяин", 403);
    const body = (await req.json()) as {
      email?: string;
      name?: string;
      role?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const role = (body.role || "").trim();
    if (!email || !isOpsRole(role)) return jsonErr("Нужны почта и роль");
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { adminRole: role },
      });
      await writeAudit({
        actorId: actor.id,
        action: "staff_role",
        targetType: "user",
        targetId: existing.id,
        detail: { email, role },
      });
      return jsonOk({ ok: true, created: false });
    }
    const password = randomBytes(9).toString("base64url").slice(0, 12);
    const user = await prisma.user.create({
      data: {
        email,
        name: (body.name || email.split("@")[0]).slice(0, 80),
        passwordHash: await hashPassword(password),
        adminRole: role,
        ageConfirmed: true,
        source: "web",
        credits: 0,
      },
    });
    await writeAudit({
      actorId: actor.id,
      action: "staff_create",
      targetType: "user",
      targetId: user.id,
      detail: { email, role },
    });
    return jsonOk({
      ok: true,
      created: true,
      password,
      hint: "Пароль показывается один раз. Сохраните его.",
    });
  });
}
