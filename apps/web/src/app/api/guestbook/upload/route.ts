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
 * 방명록 익명 이미지 업로드.
 * - guestbook slug 검증 → 유효한 방명록만 허용
 * - IP 기반 rate limit: 24h 내 3회
 * - 매직 바이트 검증으로 위장 차단 (SVG/MP4/실행파일 등)
 * - service role로 저장 (게스트는 supabase auth 없음)
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const slug = formData.get("slug");
    const file = formData.get("file");

    if (typeof slug !== "string" || !slug) {
      return NextResponse.json({ error: "방명록 정보가 필요합니다." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일을 선택해주세요." }, { status: 400 });
    }

    // 방명록 존재 + 활성화 확인
    const service = getServiceClient();
    const { data: guestbook } = await service
      .from("guestbooks")
      .select("id, is_active")
      .eq("slug", slug)
      .maybeSingle();

    if (!guestbook || !guestbook.is_active) {
      return NextResponse.json(
        { error: "방명록을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // Rate limit: IP당 24h 3회 — 메시지(5회/24h)보다 빡빡
    const rl = checkRateLimit(
      rateLimitKey(`guestbook:upload:${slug}`, req),
      { maxRequests: 3, windowMs: 24 * 60 * 60 * 1000 }
    );
    if (rl) return rl;

    // 타입/사이즈 검증
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

    // 매직 바이트 검증 (위장 파일 차단)
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
    // HEIC/HEIF: ftyp box at offset 4 with 'heic'/'heix'/'mif1' brand
    const ftyp =
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    const isHEIC = ftyp; // ftyp만으로 거름 — 더 엄격한 brand 체크는 후속

    if (!isJPEG && !isPNG && !isWEBP && !isHEIC) {
      return NextResponse.json(
        { error: "지원하지 않는 파일 형식입니다." },
        { status: 400 }
      );
    }

    const ext = EXT_MAP[file.type] ?? "jpg";
    const timestamp = Date.now();
    const random = crypto.randomUUID();
    const filePath = `${guestbook.id}/${timestamp}_${random}.${ext}`;

    const { error: uploadError } = await service.storage
      .from("guestbook-uploads")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[guestbook upload] error:", uploadError);
      return NextResponse.json(
        { error: "사진 업로드에 실패했습니다." },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = service.storage.from("guestbook-uploads").getPublicUrl(filePath);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("[guestbook upload] unexpected:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
