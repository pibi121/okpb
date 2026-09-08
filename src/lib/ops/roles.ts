export const OPS_ROLES = [
  "owner",
  "support",
  "content",
  "developer",
  "partner",
] as const;
export type OpsRole = (typeof OPS_ROLES)[number];

export const OPS_SECTIONS = [
  "dashboard",
  "users",
  "jobs",
  "errors",
  "queue",
  "load",
  "analytics",
  "inbox",
  "links",
  "copy",
  "notices",
  "broadcasts",
  "promos",
  "banners",
  "prices",
  "partners",
  "money",
  "bot",
  "team",
  "dev",
  "settings",
] as const;
export type OpsSection = (typeof OPS_SECTIONS)[number];

const ROLE_SECTIONS: Record<OpsRole, OpsSection[]> = {
  owner: [...OPS_SECTIONS],
  support: [
    "dashboard",
    "users",
    "jobs",
    "errors",
    "queue",
    "load",
    "analytics",
    "inbox",
  ],
  content: [
    "dashboard",
    "jobs",
    "analytics",
    "links",
    "copy",
    "notices",
    "broadcasts",
    "promos",
    "banners",
    "dev",
  ],
  developer: [
    "dashboard",
    "users",
    "jobs",
    "errors",
    "queue",
    "load",
    "analytics",
    "inbox",
    "copy",
    "notices",
    "promos",
    "banners",
    "bot",
    "dev",
    "settings",
  ],
  /** External partners: money/sales view, UTM links, user & per-link stats. */
  partner: ["dashboard", "money", "links", "analytics", "users"],
};

export function isOpsRole(v: string | null | undefined): v is OpsRole {
  return !!v && (OPS_ROLES as readonly string[]).includes(v);
}

export function canAccessSection(
  role: string | null | undefined,
  section: OpsSection,
): boolean {
  if (!isOpsRole(role)) return false;
  return ROLE_SECTIONS[role].includes(section);
}

export function sectionsFor(role: string | null | undefined): OpsSection[] {
  if (!isOpsRole(role)) return [];
  return ROLE_SECTIONS[role];
}

/** Partners may view money/users but not mutate expenses / staff / blocks. */
export function canWriteOps(
  role: string | null | undefined,
  section: OpsSection,
): boolean {
  if (!isOpsRole(role)) return false;
  if (role === "partner") {
    return section === "links";
  }
  return canAccessSection(role, section);
}

export function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Хозяин";
    case "support":
      return "Поддержка";
    case "content":
      return "Контент";
    case "developer":
      return "Разработка";
    case "partner":
      return "Партнёр";
    default:
      return role;
  }
}

export function labAccess(role: string | null | undefined): boolean {
  return role === "owner" || role === "developer" || role === "content";
}
