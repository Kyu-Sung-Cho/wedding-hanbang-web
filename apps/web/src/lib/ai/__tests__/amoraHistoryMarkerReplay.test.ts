import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAmoraHistoryContent,
  extractAmoraPendingAction,
  renderAmoraPendingActionMarker,
} from "@/lib/ai/amoraPendingAction";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

// 아모라 답변은 표식이 제거된 채 저장된다. 그 본문을 그대로 이력에 돌려주면
// 모델은 "표식 없이 적용할까요만 묻는" 자기 앞 턴을 따라 하게 되고, 대화가
// 길어질수록 카드가 나오지 않는다(스테이징 실측: 14~24행 3/6 → 26~36행 0/6).
// 그래서 제안했던 턴은 표식을 되붙여 돌려준다.

const budgetTool = WEDDING_TOOLS.find((tool) => tool.name === "update_budget");

const storedAction = {
  version: 2 as const,
  actionId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  tool: "update_budget",
  input: { total_budget: 55_000_000 },
  inputDigest: "a".repeat(64),
  operationKey: "update_budget:total",
  confirmation: "다음 변경을 적용할까요?",
  issuedAt: 1,
  expiresAt: 2,
};

describe("renderAmoraPendingActionMarker", () => {
  it("저장된 제안을 표식으로 되돌린다", () => {
    expect(renderAmoraPendingActionMarker(storedAction)).toBe(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":55000000}}[/pending_action]',
    );
  });

  it("되붙인 표식은 서버가 다시 읽어 같은 제안으로 복원된다", () => {
    const marker = renderAmoraPendingActionMarker(storedAction);
    expect(marker).not.toBeNull();
    const replayed = extractAmoraPendingAction({
      text: `다음 변경을 적용할까요?\n${marker}`,
      allowedTools: budgetTool ? [budgetTool] : [],
      now: 1_000,
      createActionId: () => "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f",
    });
    expect(replayed.pendingAction?.tool).toBe("update_budget");
    expect(replayed.pendingAction?.input).toEqual({ total_budget: 55_000_000 });
  });

  it.each([
    ["표식이 없던 턴", null],
    ["빈 값", undefined],
    ["문자열", "update_budget"],
    ["도구 이름이 없음", { version: 2, input: {} }],
    ["입력이 객체가 아님", { version: 2, tool: "update_budget", input: "총예산" }],
    ["옛 판", { version: 1, tool: "update_budget", input: {} }],
  ])("%s 은 되붙이지 않는다", (_label, value) => {
    expect(renderAmoraPendingActionMarker(value)).toBeNull();
  });

  it("지나치게 큰 입력은 되붙이지 않는다 — 이력이 대화를 밀어내면 안 된다", () => {
    const huge = { version: 2, tool: "update_budget", input: { memo: "가".repeat(5_000) } };
    expect(renderAmoraPendingActionMarker(huge)).toBeNull();
  });
});

describe("대화 이력 구성", () => {
  // 라우트가 실제로 되붙이는지. 이 배선이 빠지면 함수만 있고 결함은 그대로다.
  const routeSource = readFileSync(
    resolve(process.cwd(), "src/app/api/chat/route.ts"),
    "utf8",
  );

  it("toCanonicalMessage 가 아모라 턴에 표식을 되붙인다", () => {
    const start = routeSource.indexOf("const toCanonicalMessage");
    expect(start).toBeGreaterThan(-1);
    const body = routeSource.slice(start, start + 900);
    expect(body).toContain("buildAmoraHistoryContent");
    expect(body).toContain("pending_amora_action");
  });
});

describe("buildAmoraHistoryContent", () => {
  // 이 경로가 중요한 이유: 정화를 생성 시점에만 두면 **이미 쌓인 대화는 영영
  // 그대로다.** 운영에는 지금도 표식 없는 확인 문장이 들어 있는 대화가 있다.
  it("제안했던 턴은 표식을 달고 돌아온다", () => {
    expect(buildAmoraHistoryContent("다음 변경을 적용할까요?", storedAction))
      .toContain("[pending_action]");
  });

  it("지난 대화에 남은 지어낸 확인 약속은 걷어낸다", () => {
    const past = "총 예산을 7,000만 원으로 바꾸는 것으로 이해했어요. 확인해 주시면 적용할게요.";
    const replayed = buildAmoraHistoryContent(past, null);
    expect(replayed).not.toContain("확인해 주시면");
    expect(replayed.trim().length).toBeGreaterThan(0);
  });

  it("평범한 답변은 그대로 돌아온다", () => {
    const plain = "웨딩홀 대관료는 지역마다 크게 달라요. 어느 지역을 보고 계신가요?";
    expect(buildAmoraHistoryContent(plain, null)).toBe(plain);
  });
});
