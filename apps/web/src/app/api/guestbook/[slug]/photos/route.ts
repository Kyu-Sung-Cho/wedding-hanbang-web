import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const MAX_PHOTOS_PER_GUESTBOOK = 30;
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/**
 * POST: 결혼식 사진 업로드 (오너만)
 * multipart/form-data: file, caption?
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    // Rate limit: 30/시간/유저 — 빠른 연속 업로드 허용하면서도 어뷰징 방지
    const rl = checkRateLimit(
      rateLimitKey("guestbook:photo:upload", req, user.id),
      { maxRequests: 30, windowMs: 60 * 60 * 1000 }
    );
    if (rl) return rl;

    const service = getServiceClient();

    // 오너 검증
    const { data: gb } = await service
      .from("guestbooks")
      .select("id, owner_id")
      .eq("slug", slug)
      .maybeSingle();

    if (!gb) {
      return NextResponse.json({ error: "방명록을 찾을 수 없습니다." }, { status: 404 });
    }
    if (gb.owner_id !== user.id) {
      return NextResponse.json(
        { error: "본인 방명록만 사진을 추가할 수 있습니다." },
        { status: 403 }
      );
    }

    // 한도 체크
    const { count: existingCount } = await service
      .from("guestbook_photos")
      .select("id", { count: "exact", head: true })
      .eq("guestbook_id", gb.id);

    if ((existingCount ?? 0) >= MAX_PHOTOS_PER_GUESTBOOK) {
      return NextResponse.json(
        { error: `최대 ${MAX_PHOTOS_PER_GUESTBOOK}장까지 올릴 수 있어요.` },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const captionRaw = formData.get("caption");
    const caption =
      typeof captionRaw === "string" && captionRaw.trim().length > 0
        ? captionRaw.trim().slice(0, 100)
        : null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일을 선택해주세요." }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "사진은 JPEG, PNG, WebP, HEIC만 업로드할 수 있어요." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "사진 크기는 5MB 이하여야 합니다." },
        { status: 400 }
      );
    }

    // 매직 바이트 검증
    const buffer = Buffer.from(await file.arrayBuffer());
    const bytes = new Uint8Array(buffer.slice(0, 12));
    const isJPEG = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPNG =
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isWEBP =
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
    const isHEIC =
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;

    if (!isJPEG && !isPNG && !isWEBP && !isHEIC) {
      return NextResponse.json(
        { error: "지원하지 않는 파일 형식입니다." },
        { status: 400 }
      );
    }

    const ext = EXT_MAP[file.type] ?? "jpg";
    const ts = Date.now();
    const random = crypto.randomUUID();
    const filePath = `wedding_photos/${gb.id}/${ts}_${random}.${ext}`;

    const { error: uploadError } = await service.storage
      .from("guestbook-uploads")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[guestbook photo upload] error:", uploadError);
      return NextResponse.json(
        { error: "사진 업로드에 실패했습니다." },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = service.storage.from("guestbook-uploads").getPublicUrl(filePath);

    // DB 레코드 — 다음 position
    const nextPosition = (existingCount ?? 0);
    const { data: row, error: insertError } = await service
      .from("guestbook_photos")
      .insert({
        guestbook_id: gb.id,
        url: publicUrl,
        caption,
        position: nextPosition,
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("[guestbook photo insert] error:", insertError);
      // 업로드 롤백 (best effort)
      void service.storage.from("guestbook-uploads").remove([filePath]);
      return NextResponse.json(
        { error: "사진 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ photo: row }, { status: 201 });
  } catch (err) {
    console.error("[guestbook photos POST] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
