import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { ensureOpsOwner } from "@/lib/ops/auth";
import { bootOps } from "@/lib/ops/seed";
import { isOpsRole } from "@/lib/ops/roles";
import { ownerEmails } from "@/lib/ops/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  await bootOps();
  await ensureOpsOwner();
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверные данные" }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  }
  if (!isOpsRole(user.adminRole)) {
    const ownerExists = await prisma.user.findFirst({
      where: { adminRole: "owner" },
      select: { id: true },
    });
    const configured = ownerEmails().includes(email);
    const labWebWhere = {
      source: "web" as const,
      NOT: [
        { email: { startsWith: "tg_" } },
        { email: { endsWith: "@test.local" } },
        { email: { endsWith: "@example.com" } },
        { email: { endsWith: "@peachbitch.internal" } },
      ],
    };
    const webUsers = await prisma.user.count({ where: labWebWhere });
    const isLabWeb =
      user.source === "web" &&
      !user.email.startsWith("tg_") &&
      !user.email.endsWith("@test.local") &&
      !user.email.endsWith("@example.com") &&
      !user.email.endsWith("@peachbitch.internal");
    const onlyLabAccount = !ownerExists && isLabWeb && webUsers <= 2;
    if (configured || onlyLabAccount) {
      await prisma.user.update({
        where: { id: user.id },
        data: { adminRole: "owner" },
      });
    } else {
      return NextResponse.json({ error: "Это не вход в панель" }, { status: 403 });
    }
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
