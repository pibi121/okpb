/**
 * Fork MiniMax_H3_Character_Ref2VA_READY → PHOTO_BG variant:
 * - prompts: background from Picture 1, motion only from Video 1
 * - masking: video keeps frame batch; scaled photo pasted on background via inverted SAM3 mask
 * - ref_image_1 = same LoadImage as scene reference
 * - ref_video bypasses PreviewImage (full batch to Ref2V)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INPUT = path.join(ROOT, "workflows", "MiniMax_H3_Character_Ref2VA_READY.json");
const OUTPUT = path.join(
  ROOT,
  "workflows",
  "MiniMax_H3_Character_Ref2VA_PHOTO_BG.json",
);

const SCENE_DESCRIPTION = [
  "Use the background, environment, lighting, and scene composition from <Picture 1>.",
  "Take only motion, pose changes, gestures, timing, and camera movement from <Video 1>.",
  "Do not copy the background, room, or environment from <Video 1>.",
  "The character should appear in the setting of <Picture 1>.",
].join(" ");

const RETENTION_SUFFIX = [
  "",
  "\n\nretention_analysis:\n",
  "<Subject 1>: attribute_transfer - transfer body, face, hairstyle, hair color, clothing, and makeup from <Picture 1>\n",
  "<Picture 1>: partially_preserved - preserve background, environment, lighting, scene layout, and composition\n",
  "<Video 1>: motion_only - preserve only action, poses, gestures, timing, and camera movement; do not preserve background or environment\n\n",
  "detailed_description:\n",
  "",
].join("");

const NOTE = [
  "PHOTO BG variant — motion from video + background from character photo.",
  "Original in-scene swap: MiniMax_H3_Character_Ref2VA_READY.json",
  "",
  "1) SOURCE VIDEO in LoadVideo, CHARACTER PHOTO in LoadImage (full scene visible).",
  "2) SAM3 target: The woman (adjust if needed).",
  "3) Composite: video base + scaled photo on background (inverted SAM3 mask).",
  "4) Comfy: --use-pytorch-cross-attention on RTX 5090.",
].join("\\n");

if (!fs.existsSync(INPUT)) {
  console.error("Missing input:", INPUT);
  process.exit(1);
}

const wf = JSON.parse(fs.readFileSync(INPUT, "utf8"));
wf.id = "photo-bg-" + (wf.id || "ref2va");
wf.last_node_id = 528;
wf.last_link_id = 787;

for (const node of wf.nodes) {
  if (node.id === 507 && node.title === "Scene description") {
    node.widgets_values = [SCENE_DESCRIPTION];
  }
  if (node.id === 511 && node.type === "StringConcatenate") {
    node.widgets_values = ["", RETENTION_SUFFIX, ""];
  }
  if (node.id === 515 && node.type === "MarkdownNote") {
    node.widgets_values = [NOTE];
  }
}

// mute old ImageInvert video trick
const invert = wf.nodes.find((n) => n.id === 457);
if (invert) {
  invert.mode = 4;
  if (invert.inputs?.[0]) invert.inputs[0].link = null;
  if (invert.outputs?.[0]) invert.outputs[0].links = [];
}

const loadImg = wf.nodes.find((n) => n.id === 496);
const ref2v = wf.nodes.find((n) => n.id === 464);
if (loadImg?.outputs?.[0]) loadImg.outputs[0].links = [722, 778, 781];
if (ref2v?.inputs) {
  const ref1 = ref2v.inputs.find((i) => i.name === "ref_images.ref_image_1");
  if (ref1) ref1.link = 781;
}

// Scale photo to video WxH
wf.nodes.push({
  id: 526,
  type: "ImageScale",
  pos: [-793, 4860],
  size: [270, 130],
  flags: {},
  order: 24,
  mode: 0,
  inputs: [
    { name: "image", type: "IMAGE", link: 778 },
    { name: "width", type: "INT", widget: { name: "width" }, link: 782 },
    { name: "height", type: "INT", widget: { name: "height" }, link: 783 },
  ],
  outputs: [{ name: "IMAGE", type: "IMAGE", links: [779] }],
  title: "Scale photo to video size",
  properties: {
    "Node name for S&R": "ImageScale",
    ue_properties: { widget_ue_connectable: { width: true, height: true }, version: "7.8" },
  },
  widgets_values: ["lanczos", 512, 512, "center"],
  color: "#432",
  bgcolor: "#653",
});

// Invert SAM3 mask → paste photo on background, keep video on character
wf.nodes.push({
  id: 528,
  type: "InvertMask",
  pos: [-620, 4955],
  size: [210, 26],
  flags: { collapsed: true },
  order: 28,
  mode: 0,
  inputs: [{ name: "mask", type: "MASK", link: 669 }],
  outputs: [{ name: "MASK", type: "MASK", links: [787] }],
  title: "Invert mask (photo=background)",
  properties: {
    "Node name for S&R": "InvertMask",
    ue_properties: { widget_ue_connectable: {}, version: "7.8" },
  },
  widgets_values: [],
});

// Composite: dest=video batch, source=photo (auto-repeated), mask=inverted
const composite = wf.nodes.find((n) => n.id === 454);
if (composite?.inputs) {
  composite.inputs.find((i) => i.name === "destination").link = 677;
  composite.inputs.find((i) => i.name === "source").link = 779;
  composite.inputs.find((i) => i.name === "mask").link = 787;
}

const vidComp = wf.nodes.find((n) => n.id === 460);
if (vidComp?.outputs?.[0]) vidComp.outputs[0].links = [677];

const samSub = wf.nodes.find((n) => n.id === 455);
if (samSub?.outputs?.[0]) samSub.outputs[0].links = [669, 717];

// ref_video: bypass PreviewImage — full frame batch to Ref2V
const scalePx = wf.nodes.find((n) => n.id === 456);
const preview461 = wf.nodes.find((n) => n.id === 461);
if (scalePx?.outputs?.[0]) scalePx.outputs[0].links = [674, 785];
if (ref2v?.inputs) {
  const refVid = ref2v.inputs.find((i) => i.name === "ref_videos.ref_video_0");
  if (refVid) refVid.link = 785;
}
if (preview461?.outputs?.[0]) preview461.outputs[0].links = [];
if (preview461?.inputs?.[0]) preview461.inputs[0].link = 674;

const drop = new Set([673, 678, 699]);
wf.links = wf.links.filter((l) => !drop.has(l[0]));
for (const link of wf.links) {
  if (link[0] === 669) {
    link[3] = 528;
    link[4] = 0;
  }
}
wf.links.push(
  [778, 496, 0, 526, 0, "IMAGE"],
  [779, 526, 0, 454, 1, "IMAGE"],
  [781, 496, 0, 464, 4, "IMAGE"],
  [782, 505, 0, 526, 1, "INT"],
  [783, 505, 1, 526, 2, "INT"],
  [785, 456, 0, 464, 5, "IMAGE"],
  [787, 528, 0, 454, 2, "MASK"],
);

wf.extra = wf.extra || {};
wf.extra.peach_patched = {
  ...(wf.extra.peach_patched || {}),
  variant: "PHOTO_BG",
  at: new Date().toISOString(),
  note: "Video batch preserved; photo on background via inverted SAM3 mask",
};

fs.writeFileSync(OUTPUT, JSON.stringify(wf, null, 2), "utf8");

const dl = path.join(process.env.USERPROFILE || "", "Downloads", "MiniMax_H3_Character_Ref2VA_PHOTO_BG.json");
try {
  fs.copyFileSync(OUTPUT, dl);
  console.log("Copied to:", dl);
} catch {
  /* ignore */
}
console.log("Wrote:", OUTPUT);
