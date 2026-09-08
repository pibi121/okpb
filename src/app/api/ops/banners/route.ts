import { prisma } from "@/lib/db";
import { jsonOk, jsonErr, withOps } from "@/lib/ops/http";
import { ensureDefaultBanners } from "@/lib/tg/banners";
import { saveGalleryBinary } from "@/lib/local-store";
import { writeAudit } from "@/lib/ops/audit";

export const runtime = "nodejs";

export async function GET() {
  return withOps("banners", async () => {
    await ensureDefaultBanners();
    const rows = await prisma.miniAppBanner.findMany({
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return jsonOk({
      rows: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: Request) {
  return withOps("banners", async (actor) => {
    const ct = req.headers.get("content-type") || "";

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const kind = String(form.get("kind") || "horizontal");
      const href = String(form.get("href") || "").trim();
      const label = String(form.get("label") || "").trim();
      const sortOrder = Number(form.get("sortOrder") || 0) || 0;
      if (kind !== "horizontal" && kind !== "vertical") {
        return jsonErr("kind: horizontal | vertical");
      }
      if (!(file instanceof File)) return jsonErr("Нужен файл");
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) return jsonErr("Файл больше 12 МБ");
      const ext = file.type.includes("png")
        ? "png"
        : file.type.includes("webp")
          ? "webp"
          : "jpg";
      const saved = saveGalleryBinary("_ops", ext, buf, `banner_${kind}`);
      const row = await prisma.miniAppBanner.create({
        data: {
          kind,
          imageUrl: saved.publicUrl,
          href,
          label,
          sortOrder,
          enabled: true,
        },
      });
      await writeAudit({
        actorId: actor.id,
        action: "banner_create",
        targetType: "miniAppBanner",
        targetId: row.id,
      });
      return jsonOk({ id: row.id, imageUrl: row.imageUrl });
    }

    const body = (await req.json()) as {
      action?: string;
      id?: string;
      href?: string;
      label?: string;
      sortOrder?: number;
      enabled?: boolean;
      kind?: string;
      imageUrl?: string;
    };

    if (body.action === "create") {
      const kind = body.kind === "vertical" ? "vertical" : "horizontal";
      if (!(body.imageUrl || "").trim()) return jsonErr("Нужен imageUrl");
      const row = await prisma.miniAppBanner.create({
        data: {
          kind,
          imageUrl: body.imageUrl!.trim(),
          href: (body.href || "").trim(),
          label: (body.label || "").trim(),
          sortOrder: Number(body.sortOrder) || 0,
          enabled: true,
        },
      });
      return jsonOk({ id: row.id });
    }

    if (body.action === "update" && body.id) {
      await prisma.miniAppBanner.update({
        where: { id: body.id },
        data: {
          ...(body.href !== undefined ? { href: body.href } : {}),
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.sortOrder !== undefined
            ? { sortOrder: Number(body.sortOrder) || 0 }
            : {}),
          ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        },
      });
      return jsonOk({ ok: true });
    }

    if (body.action === "delete" && body.id) {
      await prisma.miniAppBanner.delete({ where: { id: body.id } });
      return jsonOk({ ok: true });
    }

    return jsonErr("Неизвестное действие");
  });
}
