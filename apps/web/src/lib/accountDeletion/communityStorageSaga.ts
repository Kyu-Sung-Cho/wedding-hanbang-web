import type { SupabaseClient } from "@supabase/supabase-js";

export const COMMUNITY_DELETION_BUCKETS = [
  "community-media-staging",
  "community-images",
  "community-videos",
] as const;

export const ACCOUNT_DELETION_BUCKETS = [
  ...COMMUNITY_DELETION_BUCKETS,
  "profile-avatars",
  "chat-image",
  "provider-portfolio",
] as const;
const DELETABLE_BUCKETS = [...COMMUNITY_DELETION_BUCKETS, "profile-avatars"] as const;
const AUTOMATIC_DELETION_BUCKETS = [...DELETABLE_BUCKETS, "provider-portfolio"] as const;

export type CommunityDeletionBucket = typeof COMMUNITY_DELETION_BUCKETS[number];
export type AccountDeletionBucket = typeof ACCOUNT_DELETION_BUCKETS[number];
export type CommunityDeletionSource =
  | "session_staging"
  | "session_final"
  | "legacy_prefix"
  | "profile_avatar"
  | "provider_portfolio"
  | "quarantine";

export interface CommunityDeletionSession {
  id: string;
  user_id: string;
  staging_path: string;
  final_bucket: string;
  final_path: string;
  expires_at: string;
}

export interface CommunityDeletionManifestEntry {
  bucket: AccountDeletionBucket;
  path: string;
  source: CommunityDeletionSource;
  not_before: string;
}

export class AccountDeletionStorageError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AccountDeletionStorageError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|gif|webp)$/i;
const LEGACY_IMAGE_RE = /^[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/i;
const LEGACY_VIDEO_RE = /^[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|mov|webm)$/i;
const CHAT_IMAGE_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)$/;
const PROVIDER_IMAGE_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const SAFE_LISTED_NAME_RE = /^[^/\\\u0000-\u001f\u007f]{1,400}$/;
const SIGNED_TOKEN_GRACE_MS = 5 * 60 * 1000;
const PROVIDER_UPLOAD_GRACE_MS = 35 * 60 * 1000;
const DATABASE_TIMESTAMP_PRECISION_MARGIN_MS = 1000;
const INVENTORY_PAGE_SIZE = 100;
const INVENTORY_MAX_OBJECTS = 10_000;
const CHAT_IMAGE_MAX_COUPLE_FOLDERS = 1_000;
const CHAT_IMAGE_MAX_LIST_PAGES = 1_111;
const SESSION_PAGE_SIZE = 500;
const INVENTORY_MAX_SESSIONS = 10_000;
const MANIFEST_PAGE_SIZE = 500;
const DELETE_BATCH_SIZE = 100;
const MAX_DELETIONS_PER_RUN = 20;
const CLAIM_STALE_MS = 15 * 60 * 1000;
const ACCOUNT_DELETION_REASON_CODES = new Set([
  "unknown",
  "unsatisfied",
  "alternative",
  "wedding_done",
  "privacy",
  "low_usage",
  "other",
  "mobile_request",
]);

export type AccountDeletionJobStatus =
  | "inventorying"
  | "inventory_ready"
  | "deleting"
  | "auth_deleting"
  | "manual_review"
  | "completed";

export interface AccountDeletionJob {
  id: string;
  user_id: string | null;
  status: AccountDeletionJobStatus;
  ready_after: string | null;
  quarantine_count: number;
  claim_token: string | null;
}

export interface AccountDeletionManifestRow extends CommunityDeletionManifestEntry {
  job_id: string;
  cleaned_at: string | null;
}

export type AccountDeletionProcessResult = {
  status: "completed" | "pending" | "manual_review" | "retry";
};

function manifestKey(bucket: AccountDeletionBucket, path: string) {
  return `${bucket}\u0000${path}`;
}

function assertSafeListedName(name: string) {
  if (!SAFE_LISTED_NAME_RE.test(name) || name === "." || name === "..") {
    throw new AccountDeletionStorageError("unsafe_inventory_name");
  }
}

function assertSessionContract(
  session: CommunityDeletionSession,
  userId: string,
): { notBefore: string } {
  const expiresAt = Date.parse(session.expires_at);
  const stagingParts = session.staging_path.split("/");
  const fileMatch = stagingParts.length === 2
    ? stagingParts[1].match(SESSION_FILE_RE)
    : null;
  if (!UUID_RE.test(userId)
      || session.user_id !== userId
      || !UUID_RE.test(session.id)
      || stagingParts[0] !== userId
      || !fileMatch
      || fileMatch[1].toLowerCase() !== session.id.toLowerCase()
      || session.final_bucket !== "community-images"
      || session.final_path !== session.staging_path
      || !Number.isFinite(expiresAt)) {
    throw new AccountDeletionStorageError("session_contract_invalid");
  }
  return { notBefore: new Date(expiresAt + SIGNED_TOKEN_GRACE_MS).toISOString() };
}

export function buildCommunityDeletionManifest(input: {
  userId: string;
  sessions: CommunityDeletionSession[];
  listedNames: Record<CommunityDeletionBucket, string[]>;
  now?: number;
}): CommunityDeletionManifestEntry[] {
  if (!UUID_RE.test(input.userId) || !Number.isFinite(input.now ?? Date.now())) {
    throw new AccountDeletionStorageError("inventory_input_invalid");
  }
  const entries = new Map<string, CommunityDeletionManifestEntry>();
  for (const session of input.sessions) {
    const { notBefore } = assertSessionContract(session, input.userId);
    const sessionEntries: CommunityDeletionManifestEntry[] = [
      {
        bucket: "community-media-staging",
        path: session.staging_path,
        source: "session_staging",
        not_before: notBefore,
      },
      {
        bucket: "community-images",
        path: session.final_path,
        source: "session_final",
        not_before: notBefore,
      },
    ];
    for (const entry of sessionEntries) {
      entries.set(manifestKey(entry.bucket, entry.path), entry);
    }
  }

  const inventoryTime = new Date(input.now ?? Date.now()).toISOString();
  for (const bucket of COMMUNITY_DELETION_BUCKETS) {
    const names = input.listedNames[bucket];
    if (!Array.isArray(names)) {
      throw new AccountDeletionStorageError("inventory_input_invalid");
    }
    for (const name of names) {
      if (typeof name !== "string") {
        throw new AccountDeletionStorageError("unsafe_inventory_name");
      }
      assertSafeListedName(name);
      const path = `${input.userId}/${name}`;
      const key = manifestKey(bucket, path);
      if (entries.has(key)) continue;

      const legacy = bucket === "community-images"
        ? LEGACY_IMAGE_RE.test(name)
        : bucket === "community-videos" && LEGACY_VIDEO_RE.test(name);
      entries.set(key, {
        bucket,
        path,
        source: legacy ? "legacy_prefix" : "quarantine",
        not_before: inventoryTime,
      });
    }
  }

  if (entries.size > INVENTORY_MAX_OBJECTS) {
    throw new AccountDeletionStorageError("manifest_inventory_limit_exceeded");
  }

  return [...entries.values()].sort((left, right) =>
    left.bucket.localeCompare(right.bucket) || left.path.localeCompare(right.path)
  );
}

function isCommunityDeletionSession(value: unknown): value is CommunityDeletionSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.user_id === "string"
    && typeof row.staging_path === "string"
    && typeof row.final_bucket === "string"
    && typeof row.final_path === "string"
    && typeof row.expires_at === "string";
}

async function listExactUserPrefix(
  admin: SupabaseClient,
  bucket: typeof AUTOMATIC_DELETION_BUCKETS[number],
  userId: string,
  entryKind?: "folder" | "file",
): Promise<string[]> {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += INVENTORY_PAGE_SIZE) {
    if (offset >= INVENTORY_MAX_OBJECTS) {
      const { data, error } = await admin.storage.from(bucket).list(userId, {
        limit: 1,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error || !Array.isArray(data)) {
        throw new AccountDeletionStorageError("storage_inventory_unavailable");
      }
      if (data.length > 0) {
        throw new AccountDeletionStorageError("storage_inventory_limit_exceeded");
      }
      break;
    }
    const { data, error } = await admin.storage.from(bucket).list(userId, {
      limit: INVENTORY_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error || !Array.isArray(data)) {
      throw new AccountDeletionStorageError("storage_inventory_unavailable");
    }
    if (data.length > INVENTORY_PAGE_SIZE) {
      throw new AccountDeletionStorageError("storage_inventory_malformed");
    }
    for (const item of data) {
      if (!item || typeof item.name !== "string") {
        throw new AccountDeletionStorageError("storage_inventory_malformed");
      }
      if ((entryKind === "folder" && item.id !== null)
        || (entryKind === "file" && (typeof item.id !== "string" || !UUID_RE.test(item.id)))) {
        throw new AccountDeletionStorageError("provider_inventory_invalid");
      }
      assertSafeListedName(item.name);
      if (seen.has(item.name)) {
        throw new AccountDeletionStorageError("storage_inventory_malformed");
      }
      seen.add(item.name);
      names.push(item.name);
    }
    if (data.length < INVENTORY_PAGE_SIZE) break;
  }
  return names;
}

async function listDurableSessions(
  admin: SupabaseClient,
  userId: string,
): Promise<CommunityDeletionSession[]> {
  const sessions: CommunityDeletionSession[] = [];
  for (let offset = 0; ; offset += SESSION_PAGE_SIZE) {
    if (offset >= INVENTORY_MAX_SESSIONS) {
      const { data, error } = await admin
        .from("community_upload_sessions")
        .select("id")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(offset, offset);
      if (error || !Array.isArray(data)) {
        throw new AccountDeletionStorageError("session_inventory_unavailable");
      }
      if (data.length > 0) {
        throw new AccountDeletionStorageError("session_inventory_limit_exceeded");
      }
      break;
    }
    const { data, error } = await admin
      .from("community_upload_sessions")
      .select("id,user_id,staging_path,final_bucket,final_path,expires_at")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(offset, offset + SESSION_PAGE_SIZE - 1);
    if (error || !Array.isArray(data)
        || data.some((row) => !isCommunityDeletionSession(row))) {
      throw new AccountDeletionStorageError("session_inventory_unavailable");
    }
    sessions.push(...data as CommunityDeletionSession[]);
    if (data.length < SESSION_PAGE_SIZE) break;
  }
  return sessions;
}

async function inventoryChatImageQuarantine(
  admin: SupabaseClient,
  userId: string,
  now: number,
): Promise<CommunityDeletionManifestEntry[]> {
  if (!UUID_RE.test(userId) || !Number.isFinite(now)) {
    throw new AccountDeletionStorageError("inventory_input_invalid");
  }
  const storage = admin.storage.from("chat-image");
  const coupleIds: string[] = [];
  const seenCouples = new Set<string>();
  let pageCount = 0;
  let objectCount = 0;

  const listPage = async (prefix: string, limit: number, offset: number) => {
    pageCount += 1;
    if (pageCount > CHAT_IMAGE_MAX_LIST_PAGES) {
      throw new AccountDeletionStorageError("chat_image_page_limit_exceeded");
    }
    const { data, error } = await storage.list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error || !Array.isArray(data)) {
      throw new AccountDeletionStorageError("chat_image_inventory_unavailable");
    }
    if (data.length > limit) {
      throw new AccountDeletionStorageError("chat_image_page_limit_exceeded");
    }
    return data;
  };

  for (let offset = 0; ; offset += INVENTORY_PAGE_SIZE) {
    if (offset >= CHAT_IMAGE_MAX_COUPLE_FOLDERS) {
      const overflow = await listPage("", 1, offset);
      if (overflow.length > 0) {
        throw new AccountDeletionStorageError("chat_image_folder_limit_exceeded");
      }
      break;
    }
    const data = await listPage("", INVENTORY_PAGE_SIZE, offset);
    for (const item of data) {
      if (!item || typeof item.name !== "string" || item.id !== null
          || !UUID_RE.test(item.name) || seenCouples.has(item.name)) {
        throw new AccountDeletionStorageError("chat_image_path_malformed");
      }
      seenCouples.add(item.name);
      coupleIds.push(item.name);
    }
    if (data.length < INVENTORY_PAGE_SIZE) break;
  }

  const entries: CommunityDeletionManifestEntry[] = [];
  const seenPaths = new Set<string>();
  for (const coupleId of coupleIds) {
    const prefix = `${coupleId}/${userId}`;
    for (let offset = 0; ; offset += INVENTORY_PAGE_SIZE) {
      if (objectCount >= INVENTORY_MAX_OBJECTS) {
        const overflow = await listPage(prefix, 1, offset);
        if (overflow.length > 0) {
          throw new AccountDeletionStorageError("chat_image_object_limit_exceeded");
        }
        break;
      }
      const limit = Math.min(INVENTORY_PAGE_SIZE, INVENTORY_MAX_OBJECTS - objectCount);
      const data = await listPage(prefix, limit, offset);
      for (const item of data) {
        if (!item || typeof item.name !== "string" || typeof item.id !== "string"
            || !UUID_RE.test(item.id) || !CHAT_IMAGE_FILE_RE.test(item.name)) {
          throw new AccountDeletionStorageError("chat_image_path_malformed");
        }
        const path = `${prefix}/${item.name}`;
        if (seenPaths.has(path)) {
          throw new AccountDeletionStorageError("chat_image_path_malformed");
        }
        seenPaths.add(path);
        entries.push({
          bucket: "chat-image",
          path,
          source: "quarantine",
          not_before: new Date(now).toISOString(),
        });
        objectCount += 1;
      }
      if (data.length < limit) break;
    }
  }
  return entries;
}

export function buildProfileAvatarDeletionManifest(userId: string, assets: unknown[], listedNames: string[], now: number): CommunityDeletionManifestEntry[] {
  if (!UUID_RE.test(userId) || !Number.isFinite(now)) throw new AccountDeletionStorageError("avatar_inventory_invalid");
  const entries = new Map<string, CommunityDeletionManifestEntry>();
  for (const value of assets) {
    if (!value || typeof value !== "object") throw new AccountDeletionStorageError("avatar_inventory_invalid");
    const asset = value as Record<string, unknown>;
    if (asset.user_id !== userId || typeof asset.revision !== "string" || !UUID_RE.test(asset.revision)
      || asset.object_path !== `${userId}/${asset.revision}.webp` || typeof asset.upload_until !== "string"
      || !Number.isFinite(Date.parse(asset.upload_until))) throw new AccountDeletionStorageError("avatar_inventory_invalid");
    entries.set(String(asset.object_path), { bucket: "profile-avatars", path: String(asset.object_path), source: "profile_avatar", not_before: asset.upload_until });
  }
  for (const name of listedNames) {
    assertSafeListedName(name);
    const path = `${userId}/${name}`;
    if (!entries.has(path)) entries.set(path, { bucket: "profile-avatars", path, source: "quarantine", not_before: new Date(now).toISOString() });
  }
  return [...entries.values()];
}
async function inventoryProfileAvatarMedia(admin: SupabaseClient, userId: string, now: number) {
  const [result, names] = await Promise.all([
    admin.from("profile_avatar_assets").select("user_id,revision,object_path,upload_until").eq("user_id", userId).limit(INVENTORY_MAX_OBJECTS + 1),
    listExactUserPrefix(admin, "profile-avatars", userId),
  ]);
  if (result.error || !Array.isArray(result.data) || result.data.length > INVENTORY_MAX_OBJECTS) throw new AccountDeletionStorageError("avatar_inventory_unavailable");
  return buildProfileAvatarDeletionManifest(userId, result.data, names, now);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listProviderPortfolioPaths(admin: SupabaseClient, userId: string): Promise<string[]> {
  const paths: string[] = [];
  const folders = await listExactUserPrefix(admin, "provider-portfolio", userId, "folder");
  if (folders.length > 1000) throw new AccountDeletionStorageError("provider_inventory_invalid");
  for (const folder of folders) {
    if (!UUID_RE.test(folder)) throw new AccountDeletionStorageError("provider_inventory_invalid");
    const names = await listExactUserPrefix(admin, "provider-portfolio", `${userId}/${folder}`, "file");
    for (const name of names) {
      if (!PROVIDER_IMAGE_FILE_RE.test(name)) throw new AccountDeletionStorageError("provider_inventory_invalid");
      paths.push(`${userId}/${folder}/${name}`);
      if (paths.length > INVENTORY_MAX_OBJECTS) throw new AccountDeletionStorageError("manifest_inventory_limit_exceeded");
    }
  }
  return paths;
}

export function buildProviderPortfolioDeletionManifest(input: {
  userId: string;
  assets: unknown[];
  listedPaths: string[];
  now: number;
}): CommunityDeletionManifestEntry[] {
  if (!UUID_RE.test(input.userId) || !Number.isFinite(input.now)) {
    throw new AccountDeletionStorageError("provider_inventory_invalid");
  }
  const entries = new Map<string, CommunityDeletionManifestEntry>();
  for (const asset of input.assets) {
    if (!isRecord(asset) || asset.owner_id !== input.userId
      || typeof asset.provider_id !== "string" || !UUID_RE.test(asset.provider_id)
      || typeof asset.id !== "string" || !UUID_RE.test(asset.id)
      || typeof asset.storage_path !== "string" || typeof asset.created_at !== "string"
      || !Number.isFinite(Date.parse(asset.created_at))) {
      throw new AccountDeletionStorageError("provider_inventory_invalid");
    }
    const path = asset.storage_path;
    const parts = path.split("/");
    if (parts.length !== 3 || parts[0] !== input.userId || parts[1] !== asset.provider_id
      || !PROVIDER_IMAGE_FILE_RE.test(parts[2]) || parts[2].slice(0, 36) !== asset.id) {
      throw new AccountDeletionStorageError("provider_inventory_invalid");
    }
    entries.set(path, { bucket: "provider-portfolio", path, source: "provider_portfolio",
      // PostgreSQL의 미세초가 JS Date에서 잘려 DB의 최소 유예보다 앞서지 않게 한다.
      not_before: new Date(Date.parse(asset.created_at) + PROVIDER_UPLOAD_GRACE_MS + DATABASE_TIMESTAMP_PRECISION_MARGIN_MS).toISOString() });
  }
  for (const path of input.listedPaths) {
    const parts = path.split("/");
    if (parts.length !== 3 || parts[0] !== input.userId || !UUID_RE.test(parts[1]) || !PROVIDER_IMAGE_FILE_RE.test(parts[2])) {
      throw new AccountDeletionStorageError("provider_inventory_invalid");
    }
    if (!entries.has(path)) entries.set(path, { bucket: "provider-portfolio", path,
      source: "quarantine", not_before: new Date(input.now).toISOString() });
  }
  if (entries.size > INVENTORY_MAX_OBJECTS) throw new AccountDeletionStorageError("manifest_inventory_limit_exceeded");
  return [...entries.values()];
}

async function inventoryProviderPortfolioMedia(admin: SupabaseClient, userId: string, now: number) {
  const [profiles, paths] = await Promise.all([
    admin.from("provider_profiles").select("id,owner_id").eq("owner_id", userId).limit(INVENTORY_MAX_OBJECTS + 1),
    listProviderPortfolioPaths(admin, userId),
  ]);
  if (profiles.error || !Array.isArray(profiles.data) || profiles.data.length > INVENTORY_MAX_OBJECTS) {
    throw new AccountDeletionStorageError("provider_inventory_unavailable");
  }
  const assets: unknown[] = [];
  for (const profile of profiles.data) {
    if (!isRecord(profile) || typeof profile.id !== "string" || !UUID_RE.test(profile.id) || profile.owner_id !== userId) {
      throw new AccountDeletionStorageError("provider_inventory_invalid");
    }
    for (let offset = 0; offset <= INVENTORY_MAX_OBJECTS; offset += SESSION_PAGE_SIZE) {
      const result = await admin.from("provider_media").select("id,provider_id,storage_path,created_at")
        .eq("provider_id", profile.id).order("id", { ascending: true }).range(offset, offset + SESSION_PAGE_SIZE - 1);
      if (result.error || !Array.isArray(result.data) || result.data.length > SESSION_PAGE_SIZE) {
        throw new AccountDeletionStorageError("provider_inventory_unavailable");
      }
      for (const asset of result.data) {
        if (!isRecord(asset) || asset.provider_id !== profile.id) throw new AccountDeletionStorageError("provider_inventory_invalid");
        assets.push({ ...asset, owner_id: userId });
        if (assets.length > INVENTORY_MAX_OBJECTS) throw new AccountDeletionStorageError("manifest_inventory_limit_exceeded");
      }
      if (result.data.length < SESSION_PAGE_SIZE) break;
    }
  }
  return buildProviderPortfolioDeletionManifest({ userId, assets, listedPaths: paths, now });
}

export async function inventoryCommunityDeletionMedia(
  admin: SupabaseClient,
  userId: string,
  now = Date.now(),
): Promise<CommunityDeletionManifestEntry[]> {
  const [sessions, staging, images, videos, chatImages, avatarManifest, providerManifest] = await Promise.all([
    listDurableSessions(admin, userId),
    listExactUserPrefix(admin, "community-media-staging", userId),
    listExactUserPrefix(admin, "community-images", userId),
    listExactUserPrefix(admin, "community-videos", userId),
    inventoryChatImageQuarantine(admin, userId, now),
    inventoryProfileAvatarMedia(admin, userId, now),
    inventoryProviderPortfolioMedia(admin, userId, now),
  ]);
  const communityManifest = buildCommunityDeletionManifest({
    userId,
    sessions,
    listedNames: {
      "community-media-staging": staging,
      "community-images": images,
      "community-videos": videos,
    },
    now,
  });
  const manifest = [...communityManifest, ...chatImages, ...avatarManifest, ...providerManifest].sort((left, right) =>
    left.bucket.localeCompare(right.bucket) || left.path.localeCompare(right.path)
  );
  if (manifest.length > INVENTORY_MAX_OBJECTS) {
    throw new AccountDeletionStorageError("manifest_inventory_limit_exceeded");
  }
  return manifest;
}

function isAccountDeletionJob(value: unknown): value is AccountDeletionJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && UUID_RE.test(row.id)
    && (typeof row.user_id === "string" || row.user_id === null)
    && [
      "inventorying",
      "inventory_ready",
      "deleting",
      "auth_deleting",
      "manual_review",
      "completed",
    ].includes(String(row.status))
    && (typeof row.ready_after === "string" || row.ready_after === null)
    && Number.isInteger(row.quarantine_count)
    && Number(row.quarantine_count) >= 0
    && (typeof row.claim_token === "string" || row.claim_token === null);
}

function firstJob(data: unknown): AccountDeletionJob | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (data.length !== 1 || !isAccountDeletionJob(data[0])) {
    throw new AccountDeletionStorageError("job_response_invalid");
  }
  return data[0];
}

function isManifestRow(value: unknown): value is AccountDeletionManifestRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.job_id === "string"
    && typeof row.bucket === "string"
    && (ACCOUNT_DELETION_BUCKETS as readonly string[]).includes(row.bucket)
    && typeof row.path === "string"
    && ["session_staging", "session_final", "legacy_prefix", "quarantine", "profile_avatar", "provider_portfolio"]
      .includes(String(row.source))
    && typeof row.not_before === "string"
    && Number.isFinite(Date.parse(row.not_before))
    && (typeof row.cleaned_at === "string" || row.cleaned_at === null);
}

function assertExactManifestPath(row: AccountDeletionManifestRow, job: AccountDeletionJob) {
  if (!job.user_id || row.job_id !== job.id) {
    throw new AccountDeletionStorageError("worker_manifest_invalid");
  }
  if (row.bucket === "provider-portfolio") {
    const parts = row.path.split("/");
    if (parts.length !== 3 || parts[0] !== job.user_id || !UUID_RE.test(parts[1])
      || !PROVIDER_IMAGE_FILE_RE.test(parts[2]) || !["provider_portfolio", "quarantine"].includes(row.source)) {
      throw new AccountDeletionStorageError("worker_manifest_invalid");
    }
    return;
  }
  if (row.bucket === "chat-image") {
    const parts = row.path.split("/");
    if (parts.length !== 3
        || !UUID_RE.test(parts[0])
        || parts[1] !== job.user_id
        || !CHAT_IMAGE_FILE_RE.test(parts[2])
        || row.source !== "quarantine") {
      throw new AccountDeletionStorageError("worker_manifest_invalid");
    }
    return;
  }
  const prefix = `${job.user_id}/`;
  const name = row.path.startsWith(prefix) ? row.path.slice(prefix.length) : "";
  if (!name || row.path !== `${prefix}${name}`) {
    throw new AccountDeletionStorageError("worker_manifest_invalid");
  }
  assertSafeListedName(name);
  const sessionShape = SESSION_FILE_RE.test(name);
  const sourceShapeIsValid = row.source === "quarantine"
    || (row.source === "profile_avatar" && row.bucket === "profile-avatars" && /^[0-9a-f-]{36}\.webp$/.test(name) && UUID_RE.test(name.slice(0, -5)))
    || (
      row.source === "legacy_prefix"
      && (
        (row.bucket === "community-images" && LEGACY_IMAGE_RE.test(name))
        || (row.bucket === "community-videos" && LEGACY_VIDEO_RE.test(name))
      )
    )
    || (
      row.source === "session_staging"
      && row.bucket === "community-media-staging"
      && sessionShape
    )
    || (
      row.source === "session_final"
      && row.bucket === "community-images"
      && sessionShape
    );
  if (!sourceShapeIsValid) {
    throw new AccountDeletionStorageError("worker_manifest_invalid");
  }
}

async function listManifestRows(
  admin: SupabaseClient,
  jobId: string,
): Promise<AccountDeletionManifestRow[]> {
  const rows: AccountDeletionManifestRow[] = [];
  for (let offset = 0; offset <= INVENTORY_MAX_OBJECTS; offset += MANIFEST_PAGE_SIZE) {
    const query = admin
      .from("account_deletion_media_manifest")
      .select("job_id,bucket,path,source,not_before,cleaned_at")
      .eq("job_id", jobId)
      .order("bucket", { ascending: true })
      .order("path", { ascending: true });
    const { data, error } = await query.range(
      offset,
      offset + MANIFEST_PAGE_SIZE - 1,
    );
    if (error || !Array.isArray(data) || data.some((row) => !isManifestRow(row))) {
      throw new AccountDeletionStorageError("manifest_inventory_unavailable");
    }
    if (offset === INVENTORY_MAX_OBJECTS && data.length > 0) {
      throw new AccountDeletionStorageError("manifest_inventory_limit_exceeded");
    }
    rows.push(...data as AccountDeletionManifestRow[]);
    if (data.length < MANIFEST_PAGE_SIZE) break;
  }
  return rows;
}

function isAuthUserMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  return value.status === 404
    || value.code === "user_not_found"
    || value.code === "not_found";
}

async function releaseClaim(
  admin: SupabaseClient,
  jobId: string,
  claimToken: string,
  errorCode: string,
) {
  try {
    await admin.rpc("release_account_deletion_job", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_error_code: errorCode,
    });
  } catch {
    // The durable lease becomes reclaimable after its stale timeout. Never
    // turn a failed release transport into an unsafe second side effect.
  }
}

async function markManualReview(
  admin: SupabaseClient,
  jobId: string,
  claimToken: string,
  errorCode: string,
): Promise<AccountDeletionProcessResult> {
  let response: Awaited<ReturnType<SupabaseClient["rpc"]>>;
  try {
    response = await admin.rpc("mark_account_deletion_manual_review", {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_error_code: errorCode,
    });
  } catch {
    await releaseClaim(admin, jobId, claimToken, "manual_review_checkpoint_failed");
    return { status: "retry" };
  }
  const { data, error } = response;
  if (error || data !== true) {
    await releaseClaim(admin, jobId, claimToken, "manual_review_checkpoint_failed");
    return { status: "retry" };
  }
  return { status: "manual_review" };
}

const MANUAL_REVIEW_CODES = new Set([
  "customer_data_scope_review_required",
  "inventory_input_invalid",
  "unsafe_inventory_name",
  "storage_inventory_malformed",
  "storage_inventory_limit_exceeded",
  "chat_image_path_malformed",
  "chat_image_folder_limit_exceeded",
  "chat_image_object_limit_exceeded",
  "chat_image_page_limit_exceeded",
  "session_contract_invalid",
  "session_inventory_limit_exceeded",
  "job_response_invalid",
  "worker_manifest_invalid",
  "manifest_inventory_limit_exceeded",
  "vendor_ownership_inventory_malformed",
  "vendor_account_manual_review_required",
  "provider_inventory_invalid",
]);

async function assertNoOwnedVendor(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await admin
    .from("vendors")
    .select("id")
    .eq("owner_id", userId)
    .limit(1);
  if (error || !Array.isArray(data)) {
    throw new AccountDeletionStorageError(
      "vendor_ownership_inventory_unavailable",
    );
  }
  if (data.length > 1 || data.some((row) => (
    !row
    || typeof row !== "object"
    || Array.isArray(row)
    || !UUID_RE.test(String((row as Record<string, unknown>).id ?? ""))
  ))) {
    throw new AccountDeletionStorageError(
      "vendor_ownership_inventory_malformed",
    );
  }
  if (data.length > 0) {
    throw new AccountDeletionStorageError(
      "vendor_account_manual_review_required",
    );
  }
}

function isAmbiguousStorageAbsenceError(error: unknown): boolean {
  // 지원 CLI의 ESM SDK와 tsx/CJS worker는 오류 생성자를 공유하지 않는다.
  return typeof error === "object" && error !== null
    && "__isStorageError" in error && error.__isStorageError === true
    && "name" in error && error.name === "StorageApiError"
    && "statusCode" in error && typeof error.statusCode === "string"
    && "status" in error && (error.status === 400 || error.status === 404);
}

async function deleteManifestRows(
  admin: SupabaseClient,
  job: AccountDeletionJob,
  claimToken: string,
  rows: AccountDeletionManifestRow[],
  now: number,
): Promise<AccountDeletionProcessResult | null> {
  for (const row of rows) {
    assertExactManifestPath(row, job);
  }
  if (rows.some((row) => row.source === "quarantine")) {
    return markManualReview(
      admin,
      job.id,
      claimToken,
      "unproven_legacy_media",
    );
  }
  for (const row of rows) {
    if (Date.parse(row.not_before) > now) {
      await releaseClaim(admin, job.id, claimToken, "token_grace_pending");
      return { status: "pending" };
    }
  }

  const totalPending = rows.filter((row) => row.cleaned_at === null).length;
  let processed = 0;
  const removeAndCheckpoint = async (
    bucket: typeof AUTOMATIC_DELETION_BUCKETS[number],
    batch: AccountDeletionManifestRow[],
  ) => {
    const paths = batch.map((row) => row.path);
    // A remove error alone is not decisive: a previous attempt may already
    // have removed the object. Exact absence checks below are the boundary.
    await admin.storage.from(bucket).remove(paths);
    const listedNamesByPrefix = new Map<string, string[]>();
    for (const row of batch) {
      const { data: exists, error: existsError } = await admin.storage
        .from(bucket)
        .exists(row.path);
      if (exists === false && isAmbiguousStorageAbsenceError(existsError)) {
        // HEAD 오류만으로 부재를 인정하지 않는다. 검증된 단일 사용자 폴더를 끝까지
        // 조회한 결과만 이 배치에서 공유하고, 아래 최종 재조회에는 재사용하지 않는다.
        const prefix = bucket === "provider-portfolio" ? row.path.slice(0, row.path.lastIndexOf("/")) : job.user_id!;
        let listedNames = listedNamesByPrefix.get(prefix);
        if (!listedNames) {
          listedNames = await listExactUserPrefix(admin, bucket, prefix);
          listedNamesByPrefix.set(prefix, listedNames);
        }
        if (listedNames.some((name) => `${prefix}/${name}` === row.path)) {
          throw new AccountDeletionStorageError("storage_delete_unconfirmed");
        }
      } else if (existsError || typeof exists !== "boolean") {
        throw new AccountDeletionStorageError("storage_absence_check_unavailable");
      }
      if (exists) {
        throw new AccountDeletionStorageError("storage_delete_unconfirmed");
      }
      const { data: checkpointed, error: checkpointError } = await admin.rpc(
        "checkpoint_account_deletion_media",
        {
          p_job_id: job.id,
          p_claim_token: claimToken,
          p_bucket: row.bucket,
          p_path: row.path,
        },
      );
      if (checkpointError || checkpointed !== true) {
        throw new AccountDeletionStorageError("storage_checkpoint_failed");
      }
      processed += 1;
    }
  };
  for (const bucket of AUTOMATIC_DELETION_BUCKETS) {
    const pending = rows.filter((row) =>
      row.bucket === bucket && row.cleaned_at === null
    ).slice(0, Math.max(0, MAX_DELETIONS_PER_RUN - processed));
    for (let offset = 0; offset < pending.length; offset += DELETE_BATCH_SIZE) {
      const batch = pending.slice(offset, offset + DELETE_BATCH_SIZE);
      await removeAndCheckpoint(bucket, batch);
    }
  }

  if (processed < totalPending) {
    await releaseClaim(admin, job.id, claimToken, "storage_cleanup_pending");
    return { status: "pending" };
  }

  const manifestRows = new Map(rows.map((row) => [
    manifestKey(row.bucket, row.path),
    row,
  ]));
  const reappeared = new Map<string, AccountDeletionManifestRow>();
  for (const bucket of AUTOMATIC_DELETION_BUCKETS) {
    const remainingPaths = bucket === "provider-portfolio"
      ? await listProviderPortfolioPaths(admin, job.user_id!)
      : (await listExactUserPrefix(admin, bucket, job.user_id!)).map((name) => `${job.user_id}/${name}`);
    for (const remainingPath of remainingPaths) {
      const key = manifestKey(bucket, remainingPath);
      const row = manifestRows.get(key);
      if (!row) {
        return markManualReview(
          admin,
          job.id,
          claimToken,
          "unmanifested_storage_object",
        );
      }
      reappeared.set(key, row);
    }
  }
  if (reappeared.size > 0) {
    const available = Math.max(0, MAX_DELETIONS_PER_RUN - processed);
    const selected = [...reappeared.values()].slice(0, available);
    for (const bucket of AUTOMATIC_DELETION_BUCKETS) {
      const inBucket = selected.filter((row) => row.bucket === bucket);
      for (let offset = 0; offset < inBucket.length; offset += DELETE_BATCH_SIZE) {
        await removeAndCheckpoint(
          bucket,
          inBucket.slice(offset, offset + DELETE_BATCH_SIZE),
        );
      }
    }
    await releaseClaim(admin, job.id, claimToken, "storage_cleanup_pending");
    return { status: "pending" };
  }
  const lateChatImages = await inventoryChatImageQuarantine(
    admin,
    job.user_id!,
    now,
  );
  if (lateChatImages.length > 0) {
    return markManualReview(
      admin,
      job.id,
      claimToken,
      "chat_attachment_manual_review_required",
    );
  }
  return null;
}

/**
 * Runs one durable account-deletion stage. The caller may retry this safely;
 * every external side effect is protected by a DB lease and exact checkpoint.
 */
export async function processAccountDeletionJob(
  admin: SupabaseClient,
  jobId: string,
  now = Date.now(),
): Promise<AccountDeletionProcessResult> {
  if (!UUID_RE.test(jobId) || !Number.isFinite(now)) {
    return { status: "manual_review" };
  }
  const claimToken = crypto.randomUUID();
  let claimResponse: Awaited<ReturnType<SupabaseClient["rpc"]>>;
  try {
    claimResponse = await admin.rpc(
      "claim_account_deletion_job",
      {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_stale_before: new Date(now - CLAIM_STALE_MS).toISOString(),
      },
    );
  } catch {
    return { status: "retry" };
  }
  const { data: claimedData, error: claimError } = claimResponse;
  if (claimError) return { status: "retry" };

  let job: AccountDeletionJob | null;
  try {
    job = firstJob(claimedData);
  } catch {
    return { status: "retry" };
  }
  if (!job) return { status: "pending" };
  if (job.id !== jobId
      || job.claim_token !== claimToken
      || !job.user_id
      || !UUID_RE.test(job.user_id)) {
    await releaseClaim(admin, job.id, claimToken, "job_identity_invalid");
    return { status: "retry" };
  }

  try {
    if (job.status === "inventorying") {
      await assertNoOwnedVendor(admin, job.user_id);
      const manifest = await inventoryCommunityDeletionMedia(admin, job.user_id, now);
      const { data: replacementData, error: replacementError } = await admin.rpc(
        "replace_account_deletion_media_manifest",
        {
          p_job_id: job.id,
          p_claim_token: claimToken,
          p_manifest: manifest,
        },
      );
      if (replacementError) {
        throw new AccountDeletionStorageError("manifest_checkpoint_failed");
      }
      const replacement = firstJob(replacementData);
      if (!replacement) {
        throw new AccountDeletionStorageError("manifest_checkpoint_failed");
      }
      return replacement.status === "manual_review"
        ? { status: "manual_review" }
        : { status: "pending" };
    }

    if (job.status !== "deleting" && job.status !== "auth_deleting") {
      await releaseClaim(admin, job.id, claimToken, "job_state_invalid");
      return { status: "retry" };
    }

    // 소유자 연결이 사라지기 전에 개인 자료를 원자 처리한다. 준비 실패 시 파일도 지우지 않는다.
    const { data: customerDataPrepared, error: customerDataError } = await admin.rpc(
      "prepare_account_deletion_customer_data",
      { p_job_id: job.id, p_claim_token: claimToken },
    );
    if (customerDataError?.code === "P0001"
        && customerDataError.message === "ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED") {
      throw new AccountDeletionStorageError("customer_data_scope_review_required");
    }
    if (customerDataError || customerDataPrepared !== true) {
      throw new AccountDeletionStorageError("customer_data_preparation_unavailable");
    }

    const rows = await listManifestRows(admin, job.id);
    const storageResult = await deleteManifestRows(
      admin,
      job,
      claimToken,
      rows,
      now,
    );
    if (storageResult) return storageResult;

    const { data: prepared, error: prepareError } = await admin.rpc(
      "prepare_account_deletion_auth_delete",
      { p_job_id: job.id, p_claim_token: claimToken },
    );
    if (prepareError || prepared !== true) {
      throw new AccountDeletionStorageError("auth_boundary_rejected");
    }

    const authLookup = await admin.auth.admin.getUserById(job.user_id);
    if (authLookup.error && !isAuthUserMissing(authLookup.error)) {
      throw new AccountDeletionStorageError("auth_lookup_unavailable");
    }
    if (!authLookup.error && !authLookup.data.user) {
      throw new AccountDeletionStorageError("auth_lookup_invalid");
    }
    if (!authLookup.error && authLookup.data.user) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(job.user_id);
      if (deleteError && !isAuthUserMissing(deleteError)) {
        throw new AccountDeletionStorageError("auth_delete_failed");
      }
    }

    const { data: finalized, error: finalizeError } = await admin.rpc(
      "finalize_account_deletion_job",
      { p_job_id: job.id, p_claim_token: claimToken },
    );
    if (finalizeError || finalized !== true) {
      throw new AccountDeletionStorageError("finalize_checkpoint_failed");
    }
    return { status: "completed" };
  } catch (error) {
    const code = error instanceof AccountDeletionStorageError
      ? error.code
      : "account_deletion_worker_failed";
    if (MANUAL_REVIEW_CODES.has(code)) {
      return markManualReview(admin, job.id, claimToken, code);
    }
    await releaseClaim(admin, job.id, claimToken, code);
    return { status: "retry" };
  }
}

export async function requestAccountDeletion(
  admin: SupabaseClient,
  userId: string,
  reason: string,
  now = Date.now(),
  options: { processImmediately?: boolean } = {},
): Promise<AccountDeletionProcessResult> {
  const normalizedReason = reason.trim();
  if (!UUID_RE.test(userId)
      || !ACCOUNT_DELETION_REASON_CODES.has(normalizedReason)) {
    throw new AccountDeletionStorageError("account_deletion_request_invalid");
  }
  let beginResponse: Awaited<ReturnType<SupabaseClient["rpc"]>>;
  try {
    beginResponse = await admin.rpc("begin_account_deletion_job", {
      p_user_id: userId,
      p_reason: normalizedReason,
    });
  } catch {
    throw new AccountDeletionStorageError("account_deletion_begin_failed");
  }
  const { data, error } = beginResponse;
  if (error) {
    throw new AccountDeletionStorageError("account_deletion_begin_failed");
  }
  const job = firstJob(data);
  if (!job) {
    throw new AccountDeletionStorageError("account_deletion_job_missing");
  }
  if (job.id.length === 0 || job.user_id !== userId) {
    throw new AccountDeletionStorageError("account_deletion_job_invalid");
  }
  if (job.status === "manual_review") return { status: "manual_review" };
  if (job.status === "completed") return { status: "completed" };
  // Intake and destructive processing are separate release gates. Enqueue by
  // default so an API caller cannot advance Storage/Auth deletion merely by
  // retrying the request while the worker policy is disabled.
  if (options.processImmediately !== true) return { status: "pending" };
  return processAccountDeletionJob(admin, job.id, now);
}

/** Fail-closed upload fence: lookup errors throw instead of allowing writes. */
export async function hasActiveAccountDeletion(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  if (!UUID_RE.test(userId)) {
    throw new AccountDeletionStorageError("account_deletion_fence_invalid");
  }
  let response: { data: unknown; error: unknown };
  try {
    response = await admin
      .from("account_deletion_jobs")
      .select("id")
      .eq("user_id", userId)
      .neq("status", "completed")
      .limit(1);
  } catch {
    throw new AccountDeletionStorageError("account_deletion_fence_unavailable");
  }
  const { data, error } = response;
  if (error || !Array.isArray(data)
      || data.some((row) => !row || typeof row.id !== "string")) {
    throw new AccountDeletionStorageError("account_deletion_fence_unavailable");
  }
  return data.length > 0;
}
