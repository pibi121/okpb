import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, verifyPassword, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().max(64).nullable().optional(),
  avatarUrl: z.string().max(512).nullable().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).max(128).optional(),
});

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = patchSchema.parse(await req.json());

  if (body.newPassword) {
    if (!body.currentPassword) {
      return NextResponse.json({ error: "Нужен текущий пароль" }, { status: 400 });
    }
    const full = await prisma.user.findUnique({ where: { id: user.id } });
    if (!full) return NextResponse.json({ error: "not found" }, { status: 404 });
    const ok = await verifyPassword(body.currentPassword, full.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 400 });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
  }

  if (body.name !== undefined) {
    await prisma.user.update({
      where: { id: user.id },
      data: { name: body.name?.trim() || null },
    });
  }

  if (body.avatarUrl !== undefined) {
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: body.avatarUrl?.trim() || null },
    });
  }

  return NextResponse.json({ ok: true });
}
