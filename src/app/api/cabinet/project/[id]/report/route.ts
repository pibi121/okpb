import { NextResponse } from "next/server";
import { getCabinetAccount } from "@/lib/cabinet/auth";
import { saveCabinetReport } from "@/lib/cabinet/service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const account = await getCabinetAccount();
  if (!account) return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Пустая форма" }, { status: 400 });
  const file = form.get("file");
  let upload: { bytes: Buffer; ext: string } | null = null;
  if (file instanceof File && file.size > 0) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    upload = { bytes: Buffer.from(await file.arrayBuffer()), ext };
  }
  try {
    await saveCabinetReport({
      accountId: account.id,
      projectId: id,
      spendId: String(form.get("spendId") || ""),
      reportId: String(form.get("reportId") || ""),
      amountRub: Number(form.get("amountRub") || ""),
      title: String(form.get("title") || ""),
      body: String(form.get("body") || ""),
      file: upload,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ошибка";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
