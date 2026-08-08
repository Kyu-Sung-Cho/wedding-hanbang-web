import { NextResponse } from "next/server";
import { buildCommunityReplyPushPayload } from "@hanbang/shared/community-notification";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isRecord, isUuid } from "@/utils/requestValidation";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function isResolvedTarget(
  value: unknown,
  ownerId: string,
  deliveryId: string,
  notificationId: string,
): value is {
  owner_id: string;
  delivery_id: string;
  notification_id: string;
  kind: "post_reply" | "comment_reply";
  post_id: string;
  comment_id: string;
} {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 6
    && keys[0] === "comment_id"
    && keys[1] === "delivery_id"
    && keys[2] === "kind"
    && keys[3] === "notification_id"
    && keys[4] === "owner_id"
    && keys[5] === "post_id"
    && isUuid(value.owner_id)
    && value.owner_id.toLowerCase() === ownerId.toLowerCase()
    && isUuid(value.delivery_id)
    && value.delivery_id.toLowerCase() === deliveryId.toLowerCase()
    && isUuid(value.notification_id)
    && value.notification_id.toLowerCase() === notificationId.toLowerCase()
    && (value.kind === "post_reply" || value.kind === "comment_reply")
    && isUuid(value.post_id)
    && isUuid(value.comment_id)
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const deliveryIds = url.searchParams.getAll("deliveryId");
  const notificationIds = url.searchParams.getAll("notificationId");
  if (
    keys.length !== 2
    || deliveryIds.length !== 1
    || notificationIds.length !== 1
    || !isUuid(deliveryIds[0])
    || !isUuid(notificationIds[0])
  ) {
    return json({ error: "알림 경로가 올바르지 않습니다." }, 400);
  }

  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user || !isUuid(user.id)) {
      return json({ error: "로그인이 필요합니다." }, 401);
    }

    const { data, error } = await supabase.rpc(
      "community_resolve_notification_push_target",
      {
        p_delivery_id: deliveryIds[0],
        p_notification_id: notificationIds[0],
      },
    );
    if (error) {
      return json({ error: "알림을 안전하게 확인하지 못했습니다." }, 503);
    }
    if (!isResolvedTarget(
      data,
      user.id,
      deliveryIds[0],
      notificationIds[0],
    )) {
      return json({ error: "더 이상 열 수 없는 알림입니다." }, 404);
    }

    const payload = buildCommunityReplyPushPayload({
      kind: data.kind,
      postId: data.post_id,
      commentId: data.comment_id,
    });
    return json({
      deliveryId: data.delivery_id,
      notificationId: data.notification_id,
      href: payload.data.href,
    });
  } catch {
    return json({ error: "알림을 안전하게 확인하지 못했습니다." }, 503);
  }
}
