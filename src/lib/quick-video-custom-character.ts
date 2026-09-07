/** Ephemeral quick-video cast — refs only, no LoRA / DB character. */

export const CUSTOM_CHARACTER_PREFIX = "custom:";
export const MAX_CUSTOM_CHARACTER_REFS = 5;

export type QuickVideoCustomCharacter = {
  id: string;
  name: string;
};

export function isCustomCharacterId(id: string): boolean {
  return id.startsWith(CUSTOM_CHARACTER_PREFIX);
}

export function filterDbCharacterIds(ids: string[]): string[] {
  return ids.filter((id) => id && !isCustomCharacterId(id));
}

export function createCustomCharacterId(): string {
  return `${CUSTOM_CHARACTER_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeCustomCharacterName(raw: string): string {
  return raw.trim().slice(0, 40);
}

export function isValidCustomCharacterName(name: string): boolean {
  const n = normalizeCustomCharacterName(name);
  return n.length >= 2;
}
