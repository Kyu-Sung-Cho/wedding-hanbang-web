import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import crypto from "crypto";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

// 이미지 업로드
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Rate limit: 20 uploads per 10 minutes per user
    const rlResult = checkRateLimit(
      rateLimitKey("community:upload", req, user.id),
      { maxRequests: 20, windowMs: 10 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const serviceClient = getServiceClient();

    // 일일 업로드 쿼터 확인 (유저 폴더 내 최대 50개/일)
    const today = new Date().toISOString().split("T")[0];
    const { data: existingFiles } = await serviceClient.storage
      .from("community-images")
      .list(`community-images/${user.id}`, { limit: 100 });

    // 파일 수 기반 일일 쿼터 체크 (간이 방식)
    if (existingFiles && existingFiles.length >= 50) {
      const todayFiles = existingFiles.filter(
        (f) => f.created_at && f.created_at.startsWith(today)
      );
      if (todayFiles.length >= 50) {
        return NextResponse.json(
          { error: "일일 업로드 한도(50개)를 초과했습니다." },
          { status: 429 }
        );
      }
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "파일을 선택해주세요." },
        { status: 400 }
      );
    }

    // 파일 타입 검증
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "지원하지 않는 파일 형식입니다. (JPEG, PNG, GIF, WebP만 가능)" },
        { status: 400 }
      );
    }

    // 파일 크기 검증
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "파일 크기는 5MB 이하여야 합니다." },
        { status: 400 }
      );
    }

    const ext = EXT_MAP[file.type] ?? "jpg";
    const timestamp = Date.now();
    const random = crypto.randomUUID();
    const filePath = `community-images/${user.id}/${timestamp}_${random}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    // 매직 바이트 검증 (파일 내용 기반 실제 형식 확인)
    const bytes = new Uint8Array(buffer.slice(0, 12));
    const isJPEG = bytes[0] === 0xFF && bytes[1] === 0xD8;
    const isPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const isGIF = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    const isWEBP = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!isJPEG && !isPNG && !isGIF && !isWEBP) {
      return NextResponse.json({ error: "지원하지 않는 파일 형식입니다." }, { status: 400 });
    }

    // service role 클라이언트로 스토리지 업로드 (RLS 우회) — 이미 위에서 생성됨
    const { error: uploadError } = await serviceClient.storage
      .from("community-images")
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json(
        { error: "파일 업로드에 실패했습니다." },
        { status: 500 }
      );
    }

    // 공개 URL 생성
    const {
      data: { publicUrl },
    } = serviceClient.storage
      .from("community-images")
      .getPublicUrl(filePath);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
