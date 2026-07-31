import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { DELETE, GET, PUT } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora-personalization:test"),
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONFIRMED_AT = "2026-07-31T01:00:00.000Z";
const UPDATED_AT = "2026-07-31T01:00:00.000Z";
const PREFERENCES = {
  decisionStart: "recommend_first",
  answerDetail: "brief",
  supportOrder: "listen_first",
  workMode: "together",
  familyOrder: "couple_first",
  toneStyle: "warm",
} as const;
const LEGACY_PREFERENCES = {
  decisionStart: PREFERENCES.decisionStart,
  answerDetail: PREFERENCES.answerDetail,
  supportOrder: PREFERENCES.supportOrder,
  workMode: PREFERENCES.workMode,
  familyOrder: PREFERENCES.familyOrder,
} as const;
const STORED_ROW = {
  decision_start: PREFERENCES.decisionStart,
  answer_detail: PREFERENCES.answerDetail,
  support_order: PREFERENCES.supportOrder,
  work_mode: PREFERENCES.workMode,
  family_order: PREFERENCES.familyOrder,
  tone_style: PREFERENCES.toneStyle,
  confirmed_at: CONFIRMED_AT,
  revision: 3,
  updated_at: UPDATED_AT,
};

function makeClient(options?: {
  userId?: string | null;
  row?: typeof STORED_ROW | null;
  readError?: { code: string } | null;
  rpcResult?: {
    data: unknown;
    error: {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
    } | null;
  };
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options?.row ?? null,
    error: options?.readError ?? null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue(
    options?.rpcResult ?? { data: [STORED_ROW], error: null },
  );
  const getUser = vi.fn().mockResolvedValue({
    data: {
      user:
        options?.userId === null
          ? null
          : { id: options?.userId ?? USER_ID },
    },
  });

  return {
    client: { auth: { getUser }, from, rpc },
    from,
    rpc,
  };
}

function jsonRequest(
  method: "PUT" | "DELETE",
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  return new Request("http://localhost/api/amora/personalization", {
    method,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("/api/amora/personalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue(null);
    vi.mocked(isTrustedMutationRequest).mockReturnValue(true);
  });

  it("returns a private 401 without querying or mutating data", async () => {
    const { client, from, rpc } = makeClient({ userId: null });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const result = await GET(
      new Request("http://localhost/api/amora/personalization"),
    );

    expect(result.status).toBe(401);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown or partial PUT state before the RPC", async () => {
    const { client, rpc } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const unknown = await PUT(
      jsonRequest("PUT", {
        expectedRevision: null,
        preferences: PREFERENCES,
        source: "settings",
      }),
    );
    const partial = await PUT(
      jsonRequest("PUT", {
        expectedRevision: null,
        preferences: { decisionStart: "recommend_first" },
      }),
    );
    const legacyWithUnknownKey = await PUT(
      jsonRequest("PUT", {
        expectedRevision: null,
        preferences: {
          ...LEGACY_PREFERENCES,
          inferredPersona: "decisive",
        },
      }),
    );

    expect(unknown.status).toBe(400);
    expect(partial.status).toBe(400);
    expect(legacyWithUnknownKey.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the request-scoped full-state RPC and returns only the profile contract", async () => {
    const { client, rpc } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const result = await PUT(
      jsonRequest("PUT", {
        expectedRevision: 2,
        preferences: PREFERENCES,
      }),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledWith(
      "set_own_amora_personalization_preferences_v2",
      {
        p_expected_revision: 2,
        p_decision_start: "recommend_first",
        p_answer_detail: "brief",
        p_support_order: "listen_first",
        p_work_mode: "together",
        p_family_order: "couple_first",
        p_tone_style: "warm",
      },
    );
    expect(await result.json()).toEqual({
      profile: {
        preferences: PREFERENCES,
        revision: 3,
        confirmedAt: CONFIRMED_AT,
        updatedAt: UPDATED_AT,
      },
    });
  });

  it("keeps an exact legacy five-field PUT compatible without overwriting tone", async () => {
    const legacyRpcRow = {
      decision_start: LEGACY_PREFERENCES.decisionStart,
      answer_detail: LEGACY_PREFERENCES.answerDetail,
      support_order: LEGACY_PREFERENCES.supportOrder,
      work_mode: LEGACY_PREFERENCES.workMode,
      family_order: LEGACY_PREFERENCES.familyOrder,
      confirmed_at: CONFIRMED_AT,
      revision: 3,
      updated_at: UPDATED_AT,
    };
    const { client, rpc, from } = makeClient({
      row: STORED_ROW,
      rpcResult: { data: [legacyRpcRow], error: null },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const result = await PUT(
      jsonRequest("PUT", {
        expectedRevision: 2,
        preferences: LEGACY_PREFERENCES,
      }),
    );

    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "set_own_amora_personalization_preferences",
      {
        p_expected_revision: 2,
        p_decision_start: "recommend_first",
        p_answer_detail: "brief",
        p_support_order: "listen_first",
        p_work_mode: "together",
        p_family_order: "couple_first",
      },
    );
    expect(from).toHaveBeenCalledWith("amora_personalization_preferences");
    expect(await result.json()).toEqual({
      profile: {
        preferences: PREFERENCES,
        revision: 3,
        confirmedAt: CONFIRMED_AT,
        updatedAt: UPDATED_AT,
      },
    });
  });

  it("maps a stale RPC write to 409 and re-reads the caller's RLS row", async () => {
    const { client, from } = makeClient({
      row: STORED_ROW,
      rpcResult: {
        data: null,
        error: {
          code: "40001",
          message: "AMORA_PERSONALIZATION_REVISION_CONFLICT",
        },
      },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const result = await PUT(
      jsonRequest("PUT", {
        expectedRevision: 2,
        preferences: {
          ...PREFERENCES,
          answerDetail: "detailed",
        },
      }),
    );

    expect(result.status).toBe(409);
    expect(from).toHaveBeenCalledWith("amora_personalization_preferences");
    expect(await result.json()).toMatchObject({
      code: "PERSONALIZATION_REVISION_CONFLICT",
      current: { revision: 3, preferences: PREFERENCES },
    });
  });

  it("keeps the legacy five-field path on the same CAS conflict contract", async () => {
    const { client, rpc } = makeClient({
      row: STORED_ROW,
      rpcResult: {
        data: null,
        error: {
          code: "40001",
          message: "AMORA_PERSONALIZATION_REVISION_CONFLICT",
        },
      },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);

    const result = await PUT(
      jsonRequest("PUT", {
        expectedRevision: 2,
        preferences: LEGACY_PREFERENCES,
      }),
    );

    expect(result.status).toBe(409);
    expect(rpc).toHaveBeenCalledWith(
      "set_own_amora_personalization_preferences",
      expect.objectContaining({ p_expected_revision: 2 }),
    );
    expect(await result.json()).toMatchObject({
      code: "PERSONALIZATION_REVISION_CONFLICT",
      current: { revision: 3, preferences: PREFERENCES },
    });
  });

  it("rejects untrusted and oversized mutations before an RPC", async () => {
    const { client, rpc } = makeClient();
    vi.mocked(createClientFromRequest).mockResolvedValue(client as never);
    vi.mocked(isTrustedMutationRequest).mockReturnValueOnce(false);

    const untrusted = await PUT(
      jsonRequest("PUT", {
        expectedRevision: null,
        preferences: PREFERENCES,
      }),
    );
    const oversized = await PUT(
      jsonRequest(
        "PUT",
        {
          expectedRevision: null,
          preferences: PREFERENCES,
        },
        { "content-length": "4097" },
      ),
    );

    expect(untrusted.status).toBe(403);
    expect(oversized.status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats an already-absent clear as success and maps stale clear to 409", async () => {
    const absent = makeClient({
      rpcResult: { data: true, error: null },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(absent.client as never);

    const cleared = await DELETE(
      jsonRequest("DELETE", { expectedRevision: null }),
    );
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ deleted: true, profile: null });

    const stale = makeClient({
      row: STORED_ROW,
      rpcResult: {
        data: null,
        error: {
          code: "40001",
          message: "AMORA_PERSONALIZATION_REVISION_CONFLICT",
        },
      },
    });
    vi.mocked(createClientFromRequest).mockResolvedValue(stale.client as never);
    const conflict = await DELETE(
      jsonRequest("DELETE", { expectedRevision: 2 }),
    );
    expect(conflict.status).toBe(409);
  });
});

describe("amora personalization migration boundary", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "../../supabase/migrations/20260731170000_amora_personalization_preferences.sql",
    ),
    "utf8",
  );
  const routeSource = readFileSync(
    resolve(process.cwd(), "src/app/api/amora/personalization/route.ts"),
    "utf8",
  );

  it("keeps one profiles-owned row without couple, source, version, or client replay columns", () => {
    expect(migration).toContain(
      "owner_user_id uuid PRIMARY KEY\n    REFERENCES public.profiles(id) ON DELETE CASCADE",
    );
    expect(migration).not.toMatch(/\bcouple_id\b/);
    expect(migration).not.toMatch(/\bsource\b/);
    expect(migration).not.toMatch(/\bexact_version\b/);
    expect(migration).not.toMatch(/\blast_idempotency_key\b/);
  });

  it("serializes full-state RPC writes and preserves revision on identical retries", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
    expect(migration).toContain("SET LOCAL statement_timeout = '30s';");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toMatch(/SELECT preference\.\*[\s\S]*FOR UPDATE;/);
    expect(migration).toMatch(
      /IS NOT DISTINCT FROM ROW\([\s\S]*RETURN QUERY[\s\S]*AMORA_PERSONALIZATION_REVISION_CONFLICT/,
    );
  });

  it("allows only own SELECT and authenticated RPC execution, with no admin API client", () => {
    expect(migration).toContain(
      "USING (owner_user_id = (SELECT auth.uid()))",
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.amora_personalization_preferences[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT SELECT ON TABLE public\.amora_personalization_preferences[\s\S]*TO authenticated;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated;/);
    expect(routeSource).not.toContain("createAdminClient");
    expect(routeSource).not.toContain("idempotency-key");
  });

  it("enforces CAS, state-idempotent retries, RLS, and RPC-only writes in PostgreSQL", async () => {
    const db = await PGlite.create();
    try {
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
          SELECT NULLIF(
            current_setting('request.jwt.claim.sub', true),
            ''
          )::uuid
        $$;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
        GRANT EXECUTE ON FUNCTION auth.uid()
          TO anon, authenticated, service_role;
        CREATE TABLE public.profiles (id uuid PRIMARY KEY);
        INSERT INTO public.profiles (id)
        VALUES
          ('11111111-1111-4111-8111-111111111111'),
          ('22222222-2222-4222-8222-222222222222');
      `);
      await db.exec(migration);
      await db.exec(`
        SET request.jwt.claim.sub =
          '11111111-1111-4111-8111-111111111111';
        SET ROLE authenticated;
      `);

      const first = await db.query<{
        revision: number;
        confirmed_at: string;
      }>(`
        SELECT revision, confirmed_at
        FROM public.set_own_amora_personalization_preferences(
          NULL,
          'recommend_first',
          'brief',
          'listen_first',
          'together',
          'couple_first'
        )
      `);
      const replay = await db.query<{
        revision: number;
        confirmed_at: string;
      }>(`
        SELECT revision, confirmed_at
        FROM public.set_own_amora_personalization_preferences(
          NULL,
          'recommend_first',
          'brief',
          'listen_first',
          'together',
          'couple_first'
        )
      `);

      expect(first.rows).toHaveLength(1);
      expect(replay.rows).toEqual(first.rows);
      await expect(
        db.query(`
          SELECT *
          FROM public.set_own_amora_personalization_preferences(
            NULL,
            'compare_first',
            'brief',
            'listen_first',
            'together',
            'couple_first'
          )
        `),
      ).rejects.toThrow("AMORA_PERSONALIZATION_REVISION_CONFLICT");
      await expect(
        db.exec(`
          UPDATE public.amora_personalization_preferences
          SET answer_detail = 'detailed'
        `),
      ).rejects.toThrow();

      // User 1's live row is invisible to user 2. User 2 can create and read
      // only their own row, while user 1 still cannot see it after switching back.
      await db.exec(`
        RESET ROLE;
        SET request.jwt.claim.sub =
          '22222222-2222-4222-8222-222222222222';
        SET ROLE authenticated;
      `);
      const userTwoBeforeOwnWrite = await db.query(`
        SELECT owner_user_id
        FROM public.amora_personalization_preferences
      `);
      expect(userTwoBeforeOwnWrite.rows).toEqual([]);
      await db.query(`
        SELECT *
        FROM public.set_own_amora_personalization_preferences(
          NULL,
          'compare_first',
          'detailed',
          'action_first',
          'hybrid',
          'case_by_case'
        )
      `);
      const userTwoOwnRead = await db.query<{ owner_user_id: string }>(`
        SELECT owner_user_id
        FROM public.amora_personalization_preferences
      `);
      expect(userTwoOwnRead.rows).toEqual([
        { owner_user_id: "22222222-2222-4222-8222-222222222222" },
      ]);

      await db.exec(`
        RESET ROLE;
        SET request.jwt.claim.sub =
          '11111111-1111-4111-8111-111111111111';
        SET ROLE authenticated;
      `);
      const userOneOwnRead = await db.query<{ owner_user_id: string }>(`
        SELECT owner_user_id
        FROM public.amora_personalization_preferences
      `);
      expect(userOneOwnRead.rows).toEqual([
        { owner_user_id: "11111111-1111-4111-8111-111111111111" },
      ]);

      const updated = await db.query<{ revision: number }>(`
        SELECT revision
        FROM public.set_own_amora_personalization_preferences(
          1,
          'compare_first',
          'brief',
          'listen_first',
          'together',
          'couple_first'
        )
      `);
      expect(updated.rows[0]?.revision).toBe(2);
      await expect(
        db.query(`
          SELECT public.clear_own_amora_personalization_preferences(1)
        `),
      ).rejects.toThrow("AMORA_PERSONALIZATION_REVISION_CONFLICT");
      await expect(
        db.query(`
          SELECT public.clear_own_amora_personalization_preferences(2)
            AS cleared
        `),
      ).resolves.toMatchObject({ rows: [{ cleared: true }] });
      await expect(
        db.query(`
          SELECT public.clear_own_amora_personalization_preferences(2)
            AS cleared
        `),
      ).resolves.toMatchObject({ rows: [{ cleared: true }] });

      await db.exec(`
        RESET ROLE;
        SET request.jwt.claim.sub =
          '22222222-2222-4222-8222-222222222222';
        SET ROLE authenticated;
      `);
      const otherUserRead = await db.query(`
        SELECT owner_user_id
        FROM public.amora_personalization_preferences
      `);
      expect(otherUserRead.rows).toEqual([
        { owner_user_id: "22222222-2222-4222-8222-222222222222" },
      ]);
    } finally {
      await db.close();
    }
  });
});
