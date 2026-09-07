"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CharacterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setLoading(true);
    setError("");

    const form = new FormData(formEl);
    const consent = form.get("consentGiven") === "on";
    if (!consent) {
      setError("Нужно согласие на использование лица");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") || ""),
        description: String(form.get("description") || ""),
        photoCount: Number(form.get("photoCount") || 20),
        consentGiven: true,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Не удалось создать");
      return;
    }

    formEl.reset();
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex max-w-lg flex-col gap-3 rounded-lg border border-zinc-200 p-4"
    >
      <h2 className="font-medium">Новый персонаж</h2>
      <p className="text-sm text-zinc-600">
        Пока загрузка фото и обучение LoRA — заглушка. Персонаж сразу становится
        «готовым», чтобы можно было собирать сценарии.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        Имя персонажа
        <input
          name="name"
          required
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Описание (необязательно)
        <textarea
          name="description"
          rows={2}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Сколько фото будет (пока число)
        <input
          name="photoCount"
          type="number"
          min={1}
          max={50}
          defaultValue={20}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input name="consentGiven" type="checkbox" className="mt-1" />
        <span>
          Это моё лицо / есть согласие человека на использование likeness
        </span>
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {loading ? "Сохраняем…" : "Создать персонажа"}
      </button>
    </form>
  );
}
