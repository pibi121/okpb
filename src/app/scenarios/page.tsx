import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function ScenariosPage() {
  const user = await requireUser();
  if (!user) redirect("/login");

  const scenarios = await prisma.scenario.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Сценарии</h1>
        <Link
          href="/scenarios/new"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
        >
          Новый сценарий
        </Link>
      </div>

      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
        {scenarios.length === 0 ? (
          <li className="p-4 text-sm text-zinc-500">Пока нет сценариев</li>
        ) : (
          scenarios.map((s) => (
            <li key={s.id}>
              <Link
                href={`/scenarios/${s.id}`}
                className="flex items-center justify-between p-4 hover:bg-zinc-50"
              >
                <span className="font-medium">{s.title}</span>
                <span className="text-xs text-zinc-400">
                  {s.updatedAt.toLocaleString("ru-RU")}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
