// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const consentMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716091000_care_explicit_consent.sql",
  ),
  "utf8",
);
const sourceRevisionMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802090000_amora_moment_care_source_revision.sql",
  ),
  "utf8",
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

describe("moment care source revision migration", () => {
  it("rejects stale journey evidence and inserts only against the current revision", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (id uuid PRIMARY KEY);
        CREATE TABLE public.couples (
          id uuid PRIMARY KEY,
          bride_id uuid REFERENCES auth.users(id),
          groom_id uuid REFERENCES auth.users(id)
        );
        CREATE TABLE public.profiles (
          id uuid PRIMARY KEY REFERENCES auth.users(id),
          care_notifications_enabled boolean NOT NULL DEFAULT false,
          care_notifications_consented_at timestamptz
        );
        CREATE TABLE public.wedding_journeys (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          couple_id uuid NOT NULL UNIQUE REFERENCES public.couples(id),
          state_revision bigint NOT NULL DEFAULT 0
        );
        CREATE TABLE public.chat_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          couple_id uuid NOT NULL REFERENCES public.couples(id),
          sender_id uuid,
          sender_type text NOT NULL,
          role text NOT NULL,
          content text NOT NULL,
          visibility text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        INSERT INTO auth.users(id) VALUES ('${BRIDE_ID}'), ('${GROOM_ID}');
        INSERT INTO public.couples(id, bride_id, groom_id)
        VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
        INSERT INTO public.profiles(
          id, care_notifications_enabled, care_notifications_consented_at
        ) VALUES
          ('${BRIDE_ID}', true, now()),
          ('${GROOM_ID}', true, now());
        INSERT INTO public.wedding_journeys(couple_id, state_revision)
        VALUES ('${COUPLE_ID}', 7);
      `);
      await db.exec(consentMigration);
      await db.exec(sourceRevisionMigration);
      await db.exec("SET ROLE service_role");

      const stale = await db.query<{ result: { state: string } }>(
        `SELECT public.insert_amora_moment_care_message(
           $1, $2, $3, $4::jsonb
         ) AS result`,
        [COUPLE_ID, 6, "내일 일정을 확인해봐요.", JSON.stringify({ client_request_id: "moment:stale" })],
      );
      expect(stale.rows[0]?.result).toMatchObject({ state: "source_stale" });

      await db.exec("RESET ROLE");
      const afterStale = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.chat_messages",
      );
      expect(afterStale.rows[0]?.count).toBe(0);

      await db.exec("SET ROLE service_role");
      const inserted = await db.query<{
        result: { state: string; message_id?: string };
      }>(
        `SELECT public.insert_amora_moment_care_message(
           $1, $2, $3, $4::jsonb
         ) AS result`,
        [COUPLE_ID, 7, "내일 일정을 확인해봐요.", JSON.stringify({ client_request_id: "moment:current" })],
      );
      expect(inserted.rows[0]?.result).toMatchObject({
        state: "inserted",
        message_id: expect.stringMatching(UUID_PATTERN),
      });

      await db.exec("RESET ROLE");
      const afterCurrent = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.chat_messages",
      );
      expect(afterCurrent.rows[0]?.count).toBe(1);

      await db.exec(`
        UPDATE public.profiles
        SET care_notifications_enabled = false,
            care_notifications_consented_at = NULL
        WHERE id = '${GROOM_ID}';
        SET ROLE service_role;
      `);
      const refused = await db.query<{ result: { state: string } }>(
        `SELECT public.insert_amora_moment_care_message(
           $1, $2, $3, $4::jsonb
         ) AS result`,
        [COUPLE_ID, 7, "다시 확인해봐요.", JSON.stringify({ client_request_id: "moment:no-consent" })],
      );
      expect(refused.rows[0]?.result).toMatchObject({ state: "consent_required" });

      await db.exec("RESET ROLE");
      const afterRefusal = await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.chat_messages",
      );
      expect(afterRefusal.rows[0]?.count).toBe(1);

      const definition = await db.query<{ prosrc: string }>(`
        SELECT procedure.prosrc
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'insert_amora_moment_care_message'
      `);
      expect(definition.rows[0]?.prosrc).toMatch(
        /FROM public\.couples[\s\S]+FOR SHARE[\s\S]+FROM public\.wedding_journeys[\s\S]+FOR SHARE[\s\S]+public\.insert_amora_care_message/i,
      );

      await db.exec("SET ROLE authenticated");
      await expect(
        db.query(
          `SELECT public.insert_amora_moment_care_message(
             $1, $2, $3, $4::jsonb
           )`,
          [COUPLE_ID, 7, "호출할 수 없어야 해요.", JSON.stringify({})],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
