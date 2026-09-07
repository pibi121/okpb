import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ScenarioEditor } from "@/components/scenario-editor";

export default async function NewScenarioPage() {
  const user = await requireUser();
  if (!user) redirect("/login");

  const characters = await prisma.character.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Новый сценарий</h1>
      {characters.length === 0 ? (
        <p className="text-sm text-amber-700">
          Сначала создайте персонажа в разделе «Персонажи».
        </p>
      ) : null}
      <ScenarioEditor characters={characters} />
    </div>
  );
}
