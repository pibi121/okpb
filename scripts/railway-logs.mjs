const T = process.env.RAILWAY_TOKEN;
const deploymentId = process.env.DEPLOY_ID || "351019b9-46f3-4d48-9278-3c519ed7ba5f";

async function gql(query, variables) {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${T}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

for (const q of [
  ["deploymentLogs", `query($id: String!, $limit: Int) { deploymentLogs(deploymentId: $id, limit: $limit) { message timestamp severity } }`, { id: deploymentId, limit: 300 }],
  ["buildLogs", `query($id: String!) { buildLogs(deploymentId: $id, limit: 300) { message timestamp } }`, { id: deploymentId }],
  ["deployment meta", `query($id: String!) { deployment(id: $id) { status meta } }`, { id: deploymentId }],
]) {
  console.log("\n===", q[0], "===");
  const r = await gql(q[1], q[2]);
  if (r.errors) console.log(JSON.stringify(r.errors, null, 2));
  else {
    const data = r.data;
    const logs = data.deploymentLogs || data.buildLogs;
    if (Array.isArray(logs) && logs.length) {
      for (const line of logs.slice(-80)) console.log(line.message || line);
    } else {
      console.log(JSON.stringify(data, null, 2).slice(0, 8000));
    }
  }
}
