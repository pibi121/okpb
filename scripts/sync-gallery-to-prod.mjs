/**
 * Upload local data/gallery files to production (bootstrap secret required).
 *   node scripts/sync-gallery-to-prod.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY = path.join(ROOT, "data", "gallery");
const BASE = (process.env.PROD_URL || "").replace(/\/$/, "");
const SECRET = process.env.BOOTSTRAP_ADMIN_SECRET || "";
if (!BASE || !SECRET) {
  console.error("Set PROD_URL and BOOTSTRAP_ADMIN_SECRET");
  process.exit(1);
}
const OWNER = process.env.OWNER_GALLERY_ID || "cmsa0ko34000bv9cgjm27ydny";

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, base, out);
    else out.push({ abs, rel: path.relative(base, abs).replace(/\\/g, "/") });
  }
  return out;
}

const ownerDir = path.join(GALLERY, OWNER);
const files = walk(ownerDir, GALLERY);
console.log(`files=${files.length} owner=${OWNER}`);

let ok = 0;
let fail = 0;
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const form = new FormData();
  form.set("action", "upload_gallery");
  form.set("relKey", f.rel);
  const buf = fs.readFileSync(f.abs);
  form.set("file", new Blob([buf]), path.basename(f.abs));
  try {
    const res = await fetch(`${BASE}/api/peach/bootstrap-admin`, {
      method: "POST",
      headers: { "X-Bootstrap-Secret": SECRET },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      fail++;
      console.error(`[${i + 1}/${files.length}] FAIL ${f.rel} ${res.status} ${text.slice(0, 120)}`);
    } else {
      ok++;
      if (ok % 25 === 0 || i === files.length - 1) {
        console.log(`[${i + 1}/${files.length}] ok=${ok} fail=${fail}`);
      }
    }
  } catch (e) {
    fail++;
    console.error(`[${i + 1}/${files.length}] ERR ${f.rel}`, e instanceof Error ? e.message : e);
  }
}
console.log(`done ok=${ok} fail=${fail}`);
