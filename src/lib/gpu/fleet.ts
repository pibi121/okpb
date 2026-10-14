/**
 * Extra Metalnode GPUs alongside primary (:8188).
 * Keys live in Railway env; tunnels map to local :8189 / :8190 / :8191.
 *
 * Policy: when only primary is live, leave fleet keys empty / genPreferred off.
 * Fleet cards are optional overflow — not preferred while single-GPU.
 * `ownerlab` (pool lab) is Owner Lab only — never genPreferred, never user funnel.
 * Opt-in: set OWNERLAB_GPU_ENABLED=1 and METALNODE_SSH_KEY_OWNERLAB; otherwise Lab
 * shares the primary Metalnode pool (same GPU as users).
 */
import type { GpuPool } from "@/lib/gpu/types";

/** Second GPU for Owner Lab — off until explicitly re-enabled. */
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
    // Was genPreferred while dual-GPU; off until a second live node is back.
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
    key: "ownerlab",
    label: "Metalnode Owner Lab (22026)",
    localPort: 8191,
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
