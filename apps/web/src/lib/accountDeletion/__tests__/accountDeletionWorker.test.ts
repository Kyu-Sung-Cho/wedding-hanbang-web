import { describe, expect, it, vi } from "vitest";

import {
  hasActiveAccountDeletion,
  processAccountDeletionJob,
  requestAccountDeletion,
  type AccountDeletionJob,
  type AccountDeletionManifestRow,
} from "@/lib/accountDeletion/communityStorageSaga";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-07-17T02:00:00Z");
const LEGACY_PATH = `${USER_ID}/1700000000000_66666666-6666-4666-8666-666666666666.jpg`;
const CHAT_PATH = "77777777-7777-4777-8777-777777777777/11111111-1111-4111-8111-111111111111/88888888-8888-4888-8888-888888888888.webp";

function job(overrides: Partial<AccountDeletionJob> = {}): AccountDeletionJob {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    status: "deleting",
    ready_after: "2026-07-17T01:00:00Z",
    quarantine_count: 0,
    claim_token: "33333333-3333-4333-8333-333333333333",
    ...overrides,
  };
}

function manifest(
  overrides: Partial<AccountDeletionManifestRow> = {},
): AccountDeletionManifestRow {
  return {
    job_id: JOB_ID,
    bucket: "community-images",
    path: LEGACY_PATH,
    source: "legacy_prefix",
    not_before: "2026-07-17T01:00:00Z",
    cleaned_at: null,
    ...overrides,
  };
}

function harness(options: {
  manifest?: AccountDeletionManifestRow[];
  objectStillExists?: boolean;
  authMissing?: boolean;
  claimThrows?: boolean;
  retentionPreflight?: "clear" | "manual_review" | "rejected";
  ownedChatPaths?: string[];
  chatRows?: Array<Record<string, unknown>>;
  existingPaths?: string[];
} = {}) {
  const sequence: string[] = [];
  const rows = options.manifest ?? [manifest()];
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    sequence.push(name);
    if (name === "claim_account_deletion_job") {
      if (options.claimThrows) throw new Error("network unavailable");
      return {
        data: [job({ claim_token: String(args?.p_claim_token) })],
        error: null,
      };
    }
    if (name === "preflight_account_deletion_retention") {
      return { data: options.retentionPreflight ?? "clear", error: null };
    }
    if (name === "list_account_deletion_owned_chat_objects") {
      const afterName = typeof args?.p_after_name === "string"
        ? args.p_after_name
        : null;
      const limit = Number(args?.p_limit ?? 100);
      return {
        data: [...(options.ownedChatPaths ?? [])]
          .sort()
          .filter((path) => afterName === null || path > afterName)
          .slice(0, limit)
          .map((path) => ({ path })),
        error: null,
      };
    }
    if (name === "checkpoint_account_deletion_media"
        || name === "prepare_account_deletion_auth_delete"
        || name === "finalize_account_deletion_job"
        || name === "release_account_deletion_job"
        || name === "mark_account_deletion_legacy_chat_manual_review"
        || name === "mark_account_deletion_manual_review") {
      return { data: true, error: null };
    }
    throw new Error(`unexpected RPC: ${name}`);
  });
  const range = vi.fn(async (from: number) => ({
    data: from === 0 ? rows : [],
    error: null,
  }));
  const orderedQuery = { order: vi.fn(), range };
  orderedQuery.order.mockReturnValue(orderedQuery);
  const eq = vi.fn(() => orderedQuery);
  const select = vi.fn(() => ({ eq }));
  const chatRange = vi.fn(async (fromIndex: number) => ({
    data: fromIndex === 0 ? (options.chatRows ?? []) : [],
    error: null,
  }));
  const chatOrder = vi.fn(() => ({ range: chatRange }));
  const chatEq = vi.fn(() => ({ order: chatOrder }));
  const chatSelect = vi.fn(() => ({ eq: chatEq }));
  const from = vi.fn((table: string) => {
    if (table === "chat_messages") return { select: chatSelect };
    if (table !== "account_deletion_media_manifest") {
      throw new Error(`unexpected table: ${table}`);
    }
    return { select };
  });
  const remove = vi.fn(async () => {
    sequence.push("storage.remove");
    return { data: [], error: null };
  });
  const existingPaths = new Set(options.existingPaths ?? []);
  const exists = vi.fn(async (path: string) => {
    sequence.push("storage.exists");
    return {
      data: existingPaths.has(path) || (options.objectStillExists ?? false),
      error: null,
    };
  });
  const list = vi.fn(async (): Promise<{
    data: Array<{ name: string; id?: string | null }>;
    error: null;
  }> => {
    sequence.push("storage.list");
    return { data: [], error: null };
  });
  const storageFrom = vi.fn(() => ({ remove, exists, list }));
  const getUserById = vi.fn(async () => {
    sequence.push("auth.getUserById");
    return options.authMissing
      ? { data: { user: null }, error: { code: "user_not_found", status: 404 } }
      : { data: { user: { id: USER_ID } }, error: null };
  });
  const deleteUser = vi.fn(async () => {
    sequence.push("auth.deleteUser");
    return { data: { user: null }, error: null };
  });
  return {
    admin: {
      rpc,
      from,
      storage: { from: storageFrom },
      auth: { admin: { getUserById, deleteUser } },
    },
    sequence,
    rpc,
    remove,
    exists,
    list,
    deleteUser,
  };
}

describe("account deletion Storage worker", () => {
  it("absence-checks every exact path before crossing the Auth deletion boundary", async () => {
    const test = harness();

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "completed" });
    expect(test.remove).toHaveBeenCalledWith([LEGACY_PATH]);
    expect(test.exists).toHaveBeenCalledWith(LEGACY_PATH);
    expect(test.sequence).toEqual([
      "claim_account_deletion_job",
      "preflight_account_deletion_retention",
      "storage.remove",
      "storage.exists",
      "checkpoint_account_deletion_media",
      "storage.list",
      "storage.list",
      "storage.list",
      "list_account_deletion_owned_chat_objects",
      "storage.list",
      "prepare_account_deletion_auth_delete",
      "auth.getUserById",
      "auth.deleteUser",
      "finalize_account_deletion_job",
    ]);
  });

  it("releases for retry and never deletes Auth when Storage still contains a path", async () => {
    const test = harness({ objectStillExists: true });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "retry" });
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc).not.toHaveBeenCalledWith(
      "prepare_account_deletion_auth_delete",
      expect.anything(),
    );
    expect(test.rpc).toHaveBeenCalledWith(
      "release_account_deletion_job",
      expect.objectContaining({ p_error_code: "storage_delete_unconfirmed" }),
    );
  });

  it("stops on retention review before any irreversible Storage side effect", async () => {
    const test = harness({ retentionPreflight: "manual_review" });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "manual_review" });
    expect(test.remove).not.toHaveBeenCalled();
    expect(test.exists).not.toHaveBeenCalled();
    expect(test.list).not.toHaveBeenCalled();
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc).not.toHaveBeenCalledWith(
      "prepare_account_deletion_auth_delete",
      expect.anything(),
    );
  });

  it("moves unproven paths to manual review without deleting any object", async () => {
    const test = harness({
      manifest: [manifest({ source: "quarantine" })],
    });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "manual_review" });
    expect(test.remove).not.toHaveBeenCalled();
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc).toHaveBeenCalledWith(
      "mark_account_deletion_manual_review",
      expect.objectContaining({ p_error_code: "unproven_legacy_media" }),
    );
  });

  it("never automatically deletes a strict chat-image attachment", async () => {
    const test = harness({
      manifest: [manifest({
        bucket: "chat-image",
        path: CHAT_PATH,
        source: "quarantine",
      })],
    });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "manual_review" });
    expect(test.remove).not.toHaveBeenCalled();
    expect(test.exists).not.toHaveBeenCalled();
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc).toHaveBeenCalledWith(
      "mark_account_deletion_manual_review",
      expect.objectContaining({ p_error_code: "unproven_legacy_media" }),
    );
  });

  it("finalizes idempotently when Auth was already deleted by an earlier attempt", async () => {
    const test = harness({ authMissing: true });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "completed" });
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc).toHaveBeenCalledWith(
      "finalize_account_deletion_job",
      expect.anything(),
    );
  });

  it("checkpoints a bounded batch and yields before Auth for large manifests", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => manifest({
      path: `${USER_ID}/1700000000000_66666666-6666-4666-8666-${String(index).padStart(12, "0")}.jpg`,
    }));
    const test = harness({ manifest: rows });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "pending" });
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc.mock.calls.filter(
      ([name]) => name === "checkpoint_account_deletion_media",
    )).toHaveLength(20);
    expect(test.rpc).toHaveBeenCalledWith(
      "release_account_deletion_job",
      expect.objectContaining({ p_error_code: "storage_cleanup_pending" }),
    );
  });

  it("re-cleans an exact manifest path that reappears after its checkpoint", async () => {
    const test = harness({
      manifest: [manifest({ cleaned_at: "2026-07-17T01:30:00Z" })],
    });
    test.list
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{ name: LEGACY_PATH.slice(`${USER_ID}/`.length) }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "pending" });
    expect(test.remove).toHaveBeenCalledWith([LEGACY_PATH]);
    expect(test.exists).toHaveBeenCalledWith(LEGACY_PATH);
    expect(test.rpc).toHaveBeenCalledWith(
      "checkpoint_account_deletion_media",
      expect.objectContaining({ p_path: LEGACY_PATH }),
    );
    expect(test.deleteUser).not.toHaveBeenCalled();
  });

  it("re-inventories chat-image before Auth deletion and quarantines a late attachment", async () => {
    const test = harness();
    test.list
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{ name: "77777777-7777-4777-8777-777777777777", id: null }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ name: "88888888-8888-4888-8888-888888888888.webp", id: "99999999-9999-4999-8999-999999999999" }],
        error: null,
      });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "manual_review" });
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc).not.toHaveBeenCalledWith(
      "prepare_account_deletion_auth_delete",
      expect.anything(),
    );
    expect(test.rpc).toHaveBeenCalledWith(
      "mark_account_deletion_manual_review",
      expect.objectContaining({
        p_error_code: "chat_attachment_manual_review_required",
      }),
    );
  });

  it("moves an owner-attributed orphan legacy chat object to manual review", async () => {
    const legacyChatPath = "77777777-7777-4777-8777-777777777777/1700000000000-abc12.webp";
    const test = harness({ ownedChatPaths: [legacyChatPath] });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "manual_review" });
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc).toHaveBeenCalledWith(
      "mark_account_deletion_legacy_chat_manual_review",
      expect.objectContaining({
        p_paths: [legacyChatPath],
        p_error_code: "chat_legacy_owner_manual_review_required",
      }),
    );
  });

  it("durably checkpoints an exact sender-referenced legacy chat object", async () => {
    const coupleId = "77777777-7777-4777-8777-777777777777";
    const legacyChatPath = `${coupleId}/1700000000000-abc12.webp`;
    const test = harness({
      manifest: [],
      existingPaths: [legacyChatPath],
      chatRows: [{
        id: "88888888-8888-4888-8888-888888888888",
        couple_id: coupleId,
        sender_id: USER_ID,
        metadata: { imagePaths: [legacyChatPath] },
      }],
    });

    const result = await processAccountDeletionJob(test.admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "manual_review" });
    expect(test.deleteUser).not.toHaveBeenCalled();
    expect(test.rpc).toHaveBeenCalledWith(
      "mark_account_deletion_legacy_chat_manual_review",
      expect.objectContaining({
        p_paths: [legacyChatPath],
        p_error_code: "chat_legacy_attachment_manual_review_required",
      }),
    );
  });

  it("returns a resumed inventorying job to manual review while its chat attachment remains", async () => {
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "claim_account_deletion_job") {
        return {
          data: [job({
            status: "inventorying",
            claim_token: String(args?.p_claim_token),
          })],
          error: null,
        };
      }
      if (name === "preflight_account_deletion_retention") {
        return { data: "clear", error: null };
      }
      if (name === "list_account_deletion_owned_chat_objects") {
        return { data: [], error: null };
      }
      if (name === "replace_account_deletion_media_manifest") {
        return {
          data: [job({
            status: "manual_review",
            quarantine_count: 1,
            claim_token: null,
          })],
          error: null,
        };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    const chatList = vi.fn(async (prefix: string) => {
      if (prefix === "") {
        return {
          data: [{ name: "77777777-7777-4777-8777-777777777777", id: null }],
          error: null,
        };
      }
      return {
        data: [{
          name: "88888888-8888-4888-8888-888888888888.webp",
          id: "99999999-9999-4999-8999-999999999999",
        }],
        error: null,
      };
    });
    const storageFrom = vi.fn((bucket: string) => ({
      list: bucket === "chat-image"
        ? chatList
        : vi.fn(async () => ({ data: [], error: null })),
      remove: vi.fn(async () => {
        throw new Error("resumed quarantine must never remove Storage");
      }),
    }));
    const range = vi.fn(async () => ({ data: [], error: null }));
    const order = vi.fn(() => ({ range }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const deleteUser = vi.fn();
    const admin = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === "vendors") {
          const limit = vi.fn(async () => ({ data: [], error: null }));
          const vendorEq = vi.fn(() => ({ limit }));
          const vendorSelect = vi.fn(() => ({ eq: vendorEq }));
          return { select: vendorSelect };
        }
        return { select };
      }),
      storage: { from: storageFrom },
      auth: { admin: { deleteUser } },
    };

    const result = await processAccountDeletionJob(admin as never, JOB_ID, NOW);

    expect(result).toEqual({ status: "manual_review" });
    expect(rpc).toHaveBeenCalledWith(
      "replace_account_deletion_media_manifest",
      expect.objectContaining({
        p_manifest: [expect.objectContaining({
          bucket: "chat-image",
          source: "quarantine",
          path: CHAT_PATH,
        })],
      }),
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("routes a vendor owner to manual review before any Storage or Auth side effect", async () => {
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "claim_account_deletion_job") {
        return {
          data: [job({
            status: "inventorying",
            claim_token: String(args?.p_claim_token),
          })],
          error: null,
        };
      }
      if (name === "preflight_account_deletion_retention") {
        return { data: "clear", error: null };
      }
      if (name === "mark_account_deletion_manual_review") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    const limit = vi.fn(async () => ({
      data: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      error: null,
    }));
    const eq = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ eq }));
    const storageFrom = vi.fn(() => ({
      list: vi.fn(async () => {
        throw new Error("vendor owner must stop before Storage inventory");
      }),
    }));
    const deleteUser = vi.fn();
    const admin = {
      rpc,
      from: vi.fn((table: string) => {
        if (table !== "vendors") throw new Error(`unexpected table: ${table}`);
        return { select };
      }),
      storage: { from: storageFrom },
      auth: { admin: { deleteUser } },
    };

    await expect(
      processAccountDeletionJob(admin as never, JOB_ID, NOW),
    ).resolves.toEqual({ status: "manual_review" });
    expect(rpc).toHaveBeenCalledWith(
      "mark_account_deletion_manual_review",
      expect.objectContaining({
        p_error_code: "vendor_account_manual_review_required",
      }),
    );
    expect(storageFrom).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("turns a thrown claim transport failure into a retry result", async () => {
    const test = harness({ claimThrows: true });

    await expect(
      processAccountDeletionJob(test.admin as never, JOB_ID, NOW),
    ).resolves.toEqual({ status: "retry" });
    expect(test.remove).not.toHaveBeenCalled();
    expect(test.deleteUser).not.toHaveBeenCalled();
  });
});

describe("account deletion request and upload fence", () => {
  it("enqueues a durable job without advancing destructive stages by default", async () => {
    const rpc = vi.fn(async () => ({
      data: [job({ status: "inventorying", claim_token: null })],
      error: null,
    }));

    await expect(requestAccountDeletion(
      { rpc } as never,
      USER_ID,
      "privacy",
      NOW,
    )).resolves.toEqual({ status: "pending" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("begin_account_deletion_job", {
      p_user_id: USER_ID,
      p_reason: "privacy",
    });
  });

  it("creates the durable job and preserves an existing manual-review stop", async () => {
    const rpc = vi.fn(async () => ({
      data: [job({
        status: "manual_review",
        claim_token: null,
      })],
      error: null,
    }));

    await expect(requestAccountDeletion(
      { rpc } as never,
      USER_ID,
      "  privacy  ",
      NOW,
    )).resolves.toEqual({ status: "manual_review" });
    expect(rpc).toHaveBeenCalledWith("begin_account_deletion_job", {
      p_user_id: USER_ID,
      p_reason: "privacy",
    });
  });

  it("fails closed when an authenticated request produces no durable job", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));

    await expect(requestAccountDeletion(
      { rpc } as never,
      USER_ID,
      "privacy",
      NOW,
    )).rejects.toThrow(/account_deletion_job_missing/);
  });

  it("rejects free-text deletion reasons before they can reach durable storage", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("RPC must not receive free-text reason data");
    });

    await expect(requestAccountDeletion(
      { rpc } as never,
      USER_ID,
      "contact me at bride@example.com",
      NOW,
    )).rejects.toThrow(/account_deletion_request_invalid/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("detects an active deletion and treats a lookup failure as unavailable", async () => {
    function fenceAdmin(data: unknown, error: unknown) {
      const limit = vi.fn(async () => ({ data, error }));
      const neq = vi.fn(() => ({ limit }));
      const eq = vi.fn(() => ({ neq }));
      const select = vi.fn(() => ({ eq }));
      return { from: vi.fn(() => ({ select })) };
    }

    await expect(hasActiveAccountDeletion(
      fenceAdmin([{ id: JOB_ID }], null) as never,
      USER_ID,
    )).resolves.toBe(true);
    await expect(hasActiveAccountDeletion(
      fenceAdmin(null, { code: "db_unavailable" }) as never,
      USER_ID,
    )).rejects.toThrow(/account_deletion_fence_unavailable/);
  });
});
