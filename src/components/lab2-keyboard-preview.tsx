"use client";

import {
  groupKeyboardRows,
  paginateKeyboardRows,
  type FunnelKeyboardCatalog,
  type TgButtonStyle,
} from "@/lib/tg/funnel-v2/keyboard-layout";

export type PreviewButton = {
  key: string;
  label: string;
  rowBreak: boolean;
  style: TgButtonStyle;
};

const STYLE_CLASS: Record<TgButtonStyle, string> = {
  "": "border-white/15 bg-zinc-800 text-zinc-100",
  primary: "border-sky-400/40 bg-sky-500/25 text-sky-100",
  success: "border-emerald-400/40 bg-emerald-500/25 text-emerald-100",
  danger: "border-rose-400/40 bg-rose-500/25 text-rose-100",
};

export function Lab2KeyboardPreview({
  title,
  hint,
  items,
  settings,
  page,
  onPage,
  onSettings,
  onResetRows,
}: {
  title: string;
  hint: string;
  items: PreviewButton[];
  settings: FunnelKeyboardCatalog;
  page: number;
  onPage: (page: number) => void;
  onSettings: (patch: Partial<FunnelKeyboardCatalog>) => void;
  onResetRows: () => void;
}) {
  const grouped = groupKeyboardRows(items, settings.customRows);
  const paged = paginateKeyboardRows(
    grouped,
    page,
    settings.firstPageSize,
    settings.nextPageSize,
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-[#121214]/80 p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-foreground">{title}</p>
          <p className="mt-0.5 max-w-xl text-[11px] text-zinc-500">{hint}</p>
        </div>
        {settings.customRows ? (
          <button
            type="button"
            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-zinc-300"
            onClick={onResetRows}
          >
            Снова по 2 в ряд
          </button>
        ) : (
          <p className="text-[11px] text-zinc-500">Сейчас по 2 кнопки в ряд</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="text-[11px] text-zinc-500">
          Кнопок на первой странице
          <input
            type="number"
            min={1}
            max={24}
            className="mt-1 block w-28 rounded-lg border border-white/10 bg-zinc-950 px-2 py-1.5 text-sm text-foreground"
            value={settings.firstPageSize}
            onChange={(e) =>
              onSettings({ firstPageSize: Number(e.target.value) || 1 })
            }
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          Кнопок на следующих
          <input
            type="number"
            min={1}
            max={24}
            className="mt-1 block w-28 rounded-lg border border-white/10 bg-zinc-950 px-2 py-1.5 text-sm text-foreground"
            value={settings.nextPageSize}
            onChange={(e) =>
              onSettings({ nextPageSize: Number(e.target.value) || 1 })
            }
          />
        </label>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-zinc-950/80 p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span>
            Страница {paged.pageIndex + 1} из {paged.pageCount}
            {items.length ? ` · в каталоге ${items.length}` : ""}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              className="rounded-md border border-white/10 px-2 py-1 disabled:opacity-30"
              disabled={paged.pageIndex <= 0}
              onClick={() => onPage(paged.pageIndex - 1)}
            >
              ⬅️
            </button>
            <button
              type="button"
              className="rounded-md border border-white/10 px-2 py-1 disabled:opacity-30"
              disabled={paged.pageIndex >= paged.pageCount - 1}
              onClick={() => onPage(paged.pageIndex + 1)}
            >
              ➡️
            </button>
          </span>
        </div>
        {items.length === 0 ? (
          <p className="text-[12px] text-zinc-500">В воронке пока нет кнопок</p>
        ) : (
          <div className="grid gap-1.5">
            {paged.pageRows.map((row, i) => (
              <div key={i} className="flex gap-1.5">
                {row.map((btn) => (
                  <div
                    key={btn.key}
                    className={`min-w-0 flex-1 truncate rounded-lg border px-2 py-1.5 text-center text-[12px] ${STYLE_CLASS[btn.style]}`}
                    title={btn.label}
                  >
                    {btn.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
