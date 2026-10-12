import { Lab2MiniFilmClient } from "@/components/lab2-mini-film-client";
import { requireUser } from "@/lib/auth";

export default async function Lab2MiniFilmPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium">Мини-фильм · 2 героя + H3</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          Два identity-фото (Picture 1 / 2), опционально Video 1 (поза), один
          полный H3-промпт (6 секций) — без LEGO-табов. После теста — «В
          шаблон», затем{" "}
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
