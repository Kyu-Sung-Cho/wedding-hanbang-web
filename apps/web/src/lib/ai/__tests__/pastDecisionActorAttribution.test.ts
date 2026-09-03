import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { amoraActorLabel } from "@/lib/ai/amoraProfileProjection";

/**
 * 2026-09-03 (2차 Major 7, Turn 28).
 *
 * 중재 답변이 커플이 처음부터 함께 둔 전제(하객 80~100명, 식사 우선)를 한쪽
 * 파트너가 이번 갈등에서 주장한 가치로 붙였다. 이유는 단순하다 — 결정 히스토리
 * 블록에 **발화자 필드가 아예 없었다.** 대화 창(40행) 밖으로 밀린 초반 발화는
 * 이 블록으로만 모델에 닿는데, 거기엔 누가 말했는지가 없었다.
 *
 * 라벨 문자열은 `amoraProfileProjection` 과 같은 함수로 만든다. 두 곳에 따로 두면
 * 중립 준비 공간에서 갈라진다.
 */

type Decision = {
  category: string;
  decisionType: string;
  title: string;
  value: string | null;
  reasoning: string | null;
  confidence: number;
  source: string;
  createdAt: string;
  sourceActorRole?: "bride" | "groom" | null;
};

const TODAY = new Date().toISOString();

function decision(overrides: Partial<Decision>): Decision {
  return {
    category: "guestcount",
    decisionType: "decided",
    title: "하객 규모",
    value: "80~100명",
    reasoning: "식사 퀄리티를 우선하고 싶어서",
    confidence: 0.8,
    source: "chat",
    createdAt: TODAY,
    sourceActorRole: null,
    ...overrides,
  };
}

function compose(
  pastDecisions: Decision[],
  options?: { neutral?: boolean },
): string {
  const context = {
    startingPointAsked: false,
    weddingDate: "2027-05-15",
    budget: 62_000_000,
    venue: "그랜드힐컨벤션",
    progress: {},
    preparationStatus: "preparing",
    brideName: options?.neutral ? null : "지은",
    groomName: options?.neutral ? null : "민수",
    neutralMemberPresentation: options?.neutral === true,
    senderName: "지은",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    preferences: undefined,
    helpPreference: null,
    amoraProfiles: { shared: null, private: null },
    pastDecisions,
    pastConflicts: [],
  };
  return buildAmoraSystemPrompt(context as never, {
    specialist: "general",
    requestKind: "chat",
    persistenceMode: "durable",
    enabledToolNames: [],
    maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  } as never);
}

describe("결정 히스토리는 누가 말한 값인지 함께 싣는다", () => {
  it("기록된 발화자는 라벨로 찍힌다", () => {
    const prompt = compose([
      decision({ sourceActorRole: "bride", value: "80~100명" }),
      decision({
        category: "style",
        title: "식사 우선",
        value: "식대에 먼저 쓰기",
        sourceActorRole: "groom",
      }),
    ]);
    expect(prompt).toContain('[신부] ["guestcount"]');
    expect(prompt).toContain("[신랑] [");
  });

  it("2주 이전 결정(압축 형태)에도 라벨이 붙는다", () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const prompt = compose([
      decision({ createdAt: old, sourceActorRole: "groom" }),
    ]);
    expect(prompt).toContain("혹시 아직도");
    expect(prompt).toContain('[신랑] ["guestcount"]');
  });

  it("드러난 가치관 블록에도 라벨이 붙는다 — 가중치를 높이라고 시키는 자리다", () => {
    const prompt = compose([
      decision({
        category: "preference",
        decisionType: "considering",
        title: "식사 우선",
        value: "식대 우선",
        reasoning: "부모님 손님이 많아서",
        sourceActorRole: "bride",
      }),
    ]);
    expect(prompt).toContain("드러난 가치관");
    expect(prompt).toContain('[신부] 값 "식대 우선"');
  });

  it("출처가 없으면 라벨을 지어내지 않고, 귀속하지 말라고 시킨다", () => {
    const prompt = compose([
      decision({ sourceActorRole: null, value: "80~100명" }),
    ]);
    expect(prompt).toContain('  - ["guestcount"]');
    expect(prompt).not.toContain('[신부] ["guestcount"]');
    expect(prompt).not.toContain('[신랑] ["guestcount"]');
    expect(prompt).toContain("표시가 없으면 출처가 기록되지 않은 것이니");
  });

  it("중립 준비 공간이면 투영 블록과 같은 라벨을 쓴다", () => {
    // 두 곳에 문자열을 따로 두면 여기서 갈라진다. 같은 함수를 부르는지 본다.
    const neutralBride = amoraActorLabel("bride", { neutralMemberPresentation: true });
    expect(neutralBride).not.toBe("신부");

    const prompt = compose(
      [decision({ sourceActorRole: "bride" })],
      { neutral: true },
    );
    expect(prompt).toContain(`[${neutralBride}] ["guestcount"]`);
    expect(prompt).not.toContain('[신부] ["guestcount"]');
  });
});

describe("프롬프트 길이 — 라벨이 상한을 밀어내지 않는다", () => {
  it("결정 50개에 전부 라벨이 붙어도 늘어나는 것은 라벨과 원칙 한 줄뿐", () => {
    const rows = Array.from({ length: 50 }, (_, index) => decision({
      title: `결정 ${index + 1}`,
      value: `값 ${index + 1}`,
      sourceActorRole: index % 2 === 0 ? "bride" : "groom",
    }));
    const unlabeled = rows.map((row) => ({ ...row, sourceActorRole: null }));

    const withLabels = compose(rows);
    const withoutLabels = compose(unlabeled);
    const growth = withLabels.length - withoutLabels.length;

    // `[신부] ` / `[신랑] ` = 5자 × 50행.
    expect(growth).toBe(250);
    expect(withLabels.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);

    // 규칙은 한 줄뿐이고, 결정이 없는 턴에는 이 블록 자체가 실리지 않는다.
    const ruleLines = withLabels
      .split("\n")
      .filter((line) => line.startsWith("6. **발화자 귀속**"));
    expect(ruleLines).toHaveLength(1);
    expect(ruleLines[0].length).toBeLessThanOrEqual(200);
    expect(compose([])).not.toContain("**발화자 귀속**");
  });
});

describe("route 가 발화자를 실제로 넘긴다", () => {
  // 포매터만 고치고 매핑을 빠뜨리면 라벨은 영원히 안 붙는다. 프롬프트 테스트는
  // 그 누락을 못 본다 — 질의와 매핑을 직접 본다.
  const source = readFileSync(
    path.resolve(process.cwd(), "src/app/api/chat/route.ts"),
    "utf8",
  );

  it("결정 히스토리 질의가 source_actor_role 을 읽는다", () => {
    const selectLines = source
      .split("\n")
      .filter((line) => line.includes('.select("category, decision_type, title, chosen_value'));
    expect(selectLines).toHaveLength(1);
    expect(selectLines[0]).toContain("source_actor_role");
  });

  it("pastDecisions 매핑이 그 값을 채운다", () => {
    expect(source).toContain("sourceActorRole: d.source_actor_role");
  });
});
