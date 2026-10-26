import { buildMinimaxRef2VGraph } from "@/lib/video-graphs";
import {
  POSE_BAKED_REFS,
  POSE_HEIGHT,
  POSE_LENGTH,
  POSE_WIDTH,
  posePrompt,
} from "@/lib/pose-constructor/catalog";

type GraphNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

/** Test recipe: int8 ref2v, Unlocked 0.5, turbo 1, realism 1, 8 steps, shift 12/6. */
export function buildPoseClipGraph(opts: {
  girlImage: string;
  manImage: string;
  poseId: string;
  seed?: number;
}): Record<string, unknown> {
  const graph = buildMinimaxRef2VGraph({
    refImageNames: [opts.girlImage, opts.manImage, ...POSE_BAKED_REFS],
    prompt: posePrompt(opts.poseId),
    width: POSE_WIDTH,
    height: POSE_HEIGHT,
    length: POSE_LENGTH,
    seed: opts.seed,
    steps: 8,
    samplerName: "euler_ancestral",
    schedulerName: "simple",
    unetName: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    filenamePrefix: `peach/pose/${opts.poseId}`,
    loras: [
      { name: "Minimax_H3_Unlocked_V2.1.safetensors", strength: 0.5 },
      {
        name: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
        strength: 1,
      },
      { name: "MMH3-RealismSlider-V1.safetensors", strength: 1 },
    ],
  }) as Record<string, GraphNode>;

  const model = graph.guider?.inputs?.model;
  graph.shift = {
    class_type: "MiniMaxH3SigmaShift",
    inputs: { model, shift_video: 12, shift_audio: 6 },
  };
  if (graph.guider?.inputs) graph.guider.inputs.model = ["shift", 0];
  if (graph.sigmas?.inputs) graph.sigmas.inputs.model = ["shift", 0];
  return graph;
}
