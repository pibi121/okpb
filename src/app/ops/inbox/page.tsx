"use client";

import { useEffect, useState } from "react";
import { fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Thread = {
  userId: string;
  tgId: string;
  name: string | null;
  locale: string;
  lastText: string;
  lastAt: string;
  unread: boolean;
};

type Msg = {
  id: string;
  direction: string;
  text: string;
  createdAt: string;
  readAt: string | null;
};

export default function OpsInboxPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [active, setActive] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [userLabel, setUserLabel] = useState("");
  const [reply, setReply] = useState("");
  const [msg, setMsg] = useState("");

  async function loadThreads() {
    const d = await opsFetch<{ threads: Thread[]; unreadTotal: number }>(
      "/api/ops/inbox",
    );
    setThreads(d.threads);
    setUnreadTotal(d.unreadTotal);
  }

  async function openThread(userId: string) {
    setActive(userId);
    setReply("");
    const d = await opsFetch<{
      user: { tgId: string; name: string | null } | null;
      messages: Msg[];
    }>(`/api/ops/inbox?userId=${encodeURIComponent(userId)}`);
    setMessages(d.messages);
    setUserLabel(
      d.user
        ? `${d.user.name || "—"} · TG ${d.user.tgId}`
        : userId.slice(0, 10),
    );
    await loadThreads();
  }

  useEffect(() => {
    void loadThreads().catch((e) =>
      setMsg(e instanceof Error ? e.message : "ошибка"),
    );
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Входящие</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Сообщения людей в бота вне сценариев (имя/фото/меню). Непрочитанных:{" "}
          <b className="text-peach">{unreadTotal}</b>
        </p>
      </div>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <ul className="max-h-[70vh] overflow-auto rounded-2xl border border-white/10">
          {threads.length === 0 ? (
            <li className="p-4 text-sm text-zinc-500">Пока пусто</li>
          ) : (
            threads.map((t) => (
              <li key={t.userId}>
                <button
                  type="button"
                  className={`w-full border-b border-white/8 px-3 py-3 text-left text-sm hover:bg-white/5 ${
                    active === t.userId ? "bg-white/8" : ""
                  }`}
                  onClick={() => void openThread(t.userId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-200">
                      {t.name || `TG ${t.tgId}`}
                      {t.unread ? (
                        <span className="ml-2 rounded-full bg-peach/20 px-1.5 py-0.5 text-[10px] text-peach">
                          new
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {fmtTime(t.lastAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                    {t.lastText}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="flex min-h-[420px] flex-col rounded-2xl border border-white/10">
          {active ? (
            <>
              <div className="border-b border-white/8 px-4 py-3 text-sm text-zinc-300">
                {userLabel}
              </div>
              <div className="flex-1 space-y-2 overflow-auto p-4">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      m.direction === "inbound"
                        ? "bg-white/8 text-zinc-200"
                        : "ml-auto bg-peach/15 text-peach"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    <div className="mt-1 text-[10px] opacity-50">
                      {fmtTime(m.createdAt)} ·{" "}
                      {m.direction === "inbound" ? "от человека" : "наш ответ"}
                    </div>
                  </div>
                ))}
              </div>
              <form
                className="flex gap-2 border-t border-white/8 p-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!reply.trim()) return;
                  try {
                    await opsFetch("/api/ops/inbox", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "reply",
                        userId: active,
                        text: reply,
                      }),
                    });
                    setReply("");
                    setMsg("Ответ ушёл в Telegram");
                    await openThread(active);
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : "ошибка");
                  }
                }}
              >
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Ответ человеку…"
                  className="flex-1 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm"
                />
                <button className="rounded-full btn-grad px-4 py-2 text-sm self-end">
                  Ответить
                </button>
              </form>
            </>
          ) : (
            <p className="m-auto text-sm text-zinc-500">Выбери диалог слева</p>
          )}
        </div>
      </div>
    </div>
  );
}
