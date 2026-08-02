// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802134000_close_dormant_guestbook_public_surface.sql",
  ),
  "utf8",
);

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const GUESTBOOK_ID = "10000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "20000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      public boolean NOT NULL DEFAULT false
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY,
      bucket_id text NOT NULL REFERENCES storage.buckets(id),
      name text NOT NULL
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE TABLE public.guestbooks (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.guestbook_messages (
      id uuid PRIMARY KEY,
      guestbook_id uuid NOT NULL REFERENCES public.guestbooks(id) ON DELETE CASCADE,
      guest_name text NOT NULL,
      message text NOT NULL,
      is_approved boolean NOT NULL DEFAULT true,
      ip_hash text
    );
    CREATE TABLE public.guestbook_message_reactions (
      id uuid PRIMARY KEY,
      message_id uuid NOT NULL REFERENCES public.guestbook_messages(id) ON DELETE CASCADE,
      ip_hash text NOT NULL
    );
    CREATE TABLE public.guestbook_photos (
      id uuid PRIMARY KEY,
      guestbook_id uuid NOT NULL REFERENCES public.guestbooks(id) ON DELETE CASCADE,
      url text NOT NULL
    );

    ALTER TABLE public.guestbooks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.guestbook_messages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.guestbook_message_reactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.guestbook_photos ENABLE ROW LEVEL SECURITY;

    CREATE POLICY guestbooks_select_active ON public.guestbooks
      FOR SELECT USING (is_active = true);
    CREATE POLICY guestbooks_insert ON public.guestbooks
      FOR INSERT WITH CHECK (owner_id = auth.uid());
    CREATE POLICY guestbooks_update ON public.guestbooks
      FOR UPDATE USING (owner_id = auth.uid());
    CREATE POLICY guestbooks_delete ON public.guestbooks
      FOR DELETE USING (owner_id = auth.uid());
    CREATE POLICY gb_messages_select ON public.guestbook_messages
      FOR SELECT USING (is_approved = true);
    CREATE POLICY gb_messages_insert_anon ON public.guestbook_messages
      FOR INSERT WITH CHECK (true);
    CREATE POLICY gb_messages_owner_update ON public.guestbook_messages
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM public.guestbooks AS guestbook
          WHERE guestbook.id = guestbook_id AND guestbook.owner_id = auth.uid()
        )
      );
    CREATE POLICY gb_messages_owner_delete ON public.guestbook_messages
      FOR DELETE USING (
        EXISTS (
          SELECT 1 FROM public.guestbooks AS guestbook
          WHERE guestbook.id = guestbook_id AND guestbook.owner_id = auth.uid()
        )
      );
    CREATE POLICY gb_reactions_select ON public.guestbook_message_reactions
      FOR SELECT USING (true);
    CREATE POLICY gb_photos_select ON public.guestbook_photos
      FOR SELECT USING (true);
    CREATE POLICY gb_photos_insert_owner ON public.guestbook_photos
      FOR INSERT WITH CHECK (true);
    CREATE POLICY gb_photos_update_owner ON public.guestbook_photos
      FOR UPDATE USING (true);
    CREATE POLICY gb_photos_delete_owner ON public.guestbook_photos
      FOR DELETE USING (true);

    GRANT USAGE ON SCHEMA public, auth, storage
      TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.guestbooks,
      public.guestbook_messages,
      public.guestbook_message_reactions,
      public.guestbook_photos
    TO anon, authenticated, service_role;
    GRANT SELECT ON TABLE storage.buckets, storage.objects
      TO anon, authenticated, service_role;

    INSERT INTO storage.buckets (id, public) VALUES
      ('guestbook-images', true),
      ('guestbook-uploads', true);
    INSERT INTO public.guestbooks (id, owner_id)
    VALUES ('${GUESTBOOK_ID}', '${OWNER_ID}');
    INSERT INTO public.guestbook_messages (
      id, guestbook_id, guest_name, message, ip_hash
    ) VALUES (
      '${MESSAGE_ID}', '${GUESTBOOK_ID}', 'guest', 'private message', 'message-ip-hash'
    );
    INSERT INTO public.guestbook_message_reactions (id, message_id, ip_hash)
    VALUES (
      '30000000-0000-4000-8000-000000000001', '${MESSAGE_ID}', 'reaction-ip-hash'
    );
    INSERT INTO public.guestbook_photos (id, guestbook_id, url)
    VALUES (
      '40000000-0000-4000-8000-000000000001', '${GUESTBOOK_ID}', 'legacy/photo.jpg'
    );
  `);
  return db;
}

async function setActor(db: PGlite, role: "anon" | "authenticated", userId = "") {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function resetActor(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
}

describe("dormant guestbook privacy fence migration", () => {
  it("removes anonymous reads, cross-account reads, and client mutations", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await expect(db.exec(migration)).resolves.toBeDefined();

      await setActor(db, "anon");
      await expect(
        db.query("SELECT id FROM public.guestbooks"),
      ).rejects.toThrow(/permission denied/i);

      await resetActor(db);
      await setActor(db, "authenticated", OTHER_ID);
      const hidden = await db.query(`
        SELECT
          (SELECT count(*)::integer FROM public.guestbooks) AS guestbooks,
          (SELECT count(*)::integer FROM public.guestbook_messages) AS messages,
          (SELECT count(*)::integer FROM public.guestbook_message_reactions) AS reactions,
          (SELECT count(*)::integer FROM public.guestbook_photos) AS photos
      `);
      expect(hidden.rows[0]).toEqual({
        guestbooks: 0,
        messages: 0,
        reactions: 0,
        photos: 0,
      });
      await expect(db.exec(`
        INSERT INTO public.guestbooks (id, owner_id)
        VALUES ('50000000-0000-4000-8000-000000000001', '${OTHER_ID}')
      `)).rejects.toThrow(/permission denied/i);
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("keeps owner export access while hiding raw identifiers from everyone else", async () => {
    const db = await createDatabase();
    try {
      await db.exec(migration);
      await setActor(db, "authenticated", OWNER_ID);
      const ownerView = await db.query<{
        message_hash: string;
        reaction_hash: string;
        photo_url: string;
      }>(`
        SELECT
          (SELECT ip_hash FROM public.guestbook_messages LIMIT 1) AS message_hash,
          (SELECT ip_hash FROM public.guestbook_message_reactions LIMIT 1) AS reaction_hash,
          (SELECT url FROM public.guestbook_photos LIMIT 1) AS photo_url
      `);
      expect(ownerView.rows[0]).toEqual({
        message_hash: "message-ip-hash",
        reaction_hash: "reaction-ip-hash",
        photo_url: "legacy/photo.jpg",
      });

      await resetActor(db);
      const bucketState = await db.query<{ id: string; public: boolean }>(`
        SELECT id, public
        FROM storage.buckets
        ORDER BY id
      `);
      expect(bucketState.rows).toEqual([
        { id: "guestbook-images", public: false },
        { id: "guestbook-uploads", public: false },
      ]);
    } finally {
      await resetActor(db).catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("is fail-closed, transactional, and does not rewrite guestbook records", () => {
    expect(migration).toMatch(/^--[\s\S]*\r?\nBEGIN;\r?\n/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("GUESTBOOK_PRIVACY_FENCE_BUCKET_SET_DRIFT");
    expect(migration).toContain(
      "GUESTBOOK_PRIVACY_FENCE_STORAGE_SELECT_POLICY_REQUIRES_REVIEW",
    );
    expect(migration).not.toMatch(
      /\b(?:INSERT INTO|DELETE FROM)\s+public\.(?:guestbooks|guestbook_messages|guestbook_message_reactions|guestbook_photos)\b/i,
    );
  });
});
