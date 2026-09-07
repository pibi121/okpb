"use client";

import { useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type TextRow = { slot: string; title: string; textRu: string; textEn: string };
type MediaRow = { dbSlot: string; title: string; mediaUrl: string };

export default function OpsCopyPage() {
  const [texts, setTexts] = useState<TextRow[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await opsFetch<{ texts: TextRow[]; media: MediaRow[] }>("/api/ops/copy");
    setTexts(d.texts);
    setMedia(d.media);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  async function saveText(row: TextRow) {
    await opsFetch("/api/ops/copy", {
      method: "POST",
      body: JSON.stringify(row),
    });
    setMsg("Сохранено. Новый текст уйдёт в следующих сообщениях бота.");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl">Тексты бота</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Русский и английский. Можно жирный через {"<b>текст</b>"}. Медиа — ссылка или file_id из Telegram.
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Картинки и видео воронки</h2>
        <div className="mt-3 flex flex-col gap-3">
          {media.map((m, i) => (
            <form
              key={m.dbSlot}
              className="rounded-2xl border border-white/10 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const url = String(new FormData(e.currentTarget).get("mediaUrl") || "");
                void opsFetch("/api/ops/copy", {
                  method: "POST",
                  body: JSON.stringify({ slot: m.dbSlot, mediaUrl: url }),
                }).then(() => {
                  setMsg("Медиа сохранено");
                  const next = [...media];
                  next[i] = { ...m, mediaUrl: url };
                  setMedia(next);
                });
              }}
            >
              <div className="text-sm">{m.title}</div>
              <input
                name="mediaUrl"
                defaultValue={m.mediaUrl}
                placeholder="https://… или file_id"
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
              />
              <button className="mt-2 text-sm text-peach">Сохранить</button>
            </form>
          ))}
        </div>
      </section>
      {texts.map((t, i) => (
        <form
          key={t.slot}
          className="rounded-2xl border border-white/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const next = {
              ...t,
              textRu: String(f.get("textRu") || ""),
              textEn: String(f.get("textEn") || ""),
            };
            const copy = [...texts];
            copy[i] = next;
            setTexts(copy);
            void saveText(next);
          }}
        >
          <h2 className="text-sm font-medium">{t.title}</h2>
          <textarea name="textRu" defaultValue={t.textRu} rows={6} className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
          <textarea name="textEn" defaultValue={t.textEn} rows={5} className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm" />
          <button className="mt-2 rounded-full btn-grad px-4 py-1.5 text-sm">Сохранить</button>
        </form>
      ))}
    </div>
  );
}
