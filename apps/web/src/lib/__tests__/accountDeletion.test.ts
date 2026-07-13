import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AccountDeletionError,
  processAccountDeletionJob,
  type AccountDeletionJob,
} from "@/lib/accountDeletion";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const COUPLE_ID = "223e4567-e89b-42d3-a456-426614174000";
const PARTNER_ID = "523e4567-e89b-42d3-a456-426614174000";
const JOB_ID = "323e4567-e89b-42d3-a456-426614174000";
const WORKER_TOKEN = "423e4567-e89b-42d3-a456-426614174000";

const BASE_JOB: AccountDeletionJob = {
  job_id: JOB_ID,
  user_id: USER_ID,
  reason: "privacy",
  attempts: 1,
  storage_inventory: null,
};

type MockAdminOptions = {
  authMissing?: boolean;
  authLookupError?: { status?: number; code?: string };
  profile?: { couple_id: string | null; role: string | null } | null;
  deleteErrors?: Partial<Record<string, { code: string }>>;
  verificationErrors?: Partial<Record<string, { code: string }>>;
  remainingEmailRows?: Partial<Record<string, number>>;
  authEmail?: string | null;
  authEmailSequence?: Array<string | null>;
  snapshotScopes?: string[] | null;
  snapshotAt?: string | null;
  snapshotSaveError?: { code: string };
  snapshotLoadError?: { code: string };
  leaseRenewErrorAt?: number;
  leaseRenewErrorAfterEvent?: string;
  allowedEmailScopes?: string[];
  storageFiles?: string[];
  storageScopeFiles?: Record<string, string[]>;
  couple?: { bride_id: string | null; groom_id: string | null };
  ownedStorageObjects?: Array<{ bucket_id: string; object_name: string }>;
  ownedStorageListError?: { code: string };
  retainOwnedStorageMetadata?: boolean;
  cleanupReadyResult?: boolean;
  cleanupReadyError?: { code: string };
};

function createMockAdmin(options: MockAdminOptions = {}) {
  const events: string[] = [];
  const fromCalls: string[] = [];
  let savedInventory: unknown;
  let leaseRenewalCount = 0;
  let eventTriggeredLeaseFailure = false;
  let authLookupCount = 0;
  let durableSnapshotScopes = options.snapshotScopes === undefined
    ? ["delete-me@example.com"]
    : options.snapshotScopes;
  let durableSnapshotAt = options.snapshotAt === undefined
    ? "2026-07-12T00:00:00.000Z"
    : options.snapshotAt;
  const removedBatchSizes: number[] = [];
  const removedStoragePaths: Array<{ bucket: string; path: string }> = [];
  let ownedStorageObjects = (options.ownedStorageObjects ?? []).map((object) => ({
    ...object,
  }));
  const storageObjects = new Map<string, Set<string>>([
    [
      `community-images:${USER_ID}`,
      new Set(options.storageFiles ?? ["photo.jpg"]),
    ],
  ]);
  for (const [scope, files] of Object.entries(options.storageScopeFiles ?? {})) {
    storageObjects.set(scope, new Set(files));
  }

  function queryResult(table: string) {
    if (table === "guestbooks") return { data: [], error: null };
    return { data: null, error: null };
  }

  function from(table: string) {
    fromCalls.push(table);
    const isEmailScopedApplicationTable = table === "preregistrations"
      || table === "research_cohort_applications";
    let deleting = false;
    let verifyingCount = false;
    let savingEmailSnapshot = false;
    let loadingEmailSnapshot = false;
    let pendingSnapshotScopes: string[] | null = null;
    let pendingSnapshotAt: string | null = null;
    let deletionEmail: string | null = null;
    let verificationEmail: string | null = null;
    const query = {
      select: (_columns?: string, selectOptions?: { count?: string; head?: boolean }) => {
        if (selectOptions?.count === "exact" && selectOptions.head === true) {
          verifyingCount = true;
          events.push(`db:verify:${table}`);
        }
        if (table === "account_deletion_jobs" && _columns?.includes("email_scopes")) {
          loadingEmailSnapshot = true;
          events.push("db:snapshot-load");
        }
        return query;
      },
      delete: () => {
        deleting = true;
        events.push(`db:delete:${table}`);
        return query;
      },
      update: (payload?: Record<string, unknown>) => {
        events.push(`db:update:${table}`);
        if (table === "account_deletion_jobs" && payload?.email_snapshot_at) {
          savingEmailSnapshot = true;
          pendingSnapshotScopes = Array.isArray(payload.email_scopes)
            ? payload.email_scopes as string[]
            : null;
          pendingSnapshotAt = typeof payload.email_snapshot_at === "string"
            ? payload.email_snapshot_at
            : null;
          events.push("db:snapshot-save");
        }
        return query;
      },
      eq: (column: string, value: unknown) => {
        if (deleting && column === "email" && typeof value === "string") {
          deletionEmail = value;
          events.push(`db:delete-scope:${table}:${value}`);
        }
        if (verifyingCount && column === "email" && typeof value === "string") {
          verificationEmail = value;
          events.push(`db:verify-scope:${table}:${value}`);
        }
        return query;
      },
      like: () => query,
      gt: () => query,
      maybeSingle: async () => {
        if (table === "account_deletion_jobs" && savingEmailSnapshot) {
          if (!options.snapshotSaveError) {
            durableSnapshotScopes = pendingSnapshotScopes;
            durableSnapshotAt = pendingSnapshotAt;
          }
          return {
            data: options.snapshotSaveError ? null : { id: JOB_ID },
            error: options.snapshotSaveError ?? null,
          };
        }
        if (table === "account_deletion_jobs" && loadingEmailSnapshot) {
          return {
            data: options.snapshotLoadError ? null : {
              email_scopes: durableSnapshotScopes,
              email_snapshot_at: durableSnapshotAt,
            },
            error: options.snapshotLoadError ?? null,
          };
        }
        if (table === "profiles") {
          return {
            data: options.profile === undefined
              ? { couple_id: COUPLE_ID, role: "bride" }
              : options.profile,
            error: null,
          };
        }
        if (table === "couples") {
          return {
            data: options.couple ?? { bride_id: USER_ID, groom_id: null },
            error: null,
          };
        }
        return queryResult(table);
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(deleting
        ? {
            data: null,
            error: !isEmailScopedApplicationTable
              || (options.allowedEmailScopes ?? ["delete-me@example.com"]).includes(deletionEmail ?? "")
              ? options.deleteErrors?.[table] ?? null
              : { code: "missing_email_filter" },
          }
        : verifyingCount
          ? {
              data: null,
              count: (options.allowedEmailScopes ?? ["delete-me@example.com"]).includes(verificationEmail ?? "")
                ? options.remainingEmailRows?.[table] ?? 0
                : null,
              error: (options.allowedEmailScopes ?? ["delete-me@example.com"]).includes(verificationEmail ?? "")
                ? options.verificationErrors?.[table] ?? null
                : { code: "missing_email_filter" },
            }
          : queryResult(table))
        .then(onfulfilled, onrejected),
    };
    return query;
  }

  const admin = {
    from,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      events.push(`rpc:${name}`);
      if (name === "count_active_amora_provider_leases"
        || name === "count_active_amora_couple_provider_leases"
        || name === "count_active_community_upload_leases") {
        return { data: 0, error: null };
      }
      if (name === "save_account_deletion_storage_inventory") {
        savedInventory = args?.p_inventory;
        return { data: true, error: null };
      }
      if (name === "list_account_deletion_owned_storage_objects") {
        if (options.ownedStorageListError) {
          return { data: null, error: options.ownedStorageListError };
        }
        const afterBucket = typeof args?.p_after_bucket === "string"
          ? args.p_after_bucket
          : null;
        const afterName = typeof args?.p_after_name === "string"
          ? args.p_after_name
          : null;
        const limit = typeof args?.p_limit === "number" ? args.p_limit : 500;
        const sorted = [...ownedStorageObjects].sort((left, right) =>
          left.bucket_id.localeCompare(right.bucket_id)
          || left.object_name.localeCompare(right.object_name)
        );
        const page = sorted.filter((object) => {
          if (afterBucket === null || afterName === null) return true;
          return object.bucket_id > afterBucket
            || (object.bucket_id === afterBucket && object.object_name > afterName);
        }).slice(0, limit);
        return { data: page, error: null };
      }
      if (name === "renew_account_deletion_job_lease") {
        leaseRenewalCount += 1;
        events.push(`db:lease-renew:${leaseRenewalCount}`);
        const failedAfterEvent = !eventTriggeredLeaseFailure
          && typeof options.leaseRenewErrorAfterEvent === "string"
          && events.includes(options.leaseRenewErrorAfterEvent);
        const failed = options.leaseRenewErrorAt === leaseRenewalCount
          || failedAfterEvent;
        if (failedAfterEvent) eventTriggeredLeaseFailure = true;
        return failed
          ? { data: false, error: { code: "lease_expired" } }
          : { data: true, error: null };
      }
      if (name === "mark_account_deletion_cleanup_ready") {
        if (options.cleanupReadyError) {
          return { data: null, error: options.cleanupReadyError };
        }
        if (options.cleanupReadyResult !== undefined) {
          return { data: options.cleanupReadyResult, error: null };
        }
        return ownedStorageObjects.length === 0
          ? { data: true, error: null }
          : { data: null, error: { code: "owned_storage_remains" } };
      }
      if (name === "complete_account_deletion_job") return { data: true, error: null };
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        list: async (
          directory: string,
          listOptions?: { limit?: number; offset?: number },
        ) => {
          events.push(`storage:list:${bucket}:${directory}`);
          const scope = `${bucket}:${directory}`;
          const files = [...(storageObjects.get(scope) ?? new Set<string>())]
            .sort()
            .slice(
              listOptions?.offset ?? 0,
              (listOptions?.offset ?? 0) + (listOptions?.limit ?? 100),
            );
          return {
            data: files.map((name) => ({ id: `storage-object:${name}`, name })),
            error: null,
          };
        },
        remove: async (paths: string[]) => {
          events.push(`storage:remove:${bucket}`);
          removedBatchSizes.push(paths.length);
          for (const path of paths) {
            removedStoragePaths.push({ bucket, path });
            const parts = path.split("/");
            const name = parts.pop()!;
            storageObjects.get(`${bucket}:${parts.join("/")}`)?.delete(name);
          }
          if (!options.retainOwnedStorageMetadata) {
            const removed = new Set(paths);
            ownedStorageObjects = ownedStorageObjects.filter((object) =>
              object.bucket_id !== bucket || !removed.has(object.object_name)
            );
          }
          return { data: paths, error: null };
        },
      }),
    },
    auth: {
      admin: {
        getUserById: async () => {
          events.push("auth:get");
          if (options.authLookupError) {
            return { data: { user: null }, error: options.authLookupError };
          }
          if (options.authMissing) {
            return {
              data: { user: null },
              error: { status: 404, code: "user_not_found" },
            };
          }
          const sequencedEmail = options.authEmailSequence?.[
            Math.min(authLookupCount, options.authEmailSequence.length - 1)
          ];
          authLookupCount += 1;
          return {
            data: {
              user: {
                id: USER_ID,
                email: options.authEmailSequence
                  ? sequencedEmail
                  : options.authEmail === undefined
                  ? "delete-me@example.com"
                  : options.authEmail,
              },
            },
            error: null,
          };
        },
        deleteUser: async () => {
          events.push("auth:delete");
          return options.authMissing
            ? { data: null, error: { status: 404, code: "user_not_found" } }
            : { data: null, error: null };
        },
      },
    },
  };

  return {
    admin: admin as unknown as SupabaseClient,
    events,
    fromCalls,
    getSavedInventory: () => savedInventory,
    getRemainingStorageFiles: () => [
      ...(storageObjects.get(`community-images:${USER_ID}`) ?? new Set<string>()),
    ],
    getRemovedBatchSizes: () => [...removedBatchSizes],
    getRemovedStoragePaths: () => [...removedStoragePaths],
    getOwnedStorageObjects: () => [...ownedStorageObjects],
    getStorageFiles: (bucket: string, directory: string) => [
      ...(storageObjects.get(`${bucket}:${directory}`) ?? new Set<string>()),
    ],
  };
}

describe("processAccountDeletionJob", () => {
  it("does not mistake a generic Auth-route 404 for a deleted user", async () => {
    const mock = createMockAdmin({
      authLookupError: { status: 404, code: "route_not_found" },
    });

    await expect(
      processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN)
    ).rejects.toMatchObject({ code: "AUTH_LOOKUP_FAILED" });
    expect(mock.events).not.toContain("rpc:complete_account_deletion_job");
  });

  it("persists inventory before storage purge, then leaves/redacts, deletes auth, and completes", async () => {
    const mock = createMockAdmin();

    await processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN);

    const saved = mock.getSavedInventory() as Array<{ bucket: string; prefix: string }>;
    expect(saved).toEqual(expect.arrayContaining([
      { bucket: "community-images", prefix: USER_ID },
      { bucket: "community-videos", prefix: USER_ID },
    ]));
    expect(saved).not.toContainEqual({ bucket: "chat-image", prefix: COUPLE_ID });
    expect(mock.fromCalls).not.toContain("invitations");

    const inventorySave = mock.events.indexOf("rpc:save_account_deletion_storage_inventory");
    const emailSnapshotLoad = mock.events.indexOf("db:snapshot-load");
    const firstLeaseRenew = mock.events.indexOf("db:lease-renew:1");
    const secondLeaseRenew = mock.events.indexOf("db:lease-renew:2");
    const storageRemove = mock.events.indexOf("storage:remove:community-images");
    const leave = mock.events.indexOf("rpc:leave_amora_couple_safely");
    const redact = mock.events.lastIndexOf("rpc:redact_user_ai_data");
    const preregistrationDelete = mock.events.indexOf("db:delete:preregistrations");
    const researchApplicationDelete = mock.events.indexOf("db:delete:research_cohort_applications");
    const preregistrationVerify = mock.events.indexOf("db:verify:preregistrations");
    const researchApplicationVerify = mock.events.indexOf("db:verify:research_cohort_applications");
    const authDelete = mock.events.indexOf("auth:delete");
    const complete = mock.events.indexOf("rpc:complete_account_deletion_job");

    expect(firstLeaseRenew).toBeGreaterThanOrEqual(0);
    expect(emailSnapshotLoad).toBeGreaterThan(firstLeaseRenew);
    expect(inventorySave).toBeGreaterThan(emailSnapshotLoad);
    expect(secondLeaseRenew).toBeGreaterThan(inventorySave);
    expect(storageRemove).toBeGreaterThan(secondLeaseRenew);
    expect(leave).toBeGreaterThan(storageRemove);
    expect(preregistrationDelete).toBeGreaterThan(leave);
    expect(researchApplicationDelete).toBeGreaterThan(preregistrationDelete);
    expect(preregistrationVerify).toBeGreaterThan(researchApplicationDelete);
    expect(researchApplicationVerify).toBeGreaterThan(preregistrationVerify);
    expect(redact).toBeGreaterThan(leave);
    expect(authDelete).toBeGreaterThan(researchApplicationVerify);
    expect(authDelete).toBeGreaterThan(redact);
    expect(complete).toBeGreaterThan(authDelete);
  });

  it("deletes every owner_id object, including only this member's shared-chat object, before leaving", async () => {
    const mock = createMockAdmin({
      couple: { bride_id: USER_ID, groom_id: PARTNER_ID },
      storageScopeFiles: {
        [`chat-image:${COUPLE_ID}`]: ["mine.jpg", "partner.jpg"],
      },
      ownedStorageObjects: [
        {
          bucket_id: "community-images",
          object_name: `${USER_ID}/owner-only.jpg`,
        },
        {
          bucket_id: "chat-image",
          object_name: `${COUPLE_ID}/mine.jpg`,
        },
      ],
    });

    await processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN);

    const saved = mock.getSavedInventory() as Array<{ bucket: string; prefix: string }>;
    expect(saved).not.toContainEqual({ bucket: "chat-image", prefix: COUPLE_ID });
    expect(mock.getRemovedStoragePaths()).toEqual(expect.arrayContaining([
      { bucket: "community-images", path: `${USER_ID}/owner-only.jpg` },
      { bucket: "chat-image", path: `${COUPLE_ID}/mine.jpg` },
    ]));
    expect(mock.getRemovedStoragePaths()).not.toContainEqual({
      bucket: "chat-image",
      path: `${COUPLE_ID}/partner.jpg`,
    });
    expect(mock.getStorageFiles("chat-image", COUPLE_ID)).toEqual(["partner.jpg"]);
    expect(mock.getOwnedStorageObjects()).toEqual([]);

    const inventoryRead = mock.events.indexOf(
      "rpc:list_account_deletion_owned_storage_objects",
    );
    const ownerRemove = mock.events.indexOf("storage:remove:chat-image");
    const ownerZeroRecheck = mock.events.lastIndexOf(
      "rpc:list_account_deletion_owned_storage_objects",
    );
    const leave = mock.events.indexOf("rpc:leave_amora_couple_safely");
    const cleanupReady = mock.events.indexOf(
      "rpc:mark_account_deletion_cleanup_ready",
    );
    const authDelete = mock.events.indexOf("auth:delete");
    expect(ownerRemove).toBeGreaterThan(inventoryRead);
    expect(ownerZeroRecheck).toBeGreaterThan(ownerRemove);
    expect(leave).toBeGreaterThan(ownerZeroRecheck);
    expect(cleanupReady).toBeGreaterThan(
      mock.events.lastIndexOf("rpc:redact_user_ai_data"),
    );
    expect(authDelete).toBeGreaterThan(cleanupReady);
  });

  it("fails before leaving when Storage API removal does not clear owner metadata", async () => {
    const mock = createMockAdmin({
      ownedStorageObjects: [{
        bucket_id: "chat-image",
        object_name: `${COUPLE_ID}/stuck.jpg`,
      }],
      retainOwnedStorageMetadata: true,
    });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "OWNED_STORAGE_NOT_QUIESCENT",
      });
    expect(mock.events).not.toContain("rpc:leave_amora_couple_safely");
    expect(mock.events).not.toContain("auth:delete");
  });

  it("never replays a legacy whole-chat prefix after exact owner provenance is available", async () => {
    const mock = createMockAdmin({
      storageScopeFiles: {
        [`chat-image:${COUPLE_ID}`]: ["mine.jpg", "partner.jpg"],
      },
      ownedStorageObjects: [{
        bucket_id: "chat-image",
        object_name: `${COUPLE_ID}/mine.jpg`,
      }],
    });
    const legacyJob = {
      ...BASE_JOB,
      storage_inventory: [{ bucket: "chat-image", prefix: COUPLE_ID }],
    };

    await processAccountDeletionJob(mock.admin, legacyJob, WORKER_TOKEN);

    expect(mock.events).not.toContain(`storage:list:chat-image:${COUPLE_ID}`);
    expect(mock.getStorageFiles("chat-image", COUPLE_ID)).toEqual(["partner.jpg"]);
    expect(mock.getRemovedStoragePaths()).toContainEqual({
      bucket: "chat-image",
      path: `${COUPLE_ID}/mine.jpg`,
    });
    expect(mock.getRemovedStoragePaths()).not.toContainEqual({
      bucket: "chat-image",
      path: `${COUPLE_ID}/partner.jpg`,
    });
  });

  it("pages and removes the complete bounded owner inventory in Storage API batches", async () => {
    const ownedStorageObjects = Array.from({ length: 501 }, (_, index) => ({
      bucket_id: "chat-image",
      object_name: `${COUPLE_ID}/owned-${String(index).padStart(3, "0")}.jpg`,
    }));
    const mock = createMockAdmin({ ownedStorageObjects });

    await processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN);

    const inventoryReads = mock.events.filter(
      (event) => event === "rpc:list_account_deletion_owned_storage_objects",
    );
    expect(inventoryReads).toHaveLength(3);
    expect(mock.getOwnedStorageObjects()).toEqual([]);
    expect(mock.getRemovedBatchSizes().every((size) => size <= 100)).toBe(true);
    expect(mock.getRemovedStoragePaths().filter(
      ({ bucket }) => bucket === "chat-image",
    )).toHaveLength(501);
  });

  it("does not delete Auth when the short cleanup-ready proof cannot be created", async () => {
    const mock = createMockAdmin({ cleanupReadyResult: false });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "AUTH_DELETE_READY_FAILED",
      });
    expect(mock.events).toContain("rpc:mark_account_deletion_cleanup_ready");
    expect(mock.events).not.toContain("auth:delete");
    expect(mock.events).not.toContain("rpc:complete_account_deletion_job");
  });

  it("deletes each bounded storage page before listing the next page", async () => {
    const storageFiles = Array.from(
      { length: 201 },
      (_, index) => `photo-${String(index).padStart(3, "0")}.jpg`,
    );
    const mock = createMockAdmin({ storageFiles });

    await processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN);

    const listEvent = `storage:list:community-images:${USER_ID}`;
    const listIndexes = mock.events
      .map((event, index) => event === listEvent ? index : -1)
      .filter((index) => index >= 0);
    const removeIndexes = mock.events
      .map((event, index) => event === "storage:remove:community-images" ? index : -1)
      .filter((index) => index >= 0);

    expect(removeIndexes).toHaveLength(3);
    expect(mock.getRemovedBatchSizes()).toEqual([100, 100, 1]);
    expect(listIndexes.length).toBeGreaterThan(3);
    expect(removeIndexes[0]).toBeLessThan(listIndexes[1]);
    expect(removeIndexes[1]).toBeLessThan(listIndexes[2]);
    expect(removeIndexes[2]).toBeLessThan(listIndexes[3]);
    expect(mock.getRemainingStorageFiles()).toEqual([]);
    expect(mock.events).toContain("rpc:complete_account_deletion_job");
  });

  it.each([
    ["preregistrations", "PREREGISTRATION_DELETE_FAILED"],
    ["research_cohort_applications", "RESEARCH_COHORT_APPLICATION_DELETE_FAILED"],
  ])("fails closed when deleting email-scoped application data from %s fails", async (
    table,
    expectedCode,
  ) => {
    const mock = createMockAdmin({
      deleteErrors: { [table]: { code: "database_error" } },
    });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: expectedCode,
      });
    expect(mock.events).not.toContain("auth:delete");
    expect(mock.events).not.toContain("rpc:complete_account_deletion_job");
  });

  it.each([
    ["preregistrations", "PREREGISTRATION_DELETE_VERIFY_FAILED"],
    ["research_cohort_applications", "RESEARCH_COHORT_APPLICATION_DELETE_VERIFY_FAILED"],
  ])("fails closed when email-scoped application data remains in %s", async (
    table,
    expectedCode,
  ) => {
    const mock = createMockAdmin({ remainingEmailRows: { [table]: 1 } });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: expectedCode,
      });
    expect(mock.events).not.toContain("auth:delete");
    expect(mock.events).not.toContain("rpc:complete_account_deletion_job");
  });

  it("fails closed when the research application deletion verification query fails", async () => {
    const mock = createMockAdmin({
      verificationErrors: {
        research_cohort_applications: { code: "database_error" },
      },
    });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "RESEARCH_COHORT_APPLICATION_DELETE_VERIFY_FAILED",
      });
    expect(mock.events).not.toContain("auth:delete");
    expect(mock.events).not.toContain("rpc:complete_account_deletion_job");
  });

  it("finishes an idempotent retry after auth deletion when a saved inventory exists", async () => {
    const mock = createMockAdmin({
      authMissing: true,
      profile: null,
    });
    const job = {
      ...BASE_JOB,
      storage_inventory: [{ bucket: "community-images", prefix: USER_ID }],
    };
    await processAccountDeletionJob(mock.admin, job, WORKER_TOKEN);

    expect(mock.fromCalls).not.toContain("guestbooks");
    expect(mock.fromCalls).not.toContain("invitations");
    expect(mock.events).toContain("db:snapshot-load");
    expect(mock.events).toContain("db:delete:preregistrations");
    expect(mock.events).toContain("db:delete:research_cohort_applications");
    expect(mock.events).toContain("auth:delete");
    expect(mock.events.at(-1)).toBe("rpc:complete_account_deletion_job");
  });

  it("fails closed when the durable email snapshot cannot be refreshed", async () => {
    const mock = createMockAdmin({
      authEmail: "new-address@example.com",
      snapshotSaveError: { code: "database_error" },
      allowedEmailScopes: ["delete-me@example.com", "new-address@example.com"],
    });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "EMAIL_SNAPSHOT_SAVE_FAILED",
      });
    expect(mock.events).not.toContain("auth:delete");
  });

  it("preserves an existing email scope when the auth provider omits email", async () => {
    const mock = createMockAdmin({ authEmail: null });

    await processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN);

    expect(mock.events).not.toContain("db:snapshot-save");
    expect(mock.events).toContain(
      "db:delete-scope:research_cohort_applications:delete-me@example.com"
    );
    expect(mock.events).toContain("auth:delete");
  });

  it("durably appends and deletes both old and current auth email scopes", async () => {
    const mock = createMockAdmin({
      authEmail: "new-address@example.com",
      allowedEmailScopes: ["delete-me@example.com", "new-address@example.com"],
    });

    await processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN);

    expect(mock.events).toContain("db:snapshot-save");
    for (const email of ["delete-me@example.com", "new-address@example.com"]) {
      expect(mock.events).toContain(
        `db:delete-scope:preregistrations:${email}`
      );
      expect(mock.events).toContain(
        `db:delete-scope:research_cohort_applications:${email}`
      );
    }
    expect(mock.events).toContain("auth:delete");
  });

  it("re-reads auth after storage cleanup and deletes a newly observed email scope", async () => {
    const mock = createMockAdmin({
      authEmailSequence: ["delete-me@example.com", "final-address@example.com"],
      allowedEmailScopes: ["delete-me@example.com", "final-address@example.com"],
    });

    await processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN);

    const authLookups = mock.events
      .map((event, index) => event === "auth:get" ? index : -1)
      .filter((index) => index >= 0);
    const finalAuthLookup = authLookups.at(-1)!;
    const finalSnapshotSave = mock.events.lastIndexOf("db:snapshot-save");
    const firstDirectDelete = mock.events.indexOf("rpc:leave_amora_couple_safely");

    expect(authLookups).toHaveLength(2);
    expect(finalAuthLookup).toBeGreaterThan(
      mock.events.lastIndexOf(`storage:list:community-images:${USER_ID}`),
    );
    expect(finalSnapshotSave).toBeGreaterThan(finalAuthLookup);
    expect(firstDirectDelete).toBeGreaterThan(finalSnapshotSave);
    for (const email of ["delete-me@example.com", "final-address@example.com"]) {
      expect(mock.events).toContain(`db:delete-scope:preregistrations:${email}`);
      expect(mock.events).toContain(
        `db:delete-scope:research_cohort_applications:${email}`,
      );
    }
    expect(mock.events.indexOf("auth:delete")).toBeGreaterThan(firstDirectDelete);
  });

  it("stops before destructive account removal when the worker lease cannot renew", async () => {
    const mock = createMockAdmin({ leaseRenewErrorAt: 2 });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "WORKER_LEASE_RENEW_FAILED",
      });
    expect(mock.events).not.toContain("db:delete:preregistrations");
    expect(mock.events).not.toContain("auth:delete");
  });

  it("aborts between a long storage listing page and its destructive remove batch when the lease is lost", async () => {
    const storageListEvent = `storage:list:community-images:${USER_ID}`;
    const mock = createMockAdmin({
      leaseRenewErrorAfterEvent: storageListEvent,
    });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "WORKER_LEASE_RENEW_FAILED",
      });
    expect(mock.events).toContain(storageListEvent);
    expect(mock.events).not.toContain("storage:remove:community-images");
    expect(mock.events).not.toContain("rpc:leave_amora_couple_safely");
    expect(mock.events).not.toContain("auth:delete");
  });

  it("aborts between direct-data phases when the lease is lost", async () => {
    const mock = createMockAdmin({
      leaseRenewErrorAfterEvent: "rpc:leave_amora_couple_safely",
    });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "WORKER_LEASE_RENEW_FAILED",
      });
    expect(mock.events).toContain("rpc:leave_amora_couple_safely");
    expect(mock.events).not.toContain("db:delete:chat_summaries");
    expect(mock.events).not.toContain("auth:delete");
  });

  it.each([
    [["Delete-Me@example.com"], "case-variant"],
    [[" delete-me@example.com"], "whitespace-variant"],
    [["delete-me@example.com", "delete-me@example.com"], "duplicate"],
    [["invalid@"], "invalid-shape"],
  ])("rejects a noncanonical durable email scope (%s)", async (snapshotScopes) => {
    const mock = createMockAdmin({
      authEmail: null,
      snapshotScopes,
    });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "EMAIL_SNAPSHOT_INVALID",
      });
    expect(mock.events).not.toContain("db:delete:preregistrations");
    expect(mock.events).not.toContain("auth:delete");
  });

  it("fails closed when an auth-missing retry has no durable email attestation", async () => {
    const mock = createMockAdmin({
      authMissing: true,
      profile: null,
      snapshotAt: null,
    });
    const job = {
      ...BASE_JOB,
      storage_inventory: [{ bucket: "community-images", prefix: USER_ID }],
    };

    await expect(processAccountDeletionJob(mock.admin, job, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "EMAIL_SNAPSHOT_LOAD_FAILED",
      });
    expect(mock.events).not.toContain("auth:delete");
    expect(mock.events).not.toContain("rpc:complete_account_deletion_job");
  });

  it("fails closed when auth ownership disappeared before any inventory snapshot", async () => {
    const mock = createMockAdmin({ authMissing: true, profile: null });

    await expect(processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN))
      .rejects.toMatchObject({
        name: AccountDeletionError.name,
        code: "SUBJECT_MISSING_BEFORE_INVENTORY",
      });
    expect(mock.events).not.toContain("auth:delete");
  });
});
