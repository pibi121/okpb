const T = process.env.RAILWAY_TOKEN;
const sid = process.env.SERVICE_ID || "80ff72ec-cf97-4eb7-8af3-31aca9999101";
const projectId = process.env.PROJECT_ID || "3f35efc6-7f0a-4cd2-af86-6b2ba2806c26";
const environmentId = process.env.ENV_ID || "049151d9-0601-43a9-a478-008b8d4b776a";

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

const status = await gql(
  `query($id: String!) {
    service(id: $id) {
      name
      serviceInstances {
        edges {
          node {
            latestDeployment { id status url staticUrl }
          }
        }
      }
    }
  }`,
  { id: sid },
);
console.log(JSON.stringify(status, null, 2));

try {
  const vol = await gql(
    `mutation($input: VolumeCreateInput!) {
      volumeCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId,
        environmentId,
        serviceId: sid,
        mountPath: "/app/data",
      },
    },
  );
  console.log("volume:", JSON.stringify(vol, null, 2));
} catch (e) {
  console.log("volume err", e);
}
