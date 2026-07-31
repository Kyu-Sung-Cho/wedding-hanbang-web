import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmoraPrivacyContextError,
  assertAmoraPrivacyContextSnapshotCurrent,
  getAmoraMemoryEnablement,
  getAmoraPrivacyContextSnapshot,
  type AmoraPrivacyContextSnapshot,
} from "@/lib/ai/amoraMemoryQueue";

function snapshot(
  overrides: Partial<AmoraPrivacyContextSnapshot> = {},
): AmoraPrivacyContextSnapshot {
  return {
    version: 1,
    actorRole: "bride",
    rosterFingerprint: "a".repeat(32),
    memory: {
      shared: {
        enabled: true,
        resetAt: "2026-07-31T00:00:00.000Z",
      },
      bride_private: { enabled: false, resetAt: null },
      groom_private: { enabled: false, resetAt: null },
    },
    personalization: { exists: true, revision: 2 },
    ...overrides,
  };
}

describe("Amora memory enablement", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses current unanimous consent instead of a stale materialized enabled flag", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async (_name: string, args: { p_visibility: string }) => ({
      data: args.p_visibility === "bride_private",
      error: null,
    }));
    const admin = { rpc } as unknown as SupabaseClient;

    const result = await getAmoraMemoryEnablement(
      "10000000-0000-4000-8000-000000000001",
      ["shared", "bride_private"],
      admin,
    );

    expect(result).toMatchObject({ shared: false, bride_private: true });
  });

  it("parses one authenticated RPC snapshot and preserves its reset boundary", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async () => ({
      data: {
        version: 1,
        actorRole: "bride",
        rosterFingerprint: "b".repeat(32),
        memory: {
          shared: {
            enabled: true,
            resetAt: "2026-07-31T03:00:00.000Z",
          },
          bride_private: {
            enabled: false,
            resetAt: "2026-07-31T02:00:00.000Z",
          },
        },
        personalization: { exists: true, revision: 4 },
      },
      error: null,
    }));

    const result = await getAmoraPrivacyContextSnapshot(
      "10000000-0000-4000-8000-000000000001",
      ["shared", "bride_private"],
      { rpc } as unknown as SupabaseClient,
    );

    expect(rpc).toHaveBeenCalledWith(
      "get_own_amora_privacy_context_snapshot",
      {
        p_couple_id: "10000000-0000-4000-8000-000000000001",
        p_visibilities: ["shared", "bride_private"],
      },
    );
    expect(result).toEqual({
      version: 1,
      actorRole: "bride",
      rosterFingerprint: "b".repeat(32),
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T03:00:00.000Z",
        },
        bride_private: {
          enabled: false,
          resetAt: "2026-07-31T02:00:00.000Z",
        },
        groom_private: { enabled: false, resetAt: null },
      },
      personalization: { exists: true, revision: 4 },
    });
  });

  it("masks database consent when the auxiliary-memory runtime flag is off", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "false");
    const rpc = vi.fn(async () => ({
      data: {
        version: 1,
        actorRole: "bride",
        rosterFingerprint: "c".repeat(32),
        memory: {
          shared: {
            enabled: true,
            resetAt: "2026-07-31T03:00:00.000Z",
          },
        },
        personalization: { exists: false, revision: null },
      },
      error: null,
    }));

    const result = await getAmoraPrivacyContextSnapshot(
      "10000000-0000-4000-8000-000000000001",
      ["shared"],
      { rpc } as unknown as SupabaseClient,
    );

    expect(result.memory.shared).toEqual({
      enabled: false,
      resetAt: "2026-07-31T03:00:00.000Z",
    });
  });

  it("allows a scope that was initially disabled to become enabled", () => {
    const initial = snapshot({
      memory: {
        shared: { enabled: false, resetAt: null },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    const current = snapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T03:00:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });

    expect(() =>
      assertAmoraPrivacyContextSnapshotCurrent(
        initial,
        current,
        ["shared"],
      )
    ).not.toThrow();
  });

  it.each([
    [
      "consent withdrawal",
      snapshot({
        memory: {
          shared: {
            enabled: false,
            resetAt: "2026-07-31T01:00:00.000Z",
          },
          bride_private: { enabled: false, resetAt: null },
          groom_private: { enabled: false, resetAt: null },
        },
      }),
    ],
    [
      "reset-boundary change",
      snapshot({
        memory: {
          shared: {
            enabled: true,
            resetAt: "2026-07-31T01:00:00.000Z",
          },
          bride_private: { enabled: false, resetAt: null },
          groom_private: { enabled: false, resetAt: null },
        },
      }),
    ],
    [
      "personalization deletion",
      snapshot({
        personalization: { exists: false, revision: null },
      }),
    ],
    [
      "personalization update",
      snapshot({
        personalization: { exists: true, revision: 3 },
      }),
    ],
    [
      "roster change",
      snapshot({
        rosterFingerprint: "d".repeat(32),
      }),
    ],
  ])("rejects a %s between prompt assembly and generation", (_label, current) => {
    expect(() =>
      assertAmoraPrivacyContextSnapshotCurrent(
        snapshot(),
        current,
        ["shared"],
      )
    ).toThrowError(
      expect.objectContaining({
        code: "AMORA_PRIVACY_CONTEXT_CHANGED",
      }),
    );
  });

  it.each([
    {
      label: "RPC error",
      response: {
        data: null,
        error: { code: "42501", message: "permission changed" },
      },
    },
    {
      label: "malformed payload",
      response: {
        data: {
          version: 1,
          actorRole: "bride",
          rosterFingerprint: "not-a-fingerprint",
          memory: {},
          personalization: { exists: false, revision: null },
        },
        error: null,
      },
    },
  ])("maps a $label to an unavailable privacy fence", async ({ response }) => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => response);

    await expect(
      getAmoraPrivacyContextSnapshot(
        "10000000-0000-4000-8000-000000000001",
        ["shared"],
        { rpc } as unknown as SupabaseClient,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
      }),
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("uses a stable typed error for callers to map without raw provider details", () => {
    const error = new AmoraPrivacyContextError(
      "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
    );

    expect(error.name).toBe("AmoraPrivacyContextError");
    expect(error.message).toBe("AMORA_PRIVACY_CONTEXT_UNAVAILABLE");
  });
});
