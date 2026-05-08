import {
  KubeConfig,
  CoreV1Api,
  BatchV1Api,
  NetworkingV1Api,
  RbacAuthorizationV1Api,
  ApiextensionsV1Api,
} from "@kubernetes/client-node";
import type { ResolvedClusterConnection, KubernetesApiClient } from "./types.js";

export function createKubernetesApiClient(connection: ResolvedClusterConnection): KubernetesApiClient {
  const kc = new KubeConfig();

  if (connection.kind === "in-cluster") {
    // Detect whether we're actually running inside a Kubernetes pod by checking
    // the standard in-cluster env vars. loadFromCluster() does not throw when
    // these are absent — it just builds a cluster with an invalid server URL.
    if (!process.env["KUBERNETES_SERVICE_HOST"] || !process.env["KUBERNETES_SERVICE_PORT"]) {
      throw new Error(
        `Cluster connection ${connection.id} is in-cluster but Paperclip is not running inside a Kubernetes pod ` +
          `(KUBERNETES_SERVICE_HOST / KUBERNETES_SERVICE_PORT are not set)`,
      );
    }
    try {
      kc.loadFromCluster();
    } catch (err) {
      throw new Error(
        `Cluster connection ${connection.id} is in-cluster but Paperclip is not running inside a Kubernetes pod: ${(err as Error).message}`,
      );
    }
    if (!kc.getCurrentCluster()) {
      throw new Error(
        `Cluster connection ${connection.id} is in-cluster but no cluster could be loaded — is Paperclip running inside a Kubernetes pod?`,
      );
    }
  } else {
    if (!connection.kubeconfigYaml) {
      throw new Error(`Cluster connection ${connection.id} is kind=kubeconfig but kubeconfigYaml is empty`);
    }
    kc.loadFromString(connection.kubeconfigYaml);
  }

  const core = kc.makeApiClient(CoreV1Api);
  const batch = kc.makeApiClient(BatchV1Api);
  const networking = kc.makeApiClient(NetworkingV1Api);
  const rbac = kc.makeApiClient(RbacAuthorizationV1Api);
  const apiext = kc.makeApiClient(ApiextensionsV1Api);

  const ctx = kc.getCurrentContext();

  return {
    core,
    batch,
    networking,
    rbac,
    apiext,
    describe: () => `${connection.label} (context=${ctx})`,
    async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
      const cluster = kc.getCurrentCluster();
      if (!cluster) throw new Error(`No current cluster in kubeconfig`);
      const url = new URL(path, cluster.server).toString();

      // Build fetch options with kubeconfig auth applied.
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      const init: RequestInit = {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      };

      // applyToFetchOptions injects auth headers and TLS material on supported kc versions.
      // @kubernetes/client-node v0.21+ exposes applyToFetchOptions.
      // We try it first and fall back to direct bearer-token injection if not present.
      type ApplyFn = (opts: RequestInit) => Promise<void>;
      const applyToFetchOptions = (kc as unknown as { applyToFetchOptions?: ApplyFn }).applyToFetchOptions;
      if (typeof applyToFetchOptions === "function") {
        await applyToFetchOptions.call(kc, init);
      } else {
        // Best-effort fallback: inject bearer token from current user.
        const user = kc.getCurrentUser();
        if (user?.token) {
          headers["Authorization"] = `Bearer ${user.token}`;
        }
      }

      const res = await fetch(url, init);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`k8s API ${method} ${path} failed ${res.status}: ${text}`);
      }
      // 204 No Content has no body.
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
  };
}
