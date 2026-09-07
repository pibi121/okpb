"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  Handle,
  Position,
  ConnectionMode,
  MarkerType,
  useConnection,
  type Connection,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import {
  CONTINUITY_LABELS,
  MAX_FILM_DURATION_SEC,
  WARDROBE_PRESETS,
  createDefaultGraph,
  estimateTimeline,
  formatDialogueText,
  parseDialogues,
  type ContinuityMode,
  type DialogueLine,
  type ScenarioGraph,
} from "@/lib/billing";
import { edgeTypes } from "@/components/flow-edges";

type CharacterOption = { id: string; name: string };

const PLACE_PRESETS = [
  { id: "bedroom", label: "Спальня" },
  { id: "forest", label: "Лес" },
  { id: "bathroom", label: "Ванная" },
  { id: "living_room", label: "Гостиная" },
  { id: "hotel", label: "Отель" },
  { id: "custom", label: "Своё описание" },
];

/** Невидимая зона на весь блок — связь «прилипает» к любому месту. */
const fullNodeTargetStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  top: 0,
  left: 0,
  transform: "none",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  opacity: 0,
  zIndex: 1,
};

/** Правая полоска — удобно тянуть стрелку от блока. */
const sourceStripStyle: CSSProperties = {
  width: 32,
  height: "100%",
  top: 0,
  right: -6,
  transform: "none",
  borderRadius: 8,
  border: "none",
  opacity: 0,
  zIndex: 3,
};

const sourceDotStyle: CSSProperties = {
  width: 12,
  height: 12,
  right: -6,
  background: "#18181b",
  border: "2px solid #fff",
  zIndex: 4,
};

function useIsDropTarget(nodeId: string) {
  const connection = useConnection();
  return (
    connection.inProgress &&
    connection.fromNode?.id !== nodeId &&
    connection.toNode?.id === nodeId
  );
}

function NodeShell({
  id,
  children,
  className,
  showTarget = true,
  showSource = true,
}: {
  id: string;
  children: React.ReactNode;
  className: string;
  showTarget?: boolean;
  showSource?: boolean;
}) {
  const isDropTarget = useIsDropTarget(id);

  return (
    <div
      className={`relative ${className} transition-[box-shadow,ring] ${
        isDropTarget
          ? "ring-2 ring-zinc-900 ring-offset-2 ring-offset-zinc-50"
          : ""
      }`}
    >
      {showTarget ? (
        <Handle
          type="target"
          position={Position.Left}
          style={fullNodeTargetStyle}
          className="!absolute !inset-0 !translate-x-0 !translate-y-0"
          isConnectableStart={false}
        />
      ) : null}
      <div className="relative z-[2]">{children}</div>
      {showSource ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="out-strip"
            style={sourceStripStyle}
            className="!translate-x-0 !translate-y-0"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="out"
            style={sourceDotStyle}
          />
        </>
      ) : null}
    </div>
  );
}

function StartNode({ id, data }: NodeProps) {
  const count = Array.isArray(data.characterIds) ? data.characterIds.length : 0;
  return (
    <NodeShell
      id={id}
      showTarget={false}
      className="min-w-[210px] rounded-md border-2 border-zinc-800 bg-white px-3 py-2 shadow-sm"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Старт фильма
      </div>
      <div className="text-sm font-medium">Герои, место, голоса</div>
      <div className="mt-1 text-xs text-zinc-500">
        {count} перс. · {String(data.placePreset || data.place || "место")} ·{" "}
        {String(data.language || "ru")}
      </div>
    </NodeShell>
  );
}

function ShotNode({ id, data }: NodeProps) {
  const people = Array.isArray(data.characterIds) ? data.characterIds.length : 0;
  const cont = String(data.continuity || "continue");
  const contLabel =
    CONTINUITY_LABELS[cont as ContinuityMode] || "Продолжить сцену";
  return (
    <NodeShell
      id={id}
      className="min-w-[200px] max-w-[240px] rounded-md border border-zinc-300 bg-white px-3 py-2 shadow-sm"
    >
      <div className="text-xs uppercase tracking-wide text-zinc-500">Кадр</div>
      <div className="text-sm font-medium">
        {String(data.title || "Кадр")}
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        {String(data.actionType || "idle")} · {String(data.camera || "medium")} ·{" "}
        {String(data.durationSec || 5)}с · {people} перс.
      </div>
      <div className="mt-1 text-[11px] text-zinc-400">{contLabel}</div>
    </NodeShell>
  );
}

function TransitionNode({ id, data }: NodeProps) {
  return (
    <NodeShell
      id={id}
      className="min-w-[120px] rounded-md border border-dashed border-zinc-400 bg-zinc-50 px-3 py-2"
    >
      <div className="text-xs uppercase text-zinc-500">Переход</div>
      <div className="text-sm">{String(data.transitionType || "cut")}</div>
    </NodeShell>
  );
}

const nodeTypes = {
  film_start: StartNode,
  shot: ShotNode,
  transition: TransitionNode,
};

function defaultShotFromPrevious(
  characters: CharacterOption[],
  prev: Node | undefined,
  start: Node | undefined,
  index: number,
) {
  const startIds = Array.isArray(start?.data?.characterIds)
    ? (start!.data.characterIds as string[])
    : characters[0]
      ? [characters[0].id]
      : [];
  const prevIds = Array.isArray(prev?.data?.characterIds)
    ? (prev!.data.characterIds as string[])
    : startIds;

  return {
    label: "Кадр",
    title: `Кадр ${index + 1}`,
    characterIds: [...prevIds],
    continuity: index === 0 ? "hard_cut" : "continue",
    actionType: "action",
    actionPrompt: "продолжение сцены",
    dialogueText: "",
    dialogues: [] as DialogueLine[],
    camera: "medium",
    audioEnabled: false,
    durationSec: 5,
    place: "",
    lighting: "",
    timeOfDay: "",
    placePreset: "",
    characterStates: {},
    locationRefUrl: "",
  };
}

type ReviewState = {
  synopsis: string;
  beats: { order: number; title: string; text: string; continuity: string }[];
  risks: { level: string; shotTitle: string; message: string }[];
  tips: string[];
  creditsCharged: number;
} | null;

export function ScenarioEditor({
  characters,
  initial,
}: {
  characters: CharacterOption[];
  initial?: { id: string; title: string; graphJson: string } | null;
}) {
  const router = useRouter();

  const initialGraph = useMemo(() => {
    let parsed: { nodes: Node[]; edges: Edge[] };
    if (initial?.graphJson) {
      try {
        parsed = JSON.parse(initial.graphJson) as {
          nodes: Node[];
          edges: Edge[];
        };
      } catch {
        parsed = createDefaultGraph(characters[0] ? [characters[0].id] : []) as {
          nodes: Node[];
          edges: Edge[];
        };
      }
    } else {
      parsed = createDefaultGraph(characters[0] ? [characters[0].id] : []) as {
        nodes: Node[];
        edges: Edge[];
      };
    }

    return {
      nodes: parsed.nodes,
      edges: (parsed.edges || []).map((e) => ({
        ...e,
        type: e.type || "deletable",
        animated: e.animated ?? true,
        markerEnd: e.markerEnd || {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
        },
      })),
    };
  }, [initial, characters]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const [title, setTitle] = useState(initial?.title || "Новый сценарий");
  const [scenarioId, setScenarioId] = useState(initial?.id || "");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialGraph.nodes[0]?.id || null,
  );
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<{
    preview: number;
    animate: number;
    review: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewState>(null);

  const selected = nodes.find((n) => n.id === selectedId) || null;
  const startNode = nodes.find((n) => n.type === "film_start");

  const timeline = useMemo(
    () => estimateTimeline({ nodes, edges } as ScenarioGraph),
    [nodes, edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "deletable",
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  function addShot() {
    const shots = nodes.filter((n) => n.type === "shot");
    const prev = shots[shots.length - 1];
    const id = `shot-${Date.now()}`;
    const x = (prev?.position?.x || 320) + 240;
    const y = prev?.position?.y || 120;

    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "shot",
        position: { x, y },
        data: defaultShotFromPrevious(characters, prev, startNode, shots.length),
      },
    ]);

    const source = prev?.id || startNode?.id;
    if (source) {
      setEdges((eds) => [
        ...eds,
        {
          id: `e-${source}-${id}`,
          source,
          target: id,
          type: "deletable",
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        },
      ]);
    }
    setSelectedId(id);
  }

  function addTransition() {
    const id = `transition-${Date.now()}`;
    const last = nodes.filter((n) => n.type === "shot").at(-1);
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "transition",
        position: {
          x: (last?.position?.x || 400) + 120,
          y: (last?.position?.y || 120) + 100,
        },
        data: { transitionType: "dissolve", label: "Переход" },
      },
    ]);
    setSelectedId(id);
  }

  function updateSelectedData(patch: Record<string, unknown>) {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    );
  }

  function updateStartData(patch: Record<string, unknown>) {
    setNodes((nds) =>
      nds.map((n) =>
        n.type === "film_start" ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    );
  }

  function toggleStartCharacter(characterId: string) {
    if (!startNode) return;
    const current = Array.isArray(startNode.data.characterIds)
      ? (startNode.data.characterIds as string[])
      : [];
    const next = current.includes(characterId)
      ? current.filter((id) => id !== characterId)
      : [...current, characterId];
    const voices = {
      ...((startNode.data.voices as Record<string, string>) || {}),
    };
    const states = {
      ...((startNode.data.characterStates as Record<
        string,
        { wardrobe: string; wardrobeNote: string }
      >) || {}),
    };
    for (const id of next) {
      if (!voices[id]) voices[id] = "soft_01";
      if (!states[id]) states[id] = { wardrobe: "clothed", wardrobeNote: "" };
    }

    setNodes((nds) =>
      nds.map((n) => {
        if (n.type === "film_start") {
          return {
            ...n,
            data: {
              ...n.data,
              characterIds: next,
              voices,
              characterStates: states,
            },
          };
        }
        if (n.type !== "shot") return n;
        const ids = Array.isArray(n.data.characterIds)
          ? (n.data.characterIds as string[])
          : [];
        if (ids.length === 0 || ids.every((id) => current.includes(id))) {
          return { ...n, data: { ...n.data, characterIds: [...next] } };
        }
        return n;
      }),
    );
  }

  function toggleShotCharacter(characterId: string) {
    if (!selected || selected.type !== "shot") return;
    const current = Array.isArray(selected.data.characterIds)
      ? (selected.data.characterIds as string[])
      : [];
    const next = current.includes(characterId)
      ? current.filter((id) => id !== characterId)
      : [...current, characterId];
    updateSelectedData({ characterIds: next });
  }

  async function saveScenario() {
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/scenarios?action=save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: scenarioId || undefined,
        title,
        graph: { nodes, edges },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error || "Не удалось сохранить");
      return null;
    }
    setScenarioId(data.scenario.id);
    setMessage("Сохранено");
    router.refresh();
    return data.scenario.id as string;
  }

  async function ensureSavedId() {
    const id = await saveScenario();
    return id || scenarioId;
  }

  async function runAction(
    action: "quote" | "preview" | "animate" | "review",
  ) {
    const id = await ensureSavedId();
    if (!id) {
      setMessage("Сначала сохраните сценарий");
      return;
    }
    setBusy(true);
    setMessage("");

    const res = await fetch(`/api/scenarios?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: id }),
    });
    const data = await res.json();
    setBusy(false);

    if (!res.ok) {
      setMessage(
        data.error ||
          (Array.isArray(data.errors) ? data.errors.join(" ") : "Ошибка"),
      );
      return;
    }

    if (action === "quote") {
      setQuote(data.credits);
      const warn =
        Array.isArray(data.warnings) && data.warnings.length
          ? ` Внимание: ${data.warnings.join(" ")}`
          : "";
      setMessage(
        `Цены: превью ${data.credits.preview} кр., оживить ${data.credits.animate} кр., проверка ${data.credits.review} кр. Баланс ${data.balance}.${warn}`,
      );
      return;
    }

    if (action === "review") {
      setReview(data.review);
      setMessage(`Проверка готова (−${data.review.creditsCharged} кр.)`);
      router.refresh();
      return;
    }

    const warn =
      Array.isArray(data.warnings) && data.warnings.length
        ? ` ${data.warnings.join(" ")}`
        : "";
    setMessage(
      action === "preview"
        ? `Превью кадров запущено.${warn}`
        : `Оживление запущено.${warn}`,
    );
    router.push(`/jobs/${data.job.id}`);
  }

  useEffect(() => {
    if (!selectedId && nodes[0]) setSelectedId(nodes[0].id);
  }, [nodes, selectedId]);

  // Запрет удаления Старта через клавиатуру — фильтруем onNodesChange
  const guardedNodesChange: typeof onNodesChange = (changes) => {
    const filtered = changes.filter((c) => {
      if (c.type === "remove") {
        const node = nodes.find((n) => n.id === c.id);
        if (node?.type === "film_start") return false;
      }
      return true;
    });
    onNodesChange(filtered);
  };

  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
        <p>
          <strong>Как пользоваться:</strong> сначала заполните{" "}
          <strong>Старт фильма</strong> (герои, место, голоса). Потом добавляйте{" "}
          <strong>Кадры</strong> и соединяйте стрелками. Кадры без стрелок —
          черновики. Наведите на стрелку — появится крестик, чтобы удалить
          связь. Сначала «Показать кадры», потом «Оживить фильм».
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Название
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveScenario()}
          disabled={busy}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={() => void runAction("quote")}
          disabled={busy}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          Цены
        </button>
        <button
          type="button"
          onClick={() => void runAction("review")}
          disabled={busy}
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
        >
          Проверить сценарий (50 кр.)
        </button>
        <button
          type="button"
          onClick={() => void runAction("preview")}
          disabled={busy}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          Показать кадры
        </button>
        <button
          type="button"
          onClick={() => void runAction("animate")}
          disabled={busy}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
        >
          Оживить фильм
        </button>
      </div>

      {quote ? (
        <p className="text-xs text-zinc-500">
          Превью {quote.preview} · Оживить {quote.animate} · Проверка{" "}
          {quote.review} кр.
        </p>
      ) : null}

      <div
        className={`rounded-lg border p-3 text-sm ${
          timeline.overLimit
            ? "border-red-300 bg-red-50 text-red-800"
            : "border-zinc-200 bg-white text-zinc-700"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Длина фильма:{" "}
            <strong>
              {timeline.seconds} / {MAX_FILM_DURATION_SEC} сек
            </strong>{" "}
            · {timeline.shotCount} кадр(ов)
          </span>
          {timeline.overLimit ? (
            <span className="text-xs font-medium">Свыше лимита 1 минуты</span>
          ) : (
            <span className="text-xs text-zinc-500">
              Осталось {Math.max(0, MAX_FILM_DURATION_SEC - timeline.seconds)} сек
            </span>
          )}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded bg-zinc-100">
          <div
            className={`h-full transition-all ${
              timeline.overLimit ? "bg-red-600" : "bg-zinc-900"
            }`}
            style={{
              width: `${Math.min(100, (timeline.seconds / MAX_FILM_DURATION_SEC) * 100)}%`,
            }}
          />
        </div>
      </div>

      {message ? <p className="text-sm text-zinc-700">{message}</p> : null}

      {review ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm">
          <h3 className="font-medium">Проверка сценария</h3>
          <p className="mt-2 text-zinc-700">{review.synopsis}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {review.beats.map((b) => (
              <li key={b.order}>
                <strong>
                  {b.order}. {b.title}
                </strong>{" "}
                — {b.text} <span className="text-zinc-500">({b.continuity})</span>
              </li>
            ))}
          </ul>
          {review.risks.length ? (
            <div className="mt-3">
              <div className="font-medium">На что обратить внимание</div>
              <ul className="mt-1 space-y-1">
                {review.risks.map((r, i) => (
                  <li key={i} className="text-zinc-700">
                    [{r.level}] {r.shotTitle}: {r.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className="mt-3 list-disc pl-5 text-zinc-600">
            {review.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[150px_1fr_300px]">
        <aside className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
          <div className="text-xs font-medium uppercase text-zinc-500">
            Добавить
          </div>
          <button
            type="button"
            onClick={addShot}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
          >
            Кадр
          </button>
          <button
            type="button"
            onClick={addTransition}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
          >
            Переход
          </button>
          <p className="text-[11px] text-zinc-400">
            Старт фильма нельзя удалить. Блоки без стрелок — черновики (в фильм
            не войдут). Наведите на стрелку — крестик удалит связь.
          </p>
        </aside>

        <div className="h-[560px] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={guardedNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={48}
            defaultEdgeOptions={{
              type: "deletable",
              animated: true,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 18,
                height: 18,
              },
            }}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <aside className="max-h-[560px] overflow-y-auto rounded-lg border border-zinc-200 p-3 text-sm">
          {!selected ? (
            <p className="text-zinc-500">Выберите блок</p>
          ) : selected.type === "film_start" ? (
            <StartPanel
              characters={characters}
              data={selected.data}
              onToggleCharacter={toggleStartCharacter}
              onPatch={updateStartData}
            />
          ) : selected.type === "transition" ? (
            <label className="flex flex-col gap-1">
              Тип перехода
              <select
                className="rounded-md border border-zinc-300 px-2 py-1.5"
                value={String(selected.data.transitionType || "cut")}
                onChange={(e) =>
                  updateSelectedData({ transitionType: e.target.value })
                }
              >
                <option value="cut">Резкий</option>
                <option value="dissolve">Плавно</option>
              </select>
            </label>
          ) : (
            <ShotPanel
              characters={characters}
              startCharacterIds={
                Array.isArray(startNode?.data?.characterIds)
                  ? (startNode!.data.characterIds as string[])
                  : []
              }
              data={selected.data}
              onToggleCharacter={toggleShotCharacter}
              onPatch={updateSelectedData}
              onCopyFromStart={() => {
                const ids = Array.isArray(startNode?.data?.characterIds)
                  ? (startNode!.data.characterIds as string[])
                  : [];
                updateSelectedData({ characterIds: [...ids] });
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function StartPanel({
  characters,
  data,
  onToggleCharacter,
  onPatch,
}: {
  characters: CharacterOption[];
  data: Record<string, unknown>;
  onToggleCharacter: (id: string) => void;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const selectedIds = Array.isArray(data.characterIds)
    ? (data.characterIds as string[])
    : [];
  const voices = (data.voices as Record<string, string>) || {};
  const states =
    (data.characterStates as Record<
      string,
      { wardrobe: string; wardrobeNote: string }
    >) || {};
  const locationRefUrl = String(data.locationRefUrl || "");
  const [uploading, setUploading] = useState(false);

  async function uploadLocation(file: File | null) {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "location");
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    const json = await res.json();
    setUploading(false);
    if (!res.ok) {
      alert(json.error || "Не удалось загрузить");
      return;
    }
    onPatch({
      locationRefUrl: json.url,
      locationRefNote: `Эталон загружен: ${json.url}`,
    });
  }

  function patchState(
    characterId: string,
    patch: Partial<{ wardrobe: string; wardrobeNote: string }>,
  ) {
    const current = states[characterId] || {
      wardrobe: "clothed",
      wardrobeNote: "",
    };
    onPatch({
      characterStates: {
        ...states,
        [characterId]: { ...current, ...patch },
      },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="font-medium">Старт фильма</div>
      <p className="text-xs text-zinc-500">
        Заполняется один раз. Кадры сами подтягивают героев, место и одежду.
      </p>

      <div>
        <div className="mb-1 text-xs font-medium uppercase text-zinc-500">
          Кто в фильме
        </div>
        {characters.length === 0 ? (
          <p className="text-xs text-amber-700">Сначала создайте персонажа</p>
        ) : (
          characters.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={selectedIds.includes(c.id)}
                onChange={() => onToggleCharacter(c.id)}
              />
              {c.name}
            </label>
          ))
        )}
      </div>

      {selectedIds.map((id) => {
        const name = characters.find((c) => c.id === id)?.name || id.slice(0, 6);
        const st = states[id] || { wardrobe: "clothed", wardrobeNote: "" };
        return (
          <div key={id} className="rounded border border-zinc-100 p-2">
            <label className="flex flex-col gap-1">
              Голос: {name}
              <select
                className="rounded-md border border-zinc-300 px-2 py-1.5"
                value={voices[id] || "soft_01"}
                onChange={(e) =>
                  onPatch({ voices: { ...voices, [id]: e.target.value } })
                }
              >
                <option value="soft_01">Мягкий</option>
                <option value="warm_02">Тёплый</option>
                <option value="low_03">Низкий</option>
                <option value="bright_04">Яркий</option>
              </select>
            </label>
            <label className="mt-2 flex flex-col gap-1">
              Одежда / вид в начале
              <select
                className="rounded-md border border-zinc-300 px-2 py-1.5"
                value={st.wardrobe || "clothed"}
                onChange={(e) =>
                  patchState(id, { wardrobe: e.target.value })
                }
              >
                {WARDROBE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {st.wardrobe === "custom" ? (
              <Field
                label="Своё описание вида"
                value={st.wardrobeNote || ""}
                onChange={(v) => patchState(id, { wardrobeNote: v })}
              />
            ) : null}
          </div>
        );
      })}

      <label className="flex flex-col gap-1">
        Язык речи
        <select
          className="rounded-md border border-zinc-300 px-2 py-1.5"
          value={String(data.language || "ru")}
          onChange={(e) => onPatch({ language: e.target.value })}
        >
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        Место (пресет)
        <select
          className="rounded-md border border-zinc-300 px-2 py-1.5"
          value={String(data.placePreset || "bedroom")}
          onChange={(e) => {
            const preset = e.target.value;
            onPatch({
              placePreset: preset,
              place: preset === "custom" ? String(data.place || "") : preset,
            });
          }}
        >
          {PLACE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <Field
        label="Описание места"
        value={String(data.place || "")}
        onChange={(v) => onPatch({ place: v })}
      />
      <Field
        label="Свет"
        value={String(data.lighting || "")}
        onChange={(v) => onPatch({ lighting: v })}
      />
      <Field
        label="Время суток"
        value={String(data.timeOfDay || "")}
        onChange={(v) => onPatch({ timeOfDay: v })}
      />

      <div>
        <div className="mb-1 text-xs font-medium uppercase text-zinc-500">
          Эталон места (фото)
        </div>
        {locationRefUrl ? (
          <div className="mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={locationRefUrl}
              alt="Эталон места"
              className="max-h-32 w-full rounded border border-zinc-200 object-cover"
            />
            <button
              type="button"
              className="mt-1 text-[11px] underline"
              onClick={() =>
                onPatch({
                  locationRefUrl: "",
                  locationRefNote:
                    "Референсы не загружены — эталон возьмём из первого кадра",
                })
              }
            >
              Убрать фото
            </button>
          </div>
        ) : (
          <p className="mb-1 text-[11px] text-zinc-400">
            Без фото эталон возьмём из первого удачного кадра.
          </p>
        )}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          onChange={(e) => void uploadLocation(e.target.files?.[0] || null)}
          className="block w-full text-xs"
        />
      </div>
    </div>
  );
}

function ShotPanel({
  characters,
  startCharacterIds,
  data,
  onToggleCharacter,
  onPatch,
  onCopyFromStart,
}: {
  characters: CharacterOption[];
  startCharacterIds: string[];
  data: Record<string, unknown>;
  onToggleCharacter: (id: string) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onCopyFromStart: () => void;
}) {
  const available = characters.filter(
    (c) => startCharacterIds.length === 0 || startCharacterIds.includes(c.id),
  );
  const continuity = String(data.continuity || "continue") as ContinuityMode;
  const shotIds = Array.isArray(data.characterIds)
    ? (data.characterIds as string[])
    : [];
  const dialogues = parseDialogues(data);
  const states =
    (data.characterStates as Record<
      string,
      { wardrobe: string; wardrobeNote: string }
    >) || {};
  const [uploading, setUploading] = useState(false);

  function setDialogues(next: DialogueLine[]) {
    const clipped = next.slice(0, 2);
    onPatch({
      dialogues: clipped,
      dialogueText: formatDialogueText(clipped) || "",
      audioEnabled: clipped.length > 0 ? true : data.audioEnabled,
    });
  }

  function patchState(
    characterId: string,
    patch: Partial<{ wardrobe: string; wardrobeNote: string }>,
  ) {
    const current = states[characterId] || {
      wardrobe: "inherit",
      wardrobeNote: "",
    };
    onPatch({
      characterStates: {
        ...states,
        [characterId]: { ...current, ...patch },
      },
    });
  }

  async function uploadLocation(file: File | null) {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "location");
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    const json = await res.json();
    setUploading(false);
    if (!res.ok) {
      alert(json.error || "Не удалось загрузить");
      return;
    }
    onPatch({ locationRefUrl: json.url });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="font-medium">Кадр</div>

      <Field
        label="Название"
        value={String(data.title || "")}
        onChange={(v) => onPatch({ title: v, label: v })}
      />

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase text-zinc-500">
            Кто в кадре
          </span>
          <button
            type="button"
            className="text-[11px] underline"
            onClick={onCopyFromStart}
          >
            Как в старте
          </button>
        </div>
        {available.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={shotIds.includes(c.id)}
              onChange={() => onToggleCharacter(c.id)}
            />
            {c.name}
          </label>
        ))}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium uppercase text-zinc-500">
          Одежда / вид в этом кадре
        </div>
        <p className="mb-1 text-[11px] text-zinc-400">
          При «Продолжить сцену» оставьте «Как было» — вид наследуется.
        </p>
        {shotIds.map((id) => {
          const name =
            characters.find((c) => c.id === id)?.name || id.slice(0, 6);
          const st = states[id] || { wardrobe: "inherit", wardrobeNote: "" };
          return (
            <div key={id} className="mb-2">
              <label className="flex flex-col gap-1">
                {name}
                <select
                  className="rounded-md border border-zinc-300 px-2 py-1.5"
                  value={st.wardrobe || "inherit"}
                  onChange={(e) =>
                    patchState(id, { wardrobe: e.target.value })
                  }
                >
                  <option value="inherit">Как было</option>
                  {WARDROBE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {st.wardrobe === "custom" ? (
                <Field
                  label="Своё описание"
                  value={st.wardrobeNote || ""}
                  onChange={(v) => patchState(id, { wardrobeNote: v })}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium uppercase text-zinc-500">
          Связь с предыдущим
        </div>
        <div className="flex flex-col gap-1">
          {(
            [
              ["continue", "Продолжить сцену"],
              ["new_angle", "Другой ракурс"],
              ["hard_cut", "Новая сцена"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="continuity"
                checked={continuity === value}
                onChange={() => onPatch({ continuity: value })}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        Что происходит
        <select
          className="rounded-md border border-zinc-300 px-2 py-1.5"
          value={String(data.actionType || "idle")}
          onChange={(e) => onPatch({ actionType: e.target.value })}
        >
          <option value="dialogue">Диалог</option>
          <option value="intimate">Эротика</option>
          <option value="action">Действие</option>
          <option value="idle">Спокойно</option>
        </select>
      </label>

      <Field
        label="Описание"
        value={String(data.actionPrompt || "")}
        onChange={(v) => onPatch({ actionPrompt: v })}
      />

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium uppercase text-zinc-500">
            Реплики (до 2)
          </span>
          <button
            type="button"
            className="text-[11px] underline disabled:opacity-40"
            disabled={dialogues.length >= 2 || shotIds.length === 0}
            onClick={() =>
              setDialogues([
                ...dialogues,
                { characterId: shotIds[0], text: "" },
              ])
            }
          >
            + реплика
          </button>
        </div>
        {dialogues.length === 0 ? (
          <p className="text-[11px] text-zinc-400">Без речи в этом кадре</p>
        ) : (
          dialogues.map((line, idx) => (
            <div
              key={idx}
              className="mb-2 rounded border border-zinc-100 p-2"
            >
              <label className="flex flex-col gap-1">
                Кто говорит
                <select
                  className="rounded-md border border-zinc-300 px-2 py-1.5"
                  value={line.characterId}
                  onChange={(e) => {
                    const next = [...dialogues];
                    next[idx] = { ...line, characterId: e.target.value };
                    setDialogues(next);
                  }}
                >
                  {available
                    .filter((c) => shotIds.includes(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="mt-1 flex flex-col gap-1">
                Текст
                <input
                  className="rounded-md border border-zinc-300 px-2 py-1.5"
                  value={line.text}
                  onChange={(e) => {
                    const next = [...dialogues];
                    next[idx] = { ...line, text: e.target.value };
                    setDialogues(next);
                  }}
                />
              </label>
              <button
                type="button"
                className="mt-1 text-[11px] text-red-600 underline"
                onClick={() =>
                  setDialogues(dialogues.filter((_, i) => i !== idx))
                }
              >
                Убрать
              </button>
            </div>
          ))
        )}
      </div>

      <label className="flex flex-col gap-1">
        Камера
        <select
          className="rounded-md border border-zinc-300 px-2 py-1.5"
          value={String(data.camera || "medium")}
          onChange={(e) => onPatch({ camera: e.target.value })}
        >
          <option value="closeup">Ближе (крупный)</option>
          <option value="medium">Средний</option>
          <option value="wide">Дальше (общий)</option>
          <option value="pan">Панорама</option>
          <option value="zoom">Зум</option>
          <option value="static">Статика</option>
        </select>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(data.audioEnabled) || dialogues.length > 0}
          onChange={(e) => onPatch({ audioEnabled: e.target.checked })}
        />
        Звук / речь в этом кадре
      </label>

      <Field
        label="Длина, сек"
        value={String(data.durationSec || 5)}
        onChange={(v) => onPatch({ durationSec: Number(v) || 5 })}
      />

      {continuity === "hard_cut" ? (
        <>
          <Field
            label="Место (если новая сцена)"
            value={String(data.place || "")}
            onChange={(v) => onPatch({ place: v })}
          />
          <Field
            label="Время суток"
            value={String(data.timeOfDay || "")}
            onChange={(v) => onPatch({ timeOfDay: v })}
          />
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-zinc-500">
              Эталон нового места
            </div>
            {String(data.locationRefUrl || "") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(data.locationRefUrl)}
                alt="Эталон"
                className="mb-1 max-h-28 w-full rounded border object-cover"
              />
            ) : null}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(e) =>
                void uploadLocation(e.target.files?.[0] || null)
              }
              className="block w-full text-xs"
            />
          </div>
        </>
      ) : (
        <p className="text-[11px] text-zinc-400">
          Место берётся из Старта / предыдущего кадра автоматически.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        className="rounded-md border border-zinc-300 px-2 py-1.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
