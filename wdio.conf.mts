import { resolve } from "node:path";

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: ["./test/e2e/**/*.e2e.ts"],
  maxInstances: 2,

  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: "latest",
      "wdio:obsidianOptions": {
        installerVersion: "earliest",
        plugins: ["."],
        vault: "test/vaults/inbox",
      },
    },
  ],

  services: ["obsidian"],
  reporters: ["spec"],
  cacheDir: resolve(".obsidian-cache"),
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  waitforTimeout: 10_000,
  logLevel: "warn",
};
