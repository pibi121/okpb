/**
 * Pack rated pose/action/voice/camera bricks into presets/prompt_lego_video.json
 *
 *   node scripts/pack-video-lego-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REJECT_NOTE = /не\s*бер|не\s*будем|пока\s*не\s*бер/i;

const ACTION_SECTION_LABELS = {
  intro: "Вступление",
  transition: "Переход",
  strip: "Раздевание",
  sex_event: "Секс-события",
  movement: "Движение",
  contact: "Контакт",
  reaction: "Реакция",
  outro: "Финал",
};

const VOICE_SECTION_LABELS = {
  female_nonverbal: "Она · невербально",
  male_nonverbal: "Он · невербально",
  duet: "Дуэт",
  en_lines: "EN фразы",
};

const CAMERA_SECTION_LABELS = {
  reveal: "Reveal · слайд по телу",
  accent: "Accent · push-in",
  follow: "Follow · следование",
  orbit: "Orbit · дуга",
  vertical: "Vertical · кран",
  depth: "Depth · глубина",
  story: "Story · два beat",
  anchor: "Anchor · финиш-кадр",
  pov_mode: "POV режимы",
  rhythm: "Rhythm · ритм",
};

const POSE_SECTION_LABELS = {
  missionary: "Missionary",
  rear: "Doggy / rear",
  cowgirl: "Cowgirl / сверху",
  spooning: "Spooning",
  oral: "Oral",
  manual: "Handjob / titjob / footjob",
  standing: "Standing / edge / lift",
  kiss: "Поцелуи / объятия",
  other: "Другие",
};

function stripEvalPromptMeta(prompt) {
  let p = prompt.trim();
  p = p.replace(/\n\nВ данном промпте зашито:[\s\S]*?(?=\n\n[A-Za-z<]|$)/g, "");
  p = p.replace(/\n\nКирpичик:\r?\n[\s\S]*?(?=\n\n[A-Za-z<]|$)/g, "");
  p = p.replace(/\n\nКирpичик:\r?\n[\s\S]*$/g, "");
  return p.trim();
}

function itemClips(ratings, itemId) {
  const clips = ratings.clips || {};
  return [clips[`${itemId}_v1`], clips[`${itemId}_v2`]].filter(Boolean);
}

function shouldKeepAction(ratings, id) {
  const entries = itemClips(ratings, id);
  if (!entries.length) return false;
  for (const v of entries) {
    const n = (v.note || "").trim();
    if (REJECT_NOTE.test(n) && !/поз/i.test(n)) return false;
    if (v.actionFit === "bad") return false;
  }
  return entries.some((v) => {
    const n = (v.note || "").trim();
    if (REJECT_NOTE.test(n) && !/поз/i.test(n)) return false;
    return v.actionFit === "good" || v.actionFit === "mid" || v.identity === "good";
  });
}

function shouldKeepPose(ratings, id) {
  const entries = itemClips(ratings, id);
  if (!entries.length) return false;
  for (const v of entries) {
    const n = (v.note || "").trim();
    if (REJECT_NOTE.test(n) && !/поз/i.test(n)) return false;
    if (v.poseFit === "bad") return false;
  }
  const good = entries.some((v) => v.poseFit === "good" || v.poseFit === "mid");
  if (good) return true;
  const skipOnly = entries.every((v) => {
    const n = (v.note || "").trim();
    return !v.poseFit && (!n || REJECT_NOTE.test(n));
  });
  if (skipOnly) return false;
  return entries.some((v) => v.identity === "good" && !REJECT_NOTE.test(v.note || ""));
}

function shouldKeepCombo(ratings, itemId) {
  const entries = itemClips(ratings, itemId);
  if (!entries.length) return false;
  for (const v of entries) {
    const n = (v.note || "").trim();
    if (REJECT_NOTE.test(n) && !/поз/i.test(n)) return false;
    if (v.addonFit === "bad") return false;
  }
  if (entries.some((v) => v.addonFit === "good" || v.addonFit === "mid")) return true;
  if (
    entries.every((v) => {
      const n = (v.note || "").trim();
      return !v.addonFit && (!n || /поз/i.test(n));
    })
  ) {
    return false;
  }
  return entries.some((v) => v.identity === "good" || v.baseFit === "good");
}

function inferPoseSection(pose) {
  const s = `${pose.id} ${pose.title || ""}`.toLowerCase();
  if (/kiss|embrace|поцел|объят/i.test(s)) return "kiss";
  if (/oral|deepthroat|cunnilingus|минет|blow/i.test(s)) return "oral";
  if (/handjob|titjob|paizuri|footjob|рук|груд|foot/i.test(s)) return "manual";
  if (/cowgirl|reverse_cowgirl|squatting|kneeling_cowgirl|amazon|lap_ride|lap ride/i.test(s))
    return "cowgirl";
  if (
    /doggy|prone|rear|wall_rear|froggy|face_down|leapfrog|side_doggy|отвёрн|all.fours/i.test(s)
  )
    return "rear";
  if (/spoon/i.test(s)) return "spooning";
  if (/missionary|mating_press|fold_over|pressed_legs|anvil|bended|миссионер|ноги на плеч/i.test(s))
    return "missionary";
  if (/standing|table|counter|butterfly|lifted|suspended|face_to_face|wall/i.test(s))
    return "standing";
  return "other";
}

function loadPoseMap() {
  const map = new Map();
  const files = [
    "pose-eval-prompts-batch5.json",
    "pose-eval-prompts-batch4.json",
    "pose-eval-prompts-batch3-picture4-test.json",
    "pose-eval-prompts-batch2.json",
    "pose-eval-prompts.json",
  ];
  for (const f of files) {
    const p = path.join(ROOT, "data", f);
    if (!fs.existsSync(p)) continue;
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const pose of doc.poses || []) {
      if (!map.has(pose.id)) map.set(pose.id, pose);
    }
  }
  return map;
}

function toCatalogItem(src, section, sectionLabel) {
  return {
    id: src.id,
    label: src.title,
    section,
    sectionLabel,
    aliases: [src.title, src.id.replace(/_/g, " ")],
    text: src.brick,
    body: stripEvalPromptMeta(src.body || src.brick),
    picture4Penis: Boolean(src.picture4Penis),
    videoMotion: src.videoMotion || undefined,
  };
}

function main() {
  const ratings = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "pose-eval-ratings.json"), "utf8"),
  );
  const actionsDoc = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "action-eval-prompts-v1.json"), "utf8"),
  );
  const voicesDoc = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "voice-tabs-prompts-v1.json"), "utf8"),
  );
  const camerasDoc = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "camera-tabs-prompts-v1.json"), "utf8"),
  );
  const poseMap = loadPoseMap();

  const poses = [...poseMap.values()]
    .filter((p) => shouldKeepPose(ratings, p.id))
    .map((p) => {
      const section = inferPoseSection(p);
      return toCatalogItem(p, section, POSE_SECTION_LABELS[section] || section);
    })
    .sort((a, b) => a.section.localeCompare(b.section) || a.label.localeCompare(b.label));

  const actions = actionsDoc.actions
    .filter((a) => shouldKeepAction(ratings, a.id))
    .map((a) =>
      toCatalogItem(a, a.category, ACTION_SECTION_LABELS[a.category] || a.category),
    );

  const voices = voicesDoc.voices
    .filter((v) => shouldKeepCombo(ratings, `combo_voice_${v.id}`))
    .map((v) =>
      toCatalogItem(v, v.family, VOICE_SECTION_LABELS[v.family] || v.family),
    );

  const cameras = camerasDoc.cameras
    .filter((c) => shouldKeepCombo(ratings, `combo_cam_${c.id}`))
    .map((c) =>
      toCatalogItem(c, c.family, CAMERA_SECTION_LABELS[c.family] || c.family),
    );

  const out = {
    meta: {
      packedAt: new Date().toISOString(),
      source: "data/pose-eval-ratings.json",
      counts: {
        poses: poses.length,
        actions: actions.length,
        voices: voices.length,
        cameras: cameras.length,
      },
      sectionLabels: {
        poses: POSE_SECTION_LABELS,
        actions: ACTION_SECTION_LABELS,
        voices: VOICE_SECTION_LABELS,
        cameras: CAMERA_SECTION_LABELS,
      },
    },
    poses,
    actions,
    voices,
    cameras,
  };

  const outPath = path.join(ROOT, "presets", "prompt_lego_video.json");
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(
    `[pack-video-lego] wrote ${outPath}: poses=${poses.length} actions=${actions.length} voices=${voices.length} cameras=${cameras.length}`,
  );
}

main();
