"use client";

import { useState } from "react";
import { QuickVideoSaveTemplateModal } from "@/components/quick-video-save-template-modal";

export function SaveQuickVideoTemplateButton({
  sourceRunId,
  defaultTitle,
  onSaved,
}: {
  sourceRunId: string;
  defaultTitle?: string | null;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="rounded border border-peach/40 bg-peach/10 px-2 py-1 text-xs text-peach"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        В шаблон
      </button>
      <QuickVideoSaveTemplateModal
        open={open}
        sourceRunId={sourceRunId}
        defaultTitle={defaultTitle || "Quick video"}
        onClose={() => setOpen(false)}
        onSaved={onSaved}
      />
    </>
  );
}
