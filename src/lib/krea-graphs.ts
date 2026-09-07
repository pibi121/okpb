/** API graph builders for Krea2 still + identity edit. */

import {
  KREA_SKIN_DETAIL_LORA,
  resolveSkinDetail,
} from "@/lib/krea-skin-lora";

const NEG =
  "clothes, underwear, bra, panties, mosaic, censored, blurry, deformed hands, extra limbs, plastic skin, waxy, airbrushed, beauty filter, child, underage";

export function buildKreaT2IGraph(opts: {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  steps?: number;
  useCharacterLora?: boolean;
  /** Relative to Comfy models/loras, e.g. krea2/olh_person_krea2.safetensors */
  characterLoraName?: string;
  /** Identity LoRA strength (lower when mixed cast so one face does not overwrite the other) */
  characterLoraStrength?: number;
  useNsfwLora?: boolean;
  /** Skin texture LoRA (model only, clip strength 0). */
  skinDetail?: boolean;
  skinDetailStrength?: number;
  skinDetailLoraName?: string;
  /** Extra concept / pose / slider LoRAs (after NSFW, before skin). */
  extraLoras?: Array<{
    name: string;
    strength: number;
    strengthClip?: number;
  }>;
  filenamePrefix?: string;
  /** Override default negative (film stills must not ban clothes) */
  negativePrompt?: string;
  /** Appended to the negative (e.g. beard when lookbook is clean-shaven) */
  extraNegative?: string;
}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e15);
  const steps = opts.steps ?? 10;
  const charLora = opts.characterLoraName?.trim() || "";
  // Never fall back to house olh_person — missing name means no character LoRA.
  const useChar = opts.useCharacterLora !== false && !!charLora;
  const useNsfw = opts.useNsfwLora !== false;
  const negative = [opts.negativePrompt?.trim() || NEG, opts.extraNegative?.trim()]
    .filter(Boolean)
    .join(", ");

  const graph: Record<string, unknown> = {
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
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: opts.prompt },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: negative },
    },
    "6": {
      class_type: "EmptyLatentImage",
      inputs: { width: opts.width, height: opts.height, batch_size: 1 },
    },
  };

  let modelRef: [string, number] = ["1", 0];
  let nextId = 20;

  if (useChar) {
    const id = String(nextId++);
    const strength =
      typeof opts.characterLoraStrength === "number"
        ? opts.characterLoraStrength
        : 1.0;
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelRef,
        clip: ["2", 0],
        lora_name: charLora,
        strength_model: strength,
        strength_clip: strength,
      },
    };
    modelRef = [id, 0];
  }

  if (useNsfw) {
    const id = String(nextId++);
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelRef,
        clip: ["2", 0],
        lora_name: "krea2/KNPV4.1_pre.safetensors",
        strength_model: 1.0,
        strength_clip: 1.0,
      },
    };
    modelRef = [id, 0];
  }

  for (const lora of opts.extraLoras || []) {
    const name = lora.name?.trim();
    if (!name) continue;
    const id = String(nextId++);
    const sm = lora.strength;
    const sc =
      typeof lora.strengthClip === "number" ? lora.strengthClip : Math.abs(sm);
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelRef,
        clip: ["2", 0],
        lora_name: name,
        strength_model: sm,
        strength_clip: sc,
      },
    };
    modelRef = [id, 0];
  }

  const skin = resolveSkinDetail({
    skinDetail: opts.skinDetail,
    skinDetailStrength: opts.skinDetailStrength,
  });
  if (skin.enabled) {
    const id = String(nextId++);
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelRef,
        clip: ["2", 0],
        lora_name: opts.skinDetailLoraName?.trim() || KREA_SKIN_DETAIL_LORA,
        strength_model: skin.strength,
        strength_clip: 0,
      },
    };
    modelRef = [id, 0];
  }

  graph["7"] = {
    class_type: "KSampler",
    inputs: {
      model: modelRef,
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: ["6", 0],
      seed,
      steps,
      cfg: 1.0,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1.0,
    },
  };
  graph["8"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["7", 0], vae: ["3", 0] },
  };
  graph["9"] = {
    class_type: "SaveImage",
    inputs: {
      images: ["8", 0],
      filename_prefix: opts.filenamePrefix || "peach/krea_still",
    },
  };

  return graph;
}

export function buildKreaEditGraph(opts: {
  imageName: string;
  editPrompt: string;
  width: number;
  height: number;
  seed?: number;
}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e15);
  return {
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
      inputs: { vae_name: "qwen_image_vae.safetensors" },
    },
    "4": { class_type: "LoadImage", inputs: { image: opts.imageName } },
    "5": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["1", 0],
        lora_name: "krea2/krea2_identity_edit_v1_2.safetensors",
        strength_model: 1.0,
      },
    },
    "6": {
      class_type: "VAEEncode",
      inputs: { pixels: ["4", 0], vae: ["3", 0] },
    },
    "7": {
      class_type: "EmptySD3LatentImage",
      inputs: { width: opts.width, height: opts.height, batch_size: 1 },
    },
    "8": {
      class_type: "Krea2EditModelPatch",
      inputs: {
        model: ["5", 0],
        source_latent: ["6", 0],
        ref_boost: 4.0,
        ref_boost_a: 1.0,
        fit_mode: "fit",
        vae: ["3", 0],
        source_image: ["4", 0],
        target_latent: ["7", 0],
      },
    },
    "9": {
      class_type: "Krea2EditGroundedEncode",
      inputs: {
        clip: ["2", 0],
        prompt: opts.editPrompt,
        image: ["4", 0],
        grounding_px: 768,
        system_prompt: "",
      },
    },
    "10": {
      class_type: "Krea2EditGroundedEncode",
      inputs: {
        clip: ["2", 0],
        prompt: "",
        image: ["4", 0],
        grounding_px: 768,
        system_prompt: "",
      },
    },
    "11": {
      class_type: "KSampler",
      inputs: {
        model: ["8", 0],
        positive: ["9", 0],
        negative: ["10", 0],
        latent_image: ["7", 0],
        seed,
        steps: 10,
        cfg: 1.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
      },
    },
    "12": {
      class_type: "VAEDecode",
      inputs: { samples: ["11", 0], vae: ["3", 0] },
    },
    "13": {
      class_type: "SaveImage",
      inputs: { images: ["12", 0], filename_prefix: "peach/krea_edit" },
    },
  };
}

/**
 * Dual-reference identity edit: scene (image A) + person (image B).
 * Training layout: scene = image 1, person = image 2 — order matters.
 * @see https://huggingface.co/conradlocke/krea2-identity-edit
 */
export function buildKreaDualRefEditGraph(opts: {
  sceneImageName: string;
  personImageName: string;
  editPrompt: string;
  width: number;
  height: number;
  seed?: number;
  refBoost?: number;
  refBoostA?: number;
  refBoostB?: number;
  groundingPx?: number;
  /** TG face template: positive on scene (pose). Default: person (legacy peach). */
  grounding?: "scene_pose" | "person_identity";
  useNsfwLora?: boolean;
  extraLoras?: Array<{
    name: string;
    strength: number;
    strengthClip?: number;
  }>;
}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e15);
  const refBoost = opts.refBoost ?? 4.0;
  const refBoostA = opts.refBoostA ?? 1.0;
  const refBoostB = opts.refBoostB ?? 1.0;
  const groundingPx = opts.groundingPx ?? 768;
  const scenePose = opts.grounding === "scene_pose";
  const positiveImage = scenePose ? ["4", 0] : ["5", 0];
  const negativeImage = scenePose ? ["5", 0] : ["4", 0];
  const useNsfw = opts.useNsfwLora !== false;

  const graph: Record<string, unknown> = {
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
      inputs: { vae_name: "qwen_image_vae.safetensors" },
    },
    "4": { class_type: "LoadImage", inputs: { image: opts.sceneImageName } },
    "5": { class_type: "LoadImage", inputs: { image: opts.personImageName } },
    "7": {
      class_type: "VAEEncode",
      inputs: { pixels: ["4", 0], vae: ["3", 0] },
    },
    "8": {
      class_type: "VAEEncode",
      inputs: { pixels: ["5", 0], vae: ["3", 0] },
    },
    "9": {
      class_type: "EmptySD3LatentImage",
      inputs: { width: opts.width, height: opts.height, batch_size: 1 },
    },
  };

  let clipRef: [string, number] = ["2", 0];
  let modelRef: [string, number] = ["1", 0];
  let nextId = 20;

  const stackLora = (
    loraName: string,
    strengthModel: number,
    strengthClip: number,
  ) => {
    const id = String(nextId++);
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelRef,
        clip: clipRef,
        lora_name: loraName,
        strength_model: strengthModel,
        strength_clip: strengthClip,
      },
    };
    modelRef = [id, 0];
    clipRef = [id, 1];
  };

  if (useNsfw) {
    stackLora("krea2/KNPV4.1_pre.safetensors", 1.0, 1.0);
  }

  for (const lora of opts.extraLoras || []) {
    const name = lora.name?.trim();
    if (!name) continue;
    const sm = lora.strength;
    const sc =
      typeof lora.strengthClip === "number" ? lora.strengthClip : Math.abs(sm);
    stackLora(name, sm, sc);
  }

  graph["6"] = {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      model: modelRef,
      lora_name: "krea2/krea2_identity_edit_v1_2.safetensors",
      strength_model: 1.0,
    },
  };

  graph["10"] = {
    class_type: "Krea2EditModelPatch",
    inputs: {
      model: ["6", 0],
      source_latent: ["7", 0],
      source_latent_b: ["8", 0],
      ref_boost: refBoost,
      ref_boost_a: refBoostA,
      ref_boost_b: refBoostB,
      fit_mode: "fit",
      vae: ["3", 0],
      source_image: ["4", 0],
      source_image_b: ["5", 0],
      target_latent: ["9", 0],
    },
  };
  graph["11"] = {
    class_type: "Krea2EditGroundedEncode",
    inputs: {
      clip: clipRef,
      prompt: opts.editPrompt,
      image: positiveImage,
      grounding_px: groundingPx,
      system_prompt: "",
    },
  };
  graph["12"] = {
    class_type: "Krea2EditGroundedEncode",
    inputs: {
      clip: clipRef,
      prompt: "",
      image: negativeImage,
      grounding_px: groundingPx,
      system_prompt: "",
    },
  };
  graph["13"] = {
    class_type: "KSampler",
    inputs: {
      model: ["10", 0],
      positive: ["11", 0],
      negative: ["12", 0],
      latent_image: ["9", 0],
      seed,
      steps: 10,
      cfg: 1.0,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1.0,
    },
  };
  graph["14"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["13", 0], vae: ["3", 0] },
  };
  graph["15"] = {
    class_type: "SaveImage",
    inputs: {
      images: ["14", 0],
      filename_prefix: "peach/krea_dual_edit",
    },
  };

  return graph;
}
