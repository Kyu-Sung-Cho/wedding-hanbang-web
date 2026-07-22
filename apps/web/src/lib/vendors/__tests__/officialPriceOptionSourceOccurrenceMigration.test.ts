// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722196000_official_price_option_source_occurrence.sql",
  ),
  "utf8",
);
const occurrenceDdl = migration.slice(
  0,
  migration.indexOf("-- Option confidence is absent from the immutable extraction payload schema."),
);

const PRICE_A = "10000000-0000-4000-8000-000000000001";
const PRICE_B = "10000000-0000-4000-8000-000000000002";
const SNAPSHOT_A = "20000000-0000-4000-8000-000000000001";
const SNAPSHOT_B = "20000000-0000-4000-8000-000000000002";
const RUN_A = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const openDatabases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
});

async function occurrenceDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.digest(value bytea, algorithm text)
    RETURNS bytea
    LANGUAGE sql
    IMMUTABLE
    AS $$
      SELECT decode(
        md5(encode(value, 'hex')) || md5('second-half:' || encode(value, 'hex')),
        'hex'
      )
    $$;
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      snapshot_id uuid NOT NULL,
      source_record_key text,
      confidence numeric
    );
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      official_price_id uuid NOT NULL REFERENCES public.official_prices(id),
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
      sort_order integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.vendor_disclosure_ingest_runs (
      run_sha256 text PRIMARY KEY,
      status text NOT NULL,
      snapshot_id uuid NOT NULL
    );
    CREATE TABLE public.vendor_disclosure_ingest_owned_rows (
      run_sha256 text NOT NULL,
      row_kind text NOT NULL,
      row_id uuid NOT NULL
    );
    CREATE UNIQUE INDEX idx_official_price_options_identity_unique
      ON public.official_price_options (
        official_price_id,
        name,
        COALESCE(unit, ''),
        COALESCE(condition, '')
      );
    CREATE FUNCTION public.stage_vendor_disclosure_batch_atomic(
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
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      PERFORM set_config(
        'app.vendor_disclosure_atomic_run_sha256',
        p_run_sha256,
        true
      );
      INSERT INTO public.official_price_options (
        official_price_id, name, price_min_krw, price_max_krw,
        unit, condition, raw_text, source_file, source_quote,
        source_object_keys, confidence
      )
      SELECT
        (p_payload ->> 'official_price_id')::uuid,
        option_value ->> 'name',
        (option_value ->> 'price_min_krw')::integer,
        (option_value ->> 'price_max_krw')::integer,
        option_value ->> 'unit',
        option_value ->> 'condition',
        option_value ->> 'raw_text',
        option_value ->> 'source_file',
        option_value ->> 'source_quote',
        ARRAY(
          SELECT jsonb_array_elements_text(option_value -> 'source_object_keys')
        ),
        NULL
      FROM jsonb_array_elements(p_payload -> 'options') AS option_row(option_value);
    END
    $$;
  `);
  await db.exec(occurrenceDdl);
  openDatabases.push(db);
  return db;
}

describe("official price option source occurrence migration", () => {
  it("keeps the legacy semantic identity fence for non-disclosure rows", async () => {
    const db = await occurrenceDatabase();
    await db.exec(`
      INSERT INTO public.official_prices (id, snapshot_id, source_record_key)
      VALUES (
        '${PRICE_B}', '${SNAPSHOT_B}',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );
      INSERT INTO public.official_price_options (
        official_price_id, name, price_min_krw, price_max_krw
      ) VALUES ('${PRICE_B}', '추가 옵션', 100000, 100000);
    `);

    await expect(db.exec(`
      INSERT INTO public.official_price_options (
        official_price_id, name, price_min_krw, price_max_krw
      ) VALUES ('${PRICE_B}', '추가 옵션', 200000, 200000);
    `)).rejects.toThrow(/idx_official_price_options_identity_unique/iu);
  });

  it("preserves every atomic disclosure occurrence and its source order", async () => {
    const db = await occurrenceDatabase();
    await db.exec(`
      INSERT INTO public.official_prices (
        id, snapshot_id, source_record_key, confidence
      )
      VALUES (
        '${PRICE_A}', '${SNAPSHOT_A}',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        0.93
      );
      INSERT INTO public.vendor_disclosure_ingest_runs (
        run_sha256, status, snapshot_id
      ) VALUES ('${RUN_A}', 'active', '${SNAPSHOT_A}');
      INSERT INTO public.vendor_disclosure_ingest_owned_rows (
        run_sha256, row_kind, row_id
      ) VALUES ('${RUN_A}', 'official_price', '${PRICE_A}');
      SELECT public.stage_vendor_disclosure_batch_atomic(
        'synthetic-project', '${RUN_A}', repeat('d', 64), repeat('e', 64),
        repeat('f', 64), 1, 1, 'synthetic', 'period', 'local', repeat('1', 64),
        '{}'::text[], '[]'::jsonb,
        $payload$${JSON.stringify({
          official_price_id: PRICE_A,
          options: [
            {
              name: "합성 옵션",
              price_min_krw: 41_800,
              price_max_krw: 41_800,
              unit: null,
              condition: null,
              raw_text: "synthetic row A",
              source_file: "synthetic.xlsx",
              source_quote: "synthetic cell A",
              source_object_keys: ["raw-b", "raw-a", "raw-a"],
            },
            {
              name: "합성 옵션",
              price_min_krw: 77_000,
              price_max_krw: 880_000,
              unit: null,
              condition: null,
              raw_text: "synthetic row B",
              source_file: "synthetic.xlsx",
              source_quote: "synthetic cell B",
              source_object_keys: ["raw-a"],
            },
            {
              name: "합성 반복 옵션",
              price_min_krw: 100_000,
              price_max_krw: 220_000,
              unit: null,
              condition: null,
              raw_text: "synthetic repeated row",
              source_file: "synthetic.xlsx",
              source_quote: "synthetic repeated cell",
              source_object_keys: ["raw-a"],
            },
            {
              name: "합성 반복 옵션",
              price_min_krw: 100_000,
              price_max_krw: 220_000,
              unit: null,
              condition: null,
              raw_text: "synthetic repeated row",
              source_file: "synthetic.xlsx",
              source_quote: "synthetic repeated cell",
              source_object_keys: ["raw-a"],
            },
          ],
        })}$payload$::jsonb
      );
    `);

    const result = await db.query<{
      confidence: number;
      source_occurrence_key: string;
      sort_order: number;
    }>(`
      SELECT confidence, source_occurrence_key, sort_order
      FROM public.official_price_options
      WHERE official_price_id = '${PRICE_A}'
      ORDER BY sort_order
    `);

    expect(result.rows.map((row) => row.sort_order)).toEqual([0, 1, 2, 3]);
    expect(result.rows.every((row) => Number(row.confidence) === 0.93)).toBe(true);
    expect(result.rows.every((row) => /^[0-9a-f]{64}:[0-9]+$/u.test(
      row.source_occurrence_key,
    ))).toBe(true);
    expect(new Set(result.rows.map((row) => row.source_occurrence_key)).size).toBe(4);

    const rankCounts = result.rows.reduce<Map<string, number>>((counts, row) => {
      const base = row.source_occurrence_key.slice(0, 64);
      counts.set(base, (counts.get(base) ?? 0) + 1);
      return counts;
    }, new Map());
    expect([...rankCounts.values()].sort((left, right) => left - right)).toEqual([1, 1, 2]);
    expect(result.rows.slice(2).map((row) => row.source_occurrence_key.slice(-2))).toEqual([
      ":0",
      ":1",
    ]);

    await expect(db.exec(`
      UPDATE public.official_price_options
      SET source_occurrence_key = repeat('f', 64) || ':0'
      WHERE official_price_id = '${PRICE_A}'
        AND sort_order = 0;
    `)).rejects.toThrow(/OFFICIAL_PRICE_OPTION_SOURCE_OCCURRENCE_IMMUTABLE/iu);
  });

  it("installs partial legacy and source-occurrence uniqueness fences", () => {
    expect(migration).toMatch(
      /idx_official_price_options_identity_unique[\s\S]{0,300}WHERE source_occurrence_key IS NULL/iu,
    );
    expect(migration).toMatch(
      /idx_official_price_options_source_occurrence_unique[\s\S]{0,220}WHERE source_occurrence_key IS NOT NULL/iu,
    );
    expect(migration).toMatch(
      /vendor_disclosure_option_occurrence_v1[\s\S]{0,900}occurrence_base_sha256[\s\S]{0,1400}occurrence_duplicate_rank/iu,
    );
    expect(migration).toMatch(
      /PG_CONTEXT[\s\S]{0,900}stage_vendor_disclosure_batch_atomic\(text,text,text,text,text,integer,integer,text,text,text,text,text\[\],jsonb,jsonb\)/iu,
    );
    expect(migration).toMatch(
      /'confidence', NULL/iu,
    );
  });
});
