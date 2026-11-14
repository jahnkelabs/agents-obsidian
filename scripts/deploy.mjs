import { copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const vault = process.env.OBSIDIAN_VAULT || join(homedir(), "Code", "agent-docs");
const target = join(vault, ".obsidian", "plugins", "agents");
mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) copyFileSync(file, join(target, file));
console.log(`Deployed to ${target}. Enable "Agents" under Settings → Community plugins.`);
