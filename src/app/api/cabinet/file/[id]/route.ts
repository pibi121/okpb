import fs from "fs";
import { NextResponse } from "next/server";
import { getCabinetAccount } from "@/lib/cabinet/auth";
import { requireOps } from "@/lib/ops/auth";
import { cabinetSpendFile } from "@/lib/cabinet/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [account, ops] = await Promise.all([getCabinetAccount(), requireOps("deals")]);
  const file = await cabinetSpendFile({
    accountId: account?.id,
    ops: Boolean(ops),
    reportId: id,
  });
  if (!file) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const bytes = fs.readFileSync(file.abs);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
