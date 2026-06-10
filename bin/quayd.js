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
const bind = env.QUAY_BIND || "127.0.0.1"; // loopback by default — production sits behind Caddy; never expose :7000 publicly

const { server, store } = await createQuay({ ...opts, publicPort: Number(env.QUAY_PUBLIC_PORT || port) });
server.listen(port, bind, () => {
  const c = s => `\x1b[38;5;124m${s}\x1b[0m`, dim = s => `\x1b[2m${s}\x1b[0m`, b = s => `\x1b[1m${s}\x1b[0m`;
  console.log(`\n${b("Qua" + c("y"))} ${dim("· self-hosted deploys")}`);
  console.log(`${dim("─".repeat(48))}`);
  console.log(`  dashboard   ${opts.scheme}://${opts.adminHost}:${port}  ${dim("(bind " + bind + ")")}`);
  console.log(`  deploys     ${opts.scheme}://*.${opts.deployHostSuffix}:${port}`);
  console.log(`  data        ${opts.dataDir}`);
  if (store.freshToken) {
    console.log(`  ${dim("API token (generated now — store it; not printed again):")}`);
    console.log(`  ${c(store.config.token)}\n`);
  } else {
    console.log(`  ${dim("API token in " + opts.dataDir + "/config.json (owner-only)")}\n`);
  }
});
