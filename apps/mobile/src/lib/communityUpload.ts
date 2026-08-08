import { apiFetchForExpectedUser } from "./api";
import { supabase } from "./supabase";

const STAGING_BUCKET = "community-media-staging" as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOBILE_MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const FINALIZE_MAX_ATTEMPTS = 3;
const FINALIZE_MAX_DELAY_MS = 2_000;
const MEDIA_RULES = {
  "image/jpeg": { extension: "jpg", maxBytes: 5 * 1024 * 1024 },
  "image/png": { extension: "png", maxBytes: 5 * 1024 * 1024 },
  "image/gif": { extension: "gif", maxBytes: MOBILE_MAX_UPLOAD_BYTES },
  "image/webp": { extension: "webp", maxBytes: 5 * 1024 * 1024 },
} as const;

type CommunityMimeType = keyof typeof MEDIA_RULES;

export interface CommunityUploadAsset {
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

interface SignedUploadInit {
  uploadId: string;
  bucket: typeof STAGING_BUCKET;
  path: string;
  token: string;
  expiresAt: string;
}

export interface CommunityUploadResult {
  url: string;
  type: "image" | "gif";
}

function normalizeMimeType(value: string): CommunityMimeType | null {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized && normalized in MEDIA_RULES ? normalized as CommunityMimeType : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSignedUpload(
  value: unknown,
  mimeType: CommunityMimeType,
  expectedUserId: string,
): value is SignedUploadInit {
  if (!isRecord(value)
      || typeof value.uploadId !== "string" || !UUID_RE.test(value.uploadId)
      || value.bucket !== STAGING_BUCKET
      || typeof value.path !== "string"
      || typeof value.token !== "string" || value.token.length < 8
      || typeof value.expiresAt !== "string" || Date.parse(value.expiresAt) <= Date.now()) {
    return false;
  }
  return value.path.toLowerCase() === (
    `${expectedUserId}/${value.uploadId}.${MEDIA_RULES[mimeType].extension}`
  ).toLowerCase();
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  const value: unknown = await response.json().catch(() => null);
  return isRecord(value) ? value : null;
}

async function verifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id.toLowerCase() ?? null;
}

async function assertExpectedUser(expectedUserId: string): Promise<void> {
  if (await verifiedUserId() !== expectedUserId.toLowerCase()) {
    throw new Error("계정이 바뀌어 업로드를 중단했어요. 다시 선택해 주세요.");
  }
}

async function finalizeWithRetry(
  uploadId: string,
  expectedUserId: string,
): Promise<CommunityUploadResult> {
  let lastError = "업로드 완료를 확인하지 못했어요.";
  for (let attempt = 0; attempt < FINALIZE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await assertExpectedUser(expectedUserId);
      const response = await apiFetchForExpectedUser(
        expectedUserId,
        "/api/community/upload/finalize",
        {
          method: "POST",
          body: JSON.stringify({ uploadId }),
        },
      );
      const finalized = await responseJson(response);
      if (response.ok
          && typeof finalized?.url === "string"
          && (finalized.type === "image" || finalized.type === "gif")) {
        await assertExpectedUser(expectedUserId);
        return { url: finalized.url, type: finalized.type };
      }

      if (typeof finalized?.error === "string" && finalized.error.length <= 300) {
        lastError = finalized.error;
      }
      const retryable = response.status === 409 || response.status >= 500;
      if (!retryable || attempt === FINALIZE_MAX_ATTEMPTS - 1) break;

      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? retryAfterSeconds * 1_000
        : 250 * (attempt + 1);
      await new Promise((resolve) => setTimeout(
        resolve,
        Math.min(retryAfterMs, FINALIZE_MAX_DELAY_MS),
      ));
    } catch (error) {
      if (
        error instanceof Error
        && (
          error.message === "API_SESSION_OWNER_MISMATCH"
          || error.message.startsWith("계정이 바뀌어")
        )
      ) {
        throw error;
      }
      if (attempt === FINALIZE_MAX_ATTEMPTS - 1) break;
      const retryAfterMs = 250 * (attempt + 1);
      await new Promise((resolve) => setTimeout(
        resolve,
        Math.min(retryAfterMs, FINALIZE_MAX_DELAY_MS),
      ));
    }
  }
  throw new Error(lastError);
}

export async function uploadCommunityMedia(
  asset: CommunityUploadAsset,
): Promise<CommunityUploadResult> {
  const mimeType = normalizeMimeType(asset.mimeType);
  if (!mimeType) throw new Error("지원하지 않는 파일 형식이에요.");
  if (typeof asset.fileSize !== "number"
      || !Number.isSafeInteger(asset.fileSize)
      || asset.fileSize <= 0
      || asset.fileSize > MOBILE_MAX_UPLOAD_BYTES
      || asset.fileSize > MEDIA_RULES[mimeType].maxBytes) {
    throw new Error("파일 용량을 확인할 수 없거나 너무 커요. 사진을 다시 선택해 주세요.");
  }

  const ownerUserId = await verifiedUserId();
  if (!ownerUserId) throw new Error("로그인이 필요해요.");

  const localResponse = await fetch(asset.uri);
  if (!localResponse.ok && localResponse.status !== 0) {
    throw new Error("선택한 파일을 읽지 못했어요.");
  }
  const bytes = await localResponse.arrayBuffer();
  if (bytes.byteLength <= 0
      || bytes.byteLength > MOBILE_MAX_UPLOAD_BYTES
      || bytes.byteLength > MEDIA_RULES[mimeType].maxBytes) {
    throw new Error("파일 용량을 확인해 주세요.");
  }

  const initResponse = await apiFetchForExpectedUser(
    ownerUserId,
    "/api/community/upload",
    {
      method: "POST",
      body: JSON.stringify({ mimeType, size: bytes.byteLength }),
    },
  );
  const signed: unknown = await initResponse.json().catch(() => null);
  if (!initResponse.ok || !isValidSignedUpload(signed, mimeType, ownerUserId)) {
    throw new Error("업로드 준비 응답을 확인할 수 없어요.");
  }

  await assertExpectedUser(ownerUserId);
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, bytes, {
      cacheControl: "31536000",
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw new Error("파일 전송에 실패했어요. 다시 시도해 주세요.");

  await assertExpectedUser(ownerUserId);
  return finalizeWithRetry(signed.uploadId, ownerUserId);
}
