/**
 * 「함께 새로 시작」 동의 요청 — 읽기, 문구, 응답.
 *
 * 한 사람이 함께 대화를 새로 시작하자고 하면 서버(`apps/web/src/app/api/chat/clear-request/route.ts`)가
 * `metadata.clearRequest` 가 붙은 공유 메시지를 남긴다. 받은 사람이 동의하면 서버 RPC 가 **두 사람의 공유
 * 화면 경계만** 옮긴다 — 메시지를 지우지 않는다. 거절하면 상태만 바뀐다.
 *
 * 문구는 웹 카드(`ChatBubble.tsx` 의 `ClearRequestCard`)와 각주까지 글자 그대로 같다. 각주는 한때 "웹의 비공개
 * 상담"이라고 웹을 가리켰는데, 앱 아모라 탭에도 「대화 화면 정리 → 비공개 대화·아모라 기억 삭제」가 생겨
 * (2026-09-18, `chatViewClear.ts`) 웹 문장으로 되돌렸다. `chatClearRequest.test.mjs` 가 웹 소스와 대조한다.
 */

export type ChatClearRequestStatus = "pending" | "accepted" | "declined";
export type ChatClearRequestRole = "requester" | "recipient";
export type ChatClearRequestAction = "accept" | "decline";

export interface ChatClearRequestView {
  requestedBy: string;
  status: ChatClearRequestStatus;
}

export type ChatClearRequestResult =
  | { ok: true; status: "accepted" | "declined" }
  | { ok: false; error: string };

export interface ChatClearRequestCopy {
  title: string;
  body: string;
  footnote: string | null;
  /** 이 사람이 지금 동의·거절을 누를 수 있는가. 받은 사람이고 아직 답하지 않았을 때뿐이다. */
  canRespond: boolean;
}

const STATUSES: readonly ChatClearRequestStatus[] = ["pending", "accepted", "declined"];

const KEEPS_WHAT = "해당 범위의 원문은 보관하지만 정리 전 대화는 이후 상담에 쓰지 않아요. 저장한 예산·일정·결정은 남아요.";
const FOOTNOTE = "실제로 지우려면 — 비공개 대화는 비공개 상담의 ‘화면 정리 → 비공개 대화·아모라 기억 삭제’에서, 아모라의 기억은 설정의 ‘아모라가 기억하는 것’에서 초기화할 수 있어요.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 메시지가 서버가 남긴 모양 그대로의 요청일 때만 읽는다. 공유 메시지이고, 요청한 사람이 보낸 사람과
 * 같아야 한다(서버는 둘을 같은 값으로 쓴다). 모양이 다르면 `null` — 예전처럼 글 한 줄로 남는다.
 */
export function readChatClearRequest(message: {
  sender_id: string | null;
  visibility: string;
  metadata?: unknown;
}): ChatClearRequestView | null {
  if (message.visibility !== "shared" || !isRecord(message.metadata)) return null;
  const request = message.metadata.clearRequest;
  if (!isRecord(request) || request.type !== "shared") return null;
  const status = STATUSES.find((item) => item === request.status);
  if (!status || typeof request.requestedBy !== "string" || request.requestedBy.length === 0) return null;
  if (request.requestedBy !== message.sender_id) return null;
  return { requestedBy: request.requestedBy, status };
}

export function getChatClearRequestRole(
  request: ChatClearRequestView,
  viewerId: string | null,
): ChatClearRequestRole | null {
  if (!viewerId) return null;
  return request.requestedBy === viewerId ? "requester" : "recipient";
}

export function describeChatClearRequest(
  status: ChatClearRequestStatus,
  role: ChatClearRequestRole,
): ChatClearRequestCopy {
  if (status === "accepted") {
    return {
      title: "함께 새로 시작했어요",
      body: `양쪽 화면이 깨끗하게 정리됐어요. ${KEEPS_WHAT}`,
      footnote: FOOTNOTE,
      canRespond: false,
    };
  }
  if (status === "declined") {
    return { title: "함께 새로 시작 요청이 거절됐어요", body: "기존 대화는 그대로 유지돼요.", footnote: null, canRespond: false };
  }
  return {
    title: "함께 대화 새로 시작 제안",
    body: role === "requester"
      ? `상대방 동의를 기다리는 중이에요. 동의하면 양쪽 화면이 정리돼요. ${KEEPS_WHAT}`
      : `상대방이 함께 새로 시작하자고 제안했어요. 동의하면 양쪽 화면이 정리돼요. ${KEEPS_WHAT}`,
    footnote: FOOTNOTE,
    canRespond: role === "recipient",
  };
}

/** 서버 문장은 그리지 않는다(내부 정보가 실릴 수 있다). 상태 코드로 앱의 말을 고른다. */
function failureCopy(status: number): string {
  switch (status) {
    case 401:
      return "로그인이 만료됐어요. 다시 로그인한 뒤 답해 주세요.";
    case 403:
      return "상대방만 응답할 수 있어요.";
    case 404:
      return "이 요청을 찾지 못했어요. 대화를 새로고침해 주세요.";
    case 409:
      return "이미 처리됐거나 연결 상태가 바뀐 요청이에요. 대화를 새로고침해 주세요.";
    case 429:
      return "요청이 잠시 몰렸어요. 조금 뒤 다시 눌러 주세요.";
    default:
      return "응답을 저장하지 못했어요. 잠시 후 다시 눌러 주세요.";
  }
}

/**
 * 받은 요청에 동의하거나 거절한다. `request` 는 호출한 사람에 결박된 인증 요청이다
 * (화면은 `apiFetchForExpectedUser` 를 넘긴다). 서버가 같은 행동을 확인해 줄 때만 성공이다 —
 * 동의는 정리 시점(`clearedAt`)까지 돌려받아야 성공으로 친다.
 */
export async function respondToChatClearRequest(
  request: (path: string, init: RequestInit) => Promise<Response>,
  messageId: string,
  action: ChatClearRequestAction,
): Promise<ChatClearRequestResult> {
  let response: Response;
  try {
    response = await request("/api/chat/clear-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, messageId }),
    });
  } catch {
    return { ok: false, error: "연결을 확인하지 못했어요. 잠시 후 다시 눌러 주세요." };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: failureCopy(response.status) };
  const confirmed = isRecord(payload)
    && payload.success === true
    && payload.action === action
    && (action !== "accept" || (typeof payload.clearedAt === "string" && Number.isFinite(Date.parse(payload.clearedAt))));
  if (!confirmed) return { ok: false, error: failureCopy(500) };
  return { ok: true, status: action === "accept" ? "accepted" : "declined" };
}
