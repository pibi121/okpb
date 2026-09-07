/**
 * One-shot Railway setup via GraphQL API.
 */
const TOKEN = process.env.RAILWAY_TOKEN;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const REPO = process.env.RAILWAY_REPO || "pibi121/okpb";

if (!TOKEN || !TG_TOKEN) {
  console.error("Set RAILWAY_TOKEN and TELEGRAM_BOT_TOKEN");
  process.exit(1);
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
  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

function randomSecret() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

async function getProjectContext(projectId) {
  const data = await gql(
    `query($id: String!) {
      project(id: $id) {
        id
        name
        environments {
          edges { node { id name } }
        }
        services {
          edges { node { id name } }
        }
      }
    }`,
    { id: projectId },
  );
  return data.project;
}

async function main() {
  const me = await gql(`{
    me {
      email
      workspaces { id name }
      projects { edges { node { id name } } }
    }
  }`);
  console.log("[railway] account:", me.me.email);
  const workspaceId = me.me.workspaces[0]?.id;
  if (!workspaceId) throw new Error("No Railway workspace");

  let projectId = me.me.projects.edges[0]?.node.id;

  if (!projectId) {
    const created = await gql(
      `mutation($input: ProjectCreateInput!) {
        projectCreate(input: $input) { id name }
      }`,
      { input: { name: "peachbitch", workspaceId } },
    );
    projectId = created.projectCreate.id;
    console.log("[railway] created project:", created.projectCreate.name);
  } else {
    console.log("[railway] using project:", me.me.projects.edges[0].node.name);
  }

  let project = await getProjectContext(projectId);
  const environmentId = project.environments.edges[0]?.node.id;
  if (!environmentId) throw new Error("No environment in project");

  let serviceId = project.services.edges[0]?.node.id;

  if (!serviceId) {
    try {
      const created = await gql(
        `mutation($input: ServiceCreateInput!) {
          serviceCreate(input: $input) { id name }
        }`,
        {
          input: {
            projectId,
            environmentId,
            name: "bot",
            branch: "main",
            source: { repo: REPO },
          },
        },
      );
      serviceId = created.serviceCreate.id;
      console.log("[railway] created service from GitHub repo");
    } catch (e) {
      console.warn("[railway] GitHub serviceCreate failed:", e.message);
      console.log("[railway] trying empty service (use railway up or connect GitHub in UI)…");
      const created = await gql(
        `mutation($input: ServiceCreateInput!) {
          serviceCreate(input: $input) { id name }
        }`,
        {
          input: {
            projectId,
            environmentId,
            name: "bot",
          },
        },
      );
      serviceId = created.serviceCreate.id;
      console.log("[railway] created empty service:", serviceId);
    }
  } else {
    console.log("[railway] using existing service");
  }

  const authSecret = randomSecret();
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
          DATABASE_URL: "file:./data/prod.db",
          TELEGRAM_BOT_TOKEN: TG_TOKEN,
          TELEGRAM_BOT_PUBLIC_URL: "https://t.me/peachbibot",
          AUTH_SECRET: authSecret,
          COMFY_FORCE_MOCK: "1",
          NODE_ENV: "production",
          PEACH_USE_COMFY: "0",
        },
      },
    },
  );
  console.log("[railway] env variables set");

  try {
    await gql(
      `mutation($input: VolumeCreateInput!) {
        volumeCreate(input: $input) { id name }
      }`,
      {
        input: {
          projectId,
          environmentId,
          serviceId,
          mountPath: "/app/data",
        },
      },
    );
    console.log("[railway] volume /app/data created");
  } catch (e) {
    console.warn("[railway] volume:", e.message);
  }

  let publicDomain = null;
  try {
    const dom = await gql(
      `mutation($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { domain }
      }`,
      {
        input: {
          serviceId,
          environmentId,
        },
      },
    );
    publicDomain = dom.serviceDomainCreate?.domain;
    if (publicDomain) console.log("[railway] domain:", publicDomain);
  } catch (e) {
    console.warn("[railway] domain create:", e.message);
  }

  if (publicDomain) {
    const miniApp = `https://${publicDomain}/tg/templates`;
    await gql(
      `mutation($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }`,
      {
        input: {
          projectId,
          environmentId,
          serviceId,
          variables: { TELEGRAM_MINIAPP_URL: miniApp },
        },
      },
    );
    console.log("[railway] TELEGRAM_MINIAPP_URL:", miniApp);
  }

  try {
    await gql(
      `mutation($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      { serviceId, environmentId },
    );
    console.log("[railway] deploy triggered");
  } catch (e) {
    console.warn("[railway] deploy:", e.message);
  }

  console.log("\n---");
  console.log("Project ID:", projectId);
  console.log("Service ID:", serviceId);
  console.log("Environment ID:", environmentId);
  if (publicDomain) {
    console.log("URL:", `https://${publicDomain}`);
    console.log("Mini App:", `https://${publicDomain}/tg/templates`);
    console.log("BotFather Menu Button →", `https://${publicDomain}/tg/templates`);
  } else {
    console.log("Generate domain in Railway UI if missing.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
