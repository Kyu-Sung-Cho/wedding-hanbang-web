// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260812120000_vendor_inquiry_handoff.sql",
  ),
  "utf8",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "11000000-0000-4000-8000-000000000001";
const OTHER_ACTOR_ID = "11000000-0000-4000-8000-000000000002";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "21000000-0000-4000-8000-000000000001";
const BOOKING_ID = "30000000-0000-4000-8000-000000000001";
const DECISION_ID = "40000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
    $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id),
      role text
    );
    CREATE FUNCTION public.is_current_couple_member(
      p_profile_id uuid,
      p_couple_id uuid
    ) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        JOIN public.couples AS couple ON couple.id = profile.couple_id
        WHERE profile.id = p_profile_id
          AND profile.couple_id = p_couple_id
          AND (
            couple.bride_id = p_profile_id
            OR couple.groom_id = p_profile_id
          )
      )
    $$;
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      category text,
      status text NOT NULL,
      official_url text,
      instagram_url text,
      naver_place_url text
    );
    CREATE TABLE public.vendor_products (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      name text
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      product_id uuid REFERENCES public.vendor_products(id),
      booking_date date NOT NULL,
      booking_time time NOT NULL,
      status text NOT NULL,
      vendor_delivery_status text NOT NULL,
      intent_vendor_name_snapshot text,
      intent_product_name_snapshot text
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      decision_type text NOT NULL,
      source text NOT NULL,
      source_ref_id uuid,
      chosen_value jsonb DEFAULT '{}'::jsonb,
      metadata jsonb DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE VIEW public.v_public_vendors AS
    SELECT
      vendor.id,
      vendor.official_url,
      vendor.instagram_url,
      vendor.naver_place_url
    FROM public.vendors AS vendor
    WHERE vendor.status = 'approved';

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_current_couple_member(uuid, uuid) TO PUBLIC;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.couples (id, bride_id)
    VALUES ('${COUPLE_ID}', '${ACTOR_ID}');
    INSERT INTO public.profiles (id, couple_id, role) VALUES
      ('${ACTOR_ID}', '${COUPLE_ID}', 'bride'),
      ('${OTHER_ACTOR_ID}', NULL, 'bride');
    INSERT INTO public.vendors (
      id, name, category, status, official_url, instagram_url, naver_place_url
    ) VALUES (
      '${VENDOR_ID}', '한방 스튜디오', 'studio', 'approved',
      'https://example.com',
      'https://www.instagram.com/hanbangstudio/',
      'https://m.place.naver.com/place/123'
    );
    INSERT INTO public.vendor_products (id, vendor_id, name)
    VALUES ('${PRODUCT_ID}', '${VENDOR_ID}', '기본 촬영');
    INSERT INTO public.vendor_bookings (
      id, vendor_id, couple_id, product_id, booking_date, booking_time,
      status, vendor_delivery_status, intent_vendor_name_snapshot,
      intent_product_name_snapshot
    ) VALUES (
      '${BOOKING_ID}', '${VENDOR_ID}', '${COUPLE_ID}', '${PRODUCT_ID}',
      '2099-07-20', '10:00', 'pending', 'not_sent',
      '한방 스튜디오', '기본 촬영'
    );
    INSERT INTO public.decision_nodes (
      id, couple_id, decision_type, source, source_ref_id,
      chosen_value, metadata
    ) VALUES (
      '${DECISION_ID}', '${COUPLE_ID}', 'considering', 'vendor_booking',
      '${BOOKING_ID}',
      '{"vendor_delivery_status":"not_sent"}'::jsonb,
      '{"hook":"booking_intent"}'::jsonb
    );
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(db: PGlite, role: "authenticated" | "service_role") {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

async function resolveHandoff(
  db: PGlite,
  action: "inspect" | "prepare" | "mark_sent" | "record_reply",
  expectedRevision: number | null,
  contactChannel: "website" | "instagram" | "naver_place" | null = null,
  outcome: "available" | "unavailable" | "needs_follow_up" | "other" | null = null,
  actorId = ACTOR_ID,
) {
  return db.query<{ result: Record<string, unknown> }>(
    `SELECT public.resolve_vendor_inquiry_handoff_atomic(
       $1, $2, $3, $4, $5, $6
     ) AS result`,
    [BOOKING_ID, actorId, action, expectedRevision, contactChannel, outcome],
  );
}

describe("vendor inquiry handoff migration", () => {
  it("prepares a direct-contact handoff without claiming provider delivery", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");

      const prepared = await resolveHandoff(db, "prepare", 0, "website");

      expect(prepared.rows[0]?.result).toMatchObject({
        accepted: true,
        bookingId: BOOKING_ID,
        vendorName: "한방 스튜디오",
        providerDeliveryStatus: "not_integrated",
        handoff: {
          status: "prepared",
          contactChannel: "website",
          contactTarget: "https://example.com",
          providerDeliveryStatus: "not_integrated",
          userReportedOutcome: null,
          revision: 1,
        },
      });
      expect(prepared.rows[0]?.result).toMatchObject({
        contactSource: "verified_public_vendor_view",
        contactOptions: [
          { channel: "website", target: "https://example.com" },
          {
            channel: "instagram",
            target: "https://www.instagram.com/hanbangstudio/",
          },
          {
            channel: "naver_place",
            target: "https://m.place.naver.com/place/123",
          },
        ],
      });
      expect(JSON.stringify(prepared.rows[0]?.result)).toContain("2099-07-20 10:00");

      await resetPersona(db);

      const stored = await db.query<{
        provider_delivery_status: string;
        user_reported_sent_at: string | null;
      }>(
        `SELECT provider_delivery_status, user_reported_sent_at
         FROM public.vendor_inquiry_handoffs
         WHERE booking_id = $1`,
        [BOOKING_ID],
      );
      expect(stored.rows[0]).toEqual({
        provider_delivery_status: "not_integrated",
        user_reported_sent_at: null,
      });

      const decision = await db.query<{
        handoff_status: string;
        evidence: string;
      }>(
        `SELECT
           chosen_value ->> 'inquiry_handoff_status' AS handoff_status,
           metadata ->> 'inquiry_handoff_evidence' AS evidence
         FROM public.decision_nodes
         WHERE id = $1`,
        [DECISION_ID],
      );
      expect(decision.rows[0]).toEqual({
        handoff_status: "prepared",
        evidence: "user_initiated",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("records sent and reply outcomes as idempotent user reports, never provider receipts", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await resolveHandoff(db, "prepare", 0, "instagram");

      const firstSent = await resolveHandoff(db, "mark_sent", 1);
      const retriedSent = await resolveHandoff(db, "mark_sent", 1);
      expect(retriedSent.rows[0]?.result).toEqual(firstSent.rows[0]?.result);
      expect(firstSent.rows[0]?.result).toMatchObject({
        providerDeliveryStatus: "not_integrated",
        handoff: {
          status: "sent",
          providerDeliveryStatus: "not_integrated",
          userReportedOutcome: null,
          revision: 2,
        },
      });

      const firstReply = await resolveHandoff(db, "record_reply", 2, null, "available");
      const retriedReply = await resolveHandoff(db, "record_reply", 2, null, "available");
      expect(retriedReply.rows[0]?.result).toEqual(firstReply.rows[0]?.result);
      expect(firstReply.rows[0]?.result).toMatchObject({
        providerDeliveryStatus: "not_integrated",
        handoff: {
          status: "replied",
          userReportedOutcome: "available",
          revision: 3,
        },
      });

      const correctedReply = await resolveHandoff(
        db,
        "record_reply",
        3,
        null,
        "needs_follow_up",
      );
      expect(correctedReply.rows[0]?.result).toMatchObject({
        handoff: {
          status: "replied",
          userReportedOutcome: "needs_follow_up",
          revision: 4,
        },
      });

      await resetPersona(db);
      const decision = await db.query<{
        handoff_status: string;
        outcome: string;
        evidence: string;
        provider_status: string;
      }>(
        `SELECT
           chosen_value ->> 'inquiry_handoff_status' AS handoff_status,
           chosen_value ->> 'inquiry_user_reported_outcome' AS outcome,
           metadata ->> 'inquiry_handoff_evidence' AS evidence,
           metadata ->> 'provider_delivery_status' AS provider_status
         FROM public.decision_nodes
         WHERE id = $1`,
        [DECISION_ID],
      );
      expect(decision.rows[0]).toEqual({
        handoff_status: "replied",
        outcome: "needs_follow_up",
        evidence: "user_reported",
        provider_status: "not_integrated",
      });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps inspection and mutation service-only and scoped to the current booking couple", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated");
      await expect(resolveHandoff(db, "inspect", null)).rejects.toThrow(
        /permission denied|VENDOR_INQUIRY_HANDOFF_SERVICE_ROLE_REQUIRED/,
      );

      await resetPersona(db);
      await setPersona(db, "service_role");
      await expect(
        resolveHandoff(db, "prepare", 0, "website", null, OTHER_ACTOR_ID),
      ).rejects.toThrow("VENDOR_INQUIRY_HANDOFF_NOT_FOUND");

      await resetPersona(db);
      const count = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.vendor_inquiry_handoffs",
      );
      expect(count.rows[0]?.count).toBe(0);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("lets only one of two different outcomes win from the same captured revision", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "service_role");
      await resolveHandoff(db, "prepare", 0, "website");
      await resolveHandoff(db, "mark_sent", 1);

      const contenders = await Promise.allSettled([
        resolveHandoff(db, "record_reply", 2, null, "available"),
        resolveHandoff(db, "record_reply", 2, null, "unavailable"),
      ]);
      expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = contenders.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({ status: "rejected" });
      expect(String((rejected as PromiseRejectedResult).reason)).toContain(
        "VENDOR_INQUIRY_HANDOFF_REVISION_CONFLICT",
      );

      const inspected = await resolveHandoff(db, "inspect", null);
      const winner = contenders.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof resolveHandoff>>>;
      expect(inspected.rows[0]?.result).toEqual(winner.value.rows[0]?.result);
      expect(inspected.rows[0]?.result).toMatchObject({ handoff: { revision: 3 } });
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
