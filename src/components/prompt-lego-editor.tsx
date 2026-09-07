"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LEGO_PLUS_MENU,
  LEGO_VIDEO_EXTRAS,
  LEGO_VIDEO_PLUS_MENU,
  LEGO_VIDEO_SECTIONED_KINDS,
  analyzeLegoTokens,
  formatLegoTab,
  groupCatalogBySection,
  kindBlockClass,
  kindLabelRu,
  parseLegoQuery,
  type LegoCatalogItem,
  type LegoCharacterRef,
  type LegoKind,
} from "@/lib/prompt-lego-core";
import {
  buildLegoChip,
  domToLegoQuery,
  focusEditorEnd,
  insertNodeAtSelection,
  isLegoKind,
  renderLegoQueryToDom,
  tabTokenFromBracket,
  updateLegoChipElement,
} from "@/lib/prompt-lego-dom";
import { MAX_QUICK_VIDEO_PICTURES, LOCATION_SLOT_INDEX } from "@/lib/quick-video-prompt";

type Props = {
  catalog: LegoCatalogItem[];
  characters: LegoCharacterRef[];
  selectedIds: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  variant?: "photo" | "video";
  maxRefSlots?: number;
};

export function PromptLegoEditor({
  catalog,
  characters,
  selectedIds,
  value,
  onChange,
  disabled,
  variant = "photo",
  maxRefSlots = 9,
}: Props) {
  const isVideo = variant === "video";
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const skipExternalSync = useRef(false);

  const [focused, setFocused] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<LegoKind | null>(null);
  const [pickerSection, setPickerSection] = useState<string | null>(null);
  const [editChip, setEditChip] = useState<HTMLElement | null>(null);
  const [voiceoverOpen, setVoiceoverOpen] = useState(false);
  const [voiceoverDraft, setVoiceoverDraft] = useState("");
  const [voiceoverChip, setVoiceoverChip] = useState<HTMLElement | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationMode, setLocationMode] = useState<"text" | "ref">("text");
  const [locationDraft, setLocationDraft] = useState("");
  const [locationSlot, setLocationSlot] = useState(4);
  const [locationChip, setLocationChip] = useState<HTMLElement | null>(null);

  const liveCatalog = useMemo(() => {
    const nonChar = catalog.filter((c) => c.kind !== "character");
    const selected = characters.filter((c) => selectedIds.includes(c.id));
    const chars: LegoCatalogItem[] = selected.map((c) => ({
      id: c.id,
      label: c.name,
      kind: "character",
      aliases: [c.name, c.triggerWord || ""].filter(Boolean) as string[],
    }));
    return [...chars, ...nonChar];
  }, [catalog, characters, selectedIds]);

  const preview = useMemo(() => {
    const tokens = parseLegoQuery(value, liveCatalog);
    return analyzeLegoTokens(tokens, characters, liveCatalog);
  }, [value, liveCatalog, characters]);

  const syncDomFromQuery = useCallback(
    (query: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.innerHTML = "";
      const frag = renderLegoQueryToDom(query, liveCatalog, disabled);
      editor.appendChild(frag);
    },
    [liveCatalog, disabled],
  );

  const emitFromDom = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = domToLegoQuery(editor);
    skipExternalSync.current = true;
    lastEmitted.current = next;
    onChange(next);
  }, [onChange]);

  useEffect(() => {
    if (skipExternalSync.current) {
      skipExternalSync.current = false;
      return;
    }
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    syncDomFromQuery(value);
  }, [value, syncDomFromQuery]);

  useEffect(() => {
    syncDomFromQuery(value);
    lastEmitted.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  function insertBracketSnippet(bracket: string) {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    const tab = tabTokenFromBracket(bracket, liveCatalog);
    if (!tab) return;

    editor.focus();
    const chip = buildLegoChip(tab, bracket, disabled);
    const spacer = document.createTextNode("\u200B");
    insertNodeAtSelection(editor, chip, spacer);
    emitFromDom();
    setPlusOpen(false);
    setPickerKind(null);
  }

  function insertTab(item: LegoCatalogItem) {
    insertBracketSnippet(formatLegoTab(item.label));
  }

  function applyChipBracket(chip: HTMLElement, bracket: string) {
    const tab = tabTokenFromBracket(bracket, liveCatalog);
    if (!tab) return;
    updateLegoChipElement(chip, tab, bracket);
    emitFromDom();
  }

  function openVoiceoverModal(chip: HTMLElement | null, existing?: string) {
    setVoiceoverChip(chip);
    setVoiceoverDraft(existing || "");
    setVoiceoverOpen(true);
    setEditChip(null);
  }

  function saveVoiceover() {
    const text = voiceoverDraft.trim();
    if (!text) {
      setVoiceoverOpen(false);
      return;
    }
    const bracket = formatLegoTab(`voiceover:${text}`);
    if (voiceoverChip) {
      applyChipBracket(voiceoverChip, bracket);
    } else {
      insertBracketSnippet(bracket);
    }
    setVoiceoverOpen(false);
    setVoiceoverDraft("");
    setVoiceoverChip(null);
  }

  function openLocationModal(chip: HTMLElement | null, kind?: string, customText?: string) {
    setLocationChip(chip);
    if (kind === "location" && chip?.dataset.legoTab?.includes("location-ref:")) {
      const m = chip.dataset.legoTab.match(/location-ref:(\d+)/);
      setLocationMode("ref");
      setLocationSlot(m ? Number(m[1]) : LOCATION_SLOT_INDEX);
      setLocationDraft("");
    } else {
      setLocationMode("text");
      setLocationDraft(customText || "");
      setLocationSlot(LOCATION_SLOT_INDEX);
    }
    setLocationOpen(true);
    setEditChip(null);
  }

  function saveLocation() {
    let bracket: string;
    if (locationMode === "ref") {
      bracket = formatLegoTab(`location-ref:${locationSlot}`);
    } else {
      const text = locationDraft.trim();
      if (!text) {
        setLocationOpen(false);
        return;
      }
      bracket = formatLegoTab(`location:${text}`);
    }
    if (locationChip) {
      applyChipBracket(locationChip, bracket);
    } else {
      insertBracketSnippet(bracket);
    }
    setLocationOpen(false);
    setLocationDraft("");
    setLocationChip(null);
  }

  function handleEditorInput() {
    emitFromDom();
  }

  function handleEditorPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    emitFromDom();
  }

  function handleEditorClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const action = target.closest("[data-lego-action]") as HTMLElement | null;
    const chip = target.closest("[data-lego-tab]") as HTMLElement | null;
    if (!action || !chip) return;

    e.preventDefault();
    e.stopPropagation();

    const act = action.dataset.legoAction;
    if (act === "remove") {
      chip.remove();
      emitFromDom();
      if (editChip === chip) setEditChip(null);
      return;
    }

    if (act === "edit") {
      const kind = chip.dataset.legoKind;
      const bracket = chip.dataset.legoTab || "";
      const label = chip.querySelector("[data-lego-label]")?.textContent || "";

      if (kind === "voiceover") {
        const inner = bracket.match(/^\[voiceover:(.*)\]$/)?.[1] || label;
        openVoiceoverModal(chip, inner);
        return;
      }
      if (kind === "location") {
        const inner = bracket.match(/^\[location:(.*)\]$/)?.[1] || label;
        openLocationModal(chip, kind, inner);
        return;
      }
      setEditChip(editChip === chip ? null : chip);
    }
  }

  const editKind =
    editChip?.dataset.legoKind && isLegoKind(editChip.dataset.legoKind)
      ? editChip.dataset.legoKind
      : null;

  const plusMenu = isVideo ? LEGO_VIDEO_PLUS_MENU : LEGO_PLUS_MENU;

  const pickerItems = pickerKind
    ? liveCatalog.filter((c) => c.kind === pickerKind)
    : [];

  const pickerGroups =
    isVideo && pickerKind && LEGO_VIDEO_SECTIONED_KINDS.includes(pickerKind)
      ? groupCatalogBySection(liveCatalog, pickerKind)
      : null;

  const activeSectionGroup = pickerSection
    ? pickerGroups?.find((g) => g.section === pickerSection)
    : null;

  function closePicker() {
    setPlusOpen(false);
    setPickerKind(null);
    setPickerSection(null);
  }

  function pickerBack() {
    if (pickerSection) {
      setPickerSection(null);
      return;
    }
    setPickerKind(null);
  }

  const showPlaceholder = !value && !focused;

  return (
    <div className="flex flex-col gap-3">
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {characters
            .filter((c) => selectedIds.includes(c.id))
            .map((c) => {
              const item = liveCatalog.find(
                (x) => x.id === c.id && x.kind === "character",
              );
              if (!item) return null;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    editorRef.current?.focus();
                    insertTab(item);
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${kindBlockClass("character")}`}
                >
                  + {c.name}
                </button>
              );
            })}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          Сначала выбери персонажа — появятся быстрые блоки.
        </p>
      )}

      <div className="relative rounded-xl border border-white/10 bg-[#0c0c0e] p-3">
        {showPlaceholder ? (
          <p className="pointer-events-none absolute left-3 top-3 text-sm text-zinc-600">
            Пиши текст и добавляй блоки через + — они встанут прямо в строку
          </p>
        ) : null}

        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleEditorInput}
          onPaste={handleEditorPaste}
          onClick={handleEditorClick}
          onFocus={() => {
            setFocused(true);
            const editor = editorRef.current;
            if (editor && editor.childNodes.length === 0) {
              focusEditorEnd(editor);
            }
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              document.execCommand("insertLineBreak");
              emitFromDom();
            }
          }}
          className="min-h-[5rem] w-full pb-10 pr-12 text-sm leading-loose text-foreground outline-none"
        />

        {editChip && editKind && editKind !== "voiceover" && editKind !== "location" ? (
          <div className="relative z-30 mt-2 max-h-48 overflow-auto rounded-lg border border-white/15 bg-[#161618] py-1 shadow-xl">
            <p className="px-2 py-1 text-[10px] uppercase text-zinc-500">
              {kindLabelRu(editKind)}
            </p>
            {isVideo && pickerKind && LEGO_VIDEO_SECTIONED_KINDS.includes(pickerKind)
              ? groupCatalogBySection(liveCatalog, pickerKind).map((group) => (
                  <div key={group.section}>
                    <p className="px-2 py-1 text-[10px] font-medium text-zinc-400">
                      {group.label}
                    </p>
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-xs hover:bg-white/5"
                        onClick={() => {
                          if (editChip) {
                            applyChipBracket(editChip, formatLegoTab(item.label));
                          }
                          setEditChip(null);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))
              : liveCatalog
                  .filter((c) => c.kind === editKind)
                  .slice(0, 40)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-white/5"
                      onClick={() => {
                        if (editChip) {
                          applyChipBracket(editChip, formatLegoTab(item.label));
                        }
                        setEditChip(null);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
          </div>
        ) : null}

        <div className="absolute bottom-3 right-3">
          <div className="relative inline-flex shrink-0">
            <button
              type="button"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!disabled) {
                  editorRef.current?.focus();
                  if (!window.getSelection()?.rangeCount) {
                    focusEditorEnd(editorRef.current!);
                  }
                }
                setPlusOpen((v) => !v);
                setPickerKind(null);
                setPickerSection(null);
                setEditChip(null);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-[#0c0c0e] text-lg text-zinc-400 hover:border-peach/40 hover:text-peach disabled:opacity-50"
              aria-label="Добавить блок"
            >
              +
            </button>
            {plusOpen && !pickerKind ? (
              <div className="absolute bottom-full right-0 z-20 mb-1 w-56 rounded-lg border border-white/15 bg-[#161618] py-1 shadow-xl">
                {plusMenu.map((m) => (
                  <button
                    key={m.kind}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                    onClick={() => setPickerKind(m.kind)}
                  >
                    {m.label}
                  </button>
                ))}
                {isVideo
                  ? LEGO_VIDEO_EXTRAS.map((m) => (
                      <button
                        key={m.kind}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                        onClick={() => {
                          setPlusOpen(false);
                          openLocationModal(null);
                        }}
                      >
                        {m.label}
                      </button>
                    ))
                  : null}
              </div>
            ) : null}
            {pickerKind ? (
              <div className="absolute bottom-full right-0 z-20 mb-1 max-h-72 w-72 overflow-auto rounded-lg border border-white/15 bg-[#161618] py-1 shadow-xl">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-white/5"
                  onClick={() => pickerBack()}
                >
                  ← назад
                </button>
                {pickerGroups && !pickerSection
                  ? pickerGroups.map((group) => (
                      <button
                        key={group.section}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5"
                        onClick={() => setPickerSection(group.section)}
                      >
                        <span>{group.label}</span>
                        <span className="text-xs text-zinc-500">{group.items.length}</span>
                      </button>
                    ))
                  : null}
                {activeSectionGroup ? (
                  <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    {activeSectionGroup.label}
                  </p>
                ) : null}
                {activeSectionGroup
                  ? activeSectionGroup.items.map((item) => (
                      <button
                        key={`${item.kind}:${item.id}`}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                        onClick={() => {
                          insertTab(item);
                          closePicker();
                        }}
                      >
                        {item.label}
                      </button>
                    ))
                  : null}
                {!pickerGroups
                  ? pickerItems.map((item) => (
                      <button
                        key={`${item.kind}:${item.id}`}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                        onClick={() => {
                          insertTab(item);
                          closePicker();
                        }}
                      >
                        {item.label}
                      </button>
                    ))
                  : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {preview.scene ? (
        <p className="line-clamp-3 text-[11px] leading-relaxed text-zinc-600">
          {preview.scene}
        </p>
      ) : null}

      {isVideo && voiceoverOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161618] p-4 shadow-xl">
            <h3 className="font-medium">Add voiceover</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Кто что говорит, какие фразы — свободная форма.
            </p>
            <textarea
              autoFocus
              value={voiceoverDraft}
              onChange={(e) => setVoiceoverDraft(e.target.value)}
              rows={5}
              className="mt-3 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm outline-none focus:border-peach/40"
              placeholder="She whispers: … He says: …"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
                onClick={() => setVoiceoverOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="rounded-full bg-peach px-4 py-1.5 text-sm font-medium text-black"
                onClick={saveVoiceover}
              >
                {voiceoverChip ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isVideo && locationOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161618] p-4 shadow-xl">
            <h3 className="font-medium">Add location</h3>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${locationMode === "text" ? "border-peach bg-peach/15 text-peach" : "border-white/15"}`}
                onClick={() => setLocationMode("text")}
              >
                Текстом
              </button>
              <button
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${locationMode === "ref" ? "border-peach bg-peach/15 text-peach" : "border-white/15"}`}
                onClick={() => setLocationMode("ref")}
              >
                Location from reference
              </button>
            </div>
            {locationMode === "text" ? (
              <textarea
                autoFocus
                value={locationDraft}
                onChange={(e) => setLocationDraft(e.target.value)}
                rows={4}
                className="mt-3 w-full rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm outline-none focus:border-peach/40"
                placeholder="Luxury hotel room at night, warm lamp light…"
              />
            ) : (
              <label className="mt-3 flex flex-col gap-1 text-sm">
                <span className="text-xs text-zinc-500">Слот с референсом локации</span>
                <select
                  value={locationSlot}
                  onChange={(e) => setLocationSlot(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-[#0c0c0e] px-3 py-2 text-sm"
                >
                  {Array.from(
                    { length: Math.min(maxRefSlots, MAX_QUICK_VIDEO_PICTURES) },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <option key={n} value={n}>
                      Picture {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border border-white/15 px-4 py-1.5 text-sm"
                onClick={() => setLocationOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="rounded-full bg-peach px-4 py-1.5 text-sm font-medium text-black"
                onClick={saveLocation}
              >
                {locationChip ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
