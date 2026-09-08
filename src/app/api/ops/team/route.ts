import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { hashPassword } from "@/lib/auth";
import { isOpsRole, roleLabel, OPS_ROLES } from "@/lib/ops/roles";
import { writeAudit } from "@/lib/ops/audit";
import {
  generateOpsCredentials,
  normalizeOpsLogin,
  opsLoginFromEmail,
  isOpsLocalAccount,
} from "@/lib/ops/staff-creds";

export async function GET() {
  return withOps("team", async () => {
    const rows = await prisma.user.findMany({
      where: { adminRole: { not: "" } },
      select: {
        id: true,
        email: true,
        name: true,
        adminRole: true,
        adminNotes: true,
        createdAt: true,
      },
      orderBy: { email: "asc" },
    });
    const audit = await prisma.adminAudit.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    return jsonOk({
      roles: OPS_ROLES.map((r) => ({ id: r, label: roleLabel(r) })),
      staff: rows.map((r) => ({
        ...r,
        login: opsLoginFromEmail(r.email),
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
      action?: string;
      email?: string;
      login?: string;
      password?: string;
      name?: string;
      note?: string;
      role?: string;
    };

    if (body.action === "generate") {
      return jsonOk(generateOpsCredentials());
    }

    const role = (body.role || "").trim();
    if (!isOpsRole(role)) return jsonErr("Нужна роль");

    const email = normalizeOpsLogin(
      (body.login || body.email || "").trim(),
    );
    if (!email) return jsonErr("Нужен логин");

    const note = (body.note || "").trim().slice(0, 500);
    const name =
      (body.name || "").trim().slice(0, 80) ||
      note.slice(0, 40) ||
      opsLoginFromEmail(email);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          adminRole: role,
          name,
          ...(note ? { adminNotes: note } : {}),
        },
      });
      await writeAudit({
        actorId: actor.id,
        action: "staff_role",
        targetType: "user",
        targetId: existing.id,
        detail: { email, role, note: note || undefined },
      });
      return jsonOk({
        ok: true,
        created: false,
        login: opsLoginFromEmail(email),
        email,
      });
    }

    const password =
      (body.password || "").trim() ||
      generateOpsCredentials().password;
    if (password.length < 6) return jsonErr("Пароль слишком короткий");

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        adminRole: role,
        adminNotes: note,
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
      detail: {
        email,
        role,
        local: isOpsLocalAccount(email),
        note: note || undefined,
      },
    });
    return jsonOk({
      ok: true,
      created: true,
      login: opsLoginFromEmail(email),
      email,
      password,
      hint: "Логин и пароль показываются один раз — скопируй и передай человеку.",
    });
  });
}
