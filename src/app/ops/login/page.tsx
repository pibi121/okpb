"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OpsLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/ops/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") || ""),
        password: String(form.get("password") || ""),
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Не войти");
      return;
    }
    router.push("/ops");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4"
    >
      <p className="text-[11px] uppercase tracking-[0.22em] text-peach">Служебный вход</p>
      <h1 className="font-display text-4xl text-glow">Панель</h1>
      <p className="text-sm text-zinc-500">Только для команды. Обычный кабинет — другой адрес.</p>
      <label className="flex flex-col gap-1 text-sm">
        Логин или почта
        <input
          name="email"
          type="text"
          autoComplete="username"
          required
          placeholder="логин или email"
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Пароль
        <input
          name="password"
          type="password"
          required
          className="rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-coral">{error}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="rounded-full btn-grad px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {loading ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
