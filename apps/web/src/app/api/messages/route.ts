import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { messageRowToMessage } from "@/lib/utils/vendorMapper";
import { loadOwnedVendorWithServiceRole } from "@/lib/vendors/serverOwnership";
import {
  checkRateLimitPersistent,
  rateLimitKey,
} from "@/utils/rateLimit";
import {
  cleanOptionalText,
  isRecord,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import type { VendorMessageRow } from "@/types/vendor.types";
import { VENDOR_MESSAGE_PRIVATE_SELECT } from "@/lib/privacy/privateDataSelects";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_LENGTH = 2000;
const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isValidMarkReadCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isVendorMessageRpcRow(
  value: unknown,
): value is VendorMessageRow & { server_provenance_version: 1 } {
  return isRecord(value)
    && isUuid(value.id)
    && isUuid(value.vendor_id)
    && isUuid(value.customer_id)
    && value.server_provenance_version === 1
    && (value.sender_type === "customer" || value.sender_type === "vendor")
    && typeof value.content === "string"
    && typeof value.is_read === "boolean"
    && (value.booking_id === null || isUuid(value.booking_id))
    && typeof value.created_at === "string";
}

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_RESPONSE_HEADERS,
  });
}

function withPrivateHeaders(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

type MessageBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

async function readMessageBody(req: Request): Promise<MessageBodyResult> {
  const bodyResult = await readBoundedUtf8Text(req, MAX_MESSAGE_BODY_BYTES);
  if (!bodyResult.ok) {
    return {
      ok: false,
      response: privateJson(
        {
          error: bodyResult.reason === "too_large"
            ? "메시지가 너무 깁니다."
            : "요청을 읽을 수 없습니다.",
        },
        bodyResult.reason === "too_large" ? 413 : 400,
      ),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text) as unknown;
  } catch {
    body = null;
  }

  if (!isRecord(body)) {
    return {
      ok: false,
      response: privateJson({ error: "요청 형식이 올바르지 않습니다." }, 400),
    };
  }

  return { ok: true, body };
}

export async function GET(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return privateJson({ error: "인증이 필요합니다." }, 401);
    }

    const { searchParams } = new URL(req.url);
    const vendorId = searchParams.get("vendorId");
    const customerId = searchParams.get("customerId");

    if (!isUuid(vendorId)) {
      return privateJson({ error: "vendorId는 필수입니다." }, 400);
    }

    if (customerId && !isUuid(customerId)) {
      return privateJson({ error: "customerId가 올바르지 않습니다." }, 400);
    }

    let query = supabase
      .from("vendor_messages")
      .select(VENDOR_MESSAGE_PRIVATE_SELECT)
      .eq("server_provenance_version", 1)
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    if (customerId) {
      // customerId 지정 시 해당 vendor의 owner만 조회 가능
      const serviceClient = createAdminClient();
      const vendorOwner = await loadOwnedVendorWithServiceRole(
        serviceClient,
        user.id,
        vendorId,
      );

      if (!vendorOwner) {
        return privateJson({ error: "권한이 없습니다." }, 403);
      }
      query = query.eq("customer_id", customerId);
    } else {
      query = query.eq("customer_id", user.id);
    }

    const { data: messageRows, error } = await query;

    if (error) {
      return privateJson({ error: "메시지를 불러올 수 없습니다." }, 500);
    }

    const messages = (messageRows ?? []).map(messageRowToMessage);

    return privateJson({ messages });
  } catch (err) {
    console.error("Messages GET error:", safeErrorDiagnostic(err));
    return privateJson({ error: "서버 오류가 발생했습니다." }, 500);
  }
}

// Reading a thread is intentionally side-effect free. Clients must explicitly
// acknowledge the counterpart's messages through this idempotent mutation.
export async function PATCH(req: Request) {
  if (!isTrustedMutationRequest(req)) {
    return privateJson({ error: "잘못된 요청 출처입니다." }, 403);
  }

  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return privateJson({ error: "인증이 필요합니다." }, 401);
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("messages:mark-read", req, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 },
    );
    if (limited) return withPrivateHeaders(limited);

    const parsedBody = await readMessageBody(req);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if (Object.keys(body).some((key) => !["vendorId", "customerId"].includes(key))) {
      return privateJson({ error: "요청 형식이 올바르지 않습니다." }, 400);
    }

    const vendorId = body.vendorId;
    const rawCustomerId = body.customerId;
    if (!isUuid(vendorId) || (rawCustomerId !== undefined && !isUuid(rawCustomerId))) {
      return privateJson({ error: "대화 식별자가 올바르지 않습니다." }, 400);
    }

    const serviceClient = createAdminClient();
    const customerId = isUuid(rawCustomerId) ? rawCustomerId : null;
    const { data: markedCount, error } = await serviceClient.rpc(
      "mark_vendor_messages_read_service_v1",
      {
        p_actor_id: user.id,
        p_vendor_id: vendorId,
        p_customer_id: customerId,
      },
    );

    if (error) {
      const errorMessage = error.message ?? "";
      if (errorMessage.includes("vendor_message_mark_read_forbidden")) {
        return privateJson({ error: "권한이 없습니다." }, 403);
      }
      if (errorMessage.includes("invalid_vendor_message_mark_read_input")) {
        return privateJson({ error: "대화 식별자가 올바르지 않습니다." }, 400);
      }
      console.error("Message mark-read error:", safeErrorDiagnostic(error));
      return privateJson({ error: "읽음 처리에 실패했습니다." }, 500);
    }

    if (!isValidMarkReadCount(markedCount)) {
      console.error("Message mark-read error: malformed RPC result");
      return privateJson({ error: "읽음 처리에 실패했습니다." }, 500);
    }

    return privateJson({ markedRead: true });
  } catch (err) {
    console.error("Messages PATCH error:", safeErrorDiagnostic(err));
    return privateJson({ error: "서버 오류가 발생했습니다." }, 500);
  }
}

export async function POST(req: Request) {
  if (!isTrustedMutationRequest(req)) {
    return privateJson({ error: "잘못된 요청 출처입니다." }, 403);
  }

  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return privateJson({ error: "인증이 필요합니다." }, 401);
    }

    const rlResult = await checkRateLimitPersistent(
      rateLimitKey("messages:send", req, user.id),
      { maxRequests: 30, windowMs: 60 * 1000 }
    );
    if (rlResult) return withPrivateHeaders(rlResult);

    const serviceClient = createAdminClient();

    const parsedBody = await readMessageBody(req);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    if (Object.keys(body).some((key) => !["vendorId", "customerId", "content"].includes(key))) {
      return privateJson({ error: "요청 형식이 올바르지 않습니다." }, 400);
    }

    const vendorId = body.vendorId;
    const rawCustomerId = body.customerId;
    const customerId = isUuid(rawCustomerId) ? rawCustomerId : null;
    const content = cleanOptionalText(body.content, MAX_MESSAGE_LENGTH);

    if (!isUuid(vendorId) || !content) {
      return privateJson({ error: "vendorId와 content는 필수입니다." }, 400);
    }

    if (rawCustomerId !== undefined && rawCustomerId !== null && !customerId) {
      return privateJson({ error: "customerId가 올바르지 않습니다." }, 400);
    }

    // The service-role client bypasses RLS. Keep sender derivation, vendor
    // availability, and relationship authorization inside one database
    // transaction; direct service-role INSERT is revoked by the migration.
    const { data: message, error } = await serviceClient
      .rpc("send_vendor_message_service_v1", {
        p_actor_id: user.id,
        p_vendor_id: vendorId,
        p_customer_id: customerId,
        p_content: content,
      })
      .single();

    if (error) {
      const errorMessage = error.message ?? "";
      if (errorMessage.includes("vendor_message_vendor_unavailable")) {
        return privateJson({ error: "업체를 찾을 수 없거나 이용할 수 없습니다." }, 404);
      }
      if (
        errorMessage.includes("vendor_message_relationship_required")
        || errorMessage.includes("vendor_message_customer_override_forbidden")
      ) {
        return privateJson({ error: "해당 대화를 시작할 권한이 없습니다." }, 403);
      }
      if (
        errorMessage.includes("vendor_message_customer_required")
        || errorMessage.includes("invalid_vendor_message_input")
      ) {
        return privateJson({ error: "메시지 요청 형식이 올바르지 않습니다." }, 400);
      }
      console.error("Message send error:", safeErrorDiagnostic(error));
      return privateJson({ error: "메시지 전송에 실패했습니다." }, 500);
    }

    if (!isVendorMessageRpcRow(message)) {
      console.error("Message send error: malformed RPC result");
      return privateJson({ error: "메시지 전송에 실패했습니다." }, 500);
    }

    return privateJson({ message: messageRowToMessage(message) });
  } catch (err) {
    console.error("Message send error:", safeErrorDiagnostic(err));
    return privateJson({ error: "서버 오류가 발생했습니다." }, 500);
  }
}
