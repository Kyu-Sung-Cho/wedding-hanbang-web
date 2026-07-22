// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260722199000_vendor_disclosure_local_price_overflow_quarantine.sql",
  ),
  "utf8",
);

const openDatabases: PGlite[] = [];
const OVERFLOW = 2_147_483_648;
const QUARANTINE_ISSUE = "local_price_overflow_quarantined";

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
});

async function migrationDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  openDatabases.push(db);
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;

    CREATE TABLE public.official_agency_packages (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      price_min_krw integer,
      price_max_krw integer,
      options jsonb NOT NULL,
      validation_issue_codes text[] NOT NULL,
      source_quote text NOT NULL
    );
    CREATE TABLE public.official_prices (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      price_min_krw integer,
      price_max_krw integer,
      validation_issue_codes text[] NOT NULL,
      source_quote text NOT NULL
    );
    CREATE TABLE public.official_price_options (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      official_price_id bigint NOT NULL REFERENCES public.official_prices(id),
      name text NOT NULL,
      price_min_krw integer,
      price_max_krw integer,
      raw_text text NOT NULL,
      source_quote text NOT NULL
    );
    CREATE TABLE public.payload_receipts (payload jsonb NOT NULL);

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
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $stage_vendor_disclosure_batch_atomic$
    DECLARE
      row_value jsonb;
      option_value jsonb;
      package_id_value bigint;
      official_price_id_value bigint;
      semantic_issue_codes text[];
      semantic_dummy integer;
    BEGIN
      FOR row_value IN
        SELECT package.value
        FROM jsonb_array_elements(p_payload -> 'agency_packages') AS package(value)
      LOOP
        INSERT INTO public.official_agency_packages (
          price_min_krw, price_max_krw, options,
          validation_issue_codes, source_quote
        ) VALUES (
          (row_value ->> 'price_min_krw')::integer,
      (row_value ->> 'price_max_krw')::integer,
          row_value -> 'options',
          ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
          row_value ->> 'source_quote'
        ) RETURNING id INTO package_id_value;
      END LOOP;

      FOR row_value IN
        SELECT price.value
        FROM jsonb_array_elements(p_payload -> 'official_prices') AS price(value)
      LOOP
        INSERT INTO public.official_prices (
          price_min_krw, price_max_krw, validation_issue_codes, source_quote
        ) VALUES (
          (row_value ->> 'price_min_krw')::integer,
      (row_value ->> 'price_max_krw')::integer,
          ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
          row_value ->> 'source_quote'
        ) RETURNING id INTO official_price_id_value;

        FOR option_value IN
          SELECT option_row.value
          FROM jsonb_array_elements(row_value -> 'options') AS option_row(value)
        LOOP
          INSERT INTO public.official_price_options (
            official_price_id, name, price_min_krw, price_max_krw,
            raw_text, source_quote
          ) VALUES (
            official_price_id_value,
            option_value ->> 'name',
            (option_value ->> 'price_min_krw')::integer,
        (option_value ->> 'price_max_krw')::integer,
            option_value ->> 'raw_text',
            option_value ->> 'source_quote'
          );
        END LOOP;
      END LOOP;

      IF false THEN
        SELECT
          ARRAY(SELECT jsonb_array_elements_text(row_value -> 'validation_issue_codes')),
          1
        INTO semantic_issue_codes, semantic_dummy;
      END IF;

      INSERT INTO public.payload_receipts(payload) VALUES (p_payload);
    END;
    $stage_vendor_disclosure_batch_atomic$;
  `);
  await db.exec(migration);
  return db;
}

function payload(): Record<string, unknown> {
  return {
    agency_packages: [
      {
        price_min_krw: OVERFLOW,
        price_max_krw: 5_000_000,
        options: [
          {
            name: "package option",
            price_min_krw: 100_000,
            price_max_krw: OVERFLOW,
            raw_text: "package raw overflow evidence",
            source_quote: "package option source overflow evidence",
          },
        ],
        validation_issue_codes: Array.from({ length: 100 }, (_, index) => `issue_${index}`),
        source_quote: "package source overflow evidence",
      },
    ],
    official_prices: [
      {
        price_min_krw: 1_000_000,
        price_max_krw: OVERFLOW,
        options: [
          {
            name: "overflow option",
            price_min_krw: OVERFLOW,
            price_max_krw: null,
            raw_text: "option raw overflow evidence",
            source_quote: "option source overflow evidence",
          },
          {
            name: "ordinary option",
            price_min_krw: 200_000,
            price_max_krw: 300_000,
            raw_text: "ordinary raw evidence",
            source_quote: "ordinary source evidence",
          },
        ],
        validation_issue_codes: ["local_deterministic_review_only"],
        source_quote: "official price source overflow evidence",
      },
    ],
  };
}

async function invoke(
  db: PGlite,
  authorizationKind: "local_validated_pending_only" | "paid_pilot_gate",
  batchPayload: Record<string, unknown>,
): Promise<void> {
  await db.exec(`
    SELECT public.stage_vendor_disclosure_batch_atomic(
      'project', repeat('1', 64), repeat('2', 64), repeat('3', 64),
      repeat('4', 64), 1, 1, 'source', 'period', '${authorizationKind}',
      repeat('5', 64), ARRAY[repeat('6', 64)], '[]'::jsonb,
      $payload$${JSON.stringify(batchPayload)}$payload$::jsonb
    );
  `);
}

describe("local price overflow quarantine migration", () => {
  it("quarantines every local integer overflow while preserving evidence and immutable payload", async () => {
    const db = await migrationDatabase();
    const originalPayload = payload();

    await expect(
      invoke(db, "local_validated_pending_only", originalPayload),
    ).resolves.toBeUndefined();

    const packages = await db.query<{
      price_min_krw: number | null;
      price_max_krw: number | null;
      options: Array<Record<string, unknown>>;
      validation_issue_codes: string[];
      source_quote: string;
    }>("SELECT price_min_krw, price_max_krw, options, validation_issue_codes, source_quote FROM public.official_agency_packages");
    expect(packages.rows[0]).toMatchObject({
      price_min_krw: null,
      price_max_krw: 5_000_000,
      source_quote: "package source overflow evidence",
    });
    expect(packages.rows[0]?.options[0]).toMatchObject({
      price_min_krw: 100_000,
      price_max_krw: null,
      raw_text: "package raw overflow evidence",
      source_quote: "package option source overflow evidence",
    });
    expect(packages.rows[0]?.validation_issue_codes[0]).toBe(QUARANTINE_ISSUE);
    expect(packages.rows[0]?.validation_issue_codes).toHaveLength(100);

    const prices = await db.query<{
      price_min_krw: number | null;
      price_max_krw: number | null;
      validation_issue_codes: string[];
      source_quote: string;
    }>("SELECT price_min_krw, price_max_krw, validation_issue_codes, source_quote FROM public.official_prices");
    expect(prices.rows[0]).toMatchObject({
      price_min_krw: 1_000_000,
      price_max_krw: null,
      source_quote: "official price source overflow evidence",
    });
    expect(prices.rows[0]?.validation_issue_codes).toContain(QUARANTINE_ISSUE);

    const options = await db.query<{
      name: string;
      price_min_krw: number | null;
      price_max_krw: number | null;
      raw_text: string;
      source_quote: string;
    }>("SELECT name, price_min_krw, price_max_krw, raw_text, source_quote FROM public.official_price_options ORDER BY id");
    expect(options.rows).toEqual([
      {
        name: "overflow option",
        price_min_krw: null,
        price_max_krw: null,
        raw_text: "option raw overflow evidence",
        source_quote: "option source overflow evidence",
      },
      {
        name: "ordinary option",
        price_min_krw: 200_000,
        price_max_krw: 300_000,
        raw_text: "ordinary raw evidence",
        source_quote: "ordinary source evidence",
      },
    ]);

    const receipts = await db.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM public.payload_receipts",
    );
    expect(receipts.rows[0]?.payload).toEqual(originalPayload);
  });

  it("leaves paid staging fail-closed on the original integer overflow", async () => {
    const db = await migrationDatabase();

    await expect(invoke(db, "paid_pilot_gate", payload())).rejects.toThrow(
      /out of range for type integer|22003/iu,
    );

    const counts = await db.query<{ package_count: number; price_count: number }>(`
      SELECT
        (SELECT count(*)::integer FROM public.official_agency_packages) AS package_count,
        (SELECT count(*)::integer FROM public.official_prices) AS price_count
    `);
    expect(counts.rows[0]).toEqual({ package_count: 0, price_count: 0 });
  });
});
