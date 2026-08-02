import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { PrivateNextResponse as NextResponse } from "@/lib/http/privateResponse";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  readBoundedJsonValue,
} from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PHOTO_LIKE_BODY_BYTES = 4 * 1024;
const MAX_PHOTO_URL_LENGTH = 2048;
const PHOTO_LIKE_WRITE_RATE = { maxRequests: 60, windowMs: 60 * 1000 };
const PHOTO_LIKE_READ_RATE = { maxRequests: 120, windowMs: 60 * 1000 };

type PhotoLikeRpcPayload = {
  success?: unknown;
  liked?: unknown;
  liked_photos?: unknown;
  error_code?: unknown;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function normalizePhotoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_PHOTO_URL_LENGTH) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function asPhotoLikePayload(value: unknown): PhotoLikeRpcPayload | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PhotoLikeRpcPayload)
    : null;
}

// 사진 좋아요 토글
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("vendors:photo-like", req, user.id),
      PHOTO_LIKE_WRITE_RATE,
    );
    if (rlResult) return rlResult;

    if (isBodyTooLarge(req, MAX_PHOTO_LIKE_BODY_BYTES)) {
      return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
    }

    const { id: vendorId } = await params;
    if (!isUuid(vendorId)) {
      return NextResponse.json({ error: "vendorId가 올바르지 않습니다." }, { status: 400 });
    }

    const bodyResult = await readBoundedJsonValue(req, MAX_PHOTO_LIKE_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청이 너무 큽니다." : "요청 형식이 올바르지 않습니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const body = bodyResult.value;
    if (!isRecord(body)) {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const photoUrl = normalizePhotoUrl(body.photoUrl);
    if (!photoUrl) {
      return NextResponse.json({ error: "photoUrl이 필요합니다." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("toggle_vendor_photo_like_service_v1", {
      p_user_id: user.id,
      p_vendor_id: vendorId,
      p_photo_url: photoUrl,
    });
    if (error) {
      console.error("Photo like toggle persistence error", safeErrorDiagnostic(error));
      return NextResponse.json({ error: "사진 좋아요를 변경하지 못했습니다." }, { status: 500 });
    }

    const result = asPhotoLikePayload(data);
    if (!result || result.success !== true || typeof result.liked !== "boolean") {
      const code = typeof result?.error_code === "string" ? result.error_code : "";
      if (code === "PHOTO_LIKE_LIMIT_REACHED") {
        return NextResponse.json({ error: "저장할 수 있는 사진 수를 초과했습니다." }, { status: 429 });
      }
      if (code === "PHOTO_NOT_PUBLISHED" || code === "INVALID_PHOTO_REFERENCE") {
        return NextResponse.json({ error: "공개된 업체 사진만 저장할 수 있습니다." }, { status: 400 });
      }
      console.error("Photo like toggle returned an invalid contract", { code });
      return NextResponse.json({ error: "사진 좋아요를 변경하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ liked: result.liked });
  } catch (err) {
    console.error("Photo like toggle error", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

// 내 좋아요 목록 조회 (특정 업체)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClientFromRequest(_req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ likedPhotos: [] });
    }

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("vendors:photo-like:read", _req, user.id),
      PHOTO_LIKE_READ_RATE,
    );
    if (rlResult) return rlResult;

    const { id: vendorId } = await params;
    if (!isUuid(vendorId)) {
      return NextResponse.json({ likedPhotos: [] }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("list_vendor_photo_likes_service_v1", {
      p_user_id: user.id,
      p_vendor_id: vendorId,
    });
    if (error) {
      console.error("Photo likes list persistence error", safeErrorDiagnostic(error));
      return NextResponse.json({ likedPhotos: [] }, { status: 500 });
    }

    const result = asPhotoLikePayload(data);
    if (
      !result ||
      result.success !== true ||
      !Array.isArray(result.liked_photos) ||
      result.liked_photos.some((photo) => typeof photo !== "string")
    ) {
      console.error("Photo likes list returned an invalid contract");
      return NextResponse.json({ likedPhotos: [] }, { status: 500 });
    }

    const likedPhotos = result.liked_photos as string[];
    return NextResponse.json({ likedPhotos });
  } catch (err) {
    console.error("Photo likes list error", safeErrorDiagnostic(err));
    return NextResponse.json({ likedPhotos: [] });
  }
}
