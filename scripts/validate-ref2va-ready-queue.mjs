#!/usr/bin/env node
/**
 * Validate Ref2VA READY prompt: local structural checks + Comfy /prompt queue.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "infra", "metalnode.local.json"), "utf8"),
);

const REQUIRED = {
  ComfyMathExpression: ["expression"],
  PrimitiveStringMultiline: ["value"],
  PrimitiveFloat: ["value"],
  LoadImage: ["image"],
  LoadVideo: ["file"],
  StringConcatenate: ["string_a", "string_b", "delimiter"],
};

function patchPrompt(prompt) {
  const p = structuredClone(prompt);
  if (p["496"]) p["496"].inputs.image = "Flux2_dev_00018_.png";
  if (p["459"]) p["459"].inputs.file = "97cd212cfc716511f0c95b2ecbf26887_720w.mp4";
  if (p["482"]) p["482"].inputs.filename_prefix = "peach/validate-ref2va";
  if (p["464"]?.inputs) {
    p["464"].inputs["ref_videos.ref_video_0"] = ["456", 0];
    const pr = p["464"].inputs.prompt;
    if (Array.isArray(pr) && pr[0] === "517") {
      p["464"].inputs.prompt = ["514", 0];
    }
    p["464"].inputs.width = 768;
    p["464"].inputs.height = 1344;
  }
  if (p["480"]?.inputs) p["480"].inputs.value = 6;
  if (p["507"]?.inputs?.text != null) {
    p["507"].inputs.value = p["507"].inputs.text;
    delete p["507"].inputs.text;
  }
  if (p["509"]?.inputs?.text != null) {
    p["509"].inputs.value = p["509"].inputs.text;
    delete p["509"].inputs.text;
  }
  if (p["498"]?.inputs?.text != null) {
    p["498"].inputs.value = p["498"].inputs.text;
    delete p["498"].inputs.text;
  }
  return p;
}

function validateLocal(prompt) {
  const ids = new Set(Object.keys(prompt));
  const errors = [];

  for (const [id, node] of Object.entries(prompt)) {
    const req = REQUIRED[node.class_type];
    if (req) {
      for (const key of req) {
        if (node.inputs[key] === undefined || node.inputs[key] === null) {
          errors.push(`${id} (${node.class_type}): missing "${key}"`);
        }
      }
    }
    for (const v of Object.values(node.inputs || {})) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") {
        if (!ids.has(String(v[0]))) {
          errors.push(`${id} (${node.class_type}): dangling ref -> ${v[0]}`);
        }
      }
    }
  }

  if (errors.length) {
    console.error("Local validation failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("OK local structural validation (" + ids.size + " nodes)");
}

function ping(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function postComfyLocal(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 8188,
        path: "/prompt",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 120_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => resolve({ status: res.statusCode || 0, raw }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Comfy local timeout"));
    });
    req.write(data);
    req.end();
  });
}

function postComfyRemote(body) {
  const localBody = path.join(ROOT, "scripts", "_ref2va_validate_body.json");
  fs.writeFileSync(localBody, JSON.stringify(body));

  const r = spawnSync(
    "scp.exe",
    [
      "-i",
      cfg.sshKeyPath,
      "-P",
      String(cfg.sshPort),
      "-o",
      "BatchMode=yes",
      localBody,
      `${cfg.sshUser}@${cfg.host}:/tmp/ref2va_validate_body.json`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "scp failed");

  const remote = spawnSync(
    "ssh.exe",
    [
      "-i",
      cfg.sshKeyPath,
      "-p",
      String(cfg.sshPort),
      "-o",
      "BatchMode=yes",
      `${cfg.sshUser}@${cfg.host}`,
      `curl -s -X POST http://127.0.0.1:8188/prompt -H 'Content-Type: application/json' -d @/tmp/ref2va_validate_body.json -w '\\nHTTP:%{http_code}'`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 120_000 },
  );
  const raw = (remote.stdout || remote.stderr || "").trim();
  if (remote.status !== 0 && !raw.includes("prompt_id")) {
    throw new Error(raw.slice(0, 2000) || "ssh curl failed");
  }
  return raw.replace(/\nHTTP:\d+$/, "");
}

async function validateComfy(body) {
  let raw;
  const localUp = await ping("http://127.0.0.1:8188/system_stats");
  if (localUp) {
    console.log("Comfy via local tunnel :8188");
    const res = await postComfyLocal(body);
    raw = res.raw;
  } else {
    console.log("Comfy via SSH remote curl");
    raw = postComfyRemote(body);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Bad Comfy response: " + raw.slice(0, 500));
  }

  if (data.error || (data.node_errors && Object.keys(data.node_errors).length)) {
    console.error("Comfy validation failed:", JSON.stringify(data, null, 2).slice(0, 4000));
    process.exit(1);
  }

  console.log("OK Comfy accepted prompt_id=", data.prompt_id);
}

async function main() {
  const apiPath = path.join(
    ROOT,
    "workflows",
    "MiniMax_H3_Character_Ref2VA_READY.api.json",
  );
  const { prompt } = JSON.parse(fs.readFileSync(apiPath, "utf8"));
  const patched = patchPrompt(prompt);
  validateLocal(patched);
  await validateComfy({
    prompt: patched,
    client_id: "peach-validate-ref2va",
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
