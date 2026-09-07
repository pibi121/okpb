import { prisma } from "@/lib/db";

export type KbKind = "success" | "fix" | "rule";

export async function logKbEntry(opts: {
  userId: string;
  templatePackId?: string;
  kind: KbKind;
  text: string;
  tags?: string[];
  frameIndex?: number;
}) {
  const text = opts.text.trim();
  if (!text) return;
  await prisma.promptKbEntry.create({
    data: {
      userId: opts.userId,
      templatePackId: opts.templatePackId || null,
      kind: opts.kind,
      text,
      tagsJson: JSON.stringify(opts.tags || []),
      frameIndex: opts.frameIndex ?? null,
    },
  });
}

export async function logPublishedTemplateKb(
  userId: string,
  packId: string,
  title: string,
  frames: { index: number; beat: string; stillPrompt: string; videoPrompt: string; never: string }[],
) {
  const tags = [title.toLowerCase()];
  for (const f of frames) {
    if (f.beat.trim()) {
      await logKbEntry({
        userId,
        templatePackId: packId,
        kind: "success",
        text: `Beat ${f.index + 1}: ${f.beat}\nStill: ${f.stillPrompt}\nVideo: ${f.videoPrompt}${f.never ? `\nNever: ${f.never}` : ""}`,
        tags,
        frameIndex: f.index,
      });
    }
  }
  await logKbEntry({
    userId,
    templatePackId: packId,
    kind: "rule",
    text: `Published template «${title}» — ${frames.length} beats. Reuse prompts with other characters; swap character refs only.`,
    tags,
  });
}

/** Simple tag overlap search until vector embeddings land. */
export async function searchKbByQuery(userId: string, query: string, limit = 8) {
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!q.length) return [];
  const rows = await prisma.promptKbEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const scored = rows
    .map((r) => {
      const hay = `${r.text} ${r.tagsJson}`.toLowerCase();
      const score = q.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ r }) => r);
}
