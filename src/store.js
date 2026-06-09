import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, rm, realpath, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Quay's storage: immutable, content-addressed deploys + a tiny project registry.
 *
 * data/
 *   config.json                 { token }
 *   projects/<name>.json        { name, production, deploys:[{version,at,files,bytes}] }
 *   deploys/<name>/<version>/   the built site, served read-only
 *
 * Every deploy is an immutable version (sha of its contents); promotion just
 * moves a pointer. Nothing is ever overwritten — the same recipe-not-memory
 * instinct as the rest of this family, applied to web builds.
 */
export class Store {
  constructor(dataDir) {
    this.dir = resolve(dataDir);
    this.projectsDir = join(this.dir, "projects");
    this.deploysDir = join(this.dir, "deploys");
  }

  async init() {
    await mkdir(this.projectsDir, { recursive: true });
    await mkdir(this.deploysDir, { recursive: true });
    const cfgPath = join(this.dir, "config.json");
    if (!existsSync(cfgPath)) {
      const token = "quay_" + randomBytes(24).toString("hex");
      await writeFile(cfgPath, JSON.stringify({ token }, null, 2));
    }
    this.config = JSON.parse(await readFile(cfgPath, "utf8"));
    return this;
  }

  /** Constant-time bearer check (never branch on the secret). */
  checkToken(presented) {
    if (typeof presented !== "string") return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(this.config.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  static validName(name) {
    return typeof name === "string" && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(name);
  }

  async listProjects() {
    if (!existsSync(this.projectsDir)) return [];
    const files = (await readdir(this.projectsDir)).filter(f => f.endsWith(".json"));
    return Promise.all(files.map(f => this.getProject(f.slice(0, -5))));
  }

  async getProject(name) {
    const p = join(this.projectsDir, name + ".json");
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, "utf8"));
  }

  async #saveProject(proj) {
    await writeFile(join(this.projectsDir, proj.name + ".json"), JSON.stringify(proj, null, 2));
    return proj;
  }

  deployDir(name, version) {
    return join(this.deploysDir, name, version);
  }

  /**
   * Extract a gzipped tar of a build dir into a fresh immutable version.
   * Hardened against path traversal: extraction is confined to a temp dir,
   * then every resulting path is checked to resolve INSIDE that dir and to be
   * a regular file or directory (no symlinks — a tar symlink could otherwise
   * point the server at /etc/passwd on the next read).
   */
  async createDeploy(name, tarball, { now = new Date().toISOString() } = {}) {
    if (!Store.validName(name)) throw new HttpError(400, "invalid project name");
    if (!Buffer.isBuffer(tarball) || tarball.length === 0) throw new HttpError(400, "empty upload");

    // Extract first, then content-address the EXTRACTED TREE — not the tarball
    // bytes (gzip embeds a timestamp, so identical sites would otherwise differ).
    const tmp = join(this.deploysDir, name + ".tmp-" + randomBytes(6).toString("hex"));
    await mkdir(tmp, { recursive: true });
    try {
      await runTar(["-xz", "-C", tmp], tarball);
      const { files, bytes, hash } = await assertConfined(tmp);
      if (files === 0) throw new HttpError(400, "archive contained no files");
      const version = hash.slice(0, 10);
      const dest = this.deployDir(name, version);
      if (existsSync(dest)) { await rm(tmp, { recursive: true, force: true }); } // idempotent: same tree → same version
      else {
        await mkdir(join(this.deploysDir, name), { recursive: true });
        const { rename } = await import("node:fs/promises");
        await rename(tmp, dest);
      }
      let proj = (await this.getProject(name)) ?? { name, production: null, deploys: [] };
      if (!proj.deploys.some(d => d.version === version)) proj.deploys.unshift({ version, at: now, files, bytes });
      await this.#saveProject(proj);
      return { name, version, files, bytes };
    } catch (e) {
      await rm(tmp, { recursive: true, force: true });
      throw e;
    }
  }

  async promote(name, version) {
    const proj = await this.getProject(name);
    if (!proj) throw new HttpError(404, "no such project");
    if (!proj.deploys.some(d => d.version === version)) throw new HttpError(404, "no such version");
    proj.production = version;
    await this.#saveProject(proj);
    return proj;
  }

  /**
   * Resolve a requested file to an absolute path CONFINED to the deploy dir.
   * Returns null on any escape attempt or missing file.
   */
  async resolveFile(name, version, urlPath) {
    const base = this.deployDir(name, version);
    if (!existsSync(base)) return null;
    const baseReal = await realpath(base); // anchor everything on the real path (macOS /var → /private/var)
    let rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const target = resolve(baseReal, rel);
    // confinement check before touching the file
    if (target !== baseReal && !target.startsWith(baseReal + sep)) return null;
    if (!existsSync(target)) {
      const fallback = resolve(baseReal, rel, "index.html");
      if (fallback.startsWith(baseReal + sep) && existsSync(fallback)) return fallback;
      return null;
    }
    const st = await lstat(target);
    if (st.isSymbolicLink() || st.isDirectory()) return null; // never follow a symlink out
    const real = await realpath(target);
    if (real !== baseReal && !real.startsWith(baseReal + sep)) return null;
    return real;
  }
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function runTar(args, input) {
  return new Promise((res, rej) => {
    const p = spawn("tar", args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", d => (err += d));
    p.on("error", rej);
    p.on("close", code => (code === 0 ? res() : rej(new HttpError(400, "tar failed: " + err.trim()))));
    p.stdin.end(input);
  });
}

/**
 * Walk a dir; assert every entry is a regular file or dir within it; count
 * files+bytes; and compute a deterministic content hash of the tree (sorted
 * relative paths + contents), so identical site content yields one version.
 */
async function assertConfined(dir) {
  const root = await realpath(dir);
  const collected = [];
  let bytes = 0;
  async function walk(d) {
    for (const ent of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(d, ent.name);
      const st = await lstat(full);
      if (st.isSymbolicLink()) throw new HttpError(400, "archive contained a symlink: " + ent.name);
      if (st.isDirectory()) { await walk(full); continue; }
      if (!st.isFile()) throw new HttpError(400, "archive contained a non-regular file: " + ent.name);
      const real = await realpath(full);
      if (!real.startsWith(root + sep)) throw new HttpError(400, "archive escaped its root");
      collected.push({ rel: real.slice(root.length + 1), full: real, size: st.size });
      bytes += st.size;
    }
  }
  await walk(root);
  collected.sort((a, b) => a.rel.localeCompare(b.rel));
  const h = createHash("sha256");
  for (const f of collected) {
    h.update(f.rel + "\0");
    h.update(await readFile(f.full));
    h.update("\0");
  }
  return { files: collected.length, bytes, hash: h.digest("hex") };
}
