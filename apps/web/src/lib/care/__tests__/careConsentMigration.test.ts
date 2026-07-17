// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20260716091000_care_explicit_consent.sql"),
  "utf8",
);

describe("explicit outbound-care consent migration", () => {
  it("does not treat the historical default-on boolean as proof of opt-in", async () => {
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
          id uuid PRIMARY KEY,
          care_notifications_enabled boolean NOT NULL DEFAULT true
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
        INSERT INTO auth.users(id) VALUES
          ('00000000-0000-4000-8000-000000000001'),
          ('00000000-0000-4000-8000-000000000002');
        INSERT INTO public.couples(id, bride_id, groom_id) VALUES (
          '10000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002'
        );
        INSERT INTO public.profiles(id, care_notifications_enabled) VALUES
          ('00000000-0000-4000-8000-000000000001', true),
          ('00000000-0000-4000-8000-000000000002', false);
        BEGIN;
        ${migration}
        COMMIT;
      `);

      const rows = await db.query<{
        enabled: boolean;
        consented_at: string | null;
      }>(`
        SELECT care_notifications_enabled AS enabled,
               care_notifications_consented_at::text AS consented_at
        FROM public.profiles ORDER BY id
      `);
      expect(rows.rows).toEqual([
        { enabled: false, consented_at: null },
        { enabled: false, consented_at: null },
      ]);

      const definition = await db.query<{ prosrc: string }>(`
        SELECT p.prosrc
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'insert_amora_care_message'
      `);
      expect(definition.rows[0]?.prosrc).toMatch(
        /FROM public\.couples[\s\S]*WHERE id = p_couple_id[\s\S]*FOR SHARE/i,
      );

      await db.exec(`
        INSERT INTO public.profiles(id)
        VALUES ('00000000-0000-4000-8000-000000000003');
      `);
      const created = await db.query<{ enabled: boolean }>(`
        SELECT care_notifications_enabled AS enabled
        FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000003'
      `);
      expect(created.rows[0]?.enabled).toBe(false);

      await db.exec(`
        UPDATE public.profiles
        SET care_notifications_enabled = true,
            care_notifications_consented_at = now()
        WHERE id = '00000000-0000-4000-8000-000000000001';
        SET ROLE service_role;
      `);
      const refused = await db.query<{ id: string | null }>(`
        SELECT public.insert_amora_care_message(
          '10000000-0000-4000-8000-000000000001',
          '일정 전에 한 번 확인해볼까요?',
          '{"client_request_id":"moment:test"}'::jsonb
        )::text AS id
      `);
      expect(refused.rows[0]?.id).toBeNull();

      await db.exec(`
        RESET ROLE;
        UPDATE public.profiles
        SET care_notifications_enabled = true,
            care_notifications_consented_at = now()
        WHERE id = '00000000-0000-4000-8000-000000000002';
        SET ROLE service_role;
      `);
      const inserted = await db.query<{ id: string | null }>(`
        SELECT public.insert_amora_care_message(
          '10000000-0000-4000-8000-000000000001',
          '일정 전에 한 번 확인해볼까요?',
          '{"client_request_id":"moment:test"}'::jsonb
        )::text AS id
      `);
      expect(inserted.rows[0]?.id).toMatch(UUID_PATTERN);
    } finally {
      await db.exec("RESET ROLE").catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
