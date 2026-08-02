// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803110000_harden_vendor_photo_like_boundary.sql",
  ),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const VENDOR_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_VENDOR_ID = "10000000-0000-4000-8000-000000000002";
const PUBLISHED_PHOTO = "https://cdn.example.test/vendor/photo.webp";
const PRODUCT_PHOTO = "https://cdn.example.test/vendor/product.webp";
const LEGACY_TRACKER = "https://tracker.example.test/pixel";

describe("vendor photo-like server boundary migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;

      CREATE FUNCTION auth.role()
      RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE TABLE public.vendors (
        id uuid PRIMARY KEY,
        status text NOT NULL,
        thumbnail_url text
      );
      CREATE TABLE public.vendor_images (
        id uuid PRIMARY KEY,
        vendor_id uuid NOT NULL,
        image_url text NOT NULL
      );
      CREATE TABLE public.vendor_products (
        id uuid PRIMARY KEY,
        vendor_id uuid NOT NULL,
        is_active boolean,
        images text[]
      );
      CREATE TABLE public.vendor_photo_likes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        user_id uuid,
        vendor_id uuid,
        photo_url text,
        CONSTRAINT vendor_photo_likes_user_vendor_photo_unique
          UNIQUE (user_id, vendor_id, photo_url)
      );

      ALTER TABLE public.vendor_photo_likes ENABLE ROW LEVEL SECURITY;
      CREATE POLICY vendor_photo_likes_owner_all
        ON public.vendor_photo_likes FOR ALL
        USING (true) WITH CHECK (true);
      GRANT ALL ON public.vendor_photo_likes TO authenticated;

      INSERT INTO auth.users VALUES ('${USER_ID}');
      INSERT INTO public.vendors VALUES
        ('${VENDOR_ID}', 'approved', '${PUBLISHED_PHOTO}'),
        ('${OTHER_VENDOR_ID}', 'pending', '${LEGACY_TRACKER}');
      INSERT INTO public.vendor_images VALUES
        ('20000000-0000-4000-8000-000000000001', '${VENDOR_ID}', '${PUBLISHED_PHOTO}');
      INSERT INTO public.vendor_products VALUES
        ('30000000-0000-4000-8000-000000000001', '${VENDOR_ID}', true, ARRAY['${PRODUCT_PHOTO}']);
      INSERT INTO public.vendor_photo_likes (id, user_id, vendor_id, photo_url)
      VALUES (
        '40000000-0000-4000-8000-000000000001',
        '${USER_ID}',
        '${VENDOR_ID}',
        '${LEGACY_TRACKER}'
      );
    `);
    await db.exec(migration);
    await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
  });

  afterEach(async () => {
    await db.close();
  });

  it("toggles only photos in the approved public catalog", async () => {
    const inserted = await db.query<{ result: { success: boolean; liked: boolean } }>(
      `SELECT public.toggle_vendor_photo_like_service_v1($1, $2, $3) AS result`,
      [USER_ID, VENDOR_ID, PRODUCT_PHOTO],
    );
    expect(inserted.rows[0].result).toEqual({ success: true, liked: true });

    const removed = await db.query<{ result: { success: boolean; liked: boolean } }>(
      `SELECT public.toggle_vendor_photo_like_service_v1($1, $2, $3) AS result`,
      [USER_ID, VENDOR_ID, PRODUCT_PHOTO],
    );
    expect(removed.rows[0].result).toEqual({ success: true, liked: false });

    const rejected = await db.query<{
      result: { success: boolean; error_code: string };
    }>(`SELECT public.toggle_vendor_photo_like_service_v1($1, $2, $3) AS result`, [
      USER_ID,
      VENDOR_ID,
      "https://attacker.example/pixel",
    ]);
    expect(rejected.rows[0].result).toEqual({
      success: false,
      error_code: "PHOTO_NOT_PUBLISHED",
    });
  });

  it("keeps a legacy arbitrary row inert and omits it from the service projection", async () => {
    const listed = await db.query<{
      result: { success: boolean; liked_photos: string[] };
    }>(`SELECT public.list_vendor_photo_likes_service_v1($1, $2) AS result`, [
      USER_ID,
      VENDOR_ID,
    ]);
    expect(listed.rows[0].result).toEqual({ success: true, liked_photos: [] });

    const retained = await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM public.vendor_photo_likes
      WHERE photo_url = '${LEGACY_TRACKER}'
    `);
    expect(retained.rows).toEqual([{ count: 1 }]);
  });

  it("revokes direct client access and exposes only service RPCs", async () => {
    const privileges = await db.query<Record<string, boolean>>(`
      SELECT
        has_table_privilege('authenticated', 'public.vendor_photo_likes', 'SELECT') AS client_select,
        has_table_privilege('authenticated', 'public.vendor_photo_likes', 'INSERT') AS client_insert,
        has_function_privilege('authenticated', 'public.toggle_vendor_photo_like_service_v1(uuid,uuid,text)', 'EXECUTE') AS client_toggle,
        has_function_privilege('service_role', 'public.toggle_vendor_photo_like_service_v1(uuid,uuid,text)', 'EXECUTE') AS service_toggle,
        has_function_privilege('authenticated', 'public.vendor_photo_is_published_v1(uuid,text)', 'EXECUTE') AS client_validator,
        has_function_privilege('service_role', 'public.vendor_photo_is_published_v1(uuid,text)', 'EXECUTE') AS service_validator
    `);
    expect(privileges.rows).toEqual([{
      client_select: false,
      client_insert: false,
      client_toggle: false,
      service_toggle: true,
      client_validator: false,
      service_validator: false,
    }]);
  });
});
