import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const originalMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731170000_amora_personalization_preferences.sql",
  ),
  "utf8",
);
const toneMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731184000_amora_tone_style.sql",
  ),
  "utf8",
);

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid()
      TO anon, authenticated, service_role;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    INSERT INTO public.profiles (id)
    VALUES ('11111111-1111-4111-8111-111111111111');
  `);
  return db;
}

describe("Amora tone-style successor migration", () => {
  it("adds only allowlisted tones and serializes v1, v2, and delete with one lock key", () => {
    expect(toneMigration).toContain(
      "ADD COLUMN tone_style text NOT NULL DEFAULT 'adaptive'",
    );
    expect(toneMigration).toContain(
      "CHECK (tone_style IN ('adaptive', 'warm', 'calm_clear', 'friendly_honest'))",
    );
    expect(toneMigration).toContain(
      "public.set_own_amora_personalization_preferences_v2",
    );
    expect(toneMigration).toContain(
      "'amora-personalization-v1:' || v_owner_user_id::text",
    );
    expect(toneMigration).not.toContain(
      "CREATE OR REPLACE FUNCTION public.set_own_amora_personalization_preferences(",
    );
  });

  it("defaults existing rows, preserves tone through legacy writes, and applies v2 CAS", async () => {
    const db = await createDatabase();
    try {
      await db.exec(originalMigration);
      await db.exec(`
        SET request.jwt.claim.sub =
          '11111111-1111-4111-8111-111111111111';
        SET ROLE authenticated;
      `);
      await db.query(`
        SELECT *
        FROM public.set_own_amora_personalization_preferences(
          NULL,
          'recommend_first',
          'brief',
          'listen_first',
          'together',
          'couple_first'
        )
      `);
      await db.exec("RESET ROLE;");
      await db.exec(toneMigration);
      await db.exec("SET ROLE authenticated;");

      const migrated = await db.query<{ tone_style: string; revision: number }>(`
        SELECT tone_style, revision
        FROM public.amora_personalization_preferences
      `);
      expect(migrated.rows).toEqual([{ tone_style: "adaptive", revision: 1 }]);

      const toned = await db.query<{ tone_style: string; revision: number }>(`
        SELECT tone_style, revision
        FROM public.set_own_amora_personalization_preferences_v2(
          1,
          'recommend_first',
          'brief',
          'listen_first',
          'together',
          'couple_first',
          'warm'
        )
      `);
      expect(toned.rows).toEqual([{ tone_style: "warm", revision: 2 }]);

      const legacy = await db.query<{ revision: number }>(`
        SELECT revision
        FROM public.set_own_amora_personalization_preferences(
          2,
          'compare_first',
          'brief',
          'listen_first',
          'together',
          'couple_first'
        )
      `);
      expect(legacy.rows).toEqual([{ revision: 3 }]);
      const afterLegacy = await db.query<{
        decision_start: string;
        tone_style: string;
        revision: number;
      }>(`
        SELECT decision_start, tone_style, revision
        FROM public.amora_personalization_preferences
      `);
      expect(afterLegacy.rows).toEqual([{
        decision_start: "compare_first",
        tone_style: "warm",
        revision: 3,
      }]);

      await expect(
        db.query(`
          SELECT *
          FROM public.set_own_amora_personalization_preferences_v2(
            2,
            'recommend_first',
            'brief',
            'listen_first',
            'together',
            'couple_first',
            'friendly_honest'
          )
        `),
      ).rejects.toThrow("AMORA_PERSONALIZATION_REVISION_CONFLICT");
      await expect(
        db.query(`
          SELECT *
          FROM public.set_own_amora_personalization_preferences_v2(
            3,
            'compare_first',
            'brief',
            'listen_first',
            'together',
            'couple_first',
            'banmal'
          )
        `),
      ).rejects.toThrow("AMORA_PERSONALIZATION_INVALID_PREFERENCES");
    } finally {
      await db.close();
    }
  });
});
