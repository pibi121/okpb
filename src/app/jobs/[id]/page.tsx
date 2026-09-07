import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { JobWatcher } from "@/components/job-watcher";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const job = await prisma.renderJob.findFirst({
    where: { id, userId: user.id },
    include: {
      shots: { orderBy: { orderIndex: "asc" } },
      scenario: { select: { title: true } },
    },
  });
  if (!job) notFound();

  return <JobWatcher initialJob={job} />;
}
