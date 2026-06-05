# Level: Dashboard Forward-Auth Refactor (planned)

> Level Agency internal note (lives in our fork `LevelInteractive/lat-paperclip`).
> Not upstream. Tracks a deferred decision for the `paperclip` Dokploy service.

## Current state (as deployed 2026-06-05)

Paperclip runs as a Dokploy service at **`https://paperclip.dash.level.agency`**
(project `paperclip`, container port 3100). It is **not** behind the platform's
Google SSO. The only gate is **Paperclip's own auth** (better-auth), enabled via:

```
PAPERCLIP_DEPLOYMENT_MODE=authenticated
PAPERCLIP_DEPLOYMENT_EXPOSURE=private
BETTER_AUTH_SECRET=…            # from .env.dokploy.local (PAPERCLIP_BETTER_AUTH_SECRET)
PAPERCLIP_PUBLIC_URL=https://paperclip.dash.level.agency
```

The subdomain is publicly reachable; better-auth is what stands between the
internet and the app. This is acceptable for launch but is **weaker than every
zone app**, which sit behind the dashboard Google session + `can-access-app`
gate.

## The refactor: put dashboard forward-auth in front

Goal: gate `paperclip.dash.level.agency` on the platform's Google session (the
same identity every `@level.agency` user already has), so reaching Paperclip at
all requires a valid platform login — Paperclip's own auth then becomes a second
factor / per-user mapping rather than the sole gate.

Mechanism: a **Traefik forward-auth middleware** on the Dokploy domain that
delegates to a dashboard auth endpoint (the platform's NextAuth/Google session).
This is the non-Next.js analogue of the zone-app `can-access-app` proxy.

### Sketch of the work

1. **Dashboard**: expose a forward-auth verify endpoint (e.g.
   `GET /api/internal/forward-auth`) that returns `200` when the platform
   session cookie is valid for an allowed user, `401/302→login` otherwise.
   Must share the auth cookie domain (`*.dash.level.agency`).
2. **Dokploy**: attach a Traefik `forwardAuth` middleware label to the
   `paperclip` domain pointing at that endpoint (`address`,
   `trustForwardHeader=true`, `authResponseHeaders` for the resolved user).
   Add the middleware in the deploy script (`scripts/dokploy/deploy-paperclip.sh`)
   or the Dokploy UI advanced/labels section.
3. **OAuth callback**: if we want the forward-auth flow to *redirect* to Google
   (rather than 401), add `https://paperclip.dash.level.agency/...callback` to
   the production Google OAuth client.
4. **Identity mapping**: decide how a platform user maps to a Paperclip account
   (auto-provision on first authenticated hit, or pre-seed). Paperclip still
   owns per-user data; forward-auth just proves *who* is knocking.

### Open questions

- Do we keep Paperclip's better-auth *and* forward-auth (defense in depth), or
  switch Paperclip to a trusted-header mode and let the dashboard be the IdP?
- Per-user vs. shared Paperclip workspace for the agency.
- Cost/budget governance: forward-auth controls *access*; agent spend budgets
  are configured inside Paperclip and must be on regardless.

## Why deferred

Forward-auth wiring is heavier than the launch needs (better-auth is sufficient
to keep the app non-public-anonymous). Revisit when Paperclip graduates from
trial to shared agency use, or before granting access beyond the initial pilot
group.

_Related: monorepo `.claude/commands/add-service-app.md` (step 4),
`scripts/dokploy/deploy-paperclip.sh`._
