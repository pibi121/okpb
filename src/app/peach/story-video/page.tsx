import { StoryVideoLabClient } from "@/components/story-video-lab-client";
import { requireUser } from "@/lib/auth";

export default async function StoryVideoLabPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">Story H3 видео</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          Кастомная модель прямо здесь: фото-рефы + имя + тело + H3-промпт от Grok. Без выбора из
          библиотеки персонажей. В шаблон уходит сюжетный промпт и структура слотов/тела — identity
          подставляет пользователь при генерации.
        </p>
      </div>
      <StoryVideoLabClient />
    </div>
  );
}
