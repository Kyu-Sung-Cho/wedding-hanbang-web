import { NextResponse } from "next/server";

import { buildCommunityReplyWebHref } from "@hanbang/shared/community-notification";

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
  | { kind: "all"; ownerId: string }
  | { kind: "ids"; ownerId: string; ids: string[] };

type ReplyNotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string;
  post_id: string;
  comment_id: string;
  parent_comment_id: string | null;
  kind: "post_reply" | "comment_reply";
  read_at: string | null;
  created_at: string;
};

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isReplyNotificationRow(
  value: unknown,
  expectedRecipientId: string,
): value is ReplyNotificationRow {
  if (!isRecord(value)) return false;
  return (
    isUuid(value.id)
    && isUuid(value.recipient_id)
    && value.recipient_id.toLowerCase() === expectedRecipientId.toLowerCase()
    && isUuid(value.actor_id)
    && value.actor_id.toLowerCase() !== expectedRecipientId.toLowerCase()
    && isUuid(value.post_id)
    && isUuid(value.comment_id)
    && (value.parent_comment_id === null || isUuid(value.parent_comment_id))
    && (value.kind === "post_reply" || value.kind === "comment_reply")
    && (value.read_at === null || isTimestamp(value.read_at))
    && isTimestamp(value.created_at)
  );
}

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
  if (!isRecord(body) || !isUuid(body.ownerId)) {
    return json({ error: "읽음 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (
    body.all === true
    && keys.length === 2
    && keys.includes("ownerId")
    && keys.includes("all")
  ) {
    return { kind: "all", ownerId: body.ownerId };
  }
  if (
    keys.length !== 2
    || !keys.includes("ownerId")
    || !keys.includes("ids")
    || !Array.isArray(body.ids)
    || body.ids.length < 1
    || body.ids.length > MAX_NOTIFICATION_IDS
    || !body.ids.every(isUuid)
  ) {
    return json({ error: "알림 ID가 올바르지 않습니다." }, { status: 400 });
  }
  return {
    kind: "ids",
    ownerId: body.ownerId,
    ids: [...new Set(body.ids)],
  };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isUuid(user.id)) {
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

    if (
      !Array.isArray(data)
      || !data.every((row) => isReplyNotificationRow(row, user.id))
    ) {
      return json(
        {
          code: "COMMUNITY_NOTIFICATION_OWNERSHIP_UNCONFIRMED",
          error: "알림 소유권을 안전하게 확인하지 못했습니다.",
        },
        { status: 503 },
      );
    }
    const rows = data;
    const actorIds = [...new Set(rows.map((row) => row.actor_id))];
    const postIds = [...new Set(rows.map((row) => row.post_id))];
    const [profileResult, postResult] = await Promise.all([
      actorIds.length > 0
        ? supabase
            .from("community_public_profiles")
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

    if (profileResult.error || postResult.error) {
      return json(
        { error: "알림 내용을 안전하게 불러오지 못했습니다." },
        { status: 503 },
      );
    }

    const actorIdSet = new Set(actorIds.map((id) => id.toLowerCase()));
    const postIdSet = new Set(postIds.map((id) => id.toLowerCase()));
    if (
      !(profileResult.data ?? []).every((profile) => (
        isRecord(profile)
        && isUuid(profile.user_id)
        && actorIdSet.has(profile.user_id.toLowerCase())
        && typeof profile.nickname === "string"
        && profile.nickname.length > 0
        && Array.from(profile.nickname).length <= 40
      ))
      || !(postResult.data ?? []).every((post) => (
        isRecord(post)
        && isUuid(post.id)
        && postIdSet.has(post.id.toLowerCase())
        && typeof post.title === "string"
        && Array.from(post.title).length <= 200
      ))
    ) {
      return json(
        { error: "알림 내용을 안전하게 확인하지 못했습니다." },
        { status: 503 },
      );
    }

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
        id: row.id,
        actor_id: row.actor_id,
        post_id: row.post_id,
        comment_id: row.comment_id,
        parent_comment_id: row.parent_comment_id,
        kind: row.kind,
        read_at: row.read_at,
        created_at: row.created_at,
        actor_nickname: actorNickname,
        title:
          row.kind === "comment_reply"
            ? `${actorNickname}님이 내 답변에 답글을 남겼어요`
            : `${actorNickname}님이 내 고민에 답변을 남겼어요`,
        message: postTitleById.get(row.post_id) ?? "커뮤니티 글",
        href: buildCommunityReplyWebHref(row.post_id, row.comment_id),
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
    if (!user || !isUuid(user.id)) {
      return json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const selection = await readSelection(request);
    if (selection instanceof NextResponse) return selection;
    if (selection.ownerId.toLowerCase() !== user.id.toLowerCase()) {
      return json(
        {
          code: "COMMUNITY_NOTIFICATION_SESSION_CHANGED",
          error: "로그인 계정이 변경되었습니다. 알림을 다시 불러와 주세요.",
        },
        { status: 409 },
      );
    }

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
    return json({ ok: true, ownerId: user.id });
  } catch {
    return json(
      { error: "알림 읽음 상태를 저장하지 못했습니다." },
      { status: 503 },
    );
  }
}
