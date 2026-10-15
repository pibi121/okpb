/**
 * Extra Metalnode GPUs alongside primary (:8188).
 * Keys live in Railway env; tunnels map to local :8189 / :8190 / :8191.
 *
 * Policy: when only primary is live, leave fleet keys empty / genPreferred off.
 * `gpu2` (22026 → :8191) is user photo/video preferred when keyed — keeps primary
 * free for LoRA train / heavy overflow.
 * Legacy `ownerlab` lab-only pool stays opt-in via OWNERLAB_GPU_ENABLED=1.
 */
import type { GpuPool } from "@/lib/gpu/types";

/** Dedicated Owner Lab pool (legacy) — off unless explicitly re-enabled. */
export function ownerLabGpuEnabled(): boolean {
  return process.env.OWNERLAB_GPU_ENABLED === "1";
}

export type FleetGpu = {
  key: string;
  label: string;
  localPort: number;
  sshPort: number;
  host?: string;
  keyEnv: string;
  keyPath: string;
  pool: "any" | "photo" | "video" | "lora" | "lab";
  /** Prefer this node for LoRA train SSH. */
  loraPreferred?: boolean;
  /** Prefer this node for user photo/video gens when online. */
  genPreferred?: boolean;
  /** Owner Lab only — excluded from user/funnel pickWorker. */
  labOnly?: boolean;
};

export const FLEET_EXTRA_GPUS: FleetGpu[] = [
  {
    key: "bmserv4",
    label: "Metalnode bmserv4",
    localPort: 8189,
    sshPort: 22031,
    keyEnv: "METALNODE_SSH_KEY_BMSERV4",
    keyPath: "/tmp/metalnode_key_bmserv4",
    pool: "any",
  },
  {
    key: "bmserv1",
    label: "Metalnode bmserv1",
    localPort: 8190,
    sshPort: 22022,
    keyEnv: "METALNODE_SSH_KEY_BMSERV1",
    keyPath: "/tmp/metalnode_key_bmserv1",
    pool: "any",
  },
  {
    key: "gpu2",
    label: "Metalnode GPU2 (22026)",
    localPort: 8191,
    sshPort: 22026,
    keyEnv: "METALNODE_SSH_KEY_GPU2",
    keyPath: "/tmp/metalnode_key_gpu2",
    pool: "any",
    genPreferred: true,
  },
  {
    key: "ownerlab",
    label: "Metalnode Owner Lab (legacy)",
    localPort: 8192,
    sshPort: 22026,
    keyEnv: "METALNODE_SSH_KEY_OWNERLAB",
    keyPath: "/tmp/metalnode_key_ownerlab",
    pool: "lab",
    labOnly: true,
  },
];

export function fleetComfyUrl(g: FleetGpu): string {
  return `http://127.0.0.1:${g.localPort}`;
}

export function fleetConfigured(g: FleetGpu): boolean {
  if (g.labOnly && !ownerLabGpuEnabled()) return false;
  return Boolean(process.env[g.keyEnv]?.trim());
}

export function ownerLabFleet(): FleetGpu | null {
  if (!ownerLabGpuEnabled()) return null;
  const hit = FLEET_EXTRA_GPUS.find((g) => g.labOnly && fleetConfigured(g));
  return hit || null;
}

/** When Owner Lab GPU is enabled+keyed, Lab jobs use pool `lab`; else primary pools. */
export function ownerLabPoolOr(fallback: GpuPool): GpuPool {
  return ownerLabFleet() ? "lab" : fallback;
}

export function loraPreferredFleet(): FleetGpu | null {
  const hit = FLEET_EXTRA_GPUS.find((g) => g.loraPreferred && fleetConfigured(g));
  return hit || null;
}

export function genPreferredFleet(): FleetGpu | null {
  const hit = FLEET_EXTRA_GPUS.find((g) => g.genPreferred && fleetConfigured(g));
  return hit || null;
}

/** Keys of online-capable genPreferred fleet cards (for pickWorker sticky routing). */
export function genPreferredKeys(): string[] {
  return FLEET_EXTRA_GPUS.filter((g) => g.genPreferred && fleetConfigured(g)).map(
    (g) => g.key,
  );
}
