/**
 * Build combo-eval-prompts-v1.json — voice+camera paired with pose/action.
 * Each of 20 voices and 50 cameras gets one sensible base clip (×2 variants at run time).
 *
 *   node scripts/build-combo-eval-prompts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadPoseMap() {
  const map = new Map();
  const files = [
    "pose-eval-prompts-batch5.json",
    "pose-eval-prompts-batch4.json",
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

function loadActionMap() {
  const p = path.join(ROOT, "data", "action-eval-prompts-v1.json");
  const doc = JSON.parse(fs.readFileSync(p, "utf8"));
  return new Map(doc.actions.map((a) => [a.id, a]));
}

function baseRef(type, id, poses, actions) {
  if (type === "pose") {
    const p = poses.get(id);
    if (!p) throw new Error(`pose not found: ${id}`);
    return {
      baseType: "pose",
      baseId: p.id,
      baseTitle: p.title,
      baseBrick: p.brick,
      baseBody: p.body,
      picture4Penis: Boolean(p.picture4Penis),
    };
  }
  if (type === "action") {
    const a = actions.get(id);
    if (!a) throw new Error(`action not found: ${id}`);
    return {
      baseType: "action",
      baseId: a.id,
      baseTitle: a.title,
      baseBrick: a.brick,
      baseBody: a.body,
      picture4Penis: Boolean(a.picture4Penis),
    };
  }
  throw new Error(`unknown base type for ${id}`);
}

function mergeBodies(baseBody, addonBody, addonLabel) {
  return `${baseBody.trim()}\n\n--- COMBINED ${addonLabel} BRICK ---\n\n${addonBody.trim()}`;
}

/** @type {Record<string, {type:'pose'|'action', id:string}>} */
const VOICE_BASE = {
  voice_her_soft_breath: { type: "pose", id: "pose2_59_standing_embrace" },
  voice_her_soft_moan: { type: "pose", id: "pose_kiss_pov_male" },
  voice_her_moan_rhythmic_thrust: { type: "pose", id: "pose_missionary_pov_eye_vaginal" },
  voice_her_high_whimper: { type: "pose", id: "pose2_07_missionary_anal" },
  voice_her_suppressed_quiet: { type: "pose", id: "pose2_11_prone_bone_side" },
  voice_her_muffled_pillow: { type: "pose", id: "pose_prone_bone_hidden" },
  voice_her_orgasm_build: { type: "pose", id: "pose2_04_fold_over_mating_press_vaginal" },
  voice_her_peak_cry_short: { type: "pose", id: "pose2_08_anvil_vaginal" },
  voice_her_oral_muffled_hum: { type: "pose", id: "pose_seated_oral" },
  voice_her_insertion_gasp: { type: "action", id: "act_sex_first_insertion" },
  voice_her_afterglow_breath: { type: "action", id: "act_outro_afterglow_hug" },
  voice_him_thrust_grunt: { type: "pose", id: "pose_standing_doggy_shoulder" },
  voice_him_climax_groan: { type: "action", id: "act_sex_creampie_withdraw_drip" },
  voice_duet_she_moan_he_breath: { type: "pose", id: "pose2_35_standing_face_to_face" },
  voice_en_yes_loop: { type: "pose", id: "pose2_23_cowgirl_pov" },
  voice_en_fuck_me_dont_stop: { type: "pose", id: "pose2_12_doggy_pov_shoulder" },
  voice_en_im_cumming: { type: "pose", id: "pose2_05_pressed_legs_vaginal" },
  voice_en_good_girl_male: { type: "pose", id: "pose_standing_handjob" },
  voice_en_cum_for_me_finish: { type: "action", id: "act_sex_facial_cum_pov" },
  voice_en_moan_yes_hybrid: { type: "pose", id: "pose_missionary_pov_eye_vaginal" },
};

/** @type {Record<string, {type:'pose'|'action', id:string}>} */
const CAMERA_BASE = {
  cam_reveal_head_to_crotch_down: { type: "pose", id: "pose2_59_standing_embrace" },
  cam_reveal_crotch_to_head_up: { type: "pose", id: "pose2_35_standing_face_to_face" },
  cam_reveal_face_to_chest: { type: "pose", id: "pose_kiss_pov_male" },
  cam_reveal_chest_to_hips: { type: "pose", id: "pose2_59_standing_embrace" },
  cam_reveal_spine_to_ass: { type: "pose", id: "pose2_13_doggy_pov_away" },
  cam_reveal_side_silhouette: { type: "pose", id: "pose2_14_standing_doggy_side" },
  cam_reveal_between_knees_to_face: { type: "pose", id: "pose_standing_handjob" },
  cam_reveal_hip_to_face_return: { type: "pose", id: "pose2_13_doggy_pov_away" },
  cam_accent_push_in_face: { type: "pose", id: "pose_missionary_pov_eye_vaginal" },
  cam_accent_push_in_lips: { type: "pose", id: "pose_kiss_side_close" },
  cam_accent_push_in_breasts: { type: "action", id: "act_contact_breast_touch" },
  cam_accent_push_in_hips_ass: { type: "pose", id: "pose2_12_doggy_pov_shoulder" },
  cam_accent_push_in_coupling: { type: "pose", id: "pose2_01_pov_vaginal" },
  cam_accent_push_in_hands_on_shaft: { type: "pose", id: "pose_seated_handjob" },
  cam_accent_push_in_finish_detail: { type: "action", id: "act_sex_facial_cum_pov" },
  cam_accent_push_out_from_face: { type: "pose", id: "pose2_37_lifted_suspended" },
  cam_follow_walk_beside: { type: "action", id: "act_move_walk_side" },
  cam_follow_walk_behind: { type: "action", id: "act_move_walk_behind_pov" },
  cam_follow_kneel_descend: { type: "action", id: "act_trans_kneel_down" },
  cam_follow_crawl: { type: "action", id: "act_move_crawl_on_surface" },
  cam_follow_face_on_bounce: { type: "pose", id: "pose2_23_cowgirl_pov" },
  cam_orbit_90_hip_level: { type: "pose", id: "pose2_12_doggy_pov_shoulder" },
  cam_orbit_face_close_arc: { type: "pose", id: "pose_kiss_side_close" },
  cam_orbit_rear_to_profile_couple: { type: "pose", id: "pose2_14_standing_doggy_side" },
  cam_orbit_stop_on_coupling: { type: "pose", id: "pose_missionary_pov_eye_vaginal" },
  cam_vertical_crane_down_standing: { type: "pose", id: "pose2_59_standing_embrace" },
  cam_vertical_crane_up_to_face: { type: "pose", id: "pose2_11_prone_bone_side" },
  cam_vertical_bed_low_to_face: { type: "pose", id: "pose2_07_missionary_vaginal" },
  cam_vertical_overhead_drop_in: { type: "pose", id: "pose2_08_anvil_vaginal" },
  cam_pov_male_lock_static: { type: "pose", id: "pose_missionary_pov_eye_vaginal" },
  cam_pov_lookdown_dip_to_body: { type: "pose", id: "pose_standing_handjob" },
  cam_pov_lookdown_then_return_face: { type: "pose", id: "pose_seated_handjob" },
  cam_pov_glance_to_coupling: { type: "pose", id: "pose_standing_doggy_shoulder" },
  cam_ots_over_shoulder_to_her_face: { type: "pose", id: "pose2_12_doggy_pov_shoulder" },
  cam_pov_her_look_down_self: { type: "action", id: "act_strip_panties_down_pov" },
  cam_rhythm_static_against_motion: { type: "pose", id: "pose2_52_handjob_pov" },
  cam_rhythm_thrust_sync_micro: { type: "pose", id: "pose_standing_doggy_away" },
  cam_rhythm_bob_sync_oral: { type: "pose", id: "pose_seated_oral" },
  cam_rhythm_default_tiny_sway: { type: "pose", id: "pose2_59_standing_embrace" },
  cam_depth_doorway_lateral_reveal: { type: "action", id: "act_intro_door_knock_pov_him" },
  cam_depth_foreground_wipe_shoulder: { type: "action", id: "act_intro_threshold_hug" },
  cam_depth_push_through_threshold: { type: "action", id: "act_intro_invite_in_gesture" },
  cam_story_hold_move_hold: { type: "action", id: "act_contact_kiss_standing" },
  cam_story_detail_then_face: { type: "action", id: "act_sex_guide_in_hand" },
  cam_story_face_then_detail: { type: "action", id: "act_sex_oral_first_lick" },
  cam_story_wide_to_intimate: { type: "action", id: "act_intro_door_knock_pov_him" },
  cam_anchor_end_on_eyes: { type: "pose", id: "pose_missionary_pov_eye_anal" },
  cam_anchor_end_on_hips: { type: "pose", id: "pose2_13_doggy_pov_away" },
  cam_anchor_end_on_coupling: { type: "pose", id: "pose2_09_bended_missionary_vaginal" },
  cam_anchor_end_on_full_pose: { type: "pose", id: "pose2_04_fold_over_mating_press_vaginal" },
};

/** @type {Record<string, string>} */
const VOICE_HINT_RU = {
  voice_her_soft_breath: "Слушай: только тихое дыхание удовольствия, почти без стонов. Визуал вторичен.",
  voice_her_soft_moan: "Слушай: мягкие непрерывные стоны. Не крик, не шёпот-only.",
  voice_her_moan_rhythmic_thrust: "Слушай: стоны/выдохи в такт толчкам. Ритм должен совпадать с движением бёдер.",
  voice_her_high_whimper: "Слушай: высокие whimper/whine, не громкий scream.",
  voice_her_suppressed_quiet: "Слушай: подавленные звуки, сдерживает голос (кусает губу/подушку).",
  voice_her_muffled_pillow: "Слушай: приглушённые стоны в подушку/матрас.",
  voice_her_orgasm_build: "Слушай: нарастание — от дыхания к стону, кульминация к концу клипа.",
  voice_her_peak_cry_short: "Слушай: короткий пик/orgasm cry, не длинный вопль.",
  voice_her_oral_muffled_hum: "Слушай: приглушённое мычание/гул во рту на члене.",
  voice_her_insertion_gasp: "Слушай: резкий вдох/gasp в момент первого входа.",
  voice_her_afterglow_breath: "Слушай: после — тяжёлое успокаивающее дыхание, без нового секса.",
  voice_him_thrust_grunt: "Слушай: мужские приглушённые grunts в ритм толчков.",
  voice_him_climax_groan: "Слушай: мужской groan на финале/выходе.",
  voice_duet_she_moan_he_breath: "Слушай: она стонет, он дышит — оба слышны.",
  voice_en_yes_loop: "Слушай: англ. «yes» в цикле, узнаваемо.",
  voice_en_fuck_me_dont_stop: "Слушай: фраза «fuck me / don't stop» по-английски.",
  voice_en_im_cumming: "Слушай: «I'm cumming» — чётко слышно.",
  voice_en_good_girl_male: "Слушай: мужской «good girl» по-английски.",
  voice_en_cum_for_me_finish: "Слушай: «cum for me» на финале.",
  voice_en_moan_yes_hybrid: "Слушай: смесь стона + «yes», не только слова.",
};

/** @type {Record<string, string>} */
const CAMERA_HINT_RU = {
  cam_reveal_head_to_crotch_down: "Смотри: камера едет сверху вниз лицо→пах. Тело почти неподвижно.",
  cam_reveal_crotch_to_head_up: "Смотри: камера снизу вверх пах→лицо.",
  cam_reveal_spine_to_ass: "Смотри: вдоль спины к ягодицам.",
  cam_reveal_ass_to_face: "Смотри: от ягодиц к лицу через плечо.",
  cam_reveal_feet_to_face_up: "Смотри: от ног к лицу вверх.",
  cam_reveal_face_to_feet_down: "Смотри: от лица к ногам вниз.",
  cam_reveal_side_profile_full_body: "Смотри: боковой reveal всего тела.",
  cam_reveal_wide_to_close_face: "Смотри: от общего плана к крупному лицу.",
  cam_accent_push_in_face: "Смотри: push-in на лицо, одно движение.",
  cam_accent_push_in_coupling: "Смотри: push-in на место соединения/пах.",
  cam_accent_pull_back_reveal: "Смотри: отъезд назад, открывает сцену.",
  cam_accent_lateral_slide_across_face: "Смотри: боковой slide через лицо.",
  cam_accent_tilt_up_from_hands: "Смотри: tilt вверх от рук/бёдер.",
  cam_accent_tilt_down_from_face: "Смотри: tilt вниз от лица.",
  cam_accent_dutch_tilt_hold: "Смотри: dutch angle + удержание.",
  cam_accent_slow_zoom_out: "Смотри: медленный zoom out.",
  cam_follow_walk_behind: "Смотри: камера следует сзади за ходьбой.",
  cam_follow_walk_beside: "Смотри: камера сбоку при ходьбе.",
  cam_follow_sit_down_with_her: "Смотри: камера опускается вместе с посадкой.",
  cam_follow_stand_up_from_seated: "Смотри: подъём камеры при вставании.",
  cam_follow_hand_on_wall_walk: "Смотри: follow у стены.",
  cam_orbit_90_hip_level: "Смотри: орбита ~90° на уровне бёдер.",
  cam_orbit_90_standing_face: "Смотри: орбита стоя, лица видны.",
  cam_orbit_45_three_quarter: "Смотри: орбита 45° three-quarter.",
  cam_orbit_slow_around_kissing: "Смотри: медленная орбита вокруг поцелуя.",
  cam_vertical_crane_down_standing: "Смотри: crane вниз на стоящих.",
  cam_vertical_crane_up_lying: "Смотри: crane вверх на лежащих.",
  cam_vertical_rise_from_lap: "Смотри: подъём от lap-level.",
  cam_vertical_drop_to_kneel: "Смотри: опускание к kneel-level.",
  cam_pov_lookdown_dip_to_body: "Смотри: POV взгляд вниз по телу и возврат.",
  cam_pov_lookdown_then_return_face: "Смотри: POV вниз → обратно на лицо.",
  cam_pov_male_lock_static: "Смотри: male POV почти статичен.",
  cam_pov_male_sway_micro: "Смотри: male POV микро-sway в ритм.",
  cam_pov_oral_angle_shift: "Смотри: POV oral, лёгкий сдвиг угла.",
  cam_pov_thrust_rhythm_sway: "Смотри: POV sway в ритм thrust.",
  cam_rhythm_static_against_motion: "Смотри: камера статична, движется тело/рука.",
  cam_rhythm_thrust_sync_micro: "Смотри: камера микро-движется в такт thrust.",
  cam_rhythm_bob_sync_oral: "Смотри: камера в такт oral bob.",
  cam_rhythm_hand_stroke_sync: "Смотри: камера в такт handjob.",
  cam_story_detail_then_face: "Смотри: деталь → лицо (story beat).",
  cam_story_face_then_detail: "Смотри: лицо → деталь.",
  cam_story_wide_to_intimate: "Смотри: wide → intimate.",
  cam_story_intimate_to_wide: "Смотри: intimate → wide.",
  cam_depth_doorway_lateral_reveal: "Смотри: reveal из дверного проёма.",
  cam_depth_over_shoulder_peek: "Смотри: peek через плечо.",
  cam_depth_through_legs_gap: "Смотри: между ног / gap framing.",
  cam_anchor_start_on_face: "Смотри: старт на лице, удержание.",
  cam_anchor_end_on_full_pose: "Смотри: финиш на полной позе.",
  cam_anchor_hold_on_coupling: "Смотри: удержание на coupling.",
  cam_anchor_hold_on_rear: "Смотри: удержание на rear/ягодицах.",
};

function voiceHint(voice, base) {
  const specific = VOICE_HINT_RU[voice.id] || voice.testSignal || "";
  const baseLabel =
    base.baseType === "pose"
      ? `ПОЗА: ${base.baseTitle}`
      : `ДЕЙСТВИЕ: ${base.baseTitle}`;
  return `Что проверяем: ${baseLabel} + ОЗВУЧКА: ${voice.title}.\nНа что смотреть: ${specific}\nТакже: лицо/identity не должно ломаться; визуал позы/действия вторичен — главный герой ЗВУК.`;
}

function cameraHint(camera, base) {
  const specific =
    CAMERA_HINT_RU[camera.id] ||
    `Тrajectory камеры должна быть очевидна за один просмотр: ${camera.title}.`;
  const baseLabel =
    base.baseType === "pose"
      ? `ПОЗА: ${base.baseTitle}`
      : `ДЕЙСТВИЕ: ${base.baseTitle}`;
  return `Что проверяем: ${baseLabel} + КАМЕРА: ${camera.title}.\nНа что смотреть: ${specific}\nТакже: поза/действие держится; первым бросается в глаза именно движение камеры, не случайный shake.`;
}

function main() {
  const poses = loadPoseMap();
  const actions = loadActionMap();
  const voices = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "voice-tabs-prompts-v1.json"), "utf8"),
  ).voices;
  const cameras = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "camera-tabs-prompts-v1.json"), "utf8"),
  ).cameras;

  const items = [];

  for (const voice of voices) {
    const pair = VOICE_BASE[voice.id];
    if (!pair) throw new Error(`missing VOICE_BASE for ${voice.id}`);
    const base = baseRef(pair.type, pair.id, poses, actions);
    const id = `combo_voice_${voice.id}`;
    items.push({
      id,
      comboType: "voice",
      title: `${base.baseTitle} + ${voice.title}`,
      brick: `${base.baseBrick} + ${voice.brick}`,
      body: mergeBodies(base.baseBody, voice.body, "VOICE"),
      picture4Penis: base.picture4Penis || Boolean(voice.picture4Penis),
      evalHintRu: voiceHint(voice, base),
      bricks: [
        {
          category: base.baseType,
          categoryLabelRu: base.baseType === "pose" ? "Поза" : "Действие",
          id: base.baseId,
          title: base.baseTitle,
        },
        {
          category: "voice",
          categoryLabelRu: "Озвучка",
          id: voice.id,
          title: voice.title,
        },
      ],
      ratingCategories: [
        { key: "baseFit", labelRu: `Попадание: ${base.baseType === "pose" ? "поза" : "действие"}` },
        { key: "addonFit", labelRu: "Попадание: озвучка" },
      ],
    });
  }

  for (const camera of cameras) {
    const pair = CAMERA_BASE[camera.id];
    if (!pair) throw new Error(`missing CAMERA_BASE for ${camera.id}`);
    const base = baseRef(pair.type, pair.id, poses, actions);
    const id = `combo_cam_${camera.id}`;
    items.push({
      id,
      comboType: "camera",
      title: `${base.baseTitle} + ${camera.title}`,
      brick: `${base.baseBrick} + ${camera.brick}`,
      body: mergeBodies(base.baseBody, camera.body, "CAMERA"),
      picture4Penis: base.picture4Penis || Boolean(camera.picture4Penis),
      evalHintRu: cameraHint(camera, base),
      bricks: [
        {
          category: base.baseType,
          categoryLabelRu: base.baseType === "pose" ? "Поза" : "Действие",
          id: base.baseId,
          title: base.baseTitle,
        },
        {
          category: "camera",
          categoryLabelRu: "Камера",
          id: camera.id,
          title: camera.title,
        },
      ],
      ratingCategories: [
        { key: "baseFit", labelRu: `Попадание: ${base.baseType === "pose" ? "поза" : "действие"}` },
        { key: "addonFit", labelRu: "Попадание: камера" },
      ],
    });
  }

  const actionDoc = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "action-eval-prompts-v1.json"), "utf8"),
  );

  const out = {
    version: 1,
    batchLabel: "combo-voice-camera-v1",
    durationSec: 5,
    orientation: "9_16",
    refSourceRunId: actionDoc.refSourceRunId || "cmtbsa9330009v940q41iepmj",
    characterName: actionDoc.characterName || "Daisy Shtorm",
    characterId: actionDoc.characterId,
    penisRefPath: "data/refs/penis-reference.png",
    evalType: "combo",
    meta: {
      count: items.length,
      voices: voices.length,
      cameras: cameras.length,
      variantsPerItem: 2,
      totalClipsExpected: items.length * 2,
    },
    items,
  };

  const dest = path.join(ROOT, "data", "combo-eval-prompts-v1.json");
  fs.writeFileSync(dest, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${dest}: ${items.length} combos (${voices.length} voice + ${cameras.length} camera)`);
}

main();
