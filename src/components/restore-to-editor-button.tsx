"use client";

import { useRouter } from "next/navigation";
import type { TodayItem } from "@/components/today-generations-strip";
import {
  buildStoryVideoRestorePayload,
  buildVideoRestorePayload,
  isStoryH3Meta,
  requestStoryVideoRestore,
  requestVideoRestore,
  savePhotoRestore,
  saveStoryVideoRestore,
} from "@/lib/generation-restore";

export function RestoreToEditorButton({
  item,
  editor,
  compact,
  forceStoryRestore,
}: {
  item: TodayItem;
  editor: "photo" | "video";
  compact?: boolean;
  /** Story lab strip: always restore into /peach/story-video */
  forceStoryRestore?: boolean;
}) {
  const router = useRouter();

  function restore() {
    const meta = item.meta || {};
    if (editor === "photo") {
      savePhotoRestore({
        legoQuery: String(meta.legoQuery || meta.userNote || item.title || ""),
        characterIds: (meta.characterIds as string[]) || [],
        orientationId: String(meta.orientationId || "9_16"),
      });
      router.push("/peach/photo");
      return;
    }

    const asStory =
      forceStoryRestore ||
      isStoryH3Meta(meta, item.prompt) ||
      isStoryH3Meta(meta, typeof meta.shotsJson === "string" ? meta.shotsJson : null);

    if (asStory) {
      const payload = buildStoryVideoRestorePayload({
        title: item.title || "",
        prompt: item.prompt || item.title || "",
        meta,
      });
      saveStoryVideoRestore(payload);
      requestStoryVideoRestore(payload);
      router.push("/peach/story-video");
      return;
    }

    requestVideoRestore(
      buildVideoRestorePayload({
        title: item.title || "",
        prompt: item.prompt || item.title || "",
        meta,
      }),
    );
    router.push("/peach/video?tab=create");
    document
      .getElementById("quick-video-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <button
      type="button"
      onClick={restore}
      className={
        compact
          ? "rounded-full bg-white/90 px-2 py-1 text-[10px] font-medium text-black"
          : "rounded-lg border border-white/15 px-2 py-1 text-xs hover:border-peach/40"
      }
      title="Вернуть настройки в редактор без автозапуска"
    >
      Изменить
    </button>
  );
}
