// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "../amoraPromptComposer";

// 2026-11-20 D-87(기억 켜기) 전에 고치는 것, 09장 M5-1·M5-3.
//   M5-1 대화 묶음 요약은 지시문에 싣지 않는다(화면에 없는 기억, 지운 기억이 요약에 남는다).
//   M5-3 자동 기억의 "이유"(모델이 쓴 추정)는 지시문에 싣지 않고 새로 저장하지도 않는다. 서버가 쓴 영수증 배경은 둔다.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("기억 켜기 전 M5-1·M5-3", () => {
  it("채팅 경로는 자동 기억의 이유를 지시문 문맥으로 넘기지 않는다", () => {
    const route = read("src/app/api/chat/route.ts");
    expect(route).toContain("reasoning: isAutomaticMemory(d) ? null : d.reasoning,");
    expect(route).toContain("reasoning: isAutomaticMemory(c) ? null : c.reasoning,");
    expect(route).not.toMatch(/^\s+reasoning: [dc]\.reasoning,$/m);
  });

  it("기억 정리 크론은 모델이 쓴 이유를 저장하지 않는다", () => {
    const cron = read("src/app/api/cron/amora-memory/route.ts");
    expect(cron).toMatch(/value: memory\.value,\n(?:\s*\/\/.*\n)*\s*reasoning: null,/);
    expect(cron).not.toContain("reasoning: memory.reasoning");
  });

  it("요약이 있어도 지시문에는 요약 구역이 없다", () => {
    const prompt = buildAmoraSystemPrompt(
      {
        weddingDate: null,
        budget: 0,
        venue: null,
        progress: {},
        brideName: null,
        groomName: null,
        senderName: "민이",
        scheduleEvents: [],
        bookings: [],
        chatSummaries: ["SUMMARY_LEAK_SENTINEL"],
      },
      { requestKind: "chat", persistenceMode: "durable", enabledToolNames: [] },
    );
    expect(prompt).not.toContain("SUMMARY_LEAK_SENTINEL");
    expect(prompt).not.toContain("### 이전 대화 요약");
  });
});
