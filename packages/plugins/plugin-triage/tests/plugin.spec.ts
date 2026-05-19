import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Company } from "@paperclipai/plugin-sdk";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest, {
  PLUGIN_ID,
  TRIAGE_ASSISTANT_AGENT_KEY,
  TRIAGE_MANAGED_SKILL_CANONICAL_KEYS,
  TRIAGE_MANAGED_SKILL_KEYS,
  TRIAGE_PROJECT_KEY,
} from "../src/manifest.js";
import plugin, { createTriagePlugin } from "../src/worker.js";
import { createInMemoryTriageStore } from "../src/triage.js";

const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-2";

function company(id: string, name = id): Company {
  const now = new Date();
  return {
    id,
    name,
    description: null,
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: id === COMPANY_ID ? "PAP" : "ALT",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    attachmentMaxBytes: 25_000_000,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    brandColor: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Paperclip Triage scaffold", () => {
  it("declares the package manifest, UI slots, and managed resources", () => {
    expect(manifest).toMatchObject({
      id: PLUGIN_ID,
    });
    expect(manifest.database).toEqual({
      namespaceSlug: "triage",
      migrationsDir: "migrations",
      coreReadTables: ["companies", "issues"],
    });
    expect(manifest.apiRoutes).toEqual([
      expect.objectContaining({
        routeKey: "items.ingest",
        method: "POST",
        path: "/queues/:queueKey/items",
      }),
    ]);
    expect(manifest.capabilities).toEqual(expect.arrayContaining([
      "api.routes.register",
      "database.namespace.migrate",
      "database.namespace.read",
      "database.namespace.write",
      "companies.read",
      "agents.managed",
      "projects.managed",
      "skills.managed",
      "instance.settings.register",
      "ui.sidebar.register",
      "ui.page.register",
    ]));
    expect(manifest.ui?.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "sidebar", exportName: "SidebarLink" }),
      expect.objectContaining({ type: "page", exportName: "TriagePage", routePath: "triage" }),
      expect.objectContaining({ type: "routeSidebar", exportName: "TriageRouteSidebar", routePath: "triage" }),
      expect.objectContaining({ type: "settingsPage", exportName: "SettingsPage" }),
    ]));
    expect(manifest.agents?.[0]).toEqual(expect.objectContaining({
      agentKey: TRIAGE_ASSISTANT_AGENT_KEY,
      displayName: "Triage Assistant",
      status: "paused",
      permissions: { pluginTools: [PLUGIN_ID] },
    }));
    expect(manifest.agents?.[0]?.adapterConfig?.paperclipSkillSync).toEqual({
      desiredSkills: TRIAGE_MANAGED_SKILL_CANONICAL_KEYS,
    });
    expect(manifest.projects?.[0]).toEqual(expect.objectContaining({
      projectKey: TRIAGE_PROJECT_KEY,
      displayName: "Triage",
    }));
    expect(manifest.skills?.map((skill) => skill.skillKey)).toEqual(TRIAGE_MANAGED_SKILL_KEYS);
  });

  it("declares the plugin-owned triage migration shape", () => {
    const migration = readFileSync(new URL("../migrations/001_triage_core.sql", import.meta.url), "utf8");

    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_queues");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_queue_states");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_queue_transitions");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_items");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_queue_chats");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_guidance_docs");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_guidance_doc_revisions");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_guidance_proposals");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_item_events");
    expect(migration).toContain("CREATE TABLE plugin_triage_f3b4aa721e.triage_transition_actions");
    expect(migration).toContain("REFERENCES public.companies(id)");
    expect(migration).toContain("REFERENCES public.issues(id)");
    expect(migration).toContain("CREATE UNIQUE INDEX triage_items_queue_item_key_idx");
    expect(migration).toContain("CREATE UNIQUE INDEX triage_items_queue_idempotency_key_idx");
  });

  it("reports missing managed resources before reconcile", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);

    const health = await harness.getData<{ status: string; skills: Array<{ status: string }> }>(
      "managed-resource-health",
      { companyId: COMPANY_ID },
    );

    expect(health.status).toBe("missing");
    expect(health.skills).toHaveLength(TRIAGE_MANAGED_SKILL_KEYS.length);
    expect(health.skills.every((skill) => skill.status === "missing")).toBe(true);
  });

  it("reconciles managed project, assistant, and skills", async () => {
    const harness = createTestHarness({ manifest });
    await plugin.definition.setup(harness.ctx);

    const result = await harness.performAction<{
      status: string;
      agent: { status: string; agentId: string | null };
      project: { status: string; projectId: string | null };
      skills: Array<{ status: string; skillId: string | null; key: string | null }>;
    }>("reconcile-managed-resources", { companyId: COMPANY_ID });

    expect(result.status).toBe("ready");
    expect(result.agent).toEqual(expect.objectContaining({ status: "created" }));
    expect(result.agent.agentId).toBeTruthy();
    expect(result.project).toEqual(expect.objectContaining({ status: "created" }));
    expect(result.project.projectId).toBeTruthy();
    expect(result.skills).toHaveLength(TRIAGE_MANAGED_SKILL_KEYS.length);
    expect(result.skills.every((skill) => skill.status === "created")).toBe(true);
    expect(result.skills.map((skill) => skill.key)).toEqual(TRIAGE_MANAGED_SKILL_CANONICAL_KEYS);
  });
});

describe("Paperclip Triage queue and item ingest", () => {
  function createHarness() {
    const store = createInMemoryTriageStore();
    const testPlugin = createTriagePlugin({ createStore: () => store });
    const harness = createTestHarness({ manifest });
    harness.seed({ companies: [company(COMPANY_ID), company(OTHER_COMPANY_ID)] });
    return { harness, plugin: testPlugin };
  }

  it("creates and updates queues through worker actions", async () => {
    const { harness, plugin: testPlugin } = createHarness();
    await testPlugin.definition.setup(harness.ctx);

    const created = await harness.performAction<{ queue: { queueKey: string; title: string }; created: boolean }>(
      "create-queue",
      { companyId: COMPANY_ID, queueKey: "reviews", title: "Reviews" },
    );
    expect(created).toMatchObject({
      created: true,
      queue: { queueKey: "reviews", title: "Reviews" },
    });

    await harness.performAction("update-queue", {
      companyId: COMPANY_ID,
      queueKey: "reviews",
      title: "Editorial Reviews",
    });

    await expect(harness.getData("queue", { companyId: COMPANY_ID, queueKey: "reviews" }))
      .resolves.toMatchObject({ queueKey: "reviews", title: "Editorial Reviews" });
    await expect(harness.getData("queues", { companyId: OTHER_COMPANY_ID }))
      .resolves.toEqual([]);
  });

  it("strictly rejects missing queues when requireExistingQueue is true", async () => {
    const { harness, plugin: testPlugin } = createHarness();
    await testPlugin.definition.setup(harness.ctx);

    await expect(harness.performAction("ingest-item", {
      companyId: COMPANY_ID,
      queueKey: "unknown",
      title: "Should not create",
      requireExistingQueue: true,
    })).rejects.toMatchObject({
      status: 404,
      code: "queue_not_found",
    });

    await expect(harness.getData("queues", { companyId: COMPANY_ID })).resolves.toEqual([]);
  });

  it("auto-creates a queue on ingest and upserts by stable item key", async () => {
    const { harness, plugin: testPlugin } = createHarness();
    await testPlugin.definition.setup(harness.ctx);

    const first = await harness.performAction<{
      createdQueue: boolean;
      createdItem: boolean;
      item: { id: string; title: string; content: string; revision: number };
      queue: { queueKey: string; activeItemCount: number };
    }>("ingest-item", {
      companyId: COMPANY_ID,
      queueKey: "content-training",
      title: "Draft launch post",
      content: "# Draft",
      itemKey: "external-1",
      properties: { sourceKind: "fixture" },
    });

    expect(first).toMatchObject({
      createdQueue: true,
      createdItem: true,
      item: { title: "Draft launch post", content: "# Draft", revision: 1 },
      queue: { queueKey: "content-training", activeItemCount: 1 },
    });

    const second = await harness.performAction<{
      createdQueue: boolean;
      createdItem: boolean;
      upserted: boolean;
      item: { id: string; title: string; content: string; revision: number };
      queue: { activeItemCount: number };
    }>("ingest-item", {
      companyId: COMPANY_ID,
      queueKey: "content-training",
      title: "Revised launch post",
      content: "# Revised",
      itemKey: "external-1",
    });

    expect(second).toMatchObject({
      createdQueue: false,
      createdItem: false,
      upserted: true,
      item: { id: first.item.id, title: "Revised launch post", content: "# Revised", revision: 2 },
      queue: { activeItemCount: 1 },
    });

    await expect(harness.getData("queue-items", { companyId: COMPANY_ID, queueKey: "content-training" }))
      .resolves.toHaveLength(1);
  });

  it("keeps queue keys company-scoped and validates scoped API company context", async () => {
    const { harness, plugin: testPlugin } = createHarness();
    await testPlugin.definition.setup(harness.ctx);

    await harness.performAction("ingest-item", {
      companyId: COMPANY_ID,
      queueKey: "inbox",
      title: "Company one item",
      idempotencyKey: "same-upstream-request",
    });
    await harness.performAction("ingest-item", {
      companyId: OTHER_COMPANY_ID,
      queueKey: "inbox",
      title: "Company two item",
      idempotencyKey: "same-upstream-request",
    });

    await expect(harness.getData("queue-items", { companyId: COMPANY_ID, queueKey: "inbox" }))
      .resolves.toEqual([expect.objectContaining({ title: "Company one item" })]);
    await expect(harness.getData("queue-items", { companyId: OTHER_COMPANY_ID, queueKey: "inbox" }))
      .resolves.toEqual([expect.objectContaining({ title: "Company two item" })]);

    const mismatch = await testPlugin.definition.onApiRequest?.({
      routeKey: "items.ingest",
      method: "POST",
      path: "/queues/inbox/items",
      params: { queueKey: "inbox" },
      query: {},
      body: {
        companyId: OTHER_COMPANY_ID,
        title: "Wrong company",
      },
      actor: {
        actorType: "user",
        actorId: "board",
        userId: "board",
        agentId: null,
        runId: null,
      },
      companyId: COMPANY_ID,
      headers: {},
    });

    expect(mismatch).toEqual({
      status: 403,
      body: {
        error: {
          code: "company_scope_mismatch",
          message: "Request companyId does not match the resolved plugin route company",
        },
      },
    });
  });
});
