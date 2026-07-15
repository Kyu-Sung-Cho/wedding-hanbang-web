import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord, isUuid } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 8 * 1024;

interface ClearRequestMeta {
  type: "shared";
  requestedBy: string;
  requestedByRole: "bride" | "groom";
  requestedAt: string;
  status: "pending";
}

function clearRequestRpcError(code: string | undefined) {
  switch (code) {
    case "HC401":
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    case "HC404":
      return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
    case "HC403":
      return NextResponse.json({ error: "상대방만 응답할 수 있습니다." }, { status: 403 });
    case "HC409":
      return NextResponse.json({ error: "이미 처리된 요청입니다." }, { status: 409 });
    case "HC400":
      return NextResponse.json({ error: "올바르지 않은 초기화 요청입니다." }, { status: 400 });
    case "HC422":
      return NextResponse.json(
        { error: "커플과 역할 정보를 확인한 뒤 다시 시도해 주세요." },
        { status: 409 }
      );
    default:
      return NextResponse.json(
        { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 500 }
      );
  }
}

/**
 * Creates a shared-chat clear request or resolves one through the atomic RPC.
 * Accepting never deletes messages; it advances both members' shared view cursor.
 */
export async function POST(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const limited = checkRateLimit(rateLimitKey("chat:clear-request", request, user.id), {
      maxRequests: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const action = body.action;
    if (action !== "request" && action !== "accept" && action !== "decline") {
      return NextResponse.json({ error: "action이 필요합니다." }, { status: 400 });
    }

    if (action === "request") {
      const requestedCoupleId = isUuid(body.coupleId) ? body.coupleId : null;
      if (!requestedCoupleId) {
        return NextResponse.json({ error: "coupleId가 필요합니다." }, { status: 400 });
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceRoleKey) {
        return NextResponse.json(
          { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
          { status: 503 }
        );
      }

      const admin = createAdminClient(supabaseUrl, serviceRoleKey);
      const { data: me, error: profileError } = await admin
        .from("profiles")
        .select("id, couple_id, role")
        .eq("id", user.id)
        .single();
      if (profileError || !me) {
        console.error("[clear-request] profile lookup failed", {
          code: profileError?.code ?? "not_found",
        });
        return NextResponse.json(
          { error: "프로필 정보를 확인하지 못했습니다." },
          { status: 409 }
        );
      }

      if (me.role !== "bride" && me.role !== "groom") {
        return NextResponse.json(
          { error: "역할 정보를 먼저 설정해 주세요." },
          { status: 409 }
        );
      }

      const myRole = me.role;
      const myCoupleId = typeof me.couple_id === "string" ? me.couple_id : null;
      if (myCoupleId !== requestedCoupleId) {
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
      }

      // Service-role insertion is allowed only after checking the authoritative
      // couple slot as well as the profile mirror.
      const { data: couple, error: coupleError } = await admin
        .from("couples")
        .select("id, bride_id, groom_id")
        .eq("id", requestedCoupleId)
        .single();
      const occupiesExpectedSlot =
        (myRole === "bride" && couple?.bride_id === user.id) ||
        (myRole === "groom" && couple?.groom_id === user.id);
      if (coupleError || !couple || !occupiesExpectedSlot) {
        console.error("[clear-request] couple membership check failed", {
          code: coupleError?.code ?? "membership_mismatch",
        });
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
      }

      const meta: ClearRequestMeta = {
        type: "shared",
        requestedBy: user.id,
        requestedByRole: myRole,
        requestedAt: new Date().toISOString(),
        status: "pending",
      };

      const { data: inserted, error: insertError } = await admin
        .from("chat_messages")
        .insert({
          couple_id: requestedCoupleId,
          sender_id: user.id,
          sender_type: myRole,
          role: "user",
          content:
            "함께 대화를 새로 시작하자고 제안했어요. 동의하면 양쪽 화면이 깨끗하게 정리돼요.",
          visibility: "shared",
          metadata: { clearRequest: meta },
        })
        .select()
        .single();

      if (insertError) {
        console.error("[clear-request] request insert failed", { code: insertError.code });
        return NextResponse.json(
          { error: "초기화 요청을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, message: inserted });
    }

    const messageId = isUuid(body.messageId) ? body.messageId : null;
    if (!messageId) {
      return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
    }

    // The authenticated client carries auth.uid() into the SECURITY DEFINER RPC.
    // No service-role read/update is performed in this response path.
    const { data: resolutionRows, error: resolutionError } = await supabase.rpc(
      "resolve_shared_chat_clear_request",
      { p_message_id: messageId, p_action: action }
    );
    if (resolutionError) {
      console.error("[clear-request] resolution RPC failed", {
        code: resolutionError.code ?? "unknown",
      });
      return clearRequestRpcError(resolutionError.code);
    }

    const resolution = Array.isArray(resolutionRows) ? resolutionRows[0] : resolutionRows;
    const expectedStatus = action === "accept" ? "accepted" : "declined";
    if (!isRecord(resolution) || resolution.resolution_status !== expectedStatus) {
      return NextResponse.json(
        { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 500 }
      );
    }

    const clearedAt =
      typeof resolution.cleared_at === "string" ? resolution.cleared_at : null;
    if (action === "accept" && !clearedAt) {
      return NextResponse.json(
        { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      action,
      ...(clearedAt ? { clearedAt } : {}),
      idempotent: resolution.idempotent === true,
    });
  } catch (error) {
    console.error(
      "[clear-request] unexpected failure",
      error instanceof Error ? error.name : "unknown"
    );
    return NextResponse.json(
      { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
