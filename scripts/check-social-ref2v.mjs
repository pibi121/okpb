/** Quick check: social-ref2v API + Prisma delegate after restart */
import { File } from "node:buffer";
const BASE = process.env.BASE_URL || "http://localhost:3000";

async function req(path, { method = "GET", body, cookie, formData } = {}) {
  const headers = cookie ? { Cookie: cookie } : {};
  if (!formData) headers["Content-Type"] = "application/json";
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
    data = { raw: text.slice(0, 200) };
  }
  const setCookie = res.headers.getSetCookie?.() || [];
  return { res, data, setCookie };
}

function pickSession(setCookie) {
  const line = setCookie.find((c) => c.startsWith("pb_session="));
  return line ? line.split(";")[0] : "";
}

// test image (>100 bytes min in API)
const PNG = Buffer.alloc(512, 0xff);

async function main() {
  const email = `ref2v_${Date.now()}@test.local`;
  let { res, data, setCookie } = await req("/api/auth?action=register", {
    method: "POST",
    body: {
      email,
      password: "test1234",
      name: "Ref2V test",
      ageConfirmed: true,
    },
  });
  if (!res.ok) throw new Error(`register ${res.status}`);
  const cookie = pickSession(setCookie);
  if (!cookie) throw new Error("no session cookie");

  ({ res, data } = await req("/api/peach/social-ref2v", { cookie }));
  if (!res.ok) throw new Error(`GET social-ref2v ${res.status}: ${JSON.stringify(data)}`);
  if (!Array.isArray(data.runs)) throw new Error("runs not array");

  const form = new FormData();
  form.append("title", "auto test");
  form.append("photos", new File([PNG], "face.png", { type: "image/png" }));
  form.append(
    "video",
    new File([Buffer.alloc(2000, 0)], "drive.mp4", { type: "video/mp4" }),
  );

  ({ res, data } = await req("/api/peach/social-ref2v", {
    method: "POST",
    cookie,
    formData: form,
  }));
  if (!res.ok) throw new Error(`POST social-ref2v ${res.status}: ${JSON.stringify(data)}`);
  if (!data.run?.id) throw new Error("run not created");

  console.log("OK social-ref2v", data.run.id, data.run.status);
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
