import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  planShotsFromGraph,
  totalCredits,
  PRICING,
  type ScenarioGraph,
} from "@/lib/billing";
import { enqueueMockJob } from "@/lib/mock-provider";
import { reviewScenario } from "@/lib/scenario-review";

const saveSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(120),
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }),
});

async function characterNameMap(userId: string) {
  const list = await prisma.character.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  return Object.fromEntries(list.map((c) => [c.id, c.name]));
}

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const scenarios = await prisma.scenario.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ scenarios });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "save";
  const body = await req.json();

  if (
    action === "quote" ||
    action === "preview" ||
    action === "animate" ||
    action === "render" ||
    action === "review"
  ) {
    const scenarioId = z.string().parse(body.scenarioId);
    const scenario = await prisma.scenario.findFirst({
      where: { id: scenarioId, userId: user.id },
    });
    if (!scenario) {
      return NextResponse.json({ error: "Сценарий не найден" }, { status: 404 });
    }

    const graph = JSON.parse(scenario.graphJson) as ScenarioGraph;
    const names = await characterNameMap(user.id);

    if (action === "review") {
      const result = reviewScenario(graph, names);
      if (!result.ok) {
        return NextResponse.json({ errors: result.errors }, { status: 400 });
      }

      const price = PRICING.scenarioReview;
      if (user.credits < price) {
        return NextResponse.json(
          { error: `Нужно ${price} кредитов на проверку, у вас ${user.credits}` },
          { status: 402 },
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { credits: { decrement: price } },
        });
        await tx.ledgerEntry.create({
          data: {
            userId: user.id,
            amount: -price,
            reason: "scenario_review",
            metaJson: JSON.stringify({ scenarioId }),
          },
        });
      });

      return NextResponse.json({
        review: result.review,
        balance: user.credits - price,
      });
    }

    const phase =
      action === "preview"
        ? "preview"
        : action === "animate"
          ? "animate"
          : action === "render"
            ? "full"
            : "full";

    const planned = planShotsFromGraph(graph, {
      fallbackCharacterId: body.characterId,
      phase: action === "quote" ? "full" : phase,
      characterNames: names,
    });

    const credits =
      action === "quote"
        ? {
            preview: totalCredits(
              planShotsFromGraph(graph, { phase: "preview" }).shots,
            ),
            animate: totalCredits(
              planShotsFromGraph(graph, { phase: "animate" }).shots,
            ),
            review: PRICING.scenarioReview,
          }
        : totalCredits(planned.shots);

    if (planned.errors.length) {
      return NextResponse.json(
        { errors: planned.errors, warnings: planned.warnings, credits: 0 },
        { status: 400 },
      );
    }

    if (action === "quote") {
      return NextResponse.json({
        credits,
        warnings: planned.warnings,
        shots: planned.shots,
        balance: user.credits,
      });
    }

    const charge = credits as number;
    if (user.credits < charge) {
      return NextResponse.json(
        {
          error: `Не хватает кредитов. Нужно ${charge}, у вас ${user.credits}`,
        },
        { status: 402 },
      );
    }

    const job = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { credits: { decrement: charge } },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: user.id,
          amount: -charge,
          reason: `render_${phase}`,
          metaJson: JSON.stringify({ scenarioId, phase }),
        },
      });

      return tx.renderJob.create({
        data: {
          userId: user.id,
          scenarioId: scenario.id,
          characterId: planned.shots[0]?.characterId,
          phase,
          status: "queued",
          totalCredits: charge,
          shotsJson: JSON.stringify(planned.shots),
          shots: {
            create: planned.shots.map((s) => ({
              orderIndex: s.orderIndex,
              actionType: s.actionType,
              actionPrompt: s.actionPrompt,
              dialogueText: s.dialogueText,
              camera: s.camera,
              locationJson: JSON.stringify(s.location),
              audioJson: s.audio ? JSON.stringify(s.audio) : null,
              durationSec: s.durationSec,
              billingCredits: s.billingCredits,
              workflow: s.workflow,
              continuity: s.continuity,
              status: "queued",
            })),
          },
        },
        include: { shots: true },
      });
    });

    enqueueMockJob(job.id);

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        phase: job.phase,
        totalCredits: job.totalCredits,
      },
      warnings: planned.warnings,
    });
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный сценарий" }, { status: 400 });
  }

  const graphJson = JSON.stringify(parsed.data.graph);

  if (parsed.data.id) {
    const updated = await prisma.scenario.updateMany({
      where: { id: parsed.data.id, userId: user.id },
      data: { title: parsed.data.title, graphJson },
    });
    if (!updated.count) {
      return NextResponse.json({ error: "Не найден" }, { status: 404 });
    }
    const scenario = await prisma.scenario.findUnique({
      where: { id: parsed.data.id },
    });
    return NextResponse.json({ scenario });
  }

  const scenario = await prisma.scenario.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      graphJson,
    },
  });

  return NextResponse.json({ scenario });
}
