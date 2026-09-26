import { requireUser } from "@/lib/auth";
import { Lab2HubClient } from "@/components/lab2-hub-client";

export default async function Lab2HubPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-peach/80">
          Лаборатория 2.0
        </p>
        <h1 className="mt-1 font-display text-2xl text-foreground">
          Воронка · генерации
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500">
          Здесь только разделы, нужные для новой TG-воронки (позы, видео по 1
          фото, tease, каталог). Старая «Лаборатория» со всеми eval/legacy —
          отдельным переключателем слева.
        </p>
      </div>
      <Lab2HubClient />
    </div>
  );
}
