import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  repairMissingAmoraMemoryJobs,
  verifyActiveAmoraMemoryJob,
  verifyAmoraMemoryEnqueueRepairCandidate,
} from "../amoraMemoryRepair";

const CANDIDATE_INPUT = {
  coupleId: "20000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000001",
  visibility: "shared" as const,
  toMessageId: "30000000-0000-4000-8000-000000000001",
};

describe("repairMissingAmoraMemoryJobs", () => {
  it("calls the bounded service RPC and accepts only internally consistent aggregate metrics", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        scanned: 4,
        queued: 2,
        duplicate: 1,
        skipped: 1,
        failed: 0,
      },
      error: null,
    }));

    const result = await repairMissingAmoraMemoryJobs(
      { rpc } as unknown as SupabaseClient,
      20,
    );

    expect(result).toEqual({
      status: "repaired",
      scanned: 4,
      queued: 2,
      duplicate: 1,
      skipped: 1,
      failed: 0,
    });
    expect(rpc).toHaveBeenCalledWith(
      "repair_missing_amora_memory_jobs",
      { p_limit: 20 },
    );
  });

  it.each([
    null,
    { scanned: 21, queued: 21, duplicate: 0, skipped: 0, failed: 0 },
    { scanned: 2, queued: 1, duplicate: 0, skipped: 0, failed: 0 },
    { scanned: 1, queued: -1, duplicate: 0, skipped: 1, failed: 1 },
    { scanned: 1.5, queued: 1, duplicate: 0, skipped: 0, failed: 0 },
  ])("fails closed on a malformed or unbounded repair result: %j", async (data) => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({ data, error: null }));

    const result = await repairMissingAmoraMemoryJobs(
      { rpc } as unknown as SupabaseClient,
      20,
    );

    expect(result).toEqual({ status: "unavailable" });
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-repair] repair unavailable",
      "invalid_result",
    );
    warning.mockRestore();
  });

  it("returns unavailable with only the database code when the repair RPC fails", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "57014", message: "SECRET raw database detail" },
    }));

    const result = await repairMissingAmoraMemoryJobs(
      { rpc } as unknown as SupabaseClient,
      20,
    );

    expect(result).toEqual({ status: "unavailable" });
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-repair] repair unavailable",
      "57014",
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET");
    warning.mockRestore();
  });

  it("does not trust or log a malformed database code", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: "SECRET raw database detail",
        message: "SECRET raw database detail",
      },
    }));

    const result = await repairMissingAmoraMemoryJobs(
      { rpc } as unknown as SupabaseClient,
      20,
    );

    expect(result).toEqual({ status: "unavailable" });
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-repair] repair unavailable",
      "unknown",
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET");
    warning.mockRestore();
  });

  it("converts a thrown transport error without logging its message", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => {
      throw new Error("SECRET transport details");
    });

    const result = await repairMissingAmoraMemoryJobs(
      { rpc } as unknown as SupabaseClient,
      20,
    );

    expect(result).toEqual({ status: "unavailable" });
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-repair] repair unavailable",
      "transport_error",
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET");
    warning.mockRestore();
  });

  it.each([0, 101, 1.5])("rejects an invalid internal repair bound: %s", async (limit) => {
    const rpc = vi.fn();

    await expect(repairMissingAmoraMemoryJobs(
      { rpc } as unknown as SupabaseClient,
      limit,
    )).rejects.toThrow(/repair limit/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("verifyAmoraMemoryEnqueueRepairCandidate", () => {
  it.each([
    [true, { status: "confirmed" }],
    [false, { status: "absent" }],
  ] as const)("maps exact boolean %s without collapsing absence into availability", async (
    data,
    expected,
  ) => {
    const rpc = vi.fn(async () => ({ data, error: null }));

    const result = await verifyAmoraMemoryEnqueueRepairCandidate({
      admin: { rpc } as unknown as SupabaseClient,
      ...CANDIDATE_INPUT,
    });

    expect(result).toEqual(expected);
    expect(rpc).toHaveBeenCalledWith(
      "has_amora_memory_enqueue_repair_candidate",
      {
        p_couple_id: CANDIDATE_INPUT.coupleId,
        p_user_id: CANDIDATE_INPUT.userId,
        p_visibility: CANDIDATE_INPUT.visibility,
        p_to_message_id: CANDIDATE_INPUT.toMessageId,
      },
    );
  });

  it.each([null, "true", 1, {}, []])(
    "treats malformed proof result as unavailable: %j",
    async (data) => {
      const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const rpc = vi.fn(async () => ({ data, error: null }));

      const result = await verifyAmoraMemoryEnqueueRepairCandidate({
        admin: { rpc } as unknown as SupabaseClient,
        ...CANDIDATE_INPUT,
      });

      expect(result).toEqual({ status: "unavailable" });
      expect(warning).toHaveBeenCalledWith(
        "[amora-memory-repair] candidate proof unavailable",
        "invalid_result",
      );
      warning.mockRestore();
    },
  );

  it("keeps RPC failure unavailable and logs only a safe code", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "57014", message: "SECRET proof detail" },
    }));

    const result = await verifyAmoraMemoryEnqueueRepairCandidate({
      admin: { rpc } as unknown as SupabaseClient,
      ...CANDIDATE_INPUT,
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-repair] candidate proof unavailable",
      "57014",
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET");
    warning.mockRestore();
  });

  it("keeps a thrown proof transport failure unavailable without raw logging", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => {
      throw new Error("SECRET proof transport detail");
    });

    const result = await verifyAmoraMemoryEnqueueRepairCandidate({
      admin: { rpc } as unknown as SupabaseClient,
      ...CANDIDATE_INPUT,
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-repair] candidate proof unavailable",
      "transport_error",
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET");
    warning.mockRestore();
  });
});

describe("verifyActiveAmoraMemoryJob", () => {
  it.each([
    [true, { status: "confirmed" }],
    [false, { status: "absent" }],
  ] as const)("maps exact active-job boolean %s", async (data, expected) => {
    const rpc = vi.fn(async () => ({ data, error: null }));

    const result = await verifyActiveAmoraMemoryJob({
      admin: { rpc } as unknown as SupabaseClient,
      ...CANDIDATE_INPUT,
    });

    expect(result).toEqual(expected);
    expect(rpc).toHaveBeenCalledWith("has_active_amora_memory_job", {
      p_couple_id: CANDIDATE_INPUT.coupleId,
      p_user_id: CANDIDATE_INPUT.userId,
      p_visibility: CANDIDATE_INPUT.visibility,
      p_to_message_id: CANDIDATE_INPUT.toMessageId,
    });
  });

  it.each([null, "true", 1, {}, []])(
    "keeps malformed active-job proof unavailable: %j",
    async (data) => {
      const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const rpc = vi.fn(async () => ({ data, error: null }));

      const result = await verifyActiveAmoraMemoryJob({
        admin: { rpc } as unknown as SupabaseClient,
        ...CANDIDATE_INPUT,
      });

      expect(result).toEqual({ status: "unavailable" });
      expect(warning).toHaveBeenCalledWith(
        "[amora-memory-repair] active job proof unavailable",
        "invalid_result",
      );
      warning.mockRestore();
    },
  );

  it("logs only a safe code when active-job proof fails", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "57014", message: "SECRET active proof detail" },
    }));

    const result = await verifyActiveAmoraMemoryJob({
      admin: { rpc } as unknown as SupabaseClient,
      ...CANDIDATE_INPUT,
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-repair] active job proof unavailable",
      "57014",
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET");
    warning.mockRestore();
  });

  it("keeps a thrown active-job proof unavailable without raw logging", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn(async () => {
      throw new Error("SECRET active proof transport detail");
    });

    const result = await verifyActiveAmoraMemoryJob({
      admin: { rpc } as unknown as SupabaseClient,
      ...CANDIDATE_INPUT,
    });

    expect(result).toEqual({ status: "unavailable" });
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-repair] active job proof unavailable",
      "transport_error",
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET");
    warning.mockRestore();
  });
});
