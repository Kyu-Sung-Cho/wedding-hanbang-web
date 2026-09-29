// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupProviderMedia } from "./mediaCleanup";

const owner = "11111111-1111-4111-8111-111111111111";
const provider = "22222222-2222-4222-8222-222222222222";
const media = "33333333-3333-4333-8333-333333333333";
const path = `${owner}/${provider}/${media}.webp`;
const now = new Date("2026-09-28T12:00:00.000Z");
let candidate: Record<string, unknown>;
let current: Record<string, unknown>[] | undefined;
let rpc: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
let exists: ReturnType<typeof vi.fn>;
let list: ReturnType<typeof vi.fn>;
let client: SupabaseClient;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  candidate = { id: media, provider_id: provider, owner_id: owner, storage_path: path, status: "removed", created_at: "2026-09-28T11:00:00+00:00", cleanup_claim_until: "2026-09-28T12:05:00+00:00" };
  current = undefined;
  rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "provider_claim_media_cleanup") {
      candidate.cleanup_claim_token = args.p_claim_token;
      return { data: [candidate], error: null };
    }
    return { data: true, error: null };
  });
  remove = vi.fn().mockResolvedValue({ data: [], error: null });
  exists = vi.fn().mockResolvedValue({ data: false, error: null });
  list = vi.fn().mockResolvedValue({ data: [], error: null });
  const query = { select: vi.fn(), in: vi.fn(async () => ({ data: current ?? [candidate], error: null })) };
  query.select.mockReturnValue(query);
  client = { rpc, from: () => query, storage: { from: () => ({ remove, exists, list }) } } as unknown as SupabaseClient;
});
afterEach(() => vi.useRealTimers());

describe("provider portfolio cleanup", () => {
  it("checkpoints only exact owned paths after fresh removed-state and absence checks", async () => {
    expect(await cleanupProviderMedia(client)).toEqual({ claimed: 1, cleaned: 1, retired: 0, pending: 0 });
    expect(remove).toHaveBeenCalledWith([path]); expect(exists).toHaveBeenCalledWith(path);
    expect(rpc).toHaveBeenLastCalledWith("provider_checkpoint_media_cleanup", { p_media_id: media, p_claim_token: candidate.cleanup_claim_token, p_storage_path: path });
  });
  it.each([
    { status: "ready" }, { storage_path: `${provider}/${media}.webp` },
    { storage_path: `${provider}/${provider}/${media}.webp` }, { created_at: "2026-09-28T11:30:00.000Z" },
    { cleanup_claim_until: "2026-09-28T11:59:00.000Z" },
  ])("fails closed for unsafe inventory %j", async (change) => {
    Object.assign(candidate, change);
    await expect(cleanupProviderMedia(client)).rejects.toThrow("PROVIDER_CLEANUP_INVALID_INVENTORY");
    expect(remove).not.toHaveBeenCalled();
  });
  it("never removes a row that becomes ready at the final state check", async () => {
    current = [{ ...candidate, status: "ready", cleanup_claim_token: owner }];
    await expect(cleanupProviderMedia(client)).rejects.toThrow("PROVIDER_CLEANUP_STATE_UNAVAILABLE");
    expect(remove).not.toHaveBeenCalled();
  });
  it("leaves failed removals pending for another durable lease", async () => {
    remove.mockRejectedValue(new Error("network")); exists.mockResolvedValue({ data: true, error: null });
    expect(await cleanupProviderMedia(client)).toEqual({ claimed: 1, cleaned: 0, retired: 0, pending: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("uses an exact complete list when the SDK HEAD response is ambiguous", async () => {
    exists.mockResolvedValue({ data: false, error: { __isStorageError: true, name: "StorageApiError", status: 404 } });
    expect((await cleanupProviderMedia(client)).cleaned).toBe(1);
    expect(list).toHaveBeenCalledWith(`${owner}/${provider}`, { search: `${media}.webp`, limit: 2 });
  });
  it("does not checkpoint a HEAD-missing object that the list still finds", async () => {
    exists.mockResolvedValue({ data: false, error: { __isStorageError: true, name: "StorageApiError", status: 400 } });
    list.mockResolvedValue({ data: [{ id: media, name: `${media}.webp` }], error: null });
    expect((await cleanupProviderMedia(client)).pending).toBe(1); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not mistake an unavailable absence check for deletion", async () => {
    exists.mockResolvedValue({ data: false, error: { status: 503 } });
    expect((await cleanupProviderMedia(client)).pending).toBe(1); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("leaves cascaded rows to the account-deletion manifest", async () => {
    current = [];
    expect(await cleanupProviderMedia(client)).toEqual({ claimed: 1, cleaned: 0, retired: 1, pending: 0 });
    expect(remove).not.toHaveBeenCalled();
  });
});
