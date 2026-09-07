import { loadPromptTemplates } from "@/lib/prompt-templates";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TesterLab } from "@/components/tester-lab";
import { summarizeSessions } from "@/lib/tester-jobs";

export default async function PeachTesterPage() {
  const user = await requireUser();
  if (!user) return null;

  const [characters, templates, sessions] = await Promise.all([
    prisma.character.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    }),
    Promise.resolve(loadPromptTemplates()),
    prisma.testSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { variants: { orderBy: { index: "asc" } } },
    }),
  ]);

  const summary = summarizeSessions(sessions);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Тестировщик</h2>
        <p className="text-sm text-zinc-600">
          Матрица: персонаж / поза / стиль независимо. Одна ячейка → один
          промпт LLM → несколько seed. Оценивай +/− по качеству, лицу, промпту,
          позе.
        </p>
      </div>
      <TesterLab
        characters={characters.map((c) => ({
          id: c.id,
          name: c.name,
          loraStatus: c.loraStatus,
          triggerWord: c.triggerWord,
        }))}
        poses={templates.poses.map((p) => ({ id: p.id, label: p.label }))}
        styles={templates.styles.map((s) => ({ id: s.id, label: s.label }))}
        initialSessions={sessions.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
        }))}
        initialSummary={summary}
      />
    </div>
  );
}
