import { Lab2MiniFilmClient } from "@/components/lab2-mini-film-client";
import { requireUser } from "@/lib/auth";

export default async function Lab2MiniFilmPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium">Мини-фильм · 2 героя + шоты</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          Два identity-фото, опционально Video 1. Каждый шот — отдельная
          пробная генерация (H3-промпт, без LEGO), потом склейка → шаблон →{" "}
          <a href="/peach/lab2/transfer" className="text-peach underline">
            Перенос Funnel v2
          </a>
          .
        </p>
      </div>
      <Lab2MiniFilmClient />
    </div>
  );
}
