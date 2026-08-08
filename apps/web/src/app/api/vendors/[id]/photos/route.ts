import { createClientFromRequest } from "@/lib/supabase/server";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PHOTO_LIKE_BODY_BYTES = 4 * 1024;
const MAX_PHOTO_URL_LENGTH = 2048;

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
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const rlResult = checkRateLimit(
      rateLimitKey("vendors:photo-like", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 }
    );
    if (rlResult) return rlResult;

    if (isBodyTooLarge(req, MAX_PHOTO_LIKE_BODY_BYTES)) {
      return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
    }

    const { id: vendorId } = await params;
    if (!isUuid(vendorId)) {
      return NextResponse.json({ error: "vendorId가 올바르지 않습니다." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const photoUrl = normalizePhotoUrl(body.photoUrl);
    if (!photoUrl) {
      return NextResponse.json({ error: "photoUrl이 필요합니다." }, { status: 400 });
    }

    // 이미 좋아요했는지 확인
    const { data: existing } = await supabase
      .from("vendor_photo_likes")
      .select("id")
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId)
      .eq("photo_url", photoUrl)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("vendor_photo_likes")
        .delete()
        .eq("id", existing.id);
      return NextResponse.json({ liked: false });
    } else {
      await supabase
        .from("vendor_photo_likes")
        .insert({ user_id: user.id, vendor_id: vendorId, photo_url: photoUrl });
      return NextResponse.json({ liked: true });
    }
  } catch (err) {
    console.error("Photo like toggle error:", err);
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

    const { id: vendorId } = await params;
    if (!isUuid(vendorId)) {
      return NextResponse.json({ likedPhotos: [] }, { status: 400 });
    }

    const { data: likes } = await supabase
      .from("vendor_photo_likes")
      .select("photo_url")
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId);

    const likedPhotos = (likes ?? []).map((l) => l.photo_url);
    return NextResponse.json({ likedPhotos });
  } catch (err) {
    console.error("Photo likes list error:", err);
    return NextResponse.json({ likedPhotos: [] });
  }
}
