import { parseCommunityDecisionInbox } from "@hanbang/shared/community-decision-feed";

import { decisionJson, decisionRpcError } from "@/lib/community/decisionThreadApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isUuid } from "@/utils/requestValidation";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].length > 0) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_INBOX_INVALID",
          error: "알림함 요청이 올바르지 않아요.",
        },
        400,
      );
    }

    const authClient = await createClientFromRequest(request);
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user || !isUuid(user.id)) {
      return decisionJson(
        {
          code: "COMMUNITY_AUTH_REQUIRED",
          error: "로그인이 필요해요.",
        },
        401,
      );
    }

    const { data, error } = await createAdminClient().rpc(
      "community_get_decision_inbox",
      { p_viewer_id: user.id },
    );
    if (error) return decisionRpcError(error);
    const inbox = parseCommunityDecisionInbox(data);
    if (!inbox) {
      return decisionJson(
        {
          code: "COMMUNITY_DECISION_STATE_UNCONFIRMED",
          error: "알림함 상태를 안전하게 확인하지 못했어요.",
        },
        503,
        { "Retry-After": "30" },
      );
    }
    return decisionJson(inbox, 200);
  } catch {
    console.error("COMMUNITY_DECISION_INBOX_READ_FAILED");
    return decisionJson(
      {
        code: "COMMUNITY_DECISION_READ_FAILED",
        error: "결정 알림함을 불러오지 못했어요.",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
