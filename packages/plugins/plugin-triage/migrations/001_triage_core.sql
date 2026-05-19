CREATE TABLE plugin_triage_f3b4aa721e.triage_queues (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_key text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  default_state_key text NOT NULL DEFAULT 'draft',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_item_count integer NOT NULL DEFAULT 0,
  archived_item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, queue_key)
);

CREATE INDEX triage_queues_company_status_idx
  ON plugin_triage_f3b4aa721e.triage_queues (company_id, status, updated_at DESC);

CREATE TABLE plugin_triage_f3b4aa721e.triage_queue_states (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  state_key text NOT NULL,
  display_name text NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, state_key)
);

CREATE INDEX triage_queue_states_company_queue_idx
  ON plugin_triage_f3b4aa721e.triage_queue_states (company_id, queue_id, sort_order);

CREATE TABLE plugin_triage_f3b4aa721e.triage_queue_transitions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  from_state_key text NOT NULL,
  to_state_key text NOT NULL,
  label text NOT NULL,
  requires_reflection boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, from_state_key, to_state_key)
);

CREATE INDEX triage_queue_transitions_company_queue_idx
  ON plugin_triage_f3b4aa721e.triage_queue_transitions (company_id, queue_id, from_state_key);

CREATE TABLE plugin_triage_f3b4aa721e.triage_queue_chats (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  hidden_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  title text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX triage_queue_chats_company_queue_idx
  ON plugin_triage_f3b4aa721e.triage_queue_chats (company_id, queue_id, updated_at DESC);

CREATE TABLE plugin_triage_f3b4aa721e.triage_items (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  item_key text,
  idempotency_key text,
  title text NOT NULL,
  content_format text NOT NULL DEFAULT 'markdown',
  content text NOT NULL DEFAULT '',
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_key text NOT NULL DEFAULT 'draft',
  status text NOT NULL DEFAULT 'active',
  linked_queue_chat_id uuid REFERENCES plugin_triage_f3b4aa721e.triage_queue_chats(id) ON DELETE SET NULL,
  linked_work_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 1,
  last_ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX triage_items_company_queue_state_idx
  ON plugin_triage_f3b4aa721e.triage_items (company_id, queue_id, state_key, updated_at DESC);

CREATE UNIQUE INDEX triage_items_queue_item_key_idx
  ON plugin_triage_f3b4aa721e.triage_items (queue_id, item_key)
  WHERE item_key IS NOT NULL;

CREATE UNIQUE INDEX triage_items_queue_idempotency_key_idx
  ON plugin_triage_f3b4aa721e.triage_items (queue_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE plugin_triage_f3b4aa721e.triage_guidance_docs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  path text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_revision_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, path)
);

CREATE INDEX triage_guidance_docs_company_queue_idx
  ON plugin_triage_f3b4aa721e.triage_guidance_docs (company_id, queue_id, path);

CREATE TABLE plugin_triage_f3b4aa721e.triage_guidance_doc_revisions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  doc_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_guidance_docs(id) ON DELETE CASCADE,
  content text NOT NULL,
  content_hash text,
  summary text,
  actor_type text,
  actor_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX triage_guidance_revisions_doc_idx
  ON plugin_triage_f3b4aa721e.triage_guidance_doc_revisions (company_id, doc_id, created_at DESC);

CREATE TABLE plugin_triage_f3b4aa721e.triage_guidance_proposals (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  item_id uuid REFERENCES plugin_triage_f3b4aa721e.triage_items(id) ON DELETE SET NULL,
  target_doc_id uuid REFERENCES plugin_triage_f3b4aa721e.triage_guidance_docs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'proposed',
  proposed_content text NOT NULL,
  rationale text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX triage_guidance_proposals_company_queue_idx
  ON plugin_triage_f3b4aa721e.triage_guidance_proposals (company_id, queue_id, status, updated_at DESC);

CREATE TABLE plugin_triage_f3b4aa721e.triage_item_events (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  item_id uuid REFERENCES plugin_triage_f3b4aa721e.triage_items(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_state_key text,
  to_state_key text,
  actor_type text,
  actor_id text,
  actor_run_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX triage_item_events_company_item_idx
  ON plugin_triage_f3b4aa721e.triage_item_events (company_id, item_id, created_at DESC);

CREATE TABLE plugin_triage_f3b4aa721e.triage_transition_actions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES plugin_triage_f3b4aa721e.triage_queues(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  from_state_key text NOT NULL,
  to_state_key text NOT NULL,
  action_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  template jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue_id, action_key)
);

CREATE INDEX triage_transition_actions_company_queue_idx
  ON plugin_triage_f3b4aa721e.triage_transition_actions (company_id, queue_id, from_state_key, to_state_key);
