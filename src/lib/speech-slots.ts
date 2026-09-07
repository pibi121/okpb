/**
 * Spoken dialogue slots for video templates.
 * Authors mark lines with {{s1}}… and a SPEECH_SLOTS block (AI prompt contract).
 */

export type SpeechSpeaker = "her" | "him" | "voiceover" | "other";

export type SpeechSlot = {
  id: string;
  speaker: SpeechSpeaker;
  lang: string;
  text: string;
  label?: string;
  maxChars?: number;
};

export type SpeechSlotFill = {
  id: string;
  text: string;
  lang?: string;
};

const SLOT_RE = /\{\{\s*(s\d+)\s*\}\}/gi;
/** Allow `N/A SPEECH_SLOTS:` glued to previous section text. */
const BLOCK_HEADER_RE = /SPEECH_SLOTS\s*:\s*(?:\r?\n|$)/i;
const SPEAKERS = new Set<SpeechSpeaker>(["her", "him", "voiceover", "other"]);

function normSpeaker(raw: string): SpeechSpeaker {
  const s = raw.trim().toLowerCase();
  if (s === "she" || s === "female" || s === "woman") return "her";
  if (s === "he" || s === "male" || s === "man") return "him";
  if (s === "vo" || s === "narrator" || s === "voice") return "voiceover";
  if (SPEAKERS.has(s as SpeechSpeaker)) return s as SpeechSpeaker;
  return "other";
}

function normLang(raw: string | undefined): string {
  const l = (raw || "en").trim().toLowerCase().slice(0, 8);
  return l || "en";
}

function collectSpeechSlotLines(source: string): { start: number; end: number; lines: string[] } | null {
  const header = source.match(BLOCK_HEADER_RE);
  if (!header || header.index === undefined) return null;
  const start = header.index;
  const bodyStart = header.index + header[0].length;
  const rest = source.slice(bodyStart);
  const lines: string[] = [];
  let consumed = 0;
  for (const line of rest.split(/\r?\n/)) {
    const rawLen = line.length + 1;
    const t = line.trim();
    if (!t) {
      if (lines.length) {
        consumed += rawLen;
        break;
      }
      consumed += rawLen;
      continue;
    }
    if (/^[A-Z][A-Z0-9_ ]{2,}:\s*$/.test(t) && !/^s\d+/i.test(t)) break;
    if (t.startsWith("#")) {
      consumed += rawLen;
      continue;
    }
    if (!/^s\d+/i.test(t) && !/speaker\s*=/i.test(t) && !/text\s*=/i.test(t)) {
      if (lines.length) break;
      consumed += rawLen;
      continue;
    }
    lines.push(t);
    consumed += rawLen;
  }
  return { start, end: bodyStart + consumed, lines };
}

/** Parse `SPEECH_SLOTS:` lines: `s1 | speaker=her | lang=en | text=Hello` */
export function parseSpeechSlotsBlock(source: string): SpeechSlot[] {
  const block = collectSpeechSlotLines(source);
  if (!block?.lines.length) return [];

  const out: SpeechSlot[] = [];
  const seen = new Set<string>();
  for (const line of block.lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (!parts.length) continue;
    let id = "";
    let speaker: SpeechSpeaker = "her";
    let lang = "en";
    let text = "";
    let label = "";
    /** 0 = derive from text length after parse */
    let maxCharsExplicit = 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (i === 0 && /^s\d+$/i.test(p)) {
        id = p.toLowerCase();
        continue;
      }
      const eq = p.indexOf("=");
      if (eq <= 0) {
        if (!text && !p.includes("=")) text = p;
        continue;
      }
      const key = p.slice(0, eq).trim().toLowerCase();
      const val = p.slice(eq + 1).trim();
      if (key === "id" && /^s\d+$/i.test(val)) id = val.toLowerCase();
      else if (key === "speaker") speaker = normSpeaker(val);
      else if (key === "lang" || key === "language") lang = normLang(val);
      else if (key === "text" || key === "line" || key === "default") text = val;
      else if (key === "label") label = val;
      else if (
        key === "maxchars" ||
        key === "max" ||
        key === "maxlen" ||
        key === "limit"
      ) {
        const n = Number.parseInt(val, 10);
        if (Number.isFinite(n) && n > 0) maxCharsExplicit = Math.min(500, n);
      }
    }
    if (!id) id = `s${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const maxChars = clampSpeechMaxChars(
      maxCharsExplicit > 0 ? maxCharsExplicit : text.length || 40,
    );
    out.push({
      id,
      speaker,
      lang,
      text: text.slice(0, maxChars),
      label: label || undefined,
      maxChars,
    });
  }
  return out;
}

function clampSpeechMaxChars(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 40;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

/** Prefer author-tested length of default text as the edit limit. */
export function deriveSpeechMaxChars(text: string, explicit?: number): number {
  if (typeof explicit === "number" && explicit > 0) {
    return clampSpeechMaxChars(explicit);
  }
  const len = text.trim().length;
  return clampSpeechMaxChars(len > 0 ? len : 40);
}

/** Collect {{sN}} ids in appearance order. */
export function listPlaceholderIds(source: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  SLOT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLOT_RE.exec(source))) {
    const id = m[1]!.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Strip SPEECH_SLOTS block (keep body + placeholders). */
export function stripSpeechSlotsBlock(source: string): string {
  if (!source) return "";
  const block = collectSpeechSlotLines(source);
  if (!block) return source.trim();
  return `${source.slice(0, block.start)}${source.slice(block.end)}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Resolve slots from any prompt text (i2v / shots / story).
 * Placeholders without a block line get empty defaults.
 */
export function extractSpeechSlots(...sources: string[]): SpeechSlot[] {
  const joined = sources.filter(Boolean).join("\n\n");
  if (!joined.trim()) return [];

  const fromBlock = parseSpeechSlotsBlock(joined);
  const byId = new Map(fromBlock.map((s) => [s.id, s]));
  const placeholderIds = listPlaceholderIds(joined);

  const orderedIds =
    placeholderIds.length > 0 ? placeholderIds : fromBlock.map((s) => s.id);

  if (!orderedIds.length) return [];

  return orderedIds.map((id, i) => {
    const existing = byId.get(id);
    if (existing) {
      return {
        ...existing,
        maxChars: deriveSpeechMaxChars(existing.text, existing.maxChars),
        text: existing.text.slice(
          0,
          deriveSpeechMaxChars(existing.text, existing.maxChars),
        ),
      };
    }
    return {
      id,
      speaker: "her" as const,
      lang: "en",
      text: "",
      label: `Line ${i + 1}`,
      maxChars: 40,
    };
  });
}

/** Legacy single-line speech → one slot. */
export function legacySpeechSlot(defaultText = ""): SpeechSlot[] {
  const text = defaultText.trim();
  const maxChars = deriveSpeechMaxChars(text);
  return [
    {
      id: "s1",
      speaker: "her",
      lang: "en",
      text: text.slice(0, maxChars),
      label: "Speech",
      maxChars,
    },
  ];
}

export function speechSlotsFromJson(raw: string | null | undefined): SpeechSlot[] {
  if (!raw?.trim()) return [];
  try {
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .map((row, i) => {
        const id =
          typeof row.id === "string" && /^s\d+$/i.test(row.id)
            ? row.id.toLowerCase()
            : `s${i + 1}`;
        const text = String(row.text || "");
        const maxChars = deriveSpeechMaxChars(
          text,
          typeof row.maxChars === "number" ? row.maxChars : undefined,
        );
        return {
          id,
          speaker: normSpeaker(String(row.speaker || "her")),
          lang: normLang(typeof row.lang === "string" ? row.lang : "en"),
          text: text.slice(0, maxChars),
          label: typeof row.label === "string" ? row.label : undefined,
          maxChars,
        } satisfies SpeechSlot;
      });
  } catch {
    return [];
  }
}

export function serializeSpeechSlots(slots: SpeechSlot[]): string {
  return JSON.stringify(slots);
}

export function speakerLabel(speaker: SpeechSpeaker, locale: "ru" | "en"): string {
  const map: Record<SpeechSpeaker, { ru: string; en: string }> = {
    her: { ru: "Она", en: "Her" },
    him: { ru: "Он", en: "Him" },
    voiceover: { ru: "За кадром", en: "Voiceover" },
    other: { ru: "Реплика", en: "Line" },
  };
  return map[speaker][locale];
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace {{sN}} and drop SPEECH_SLOTS; append a clear spoken block for the model. */
export function applySpeechFills(
  source: string,
  slots: SpeechSlot[],
  fills: SpeechSlotFill[],
): string {
  const fillById = new Map(fills.map((f) => [f.id.toLowerCase(), f] as const));
  let body = stripSpeechSlotsBlock(source);

  const spokenParts: string[] = [];
  const resolved: Array<{ id: string; text: string; lang: string }> = [];
  for (const slot of slots) {
    const fill = fillById.get(slot.id.toLowerCase());
    const text = (fill?.text ?? slot.text).trim().slice(0, slot.maxChars ?? deriveSpeechMaxChars(slot.text));
    const lang = normLang(fill?.lang || slot.lang);
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(slot.id)}\\s*\\}\\}`, "gi");
    if (text) {
      body = body.replace(re, `"${text.replace(/"/g, "'")}"`);
      spokenParts.push(`[${slot.speaker}/${lang}] "${text.replace(/"/g, "'")}"`);
      resolved.push({ id: slot.id, text, lang });
    } else {
      body = body.replace(re, "(no spoken words — breath only)");
    }
  }

  body = body.replace(SLOT_RE, "(no spoken words)");

  // Soften duplicate speech paraphrases in summary when exact lines already exist.
  body = scrubSummarySpeechParaphrase(body, resolved);

  if (spokenParts.length) {
    body = `${body.trim()}

SPEECH_PERFORMANCE_RULES:
- Speak ONLY these lines, in this order, with clear phonemes in the stated language.
- Between lines: no invented words, no foreign/gibberish babble, no humming speech — only breath, footsteps, laughter, ambience.
- Do not invent extra dialogue not listed below.

Spoken dialogue (perform clearly, match mouths when visible): ${spokenParts.join("; ")}.`;
  }
  return body.trim();
}

/**
 * Before any GPU / MiniMax call: resolve SPEECH_SLOTS + {{sN}} with defaults
 * (or provided fills). Safe no-op when there is no speech markup.
 */
export function finalizePromptSpeechForModel(
  source: string,
  fills?: SpeechSlotFill[],
): string {
  if (!source?.trim()) return source || "";
  const slots = extractSpeechSlots(source);
  if (!slots.length && !/\{\{\s*s\d+\s*\}\}/i.test(source) && !/SPEECH_SLOTS/i.test(source)) {
    return source;
  }
  if (!slots.length) {
    // Orphan placeholders / broken block — strip safely
    return stripSpeechSlotsBlock(source).replace(SLOT_RE, "(no spoken words)").trim();
  }
  const normalized = normalizeFills(slots, fills);
  return applySpeechFills(source, slots, normalized);
}

/** Remove English/action paraphrases of spoken lines from summary when slots exist. */
function scrubSummarySpeechParaphrase(
  body: string,
  resolved: Array<{ id: string; text: string; lang: string }>,
): string {
  if (!resolved.length) return body;
  const re =
    /(^|\n)summary:\s*\n([\s\S]*?)(?=\n(?:retention_analysis|detailed_description|overall_soundscape|non_diegetic_music|SPEECH_PERFORMANCE_RULES|Spoken dialogue)\s*:|$)/i;
  const m = body.match(re);
  if (!m || m.index === undefined) return body;
  let summary = m[2] || "";
  // Drop exact quoted copies of slot lines from summary (keep action).
  for (const r of resolved) {
    if (!r.text.trim()) continue;
    const q = escapeRegExp(r.text.replace(/"/g, "'"));
    summary = summary.replace(new RegExp(`[«"']${q}[»"']`, "gi"), "(shout/line)");
  }
  // Soften common dialogue paraphrases that cause double speech.
  summary = summary
    .replace(
      /\basks?\s+(?:him\s+|her\s+)?(?:nervously\s+)?(?:in\s+\w+\s+)?if\s+she\s+can\s+[^.…]{0,120}/gi,
      "speaks her line to him",
    )
    .replace(
      /\bhe\s+laughs\s+and\s+(?:agrees|answers|replies)[^.…]{0,80}/gi,
      "he laughs and answers",
    )
    .replace(
      /\bhears?\s+a\s+distant\s+shout\s+[«"'][^»"']+[»"']/gi,
      "hears a distant shout",
    );
  return (
    body.slice(0, m.index) +
    `${m[1]}summary:\n${summary.trim()}` +
    body.slice(m.index + m[0].length)
  );
}

/** Apply fills across quick-video shots plan JSON string. */
export function applySpeechFillsToShotsJson(
  shotsJson: string,
  slots: SpeechSlot[],
  fills: SpeechSlotFill[],
): string {
  if (!slots.length) return shotsJson;
  try {
    const plan = JSON.parse(shotsJson) as {
      __qvShots?: boolean;
      shots?: Array<{ legoQuery?: string; [k: string]: unknown }>;
      [k: string]: unknown;
    };
    if (plan?.__qvShots && Array.isArray(plan.shots)) {
      let spokenAttached = false;
      const shots = plan.shots.map((shot) => {
        const q = String(shot.legoQuery || "");
        if (!q) return shot;
        const hasPh =
          listPlaceholderIds(q).length > 0 || /SPEECH_SLOTS/i.test(q);
        if (hasPh || !spokenAttached) {
          spokenAttached = true;
          return { ...shot, legoQuery: applySpeechFills(q, slots, fills) };
        }
        return {
          ...shot,
          legoQuery: stripSpeechSlotsBlock(q).replace(SLOT_RE, ""),
        };
      });
      return JSON.stringify({ ...plan, shots });
    }
  } catch {
    /* fall through — treat as raw story prompt */
  }
  return applySpeechFills(shotsJson, slots, fills);
}

export function normalizeFills(
  slots: SpeechSlot[],
  raw: SpeechSlotFill[] | undefined,
): SpeechSlotFill[] {
  const byId = new Map((raw || []).map((f) => [f.id.toLowerCase(), f]));
  return slots.map((s) => {
    const f = byId.get(s.id.toLowerCase());
    return {
      id: s.id,
      text: (f?.text ?? s.text).trim().slice(0, s.maxChars ?? deriveSpeechMaxChars(s.text)),
      lang: normLang(f?.lang || s.lang),
    };
  });
}

export function templateHasSpeech(slots: SpeechSlot[], hasSpeechFlag?: boolean) {
  return slots.length > 0 || Boolean(hasSpeechFlag);
}
