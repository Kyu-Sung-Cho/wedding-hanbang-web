// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import {
  readFileSync,
  readdirSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731185000_community_api_only_write_boundary.sql",
  ),
  "utf8",
);

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const PUBLIC_POST_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_POST_ID = "44444444-4444-4444-8444-444444444444";

async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role()
    RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role()
      TO anon, authenticated, service_role;

    CREATE TABLE public.community_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id uuid NOT NULL,
      title text NOT NULL DEFAULT '',
      visibility text NOT NULL DEFAULT 'public',
      under_review boolean NOT NULL DEFAULT false
    );
    ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_posts
      TO anon, authenticated, service_role;

    CREATE POLICY "cp_select_public"
      ON public.community_posts FOR SELECT
      USING (visibility = 'public');
    CREATE POLICY "cp_select_members"
      ON public.community_posts FOR SELECT
      USING (
        visibility = 'members'
        AND auth.role() = 'authenticated'
      );
    CREATE POLICY "cp_select_drafts"
      ON public.community_posts FOR SELECT
      USING (
        visibility = 'draft'
        AND author_id = auth.uid()
      );
    CREATE POLICY "cp_insert"
      ON public.community_posts FOR INSERT
      WITH CHECK (author_id = auth.uid());
    CREATE POLICY "cp_update"
      ON public.community_posts FOR UPDATE
      USING (author_id = auth.uid());
    CREATE POLICY "cp_delete"
      ON public.community_posts FOR DELETE
      USING (author_id = auth.uid());

    INSERT INTO public.community_posts (
      id, author_id, title, visibility
    ) VALUES
      ('${PUBLIC_POST_ID}', '${OTHER_ID}', 'public post', 'public'),
      ('${DRAFT_POST_ID}', '${OWNER_ID}', 'own draft', 'draft');
  `);
  await db.exec(migration);
  return db;
}

async function setPersona(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId: string | null,
) {
  await db.query(
    "SELECT set_config('request.jwt.claim.sub', $1, false)",
    [userId ?? ""],
  );
  await db.query(
    "SELECT set_config('request.jwt.claim.role', $1, false)",
    [role],
  );
  await db.exec(`SET ROLE ${role};`);
}

async function resetPersona(db: PGlite) {
  await db.exec("RESET ROLE;");
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
}

describe("community API-only post write migration", () => {
  it("removes authenticated writes and write policies while preserving reads", async () => {
    const db = await createDatabase();
    try {
      const privileges = await db.query<{
        authenticated_select: boolean;
        authenticated_insert: boolean;
        authenticated_update: boolean;
        authenticated_delete: boolean;
        anon_select: boolean;
        anon_insert: boolean;
        service_insert: boolean;
        service_update: boolean;
        service_delete: boolean;
      }>(`
        SELECT
          has_table_privilege(
            'authenticated', 'public.community_posts', 'SELECT'
          ) AS authenticated_select,
          has_table_privilege(
            'authenticated', 'public.community_posts', 'INSERT'
          ) AS authenticated_insert,
          has_table_privilege(
            'authenticated', 'public.community_posts', 'UPDATE'
          ) AS authenticated_update,
          has_table_privilege(
            'authenticated', 'public.community_posts', 'DELETE'
          ) AS authenticated_delete,
          has_table_privilege(
            'anon', 'public.community_posts', 'SELECT'
          ) AS anon_select,
          has_table_privilege(
            'anon', 'public.community_posts', 'INSERT'
          ) AS anon_insert,
          has_table_privilege(
            'service_role', 'public.community_posts', 'INSERT'
          ) AS service_insert,
          has_table_privilege(
            'service_role', 'public.community_posts', 'UPDATE'
          ) AS service_update,
          has_table_privilege(
            'service_role', 'public.community_posts', 'DELETE'
          ) AS service_delete
      `);
      expect(privileges.rows).toEqual([{
        authenticated_select: true,
        authenticated_insert: false,
        authenticated_update: false,
        authenticated_delete: false,
        anon_select: true,
        anon_insert: false,
        service_insert: true,
        service_update: true,
        service_delete: true,
      }]);

      const policies = await db.query<{
        policyname: string;
        cmd: string;
      }>(`
        SELECT policyname, cmd
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'community_posts'
        ORDER BY policyname
      `);
      expect(policies.rows).toEqual([
        { policyname: "cp_select_drafts", cmd: "SELECT" },
        { policyname: "cp_select_members", cmd: "SELECT" },
        { policyname: "cp_select_public", cmd: "SELECT" },
      ]);

      await setPersona(db, "authenticated", OWNER_ID);
      const readable = await db.query<{ id: string }>(`
        SELECT id
        FROM public.community_posts
        ORDER BY id
      `);
      expect(readable.rows.map(({ id }) => id)).toEqual([
        PUBLIC_POST_ID,
        DRAFT_POST_ID,
      ]);
      await expect(db.exec(`
        INSERT INTO public.community_posts (author_id, title)
        VALUES ('${OWNER_ID}', 'direct insert')
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.exec(`
        UPDATE public.community_posts
        SET title = 'direct update'
        WHERE id = '${DRAFT_POST_ID}'
      `)).rejects.toThrow(/permission denied/iu);
      await expect(db.exec(`
        DELETE FROM public.community_posts
        WHERE id = '${DRAFT_POST_ID}'
      `)).rejects.toThrow(/permission denied/iu);

      await resetPersona(db);
      await setPersona(db, "service_role", null);
      await expect(db.exec(`
        UPDATE public.community_posts
        SET title = 'server update'
        WHERE id = '${DRAFT_POST_ID}';
        DELETE FROM public.community_posts
        WHERE id = '${PUBLIC_POST_ID}';
        INSERT INTO public.community_posts (author_id, title)
        VALUES ('${OWNER_ID}', 'server insert');
      `)).resolves.toBeDefined();
    } finally {
      await resetPersona(db).catch(() => undefined);
      await db.close();
    }
  });
});

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (
      [".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(extname(entry.name))
      && !entry.name.includes(".test.")
      && !entry.name.includes(".spec.")
    ) {
      files.push(path);
    }
  }
  return files;
}

describe("community post application write contract", () => {
  it("keeps browser and mobile code read-only and routes mutations through server clients", () => {
    const clientRoots = [
      resolve(process.cwd(), "../../apps/mobile"),
      resolve(process.cwd(), "src/components"),
      resolve(process.cwd(), "src/hooks"),
      resolve(process.cwd(), "src/stores"),
    ];
    const directClientWrite =
      /\.from\(["']community_posts["']\)[\s\S]{0,320}\.(?:insert|update|delete)\(/u;
    for (const root of clientRoots) {
      for (const file of sourceFiles(root)) {
        expect(
          readFileSync(file, "utf8"),
          `direct community_posts write in ${file}`,
        ).not.toMatch(directClientWrite);
      }
    }

    const collectionRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/community/posts/route.ts"),
      "utf8",
    );
    const itemRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/community/posts/[id]/route.ts"),
      "utf8",
    );
    expect(collectionRoute).toContain("const serviceClient = getServiceClient();");
    expect(collectionRoute).toMatch(
      /serviceClient[\s\S]{0,8000}\.from\("community_posts"\)[\s\S]{0,120}\.insert\(/u,
    );
    expect(itemRoute).toContain("const writeClient = getServiceClient();");
    expect(itemRoute).not.toContain(
      "const writeClient = userIsAdmin ? getServiceClient() : supabase",
    );
    expect(itemRoute).toMatch(
      /serviceClient[\s\S]{0,1200}\.from\("community_posts"\)[\s\S]{0,120}\.delete\(/u,
    );
  });
});
