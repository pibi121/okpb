"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { displayUserName } from "@/lib/peach-nav";

export function SettingsForm({
  user,
}: {
  user: { email: string; name: string | null; avatarUrl?: string | null };
}) {
  const router = useRouter();
  const [name, setName] = useState(user.name || "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || "");
  const [avatars, setAvatars] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const nick = displayUserName(user.name, user.email);

  useEffect(() => {
    void fetch("/api/peach/avatars/default")
      .then((r) => r.json())
      .then((d) => setAvatars((d.avatars as string[]) || []))
      .catch(() => undefined);
  }, []);

  async function saveProfile() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/peach/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          avatarUrl: avatarUrl || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ошибка");
      setMsg("Профиль сохранён");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (!currentPassword || newPassword.length < 6) {
      setErr("Новый пароль — минимум 6 символов");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/peach/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ошибка");
      setMsg("Пароль обновлён");
      setCurrentPassword("");
      setNewPassword("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-8">
      <section className="rounded-2xl border border-white/10 bg-[#121214] p-5">
        <h3 className="font-medium">Профиль</h3>
        <p className="mt-1 text-xs text-zinc-500">Отображаемое имя: {nick}</p>
        <label className="mt-4 block text-sm">
          <span className="text-zinc-500">Имя в кабинете</span>
          <input
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Как тебя называть"
          />
        </label>
        <p className="mt-2 text-xs text-zinc-600">{user.email}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveProfile()}
          className="mt-4 rounded-full bg-peach px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          Сохранить профиль
        </button>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#121214] p-5">
        <h3 className="font-medium">Аватар</h3>
        <div className="mt-3 flex items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-peach/40 to-orange-700/30 text-2xl">
              🍑
            </div>
          )}
          <p className="text-sm text-zinc-500">Выбери персик из коллекции</p>
        </div>
        {avatars.length ? (
          <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-6">
            {avatars.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setAvatarUrl(url)}
                className={
                  avatarUrl === url
                    ? "overflow-hidden rounded-full ring-2 ring-peach"
                    : "overflow-hidden rounded-full ring-1 ring-white/10 hover:ring-peach/50"
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#121214] p-5">
        <h3 className="font-medium">Пароль</h3>
        <label className="mt-3 block text-sm">
          <span className="text-zinc-500">Текущий пароль</span>
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm">
          <span className="text-zinc-500">Новый пароль</span>
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void changePassword()}
          className="mt-4 rounded-full border border-white/15 px-4 py-2 text-sm hover:border-peach/40"
        >
          Сменить пароль
        </button>
      </section>

      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
    </div>
  );
}
