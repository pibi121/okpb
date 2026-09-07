/**
 * Проверка API: старт фильма + кадры + preview + review
 * Нужен запущенный npm run dev
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function req(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.getSetCookie?.() || [];
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { res, data, setCookie };
}

function pickSession(setCookie) {
  const line = setCookie.find((c) => c.startsWith("pb_session="));
  if (!line) return "";
  return line.split(";")[0];
}

async function waitJob(cookie, jobId) {
  let status = "queued";
  let data;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 800));
    ({ data } = await req(`/api/jobs?id=${jobId}`, { cookie }));
    status = data.job?.status;
    process.stdout.write(`   ${status} ${data.job?.progress}%\r`);
    if (["completed", "failed", "preview_ready"].includes(status)) break;
  }
  console.log("");
  return { status, job: data.job };
}

async function main() {
  const email = `test_${Date.now()}@example.com`;
  const errors = [];

  console.log("1) Регистрация…");
  let { res, data, setCookie } = await req("/api/auth?action=register", {
    method: "POST",
    body: {
      email,
      password: "test1234",
      name: "Тестер",
      ageConfirmed: true,
    },
  });
  if (!res.ok) errors.push(`register ${res.status}`);
  let cookie = pickSession(setCookie);

  console.log("2) Персонажи…");
  ({ res, data } = await req("/api/characters", {
    method: "POST",
    cookie,
    body: { name: "Аня", consentGiven: true, photoCount: 20 },
  }));
  const a = data.character?.id;
  ({ res, data } = await req("/api/characters", {
    method: "POST",
    cookie,
    body: { name: "Макс", consentGiven: true, photoCount: 15 },
  }));
  const b = data.character?.id;

  console.log("3) Сценарий со Стартом…");
  const graph = {
    nodes: [
      {
        id: "film-start",
        type: "film_start",
        position: { x: 0, y: 0 },
        data: {
          characterIds: [a, b],
          voices: { [a]: "soft_01", [b]: "low_03" },
          language: "ru",
          place: "forest",
          placePreset: "forest",
          lighting: "golden hour",
          timeOfDay: "evening",
          style: "photoreal",
          locationRefNote: "Референсы не загружены — эталон из первого кадра",
        },
      },
      {
        id: "s1",
        type: "shot",
        position: { x: 260, y: 0 },
        data: {
          title: "Диалог",
          characterIds: [a, b],
          continuity: "hard_cut",
          actionType: "dialogue",
          dialogueText: "Аня: Здесь тихо…",
          dialogues: [
            { characterId: a, text: "Здесь тихо…" },
            { characterId: b, text: "Да. Только мы." },
          ],
          actionPrompt: "стоят близко",
          camera: "medium",
          audioEnabled: true,
          durationSec: 5,
          characterStates: {
            [a]: { wardrobe: "casual", wardrobeNote: "" },
            [b]: { wardrobe: "casual", wardrobeNote: "" },
          },
        },
      },
      {
        id: "s2",
        type: "shot",
        position: { x: 520, y: 0 },
        data: {
          title: "Продолжение",
          characterIds: [a, b],
          continuity: "continue",
          actionType: "intimate",
          actionPrompt: "он обнимает её",
          dialogues: [],
          camera: "closeup",
          audioEnabled: false,
          durationSec: 5,
          characterStates: {
            [a]: { wardrobe: "shirt_open", wardrobeNote: "" },
          },
        },
      },
    ],
    edges: [
      { id: "e0", source: "film-start", target: "s1" },
      { id: "e1", source: "s1", target: "s2" },
    ],
  };

  ({ res, data } = await req("/api/scenarios?action=save", {
    method: "POST",
    cookie,
    body: { title: "Smoke film", graph },
  }));
  if (!res.ok) errors.push(`save ${JSON.stringify(data)}`);
  const scenarioId = data.scenario?.id;

  console.log("4) Review…");
  ({ res, data } = await req("/api/scenarios?action=review", {
    method: "POST",
    cookie,
    body: { scenarioId },
  }));
  if (!res.ok) errors.push(`review ${JSON.stringify(data)}`);
  else console.log("   risks:", data.review?.risks?.length);

  console.log("5) Preview…");
  ({ res, data } = await req("/api/scenarios?action=preview", {
    method: "POST",
    cookie,
    body: { scenarioId },
  }));
  if (!res.ok) errors.push(`preview ${JSON.stringify(data)}`);
  let jobId = data.job?.id;
  let wait = await waitJob(cookie, jobId);
  if (wait.status !== "preview_ready") {
    errors.push(`preview status ${wait.status}`);
  }

  const shotId = wait.job?.shots?.[0]?.id;
  if (shotId) {
    console.log("5b) Approve + regen shot…");
    ({ res, data } = await req("/api/jobs?action=approve_shot", {
      method: "POST",
      cookie,
      body: { shotId, approved: true },
    }));
    if (!res.ok) errors.push(`approve ${JSON.stringify(data)}`);

    ({ res, data } = await req("/api/jobs?action=regen_shot", {
      method: "POST",
      cookie,
      body: { shotId },
    }));
    if (!res.ok) errors.push(`regen ${JSON.stringify(data)}`);
    else {
      wait = await waitJob(cookie, jobId);
      if (wait.status !== "preview_ready") {
        errors.push(`regen status ${wait.status}`);
      }
    }
  }

  console.log("6) Animate…");
  ({ res, data } = await req("/api/scenarios?action=animate", {
    method: "POST",
    cookie,
    body: { scenarioId },
  }));
  if (!res.ok) errors.push(`animate ${JSON.stringify(data)}`);
  jobId = data.job?.id;
  wait = await waitJob(cookie, jobId);
  if (wait.status !== "completed") errors.push(`animate status ${wait.status}`);

  if (errors.length) {
    console.error("FAIL", errors);
    process.exit(1);
  }
  console.log("OK: старт + превью + review + оживление");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
