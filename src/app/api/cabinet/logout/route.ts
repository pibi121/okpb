import { NextResponse } from "next/server";
import { destroyCabinetSession } from "@/lib/cabinet/auth";

export async function POST() {
  await destroyCabinetSession();
  return NextResponse.json({ ok: true });
}
