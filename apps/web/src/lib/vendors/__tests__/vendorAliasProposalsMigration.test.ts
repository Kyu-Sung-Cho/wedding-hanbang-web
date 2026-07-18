// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260718160000_vendor_alias_proposals.sql"),
  "utf8",
);
const priceConsumerMigration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260718190000_price_consumer_contract.sql"),
  "utf8",
);
const matcherStart = priceConsumerMigration.indexOf(
  "CREATE OR REPLACE FUNCTION public.normalize_price_vendor_name",
);
const matcherEnd = priceConsumerMigration.indexOf(
  "-- Public agency identity.",
  matcherStart,
);
if (matcherStart < 0 || matcherEnd < 0) {
  throw new Error("price upload matcher block is missing from the consumer migration");
}
const priceUploadMatcherMigration = priceConsumerMigration.slice(matcherStart, matcherEnd);

const ADMIN_ID = "a0000000-0000-4000-8000-000000000001";
const USER_ID = "a0000000-0000-4000-8000-000000000002";
const VENDOR_ID = "b0000000-0000-4000-8000-000000000001";
const PRICE_ID = "c0000000-0000-4000-8000-000000000001";
const SECOND_PRICE_ID = "c0000000-0000-4000-8000-000000000002";
const PROPOSAL_A = "d0000000-0000-4000-8000-000000000001";
const PROPOSAL_B = "d0000000-0000-4000-8000-000000000002";

async function database() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      is_admin boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      aliases text[] NOT NULL DEFAULT '{}'::text[],
      category text NOT NULL DEFAULT 'studio',
      status text NOT NULL DEFAULT 'approved',
      slug text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.official_prices (
      id uuid PRIMARY KEY,
      vendor_id uuid REFERENCES public.vendors(id),
      review_status text NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE public.official_price_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      official_price_id uuid NOT NULL REFERENCES public.official_prices(id),
      name text NOT NULL
    );
    CREATE VIEW public.v_public_official_prices AS
      SELECT id, review_status FROM public.official_prices;

    CREATE FUNCTION public.review_official_price(
      p_price_id uuid, p_actor_id uuid, p_action text, p_values jsonb, p_options jsonb
    ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      IF COALESCE((p_values ->> 'fail')::boolean, false) THEN
        RAISE EXCEPTION 'GENERATED_REVIEW_FAILURE';
      END IF;
      UPDATE public.official_prices
      SET review_status = CASE p_action
        WHEN 'approve' THEN 'approved'
        WHEN 'reject' THEN 'rejected'
        ELSE 'pending'
      END
      WHERE id = p_price_id;
    END $$;
    CREATE FUNCTION public.merge_vendor_aliases(p_vendor_id uuid, p_aliases text[])
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      UPDATE public.vendors
      SET aliases = ARRAY(
        SELECT DISTINCT alias_value
        FROM unnest(aliases || p_aliases) AS source(alias_value)
        ORDER BY alias_value
      )
      WHERE id = p_vendor_id;
    END $$;
    REVOKE ALL ON FUNCTION public.review_official_price(uuid,uuid,text,jsonb,jsonb)
      FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION public.merge_vendor_aliases(uuid,text[])
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.review_official_price(uuid,uuid,text,jsonb,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.merge_vendor_aliases(uuid,text[]) TO service_role;
    GRANT SELECT ON public.profiles, public.vendors, public.official_prices TO service_role;

    INSERT INTO public.profiles(id, is_admin) VALUES
      ('${ADMIN_ID}', true), ('${USER_ID}', false);
    INSERT INTO public.vendors(id, name) VALUES ('${VENDOR_ID}', '정식 업체명');
    INSERT INTO public.official_prices(id, vendor_id) VALUES
      ('${PRICE_ID}', '${VENDOR_ID}'), ('${SECOND_PRICE_ID}', '${VENDOR_ID}');

    CREATE FUNCTION public.similarity(left_value text, right_value text)
    RETURNS real LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT CASE WHEN left_value = right_value THEN 1::real ELSE 0::real END
    $$;
  `);
  await db.exec(migration);
  await db.exec(priceUploadMatcherMigration);
  return db;
}

async function callReview(
  db: PGlite,
  priceId: string,
  action: "save" | "approve" | "reject",
  selected: string[] = [],
  actorId = ADMIN_ID,
  values = {},
) {
  return db.query(
    `SELECT public.review_official_price_with_alias_proposals($1,$2,$3,$4::jsonb,'[]'::jsonb,$5::uuid[])`,
    [priceId, actorId, action, JSON.stringify(values), selected],
  );
}

describe("vendor alias proposal trust boundary", () => {
  it("keeps loaded aliases private and applies only the explicitly selected approval", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role");
      await db.query(`
        INSERT INTO public.vendor_alias_proposals(
          id, official_price_id, vendor_id, alias, normalized_alias
        ) VALUES
          ('${PROPOSAL_A}', '${PRICE_ID}', '${VENDOR_ID}', '옛 이름', '옛이름'),
          ('${PROPOSAL_B}', '${PRICE_ID}', '${VENDOR_ID}', '틀린 이름', '틀린이름')
      `);
      const before = await db.query<{ aliases: string[] }>(
        `SELECT aliases FROM public.vendors WHERE id = '${VENDOR_ID}'`,
      );
      expect(before.rows[0]?.aliases).toEqual([]);

      await callReview(db, PRICE_ID, "approve", [PROPOSAL_A]);
      const proposals = await db.query<{ id: string; status: string }>(`
        SELECT id, status FROM public.vendor_alias_proposals
        WHERE official_price_id = '${PRICE_ID}' ORDER BY id
      `);
      expect(proposals.rows).toEqual([
        { id: PROPOSAL_A, status: "approved" },
        { id: PROPOSAL_B, status: "rejected" },
      ]);
      const vendor = await db.query<{ aliases: string[] }>(
        `SELECT aliases FROM public.vendors WHERE id = '${VENDOR_ID}'`,
      );
      expect(vendor.rows[0]?.aliases).toEqual(["옛 이름"]);

      const reviewedAt = await db.query<{ reviewed_at: string }>(`
        SELECT reviewed_at FROM public.vendor_alias_proposals WHERE id = '${PROPOSAL_A}'
      `);
      await callReview(db, PRICE_ID, "approve", [PROPOSAL_A]);
      const replayed = await db.query<{ reviewed_at: string }>(`
        SELECT reviewed_at FROM public.vendor_alias_proposals WHERE id = '${PROPOSAL_A}'
      `);
      expect(replayed.rows).toEqual(reviewedAt.rows);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("automatically exact-matches the same upload name after an admin approves its alias", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role");
      await db.query(`
        INSERT INTO public.vendor_alias_proposals(
          id, official_price_id, vendor_id, alias, normalized_alias
        ) VALUES (
          '${PROPOSAL_A}', '${PRICE_ID}', '${VENDOR_ID}',
          '재업로드 이름', '재업로드이름'
        )
      `);
      await callReview(db, PRICE_ID, "approve", [PROPOSAL_A]);

      const matches = await db.query<{
        vendor_id: string;
        match_kind: string;
      }>(`
        SELECT vendor_id, match_kind
        FROM public.match_vendor_for_price_upload('재업로드 이름', 'studio')
      `);
      expect(matches.rows).toEqual([{
        vendor_id: VENDOR_ID,
        match_kind: "exact_alias",
      }]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("rejects all without mutating aliases, save leaves pending, and failures roll back", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE service_role");
      await db.query(`
        INSERT INTO public.vendor_alias_proposals(
          id, official_price_id, vendor_id, alias, normalized_alias
        ) VALUES ('${PROPOSAL_A}', '${SECOND_PRICE_ID}', '${VENDOR_ID}', '검토 이름', '검토이름')
      `);
      await callReview(db, SECOND_PRICE_ID, "save");
      let state = await db.query<{ status: string }>(`
        SELECT status FROM public.vendor_alias_proposals WHERE id = '${PROPOSAL_A}'
      `);
      expect(state.rows[0]?.status).toBe("pending");
      await expect(callReview(db, SECOND_PRICE_ID, "approve", [PROPOSAL_A], ADMIN_ID, { fail: true }))
        .rejects.toThrow(/GENERATED_REVIEW_FAILURE/iu);
      state = await db.query(`SELECT status FROM public.vendor_alias_proposals WHERE id = '${PROPOSAL_A}'`);
      expect(state.rows[0]?.status).toBe("pending");
      await callReview(db, SECOND_PRICE_ID, "reject");
      state = await db.query(`SELECT status FROM public.vendor_alias_proposals WHERE id = '${PROPOSAL_A}'`);
      expect(state.rows[0]?.status).toBe("rejected");
      const vendor = await db.query<{ aliases: string[] }>(
        `SELECT aliases FROM public.vendors WHERE id = '${VENDOR_ID}'`,
      );
      expect(vendor.rows[0]?.aliases).toEqual([]);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });

  it("is service-only, admin-only, reviewed-immutable, and absent from public views", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE anon");
      await expect(db.query("SELECT * FROM public.vendor_alias_proposals"))
        .rejects.toThrow(/permission denied/iu);
      await db.exec("RESET ROLE; SET ROLE service_role");
      await expect(callReview(db, PRICE_ID, "save", [], USER_ID))
        .rejects.toThrow(/ADMIN_REQUIRED/iu);
      await expect(db.query(`SELECT public.review_official_price('${PRICE_ID}','${ADMIN_ID}','save','{}','[]')`))
        .rejects.toThrow(/permission denied/iu);
      await expect(db.query(`SELECT public.merge_vendor_aliases('${VENDOR_ID}', ARRAY['우회 별칭'])`))
        .rejects.toThrow(/permission denied/iu);
      await db.query(`
        INSERT INTO public.vendor_alias_proposals(
          id, official_price_id, vendor_id, alias, normalized_alias
        ) VALUES ('${PROPOSAL_A}', '${PRICE_ID}', '${VENDOR_ID}', '검토 이름', '검토이름')
      `);
      await callReview(db, PRICE_ID, "reject");
      await expect(db.query(`
        INSERT INTO public.vendor_alias_proposals(
          official_price_id, vendor_id, alias, normalized_alias
        ) VALUES ('${PRICE_ID}', '${VENDOR_ID}', '늦은 제안', '늦은제안')
      `)).rejects.toThrow(/ALREADY_REVIEWED/iu);
      await db.exec("RESET ROLE");
      await expect(db.query(`
        UPDATE public.vendor_alias_proposals SET alias = '변조' WHERE id = '${PROPOSAL_A}'
      `)).rejects.toThrow(/IMMUTABLE/iu);
      const exposed = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'v_public_official_prices'
          AND column_name LIKE '%alias%'
      `);
      expect(exposed.rows[0]?.count).toBe(0);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  });
});
