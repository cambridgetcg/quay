import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Store, HttpError } from "./store.js";
import { mimeFor } from "./mime.js";
import { dashboardHtml } from "./dashboard.js";

const MAX_UPLOAD = 64 * 1024 * 1024; // 64 MB per deploy

/**
 * One daemon, one port. Routing is by Host header:
 *   <admin host>                     → dashboard + JSON API
 *   <project>.<suffix>               → that project's production deploy
 *   <version>--<project>.<suffix>    → a specific immutable version
 *
 * In local mode the suffix is `quay.localhost` (browsers resolve *.localhost to
 * 127.0.0.1, so previews work with no DNS). In production Caddy terminates TLS
 * for *.quay.<domain> and proxies here.
 */
export async function createQuay({ dataDir, adminHost, deployHostSuffix, scheme = "http", publicPort = null }) {
  const store = await new Store(dataDir).init();
  const portSuffix = publicPort && publicPort !== 80 && publicPort !== 443 ? ":" + publicPort : "";
  const viewOpts = { adminHost, deployHostSuffix, scheme, portSuffix };

  const server = createServer(async (req, res) => {
    try {
      const host = (req.headers.host || "").split(":")[0].toLowerCase();

      // Caddy on-demand-TLS guard: only issue certs for hosts that map to a real
      // project, so a flood of random subdomains can't exhaust ACME rate limits.
      if ((req.url || "").startsWith("/internal/tls-check")) {
        const domain = (new URL(req.url, "http://x").searchParams.get("domain") || "").toLowerCase();
        const r = classifyHost(domain, adminHost, deployHostSuffix);
        if (r.type === "admin") return send(res, 200, "text/plain", "ok");
        if (r.type === "deploy" && Store.validName(r.project) && (await store.getProject(r.project))) return send(res, 200, "text/plain", "ok");
        return send(res, 404, "text/plain", "unknown host");
      }

      const route = classifyHost(host, adminHost, deployHostSuffix);

      if (route.type === "admin") return await handleAdmin(req, res, store, viewOpts);
      if (route.type === "deploy") return await serveDeploy(req, res, store, route);
      return send(res, 404, "text/plain; charset=utf-8", "quay: unknown host '" + host + "'");
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, "application/json; charset=utf-8", JSON.stringify({ error: e.message }));
    }
  });

  return { server, store };
}

function classifyHost(host, adminHost, suffix) {
  if (host === adminHost) return { type: "admin" };
  if (host.endsWith("." + suffix)) {
    const sub = host.slice(0, -(suffix.length + 1));
    if (!sub) return { type: "unknown" };
    const idx = sub.indexOf("--");
    if (idx >= 0) return { type: "deploy", project: sub.slice(idx + 2), version: sub.slice(0, idx) };
    return { type: "deploy", project: sub, version: null }; // null → production pointer
  }
  return { type: "unknown" };
}

async function serveDeploy(req, res, store, { project, version }) {
  if (!Store.validName(project)) return send(res, 404, "text/plain", "not found");
  const proj = await store.getProject(project);
  if (!proj) return send(res, 404, "text/plain; charset=utf-8", "quay: no project '" + project + "'");
  const ver = version ?? proj.production;
  if (!ver) return send(res, 503, "text/plain; charset=utf-8", "quay: '" + project + "' has no production deploy yet");
  if (version && !proj.deploys.some(d => d.version === version))
    return send(res, 404, "text/plain; charset=utf-8", "quay: no version '" + version + "'");

  const file = await store.resolveFile(project, ver, req.url || "/");
  if (!file) return send(res, 404, "text/html; charset=utf-8", notFoundPage(project));

  const st = await stat(file);
  res.writeHead(200, {
    "content-type": mimeFor(file),
    "content-length": st.size,
    "cache-control": version ? "public, max-age=31536000, immutable" : "public, max-age=60",
    "x-quay-version": ver,
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

async function handleAdmin(req, res, store, opts) {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;

  if (req.method === "GET" && path === "/")
    return send(res, 200, "text/html; charset=utf-8", dashboardHtml(opts));

  if (path === "/api/projects" && req.method === "GET") {
    const projects = await store.listProjects();
    return json(res, 200, projects.sort((a, b) => a.name.localeCompare(b.name)));
  }

  // mutating routes require the bearer token
  let m;
  if ((m = path.match(/^\/api\/projects\/([^/]+)\/deploys$/)) && req.method === "POST") {
    requireAuth(req, store);
    const body = await readBody(req, MAX_UPLOAD);
    const out = await store.createDeploy(decodeURIComponent(m[1]), body);
    return json(res, 201, { ...out, previewUrl: previewUrl(out.name, out.version, opts) });
  }
  if ((m = path.match(/^\/api\/projects\/([^/]+)\/promote$/)) && req.method === "POST") {
    requireAuth(req, store);
    const { version } = JSON.parse((await readBody(req, 1 << 16)).toString() || "{}");
    if (!version) throw new HttpError(400, "version required");
    const proj = await store.promote(decodeURIComponent(m[1]), version);
    return json(res, 200, { name: proj.name, production: proj.production });
  }
  if ((m = path.match(/^\/api\/projects\/([^/]+)$/)) && req.method === "GET") {
    const proj = await store.getProject(decodeURIComponent(m[1]));
    return proj ? json(res, 200, proj) : json(res, 404, { error: "no such project" });
  }
  return json(res, 404, { error: "not found" });
}

function requireAuth(req, store) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!store.checkToken(token)) throw new HttpError(401, "invalid or missing bearer token");
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, "upload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const previewUrl = (project, version, { scheme, deployHostSuffix, portSuffix = "" }) =>
  `${scheme}://${version}--${project}.${deployHostSuffix}${portSuffix}`;

function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, "application/json; charset=utf-8", JSON.stringify(obj, null, 2));

function notFoundPage(project) {
  return `<!doctype html><meta charset=utf-8><title>404 · quay</title><style>body{font-family:Georgia,serif;background:#f4efe4;color:#211b12;display:grid;place-items:center;height:100vh;margin:0}div{text-align:center}code{font-family:ui-monospace,monospace;color:#8a2d22}</style><div><h1>404</h1><p>Not found in <code>${project}</code>.</p></div>`;
}
