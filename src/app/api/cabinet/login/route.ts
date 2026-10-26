import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createCabinetSession } from "@/lib/cabinet/auth";
import { ensureCabinetDemo } from "@/lib/cabinet/seed";

export async function POST(req: Request) {
  await ensureCabinetDemo();
  const body = (await req.json().catch(() => null)) as { login?: string; password?: string } | null;
  const login = String(body?.login || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!login || !password) {
    return NextResponse.json({ error: "Введите логин и пароль" }, { status: 400 });
  }
  const account = await prisma.cabinetAccount.findUnique({ where: { login } });
  if (!account || account.status !== "active") {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }
  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }
  await createCabinetSession(account.id);
  return NextResponse.json({ ok: true });
}
