/**
 * Notify ops Telegram «Деплои» about a commit or prod deploy.
 *
 *   node scripts/ops-notify-release.mjs --kind commit
 *   node scripts/ops-notify-release.mjs --kind deploy
 *   node scripts/ops-notify-release.mjs --kind commit --force
 *
 * Reads git HEAD + subject, writes infra/release-meta.json (for Railway boot),
 * then POSTs to production /api/ops/release-notify (or uses local OPS_TG_*).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function git(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

/** Pull OPS_TG_* from Railway if missing locally. */
function hydrateOpsEnvFromRailway() {
  if (process.env.OPS_TG_BOT_TOKEN && process.env.OPS_TG_CHAT_ID) return;
  try {
    const raw = execSync("railway variables --json", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const j = JSON.parse(raw);
    for (const k of [
      "OPS_TG_BOT_TOKEN",
      "OPS_TG_CHAT_ID",
      "OPS_TG_TOPIC_DEPLOYS",
      "OPS_RELEASE_NOTIFY_SECRET",
      "TELEGRAM_BOT_TOKEN",
    ]) {
      if (!process.env[k] && j[k]) process.env[k] = String(j[k]);
    }
  } catch {
    /* optional */
  }
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendViaTelegramApi(payload) {
  const token =
    process.env.OPS_TG_BOT_TOKEN?.trim() ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    "";
  const chatId = (process.env.OPS_TG_CHAT_ID || "").trim();
  if (!token || !chatId) {
    throw new Error("Need OPS_TG_BOT_TOKEN + OPS_TG_CHAT_ID (or call prod API)");
  }

  let threadId = Number(process.env.OPS_TG_TOPIC_DEPLOYS || 0) || 0;
  const statePath = path.join(ROOT, "data", "ops-telegram.json");
  if (!threadId && fs.existsSync(statePath)) {
    try {
      const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
      threadId = Number(st?.topics?.deploys || 0) || 0;
    } catch {
      /* ignore */
    }
  }

  const kind = payload.kind === "deploy" ? "deploy" : "commit";
  const title =
    kind === "deploy" ? "🚀 <b>Деплой на прод</b>" : "📦 <b>Коммит в main</b>";
  const sha = escHtml(String(payload.sha || "").slice(0, 7));
  const when = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(payload.at || Date.now()));

  const text = [
    title,
    `Коммит: <code>${sha}</code>`,
    payload.buildVersion
      ? `Версия: <code>${escHtml(payload.buildVersion)}</code>`
      : "",
    payload.branch ? `Ветка: ${escHtml(payload.branch)}` : "",
    `Изменения: ${escHtml((payload.message || "—").slice(0, 500))}`,
    `${when} МСК`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(threadId ? { message_thread_id: threadId } : {}),
  };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.description || `telegram HTTP ${res.status}`);
  }
  return { sent: true, via: "telegram-api" };
}

async function sendViaProdApi(payload) {
  const secret = process.env.OPS_RELEASE_NOTIFY_SECRET?.trim();
  const base = (
    process.env.OPS_RELEASE_NOTIFY_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://bot-production-c305.up.railway.app"
  ).replace(/\/$/, "");
  if (!secret) return null;
  const res = await fetch(`${base}/api/ops/release-notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `API HTTP ${res.status}`);
  }
  return json;
}

async function main() {
  loadDotEnv();
  hydrateOpsEnvFromRailway();
  const kind = (arg("--kind") || "commit").toLowerCase();
  if (kind !== "commit" && kind !== "deploy") {
    console.error("Usage: --kind commit|deploy [--force]");
    process.exit(1);
  }
  const force = hasFlag("--force");
  const sha = arg("--sha") || git("git rev-parse HEAD");
  const message =
    arg("--message") || git("git log -1 --pretty=%s");
  const branch =
    arg("--branch") || git("git rev-parse --abbrev-ref HEAD");
  const buildVersion =
    arg("--build") || process.env.BUILD_VERSION || "tg-ready-v50-ops-harden";
  const at = new Date().toISOString();

  const meta = { sha, message, buildVersion, branch, at };
  const metaPath = path.join(ROOT, "infra", "release-meta.json");
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  console.log(`[ops-release] wrote ${metaPath}`);
  console.log(
    "[ops-release] deploy with: railway up --detach --no-gitignore  (so release-meta is uploaded; .railwayignore still blocks secrets)",
  );

  const payload = { kind, ...meta, force };
  let result;
  try {
    result = await sendViaProdApi(payload);
  } catch (e) {
    console.warn("[ops-release] prod API failed:", e.message || e);
  }
  if (!result) {
    result = await sendViaTelegramApi(payload);
  }
  console.log("[ops-release]", result);
}

main().catch((e) => {
  console.error("[ops-release]", e.message || e);
  process.exit(1);
});
