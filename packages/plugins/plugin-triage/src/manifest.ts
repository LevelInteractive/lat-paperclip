import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclipai.plugin-triage";
export const TRIAGE_ASSISTANT_AGENT_KEY = "triage-assistant";
export const TRIAGE_PROJECT_KEY = "triage";
export const TRIAGE_ASSISTANT_SKILL_KEY = "triage-assistant";
export const TRIAGE_REFLECTION_SKILL_KEY = "triage-reflection";
export const TRIAGE_WORKFLOW_SKILL_KEY = "triage-workflow";
export const TRIAGE_MANAGED_SKILL_KEYS = [
  TRIAGE_ASSISTANT_SKILL_KEY,
  TRIAGE_REFLECTION_SKILL_KEY,
  TRIAGE_WORKFLOW_SKILL_KEY,
] as const;
export const TRIAGE_MANAGED_SKILL_CANONICAL_KEYS = TRIAGE_MANAGED_SKILL_KEYS.map(managedSkillCanonicalKey);

function managedSkillCanonicalKey(skillKey: string): string {
  return `plugin/paperclipai-plugin-triage/${skillKey}`;
}

function skillMarkdown(skillKey: (typeof TRIAGE_MANAGED_SKILL_KEYS)[number]): string {
  if (skillKey === TRIAGE_REFLECTION_SKILL_KEY) {
    return `# Triage Reflection

Use when proposing queue guidance updates after a user and assistant finish processing a queue item.

- Compare the original item, final item, chat outcome, transition decision, and current queue guidance.
- Propose guidance changes only when the next item would benefit from them.
- Never apply guidance directly; return a proposal for board/user review.
- Keep source-specific behavior out of the queue unless it is already represented in item properties or queue guidance.
`;
  }

  if (skillKey === TRIAGE_WORKFLOW_SKILL_KEY) {
    return `# Triage Workflow

Use when reasoning about Paperclip Triage queue states, transitions, and work issue actions.

- Treat queue items as company-scoped records with opaque content and properties.
- Use only configured workflow transitions from the item's current state.
- Respect reflection gates before approving or rejecting an item.
- Limit downstream effects to create-or-update Paperclip issue actions.
- Do not call external systems or mutate upstream sources.
`;
  }

  return `# Triage Assistant

Use when helping a user process items in a Paperclip Triage queue.

- Work from the queue purpose, current item content, item properties, workflow state, and guidance documents.
- Keep chat-assisted edits and direct edits focused on the same queue item record.
- Ask for user approval before guidance changes or irreversible workflow decisions.
- Preserve company boundaries and keep all queue work scoped to the active company.
- Do not add source connector behavior; ingestion starts when an item is posted into a queue.
`;
}

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Paperclip Triage",
  description: "Queue workbench for triaging arbitrary items with a teachable assistant.",
  author: "Paperclip",
  categories: ["automation", "ui"],
  capabilities: [
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
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  database: {
    namespaceSlug: "triage",
    migrationsDir: "migrations",
    coreReadTables: ["companies", "issues"],
  },
  apiRoutes: [
    {
      routeKey: "items.ingest",
      method: "POST",
      path: "/queues/:queueKey/items",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" },
    },
  ],
  agents: [
    {
      agentKey: TRIAGE_ASSISTANT_AGENT_KEY,
      displayName: "Triage Assistant",
      role: "triage-assistant",
      title: "Triage Assistant",
      icon: "inbox",
      capabilities: "Helps process queue items, apply queue guidance, propose guidance updates, and prepare Paperclip work issue handoffs.",
      adapterType: "claude_local",
      adapterPreference: ["claude_local", "codex_local", "gemini_local", "opencode_local", "cursor", "pi_local"],
      adapterConfig: {
        dangerouslySkipPermissions: false,
        dangerouslyBypassApprovalsAndSandbox: false,
        sandbox: true,
        paperclipSkillSync: {
          desiredSkills: TRIAGE_MANAGED_SKILL_CANONICAL_KEYS,
        },
      },
      runtimeConfig: {
        modelProfiles: {
          cheap: {
            purpose: "queue classification, transition suggestions, and reflection draft review",
          },
        },
      },
      permissions: {
        pluginTools: [PLUGIN_ID],
      },
      status: "paused",
      budgetMonthlyCents: 0,
      instructions: {
        entryFile: "AGENTS.md",
        content: [
          "# Triage Assistant",
          "",
          "You are the managed assistant for Paperclip Triage queues.",
          "",
          "Work inside the active company only. Use queue guidance, current item content, item properties, and workflow state as your source of truth.",
          "",
          "Do not build source connectors or call upstream systems. Do not apply guidance changes without explicit user acceptance. Downstream actions are limited to Paperclip issue create-or-update templates.",
        ].join("\n"),
      },
    },
  ],
  projects: [
    {
      projectKey: TRIAGE_PROJECT_KEY,
      displayName: "Triage",
      description: "Plugin-managed project for Paperclip Triage assistant work, queue chat issues, and generated work issue defaults.",
      status: "in_progress",
      color: "#0f766e",
      settings: {
        defaultWorkflow: "new -> approved/rejected -> done",
      },
    },
  ],
  skills: [
    {
      skillKey: TRIAGE_ASSISTANT_SKILL_KEY,
      displayName: "Triage Assistant",
      slug: TRIAGE_ASSISTANT_SKILL_KEY,
      description: "Process queue items with user-visible guidance and company-scoped queue context.",
      markdown: skillMarkdown(TRIAGE_ASSISTANT_SKILL_KEY),
    },
    {
      skillKey: TRIAGE_REFLECTION_SKILL_KEY,
      displayName: "Triage Reflection",
      slug: TRIAGE_REFLECTION_SKILL_KEY,
      description: "Propose queue guidance updates after item processing without applying them automatically.",
      markdown: skillMarkdown(TRIAGE_REFLECTION_SKILL_KEY),
    },
    {
      skillKey: TRIAGE_WORKFLOW_SKILL_KEY,
      displayName: "Triage Workflow",
      slug: TRIAGE_WORKFLOW_SKILL_KEY,
      description: "Reason about queue states, reflection gates, and create-or-update issue actions.",
      markdown: skillMarkdown(TRIAGE_WORKFLOW_SKILL_KEY),
    },
  ],
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "triage-sidebar",
        displayName: "Triage",
        exportName: "SidebarLink",
        order: 38,
      },
      {
        type: "page",
        id: "triage-page",
        displayName: "Triage",
        exportName: "TriagePage",
        routePath: "triage",
      },
      {
        type: "routeSidebar",
        id: "triage-route-sidebar",
        displayName: "Triage",
        exportName: "TriageRouteSidebar",
        routePath: "triage",
      },
      {
        type: "settingsPage",
        id: "triage-settings",
        displayName: "Triage",
        exportName: "SettingsPage",
      },
    ],
  },
};

export default manifest;
