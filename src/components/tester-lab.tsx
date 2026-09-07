"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageGeneration } from "@/components/image-generation";
import {
  SKIN_DETAIL_DEFAULT_ENABLED,
  SKIN_DETAIL_DEFAULT_STRENGTH,
  SkinDetailControls,
} from "@/components/skin-detail-controls";

type Char = {
  id: string;
  name: string;
  loraStatus: string;
  triggerWord: string | null;
};
type Opt = { id: string; label: string };

type Variant = {
  id: string;
  index: number;
  seed: string;
  resultUrl: string | null;
  status: string;
  error: string | null;
  quality: number | null;
  face: number | null;
  promptFit: number | null;
  poseFit: number | null;
  note: string;
};

type Session = {
  id: string;
  title: string | null;
  characterMode: string;
  poseOn: boolean;
  poseId: string | null;
  styleOn: boolean;
  styleId: string | null;
  userNote: string;
  composedPrompt: string | null;
  variationCount: number;
  status: string;
  error: string | null;
  createdAt: string;
  variants: Variant[];
};

type SummaryRow = {
  key: string;
  variants: number;
  qualityPct: number | null;
  facePct: number | null;
  promptPct: number | null;
  posePct: number | null;
};

const SIZES = [
  { id: "888x1176", label: "888×1176", w: 888, h: 1176 },
  { id: "1024x1024", label: "1024×1024", w: 1024, h: 1024 },
];

function AxisToggle({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled?: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className={disabled ? "text-zinc-400" : "text-zinc-700"}>{label}</span>
      {disabled ? (
        <span className="text-zinc-400">n/a</span>
      ) : (
        <div className="flex gap-1">
          <button
            type="button"
            className={
              value === 1
                ? "rounded bg-emerald-700 px-2 py-0.5 text-white"
                : "rounded border px-2 py-0.5"
            }
            onClick={() => onChange(value === 1 ? null : 1)}
          >
            +
          </button>
          <button
            type="button"
            className={
              value === -1
                ? "rounded bg-rose-700 px-2 py-0.5 text-white"
                : "rounded border px-2 py-0.5"
            }
            onClick={() => onChange(value === -1 ? null : -1)}
          >
            −
          </button>
        </div>
      )}
    </div>
  );
}

export function TesterLab({
  characters,
  poses,
  styles,
  initialSessions,
  initialSummary,
}: {
  characters: Char[];
  poses: Opt[];
  styles: Opt[];
  initialSessions: Session[];
  initialSummary: SummaryRow[];
}) {
  const [characterMode, setCharacterMode] = useState<"none" | "lookbook" | "lora">(
    characters.some((c) => c.loraStatus === "lora_ready") ? "lora" : "lookbook",
  );
  const [characterId, setCharacterId] = useState(characters[0]?.id || "");
  const [poseOn, setPoseOn] = useState(true);
  const [poseId, setPoseId] = useState(poses[0]?.id || "");
  const [styleOn, setStyleOn] = useState(false);
  const [styleId, setStyleId] = useState(styles[0]?.id || "");
  const [userNote, setUserNote] = useState("");
  const [variationCount, setVariationCount] = useState(3);
  const [sizeId, setSizeId] = useState(SIZES[0].id);
  const [skinDetail, setSkinDetail] = useState(SKIN_DETAIL_DEFAULT_ENABLED);
  const [skinDetailStrength, setSkinDetailStrength] = useState(
    SKIN_DETAIL_DEFAULT_STRENGTH,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState(initialSessions);
  const [summary, setSummary] = useState(initialSummary);
  const [activeId, setActiveId] = useState(initialSessions[0]?.id || "");

  const size = useMemo(
    () => SIZES.find((s) => s.id === sizeId) || SIZES[0],
    [sizeId],
  );
  const active = sessions.find((s) => s.id === activeId) || sessions[0] || null;
  const hasPending = sessions.some(
    (s) =>
      s.status === "pending" || s.variants.some((v) => v.status === "pending"),
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/peach/tester");
    if (!res.ok) return;
    const data = (await res.json()) as {
      sessions: Session[];
      summary: SummaryRow[];
    };
    setSessions(data.sessions);
    setSummary(data.summary);
  }, []);

  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [hasPending, refresh]);

  async function createSession() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/peach/tester", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          characterMode,
          characterIds:
            characterMode === "none" ? [] : characterId ? [characterId] : [],
          poseOn,
          poseId: poseOn ? poseId : undefined,
          styleOn,
          styleId: styleOn ? styleId : undefined,
          userNote,
          variationCount,
          width: size.w,
          height: size.h,
          skinDetail,
          skinDetailStrength: skinDetail ? skinDetailStrength : 0,
          title: [
            characterMode,
            poseOn ? poseId : "no-pose",
            styleOn ? styleId : "no-style",
          ].join(" · "),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ошибка");
        return;
      }
      setActiveId(data.session.id);
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function rate(
    variantId: string,
    patch: Partial<{
      quality: number | null;
      face: number | null;
      promptFit: number | null;
      poseFit: number | null;
      note: string;
    }>,
  ) {
    const res = await fetch("/api/peach/tester", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rate", variantId, ...patch }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "rate error");
      return;
    }
    await refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">Ячейка матрицы</h2>
        <p className="text-xs text-zinc-500">
          Один LLM-промпт → {variationCount} seed. Персонаж / поза / стиль —
          независимые флаги.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          Персонаж
          <select
            className="rounded-md border border-zinc-300 px-3 py-2"
            value={characterMode}
            onChange={(e) =>
              setCharacterMode(e.target.value as "none" | "lookbook" | "lora")
            }
          >
            <option value="none">Без персонажа</option>
            <option value="lookbook">Lookbook (без LoRA)</option>
            <option value="lora">LoRA + lookbook</option>
          </select>
        </label>

        {characterMode !== "none" ? (
          <label className="flex flex-col gap-1 text-sm">
            Кто
            <select
              className="rounded-md border border-zinc-300 px-3 py-2"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.loraStatus}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={poseOn}
            onChange={(e) => setPoseOn(e.target.checked)}
          />
          Поза
        </label>
        {poseOn ? (
          <select
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            value={poseId}
            onChange={(e) => setPoseId(e.target.value)}
          >
            {poses.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={styleOn}
            onChange={(e) => setStyleOn(e.target.checked)}
          />
          Стиль
        </label>
        {styleOn ? (
          <select
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            value={styleId}
            onChange={(e) => setStyleId(e.target.value)}
          >
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          Note (любой язык)
          <textarea
            rows={3}
            className="rounded-md border border-zinc-300 px-3 py-2"
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            placeholder="Опционально — пожелания к сцене"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Вариаций (seed)
          <select
            className="rounded-md border border-zinc-300 px-3 py-2"
            value={variationCount}
            onChange={(e) => setVariationCount(Number(e.target.value))}
          >
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Размер
          <select
            className="rounded-md border border-zinc-300 px-3 py-2"
            value={sizeId}
            onChange={(e) => setSizeId(e.target.value)}
          >
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <SkinDetailControls
          enabled={skinDetail}
          strength={skinDetailStrength}
          onEnabledChange={setSkinDetail}
          onStrengthChange={setSkinDetailStrength}
        />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={submitting}
          onClick={() => void createSession()}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitting ? "В очередь…" : "Сгенерировать пачку"}
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {summary.length ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white p-3">
            <p className="mb-2 text-sm font-medium">Сводка по ячейкам</p>
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-2">Ячейка</th>
                  <th className="py-1 pr-2">N</th>
                  <th className="py-1 pr-2">Качество+</th>
                  <th className="py-1 pr-2">Лицо+</th>
                  <th className="py-1 pr-2">Промпт+</th>
                  <th className="py-1">Поза+</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.key} className="border-t border-zinc-100">
                    <td className="py-1 pr-2">{row.key}</td>
                    <td className="py-1 pr-2">{row.variants}</td>
                    <td className="py-1 pr-2">
                      {row.qualityPct == null ? "—" : `${row.qualityPct}%`}
                    </td>
                    <td className="py-1 pr-2">
                      {row.facePct == null ? "—" : `${row.facePct}%`}
                    </td>
                    <td className="py-1 pr-2">
                      {row.promptPct == null ? "—" : `${row.promptPct}%`}
                    </td>
                    <td className="py-1">
                      {row.posePct == null ? "—" : `${row.posePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {sessions.length ? (
          <div className="flex flex-wrap gap-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={
                  active?.id === s.id
                    ? "rounded bg-zinc-900 px-2 py-1 text-xs text-white"
                    : "rounded border px-2 py-1 text-xs"
                }
              >
                {s.title || s.id.slice(0, 6)} · {s.status}
              </button>
            ))}
          </div>
        ) : null}

        {active ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
              <div className="font-medium">{active.title}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {active.characterMode}
                {active.poseOn ? ` · поза ${active.poseId}` : " · без позы"}
                {active.styleOn ? ` · стиль ${active.styleId}` : " · без стиля"}
                {active.status === "pending" ? " · генерация…" : ""}
              </div>
              {active.error ? (
                <p className="mt-2 text-xs text-red-600">{active.error}</p>
              ) : null}
              {active.composedPrompt ? (
                <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs text-zinc-700">
                  {active.composedPrompt}
                </pre>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {active.variants.map((v) => (
                <article
                  key={v.id}
                  className="overflow-hidden rounded-lg border border-zinc-200 bg-white"
                >
                  <div className="relative flex min-h-[220px] w-full items-center justify-center overflow-hidden bg-zinc-100">
                    {v.status === "pending" ? (
                      <ImageGeneration
                        fill
                        prompt={active.composedPrompt}
                        resolution={`v${v.index + 1}`}
                      />
                    ) : v.status === "error" ? (
                      <p className="px-3 text-center text-xs text-red-700">
                        {v.error || "ошибка"}
                      </p>
                    ) : v.resultUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={v.resultUrl}
                        alt={`v${v.index + 1}`}
                        className="max-h-[50vh] max-w-full object-contain"
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 p-3">
                    <div className="text-xs text-zinc-500">
                      #{v.index + 1} · seed {v.seed.slice(0, 10)}…
                    </div>
                    <AxisToggle
                      label="Качество"
                      value={v.quality}
                      onChange={(quality) => void rate(v.id, { quality })}
                    />
                    <AxisToggle
                      label="Лицо"
                      value={v.face}
                      disabled={active.characterMode === "none"}
                      onChange={(face) => void rate(v.id, { face })}
                    />
                    <AxisToggle
                      label="Промпт"
                      value={v.promptFit}
                      onChange={(promptFit) => void rate(v.id, { promptFit })}
                    />
                    <AxisToggle
                      label="Поза"
                      value={v.poseFit}
                      disabled={!active.poseOn}
                      onChange={(poseFit) => void rate(v.id, { poseFit })}
                    />
                    <input
                      className="rounded border border-zinc-300 px-2 py-1 text-xs"
                      placeholder="заметка…"
                      defaultValue={v.note}
                      onBlur={(e) => {
                        if (e.target.value !== v.note) {
                          void rate(v.id, { note: e.target.value });
                        }
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
            Пока нет тестовых сессий — собери ячейку слева и запусти пачку.
          </p>
        )}
      </div>
    </div>
  );
}
