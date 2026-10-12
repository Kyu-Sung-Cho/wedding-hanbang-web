import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, readBoundedUtf8Text } from "@/utils/requestValidation";

const MAX_PATHS = 10;
const MAX_REQUEST_BODY_BYTES = 2 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VisibleChatMessage = {
  id: string;
  couple_id: string;
  sender_id: string | null;
  visibility: string | null;
  metadata: unknown;
};

function getServiceClient() {
  return createAdminClient();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseMessageId(value: unknown): string | null {
  if (!isPlainObject(value) || Object.keys(value).some((key) => key !== "messageId")) {
    return null;
  }
  return typeof value.messageId === "string" && UUID_PATTERN.test(value.messageId)
    ? value.messageId
    : null;
}

function isSafeNewAttachmentPath(path: string, coupleId: string, senderId: string): boolean {
  if (
    path.length > 512
    || path.startsWith("/")
    || path.endsWith("/")
    || path.includes("\\")
    || path.includes("%")
    || path.includes("?")
    || path.includes("#")
    || path.includes("//")
    || /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return false;
  }

  const segments = path.split("/");
  if (segments.length !== 3) return false;
  const [pathCoupleId, pathOwnerId, fileName] = segments;
  return pathCoupleId === coupleId
    && pathOwnerId === senderId
    && fileName.length > 0
    && fileName !== "."
    && fileName !== ".."
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName);
}

function isSafeLegacyAttachmentPath(path: string, coupleId: string): boolean {
  if (
    path.length > 512
    || path.startsWith("/")
    || path.endsWith("/")
    || path.includes("\\")
    || path.includes("%")
    || path.includes("?")
    || path.includes("#")
    || path.includes("//")
    || /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return false;
  }

  const segments = path.split("/");
  if (segments.length !== 2) return false;
  const [pathCoupleId, fileName] = segments;
  return pathCoupleId === coupleId
    && fileName.length > 0
    && fileName !== "."
    && fileName !== ".."
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName);
}

function legacyPathFromPublicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return null;

  try {
    const url = new URL(value);
    const configuredOrigin = new URL(configuredUrl).origin;
    const marker = "/storage/v1/object/public/chat-image/";
    if (url.origin !== configuredOrigin || !url.pathname.startsWith(marker)) return null;
    return decodeURIComponent(url.pathname.slice(marker.length));
  } catch {
    return null;
  }
}

function attachmentPathsForMessage(message: VisibleChatMessage): string[] {
  if (!isPlainObject(message.metadata)) return [];

  const rawPaths = Array.isArray(message.metadata.imagePaths)
    ? message.metadata.imagePaths
    : [];
  const legacyUrlPaths = Array.isArray(message.metadata.imageUrls)
    ? message.metadata.imageUrls.map(legacyPathFromPublicUrl).filter(Boolean)
    : [];
  const senderId = message.sender_id;

  return [...new Set([...rawPaths, ...legacyUrlPaths])]
    .filter((path): path is string => typeof path === "string")
    .filter((path) => (
      isSafeLegacyAttachmentPath(path, message.couple_id)
      || (senderId !== null && isSafeNewAttachmentPath(path, message.couple_id, senderId))
    ))
    .slice(0, MAX_PATHS);
}

export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    if (isBodyTooLarge(request, MAX_REQUEST_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }
    const authClient = await createClientFromRequest(request);
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("chat:image-urls", request, user.id),
      { maxRequests: 60, windowMs: 60_000 },
    );
    if (limited) return limited;

    const rawBody = await readBoundedUtf8Text(request, MAX_REQUEST_BODY_BYTES);
    if (!rawBody.ok) {
      return NextResponse.json(
        { error: rawBody.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "요청 본문이 올바르지 않습니다." },
        { status: rawBody.reason === "too_large" ? 413 : 400 },
      );
    }
    const body: unknown = (() => {
      try {
        return JSON.parse(rawBody.text) as unknown;
      } catch {
        return null;
      }
    })();
    const messageId = parseMessageId(body);
    if (!messageId) {
      return NextResponse.json({ error: "유효한 메시지 ID가 필요합니다." }, { status: 400 });
    }

    // This query must stay request-scoped: chat_messages RLS is the authority
    // for shared, own-private, partner-private, and cross-couple visibility.
    const { data: message, error: messageError } = await authClient
      .from("chat_messages")
      .select("id, couple_id, sender_id, visibility, metadata")
      .eq("id", messageId)
      .maybeSingle();

    if (messageError) {
      console.error("[chat image-urls] visible message lookup failed:", messageError);
      return NextResponse.json({ error: "첨부파일을 확인하지 못했습니다." }, { status: 500 });
    }
    if (!message) {
      return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
    }

    const paths = attachmentPathsForMessage(message as VisibleChatMessage);
    if (paths.length === 0) {
      return NextResponse.json({ urls: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data, error } = await getServiceClient()
      .storage
      .from("chat-image")
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

    if (error) {
      console.error("[chat image-urls] signed URL failed:", error);
      return NextResponse.json({ error: "첨부파일 URL을 만들지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json(
      {
        urls: (data ?? [])
          .filter((item) => Boolean(item.signedUrl))
          .map((item) => ({ path: item.path, signedUrl: item.signedUrl })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    log.error("api/chat/image-urls", err);
    console.error("[chat image-urls] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
