const T = process.env.RAILWAY_TOKEN;
const serviceId = "80ff72ec-cf97-4eb7-8af3-31aca9999101";
const environmentId = "049151d9-0601-43a9-a478-008b8d4b776a";

async function gql(query, variables) {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${T}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

await gql(
  `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
    serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
  }`,
  {
    serviceId,
    environmentId,
    input: {
      buildCommand: "npx prisma generate && npm run build",
      startCommand:
        "npx prisma db push --accept-data-loss && node scripts/start-railway.mjs",
      healthcheckPath: "/",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
  },
);
console.log("[railway] service instance updated");

await gql(
  `mutation($serviceId: String!, $environmentId: String!) {
    serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
  }`,
  { serviceId, environmentId },
);
console.log("[railway] redeploy triggered");
