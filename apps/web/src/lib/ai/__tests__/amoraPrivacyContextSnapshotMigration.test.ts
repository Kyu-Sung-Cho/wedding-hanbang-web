// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731174000_amora_privacy_context_snapshot.sql",
  ),
  "utf8",
);

const BRIDE_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000003";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

type SnapshotRow = {
  snapshot: {
    version: number;
    actorRole: string;
    rosterFingerprint: string;
    memory: Record<
      string,
      { enabled: boolean; resetAt: string | null }
    >;
    personalization: {
      exists: boolean;
      revision: number | null;
    };
  };
};

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;

    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$
        SELECT NULLIF(
          current_setting('request.jwt.claim.sub', true),
          ''
        )::uuid
      $$;

    CREATE TABLE public.couples (
      id uuid PRIMARY KEY,
      bride_id uuid,
      groom_id uuid
    );
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      couple_id uuid,
      role text
    );
    CREATE TABLE public.amora_memory_settings (
      couple_id uuid NOT NULL,
      visibility text NOT NULL,
      enabled boolean NOT NULL,
      memory_reset_at timestamptz,
      PRIMARY KEY (couple_id, visibility)
    );
    CREATE TABLE public.amora_memory_consents (
      couple_id uuid NOT NULL,
      visibility text NOT NULL,
      user_id uuid NOT NULL,
      PRIMARY KEY (couple_id, visibility, user_id)
    );
    CREATE TABLE public.amora_personalization_preferences (
      owner_user_id uuid PRIMARY KEY,
      revision bigint NOT NULL
    );

    CREATE FUNCTION public.has_current_amora_memory_consent(
      p_couple_id uuid,
      p_visibility text
    )
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      WITH current_members AS (
        SELECT member.user_id
        FROM public.couples AS couple
        CROSS JOIN LATERAL (
          VALUES
            (couple.bride_id, 'bride_private'::text),
            (couple.groom_id, 'groom_private'::text)
        ) AS member(user_id, private_visibility)
        WHERE couple.id = p_couple_id
          AND member.user_id IS NOT NULL
          AND (
            p_visibility = 'shared'
            OR p_visibility = member.private_visibility
          )
      )
      SELECT p_visibility IN (
          'shared',
          'bride_private',
          'groom_private'
        )
        AND EXISTS (SELECT 1 FROM current_members)
        AND (
          p_visibility <> 'shared'
          OR (SELECT pg_catalog.count(*) FROM current_members) = 2
        )
        AND EXISTS (
          SELECT 1
          FROM public.amora_memory_settings AS setting
          WHERE setting.couple_id = p_couple_id
            AND setting.visibility = p_visibility
            AND setting.enabled = true
        )
        AND NOT EXISTS (
          SELECT 1
          FROM current_members AS member
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.amora_memory_consents AS consent
            WHERE consent.couple_id = p_couple_id
              AND consent.visibility = p_visibility
              AND consent.user_id = member.user_id
          )
        )
    $$;

    REVOKE ALL ON FUNCTION
      public.has_current_amora_memory_consent(uuid, text)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION
      public.has_current_amora_memory_consent(uuid, text)
      TO service_role;

    GRANT USAGE ON SCHEMA public, auth
      TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid()
      TO PUBLIC;

    INSERT INTO public.couples(id, bride_id, groom_id)
    VALUES ('${COUPLE_ID}', '${BRIDE_ID}', '${GROOM_ID}');
    INSERT INTO public.profiles(id, couple_id, role) VALUES
      ('${BRIDE_ID}', '${COUPLE_ID}', 'bride'),
      ('${GROOM_ID}', '${COUPLE_ID}', 'groom'),
      ('${OUTSIDER_ID}', '${COUPLE_ID}', 'bride');
    INSERT INTO public.amora_memory_settings(
      couple_id,
      visibility,
      enabled,
      memory_reset_at
    ) VALUES
      (
        '${COUPLE_ID}',
        'shared',
        true,
        '2026-07-31T00:00:00.000Z'
      ),
      (
        '${COUPLE_ID}',
        'bride_private',
        true,
        '2026-07-31T00:01:00.000Z'
      ),
      (
        '${COUPLE_ID}',
        'groom_private',
        true,
        '2026-07-31T00:02:00.000Z'
      );
    INSERT INTO public.amora_memory_consents(
      couple_id,
      visibility,
      user_id
    ) VALUES
      ('${COUPLE_ID}', 'shared', '${BRIDE_ID}'),
      ('${COUPLE_ID}', 'shared', '${GROOM_ID}'),
      ('${COUPLE_ID}', 'bride_private', '${BRIDE_ID}'),
      ('${COUPLE_ID}', 'groom_private', '${GROOM_ID}');
    INSERT INTO public.amora_personalization_preferences(
      owner_user_id,
      revision
    ) VALUES ('${BRIDE_ID}', 2);
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId?: string,
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(
    "SELECT set_config('request.jwt.claim.sub', $1, false)",
    [userId ?? ""],
  );
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query(
    "SELECT set_config('request.jwt.claim.sub', '', false)",
  );
}

async function getSnapshot(
  db: PGlite,
  visibilities: readonly string[],
) {
  return db.query<SnapshotRow>(
    `SELECT public.get_own_amora_privacy_context_snapshot(
       $1,
       $2::text[]
     ) AS snapshot`,
    [COUPLE_ID, visibilities],
  );
}

describe("Amora privacy context snapshot migration", () => {
  it("ships an authenticated-only RPC with no service-role bypass", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated;/,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role;/,
    );
  });

  it("returns one actor-bound snapshot and detects database boundary changes", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", BRIDE_ID);
      const initial = await getSnapshot(
        db,
        ["shared", "bride_private"],
      );

      expect(initial.rows[0]?.snapshot).toMatchObject({
        version: 1,
        actorRole: "bride",
        rosterFingerprint: expect.stringMatching(/^[a-f0-9]{32}$/),
        memory: {
          shared: {
            enabled: true,
            resetAt: expect.any(String),
          },
          bride_private: {
            enabled: true,
            resetAt: expect.any(String),
          },
        },
        personalization: {
          exists: true,
          revision: 2,
        },
      });
      expect(
        new Date(
          initial.rows[0]?.snapshot.memory.shared.resetAt ?? "",
        ).toISOString(),
      ).toBe("2026-07-31T00:00:00.000Z");
      expect(
        new Date(
          initial.rows[0]?.snapshot.memory.bride_private.resetAt ?? "",
        ).toISOString(),
      ).toBe("2026-07-31T00:01:00.000Z");

      await expect(
        getSnapshot(db, ["groom_private"]),
      ).rejects.toThrow(/AMORA_PRIVACY_CONTEXT_SCOPE_INVALID/);
      await expect(
        getSnapshot(db, ["shared", "shared"]),
      ).rejects.toThrow(/AMORA_PRIVACY_CONTEXT_VISIBILITIES_INVALID/);

      await resetPersona(db);
      await db.exec(`
        UPDATE public.amora_memory_settings
        SET enabled = false,
            memory_reset_at = '2026-07-31T00:03:00.000Z'
        WHERE couple_id = '${COUPLE_ID}'
          AND visibility = 'shared';
        DELETE FROM public.amora_personalization_preferences
        WHERE owner_user_id = '${BRIDE_ID}';
      `);
      await setPersona(db, "authenticated", BRIDE_ID);
      const changed = await getSnapshot(db, ["shared"]);

      expect(changed.rows[0]?.snapshot).toMatchObject({
        memory: {
          shared: {
            enabled: false,
            resetAt: expect.any(String),
          },
        },
        personalization: {
          exists: false,
          revision: null,
        },
      });
      expect(
        new Date(
          changed.rows[0]?.snapshot.memory.shared.resetAt ?? "",
        ).toISOString(),
      ).toBe("2026-07-31T00:03:00.000Z");
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("rejects stale backlinks, anonymous callers, and service-role callers", async () => {
    const db = await createDatabase();
    try {
      await setPersona(db, "authenticated", OUTSIDER_ID);
      await expect(
        getSnapshot(db, ["shared"]),
      ).rejects.toThrow(/AMORA_PRIVACY_CONTEXT_SCOPE_INVALID/);

      await resetPersona(db);
      await setPersona(db, "anon");
      await expect(
        getSnapshot(db, ["shared"]),
      ).rejects.toThrow(/permission denied/i);

      await resetPersona(db);
      await setPersona(db, "service_role", BRIDE_ID);
      await expect(
        getSnapshot(db, ["shared"]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);
});
