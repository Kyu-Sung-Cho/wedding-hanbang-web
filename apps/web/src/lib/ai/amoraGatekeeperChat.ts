/**
 * 대화 경로(`/api/chat`)에 문지기를 다는 자리. 웹과 앱이 같은 경로를 쓴다.
 *
 * 라우트는 요청 클레임을 잡고 개인정보 판번호를 읽은 바로 뒤, 저장 문맥을 읽거나 모델을
 * 부르기 전에 이 함수를 한 번 부른다. 그 앞의 위기 관문(낱말, 109 포함 안내)은 그대로 돈다.
 *
 * 막힌 턴:
 * - 대화: 고정 문장을 아모라 답으로 저장하고(문지기 표식, W4·W5 범위, 기억 끔) 그 행을 돌려준다.
 *   저장이 안 되면 같은 문장을 저장 없이 돌려준다. 어느 쪽이든 모델은 부르지 않는다.
 * - 중재: 지금의 중재 안전 확인(422 MEDIATION_SAFETY_PREFLIGHT_REQUIRED)과 같은 답을 낸다.
 *   중재는 범위를 보지 않고 위험만 본다.
 *
 * 스위치(`AMORA_GATEKEEPER_ENABLED`)가 꺼져 있으면 아무것도 부르지 않고 지나간다.
 */
import {
  checkAmoraGate,
  DEFAULT_AMORA_GATE_DEPS,
  type AmoraGateDecision,
  type AmoraGateDeps,
} from "@/lib/ai/amoraGatekeeper";
import {
  buildAmoraGatekeeperReplyMetadata,
  isAmoraGatekeeperEnabled,
} from "@/lib/ai/amoraGatekeeperContract";
import type { AmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import {
  persistAiMessage,
  type ChatVisibility,
  type PersistedAiMessage,
} from "@/lib/ai/chatMessagePersistence";
import { completeChatRequest, failChatRequest } from "@/lib/ai/chatRequestClaim";
import { log } from "@/utils/log";

export type AmoraChatGateOutcome =
  | { kind: "continue"; decision: AmoraGateDecision | null }
  | { kind: "reply"; message: PersistedAiMessage; decision: AmoraGateDecision }
  | { kind: "mediation_blocked"; decision: AmoraGateDecision }
  | { kind: "privacy_changed"; decision: AmoraGateDecision };

interface AmoraChatGateClaim {
  coupleId: string;
  requestKey: string;
  userId: string;
  visibility: ChatVisibility;
  userMessageId?: string;
}

export interface RunAmoraChatGatekeeperInput {
  requestKind: "chat" | "mediation" | "initial_greeting";
  isDemo: boolean;
  /** 위기 관문이 본 것과 같은 글(저장된 사용자 행, 중재는 요청자 요약). */
  userText: string | null;
  /** 라우트가 이미 구한 낱말 범위(체크리스트 구제 포함). 없으면 문지기가 구한다. */
  questionScope: AmoraQuestionScope | null;
  /** 서버가 낸 카드를 확인하는 턴. 정의상 결혼 이야기라 범위는 보지 않고 위험만 본다. */
  isCardConfirmation: boolean;
  actorId: string;
  /** 답을 저장할 커플(실제 커플 id). */
  coupleId: string;
  visibility: ChatVisibility;
  clientRequestId: string;
  userMessageId?: string;
  /** 라우트의 일반 답과 같은 상관 키. 다를 때만 남긴다. */
  visibleClientRequestKey?: string;
  /** 비데모 턴에서 이미 잡은 요청 클레임. */
  claim: AmoraChatGateClaim | null;
  /** 클레임 뒤에 읽은 개인정보 판번호. 저장 직전에 다시 읽어 같아야 저장한다. */
  initialPrivacyEpoch: number | null;
  readPrivacyEpoch: () => Promise<number>;
  signal?: AbortSignal;
}

export interface AmoraChatGatekeeperDeps {
  gate: AmoraGateDeps;
  persist: typeof persistAiMessage;
  complete: typeof completeChatRequest;
  fail: typeof failChatRequest;
}

export const DEFAULT_AMORA_CHAT_GATEKEEPER_DEPS: AmoraChatGatekeeperDeps = {
  gate: DEFAULT_AMORA_GATE_DEPS,
  persist: persistAiMessage,
  complete: completeChatRequest,
  fail: failChatRequest,
};

function ephemeralReply(
  content: string,
  metadata: Record<string, unknown>,
  visibility: ChatVisibility,
): PersistedAiMessage {
  return {
    id: null,
    createdAt: null,
    content,
    metadata,
    stageTag: null,
    specialistType: null,
    visibility,
    reused: false,
  };
}

export type StartAmoraChatGatekeeperInput = Pick<
  RunAmoraChatGatekeeperInput,
  | "requestKind"
  | "isDemo"
  | "userText"
  | "questionScope"
  | "isCardConfirmation"
  | "actorId"
  | "coupleId"
  | "signal"
>;

/**
 * 판정을 시작만 한다. 판정 모델은 첫 답까지 1~3초가 걸려서(2026-11-20 실측 p50 1.95초),
 * 라우트는 요청 제한 검사 바로 뒤에 이걸 부르고 클레임·문맥 읽기·프롬프트 조립을 하는 동안
 * 기다리지 않는다. 결과는 모델을 부르기 직전에 `finishAmoraChatGatekeeper` 로 받는다.
 *
 * 거절되지 않는다. 판정 중 오류는 오류로 남기고 null(오늘의 길)로 끝난다.
 */
export function startAmoraChatGatekeeper(
  input: StartAmoraChatGatekeeperInput,
  deps: AmoraChatGatekeeperDeps = DEFAULT_AMORA_CHAT_GATEKEEPER_DEPS,
): Promise<AmoraGateDecision | null> {
  if (!isAmoraGatekeeperEnabled(deps.gate.env)) return Promise.resolve(null);
  if (input.requestKind === "initial_greeting") return Promise.resolve(null);
  const text = input.userText?.trim() ?? "";
  if (!text) return Promise.resolve(null);

  const isMediation = input.requestKind === "mediation";
  return checkAmoraGate(
    {
      text,
      surface: isMediation ? "amora_mediation" : "amora_chat",
      // 체험·평가 행위자의 합성 id 는 감사 표의 사용자·커플 키가 아니다.
      userId: input.isDemo ? null : input.actorId,
      coupleId: input.isDemo ? null : input.coupleId,
      questionScope: input.questionScope,
      applyScope: !isMediation && !input.isCardConfirmation,
      signal: input.signal,
    },
    deps.gate,
  ).catch((error: unknown) => {
    deps.gate.onError("gate_failed", error);
    return null;
  });
}

/** 시작해 둔 판정을 받아 막힌 턴의 답을 만든다. 모델을 부르기 직전에 부른다. */
export async function finishAmoraChatGatekeeper(
  pending: Promise<AmoraGateDecision | null>,
  input: RunAmoraChatGatekeeperInput,
  deps: AmoraChatGatekeeperDeps = DEFAULT_AMORA_CHAT_GATEKEEPER_DEPS,
): Promise<AmoraChatGateOutcome> {
  const decision = await pending;
  if (!decision) return { kind: "continue", decision: null };
  // 위기는 라우트가 같은 글로 이미 끝냈다. 여기 닿았다면 그 판정을 따른다(모델로 가지 않게 막지
  // 않는다 — 위기 안내는 라우트의 고정 경로가 정본이다).
  if (decision.verdict === "allow" || decision.verdict === "crisis") {
    return { kind: "continue", decision };
  }
  if (input.requestKind === "mediation") return { kind: "mediation_blocked", decision };

  const reply = decision.reply ?? "";
  const metadata = {
    ...buildAmoraGatekeeperReplyMetadata({
      verdict: decision.verdict,
      userMessageId: input.userMessageId,
    }),
    ...(input.visibleClientRequestKey && input.visibleClientRequestKey !== input.clientRequestId
      ? { client_visible_request_id: input.visibleClientRequestKey }
      : {}),
  };

  if (input.isDemo || !input.claim) {
    // 체험은 DB 에 쓰지 않는다(일반 답과 같다).
    const message = await deps.persist({
      isDemo: true,
      coupleId: input.coupleId,
      cleanText: reply,
      clientRequestId: input.clientRequestId,
      metadata,
      stageTag: null,
      specialistType: null,
      visibility: input.visibility,
    });
    return { kind: "reply", message, decision };
  }

  // 저장 직전에 판번호를 다시 본다. 그사이 화면을 정리했거나 커플 구성이 바뀌었으면 쓰지 않는다.
  let currentEpoch: number | null = null;
  try {
    currentEpoch = await input.readPrivacyEpoch();
  } catch (error) {
    deps.gate.onError("privacy_epoch_unavailable", error);
  }
  if (input.initialPrivacyEpoch === null || currentEpoch !== input.initialPrivacyEpoch) {
    return { kind: "privacy_changed", decision };
  }

  try {
    const message = await deps.persist({
      isDemo: false,
      coupleId: input.coupleId,
      cleanText: reply,
      clientRequestId: input.clientRequestId,
      metadata,
      stageTag: null,
      specialistType: null,
      visibility: input.visibility,
    });
    if (message.id) {
      try {
        await deps.complete({ ...input.claim, messageId: message.id });
      } catch (error) {
        // 답은 저장됐다. 같은 요청이 다시 오면 라우트의 재생 경로가 이 행으로 클레임을 맞춘다.
        deps.gate.onError("claim_complete_failed", error);
      }
    }
    return { kind: "reply", message, decision };
  } catch (error) {
    deps.gate.onError("reply_persist_failed", error);
    await deps.fail({ ...input.claim, failureCode: "AMORA_GATEKEEPER_REPLY_NOT_PERSISTED" })
      .catch((claimError) => {
        log.error("[amora-gatekeeper] claim release failed", claimError);
      });
    return {
      kind: "reply",
      message: ephemeralReply(
        reply,
        { ...metadata, persistence_status: "unconfirmed_ephemeral_fallback" },
        input.visibility,
      ),
      decision,
    };
  }
}

/** 시작과 마무리를 한 번에 한다(대화 밖 입구와 시험용). */
export async function runAmoraChatGatekeeper(
  input: RunAmoraChatGatekeeperInput,
  deps: AmoraChatGatekeeperDeps = DEFAULT_AMORA_CHAT_GATEKEEPER_DEPS,
): Promise<AmoraChatGateOutcome> {
  return finishAmoraChatGatekeeper(startAmoraChatGatekeeper(input, deps), input, deps);
}
