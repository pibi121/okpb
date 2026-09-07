import fs from "fs";

const STATUS_PATH =
  process.env.PEACH_TUNNEL_STATUS_PATH || "/tmp/peach-tunnel-status.json";

export type TunnelStatus = {
  ok?: boolean;
  reason?: string;
  error?: string;
  raw?: string;
  updatedAt?: string;
  host?: string;
  sshPort?: string | number;
  comfyUrl?: string;
  exitCode?: number;
};

export function readTunnelStatusFile(): TunnelStatus | null {
  try {
    if (!fs.existsSync(STATUS_PATH)) return null;
    return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")) as TunnelStatus;
  } catch {
    return null;
  }
}
