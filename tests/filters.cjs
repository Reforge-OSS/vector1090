const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText, filename);
const { filterAircraft, aircraftDistance } = require("../src/lib/filters.ts");
const { normalizeAircraft } = require("../src/lib/normalize.ts");
const home = { homeLat: 52, homeLon: -1 };
const aircraft = [
  normalizeAircraft({ hex: "abc123", flight: "RYR123", r: "EI-TEST", t: "B738", alt_baro: 14000, lat: 53, lon: -1 }),
  normalizeAircraft({ hex: "def456", flight: "VIP", alt_baro: 15000, lat: 52, lon: -1, dbFlags: 1 }),
  normalizeAircraft({ hex: "fed987", alt_baro: "ground", squawk: "7700" }),
  normalizeAircraft({ hex: "bad123" }),
];
assert.equal(filterAircraft(aircraft, "", "all", home)[0].hex, "def456");
for (const term of ["ryr", "ABC", "ei-test", "b738"]) assert.equal(filterAircraft(aircraft, term, "all", home)[0].hex, "abc123");
assert.equal(filterAircraft(aircraft, "", "low", home).length, 2);
assert.equal(filterAircraft(aircraft, "", "military", home)[0].hex, "def456");
assert.equal(filterAircraft(aircraft, "", "emergency", home)[0].hex, "fed987");
assert.equal(filterAircraft(aircraft, "missing", "all", home).length, 0);
assert.equal(filterAircraft([], "", "all", home).length, 0);
assert.equal(aircraftDistance(aircraft[2], home), null);
assert.equal(filterAircraft(aircraft, "  VIP ", "military", home).length, 1);
assert.equal(filterAircraft(aircraft, "RYR", "military", home).length, 0);
console.log("PASS: aircraft search fields/case/whitespace, filters, threshold, nearest sort, missing positions and empty results");
