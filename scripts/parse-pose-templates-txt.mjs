/**
 * Parse Шаблоны_поз_недостающие.txt → pose-eval-prompts-batch2.json
 *   node scripts/parse-pose-templates-txt.mjs [path]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPath = process.env.POSE_TEMPLATES_TXT || "";
if (!process.argv[2] && !defaultPath) {
  console.error("Usage: node scripts/parse-pose-templates-txt.mjs <path-to-txt>");
  process.exit(1);
}

const src = process.argv[2] || defaultPath;
const raw = fs.readFileSync(src, "utf8");

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

const sections = raw.split(/={10,}/).map((s) => s.trim()).filter(Boolean);
const poses = [];

for (const sec of sections) {
  const titleMatch = sec.match(/^#(\d+)\.\s*(.+)$/m);
  if (!titleMatch) continue;
  const num = Number(titleMatch[1]);
  const title = titleMatch[2].trim();

  const bodyStart = sec.indexOf("For the target video");
  const brickIdx = sec.indexOf("Кирпичик:");
  if (bodyStart < 0 || brickIdx < 0) {
    console.warn("skip section", num, "missing body/brick");
    continue;
  }

  let body = sec.slice(bodyStart, brickIdx).trim();
  const brick = sec
    .slice(brickIdx + "Кирпичик:".length)
    .trim()
    .split(/\n\n/)[0]
    .trim();

  // body = intro line + integrated + soundscape + music (strip Russian notes before brick)
  const ruNoteIdx = body.search(/\nВ данном промпте зашито:/);
  if (ruNoteIdx >= 0) body = body.slice(0, ruNoteIdx).trim();

  const id = `pose2_${String(num).padStart(2, "0")}_${slug(title)}`;

  poses.push({ id, title, brick, body });
}

const out = {
  version: 2,
  batchLabel: "batch2-missing-poses",
  durationSec: 5,
  orientation: "9_16",
  refSourceRunId: "cmtbsa9330009v940q41iepmj",
  characterName: "Daisy Shtorm",
  characterId: "cmt60hqyt0009v9t4eouy3ij0",
  poses,
};

const dest = path.join(ROOT, "data", "pose-eval-prompts-batch2.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2), "utf8");
console.log(`written ${poses.length} poses → ${dest}`);
