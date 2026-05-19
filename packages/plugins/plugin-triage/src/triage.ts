import { createHash, randomUUID } from "node:crypto";
import type { PluginContext } from "@paperclipai/plugin-sdk";

export type TriageQueueStatus = "active" | "archived";
export type TriageItemStatus = "active" | "archived";

export interface TriageQueue {
  id: string;
  companyId: string;
  queueKey: string;
  title: string;
  description: string | null;
  status: TriageQueueStatus;
  defaultStateKey: string;
  activeItemCount: number;
  archivedItemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TriageItem {
  id: string;
  companyId: string;
  queueId: string;
  itemKey: string | null;
  idempotencyKey: string | null;
  title: string;
  contentFormat: string;
  content: string;
  properties: Record<string, unknown>;
  stateKey: string;
  status: TriageItemStatus;
  linkedQueueChatId: string | null;
  linkedWorkIssueId: string | null;
  revision: number;
  lastIngestedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TriageItemEvent {
  id: string;
  companyId: string;
  queueId: string;
  itemId: string | null;
  eventType: string;
  fromStateKey: string | null;
  toStateKey: string | null;
  actorType: string | null;
  actorId: string | null;
  actorRunId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TriageActor {
  actorType?: string | null;
  actorId?: string | null;
  actorRunId?: string | null;
}

export interface IngestItemInput {
  companyId: string;
  queueKey: string;
  title?: string | null;
  contentFormat?: string | null;
  content?: string | null;
  properties?: Record<string, unknown> | null;
  itemKey?: string | null;
  idempotencyKey?: string | null;
  requireExistingQueue?: boolean;
  initialStateKey?: string | null;
}

export interface IngestItemResult {
  queue: TriageQueue;
  item: TriageItem;
  event: TriageItemEvent;
  createdQueue: boolean;
  createdItem: boolean;
  upserted: boolean;
}

export class TriageError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TriageError";
  }
}

export interface TriageStore {
  listQueues(companyId: string): Promise<TriageQueue[]>;
  getQueue(companyId: string, queueKey: string): Promise<TriageQueue | null>;
  createQueue(input: {
    companyId: string;
    queueKey: string;
    title: string;
    description?: string | null;
  }): Promise<{ queue: TriageQueue; created: boolean }>;
  ensureQueueDefaults(queue: TriageQueue): Promise<void>;
  updateQueue(input: {
    companyId: string;
    queueKey: string;
    title?: string | null;
    description?: string | null;
    status?: TriageQueueStatus;
  }): Promise<TriageQueue>;
  archiveQueue(companyId: string, queueKey: string): Promise<TriageQueue>;
  listItems(companyId: string, queueKey: string): Promise<TriageItem[]>;
  getItem(companyId: string, itemId: string): Promise<TriageItem | null>;
  findItemsByKeys(input: {
    companyId: string;
    queueId: string;
    itemKey?: string | null;
    idempotencyKey?: string | null;
  }): Promise<TriageItem[]>;
  insertItem(input: {
    companyId: string;
    queueId: string;
    itemKey?: string | null;
    idempotencyKey?: string | null;
    title: string;
    contentFormat: string;
    content: string;
    properties: Record<string, unknown>;
    stateKey: string;
  }): Promise<TriageItem>;
  updateItem(input: {
    companyId: string;
    itemId: string;
    itemKey?: string | null;
    idempotencyKey?: string | null;
    title?: string | null;
    contentFormat?: string | null;
    content?: string | null;
    properties?: Record<string, unknown> | null;
    stateKey?: string | null;
    status?: TriageItemStatus;
  }): Promise<TriageItem>;
  archiveItem(companyId: string, itemId: string): Promise<TriageItem>;
  recordItemEvent(input: {
    companyId: string;
    queueId: string;
    itemId: string | null;
    eventType: string;
    fromStateKey?: string | null;
    toStateKey?: string | null;
    actor?: TriageActor;
    metadata?: Record<string, unknown>;
  }): Promise<TriageItemEvent>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return nowIso();
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function objectField(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeQueueKey(value: unknown): string {
  const queueKey = stringField(value);
  if (!queueKey) {
    throw new TriageError(400, "queue_key_required", "queueKey is required");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(queueKey)) {
    throw new TriageError(
      422,
      "invalid_queue_key",
      "queueKey must start with a letter or number and may contain letters, numbers, dot, underscore, colon, or hyphen",
    );
  }
  return queueKey;
}

function requireCompanyId(value: unknown): string {
  const companyId = stringField(value);
  if (!companyId) throw new TriageError(400, "company_id_required", "companyId is required");
  return companyId;
}

function defaultQueueTitle(queueKey: string): string {
  const words = queueKey.replace(/[._:-]+/g, " ").trim();
  if (!words) return "Queue";
  return words.replace(/\b\w/g, (char) => char.toUpperCase());
}

function sanitizeContentFormat(value: unknown): string {
  const contentFormat = stringField(value) ?? "markdown";
  if (!/^[A-Za-z0-9._+-]{1,40}$/.test(contentFormat)) {
    throw new TriageError(422, "invalid_content_format", "contentFormat is invalid");
  }
  return contentFormat;
}

function table(namespace: string, name: string): string {
  return `${namespace}.${name}`;
}

function queueFromRow(row: Record<string, unknown>): TriageQueue {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    queueKey: String(row.queue_key),
    title: String(row.title),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    status: row.status === "archived" ? "archived" : "active",
    defaultStateKey: String(row.default_state_key ?? "draft"),
    activeItemCount: Number(row.active_item_count ?? 0),
    archivedItemCount: Number(row.archived_item_count ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function itemFromRow(row: Record<string, unknown>): TriageItem {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    queueId: String(row.queue_id),
    itemKey: row.item_key === null || row.item_key === undefined ? null : String(row.item_key),
    idempotencyKey: row.idempotency_key === null || row.idempotency_key === undefined
      ? null
      : String(row.idempotency_key),
    title: String(row.title),
    contentFormat: String(row.content_format ?? "markdown"),
    content: String(row.content ?? ""),
    properties: objectField(row.properties),
    stateKey: String(row.state_key ?? "draft"),
    status: row.status === "archived" ? "archived" : "active",
    linkedQueueChatId: row.linked_queue_chat_id === null || row.linked_queue_chat_id === undefined
      ? null
      : String(row.linked_queue_chat_id),
    linkedWorkIssueId: row.linked_work_issue_id === null || row.linked_work_issue_id === undefined
      ? null
      : String(row.linked_work_issue_id),
    revision: Number(row.revision ?? 1),
    lastIngestedAt: toIso(row.last_ingested_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function eventFromRow(row: Record<string, unknown>): TriageItemEvent {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    queueId: String(row.queue_id),
    itemId: row.item_id === null || row.item_id === undefined ? null : String(row.item_id),
    eventType: String(row.event_type),
    fromStateKey: row.from_state_key === null || row.from_state_key === undefined ? null : String(row.from_state_key),
    toStateKey: row.to_state_key === null || row.to_state_key === undefined ? null : String(row.to_state_key),
    actorType: row.actor_type === null || row.actor_type === undefined ? null : String(row.actor_type),
    actorId: row.actor_id === null || row.actor_id === undefined ? null : String(row.actor_id),
    actorRunId: row.actor_run_id === null || row.actor_run_id === undefined ? null : String(row.actor_run_id),
    metadata: objectField(row.metadata),
    createdAt: toIso(row.created_at),
  };
}

export function createPostgresTriageStore(ctx: Pick<PluginContext, "db">): TriageStore {
  const namespace = ctx.db.namespace;
  const queues = table(namespace, "triage_queues");
  const states = table(namespace, "triage_queue_states");
  const transitions = table(namespace, "triage_queue_transitions");
  const docs = table(namespace, "triage_guidance_docs");
  const revisions = table(namespace, "triage_guidance_doc_revisions");
  const items = table(namespace, "triage_items");
  const events = table(namespace, "triage_item_events");

  async function getQueueById(companyId: string, queueId: string): Promise<TriageQueue | null> {
    const rows = await ctx.db.query<Record<string, unknown>>(
      `SELECT * FROM ${queues} WHERE company_id = $1 AND id = $2 LIMIT 1`,
      [companyId, queueId],
    );
    return rows[0] ? queueFromRow(rows[0]) : null;
  }

  async function recalculateQueueCounts(companyId: string, queueId: string): Promise<void> {
    await ctx.db.execute(
      `UPDATE ${queues}
       SET active_item_count = (
         SELECT count(*)::int FROM ${items}
         WHERE company_id = $1 AND queue_id = $2 AND status = 'active'
       ),
       archived_item_count = (
         SELECT count(*)::int FROM ${items}
         WHERE company_id = $1 AND queue_id = $2 AND status = 'archived'
       ),
       updated_at = now()
       WHERE company_id = $1 AND id = $2`,
      [companyId, queueId],
    );
  }

  async function getItemById(companyId: string, itemId: string): Promise<TriageItem | null> {
    const rows = await ctx.db.query<Record<string, unknown>>(
      `SELECT * FROM ${items} WHERE company_id = $1 AND id = $2 LIMIT 1`,
      [companyId, itemId],
    );
    return rows[0] ? itemFromRow(rows[0]) : null;
  }

  return {
    async listQueues(companyId) {
      const rows = await ctx.db.query<Record<string, unknown>>(
        `SELECT * FROM ${queues} WHERE company_id = $1 ORDER BY updated_at DESC`,
        [companyId],
      );
      return rows.map(queueFromRow);
    },

    async getQueue(companyId, queueKey) {
      const rows = await ctx.db.query<Record<string, unknown>>(
        `SELECT * FROM ${queues} WHERE company_id = $1 AND queue_key = $2 LIMIT 1`,
        [companyId, queueKey],
      );
      return rows[0] ? queueFromRow(rows[0]) : null;
    },

    async createQueue(input) {
      const id = randomUUID();
      await ctx.db.execute(
        `INSERT INTO ${queues} (id, company_id, queue_key, title, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (company_id, queue_key) DO NOTHING`,
        [id, input.companyId, input.queueKey, input.title, input.description ?? null],
      );
      const queue = await this.getQueue(input.companyId, input.queueKey);
      if (!queue) throw new TriageError(500, "queue_create_failed", "Queue was not created");
      return { queue, created: queue.id === id };
    },

    async ensureQueueDefaults(queue) {
      const defaultStates = [
        ["draft", "Draft", false, "active", 10],
        ["approved", "Approved", false, "active", 20],
        ["rejected", "Rejected", false, "active", 30],
        ["done", "Done", true, "archived", 40],
      ] as const;
      for (const [stateKey, displayName, terminal, visibility, sortOrder] of defaultStates) {
        await ctx.db.execute(
          `INSERT INTO ${states}
             (id, company_id, queue_id, state_key, display_name, is_terminal, visibility, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (queue_id, state_key) DO NOTHING`,
          [randomUUID(), queue.companyId, queue.id, stateKey, displayName, terminal, visibility, sortOrder],
        );
      }

      const defaultTransitions = [
        ["draft", "approved", "Approve"],
        ["draft", "rejected", "Reject"],
        ["approved", "done", "Mark Done"],
        ["rejected", "done", "Mark Done"],
      ] as const;
      for (const [fromState, toState, label] of defaultTransitions) {
        await ctx.db.execute(
          `INSERT INTO ${transitions}
             (id, company_id, queue_id, from_state_key, to_state_key, label)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (queue_id, from_state_key, to_state_key) DO NOTHING`,
          [randomUUID(), queue.companyId, queue.id, fromState, toState, label],
        );
      }

      const existingDocs = await ctx.db.query<Record<string, unknown>>(
        `SELECT id FROM ${docs} WHERE company_id = $1 AND queue_id = $2 AND path = 'guidance.md' LIMIT 1`,
        [queue.companyId, queue.id],
      );
      if (existingDocs[0]) return;

      const docId = randomUUID();
      const revisionId = randomUUID();
      const content = `# ${queue.title} Guidance\n\nCapture queue-specific policy, taste, examples, and handling rules here.\n`;
      await ctx.db.execute(
        `INSERT INTO ${docs}
           (id, company_id, queue_id, path, title, current_revision_id)
         VALUES ($1, $2, $3, 'guidance.md', 'Guidance', $4)
         ON CONFLICT (queue_id, path) DO NOTHING`,
        [docId, queue.companyId, queue.id, revisionId],
      );
      const docRows = await ctx.db.query<Record<string, unknown>>(
        `SELECT id FROM ${docs} WHERE company_id = $1 AND queue_id = $2 AND path = 'guidance.md' LIMIT 1`,
        [queue.companyId, queue.id],
      );
      if (String(docRows[0]?.id ?? "") !== docId) return;
      await ctx.db.execute(
        `INSERT INTO ${revisions}
           (id, company_id, queue_id, doc_id, content, content_hash, summary)
         VALUES ($1, $2, $3, $4, $5, $6, 'Initial guidance document')
         ON CONFLICT DO NOTHING`,
        [revisionId, queue.companyId, queue.id, docId, content, createHash("sha256").update(content).digest("hex")],
      );
    },

    async updateQueue(input) {
      await ctx.db.execute(
        `UPDATE ${queues}
         SET title = COALESCE($3, title),
             description = COALESCE($4, description),
             status = COALESCE($5, status),
             updated_at = now()
         WHERE company_id = $1 AND queue_key = $2`,
        [input.companyId, input.queueKey, input.title ?? null, input.description ?? null, input.status ?? null],
      );
      const queue = await this.getQueue(input.companyId, input.queueKey);
      if (!queue) throw new TriageError(404, "queue_not_found", "Queue not found");
      return queue;
    },

    async archiveQueue(companyId, queueKey) {
      return this.updateQueue({ companyId, queueKey, status: "archived" });
    },

    async listItems(companyId, queueKey) {
      const queue = await this.getQueue(companyId, queueKey);
      if (!queue) throw new TriageError(404, "queue_not_found", "Queue not found");
      const rows = await ctx.db.query<Record<string, unknown>>(
        `SELECT * FROM ${items} WHERE company_id = $1 AND queue_id = $2 ORDER BY updated_at DESC`,
        [companyId, queue.id],
      );
      return rows.map(itemFromRow);
    },

    async getItem(companyId, itemId) {
      return getItemById(companyId, itemId);
    },

    async findItemsByKeys(input) {
      if (!input.itemKey && !input.idempotencyKey) return [];
      const rows = await ctx.db.query<Record<string, unknown>>(
        `SELECT * FROM ${items}
         WHERE company_id = $1
           AND queue_id = $2
           AND (
             ($3::text IS NOT NULL AND item_key = $3)
             OR ($4::text IS NOT NULL AND idempotency_key = $4)
           )
         LIMIT 2`,
        [input.companyId, input.queueId, input.itemKey ?? null, input.idempotencyKey ?? null],
      );
      return rows.map(itemFromRow);
    },

    async insertItem(input) {
      const id = randomUUID();
      await ctx.db.execute(
        `INSERT INTO ${items}
           (id, company_id, queue_id, item_key, idempotency_key, title, content_format, content, properties, state_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [
          id,
          input.companyId,
          input.queueId,
          input.itemKey ?? null,
          input.idempotencyKey ?? null,
          input.title,
          input.contentFormat,
          input.content,
          JSON.stringify(input.properties),
          input.stateKey,
        ],
      );
      await recalculateQueueCounts(input.companyId, input.queueId);
      const item = await getItemById(input.companyId, id);
      if (!item) throw new TriageError(500, "item_create_failed", "Item was not created");
      return item;
    },

    async updateItem(input) {
      await ctx.db.execute(
        `UPDATE ${items}
         SET item_key = COALESCE($3, item_key),
             idempotency_key = COALESCE($4, idempotency_key),
             title = COALESCE($5, title),
             content_format = COALESCE($6, content_format),
             content = COALESCE($7, content),
             properties = COALESCE($8::jsonb, properties),
             state_key = COALESCE($9, state_key),
             status = COALESCE($10, status),
             revision = revision + 1,
             last_ingested_at = now(),
             updated_at = now()
         WHERE company_id = $1 AND id = $2`,
        [
          input.companyId,
          input.itemId,
          input.itemKey ?? null,
          input.idempotencyKey ?? null,
          input.title ?? null,
          input.contentFormat ?? null,
          input.content ?? null,
          input.properties === undefined || input.properties === null ? null : JSON.stringify(input.properties),
          input.stateKey ?? null,
          input.status ?? null,
        ],
      );
      const item = await getItemById(input.companyId, input.itemId);
      if (!item) throw new TriageError(404, "item_not_found", "Item not found");
      await recalculateQueueCounts(input.companyId, item.queueId);
      return item;
    },

    async archiveItem(companyId, itemId) {
      return this.updateItem({ companyId, itemId, status: "archived" });
    },

    async recordItemEvent(input) {
      const id = randomUUID();
      await ctx.db.execute(
        `INSERT INTO ${events}
           (id, company_id, queue_id, item_id, event_type, from_state_key, to_state_key,
            actor_type, actor_id, actor_run_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [
          id,
          input.companyId,
          input.queueId,
          input.itemId,
          input.eventType,
          input.fromStateKey ?? null,
          input.toStateKey ?? null,
          input.actor?.actorType ?? null,
          input.actor?.actorId ?? null,
          input.actor?.actorRunId ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      const rows = await ctx.db.query<Record<string, unknown>>(
        `SELECT * FROM ${events} WHERE company_id = $1 AND id = $2 LIMIT 1`,
        [input.companyId, id],
      );
      if (rows[0]) return eventFromRow(rows[0]);
      return {
        id,
        companyId: input.companyId,
        queueId: input.queueId,
        itemId: input.itemId,
        eventType: input.eventType,
        fromStateKey: input.fromStateKey ?? null,
        toStateKey: input.toStateKey ?? null,
        actorType: input.actor?.actorType ?? null,
        actorId: input.actor?.actorId ?? null,
        actorRunId: input.actor?.actorRunId ?? null,
        metadata: input.metadata ?? {},
        createdAt: nowIso(),
      };
    },
  };
}

export function createInMemoryTriageStore(): TriageStore {
  const queues = new Map<string, TriageQueue>();
  const items = new Map<string, TriageItem>();
  const events = new Map<string, TriageItemEvent>();
  const defaultedQueues = new Set<string>();

  function queueIndex(companyId: string, queueKey: string): string {
    return `${companyId}:${queueKey}`;
  }

  function cloneQueue(queue: TriageQueue): TriageQueue {
    return { ...queue };
  }

  function cloneItem(item: TriageItem): TriageItem {
    return { ...item, properties: { ...item.properties } };
  }

  function recalculateCounts(queueId: string): void {
    const queue = [...queues.values()].find((candidate) => candidate.id === queueId);
    if (!queue) return;
    const queueItems = [...items.values()].filter((item) => item.queueId === queueId);
    queue.activeItemCount = queueItems.filter((item) => item.status === "active").length;
    queue.archivedItemCount = queueItems.filter((item) => item.status === "archived").length;
    queue.updatedAt = nowIso();
  }

  return {
    async listQueues(companyId) {
      return [...queues.values()]
        .filter((queue) => queue.companyId === companyId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(cloneQueue);
    },

    async getQueue(companyId, queueKey) {
      const queue = queues.get(queueIndex(companyId, queueKey));
      return queue ? cloneQueue(queue) : null;
    },

    async createQueue(input) {
      const index = queueIndex(input.companyId, input.queueKey);
      const existing = queues.get(index);
      if (existing) return { queue: cloneQueue(existing), created: false };
      const timestamp = nowIso();
      const queue: TriageQueue = {
        id: randomUUID(),
        companyId: input.companyId,
        queueKey: input.queueKey,
        title: input.title,
        description: input.description ?? null,
        status: "active",
        defaultStateKey: "draft",
        activeItemCount: 0,
        archivedItemCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      queues.set(index, queue);
      return { queue: cloneQueue(queue), created: true };
    },

    async ensureQueueDefaults(queue) {
      defaultedQueues.add(queue.id);
    },

    async updateQueue(input) {
      const index = queueIndex(input.companyId, input.queueKey);
      const queue = queues.get(index);
      if (!queue) throw new TriageError(404, "queue_not_found", "Queue not found");
      if (input.title !== undefined && input.title !== null) queue.title = input.title;
      if (input.description !== undefined) queue.description = input.description;
      if (input.status) queue.status = input.status;
      queue.updatedAt = nowIso();
      return cloneQueue(queue);
    },

    async archiveQueue(companyId, queueKey) {
      return this.updateQueue({ companyId, queueKey, status: "archived" });
    },

    async listItems(companyId, queueKey) {
      const queue = queues.get(queueIndex(companyId, queueKey));
      if (!queue) throw new TriageError(404, "queue_not_found", "Queue not found");
      return [...items.values()]
        .filter((item) => item.companyId === companyId && item.queueId === queue.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(cloneItem);
    },

    async getItem(companyId, itemId) {
      const item = items.get(itemId);
      return item && item.companyId === companyId ? cloneItem(item) : null;
    },

    async findItemsByKeys(input) {
      if (!input.itemKey && !input.idempotencyKey) return [];
      return [...items.values()]
        .filter((item) => item.companyId === input.companyId && item.queueId === input.queueId)
        .filter((item) =>
          (input.itemKey ? item.itemKey === input.itemKey : false)
          || (input.idempotencyKey ? item.idempotencyKey === input.idempotencyKey : false))
        .slice(0, 2)
        .map(cloneItem);
    },

    async insertItem(input) {
      const timestamp = nowIso();
      const item: TriageItem = {
        id: randomUUID(),
        companyId: input.companyId,
        queueId: input.queueId,
        itemKey: input.itemKey ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        title: input.title,
        contentFormat: input.contentFormat,
        content: input.content,
        properties: { ...input.properties },
        stateKey: input.stateKey,
        status: "active",
        linkedQueueChatId: null,
        linkedWorkIssueId: null,
        revision: 1,
        lastIngestedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      items.set(item.id, item);
      recalculateCounts(item.queueId);
      return cloneItem(item);
    },

    async updateItem(input) {
      const item = items.get(input.itemId);
      if (!item || item.companyId !== input.companyId) {
        throw new TriageError(404, "item_not_found", "Item not found");
      }
      const conflicting = [...items.values()].find((candidate) =>
        candidate.id !== item.id
        && candidate.queueId === item.queueId
        && (
          (input.itemKey ? candidate.itemKey === input.itemKey : false)
          || (input.idempotencyKey ? candidate.idempotencyKey === input.idempotencyKey : false)
        ));
      if (conflicting) {
        throw new TriageError(409, "item_key_conflict", "itemKey or idempotencyKey matches a different queue item");
      }
      if (input.itemKey !== undefined && input.itemKey !== null) item.itemKey = input.itemKey;
      if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
        item.idempotencyKey = input.idempotencyKey;
      }
      if (input.title !== undefined && input.title !== null) item.title = input.title;
      if (input.contentFormat !== undefined && input.contentFormat !== null) item.contentFormat = input.contentFormat;
      if (input.content !== undefined && input.content !== null) item.content = input.content;
      if (input.properties !== undefined && input.properties !== null) item.properties = { ...input.properties };
      if (input.stateKey !== undefined && input.stateKey !== null) item.stateKey = input.stateKey;
      if (input.status) item.status = input.status;
      item.revision += 1;
      item.lastIngestedAt = nowIso();
      item.updatedAt = item.lastIngestedAt;
      recalculateCounts(item.queueId);
      return cloneItem(item);
    },

    async archiveItem(companyId, itemId) {
      return this.updateItem({ companyId, itemId, status: "archived" });
    },

    async recordItemEvent(input) {
      const event: TriageItemEvent = {
        id: randomUUID(),
        companyId: input.companyId,
        queueId: input.queueId,
        itemId: input.itemId,
        eventType: input.eventType,
        fromStateKey: input.fromStateKey ?? null,
        toStateKey: input.toStateKey ?? null,
        actorType: input.actor?.actorType ?? null,
        actorId: input.actor?.actorId ?? null,
        actorRunId: input.actor?.actorRunId ?? null,
        metadata: input.metadata ?? {},
        createdAt: nowIso(),
      };
      events.set(event.id, event);
      return { ...event, metadata: { ...event.metadata } };
    },
  };
}

export function createTriageService(store: TriageStore) {
  return {
    async listQueues(params: Record<string, unknown>) {
      return store.listQueues(requireCompanyId(params.companyId));
    },

    async getQueue(params: Record<string, unknown>) {
      const companyId = requireCompanyId(params.companyId);
      const queueKey = normalizeQueueKey(params.queueKey);
      const queue = await store.getQueue(companyId, queueKey);
      if (!queue) throw new TriageError(404, "queue_not_found", "Queue not found");
      return queue;
    },

    async createQueue(params: Record<string, unknown>) {
      const companyId = requireCompanyId(params.companyId);
      const queueKey = normalizeQueueKey(params.queueKey);
      const title = stringField(params.title) ?? defaultQueueTitle(queueKey);
      const result = await store.createQueue({
        companyId,
        queueKey,
        title,
        description: stringField(params.description),
      });
      await store.ensureQueueDefaults(result.queue);
      return result;
    },

    async updateQueue(params: Record<string, unknown>) {
      const companyId = requireCompanyId(params.companyId);
      const status = params.status === "archived" || params.status === "active"
        ? params.status
        : undefined;
      return store.updateQueue({
        companyId,
        queueKey: normalizeQueueKey(params.queueKey),
        title: stringField(params.title),
        description: params.description === null ? null : stringField(params.description),
        status,
      });
    },

    async archiveQueue(params: Record<string, unknown>) {
      return store.archiveQueue(requireCompanyId(params.companyId), normalizeQueueKey(params.queueKey));
    },

    async listItems(params: Record<string, unknown>) {
      return store.listItems(requireCompanyId(params.companyId), normalizeQueueKey(params.queueKey));
    },

    async getItem(params: Record<string, unknown>) {
      const itemId = stringField(params.itemId);
      if (!itemId) throw new TriageError(400, "item_id_required", "itemId is required");
      const item = await store.getItem(requireCompanyId(params.companyId), itemId);
      if (!item) throw new TriageError(404, "item_not_found", "Item not found");
      return item;
    },

    async ingestItem(params: Record<string, unknown>, actor: TriageActor = {}): Promise<IngestItemResult> {
      const input = parseIngestInput(params);
      let queue = await store.getQueue(input.companyId, input.queueKey);
      let createdQueue = false;

      if (!queue) {
        if (input.requireExistingQueue) {
          throw new TriageError(404, "queue_not_found", "Queue not found", { queueKey: input.queueKey });
        }
        const created = await store.createQueue({
          companyId: input.companyId,
          queueKey: input.queueKey,
          title: defaultQueueTitle(input.queueKey),
        });
        queue = created.queue;
        createdQueue = created.created;
      }
      await store.ensureQueueDefaults(queue);

      const matches = await store.findItemsByKeys({
        companyId: input.companyId,
        queueId: queue.id,
        itemKey: input.itemKey,
        idempotencyKey: input.idempotencyKey,
      });
      if (matches.length > 1) {
        throw new TriageError(
          409,
          "ambiguous_item_key",
          "itemKey and idempotencyKey match different queue items",
        );
      }

      const existing = matches[0] ?? null;
      const stateKey = input.initialStateKey ?? existing?.stateKey ?? queue.defaultStateKey;
      const item = existing
        ? await store.updateItem({
          companyId: input.companyId,
          itemId: existing.id,
          itemKey: input.itemKey,
          idempotencyKey: input.idempotencyKey,
          title: input.title,
          contentFormat: input.contentFormat,
          content: input.content,
          properties: input.properties,
          stateKey,
          status: "active",
        })
        : await store.insertItem({
          companyId: input.companyId,
          queueId: queue.id,
          itemKey: input.itemKey,
          idempotencyKey: input.idempotencyKey,
          title: input.title ?? "Untitled item",
          contentFormat: input.contentFormat ?? "markdown",
          content: input.content ?? "",
          properties: input.properties ?? {},
          stateKey,
        });

      const event = await store.recordItemEvent({
        companyId: input.companyId,
        queueId: queue.id,
        itemId: item.id,
        eventType: existing ? "item.ingested.updated" : "item.ingested.created",
        fromStateKey: existing?.stateKey ?? null,
        toStateKey: item.stateKey,
        actor,
        metadata: {
          itemKey: input.itemKey,
          idempotencyKey: input.idempotencyKey,
          createdQueue,
        },
      });

      const refreshedQueue = await store.getQueue(input.companyId, input.queueKey) ?? queue;
      return {
        queue: refreshedQueue,
        item,
        event,
        createdQueue,
        createdItem: !existing,
        upserted: Boolean(existing),
      };
    },

    async updateItem(params: Record<string, unknown>) {
      const itemId = stringField(params.itemId);
      if (!itemId) throw new TriageError(400, "item_id_required", "itemId is required");
      return store.updateItem({
        companyId: requireCompanyId(params.companyId),
        itemId,
        itemKey: stringField(params.itemKey),
        idempotencyKey: stringField(params.idempotencyKey),
        title: stringField(params.title),
        contentFormat: params.contentFormat === undefined ? undefined : sanitizeContentFormat(params.contentFormat),
        content: typeof params.content === "string" ? params.content : undefined,
        properties: params.properties === undefined ? undefined : objectField(params.properties),
        stateKey: stringField(params.stateKey),
        status: params.status === "archived" || params.status === "active" ? params.status : undefined,
      });
    },

    async archiveItem(params: Record<string, unknown>) {
      const itemId = stringField(params.itemId);
      if (!itemId) throw new TriageError(400, "item_id_required", "itemId is required");
      return store.archiveItem(requireCompanyId(params.companyId), itemId);
    },
  };
}

export function parseIngestInput(params: Record<string, unknown>): IngestItemInput {
  return {
    companyId: requireCompanyId(params.companyId),
    queueKey: normalizeQueueKey(params.queueKey),
    title: stringField(params.title),
    contentFormat: params.contentFormat === undefined ? "markdown" : sanitizeContentFormat(params.contentFormat),
    content: typeof params.content === "string" ? params.content : "",
    properties: objectField(params.properties),
    itemKey: stringField(params.itemKey),
    idempotencyKey: stringField(params.idempotencyKey),
    requireExistingQueue: params.requireExistingQueue === true,
    initialStateKey: stringField(params.initialStateKey),
  };
}

export function formatTriageError(error: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (error instanceof TriageError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "triage_internal_error",
        message: error instanceof Error ? error.message : String(error),
      },
    },
  };
}
