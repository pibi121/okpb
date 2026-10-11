/**
 * Funnel v2 template keyboards.
 * Until a catalog turns customRows on, buttons stay 2 per row (legacy).
 * With customRows, each template keeps its own row break; pages only slice the list.
 * Pure helpers — safe to import from client components.
 */

export const TG_BUTTON_STYLES = ["", "primary", "success", "danger"] as const;
export type TgButtonStyle = (typeof TG_BUTTON_STYLES)[number];

export const FUNNEL_KEYBOARD_MAX_PER_ROW = 4;
export const FUNNEL_KEYBOARD_PAGE_MIN = 1;
export const FUNNEL_KEYBOARD_PAGE_MAX = 24;
export const FUNNEL_KEYBOARD_DEFAULT_PAGE = 6;

export type FunnelKeyboardCatalogId = "photo" | "video";

export type FunnelKeyboardCatalog = {
  customRows: boolean;
  firstPageSize: number;
  nextPageSize: number;
};

export type FunnelKeyboardSettings = Record<
  FunnelKeyboardCatalogId,
  FunnelKeyboardCatalog
>;

export function defaultFunnelKeyboardCatalog(): FunnelKeyboardCatalog {
  return {
    customRows: false,
    firstPageSize: FUNNEL_KEYBOARD_DEFAULT_PAGE,
    nextPageSize: FUNNEL_KEYBOARD_DEFAULT_PAGE,
  };
}

export function defaultFunnelKeyboardSettings(): FunnelKeyboardSettings {
  return {
    photo: defaultFunnelKeyboardCatalog(),
    video: defaultFunnelKeyboardCatalog(),
  };
}

export function clampFunnelPageSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return FUNNEL_KEYBOARD_DEFAULT_PAGE;
  return Math.min(
    FUNNEL_KEYBOARD_PAGE_MAX,
    Math.max(FUNNEL_KEYBOARD_PAGE_MIN, Math.floor(n)),
  );
}

export function parseTgButtonStyle(raw: unknown): TgButtonStyle {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "primary" || s === "success" || s === "danger") return s;
  return "";
}

function parseCatalog(raw: unknown): FunnelKeyboardCatalog {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    customRows: o.customRows === true,
    firstPageSize: clampFunnelPageSize(o.firstPageSize),
    nextPageSize: clampFunnelPageSize(o.nextPageSize),
  };
}

export function parseFunnelKeyboardSettings(
  raw: string | null | undefined,
): FunnelKeyboardSettings {
  let parsed: unknown = {};
  try {
    parsed = raw?.trim() ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const o =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    photo: parseCatalog(o.photo),
    video: parseCatalog(o.video),
  };
}

export type KeyboardLayoutItem = {
  rowBreak: boolean;
};

/** Group templates into keyboard rows. Does not split a configured row. */
export function groupKeyboardRows<T extends KeyboardLayoutItem>(
  items: T[],
  customRows: boolean,
): T[][] {
  if (!items.length) return [];
  if (!customRows) {
    const rows: T[][] = [];
    for (let i = 0; i < items.length; i += 2) {
      rows.push(items.slice(i, i + 2));
    }
    return rows;
  }
  const rows: T[][] = [];
  let cur: T[] = [];
  for (const item of items) {
    const startNew =
      cur.length === 0 ||
      item.rowBreak ||
      cur.length >= FUNNEL_KEYBOARD_MAX_PER_ROW;
    if (startNew && cur.length) {
      rows.push(cur);
      cur = [];
    }
    cur.push(item);
  }
  if (cur.length) rows.push(cur);
  return rows;
}

export function paginateKeyboardRows<T>(
  rows: T[][],
  page: number,
  firstPageSize: number,
  nextPageSize: number,
): { pageRows: T[][]; pageIndex: number; pageCount: number } {
  const first = clampFunnelPageSize(firstPageSize);
  const next = clampFunnelPageSize(nextPageSize);
  const pages: T[][][] = [];
  let bucket: T[][] = [];
  let count = 0;
  let limit = first;
  for (const row of rows) {
    const n = row.length;
    if (bucket.length > 0 && count + n > limit) {
      pages.push(bucket);
      bucket = [];
      count = 0;
      limit = next;
    }
    bucket.push(row);
    count += n;
    if (count >= limit) {
      pages.push(bucket);
      bucket = [];
      count = 0;
      limit = next;
    }
  }
  if (bucket.length) pages.push(bucket);
  if (!pages.length) pages.push([]);
  const pageCount = Math.max(1, pages.length);
  const pageIndex = Math.min(Math.max(0, page), pageCount - 1);
  return { pageRows: pages[pageIndex] || [], pageIndex, pageCount };
}

export function tgInlineButton(
  text: string,
  callbackData: string,
  style: TgButtonStyle,
): Record<string, unknown> {
  const button: Record<string, unknown> = {
    text,
    callback_data: callbackData,
  };
  if (style) button.style = style;
  return button;
}
