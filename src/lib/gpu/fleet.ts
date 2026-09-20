/**
 * Extra Metalnode GPUs alongside primary (:8188).
 * Keys live in Railway env; tunnels map to local :8189 / :8190.
 *
 * Policy: when only primary is live, leave fleet keys empty / genPreferred off.
 * Fleet cards are optional overflow — not preferred while single-GPU.
 */
export type FleetGpu = {
  key: string;
  label: string;
  localPort: number;
  sshPort: number;
  host?: string;
  keyEnv: string;
  keyPath: string;
  pool: "any" | "photo" | "video" | "lora";
  /** Prefer this node for LoRA train SSH. */
  loraPreferred?: boolean;
  /** Prefer this node for user photo/video gens when online. */
  genPreferred?: boolean;
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
];

export function fleetComfyUrl(g: FleetGpu): string {
  return `http://127.0.0.1:${g.localPort}`;
}

export function fleetConfigured(g: FleetGpu): boolean {
  return Boolean(process.env[g.keyEnv]?.trim());
}

export function loraPreferredFleet(): FleetGpu | null {
  const hit = FLEET_EXTRA_GPUS.find((g) => g.loraPreferred && fleetConfigured(g));
  return hit || null;
}

export function genPreferredFleet(): FleetGpu | null {
  const hit = FLEET_EXTRA_GPUS.find((g) => g.genPreferred && fleetConfigured(g));
  return hit || null;
}
