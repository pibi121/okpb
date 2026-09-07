"use client";

import { useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type Field = { key: string; title: string; value: number };

export default function OpsPricesPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    opsFetch<{ fields: Field[] }>("/api/ops/prices")
      .then((d) => setFields(d.fields))
      .catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, []);

  return (
    <form
      className="flex max-w-lg flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const prices: Record<string, number> = {};
        for (const f of fields) prices[f.key] = f.value;
        await opsFetch("/api/ops/prices", {
          method: "POST",
          body: JSON.stringify({ prices }),
        });
        setMsg("Цены обновлены. У шаблонов со своей ценой она важнее этих запасных.");
      }}
    >
      <h1 className="font-display text-3xl">Цены</h1>
      <p className="text-sm text-zinc-500">
        Фото и LoRA — фикс. Видео — цена за секунду × длительность шаблона
        (минимум секунд тоже настраивается). У шаблона со своей ценой она
        важнее формулы.
      </p>
      {fields.map((f, i) => (
        <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
          {f.title}
          <input
            type="number"
            min={0}
            value={f.value}
            onChange={(e) => {
              const next = [...fields];
              next[i] = { ...f, value: Number(e.target.value) };
              setFields(next);
            }}
            className="w-28 rounded-xl border border-white/10 bg-[#121214] px-3 py-2"
          />
        </label>
      ))}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <button className="rounded-full btn-grad px-4 py-2 text-sm">Сохранить</button>
    </form>
  );
}
