import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { labAccess } from "@/lib/ops/roles";
import {
  publishPhotoTemplateToTg,
  unpublishPhotoTemplateFromTg,
  updatePhotoTemplateTgMeta,
  publishQuickVideoTemplateToTg,
  unpublishQuickVideoTemplateFromTg,
  updateQuickVideoTemplateTgMeta,
} from "@/lib/tg/tg-publish";
import {
  publishLoraI2vTemplateToTg,
  unpublishLoraI2vTemplateFromTg,
  updateLoraI2vTemplateTgMeta,
} from "@/lib/lora-i2v-template";
import {
  buildLoraI2vShotsPlan,
  parseLoraI2vShotsPlan,
  resolveLoraI2vShots,
} from "@/lib/lora-i2v-shots";
import {
  parseQuickVideoShotsPlan,
  serializeQuickVideoShotsPlan,
} from "@/lib/quick-video-prompt";
import {
  parseStoryH3Template,
  serializeStoryH3Template,
} from "@/lib/story-h3-prompt";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ kind: string; id: string }> };

const patchSchema = z.object({
  displayTitle: z.string().max(120).optional(),
  title: z.string().min(1).max(120).optional(),
  tgPublished: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  /** Photo edit prompt */
  editPrompt: z.string().max(12000).optional(),
  /** LoRA I2V / video prompt fields */
  stillPrompt: z.string().max(12000).optional(),
  i2vPrompt: z.string().max(12000).optional(),
  prompt: z.string().max(50000).optional(),
  shots: z
    .array(
      z.object({
        id: z.string().max(80).optional(),
        stillPrompt: z.string().max(12000).optional(),
        i2vPrompt: z.string().max(12000).optional(),
        legoQuery: z.string().max(12000).optional(),
        durationSec: z.number().min(1).max(3600).optional(),
      }),
    )
    .max(24)
    .optional(),
});

async function assertLab() {
  const user = await requireUser();
  if (!user) return { error: NextResponse.json({ error: "auth" }, { status: 401 }) };
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { adminRole: true },
  });
  if (!labAccess(row?.adminRole)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user };
}

/** Editable prompt payload for TG catalog modal. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;

  const { kind, id } = await ctx.params;

  if (kind === "photo") {
    const row = await prisma.photoTemplate.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      kind,
      id,
      title: row.title,
      mode: "photo" as const,
      editPrompt: row.editPrompt || "",
    });
  }

  if (kind === "lora_i2v") {
    const row = await prisma.loraI2vTemplate.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const plan = parseLoraI2vShotsPlan(row.shotsJson);
    const shots = resolveLoraI2vShots({
      shotsJson: row.shotsJson,
      stillPrompt: row.stillPrompt,
      i2vPrompt: row.i2vPrompt,
      negativePrompt: row.negativePrompt,
      durationSec: row.durationSec,
    });
    return NextResponse.json({
      ok: true,
      kind,
      id,
      title: row.title,
      mode: shots.length > 1 ? ("multi" as const) : ("single" as const),
      stillPrompt: row.stillPrompt || shots[0]?.stillPrompt || "",
      i2vPrompt: row.i2vPrompt || shots[0]?.i2vPrompt || "",
      shots: shots.map((s) => ({
        id: s.id,
        stillPrompt: s.stillPrompt,
        i2vPrompt: s.i2vPrompt,
        durationSec: s.durationSec,
      })),
      billingWaiveLastShot: Boolean(plan?.billingWaiveLastShot),
    });
  }

  if (kind === "video") {
    const row = await prisma.quickVideoTemplate.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const story = parseStoryH3Template(row.shotsJson || "");
    if (story) {
      return NextResponse.json({
        ok: true,
        kind,
        id,
        title: row.title,
        mode: "story" as const,
        prompt: story.prompt,
        totalDurationSec: story.totalDurationSec,
      });
    }
    const qv = parseQuickVideoShotsPlan(row.shotsJson || "");
    if (qv?.shots?.length) {
      return NextResponse.json({
        ok: true,
        kind,
        id,
        title: row.title,
        mode: "shots" as const,
        shots: qv.shots.map((s) => ({
          id: s.id,
          legoQuery: s.legoQuery,
          durationSec: s.durationSec,
        })),
        totalDurationSec: qv.totalDurationSec,
      });
    }
    return NextResponse.json({
      ok: true,
      kind,
      id,
      title: row.title,
      mode: "raw" as const,
      prompt: row.shotsJson || "",
    });
  }

  return NextResponse.json({ error: "unknown kind" }, { status: 400 });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await assertLab();
  if ("error" in gate && gate.error) return gate.error;

  const { kind, id } = await ctx.params;
  const body = patchSchema.parse(await req.json().catch(() => ({})));

  try {
    if (kind === "photo") {
      if (body.title !== undefined) {
        await prisma.photoTemplate.update({
          where: { id },
          data: { title: body.title.trim() },
        });
      }
      if (body.editPrompt !== undefined) {
        await prisma.photoTemplate.update({
          where: { id },
          data: { editPrompt: body.editPrompt.trim() },
        });
      }
      if (body.displayTitle !== undefined || body.sortOrder !== undefined) {
        await updatePhotoTemplateTgMeta(id, {
          displayTitle: body.displayTitle,
          sortOrder: body.sortOrder,
        });
      }
      if (body.tgPublished === true) {
        await publishPhotoTemplateToTg(id, {
          displayTitle: body.displayTitle,
        });
      } else if (body.tgPublished === false) {
        await unpublishPhotoTemplateFromTg(id);
      }
      const template = await prisma.photoTemplate.findUnique({ where: { id } });
      return NextResponse.json({ ok: true, template });
    }

    if (kind === "video") {
      if (body.title !== undefined) {
        await prisma.quickVideoTemplate.update({
          where: { id },
          data: { title: body.title.trim() },
        });
      }

      const existing = await prisma.quickVideoTemplate.findUnique({
        where: { id },
        select: { shotsJson: true, durationSec: true },
      });
      if (!existing) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }

      if (body.prompt !== undefined || body.shots !== undefined) {
        const story = parseStoryH3Template(existing.shotsJson || "");
        const qv = parseQuickVideoShotsPlan(existing.shotsJson || "");
        let nextShotsJson = existing.shotsJson;
        let nextDuration = existing.durationSec;

        if (story || (body.prompt !== undefined && !qv && !body.shots)) {
          const prompt = (body.prompt ?? story?.prompt ?? "").trim();
          if (prompt.length < 20) {
            return NextResponse.json(
              { error: "Промпт слишком короткий" },
              { status: 400 },
            );
          }
          const totalDurationSec =
            story?.totalDurationSec || existing.durationSec || 8;
          nextShotsJson = serializeStoryH3Template({
            prompt,
            totalDurationSec,
            bodyLookbook: story?.bodyLookbook,
          });
          nextDuration = totalDurationSec;
        } else if (qv || body.shots) {
          const shots = (body.shots || qv?.shots || []).map((s, i) => ({
            id: s.id || `shot-${i + 1}`,
            durationSec: Math.max(1, Number(s.durationSec) || 1),
            legoQuery: String(
              s.legoQuery !== undefined
                ? s.legoQuery
                : (qv?.shots?.[i]?.legoQuery ?? ""),
            ).trim(),
          }));
          if (!shots.length || shots.some((s) => !s.legoQuery)) {
            return NextResponse.json(
              { error: "Нужен промпт для каждого шота" },
              { status: 400 },
            );
          }
          const totalDurationSec = shots.reduce((a, s) => a + s.durationSec, 0);
          nextShotsJson = serializeQuickVideoShotsPlan({
            totalDurationSec,
            shots,
          });
          nextDuration = totalDurationSec;
        } else if (body.prompt !== undefined) {
          nextShotsJson = body.prompt;
        }

        await prisma.quickVideoTemplate.update({
          where: { id },
          data: {
            shotsJson: nextShotsJson,
            durationSec: nextDuration,
          },
        });
      }

      if (body.displayTitle !== undefined || body.sortOrder !== undefined) {
        await updateQuickVideoTemplateTgMeta(id, {
          displayTitle: body.displayTitle,
          sortOrder: body.sortOrder,
        });
      }
      if (body.tgPublished === true) {
        await publishQuickVideoTemplateToTg(id, {
          displayTitle: body.displayTitle,
        });
      } else if (body.tgPublished === false) {
        await unpublishQuickVideoTemplateFromTg(id);
      }
      const template = await prisma.quickVideoTemplate.findUnique({ where: { id } });
      return NextResponse.json({ ok: true, template });
    }

    if (kind === "lora_i2v") {
      if (body.title !== undefined) {
        await prisma.loraI2vTemplate.update({
          where: { id },
          data: { title: body.title.trim() },
        });
      }

      const existing = await prisma.loraI2vTemplate.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }

      if (
        body.shots !== undefined ||
        body.stillPrompt !== undefined ||
        body.i2vPrompt !== undefined
      ) {
        const prevPlan = parseLoraI2vShotsPlan(existing.shotsJson);
        const prevShots = resolveLoraI2vShots({
          shotsJson: existing.shotsJson,
          stillPrompt: existing.stillPrompt,
          i2vPrompt: existing.i2vPrompt,
          negativePrompt: existing.negativePrompt,
          durationSec: existing.durationSec,
        });

        let nextShots =
          body.shots !== undefined
            ? body.shots.map((s, i) => ({
                id: s.id || prevShots[i]?.id || `shot-${i + 1}`,
                stillPrompt: String(
                  s.stillPrompt !== undefined
                    ? s.stillPrompt
                    : prevShots[i]?.stillPrompt || "",
                ).trim(),
                i2vPrompt: String(
                  s.i2vPrompt !== undefined
                    ? s.i2vPrompt
                    : prevShots[i]?.i2vPrompt || "",
                ).trim(),
                negativePrompt: prevShots[i]?.negativePrompt || "",
                durationSec: Number(s.durationSec) || prevShots[i]?.durationSec || 6,
              }))
            : prevShots.map((s, i) => ({
                ...s,
                stillPrompt:
                  i === 0 && body.stillPrompt !== undefined
                    ? body.stillPrompt.trim()
                    : s.stillPrompt,
                i2vPrompt:
                  i === 0 && body.i2vPrompt !== undefined
                    ? body.i2vPrompt.trim()
                    : s.i2vPrompt,
              }));

        if (body.shots === undefined && prevShots.length <= 1) {
          nextShots = [
            {
              id: prevShots[0]?.id || "shot-1",
              stillPrompt: (
                body.stillPrompt ??
                prevShots[0]?.stillPrompt ??
                existing.stillPrompt
              ).trim(),
              i2vPrompt: (
                body.i2vPrompt ??
                prevShots[0]?.i2vPrompt ??
                existing.i2vPrompt
              ).trim(),
              negativePrompt: existing.negativePrompt || "",
              durationSec: existing.durationSec || 6,
            },
          ];
        }

        nextShots = nextShots.filter((s) => s.stillPrompt && s.i2vPrompt);
        if (!nextShots.length) {
          return NextResponse.json(
            { error: "Нужны still + i2v промпты" },
            { status: 400 },
          );
        }

        const plan = buildLoraI2vShotsPlan(nextShots, {
          billingWaiveLastShot: Boolean(prevPlan?.billingWaiveLastShot),
        });
        const first = plan.shots[0];
        await prisma.loraI2vTemplate.update({
          where: { id },
          data: {
            stillPrompt: first.stillPrompt,
            i2vPrompt: plan.shots.map((s) => s.i2vPrompt).join("\n\n"),
            shotsJson: JSON.stringify(plan),
            durationSec: plan.totalDurationSec,
          },
        });
      }

      if (body.displayTitle !== undefined || body.sortOrder !== undefined) {
        await updateLoraI2vTemplateTgMeta(id, {
          displayTitle: body.displayTitle,
          sortOrder: body.sortOrder,
        });
      }
      if (body.tgPublished === true) {
        await publishLoraI2vTemplateToTg(id, {
          displayTitle: body.displayTitle,
        });
      } else if (body.tgPublished === false) {
        await unpublishLoraI2vTemplateFromTg(id);
      }
      const template = await prisma.loraI2vTemplate.findUnique({ where: { id } });
      return NextResponse.json({ ok: true, template });
    }

    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
