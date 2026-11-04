import { build } from "esbuild";

await build({
  entryPoints: ["src/cli/inbox.ts"],
  outfile: "dist/inbox.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

await build({
  entryPoints: ["src/plugin/main.ts"],
  outfile: "main.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  external: ["obsidian", "electron"],
});
