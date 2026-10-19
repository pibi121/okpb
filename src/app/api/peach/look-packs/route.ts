import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { labAccess } from "@/lib/ops/roles";
import { maintenanceApiBlock } from "@/lib/ops/maintenance-api";
import { saveGalleryBinary } from "@/lib/local-store";
import { copyAssetToTgCatalog } from "@/lib/tg/tg-publish";
import {
  lookScenesReady,
  parseLookScenes,
  type LookScene,
} from "@/lib/tg/funnel-v2/look-pack";
import { parseTgButtonStyle } from "@/lib/tg/funnel-v2/keyboard-layout";
import {
  loadFunnelKeyboardSettings,
  saveFunnelKeyboardSettings,
} from "@/lib/tg/funnel-v2/keyboard-settings";

export const runtime = "nodejs";
export const maxDuration = 60;

const sceneSchema = z.object({
  editPrompt: z.string().max(4000),
});

const saveSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(80),
  tgDisplayTitle: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
  pricePeaches: z.number().int().min(1).max(100000),
  previewVideoUrl: z.string().max(2000).optional(),
  funnelV2Published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  buttonStyle: z.enum(["", "primary", "success", "danger"]).optional(),
  rowBreak: z.boolean().optional(),
  scenes: z.array(sceneSchema).length(5),
});

const reorderSchema = z.object({
  action: z.literal("reorder"),
  ids: z.array(z.string()).max(80),
});

const keyboardSchema = z.object({
  action: z.literal("keyboard"),
  customRows: z.boolean().optional(),
  firstPageSize: z.number().int().min(1).max(24).optional(),
  nextPageSize: z.number().int().min(1).max(24).optional(),
});

async function assertLab() {
  const user = await requireUser();
  if (!user) {
    return { error: NextResponse.json({ error: "auth" }, { status: 401 }) };
  }
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { adminRole: true },
  });
  if (!labAccess(row?.adminRole)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user };
}

function toDto(row: {
  id: string;
  title: string;
  notes: string;
  tgDisplayTitle: string;
  pricePeaches: number;
  previewVideoUrl: string;
  scenesJson: string;
  funnelV2Published: boolean;
  sortOrder: number;
  tgButtonStyle: string;
  tgRowBreak: boolean;
  updatedAt: Date;
}) {
  const parsed = parseLookScenes(row.scenesJson);
  const scenes: LookScene[] = Array.from({ length: 5 }, (_, i) => ({
    editPrompt: parsed[i]?.editPrompt || "",
  }));
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    tgDisplayTitle: row.tgDisplayTitle,
    pricePeaches: row.pricePeaches,
    previewVideoUrl: row.previewVideoUrl,
    funnelV2Published: row.funnelV2Published,
    sortOrder: row.sortOrder,
    buttonStyle: parseTgButtonStyle(row.tgButtonStyle),
    rowBreak: row.tgRowBreak,
    updatedAt: row.updatedAt.toISOString(),
    scenes,
    ready: lookScenesReady(scenes),
  };
}

export async function GET() {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;
  const [rows, keyboard] = await Promise.all([
    prisma.funnelLookPack.findMany({
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      take: 100,
    }),
    loadFunnelKeyboardSettings(),
  ]);
  return NextResponse.json({ packs: rows.map(toDto), keyboard: keyboard.look });
}

export async function POST(req: NextRequest) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;

  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 100) {
      return NextResponse.json({ error: "Нужен файл видео" }, { status: 400 });
    }
    if (file.size > 40 * 1024 * 1024) {
      return NextResponse.json({ error: "Файл больше 40 МБ" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const ext =
      (file.name || "teaser.mp4").split(".").pop()?.toLowerCase() || "mp4";
    const saved = saveGalleryBinary(gate.user.id, ext, buf, "look_teaser");
    const url =
      copyAssetToTgCatalog(saved.publicUrl, `look-teaser-${Date.now()}`, `.${ext}`) ||
      saved.publicUrl;
    return NextResponse.json({ url });
  }

  const raw = await req.json();
  const reorder = reorderSchema.safeParse(raw);
  if (reorder.success) {
    await prisma.$transaction(
      reorder.data.ids.map((id, index) =>
        prisma.funnelLookPack.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return NextResponse.json({ ok: true });
  }
  const keyboardPatch = keyboardSchema.safeParse(raw);
  if (keyboardPatch.success) {
    const keyboard = await saveFunnelKeyboardSettings({
      look: {
        customRows: keyboardPatch.data.customRows === true,
        firstPageSize: keyboardPatch.data.firstPageSize ?? 6,
        nextPageSize: keyboardPatch.data.nextPageSize ?? 6,
      },
    });
    return NextResponse.json({ keyboard: keyboard.look });
  }
  const body = saveSchema.parse(raw);
  const scenes = body.scenes.map((s) => ({
    editPrompt: s.editPrompt.trim(),
  }));
  const publish = Boolean(body.funnelV2Published);
  if (publish && !lookScenesReady(scenes)) {
    return NextResponse.json(
      { error: "Чтобы опубликовать, заполни 5 промптов" },
      { status: 400 },
    );
  }
  const data = {
    title: body.title,
    tgDisplayTitle: (body.tgDisplayTitle || "").trim(),
    notes: (body.notes || "").trim(),
    pricePeaches: body.pricePeaches,
    previewVideoUrl: (body.previewVideoUrl || "").trim(),
    funnelV2Published: publish,
    sortOrder: body.sortOrder ?? 0,
    tgButtonStyle: parseTgButtonStyle(body.buttonStyle),
    tgRowBreak: Boolean(body.rowBreak),
    scenesJson: JSON.stringify(scenes),
  };
  const row = body.id
    ? await prisma.funnelLookPack.update({ where: { id: body.id }, data })
    : await prisma.funnelLookPack.create({ data });
  return NextResponse.json({ pack: toDto(row) });
}

export async function DELETE(req: NextRequest) {
  const maintenanceBlock = await maintenanceApiBlock();
  if (maintenanceBlock) return maintenanceBlock;
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id" }, { status: 400 });
  await prisma.funnelLookPack.delete({ where: { id } }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
