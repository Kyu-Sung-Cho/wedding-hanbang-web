import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PendingAmoraActionCard, {
  isPendingActionPastDated,
  PAST_SCHEDULE_DATE_NOTICE,
} from "./PendingAmoraActionCard";
import {
  isPendingActionPastDated as isPastDatedOnMobile,
  PAST_SCHEDULE_DATE_NOTICE as MOBILE_PAST_SCHEDULE_DATE_NOTICE,
} from "../../../../../mobile/src/lib/pendingAmoraAction";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { PendingAmoraAction } from "@/types/database.types";

/**
 * 지난 날짜 일정을 카드가 말해 주는가 (2026-09-03).
 *
 * 연도를 말하지 않은 날짜는 지난 해로 해석돼 저장됐고, 사용자가 지난 날짜를 그대로
 * 말해도 어디서도 막거나 알려주지 않았다. 거부는 답이 아니다 — 지난 일을 기록하려는
 * 요청도 정당하다. 그래서 **저장은 그대로 두고 카드가 한 줄로 알려준다.**
 */
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// 2026-09-03 14:00 KST. UTC 로도 같은 날이라 시간대와 무관한 기준점이다.
const KST_AFTERNOON = Date.parse("2026-09-03T05:00:00.000Z");
// 2026-09-04 00:00 KST — UTC 로는 아직 2026-09-03 이다. 한국 새벽 창의 시작점.
const JUST_AFTER_KST_MIDNIGHT = Date.parse("2026-09-03T15:00:00.000Z");

function scheduleAction(
  input: Record<string, unknown>,
  tool = "add_schedule_event",
): PendingAmoraAction {
  const identity = getAmoraToolOperationIdentity(tool, input);
  return {
    version: 2,
    actionId: "22222222-2222-4222-8222-222222222222",
    tool,
    input,
    inputDigest: identity.inputDigest,
    operationKey: identity.operationKey,
    confirmation: `${String(input.date)} "${String(input.title)}" 일정을 추가할까요?`,
    issuedAt: KST_AFTERNOON,
    expiresAt: KST_AFTERNOON + 24 * 60 * 60 * 1_000,
  };
}

describe("지난 날짜 일정 카드", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function renderAt(nowMs: number, action: PendingAmoraAction) {
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    });
  }

  it("지난 날짜면 한 줄로 알려주되 적용은 계속 허용한다", async () => {
    await renderAt(
      KST_AFTERNOON,
      scheduleAction({ date: "2026-08-26", title: "상견례" }),
    );

    expect(container.textContent).toContain(PAST_SCHEDULE_DATE_NOTICE);
    // 거부가 아니라 표시다 — 버튼이 살아 있어야 지난 일을 기록할 수 있다.
    expect(container.querySelector("button")?.disabled).toBe(false);
  });

  it("같은 payload 라도 오늘 이후 날짜에는 아무 말도 하지 않는다", async () => {
    await renderAt(
      KST_AFTERNOON,
      scheduleAction({ date: "2026-09-26", title: "상견례" }),
    );

    expect(container.textContent).not.toContain(PAST_SCHEDULE_DATE_NOTICE);
  });

  it("KST 자정 직후(UTC 로는 전날)에도 오늘은 지난 날짜가 아니다", async () => {
    await renderAt(
      JUST_AFTER_KST_MIDNIGHT,
      scheduleAction({ date: "2026-09-04", title: "드레스 피팅" }),
    );

    expect(container.textContent).not.toContain(PAST_SCHEDULE_DATE_NOTICE);
  });

  it("KST 자정을 넘겼으면 어제가 된 날짜는 지난 날짜로 말한다", async () => {
    await renderAt(
      JUST_AFTER_KST_MIDNIGHT,
      scheduleAction({ date: "2026-09-03", title: "드레스 피팅" }),
    );

    // UTC 기준이면 오늘이라 아무 말도 안 했을 자리다.
    expect(container.textContent).toContain(PAST_SCHEDULE_DATE_NOTICE);
  });
});

describe("웹과 앱이 같은 입력에 같은 판정을 낸다", () => {
  /**
   * 두 구현을 **문자열로 대조하지 않는다.** 같은 입력을 두 함수에 넣고 결과를 짝짓는다.
   * 한쪽만 고치면 여기서 갈린다 — 이 저장소는 웹만 고치고 앱이 남은 적이 있다.
   */
  const cases: Array<{ tool: string; input: Record<string, unknown>; nowMs: number }> = [
    { tool: "add_schedule_event", input: { date: "2026-08-26" }, nowMs: KST_AFTERNOON },
    { tool: "add_schedule_event", input: { date: "2026-09-03" }, nowMs: KST_AFTERNOON },
    { tool: "add_schedule_event", input: { date: "2026-09-04" }, nowMs: KST_AFTERNOON },
    { tool: "add_schedule_event", input: { date: "2026-09-03" }, nowMs: JUST_AFTER_KST_MIDNIGHT },
    { tool: "add_schedule_event", input: { date: "2026-09-04" }, nowMs: JUST_AFTER_KST_MIDNIGHT },
    { tool: "update_schedule_event", input: { event_id: "e1", date: "2025-12-31" }, nowMs: KST_AFTERNOON },
    { tool: "update_schedule_event", input: { event_id: "e1", title: "제목만" }, nowMs: KST_AFTERNOON },
    { tool: "update_budget", input: { date: "2020-01-01" }, nowMs: KST_AFTERNOON },
    { tool: "add_schedule_event", input: { date: "26-08-26" }, nowMs: KST_AFTERNOON },
    { tool: "add_schedule_event", input: { date: 20260826 }, nowMs: KST_AFTERNOON },
    { tool: "add_schedule_event", input: { date: "2026-08-26" }, nowMs: 0 },
  ];

  it.each(cases)("$tool $input.date @ $nowMs", ({ tool, input, nowMs }) => {
    const action = { tool, input };
    expect(isPastDatedOnMobile(action, nowMs)).toBe(
      isPendingActionPastDated(action, nowMs),
    );
  });

  it("두 화면이 같은 문장을 보여준다", () => {
    expect(MOBILE_PAST_SCHEDULE_DATE_NOTICE).toBe(PAST_SCHEDULE_DATE_NOTICE);
  });

  it("판정이 실제로 갈린다 — 전부 false 면 대조가 아무것도 증명하지 않는다", () => {
    const decisions = cases.map(({ tool, input, nowMs }) =>
      isPendingActionPastDated({ tool, input }, nowMs),
    );
    expect(decisions.filter(Boolean).length).toBeGreaterThan(0);
    expect(decisions.filter((decision) => !decision).length).toBeGreaterThan(0);
  });
});

describe("앱 채팅 화면이 그 줄을 실제로 그린다", () => {
  /**
   * 앱에는 렌더 테스트 기반이 없다. 그래서 여기만 **글자로** 본다 — 이 저장소가
   * `onboardingGateParity` 에서 같은 이유로 쓰는 방식이다.
   *
   * 글자 검사의 한계를 알고 쓴다: 이 검사는 "줄이 그려지는가" 가 아니라 "판정과 문구가
   * 카드 파일에 배선돼 있는가" 만 답한다. 판정 자체(웹과 같은 결과인가)는 위 대조가
   * 답하고, 이 검사는 앱에서 그 판정을 **쓰지 않고 남겨 두는** 경우를 잡는다.
   */
  const chatScreen = "../../../../../mobile/app/(tabs)/chat.tsx";

  function readMobileChat(): string {
    // 주석이 대신 대답하지 못하게 지운다.
    const source = readFileSync(resolve(__dirname, chatScreen), "utf8");
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  it("검사가 실제로 앱 화면 파일을 읽는다", () => {
    const source = readMobileChat();
    expect(source.length, "앱 채팅 화면을 못 읽었다").toBeGreaterThan(10_000);
    expect(source).toContain("pendingActionDisabledReason");
  });

  it("판정과 문구를 가져와 쓴다 — 가져오기만 하고 안 쓰면 잡힌다", () => {
    const source = readMobileChat();
    expect(
      source.split("isPendingActionPastDated").length - 1,
      "앱이 지난 날짜 판정을 가져오기만 하고 쓰지 않는다",
    ).toBeGreaterThanOrEqual(2);
    expect(
      source.split("PAST_SCHEDULE_DATE_NOTICE").length - 1,
      "앱이 지난 날짜 문구를 가져오기만 하고 그리지 않는다",
    ).toBeGreaterThanOrEqual(2);
  });
});
