const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const UA = "vector1090/1.0 (+https://github.com/Reforge-OSS/vector1090)";
function loadRoute(file, env = {}, fetcher) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
  vm.runInNewContext(source, {
    exports, process: { env }, fetch: fetcher, AbortSignal, AbortController, URL, setTimeout, clearTimeout,
    require: name => name === "next/server"
      ? { NextResponse: { json: (body, options) => ({ body, ...options }) } }
      : name === "@/lib/types" ? { DEFAULT_SETTINGS: { homeLat: 52.8311, homeLon: -1.3281, localUrl: "http://localhost:8080/data/aircraft.json" } }
      : { normalizeFeed: json => json.aircraft ?? [] },
  });
  return exports.GET;
}
(async () => {
  const photoPath = "src/app/api/photo/[hex]/route.ts";
  let calls = 0;
  const get = loadRoute(photoPath, {}, async (url, options) => {
    calls++;
    assert.equal(options.headers["User-Agent"], UA);
    assert.ok(url.endsWith("/4ca707"));
    return { ok: true, json: async () => ({ photos: [{ thumbnail_large: { src: "https://t.plnspttrs.net/photo.jpg" }, link: "https://www.planespotters.net/photo/1", photographer: "Photographer" }] }) };
  });
  const photo = await get(null, { params: { hex: "4CA707" } });
  assert.equal(photo.body.photo.thumbnail, "https://t.plnspttrs.net/photo.jpg");
  assert.equal(photo.body.photo.photographer, "Photographer");
  assert.equal(photo.headers["Cache-Control"], "public, max-age=3600");
  await get(null, { params: { hex: "4ca707" } });
  assert.equal(calls, 1);
  assert.equal((await get(null, { params: { hex: "bad" } })).status, 400);
  const custom = loadRoute(photoPath, { PHOTO_USER_AGENT: "Custom/1.0" }, async (_url, options) => {
    assert.equal(options.headers["User-Agent"], "Custom/1.0");
    return { ok: true, json: async () => ({ photos: [] }) };
  });
  assert.equal((await custom(null, { params: { hex: "abcdef" } })).body.photo, null);
  const failed = loadRoute(photoPath, {}, async () => { throw new Error("offline"); });
  assert.equal((await failed(null, { params: { hex: "abcdef" } })).body.photo, null);
  const aircraft = loadRoute("src/app/api/aircraft/route.ts", {}, async (_url, options) => {
    assert.equal(options.headers["User-Agent"], UA);
    return { ok: true, status: 200, json: async () => ({ aircraft: [], now: 123 }) };
  });
  const empty = await aircraft({ nextUrl: new URL("http://localhost/api/aircraft") });
  assert.equal(empty.body.total, 0);
  assert.equal(empty.headers["Cache-Control"], "no-store");
  console.log("PASS: API identification user agents, photo override/cache/validation/success/empty/failure and empty aircraft feed");
})().catch(error => { console.error(error); process.exitCode = 1; });
