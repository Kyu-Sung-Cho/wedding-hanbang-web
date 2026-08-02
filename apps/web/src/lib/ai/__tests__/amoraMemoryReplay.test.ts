import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reconcilePersistedAmoraMemoryEnqueue } from "../amoraMemoryReplay";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "20000000-0000-4000-8000-000000000001";

describe("reconcilePersistedAmoraMemoryEnqueue", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retries an exact server-eligible W0 message through the idempotent database enqueue", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async () => ({ data: "queued", error: null }));

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "reconciled", enqueueResult: "queued" });
    expect(rpc).toHaveBeenCalledWith("enqueue_amora_memory_job", {
      p_couple_id: COUPLE_ID,
      p_user_id: USER_ID,
      p_visibility: "shared",
      p_to_message_id: MESSAGE_ID,
    });
  });

  it("accepts an atomically requeued failed job as a completed reconciliation", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async () => ({ data: "requeued", error: null }));

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "reconciled", enqueueResult: "requeued" });
  });

  it("does not backfill a persisted turn whose runtime enqueue intent was off", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async () => ({ data: "not_requested", error: null }));

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
          memory_enqueue_requested: false,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({
      status: "reconciled",
      enqueueResult: "not_requested",
    });
  });

  it("does not call the database enqueue RPC while the runtime kill switch is off", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "false");
    const rpc = vi.fn();

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
          memory_enqueue_requested: false,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "reconciled", enqueueResult: "disabled" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never treats an explicit database dead letter as reconciled", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async () => ({ data: "dead_letter", error: null }));

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
          memory_enqueue_requested: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "retry_required" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("preserves a current private W1 visibility instead of widening it to shared", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async (name: string) => {
      if (name === "enqueue_amora_memory_job") {
        return { data: "duplicate", error: null };
      }
      if (name === "has_active_amora_memory_job") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "bride_private",
      message: {
        id: MESSAGE_ID,
        visibility: "bride_private",
        metadata: {
          question_scope: "W1_wedding_adjacent",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "reconciled", enqueueResult: "duplicate" });
    expect(rpc).toHaveBeenNthCalledWith(1, "enqueue_amora_memory_job", expect.objectContaining({
      p_visibility: "bride_private",
    }));
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "has_active_amora_memory_job",
      {
        p_couple_id: COUPLE_ID,
        p_user_id: USER_ID,
        p_visibility: "bride_private",
        p_to_message_id: MESSAGE_ID,
      },
    );
  });

  it("requires a retry when duplicate does not prove an exact active or completed job", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn(async (name: string) => {
      if (name === "enqueue_amora_memory_job") {
        return { data: "duplicate", error: null };
      }
      if (name === "has_active_amora_memory_job") {
        return { data: false, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "retry_required" });
  });

  it("fails closed when an exact active-job proof is unavailable", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async (name: string) => {
      if (name === "enqueue_amora_memory_job") {
        return { data: "duplicate", error: null };
      }
      if (name === "has_active_amora_memory_job") {
        return {
          data: null,
          error: { code: "57014", message: "SECRET_DATABASE_DETAIL" },
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "retry_required" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[amora-memory-repair] active job proof unavailable",
      "57014",
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SECRET_DATABASE_DETAIL");
    errorSpy.mockRestore();
  });

  it.each(["disabled", "before_boundary"] as const)(
    "treats the database's %s consent boundary as a completed reconciliation",
    async (enqueueResult) => {
      vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
      const rpc = vi.fn(async () => ({ data: enqueueResult, error: null }));

      const result = await reconcilePersistedAmoraMemoryEnqueue({
        coupleId: COUPLE_ID,
        userId: USER_ID,
        expectedVisibility: "shared",
        message: {
          id: MESSAGE_ID,
          visibility: "shared",
          metadata: {
            question_scope: "W0_wedding_core",
            memory_eligible: true,
          },
        },
        admin: { rpc } as unknown as SupabaseClient,
      });

      expect(result).toEqual({ status: "reconciled", enqueueResult });
    },
  );

  it.each([
    "W2_high_risk_adjacent",
    "W3_social_care",
    "W4_out_of_scope",
    "W5_safety_override",
  ])("never retries a server-ineligible %s message", async (questionScope) => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn();

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: questionScope,
          // A contradictory boolean must never raise a non-wedding scope.
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "not_eligible" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not coerce or infer a malformed persisted question scope", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn();

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core ",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "not_eligible" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { question_scope: "W0_wedding_core" },
    { question_scope: "W1_wedding_adjacent", memory_eligible: "true" },
  ])("does not infer eligibility from legacy or malformed metadata: %j", async (metadata) => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn();

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata,
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "not_eligible" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed before enqueue when the persisted visibility differs from the current request", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn();

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "bride_private",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W1_wedding_adjacent",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "invalid_message_scope" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed before enqueue when an eligible persisted row has no durable message id", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const rpc = vi.fn();

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: null,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "invalid_message_scope" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("completes smoothly when an unconfirmed immediate enqueue has an exact durable repair proof", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async (name: string) => {
      if (name === "enqueue_amora_memory_job") {
        return {
          data: null,
          error: { code: "57014", message: "statement timeout" },
        };
      }
      if (name === "has_amora_memory_enqueue_repair_candidate") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "repair_queued" });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "has_amora_memory_enqueue_repair_candidate",
      {
        p_couple_id: COUPLE_ID,
        p_user_id: USER_ID,
        p_visibility: "shared",
        p_to_message_id: MESSAGE_ID,
      },
    );
    errorSpy.mockRestore();
  });

  it("returns a durable retry requirement when the database enqueue is unconfirmed", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    }));

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "retry_required" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[amora-memory] enqueue failed",
      "57014",
    );
    errorSpy.mockRestore();
  });

  it("maps a thrown enqueue transport failure to the same retry requirement", async () => {
    vi.stubEnv("AMORA_AUXILIARY_MEMORY_ENABLED", "true");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => {
      throw new Error("transport unavailable");
    });

    const result = await reconcilePersistedAmoraMemoryEnqueue({
      coupleId: COUPLE_ID,
      userId: USER_ID,
      expectedVisibility: "shared",
      message: {
        id: MESSAGE_ID,
        visibility: "shared",
        metadata: {
          question_scope: "W1_wedding_adjacent",
          memory_eligible: true,
        },
      },
      admin: { rpc } as unknown as SupabaseClient,
    });

    expect(result).toEqual({ status: "retry_required" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
