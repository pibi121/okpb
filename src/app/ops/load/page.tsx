"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtMs, fmtTime, opsFetch } from "@/lib/ops/ops-fetch";

type Health = "ok" | "warn" | "danger";

type Payload = {
  build: string;
  at: string;
  summary: {
    health: Health;
    workersOnline: number;
    workersDead: number;
    workersTotal: number;
    jobsInflight: number;
    jobsQueued: number;
    errors24h: number;
    pendingGallery: number;
    busyVideo: number;
    training: number;
    processBusy: boolean;
    processBusyForMs: number;
    avgProcessJobMs24h: number;
    maintenance: boolean;
    loadMode: boolean;
    tunnelError?: string;
  };
  tunnel: {
    ok: boolean;
    reason: string;
    error: string;
    updatedAt: string | null;
    host: string | null;
    sshPort: string | number | null;
  } | null;
  workers: Array<{
    id: string;
    key: string;
    label: string;
    provider: string;
    pool: string;
    enabled: boolean;
    status: string;
    lastHeartbeatAt: string | null;
    lastError: string;
    costRubPerHour: number;
    needsProvider: boolean;
    currentJob: {
      id: string;
      kind: string;
      stage: string;
      userId: string | null;
      queuedAt: string;
      startedAt: string | null;
    } | null;
  }>;
  functions: Array<{
    key: string;
    title: string;
    pool: string;
    inflight: number;
    queued: number;
    avgWaitMs: number;
    avgRunMs: number;
    baselineWaitMs: number;
    baselineRunMs: number;
    waitRatio: number;
    runRatio: number;
    health: Health;
  }>;
  activeJobs: Array<{
    id: string;
    kind: string;
    pool: string;
    status: string;
    stage: string;
    userId: string | null;
    worker: string | null;
    queuedAt: string;
    waitMs: number;
  }>;
  providerReady: {
    runpod: boolean;
    vast: boolean;
    runpodSpawnReady?: boolean;
    vastSpawnReady?: boolean;
    runpodMissing?: string[];
    vastMissing?: string[];
    runpodDryRun?: boolean;
    vastDryRun?: boolean;
  };
  orchestrator: Record<string, unknown>;
};

function healthClass(h: Health) {
  if (h === "danger") return "text-coral";
  if (h === "warn") return "text-apricot";
  return "text-emerald-300";
}

function healthBg(h: Health) {
  if (h === "danger") return "border-coral/40 bg-coral/10";
  if (h === "warn") return "border-apricot/40 bg-apricot/10";
  return "border-white/10 bg-[#121214]";
}

export default function OpsLoadPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    setData(await opsFetch<Payload>("/api/ops/load"));
  }

  useEffect(() => {
    void load().catch((e) => setMsg(e instanceof Error ? e.message : "ошибка"));
    const t = setInterval(() => void load().catch(() => undefined), 12000);
    return () => clearInterval(t);
  }, []);

  async function act(action: string) {
    setMsg("");
    try {
      const r = await opsFetch<{ message: string }>("/api/ops/load", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setMsg(r.message);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ошибка");
    }
  }

  if (!data) return <p className="text-zinc-500">Смотрю нагрузку…</p>;
  const s = data.summary;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl">Нагрузка</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Сервер, GPU и функции. Красное = ожидание или время выше эталона. Обновление ~12 сек.
        </p>
      </div>
      {msg ? <p className="text-sm text-peach">{msg}</p> : null}
      {data.summary.tunnelError || (data.tunnel && !data.tunnel.ok && data.tunnel.error) ? (
        <div className="rounded-2xl border border-coral/40 bg-coral/10 p-4 text-sm text-coral">
          <div className="font-medium">Туннель GPU / SSH</div>
          <p className="mt-1 text-coral/90">
            {data.summary.tunnelError || data.tunnel?.error}
          </p>
          {data.tunnel?.host ? (
            <p className="mt-1 text-xs text-zinc-400">
              {data.tunnel.host}:{String(data.tunnel.sshPort || "")} ·{" "}
              {data.tunnel.reason || "—"}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`rounded-2xl border p-4 ${healthBg(s.health)}`}>
          <div className="text-[11px] uppercase tracking-widest text-zinc-500">Пульс</div>
          <div className={`mt-2 font-display text-2xl ${healthClass(s.health)}`}>
            {s.health === "ok" ? "Норма" : s.health === "warn" ? "Внимание" : "Опасно"}
          </div>
          <div className="mt-1 text-xs text-zinc-500">{data.build}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
          <div className="text-[11px] uppercase tracking-widest text-zinc-500">GPU живые</div>
          <div className={`mt-2 font-display text-2xl ${s.workersDead ? "text-coral" : ""}`}>
            {s.workersOnline}/{s.workersTotal}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            мёртвых: {s.workersDead} · процесс {s.processBusy ? `занят ${fmtMs(s.processBusyForMs)}` : "свободен"}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
          <div className="text-[11px] uppercase tracking-widest text-zinc-500">Сейчас</div>
          <div className="mt-2 font-display text-2xl">
            {s.jobsInflight} / {s.jobsQueued}
          </div>
          <div className="mt-1 text-xs text-zinc-500">в работе / в очереди оркестра</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
          <div className="text-[11px] uppercase tracking-widest text-zinc-500">Сбои 24ч</div>
          <div className={`mt-2 font-display text-2xl ${s.errors24h ? "text-coral" : ""}`}>
            {s.errors24h}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            <Link href="/ops/errors" className="text-peach hover:underline">
              открыть ошибки
            </Link>
            {" · "}
            gallery {s.pendingGallery} · video {s.busyVideo} · LoRA {s.training}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
          onClick={() => void act("heartbeat_now")}
        >
          Проверить GPU сейчас
        </button>
        <button
          className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
          onClick={() => void act("request_burst_video")}
        >
          + GPU под видео (RunPod)
        </button>
        <button
          className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
          onClick={() => void act("request_burst_lora")}
        >
          + GPU под LoRA (Vast)
        </button>
        <button
          className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
          onClick={() => void act("clear_burst_requests")}
        >
          Снять burst / очистить
        </button>
        <Link href="/ops/queue" className="rounded-full border border-white/15 px-4 py-1.5 text-sm">
          Старая очередь →
        </Link>
      </div>

      <p className="text-xs text-zinc-500">
        RunPod: {data.providerReady.runpod ? "ключ есть" : "нет ключа"}
        {data.providerReady.runpodSpawnReady
          ? data.providerReady.runpodDryRun
            ? " · spawn ready (DRY RUN)"
            : " · spawn ready"
          : data.providerReady.runpodMissing?.length
            ? ` · нужно: ${data.providerReady.runpodMissing.join(", ")}`
            : ""}
        {" · "}
        Vast: {data.providerReady.vast ? "ключ есть" : "нет ключа"}
        {data.providerReady.vastSpawnReady
          ? data.providerReady.vastDryRun
            ? " · spawn ready (DRY RUN)"
            : " · spawn ready"
          : data.providerReady.vastMissing?.length
            ? ` · нужно: ${data.providerReady.vastMissing.join(", ")}`
            : ""}
      </p>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Карты GPU</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="py-2 pr-3">Карта</th>
                <th className="py-2 pr-3">Пул</th>
                <th className="py-2 pr-3">Статус</th>
                <th className="py-2 pr-3">Сейчас</th>
                <th className="py-2 pr-3">Heartbeat</th>
                <th className="py-2 pr-3">₽/ч</th>
              </tr>
            </thead>
            <tbody>
              {data.workers.map((w) => (
                <tr key={w.id} className="border-t border-white/8 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{w.label}</div>
                    <div className="text-xs text-zinc-500">
                      {w.provider} · {w.key}
                      {w.needsProvider ? " · ждёт ключи" : ""}
                    </div>
                    {w.lastError ? (
                      <div className="mt-1 text-xs text-coral">{w.lastError}</div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">{w.pool}</td>
                  <td
                    className={`py-3 pr-3 ${
                      w.status === "dead" || w.status === "offline"
                        ? "text-coral"
                        : w.status === "busy"
                          ? "text-apricot"
                          : w.status === "online"
                            ? "text-emerald-300"
                            : "text-zinc-400"
                    }`}
                  >
                    {w.status}
                    {!w.enabled ? " (выкл)" : ""}
                  </td>
                  <td className="py-3 pr-3 text-xs text-zinc-400">
                    {w.currentJob
                      ? `${w.currentJob.kind} · ${w.currentJob.stage}`
                      : "—"}
                  </td>
                  <td className="py-3 pr-3 text-xs text-zinc-500">
                    {w.lastHeartbeatAt ? fmtTime(w.lastHeartbeatAt) : "—"}
                  </td>
                  <td className="py-3 pr-3">{w.costRubPerHour}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Функции сервиса</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="py-2 pr-3">Функция</th>
                <th className="py-2 pr-3">В работе</th>
                <th className="py-2 pr-3">Очередь</th>
                <th className="py-2 pr-3">Ожидание ср.</th>
                <th className="py-2 pr-3">Работа ср.</th>
                <th className="py-2 pr-3">vs эталон</th>
              </tr>
            </thead>
            <tbody>
              {data.functions.map((f) => (
                <tr
                  key={f.key}
                  className={`border-t border-white/8 ${
                    f.health === "danger"
                      ? "bg-coral/10"
                      : f.health === "warn"
                        ? "bg-apricot/5"
                        : ""
                  }`}
                >
                  <td className="py-3 pr-3">
                    <div className="font-medium">{f.title}</div>
                    <div className="text-xs text-zinc-500">пул {f.pool}</div>
                  </td>
                  <td className="py-3 pr-3">{f.inflight}</td>
                  <td className={`py-3 pr-3 ${f.queued ? "text-apricot" : ""}`}>{f.queued}</td>
                  <td className="py-3 pr-3">
                    {f.avgWaitMs ? fmtMs(f.avgWaitMs) : "—"}
                    <div className="text-xs text-zinc-500">эталон {fmtMs(f.baselineWaitMs)}</div>
                  </td>
                  <td className="py-3 pr-3">
                    {f.avgRunMs ? fmtMs(f.avgRunMs) : "—"}
                    <div className="text-xs text-zinc-500">эталон {fmtMs(f.baselineRunMs)}</div>
                  </td>
                  <td className={`py-3 pr-3 ${healthClass(f.health)}`}>
                    ожид. {f.waitRatio || 0}% · раб. {f.runRatio || 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-peach">Активные джобы оркестра</h2>
        <ul className="mt-2 text-sm">
          {data.activeJobs.map((j) => (
            <li key={j.id} className="border-t border-white/8 py-2">
              {j.kind} · {j.status}/{j.stage} · пул {j.pool}
              {j.worker ? ` · ${j.worker}` : ""} · ждёт {fmtMs(j.waitMs)} ·{" "}
              {fmtTime(j.queuedAt)}
            </li>
          ))}
          {!data.activeJobs.length ? (
            <li className="text-zinc-500">Сейчас пусто — хорошо.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
