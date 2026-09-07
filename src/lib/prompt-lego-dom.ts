import {
  kindBlockClass,
  parseLegoQuerySpans,
  type LegoCatalogItem,
  type LegoKind,
  type LegoToken,
} from "@/lib/prompt-lego-core";

type TabToken = Extract<LegoToken, { type: "tab" }>;

export function domToLegoQuery(root: HTMLElement): string {
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent || "").replace(/\u200B/g, "");
    } else if (node instanceof HTMLElement) {
      if (node.dataset.legoTab) {
        out += node.dataset.legoTab;
      } else if (node.tagName === "BR") {
        out += "\n";
      } else {
        out += domToLegoQuery(node);
      }
    }
  }
  return out;
}

export function buildLegoChip(
  tab: TabToken,
  bracketValue: string,
  disabled?: boolean,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.legoTab = bracketValue;
  span.dataset.legoKind = tab.kind;
  span.className = `mx-0.5 inline-flex select-none items-center gap-1 rounded-lg border px-2 py-0.5 align-middle text-xs font-medium ${kindBlockClass(tab.kind)}`;

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.dataset.legoAction = "edit";
  editBtn.className = "opacity-70 hover:opacity-100";
  editBtn.title = "Сменить / редактировать";
  editBtn.textContent = "✎";
  editBtn.disabled = !!disabled;

  const label = document.createElement("span");
  label.dataset.legoLabel = "1";
  label.textContent = tab.label;
  if (tab.customText) label.title = tab.customText;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.dataset.legoAction = "remove";
  removeBtn.className = "ml-0.5 opacity-70 hover:opacity-100";
  removeBtn.setAttribute("aria-label", "Удалить");
  removeBtn.textContent = "×";
  removeBtn.disabled = !!disabled;

  span.append(editBtn, label, removeBtn);
  return span;
}

export function renderLegoQueryToDom(
  query: string,
  catalog: LegoCatalogItem[],
  disabled?: boolean,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const spans = parseLegoQuerySpans(query, catalog);
  for (const s of spans) {
    if (s.token.type === "text") {
      if (s.token.value) {
        frag.appendChild(document.createTextNode(s.token.value));
      }
    } else {
      frag.appendChild(
        buildLegoChip(s.token, query.slice(s.start, s.end), disabled),
      );
    }
  }
  return frag;
}

export function updateLegoChipElement(
  chip: HTMLElement,
  tab: TabToken,
  bracketValue: string,
) {
  chip.dataset.legoTab = bracketValue;
  chip.dataset.legoKind = tab.kind;
  chip.className = `mx-0.5 inline-flex select-none items-center gap-1 rounded-lg border px-2 py-0.5 align-middle text-xs font-medium ${kindBlockClass(tab.kind)}`;
  const label = chip.querySelector("[data-lego-label]");
  if (label) {
    label.textContent = tab.label;
    if (tab.customText) label.setAttribute("title", tab.customText);
    else label.removeAttribute("title");
  }
}

export function tabTokenFromBracket(
  bracket: string,
  catalog: LegoCatalogItem[],
): TabToken | null {
  const spans = parseLegoQuerySpans(bracket, catalog);
  const tok = spans[0]?.token;
  return tok?.type === "tab" ? tok : null;
}

export function insertNodeAtSelection(
  editor: HTMLElement,
  node: Node,
  trailingText?: Node,
) {
  const sel = window.getSelection();
  if (!sel) return;

  let range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  range.deleteContents();
  const frag = document.createDocumentFragment();
  frag.appendChild(node);
  if (trailingText) frag.appendChild(trailingText);
  range.insertNode(frag);

  const cursor = trailingText ?? node;
  range.setStartAfter(cursor);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function focusEditorEnd(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function isLegoKind(v: string): v is LegoKind {
  return [
    "pose",
    "lighting",
    "event",
    "stylization",
    "body",
    "character",
    "voiceover",
    "location",
    "action",
    "voice",
    "camera",
  ].includes(v);
}
