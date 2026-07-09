import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import crypto from "crypto";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_GIF_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const rlResult = checkRateLimit(
      rateLimitKey("community:upload", req, user.id),
      { maxRequests: 20, windowMs: 10 * 60 * 1000 }
    );
    if (rlResult) return rlResult;

    const serviceClient = getServiceClient();
    const storageClient = serviceClient ?? supabase;

    const today = new Date().toISOString().split("T")[0];
    const [imageList, videoList] = await Promise.allSettled([
      storageClient.storage.from("community-images").list(user.id, { limit: 100 }),
      storageClient.storage.from("community-videos").list(user.id, { limit: 100 }),
    ]);
    const imageFiles =
      imageList.status === "fulfilled" && !imageList.value.error
        ? imageList.value.data
        : [];
    const videoFiles =
      videoList.status === "fulfilled" && !videoList.value.error
        ? videoList.value.data
        : [];

    const allFiles = [...(imageFiles ?? []), ...(videoFiles ?? [])];
    if (allFiles.length >= 50) {
      const todayFiles = allFiles.filter(
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
      return NextResponse.json({ error: "파일을 선택해주세요." }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "지원하지 않는 파일 형식입니다. JPEG, PNG, GIF, WebP, MP4, MOV, WebM만 업로드할 수 있어요." },
        { status: 400 }
      );
    }

    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
    const isGif = file.type === "image/gif";
    const maxSize = isVideo ? MAX_VIDEO_SIZE : isGif ? MAX_GIF_SIZE : MAX_IMAGE_SIZE;

    if (file.size > maxSize) {
      const sizeMsg = isVideo
        ? "동영상은 50MB 이하로 업로드할 수 있어요."
        : isGif
          ? "GIF는 10MB 이하로 업로드할 수 있어요."
          : "이미지는 5MB 이하로 업로드할 수 있어요.";
      return NextResponse.json({ error: sizeMsg }, { status: 400 });
    }

    const ext = EXT_MAP[file.type] ?? "jpg";
    const timestamp = Date.now();
    const random = crypto.randomUUID();
    const bucket = isVideo ? "community-videos" : "community-images";
    const filePath = `${user.id}/${timestamp}_${random}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const bytes = new Uint8Array(buffer.slice(0, 12));
    const isJPEG = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isGIF = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    const isWEBP = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    const isFtyp = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    const isEBML = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    const isValidImage = isJPEG || isPNG || isGIF || isWEBP;
    const isValidVideo = isFtyp || isEBML;

    if (!isValidImage && !isValidVideo) {
      return NextResponse.json({ error: "파일 내용이 지원 형식과 일치하지 않습니다." }, { status: 400 });
    }

    let uploadClient = storageClient;
    let { error: uploadError } = await uploadClient.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError && serviceClient) {
      console.warn("[community upload] service upload failed; retrying with user session:", uploadError);
      uploadClient = supabase;
      const retry = await uploadClient.storage
        .from(bucket)
        .upload(filePath, buffer, {
          contentType: file.type,
          upsert: false,
        });
      uploadError = retry.error;
    }

    if (uploadError) {
      console.error("[community upload] upload error:", uploadError);
      return NextResponse.json({ error: "파일 업로드에 실패했습니다." }, { status: 500 });
    }

    const {
      data: { publicUrl },
    } = uploadClient.storage.from(bucket).getPublicUrl(filePath);

    const fileType: "image" | "video" | "gif" = isVideo ? "video" : isGif ? "gif" : "image";

    return NextResponse.json({ url: publicUrl, type: fileType });
  } catch (err) {
    console.error("[community upload] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
