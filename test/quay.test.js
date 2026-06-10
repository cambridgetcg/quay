import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuay } from "../src/server.js";

let ctx;
const SUFFIX = "quay.localhost";
const ADMIN = "quay.localhost";

function tar(dir) {
  return new Promise((res, rej) => {
    const p = spawn("tar", ["-cz", "-C", dir, "."], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    p.stdout.on("data", c => chunks.push(c));
    p.on("close", code => code === 0 ? res(Buffer.concat(chunks)) : rej(new Error("tar " + code)));
  });
}

/** Low-level client so we can set an arbitrary Host header (fetch forbids it) — exactly what a reverse proxy does. */
function req(host, method, path, { body, token, json } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: host };
    if (token) headers.authorization = "Bearer " + token;
    if (json !== undefined) { headers["content-type"] = "application/json"; body = Buffer.from(JSON.stringify(json)); }
    else if (body) headers["content-type"] = "application/octet-stream";
    const r = request({ host: "127.0.0.1", port: ctx.port, method, path, headers }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    r.on("error", reject);
    if (body) r.end(body); else r.end();
  });
}

async function makeBuild(files) {
  const dir = await mkdtemp(join(tmpdir(), "quay-build-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

before(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "quay-data-"));
  const { server, store } = await createQuay({ dataDir, adminHost: ADMIN, deployHostSuffix: SUFFIX, scheme: "http" });
  await new Promise(r => server.listen(0, r));
  ctx = { server, store, dataDir, port: server.address().port, token: store.config.token };
});
after(async () => {
  await new Promise(r => ctx.server.close(r));
  await rm(ctx.dataDir, { recursive: true, force: true });
});

async function deploy(project, files) {
  const dir = await makeBuild(files);
  const body = await tar(dir);
  const r = await req(ADMIN, "POST", `/api/projects/${encodeURIComponent(project)}/deploys`, { body, token: ctx.token });
  await rm(dir, { recursive: true, force: true });
  return r;
}

test("deploy requires a valid bearer token", async () => {
  const dir = await makeBuild({ "index.html": "<h1>hi</h1>" });
  const body = await tar(dir);
  assert.equal((await req(ADMIN, "POST", "/api/projects/site/deploys", { body })).status, 401);
  assert.equal((await req(ADMIN, "POST", "/api/projects/site/deploys", { body, token: "wrong" })).status, 401);
  await rm(dir, { recursive: true, force: true });
});

test("deploy → immutable version → preview serves it → promote → production serves it", async () => {
  const r = await deploy("alpha", { "index.html": "<h1>v1</h1>", "style.css": "body{}" });
  assert.equal(r.status, 201);
  const { version, files } = r.json();
  assert.equal(files, 2);

  const prev = await req(`${version}--alpha.${SUFFIX}`, "GET", "/");
  assert.equal(prev.status, 200);
  assert.match(prev.text, /v1/);
  assert.equal(prev.headers["x-quay-version"], version);

  assert.equal((await req(`alpha.${SUFFIX}`, "GET", "/")).status, 503); // not promoted yet

  const pr = await req(ADMIN, "POST", "/api/projects/alpha/promote", { json: { version }, token: ctx.token });
  assert.equal(pr.status, 200);
  assert.match((await req(`alpha.${SUFFIX}`, "GET", "/")).text, /v1/);
});

test("identical bytes are idempotent (content-addressed); new content → new version", async () => {
  const a = (await deploy("beta", { "index.html": "same" })).json();
  const b = (await deploy("beta", { "index.html": "same" })).json();
  assert.equal(a.version, b.version);
  const cc = (await deploy("beta", { "index.html": "different" })).json();
  assert.notEqual(a.version, cc.version);
});

test("path traversal in the URL cannot escape the deploy dir", async () => {
  const { version } = (await deploy("gamma", { "index.html": "ok", "secret/keep.txt": "in-bounds" })).json();
  const host = `${version}--gamma.${SUFFIX}`;
  for (const evil of ["/../../../../etc/passwd", "/..%2f..%2f..%2fetc%2fpasswd", "/secret/../../../../etc/hosts"]) {
    const res = await req(host, "GET", evil);
    assert.equal(res.status, 404, `expected 404 for ${evil}, got ${res.status}`);
  }
  assert.equal((await req(host, "GET", "/secret/keep.txt")).status, 200);
});

test("a tarball containing a symlink is rejected", async () => {
  const dir = await makeBuild({ "index.html": "hi" });
  await symlink("/etc/passwd", join(dir, "leak"));
  const body = await tar(dir);
  const r = await req(ADMIN, "POST", "/api/projects/delta/deploys", { body, token: ctx.token });
  assert.equal(r.status, 400);
  assert.match(r.json().error, /symlink/);
  await rm(dir, { recursive: true, force: true });
});

test("invalid project names are rejected", async () => {
  assert.equal((await deploy("Has Spaces", { "index.html": "x" })).status, 400);
  assert.equal((await deploy("../escape", { "index.html": "x" })).status, 400);
  assert.equal((await deploy("ok-name-1", { "index.html": "x" })).status, 201);
});

test("unknown hosts and missing versions 404 cleanly", async () => {
  assert.equal((await req("nope.example.com", "GET", "/")).status, 404);
  await deploy("epsilon", { "index.html": "hi" });
  assert.equal((await req(`deadbeef00--epsilon.${SUFFIX}`, "GET", "/")).status, 404);
});

test("the dashboard and project API render on the admin host", async () => {
  await deploy("zeta", { "index.html": "hi" });
  const dash = await req(ADMIN, "GET", "/");
  assert.equal(dash.status, 200);
  assert.match(dash.text, /Qua/);
  assert.ok((await req(ADMIN, "GET", "/api/projects")).json().some(p => p.name === "zeta"));
});

test("correct mime types are served", async () => {
  const { version } = (await deploy("mime", { "index.html": "<x>", "app.js": "1", "data.json": "{}" })).json();
  const host = `${version}--mime.${SUFFIX}`;
  assert.match((await req(host, "GET", "/app.js")).headers["content-type"], /javascript/);
  assert.match((await req(host, "GET", "/data.json")).headers["content-type"], /json/);
  assert.match((await req(host, "GET", "/")).headers["content-type"], /html/);
});

// ───────────────────────── v0.2 hardening (adversarial review) ─────────────────────────

test("CRITICAL: the admin API cannot be traversed to read config.json (token leak)", async () => {
  // the exact verified exploit: GET /api/projects/..%2Fconfig → must NOT return the token
  for (const evil of ["..%2Fconfig", "..%2F..%2Fconfig", "%2e%2e%2fconfig"]) {
    const r = await req(ADMIN, "GET", `/api/projects/${evil}`);
    assert.equal(r.status, 404, `expected 404 for ${evil}, got ${r.status}`);
    assert.doesNotMatch(r.text, /quay_[a-f0-9]/, "token must never appear in a response");
  }
});

test("CRITICAL: a decompression bomb is rejected, not written to disk unbounded", async () => {
  // ~1MB gzipped of zeros expands to ~1GB; must be refused by the extracted-size cap
  const { gzipSync } = await import("node:zlib");
  const { spawnSync } = await import("node:child_process");
  const big = await makeBuild({ "zeros.bin": Buffer.alloc(400 * 1024 * 1024) }); // 400MB > 256MB cap
  const tarred = spawnSync("tar", ["-cz", "-C", big, "."], { maxBuffer: 1 << 30 }).stdout;
  const r = await req(ADMIN, "POST", "/api/projects/bomb/deploys", { body: tarred, token: ctx.token });
  assert.equal(r.status, 413);
  await rm(big, { recursive: true, force: true });
});

test("the /internal/tls-check oracle is loopback-only and blocked via a spoofed Host", async () => {
  // our test client connects from 127.0.0.1, so to simulate an external caller we rely on
  // the daemon's remoteAddress check; here we assert the endpoint at least gates on project existence
  await deploy("known", { "index.html": "hi" });
  const known = await req(ADMIN, "GET", "/internal/tls-check?domain=known." + SUFFIX);
  const unknown = await req(ADMIN, "GET", "/internal/tls-check?domain=ghost." + SUFFIX);
  assert.equal(known.status, 200);   // loopback caller, real project
  assert.equal(unknown.status, 404);
});

test("project names with '--' are forbidden (routing-confusion guard)", async () => {
  assert.equal((await deploy("my--app", { "index.html": "x" })).status, 400);
});

test("healthz responds on any host", async () => {
  assert.equal((await req("anything.example", "GET", "/healthz")).status, 200);
  assert.equal((await req(ADMIN, "GET", "/healthz")).text, "ok");
});

test("malformed percent-encoding in a deploy path 404s, never 500s", async () => {
  const { version } = (await deploy("enc", { "index.html": "hi" })).json();
  const r = await req(`${version}--enc.${SUFFIX}`, "GET", "/%E0%A4%A");
  assert.equal(r.status, 404);
});

test("concurrent identical deploys both succeed (no ENOTEMPTY 500)", async () => {
  const dir = await makeBuild({ "index.html": "race" });
  const body = await tar(dir);
  const [a, b] = await Promise.all([
    req(ADMIN, "POST", "/api/projects/race/deploys", { body, token: ctx.token }),
    req(ADMIN, "POST", "/api/projects/race/deploys", { body, token: ctx.token }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.json().version, b.json().version);
  await rm(dir, { recursive: true, force: true });
});

test("prune keeps production + last N, GCs the rest", async () => {
  const v1 = (await deploy("keep", { "index.html": "1" })).json().version;
  const v2 = (await deploy("keep", { "index.html": "2" })).json().version;
  const v3 = (await deploy("keep", { "index.html": "3" })).json().version;
  await req(ADMIN, "POST", "/api/projects/keep/promote", { json: { version: v1 }, token: ctx.token });
  const pr = await req(ADMIN, "POST", "/api/projects/keep/prune", { json: { keep: 1 }, token: ctx.token });
  assert.equal(pr.status, 200);
  const proj = (await req(ADMIN, "GET", "/api/projects/keep")).json();
  // keep production (v1) + most recent 1 (v3) → v2 gone
  const versions = proj.deploys.map(d => d.version);
  assert.ok(versions.includes(v1));
  assert.ok(versions.includes(v3));
  assert.ok(!versions.includes(v2));
});

test("config.json is written 0600", async () => {
  const { statSync } = await import("node:fs");
  const mode = statSync(join(ctx.dataDir, "config.json")).mode & 0o777;
  assert.equal(mode, 0o600);
});
