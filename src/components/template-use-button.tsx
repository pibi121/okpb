"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TemplateUseButton({
  packId,
  label = "Использовать как пользователь",
}: {
  packId: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function start() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/peach/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = (await res.json()) as { run?: { id: string }; error?: string };
      if (!res.ok || !data.run) throw new Error(data.error || "не удалось начать");
      router.push(`/peach/play/${data.run.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        className="rounded-lg border border-peach/40 bg-peach/15 px-3 py-1.5 text-xs text-peach disabled:opacity-50"
        onClick={() => void start()}
      >
        {busy ? "Открываю…" : label}
      </button>
      {err ? <span className="text-[11px] text-red-400">{err}</span> : null}
    </span>
  );
}
