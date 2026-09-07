import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PRICING, priceShot } from "@/lib/billing";
import { enqueueMockShotRegen } from "@/lib/mock-provider";

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const job = await prisma.renderJob.findFirst({
      where: { id, userId: user.id },
      include: {
        shots: { orderBy: { orderIndex: "asc" } },
        scenario: { select: { id: true, title: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Не найден" }, { status: 404 });
    }
    return NextResponse.json({ job });
  }

  const jobs = await prisma.renderJob.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      scenario: { select: { title: true } },
      shots: {
        select: { id: true, status: true, orderIndex: true, approved: true },
      },
    },
  });

  return NextResponse.json({ jobs });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const body = await req.json();

  if (action === "approve_shot") {
    const shotId = z.string().parse(body.shotId);
    const approved = z.boolean().parse(body.approved ?? true);

    const shot = await prisma.shotJob.findFirst({
      where: { id: shotId, renderJob: { userId: user.id } },
      include: { renderJob: true },
    });
    if (!shot) {
      return NextResponse.json({ error: "Кадр не найден" }, { status: 404 });
    }
    if (shot.renderJob.phase !== "preview") {
      return NextResponse.json(
        { error: "Утверждение доступно для превью кадров" },
        { status: 400 },
      );
    }

    const updated = await prisma.shotJob.update({
      where: { id: shotId },
      data: { approved },
    });
    return NextResponse.json({ shot: updated });
  }

  if (action === "regen_shot") {
    const shotId = z.string().parse(body.shotId);

    const shot = await prisma.shotJob.findFirst({
      where: { id: shotId, renderJob: { userId: user.id } },
      include: { renderJob: true },
    });
    if (!shot) {
      return NextResponse.json({ error: "Кадр не найден" }, { status: 404 });
    }
    if (shot.renderJob.phase !== "preview") {
      return NextResponse.json(
        { error: "Перегенерация только для превью-заказа" },
        { status: 400 },
      );
    }
    if (shot.workflow === "transition_only") {
      return NextResponse.json(
        { error: "Переход перегенерировать нельзя" },
        { status: 400 },
      );
    }

    const charge = Math.max(
      PRICING.regenShotMin,
      priceShot({
        durationSec: shot.durationSec,
        camera: shot.camera,
        actionType: shot.actionType,
        characterCount: 1,
        phase: "preview",
      }),
    );

    if (user.credits < charge) {
      return NextResponse.json(
        {
          error: `Нужно ${charge} кредитов на перегенерацию, у вас ${user.credits}`,
        },
        { status: 402 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { credits: { decrement: charge } },
      });
      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amount: -charge,
          reason: "regen_shot_preview",
          metaJson: JSON.stringify({
            jobId: shot.renderJobId,
            shotId: shot.id,
          }),
        },
      });
      await tx.shotJob.update({
        where: { id: shot.id },
        data: {
          status: "queued",
          stillUrl: null,
          lastFrameUrl: null,
          resultUrl: null,
          approved: false,
          billingCredits: shot.billingCredits + charge,
        },
      });
      await tx.renderJob.update({
        where: { id: shot.renderJobId },
        data: {
          status: "running_still",
          progress: 10,
          totalCredits: { increment: charge },
        },
      });
    });

    enqueueMockShotRegen(shot.renderJobId, shot.id);

    return NextResponse.json({
      ok: true,
      charge,
      balance: user.credits - charge,
      shotId: shot.id,
      jobId: shot.renderJobId,
    });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
