"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TemplateFolderCreate() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/peach/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), idea: idea.trim() || undefined }),
      });
      const data = (await res.json()) as { pack?: { id: string }; error?: string };
      if (!res.ok) throw new Error(data.error || "ошибка");
      router.push(`/peach/templates/${data.pack!.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h3 className="text-sm font-medium">Новая папка шаблона</h3>
      <p className="mt-1 text-xs text-zinc-500">
        Создай папку здесь. Дальше: фото в лабе → оживить → из галереи «В шаблон».
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <input
          className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
          placeholder="Название, напр. «Нападение на пробежке»"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="min-h-[72px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
          placeholder="Краткая идея (необязательно)"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />
        {err ? <p className="text-xs text-red-400">{err}</p> : null}
        <button
          type="button"
          disabled={busy || !title.trim()}
          className="rounded-xl bg-peach/90 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          onClick={() => void create()}
        >
          {busy ? "Создаю…" : "Создать папку"}
        </button>
      </div>
    </div>
  );
}
