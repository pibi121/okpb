/** H3 Eros Max — alternative MiniMax base (checkpoint, not LoRA). */

/** BF16 hybrid beta3 (same as local Downloads/h3ErosMax_beta3.safetensors). */
export const EROS_MAX_UNET_NAME = "h3ErosMax_beta3.safetensors";
/** INT8 ConvRot beta3 — lighter VRAM, same family. */
export const EROS_MAX_INT8_UNET_NAME = "h3ErosMax_beta3_int8_convrot.safetensors";
export const STOCK_REF2VA_UNET_NAME =
  "minimax_h3_ref2va_pruned_fp8_scaled.safetensors";
/** Stock MiniMax H3 I2V (gallery «Оживить») — FL2VA, not Ref2VA. */
export const STOCK_FL2VA_UNET_NAME =
  "minimax_h3_fl2va_pruned_fp8_scaled.safetensors";

export type MinimaxBaseId = "stock_ref2va" | "eros_max" | "eros_max_int8";

export function resolveMinimaxUnet(base?: MinimaxBaseId | string | null): {
  unetName: string;
  baseId: MinimaxBaseId;
  engineTag: string;
} {
  if (base === "eros_max_int8") {
    return {
      unetName: EROS_MAX_INT8_UNET_NAME,
      baseId: "eros_max_int8",
      engineTag: "+eros_max_int8",
    };
  }
  if (base === "eros_max") {
    return {
      unetName: EROS_MAX_UNET_NAME,
      baseId: "eros_max",
      engineTag: "+eros_max",
    };
  }
  return {
    unetName: STOCK_REF2VA_UNET_NAME,
    baseId: "stock_ref2va",
    engineTag: "",
  };
}

/** I2V: stock = FL2VA; eros* = Eros Max checkpoint (experimental on ImageToVideo). */
export function resolveMinimaxI2VUnet(base?: MinimaxBaseId | string | null): {
  unetName: string;
  baseId: MinimaxBaseId | "stock_fl2va";
  engineTag: string;
} {
  if (base === "eros_max_int8") {
    return {
      unetName: EROS_MAX_INT8_UNET_NAME,
      baseId: "eros_max_int8",
      engineTag: "+eros_max_int8",
    };
  }
  if (base === "eros_max") {
    return {
      unetName: EROS_MAX_UNET_NAME,
      baseId: "eros_max",
      engineTag: "+eros_max",
    };
  }
  return {
    unetName: STOCK_FL2VA_UNET_NAME,
    baseId: "stock_fl2va",
    engineTag: "",
  };
}
