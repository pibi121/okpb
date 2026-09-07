"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Shot = {
  id: string;
  orderIndex: number;
  status: string;
  actionType: string;
  billingCredits: number;
  stillUrl: string | null;
  resultUrl: string | null;
  continuity?: string | null;
  approved?: boolean;
  dialogueText?: string | null;
  durationSec?: number;
};

type Job = {
  id: string;
  status: string;
  phase: string;
  progress: number;
  totalCredits: number;
  resultUrl: string | null;
  errorMessage: string | null;
  shots: Shot[];
  scenario?: { id?: string; title: string } | null;
};

export function JobWatcher({ initialJob }: { initialJob: Job }) {
  const [job, setJob] = useState(initialJob);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function tick() {
      const res = await fetch(`/api/jobs?id=${initialJob.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (active) setJob(data.job);

      const done = ["completed", "failed", "cancelled", "preview_ready"];
      if (data.job && !done.includes(data.job.status)) {
        setTimeout(tick, 1200);
      }
    }

    tick();
    return () => {
      active = false;
    };
  }, [initialJob.id]);

  const isPreview = job.phase === "preview" || job.status === "preview_ready";
  const canReviewShots =
    job.phase === "preview" &&
    ["preview_ready", "running_still"].includes(job.status);

  async function approveShot(shotId: string, approved: boolean) {
    setBusyId(shotId);
    setMessage("");
    const res = await fetch("/api/jobs?action=approve_shot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId, approved }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setMessage(data.error || "Не удалось утвердить");
      return;
    }
    setJob((j) => ({
      ...j,
      shots: j.shots.map((s) =>
        s.id === shotId ? { ...s, approved } : s,
      ),
    }));
  }

  async function regenShot(shotId: string) {
    setBusyId(shotId);
    setMessage("");
    const res = await fetch("/api/jobs?action=regen_shot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setMessage(data.error || "Не удалось перегенерировать");
      return;
    }
    setMessage(`Кадр перегенерируется (−${data.charge} кр.)`);
    setJob((j) => ({
      ...j,
      status: "running_still",
      progress: 10,
      shots: j.shots.map((s) =>
        s.id === shotId
          ? {
              ...s,
              status: "queued",
              stillUrl: null,
              approved: false,
            }
          : s,
      ),
    }));

    // resume polling
    const poll = async () => {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const r = await fetch(`/api/jobs?id=${job.id}`);
        if (!r.ok) continue;
        const d = await r.json();
        setJob(d.job);
        if (["preview_ready", "failed", "completed"].includes(d.job.status)) {
          break;
        }
      }
    };
    void poll();
  }

  const approvedCount = job.shots.filter((s) => s.approved).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-zinc-200 p-4">
        <h1 className="text-xl font-semibold">Заказ {job.id.slice(0, 8)}…</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {job.scenario?.title || "—"} ·{" "}
          {isPreview ? "превью кадров" : "оживление / полный рендер"}
        </p>
        <p className="mt-2 text-sm">
          Статус: <strong>{job.status}</strong> · {job.progress}% ·{" "}
          {job.totalCredits} кр.
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded bg-zinc-100">
          <div
            className="h-full bg-zinc-900 transition-all"
            style={{ width: `${job.progress}%` }}
          />
        </div>
        {job.errorMessage ? (
          <p className="mt-2 text-sm text-red-600">{job.errorMessage}</p>
        ) : null}
        {message ? <p className="mt-2 text-sm text-zinc-700">{message}</p> : null}
        {job.status === "preview_ready" ? (
          <div className="mt-3 space-y-2 text-sm text-emerald-800">
            <p>
              Картинки готовы. Утвердите удачные кадры или переделайте отдельные.
              Потом вернитесь в сценарий и нажмите «Оживить фильм».
            </p>
            <p className="text-zinc-600">
              Утверждено: {approvedCount} / {job.shots.length}
            </p>
            {job.scenario?.id ? (
              <Link
                href={`/scenarios/${job.scenario.id}`}
                className="inline-block underline"
              >
                Вернуться к сценарию →
              </Link>
            ) : null}
          </div>
        ) : null}
        {job.resultUrl ? (
          <p className="mt-3 text-sm">
            Итог:{" "}
            <a className="underline" href={job.resultUrl} target="_blank">
              открыть
            </a>
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-zinc-200 p-4">
        <h2 className="font-medium">Кадры</h2>
        <ul className="mt-2 flex flex-col gap-3 text-sm">
          {job.shots.map((shot) => (
            <li
              key={shot.id}
              className={`rounded-md border p-3 ${
                shot.approved
                  ? "border-emerald-300 bg-emerald-50/40"
                  : "border-zinc-100"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  #{shot.orderIndex + 1} · {shot.actionType} · {shot.status}
                  {shot.continuity ? ` · ${shot.continuity}` : ""}
                  {shot.approved ? " · ✓ утверждён" : ""}
                </span>
                <span className="text-zinc-500">{shot.billingCredits} кр.</span>
              </div>
              {shot.dialogueText ? (
                <p className="mt-1 text-xs text-zinc-500">{shot.dialogueText}</p>
              ) : null}
              {shot.stillUrl ? (
                <div className="mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.stillUrl}
                    alt={`Кадр ${shot.orderIndex + 1}`}
                    className="max-h-48 rounded border border-zinc-200 object-contain"
                  />
                  <p className="mt-1">
                    <a
                      className="underline"
                      href={shot.stillUrl}
                      target="_blank"
                    >
                      открыть превью
                    </a>
                  </p>
                </div>
              ) : null}
              {shot.resultUrl ? (
                <p className="mt-1">
                  Видео:{" "}
                  <a className="underline" href={shot.resultUrl} target="_blank">
                    открыть клип
                  </a>
                </p>
              ) : null}

              {canReviewShots && shot.stillUrl ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === shot.id}
                    onClick={() =>
                      void approveShot(shot.id, !shot.approved)
                    }
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                  >
                    {shot.approved ? "Снять утверждение" : "Утвердить"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === shot.id}
                    onClick={() => void regenShot(shot.id)}
                    className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs"
                  >
                    Переделать кадр
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
