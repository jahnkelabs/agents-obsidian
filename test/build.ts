import { execFileSync } from "node:child_process";

export default function setup() {
  execFileSync("node", ["esbuild.config.mjs"], { stdio: "inherit" });
}
