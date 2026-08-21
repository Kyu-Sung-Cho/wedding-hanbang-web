import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  amoraDirectedExamplePrefix,
  partnerDirectedPrefixes,
  speakerLabelFor,
} from "../speakerLabels";
import { getWeddingPlannerSystemPrompt } from "../prompts";

// 라벨이 성별인 것보다 이쪽이 더 위험했다: 런타임은 [사용자→상대방]을 붙이는데
// 프롬프트는 [신부→상대방]만 "응답 금지"로 가르쳐서, 중립 커플의 직접 대화에
// 아모라가 끼어들 수 있었다. 둘이 같은 값을 쓰는지 여기서 못박는다.

const BASE = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "테스터",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
} as unknown as Parameters<typeof getWeddingPlannerSystemPrompt>[0];

describe("화자 라벨 계약", () => {
  it("중립 모드 런타임 라벨은 슬롯을 보지 않는다", () => {
    expect(
      speakerLabelFor({ neutral: true, isSelf: true, senderType: "bride" }),
    ).toBe("사용자");
    expect(
      speakerLabelFor({ neutral: true, isSelf: false, senderType: "bride" }),
    ).toBe("파트너");
  });

  it("기존 모드 런타임 라벨은 그대로다", () => {
    expect(
      speakerLabelFor({ neutral: false, isSelf: true, senderType: "bride" }),
    ).toBe("신부");
    expect(
      speakerLabelFor({ neutral: false, isSelf: false, senderType: "groom" }),
    ).toBe("신랑");
  });

  it("프롬프트의 응답 금지 접두어가 런타임이 붙이는 값과 같다", () => {
    for (const neutral of [true, false]) {
      const prompt = getWeddingPlannerSystemPrompt({
        ...BASE,
        neutralMemberPresentation: neutral,
      });
      for (const prefix of partnerDirectedPrefixes(neutral)) {
        expect(prompt).toContain(prefix);
      }
      // 반대편 값이 새어 들어오면 규칙이 엉뚱한 문자열을 가리킨다
      for (const wrong of partnerDirectedPrefixes(!neutral)) {
        expect(prompt).not.toContain(wrong);
      }
      expect(prompt).toContain(amoraDirectedExamplePrefix(neutral));
    }
  });

  it("중립 프롬프트에는 성별 명사가 없다", () => {
    const prompt = getWeddingPlannerSystemPrompt({
      ...BASE,
      neutralMemberPresentation: true,
    });
    expect(prompt).not.toContain("신부");
    expect(prompt).not.toContain("신랑");
  });

  it("런타임 헬퍼가 프롬프트 소스에 하드코딩으로 복제되지 않았다", () => {
    // 다음 사람이 프롬프트에 접두어를 손으로 다시 적으면 또 갈라진다
    const source = readFileSync(join(__dirname, "../prompts.ts"), "utf8");
    expect(source).not.toContain("[신부→상대방]");
    expect(source).not.toContain("[신랑→상대방]");
  });
});
