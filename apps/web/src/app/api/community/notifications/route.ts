import { NextResponse } from "next/server";

import { createClientFromRequest } from "@/lib/supabase/server";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_NOTIFICATION_IDS = 50;
const MAX_NOTIFICATIONS = 50;
const NOTIFICATION_COLUMNS = [
  "id",
  "recipient_id",
  "actor_id",
  "post_id",
  "comment_id",
  "parent_comment_id",
  "kind",
  "read_at",
  "created_at",
].join(", ");
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie, Origin, Sec-Fetch-Site",
};

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

type ReadSelection =
  | { kind: "all" }
  | { kind: "ids"; ids: string[] };

async function readSelection(
  request: Request,
): Promise<ReadSelection | NextResponse> {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }
  const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return json(
      {
        error:
          bodyResult.reason === "too_large"
            ? "요청이 너무 큽니다."
            : "요청을 읽을 수 없습니다.",
      },
      { status: bodyResult.reason === "too_large" ? 413 : 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text) as unknown;
  } catch {
    body = null;
  }
  if (!isRecord(body) || Object.keys(body).length !== 1) {
    return json({ error: "읽음 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (body.all === true) return { kind: "all" };
  if (
    !Array.isArray(body.ids)
    || body.ids.length < 1
    || body.ids.length > MAX_NOTIFICATION_IDS
    || !body.ids.every(isUuid)
  ) {
    return json({ error: "알림 ID가 올바르지 않습니다." }, { status: 400 });
  }
  return { kind: "ids", ids: [...new Set(body.ids)] };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("community_reply_notifications")
      .select(NOTIFICATION_COLUMNS)
      .eq("recipient_id", user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_NOTIFICATIONS);

    if (error) {
      return json(
        { error: "새 답변 알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 },
      );
    }

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      recipient_id: string;
      actor_id: string;
      post_id: string;
      comment_id: string;
      parent_comment_id: string | null;
      kind: "post_reply" | "comment_reply";
      read_at: string | null;
      created_at: string;
    }>;
    const actorIds = [...new Set(rows.map((row) => row.actor_id))];
    const postIds = [...new Set(rows.map((row) => row.post_id))];
    const [profileResult, postResult] = await Promise.all([
      actorIds.length > 0
        ? supabase
            .from("community_profiles")
            .select("user_id, nickname")
            .in("user_id", actorIds)
        : Promise.resolve({ data: [], error: null }),
      postIds.length > 0
        ? supabase
            .from("community_posts")
            .select("id, title")
            .in("id", postIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const nicknameById = new Map(
      (profileResult.data ?? []).map((profile) => [
        profile.user_id,
        profile.nickname,
      ]),
    );
    const postTitleById = new Map(
      (postResult.data ?? []).map((post) => [post.id, post.title]),
    );
    const notifications = rows.map((row) => {
      const actorNickname = nicknameById.get(row.actor_id) ?? "회원";
      return {
        ...row,
        actor_nickname: actorNickname,
        title:
          row.kind === "comment_reply"
            ? `${actorNickname}님이 내 답변에 답글을 남겼어요`
            : `${actorNickname}님이 내 고민에 답변을 남겼어요`,
        message: postTitleById.get(row.post_id) ?? "커뮤니티 글",
        href: `/wedding/community/post/${row.post_id}#comment-${row.comment_id}`,
      };
    });

    return json({ ownerId: user.id, notifications });
  } catch {
    return json(
      { error: "새 답변 알림을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
  }

  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const selection = await readSelection(request);
    if (selection instanceof NextResponse) return selection;

    const recipientUpdate = supabase
      .from("community_reply_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", user.id)
      .is("read_at", null);
    const { error } =
      selection.kind === "all"
        ? await recipientUpdate
        : await recipientUpdate.in("id", selection.ids);

    if (error) {
      return json(
        { error: "알림 읽음 상태를 저장하지 못했습니다." },
        { status: 503 },
      );
    }
    return json({ ok: true });
  } catch {
    return json(
      { error: "알림 읽음 상태를 저장하지 못했습니다." },
      { status: 503 },
    );
  }
}
