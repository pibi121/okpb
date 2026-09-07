/**
 * Smoke checks for TG Mini App static assets and public routes.
 * Usage: node scripts/tg-smoke.mjs [baseUrl]
 */
const base = (process.argv[2] || process.env.PROD_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

const paths = [
  "/api/tg/version",
  "/tg",
  "/tg/characters",
  "/tg/gallery",
  "/tg/studio-photo",
  "/tg/video-flow",
  "/tg/catalog/video-1.mp4",
  "/tg/catalog/photo-1.png",
  "/tg/catalog/cast-masha1.png",
];

let failed = 0;
for (const p of paths) {
  const url = `${base}${p}`;
  try {
    const res = await fetch(url, { redirect: "follow" });
    const ok = res.status >= 200 && res.status < 400;
    console.log(`${ok ? "OK" : "FAIL"} ${res.status} ${p}`);
    if (!ok) failed++;
    if (p === "/api/tg/version" && ok) {
      const j = await res.json();
      console.log("  build:", j.build);
    }
  } catch (e) {
    console.log(`FAIL ${p}`, e instanceof Error ? e.message : e);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll TG smoke checks passed");
