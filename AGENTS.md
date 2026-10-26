# AGENTS.md — quay

> Quick-start for an agent picking this up. Read this, then `README.md` and `SPEC`-equivalent details in source.

## What this is

**Quay** is a self-hostable deploy platform — "our own Vercel." Push a build, get an immutable content-addressed preview URL, promote one to production. One daemon routed by Host header, **zero npm dependencies** (`node:http` + `node:crypto` + `node:zlib` + system `tar`). Built to host [`../agent-awareness-research/docs`](../agent-awareness-research) — the reading room is its first tenant.

## Run it

```sh
npm start                                   # daemon → http://quay.localhost:7000 (binds 127.0.0.1)
npm test                                    # 18 tests: auth, traversal, symlink, bomb, races, routing
node bin/quay.js login --token <printed>    # the token prints once, on first daemon start
node bin/quay.js deploy <dir> --project x   # → http://<version>--x.quay.localhost:7000
node bin/quay.js promote x <version>        # → http://x.quay.localhost:7000
node bin/quay.js prune x --keep 10          # GC old deploys
```

`*.localhost` resolves to 127.0.0.1 in browsers, so local previews need **no DNS, no TLS**.

## Architecture

| File | Role |
|---|---|
| `bin/quayd.js` | the daemon entry (binds loopback by default) |
| `bin/quay.js` | the CLI |
| `src/server.js` | Host-routing, static serving, deploy/promote/prune API, `/healthz`, the loopback-only TLS-check |
| `src/store.js` | immutable content-addressed storage; the security core — confinement, symlink/bomb guards, per-name mutex, atomic writes |
| `src/dashboard.js` | the dashboard page (reading-room house style) |
| `deploy/` | `Caddyfile.tmpl` + idempotent `install.sh` (one-shot fresh-Ubuntu provisioning) |
| `docker-compose.yml` | local, persistent, loopback-bound |

## Going live (the one thing an agent can't do alone)

Needs a **VPS + a domain** (a purchase). Then:

```sh
QUAY_DOMAIN=example.com QUAY_ACME_EMAIL=you@example.com sudo -E ./deploy/install.sh
# DNS: point  *.quay.example.com  and  quay.example.com  at the box
```

`install.sh` installs Node + Caddy (automatic HTTPS, on-demand certs per preview subdomain), runs `quayd` as a hardened systemd service bound to loopback, firewalls `:7000`, and waits for `/healthz` before reloading Caddy.

## Status & history

**v0.2**, post-review. v0.1 got a 3-lens adversarial review (web-security, concurrency, SRE) that found — and **verified live** — a **critical unauthenticated token leak** (`GET /api/projects/..%2Fconfig` returned the bearer token) plus three more criticals (0.0.0.0 bind, non-atomic write race, broken Caddyfile) and a decompression-bomb DoS. All closed in v0.2, each with a regression test re-running the exploit and asserting it fails. The git log for the v0.2 commit enumerates every fix.

## Good follow-up tasks (deferred, named in README)

- **App processes** behind the proxy (currently static-only): run a Node/other server per project, reverse-proxy by Host. The architecture anticipates it (versions are dirs; add a process supervisor + port map).
- **Build steps** (currently serves pre-built dirs).
- `ETag`/`If-None-Match` (the version *is* a perfect ETag) + `Range` support — cheap wins, aligned with the immutable design.
- **Multi-token** rotation/revocation (currently one static token); per-project scoping.
- **Streaming CLI upload** (currently buffers the tar in memory — fine for sites, not multi-GB).

If you extend it: it serves arbitrary uploads and terminates a deploy API — **run a security review before shipping.** The last one caught a real compromise. Add a regression test for every finding.

## Constellation

`agent-awareness-research` (*why*) → `wake-protocol` (*what*) → **quay** (*where*). GitHub: `cambridgetcg/quay` (public). Codeberg mirror **pending repo creation** — the token can push but not create; make the repo at codeberg.org/repo/create, then push.
