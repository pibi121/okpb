import { StoryVideoLabClient } from "@/components/story-video-lab-client";
import { StoryVideoTemplatesPanel } from "@/components/story-video-templates-panel";
import { requireUser } from "@/lib/auth";

export default async function StoryVideoLabPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium">Story H3 · видео по 1 фото</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500">
          Создание шаблона через MiniMax H3 (как раньше) + редактор уже
          существующих для TG-воронки: кнопка, описание, тизер, категории,
          публикация.
        </p>
      </div>
      <StoryVideoTemplatesPanel />
      <div className="border-t border-white/10 pt-6">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">
          Создать новый шаблон
        </h2>
        <StoryVideoLabClient />
      </div>
    </div>
  );
}
