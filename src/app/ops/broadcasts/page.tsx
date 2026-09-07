"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Row = {
  id: string;
  title: string;
  status: string;
  sentCount: number;
  failCount: number;
  createdAt: string;
};

export default function OpsBroadcastsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [who, setWho] = useState("all");
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  async function load() {
    const d = await opsFetch<{ rows: Row[] }>("/api/ops/broadcasts");
    setRows(d.rows);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  async function uploadFile(file: File) {
    setUploading(true);
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ops/broadcasts/upload", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mediaUrl?: string;
      };
      if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
      if (!data.mediaUrl) throw new Error("Нет URL после загрузки");
      setMediaUrl(data.mediaUrl);
      setMsg("Фото загружено — уйдёт вместе с текстом");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  function readForm(form: HTMLFormElement) {
    const f = new FormData(form);
    return {
      title: String(f.get("title") || ""),
      bodyRu: String(f.get("bodyRu") || ""),
      bodyEn: String(f.get("bodyEn") || ""),
      mediaUrl: mediaUrl.trim(),
      filter: { who, skipQuietDays: 7 },
    };
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Рассылки</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Сначала тест себе, потом счётчик, потом отправка. Можно прикрепить фото с компьютера. Между массовыми — пауза 30 минут.
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <form
        className="flex flex-col gap-2 rounded-2xl border border-white/10 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const payload = readForm(e.currentTarget);
          const created = await opsFetch<{ id: string }>("/api/ops/broadcasts", {
            method: "POST",
            body: JSON.stringify({ action: "create", ...payload }),
          });
          if (!confirm(`Отправить ${count ?? "?"} людям?`)) return;
          await opsFetch("/api/ops/broadcasts", {
            method: "POST",
            body: JSON.stringify({ action: "send", id: created.id }),
          });
          setMsg("Рассылка пошла");
          await load();
        }}
      >
        <input
          name="title"
          placeholder="Название (для себя)"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          required
        />
        <select
          value={who}
          onChange={(e) => setWho(e.target.value)}
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        >
          <option value="all">Все, кто не в блоке</option>
          <option value="paid">Кто пополнял</option>
          <option value="never_paid">Кто не пополнял</option>
          <option value="no_job">Кто ещё не генерил</option>
        </select>
        <textarea
          name="bodyRu"
          rows={4}
          placeholder="Текст RU"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          required
        />
        <textarea
          name="bodyEn"
          rows={3}
          placeholder="Текст EN"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
        />

        <div className="rounded-xl border border-dashed border-white/15 p-3">
          <p className="text-xs text-zinc-500">Фото к рассылке (с компьютера или URL)</p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="mt-2 block w-full text-sm text-zinc-400 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:text-white"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <input
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="Или вставьте https://… URL картинки"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
          {mediaUrl ? (
            <div className="mt-2 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl}
                alt=""
                className="h-24 w-24 rounded-lg object-cover border border-white/10"
              />
              <button
                type="button"
                className="text-xs text-rose-300 underline"
                onClick={() => setMediaUrl("")}
              >
                Убрать фото
              </button>
            </div>
          ) : null}
          {uploading ? <p className="mt-1 text-xs text-zinc-500">Загрузка…</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
            onClick={async () => {
              const form = document.querySelector("form") as HTMLFormElement;
              const payload = readForm(form);
              await opsFetch("/api/ops/broadcasts", {
                method: "POST",
                body: JSON.stringify({
                  action: "test",
                  bodyRu: payload.bodyRu,
                  bodyEn: payload.bodyEn,
                  mediaUrl: payload.mediaUrl,
                }),
              });
              setMsg("Тест ушёл вам в бот");
            }}
          >
            Тест себе
          </button>
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
            onClick={async () => {
              const d = await opsFetch<{ count: number }>("/api/ops/broadcasts", {
                method: "POST",
                body: JSON.stringify({
                  action: "preview",
                  filter: { who, skipQuietDays: 7 },
                }),
              });
              setCount(d.count);
            }}
          >
            Сколько человек: {count ?? "?"}
          </button>
          <button className="rounded-full btn-grad px-4 py-1.5 text-sm">Отправить</button>
        </div>
      </form>
      <ul className="text-sm text-zinc-400">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-white/8 py-2">
            {r.title} · {r.status} · ушло {r.sentCount} · брак {r.failCount} ·{" "}
            {fmtTime(r.createdAt)}
          </li>
        ))}
      </ul>
    </div>
  );
}
