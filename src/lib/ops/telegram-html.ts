/**
 * Sanitize / normalize HTML for Telegram Bot API parse_mode=HTML.
 * Allowed: b/strong, i/em, u/ins, s/strike/del, code, pre, a[href], tg-spoiler.
 */

const BLOCK_TO_NL = new Set([
  "div",
  "p",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isSpoilerSpan(el: Element): boolean {
  const cls = (el.getAttribute("class") || "").toLowerCase();
  return (
    cls.includes("tg-spoiler") ||
    cls.includes("spoiler") ||
    el.getAttribute("data-entity-type") === "MessageEntitySpoiler"
  );
}

function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  const href = raw.trim();
  if (!href) return null;
  const lower = href.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("tg://") ||
    lower.startsWith("mailto:")
  ) {
    return href.replace(/"/g, "%22");
  }
  return null;
}

/** Walk DOM (browser) or use regex fallback — browser path used from ops UI. */
export function htmlToTelegramHtml(rawHtml: string): string {
  const html = String(rawHtml || "").trim();
  if (!html) return "";

  if (typeof document === "undefined") {
    return serverSideStrip(html);
  }

  const root = document.createElement("div");
  root.innerHTML = html;
  const out: string[] = [];

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(escapeText(node.textContent || ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "br") {
      out.push("\n");
      return;
    }
    if (tag === "script" || tag === "style" || tag === "meta") return;

    if (BLOCK_TO_NL.has(tag) && out.length && !out[out.length - 1]!.endsWith("\n")) {
      out.push("\n");
    }

    let open = "";
    let close = "";
    if (tag === "b" || tag === "strong") {
      open = "<b>";
      close = "</b>";
    } else if (tag === "i" || tag === "em") {
      open = "<i>";
      close = "</i>";
    } else if (tag === "u" || tag === "ins") {
      open = "<u>";
      close = "</u>";
    } else if (tag === "s" || tag === "strike" || tag === "del") {
      open = "<s>";
      close = "</s>";
    } else if (tag === "code") {
      open = "<code>";
      close = "</code>";
    } else if (tag === "pre") {
      open = "<pre>";
      close = "</pre>";
    } else if (tag === "tg-spoiler" || (tag === "span" && isSpoilerSpan(el))) {
      open = "<tg-spoiler>";
      close = "</tg-spoiler>";
    } else if (tag === "a") {
      const href = safeHref(el.getAttribute("href"));
      if (href) {
        open = `<a href="${href}">`;
        close = "</a>";
      }
    }

    if (open) out.push(open);
    for (const child of Array.from(el.childNodes)) walk(child);
    if (close) out.push(close);

    if (BLOCK_TO_NL.has(tag)) out.push("\n");
  }

  for (const child of Array.from(root.childNodes)) walk(child);

  return out
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Plain text → escaped HTML (no tags). */
export function plainToTelegramHtml(text: string): string {
  return escapeText(String(text || "")).replace(/\r\n?/g, "\n");
}

/**
 * If the string already looks like Telegram HTML, keep & sanitize;
 * otherwise treat as plain and escape.
 */
export function normalizeBroadcastBody(raw: string): string {
  const s = String(raw || "");
  if (!s.trim()) return "";
  if (/<\/?[a-z]|<tg-spoiler/i.test(s)) {
    return htmlToTelegramHtml(s);
  }
  return plainToTelegramHtml(s);
}

function serverSideStrip(html: string): string {
  // Minimal server fallback: strip dangerous tags, keep known TG tags.
  let s = html.replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(div|p|li|h[1-6])>/gi, "\n");
  s = s.replace(/<(div|p|li|h[1-6])[^>]*>/gi, "");
  s = s.replace(/<strong>/gi, "<b>").replace(/<\/strong>/gi, "</b>");
  s = s.replace(/<em>/gi, "<i>").replace(/<\/em>/gi, "</i>");
  s = s.replace(/<ins>/gi, "<u>").replace(/<\/ins>/gi, "</u>");
  s = s.replace(/<(strike|del)>/gi, "<s>").replace(/<\/(strike|del)>/gi, "</s>");
  s = s.replace(
    /<span[^>]*class=["'][^"']*spoiler[^"']*["'][^>]*>/gi,
    "<tg-spoiler>",
  );
  // Closing spans that were spoilers are ambiguous; leave as-is then strip unknown.
  s = s.replace(/<\/span>/gi, "");
  s = s.replace(
    /<\/?(?!\/?(?:b|i|u|s|code|pre|a|tg-spoiler)\b)[a-z0-9-]+(?:\s[^>]*)?>/gi,
    "",
  );
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
