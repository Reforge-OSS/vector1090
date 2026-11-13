const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { DEFAULT_SETTINGS } = (() => {
  const output = ts.transpileModule(fs.readFileSync("src/lib/types.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports });
  return module.exports;
})();
function harness(file, fetcher) {
  const states = [], refs = [], effects = [], timers = new Map(), listeners = new Map();
  let now = 1700000000000, sequence = 0, calls = 0;
  const document = { hidden: false, addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) };
  const react = {
    useState(value) { const index = states.length; states.push(value); return [value, v => { states[index] = typeof v === "function" ? v(states[index]) : v; }]; },
    useRef(value) { const ref = { current: value }; refs.push(ref); return ref; },
    useEffect(cb) { effects.push(cb); },
    useCallback(cb) { return cb; },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, require: name => name === "react" ? react : { DEFAULT_SETTINGS },
    document, AbortController, URLSearchParams, Date: class extends Date { static now() { return now; } },
    fetch: (...args) => { calls++; return fetcher(...args); },
    setTimeout: (cb, ms) => { timers.set(++sequence, { cb, ms }); return sequence; },
    clearTimeout: id => timers.delete(id), localStorage: { getItem: () => null, setItem() {} },
  });
  return { exports: module.exports, states, refs, timers, document, listeners, calls: () => calls,
    start: () => effects.map(cb => cb()), tick: async () => { const [id, timer] = timers.entries().next().value; timers.delete(id); now += timer.ms; await timer.cb(); },
    advance: ms => { now += ms; } };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const ok = aircraft => ({ ok: true, status: 200, json: async () => ({ aircraft, total: aircraft.length }) });
(async () => {
  const settings = harness("src/hooks/useSettings.ts");
  const sanitize = settings.exports.sanitizeSettings;
  assert.equal(sanitize({ pollIntervalSec: 1 }).pollIntervalSec, 5);
  assert.equal(sanitize({ mode: "local", pollIntervalSec: -2 }).pollIntervalSec, 1);
  assert.equal(sanitize({ homeLat: 999 }).homeLat, 90);
  assert.equal(sanitize({}).mode, "public");
  settings.exports.useSettings().setSettings({ mode: "local" });
  assert.equal(settings.states[0].pollIntervalSec, 2);
  const sample = { hex: "abc123", lat: 52, lon: -1, seen: 0, alt_baro: 5000 };
  let entries = [sample];
  const feed = harness("src/hooks/useAircraftFeed.ts", async () => ok(entries));
  feed.exports.useAircraftFeed(DEFAULT_SETTINGS, false);
  const cleanup = feed.start();
  await flush();
  assert.equal(feed.states[1], "online");
  assert.equal(feed.states[3], 1);
  assert.equal(feed.refs[0].current.get("abc123").length, 1);
  await feed.tick();
  assert.equal(feed.refs[0].current.get("abc123").length, 1);
  entries = [{ ...sample, lon: 0 }];
  await feed.tick();
  assert.equal(feed.refs[0].current.get("abc123").length, 2);
  entries = [];
  feed.advance(301000);
  await feed.tick();
  assert.equal(feed.states[0].length, 0);
  assert.equal(feed.refs[0].current.size, 0);
  feed.document.hidden = true;
  feed.listeners.get("visibilitychange")();
  assert.equal(feed.states[1], "paused");
  assert.equal(feed.timers.size, 0);
  const before = feed.calls();
  feed.document.hidden = false;
  feed.listeners.get("visibilitychange")();
  await flush();
  assert.equal(feed.calls(), before + 1);
  cleanup.forEach(cb => cb?.());
  assert.equal(feed.timers.size, 0);
  const limited = harness("src/hooks/useAircraftFeed.ts", async () => ({ status: 429, json: async () => ({ retryAfter: 2 }) }));
  limited.exports.useAircraftFeed(DEFAULT_SETTINGS, false); limited.start(); await flush();
  assert.equal(limited.states[1], "rate-limited");
  assert.equal([...limited.timers.values()][0].ms, 30000);
  const failed = harness("src/hooks/useAircraftFeed.ts", async () => { throw new Error("offline"); });
  failed.exports.useAircraftFeed(DEFAULT_SETTINGS, false); failed.start(); await flush();
  assert.equal(failed.states[1], "error");
  assert.equal([...failed.timers.values()][0].ms, 2000);
  for (let i = 0; i < 7; i++) await failed.tick();
  assert.equal([...failed.timers.values()][0].ms, 60000);
  const paused = harness("src/hooks/useAircraftFeed.ts", async () => ok([]));
  paused.exports.useAircraftFeed(DEFAULT_SETTINGS, true); paused.start(); await flush();
  assert.equal(paused.calls(), 0);
  assert.equal(paused.states[1], "paused");
  let resolve;
  const pending = harness("src/hooks/useAircraftFeed.ts", () => new Promise(r => { resolve = r; }));
  pending.exports.useAircraftFeed(DEFAULT_SETTINGS, false); pending.start();
  assert.equal(pending.calls(), 1);
  assert.equal(pending.timers.size, 0);
  pending.document.hidden = true; pending.listeners.get("visibilitychange")();
  resolve(ok([sample])); await flush();
  assert.equal(pending.states[0].length, 0);
  assert.equal(pending.states[1], "paused");
  console.log("PASS: settings defaults/clamps; feed success/empty/error/backoff/429; trails; pause/resume; cancellation; no overlapping poll timer");
})().catch(error => { console.error(error); process.exitCode = 1; });
