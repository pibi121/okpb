import { NextResponse } from "next/server";
import { getCabinetAccount } from "@/lib/cabinet/auth";
import { cabinetProjectView, createCabinetLink, createCabinetSpend } from "@/lib/cabinet/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const account = await getCabinetAccount();
  if (!account) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const view = await cabinetProjectView(account.id, id);
  if (!view) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  return NextResponse.json(view);
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const account = await getCabinetAccount();
  if (!account) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    label?: string;
    amountRub?: number;
  } | null;
  try {
    if (body?.action === "create_link") {
      await createCabinetLink(account.id, id, String(body.label || ""));
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "create_spend") {
      await createCabinetSpend(account.id, id, Number(body.amountRub));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ошибка";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
