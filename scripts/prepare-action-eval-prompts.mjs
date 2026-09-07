/**
 * Enrich action-eval-prompts with Russian eval hints for review UI.
 *   node scripts/prepare-action-eval-prompts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data", "action-eval-prompts-v1.json");
const DEST = path.join(ROOT, "data", "action-eval-prompts-batch1.json");

const CATEGORY_HINT_RU = {
  intro:
    "Смотри: intro — без секса. Действие (стук, вход, жест) должно быть читаемо за 5 сек.",
  transition:
    "Смотри: переход — смена положения/расстояния. Движение плавное, без телепорта.",
  strip:
    "Смотри: раздевание — одежда/бельё снимается или отодвигается по смыслу brick.",
  sex_event:
    "Смотри: sex event — конкретный момент (вход, темп, финиш). Не заменяй на другую фазу.",
  movement:
    "Смотри: перемещение по пространству — ходьба/ползание/смена позы на поверхности.",
  contact:
    "Смотри: телесный контакт без полного акта — поцелуй, объятие, ласка.",
  reaction:
    "Смотри: реакция лица/жеста — взгляд в камеру, стон лица, улыбка.",
  outro:
    "Смотри: outro/afterglow — успокоение, без нового интенсивного секса.",
};

function actionHint(action) {
  const cat = CATEGORY_HINT_RU[action.category] || "Смотри: действие должно совпадать с описанием brick.";
  return `Что проверяем: ДЕЙСТВИЕ — ${action.title} (${action.category}).\nНа что смотреть: ${cat}\nIdentity Daisy должна сохраняться. Локация generic — ок.`;
}

const src = JSON.parse(fs.readFileSync(SRC, "utf8"));
const items = src.actions.map((a) => ({
  id: a.id,
  title: a.title,
  category: a.category,
  brick: a.brick,
  body: a.body,
  picture4Penis: Boolean(a.picture4Penis),
  evalType: "action",
  evalHintRu: actionHint(a),
  bricks: [
    {
      category: "action",
      categoryLabelRu: "Действие",
      id: a.id,
      title: a.title,
    },
  ],
  ratingCategories: [{ key: "actionFit", labelRu: "Попадание: действие" }],
}));

const out = {
  version: 1,
  batchLabel: "actions-v1-all-61",
  durationSec: 5,
  orientation: "9_16",
  refSourceRunId: "cmtbsa9330009v940q41iepmj",
  characterName: "Daisy Shtorm",
  characterId: "cmt60hqyt0009v9t4eouy3ij0",
  penisRefPath: "data/refs/penis-reference.png",
  evalType: "action",
  meta: {
    count: items.length,
    variantsPerItem: 2,
    totalClipsExpected: items.length * 2,
    categories: src.meta?.categories,
  },
  items,
};

fs.writeFileSync(DEST, JSON.stringify(out, null, 2), "utf8");
console.log(`Wrote ${DEST}: ${items.length} actions`);
