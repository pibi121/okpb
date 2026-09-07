/**
 * Quick Metalnode reconfiguration when GPU instance changes (non-payment, new key/port).
 *
 * GPU (Comfy + optional local Ollama):
 *   node scripts/metalnode-switch.mjs --gpu-host 1.2.3.4 --gpu-port 22034 --key "C:\path\key"
 *
 * LLM node only (second GPU):
 *   node scripts/metalnode-switch.mjs --llm-only --llm-host 5.6.7.8 --llm-port 22 --llm-key "C:\path\llm.key" --llm-tunnel-port 11435
 *
 * Then: node scripts/metalnode-tunnel.mjs  (and restart Next if needed)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GPU_CFG = path.join(ROOT, "infra", "metalnode.local.json");
const LLM_CFG = path.join(ROOT, "infra", "metalnode.llm.json");
const PUBLIC_KEY = path.join("C:", "Users", "Public", "metalnode.key");
const PUBLIC_LLM_KEY = path.join("C:", "Users", "Public", "metalnode-llm.key");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function copyKey(src, dest) {
  if (!src || !fs.existsSync(src)) {
    console.error(`Key not found: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Key copied → ${dest}`);
}

function loadJson(p, fallback = {}) {
  if (!fs.existsSync(p)) return { ...fallback };
  return { ...fallback, ...JSON.parse(fs.readFileSync(p, "utf8")) };
}

function saveJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(`Updated ${p}`);
}

const gpuOnly = !process.argv.includes("--llm-only");
const llmOnly = process.argv.includes("--llm-only");

if (gpuOnly) {
  const host = arg("--gpu-host") || arg("--host");
  const port = arg("--gpu-port") || arg("--port");
  const key = arg("--key") || arg("--gpu-key");
  if (!host) {
    console.error("Usage: --gpu-host IP [--gpu-port N] [--key path]");
    process.exit(1);
  }
  if (key) copyKey(key, PUBLIC_KEY);
  const cfg = loadJson(GPU_CFG, {
    host: "",
    sshPort: 22,
    sshUser: "root",
    sshKeyPath: PUBLIC_KEY.replace(/\\/g, "\\\\"),
    comfyUrl: "http://127.0.0.1:8188",
    ollamaUrl: "http://127.0.0.1:11434",
    tunnels: [8188, 8080, 8090, 11434],
  });
  cfg.host = host;
  if (port) cfg.sshPort = Number(port);
  cfg.sshKeyPath = PUBLIC_KEY.replace(/\\/g, "\\\\");
  cfg.notes = `Switched ${new Date().toISOString().slice(0, 10)} — ${host}:${cfg.sshPort}`;
  saveJson(GPU_CFG, cfg);
}

if (llmOnly || arg("--llm-host")) {
  const llmHost = arg("--llm-host");
  const llmPort = arg("--llm-port");
  const llmKey = arg("--llm-key");
  const tunnelPort = arg("--llm-tunnel-port") || "11435";
  if (!llmHost) {
    console.error("LLM: --llm-host IP [--llm-port N] [--llm-key key] [--llm-tunnel-port 11435]");
    process.exit(1);
  }
  if (llmKey) copyKey(llmKey, PUBLIC_LLM_KEY);
  const llm = {
    llmHost,
    llmSshPort: llmPort ? Number(llmPort) : 22,
    llmSshKeyPath: PUBLIC_LLM_KEY.replace(/\\/g, "\\\\"),
    llmOllamaUrl: `http://127.0.0.1:${tunnelPort}`,
    ollamaRemote: true,
    notes: `LLM node ${new Date().toISOString().slice(0, 10)} — tunnel local :${tunnelPort} → remote :11434`,
  };
  saveJson(LLM_CFG, llm);
}

console.log("\nNext steps:");
console.log("  1. node scripts/metalnode-tunnel.mjs");
console.log("  2. Restart Next dev server if running");
console.log("  3. Open http://127.0.0.1:3000/peach/templates");
