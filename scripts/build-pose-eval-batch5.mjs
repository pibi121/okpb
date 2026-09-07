/**
 * Build batch5 from batch4:
 * - Hard GENITAL ORIENTATION (scrotum ONLY below shaft) for all picture4Penis poses
 * - ANAL APPEARANCE (tight closed anus) wherever buttocks/rear visible
 * - Drop batch4 poses marked for removal in ratings
 * - Add 2 kiss poses (POV male + side close)
 *
 *   node scripts/build-pose-eval-batch5.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data", "pose-eval-prompts-batch4.json");
const DEST = path.join(ROOT, "data", "pose-eval-prompts-batch5.json");

const REMOVE_FROM_CATALOG = new Set([
  "pose2_02_missionary_side",
  "pose2_03_missionary_top",
  "pose2_18_spooning_side",
  "pose2_48_cunnilingus_side",
  "pose2_60_lap_prelude",
]);

const GENITAL_HARD =
  "GENITAL ORIENTATION (critical male POV — HARD REJECT if violated): erect penis shaft points toward partner/coupling; scrotum/testicles hang ONLY BELOW the penis base under the shaft — gravity pulls balls downward from the base; NEVER above the shaft, NEVER on top of the cock, NEVER between shaft and her body above the glans, NEVER wrapping around the shaft from above, NEVER cupping or flanking the top half of the penis, NEVER visible in the upper half of the penis in POV frame, NEVER split with balls on both sides of mid-shaft, NEVER obscuring the shaft from above with scrotum; clean pubic skin and lower shaft visible from POV above the balls; if testicles appear in frame they occupy ONLY the lower third directly under the shaft base; wrong scrotum placement = invalid render.";

const ANAL_NARROW =
  "ANAL APPEARANCE (when buttocks/rear visible): anus is a small tight closed puckered ring — narrow, subtle, NOT gaped, NOT prolapsed, NOT wide open, NOT enlarged like vagina, NOT a dark cavern; do NOT stretch or gap the anal sphincter unless this is an anal-only penetration pose — even then keep the ring tight around the shaft, not a wide hole; vagina and anus remain separate landmarks — vagina lower/front between thighs, anus a smaller tighter ring higher on the perineum when both visible.";

const ASS_VISIBLE_IDS = new Set([
  "pose_standing_doggy_shoulder",
  "pose_standing_doggy_away",
  "pose_prone_bone_hidden",
  "pose2_10_prone_bone_pov",
  "pose2_11_prone_bone_side",
  "pose2_12_doggy_pov_shoulder",
  "pose2_13_doggy_pov_away",
  "pose2_14_standing_doggy_side",
  "pose2_15_wall_rear_side",
]);

const GENITAL_OLD =
  /GENITAL ORIENTATION \(critical for male POV\):[^.]+\.(?:[^.]+\.)*[^.]+\./g;

function needsAssBlock(pose) {
  if (ASS_VISIBLE_IDS.has(pose.id)) return true;
  if (pose.orifice === "anal") return true;
  if (/_anal$/.test(pose.id)) return true;
  if (pose.orifice === "vaginal" && ASS_VISIBLE_IDS.has(pose.id)) return true;
  return false;
}

function patchBody(body, { picture4Penis, assBlock }) {
  let out = body;
  if (picture4Penis) {
    out = out.replace(
      GENITAL_OLD,
      GENITAL_HARD + " ",
    );
    if (!out.includes("HARD REJECT if violated")) {
      out = out.replace(
        /GENITAL ORIENTATION \(critical for male POV\):/,
        GENITAL_HARD.split(":")[0] + ":",
      );
    }
  }
  if (assBlock && !out.includes("ANAL APPEARANCE")) {
    const insertAfter = out.match(/GENITAL ORIENTATION[^.]+\./);
    if (insertAfter) {
      const idx = out.indexOf(insertAfter[0]) + insertAfter[0].length;
      out = out.slice(0, idx) + " " + ANAL_NARROW + out.slice(idx);
    } else if (out.includes("ORIFICE:")) {
      out = out.replace(/(ORIFICE:[^.]+\.)/, `$1 ${ANAL_NARROW}`);
    } else {
      out = out.replace(
        /(BODY GEOMETRY:[^.]+\.)/,
        `$1 ${ANAL_NARROW}`,
      );
    }
  }
  return out;
}

function patchBrick(brick, { picture4Penis, assBlock }) {
  let out = brick;
  if (picture4Penis && !out.includes("HARD scrotum")) {
    out +=
      "; HARD scrotum-under-shaft-only — never above/wrapping/flanking shaft";
  }
  if (assBlock && !out.includes("tight closed anus")) {
    out += "; tight closed anus not gaped";
  }
  return out;
}

const KISS_POSES = [
  {
    id: "pose_kiss_pov_male",
    title: "Поцелуй POV мужчины — приближение к губам",
    brick:
      "First-person male POV romantic kiss approach: he leans slowly toward her lips from his eye-line; she holds seductive direct eye contact with the camera (with him); lips close or almost touching; faces fill frame; no penetration no genitals; identity Picture 1; tight close-up POV; near-static slow lean-in.",
    body: `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, intimate explicit-adjacent romance. First-person male POV: camera locked to the man's eye-line at face height. BODY GEOMETRY: exactly two people — one adult man, one adult woman; each has exactly two arms and two legs (no extra limbs, no missing limbs, no fused legs); they face each other standing or seated close; his head and upper torso implied at frame edges; she is directly in front of him at kissing distance; camera looks at her face from his POV as he leans in. MOTION: KISS_APPROACH — he slowly closes the distance between their lips over ~5 seconds; subtle forward lean of his POV toward her mouth; her head may tilt slightly to meet him but she keeps her gaze locked on the lens — seductive direct eye contact with the camera throughout; lips part soft, almost touching or light brush kiss at the end; NO thrusting, NO penetration, NO visible genitals, NO handjob/oral. Her face, hair, skin locked to <Picture 1> — no identity drift. Framing: tight close-up POV on her eyes, nose, mouth, and approaching kiss space; both lips readable near center at end. Near-static POV with only tiny lean-in motion (small amplitude, slow speed), no cut, no orbit. Soft warm lighting. <Picture 2> and <Picture 3> may reinforce the same woman only — same face, body, and look; no identity drift.

overall_soundscape: Close intimate hush: soft breath, fabric rustle, faint lip contact at end, no crowd, no music bleed.

non_diegetic_music: N/A

В данном промпте зашито: male POV kiss lean-in; she eyes camera seductive; no genitals; identity lock.

Кирпичик:
First-person male POV romantic kiss approach: he leans slowly toward her lips from his eye-line; she holds seductive direct eye contact with the camera (with him); lips close or almost touching; faces fill frame; no penetration no genitals; identity Picture 1; tight close-up POV; near-static slow lean-in.`,
    picture4Penis: false,
    orifice: null,
    motionMode: "KISS_APPROACH",
  },
  {
    id: "pose_kiss_side_close",
    title: "Поцелуй сбоку — обе головы, близкий kiss",
    brick:
      "Third-person side close kiss: profile/three-quarter medium-close; both heads fully visible; lips meet or hover millimeters apart; intimate hold; slow micro-sway; no penetration no genitals; identity Picture 1 both faces readable; near-static tiny sway.",
    body: `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, intimate explicit-adjacent romance. Third-person side-angle medium-close shot. BODY GEOMETRY: exactly two people — one adult man, one adult woman; each has exactly two arms and two legs (no extra limbs, no missing limbs, no fused legs); they stand or sit pressed close face-to-face; camera on their profile side so BOTH heads are fully visible in frame — her face and his face readable, foreheads/noses/lips aligned; arms around waist/neck optional. MOTION: KISS_HOLD — sustained close kiss or lips hovering a millimeter apart; subtle breathing sway only; NO thrusting, NO penetration, NO visible genitals. IDENTITY LOCK: her face locked to <Picture 1>; his face secondary/generic adult male, not identity-critical. Framing: tight medium-close side profile — both mouths, both eyes, both jawlines visible; kiss line centered. Near-static with tiny intimate sway (small amplitude, slow speed), no cut, no orbit. Soft warm lighting. <Picture 2> and <Picture 3> reinforce same woman only — no identity drift.

overall_soundscape: Close intimate hush: soft synchronized breath, faint lip contact, fabric, no crowd, no music bleed.

non_diegetic_music: N/A

В данном промпте зашито: side close kiss both heads visible; no genitals; identity lock her face.

Кирпичик:
Third-person side close kiss: profile/three-quarter medium-close; both heads fully visible; lips meet or hover millimeters apart; intimate hold; slow micro-sway; no penetration no genitals; identity Picture 1 both faces readable; near-static tiny sway.`,
    picture4Penis: false,
    orifice: null,
    motionMode: "KISS_HOLD",
  },
];

const src = JSON.parse(fs.readFileSync(SRC, "utf8"));
const poses = src.poses
  .filter((p) => !REMOVE_FROM_CATALOG.has(p.id))
  .map((p) => {
    const assBlock = needsAssBlock(p);
    return {
      ...p,
      brick: patchBrick(p.brick, { picture4Penis: p.picture4Penis, assBlock }),
      body: patchBody(p.body, { picture4Penis: p.picture4Penis, assBlock }),
    };
  })
  .concat(KISS_POSES);

const out = {
  ...src,
  version: 5,
  batchLabel: "batch5-scrotum-anal-kiss-fixes",
  meta: {
    ...src.meta,
    count: poses.length,
    parentBatch: 4,
    scrotumRule:
      "HARD: scrotum/testicles ONLY BELOW shaft in male POV — never above, wrapping, flanking, or on top of penis",
    analRule:
      "When buttocks visible: anus tight closed puckered ring — NOT gaped/wide",
    addedPoses: ["pose_kiss_pov_male", "pose_kiss_side_close"],
    removedFromBatch4: [...REMOVE_FROM_CATALOG],
    rules: [
      ...(src.meta?.rules || []),
      "Male POV + penis -> HARD GENITAL ORIENTATION block + Picture 4",
      "Buttocks/rear visible -> ANAL APPEARANCE tight closed anus",
      "Kiss poses: no Picture 4, identity lock only",
    ],
  },
  poses,
};

fs.writeFileSync(DEST, JSON.stringify(out, null, 2), "utf8");
console.log(`Wrote ${DEST}`);
console.log(`Poses: ${poses.length} (${poses.length - KISS_POSES.length} from batch4 + ${KISS_POSES.length} kisses)`);
