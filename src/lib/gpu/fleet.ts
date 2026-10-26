/**
 * Extra Metalnode GPUs alongside primary (:8188).
 * Keys live in Railway env; tunnels map to local :8189 / :8190 / :8191 / :8192.
 *
 * Policy: when only primary is live, leave fleet keys empty / genPreferred off.
 * Fleet cards are optional overflow — not preferred while single-GPU.
 * `gpu2` is the second user card (METALNODE_SSH_KEY_GPU2). Same user pools as
 * primary; pickWorker spreads free Metalnodes by LRU (not sticky primary).
 * Never genPreferred. Never the lab pool.
 * `ownerlab` (pool lab) is Owner Lab only — never genPreferred, never user funnel.
 */
import type { GpuPool } from "@/lib/gpu/types";

export type FleetGpu = {
  key: string;
  label: string;
  localPort: number;
  sshPort: number;
  host?: string;
  keyEnv: string;
  keyPath: string;
  pool: "any" | "photo" | "video" | "lora" | "lab" | "pose";
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
    key: "gpu2",
    label: "Metalnode GPU2",
    localPort: 8192,
    sshPort: 22026,
    keyEnv: "METALNODE_SSH_KEY_GPU2",
    keyPath: "/tmp/metalnode_key_gpu2",
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
  {
    key: "poselab",
    label: "Metalnode Pose Lab (22034)",
    localPort: 8193,
    sshPort: 22034,
    keyEnv: "METALNODE_SSH_KEY_POSELAB",
    keyPath: "/tmp/metalnode_key_poselab",
    pool: "pose",
    labOnly: true,
  },
];

export function fleetComfyUrl(g: FleetGpu): string {
  return `http://127.0.0.1:${g.localPort}`;
}

export function fleetConfigured(g: FleetGpu): boolean {
  return Boolean(process.env[g.keyEnv]?.trim());
}

export function ownerLabFleet(): FleetGpu | null {
  const hit = FLEET_EXTRA_GPUS.find((g) => g.labOnly && fleetConfigured(g));
  return hit || null;
}

/** When Owner Lab GPU key is set, Lab jobs use pool `lab`; else keep legacy pool. */
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
