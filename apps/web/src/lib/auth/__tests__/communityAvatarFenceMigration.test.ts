// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260802122000_lock_community_avatar_values.sql",
  ),
  "utf8",
);

describe("community avatar write fence migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE TABLE public.community_profiles (
        user_id uuid PRIMARY KEY,
        nickname text NOT NULL,
        avatar_url text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO public.community_profiles (user_id, nickname, avatar_url)
      VALUES
        ('00000000-0000-4000-8000-000000000001', 'safe', '🌿'),
        ('00000000-0000-4000-8000-000000000002', 'relative', '/api/messages?vendorId=x'),
        ('00000000-0000-4000-8000-000000000003', 'tracker', 'https://attacker.supabase.co/pixel.gif');
    `);
    await db.exec(migration);
  });

  afterEach(async () => {
    await db.close();
  });

  it("removes legacy URL avatars while preserving allowed emoji", async () => {
    const result = await db.query<{ nickname: string; avatar_url: string | null }>(
      "SELECT nickname, avatar_url FROM public.community_profiles ORDER BY nickname",
    );

    expect(result.rows).toEqual([
      { nickname: "relative", avatar_url: null },
      { nickname: "safe", avatar_url: "🌿" },
      { nickname: "tracker", avatar_url: null },
    ]);
  });

  it("rejects future URL avatars at the database boundary", async () => {
    await expect(
      db.exec(`
        UPDATE public.community_profiles
        SET avatar_url = '/api/vendors/00000000-0000-4000-8000-000000000001'
        WHERE nickname = 'safe';
      `),
    ).rejects.toThrow(/community_profiles_avatar_allowlist/);
  });
});
