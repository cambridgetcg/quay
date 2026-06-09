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

This daemon terminates a deploy API and serves arbitrary uploaded files, so the sharp edges are handled up front and tested ([`test/quay.test.js`](test/quay.test.js)):

- **Auth:** mutating routes require a bearer token, compared in constant time.
- **Path traversal:** served paths are resolved and confined to the deploy dir (real-path checked); `../`, encoded `..%2f`, and nested escapes all 404.
- **Symlink uploads rejected:** a tarball symlink could otherwise point the server at `/etc/passwd`; extraction walks the tree and refuses any symlink or non-regular file.
- **Upload bounds:** 64 MB cap; project names are strictly validated.
- **On-demand TLS guard:** Caddy asks the daemon before minting a cert, so random subdomains can't exhaust ACME rate limits.

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

**v0.1 — static sites, working end to end.** The reading room is its first tenant. Honestly not yet built: running app processes (Node/other) behind the proxy, build steps (it serves pre-built dirs), rollback UI, multi-user/teams, and log streaming. Those are the v0.2 surface. Like its sibling repos, this one requests adversarial review and revision — the daemon is small precisely so the review can be thorough.
