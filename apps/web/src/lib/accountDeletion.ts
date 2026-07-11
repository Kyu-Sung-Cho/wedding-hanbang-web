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

async function discoverStorageObjects(
  admin: SupabaseClient,
  scope: AccountDeletionStorageScope,
): Promise<string[]> {
  const pendingDirectories = [scope.prefix];
  const visitedDirectories = new Set<string>();
  const files: string[] = [];

  while (pendingDirectories.length > 0) {
    if (visitedDirectories.size >= MAX_DIRECTORIES_PER_SCOPE) {
      fail("STORAGE_DIRECTORY_LIMIT");
    }
    const directory = pendingDirectories.shift()!;
    if (visitedDirectories.has(directory)) continue;
    visitedDirectories.add(directory);

    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(scope.bucket).list(directory, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) fail("STORAGE_LIST_FAILED");

      const entries = data ?? [];
      for (const entry of entries) {
        assertSafeStorageEntryName(entry.name);
        const path = `${directory}/${entry.name}`;
        if (typeof entry.id === "string" && entry.id.length > 0) {
          files.push(path);
          if (files.length > MAX_OBJECTS_PER_SCOPE) fail("STORAGE_OBJECT_LIMIT");
        } else {
          pendingDirectories.push(path);
        }
      }

      if (entries.length < STORAGE_PAGE_SIZE) break;
      offset += entries.length;
    }
  }

  return files;
}

async function removeOwnedStorageScope(
  admin: SupabaseClient,
  scope: AccountDeletionStorageScope,
): Promise<void> {
  for (let pass = 0; pass < MAX_STORAGE_DELETE_PASSES; pass++) {
    const files = await discoverStorageObjects(admin, scope);
    if (files.length === 0) return;

    for (let index = 0; index < files.length; index += STORAGE_PAGE_SIZE) {
      const { error } = await admin.storage
        .from(scope.bucket)
        .remove(files.slice(index, index + STORAGE_PAGE_SIZE));
      if (error) fail("STORAGE_REMOVE_FAILED");
    }
  }

  if ((await discoverStorageObjects(admin, scope)).length > 0) {
    fail("STORAGE_NOT_QUIESCENT");
  }
}

async function loadAuthUser(admin: SupabaseClient, userId: string): Promise<User | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error && !isMissingAuthUser(error)) fail("AUTH_LOOKUP_FAILED");
  return data?.user ?? null;
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
  email: string | undefined,
): Promise<void> {
  await must("AMORA_LEAVE_FAILED", admin.rpc("leave_amora_couple_safely", {
    p_user_id: userId,
    p_mode: "account_delete",
  }));

  await must("CHAT_SUMMARIES_DELETE_FAILED", admin.from("chat_summaries").delete().eq("user_id", userId));
  await must("CHAT_FEEDBACK_DELETE_FAILED", admin.from("chat_feedback").delete().eq("user_id", userId));
  await must("SEARCH_LOGS_DELETE_FAILED", admin.from("search_logs").delete().eq("user_id", userId));
  await must("VENDOR_PHOTO_LIKES_DELETE_FAILED", admin.from("vendor_photo_likes").delete().eq("user_id", userId));
  await must("CUSTOMER_EVENTS_DELETE_FAILED", admin.from("customer_events").delete().eq("user_id", userId));
  await must("QUOTE_CHECKS_DELETE_FAILED", admin.from("amora_quote_checks").delete().eq("user_id", userId));
  await must("CHAT_MESSAGES_DELETE_FAILED", admin.from("chat_messages").delete().eq("sender_id", userId));
  await must("VENDOR_REVIEWS_DELETE_FAILED", admin.from("vendor_reviews").delete().eq("customer_id", userId));
  await must("VENDOR_VIEWS_DELETE_FAILED", admin.from("vendor_views").delete().eq("viewer_id", userId));
  await must("RATE_LIMIT_DELETE_FAILED", admin
    .from("rate_limit_buckets")
    .delete()
    .eq("subject_user_id", userId));
  await must("LEGACY_DELETION_USER_SCRUB_FAILED", admin
    .from("account_deletions")
    .update({ user_id: null, email: null, reason: "unknown" })
    .eq("user_id", userId));
  if (email) {
    await must("LEGACY_DELETION_EMAIL_SCRUB_FAILED", admin
      .from("account_deletions")
      .update({ user_id: null, email: null, reason: "unknown" })
      .eq("email", email));
    await must("PREREGISTRATION_DELETE_FAILED", admin.from("preregistrations").delete().eq("email", email));
  }
  await must("AI_REDACTION_FAILED", admin.rpc("redact_user_ai_data", { p_user_id: userId }));
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

  for (const scope of inventory) {
    await removeOwnedStorageScope(admin, scope);
  }

  await deleteDirectUserData(admin, job.user_id, authUser?.email);
  await deleteAuthUser(admin, job.user_id);

  const { data: completed, error: completionError } = await admin.rpc(
    "complete_account_deletion_job",
    { p_job_id: job.job_id, p_worker_token: workerToken },
  );
  if (completionError || completed !== true) fail("JOB_COMPLETION_FAILED");
}
