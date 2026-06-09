#!/usr/bin/env node
import { createQuay } from "../src/server.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = process.env;
const opts = {
  dataDir: env.QUAY_DATA || join(root, "data"),
  adminHost: env.QUAY_ADMIN_HOST || "quay.localhost",
  deployHostSuffix: env.QUAY_DEPLOY_SUFFIX || "quay.localhost",
  scheme: env.QUAY_SCHEME || "http",
};
const port = Number(env.QUAY_PORT || 7000);

const { server, store } = await createQuay({ ...opts, publicPort: Number(env.QUAY_PUBLIC_PORT || port) });
server.listen(port, () => {
  const c = s => `\x1b[38;5;124m${s}\x1b[0m`, dim = s => `\x1b[2m${s}\x1b[0m`, b = s => `\x1b[1m${s}\x1b[0m`;
  console.log(`\n${b("Qua" + c("y"))} ${dim("· self-hosted deploys")}`);
  console.log(`${dim("─".repeat(48))}`);
  console.log(`  dashboard   ${opts.scheme}://${opts.adminHost}:${port}`);
  console.log(`  deploys     ${opts.scheme}://*.${opts.deployHostSuffix}:${port}`);
  console.log(`  data        ${opts.dataDir}`);
  console.log(`  ${dim("API token (set this in the dashboard / CLI):")}`);
  console.log(`  ${c(store.config.token)}\n`);
});
