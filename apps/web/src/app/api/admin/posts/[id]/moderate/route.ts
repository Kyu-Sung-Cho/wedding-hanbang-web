import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";

const ALLOWED_ACTIONS = ["hide", "restore", "soft_delete"] as const;
type ModerateAction = (typeof ALLOWED_ACTIONS)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSchemaUnavailable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.message?.includes("community_moderate_content") === true
  );
}

/**
 * POST /api/admin/posts/[id]/moderate
 * body: { action: "hide" | "restore" | "soft_delete", reason: string }
 *
 * 조치·신고 상태·감사 이벤트·작성자 통지는 DB RPC 한 트랜잭션으로 처리한다.
 * 실제 row를 지우는 hard delete는 이 경로에서 허용하지 않는다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, userId: adminId } = await verifyAdmin(request);
    if (!authorized || !adminId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "올바른 게시글 ID가 아닙니다." },
        { status: 400 }
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const action =
      body && typeof body === "object" && "action" in body
        ? (body.action as string)
        : "";
    const reason =
      body && typeof body === "object" && "reason" in body
        ? String(body.reason).trim()
        : "";

    if (!ALLOWED_ACTIONS.includes(action as ModerateAction)) {
      return NextResponse.json(
        { error: "허용되지 않은 조치입니다." },
        { status: 400 }
      );
    }

    if (reason.length < 3 || reason.length > 2_000) {
      return NextResponse.json(
        { error: "조치 사유를 3자 이상 2,000자 이하로 입력해 주세요." },
        { status: 400 }
      );
    }

    const { data, error } = await getServiceClient().rpc(
      "community_moderate_content" as never,
      {
        p_target_type: "post",
        p_target_id: id,
        p_action: action,
        p_reason: reason,
        p_admin_id: adminId,
      } as never
    );

    if (error) {
      console.error("[admin moderate] atomic RPC failed:", {
        code: error.code,
        message: error.message,
      });

      if (isSchemaUnavailable(error)) {
        return NextResponse.json(
          {
            error:
              "안전한 조치 기록 기능이 아직 준비되지 않아 변경하지 않았습니다.",
            code: "COMMUNITY_MODERATION_SCHEMA_UNAVAILABLE",
          },
          { status: 503 }
        );
      }

      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "게시글을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          error: "조치를 기록하지 못해 아무것도 변경하지 않았습니다.",
          code: "COMMUNITY_MODERATION_FAILED",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    console.error("[admin moderate] unexpected:", error);
    return NextResponse.json(
      {
        error: "조치를 기록하지 못해 아무것도 변경하지 않았습니다.",
        code: "COMMUNITY_MODERATION_FAILED",
      },
      { status: 500 }
    );
  }
}
