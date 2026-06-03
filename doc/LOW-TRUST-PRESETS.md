# Low-Trust Presets

Paperclip ships core trust preset names so containment decisions are enforced in
Community Edition even when EE policy editing is unavailable.

## Presets

- `standard`: the default V1 company-visible collaboration model. This preserves
  existing behavior for normal agents.
- `low_trust_review`: an opt-in containment preset for automated work that may
  consume hostile or prompt-injected input, such as untrusted pull requests,
  external tickets, dependency diffs, or generated review output.

## Boundary Model

`low_trust_review` is resolved from existing JSON policy fields:

- agent permissions: `permissions.trustPreset` and
  `permissions.authorizationPolicy.trustBoundary`
- project policy:
  `executionWorkspacePolicy.authorizationPolicy.trustBoundary`
- issue/run policy: `executionPolicy.authorizationPolicy.trustBoundary`

The resolver intersects those sources. Narrower wins. A low-trust preset must
resolve to a concrete company-local project, root issue, or issue-id scope. If a
policy source names another company, uses an unsupported preset, or lacks that
scope for risky access, Paperclip fails closed.

## Containment, Not Privacy

This is containment for hostile automated work. It is not a general project,
issue, or human privacy system.

V1 standard work remains company-visible by default: board users and in-company
actors can inspect company work objects unless a separate access-control feature
changes that behavior. Low-trust containment instead limits what the low-trust
agent can read or mutate through the Paperclip API and prevents raw untrusted
output from being automatically promoted into higher-trust agent context.
