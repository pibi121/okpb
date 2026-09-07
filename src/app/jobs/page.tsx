import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function JobsPage() {
  const user = await requireUser();
  if (!user) redirect("/login");

  const jobs = await prisma.renderJob.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { scenario: { select: { title: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Заказы</h1>
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
        {jobs.length === 0 ? (
          <li className="p-4 text-sm text-zinc-500">Заказов пока нет</li>
        ) : (
          jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-zinc-50"
              >
                <div>
                  <div className="font-medium">
                    {job.scenario?.title || "Без сценария"}
                  </div>
                  <div className="text-sm text-zinc-500">
                    {job.status} · {job.progress}% · {job.totalCredits} кр.
                  </div>
                </div>
                <span className="text-xs text-zinc-400">
                  {job.createdAt.toLocaleString("ru-RU")}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
