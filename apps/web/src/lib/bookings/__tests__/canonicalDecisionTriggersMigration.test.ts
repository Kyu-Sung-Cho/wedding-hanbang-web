// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802125000_record_canonical_couple_decisions.sql",
  ),
  "utf8",
);

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ONE = "11000000-0000-4000-8000-000000000001";
const USER_TWO = "11000000-0000-4000-8000-000000000002";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";
const BOOKING_ID = "30000000-0000-4000-8000-000000000001";
const JOURNEY_ID = "40000000-0000-4000-8000-000000000001";

async function createDatabase({ seedLegacy = false } = {}) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id)
    );
    CREATE TABLE public.vendors (
      id uuid PRIMARY KEY,
      name text,
      category text
    );
    CREATE TABLE public.vendor_bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      couple_id uuid NOT NULL REFERENCES public.couples(id),
      product_id uuid,
      booking_date date NOT NULL,
      booking_time time NOT NULL,
      amount numeric,
      status text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.vendor_favorites (
      user_id uuid NOT NULL,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, vendor_id)
    );
    CREATE TABLE public.wishlists (
      user_id uuid NOT NULL,
      vendor_id uuid NOT NULL REFERENCES public.vendors(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, vendor_id)
    );
    CREATE FUNCTION public.sync_price_wishlist_with_legacy_favorite()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
      END IF;
      IF TG_OP = 'INSERT' THEN
        IF TG_TABLE_NAME = 'wishlists' THEN
          INSERT INTO public.vendor_favorites (user_id, vendor_id, created_at)
          VALUES (NEW.user_id, NEW.vendor_id, NEW.created_at)
          ON CONFLICT (user_id, vendor_id) DO NOTHING;
        ELSE
          INSERT INTO public.wishlists (user_id, vendor_id, created_at)
          VALUES (NEW.user_id, NEW.vendor_id, NEW.created_at)
          ON CONFLICT (user_id, vendor_id) DO NOTHING;
        END IF;
        RETURN NEW;
      END IF;
      IF TG_TABLE_NAME = 'wishlists' THEN
        DELETE FROM public.vendor_favorites
        WHERE user_id = OLD.user_id AND vendor_id = OLD.vendor_id;
      ELSE
        DELETE FROM public.wishlists
        WHERE user_id = OLD.user_id AND vendor_id = OLD.vendor_id;
      END IF;
      RETURN OLD;
    END
    $$;
    CREATE TRIGGER wishlists_sync_legacy_favorite
    AFTER INSERT OR DELETE ON public.wishlists
    FOR EACH ROW EXECUTE FUNCTION public.sync_price_wishlist_with_legacy_favorite();
    CREATE TRIGGER vendor_favorites_sync_price_wishlist
    AFTER INSERT OR DELETE ON public.vendor_favorites
    FOR EACH ROW EXECUTE FUNCTION public.sync_price_wishlist_with_legacy_favorite();
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
      wedding_date date,
      venue text,
      total_budget bigint,
      progress jsonb DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.decision_nodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      couple_id uuid REFERENCES public.couples(id),
      category text,
      decision_type text CHECK (
        decision_type IN ('exploring','considering','decided','scheduled','booked','completed')
      ),
      title text,
      chosen_value jsonb,
      options_considered jsonb DEFAULT '[]'::jsonb,
      reasoning text,
      confidence numeric(3,2),
      stage_tag text CHECK (
        stage_tag IS NULL OR stage_tag IN (
          'planning_0','preparation_1','execution_2','ceremony_3','settlement_4'
        )
      ),
      decided_at timestamptz,
      source text CHECK (
        source IN ('chat','manual','import','vendor_booking','schedule','budget','onboarding','community')
      ),
      source_ref_id uuid,
      metadata jsonb DEFAULT '{}'::jsonb,
      visibility text NOT NULL DEFAULT 'shared',
      memory_key text,
      source_message_id uuid,
      source_actor_role text CHECK (
        source_actor_role IS NULL OR source_actor_role IN ('bride', 'groom')
      ),
      superseded_at timestamptz,
      superseded_by uuid REFERENCES public.decision_nodes(id),
      user_confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX decision_nodes_active_memory_actor_key_unique
      ON public.decision_nodes (
        couple_id, visibility, COALESCE(source_actor_role, 'legacy'), memory_key
      )
      WHERE memory_key IS NOT NULL AND superseded_at IS NULL;
    CREATE UNIQUE INDEX decision_nodes_booking_outcome_unique
      ON public.decision_nodes (couple_id, source_ref_id, source, decision_type)
      WHERE source = 'vendor_booking'
        AND decision_type = 'completed'
        AND source_ref_id IS NOT NULL;

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

    INSERT INTO public.couples (id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${USER_ONE}', '${USER_TWO}');
    INSERT INTO public.profiles (id, couple_id) VALUES
      ('${USER_ONE}', '${COUPLE_ID}'),
      ('${USER_TWO}', '${COUPLE_ID}');
    INSERT INTO public.vendors (id, name, category)
    VALUES ('${VENDOR_ID}', '한방 스튜디오', 'studio');

    ${seedLegacy ? `
      INSERT INTO public.vendor_bookings (
        id, vendor_id, couple_id, booking_date, booking_time, amount, status
      ) VALUES (
        '${BOOKING_ID}', '${VENDOR_ID}', '${COUPLE_ID}',
        '2099-07-20', '10:00', 500000, 'pending'
      );
      INSERT INTO public.vendor_favorites (user_id, vendor_id)
      VALUES ('${USER_ONE}', '${VENDOR_ID}');
      INSERT INTO public.wedding_journeys (
        id, couple_id, wedding_date, venue, total_budget, progress
      ) VALUES (
        '${JOURNEY_ID}', '${COUPLE_ID}', '2099-09-01', '새 예식장', 30000000,
        '{"__events":[]}'::jsonb
      );
      INSERT INTO public.decision_nodes (
        id, couple_id, category, decision_type, title, chosen_value,
        source, source_ref_id, metadata
      ) VALUES
        (
          '51000000-0000-4000-8000-000000000001', '${COUPLE_ID}', 'studio',
          'booked', '예약: 한방 스튜디오',
          '{"vendor_id":"${VENDOR_ID}","booking_date":"2099-07-20"}'::jsonb,
          'vendor_booking', '${BOOKING_ID}', '{"hook":"bookings"}'::jsonb
        ),
        (
          '51000000-0000-4000-8000-000000000002', '${COUPLE_ID}', 'studio',
          'considering', '찜: 한방 스튜디오', '{"vendor_id":"${VENDOR_ID}"}'::jsonb,
          'manual', '${VENDOR_ID}', '{"hook":"favorites"}'::jsonb
        ),
        (
          '51000000-0000-4000-8000-000000000003', '${COUPLE_ID}', 'venue',
          'considering', '옛 예식장', '{"venue":"옛 예식장"}'::jsonb,
          'onboarding', NULL, '{"hook":"onboarding"}'::jsonb
        ),
        (
          '51000000-0000-4000-8000-000000000004', '${COUPLE_ID}', 'preference',
          'considering', '신부 기억', '{"value":"A"}'::jsonb,
          'chat', NULL, '{}'::jsonb
        ),
        (
          '51000000-0000-4000-8000-000000000005', '${COUPLE_ID}', 'preference',
          'considering', '신랑 기억', '{"value":"B"}'::jsonb,
          'chat', NULL, '{}'::jsonb
        );
      UPDATE public.decision_nodes
      SET memory_key = 'preference:venue_style', source_actor_role = 'bride'
      WHERE id = '51000000-0000-4000-8000-000000000004';
      UPDATE public.decision_nodes
      SET memory_key = 'preference:venue_style', source_actor_role = 'groom'
      WHERE id = '51000000-0000-4000-8000-000000000005';
    ` : ""}
  `);
  await db.exec(migration);
  return db;
}

describe("canonical couple decision trigger migration", () => {
  it("keeps helpers private, pins trusted search paths, and leaves memory keys for chat memory only", () => {
    expect(migration).toMatch(/SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.write_canonical_decision_node[\s\S]*FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(/memory_key = NULL/i);
    expect(migration).not.toMatch(/DROP INDEX[^;]*decision_nodes_active_memory_actor_key_unique/i);
    expect(migration).toContain(
      "'hanbang:couple-membership:' || v_favorite.user_id::text",
    );
    expect(migration).toMatch(
      /FROM public\.profiles AS profile[\s\S]*WHERE profile\.id = v_favorite\.user_id[\s\S]*FOR SHARE;/i,
    );
  });

  it("rolls back booking creation/status changes when its decision cannot commit", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE FUNCTION public.reject_canonical_decision()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'forced_decision_failure';
        END
        $$;
        CREATE TRIGGER reject_canonical_decision
        BEFORE INSERT OR UPDATE ON public.decision_nodes
        FOR EACH ROW EXECUTE FUNCTION public.reject_canonical_decision();
      `);

      await expect(db.query(
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, amount, status
         ) VALUES ($1, $2, $3, '2099-07-20', '10:00', 500000, 'pending')`,
        [BOOKING_ID, VENDOR_ID, COUPLE_ID],
      )).rejects.toThrow("forced_decision_failure");

      expect((await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.vendor_bookings",
      )).rows[0]?.count).toBe(0);

      await db.exec("DROP TRIGGER reject_canonical_decision ON public.decision_nodes");
      await db.query(
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, amount, status
         ) VALUES ($1, $2, $3, '2099-07-20', '10:00', 500000, 'pending')`,
        [BOOKING_ID, VENDOR_ID, COUPLE_ID],
      );

      const active = await db.query<{
        decision_type: string;
        memory_key: string | null;
        identity: string;
      }>(`
        SELECT decision_type, memory_key, metadata ->> 'canonical_identity' AS identity
        FROM public.decision_nodes WHERE superseded_at IS NULL
      `);
      expect(active.rows).toEqual([{
        decision_type: "booked",
        memory_key: null,
        identity: `booking:${BOOKING_ID}`,
      }]);

      await db.exec(`
        CREATE TRIGGER reject_canonical_decision
        BEFORE INSERT OR UPDATE ON public.decision_nodes
        FOR EACH ROW EXECUTE FUNCTION public.reject_canonical_decision();
      `);
      await expect(db.query(
        "UPDATE public.vendor_bookings SET status = 'cancelled' WHERE id = $1",
        [BOOKING_ID],
      )).rejects.toThrow("forced_decision_failure");
      expect((await db.query<{ status: string }>(
        "SELECT status FROM public.vendor_bookings WHERE id = $1",
        [BOOKING_ID],
      )).rows[0]?.status).toBe("pending");

      await db.exec("DROP TRIGGER reject_canonical_decision ON public.decision_nodes");
      await db.query(
        "UPDATE public.vendor_bookings SET status = 'cancelled' WHERE id = $1",
        [BOOKING_ID],
      );
      const retired = await db.query<{ reason: string; superseded: boolean }>(`
        SELECT metadata ->> 'canonical_retired_reason' AS reason,
               superseded_at IS NOT NULL AS superseded
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = $1
      `, [`booking:${BOOKING_ID}`]);
      expect(retired.rows[0]).toEqual({
        reason: "booking_cancelled",
        superseded: true,
      });

      await db.query(
        "UPDATE public.vendor_bookings SET status = 'pending' WHERE id = $1",
        [BOOKING_ID],
      );
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = $1 AND superseded_at IS NULL
      `, [`booking:${BOOKING_ID}`])).rows[0]?.count).toBe(1);

      await db.query(
        "UPDATE public.vendor_bookings SET status = 'completed' WHERE id = $1",
        [BOOKING_ID],
      );
      await db.query(`
        INSERT INTO public.decision_nodes (
          couple_id, category, decision_type, title, chosen_value,
          source, source_ref_id, metadata
        ) VALUES (
          $1, 'studio', 'completed', '완료: 한방 스튜디오', '{}'::jsonb,
          'vendor_booking', $2, '{"hook":"booking_outcome"}'::jsonb
        )
      `, [COUPLE_ID, BOOKING_ID]);
      const terminalState = await db.query<{
        booked_active: number;
        completed_active: number;
      }>(`
        SELECT
          count(*) FILTER (
            WHERE decision_type = 'booked' AND superseded_at IS NULL
          )::integer AS booked_active,
          count(*) FILTER (
            WHERE decision_type = 'completed' AND superseded_at IS NULL
          )::integer AS completed_active
        FROM public.decision_nodes
        WHERE source_ref_id = $1
      `, [BOOKING_ID]);
      expect(terminalState.rows[0]).toEqual({
        booked_active: 0,
        completed_active: 1,
      });

      const deletedBookingId = "30000000-0000-4000-8000-000000000002";
      await db.query(
        `INSERT INTO public.vendor_bookings (
           id, vendor_id, couple_id, booking_date, booking_time, amount, status
         ) VALUES ($1, $2, $3, '2099-07-21', '11:00', 600000, 'pending')`,
        [deletedBookingId, VENDOR_ID, COUPLE_ID],
      );
      await db.query("DELETE FROM public.vendor_bookings WHERE id = $1", [deletedBookingId]);
      expect((await db.query<{ reason: string }>(`
        SELECT metadata ->> 'canonical_retired_reason' AS reason
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = $1
      `, [`booking:${deletedBookingId}`])).rows[0]?.reason).toBe("booking_deleted");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("isolates each partner's favorite and preserves remove/re-add history", async () => {
    const db = await createDatabase();
    try {
      await Promise.all([
        db.query(
          "INSERT INTO public.vendor_favorites (user_id, vendor_id) VALUES ($1, $2)",
          [USER_ONE, VENDOR_ID],
        ),
        db.query(
          "INSERT INTO public.vendor_favorites (user_id, vendor_id) VALUES ($1, $2)",
          [USER_TWO, VENDOR_ID],
        ),
      ]);

      const countActive = () => db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = $1
          AND superseded_at IS NULL
      `, [`favorite:${VENDOR_ID}`]);

      expect((await countActive()).rows[0]?.count).toBe(2);
      await db.query(
        "DELETE FROM public.vendor_favorites WHERE user_id = $1 AND vendor_id = $2",
        [USER_ONE, VENDOR_ID],
      );
      expect((await countActive()).rows[0]?.count).toBe(1);

      await db.query(
        "DELETE FROM public.vendor_favorites WHERE user_id = $1 AND vendor_id = $2",
        [USER_TWO, VENDOR_ID],
      );
      expect((await countActive()).rows[0]?.count).toBe(0);

      await db.query(
        "INSERT INTO public.vendor_favorites (user_id, vendor_id) VALUES ($1, $2)",
        [USER_ONE, VENDOR_ID],
      );
      expect((await countActive()).rows[0]?.count).toBe(1);
      const history = await db.query<{ total: number; retired: number }>(`
        SELECT count(*)::integer AS total,
               count(*) FILTER (WHERE superseded_at IS NOT NULL)::integer AS retired
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = $1
      `, [`favorite:${VENDOR_ID}`]);
      expect(history.rows[0]).toEqual({ total: 3, retired: 2 });
      const retiredLinks = await db.query<{
        actor: string;
        has_successor: boolean;
      }>(`
        SELECT source_actor_role AS actor, superseded_by IS NOT NULL AS has_successor
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = $1
          AND superseded_at IS NOT NULL
        ORDER BY source_actor_role
      `, [`favorite:${VENDOR_ID}`]);
      expect(retiredLinks.rows).toEqual([
        { actor: "bride", has_successor: true },
        { actor: "groom", has_successor: false },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("purges a departed member's favorite history, blocks stale membership writes, and rebuilds only on a roster join", async () => {
    const db = await createDatabase();
    try {
      await db.query(
        "INSERT INTO public.vendor_favorites (user_id, vendor_id) VALUES ($1, $2), ($3, $2)",
        [USER_ONE, VENDOR_ID, USER_TWO],
      );
      await db.query(
        "UPDATE public.couples SET groom_id = NULL WHERE id = $1",
        [COUPLE_ID],
      );

      const actorCounts = () => db.query<{ actor: string; count: number }>(`
        SELECT source_actor_role AS actor, count(*)::integer AS count
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = $1
        GROUP BY source_actor_role
        ORDER BY source_actor_role
      `, [`favorite:${VENDOR_ID}`]);
      expect((await actorCounts()).rows).toEqual([{ actor: "bride", count: 1 }]);

      await db.query(
        "DELETE FROM public.vendor_favorites WHERE user_id = $1 AND vendor_id = $2",
        [USER_TWO, VENDOR_ID],
      );
      await expect(db.query(
        "INSERT INTO public.vendor_favorites (user_id, vendor_id) VALUES ($1, $2)",
        [USER_TWO, VENDOR_ID],
      )).rejects.toThrow("FAVORITE_COUPLE_MEMBERSHIP_INVALID");
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM public.vendor_favorites
        WHERE user_id = $1 AND vendor_id = $2
      `, [USER_TWO, VENDOR_ID])).rows[0]?.count).toBe(0);

      await db.query("UPDATE public.profiles SET couple_id = NULL WHERE id = $1", [USER_TWO]);
      await db.query(
        "INSERT INTO public.vendor_favorites (user_id, vendor_id) VALUES ($1, $2)",
        [USER_TWO, VENDOR_ID],
      );
      expect((await actorCounts()).rows).toEqual([{ actor: "bride", count: 1 }]);

      await db.query(
        "UPDATE public.couples SET groom_id = $1 WHERE id = $2",
        [USER_TWO, COUPLE_ID],
      );
      expect((await actorCounts()).rows).toEqual([
        { actor: "bride", count: 1 },
        { actor: "groom", count: 1 },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("appends and supersedes every canonical journey-field change without reacting to unrelated progress", async () => {
    const db = await createDatabase();
    try {
      await db.query(
        `INSERT INTO public.wedding_journeys (
           id, couple_id, wedding_date, venue, total_budget, progress
         ) VALUES (
           $1, $2, '2099-09-01', '첫 예식장', 30000000,
           '{"__events":[{"momentType":"sanggyeonrye","date":"2099-03-01"}]}'::jsonb
         )`,
        [JOURNEY_ID, COUPLE_ID],
      );

      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.decision_nodes
        WHERE metadata ->> 'canonical_table' = 'wedding_journeys'
          AND superseded_at IS NULL
      `)).rows[0]?.count).toBe(4);

      await db.query(
        "UPDATE public.wedding_journeys SET wedding_date = '2099-10-01' WHERE id = $1",
        [JOURNEY_ID],
      );
      await db.query(
        "UPDATE public.wedding_journeys SET wedding_date = NULL WHERE id = $1",
        [JOURNEY_ID],
      );
      const weddingHistory = await db.query<{
        decision_type: string;
        value: string | null;
        active: boolean;
        linked: boolean;
      }>(`
        SELECT decision_type,
               chosen_value ->> 'wedding_date' AS value,
               superseded_at IS NULL AS active,
               superseded_at IS NULL OR superseded_by IS NOT NULL AS linked
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = 'journey:wedding_date'
        ORDER BY created_at, id
      `);
      expect(weddingHistory.rows).toHaveLength(3);
      expect(weddingHistory.rows.filter((row) => row.active)).toEqual([{
        decision_type: "exploring",
        value: null,
        active: true,
        linked: true,
      }]);
      expect(weddingHistory.rows.every((row) => row.linked)).toBe(true);

      await db.query(
        `UPDATE public.wedding_journeys
         SET progress = progress || '{"unrelated":true}'::jsonb
         WHERE id = $1`,
        [JOURNEY_ID],
      );
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = 'journey:sanggyeonrye_date'
      `)).rows[0]?.count).toBe(1);

      await db.query(
        `UPDATE public.wedding_journeys
         SET progress = jsonb_set(
           progress, '{__events,0,date}', '"2099-03-02"'::jsonb
         )
         WHERE id = $1`,
        [JOURNEY_ID],
      );
      expect((await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = 'journey:sanggyeonrye_date'
      `)).rows[0]?.count).toBe(2);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("adopts legacy hooks, corrects stale journey state, and preserves actor-scoped memory uniqueness", async () => {
    const db = await createDatabase({ seedLegacy: true });
    try {
      const adopted = await db.query<{ id: string; identity: string }>(`
        SELECT id, metadata ->> 'canonical_identity' AS identity
        FROM public.decision_nodes
        WHERE id IN (
          '51000000-0000-4000-8000-000000000001',
          '51000000-0000-4000-8000-000000000002'
        )
        ORDER BY id
      `);
      expect(adopted.rows).toEqual([{
        id: "51000000-0000-4000-8000-000000000001",
        identity: `booking:${BOOKING_ID}`,
      }]);
      const rebuiltFavorite = await db.query<{ actor: string; memory_key: string | null }>(`
        SELECT source_actor_role AS actor, memory_key
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = $1
          AND superseded_at IS NULL
      `, [`favorite:${VENDOR_ID}`]);
      expect(rebuiltFavorite.rows).toEqual([{
        actor: "bride",
        memory_key: null,
      }]);

      const venueHistory = await db.query<{
        venue: string;
        active: boolean;
        superseded_by: string | null;
      }>(`
        SELECT chosen_value ->> 'venue' AS venue,
               superseded_at IS NULL AS active,
               superseded_by
        FROM public.decision_nodes
        WHERE metadata ->> 'canonical_identity' = 'journey:venue'
        ORDER BY created_at, id
      `);
      expect(venueHistory.rows).toHaveLength(2);
      expect(venueHistory.rows.find((row) => row.venue === "옛 예식장")).toMatchObject({
        active: false,
        superseded_by: expect.any(String),
      });
      expect(venueHistory.rows.find((row) => row.venue === "새 예식장")).toMatchObject({
        active: true,
      });

      const memories = await db.query<{ actor: string; memory_key: string }>(`
        SELECT source_actor_role AS actor, memory_key
        FROM public.decision_nodes
        WHERE memory_key = 'preference:venue_style'
        ORDER BY source_actor_role
      `);
      expect(memories.rows).toEqual([
        { actor: "bride", memory_key: "preference:venue_style" },
        { actor: "groom", memory_key: "preference:venue_style" },
      ]);
    } finally {
      await db.close();
    }
  }, 30_000);
});
