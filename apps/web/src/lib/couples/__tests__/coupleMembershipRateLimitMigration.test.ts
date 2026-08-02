// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260803109000_rate_limit_direct_couple_membership_rpcs.sql",
  ),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";

describe("direct couple membership RPC rate migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    try {
      await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto SCHEMA extensions;

      CREATE FUNCTION auth.uid()
      RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION auth.role()
      RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

      CREATE TABLE public.rate_limit_buckets (
        key text PRIMARY KEY,
        count integer NOT NULL,
        reset_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE public.membership_call_audit (
        action text NOT NULL,
        user_id uuid
      );

      CREATE FUNCTION public.check_rate_limit_cost(
        p_key text,
        p_max_requests integer,
        p_window_ms integer,
        p_cost integer
      )
      RETURNS TABLE(allowed boolean, retry_after_seconds integer)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
      AS $$
      DECLARE v_count integer;
      BEGIN
        INSERT INTO public.rate_limit_buckets(key, count, reset_at, updated_at)
        VALUES (
          p_key,
          p_cost,
          clock_timestamp() + make_interval(secs => greatest(1, p_window_ms / 1000)),
          clock_timestamp()
        )
        ON CONFLICT (key) DO UPDATE
          SET count = public.rate_limit_buckets.count + EXCLUDED.count,
              updated_at = EXCLUDED.updated_at
        RETURNING count INTO v_count;
        RETURN QUERY SELECT v_count <= p_max_requests, 0;
      END
      $$;

      CREATE FUNCTION public.create_couple_for_current_user(text)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
      SET lock_timeout = '5s'
      SET statement_timeout = '30s'
      AS $$
      BEGIN
        INSERT INTO public.membership_call_audit VALUES ('create', auth.uid());
        RETURN jsonb_build_object('success', true, 'created', true, 'actor', auth.uid());
      END
      $$;
      CREATE FUNCTION public.join_couple(text, text)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
      SET lock_timeout = '5s'
      SET statement_timeout = '30s'
      AS $$
      BEGIN
        INSERT INTO public.membership_call_audit VALUES ('join', auth.uid());
        RETURN jsonb_build_object('success', true, 'joined', true, 'actor', auth.uid());
      END
      $$;
      CREATE FUNCTION public.reset_current_couple_membership()
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public
      SET lock_timeout = '5s'
      SET statement_timeout = '15s'
      AS $$
      BEGIN
        INSERT INTO public.membership_call_audit VALUES ('reset', auth.uid());
        RETURN jsonb_build_object('success', true, 'actor', auth.uid());
      END
      $$;

      REVOKE ALL ON FUNCTION public.check_rate_limit_cost(text, integer, integer, integer)
        FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.check_rate_limit_cost(text, integer, integer, integer)
        TO service_role;
      REVOKE ALL ON FUNCTION public.create_couple_for_current_user(text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.join_couple(text, text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.reset_current_couple_membership() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.create_couple_for_current_user(text) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.join_couple(text, text) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.reset_current_couple_membership() TO authenticated;
      `);
    } catch (error) {
      throw new Error("couple membership fixture setup failed", { cause: error });
    }
    try {
      await db.exec(migration);
    } catch (error) {
      throw new Error("couple membership migration apply failed", { cause: error });
    }
  });

  afterEach(async () => {
    await db.close();
  });

  async function authenticate(userId: string) {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");
  }

  it("blocks invite-code lookup after ten attempts while isolating accounts", async () => {
    await authenticate(USER_ID);
    for (let index = 0; index < 10; index += 1) {
      const result = await db.query<{ result: { success: boolean } }>(
        "SELECT public.join_couple('WH-ABC123', 'bride') AS result",
      );
      expect(result.rows[0].result.success).toBe(true);
    }

    const blocked = await db.query<{
      result: { success: boolean; error_code: string };
    }>("SELECT public.join_couple('WH-ABC123', 'bride') AS result");
    expect(blocked.rows[0].result).toMatchObject({
      success: false,
      error_code: "RATE_LIMITED",
    });

    await authenticate(OTHER_USER_ID);
    const isolated = await db.query<{ result: { success: boolean; actor: string } }>(
      "SELECT public.join_couple('WH-ABC123', 'bride') AS result",
    );
    expect(isolated.rows[0].result).toMatchObject({
      success: true,
      actor: OTHER_USER_ID,
    });
  });

  it("fails closed on the sixth reset and does not invoke the private mutation", async () => {
    await authenticate(USER_ID);
    for (let index = 0; index < 5; index += 1) {
      await expect(
        db.query("SELECT public.reset_current_couple_membership()"),
      ).resolves.toBeDefined();
    }

    await expect(
      db.query("SELECT public.reset_current_couple_membership()"),
    ).rejects.toThrow(/couple_membership_rate_limit_exceeded/u);

    const calls = await db.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM public.membership_call_audit
      WHERE action = 'reset'
    `);
    expect(calls.rows).toEqual([{ count: 5 }]);
  });

  it("keeps limiter and mutation implementations private", async () => {
    const privileges = await db.query<Record<string, boolean>>(`
      SELECT
        has_function_privilege('authenticated', 'public.join_couple(text,text)', 'EXECUTE') AS wrapper_authenticated,
        has_function_privilege('service_role', 'public.join_couple(text,text)', 'EXECUTE') AS wrapper_service,
        has_function_privilege('authenticated', 'public.join_couple_internal_20260803(text,text)', 'EXECUTE') AS internal_authenticated,
        has_function_privilege('service_role', 'public.join_couple_internal_20260803(text,text)', 'EXECUTE') AS internal_service,
        has_function_privilege('authenticated', 'public.consume_direct_couple_membership_rate_limit(text,uuid,integer,integer)', 'EXECUTE') AS limiter_authenticated,
        has_function_privilege('service_role', 'public.consume_direct_couple_membership_rate_limit(text,uuid,integer,integer)', 'EXECUTE') AS limiter_service
    `);
    expect(privileges.rows).toEqual([{
      wrapper_authenticated: true,
      wrapper_service: false,
      internal_authenticated: false,
      internal_service: false,
      limiter_authenticated: false,
      limiter_service: false,
    }]);
  });
});
