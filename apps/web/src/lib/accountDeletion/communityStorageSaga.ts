import type { SupabaseClient } from "@supabase/supabase-js";

import { sendAccountDeletionNotice } from "@/lib/accountDeletion/deletionNotice";

/**
 * 이 오류가 **"그 객체가 정말 없다"** 인가.
 *
 * `api/chat/messages/route.ts` 의 같은 이름 술어와 판정이 같아야 한다 — 한쪽만
 * 고치면 두 경로가 다른 결론을 낸다. storage-js 는 부재를 `statusCode: "404"`
 * 로 알려 주고, 그 밖의 실패(권한·네트워크·버킷 없음)는 다른 값을 준다.
 *
 * **"모르겠다"를 "없다"로 읽지 않는다.** 없다고 잘못 읽으면 안 지워진 파일을
 * 지워졌다고 기록하고 탈퇴를 완료 처리한다 — 되돌릴 수 없는 거짓말이다.
 */
export function isMissingStorageObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  const status = String(record.statusCode ?? record.status ?? "");
  const detail = `${String(record.error ?? "")} ${String(record.message ?? "")}`
    .toLowerCase();
  return status === "404" || detail.includes("not found");
}

export const COMMUNITY_DELETION_BUCKETS = [
  "community-media-staging",
  "community-images",
  "community-videos",
] as const;

export const ACCOUNT_DELETION_BUCKETS = [
  ...COMMUNITY_DELETION_BUCKETS,
  "chat-image",
] as const;

export type CommunityDeletionBucket = typeof COMMUNITY_DELETION_BUCKETS[number];
export type AccountDeletionBucket = typeof ACCOUNT_DELETION_BUCKETS[number];
export type CommunityDeletionSource =
  | "session_staging"
  | "session_final"
  | "legacy_prefix"
  | "quarantine"
  // 자기가 올린 채팅 사진. **DB 가 증명한 것만** 이 값을 갖는다 —
  // `chat_photo_belongs_to_user` 가 `chat_messages` 행으로 판정하고,
  // 매니페스트 검증기가 같은 트랜잭션에서 다시 확인한다.
  | "chat_message";

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
const SAFE_LISTED_NAME_RE = /^[^/\\\u0000-\u001f\u007f]{1,400}$/;
const SIGNED_TOKEN_GRACE_MS = 5 * 60 * 1000;
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
  bucket: CommunityDeletionBucket,
  userId: string,
): Promise<string[]> {
  const names: string[] = [];
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
    for (const item of data) {
      if (!item || typeof item.name !== "string") {
        throw new AccountDeletionStorageError("storage_inventory_malformed");
      }
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

/**
 * 이 사람이 **올린** 채팅 사진 경로 목록.
 *
 * 서버가 쓴 `chat_messages` 행에서만 모은다. 경로는 근거가 아니다 — Storage RLS
 * 가 경로의 첫 칸(커플)만 검사하므로 두 번째 칸은 배우자도 쓸 수 있다.
 *
 * 여기서 나온 목록은 **주장**일 뿐이고, 매니페스트 검증기가 같은 판정을 DB 에서
 * 다시 한다(`chat_photo_belongs_to_user`). 앱이 잘못되어도 남의 사진은 삭제
 * 대상이 되지 않는다.
 *
 * 자료가 이상하면 **던진다** — 조용히 빈 목록을 돌려주면 자기 사진이 격리로
 * 남아 탈퇴가 멈추는데, 왜 멈췄는지 아무도 모른다.
 */
async function listOwnChatPhotoPaths(
  admin: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const proven = new Set<string>();
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    if (proven.size > INVENTORY_MAX_OBJECTS) {
      throw new AccountDeletionStorageError("chat_proof_inventory_limit_exceeded");
    }
    const { data, error } = await admin
      .from("chat_messages")
      .select("couple_id, metadata")
      .eq("sender_id", userId)
      .not("metadata->imagePaths", "is", null)
      .range(from, from + PAGE - 1);
    if (error) {
      throw new AccountDeletionStorageError("chat_proof_inventory_unavailable");
    }
    const rows = data ?? [];
    for (const row of rows) {
      const metadata = row?.metadata;
      if (metadata === null || typeof metadata !== "object") continue;
      const paths = (metadata as Record<string, unknown>).imagePaths;
      if (!Array.isArray(paths)) continue;
      for (const value of paths) {
        if (typeof value !== "string") {
          throw new AccountDeletionStorageError("chat_proof_inventory_malformed");
        }
        // 커플이 맞는 것만 센다. DB 판정과 같은 조건이어야 두 층이 어긋나지 않는다.
        if (typeof row.couple_id === "string" && value.startsWith(`${row.couple_id}/`)) {
          proven.add(value);
        }
      }
    }
    if (rows.length < PAGE) break;
  }
  return proven;
}

async function inventoryChatImageQuarantine(
  admin: SupabaseClient,
  userId: string,
  now: number,
): Promise<CommunityDeletionManifestEntry[]> {
  if (!UUID_RE.test(userId) || !Number.isFinite(now)) {
    throw new AccountDeletionStorageError("inventory_input_invalid");
  }
  const provenChatPaths = await listOwnChatPhotoPaths(admin, userId);
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
          // **증명이 있으면 삭제 대상, 없으면 예전 그대로 격리.**
          //
          // 예전에는 전부 격리라 사진을 한 번이라도 올린 계정은 탈퇴가
          // `manual_review` 에 갇혔고, 그것을 푸는 앱 경로가 0건이었다.
          // 화면은 "내가 올린 사진·첨부 파일은 삭제돼요" 라고 약속하고 있었다.
          //
          // 증명은 경로가 아니라 `chat_messages` 행이다 — Storage RLS 가
          // 경로의 첫 칸만 보므로 두 번째 칸은 배우자도 쓸 수 있다.
          source: provenChatPaths.has(path) ? "chat_message" : "quarantine",
          not_before: new Date(now).toISOString(),
        });
        objectCount += 1;
      }
      if (data.length < limit) break;
    }
  }

  // **옛 2단 경로(`<커플>/<파일>`)도 본다.**
  //
  // 2026-09-02 운영 실측: chat-image 객체 6개가 전부 2단이고 그중 5개는 살아
  // 있는 대화에 지금 보인다. 3단만 훑으면 이 사진들은 인벤토리에 아예 안 잡혀
  // **주인이 탈퇴해도 그대로 남는데 우리는 "지웠다"고 말하게 된다.**
  //
  // 2단에는 경로에 사용자가 없으므로 여기서 소유를 판정하지 않는다 — 증명된
  // 것(`provenChatPaths`)만 삭제 대상이 되고 나머지는 격리로 남아 사람이 본다.
  // 그 판정은 원래도 경로가 아니라 `chat_messages` 행이 한다.
  for (const coupleId of coupleIds) {
    for (let offset = 0; ; offset += INVENTORY_PAGE_SIZE) {
      // **상한에서 조용히 멈추지 않는다.** 그냥 break 하면 남은 사진을 말없이
      // 건너뛰고, 탈퇴가 완료되면서 "지웠다"고 말하게 된다 — 이 수정이 없애려는
      // 바로 그 침묵이다. 3단 루프와 같은 방식으로 실패로 닫는다.
      if (objectCount >= INVENTORY_MAX_OBJECTS) {
        const overflow = await listPage(coupleId, 1, offset);
        if (overflow.some((item) => item && typeof item.name === "string"
            && item.id !== null && CHAT_IMAGE_FILE_RE.test(item.name))) {
          throw new AccountDeletionStorageError("chat_image_object_limit_exceeded");
        }
        break;
      }
      const limit = Math.min(INVENTORY_PAGE_SIZE, INVENTORY_MAX_OBJECTS - objectCount);
      const data = await listPage(coupleId, limit, offset);
      for (const item of data) {
        // 폴더(3단 경로의 사용자 칸)는 여기서 건너뛴다 — 아래 루프가 본다.
        if (!item || typeof item.name !== "string") continue;
        if (item.id === null) continue;
        if (!CHAT_IMAGE_FILE_RE.test(item.name)) continue;
        const legacyPath = `${coupleId}/${item.name}`;
        if (seenPaths.has(legacyPath)) continue;
        seenPaths.add(legacyPath);
        entries.push({
          bucket: "chat-image",
          path: legacyPath,
          source: provenChatPaths.has(legacyPath) ? "chat_message" : "quarantine",
          not_before: new Date(now).toISOString(),
        });
        objectCount += 1;
      }
      if (data.length < limit) break;
    }
  }

  return entries;
}

export async function inventoryCommunityDeletionMedia(
  admin: SupabaseClient,
  userId: string,
  now = Date.now(),
): Promise<CommunityDeletionManifestEntry[]> {
  const [sessions, staging, images, videos, chatImages] = await Promise.all([
    listDurableSessions(admin, userId),
    listExactUserPrefix(admin, "community-media-staging", userId),
    listExactUserPrefix(admin, "community-images", userId),
    listExactUserPrefix(admin, "community-videos", userId),
    inventoryChatImageQuarantine(admin, userId, now),
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
  const manifest = [...communityManifest, ...chatImages].sort((left, right) =>
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
    && ["session_staging", "session_final", "legacy_prefix", "quarantine"]
      .includes(String(row.source))
    && typeof row.not_before === "string"
    && Number.isFinite(Date.parse(row.not_before))
    && (typeof row.cleaned_at === "string" || row.cleaned_at === null);
}

function assertExactManifestPath(row: AccountDeletionManifestRow, job: AccountDeletionJob) {
  if (!job.user_id || row.job_id !== job.id) {
    throw new AccountDeletionStorageError("worker_manifest_invalid");
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
    // 사진 버킷도 지운다 — 매니페스트에 `chat_message` 행이 들어오기 때문이다.
    bucket: AccountDeletionBucket,
    batch: AccountDeletionManifestRow[],
  ) => {
    const paths = batch.map((row) => row.path);
    // A remove error alone is not decisive: a previous attempt may already
    // have removed the object. Exact absence checks below are the boundary.
    await admin.storage.from(bucket).remove(paths);
    for (const row of batch) {
      // **`exists()` 는 정상적인 "없음"에도 오류를 함께 준다.**
      //
      // 스테이징 실측(2026-09-02, storage-js 2.103.0):
      //
      //     있을 때  exists → { data: true,  error: null }
      //     없을 때  exists → { data: false, error: { status: 400, "Bad Request" } }
      //     없을 때  info   → { data: null,  error: { statusCode: "404", "Object not found" } }
      //
      // 예전 코드는 `if (existsError) throw` 였다. 그래서 **객체를 지운 직후
      // 부재를 확인할 때마다** `storage_absence_check_unavailable` 을 던졌고,
      // 그 코드는 `MANUAL_REVIEW_CODES` 에 없어 재시도로 돌아갔다. 결과:
      // **파일이 하나라도 있는 계정은 탈퇴가 절대 끝나지 않고**, 크론이 5분마다
      // 영원히 재시도한다. 커뮤니티 이미지든 채팅 사진이든 같다.
      //
      // 저장소에 이미 옳은 술어가 있다(`api/chat/messages/route.ts` 의
      // `isMissingStorageObject`) — 404 를 "정말 없다" 로, 나머지 오류를
      // "모르겠다" 로 가른다. 같은 판정을 여기서도 쓴다.
      //
      // 이 버그를 테스트가 못 잡은 이유: mock 이 `exists` 를
      // `{ data: false, error: null }` 로 흉내냈다. **운영이 만드는 입력과
      // 달랐다.**
      const { data: info, error: infoError } = await admin.storage
        .from(bucket)
        .info(row.path);
      if (infoError && !isMissingStorageObject(infoError)) {
        throw new AccountDeletionStorageError("storage_absence_check_unavailable");
      }
      if (!infoError && info) {
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
  // **사진 버킷도 돈다.** 매니페스트에 `chat_message` 행이 들어오는데 이 루프가
  // 커뮤니티 버킷만 돌면, 그 행이 `cleaned_at IS NULL` 로 남아
  // `prepare_account_deletion_auth_delete` 에 걸려 영원히 대기한다.
  // 격리(`quarantine`)로 남은 사진은 애초에 `manual_review` 로 빠지므로
  // 여기까지 오지 않는다.
  for (const bucket of ACCOUNT_DELETION_BUCKETS) {
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
  for (const bucket of COMMUNITY_DELETION_BUCKETS) {
    const remainingNames = await listExactUserPrefix(admin, bucket, job.user_id!);
    for (const name of remainingNames) {
      assertSafeListedName(name);
      const remainingPath = `${job.user_id}/${name}`;
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
    for (const bucket of COMMUNITY_DELETION_BUCKETS) {
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
      // **주소를 아는 유일한 순간이 여기다.**
      //
      // 가입 이메일은 `auth.users` 에만 있고 바로 다음 줄에서 사라진다. 법이
      // 요구하는 결과 통지(개인정보 보호법 제36조 2항 · 시행령 제43조 3항)를
      // 보내려면 지금 옮겨 놓아야 한다. 보관은 통지가 나가면 즉시 끝나고,
      // "보냈는데 주소가 남는" 상태는 DB CHECK 가 금지한다.
      //
      // 실패해도 삭제를 막지 않는다 — 통지 실패로 삭제가 멈추면 사용자는
      // 지워지지도 않고 연락도 못 받는다. 둘 다 잃는 쪽이 더 나쁘다.
      const email = authLookup.data.user.email;
      if (typeof email === "string" && email.length > 0) {
        await admin
          .rpc("pin_account_deletion_notice_email", {
            p_job_id: job.id,
            p_claim_token: claimToken,
            p_email: email,
          })
          .then(
            () => undefined,
            () => undefined,
          );
      }

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

    // **삭제가 끝난 뒤에 알린다.** 순서가 반대면 "지웠다" 고 말해 놓고 실패할 수
    // 있다. 통지 실패는 삭제를 되돌리지 않고, 다음 크론이 최대 3회까지 다시
    // 시도한 뒤 주소를 버린다.
    await sendAccountDeletionNotice(admin, job.id);

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
