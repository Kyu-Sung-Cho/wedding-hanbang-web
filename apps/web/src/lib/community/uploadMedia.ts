import { createClient } from "@/lib/supabase/client";
import {
  COMMUNITY_MEDIA_RULES,
  COMMUNITY_STAGING_BUCKET,
  isValidCommunityMediaSize,
  normalizeCommunityMimeType,
  type CommunityMediaType,
  type CommunityMimeType,
} from "./uploadPolicy";

export interface CommunityUploadResult {
  url: string;
  type: CommunityMediaType;
}

interface SignedUploadInit {
  uploadId: string;
  bucket: typeof COMMUNITY_STAGING_BUCKET;
  path: string;
  token: string;
  expiresAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferMimeType(file: File): CommunityMimeType | null {
  const declared = normalizeCommunityMimeType(file.type);
  if (declared) return declared;
  const extension = file.name.toLowerCase().split(".").pop();
  const inferred: Record<string, CommunityMimeType> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return extension ? inferred[extension] ?? null : null;
}

function parseInit(value: unknown, mimeType: CommunityMimeType): SignedUploadInit | null {
  if (!isRecord(value)) return null;
  const uploadId = value.uploadId;
  const path = value.path;
  const expiresAt = value.expiresAt;
  if (typeof uploadId !== "string" || !UUID_RE.test(uploadId)
      || value.bucket !== COMMUNITY_STAGING_BUCKET
      || typeof path !== "string"
      || typeof value.token !== "string" || value.token.length < 8 || value.token.length > 4096
      || typeof expiresAt !== "string" || Date.parse(expiresAt) <= Date.now()) {
    return null;
  }
  const expectedPath = new RegExp(
    `^[0-9a-f-]{36}/${uploadId.replace(/-/g, "\\-")}\\.${COMMUNITY_MEDIA_RULES[mimeType].extension}$`,
    "i",
  );
  if (!expectedPath.test(path)) return null;
  return {
    uploadId,
    bucket: COMMUNITY_STAGING_BUCKET,
    path,
    token: value.token,
    expiresAt,
  };
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  const value = await response.json().catch(() => null);
  return isRecord(value) ? value : null;
}

function apiError(data: Record<string, unknown> | null, fallback: string) {
  return typeof data?.error === "string" && data.error.length <= 300 ? data.error : fallback;
}

async function finalize(uploadId: string): Promise<CommunityUploadResult> {
  let lastError = "업로드 확인에 실패했어요.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("/api/community/upload/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });
      const data = await responseJson(response);
      if (response.ok
          && typeof data?.url === "string"
          && (data.type === "image" || data.type === "gif")) {
        return { url: data.url, type: data.type };
      }
      lastError = apiError(data, lastError);
      const retryable = response.status === 409 || response.status >= 500;
      if (!retryable || attempt === 2) break;
    } catch {
      if (attempt === 2) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(lastError);
}

export async function uploadCommunityMedia(file: File): Promise<CommunityUploadResult> {
  const mimeType = inferMimeType(file);
  if (!mimeType || !isValidCommunityMediaSize(mimeType, file.size)) {
    throw new Error("지원하는 파일 형식과 용량을 확인해 주세요.");
  }
  const uploadBody = file.type === mimeType
    ? file
    : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });

  const initResponse = await fetch("/api/community/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mimeType, size: uploadBody.size }),
  });
  const initData = await responseJson(initResponse);
  if (!initResponse.ok) {
    throw new Error(apiError(initData, "업로드 준비에 실패했어요."));
  }
  const signed = parseInit(initData, mimeType);
  if (!signed) throw new Error("업로드 준비 응답을 확인할 수 없어요.");

  const supabase = createClient();
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, uploadBody, {
      cacheControl: "31536000",
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw new Error("파일 전송에 실패했어요. 연결을 확인하고 다시 시도해 주세요.");

  return finalize(signed.uploadId);
}
