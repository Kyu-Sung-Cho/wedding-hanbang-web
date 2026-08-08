// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20260730101000_quote_check_explicit_consent.sql",
  ),
  "utf8",
);

describe("quote-check explicit consent migration", () => {
  it("quarantines legacy rows and requires a receipt for new research rows", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE TABLE public.amora_quote_checks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          category text NOT NULL,
          region text NOT NULL,
          booking_channel text NOT NULL DEFAULT 'unknown',
          quote_stage text NOT NULL DEFAULT 'quote_only',
          excluded_from_stats boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_amora_quote_checks_channel_cell
          ON public.amora_quote_checks(
            category, region, booking_channel, quote_stage, created_at DESC
          )
          WHERE excluded_from_stats = false;
        INSERT INTO public.amora_quote_checks(category, region)
        VALUES ('studio', 'seoul');

        CREATE TABLE public.vendor_leads (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          source text NOT NULL,
          source_place_id text,
          status text NOT NULL DEFAULT 'raw',
          priority_score integer NOT NULL DEFAULT 0,
          proof_count integer NOT NULL DEFAULT 0,
          mention_count integer NOT NULL DEFAULT 0,
          owner_notes text
        );
        INSERT INTO public.vendor_leads(
          source, source_place_id, priority_score, mention_count
        ) VALUES (
          'user_mention', 'amora-quote:studio:seoul:test-studio', 12, 3
        );
      `);

      await db.exec(migration);

      const legacy = await db.query<{ excluded_from_stats: boolean }>(
        "SELECT excluded_from_stats FROM public.amora_quote_checks",
      );
      expect(legacy.rows).toEqual([{ excluded_from_stats: true }]);

      const vendorSignal = await db.query<{
        mention_count: number;
        priority_score: number;
        status: string;
        owner_notes: string;
      }>(`
        SELECT mention_count, priority_score, status, owner_notes
        FROM public.vendor_leads
      `);
      expect(vendorSignal.rows).toEqual([{
        mention_count: 0,
        priority_score: 0,
        status: "rejected",
        owner_notes:
          "[2026-07-30] Quarantined: quote-check vendor signal lacked separate consent.",
      }]);

      await expect(db.exec(`
        INSERT INTO public.amora_quote_checks(
          category, region, excluded_from_stats
        ) VALUES ('dress', 'seoul', false)
      `)).rejects.toThrow();

      await expect(db.exec(`
        INSERT INTO public.amora_quote_checks(
          category, region, excluded_from_stats,
          storage_consent_at, consent_version
        ) VALUES (
          'dress', 'seoul', false, now(), '2026-07-30'
        )
      `)).resolves.toBeDefined();

      await expect(db.exec(`
        INSERT INTO public.amora_quote_checks(
          category, region, excluded_from_stats,
          vendor_signal_consent_at
        ) VALUES (
          'makeup', 'seoul', true, now()
        )
      `)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
