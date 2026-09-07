"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const payload = {
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      name: String(form.get("name") || ""),
      ageConfirmed: form.get("ageConfirmed") === "on",
    };

    if (!payload.ageConfirmed) {
      setError("Нужно подтвердить, что вам есть 18 лет");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth?action=register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, ageConfirmed: true }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Ошибка регистрации");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-md flex-col gap-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-peach">
        Peach lab
      </p>
      <h1 className="font-display text-glow text-4xl">Регистрация</h1>
      <p className="text-sm text-zinc-500">
        На старте вы получите 1000 тестовых кредитов. Пополнение добавим позже.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        Имя
        <input
          name="name"
          className="rounded-md border border-zinc-300 px-3 py-2"
          placeholder="Как к вам обращаться"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          required
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Пароль (минимум 6 символов)
        <input
          name="password"
          type="password"
          required
          minLength={6}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input name="ageConfirmed" type="checkbox" className="mt-1" />
        <span>Мне есть 18 лет. Я понимаю, что сервис для взрослых.</span>
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="rounded-full btn-grad px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {loading ? "Создаём…" : "Создать аккаунт"}
      </button>
    </form>
  );
}
