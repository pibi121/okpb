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

type MediaItem = { type: "photo" | "video"; url: string };
type Btn = { text: string; path: string };

const DEFAULT_PRESETS: Btn[] = [
  { text: "Лента", path: "" },
  { text: "Фото по образу", path: "photo" },
  { text: "Видео", path: "video" },
  { text: "Витрина моделей", path: "characters" },
  { text: "Обучить свою", path: "characters?section=train" },
  { text: "Галерея", path: "gallery" },
  { text: "Пополнить", path: "topup" },
];

export default function OpsBroadcastsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [who, setWho] = useState("all");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [presets, setPresets] = useState<Btn[]>(DEFAULT_PRESETS);
  const [testTgId, setTestTgId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [msgTone, setMsgTone] = useState<"ok" | "err">("ok");

  async function load() {
    const d = await opsFetch<{ rows: Row[]; presets?: Btn[] }>(
      "/api/ops/broadcasts",
    );
    setRows(d.rows);
    if (d.presets?.length) setPresets(d.presets);
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  async function uploadFile(file: File) {
    if (media.length >= 2) {
      setMsg("Максимум 2 медиа");
      return;
    }
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
        type?: "photo" | "video";
      };
      if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
      if (!data.mediaUrl) throw new Error("Нет URL после загрузки");
      setMedia((m) => [
        ...m,
        { type: data.type === "video" ? "video" : "photo", url: data.mediaUrl! },
      ]);
      setMsgTone("ok");
      setMsg("Медиа добавлено");
    } catch (e) {
      setMsgTone("err");
      setMsg(e instanceof Error ? e.message : "ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  function addUrlMedia() {
    const u = urlDraft.trim();
    if (!u || media.length >= 2) return;
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(u);
    setMedia((m) => [...m, { type: isVideo ? "video" : "photo", url: u }]);
    setUrlDraft("");
  }

  function readForm(form: HTMLFormElement) {
    const f = new FormData(form);
    return {
      title: String(f.get("title") || ""),
      bodyRu: String(f.get("bodyRu") || ""),
      bodyEn: String(f.get("bodyEn") || ""),
      mediaUrl: media[0]?.url || "",
      mediaJson: JSON.stringify(media),
      buttonsJson: JSON.stringify(buttons),
      filter: { who, skipQuietDays: 7 },
    };
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Рассылки</h1>
        <p className="mt-1 text-sm text-zinc-500">
          До 2 медиа (фото/видео), текст, кнопки в разделы мини-аппа. Сначала тест
          на TG id, потом счётчик, потом отправка. Между массовыми — 30 минут.
        </p>
      </div>
      {msg ? (
        <p
          className={`text-sm ${msgTone === "err" ? "text-rose-300" : "text-emerald-300"}`}
        >
          {msg}
        </p>
      ) : null}
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
          <p className="text-xs text-zinc-500">
            Медиа (до 2): фото или видео с компьютера / URL
          </p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,.jpg,.jpeg,.png,.webp,.mp4,.webm"
            className="mt-2 block w-full text-sm text-zinc-400 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:text-white"
            disabled={uploading || media.length >= 2}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
              e.target.value = "";
            }}
          />
          <div className="mt-2 flex gap-2">
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://… фото или mp4"
              className="flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="rounded-full border border-white/15 px-3 py-1.5 text-sm"
              onClick={addUrlMedia}
            >
              + URL
            </button>
          </div>
          {media.length ? (
            <ul className="mt-2 space-y-2">
              {media.map((m, i) => (
                <li key={`${m.url}-${i}`} className="flex items-center gap-3 text-xs">
                  {m.type === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.url}
                      alt=""
                      className="h-16 w-16 rounded-lg object-cover border border-white/10"
                    />
                  ) : (
                    <span className="rounded bg-white/10 px-2 py-1">🎬 video</span>
                  )}
                  <span className="truncate text-zinc-400">{m.url}</span>
                  <button
                    type="button"
                    className="text-rose-300 underline"
                    onClick={() =>
                      setMedia((list) => list.filter((_, j) => j !== i))
                    }
                  >
                    убрать
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {uploading ? <p className="mt-1 text-xs text-zinc-500">Загрузка…</p> : null}
        </div>

        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs text-zinc-500">
            Кнопки → разделы мини-аппа (web_app). Пресеты или свой path.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={`${p.text}-${p.path}`}
                type="button"
                className="rounded-full border border-white/15 px-2.5 py-1 text-xs"
                onClick={() => {
                  if (buttons.length >= 6) return;
                  if (buttons.some((b) => b.path === p.path && b.text === p.text))
                    return;
                  setButtons((b) => [...b, p]);
                }}
              >
                + {p.text}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              id="btnText"
              placeholder="Текст кнопки"
              className="w-1/3 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
            />
            <input
              id="btnPath"
              placeholder='path: photo / video?templateId=… / characters'
              className="flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="rounded-full border border-white/15 px-3 py-1.5 text-sm"
              onClick={() => {
                const text = (
                  document.getElementById("btnText") as HTMLInputElement
                )?.value?.trim();
                const path = (
                  document.getElementById("btnPath") as HTMLInputElement
                )?.value?.trim();
                if (!text || !path || buttons.length >= 6) return;
                setButtons((b) => [...b, { text, path }]);
              }}
            >
              +
            </button>
          </div>
          {buttons.length ? (
            <ul className="mt-2 space-y-1 text-xs text-zinc-300">
              {buttons.map((b, i) => (
                <li key={`${b.path}-${i}`} className="flex justify-between gap-2">
                  <span>
                    {b.text} → <code className="text-zinc-500">/tg/{b.path}</code>
                  </span>
                  <button
                    type="button"
                    className="text-rose-300 underline"
                    onClick={() =>
                      setButtons((list) => list.filter((_, j) => j !== i))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-xs text-zinc-500">
            Тестовое сообщение — укажи свой Telegram user id (цифры)
          </p>
          <input
            value={testTgId}
            onChange={(e) => setTestTgId(e.target.value)}
            placeholder="Например 123456789"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={testing}
            className="rounded-full border border-white/15 px-4 py-1.5 text-sm disabled:opacity-50"
            onClick={async () => {
              const form = document.querySelector("form") as HTMLFormElement;
              if (!form) {
                setMsgTone("err");
                setMsg("Форма не найдена");
                return;
              }
              const payload = readForm(form);
              if (!payload.bodyRu.trim() && media.length === 0) {
                setMsgTone("err");
                setMsg("Заполни текст RU или добавь медиа");
                return;
              }
              if (!testTgId.trim()) {
                setMsgTone("err");
                setMsg("Укажи свой Telegram user id (цифры) для теста");
                return;
              }
              setTesting(true);
              setMsg("");
              try {
                await opsFetch("/api/ops/broadcasts", {
                  method: "POST",
                  body: JSON.stringify({
                    action: "test",
                    bodyRu: payload.bodyRu,
                    bodyEn: payload.bodyEn,
                    mediaUrl: payload.mediaUrl,
                    mediaJson: payload.mediaJson,
                    buttonsJson: payload.buttonsJson,
                    testTgId: testTgId.trim(),
                  }),
                });
                setMsgTone("ok");
                setMsg(`Тест ушёл на TG ${testTgId.trim()}`);
              } catch (e) {
                setMsgTone("err");
                setMsg(e instanceof Error ? e.message : "Ошибка теста");
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "Отправляю…" : "Тестовое сообщение"}
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
          <button className="rounded-full btn-grad px-4 py-1.5 text-sm">
            Отправить
          </button>
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
