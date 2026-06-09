#!/usr/bin/env node
/**
 * quay — the CLI. Zero deps: tars a build dir with the system `tar` and POSTs
 * it to the daemon. Config is read from flags, then env, then ~/.quay/config.json.
 */
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, resolve } from "node:path";

const CFG = join(homedir(), ".quay", "config.json");

async function loadConfig() {
  let cfg = {};
  if (existsSync(CFG)) { try { cfg = JSON.parse(await readFile(CFG, "utf8")); } catch {} }
  return {
    server: process.env.QUAY_SERVER || cfg.server || "http://quay.localhost:7000",
    token: process.env.QUAY_TOKEN || cfg.token || "",
  };
}
async function saveConfig(patch) {
  let cfg = {};
  if (existsSync(CFG)) { try { cfg = JSON.parse(await readFile(CFG, "utf8")); } catch {} }
  await mkdir(join(homedir(), ".quay"), { recursive: true });
  await writeFile(CFG, JSON.stringify({ ...cfg, ...patch }, null, 2));
}

function parseFlags(args) {
  const flags = {}, rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i];
    else rest.push(args[i]);
  }
  return { flags, rest };
}

function tarball(dir) {
  return new Promise((res, rej) => {
    const p = spawn("tar", ["-cz", "-C", dir, "."], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let err = "";
    p.stdout.on("data", c => chunks.push(c));
    p.stderr.on("data", d => (err += d));
    p.on("error", rej);
    p.on("close", code => code === 0 ? res(Buffer.concat(chunks)) : rej(new Error("tar failed: " + err)));
  });
}

async function api(cfg, method, path, { body, json } = {}) {
  const headers = {};
  if (cfg.token) headers.authorization = "Bearer " + cfg.token;
  if (json) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
  else if (body) headers["content-type"] = "application/octet-stream";
  const r = await fetch(cfg.server.replace(/\/$/, "") + path, { method, headers, body });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${r.status}: ${data?.error || text}`);
  return data;
}

const c = s => `\x1b[38;5;124m${s}\x1b[0m`, dim = s => `\x1b[2m${s}\x1b[0m`, ok = s => `\x1b[32m${s}\x1b[0m`, b = s => `\x1b[1m${s}\x1b[0m`;

const commands = {
  async login({ flags }) {
    const server = flags.server || (await loadConfig()).server;
    const token = flags.token;
    if (!token) throw new Error("usage: quay login --token <token> [--server <url>]");
    await saveConfig({ server, token });
    console.log(ok("✓") + " saved " + dim(CFG));
  },

  async deploy({ flags, rest }) {
    const cfg = await loadConfig();
    const dir = resolve(rest[0] || ".");
    if (!existsSync(dir)) throw new Error("no such directory: " + dir);
    const project = flags.project || basename(resolve(dir, ".."));
    if (!cfg.token) throw new Error("no token — run: quay login --token <token>");
    process.stdout.write(dim(`packing ${dir} … `));
    const tar = await tarball(dir);
    process.stdout.write(dim(`${(tar.length / 1024).toFixed(0)} KB → ${project}\n`));
    const out = await api(cfg, "POST", `/api/projects/${encodeURIComponent(project)}/deploys`, { body: tar });
    console.log(`${ok("✓ deployed")} ${b(out.name)} ${dim("@")} ${c(out.version)}  ${dim(out.files + " files")}`);
    console.log(`  preview  ${out.previewUrl}`);
    console.log(`  ${dim("promote: quay promote " + out.name + " " + out.version)}`);
  },

  async promote({ rest }) {
    const cfg = await loadConfig();
    const [project, version] = rest;
    if (!project || !version) throw new Error("usage: quay promote <project> <version>");
    await api(cfg, "POST", `/api/projects/${encodeURIComponent(project)}/promote`, { json: { version } });
    console.log(`${ok("✓")} ${b(project)} → production ${c(version)}`);
  },

  async ls({ rest }) {
    const cfg = await loadConfig();
    if (rest[0]) {
      const p = await api(cfg, "GET", `/api/projects/${encodeURIComponent(rest[0])}`);
      console.log(b(p.name) + dim("  production: ") + (p.production ? c(p.production) : "—"));
      for (const d of p.deploys)
        console.log(`  ${d.version === p.production ? ok("●") : dim("○")} ${c(d.version)} ${dim(new Date(d.at).toLocaleString() + " · " + d.files + " files")}`);
    } else {
      const projects = await api(cfg, "GET", "/api/projects");
      if (!projects.length) return console.log(dim("no projects yet — quay deploy ./dist --project hello"));
      for (const p of projects)
        console.log(`${b(p.name.padEnd(20))} ${dim(p.deploys.length + " deploys · prod ")}${p.production ? c(p.production) : dim("none")}`);
    }
  },
};

const help = `${b("qua" + c("y"))} ${dim("· self-hosted deploys")}

  quay login --token <t> [--server <url>]   save credentials
  quay deploy <dir> [--project <name>]      deploy a build → preview URL
  quay promote <project> <version>          point production at a version
  quay ls [project]                         list projects / deploys
`;

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help") { console.log(help); process.exit(0); }
const fn = commands[cmd];
if (!fn) { console.error("unknown command: " + cmd + "\n" + help); process.exit(1); }
fn(parseFlags(args)).catch(e => { console.error("\x1b[31m✗\x1b[0m " + e.message); process.exit(1); });
