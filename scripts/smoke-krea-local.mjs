/** Smoke Krea T2I via Comfy tunnel; save PNG to data/gallery/_smoke */
import fs from "fs";
import path from "path";

const COMFY = process.env.COMFY_URL || "http://127.0.0.1:8188";

const graph = {
  "1": {
    class_type: "UNETLoader",
    inputs: {
      unet_name: "krea2/krea2_turbo_fp8_scaled.safetensors",
      weight_dtype: "default",
    },
  },
  "2": {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: "Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors",
      type: "krea2",
      device: "default",
    },
  },
  "3": {
    class_type: "VAELoader",
    inputs: { vae_name: "wan_2.1_vae.safetensors" },
  },
  "20": {
    class_type: "LoraLoader",
    inputs: {
      model: ["1", 0],
      clip: ["2", 0],
      lora_name: "krea2/olh_person_krea2.safetensors",
      strength_model: 1.0,
      strength_clip: 1.0,
    },
  },
  "21": {
    class_type: "LoraLoader",
    inputs: {
      model: ["20", 0],
      clip: ["2", 0],
      lora_name: "krea2/KNPV4.1_pre.safetensors",
      strength_model: 1.0,
      strength_clip: 1.0,
    },
  },
  "4": {
    class_type: "CLIPTextEncode",
    inputs: {
      clip: ["2", 0],
      text: "olh_person, petite athletic woman long dark hair, warm lamp bedroom, nsfw, Only two people.",
    },
  },
  "5": {
    class_type: "CLIPTextEncode",
    inputs: {
      clip: ["2", 0],
      text: "blurry, deformed, child, underage",
    },
  },
  "6": {
    class_type: "EmptyLatentImage",
    inputs: { width: 888, height: 1176, batch_size: 1 },
  },
  "7": {
    class_type: "KSampler",
    inputs: {
      model: ["21", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: ["6", 0],
      seed: 42,
      steps: 8,
      cfg: 1.0,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1.0,
    },
  },
  "8": {
    class_type: "VAEDecode",
    inputs: { samples: ["7", 0], vae: ["3", 0] },
  },
  "9": {
    class_type: "SaveImage",
    inputs: { images: ["8", 0], filename_prefix: "peach/smoke" },
  },
};

const q = await fetch(`${COMFY}/prompt`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: graph, client_id: "peach-smoke" }),
});
const queued = await q.json();
if (!queued.prompt_id) {
  console.error(queued);
  process.exit(1);
}
console.log("queued", queued.prompt_id);
const t0 = Date.now();
for (;;) {
  const h = await fetch(`${COMFY}/history/${queued.prompt_id}`);
  const hist = await h.json();
  const entry = hist[queued.prompt_id];
  if (entry?.status?.completed || entry?.status?.status_str === "success") {
    const imgs = [];
    for (const o of Object.values(entry.outputs || {})) {
      for (const im of o.images || []) imgs.push(im);
    }
    const im = imgs[0];
    const qs = new URLSearchParams({
      filename: im.filename,
      subfolder: im.subfolder || "",
      type: im.type || "output",
    });
    const view = await fetch(`${COMFY}/view?${qs}`);
    const buf = Buffer.from(await view.arrayBuffer());
    const dir = path.join(process.cwd(), "data", "gallery", "_smoke");
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `smoke_${Date.now()}.png`);
    fs.writeFileSync(out, buf);
    console.log(
      "\nsaved",
      out,
      buf.length,
      "bytes in",
      ((Date.now() - t0) / 1000).toFixed(1),
      "s",
    );
    process.exit(0);
  }
  if (entry?.status?.status_str === "error") {
    console.error(entry);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
}
