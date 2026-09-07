import { requireUser } from "@/lib/auth";
import { VideoLegoEditorClient } from "@/components/video-lego-editor-client";

export default async function VideoLegoPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Video LEGO — позы и действия</h2>
        <p className="text-sm text-zinc-500">
          Редактор <code className="text-xs">presets/prompt_lego_video.json</code> — тексты,
          которые подставляются в быстрое видео.
        </p>
      </div>
      <VideoLegoEditorClient />
    </div>
  );
}
