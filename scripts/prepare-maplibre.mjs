import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("maplibre-gl/package.json"));
copyFileSync(
  join(root, "dist/maplibre-gl-worker.mjs"),
  "public/maplibre-gl-worker.mjs",
);
