import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PHOTO_LIKE_BODY_BYTES = 4 * 1024;
const MAX_PHOTO_URL_LENGTH = 2048;
const PRIVATE_NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE_HEADERS });
}

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

// 사진 좋아요 토글
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isTrustedMutationRequest(req)) {
      return json({ error: "잘못된 요청 출처입니다." }, 403);
    }
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return json({ error: "인증이 필요합니다." }, 401);
    }

    const rlResult = checkRateLimit(
      rateLimitKey("vendors:photo-like", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 }
    );
    if (rlResult) {
      rlResult.headers.set("Cache-Control", PRIVATE_NO_STORE_HEADERS["Cache-Control"]);
      return rlResult;
    }

    if (isBodyTooLarge(req, MAX_PHOTO_LIKE_BODY_BYTES)) {
      return json({ error: "요청이 너무 큽니다." }, 413);
    }

    const { id: vendorId } = await params;
    if (!isUuid(vendorId)) {
      return json({ error: "vendorId가 올바르지 않습니다." }, 400);
    }

    const body = await req.json().catch(() => null);
    if (!isRecord(body)) {
      return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
    }

    const photoUrl = normalizePhotoUrl(body.photoUrl);
    if (!photoUrl) {
      return json({ error: "photoUrl이 필요합니다." }, 400);
    }

    // 이미 좋아요했는지 확인
    const { data: existing, error: lookupError } = await supabase
      .from("vendor_photo_likes")
      .select("id")
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId)
      .eq("photo_url", photoUrl)
      .maybeSingle();

    if (lookupError) {
      return json({ error: "좋아요 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
    }

    if (existing) {
      const { error } = await supabase
        .from("vendor_photo_likes")
        .delete()
        .eq("id", existing.id);
      if (error) return json({ error: "좋아요 변경을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
      return json({ liked: false });
    } else {
      const { error } = await supabase
        .from("vendor_photo_likes")
        .insert({ user_id: user.id, vendor_id: vendorId, photo_url: photoUrl });
      if (error) return json({ error: "좋아요 변경을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
      return json({ liked: true });
    }
  } catch (err) {
    log.error("api/vendors/[id]/photos", err);
    console.error("Photo like toggle error:", err);
    return json({ error: "서버 오류" }, 500);
  }
}

// 내 좋아요 목록 조회 (특정 업체)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClientFromRequest(_req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return json({ likedPhotos: [] });
    }

    const { id: vendorId } = await params;
    if (!isUuid(vendorId)) {
      return json({ likedPhotos: [] }, 400);
    }

    const { data: likes, error } = await supabase
      .from("vendor_photo_likes")
      .select("photo_url")
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId);

    if (error) {
      return json({ error: "좋아요 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
    }
    const likedPhotos = (likes ?? []).map((l) => l.photo_url);
    return json({ likedPhotos });
  } catch (err) {
    console.error("Photo likes list error:", err);
    return json({ error: "좋아요 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}
