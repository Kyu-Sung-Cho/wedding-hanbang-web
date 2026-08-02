// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803108000_make_community_vote_rpcs_server_only.sql",
  ),
  "utf8",
);

describe("community vote server boundary migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;

      CREATE FUNCTION public.community_vote_post(uuid, uuid, smallint)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
      AS $$ BEGIN NULL; END $$;
      CREATE FUNCTION public.community_vote_comment(uuid, uuid, smallint)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
      AS $$ BEGIN NULL; END $$;
      CREATE FUNCTION public.community_record_login(uuid)
      RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public
      AS $$ SELECT '{}'::json $$;

      REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.community_record_login(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.community_vote_post(uuid, uuid, smallint)
        TO authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.community_vote_comment(uuid, uuid, smallint)
        TO authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.community_record_login(uuid)
        TO authenticated, service_role;
    `);
    await db.exec(migration);
  });

  afterEach(async () => {
    await db.close();
  });

  it("allows only service-owned vote mutations", async () => {
    const privileges = await db.query<{
      post_anon: boolean;
      post_authenticated: boolean;
      post_service: boolean;
      comment_anon: boolean;
      comment_authenticated: boolean;
      comment_service: boolean;
    }>(`
      SELECT
        has_function_privilege('anon', 'public.community_vote_post(uuid,uuid,smallint)', 'EXECUTE') AS post_anon,
        has_function_privilege('authenticated', 'public.community_vote_post(uuid,uuid,smallint)', 'EXECUTE') AS post_authenticated,
        has_function_privilege('service_role', 'public.community_vote_post(uuid,uuid,smallint)', 'EXECUTE') AS post_service,
        has_function_privilege('anon', 'public.community_vote_comment(uuid,uuid,smallint)', 'EXECUTE') AS comment_anon,
        has_function_privilege('authenticated', 'public.community_vote_comment(uuid,uuid,smallint)', 'EXECUTE') AS comment_authenticated,
        has_function_privilege('service_role', 'public.community_vote_comment(uuid,uuid,smallint)', 'EXECUTE') AS comment_service
    `);
    expect(privileges.rows).toEqual([{
      post_anon: false,
      post_authenticated: false,
      post_service: true,
      comment_anon: false,
      comment_authenticated: false,
      comment_service: true,
    }]);
  });

  it("disables the unused login gamification RPC for every API role", async () => {
    const privileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`
      SELECT
        has_function_privilege('anon', 'public.community_record_login(uuid)', 'EXECUTE') AS anon,
        has_function_privilege('authenticated', 'public.community_record_login(uuid)', 'EXECUTE') AS authenticated,
        has_function_privilege('service_role', 'public.community_record_login(uuid)', 'EXECUTE') AS service
    `);
    expect(privileges.rows).toEqual([{
      anon: false,
      authenticated: false,
      service: false,
    }]);
  });
});
