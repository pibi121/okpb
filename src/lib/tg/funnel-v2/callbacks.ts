/** Callback data prefix for funnel v2. Keep short (TG limit 64 bytes). */
export const FV2 = {
  rulesOk: "fv2:rules",
  photo: "fv2:ph",
  video: "fv2:vid",
  pro: "fv2:pro",
  topup: "fv2:tu",
  earn: "fv2:earn",
  help: "fv2:help",
  hub: "fv2:hub",
  /** Photo: undress full */
  phUndress: "fv2:ph:ud",
  /** Photo: template page */
  phPage: (p: number) => `fv2:ph:p:${p}`,
  /** Photo: pick template id */
  phTpl: (id: string) => `fv2:ph:t:${id}`,
  phChange: "fv2:ph:chg",
  phConfirm: (kind: string, id: string) => `fv2:ph:ok:${kind}:${id}`,
  phCancel: "fv2:ph:x",
  /** After result */
  phEdit: (itemId: string) => `fv2:ph:ed:${itemId}`,
  phAnim: (itemId: string) => `fv2:ph:an:${itemId}`,
  phAgain: "fv2:ph",
  videoPage: (p: number) => `fv2:vid:p:${p}`,
  earnLinks: "fv2:earn:links",
  earnNew: "fv2:earn:new",
} as const;

export function isFunnelV2Callback(data: string): boolean {
  return data.startsWith("fv2:");
}
