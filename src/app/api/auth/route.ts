import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSession,
  hashPassword,
  verifyPassword,
  destroySession,
  requireUser,
} from "@/lib/auth";
import { PRICING } from "@/lib/billing";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).max(80).optional(),
  ageConfirmed: z.literal(true),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "register";

  if (action === "logout") {
    await destroySession();
    return NextResponse.json({ ok: true });
  }

  const body = await req.json();

  if (action === "login") {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Неверные данные" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (!user) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 },
      );
    }

    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 },
      );
    }

    await createSession(user.id);
    return NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, credits: user.credits },
    });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Проверьте email, пароль (минимум 6 символов) и галочку 18+",
      },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json(
      { error: "Такой email уже зарегистрирован" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const { pickRandomAvatarUrl } = await import("@/lib/default-avatars");
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: parsed.data.name || email.split("@")[0],
      avatarUrl: pickRandomAvatarUrl(email) || null,
      ageConfirmed: true,
      credits: PRICING.startingCredits,
      ledger: {
        create: {
          amount: PRICING.startingCredits,
          reason: "welcome_bonus",
          metaJson: JSON.stringify({ note: "Стартовые тестовые кредиты" }),
        },
      },
    },
  });

  await prisma.gpuVault.upsert({
    where: { id: "main" },
    create: { id: "main", balanceRub: 0, maxWorkers: 1 },
    update: {},
  });

  await createSession(user.id);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, credits: user.credits },
  });
}

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user });
}
