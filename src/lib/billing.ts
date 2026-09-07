export type ActionType = "dialogue" | "intimate" | "action" | "idle";
export type CameraType =
  | "closeup"
  | "medium"
  | "wide"
  | "pan"
  | "zoom"
  | "static";

/** continue = продолжить сцену, new_angle = другой ракурс, hard_cut = новая сцена */
export type ContinuityMode = "continue" | "new_angle" | "hard_cut";

export type NodeKind = "film_start" | "shot" | "transition";

export const PRICING = {
  basePerSec: 16,
  cameraComplex: 20,
  audio: 50,
  transition: 5,
  extraCharacter: 25,
  intimateMult: 1.2,
  trainCharacter: 500,
  startingCredits: 1000,
  /** Доля цены за только превью-картинки */
  previewFactor: 0.5,
  scenarioReview: 50,
  /** Перегенерация одного кадра превью */
  regenShotMin: 10,
} as const;

/** Лимит мини-фильма для UI и мягкой блокировки рендера */
export const MAX_FILM_DURATION_SEC = 60;

export const CONTINUITY_LABELS: Record<ContinuityMode, string> = {
  continue: "Продолжить сцену",
  new_angle: "Другой ракурс",
  hard_cut: "Новая сцена",
};

export type DialogueLine = {
  characterId: string;
  text: string;
};

export type CharacterState = {
  wardrobe: string;
  wardrobeNote: string;
};

export const WARDROBE_PRESETS = [
  { id: "clothed", label: "В одежде" },
  { id: "casual", label: "Повседневная одежда" },
  { id: "lingerie", label: "Бельё" },
  { id: "shirt_open", label: "Рубашка расстёгнута" },
  { id: "topless", label: "Без верха" },
  { id: "nude", label: "Без одежды" },
  { id: "towel", label: "В полотенце" },
  { id: "wet", label: "Мокрые волосы / кожа" },
  { id: "custom", label: "Своё описание" },
] as const;

export function wardrobeLabel(id: string) {
  return WARDROBE_PRESETS.find((p) => p.id === id)?.label || id || "В одежде";
}

export function parseDialogues(data: Record<string, unknown>): DialogueLine[] {
  const raw = data.dialogues;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const characterId = asString(row.characterId);
        const text = asString(row.text).trim();
        if (!characterId || !text) return null;
        return { characterId, text };
      })
      .filter((x): x is DialogueLine => Boolean(x))
      .slice(0, 2);
  }

  const legacy = asString(data.dialogueText).trim();
  if (!legacy) return [];
  const ids = asStringArray(data.characterIds);
  return [{ characterId: ids[0] || "", text: legacy }].filter(
    (d) => d.characterId && d.text,
  );
}

export function formatDialogueText(
  dialogues: DialogueLine[],
  names?: Record<string, string>,
) {
  if (!dialogues.length) return undefined;
  return dialogues
    .map((d) => {
      const name = names?.[d.characterId] || d.characterId.slice(0, 6);
      return `${name}: ${d.text}`;
    })
    .join(" · ");
}

function parseCharacterStates(
  data: Record<string, unknown>,
): Record<string, CharacterState> {
  const raw = data.characterStates;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CharacterState> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    out[id] = {
      wardrobe: asString(row.wardrobe, "clothed") || "clothed",
      wardrobeNote: asString(row.wardrobeNote),
    };
  }
  return out;
}

function mergeStates(
  ids: string[],
  prev: Record<string, CharacterState>,
  own: Record<string, CharacterState>,
  inherit: boolean,
): Record<string, CharacterState> {
  const out: Record<string, CharacterState> = {};
  for (const id of ids) {
    if (!inherit && own[id]) {
      out[id] = { ...own[id] };
    } else if (own[id]?.wardrobe && own[id].wardrobe !== "inherit") {
      out[id] = { ...own[id] };
    } else if (prev[id]) {
      out[id] = { ...prev[id] };
    } else {
      out[id] = { wardrobe: "clothed", wardrobeNote: "" };
    }
  }
  return out;
}

export function cameraFee(camera?: string) {
  if (!camera) return 0;
  return camera === "pan" || camera === "zoom" ? PRICING.cameraComplex : 0;
}

export function actionMult(actionType?: string) {
  return actionType === "intimate" ? PRICING.intimateMult : 1;
}

export function priceShot(input: {
  durationSec: number;
  camera?: string;
  hasAudio?: boolean;
  actionType?: string;
  characterCount?: number;
  isTransitionOnly?: boolean;
  phase?: "preview" | "animate" | "full";
}) {
  if (input.isTransitionOnly) return PRICING.transition;

  const base = PRICING.basePerSec * Math.max(1, input.durationSec);
  const extraPeople = Math.max(0, (input.characterCount || 1) - 1);
  const extras =
    cameraFee(input.camera) +
    (input.hasAudio ? PRICING.audio : 0) +
    extraPeople * PRICING.extraCharacter;
  let total = Math.round((base + extras) * actionMult(input.actionType));

  if (input.phase === "preview") {
    total = Math.max(10, Math.round(total * PRICING.previewFactor));
  }
  return total;
}

export type FilmStartData = {
  characterIds: string[];
  voices: Record<string, string>;
  language: "ru" | "en";
  place: string;
  placePreset: string;
  lighting: string;
  timeOfDay: string;
  style: string;
  locationRefNote: string;
  locationRefUrl: string;
  characterStates: Record<string, CharacterState>;
};

export type PlannedShot = {
  orderIndex: number;
  nodeId?: string;
  actionType: ActionType;
  actionPrompt?: string;
  dialogueText?: string;
  dialogues: DialogueLine[];
  speakerId?: string;
  camera: CameraType;
  location: Record<string, string>;
  hasAudio: boolean;
  audio?: { ttsVoiceId?: string; ambience?: string; language?: string };
  durationSec: number;
  billingCredits: number;
  workflow: "still_only" | "still_i2v" | "still_i2v_audio" | "transition_only";
  continuity: ContinuityMode;
  characterId?: string;
  characterIds: string[];
  characterStates: Record<string, CharacterState>;
  title?: string;
  inheritLocationFromPrevious: boolean;
  useLocationMasterFromFirstFrame: boolean;
};

type GraphNode = {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
  position?: { x: number; y: number };
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type ScenarioGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  if (typeof value === "string" && value) return [value];
  return [];
}

export function getFilmStart(graph: ScenarioGraph): FilmStartData | null {
  const node = (graph.nodes || []).find((n) => n.type === "film_start");
  if (!node) return null;
  const data = node.data || {};
  const voicesRaw = data.voices;
  const voices =
    voicesRaw && typeof voicesRaw === "object" && !Array.isArray(voicesRaw)
      ? (voicesRaw as Record<string, string>)
      : {};

  const characterIds = asStringArray(data.characterIds);
  const characterStates = parseCharacterStates(data);
  for (const id of characterIds) {
    if (!characterStates[id]) {
      characterStates[id] = { wardrobe: "clothed", wardrobeNote: "" };
    }
  }

  return {
    characterIds,
    voices,
    language: asString(data.language, "ru") === "en" ? "en" : "ru",
    place: asString(data.place, "bedroom"),
    placePreset: asString(data.placePreset, "bedroom"),
    lighting: asString(data.lighting, "warm lamp"),
    timeOfDay: asString(data.timeOfDay, "evening"),
    style: asString(data.style, "photoreal"),
    locationRefNote: asString(
      data.locationRefNote,
      "Референсы не загружены — эталон возьмём из первого кадра",
    ),
    locationRefUrl: asString(data.locationRefUrl),
    characterStates,
  };
}

function orderShotNodes(graph: ScenarioGraph): GraphNode[] {
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const shots = nodes.filter((n) => n.type === "shot");
  const start = nodes.find((n) => n.type === "film_start");

  // Только кадры, связанные цепочкой от Старта (остальные — черновики на холсте)
  const reachable = new Set<string>();
  if (start) {
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges) {
        if (e.source !== id) continue;
        if (reachable.has(e.target)) continue;
        const target = nodes.find((n) => n.id === e.target);
        if (!target) continue;
        if (target.type === "shot" || target.type === "transition") {
          reachable.add(e.target);
          queue.push(e.target);
        }
      }
    }
  }

  const linkedShots = shots.filter((s) => reachable.has(s.id));
  if (linkedShots.length <= 1) return linkedShots;

  const shotIds = new Set(linkedShots.map((s) => s.id));
  const incoming = new Map<string, number>();
  const next = new Map<string, string[]>();

  for (const id of shotIds) {
    incoming.set(id, 0);
    next.set(id, []);
  }

  for (const e of edges) {
    if (!shotIds.has(e.source) || !shotIds.has(e.target)) continue;
    next.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
  }

  const queue = [...linkedShots.filter((s) => (incoming.get(s.id) || 0) === 0)];
  const ordered: GraphNode[] = [];
  const seen = new Set<string>();

  while (queue.length) {
    const node = queue.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
    for (const t of next.get(node.id) || []) {
      const left = (incoming.get(t) || 0) - 1;
      incoming.set(t, left);
      if (left <= 0) {
        const n = linkedShots.find((s) => s.id === t);
        if (n) queue.push(n);
      }
    }
  }

  for (const s of linkedShots) {
    if (!seen.has(s.id)) ordered.push(s);
  }

  return ordered;
}

export function planShotsFromGraph(
  graph: ScenarioGraph,
  options?: {
    fallbackCharacterId?: string;
    phase?: "preview" | "animate" | "full";
    characterNames?: Record<string, string>;
  },
): { shots: PlannedShot[]; errors: string[]; warnings: string[]; start: FilmStartData | null } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const phase = options?.phase || "full";
  const start = getFilmStart(graph);

  if (!start) {
    errors.push("Добавьте блок «Старт фильма» (он должен быть первым).");
  } else if (start.characterIds.length === 0 && !options?.fallbackCharacterId) {
    errors.push("В «Старте фильма» выберите хотя бы одного персонажа.");
  }

  const shotNodes = orderShotNodes(graph);
  const allShots = (graph.nodes || []).filter((n) => n.type === "shot");
  if (shotNodes.length === 0) {
    if (allShots.length > 0) {
      errors.push(
        "Соедините кадры со «Стартом фильма» стрелками. Кадры без связи — черновики и в фильм не входят.",
      );
    } else {
      errors.push("Добавьте хотя бы один блок «Кадр».");
    }
  }

  let prevCharacterIds = start?.characterIds?.length
    ? [...start.characterIds]
    : options?.fallbackCharacterId
      ? [options.fallbackCharacterId]
      : [];
  let prevLocation = {
    place: start?.place || "studio",
    lighting: start?.lighting || "soft light",
    time_of_day: start?.timeOfDay || "day",
    style: start?.style || "photoreal",
    placePreset: start?.placePreset || "",
    locationRefUrl: start?.locationRefUrl || "",
  };
  let prevStates: Record<string, CharacterState> = {
    ...(start?.characterStates || {}),
  };

  const names = options?.characterNames || {};

  const shots: PlannedShot[] = shotNodes.map((node, index) => {
    const data = node.data || {};
    let continuity = asString(data.continuity, "continue") as ContinuityMode;
    if (!["continue", "new_angle", "hard_cut"].includes(continuity)) {
      continuity = "continue";
    }
    if (index === 0) continuity = "hard_cut";

    let characterIds = asStringArray(data.characterIds);
    if (characterIds.length === 0) characterIds = [...prevCharacterIds];

    const inheritLocation =
      continuity === "continue" || continuity === "new_angle" || !asString(data.place);

    const location = inheritLocation
      ? { ...prevLocation }
      : {
          place: asString(data.place, prevLocation.place),
          lighting: asString(data.lighting, prevLocation.lighting),
          time_of_day: asString(data.timeOfDay, prevLocation.time_of_day),
          style: asString(data.style, prevLocation.style),
          placePreset: asString(data.placePreset, prevLocation.placePreset),
          locationRefUrl: asString(
            data.locationRefUrl,
            prevLocation.locationRefUrl,
          ),
        };

    const inheritStates =
      continuity === "continue" || continuity === "new_angle";
    const ownStates = parseCharacterStates(data);
    const characterStates = mergeStates(
      characterIds,
      prevStates,
      ownStates,
      inheritStates,
    );

    if (continuity === "hard_cut" && index > 0) {
      const placeChanged =
        asString(data.place, prevLocation.place) !== prevLocation.place ||
        asString(data.timeOfDay, prevLocation.time_of_day) !==
          prevLocation.time_of_day;
      if (placeChanged) {
        warnings.push(
          `Кадр «${asString(data.title, String(index + 1))}»: новая сцена — стык места/времени будет заметнее.`,
        );
      }
    }

    const dialogues = parseDialogues({ ...data, characterIds });
    const speakerId = dialogues[0]?.characterId || characterIds[0];
    const dialogueText =
      formatDialogueText(dialogues, names) ||
      asString(data.dialogueText) ||
      undefined;

    const actionType = (asString(data.actionType, "idle") ||
      "idle") as ActionType;
    const camera = (asString(data.camera, index === 0 ? "medium" : "medium") ||
      "medium") as CameraType;
    const hasAudio =
      Boolean(data.audioEnabled) ||
      actionType === "dialogue" ||
      dialogues.length > 0;
    const durationSec = Number(data.durationSec) || 5;

    const voiceId =
      (speakerId && start?.voices?.[speakerId]) ||
      (characterIds[0] && start?.voices?.[characterIds[0]]) ||
      asString(data.voiceId, "soft_01");

    const billingCredits = priceShot({
      durationSec,
      camera,
      hasAudio: phase === "preview" ? false : hasAudio,
      actionType,
      characterCount: Math.max(characterIds.length, 1),
      phase,
    });

    let workflow: PlannedShot["workflow"] = "still_i2v";
    if (phase === "preview") workflow = "still_only";
    else if (hasAudio) workflow = "still_i2v_audio";

    const planned: PlannedShot = {
      orderIndex: index,
      nodeId: node.id,
      title: asString(data.title, `Кадр ${index + 1}`),
      actionType,
      actionPrompt: asString(data.actionPrompt) || undefined,
      dialogueText,
      dialogues,
      speakerId,
      camera,
      location,
      hasAudio: phase === "preview" ? false : hasAudio,
      audio:
        phase !== "preview" && hasAudio
          ? {
              ttsVoiceId: voiceId,
              ambience: asString(data.ambience, "quiet_room"),
              language: start?.language || "ru",
            }
          : undefined,
      durationSec,
      billingCredits,
      workflow,
      continuity,
      characterId: characterIds[0],
      characterIds,
      characterStates,
      inheritLocationFromPrevious: inheritLocation && index > 0,
      useLocationMasterFromFirstFrame: !location.locationRefUrl,
    };

    prevCharacterIds = characterIds;
    prevLocation = location;
    prevStates = characterStates;
    return planned;
  });

  for (const s of shots) {
    if (!s.characterIds.length) {
      errors.push(`В кадре «${s.title}» не выбран персонаж.`);
    }
  }

  const transitions = (graph.nodes || []).filter((n) => n.type === "transition");
  if (phase !== "preview") {
    for (const t of transitions) {
      shots.push({
        orderIndex: shots.length,
        nodeId: t.id,
        actionType: "idle",
        camera: "static",
        location: prevLocation,
        hasAudio: false,
        durationSec: 1,
        billingCredits: priceShot({ durationSec: 1, isTransitionOnly: true }),
        workflow: "transition_only",
        continuity: "hard_cut",
        characterIds: [],
        characterStates: {},
        dialogues: [],
        title: "Переход",
        actionPrompt: asString(t.data?.transitionType, "cut"),
        inheritLocationFromPrevious: false,
        useLocationMasterFromFirstFrame: false,
      });
    }
  }

  const filmShots = shots.filter((s) => s.workflow !== "transition_only");
  const totalSec = filmShots.reduce((sum, s) => sum + s.durationSec, 0);
  if (totalSec > MAX_FILM_DURATION_SEC) {
    errors.push(
      `Фильм ${totalSec} сек — лимит мини-фильма ${MAX_FILM_DURATION_SEC} сек. Укоротите кадры.`,
    );
  } else if (totalSec > MAX_FILM_DURATION_SEC - 10 && filmShots.length) {
    warnings.push(
      `Длина ${totalSec} / ${MAX_FILM_DURATION_SEC} сек — близко к лимиту минуты.`,
    );
  }

  return {
    shots,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    start,
  };
}

export function totalCredits(shots: PlannedShot[]) {
  return shots.reduce((sum, s) => sum + s.billingCredits, 0);
}

export function sumFilmDurationSec(shots: PlannedShot[]) {
  return shots
    .filter((s) => s.workflow !== "transition_only")
    .reduce((sum, s) => sum + s.durationSec, 0);
}

/** Оценка длительности по графу (для UI без полного плана). */
export function estimateTimeline(graph: ScenarioGraph) {
  const planned = planShotsFromGraph(graph, { phase: "full" });
  const seconds = sumFilmDurationSec(planned.shots);
  return {
    seconds,
    max: MAX_FILM_DURATION_SEC,
    overLimit: seconds > MAX_FILM_DURATION_SEC,
    shotCount: planned.shots.filter((s) => s.workflow !== "transition_only")
      .length,
    errors: planned.errors,
    warnings: planned.warnings,
  };
}

/** Дефолтный граф для нового сценария: Старт + один Кадр. */
export function createDefaultGraph(characterIds: string[] = []) {
  const startId = "film-start";
  const shotId = "shot-1";
  const voices: Record<string, string> = {};
  for (const id of characterIds) voices[id] = "soft_01";

  return {
    nodes: [
      {
        id: startId,
        type: "film_start",
        position: { x: 40, y: 120 },
        data: {
          label: "Старт фильма",
          characterIds,
          voices,
          language: "ru",
          place: "bedroom",
          placePreset: "bedroom",
          lighting: "warm lamp",
          timeOfDay: "evening",
          style: "photoreal",
          locationRefNote:
            "Если не загрузите фото места — эталон возьмём из первого кадра",
          locationRefUrl: "",
          characterStates: Object.fromEntries(
            characterIds.map((id) => [
              id,
              { wardrobe: "clothed", wardrobeNote: "" },
            ]),
          ),
        },
        deletable: false,
      },
      {
        id: shotId,
        type: "shot",
        position: { x: 320, y: 120 },
        data: {
          label: "Кадр",
          title: "Кадр 1",
          characterIds: [...characterIds],
          continuity: "hard_cut",
          actionType: "dialogue",
          actionPrompt: "говорят спокойно",
          dialogueText: "Ты сегодня поздно…",
          dialogues: characterIds[0]
            ? [{ characterId: characterIds[0], text: "Ты сегодня поздно…" }]
            : [],
          camera: "medium",
          audioEnabled: true,
          durationSec: 5,
          place: "",
          lighting: "",
          timeOfDay: "",
          characterStates: {},
        },
      },
    ],
    edges: [
      {
        id: "e-start-1",
        source: startId,
        target: shotId,
        type: "deletable",
        animated: true,
      },
    ],
  };
}
