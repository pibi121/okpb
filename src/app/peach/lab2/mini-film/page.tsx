import { Lab2MiniFilmClient } from "@/components/lab2-mini-film-client";
import { requireUser } from "@/lib/auth";
import { loadVideoLegoFile } from "@/lib/prompt-lego";

export default async function Lab2MiniFilmPage() {
  const user = await requireUser();
  if (!user) return null;
  const videoLego = loadVideoLegoFile();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium">Мини-фильм · 2 героя + шоты</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          Отработка сюжетных шаблонов: фото героя 1 и героя 2 на все шоты,
          опционально одно видео позы/движения, промпт на каждый шот (сумма до
          12 сек). После успешного теста — «В шаблон», затем{" "}
          <a href="/peach/lab2/transfer" className="text-peach underline">
            Перенос Funnel v2
          </a>
          .
        </p>
      </div>
      <Lab2MiniFilmClient videoLego={videoLego} />
    </div>
  );
}
