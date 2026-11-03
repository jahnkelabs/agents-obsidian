import { build } from "esbuild";

await build({
  entryPoints: ["src/cli/inbox.ts"],
  outfile: "dist/inbox.js",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
});
