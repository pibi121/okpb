import { randomBytes } from "crypto";

const OPS_LOCAL_DOMAIN = "ops.local";

/** Normalize ops login: bare username → user@ops.local; emails stay emails. */
export function normalizeOpsLogin(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@")) return s;
  const login = s.replace(/[^a-z0-9._-]/g, "").slice(0, 32);
  if (!login) return "";
  return `${login}@${OPS_LOCAL_DOMAIN}`;
}

export function opsLoginFromEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (e.endsWith(`@${OPS_LOCAL_DOMAIN}`)) {
    return e.slice(0, -(OPS_LOCAL_DOMAIN.length + 1));
  }
  return e;
}

export function generateOpsCredentials(): { login: string; email: string; password: string } {
  const login = `p_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(9).toString("base64url").slice(0, 14);
  return {
    login,
    email: `${login}@${OPS_LOCAL_DOMAIN}`,
    password,
  };
}

export function isOpsLocalAccount(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${OPS_LOCAL_DOMAIN}`);
}
