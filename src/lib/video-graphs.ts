/** API graphs: MiniMax H3 I2V, ACE-Step BGM, AutoEdit stitch, DJ BGM mix. */

import { CUMSHOT_LORA_NAME, CUMSHOT_LORA_STRENGTH } from "@/lib/cumshot-lora";
import type { MinimaxLoraSpec } from "@/lib/anatomy-loras";
import { STOCK_FL2VA_UNET_NAME } from "@/lib/minimax-base";

export { STOCK_FL2VA_UNET_NAME };

export const DEFAULT_BGM_TAGS =
  "slow sensual R&B, soft bass, intimate bedroom, sparse drums, warm pads, erotic mood, quiet background, instrumental only, no vocals";

export function minimaxSize(width?: number | null, height?: number | null) {
  const w = width || 888;
  const h = height || 1176;
  if (h >= w * 1.1) return { width: 768, height: 1344 };
  if (w >= h * 1.1) return { width: 1344, height: 768 };
  return { width: 768, height: 768 };
}

/** MiniMax H3 is 24fps; length is frame count (≈ sec*24+1). Clamp 4–12s. */
export function clampDurationSec(durationSec?: number | null) {
  const n = Number(durationSec);
  if (!Number.isFinite(n)) return 6;
  return Math.min(12, Math.max(4, Math.round(n)));
}

export function minimaxLengthFromSec(durationSec?: number | null) {
  const sec = clampDurationSec(durationSec);
  return sec * 24 + 1;
}

export function minimaxPrompt(plot: string, durationSec = 6) {
  const sec = clampDurationSec(durationSec);
  return `${plot.trim()}

Natural photorealistic motion, subtle camera, breathing, skin detail.
About ${sec} seconds.
Audio: natural intimate ambience matching the scene. If speech is implied, one short spoken line. No extra people, no on-screen text.`;
}

export function scenePlots(plot: string, n: number): string[] {
  const parts = plot
    .split(/\n+|→|—>/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= n) return parts.slice(0, n);
  const out = [...parts];
  while (out.length < n) {
    out.push(`${plot.trim()} — scene ${out.length + 1}/${n}, continue the same encounter`);
  }
  return out;
}

export function buildMinimaxI2VGraph(opts: {
  imageName: string;
  prompt: string;
  width: number;
  height: number;
  length?: number;
  seed?: number;
  steps?: number;
  filenamePrefix?: string;
  /** Chain of UNET-only LoRAs (anatomy then optional cumshot). */
  loras?: MinimaxLoraSpec[];
  /** Epic Cumshots MiniMax LoRA (male orgasm). Applied to UNET only. */
  useCumshotLora?: boolean;
  cumshotLoraName?: string;
  cumshotLoraStrength?: number;
  /** Override diffusion UNET (default stock FL2VA). */
  unetName?: string;
  /** KSamplerSelect sampler_name (default res_multistep). */
  samplerName?: string;
  /** BasicScheduler name (default simple). */
  schedulerName?: string;
}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e15);
  const length = opts.length ?? 124;
  const steps = opts.steps ?? 20;
  const samplerName = opts.samplerName?.trim() || "res_multistep";
  const schedulerName = opts.schedulerName?.trim() || "simple";
  const unetName = opts.unetName?.trim() || STOCK_FL2VA_UNET_NAME;
  const loras: MinimaxLoraSpec[] = [...(opts.loras || [])];
  if (
    opts.useCumshotLora &&
    !loras.some((l) => /cumshot|CUMSH0T/i.test(l.name))
  ) {
    loras.push({
      name: opts.cumshotLoraName?.trim() || CUMSHOT_LORA_NAME,
      strength:
        typeof opts.cumshotLoraStrength === "number"
          ? opts.cumshotLoraStrength
          : CUMSHOT_LORA_STRENGTH,
    });
  }
  const lastLoraId = loras.length ? `lora_${loras.length - 1}` : "";
  const modelRef: [string, number] = lastLoraId ? [lastLoraId, 0] : ["unet", 0];
  const graph: Record<string, unknown> = {
    load: { class_type: "LoadImage", inputs: { image: opts.imageName } },
    scale: {
      class_type: "ImageScale",
      inputs: {
        image: ["load", 0],
        upscale_method: "lanczos",
        width: opts.width,
        height: opts.height,
        crop: "center",
      },
    },
    unet: {
      class_type: "UNETLoader",
      inputs: {
        unet_name: unetName,
        weight_dtype: "default",
      },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        type: "minimax",
        device: "default",
      },
    },
    vae_v: {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
    },
    vae_a: {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
    },
    i2v: {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["clip", 0],
        vae: ["vae_v", 0],
        first_frame: ["scale", 0],
        prompt: opts.prompt,
        width: opts.width,
        height: opts.height,
        length,
      },
    },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: samplerName } },
    sigmas: {
      class_type: "BasicScheduler",
      inputs: {
        model: modelRef,
        scheduler: schedulerName,
        steps,
        denoise: 1.0,
      },
    },
    guider: {
      class_type: "BasicGuider",
      inputs: { model: modelRef, conditioning: ["i2v", 0] },
    },
    sample: {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler", 0],
        sigmas: ["sigmas", 0],
        latent_image: ["i2v", 1],
      },
    },
    frames: {
      class_type: "VAEDecode",
      inputs: { samples: ["sample", 0], vae: ["vae_v", 0] },
    },
    audio: {
      class_type: "VAEDecodeAudio",
      inputs: { samples: ["sample", 0], vae: ["vae_a", 0] },
    },
    video: {
      class_type: "CreateVideo",
      inputs: {
        images: ["frames", 0],
        audio: ["audio", 0],
        fps: 24,
        bit_depth: 8,
      },
    },
    save: {
      class_type: "SaveVideo",
      inputs: {
        video: ["video", 0],
        filename_prefix: opts.filenamePrefix || "peach/clip",
        format: "auto",
        codec: "auto",
      },
    },
  };
  loras.forEach((lora, i) => {
    graph[`lora_${i}`] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: i === 0 ? ["unet", 0] : [`lora_${i - 1}`, 0],
        lora_name: lora.name,
        strength_model: lora.strength,
      },
    };
  });
  return graph;
}

/**
 * MiniMax H3 Ref2V — image-to-video using reference photos for identity.
 * Uses minimax_h3_ref2va_pruned_fp8_scaled (the Ref2VA model, not FL2VA).
 *
 * ref_images: ComfyUI input filenames of character reference photos (0-9).
 * ref_videos: optional driving/motion reference videos (loaded as IMAGE batches).
 * ref_video_audios: optional audio tracks paired with ref videos.
 * contextImageName: optional last-frame PNG of the previous clip for continuity.
 */
export function buildMinimaxRef2VGraph(opts: {
  refImageNames: string[];
  refVideoNames?: string[];
  refVideoAudioNames?: string[];
  contextImageName?: string;
  prompt: string;
  width: number;
  height: number;
  length?: number;
  seed?: number;
  steps?: number;
  filenamePrefix?: string;
  loras?: MinimaxLoraSpec[];
  useCumshotLora?: boolean;
  cumshotLoraName?: string;
  cumshotLoraStrength?: number;
  /** Frames to pull from each ref video (defaults to length). */
  refVideoFrameCap?: number;
  /** Override diffusion UNET (default stock Ref2VA). */
  unetName?: string;
  /** KSamplerSelect sampler_name (default res_multistep). */
  samplerName?: string;
  /** BasicScheduler name (default simple). */
  schedulerName?: string;
}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e15);
  const length = opts.length ?? 124;
  const steps = opts.steps ?? 20;
  const samplerName = opts.samplerName?.trim() || "res_multistep";
  const schedulerName = opts.schedulerName?.trim() || "simple";
  const refVideoFrameCap = opts.refVideoFrameCap ?? length;
  const loras: MinimaxLoraSpec[] = [...(opts.loras || [])];
  if (
    opts.useCumshotLora &&
    !loras.some((l) => /cumshot|CUMSH0T/i.test(l.name))
  ) {
    loras.push({
      name: opts.cumshotLoraName?.trim() || CUMSHOT_LORA_NAME,
      strength:
        typeof opts.cumshotLoraStrength === "number"
          ? opts.cumshotLoraStrength
          : CUMSHOT_LORA_STRENGTH,
    });
  }
  const lastLoraId = loras.length ? `lora_${loras.length - 1}` : "";
  const modelRef: [string, number] = lastLoraId ? [lastLoraId, 0] : ["unet", 0];
  const refVideos = (opts.refVideoNames || []).filter(Boolean).slice(0, 3);
  const refAudios = (opts.refVideoAudioNames || []).filter(Boolean).slice(0, 3);
  const unetName =
    opts.unetName?.trim() || "minimax_h3_ref2va_pruned_fp8_scaled.safetensors";

  const graph: Record<string, unknown> = {
    unet: {
      class_type: "UNETLoader",
      inputs: {
        unet_name: unetName,
        weight_dtype: "default",
      },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        type: "minimax",
        device: "default",
      },
    },
    vae_v: {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
    },
    vae_a: {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
    },
  };

  // Load each reference image (characters)
  opts.refImageNames.forEach((name, i) => {
    graph[`load_ref_${i}`] = {
      class_type: "LoadImage",
      inputs: { image: name },
    };
  });

  // Optional context frame (last frame of previous clip for visual continuity)
  if (opts.contextImageName) {
    graph.load_ctx = {
      class_type: "LoadImage",
      inputs: { image: opts.contextImageName },
    };
  }

  // Motion / style reference videos → IMAGE batch for ref_videos.*
  refVideos.forEach((name, i) => {
    graph[`load_refvid_${i}`] = {
      class_type: "VHS_LoadVideo",
      inputs: {
        video: name,
        force_rate: 24,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: refVideoFrameCap,
        skip_first_frames: 0,
        select_every_nth: 1,
        format: "AnimateDiff",
      },
    };
  });

  refAudios.forEach((name, i) => {
    graph[`load_refaud_${i}`] = {
      class_type: "LoadAudio",
      inputs: { audio: name },
    };
  });

  // Build Ref2V conditioning inputs
  const ref2vInputs: Record<string, unknown> = {
    clip: ["clip", 0],
    vae: ["vae_v", 0],
    audio_vae: ["vae_a", 0],
    prompt: opts.prompt,
    width: opts.width,
    height: opts.height,
    length,
    ref_image_size: "match",
  };
  opts.refImageNames.forEach((_, i) => {
    ref2vInputs[`ref_images.ref_image_${i}`] = [`load_ref_${i}`, 0];
  });
  // Context frame appended after character refs
  if (opts.contextImageName) {
    const ctxIdx = opts.refImageNames.length;
    ref2vInputs[`ref_images.ref_image_${ctxIdx}`] = ["load_ctx", 0];
  }
  refVideos.forEach((_, i) => {
    ref2vInputs[`ref_videos.ref_video_${i}`] = [`load_refvid_${i}`, 0];
  });
  refAudios.forEach((_, i) => {
    ref2vInputs[`ref_video_audios.ref_video_audio_${i}`] = [`load_refaud_${i}`, 0];
  });

  graph.ref2v = {
    class_type: "MiniMaxH3ReferenceToVideo",
    inputs: ref2vInputs,
  };

  graph.noise = { class_type: "RandomNoise", inputs: { noise_seed: seed } };
  graph.sampler = { class_type: "KSamplerSelect", inputs: { sampler_name: samplerName } };
  graph.sigmas = {
    class_type: "BasicScheduler",
    inputs: { model: modelRef, scheduler: schedulerName, steps, denoise: 1.0 },
  };
  graph.guider = {
    class_type: "BasicGuider",
    inputs: { model: modelRef, conditioning: ["ref2v", 0] },
  };
  graph.sample = {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise: ["noise", 0],
      guider: ["guider", 0],
      sampler: ["sampler", 0],
      sigmas: ["sigmas", 0],
      latent_image: ["ref2v", 1],
    },
  };
  graph.frames = {
    class_type: "VAEDecode",
    inputs: { samples: ["sample", 0], vae: ["vae_v", 0] },
  };
  graph.audio = {
    class_type: "VAEDecodeAudio",
    inputs: { samples: ["sample", 0], vae: ["vae_a", 0] },
  };
  graph.video = {
    class_type: "CreateVideo",
    inputs: { images: ["frames", 0], audio: ["audio", 0], fps: 24, bit_depth: 8 },
  };
  graph.save = {
    class_type: "SaveVideo",
    inputs: {
      video: ["video", 0],
      filename_prefix: opts.filenamePrefix || "peach/ref2v",
      format: "auto",
      codec: "auto",
    },
  };

  loras.forEach((lora, i) => {
    graph[`lora_${i}`] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: i === 0 ? ["unet", 0] : [`lora_${i - 1}`, 0],
        lora_name: lora.name,
        strength_model: lora.strength,
      },
    };
  });

  return graph;
}

export function buildAceStepGraph(opts: {
  tags?: string;
  seconds?: number;
  seed?: number;
  filenamePrefix?: string;
}) {
  const seconds = opts.seconds ?? 12;
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "ace_step_1.5_turbo_aio.safetensors" },
    },
    "2": {
      class_type: "TextEncodeAceStepAudio1.5",
      inputs: {
        clip: ["1", 1],
        tags: opts.tags || DEFAULT_BGM_TAGS,
        lyrics: "[inst]",
        seed,
        bpm: 78,
        duration: seconds,
        timesignature: "4",
        language: "en",
        keyscale: "C minor",
        generate_audio_codes: true,
        cfg_scale: 2.0,
        temperature: 0.85,
        top_p: 0.9,
        top_k: 0,
        min_p: 0.0,
      },
    },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "" } },
    "4": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["3", 0] } },
    "5": {
      class_type: "EmptyAceStep1.5LatentAudio",
      inputs: { seconds, batch_size: 1 },
    },
    "6": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["4", 0],
        latent_image: ["5", 0],
        seed,
        steps: 8,
        cfg: 1.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
      },
    },
    "7": { class_type: "VAEDecodeAudio", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": {
      class_type: "SaveAudio",
      inputs: {
        audio: ["7", 0],
        filename_prefix: opts.filenamePrefix || "audio/peach_bgm",
      },
    },
  } as Record<string, unknown>;
}

export function buildStitchGraph(opts: {
  directoryPath: string;
  filenamePrefix?: string;
  trimStart?: boolean;
  trimStartSec?: number;
}) {
  return {
    "1": {
      class_type: "AutoEditWorkbench",
      inputs: {
        directory_path: opts.directoryPath,
        sort_strategy: "alphabetical_asc",
        resize_mode: "Crop (Fill Screen)",
        resolution_strategy: "First Video",
        custom_width: 768,
        custom_height: 1344,
        fps_strategy: "First Video",
        custom_fps: 24,
        limit_duration_sec: 0.0,
        trim_start: opts.trimStart !== false,
        trim_start_sec: opts.trimStartSec ?? 1.0,
      },
    },
    "2": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["1", 0],
        audio: ["1", 1],
        frame_rate: ["1", 2],
        loop_count: 0,
        filename_prefix: opts.filenamePrefix || "peach/stitch",
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf: 19,
        save_metadata: true,
        pingpong: false,
        save_output: true,
      },
    },
  } as Record<string, unknown>;
}

export function buildBgmMixGraph(opts: {
  videoPath: string;
  audioPath: string;
  filenamePrefix?: string;
  bgmVolume?: number;
}) {
  return {
    "1": {
      class_type: "VHS_LoadVideoPath",
      inputs: {
        video: opts.videoPath,
        force_rate: 0,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
        format: "None",
      },
    },
    "2": {
      class_type: "VHS_LoadAudio",
      inputs: {
        audio_file: opts.audioPath,
        seek_seconds: 0,
        duration: 0,
      },
    },
    "3": {
      class_type: "DJ_VideoAudioMixer",
      inputs: {
        images1: ["1", 0],
        video_info1: ["1", 3],
        audio1: ["1", 2],
        bgm: ["2", 0],
        bgm_mode: "all",
        bgm_volume: opts.bgmVolume ?? 0.2,
        fade_in_sec: 1.0,
        fade_out_sec: 1.5,
        audio_match_method: "repeat_audio",
      },
    },
    "4": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["3", 0],
        audio: ["3", 1],
        frame_rate: 24,
        loop_count: 0,
        filename_prefix: opts.filenamePrefix || "peach/with_bgm",
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf: 19,
        save_metadata: true,
        pingpong: false,
        save_output: true,
      },
    },
  } as Record<string, unknown>;
}

export const WAN_ANIMATE2_DEFAULT_POSITIVE =
  "photorealistic young adult woman, natural skin, same person as reference image, clean background matching the still";

export const WAN_ANIMATE2_DEFAULT_NEGATIVE =
  "blurry, low quality, watermark, text, logo, extra limbs, deformed hands, duplicate face, morphing identity";

export const WAN_ANIMATE2_DEFAULT_POSE =
  "Natural full-body motion following the driving video, matching body movement, posture, arm gestures, leg movement, and timing.";

/**
 * Wan Animate 2 motion transfer: reference still + driving video frames → new clip.
 * Uses INT8 + LightX2V distill LoRA (fast path: ~6 steps, CFG 1).
 */
export function buildWanAnimate2Graph(opts: {
  referenceImageName: string;
  drivingVideoName: string;
  positive?: string;
  negative?: string;
  posePrompt?: string;
  width?: number;
  height?: number;
  length?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  fps?: number;
  frameLoadCap?: number;
  skipFirstFrames?: number;
  videoFrameOffset?: number;
  filenamePrefix?: string;
  unetName?: string;
  loraName?: string;
  loraStrength?: number;
  clipName?: string;
  vaeName?: string;
  clipVisionName?: string;
}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e15);
  const width = opts.width ?? 832;
  const height = opts.height ?? 480;
  const length = opts.length ?? 81;
  const steps = opts.steps ?? 6;
  const cfg = opts.cfg ?? 1;
  const fps = opts.fps ?? 16;
  const frameLoadCap = opts.frameLoadCap ?? length;
  const skipFirstFrames = opts.skipFirstFrames ?? 0;
  const videoFrameOffset = opts.videoFrameOffset ?? 0;
  const positive = (opts.positive || WAN_ANIMATE2_DEFAULT_POSITIVE).trim();
  const negative = (opts.negative || WAN_ANIMATE2_DEFAULT_NEGATIVE).trim();
  const posePrompt = (opts.posePrompt || WAN_ANIMATE2_DEFAULT_POSE).trim();
  const unetName =
    opts.unetName || "wan_animate_2_int8_convrot.safetensors";
  const loraName =
    opts.loraName ||
    "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors";
  const clipName =
    opts.clipName || "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
  const vaeName = opts.vaeName || "Wan2_1_VAE_bf16.safetensors";
  const clipVisionName = opts.clipVisionName || "clip_vision_h.safetensors";

  return {
    unet: {
      class_type: "UNETLoader",
      inputs: { unet_name: unetName, weight_dtype: "default" },
    },
    lora: {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["unet", 0],
        lora_name: loraName,
        strength_model: opts.loraStrength ?? 1.0,
      },
    },
    sampling: {
      class_type: "ModelSamplingSD3",
      inputs: { model: ["lora", 0], shift: 8 },
    },
    cache: {
      class_type: "WanAnimate2Cache",
      inputs: { model: ["sampling", 0], device: "cpu", dtype: "default" },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: { clip_name: clipName, type: "wan", device: "default" },
    },
    vae: {
      class_type: "VAELoader",
      inputs: { vae_name: vaeName },
    },
    clip_vision: {
      class_type: "CLIPVisionLoader",
      inputs: { clip_name: clipVisionName },
    },
    load_ref: {
      class_type: "LoadImage",
      inputs: { image: opts.referenceImageName },
    },
    cv_enc: {
      class_type: "CLIPVisionEncode",
      inputs: {
        clip_vision: ["clip_vision", 0],
        image: ["load_ref", 0],
        crop: "center",
      },
    },
    load_drive: {
      class_type: "VHS_LoadVideo",
      inputs: {
        video: opts.drivingVideoName,
        force_rate: fps,
        custom_width: width,
        custom_height: height,
        frame_load_cap: frameLoadCap,
        skip_first_frames: skipFirstFrames,
        select_every_nth: 1,
        format: "Wan",
      },
    },
    pos: {
      class_type: "CLIPTextEncode",
      inputs: { text: positive, clip: ["clip", 0] },
    },
    neg: {
      class_type: "CLIPTextEncode",
      inputs: { text: negative, clip: ["clip", 0] },
    },
    pose_txt: {
      class_type: "CLIPTextEncode",
      inputs: { text: posePrompt, clip: ["clip", 0] },
    },
    wa2: {
      class_type: "WanAnimate2ToVideo",
      inputs: {
        positive: ["pos", 0],
        negative: ["neg", 0],
        vae: ["vae", 0],
        width,
        height,
        length,
        batch_size: 1,
        video_frame_offset: videoFrameOffset,
        pose_strength: 1.0,
        pose_start_percent: 0.0,
        pose_end_percent: 1.0,
        reference_image_strength: 1.0,
        reference_image: ["load_ref", 0],
        pose_video: ["load_drive", 0],
        clip_vision_output: ["cv_enc", 0],
        positive_pose: ["pose_txt", 0],
      },
    },
    sample: {
      class_type: "KSampler",
      inputs: {
        model: ["cache", 0],
        seed,
        steps,
        cfg,
        sampler_name: "lcm",
        scheduler: "simple",
        positive: ["wa2", 0],
        negative: ["wa2", 1],
        latent_image: ["wa2", 2],
        denoise: 1.0,
      },
    },
    decode: {
      class_type: "VAEDecode",
      inputs: { samples: ["sample", 0], vae: ["vae", 0] },
    },
    video: {
      class_type: "CreateVideo",
      inputs: { images: ["decode", 0], fps, bit_depth: 8 },
    },
    save: {
      class_type: "SaveVideo",
      inputs: {
        video: ["video", 0],
        filename_prefix: opts.filenamePrefix || "peach/motion",
        format: "auto",
        codec: "auto",
      },
    },
  } as Record<string, unknown>;
}
