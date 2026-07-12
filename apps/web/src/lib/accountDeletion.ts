import type { SupabaseClient, User } from "@supabase/supabase-js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORAGE_PAGE_SIZE = 100;
const MAX_STORAGE_SCOPES = 500;
const MAX_DIRECTORIES_PER_SCOPE = 2_000;
const MAX_OBJECTS_PER_SCOPE = 20_000;
const MAX_STORAGE_DELETE_PASSES = 3;

export const ACCOUNT_DELETION_ALLOWED_REASONS = [
  "unsatisfied",
  "alternative",
  "wedding_done",
  "privacy",
  "low_usage",
  "other",
  "unknown",
] as const;

export type AccountDeletionReason = (typeof ACCOUNT_DELETION_ALLOWED_REASONS)[number];

const SAFE_STORAGE_BUCKETS = [
  "community-images",
  "community-videos",
  "guestbook-uploads",
  "chat-image",
] as const;

type SafeStorageBucket = (typeof SAFE_STORAGE_BUCKETS)[number];

export type AccountDeletionStorageScope = {
  bucket: SafeStorageBucket;
  prefix: string;
};

export type AccountDeletionJob = {
  job_id: string;
  user_id: string;
  reason: AccountDeletionReason;
  attempts: number;
  storage_inventory: unknown;
};

type DatabaseResult = {
  error: { code?: string; message?: string; status?: number } | null;
};

type LeaseHeartbeat = () => Promise<void>;

const EMAIL_SCOPED_APPLICATION_DELETION_TARGETS = [
  {
    table: "preregistrations",
    deleteFailureCode: "PREREGISTRATION_DELETE_FAILED",
    verifyFailureCode: "PREREGISTRATION_DELETE_VERIFY_FAILED",
  },
  {
    table: "research_cohort_applications",
    deleteFailureCode: "RESEARCH_COHORT_APPLICATION_DELETE_FAILED",
    verifyFailureCode: "RESEARCH_COHORT_APPLICATION_DELETE_VERIFY_FAILED",
  },
] as const;

export class AccountDeletionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AccountDeletionError";
    this.code = normalizeAccountDeletionErrorCode(code);
  }
}

export function normalizeAccountDeletionErrorCode(value: unknown): string {
  if (typeof value !== "string") return "UNEXPECTED_FAILURE";
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
  return /^[A-Z0-9_]{1,64}$/.test(normalized) ? normalized : "UNEXPECTED_FAILURE";
}

function fail(code: string): never {
  throw new AccountDeletionError(code);
}

async function must(code: string, operation: PromiseLike<DatabaseResult>): Promise<void> {
  const { error } = await operation;
  if (error) fail(code);
}

async function deleteAndVerifyEmailScopedApplicationData(
  admin: SupabaseClient,
  emails: readonly string[],
  renewLease: LeaseHeartbeat,
): Promise<void> {
  // Each DELETE is an atomic Postgres statement. The durable job is not
  // completed until every target is deleted and independently observed empty,
  // so a partial network/database failure is safe to retry idempotently.
  for (const email of emails) {
    for (const target of EMAIL_SCOPED_APPLICATION_DELETION_TARGETS) {
      await renewLease();
      await must(
        target.deleteFailureCode,
        admin.from(target.table).delete().eq("email", email),
      );
    }
  }

  for (const email of emails) {
    for (const target of EMAIL_SCOPED_APPLICATION_DELETION_TARGETS) {
      await renewLease();
      const { count, error } = await admin
        .from(target.table)
        .select("id", { count: "exact", head: true })
        .eq("email", email);
      if (error || count !== 0) fail(target.verifyFailureCode);
    }
  }
}

function isMissingAuthUser(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 404 || candidate.code === "user_not_found";
}

function parseStorageInventory(value: unknown): AccountDeletionStorageScope[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > MAX_STORAGE_SCOPES) {
    fail("STORAGE_INVENTORY_INVALID");
  }

  const allowedBuckets = new Set<string>(SAFE_STORAGE_BUCKETS);
  const seen = new Set<string>();
  const scopes: AccountDeletionStorageScope[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail("STORAGE_INVENTORY_INVALID");
    }
    const record = item as Record<string, unknown>;
    if (Object.keys(record).length !== 2
      || typeof record.bucket !== "string"
      || !allowedBuckets.has(record.bucket)
      || typeof record.prefix !== "string"
      || !UUID_PATTERN.test(record.prefix)) {
      fail("STORAGE_INVENTORY_INVALID");
    }

    const key = `${record.bucket}:${record.prefix}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({
      bucket: record.bucket as SafeStorageBucket,
      prefix: record.prefix,
    });
  }

  return scopes;
}

async function loadCurrentMembership(admin: SupabaseClient, userId: string): Promise<{
  coupleId: string | null;
  role: string | null;
}> {
  const { data, error } = await admin
    .from("profiles")
    .select("couple_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) fail("PROFILE_INVENTORY_FAILED");

  const coupleId = typeof data?.couple_id === "string" && UUID_PATTERN.test(data.couple_id)
    ? data.couple_id
    : null;
  return {
    coupleId,
    role: typeof data?.role === "string" ? data.role : null,
  };
}

async function collectSafeStorageInventory(
  admin: SupabaseClient,
  userId: string,
  membership: { coupleId: string | null; role: string | null },
): Promise<AccountDeletionStorageScope[]> {
  const scopes: AccountDeletionStorageScope[] = [
    { bucket: "community-images", prefix: userId },
    { bucket: "community-videos", prefix: userId },
  ];

  const { data: guestbooks, error: guestbooksError } = await admin
    .from("guestbooks")
    .select("id")
    .eq("owner_id", userId);
  if (guestbooksError) fail("GUESTBOOK_INVENTORY_FAILED");
  for (const guestbook of guestbooks ?? []) {
    if (typeof guestbook.id !== "string" || !UUID_PATTERN.test(guestbook.id)) {
      fail("GUESTBOOK_INVENTORY_INVALID");
    }
    scopes.push({ bucket: "guestbook-uploads", prefix: guestbook.id });
  }

  if (membership.coupleId && (membership.role === "bride" || membership.role === "groom")) {
    const { data: couple, error: coupleError } = await admin
      .from("couples")
      .select("bride_id, groom_id")
      .eq("id", membership.coupleId)
      .maybeSingle();
    if (coupleError) fail("COUPLE_INVENTORY_FAILED");

    const ownsSlot = membership.role === "bride"
      ? couple?.bride_id === userId
      : couple?.groom_id === userId;
    const partnerId = membership.role === "bride" ? couple?.groom_id : couple?.bride_id;
    const isSoleOwner = ownsSlot && partnerId === null;

    // A couple with another member is shared. No chat object is deleted in
    // that case because historical objects have no per-author provenance.
    if (isSoleOwner) {
      scopes.push({ bucket: "chat-image", prefix: membership.coupleId });
    }
  }

  return parseStorageInventory(scopes) ?? [];
}

function assertSafeStorageEntryName(name: unknown): asserts name is string {
  if (typeof name !== "string"
    || name.length === 0
    || name.length > 255
    || name === "."
    || name === ".."
    || name.includes("/")
    || name.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(name)) {
    fail("STORAGE_ENTRY_INVALID");
  }
}

async function deleteStorageObjectsPass(
  admin: SupabaseClient,
  scope: AccountDeletionStorageScope,
  renewLease: LeaseHeartbeat,
): Promise<number> {
  const pendingDirectories = [scope.prefix];
  const scheduledDirectories = new Set(pendingDirectories);
  const visitedDirectories = new Set<string>();
  const attemptedFiles = new Set<string>();
  let removedObjects = 0;

  while (pendingDirectories.length > 0) {
    if (visitedDirectories.size >= MAX_DIRECTORIES_PER_SCOPE) {
      fail("STORAGE_DIRECTORY_LIMIT");
    }
    // Depth-first traversal reaches a real object quickly even when the root
    // contains only virtual folders. Every successful remove is durable
    // progress if the serverless invocation is terminated later.
    const directory = pendingDirectories.pop()!;
    if (visitedDirectories.has(directory)) continue;
    visitedDirectories.add(directory);

    let offset = 0;
    while (true) {
      await renewLease();
      const { data, error } = await admin.storage.from(scope.bucket).list(directory, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) fail("STORAGE_LIST_FAILED");

      const entries = data ?? [];
      const files: string[] = [];
      let persistentDirectoryEntries = 0;
      for (const entry of entries) {
        assertSafeStorageEntryName(entry.name);
        const path = `${directory}/${entry.name}`;
        if (typeof entry.id === "string" && entry.id.length > 0) {
          if (attemptedFiles.has(path)) fail("STORAGE_REMOVE_UNCONFIRMED");
          attemptedFiles.add(path);
          files.push(path);
        } else {
          persistentDirectoryEntries += 1;
          if (!scheduledDirectories.has(path)) {
            if (scheduledDirectories.size >= MAX_DIRECTORIES_PER_SCOPE) {
              fail("STORAGE_DIRECTORY_LIMIT");
            }
            scheduledDirectories.add(path);
            pendingDirectories.push(path);
          }
        }
      }

      if (removedObjects + files.length > MAX_OBJECTS_PER_SCOPE) {
        fail("STORAGE_OBJECT_LIMIT");
      }
      if (files.length > 0) {
        // Do not build an invocation-sized inventory. Delete this bounded page
        // before asking storage for another page so a hard timeout cannot erase
        // all progress. Directory entries persist while files shift left, hence
        // only persistent directories advance the next offset.
        await renewLease();
        const { error: removeError } = await admin.storage
          .from(scope.bucket)
          .remove(files);
        if (removeError) fail("STORAGE_REMOVE_FAILED");
        removedObjects += files.length;
      }

      if (entries.length < STORAGE_PAGE_SIZE) break;
      offset += persistentDirectoryEntries;
    }
  }

  return removedObjects;
}

async function storageScopeHasObjects(
  admin: SupabaseClient,
  scope: AccountDeletionStorageScope,
  renewLease: LeaseHeartbeat,
): Promise<boolean> {
  const pendingDirectories = [scope.prefix];
  const scheduledDirectories = new Set(pendingDirectories);
  const visitedDirectories = new Set<string>();

  while (pendingDirectories.length > 0) {
    if (visitedDirectories.size >= MAX_DIRECTORIES_PER_SCOPE) {
      fail("STORAGE_DIRECTORY_LIMIT");
    }
    const directory = pendingDirectories.pop()!;
    if (visitedDirectories.has(directory)) continue;
    visitedDirectories.add(directory);

    let offset = 0;
    while (true) {
      await renewLease();
      const { data, error } = await admin.storage.from(scope.bucket).list(directory, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) fail("STORAGE_LIST_FAILED");

      const entries = data ?? [];
      for (const entry of entries) {
        assertSafeStorageEntryName(entry.name);
        if (typeof entry.id === "string" && entry.id.length > 0) return true;
        const path = `${directory}/${entry.name}`;
        if (!scheduledDirectories.has(path)) {
          if (scheduledDirectories.size >= MAX_DIRECTORIES_PER_SCOPE) {
            fail("STORAGE_DIRECTORY_LIMIT");
          }
          scheduledDirectories.add(path);
          pendingDirectories.push(path);
        }
      }
      if (entries.length < STORAGE_PAGE_SIZE) break;
      offset += entries.length;
    }
  }

  return false;
}

async function removeOwnedStorageScope(
  admin: SupabaseClient,
  scope: AccountDeletionStorageScope,
  renewLease: LeaseHeartbeat,
): Promise<void> {
  for (let pass = 0; pass < MAX_STORAGE_DELETE_PASSES; pass++) {
    const removedObjects = await deleteStorageObjectsPass(admin, scope, renewLease);
    if (removedObjects === 0) return;
  }

  if (await storageScopeHasObjects(admin, scope, renewLease)) {
    fail("STORAGE_NOT_QUIESCENT");
  }
}

async function loadAuthUser(admin: SupabaseClient, userId: string): Promise<User | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error && !isMissingAuthUser(error)) fail("AUTH_LOOKUP_FAILED");
  return data?.user ?? null;
}

function normalizedDeletionEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail("EMAIL_SNAPSHOT_INVALID");
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3
    || normalized.length > 320
    || !/^[^\s@]+@[^\s@]+$/.test(normalized)
  ) {
    fail("EMAIL_SNAPSHOT_INVALID");
  }
  return normalized;
}

async function resolveDurableDeletionEmails(
  admin: SupabaseClient,
  job: AccountDeletionJob,
  workerToken: string,
  authUser: User | null,
): Promise<string[]> {
  const observedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("account_deletion_jobs")
    .select("email_scopes, email_snapshot_at")
    .eq("id", job.job_id)
    .eq("status", "processing")
    .eq("lock_token", workerToken)
    .gt("locked_until", observedAt)
    .maybeSingle();
  if (error || !data?.email_snapshot_at) fail("EMAIL_SNAPSHOT_LOAD_FAILED");
  const snapshotTime = Date.parse(data.email_snapshot_at);
  if (!Number.isFinite(snapshotTime)) fail("EMAIL_SNAPSHOT_INVALID");
  if (!Array.isArray(data.email_scopes) || data.email_scopes.length > 8) {
    fail("EMAIL_SNAPSHOT_INVALID");
  }

  const emailScopes = data.email_scopes.map((scope: unknown) => {
    const normalized = normalizedDeletionEmail(scope);
    if (!normalized || scope !== normalized) fail("EMAIL_SNAPSHOT_INVALID");
    return normalized;
  });
  const uniqueScopes = [...new Set(emailScopes)].sort();
  if (uniqueScopes.length !== emailScopes.length) fail("EMAIL_SNAPSHOT_INVALID");

  const currentAuthEmail = authUser
    ? normalizedDeletionEmail(authUser.email)
    : null;
  if (currentAuthEmail && !uniqueScopes.includes(currentAuthEmail)) {
    const extendedScopes = [...uniqueScopes, currentAuthEmail].sort();
    if (extendedScopes.length > 8) fail("EMAIL_SNAPSHOT_LIMIT");
    const capturedAt = new Date().toISOString();
    const { data: saved, error: saveError } = await admin
      .from("account_deletion_jobs")
      .update({ email_scopes: extendedScopes, email_snapshot_at: capturedAt })
      .eq("id", job.job_id)
      .eq("status", "processing")
      .eq("lock_token", workerToken)
      .gt("locked_until", capturedAt)
      .select("id")
      .maybeSingle();
    if (saveError || saved?.id !== job.job_id) fail("EMAIL_SNAPSHOT_SAVE_FAILED");
    return extendedScopes;
  }

  return uniqueScopes;
}

async function renewDeletionLease(
  admin: SupabaseClient,
  jobId: string,
  workerToken: string,
): Promise<void> {
  const { data, error } = await admin.rpc(
    "renew_account_deletion_job_lease",
    {
      p_job_id: jobId,
      p_worker_token: workerToken,
      p_lease_seconds: 600,
    },
  );
  if (error || data !== true) fail("WORKER_LEASE_RENEW_FAILED");
}

async function deleteAuthUser(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (!error || isMissingAuthUser(error)) return;

  // The network may fail after GoTrue committed the deletion. Confirm the
  // outcome before scheduling another destructive pass.
  const { data: confirmation, error: confirmationError } = await admin.auth.admin.getUserById(userId);
  if (confirmationError && isMissingAuthUser(confirmationError)) return;
  if (!confirmation?.user && !confirmationError) return;
  fail("AUTH_DELETE_FAILED");
}

async function assertProviderLeasesDrained(
  admin: SupabaseClient,
  userId: string,
  coupleId: string | null,
): Promise<void> {
  const { data: userLeaseCount, error: userLeaseError } = await admin.rpc(
    "count_active_amora_provider_leases",
    { p_user_id: userId },
  );
  if (userLeaseError) fail("USER_LEASE_CHECK_FAILED");

  let coupleLeaseCount = 0;
  if (coupleId) {
    const { data, error } = await admin.rpc("count_active_amora_couple_provider_leases", {
      p_couple_id: coupleId,
    });
    if (error) fail("COUPLE_LEASE_CHECK_FAILED");
    coupleLeaseCount = Number(data ?? 0);
  }

  if (Number(userLeaseCount ?? 0) > 0 || coupleLeaseCount > 0) {
    fail("ACTIVE_PROVIDER_LEASES");
  }

  // Upload reservation and account-deletion marker both lock the profile row
  // when they start. Once deletion wins, no new reservation can be created;
  // wait only for the bounded lease of an already-started upload.
  const { data: uploadLeaseCount, error: uploadLeaseError } = await admin.rpc(
    "count_active_community_upload_leases",
    { p_user_id: userId },
  );
  if (uploadLeaseError) fail("UPLOAD_LEASE_CHECK_FAILED");
  if (Number(uploadLeaseCount ?? 0) > 0) fail("ACTIVE_UPLOAD_LEASES");
}

async function deleteDirectUserData(
  admin: SupabaseClient,
  userId: string,
  emails: readonly string[],
  renewLease: LeaseHeartbeat,
): Promise<void> {
  const runPhase = async (
    code: string,
    operation: () => PromiseLike<DatabaseResult>,
  ) => {
    // Database statements are individually atomic, but the whole deletion is
    // not one transaction. Prove worker ownership before every side effect.
    await renewLease();
    await must(code, operation());
  };

  await runPhase("AMORA_LEAVE_FAILED", () => admin.rpc("leave_amora_couple_safely", {
    p_user_id: userId,
    p_mode: "account_delete",
  }));

  await runPhase("CHAT_SUMMARIES_DELETE_FAILED", () => admin.from("chat_summaries").delete().eq("user_id", userId));
  await runPhase("CHAT_FEEDBACK_DELETE_FAILED", () => admin.from("chat_feedback").delete().eq("user_id", userId));
  await runPhase("SEARCH_LOGS_DELETE_FAILED", () => admin.from("search_logs").delete().eq("user_id", userId));
  await runPhase("VENDOR_PHOTO_LIKES_DELETE_FAILED", () => admin.from("vendor_photo_likes").delete().eq("user_id", userId));
  await runPhase("CUSTOMER_EVENTS_DELETE_FAILED", () => admin.from("customer_events").delete().eq("user_id", userId));
  await runPhase("QUOTE_CHECKS_DELETE_FAILED", () => admin.from("amora_quote_checks").delete().eq("user_id", userId));
  await runPhase("CHAT_MESSAGES_DELETE_FAILED", () => admin.from("chat_messages").delete().eq("sender_id", userId));
  await runPhase("VENDOR_REVIEWS_DELETE_FAILED", () => admin.from("vendor_reviews").delete().eq("customer_id", userId));
  await runPhase("VENDOR_VIEWS_DELETE_FAILED", () => admin.from("vendor_views").delete().eq("viewer_id", userId));
  await runPhase("RATE_LIMIT_DELETE_FAILED", () => admin
    .from("rate_limit_buckets")
    .delete()
    .eq("subject_user_id", userId));
  await runPhase("LEGACY_DELETION_USER_SCRUB_FAILED", () => admin
    .from("account_deletions")
    .update({ user_id: null, email: null, reason: "unknown" })
    .eq("user_id", userId));
  for (const email of emails) {
    await runPhase("LEGACY_DELETION_EMAIL_SCRUB_FAILED", () => admin
      .from("account_deletions")
      .update({ user_id: null, email: null, reason: "unknown" })
      .eq("email", email));
  }
  await deleteAndVerifyEmailScopedApplicationData(admin, emails, renewLease);
  await runPhase("AI_REDACTION_FAILED", () => admin.rpc(
    "redact_user_ai_data",
    { p_user_id: userId },
  ));
}

export async function processAccountDeletionJob(
  admin: SupabaseClient,
  job: AccountDeletionJob,
  workerToken: string,
): Promise<void> {
  if (!UUID_PATTERN.test(job.job_id)
    || !UUID_PATTERN.test(job.user_id)
    || !UUID_PATTERN.test(workerToken)) {
    fail("JOB_PAYLOAD_INVALID");
  }

  const authUser = await loadAuthUser(admin, job.user_id);
  let inventory = parseStorageInventory(job.storage_inventory);
  if (!authUser && inventory === null) {
    // An externally deleted auth row erased ownership joins before this worker
    // could snapshot them. Guessing guestbook/chat prefixes could delete
    // shared data, so require operator reconciliation instead.
    fail("SUBJECT_MISSING_BEFORE_INVENTORY");
  }
  await renewDeletionLease(admin, job.job_id, workerToken);
  const renewLease = () => renewDeletionLease(admin, job.job_id, workerToken);
  const deletionEmails = await resolveDurableDeletionEmails(
    admin,
    job,
    workerToken,
    authUser,
  );

  const membership = await loadCurrentMembership(admin, job.user_id);
  await assertProviderLeasesDrained(admin, job.user_id, membership.coupleId);

  if (inventory === null) {
    inventory = await collectSafeStorageInventory(admin, job.user_id, membership);
    const { data: saved, error } = await admin.rpc(
      "save_account_deletion_storage_inventory",
      {
        p_job_id: job.job_id,
        p_worker_token: workerToken,
        p_inventory: inventory,
      },
    );
    if (error || saved !== true) fail("STORAGE_INVENTORY_SAVE_FAILED");
  }

  await renewDeletionLease(admin, job.job_id, workerToken);
  for (const scope of inventory) {
    await removeOwnedStorageScope(admin, scope, renewLease);
  }

  await renewDeletionLease(admin, job.job_id, workerToken);
  await deleteDirectUserData(admin, job.user_id, deletionEmails, renewLease);
  await renewDeletionLease(admin, job.job_id, workerToken);
  await deleteAuthUser(admin, job.user_id);

  const { data: completed, error: completionError } = await admin.rpc(
    "complete_account_deletion_job",
    { p_job_id: job.job_id, p_worker_token: workerToken },
  );
  if (completionError || completed !== true) fail("JOB_COMPLETION_FAILED");
}
