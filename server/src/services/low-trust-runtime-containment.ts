import { unprocessable } from "../errors.js";
import type { TrustPresetResolution } from "./trust-preset-resolver.js";
import { isIssueWithinLowTrustBoundary } from "./trust-preset-resolver.js";

export const LOW_TRUST_RUNTIME_MANAGEMENT_TOOL_CLASS = "runtime.manage";

export function isLowTrustRuntimeManagementAllowed(resolution: TrustPresetResolution) {
  return resolution.kind === "low_trust_review" &&
    (resolution.boundary.allowedToolClasses ?? []).includes(LOW_TRUST_RUNTIME_MANAGEMENT_TOOL_CLASS);
}

export function assertLowTrustWorkspaceIsolation(input: {
  resolution: TrustPresetResolution;
  isolatedWorkspacesEnabled: boolean;
  effectiveExecutionWorkspaceMode: string | null | undefined;
  selectedEnvironmentDriver: string | null | undefined;
  issue: { companyId: string; id?: string | null; projectId?: string | null } | null;
}) {
  if (input.resolution.kind === "denied") {
    throw unprocessable(input.resolution.detail, {
      code: input.resolution.reason,
      source: input.resolution.source,
    });
  }
  if (input.resolution.kind !== "low_trust_review") return;

  if (!input.isolatedWorkspacesEnabled) {
    throw unprocessable("Low-trust execution requires isolated workspaces to be enabled.", {
      code: "low_trust_isolation_unavailable",
    });
  }
  if (input.effectiveExecutionWorkspaceMode !== "isolated_workspace") {
    throw unprocessable("Low-trust execution requires an isolated execution workspace.", {
      code: "low_trust_requires_isolated_workspace",
    });
  }
  if (!input.issue || !isIssueWithinLowTrustBoundary(input.resolution.boundary, input.issue)) {
    throw unprocessable("Low-trust execution issue is outside the active trust boundary.", {
      code: "low_trust_boundary_mismatch",
    });
  }
  if (input.selectedEnvironmentDriver !== "sandbox") {
    throw unprocessable("Low-trust execution requires a sandbox environment driver.", {
      code: "low_trust_requires_sandbox_environment",
    });
  }
}

export function assertLowTrustRuntimeServicesAllowed(input: {
  resolution: TrustPresetResolution;
  runtimeServiceCount: number;
}) {
  if (input.resolution.kind === "denied") {
    throw unprocessable(input.resolution.detail, {
      code: input.resolution.reason,
      source: input.resolution.source,
    });
  }
  if (input.resolution.kind !== "low_trust_review") return;
  if (input.runtimeServiceCount === 0) return;
  if (isLowTrustRuntimeManagementAllowed(input.resolution)) return;
  throw unprocessable("Low-trust execution cannot start runtime services unless the boundary grants runtime.manage.", {
    code: "low_trust_runtime_services_denied",
  });
}
