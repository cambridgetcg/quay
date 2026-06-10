# Quay

**A self-hostable deploy platform.** Push a build, get an immutable preview URL, promote one to production. One VPS, one binary's worth of Node, zero npm dependencies.

```
npm start                                  # daemon on http://quay.localhost:7000
quay login --token <printed-token>
quay deploy ./your-build --project hello   # → http://<version>--hello.quay.localhost:7000
quay promote hello <version>               # → http://hello.quay.localhost:7000
```

`*.localhost` resolves to `127.0.0.1` in every modern browser, so previews work locally with **no DNS and no TLS setup**. On a real box, [`deploy/install.sh`](deploy/install.sh) provisions Caddy (automatic HTTPS, on-demand certs for every preview subdomain) in front of the daemon.

## Why it exists

The "build our own Vercel" pieces, kept deliberately small and legible:

- **Immutable, content-addressed deploys.** A deploy's version is the hash of its *extracted file tree*, so identical content is one version no matter how it was packed. Nothing is ever overwritten; promotion moves a pointer. (The same recipe-not-memory instinct as the rest of this family of repos, applied to web builds.)
- **Preview URL per version, production per pointer.** `<version>--<project>.<suffix>` serves an exact build forever (immutable cache headers); `<project>.<suffix>` serves whatever is promoted.
- **One daemon, routed by Host header.** No per-site config, no restarts. A new project exists the moment you deploy to it.
- **A dashboard with taste.** Same house style as [the reading room](https://github.com/cambridgetcg/agent-awareness-research) it was built to host — Fraunces, oxblood, cream; dark-mode aware.

## Security posture

This daemon terminates a deploy API and serves arbitrary uploaded files, so the sharp edges are handled up front and tested ([`test/quay.test.js`](test/quay.test.js), 18 tests). **v0.2 was hardened after an adversarial review** that found — and verified live — a critical unauthenticated token leak and three other criticals; each is now closed with a regression test asserting the exploit fails:

- **No admin-API traversal:** the read route validated project names like the write routes did not, so `GET /api/projects/..%2Fconfig` leaked the bearer token from `config.json`. Names are now validated on *every* path; the exploit returns 404.
- **Loopback by default:** the daemon bound `0.0.0.0`, exposing `:7000` (plaintext, no auth on reads) directly on a public VPS. It now binds `127.0.0.1`; the installer also firewalls the port.
- **Atomic, serialized writes:** project JSON is written tmp-then-`rename` under a per-name mutex — no lost updates, no partial reads from a concurrent deploy+promote.
- **Decompression-bomb cap:** the 64 MB limit was on *compressed* bytes; extraction now streams through a 256 MB *decompressed* budget and a 20k file cap, aborting mid-stream.
- **Auth:** mutating routes require a bearer token, constant-time compared; `config.json` is `0600`; the token prints only when first generated.
- **Path traversal (serving):** confined to the deploy dir (real-path checked); `../`, `..%2f`, double-encoded, control-char, and malformed-`%` paths all 404 (never 500).
- **Symlink/hardlink uploads rejected;** the on-demand-TLS guard is loopback-only (not a public project-enumeration oracle) and also blocked at the Caddy edge.

## Layout

```
bin/quayd.js       the daemon (start with `npm start`)
bin/quay.js        the CLI
src/server.js      Host-routing, static serving, deploy/promote API
src/store.js       immutable content-addressed storage; confinement + symlink guards
src/dashboard.js   the dashboard page
deploy/            Caddyfile.tmpl + install.sh (one-shot VPS provisioning)
docker-compose.yml local, persistent, no TLS
test/              9 tests — auth, traversal, symlinks, immutability, routing
```

## Status & roadmap

**v0.2 — static sites, working end to end, post-review-hardened.** The reading room is its first tenant (`quay deploy`, `promote`, `prune`, `ls`). Retention GC, a `/healthz` endpoint, atomic writes, and a systemd-hardened installer are in.

Honestly not yet built (named, not implied): running app processes (Node/other) behind the proxy, build steps (it serves pre-built dirs), `ETag`/`Range` support, multi-token rotation/revocation, streaming CLI upload for multi-GB builds, and log streaming. Like its sibling repos, this one keeps requesting adversarial review and revision — the daemon is small precisely so the review can be thorough, and the last round turned up a critical the tests now guard against.
