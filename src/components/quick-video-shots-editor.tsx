"use client";

import { useMemo } from "react";
import { PromptLegoEditor } from "@/components/prompt-lego-editor";
import type { LegoCharacterRef, VideoLegoFile } from "@/lib/prompt-lego-core";
import { buildVideoLegoCatalog } from "@/lib/prompt-lego-core";
import {
  MAX_QUICK_VIDEO_TOTAL_SEC,
  MIN_QUICK_VIDEO_SHOT_SEC,
  MIN_QUICK_VIDEO_TOTAL_SEC,
  splitDurationEvenly,
  sumQuickVideoShotsSec,
  type QuickVideoShotsPlan,
} from "@/lib/quick-video-prompt";

type Props = {
  plan: QuickVideoShotsPlan;
  onChange: (plan: QuickVideoShotsPlan) => void;
  selectedCharacterIds: string[];
  characters: LegoCharacterRef[];
  videoLego: VideoLegoFile;
  disabled?: boolean;
};

function newShotId(n: number) {
  return `shot-${n}-${Date.now().toString(36)}`;
}

export function QuickVideoShotsEditor({
  plan,
  onChange,
  selectedCharacterIds,
  characters,
  videoLego,
  disabled,
}: Props) {
  const usedSec = sumQuickVideoShotsSec(plan.shots);
  const remaining = plan.totalDurationSec - usedSec;
  const overBudget = remaining < 0;

  const baseCatalog = useMemo(
    () => buildVideoLegoCatalog({ videoLego, characters }),
    [characters, videoLego],
  );

  function patchShot(index: number, patch: Partial<(typeof plan.shots)[0]>) {
    const shots = plan.shots.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    onChange({ ...plan, shots });
  }

  function removeShot(index: number) {
    if (plan.shots.length <= 1) return;
    onChange({ ...plan, shots: plan.shots.filter((_, i) => i !== index) });
  }

  function moveShot(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= plan.shots.length) return;
    const shots = [...plan.shots];
    const tmp = shots[index]!;
    shots[index] = shots[next]!;
    shots[next] = tmp;
    onChange({ ...plan, shots });
  }

  function addShot() {
    const dur = Math.max(
      MIN_QUICK_VIDEO_SHOT_SEC,
      Math.min(3, Math.max(remaining, MIN_QUICK_VIDEO_SHOT_SEC)),
    );
    onChange({
      ...plan,
      shots: [
        ...plan.shots,
        {
          id: newShotId(plan.shots.length + 1),
          durationSec: dur,
          legoQuery: "",
        },
      ],
    });
  }

  function splitEvenly() {
    const durations = splitDurationEvenly(plan.totalDurationSec, plan.shots.length);
    onChange({
      ...plan,
      shots: plan.shots.map((s, i) => ({
        ...s,
        durationSec: durations[i] || MIN_QUICK_VIDEO_SHOT_SEC,
      })),
    });
  }

  let cursor = 0;
  const segments = plan.shots.map((s) => {
    const start = cursor;
    const end = cursor + s.durationSec;
    cursor = end;
    return { start, end, durationSec: s.durationSec };
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-zinc-500">Общая длительность (сек)</span>
          <input
            type="number"
            min={MIN_QUICK_VIDEO_TOTAL_SEC}
            max={MAX_QUICK_VIDEO_TOTAL_SEC}
            disabled={disabled}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
            value={plan.totalDurationSec}
            onChange={(e) =>
              onChange({
                ...plan,
                totalDurationSec: Math.min(
                  MAX_QUICK_VIDEO_TOTAL_SEC,
                  Math.max(MIN_QUICK_VIDEO_TOTAL_SEC, Number(e.target.value) || 6),
                ),
              })
            }
          />
        </label>
        <div className="flex flex-col justify-end text-sm">
          <span className={overBudget ? "text-red-400" : "text-zinc-500"}>
            Использовано {usedSec} / {plan.totalDurationSec} сек
            {!overBudget && remaining > 0 ? ` · осталось ${remaining}` : null}
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || plan.shots.length >= 6}
              onClick={addShot}
              className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs hover:border-peach/40 disabled:opacity-50"
            >
              + Шот
            </button>
            <button
              type="button"
              disabled={disabled || plan.shots.length < 2}
              onClick={splitEvenly}
              className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs hover:border-peach/40 disabled:opacity-50"
            >
              Поровну
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#0a0a0c] p-2">
        <div className="flex h-3 overflow-hidden rounded bg-white/5">
          {segments.map((seg, i) => (
            <div
              key={plan.shots[i]?.id || i}
              title={`Шот ${i + 1}: ${seg.start}–${seg.end}s`}
              className="h-full min-w-[4px] border-r border-black/40 bg-peach/50 last:border-r-0"
              style={{
                width: `${Math.max(4, (seg.durationSec / plan.totalDurationSec) * 100)}%`,
              }}
            />
          ))}
          {remaining > 0 ? (
            <div
              className="h-full flex-1 bg-white/5"
              title={`Свободно ${remaining}s`}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {plan.shots.map((shot, index) => (
          <div
            key={shot.id || index}
            className="rounded-xl border border-white/10 bg-[#0c0c0e] p-3"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Шот {index + 1}</span>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                сек
                <input
                  type="number"
                  min={MIN_QUICK_VIDEO_SHOT_SEC}
                  max={MAX_QUICK_VIDEO_TOTAL_SEC}
                  disabled={disabled}
                  value={shot.durationSec}
                  onChange={(e) =>
                    patchShot(index, {
                      durationSec: Math.max(
                        MIN_QUICK_VIDEO_SHOT_SEC,
                        Number(e.target.value) || 1,
                      ),
                    })
                  }
                  className="w-14 rounded border border-white/10 bg-[#121214] px-2 py-1 text-sm text-foreground"
                />
              </label>
              {segments[index] ? (
                <span className="text-[11px] text-zinc-600">
                  {segments[index]!.start}–{segments[index]!.end}s
                </span>
              ) : null}
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  onClick={() => moveShot(index, -1)}
                  className="rounded border border-white/10 px-2 py-0.5 text-xs disabled:opacity-40"
                  aria-label="Выше"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={disabled || index === plan.shots.length - 1}
                  onClick={() => moveShot(index, 1)}
                  className="rounded border border-white/10 px-2 py-0.5 text-xs disabled:opacity-40"
                  aria-label="Ниже"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={disabled || plan.shots.length <= 1}
                  onClick={() => removeShot(index)}
                  className="rounded border border-white/10 px-2 py-0.5 text-xs text-red-300 disabled:opacity-40"
                >
                  ×
                </button>
              </div>
            </div>
            <PromptLegoEditor
              catalog={baseCatalog}
              characters={characters}
              selectedIds={selectedCharacterIds}
              value={shot.legoQuery}
              onChange={(v) => patchShot(index, { legoQuery: v })}
              disabled={disabled}
              variant="video"
            />
          </div>
        ))}
      </div>

      {overBudget ? (
        <p className="text-xs text-red-400">
          Сумма шотов больше общей длительности — укороти шоты или увеличь total.
        </p>
      ) : null}
    </div>
  );
}
