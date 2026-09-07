/** Lookbook — structured appearance (enums → EN) + free-text custom values. */

export type LookbookField = {
  id: string;
  label: string;
  /** If true, UI shows «своё» text input besides presets */
  allowCustom?: boolean;
  options: { id: string; label: string; en: string }[];
};

export type LookbookValues = Record<string, string>;
export type Gender = "female" | "male";

/**
 * Meta flags in lookbookJson for LoRA + lookbook mixing:
 * - `_prompt_<fieldId>`: "1" = include field in prompt, "0" = rely on LoRA (default "1")
 * - Legacy `_supplement`: "0" = all fields off unless `_prompt_*` explicitly set
 */
export const LOOKBOOK_SUPPLEMENT_KEY = "_supplement";
export const LOOKBOOK_PROMPT_PREFIX = "_prompt_";

export function lookbookPromptKey(fieldId: string): string {
  return `${LOOKBOOK_PROMPT_PREFIX}${fieldId}`;
}

/** Per-field: include this trait in prompts when LoRA is active. */
export function isLookbookFieldInPrompt(
  values: LookbookValues,
  fieldId: string,
): boolean {
  const key = lookbookPromptKey(fieldId);
  const explicit = values[key];
  if (explicit === "0") return false;
  if (explicit === "1") return true;
  // Legacy global off — all fields skipped unless explicitly re-enabled.
  if (values[LOOKBOOK_SUPPLEMENT_KEY] === "0") return false;
  return true;
}

export function setLookbookFieldInPrompt(
  values: LookbookValues,
  fieldId: string,
  enabled: boolean,
): LookbookValues {
  return { ...values, [lookbookPromptKey(fieldId)]: enabled ? "1" : "0" };
}

export function setAllLookbookFieldsInPrompt(
  values: LookbookValues,
  gender: Gender,
  enabled: boolean,
): LookbookValues {
  const next: LookbookValues = {
    ...values,
    [LOOKBOOK_SUPPLEMENT_KEY]: enabled ? "1" : "0",
  };
  for (const field of fieldsForGender(gender)) {
    next[lookbookPromptKey(field.id)] = enabled ? "1" : "0";
  }
  return next;
}

/** Persist lookbook with all trait text off (LoRA carries appearance). */
export function lookbookJsonWithPromptOverlayOff(
  lookbookJson: string | null | undefined,
  gender: Gender = "female",
): string {
  const lb = parseLookbook(lookbookJson, gender);
  return JSON.stringify(setAllLookbookFieldsInPrompt(lb, gender, false));
}

/** Copy per-field prompt flags from a previous lookbook (e.g. after LLM infer). */
export function preserveLookbookPromptFlags(
  next: LookbookValues,
  prev: LookbookValues,
  gender: Gender,
): LookbookValues {
  const out = { ...next };
  for (const field of fieldsForGender(gender)) {
    const key = lookbookPromptKey(field.id);
    if (prev[key] !== undefined) out[key] = prev[key];
  }
  if (prev[LOOKBOOK_SUPPLEMENT_KEY] !== undefined) {
    out[LOOKBOOK_SUPPLEMENT_KEY] = prev[LOOKBOOK_SUPPLEMENT_KEY];
  }
  return out;
}

/** True when at least one lookbook field is sent to the prompt alongside LoRA. */
export function isLookbookSupplementEnabled(
  values: LookbookValues,
  gender: Gender = "female",
): boolean {
  for (const field of fieldsForGender(gender)) {
    if (isLookbookFieldInPrompt(values, field.id)) return true;
  }
  return false;
}

/** @deprecated use setAllLookbookFieldsInPrompt or setLookbookFieldInPrompt */
export function setLookbookSupplement(
  values: LookbookValues,
  enabled: boolean,
  gender: Gender = "female",
): LookbookValues {
  return setAllLookbookFieldsInPrompt(values, gender, enabled);
}

/** Stored value for free-text: `custom:<english or descriptive phrase>` */
export const CUSTOM_PREFIX = "custom:";

export function isCustomValue(value: string | undefined | null): boolean {
  if (!value) return false;
  return value.startsWith(CUSTOM_PREFIX);
}

export function customPayload(value: string): string {
  if (isCustomValue(value)) return value.slice(CUSTOM_PREFIX.length).trim();
  return (value || "").trim();
}

export function toCustomValue(text: string): string {
  return `${CUSTOM_PREFIX}${text.trim()}`;
}

const SHARED_HAIR_COLOR: LookbookField = {
  id: "hair_color",
  label: "Цвет волос",
  allowCustom: true,
  options: [
    { id: "black", label: "Чёрные", en: "black hair" },
    { id: "dark_brown", label: "Тёмно-каштановые", en: "dark brown hair" },
    { id: "brown", label: "Каштановые", en: "brown hair" },
    { id: "blonde", label: "Светлые / блонд", en: "blonde hair" },
    { id: "platinum", label: "Платиновый блонд", en: "platinum blonde hair" },
    { id: "red", label: "Рыжие", en: "red hair" },
    { id: "auburn", label: "Медные", en: "auburn hair" },
    { id: "pink", label: "Розовые", en: "pink hair" },
    { id: "blue", label: "Синие", en: "blue hair" },
    { id: "bald", label: "Лысый / нет", en: "bald head" },
    { id: "gray", label: "Седые", en: "gray hair" },
  ],
};

const SHARED_EYES: LookbookField = {
  id: "eyes",
  label: "Глаза",
  allowCustom: true,
  options: [
    { id: "brown", label: "Карие", en: "brown eyes" },
    { id: "hazel", label: "Ореховые", en: "hazel eyes" },
    { id: "green", label: "Зелёные", en: "green eyes" },
    { id: "blue", label: "Голубые", en: "blue eyes" },
    { id: "gray", label: "Серые", en: "gray eyes" },
    { id: "dark", label: "Тёмные", en: "dark eyes" },
  ],
};

const SHARED_SKIN: LookbookField = {
  id: "skin",
  label: "Кожа",
  allowCustom: true,
  options: [
    { id: "fair", label: "Светлая", en: "fair skin" },
    { id: "light", label: "Светло-бежевая", en: "light skin" },
    { id: "olive", label: "Оливковая", en: "olive skin" },
    { id: "tan", label: "Загорелая", en: "tanned skin" },
    { id: "brown", label: "Смуглая", en: "brown skin" },
    { id: "dark", label: "Тёмная", en: "dark skin" },
  ],
};

const FEMALE_BODY: LookbookField = {
  id: "body",
  label: "Фигура (рост + тип)",
  allowCustom: true,
  options: [
    {
      id: "short_slim",
      label: "Маленький рост · худая",
      en: "petite stature, delicate narrow frame, slim shoulders, tiny waist, slender hips, thin arms and short slim legs, overall thin silhouette, clearly not curvy, not thick, not plus-size",
    },
    {
      id: "short_athletic",
      label: "Маленький рост · спортивная",
      en: "petite stature, compact athletic build, moderately broad shoulders, firm slim waist, toned arms and short powerful legs, lean muscle definition without bulk, fit tight silhouette",
    },
    {
      id: "short_soft",
      label: "Маленький рост · пухлая",
      en: "petite stature, soft rounded frame, gently full midsection and hips, soft arms and short plump legs, cushioned silhouette with mild volume, not skinny and not extreme bulk",
    },
    {
      id: "avg_slim",
      label: "Средний рост · худая",
      en: "average stature, lean elongated frame, narrow shoulders, slim waist, slim hips, long thin limbs, lightweight straight silhouette, explicitly not curvy, not thick, not plus-size",
    },
    {
      id: "avg_athletic",
      label: "Средний рост · спортивная",
      en: "average stature, balanced athletic physique, defined shoulders, toned midsection, firm hips, muscular yet lean arms and legs, sporty tight silhouette without bodybuilder bulk",
    },
    {
      id: "avg_soft",
      label: "Средний рост · пухлая",
      en: "average stature, soft fuller build, rounded shoulders, soft midsection, fuller hips and thighs, gently plump arms and legs, smooth padded silhouette with natural soft volume",
    },
    {
      id: "tall_slim",
      label: "Высокий рост · худая",
      en: "tall stature, long willowy frame, narrow shoulders, very slim waist, slim hips, elongated thin arms and long slender legs, elegant linear silhouette, not curvy, not thick, not plus-size",
    },
    {
      id: "tall_athletic",
      label: "Высокий рост · спортивная",
      en: "tall stature, long athletic frame, broad toned shoulders, tight waist, firm hips, long muscular arms and powerful long legs, lean sporty silhouette with clear muscle tone, no heavy bulk",
    },
    {
      id: "tall_soft",
      label: "Высокий рост · пухлая",
      en: "tall stature, long soft frame, gently rounded shoulders, soft midsection, fuller hips, long plump arms and soft long legs, tall padded silhouette with mild natural volume throughout",
    },
  ],
};

/** Legacy body ids → figure preset (no breast/butt wording). */
const LEGACY_BODY_TO_PRESET: Record<string, string> = {
  very_thin: "short_slim",
  skinny: "short_slim",
  petite_slim: "short_slim",
  slim: "avg_slim",
  athletic: "avg_athletic",
  fit_muscular: "avg_athletic",
  average: "avg_slim",
  curvy: "avg_soft",
  soft: "avg_soft",
  chubby: "avg_soft",
  thick: "avg_soft",
  plus: "tall_soft",
  obese: "tall_soft",
};

function migrateFemaleFigurePreset(values: LookbookValues): LookbookValues {
  const next = { ...values };
  const rawBody = String(next.body || "").trim();
  if (rawBody && !isCustomValue(rawBody)) {
    const known = FEMALE_BODY.options.some((o) => o.id === rawBody);
    if (!known && LEGACY_BODY_TO_PRESET[rawBody]) {
      next.body = LEGACY_BODY_TO_PRESET[rawBody]!;
    } else if (!known) {
      next.body = "avg_slim";
    }
  } else if (!rawBody) {
    next.body = "avg_slim";
  }
  delete next.bust;
  delete next.hips;
  delete next[lookbookPromptKey("bust")];
  delete next[lookbookPromptKey("hips")];
  return next;
}

const FEMALE_GENITAL_HAIR: LookbookField = {
  id: "genital_hair",
  label: "Лобок / вагина",
  allowCustom: true,
  options: [
    { id: "shaved", label: "Бритая", en: "shaved pussy bare pubic area" },
    { id: "trimmed", label: "Подстриженная", en: "neatly trimmed pubic hair" },
    { id: "landing_strip", label: "Полоска", en: "landing strip pubic hair" },
    { id: "hairy", label: "Волосатая", en: "hairy pussy natural bush" },
  ],
};

const MALE_BODY: LookbookField = {
  id: "body",
  label: "Телосложение",
  allowCustom: true,
  options: [
    {
      id: "very_thin",
      label: "Очень худой",
      en: "extremely thin male frame, bony narrow shoulders, sunken midsection, very slim hips, stick-like arms and legs, fragile underweight silhouette with almost no muscle or soft tissue",
    },
    {
      id: "skinny",
      label: "Худой",
      en: "skinny male build, narrow shoulders, flat chest and waist, slim hips, thin arms and lean legs, light underdeveloped silhouette, little muscle mass, clearly thin overall",
    },
    {
      id: "slim",
      label: "Стройный",
      en: "slim male physique, modest shoulders, flat toned midsection, narrow hips, lean arms and legs, clean lightweight silhouette with light natural definition, not bulky and not soft",
    },
    {
      id: "athletic",
      label: "Атлетичный",
      en: "athletic male build, well-proportioned shoulders, firm midsection, balanced hips, toned arms and strong legs, sporty fit silhouette with visible muscle tone without heavy bodybuilder bulk",
    },
    {
      id: "muscular",
      label: "Мускулистый",
      en: "muscular male frame, broad powerful shoulders, thick chest, defined waist, solid hips, heavily muscled arms and strong thick legs, dense athletic silhouette with clear muscle mass",
    },
    {
      id: "bodybuilder",
      label: "Бодибилдер",
      en: "bodybuilder male physique, extremely wide shoulders, massive chest, deeply carved waist, huge arms and thick sculpted legs, exaggerated muscle bulk and extreme hypertrophy silhouette",
    },
    {
      id: "bulky",
      label: "Массивный",
      en: "bulky male build, very broad heavy shoulders, thick torso, wide midsection, solid hips, massive arms and thick powerful legs, heavy solid silhouette with size over sharp definition",
    },
    {
      id: "average",
      label: "Обычный",
      en: "average male physique, regular shoulder width, ordinary midsection, standard hips, normal arms and legs, unremarkable everyday proportions, neither lean athletic nor soft heavy",
    },
    {
      id: "dad",
      label: "Плотный / dadbod",
      en: "dad-bod male frame, soft rounded shoulders, noticeable soft belly, fuller midsection, average hips, mildly soft arms and legs, casual lived-in silhouette with gentle middle-age softness",
    },
    {
      id: "chubby",
      label: "Пухлый",
      en: "chubby male build, rounded soft shoulders, plump midsection, fuller hips, soft thick arms and legs, padded silhouette with clear soft volume, heavier than average but not extreme",
    },
    {
      id: "fat",
      label: "Толстый",
      en: "fat male physique, wide soft shoulders, large heavy belly, broad soft midsection, thick hips, heavy soft arms and thick legs, very full heavy silhouette with substantial body fat",
    },
    {
      id: "obese",
      label: "Очень толстый",
      en: "obese male frame, very broad soft shoulders, massive overhanging midsection, very wide hips, thick heavy arms and massive legs, extreme large silhouette dominated by heavy soft volume",
    },
  ],
};

const MALE_PENIS: LookbookField = {
  id: "penis_size",
  label: "Размер члена",
  allowCustom: true,
  options: [
    { id: "small_thin", label: "Маленький тонкий", en: "small thin penis" },
    { id: "small_thick", label: "Маленький толстый", en: "small thick penis" },
    { id: "medium_thin", label: "Средний тонкий", en: "medium thin penis" },
    { id: "medium_thick", label: "Средний толстый", en: "medium thick penis" },
    { id: "long_thin", label: "Длинный тонкий", en: "long thin penis" },
    { id: "long_thick", label: "Длинный толстый", en: "long thick penis" },
    { id: "huge_thin", label: "Огромный тонкий", en: "huge thin penis" },
    { id: "huge_thick", label: "Огромный толстый", en: "huge thick penis" },
  ],
};

const MALE_GENITAL_HAIR: LookbookField = {
  id: "genital_hair",
  label: "Лобок / член",
  allowCustom: true,
  options: [
    { id: "shaved", label: "Бритый", en: "shaved cock and pubic area" },
    { id: "trimmed", label: "Подстриженный", en: "trimmed pubic hair around penis" },
    { id: "hairy", label: "Волосатый", en: "hairy pubic area natural bush" },
  ],
};

export const FEMALE_LOOKBOOK_FIELDS: LookbookField[] = [
  {
    id: "hair_length",
    label: "Длина волос",
    allowCustom: true,
    options: [
      { id: "buzz", label: "Ёжик / очень короткие", en: "very short buzzed hair" },
      { id: "short", label: "Короткие", en: "short hair" },
      { id: "medium", label: "Средние", en: "medium-length hair" },
      { id: "long", label: "Длинные", en: "long hair" },
      { id: "very_long", label: "Очень длинные", en: "very long hair" },
    ],
  },
  SHARED_HAIR_COLOR,
  {
    id: "hair_style",
    label: "Стиль волос",
    allowCustom: true,
    options: [
      { id: "straight", label: "Прямые", en: "straight hair" },
      { id: "wavy", label: "Волнистые", en: "wavy hair" },
      { id: "curly", label: "Кудрявые", en: "curly hair" },
      { id: "ponytail", label: "Хвост", en: "hair in a ponytail" },
      { id: "braids", label: "Косы", en: "braided hair" },
      { id: "bun", label: "Пучок", en: "hair in a bun" },
    ],
  },
  {
    id: "face_shape",
    label: "Форма лица",
    allowCustom: true,
    options: [
      { id: "oval", label: "Овал", en: "oval face" },
      { id: "heart", label: "Сердце", en: "heart-shaped face" },
      { id: "round", label: "Круглое", en: "round face" },
      { id: "square", label: "Мягкий квадрат", en: "soft square jaw" },
    ],
  },
  SHARED_EYES,
  {
    id: "lips",
    label: "Губы",
    allowCustom: true,
    options: [
      { id: "full", label: "Пухлые", en: "full lips" },
      { id: "natural", label: "Обычные", en: "natural lips" },
      { id: "thin", label: "Тонкие", en: "thin lips" },
    ],
  },
  FEMALE_BODY,
  FEMALE_GENITAL_HAIR,
  SHARED_SKIN,
  {
    id: "vibe",
    label: "Вайб",
    allowCustom: true,
    options: [
      { id: "natural", label: "Natural", en: "natural soft expression" },
      { id: "sensual", label: "Sensual", en: "sensual expression" },
      { id: "fierce", label: "Fierce", en: "confident fierce look" },
      { id: "innocent", label: "Soft", en: "soft innocent adult look" },
    ],
  },
  {
    id: "details",
    label: "Доп. детали (своё)",
    allowCustom: true,
    options: [],
  },
];

export const MALE_LOOKBOOK_FIELDS: LookbookField[] = [
  {
    id: "hair_length",
    label: "Волосы / голова",
    allowCustom: true,
    options: [
      { id: "bald", label: "Лысый", en: "bald head" },
      { id: "buzz", label: "Ёжик", en: "buzz cut" },
      { id: "short", label: "Короткие", en: "short hair" },
      { id: "medium", label: "Средние", en: "medium-length hair" },
      { id: "long", label: "Длинные", en: "long hair" },
    ],
  },
  SHARED_HAIR_COLOR,
  {
    id: "facial_hair",
    label: "Борода / щетина",
    allowCustom: true,
    options: [
      { id: "clean", label: "Чисто выбрит", en: "clean-shaven face, no beard, no mustache, no stubble" },
      { id: "stubble", label: "Щетина", en: "light stubble" },
      { id: "beard", label: "Борода", en: "full beard" },
      { id: "goatee", label: "Эспаньолка", en: "goatee" },
    ],
  },
  {
    id: "face_shape",
    label: "Форма лица",
    allowCustom: true,
    options: [
      { id: "square", label: "Квадратная", en: "square jaw" },
      { id: "oval", label: "Овал", en: "oval face" },
      { id: "angular", label: "Угловатая", en: "angular masculine face" },
      { id: "round", label: "Круглое", en: "round face" },
    ],
  },
  SHARED_EYES,
  MALE_BODY,
  {
    id: "chest",
    label: "Грудь / торс",
    allowCustom: true,
    options: [
      {
        id: "smooth",
        label: "Гладкая",
        en: "smooth bare male chest, clean skin surface without visible chest hair, even flat or lightly contoured torso front",
      },
      {
        id: "hairy",
        label: "Волосатая",
        en: "hairy male chest, visible natural chest hair covering the torso front, textured furred appearance on the chest area",
      },
      {
        id: "defined",
        label: "Рельеф",
        en: "defined male chest, clear pectoral muscle shape and separation, firm contoured torso front with athletic chest definition",
      },
      {
        id: "soft",
        label: "Мягкая",
        en: "soft male chest, gently rounded padded pectoral area, smooth soft volume without sharp muscle cuts or hardness",
      },
    ],
  },
  MALE_PENIS,
  MALE_GENITAL_HAIR,
  SHARED_SKIN,
  {
    id: "vibe",
    label: "Вайб",
    allowCustom: true,
    options: [
      { id: "dominant", label: "Dominant", en: "confident dominant expression" },
      { id: "calm", label: "Calm", en: "calm masculine expression" },
      { id: "intense", label: "Intense", en: "intense focused look" },
      { id: "soft", label: "Soft", en: "soft gentle expression" },
    ],
  },
  {
    id: "details",
    label: "Доп. детали (своё)",
    allowCustom: true,
    options: [],
  },
];

/** @deprecated use fieldsForGender */
export const LOOKBOOK_FIELDS = FEMALE_LOOKBOOK_FIELDS;

export function fieldsForGender(gender: Gender = "female"): LookbookField[] {
  return gender === "male" ? MALE_LOOKBOOK_FIELDS : FEMALE_LOOKBOOK_FIELDS;
}

export function emptyLookbook(gender: Gender = "female"): LookbookValues {
  const v: LookbookValues = {};
  for (const f of fieldsForGender(gender)) {
    v[f.id] = f.options[0]?.id ?? "";
  }
  return v;
}

/** Heuristic fill for lab / seed. */
export function suggestedLookbook(gender: Gender, preset?: "olh" | "bald_muscular"): LookbookValues {
  if (gender === "male" || preset === "bald_muscular") {
    return {
      ...emptyLookbook("male"),
      hair_length: "bald",
      hair_color: "bald",
      facial_hair: "clean",
      face_shape: "square",
      eyes: "dark",
      body: "muscular",
      chest: "defined",
      penis_size: "medium_thick",
      genital_hair: "trimmed",
      skin: "light",
      vibe: "dominant",
      details: "",
    };
  }
  return {
    ...emptyLookbook("female"),
    hair_length: "long",
    hair_color: "dark_brown",
    hair_style: "straight",
    face_shape: "oval",
    eyes: "brown",
    lips: "natural",
    body: "avg_slim",
    genital_hair: "shaved",
    skin: "light",
    vibe: "natural",
    details: "",
  };
}

export function parseLookbook(
  json: string | null | undefined,
  gender: Gender = "female",
): LookbookValues {
  try {
    const raw = json ? (JSON.parse(json) as LookbookValues) : {};
    let merged = { ...emptyLookbook(gender), ...raw };
    const hasPerField = Object.keys(raw).some((k) => k.startsWith(LOOKBOOK_PROMPT_PREFIX));
    if (!hasPerField && raw[LOOKBOOK_SUPPLEMENT_KEY] === "0") {
      for (const field of fieldsForGender(gender)) {
        merged[lookbookPromptKey(field.id)] = "0";
      }
    }
    if (gender === "female") {
      merged = migrateFemaleFigurePreset(merged);
    }
    return merged;
  } catch {
    return emptyLookbook(gender);
  }
}

export function fieldValueToEnglish(field: LookbookField, raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  if (isCustomValue(raw)) {
    const t = customPayload(raw);
    return t || null;
  }
  const opt = field.options.find((o) => o.id === raw);
  if (opt?.en) return opt.en;
  // Unknown id → treat as free-text English/description
  return raw.trim();
}

const INTIMATE_LOOKBOOK_FIELDS = new Set([
  "genital_hair",
  "penis_size",
]);

/** Body shape fields injected into Ref2V / Story H3 identity (face stays from photos). */
export const VIDEO_BODY_LOOKBOOK_FIELD_IDS: Record<Gender, Set<string>> = {
  female: new Set(["body"]),
  male: new Set(["body", "chest"]),
};

/** Back-view identity pack: body + hair only (no face traits — they pull camera to frontal). */
export const BACK_VIEW_LOOKBOOK_FIELD_IDS: Record<Gender, Set<string>> = {
  female: new Set([
    "hair_length",
    "hair_color",
    "hair_style",
    "body",
    "skin",
  ]),
  male: new Set(["hair_length", "hair_color", "body", "skin"]),
};

export function lookbookBaseGender(gender: Gender = "female"): string {
  return gender === "male" ? "adult man" : "adult woman";
}

export function lookbookToEnglish(
  values: LookbookValues,
  gender: Gender = "female",
  opts?: {
    skipIntimate?: boolean;
    /** When set, skip fields where user chose LoRA-only for that trait. */
    hasLora?: boolean;
    /** Include only these field ids (after other filters). */
    onlyFieldIds?: Set<string>;
    /** Always include these fields in prompt even when LoRA would skip them. */
    forceFieldIds?: Set<string>;
  },
): string {
  const parts: string[] = [];
  for (const field of fieldsForGender(gender)) {
    if (opts?.onlyFieldIds && !opts.onlyFieldIds.has(field.id)) continue;
    if (opts?.skipIntimate && INTIMATE_LOOKBOOK_FIELDS.has(field.id)) continue;
    const forced = opts?.forceFieldIds?.has(field.id);
    if (opts?.hasLora && !forced && !isLookbookFieldInPrompt(values, field.id)) continue;
    const en = fieldValueToEnglish(field, values[field.id]);
    if (en) parts.push(en);
  }
  if (parts.length === 0) {
    return opts?.hasLora ? "" : lookbookBaseGender(gender);
  }
  return [lookbookBaseGender(gender), ...parts].join(", ");
}

/** Appearance line for prompts: per-field LoRA vs text when LoRA is ready. */
export function characterAppearanceForPrompt(
  values: LookbookValues,
  gender: Gender,
  opts?: {
    hasLora?: boolean;
    skipIntimate?: boolean;
    onlyFieldIds?: Set<string>;
    forceFieldIds?: Set<string>;
  },
): string {
  return lookbookToEnglish(values, gender, {
    skipIntimate: opts?.skipIntimate,
    hasLora: opts?.hasLora,
    onlyFieldIds: opts?.onlyFieldIds,
    forceFieldIds: opts?.forceFieldIds,
  });
}

/**
 * Short body-shape clause for video Ref2V (no "adult woman" prefix).
 * Face/hair stay from photos; this only steers proportions.
 */
export function bodyShapeAppearanceForPrompt(
  values: LookbookValues,
  gender: Gender = "female",
): string {
  const ids = VIDEO_BODY_LOOKBOOK_FIELD_IDS[gender];
  const parts: string[] = [];
  for (const field of fieldsForGender(gender)) {
    if (!ids.has(field.id)) continue;
    // Respect per-field prompt toggle (_prompt_<id> = "0" → skip).
    if (!isLookbookFieldInPrompt(values, field.id)) continue;
    const en = fieldValueToEnglish(field, values[field.id]);
    if (en) parts.push(en);
  }
  return parts.join(", ");
}

/** Select value for UI: known option id, or "__custom__" when free-text. */
export function lookbookSelectValue(field: LookbookField, stored: string | undefined): string {
  if (!stored) return field.options[0]?.id || "__custom__";
  if (isCustomValue(stored)) return "__custom__";
  if (field.options.some((o) => o.id === stored)) return stored;
  return "__custom__";
}
