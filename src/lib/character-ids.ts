export function resolveCharacterIds(opts: {
  characterId?: string | null;
  characterIds?: string[] | null;
}): string[] {
  const fromArr = (opts.characterIds || []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (fromArr.length) return [...new Set(fromArr)];
  if (opts.characterId) return [opts.characterId];
  return [];
}
