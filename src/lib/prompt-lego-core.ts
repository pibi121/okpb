/**
 * Pure LEGO prompt helpers (safe for client + server).
 * Catalog is injected — load JSON on the server and pass as props.
 */
import type { TemplatePose } from "@/lib/prompt-templates";

export type LegoKind =
  | "pose"
  | "lighting"
  | "event"
  | "stylization"
  | "body"
  | "character"
  | "voiceover"
  | "location"
  | "action"
  | "voice"
  | "camera";

export type LegoCatalogItem = {
  id: string;
  label: string;
  kind: LegoKind;
  aliases?: string[];
  text?: string;
  /** Full MiniMax body for video bricks (actions/voice/camera). */
  body?: string;
  section?: string;
  sectionLabel?: string;
  bindsTo?: "previous_character";
  skinDetail?: boolean;
  skinDetailStrength?: number;
  videoMotion?: string;
  picture4Penis?: boolean;
  /** Hidden from plus-menu when false (e.g. Analog Madness until the file is on GPU). */
  enabled?: boolean;
  /** Custom user text (voiceover script, location description). */
  customText?: string;
  /** For location-from-reference: 1-based picture slot index. */
  locationRefSlot?: number;
};

export type LegoToken =
  | {
      type: "tab";
      kind: LegoKind;
      id: string;
      label: string;
      customText?: string;
      locationRefSlot?: number;
    }
  | { type: "text"; value: string };

export type LegoCharacterRef = {
  id: string;
  name: string;
  gender: string;
  triggerWord?: string | null;
};

export type CompiledLegoKrea = {
  scene: string;
  poseId?: string;
  lightingId?: string;
  stylizationIds: string[];
  eventIds: string[];
  bodyIds: string[];
  /** All non-character tab ids for concept-LoRA matching */
  tabIds: string[];
  characterIdsInOrder: string[];
  receiverName?: string;
  activeName?: string;
  freeText: string;
  skinDetail?: boolean;
  skinDetailStrength?: number;
  styleId?: string;
};

export const LEGO_PLUS_MENU: {
  kind: Exclude<LegoKind, "character" | "voiceover" | "location">;
  label: string;
}[] = [
  { kind: "pose", label: "Выбор позы" },
  { kind: "lighting", label: "Выбор освещения" },
  { kind: "event", label: "Выбор события" },
  { kind: "body", label: "Размер тела" },
  { kind: "stylization", label: "Выбор стилизации" },
];

/** Video brick tabs — replace photo lego on quick video. */
export const LEGO_VIDEO_PLUS_MENU: {
  kind: Extract<LegoKind, "pose" | "action" | "voice" | "camera">;
  label: string;
}[] = [
  { kind: "pose", label: "Поза" },
  { kind: "action", label: "Действие" },
  { kind: "voice", label: "Озвучка" },
  { kind: "camera", label: "Камера" },
];

/** Kinds that use section → items sub-menu in video picker. */
export const LEGO_VIDEO_SECTIONED_KINDS: LegoKind[] = [
  "pose",
  "action",
  "voice",
  "camera",
];

/** Video-only custom tab (popup). */
export const LEGO_VIDEO_EXTRAS: {
  kind: "location";
  label: string;
}[] = [{ kind: "location", label: "Локация" }];

export function buildLegoCatalog(opts: {
  poses: TemplatePose[];
  lighting: Array<Omit<LegoCatalogItem, "kind">>;
  events: Array<Omit<LegoCatalogItem, "kind">>;
  stylization: Array<Omit<LegoCatalogItem, "kind">>;
  body?: Array<Omit<LegoCatalogItem, "kind">>;
  characters?: LegoCharacterRef[];
}): LegoCatalogItem[] {
  const poses: LegoCatalogItem[] = opts.poses.map((p) => ({
    id: p.id,
    label: p.label,
    kind: "pose",
    aliases: [p.label, p.id.replace(/_/g, " ")],
    text: p.text,
    videoMotion: p.videoMotion,
  }));
  const lighting = opts.lighting.map((x) => ({ ...x, kind: "lighting" as const }));
  const events = opts.events.map((x) => ({ ...x, kind: "event" as const }));
  const body = (opts.body || []).map((x) => ({ ...x, kind: "body" as const }));
  const stylization = opts.stylization.map((x) => ({
    ...x,
    kind: "stylization" as const,
  }));
  const chars = (opts.characters || []).map((c) => ({
    id: c.id,
    label: c.name,
    kind: "character" as const,
    aliases: [c.name, c.triggerWord || ""].filter(Boolean) as string[],
  }));
  return [...chars, ...poses, ...lighting, ...events, ...body, ...stylization];
}

export type VideoLegoStaticItem = Omit<LegoCatalogItem, "kind"> & {
  section: string;
  sectionLabel: string;
};

export type VideoLegoFile = {
  poses: VideoLegoStaticItem[];
  actions: VideoLegoStaticItem[];
  voices: VideoLegoStaticItem[];
  cameras: VideoLegoStaticItem[];
};

export function buildVideoLegoCatalog(opts: {
  videoLego: VideoLegoFile;
  characters?: LegoCharacterRef[];
}): LegoCatalogItem[] {
  const poses = (opts.videoLego.poses || []).map((x) => ({
    ...x,
    kind: "pose" as const,
  }));
  const actions = opts.videoLego.actions.map((x) => ({
    ...x,
    kind: "action" as const,
  }));
  const voices = opts.videoLego.voices.map((x) => ({
    ...x,
    kind: "voice" as const,
  }));
  const cameras = opts.videoLego.cameras.map((x) => ({
    ...x,
    kind: "camera" as const,
  }));
  const chars = (opts.characters || []).map((c) => ({
    id: c.id,
    label: c.name,
    kind: "character" as const,
    aliases: [c.name, c.triggerWord || ""].filter(Boolean) as string[],
  }));
  return [...chars, ...poses, ...actions, ...voices, ...cameras];
}

export function groupCatalogBySection(
  items: LegoCatalogItem[],
  kind: LegoKind,
): Array<{ section: string; label: string; items: LegoCatalogItem[] }> {
  const filtered = items.filter((i) => i.kind === kind);
  const order: string[] = [];
  const map = new Map<string, LegoCatalogItem[]>();
  for (const item of filtered) {
    const key = item.section || "other";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item);
  }
  return order.map((section) => ({
    section,
    label: filtered.find((i) => i.section === section)?.sectionLabel || section,
    items: map.get(section)!,
  }));
}

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveLegoLabel(
  raw: string,
  catalog: LegoCatalogItem[],
): LegoCatalogItem | null {
  const n = norm(raw);
  if (!n) return null;
  const exact = catalog.find(
    (x) =>
      norm(x.label) === n ||
      norm(x.id) === n ||
      (x.aliases || []).some((a) => norm(a) === n),
  );
  if (exact) return exact;
  if (n.length < 3) return null;
  return (
    catalog.find((x) => {
      const keys = [x.label, x.id, ...(x.aliases || [])].map(norm);
      return keys.some(
        (k) => k === n || (k.length >= 3 && (k.includes(n) || n.includes(k))),
      );
    }) || null
  );
}

export function parseLegoQuery(
  query: string,
  catalog: LegoCatalogItem[],
): LegoToken[] {
  const tokens: LegoToken[] = [];
  const re = /\[([^\]]+)\]|([^\[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    if (m[1] != null) {
      const inner = m[1];
      if (inner.startsWith("voiceover:")) {
        const text = inner.slice("voiceover:".length);
        tokens.push({
          type: "tab",
          kind: "voiceover",
          id: `voiceover_${text.length}`,
          label: text.length > 36 ? `${text.slice(0, 35)}…` : text,
          customText: text,
        });
        continue;
      }
      if (inner.startsWith("location-ref:")) {
        const slot = Number(inner.slice("location-ref:".length));
        tokens.push({
          type: "tab",
          kind: "location",
          id: `location_ref_${slot}`,
          label: `Location ref · Picture ${slot}`,
          locationRefSlot: slot,
        });
        continue;
      }
      if (inner.startsWith("location:")) {
        const text = inner.slice("location:".length);
        tokens.push({
          type: "tab",
          kind: "location",
          id: `location_${text.length}`,
          label: text.length > 36 ? `${text.slice(0, 35)}…` : text,
          customText: text,
        });
        continue;
      }
      const item = resolveLegoLabel(inner, catalog);
      if (item) {
        tokens.push({
          type: "tab",
          kind: item.kind,
          id: item.id,
          label: item.label,
        });
      } else {
        tokens.push({ type: "text", value: `[${m[1]}]` });
      }
    } else if (m[2] != null) {
      tokens.push({ type: "text", value: m[2] });
    }
  }
  return tokens;
}

export type LegoQuerySpan = {
  token: LegoToken;
  start: number;
  end: number;
};

/** Parse query with source offsets — for inline edit/replace in the textarea. */
export function parseLegoQuerySpans(
  query: string,
  catalog: LegoCatalogItem[],
): LegoQuerySpan[] {
  const spans: LegoQuerySpan[] = [];
  const re = /\[([^\]]+)\]|([^\[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[1] != null) {
      const inner = m[1];
      if (inner.startsWith("voiceover:")) {
        const text = inner.slice("voiceover:".length);
        spans.push({
          start,
          end,
          token: {
            type: "tab",
            kind: "voiceover",
            id: `voiceover_${text.length}`,
            label: text.length > 36 ? `${text.slice(0, 35)}…` : text,
            customText: text,
          },
        });
        continue;
      }
      if (inner.startsWith("location-ref:")) {
        const slot = Number(inner.slice("location-ref:".length));
        spans.push({
          start,
          end,
          token: {
            type: "tab",
            kind: "location",
            id: `location_ref_${slot}`,
            label: `Location ref · Picture ${slot}`,
            locationRefSlot: slot,
          },
        });
        continue;
      }
      if (inner.startsWith("location:")) {
        const text = inner.slice("location:".length);
        spans.push({
          start,
          end,
          token: {
            type: "tab",
            kind: "location",
            id: `location_${text.length}`,
            label: text.length > 36 ? `${text.slice(0, 35)}…` : text,
            customText: text,
          },
        });
        continue;
      }
      const item = resolveLegoLabel(inner, catalog);
      if (item) {
        spans.push({
          start,
          end,
          token: {
            type: "tab",
            kind: item.kind,
            id: item.id,
            label: item.label,
          },
        });
      } else {
        spans.push({
          start,
          end,
          token: { type: "text", value: `[${m[1]}]` },
        });
      }
    } else if (m[2] != null) {
      spans.push({
        start,
        end,
        token: { type: "text", value: m[2] },
      });
    }
  }
  return spans;
}

export function replaceLegoQuerySpan(
  query: string,
  span: Pick<LegoQuerySpan, "start" | "end">,
  replacement: string,
): string {
  return query.slice(0, span.start) + replacement + query.slice(span.end);
}

export function formatLegoTab(label: string) {
  return `[${label}]`;
}

export function tokensToQuery(tokens: LegoToken[]): string {
  return tokens
    .map((t) => {
      if (t.type !== "tab") return t.value;
      if (t.kind === "voiceover") {
        const text = t.customText?.trim() || t.label;
        return formatLegoTab(`voiceover:${text}`);
      }
      if (t.kind === "location" && t.locationRefSlot != null) {
        return formatLegoTab(`location-ref:${t.locationRefSlot}`);
      }
      if (t.kind === "location") {
        const text = t.customText?.trim() || t.label;
        return formatLegoTab(`location:${text}`);
      }
      return formatLegoTab(t.label);
    })
    .join("")
    .trim();
}

export function kindBlockClass(kind: LegoKind): string {
  switch (kind) {
    case "character":
      return "bg-rose-500/15 border-rose-400/30 text-rose-100";
    case "pose":
      return "bg-violet-500/15 border-violet-400/30 text-violet-100";
    case "lighting":
      return "bg-amber-500/15 border-amber-400/30 text-amber-100";
    case "event":
      return "bg-fuchsia-500/15 border-fuchsia-400/30 text-fuchsia-100";
    case "stylization":
      return "bg-sky-500/15 border-sky-400/30 text-sky-100";
    case "body":
      return "bg-emerald-500/15 border-emerald-400/30 text-emerald-100";
    case "voiceover":
      return "bg-orange-500/15 border-orange-400/30 text-orange-100";
    case "location":
      return "bg-cyan-500/15 border-cyan-400/30 text-cyan-100";
    case "action":
      return "bg-lime-500/15 border-lime-400/30 text-lime-100";
    case "voice":
      return "bg-orange-500/15 border-orange-400/30 text-orange-100";
    case "camera":
      return "bg-indigo-500/15 border-indigo-400/30 text-indigo-100";
    default:
      return "bg-white/10 border-white/20 text-foreground";
  }
}

export function kindLabelRu(kind: LegoKind): string {
  if (kind === "character") return "Персонаж";
  if (kind === "voiceover") return "Voiceover";
  if (kind === "location") return "Локация";
  if (kind === "action") return "Действие";
  if (kind === "voice") return "Озвучка";
  if (kind === "camera") return "Камера";
  const m = LEGO_PLUS_MENU.find((x) => x.kind === kind);
  if (m) return m.label;
  return kind;
}


export function suggestLegoTabs(
  query: string,
  cursor: number,
  catalog: LegoCatalogItem[],
  limit = 8,
): LegoCatalogItem[] {
  const before = query.slice(0, cursor);
  const open = before.lastIndexOf("[");
  const close = before.lastIndexOf("]");
  let needle = "";
  if (open > close) needle = before.slice(open + 1);
  else {
    const m = before.match(/([^\s\[\]]+)$/);
    needle = m?.[1] || "";
  }
  const n = norm(needle);
  if (n.length < 2) return [];
  const scored = catalog
    .map((item) => {
      const keys = [item.label, item.id, ...(item.aliases || [])].map(norm);
      let score = 0;
      for (const k of keys) {
        if (k === n) score = Math.max(score, 100);
        else if (k.startsWith(n)) score = Math.max(score, 80);
        else if (k.includes(n)) score = Math.max(score, 50);
        else if (n.includes(k) && k.length >= 3) score = Math.max(score, 40);
      }
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));

  const seen = new Set<string>();
  const out: LegoCatalogItem[] = [];
  for (const { item } of scored) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Strip furniture words from pose preset — same idea as location-mode.poseGeometryOnly */
export function legoPoseGeometry(text: string): string {
  return text
    .replace(/\b(bed|bedroom|mattress|pillows?|sheets?|floor|carpet)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
}

/**
 * Role rule (duo): first character before pose = receiver; last = active.
 * Events bind to the character tab immediately before them.
 */
export function analyzeLegoTokens(
  tokens: LegoToken[],
  characters: LegoCharacterRef[],
  catalog: LegoCatalogItem[],
): CompiledLegoKrea {
  const byKey = new Map(catalog.map((c) => [`${c.kind}:${c.id}`, c]));
  const charById = new Map(characters.map((c) => [c.id, c]));
  const charByName = new Map(characters.map((c) => [norm(c.name), c]));

  let poseId: string | undefined;
  let lightingId: string | undefined;
  const stylizationIds: string[] = [];
  const eventIds: string[] = [];
  const bodyIds: string[] = [];
  const tabIds: string[] = [];
  const characterIdsInOrder: string[] = [];
  const freeParts: string[] = [];
  const eventLines: string[] = [];
  const bodyLines: string[] = [];
  let lastCharacterName: string | undefined;
  let skinDetail: boolean | undefined;
  let skinDetailStrength: number | undefined;
  const charsBeforePose: string[] = [];
  let seenPose = false;

  for (const t of tokens) {
    if (t.type === "text") {
      freeParts.push(t.value.trim());
      continue;
    }
    const item = byKey.get(`${t.kind}:${t.id}`);
    if (t.kind === "character") {
      const ch =
        charById.get(t.id) ||
        charByName.get(norm(t.label)) ||
        characters.find((c) => c.id === t.id);
      if (ch) {
        if (!characterIdsInOrder.includes(ch.id)) characterIdsInOrder.push(ch.id);
        lastCharacterName = ch.name;
        if (!seenPose) charsBeforePose.push(ch.name);
      } else {
        lastCharacterName = t.label;
        if (!seenPose) charsBeforePose.push(t.label);
      }
      continue;
    }
    tabIds.push(t.id);
    if (t.kind === "pose") {
      poseId = t.id;
      seenPose = true;
      continue;
    }
    if (t.kind === "lighting") {
      lightingId = t.id;
      continue;
    }
    if (t.kind === "stylization") {
      stylizationIds.push(t.id);
      if (item?.skinDetail) {
        skinDetail = true;
        skinDetailStrength = item.skinDetailStrength ?? 1.2;
      }
      continue;
    }
    if (t.kind === "body") {
      bodyIds.push(t.id);
      if (item?.text) bodyLines.push(item.text);
      continue;
    }
    if (t.kind === "event") {
      eventIds.push(t.id);
      const who = lastCharacterName || "subject";
      const custom = t.customText?.trim();
      eventLines.push(`${who}: ${custom || item?.text || t.label}`);
      continue;
    }
    if (t.kind === "voiceover") {
      tabIds.push(t.id);
      const script = t.customText?.trim() || item?.customText?.trim() || t.label;
      if (script) freeParts.push(`Dialogue/voiceover: ${script}`);
      continue;
    }
    if (t.kind === "location") {
      tabIds.push(t.id);
      const loc =
        t.locationRefSlot != null
          ? `Location from reference Picture ${t.locationRefSlot}`
          : t.customText?.trim() || item?.customText?.trim() || t.label;
      if (loc) freeParts.push(`Location: ${loc}`);
      continue;
    }
    if (t.kind === "action") {
      if (item?.text) freeParts.push(item.text);
      continue;
    }
    if (t.kind === "voice") {
      if (item?.text) freeParts.push(`Voice: ${item.text}`);
      continue;
    }
    if (t.kind === "camera") {
      if (item?.text) freeParts.push(`Camera: ${item.text}`);
      continue;
    }
  }

  const receiverName = charsBeforePose[0];
  const activeName =
    charsBeforePose.length >= 2
      ? charsBeforePose[charsBeforePose.length - 1]
      : undefined;

  const poseItem = poseId
    ? catalog.find((c) => c.kind === "pose" && c.id === poseId)
    : undefined;
  const poseGeom = poseItem?.text ? legoPoseGeometry(poseItem.text) : "";
  const lighting = lightingId
    ? catalog.find((c) => c.kind === "lighting" && c.id === lightingId)
    : undefined;
  const stylizationTexts = stylizationIds
    .map((id) => catalog.find((c) => c.kind === "stylization" && c.id === id)?.text)
    .filter(Boolean) as string[];

  const roleLine =
    receiverName && activeName && poseId
      ? `${activeName} is the active partner; ${receiverName} is receiving. Keep this role assignment.`
      : receiverName && poseId
        ? `Focus on ${receiverName}.`
        : "";

  const freeText = freeParts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const scene = [
    roleLine,
    poseGeom,
    eventLines.join(". "),
    bodyLines.join(", "),
    freeText,
    lighting?.text,
    stylizationTexts.join(", "),
  ]
    .filter(Boolean)
    .join(". ")
    .replace(/\.\s*\./g, ".")
    .trim();

  return {
    scene,
    poseId,
    lightingId,
    stylizationIds,
    eventIds,
    bodyIds,
    tabIds,
    characterIdsInOrder,
    receiverName,
    activeName,
    freeText,
    skinDetail,
    skinDetailStrength,
    styleId: lightingId,
  };
}
