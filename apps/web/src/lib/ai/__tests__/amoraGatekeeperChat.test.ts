import { describe, expect, it, vi } from "vitest";

import {
  AMORA_GATE_BLOCKED_RISK_REPLY,
  AMORA_GATE_OUT_OF_SCOPE_REPLY,
  type AmoraGateDeps,
  type AmoraGateJudgeResult,
} from "@/lib/ai/amoraGatekeeper";
import {
  AMORA_GATEKEEPER_RESPONSE_ORIGIN,
  isAmoraGatekeeperReplyMetadata,
} from "@/lib/ai/amoraGatekeeperContract";
import {
  runAmoraChatGatekeeper,
  type AmoraChatGatekeeperDeps,
  type RunAmoraChatGatekeeperInput,
} from "@/lib/ai/amoraGatekeeperChat";

const COUPLE = "10000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000001";
const MESSAGE = "30000000-0000-4000-8000-000000000001";
const CLAIM = {
  coupleId: COUPLE,
  requestKey: `chat:${USER}:r1`,
  userId: USER,
  visibility: "shared" as const,
  userMessageId: MESSAGE,
};

function harness(judgeResult: AmoraGateJudgeResult, env: Record<string, string> = { AMORA_GATEKEEPER_ENABLED: "true" }) {
  const gate: AmoraGateDeps = {
    env,
    now: () => 0,
    moderate: vi.fn(async () => ({ status: "ok" as const, maxRiskScore: 0, riskCategories: [] })),
    judge: vi.fn(async () => judgeResult),
    onError: vi.fn(),
  };
  const deps: AmoraChatGatekeeperDeps = {
    gate,
    persist: vi.fn(async (params) => ({
      id: params.isDemo ? null : "40000000-0000-4000-8000-000000000001",
      createdAt: params.isDemo ? null : "2026-11-20T00:00:00.000Z",
      content: params.cleanText,
      metadata: { ...params.metadata, client_request_id: params.clientRequestId },
      stageTag: params.stageTag,
      specialistType: params.specialistType,
      visibility: params.visibility,
      reused: false,
    })),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
  return { gate, deps };
}

function input(overrides: Partial<RunAmoraChatGatekeeperInput> = {}): RunAmoraChatGatekeeperInput {
  return {
    requestKind: "chat",
    isDemo: false,
    userText: "파이썬으로 버블 정렬 짜줘",
    questionScope: "W4_out_of_scope",
    isCardConfirmation: false,
    actorId: USER,
    coupleId: COUPLE,
    visibility: "shared",
    clientRequestId: `chat:${USER}:r1`,
    userMessageId: MESSAGE,
    visibleClientRequestKey: `chat:${USER}:visible`,
    claim: CLAIM,
    initialPrivacyEpoch: 7,
    readPrivacyEpoch: vi.fn(async () => 7),
    ...overrides,
  };
}

describe("runAmoraChatGatekeeper", () => {
  it("스위치가 꺼져 있으면 판정도 저장도 하지 않는다", async () => {
    const { gate, deps } = harness({ status: "ok", topic: "not_wedding", risk: "none" }, {});
    const outcome = await runAmoraChatGatekeeper(input(), deps);
    expect(outcome).toEqual({ kind: "continue", decision: null });
    expect(gate.judge).not.toHaveBeenCalled();
    expect(gate.moderate).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("첫 인사와 빈 글은 문을 지나지 않는다", async () => {
    const { gate, deps } = harness({ status: "ok", topic: "not_wedding", risk: "none" });
    expect((await runAmoraChatGatekeeper(input({ requestKind: "initial_greeting" }), deps)).kind).toBe("continue");
    expect((await runAmoraChatGatekeeper(input({ userText: "   " }), deps)).kind).toBe("continue");
    expect(gate.judge).not.toHaveBeenCalled();
  });

  it("결혼 밖 질문은 고정 문장을 아모라 답으로 저장하고 요청을 끝낸다", async () => {
    const { deps } = harness({ status: "ok", topic: "not_wedding", risk: "none" });
    const outcome = await runAmoraChatGatekeeper(input(), deps);
    expect(outcome.kind).toBe("reply");
    if (outcome.kind !== "reply") return;
    expect(outcome.message.content).toBe(AMORA_GATE_OUT_OF_SCOPE_REPLY);
    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({
      isDemo: false,
      coupleId: COUPLE,
      cleanText: AMORA_GATE_OUT_OF_SCOPE_REPLY,
      clientRequestId: `chat:${USER}:r1`,
      visibility: "shared",
      metadata: expect.objectContaining({
        response_origin: AMORA_GATEKEEPER_RESPONSE_ORIGIN,
        question_scope: "W4_out_of_scope",
        memory_eligible: false,
        in_reply_to_user_message_id: MESSAGE,
        client_visible_request_id: `chat:${USER}:visible`,
      }),
    }));
    expect(deps.complete).toHaveBeenCalledWith({ ...CLAIM, messageId: "40000000-0000-4000-8000-000000000001" });
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("위험은 번호 없는 한 줄을 W5 로 저장한다(나만 상담 레인 그대로)", async () => {
    const { deps } = harness({ status: "ok", topic: "wedding", risk: "suicide" });
    const outcome = await runAmoraChatGatekeeper(input({
      questionScope: "W0_wedding_core",
      visibility: "bride_private",
      claim: { ...CLAIM, visibility: "bride_private" },
    }), deps);
    expect(outcome.kind).toBe("reply");
    if (outcome.kind !== "reply") return;
    expect(outcome.message.content).toBe(AMORA_GATE_BLOCKED_RISK_REPLY);
    expect(outcome.message.visibility).toBe("bride_private");
    expect(outcome.message.metadata).toMatchObject({ question_scope: "W5_safety_override" });
  });

  it("중재는 저장하지 않고 중재 안전 확인으로 돌린다", async () => {
    const { deps } = harness({ status: "ok", topic: "wedding", risk: "violence" });
    const outcome = await runAmoraChatGatekeeper(input({ requestKind: "mediation", questionScope: "W1_wedding_adjacent" }), deps);
    expect(outcome.kind).toBe("mediation_blocked");
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("카드 확인 턴은 범위로 거절하지 않는다", async () => {
    const { deps } = harness({ status: "ok", topic: "not_wedding", risk: "none" });
    const outcome = await runAmoraChatGatekeeper(input({ isCardConfirmation: true }), deps);
    expect(outcome.kind).toBe("continue");
  });

  it("그사이 개인정보 판번호가 바뀌었으면 쓰지 않는다", async () => {
    const { deps } = harness({ status: "ok", topic: "not_wedding", risk: "none" });
    const outcome = await runAmoraChatGatekeeper(input({ readPrivacyEpoch: vi.fn(async () => 8) }), deps);
    expect(outcome.kind).toBe("privacy_changed");
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("저장이 안 되면 같은 문장을 저장 없이 돌려주고 클레임을 푼다 — 모델로는 가지 않는다", async () => {
    const { deps } = harness({ status: "ok", topic: "not_wedding", risk: "none" });
    deps.persist = vi.fn(async () => { throw new Error("db down"); });
    const outcome = await runAmoraChatGatekeeper(input(), deps);
    expect(outcome.kind).toBe("reply");
    if (outcome.kind !== "reply") return;
    expect(outcome.message.id).toBeNull();
    expect(outcome.message.content).toBe(AMORA_GATE_OUT_OF_SCOPE_REPLY);
    expect(outcome.message.metadata).toMatchObject({ persistence_status: "unconfirmed_ephemeral_fallback" });
    expect(isAmoraGatekeeperReplyMetadata(outcome.message.metadata)).toBe(true);
    expect(deps.fail).toHaveBeenCalledWith({ ...CLAIM, failureCode: "AMORA_GATEKEEPER_REPLY_NOT_PERSISTED" });
  });

  it("체험은 DB 에 쓰지 않는다", async () => {
    const { gate, deps } = harness({ status: "ok", topic: "not_wedding", risk: "none" });
    const outcome = await runAmoraChatGatekeeper(input({ isDemo: true, claim: null, initialPrivacyEpoch: null }), deps);
    expect(outcome.kind).toBe("reply");
    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({ isDemo: true }));
    expect(deps.complete).not.toHaveBeenCalled();
    // 체험 행위자의 합성 id 는 감사 표의 사용자·커플 키로 넘기지 않는다.
    expect((gate.judge as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({ surface: "amora_chat", userId: null, coupleId: null });
  });

  it("판정 모델이 실패하면 오늘의 길로 간다", async () => {
    const { deps } = harness({ status: "failed" });
    const outcome = await runAmoraChatGatekeeper(input(), deps);
    expect(outcome.kind).toBe("continue");
    expect(deps.persist).not.toHaveBeenCalled();
  });
});
