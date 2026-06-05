# Level: Dashboard Forward-Auth (shipped design)

> Level Agency internal note (lives in our fork `LevelInteractive/lat-paperclip`).
> Not upstream. Documents how the `paperclip` Dokploy service is gated on the
> platform Google session.

## Goal

Reaching `https://paperclip.dash.level.agency` requires a valid `*.dash.level.agency`
platform Google session — the non-Next.js analogue of the zone-app `can-access-app`
gate. We reuse Paperclip's **built-in trusted-header forward-auth**
(`resolveCloudTenantActor`, `server/src/middleware/auth.ts`) rather than a second login.

**Decisions:**
- **Gate = any valid platform session** (any `@level.agency` user). No per-app allowlist
  in v1 (can be added later via `decideAppAccessForUser(userId, "paperclip")`).
- **Least-privilege inside Paperclip** — the injected `stack-role` drives the grant:
  LEADERSHIP/admins → `instance_admin`; everyone else → company `member`.

## Architecture (split-secret — revised after code review)

```
browser ──▶ Traefik (websecure, Host=paperclip.dash.level.agency)
              │  [1] paperclip-forward-auth (forwardAuth) — forwards Cookie
              ▼
        dashboard  GET /api/internal/forward-auth
              │  auth() validates the platform session
              │  • no session → 302 dash.level.agency/login?callbackUrl=…
              │  • valid      → 200 + NON-SECRET x-paperclip-cloud-* IDENTITY headers
              ▼  (Traefik copies authResponseHeaders onto the upstream request)
              │  [2] paperclip-inject (headers) — injects the tenant TOKEN
              │      (server-side only) + STRIPS the dashboard session Cookie
              ▼
        Paperclip :3100  resolveCloudTenantActor → upsert user + auth, no 2nd login
```

**The dashboard never holds or emits the tenant token.** It returns only the six
non-secret identity headers. The secret `x-paperclip-cloud-tenant-token` is injected by a
Traefik request-header middleware (`paperclip-inject`) and lives only in two server-side
places: `.env.dokploy.local` (→ Paperclip's container env) and the generated Traefik
dynamic config on the droplet. So even though any authenticated employee can reach the
verify endpoint, they only ever read their **own identity** — useless without the token,
which no browser can see. `customRequestHeaders` overrides any client-supplied token, and
the six identity headers are in `authResponseHeaders` so client copies are stripped.

`paperclip-inject` also **strips the dashboard session Cookie** before the request reaches
Paperclip, so the platform JWT (a bearer valid across all zone apps) never leaks into the
third-party app. `trustForwardHeader: false` means Traefik sets `X-Forwarded-*` from the
real connection, so the dashboard can't be fooled by client-forged forwarded headers.

### Header / identity mapping

Injected by Traefik (`paperclip-inject`), server-side only:

| Header | Value |
|---|---|
| `x-paperclip-cloud-tenant-token` | shared secret `PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN` (Paperclip env + Traefik file; NOT the dashboard) |

Emitted by the dashboard verify endpoint (non-secret identity):

| Header | Value |
|---|---|
| `x-paperclip-cloud-user-id` | dashboard `session.user.id` (CR/LF stripped) |
| `x-paperclip-cloud-user-email` | session email (lowercased, stripped) |
| `x-paperclip-cloud-user-name` | session name (stripped) |
| `x-paperclip-cloud-stack-id` | `"level-agency"` (constant → one shared company) |
| `x-paperclip-cloud-stack-role` | `admin` for LEADERSHIP / platform owner\|admin, else `member` |
| `x-paperclip-cloud-paperclip-company-id` | `"Level Agency"` (company display *name*; real id is derived from stack-id) |

The server-side upsert in `resolveCloudTenantActor` **bypasses better-auth signup**, so
`PAPERCLIP_AUTH_DISABLE_SIGN_UP=true` does not block forward-auth provisioning. No new
Google OAuth callback URI is needed — sign-in happens on dash and bounces back (the auth
redirect callback already trusts `*.dash.level.agency`).

## Fork patches (this repo)

- `server/src/middleware/auth.ts`
  - Factored `readCloudTenantHeaders(getHeader)` — token check + header parsing + derived
    company id + `isInstanceAdmin` (true only for stack `owner`/`admin`). Exported so the
    websocket handler shares the exact contract.
  - `resolveCloudTenantActor` now **gates the `instance_admin` insert** on
    `isInstanceAdmin` and **reconciles** (deletes a stale grant) for non-admins, so a
    downgrade actually revokes admin. Returned actor reports the real `isInstanceAdmin`.
    The HTTP `actorMiddleware` wraps this call in try/catch — a partial/garbled header set
    degrades to the better-auth path instead of an uncaught async throw (500/hang).
- `server/src/realtime/live-events-ws.ts`
  - `authorizeUpgrade` honors the same injected headers **before** the better-auth path
    (forward-auth users have no better-auth cookie). Traefik injects the headers on the WS
    upgrade GET too. Mirrors the better-auth branch: an instance admin may subscribe to any
    company; everyone else only to their own derived company.
- Tests: `server/src/__tests__/auth-session-route.test.ts` covers the member (least-priv)
  and owner (instance_admin) paths.

## Platform wiring (monorepo `level-agency-tools`)

- **Dashboard endpoint:** `apps/dashboard/src/app/api/internal/forward-auth/route.ts` —
  emits identity headers only; never the token.
- **Env:** `PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN` in `.env.dokploy.local` → injected into the
  Paperclip container via the `paperclip)` case in `scripts/dokploy/_env-block.sh`. The
  dashboard does **not** need this var.
- **Traefik:** `scripts/dokploy/gen-paperclip-forward-auth.py` reads the token from the
  environment and emits the self-managed dynamic config (priority-1000 override router +
  `paperclip-forward-auth` forwardAuth + `paperclip-inject` headers middleware) to
  `/etc/dokploy/traefik/dynamic/paperclip-forward-auth.yml`. The generated file **contains
  the secret** — gitignored, scp it to the droplet and delete the local copy. Deleting the
  droplet file is the instant rollback to the default ungated router.

## Risks / notes

- **Token leak** — eliminated structurally: the dashboard never holds the token, and it's
  injected server-side by Traefik. (The earlier `X-Forwarded-Host`-gated design was dropped
  after review — that guard depends on Traefik entrypoint config + a patched Traefik and is
  not a sound boundary for a secret.)
- **Session-cookie leak** — `paperclip-inject` strips the dashboard `Cookie` before the
  request reaches Paperclip, so the platform JWT never enters the third-party app.
- **Direct container access** — port 3100 must be Swarm-network only. **Verify on the
  droplet** there's no host port publish and no other Traefik router on web/websecure that
  reaches Paperclip without the middleware (`docker inspect`, `ss -ltnp`, external curl to
  :3100). With the trusted-header model this is the primary bypass to rule out.
- **Traefik version** — confirm Traefik is patched for the April 2026 forwardAuth
  forwarded-header advisories (≥ v2.11.43 / v3.6.14) and that entrypoint
  `forwardedHeaders.insecure` is false. Re-check after any Dokploy upgrade.
- **Header spoofing** — identity headers are in `authResponseHeaders` and the token is set
  via `customRequestHeaders`, so Traefik overwrites any client-supplied values.
- **better-auth** stays configured (`mode=authenticated`, `exposure=private`) as the
  fallback gate; the cloud-tenant path short-circuits it for normal users.

## Out of scope / follow-ups

- `can-access-app("paperclip")` allowlist in the verify endpoint (register paperclip as an
  app + AppAccessPolicy) to tighten the gate beyond "any employee".
- Per-user vs. shared workspace — this design uses one shared company (`stack-id=level-agency`).
- Agent spend budgets are configured inside Paperclip and are independent of access gating.

_Related: monorepo `scripts/dokploy/deploy-paperclip.sh`, `scripts/dokploy/_env-block.sh`,
`scripts/dokploy/gen-paperclip-forward-auth.py`,
`apps/dashboard/src/app/api/internal/forward-auth/route.ts`._
