// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803100000_harden_client_event_trust.sql",
  ),
  "utf8",
);

async function fixture() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;

    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid
    );
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY,
      couple_id uuid,
      wedding_date date
    );
    CREATE TABLE public.events (
      id uuid PRIMARY KEY,
      anon_id text NOT NULL,
      user_id uuid,
      session_id text,
      vendor_id uuid,
      agency_id uuid,
      surface text NOT NULL,
      event_type text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      context jsonb NOT NULL DEFAULT '{}'::jsonb,
      weight integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_demand_daily (
      day date NOT NULL,
      vendor_id uuid NOT NULL,
      impressions bigint NOT NULL DEFAULT 0,
      detail_views bigint NOT NULL DEFAULT 0,
      wishlist_adds bigint NOT NULL DEFAULT 0,
      combo_adds bigint NOT NULL DEFAULT 0,
      quote_requests bigint NOT NULL DEFAULT 0,
      weighted_score numeric NOT NULL DEFAULT 0,
      qualified_score numeric NOT NULL DEFAULT 0,
      PRIMARY KEY (day, vendor_id)
    );

    CREATE FUNCTION public.canonical_price_vendor_id(value uuid)
    RETURNS uuid LANGUAGE sql IMMUTABLE AS 'SELECT value';
    CREATE FUNCTION public.canonical_price_agency_id(value uuid)
    RETURNS uuid LANGUAGE sql IMMUTABLE AS 'SELECT value';

    INSERT INTO public.events (
      id, anon_id, session_id, vendor_id, surface, event_type, weight
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'price_detail',
      'quote_request',
      30
    );
    INSERT INTO public.vendor_demand_daily (
      day, vendor_id, quote_requests, weighted_score, qualified_score
    ) VALUES (
      current_date,
      '40000000-0000-4000-8000-000000000001',
      999,
      29970,
      29970
    );
  `);
  return db;
}

describe("client event trust migration", () => {
  it("invalidates legacy demand and rejects high-value events from the client lane", async () => {
    const db = await fixture();
    try {
      await db.exec(migration);

      expect((await db.query(`
        SELECT ingestion_trust FROM public.events
      `)).rows).toEqual([{ ingestion_trust: "legacy_unverified" }]);

      await expect(db.exec(`
        INSERT INTO public.events (
          id, anon_id, session_id, vendor_id, surface, event_type, weight
        ) VALUES (
          '10000000-0000-4000-8000-000000000005',
          '20000000-0000-4000-8000-000000000005',
          '30000000-0000-4000-8000-000000000005',
          '40000000-0000-4000-8000-000000000001',
          'price_list',
          'vendor_card_click',
          1
        )
      `)).rejects.toThrow(/ingestion_trust/i);

      expect((await db.query(`
        SELECT quote_requests::text, weighted_score::text, qualified_score::text
        FROM public.vendor_demand_daily
      `)).rows).toEqual([{
        quote_requests: "0",
        weighted_score: "0",
        qualified_score: "0",
      }]);

      await expect(db.exec(`
        INSERT INTO public.events (
          id, anon_id, session_id, vendor_id, surface, event_type, weight,
          ingestion_trust
        ) VALUES (
          '10000000-0000-4000-8000-000000000002',
          '20000000-0000-4000-8000-000000000002',
          '30000000-0000-4000-8000-000000000002',
          '40000000-0000-4000-8000-000000000001',
          'price_detail',
          'quote_request',
          30,
          'client_untrusted'
        )
      `)).rejects.toThrow(/events_client_untrusted_low_signal_check/i);

      await expect(db.exec(`
        INSERT INTO public.events (
          id, anon_id, user_id, session_id, vendor_id, surface, event_type,
          weight, ingestion_trust
        ) VALUES (
          '10000000-0000-4000-8000-000000000006',
          '20000000-0000-4000-8000-000000000006',
          '50000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000006',
          '40000000-0000-4000-8000-000000000001',
          'price_list',
          'vendor_card_click',
          1,
          'client_untrusted'
        )
      `)).rejects.toThrow(/events_client_untrusted_low_signal_check/i);

      await db.exec(`
        INSERT INTO public.events (
          id, anon_id, session_id, vendor_id, surface, event_type, weight,
          ingestion_trust
        ) VALUES
        (
          '10000000-0000-4000-8000-000000000003',
          '20000000-0000-4000-8000-000000000003',
          '30000000-0000-4000-8000-000000000003',
          '40000000-0000-4000-8000-000000000001',
          'price_list',
          'vendor_card_click',
          1,
          'client_untrusted'
        ),
        (
          '10000000-0000-4000-8000-000000000004',
          '20000000-0000-4000-8000-000000000004',
          '30000000-0000-4000-8000-000000000004',
          '40000000-0000-4000-8000-000000000001',
          'price_detail',
          'quote_request',
          30,
          'server_verified'
        );

        SELECT public.aggregate_vendor_demand_daily(current_date);
      `);

      expect((await db.query(`
        SELECT quote_requests::text, weighted_score::text, qualified_score::text
        FROM public.vendor_demand_daily
      `)).rows).toEqual([{
        quote_requests: "1",
        weighted_score: "30",
        qualified_score: "0",
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("pins the release blocker for raw-event retention instead of claiming it is solved", () => {
    expect(migration).toContain("WHERE event_row.ingestion_trust = 'server_verified'");
    expect(migration).toContain("Production release remains blocked");
    expect(migration).not.toMatch(/cron\.schedule/iu);
  });
});
