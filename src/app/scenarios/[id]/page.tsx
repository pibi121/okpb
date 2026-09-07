import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ScenarioEditor } from "@/components/scenario-editor";

export default async function EditScenarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const scenario = await prisma.scenario.findFirst({
    where: { id, userId: user.id },
  });
  if (!scenario) notFound();

  const characters = await prisma.character.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Редактирование</h1>
      <ScenarioEditor characters={characters} initial={scenario} />
    </div>
  );
}
