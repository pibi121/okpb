/** Callback data prefix for funnel v2. Keep short (TG limit 64 bytes). */
export const FV2 = {
  rulesOk: "fv2:rules",
  photo: "fv2:ph",
  video: "fv2:vid",
  pro: "fv2:pro",
  topup: "fv2:tu",
  /** Topup opened from blur result — after pay → hub */
  topupFromBlur: "fv2:tu:blur",
  earn: "fv2:earn",
  help: "fv2:help",
  hub: "fv2:hub",
  /** Faststart: pick pose templates */
  fsPose: "fv2:fs:pose",
  /** Faststart: later → hub */
  fsLater: "fv2:fs:later",
  /** After blur: unlock full photo (sets unblur intent → topup) */
  unblur: (itemId: string) => `fv2:ub:${itemId}`,
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
