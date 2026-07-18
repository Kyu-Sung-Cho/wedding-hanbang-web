// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260718202000_price_upload_confirmation_queue.sql",
  ),
  "utf8",
);

const ADMIN_ID = "90000000-0000-4000-8000-000000000001";
const VENDOR_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_VENDOR_ID = "30000000-0000-4000-8000-000000000002";
const AGENCY_ID = "40000000-0000-4000-8000-000000000001";
const EVIDENCE_KEY = `${"a".repeat(64)}.json`;

function uploadContext() {
  return {
    period_label: "2026Q3",
    source: "mixed",
    source_note: "operator-uploaded JSON",
    collected_at: "2026-07-18",
  };
}

function entryPayload(options: unknown[] = [{
  name: "Original files",
  price_min_krw: 100_000,
  price_max_krw: 100_000,
  unit: null,
  condition: null,
  raw_text: "Original files 100,000 KRW",
  is_effectively_mandatory: true,
}]) {
  return {
    vendor_name: "Sample Studio A",
    category: "studio",
    region_code: "seoul_gangnam3",
    aliases: ["Sample Studio Former"],
    prices: [{
      agency_slug: "sample-agency",
      price_min_krw: 1_000_000,
      price_max_krw: 1_200_000,
      price_note: null,
      base_spec: "Base package",
      options,
      source_record_key: `admin-json:${"b".repeat(64)}`,
      source_quote: "JSON /entries/0/prices/0/base_spec: Base package",
    }],
  };
}

function candidateSnapshot() {
  return [{
    vendor_id: VENDOR_ID,
    vendor_name: "Sample Studio",
    vendor_slug: "sample-studio",
    aliases: [],
    similarity: 0.72,
    match_kind: "similar",
  }];
}

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      slug text UNIQUE,
      category text NOT NULL,
      region_code text,
      aliases text[] NOT NULL DEFAULT '{}'::text[],
      status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.agencies (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      merged_into_agency_id uuid,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.price_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      period_label text NOT NULL,
      source text NOT NULL,
      source_note text,
      collected_at date NOT NULL,
      published_at date,
      is_current boolean NOT NULL DEFAULT false,
      published boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source, period_label)
    );
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES public.price_snapshots(id) ON DELETE CASCADE,
      vendor_id uuid REFERENCES public.vendors(id),
      agency_id uuid REFERENCES public.agencies(id),
      category text NOT NULL,
      item_name text NOT NULL,
      base_spec text,
      price_min_krw integer,
      price_max_krw integer,
      price_note text,
      review_status text NOT NULL DEFAULT 'pending',
      needs_review boolean NOT NULL DEFAULT true,
      validation_issue_codes text[] NOT NULL DEFAULT '{}'::text[],
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      source_record_key text,
      confidence numeric,
      edited_by_admin boolean NOT NULL DEFAULT false,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_action text,
      review_version bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (snapshot_id, source_record_key)
    );
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      official_price_id uuid NOT NULL REFERENCES public.official_prices(id) ON DELETE CASCADE,
      name text NOT NULL,
      price_min_krw integer,
      price_max_krw integer,
      unit text,
      condition text,
      raw_text text,
      source_file text,
      source_quote text,
      source_object_keys text[] NOT NULL DEFAULT '{}'::text[],
      confidence numeric,
      is_effectively_mandatory boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX official_price_options_identity_unique
      ON public.official_price_options (
        official_price_id, name, COALESCE(unit, ''), COALESCE(condition, '')
      );
    ALTER TABLE public.vendors OWNER TO postgres;
    ALTER TABLE public.agencies OWNER TO postgres;
    ALTER TABLE public.price_snapshots OWNER TO postgres;
    ALTER TABLE public.official_prices OWNER TO postgres;
    ALTER TABLE public.official_price_options OWNER TO postgres;

    CREATE FUNCTION public.disclosure_object_keys_are_safe(text[])
    RETURNS boolean LANGUAGE sql IMMUTABLE
    AS $$
      SELECT $1 IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM unnest($1) AS key(value)
        WHERE value !~ '^[0-9a-f]{64}\\.(json|pdf|png)$'
      )
    $$;
    CREATE FUNCTION public.normalize_price_vendor_name(text)
    RETURNS text LANGUAGE sql IMMUTABLE
    AS $$ SELECT lower(regexp_replace(COALESCE($1, ''), '[[:space:][:punct:]]+', '', 'g')) $$;
    CREATE FUNCTION public.match_vendor_for_price_upload(text, text)
    RETURNS TABLE (
      vendor_id uuid,
      vendor_name text,
      vendor_slug text,
      aliases text[],
      similarity double precision,
      match_kind text
    ) LANGUAGE sql STABLE AS $$
      SELECT vendor.id, vendor.name, vendor.slug, vendor.aliases,
        1::double precision, 'exact_name'::text
      FROM public.vendors AS vendor
      WHERE vendor.category = CASE WHEN $2 = 'hall' THEN 'venue' ELSE $2 END
        AND public.normalize_price_vendor_name(vendor.name)
          = public.normalize_price_vendor_name($1)
      ORDER BY vendor.id
      LIMIT 5
    $$;
    CREATE FUNCTION public.merge_vendor_aliases(uuid, text[])
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE public.vendors
      SET aliases = ARRAY(
        SELECT DISTINCT btrim(value)
        FROM unnest(aliases || $2) AS alias(value)
        WHERE NULLIF(btrim(value), '') IS NOT NULL
          AND btrim(value) <> name
        ORDER BY btrim(value)
      ), updated_at = now()
      WHERE id = $1;
    END
    $$;

    INSERT INTO public.vendors (id, name, slug, category, region_code, status)
    VALUES
      ('${VENDOR_ID}', 'Sample Studio', 'sample-studio', 'studio', 'seoul_gangnam3', 'approved'),
      ('${OTHER_VENDOR_ID}', 'Other Studio', 'other-studio', 'studio', 'seoul_gangnam3', 'approved');
    INSERT INTO public.agencies (id, name, slug)
    VALUES ('${AGENCY_ID}', 'Sample Agency', 'sample-agency');
  `);
  await db.exec(migration);
  return db;
}

async function enqueue(
  db: PGlite,
  payload = entryPayload(),
  context = uploadContext(),
  candidates = candidateSnapshot(),
) {
  return db.query<{ confirmation_id: string }>(`
    SELECT confirmation_id
    FROM public.enqueue_price_upload_confirmation(
      '${EVIDENCE_KEY}',
      0,
      '${JSON.stringify(context).replaceAll("'", "''")}'::jsonb,
      '${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb,
      ARRAY['${VENDOR_ID}']::uuid[],
      '${JSON.stringify(candidates).replaceAll("'", "''")}'::jsonb,
      '${ADMIN_ID}'
    )
  `);
}

describe("price upload confirmation queue migration", () => {
  it("serializes the category alias namespace before resolving a selected vendor", () => {
    const resolveStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.resolve_price_upload_confirmation",
    );
    const categoryLock = migration.indexOf("pg_advisory_xact_lock", resolveStart);
    const vendorRowLock = migration.indexOf("FOR UPDATE;", categoryLock);
    const aliasConflictScan = migration.indexOf("WITH requested_aliases AS", resolveStart);

    expect(resolveStart).toBeGreaterThanOrEqual(0);
    expect(categoryLock).toBeGreaterThan(resolveStart);
    expect(vendorRowLock).toBeGreaterThan(categoryLock);
    expect(aliasConflictScan).toBeGreaterThan(vendorRowLock);
  });

  it("matches a bounded request list in one service-only batch projection", async () => {
    const db = await createDatabase();
    try {
      const requests = [{ entry_index: 3, name: "Sample Studio", category: "studio" }];
      await db.exec("SET ROLE service_role;");
      const matched = await db.query<{ entry_index: number; candidates: unknown[] }>(`
        SELECT * FROM public.match_vendors_for_price_upload_batch(
          '${JSON.stringify(requests)}'::jsonb
        )
      `);
      expect(matched.rows).toEqual([{
        entry_index: 3,
        candidates: [expect.objectContaining({
          vendor_id: VENDOR_ID,
          match_kind: "exact_name",
        })],
      }]);
      await expect(db.query(`
        SELECT * FROM public.match_vendors_for_price_upload_batch(
          '${JSON.stringify([requests[0], requests[0]])}'::jsonb
        )
      `)).rejects.toThrow(/PRICE_UPLOAD_MATCH_BATCH_INVALID_INPUT/u);
      await db.exec("RESET ROLE;");
      await db.exec("SET ROLE authenticated;");
      await expect(db.query(`
        SELECT * FROM public.match_vendors_for_price_upload_batch(
          '${JSON.stringify(requests)}'::jsonb
        )
      `)).rejects.toThrow(/permission denied/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back every entry when one atomic upload entry cannot stage", async () => {
    const db = await createDatabase();
    try {
      const secondPayload = entryPayload();
      secondPayload.vendor_name = "Another Sample Studio";
      secondPayload.prices[0].agency_slug = "missing-agency";
      secondPayload.prices[0].source_record_key = `admin-json:${"c".repeat(64)}`;
      const entries = [{
        entry_index: 0,
        entry_payload: entryPayload(),
        resolution: {
          kind: "existing",
          vendor_id: VENDOR_ID,
          vendor_name: "Sample Studio",
        },
      }, {
        entry_index: 1,
        entry_payload: secondPayload,
        resolution: {
          kind: "existing",
          vendor_id: VENDOR_ID,
          vendor_name: "Sample Studio",
        },
      }];
      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT * FROM public.apply_admin_json_price_upload(
          '${EVIDENCE_KEY}',
          '${JSON.stringify(uploadContext()).replaceAll("'", "''")}'::jsonb,
          '${JSON.stringify(entries).replaceAll("'", "''")}'::jsonb,
          '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/PRICE_UPLOAD_ATOMIC_AGENCY_INACTIVE/u);
      await db.exec("RESET ROLE;");

      const prices = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.official_prices",
      );
      const snapshots = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.price_snapshots",
      );
      expect(prices.rows).toEqual([{ count: 0 }]);
      expect(snapshots.rows).toEqual([{ count: 0 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("validates every confirmation candidate set before the atomic write phase", async () => {
    const db = await createDatabase();
    try {
      const confirmationPayload = entryPayload();
      confirmationPayload.vendor_name = "Sample Studio Alternative";
      confirmationPayload.prices[0].source_record_key = `admin-json:${"c".repeat(64)}`;
      const entries = [{
        entry_index: 0,
        entry_payload: entryPayload(),
        resolution: {
          kind: "existing",
          vendor_id: VENDOR_ID,
          vendor_name: "Sample Studio",
        },
      }, {
        entry_index: 1,
        entry_payload: confirmationPayload,
        resolution: {
          kind: "confirmation",
          candidate_vendor_ids: [OTHER_VENDOR_ID],
          candidate_snapshot: candidateSnapshot(),
        },
      }];
      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT * FROM public.apply_admin_json_price_upload(
          '${EVIDENCE_KEY}',
          '${JSON.stringify(uploadContext()).replaceAll("'", "''")}'::jsonb,
          '${JSON.stringify(entries).replaceAll("'", "''")}'::jsonb,
          '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/PRICE_UPLOAD_ATOMIC_INVALID_RESOLUTION/u);
      await db.exec("RESET ROLE;");
      const prices = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.official_prices",
      );
      const snapshots = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.price_snapshots",
      );
      expect(prices.rows).toEqual([{ count: 0 }]);
      expect(snapshots.rows).toEqual([{ count: 0 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("commits staged and confirmation entries together and retries idempotently", async () => {
    const db = await createDatabase();
    try {
      const confirmationPayload = entryPayload();
      confirmationPayload.vendor_name = "Sample Studio Alternative";
      confirmationPayload.prices[0].source_record_key = `admin-json:${"c".repeat(64)}`;
      const entries = [{
        entry_index: 0,
        entry_payload: entryPayload(),
        resolution: {
          kind: "existing",
          vendor_id: VENDOR_ID,
          vendor_name: "Sample Studio",
        },
      }, {
        entry_index: 1,
        entry_payload: confirmationPayload,
        resolution: {
          kind: "confirmation",
          candidate_vendor_ids: [VENDOR_ID],
          candidate_snapshot: candidateSnapshot(),
        },
      }];
      const call = `
        SELECT * FROM public.apply_admin_json_price_upload(
          '${EVIDENCE_KEY}',
          '${JSON.stringify(uploadContext()).replaceAll("'", "''")}'::jsonb,
          '${JSON.stringify(entries).replaceAll("'", "''")}'::jsonb,
          '${ADMIN_ID}'
        )
      `;
      await db.exec("SET ROLE service_role;");
      const first = await db.query<Record<string, unknown>>(call);
      const retry = await db.query<Record<string, unknown>>(call);
      await db.exec("RESET ROLE;");

      expect(first.rows).toEqual([
        expect.objectContaining({
          entry_index: 0,
          outcome: "auto_matched",
          vendor_id: VENDOR_ID,
          staged_prices: 1,
        }),
        expect.objectContaining({
          entry_index: 1,
          outcome: "needs_confirmation",
          confirmation_id: expect.any(String),
          staged_prices: 0,
        }),
      ]);
      expect(retry.rows).toEqual(first.rows);
      const prices = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.official_prices",
      );
      const queued = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.price_upload_confirmations",
      );
      expect(prices.rows).toEqual([{ count: 1 }]);
      expect(queued.rows).toEqual([{ count: 1 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("creates one deterministic draft vendor inside the atomic transaction", async () => {
    const db = await createDatabase();
    try {
      const payload = entryPayload();
      payload.vendor_name = "Brand New Sample Studio";
      payload.aliases = ["Brand New Former Name"];
      const entries = [{
        entry_index: 0,
        entry_payload: payload,
        resolution: {
          kind: "draft",
          vendor_name: "Brand New Sample Studio",
          normalized_name: "brandnewsamplestudio",
          vendor_slug: "studio-seoul-gangnam3-123456789abc",
        },
      }];
      const call = `
        SELECT * FROM public.apply_admin_json_price_upload(
          '${EVIDENCE_KEY}',
          '${JSON.stringify(uploadContext()).replaceAll("'", "''")}'::jsonb,
          '${JSON.stringify(entries).replaceAll("'", "''")}'::jsonb,
          '${ADMIN_ID}'
        )
      `;
      await db.exec("SET ROLE service_role;");
      const first = await db.query<Record<string, unknown>>(call);
      const retry = await db.query<Record<string, unknown>>(call);
      await db.exec("RESET ROLE;");
      expect(first.rows).toEqual([expect.objectContaining({
        outcome: "newly_created",
        vendor_name: "Brand New Sample Studio",
        staged_prices: 1,
      })]);
      expect(retry.rows).toEqual(first.rows);
      const vendor = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.vendors
        WHERE slug = 'studio-seoul-gangnam3-123456789abc'
      `);
      expect(vendor.rows).toEqual([{ count: 1 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects an atomic upload into a snapshot with different evidence context", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.price_snapshots (
          period_label, source, source_note, collected_at
        ) VALUES (
          '2026Q3', 'mixed', 'different operator note', '2026-07-17'
        )
      `);
      const entries = [{
        entry_index: 0,
        entry_payload: entryPayload(),
        resolution: {
          kind: "existing",
          vendor_id: VENDOR_ID,
          vendor_name: "Sample Studio",
        },
      }];
      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT * FROM public.apply_admin_json_price_upload(
          '${EVIDENCE_KEY}',
          '${JSON.stringify(uploadContext()).replaceAll("'", "''")}'::jsonb,
          '${JSON.stringify(entries).replaceAll("'", "''")}'::jsonb,
          '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/PRICE_UPLOAD_ATOMIC_SNAPSHOT_CONTEXT_CONFLICT/u);
      await db.exec("RESET ROLE;");
      const prices = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.official_prices",
      );
      expect(prices.rows).toEqual([{ count: 0 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects non-contract source, int4 overflow, and sub-threshold candidates before queueing", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      await expect(enqueue(db, entryPayload(), {
        ...uploadContext(),
        source: "manual_disclosure",
      })).rejects.toThrow(/PRICE_UPLOAD_CONFIRMATION_INVALID_INPUT/u);
      const overflow = entryPayload();
      overflow.prices[0].price_max_krw = 2_147_483_648;
      await expect(enqueue(db, overflow))
        .rejects.toThrow(/PRICE_UPLOAD_CONFIRMATION_INVALID_INPUT/u);
      await expect(enqueue(db, entryPayload(), uploadContext(), [{
        ...candidateSnapshot()[0],
        similarity: 0.59,
      }])).rejects.toThrow(/PRICE_UPLOAD_CONFIRMATION_INVALID_INPUT/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects duplicate option identities before creating an immutable queue row", async () => {
    const db = await createDatabase();
    try {
      const duplicate = entryPayload().prices[0].options[0] as Record<string, unknown>;
      await db.exec("SET ROLE service_role;");
      await expect(enqueue(db, entryPayload([duplicate, { ...duplicate }])))
        .rejects.toThrow(/PRICE_UPLOAD_CONFIRMATION_INVALID_INPUT/u);
      await db.exec("RESET ROLE;");
      const queued = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.price_upload_confirmations",
      );
      expect(queued.rows).toEqual([{ count: 0 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("enforces the transformed Zod lengths, required keys, and real date at the queue boundary", async () => {
    const db = await createDatabase();
    try {
      const missingOptionKey = entryPayload();
      delete (missingOptionKey.prices[0].options[0] as Record<string, unknown>)
        .is_effectively_mandatory;
      const longPriceNote = entryPayload();
      (longPriceNote.prices[0] as { price_note: string | null }).price_note = "n".repeat(2_001);
      const longBaseSpec = entryPayload();
      longBaseSpec.prices[0].base_spec = "b".repeat(2_001);
      const longUnit = entryPayload();
      (longUnit.prices[0].options[0] as Record<string, unknown>).unit = "u".repeat(101);
      const longCondition = entryPayload();
      (longCondition.prices[0].options[0] as Record<string, unknown>).condition = "c".repeat(501);
      const untrimmedVendor = entryPayload();
      untrimmedVendor.vendor_name = " Sample Studio A ";
      const tooManyOptions = entryPayload(Array.from({ length: 51 }, (_, index) => ({
        ...(entryPayload().prices[0].options[0] as Record<string, unknown>),
        name: `Option ${index}`,
      })));
      const longCandidateSlug = [{
        ...candidateSnapshot()[0],
        vendor_slug: "s".repeat(121),
      }];

      await db.exec("SET ROLE service_role;");
      for (const [payload, context, candidates] of [
        [entryPayload(), { ...uploadContext(), collected_at: "2026-02-31" }, candidateSnapshot()],
        [missingOptionKey, uploadContext(), candidateSnapshot()],
        [longPriceNote, uploadContext(), candidateSnapshot()],
        [longBaseSpec, uploadContext(), candidateSnapshot()],
        [longUnit, uploadContext(), candidateSnapshot()],
        [longCondition, uploadContext(), candidateSnapshot()],
        [untrimmedVendor, uploadContext(), candidateSnapshot()],
        [tooManyOptions, uploadContext(), candidateSnapshot()],
        [entryPayload(), uploadContext(), longCandidateSlug],
      ] as const) {
        await expect(enqueue(db, payload, context, candidates))
          .rejects.toThrow(/PRICE_UPLOAD_CONFIRMATION_INVALID_INPUT/u);
      }
      await db.exec("RESET ROLE;");
      const queued = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.price_upload_confirmations",
      );
      expect(queued.rows).toEqual([{ count: 0 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("stores one immutable service-only queue row and exposes only a safe admin projection", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      const first = await enqueue(db);
      const retry = await enqueue(db);
      expect(retry.rows[0].confirmation_id).toBe(first.rows[0].confirmation_id);

      const listed = await db.query<Record<string, unknown>>(
        "SELECT * FROM public.list_price_upload_confirmations('pending')",
      );
      expect(listed.rows).toHaveLength(1);
      expect(listed.rows[0]).toMatchObject({
        confirmation_id: first.rows[0].confirmation_id,
        vendor_name: "Sample Studio A",
        category: "studio",
        region_code: "seoul_gangnam3",
        state: "pending",
        version: 0,
      });
      expect(listed.rows[0].candidates).toEqual([
        expect.objectContaining({
          vendor_id: VENDOR_ID,
          category: "studio",
          region_code: "seoul_gangnam3",
        }),
      ]);
      expect(JSON.stringify(listed.rows[0])).not.toContain(EVIDENCE_KEY);
      expect(JSON.stringify(listed.rows[0])).not.toContain("source_object_key");

      await db.exec("RESET ROLE;");
      await expect(db.exec(`
        UPDATE public.price_upload_confirmations
        SET source_object_key = '${"c".repeat(64)}.json'
        WHERE id = '${first.rows[0].confirmation_id}'
      `)).rejects.toThrow(/PRICE_UPLOAD_CONFIRMATION_IMMUTABLE/u);

      await db.exec("SET ROLE authenticated;");
      await expect(db.query("SELECT * FROM public.price_upload_confirmations"))
        .rejects.toThrow(/permission denied/u);
      await expect(db.query("SELECT * FROM public.list_price_upload_confirmations('pending')"))
        .rejects.toThrow(/permission denied/u);
      await expect(db.query(`
        SELECT * FROM public.apply_admin_json_price_upload(
          'not-an-evidence-key',
          '{}'::jsonb,
          '[]'::jsonb,
          '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/permission denied/u);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("stages a pending price and all options atomically and repairs an identical retry", async () => {
    const db = await createDatabase();
    try {
      const snapshotId = "10000000-0000-4000-8000-000000000001";
      await db.exec(`
        INSERT INTO public.price_snapshots (
          id, period_label, source, source_note, collected_at
        ) VALUES (
          '${snapshotId}', '2026Q3', 'mixed', 'manual JSON', '2026-07-18'
        )
      `);
      await db.exec("SET ROLE service_role;");
      const call = `
        SELECT public.stage_admin_json_price(
          '${snapshotId}', '${VENDOR_ID}', '${AGENCY_ID}', 'studio',
          'Base disclosure', 1000000, 1200000, NULL, 'Base package',
          '${JSON.stringify(entryPayload().prices[0].options).replaceAll("'", "''")}'::jsonb,
          'admin JSON (mixed 2026Q3).json', '${EVIDENCE_KEY}',
          'JSON /entries/0/prices/0/base_spec: Base package',
          'admin-json:${"b".repeat(64)}'
        )
      `;
      await db.query(call);
      await db.query(call);
      await db.exec("RESET ROLE;");

      const prices = await db.query<{
        review_status: string;
        source_object_keys: string[];
      }>("SELECT review_status, source_object_keys FROM public.official_prices");
      const options = await db.query<{ raw_text: string }>(
        "SELECT raw_text FROM public.official_price_options",
      );
      expect(prices.rows).toEqual([{
        review_status: "pending",
        source_object_keys: [EVIDENCE_KEY],
      }]);
      expect(options.rows).toEqual([{ raw_text: "Original files 100,000 KRW" }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("resolves a selected candidate once, preserves aliases, and makes re-upload an exact alias match", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      const queued = await enqueue(db);
      const confirmationId = queued.rows[0].confirmation_id;
      const resolveCall = `
        SELECT * FROM public.resolve_price_upload_confirmation(
          '${confirmationId}', '${VENDOR_ID}', 0, '${ADMIN_ID}'
        )
      `;
      const resolved = await db.query<{
        confirmation_id: string;
        staged_prices: number;
        version: number;
        already_resolved: boolean;
      }>(resolveCall);
      const retry = await db.query<{ already_resolved: boolean }>(resolveCall);
      expect(resolved.rows).toEqual([{
        confirmation_id: confirmationId,
        snapshot_id: expect.any(String),
        staged_prices: 1,
        version: 1,
        already_resolved: false,
      }]);
      expect(retry.rows[0].already_resolved).toBe(true);

      await db.exec("RESET ROLE;");
      const vendor = await db.query<{ aliases: string[] }>(`
        SELECT aliases FROM public.vendors WHERE id = '${VENDOR_ID}'
      `);
      expect(vendor.rows[0].aliases).toEqual(expect.arrayContaining([
        "Sample Studio A",
        "Sample Studio Former",
      ]));
      const exactAlias = await db.query<{ id: string }>(`
        SELECT vendor.id
        FROM public.vendors AS vendor
        WHERE vendor.id = '${VENDOR_ID}'
          AND EXISTS (
            SELECT 1 FROM unnest(vendor.aliases) AS alias(value)
            WHERE public.normalize_price_vendor_name(alias.value)
              = public.normalize_price_vendor_name('Sample Studio A')
          )
      `);
      expect(exactAlias.rows).toEqual([{ id: VENDOR_ID }]);
      const eventActions = await db.query<{ action: string }>(`
        SELECT action FROM public.price_upload_confirmation_events
        WHERE confirmation_id = '${confirmationId}' ORDER BY version
      `);
      expect(eventActions.rows).toEqual([{ action: "queued" }, { action: "resolved" }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects confirmation staging into a snapshot with different evidence context", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.price_snapshots (
          period_label, source, source_note, collected_at
        ) VALUES (
          '2026Q3', 'mixed', 'different operator note', '2026-07-17'
        )
      `);
      await db.exec("SET ROLE service_role;");
      const queued = await enqueue(db);
      const confirmationId = queued.rows[0].confirmation_id;
      await expect(db.query(`
        SELECT * FROM public.resolve_price_upload_confirmation(
          '${confirmationId}', '${VENDOR_ID}', 0, '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/PRICE_UPLOAD_CONFIRMATION_SNAPSHOT_CONTEXT_CONFLICT/u);
      await db.exec("RESET ROLE;");

      const queue = await db.query<{ state: string }>(`
        SELECT state FROM public.price_upload_confirmations
        WHERE id = '${confirmationId}'
      `);
      const prices = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.official_prices",
      );
      expect(queue.rows).toEqual([{ state: "pending" }]);
      expect(prices.rows).toEqual([{ count: 0 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rolls back aliases, snapshot, parent, and queue state when an agency changes after enqueue", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      const queued = await enqueue(db);
      const confirmationId = queued.rows[0].confirmation_id;
      await db.exec("RESET ROLE;");
      await db.exec(`UPDATE public.agencies SET is_active = false WHERE id = '${AGENCY_ID}'`);
      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT * FROM public.resolve_price_upload_confirmation(
          '${confirmationId}', '${VENDOR_ID}', 0, '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/PRICE_UPLOAD_CONFIRMATION_AGENCY_INACTIVE/u);
      await db.exec("RESET ROLE;");

      const queue = await db.query<{ state: string }>(`
        SELECT state FROM public.price_upload_confirmations
        WHERE id = '${confirmationId}'
      `);
      const vendor = await db.query<{ aliases: string[] }>(`
        SELECT aliases FROM public.vendors WHERE id = '${VENDOR_ID}'
      `);
      const snapshots = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.price_snapshots",
      );
      const prices = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.official_prices",
      );
      expect(queue.rows).toEqual([{ state: "pending" }]);
      expect(vendor.rows).toEqual([{ aliases: [] }]);
      expect(snapshots.rows).toEqual([{ count: 0 }]);
      expect(prices.rows).toEqual([{ count: 0 }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects a non-candidate and an inactive selected vendor without staging", async () => {
    const db = await createDatabase();
    try {
      await db.exec("SET ROLE service_role;");
      const queued = await enqueue(db);
      const confirmationId = queued.rows[0].confirmation_id;
      await expect(db.query(`
        SELECT * FROM public.resolve_price_upload_confirmation(
          '${confirmationId}', '${OTHER_VENDOR_ID}', 0, '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/VENDOR_NOT_A_CANDIDATE/u);
      await db.exec("RESET ROLE;");
      await db.exec(`UPDATE public.vendors SET status = 'rejected' WHERE id = '${VENDOR_ID}'`);
      await db.exec("SET ROLE service_role;");
      await expect(db.query(`
        SELECT * FROM public.resolve_price_upload_confirmation(
          '${confirmationId}', '${VENDOR_ID}', 0, '${ADMIN_ID}'
        )
      `)).rejects.toThrow(/VENDOR_INACTIVE_OR_CATEGORY_MISMATCH/u);
      await db.exec("RESET ROLE;");
      const prices = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.official_prices",
      );
      const queue = await db.query<{ state: string }>(`
        SELECT state FROM public.price_upload_confirmations WHERE id = '${confirmationId}'
      `);
      expect(prices.rows).toEqual([{ count: 0 }]);
      expect(queue.rows).toEqual([{ state: "pending" }]);
    } finally {
      await db.exec("RESET ROLE;").catch(() => undefined);
      await db.close();
    }
  });
});
