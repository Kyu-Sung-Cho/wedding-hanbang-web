-- State-aware, pending-only disclosure ingestion. A logical batch is at most
-- 25 units and is applied by one PostgREST RPC transaction. Its ingestion
-- paths never approve a vendor/price/package or publish a snapshot.
-- A separate admin-confirmed RPC at the end may approve only independently
-- validated paid-pilot prices, and never exposes the private ingest journal to
-- browser roles.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE public.vendor_disclosure_ingest_runs (
  run_sha256 text PRIMARY KEY CHECK (run_sha256 ~ '^[0-9a-f]{64}$'),
  target_project_ref text NOT NULL CHECK (
    target_project_ref ~ '^[a-z0-9][a-z0-9-]{3,80}$'
  ),
  full_plan_sha256 text NOT NULL CHECK (full_plan_sha256 ~ '^[0-9a-f]{64}$'),
  authorization_kind text NOT NULL CHECK (
    authorization_kind IN ('paid_pilot_gate', 'local_validated_pending_only')
  ),
  authorization_sha256 text NOT NULL CHECK (authorization_sha256 ~ '^[0-9a-f]{64}$'),
  local_pending_only_unit_ids text[] NOT NULL DEFAULT '{}'::text[],
  snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id) ON DELETE RESTRICT,
  snapshot_source text NOT NULL,
  snapshot_period text NOT NULL,
  snapshot_created_by_run boolean NOT NULL DEFAULT false,
  supersedes_run_sha256 text UNIQUE REFERENCES public.vendor_disclosure_ingest_runs(run_sha256)
    ON DELETE RESTRICT,
  batch_count integer NOT NULL CHECK (batch_count > 0),
  completed_batch_count integer NOT NULL DEFAULT 0 CHECK (
    completed_batch_count >= 0 AND completed_batch_count <= batch_count
  ),
  dedupe_candidates_sha256 text CHECK (
    dedupe_candidates_sha256 IS NULL
    OR dedupe_candidates_sha256 ~ '^[0-9a-f]{64}$'
  ),
  dedupe_payload_sha256 text CHECK (
    dedupe_payload_sha256 IS NULL
    OR dedupe_payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'complete', 'invalidated', 'aborted')
  ),
  aborted_at timestamptz,
  abort_reason text,
  storage_rollback_receipt_sha256 text CHECK (
    storage_rollback_receipt_sha256 IS NULL
    OR storage_rollback_receipt_sha256 ~ '^[0-9a-f]{64}$'
  ),
  invalidated_at timestamptz,
  invalidation_reason text,
  invalidation_receipt_sha256 text CHECK (
    invalidation_receipt_sha256 IS NULL
    OR invalidation_receipt_sha256 ~ '^[0-9a-f]{64}$'
  ),
  dedupe_finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_disclosure_ingest_run_finalizer_check CHECK (
    (dedupe_finalized_at IS NULL AND dedupe_candidates_sha256 IS NULL AND dedupe_payload_sha256 IS NULL)
    OR
    (dedupe_finalized_at IS NOT NULL AND dedupe_candidates_sha256 IS NOT NULL AND dedupe_payload_sha256 IS NOT NULL)
  ),
  CONSTRAINT vendor_disclosure_ingest_run_abort_check CHECK (
    (status = 'aborted' AND aborted_at IS NOT NULL AND length(abort_reason) BETWEEN 1 AND 500
      AND storage_rollback_receipt_sha256 IS NOT NULL)
    OR (status <> 'aborted' AND aborted_at IS NULL AND abort_reason IS NULL
      AND storage_rollback_receipt_sha256 IS NULL)
  ),
  CONSTRAINT vendor_disclosure_ingest_run_invalidation_check CHECK (
    (status = 'invalidated' AND invalidated_at IS NOT NULL
      AND length(invalidation_reason) BETWEEN 1 AND 500
      AND invalidation_receipt_sha256 IS NOT NULL)
    OR (status <> 'invalidated' AND invalidated_at IS NULL
      AND invalidation_reason IS NULL AND invalidation_receipt_sha256 IS NULL)
  ),
  CONSTRAINT vendor_disclosure_ingest_run_local_authorization_check CHECK (
    (authorization_kind = 'local_validated_pending_only' AND cardinality(local_pending_only_unit_ids) > 0)
    OR (authorization_kind = 'paid_pilot_gate' AND cardinality(local_pending_only_unit_ids) = 0)
  ),
  CONSTRAINT vendor_disclosure_ingest_run_supersedes_check CHECK (
    supersedes_run_sha256 IS NULL OR supersedes_run_sha256 <> run_sha256
  )
);

-- Exactly one load may own the mutable draft surface for a snapshot. A
-- terminal run keeps its immutable audit trail, while a corrected successor
-- can reuse the same source/period snapshot only after invalidation cleanup.
CREATE UNIQUE INDEX vendor_disclosure_ingest_runs_one_live_snapshot_idx
  ON public.vendor_disclosure_ingest_runs (snapshot_id)
  WHERE status IN ('active', 'complete');

CREATE OR REPLACE FUNCTION public.vendor_disclosure_unit_ids_are_safe(
  p_unit_ids text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $vendor_disclosure_unit_ids_are_safe$
  SELECT COALESCE(
    cardinality(p_unit_ids) BETWEEN 1 AND 25
    AND cardinality(p_unit_ids) = cardinality(ARRAY(
      SELECT DISTINCT unit_id
      FROM unnest(p_unit_ids) AS source(unit_id)
    ))
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_unit_ids) AS source(unit_id)
      WHERE unit_id IS NULL OR unit_id !~ '^[0-9a-f]{64}$'
    ),
    false
  );
$vendor_disclosure_unit_ids_are_safe$;

CREATE TABLE public.vendor_disclosure_ingest_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index > 0),
  batch_sha256 text NOT NULL CHECK (batch_sha256 ~ '^[0-9a-f]{64}$'),
  batch_plan_sha256 text NOT NULL CHECK (batch_plan_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  batch_receipt_sha256 text NOT NULL CHECK (batch_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  unit_ids text[] NOT NULL CHECK (public.vendor_disclosure_unit_ids_are_safe(unit_ids)),
  staged_record_count integer NOT NULL CHECK (staged_record_count >= 0),
  needs_review_count integer NOT NULL CHECK (
    needs_review_count >= 0 AND needs_review_count <= staged_record_count
  ),
  logged_ledger_ids text[] NOT NULL DEFAULT '{}'::text[],
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_sha256, batch_index),
  UNIQUE (run_sha256, batch_sha256)
);

CREATE TABLE public.vendor_disclosure_ingest_identity_links (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  unit_id text NOT NULL CHECK (unit_id ~ '^[0-9a-f]{64}$'),
  identity_kind text NOT NULL CHECK (identity_kind IN ('vendor', 'agency')),
  record_ref text NOT NULL DEFAULT '',
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
  agency_id uuid REFERENCES public.agencies(id) ON DELETE RESTRICT,
  official_price_id uuid REFERENCES public.official_prices(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_sha256, unit_id, identity_kind, record_ref),
  CONSTRAINT vendor_disclosure_ingest_identity_shape CHECK (
    (
      identity_kind = 'vendor'
      AND vendor_id IS NOT NULL
      AND agency_id IS NULL
    ) OR (
      identity_kind = 'agency'
      AND vendor_id IS NULL
      AND agency_id IS NOT NULL
      AND official_price_id IS NULL
    )
  )
);

CREATE TABLE public.vendor_disclosure_ingest_owned_rows (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index > 0),
  unit_id text NOT NULL CHECK (unit_id ~ '^[0-9a-f]{64}$'),
  row_kind text NOT NULL CHECK (row_kind IN ('agency_package', 'official_price', 'semantic')),
  row_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_sha256, row_kind, row_id),
  FOREIGN KEY (run_sha256, batch_index)
    REFERENCES public.vendor_disclosure_ingest_batches(run_sha256, batch_index)
    DEFERRABLE INITIALLY DEFERRED
);

-- Immutable post-resolution binding for each flattened staging record. Paid
-- attestations intentionally do not depend on generated UUIDs; this table is
-- created by the postgres-owned stage transaction after identity resolution
-- and prevents later row/content reassignment across otherwise identical
-- records in the same unit.
CREATE TABLE public.vendor_disclosure_ingest_record_bindings (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index > 0),
  unit_id text NOT NULL CHECK (unit_id ~ '^[0-9a-f]{64}$'),
  row_kind text NOT NULL CHECK (row_kind IN ('agency_package', 'official_price', 'semantic')),
  row_id uuid NOT NULL,
  record_ref text NOT NULL CHECK (length(record_ref) BETWEEN 1 AND 500),
  -- Deliberately no FK: aborted runs retain the immutable audit binding after
  -- their owned draft rows/identities are removed.
  vendor_id uuid,
  agency_id uuid,
  linked_official_price_id uuid,
  binding_sha256 text NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_sha256, row_kind, row_id),
  FOREIGN KEY (run_sha256, batch_index)
    REFERENCES public.vendor_disclosure_ingest_batches(run_sha256, batch_index)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT vendor_disclosure_record_binding_shape CHECK (
    (
      row_kind = 'agency_package'
      AND vendor_id IS NULL
      AND agency_id IS NOT NULL
      AND linked_official_price_id IS NULL
    ) OR (
      row_kind = 'official_price'
      AND vendor_id IS NOT NULL
      AND linked_official_price_id IS NULL
    ) OR (
      row_kind = 'semantic'
      AND agency_id IS NULL
      AND (
        (vendor_id IS NULL AND linked_official_price_id IS NULL)
        OR vendor_id IS NOT NULL
      )
    )
  ),
  CONSTRAINT vendor_disclosure_record_binding_digest_check CHECK (
    binding_sha256 = encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', run_sha256,
      'batch_index', batch_index,
      'unit_id', unit_id,
      'row_kind', row_kind,
      'row_id', row_id,
      'record_ref', record_ref,
      'vendor_id', vendor_id,
      'agency_id', agency_id,
      'linked_official_price_id', linked_official_price_id
    )::text, 'UTF8'), 'sha256'), 'hex')
  )
);

DROP TRIGGER IF EXISTS vendor_disclosure_record_bindings_append_only
  ON public.vendor_disclosure_ingest_record_bindings;
CREATE TRIGGER vendor_disclosure_record_bindings_append_only
BEFORE UPDATE OR DELETE ON public.vendor_disclosure_ingest_record_bindings
FOR EACH ROW EXECUTE FUNCTION public.guard_official_review_event_append_only();

DROP TRIGGER IF EXISTS vendor_disclosure_record_bindings_no_truncate
  ON public.vendor_disclosure_ingest_record_bindings;
CREATE TRIGGER vendor_disclosure_record_bindings_no_truncate
BEFORE TRUNCATE ON public.vendor_disclosure_ingest_record_bindings
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_official_review_event_append_only();

CREATE TABLE public.vendor_disclosure_ingest_owned_identities (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index > 0),
  identity_kind text NOT NULL CHECK (identity_kind IN ('vendor', 'agency', 'vendor_timeslot')),
  identity_id uuid NOT NULL,
  parent_vendor_id uuid,
  initial_row_sha256 text NOT NULL CHECK (initial_row_sha256 ~ '^[0-9a-f]{64}$'),
  cleanup_status text NOT NULL DEFAULT 'owned' CHECK (
    cleanup_status IN (
      'owned', 'deleted', 'retained_external_reference', 'retained_modified',
      'retained_superseded'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_sha256, identity_kind, identity_id),
  FOREIGN KEY (run_sha256, batch_index)
    REFERENCES public.vendor_disclosure_ingest_batches(run_sha256, batch_index)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.vendor_disclosure_ingest_owned_ledger_rows (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index > 0),
  ledger_id uuid NOT NULL,
  initial_row_sha256 text NOT NULL CHECK (initial_row_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_run boolean NOT NULL,
  cleanup_status text NOT NULL DEFAULT 'owned' CHECK (
    cleanup_status IN (
      'owned', 'reused', 'deleted', 'retained_modified', 'retained_shared',
      'retained_superseded'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_sha256, ledger_id),
  CONSTRAINT vendor_disclosure_ingest_ledger_ownership_shape CHECK (
    (created_by_run AND cleanup_status IN (
      'owned', 'deleted', 'retained_modified', 'retained_shared', 'retained_superseded'
    ))
    OR (NOT created_by_run AND cleanup_status = 'reused')
  ),
  FOREIGN KEY (run_sha256, batch_index)
    REFERENCES public.vendor_disclosure_ingest_batches(run_sha256, batch_index)
    DEFERRABLE INITIALLY DEFERRED
);

-- Dedupe candidates live in global queues, so the run that introduced a
-- candidate must be journaled independently from the mutable queue row. This
-- allows an untouched invalidated run to remove only its own pending
-- candidates while preserving both the audit facts and shared/reviewed rows.
CREATE TABLE public.vendor_disclosure_ingest_dedupe_links (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256)
    ON DELETE RESTRICT,
  entity_kind text NOT NULL CHECK (entity_kind IN ('vendor', 'agency')),
  left_identity_id uuid NOT NULL,
  right_identity_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  similarity numeric NOT NULL CHECK (similarity BETWEEN 0 AND 1),
  created_by_run boolean NOT NULL,
  initial_candidate_sha256 text NOT NULL CHECK (
    initial_candidate_sha256 ~ '^[0-9a-f]{64}$'
  ),
  cleanup_status text NOT NULL CHECK (
    cleanup_status IN ('owned', 'reused', 'deleted', 'retained_superseded')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_sha256, entity_kind, left_identity_id, right_identity_id),
  CONSTRAINT vendor_disclosure_ingest_dedupe_link_order CHECK (
    left_identity_id < right_identity_id
  ),
  CONSTRAINT vendor_disclosure_ingest_dedupe_link_ownership CHECK (
    (created_by_run AND cleanup_status IN ('owned', 'deleted', 'retained_superseded'))
    OR (NOT created_by_run AND cleanup_status = 'reused')
  )
);

-- A paid provider claim is eligible only after a separate, postgres-owned
-- reconciliation has bound the successful request to this exact run/unit and
-- artifact chain. The staging payload and service_role cannot create or edit
-- these facts, so replaying ai_ledger JSON cannot manufacture paid lineage.
CREATE TABLE public.vendor_disclosure_paid_extraction_attestations (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index > 0),
  unit_id text NOT NULL CHECK (unit_id ~ '^[0-9a-f]{64}$'),
  ledger_id uuid NOT NULL UNIQUE,
  request_hash text NOT NULL UNIQUE CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  paid_plan_sha256 text NOT NULL CHECK (paid_plan_sha256 ~ '^[0-9a-f]{64}$'),
  provider_model text NOT NULL CHECK (length(provider_model) BETWEEN 1 AND 200),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  conversion_fingerprint text NOT NULL CHECK (conversion_fingerprint ~ '^[0-9a-f]{64}$'),
  extraction_fingerprint text NOT NULL CHECK (extraction_fingerprint ~ '^[0-9a-f]{64}$'),
  validation_fingerprint text NOT NULL CHECK (validation_fingerprint ~ '^[0-9a-f]{64}$'),
  full_plan_sha256 text NOT NULL CHECK (full_plan_sha256 ~ '^[0-9a-f]{64}$'),
  batch_plan_sha256 text NOT NULL CHECK (batch_plan_sha256 ~ '^[0-9a-f]{64}$'),
  batch_sha256 text NOT NULL CHECK (batch_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  unit_payload_sha256 text NOT NULL CHECK (unit_payload_sha256 ~ '^[0-9a-f]{64}$'),
  attestation_sha256 text NOT NULL CHECK (attestation_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_sha256, unit_id, ledger_id),
  CONSTRAINT vendor_disclosure_paid_attestation_digest_check CHECK (
    attestation_sha256 = encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', run_sha256,
      'batch_index', batch_index,
      'unit_id', unit_id,
      'ledger_id', ledger_id,
      'request_hash', request_hash,
      'paid_plan_sha256', paid_plan_sha256,
      'provider_model', provider_model,
      'source_fingerprint', source_fingerprint,
      'conversion_fingerprint', conversion_fingerprint,
      'extraction_fingerprint', extraction_fingerprint,
      'validation_fingerprint', validation_fingerprint,
      'full_plan_sha256', full_plan_sha256,
      'batch_plan_sha256', batch_plan_sha256,
      'batch_sha256', batch_sha256,
      'payload_sha256', payload_sha256,
      'unit_payload_sha256', unit_payload_sha256
    )::text, 'UTF8'), 'sha256'), 'hex')
  )
);

DROP TRIGGER IF EXISTS vendor_disclosure_paid_extraction_attestations_append_only
  ON public.vendor_disclosure_paid_extraction_attestations;
CREATE TRIGGER vendor_disclosure_paid_extraction_attestations_append_only
BEFORE UPDATE OR DELETE ON public.vendor_disclosure_paid_extraction_attestations
FOR EACH ROW EXECUTE FUNCTION public.guard_official_review_event_append_only();

DROP TRIGGER IF EXISTS vendor_disclosure_paid_extraction_attestations_no_truncate
  ON public.vendor_disclosure_paid_extraction_attestations;
CREATE TRIGGER vendor_disclosure_paid_extraction_attestations_no_truncate
BEFORE TRUNCATE ON public.vendor_disclosure_paid_extraction_attestations
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_official_review_event_append_only();

-- Immutable, per-unit provider lineage. This is deliberately separate from
-- the caller-supplied run authorization: changing authorization_kind cannot
-- turn a local or unproven unit into a paid bulk-approval candidate.
CREATE TABLE public.vendor_disclosure_ingest_unit_provider_lineage (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index > 0),
  unit_id text NOT NULL CHECK (unit_id ~ '^[0-9a-f]{64}$'),
  provider_mode text NOT NULL CHECK (
    provider_mode IN ('production_paid', 'local_deterministic', 'unproven')
  ),
  paid_plan_sha256 text CHECK (
    paid_plan_sha256 IS NULL OR paid_plan_sha256 ~ '^[0-9a-f]{64}$'
  ),
  successful_ledger_id uuid,
  provider_model text CHECK (
    provider_model IS NULL OR length(provider_model) BETWEEN 1 AND 200
  ),
  request_hash text CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  source_fingerprint text CHECK (
    source_fingerprint IS NULL OR source_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  conversion_fingerprint text CHECK (
    conversion_fingerprint IS NULL OR conversion_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  extraction_fingerprint text CHECK (
    extraction_fingerprint IS NULL OR extraction_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  validation_fingerprint text CHECK (
    validation_fingerprint IS NULL OR validation_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  paid_attestation_sha256 text CHECK (
    paid_attestation_sha256 IS NULL OR paid_attestation_sha256 ~ '^[0-9a-f]{64}$'
  ),
  bulk_approval_eligible boolean NOT NULL DEFAULT false,
  lineage_sha256 text NOT NULL CHECK (lineage_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_sha256, unit_id),
  FOREIGN KEY (run_sha256, batch_index)
    REFERENCES public.vendor_disclosure_ingest_batches(run_sha256, batch_index)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT vendor_disclosure_provider_lineage_shape CHECK (
    (
      provider_mode = 'production_paid'
      AND paid_plan_sha256 IS NOT NULL
      AND successful_ledger_id IS NOT NULL
      AND provider_model IS NOT NULL
      AND request_hash IS NOT NULL
      AND source_fingerprint IS NOT NULL
      AND conversion_fingerprint IS NOT NULL
      AND extraction_fingerprint IS NOT NULL
      AND validation_fingerprint IS NOT NULL
      AND paid_attestation_sha256 IS NOT NULL
      AND bulk_approval_eligible = true
    ) OR (
      provider_mode IN ('local_deterministic', 'unproven')
      AND paid_plan_sha256 IS NULL
      AND successful_ledger_id IS NULL
      AND provider_model IS NULL
      AND request_hash IS NULL
      AND source_fingerprint IS NULL
      AND conversion_fingerprint IS NULL
      AND extraction_fingerprint IS NULL
      AND validation_fingerprint IS NULL
      AND paid_attestation_sha256 IS NULL
      AND bulk_approval_eligible = false
    )
  )
);

DROP TRIGGER IF EXISTS vendor_disclosure_unit_provider_lineage_append_only
  ON public.vendor_disclosure_ingest_unit_provider_lineage;
CREATE TRIGGER vendor_disclosure_unit_provider_lineage_append_only
BEFORE UPDATE OR DELETE ON public.vendor_disclosure_ingest_unit_provider_lineage
FOR EACH ROW EXECUTE FUNCTION public.guard_official_review_event_append_only();

DROP TRIGGER IF EXISTS vendor_disclosure_unit_provider_lineage_no_truncate
  ON public.vendor_disclosure_ingest_unit_provider_lineage;
CREATE TRIGGER vendor_disclosure_unit_provider_lineage_no_truncate
BEFORE TRUNCATE ON public.vendor_disclosure_ingest_unit_provider_lineage
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_official_review_event_append_only();

CREATE TABLE public.vendor_disclosure_ingest_storage_links (
  run_sha256 text NOT NULL REFERENCES public.vendor_disclosure_ingest_runs(run_sha256) ON DELETE RESTRICT,
  batch_index integer NOT NULL CHECK (batch_index > 0),
  bucket_id text NOT NULL CHECK (bucket_id IN ('disclosure-raw', 'disclosure-preview')),
  object_name text NOT NULL,
  object_sha256 text NOT NULL CHECK (object_sha256 ~ '^[0-9a-f]{64}$'),
  object_bytes bigint NOT NULL CHECK (object_bytes >= 0 AND object_bytes <= 52428800),
  ownership_state text NOT NULL DEFAULT 'intent' CHECK (
    ownership_state IN (
      'intent', 'confirmed_created', 'confirmed_preexisting', 'confirmed_inherited', 'delete_authorized',
      'deleted', 'retained_shared', 'ambiguous'
    )
  ),
  storage_metadata_owner_run_sha256 text CHECK (
    storage_metadata_owner_run_sha256 IS NULL
    OR storage_metadata_owner_run_sha256 ~ '^[0-9a-f]{64}$'
  ),
  storage_object_id uuid,
  storage_object_updated_at timestamptz,
  upload_claim_epoch bigint NOT NULL DEFAULT 0 CHECK (upload_claim_epoch >= 0),
  upload_claim_token uuid,
  upload_claimant_id uuid,
  upload_claim_action text CHECK (upload_claim_action IN ('upload', 'verify')),
  upload_claimed_at timestamptz,
  upload_claim_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (run_sha256, bucket_id, object_name),
  CONSTRAINT vendor_disclosure_storage_upload_claim_shape CHECK (
    (upload_claim_token IS NULL AND upload_claimant_id IS NULL AND upload_claim_action IS NULL
      AND upload_claimed_at IS NULL AND upload_claim_expires_at IS NULL)
    OR (upload_claim_token IS NOT NULL AND upload_claimant_id IS NOT NULL
      AND upload_claim_action IS NOT NULL
      AND upload_claimed_at IS NOT NULL AND upload_claim_expires_at > upload_claimed_at)
  )
);

ALTER TABLE public.vendor_disclosure_ingest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_identity_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_owned_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_owned_rows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_record_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_record_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_owned_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_owned_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_owned_ledger_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_owned_ledger_rows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_dedupe_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_dedupe_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_paid_extraction_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_paid_extraction_attestations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_unit_provider_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_unit_provider_lineage FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_storage_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_ingest_storage_links FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.vendor_disclosure_ingest_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_batches FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_identity_links FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_owned_rows FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_record_bindings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_owned_identities FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_owned_ledger_rows FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_dedupe_links FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_paid_extraction_attestations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_unit_provider_lineage FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_disclosure_ingest_storage_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_runs TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_batches TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_identity_links TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_owned_rows TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_record_bindings TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_owned_identities TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_owned_ledger_rows TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_dedupe_links TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_paid_extraction_attestations TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_unit_provider_lineage TO service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_ingest_storage_links TO service_role;

-- Pending KCA rows must be born inside the atomic staging transaction. The
-- transaction-local marker is set only after the postgres-owned RPC has locked
-- and validated the exact active run/snapshot pair. This blocks retired
-- service-role writers from creating rows that have no ownership journal.
CREATE OR REPLACE FUNCTION public.guard_vendor_disclosure_atomic_pending_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_vendor_disclosure_atomic_pending_insert$
DECLARE
  snapshot_source_value text;
  marker_run_sha256 text;
  stage_function_owner name;
BEGIN
  SELECT snapshot.source
  INTO snapshot_source_value
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = NEW.snapshot_id;

  IF snapshot_source_value IS DISTINCT FROM 'kca_tprice'
    OR NEW.review_status IS DISTINCT FROM 'pending'
  THEN
    RETURN NEW;
  END IF;

  marker_run_sha256 := current_setting(
    'app.vendor_disclosure_atomic_run_sha256',
    true
  );
  SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
  INTO stage_function_owner
  FROM pg_catalog.pg_proc AS function_row
  WHERE function_row.oid = pg_catalog.to_regprocedure(
    'public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb)'
  );
  IF COALESCE(marker_run_sha256, '') !~ '^[0-9a-f]{64}$'
    OR stage_function_owner IS NULL
    OR NOT (current_user = stage_function_owner)
    OR NOT EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_runs AS run
      WHERE run.run_sha256 = marker_run_sha256
        AND run.snapshot_id = NEW.snapshot_id
        AND run.snapshot_source = 'kca_tprice'
        AND run.status = 'active'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_OWNERSHIP_CONTEXT_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$guard_vendor_disclosure_atomic_pending_insert$;

DROP TRIGGER IF EXISTS official_prices_atomic_pending_insert_fence
  ON public.official_prices;
CREATE TRIGGER official_prices_atomic_pending_insert_fence
BEFORE INSERT ON public.official_prices
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_disclosure_atomic_pending_insert();

DROP TRIGGER IF EXISTS official_agency_packages_atomic_pending_insert_fence
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_atomic_pending_insert_fence
BEFORE INSERT ON public.official_agency_packages
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_disclosure_atomic_pending_insert();

DROP TRIGGER IF EXISTS disclosure_semantic_atomic_pending_insert_fence
  ON public.disclosure_semantic_staging;
CREATE TRIGGER disclosure_semantic_atomic_pending_insert_fence
BEFORE INSERT ON public.disclosure_semantic_staging
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_disclosure_atomic_pending_insert();

-- The historical parent guard intentionally allowed service-role recovery
-- writes while a row was virgin/pending. Atomic disclosure rows no longer use
-- that path, but the postgres-owned abort RPC still needs to delete an exact
-- active run. Add that narrow delete capability without making a caller-set
-- GUC sufficient: the trigger runs with invoker rights and verifies the owner
-- of the abort function as well as the immutable ownership journal.
CREATE OR REPLACE FUNCTION public.guard_official_review_parent_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_official_review_parent_write$
DECLARE
  review_function_owner name;
  abort_function_owner name;
  invalidation_function_owner name;
  review_context text;
  abort_context text := current_setting(
    'app.vendor_disclosure_atomic_abort_run_sha256',
    true
  );
  invalidation_context text := current_setting(
    'app.vendor_disclosure_atomic_invalidate_run_sha256',
    true
  );
  invalidation_call_context text;
  target_row_id uuid;
  row_kind_value text;
  old_is_virgin_pending boolean := false;
  new_is_virgin_pending boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'official_prices' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO review_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.review_official_price(uuid,uuid,text,jsonb,jsonb,bigint)'
    );
    review_context := current_setting(
      'hanbang.review_official_price_parent_id',
      true
    );
    row_kind_value := 'official_price';
  ELSIF TG_TABLE_NAME = 'official_agency_packages' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO review_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.review_official_agency_package(uuid,uuid,text,jsonb,jsonb,bigint)'
    );
    review_context := current_setting(
      'hanbang.review_official_agency_package_parent_id',
      true
    );
    row_kind_value := 'agency_package';
  ELSE
    RAISE EXCEPTION 'OFFICIAL_REVIEW_PARENT_TABLE_UNSUPPORTED'
      USING ERRCODE = '55000';
  END IF;

  target_row_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  IF review_function_owner IS NOT NULL
    AND current_user = review_function_owner
    AND review_context = target_row_id::text
  THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' AND COALESCE(abort_context, '') ~ '^[0-9a-f]{64}$' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO abort_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.abort_vendor_disclosure_ingest_run_atomic(text,text,text,text)'
    );
    IF abort_function_owner IS NOT NULL
      AND current_user = abort_function_owner
      AND EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        JOIN public.vendor_disclosure_ingest_runs AS run
          ON run.run_sha256 = owned.run_sha256
        WHERE owned.run_sha256 = abort_context
          AND owned.row_kind = row_kind_value
          AND owned.row_id = target_row_id
          AND run.status = 'active'
      )
    THEN
      RETURN OLD;
    END IF;
  END IF;

  IF TG_OP = 'DELETE'
    AND COALESCE(invalidation_context, '') ~ '^[0-9a-f]{64}$'
  THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO invalidation_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.invalidate_vendor_disclosure_completed_run_atomic(text,text,text,text)'
    );
    GET DIAGNOSTICS invalidation_call_context = PG_CONTEXT;
    IF invalidation_function_owner IS NOT NULL
      AND current_user = invalidation_function_owner
      -- A caller-set GUC, including one set by another postgres-owned
      -- SECURITY DEFINER function, is not an authority token. PG_CONTEXT is
      -- documented trigger context and proves the guarded DELETE is executing
      -- inside the exact invalidation RPC body.
      AND (
        position(E'\nPL/pgSQL function invalidate_vendor_disclosure_completed_run_atomic(text,text,text,text) '
          IN invalidation_call_context) > 0
        OR position(E'\nPL/pgSQL function public.invalidate_vendor_disclosure_completed_run_atomic(text,text,text,text) '
          IN invalidation_call_context) > 0
      )
      AND EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        JOIN public.vendor_disclosure_ingest_runs AS run
          ON run.run_sha256 = owned.run_sha256
        JOIN public.price_snapshots AS snapshot
          ON snapshot.id = run.snapshot_id
        WHERE owned.run_sha256 = invalidation_context
          AND owned.row_kind = row_kind_value
          AND owned.row_id = target_row_id
          AND run.status = 'complete'
          AND run.snapshot_id = OLD.snapshot_id
          AND run.snapshot_source = snapshot.source
          AND run.snapshot_period = snapshot.period_label
      )
    THEN
      RETURN OLD;
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_is_virgin_pending :=
      OLD.review_status = 'pending'
      AND OLD.edited_by_admin = false
      AND OLD.reviewed_by IS NULL
      AND OLD.reviewed_at IS NULL
      AND OLD.review_action IS NULL
      AND OLD.review_version = 0;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    new_is_virgin_pending :=
      NEW.review_status = 'pending'
      AND NEW.edited_by_admin = false
      AND NEW.reviewed_by IS NULL
      AND NEW.reviewed_at IS NULL
      AND NEW.review_action IS NULL
      AND NEW.review_version = 0;
  END IF;

  IF TG_OP = 'INSERT' AND new_is_virgin_pending THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND old_is_virgin_pending AND new_is_virgin_pending THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'OFFICIAL_REVIEW_PARENT_WRITE_RPC_REQUIRED'
    USING ERRCODE = '42501';
END;
$guard_official_review_parent_write$;

-- The insert fence above was necessary but not sufficient: a caller could
-- relabel a non-KCA row/snapshot after insertion or mutate an atomically-owned
-- pending row and its option children. This invoker-rights trigger treats both
-- KCA snapshot membership and immutable ownership as protected. Only the
-- postgres-owned stage, CAS review, dedupe, and abort paths below can cross the
-- boundary; a service role cannot gain authority by setting the same GUC.
CREATE OR REPLACE FUNCTION public.guard_vendor_disclosure_atomic_protected_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $guard_vendor_disclosure_atomic_protected_write$
DECLARE
  old_snapshot_id uuid;
  new_snapshot_id uuid;
  old_row_id uuid;
  new_row_id uuid;
  old_parent_price_id uuid;
  new_parent_price_id uuid;
  row_kind_value text;
  owner_run_sha256s text[] := '{}'::text[];
  owner_run_sha256 text;
  protected_write boolean := false;
  stage_marker text := current_setting(
    'app.vendor_disclosure_atomic_run_sha256', true
  );
  abort_marker text := current_setting(
    'app.vendor_disclosure_atomic_abort_run_sha256', true
  );
  invalidation_marker text := current_setting(
    'app.vendor_disclosure_atomic_invalidate_run_sha256', true
  );
  price_review_marker text := current_setting(
    'hanbang.review_official_price_parent_id', true
  );
  package_review_marker text := current_setting(
    'hanbang.review_official_agency_package_parent_id', true
  );
  vendor_dedupe_marker text := current_setting(
    'app.vendor_disclosure_atomic_vendor_dedupe_mapping', true
  );
  agency_dedupe_marker text := current_setting(
    'app.vendor_disclosure_atomic_agency_dedupe_mapping', true
  );
  stage_function_owner name;
  abort_function_owner name;
  invalidation_function_owner name;
  invalidation_call_context text;
  price_review_function_owner name;
  package_review_function_owner name;
  vendor_dedupe_function_owner name;
  agency_dedupe_function_owner name;
BEGIN
  IF TG_TABLE_NAME = 'price_snapshots' THEN
    IF OLD.source IS NOT DISTINCT FROM NEW.source
      AND OLD.period_label IS NOT DISTINCT FROM NEW.period_label
    THEN
      RETURN NEW;
    END IF;
    IF OLD.source = 'kca_tprice'
      OR NEW.source = 'kca_tprice'
      OR EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_runs AS run
        WHERE run.snapshot_id = OLD.id
      )
    THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_SNAPSHOT_IDENTITY_IMMUTABLE'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'official_price_options' THEN
    old_parent_price_id := CASE
      WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.official_price_id
    END;
    new_parent_price_id := CASE
      WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.official_price_id
    END;
    SELECT COALESCE(array_agg(DISTINCT owned.run_sha256 ORDER BY owned.run_sha256), '{}'::text[])
    INTO owner_run_sha256s
    FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.row_kind = 'official_price'
      AND owned.row_id = ANY(array_remove(
        ARRAY[old_parent_price_id, new_parent_price_id]::uuid[], NULL
      ));
    protected_write := cardinality(owner_run_sha256s) > 0 OR EXISTS (
      SELECT 1
      FROM public.official_prices AS price
      JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
      WHERE price.id = ANY(array_remove(
        ARRAY[old_parent_price_id, new_parent_price_id]::uuid[], NULL
      ))
        AND snapshot.source = 'kca_tprice'
    );
  ELSE
    IF TG_TABLE_NAME = 'official_prices' THEN
      row_kind_value := 'official_price';
    ELSIF TG_TABLE_NAME = 'official_agency_packages' THEN
      row_kind_value := 'agency_package';
    ELSIF TG_TABLE_NAME = 'disclosure_semantic_staging' THEN
      row_kind_value := 'semantic';
    ELSE
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PROTECTED_TABLE_UNSUPPORTED'
        USING ERRCODE = '55000';
    END IF;
    old_row_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.id END;
    new_row_id := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.id END;
    old_snapshot_id := CASE
      WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.snapshot_id
    END;
    new_snapshot_id := CASE
      WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.snapshot_id
    END;
    SELECT COALESCE(array_agg(DISTINCT owned.run_sha256 ORDER BY owned.run_sha256), '{}'::text[])
    INTO owner_run_sha256s
    FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.row_kind = row_kind_value
      AND owned.row_id = ANY(array_remove(
        ARRAY[old_row_id, new_row_id]::uuid[], NULL
      ));
    protected_write := cardinality(owner_run_sha256s) > 0 OR EXISTS (
      SELECT 1
      FROM public.price_snapshots AS snapshot
      WHERE snapshot.id = ANY(array_remove(
        ARRAY[old_snapshot_id, new_snapshot_id]::uuid[], NULL
      ))
        AND snapshot.source = 'kca_tprice'
    );
  END IF;

  IF NOT protected_write THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF cardinality(owner_run_sha256s) > 1 THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PROTECTED_WRITE_AMBIGUOUS_OWNER'
      USING ERRCODE = '23514';
  END IF;
  owner_run_sha256 := owner_run_sha256s[1];

  SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
  INTO stage_function_owner
  FROM pg_catalog.pg_proc AS function_row
  WHERE function_row.oid = pg_catalog.to_regprocedure(
    'public.stage_vendor_disclosure_batch_atomic(text,text,text,text,text,integer,integer,text,text,text,text,text[],jsonb,jsonb)'
  );
  IF TG_OP = 'INSERT'
    AND stage_function_owner IS NOT NULL
    AND current_user = stage_function_owner
    AND COALESCE(stage_marker, '') ~ '^[0-9a-f]{64}$'
    AND owner_run_sha256 = stage_marker
    AND EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_runs AS run
      WHERE run.run_sha256 = stage_marker
        AND run.status = 'active'
    )
  THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME IN ('official_prices', 'official_price_options') THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO price_review_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.review_official_price(uuid,uuid,text,jsonb,jsonb,bigint)'
    );
    IF price_review_function_owner IS NOT NULL
      AND current_user = price_review_function_owner
      AND COALESCE(price_review_marker, '') ~ '^[0-9a-f-]{36}$'
      AND (
        (TG_TABLE_NAME = 'official_prices'
          AND TG_OP = 'UPDATE'
          AND old_row_id::text = price_review_marker
          AND new_row_id::text = price_review_marker)
        OR
        (TG_TABLE_NAME = 'official_price_options'
          AND COALESCE(old_parent_price_id::text, price_review_marker) = price_review_marker
          AND COALESCE(new_parent_price_id::text, price_review_marker) = price_review_marker)
      )
    THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'official_agency_packages' AND TG_OP = 'UPDATE' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO package_review_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.review_official_agency_package(uuid,uuid,text,jsonb,jsonb,bigint)'
    );
    IF package_review_function_owner IS NOT NULL
      AND current_user = package_review_function_owner
      AND old_row_id::text = package_review_marker
      AND new_row_id::text = package_review_marker
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Dedupe RPCs predate the atomic loader. They are SECURITY DEFINER, validate
  -- an admin decision, and may change only canonical identity references. Keep
  -- that narrow behavior while rejecting every caller-owned equivalent write.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'official_prices' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO vendor_dedupe_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.decide_vendor_dedupe_candidate(uuid,text,uuid,uuid)'
    );
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO agency_dedupe_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.decide_agency_dedupe_candidate(uuid,text,uuid,uuid)'
    );
    IF (
        vendor_dedupe_function_owner IS NOT NULL
        AND current_user = vendor_dedupe_function_owner
        AND vendor_dedupe_marker = OLD.vendor_id::text || ':' || NEW.vendor_id::text
        AND (to_jsonb(NEW) - ARRAY['vendor_id', 'updated_at']::text[])
          IS NOT DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['vendor_id', 'updated_at']::text[])
      ) OR (
        agency_dedupe_function_owner IS NOT NULL
        AND current_user = agency_dedupe_function_owner
        AND agency_dedupe_marker = OLD.agency_id::text || ':' || NEW.agency_id::text
        AND (to_jsonb(NEW) - ARRAY['agency_id', 'updated_at']::text[])
          IS NOT DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['agency_id', 'updated_at']::text[])
      )
    THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'official_agency_packages' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO agency_dedupe_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.decide_agency_dedupe_candidate(uuid,text,uuid,uuid)'
    );
    IF agency_dedupe_function_owner IS NOT NULL
      AND current_user = agency_dedupe_function_owner
      AND agency_dedupe_marker = OLD.agency_id::text || ':' || NEW.agency_id::text
      AND (to_jsonb(NEW) - ARRAY['agency_id', 'updated_at']::text[])
        IS NOT DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['agency_id', 'updated_at']::text[])
    THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'disclosure_semantic_staging' THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO vendor_dedupe_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.decide_vendor_dedupe_candidate(uuid,text,uuid,uuid)'
    );
    IF vendor_dedupe_function_owner IS NOT NULL
      AND current_user = vendor_dedupe_function_owner
      AND vendor_dedupe_marker = OLD.partner_vendor_id::text
        || ':' || NEW.partner_vendor_id::text
      AND (to_jsonb(NEW) - 'partner_vendor_id')
        IS NOT DISTINCT FROM (to_jsonb(OLD) - 'partner_vendor_id')
    THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'DELETE'
    AND owner_run_sha256 IS NOT NULL
    AND owner_run_sha256 = abort_marker
  THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO abort_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.abort_vendor_disclosure_ingest_run_atomic(text,text,text,text)'
    );
    IF abort_function_owner IS NOT NULL
      AND current_user = abort_function_owner
      AND EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_runs AS run
        WHERE run.run_sha256 = abort_marker
          AND run.status = 'active'
      )
    THEN
      RETURN OLD;
    END IF;
  END IF;

  IF TG_OP = 'DELETE'
    AND owner_run_sha256 IS NOT NULL
    AND owner_run_sha256 = invalidation_marker
  THEN
    SELECT pg_catalog.pg_get_userbyid(function_row.proowner)
    INTO invalidation_function_owner
    FROM pg_catalog.pg_proc AS function_row
    WHERE function_row.oid = pg_catalog.to_regprocedure(
      'public.invalidate_vendor_disclosure_completed_run_atomic(text,text,text,text)'
    );
    GET DIAGNOSTICS invalidation_call_context = PG_CONTEXT;
    IF invalidation_function_owner IS NOT NULL
      AND current_user = invalidation_function_owner
      AND (
        position(E'\nPL/pgSQL function invalidate_vendor_disclosure_completed_run_atomic(text,text,text,text) '
          IN invalidation_call_context) > 0
        OR position(E'\nPL/pgSQL function public.invalidate_vendor_disclosure_completed_run_atomic(text,text,text,text) '
          IN invalidation_call_context) > 0
      )
      AND EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_runs AS run
        JOIN public.price_snapshots AS snapshot ON snapshot.id = run.snapshot_id
        WHERE run.run_sha256 = invalidation_marker
          AND run.status = 'complete'
          AND run.snapshot_source = snapshot.source
          AND run.snapshot_period = snapshot.period_label
          AND (
            (
              TG_TABLE_NAME = 'official_price_options'
              AND EXISTS (
                SELECT 1
                FROM public.vendor_disclosure_ingest_owned_rows AS owned
                WHERE owned.run_sha256 = invalidation_marker
                  AND owned.row_kind = 'official_price'
                  AND owned.row_id = old_parent_price_id
              )
            )
            OR (
              TG_TABLE_NAME <> 'official_price_options'
              AND old_snapshot_id = run.snapshot_id
              AND EXISTS (
                SELECT 1
                FROM public.vendor_disclosure_ingest_owned_rows AS owned
                WHERE owned.run_sha256 = invalidation_marker
                  AND owned.row_kind = row_kind_value
                  AND owned.row_id = old_row_id
              )
            )
          )
      )
    THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PROTECTED_WRITE_RPC_REQUIRED'
    USING ERRCODE = '42501';
END;
$guard_vendor_disclosure_atomic_protected_write$;

DROP TRIGGER IF EXISTS price_snapshots_atomic_identity_fence
  ON public.price_snapshots;
CREATE TRIGGER price_snapshots_atomic_identity_fence
BEFORE UPDATE OF source, period_label ON public.price_snapshots
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_disclosure_atomic_protected_write();

DROP TRIGGER IF EXISTS official_prices_atomic_protected_write_fence
  ON public.official_prices;
CREATE TRIGGER official_prices_atomic_protected_write_fence
BEFORE UPDATE OR DELETE ON public.official_prices
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_disclosure_atomic_protected_write();

DROP TRIGGER IF EXISTS official_agency_packages_atomic_protected_write_fence
  ON public.official_agency_packages;
CREATE TRIGGER official_agency_packages_atomic_protected_write_fence
BEFORE UPDATE OR DELETE ON public.official_agency_packages
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_disclosure_atomic_protected_write();

DROP TRIGGER IF EXISTS disclosure_semantic_atomic_protected_write_fence
  ON public.disclosure_semantic_staging;
CREATE TRIGGER disclosure_semantic_atomic_protected_write_fence
BEFORE UPDATE OR DELETE ON public.disclosure_semantic_staging
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_disclosure_atomic_protected_write();

DROP TRIGGER IF EXISTS official_price_options_atomic_protected_write_fence
  ON public.official_price_options;
CREATE TRIGGER official_price_options_atomic_protected_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.official_price_options
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_disclosure_atomic_protected_write();

-- Base-table writes are RPC-only after this migration. Snapshot creation stays
-- available to the staging preflight, while snapshot identity mutation and all
-- disclosure row/option mutations execute as postgres inside the vetted RPCs.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.price_snapshots FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.official_prices,
  public.official_price_options,
  public.official_agency_packages,
  public.disclosure_semantic_staging
FROM service_role;

CREATE OR REPLACE FUNCTION public.vendor_disclosure_payload_provenance_is_safe(
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $vendor_disclosure_payload_provenance_is_safe$
DECLARE
  raw_keys text[];
  preview_keys text[];
  item jsonb;
  option_value jsonb;
  unit_value jsonb;
BEGIN
  IF jsonb_typeof(p_payload -> 'raw_objects') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'preview_objects') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'raw_objects') > 1000
    OR jsonb_array_length(p_payload -> 'preview_objects') > 1000
  THEN
    RETURN false;
  END IF;

  SELECT COALESCE(array_agg(raw.value ->> 'storage_path' ORDER BY raw.ordinality), '{}'::text[])
  INTO raw_keys
  FROM jsonb_array_elements(p_payload -> 'raw_objects') WITH ORDINALITY AS raw(value, ordinality);
  SELECT COALESCE(array_agg(preview.value ->> 'storage_path' ORDER BY preview.ordinality), '{}'::text[])
  INTO preview_keys
  FROM jsonb_array_elements(p_payload -> 'preview_objects') WITH ORDINALITY AS preview(value, ordinality);
  IF cardinality(raw_keys) IS DISTINCT FROM cardinality(ARRAY(SELECT DISTINCT key FROM unnest(raw_keys) AS source(key)))
    OR cardinality(preview_keys) IS DISTINCT FROM cardinality(ARRAY(SELECT DISTINCT key FROM unnest(preview_keys) AS source(key)))
  THEN
    RETURN false;
  END IF;

  FOR item IN SELECT raw.value FROM jsonb_array_elements(p_payload -> 'raw_objects') AS raw(value)
  LOOP
    IF COALESCE(item ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(item ->> 'ext', '') NOT IN ('xlsx', 'docx', 'hwp', 'pdf', 'png')
      OR item ->> 'storage_path' IS DISTINCT FROM (item ->> 'sha256') || '.' || (item ->> 'ext')
      OR COALESCE(item ->> 'bytes', '') !~ '^[0-9]{1,9}$'
      OR (item ->> 'bytes')::bigint > 52428800
      OR NULLIF(item ->> 'source_path', '') IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
        WHERE jsonb_typeof(unit.value -> 'source_object_keys') = 'array'
          AND unit.value -> 'source_object_keys' @> jsonb_build_array(item ->> 'storage_path')
      )
    THEN
      RETURN false;
    END IF;
  END LOOP;

  FOR item IN SELECT preview.value FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
  LOOP
    IF COALESCE(item ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
      OR item ->> 'storage_path' IS DISTINCT FROM (item ->> 'sha256') || '.txt'
      OR COALESCE(item ->> 'bytes', '') !~ '^[0-9]{1,8}$'
      OR (item ->> 'bytes')::bigint > 2097152
      OR item ->> 'source_object_key' IS NULL
      OR NOT COALESCE((item ->> 'source_object_key') = ANY(raw_keys), false)
      OR NULLIF(item ->> 'source_label', '') IS NULL
      OR length(item ->> 'source_label') > 255
      OR item ->> 'source_label' ~ '[\\/]'
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
        WHERE jsonb_typeof(unit.value -> 'source_preview_keys') = 'array'
          AND unit.value -> 'source_preview_keys' @> jsonb_build_array(item ->> 'storage_path')
      )
    THEN
      RETURN false;
    END IF;
  END LOOP;

  FOR unit_value IN SELECT unit.value FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
  LOOP
    IF jsonb_typeof(unit_value -> 'source_object_keys') IS DISTINCT FROM 'array'
      OR jsonb_array_length(unit_value -> 'source_object_keys') < 1
      OR jsonb_typeof(unit_value -> 'source_preview_keys') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(unit_value -> 'source_object_keys') AS key(value)
        WHERE key.value IS NULL OR NOT COALESCE(key.value = ANY(raw_keys), false)
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(unit_value -> 'source_preview_keys') AS key(value)
        WHERE key.value IS NULL OR NOT COALESCE(key.value = ANY(preview_keys), false)
      )
      OR jsonb_array_length(unit_value -> 'source_object_keys') IS DISTINCT FROM cardinality(ARRAY(
        SELECT DISTINCT key.value FROM jsonb_array_elements_text(unit_value -> 'source_object_keys') AS key(value)
      ))
      OR jsonb_array_length(unit_value -> 'source_preview_keys') IS DISTINCT FROM cardinality(ARRAY(
        SELECT DISTINCT key.value FROM jsonb_array_elements_text(unit_value -> 'source_preview_keys') AS key(value)
      ))
    THEN
      RETURN false;
    END IF;
  END LOOP;

  FOR item IN
    SELECT package.value FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
    UNION ALL
    SELECT price.value FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
    UNION ALL
    SELECT semantic.value FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
  LOOP
    SELECT unit.value INTO unit_value
    FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
    WHERE unit.value ->> 'unit_id' = item ->> 'unit_id';
    IF unit_value IS NULL
      OR jsonb_typeof(item -> 'source_object_keys') IS DISTINCT FROM 'array'
      OR jsonb_array_length(item -> 'source_object_keys') < 1
      OR jsonb_typeof(item -> 'source_preview_keys') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(item -> 'source_object_keys') AS key(value)
        WHERE key.value IS NULL OR NOT COALESCE(key.value = ANY(raw_keys), false)
          OR NOT (unit_value -> 'source_object_keys' @> jsonb_build_array(key.value))
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(item -> 'source_preview_keys') AS key(value)
        WHERE key.value IS NULL OR NOT COALESCE(key.value = ANY(preview_keys), false)
          OR NOT (unit_value -> 'source_preview_keys' @> jsonb_build_array(key.value))
          OR NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
            WHERE preview.value ->> 'storage_path' = key.value
              AND item -> 'source_object_keys' @> jsonb_build_array(preview.value ->> 'source_object_key')
          )
      )
    THEN
      RETURN false;
    END IF;
    IF item ? 'options' THEN
      IF jsonb_typeof(item -> 'options') IS DISTINCT FROM 'array'
        OR jsonb_array_length(item -> 'options') > 1000
      THEN
        RETURN false;
      END IF;
      FOR option_value IN SELECT option_row.value
        FROM jsonb_array_elements(item -> 'options') AS option_row(value)
      LOOP
        IF jsonb_typeof(option_value -> 'source_object_keys') IS DISTINCT FROM 'array'
          OR jsonb_array_length(option_value -> 'source_object_keys') < 1
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(option_value -> 'source_object_keys') AS key(value)
            WHERE key.value IS NULL OR NOT COALESCE(key.value = ANY(raw_keys), false)
              OR NOT (unit_value -> 'source_object_keys' @> jsonb_build_array(key.value))
          )
        THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$vendor_disclosure_payload_provenance_is_safe$;

-- The full batch digest prevents any caller-side JSON substitution. This
-- narrower digest additionally lets the approval path prove that the mutable
-- staging tables still contain the exact price/package/semantic projection
-- that postgres saw in the attested request. Arrays of sibling rows and price
-- options are sorted by their canonical jsonb text so physical row order and
-- generated UUIDs cannot change the digest.
CREATE OR REPLACE FUNCTION public.vendor_disclosure_unit_payload_sha256(
  p_payload jsonb,
  p_unit_id text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, extensions
AS $vendor_disclosure_unit_payload_sha256$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'agency_packages', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', encode(extensions.digest(convert_to(jsonb_build_object(
            'unit_id', p_unit_id,
            'package_name', package.value -> 'package_name',
            'source_file', package.value -> 'source_file',
            'source_quote', package.value -> 'source_quote'
          )::text, 'UTF8'), 'sha256'), 'hex'),
          'package_name', package.value -> 'package_name',
          'category_scope', package.value -> 'category_scope',
          'price_min_krw', package.value -> 'price_min_krw',
          'price_max_krw', package.value -> 'price_max_krw',
          'vat_note', package.value -> 'vat_note',
          'price_note', package.value -> 'price_note',
          'options', package.value -> 'options',
          'review_status', package.value -> 'review_status',
          'needs_review', package.value -> 'needs_review',
          'validation_issue_codes', package.value -> 'validation_issue_codes',
          'source_file', package.value -> 'source_file',
          'source_object_keys', package.value -> 'source_object_keys',
          'source_preview_keys', package.value -> 'source_preview_keys',
          'source_quote', package.value -> 'source_quote',
          'confidence', package.value -> 'confidence'
        ) AS entry
        FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
        WHERE package.value ->> 'unit_id' = p_unit_id
      ) AS projected
    ), '[]'::jsonb),
    'official_prices', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', COALESCE(
            NULLIF(price.value ->> 'partner_record_ref', ''),
            price.value ->> 'source_record_key'
          ),
          'category', price.value -> 'category',
          'item_name', price.value -> 'item_name',
          'base_spec', price.value -> 'base_spec',
          'price_min_krw', price.value -> 'price_min_krw',
          'price_max_krw', price.value -> 'price_max_krw',
          'vat_note', price.value -> 'vat_note',
          'price_note', price.value -> 'price_note',
          'options', COALESCE((
            SELECT jsonb_agg(option_projected.entry ORDER BY option_projected.entry::text)
            FROM (
              SELECT jsonb_build_object(
                'name', option_row.value -> 'name',
                'price_min_krw', option_row.value -> 'price_min_krw',
                'price_max_krw', option_row.value -> 'price_max_krw',
                'unit', option_row.value -> 'unit',
                'condition', option_row.value -> 'condition',
                'raw_text', option_row.value -> 'raw_text',
                'source_file', option_row.value -> 'source_file',
                'source_quote', option_row.value -> 'source_quote',
                'source_object_keys', option_row.value -> 'source_object_keys',
                'confidence', option_row.value -> 'confidence'
              ) AS entry
              FROM jsonb_array_elements(price.value -> 'options') AS option_row(value)
            ) AS option_projected
          ), '[]'::jsonb),
          'review_status', price.value -> 'review_status',
          'needs_review', price.value -> 'needs_review',
          'validation_issue_codes', price.value -> 'validation_issue_codes',
          'source_file', price.value -> 'source_file',
          'source_object_keys', price.value -> 'source_object_keys',
          'source_preview_keys', price.value -> 'source_preview_keys',
          'source_quote', price.value -> 'source_quote',
          'confidence', price.value -> 'confidence',
          'source_record_key', price.value -> 'source_record_key'
        ) AS entry
        FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
        WHERE price.value ->> 'unit_id' = p_unit_id
      ) AS projected
    ), '[]'::jsonb),
    'disclosure_semantics', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', COALESCE(
            NULLIF(semantic.value ->> 'partner_record_ref', ''),
            semantic.value ->> 'source_record_key'
          ),
          'schema_version', semantic.value -> 'schema_version',
          'record_kind', semantic.value -> 'record_kind',
          'semantic_type', semantic.value -> 'semantic_type',
          'subject_kind', semantic.value -> 'subject_kind',
          'subject_name', semantic.value -> 'subject_name',
          'subject_normalized_name', semantic.value -> 'subject_normalized_name',
          'vendor_category', semantic.value -> 'vendor_category',
          'region_code', semantic.value -> 'region_code',
          'title', semantic.value -> 'title',
          'content_verbatim', semantic.value -> 'content_verbatim',
          'summary', semantic.value -> 'summary',
          'partner_record_ref', semantic.value -> 'partner_record_ref',
          'source_agency', semantic.value -> 'source_agency',
          'partner_link_status', semantic.value -> 'partner_link_status',
          'review_status', semantic.value -> 'review_status',
          'needs_review', semantic.value -> 'needs_review',
          'validation_issue_codes', semantic.value -> 'validation_issue_codes',
          'source_file_ids', semantic.value -> 'source_file_ids',
          'source_file', semantic.value -> 'source_file',
          'source_object_keys', semantic.value -> 'source_object_keys',
          'source_preview_keys', semantic.value -> 'source_preview_keys',
          'source_quote', semantic.value -> 'source_quote',
          'source_fingerprint', semantic.value -> 'source_fingerprint',
          'validation_fingerprint', semantic.value -> 'validation_fingerprint',
          'confidence', semantic.value -> 'confidence',
          'source_record_key', semantic.value -> 'source_record_key',
          'content_fingerprint', semantic.value -> 'content_fingerprint'
        ) AS entry
        FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
        WHERE semantic.value ->> 'unit_id' = p_unit_id
      ) AS projected
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$vendor_disclosure_unit_payload_sha256$;

CREATE OR REPLACE FUNCTION public.vendor_disclosure_persisted_unit_payload_sha256(
  p_run_sha256 text,
  p_unit_id text
)
RETURNS text
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, public, extensions
AS $vendor_disclosure_persisted_unit_payload_sha256$
  SELECT encode(extensions.digest(convert_to(jsonb_build_object(
    'agency_packages', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', binding.record_ref,
          'package_name', package.package_name,
          'category_scope', package.category_scope,
          'price_min_krw', package.price_min_krw,
          'price_max_krw', package.price_max_krw,
          'vat_note', package.vat_note,
          'price_note', package.price_note,
          'options', package.options,
          'review_status', package.review_status,
          'needs_review', package.needs_review,
          'validation_issue_codes', package.validation_issue_codes,
          'source_file', package.source_file,
          'source_object_keys', package.source_object_keys,
          'source_preview_keys', package.source_preview_keys,
          'source_quote', package.source_quote,
          'confidence', package.confidence
        ) AS entry
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        JOIN public.official_agency_packages AS package
          ON owned.row_kind = 'agency_package' AND package.id = owned.row_id
        JOIN public.vendor_disclosure_ingest_record_bindings AS binding
          ON binding.run_sha256 = owned.run_sha256
          AND binding.unit_id = owned.unit_id
          AND binding.row_kind = owned.row_kind
          AND binding.row_id = owned.row_id
        WHERE owned.run_sha256 = p_run_sha256 AND owned.unit_id = p_unit_id
      ) AS projected
    ), '[]'::jsonb),
    'official_prices', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', binding.record_ref,
          'category', price.category,
          'item_name', price.item_name,
          'base_spec', price.base_spec,
          'price_min_krw', price.price_min_krw,
          'price_max_krw', price.price_max_krw,
          'vat_note', price.vat_note,
          'price_note', price.price_note,
          'options', COALESCE((
            SELECT jsonb_agg(option_projected.entry ORDER BY option_projected.entry::text)
            FROM (
              SELECT jsonb_build_object(
                'name', option_row.name,
                'price_min_krw', option_row.price_min_krw,
                'price_max_krw', option_row.price_max_krw,
                'unit', option_row.unit,
                'condition', option_row.condition,
                'raw_text', option_row.raw_text,
                'source_file', option_row.source_file,
                'source_quote', option_row.source_quote,
                'source_object_keys', option_row.source_object_keys,
                'confidence', option_row.confidence
              ) AS entry
              FROM public.official_price_options AS option_row
              WHERE option_row.official_price_id = price.id
            ) AS option_projected
          ), '[]'::jsonb),
          'review_status', price.review_status,
          'needs_review', price.needs_review,
          'validation_issue_codes', price.validation_issue_codes,
          'source_file', price.source_file,
          'source_object_keys', price.source_object_keys,
          'source_preview_keys', price.source_preview_keys,
          'source_quote', price.source_quote,
          'confidence', price.confidence,
          'source_record_key', price.source_record_key
        ) AS entry
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        JOIN public.official_prices AS price
          ON owned.row_kind = 'official_price' AND price.id = owned.row_id
        JOIN public.vendor_disclosure_ingest_record_bindings AS binding
          ON binding.run_sha256 = owned.run_sha256
          AND binding.unit_id = owned.unit_id
          AND binding.row_kind = owned.row_kind
          AND binding.row_id = owned.row_id
        WHERE owned.run_sha256 = p_run_sha256 AND owned.unit_id = p_unit_id
      ) AS projected
    ), '[]'::jsonb),
    'disclosure_semantics', COALESCE((
      SELECT jsonb_agg(projected.entry ORDER BY projected.entry::text)
      FROM (
        SELECT jsonb_build_object(
          'record_ref', binding.record_ref,
          'schema_version', semantic.schema_version,
          'record_kind', semantic.record_kind,
          'semantic_type', semantic.semantic_type,
          'subject_kind', semantic.subject_kind,
          'subject_name', semantic.subject_name,
          'subject_normalized_name', semantic.subject_normalized_name,
          'vendor_category', semantic.vendor_category,
          'region_code', semantic.region_code,
          'title', semantic.title,
          'content_verbatim', semantic.content_verbatim,
          'summary', semantic.summary,
          'partner_record_ref', semantic.partner_record_ref,
          'source_agency', semantic.source_agency,
          'partner_link_status', semantic.partner_link_status,
          'review_status', semantic.review_status,
          'needs_review', semantic.needs_review,
          'validation_issue_codes', semantic.validation_issue_codes,
          'source_file_ids', semantic.source_file_ids,
          'source_file', semantic.source_file,
          'source_object_keys', semantic.source_object_keys,
          'source_preview_keys', semantic.source_preview_keys,
          'source_quote', semantic.source_quote,
          'source_fingerprint', semantic.source_fingerprint,
          'validation_fingerprint', semantic.validation_fingerprint,
          'confidence', semantic.confidence,
          'source_record_key', semantic.source_record_key,
          'content_fingerprint', semantic.content_fingerprint
        ) AS entry
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        JOIN public.disclosure_semantic_staging AS semantic
          ON owned.row_kind = 'semantic' AND semantic.id = owned.row_id
        JOIN public.vendor_disclosure_ingest_record_bindings AS binding
          ON binding.run_sha256 = owned.run_sha256
          AND binding.unit_id = owned.unit_id
          AND binding.row_kind = owned.row_kind
          AND binding.row_id = owned.row_id
        WHERE owned.run_sha256 = p_run_sha256 AND owned.unit_id = p_unit_id
      ) AS projected
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$vendor_disclosure_persisted_unit_payload_sha256$;

-- An `intent` spans the non-transactional HTTP upload window. Its absence in
-- storage.objects is not proof that no request can still arrive, so abort and
-- rollback completion must fail closed until the normal resume path verifies
-- the object and records a terminal ownership observation.
CREATE OR REPLACE FUNCTION public.assert_vendor_disclosure_storage_intents_settled(
  p_run_sha256 text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $assert_vendor_disclosure_storage_intents_settled$
DECLARE
  unsettled_intent_count integer;
BEGIN
  IF p_run_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_INTENT_FENCE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer INTO unsettled_intent_count
  FROM public.vendor_disclosure_ingest_storage_links AS link
  WHERE link.run_sha256 = p_run_sha256 AND link.ownership_state = 'intent';
  IF unsettled_intent_count > 0 THEN
    RAISE EXCEPTION 'DISCLOSURE_ABORT_STORAGE_INTENTS_UNSETTLED'
      USING ERRCODE = '55000',
        DETAIL = unsettled_intent_count::text,
        HINT = 'Resume the exact staging load and record every Storage upload outcome before abort.';
  END IF;
END;
$assert_vendor_disclosure_storage_intents_settled$;

-- Lease expiry is diagnostic only: it never clears a claim. A timed-out HTTP
-- request may still arrive, so abort remains blocked until the exact claim is
-- settled by record or an explicit operator reconciliation.
CREATE OR REPLACE FUNCTION public.assert_vendor_disclosure_storage_upload_claims_settled(
  p_run_sha256 text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $assert_vendor_disclosure_storage_upload_claims_settled$
DECLARE
  unsettled_claim_count integer;
BEGIN
  IF p_run_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_CLAIM_FENCE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer INTO unsettled_claim_count
  FROM public.vendor_disclosure_ingest_storage_links AS link
  WHERE link.run_sha256 = p_run_sha256 AND link.upload_claim_token IS NOT NULL;
  IF unsettled_claim_count > 0 THEN
    RAISE EXCEPTION 'DISCLOSURE_ABORT_STORAGE_UPLOAD_CLAIMS_UNSETTLED'
      USING ERRCODE = '55000',
        DETAIL = unsettled_claim_count::text,
        HINT = 'Finish the exact claim or explicitly reconcile an interrupted upload before abort.';
  END IF;
END;
$assert_vendor_disclosure_storage_upload_claims_settled$;

CREATE OR REPLACE FUNCTION public.prepare_vendor_disclosure_batch_storage_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_full_plan_sha256 text,
  p_batch_index integer,
  p_batch_count integer,
  p_snapshot_source text,
  p_snapshot_period text,
  p_authorization_kind text,
  p_authorization_sha256 text,
  p_local_pending_only_unit_ids text[],
  p_storage_intents jsonb
)
RETURNS TABLE (prepared_object_count integer, already_prepared boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $prepare_vendor_disclosure_batch_storage_atomic$
DECLARE
  snapshot_row public.price_snapshots%ROWTYPE;
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  item jsonb;
  existing_link public.vendor_disclosure_ingest_storage_links%ROWTYPE;
  object_row storage.objects%ROWTYPE;
  inserted_count integer := 0;
  is_batch_replay boolean := false;
  snapshot_inserted boolean := false;
  superseded_run_sha256_value text;
  supersede_candidate_count integer := 0;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_full_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_authorization_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_count NOT BETWEEN 1 AND 1000
    OR p_batch_index NOT BETWEEN 1 AND p_batch_count
    OR p_snapshot_source NOT IN ('kca_tprice', 'agency_site', 'mixed')
    OR p_snapshot_period !~ '^20[0-9]{2}Q[1-4]$'
    OR p_authorization_kind NOT IN ('paid_pilot_gate', 'local_validated_pending_only')
    OR cardinality(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])) > 1000
    OR cardinality(COALESCE(p_local_pending_only_unit_ids, '{}'::text[]))
      <> cardinality(ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])) AS source(value)))
    OR EXISTS (
      SELECT 1 FROM unnest(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])) AS source(value)
      WHERE value !~ '^[0-9a-f]{64}$'
    )
    OR (p_authorization_kind = 'local_validated_pending_only')
      IS DISTINCT FROM (cardinality(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])) > 0)
    OR p_storage_intents IS NULL
    OR jsonb_typeof(p_storage_intents) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_storage_intents) NOT BETWEEN 1 AND 2000
    OR jsonb_array_length(p_storage_intents) IS DISTINCT FROM (
      SELECT count(DISTINCT (value ->> 'bucket', value ->> 'object_key'))
      FROM jsonb_array_elements(p_storage_intents)
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  -- Source/period is the canonical snapshot identity. Serialize before either
  -- looking up or bootstrapping it so two fresh runs cannot create/claim the
  -- same mutable draft surface concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'vendor-disclosure-snapshot-v1:' || p_snapshot_source || ':' || p_snapshot_period,
    0
  ));
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  SELECT run.* INTO run_row
  FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256
  FOR UPDATE NOWAIT;
  IF run_row.run_sha256 IS NULL THEN
    INSERT INTO public.price_snapshots (
      period_label, source, source_note, collected_at,
      published, is_current, published_at
    ) VALUES (
      p_snapshot_period, p_snapshot_source,
      'Atomic vendor disclosure staging draft', CURRENT_DATE,
      false, false, NULL
    )
    ON CONFLICT (source, period_label) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    snapshot_inserted := inserted_count = 1;
    inserted_count := 0;
    SELECT snapshot.* INTO snapshot_row
    FROM public.price_snapshots AS snapshot
    WHERE snapshot.source = p_snapshot_source AND snapshot.period_label = p_snapshot_period
    FOR UPDATE NOWAIT;
    IF snapshot_row.id IS NULL
      OR snapshot_row.published OR snapshot_row.is_current OR snapshot_row.published_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_SNAPSHOT_NOT_DRAFT' USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_runs AS live_run
      WHERE live_run.snapshot_id = snapshot_row.id
        AND live_run.status IN ('active', 'complete')
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_SNAPSHOT_ALREADY_OWNED'
        USING ERRCODE = '23505';
    END IF;
    SELECT count(*)::integer, min(candidate.run_sha256)
    INTO supersede_candidate_count, superseded_run_sha256_value
    FROM public.vendor_disclosure_ingest_runs AS candidate
    WHERE candidate.snapshot_id = snapshot_row.id
      AND candidate.status = 'invalidated'
      AND NOT EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_runs AS successor
        WHERE successor.supersedes_run_sha256 = candidate.run_sha256
      );
    IF supersede_candidate_count > 1 THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_AMBIGUOUS_INVALIDATED_PREDECESSOR'
        USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.vendor_disclosure_ingest_runs (
      run_sha256, target_project_ref, full_plan_sha256,
      authorization_kind, authorization_sha256, local_pending_only_unit_ids,
      snapshot_id, snapshot_source, snapshot_period, snapshot_created_by_run,
      supersedes_run_sha256, batch_count
    ) VALUES (
      p_run_sha256, p_target_project_ref, p_full_plan_sha256,
      p_authorization_kind, p_authorization_sha256, COALESCE(p_local_pending_only_unit_ids, '{}'::text[]),
      snapshot_row.id, p_snapshot_source, p_snapshot_period, snapshot_inserted,
      superseded_run_sha256_value, p_batch_count
    );
    SELECT run.* INTO run_row
    FROM public.vendor_disclosure_ingest_runs AS run
    WHERE run.run_sha256 = p_run_sha256
    FOR UPDATE;
  END IF;
  IF run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.full_plan_sha256 IS DISTINCT FROM p_full_plan_sha256
    OR run_row.authorization_kind IS DISTINCT FROM p_authorization_kind
    OR run_row.authorization_sha256 IS DISTINCT FROM p_authorization_sha256
    OR run_row.local_pending_only_unit_ids IS DISTINCT FROM COALESCE(p_local_pending_only_unit_ids, '{}'::text[])
    OR run_row.snapshot_source IS DISTINCT FROM p_snapshot_source
    OR run_row.snapshot_period IS DISTINCT FROM p_snapshot_period
    OR run_row.batch_count IS DISTINCT FROM p_batch_count
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_RUN_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF run_row.status = 'invalidated' THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_RUN_INVALIDATED' USING ERRCODE = '55000';
  ELSIF run_row.status = 'aborted' THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_RUN_ABORTED' USING ERRCODE = '55000';
  END IF;
  IF run_row.status = 'active' AND p_batch_index = run_row.completed_batch_count + 1 THEN
    is_batch_replay := false;
  ELSIF run_row.status IN ('active', 'complete')
    AND p_batch_index <= run_row.completed_batch_count
    AND EXISTS (
      SELECT 1 FROM public.vendor_disclosure_ingest_batches AS batch
      WHERE batch.run_sha256 = p_run_sha256 AND batch.batch_index = p_batch_index
    )
  THEN
    is_batch_replay := true;
  ELSE
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_BATCH_NOT_ADJACENT' USING ERRCODE = '23505';
  END IF;
  FOR item IN
    SELECT value FROM jsonb_array_elements(p_storage_intents)
    ORDER BY value ->> 'bucket', value ->> 'object_key'
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR item ->> 'bucket' NOT IN ('disclosure-raw', 'disclosure-preview')
      OR COALESCE(item ->> 'object_key', '') !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
      OR COALESCE(item ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
      OR split_part(item ->> 'object_key', '.', 1) IS DISTINCT FROM item ->> 'sha256'
      OR COALESCE(item ->> 'bytes', '') !~ '^[0-9]{1,9}$'
      OR (item ->> 'bytes')::bigint > 52428800
    THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_OBJECT_INVALID' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'vendor-disclosure-storage-v1:' || (item ->> 'bucket') || ':' || (item ->> 'object_key'),
      0
    ));
    IF EXISTS (
      SELECT 1 FROM public.vendor_disclosure_ingest_storage_links AS deleting_link
      WHERE deleting_link.run_sha256 <> p_run_sha256
        AND deleting_link.bucket_id = item ->> 'bucket'
        AND deleting_link.object_name = item ->> 'object_key'
        AND deleting_link.ownership_state = 'delete_authorized'
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_OBJECT_ROLLBACK_IN_PROGRESS' USING ERRCODE = '55000';
    END IF;
    SELECT link.* INTO existing_link
    FROM public.vendor_disclosure_ingest_storage_links AS link
    WHERE link.run_sha256 = p_run_sha256
      AND link.bucket_id = item ->> 'bucket'
      AND link.object_name = item ->> 'object_key'
    FOR UPDATE NOWAIT;
    IF existing_link.run_sha256 IS NULL AND is_batch_replay THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_REPLAY_OBJECT_MISSING' USING ERRCODE = '23505';
    ELSIF existing_link.run_sha256 IS NULL THEN
      SELECT object.* INTO object_row
      FROM storage.objects AS object
      WHERE object.bucket_id = item ->> 'bucket'
        AND object.name = item ->> 'object_key';
      IF object_row.id IS NOT NULL
        AND object_row.metadata ->> 'size' = item ->> 'bytes'
        AND object_row.user_metadata ->> 'ingest_sha256' = item ->> 'sha256'
        AND object_row.user_metadata ->> 'ingest_bytes' = item ->> 'bytes'
        AND COALESCE(object_row.user_metadata ->> 'ingest_run_sha256', '') ~ '^[0-9a-f]{64}$'
        AND EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_storage_links AS former_owner
          JOIN public.vendor_disclosure_ingest_runs AS former_run
            ON former_run.run_sha256 = former_owner.run_sha256
          WHERE former_owner.bucket_id = item ->> 'bucket'
            AND former_owner.object_name = item ->> 'object_key'
            AND former_owner.object_sha256 = item ->> 'sha256'
            AND former_owner.object_bytes = (item ->> 'bytes')::bigint
            AND former_owner.ownership_state = 'retained_shared'
            AND former_run.status IN ('aborted', 'invalidated')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_storage_links AS live_link
          JOIN public.vendor_disclosure_ingest_runs AS live_run
            ON live_run.run_sha256 = live_link.run_sha256
          WHERE live_link.bucket_id = item ->> 'bucket'
            AND live_link.object_name = item ->> 'object_key'
            AND live_run.status NOT IN ('aborted', 'invalidated')
        )
      THEN
        INSERT INTO public.vendor_disclosure_ingest_storage_links (
          run_sha256, batch_index, bucket_id, object_name, object_sha256, object_bytes,
          ownership_state, storage_metadata_owner_run_sha256,
          storage_object_id, storage_object_updated_at, confirmed_at
        ) VALUES (
          p_run_sha256, p_batch_index, item ->> 'bucket', item ->> 'object_key',
          item ->> 'sha256', (item ->> 'bytes')::bigint,
          'confirmed_inherited', object_row.user_metadata ->> 'ingest_run_sha256',
          object_row.id, object_row.updated_at, now()
        );
      ELSE
        INSERT INTO public.vendor_disclosure_ingest_storage_links (
          run_sha256, batch_index, bucket_id, object_name, object_sha256, object_bytes
        ) VALUES (
          p_run_sha256, p_batch_index, item ->> 'bucket', item ->> 'object_key',
          item ->> 'sha256', (item ->> 'bytes')::bigint
        );
      END IF;
      inserted_count := inserted_count + 1;
    ELSIF existing_link.batch_index > p_batch_index
      OR existing_link.object_sha256 IS DISTINCT FROM item ->> 'sha256'
      OR existing_link.object_bytes IS DISTINCT FROM (item ->> 'bytes')::bigint
    THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_PREPARE_REPLAY_CONFLICT' USING ERRCODE = '23505';
    END IF;
  END LOOP;
  prepared_object_count := jsonb_array_length(p_storage_intents);
  already_prepared := inserted_count = 0;
  RETURN NEXT;
END;
$prepare_vendor_disclosure_batch_storage_atomic$;

CREATE OR REPLACE FUNCTION public.claim_vendor_disclosure_storage_object_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_batch_index integer,
  p_bucket_id text,
  p_object_name text,
  p_object_sha256 text,
  p_object_bytes bigint,
  p_claimant_id uuid
)
RETURNS TABLE (
  claim_token uuid,
  claim_epoch bigint,
  claim_action text,
  ownership_state text,
  claim_expires_at timestamptz,
  claimant_id uuid,
  already_claimed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $claim_vendor_disclosure_storage_object_atomic$
DECLARE
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  link_row public.vendor_disclosure_ingest_storage_links%ROWTYPE;
  object_row storage.objects%ROWTYPE;
  next_epoch bigint;
  next_token uuid;
  next_action text;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_index < 1
    OR p_bucket_id NOT IN ('disclosure-raw', 'disclosure-preview')
    OR p_object_name !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
    OR p_object_sha256 !~ '^[0-9a-f]{64}$'
    OR split_part(p_object_name, '.', 1) IS DISTINCT FROM p_object_sha256
    OR p_object_bytes < 0 OR p_object_bytes > 52428800
    OR p_claimant_id IS NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_CLAIM_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'vendor-disclosure-storage-v1:' || p_bucket_id || ':' || p_object_name,
    0
  ));
  SELECT run.* INTO run_row FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256 FOR UPDATE NOWAIT;
  SELECT link.* INTO link_row FROM public.vendor_disclosure_ingest_storage_links AS link
  WHERE link.run_sha256 = p_run_sha256
    AND link.bucket_id = p_bucket_id AND link.object_name = p_object_name
  FOR UPDATE NOWAIT;
  IF run_row.run_sha256 IS NULL
    OR run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.status IS DISTINCT FROM 'active'
    OR link_row.run_sha256 IS NULL
    OR link_row.batch_index > p_batch_index
    OR link_row.object_sha256 IS DISTINCT FROM p_object_sha256
    OR link_row.object_bytes IS DISTINCT FROM p_object_bytes
    OR link_row.ownership_state NOT IN (
      'intent', 'confirmed_created', 'confirmed_preexisting', 'confirmed_inherited'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_CLAIM_RUN_OR_OBJECT_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF link_row.upload_claim_token IS NOT NULL THEN
    -- Never re-expose an active token, even to the same claimed caller. A
    -- copied state directory must not turn one HTTP authorization into two
    -- uploaders. Recovery uses the durable local claim journal and explicit
    -- manual reconciliation instead of recalling this RPC.
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_CLAIM_ALREADY_ACTIVE' USING ERRCODE = '55000';
  END IF;

  SELECT object.* INTO object_row FROM storage.objects AS object
  WHERE object.bucket_id = p_bucket_id AND object.name = p_object_name;
  IF link_row.ownership_state <> 'intent' THEN
    IF object_row.id IS NULL
      OR object_row.id IS DISTINCT FROM link_row.storage_object_id
      OR object_row.updated_at IS DISTINCT FROM link_row.storage_object_updated_at
      OR object_row.metadata ->> 'size' IS DISTINCT FROM p_object_bytes::text
      OR (
        link_row.ownership_state IN ('confirmed_created', 'confirmed_inherited')
        AND (
          object_row.user_metadata ->> 'ingest_run_sha256' IS DISTINCT FROM
            COALESCE(link_row.storage_metadata_owner_run_sha256, p_run_sha256)
          OR object_row.user_metadata ->> 'ingest_sha256' IS DISTINCT FROM p_object_sha256
          OR object_row.user_metadata ->> 'ingest_bytes' IS DISTINCT FROM p_object_bytes::text
        )
      )
      OR (
        link_row.ownership_state = 'confirmed_preexisting'
        AND NOT (
          (
            NOT (object_row.user_metadata ? 'ingest_run_sha256')
            AND NOT (object_row.user_metadata ? 'ingest_sha256')
            AND NOT (object_row.user_metadata ? 'ingest_bytes')
          )
          OR (
            object_row.user_metadata ? 'ingest_run_sha256'
            AND object_row.user_metadata ? 'ingest_sha256'
            AND object_row.user_metadata ? 'ingest_bytes'
            AND object_row.user_metadata ->> 'ingest_run_sha256'
              IS NOT DISTINCT FROM link_row.storage_metadata_owner_run_sha256
            AND object_row.user_metadata ->> 'ingest_sha256' = p_object_sha256
            AND object_row.user_metadata ->> 'ingest_bytes' = p_object_bytes::text
          )
        )
      )
    THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_CLAIM_CONFIRMED_GENERATION_CONFLICT' USING ERRCODE = '23505';
    END IF;
    next_action := 'verify';
  ELSIF object_row.id IS NULL THEN
    next_action := 'upload';
  ELSE
    IF object_row.metadata ->> 'size' IS DISTINCT FROM p_object_bytes::text THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_CLAIM_EXISTING_SIZE_CONFLICT' USING ERRCODE = '23505';
    END IF;
    next_action := 'verify';
  END IF;

  next_epoch := link_row.upload_claim_epoch + 1;
  next_token := gen_random_uuid();
  UPDATE public.vendor_disclosure_ingest_storage_links AS link
  SET upload_claim_epoch = next_epoch,
      upload_claim_token = next_token,
      upload_claimant_id = p_claimant_id,
      upload_claim_action = next_action,
      upload_claimed_at = now(),
      upload_claim_expires_at = now() + interval '10 minutes'
  WHERE link.run_sha256 = p_run_sha256
    AND link.bucket_id = p_bucket_id AND link.object_name = p_object_name
    AND link.upload_claim_token IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_CLAIM_RACE' USING ERRCODE = '40001';
  END IF;
  claim_token := next_token;
  claim_epoch := next_epoch;
  claim_action := next_action;
  ownership_state := link_row.ownership_state;
  claim_expires_at := now() + interval '10 minutes';
  claimant_id := p_claimant_id;
  already_claimed := false;
  RETURN NEXT;
END;
$claim_vendor_disclosure_storage_object_atomic$;

CREATE OR REPLACE FUNCTION public.record_vendor_disclosure_storage_object_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_batch_index integer,
  p_bucket_id text,
  p_object_name text,
  p_object_sha256 text,
  p_object_bytes bigint,
  p_created_by_run boolean,
  p_claim_token uuid,
  p_claim_epoch bigint,
  p_claimant_id uuid
)
RETURNS TABLE (ownership_state text, already_recorded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $record_vendor_disclosure_storage_object_atomic$
DECLARE
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  link_row public.vendor_disclosure_ingest_storage_links%ROWTYPE;
  object_row storage.objects%ROWTYPE;
  expected_state text;
  metadata_owner_run_sha256 text;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_index < 1
    OR p_bucket_id NOT IN ('disclosure-raw', 'disclosure-preview')
    OR p_object_name !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
    OR p_object_sha256 !~ '^[0-9a-f]{64}$'
    OR split_part(p_object_name, '.', 1) IS DISTINCT FROM p_object_sha256
    OR p_object_bytes < 0 OR p_object_bytes > 52428800
    OR p_claim_token IS NULL OR p_claim_epoch < 1 OR p_claimant_id IS NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  expected_state := CASE WHEN p_created_by_run THEN 'confirmed_created' ELSE 'confirmed_preexisting' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'vendor-disclosure-storage-v1:' || p_bucket_id || ':' || p_object_name,
    0
  ));
  SELECT run.* INTO run_row FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256 FOR UPDATE NOWAIT;
  SELECT link.* INTO link_row FROM public.vendor_disclosure_ingest_storage_links AS link
  WHERE link.run_sha256 = p_run_sha256
    AND link.bucket_id = p_bucket_id AND link.object_name = p_object_name
  FOR UPDATE NOWAIT;
  SELECT object.* INTO object_row FROM storage.objects AS object
  WHERE object.bucket_id = p_bucket_id AND object.name = p_object_name;
  metadata_owner_run_sha256 := NULLIF(object_row.user_metadata ->> 'ingest_run_sha256', '');
  IF run_row.run_sha256 IS NULL
    OR run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.status NOT IN ('active', 'complete')
    OR link_row.run_sha256 IS NULL
    OR link_row.batch_index > p_batch_index
    OR link_row.object_sha256 IS DISTINCT FROM p_object_sha256
    OR link_row.object_bytes IS DISTINCT FROM p_object_bytes
    OR link_row.upload_claim_token IS DISTINCT FROM p_claim_token
    OR link_row.upload_claim_epoch IS DISTINCT FROM p_claim_epoch
    OR link_row.upload_claimant_id IS DISTINCT FROM p_claimant_id
    OR object_row.id IS NULL
    OR object_row.metadata ->> 'size' IS DISTINCT FROM p_object_bytes::text
    OR (
       p_created_by_run
       AND (
        object_row.user_metadata ->> 'ingest_run_sha256' IS DISTINCT FROM p_run_sha256
        OR object_row.user_metadata ->> 'ingest_sha256' IS DISTINCT FROM p_object_sha256
         OR object_row.user_metadata ->> 'ingest_bytes' IS DISTINCT FROM p_object_bytes::text
         OR (
           link_row.upload_claim_action = 'upload'
           AND (
             object_row.user_metadata ->> 'ingest_claim_token' IS DISTINCT FROM p_claim_token::text
             OR object_row.user_metadata ->> 'ingest_claim_epoch' IS DISTINCT FROM p_claim_epoch::text
             OR object_row.user_metadata ->> 'ingest_claimant_id' IS DISTINCT FROM p_claimant_id::text
           )
         )
      )
    )
    OR (
      NOT p_created_by_run
      AND NOT (
        (
          NOT (object_row.user_metadata ? 'ingest_run_sha256')
          AND NOT (object_row.user_metadata ? 'ingest_sha256')
          AND NOT (object_row.user_metadata ? 'ingest_bytes')
        )
        OR (
          object_row.user_metadata ? 'ingest_run_sha256'
          AND object_row.user_metadata ? 'ingest_sha256'
          AND object_row.user_metadata ? 'ingest_bytes'
          AND metadata_owner_run_sha256 ~ '^[0-9a-f]{64}$'
          AND object_row.user_metadata ->> 'ingest_sha256' = p_object_sha256
          AND object_row.user_metadata ->> 'ingest_bytes' = p_object_bytes::text
        )
      )
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF link_row.ownership_state <> 'intent' THEN
    IF NOT (
        link_row.ownership_state = expected_state
        OR (NOT p_created_by_run AND link_row.ownership_state = 'confirmed_inherited')
      )
      OR link_row.storage_object_id IS DISTINCT FROM object_row.id
      OR link_row.storage_object_updated_at IS DISTINCT FROM object_row.updated_at
      OR link_row.storage_metadata_owner_run_sha256 IS DISTINCT FROM metadata_owner_run_sha256
    THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_REPLAY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    UPDATE public.vendor_disclosure_ingest_storage_links
    SET upload_claim_token = NULL, upload_claimant_id = NULL, upload_claim_action = NULL,
        upload_claimed_at = NULL, upload_claim_expires_at = NULL
    WHERE run_sha256 = p_run_sha256 AND bucket_id = p_bucket_id AND object_name = p_object_name
      AND upload_claim_token = p_claim_token AND upload_claim_epoch = p_claim_epoch
      AND upload_claimant_id = p_claimant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_CLAIM_CLOSE_RACE' USING ERRCODE = '40001';
    END IF;
    ownership_state := link_row.ownership_state;
    already_recorded := true;
    RETURN NEXT;
    RETURN;
  END IF;
  IF run_row.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_COMPLETE_RUN_INTENT_FORBIDDEN' USING ERRCODE = '55000';
  END IF;
  UPDATE public.vendor_disclosure_ingest_storage_links
  SET ownership_state = expected_state,
      storage_metadata_owner_run_sha256 = metadata_owner_run_sha256,
      storage_object_id = object_row.id,
      storage_object_updated_at = object_row.updated_at,
      confirmed_at = now(),
      upload_claim_token = NULL, upload_claimant_id = NULL, upload_claim_action = NULL,
      upload_claimed_at = NULL, upload_claim_expires_at = NULL
  WHERE run_sha256 = p_run_sha256 AND bucket_id = p_bucket_id AND object_name = p_object_name
    AND upload_claim_token = p_claim_token AND upload_claim_epoch = p_claim_epoch
    AND upload_claimant_id = p_claimant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_OUTCOME_CLAIM_CLOSE_RACE' USING ERRCODE = '40001';
  END IF;
  ownership_state := expected_state;
  already_recorded := false;
  RETURN NEXT;
END;
$record_vendor_disclosure_storage_object_atomic$;

CREATE OR REPLACE FUNCTION public.ensure_vendor_disclosure_agency_pending(
  p_run_sha256 text,
  p_batch_index integer,
  p_name text,
  p_normalized_name text,
  p_corporate_name text,
  p_region_code text,
  p_source_file text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $ensure_vendor_disclosure_agency_pending$
DECLARE
  matching_ids uuid[];
  selected_id uuid;
  generated_slug text;
  initial_row_sha256 text;
BEGIN
  IF p_run_sha256 !~ '^[0-9a-f]{64}$' OR p_batch_index < 1
    OR NULLIF(btrim(p_name), '') IS NULL
    OR NULLIF(btrim(p_normalized_name), '') IS NULL
    OR NULLIF(btrim(p_region_code), '') IS NULL
    OR NULLIF(btrim(p_source_file), '') IS NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_AGENCY_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'vendor-disclosure-agency-v1:' || p_region_code || ':' || p_normalized_name,
    0
  ));
  SELECT COALESCE(array_agg(agency.id ORDER BY agency.id), '{}'::uuid[])
  INTO matching_ids
  FROM public.agencies AS agency
  WHERE agency.region_code = p_region_code
    AND agency.merged_into_agency_id IS NULL
    AND agency.is_active = true
    AND (
      agency.normalized_name = p_normalized_name
      OR public.normalize_price_vendor_name(agency.name) = p_normalized_name
      OR EXISTS (
        SELECT 1 FROM unnest(agency.aliases) AS alias(value)
        WHERE public.normalize_price_vendor_name(alias.value) = p_normalized_name
      )
    );
  IF cardinality(matching_ids) > 1 THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_AGENCY_AMBIGUOUS' USING ERRCODE = '23514';
  END IF;
  IF cardinality(matching_ids) = 1 THEN
    selected_id := matching_ids[1];
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'vendor-disclosure-identity-v1:agency:' || selected_id::text, 0
    ));
    RETURN selected_id;
  END IF;
  generated_slug := 'agency-ingest-' || substr(
    encode(extensions.digest(convert_to(p_region_code || chr(31) || p_normalized_name, 'UTF8'), 'sha256'), 'hex'),
    1,
    16
  );
  INSERT INTO public.agencies (
    name, display_name, normalized_name, aliases, corporate_name,
    region_code, source_file, slug, is_active
  ) VALUES (
    p_name, p_name, p_normalized_name, '{}'::text[], p_corporate_name,
    p_region_code, p_source_file, generated_slug, true
  ) RETURNING id INTO selected_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'vendor-disclosure-identity-v1:agency:' || selected_id::text, 0
  ));
  SELECT encode(extensions.digest(convert_to(to_jsonb(agency)::text, 'UTF8'), 'sha256'), 'hex')
  INTO initial_row_sha256
  FROM public.agencies AS agency WHERE agency.id = selected_id;
  INSERT INTO public.vendor_disclosure_ingest_owned_identities (
    run_sha256, batch_index, identity_kind, identity_id, initial_row_sha256
  ) VALUES (
    p_run_sha256, p_batch_index, 'agency', selected_id, initial_row_sha256
  );
  RETURN selected_id;
END;
$ensure_vendor_disclosure_agency_pending$;

CREATE OR REPLACE FUNCTION public.ensure_vendor_disclosure_vendor_pending(
  p_run_sha256 text,
  p_batch_index integer,
  p_name text,
  p_category text,
  p_region_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $ensure_vendor_disclosure_vendor_pending$
DECLARE
  database_category text;
  normalized_name text;
  matching_ids uuid[];
  selected_id uuid;
  generated_slug text;
  initial_row_sha256 text;
  slot_row public.vendor_timeslots%ROWTYPE;
BEGIN
  database_category := CASE WHEN p_category = 'hall' THEN 'venue' ELSE p_category END;
  normalized_name := public.normalize_price_vendor_name(p_name);
  IF p_run_sha256 !~ '^[0-9a-f]{64}$' OR p_batch_index < 1
    OR NULLIF(btrim(p_name), '') IS NULL
    OR database_category IS NULL
    OR database_category NOT IN ('studio', 'dress', 'makeup', 'venue', 'other')
    OR NULLIF(btrim(p_region_code), '') IS NULL
    OR NULLIF(normalized_name, '') IS NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_VENDOR_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'vendor-disclosure-vendor-v1:' || database_category || ':' || p_region_code || ':' || normalized_name,
    0
  ));
  SELECT COALESCE(array_agg(vendor.id ORDER BY vendor.id), '{}'::uuid[])
  INTO matching_ids
  FROM public.vendors AS vendor
  WHERE vendor.category = database_category
    AND vendor.region_code = p_region_code
    AND vendor.status IN ('pending', 'approved', 'draft')
    AND (
      public.normalize_price_vendor_name(vendor.name) = normalized_name
      OR EXISTS (
        SELECT 1 FROM unnest(vendor.aliases) AS alias(value)
        WHERE public.normalize_price_vendor_name(alias.value) = normalized_name
      )
    );
  IF cardinality(matching_ids) > 1 THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_VENDOR_AMBIGUOUS' USING ERRCODE = '23514';
  END IF;
  IF cardinality(matching_ids) = 1 THEN
    selected_id := matching_ids[1];
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'vendor-disclosure-identity-v1:vendor:' || selected_id::text, 0
    ));
    RETURN selected_id;
  END IF;
  generated_slug := database_category || '-ingest-' || substr(
    encode(extensions.digest(convert_to(
      normalized_name || chr(31) || database_category || chr(31) || p_region_code,
      'UTF8'
    ), 'sha256'), 'hex'),
    1,
    16
  );
  INSERT INTO public.vendors (
    owner_id, name, slug, category, location, region, region_code, aliases,
    status, attributes, enrichment_status
  ) VALUES (
    NULL, p_name, generated_slug, database_category,
    p_region_code, p_region_code, p_region_code,
    '{}'::text[], 'pending', '{}'::jsonb, 'pending'
  ) RETURNING id INTO selected_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'vendor-disclosure-identity-v1:vendor:' || selected_id::text, 0
  ));
  SELECT encode(extensions.digest(convert_to(to_jsonb(vendor)::text, 'UTF8'), 'sha256'), 'hex')
  INTO initial_row_sha256
  FROM public.vendors AS vendor WHERE vendor.id = selected_id;
  INSERT INTO public.vendor_disclosure_ingest_owned_identities (
    run_sha256, batch_index, identity_kind, identity_id, initial_row_sha256
  ) VALUES (
    p_run_sha256, p_batch_index, 'vendor', selected_id, initial_row_sha256
  );
  FOR slot_row IN
    SELECT slot.* FROM public.vendor_timeslots AS slot
    WHERE slot.vendor_id = selected_id ORDER BY slot.id
  LOOP
    INSERT INTO public.vendor_disclosure_ingest_owned_identities (
      run_sha256, batch_index, identity_kind, identity_id, parent_vendor_id, initial_row_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, 'vendor_timeslot', slot_row.id, selected_id,
      encode(extensions.digest(convert_to(to_jsonb(slot_row)::text, 'UTF8'), 'sha256'), 'hex')
    );
  END LOOP;
  IF (
    SELECT count(*) FROM public.vendor_disclosure_ingest_owned_identities AS owned
    WHERE owned.run_sha256 = p_run_sha256
      AND owned.identity_kind = 'vendor_timeslot'
      AND owned.parent_vendor_id = selected_id
  ) <> 84 THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_VENDOR_TIMESLOT_OWNERSHIP_INCOMPLETE' USING ERRCODE = '23514';
  END IF;
  RETURN selected_id;
END;
$ensure_vendor_disclosure_vendor_pending$;

CREATE OR REPLACE FUNCTION public.stage_vendor_disclosure_batch_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_full_plan_sha256 text,
  p_batch_plan_sha256 text,
  p_batch_sha256 text,
  p_batch_index integer,
  p_batch_count integer,
  p_snapshot_source text,
  p_snapshot_period text,
  p_authorization_kind text,
  p_authorization_sha256 text,
  p_local_pending_only_unit_ids text[],
  p_storage_objects jsonb,
  p_payload jsonb
)
RETURNS TABLE (
  batch_receipt_sha256 text,
  loaded_unit_ids text[],
  logged_ledger_ids text[],
  already_applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $stage_vendor_disclosure_batch_atomic$
DECLARE
  snapshot_row public.price_snapshots%ROWTYPE;
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  stored_batch public.vendor_disclosure_ingest_batches%ROWTYPE;
  payload_sha256_value text;
  unit_ids_value text[];
  logged_ids_value text[] := '{}'::text[];
  row_value jsonb;
  option_value jsonb;
  alias_value text;
  agency_value jsonb;
  agency_id_value uuid;
  package_id_value uuid;
  vendor_id_value uuid;
  official_price_id_value uuid;
  semantic_id_value uuid;
  ledger_id_value text;
  ledger_uuid_value uuid;
  ledger_row public.ai_interactions_log%ROWTYPE;
  expected_ledger_metadata jsonb;
  ledger_initial_row_sha256_value text;
  provider_mode_value text;
  paid_plan_sha256_value text;
  successful_ledger_id_value uuid;
  provider_model_value text;
  request_hash_value text;
  source_fingerprint_value text;
  conversion_fingerprint_value text;
  extraction_fingerprint_value text;
  validation_fingerprint_value text;
  unit_payload_sha256_value text;
  paid_attestation_sha256_value text;
  paid_success_count integer;
  provider_lineage_sha256_value text;
  affected_rows integer;
  partner_ref_value text;
  record_ref_value text;
  record_binding_sha256_value text;
  staged_count integer := 0;
  review_count integer := 0;
  receipt_sha256_value text;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_full_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_count NOT BETWEEN 1 AND 1000
    OR p_batch_index NOT BETWEEN 1 AND p_batch_count
    OR cardinality(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])) > 1000
    OR p_authorization_kind NOT IN ('paid_pilot_gate', 'local_validated_pending_only')
    OR p_authorization_sha256 !~ '^[0-9a-f]{64}$'
    OR (cardinality(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])) > 0)
      IS DISTINCT FROM (p_authorization_kind = 'local_validated_pending_only')
    OR p_storage_objects IS NULL
    OR jsonb_typeof(p_storage_objects) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_storage_objects) NOT BETWEEN 1 AND 2000
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
      WHERE jsonb_typeof(supplied.value) IS DISTINCT FROM 'object'
        OR supplied.value ->> 'bucket' NOT IN ('disclosure-raw', 'disclosure-preview')
        OR COALESCE(supplied.value ->> 'object_key', '') !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
        OR COALESCE(supplied.value ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
        OR split_part(supplied.value ->> 'object_key', '.', 1) IS DISTINCT FROM supplied.value ->> 'sha256'
        OR COALESCE(supplied.value ->> 'bytes', '') !~ '^[0-9]{1,9}$'
        OR (supplied.value ->> 'bytes')::bigint > 52428800
        OR jsonb_typeof(supplied.value -> 'created') IS DISTINCT FROM 'boolean'
    )
    OR jsonb_array_length(p_storage_objects) IS DISTINCT FROM (
      SELECT count(DISTINCT (value ->> 'bucket', value ->> 'object_key'))
      FROM jsonb_array_elements(p_storage_objects)
    )
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR NOT p_payload ?& ARRAY[
      'schema_version', 'snapshot', 'snapshot_source', 'units', 'skipped_units',
      'raw_objects', 'preview_objects', 'agency_packages', 'official_prices',
      'disclosure_semantics', 'dedupe_candidates', 'ai_ledger', 'warnings'
    ]::text[]
    OR (p_payload ->> 'schema_version')::integer <> 2
    OR p_payload ->> 'snapshot' IS DISTINCT FROM p_snapshot_period
    OR p_payload ->> 'snapshot_source' IS DISTINCT FROM p_snapshot_source
    OR jsonb_typeof(p_payload -> 'units') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'units') NOT BETWEEN 1 AND 25
    OR jsonb_typeof(p_payload -> 'raw_objects') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'preview_objects') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload -> 'agency_packages') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'agency_packages') > 5000
    OR jsonb_typeof(p_payload -> 'official_prices') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'official_prices') > 5000
    OR jsonb_typeof(p_payload -> 'disclosure_semantics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'disclosure_semantics') > 5000
    OR jsonb_typeof(p_payload -> 'dedupe_candidates') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'dedupe_candidates') <> 0
    OR jsonb_typeof(p_payload -> 'ai_ledger') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload -> 'ai_ledger') > 5000
    OR NOT public.vendor_disclosure_payload_provenance_is_safe(p_payload)
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(unit.value ->> 'unit_id' ORDER BY unit.ordinality)
  INTO unit_ids_value
  FROM jsonb_array_elements(p_payload -> 'units') WITH ORDINALITY AS unit(value, ordinality);
  IF cardinality(unit_ids_value) <> cardinality(ARRAY(
      SELECT DISTINCT unit_id FROM unnest(unit_ids_value) AS source(unit_id)
    ))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
      WHERE unit.value ->> 'unit_id' IS NULL
        OR unit.value ->> 'unit_id' !~ '^[0-9a-f]{64}$'
        OR COALESCE(unit.value ->> 'source_fingerprint', '') !~ '^[0-9a-f]{64}$'
        OR COALESCE(unit.value ->> 'conversion_fingerprint', '') !~ '^[0-9a-f]{64}$'
        OR COALESCE(unit.value ->> 'extraction_fingerprint', '') !~ '^[0-9a-f]{64}$'
        OR COALESCE(unit.value ->> 'validation_fingerprint', '') !~ '^[0-9a-f]{64}$'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_INVALID_UNITS' USING ERRCODE = '22023';
  END IF;
  IF p_authorization_kind = 'local_validated_pending_only' AND EXISTS (
    SELECT 1 FROM unnest(unit_ids_value) AS unit(unit_id)
    WHERE NOT COALESCE(
      unit.unit_id = ANY(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])),
      false
    )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LOCAL_UNIT_OUTSIDE_AUTHORIZATION' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT package.value AS value FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
      UNION ALL
      SELECT price.value FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
      UNION ALL
      SELECT semantic.value FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
    ) AS staging_row
    WHERE staging_row.value ->> 'review_status' IS DISTINCT FROM 'pending'
      OR jsonb_typeof(staging_row.value -> 'needs_review') IS DISTINCT FROM 'boolean'
      OR staging_row.value ->> 'unit_id' IS NULL
      OR NOT COALESCE((staging_row.value ->> 'unit_id') = ANY(unit_ids_value), false)
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PENDING_ONLY' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
    WHERE COALESCE(price.value -> 'price_min_krw', 'null'::jsonb) = 'null'::jsonb
      AND COALESCE(price.value -> 'price_max_krw', 'null'::jsonb) = 'null'::jsonb
      AND (price.value ->> 'needs_review')::boolean IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_UNPRICED_ROW_REVIEW_ONLY' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
    WHERE price.value ->> 'category' IS NULL
      OR price.value ->> 'category' NOT IN ('studio', 'dress', 'makeup', 'hall')
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
    WHERE semantic.value ->> 'record_kind' = 'vendor_policy'
      AND (
        semantic.value ->> 'vendor_category' IS NULL
        OR semantic.value ->> 'vendor_category' NOT IN ('studio', 'dress', 'makeup', 'hall')
      )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_FOUR_TAB_CATEGORY_ONLY' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT package.value AS value FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
      UNION ALL
      SELECT price.value FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
      UNION ALL
      SELECT semantic.value FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
    ) AS staging_row
    WHERE COALESCE((staging_row.value ->> 'unit_id') = ANY(COALESCE(p_local_pending_only_unit_ids, '{}'::text[])), false)
      AND (
        (staging_row.value ->> 'needs_review')::boolean IS DISTINCT FROM true
        OR NOT COALESCE(
          staging_row.value -> 'validation_issue_codes' @> '["local_deterministic_review_only"]'::jsonb,
          false
        )
      )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LOCAL_REVIEW_ONLY_CONTRACT' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(unit_ids_value) AS unit(unit_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM (
        SELECT package.value ->> 'unit_id' AS unit_id
        FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
        UNION ALL
        SELECT price.value ->> 'unit_id'
        FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
        UNION ALL
        SELECT semantic.value ->> 'unit_id'
        FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
      ) AS staged
      WHERE staged.unit_id = unit.unit_id
    )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_UNIT_WITHOUT_ROWS' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload -> 'ai_ledger') AS ledger(value)
    WHERE ledger.value ->> 'unit_id' IS NULL
      OR NOT COALESCE((ledger.value ->> 'unit_id') = ANY(unit_ids_value), false)
      OR COALESCE(ledger.value ->> 'ledger_id', '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(ledger.value ->> 'schema_version', '') !~ '^[23]$'
      OR (
        ledger.value ->> 'schema_version' = '3'
        AND (
          ledger.value ->> 'provider_mode' NOT IN ('production_paid', 'test_only')
          OR COALESCE(ledger.value ->> 'request_hash', '') !~ '^[0-9a-f]{64}$'
          OR (
            ledger.value ->> 'provider_mode' = 'production_paid'
            AND COALESCE(ledger.value ->> 'paid_plan_sha256', '') !~ '^[0-9a-f]{64}$'
          )
          OR (
            ledger.value ->> 'provider_mode' = 'test_only'
            AND ledger.value -> 'paid_plan_sha256' <> 'null'::jsonb
          )
          OR (
            (ledger.value ->> 'success')::boolean
            AND ledger.value ->> 'provider_mode' = 'production_paid'
            AND NULLIF(btrim(ledger.value ->> 'provider_model'), '') IS NULL
          )
        )
      )
  ) OR jsonb_array_length(p_payload -> 'ai_ledger') IS DISTINCT FROM (
    SELECT count(DISTINCT ledger.value ->> 'ledger_id')
    FROM jsonb_array_elements(p_payload -> 'ai_ledger') AS ledger(value)
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LEDGER_OUTSIDE_BATCH' USING ERRCODE = '23514';
  END IF;
  payload_sha256_value := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  SELECT run.* INTO run_row
  FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256
  FOR UPDATE;
  IF run_row.run_sha256 IS NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_STORAGE_PREPARE_REQUIRED' USING ERRCODE = '55000';
  ELSE
    IF run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
      OR run_row.full_plan_sha256 IS DISTINCT FROM p_full_plan_sha256
      OR run_row.authorization_kind IS DISTINCT FROM p_authorization_kind
      OR run_row.authorization_sha256 IS DISTINCT FROM p_authorization_sha256
      OR run_row.local_pending_only_unit_ids IS DISTINCT FROM COALESCE(p_local_pending_only_unit_ids, '{}'::text[])
      OR run_row.snapshot_source IS DISTINCT FROM p_snapshot_source
      OR run_row.snapshot_period IS DISTINCT FROM p_snapshot_period
      OR run_row.batch_count IS DISTINCT FROM p_batch_count
    THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_CONFLICT' USING ERRCODE = '23505';
    END IF;
    -- Terminal runs may retain immutable batch receipts for audit, but those
    -- receipts are never executable replay authority.
    IF run_row.status = 'invalidated' THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_INVALIDATED' USING ERRCODE = '55000';
    ELSIF run_row.status = 'aborted' THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_ABORTED' USING ERRCODE = '55000';
    END IF;
    SELECT batch.* INTO stored_batch
    FROM public.vendor_disclosure_ingest_batches AS batch
    WHERE batch.run_sha256 = p_run_sha256
      AND batch.batch_index = p_batch_index;
    IF stored_batch.id IS NOT NULL THEN
      IF stored_batch.batch_sha256 IS DISTINCT FROM p_batch_sha256
        OR stored_batch.batch_plan_sha256 IS DISTINCT FROM p_batch_plan_sha256
        OR stored_batch.payload_sha256 IS DISTINCT FROM payload_sha256_value
        OR stored_batch.unit_ids IS DISTINCT FROM unit_ids_value
      THEN
        RAISE EXCEPTION 'DISCLOSURE_ATOMIC_BATCH_CONFLICT' USING ERRCODE = '23505';
      END IF;
      batch_receipt_sha256 := stored_batch.batch_receipt_sha256;
      loaded_unit_ids := stored_batch.unit_ids;
      logged_ledger_ids := stored_batch.logged_ledger_ids;
      already_applied := true;
      RETURN NEXT;
      RETURN;
    END IF;
    IF run_row.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_NOT_ACTIVE' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- EXCLUSIVE conflicts with the ROW SHARE table lock taken by SELECT FOR
  -- UPDATE. Acquire only the two parent tables: this blocks the existing
  -- entity-first dedupe paths without creating a child-table lock-upgrade
  -- cycle with price/package admin review.
  LOCK TABLE public.vendors, public.agencies IN EXCLUSIVE MODE NOWAIT;

  SELECT snapshot.* INTO snapshot_row
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = run_row.snapshot_id
  FOR UPDATE NOWAIT;
  IF snapshot_row.id IS NULL
    OR snapshot_row.published
    OR snapshot_row.is_current
    OR snapshot_row.published_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_SNAPSHOT_NOT_DRAFT' USING ERRCODE = '55000';
  END IF;

  IF run_row.snapshot_id IS DISTINCT FROM snapshot_row.id THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_RUN_SNAPSHOT_CONFLICT' USING ERRCODE = '23505';
  END IF;

  PERFORM public.assert_vendor_disclosure_storage_upload_claims_settled(p_run_sha256);

  IF jsonb_array_length(p_storage_objects)
      IS DISTINCT FROM jsonb_array_length(p_payload -> 'raw_objects') + jsonb_array_length(p_payload -> 'preview_objects')
    OR EXISTS (
      SELECT 1
      FROM (
        SELECT 'disclosure-raw'::text AS bucket_id,
          raw.value ->> 'storage_path' AS object_name,
          raw.value ->> 'sha256' AS object_sha256,
          (raw.value ->> 'bytes')::bigint AS object_bytes
        FROM jsonb_array_elements(p_payload -> 'raw_objects') AS raw(value)
        UNION ALL
        SELECT 'disclosure-preview'::text,
          preview.value ->> 'storage_path', preview.value ->> 'sha256',
          (preview.value ->> 'bytes')::bigint
        FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
      ) AS expected
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
        WHERE supplied.value ->> 'bucket' = expected.bucket_id
          AND supplied.value ->> 'object_key' = expected.object_name
          AND supplied.value ->> 'sha256' = expected.object_sha256
          AND (supplied.value ->> 'bytes')::bigint = expected.object_bytes
      )
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.vendor_disclosure_ingest_storage_links AS link
        WHERE link.run_sha256 = p_run_sha256
          AND link.batch_index <= p_batch_index
          AND link.bucket_id = supplied.value ->> 'bucket'
          AND link.object_name = supplied.value ->> 'object_key'
          AND link.object_sha256 = supplied.value ->> 'sha256'
          AND link.object_bytes = (supplied.value ->> 'bytes')::bigint
          AND (
            ((supplied.value ->> 'created')::boolean
              AND link.ownership_state = 'confirmed_created')
            OR (NOT (supplied.value ->> 'created')::boolean
              AND link.ownership_state IN ('confirmed_preexisting', 'confirmed_inherited'))
          )
          AND EXISTS (
            SELECT 1 FROM storage.objects AS object
            WHERE object.bucket_id = link.bucket_id AND object.name = link.object_name
              AND object.id = link.storage_object_id
              AND object.updated_at = link.storage_object_updated_at
              AND object.metadata ->> 'size' = link.object_bytes::text
              AND (
                link.ownership_state = 'confirmed_preexisting'
                OR (
                  object.user_metadata ->> 'ingest_run_sha256' = link.storage_metadata_owner_run_sha256
                  AND object.user_metadata ->> 'ingest_sha256' = link.object_sha256
                  AND object.user_metadata ->> 'ingest_bytes' = link.object_bytes::text
                )
              )
          )
      )
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_STORAGE_OUTCOME_INCOMPLETE' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload -> 'raw_objects') AS raw(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = 'disclosure-raw'
        AND object.name = raw.value ->> 'storage_path'
        AND object.metadata ->> 'size' IS NOT DISTINCT FROM raw.value ->> 'bytes'
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payload -> 'preview_objects') AS preview(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = 'disclosure-preview'
        AND object.name = preview.value ->> 'storage_path'
        AND object.metadata ->> 'size' IS NOT DISTINCT FROM preview.value ->> 'bytes'
    )
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_STORAGE_OBJECT_MISSING_OR_WRONG_SIZE' USING ERRCODE = '23514';
  END IF;
  IF p_batch_index IS DISTINCT FROM run_row.completed_batch_count + 1 THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_BATCH_NOT_ADJACENT' USING ERRCODE = '40001';
  END IF;

  FOR row_value IN SELECT ledger.value FROM jsonb_array_elements(p_payload -> 'ai_ledger') AS ledger(value)
  LOOP
    ledger_id_value := row_value ->> 'ledger_id';
    IF COALESCE(ledger_id_value, '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LEDGER_ID_INVALID' USING ERRCODE = '22023';
    END IF;
    ledger_uuid_value := (
      substr(ledger_id_value, 1, 8) || '-' || substr(ledger_id_value, 9, 4)
      || '-4' || substr(ledger_id_value, 14, 3)
      || '-8' || substr(ledger_id_value, 18, 3)
      || '-' || substr(ledger_id_value, 21, 12)
    )::uuid;
    expected_ledger_metadata := jsonb_build_object(
      'ingest_call_id', ledger_id_value,
      'ingest_ledger_id', ledger_id_value,
      'ingest_run_id', row_value ->> 'run_id',
      'unit_id', row_value ->> 'unit_id',
      'fingerprint', row_value ->> 'fingerprint',
      'prompt_version', row_value ->> 'prompt_version',
      'request_id', row_value ->> 'request_id',
      'batch_index', (row_value ->> 'batch_index')::integer,
      'attempt', (row_value ->> 'attempt')::integer,
      'ledger_schema_version', (row_value ->> 'schema_version')::integer,
      'provider_mode', CASE WHEN row_value ->> 'schema_version' = '3'
        THEN row_value ->> 'provider_mode' ELSE NULL END,
      'paid_plan_sha256', CASE WHEN row_value ->> 'schema_version' = '3'
        THEN row_value ->> 'paid_plan_sha256' ELSE NULL END,
      'provider_model', CASE WHEN row_value ->> 'schema_version' = '3'
        THEN row_value ->> 'provider_model' ELSE NULL END,
      'request_hash', CASE WHEN row_value ->> 'schema_version' = '3'
        THEN row_value ->> 'request_hash' ELSE NULL END,
      'source', 'local_disclosure_ingest'
    );
    INSERT INTO public.ai_interactions_log (
      id, session_id, interaction_type, tool_name, latency_ms, success,
      error_message, model, tokens_input, tokens_output, cost_usd, metadata, created_at
    ) VALUES (
      ledger_uuid_value, 'disclosure_ingest', 'disclosure_extraction', 'disclosure_extraction',
      (row_value ->> 'latency_ms')::integer,
      (row_value ->> 'success')::boolean,
      row_value ->> 'error_category',
      COALESCE(row_value ->> 'provider_model', row_value ->> 'model'),
      (row_value ->> 'input_tokens')::integer,
      (row_value ->> 'output_tokens')::integer,
      (row_value ->> 'estimated_cost_usd')::numeric,
      expected_ledger_metadata,
      (row_value ->> 'attempted_at')::timestamptz
    ) ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    SELECT ledger.* INTO ledger_row
    FROM public.ai_interactions_log AS ledger
    WHERE ledger.id = ledger_uuid_value
    FOR SHARE;
    IF ledger_row.id IS NULL
      OR ledger_row.session_id IS DISTINCT FROM 'disclosure_ingest'
      OR ledger_row.interaction_type IS DISTINCT FROM 'disclosure_extraction'
      OR ledger_row.tool_name IS DISTINCT FROM 'disclosure_extraction'
      OR ledger_row.latency_ms IS DISTINCT FROM (row_value ->> 'latency_ms')::integer
      OR ledger_row.success IS DISTINCT FROM (row_value ->> 'success')::boolean
      OR ledger_row.error_message IS DISTINCT FROM row_value ->> 'error_category'
      OR ledger_row.model IS DISTINCT FROM COALESCE(row_value ->> 'provider_model', row_value ->> 'model')
      OR ledger_row.tokens_input IS DISTINCT FROM (row_value ->> 'input_tokens')::integer
      OR ledger_row.tokens_output IS DISTINCT FROM (row_value ->> 'output_tokens')::integer
      OR ledger_row.cost_usd IS DISTINCT FROM (row_value ->> 'estimated_cost_usd')::numeric
      OR ledger_row.metadata IS DISTINCT FROM expected_ledger_metadata
      OR ledger_row.created_at IS DISTINCT FROM (row_value ->> 'attempted_at')::timestamptz
    THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LEDGER_CONFLICT' USING ERRCODE = '23505';
    END IF;
    ledger_initial_row_sha256_value := encode(extensions.digest(
      convert_to(to_jsonb(ledger_row)::text, 'UTF8'), 'sha256'
    ), 'hex');
    INSERT INTO public.vendor_disclosure_ingest_owned_ledger_rows (
      run_sha256, batch_index, ledger_id, initial_row_sha256,
      created_by_run, cleanup_status
    ) VALUES (
      p_run_sha256, p_batch_index, ledger_uuid_value, ledger_initial_row_sha256_value,
      affected_rows = 1, CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
    ) ON CONFLICT (run_sha256, ledger_id) DO NOTHING;
    IF NOT EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_owned_ledger_rows AS owned
      WHERE owned.run_sha256 = p_run_sha256
        AND owned.batch_index = p_batch_index
        AND owned.ledger_id = ledger_uuid_value
        AND owned.initial_row_sha256 = ledger_initial_row_sha256_value
        AND owned.created_by_run = (affected_rows = 1)
        AND owned.cleanup_status = CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_LEDGER_OWNERSHIP_CONFLICT' USING ERRCODE = '23505';
    END IF;
    logged_ids_value := array_append(logged_ids_value, ledger_id_value);
  END LOOP;

  FOR row_value IN
    SELECT unit.value FROM jsonb_array_elements(p_payload -> 'units') AS unit(value)
  LOOP
    provider_mode_value := 'unproven';
    paid_plan_sha256_value := NULL;
    successful_ledger_id_value := NULL;
    provider_model_value := NULL;
    request_hash_value := NULL;
    source_fingerprint_value := NULL;
    conversion_fingerprint_value := NULL;
    extraction_fingerprint_value := NULL;
    validation_fingerprint_value := NULL;
    unit_payload_sha256_value := public.vendor_disclosure_unit_payload_sha256(
      p_payload,
      row_value ->> 'unit_id'
    );
    paid_attestation_sha256_value := NULL;
    paid_success_count := 0;

    IF p_authorization_kind = 'local_validated_pending_only'
      OR COALESCE(
      row_value -> 'validation_issue_codes' @> '["local_deterministic_review_only"]'::jsonb,
      false
    ) THEN
      provider_mode_value := 'local_deterministic';
    ELSE
      SELECT count(*)::integer
      INTO paid_success_count
      FROM public.vendor_disclosure_ingest_owned_ledger_rows AS owned_ledger
      JOIN public.ai_interactions_log AS ledger ON ledger.id = owned_ledger.ledger_id
      JOIN public.vendor_disclosure_paid_extraction_attestations AS attestation
        ON attestation.run_sha256 = owned_ledger.run_sha256
        AND attestation.batch_index = owned_ledger.batch_index
        AND attestation.ledger_id = owned_ledger.ledger_id
      WHERE owned_ledger.run_sha256 = p_run_sha256
        AND owned_ledger.batch_index = p_batch_index
        AND owned_ledger.created_by_run = true
        AND owned_ledger.cleanup_status = 'owned'
        AND (
          SELECT count(*)
          FROM public.vendor_disclosure_ingest_owned_ledger_rows AS any_owner
          WHERE any_owner.ledger_id = owned_ledger.ledger_id
        ) = 1
        AND ledger.session_id = 'disclosure_ingest'
        AND ledger.interaction_type = 'disclosure_extraction'
        AND ledger.tool_name = 'disclosure_extraction'
        AND ledger.success = true
        AND ledger.error_message IS NULL
        AND ledger.metadata ->> 'source' = 'local_disclosure_ingest'
        AND ledger.metadata ->> 'unit_id' = row_value ->> 'unit_id'
        AND ledger.metadata ->> 'ledger_schema_version' = '3'
        AND ledger.metadata ->> 'provider_mode' = 'production_paid'
        AND COALESCE(ledger.metadata ->> 'paid_plan_sha256', '') ~ '^[0-9a-f]{64}$'
        AND NULLIF(btrim(ledger.metadata ->> 'provider_model'), '') IS NOT NULL
        AND ledger.model = ledger.metadata ->> 'provider_model'
        AND attestation.unit_id = row_value ->> 'unit_id'
        AND attestation.request_hash = ledger.metadata ->> 'request_hash'
        AND attestation.extraction_fingerprint = ledger.metadata ->> 'fingerprint'
        AND attestation.paid_plan_sha256 = ledger.metadata ->> 'paid_plan_sha256'
        AND attestation.provider_model = ledger.metadata ->> 'provider_model'
        AND attestation.source_fingerprint = row_value ->> 'source_fingerprint'
        AND attestation.conversion_fingerprint = row_value ->> 'conversion_fingerprint'
        AND attestation.extraction_fingerprint = row_value ->> 'extraction_fingerprint'
        AND attestation.validation_fingerprint = row_value ->> 'validation_fingerprint'
        AND attestation.full_plan_sha256 = p_full_plan_sha256
        AND attestation.batch_plan_sha256 = p_batch_plan_sha256
        AND attestation.batch_sha256 = p_batch_sha256
        AND attestation.payload_sha256 = payload_sha256_value
        AND attestation.unit_payload_sha256 = unit_payload_sha256_value;

      IF paid_success_count = 1 THEN
        SELECT ledger.id, attestation.paid_plan_sha256,
          attestation.provider_model, attestation.request_hash,
          attestation.source_fingerprint, attestation.conversion_fingerprint,
          attestation.extraction_fingerprint, attestation.validation_fingerprint,
          attestation.attestation_sha256
        INTO successful_ledger_id_value, paid_plan_sha256_value, provider_model_value,
          request_hash_value, source_fingerprint_value, conversion_fingerprint_value,
          extraction_fingerprint_value, validation_fingerprint_value,
          paid_attestation_sha256_value
        FROM public.vendor_disclosure_ingest_owned_ledger_rows AS owned_ledger
        JOIN public.ai_interactions_log AS ledger ON ledger.id = owned_ledger.ledger_id
        JOIN public.vendor_disclosure_paid_extraction_attestations AS attestation
          ON attestation.run_sha256 = owned_ledger.run_sha256
          AND attestation.batch_index = owned_ledger.batch_index
          AND attestation.ledger_id = owned_ledger.ledger_id
        WHERE owned_ledger.run_sha256 = p_run_sha256
          AND owned_ledger.batch_index = p_batch_index
          AND owned_ledger.created_by_run = true
          AND owned_ledger.cleanup_status = 'owned'
          AND (
            SELECT count(*)
            FROM public.vendor_disclosure_ingest_owned_ledger_rows AS any_owner
            WHERE any_owner.ledger_id = owned_ledger.ledger_id
          ) = 1
          AND ledger.session_id = 'disclosure_ingest'
          AND ledger.interaction_type = 'disclosure_extraction'
          AND ledger.tool_name = 'disclosure_extraction'
          AND ledger.success = true
          AND ledger.error_message IS NULL
          AND ledger.metadata ->> 'source' = 'local_disclosure_ingest'
          AND ledger.metadata ->> 'unit_id' = row_value ->> 'unit_id'
          AND ledger.metadata ->> 'ledger_schema_version' = '3'
          AND ledger.metadata ->> 'provider_mode' = 'production_paid'
          AND COALESCE(ledger.metadata ->> 'paid_plan_sha256', '') ~ '^[0-9a-f]{64}$'
          AND NULLIF(btrim(ledger.metadata ->> 'provider_model'), '') IS NOT NULL
          AND ledger.model = ledger.metadata ->> 'provider_model'
          AND attestation.unit_id = row_value ->> 'unit_id'
          AND attestation.request_hash = ledger.metadata ->> 'request_hash'
          AND attestation.extraction_fingerprint = ledger.metadata ->> 'fingerprint'
          AND attestation.paid_plan_sha256 = ledger.metadata ->> 'paid_plan_sha256'
          AND attestation.provider_model = ledger.metadata ->> 'provider_model'
          AND attestation.source_fingerprint = row_value ->> 'source_fingerprint'
          AND attestation.conversion_fingerprint = row_value ->> 'conversion_fingerprint'
          AND attestation.extraction_fingerprint = row_value ->> 'extraction_fingerprint'
          AND attestation.validation_fingerprint = row_value ->> 'validation_fingerprint'
          AND attestation.full_plan_sha256 = p_full_plan_sha256
          AND attestation.batch_plan_sha256 = p_batch_plan_sha256
          AND attestation.batch_sha256 = p_batch_sha256
          AND attestation.payload_sha256 = payload_sha256_value
          AND attestation.unit_payload_sha256 = unit_payload_sha256_value;
        provider_mode_value := 'production_paid';
      END IF;
    END IF;

    provider_lineage_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', p_run_sha256,
      'batch_index', p_batch_index,
      'unit_id', row_value ->> 'unit_id',
      'provider_mode', provider_mode_value,
      'paid_plan_sha256', paid_plan_sha256_value,
      'successful_ledger_id', successful_ledger_id_value,
      'provider_model', provider_model_value,
      'request_hash', request_hash_value,
      'source_fingerprint', source_fingerprint_value,
      'conversion_fingerprint', conversion_fingerprint_value,
      'extraction_fingerprint', extraction_fingerprint_value,
      'validation_fingerprint', validation_fingerprint_value,
      'paid_attestation_sha256', paid_attestation_sha256_value,
      'bulk_approval_eligible', provider_mode_value = 'production_paid'
    )::text, 'UTF8'), 'sha256'), 'hex');

    INSERT INTO public.vendor_disclosure_ingest_unit_provider_lineage (
      run_sha256, batch_index, unit_id, provider_mode, paid_plan_sha256,
      successful_ledger_id, provider_model, request_hash, source_fingerprint,
      conversion_fingerprint, extraction_fingerprint, validation_fingerprint,
      paid_attestation_sha256, bulk_approval_eligible, lineage_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', provider_mode_value,
      paid_plan_sha256_value, successful_ledger_id_value, provider_model_value,
      request_hash_value, source_fingerprint_value, conversion_fingerprint_value,
      extraction_fingerprint_value, validation_fingerprint_value,
      paid_attestation_sha256_value,
      provider_mode_value = 'production_paid', provider_lineage_sha256_value
    );
  END LOOP;

  -- All following pending KCA inserts are guarded by table triggers. Keep the
  -- marker transaction-local so it cannot leak through a pooled connection.
  PERFORM set_config(
    'app.vendor_disclosure_atomic_run_sha256',
    p_run_sha256,
    true
  );

  FOR row_value IN SELECT package.value FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
  LOOP
    agency_id_value := public.ensure_vendor_disclosure_agency_pending(
      p_run_sha256,
      p_batch_index,
      row_value ->> 'agency_name',
      row_value ->> 'agency_normalized_name',
      row_value ->> 'agency_corporate_name',
      row_value ->> 'region_code',
      row_value ->> 'source_file'
    );
    IF EXISTS (
      SELECT 1 FROM public.official_agency_packages AS package
      WHERE package.snapshot_id = snapshot_row.id
        AND package.agency_id = agency_id_value
        AND package.package_name = row_value ->> 'package_name'
        AND package.source_file = row_value ->> 'source_file'
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_PACKAGE_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.official_agency_packages (
      snapshot_id, agency_id, package_name, category_scope,
      price_min_krw, price_max_krw, vat_note, price_note, options,
      review_status, needs_review, validation_issue_codes, source_file,
      source_object_keys, source_preview_keys, source_quote, confidence,
      edited_by_admin
    ) VALUES (
      snapshot_row.id,
      agency_id_value,
      row_value ->> 'package_name',
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'category_scope')),
      (row_value ->> 'price_min_krw')::integer,
      (row_value ->> 'price_max_krw')::integer,
      row_value ->> 'vat_note',
      row_value ->> 'price_note',
      row_value -> 'options',
      'pending', (row_value ->> 'needs_review')::boolean,
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
      row_value ->> 'source_file',
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_object_keys')),
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_preview_keys')),
      row_value ->> 'source_quote',
      (row_value ->> 'confidence')::numeric,
      false
    ) RETURNING id INTO package_id_value;
    INSERT INTO public.vendor_disclosure_ingest_owned_rows (
      run_sha256, batch_index, unit_id, row_kind, row_id
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'agency_package', package_id_value
    );
    record_ref_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'unit_id', row_value ->> 'unit_id',
      'package_name', row_value -> 'package_name',
      'source_file', row_value -> 'source_file',
      'source_quote', row_value -> 'source_quote'
    )::text, 'UTF8'), 'sha256'), 'hex');
    record_binding_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', p_run_sha256,
      'batch_index', p_batch_index,
      'unit_id', row_value ->> 'unit_id',
      'row_kind', 'agency_package',
      'row_id', package_id_value,
      'record_ref', record_ref_value,
      'vendor_id', NULL,
      'agency_id', agency_id_value,
      'linked_official_price_id', NULL
    )::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.vendor_disclosure_ingest_record_bindings (
      run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
      vendor_id, agency_id, linked_official_price_id, binding_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'agency_package',
      package_id_value, record_ref_value, NULL, agency_id_value, NULL,
      record_binding_sha256_value
    );
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, record_ref, agency_id
    ) VALUES (
      p_run_sha256, row_value ->> 'unit_id', 'agency', '', agency_id_value
    ) ON CONFLICT DO NOTHING;
    staged_count := staged_count + 1;
    IF (row_value ->> 'needs_review')::boolean THEN
      review_count := review_count + 1;
    END IF;
  END LOOP;

  FOR row_value IN SELECT price.value FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
  LOOP
    vendor_id_value := public.ensure_vendor_disclosure_vendor_pending(
      p_run_sha256,
      p_batch_index,
      row_value ->> 'vendor_name',
      row_value ->> 'category',
      row_value ->> 'region_code'
    );
    agency_id_value := NULL;
    agency_value := row_value -> 'source_agency';
    IF agency_value IS NOT NULL AND jsonb_typeof(agency_value) = 'object' THEN
      agency_id_value := public.ensure_vendor_disclosure_agency_pending(
        p_run_sha256,
        p_batch_index,
        agency_value ->> 'name',
        agency_value ->> 'normalized_name',
        agency_value ->> 'corporate_name',
        agency_value ->> 'region_code',
        agency_value ->> 'source_file'
      );
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.official_prices AS price
      WHERE price.snapshot_id = snapshot_row.id
        AND price.source_record_key = row_value ->> 'source_record_key'
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_PRICE_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.official_prices (
      snapshot_id, vendor_id, agency_id, category, item_name, base_spec,
      price_min_krw, price_max_krw, vat_note, price_note, review_status,
      needs_review, validation_issue_codes, source_file, source_object_keys,
      source_preview_keys, source_quote, confidence, source_record_key,
      edited_by_admin
    ) VALUES (
      snapshot_row.id, vendor_id_value, agency_id_value,
      row_value ->> 'category', row_value ->> 'item_name', row_value ->> 'base_spec',
      (row_value ->> 'price_min_krw')::integer,
      (row_value ->> 'price_max_krw')::integer,
      row_value ->> 'vat_note', row_value ->> 'price_note', 'pending',
      (row_value ->> 'needs_review')::boolean,
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
      row_value ->> 'source_file',
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_object_keys')),
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_preview_keys')),
      row_value ->> 'source_quote',
      (row_value ->> 'confidence')::numeric,
      row_value ->> 'source_record_key', false
    ) RETURNING id INTO official_price_id_value;
    INSERT INTO public.vendor_disclosure_ingest_owned_rows (
      run_sha256, batch_index, unit_id, row_kind, row_id
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'official_price', official_price_id_value
    );
    FOR option_value IN SELECT option_row.value FROM jsonb_array_elements(row_value -> 'options') AS option_row(value)
    LOOP
      INSERT INTO public.official_price_options (
        official_price_id, name, price_min_krw, price_max_krw, unit,
        condition, raw_text, source_file, source_quote, source_object_keys,
        confidence
      ) VALUES (
        official_price_id_value,
        option_value ->> 'name',
        (option_value ->> 'price_min_krw')::integer,
        (option_value ->> 'price_max_krw')::integer,
        option_value ->> 'unit',
        option_value ->> 'condition',
        option_value ->> 'raw_text',
        option_value ->> 'source_file',
        option_value ->> 'source_quote',
        ARRAY(SELECT jsonb_array_elements_text(option_value -> 'source_object_keys')),
        (option_value ->> 'confidence')::numeric
      );
    END LOOP;
    FOR alias_value IN SELECT alias.value FROM jsonb_array_elements_text(row_value -> 'alias_proposals') AS alias(value)
    LOOP
      INSERT INTO public.vendor_alias_proposals (
        official_price_id, vendor_id, alias, normalized_alias, status
      ) VALUES (
        official_price_id_value, vendor_id_value, btrim(alias_value),
        public.normalize_price_vendor_name(alias_value), 'pending'
      ) ON CONFLICT (official_price_id, normalized_alias) DO NOTHING;
    END LOOP;
    partner_ref_value := NULLIF(row_value ->> 'partner_record_ref', '');
    INSERT INTO public.vendor_disclosure_ingest_identity_links (
      run_sha256, unit_id, identity_kind, record_ref, vendor_id, official_price_id
    ) VALUES (
      p_run_sha256, row_value ->> 'unit_id', 'vendor',
      COALESCE(partner_ref_value, row_value ->> 'source_record_key'),
      vendor_id_value, official_price_id_value
    );
    IF agency_id_value IS NOT NULL THEN
      INSERT INTO public.vendor_disclosure_ingest_identity_links (
        run_sha256, unit_id, identity_kind, record_ref, agency_id
      ) VALUES (
        p_run_sha256, row_value ->> 'unit_id', 'agency', '', agency_id_value
      ) ON CONFLICT DO NOTHING;
    END IF;
    record_ref_value := COALESCE(partner_ref_value, row_value ->> 'source_record_key');
    record_binding_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', p_run_sha256,
      'batch_index', p_batch_index,
      'unit_id', row_value ->> 'unit_id',
      'row_kind', 'official_price',
      'row_id', official_price_id_value,
      'record_ref', record_ref_value,
      'vendor_id', vendor_id_value,
      'agency_id', agency_id_value,
      'linked_official_price_id', NULL
    )::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.vendor_disclosure_ingest_record_bindings (
      run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
      vendor_id, agency_id, linked_official_price_id, binding_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'official_price',
      official_price_id_value, record_ref_value, vendor_id_value,
      agency_id_value, NULL, record_binding_sha256_value
    );
    staged_count := staged_count + 1;
    IF (row_value ->> 'needs_review')::boolean THEN
      review_count := review_count + 1;
    END IF;
  END LOOP;

  FOR row_value IN SELECT semantic.value FROM jsonb_array_elements(p_payload -> 'disclosure_semantics') AS semantic(value)
  LOOP
    vendor_id_value := NULL;
    official_price_id_value := NULL;
    partner_ref_value := NULLIF(row_value ->> 'partner_record_ref', '');
    IF row_value ->> 'record_kind' = 'vendor_policy' THEN
      SELECT link.vendor_id, link.official_price_id
      INTO vendor_id_value, official_price_id_value
      FROM public.vendor_disclosure_ingest_identity_links AS link
      WHERE link.run_sha256 = p_run_sha256
        AND link.unit_id = row_value ->> 'unit_id'
        AND link.identity_kind = 'vendor'
        AND link.record_ref = partner_ref_value;
      IF vendor_id_value IS NULL AND row_value ->> 'partner_link_status' = 'policy_only_pending_identity' THEN
        vendor_id_value := public.ensure_vendor_disclosure_vendor_pending(
          p_run_sha256,
          p_batch_index,
          row_value ->> 'subject_name',
          row_value ->> 'vendor_category',
          row_value ->> 'region_code'
        );
        INSERT INTO public.vendor_disclosure_ingest_identity_links (
          run_sha256, unit_id, identity_kind, record_ref, vendor_id, official_price_id
        ) VALUES (
          p_run_sha256, row_value ->> 'unit_id', 'vendor', partner_ref_value,
          vendor_id_value, NULL
        );
      END IF;
      IF vendor_id_value IS NULL
        OR (
          row_value ->> 'partner_link_status' = 'price_row_staged'
          AND official_price_id_value IS NULL
        )
      THEN
        RAISE EXCEPTION 'DISCLOSURE_ATOMIC_SEMANTIC_LINK_MISSING' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.disclosure_semantic_staging AS semantic
      WHERE semantic.snapshot_id = snapshot_row.id
        AND semantic.source_record_key = row_value ->> 'source_record_key'
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_PREEXISTING_SEMANTIC_REQUIRES_RECONCILIATION' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.disclosure_semantic_staging (
      snapshot_id, schema_version, unit_id, record_kind, semantic_type,
      subject_kind, subject_name, subject_normalized_name, vendor_category,
      region_code, title, content_verbatim, summary, partner_record_ref,
      partner_vendor_id, official_price_id, source_agency, partner_link_status,
      review_status, needs_review, validation_issue_codes, source_file_ids,
      source_file, source_object_keys, source_preview_keys, source_quote,
      source_fingerprint, validation_fingerprint, confidence,
      source_record_key, content_fingerprint
    ) VALUES (
      snapshot_row.id, 2,
      row_value ->> 'unit_id', row_value ->> 'record_kind', row_value ->> 'semantic_type',
      row_value ->> 'subject_kind', row_value ->> 'subject_name', row_value ->> 'subject_normalized_name',
      row_value ->> 'vendor_category', row_value ->> 'region_code', row_value ->> 'title',
      row_value ->> 'content_verbatim', row_value ->> 'summary', partner_ref_value,
      vendor_id_value, official_price_id_value,
      CASE
        WHEN jsonb_typeof(row_value -> 'source_agency') = 'object'
          THEN row_value -> 'source_agency'
        ELSE NULL
      END,
      row_value ->> 'partner_link_status', 'pending',
      (row_value ->> 'needs_review')::boolean,
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_file_ids')),
      row_value ->> 'source_file',
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_object_keys')),
      ARRAY(SELECT jsonb_array_elements_text(row_value -> 'source_preview_keys')),
      row_value ->> 'source_quote', row_value ->> 'source_fingerprint',
      row_value ->> 'validation_fingerprint', (row_value ->> 'confidence')::numeric,
      row_value ->> 'source_record_key', row_value ->> 'content_fingerprint'
    ) RETURNING id INTO semantic_id_value;
    INSERT INTO public.vendor_disclosure_ingest_owned_rows (
      run_sha256, batch_index, unit_id, row_kind, row_id
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'semantic', semantic_id_value
    );
    record_ref_value := COALESCE(partner_ref_value, row_value ->> 'source_record_key');
    record_binding_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'run_sha256', p_run_sha256,
      'batch_index', p_batch_index,
      'unit_id', row_value ->> 'unit_id',
      'row_kind', 'semantic',
      'row_id', semantic_id_value,
      'record_ref', record_ref_value,
      'vendor_id', vendor_id_value,
      'agency_id', NULL,
      'linked_official_price_id', official_price_id_value
    )::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.vendor_disclosure_ingest_record_bindings (
      run_sha256, batch_index, unit_id, row_kind, row_id, record_ref,
      vendor_id, agency_id, linked_official_price_id, binding_sha256
    ) VALUES (
      p_run_sha256, p_batch_index, row_value ->> 'unit_id', 'semantic',
      semantic_id_value, record_ref_value, vendor_id_value, NULL,
      official_price_id_value, record_binding_sha256_value
    );
    staged_count := staged_count + 1;
    IF (row_value ->> 'needs_review')::boolean THEN
      review_count := review_count + 1;
    END IF;
  END LOOP;

  receipt_sha256_value := encode(extensions.digest(convert_to(
    p_run_sha256 || chr(31) || p_batch_sha256 || chr(31)
      || payload_sha256_value || chr(31) || snapshot_row.id::text,
    'UTF8'
  ), 'sha256'), 'hex');
  INSERT INTO public.vendor_disclosure_ingest_batches (
    run_sha256, batch_index, batch_sha256, batch_plan_sha256,
    payload_sha256, batch_receipt_sha256, unit_ids, staged_record_count,
    needs_review_count, logged_ledger_ids
  ) VALUES (
    p_run_sha256, p_batch_index, p_batch_sha256, p_batch_plan_sha256,
    payload_sha256_value, receipt_sha256_value, unit_ids_value, staged_count,
    review_count, logged_ids_value
  ) ON CONFLICT (run_sha256, batch_index) DO NOTHING;
  UPDATE public.vendor_disclosure_ingest_runs
  SET completed_batch_count = completed_batch_count + 1,
      updated_at = now()
  WHERE run_sha256 = p_run_sha256;

  batch_receipt_sha256 := receipt_sha256_value;
  loaded_unit_ids := unit_ids_value;
  logged_ledger_ids := logged_ids_value;
  already_applied := false;
  RETURN NEXT;
END;
$stage_vendor_disclosure_batch_atomic$;

CREATE OR REPLACE FUNCTION public.verify_vendor_disclosure_batch_receipt_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_full_plan_sha256 text,
  p_batch_plan_sha256 text,
  p_batch_sha256 text,
  p_batch_index integer,
  p_batch_count integer,
  p_expected_receipt_sha256 text,
  p_unit_ids text[]
)
RETURNS TABLE (
  batch_receipt_sha256 text,
  loaded_unit_ids text[],
  logged_ledger_ids text[],
  already_applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $verify_vendor_disclosure_batch_receipt_atomic$
DECLARE
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  batch_row public.vendor_disclosure_ingest_batches%ROWTYPE;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_full_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_sha256 !~ '^[0-9a-f]{64}$'
    OR p_expected_receipt_sha256 !~ '^[0-9a-f]{64}$'
    OR p_batch_count NOT BETWEEN 1 AND 1000
    OR p_batch_index NOT BETWEEN 1 AND p_batch_count
    OR NOT public.vendor_disclosure_unit_ids_are_safe(p_unit_ids)
  THEN
    RAISE EXCEPTION 'DISCLOSURE_RECEIPT_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  SELECT run.* INTO run_row
  FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256
  FOR SHARE NOWAIT;
  SELECT batch.* INTO batch_row
  FROM public.vendor_disclosure_ingest_batches AS batch
  WHERE batch.run_sha256 = p_run_sha256 AND batch.batch_index = p_batch_index
  FOR SHARE NOWAIT;
  IF run_row.run_sha256 IS NULL OR batch_row.id IS NULL
    OR run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.full_plan_sha256 IS DISTINCT FROM p_full_plan_sha256
    OR run_row.batch_count IS DISTINCT FROM p_batch_count
    OR run_row.status NOT IN ('active', 'complete')
    OR run_row.completed_batch_count < p_batch_index
    OR batch_row.batch_plan_sha256 IS DISTINCT FROM p_batch_plan_sha256
    OR batch_row.batch_sha256 IS DISTINCT FROM p_batch_sha256
    OR batch_row.batch_receipt_sha256 IS DISTINCT FROM p_expected_receipt_sha256
    OR batch_row.unit_ids IS DISTINCT FROM p_unit_ids
  THEN
    RAISE EXCEPTION 'DISCLOSURE_RECEIPT_NOT_EXACT' USING ERRCODE = '23505';
  END IF;
  batch_receipt_sha256 := batch_row.batch_receipt_sha256;
  loaded_unit_ids := batch_row.unit_ids;
  logged_ledger_ids := batch_row.logged_ledger_ids;
  already_applied := true;
  RETURN NEXT;
END;
$verify_vendor_disclosure_batch_receipt_atomic$;

CREATE OR REPLACE FUNCTION public.finalize_vendor_disclosure_dedupe_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_full_plan_sha256 text,
  p_dedupe_candidates_sha256 text,
  p_completed_batch_sha256s text[],
  p_candidates jsonb
)
RETURNS TABLE (staged_candidate_count integer, already_finalized boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $finalize_vendor_disclosure_dedupe_atomic$
DECLARE
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  snapshot_row public.price_snapshots%ROWTYPE;
  expected_batch_sha256s text[];
  completed_unit_ids text[];
  payload_sha256_value text;
  candidate jsonb;
  left_ids uuid[];
  right_ids uuid[];
  left_id uuid;
  right_id uuid;
  affected_rows integer;
  staged_count integer := 0;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_full_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR p_dedupe_candidates_sha256 !~ '^[0-9a-f]{64}$'
    OR p_candidates IS NULL
    OR jsonb_typeof(p_candidates) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_candidates) > 10000
  THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  payload_sha256_value := encode(extensions.digest(convert_to(p_candidates::text, 'UTF8'), 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  SELECT run.* INTO run_row
  FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256
  FOR UPDATE NOWAIT;
  IF run_row.run_sha256 IS NULL
    OR run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.full_plan_sha256 IS DISTINCT FROM p_full_plan_sha256
    OR run_row.completed_batch_count IS DISTINCT FROM run_row.batch_count
  THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_RUN_INCOMPLETE_OR_CONFLICTED' USING ERRCODE = '55000';
  END IF;
  SELECT array_agg(batch.batch_sha256 ORDER BY batch.batch_index)
  INTO expected_batch_sha256s
  FROM public.vendor_disclosure_ingest_batches AS batch
  WHERE batch.run_sha256 = p_run_sha256;
  IF expected_batch_sha256s IS DISTINCT FROM p_completed_batch_sha256s THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_BATCH_CHAIN_CONFLICT' USING ERRCODE = '23505';
  END IF;
  SELECT array_agg(unit.unit_id ORDER BY batch.batch_index, unit.ordinality)
  INTO completed_unit_ids
  FROM public.vendor_disclosure_ingest_batches AS batch
  CROSS JOIN LATERAL unnest(batch.unit_ids) WITH ORDINALITY AS unit(unit_id, ordinality)
  WHERE batch.run_sha256 = p_run_sha256;
  IF run_row.authorization_kind = 'local_validated_pending_only'
    AND completed_unit_ids IS DISTINCT FROM run_row.local_pending_only_unit_ids
  THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_LOCAL_UNIT_SET_INCOMPLETE' USING ERRCODE = '23514';
  END IF;
  IF run_row.status = 'invalidated' THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_RUN_INVALIDATED' USING ERRCODE = '55000';
  ELSIF run_row.status = 'aborted' THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_RUN_ABORTED' USING ERRCODE = '55000';
  END IF;
  IF run_row.dedupe_finalized_at IS NOT NULL THEN
    IF run_row.dedupe_candidates_sha256 IS DISTINCT FROM p_dedupe_candidates_sha256
      OR run_row.dedupe_payload_sha256 IS DISTINCT FROM payload_sha256_value
    THEN
      RAISE EXCEPTION 'DISCLOSURE_DEDUPE_REPLAY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    staged_candidate_count := 0;
    already_finalized := true;
    RETURN NEXT;
    RETURN;
  END IF;
  IF run_row.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_RUN_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
  -- Existing candidate decisions lock candidate rows before parent entities.
  -- NOWAIT preserves that order without queuing a conflicting finalizer lock.
  LOCK TABLE public.vendor_dedupe_candidates, public.agency_dedupe_candidates
    IN EXCLUSIVE MODE NOWAIT;
  -- EXCLUSIVE conflicts with the ROW SHARE table lock taken by SELECT FOR
  -- UPDATE, so no dedupe transaction can hold an entity row and later wait on
  -- the snapshot while this finalizer waits on the same entity FK.
  LOCK TABLE public.vendors, public.agencies IN EXCLUSIVE MODE NOWAIT;
  SELECT snapshot.* INTO snapshot_row
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = run_row.snapshot_id
  FOR UPDATE NOWAIT;
  IF snapshot_row.published OR snapshot_row.is_current OR snapshot_row.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_DEDUPE_SNAPSHOT_NOT_DRAFT' USING ERRCODE = '55000';
  END IF;

  FOR candidate IN SELECT item.value FROM jsonb_array_elements(p_candidates) AS item(value)
  LOOP
    IF candidate ->> 'status' IS DISTINCT FROM 'pending'
      OR COALESCE(candidate ->> 'entity_kind', '') NOT IN ('vendor', 'agency')
      OR COALESCE(candidate ->> 'left_unit_id', '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(candidate ->> 'right_unit_id', '') !~ '^[0-9a-f]{64}$'
      OR NULLIF(btrim(candidate ->> 'reason'), '') IS NULL
      OR length(candidate ->> 'reason') > 1000
      OR (candidate ->> 'similarity')::numeric NOT BETWEEN 0 AND 1
    THEN
      RAISE EXCEPTION 'DISCLOSURE_DEDUPE_PENDING_ONLY' USING ERRCODE = '23514';
    END IF;
    IF candidate ->> 'entity_kind' = 'vendor' THEN
      SELECT array_agg(DISTINCT link.vendor_id ORDER BY link.vendor_id)
      INTO left_ids
      FROM public.vendor_disclosure_ingest_identity_links AS link
      WHERE link.run_sha256 = p_run_sha256
        AND link.unit_id = candidate ->> 'left_unit_id'
        AND link.identity_kind = 'vendor'
        AND (
          NOT (candidate ? 'left_record_ref')
          OR link.record_ref = candidate ->> 'left_record_ref'
        );
      SELECT array_agg(DISTINCT link.vendor_id ORDER BY link.vendor_id)
      INTO right_ids
      FROM public.vendor_disclosure_ingest_identity_links AS link
      WHERE link.run_sha256 = p_run_sha256
        AND link.unit_id = candidate ->> 'right_unit_id'
        AND link.identity_kind = 'vendor'
        AND (
          NOT (candidate ? 'right_record_ref')
          OR link.record_ref = candidate ->> 'right_record_ref'
        );
      IF cardinality(left_ids) IS DISTINCT FROM 1 OR cardinality(right_ids) IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'DISCLOSURE_DEDUPE_VENDOR_LINK_AMBIGUOUS' USING ERRCODE = '23514';
      END IF;
      left_id := LEAST(left_ids[1], right_ids[1]);
      right_id := GREATEST(left_ids[1], right_ids[1]);
      IF left_id <> right_id THEN
        INSERT INTO public.vendor_dedupe_candidates (
          left_vendor_id, right_vendor_id, reason, similarity, status
        ) VALUES (
          left_id, right_id, candidate ->> 'reason',
          (candidate ->> 'similarity')::numeric, 'pending'
        ) ON CONFLICT (left_vendor_id, right_vendor_id) DO NOTHING;
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows = 1 THEN
          staged_count := staged_count + 1;
        ELSIF NOT EXISTS (
          SELECT 1 FROM public.vendor_dedupe_candidates AS existing
          WHERE existing.left_vendor_id = left_id
            AND existing.right_vendor_id = right_id
            AND existing.reason IS NOT DISTINCT FROM candidate ->> 'reason'
            AND existing.similarity IS NOT DISTINCT FROM (candidate ->> 'similarity')::numeric
            AND existing.status = 'pending'
        ) THEN
          RAISE EXCEPTION 'DISCLOSURE_DEDUPE_VENDOR_CONFLICT' USING ERRCODE = '23505';
        END IF;
        INSERT INTO public.vendor_disclosure_ingest_dedupe_links (
          run_sha256, entity_kind, left_identity_id, right_identity_id,
          reason, similarity, created_by_run, initial_candidate_sha256,
          cleanup_status
        ) VALUES (
          p_run_sha256, 'vendor', left_id, right_id,
          candidate ->> 'reason', (candidate ->> 'similarity')::numeric,
          affected_rows = 1,
          encode(extensions.digest(convert_to(jsonb_build_object(
            'entity_kind', 'vendor', 'left_identity_id', left_id,
            'right_identity_id', right_id, 'reason', candidate ->> 'reason',
            'similarity', (candidate ->> 'similarity')::numeric,
            'status', 'pending'
          )::text, 'UTF8'), 'sha256'), 'hex'),
          CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
        );
      END IF;
    ELSE
      SELECT array_agg(DISTINCT link.agency_id ORDER BY link.agency_id)
      INTO left_ids
      FROM public.vendor_disclosure_ingest_identity_links AS link
      WHERE link.run_sha256 = p_run_sha256
        AND link.unit_id = candidate ->> 'left_unit_id'
        AND link.identity_kind = 'agency';
      SELECT array_agg(DISTINCT link.agency_id ORDER BY link.agency_id)
      INTO right_ids
      FROM public.vendor_disclosure_ingest_identity_links AS link
      WHERE link.run_sha256 = p_run_sha256
        AND link.unit_id = candidate ->> 'right_unit_id'
        AND link.identity_kind = 'agency';
      IF cardinality(left_ids) IS DISTINCT FROM 1 OR cardinality(right_ids) IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'DISCLOSURE_DEDUPE_AGENCY_LINK_AMBIGUOUS' USING ERRCODE = '23514';
      END IF;
      left_id := LEAST(left_ids[1], right_ids[1]);
      right_id := GREATEST(left_ids[1], right_ids[1]);
      IF left_id <> right_id THEN
        INSERT INTO public.agency_dedupe_candidates (
          left_agency_id, right_agency_id, reason, similarity, status
        ) VALUES (
          left_id, right_id, candidate ->> 'reason',
          (candidate ->> 'similarity')::numeric, 'pending'
        ) ON CONFLICT (left_agency_id, right_agency_id) DO NOTHING;
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows = 1 THEN
          staged_count := staged_count + 1;
        ELSIF NOT EXISTS (
          SELECT 1 FROM public.agency_dedupe_candidates AS existing
          WHERE existing.left_agency_id = left_id
            AND existing.right_agency_id = right_id
            AND existing.reason IS NOT DISTINCT FROM candidate ->> 'reason'
            AND existing.similarity IS NOT DISTINCT FROM (candidate ->> 'similarity')::numeric
            AND existing.status = 'pending'
        ) THEN
          RAISE EXCEPTION 'DISCLOSURE_DEDUPE_AGENCY_CONFLICT' USING ERRCODE = '23505';
        END IF;
        INSERT INTO public.vendor_disclosure_ingest_dedupe_links (
          run_sha256, entity_kind, left_identity_id, right_identity_id,
          reason, similarity, created_by_run, initial_candidate_sha256,
          cleanup_status
        ) VALUES (
          p_run_sha256, 'agency', left_id, right_id,
          candidate ->> 'reason', (candidate ->> 'similarity')::numeric,
          affected_rows = 1,
          encode(extensions.digest(convert_to(jsonb_build_object(
            'entity_kind', 'agency', 'left_identity_id', left_id,
            'right_identity_id', right_id, 'reason', candidate ->> 'reason',
            'similarity', (candidate ->> 'similarity')::numeric,
            'status', 'pending'
          )::text, 'UTF8'), 'sha256'), 'hex'),
          CASE WHEN affected_rows = 1 THEN 'owned' ELSE 'reused' END
        );
      END IF;
    END IF;
  END LOOP;
  UPDATE public.vendor_disclosure_ingest_runs
  SET dedupe_candidates_sha256 = p_dedupe_candidates_sha256,
      dedupe_payload_sha256 = payload_sha256_value,
      dedupe_finalized_at = now(),
      status = 'complete',
      updated_at = now()
  WHERE run_sha256 = p_run_sha256;
  staged_candidate_count := staged_count;
  already_finalized := false;
  RETURN NEXT;
END;
$finalize_vendor_disclosure_dedupe_atomic$;

-- A completed draft run can be quarantined without deleting audit evidence.
-- This is deliberately narrower than abort: only a never-published run whose
-- owned rows are still in their untouched pending state can be invalidated.
-- Preview and approval readers require status = 'complete', so the status
-- transition atomically removes the entire run from both surfaces.
CREATE OR REPLACE FUNCTION public.invalidate_vendor_disclosure_completed_run_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_full_plan_sha256 text,
  p_reason text
)
RETURNS TABLE (
  invalidated boolean,
  already_invalidated boolean,
  invalidation_receipt_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $invalidate_vendor_disclosure_completed_run_atomic$
DECLARE
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  snapshot_row public.price_snapshots%ROWTYPE;
  receipt_sha256_value text;
  cleanup_manifest_sha256_value text;
  affected_rows integer;
  expected_package_count integer;
  expected_price_count integer;
  expected_semantic_count integer;
  deleted_package_count integer;
  deleted_price_count integer;
  deleted_semantic_count integer;
BEGIN
  invalidated := false;
  already_invalidated := false;
  invalidation_receipt_sha256 := NULL;
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_full_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR NULLIF(btrim(p_reason), '') IS NULL
    OR length(p_reason) > 500
  THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;

  -- Serialize with both human approval and snapshot publication before
  -- taking the per-run lock. The same order is used by approval/promotion.
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-bulk-approval-v1', 0));
  PERFORM pg_advisory_xact_lock(20260718, 20300);
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  SELECT run.* INTO run_row
  FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256
  FOR UPDATE;
  IF run_row.run_sha256 IS NULL
    OR run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.full_plan_sha256 IS DISTINCT FROM p_full_plan_sha256
  THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_RUN_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF run_row.status = 'invalidated' THEN
    IF run_row.invalidation_reason IS DISTINCT FROM btrim(p_reason)
      OR run_row.invalidation_receipt_sha256 IS NULL
    THEN
      RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_REPLAY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    already_invalidated := true;
    invalidation_receipt_sha256 := run_row.invalidation_receipt_sha256;
    RETURN NEXT;
    RETURN;
  END IF;
  IF run_row.status IS DISTINCT FROM 'complete'
    OR run_row.completed_batch_count IS DISTINCT FROM run_row.batch_count
    OR run_row.dedupe_finalized_at IS NULL
    OR run_row.dedupe_candidates_sha256 IS NULL
    OR run_row.dedupe_payload_sha256 IS NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_COMPLETED_RUN_REQUIRED' USING ERRCODE = '55000';
  END IF;

  LOCK TABLE public.vendor_disclosure_ingest_owned_rows,
    public.vendor_disclosure_ingest_identity_links,
    public.vendor_disclosure_ingest_owned_identities,
    public.vendor_disclosure_ingest_owned_ledger_rows,
    public.vendor_disclosure_ingest_dedupe_links,
    public.vendor_dedupe_candidates, public.agency_dedupe_candidates,
    public.vendor_alias_proposals, public.official_price_options,
    public.official_agency_packages, public.official_prices,
    public.disclosure_semantic_staging
    IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.official_review_events, public.price_snapshots
    IN SHARE MODE NOWAIT;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_rows AS owned
  JOIN public.official_agency_packages AS package ON package.id = owned.row_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'agency_package'
  ORDER BY package.id FOR UPDATE OF package;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_rows AS owned
  JOIN public.official_prices AS price ON price.id = owned.row_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'official_price'
  ORDER BY price.id FOR UPDATE OF price;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_rows AS owned
  JOIN public.disclosure_semantic_staging AS semantic ON semantic.id = owned.row_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'semantic'
  ORDER BY semantic.id FOR UPDATE OF semantic;
  SELECT snapshot.* INTO snapshot_row
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = run_row.snapshot_id
  FOR UPDATE NOWAIT;
  IF snapshot_row.id IS NULL
    OR snapshot_row.source IS DISTINCT FROM run_row.snapshot_source
    OR snapshot_row.period_label IS DISTINCT FROM run_row.snapshot_period
    OR snapshot_row.published OR snapshot_row.is_current
    OR snapshot_row.published_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_SNAPSHOT_NOT_DRAFT' USING ERRCODE = '55000';
  END IF;

  -- Missing or reassigned owned rows are not equivalent to pending rows.
  IF EXISTS (
    SELECT 1
    FROM public.vendor_disclosure_ingest_owned_rows AS owned
    LEFT JOIN public.official_agency_packages AS package
      ON owned.row_kind = 'agency_package' AND package.id = owned.row_id
    LEFT JOIN public.official_prices AS price
      ON owned.row_kind = 'official_price' AND price.id = owned.row_id
    LEFT JOIN public.disclosure_semantic_staging AS semantic
      ON owned.row_kind = 'semantic' AND semantic.id = owned.row_id
    WHERE owned.run_sha256 = p_run_sha256
      AND CASE owned.row_kind
        WHEN 'agency_package' THEN package.id IS NULL OR package.snapshot_id <> run_row.snapshot_id
        WHEN 'official_price' THEN price.id IS NULL OR price.snapshot_id <> run_row.snapshot_id
        WHEN 'semantic' THEN semantic.id IS NULL OR semantic.snapshot_id <> run_row.snapshot_id
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_OWNED_ROW_CONFLICT' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.vendor_disclosure_ingest_owned_rows AS owned
    JOIN public.official_agency_packages AS package ON package.id = owned.row_id
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'agency_package'
      AND (package.review_status <> 'pending' OR package.edited_by_admin
        OR package.reviewed_by IS NOT NULL OR package.reviewed_at IS NOT NULL
        OR package.review_action IS NOT NULL OR package.review_version <> 0)
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_disclosure_ingest_owned_rows AS owned
    JOIN public.official_prices AS price ON price.id = owned.row_id
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'official_price'
      AND (price.review_status <> 'pending' OR price.edited_by_admin
        OR price.reviewed_by IS NOT NULL OR price.reviewed_at IS NOT NULL
        OR price.review_action IS NOT NULL OR price.review_version <> 0)
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_disclosure_ingest_owned_rows AS owned
    JOIN public.disclosure_semantic_staging AS semantic ON semantic.id = owned.row_id
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'semantic'
      AND semantic.review_status <> 'pending'
  ) OR EXISTS (
    SELECT 1
    FROM public.vendor_disclosure_ingest_owned_rows AS owned
    JOIN public.official_review_events AS review_event
      ON review_event.entity_id = owned.row_id
      AND review_event.entity_kind = CASE owned.row_kind
        WHEN 'official_price' THEN 'price'
        WHEN 'agency_package' THEN 'agency_package'
        ELSE ''
      END
    WHERE owned.run_sha256 = p_run_sha256
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_REVIEWED_OR_EDITED_ROWS_FORBIDDEN' USING ERRCODE = '55000';
  END IF;

  -- A dedupe decision is human state just like a price review. Only the exact
  -- pending candidate introduced by this run can be cleaned up; reused,
  -- shared, missing, or changed queue rows are retained/fail closed.
  IF EXISTS (
    SELECT 1
    FROM public.vendor_disclosure_ingest_dedupe_links AS link
    WHERE link.run_sha256 = p_run_sha256
      AND link.created_by_run AND link.cleanup_status = 'owned'
      AND CASE link.entity_kind
        WHEN 'vendor' THEN NOT EXISTS (
          SELECT 1 FROM public.vendor_dedupe_candidates AS candidate
          WHERE candidate.left_vendor_id = link.left_identity_id
            AND candidate.right_vendor_id = link.right_identity_id
            AND candidate.reason IS NOT DISTINCT FROM link.reason
            AND candidate.similarity IS NOT DISTINCT FROM link.similarity
            AND candidate.status = 'pending'
        )
        WHEN 'agency' THEN NOT EXISTS (
          SELECT 1 FROM public.agency_dedupe_candidates AS candidate
          WHERE candidate.left_agency_id = link.left_identity_id
            AND candidate.right_agency_id = link.right_identity_id
            AND candidate.reason IS NOT DISTINCT FROM link.reason
            AND candidate.similarity IS NOT DISTINCT FROM link.similarity
            AND candidate.status = 'pending'
        )
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_DEDUPE_CANDIDATE_TOUCHED'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    count(*) FILTER (WHERE row_kind = 'agency_package')::integer,
    count(*) FILTER (WHERE row_kind = 'official_price')::integer,
    count(*) FILTER (WHERE row_kind = 'semantic')::integer
  INTO expected_package_count, expected_price_count, expected_semantic_count
  FROM public.vendor_disclosure_ingest_owned_rows
  WHERE run_sha256 = p_run_sha256;

  -- Immutable record bindings retain the original price UUID after the
  -- mutable identity link is tombstoned. Hash the complete cleanup input into
  -- the invalidation receipt so later audits can prove exactly what was
  -- superseded without keeping stale rows on the corrected snapshot.
  cleanup_manifest_sha256_value := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'owned_rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'batch_index', owned.batch_index, 'unit_id', owned.unit_id,
          'row_kind', owned.row_kind, 'row_id', owned.row_id
        ) ORDER BY owned.batch_index, owned.unit_id, owned.row_kind, owned.row_id)
        FROM public.vendor_disclosure_ingest_owned_rows AS owned
        WHERE owned.run_sha256 = p_run_sha256
      ), '[]'::jsonb),
      'record_bindings', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'batch_index', binding.batch_index, 'unit_id', binding.unit_id,
          'row_kind', binding.row_kind, 'row_id', binding.row_id,
          'record_ref', binding.record_ref, 'binding_sha256', binding.binding_sha256
        ) ORDER BY binding.batch_index, binding.unit_id, binding.row_kind, binding.row_id)
        FROM public.vendor_disclosure_ingest_record_bindings AS binding
        WHERE binding.run_sha256 = p_run_sha256
      ), '[]'::jsonb),
      'dedupe_links', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'entity_kind', link.entity_kind,
          'left_identity_id', link.left_identity_id,
          'right_identity_id', link.right_identity_id,
          'initial_candidate_sha256', link.initial_candidate_sha256,
          'created_by_run', link.created_by_run
        ) ORDER BY link.entity_kind, link.left_identity_id, link.right_identity_id)
        FROM public.vendor_disclosure_ingest_dedupe_links AS link
        WHERE link.run_sha256 = p_run_sha256
      ), '[]'::jsonb)
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- The marker is transaction-local and is only useful while this exact
  -- postgres-owned RPC remains on the trigger call stack. Both write guards
  -- also re-check complete-run ownership and the immutable snapshot binding,
  -- so a copied GUC cannot authorize a different function or row.
  PERFORM set_config(
    'app.vendor_disclosure_atomic_invalidate_run_sha256',
    p_run_sha256,
    true
  );

  -- Preserve identity-link audit while releasing the RESTRICT FK. The
  -- append-only record binding remains the authoritative original price link.
  UPDATE public.vendor_disclosure_ingest_identity_links
  SET official_price_id = NULL
  WHERE run_sha256 = p_run_sha256 AND official_price_id IS NOT NULL;

  DELETE FROM public.disclosure_semantic_staging AS semantic
  WHERE semantic.id IN (
    SELECT owned.row_id FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'semantic'
  );
  GET DIAGNOSTICS deleted_semantic_count = ROW_COUNT;
  DELETE FROM public.official_agency_packages AS package
  WHERE package.id IN (
    SELECT owned.row_id FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'agency_package'
  );
  GET DIAGNOSTICS deleted_package_count = ROW_COUNT;
  DELETE FROM public.official_prices AS price
  WHERE price.id IN (
    SELECT owned.row_id FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'official_price'
  );
  GET DIAGNOSTICS deleted_price_count = ROW_COUNT;
  IF deleted_package_count IS DISTINCT FROM expected_package_count
    OR deleted_price_count IS DISTINCT FROM expected_price_count
    OR deleted_semantic_count IS DISTINCT FROM expected_semantic_count
  THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_CLEANUP_COUNT_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.vendor_dedupe_candidates AS candidate
  USING public.vendor_disclosure_ingest_dedupe_links AS link
  WHERE link.run_sha256 = p_run_sha256
    AND link.entity_kind = 'vendor'
    AND link.created_by_run AND link.cleanup_status = 'owned'
    AND candidate.left_vendor_id = link.left_identity_id
    AND candidate.right_vendor_id = link.right_identity_id
    AND candidate.reason IS NOT DISTINCT FROM link.reason
    AND candidate.similarity IS NOT DISTINCT FROM link.similarity
    AND candidate.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_dedupe_links AS other_link
      JOIN public.vendor_disclosure_ingest_runs AS other_run
        ON other_run.run_sha256 = other_link.run_sha256
      WHERE other_link.run_sha256 <> p_run_sha256
        AND other_link.entity_kind = link.entity_kind
        AND other_link.left_identity_id = link.left_identity_id
        AND other_link.right_identity_id = link.right_identity_id
        AND other_run.status IN ('active', 'complete')
    );
  DELETE FROM public.agency_dedupe_candidates AS candidate
  USING public.vendor_disclosure_ingest_dedupe_links AS link
  WHERE link.run_sha256 = p_run_sha256
    AND link.entity_kind = 'agency'
    AND link.created_by_run AND link.cleanup_status = 'owned'
    AND candidate.left_agency_id = link.left_identity_id
    AND candidate.right_agency_id = link.right_identity_id
    AND candidate.reason IS NOT DISTINCT FROM link.reason
    AND candidate.similarity IS NOT DISTINCT FROM link.similarity
    AND candidate.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_dedupe_links AS other_link
      JOIN public.vendor_disclosure_ingest_runs AS other_run
        ON other_run.run_sha256 = other_link.run_sha256
      WHERE other_link.run_sha256 <> p_run_sha256
        AND other_link.entity_kind = link.entity_kind
        AND other_link.left_identity_id = link.left_identity_id
        AND other_link.right_identity_id = link.right_identity_id
        AND other_run.status IN ('active', 'complete')
    );
  UPDATE public.vendor_disclosure_ingest_dedupe_links AS link
  SET cleanup_status = CASE
    WHEN (link.entity_kind = 'vendor' AND NOT EXISTS (
      SELECT 1 FROM public.vendor_dedupe_candidates AS candidate
      WHERE candidate.left_vendor_id = link.left_identity_id
        AND candidate.right_vendor_id = link.right_identity_id
    )) OR (link.entity_kind = 'agency' AND NOT EXISTS (
      SELECT 1 FROM public.agency_dedupe_candidates AS candidate
      WHERE candidate.left_agency_id = link.left_identity_id
        AND candidate.right_agency_id = link.right_identity_id
    )) THEN 'deleted'
    ELSE 'retained_superseded'
  END
  WHERE link.run_sha256 = p_run_sha256
    AND link.created_by_run AND link.cleanup_status = 'owned';
  UPDATE public.vendor_disclosure_ingest_owned_identities
  SET cleanup_status = 'retained_superseded'
  WHERE run_sha256 = p_run_sha256 AND cleanup_status = 'owned';
  UPDATE public.vendor_disclosure_ingest_owned_ledger_rows
  SET cleanup_status = 'retained_superseded'
  WHERE run_sha256 = p_run_sha256
    AND created_by_run AND cleanup_status = 'owned';
  UPDATE public.vendor_disclosure_ingest_storage_links
  SET ownership_state = 'retained_shared'
  WHERE run_sha256 = p_run_sha256
    AND ownership_state IN (
      'confirmed_created', 'confirmed_preexisting', 'confirmed_inherited'
    );

  receipt_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
    'contract_version', 2,
    'target_project_ref', p_target_project_ref,
    'run_sha256', p_run_sha256,
    'full_plan_sha256', p_full_plan_sha256,
    'snapshot_id', run_row.snapshot_id,
    'cleanup_manifest_sha256', cleanup_manifest_sha256_value,
    'deleted_package_count', deleted_package_count,
    'deleted_price_count', deleted_price_count,
    'deleted_semantic_count', deleted_semantic_count,
    'reason', btrim(p_reason)
  )::text, 'UTF8'), 'sha256'), 'hex');
  UPDATE public.vendor_disclosure_ingest_runs
  SET status = 'invalidated', invalidated_at = now(),
      invalidation_reason = btrim(p_reason),
      invalidation_receipt_sha256 = receipt_sha256_value,
      updated_at = now()
  WHERE run_sha256 = p_run_sha256 AND status = 'complete';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'DISCLOSURE_INVALIDATE_STATUS_RACE' USING ERRCODE = '40001';
  END IF;
  invalidated := true;
  invalidation_receipt_sha256 := receipt_sha256_value;
  RETURN NEXT;
END;
$invalidate_vendor_disclosure_completed_run_atomic$;

CREATE OR REPLACE FUNCTION public.vendor_disclosure_identity_has_external_references(
  p_target_table regclass,
  p_identity_id uuid,
  p_excluded_tables regclass[] DEFAULT '{}'::regclass[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $vendor_disclosure_identity_has_external_references$
DECLARE
  foreign_key record;
  reference_exists boolean;
BEGIN
  IF p_target_table NOT IN ('public.vendors'::regclass, 'public.agencies'::regclass)
    OR p_identity_id IS NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_EXTERNAL_REFERENCE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  FOR foreign_key IN
    SELECT constraint_row.conrelid::regclass AS referencing_table,
      referencing_column.attname AS referencing_column
    FROM pg_constraint AS constraint_row
    JOIN pg_attribute AS referencing_column
      ON referencing_column.attrelid = constraint_row.conrelid
      AND referencing_column.attnum = constraint_row.conkey[1]
    JOIN pg_attribute AS referenced_column
      ON referenced_column.attrelid = constraint_row.confrelid
      AND referenced_column.attnum = constraint_row.confkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = p_target_table
      AND cardinality(constraint_row.conkey) = 1
      AND cardinality(constraint_row.confkey) = 1
      AND referenced_column.attname = 'id'
      AND constraint_row.conrelid::regclass <> ALL(COALESCE(p_excluded_tables, '{}'::regclass[]))
    ORDER BY constraint_row.conrelid::regclass::text, referencing_column.attname
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
      foreign_key.referencing_table,
      foreign_key.referencing_column
    ) INTO reference_exists USING p_identity_id;
    IF reference_exists THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$vendor_disclosure_identity_has_external_references$;

CREATE OR REPLACE FUNCTION public.abort_vendor_disclosure_ingest_run_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_full_plan_sha256 text,
  p_reason text
)
RETURNS TABLE (
  run_found boolean,
  deleted_package_count integer,
  deleted_price_count integer,
  deleted_semantic_count integer,
  deleted_vendor_count integer,
  deleted_agency_count integer,
  deleted_timeslot_count integer,
  deleted_ledger_count integer,
  retained_identity_count integer,
  retained_ledger_count integer,
  storage_rollback_objects jsonb,
  storage_object_outcomes jsonb,
  storage_rollback_receipt_sha256 text,
  already_aborted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $abort_vendor_disclosure_ingest_run_atomic$
DECLARE
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  snapshot_row public.price_snapshots%ROWTYPE;
  owned_identity record;
  owned_ledger record;
  current_row_sha256 text;
  owned_slot_count integer;
  current_slot_count integer;
  affected_rows integer;
  identity_status text;
  successor_run_sha256 text;
  storage_link record;
  rollback_receipt_sha256_value text;
BEGIN
  run_found := false;
  deleted_package_count := 0;
  deleted_price_count := 0;
  deleted_semantic_count := 0;
  deleted_vendor_count := 0;
  deleted_agency_count := 0;
  deleted_timeslot_count := 0;
  deleted_ledger_count := 0;
  retained_identity_count := 0;
  retained_ledger_count := 0;
  storage_rollback_objects := '[]'::jsonb;
  storage_object_outcomes := '[]'::jsonb;
  storage_rollback_receipt_sha256 := NULL;
  already_aborted := false;
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_full_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR NULLIF(btrim(p_reason), '') IS NULL
    OR length(p_reason) > 500
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ABORT_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  SELECT run.* INTO run_row
  FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256
  FOR UPDATE;
  IF run_row.run_sha256 IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;
  run_found := true;
  IF run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.full_plan_sha256 IS DISTINCT FROM p_full_plan_sha256
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ABORT_RUN_CONFLICT' USING ERRCODE = '23505';
  END IF;
  -- Prepared-but-unclaimed intents have no HTTP request that can still arrive.
  -- Abort owns the run advisory lock, reconciles those intents below, and only
  -- then completes. An active upload claim is different: its request may be in
  -- flight, so fail before any cleanup mutation.
  PERFORM public.assert_vendor_disclosure_storage_upload_claims_settled(p_run_sha256);
  IF run_row.status = 'aborted' THEN
    IF run_row.abort_reason IS DISTINCT FROM btrim(p_reason) THEN
      RAISE EXCEPTION 'DISCLOSURE_ABORT_REPLAY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'bucket', link.bucket_id, 'object_key', link.object_name,
      'sha256', link.object_sha256, 'bytes', link.object_bytes
    ) ORDER BY link.bucket_id, link.object_name), '[]'::jsonb)
    INTO storage_rollback_objects
    FROM public.vendor_disclosure_ingest_storage_links AS link
    WHERE link.run_sha256 = p_run_sha256 AND link.ownership_state = 'delete_authorized';
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'bucket', link.bucket_id, 'object_key', link.object_name,
      'sha256', link.object_sha256, 'bytes', link.object_bytes,
      'state', link.ownership_state
    ) ORDER BY link.bucket_id, link.object_name), '[]'::jsonb)
    INTO storage_object_outcomes
    FROM public.vendor_disclosure_ingest_storage_links AS link
    WHERE link.run_sha256 = p_run_sha256;
    storage_rollback_receipt_sha256 := run_row.storage_rollback_receipt_sha256;
    IF storage_rollback_receipt_sha256 IS NULL THEN
      RAISE EXCEPTION 'DISCLOSURE_ABORT_RECEIPT_MISSING' USING ERRCODE = '23514';
    END IF;
    already_aborted := true;
    RETURN NEXT;
    RETURN;
  END IF;
  IF run_row.status IS DISTINCT FROM 'active' OR run_row.dedupe_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'DISCLOSURE_ABORT_COMPLETED_RUN_FORBIDDEN' USING ERRCODE = '55000';
  END IF;
  -- Match the stage RPC's table-before-identity lock order. Without this,
  -- staging could hold the parent-table lock while waiting on an identity
  -- advisory lock held by abort, and abort could wait on the parent table.
  LOCK TABLE public.vendors, public.agencies IN EXCLUSIVE MODE NOWAIT;
  FOR storage_link IN
    SELECT link.bucket_id, link.object_name
    FROM public.vendor_disclosure_ingest_storage_links AS link
    WHERE link.run_sha256 = p_run_sha256
    ORDER BY link.bucket_id, link.object_name
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'vendor-disclosure-storage-v1:' || storage_link.bucket_id || ':' || storage_link.object_name,
      0
    ));
  END LOOP;
  FOR owned_identity IN
    SELECT identity.identity_kind, identity.identity_id
    FROM (
      SELECT link.identity_kind,
        CASE WHEN link.identity_kind = 'vendor' THEN link.vendor_id ELSE link.agency_id END AS identity_id
      FROM public.vendor_disclosure_ingest_identity_links AS link
      WHERE link.run_sha256 = p_run_sha256
      UNION
      SELECT owned.identity_kind, owned.identity_id
      FROM public.vendor_disclosure_ingest_owned_identities AS owned
      WHERE owned.run_sha256 = p_run_sha256
        AND owned.identity_kind IN ('vendor', 'agency')
    ) AS identity
    WHERE identity.identity_id IS NOT NULL
    ORDER BY identity.identity_kind, identity.identity_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'vendor-disclosure-identity-v1:' || owned_identity.identity_kind || ':'
        || owned_identity.identity_id::text,
      0
    ));
  END LOOP;

  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_rows AS owned
  JOIN public.official_agency_packages AS package ON package.id = owned.row_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'agency_package'
  ORDER BY package.id FOR UPDATE OF package;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_rows AS owned
  JOIN public.official_prices AS price ON price.id = owned.row_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'official_price'
  ORDER BY price.id FOR UPDATE OF price;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_rows AS owned
  JOIN public.disclosure_semantic_staging AS semantic ON semantic.id = owned.row_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'semantic'
  ORDER BY semantic.id FOR UPDATE OF semantic;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_ledger_rows AS owned
  JOIN public.ai_interactions_log AS ledger ON ledger.id = owned.ledger_id
  WHERE owned.run_sha256 = p_run_sha256
  ORDER BY ledger.id FOR UPDATE OF ledger;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_identities AS owned
  JOIN public.vendors AS vendor ON vendor.id = owned.identity_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.identity_kind = 'vendor'
  ORDER BY vendor.id FOR UPDATE OF vendor;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_identities AS owned
  JOIN public.agencies AS agency ON agency.id = owned.identity_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.identity_kind = 'agency'
  ORDER BY agency.id FOR UPDATE OF agency;
  PERFORM 1
  FROM public.vendor_disclosure_ingest_owned_identities AS owned
  JOIN public.vendor_timeslots AS slot ON slot.id = owned.identity_id
  WHERE owned.run_sha256 = p_run_sha256 AND owned.identity_kind = 'vendor_timeslot'
  ORDER BY slot.id FOR UPDATE OF slot;
  SELECT snapshot.* INTO snapshot_row
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = run_row.snapshot_id
  FOR UPDATE NOWAIT;
  IF snapshot_row.id IS NULL OR snapshot_row.published OR snapshot_row.is_current
    OR snapshot_row.published_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ABORT_SNAPSHOT_NOT_DRAFT' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vendor_disclosure_ingest_owned_rows AS owned
    JOIN public.official_agency_packages AS package ON package.id = owned.row_id
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'agency_package'
      AND (package.review_status <> 'pending' OR package.edited_by_admin
        OR package.reviewed_by IS NOT NULL OR package.reviewed_at IS NOT NULL
        OR package.review_action IS NOT NULL OR package.review_version <> 0)
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_disclosure_ingest_owned_rows AS owned
    JOIN public.official_prices AS price ON price.id = owned.row_id
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'official_price'
      AND (price.review_status <> 'pending' OR price.edited_by_admin
        OR price.reviewed_by IS NOT NULL OR price.reviewed_at IS NOT NULL
        OR price.review_action IS NOT NULL OR price.review_version <> 0)
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_disclosure_ingest_owned_rows AS owned
    JOIN public.disclosure_semantic_staging AS semantic ON semantic.id = owned.row_id
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'semantic'
      AND semantic.review_status <> 'pending'
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_ABORT_REVIEWED_OR_EDITED_ROWS_FORBIDDEN' USING ERRCODE = '55000';
  END IF;

  PERFORM set_config(
    'app.vendor_disclosure_atomic_abort_run_sha256',
    p_run_sha256,
    true
  );
  DELETE FROM public.vendor_disclosure_ingest_identity_links AS link
  WHERE link.run_sha256 = p_run_sha256;
  DELETE FROM public.disclosure_semantic_staging AS semantic
  WHERE semantic.id IN (
    SELECT owned.row_id FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'semantic'
  );
  GET DIAGNOSTICS deleted_semantic_count = ROW_COUNT;
  DELETE FROM public.official_agency_packages AS package
  WHERE package.id IN (
    SELECT owned.row_id FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'agency_package'
  );
  GET DIAGNOSTICS deleted_package_count = ROW_COUNT;
  DELETE FROM public.official_prices AS price
  WHERE price.id IN (
    SELECT owned.row_id FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.run_sha256 = p_run_sha256 AND owned.row_kind = 'official_price'
  );
  GET DIAGNOSTICS deleted_price_count = ROW_COUNT;
  PERFORM set_config(
    'app.vendor_disclosure_atomic_abort_run_sha256',
    '',
    true
  );
  DELETE FROM public.vendor_disclosure_ingest_owned_rows AS owned
  WHERE owned.run_sha256 = p_run_sha256;

  FOR owned_ledger IN
    SELECT owned.ledger_id, owned.initial_row_sha256, ledger.id AS current_id,
      CASE WHEN ledger.id IS NULL THEN NULL ELSE encode(extensions.digest(
        convert_to(to_jsonb(ledger)::text, 'UTF8'), 'sha256'
      ), 'hex') END AS current_sha256
    FROM public.vendor_disclosure_ingest_owned_ledger_rows AS owned
    LEFT JOIN public.ai_interactions_log AS ledger ON ledger.id = owned.ledger_id
    WHERE owned.run_sha256 = p_run_sha256
      AND owned.created_by_run
      AND owned.cleanup_status = 'owned'
    ORDER BY owned.ledger_id
  LOOP
    IF owned_ledger.current_id IS NULL THEN
      UPDATE public.vendor_disclosure_ingest_owned_ledger_rows
      SET cleanup_status = 'deleted'
      WHERE run_sha256 = p_run_sha256 AND ledger_id = owned_ledger.ledger_id;
    ELSIF EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_owned_ledger_rows AS other_owned
      JOIN public.vendor_disclosure_ingest_runs AS other_run
        ON other_run.run_sha256 = other_owned.run_sha256
      WHERE other_owned.ledger_id = owned_ledger.ledger_id
        AND other_owned.run_sha256 <> p_run_sha256
        AND other_run.status <> 'aborted'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_owned_ledger_rows AS complete_owned
        JOIN public.vendor_disclosure_ingest_runs AS complete_run
          ON complete_run.run_sha256 = complete_owned.run_sha256
        WHERE complete_owned.ledger_id = owned_ledger.ledger_id
          AND complete_owned.run_sha256 <> p_run_sha256
          AND complete_run.status = 'complete'
      ) THEN
        UPDATE public.vendor_disclosure_ingest_owned_ledger_rows AS successor
        SET created_by_run = true, cleanup_status = 'owned'
        WHERE successor.run_sha256 = (
          SELECT active_owned.run_sha256
          FROM public.vendor_disclosure_ingest_owned_ledger_rows AS active_owned
          JOIN public.vendor_disclosure_ingest_runs AS active_run
            ON active_run.run_sha256 = active_owned.run_sha256
          WHERE active_owned.ledger_id = owned_ledger.ledger_id
            AND active_owned.run_sha256 <> p_run_sha256
            AND active_run.status = 'active'
          ORDER BY active_owned.run_sha256
          LIMIT 1
        ) AND successor.ledger_id = owned_ledger.ledger_id
          AND NOT successor.created_by_run AND successor.cleanup_status = 'reused';
        GET DIAGNOSTICS affected_rows = ROW_COUNT;
        IF affected_rows <> 1 THEN
          RAISE EXCEPTION 'DISCLOSURE_ABORT_LEDGER_HANDOFF_RACE' USING ERRCODE = '40001';
        END IF;
      END IF;
      UPDATE public.vendor_disclosure_ingest_owned_ledger_rows
      SET cleanup_status = 'retained_shared'
      WHERE run_sha256 = p_run_sha256 AND ledger_id = owned_ledger.ledger_id;
      retained_ledger_count := retained_ledger_count + 1;
    ELSIF owned_ledger.current_sha256 IS DISTINCT FROM owned_ledger.initial_row_sha256 THEN
      UPDATE public.vendor_disclosure_ingest_owned_ledger_rows
      SET cleanup_status = 'retained_modified'
      WHERE run_sha256 = p_run_sha256 AND ledger_id = owned_ledger.ledger_id;
      retained_ledger_count := retained_ledger_count + 1;
    ELSE
      DELETE FROM public.ai_interactions_log WHERE id = owned_ledger.ledger_id;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION 'DISCLOSURE_ABORT_LEDGER_DELETE_RACE' USING ERRCODE = '40001';
      END IF;
      UPDATE public.vendor_disclosure_ingest_owned_ledger_rows
      SET cleanup_status = 'deleted'
      WHERE run_sha256 = p_run_sha256 AND ledger_id = owned_ledger.ledger_id;
      deleted_ledger_count := deleted_ledger_count + 1;
    END IF;
  END LOOP;

  FOR owned_identity IN
    SELECT owned.identity_id, owned.initial_row_sha256, vendor.id AS current_id,
      CASE WHEN vendor.id IS NULL THEN NULL ELSE encode(extensions.digest(
        convert_to(to_jsonb(vendor)::text, 'UTF8'), 'sha256'
      ), 'hex') END AS current_sha256
    FROM public.vendor_disclosure_ingest_owned_identities AS owned
    LEFT JOIN public.vendors AS vendor ON vendor.id = owned.identity_id
    WHERE owned.run_sha256 = p_run_sha256 AND owned.identity_kind = 'vendor'
      AND owned.cleanup_status = 'owned'
    ORDER BY owned.identity_id
  LOOP
    identity_status := NULL;
    IF owned_identity.current_id IS NULL THEN
      identity_status := 'deleted';
    ELSIF owned_identity.current_sha256 IS DISTINCT FROM owned_identity.initial_row_sha256 THEN
      identity_status := 'retained_modified';
    ELSE
      SELECT count(*) INTO owned_slot_count
      FROM public.vendor_disclosure_ingest_owned_identities AS owned
      WHERE owned.run_sha256 = p_run_sha256 AND owned.identity_kind = 'vendor_timeslot'
        AND owned.parent_vendor_id = owned_identity.identity_id;
      SELECT count(*) INTO current_slot_count
      FROM public.vendor_timeslots AS slot WHERE slot.vendor_id = owned_identity.identity_id;
      IF owned_slot_count <> 84 OR current_slot_count <> owned_slot_count OR EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_owned_identities AS owned
        LEFT JOIN public.vendor_timeslots AS slot ON slot.id = owned.identity_id
        WHERE owned.run_sha256 = p_run_sha256 AND owned.identity_kind = 'vendor_timeslot'
          AND owned.parent_vendor_id = owned_identity.identity_id
          AND (slot.id IS NULL OR encode(extensions.digest(
            convert_to(to_jsonb(slot)::text, 'UTF8'), 'sha256'
          ), 'hex') IS DISTINCT FROM owned.initial_row_sha256)
      ) THEN
        identity_status := 'retained_modified';
      ELSIF public.vendor_disclosure_identity_has_external_references(
        'public.vendors'::regclass, owned_identity.identity_id,
        ARRAY['public.vendor_timeslots'::regclass]
      ) THEN
        identity_status := 'retained_external_reference';
      END IF;
    END IF;
    IF identity_status = 'retained_external_reference' AND NOT EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_identity_links AS complete_link
      JOIN public.vendor_disclosure_ingest_runs AS complete_run
        ON complete_run.run_sha256 = complete_link.run_sha256
      WHERE complete_link.vendor_id = owned_identity.identity_id
        AND complete_run.status = 'complete'
    ) THEN
      SELECT active_link.run_sha256 INTO successor_run_sha256
      FROM public.vendor_disclosure_ingest_identity_links AS active_link
      JOIN public.vendor_disclosure_ingest_runs AS active_run
        ON active_run.run_sha256 = active_link.run_sha256
      WHERE active_link.vendor_id = owned_identity.identity_id
        AND active_run.status = 'active'
      ORDER BY active_link.run_sha256
      LIMIT 1;
      IF successor_run_sha256 IS NOT NULL THEN
        INSERT INTO public.vendor_disclosure_ingest_owned_identities (
          run_sha256, batch_index, identity_kind, identity_id,
          parent_vendor_id, initial_row_sha256, cleanup_status
        ) VALUES (
          successor_run_sha256, 1, 'vendor', owned_identity.identity_id,
          NULL, owned_identity.current_sha256, 'owned'
        ) ON CONFLICT (run_sha256, identity_kind, identity_id) DO NOTHING;
        INSERT INTO public.vendor_disclosure_ingest_owned_identities (
          run_sha256, batch_index, identity_kind, identity_id,
          parent_vendor_id, initial_row_sha256, cleanup_status
        )
        SELECT successor_run_sha256, 1, 'vendor_timeslot', owned.identity_id,
          owned.parent_vendor_id, owned.initial_row_sha256, 'owned'
        FROM public.vendor_disclosure_ingest_owned_identities AS owned
        WHERE owned.run_sha256 = p_run_sha256
          AND owned.identity_kind = 'vendor_timeslot'
          AND owned.parent_vendor_id = owned_identity.identity_id
        ON CONFLICT (run_sha256, identity_kind, identity_id) DO NOTHING;
        IF NOT EXISTS (
          SELECT 1 FROM public.vendor_disclosure_ingest_owned_identities AS successor
          WHERE successor.run_sha256 = successor_run_sha256
            AND successor.identity_kind = 'vendor'
            AND successor.identity_id = owned_identity.identity_id
            AND successor.initial_row_sha256 = owned_identity.current_sha256
            AND successor.cleanup_status = 'owned'
        ) OR 84 IS DISTINCT FROM (
          SELECT count(*) FROM public.vendor_disclosure_ingest_owned_identities AS successor
          WHERE successor.run_sha256 = successor_run_sha256
            AND successor.identity_kind = 'vendor_timeslot'
            AND successor.parent_vendor_id = owned_identity.identity_id
            AND successor.cleanup_status = 'owned'
        ) THEN
          RAISE EXCEPTION 'DISCLOSURE_ABORT_VENDOR_HANDOFF_RACE' USING ERRCODE = '40001';
        END IF;
      END IF;
      successor_run_sha256 := NULL;
    END IF;
    IF identity_status IS NULL THEN
      DELETE FROM public.vendor_timeslots AS slot
      WHERE slot.vendor_id = owned_identity.identity_id;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 84 THEN
        RAISE EXCEPTION 'DISCLOSURE_ABORT_TIMESLOT_DELETE_INCOMPLETE' USING ERRCODE = '40001';
      END IF;
      deleted_timeslot_count := deleted_timeslot_count + affected_rows;
      DELETE FROM public.vendors AS vendor WHERE vendor.id = owned_identity.identity_id;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION 'DISCLOSURE_ABORT_VENDOR_DELETE_RACE' USING ERRCODE = '40001';
      END IF;
      deleted_vendor_count := deleted_vendor_count + 1;
      identity_status := 'deleted';
    ELSIF identity_status <> 'deleted' THEN
      retained_identity_count := retained_identity_count + 1;
    END IF;
    UPDATE public.vendor_disclosure_ingest_owned_identities
    SET cleanup_status = identity_status
    WHERE run_sha256 = p_run_sha256 AND (
      (identity_kind = 'vendor' AND identity_id = owned_identity.identity_id)
      OR (identity_kind = 'vendor_timeslot' AND parent_vendor_id = owned_identity.identity_id)
    );
  END LOOP;

  FOR owned_identity IN
    SELECT owned.identity_id, owned.initial_row_sha256, agency.id AS current_id,
      CASE WHEN agency.id IS NULL THEN NULL ELSE encode(extensions.digest(
        convert_to(to_jsonb(agency)::text, 'UTF8'), 'sha256'
      ), 'hex') END AS current_sha256
    FROM public.vendor_disclosure_ingest_owned_identities AS owned
    LEFT JOIN public.agencies AS agency ON agency.id = owned.identity_id
    WHERE owned.run_sha256 = p_run_sha256 AND owned.identity_kind = 'agency'
      AND owned.cleanup_status = 'owned'
    ORDER BY owned.identity_id
  LOOP
    IF owned_identity.current_id IS NULL THEN
      identity_status := 'deleted';
    ELSIF owned_identity.current_sha256 IS DISTINCT FROM owned_identity.initial_row_sha256 THEN
      identity_status := 'retained_modified';
      retained_identity_count := retained_identity_count + 1;
    ELSIF public.vendor_disclosure_identity_has_external_references(
      'public.agencies'::regclass, owned_identity.identity_id
    ) THEN
      identity_status := 'retained_external_reference';
      retained_identity_count := retained_identity_count + 1;
    ELSE
      DELETE FROM public.agencies AS agency WHERE agency.id = owned_identity.identity_id;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION 'DISCLOSURE_ABORT_AGENCY_DELETE_RACE' USING ERRCODE = '40001';
      END IF;
      identity_status := 'deleted';
      deleted_agency_count := deleted_agency_count + 1;
    END IF;
    IF identity_status = 'retained_external_reference' AND NOT EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_identity_links AS complete_link
      JOIN public.vendor_disclosure_ingest_runs AS complete_run
        ON complete_run.run_sha256 = complete_link.run_sha256
      WHERE complete_link.agency_id = owned_identity.identity_id
        AND complete_run.status = 'complete'
    ) THEN
      SELECT active_link.run_sha256 INTO successor_run_sha256
      FROM public.vendor_disclosure_ingest_identity_links AS active_link
      JOIN public.vendor_disclosure_ingest_runs AS active_run
        ON active_run.run_sha256 = active_link.run_sha256
      WHERE active_link.agency_id = owned_identity.identity_id
        AND active_run.status = 'active'
      ORDER BY active_link.run_sha256
      LIMIT 1;
      IF successor_run_sha256 IS NOT NULL THEN
        INSERT INTO public.vendor_disclosure_ingest_owned_identities (
          run_sha256, batch_index, identity_kind, identity_id,
          parent_vendor_id, initial_row_sha256, cleanup_status
        ) VALUES (
          successor_run_sha256, 1, 'agency', owned_identity.identity_id,
          NULL, owned_identity.current_sha256, 'owned'
        ) ON CONFLICT (run_sha256, identity_kind, identity_id) DO NOTHING;
        IF NOT EXISTS (
          SELECT 1 FROM public.vendor_disclosure_ingest_owned_identities AS successor
          WHERE successor.run_sha256 = successor_run_sha256
            AND successor.identity_kind = 'agency'
            AND successor.identity_id = owned_identity.identity_id
            AND successor.initial_row_sha256 = owned_identity.current_sha256
            AND successor.cleanup_status = 'owned'
        ) THEN
          RAISE EXCEPTION 'DISCLOSURE_ABORT_AGENCY_HANDOFF_RACE' USING ERRCODE = '40001';
        END IF;
      END IF;
      successor_run_sha256 := NULL;
    END IF;
    UPDATE public.vendor_disclosure_ingest_owned_identities
    SET cleanup_status = identity_status
    WHERE run_sha256 = p_run_sha256 AND identity_kind = 'agency'
      AND identity_id = owned_identity.identity_id;
  END LOOP;

  -- Transfer cleanup responsibility before marking a shared object retained.
  -- This makes creator-first and reuser-first abort orders converge on the
  -- same last-live-reference owner. Completed runs intentionally keep their
  -- object forever; active runs inherit the creator metadata and exact object
  -- generation under the per-object advisory lock acquired above.
  FOR storage_link IN
    SELECT link.bucket_id, link.object_name, link.object_sha256, link.object_bytes,
      object.id AS current_object_id, object.updated_at AS current_object_updated_at,
      COALESCE(
        link.storage_metadata_owner_run_sha256,
        NULLIF(object.user_metadata ->> 'ingest_run_sha256', '')
      ) AS metadata_owner_run_sha256
    FROM public.vendor_disclosure_ingest_storage_links AS link
    JOIN storage.objects AS object
      ON object.bucket_id = link.bucket_id AND object.name = link.object_name
    WHERE link.run_sha256 = p_run_sha256
      AND link.ownership_state IN ('intent', 'confirmed_created', 'confirmed_inherited')
      AND (link.ownership_state = 'intent' OR (
        object.id = link.storage_object_id
        AND object.updated_at = link.storage_object_updated_at
      ))
      AND object.metadata ->> 'size' = link.object_bytes::text
      AND object.user_metadata ->> 'ingest_run_sha256' = COALESCE(
        link.storage_metadata_owner_run_sha256, p_run_sha256
      )
      AND object.user_metadata ->> 'ingest_sha256' = link.object_sha256
      AND object.user_metadata ->> 'ingest_bytes' = link.object_bytes::text
    ORDER BY link.bucket_id, link.object_name
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_storage_links AS complete_link
      JOIN public.vendor_disclosure_ingest_runs AS complete_run
        ON complete_run.run_sha256 = complete_link.run_sha256
      WHERE complete_link.run_sha256 <> p_run_sha256
        AND complete_link.bucket_id = storage_link.bucket_id
        AND complete_link.object_name = storage_link.object_name
        AND complete_link.object_sha256 = storage_link.object_sha256
        AND complete_link.object_bytes = storage_link.object_bytes
        AND complete_run.status = 'complete'
    ) AND EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_storage_links AS active_link
      JOIN public.vendor_disclosure_ingest_runs AS active_run
        ON active_run.run_sha256 = active_link.run_sha256
      WHERE active_link.run_sha256 <> p_run_sha256
        AND active_link.bucket_id = storage_link.bucket_id
        AND active_link.object_name = storage_link.object_name
        AND active_link.object_sha256 = storage_link.object_sha256
        AND active_link.object_bytes = storage_link.object_bytes
        AND active_link.ownership_state IN ('intent', 'confirmed_preexisting')
        AND active_run.status = 'active'
    ) THEN
      UPDATE public.vendor_disclosure_ingest_storage_links AS successor
      SET ownership_state = 'confirmed_inherited',
          storage_metadata_owner_run_sha256 = storage_link.metadata_owner_run_sha256,
          storage_object_id = storage_link.current_object_id,
          storage_object_updated_at = storage_link.current_object_updated_at,
          confirmed_at = COALESCE(successor.confirmed_at, now())
      WHERE successor.run_sha256 = (
        SELECT active_link.run_sha256
        FROM public.vendor_disclosure_ingest_storage_links AS active_link
        JOIN public.vendor_disclosure_ingest_runs AS active_run
          ON active_run.run_sha256 = active_link.run_sha256
        WHERE active_link.run_sha256 <> p_run_sha256
          AND active_link.bucket_id = storage_link.bucket_id
          AND active_link.object_name = storage_link.object_name
          AND active_link.object_sha256 = storage_link.object_sha256
          AND active_link.object_bytes = storage_link.object_bytes
          AND active_link.ownership_state IN ('intent', 'confirmed_preexisting')
          AND active_run.status = 'active'
        ORDER BY active_link.run_sha256
        LIMIT 1
      ) AND successor.bucket_id = storage_link.bucket_id
        AND successor.object_name = storage_link.object_name
        AND successor.ownership_state IN ('intent', 'confirmed_preexisting');
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      IF affected_rows <> 1 THEN
        RAISE EXCEPTION 'DISCLOSURE_ABORT_STORAGE_HANDOFF_RACE' USING ERRCODE = '40001';
      END IF;
    END IF;
  END LOOP;

  UPDATE public.vendor_disclosure_ingest_storage_links AS link
  SET ownership_state = 'deleted', deleted_at = now()
  WHERE link.run_sha256 = p_run_sha256
    AND link.ownership_state IN ('intent', 'confirmed_created', 'confirmed_inherited')
    AND NOT EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = link.bucket_id AND object.name = link.object_name
    );
  UPDATE public.vendor_disclosure_ingest_storage_links AS link
  SET ownership_state = 'ambiguous'
  FROM storage.objects AS object
  WHERE link.run_sha256 = p_run_sha256
    AND link.ownership_state IN ('intent', 'confirmed_created', 'confirmed_inherited')
    AND object.bucket_id = link.bucket_id AND object.name = link.object_name
    AND ((link.ownership_state IN ('confirmed_created', 'confirmed_inherited') AND (
        object.id IS DISTINCT FROM link.storage_object_id
        OR object.updated_at IS DISTINCT FROM link.storage_object_updated_at
      ))
      OR object.metadata ->> 'size' IS DISTINCT FROM link.object_bytes::text
      OR object.user_metadata ->> 'ingest_run_sha256' IS DISTINCT FROM COALESCE(
        link.storage_metadata_owner_run_sha256, p_run_sha256
      )
      OR object.user_metadata ->> 'ingest_sha256' IS DISTINCT FROM link.object_sha256
      OR object.user_metadata ->> 'ingest_bytes' IS DISTINCT FROM link.object_bytes::text);
  UPDATE public.vendor_disclosure_ingest_storage_links AS link
  SET ownership_state = 'retained_shared'
  FROM storage.objects AS object
  WHERE link.run_sha256 = p_run_sha256
    AND link.ownership_state IN ('intent', 'confirmed_created', 'confirmed_inherited')
    AND object.bucket_id = link.bucket_id AND object.name = link.object_name
    AND (link.ownership_state = 'intent' OR (
      object.id = link.storage_object_id AND object.updated_at = link.storage_object_updated_at
    ))
    AND object.metadata ->> 'size' = link.object_bytes::text
    AND object.user_metadata ->> 'ingest_run_sha256' = COALESCE(
      link.storage_metadata_owner_run_sha256, p_run_sha256
    )
    AND object.user_metadata ->> 'ingest_sha256' = link.object_sha256
    AND object.user_metadata ->> 'ingest_bytes' = link.object_bytes::text
    AND (
      EXISTS (
        SELECT 1 FROM public.vendor_disclosure_ingest_storage_links AS other_link
        JOIN public.vendor_disclosure_ingest_runs AS other_run
          ON other_run.run_sha256 = other_link.run_sha256
        WHERE other_link.run_sha256 <> p_run_sha256
          AND other_link.bucket_id = link.bucket_id AND other_link.object_name = link.object_name
          AND other_run.status <> 'aborted'
      ) OR EXISTS (
        SELECT 1 FROM public.official_prices AS price
        WHERE link.object_name = ANY(price.source_object_keys)
          OR link.object_name = ANY(price.source_preview_keys)
      ) OR EXISTS (
        SELECT 1 FROM public.official_agency_packages AS package
        WHERE link.object_name = ANY(package.source_object_keys)
          OR link.object_name = ANY(package.source_preview_keys)
      ) OR EXISTS (
        SELECT 1 FROM public.disclosure_semantic_staging AS semantic
        WHERE link.object_name = ANY(semantic.source_object_keys)
          OR link.object_name = ANY(semantic.source_preview_keys)
      )
    );
  UPDATE public.vendor_disclosure_ingest_storage_links AS link
  SET ownership_state = 'delete_authorized'
  FROM storage.objects AS object
  WHERE link.run_sha256 = p_run_sha256
    AND link.ownership_state IN ('intent', 'confirmed_created', 'confirmed_inherited')
    AND object.bucket_id = link.bucket_id AND object.name = link.object_name
    AND (link.ownership_state = 'intent' OR (
      object.id = link.storage_object_id AND object.updated_at = link.storage_object_updated_at
    ))
    AND object.metadata ->> 'size' = link.object_bytes::text
    AND object.user_metadata ->> 'ingest_run_sha256' = COALESCE(
      link.storage_metadata_owner_run_sha256, p_run_sha256
    )
    AND object.user_metadata ->> 'ingest_sha256' = link.object_sha256
    AND object.user_metadata ->> 'ingest_bytes' = link.object_bytes::text;
  UPDATE public.vendor_disclosure_ingest_storage_links AS link
  SET ownership_state = 'ambiguous'
  WHERE link.run_sha256 = p_run_sha256 AND link.ownership_state = 'intent';

  -- Completion is allowed only after the run lock plus every per-object lock
  -- has reduced the run to zero upload claims and zero unresolved intents.
  -- A claimant serialized after this transaction observes status=aborted and
  -- cannot start an HTTP upload.
  PERFORM public.assert_vendor_disclosure_storage_upload_claims_settled(p_run_sha256);
  PERFORM public.assert_vendor_disclosure_storage_intents_settled(p_run_sha256);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket', link.bucket_id, 'object_key', link.object_name,
    'sha256', link.object_sha256, 'bytes', link.object_bytes
  ) ORDER BY link.bucket_id, link.object_name), '[]'::jsonb)
  INTO storage_rollback_objects
  FROM public.vendor_disclosure_ingest_storage_links AS link
  WHERE link.run_sha256 = p_run_sha256 AND link.ownership_state = 'delete_authorized';
  rollback_receipt_sha256_value := encode(extensions.digest(convert_to(jsonb_build_object(
    'contract_version', 1,
    'target_project_ref', p_target_project_ref,
    'run_sha256', p_run_sha256,
    'full_plan_sha256', p_full_plan_sha256,
    'reason', btrim(p_reason),
    'storage_objects', storage_rollback_objects
  )::text, 'UTF8'), 'sha256'), 'hex');
  UPDATE public.vendor_disclosure_ingest_runs
  SET status = 'aborted', aborted_at = now(), abort_reason = btrim(p_reason),
      storage_rollback_receipt_sha256 = rollback_receipt_sha256_value,
      updated_at = now()
  WHERE run_sha256 = p_run_sha256 AND status = 'active';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'DISCLOSURE_ABORT_STATUS_RACE' USING ERRCODE = '40001';
  END IF;
  storage_rollback_receipt_sha256 := rollback_receipt_sha256_value;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket', link.bucket_id, 'object_key', link.object_name,
    'sha256', link.object_sha256, 'bytes', link.object_bytes,
    'state', link.ownership_state
  ) ORDER BY link.bucket_id, link.object_name), '[]'::jsonb)
  INTO storage_object_outcomes
  FROM public.vendor_disclosure_ingest_storage_links AS link
  WHERE link.run_sha256 = p_run_sha256;
  RETURN NEXT;
END;
$abort_vendor_disclosure_ingest_run_atomic$;

CREATE OR REPLACE FUNCTION public.complete_vendor_disclosure_storage_rollback_atomic(
  p_target_project_ref text,
  p_run_sha256 text,
  p_full_plan_sha256 text,
  p_storage_rollback_receipt_sha256 text,
  p_storage_objects jsonb
)
RETURNS TABLE (completed_object_count integer, already_completed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $complete_vendor_disclosure_storage_rollback_atomic$
DECLARE
  run_row public.vendor_disclosure_ingest_runs%ROWTYPE;
  authorized_count integer;
  storage_item jsonb;
  normalized_storage_objects jsonb;
  expected_receipt_sha256 text;
BEGIN
  IF p_target_project_ref !~ '^[a-z0-9][a-z0-9-]{3,80}$'
    OR p_run_sha256 !~ '^[0-9a-f]{64}$'
    OR p_full_plan_sha256 !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_storage_rollback_receipt_sha256, '') !~ '^[0-9a-f]{64}$'
    OR p_storage_objects IS NULL OR jsonb_typeof(p_storage_objects) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_storage_objects) > 32000
    OR jsonb_array_length(p_storage_objects) IS DISTINCT FROM (
      SELECT count(DISTINCT (value ->> 'bucket', value ->> 'object_key'))
      FROM jsonb_array_elements(p_storage_objects)
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS item(value)
      WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
        OR item.value ->> 'bucket' NOT IN ('disclosure-raw', 'disclosure-preview')
        OR COALESCE(item.value ->> 'object_key', '') !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
        OR COALESCE(item.value ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
        OR split_part(item.value ->> 'object_key', '.', 1) IS DISTINCT FROM item.value ->> 'sha256'
        OR COALESCE(item.value ->> 'bytes', '') !~ '^[0-9]{1,9}$'
        OR (item.value ->> 'bytes')::bigint > 52428800
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_ROLLBACK_COMPLETE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-run-v1:' || p_run_sha256, 0));
  SELECT run.* INTO run_row FROM public.vendor_disclosure_ingest_runs AS run
  WHERE run.run_sha256 = p_run_sha256 FOR UPDATE;
  IF run_row.run_sha256 IS NULL
    OR run_row.target_project_ref IS DISTINCT FROM p_target_project_ref
    OR run_row.full_plan_sha256 IS DISTINCT FROM p_full_plan_sha256
    OR run_row.status IS DISTINCT FROM 'aborted'
    OR run_row.storage_rollback_receipt_sha256 IS DISTINCT FROM p_storage_rollback_receipt_sha256
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_ROLLBACK_COMPLETE_RUN_CONFLICT' USING ERRCODE = '23505';
  END IF;
  PERFORM public.assert_vendor_disclosure_storage_intents_settled(p_run_sha256);
  PERFORM public.assert_vendor_disclosure_storage_upload_claims_settled(p_run_sha256);
  FOR storage_item IN
    SELECT value FROM jsonb_array_elements(p_storage_objects)
    ORDER BY value ->> 'bucket', value ->> 'object_key'
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'vendor-disclosure-storage-v1:' || (storage_item ->> 'bucket') || ':' || (storage_item ->> 'object_key'),
      0
    ));
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket', supplied.value ->> 'bucket',
    'object_key', supplied.value ->> 'object_key',
    'sha256', supplied.value ->> 'sha256',
    'bytes', (supplied.value ->> 'bytes')::bigint
  ) ORDER BY supplied.value ->> 'bucket', supplied.value ->> 'object_key'), '[]'::jsonb)
  INTO normalized_storage_objects
  FROM jsonb_array_elements(p_storage_objects) AS supplied(value);
  expected_receipt_sha256 := encode(extensions.digest(convert_to(jsonb_build_object(
    'contract_version', 1,
    'target_project_ref', p_target_project_ref,
    'run_sha256', p_run_sha256,
    'full_plan_sha256', p_full_plan_sha256,
    'reason', run_row.abort_reason,
    'storage_objects', normalized_storage_objects
  )::text, 'UTF8'), 'sha256'), 'hex');
  IF expected_receipt_sha256 IS DISTINCT FROM p_storage_rollback_receipt_sha256 THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_ROLLBACK_COMPLETE_RECEIPT_CONFLICT' USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_disclosure_ingest_storage_links AS link
    WHERE link.run_sha256 = p_run_sha256 AND link.ownership_state = 'delete_authorized'
  ) AND jsonb_array_length(p_storage_objects) = (
    SELECT count(*) FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
    JOIN public.vendor_disclosure_ingest_storage_links AS link
      ON link.run_sha256 = p_run_sha256
      AND link.bucket_id = supplied.value ->> 'bucket'
      AND link.object_name = supplied.value ->> 'object_key'
      AND link.object_sha256 = supplied.value ->> 'sha256'
      AND link.object_bytes = (supplied.value ->> 'bytes')::bigint
      AND link.ownership_state = 'deleted'
  ) THEN
    completed_object_count := 0;
    already_completed := true;
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT count(*) INTO authorized_count
  FROM public.vendor_disclosure_ingest_storage_links AS link
  WHERE link.run_sha256 = p_run_sha256 AND link.ownership_state = 'delete_authorized';
  IF authorized_count IS DISTINCT FROM jsonb_array_length(p_storage_objects)
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.vendor_disclosure_ingest_storage_links AS link
        WHERE link.run_sha256 = p_run_sha256 AND link.ownership_state = 'delete_authorized'
          AND link.bucket_id = supplied.value ->> 'bucket'
          AND link.object_name = supplied.value ->> 'object_key'
          AND link.object_sha256 = supplied.value ->> 'sha256'
          AND link.object_bytes = (supplied.value ->> 'bytes')::bigint
      )
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_ROLLBACK_COMPLETE_SET_CONFLICT' USING ERRCODE = '23505';
  END IF;
  -- Supabase Storage removal is a separate committed operation. Prevent a
  -- same-name object from being inserted between the absence proof and the
  -- ownership tombstone in this transaction.
  LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_storage_objects) AS supplied(value)
    JOIN storage.objects AS object
      ON object.bucket_id = supplied.value ->> 'bucket'
      AND object.name = supplied.value ->> 'object_key'
  ) THEN
    RAISE EXCEPTION 'DISCLOSURE_STORAGE_ROLLBACK_OBJECT_STILL_EXISTS' USING ERRCODE = '55000';
  END IF;
  UPDATE public.vendor_disclosure_ingest_storage_links AS link
  SET ownership_state = 'deleted', deleted_at = now()
  WHERE link.run_sha256 = p_run_sha256 AND link.ownership_state = 'delete_authorized';
  GET DIAGNOSTICS completed_object_count = ROW_COUNT;
  already_completed := false;
  RETURN NEXT;
END;
$complete_vendor_disclosure_storage_rollback_atomic$;

-- Operational detector for rows created by a retired direct writer before
-- this fence existed. These rows are never silently omitted: preview and bulk
-- approval stop until an operator removes them or re-ingests their source
-- through the atomic pipeline.
CREATE OR REPLACE FUNCTION public.get_vendor_disclosure_unowned_pending_counts()
RETURNS TABLE (
  official_price_count bigint,
  agency_package_count bigint,
  semantic_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET statement_timeout = '30s'
AS $get_vendor_disclosure_unowned_pending_counts$
  SELECT
    (
      SELECT count(*)
      FROM public.official_prices AS price
      JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
      WHERE snapshot.source = 'kca_tprice'
        AND price.review_status = 'pending'
        AND NOT EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_owned_rows AS owned
          WHERE owned.row_kind = 'official_price' AND owned.row_id = price.id
        )
    ),
    (
      SELECT count(*)
      FROM public.official_agency_packages AS package
      JOIN public.price_snapshots AS snapshot ON snapshot.id = package.snapshot_id
      WHERE snapshot.source = 'kca_tprice'
        AND package.review_status = 'pending'
        AND NOT EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_owned_rows AS owned
          WHERE owned.row_kind = 'agency_package' AND owned.row_id = package.id
        )
    ),
    (
      SELECT count(*)
      FROM public.disclosure_semantic_staging AS semantic
      JOIN public.price_snapshots AS snapshot ON snapshot.id = semantic.snapshot_id
      WHERE snapshot.source = 'kca_tprice'
        AND semantic.review_status = 'pending'
        AND NOT EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_owned_rows AS owned
          WHERE owned.row_kind = 'semantic' AND owned.row_id = semantic.id
        )
    );
$get_vendor_disclosure_unowned_pending_counts$;

-- Returns one immutable ownership scope for the latest completed draft run.
-- The service-role web loader must use these IDs instead of snapshot-wide
-- reads, because multiple historical or active runs may share a draft snapshot.
CREATE OR REPLACE FUNCTION public.get_vendor_disclosure_admin_preview_scope()
RETURNS TABLE (
  run_sha256 text,
  snapshot_id uuid,
  period_label text,
  unit_ids text[],
  official_price_ids uuid[],
  semantic_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET statement_timeout = '30s'
AS $get_vendor_disclosure_admin_preview_scope$
DECLARE
  selected_run public.vendor_disclosure_ingest_runs%ROWTYPE;
  selected_snapshot public.price_snapshots%ROWTYPE;
  scoped_unit_ids text[];
  scoped_price_ids uuid[];
  scoped_semantic_ids uuid[];
  persisted_batch_count integer;
  persisted_batch_indexes integer[];
  eligible_run_count integer;
  unowned_price_count bigint;
  unowned_package_count bigint;
  unowned_semantic_count bigint;
BEGIN
  SELECT
    unowned.official_price_count,
    unowned.agency_package_count,
    unowned.semantic_count
  INTO unowned_price_count, unowned_package_count, unowned_semantic_count
  FROM public.get_vendor_disclosure_unowned_pending_counts() AS unowned;
  IF COALESCE(unowned_price_count, 0)
      + COALESCE(unowned_package_count, 0)
      + COALESCE(unowned_semantic_count, 0) > 0
  THEN
    RAISE EXCEPTION 'ADMIN_PREVIEW_UNOWNED_PENDING_KCA_TPRICE'
      USING ERRCODE = '23514',
        DETAIL = jsonb_build_object(
          'official_prices', COALESCE(unowned_price_count, 0),
          'official_agency_packages', COALESCE(unowned_package_count, 0),
          'disclosure_semantic_staging', COALESCE(unowned_semantic_count, 0)
        )::text;
  END IF;

  SELECT count(*)::integer
  INTO eligible_run_count
  FROM public.vendor_disclosure_ingest_runs AS run
  JOIN public.price_snapshots AS snapshot ON snapshot.id = run.snapshot_id
  WHERE run.status = 'complete'
    AND run.snapshot_source = 'kca_tprice'
    AND run.completed_batch_count = run.batch_count
    AND run.dedupe_finalized_at IS NOT NULL
    AND run.dedupe_candidates_sha256 IS NOT NULL
    AND run.dedupe_payload_sha256 IS NOT NULL
    AND snapshot.source = 'kca_tprice'
    AND snapshot.published = false
    AND snapshot.is_current = false
    AND snapshot.published_at IS NULL;
  IF eligible_run_count > 1 THEN
    RAISE EXCEPTION 'ADMIN_PREVIEW_SCOPE_AMBIGUOUS_COMPLETED_RUNS' USING ERRCODE = '23514';
  END IF;
  IF eligible_run_count = 0 THEN
    RETURN;
  END IF;

  SELECT run.*
  INTO selected_run
  FROM public.vendor_disclosure_ingest_runs AS run
  JOIN public.price_snapshots AS snapshot ON snapshot.id = run.snapshot_id
  WHERE run.status = 'complete'
    AND run.snapshot_source = 'kca_tprice'
    AND run.completed_batch_count = run.batch_count
    AND run.dedupe_finalized_at IS NOT NULL
    AND run.dedupe_candidates_sha256 IS NOT NULL
    AND run.dedupe_payload_sha256 IS NOT NULL
    AND snapshot.source = 'kca_tprice'
    AND snapshot.published = false
    AND snapshot.is_current = false
    AND snapshot.published_at IS NULL
  ORDER BY run.dedupe_finalized_at DESC, run.run_sha256 DESC
  LIMIT 1;

  IF selected_run.run_sha256 IS NULL THEN
    RETURN;
  END IF;
  SELECT snapshot.* INTO selected_snapshot
  FROM public.price_snapshots AS snapshot
  WHERE snapshot.id = selected_run.snapshot_id
    AND snapshot.source = 'kca_tprice'
    AND snapshot.published = false
    AND snapshot.is_current = false
    AND snapshot.published_at IS NULL;
  IF selected_snapshot.id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_PREVIEW_SCOPE_SNAPSHOT_CHANGED' USING ERRCODE = '40001';
  END IF;

  SELECT count(*)::integer, array_agg(batch.batch_index ORDER BY batch.batch_index)
  INTO persisted_batch_count, persisted_batch_indexes
  FROM public.vendor_disclosure_ingest_batches AS batch
  WHERE batch.run_sha256 = selected_run.run_sha256;
  IF persisted_batch_count IS DISTINCT FROM selected_run.batch_count
    OR persisted_batch_indexes IS DISTINCT FROM ARRAY(
      SELECT generate_series(1, selected_run.batch_count)
    )
    OR EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_batches AS batch
      WHERE batch.run_sha256 = selected_run.run_sha256
        AND NOT public.vendor_disclosure_unit_ids_are_safe(batch.unit_ids)
    )
  THEN
    RAISE EXCEPTION 'ADMIN_PREVIEW_SCOPE_INVALID_BATCHES' USING ERRCODE = '23514';
  END IF;

  SELECT array_agg(unit.unit_id ORDER BY batch.batch_index, unit.ordinality)
  INTO scoped_unit_ids
  FROM public.vendor_disclosure_ingest_batches AS batch
  CROSS JOIN LATERAL unnest(batch.unit_ids) WITH ORDINALITY AS unit(unit_id, ordinality)
  WHERE batch.run_sha256 = selected_run.run_sha256;
  IF scoped_unit_ids IS NULL
    OR cardinality(scoped_unit_ids) <> cardinality(ARRAY(
      SELECT DISTINCT unit_id FROM unnest(scoped_unit_ids) AS source(unit_id)
    ))
    OR EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_batches AS batch
      CROSS JOIN LATERAL unnest(batch.unit_ids) AS unit(unit_id)
      WHERE batch.run_sha256 = selected_run.run_sha256
        AND NOT EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_owned_rows AS owned
          WHERE owned.run_sha256 = selected_run.run_sha256
            AND owned.batch_index = batch.batch_index
            AND owned.unit_id = unit.unit_id
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.vendor_disclosure_ingest_owned_rows AS owned
      WHERE owned.run_sha256 = selected_run.run_sha256
        AND NOT EXISTS (
          SELECT 1
          FROM public.vendor_disclosure_ingest_batches AS batch
          WHERE batch.run_sha256 = owned.run_sha256
            AND batch.batch_index = owned.batch_index
            AND owned.unit_id = ANY(batch.unit_ids)
        )
    )
  THEN
    RAISE EXCEPTION 'ADMIN_PREVIEW_SCOPE_INVALID_OWNERSHIP' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vendor_disclosure_ingest_owned_rows AS owned
    LEFT JOIN public.official_prices AS price
      ON owned.row_kind = 'official_price' AND price.id = owned.row_id
    LEFT JOIN public.official_agency_packages AS package
      ON owned.row_kind = 'agency_package' AND package.id = owned.row_id
    LEFT JOIN public.disclosure_semantic_staging AS semantic
      ON owned.row_kind = 'semantic' AND semantic.id = owned.row_id
    WHERE owned.run_sha256 = selected_run.run_sha256
      AND CASE owned.row_kind
        WHEN 'official_price' THEN price.id IS NULL OR price.snapshot_id <> selected_run.snapshot_id
        WHEN 'agency_package' THEN package.id IS NULL OR package.snapshot_id <> selected_run.snapshot_id
        WHEN 'semantic' THEN semantic.id IS NULL OR semantic.snapshot_id <> selected_run.snapshot_id
        ELSE true
      END
  ) OR EXISTS (
    SELECT 1
    FROM public.vendor_disclosure_ingest_owned_rows AS owned
    WHERE owned.run_sha256 = selected_run.run_sha256
      AND (
        SELECT count(*)
        FROM public.vendor_disclosure_ingest_owned_rows AS any_owner
        WHERE any_owner.row_kind = owned.row_kind AND any_owner.row_id = owned.row_id
      ) <> 1
  ) THEN
    RAISE EXCEPTION 'ADMIN_PREVIEW_SCOPE_ROW_LINEAGE_CONFLICT' USING ERRCODE = '23514';
  END IF;

  SELECT
    COALESCE(array_agg(owned.row_id ORDER BY owned.row_id)
      FILTER (WHERE owned.row_kind = 'official_price'), '{}'::uuid[]),
    COALESCE(array_agg(owned.row_id ORDER BY owned.row_id)
      FILTER (WHERE owned.row_kind = 'semantic'), '{}'::uuid[])
  INTO scoped_price_ids, scoped_semantic_ids
  FROM public.vendor_disclosure_ingest_owned_rows AS owned
  WHERE owned.run_sha256 = selected_run.run_sha256;

  run_sha256 := selected_run.run_sha256;
  snapshot_id := selected_run.snapshot_id;
  period_label := selected_snapshot.period_label;
  unit_ids := scoped_unit_ids;
  official_price_ids := scoped_price_ids;
  semantic_ids := scoped_semantic_ids;
  RETURN NEXT;
END;
$get_vendor_disclosure_admin_preview_scope$;

-- Keeps vendor-detail reads bounded to the selected vendor while preserving
-- the exact completed-run lineage enforced by the full preview scope.
CREATE OR REPLACE FUNCTION public.get_vendor_disclosure_admin_preview_vendor_scope(
  p_vendor_id uuid
)
RETURNS TABLE (
  run_sha256 text,
  snapshot_id uuid,
  period_label text,
  unit_ids text[],
  official_price_ids uuid[],
  semantic_ids uuid[]
)
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET statement_timeout = '30s'
AS $get_vendor_disclosure_admin_preview_vendor_scope$
  SELECT
    latest_scope.run_sha256,
    latest_scope.snapshot_id,
    latest_scope.period_label,
    latest_scope.unit_ids,
    ARRAY(
      SELECT price.id
      FROM unnest(latest_scope.official_price_ids) AS scoped_price(id)
      JOIN public.official_prices AS price ON price.id = scoped_price.id
      WHERE price.snapshot_id = latest_scope.snapshot_id
        AND price.vendor_id = p_vendor_id
      ORDER BY price.id
    ),
    ARRAY(
      SELECT semantic.id
      FROM unnest(latest_scope.semantic_ids) AS scoped_semantic(id)
      JOIN public.disclosure_semantic_staging AS semantic
        ON semantic.id = scoped_semantic.id
      WHERE semantic.snapshot_id = latest_scope.snapshot_id
        AND semantic.partner_vendor_id = p_vendor_id
      ORDER BY semantic.id
    )
  FROM public.get_vendor_disclosure_admin_preview_scope() AS latest_scope;
$get_vendor_disclosure_admin_preview_vendor_scope$;

-- The admin UI first reads an eligibility count and SHA-256, then echoes both
-- with an explicit human confirmation. Only prices owned by a finalized paid
-- pilot can enter this contract; local deterministic rows are structurally
-- excluded regardless of confidence or later edits.
CREATE OR REPLACE FUNCTION public.vendor_disclosure_uuid_batch_is_safe(
  p_ids uuid[],
  p_expected_count integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $vendor_disclosure_uuid_batch_is_safe$
  SELECT COALESCE(
    p_expected_count BETWEEN 1 AND 25
    AND cardinality(p_ids) = p_expected_count
    AND array_position(p_ids, NULL) IS NULL
    AND cardinality(p_ids) = cardinality(ARRAY(
      SELECT DISTINCT source.id
      FROM unnest(p_ids) AS source(id)
    )),
    false
  );
$vendor_disclosure_uuid_batch_is_safe$;

CREATE TABLE public.vendor_disclosure_bulk_approval_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  eligibility_contract_version integer NOT NULL CHECK (eligibility_contract_version = 1),
  eligibility_sha256 text NOT NULL CHECK (eligibility_sha256 ~ '^[0-9a-f]{64}$'),
  approved_count integer NOT NULL CHECK (approved_count BETWEEN 1 AND 25),
  approved_price_ids uuid[] NOT NULL,
  approval_receipt_sha256 text NOT NULL UNIQUE CHECK (
    approval_receipt_sha256 ~ '^[0-9a-f]{64}$'
  ),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT vendor_disclosure_bulk_approval_ids_check CHECK (
    public.vendor_disclosure_uuid_batch_is_safe(approved_price_ids, approved_count)
  )
);

CREATE INDEX vendor_disclosure_bulk_approval_actor_timeline_idx
  ON public.vendor_disclosure_bulk_approval_audits (actor_id, occurred_at DESC, id);

DROP TRIGGER IF EXISTS vendor_disclosure_bulk_approval_audits_append_only
  ON public.vendor_disclosure_bulk_approval_audits;
CREATE TRIGGER vendor_disclosure_bulk_approval_audits_append_only
BEFORE UPDATE OR DELETE ON public.vendor_disclosure_bulk_approval_audits
FOR EACH ROW EXECUTE FUNCTION public.guard_official_review_event_append_only();

DROP TRIGGER IF EXISTS vendor_disclosure_bulk_approval_audits_no_truncate
  ON public.vendor_disclosure_bulk_approval_audits;
CREATE TRIGGER vendor_disclosure_bulk_approval_audits_no_truncate
BEFORE TRUNCATE ON public.vendor_disclosure_bulk_approval_audits
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_official_review_event_append_only();

ALTER TABLE public.vendor_disclosure_bulk_approval_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_disclosure_bulk_approval_audits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vendor_disclosure_bulk_approval_audits
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vendor_disclosure_bulk_approval_audits TO service_role;

-- Private deep module used by both public RPCs. Each entry fingerprints the
-- virgin review state, option evidence, vendor identity, validation siblings,
-- immutable storage links, and paid-pilot run/batch lineage. The full entries
-- are never granted to PostgREST roles; callers receive only their aggregate
-- digest and bounded count.
CREATE OR REPLACE FUNCTION public.vendor_disclosure_bulk_approval_candidates(
  p_batch_limit integer
)
RETURNS TABLE (price_id uuid, eligibility_entry jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET statement_timeout = '30s'
ROWS 26
AS $vendor_disclosure_bulk_approval_candidates$
  WITH eligible AS (
    SELECT
      price.id AS price_id,
      jsonb_build_object(
        'price_id', price.id,
        'price_lineage_sha256', encode(extensions.digest(convert_to(jsonb_build_object(
          'review_status', price.review_status,
          'needs_review', price.needs_review,
          'validation_issue_codes', price.validation_issue_codes,
          'review_version', price.review_version,
          'edited_by_admin', price.edited_by_admin,
          'reviewed_by', price.reviewed_by,
          'reviewed_at', price.reviewed_at,
          'review_action', price.review_action,
          'category', price.category,
          'item_name', price.item_name,
          'base_spec', price.base_spec,
          'price_min_krw', price.price_min_krw,
          'price_max_krw', price.price_max_krw,
          'vat_note', price.vat_note,
          'price_note', price.price_note,
          'source_record_key', price.source_record_key,
          'source_file', price.source_file,
          'source_object_keys', price.source_object_keys,
          'source_preview_keys', price.source_preview_keys,
          'source_quote', price.source_quote,
          'confidence', price.confidence
        )::text, 'UTF8'), 'sha256'), 'hex'),
        'option_lineage_sha256', encode(extensions.digest(
          convert_to(option_evidence.lineage::text, 'UTF8'), 'sha256'
        ), 'hex'),
        'validation_lineage_sha256', encode(extensions.digest(
          convert_to(validation_evidence.lineage::text, 'UTF8'), 'sha256'
        ), 'hex'),
        'storage_lineage_sha256', encode(extensions.digest(
          convert_to(storage_evidence.lineage::text, 'UTF8'), 'sha256'
        ), 'hex'),
        'provider_lineage_sha256', provider_lineage.lineage_sha256,
        'paid_attestation_sha256', paid_attestation.attestation_sha256,
        'record_binding_sha256', price_binding.binding_sha256,
        'provider_ledger_sha256', encode(extensions.digest(convert_to(jsonb_build_object(
          'id', provider_ledger.id,
          'success', provider_ledger.success,
          'error_message', provider_ledger.error_message,
          'model', provider_ledger.model,
          'tokens_input', provider_ledger.tokens_input,
          'tokens_output', provider_ledger.tokens_output,
          'cost_usd', provider_ledger.cost_usd,
          'metadata', provider_ledger.metadata,
          'created_at', provider_ledger.created_at
        )::text, 'UTF8'), 'sha256'), 'hex'),
        'vendor_lineage_sha256', encode(extensions.digest(convert_to(jsonb_build_object(
          'id', vendor.id,
          'name', vendor.name,
          'category', vendor.category,
          'region_code', vendor.region_code,
          'status', vendor.status,
          'merged_into_vendor_id', vendor.merged_into_vendor_id,
          'updated_at', vendor.updated_at
        )::text, 'UTF8'), 'sha256'), 'hex'),
        'agency_lineage_sha256', CASE WHEN price.agency_id IS NULL THEN NULL ELSE
          encode(extensions.digest(convert_to(jsonb_build_object(
            'id', agency.id,
            'name', agency.name,
            'normalized_name', agency.normalized_name,
            'region_code', agency.region_code,
            'is_active', agency.is_active,
            'merged_into_agency_id', agency.merged_into_agency_id,
            'updated_at', agency.updated_at
          )::text, 'UTF8'), 'sha256'), 'hex')
        END,
        'run_sha256', run.run_sha256,
        'full_plan_sha256', run.full_plan_sha256,
        'authorization_kind', run.authorization_kind,
        'authorization_sha256', run.authorization_sha256,
        'dedupe_candidates_sha256', run.dedupe_candidates_sha256,
        'dedupe_payload_sha256', run.dedupe_payload_sha256,
        'dedupe_finalized_at', run.dedupe_finalized_at,
        'completed_batch_count', run.completed_batch_count,
        'batch_count', run.batch_count,
        'batch_index', owned.batch_index,
        'batch_sha256', batch.batch_sha256,
        'batch_plan_sha256', batch.batch_plan_sha256,
        'payload_sha256', batch.payload_sha256,
        'batch_receipt_sha256', batch.batch_receipt_sha256,
        'batch_unit_ids', batch.unit_ids,
        'batch_staged_record_count', batch.staged_record_count,
        'batch_needs_review_count', batch.needs_review_count,
        'unit_id', owned.unit_id,
        'snapshot_id', snapshot.id
      ) AS eligibility_entry
    FROM public.official_prices AS price
    JOIN public.vendor_disclosure_ingest_owned_rows AS owned
      ON owned.row_kind = 'official_price' AND owned.row_id = price.id
    JOIN public.vendor_disclosure_ingest_runs AS run
      ON run.run_sha256 = owned.run_sha256
    JOIN public.get_vendor_disclosure_admin_preview_scope() AS latest_scope
      ON latest_scope.run_sha256 = owned.run_sha256
      AND latest_scope.snapshot_id = price.snapshot_id
      AND owned.unit_id = ANY(latest_scope.unit_ids)
      AND price.id = ANY(latest_scope.official_price_ids)
    JOIN public.vendor_disclosure_ingest_batches AS batch
      ON batch.run_sha256 = owned.run_sha256
      AND batch.batch_index = owned.batch_index
    JOIN public.vendor_disclosure_ingest_record_bindings AS price_binding
      ON price_binding.run_sha256 = owned.run_sha256
      AND price_binding.batch_index = owned.batch_index
      AND price_binding.unit_id = owned.unit_id
      AND price_binding.row_kind = 'official_price'
      AND price_binding.row_id = price.id
      AND price_binding.vendor_id = price.vendor_id
      AND price_binding.agency_id IS NOT DISTINCT FROM price.agency_id
      AND price_binding.linked_official_price_id IS NULL
    JOIN public.vendor_disclosure_ingest_unit_provider_lineage AS provider_lineage
      ON provider_lineage.run_sha256 = owned.run_sha256
      AND provider_lineage.batch_index = owned.batch_index
      AND provider_lineage.unit_id = owned.unit_id
    JOIN public.vendor_disclosure_ingest_owned_ledger_rows AS provider_owned_ledger
      ON provider_owned_ledger.run_sha256 = provider_lineage.run_sha256
      AND provider_owned_ledger.batch_index = provider_lineage.batch_index
      AND provider_owned_ledger.ledger_id = provider_lineage.successful_ledger_id
    JOIN public.vendor_disclosure_paid_extraction_attestations AS paid_attestation
      ON paid_attestation.run_sha256 = provider_lineage.run_sha256
      AND paid_attestation.batch_index = provider_lineage.batch_index
      AND paid_attestation.unit_id = provider_lineage.unit_id
      AND paid_attestation.ledger_id = provider_lineage.successful_ledger_id
      AND paid_attestation.request_hash = provider_lineage.request_hash
      AND paid_attestation.paid_plan_sha256 = provider_lineage.paid_plan_sha256
      AND paid_attestation.provider_model = provider_lineage.provider_model
      AND paid_attestation.source_fingerprint = provider_lineage.source_fingerprint
      AND paid_attestation.conversion_fingerprint = provider_lineage.conversion_fingerprint
      AND paid_attestation.extraction_fingerprint = provider_lineage.extraction_fingerprint
      AND paid_attestation.validation_fingerprint = provider_lineage.validation_fingerprint
      AND paid_attestation.full_plan_sha256 = run.full_plan_sha256
      AND paid_attestation.batch_plan_sha256 = batch.batch_plan_sha256
      AND paid_attestation.batch_sha256 = batch.batch_sha256
      AND paid_attestation.payload_sha256 = batch.payload_sha256
      AND paid_attestation.unit_payload_sha256
        = public.vendor_disclosure_persisted_unit_payload_sha256(
          owned.run_sha256,
          owned.unit_id
        )
      AND paid_attestation.attestation_sha256 = provider_lineage.paid_attestation_sha256
    JOIN public.ai_interactions_log AS provider_ledger
      ON provider_ledger.id = provider_lineage.successful_ledger_id
    JOIN public.price_snapshots AS snapshot ON snapshot.id = price.snapshot_id
    JOIN public.vendors AS vendor ON vendor.id = price.vendor_id
    LEFT JOIN public.agencies AS agency ON agency.id = price.agency_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', option_row.id,
        'name', option_row.name,
        'price_min_krw', option_row.price_min_krw,
        'price_max_krw', option_row.price_max_krw,
        'unit', option_row.unit,
        'condition', option_row.condition,
        'raw_text', option_row.raw_text,
        'source_file', option_row.source_file,
        'source_quote', option_row.source_quote,
        'source_object_keys', option_row.source_object_keys,
        'confidence', option_row.confidence
      ) ORDER BY option_row.id), '[]'::jsonb) AS lineage
      FROM public.official_price_options AS option_row
      WHERE option_row.official_price_id = price.id
    ) AS option_evidence
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(sibling.entry ORDER BY sibling.row_kind, sibling.row_id), '[]'::jsonb)
        AS lineage
      FROM (
        SELECT sibling_owned.row_kind, sibling_owned.row_id,
          CASE sibling_owned.row_kind
            WHEN 'official_price' THEN jsonb_build_object(
              'row_kind', sibling_owned.row_kind,
              'row_id', sibling_owned.row_id,
              'needs_review', sibling_price.needs_review,
              'validation_issue_codes', sibling_price.validation_issue_codes,
              'confidence', sibling_price.confidence,
              'source_record_key', sibling_price.source_record_key,
              'vendor_id', sibling_price.vendor_id,
              'agency_id', sibling_price.agency_id,
              'binding_record_ref', sibling_binding.record_ref,
              'binding_vendor_id', sibling_binding.vendor_id,
              'binding_agency_id', sibling_binding.agency_id,
              'binding_sha256', sibling_binding.binding_sha256
            )
            WHEN 'agency_package' THEN jsonb_build_object(
              'row_kind', sibling_owned.row_kind,
              'row_id', sibling_owned.row_id,
              'needs_review', sibling_package.needs_review,
              'validation_issue_codes', sibling_package.validation_issue_codes,
              'confidence', sibling_package.confidence,
              'agency_id', sibling_package.agency_id,
              'binding_record_ref', sibling_binding.record_ref,
              'binding_agency_id', sibling_binding.agency_id,
              'binding_sha256', sibling_binding.binding_sha256
            )
            WHEN 'semantic' THEN jsonb_build_object(
              'row_kind', sibling_owned.row_kind,
              'row_id', sibling_owned.row_id,
              'needs_review', sibling_semantic.needs_review,
              'validation_issue_codes', sibling_semantic.validation_issue_codes,
              'confidence', sibling_semantic.confidence,
              'source_fingerprint', sibling_semantic.source_fingerprint,
              'validation_fingerprint', sibling_semantic.validation_fingerprint,
              'unit_id', sibling_semantic.unit_id,
              'partner_vendor_id', sibling_semantic.partner_vendor_id,
              'official_price_id', sibling_semantic.official_price_id,
              'binding_record_ref', sibling_binding.record_ref,
              'binding_vendor_id', sibling_binding.vendor_id,
              'binding_official_price_id', sibling_binding.linked_official_price_id,
              'binding_sha256', sibling_binding.binding_sha256
            )
          END AS entry
        FROM public.vendor_disclosure_ingest_owned_rows AS sibling_owned
        LEFT JOIN public.official_prices AS sibling_price
          ON sibling_owned.row_kind = 'official_price' AND sibling_price.id = sibling_owned.row_id
        LEFT JOIN public.official_agency_packages AS sibling_package
          ON sibling_owned.row_kind = 'agency_package' AND sibling_package.id = sibling_owned.row_id
        LEFT JOIN public.disclosure_semantic_staging AS sibling_semantic
          ON sibling_owned.row_kind = 'semantic' AND sibling_semantic.id = sibling_owned.row_id
        LEFT JOIN public.vendor_disclosure_ingest_record_bindings AS sibling_binding
          ON sibling_binding.run_sha256 = sibling_owned.run_sha256
          AND sibling_binding.batch_index = sibling_owned.batch_index
          AND sibling_binding.unit_id = sibling_owned.unit_id
          AND sibling_binding.row_kind = sibling_owned.row_kind
          AND sibling_binding.row_id = sibling_owned.row_id
        WHERE sibling_owned.run_sha256 = owned.run_sha256
          AND sibling_owned.unit_id = owned.unit_id
      ) AS sibling
    ) AS validation_evidence
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'bucket_id', storage_link.bucket_id,
        'object_name', storage_link.object_name,
        'object_sha256', storage_link.object_sha256,
        'object_bytes', storage_link.object_bytes,
        'ownership_state', storage_link.ownership_state,
        'storage_object_id', storage_link.storage_object_id,
        'storage_object_updated_at', storage_link.storage_object_updated_at,
        'live_object_id', storage_object.id,
        'live_object_updated_at', storage_object.updated_at,
        'live_object_size', storage_object.metadata ->> 'size',
        'live_ingest_owner', storage_object.user_metadata ->> 'ingest_run_sha256',
        'live_ingest_sha256', storage_object.user_metadata ->> 'ingest_sha256',
        'live_ingest_bytes', storage_object.user_metadata ->> 'ingest_bytes',
        'bucket_public', storage_bucket.public
      ) ORDER BY storage_link.bucket_id, storage_link.object_name), '[]'::jsonb) AS lineage
      FROM public.vendor_disclosure_ingest_storage_links AS storage_link
      JOIN storage.objects AS storage_object
        ON storage_object.bucket_id = storage_link.bucket_id
        AND storage_object.name = storage_link.object_name
      JOIN storage.buckets AS storage_bucket ON storage_bucket.id = storage_link.bucket_id
      WHERE storage_link.run_sha256 = owned.run_sha256
        AND (
          (storage_link.bucket_id = 'disclosure-raw'
            AND storage_link.object_name = ANY(price.source_object_keys))
          OR (storage_link.bucket_id = 'disclosure-preview'
            AND storage_link.object_name = ANY(price.source_preview_keys))
        )
    ) AS storage_evidence
    -- The eligibility RPC reads one extra row to expose whether another
    -- human-confirmed batch remains. The approval RPC itself is still capped
    -- at 25 and only fingerprints/approves the first p_batch_limit rows.
    WHERE p_batch_limit BETWEEN 1 AND 26
      AND run.authorization_kind = 'paid_pilot_gate'
      AND cardinality(run.local_pending_only_unit_ids) = 0
      AND provider_lineage.provider_mode = 'production_paid'
      AND provider_lineage.bulk_approval_eligible = true
      AND provider_lineage.paid_plan_sha256 ~ '^[0-9a-f]{64}$'
      AND provider_lineage.successful_ledger_id IS NOT NULL
      AND NULLIF(btrim(provider_lineage.provider_model), '') IS NOT NULL
      AND provider_owned_ledger.created_by_run = true
      AND provider_owned_ledger.cleanup_status = 'owned'
      AND (
        SELECT count(*)
        FROM public.vendor_disclosure_ingest_owned_ledger_rows AS any_ledger_owner
        WHERE any_ledger_owner.ledger_id = provider_owned_ledger.ledger_id
      ) = 1
      AND provider_ledger.session_id = 'disclosure_ingest'
      AND provider_ledger.interaction_type = 'disclosure_extraction'
      AND provider_ledger.tool_name = 'disclosure_extraction'
      AND provider_ledger.success = true
      AND provider_ledger.error_message IS NULL
      AND provider_ledger.model = provider_lineage.provider_model
      AND provider_ledger.metadata ->> 'source' = 'local_disclosure_ingest'
      AND provider_ledger.metadata ->> 'unit_id' = owned.unit_id
      AND provider_ledger.metadata ->> 'ledger_schema_version' = '3'
      AND provider_ledger.metadata ->> 'provider_mode' = 'production_paid'
      AND provider_ledger.metadata ->> 'paid_plan_sha256' = provider_lineage.paid_plan_sha256
      AND provider_ledger.metadata ->> 'provider_model' = provider_lineage.provider_model
      AND provider_ledger.metadata ->> 'request_hash' = provider_lineage.request_hash
      AND provider_ledger.metadata ->> 'fingerprint' = provider_lineage.extraction_fingerprint
      AND run.status = 'complete'
      AND run.completed_batch_count = run.batch_count
      AND run.dedupe_finalized_at IS NOT NULL
      AND run.dedupe_candidates_sha256 IS NOT NULL
      AND run.dedupe_payload_sha256 IS NOT NULL
      AND owned.unit_id = ANY(batch.unit_ids)
      AND (
        SELECT count(*) FROM public.vendor_disclosure_ingest_batches AS completed_batch
        WHERE completed_batch.run_sha256 = run.run_sha256
      ) = run.batch_count
      AND (
        SELECT count(*) FROM public.vendor_disclosure_ingest_owned_rows AS owner_check
        WHERE owner_check.row_kind = 'official_price' AND owner_check.row_id = price.id
      ) = 1
      AND (
        SELECT count(*) FROM public.vendor_disclosure_ingest_identity_links AS identity_link
        WHERE identity_link.run_sha256 = owned.run_sha256
          AND identity_link.unit_id = owned.unit_id
          AND identity_link.identity_kind = 'vendor'
          AND identity_link.official_price_id = price.id
          AND identity_link.vendor_id = price.vendor_id
          AND identity_link.record_ref = price_binding.record_ref
      ) = 1
      AND snapshot.published = false
      AND snapshot.is_current = false
      AND snapshot.published_at IS NULL
      AND price.review_status = 'pending'
      AND price.needs_review = false
      AND cardinality(price.validation_issue_codes) = 0
      AND price.confidence >= 0.9
      AND price.edited_by_admin = false
      AND price.reviewed_by IS NULL
      AND price.reviewed_at IS NULL
      AND price.review_action IS NULL
      AND price.review_version = 0
      AND price.source_record_key ~ '^[0-9a-f]{64}$'
      AND NULLIF(btrim(price.source_file), '') IS NOT NULL
      AND NULLIF(btrim(price.source_quote), '') IS NOT NULL
      AND cardinality(price.source_object_keys) > 0
      AND cardinality(price.source_preview_keys) > 0
      AND cardinality(price.source_object_keys) = cardinality(ARRAY(
        SELECT DISTINCT source_key FROM unnest(price.source_object_keys) AS source(source_key)
      ))
      AND cardinality(price.source_preview_keys) = cardinality(ARRAY(
        SELECT DISTINCT preview_key FROM unnest(price.source_preview_keys) AS preview(preview_key)
      ))
      AND NOT EXISTS (
        SELECT 1 FROM unnest(price.source_object_keys) AS source(source_key)
        WHERE NULLIF(btrim(source.source_key), '') IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.vendor_disclosure_ingest_storage_links AS raw_link
            JOIN storage.objects AS raw_object
              ON raw_object.bucket_id = raw_link.bucket_id
              AND raw_object.name = raw_link.object_name
            JOIN storage.buckets AS raw_bucket ON raw_bucket.id = raw_link.bucket_id
            WHERE raw_link.run_sha256 = owned.run_sha256
              AND raw_link.bucket_id = 'disclosure-raw'
              AND raw_link.object_name = source.source_key
              AND raw_link.object_name ~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
              AND split_part(raw_link.object_name, '.', 1) = raw_link.object_sha256
              AND raw_link.ownership_state IN (
                'confirmed_created', 'confirmed_preexisting', 'confirmed_inherited', 'retained_shared'
              )
              AND raw_link.storage_object_id IS NOT NULL
              AND raw_link.storage_object_updated_at IS NOT NULL
              AND raw_object.id = raw_link.storage_object_id
              AND raw_object.updated_at = raw_link.storage_object_updated_at
              AND raw_object.metadata ->> 'size' = raw_link.object_bytes::text
              AND raw_bucket.public = false
              AND raw_link.storage_metadata_owner_run_sha256 ~ '^[0-9a-f]{64}$'
              AND raw_object.user_metadata ->> 'ingest_run_sha256'
                = raw_link.storage_metadata_owner_run_sha256
              AND raw_object.user_metadata ->> 'ingest_sha256' = raw_link.object_sha256
              AND raw_object.user_metadata ->> 'ingest_bytes' = raw_link.object_bytes::text
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(price.source_preview_keys) AS preview(preview_key)
        WHERE NULLIF(btrim(preview.preview_key), '') IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.vendor_disclosure_ingest_storage_links AS preview_link
            JOIN storage.objects AS preview_object
              ON preview_object.bucket_id = preview_link.bucket_id
              AND preview_object.name = preview_link.object_name
            JOIN storage.buckets AS preview_bucket ON preview_bucket.id = preview_link.bucket_id
            WHERE preview_link.run_sha256 = owned.run_sha256
              AND preview_link.bucket_id = 'disclosure-preview'
              AND preview_link.object_name = preview.preview_key
              AND preview_link.object_name ~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|txt)$'
              AND split_part(preview_link.object_name, '.', 1) = preview_link.object_sha256
              AND preview_link.ownership_state IN (
                'confirmed_created', 'confirmed_preexisting', 'confirmed_inherited', 'retained_shared'
              )
              AND preview_link.storage_object_id IS NOT NULL
              AND preview_link.storage_object_updated_at IS NOT NULL
              AND preview_object.id = preview_link.storage_object_id
              AND preview_object.updated_at = preview_link.storage_object_updated_at
              AND preview_object.metadata ->> 'size' = preview_link.object_bytes::text
              AND preview_bucket.public = false
              AND preview_link.storage_metadata_owner_run_sha256 ~ '^[0-9a-f]{64}$'
              AND preview_object.user_metadata ->> 'ingest_run_sha256'
                = preview_link.storage_metadata_owner_run_sha256
              AND preview_object.user_metadata ->> 'ingest_sha256' = preview_link.object_sha256
              AND preview_object.user_metadata ->> 'ingest_bytes' = preview_link.object_bytes::text
          )
      )
      AND (price.price_min_krw IS NOT NULL OR price.price_max_krw IS NOT NULL)
      AND vendor.status = 'approved'
      AND vendor.merged_into_vendor_id IS NULL
      AND NULLIF(btrim(vendor.region_code), '') IS NOT NULL
      AND vendor.category = CASE WHEN price.category = 'hall' THEN 'venue' ELSE price.category END
      AND (
        price.agency_id IS NULL
        OR (
          agency.id IS NOT NULL
          AND agency.is_active = true
          AND agency.merged_into_agency_id IS NULL
          AND (
            SELECT count(*) FROM public.vendor_disclosure_ingest_identity_links AS agency_link
            WHERE agency_link.run_sha256 = owned.run_sha256
              AND agency_link.unit_id = owned.unit_id
              AND agency_link.identity_kind = 'agency'
              AND agency_link.agency_id = price.agency_id
          ) = 1
          AND NOT EXISTS (
            SELECT 1 FROM public.agency_dedupe_candidates AS agency_candidate
            WHERE agency_candidate.status = 'pending'
              AND price.agency_id IN (
                agency_candidate.left_agency_id, agency_candidate.right_agency_id
              )
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.vendor_dedupe_candidates AS dedupe_candidate
        WHERE dedupe_candidate.status = 'pending'
          AND price.vendor_id IN (dedupe_candidate.left_vendor_id, dedupe_candidate.right_vendor_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.vendor_alias_proposals AS alias_proposal
        WHERE alias_proposal.official_price_id = price.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.official_review_events AS review_event
        WHERE review_event.entity_kind = 'price' AND review_event.entity_id = price.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.official_price_options AS option_row
        WHERE option_row.official_price_id = price.id
          AND (
            NULLIF(btrim(option_row.name), '') IS NULL
            OR NULLIF(btrim(option_row.source_file), '') IS NULL
            OR NULLIF(btrim(option_row.source_quote), '') IS NULL
            OR cardinality(option_row.source_object_keys) = 0
            OR NOT price.source_object_keys @> option_row.source_object_keys
            OR option_row.confidence IS NULL
            OR option_row.confidence < 0.9
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.vendor_disclosure_ingest_owned_rows AS sibling_owned
        LEFT JOIN public.official_prices AS sibling_price
          ON sibling_owned.row_kind = 'official_price' AND sibling_price.id = sibling_owned.row_id
        LEFT JOIN public.official_agency_packages AS sibling_package
          ON sibling_owned.row_kind = 'agency_package' AND sibling_package.id = sibling_owned.row_id
        LEFT JOIN public.disclosure_semantic_staging AS sibling_semantic
          ON sibling_owned.row_kind = 'semantic' AND sibling_semantic.id = sibling_owned.row_id
        LEFT JOIN public.vendor_disclosure_ingest_record_bindings AS sibling_binding
          ON sibling_binding.run_sha256 = sibling_owned.run_sha256
          AND sibling_binding.batch_index = sibling_owned.batch_index
          AND sibling_binding.unit_id = sibling_owned.unit_id
          AND sibling_binding.row_kind = sibling_owned.row_kind
          AND sibling_binding.row_id = sibling_owned.row_id
        WHERE sibling_owned.run_sha256 = owned.run_sha256
          AND sibling_owned.unit_id = owned.unit_id
          AND CASE sibling_owned.row_kind
            WHEN 'official_price' THEN sibling_price.id IS NULL
              OR sibling_binding.row_id IS NULL
              OR sibling_binding.vendor_id IS DISTINCT FROM sibling_price.vendor_id
              OR sibling_binding.agency_id IS DISTINCT FROM sibling_price.agency_id
              OR sibling_binding.linked_official_price_id IS NOT NULL
              OR (
                SELECT count(*)
                FROM public.vendor_disclosure_ingest_identity_links AS sibling_vendor_link
                WHERE sibling_vendor_link.run_sha256 = sibling_owned.run_sha256
                  AND sibling_vendor_link.unit_id = sibling_owned.unit_id
                  AND sibling_vendor_link.identity_kind = 'vendor'
                  AND sibling_vendor_link.official_price_id = sibling_price.id
                  AND sibling_vendor_link.vendor_id = sibling_binding.vendor_id
                  AND sibling_vendor_link.record_ref = sibling_binding.record_ref
              ) <> 1
              OR NOT EXISTS (
                SELECT 1 FROM public.vendors AS sibling_vendor
                WHERE sibling_vendor.id = sibling_binding.vendor_id
                  AND sibling_vendor.status = 'approved'
                  AND sibling_vendor.merged_into_vendor_id IS NULL
                  AND NULLIF(btrim(sibling_vendor.region_code), '') IS NOT NULL
                  AND sibling_vendor.category = CASE
                    WHEN sibling_price.category = 'hall' THEN 'venue'
                    ELSE sibling_price.category
                  END
              )
              OR (
                sibling_binding.agency_id IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM public.agencies AS sibling_agency
                  WHERE sibling_agency.id = sibling_binding.agency_id
                    AND sibling_agency.is_active = true
                    AND sibling_agency.merged_into_agency_id IS NULL
                )
              )
              OR sibling_price.needs_review
              OR cardinality(sibling_price.validation_issue_codes) <> 0
              OR sibling_price.confidence IS NULL
              OR sibling_price.confidence < 0.9
            WHEN 'agency_package' THEN sibling_package.id IS NULL
              OR sibling_binding.row_id IS NULL
              OR sibling_binding.vendor_id IS NOT NULL
              OR sibling_binding.agency_id IS DISTINCT FROM sibling_package.agency_id
              OR sibling_binding.linked_official_price_id IS NOT NULL
              OR NOT EXISTS (
                SELECT 1 FROM public.agencies AS sibling_package_agency
                WHERE sibling_package_agency.id = sibling_binding.agency_id
                  AND sibling_package_agency.is_active = true
                  AND sibling_package_agency.merged_into_agency_id IS NULL
              )
              OR sibling_package.needs_review
              OR cardinality(sibling_package.validation_issue_codes) <> 0
              OR sibling_package.confidence IS NULL
              OR sibling_package.confidence < 0.9
            WHEN 'semantic' THEN sibling_semantic.id IS NULL
              OR sibling_binding.row_id IS NULL
              OR sibling_semantic.unit_id IS DISTINCT FROM sibling_owned.unit_id
              OR sibling_binding.agency_id IS NOT NULL
              OR sibling_binding.vendor_id IS DISTINCT FROM sibling_semantic.partner_vendor_id
              OR sibling_binding.linked_official_price_id
                IS DISTINCT FROM sibling_semantic.official_price_id
              OR (
                sibling_semantic.record_kind = 'vendor_policy'
                AND (
                  sibling_binding.vendor_id IS NULL
                  OR (
                    SELECT count(*)
                    FROM public.vendor_disclosure_ingest_identity_links AS semantic_vendor_link
                    WHERE semantic_vendor_link.run_sha256 = sibling_owned.run_sha256
                      AND semantic_vendor_link.unit_id = sibling_owned.unit_id
                      AND semantic_vendor_link.identity_kind = 'vendor'
                      AND semantic_vendor_link.record_ref = sibling_binding.record_ref
                      AND semantic_vendor_link.vendor_id = sibling_binding.vendor_id
                      AND semantic_vendor_link.official_price_id
                        IS NOT DISTINCT FROM sibling_binding.linked_official_price_id
                  ) <> 1
                  OR (
                    sibling_binding.linked_official_price_id IS NOT NULL
                    AND NOT EXISTS (
                      SELECT 1
                      FROM public.vendor_disclosure_ingest_owned_rows AS linked_price_owner
                      JOIN public.official_prices AS linked_price
                        ON linked_price_owner.row_kind = 'official_price'
                        AND linked_price.id = linked_price_owner.row_id
                      JOIN public.vendor_disclosure_ingest_record_bindings AS linked_price_binding
                        ON linked_price_binding.run_sha256 = linked_price_owner.run_sha256
                        AND linked_price_binding.unit_id = linked_price_owner.unit_id
                        AND linked_price_binding.row_kind = linked_price_owner.row_kind
                        AND linked_price_binding.row_id = linked_price_owner.row_id
                      WHERE linked_price_owner.run_sha256 = sibling_owned.run_sha256
                        AND linked_price_owner.unit_id = sibling_owned.unit_id
                        AND linked_price.id = sibling_binding.linked_official_price_id
                        AND linked_price.vendor_id = sibling_binding.vendor_id
                        AND linked_price_binding.vendor_id = sibling_binding.vendor_id
                        AND linked_price_binding.record_ref = sibling_binding.record_ref
                    )
                  )
                )
              )
              OR (
                sibling_semantic.record_kind = 'document_section'
                AND (
                  sibling_binding.vendor_id IS NOT NULL
                  OR sibling_binding.linked_official_price_id IS NOT NULL
                )
              )
              OR sibling_semantic.needs_review
              OR cardinality(sibling_semantic.validation_issue_codes) <> 0
              OR sibling_semantic.confidence IS NULL
              OR sibling_semantic.confidence < 0.9
            ELSE true
          END
      )
    ORDER BY price.id
    LIMIT p_batch_limit
  )
  SELECT eligible.price_id, eligible.eligibility_entry
  FROM eligible
  ORDER BY eligible.price_id;
$vendor_disclosure_bulk_approval_candidates$;

CREATE OR REPLACE FUNCTION public.get_vendor_disclosure_bulk_approval_eligibility(
  p_actor_id uuid,
  p_batch_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $get_vendor_disclosure_bulk_approval_eligibility$
DECLARE
  batch_eligible_count integer;
  has_more boolean;
  eligibility_sha256 text;
BEGIN
  IF p_batch_limit IS NULL OR NOT p_batch_limit BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'BULK_APPROVAL_INVALID_BATCH_LIMIT' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles AS actor_profile
    WHERE actor_profile.id = p_actor_id AND actor_profile.is_admin = true
  ) THEN
    RAISE EXCEPTION 'BULK_APPROVAL_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  WITH bounded_candidates AS MATERIALIZED (
    SELECT candidate.price_id, candidate.eligibility_entry
    FROM public.vendor_disclosure_bulk_approval_candidates(p_batch_limit + 1) AS candidate
    ORDER BY candidate.price_id
  ), batch_candidates AS MATERIALIZED (
    SELECT candidate.price_id, candidate.eligibility_entry
    FROM bounded_candidates AS candidate
    ORDER BY candidate.price_id
    LIMIT p_batch_limit
  )
  SELECT
    (SELECT count(*)::integer FROM batch_candidates),
    (SELECT count(*) > p_batch_limit FROM bounded_candidates),
    CASE WHEN NOT EXISTS (SELECT 1 FROM batch_candidates) THEN NULL ELSE
      encode(extensions.digest(convert_to((
        SELECT jsonb_agg(candidate.eligibility_entry ORDER BY candidate.price_id)::text
        FROM batch_candidates AS candidate
      ), 'UTF8'), 'sha256'), 'hex')
    END
  INTO batch_eligible_count, has_more, eligibility_sha256;

  RETURN jsonb_build_object(
    'eligibility_contract_version', 1,
    'batch_eligible_count', batch_eligible_count,
    'has_more', has_more,
    'eligibility_sha256', eligibility_sha256
  );
END;
$get_vendor_disclosure_bulk_approval_eligibility$;

CREATE OR REPLACE FUNCTION public.approve_vendor_disclosure_validated_batch(
  p_actor_id uuid,
  p_batch_limit integer,
  p_expected_eligible_count integer,
  p_expected_eligibility_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '5s'
SET statement_timeout = '120s'
AS $approve_vendor_disclosure_validated_batch$
DECLARE
  candidate_ids uuid[];
  recomputed_count integer;
  recomputed_sha256 text;
  price_row public.official_prices%ROWTYPE;
  option_payload jsonb;
  approved_price_ids uuid[] := '{}'::uuid[];
  approval_receipt_sha256 text;
BEGIN
  IF p_batch_limit IS NULL OR NOT p_batch_limit BETWEEN 1 AND 25
    OR p_expected_eligible_count IS NULL
    OR NOT p_expected_eligible_count BETWEEN 1 AND p_batch_limit
    OR p_expected_eligibility_sha256 IS NULL
    OR p_expected_eligibility_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'BULK_APPROVAL_INVALID_CONFIRMATION' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'BULK_APPROVAL_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM actor_profile.id
  FROM public.profiles AS actor_profile
  WHERE actor_profile.id = p_actor_id AND actor_profile.is_admin = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BULK_APPROVAL_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('vendor-disclosure-bulk-approval-v1', 0));
  -- Serialize with the canonical vendor dedupe decision function, then block
  -- phantoms in the disclosure-owned domain tables. Shared hot tables are
  -- protected below with exact candidate-lineage row locks instead.
  PERFORM pg_advisory_xact_lock(20260718, 20300);
  LOCK TABLE public.vendor_dedupe_candidates, public.agency_dedupe_candidates,
    public.vendor_alias_proposals, public.vendors, public.agencies,
    public.official_prices, public.official_price_options,
    public.official_review_events, public.price_snapshots,
    public.vendor_disclosure_ingest_runs, public.vendor_disclosure_ingest_batches,
    public.vendor_disclosure_ingest_owned_rows,
    public.vendor_disclosure_ingest_record_bindings,
    public.vendor_disclosure_ingest_identity_links,
    public.vendor_disclosure_ingest_owned_ledger_rows,
    public.vendor_disclosure_paid_extraction_attestations,
    public.vendor_disclosure_ingest_unit_provider_lineage,
    public.vendor_disclosure_ingest_storage_links,
    public.official_agency_packages, public.disclosure_semantic_staging
    IN SHARE MODE NOWAIT;

  SELECT COALESCE(array_agg(candidate.price_id ORDER BY candidate.price_id), '{}'::uuid[])
  INTO candidate_ids
  FROM public.vendor_disclosure_bulk_approval_candidates(p_batch_limit) AS candidate;

  -- The parent locks also serialize option writes through the existing option
  -- guard. Recompute only after these row locks are held; a mismatch aborts the
  -- entire transaction before any review mutation.
  PERFORM price.id
  FROM public.official_prices AS price
  WHERE price.id = ANY(candidate_ids)
  ORDER BY price.id
  FOR UPDATE;

  -- Lock only the provider-ledger and Storage rows that are part of the
  -- selected candidates' attested lineage. This keeps Amora logging and
  -- unrelated uploads writable while making any concurrent mutation of the
  -- human-confirmed evidence either wait/fail or appear in the recomputation.
  PERFORM provider_ledger.id
  FROM public.ai_interactions_log AS provider_ledger
  JOIN public.vendor_disclosure_ingest_unit_provider_lineage AS provider_lineage
    ON provider_lineage.successful_ledger_id = provider_ledger.id
  JOIN public.vendor_disclosure_ingest_owned_rows AS owned
    ON owned.run_sha256 = provider_lineage.run_sha256
    AND owned.batch_index = provider_lineage.batch_index
    AND owned.unit_id = provider_lineage.unit_id
    AND owned.row_kind = 'official_price'
  WHERE owned.row_id = ANY(candidate_ids)
  ORDER BY provider_ledger.id
  FOR SHARE OF provider_ledger NOWAIT;

  PERFORM storage_bucket.id
  FROM storage.buckets AS storage_bucket
  WHERE storage_bucket.id IN (
    SELECT DISTINCT storage_link.bucket_id
    FROM public.vendor_disclosure_ingest_owned_rows AS owned
    JOIN public.official_prices AS candidate_price
      ON owned.row_kind = 'official_price'
      AND candidate_price.id = owned.row_id
    JOIN public.vendor_disclosure_ingest_storage_links AS storage_link
      ON storage_link.run_sha256 = owned.run_sha256
      AND (
        (storage_link.bucket_id = 'disclosure-raw'
          AND storage_link.object_name = ANY(candidate_price.source_object_keys))
        OR (storage_link.bucket_id = 'disclosure-preview'
          AND storage_link.object_name = ANY(candidate_price.source_preview_keys))
      )
    WHERE candidate_price.id = ANY(candidate_ids)
  )
  ORDER BY storage_bucket.id
  FOR SHARE OF storage_bucket NOWAIT;

  PERFORM storage_object.id
  FROM storage.objects AS storage_object
  JOIN public.vendor_disclosure_ingest_storage_links AS storage_link
    ON storage_link.bucket_id = storage_object.bucket_id
    AND storage_link.object_name = storage_object.name
  JOIN public.vendor_disclosure_ingest_owned_rows AS owned
    ON owned.run_sha256 = storage_link.run_sha256
    AND owned.row_kind = 'official_price'
  JOIN public.official_prices AS candidate_price
    ON candidate_price.id = owned.row_id
    AND (
      (storage_link.bucket_id = 'disclosure-raw'
        AND storage_link.object_name = ANY(candidate_price.source_object_keys))
      OR (storage_link.bucket_id = 'disclosure-preview'
        AND storage_link.object_name = ANY(candidate_price.source_preview_keys))
    )
  WHERE candidate_price.id = ANY(candidate_ids)
  ORDER BY storage_object.id
  FOR SHARE OF storage_object NOWAIT;

  SELECT count(*)::integer,
    CASE WHEN count(*) = 0 THEN NULL ELSE encode(extensions.digest(
      convert_to(jsonb_agg(candidate.eligibility_entry ORDER BY candidate.price_id)::text, 'UTF8'),
      'sha256'
    ), 'hex') END
  INTO recomputed_count, recomputed_sha256
  FROM public.vendor_disclosure_bulk_approval_candidates(p_batch_limit) AS candidate;

  IF recomputed_count IS DISTINCT FROM p_expected_eligible_count
    OR recomputed_sha256 IS DISTINCT FROM p_expected_eligibility_sha256
    OR candidate_ids IS DISTINCT FROM ARRAY(
      SELECT candidate.price_id
      FROM public.vendor_disclosure_bulk_approval_candidates(p_batch_limit) AS candidate
      ORDER BY candidate.price_id
    )
  THEN
    RAISE EXCEPTION 'BULK_APPROVAL_ELIGIBILITY_CHANGED' USING ERRCODE = '40001';
  END IF;

  FOR price_row IN
    SELECT price.* FROM public.official_prices AS price
    WHERE price.id = ANY(candidate_ids)
    ORDER BY price.id
    FOR UPDATE
  LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', option_row.id,
      'name', option_row.name,
      'price_min_krw', option_row.price_min_krw,
      'price_max_krw', option_row.price_max_krw,
      'unit', option_row.unit,
      'condition', option_row.condition,
      'raw_text', option_row.raw_text,
      'source_quote', option_row.source_quote,
      'confidence', option_row.confidence
    ) ORDER BY option_row.id), '[]'::jsonb)
    INTO option_payload
    FROM public.official_price_options AS option_row
    WHERE option_row.official_price_id = price_row.id;

    PERFORM public.review_official_price(
      price_row.id,
      p_actor_id,
      'approve',
      jsonb_build_object(
        'category', price_row.category,
        'item_name', price_row.item_name,
        'base_spec', price_row.base_spec,
        'price_min_krw', price_row.price_min_krw,
        'price_max_krw', price_row.price_max_krw,
        'vat_note', price_row.vat_note,
        'price_note', price_row.price_note,
        'source_quote', price_row.source_quote,
        'confidence', price_row.confidence
      ),
      option_payload,
      price_row.review_version
    );
    approved_price_ids := array_append(approved_price_ids, price_row.id);
  END LOOP;

  IF NOT public.vendor_disclosure_uuid_batch_is_safe(
      approved_price_ids, p_expected_eligible_count
    )
    OR EXISTS (
      SELECT 1 FROM unnest(approved_price_ids) AS approved(price_id)
      LEFT JOIN public.official_prices AS approved_price ON approved_price.id = approved.price_id
      LEFT JOIN public.official_review_events AS review_event
        ON review_event.entity_kind = 'price'
        AND review_event.entity_id = approved.price_id
        AND review_event.actor_id = p_actor_id
        AND review_event.action = 'approve'
        AND review_event.from_review_version = 0
        AND review_event.to_review_version = 1
      WHERE approved_price.review_status IS DISTINCT FROM 'approved'
        OR approved_price.needs_review IS DISTINCT FROM false
        OR approved_price.reviewed_by IS DISTINCT FROM p_actor_id
        OR approved_price.review_action IS DISTINCT FROM 'approve'
        OR approved_price.review_version IS DISTINCT FROM 1
        OR review_event.id IS NULL
    )
  THEN
    RAISE EXCEPTION 'BULK_APPROVAL_ATOMIC_POSTCONDITION_FAILED' USING ERRCODE = '55000';
  END IF;

  approval_receipt_sha256 := encode(extensions.digest(convert_to(jsonb_build_object(
    'eligibility_contract_version', 1,
    'actor_id', p_actor_id,
    'eligibility_sha256', p_expected_eligibility_sha256,
    'approved_price_ids', to_jsonb(approved_price_ids),
    'review_events', (
      SELECT jsonb_agg(jsonb_build_object(
        'entity_id', review_event.entity_id,
        'to_review_version', review_event.to_review_version,
        'change_hash', review_event.change_hash
      ) ORDER BY review_event.entity_id)
      FROM public.official_review_events AS review_event
      WHERE review_event.entity_kind = 'price'
        AND review_event.entity_id = ANY(approved_price_ids)
        AND review_event.actor_id = p_actor_id
        AND review_event.action = 'approve'
        AND review_event.from_review_version = 0
        AND review_event.to_review_version = 1
    )
  )::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.vendor_disclosure_bulk_approval_audits (
    actor_id, eligibility_contract_version, eligibility_sha256,
    approved_count, approved_price_ids, approval_receipt_sha256
  ) VALUES (
    p_actor_id, 1, p_expected_eligibility_sha256,
    p_expected_eligible_count, approved_price_ids, approval_receipt_sha256
  );

  RETURN jsonb_build_object(
    'eligibility_contract_version', 1,
    'approved_count', p_expected_eligible_count,
    'approved_price_ids', to_jsonb(approved_price_ids),
    'approval_receipt_sha256', approval_receipt_sha256
  );
END;
$approve_vendor_disclosure_validated_batch$;

-- Preserve the existing dedupe implementations behind a marker-owning RPC
-- wrapper. The marker names the exact losing:preserved identity transition;
-- direct service-role DML can copy the text but cannot acquire postgres as
-- current_user, while FK cascades cannot manufacture the marker at all.
ALTER FUNCTION public.decide_vendor_dedupe_candidate(uuid, text, uuid, uuid)
  RENAME TO decide_vendor_dedupe_candidate_atomic_inner;
REVOKE ALL ON FUNCTION public.decide_vendor_dedupe_candidate_atomic_inner(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decide_vendor_dedupe_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_preserved_vendor_id uuid,
  p_decided_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $decide_vendor_dedupe_candidate_atomic_wrapper$
DECLARE
  losing_vendor_id uuid;
BEGIN
  IF p_decision = 'same' THEN
    SELECT CASE
      WHEN candidate.left_vendor_id = p_preserved_vendor_id
        THEN candidate.right_vendor_id
      WHEN candidate.right_vendor_id = p_preserved_vendor_id
        THEN candidate.left_vendor_id
    END
    INTO losing_vendor_id
    FROM public.vendor_dedupe_candidates AS candidate
    WHERE candidate.id = p_candidate_id
      AND candidate.status = 'pending'
    FOR SHARE;
    IF losing_vendor_id IS NULL THEN
      RAISE EXCEPTION 'VENDOR_DEDUPE_ATOMIC_MAPPING_CONTEXT_INVALID'
        USING ERRCODE = '23514';
    END IF;
    PERFORM set_config(
      'app.vendor_disclosure_atomic_vendor_dedupe_mapping',
      losing_vendor_id::text || ':' || p_preserved_vendor_id::text,
      true
    );
  END IF;
  PERFORM public.decide_vendor_dedupe_candidate_atomic_inner(
    p_candidate_id, p_decision, p_preserved_vendor_id, p_decided_by
  );
  PERFORM set_config(
    'app.vendor_disclosure_atomic_vendor_dedupe_mapping', '', true
  );
END;
$decide_vendor_dedupe_candidate_atomic_wrapper$;

ALTER FUNCTION public.decide_agency_dedupe_candidate(uuid, text, uuid, uuid)
  RENAME TO decide_agency_dedupe_candidate_atomic_inner;
REVOKE ALL ON FUNCTION public.decide_agency_dedupe_candidate_atomic_inner(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decide_agency_dedupe_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_preserved_agency_id uuid,
  p_decided_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $decide_agency_dedupe_candidate_atomic_wrapper$
DECLARE
  losing_agency_id uuid;
BEGIN
  IF p_decision = 'same' THEN
    SELECT CASE
      WHEN candidate.left_agency_id = p_preserved_agency_id
        THEN candidate.right_agency_id
      WHEN candidate.right_agency_id = p_preserved_agency_id
        THEN candidate.left_agency_id
    END
    INTO losing_agency_id
    FROM public.agency_dedupe_candidates AS candidate
    WHERE candidate.id = p_candidate_id
      AND candidate.status = 'pending'
    FOR SHARE;
    IF losing_agency_id IS NULL THEN
      RAISE EXCEPTION 'AGENCY_DEDUPE_ATOMIC_MAPPING_CONTEXT_INVALID'
        USING ERRCODE = '23514';
    END IF;
    PERFORM set_config(
      'app.vendor_disclosure_atomic_agency_dedupe_mapping',
      losing_agency_id::text || ':' || p_preserved_agency_id::text,
      true
    );
  END IF;
  PERFORM public.decide_agency_dedupe_candidate_atomic_inner(
    p_candidate_id, p_decision, p_preserved_agency_id, p_decided_by
  );
  PERFORM set_config(
    'app.vendor_disclosure_atomic_agency_dedupe_mapping', '', true
  );
END;
$decide_agency_dedupe_candidate_atomic_wrapper$;

ALTER FUNCTION public.ensure_vendor_disclosure_agency_pending(text, integer, text, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.ensure_vendor_disclosure_vendor_pending(text, integer, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.guard_vendor_disclosure_atomic_pending_insert() OWNER TO postgres;
ALTER FUNCTION public.guard_vendor_disclosure_atomic_protected_write() OWNER TO postgres;
ALTER FUNCTION public.decide_vendor_dedupe_candidate_atomic_inner(
  uuid, text, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.decide_agency_dedupe_candidate_atomic_inner(
  uuid, text, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.decide_agency_dedupe_candidate(
  uuid, text, uuid, uuid
) OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_unit_ids_are_safe(text[]) OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_payload_provenance_is_safe(jsonb) OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_unit_payload_sha256(jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_persisted_unit_payload_sha256(text, text) OWNER TO postgres;
ALTER FUNCTION public.assert_vendor_disclosure_storage_intents_settled(text) OWNER TO postgres;
ALTER FUNCTION public.assert_vendor_disclosure_storage_upload_claims_settled(text) OWNER TO postgres;
ALTER FUNCTION public.prepare_vendor_disclosure_batch_storage_atomic(
  text, text, text, integer, integer, text, text, text, text, text[], jsonb
) OWNER TO postgres;
ALTER FUNCTION public.claim_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, uuid
) OWNER TO postgres;
ALTER FUNCTION public.record_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, boolean, uuid, bigint, uuid
) OWNER TO postgres;
ALTER FUNCTION public.stage_vendor_disclosure_batch_atomic(
  text, text, text, text, text, integer, integer, text, text, text, text, text[], jsonb, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.verify_vendor_disclosure_batch_receipt_atomic(
  text, text, text, text, text, integer, integer, text, text[]
) OWNER TO postgres;
ALTER FUNCTION public.finalize_vendor_disclosure_dedupe_atomic(
  text, text, text, text, text[], jsonb
) OWNER TO postgres;
ALTER FUNCTION public.invalidate_vendor_disclosure_completed_run_atomic(
  text, text, text, text
) OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_identity_has_external_references(regclass, uuid, regclass[]) OWNER TO postgres;
ALTER FUNCTION public.abort_vendor_disclosure_ingest_run_atomic(
  text, text, text, text
) OWNER TO postgres;
ALTER FUNCTION public.complete_vendor_disclosure_storage_rollback_atomic(
  text, text, text, text, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.get_vendor_disclosure_unowned_pending_counts() OWNER TO postgres;
ALTER FUNCTION public.get_vendor_disclosure_admin_preview_scope() OWNER TO postgres;
ALTER FUNCTION public.get_vendor_disclosure_admin_preview_vendor_scope(uuid) OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_uuid_batch_is_safe(uuid[], integer) OWNER TO postgres;
ALTER FUNCTION public.vendor_disclosure_bulk_approval_candidates(integer) OWNER TO postgres;
ALTER FUNCTION public.get_vendor_disclosure_bulk_approval_eligibility(uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.approve_vendor_disclosure_validated_batch(
  uuid, integer, integer, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ensure_vendor_disclosure_agency_pending(text, integer, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ensure_vendor_disclosure_vendor_pending(text, integer, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_vendor_disclosure_atomic_pending_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_vendor_disclosure_atomic_protected_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_vendor_dedupe_candidate_atomic_inner(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_agency_dedupe_candidate_atomic_inner(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_agency_dedupe_candidate(
  uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_unit_ids_are_safe(text[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_payload_provenance_is_safe(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_unit_payload_sha256(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_persisted_unit_payload_sha256(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_vendor_disclosure_storage_intents_settled(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_vendor_disclosure_storage_upload_claims_settled(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_vendor_disclosure_batch_storage_atomic(
  text, text, text, integer, integer, text, text, text, text, text[], jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, boolean, uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.stage_vendor_disclosure_batch_atomic(
  text, text, text, text, text, integer, integer, text, text, text, text, text[], jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_vendor_disclosure_batch_receipt_atomic(
  text, text, text, text, text, integer, integer, text, text[]
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_vendor_disclosure_dedupe_atomic(
  text, text, text, text, text[], jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.invalidate_vendor_disclosure_completed_run_atomic(
  text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_identity_has_external_references(regclass, uuid, regclass[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.abort_vendor_disclosure_ingest_run_atomic(
  text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_vendor_disclosure_storage_rollback_atomic(
  text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_vendor_disclosure_unowned_pending_counts()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_vendor_disclosure_admin_preview_scope()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_vendor_disclosure_admin_preview_vendor_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_uuid_batch_is_safe(uuid[], integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendor_disclosure_bulk_approval_candidates(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_vendor_disclosure_bulk_approval_eligibility(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_vendor_disclosure_validated_batch(
  uuid, integer, integer, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.prepare_vendor_disclosure_batch_storage_atomic(
  text, text, text, integer, integer, text, text, text, text, text[], jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_vendor_disclosure_storage_object_atomic(
  text, text, integer, text, text, text, bigint, boolean, uuid, bigint, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_vendor_disclosure_batch_atomic(
  text, text, text, text, text, integer, integer, text, text, text, text, text[], jsonb, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_vendor_disclosure_batch_receipt_atomic(
  text, text, text, text, text, integer, integer, text, text[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_vendor_disclosure_dedupe_atomic(
  text, text, text, text, text[], jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_vendor_disclosure_completed_run_atomic(
  text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.abort_vendor_disclosure_ingest_run_atomic(
  text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_vendor_disclosure_storage_rollback_atomic(
  text, text, text, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vendor_disclosure_unowned_pending_counts()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vendor_disclosure_admin_preview_scope()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vendor_disclosure_admin_preview_vendor_scope(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vendor_disclosure_bulk_approval_eligibility(
  uuid, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_vendor_disclosure_validated_batch(
  uuid, integer, integer, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_vendor_dedupe_candidate(
  uuid, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_agency_dedupe_candidate(
  uuid, text, uuid, uuid
) TO service_role;

DO $vendor_disclosure_atomic_insert_fence_postconditions$
DECLARE
  relation_name text;
  trigger_name text;
BEGIN
  FOR relation_name, trigger_name IN
    SELECT * FROM (VALUES
      ('official_prices', 'official_prices_atomic_pending_insert_fence'),
      ('official_agency_packages', 'official_agency_packages_atomic_pending_insert_fence'),
      ('disclosure_semantic_staging', 'disclosure_semantic_atomic_pending_insert_fence'),
      ('price_snapshots', 'price_snapshots_atomic_identity_fence'),
      ('official_prices', 'official_prices_atomic_protected_write_fence'),
      ('official_agency_packages', 'official_agency_packages_atomic_protected_write_fence'),
      ('disclosure_semantic_staging', 'disclosure_semantic_atomic_protected_write_fence'),
      ('official_price_options', 'official_price_options_atomic_protected_write_fence')
    ) AS expected(relation_name, trigger_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = format('public.%I', relation_name)::regclass
        AND trigger_row.tgname = trigger_name
        AND trigger_row.tgenabled = 'O'
        AND NOT trigger_row.tgisinternal
    ) THEN
      RAISE EXCEPTION 'DISCLOSURE_ATOMIC_INSERT_FENCE_POSTCONDITION_FAILED:%', relation_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF has_function_privilege(
      'service_role',
      'public.guard_vendor_disclosure_atomic_pending_insert()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.guard_vendor_disclosure_atomic_protected_write()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.decide_vendor_dedupe_candidate_atomic_inner(uuid,text,uuid,uuid)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.decide_agency_dedupe_candidate_atomic_inner(uuid,text,uuid,uuid)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.decide_vendor_dedupe_candidate(uuid,text,uuid,uuid)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.decide_agency_dedupe_candidate(uuid,text,uuid,uuid)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.get_vendor_disclosure_unowned_pending_counts()',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_INSERT_FENCE_PRIVILEGE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF has_table_privilege('service_role', 'public.price_snapshots', 'UPDATE')
    OR has_table_privilege('service_role', 'public.price_snapshots', 'DELETE')
    OR has_table_privilege('service_role', 'public.price_snapshots', 'TRUNCATE')
    OR has_table_privilege('service_role', 'public.official_prices', 'INSERT')
    OR has_table_privilege('service_role', 'public.official_prices', 'UPDATE')
    OR has_table_privilege('service_role', 'public.official_prices', 'DELETE')
    OR has_table_privilege('service_role', 'public.official_price_options', 'INSERT')
    OR has_table_privilege('service_role', 'public.official_price_options', 'UPDATE')
    OR has_table_privilege('service_role', 'public.official_price_options', 'DELETE')
    OR has_table_privilege('service_role', 'public.official_agency_packages', 'INSERT')
    OR has_table_privilege('service_role', 'public.official_agency_packages', 'UPDATE')
    OR has_table_privilege('service_role', 'public.official_agency_packages', 'DELETE')
    OR has_table_privilege('service_role', 'public.disclosure_semantic_staging', 'INSERT')
    OR has_table_privilege('service_role', 'public.disclosure_semantic_staging', 'UPDATE')
    OR has_table_privilege('service_role', 'public.disclosure_semantic_staging', 'DELETE')
  THEN
    RAISE EXCEPTION 'DISCLOSURE_ATOMIC_BASE_WRITE_PRIVILEGE_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END;
$vendor_disclosure_atomic_insert_fence_postconditions$;

COMMIT;
