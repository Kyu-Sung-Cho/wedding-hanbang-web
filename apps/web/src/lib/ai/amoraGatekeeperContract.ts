/**
 * 아모라 문지기(D-89)의 계약: 스위치, 고정 문장, 응답 행 표식.
 *
 * 판정 자체(OpenAI 안전 판정과 결혼 범위 판정)는 `amoraGatekeeper.ts` 에 있다. 이 파일은
 * 의존이 없다. 이력·연결 문맥·갈등 확인처럼 "지난 턴을 모델에게 다시 보여 줘도 되는가"를
 * 정하는 곳들이 OpenAI 클라이언트를 끌어오지 않고 표식만 읽을 수 있게 따로 두었다.
 *
 * 정한 것(2026-11-20 파운더, 설계 25장 D-89):
 * - 결혼 준비와 상관없는 말은 정해진 한 줄로 끝내고 모델에게 보내지 않는다.
 * - 폭력·자살·자해는 결혼 이야기여도, 가정이어도 막는다. 막는 말에는 번호를 쓰지 않는다
 *   (11-18 "막기만"). 지금 위기 안내(109 포함)가 나가는 말은 그 안내를 그대로 둔다.
 * - 낱말 목록을 넓히지 않는다. 낱말 판정은 위기 안내와 오늘의 안전 갈래로만 남는다.
 */

/** 판정 규칙이나 문장이 바뀌면 올린다. 저장된 응답 행에 남아 어느 판으로 막았는지 보인다. */
export const AMORA_GATEKEEPER_VERSION = "2026-11-20.v1";

/** 서버가 쓴 문지기 응답 행의 `metadata.response_origin`. */
export const AMORA_GATEKEEPER_RESPONSE_ORIGIN = "deterministic_amora_gatekeeper";

/**
 * 화면 문장. 파운더 승인 전 초안이다(D-12). 바꾸면 웹·앱이 같은 문장을 받는지 보는
 * 시험이 함께 바뀌어야 한다.
 */
export const AMORA_GATE_OUT_OF_SCOPE_REPLY = "결혼 준비 이야기만 도와드릴 수 있어요.";
export const AMORA_GATE_BLOCKED_RISK_REPLY = "이 이야기는 아모라가 도와드릴 수 없어요.";

export type AmoraGateVerdict = "allow" | "out_of_scope" | "blocked_risk" | "crisis";
export type AmoraGateBlockingVerdict = Extract<AmoraGateVerdict, "out_of_scope" | "blocked_risk">;

/**
 * 문이 서는 입구.
 * - amora_chat: 웹·앱 대화(함께 대화와 나만 상담 모두). 앱도 같은 `/api/chat` 을 쓴다.
 * - amora_mediation: 중재 요청(웹). 범위 판정은 하지 않고 위험만 본다.
 * - amora_task_request: 맡은 일 요청(갈래 4가 부른다).
 * - community_comment: 커뮤니티 글에 아모라가 다는 댓글(지금 운영에서 꺼져 있다).
 */
export type AmoraGateSurface =
  | "amora_chat"
  | "amora_mediation"
  | "amora_task_request"
  | "community_comment";

export function isAmoraGatekeeperEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AMORA_GATEKEEPER_ENABLED?.trim().toLowerCase() === "true";
}

export function getAmoraGateReply(verdict: AmoraGateBlockingVerdict): string {
  return verdict === "blocked_risk"
    ? AMORA_GATE_BLOCKED_RISK_REPLY
    : AMORA_GATE_OUT_OF_SCOPE_REPLY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 이 응답 행이 문지기가 쓴 것인가.
 *
 * 문지기가 막은 턴은 사용자 행과 이 응답 행이 한 쌍으로 남는다. 다음 턴의 이력·연결 문맥·
 * 갈등 확인이 이 쌍을 모델에게 다시 보내면 "모델에게 보내지 않는다"가 한 턴 늦게 깨진다.
 * 그래서 그 자리들은 이 함수로 쌍을 통째로 뺀다.
 */
export function isAmoraGatekeeperReplyMetadata(metadata: unknown): boolean {
  return isRecord(metadata)
    && metadata.response_origin === AMORA_GATEKEEPER_RESPONSE_ORIGIN;
}

/** 문지기 응답 행에 남기는 표식. 원문·낱말·점수는 남기지 않는다. */
export function buildAmoraGatekeeperReplyMetadata(input: {
  verdict: AmoraGateBlockingVerdict;
  userMessageId?: string;
}): Record<string, unknown> {
  return {
    response_origin: AMORA_GATEKEEPER_RESPONSE_ORIGIN,
    amora_gatekeeper: { verdict: input.verdict, version: AMORA_GATEKEEPER_VERSION },
    // 위험으로 막은 답은 W5 로 적는다. 이력(W0·W1·W4)·장기 기억(W0·W1)·되묻기 연속(W0)·
    // 커뮤니티 공유 제안(W2·W5 제외)이 표식을 몰라도 이 쌍을 고르지 않게 하는 두 번째 겹이다.
    question_scope: input.verdict === "blocked_risk"
      ? "W5_safety_override"
      : "W4_out_of_scope",
    memory_eligible: false,
    memory_enqueue_requested: false,
    toolsUsed: [],
    ...(typeof input.userMessageId === "string"
      ? { in_reply_to_user_message_id: input.userMessageId }
      : {}),
  };
}
