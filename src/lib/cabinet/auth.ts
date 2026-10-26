import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "pb_cabinet";

function getSecret() {
  const secret = process.env.AUTH_SECRET || "peachbitch-dev-secret";
  return new TextEncoder().encode(secret);
}

export async function createCabinetSession(accountId: string) {
  const token = await new SignJWT({ sub: accountId, kind: "cabinet" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroyCabinetSession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getCabinetAccountId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.kind !== "cabinet") return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function getCabinetAccount() {
  const id = await getCabinetAccountId();
  if (!id) return null;
  const account = await prisma.cabinetAccount.findUnique({ where: { id } });
  if (!account || account.status !== "active") return null;
  return account;
}
