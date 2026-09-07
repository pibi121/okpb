/**
 * Export pose-eval corrections for prompt rebuild (AI handoff).
 *   node scripts/export-pose-eval-corrections.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ratings = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "pose-eval-ratings.json"), "utf8"),
);
const b1 = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "pose-eval-prompts.json"), "utf8"),
);
const b2 = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "data", "pose-eval-prompts-batch2.json"),
    "utf8",
  ),
);
const poses = new Map([...b1.poses, ...b2.poses].map((p) => [p.id, p]));

const TAG_LABELS = {
  A_PENIS_REF: "Референс члена (Picture 4 / anatomy slot)",
  B_ORIFICE_SPLIT: "Разделить vaginal vs anal — две отдельные табы/brick",
  C_MOTION_ACTOR: "Кто двигается: HE_THRUSTS vs SHE_RIDES vs SHE_STROKE",
  D_MOTION_AMPLITUDE: "Амплитуда: видимый in/out, удар ног, полный ход",
  E_BODY_GEOMETRY: "Геометрия двух тел (ориентация, кто сзади)",
  F_HAND_ORAL_MOTION: "Движение рук/рта (handjob, oral, cunnilingus)",
  G_POSE_MISS: "Не попал в позу — переписать brick/ракурс",
  H_ANATOMY_GLITCH: "Артефакты: лишние конечности, пропавшая нога",
  I_WRONG_PHASE: "Неверная фаза сцены (прелюдия vs основной акт)",
  J_LORA: "Возможно нужна отдельная LoRA",
  Z_DUPLICATE_REJECT: "Дубликат — не включать в каталог",
  Z_HARD_REJECT: "Плохая поза — выкинуть из шаблонов",
};

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function analyze(pid, g) {
  const p = poses.get(pid);
  const notes = uniq(g.notes);
  const noteText = notes.join(" ");
  const tags = new Set();

  if (/не бер|повтор|плохая поза/i.test(noteText)) {
    tags.add(/повтор/i.test(noteText) ? "Z_DUPLICATE_REJECT" : "Z_HARD_REJECT");
  }
  if (/реф|член|хуя|вагин/i.test(noteText)) {
    if (/вагин|анал/i.test(noteText)) tags.add("B_ORIFICE_SPLIT");
    tags.add("A_PENIS_REF");
  }
  if (/амплитуд|вставл|выход|бились|глубоко/i.test(noteText)) {
    tags.add("D_MOTION_AMPLITUDE");
  }
  if (/насаж|он еб|она насаж|скач|водит|двига/i.test(noteText)) {
    tags.add("C_MOTION_ACTOR");
  }
  if (/жоп|склеил|повёрнут|конечност|пропала ног/i.test(noteText)) {
    tags.add("E_BODY_GEOMETRY");
  }
  if (/oral|рук|handjob|куни|лор/i.test(noteText)) {
    if (/лор/i.test(noteText)) tags.add("J_LORA");
    if (/рук|водит|oral|куни/i.test(noteText)) tags.add("F_HAND_ORAL_MOTION");
  }
  if (/не попал|вообще не/i.test(noteText)) tags.add("G_POSE_MISS");
  if (/прелюд/i.test(noteText)) tags.add("I_WRONG_PHASE");

  const scores = ["v1", "v2"].map((v) => {
    const r = g.clips[`${pid}_${v}`];
    if (!r) return null;
    return {
      variant: v,
      identity: r.identity,
      poseFit: r.poseFit,
      picture: r.picture,
      note: r.note || "",
    };
  }).filter(Boolean);

  const allGood =
    scores.length &&
    scores.every(
      (s) =>
        s.identity === "good" && s.poseFit === "good" && s.picture === "good",
    );

  let tier = "FIX";
  if (tags.has("Z_HARD_REJECT") || tags.has("Z_DUPLICATE_REJECT")) {
    tier = "REJECT";
  } else if (allGood && !notes.length && !tags.size) {
    tier = "OK";
  }

  return {
    id: pid,
    batch: pid.startsWith("pose2_") ? 2 : 1,
    title: p?.title || pid,
    tier,
    tags: [...tags],
    userNotes: notes,
    scores,
    currentBrick: p?.brick?.slice(0, 200) + (p?.brick?.length > 200 ? "…" : "") || "",
  };
}

const byPose = {};
for (const [clipId, r] of Object.entries(ratings.clips)) {
  const pid = clipId.replace(/_v[12]$/, "");
  if (!byPose[pid]) byPose[pid] = { clips: {}, notes: [], ratings: [] };
  byPose[pid].clips[clipId] = r;
  if (r.note) byPose[pid].notes.push(r.note);
  byPose[pid].ratings.push(r);
}

const all = Object.entries(byPose).map(([pid, g]) => analyze(pid, g));
const rejects = all.filter((x) => x.tier === "REJECT");
const fixes = all.filter((x) => x.tier === "FIX");
const ok = all.filter((x) => x.tier === "OK");

function expandCorrection(item) {
  const lines = [];
  const n = item.userNotes.join(" ").toLowerCase();

  if (item.tags.includes("A_PENIS_REF")) {
    lines.push(
      "Добавить <Picture 4> — референс члена (anatomy slot). В subject_definitions: «erect penis appearance reference — shaft shape, glans, skin tone, proportions». В кадре член должен совпадать с рефом, не генерироваться «с нуля».",
    );
  }
  if (item.tags.includes("B_ORIFICE_SPLIT")) {
    lines.push(
      "Сделать ДВЕ версии brick/body: *_vaginal и *_anal (или два таба). Явно: «penetration into vagina, labia visible» vs «anal penetration, anus visible». Negative: no anal / no vaginal для противоположной версии.",
    );
  }
  if (item.tags.includes("C_MOTION_ACTOR")) {
    lines.push(
      "Зафиксировать актора движения в brick: HE_THRUSTS (он активно двигает бёдрами, она/passive receiver) ИЛИ SHE_RIDES (она насаживается, он статичен). Не смешивать в одном промпте.",
    );
  }
  if (item.tags.includes("D_MOTION_AMPLITUDE")) {
    lines.push(
      "Прописать видимую амплитуду: shaft slides in and out along full stroke, hips drive forward-back, pelvis impact visible, not just bodies swaying while inserted.",
    );
  }
  if (item.tags.includes("E_BODY_GEOMETRY")) {
    lines.push(
      "Исправить ориентацию тел: he stands/kneels BEHIND her, both facing same direction, his pelvis to her back — NOT ass-to-ass, NOT facing each other with genitals between butts.",
    );
  }
  if (item.tags.includes("F_HAND_ORAL_MOTION")) {
    lines.push(
      "Акцент на движении: hand strokes full shaft length up-down; OR head bobs on cock; wrist/forearm motion readable in frame.",
    );
  }
  if (item.tags.includes("G_POSE_MISS")) {
    lines.push(
      "Модель не поняла позу — упростить brick, усилить ключевые якоря (camera angle, who is where), возможно добавить pose reference slot.",
    );
  }
  if (item.tags.includes("H_ANATOMY_GLITCH")) {
    lines.push("Negative: extra limbs, missing leg, fused bodies, malformed genitals.");
  }
  if (item.tags.includes("I_WRONG_PHASE")) {
    lines.push(
      "Зафиксировать фазу: foreplay/teasing (no full penetration rhythm) vs active intercourse — сейчас модель перескакивает.",
    );
  }
  if (item.tags.includes("J_LORA")) {
    lines.push("Рассмотреть отдельную LoRA под act (cunnilingus / HMPenis stack).");
  }
  if (item.tags.includes("Z_DUPLICATE_REJECT")) {
    lines.push("ИСКЛЮЧИТЬ: дубликат уже покрытой позы.");
  }
  if (item.tags.includes("Z_HARD_REJECT")) {
    lines.push("ИСКЛЮЧИТЬ: поза не работает на Ref2V 5s.");
  }

  if (/плохой вид хуя|плохой член|реф члена/i.test(n)) {
    lines.push("USER: член в кадре некачественный — нужен реф.");
  }
  if (/ебёт в анал.*вагин|вагин.*анал/i.test(n)) {
    lines.push("USER: сейчас попадает в анал вместо вагины (или наоборот) — разделить промпты.");
  }
  if (/насаж|он еб/i.test(n)) {
    lines.push("USER: в POV она сама насаживается — нужен режим «он ебёт/вставляет».");
  }
  if (/аплитуд|вставлял вперёд/i.test(n)) {
    lines.push("USER: нет видимого in/out — только «вставил и стоят».");
  }
  if (/жоп/i.test(n)) {
    lines.push("USER: склеились жопами, непонятно кто сзади.");
  }
  if (/водит рук/i.test(n)) {
    lines.push("USER: рука не водит по члену.");
  }
  if (/лишние конечност/i.test(n)) {
    lines.push("USER: лишние конечности в кадре.");
  }
  if (/прелюд/i.test(n)) {
    lines.push("USER: это прелюдия, а модель уже показывает скачку на члене.");
  }
  if (/лор/i.test(n)) {
    lines.push("USER: возможно нужна отдельная LoRA под куни.");
  }

  return uniq(lines);
}

const penisRefCandidates = fixes
  .filter(
    (f) =>
      f.tags.includes("A_PENIS_REF") &&
      /pov|oral|handjob|doggy|missionary|prone|mating|anvil|pressed|bended/i.test(
        f.id,
      ),
  )
  .map((f) => f.id);

const penisRefTest = [
  "pose2_01_pov",
  "pose2_12_doggy_pov",
  "pose_standing_oral",
];

let md = `# Pose eval — список коррекций для пересборки промптов

Сгенерировано: ${new Date().toISOString()}
Источник: \`data/pose-eval-ratings.json\`

## Сводка

| Категория | Поз |
|-----------|-----|
| OK (не трогать) | ${ok.length} |
| FIX (переписать промпт) | ${fixes.length} |
| REJECT (выкинуть) | ${rejects.length} |

## Легенда тегов коррекции

${Object.entries(TAG_LABELS)
  .map(([k, v]) => `- **${k}**: ${v}`)
  .join("\n")}

## A/B тест рефа члена (Picture 4)

Первый прогон batch 3 — только эти 3 POV-позы × 2 варианта:

| poseId | Зачем |
|--------|-------|
| \`pose2_01_pov\` | Missionary POV — член + anal/vaginal путаница |
| \`pose2_12_doggy_pov\` | Doggy POV — член + кто двигается |
| \`pose_standing_oral\` | Oral POV — член крупно в кадре |

Ref layout: Picture 1–3 = Daisy identity, **Picture 4 = penis anatomy ref** (\`data/refs/penis-reference.png\`).
В промпте: \`<Picture 4> is the erect penis anatomy reference (shaft, glans, proportions).\`

---

## REJECT — не включать в batch 3

`;

for (const item of rejects.sort((a, b) => a.id.localeCompare(b.id))) {
  md += `\n### ${item.id} — ${item.title}\n`;
  md += `- **Batch:** ${item.batch}\n`;
  if (item.userNotes.length) {
    md += `- **Комментарий:** ${item.userNotes.join(" | ")}\n`;
  }
  md += `- **Действие:** ${expandCorrection(item).join(" ")}\n`;
}

md += `\n---\n\n## FIX — переписать промпт (batch 3)\n\n`;

for (const item of fixes.sort((a, b) => a.id.localeCompare(b.id))) {
  md += `\n### ${item.id} — ${item.title}\n\n`;
  md += `- **Batch:** ${item.batch}\n`;
  md += `- **Теги:** ${item.tags.map((t) => TAG_LABELS[t] || t).join("; ") || "—"}\n`;
  md += `- **Оценки:**\n`;
  for (const s of item.scores) {
    md += `  - v${s.variant.replace("v", "")}: identity=${s.identity ?? "—"}, pose=${s.poseFit ?? "—"}, picture=${s.picture ?? "—"}${s.note ? ` — «${s.note}»` : ""}\n`;
  }
  if (item.userNotes.length) {
    md += `- **Твои комментарии (дословно):**\n`;
    for (const note of item.userNotes) {
      md += `  - ${note}\n`;
    }
  }
  md += `- **Что скорректировать в brick/body:**\n`;
  for (const line of expandCorrection(item)) {
    md += `  - ${line}\n`;
  }
  if (item.currentBrick) {
    md += `- **Текущий brick (начало):** ${item.currentBrick}\n`;
  }
  if (penisRefTest.includes(item.id)) {
    md += `- **Penis ref test:** ДА — включить Picture 4\n`;
  }
}

md += `\n---\n\n## OK — можно promote без переписывания (${ok.length})\n\n`;
md += ok.map((x) => `- \`${x.id}\` — ${x.title}`).join("\n");
md += "\n";

const outMd = path.join(ROOT, "data", "pose-eval-corrections-for-ai.md");
const outJson = path.join(ROOT, "data", "pose-eval-corrections-for-ai.json");
fs.writeFileSync(outMd, md, "utf8");
fs.writeFileSync(
  outJson,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      summary: { ok: ok.length, fix: fixes.length, reject: rejects.length },
      tagLabels: TAG_LABELS,
      penisRefTest: {
        poseIds: penisRefTest,
        refImagePath: "data/refs/penis-reference.png",
        slotLayout: {
          picture1: "Daisy identity",
          picture2: "Daisy identity",
          picture3: "Daisy identity",
          picture4: "Penis anatomy reference",
        },
      },
      rejects,
      fixes: fixes.map((f) => ({
        ...f,
        corrections: expandCorrection(f),
        penisRefTest: penisRefTest.includes(f.id),
      })),
      ok: ok.map((x) => ({ id: x.id, title: x.title })),
    },
    null,
    2,
  ),
  "utf8",
);

console.log("Wrote", outMd);
console.log("Wrote", outJson);
console.log({ ok: ok.length, fix: fixes.length, reject: rejects.length });
