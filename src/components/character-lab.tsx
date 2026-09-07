"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  characterAppearanceForPrompt,
  customPayload,
  fieldsForGender,
  isCustomValue,
  isLookbookFieldInPrompt,
  lookbookSelectValue,
  parseLookbook,
  preserveLookbookPromptFlags,
  setAllLookbookFieldsInPrompt,
  setLookbookFieldInPrompt,
  suggestedLookbook,
  toCustomValue,
  type Gender,
  type LookbookValues,
} from "@/lib/lookbook";

type Character = {
  id: string;
  name: string;
  description: string | null;
  gender: string;
  photoCount: number;
  loraStatus: string;
  triggerWord: string | null;
  loraPath?: string | null;
  lookbookJson: string;
  isStudioCast?: boolean;
  tgDisplayName?: string;
  tgCoverUrl?: string;
};

type Photo = { name: string; size: number; url: string };
type TrainInfo = {
  status: string;
  trigger?: string;
  lastLine?: string;
  error?: string;
  loraPath?: string;
  phase?: string;
  percent?: number;
  epoch?: number;
  epochs?: number;
  elapsedSec?: number;
  estimateTotalSec?: number;
  etaSec?: number;
  etaLabel?: string;
};

type IdentityPackAngle = {
  id: string;
  label: string;
  status: string;
  resultUrl?: string;
  error?: string;
};

type IdentityPackInfo = {
  status: string;
  error?: string;
  trainingPhotosArchived?: boolean;
  angles: Record<string, IdentityPackAngle>;
};

type Mode = "pick" | "lookbook" | "lora";

export function CharacterLab({
  characters,
  studioCasts = [],
}: {
  characters: Character[];
  studioCasts?: Character[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(characters[0]?.id || "");
  const selected = characters.find((c) => c.id === selectedId) || null;

  const [mode, setMode] = useState<Mode>("pick");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [triggerWord, setTriggerWord] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [train, setTrain] = useState<TrainInfo | null>(null);
  const [identityPack, setIdentityPack] = useState<IdentityPackInfo | null>(null);
  const [trainTrigger, setTrainTrigger] = useState("");
  const [tgDisplayName, setTgDisplayName] = useState("");
  const [tgCoverPreview, setTgCoverPreview] = useState<string | null>(null);
  const [tgCoverFile, setTgCoverFile] = useState<File | null>(null);

  const selectedGender = (selected?.gender === "male" ? "male" : "female") as Gender;
  const [lookbook, setLookbook] = useState<LookbookValues>(
    selected
      ? parseLookbook(selected.lookbookJson, selectedGender)
      : suggestedLookbook("female"),
  );

  const fields = useMemo(
    () => fieldsForGender(selected ? selectedGender : gender),
    [selected, selectedGender, gender],
  );

  async function loadIdentityPack(id: string) {
    try {
      const res = await fetch(`/api/characters/${id}/identity-pack`);
      const data = await res.json();
      if (res.ok && data.pack) setIdentityPack(data.pack);
    } catch {
      /* ignore */
    }
  }

  async function loadPhotosAndTrain(id: string) {
    try {
      const res = await fetch(`/api/characters/${id}/train`);
      const data = await res.json();
      if (res.ok) {
        setPhotos(data.photos || []);
        setTrain(data.train || null);
        if (data.character?.triggerWord) {
          setTrainTrigger(data.character.triggerWord);
        }
      } else {
        const p = await fetch(`/api/characters/${id}/photos`);
        const pd = await p.json();
        if (p.ok) setPhotos(pd.photos || []);
      }
      await loadIdentityPack(id);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!selectedId) return;
    void loadPhotosAndTrain(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    if (
      selected?.loraStatus !== "lora_training" &&
      train?.status !== "training" &&
      train?.status !== "uploading" &&
      train?.status !== "error"
    ) {
      return;
    }
    const t = setInterval(() => {
      void loadPhotosAndTrain(selectedId).then(() => router.refresh());
    }, 8_000);
    return () => clearInterval(t);
  }, [selectedId, selected?.loraStatus, train?.status, router]);

  useEffect(() => {
    if (!selectedId) return;
    if (identityPack?.status !== "generating") return;
    const t = setInterval(() => {
      void loadIdentityPack(selectedId);
    }, 6_000);
    return () => clearInterval(t);
  }, [selectedId, identityPack?.status]);

  function select(c: Character) {
    setSelectedId(c.id);
    const g = (c.gender === "male" ? "male" : "female") as Gender;
    setLookbook(parseLookbook(c.lookbookJson, g));
    setTrainTrigger(c.triggerWord || "");
    setTgDisplayName(c.tgDisplayName || c.name);
    setTgCoverPreview(c.tgCoverUrl || null);
    setTgCoverFile(null);
    setMsg("");
    setError("");
    setMode("pick");
  }

  async function saveStudioTgCard() {
    if (!selected?.isStudioCast) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const form = new FormData();
      form.set("displayName", tgDisplayName.trim());
      if (tgCoverFile) form.set("coverPhoto", tgCoverFile);
      const res = await fetch(`/api/peach/characters/${selected.id}/tg-card`, {
        method: "PATCH",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data.error || "error"));
      setMsg(
        `Карточка в Telegram обновлена: «${data.character?.tgDisplayName || tgDisplayName}»`,
      );
      setTgCoverFile(null);
      if (data.character?.tgCoverUrl) {
        setTgCoverPreview(data.character.tgCoverUrl);
      }
      if (data.character?.tgDisplayName) {
        setTgDisplayName(data.character.tgDisplayName);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function createLookbookOnly() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        gender,
        consentGiven: true,
        photoCount: 0,
        loraStatus: "lookbook_ready",
        lookbook: suggestedLookbook(gender),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "error");
      return;
    }
    setName("");
    setMode("pick");
    setMsg("Lookbook-персонаж создан — можно сразу генерить или загрузить фото для Krea LoRA");
    router.refresh();
  }

  async function createLoraPath() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    const tw = triggerWord.trim() || name.trim().toLowerCase().replace(/\s+/g, "_");
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        gender,
        consentGiven: true,
        photoCount: 0,
        triggerWord: tw,
        loraStatus: tw === "olh_person" ? "lora_ready" : "lookbook_ready",
        lookbook: suggestedLookbook(gender, tw === "olh_person" ? "olh" : undefined),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "error");
      return;
    }
    setName("");
    setMode("pick");
    setMsg(
      tw === "olh_person"
        ? "LoRA olh_person подключена"
        : "Персонаж создан — загрузи ≥5 фото справа и нажми «Обучить Krea LoRA»",
    );
    if (data.character?.id) {
      setSelectedId(data.character.id);
      setTrainTrigger(tw);
    }
    router.refresh();
  }

  async function saveLookbook() {
    if (!selected) return;
    setBusy(true);
    const res = await fetch("/api/characters", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selected.id,
        lookbook,
        gender: selected.gender,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "error");
      return;
    }
    setMsg("Lookbook сохранён");
    router.refresh();
  }

  async function trainAppearance() {
    if (!selected) return;
    const g = (selected.gender === "male" ? "male" : "female") as Gender;
    const next = preserveLookbookPromptFlags(
      suggestedLookbook(
        g,
        selected.triggerWord === "olh_person" ? "olh" : g === "male" ? "bald_muscular" : undefined,
      ),
      lookbook,
      g,
    );
    setLookbook(next);
    setBusy(true);
    const res = await fetch("/api/characters", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, lookbook: next, loraStatus: selected.loraStatus }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "error");
      return;
    }
    setMsg("Lookbook по шаблону. Лучше: «По фото (LLM)».");
    router.refresh();
  }

  async function inferLookbookFromPhotos() {
    if (!selected) return;
    if (photos.length < 1) {
      setError("Сначала загрузи фото персонажа");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("LLM смотрит фото и заполняет lookbook…");
    const res = await fetch(`/api/characters/${selected.id}/lookbook-from-photos`, {
      method: "POST",
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "не удалось определить lookbook");
      setMsg("");
      return;
    }
    if (data.lookbook) setLookbook(data.lookbook);
    setMsg(data.preview ? `Lookbook по фото: ${data.preview}` : "Lookbook заполнен по фото");
    router.refresh();
  }

  async function seedOlh() {
    setBusy(true);
    const res = await fetch("/api/characters?action=seed_olh", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "error");
      return;
    }
    setMsg(data.message || "olh_person добавлен");
    router.refresh();
  }

  async function onUpload(files: FileList | null) {
    if (!selected || !files?.length) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    const res = await fetch(`/api/characters/${selected.id}/photos`, {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "upload failed");
      return;
    }
    setPhotos(data.photos || []);
    setMsg(`Загружено. Всего фото: ${(data.photos || []).length}`);
    router.refresh();
  }

  async function removePhoto(name: string) {
    if (!selected) return;
    setBusy(true);
    const res = await fetch(
      `/api/characters/${selected.id}/photos?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "delete failed");
      return;
    }
    setPhotos(data.photos || []);
    router.refresh();
  }

  async function startIdentityPack() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/characters/${selected.id}/identity-pack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        archiveTraining:
          selected.loraStatus === "lora_ready" && photos.length > 0,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "identity pack failed");
      return;
    }
    if (data.pack) setIdentityPack(data.pack);
    setMsg(data.message || "Генерация базовых ракурсов запущена");
    await loadPhotosAndTrain(selected.id);
    router.refresh();
  }

  async function startTrain() {
    if (!selected) return;
    setError("");
    setMsg("");
    setTrain({
      status: "uploading",
      phase: "Запуск обучения…",
      percent: 2,
      epochs: 12,
      estimateTotalSec: 5400,
      etaLabel: "загрузка датасета…",
    });
    setBusy(true);
    try {
      const res = await fetch(`/api/characters/${selected.id}/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggerWord: trainTrigger.trim() || undefined,
          epochs: 12,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        estimateLabel?: string;
        epochs?: number;
        resumed?: boolean;
      };
      if (!res.ok) {
        setError(data.error || "train failed");
        setTrain((prev) => ({
          ...(prev || {}),
          status: "error",
          error: data.error || "train failed",
          phase: "Ошибка",
        }));
        return;
      }
      setMsg(
        data.message ||
          (data.resumed
            ? "Подключились к уже идущему обучению на GPU"
            : `Train started · оценка ~${data.estimateLabel || "1–2ч"} (${data.epochs || 12} эпох)`),
      );
      await loadPhotosAndTrain(selected.id);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "train failed";
      setError(msg);
      setTrain((prev) => ({
        ...(prev || {}),
        status: "error",
        error: msg,
        phase: "Ошибка",
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {studioCasts.length > 0 ? (
        <div className="rounded-lg border border-peach/40 bg-peach/5 p-4">
          <h2 className="font-medium text-peach">Актрисы TG (витрина)</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Карточки для мини-аппа. Выбери актрису — справа блок «Карточка в Telegram».
          </p>
          <ul className="mt-3 divide-y rounded-lg border border-peach/20 bg-white">
            {studioCasts.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => select(c)}
                  className={`w-full px-4 py-3 text-left text-sm hover:bg-peach/5 ${
                    selectedId === c.id ? "bg-peach/10" : ""
                  }`}
                >
                  <div className="font-medium">
                    {c.tgDisplayName || c.name}
                    <span className="ml-2 text-xs text-zinc-500">({c.triggerWord})</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="font-medium">Новый персонаж</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Lookbook сразу в генерацию; LoRA лица — через фото → Krea2 train на Metalnode.
          </p>

          {mode === "pick" ? (
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                className="rounded-md border border-zinc-300 px-3 py-3 text-left text-sm hover:border-rose-400"
                onClick={() => setMode("lookbook")}
              >
                <div className="font-medium">Lookbook без LoRA</div>
                <div className="text-xs text-zinc-500">Анкета → сразу в промпт.</div>
              </button>
              <button
                type="button"
                className="rounded-md border border-zinc-300 px-3 py-3 text-left text-sm hover:border-rose-400"
                onClick={() => setMode("lora")}
              >
                <div className="font-medium">С LoRA (Krea)</div>
                <div className="text-xs text-zinc-500">
                  Создать слот → загрузить фото → обучить Krea2 LoRA.
                </div>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={seedOlh}
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                Добавить готовую LoRA olh_person
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <button
                type="button"
                className="text-left text-xs text-zinc-500 underline"
                onClick={() => setMode("pick")}
              >
                ← назад
              </button>
              <input
                className="rounded-md border px-3 py-2"
                placeholder="Имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={
                    gender === "female"
                      ? "flex-1 rounded-md bg-zinc-900 py-2 text-white"
                      : "flex-1 rounded-md border py-2"
                  }
                  onClick={() => setGender("female")}
                >
                  Женский
                </button>
                <button
                  type="button"
                  className={
                    gender === "male"
                      ? "flex-1 rounded-md bg-zinc-900 py-2 text-white"
                      : "flex-1 rounded-md border py-2"
                  }
                  onClick={() => setGender("male")}
                >
                  Мужской
                </button>
              </div>

              {mode === "lora" ? (
                <>
                  <input
                    className="rounded-md border px-3 py-2"
                    placeholder="trigger (например anna_face)"
                    value={triggerWord}
                    onChange={(e) => setTriggerWord(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !name.trim()}
                    onClick={createLoraPath}
                    className="rounded-md bg-rose-800 px-3 py-2 text-white disabled:opacity-50"
                  >
                    Создать слот под LoRA
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy || !name.trim()}
                  onClick={createLookbookOnly}
                  className="rounded-md bg-rose-800 px-3 py-2 text-white disabled:opacity-50"
                >
                  Создать Lookbook
                </button>
              )}
            </div>
          )}
        </div>

        <ul className="divide-y rounded-lg border border-zinc-200 bg-white">
          {characters.length === 0 ? (
            <li className="p-4 text-sm text-zinc-500">Пока нет — добавь olh_person или Lookbook</li>
          ) : (
            characters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => select(c)}
                  className={`w-full px-4 py-3 text-left text-sm hover:bg-zinc-50 ${
                    selectedId === c.id ? "bg-rose-50" : ""
                  }`}
                >
                  <div className="font-medium">
                    {c.name}
                    {c.isStudioCast ? (
                      <span className="ml-2 rounded bg-peach/20 px-1.5 py-0.5 text-[10px] text-peach">
                        TG витрина
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {c.gender === "male" ? "♂" : "♀"} · {c.loraStatus}
                    {c.triggerWord ? ` · ${c.triggerWord}` : ""}
                    {c.photoCount ? ` · ${c.photoCount} фото` : ""}
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="font-medium">Krea LoRA · фото</h2>
          {!selected ? (
            <p className="mt-3 text-sm text-zinc-500">Выбери персонажа слева</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-zinc-600">
                Загрузи ≥5 портретов/фото лица (png/jpg/webp). Трейн ={" "}
                <strong>Krea2</strong> на Metalnode (~1–2 ч). На время трейна Comfy
                остановится.
              </p>
              <label className="mt-3 flex flex-col gap-1 text-sm">
                Trigger word
                <input
                  className="rounded-md border px-3 py-2"
                  value={trainTrigger}
                  onChange={(e) => setTrainTrigger(e.target.value)}
                  placeholder="anna_face"
                  disabled={selected.loraStatus === "lora_training"}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-zinc-50">
                  Загрузить фото
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    disabled={busy || selected.loraStatus === "lora_training"}
                    onChange={(e) => {
                      void onUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    busy ||
                    photos.length < 5 ||
                    selected.loraStatus === "lora_training" ||
                    train?.status === "uploading"
                  }
                  onClick={() => void startTrain()}
                  className="rounded-md bg-rose-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Обучить Krea LoRA
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void loadPhotosAndTrain(selected.id)}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  Обновить статус
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Фото: {photos.length}/50 · статус: {selected.loraStatus}
                {train?.status ? ` · train: ${train.status}` : ""}
              </p>

              {train &&
              (train.status === "uploading" ||
                train.status === "training" ||
                train.status === "ready" ||
                train.status === "error" ||
                selected.loraStatus === "lora_training") ? (
                <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {train.percent != null && train.percent >= 100
                        ? "Обучение завершено"
                        : train.phase || "Обучение…"}
                    </span>
                    <span className="tabular-nums text-zinc-600">
                      {Math.min(100, Math.max(0, train.percent ?? 0))}%
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-200">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        train.percent != null && train.percent >= 100
                          ? "bg-emerald-600"
                          : train.status === "error"
                            ? "bg-red-500"
                            : "bg-rose-700"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(2, train.percent ?? 2))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600">
                    {train.etaLabel ? <span>{train.etaLabel}</span> : null}
                    {typeof train.elapsedSec === "number" ? (
                      <span>
                        прошло{" "}
                        {train.elapsedSec >= 3600
                          ? `${Math.floor(train.elapsedSec / 3600)}ч ${Math.floor((train.elapsedSec % 3600) / 60)}м`
                          : `${Math.floor(train.elapsedSec / 60)}м ${train.elapsedSec % 60}с`}
                      </span>
                    ) : null}
                    {typeof train.estimateTotalSec === "number" ? (
                      <span>
                        оценка всего ~{Math.round(train.estimateTotalSec / 60)} мин
                      </span>
                    ) : null}
                    {train.epoch && train.epochs ? (
                      <span>
                        эпоха {train.epoch}/{train.epochs}
                      </span>
                    ) : train.epochs ? (
                      <span>{train.epochs} эпох</span>
                    ) : null}
                  </div>
                  {train.lastLine ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                      {train.lastLine}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {train?.error ? (
                <p className="mt-1 text-sm text-red-600">{train.error}</p>
              ) : null}
              {selected.loraPath ? (
                <p className="mt-1 text-xs text-emerald-700">LoRA: {selected.loraPath}</p>
              ) : null}
              {identityPack?.trainingPhotosArchived ? (
                <p className="mt-2 text-xs text-zinc-500">
                  Фото тренировки архивированы — для референсов используются базовые ракурсы ниже.
                </p>
              ) : null}
              {!identityPack?.trainingPhotosArchived ? (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((p) => (
                  <div key={p.name} className="relative overflow-hidden rounded border bg-zinc-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" />
                    <button
                      type="button"
                      disabled={busy || selected.loraStatus === "lora_training"}
                      onClick={() => void removePhoto(p.name)}
                      className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              ) : null}
            </>
          )}
        </div>

        {selected?.isStudioCast ? (
          <div className="rounded-lg border border-peach/30 bg-peach/5 p-4">
            <h2 className="font-medium text-peach">Карточка в Telegram</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Имя и обложка актрисы в боте и мини-аппе (вкладка «Витрина»).
            </p>
            <label className="mt-3 block text-sm">
              <span className="text-zinc-500">Отображаемое имя</span>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={tgDisplayName}
                onChange={(e) => setTgDisplayName(e.target.value)}
              />
            </label>
            <div className="mt-3 flex items-start gap-3">
              <label className="flex h-28 w-21 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-300 bg-white">
                {tgCoverPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tgCoverPreview}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-zinc-400">3:4 фото</span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setTgCoverFile(f);
                    if (f) setTgCoverPreview(URL.createObjectURL(f));
                  }}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveStudioTgCard()}
                className="rounded-md bg-peach px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                {busy ? "Сохраняю…" : "Обновить в TG"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="font-medium">Lookbook</h2>
          {!selected ? (
            <p className="mt-3 text-sm text-zinc-500">Выбери персонажа слева</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-zinc-600">
                {selected.loraStatus === "lora_ready"
                  ? "LoRA держит лицо. У каждого поля можно выбрать: текст в промпт или только LoRA для этой черты."
                  : "Без LoRA Lookbook целиком идёт в промпт."}
              </p>

              {selected.loraStatus === "lora_ready" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setLookbook((prev) =>
                        setAllLookbookFieldsInPrompt(prev, selectedGender, true),
                      )
                    }
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                  >
                    Все в промпт
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setLookbook((prev) =>
                        setAllLookbookFieldsInPrompt(prev, selectedGender, false),
                      )
                    }
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                  >
                    Все через LoRA
                  </button>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || photos.length < 1}
                  onClick={() => void inferLookbookFromPhotos()}
                  className="rounded-md bg-rose-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  По фото (LLM)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={trainAppearance}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
                >
                  Шаблон
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={saveLookbook}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white"
                >
                  Сохранить
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                У каждого поля можно выбрать пресет или вписать своё (например «блондинка с синими концами»).
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {fields.map((field) => {
                  const stored = lookbook[field.id] || "";
                  const selectVal = lookbookSelectValue(field, stored);
                  const inPrompt =
                    selected.loraStatus !== "lora_ready" ||
                    isLookbookFieldInPrompt(lookbook, field.id);
                  const showCustom =
                    field.allowCustom !== false &&
                    (selectVal === "__custom__" ||
                      isCustomValue(stored) ||
                      field.options.length === 0);
                  return (
                    <div
                      key={field.id}
                      className={`flex flex-col gap-1 text-sm ${inPrompt ? "" : "opacity-70"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>{field.label}</span>
                        {selected.loraStatus === "lora_ready" ? (
                          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-zinc-500">
                            <input
                              type="checkbox"
                              className="accent-rose-800"
                              checked={isLookbookFieldInPrompt(lookbook, field.id)}
                              disabled={busy}
                              onChange={(e) =>
                                setLookbook((prev) =>
                                  setLookbookFieldInPrompt(prev, field.id, e.target.checked),
                                )
                              }
                            />
                            в промпт
                          </label>
                        ) : null}
                      </div>
                      {field.options.length > 0 ? (
                        <select
                          className="rounded-md border border-zinc-300 px-2 py-1.5"
                          value={selectVal}
                          onChange={(e) => {
                            const v = e.target.value;
                            setLookbook((prev) => ({
                              ...prev,
                              [field.id]:
                                v === "__custom__"
                                  ? toCustomValue(customPayload(prev[field.id]) || "")
                                  : v,
                            }));
                          }}
                        >
                          {field.options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                          {field.allowCustom !== false ? (
                            <option value="__custom__">Своё…</option>
                          ) : null}
                        </select>
                      ) : null}
                      {showCustom ? (
                        <input
                          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                          placeholder="Своё описание (лучше на EN для промпта)"
                          value={
                            isCustomValue(stored)
                              ? customPayload(stored)
                              : field.options.some((o) => o.id === stored)
                                ? ""
                                : stored
                          }
                          onChange={(e) =>
                            setLookbook((prev) => ({
                              ...prev,
                              [field.id]: toCustomValue(e.target.value),
                            }))
                          }
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <pre className="mt-4 whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs text-zinc-700">
                {(() => {
                  const appearance = characterAppearanceForPrompt(lookbook, selectedGender, {
                    hasLora: selected.loraStatus === "lora_ready",
                  });
                  const trigger =
                    selected.loraStatus === "lora_ready" && selected.triggerWord
                      ? selected.triggerWord
                      : null;
                  if (trigger && !appearance.trim()) {
                    return `${trigger}  ·  только LoRA`;
                  }
                  return [trigger, appearance].filter(Boolean).join(", ");
                })()}
              </pre>
            </>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="font-medium">Базовые ракурсы</h2>
          {!selected ? (
            <p className="mt-3 text-sm text-zinc-500">Выбери персонажа слева</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-zinc-600">
                5 nude-кадров с lookbook (спереди/сбоку/сзади, крупный + full body). После LoRA
                генерируются автоматически; без LoRA — сохрани lookbook и нажми кнопку. Идут в
                референсы для видео.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    busy ||
                    identityPack?.status === "generating" ||
                    selected.loraStatus === "lora_training"
                  }
                  onClick={() => void startIdentityPack()}
                  className="rounded-md bg-rose-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {identityPack?.status === "ready"
                    ? "Перегенерировать ракурсы"
                    : "Сгенерировать базовые фото"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => selected && void loadIdentityPack(selected.id)}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  Обновить
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Статус: {identityPack?.status || "idle"}
                {identityPack?.status === "generating" ? " · ~5–10 мин" : ""}
              </p>
              {identityPack?.error ? (
                <p className="mt-1 text-xs text-red-600">{identityPack.error}</p>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {identityPack
                  ? Object.values(identityPack.angles).map((a) => (
                      <div
                        key={a.id}
                        className="overflow-hidden rounded border bg-zinc-50"
                      >
                        {a.resultUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={a.resultUrl}
                            alt={a.label}
                            className="aspect-[4/5] w-full object-cover"
                          />
                        ) : (
                          <div className="flex aspect-[4/5] items-center justify-center bg-zinc-100 text-xs text-zinc-500">
                            {a.status === "pending" || identityPack.status === "generating"
                              ? "…"
                              : "—"}
                          </div>
                        )}
                        <div className="border-t px-2 py-1 text-[10px] text-zinc-600">
                          {a.label}
                        </div>
                      </div>
                    ))
                  : null}
              </div>
            </>
          )}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      </div>
    </div>
    </>
  );
}
