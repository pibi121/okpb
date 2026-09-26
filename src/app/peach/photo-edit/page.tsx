import { requireUser } from "@/lib/auth";
import { loadLegoFile } from "@/lib/prompt-lego";
import { loadPromptTemplates } from "@/lib/prompt-templates";
import { PhotoEditLabClient } from "@/components/photo-edit-lab-client";

export default async function PeachPhotoEditLabPage() {
  const user = await requireUser();
  if (!user) return null;

  const lego = loadLegoFile();
  const templates = loadPromptTemplates();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">Позы · Photo Edit (воронка)</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Identity Edit → сохранить шаблон с названием кнопки, описанием,
          видео-тизером и промптами оживления 3 / 7 / 12 сек.
        </p>
      </div>
      <PhotoEditLabClient
        poses={templates.poses}
        lego={{
          lighting: lego.lighting,
          events: lego.events,
          stylization: lego.stylization,
          body: lego.body || [],
        }}
      />
    </div>
  );
}
