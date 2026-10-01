"use client";

import { useCallback, useEffect, useState } from "react";
import { opsFetch } from "@/lib/ops/ops-fetch";

type AgeGateLocalEngine = "opencv" | "insightface";
type AgeGateEngine = AgeGateLocalEngine | "api";

type Payload = {
  ageGateEnabled: boolean;
  engine: AgeGateEngine;
  blockBuckets: string;
  faceThresh: number;
  minScore: number;
  minAdultScore: number;
  manualUncertainModeration: boolean;
  failClosed: boolean;
  apiKeySet: boolean;
  apiKeyMasked: string;
  apiModel: string;
  apiPassAge: number;
  apiFallbackLocal: boolean;
  apiFallbackEngine: AgeGateLocalEngine;
  notifyAll: boolean;
  notifyApproved: boolean;
  notifyRejected: boolean;
  apiModels: string[];
  pendingCount: number;
  note: string;
};

type KeyCheck = {
  ok: boolean;
  balance: unknown;
  budget: unknown;
  error: string | null;
};

const CUSTOM_MODEL = "__custom";

function Toggle(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 text-sm ${
        props.disabled ? "opacity-50" : ""
      }`}
    >
      <span>
        {props.label}
        {props.hint ? (
          <span className="mt-0.5 block text-xs text-zinc-500">{props.hint}</span>
        ) : null}
      </span>
      <input
        type="checkbox"
        className="mt-1"
        disabled={props.disabled}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

function fmtMoney(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

type PendingItem = {
  id: string;
  userId: string;
  platformUserId: string;
  chatId: string;
  locale: string;
  photoUrl: string;
  createdAt: string;
  gateSummary: {
    reason: string | null;
    ageLabel: string | null;
    ageYears: number | null;
    score: number | null;
    secondLabel: string | null;
    secondScore: number | null;
    faces: number | null;
    engine: string | null;
  };
};

export default function OpsSafetyPage() {
  const [d, setD] = useState<Payload | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<PendingItem | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [keyCheck, setKeyCheck] = useState<KeyCheck | null>(null);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const load = useCallback(async () => {
    const [settings, queue] = await Promise.all([
      opsFetch<Payload>("/api/ops/safety"),
      opsFetch<{ pending: PendingItem[] }>("/api/ops/safety?list=pending"),
    ]);
    setD(settings);
    setPending(queue.pending || []);
  }, []);

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
  }, [load]);

  async function save(
    patch: Partial<Payload> & { apiKeyClear?: boolean } = {},
  ) {
    if (!d) return;
    setBusy(true);
    setMsg("");
    try {
      const next = { ...d, ...patch };
      await opsFetch("/api/ops/safety", {
        method: "POST",
        body: JSON.stringify({
          ageGateEnabled: next.ageGateEnabled,
          engine: next.engine,
          blockBuckets: next.blockBuckets,
          faceThresh: next.faceThresh,
          minScore: next.minScore,
          minAdultScore: next.minAdultScore,
          failClosed: next.failClosed,
          // Empty key = keep the stored one (server never wipes it on empty).
          ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
          ...(patch.apiKeyClear ? { apiKeyClear: true } : {}),
          apiModel: next.apiModel,
          apiPassAge: next.apiPassAge,
          apiFallbackLocal: next.apiFallbackLocal,
          apiFallbackEngine: next.apiFallbackEngine,
          notifyAll: next.notifyAll,
          notifyApproved: next.notifyApproved,
          notifyRejected: next.notifyRejected,
        }),
      });
      setApiKeyInput("");
      setMsg("Сохранено");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function checkKey() {
    setBusy(true);
    setMsg("");
    setKeyCheck(null);
    try {
      const r = await opsFetch<KeyCheck>("/api/ops/safety", {
        method: "POST",
        body: JSON.stringify({
          action: "check_key",
          ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
        }),
      });
      setKeyCheck(r);
    } catch (e) {
      setKeyCheck({
        ok: false,
        balance: null,
        budget: null,
        error: e instanceof Error ? e.message : "ошибка",
      });
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(true);
    setMsg("");
    try {
      await opsFetch("/api/ops/safety", {
        method: "POST",
        body: JSON.stringify({ action, id }),
      });
      setMsg(action === "approve" ? "Одобрено" : "Отклонено");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <p className="text-zinc-500">Загружаю…</p>;

  const engine: AgeGateEngine =
    d.engine === "insightface" || d.engine === "api" ? d.engine : "opencv";
  const modelIsPreset = d.apiModels.includes(d.apiModel);
  const modelSelect = customModel || !modelIsPreset ? CUSTOM_MODEL : d.apiModel;
  const engineBtn = (id: AgeGateEngine, label: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => setD({ ...d, engine: id })}
      aria-pressed={engine === id}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        engine === id
          ? "bg-zinc-900 shadow"
          : "text-zinc-600 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
  const inputCls =
    "rounded-xl border border-white/10 bg-[#121214] px-3 py-2 text-sm";
  const engineTitle =
    engine === "api"
      ? "ИИ по API (AITUNNEL)"
      : engine === "insightface"
        ? "Новая (InsightFace)"
        : "Старая (OpenCV)";

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Безопасность</h1>
        <p className="mt-1 text-sm text-zinc-500">{d.note}</p>
      </div>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {zoom ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.photoUrl}
            alt=""
            className="max-h-[80vh] max-w-full rounded-xl object-contain"
          />
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const id = zoom.id;
                setZoom(null);
                void decide(id, "approve");
              }}
              className="rounded-full bg-emerald-500/30 px-4 py-2 text-sm text-emerald-200 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const id = zoom.id;
                setZoom(null);
                void decide(id, "reject");
              }}
              className="rounded-full bg-rose-500/30 px-4 py-2 text-sm text-rose-200 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => setZoom(null)}
              className="rounded-full border border-white/20 px-4 py-2 text-sm text-zinc-700"
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-xl">На проверке</h2>
          <span className="text-xs text-zinc-500">
            {pending.length || d.pendingCount || 0}
          </span>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-500">Очередь пуста</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((item) => (
              <li
                key={item.id}
                className="flex gap-3 rounded-2xl border border-white/10 bg-[#121214] p-3"
              >
                <button
                  type="button"
                  onClick={() => setZoom(item)}
                  title="Открыть крупно"
                  className="h-40 w-40 shrink-0 cursor-zoom-in overflow-hidden rounded-xl bg-zinc-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.photoUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-zinc-400">
                    user {item.userId}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    tg {item.platformUserId} · {item.locale} ·{" "}
                    {new Date(item.createdAt).toLocaleString("ru-RU")}
                  </div>
                  <div className="mt-1 font-mono text-xs text-amber-200/90">
                    {item.gateSummary.engine
                      ? `${item.gateSummary.engine} · `
                      : ""}
                    {item.gateSummary.reason || "?"} ·{" "}
                    {item.gateSummary.ageLabel || "—"}
                    {item.gateSummary.ageYears != null
                      ? ` (${item.gateSummary.ageYears}y)`
                      : ""}{" "}
                    @ {item.gateSummary.score ?? "—"}
                    {item.gateSummary.secondLabel
                      ? ` · 2nd ${item.gateSummary.secondLabel}@${item.gateSummary.secondScore ?? "—"}`
                      : ""}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(item.id, "approve")}
                      className="rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(item.id, "reject")}
                      className="rounded-full bg-rose-500/20 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Age-gate (18+ фото)</div>
            <p className="mt-1 text-xs text-zinc-500">
              Блокирует загрузку и генерации по фото, похожим на несовершеннолетних.
              Работает локально на боте — GPU не нагружает.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ ageGateEnabled: !d.ageGateEnabled })}
            className={`rounded-full px-4 py-2 text-sm ${
              d.ageGateEnabled
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-zinc-700 text-zinc-300"
            }`}
          >
            {d.ageGateEnabled ? "Вкл" : "Выкл"}
          </button>
        </div>
      </div>


      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="text-sm font-medium">Движок проверки</div>
        <p className="mt-1 text-xs text-zinc-500">
          Выбор и настройки применяются после «Сохранить настройки», без деплоя.
          Ниже показаны настройки только выбранного движка.
        </p>
        <div
          className="mt-3 inline-flex flex-wrap rounded-xl border border-white/15 bg-black/40 p-1"
          role="group"
          aria-label="Движок age-gate"
        >
          {engineBtn("opencv", "Старая (OpenCV)")}
          {engineBtn("insightface", "Новая (InsightFace)")}
          {engineBtn("api", "ИИ по API (пока только AITUNNEL)")}
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Сейчас выбрано:{" "}
          <span className="font-medium text-foreground">{engineTitle}</span>
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="text-sm font-medium">Общие настройки</div>
        <Toggle
          checked={d.failClosed}
          onChange={(v) => setD({ ...d, failClosed: v })}
          label="Fail-closed (если проверка недоступна — блокировать)"
          hint="Выключено: при сбое проверки фото пропускается."
        />
      </div>

      {engine === "opencv" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4">
          <div className="text-sm font-medium">Настройки: Старая (OpenCV)</div>
          <label className="flex flex-col gap-1 text-sm">
            Блокируемые возрастные бакеты
            <input
              value={d.blockBuckets}
              onChange={(e) => setD({ ...d, blockBuckets: e.target.value })}
              className={`${inputCls} font-mono text-xs`}
            />
            <span className="text-xs text-zinc-500">
              По умолчанию: (0-2),(4-6),(8-12)
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Порог лица (0–1)
            <input
              type="number"
              min={0.1}
              max={0.99}
              step={0.05}
              value={d.faceThresh}
              onChange={(e) => setD({ ...d, faceThresh: Number(e.target.value) })}
              className={`w-28 ${inputCls}`}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Мин. уверенность для блока (дети)
            <input
              type="number"
              min={0.1}
              max={0.99}
              step={0.05}
              value={d.minScore ?? 0.55}
              onChange={(e) => setD({ ...d, minScore: Number(e.target.value) })}
              className={`w-28 ${inputCls}`}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Мин. score взрослого (иначе сомнение)
            <input
              type="number"
              min={0.1}
              max={0.99}
              step={0.05}
              value={d.minAdultScore ?? 0.85}
              onChange={(e) =>
                setD({ ...d, minAdultScore: Number(e.target.value) })
              }
              className={`w-28 ${inputCls}`}
            />
          </label>
        </div>
      ) : null}

      {engine === "insightface" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4">
          <div className="text-sm font-medium">Настройки: Новая (InsightFace)</div>
          <p className="text-xs text-zinc-500">
            Возраст считается в годах: &lt;13 блок, 13–18 сомнение. Доп. шаг
            Gil Levi убран.
          </p>
          <label className="flex items-center justify-between gap-3 text-sm">
            Порог лица (0–1)
            <input
              type="number"
              min={0.1}
              max={0.99}
              step={0.05}
              value={d.faceThresh}
              onChange={(e) => setD({ ...d, faceThresh: Number(e.target.value) })}
              className={`w-28 ${inputCls}`}
            />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex items-center justify-between gap-3">
              Мин. score взрослого (граница «мягкого взрослого»)
              <input
                type="number"
                min={0.1}
                max={0.99}
                step={0.05}
                value={d.minAdultScore ?? 0.85}
                onChange={(e) =>
                  setD({ ...d, minAdultScore: Number(e.target.value) })
                }
                className={`w-28 ${inputCls}`}
              />
            </label>
            <span className="text-xs text-zinc-500">
              Граница = 18+(1−score)×10 лет (при 0.85 → ~19.5).
            </span>
          </div>
        </div>
      ) : null}

      {engine === "api" ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#121214] p-4">
          <div className="text-sm font-medium">Настройки: ИИ по API (AITUNNEL)</div>
          <p className="text-xs text-zinc-500">
            Фото уменьшается до 1024 px и уходит в модель на оценку возраста.
            Вердикты кэшируются по хэшу фото.
          </p>

          <div className="flex flex-col gap-2 text-sm">
            <span>API-ключ</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={
                d.apiKeySet
                  ? `сохранён: ${d.apiKeyMasked} (пусто = не менять)`
                  : "вставьте ключ AITUNNEL"
              }
              className={`${inputCls} font-mono text-xs`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || (!apiKeyInput.trim() && !d.apiKeySet)}
                onClick={() => void checkKey()}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-foreground disabled:opacity-50"
              >
                Проверить ключ
              </button>
              {d.apiKeySet ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save({ apiKeyClear: true })}
                  className="rounded-full bg-rose-500/20 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-50"
                >
                  Удалить ключ
                </button>
              ) : null}
              {keyCheck ? (
                <span
                  className={`text-xs ${
                    keyCheck.ok ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {keyCheck.ok
                    ? `ок · баланс ${fmtMoney(keyCheck.balance)} · бюджет ${fmtMoney(keyCheck.budget)}`
                    : `ошибка: ${keyCheck.error || "неизвестно"}`}
                </span>
              ) : null}
            </div>
            {!d.apiKeySet && !apiKeyInput.trim() ? (
              <span className="text-xs text-amber-300">
                Ключ не задан: с движком «API» все проверки будут недоступны.
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span>Модель (одна активная)</span>
            <select
              value={modelSelect}
              onChange={(e) => {
                if (e.target.value === CUSTOM_MODEL) {
                  setCustomModel(true);
                  setD({ ...d, apiModel: "" });
                } else {
                  setCustomModel(false);
                  setD({ ...d, apiModel: e.target.value });
                }
              }}
              className={inputCls}
            >
              {d.apiModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === "gpt-5.4-mini" ? " (по умолчанию)" : ""}
                </option>
              ))}
              <option value={CUSTOM_MODEL}>Другая модель…</option>
            </select>
            {modelSelect === CUSTOM_MODEL ? (
              <input
                value={d.apiModel}
                onChange={(e) => setD({ ...d, apiModel: e.target.value })}
                placeholder="id модели из GET /v1/models"
                className={`${inputCls} font-mono text-xs`}
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <label className="flex items-center justify-between gap-3">
              Пропускать, если нижняя граница возраста ≥ N
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={d.apiPassAge}
                onChange={(e) =>
                  setD({ ...d, apiPassAge: Number(e.target.value) })
                }
                className={`w-28 ${inputCls}`}
              />
            </label>
            <span className="text-xs text-zinc-500">
              По умолчанию 16, включительно. Ниже порога — «Ей есть 18!» и
              ручная проверка.
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <Toggle
              checked={d.apiFallbackLocal}
              onChange={(v) => setD({ ...d, apiFallbackLocal: v })}
              label="При ошибке API использовать локальную проверку"
              hint="Ошибка = нет баланса, таймаут, сеть, 5xx. Пользователь ничего не замечает; алерт в ошибки OPS уходит в любом случае."
            />
            <select
              value={d.apiFallbackEngine}
              disabled={!d.apiFallbackLocal}
              onChange={(e) =>
                setD({
                  ...d,
                  apiFallbackEngine:
                    e.target.value === "insightface" ? "insightface" : "opencv",
                })
              }
              className={`${inputCls} disabled:opacity-50`}
            >
              <option value="opencv">Старая (OpenCV)</option>
              <option value="insightface">Новая (InsightFace)</option>
            </select>
            {!d.apiFallbackLocal ? (
              <span className="text-xs text-zinc-500">
                Выключено: при ошибке API человек увидит «Проверка временно
                недоступна».
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="text-sm font-medium">Отправка на ручную проверку</div>
        <p className="mt-1 text-xs text-zinc-500">
          Сомнительные и детские фото блокируются сразу. Под сообщением о блоке
          у человека кнопка «Ей есть 18!» — фото попадает в очередь выше, а в
          ops-чат (тема «Контроль качества») уходит фото с кнопками
          «Одобрить / Заблокировать». Одобрили — человеку придёт «Прости, наша
          ошибка…», и это же фото больше не блокируется (по хэшу файла).
          Отклонили — остаётся блок.
          {engine === "api"
            ? " Если модель отказалась оценивать фото, заявка создаётся сразу, без кнопки у человека."
            : ""}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4">
        <div className="text-sm font-medium">Уведомления о событиях проверки</div>
        <p className="text-xs text-zinc-500">
          Лента в тему «AgeGate» ops-чата: фото, кто, время (МСК), статус. Без
          кнопок. Относится ко всем движкам; технические ошибки сюда не
          попадают. Одно сообщение на уникальное фото.
        </p>
        <Toggle
          checked={d.notifyAll}
          onChange={(v) => setD({ ...d, notifyAll: v })}
          label="Информировать обо всех проверках фото"
        />
        <div className="ml-4 flex flex-col gap-2 border-l border-white/10 pl-4">
          <Toggle
            checked={d.notifyApproved}
            disabled={!d.notifyAll}
            onChange={(v) => setD({ ...d, notifyApproved: v })}
            label="Принятые"
          />
          <Toggle
            checked={d.notifyRejected}
            disabled={!d.notifyAll}
            onChange={(v) => setD({ ...d, notifyRejected: v })}
            label="Отклонённые"
            hint="С причиной, в том числе «нет лица»."
          />
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void save({})}
        className="rounded-full btn-grad px-4 py-2 text-sm disabled:opacity-50"
      >
        Сохранить настройки
      </button>
    </div>
  );
}
