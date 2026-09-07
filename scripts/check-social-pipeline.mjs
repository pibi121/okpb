/** E2E smoke: social templates + run start (Krea step). Full GPU video optional via APPROVE=1 */
import { File } from "node:buffer";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const APPROVE = process.env.APPROVE === "1";

async function req(path, { method = "GET", body, cookie, formData } = {}) {
  const headers = cookie ? { Cookie: cookie } : {};
  if (!formData && body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: formData || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  const setCookie = res.headers.getSetCookie?.() || [];
  return { res, data, setCookie };
}

function pickSession(setCookie) {
  const line = setCookie.find((c) => c.startsWith("pb_session="));
  return line ? line.split(";")[0] : "";
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const email = process.env.SOCIAL_TEST_EMAIL || `social_${Date.now()}@test.local`;
  const password = process.env.SOCIAL_TEST_PASSWORD || "test1234";

  let { res, data, setCookie } = await req("/api/auth?action=register", {
    method: "POST",
    body: {
      email,
      password,
      name: "Social test",
      ageConfirmed: true,
    },
  });
  if (!res.ok) {
    ({ res, data, setCookie } = await req("/api/auth?action=login", {
      method: "POST",
      body: { email, password },
    }));
  }
  if (!res.ok) throw new Error(`auth ${res.status}: ${JSON.stringify(data)}`);
  const cookie = pickSession(setCookie);
  if (!cookie) throw new Error("no session");

  ({ res, data } = await req("/api/peach/social/templates?published=1", { cookie }));
  if (!res.ok) throw new Error(`templates ${res.status}`);
  let templates = data.templates || [];
  if (!templates.length) {
    ({ res, data } = await req("/api/peach/social/templates", {
      method: "POST",
      cookie,
      body: {
        title: "Auto test template",
        kreaPhotoPrompt:
          "full body portrait photo, woman standing, neutral background, photorealistic, 888x1176",
        durationSec: 6,
      },
    }));
    if (!res.ok) throw new Error(`create template ${res.status}: ${JSON.stringify(data)}`);
    const tplId = data.template.id;
    const vid = Buffer.alloc(8000, 0);
    const fd = new FormData();
    fd.set("kind", "driving");
    fd.set("file", new File([vid], "drive.mp4", { type: "video/mp4" }));
    ({ res, data } = await req(`/api/peach/social/templates/${tplId}?action=upload`, {
      method: "POST",
      cookie,
      formData: fd,
    }));
    if (!res.ok) throw new Error(`upload ${res.status}: ${JSON.stringify(data)}`);
    ({ res, data } = await req(`/api/peach/social/templates/${tplId}?action=publish`, {
      method: "POST",
      cookie,
    }));
    if (!res.ok) throw new Error(`publish ${res.status}: ${JSON.stringify(data)}`);
    templates = [data.template];
  }

  const tpl = templates[0];
  console.log("template", tpl.id, tpl.title);

  const charsRes = await req("/api/characters", { cookie }).catch(() => null);
  let characterId = null;
  if (charsRes?.res.ok && charsRes.data.characters?.length) {
    characterId = charsRes.data.characters[0].id;
  }

  if (!characterId) {
    ({ res, data } = await req("/api/characters", {
      method: "POST",
      cookie,
      body: { name: "Social Test Model", gender: "female", consentGiven: true },
    }));
    if (!res.ok) throw new Error(`create character ${res.status}`);
    characterId = data.character?.id || data.id;
  }
  console.log("character", characterId);

  ({ res, data } = await req("/api/peach/social/runs", {
    method: "POST",
    cookie,
    body: { action: "start", templateId: tpl.id, characterId },
  }));
  if (!res.ok) throw new Error(`start run ${res.status}: ${JSON.stringify(data)}`);
  const runId = data.run.id;
  console.log("run started", runId, data.run.status);

  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    ({ res, data } = await req(`/api/peach/social/runs/${runId}`, { cookie }));
    if (!res.ok) throw new Error(`poll ${res.status}`);
    const run = data.run;
    console.log("poll", run.status, run.kreaPhotoUrl ? "photo=yes" : "");
    if (run.status === "awaiting_photo") {
      console.log("OK Krea photo ready", run.kreaPhotoUrl);
      if (APPROVE) {
        ({ res, data } = await req(
          `/api/peach/social/runs/${runId}?action=approve`,
          { method: "POST", cookie },
        ));
        if (!res.ok) throw new Error(`approve ${res.status}: ${JSON.stringify(data)}`);
        console.log("approved → video_busy");
      }
      return;
    }
    if (run.status === "error") throw new Error(run.error || "run error");
    if (run.status === "ready") {
      console.log("OK video", run.resultVideoUrl);
      return;
    }
  }
  throw new Error("timeout waiting for krea photo");
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
