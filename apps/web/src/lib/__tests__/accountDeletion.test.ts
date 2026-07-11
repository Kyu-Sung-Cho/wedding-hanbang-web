import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AccountDeletionError,
  processAccountDeletionJob,
  type AccountDeletionJob,
} from "@/lib/accountDeletion";

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const COUPLE_ID = "223e4567-e89b-42d3-a456-426614174000";
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
  profile?: { couple_id: string | null; role: string | null } | null;
};

function createMockAdmin(options: MockAdminOptions = {}) {
  const events: string[] = [];
  const fromCalls: string[] = [];
  let savedInventory: unknown;
  const removedScopes = new Set<string>();

  function queryResult(table: string) {
    if (table === "guestbooks") return { data: [], error: null };
    return { data: null, error: null };
  }

  function from(table: string) {
    fromCalls.push(table);
    let deleting = false;
    const query = {
      select: () => query,
      delete: () => {
        deleting = true;
        events.push(`db:delete:${table}`);
        return query;
      },
      update: () => {
        events.push(`db:update:${table}`);
        return query;
      },
      eq: () => query,
      like: () => query,
      maybeSingle: async () => {
        if (table === "profiles") {
          return {
            data: options.profile === undefined
              ? { couple_id: COUPLE_ID, role: "bride" }
              : options.profile,
            error: null,
          };
        }
        if (table === "couples") {
          return { data: { bride_id: USER_ID, groom_id: null }, error: null };
        }
        return queryResult(table);
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(deleting ? { data: null, error: null } : queryResult(table))
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
      if (name === "complete_account_deletion_job") return { data: true, error: null };
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        list: async (directory: string) => {
          events.push(`storage:list:${bucket}:${directory}`);
          const scope = `${bucket}:${directory}`;
          if (bucket === "community-images" && directory === USER_ID && !removedScopes.has(scope)) {
            return {
              data: [{ id: "storage-object-id", name: "photo.jpg" }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
        remove: async (paths: string[]) => {
          events.push(`storage:remove:${bucket}`);
          for (const path of paths) {
            removedScopes.add(`${bucket}:${path.split("/").slice(0, -1).join("/")}`);
          }
          return { data: paths, error: null };
        },
      }),
    },
    auth: {
      admin: {
        getUserById: async () => {
          events.push("auth:get");
          if (options.authMissing) {
            return {
              data: { user: null },
              error: { status: 404, code: "user_not_found" },
            };
          }
          return {
            data: { user: { id: USER_ID, email: "delete-me@example.com" } },
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
  };
}

describe("processAccountDeletionJob", () => {
  it("persists inventory before storage purge, then leaves/redacts, deletes auth, and completes", async () => {
    const mock = createMockAdmin();

    await processAccountDeletionJob(mock.admin, BASE_JOB, WORKER_TOKEN);

    const saved = mock.getSavedInventory() as Array<{ bucket: string; prefix: string }>;
    expect(saved).toEqual(expect.arrayContaining([
      { bucket: "community-images", prefix: USER_ID },
      { bucket: "community-videos", prefix: USER_ID },
      { bucket: "chat-image", prefix: COUPLE_ID },
    ]));
    expect(mock.fromCalls).not.toContain("invitations");

    const inventorySave = mock.events.indexOf("rpc:save_account_deletion_storage_inventory");
    const storageRemove = mock.events.indexOf("storage:remove:community-images");
    const leave = mock.events.indexOf("rpc:leave_amora_couple_safely");
    const redact = mock.events.lastIndexOf("rpc:redact_user_ai_data");
    const authDelete = mock.events.indexOf("auth:delete");
    const complete = mock.events.indexOf("rpc:complete_account_deletion_job");

    expect(inventorySave).toBeGreaterThanOrEqual(0);
    expect(storageRemove).toBeGreaterThan(inventorySave);
    expect(leave).toBeGreaterThan(storageRemove);
    expect(redact).toBeGreaterThan(leave);
    expect(authDelete).toBeGreaterThan(redact);
    expect(complete).toBeGreaterThan(authDelete);
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
    expect(mock.events).toContain("auth:delete");
    expect(mock.events.at(-1)).toBe("rpc:complete_account_deletion_job");
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
