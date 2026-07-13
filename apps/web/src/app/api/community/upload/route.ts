import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import crypto from "crypto";
import { validateDecodedCommunityImage } from "@/lib/community/imageValidation";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_GIF_SIZE = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_GIF_SIZE + 1024 * 1024;
const DAILY_UPLOAD_LIMIT = 20;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
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
    if (!serviceClient) {
      return NextResponse.json(
        { error: "업로드 보안 설정을 확인할 수 없습니다." },
        { status: 503 }
      );
    }
    const storageClient = serviceClient;
    const { data: activeProfile, error: activeProfileError } = await storageClient
      .from("profiles")
      .select("account_deleting_at")
      .eq("id", user.id)
      .maybeSingle();
    if (activeProfileError || !activeProfile || activeProfile.account_deleting_at) {
      return NextResponse.json(
        { error: "계정 상태를 확인할 수 없어 업로드를 시작하지 않았습니다." },
        { status: 409 }
      );
    }

    const contentLength = Number(req.headers.get("content-length"));
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return NextResponse.json(
        { error: "업로드 크기를 확인할 수 없습니다." },
        { status: 411 }
      );
    }
    if (contentLength > MAX_MULTIPART_BYTES) {
      return NextResponse.json(
        { error: "업로드 요청이 너무 큽니다." },
        { status: 413 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일을 선택해주세요." }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "영상 업로드는 안전한 스트리밍 검증을 준비 중입니다. JPEG, PNG, GIF, WebP 이미지만 업로드할 수 있어요." },
        { status: 415 }
      );
    }

    const isGif = file.type === "image/gif";
    const maxSize = isGif ? MAX_GIF_SIZE : MAX_IMAGE_SIZE;

    if (file.size > maxSize) {
      const sizeMsg = isGif
        ? "GIF는 10MB 이하로 업로드할 수 있어요."
        : "이미지는 5MB 이하로 업로드할 수 있어요.";
      return NextResponse.json({ error: sizeMsg }, { status: 400 });
    }

    const ext = EXT_MAP[file.type] ?? "jpg";
    const today = new Date().toISOString().split("T")[0];
    const dailyPrefix = `${user.id}/${today}`;
    const bucket = "community-images";

    const buffer = Buffer.from(await file.arrayBuffer());
    const bytes = new Uint8Array(buffer.slice(0, 12));
    const isJPEG = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isGIF = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
    const isWEBP = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    const detectedType = isJPEG
      ? "image/jpeg"
      : isPNG
        ? "image/png"
        : isGIF
          ? "image/gif"
          : isWEBP
            ? "image/webp"
            : null;

    if (detectedType !== file.type) {
      return NextResponse.json({ error: "파일 내용이 지원 형식과 일치하지 않습니다." }, { status: 400 });
    }

    const imageValidationError = await validateDecodedCommunityImage(buffer, file.type);
    if (imageValidationError) {
      return NextResponse.json({ error: imageValidationError }, { status: 400 });
    }

    // Same bytes on the same UTC day map to one object and one quota row.
    // This makes client/network retries recoverable without duplicating a
    // public object or consuming another daily slot.
    const contentHash = crypto
      .createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
      .update(user.id)
      .update("\0")
      .update(today)
      .update("\0")
      .update(buffer)
      .digest("hex");
    const objectName = `${contentHash}.${ext}`;
    const filePath = `${dailyPrefix}/${objectName}`;

    const { data: reservationData, error: reservationError } = await serviceClient.rpc(
      "reserve_community_upload",
      {
        p_user_id: user.id,
        p_object_path: filePath,
        p_daily_limit: DAILY_UPLOAD_LIMIT,
      }
    );
    if (reservationError) {
      console.error("[community upload] quota reservation failed");
      return NextResponse.json(
        { error: "업로드 사용량을 안전하게 예약할 수 없습니다." },
        { status: 503 }
      );
    }
    const reservation = Array.isArray(reservationData)
      ? reservationData[0]
      : reservationData;
    if (!reservation?.allowed || typeof reservation.reservation_id !== "string") {
      if (reservation?.reason === "daily_quota") {
        return NextResponse.json(
          { error: `일일 업로드 한도(${DAILY_UPLOAD_LIMIT}개)를 초과했습니다.` },
          { status: 429 }
        );
      }
      if (reservation?.reason === "in_progress") {
        return NextResponse.json(
          { error: "같은 이미지 업로드를 처리 중입니다. 잠시 후 다시 시도해주세요." },
          { status: 409, headers: { "Retry-After": "5" } }
        );
      }
      const status = reservation?.reason === "account_deleting" ? 409 : 400;
      return NextResponse.json({ error: "업로드 요청을 예약할 수 없습니다." }, { status });
    }
    const reservationId = reservation.reservation_id;

    const inspectStoredObject = async (): Promise<boolean | null> => {
      const { data, error } = await storageClient.storage
        .from(bucket)
        .list(dailyPrefix, { limit: 2, search: objectName });
      if (error) return null;
      return (data ?? []).some((entry) => entry.name === objectName && Boolean(entry.id));
    };

    const finalizeReservation = async (): Promise<boolean> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await serviceClient.rpc("complete_community_upload", {
          p_user_id: user.id,
          p_reservation_id: reservationId,
          p_object_path: filePath,
        });
        if (!error && data === true) return true;

        // An RPC response may be lost after commit. Read the durable state
        // before deciding whether a second idempotent finalize is necessary.
        const { data: row, error: stateError } = await serviceClient
          .from("community_upload_reservations")
          .select("state")
          .eq("id", reservationId)
          .eq("user_id", user.id)
          .eq("object_path", filePath)
          .maybeSingle();
        if (!stateError && row?.state === "completed") return true;
        if (stateError || row?.state !== "reserved") return false;
      }
      return false;
    };

    const uploadClient = storageClient;
    let objectExists = await inspectStoredObject();
    if (objectExists === null) {
      return NextResponse.json(
        { error: "기존 업로드 상태를 확인할 수 없습니다." },
        { status: 503 }
      );
    }

    if (!objectExists) {
      const { error: uploadError } = await uploadClient.storage
        .from(bucket)
        .upload(filePath, buffer, {
          contentType: file.type,
          cacheControl: "60",
          upsert: false,
        });

      if (uploadError) {
        // Storage may commit and lose the HTTP response. Release the quota only
        // after a strong list check proves the deterministic object is absent.
        objectExists = await inspectStoredObject();
        if (objectExists === null) {
          return NextResponse.json(
            { error: "업로드 결과를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." },
            { status: 503 }
          );
        }
        if (!objectExists) {
          return NextResponse.json(
            { error: "업로드 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." },
            { status: 503 }
          );
        }
        // Otherwise continue below and reconcile the committed object with DB.
      } else {
        objectExists = true;
      }
    }

    if (!objectExists || !(await finalizeReservation())) {
      return NextResponse.json(
        { error: "업로드 완료 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 503 }
      );
    }

    const {
      data: { publicUrl },
    } = uploadClient.storage.from(bucket).getPublicUrl(filePath);

    const fileType: "image" | "gif" = isGif ? "gif" : "image";

    return NextResponse.json({ url: publicUrl, type: fileType });
  } catch {
    console.error("[community upload] unexpected failure");
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
