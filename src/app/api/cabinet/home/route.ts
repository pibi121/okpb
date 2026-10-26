import { NextResponse } from "next/server";
import { getCabinetAccount } from "@/lib/cabinet/auth";
import { cabinetHome, requestCabinetWithdrawal } from "@/lib/cabinet/service";
import { ensureCabinetDemo } from "@/lib/cabinet/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureCabinetDemo();
  const account = await getCabinetAccount();
  if (!account) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const home = await cabinetHome(account.id);
  if (!home) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  return NextResponse.json(home);
}

export async function POST(req: Request) {
  const account = await getCabinetAccount();
  if (!account) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    amountPeaches?: number;
    payoutDetails?: string;
  } | null;
  try {
    await requestCabinetWithdrawal({
      accountId: account.id,
      amountPeaches: Number(body?.amountPeaches),
      payoutDetails: String(body?.payoutDetails || ""),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ошибка";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
