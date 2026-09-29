"use client";

import { useEffect, useRef, type ClipboardEvent } from "react";
import { htmlToTelegramHtml } from "@/lib/ops/telegram-html";

type Props = {
  name: string;
  value: string;
  onChange: (telegramHtml: string) => void;
  placeholder?: string;
  rows?: number;
};

function exec(cmd: string, value?: string) {
  try {
    document.execCommand(cmd, false, value);
  } catch {
    /* ignore */
  }
}

export function OpsTgRichText({
  name,
  value,
  onChange,
  placeholder,
  rows = 4,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastOut = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only reset DOM when external value differs from what we last emitted
    // (avoid caret jump while typing).
    if (value === lastOut.current) return;
    const asHtml = telegramHtmlToEditable(value);
    if (el.innerHTML !== asHtml) {
      el.innerHTML = asHtml;
    }
    lastOut.current = value;
  }, [value]);

  function emitFromEditor() {
    const el = ref.current;
    if (!el) return;
    const tg = htmlToTelegramHtml(el.innerHTML);
    lastOut.current = tg;
    onChange(tg);
  }

  function wrapSpoiler() {
    wrapTag("tg-spoiler");
  }

  function wrapTag(tagName: string) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const el = document.createElement(tagName);
    try {
      range.surroundContents(el);
    } catch {
      const frag = range.extractContents();
      el.appendChild(frag);
      range.insertNode(el);
    }
    emitFromEditor();
  }

  function addLink() {
    const url = window.prompt("URL ссылки (https://…)", "https://");
    if (!url?.trim()) return;
    exec("createLink", url.trim());
    emitFromEditor();
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const html =
      e.clipboardData.getData("text/html") ||
      e.clipboardData.getData("text/plain");
    if (!html) return;
    const cleaned = htmlToTelegramHtml(
      e.clipboardData.getData("text/html")
        ? html
        : html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"),
    );
    // Insert as HTML that contenteditable can show
    const editable = telegramHtmlToEditable(cleaned);
    exec("insertHTML", editable || cleaned);
    emitFromEditor();
  }

  const minH = Math.max(72, rows * 22);

  return (
    <div className="rounded-xl border border-white/10 bg-[#121214]">
      <div className="flex flex-wrap gap-1 border-b border-white/10 px-2 py-1.5">
        {(
          [
            ["B", () => exec("bold"), "font-bold"],
            ["I", () => exec("italic"), "italic"],
            ["U", () => exec("underline"), "underline"],
            ["S", () => exec("strikeThrough"), "line-through"],
          ] as const
        ).map(([label, fn, cls]) => (
          <button
            key={label}
            type="button"
            className={`rounded px-2 py-0.5 text-xs text-zinc-200 hover:bg-white/10 ${cls}`}
            onMouseDown={(e) => {
              e.preventDefault();
              fn();
              emitFromEditor();
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="rounded px-2 py-0.5 font-mono text-xs text-zinc-200 hover:bg-white/10"
          title="Моноширинный"
          onMouseDown={(e) => {
            e.preventDefault();
            wrapTag("code");
          }}
        >
          {"</>"}
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-xs text-zinc-200 hover:bg-white/10"
          title="Спойлер (скрытое)"
          onMouseDown={(e) => {
            e.preventDefault();
            wrapSpoiler();
          }}
        >
          ▒▒
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-xs text-zinc-200 hover:bg-white/10"
          title="Ссылка"
          onMouseDown={(e) => {
            e.preventDefault();
            addLink();
          }}
        >
          Link
        </button>
        <span className="ml-auto self-center text-[10px] text-zinc-500">
          Вставка из Telegram сохраняет форматирование · уходит как HTML
        </span>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline
        data-placeholder={placeholder}
        className="ops-tg-rich min-h-[4.5rem] px-3 py-2 text-sm text-zinc-100 outline-none empty:before:text-zinc-500 empty:before:content-[attr(data-placeholder)]"
        style={{ minHeight: minH }}
        onInput={emitFromEditor}
        onBlur={emitFromEditor}
        onPaste={onPaste}
        suppressContentEditableWarning
      />
      <input type="hidden" name={name} value={value} readOnly />
    </div>
  );
}

/** Show Telegram HTML inside contenteditable (spoiler as marked span). */
function telegramHtmlToEditable(tg: string): string {
  if (!tg) return "";
  return tg
    .replace(/\n/g, "<br>")
    .replace(/<tg-spoiler>/gi, '<span class="tg-spoiler" style="background:#333;border-radius:3px">')
    .replace(/<\/tg-spoiler>/gi, "</span>");
}
