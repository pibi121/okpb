/**
 * Enable real GPU generation on Railway via SSH tunnel to Metalnode.
 *
 * Usage (local):
 *   RAILWAY_TOKEN=... METALNODE_HOST=... METALNODE_SSH_KEY_PATH="C:\path\to\key" node scripts/railway-enable-gpu.mjs
 */
import fs from "node:fs";

const TOKEN = process.env.RAILWAY_TOKEN;
const projectId = process.env.PROJECT_ID || "3f35efc6-7f0a-4cd2-af86-6b2ba2806c26";
const environmentId = process.env.ENV_ID || "049151d9-0601-43a9-a478-008b8d4b776a";
const serviceId = process.env.SERVICE_ID || "80ff72ec-cf97-4eb7-8af3-31aca9999101";

if (!TOKEN) {
  console.error("Set RAILWAY_TOKEN");
  process.exit(1);
}
if (!process.env.METALNODE_HOST?.trim()) {
  console.error("Set METALNODE_HOST");
  process.exit(1);
}

function loadSshKey() {
  if (process.env.METALNODE_SSH_KEY?.trim()) {
    return process.env.METALNODE_SSH_KEY.trim();
  }
  const keyPath = process.env.METALNODE_SSH_KEY_PATH?.trim();
  if (!keyPath || !fs.existsSync(keyPath)) {
    throw new Error("Set METALNODE_SSH_KEY or METALNODE_SSH_KEY_PATH");
  }
  return fs.readFileSync(keyPath, "utf8").trim();
}

async function gql(query, variables) {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

const sshKey = loadSshKey();

await gql(
  `mutation($input: VariableCollectionUpsertInput!) {
    variableCollectionUpsert(input: $input)
  }`,
  {
    input: {
      projectId,
      environmentId,
      serviceId,
      variables: {
        PEACH_USE_COMFY: "1",
        COMFY_FORCE_MOCK: "0",
        COMFY_URL: "http://127.0.0.1:8188",
        METALNODE_HOST: process.env.METALNODE_HOST || "",
        METALNODE_SSH_PORT: process.env.METALNODE_SSH_PORT || "22031",
        METALNODE_SSH_USER: "root",
        METALNODE_SSH_KEY: sshKey,
        DATABASE_URL: "file:/app/data/prod.db",
      },
    },
  },
);

console.log("[railway] GPU env enabled (PEACH_USE_COMFY=1, COMFY_FORCE_MOCK=0, SSH tunnel)");

await gql(
  `mutation($serviceId: String!, $environmentId: String!) {
    serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
  }`,
  { serviceId, environmentId },
);

console.log("[railway] redeploy triggered");
