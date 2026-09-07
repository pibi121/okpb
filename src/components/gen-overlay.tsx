"use client";

import { BorderBeam } from "./border-beam";
import { ImageGeneration } from "./image-generation";

export function GenOverlay({
  open,
  title,
  hint,
}: {
  open: boolean;
  title?: string;
  hint?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <BorderBeam className="w-full max-w-sm" pulse="outer">
        <div className="bg-[#121214] p-2">
          <div className="relative aspect-[3/4]">
            <ImageGeneration
              fill
              label={title || "Генерация…"}
              prompt={hint || "Krea на GPU · обычно 20–60 сек"}
              resolution="Krea"
            />
          </div>
        </div>
      </BorderBeam>
    </div>
  );
}
